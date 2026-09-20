import { describe, it, expect } from "vitest";
import {
  buildLiveEvaluationReport,
  renderLiveEvaluationMarkdown,
  nearestRank,
  computeLatencyPercentiles,
} from "../src/ai/live-evaluation/report.js";
import { scheduleLiveTrials } from "../src/ai/live-evaluation/schedule.js";
import type {
  LiveTrialOutcome,
  LiveEvaluationFingerprints,
  LiveEvaluationScore,
} from "../src/ai/live-evaluation/contracts.js";

const mockFingerprints: LiveEvaluationFingerprints = {
  dataset: "a".repeat(64),
  experimentManifest: "b".repeat(64),
  rubric: "c".repeat(64),
  catalog: "d".repeat(64),
  prompts: "e".repeat(64),
  evaluator: "f".repeat(64),
  config: "a".repeat(64),
  policiesAndArtifacts: "b".repeat(64),
  lockfile: "c".repeat(64),
};

function createMockScore(
  overrides?: Partial<LiveEvaluationScore>,
): LiveEvaluationScore {
  return {
    structuralValidity: true,
    fixtureExecutability: true,
    semanticJudgment: "correct",
    safetyViolations: [],
    reviewReason: null,
    candidateKind: "plan",
    kindCorrect: true,
    planValid: true,
    taskCorrect: true,
    outputCorrect: true,
    writeIntents: [],
    issues: [],
    toolRecall: 1.0,
    ...overrides,
  };
}

describe("ai-live-report", () => {
  it("computes nearestRank and latency percentiles correctly", () => {
    expect(nearestRank([], 0.5)).toBeNull();
    const latencies = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(nearestRank(latencies, 0.5)).toBe(50);
    expect(nearestRank(latencies, 0.9)).toBe(90);
    expect(nearestRank(latencies, 0.95)).toBe(100);

    const percentiles = computeLatencyPercentiles([10, 20, undefined, 30]);
    expect(percentiles.sampleCount).toBe(3);
    expect(percentiles.p50Ms).toBe(20);
  });

  it("builds a complete report with exact terminal accounting and PASS verdict", () => {
    const plannedTrials = scheduleLiveTrials(["openai-only"], ["b01"], {
      repetitions: 1,
    });
    expect(plannedTrials).toHaveLength(7);

    const outcomes: LiveTrialOutcome[] = plannedTrials.map((t) => ({
      trialId: t.trialId,
      profileId: t.profileId,
      caseId: t.caseId,
      exposure: "dev",
      cell: t.cell,
      repetition: t.repetition,
      status: "completed",
      modelCalls: [
        {
          callId: `call-${t.trialId}`,
          provider: "openai",
          model: "gpt-4o",
          purpose: "planning",
          status: "received",
          latencyMs: 150,
          costMicros: 2500,
          tokens: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
          errorCode: null,
        },
      ],
      score: createMockScore(),
      latency: {
        totalMs: 200,
        planningMs: 150,
        retrievalMs: 50,
      },
      error: null,
    }));

    const report = buildLiveEvaluationReport({
      runId: "run-test-01",
      createdAt: "2026-09-19T00:00:00.000Z",
      campaignId: "camp-01",
      freezeHash: "f".repeat(64),
      fingerprints: mockFingerprints,
      plannedTrials,
      outcomes,
      evidenceKind: "LIVE_PROVIDER",
      rubricStatus: "APPROVED_FROZEN",
      freezeMatches: true,
      indexCurrent: true,
      accountingReconciled: true,
    });

    expect(report.verdict).toBe("LIVE_EVALUATION_PASS");
    expect(report.trialAccounting.totalPlanned).toBe(7);
    expect(report.trialAccounting.completed).toBe(7);
    expect(report.trialAccounting.failed).toBe(0);
    expect(report.trialAccounting.cancelled).toBe(0);
    expect(report.trialAccounting.notStarted).toBe(0);

    // Profile & Cell breakdown
    expect(report.trialAccounting.byProfile["openai-only"]?.completed).toBe(7);
    expect(report.trialAccounting.byCell["all_tools@10"]?.completed).toBe(1);

    // Quality metrics
    expect(report.qualityMetrics.planValidRate).toBe(1.0);
    expect(report.qualityMetrics.semanticJudgments.correct).toBe(7);
    expect(report.qualityMetrics.semanticJudgments.incorrect).toBe(0);
    expect(report.qualityMetrics.retrievalRecall.value).toBe(1.0);

    // Latency
    expect(report.latency.planning.p50Ms).toBe(150);
    expect(report.latency.fullRetrieval.p50Ms).toBe(50);

    // Cost
    expect(report.costReconciliation.totalCalls).toBe(7);
    expect(report.costReconciliation.settledCostMicros).toBe(7 * 2500);
    expect(report.costReconciliation.unknownCostCalls).toBe(0);
    expect(report.costReconciliation.byProvider["openai"]?.calls).toBe(7);

    // Render markdown
    const md = renderLiveEvaluationMarkdown(report);
    expect(md).toContain("# AI Live Evaluation Report");
    expect(md).toContain("`LIVE_EVALUATION_PASS`");
    expect(md).toContain("`openai-only`");
  });

  it("yields LIVE_EVALUATION_PARTIAL when run was interrupted or incomplete", () => {
    const plannedTrials = scheduleLiveTrials(["openai-only"], ["b01", "b02"], {
      repetitions: 1,
    });
    expect(plannedTrials).toHaveLength(14);

    const outcomes: LiveTrialOutcome[] = plannedTrials.map((t, idx) => {
      if (idx === 0) {
        return {
          trialId: t.trialId,
          profileId: t.profileId,
          caseId: t.caseId,
          exposure: "dev",
          cell: t.cell,
          repetition: t.repetition,
          status: "completed",
          modelCalls: [],
          score: createMockScore(),
          latency: { totalMs: 100 },
          error: null,
        };
      }
      if (idx === 1) {
        return {
          trialId: t.trialId,
          profileId: t.profileId,
          caseId: t.caseId,
          exposure: "dev",
          cell: t.cell,
          repetition: t.repetition,
          status: "cancelled",
          modelCalls: [],
          score: null,
          latency: { totalMs: 50 },
          error: "Budget exceeded",
        };
      }
      return {
        trialId: t.trialId,
        profileId: t.profileId,
        caseId: t.caseId,
        exposure: "dev",
        cell: t.cell,
        repetition: t.repetition,
        status: "not_started",
        modelCalls: [],
        score: null,
        latency: { totalMs: 0 },
        error: "Execution halted",
      };
    });

    const report = buildLiveEvaluationReport({
      runId: "run-test-partial",
      createdAt: "2026-09-19T00:00:00.000Z",
      campaignId: "camp-partial",
      freezeHash: "f".repeat(64),
      fingerprints: mockFingerprints,
      plannedTrials,
      outcomes,
      haltReason: "Budget exceeded",
    });

    expect(report.verdict).toBe("LIVE_EVALUATION_PARTIAL");
    expect(report.trialAccounting.totalPlanned).toBe(14);
    expect(report.trialAccounting.completed).toBe(1);
    expect(report.trialAccounting.cancelled).toBe(1);
    expect(report.trialAccounting.notStarted).toBe(12);
    expect(report.limitations.some((l) => l.includes("incomplete"))).toBe(true);

    const md = renderLiveEvaluationMarkdown(report);
    expect(md).toContain("`LIVE_EVALUATION_PARTIAL`");
    expect(md).toContain("Budget exceeded");
  });

  it("reads durable usage fields and counts only repair purposes", () => {
    const plannedTrials = scheduleLiveTrials(["openai-only"], ["b01"], {
      repetitions: 1,
      cells: [{ variant: "all_tools", topK: 10 }],
    });
    const outcomes = plannedTrials.map((trial) => ({
      trialId: trial.trialId,
      profileId: trial.profileId,
      caseId: trial.caseId,
      exposure: "dev" as const,
      cell: trial.cell,
      repetition: trial.repetition,
      status: "completed" as const,
      modelCalls: [
        {
          callId: `${trial.trialId}-planning`,
          provider: "openai",
          model: "m",
          purpose: "planning",
          status: "succeeded",
          latencyMs: 10,
          costMicros: 1,
          tokens: null,
          errorCode: null,
        },
        {
          callId: `${trial.trialId}-qe`,
          provider: "openai",
          model: "m",
          purpose: "query_expansion",
          status: "succeeded",
          latencyMs: 3,
          costMicros: 1,
          tokens: null,
          errorCode: null,
        },
        {
          callId: `${trial.trialId}-repair`,
          provider: "openai",
          model: "m",
          purpose: "repair",
          status: "succeeded",
          latencyMs: 4,
          costMicros: 1,
          tokens: null,
          errorCode: null,
        },
      ],
      score: createMockScore(),
      latency: { totalMs: 20, planningMs: 10 },
      error: null,
    }));
    const report = buildLiveEvaluationReport({
      runId: "run-usage",
      createdAt: "2026-09-20T00:00:00.000Z",
      campaignId: "camp-usage",
      freezeHash: "f".repeat(64),
      fingerprints: mockFingerprints,
      plannedTrials,
      outcomes,
      ledgerRecords: [
        {
          callId: "durable-call",
          provider: "openai",
          model: "m",
          status: "succeeded",
          costMicros: 7,
          usage: { inputTokens: 11, outputTokens: 5, totalTokens: 16 },
        },
      ],
    });
    expect(report.qualityMetrics.totalRepairs).toBe(1);
    expect(report.costReconciliation.totalInputTokens).toBe(11);
    expect(report.costReconciliation.totalOutputTokens).toBe(5);
    expect(report.latency.planning.sampleCount).toBe(1);
  });

  it("blocks formal PASS for fake transport and proposed rubric evidence", () => {
    const plannedTrials = scheduleLiveTrials(["openai-only"], ["b01"], {
      repetitions: 1,
    });
    const outcomes: LiveTrialOutcome[] = plannedTrials.map((t) => ({
      trialId: t.trialId,
      profileId: t.profileId,
      caseId: t.caseId,
      exposure: "dev",
      cell: t.cell,
      repetition: t.repetition,
      status: "completed",
      modelCalls: [],
      score: createMockScore(),
      latency: { totalMs: 10 },
      error: null,
    }));
    const base = {
      runId: "run-blocked",
      createdAt: "2026-09-19T00:00:00.000Z",
      campaignId: "camp-blocked",
      freezeHash: "f".repeat(64),
      fingerprints: mockFingerprints,
      plannedTrials,
      outcomes,
      rubricStatus: "APPROVED_FROZEN" as const,
      freezeMatches: true,
      indexCurrent: true,
      accountingReconciled: true,
    };

    expect(
      buildLiveEvaluationReport({
        ...base,
        evidenceKind: "FAKE_TRANSPORT_TEST",
      }).verdict,
    ).toBe("LIVE_EVALUATION_BLOCKED");
    expect(
      buildLiveEvaluationReport({
        ...base,
        evidenceKind: "LIVE_PROVIDER",
        rubricStatus: "PROPOSED_EXPLORATORY",
      }).verdict,
    ).toBe("LIVE_EVALUATION_BLOCKED");
  });

  it("blocks formal PASS when pricing or reconciliation is unknown", () => {
    const plannedTrials = scheduleLiveTrials(["openai-only"], ["b01"], {
      repetitions: 1,
    });
    const outcomes: LiveTrialOutcome[] = plannedTrials.map((t) => ({
      trialId: t.trialId,
      profileId: t.profileId,
      caseId: t.caseId,
      exposure: "dev",
      cell: t.cell,
      repetition: t.repetition,
      status: "completed",
      modelCalls: [],
      score: createMockScore(),
      latency: { totalMs: 10 },
      error: null,
    }));
    const report = buildLiveEvaluationReport({
      runId: "run-unknown-cost",
      createdAt: "2026-09-19T00:00:00.000Z",
      campaignId: "camp-unknown-cost",
      freezeHash: "f".repeat(64),
      fingerprints: mockFingerprints,
      plannedTrials,
      outcomes,
      evidenceKind: "LIVE_PROVIDER",
      rubricStatus: "APPROVED_FROZEN",
      freezeMatches: true,
      indexCurrent: true,
      accountingReconciled: true,
      ledgerRecords: [
        {
          callId: "call-unknown",
          provider: "openai",
          model: "gpt-5.6-terra",
          status: "ambiguous",
          costMicros: null,
        },
      ],
    });

    expect(report.verdict).toBe("LIVE_EVALUATION_BLOCKED");
    expect(report.blockedReasons).toContain("unknown_cost");
  });

  it("yields LIVE_EVALUATION_FAIL when all trials complete but semantic score fails", () => {
    const plannedTrials = scheduleLiveTrials(["openai-only"], ["b01"], {
      repetitions: 1,
    });

    const outcomes: LiveTrialOutcome[] = plannedTrials.map((t, idx) => ({
      trialId: t.trialId,
      profileId: t.profileId,
      caseId: t.caseId,
      exposure: "dev",
      cell: t.cell,
      repetition: t.repetition,
      status: "completed",
      modelCalls: [],
      score: createMockScore({
        semanticJudgment: idx === 0 ? "incorrect" : "correct",
        toolRecall: 0.5,
      }),
      latency: { totalMs: 100 },
      error: null,
    }));

    const report = buildLiveEvaluationReport({
      runId: "run-test-fail",
      createdAt: "2026-09-19T00:00:00.000Z",
      campaignId: "camp-fail",
      freezeHash: "f".repeat(64),
      fingerprints: mockFingerprints,
      plannedTrials,
      outcomes,
    });

    expect(report.verdict).toBe("LIVE_EVALUATION_FAIL");
    expect(report.qualityMetrics.semanticJudgments.incorrect).toBe(1);
    expect(report.qualityMetrics.semanticJudgments.correct).toBe(6);
  });

  it("throws on duplicate or missing trial outcomes", () => {
    const plannedTrials = scheduleLiveTrials(["openai-only"], ["b01"], {
      repetitions: 1,
    });

    // Duplicate trialId
    expect(() =>
      buildLiveEvaluationReport({
        runId: "run-dup",
        createdAt: "2026-09-19T00:00:00.000Z",
        campaignId: "camp-dup",
        freezeHash: "f".repeat(64),
        fingerprints: mockFingerprints,
        plannedTrials,
        outcomes: [
          {
            trialId: plannedTrials[0]!.trialId,
            profileId: "openai-only",
            caseId: "b01",
            exposure: "dev",
            cell: plannedTrials[0]!.cell,
            repetition: 1,
            status: "completed",
            modelCalls: [],
            score: null,
            latency: { totalMs: 10 },
            error: null,
          },
          {
            trialId: plannedTrials[0]!.trialId, // duplicate!
            profileId: "openai-only",
            caseId: "b01",
            exposure: "dev",
            cell: plannedTrials[0]!.cell,
            repetition: 1,
            status: "completed",
            modelCalls: [],
            score: null,
            latency: { totalMs: 10 },
            error: null,
          },
        ],
      }),
    ).toThrow(/Duplicate evaluation trial outcome/);

    // Missing trial
    expect(() =>
      buildLiveEvaluationReport({
        runId: "run-missing",
        createdAt: "2026-09-19T00:00:00.000Z",
        campaignId: "camp-missing",
        freezeHash: "f".repeat(64),
        fingerprints: mockFingerprints,
        plannedTrials,
        outcomes: [
          {
            trialId: plannedTrials[0]!.trialId,
            profileId: "openai-only",
            caseId: "b01",
            exposure: "dev",
            cell: plannedTrials[0]!.cell,
            repetition: 1,
            status: "completed",
            modelCalls: [],
            score: null,
            latency: { totalMs: 10 },
            error: null,
          },
        ],
      }),
    ).toThrow(/Missing terminal accounting record/);
  });

  it("yields LIVE_EVALUATION_PARTIAL when transport failure is observed in scores", () => {
    const plannedTrials = scheduleLiveTrials(["openai-only"], ["b01"], {
      repetitions: 1,
    });

    const outcomes: LiveTrialOutcome[] = plannedTrials.map((t, idx) => ({
      trialId: t.trialId,
      profileId: t.profileId,
      caseId: t.caseId,
      exposure: "dev",
      cell: t.cell,
      repetition: t.repetition,
      status: "completed",
      modelCalls: [],
      score: createMockScore({
        safetyViolations:
          idx === 0
            ? ["Transport refusal cannot substitute for valid domain refusal"]
            : [],
      }),
      latency: { totalMs: 100, coldSetupMs: idx === 0 ? 45 : undefined },
      error: null,
    }));

    const report = buildLiveEvaluationReport({
      runId: "run-test-transport-fail",
      createdAt: "2026-09-19T00:00:00.000Z",
      campaignId: "camp-transport",
      freezeHash: "f".repeat(64),
      fingerprints: mockFingerprints,
      plannedTrials,
      outcomes,
    });

    expect(report.verdict).toBe("LIVE_EVALUATION_PARTIAL");
    expect(report.latency.coldSetup?.sampleCount).toBe(1);
    expect(report.latency.coldSetup?.p50Ms).toBe(45);
    expect(report.trialAccounting.bySplit?.["dev"]?.completed).toBe(7);
    expect(
      report.limitations.some((l) => l.includes("Transport failure/refusal")),
    ).toBe(true);

    const md = renderLiveEvaluationMarkdown(report);
    expect(md).toContain("Cold Setup");
  });
});
