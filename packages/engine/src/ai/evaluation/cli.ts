/**
 * Local-only AI-04 evidence CLI. It loads checked-in fixtures, never credentials,
 * and writes each artifact with an exclusive create operation.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hash } from "../../snapshot.js";
import { createOfflineReviewedCatalog } from "../local-catalog.js";
import {
  EvalConfigSchema,
  FrozenEvaluationSchema,
  type FrozenEvaluation,
} from "./contracts.js";
import {
  assertCatalogSupportsDataset,
  assertFrozen,
  parseDataset,
} from "./dataset.js";
import { createOfflineSyntheticFixtures } from "./offline-fixtures.js";
import { buildOfflineEvaluationReport, renderOfflineEvaluationMarkdown } from "./report.js";
import { runOfflineEvaluation } from "./runner.js";

export interface OfflineEvaluationCliEnvironment {
  readonly root?: string;
  readonly outputRoot?: string;
  readonly now?: () => Date;
  readonly runId?: () => string;
}

export interface OfflineEvaluationCliResult {
  readonly exitCode: 0 | 1 | 2;
  readonly artifactPath: string | null;
  readonly message: string;
}

const defaultRoot = resolve(fileURLToPath(new URL("../../../../../", import.meta.url)));

/**
 * Sources whose behavior produces the offline planner result. Keep these in the
 * freeze rather than trusting a Git revision: the workspace may be dirty and
 * evidence must reject a holdout run when any local implementation drifts.
 */
const evaluationBehaviorPaths = [
  "packages/engine/src/ai/evaluation/contracts.ts",
  "packages/engine/src/ai/evaluation/dataset.ts",
  "packages/engine/src/ai/evaluation/scorer.ts",
  "packages/engine/src/ai/evaluation/runner.ts",
  "packages/engine/src/ai/evaluation/report.ts",
  "packages/engine/src/ai/evaluation/cli.ts",
  "packages/engine/src/ai/catalog.ts",
  "packages/engine/src/ai/local-catalog.ts",
  "packages/engine/src/ai/planner.ts",
  "packages/engine/src/ai/ports.ts",
  "packages/engine/src/ai/retrieval.ts",
  "packages/engine/src/planner-port.ts",
  "packages/engine/src/snapshot.ts",
  "packages/dsl/src/condition.ts",
  "packages/dsl/src/contracts.ts",
  "packages/dsl/src/graph.ts",
  "packages/dsl/src/prompts.ts",
  "packages/dsl/src/reference.ts",
  "packages/dsl/src/schema.ts",
  "packages/dsl/src/tool-policy.ts",
] as const;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function readJson(root: string, relativePath: string): Promise<unknown> {
  return JSON.parse(await readFile(join(root, relativePath), "utf8"));
}

async function hashFiles(root: string, paths: readonly string[]): Promise<string> {
  const entries = await Promise.all(
    [...paths]
      .sort()
      .map(async (relativePath) => [relativePath, sha256(await readFile(join(root, relativePath))) ] as const),
  );
  return sha256(JSON.stringify(entries));
}

async function loadCatalog(root: string) {
  return createOfflineReviewedCatalog(await readJson(root, "testdata/tools.json"));
}

async function createFreeze(root: string): Promise<FrozenEvaluation> {
  const config = EvalConfigSchema.parse(
    await readJson(root, "testdata/ai-eval-config.json"),
  );
  const dataset = parseDataset(
    await readJson(root, "testdata/test-cases.json"),
    await readJson(root, "testdata/experiment-manifest.json"),
  );
  const catalog = await loadCatalog(root);
  assertCatalogSupportsDataset(dataset, catalog.tools);
  const fingerprints = {
    dataset: sha256(await readFile(join(root, "testdata/test-cases.json"))),
    experimentManifest: sha256(
      await readFile(join(root, "testdata/experiment-manifest.json")),
    ),
    catalog: catalog.catalogHash,
    prompts: await hashFiles(root, ["packages/dsl/src/prompts.ts"]),
    evaluator: await hashFiles(root, evaluationBehaviorPaths),
    fixtures: await hashFiles(root, [
      "packages/engine/src/ai/evaluation/offline-fixtures.ts",
      "testdata/test-cases.json",
      "testdata/tools.json",
    ]),
    config: sha256(await readFile(join(root, "testdata/ai-eval-config.json"))),
    policiesAndArtifacts: await hashFiles(root, [
      "AGENTS.md",
      "docs/BASELINE.md",
      "testdata/tools.json",
    ]),
    lockfile: sha256(await readFile(join(root, "package-lock.json"))),
  };
  return FrozenEvaluationSchema.parse({
    format: "ati-ai04-freeze-v1",
    mode: "offline",
    fingerprints,
    config,
    holdoutExposure: "previously_exercised_by_offline_tests",
  });
}

function makeRunDirectoryName(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(value))
    throw new Error("run id must be a short filesystem-safe identifier");
  return value;
}

async function createArtifactDirectory(
  outputRoot: string,
  runId: string,
): Promise<string> {
  const directory = join(outputRoot, makeRunDirectoryName(runId));
  await mkdir(outputRoot, { recursive: true });
  await mkdir(directory, { recursive: false });
  return directory;
}

async function writeExclusive(path: string, value: string): Promise<void> {
  await writeFile(path, value, { encoding: "utf8", flag: "wx" });
}

function cliError(error: unknown): OfflineEvaluationCliResult {
  const message = error instanceof Error ? error.message : String(error);
  return { exitCode: 2, artifactPath: null, message: message.slice(0, 500) };
}

/** Testable command entry point. It does not invoke child processes or network APIs. */
export async function runOfflineEvaluationCli(
  args: readonly string[],
  environment: OfflineEvaluationCliEnvironment = {},
): Promise<OfflineEvaluationCliResult> {
  const root = resolve(environment.root ?? defaultRoot);
  const outputRoot = resolve(
    environment.outputRoot ?? join(root, "docs", "ai-evidence", "AI-04"),
  );
  const command = args[0] ?? "dev";
  const now = environment.now ?? (() => new Date());
  const runId = environment.runId ?? (() => `run-${now().toISOString().replace(/[:.]/g, "-")}`);
  let freeze: FrozenEvaluation;
  try {
    freeze = await createFreeze(root);
  } catch (error) {
    return cliError(error);
  }

  if (command === "freeze") {
    if (args.length !== 1) return cliError(new Error("freeze accepts no extra arguments"));
    try {
      const directory = await createArtifactDirectory(outputRoot, runId());
      const artifactPath = join(directory, "freeze.json");
      await writeExclusive(artifactPath, `${JSON.stringify(freeze, null, 2)}\n`);
      return { exitCode: 0, artifactPath, message: "offline evaluation freeze created" };
    } catch (error) {
      return { exitCode: 1, artifactPath: null, message: (error as Error).message };
    }
  }

  if (command !== "dev" && command !== "holdout")
    return cliError(new Error("command must be dev, freeze, or holdout"));
  if (command === "holdout") {
    if (args[1] !== "--freeze" || !args[2] || args.length !== 3)
      return cliError(new Error("holdout requires --freeze <path>"));
    try {
      const saved = FrozenEvaluationSchema.parse(
        JSON.parse(await readFile(args[2], "utf8")),
      );
      assertFrozen(freeze, saved);
    } catch (error) {
      return cliError(error);
    }
  } else if (args.length !== 1) {
    return cliError(new Error("dev accepts no extra arguments"));
  }

  try {
    const dataset = parseDataset(
      await readJson(root, "testdata/test-cases.json"),
      await readJson(root, "testdata/experiment-manifest.json"),
    );
    const catalog = await loadCatalog(root);
    const fixtures = createOfflineSyntheticFixtures({
      catalog,
      modelFixture: freeze.config.modelFixture,
      embeddingFixture: freeze.config.embeddingFixture,
      expansionFixture: freeze.config.expansionFixture,
    });
    const result = await runOfflineEvaluation({
      evaluation: dataset,
      split: command,
      registry: catalog.tools,
      retriever: fixtures.retriever,
      config: freeze.config,
      modelFor: fixtures.modelFor,
    });
    const freezeHash = hash(freeze);
    const report = buildOfflineEvaluationReport({
      result,
      runId: runId(),
      createdAt: now().toISOString(),
      freezeHash,
      fingerprints: freeze.fingerprints,
    });
    const directory = await createArtifactDirectory(outputRoot, report.runId);
    const artifactPath = join(directory, "report.json");
    await writeExclusive(artifactPath, `${JSON.stringify(report, null, 2)}\n`);
    await writeExclusive(
      join(directory, "report.md"),
      renderOfflineEvaluationMarkdown(report),
    );
    return {
      exitCode: result.verdict === "OFFLINE_HARNESS_PASS" ? 0 : 1,
      artifactPath,
      message: "offline evaluation report created",
    };
  } catch (error) {
    return { exitCode: 1, artifactPath: null, message: (error as Error).message };
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = await runOfflineEvaluationCli(process.argv.slice(2));
  if (result.artifactPath) process.stdout.write(`${result.artifactPath}\n`);
  else process.stderr.write(`${result.message}\n`);
  process.exitCode = result.exitCode;
}
