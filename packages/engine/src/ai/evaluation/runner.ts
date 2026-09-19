/**
 * Offline-only orchestration for AI-04.
 *
 * The runner intentionally has no gateway, database, receiver, filesystem, or
 * network dependency. Read fixtures are interpreted by the scorer; writes are
 * collected as intents and are never dispatched.
 */
import { buildRuntime, type PlannerResult, type TrustedTool } from "@wap/dsl";
import { AiPlannerAdapter, type ModelCallEvidence } from "../planner.js";
import type { StructuredModelClient } from "../ports.js";
import type { RetrievalResult, ToolRetriever } from "../retrieval.js";
import {
  EvalConfigSchema,
  type EvalCase,
  type EvalConfig,
  type EvaluationDataset,
  type EvaluationRuntime,
  type RetrievalVariant,
  type Split,
} from "./contracts.js";
import {
  retrievalRecall,
  scoreCandidate,
  type EvaluationScore,
} from "./scorer.js";

export interface EvaluationCell {
  readonly variant: RetrievalVariant;
  readonly topK: 3 | 5 | 10;
}

export interface OfflineEvaluationTrial {
  readonly caseId: string;
  readonly split: "dev" | "holdout";
  readonly cell: EvaluationCell;
  /** One-based; repetitions are repeated measurements, not new tasks. */
  readonly repetition: number;
}

export interface OfflineEvaluationOutcome {
  readonly caseId: string;
  readonly split: "dev" | "holdout";
  readonly expectedKind: "plan" | "refusal" | "clarification";
  readonly variant: RetrievalVariant;
  readonly topK: 3 | 5 | 10;
  readonly repetition: number;
  readonly model: {
    readonly provider: string | null;
    readonly name: string | null;
    readonly calls: readonly ModelCallEvidence[];
  };
  readonly retrieval: {
    readonly requestedTopK: 3 | 5 | 10;
    readonly returnedToolCount: number | null;
    readonly selectedToolIdentities: readonly string[];
    readonly recall: number | null;
  };
  readonly score: EvaluationScore | null;
  /** Kept concise and never contains raw prompt or model response content. */
  readonly plannerError: string | null;
}

export interface OfflineEvaluationResult {
  readonly verdict: "OFFLINE_HARNESS_PASS" | "OFFLINE_HARNESS_FAIL";
  readonly evidenceKind: "OFFLINE_SYNTHETIC_REPLAY_NOT_MODEL_QUALITY";
  readonly profile: "B-local-v1";
  readonly independentTaskCount: number;
  readonly repetitionsPerTask: number;
  readonly holdoutExposure: "previously_exercised_by_offline_tests";
  readonly cells: readonly EvaluationCell[];
  readonly outcomes: readonly OfflineEvaluationOutcome[];
}

export interface OfflineEvaluationOptions {
  readonly evaluation: EvaluationDataset;
  /** Omit only for an internal whole-dataset smoke run; CLI always selects one split. */
  readonly split?: Split;
  readonly registry: readonly TrustedTool[];
  readonly retriever: ToolRetriever;
  readonly config: unknown;
  /**
   * A caller supplies the model adapter explicitly. The CLI's implementation is
   * a labelled fixture replay, never a provider-backed quality measurement.
   */
  readonly modelFor: (
    fixture: EvalCase,
    cell: EvaluationCell,
    repetition: number,
  ) => StructuredModelClient;
}

function buildCells(config: EvalConfig): readonly EvaluationCell[] {
  const seen = new Set<string>();
  for (const cell of config.cells) {
    if (cell.variant === "all_tools" && cell.topK !== 10)
      throw new Error("all_tools control requires topK 10");
    const key = `${cell.variant}:${cell.topK}`;
    if (seen.has(key)) throw new Error(`duplicate evaluation cell: ${key}`);
    seen.add(key);
  }
  return config.cells;
}

/** Build the fixed serial matrix without executing providers or tools. */
export function scheduleTrials(
  cases: readonly EvalCase[],
  config: EvalConfig,
): readonly OfflineEvaluationTrial[] {
  const trials: OfflineEvaluationTrial[] = [];
  for (const fixture of cases) {
    for (const cell of buildCells(config)) {
      for (let repetition = 1; repetition <= config.repetitions; repetition++)
        trials.push({
          caseId: fixture.id,
          split: fixture.split,
          cell,
          repetition,
        });
    }
  }
  return trials;
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 500);
}

function plannerRuntime(runtime: EvaluationRuntime): Record<string, string> {
  return buildRuntime({
    now: new Date(runtime.now),
    runId: runtime.run_id,
    userId: runtime.user_id,
    timeZone: runtime.time_zone,
  });
}

async function executeOne(input: {
  fixture: EvalCase;
  cell: EvaluationCell;
  repetition: number;
  runtime: EvaluationRuntime;
  registry: readonly TrustedTool[];
  retriever: ToolRetriever;
  model: StructuredModelClient;
  maxPlanningCalls: 3;
  deadlineMs: number;
}): Promise<OfflineEvaluationOutcome> {
  const calls: ModelCallEvidence[] = [];
  const captured = { retrieval: null as RetrievalResult | null };
  const observingRetriever: ToolRetriever = {
    async retrieve(request) {
      const result = await input.retriever.retrieve(request);
      captured.retrieval = result;
      return result;
    },
  };
  const planner = new AiPlannerAdapter({
    retriever: observingRetriever,
    model: input.model,
    variant: input.cell.variant,
    topK: input.cell.topK,
    maxPlanningCalls: input.maxPlanningCalls,
    deadlineMs: input.deadlineMs,
    validatePlan: () => [],
    onModelCall: (event) => calls.push(event),
  });
  let candidate: PlannerResult | null = null;
  let plannerError: string | null = null;
  try {
    candidate = await planner.produce({
      runId: `${input.runtime.run_id}:${input.fixture.id}:${input.cell.variant}:${input.cell.topK}:${input.repetition}`,
      userId: input.runtime.user_id,
      request: {
        source_prompt: input.fixture.prompt,
        inputs: {},
        time_zone: input.runtime.time_zone,
      },
      runtime: plannerRuntime(input.runtime),
    });
  } catch (error) {
    plannerError = safeMessage(error);
  }

  const latest = calls.at(-1);
  const selectedToolIdentities = (captured.retrieval?.tools ?? []).map(
    (tool) => `${tool.server}.${tool.name}`,
  );
  const goldToolIdentities =
    input.fixture.expected_result.kind === "plan"
      ? input.fixture.expected_result.plan.steps.map(
          (step) => `${step.tool.server}.${step.tool.name}`,
        )
      : [];
  return {
    caseId: input.fixture.id,
    split: input.fixture.split,
    expectedKind: input.fixture.expected_result.kind,
    variant: input.cell.variant,
    topK: input.cell.topK,
    repetition: input.repetition,
    model: {
      provider: latest?.provider ?? null,
      name: latest?.model ?? null,
      calls,
    },
    retrieval: {
      requestedTopK: input.cell.topK,
      returnedToolCount: captured.retrieval?.tools.length ?? null,
      selectedToolIdentities,
      recall: retrievalRecall(selectedToolIdentities, goldToolIdentities),
    },
    score: candidate
      ? scoreCandidate({
          fixture: input.fixture,
          runtime: input.runtime,
          registry: input.registry,
          candidate,
        })
      : null,
    plannerError,
  };
}

/**
 * Runs the configured evaluation matrix serially for repeatable, reviewable
 * evidence. A harness pass means the complete offline matrix was executed; it
 * is explicitly not a claim about any live model's quality.
 */
export async function runOfflineEvaluation(
  options: OfflineEvaluationOptions,
): Promise<OfflineEvaluationResult> {
  const config = EvalConfigSchema.parse(options.config);
  const cells = buildCells(config);
  const outcomes: OfflineEvaluationOutcome[] = [];
  const selectedCases = options.split
    ? options.evaluation.cases.filter((item) => item.split === options.split)
    : options.evaluation.cases;
  if (!selectedCases.length)
    throw new Error(`evaluation split has no cases: ${options.split ?? "all"}`);
  const fixtures = new Map(selectedCases.map((item) => [item.id, item]));
  for (const trial of scheduleTrials(selectedCases, config)) {
    const fixture = fixtures.get(trial.caseId);
    if (!fixture) throw new Error(`scheduled fixture is missing: ${trial.caseId}`);
    outcomes.push(
      await executeOne({
        fixture,
        cell: trial.cell,
        repetition: trial.repetition,
        runtime: options.evaluation.runtime,
        registry: options.registry,
        retriever: options.retriever,
        model: options.modelFor(fixture, trial.cell, trial.repetition),
        maxPlanningCalls: config.maxPlanningCalls,
        deadlineMs: config.deadlineMs,
      }),
    );
  }
  const expectedOutcomes =
    selectedCases.length * cells.length * config.repetitions;
  return {
    verdict:
      outcomes.length === expectedOutcomes
        ? "OFFLINE_HARNESS_PASS"
        : "OFFLINE_HARNESS_FAIL",
    evidenceKind: "OFFLINE_SYNTHETIC_REPLAY_NOT_MODEL_QUALITY",
    profile: options.evaluation.profile,
    independentTaskCount: selectedCases.length,
    repetitionsPerTask: config.repetitions,
    holdoutExposure: "previously_exercised_by_offline_tests",
    cells,
    outcomes,
  };
}
