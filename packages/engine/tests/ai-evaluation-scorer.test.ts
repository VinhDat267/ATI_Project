import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import type { TrustedTool } from "@wap/dsl";
import {
  retrievalRecall,
  scoreCandidate,
  type EvaluationScore,
} from "../src/ai/evaluation/scorer.js";
import { parseDataset } from "../src/ai/evaluation/dataset.js";

const root = new URL("../../../", import.meta.url);
const dataset = JSON.parse(
  readFileSync(new URL("testdata/test-cases.json", root), "utf8"),
);
const manifest = JSON.parse(
  readFileSync(new URL("testdata/experiment-manifest.json", root), "utf8"),
);
const tools = JSON.parse(
  readFileSync(new URL("testdata/tools.json", root), "utf8"),
) as {
  servers: readonly { slug: string; tools: readonly Omit<TrustedTool, "server">[] }[];
};
const registry: readonly TrustedTool[] = tools.servers.flatMap((server) =>
  server.tools.map((tool) => ({ ...tool, server: server.slug })),
);
const evaluation = parseDataset(dataset, manifest);
const b02 = evaluation.cases.find((fixture) => fixture.id === "b02")!;

function score(candidate: unknown): EvaluationScore {
  return scoreCandidate({
    fixture: b02,
    runtime: evaluation.runtime,
    registry,
    candidate,
  });
}

it("accepts the hand-authored plan only when it reaches the expected writes and outputs", () => {
  const result = score(b02.expected_result);

  expect(result).toMatchObject({
    outcomeValid: true,
    kindCorrect: true,
    planValid: true,
    taskCorrect: true,
    outputCorrect: true,
    issues: [],
  });
  expect(result.writeIntents).toEqual(b02.expected_writes);
});

it("rejects a structurally valid plan that targets the wrong recipient", () => {
  const candidate = structuredClone(b02.expected_result);
  if (candidate.kind !== "plan") throw new Error("b02 must be a plan fixture");
  candidate.plan.steps[2]!.tool.args.channel = "#wrong";

  const result = score(candidate);

  expect(result.planValid).toBe(true);
  expect(result.taskCorrect).toBe(false);
  expect(result.issues.join(" ")).toMatch(/write intents/i);
});

it("rejects lost rows even when the plan remains schema and policy valid", () => {
  const candidate = structuredClone(b02.expected_result);
  if (candidate.kind !== "plan") throw new Error("b02 must be a plan fixture");
  candidate.plan.steps[1]!.tool.args.rows = [["API", "Done"]];

  const result = score(candidate);

  expect(result.planValid).toBe(true);
  expect(result.taskCorrect).toBe(false);
  expect(result.issues.join(" ")).toMatch(/write intents/i);
});

it("rejects a hard-coded plan that reaches expected writes while skipping an observed fixture read", () => {
  const candidate = structuredClone(b02.expected_result);
  if (candidate.kind !== "plan") throw new Error("b02 must be a plan fixture");
  candidate.plan.steps = candidate.plan.steps.slice(1);
  candidate.plan.steps[0]!.depends_on = [];
  candidate.plan.steps[0]!.tool.args.rows = [
    ["API", "Done"],
    ["UI", "Doing"],
  ];
  candidate.plan.steps[1]!.tool.args.text = "Đã chép 2 dòng.";

  const result = score(candidate);

  expect(result.planValid).toBe(true);
  expect(result.taskCorrect).toBe(false);
  expect(result.issues.join(" ")).toMatch(/read fixture.*not consumed/i);
});

it("reports retrieval recall over unique expected plan tools and leaves non-plan cases N/A", () => {
  expect(
    retrievalRecall(
      ["task_hub.list_cards", "task_hub.list_cards"],
      ["task_hub.list_cards", "task_hub.send_slack_message"],
    ),
  ).toBe(0.5);
  expect(retrievalRecall(["task_hub.list_cards"], [])).toBeNull();
});
