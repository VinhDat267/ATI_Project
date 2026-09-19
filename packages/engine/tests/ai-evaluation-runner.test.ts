import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createReviewedCatalogSnapshot } from "../src/ai/catalog.js";
import { EvalConfigSchema } from "../src/ai/evaluation/contracts.js";
import { parseDataset } from "../src/ai/evaluation/dataset.js";
import {
  runOfflineEvaluation,
  scheduleTrials,
} from "../src/ai/evaluation/runner.js";
import type { StructuredModelClient } from "../src/ai/ports.js";
import type { ToolRetriever } from "../src/ai/retrieval.js";
import type { EngineTool } from "../src/snapshot.js";

const root = new URL("../../../", import.meta.url);
const dataset = JSON.parse(
  readFileSync(new URL("testdata/test-cases.json", root), "utf8"),
);
const manifest = JSON.parse(
  readFileSync(new URL("testdata/experiment-manifest.json", root), "utf8"),
);
const rawTools = JSON.parse(
  readFileSync(new URL("testdata/tools.json", root), "utf8"),
) as {
  servers: readonly {
    slug: EngineTool["server"];
    tools: readonly (Omit<EngineTool, "server" | "artifactHash"> & {
      description: string;
      evidence: string;
    })[];
  }[];
};
const evaluation = parseDataset(dataset, manifest);
const fullConfig = EvalConfigSchema.parse({
  mode: "offline",
  cells: [
    { variant: "all_tools", topK: 10 },
    { variant: "semantic", topK: 3 },
    { variant: "semantic", topK: 5 },
    { variant: "semantic", topK: 10 },
    { variant: "semantic_qe", topK: 3 },
    { variant: "semantic_qe", topK: 5 },
    { variant: "semantic_qe", topK: 10 },
  ],
  repetitions: 3,
  maxPlanningCalls: 3,
  deadlineMs: 1_000,
  modelFixture: "fixture-replay-v1",
  embeddingFixture: "offline-character-hash-v1",
  expansionFixture: "offline-identity-expansion-v1",
});
const catalog = createReviewedCatalogSnapshot(
  rawTools.servers.flatMap((server) =>
    server.tools.map(({ evidence: _evidence, ...tool }) => ({
      ...tool,
      server: server.slug,
      artifactHash: "a".repeat(64),
    })),
  ),
);

const allToolsRetriever: ToolRetriever = {
  async retrieve(input) {
    return {
      tools: catalog.tools,
      scores: [],
      variant: input.variant,
      topK: input.topK,
      queryHash: "b".repeat(64),
      latencyMs: 0,
    };
  },
};

it("schedules exactly seven cells and never relabels the all-tools control as K=3 or K=5", () => {
  const dev = evaluation.cases.filter((fixture) => fixture.split === "dev");
  const holdout = evaluation.cases.filter(
    (fixture) => fixture.split === "holdout",
  );

  expect(scheduleTrials(dev, fullConfig)).toHaveLength(126);
  expect(scheduleTrials(holdout, fullConfig)).toHaveLength(84);
  expect(
    scheduleTrials(dev, fullConfig).filter(
      (trial) => trial.cell.variant === "all_tools",
    ),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ cell: { variant: "all_tools", topK: 10 } }),
    ]),
  );
});

it("runs a full dev and holdout pass through AiPlannerAdapter without dispatching tools", async () => {
  const result = await runOfflineEvaluation({
    evaluation,
    registry: catalog.tools,
    retriever: allToolsRetriever,
    config: {
      mode: "offline",
      cells: [{ variant: "all_tools", topK: 10 }],
      repetitions: 3,
      maxPlanningCalls: 3,
      deadlineMs: 1_000,
      modelFixture: "fixture-replay-v1",
      embeddingFixture: "offline-character-hash-v1",
      expansionFixture: "offline-identity-expansion-v1",
    },
    modelFor: (fixture): StructuredModelClient => ({
      async complete() {
        return {
          output: fixture.expected_result,
          provider: "offline-synthetic",
          model: "fixture-replay-v1",
          usage: null,
          requestId: null,
        };
      },
    }),
  });

  expect(result).toMatchObject({
    verdict: "OFFLINE_HARNESS_PASS",
    evidenceKind: "OFFLINE_SYNTHETIC_REPLAY_NOT_MODEL_QUALITY",
    independentTaskCount: 10,
    holdoutExposure: "previously_exercised_by_offline_tests",
  });
  expect(result.cells).toEqual([{ variant: "all_tools", topK: 10 }]);
  expect(result.outcomes).toHaveLength(30);
  expect(result.outcomes.every((outcome) => outcome.model.provider === "offline-synthetic")).toBe(true);
  expect(result.outcomes.every((outcome) => outcome.score?.taskCorrect !== false)).toBe(true);
});

it("uses K=10 only for the all-tools control and does not count repetitions as independent tasks", async () => {
  await expect(
    runOfflineEvaluation({
      evaluation,
      registry: catalog.tools,
      retriever: allToolsRetriever,
      config: {
        mode: "offline",
        cells: [{ variant: "all_tools", topK: 3 }],
        repetitions: 3,
        maxPlanningCalls: 3,
        deadlineMs: 1_000,
        modelFixture: "fixture-replay-v1",
        embeddingFixture: "offline-character-hash-v1",
        expansionFixture: "offline-identity-expansion-v1",
      },
      modelFor: () => {
        throw new Error("must reject invalid matrix before dispatch");
      },
    }),
  ).rejects.toThrow(/all_tools.*10/i);
});
