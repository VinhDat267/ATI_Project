import { createHash } from "node:crypto";
import type { PilotPolicy, PilotPreview, SourceRow } from "@wap/engine";

export interface PilotApprovalSnapshot {
  runId: string;
  ownerId: string;
  versionId: string;
  sourceKey: string;
  sourceRevision: string;
  row: SourceRow;
  policy: PilotPolicy;
  targetListId?: string;
}

const SOURCE_FIELDS = [
  "request_id", "client_ref", "request_type", "raw_request",
  "deliverable", "due_date", "decision_status", "source_note",
] as const;

/** Bind owner, run, source bytes and the exact Trello write arguments. */
export function buildPilotApproval(snapshot: PilotApprovalSnapshot) {
  const { runId, ownerId, versionId, sourceKey, sourceRevision, row, policy, targetListId } = snapshot;
  const listName = "To Do";
  const cardTitle = row.deliverable || "New Card";
  const description = row.raw_request || row.deliverable;
  const dueDate = row.due_date || undefined;
  const actionArgs = {
    boardId: policy.boardId,
    listName,
    listId: targetListId ?? "",
    title: cardTitle,
    description,
    dueDate,
    intentKey: sourceKey,
  };
  const snapshotHash = createHash("sha256")
    .update(JSON.stringify([
      "pilot-approval-v2", runId, ownerId, versionId, sourceKey, sourceRevision,
      policy.spreadsheetId, policy.tabId, policy.boardId,
      ...SOURCE_FIELDS.map((field) => row[field]),
      listName, targetListId ?? "", cardTitle, description, dueDate ?? "",
    ]))
    .digest("hex");

  return {
    snapshotHash,
    cardTitle,
    description,
    dueDate,
    listName,
    listId: targetListId,
    actionArgs,
  };
}

export function pilotPreview(
  approval: ReturnType<typeof buildPilotApproval>,
  approvalId: string,
  versionId: string,
  expiresAt: Date,
  unconfirmedBusiness: boolean,
  missingFields: string[],
): PilotPreview {
  return {
    approvalId,
    versionId,
    snapshotHash: approval.snapshotHash,
    expiresAt: expiresAt.toISOString(),
    actions: [{ tool: "trello.create_card", args: approval.actionArgs, sideEffect: "write" }],
    unconfirmedBusiness,
    missingFields,
  };
}
