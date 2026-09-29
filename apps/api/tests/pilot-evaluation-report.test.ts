import { describe, expect, it } from "vitest";
import { gradeStructuralSlot } from "../src/pilot-evaluation/report.js";

describe("structural-only offline grading", () => {
  it("separates provider failure from model refusal and excludes cleanup rejection", () => {
    expect(gradeStructuralSlot({ slotId: "slot-1", kind: "refusal", precleanupStatus: "refused" },
      { kind: "error", precleanupStatus: "failed", cleanupStatus: "failed" })).toBe("fail");
    expect(gradeStructuralSlot({ slotId: "slot-1", kind: "plan", precleanupStatus: "awaiting_approval" },
      { kind: "plan", precleanupStatus: "awaiting_approval", cleanupStatus: "rejected" })).toBe("pass");
  });
});
