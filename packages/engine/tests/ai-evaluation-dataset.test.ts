import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  EvaluationDatasetError,
  assertCatalogSupportsDataset,
  assertFrozen,
  parseDataset,
  selectCases,
  type FrozenEvaluation,
} from "../src/ai/evaluation/dataset.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(path.join(root, relativePath), "utf8"));
}

const datasetInput = readJson("testdata/test-cases.json");
const manifestInput = readJson("testdata/experiment-manifest.json");

const frozen = (): FrozenEvaluation => ({
  format: "ati-ai04-freeze-v1",
  mode: "offline",
  fingerprints: {
    dataset: "a".repeat(64),
    experimentManifest: "b".repeat(64),
    catalog: "c".repeat(64),
    prompts: "d".repeat(64),
    evaluator: "e".repeat(64),
    fixtures: "f".repeat(64),
    config: "0".repeat(64),
    policiesAndArtifacts: "1".repeat(64),
    lockfile: "2".repeat(64),
  },
  config: {
    mode: "offline",
    cells: [
      { variant: "all_tools", topK: 10 },
      { variant: "semantic", topK: 3 },
    ],
    repetitions: 3,
    maxPlanningCalls: 3,
    deadlineMs: 60_000,
    modelFixture: "oracle-replay-v1",
    embeddingFixture: "character-hash-v1",
    expansionFixture: "identity-v1",
  },
  holdoutExposure: "previously_exercised_by_offline_tests",
});

describe("AI-04 evaluation dataset", () => {
  it("preserves the declared b01–b06 development split", () => {
    const dataset = parseDataset(datasetInput, manifestInput);

    expect(selectCases(dataset, "dev").map((item) => item.id)).toEqual([
      "b01",
      "b02",
      "b03",
      "b04",
      "b05",
      "b06",
    ]);
    expect(selectCases(dataset, "holdout").map((item) => item.id)).toEqual([
      "b07",
      "b08",
      "b09",
      "b10",
    ]);
  });

  it("rejects a manifest that moves a known holdout case into development", () => {
    const drifted = structuredClone(manifestInput) as {
      split: { dev: string[]; holdout: string[] };
    };
    drifted.split.dev = [...drifted.split.dev, "b07"];
    drifted.split.holdout = drifted.split.holdout.filter((id) => id !== "b07");

    expect(() => parseDataset(datasetInput, drifted)).toThrow(
      EvaluationDatasetError,
    );
  });

  it("rejects a holdout freeze when any evaluated fingerprint has drifted", () => {
    const saved = frozen();
    const actual = {
      ...saved,
      fingerprints: { ...saved.fingerprints, prompts: "9".repeat(64) },
    };

    expect(() => assertFrozen(actual, saved)).toThrow(/freeze/i);
  });

  it("rejects a catalog that omits a tool required by an expected plan before model execution", () => {
    const dataset = parseDataset(datasetInput, manifestInput);

    expect(() =>
      assertCatalogSupportsDataset(dataset, [
        { server: "task_hub", name: "list_cards" },
      ]),
    ).toThrow(/missing expected fixture tool/i);
  });
});
