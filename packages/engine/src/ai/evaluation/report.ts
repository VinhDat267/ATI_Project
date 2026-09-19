/** Pure, redacted report building for the offline evaluator. */
import type { Fingerprints } from "./contracts.js";
import type {
  OfflineEvaluationOutcome,
  OfflineEvaluationResult,
} from "./runner.js";

export interface Ratio {
  readonly numerator: number;
  readonly denominator: number;
  readonly value: number | null;
}

export interface TimingSummary {
  readonly sampleCount: number;
  readonly p50Ms: number | null;
  readonly p95Ms: number | null;
  readonly scope: "offline_in_process_planning_calls_only";
}

export interface RecallSummary {
  readonly total: number;
  readonly denominator: number;
  readonly value: number | null;
}

export interface EvaluationMetricSummary {
  readonly kindCorrect: Ratio;
  readonly planValid: Ratio;
  readonly taskCorrect: Ratio;
  readonly retrievalRecall: RecallSummary;
  readonly plannerErrors: number;
  readonly totalPlanningCalls: number;
  readonly timing: TimingSummary;
}

export interface EvaluationCellSplitSummary extends EvaluationMetricSummary {
  readonly split: "dev" | "holdout";
  readonly cell: { readonly variant: string; readonly topK: number };
  readonly uniqueCaseCount: number;
  readonly observationCount: number;
}

export interface OfflineEvaluationSummary extends EvaluationMetricSummary {
  readonly uniqueCaseCount: number;
  readonly observationCount: number;
  readonly bySplit: Readonly<
    Record<"dev" | "holdout", { uniqueCaseCount: number; observationCount: number }>
  >;
  readonly byCellAndSplit: readonly EvaluationCellSplitSummary[];
}

export interface RedactedObservation {
  readonly caseId: string;
  readonly split: "dev" | "holdout";
  readonly cell: { readonly variant: string; readonly topK: number };
  readonly repetition: number;
  readonly status: "completed" | "planner_error";
  readonly model: {
    readonly provider: string | null;
    readonly name: string | null;
    readonly planningCallCount: number;
  };
  readonly retrieval: {
    readonly requestedTopK: number;
    readonly returnedToolCount: number | null;
    readonly recall: number | null;
  };
  readonly metrics: {
    readonly outcomeValid: boolean | null;
    readonly kindCorrect: boolean | null;
    readonly planValid: boolean | null;
    readonly taskCorrect: boolean | null;
    readonly outputCorrect: boolean | null;
  };
}

export interface OfflineEvaluationReport {
  readonly format: "ati-ai04-offline-report-v1";
  readonly mode: "offline";
  readonly runId: string;
  readonly createdAt: string;
  readonly harnessVerdict: "OFFLINE_HARNESS_PASS" | "OFFLINE_HARNESS_FAIL";
  readonly aiEvaluationVerdict: "AI_EVALUATION_NOT_RUN";
  readonly evidenceKind: "OFFLINE_SYNTHETIC_REPLAY_NOT_MODEL_QUALITY";
  /** Synthetic model responses replay the fixture oracle; no live quality is measured. */
  readonly fixtureScenario: "oracle_replay";
  readonly freezeHash: string;
  readonly fingerprints: Fingerprints;
  readonly holdoutExposure: "previously_exercised_by_offline_tests";
  readonly summary: OfflineEvaluationSummary;
  readonly observations: readonly RedactedObservation[];
  readonly limitations: readonly string[];
}

export interface BuildOfflineEvaluationReportOptions {
  readonly result: OfflineEvaluationResult;
  readonly runId: string;
  readonly createdAt: string;
  readonly freezeHash: string;
  readonly fingerprints: Fingerprints;
}

function ratio(values: readonly boolean[]): Ratio {
  const denominator = values.length;
  const numerator = values.filter(Boolean).length;
  return { numerator, denominator, value: denominator ? numerator / denominator : null };
}

function nearestRank(values: readonly number[], percentile: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(percentile * sorted.length) - 1]!;
}

function trialKey(outcome: OfflineEvaluationOutcome): string {
  return `${outcome.caseId}:${outcome.split}:${outcome.variant}:${outcome.topK}:${outcome.repetition}`;
}

function metricsFor(
  outcomes: readonly OfflineEvaluationOutcome[],
): EvaluationMetricSummary {
  const expectedPlanOutcomes = outcomes.filter(
    (outcome) => outcome.expectedKind === "plan",
  );
  // An expected-plan trial without a retrieval result is a recall failure. It
  // remains in the denominator rather than disappearing from the report.
  const recalls = expectedPlanOutcomes.map(
    (outcome) => outcome.retrieval.recall ?? 0,
  );
  const latencies = outcomes.flatMap((outcome) =>
    outcome.model.calls.map((call) => call.latencyMs).filter(Number.isFinite),
  );
  return {
    kindCorrect: ratio(
      outcomes.map((outcome) => outcome.score?.kindCorrect ?? false),
    ),
    planValid: ratio(
      expectedPlanOutcomes.map((outcome) => outcome.score?.planValid ?? false),
    ),
    taskCorrect: ratio(
      expectedPlanOutcomes.map((outcome) => outcome.score?.taskCorrect ?? false),
    ),
    retrievalRecall: {
      total: recalls.reduce((sum, value) => sum + value, 0),
      denominator: expectedPlanOutcomes.length,
      value: expectedPlanOutcomes.length
        ? recalls.reduce((sum, value) => sum + value, 0) / expectedPlanOutcomes.length
        : null,
    },
    plannerErrors: outcomes.filter((outcome) => outcome.plannerError !== null).length,
    totalPlanningCalls: outcomes.reduce(
      (sum, outcome) => sum + outcome.model.calls.length,
      0,
    ),
    timing: {
      sampleCount: latencies.length,
      p50Ms: nearestRank(latencies, 0.5),
      p95Ms: nearestRank(latencies, 0.95),
      scope: "offline_in_process_planning_calls_only",
    },
  };
}

function summarizeByCellAndSplit(
  outcomes: readonly OfflineEvaluationOutcome[],
): readonly EvaluationCellSplitSummary[] {
  const buckets = new Map<string, OfflineEvaluationOutcome[]>();
  for (const outcome of outcomes) {
    const key = `${outcome.split}:${outcome.variant}:${outcome.topK}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(outcome);
    buckets.set(key, bucket);
  }
  return [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, rows]) => {
      const first = rows[0]!;
      return {
        split: first.split,
        cell: { variant: first.variant, topK: first.topK },
        uniqueCaseCount: new Set(rows.map((outcome) => outcome.caseId)).size,
        observationCount: rows.length,
        ...metricsFor(rows),
      };
    });
}

function redact(outcome: OfflineEvaluationOutcome): RedactedObservation {
  const score = outcome.score;
  return {
    caseId: outcome.caseId,
    split: outcome.split,
    cell: { variant: outcome.variant, topK: outcome.topK },
    repetition: outcome.repetition,
    status: outcome.plannerError ? "planner_error" : "completed",
    model: {
      provider: outcome.model.provider,
      name: outcome.model.name,
      planningCallCount: outcome.model.calls.length,
    },
    retrieval: {
      requestedTopK: outcome.retrieval.requestedTopK,
      returnedToolCount: outcome.retrieval.returnedToolCount,
      recall: outcome.retrieval.recall,
    },
    metrics: {
      outcomeValid: score?.outcomeValid ?? null,
      kindCorrect: score?.kindCorrect ?? null,
      planValid: score?.planValid ?? null,
      taskCorrect: score?.taskCorrect ?? null,
      outputCorrect: score?.outputCorrect ?? null,
    },
  };
}

/** Build a validated-denominator report without serializing prompts, outputs, or errors. */
export function buildOfflineEvaluationReport(
  options: BuildOfflineEvaluationReportOptions,
): OfflineEvaluationReport {
  const outcomes = options.result.outcomes;
  if (!outcomes.length) throw new Error("offline evaluation report requires observations");
  const keys = new Set<string>();
  for (const outcome of outcomes) {
    const key = trialKey(outcome);
    if (keys.has(key)) throw new Error(`duplicate evaluation trial: ${key}`);
    keys.add(key);
  }

  const bySplit = (split: "dev" | "holdout") => {
    const rows = outcomes.filter((outcome) => outcome.split === split);
    return {
      uniqueCaseCount: new Set(rows.map((outcome) => outcome.caseId)).size,
      observationCount: rows.length,
    };
  };
  const summary: OfflineEvaluationSummary = {
    uniqueCaseCount: new Set(outcomes.map((outcome) => outcome.caseId)).size,
    observationCount: outcomes.length,
    bySplit: { dev: bySplit("dev"), holdout: bySplit("holdout") },
    byCellAndSplit: summarizeByCellAndSplit(outcomes),
    ...metricsFor(outcomes),
  };

  return {
    format: "ati-ai04-offline-report-v1",
    mode: "offline",
    runId: options.runId,
    createdAt: options.createdAt,
    harnessVerdict: options.result.verdict,
    aiEvaluationVerdict: "AI_EVALUATION_NOT_RUN",
    evidenceKind: options.result.evidenceKind,
    fixtureScenario: "oracle_replay",
    freezeHash: options.freezeHash,
    fingerprints: options.fingerprints,
    holdoutExposure: options.result.holdoutExposure,
    summary,
    observations: outcomes.map(redact),
    limitations: [
      "Offline synthetic replay validates evaluator wiring only; it is not model-quality evidence.",
      "No provider, gateway, MCP receiver, database, or external network was called by this report.",
      "Holdout cases were previously exercised by offline tests and are not claimed as untouched.",
      "Recovery, paid usage, provider latency, and live semantic quality remain NOT_RUN.",
    ],
  };
}

/** A short human review surface generated solely from the redacted JSON report. */
export function renderOfflineEvaluationMarkdown(
  report: OfflineEvaluationReport,
): string {
  const ratioText = (value: Ratio) =>
    value.value === null
      ? `N/A (${value.numerator}/${value.denominator})`
      : `${(value.value * 100).toFixed(1)}% (${value.numerator}/${value.denominator})`;
  return [
    "# AI-04 Offline Evaluation",
    "",
    `- Harness verdict: \`${report.harnessVerdict}\``,
    `- Live AI evaluation: \`${report.aiEvaluationVerdict}\``,
    `- Evidence kind: \`${report.evidenceKind}\` (not model-quality evidence)`,
    `- Fixture scenario: \`${report.fixtureScenario}\` (synthetic expected-result replay).`,
    `- Unique cases: ${report.summary.uniqueCaseCount}; observations: ${report.summary.observationCount}; repetitions are not independent tasks.`,
    `- Dev: ${report.summary.bySplit.dev.uniqueCaseCount} cases / ${report.summary.bySplit.dev.observationCount} observations; holdout: ${report.summary.bySplit.holdout.uniqueCaseCount} / ${report.summary.bySplit.holdout.observationCount}.`,
    `- Kind correctness: ${ratioText(report.summary.kindCorrect)}`,
    `- Plan validity: ${ratioText(report.summary.planValid)}`,
    `- Fixture-task correctness: ${ratioText(report.summary.taskCorrect)}`,
    `- Retrieval macro recall: ${report.summary.retrievalRecall.value === null ? "N/A" : `${(report.summary.retrievalRecall.value * 100).toFixed(1)}%`} across ${report.summary.retrievalRecall.denominator} applicable observations.`,
    `- Planning calls: ${report.summary.totalPlanningCalls}; planner errors: ${report.summary.plannerErrors}.`,
    `- Timing: ${report.summary.timing.sampleCount} offline in-process planning-call samples; p50=${report.summary.timing.p50Ms ?? "N/A"}ms, p95=${report.summary.timing.p95Ms ?? "N/A"}ms.`,
    "",
    "## Split × retrieval cell",
    "",
    ...report.summary.byCellAndSplit.map(
      (slice) =>
        `- ${slice.split} / ${slice.cell.variant}@${slice.cell.topK}: ${slice.uniqueCaseCount} cases, ${slice.observationCount} observations, task=${ratioText(slice.taskCorrect)}, recall=${slice.retrievalRecall.value === null ? "N/A" : `${(slice.retrievalRecall.value * 100).toFixed(1)}%`} (${slice.retrievalRecall.denominator}), calls=${slice.totalPlanningCalls}, planner errors=${slice.plannerErrors}.`,
    ),
    "",
    "## Limitations",
    "",
    ...report.limitations.map((item) => `- ${item}`),
    "",
  ].join("\n");
}
