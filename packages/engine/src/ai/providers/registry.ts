import { createHash } from "node:crypto";
import type {
  EmbeddingPort,
  EmbeddingResult,
  EmbeddingUsage,
  QueryExpansionPort,
  QueryExpansionResult,
  StructuredModelClient,
  StructuredModelResponse,
  StructuredModelUsage,
} from "../ports.js";
import type {
  AiProviderConfig,
  EmbeddingProfile,
  GenerationProfile,
} from "./config.js";
import type {
  ProviderCallReservation,
  ProviderCallSettlement,
  ProviderCallUsage,
} from "./accounting.js";
import {
  googlePlannerWireJsonSchema,
  decodePlannerWire,
  openAiPlannerWireJsonSchema,
} from "./wire-schema.js";
import {
  priceProviderCall,
  calculateReservationBoundMicros,
  type ProviderPriceCard,
} from "../live-evaluation/pricing.js";

export type {
  ProviderCallReservation,
  ProviderCallSettlement,
} from "./accounting.js";

export interface ProviderCallLedger {
  reserve(input: ProviderCallReservation): Promise<string>;
  settle(callId: string, outcome: ProviderCallSettlement): Promise<void>;
}

export interface ProviderAuthorizationContext {
  readonly phase: "preflight" | "transport";
}

export type AuthorizeProviderCall = (
  request: ProviderCallReservation,
  context?: ProviderAuthorizationContext,
) => Promise<void>;

export interface AiProviderCallContext {
  readonly campaignId: string;
  readonly runId: string;
  /** Optional evaluator identity used to bind reservations to one trial. */
  readonly profileId?: string;
  readonly trialId?: string;
}

export interface AiProviderCredentials {
  readonly OPENAI_API_KEY?: string;
  readonly GEMINI_API_KEY?: string;
}

export type FetchLike = typeof fetch;

export interface CreateAiPortsOptions {
  readonly config: AiProviderConfig;
  readonly credentials: AiProviderCredentials;
  readonly ledger: ProviderCallLedger;
  /** Required authorization boundary. It runs before credential lookup, reserve, or network. */
  readonly authorizeCall: AuthorizeProviderCall;
  readonly callContext?: AiProviderCallContext;
  readonly fetchImpl?: FetchLike;
  readonly now?: () => number;
  /** Operator-supplied immutable price evidence for paid evaluation. */
  readonly priceCard?: ProviderPriceCard;
}

export interface AiPorts {
  readonly model: StructuredModelClient;
  readonly queryExpansion: QueryExpansionPort;
  readonly embedding: EmbeddingPort;
}

export class ProviderClientError extends Error {
  readonly code:
    | "PROVIDER_CONFIG_MISSING_SECRET"
    | "PROVIDER_HTTP_ERROR"
    | "PROVIDER_RESPONSE_INVALID"
    | "PROVIDER_MODEL_MISMATCH"
    | "PROVIDER_SAFETY_BLOCK"
    | "PROVIDER_TIMEOUT"
    | "PROVIDER_NETWORK_ERROR"
    | "PROVIDER_VECTOR_INVALID"
    | "PRICE_BOUND_UNPROVEN"
    | "AI_LIVE_NOT_READY"
    | "AI_CALL_UNAUTHORIZED"
    | "AI_PROVIDER_CALLS_DISABLED";
  readonly provider: string;
  readonly requestId: string | null;
  readonly status: number | null;

  constructor(
    code: ProviderClientError["code"],
    message: string,
    options: {
      provider: string;
      requestId?: string | null;
      status?: number | null;
    },
  ) {
    super(message);
    this.name = "ProviderClientError";
    this.code = code;
    this.provider = options.provider;
    this.requestId = options.requestId ?? null;
    this.status = options.status ?? null;
  }
}

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const GEMINI_INTERACTIONS_URL =
  "https://generativelanguage.googleapis.com/v1beta/interactions";
const GEMINI_EMBEDDING_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/models";
const PLANNER_WIRE_PROMPT_SUFFIX =
  "Return a closed JSON object with a required `result` field. The result uses the tagged planner branch: when `kind` is 'plan', `refusal` and `clarification` must be null; when `kind` is 'refusal', `plan` and `clarification` must be null; when `kind` is 'clarification', `plan` and `refusal` must be null. Preserve literal nulls and references exactly. Do not add execution, retry, timeout, or hidden tool fields.";

function providerKey(
  provider: "openai" | "google",
): keyof AiProviderCredentials {
  return provider === "openai" ? "OPENAI_API_KEY" : "GEMINI_API_KEY";
}

function requireKey(
  provider: "openai" | "google",
  credentials: AiProviderCredentials,
): string {
  const key = credentials[providerKey(provider)]?.trim();
  if (!key) {
    throw new ProviderClientError(
      "PROVIDER_CONFIG_MISSING_SECRET",
      `${provider} credential is not configured`,
      { provider },
    );
  }
  return key;
}

function requestHash(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

function usageFromProvider(
  body: Record<string, unknown>,
): StructuredModelUsage | null {
  const usage = body.usage;
  if (usage && typeof usage === "object") {
    const record = usage as Record<string, unknown>;
    const inputTokens =
      typeof record.total_input_tokens === "number"
        ? (record.total_input_tokens as number)
        : typeof (record.input_tokens ?? record.prompt_tokens) === "number"
          ? ((record.input_tokens ?? record.prompt_tokens) as number)
          : undefined;
    const cachedInputTokens =
      typeof record.total_cached_tokens === "number"
        ? (record.total_cached_tokens as number)
        : (record.input_tokens_details ?? record.prompt_tokens_details) &&
            typeof (record.input_tokens_details ??
              record.prompt_tokens_details) === "object" &&
            typeof (
              (record.input_tokens_details ??
                record.prompt_tokens_details) as Record<string, unknown>
            ).cached_tokens === "number"
          ? (
              (record.input_tokens_details ??
                record.prompt_tokens_details) as Record<string, number>
            ).cached_tokens
          : undefined;
    const outputTokens =
      typeof record.total_output_tokens === "number"
        ? (record.total_output_tokens as number)
        : typeof record.output_tokens === "number"
          ? (record.output_tokens as number)
          : undefined;
    const reasoningTokens =
      typeof record.total_thought_tokens === "number"
        ? (record.total_thought_tokens as number)
        : typeof record.reasoning_tokens === "number"
          ? (record.reasoning_tokens as number)
          : undefined;
    const totalTokens =
      typeof record.total_tokens === "number"
        ? (record.total_tokens as number)
        : undefined;

    return {
      inputTokens,
      cachedInputTokens,
      outputTokens,
      reasoningTokens,
      totalTokens,
    };
  }
  const usageMetadata = body.usageMetadata;
  if (usageMetadata && typeof usageMetadata === "object") {
    const record = usageMetadata as Record<string, unknown>;
    const inputTokens =
      typeof record.promptTokenCount === "number"
        ? record.promptTokenCount
        : undefined;
    const cachedInputTokens =
      typeof record.cachedContentTokenCount === "number"
        ? record.cachedContentTokenCount
        : undefined;
    const outputTokens =
      typeof record.candidatesTokenCount === "number"
        ? record.candidatesTokenCount
        : undefined;
    return {
      inputTokens,
      cachedInputTokens,
      outputTokens,
      reasoningTokens:
        typeof record.thoughtsTokenCount === "number"
          ? record.thoughtsTokenCount
          : undefined,
      totalTokens:
        typeof record.totalTokenCount === "number"
          ? record.totalTokenCount
          : undefined,
    };
  }
  const promptTokens = body.usage;
  if (promptTokens && typeof promptTokens === "object") {
    const record = promptTokens as Record<string, unknown>;
    if (typeof record.prompt_tokens === "number") {
      return {
        inputTokens: record.prompt_tokens,
        totalTokens:
          typeof record.total_tokens === "number"
            ? record.total_tokens
            : record.prompt_tokens,
      };
    }
  }
  return null;
}

function providerUsage(
  body: Record<string, unknown>,
): ProviderCallUsage | null {
  return usageFromProvider(body);
}

function providerCost(
  options: CreateAiPortsOptions,
  purpose: ProviderCallReservation["purpose"],
  profile: GenerationProfile | EmbeddingProfile,
  body: Record<string, unknown>,
): number | null {
  return options.priceCard
    ? priceProviderCall(
        purpose,
        profile.model,
        providerUsage(body),
        options.priceCard,
        { provider: profile.provider, apiMode: profile.apiMode },
      )
    : null;
}


function reservationEstimate(
  options: CreateAiPortsOptions,
  purpose: ProviderCallReservation["purpose"],
  profile: GenerationProfile | EmbeddingProfile,
): number {
  const bound = options.priceCard
    ? calculateReservationBoundMicros({
        purpose,
        model: profile.model,
        inputLimitTokens: purpose === "embedding" ? 8_192 : 16_384,
        outputCapTokens:
          "maxOutputTokens" in profile ? profile.maxOutputTokens : undefined,
        priceCard: options.priceCard,
        context: { provider: profile.provider, apiMode: profile.apiMode },
      })
    : null;

  if (bound !== null) return bound;
  if (!options.fetchImpl) {
    throw new ProviderClientError(
      "PRICE_BOUND_UNPROVEN",
      `cannot prove conservative reservation bound for ${purpose} call on ${profile.provider}:${profile.model}`,
      { provider: profile.provider },
    );
  }
  return options.config.limits.reservationEstimateMicros;
}

function initialReservationEstimate(
  options: CreateAiPortsOptions,
  purpose: ProviderCallReservation["purpose"],
  profile: GenerationProfile | EmbeddingProfile,
): number {
  let estimate = options.config.limits.reservationEstimateMicros;
  if (options.priceCard) {
    const bound = calculateReservationBoundMicros({
      purpose,
      model: profile.model,
      inputLimitTokens: purpose === "embedding" ? 8_192 : 16_384,
      outputCapTokens:
        "maxOutputTokens" in profile ? profile.maxOutputTokens : undefined,
      priceCard: options.priceCard,
      context: { provider: profile.provider, apiMode: profile.apiMode },
    });
    if (bound !== null) estimate = bound;
  }
  return estimate;
}

function textFromProviderResponse(
  body: Record<string, unknown>,
  provider: "openai" | "google",
): string {
  if (typeof body.output_text === "string") return body.output_text;
  const steps = body.steps;
  if (Array.isArray(steps)) {
    const fragments: string[] = [];
    for (const step of steps) {
      if (!step || typeof step !== "object") continue;
      const record = step as Record<string, unknown>;
      if (record.type === "model_output" && Array.isArray(record.content)) {
        for (const part of record.content) {
          if (!part || typeof part !== "object") continue;
          const p = part as Record<string, unknown>;
          if (typeof p.text === "string") {
            fragments.push(p.text);
          }
        }
      }
    }
    if (fragments.length > 0) {
      const combined = fragments.join("").trim();
      const match = combined.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
      return match ? match[1]!.trim() : combined;
    }
  }
  const candidates = body.candidates;
  if (Array.isArray(candidates) && candidates.length > 0) {
    const first = candidates[0];
    if (first && typeof first === "object") {
      const content = (first as Record<string, unknown>).content;
      if (content && typeof content === "object") {
        const parts = (content as Record<string, unknown>).parts;
        if (Array.isArray(parts)) {
          const fragments: string[] = [];
          for (const part of parts) {
            if (
              part &&
              typeof part === "object" &&
              typeof (part as Record<string, unknown>).text === "string"
            ) {
              fragments.push((part as Record<string, unknown>).text as string);
            }
          }
          if (fragments.length > 0) {
            const combined = fragments.join("").trim();
            const match = combined.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
            return match ? match[1]!.trim() : combined;
          }
        }
      }
    }
  }
  const output = body.output;
  if (Array.isArray(output)) {
    const fragments: string[] = [];
    for (const item of output) {
      if (!item || typeof item !== "object") continue;
      const content = (item as Record<string, unknown>).content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (!part || typeof part !== "object") continue;
        const record = part as Record<string, unknown>;
        if (typeof record.text === "string") fragments.push(record.text);
        if (typeof record.refusal === "string") {
          throw new ProviderClientError(
            "PROVIDER_SAFETY_BLOCK",
            `${provider} provider refused the structured output request`,
            { provider },
          );
        }
      }
    }
    if (fragments.length > 0) return fragments.join("");
  }
  throw new ProviderClientError(
    "PROVIDER_RESPONSE_INVALID",
    "provider response did not contain structured output text",
    { provider: "unknown" },
  );
}

async function parseResponse(
  response: Response,
  provider: "openai" | "google",
): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (text.length > 2_000_000) {
    throw new ProviderClientError(
      "PROVIDER_RESPONSE_INVALID",
      `${provider} provider response exceeds the size cap`,
      { provider, status: response.status },
    );
  }
  const contentType = response.headers.get("content-type");
  if (!contentType || !contentType.toLowerCase().includes("application/json")) {
    throw new ProviderClientError(
      "PROVIDER_RESPONSE_INVALID",
      `${provider} provider response content type is not JSON`,
      { provider, status: response.status },
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (!response.ok) {
    const errorDetails =
      body && typeof body === "object" && "error" in body
        ? (body as Record<string, unknown>).error
        : undefined;
    const detailMsg =
      errorDetails &&
      typeof errorDetails === "object" &&
      "message" in errorDetails
        ? `: ${(errorDetails as Record<string, unknown>).message}`
        : "";
    throw new ProviderClientError(
      "PROVIDER_HTTP_ERROR",
      `${provider} provider returned HTTP ${response.status}${detailMsg}`,
      { provider, status: response.status },
    );
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ProviderClientError(
      "PROVIDER_RESPONSE_INVALID",
      `${provider} provider returned a non-object response`,
      { provider },
    );
  }
  return body as Record<string, unknown>;
}

function settleFailure(
  ledger: ProviderCallLedger,
  callId: string,
  error: unknown,
): Promise<void> {
  const errorCode =
    error instanceof ProviderClientError
      ? error.code
      : "PROVIDER_NETWORK_ERROR";
  const status =
    errorCode === "PROVIDER_TIMEOUT" || errorCode === "PROVIDER_NETWORK_ERROR"
      ? "ambiguous"
      : "failed";
  return ledger.settle(callId, {
    status,
    usage: null,
    costMicros: null,
    errorCode,
  });
}

function composeRequestSignal(
  parent: AbortSignal | undefined,
  timeoutMs: number,
): {
  signal: AbortSignal;
  timedOut: () => boolean;
  cleanup: () => void;
} {
  const controller = new AbortController();
  let didTimeout = false;
  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);
  const abortFromParent = () => controller.abort();
  if (parent) {
    if (parent.aborted) controller.abort();
    else parent.addEventListener("abort", abortFromParent, { once: true });
  }
  return {
    signal: controller.signal,
    timedOut: () => didTimeout,
    cleanup: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abortFromParent);
    },
  };
}

async function invokeProvider(
  options: CreateAiPortsOptions,
  profile: GenerationProfile,
  purpose: "planning" | "repair" | "replan" | "query_expansion",
  body: Record<string, unknown>,
  signal: AbortSignal | undefined,
): Promise<{
  body: Record<string, unknown>;
  latencyMs: number;
  callId: string;
}> {
  const fetchImpl =
    options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  const initialEstimate = initialReservationEstimate(options, purpose, profile);
  const initialReservation: ProviderCallReservation = {
    campaignId: options.callContext?.campaignId ?? "live-evaluation",
    runId: options.callContext?.runId ?? "live-evaluation",
    profileId:
      options.callContext?.profileId ?? `${profile.provider}:${profile.model}`,
    trialId: options.callContext?.trialId,
    provider: profile.provider,
    purpose,
    model: profile.model,
    requestHash: requestHash(body),
    outputCap: profile.maxOutputTokens,
    estimatedCostMicros: initialEstimate,
  };
  // Keep the fail-closed authorization boundary ahead of any pricing failure.
  await options.authorizeCall(initialReservation);
  const estimatedCostMicros = reservationEstimate(options, purpose, profile);
  const reservation: ProviderCallReservation = {
    ...initialReservation,
    estimatedCostMicros,
  };
  if (estimatedCostMicros !== initialEstimate) {
    // The final bound is the budget preflight before credential resolution;
    // reserve() remains the atomic concurrent gate.
    await options.authorizeCall(reservation);
  }
  const key = requireKey(profile.provider, options.credentials);
  const callId = await options.ledger.reserve(reservation);
  const started = (options.now ?? Date.now)();
  const requestSignal = composeRequestSignal(
    signal,
    options.config.limits.requestTimeoutMs,
  );
  try {
    if (signal?.aborted) {
      throw new ProviderClientError(
        "PROVIDER_TIMEOUT",
        "provider request was cancelled before dispatch",
        { provider: profile.provider },
      );
    }
    // Recheck the approval/currentness boundary after reservation and immediately
    // before transport. An approval can expire while the journal is syncing.
    await options.authorizeCall(reservation, { phase: "transport" });
    const init: RequestInit = {
      method: "POST",
      headers:
        profile.provider === "openai"
          ? {
              authorization: `Bearer ${key}`,
              "content-type": "application/json",
            }
          : {
              "x-goog-api-key": key,
              "content-type": "application/json",
            },
      body: JSON.stringify(body),
      signal: requestSignal.signal,
      redirect: "error",
    };
    const response = await fetchImpl(
      profile.provider === "openai"
        ? OPENAI_RESPONSES_URL
        : GEMINI_INTERACTIONS_URL,
      init,
    );
    const parsed = await parseResponse(response, profile.provider);
    return {
      body: parsed,
      latencyMs: (options.now ?? Date.now)() - started,
      callId,
    };
  } catch (error) {
    const normalized =
      error instanceof ProviderClientError
        ? error
        : new ProviderClientError(
            requestSignal.timedOut() || signal?.aborted
              ? "PROVIDER_TIMEOUT"
              : "PROVIDER_NETWORK_ERROR",
            `${profile.provider} provider transport failed`,
            { provider: profile.provider },
          );
    await settleFailure(options.ledger, callId, normalized);
    throw normalized;
  } finally {
    requestSignal.cleanup();
  }
}

function generationBody(
  profile: GenerationProfile,
  systemPrompt: string,
  userPrompt: string,
  schema: unknown,
): Record<string, unknown> {
  if (profile.provider === "openai") {
    return {
      model: profile.model,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: systemPrompt }],
        },
        { role: "user", content: [{ type: "input_text", text: userPrompt }] },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "planner_result",
          strict: true,
          schema,
        },
      },
      max_output_tokens: profile.maxOutputTokens,
      store: false,
      ...(profile.reasoningEffort
        ? { reasoning: { effort: profile.reasoningEffort } }
        : {}),
    };
  }
  return {
    model: profile.model,
    input: `${systemPrompt}\n\n${userPrompt}`,
    response_format: schema,
    generation_config: {
      max_output_tokens: profile.maxOutputTokens,
    },
  };
}

function createModelClient(
  options: CreateAiPortsOptions,
  profile: GenerationProfile,
): StructuredModelClient {
  return {
    async complete(input): Promise<StructuredModelResponse> {
      const schema =
        profile.provider === "openai"
          ? openAiPlannerWireJsonSchema
          : googlePlannerWireJsonSchema;
      const { body, latencyMs, callId } = await invokeProvider(
        options,
        profile,
        input.purpose ?? "planning",
        generationBody(
          profile,
          `${input.systemPrompt}\n\n${PLANNER_WIRE_PROMPT_SUFFIX}`,
          input.userPrompt,
          schema,
        ),
        input.signal,
      );
      let wire: unknown;
      try {
        if (typeof body.model === "string" && body.model !== profile.model) {
          throw new ProviderClientError(
            "PROVIDER_MODEL_MISMATCH",
            "provider returned an unexpected model",
            { provider: profile.provider },
          );
        }
        wire = JSON.parse(textFromProviderResponse(body, profile.provider));
      } catch {
        await options.ledger.settle(callId, {
          status: "invalid_output",
          usage: providerUsage(body),
          costMicros: providerCost(
            options,
            input.purpose ?? "planning",
            profile,
            body,
          ),
          errorCode: "PROVIDER_RESPONSE_INVALID",
        });
        throw new ProviderClientError(
          "PROVIDER_RESPONSE_INVALID",
          "provider output was not valid JSON",
          { provider: profile.provider },
        );
      }
      let output;
      try {
        output = decodePlannerWire(wire);
      } catch {
        await options.ledger.settle(callId, {
          status: "invalid_output",
          usage: providerUsage(body),
          costMicros: providerCost(
            options,
            input.purpose ?? "planning",
            profile,
            body,
          ),
          errorCode: "PROVIDER_RESPONSE_INVALID",
        });
        throw new ProviderClientError(
          "PROVIDER_RESPONSE_INVALID",
          "provider output failed the planner wire schema",
          { provider: profile.provider },
        );
      }
      await options.ledger.settle(callId, {
        status: "succeeded",
        usage: providerUsage(body),
        costMicros: providerCost(
          options,
          input.purpose ?? "planning",
          profile,
          body,
        ),
      });
      return {
        output,
        provider: profile.provider,
        model: profile.model,
        usage: usageFromProvider(body),
        requestId: typeof body.id === "string" ? body.id : null,
        latencyMs,
      };
    },
  };
}

function createQueryExpansionClient(
  options: CreateAiPortsOptions,
  profile: GenerationProfile,
): QueryExpansionPort {
  return {
    async expand(input): Promise<QueryExpansionResult> {
      const schema = {
        type: "object",
        additionalProperties: false,
        required: ["queries"],
        properties: {
          queries: { type: "array", items: { type: "string" }, maxItems: 6 },
        },
      };
      const { body, latencyMs, callId } = await invokeProvider(
        options,
        profile,
        "query_expansion",
        generationBody(
          profile,
          "Expand the retrieval query into at most six intents.",
          input.query,
          schema,
        ),
        input.signal,
      );
      let parsed: unknown;
      try {
        parsed = JSON.parse(textFromProviderResponse(body, profile.provider));
      } catch {
        await options.ledger.settle(callId, {
          status: "invalid_output",
          usage: providerUsage(body),
          costMicros: providerCost(options, "query_expansion", profile, body),
          errorCode: "PROVIDER_RESPONSE_INVALID",
        });
        throw new ProviderClientError(
          "PROVIDER_RESPONSE_INVALID",
          "query expansion output was not JSON",
          { provider: profile.provider },
        );
      }
      if (
        !parsed ||
        typeof parsed !== "object" ||
        !Array.isArray((parsed as Record<string, unknown>).queries)
      ) {
        await options.ledger.settle(callId, {
          status: "invalid_output",
          usage: providerUsage(body),
          costMicros: providerCost(options, "query_expansion", profile, body),
          errorCode: "PROVIDER_RESPONSE_INVALID",
        });
        throw new ProviderClientError(
          "PROVIDER_RESPONSE_INVALID",
          "query expansion output is invalid",
          { provider: profile.provider },
        );
      }
      await options.ledger.settle(callId, {
        status: "succeeded",
        usage: providerUsage(body),
        costMicros: providerCost(options, "query_expansion", profile, body),
      });
      return {
        queries: (parsed as { queries: unknown[] }).queries
          .filter((item): item is string => typeof item === "string")
          .slice(0, 6),
        provider: profile.provider,
        model: profile.model,
        usage: usageFromProvider(body),
        requestId: typeof body.id === "string" ? body.id : null,
        latencyMs,
      };
    },
  };
}

function formatGoogleEmbeddingText(
  profile: EmbeddingProfile,
  text: string,
  purpose: "document" | "query",
): string {
  if (profile.model === "gemini-embedding-001") return text;
  const template =
    purpose === "document" ? profile.documentTask : profile.queryTask;
  if (!template.includes("{content}")) return text;
  return template.replace("{content}", text);
}

function normalizeVector(
  values: readonly number[],
  shouldNormalize: boolean,
): number[] {
  if (!values.length || values.some((value) => !Number.isFinite(value))) {
    throw new ProviderClientError(
      "PROVIDER_VECTOR_INVALID",
      "embedding vector contains invalid values",
      { provider: "unknown" },
    );
  }
  if (!shouldNormalize) return [...values];
  const norm = Math.hypot(...values);
  if (!Number.isFinite(norm) || norm === 0) {
    throw new ProviderClientError(
      "PROVIDER_VECTOR_INVALID",
      "embedding vector has zero norm",
      { provider: "unknown" },
    );
  }
  return values.map((value) => value / norm);
}

function createEmbeddingClient(
  options: CreateAiPortsOptions,
  profile: EmbeddingProfile,
): EmbeddingPort {
  return {
    async embed(input): Promise<EmbeddingResult> {
      const body =
        profile.provider === "openai"
          ? {
              model: profile.model,
              input: input.text,
              dimensions: profile.dimensions,
              encoding_format: "float",
            }
          : {
              model: `models/${profile.model}`,
              content: {
                parts: [
                  {
                    text: formatGoogleEmbeddingText(
                      profile,
                      input.text,
                      input.purpose,
                    ),
                  },
                ],
              },
              outputDimensionality: profile.dimensions,
              ...(profile.model === "gemini-embedding-001"
                ? {
                    taskType:
                      input.purpose === "document"
                        ? "RETRIEVAL_DOCUMENT"
                        : "RETRIEVAL_QUERY",
                  }
                : {}),
            };
      const initialEstimate = initialReservationEstimate(
        options,
        "embedding",
        profile,
      );
      const initialReservation: ProviderCallReservation = {
        campaignId: options.callContext?.campaignId ?? "live-evaluation",
        runId: options.callContext?.runId ?? "live-evaluation",
        profileId:
          options.callContext?.profileId ??
          `${profile.provider}:${profile.model}`,
        trialId: options.callContext?.trialId,
        provider: profile.provider,
        purpose: "embedding",
        model: profile.model,
        requestHash: requestHash(body),
        embeddingPurpose: input.purpose,
        estimatedCostMicros: initialEstimate,
      };
      await options.authorizeCall(initialReservation);
      const estimatedCostMicros = reservationEstimate(
        options,
        "embedding",
        profile,
      );
      const reservation: ProviderCallReservation = {
        ...initialReservation,
        estimatedCostMicros,
      };
      if (estimatedCostMicros !== initialEstimate)
        await options.authorizeCall(reservation);
      const key = requireKey(profile.provider, options.credentials);
      const callId = await options.ledger.reserve(reservation);
      const started = (options.now ?? Date.now)();
      let parsed: Record<string, unknown> | undefined;
      const requestSignal = composeRequestSignal(
        input.signal,
        options.config.limits.requestTimeoutMs,
      );
      try {
        await options.authorizeCall(reservation, { phase: "transport" });
        if (input.signal?.aborted) {
          throw new ProviderClientError(
            "PROVIDER_TIMEOUT",
            "provider request was cancelled before dispatch",
            { provider: profile.provider },
          );
        }
        const fetchImpl =
          options.fetchImpl ?? ((url, init) => globalThis.fetch(url, init));
        const response = await fetchImpl(
          profile.provider === "openai"
            ? OPENAI_EMBEDDINGS_URL
            : `${GEMINI_EMBEDDING_BASE_URL}/${encodeURIComponent(profile.model)}:embedContent`,
          {
            method: "POST",
            headers:
              profile.provider === "openai"
                ? {
                    authorization: `Bearer ${key}`,
                    "content-type": "application/json",
                  }
                : { "x-goog-api-key": key, "content-type": "application/json" },
            body: JSON.stringify(body),
            signal: requestSignal.signal,
            redirect: "error",
          },
        );
        parsed = await parseResponse(response, profile.provider);
        if (
          typeof parsed.model === "string" &&
          parsed.model !== profile.model
        ) {
          throw new ProviderClientError(
            "PROVIDER_MODEL_MISMATCH",
            "provider returned an unexpected model",
            { provider: profile.provider },
          );
        }
        const embeddingValue =
          profile.provider === "openai"
            ? (
                (parsed.data as unknown[])?.[0] as
                  Record<string, unknown> | undefined
              )?.embedding
            : ((parsed.embedding as Record<string, unknown> | undefined)
                ?.values ??
              (
                (parsed.embeddings as unknown[])?.[0] as
                  Record<string, unknown> | undefined
              )?.values);
        if (
          !Array.isArray(embeddingValue) ||
          embeddingValue.some((value) => typeof value !== "number")
        ) {
          throw new ProviderClientError(
            "PROVIDER_VECTOR_INVALID",
            "provider response did not contain an embedding vector",
            { provider: profile.provider },
          );
        }
        if (embeddingValue.length !== profile.dimensions) {
          throw new ProviderClientError(
            "PROVIDER_VECTOR_INVALID",
            `embedding dimension ${embeddingValue.length} does not match ${profile.dimensions}`,
            { provider: profile.provider },
          );
        }
        const values = normalizeVector(embeddingValue, profile.normalize);
        await options.ledger.settle(callId, {
          status: "succeeded",
          usage: providerUsage(parsed),
          costMicros: providerCost(options, "embedding", profile, parsed),
        });
        const embeddingUsage: EmbeddingUsage | null = usageFromProvider(parsed);
        return {
          embedding: values,
          purpose: input.purpose,
          provider: profile.provider,
          model: profile.model,
          dimensions: values.length,
          preprocessingVersion: profile.preprocessingVersion,
          usage: embeddingUsage,
          requestId: typeof parsed.id === "string" ? parsed.id : null,
          latencyMs: (options.now ?? Date.now)() - started,
        };
      } catch (error) {
        if (parsed) {
          await options.ledger.settle(callId, {
            status: "invalid_output",
            usage: providerUsage(parsed),
            costMicros: providerCost(options, "embedding", profile, parsed),
            errorCode:
              error instanceof ProviderClientError
                ? error.code
                : "PROVIDER_NETWORK_ERROR",
          });
        } else {
          await settleFailure(options.ledger, callId, error);
        }
        if (error instanceof ProviderClientError) throw error;
        throw new ProviderClientError(
          requestSignal.timedOut() || input.signal?.aborted
            ? "PROVIDER_TIMEOUT"
            : "PROVIDER_NETWORK_ERROR",
          `${profile.provider} embedding transport failed`,
          { provider: profile.provider },
        );
      } finally {
        requestSignal.cleanup();
      }
    },
  };
}

export function createAiPorts(options: CreateAiPortsOptions): AiPorts {
  return {
    model: createModelClient(options, options.config.planning),
    queryExpansion: createQueryExpansionClient(
      options,
      options.config.queryExpansion,
    ),
    embedding: createEmbeddingClient(options, options.config.embedding),
  };
}
