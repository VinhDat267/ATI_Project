import {
  createAiPorts,
  ProviderClientError,
  type AiProviderCallContext,
  type AiProviderConfig,
  type AiProviderCredentials,
  type AiPorts,
  type AuthorizeProviderCall,
  type FetchLike,
  type ProviderCallLedger,
  PgvectorCatalogIndex,
  PgvectorToolRetriever,
  type Gateway,
  type ReviewedCatalogSnapshot,
  type RetrievalVariant,
} from "@wap/engine";
import type { Database } from "@wap/db";
import { loadAiPlanner, loadAiReplan } from "./ai-planner.js";

export interface AiRuntimePortsOptions {
  readonly config: AiProviderConfig;
  readonly credentials: AiProviderCredentials;
  readonly ledger?: ProviderCallLedger;
  readonly authorizeCall?: AuthorizeProviderCall;
  readonly callContext?: AiProviderCallContext;
  readonly fetchImpl?: FetchLike;
  readonly now?: () => number;
}

export interface CreateAiRuntimeOptions extends AiRuntimePortsOptions {
  readonly db: Database;
  readonly gateway: Gateway;
  readonly root: string;
  readonly userId: string;
}

export interface AiRuntime {
  readonly ports: AiPorts;
  readonly planner: ReturnType<typeof loadAiPlanner>;
  readonly replan: ReturnType<typeof loadAiReplan>;
  readonly secrets: readonly string[];
}

/**
 * Native provider execution stays disabled until T6 supplies durable
 * authorization and accounting. The denial happens before credential lookup,
 * reservation, and network dispatch.
 */
export async function denyAiLiveCalls(): Promise<never> {
  throw new ProviderClientError(
    "AI_LIVE_NOT_READY",
    "AI live provider execution is not enabled until durable authorization and accounting are installed",
    { provider: "runtime" },
  );
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
  });
}

export function createAiRuntime(options: CreateAiRuntimeOptions): AiRuntime {
  const ports = createAiRuntimePorts(options);
  const index = new PgvectorCatalogIndex(options.db, options.userId);
  const createRetriever = (catalog: ReviewedCatalogSnapshot) =>
    new PgvectorToolRetriever({
      catalog,
      index,
      embeddingPort: ports.embedding,
      queryExpansionPort: ports.queryExpansion,
      expectedEmbeddingProfile: options.config.embedding,
    });
  const createSession = async (
    catalog: ReviewedCatalogSnapshot,
    variant: RetrievalVariant,
  ) => createRetriever(catalog).createSession(variant);
  const secrets = Object.values(options.credentials).filter(
    (value): value is string => Boolean(value),
  );
  const plannerOptions = {
    root: options.root,
    gateway: options.gateway,
    modelClient: ports.model,
    createRetriever,
    createSession,
    // Keep production composition explicit until T5 selects a live retrieval
    // profile; all reviewed tools is fail-closed and requires no index.
    variant: "all_tools" as const,
    topK: 10,
    maxPlanningCalls: options.config.limits.maxPlanningCalls,
    maxRepairCalls: 3,
    deadlineMs: options.config.limits.trialDeadlineMs,
    secrets,
  };
  return {
    ports,
    planner: loadAiPlanner(plannerOptions),
    replan: loadAiReplan(plannerOptions),
    secrets,
  };
}
