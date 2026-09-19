import {
  LiveCaseInputSchema,
  LiveCaseOracleSchema,
  LiveRubricSchema,
  SealedHoldoutBundleSchema,
  type LiveCaseInput,
  type LiveCaseOracle,
  type LiveExposure,
  type LiveProfileConfig,
  type LiveRubric,
  type SealedHoldoutBundle,
  type Split,
} from "./contracts.js";
import {
  EvalDatasetSchema,
  ExperimentManifestSchema,
} from "../evaluation/contracts.js";
import { buildEmbeddingPolicyVersion } from "../embedding-policy.js";
import { providerCapabilities, type AiProvider } from "../providers/capabilities.js";

export class LiveDatasetError extends Error {
  readonly code = "AI_LIVE_DATASET_INVALID" as const;

  constructor(message: string) {
    super(message);
    this.name = "LiveDatasetError";
  }
}

export interface ParsedLiveCase {
  readonly input: LiveCaseInput;
  readonly oracle: LiveCaseOracle;
  readonly exposure: LiveExposure;
  readonly originalSplit: Split;
  readonly rawCase: unknown;
}

export interface ParsedLiveDataset {
  readonly runtime: Record<string, string>;
  readonly cases: readonly ParsedLiveCase[];
  readonly rubric?: LiveRubric;
}

function parseTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
  } catch {
    throw new LiveDatasetError(`Invalid runtime time zone: ${timeZone}`);
  }
}

/**
 * Explicitly copies ONLY id, prompt, and runtime for model consumption.
 * All gold fields (expected_result, read_fixture, expected_writes, etc.)
 * are completely omitted and isolated into evaluator-private LiveCaseOracle.
 */
export function toLiveCaseInput(
  caseData: Record<string, unknown> | unknown,
  fallbackRuntime?: Record<string, string>,
): LiveCaseInput {
  if (typeof caseData !== "object" || caseData === null) {
    throw new LiveDatasetError("caseData must be a non-null object");
  }

  const raw = caseData as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const prompt = typeof raw.prompt === "string" ? raw.prompt : "";

  if (!id) throw new LiveDatasetError("Missing or empty case id");
  if (!prompt) throw new LiveDatasetError("Missing or empty case prompt");

  let runtime: Record<string, string> = {};
  if (raw.runtime && typeof raw.runtime === "object" && !Array.isArray(raw.runtime)) {
    for (const [k, v] of Object.entries(raw.runtime as Record<string, unknown>)) {
      if (typeof v === "string") runtime[k] = v;
    }
  } else if (fallbackRuntime && typeof fallbackRuntime === "object") {
    for (const [k, v] of Object.entries(fallbackRuntime)) {
      if (typeof v === "string") runtime[k] = v;
    }
  }

  const input: LiveCaseInput = {
    id,
    prompt,
    runtime: Object.freeze(runtime),
  };

  const parsed = LiveCaseInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new LiveDatasetError(
      `Invalid LiveCaseInput: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
    );
  }

  return Object.freeze(input);
}

/**
 * Parses existing cases without changing labels.
 * Stores original manifest split separately from evaluation exposure:
 * b01–b06 are `dev`, b07–b10 are `legacy_regression` (not sealed holdout).
 */
export function parseLiveDataset(
  rawCases: unknown,
  rawManifest: unknown,
  rawRubric?: unknown,
): ParsedLiveDataset {
  const parsedDataset = EvalDatasetSchema.safeParse(rawCases);
  if (!parsedDataset.success) {
    throw new LiveDatasetError(
      `Malformed test cases dataset: ${parsedDataset.error.issues.map((i) => i.message).join(", ")}`,
    );
  }

  const parsedManifest = ExperimentManifestSchema.safeParse(rawManifest);
  if (!parsedManifest.success) {
    throw new LiveDatasetError(
      `Malformed experiment manifest: ${parsedManifest.error.issues.map((i) => i.message).join(", ")}`,
    );
  }

  parseTimeZone(parsedDataset.data.runtime.time_zone);

  let rubric: LiveRubric | undefined;
  if (rawRubric !== undefined && rawRubric !== null) {
    const parsedR = LiveRubricSchema.safeParse(rawRubric);
    if (!parsedR.success) {
      throw new LiveDatasetError(
        `Malformed live rubric: ${parsedR.error.issues.map((i) => i.message).join(", ")}`,
      );
    }
    rubric = parsedR.data;
  }

  const casesData = parsedDataset.data.cases;
  const ids = casesData.map((c) => c.id);
  if (new Set(ids).size !== ids.length) {
    throw new LiveDatasetError("Dataset contains duplicate case IDs");
  }

  // Check for unauthorized sealed_holdout relabeling
  for (const rawCase of casesData as unknown as Array<Record<string, unknown>>) {
    if (rawCase.exposure === "sealed_holdout") {
      throw new LiveDatasetError(
        `Case ${rawCase.id} cannot be relabeled as sealed_holdout without authorized fresh holdout bundle`,
      );
    }
  }

  const manifestDev = new Set(parsedManifest.data.split.dev);
  const manifestHoldout = new Set(parsedManifest.data.split.holdout);

  const parsedCases: ParsedLiveCase[] = [];

  for (const c of casesData) {
    // Construct public input
    const input = toLiveCaseInput({
      id: c.id,
      prompt: c.prompt,
      runtime: parsedDataset.data.runtime,
    });

    // Construct private oracle
    const oracle: LiveCaseOracle = Object.freeze({
      id: c.id,
      expected_result: c.expected_result,
      read_fixture: c.read_fixture,
      expected_writes: c.expected_writes,
      expected_outputs: c.expected_outputs,
      forbid_extra_writes: c.forbid_extra_writes,
    });

    // Validate oracle structure
    const oracleCheck = LiveCaseOracleSchema.safeParse(oracle);
    if (!oracleCheck.success) {
      throw new LiveDatasetError(
        `Case ${c.id} has invalid oracle structure: ${oracleCheck.error.issues.map((i) => i.message).join(", ")}`,
      );
    }

    // Determine original split and evaluation exposure
    let originalSplit: Split;
    let exposure: LiveExposure;

    if (manifestDev.has(c.id)) {
      originalSplit = "dev";
      exposure = "dev";
    } else if (manifestHoldout.has(c.id)) {
      originalSplit = "holdout";
      // b07-b10 were previously used in offline tests and cannot be treated as sealed holdouts
      exposure = "legacy_regression";
    } else {
      throw new LiveDatasetError(
        `Case ${c.id} is not present in experiment manifest dev or holdout split`,
      );
    }

    parsedCases.push(
      Object.freeze({
        input,
        oracle,
        exposure,
        originalSplit,
        rawCase: c,
      }),
    );
  }

  const devCount = parsedCases.filter((c) => c.exposure === "dev").length;
  const regressionCount = parsedCases.filter(
    (c) => c.exposure === "legacy_regression",
  ).length;

  if (devCount !== 6 || regressionCount !== 4) {
    throw new LiveDatasetError(
      `Dataset must contain exactly 6 dev cases and 4 legacy_regression cases (got ${devCount} dev, ${regressionCount} regression)`,
    );
  }

  return Object.freeze({
    runtime: parsedDataset.data.runtime,
    cases: Object.freeze(parsedCases),
    rubric,
  });
}

/**
 * Canary detector to prove no gold strings leak into public payloads or model requests.
 */
export function assertNoGoldCanaryInPayload(
  payload: unknown,
  canary: string,
  seen: WeakSet<object> = new WeakSet(),
): void {
  if (payload === null || payload === undefined) return;
  if (typeof payload === "string") {
    if (payload.includes(canary)) {
      throw new Error(`Gold canary leaked in payload string: ${payload}`);
    }
    return;
  }
  if (typeof payload === "number" || typeof payload === "boolean" || typeof payload === "function") return;
  if (typeof payload === "object") {
    if (seen.has(payload)) return;
    seen.add(payload);

    if (payload instanceof AbortSignal) return;

    if (Array.isArray(payload)) {
      for (const item of payload) {
        assertNoGoldCanaryInPayload(item, canary, seen);
      }
      return;
    }

    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      if (key.includes(canary)) {
        throw new Error(`Gold canary leaked in object key: ${key}`);
      }
      assertNoGoldCanaryInPayload(value, canary, seen);
    }
  }
}

/**
 * Sealed holdout entry requires an immutable bundle approved by the user/rubric owner,
 * declared exposure history, rubric and budget.
 * A coding agent cannot approve its own generated holdout by writing an approval field.
 */
export function validateSealedHoldoutBundle(bundle: unknown): boolean {
  const parsed = SealedHoldoutBundleSchema.safeParse(bundle);
  if (!parsed.success) {
    throw new LiveDatasetError(
      `Invalid sealed holdout bundle: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
    );
  }

  const approver = parsed.data.approvedBy.toLowerCase();
  const agentTokens = ["agent", "claude", "bot", "auto", "synthetic", "script"];
  if (agentTokens.some((token) => approver.includes(token))) {
    throw new LiveDatasetError(
      "A coding agent cannot approve its own generated holdout by writing an approval field",
    );
  }

  return true;
}

export interface ParsedLiveEvalConfig {
  readonly format: string;
  readonly limits: {
    readonly requestTimeoutMs: number;
    readonly trialDeadlineMs: number;
    readonly maxPlanningCalls: number;
    readonly maxReplanCalls: number;
    readonly maxQueryExpansionCalls: number;
    readonly reservationEstimateMicros: number;
  };
  readonly profiles: Record<string, LiveProfileConfig>;
  resolveProfile(profileId: string): LiveProfileConfig;
}

export function parseLiveEvalConfigFile(raw: unknown): ParsedLiveEvalConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new LiveDatasetError("Live eval config must be a non-null object");
  }

  const obj = raw as Record<string, unknown>;
  if (obj.format !== "ati-ai-live-eval-config-v1") {
    throw new LiveDatasetError("Invalid live eval config format identifier");
  }

  const rawProfiles = obj.profiles as Record<string, Record<string, unknown>> | undefined;
  if (!rawProfiles || typeof rawProfiles !== "object") {
    throw new LiveDatasetError("Missing profiles in live eval config");
  }

  const rawLimits = obj.limits as Record<string, number> | undefined;
  const limits = {
    requestTimeoutMs: rawLimits?.requestTimeoutMs ?? 45000,
    trialDeadlineMs: rawLimits?.trialDeadlineMs ?? 120000,
    maxPlanningCalls: rawLimits?.maxPlanningCalls ?? 3,
    maxReplanCalls: rawLimits?.maxReplanCalls ?? 2,
    maxQueryExpansionCalls: rawLimits?.maxQueryExpansionCalls ?? 1,
    reservationEstimateMicros: rawLimits?.reservationEstimateMicros ?? 100000,
  };

  const resolvedProfiles: Record<string, LiveProfileConfig> = {};

  for (const [profileId, p] of Object.entries(rawProfiles)) {
    const planning = p.planning as Record<string, unknown>;
    const queryExpansion = p.queryExpansion as Record<string, unknown>;
    const embedding = p.embedding as Record<string, unknown>;

    if (!planning || !queryExpansion || !embedding) {
      throw new LiveDatasetError(`Profile ${profileId} missing role configurations`);
    }

    const planProvider = planning.provider as AiProvider;
    const planModel = planning.model as string;
    const qeProvider = queryExpansion.provider as AiProvider;
    const qeModel = queryExpansion.model as string;
    const embProvider = embedding.provider as AiProvider;
    const embModel = embedding.model as string;

    // Validate provider capabilities
    if (!providerCapabilities[planProvider]?.generationModels.includes(planModel)) {
      throw new LiveDatasetError(
        `Profile ${profileId} planning model ${planModel} not in ${planProvider} allowlist`,
      );
    }
    if (!providerCapabilities[qeProvider]?.generationModels.includes(qeModel)) {
      throw new LiveDatasetError(
        `Profile ${profileId} QE model ${qeModel} not in ${qeProvider} allowlist`,
      );
    }
    if (!providerCapabilities[embProvider]?.embeddingModels.includes(embModel)) {
      throw new LiveDatasetError(
        `Profile ${profileId} embedding model ${embModel} not in ${embProvider} allowlist`,
      );
    }

    const isGeminiV2 = embModel === "gemini-embedding-2";
    const documentTask =
      embProvider === "google" && isGeminiV2
        ? "title: none | text: {content}"
        : "RETRIEVAL_DOCUMENT";
    const queryTask =
      embProvider === "google" && isGeminiV2
        ? "task: search result | query: {content}"
        : "RETRIEVAL_QUERY";
    const normalize = embProvider === "google";

    const preprocessingVersion = buildEmbeddingPolicyVersion({
      provider: embProvider,
      model: embModel,
      apiMode: embProvider === "openai" ? "embeddings" : "embedContent",
      dimensions: 1536,
      documentTask,
      queryTask,
      normalize,
    });

    resolvedProfiles[profileId] = {
      id: profileId,
      description: (p.description as string) ?? profileId,
      planning: {
        provider: planProvider,
        model: planModel,
        apiMode: planProvider === "openai" ? "responses" : "interactions",
        maxOutputTokens: (planning.maxOutputTokens as number) ?? 4096,
      },
      queryExpansion: {
        provider: qeProvider,
        model: qeModel,
        apiMode: qeProvider === "openai" ? "responses" : "interactions",
        maxOutputTokens: (queryExpansion.maxOutputTokens as number) ?? 1024,
      },
      embedding: {
        provider: embProvider,
        model: embModel,
        apiMode: embProvider === "openai" ? "embeddings" : "embedContent",
        dimensions: 1536,
        preprocessingVersion,
        documentTask,
        queryTask,
        normalize,
      },
      limits,
    };
  }

  return {
    format: obj.format as string,
    limits,
    profiles: resolvedProfiles,
    resolveProfile(profileId: string): LiveProfileConfig {
      const found = resolvedProfiles[profileId];
      if (!found) {
        throw new LiveDatasetError(`Unknown profile ID: ${profileId}`);
      }
      return found;
    },
  };
}
