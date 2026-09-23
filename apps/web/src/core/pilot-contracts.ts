import { z } from "zod";

export const PilotCreateRunInputSchema = z.object({
  requestId: z.string().min(1, "Vui lòng nhập mã yêu cầu"),
  spreadsheetId: z.string().min(1, "Vui lòng nhập ID Google Sheets").default("sheet-pilot-001"),
  tabId: z.string().min(1, "Vui lòng nhập tên/mã Tab").default("tab-001"),
  userPrompt: z.string().min(1, "Vui lòng nhập mô tả yêu cầu").max(2000),
  timeZone: z.string().default("Asia/Ho_Chi_Minh").optional(),
  parentRunId: z.string().uuid().optional(),
});

export type PilotCreateRunInput = z.infer<typeof PilotCreateRunInputSchema>;

export const PilotCheckInputSchema = z.object({
  requestId: z.string().min(1), spreadsheetId: z.string().min(1),
  tabId: z.string().min(1), userPrompt: z.string().min(1).max(2000),
});
export type PilotCheckInput = z.infer<typeof PilotCheckInputSchema>;
export const PilotCheckResponseSchema = z.object({
  status: z.enum(["checked", "needs_input", "refused"]),
  sourceKey: z.string(), sourceRevision: z.string(),
  checklistResult: z.object({ valid: z.boolean(), unconfirmedBusiness: z.boolean(),
    missingFields: z.array(z.string()), conflicts: z.array(z.string()),
    evidences: z.record(z.string(), z.string()), summary: z.string() }),
  summary: z.string().nullable(), clarificationQuestion: z.string().nullable(),
  refusalReason: z.string().nullable(),
});
export type PilotCheckResponse = z.infer<typeof PilotCheckResponseSchema>;
export const PilotLookupInputSchema = z.object({
  requestId: z.string().min(1), spreadsheetId: z.string().min(1), tabId: z.string().min(1),
});
export type PilotLookupInput = z.infer<typeof PilotLookupInputSchema>;
export const PilotLookupResponseSchema = z.object({
  status: z.enum(["found", "not_linked", "unknown", "reconciliation_required"]),
  sourceKey: z.string(),
  card: z.object({ id: z.string(), name: z.string(), description: z.string(),
    listId: z.string(), due: z.string().nullable(), members: z.array(z.string()),
    url: z.string().url() }).nullable(),
});
export type PilotLookupResponse = z.infer<typeof PilotLookupResponseSchema>;

export const PilotSourceSnapshotSchema = z.object({
  requestId: z.string(),
  clientRef: z.string().optional(),
  requestType: z.string().optional(),
  rawRequest: z.string().optional(),
  deliverable: z.string().optional(),
  dueDate: z.string().optional(),
  decisionStatus: z.string().optional(),
});

export type PilotSourceSnapshot = z.infer<typeof PilotSourceSnapshotSchema>;

export const PilotChecklistResultSchema = z.object({
  valid: z.boolean(),
  unconfirmedBusiness: z.boolean(),
  missingFields: z.array(z.string()),
  evidences: z.record(z.string(), z.string()).optional(),
  summary: z.string().optional(),
});

export type PilotChecklistResult = z.infer<typeof PilotChecklistResultSchema>;

export const PilotPreviewActionSchema = z.object({
  tool: z.string(),
  args: z.record(z.string(), z.unknown()),
  sideEffect: z.enum(["read", "write"]),
});

export type PilotPreviewAction = z.infer<typeof PilotPreviewActionSchema>;

export const PilotPreviewSchema = z.object({
  approvalId: z.string().uuid().optional(),
  versionId: z.string().uuid().optional(),
  snapshotHash: z.string().optional(),
  expiresAt: z.string().optional(),
  actions: z.array(PilotPreviewActionSchema),
  unconfirmedBusiness: z.boolean().optional(),
  missingFields: z.array(z.string()).optional(),
  explanation: z.string().optional(),
});

export type PilotPreview = z.infer<typeof PilotPreviewSchema>;

export const PilotAccountingSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  costMicroUsd: z.number(),
});

export type PilotAccounting = z.infer<typeof PilotAccountingSchema>;

export const PilotTrelloReceiptSchema = z.object({
  cardId: z.string().min(1),
  url: z.string().optional(),
  cardUrl: z.string().optional(),
  listId: z.string().optional(),
  boardId: z.string().optional(),
  title: z.string().optional(),
  intentKey: z.string().optional(),
  confirmedAt: z.string().optional(),
});

export type PilotTrelloReceipt = z.infer<typeof PilotTrelloReceiptSchema>;

export const PilotRunStatusSchema = z.enum([
  "planning",
  "validating",
  "dry_running",
  "awaiting_approval",
  "running",
  "replanning",
  "succeeded",
  "failed",
  "rejected",
  "cancelled",
  "expired",
  "refused",
  "needs_input",
  "reconciliation_required",
]);

export type PilotRunStatus = z.infer<typeof PilotRunStatusSchema>;

export const PilotCreateRunResponseSchema = z.object({
  runId: z.string(),
  status: z.string(),
  profile: z.string().optional(),
  sourceKey: z.string().optional(),
  sourceRevision: z.string().optional(),
  // Optional extra fields for backward/future compat
  sourceSnapshot: PilotSourceSnapshotSchema.optional(),
  checklistResult: PilotChecklistResultSchema.optional(),
  preview: PilotPreviewSchema.optional(),
  accounting: PilotAccountingSchema.optional(),
  snapshotHash: z.string().optional(),
  expiresAt: z.string().optional(),
  error: z.string().optional(),
});

export type PilotCreateRunResponse = z.infer<typeof PilotCreateRunResponseSchema>;

export const PilotRunDetailResponseSchema = z.object({
  id: z.string(),
  runId: z.string().optional(),
  userId: z.string().optional(),
  profile: z.string().optional(),
  status: PilotRunStatusSchema,
  sourceKey: z.string().optional(),
  sourceRevision: z.string().optional(),
  sourceSnapshot: PilotSourceSnapshotSchema.optional(),
  checklistResult: PilotChecklistResultSchema.optional(),
  preview: PilotPreviewSchema.nullable().optional(),
  receipt: PilotTrelloReceiptSchema.nullable().optional(),
  accounting: PilotAccountingSchema.optional(),
  clarificationQuestion: z.string().nullable().optional(),
  refusalReason: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  endedAt: z.string().nullable().optional(),
  updatedAt: z.string().optional(),
  // Backward-compat aliases if present at root:
  snapshotHash: z.string().optional(),
  expiresAt: z.string().optional(),
});

export type PilotRunDetailResponse = z.infer<typeof PilotRunDetailResponseSchema>;

export const PilotApproveInputSchema = z.object({
  approvalId: z.string().uuid(),
  versionId: z.string().uuid(),
  snapshotHash: z.string().min(1, "Thiếu mã băm snapshot"),
  decision: z.enum(["approved", "rejected"]),
});

export type PilotApproveInput = z.infer<typeof PilotApproveInputSchema>;

export const PilotApproveResponseSchema = z.object({
  status: z.enum([
    "succeeded",
    "expired",
    "rejected",
    "reconciliation_required",
    "failed",
  ]),
  receipt: PilotTrelloReceiptSchema.optional(),
  error: z.string().optional(),
});

export type PilotApproveResponse = z.infer<typeof PilotApproveResponseSchema>;

export const PilotCatalogToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  sideEffect: z.enum(["read", "write"]),
});

export const PilotCatalogResponseSchema = z.object({
  profile: z.string().optional(),
  tools: z.array(PilotCatalogToolSchema),
});

export type PilotCatalogResponse = z.infer<typeof PilotCatalogResponseSchema>;
