import type { PilotConfig } from './config.js';
import type { PilotPolicy } from './policy.js';
import type { TrelloReceipt } from './schemas.js';
import { dispatchPilotTool } from './gateway.js';

export type ReservationStatus =
  | 'reserved'
  | 'dispatched'
  | 'confirmed'
  | 'unknown'
  | 'cancelled';

export type ReservationRecord = {
  id: string;
  intentKey: string;
  sourceKey: string;
  boardId: string;
  runId: string;
  status: ReservationStatus;
  remoteId?: string;
  remoteUrl?: string;
  operationId?: string;
  createdAt: Date;
  updatedAt: Date;
};

export interface BusinessReservationStore {
  getReservation(intentKey: string): Promise<ReservationRecord | null>;
  reserve(data: {
    intentKey: string;
    sourceKey: string;
    boardId: string;
    runId: string;
  }): Promise<ReservationRecord>;
  claimDispatched(intentKey: string, operationId: string): Promise<void>;
  confirm(intentKey: string, remoteId: string, remoteUrl: string): Promise<void>;
  markUnknown(intentKey: string): Promise<void>;
}

export class InMemoryReservationStore implements BusinessReservationStore {
  private map = new Map<string, ReservationRecord>();

  async getReservation(intentKey: string): Promise<ReservationRecord | null> {
    return this.map.get(intentKey) ?? null;
  }

  async reserve(data: {
    intentKey: string;
    sourceKey: string;
    boardId: string;
    runId: string;
  }): Promise<ReservationRecord> {
    const existing = this.map.get(data.intentKey);
    if (existing) {
      if (existing.status === 'confirmed') {
        return existing;
      }
      throw new Error(
        `INTENT_ALREADY_RESERVED: Intent ${data.intentKey} is already in state "${existing.status}"`,
      );
    }

    const record: ReservationRecord = {
      id: `res-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      intentKey: data.intentKey,
      sourceKey: data.sourceKey,
      boardId: data.boardId,
      runId: data.runId,
      status: 'reserved',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.map.set(data.intentKey, record);
    return record;
  }

  async claimDispatched(intentKey: string, operationId: string): Promise<void> {
    const rec = this.map.get(intentKey);
    if (!rec) throw new Error(`NOT_FOUND: Reservation ${intentKey} not found`);
    rec.status = 'dispatched';
    rec.operationId = operationId;
    rec.updatedAt = new Date();
  }

  async confirm(intentKey: string, remoteId: string, remoteUrl: string): Promise<void> {
    const rec = this.map.get(intentKey);
    if (!rec) throw new Error(`NOT_FOUND: Reservation ${intentKey} not found`);
    rec.status = 'confirmed';
    rec.remoteId = remoteId;
    rec.remoteUrl = remoteUrl;
    rec.updatedAt = new Date();
  }

  async markUnknown(intentKey: string): Promise<void> {
    const rec = this.map.get(intentKey);
    if (!rec) throw new Error(`NOT_FOUND: Reservation ${intentKey} not found`);
    rec.status = 'unknown';
    rec.updatedAt = new Date();
  }
}

export type PilotApprovalContext = {
  approvalId: string;
  ownerId: string;
  expiresAt: Date;
  snapshotHash: string;
  decision: 'approved' | 'rejected';
};

export type PilotWorkflowParams = {
  runId: string;
  principalId: string;
  config: PilotConfig;
  policy: PilotPolicy;
  store: BusinessReservationStore;
  approval: PilotApprovalContext;
  expectedHash: string;
  cardTitle: string;
  listName: string;
  intentKey: string;
  sourceKey: string;
  description?: string;
  dueDate?: string;
  assigneeId?: string;
};

export type PilotWorkflowResult = {
  status: 'succeeded' | 'expired' | 'rejected' | 'reconciliation_required' | 'failed';
  receipt?: TrelloReceipt;
  error?: string;
};

export async function executePilotWorkflow(
  params: PilotWorkflowParams,
): Promise<PilotWorkflowResult> {
  const {
    runId,
    principalId,
    config,
    policy,
    store,
    approval,
    expectedHash,
    cardTitle,
    listName,
    intentKey,
    sourceKey,
    description,
    dueDate,
    assigneeId,
  } = params;

  // 1. Owner & Decision Check
  if (approval.ownerId !== principalId) {
    return { status: 'failed', error: 'FORBIDDEN: Principal does not own this run' };
  }

  if (approval.decision !== 'approved') {
    return { status: 'rejected' };
  }

  // 2. Snapshot Hash Check
  if (approval.snapshotHash !== expectedHash) {
    return { status: 'failed', error: 'SNAPSHOT_MISMATCH: Snapshot hash has drifted' };
  }

  // 3. TTL Check (10 minutes)
  if (Date.now() >= approval.expiresAt.getTime()) {
    return { status: 'expired', error: 'APPROVAL_EXPIRED: 10-minute TTL has elapsed' };
  }

  // 4. Reserve Business Intent (Deduplication across runs)
  let reservation: ReservationRecord;
  try {
    reservation = await store.reserve({
      intentKey,
      sourceKey,
      boardId: policy.boardId,
      runId,
    });
  } catch (err: unknown) {
    return { status: 'failed', error: (err as Error).message };
  }

  // If already confirmed, reuse existing card receipt without dispatching again
  if (reservation.status === 'confirmed' && reservation.remoteId && reservation.remoteUrl) {
    return {
      status: 'succeeded',
      receipt: {
        cardId: reservation.remoteId,
        url: reservation.remoteUrl,
        listId: '',
        boardId: policy.boardId,
        title: cardTitle,
        intentKey,
      },
    };
  }

  // 5. Claim Dispatched
  const operationId = `op-${Date.now()}`;
  await store.claimDispatched(intentKey, operationId);

  // 6. Dispatch Remote Write
  try {
    const receipt = (await dispatchPilotTool(
      'trello.create_card',
      {
        boardId: policy.boardId,
        listName,
        title: cardTitle,
        description,
        dueDate,
        assigneeId,
        intentKey,
      },
      { config, policy, principalId },
    )) as TrelloReceipt;

    // 7. Success: Confirm Reservation atomically
    await store.confirm(intentKey, receipt.cardId, receipt.url);

    return {
      status: 'succeeded',
      receipt,
    };
  } catch (err: unknown) {
    // 8. Remote write error / timeout / network failure:
    // Mark as UNKNOWN and require reconciliation. CẤM BLIND RETRY!
    await store.markUnknown(intentKey);

    return {
      status: 'reconciliation_required',
      error: `REMOTE_WRITE_UNKNOWN: ${(err as Error).message}`,
    };
  }
}
