import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { runOfflineCampaign } from "../src/pilot-evaluation/coordinator.js";
import { buildOfflineReport, openReadonlyEvaluationStore } from "../src/pilot-evaluation/report.js";
import { syntheticBundle, syntheticOracle, withOfflineCampaign } from "./helpers/pilot-evaluation-fixture.js";

vi.mock("../src/pilot-evaluation/git-evidence.js", () => ({
  observeGitEvidence: () => ({ head: "a".repeat(40), clean: true }),
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
        expect(report.costEvidence).toBe("SIMULATED_NOT_BILLED");
        expect(report.aiQuality).toBe("AI_QUALITY_NOT_MEASURED");
        expect((await admin`SELECT count(*)::int AS n FROM pilot_eval.events`)[0]?.n).toBe(before[0]?.n);
        await expect(readOnly.client`UPDATE pilot_eval.campaigns SET state='completed'`).rejects.toThrow();
      } finally { await readOnly.close(); }
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
      await admin`UPDATE pilot_eval.campaigns SET manifest_json=${admin.json({ invalid: true })}`;
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
