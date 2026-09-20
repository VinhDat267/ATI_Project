import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createOfflineReviewedCatalog } from "../local-catalog.js";
import {
  FrozenLiveEvaluationSchema,
  LiveEvaluationFingerprintsSchema,
  type FrozenLiveEvaluation,
  type LiveEvaluationFingerprints,
  type LiveExecutionFingerprint,
  type LiveProfileConfig,
  type SealedHoldoutBundle,
} from "./contracts.js";
import {
  parseLiveEvalConfigFile,
  validateSealedHoldoutBundle,
} from "./dataset.js";

export const LIVE_EVALUATION_BEHAVIOR_PATHS = [
  "packages/engine/src/ai/live-evaluation/contracts.ts",
  "packages/engine/src/ai/live-evaluation/dataset.ts",
  "packages/engine/src/ai/live-evaluation/scorer.ts",
  "packages/engine/src/ai/live-evaluation/schedule.ts",
  "packages/engine/src/ai/live-evaluation/freeze.ts",
  "packages/engine/src/ai/live-evaluation/journal.ts",
  "packages/engine/src/ai/live-evaluation/ledger.ts",
  "packages/engine/src/ai/live-evaluation/campaign.ts",
  "packages/engine/src/ai/live-evaluation/composition.ts",
  "packages/engine/src/ai/live-evaluation/database-identity.ts",
  "packages/engine/src/ai/live-evaluation/pricing.ts",
  "packages/engine/src/ai/live-evaluation/runtime.ts",
  "packages/engine/src/ai/live-evaluation/authorization.ts",
  "packages/engine/src/ai/live-evaluation/runner.ts",
  "packages/engine/src/ai/live-evaluation/report.ts",
  "packages/engine/src/ai/live-evaluation/cli.ts",
  "packages/engine/src/ai/catalog.ts",
  "packages/engine/src/ai/local-catalog.ts",
  "packages/engine/src/ai/planner.ts",
  "packages/engine/src/ai/ports.ts",
  "packages/engine/src/ai/retrieval.ts",
  "packages/engine/src/ai/embedding-policy.ts",
  "packages/engine/src/ai/providers/capabilities.ts",
  "packages/engine/src/ai/providers/config.ts",
  "packages/engine/src/ai/providers/accounting.ts",
  "packages/engine/src/ai/providers/registry.ts",
  "packages/engine/src/ai/providers/wire-schema.ts",
  "packages/db/src/connection.ts",
  "packages/db/src/schema.ts",
  "packages/dsl/src/condition.ts",
  "packages/dsl/src/contracts.ts",
  "packages/dsl/src/graph.ts",
  "packages/dsl/src/prompts.ts",
  "packages/dsl/src/reference.ts",
  "packages/dsl/src/schema.ts",
  "packages/dsl/src/tool-policy.ts",
] as const;

export const POLICIES_AND_ARTIFACTS_PATHS = [
  "AGENTS.md",
  "docs/BASELINE.md",
  "testdata/tools.json",
  "testdata/ai-live-rubric.json",
] as const;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value: unknown): unknown {
  return Array.isArray(value)
    ? value.map(canonical)
    : value !== null && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, entry]) => [key, canonical(entry)]),
        )
      : value;
}

/** Hashes the complete immutable freeze, not one individual fingerprint. */
export function hashLiveFreeze(freeze: FrozenLiveEvaluation): string {
  return sha256(JSON.stringify(canonical(freeze)));
}

async function hashFiles(
  root: string,
  paths: readonly string[],
): Promise<string> {
  const entries = await Promise.all(
    [...paths].sort().map(async (relativePath) => {
      const content = await readFile(join(root, relativePath));
      return [relativePath, sha256(content)] as const;
    }),
  );
  return sha256(JSON.stringify(entries));
}

export async function computeLiveFingerprints(
  root: string,
  options?: {
    readonly configPath?: string;
    readonly behaviorPaths?: readonly string[];
  },
): Promise<LiveEvaluationFingerprints> {
  const configPath = options?.configPath ?? "testdata/ai-live-eval-config.json";
  const behaviorPaths =
    options?.behaviorPaths ?? LIVE_EVALUATION_BEHAVIOR_PATHS;

  const catalogJson = JSON.parse(
    await readFile(join(root, "testdata/tools.json"), "utf8"),
  );
  const catalog = createOfflineReviewedCatalog(catalogJson);

  const rawFingerprints = {
    dataset: sha256(await readFile(join(root, "testdata/test-cases.json"))),
    experimentManifest: sha256(
      await readFile(join(root, "testdata/experiment-manifest.json")),
    ),
    rubric: sha256(await readFile(join(root, "testdata/ai-live-rubric.json"))),
    catalog: catalog.catalogHash,
    prompts: await hashFiles(root, ["packages/dsl/src/prompts.ts"]),
    evaluator: await hashFiles(root, behaviorPaths),
    config: sha256(await readFile(join(root, configPath))),
    policiesAndArtifacts: await hashFiles(root, POLICIES_AND_ARTIFACTS_PATHS),
    lockfile: sha256(await readFile(join(root, "package-lock.json"))),
  };

  return LiveEvaluationFingerprintsSchema.parse(rawFingerprints);
}

export interface CreateLiveFreezeOptions {
  readonly root: string;
  readonly profileId: string;
  readonly campaignId: string;
  readonly configPath?: string;
  readonly behaviorPaths?: readonly string[];
  readonly createdAt?: string;
  readonly sealedHoldoutApproval?: SealedHoldoutBundle;
  readonly budgetCapMicros?: number;
  readonly execution?: LiveExecutionFingerprint;
}

export async function createLiveFreeze(
  options: CreateLiveFreezeOptions,
): Promise<FrozenLiveEvaluation> {
  const configPath = options.configPath ?? "testdata/ai-live-eval-config.json";
  const configContent = await readFile(join(options.root, configPath), "utf8");
  const parsedConfig = parseLiveEvalConfigFile(JSON.parse(configContent));

  const profile: LiveProfileConfig | undefined =
    parsedConfig.profiles[options.profileId];
  if (!profile) {
    throw new Error(
      `Profile "${options.profileId}" not found in config "${configPath}". Available: ${Object.keys(parsedConfig.profiles).join(", ")}`,
    );
  }

  // If sealed holdout approval is provided, validate it strictly
  if (options.sealedHoldoutApproval) {
    validateSealedHoldoutBundle(options.sealedHoldoutApproval);
  }

  const fingerprints = await computeLiveFingerprints(options.root, {
    configPath,
    behaviorPaths: options.behaviorPaths,
  });

  const createdAt = options.createdAt ?? new Date().toISOString();

  const rawFreeze = {
    format: "ati-ai-live-freeze-v1" as const,
    profileId: options.profileId,
    campaignId: options.campaignId,
    createdAt,
    fingerprints,
    profile: {
      id: profile.id,
      description: profile.description,
      planning: {
        provider: profile.planning.provider,
        model: profile.planning.model,
        apiMode: profile.planning.apiMode,
        maxOutputTokens: profile.planning.maxOutputTokens,
      },
      queryExpansion: {
        provider: profile.queryExpansion.provider,
        model: profile.queryExpansion.model,
        apiMode: profile.queryExpansion.apiMode,
        maxOutputTokens: profile.queryExpansion.maxOutputTokens,
      },
      embedding: {
        provider: profile.embedding.provider,
        model: profile.embedding.model,
        apiMode: profile.embedding.apiMode,
        dimensions: profile.embedding.dimensions,
        preprocessingVersion: profile.embedding.preprocessingVersion,
        documentTask: profile.embedding.documentTask,
        queryTask: profile.embedding.queryTask,
        normalize: profile.embedding.normalize,
      },
    },
    ...(options.budgetCapMicros !== undefined
      ? { budgetCapMicros: options.budgetCapMicros }
      : {}),
    ...(options.sealedHoldoutApproval
      ? { sealedHoldoutApproval: options.sealedHoldoutApproval }
      : {}),
    ...(options.execution ? { execution: options.execution } : {}),
  };

  return FrozenLiveEvaluationSchema.parse(rawFreeze);
}

export function assertLiveFrozen(
  actual: FrozenLiveEvaluation,
  expected: FrozenLiveEvaluation,
): void {
  if (actual.format !== expected.format) {
    throw new Error(
      `Freeze format mismatch: actual "${actual.format}" vs expected "${expected.format}"`,
    );
  }
  if (actual.profileId !== expected.profileId) {
    throw new Error(
      `Freeze profileId mismatch: actual "${actual.profileId}" vs expected "${expected.profileId}"`,
    );
  }
  if (actual.campaignId !== expected.campaignId) {
    throw new Error(
      `Freeze campaignId mismatch: actual "${actual.campaignId}" vs expected "${expected.campaignId}"`,
    );
  }

  for (const [key, expectedHash] of Object.entries(expected.fingerprints)) {
    const actualHash =
      actual.fingerprints[key as keyof LiveEvaluationFingerprints];
    if (actualHash !== expectedHash) {
      throw new Error(
        `Freeze fingerprint mismatch on "${key}": actual "${actualHash}" !== expected "${expectedHash}". Code or configuration has drifted since freeze.`,
      );
    }
  }

  // Ensure role providers and models match identically
  if (actual.profile.planning.provider !== expected.profile.planning.provider) {
    throw new Error(
      `Freeze planning provider mismatch: actual "${actual.profile.planning.provider}" vs expected "${expected.profile.planning.provider}"`,
    );
  }
  if (actual.profile.planning.model !== expected.profile.planning.model) {
    throw new Error(
      `Freeze planning model mismatch: actual "${actual.profile.planning.model}" vs expected "${expected.profile.planning.model}"`,
    );
  }
  if (
    actual.profile.embedding.provider !== expected.profile.embedding.provider
  ) {
    throw new Error(
      `Freeze embedding provider mismatch: actual "${actual.profile.embedding.provider}" vs expected "${expected.profile.embedding.provider}"`,
    );
  }
  if (actual.profile.embedding.model !== expected.profile.embedding.model) {
    throw new Error(
      `Freeze embedding model mismatch: actual "${actual.profile.embedding.model}" vs expected "${expected.profile.embedding.model}"`,
    );
  }

  const withoutCreatedAt = (value: FrozenLiveEvaluation) => {
    const { createdAt: _createdAt, ...semantic } = value;
    return semantic;
  };
  if (
    JSON.stringify(canonical(withoutCreatedAt(actual))) !==
    JSON.stringify(canonical(withoutCreatedAt(expected)))
  ) {
    throw new Error(
      "Freeze semantic execution mismatch: role configuration, budget, index, runtime, git, manifest, or approval scope drifted",
    );
  }
}

/** Backward-compatible descriptive alias used by the report/runtime gates. */
export function assertLiveFreezeMatches(
  actual: FrozenLiveEvaluation,
  expected: FrozenLiveEvaluation,
): void {
  assertLiveFrozen(actual, expected);
}
