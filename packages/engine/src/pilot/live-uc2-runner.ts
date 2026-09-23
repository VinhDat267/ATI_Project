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
  runId: string;
  approvalStore: {
    getApproval(runId: string): Promise<LiveUc2Approval | null>;
  };
  targetListName?: string;
  customDueDate?: string;
  now?: Date;
  simulatedNetworkFault?: 'timeout' | '401' | '500';
}

/** Approval must be loaded from a trusted, durable store for the same run. */
export interface LiveUc2Approval {
  runId: string;
  ownerId: string;
  decision: 'approved' | 'rejected';
  snapshotHash: string;
  previewCreatedAt: Date;
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
    runId,
    approvalStore,
    targetListName = 'To Do',
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
  const approval = await approvalStore.getApproval(runId);
  const previewCreatedTime = approval?.previewCreatedAt ?? now;
  const expiresAt = new Date(previewCreatedTime.getTime() + 10 * 60 * 1000).toISOString();

  const preview: PilotPreview = {
    snapshotHash,
    expiresAt,
    actions: [action],
    unconfirmedBusiness: false,
    missingFields: [],
  };

  // 5. Handle Operator Decision
  if (approval?.runId === runId && approval.ownerId === principalId && approval.decision === 'rejected') {
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

  if (!approval || approval.runId !== runId || approval.ownerId !== principalId || approval.decision !== 'approved') {
    return {
      runId, status: 'failed', intentKey, sourceKey: sKey,
      sourceRevision: checklist.sourceRevision, preview,
      error: 'APPROVAL_REQUIRED: No matching approved decision for this run and owner',
      reservationStatus: 'cancelled', writeCount: 0,
    };
  }

  if (approval.snapshotHash !== preview.snapshotHash) {
    return {
      runId,
      status: 'failed',
      intentKey,
      sourceKey: sKey,
      sourceRevision: checklist.sourceRevision,
      preview,
      error: 'SNAPSHOT_MISMATCH: Snapshot hash has drifted or was tampered',
      reservationStatus: 'cancelled',
      writeCount: 0,
    };
  }

  if (
    !config.enabled || !config.principals.includes(principalId) ||
    config.spreadsheetId !== policy.spreadsheetId ||
    config.tabId !== policy.tabId || config.boardId !== policy.boardId
  ) {
    return {
      runId, status: 'failed', intentKey, sourceKey: sKey,
      sourceRevision: checklist.sourceRevision, preview,
      error: 'CONFIG_ERROR: Pilot configuration is disabled or differs from policy',
      reservationStatus: 'cancelled', writeCount: 0,
    };
  }

  // TTL verification
  const approvalTime = previewCreatedTime.getTime();
  if (!Number.isFinite(approvalTime) || now.getTime() < approvalTime || now.getTime() >= approvalTime + 10 * 60 * 1000) {
    return {
      runId,
      status: 'failed',
      intentKey,
      sourceKey: sKey,
      sourceRevision: checklist.sourceRevision,
      preview,
      error: 'TTL_EXPIRED: Operator approval exceeded 10-minute server TTL',
      reservationStatus: 'cancelled',
      writeCount: 0,
    };
  }

  // 7. Business Reservation (prevents duplicate execution)
  const reservation = await reservationStore.reserve({
    intentKey,
    sourceKey: sKey,
    boardId: config.boardId,
    runId,
  });

  if (reservation.status === 'confirmed') {
    return {
      runId, status: 'succeeded', intentKey, sourceKey: sKey,
      sourceRevision: checklist.sourceRevision, preview,
      reservationStatus: 'confirmed', writeCount: 0,
    };
  }

  const operationId = randomUUID();
  await reservationStore.claimDispatched(intentKey, operationId);

  // 8. Execute Single Remote Write
  let rawReceipt: unknown;
  let receipt: TrelloReceipt;
  try {
    if (options.simulatedNetworkFault === '401') {
      throw new Error('UNAUTHORIZED: Invalid API credentials (HTTP 401)');
    }
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
    receipt = TrelloReceiptSchema.parse(rawReceipt);
    await reservationStore.confirm(intentKey, receipt.cardId, receipt.url, receipt.listId);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    // Once dispatch has been invoked, an error message cannot prove Trello did not write.
    // Keep the intent blocked until an operator reconciles the remote outcome.
    let reservationStatus: ReservationStatus = 'unknown';
    let reconciliationError = errorMsg;
    try {
      await reservationStore.markUnknown(intentKey);
    } catch (storeError: unknown) {
      reservationStatus = 'dispatched';
      reconciliationError += `; MARK_UNKNOWN_FAILED: ${storeError instanceof Error ? storeError.message : String(storeError)}`;
    }
    return {
      runId,
      status: 'reconciliation_required',
      intentKey,
      sourceKey: sKey,
      sourceRevision: checklist.sourceRevision,
      preview,
      error: reconciliationError,
      reservationStatus,
      writeCount: 1, // Conservatively count the claimed write attempt
    };
  }

  // 9. Return the validated, confirmed receipt
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
