export { WorkflowEngine, type ServerCatalogOptions } from "./engine.js";
export { accept } from "./accept.js";
export {
  parsePlannerResult,
  type PlannerPort,
  type CreateRun,
} from "./planner-port.js";
export {
  openLocalGateway,
  inspectLocalGateway,
  composeGateway,
  type Gateway,
  type GatewayResult,
  type CallContext,
  type ToolTarget,
  type ServerConnection,
  type GatewayServerInspection,
  type LocalGatewayConfig,
  type FilesystemWriteRequest,
  type FilesystemWriteHooks,
  type FilesystemDispatchContext,
} from "./gateway.js";
export {
  BeforeDispatchError,
  EngineError,
  type EngineTool,
} from "./snapshot.js";
export { safeProject, containsConfiguredSecret } from "./redaction.js";
export { receiverModeFor, type ReceiverMode } from "./receiver-policy.js";
export {
  loadFilesystemLaunch,
  captureFilesystemArtifact,
  captureFilesystemArtifactDeep,
} from "./launch-policy.js";
export {
  openFilesystemConnection,
  normalizeFilesystemReadResult,
  normalizeFilesystemWriteResult,
} from "./gateway-filesystem.js";
export {
  reserveFilesystemDispatch,
  recheckFilesystemDispatch,
  FilesystemAlreadyDispatchedError,
} from "./filesystem-authorization.js";
export {
  AiPlannerAdapter,
  AiPlannerError,
  type AiPlannerAdapterOptions,
  type ModelCallEvidence,
  type OfflineRetrievalVariant,
  type PlanValidator,
} from "./ai/planner.js";
export {
  createReviewedCatalogSnapshot,
  createLocalReviewedCatalog,
  loadLocalReviewedCatalog,
  toolContentHash,
  buildCatalogEmbeddingRows,
  serializeReviewedToolForEmbedding,
  buildEmbeddingPolicyVersion,
  createEmbeddingPolicyManifest,
  hashEmbeddingText,
  isEmbeddingPolicyVersion,
  EMBEDDING_ADAPTER_VERSION,
  REVIEWED_TOOL_SERIALIZER_VERSION,
  PgvectorCatalogIndex,
  PgvectorToolRetriever,
  InMemoryToolRetriever,
  RetrievalValidationError,
  assertExpectedEmbeddingProfile,
  validatePgvectorActivation,
  PGVECTOR_DIMENSIONS,
  type ActivePgvectorIndex,
  type PinnedEmbeddingIndex,
  type EmbeddingPolicyManifest,
  type ValidatedPgvectorActivation,
  type RetrievalRequest,
  type RetrievalResult,
  type RetrievalVariant,
  type AiRetrievalSession,
  type ToolRetriever,
  type QueryExpansionPort,
  type QueryExpansionResult,
  type QueryExpansionUsage,
  type StructuredModelClient,
  type StructuredModelResponse,
  type StructuredModelUsage,
  type EmbeddingPort,
  type EmbeddingResult,
  type EmbeddingUsage,
  type ToolEmbeddingRow,
  type ReviewedCatalogSnapshot,
  AiReplanAdapter,
  type AiReplanAdapterOptions,
  type LocalReplanPort,
  type LocalReplanInput,
  validateLocalScopeInvariants,
} from "./ai/index.js";
export {
  AiProviderConfigError,
  providerCapabilities,
  assertProviderModel,
  readAiProviderConfig,
  InMemoryProviderCallLedger,
  PostgresProviderCallLedger,
  createPostgresProviderCallLedger,
  ensurePostgresProviderCampaign,
  JournaledProviderCallLedger,
  restoreProviderCallRecords,
  createLiveEvaluationRuntime,
  recoverLiveEvaluationState,
  ProviderAccountingError,
  ProviderClientError,
  AiApprovalError,
  createAiPorts,
  parseAiLiveApprovalRecord,
  assertAiLiveApproval,
  encodePlannerWire,
  decodePlannerWire,
  openAiPlannerWireJsonSchema,
  googlePlannerWireJsonSchema,
  PlannerWireSchemaError,
} from "./ai/index.js";
export type {
  AiProvider,
  AiProviderConfig,
  AiProviderCredentials,
  AiPorts,
  CreateAiPortsOptions,
  FetchLike,
  GenerationProfile,
  EmbeddingProfile,
  ProviderCallLedger,
  ProviderCallReservation,
  ProviderCallSettlement,
  ProviderCallRecord,
  AuthorizeProviderCall,
  ProviderAuthorizationContext,
  AiProviderCallContext,
  AiLiveApprovalRecord,
  PlannerWire,
  ProviderPriceCard,
} from "./ai/index.js";
export {
  executeReplan,
  type ExecuteReplanOptions,
  type ReplanCertainty,
} from "./replan.js";
export { type ExecuteOptions } from "./execute.js";
export {
  parseDataset,
  selectCases,
  assertCatalogSupportsDataset,
  assertFrozen,
  EvaluationDatasetError,
} from "./ai/evaluation/dataset.js";
export {
  scoreCandidate,
  type EvaluationScore,
  type ScoreCandidateRequest,
} from "./ai/evaluation/scorer.js";
// The offline evaluator is intentionally not part of the package API. Its
// executable boundary is the guarded AI-04 CLI, which creates and checks the
// freeze before selecting a split. Unit tests import the internal seam directly.
export {
  buildOfflineEvaluationReport,
  renderOfflineEvaluationMarkdown,
  type OfflineEvaluationReport,
  type OfflineEvaluationSummary,
  type Ratio,
} from "./ai/evaluation/report.js";
export {
  EvalConfigSchema,
  EvalDatasetSchema,
  ExperimentManifestSchema,
  FrozenEvaluationSchema,
  type EvalCase,
  type EvalConfig,
  type FrozenEvaluation,
} from "./ai/evaluation/contracts.js";

// Pilot MVP v2
export * from "./pilot/identity.js";
export * from "./pilot/source.js";
export * from "./pilot/policy.js";
export * from "./pilot/checklist.js";
export * from "./pilot/schemas.js";
export * from "./pilot/config.js";
export * from "./pilot/http-client.js";
export * from "./pilot/gateway.js";
export * from "./pilot/dispatch.js";
export * from "./pilot/postgres-store.js";
export * from "./pilot/adapters/sheets.js";
export * from "./pilot/adapters/trello-read.js";
export * from "./pilot/adapters/trello-write.js";
export * from "./pilot/planner-context.js";
export * from "./pilot/accounting.js";
export * from "./pilot/decision-engine.js";

