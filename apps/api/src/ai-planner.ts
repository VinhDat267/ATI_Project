import {
  AiPlannerAdapter,
  AiPlannerError,
  AiReplanAdapter,
  loadLocalReviewedCatalog,
  type Gateway,
  type PlannerPort,
  type LocalReplanPort,
  type StructuredModelClient,
  type ToolRetriever,
  type ReviewedCatalogSnapshot,
  type RetrievalVariant,
} from "@wap/engine";

export interface LoadAiPlannerOptions {
  readonly root: string;
  /** The reviewed execution gateway; catalog state is sampled per request. */
  readonly gateway: Gateway;
  readonly modelClient?: StructuredModelClient;
  /** Explicit composition seam. Production must provide a persisted-index retriever. */
  readonly createRetriever: (catalog: ReviewedCatalogSnapshot) => ToolRetriever;
  readonly variant?: RetrievalVariant;
  readonly topK?: number;
  readonly maxPlanningCalls?: number;
  readonly maxReplanCalls?: number;
  readonly deadlineMs?: number;
}

async function loadRuntimeCatalog(options: LoadAiPlannerOptions) {
  await options.gateway.ensureConnected?.();
  await options.gateway.assertCurrent();
  return loadLocalReviewedCatalog(options.root, options.gateway.tools);
}

function configuredModel(options: LoadAiPlannerOptions): StructuredModelClient {
  const defaultUnconfiguredClient: StructuredModelClient = {
    async complete() {
      throw new AiPlannerError(
        "INVALID_CONFIGURATION",
        "AI model provider unconfigured: missing provider credentials. Silent fallback to dev_fixture is forbidden.",
        0,
      );
    },
  };
  return options.modelClient ?? defaultUnconfiguredClient;
}

function createPlanner(
  options: LoadAiPlannerOptions,
  catalog: ReturnType<typeof loadLocalReviewedCatalog>,
): AiPlannerAdapter {
  return new AiPlannerAdapter({
    retriever: options.createRetriever(catalog),
    model: configuredModel(options),
    variant: options.variant ?? "all_tools",
    topK: options.topK ?? 10,
    maxPlanningCalls: options.maxPlanningCalls ?? 3,
    deadlineMs: options.deadlineMs ?? 60_000,
    validatePlan: () => [],
  });
}

export function loadAiPlanner(options: LoadAiPlannerOptions): PlannerPort {
  return {
    mode: "ai",
    async produce(input) {
      return createPlanner(options, await loadRuntimeCatalog(options)).produce(
        input,
      );
    },
  };
}

function createReplanner(
  options: LoadAiPlannerOptions,
  catalog: ReturnType<typeof loadLocalReviewedCatalog>,
): AiReplanAdapter {
  return new AiReplanAdapter({
    retriever: options.createRetriever(catalog),
    model: configuredModel(options),
    variant: options.variant ?? "all_tools",
    topK: options.topK ?? 10,
    maxRepairCalls: options.maxReplanCalls ?? 2,
    deadlineMs: options.deadlineMs ?? 60_000,
    validatePlan: () => [],
  });
}

export function loadAiReplan(options: LoadAiPlannerOptions): LocalReplanPort {
  return {
    async replan(input) {
      return createReplanner(options, await loadRuntimeCatalog(options)).replan(
        input,
      );
    },
  };
}
