import { expect, it } from "vitest";
import {
  buildOfflineEvaluationReport,
  renderOfflineEvaluationMarkdown,
} from "../src/ai/evaluation/report.js";
import type {
  OfflineEvaluationOutcome,
  OfflineEvaluationResult,
} from "../src/ai/evaluation/runner.js";

const emptyHash = "a".repeat(64);
const result: OfflineEvaluationResult = {
  verdict: "OFFLINE_HARNESS_PASS",
  evidenceKind: "OFFLINE_SYNTHETIC_REPLAY_NOT_MODEL_QUALITY",
  profile: "B-local-v1",
  independentTaskCount: 1,
  repetitionsPerTask: 3,
  holdoutExposure: "previously_exercised_by_offline_tests",
  cells: [{ variant: "all_tools", topK: 10 }],
  outcomes: [1, 2, 3].map((repetition) => ({
    caseId: "b01",
    split: "dev" as const,
    expectedKind: "plan" as const,
    variant: "all_tools" as const,
    topK: 10 as const,
    repetition,
    model: {
      provider: "offline-synthetic",
      name: "fixture-replay-v1",
      calls: [
        {
          runId: "fixture-run",
          attempt: 1,
          status: "received" as const,
          latencyMs: repetition * 10,
          provider: "offline-synthetic",
          model: "fixture-replay-v1",
          requestId: null,
          usage: null,
        },
      ],
    },
    retrieval: {
      requestedTopK: 10,
      returnedToolCount: 10,
      selectedToolIdentities: ["task_hub.list_cards"],
      recall: 1,
    },
    score: {
      outcomeValid: true,
      candidateKind: "plan" as const,
      kindCorrect: true,
      planValid: true,
      taskCorrect: true,
      outputCorrect: true,
      writeIntents: [],
      issues: [],
    },
    plannerError: "Bearer canary-secret-never-report",
  })),
};

it("separates the harness result from a live AI-quality verdict and preserves repetition denominators", () => {
  const plannerFailure: OfflineEvaluationOutcome = {
    ...result.outcomes[0]!,
    repetition: 4,
    model: { provider: null, name: null, calls: [] },
    retrieval: {
      requestedTopK: result.outcomes[0]!.retrieval.requestedTopK,
      returnedToolCount: null,
      selectedToolIdentities: [],
      recall: null,
    },
    score: null,
    plannerError: "Bearer canary-secret-never-report",
  };
  const report = buildOfflineEvaluationReport({
    result: { ...result, outcomes: [...result.outcomes, plannerFailure] },
    runId: "ai04-test-run",
    createdAt: "2026-09-18T00:00:00.000Z",
    freezeHash: emptyHash,
    fingerprints: {
      dataset: emptyHash,
      experimentManifest: emptyHash,
      catalog: emptyHash,
      prompts: emptyHash,
      evaluator: emptyHash,
      fixtures: emptyHash,
      config: emptyHash,
      policiesAndArtifacts: emptyHash,
      lockfile: emptyHash,
    },
  });
  const markdown = renderOfflineEvaluationMarkdown(report);

  expect(report).toMatchObject({
    harnessVerdict: "OFFLINE_HARNESS_PASS",
    aiEvaluationVerdict: "AI_EVALUATION_NOT_RUN",
    fixtureScenario: "oracle_replay",
    summary: {
      uniqueCaseCount: 1,
      observationCount: 4,
      totalPlanningCalls: 3,
      taskCorrect: { numerator: 3, denominator: 4, value: 0.75 },
      retrievalRecall: { total: 3, denominator: 4, value: 0.75 },
      byCellAndSplit: [
        {
          split: "dev",
          cell: { variant: "all_tools", topK: 10 },
          uniqueCaseCount: 1,
          observationCount: 4,
          totalPlanningCalls: 3,
          taskCorrect: { numerator: 3, denominator: 4, value: 0.75 },
          retrievalRecall: { total: 3, denominator: 4, value: 0.75 },
        },
      ],
    },
  });
  expect(markdown).toContain("AI_EVALUATION_NOT_RUN");
  expect(markdown).toContain("oracle_replay");
  expect(markdown).toContain("not model-quality evidence");
  expect(JSON.stringify(report)).not.toContain("canary-secret-never-report");
  expect(markdown).not.toContain("canary-secret-never-report");
});

it("fails closed when a trial is duplicated", () => {
  expect(() =>
    buildOfflineEvaluationReport({
      result: { ...result, outcomes: [...result.outcomes, result.outcomes[0]!] },
      runId: "ai04-test-run",
      createdAt: "2026-09-18T00:00:00.000Z",
      freezeHash: emptyHash,
      fingerprints: {
        dataset: emptyHash,
        experimentManifest: emptyHash,
        catalog: emptyHash,
        prompts: emptyHash,
        evaluator: emptyHash,
        fixtures: emptyHash,
        config: emptyHash,
        policiesAndArtifacts: emptyHash,
        lockfile: emptyHash,
      },
    }),
  ).toThrow(/duplicate/i);
});
