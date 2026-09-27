import { z } from "zod";

export const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const UuidSchema = z.uuid();
export const PositiveUnitsSchema = z.number().int().safe().positive();
export const UnitsSchema = z.number().int().safe().nonnegative();
export const ArtifactHashesSchema = z.object({
  code: DigestSchema, projection: DigestSchema, prompt: DigestSchema,
  schema: DigestSchema, fixtures: DigestSchema, oracle: DigestSchema,
  fakeScript: DigestSchema, rubric: DigestSchema,
}).strict();
export type ArtifactHashes = z.infer<typeof ArtifactHashesSchema>;

export const PrincipalSchema = z.object({
  alias: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_-]*$/),
  id: UuidSchema, maxCalls: PositiveUnitsSchema, limitMicros: PositiveUnitsSchema,
}).strict();
export const FixtureConfigSchema = z.object({
  spreadsheetId: z.string().min(1).max(128), tabId: z.string().min(1).max(128),
  boardId: z.string().min(1).max(128), listId: z.string().min(1).max(128),
  requestId: z.string().min(1).max(128),
}).strict();
export const FakeScriptIdSchema = z.enum([
  "plan", "clarification", "refusal", "invalid", "throw", "unknown", "delayed",
]);
export const SlotDescriptorSchema = z.object({
  slotId: z.string().min(1).max(128), ordinal: UnitsSchema, inputHash: DigestSchema,
  language: z.enum(["en", "vi"]), principalAlias: PrincipalSchema.shape.alias,
  declaredEligibility: z.enum(["eligible", "deterministic", "out_of_scope"]),
  scriptId: FakeScriptIdSchema, fixture: FixtureConfigSchema,
}).strict();
export const ManifestDraftSchema = z.object({
  format: z.literal("pilot-advisory-offline-v1"), measurementId: UuidSchema,
  gitCommit: DigestSchema, executionMode: z.literal("offline_fake"),
  outputContract: z.literal("pilot-advisory-v1"), catalogMode: z.literal("fixed"),
  costEvidence: z.literal("SIMULATED_NOT_BILLED"),
  schemaVersion: z.literal("pilot-eval-1"), rubricVersion: z.string().min(1).max(64),
  fakeScriptVersion: z.literal("builtin-1"),
  provider: z.enum(["google", "openai"]),
  model: z.string().regex(/^offline-fixture-[a-z0-9-]{1,64}$/),
  estimatedCostMicros: PositiveUnitsSchema, timeoutMs: z.number().int().min(1).max(30_000),
  principals: z.tuple([PrincipalSchema, PrincipalSchema]),
  slots: z.array(SlotDescriptorSchema).min(1).max(100),
}).strict().superRefine((data, context) => {
  if (data.principals[0].alias === data.principals[1].alias ||
      data.principals[0].id === data.principals[1].id)
    context.addIssue({ code: "custom", message: "Duplicate principal mapping" });
  const ids = new Set<string>();
  for (const [index, slot] of data.slots.entries()) {
    if (slot.ordinal !== index || ids.has(slot.slotId))
      context.addIssue({ code: "custom", message: "Duplicate or unordered slot" });
    if (!data.principals.some((principal) => principal.alias === slot.principalAlias))
      context.addIssue({ code: "custom", message: "Unknown principal alias" });
    ids.add(slot.slotId);
  }
});
export const FrozenManifestSchema = ManifestDraftSchema.safeExtend({
  artifacts: ArtifactHashesSchema, manifestHash: DigestSchema,
});
export type ManifestDraft = z.input<typeof ManifestDraftSchema>;
export type FrozenManifest = z.output<typeof FrozenManifestSchema>;
export type SlotDescriptor = z.output<typeof SlotDescriptorSchema>;

export const FixtureBundleSchema = z.object({
  slots: z.array(z.object({
    slotId: SlotDescriptorSchema.shape.slotId, inputHash: DigestSchema,
    scriptId: FakeScriptIdSchema,
    row: z.object({
      request_id: z.string().min(1).max(128), client_ref: z.string().max(500),
      request_type: z.string().max(128), raw_request: z.string().max(4000),
      deliverable: z.string().max(500), due_date: z.string().max(32),
      decision_status: z.string().max(128), source_note: z.string().max(500),
    }).strict().optional(),
  }).strict()).min(1).max(100),
}).strict();
export type FixtureBundle = z.output<typeof FixtureBundleSchema>;

export const DatabaseIdentitySchema = z.object({
  measurementId: UuidSchema, databaseName: z.string().regex(/^pilot_eval_[0-9a-f]{32}$/),
  schemaVersion: z.literal("pilot-eval-1"), markerNonceHash: DigestSchema,
  expectedRuntimeRole: z.string().regex(/^pilot_runtime_[0-9a-f]{32}$/),
}).strict();
export type DatabaseIdentity = z.output<typeof DatabaseIdentitySchema>;

export const SafeEventTypeSchema = z.enum([
  "slot_intent", "callback_entered", "fake_return", "fake_error", "http_outcome", "cleanup", "late_return",
]);
export const SafeEventSchema = z.object({
  seq: PositiveUnitsSchema, type: SafeEventTypeSchema, slotId: SlotDescriptorSchema.shape.slotId,
  runId: UuidSchema.optional(), callId: UuidSchema.optional(),
  durationMs: z.number().finite().nonnegative().max(86_400_000),
  payload: z.object({ code: z.string().regex(/^[A-Z_]{1,64}$/).optional(),
    kind: z.enum(["plan", "clarification", "refusal", "invalid", "error"]).optional(),
    valid: z.boolean().optional(), digest: DigestSchema.optional(),
    usageKnown: z.boolean().optional(), costKnown: z.boolean().optional(),
    costMicros: UnitsSchema.nullable().optional(),
    inputTokens: UnitsSchema.nullable().optional(), outputTokens: UnitsSchema.nullable().optional(),
    status: z.string().regex(/^[a-z_]{1,64}$/).optional(),
    previewHash: DigestSchema.optional(),
  }).strict(),
  previousHash: DigestSchema, eventHash: DigestSchema,
}).strict();
export type SafeEvent = z.output<typeof SafeEventSchema>;
export const SlotSealSchema = z.object({
  slotId: SlotDescriptorSchema.shape.slotId, eventStart: UnitsSchema,
  eventEnd: UnitsSchema, eventHash: DigestSchema, ledgerSnapshotHash: DigestSchema,
  completeness: z.enum(["complete", "incomplete"]),
  reason: z.enum(["OK", "NOT_ATTEMPTED", "UNLINKED_RUN", "OBSERVATION_GAP", "ACCOUNTING_UNKNOWN", "CLEANUP_FAILED", "INELIGIBLE", "POLICY_BLOCKED"]),
  sealHash: DigestSchema,
}).strict();
export type SlotSeal = z.output<typeof SlotSealSchema>;
