import {
  PlannerResultSchema,
  buildReplanPrompt,
  buildRepairPrompt,
  buildSystemPrompt,
  type PlannerResult,
  type ToolCandidate,
  type ValidationIssue,
  type WorkflowPlan,
} from "@wap/dsl";
import { parsePlannerResult } from "../planner-port.js";
import { EngineError, canonicalJson, validateManualPlan } from "../snapshot.js";
import { safeProject } from "../redaction.js";
import type { ReviewedCatalogTool } from "./catalog.js";
import {
  AiPlannerError,
  type ModelCallEvidence,
  type PlanValidator,
} from "./planner.js";
import type {
  LocalReplanInput,
  LocalReplanPort,
  StructuredModelClient,
  StructuredModelResponse,
} from "./ports.js";
import type { RetrievalVariant, ToolRetriever } from "./retrieval.js";

export interface AiReplanAdapterOptions {
  readonly retriever: ToolRetriever;
  /** Revalidate request-scoped retrieval state after model output. */
  readonly assertCurrent?: () => Promise<void>;
  readonly model: StructuredModelClient;
  readonly variant?: RetrievalVariant;
  readonly topK?: number;
  readonly maxRepairCalls?: number;
  readonly validatePlan?: PlanValidator;
  readonly deadlineMs?: number;
  readonly secrets?: readonly string[];
  /** Synchronous evidence sink; sink failures fail closed. Never receives prompt/output. */
  readonly onModelCall?: (event: ModelCallEvidence) => void;
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
    message: "Structured replanner output did not match PlannerResultSchema",
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
      "Replan request was cancelled",
      attempts,
    );
}

/**
 * Validate that a replanned workflow adheres to local scope invariants (FR-EXE-12, FR-EXE-13):
 * 1. Steps that already produced output (completed steps) must retain their step ID, server, name, and args.
 * 2. Completed write steps must never be duplicated or altered.
 * 3. The failed step ID must exist in the new plan.
 */
export function validateLocalScopeInvariants(
  currentPlan: WorkflowPlan,
  newPlan: WorkflowPlan,
  failedStepId: string,
  completedStepIds: readonly string[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const failedInNew = newPlan.steps.find((s) => s.id === failedStepId);
  if (!failedInNew) {
    issues.push({
      layer: "graph",
      path: ["steps"],
      message: `Local replan must retain the failed step id '${failedStepId}'`,
    });
  }

  for (const stepId of completedStepIds) {
    const original = currentPlan.steps.find((s) => s.id === stepId);
    if (!original) continue;
    const replacement = newPlan.steps.find((s) => s.id === stepId);
    if (!replacement) {
      issues.push({
        layer: "graph",
        path: ["steps"],
        message: `Local replan removed already-completed step '${stepId}'`,
      });
      continue;
    }
    if (
      original.tool.server !== replacement.tool.server ||
      original.tool.name !== replacement.tool.name
    ) {
      issues.push({
        layer: "tool",
        path: ["steps", stepId, "tool"],
        message: `Already-completed step '${stepId}' tool cannot be changed from ${original.tool.server}.${original.tool.name} to ${replacement.tool.server}.${replacement.tool.name}`,
      });
    }
    if (
      canonicalJson(original.tool.args) !== canonicalJson(replacement.tool.args)
    ) {
      issues.push({
        layer: "tool",
        path: ["steps", stepId, "tool", "args"],
        message: `Already-completed step '${stepId}' arguments cannot be changed in local replan`,
      });
    }
  }

  return issues;
}

export class AiReplanAdapter implements LocalReplanPort {
  private readonly retriever: ToolRetriever;
  private readonly assertCurrent: () => Promise<void>;
  private readonly model: StructuredModelClient;
  private readonly variant: RetrievalVariant;
  private readonly topK: number;
  private readonly maxRepairCalls: number;
  private readonly validatePlan: PlanValidator;
  private readonly deadlineMs: number;
  private readonly secrets?: readonly string[];
  private readonly onModelCall: AiReplanAdapterOptions["onModelCall"];

  constructor(options: AiReplanAdapterOptions) {
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
    const maxRepairCalls = options.maxRepairCalls ?? 3;
    if (!Number.isInteger(topK) || topK < 1 || topK > 10)
      throw new AiPlannerError(
        "INVALID_CONFIGURATION",
        "topK must be between 1 and 10",
        0,
      );
    if (
      !Number.isInteger(maxRepairCalls) ||
      maxRepairCalls < 1 ||
      maxRepairCalls > 3
    )
      throw new AiPlannerError(
        "INVALID_CONFIGURATION",
        "maxRepairCalls must be between 1 and 3",
        0,
      );
    this.retriever = options.retriever;
    this.assertCurrent = options.assertCurrent ?? (async () => {});
    this.model = options.model;
    this.variant = options.variant ?? "all_tools";
    this.topK = topK;
    this.maxRepairCalls = maxRepairCalls;
    this.validatePlan = options.validatePlan ?? (() => []);
    this.secrets = options.secrets;
  }

  async replan(input: LocalReplanInput): Promise<PlannerResult> {
    throwIfAborted(input.signal, 0);
    const controller = new AbortController();
    let attempts = 0;
    const cancel = () =>
      controller.abort(
        new AiPlannerError(
          "CANCELLED",
          "Replan request was cancelled",
          attempts,
        ),
      );
    input.signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(
      () =>
        controller.abort(
          new AiPlannerError(
            "DEADLINE_EXCEEDED",
            "Replan deadline exceeded",
            attempts,
          ),
        ),
      this.deadlineMs,
    );

    try {
      const safeSourcePrompt = safeProject(input.sourcePrompt, this.secrets);
      const safeErrorMessage = safeProject(input.errorMessage, this.secrets);
      const retrieval = await bounded(
        () =>
          this.retriever.retrieve({
            query: `${safeSourcePrompt} ${safeErrorMessage}`,
            variant: this.variant,
            topK: this.topK,
            signal: controller.signal,
          }),
        controller.signal,
      );
      throwIfAborted(input.signal, 0);

      const tools = retrieval.tools.map(asPromptTool);
      const systemPrompt = buildSystemPrompt();

      // Redact configured values from every provider-bound replan context. This
      // includes retrieval text: query embeddings are also provider calls.
      const safeFailedApproaches = input.failedApproaches.map((approach) =>
        safeProject(approach, this.secrets),
      );
      const safeCurrentPlan = safeProject(input.currentPlan, this.secrets);
      const safeOutputs = safeProject(input.completedOutputs, this.secrets);
      const completedStepIds = Object.keys(input.completedOutputs);

      const originalPrompt = buildReplanPrompt({
        sourcePrompt: safeSourcePrompt,
        currentPlan: safeCurrentPlan,
        failedStepId: input.failedStepId,
        errorMessage: safeErrorMessage,
        errorClass: input.errorClass,
        scope: "local",
        completedOutputs: safeOutputs,
        failedApproaches: safeFailedApproaches,
        tools,
        replanCount: input.replanCount,
        maxReplans: input.maxReplans,
      });

      let userPrompt = originalPrompt;
      let failedPlan: unknown = null;
      let issues: ValidationIssue[] = [];
      const previousAttempts: string[] = [];

      for (let attempt = 1; attempt <= this.maxRepairCalls; attempt++) {
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
              "Replan request was cancelled",
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
        await bounded(() => this.assertCurrent(), controller.signal);

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
              "Replanner did not return a result",
              attempt,
            );
          if (result.kind === "refusal" || result.kind === "clarification")
            return result;

          let planCandidate: WorkflowPlan | undefined;
          let validationIssues: ValidationIssue[] = [];
          try {
            planCandidate = validateManualPlan(result.plan, retrieval.tools);
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

          if (validationIssues.length === 0 && planCandidate) {
            validationIssues = validateLocalScopeInvariants(
              input.currentPlan,
              planCandidate,
              input.failedStepId,
              completedStepIds,
            );
          }

          if (validationIssues.length === 0 && planCandidate) {
            validationIssues = this.validatePlan(planCandidate);
          }

          if (validationIssues.length === 0 && planCandidate) {
            return {
              kind: "plan",
              plan: planCandidate,
            };
          }
          failedPlan = result.plan;
          issues = validationIssues;
        }

        if (attempt === this.maxRepairCalls)
          throw new AiPlannerError(
            "PLANNING_EXHAUSTED",
            `Replanner output remained invalid after ${attempt} calls: ${issueSummary(issues)}`,
            attempt,
          );

        previousAttempts.push(issueSummary(issues));
        userPrompt =
          originalPrompt +
          "\n\n" +
          buildRepairPrompt({
            userPrompt: safeSourcePrompt,
            failedPlan: safeProject(failedPlan, this.secrets),
            issues: safeProject(issues, this.secrets),
            attemptNo: attempt,
            maxAttempts: this.maxRepairCalls,
            previousAttempts: previousAttempts.map((previous) =>
              safeProject(previous, this.secrets),
            ),
          });
        issues = [];
      }

      throw new AiPlannerError(
        "PLANNING_EXHAUSTED",
        "Replanner did not return a result",
        this.maxRepairCalls,
      );
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", cancel);
    }
  }
}
