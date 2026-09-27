import { describe, expect, it, vi } from "vitest";
import { canonicalHash, freezeManifest } from "../src/pilot-evaluation/manifest.js";
import { runOfflineCampaign } from "../src/pilot-evaluation/coordinator.js";
import { buildOfflineReport, openReadonlyEvaluationStore } from "../src/pilot-evaluation/report.js";
import { syntheticBundle, syntheticManifest, withOfflineCampaign } from "./helpers/pilot-evaluation-fixture.js";

vi.mock("../src/pilot-evaluation/git-evidence.js", () => ({
  observeGitEvidence: () => ({ head: "a".repeat(40), clean: true,
    sourceDigests: { code: "a".repeat(64), projection: "b".repeat(64),
      prompt: "c".repeat(64), schema: "d".repeat(64), fakeScript: "1".repeat(64),
      rubric: "2".repeat(64) } }),
}));

describe("real authenticated deterministic HTTP controls", () => {
  it("observes needs_input and refused on real owner runs without claiming a fake call", async () => {
    const bundle = syntheticBundle();
    bundle.slots[0]!.row!.decision_status = "pending";
    bundle.slots[1]!.row!.request_type = "unsupported_email";
    for (const slot of bundle.slots) slot.inputHash = canonicalHash(slot.row);
    const initial = syntheticManifest(bundle);
    const oracle = { rubricVersion: "structural-1", slots: [
      { slotId: "slot-1", kind: "none" as const, precleanupStatus: "needs_input" as const },
      { slotId: "slot-2", kind: "none" as const, precleanupStatus: "refused" as const },
    ] };
    const { manifestHash: _hash, artifacts, ...draft } = initial;
    const manifest = freezeManifest({ ...draft,
      slots: initial.slots.map((slot) => ({ ...slot, declaredEligibility: "deterministic" as const })),
    }, { ...artifacts, oracle: canonicalHash(oracle) });
    await withOfflineCampaign(async ({ receipt, admin }) => {
      const result = await runOfflineCampaign({ manifest: receipt.manifest, bundle,
        receipt, repoRoot: process.cwd() });
      expect(result.state).toBe("completed");
      expect((await admin`SELECT status FROM runs WHERE profile='pilot-v2' ORDER BY created_at`)
        .map((row) => row.status).sort()).toEqual(["needs_input", "refused"]);
      expect(await admin`SELECT call_id FROM ai_provider_calls`).toHaveLength(0);
      expect(await admin`SELECT seq FROM pilot_eval.events WHERE event_type='callback_entered'`).toHaveLength(0);
      const readOnly = await openReadonlyEvaluationStore(receipt.reportUrl, receipt.identity);
      try {
        const report = await buildOfflineReport(readOnly, oracle);
        expect(report.verdict).toBe("OFFLINE_MEASUREMENT_CONTRACT_TESTED");
        expect(report.denominators.deterministic).toBe(2);
        expect(report.structural.notRun).toBe(2);
      } finally { await readOnly.close(); }
    }, bundle, manifest);
  }, 120_000);

  it("skips only out-of-scope lookup while still measuring the next eligible HTTP slot", async () => {
    const bundle = syntheticBundle();
    const initial = syntheticManifest(bundle);
    const { manifestHash: _hash, artifacts, ...draft } = initial;
    const oracle = { rubricVersion: "structural-1", slots: [
      { slotId: "slot-1", kind: "none" as const, precleanupStatus: "out_of_scope" as const },
      { slotId: "slot-2", kind: "plan" as const, precleanupStatus: "awaiting_approval" as const },
    ] };
    const manifest = freezeManifest({ ...draft,
      slots: [{ ...initial.slots[0]!, declaredEligibility: "out_of_scope" }, initial.slots[1]!],
    }, { ...artifacts, oracle: canonicalHash(oracle) });
    await withOfflineCampaign(async ({ receipt, admin }) => {
      const result = await runOfflineCampaign({ manifest: receipt.manifest, bundle,
        receipt, repoRoot: process.cwd() });
      expect(result.state).toBe("completed");
      expect(await admin`SELECT id FROM runs WHERE profile='pilot-v2'`).toHaveLength(1);
      expect(await admin`SELECT call_id FROM ai_provider_calls`).toHaveLength(1);
      expect(await admin`SELECT seq FROM pilot_eval.events WHERE slot_id='slot-1'`).toHaveLength(0);
      const reader = await openReadonlyEvaluationStore(receipt.reportUrl, receipt.identity);
      try {
        const report = await buildOfflineReport(reader, oracle);
        expect(report.verdict).toBe('OFFLINE_MEASUREMENT_CONTRACT_TESTED');
        expect(report.denominators.outOfScope).toBe(1);
      } finally { await reader.close(); }
    }, bundle, manifest);
  }, 120_000);

  it("treats declared deterministic pass row as a safety mismatch, not an ineligible skip", async () => {
    const bundle = syntheticBundle();
    const initial = syntheticManifest(bundle);
    const { manifestHash: _hash, artifacts, ...draft } = initial;
    const manifest = freezeManifest({ ...draft,
      slots: [{ ...initial.slots[0]!, declaredEligibility: "deterministic" }, initial.slots[1]!],
    }, artifacts);
    await withOfflineCampaign(async ({ receipt, admin }) => {
      const result = await runOfflineCampaign({ manifest: receipt.manifest, bundle,
        receipt, repoRoot: process.cwd() });
      expect(result.state).toBe("incomplete");
      expect(await admin`SELECT call_id FROM ai_provider_calls`).toHaveLength(0);
      const reader = await openReadonlyEvaluationStore(receipt.reportUrl, receipt.identity);
      try { expect((await buildOfflineReport(reader, {
        rubricVersion: "structural-1", slots: [
          { slotId: "slot-1", kind: "plan", precleanupStatus: "awaiting_approval" },
          { slotId: "slot-2", kind: "plan", precleanupStatus: "awaiting_approval" },
        ],
      })).safeReasons).toContain("DETERMINISTIC_CLASSIFIER_MISMATCH"); }
      finally { await reader.close(); }
    }, bundle, manifest);
  }, 120_000);
});
