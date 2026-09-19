import {
  AiPlannerAdapter,
  AiPlannerError,
  AiReplanAdapter,
  loadLocalReviewedCatalog,
  type Gateway,
  type PlannerPort,
  type LocalReplanPort,
  type StructuredModelClient,
  type AiRetrievalSession,
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
  /** Optional request-scoped session; used to pin and revalidate semantic indexes. */
  readonly createSession?: (
    catalog: ReviewedCatalogSnapshot,
    variant: RetrievalVariant,
  ) => Promise<AiRetrievalSession>;
  readonly variant?: RetrievalVariant;
  readonly topK?: number;
  readonly maxPlanningCalls?: number;
  /** Local replan count is enforced by WorkflowEngine; this is model repair attempts. */
  readonly maxRepairCalls?: number;
  /** @deprecated Kept for callers while local replan policy stays in WorkflowEngine. */
  readonly maxReplanCalls?: number;
  readonly deadlineMs?: number;
  readonly secrets?: readonly string[];
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

async function createPlanner(
  options: LoadAiPlannerOptions,
  catalog: ReturnType<typeof loadLocalReviewedCatalog>,
): Promise<AiPlannerAdapter> {
  const variant = options.variant ?? "all_tools";
  const session = options.createSession
    ? await options.createSession(catalog, variant)
    : {
        retriever: options.createRetriever(catalog),
        assertCurrent: async () => {},
      };
  return new AiPlannerAdapter({
    retriever: session.retriever,
    assertCurrent: session.assertCurrent,
    model: configuredModel(options),
    variant,
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
      return (
        await createPlanner(options, await loadRuntimeCatalog(options))
      ).produce(input);
    },
  };
}

async function createReplanner(
  options: LoadAiPlannerOptions,
  catalog: ReturnType<typeof loadLocalReviewedCatalog>,
): Promise<AiReplanAdapter> {
  const variant = options.variant ?? "all_tools";
  const session = options.createSession
    ? await options.createSession(catalog, variant)
    : {
        retriever: options.createRetriever(catalog),
        assertCurrent: async () => {},
      };
  return new AiReplanAdapter({
    retriever: session.retriever,
    assertCurrent: session.assertCurrent,
    model: configuredModel(options),
    variant,
    topK: options.topK ?? 10,
    maxRepairCalls: options.maxRepairCalls ?? 3,
    deadlineMs: options.deadlineMs ?? 60_000,
    secrets: options.secrets,
    validatePlan: () => [],
  });
}

export function loadAiReplan(options: LoadAiPlannerOptions): LocalReplanPort {
  return {
    async replan(input) {
      return (
        await createReplanner(options, await loadRuntimeCatalog(options))
      ).replan(input);
    },
  };
}
