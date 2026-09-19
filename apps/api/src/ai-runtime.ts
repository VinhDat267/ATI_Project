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

export function createAiRuntimePorts(
  options: AiRuntimePortsOptions,
): AiPorts {
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
  const plannerOptions = {
    root: options.root,
    gateway: options.gateway,
    modelClient: ports.model,
    createRetriever,
    maxPlanningCalls: options.config.limits.maxPlanningCalls,
    maxReplanCalls: options.config.limits.maxReplanCalls,
    deadlineMs: options.config.limits.trialDeadlineMs,
  };
  return {
    ports,
    planner: loadAiPlanner(plannerOptions),
    replan: loadAiReplan(plannerOptions),
    secrets: Object.values(options.credentials).filter(
      (value): value is string => Boolean(value),
    ),
  };
}
