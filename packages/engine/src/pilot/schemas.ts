import { z } from 'zod';

export const PilotProfileSchema = z.object({
  id: z.literal('pilot-v2'),
  enabled: z.boolean(),
  principals: z.array(z.string().min(1)).min(1),
  spreadsheetId: z.string().min(1),
  tabId: z.string().min(1),
  boardId: z.string().min(1),
  allowlistedLists: z.array(z.string().min(1)).optional(),
});

export type PilotProfile = z.infer<typeof PilotProfileSchema>;

export const SourceSnapshotSchema = z.object({
  id: z.string().uuid().optional(),
  runId: z.string().uuid(),
  sourceKey: z.string().min(1),
  sourceRevision: z.string().length(64),
  rawData: z.record(z.string(), z.string()),
  checklistVersion: z.string().min(1),
  checklistResult: z.record(z.string(), z.unknown()),
  createdAt: z.string().optional(),
});

export type SourceSnapshot = z.infer<typeof SourceSnapshotSchema>;

export const ReservationStatusEnum = z.enum([
  'reserved',
  'dispatched',
  'confirmed',
  'unknown',
  'cancelled',
]);

export type ReservationStatus = z.infer<typeof ReservationStatusEnum>;

export const BusinessReservationSchema = z.object({
  id: z.string().uuid().optional(),
  intentKey: z.string().min(1),
  sourceKey: z.string().min(1),
  boardId: z.string().min(1),
  runId: z.string().uuid(),
  status: ReservationStatusEnum,
  remoteId: z.string().nullable().optional(),
  remoteUrl: z.string().url().nullable().optional(),
  operationId: z.string().uuid().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type BusinessReservation = z.infer<typeof BusinessReservationSchema>;

export const TrelloReceiptSchema = z.object({
  cardId: z.string().min(1),
  url: z.string().url(),
  listId: z.string().min(1),
  boardId: z.string().min(1),
  title: z.string().min(1),
  intentKey: z.string().min(1),
});

export type TrelloReceipt = z.infer<typeof TrelloReceiptSchema>;

export const PilotRunRequestSchema = z.object({
  spreadsheetId: z.string().min(1),
  tabId: z.string().min(1),
  requestId: z.string().min(1),
  prompt: z.string().min(1).max(1000),
  principalId: z.string().min(1),
  timezone: z.string().default('Asia/Ho_Chi_Minh'),
});

export type PilotRunRequest = z.infer<typeof PilotRunRequestSchema>;

// ==========================================
// 1. POST /pilot/v2/runs
// ==========================================
export const PilotCreateRunBodySchema = z.object({
  spreadsheetId: z.string().min(1),
  tabId: z.string().min(1),
  requestId: z.string().min(1),
  userPrompt: z.string().min(1).max(2000),
  timeZone: z.string().default('Asia/Ho_Chi_Minh'),
  parentRunId: z.string().uuid().optional(),
}).strict();

export type PilotCreateRunBody = z.infer<typeof PilotCreateRunBodySchema>;

export const PilotRunAcceptedResponseSchema = z.object({
  runId: z.string().uuid(),
  status: z.literal('planning'),
  profile: z.literal('pilot-v2'),
  sourceKey: z.string().min(1),
  sourceRevision: z.string().length(64),
}).strict();

export type PilotRunAcceptedResponse = z.infer<typeof PilotRunAcceptedResponseSchema>;

// ==========================================
// 2. GET /pilot/v2/runs/:runId
// ==========================================
export const PilotStepActionSchema = z.object({
  tool: z.string(),
  args: z.record(z.string(), z.unknown()),
  sideEffect: z.enum(['read', 'write']),
}).strict();

export type PilotStepAction = z.infer<typeof PilotStepActionSchema>;

export const PilotPreviewSchema = z.object({
  snapshotHash: z.string().length(64),
  expiresAt: z.string(),
  actions: z.array(PilotStepActionSchema),
  unconfirmedBusiness: z.boolean(),
  missingFields: z.array(z.string()),
}).strict();

export type PilotPreview = z.infer<typeof PilotPreviewSchema>;

export const PilotRunDetailResponseSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  profile: z.literal('pilot-v2'),
  status: z.enum([
    'planning',
    'awaiting_approval',
    'running',
    'succeeded',
    'failed',
    'rejected',
    'expired',
    'refused',
    'needs_input',
    'reconciliation_required',
  ]),
  sourceKey: z.string().min(1),
  sourceRevision: z.string().length(64),
  checklistResult: z.object({
    valid: z.boolean(),
    unconfirmedBusiness: z.boolean(),
    missingFields: z.array(z.string()),
    evidences: z.record(z.string(), z.string()).optional(),
  }),
  preview: PilotPreviewSchema.nullable().optional(),
  receipt: TrelloReceiptSchema.nullable().optional(),
  clarificationQuestion: z.string().nullable().optional(),
  refusalReason: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  createdAt: z.string(),
  endedAt: z.string().nullable().optional(),
}).strict();

export type PilotRunDetailResponse = z.infer<typeof PilotRunDetailResponseSchema>;

// ==========================================
// 3. POST /pilot/v2/runs/:runId/approve
// ==========================================
export const PilotApproveBodySchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  snapshotHash: z.string().length(64),
}).strict();

export type PilotApproveBody = z.infer<typeof PilotApproveBodySchema>;

// ==========================================
// 4. GET /pilot/v2/catalog
// ==========================================
export const PilotCatalogItemSchema = z.object({
  name: z.string(),
  description: z.string(),
  sideEffect: z.enum(['read', 'write']),
  policyVersion: z.literal('pilot-v2'),
  inputSchema: z.record(z.string(), z.unknown()),
  outputSchema: z.record(z.string(), z.unknown()),
  allowed: z.boolean(),
}).strict();

export type PilotCatalogItem = z.infer<typeof PilotCatalogItemSchema>;

export const PilotCatalogResponseSchema = z.object({
  profile: z.literal('pilot-v2'),
  tools: z.array(PilotCatalogItemSchema),
}).strict();

export type PilotCatalogResponse = z.infer<typeof PilotCatalogResponseSchema>;

