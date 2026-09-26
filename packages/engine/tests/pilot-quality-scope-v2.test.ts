import { describe, expect, it } from "vitest";
import {
  assertPilotModelFixtureCompatible,
  classifyPilotModelQualityCase,
  pilotQualityHoldoutFile,
} from "../src/pilot/quality-scope.js";

const fixture = {
  caseId: "H2-01",
  fault: "none",
  sourceFixture: {
    headers: [
      "request_id",
      "client_ref",
      "request_type",
      "raw_request",
      "deliverable",
      "due_date",
      "decision_status",
      "source_note",
    ],
    rows: [
      [
        "REQ-H2-01",
        "client-v2",
        "web_change",
        "Update footer text https://example.test",
        "Footer copy update",
        "2026-11-01",
        "confirmed",
        "target_url: https://example.test",
      ],
    ],
    requestId: "REQ-H2-01",
    spreadsheetId: "sheet-holdout-v2",
    tabId: "tab-requests-v2",
  },
  resourcePolicy: { allowedSources: ["sheet-holdout-v2"] },
  expected: { kind: "plan", writeCount: 1 },
};

describe("independent model-only-v2 holdout contract", () => {
  it("selects a distinct file and classifies only H2 case IDs", () => {
    expect(pilotQualityHoldoutFile("model-only-v2")).toBe("ai-holdout-v2.json");
    expect(classifyPilotModelQualityCase(fixture, "holdout")).toMatchObject({
      eligible: true,
      group: "model-reasoning",
    });
    expect(
      classifyPilotModelQualityCase(
        { caseId: "H2-10", fault: "none" },
        "holdout",
      ).group,
    ).toBe("source-refusal-compliance");
    expect(
      classifyPilotModelQualityCase(
        { caseId: "H2-11", fault: "none" },
        "holdout",
      ).eligible,
    ).toBe(false);
  });

  it("requires nonempty trusted source and tab IDs before a case can be used", () => {
    expect(() =>
      assertPilotModelFixtureCompatible(fixture, "holdout", "model-only-v2"),
    ).not.toThrow();
    expect(() =>
      assertPilotModelFixtureCompatible(
        {
          ...fixture,
          sourceFixture: { ...fixture.sourceFixture, tabId: "" },
        },
        "holdout",
        "model-only-v2",
      ),
    ).toThrow("QUALITY_SOURCE_METADATA_INVALID");
    expect(() =>
      assertPilotModelFixtureCompatible(
        {
          ...fixture,
          resourcePolicy: { allowedSources: ["different-sheet"] },
        },
        "holdout",
        "model-only-v2",
      ),
    ).toThrow("QUALITY_SOURCE_METADATA_INVALID");
  });
});
