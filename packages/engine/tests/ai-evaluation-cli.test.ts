import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { runOfflineEvaluationCli } from "../src/ai/evaluation/cli.js";
import { createOfflineReviewedCatalog } from "../src/ai/local-catalog.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function outputDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "ati-ai04-"));
  temporaryDirectories.push(directory);
  return directory;
}

function copyEvaluationInputs(destination: string): void {
  const paths = [
    "AGENTS.md",
    "package-lock.json",
    "docs/BASELINE.md",
    "testdata/ai-eval-config.json",
    "testdata/experiment-manifest.json",
    "testdata/test-cases.json",
    "testdata/tools.json",
    "packages/dsl/src/condition.ts",
    "packages/dsl/src/contracts.ts",
    "packages/dsl/src/graph.ts",
    "packages/dsl/src/prompts.ts",
    "packages/dsl/src/reference.ts",
    "packages/dsl/src/schema.ts",
    "packages/dsl/src/tool-policy.ts",
    "packages/engine/src/snapshot.ts",
    "packages/engine/src/planner-port.ts",
    "packages/engine/src/ai/catalog.ts",
    "packages/engine/src/ai/local-catalog.ts",
    "packages/engine/src/ai/planner.ts",
    "packages/engine/src/ai/ports.ts",
    "packages/engine/src/ai/retrieval.ts",
    "packages/engine/src/ai/evaluation/cli.ts",
    "packages/engine/src/ai/evaluation/contracts.ts",
    "packages/engine/src/ai/evaluation/dataset.ts",
    "packages/engine/src/ai/evaluation/offline-fixtures.ts",
    "packages/engine/src/ai/evaluation/report.ts",
    "packages/engine/src/ai/evaluation/runner.ts",
    "packages/engine/src/ai/evaluation/scorer.ts",
  ];
  for (const relativePath of paths) {
    const target = join(destination, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(root, relativePath), target);
  }
}

it("rejects an offline manifest that is not the reviewed 8+2 catalog", () => {
  const manifest = JSON.parse(
    readFileSync(join(root, "testdata", "tools.json"), "utf8"),
  );
  manifest.servers[0].tools = manifest.servers[0].tools.slice(0, 7);

  expect(() => createOfflineReviewedCatalog(manifest)).toThrow(/8 task_hub.*2 filesystem/i);
});

it("writes an exclusive freeze and blocks holdout when that freeze drifts", async () => {
  const outputRoot = outputDirectory();
  const frozen = await runOfflineEvaluationCli(["freeze"], {
    root,
    outputRoot,
    now: () => new Date("2026-09-18T00:00:00.000Z"),
    runId: () => "freeze-test",
  });

  expect(frozen.exitCode).toBe(0);
  expect(frozen.artifactPath).toMatch(/freeze\.json$/);
  expect(JSON.parse(readFileSync(frozen.artifactPath!, "utf8"))).toMatchObject({
    format: "ati-ai04-freeze-v1",
    mode: "offline",
  });

  const holdout = await runOfflineEvaluationCli(
    ["holdout", "--freeze", frozen.artifactPath!],
    {
      root,
      outputRoot,
      now: () => new Date("2026-09-18T00:00:00.000Z"),
      runId: () => "holdout-test",
    },
  );
  expect(holdout.exitCode).toBe(0);
  const report = JSON.parse(readFileSync(holdout.artifactPath!, "utf8"));
  expect(report.summary.bySplit).toEqual({
    dev: { uniqueCaseCount: 0, observationCount: 0 },
    holdout: { uniqueCaseCount: 4, observationCount: 84 },
  });

  const drifted = JSON.parse(readFileSync(frozen.artifactPath!, "utf8"));
  drifted.fingerprints.config = "b".repeat(64);
  const driftPath = join(outputRoot, "drifted-freeze.json");
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(driftPath, JSON.stringify(drifted)),
  );
  const rejected = await runOfflineEvaluationCli(
    ["holdout", "--freeze", driftPath],
    { root, outputRoot, runId: () => "rejected-test" },
  );
  expect(rejected.exitCode).toBe(2);
  expect(rejected.artifactPath).toBeNull();
});

it("blocks holdout if a planner dependency changes after freeze", async () => {
  const fixtureRoot = outputDirectory();
  copyEvaluationInputs(fixtureRoot);
  const outputRoot = join(fixtureRoot, "evidence");
  const frozen = await runOfflineEvaluationCli(["freeze"], {
    root: fixtureRoot,
    outputRoot,
    runId: () => "freeze-dependency",
  });
  expect(frozen.exitCode).toBe(0);

  const plannerPath = join(
    fixtureRoot,
    "packages/engine/src/ai/planner.ts",
  );
  writeFileSync(plannerPath, `${readFileSync(plannerPath, "utf8")}\n// drift\n`);
  const rejected = await runOfflineEvaluationCli(
    ["holdout", "--freeze", frozen.artifactPath!],
    { root: fixtureRoot, outputRoot, runId: () => "holdout-dependency" },
  );

  expect(rejected.exitCode).toBe(2);
  expect(rejected.artifactPath).toBeNull();
});
