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
