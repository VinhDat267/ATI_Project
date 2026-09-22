import { describe, it, expect } from "vitest";
import {
  evaluatePilotDecision,
  type ChecklistResult,
  type SourceRow,
} from "../src/index.js";

const sampleRow: SourceRow = {
  request_id: "REQ-201",
  client_ref: "Client Beta",
  request_type: "design_system",
  raw_request: "Design color palette and typography tokens",
  deliverable: "Design tokens in Figma",
  due_date: "2026-11-20",
  decision_status: "confirmed",
  source_note: "Approved by creative director",
};

const passChecklist: ChecklistResult = {
  status: "pass",
  checklistVersion: "pilot-checklist-1",
  sourceRevision: "99887766554433221100aabbccddeeff",
  missingFields: [],
  conflicts: [],
  unconfirmedBusiness: false,
  evidencePositions: {},
  summary: "All fields valid and confirmed",
};

describe("Pilot AI Decision Branches (BE-22)", () => {
  describe("UC1 Refusal Branch", () => {
    it("returns refusal status with 0 writes when checklist status is refusal", () => {
      const refusalChecklist: ChecklistResult = {
        ...passChecklist,
        status: "refusal",
        summary: "Forbidden content: attempts phishing or malware distribution",
      };

      const result = evaluatePilotDecision({
        checklist: refusalChecklist,
        sourceRow: sampleRow,
      });

      expect(result.kind).toBe("refusal");
      expect(result.status).toBe("refused");
      expect(result.actions).toHaveLength(0);
      expect(result.refusalReason).toContain("Forbidden content");
    });

    it("returns refusal status with 0 writes when LLM identifies policy violation", () => {
      const result = evaluatePilotDecision({
        checklist: passChecklist,
        sourceRow: sampleRow,
        llmOutput: {
          intent: "refuse",
          refusalReason: "Client request violates corporate acceptable use policy",
        },
      });

      expect(result.kind).toBe("refusal");
      expect(result.status).toBe("refused");
      expect(result.actions).toHaveLength(0);
      expect(result.refusalReason).toBe(
        "Client request violates corporate acceptable use policy",
      );
    });
  });

  describe("UC1 Clarification / Needs Input Branch", () => {
    it("returns needs_input with 0 writes when intake has missing required fields", () => {
      const missingChecklist: ChecklistResult = {
        ...passChecklist,
        status: "needs_input",
        missingFields: ["due_date", "deliverable"],
      };

      const result = evaluatePilotDecision({
        checklist: missingChecklist,
        sourceRow: { ...sampleRow, due_date: "", deliverable: "" },
      });

      expect(result.kind).toBe("clarification");
      expect(result.status).toBe("needs_input");
      expect(result.actions).toHaveLength(0);
      expect(result.clarificationQuestion).toContain("due_date, deliverable");
    });

    it("returns needs_input with 0 writes when business confirmation is missing", () => {
      const unconfirmedChecklist: ChecklistResult = {
        ...passChecklist,
        status: "needs_input",
        unconfirmedBusiness: true,
      };

      const result = evaluatePilotDecision({
        checklist: unconfirmedChecklist,
        sourceRow: { ...sampleRow, decision_status: "pending_review" },
      });

      expect(result.kind).toBe("clarification");
      expect(result.status).toBe("needs_input");
      expect(result.actions).toHaveLength(0);
      expect(result.clarificationQuestion).toContain("decision_status is not confirmed");
    });
  });

  describe("UC2 Executable Plan Branch (Single Remote Write)", () => {
    it("generates exactly ONE write action (trello.create_card) with preview when intake passes", () => {
      const result = evaluatePilotDecision({
        checklist: passChecklist,
        sourceRow: sampleRow,
      });

      expect(result.kind).toBe("plan");
      expect(result.status).toBe("awaiting_approval");
      expect(result.actions).toHaveLength(1);

      const action = result.actions[0]!;
      expect(action.tool).toBe("trello.create_card");
      expect(action.sideEffect).toBe("write");
      expect(action.args.title).toBe("Design tokens in Figma");
      expect(action.args.due).toBe("2026-11-20");

      expect(result.preview).toBeDefined();
      expect(result.preview!.snapshotHash).toBe(passChecklist.sourceRevision);
      expect(result.preview!.actions).toHaveLength(1);
      expect(result.preview!.unconfirmedBusiness).toBe(false);

      // Verify 10 min TTL
      const expiresAt = new Date(result.preview!.expiresAt).getTime();
      const now = Date.now();
      expect(expiresAt - now).toBeGreaterThan(500_000); // ~10 minutes
      expect(expiresAt - now).toBeLessThanOrEqual(600_000 + 1000);
    });

    it("respects LLM title and description customization for the card", () => {
      const result = evaluatePilotDecision({
        checklist: passChecklist,
        sourceRow: sampleRow,
        llmOutput: {
          cardTitle: "Refined Token System v2",
          cardDesc: "Custom description formulated by LLM",
          listName: "Backlog",
        },
      });

      expect(result.actions[0]!.args.title).toBe("Refined Token System v2");
      expect(result.actions[0]!.args.desc).toBe("Custom description formulated by LLM");
      expect(result.actions[0]!.args.listName).toBe("Backlog");
    });
  });

  describe("UC3 Card Lookup Branch (Read-Only)", () => {
    it("generates trello.get_card read action with 0 writes when operator requests lookup", () => {
      const result = evaluatePilotDecision({
        checklist: passChecklist,
        sourceRow: sampleRow,
        operatorPrompt: "Please lookup card status for this client request",
      });

      expect(result.kind).toBe("lookup");
      expect(result.status).toBe("succeeded");
      expect(result.actions).toHaveLength(1);

      const action = result.actions[0]!;
      expect(action.tool).toBe("trello.get_card");
      expect(action.sideEffect).toBe("read");
      expect(action.args.cardId).toBe("REQ-201");
    });

    it("generates trello.get_card when LLM emits intent: get_card", () => {
      const result = evaluatePilotDecision({
        checklist: passChecklist,
        sourceRow: sampleRow,
        llmOutput: {
          intent: "get_card",
        },
      });

      expect(result.kind).toBe("lookup");
      expect(result.actions[0]!.tool).toBe("trello.get_card");
      expect(result.actions[0]!.sideEffect).toBe("read");
    });
  });
});
