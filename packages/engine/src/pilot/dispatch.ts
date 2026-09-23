import { randomUUID } from 'node:crypto';
import type { PilotConfig } from './config.js';
import type { PilotPolicy } from './policy.js';
import {
  TrelloReceiptSchema,
  type TrelloReceipt,
  type ReservationStatus,
} from './schemas.js';
import { dispatchPilotTool } from './gateway.js';

export type ReservationRecord = {
  id: string;
  intentKey: string;
  sourceKey: string;
  boardId: string;
  runId: string;
  status: ReservationStatus;
  remoteId?: string;
  remoteUrl?: string;
  remoteListId?: string;
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
  confirm(intentKey: string, remoteId: string, remoteUrl: string, remoteListId?: string): Promise<void>;
  markUnknown(intentKey: string): Promise<void>;
  cancel(intentKey: string): Promise<void>;
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
      if (existing.status === 'unknown') {
        throw new Error(
          `INTENT_IN_UNKNOWN_STATE: Intent ${data.intentKey} has unknown status and requires reconciliation`,
        );
      }
      if (existing.status === 'dispatched' || existing.status === 'reserved') {
        throw new Error(
          `INTENT_ALREADY_RESERVED: Intent ${data.intentKey} is already in state "${existing.status}"`,
        );
      }
    }

    const record: ReservationRecord = {
      id: randomUUID(),
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
    const existing = this.map.get(intentKey);
    if (!existing) {
      throw new Error(`RESERVATION_NOT_FOUND: Intent ${intentKey}`);
    }
    if (existing.status !== 'reserved') {
      throw new Error(`RESERVATION_NOT_CLAIMABLE: Intent ${intentKey} is in state "${existing.status}"`);
    }
    existing.status = 'dispatched';
    existing.operationId = operationId;
    existing.updatedAt = new Date();
  }

  async confirm(intentKey: string, remoteId: string, remoteUrl: string, remoteListId?: string): Promise<void> {
    const existing = this.map.get(intentKey);
    if (!existing) {
      throw new Error(`RESERVATION_NOT_FOUND: Intent ${intentKey}`);
    }
    existing.status = 'confirmed';
    existing.remoteId = remoteId;
    existing.remoteUrl = remoteUrl;
    existing.remoteListId = remoteListId;
    existing.updatedAt = new Date();
  }

  async markUnknown(intentKey: string): Promise<void> {
    const existing = this.map.get(intentKey);
    if (!existing) {
      throw new Error(`RESERVATION_NOT_FOUND: Intent ${intentKey}`);
    }
    existing.status = 'unknown';
    existing.updatedAt = new Date();
  }

  async cancel(intentKey: string): Promise<void> {
    const existing = this.map.get(intentKey);
    if (existing) {
      existing.status = 'cancelled';
      existing.updatedAt = new Date();
    }
  }
}

export type PilotApprovalContext = {
  approvalId?: string;
  ownerId: string;
  expiresAt: Date;
  snapshotHash: string;
  decision: 'approved' | 'rejected';
};

export type PilotWorkflowResult = {
  status: 'succeeded' | 'expired' | 'rejected' | 'reconciliation_required' | 'failed';
  receipt?: TrelloReceipt;
  error?: string;
};

/**
 * Executes the pilot workflow with all safety gates:
 * 1. Owner & Decision matching
 * 2. Snapshot hash matching
 * 3. 10-minute server TTL
 * 4. Policy access check (fail-closed before reservation)
 * 5. Deduplication reservation
 * 6. Claim dispatched
 * 7. Single remote write (UC2)
 * 8. Zero blind retry (transitions to unknown on failure)
 */
export async function executePilotWorkflow(params: {
  runId: string;
  principalId: string;
  config: PilotConfig;
  policy: PilotPolicy;
  store: BusinessReservationStore;
  approval: PilotApprovalContext;
  expectedHash: string;
  cardTitle: string;
  listName: string;
  listId?: string;
  description?: string;
  dueDate?: string;
  assigneeId?: string;
  intentKey: string;
  sourceKey: string;
}): Promise<PilotWorkflowResult> {
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
    listId,
    description,
    dueDate,
    assigneeId,
    intentKey,
    sourceKey,
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

  // 4. Pre-reservation Policy Check: verify policy before creating reservation
  if (
    !policy.enabled || !config.enabled ||
    !policy.principals.includes(principalId) || !config.principals.includes(principalId) ||
    policy.spreadsheetId !== config.spreadsheetId ||
    policy.tabId !== config.tabId || policy.boardId !== config.boardId
  ) {
    return {
      status: 'failed',
      error: 'ACCESS_DENIED: Pilot policy is disabled or principal is unauthorized',
    };
  }

  // 5. Reserve Business Intent (Deduplication across runs)
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
    if (!reservation.remoteListId) {
      return { status: 'reconciliation_required', error: 'RECEIPT_INCOMPLETE: Confirmed intent lacks Trello list ID' };
    }
    return {
      status: 'succeeded',
      receipt: {
        cardId: reservation.remoteId,
        url: reservation.remoteUrl,
        listId: reservation.remoteListId,
        boardId: policy.boardId,
        title: cardTitle,
        intentKey,
      },
    };
  }

  // 6. Claim Dispatched
  const operationId = randomUUID();
  await store.claimDispatched(intentKey, operationId);

  // 7. Dispatch Remote Write
  try {
    const rawReceipt = await dispatchPilotTool(
      'trello.create_card',
      {
        boardId: policy.boardId,
        listName,
        listId,
        title: cardTitle,
        description,
        dueDate,
        assigneeId,
        intentKey,
      },
      { config, policy, principalId, approvalExpiresAt: approval.expiresAt },
    );

    // Validate receipt strictly against schema before confirming
    const receipt = TrelloReceiptSchema.parse(rawReceipt);

    // 8. Success: Confirm Reservation atomically
    await store.confirm(intentKey, receipt.cardId, receipt.url, receipt.listId);

    return {
      status: 'succeeded',
      receipt,
    };
  } catch (err: unknown) {
    const msg = (err as Error)?.message ?? String(err);
    // A string in an error cannot prove the POST was never accepted remotely.
    // Conservatively quarantine every failure after dispatch invocation.
    let storeErrorDetail = '';
    try {
      await store.markUnknown(intentKey);
    } catch (storeError: unknown) {
      storeErrorDetail = `; MARK_UNKNOWN_FAILED: ${storeError instanceof Error ? storeError.message : String(storeError)}`;
    }

    return {
      status: 'reconciliation_required',
      error: `REMOTE_WRITE_UNKNOWN: ${msg}${storeErrorDetail}`,
    };
  }
}
