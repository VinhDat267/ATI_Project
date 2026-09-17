import {
  PlannerResultSchema,
  buildPlanningPrompt,
  buildRepairPrompt,
  buildSystemPrompt,
  type LlmPlanDraft,
  type PlannerResult,
} from "@wap/dsl";
import type { CreateRun } from "../planner-port.js";
import { parsePlannerResult } from "../planner-port.js";
import { EngineError, validateManualPlan } from "../snapshot.js";
import type { ToolCandidate, ValidationIssue } from "@wap/dsl";
import type { ReviewedCatalogTool } from "./catalog.js";
import type {
  StructuredModelClient,
  StructuredModelResponse,
} from "./ports.js";
import type { RetrievalVariant, ToolRetriever } from "./retrieval.js";

export type OfflineRetrievalVariant = Exclude<RetrievalVariant, "semantic_qe">;

export type PlanValidator = (plan: LlmPlanDraft) => ValidationIssue[];

export class AiPlannerError extends Error {
  constructor(
    readonly code:
      | "PLANNING_EXHAUSTED"
      | "INVALID_CONFIGURATION"
      | "CANCELLED"
      | "DEADLINE_EXCEEDED",
    message: string,
    readonly attempts: number,
  ) {
    super(message);
    this.name = "AiPlannerError";
  }
}

export interface AiPlannerAdapterOptions {
  readonly retriever: ToolRetriever;
  readonly model: StructuredModelClient;
  readonly variant?: OfflineRetrievalVariant;
  readonly topK?: number;
  readonly maxPlanningCalls?: number;
  readonly validatePlan: PlanValidator;
  readonly deadlineMs?: number;
  /** Synchronous evidence sink; sink failures fail closed. Never receives prompt/output. */
  readonly onModelCall?: (event: ModelCallEvidence) => void;
}

export interface ModelCallEvidence {
  readonly runId: string;
  readonly attempt: number;
  readonly status: "received" | "failed" | "CANCELLED" | "DEADLINE_EXCEEDED";
  readonly latencyMs: number;
  readonly provider: string | null;
  readonly model: string | null;
  readonly requestId: string | null;
  readonly usage: StructuredModelResponse["usage"];
}

function bounded<T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve()
      .then(() => {
        if (signal.aborted) throw signal.reason;
        return operation();
      })
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

function asPromptTool(tool: ReviewedCatalogTool): ToolCandidate {
  return {
    server: tool.server,
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    sideEffect: tool.sideEffect,
  };
}

function issueForMalformedOutput(): ValidationIssue {
  return {
    layer: "schema",
    path: [],
    message: "Structured planner output did not match PlannerResultSchema",
  };
}

function issueSummary(issues: readonly ValidationIssue[]): string {
  return (
    issues.map((issue) => issue.message).join("; ") ||
    "unknown validation error"
  );
}

function throwIfAborted(
  signal: AbortSignal | undefined,
  attempts: number,
): void {
  if (signal?.aborted)
    throw new AiPlannerError(
      "CANCELLED",
      "Planner request was cancelled",
      attempts,
    );
}

/**
 * Provider-independent planner orchestration for the offline gate.
 *
 * It generates and validates candidates against the retrieved reviewed tools.
 * Engine lifecycle revalidation, policy, preview and approval remain authoritative.
 * There is deliberately no fixture fallback when the model fails.
 */
export class AiPlannerAdapter {
  readonly mode = "ai" as const;
  private readonly retriever: ToolRetriever;
  private readonly model: StructuredModelClient;
  private readonly variant: OfflineRetrievalVariant;
  private readonly topK: number;
  private readonly maxPlanningCalls: number;
  private readonly validatePlan: PlanValidator;
  private readonly deadlineMs: number;
  private readonly onModelCall: AiPlannerAdapterOptions["onModelCall"];

  constructor(options: AiPlannerAdapterOptions) {
    const deadlineMs = options.deadlineMs ?? 60_000;
    if (
      !Number.isInteger(deadlineMs) ||
      deadlineMs < 1 ||
      deadlineMs > 2_147_483_647
    )
      throw new AiPlannerError(
        "INVALID_CONFIGURATION",
        "deadlineMs must be a positive timer-safe integer",
        0,
      );
    this.deadlineMs = deadlineMs;
    this.onModelCall = options.onModelCall;
    const topK = options.topK ?? 10;
    const maxPlanningCalls = options.maxPlanningCalls ?? 3;
    if (!Number.isInteger(topK) || topK < 1 || topK > 10)
      throw new AiPlannerError(
        "INVALID_CONFIGURATION",
        "topK must be between 1 and 10",
        0,
      );
    if (
      !Number.isInteger(maxPlanningCalls) ||
      maxPlanningCalls < 1 ||
      maxPlanningCalls > 3
    )
      throw new AiPlannerError(
        "INVALID_CONFIGURATION",
        "maxPlanningCalls must be between 1 and 3",
        0,
      );
    this.retriever = options.retriever;
    this.model = options.model;
    this.variant = options.variant ?? "all_tools";
    this.topK = topK;
    this.maxPlanningCalls = maxPlanningCalls;
    this.validatePlan = options.validatePlan;
  }

  async produce(input: {
    runId: string;
    userId: string;
    request: CreateRun;
    runtime: Record<string, string>;
    signal?: AbortSignal;
  }): Promise<PlannerResult> {
    throwIfAborted(input.signal, 0);
    const controller = new AbortController();
    let attempts = 0;
    const cancel = () =>
      controller.abort(
        new AiPlannerError(
          "CANCELLED",
          "Planner request was cancelled",
          attempts,
        ),
      );
    input.signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(
      () =>
        controller.abort(
          new AiPlannerError(
            "DEADLINE_EXCEEDED",
            "Planning deadline exceeded",
            attempts,
          ),
        ),
      this.deadlineMs,
    );
    try {
      const retrieval = await bounded(
        () =>
          this.retriever.retrieve({
            query: input.request.source_prompt,
            variant: this.variant,
            topK: this.topK,
            signal: controller.signal,
          }),
        controller.signal,
      );
      throwIfAborted(input.signal, 0);
      const tools = retrieval.tools.map(asPromptTool);
      const systemPrompt = buildSystemPrompt();
      const originalPrompt = buildPlanningPrompt({
        userPrompt: input.request.source_prompt,
        tools,
        runtime: input.runtime,
        declaredInputs: input.request.inputs,
      });
      let userPrompt = originalPrompt;
      let failedPlan: unknown = null;
      let issues: ValidationIssue[] = [];
      const previousAttempts: string[] = [];

      for (let attempt = 1; attempt <= this.maxPlanningCalls; attempt++) {
        if (controller.signal.aborted) throw controller.signal.reason;
        attempts = attempt;
        const started = performance.now();
        let response: StructuredModelResponse;
        try {
          response = await bounded(
            () =>
              this.model.complete({
                systemPrompt,
                userPrompt,
                schema: PlannerResultSchema,
                signal: controller.signal,
              }),
            controller.signal,
          );
        } catch (error) {
          this.onModelCall?.({
            runId: input.runId,
            attempt,
            status: controller.signal.aborted
              ? ((controller.signal.reason as AiPlannerError).code as
                  "CANCELLED" | "DEADLINE_EXCEEDED")
              : "failed",
            latencyMs: performance.now() - started,
            provider: null,
            model: null,
            requestId: null,
            usage: null,
          });
          if (input.signal?.aborted)
            throw new AiPlannerError(
              "CANCELLED",
              "Planner request was cancelled",
              attempt,
            );
          throw error;
        }
        this.onModelCall?.({
          runId: input.runId,
          attempt,
          status: "received",
          latencyMs: performance.now() - started,
          provider: response.provider,
          model: response.model,
          requestId: response.requestId ?? null,
          usage: response.usage ? { ...response.usage } : null,
        });
        throwIfAborted(input.signal, attempt);

        let result: PlannerResult | undefined;
        try {
          result = parsePlannerResult(response.output);
        } catch {
          failedPlan = response.output;
          issues = [issueForMalformedOutput()];
        }

        if (issues.length === 0) {
          if (!result)
            throw new AiPlannerError(
              "PLANNING_EXHAUSTED",
              "Planner did not return a result",
              attempt,
            );
          if (result.kind === "refusal" || result.kind === "clarification")
            return result;
          let validationIssues: ValidationIssue[] = [];
          try {
            validateManualPlan(result.plan, retrieval.tools);
          } catch (error) {
            if (
              !(error instanceof EngineError) ||
              error.code !== "INVALID_PLAN"
            )
              throw error;
            validationIssues = [
              {
                layer: "tool",
                path: [],
                message:
                  error instanceof Error
                    ? error.message
                    : "Plan validation failed",
              },
            ];
          }
          if (validationIssues.length === 0)
            validationIssues = this.validatePlan(result.plan);
          if (validationIssues.length === 0) return result;
          failedPlan = result.plan;
          issues = validationIssues;
        }

        if (attempt === this.maxPlanningCalls)
          throw new AiPlannerError(
            "PLANNING_EXHAUSTED",
            `Planner output remained invalid after ${attempt} calls: ${issueSummary(issues)}`,
            attempt,
          );

        previousAttempts.push(issueSummary(issues));
        userPrompt =
          originalPrompt +
          "\n\n" +
          buildRepairPrompt({
            userPrompt: input.request.source_prompt,
            failedPlan,
            issues,
            attemptNo: attempt,
            maxAttempts: this.maxPlanningCalls,
            previousAttempts,
          });
        issues = [];
      }

      throw new AiPlannerError(
        "PLANNING_EXHAUSTED",
        "Planner did not return a result",
        this.maxPlanningCalls,
      );
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", cancel);
    }
  }
}
