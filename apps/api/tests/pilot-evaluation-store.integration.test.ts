import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { openEvaluationStore } from "../src/pilot-evaluation/provision.js";
import { openReadonlyEvaluationStore } from "../src/pilot-evaluation/report.js";
import { withOfflineCampaign } from "./helpers/pilot-evaluation-fixture.js";

const adminUrl = process.env.API_TEST_ADMIN_URL ?? "postgresql://wap:wap@127.0.0.1:55532/wap_g1";

describe("dedicated evaluator database", () => {
  it("provisions a new DB and fails closed for wrong identity or privileged runtime role", async () => {
    await withOfflineCampaign(async ({ receipt, admin }) => {
      const store = await openEvaluationStore(receipt.runtimeUrl, receipt.identity);
      try {
        const rows = await store.client`SELECT current_user AS role, current_database() AS db`;
        expect(rows[0]?.role).toBe(receipt.identity.expectedRuntimeRole);
        expect(rows[0]?.db).toBe(receipt.identity.databaseName);
        await expect(store.client`CREATE TABLE pilot_eval.nope (id int)`).rejects.toThrow();
        await expect(store.client`UPDATE pilot_eval.marker SET measurement_id=${randomUUID()}`).rejects.toThrow();
        await expect(store.client`SET ROLE wap`).rejects.toThrow();
        await expect(openEvaluationStore(adminUrl, receipt.identity)).rejects.toThrow();
        await expect(openEvaluationStore(receipt.runtimeUrl, { ...receipt.identity, markerNonceHash: "0".repeat(64) })).rejects.toThrow();
        await expect(admin`SELECT 1`).resolves.toHaveLength(1);
      } finally { await store.close(); }
    });
  }, 120_000);

  it("rejects a report role accidentally granted mutation on an unrelated public table", async () => {
    await withOfflineCampaign(async ({ receipt, admin }) => {
      await admin.unsafe(`GRANT INSERT ON users TO "${receipt.reportRole}"`);
      await expect(openReadonlyEvaluationStore(receipt.reportUrl, receipt.identity)).rejects.toThrow("privilege");
    });
  }, 120_000);

  it("claims once, seals immutable event chain and prevents read-only mutations", async () => {
    await withOfflineCampaign(async ({ receipt }) => {
      const store = await openEvaluationStore(receipt.runtimeUrl, receipt.identity);
      const report = postgres(receipt.reportUrl, { max: 1 });
      try {
        expect((await Promise.all([store.claimCampaign(), store.claimCampaign()])).sort()).toEqual([false, true]);
        const slotId = receipt.manifest.slots[0]!.slotId;
        await store.appendEvent({ slotId, type: "slot_intent", durationMs: 0, payload: { code: "SUBMITTED" } });
        const snapshot = "a".repeat(64);
        const seal = await store.sealSlot(slotId, "incomplete", "UNLINKED_RUN", snapshot);
        expect(seal.completeness).toBe("incomplete");
        await expect(store.appendEvent({ slotId, type: "fake_return", durationMs: 1, payload: {} })).rejects.toThrow();
        await expect(store.client`UPDATE pilot_eval.events SET event_hash=${snapshot}`).rejects.toThrow();
        await expect(report`INSERT INTO pilot_eval.events(measurement_id,seq,slot_id,event_type,duration_ms,payload,previous_hash,event_hash) VALUES (${receipt.identity.measurementId},99,${slotId},'slot_intent',0,'{}',${snapshot},${snapshot})`).rejects.toThrow();
        await expect(report`UPDATE pilot_eval.seals SET completeness='complete'`).rejects.toThrow();
        await expect(report`DELETE FROM pilot_eval.events`).rejects.toThrow();
        const privileges = await report`SELECT has_function_privilege(current_user,'pilot_eval.immutable()','EXECUTE') AS can_mutate`;
        expect(privileges[0]?.can_mutate).toBe(false);
        await expect(report`SELECT pilot_eval.immutable()`).rejects.toThrow();
        await expect(report`SET ROLE wap`).rejects.toThrow();
      } finally { await report.end(); await store.close(); }
    });
  }, 120_000);
});
