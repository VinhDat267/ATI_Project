import { PlannerResultSchema, type PlannerResult } from "@wap/dsl";
import { z } from "zod";

export const SplitSchema = z.enum(["dev", "holdout"]);
export type Split = z.infer<typeof SplitSchema>;

export const RetrievalVariantSchema = z.enum([
  "all_tools",
  "semantic",
  "semantic_qe",
]);
export type RetrievalVariant = z.infer<typeof RetrievalVariantSchema>;
export const TopKSchema = z.union([z.literal(3), z.literal(5), z.literal(10)]);
export const CellSchema = z
  .object({
    variant: RetrievalVariantSchema,
    topK: TopKSchema,
  })
  .strict();
export type Cell = z.infer<typeof CellSchema>;

export const FixtureWriteSchema = z
  .object({
    server: z.enum(["task_hub", "filesystem"]),
    name: z.string().min(1),
    args: z.record(z.string(), z.unknown()),
  })
  .strict();
export type FixtureWrite = z.infer<typeof FixtureWriteSchema>;

export const ReadFixtureSchema = FixtureWriteSchema.extend({
  output: z.unknown(),
}).strict();

export const EvalCaseSchema = z
  .object({
    id: z.string().regex(/^b(?:0[1-9]|10)$/),
    split: SplitSchema,
    profile: z.literal("B-local-v1"),
    prompt: z.string().min(1),
    expected_result: PlannerResultSchema,
    read_fixture: z.array(ReadFixtureSchema),
    expected_writes: z.array(FixtureWriteSchema),
    expected_outputs: z.record(z.string(), z.unknown()),
    forbid_extra_writes: z.boolean(),
  })
  .strict();
export type EvalCase = Omit<z.infer<typeof EvalCaseSchema>, "expected_result"> & {
  expected_result: PlannerResult;
};

export const EvalDatasetSchema = z
  .object({
    profile: z.literal("B-local-v1"),
    evidence: z.literal("HAND_AUTHORED_EXECUTABILITY_FIXTURES_NOT_MODEL_RESULTS"),
    runtime: z
      .object({
        now: z.string().datetime({ offset: true }),
        time_zone: z.string().min(1),
        run_id: z.string().min(1),
        user_id: z.string().min(1),
      })
      .strict(),
    cases: z.array(EvalCaseSchema),
  })
  .strict();
export type EvalDataset = Omit<z.infer<typeof EvalDatasetSchema>, "cases"> & {
  cases: readonly EvalCase[];
};
/** Compatibility aliases used by the runner's dependency-injected boundary. */
export type EvaluationDataset = EvalDataset;
export type EvaluationRuntime = z.infer<typeof EvalDatasetSchema>["runtime"];

export const ExperimentManifestSchema = z
  .object({
    status: z.literal("NOT_RUN"),
    profile: z.literal("B-local-v1"),
    catalog_file: z.literal("tools.json"),
    cases_file: z.literal("test-cases.json"),
    split: z
      .object({
        dev: z.array(z.string()),
        holdout: z.array(z.string()),
      })
      .strict(),
    variants: z.array(RetrievalVariantSchema),
    top_k: z.array(TopKSchema),
    repetitions_per_case_variant: z.literal(3),
    required_before_run: z.array(z.string()),
    metrics: z.array(z.string()),
    thresholds: z.record(z.string(), z.number()),
    acceptance_note: z.string().min(1),
  })
  .strict();

export const EvalConfigSchema = z
  .object({
    mode: z.literal("offline"),
    cells: z.array(CellSchema).min(1),
    repetitions: z.literal(3),
    maxPlanningCalls: z.literal(3),
    deadlineMs: z.number().int().positive(),
    modelFixture: z.string().min(1),
    embeddingFixture: z.string().min(1),
    expansionFixture: z.string().min(1),
  })
  .strict();
export type EvalConfig = z.infer<typeof EvalConfigSchema>;

const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const FingerprintsSchema = z
  .object({
    dataset: HashSchema,
    experimentManifest: HashSchema,
    catalog: HashSchema,
    prompts: HashSchema,
    evaluator: HashSchema,
    fixtures: HashSchema,
    config: HashSchema,
    policiesAndArtifacts: HashSchema,
    lockfile: HashSchema,
  })
  .strict();
export type Fingerprints = z.infer<typeof FingerprintsSchema>;

export const FrozenEvaluationSchema = z
  .object({
    format: z.literal("ati-ai04-freeze-v1"),
    mode: z.literal("offline"),
    fingerprints: FingerprintsSchema,
    config: EvalConfigSchema,
    holdoutExposure: z.literal("previously_exercised_by_offline_tests"),
  })
  .strict();
export type FrozenEvaluation = z.infer<typeof FrozenEvaluationSchema>;
