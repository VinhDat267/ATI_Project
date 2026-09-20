import {
  createAiPorts,
  ProviderAccountingError,
  ProviderClientError,
  type AiProviderCallContext,
  type AiProviderConfig,
  type AiProviderCredentials,
  type AiPorts,
  type AuthorizeProviderCall,
  type ProviderAuthorizationContext,
  type FetchLike,
  type ProviderCallLedger,
  type ProviderCallReservation,
  type ProviderPriceCard,
  PgvectorCatalogIndex,
  PgvectorToolRetriever,
  type Gateway,
  type ReviewedCatalogSnapshot,
  type RetrievalVariant,
} from "@wap/engine";
import type { Database } from "@wap/db";
import { loadAiPlanner, loadAiReplan } from "./ai-planner.js";

export const DEFAULT_AI_PRICE_CARD: ProviderPriceCard = {
  version: "default-api-price-card-v1",
  entries: {
    "gemini-3.5-flash": {
      inputMicrosPerMillion: 150_000,
      cachedInputMicrosPerMillion: 75_000,
      outputMicrosPerMillion: 600_000,
      reasoningMicrosPerMillion: 600_000,
    },
    "gemini-2.5-flash": {
      inputMicrosPerMillion: 150_000,
      cachedInputMicrosPerMillion: 75_000,
      outputMicrosPerMillion: 600_000,
      reasoningMicrosPerMillion: 600_000,
    },
    "gemini-3.6-flash": {
      inputMicrosPerMillion: 150_000,
      cachedInputMicrosPerMillion: 75_000,
      outputMicrosPerMillion: 600_000,
      reasoningMicrosPerMillion: 600_000,
    },
    "gemini-3.7-flash": {
      inputMicrosPerMillion: 150_000,
      cachedInputMicrosPerMillion: 75_000,
      outputMicrosPerMillion: 600_000,
      reasoningMicrosPerMillion: 600_000,
    },
    "gemini-3.8-flash": {
      inputMicrosPerMillion: 150_000,
      cachedInputMicrosPerMillion: 75_000,
      outputMicrosPerMillion: 600_000,
      reasoningMicrosPerMillion: 600_000,
    },
    "gemini-embedding-001": {
      inputMicrosPerMillion: 25_000,
    },
    "gemini-embedding-2": {
      inputMicrosPerMillion: 25_000,
    },
    "gpt-5.6-terra": {
      inputMicrosPerMillion: 2_500_000,
      cachedInputMicrosPerMillion: 1_250_000,
      outputMicrosPerMillion: 10_000_000,
      reasoningMicrosPerMillion: 10_000_000,
    },
    "text-embedding-3-large": {
      inputMicrosPerMillion: 130_000,
    },
  },
};

export interface AiRuntimePortsOptions {
  readonly config: AiProviderConfig;
  readonly credentials: AiProviderCredentials;
  readonly ledger?: ProviderCallLedger;
  readonly authorizeCall?: AuthorizeProviderCall;
  readonly callContext?: AiProviderCallContext;
  readonly fetchImpl?: FetchLike;
  readonly now?: () => number;
  readonly priceCard?: ProviderPriceCard;
}

export interface CreateAiRuntimeOptions extends AiRuntimePortsOptions {
  readonly db: Database;
  readonly gateway: Gateway;
  readonly root: string;
  readonly userId: string;
  /** Explicit retrieval mode; all_tools remains the safe default. */
  readonly retrievalVariant?: RetrievalVariant;
}

export interface AiRuntime {
  readonly ports: AiPorts;
  readonly planner: ReturnType<typeof loadAiPlanner>;
  readonly replan: ReturnType<typeof loadAiReplan>;
  readonly secrets: readonly string[];
  readonly forRun: (runId: string) => {
    readonly ports: AiPorts;
    readonly planner: ReturnType<typeof loadAiPlanner>;
    readonly replan: ReturnType<typeof loadAiReplan>;
  };
}

/**
 * The default runtime remains fail-closed; native provider execution is only
 * enabled when the caller supplies durable authorization and accounting.
 */
export async function denyAiLiveCalls(): Promise<never> {
  throw new ProviderClientError(
    "AI_LIVE_NOT_READY",
    "AI live provider execution is not enabled until durable authorization and accounting are installed",
    { provider: "runtime" },
  );
}

export interface ApiAuthorizeCallOptions {
  readonly db: Database;
  readonly userId: string;
  readonly campaignId: string;
  readonly leaseTtlMs?: number;
}

/**
 * Checks durable run ownership and worker liveness before provider credentials,
 * reservation, or transport are touched by the engine registry.
 */
export function createApiAuthorizeCall(
  options: ApiAuthorizeCallOptions,
): AuthorizeProviderCall {
  const leaseTtlMs = options.leaseTtlMs ?? 5 * 60 * 1000;
  if (!Number.isSafeInteger(leaseTtlMs) || leaseTtlMs <= 0)
    throw new Error("leaseTtlMs must be a positive integer");
  const deny = (reservation: ProviderCallReservation): never => {
    throw new ProviderClientError(
      "AI_CALL_UNAUTHORIZED",
      "AI provider call is not authorized for the current run",
      { provider: reservation.provider },
    );
  };
  return async (
    reservation,
    context: ProviderAuthorizationContext = { phase: "preflight" },
  ) => {
    if (reservation.campaignId !== options.campaignId) deny(reservation);
    try {
      const rows = await options.db.client`
        SELECT c.limit_micros,c.held_micros,c.committed_micros
        FROM runs r
        JOIN ai_provider_campaigns c
          ON c.campaign_id=${options.campaignId}
         AND c.user_id=${options.userId}
         AND c.halted=false
        WHERE r.id=${reservation.runId}
          AND r.user_id=${options.userId}
          AND r.status IN ('planning','replanning')
          AND r.claimed_by IS NOT NULL
          AND r.heartbeat_at > clock_timestamp() - (${leaseTtlMs} * interval '1 millisecond')
        LIMIT 1`;
      const campaign = rows[0] as
        | {
            limit_micros: string | number;
            held_micros: string | number;
            committed_micros: string | number;
          }
        | undefined;
      if (!campaign) {
        deny(reservation);
        return;
      }
      const limit = Number(campaign!.limit_micros);
      const held = Number(campaign!.held_micros);
      const committed = Number(campaign!.committed_micros);
      if (context.phase === "preflight") {
        if (
          !Number.isSafeInteger(limit) ||
          !Number.isSafeInteger(held) ||
          !Number.isSafeInteger(committed) ||
          !Number.isSafeInteger(reservation.estimatedCostMicros) ||
          reservation.estimatedCostMicros < 0 ||
          committed + held + reservation.estimatedCostMicros > limit
        ) {
          throw new ProviderAccountingError(
            "BUDGET_EXCEEDED",
            `provider call reservation exceeds campaign cap of ${limit} micros`,
          );
        }
      }
    } catch (error) {
      if (error instanceof ProviderAccountingError) throw error;
      deny(reservation);
    }
  };
}

export function createAiRuntimePorts(options: AiRuntimePortsOptions): AiPorts {
  const ledger = options.ledger ?? {
    async reserve(): Promise<never> {
      throw new ProviderClientError(
        "AI_LIVE_NOT_READY",
        "AI live provider execution is not enabled",
        { provider: "runtime" },
      );
    },
    async settle(): Promise<void> {},
  };
  return createAiPorts({
    config: options.config,
    credentials: options.credentials,
    ledger,
    authorizeCall: options.authorizeCall ?? denyAiLiveCalls,
    ...(options.callContext ? { callContext: options.callContext } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.now ? { now: options.now } : {}),
    priceCard: options.priceCard ?? DEFAULT_AI_PRICE_CARD,
  });
}

export function createAiRuntime(options: CreateAiRuntimeOptions): AiRuntime {
  const campaignId = options.callContext?.campaignId ?? "api-local-v1";
  const profileId = options.callContext?.profileId ?? "api-profile-v1";
  const ports = createAiRuntimePorts(options);
  const index = new PgvectorCatalogIndex(options.db, options.userId);
  const secrets = Object.values(options.credentials).filter(
    (value): value is string => Boolean(value),
  );
  const buildForRun = (runId: string) => {
    const scopedPorts = createAiRuntimePorts({
      ...options,
      callContext: {
        campaignId,
        runId,
        profileId,
        ...(options.callContext?.trialId
          ? { trialId: options.callContext.trialId }
          : {}),
      },
    });
    const createRetriever = (catalog: ReviewedCatalogSnapshot) =>
      new PgvectorToolRetriever({
        catalog,
        index,
        embeddingPort: scopedPorts.embedding,
        queryExpansionPort: scopedPorts.queryExpansion,
        expectedEmbeddingProfile: options.config.embedding,
      });
    const createSession = async (
      catalog: ReviewedCatalogSnapshot,
      variant: RetrievalVariant,
    ) => createRetriever(catalog).createSession(variant);
    const plannerOptions = {
      root: options.root,
      gateway: options.gateway,
      modelClient: scopedPorts.model,
      createRetriever,
      createSession,
      // The selected mode is explicit. Semantic modes require a prepared,
      // provenance-matched active index and never fall back to all_tools.
      variant: options.retrievalVariant ?? "all_tools",
      topK: 10,
      maxPlanningCalls: options.config.limits.maxPlanningCalls,
      maxRepairCalls: 3,
      deadlineMs: options.config.limits.trialDeadlineMs,
      secrets,
    };
    return {
      ports: scopedPorts,
      planner: loadAiPlanner(plannerOptions),
      replan: loadAiReplan(plannerOptions),
    };
  };
  const planner = {
    mode: "ai" as const,
    async produce(input: Parameters<ReturnType<typeof loadAiPlanner>["produce"]>[0]) {
      return buildForRun(input.runId).planner.produce(input);
    },
  };
  const replan = {
    async replan(input: Parameters<ReturnType<typeof loadAiReplan>["replan"]>[0]) {
      return buildForRun(input.runId).replan.replan(input);
    },
  };
  return {
    ports,
    planner,
    replan,
    secrets,
    forRun: buildForRun,
  };
}
