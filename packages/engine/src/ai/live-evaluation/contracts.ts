import { PlannerResultSchema, type PlannerResult } from "@wap/dsl";
import { z } from "zod";
import type {
  GenerationProfile,
  EmbeddingProfile,
} from "../providers/config.js";
import {
  FixtureWriteSchema,
  ReadFixtureSchema,
  SplitSchema,
  type FixtureWrite,
  type Split,
} from "../evaluation/contracts.js";

export type ReadFixture = z.infer<typeof ReadFixtureSchema>;
export type { FixtureWrite, Split };

export const LiveExposureSchema = z.enum(["dev", "legacy_regression", "sealed_holdout"]);
export type LiveExposure = z.infer<typeof LiveExposureSchema>;

export const LiveCaseInputSchema = z
  .object({
    id: z.string().min(1),
    prompt: z.string().min(1),
    runtime: z.record(z.string(), z.string()),
  })
  .strict();

export interface LiveCaseInput {
  readonly id: string;
  readonly prompt: string;
  readonly runtime: Record<string, string>;
}

export const LiveCaseOracleSchema = z
  .object({
    id: z.string().min(1),
    expected_result: PlannerResultSchema,
    read_fixture: z.array(ReadFixtureSchema),
    expected_writes: z.array(FixtureWriteSchema),
    expected_outputs: z.record(z.string(), z.unknown()),
    forbid_extra_writes: z.boolean(),
  })
  .strict();

export interface LiveCaseOracle {
  readonly id: string;
  readonly expected_result: PlannerResult;
  readonly read_fixture: readonly ReadFixture[];
  readonly expected_writes: readonly FixtureWrite[];
  readonly expected_outputs: Record<string, unknown>;
  readonly forbid_extra_writes: boolean;
}

export const CaseRubricSchema = z
  .object({
    expectedKind: z.enum(["plan", "refusal", "clarification"]),
    semanticIntent: z.string().min(1),
    requiredReads: z
      .array(
        z.object({
          server: z.string().min(1),
          name: z.string().min(1),
        }),
      )
      .optional(),
    requiredWrites: z
      .array(
        z.object({
          server: z.string().min(1),
          name: z.string().min(1),
          keyArgs: z.array(z.string()).optional(),
        }),
      )
      .optional(),
    causalOrdering: z.array(z.tuple([z.string(), z.string()])).optional(),
    forbidExtraWrites: z.boolean().optional(),
    clarificationMissingInfo: z.array(z.string()).optional(),
    refusalReasonCategory: z.string().optional(),
    refusalKeywords: z.array(z.string()).optional(),
  })
  .strict();

export type CaseRubric = z.infer<typeof CaseRubricSchema>;

export const LiveRubricSchema = z
  .object({
    format: z.literal("ati-ai-live-rubric-v1"),
    status: z.enum(["PROPOSED_EXPLORATORY", "APPROVED_FROZEN"]),
    version: z.string().min(1),
    approvedBy: z.string().nullable(),
    approvedAt: z.string().nullable(),
    approvalBlockReason: z.string().optional(),
    cases: z.record(z.string(), CaseRubricSchema),
  })
  .strict();

export type LiveRubric = z.infer<typeof LiveRubricSchema>;

export interface LiveProfileConfig {
  readonly id: string;
  readonly description: string;
  readonly planning: GenerationProfile;
  readonly queryExpansion: GenerationProfile;
  readonly embedding: EmbeddingProfile;
  readonly limits?: {
    readonly requestTimeoutMs?: number;
    readonly trialDeadlineMs?: number;
    readonly maxPlanningCalls?: number;
    readonly maxReplanCalls?: number;
    readonly maxQueryExpansionCalls?: number;
    readonly reservationEstimateMicros?: number;
  };
}

export const SealedHoldoutBundleSchema = z
  .object({
    format: z.literal("ati-ai-live-sealed-holdout-v1"),
    approvedBy: z.string().min(1),
    approvedAt: z.string().datetime({ offset: true }),
    exposureHistory: z.literal("previously_unseen_fresh_holdout"),
    casesHash: z.string().regex(/^[a-f0-9]{64}$/),
    rubricHash: z.string().regex(/^[a-f0-9]{64}$/),
    budgetCapMicros: z.number().int().positive(),
  })
  .strict();

export type SealedHoldoutBundle = z.infer<typeof SealedHoldoutBundleSchema>;

export const LiveEvaluationFingerprintsSchema = z
  .object({
    dataset: z.string().regex(/^[a-f0-9]{64}$/),
    experimentManifest: z.string().regex(/^[a-f0-9]{64}$/),
    rubric: z.string().regex(/^[a-f0-9]{64}$/),
    catalog: z.string().regex(/^[a-f0-9]{64}$/),
    prompts: z.string().regex(/^[a-f0-9]{64}$/),
    evaluator: z.string().regex(/^[a-f0-9]{64}$/),
    config: z.string().regex(/^[a-f0-9]{64}$/),
    policiesAndArtifacts: z.string().regex(/^[a-f0-9]{64}$/),
    lockfile: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type LiveEvaluationFingerprints = z.infer<typeof LiveEvaluationFingerprintsSchema>;

export const FrozenLiveEvaluationSchema = z
  .object({
    format: z.literal("ati-ai-live-freeze-v1"),
    profileId: z.string().min(1),
    campaignId: z.string().min(1),
    createdAt: z.string().datetime({ offset: true }),
    fingerprints: LiveEvaluationFingerprintsSchema,
    profile: z.object({
      id: z.string(),
      description: z.string(),
      planning: z.object({
        provider: z.enum(["openai", "google"]),
        model: z.string(),
        apiMode: z.string(),
        maxOutputTokens: z.number(),
      }),
      queryExpansion: z.object({
        provider: z.enum(["openai", "google"]),
        model: z.string(),
        apiMode: z.string(),
        maxOutputTokens: z.number(),
      }),
      embedding: z.object({
        provider: z.enum(["openai", "google"]),
        model: z.string(),
        apiMode: z.string(),
        dimensions: z.literal(1536),
        preprocessingVersion: z.string(),
        documentTask: z.string(),
        queryTask: z.string(),
        normalize: z.boolean(),
      }),
    }),
    budgetCapMicros: z.number().int().positive().optional(),
    sealedHoldoutApproval: SealedHoldoutBundleSchema.optional(),
  })
  .strict();
export type FrozenLiveEvaluation = z.infer<typeof FrozenLiveEvaluationSchema>;


export type SemanticJudgment = "correct" | "incorrect" | "needs_review";

export interface CanonicalTrace {
  readonly candidateKind: "plan" | "refusal" | "clarification";
  readonly executedTools: readonly {
    readonly server: string;
    readonly name: string;
    readonly sideEffect: "read" | "write";
  }[];
  readonly writeIntents: readonly FixtureWrite[];
  readonly finalOutputs?: Record<string, unknown>;
  readonly clarificationQuestion?: string;
  readonly refusalReason?: string;
}

export interface LiveEvaluationScore {
  readonly structuralValidity: boolean;
  readonly fixtureExecutability: boolean | null;
  readonly semanticJudgment: SemanticJudgment;
  readonly safetyViolations: readonly string[];
  readonly reviewReason: string | null;
  readonly candidateKind: "plan" | "refusal" | "clarification" | null;
  readonly kindCorrect: boolean;
  readonly planValid: boolean | null;
  readonly taskCorrect: boolean | null;
  readonly outputCorrect: boolean | null;
  readonly writeIntents: readonly FixtureWrite[];
  readonly issues: readonly string[];
  readonly coverageLimitation?: boolean;
  readonly canonicalTrace?: CanonicalTrace;
  readonly toolRecall?: number | null;
  readonly refusalCorrect?: boolean | null;
  readonly clarificationCorrect?: boolean | null;
}

export interface LiveAdjudication {
  readonly judgeId: string;
  readonly judgment: "correct" | "incorrect";
  readonly reason: string;
  readonly adjudicatedAt: string;
}

export interface AdjudicationRecord {
  readonly caseId: string;
  readonly candidateHash: string;
  readonly adjudications: readonly [
    LiveAdjudication,
    LiveAdjudication,
    ...LiveAdjudication[],
  ];
  readonly resolved: boolean;
  readonly finalVerdict?: "correct" | "incorrect";
}

export type LiveRetrievalVariant = "all_tools" | "semantic" | "semantic_qe";
export type LiveTopK = 3 | 5 | 10;

export interface LiveEvaluationCell {
  readonly variant: LiveRetrievalVariant;
  readonly topK: LiveTopK;
}

export interface LiveTrialScheduleItem {
  readonly trialId: string;
  readonly profileId: string;
  readonly caseId: string;
  readonly cell: LiveEvaluationCell;
  readonly repetition: number;
}

export type LiveTrialStatus =
  | "scheduled"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "not_started";

export interface LiveModelCallSummary {
  readonly callId: string;
  readonly provider: string;
  readonly model: string;
  readonly purpose: string;
  readonly status: string;
  readonly latencyMs: number;
  readonly costMicros: number | null;
  readonly tokens: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly totalTokens?: number;
  } | null;
  readonly errorCode: string | null;
}

export interface LiveTrialOutcome {
  readonly trialId: string;
  readonly profileId: string;
  readonly caseId: string;
  readonly exposure: LiveExposure;
  readonly cell: LiveEvaluationCell;
  readonly repetition: number;
  readonly status: LiveTrialStatus;
  readonly modelCalls: readonly LiveModelCallSummary[];
  readonly score: LiveEvaluationScore | null;
  readonly latency: {
    readonly totalMs: number;
    readonly planningMs?: number;
    readonly retrievalMs?: number;
    readonly queryExpansionMs?: number;
    readonly embeddingMs?: number;
    readonly pgvectorMs?: number;
    readonly coldSetupMs?: number;
  };
  readonly error: string | null;
}

export interface LiveJournalEvent {
  readonly event:
    | "trial_scheduled"
    | "trial_started"
    | "provider_call_reserved"
    | "provider_call_settled"
    | "trial_completed"
    | "trial_failed"
    | "trial_cancelled"
    | "trial_not_started";
  readonly timestamp: string;
  readonly trialId: string;
  readonly payload: Record<string, unknown>;
}

export interface LiveAccountingBucket {
  readonly planned: number;
  readonly completed: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly notStarted: number;
}

export interface LiveTrialAccounting {
  readonly totalPlanned: number;
  readonly completed: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly notStarted: number;
  readonly byProfile: Readonly<Record<string, LiveAccountingBucket>>;
  readonly byCell: Readonly<Record<string, LiveAccountingBucket>>;
  readonly byExposure: Readonly<Record<string, LiveAccountingBucket>>;
  readonly bySplit?: Readonly<Record<string, LiveAccountingBucket>>;
}

export interface LiveLatencyPercentiles {
  readonly sampleCount: number;
  readonly p50Ms: number | null;
  readonly p90Ms: number | null;
  readonly p95Ms: number | null;
}

export interface LiveLatencyBreakdown {
  readonly planning: LiveLatencyPercentiles;
  readonly fullRetrieval: LiveLatencyPercentiles;
  readonly queryExpansion: LiveLatencyPercentiles;
  readonly queryEmbedding: LiveLatencyPercentiles;
  readonly pgvector: LiveLatencyPercentiles;
  readonly coldSetup?: LiveLatencyPercentiles;
}

export interface LiveQualityMetrics {
  readonly planValidRate: number | null;
  readonly semanticJudgments: {
    readonly correct: number;
    readonly incorrect: number;
    readonly needsReview: number;
  };
  readonly refusalAccuracy: {
    readonly expected: number;
    readonly correct: number;
    readonly rate: number | null;
  };
  readonly clarificationAccuracy: {
    readonly expected: number;
    readonly correct: number;
    readonly rate: number | null;
  };
  readonly retrievalRecall: {
    readonly total: number;
    readonly denominator: number;
    readonly value: number | null;
  };
  readonly totalRepairs: number;
}

export interface LiveCostReconciliation {
  readonly totalCalls: number;
  readonly settledCostMicros: number;
  readonly unknownCostCalls: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly byProvider: Readonly<
    Record<
      string,
      {
        readonly calls: number;
        readonly settledCostMicros: number;
        readonly inputTokens: number;
        readonly outputTokens: number;
      }
    >
  >;
}

export interface LiveRedactedObservation {
  readonly trialId: string;
  readonly profileId: string;
  readonly caseId: string;
  readonly exposure: LiveExposure;
  readonly cell: LiveEvaluationCell;
  readonly repetition: number;
  readonly status: LiveTrialStatus;
  readonly score: {
    readonly semanticJudgment: string | null;
    readonly planValid: boolean | null;
    readonly kindCorrect: boolean | null;
    readonly recall: number | null;
  } | null;
  readonly latencyMs: number;
  readonly modelCallCount: number;
  readonly error: string | null;
}

export interface LiveEvaluationReport {
  readonly format: "ati-ai-live-report-v1";
  readonly runId: string;
  readonly createdAt: string;
  readonly campaignId: string;
  readonly verdict:
    | "LIVE_EVALUATION_PASS"
    | "LIVE_EVALUATION_FAIL"
    | "LIVE_EVALUATION_PARTIAL";
  readonly freezeHash: string;
  readonly fingerprints: LiveEvaluationFingerprints;
  readonly trialAccounting: LiveTrialAccounting;
  readonly qualityMetrics: LiveQualityMetrics;
  readonly latency: LiveLatencyBreakdown;
  readonly costReconciliation: LiveCostReconciliation;
  readonly haltReason?: string;
  readonly observations: readonly LiveRedactedObservation[];
  readonly limitations: readonly string[];
}

