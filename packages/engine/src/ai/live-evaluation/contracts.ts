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
