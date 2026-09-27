import { describe, expect, it } from "vitest";
import * as pilot from "../src/index.js";
import type { V2TestCase } from "../src/pilot/dataset-schema.js";

const headers = [...pilot.SOURCE_COLUMNS];
function record(): V2TestCase {
  return {
    caseId: "V2-01", variantId: "sample-en", language: "en",
    origin: "reconstructed_synthetic", sourceRefs: ["private-label"],
    sourceFixture: {
      headers: [...headers], rows: [["REQ-A", "Sample", "web_change", "Update /home", "New header", "2026-11-01", "confirmed", "ok"]],
      requestId: "REQ-A", spreadsheetId: "sheet-fixture", tabId: "tab-fixture",
    },
    prompt: "Prepare sample preview", principal: "operator-one",
    resourcePolicy: { allowedSources: ["sheet-fixture"], allowedTargets: ["board-fixture"], allowedPrincipals: ["operator-one"] },
    fault: "none", expected: { kind: "plan", terminalStatus: "awaiting_approval", writeCount: 1 },
    evidence: { mode: "CONTRACT_TESTED", commit: "synthetic", verdict: "NOT_RUN", observed: { private: "oracle" } },
    note: "not for planner",
  };
}

function callbackContext(input: ReturnType<typeof pilot.projectPilotEvaluationInput>) {
  const row = pilot.parseRequest([input.sourceFixture.headers, ...input.sourceFixture.rows], input.sourceFixture.requestId);
  return pilot.buildPilotPlannerContext({
    sourceRow: row, checklistResult: pilot.evaluateChecklist(row),
    operatorPrompt: input.prompt, outputContract: "pilot-advisory-v1",
  });
}

describe("projectPilotEvaluationInput", () => {
  it("omits nested oracle metadata without changing the projected context", () => {
    const original = record();
    const poisoned = record();
    poisoned.caseId = "H-01";
    poisoned.variantId = "different-label";
    poisoned.origin = "reconstructed_synthetic";
    poisoned.sourceRefs = ["ORACLE-NESTED"];
    poisoned.fault = "timeout";
    poisoned.expected = { kind: "refusal", terminalStatus: "refused", writeCount: 0, toolCalls: [{ tool: "ORACLE", args: { nested: { poison: true } } }] };
    poisoned.evidence = { mode: "CONTRACT_TESTED", commit: "ORACLE", verdict: "FAIL", observed: { nested: { poison: "ORACLE" } } };
    poisoned.note = "ORACLE";
    const projected = pilot.projectPilotEvaluationInput(original);
    expect(projected).toEqual(pilot.projectPilotEvaluationInput(poisoned));
    expect(callbackContext(projected)).toEqual(callbackContext(pilot.projectPilotEvaluationInput(poisoned)));
    expect(JSON.stringify(projected)).not.toMatch(/ORACLE|caseId|variantId|expected|fault|evidence|sourceRefs/);
    expect(projected.sourceFixture.requestId).toBe("REQ-A");
  });

  it("changes context when source text changes and copies all nested array inputs", () => {
    const input = record();
    const projected = pilot.projectPilotEvaluationInput(input);
    const changed = record();
    changed.sourceFixture.rows[0]![4] = "Different deliverable";
    expect(callbackContext(pilot.projectPilotEvaluationInput(changed))).not.toEqual(callbackContext(projected));
    input.sourceFixture.headers[0] = "poison";
    input.sourceFixture.rows[0]![4] = "poison";
    input.resourcePolicy.allowedSources[0] = "poison";
    input.resourcePolicy.allowedTargets[0] = "poison";
    input.resourcePolicy.allowedPrincipals[0] = "poison";
    expect(projected.sourceFixture.headers[0]).toBe("request_id");
    expect(projected.sourceFixture.rows[0]![4]).toBe("New header");
    expect(projected.resourcePolicy).toEqual({ allowedSources: ["sheet-fixture"], allowedTargets: ["board-fixture"], allowedPrincipals: ["operator-one"] });
  });

  it("rejects extra keys at every projected object level and non-JSON cells", () => {
    const projected = pilot.projectPilotEvaluationInput(record());
    expect(() => pilot.PilotEvaluationInputSchema.parse({ ...projected, expected: "oracle" })).toThrow();
    expect(() => pilot.PilotEvaluationInputSchema.parse({ ...projected, sourceFixture: { ...projected.sourceFixture, answer: "oracle" } })).toThrow();
    expect(() => pilot.PilotEvaluationInputSchema.parse({ ...projected, resourcePolicy: { ...projected.resourcePolicy, expected: "oracle" } })).toThrow();
    for (const cell of [{ nested: "oracle" }, ["oracle"], Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
      const malformed = record();
      malformed.sourceFixture.rows[0]![4] = cell;
      expect(() => pilot.projectPilotEvaluationInput(malformed)).toThrow();
    }
  });
});
