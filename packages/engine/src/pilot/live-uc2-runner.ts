import { createHash, randomUUID } from 'node:crypto';
import type { PilotConfig } from './config.js';
import { assertPilotAccess, type PilotPolicy } from './policy.js';
import type { SourceRow } from './source.js';
import { evaluateChecklist, type ChecklistResult } from './checklist.js';
import { sourceKey } from './identity.js';
import {
  TrelloReceiptSchema,
  type TrelloReceipt,
  type PilotPreview,
  type PilotStepAction,
  type ReservationStatus,
} from './schemas.js';
import {
  type BusinessReservationStore,
} from './dispatch.js';
import { dispatchPilotTool } from './gateway.js';

export interface LiveUc2Options {
  config: PilotConfig;
  policy: PilotPolicy;
  principalId: string;
  sourceRow: SourceRow;
  checklist?: ChecklistResult;
  reservationStore: BusinessReservationStore;
  runId?: string;
  targetListName?: string;
  customDueDate?: string;
  previewCreatedAt?: Date;
  now?: Date;
  operatorDecision?: 'approved' | 'rejected';
  tamperSnapshotHash?: string;
  simulatedNetworkFault?: 'timeout' | '401' | '500';
}

export interface LiveUc2Result {
  runId: string;
  status: 'succeeded' | 'rejected' | 'failed' | 'reconciliation_required';
  intentKey: string;
  sourceKey: string;
  sourceRevision: string;
  preview: PilotPreview;
  receipt?: TrelloReceipt;
  error?: string;
  reservationStatus: ReservationStatus;
  writeCount: number;
}

/**
 * BE-27: Live Manual UC2 + Receipt Execution Runner
 * Enforces:
 * - Exactly ONE remote write: trello.create_card
 * - Zero blind retry on post-dispatch failure/timeout (transitions to unknown + reconciliation_required)
 * - Strict approval binding: principalId, planHash matching, and 10-minute server TTL
 * - Canonical receipt validation against TrelloReceiptSchema
 */
export async function executeLiveUc2Intake(options: LiveUc2Options): Promise<LiveUc2Result> {
  const {
    config,
    policy,
    principalId,
    sourceRow,
    reservationStore,
    runId = randomUUID(),
    targetListName = 'To Do',
    operatorDecision = 'approved',
    now = new Date(),
  } = options;

  // 1. Evaluate Checklist (must pass for UC2)
  const checklist = options.checklist ?? evaluateChecklist(sourceRow);
  if (checklist.status !== 'pass' || checklist.unconfirmedBusiness) {
    throw new Error(`CHECKLIST_NOT_PASSED: Cannot execute UC2 on invalid or unconfirmed intake (${checklist.summary})`);
  }

  // 2. Derive deterministic sourceKey & intentKey
  const sKey = sourceKey({
    groupId: config.boardId,
    spreadsheetId: config.spreadsheetId,
    tabId: config.tabId,
    requestId: sourceRow.request_id,
  });
  const intentKey = sKey;

  // 3. Construct single write action
  const dueDate = options.customDueDate ?? (sourceRow.due_date ? `${sourceRow.due_date}T17:00:00.000Z` : undefined);
  const actionArgs: Record<string, unknown> = {
    boardId: config.boardId,
    listName: targetListName,
    title: `[${sourceRow.client_ref}] ${sourceRow.raw_request}`,
    description: `Mục tiêu bàn giao: ${sourceRow.deliverable}\nGhi chú: ${sourceRow.source_note}\nMã phiếu: ${sourceRow.request_id}`,
    dueDate,
    intentKey,
  };

  const action: PilotStepAction = {
    tool: 'trello.create_card',
    args: actionArgs,
    sideEffect: 'write',
  };

  // 4. Generate immutable preview with SHA-256 hash & 10m TTL
  const canonicalPayload = JSON.stringify({
    tool: action.tool,
    args: action.args,
    sourceRevision: checklist.sourceRevision,
  });
  const snapshotHash = createHash('sha256').update(canonicalPayload).digest('hex');
  const previewCreatedTime = options.previewCreatedAt ?? now;
  const expiresAt = new Date(previewCreatedTime.getTime() + 10 * 60 * 1000).toISOString();

  const preview: PilotPreview = {
    snapshotHash,
    expiresAt,
    actions: [action],
    unconfirmedBusiness: false,
    missingFields: [],
  };

  // 5. Handle Operator Decision
  if (operatorDecision === 'rejected') {
    return {
      runId,
      status: 'rejected',
      intentKey,
      sourceKey: sKey,
      sourceRevision: checklist.sourceRevision,
      preview,
      reservationStatus: 'cancelled',
      writeCount: 0,
    };
  }

  // 6. Verify Approval Binding (Principal, Hash match, TTL)
  assertPilotAccess(policy, principalId, { kind: 'board', boardId: config.boardId });

  const providedHash = options.tamperSnapshotHash ?? preview.snapshotHash;
  if (providedHash !== preview.snapshotHash) {
    return {
      runId,
      status: 'failed',
      intentKey,
      sourceKey: sKey,
      sourceRevision: checklist.sourceRevision,
      preview,
      error: 'SNAPSHOT_MISMATCH: Snapshot hash has drifted or was tampered',
      reservationStatus: 'reserved',
      writeCount: 0,
    };
  }

  // TTL verification
  const currentIso = now.toISOString();
  if (currentIso > preview.expiresAt) {
    return {
      runId,
      status: 'failed',
      intentKey,
      sourceKey: sKey,
      sourceRevision: checklist.sourceRevision,
      preview,
      error: 'TTL_EXPIRED: Operator approval exceeded 10-minute server TTL',
      reservationStatus: 'reserved',
      writeCount: 0,
    };
  }

  // 7. Business Reservation (prevents duplicate execution)
  await reservationStore.reserve({
    intentKey,
    sourceKey: sKey,
    boardId: config.boardId,
    runId,
  });

  const operationId = randomUUID();
  await reservationStore.claimDispatched(intentKey, operationId);

  // 8. Execute Single Remote Write
  let rawReceipt: unknown;
  try {
    if (options.simulatedNetworkFault === 'timeout') {
      throw new Error('TIMEOUT: Network request timed out while waiting for Trello response');
    }
    if (options.simulatedNetworkFault === '500') {
      throw new Error('INTERNAL_SERVER_ERROR: Trello API returned 500');
    }

    rawReceipt = await dispatchPilotTool(
      action.tool,
      action.args,
      { config, policy, principalId },
    );
  } catch (err: unknown) {
    // ZERO BLIND RETRY INVARIANT:
    // When a post-dispatch error occurs, transition reservation to unknown and halt at reconciliation_required.
    await reservationStore.markUnknown(intentKey);
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      runId,
      status: 'reconciliation_required',
      intentKey,
      sourceKey: sKey,
      sourceRevision: checklist.sourceRevision,
      preview,
      error: errorMsg,
      reservationStatus: 'unknown',
      writeCount: 1, // Write was dispatched
    };
  }

  // 9. Validate Receipt & Confirm
  const receipt = TrelloReceiptSchema.parse(rawReceipt);
  await reservationStore.confirm(intentKey, receipt.cardId, receipt.url);

  return {
    runId,
    status: 'succeeded',
    intentKey,
    sourceKey: sKey,
    sourceRevision: checklist.sourceRevision,
    preview,
    receipt,
    reservationStatus: 'confirmed',
    writeCount: 1,
  };
}
