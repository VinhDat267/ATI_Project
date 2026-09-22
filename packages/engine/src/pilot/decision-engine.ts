import type { ChecklistResult } from "./checklist.js";
import type { SourceRow } from "./source.js";
import type { PilotStepAction, PilotPreview } from "./schemas.js";

export type PilotDecisionKind = "clarification" | "refusal" | "plan" | "lookup";

export interface PilotLlmDecisionOutput {
  intent?: "create_card" | "get_card" | "refuse" | "clarify";
  cardTitle?: string;
  cardDesc?: string;
  listName?: string;
  dueDate?: string;
  clarificationQuestion?: string;
  refusalReason?: string;
}

export interface PilotDecisionInput {
  checklist: ChecklistResult;
  sourceRow: SourceRow;
  operatorPrompt?: string;
  llmOutput?: PilotLlmDecisionOutput;
}

export interface PilotDecisionResult {
  kind: PilotDecisionKind;
  status: "needs_input" | "refused" | "awaiting_approval" | "succeeded";
  actions: PilotStepAction[];
  preview?: PilotPreview;
  clarificationQuestion?: string;
  refusalReason?: string;
}

/**
 * Evaluates the AI decision branches for Pilot MVP v2:
 * 1. UC1 Refusal: checklist status is 'refusal' or model detects policy violations (0 writes).
 * 2. UC1 Clarification: checklist status is 'needs_input', unconfirmed business, or missing fields (0 writes).
 * 3. UC2 Executable Plan: checklist status is 'pass', generates single write 'trello.create_card' and preview.
 * 4. UC3 Lookup: read-only lookup with 'trello.get_card' (0 writes).
 */
export function evaluatePilotDecision(input: PilotDecisionInput): PilotDecisionResult {
  const { checklist, sourceRow, operatorPrompt = "", llmOutput } = input;

  // -------------------------------------------------------------
  // Branch 1: UC1 Refusal
  // -------------------------------------------------------------
  if (checklist.status === "refusal" || llmOutput?.intent === "refuse") {
    const refusalReason =
      llmOutput?.refusalReason ||
      checklist.summary ||
      "Request violates execution policy or security rules";

    return {
      kind: "refusal",
      status: "refused",
      actions: [],
      refusalReason,
    };
  }

  // -------------------------------------------------------------
  // Branch 2: UC1 Clarification / Needs Input
  // -------------------------------------------------------------
  const isUnconfirmed = checklist.unconfirmedBusiness;
  const hasMissing = checklist.missingFields && checklist.missingFields.length > 0;
  const isNeedsInput =
    checklist.status === "needs_input" ||
    isUnconfirmed ||
    hasMissing ||
    llmOutput?.intent === "clarify";

  if (isNeedsInput) {
    let clarificationQuestion = llmOutput?.clarificationQuestion;
    if (!clarificationQuestion) {
      if (hasMissing) {
        clarificationQuestion = `Missing required intake fields: ${checklist.missingFields.join(", ")}. Please update intake sheet.`;
      } else if (isUnconfirmed) {
        clarificationQuestion = `Request decision_status is not confirmed. Business confirmation is required before card creation.`;
      } else {
        clarificationQuestion = checklist.summary || "Clarification required from operator.";
      }
    }

    return {
      kind: "clarification",
      status: "needs_input",
      actions: [],
      clarificationQuestion,
    };
  }

  // -------------------------------------------------------------
  // Branch 3: UC3 Lookup (Read-Only)
  // -------------------------------------------------------------
  const isLookup =
    llmOutput?.intent === "get_card" ||
    operatorPrompt.toLowerCase().includes("lookup") ||
    operatorPrompt.toLowerCase().includes("check status") ||
    operatorPrompt.toLowerCase().includes("get_card");

  if (isLookup) {
    const readAction: PilotStepAction = {
      tool: "trello.get_card",
      args: {
        cardId: sourceRow.request_id || "target-card",
      },
      sideEffect: "read",
    };

    return {
      kind: "lookup",
      status: "succeeded",
      actions: [readAction],
    };
  }

  // -------------------------------------------------------------
  // Branch 4: UC2 Executable Plan (Single Write)
  // -------------------------------------------------------------
  const title =
    llmOutput?.cardTitle ||
    sourceRow.deliverable ||
    sourceRow.raw_request ||
    "New Card";

  const desc =
    llmOutput?.cardDesc ||
    [
      `Client: ${sourceRow.client_ref || "N/A"}`,
      `Request Type: ${sourceRow.request_type || "N/A"}`,
      `Raw Request: ${sourceRow.raw_request || "N/A"}`,
      `Deliverable: ${sourceRow.deliverable || "N/A"}`,
      `Due Date: ${sourceRow.due_date || "N/A"}`,
      sourceRow.source_note ? `Note: ${sourceRow.source_note}` : "",
    ]
      .filter(Boolean)
      .join("\n");

  const writeAction: PilotStepAction = {
    tool: "trello.create_card",
    args: {
      title,
      desc,
      due: llmOutput?.dueDate || sourceRow.due_date || undefined,
      listName: llmOutput?.listName || "To Do",
    },
    sideEffect: "write",
  };

  const preview: PilotPreview = {
    snapshotHash: checklist.sourceRevision,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 min TTL
    actions: [writeAction],
    unconfirmedBusiness: false,
    missingFields: [],
  };

  return {
    kind: "plan",
    status: "awaiting_approval",
    actions: [writeAction],
    preview,
  };
}
