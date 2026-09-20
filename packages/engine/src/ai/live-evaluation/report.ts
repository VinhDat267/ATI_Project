import type {
  LiveAccountingBucket,
  LiveCostReconciliation,
  LiveEvaluationFingerprints,
  LiveEvaluationReport,
  LiveLatencyBreakdown,
  LiveLatencyPercentiles,
  LiveQualityMetrics,
  LiveRedactedObservation,
  LiveTrialAccounting,
  LiveTrialOutcome,
  LiveTrialScheduleItem,
} from "./contracts.js";

export interface BuildLiveEvaluationReportOptions {
  readonly runId: string;
  readonly createdAt: string;
  readonly campaignId: string;
  readonly freezeHash: string;
  readonly fingerprints: LiveEvaluationFingerprints;
  readonly plannedTrials: readonly LiveTrialScheduleItem[];
  readonly outcomes: readonly LiveTrialOutcome[];
  readonly evidenceKind?: "LIVE_PROVIDER" | "FAKE_TRANSPORT_TEST";
  readonly rubricStatus?: "PROPOSED_EXPLORATORY" | "APPROVED_FROZEN";
  readonly freezeMatches?: boolean;
  readonly indexCurrent?: boolean;
  readonly accountingReconciled?: boolean;
  readonly ledgerRecords?: readonly {
    readonly callId: string;
    readonly runId?: string;
    readonly provider: string;
    readonly model: string;
    readonly status: string;
    readonly costMicros: number | null;
    readonly usage?: {
      readonly inputTokens?: number;
      readonly cachedInputTokens?: number;
      readonly outputTokens?: number;
      readonly reasoningTokens?: number;
      readonly totalTokens?: number;
    } | null;
    readonly tokens?: {
      readonly inputTokens?: number;
      readonly outputTokens?: number;
      readonly totalTokens?: number;
    } | null;
  }[];
  readonly haltReason?: string;
}

export function nearestRank(
  values: readonly number[],
  percentile: number,
): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(percentile * sorted.length) - 1]!;
}

export function computeLatencyPercentiles(
  values: readonly (number | undefined)[],
): LiveLatencyPercentiles {
  const valid = values.filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0,
  );
  return {
    sampleCount: valid.length,
    p50Ms: nearestRank(valid, 0.5),
    p90Ms: nearestRank(valid, 0.9),
    p95Ms: nearestRank(valid, 0.95),
  };
}

function emptyBucket(): LiveAccountingBucket {
  return {
    planned: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    notStarted: 0,
  };
}

export function buildLiveEvaluationReport(
  options: BuildLiveEvaluationReportOptions,
): LiveEvaluationReport {
  const plannedMap = new Map<string, LiveTrialScheduleItem>();
  for (const trial of options.plannedTrials) {
    plannedMap.set(trial.trialId, trial);
  }

  const seenTrialIds = new Set<string>();
  for (const outcome of options.outcomes) {
    if (seenTrialIds.has(outcome.trialId)) {
      throw new Error(`Duplicate evaluation trial outcome: ${outcome.trialId}`);
    }
    seenTrialIds.add(outcome.trialId);
    if (!plannedMap.has(outcome.trialId)) {
      throw new Error(
        `Unexpected outcome for un-scheduled trial: ${outcome.trialId}`,
      );
    }
  }

  // Exact terminal accounting: every scheduled trial must have an outcome
  for (const trial of options.plannedTrials) {
    if (!seenTrialIds.has(trial.trialId)) {
      throw new Error(
        `Missing terminal accounting record for scheduled trial: ${trial.trialId}`,
      );
    }
  }

  const totalPlanned = options.plannedTrials.length;
  const completed = options.outcomes.filter(
    (o) => o.status === "completed",
  ).length;
  const failed = options.outcomes.filter((o) => o.status === "failed").length;
  const cancelled = options.outcomes.filter(
    (o) => o.status === "cancelled",
  ).length;
  const notStarted = options.outcomes.filter(
    (o) => o.status === "not_started",
  ).length;

  if (totalPlanned !== completed + failed + cancelled + notStarted) {
    throw new Error(
      `Trial accounting mismatch: planned (${totalPlanned}) !== completed (${completed}) + failed (${failed}) + cancelled (${cancelled}) + notStarted (${notStarted})`,
    );
  }

  // Accounting by profile, cell, exposure
  const byProfile: Record<string, LiveAccountingBucket> = {};
  const byCell: Record<string, LiveAccountingBucket> = {};
  const byExposure: Record<string, LiveAccountingBucket> = {};

  for (const trial of options.plannedTrials) {
    const pKey = trial.profileId;
    const cKey = `${trial.cell.variant}@${trial.cell.topK}`;
    if (!byProfile[pKey]) byProfile[pKey] = emptyBucket();
    if (!byCell[cKey]) byCell[cKey] = emptyBucket();

    byProfile[pKey] = {
      ...byProfile[pKey]!,
      planned: byProfile[pKey]!.planned + 1,
    };
    byCell[cKey] = {
      ...byCell[cKey]!,
      planned: byCell[cKey]!.planned + 1,
    };
  }

  for (const outcome of options.outcomes) {
    const pKey = outcome.profileId;
    const cKey = `${outcome.cell.variant}@${outcome.cell.topK}`;
    const eKey = outcome.exposure;

    if (!byProfile[pKey]) byProfile[pKey] = emptyBucket();
    if (!byCell[cKey]) byCell[cKey] = emptyBucket();
    if (!byExposure[eKey]) byExposure[eKey] = emptyBucket();

    byExposure[eKey] = {
      ...byExposure[eKey]!,
      planned: byExposure[eKey]!.planned + 1,
    };

    const status = outcome.status;
    if (status === "completed") {
      byProfile[pKey] = {
        ...byProfile[pKey]!,
        completed: byProfile[pKey]!.completed + 1,
      };
      byCell[cKey] = {
        ...byCell[cKey]!,
        completed: byCell[cKey]!.completed + 1,
      };
      byExposure[eKey] = {
        ...byExposure[eKey]!,
        completed: byExposure[eKey]!.completed + 1,
      };
    } else if (status === "failed") {
      byProfile[pKey] = {
        ...byProfile[pKey]!,
        failed: byProfile[pKey]!.failed + 1,
      };
      byCell[cKey] = {
        ...byCell[cKey]!,
        failed: byCell[cKey]!.failed + 1,
      };
      byExposure[eKey] = {
        ...byExposure[eKey]!,
        failed: byExposure[eKey]!.failed + 1,
      };
    } else if (status === "cancelled") {
      byProfile[pKey] = {
        ...byProfile[pKey]!,
        cancelled: byProfile[pKey]!.cancelled + 1,
      };
      byCell[cKey] = {
        ...byCell[cKey]!,
        cancelled: byCell[cKey]!.cancelled + 1,
      };
      byExposure[eKey] = {
        ...byExposure[eKey]!,
        cancelled: byExposure[eKey]!.cancelled + 1,
      };
    } else if (status === "not_started") {
      byProfile[pKey] = {
        ...byProfile[pKey]!,
        notStarted: byProfile[pKey]!.notStarted + 1,
      };
      byCell[cKey] = {
        ...byCell[cKey]!,
        notStarted: byCell[cKey]!.notStarted + 1,
      };
      byExposure[eKey] = {
        ...byExposure[eKey]!,
        notStarted: byExposure[eKey]!.notStarted + 1,
      };
    }
  }

  const trialAccounting: LiveTrialAccounting = {
    totalPlanned,
    completed,
    failed,
    cancelled,
    notStarted,
    byProfile,
    byCell,
    byExposure,
    bySplit: byExposure,
  };

  // Verdict calculation
  const hasTransportFailure = options.outcomes.some((o) =>
    o.score?.safetyViolations.some((v) =>
      /transport|connection|network/i.test(v),
    ),
  );

  let verdict: LiveEvaluationReport["verdict"];
  if (failed > 0 || cancelled > 0 || notStarted > 0 || hasTransportFailure) {
    verdict = "LIVE_EVALUATION_PARTIAL";
  } else {
    const allPassed = options.outcomes.every(
      (o) => o.score?.semanticJudgment === "correct",
    );
    verdict = allPassed ? "LIVE_EVALUATION_PASS" : "LIVE_EVALUATION_FAIL";
  }

  // Quality metrics
  const completedOutcomes = options.outcomes.filter(
    (o) => o.status === "completed" && o.score !== null,
  );

  const planValidOutcomes = completedOutcomes.filter(
    (o) => o.score?.planValid !== null,
  );
  const planValidCount = planValidOutcomes.filter(
    (o) => o.score?.planValid === true,
  ).length;
  const planValidRate = planValidOutcomes.length
    ? planValidCount / planValidOutcomes.length
    : null;

  let correctCount = 0;
  let incorrectCount = 0;
  let needsReviewCount = 0;
  for (const o of completedOutcomes) {
    const j = o.score?.semanticJudgment;
    if (j === "correct") correctCount++;
    else if (j === "incorrect") incorrectCount++;
    else if (j === "needs_review") needsReviewCount++;
  }

  const refusalTrials = completedOutcomes.filter(
    (o) => o.score?.refusalCorrect !== undefined,
  );
  const correctRefusals = refusalTrials.filter(
    (o) => o.score?.refusalCorrect === true,
  ).length;

  const clarificationTrials = completedOutcomes.filter(
    (o) => o.score?.clarificationCorrect !== undefined,
  );
  const correctClarifications = clarificationTrials.filter(
    (o) => o.score?.clarificationCorrect === true,
  ).length;

  const recallTrials = completedOutcomes.filter(
    (o) => typeof o.score?.toolRecall === "number",
  );
  const totalRecall = recallTrials.reduce(
    (sum, o) => sum + (o.score?.toolRecall ?? 0),
    0,
  );
  const retrievalRecallValue = recallTrials.length
    ? totalRecall / recallTrials.length
    : null;

  let totalRepairs = 0;
  for (const o of completedOutcomes) {
    totalRepairs += o.modelCalls.filter(
      (call) => call.purpose === "repair" || call.purpose === "replan",
    ).length;
  }

  const qualityMetrics: LiveQualityMetrics = {
    planValidRate,
    semanticJudgments: {
      correct: correctCount,
      incorrect: incorrectCount,
      needsReview: needsReviewCount,
    },
    refusalAccuracy: {
      expected: refusalTrials.length,
      correct: correctRefusals,
      rate: refusalTrials.length
        ? correctRefusals / refusalTrials.length
        : null,
    },
    clarificationAccuracy: {
      expected: clarificationTrials.length,
      correct: correctClarifications,
      rate: clarificationTrials.length
        ? correctClarifications / clarificationTrials.length
        : null,
    },
    retrievalRecall: {
      total: totalRecall,
      denominator: recallTrials.length,
      value: retrievalRecallValue,
    },
    totalRepairs,
  };

  // Latency breakdown
  const latency: LiveLatencyBreakdown = {
    planning: computeLatencyPercentiles(
      options.outcomes.map((o) => o.latency.planningMs),
    ),
    fullRetrieval: computeLatencyPercentiles(
      options.outcomes.map((o) => o.latency.retrievalMs),
    ),
    queryExpansion: computeLatencyPercentiles(
      options.outcomes.map((o) => o.latency.queryExpansionMs),
    ),
    queryEmbedding: computeLatencyPercentiles(
      options.outcomes.map((o) => o.latency.embeddingMs),
    ),
    pgvector: computeLatencyPercentiles(
      options.outcomes.map((o) => o.latency.pgvectorMs),
    ),
    coldSetup: computeLatencyPercentiles(
      options.outcomes.map((o) => o.latency.coldSetupMs),
    ),
  };

  // Cost reconciliation
  const hasTaggedRecords = options.ledgerRecords?.some((r) => Boolean(r.runId));
  const runRecords = options.ledgerRecords?.filter((record) => {
    if (!options.runId) return true;
    if (record.runId) return record.runId === options.runId;
    return !hasTaggedRecords;
  });
  const allCalls = runRecords ?? options.outcomes.flatMap((o) => o.modelCalls);

  let settledCostMicros = 0;
  let unknownCostCalls = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const byProvider: Record<
    string,
    {
      calls: number;
      settledCostMicros: number;
      inputTokens: number;
      outputTokens: number;
    }
  > = {};

  for (const call of allCalls) {
    const prov = call.provider || "unknown";
    if (!byProvider[prov]) {
      byProvider[prov] = {
        calls: 0,
        settledCostMicros: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
    }

    byProvider[prov]!.calls++;

    if (call.costMicros !== null && call.costMicros !== undefined) {
      settledCostMicros += call.costMicros;
      byProvider[prov]!.settledCostMicros += call.costMicros;
    } else {
      unknownCostCalls++;
    }

    const usage = ("usage" in call ? call.usage : undefined) ?? call.tokens;
    const inTok = usage?.inputTokens ?? 0;
    const outTok = usage?.outputTokens ?? 0;
    totalInputTokens += inTok;
    totalOutputTokens += outTok;
    byProvider[prov]!.inputTokens += inTok;
    byProvider[prov]!.outputTokens += outTok;
  }

  const costReconciliation: LiveCostReconciliation = {
    totalCalls: allCalls.length,
    settledCostMicros,
    unknownCostCalls,
    totalInputTokens,
    totalOutputTokens,
    byProvider,
  };

  const evidenceKind = options.evidenceKind ?? "FAKE_TRANSPORT_TEST";
  const blockedReasons: string[] = [];
  if (evidenceKind !== "LIVE_PROVIDER") {
    blockedReasons.push("evidence_kind_not_live_provider");
  }
  if (options.rubricStatus !== "APPROVED_FROZEN") {
    blockedReasons.push("rubric_not_approved_frozen");
  }
  if (options.freezeMatches !== true) {
    blockedReasons.push("freeze_mismatch_or_unverified");
  }
  if (options.indexCurrent !== true) {
    blockedReasons.push("index_not_current_or_unverified");
  }
  if (options.accountingReconciled !== true) {
    blockedReasons.push("accounting_not_reconciled");
  }
  if (unknownCostCalls > 0) {
    blockedReasons.push("unknown_cost");
  }
  if (needsReviewCount > 0) {
    blockedReasons.push("semantic_needs_review");
  }
  if (verdict === "LIVE_EVALUATION_PASS" && blockedReasons.length > 0) {
    verdict = "LIVE_EVALUATION_BLOCKED";
  }
  const gateStatus: LiveEvaluationReport["gateStatus"] =
    verdict === "LIVE_EVALUATION_PASS" && blockedReasons.length === 0
      ? "FORMAL_PASS_ELIGIBLE"
      : "BLOCKED";

  // Redacted observations (sanitized, no prompt or output text)
  const observations: LiveRedactedObservation[] = options.outcomes.map((o) => ({
    trialId: o.trialId,
    profileId: o.profileId,
    caseId: o.caseId,
    exposure: o.exposure,
    cell: o.cell,
    repetition: o.repetition,
    status: o.status,
    score: o.score
      ? {
          semanticJudgment: o.score.semanticJudgment,
          planValid: o.score.planValid,
          kindCorrect: o.score.kindCorrect,
          recall: o.score.toolRecall ?? null,
        }
      : null,
    latencyMs: o.latency.totalMs,
    modelCallCount: o.modelCalls.length,
    error: o.error,
  }));

  const limitations: string[] = [
    "Pure-profile comparison is end-to-end evidence, not attribution to planner quality; all_tools controls across identical planners remain correlated observations.",
    "Repetitions within the same profile and cell are repeated observations under identical conditions, not independent tasks.",
    "No credentials, raw HTTP payloads, or unredacted generated strings are published in this report.",
  ];

  if (verdict === "LIVE_EVALUATION_PARTIAL") {
    limitations.push(
      "The evaluation run was incomplete (failed, cancelled, or not-started trials were observed). Quality cannot be certified as complete.",
    );
  }
  if (hasTransportFailure) {
    limitations.push(
      "Transport failure/refusal was observed in candidate responses; complete quality verdict is prohibited.",
    );
  }
  if (unknownCostCalls > 0) {
    limitations.push(
      `${unknownCostCalls} provider call(s) did not report exact pricing; cost ledger contains calls with unknown cost.`,
    );
  }
  if (blockedReasons.length > 0) {
    limitations.push(
      `Formal PASS is blocked by: ${blockedReasons.join(", ")}.`,
    );
  }

  return {
    format: "ati-ai-live-report-v1",
    runId: options.runId,
    createdAt: options.createdAt,
    campaignId: options.campaignId,
    verdict,
    evidenceKind,
    gateStatus,
    blockedReasons,
    freezeHash: options.freezeHash,
    fingerprints: options.fingerprints,
    trialAccounting,
    qualityMetrics,
    latency,
    costReconciliation,
    ...(options.haltReason ? { haltReason: options.haltReason } : {}),
    observations,
    limitations,
  };
}

export function renderLiveEvaluationMarkdown(
  report: LiveEvaluationReport,
): string {
  const formatRatio = (val: number | null) =>
    val === null ? "N/A" : `${(val * 100).toFixed(1)}%`;

  const lines: string[] = [];

  lines.push("# AI Live Evaluation Report");
  lines.push("");
  lines.push(`- **Run ID**: \`${report.runId}\``);
  lines.push(`- **Campaign**: \`${report.campaignId}\``);
  lines.push(`- **Created At**: ${report.createdAt}`);
  lines.push(`- **Verdict**: **\`${report.verdict}\`**`);
  lines.push(`- **Evidence Kind**: \`${report.evidenceKind}\``);
  lines.push(`- **Gate Status**: \`${report.gateStatus}\``);
  if (report.blockedReasons.length > 0) {
    lines.push(`- **Blocked Reasons**: ${report.blockedReasons.join(", ")}`);
  }
  lines.push(`- **Freeze Hash**: \`${report.freezeHash.slice(0, 16)}...\``);
  if (report.haltReason) {
    lines.push(`- **Halt Reason**: ${report.haltReason}`);
  }
  lines.push("");

  lines.push("## 1. Trial Accounting");
  lines.push("");
  lines.push("| Status | Count | Percentage |");
  lines.push("| :--- | :--- | :--- |");
  lines.push(
    `| **Planned** | **${report.trialAccounting.totalPlanned}** | 100.0% |`,
  );
  lines.push(
    `| Completed | ${report.trialAccounting.completed} | ${formatRatio(
      report.trialAccounting.totalPlanned
        ? report.trialAccounting.completed / report.trialAccounting.totalPlanned
        : 0,
    )} |`,
  );
  lines.push(
    `| Failed | ${report.trialAccounting.failed} | ${formatRatio(
      report.trialAccounting.totalPlanned
        ? report.trialAccounting.failed / report.trialAccounting.totalPlanned
        : 0,
    )} |`,
  );
  lines.push(
    `| Cancelled | ${report.trialAccounting.cancelled} | ${formatRatio(
      report.trialAccounting.totalPlanned
        ? report.trialAccounting.cancelled / report.trialAccounting.totalPlanned
        : 0,
    )} |`,
  );
  lines.push(
    `| Not Started | ${report.trialAccounting.notStarted} | ${formatRatio(
      report.trialAccounting.totalPlanned
        ? report.trialAccounting.notStarted /
            report.trialAccounting.totalPlanned
        : 0,
    )} |`,
  );
  lines.push("");

  lines.push("### Accounting by Profile");
  lines.push("");
  lines.push(
    "| Profile | Planned | Completed | Failed | Cancelled | Not Started |",
  );
  lines.push("| :--- | :--- | :--- | :--- | :--- | :--- |");
  for (const [profileId, b] of Object.entries(
    report.trialAccounting.byProfile,
  )) {
    lines.push(
      `| \`${profileId}\` | ${b.planned} | ${b.completed} | ${b.failed} | ${b.cancelled} | ${b.notStarted} |`,
    );
  }
  lines.push("");

  lines.push("### Accounting by Cell");
  lines.push("");
  lines.push(
    "| Cell | Planned | Completed | Failed | Cancelled | Not Started |",
  );
  lines.push("| :--- | :--- | :--- | :--- | :--- | :--- |");
  for (const [cellKey, b] of Object.entries(report.trialAccounting.byCell)) {
    lines.push(
      `| \`${cellKey}\` | ${b.planned} | ${b.completed} | ${b.failed} | ${b.cancelled} | ${b.notStarted} |`,
    );
  }
  lines.push("");

  lines.push("## 2. Quality Metrics");
  lines.push("");
  lines.push(
    `- **Plan Validity Rate**: ${formatRatio(report.qualityMetrics.planValidRate)}`,
  );
  lines.push(
    `- **Semantic Judgments**: Correct: ${report.qualityMetrics.semanticJudgments.correct}, Incorrect: ${report.qualityMetrics.semanticJudgments.incorrect}, Needs Review: ${report.qualityMetrics.semanticJudgments.needsReview}`,
  );
  lines.push(
    `- **Refusal Accuracy**: ${formatRatio(
      report.qualityMetrics.refusalAccuracy.rate,
    )} (${report.qualityMetrics.refusalAccuracy.correct}/${report.qualityMetrics.refusalAccuracy.expected})`,
  );
  lines.push(
    `- **Clarification Accuracy**: ${formatRatio(
      report.qualityMetrics.clarificationAccuracy.rate,
    )} (${report.qualityMetrics.clarificationAccuracy.correct}/${report.qualityMetrics.clarificationAccuracy.expected})`,
  );
  lines.push(
    `- **Retrieval Tool Recall**: ${formatRatio(
      report.qualityMetrics.retrievalRecall.value,
    )} (across ${report.qualityMetrics.retrievalRecall.denominator} applicable trials)`,
  );
  lines.push(`- **Total Repairs**: ${report.qualityMetrics.totalRepairs}`);
  lines.push("");

  lines.push("## 3. Latency Breakdown");
  lines.push("");
  lines.push("| Phase | Samples | p50 (ms) | p90 (ms) | p95 (ms) |");
  lines.push("| :--- | :--- | :--- | :--- | :--- |");
  const latencies = [
    { name: "End-to-End Planning", stat: report.latency.planning },
    { name: "Full Retrieval", stat: report.latency.fullRetrieval },
    { name: "Query Expansion", stat: report.latency.queryExpansion },
    { name: "Query Embedding", stat: report.latency.queryEmbedding },
    { name: "pgvector Search", stat: report.latency.pgvector },
    ...(report.latency.coldSetup
      ? [{ name: "Cold Setup", stat: report.latency.coldSetup }]
      : []),
  ];
  for (const l of latencies) {
    lines.push(
      `| ${l.name} | ${l.stat.sampleCount} | ${l.stat.p50Ms ?? "N/A"} | ${l.stat.p90Ms ?? "N/A"} | ${l.stat.p95Ms ?? "N/A"} |`,
    );
  }
  lines.push("");

  lines.push("## 4. Cost Ledger Reconciliation");
  lines.push("");
  lines.push(`- **Total Calls**: ${report.costReconciliation.totalCalls}`);
  lines.push(
    `- **Settled Cost**: $${(report.costReconciliation.settledCostMicros / 1_000_000).toFixed(4)} (${report.costReconciliation.settledCostMicros} micros)`,
  );
  lines.push(
    `- **Unknown Cost Calls**: ${report.costReconciliation.unknownCostCalls}`,
  );
  lines.push(
    `- **Total Input Tokens**: ${report.costReconciliation.totalInputTokens}`,
  );
  lines.push(
    `- **Total Output Tokens**: ${report.costReconciliation.totalOutputTokens}`,
  );
  lines.push("");

  lines.push("### Cost by Provider");
  lines.push("");
  lines.push(
    "| Provider | Calls | Settled Cost ($) | Input Tokens | Output Tokens |",
  );
  lines.push("| :--- | :--- | :--- | :--- | :--- |");
  for (const [provider, stat] of Object.entries(
    report.costReconciliation.byProvider,
  )) {
    lines.push(
      `| \`${provider}\` | ${stat.calls} | $${(stat.settledCostMicros / 1_000_000).toFixed(4)} | ${stat.inputTokens} | ${stat.outputTokens} |`,
    );
  }
  lines.push("");

  lines.push("## 5. Limitations");
  lines.push("");
  for (const lim of report.limitations) {
    lines.push(`- ${lim}`);
  }
  lines.push("");

  return lines.join("\n");
}
