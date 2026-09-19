import { providerCapabilities, type AiProvider } from "./capabilities.js";
import { buildEmbeddingPolicyVersion } from "../embedding-policy.js";

export type { AiProvider } from "./capabilities.js";

export type AiPurpose =
  "planning" | "repair" | "replan" | "query_expansion" | "embedding";

export type GenerationApiMode = "responses" | "interactions";
export type EmbeddingApiMode = "embeddings" | "embedContent";

export interface GenerationProfile {
  readonly provider: AiProvider;
  readonly model: string;
  readonly apiMode: GenerationApiMode;
  readonly maxOutputTokens: number;
  readonly reasoningEffort?:
    "none" | "low" | "medium" | "high" | "xhigh" | "max";
}

export interface EmbeddingProfile {
  readonly provider: AiProvider;
  readonly model: string;
  readonly apiMode: EmbeddingApiMode;
  readonly dimensions: 1536;
  readonly preprocessingVersion: string;
  readonly documentTask: string;
  readonly queryTask: string;
  readonly normalize: boolean;
}

export interface AiProviderConfig {
  readonly planning: GenerationProfile;
  readonly queryExpansion: GenerationProfile;
  readonly embedding: EmbeddingProfile;
  readonly limits: {
    readonly requestTimeoutMs: number;
    readonly trialDeadlineMs: number;
    readonly maxPlanningCalls: number;
    readonly maxReplanCalls: number;
    readonly maxQueryExpansionCalls: number;
    /** Conservative reservation placeholder until a paid-phase price snapshot is approved. */
    readonly reservationEstimateMicros: number;
  };
}

export class AiProviderConfigError extends Error {
  readonly code = "AI_PROVIDER_CONFIG_INVALID" as const;

  constructor(message: string) {
    super(message);
    this.name = "AiProviderConfigError";
  }
}

type Env = Record<string, string | undefined>;

function required(env: Env, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new AiProviderConfigError(`${key} is required`);
  return value;
}

function provider(env: Env, key: string): AiProvider {
  const value = required(env, key).toLowerCase();
  if (value !== "openai" && value !== "google") {
    throw new AiProviderConfigError(`${key} must be openai or google`);
  }
  return value;
}

function positiveInt(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new AiProviderConfigError(`${key} must be a positive integer`);
  }
  return value;
}

function boundedInt(
  env: Env,
  key: string,
  fallback: number,
  maximum: number,
): number {
  const value = positiveInt(env, key, fallback);
  if (value > maximum)
    throw new AiProviderConfigError(`${key} must be <= ${maximum}`);
  return value;
}

function generationProfile(
  env: Env,
  providerKey: string,
  modelKey: string,
  maxTokensKey: string,
  fallbackProvider?: AiProvider,
  fallbackModel?: string,
): GenerationProfile {
  const selectedProvider = env[providerKey]?.trim()
    ? provider(env, providerKey)
    : fallbackProvider;
  if (!selectedProvider) {
    throw new AiProviderConfigError(`${providerKey} is required`);
  }
  const model = env[modelKey]?.trim() || fallbackModel;
  if (!model) throw new AiProviderConfigError(`${modelKey} is required`);
  if (selectedProvider === "google" && env.AI_REASONING_EFFORT?.trim()) {
    throw new AiProviderConfigError(
      "AI_REASONING_EFFORT is an OpenAI-only setting; do not send it to Google",
    );
  }
  if (selectedProvider === "openai" && env.AI_THINKING_BUDGET?.trim()) {
    throw new AiProviderConfigError(
      "AI_THINKING_BUDGET is a Google-only setting; do not send it to OpenAI",
    );
  }
  const capability = providerCapabilities[selectedProvider];
  if (!capability.generationModels.includes(model)) {
    throw new AiProviderConfigError(
      `${modelKey} model ${model} is not in the ${selectedProvider} capability allowlist`,
    );
  }
  return {
    provider: selectedProvider,
    model,
    apiMode: selectedProvider === "openai" ? "responses" : "interactions",
    maxOutputTokens: boundedInt(
      env,
      maxTokensKey,
      maxTokensKey.includes("QE") ? 1024 : 4096,
      maxTokensKey.includes("QE") ? 1024 : 4096,
    ),
    ...(env.AI_REASONING_EFFORT
      ? (() => {
          const effort = env.AI_REASONING_EFFORT;
          const allowed = ["none", "low", "medium", "high", "xhigh", "max"];
          if (!effort || !allowed.includes(effort)) {
            throw new AiProviderConfigError(
              "AI_REASONING_EFFORT is unsupported",
            );
          }
          return {
            reasoningEffort: effort as GenerationProfile["reasoningEffort"],
          };
        })()
      : {}),
  };
}

export function readAiProviderConfig(env: Env = process.env): AiProviderConfig {
  for (const key of [
    "AI_OPENAI_BASE_URL",
    "AI_GOOGLE_BASE_URL",
    "OPENAI_BASE_URL",
    "GEMINI_BASE_URL",
  ]) {
    if (env[key]?.trim())
      throw new AiProviderConfigError(`${key} is not configurable`);
  }
  const planningProvider = provider(env, "AI_PLANNING_PROVIDER");
  const planningModel = required(env, "AI_PLANNING_MODEL");
  const planning = generationProfile(
    env,
    "AI_PLANNING_PROVIDER",
    "AI_PLANNING_MODEL",
    "AI_PLANNING_MAX_OUTPUT_TOKENS",
  );

  const qeProviderSet = Boolean(env.AI_QE_PROVIDER?.trim());
  const qeModelSet = Boolean(env.AI_QE_MODEL?.trim());
  if (qeProviderSet !== qeModelSet) {
    throw new AiProviderConfigError(
      "AI_QE_PROVIDER and AI_QE_MODEL must be supplied together",
    );
  }

  const queryExpansion = generationProfile(
    env,
    "AI_QE_PROVIDER",
    "AI_QE_MODEL",
    "AI_QE_MAX_OUTPUT_TOKENS",
    planningProvider,
    planningModel,
  );

  const embeddingProvider = provider(env, "AI_EMBEDDING_PROVIDER");
  const embeddingModel = required(env, "AI_EMBEDDING_MODEL");
  const embeddingCapability = providerCapabilities[embeddingProvider];
  if (!embeddingCapability.embeddingModels.includes(embeddingModel)) {
    throw new AiProviderConfigError(
      `AI_EMBEDDING_MODEL model ${embeddingModel} is not in the ${embeddingProvider} capability allowlist`,
    );
  }
  const rawDimensions = positiveInt(env, "AI_EMBEDDING_DIMENSIONS", 1536);
  if (rawDimensions !== 1536) {
    throw new AiProviderConfigError(
      `AI_EMBEDDING_DIMENSIONS must be 1536 for the active pgvector index (received ${rawDimensions})`,
    );
  }

  const isGeminiV2 = embeddingModel === "gemini-embedding-2";
  const embedding: EmbeddingProfile = {
    provider: embeddingProvider,
    model: embeddingModel,
    apiMode: embeddingProvider === "openai" ? "embeddings" : "embedContent",
    dimensions: 1536,
    preprocessingVersion: buildEmbeddingPolicyVersion({
      provider: embeddingProvider,
      model: embeddingModel,
      apiMode: embeddingProvider === "openai" ? "embeddings" : "embedContent",
      dimensions: 1536,
      documentTask:
        embeddingProvider === "google" && isGeminiV2
          ? "title: none | text: {content}"
          : "RETRIEVAL_DOCUMENT",
      queryTask:
        embeddingProvider === "google" && isGeminiV2
          ? "task: search result | query: {content}"
          : "RETRIEVAL_QUERY",
      normalize: embeddingProvider === "google",
    }),
    documentTask:
      embeddingProvider === "google" && isGeminiV2
        ? "title: none | text: {content}"
        : "RETRIEVAL_DOCUMENT",
    queryTask:
      embeddingProvider === "google" && isGeminiV2
        ? "task: search result | query: {content}"
        : "RETRIEVAL_QUERY",
    normalize: embeddingProvider === "google",
  };

  const requestTimeoutMs = positiveInt(env, "AI_REQUEST_TIMEOUT_MS", 45_000);
  const trialDeadlineMs = positiveInt(env, "AI_TRIAL_DEADLINE_MS", 120_000);
  if (trialDeadlineMs < requestTimeoutMs) {
    throw new AiProviderConfigError(
      "AI_TRIAL_DEADLINE_MS must be greater than or equal to AI_REQUEST_TIMEOUT_MS",
    );
  }

  return {
    planning,
    queryExpansion,
    embedding,
    limits: {
      requestTimeoutMs,
      trialDeadlineMs,
      maxPlanningCalls: boundedInt(env, "AI_MAX_PLANNING_CALLS", 3, 3),
      maxReplanCalls: boundedInt(env, "AI_MAX_REPLAN_CALLS", 2, 2),
      maxQueryExpansionCalls: boundedInt(
        env,
        "AI_MAX_QUERY_EXPANSION_CALLS",
        1,
        1,
      ),
      reservationEstimateMicros: positiveInt(
        env,
        "AI_RESERVATION_ESTIMATE_MICROS",
        100_000,
      ),
    },
  };
}
