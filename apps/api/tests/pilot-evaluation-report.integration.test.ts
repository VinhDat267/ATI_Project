import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { runOfflineCampaign } from "../src/pilot-evaluation/coordinator.js";
import { buildOfflineReport, openReadonlyEvaluationStore } from "../src/pilot-evaluation/report.js";
import { openEvaluationStore } from "../src/pilot-evaluation/provision.js";
import { readAccountingSnapshot } from "../src/pilot-evaluation/accounting.js";
import { syntheticBundle, syntheticOracle, withOfflineCampaign } from "./helpers/pilot-evaluation-fixture.js";

vi.mock("../src/pilot-evaluation/git-evidence.js", () => ({
  observeGitEvidence: () => ({ head: "a".repeat(40), clean: true,
    sourceDigests: { code: "a".repeat(64), projection: "b".repeat(64),
      prompt: "c".repeat(64), schema: "d".repeat(64), fakeScript: "1".repeat(64),
      rubric: "2".repeat(64) } }),
}));

describe("SQL-only structural report", () => {
  it("reconciles all selected slots with sealed observations without mutating DB", async () => {
    await withOfflineCampaign(async ({ receipt, admin }) => {
      const producer = await runOfflineCampaign({ manifest: receipt.manifest, bundle: syntheticBundle(),
        receipt, repoRoot: process.cwd() });
      expect(producer.state).toBe("completed");
      const readOnly = await openReadonlyEvaluationStore(receipt.reportUrl, receipt.identity);
      try {
        const before = await admin`SELECT count(*)::int AS n FROM pilot_eval.events`;
        const report = await buildOfflineReport(readOnly, syntheticOracle());
        expect(report.verdict).toBe("OFFLINE_MEASUREMENT_CONTRACT_TESTED");
        expect(report.selectedSlots).toBe(2);
        expect(report.structural.pass).toBe(2);
        expect(report.accounting.calls).toBe(2);
        expect(report.accounting.knownCostMicros).toBe(20);
        expect(report.observations).toEqual({ claimedCalls: 2, fakeInvocations: 2,
          validOutputs: 2, invalidOutputs: 0, errors: 0, lateReturns: 0 });
        expect(report.safety.unauthorizedCalls).toBeNull();
        expect(report.safety.unauthorizedWrites).toBeNull();
        expect(report.safety.metadataLeakage).toBeNull();
        expect(report.safety.accountingMismatch).toBe(0);
        expect(report.safety.localBusinessReservations).toBe(0);
        for (const dimension of [report.outcomes.byLanguage, report.outcomes.byPrincipal,
          report.outcomes.byRoute]) {
          expect(Object.values(dimension).reduce((sum, group) => sum + group.selected, 0)).toBe(2);
          for (const group of Object.values(dimension)) {
            expect(group.completed + group.blocked + group.notAttempted + group.outOfScope).toBe(group.selected);
            expect(Object.values(group.statuses).reduce((sum, count) => sum + count, 0)).toBe(group.selected);
          }
        }
        expect(report.outcomes.byLanguage.en).toMatchObject({ selected: 2, completed: 2,
          blocked: 0, notAttempted: 0 });
        expect(report.costEvidence).toBe("SIMULATED_NOT_BILLED");
        expect(report.aiQuality).toBe("AI_QUALITY_NOT_MEASURED");
        expect((await admin`SELECT count(*)::int AS n FROM pilot_eval.events`)[0]?.n).toBe(before[0]?.n);
        await expect(readOnly.client`UPDATE pilot_eval.campaigns SET state='completed'`).rejects.toThrow();
      } finally { await readOnly.close(); }
    });
  }, 120_000);

  it("does not fabricate safety counts when excluded source metadata changes", async () => {
    await withOfflineCampaign(async ({ receipt, admin }) => {
      await runOfflineCampaign({ manifest: receipt.manifest, bundle: syntheticBundle(),
        receipt, repoRoot: process.cwd() });
      const reader = await openReadonlyEvaluationStore(receipt.reportUrl, receipt.identity);
      try {
        const before = await buildOfflineReport(reader, syntheticOracle());
        await admin`UPDATE source_snapshots SET raw_data=jsonb_set(raw_data,'{source_note}','"different"'::jsonb)`;
        const after = await buildOfflineReport(reader, syntheticOracle());
        expect(after.safety).toEqual(before.safety);
        expect(after.observations).toEqual(before.observations);
        expect(after.safety.unauthorizedCalls).toBeNull();
      } finally { await reader.close(); }
    });
  }, 120_000);

  it("counts invalid fake output and withholds success instead of calling it a safe result", async () => {
    const bundle = syntheticBundle('invalid');
    await withOfflineCampaign(async ({ receipt }) => {
      await runOfflineCampaign({ manifest: receipt.manifest, bundle, receipt, repoRoot: process.cwd() });
      const reader = await openReadonlyEvaluationStore(receipt.reportUrl, receipt.identity);
      try {
        const report = await buildOfflineReport(reader, syntheticOracle());
        expect(report.observations.invalidOutputs).toBe(1);
        expect(report.verdict).toBe('INCOMPLETE');
        expect(report.safeReasons).toContain('OUTPUT_INVALID');
      } finally { await reader.close(); }
    }, bundle);
  }, 120_000);

  it("refuses success when eligible slots have valid empty seals but no run, call or observations", async () => {
    await withOfflineCampaign(async ({ receipt }) => {
      const producer = await openEvaluationStore(receipt.runtimeUrl, receipt.identity);
      const readOnly = await openReadonlyEvaluationStore(receipt.reportUrl, receipt.identity);
      try {
        await producer.claimCampaign();
        const accounting = await readAccountingSnapshot(producer.client, receipt.manifest);
        for (const slot of receipt.manifest.slots)
          await producer.sealSlot(slot.slotId, 'complete', 'OK', accounting.digestForSlot(slot.slotId));
        await producer.sealCampaign('completed');
        const report = await buildOfflineReport(readOnly, syntheticOracle());
        expect(report.integrity).toBe('valid');
        expect(report.verdict).toBe('INCOMPLETE');
        expect(report.safeReasons).toContain('MISSING_ELIGIBLE_EVIDENCE');
      } finally { await readOnly.close(); await producer.close(); }
    });
  }, 120_000);

  it("rejects a run whose persisted terminal status contradicts the HTTP cleanup evidence", async () => {
    await withOfflineCampaign(async ({ receipt, admin }) => {
      await runOfflineCampaign({ manifest: receipt.manifest, bundle: syntheticBundle(),
        receipt, repoRoot: process.cwd() });
      await admin`UPDATE runs SET status='failed' WHERE id=(SELECT run_id FROM pilot_eval.slots WHERE slot_id='slot-1')`;
      const reader = await openReadonlyEvaluationStore(receipt.reportUrl, receipt.identity);
      try {
        const report = await buildOfflineReport(reader, syntheticOracle());
        expect(report.verdict).toBe('INCOMPLETE');
        expect(report.safeReasons).toContain('MISSING_ELIGIBLE_EVIDENCE');
      } finally { await reader.close(); }
    });
  }, 120_000);

  it("flags missing HTTP cleanup even though valid event and call seals remain", async () => {
    await withOfflineCampaign(async ({ receipt, admin }) => {
      await runOfflineCampaign({ manifest: receipt.manifest, bundle: syntheticBundle(),
        receipt, repoRoot: process.cwd() });
      await admin`ALTER TABLE pilot_eval.slots DISABLE TRIGGER protect_slot`;
      try { await admin`UPDATE pilot_eval.slots SET cleanup_status=NULL WHERE slot_id='slot-1'`; }
      finally { await admin`ALTER TABLE pilot_eval.slots ENABLE TRIGGER protect_slot`; }
      const readOnly = await openReadonlyEvaluationStore(receipt.reportUrl, receipt.identity);
      try {
        const report = await buildOfflineReport(readOnly, syntheticOracle());
        expect(report.integrity).toBe('valid');
        expect(report.safeReasons).toContain('MISSING_ELIGIBLE_EVIDENCE');
        expect(report.verdict).toBe('INCOMPLETE');
      } finally { await readOnly.close(); }
    });
  }, 120_000);

  it("reconciles per-principal committed counters even when aggregate total cancels out", async () => {
    await withOfflineCampaign(async ({ receipt, admin }) => {
      await runOfflineCampaign({ manifest: receipt.manifest, bundle: syntheticBundle(),
        receipt, repoRoot: process.cwd() });
      await admin`UPDATE ai_provider_campaigns SET committed_micros=20
        WHERE user_id=${receipt.manifest.principals[0].id}`;
      await admin`UPDATE ai_provider_campaigns SET committed_micros=0
        WHERE user_id=${receipt.manifest.principals[1].id}`;
      const readOnly = await openReadonlyEvaluationStore(receipt.reportUrl, receipt.identity);
      try {
        const report = await buildOfflineReport(readOnly, syntheticOracle());
        expect(report.accounting.committedMicros).toBe(20);
        expect(report.accounting.knownCostMicros).toBe(20);
        expect(report.verdict).toBe('INCOMPLETE');
        expect(report.safeReasons).toContain('ACCOUNTING_COUNTER_MISMATCH');
      } finally { await readOnly.close(); }
    });
  }, 120_000);

  it("detects a held counter mismatch for one principal independently of settled calls", async () => {
    await withOfflineCampaign(async ({ receipt, admin }) => {
      await runOfflineCampaign({ manifest: receipt.manifest, bundle: syntheticBundle(),
        receipt, repoRoot: process.cwd() });
      await admin`UPDATE ai_provider_campaigns SET held_micros=10
        WHERE user_id=${receipt.manifest.principals[0].id}`;
      const reader = await openReadonlyEvaluationStore(receipt.reportUrl, receipt.identity);
      try {
        const report = await buildOfflineReport(reader, syntheticOracle());
        expect(report.verdict).toBe('INCOMPLETE');
        expect(report.safeReasons).toContain('ACCOUNTING_COUNTER_MISMATCH');
        expect(report.safety.accountingMismatch).toBe(1);
        expect(report.accounting.heldMicros).toBe(10);
      } finally { await reader.close(); }
    });
  }, 120_000);

  it("detects orphan and null usage as incomplete without changing sealed evidence", async () => {
    await withOfflineCampaign(async ({ receipt, admin }) => {
      await runOfflineCampaign({ manifest: receipt.manifest, bundle: syntheticBundle(),
        receipt, repoRoot: process.cwd() });
      await admin`UPDATE ai_provider_calls SET usage=NULL WHERE run_id=(SELECT run_id FROM pilot_eval.slots WHERE slot_id='slot-1')`;
      const readOnly = await openReadonlyEvaluationStore(receipt.reportUrl, receipt.identity);
      try {
        const report = await buildOfflineReport(readOnly, syntheticOracle());
        expect(report.verdict).toBe("INCOMPLETE");
        expect(report.accounting.unknownUsageCalls).toBe(1);
        expect(report.accounting.knownCostMicros).toBe(20);
      } finally { await readOnly.close(); }
    });
  }, 120_000);

  it("counts an unlinked principal call and blocks an apparently complete campaign", async () => {
    await withOfflineCampaign(async ({ receipt, admin }) => {
      await runOfflineCampaign({ manifest: receipt.manifest, bundle: syntheticBundle(),
        receipt, repoRoot: process.cwd() });
      const principal = receipt.manifest.principals[0].id;
      const workflow = randomUUID(), version = randomUUID(), run = randomUUID();
      await admin`INSERT INTO workflows(id,user_id,name,source_prompt) VALUES (${workflow},${principal},'Synthetic','Synthetic')`;
      await admin`INSERT INTO workflow_versions(id,workflow_id,version_no,plan,origin)
        VALUES (${version},${workflow},1,'{}','initial')`;
      await admin`INSERT INTO runs(id,user_id,workflow_id,workflow_version_id,status,source_prompt,time_zone,profile)
        VALUES (${run},${principal},${workflow},${version},'failed','Synthetic','Asia/Ho_Chi_Minh','pilot-v2')`;
      await admin`INSERT INTO ai_provider_calls(campaign_id,user_id,run_id,profile_id,provider,purpose,model,
        request_hash,estimated_cost_micros,status,usage,cost_micros,reservation_held)
        VALUES (${`pilot-v2:${principal}`},${principal},${run},'pilot-v2','google','planning',
          'offline-fixture-plan',${"a".repeat(64)},10,'succeeded',${admin.json({ inputTokens: 1 })},5,false)`;
      const readOnly = await openReadonlyEvaluationStore(receipt.reportUrl, receipt.identity);
      try {
        const report = await buildOfflineReport(readOnly, syntheticOracle());
        expect(report.verdict).toBe("INCOMPLETE");
        expect(report.accounting.calls).toBe(3);
        expect(report.accounting.orphanCalls).toBe(1);
        expect(report.accounting.knownCostMicros).toBe(25);
      } finally { await readOnly.close(); }
    });
  }, 120_000);

  it("keeps observed call totals when the persisted manifest becomes invalid", async () => {
    await withOfflineCampaign(async ({ receipt, admin }) => {
      await runOfflineCampaign({ manifest: receipt.manifest, bundle: syntheticBundle(),
        receipt, repoRoot: process.cwd() });
      // An administrator can disable the protection deliberately; the runtime login cannot.
      await admin`ALTER TABLE pilot_eval.campaigns DISABLE TRIGGER protect_campaign`;
      try { await admin`UPDATE pilot_eval.campaigns SET manifest_json=${admin.json({ invalid: true })}`; }
      finally { await admin`ALTER TABLE pilot_eval.campaigns ENABLE TRIGGER protect_campaign`; }
      const readOnly = await openReadonlyEvaluationStore(receipt.reportUrl, receipt.identity);
      try {
        const report = await buildOfflineReport(readOnly, syntheticOracle());
        expect(report.verdict).toBe("BLOCKED");
        expect(report.selectedSlots).toBe(2);
        expect(report.accounting.calls).toBe(2);
        expect(report.accounting.knownCostMicros).toBe(20);
      } finally { await readOnly.close(); }
    });
  }, 120_000);

  it("detects an admin-mutated event hash without granting report any repair ability", async () => {
    await withOfflineCampaign(async ({ receipt, admin }) => {
      await runOfflineCampaign({ manifest: receipt.manifest, bundle: syntheticBundle(),
        receipt, repoRoot: process.cwd() });
      await admin`ALTER TABLE pilot_eval.events DISABLE TRIGGER immutable_events`;
      try { await admin`UPDATE pilot_eval.events SET event_hash=${"a".repeat(64)} WHERE seq=1`; }
      finally { await admin`ALTER TABLE pilot_eval.events ENABLE TRIGGER immutable_events`; }
      const readOnly = await openReadonlyEvaluationStore(receipt.reportUrl, receipt.identity);
      try {
        const report = await buildOfflineReport(readOnly, syntheticOracle());
        expect(report.verdict).toBe("BLOCKED");
        expect(report.safeReasons).toContain("EVENT_CHAIN_DRIFT");
      } finally { await readOnly.close(); }
    });
  }, 120_000);
});
