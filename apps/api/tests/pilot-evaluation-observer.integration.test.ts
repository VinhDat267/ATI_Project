import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { openDatabase } from "@wap/db";
import { evaluateChecklist, type SourceRow, type PilotConfig, type PilotPolicy } from "@wap/engine";
import { createPilotAiAdmission } from "../src/pilot-ai-admission.js";
import { openEvaluationStore } from "../src/pilot-evaluation/provision.js";
import { createObservedFakePlanner } from "../src/pilot-evaluation/observer.js";
import { withOfflineCampaign } from "./helpers/pilot-evaluation-fixture.js";

const row: SourceRow = {
  request_id: "REQ-1", client_ref: "Synthetic", request_type: "web_change",
  raw_request: "Update /landing", deliverable: "Landing update", due_date: "2026-10-15",
  decision_status: "confirmed", source_note: "confirmed",
};

async function claimedRun(adminUrl: string, principalId: string, provider: "google" | "openai", model: string,
  estimate: number, createClaim = true) {
  const db = openDatabase(adminUrl);
  const id = randomUUID(), version = randomUUID(), runId = randomUUID();
  const checklist = evaluateChecklist(row);
  const sourceKey = `source-${runId}`;
  const policy: PilotPolicy = { enabled: true, principals: [principalId], spreadsheetId: "synthetic-sheet",
    tabId: "requests", boardId: "synthetic-board" };
  const config: PilotConfig = { ...policy, trello: { listId: "todo" } };
  await db.client`INSERT INTO workflows(id,user_id,name,source_prompt) VALUES (${id},${principalId},'Synthetic','Synthetic')`;
  await db.client`INSERT INTO workflow_versions(id,workflow_id,version_no,plan,origin) VALUES (${version},${id},1,'{}','initial')`;
  await db.client`INSERT INTO runs(id,user_id,workflow_id,workflow_version_id,status,source_prompt,time_zone,profile)
    VALUES (${runId},${principalId},${id},${version},'planning','Synthetic','Asia/Ho_Chi_Minh','pilot-v2')`;
  await db.client`INSERT INTO source_snapshots(run_id,source_key,source_revision,raw_data,checklist_version,checklist_result)
    VALUES (${runId},${sourceKey},${checklist.sourceRevision},${db.client.json(row)},${checklist.checklistVersion},${db.client.json(checklist)})`;
  const admission = createPilotAiAdmission({ db, policy, config });
  let callId: string | undefined;
  if (createClaim) {
    const attempt = await admission.admit({ runId, principalId, versionId: version, sourceKey,
      sourceRevision: checklist.sourceRevision, snapshot: { rawData: row, checklist },
      provider, model, estimate, requestHash: "c".repeat(64) });
    callId = attempt.callId;
    expect(await admission.claim({ runId, principalId, callId, versionId: version, sourceKey,
      sourceRevision: checklist.sourceRevision, snapshot: { rawData: row, checklist } })).toBe(true);
  }
  return { db, runId, callId };
}

describe("observed fake adapter after actual admission", () => {
  it("fails closed before fake when exact dispatch claim is absent", async () => {
    await withOfflineCampaign(async ({ receipt }) => {
      const ownerUrl = new URL(process.env.API_TEST_ADMIN_URL ?? "postgresql://wap:wap@127.0.0.1:55532/wap_g1");
      ownerUrl.pathname = `/${receipt.identity.databaseName}`;
      const prepared = await claimedRun(ownerUrl.href, receipt.manifest.principals[0].id,
        receipt.manifest.provider, receipt.manifest.model, receipt.manifest.estimatedCostMicros, false);
      const store = await openEvaluationStore(receipt.runtimeUrl, receipt.identity);
      try {
        await store.claimCampaign();
        const observer = createObservedFakePlanner({ store, manifest: receipt.manifest,
          slot: receipt.manifest.slots[0]!, script: "plan" });
        await expect(observer.propose({ runId: prepared.runId, principalId: receipt.manifest.principals[0].id,
          sourceKey: "synthetic", sourceRevision: "a", context: {} as never,
          signal: new AbortController().signal })).rejects.toThrow();
        expect(observer.invocations).toBe(0);
        expect(await store.client`SELECT seq FROM pilot_eval.events`).toHaveLength(0);
      } finally { await prepared.db.close(); await store.close(); }
    });
  }, 120_000);

  it("pins unique call, captures safe payload and leaves original envelope for runtime settlement", async () => {
    await withOfflineCampaign(async ({ receipt }) => {
      const ownerUrl = new URL(process.env.API_TEST_ADMIN_URL ?? "postgresql://wap:wap@127.0.0.1:55532/wap_g1");
      ownerUrl.pathname = `/${receipt.identity.databaseName}`;
      const prepared = await claimedRun(ownerUrl.href, receipt.manifest.principals[0].id,
        receipt.manifest.provider, receipt.manifest.model, receipt.manifest.estimatedCostMicros);
      const store = await openEvaluationStore(receipt.runtimeUrl, receipt.identity);
      try {
        await store.claimCampaign();
        const observer = createObservedFakePlanner({ store, manifest: receipt.manifest,
          slot: receipt.manifest.slots[0]!, script: "plan" });
        const result = await observer.propose({ runId: prepared.runId, principalId: receipt.manifest.principals[0].id,
          sourceKey: "synthetic", sourceRevision: "a", context: {} as never,
          signal: new AbortController().signal });
        expect(result.costMicros).toBe(10);
        expect(observer.invocations).toBe(1);
        const events = await store.client`SELECT event_type,call_id,payload FROM pilot_eval.events ORDER BY seq`;
        expect(events.map((event) => event.event_type)).toEqual(["callback_entered", "fake_return"]);
        expect(events.map((event) => event.call_id)).toEqual([prepared.callId, prepared.callId]);
        expect(JSON.stringify(events)).not.toMatch(/question|raw_request|reason|exception|Synthetic/);
      } finally { await prepared.db.close(); await store.close(); }
    });
  }, 120_000);

  it.each(["before", "after"] as const)("captures %s fake persistence failure without retry or cost loss", async (boundary) => {
    await withOfflineCampaign(async ({ receipt }) => {
      const ownerUrl = new URL(process.env.API_TEST_ADMIN_URL ?? "postgresql://wap:wap@127.0.0.1:55532/wap_g1");
      ownerUrl.pathname = `/${receipt.identity.databaseName}`;
      const prepared = await claimedRun(ownerUrl.href, receipt.manifest.principals[0].id,
        receipt.manifest.provider, receipt.manifest.model, receipt.manifest.estimatedCostMicros);
      const store = await openEvaluationStore(receipt.runtimeUrl, receipt.identity);
      try {
        await store.claimCampaign();
        const append = store.appendEvent.bind(store);
        const injected = vi.spyOn(store, "appendEvent");
        if (boundary === "before") injected.mockRejectedValueOnce(new Error("storage fault"));
        else injected.mockImplementationOnce(append).mockRejectedValueOnce(new Error("storage fault"));
        const observer = createObservedFakePlanner({ store, manifest: receipt.manifest,
          slot: receipt.manifest.slots[0]!, script: "plan" });
        const request = { runId: prepared.runId, principalId: receipt.manifest.principals[0].id,
          sourceKey: "synthetic", sourceRevision: "a", context: {} as never,
          signal: new AbortController().signal };
        if (boundary === "before") await expect(observer.propose(request)).rejects.toThrow("OFFLINE_CAPTURE_UNAVAILABLE");
        else expect((await observer.propose(request)).costMicros).toBe(10);
        expect(observer.invocations).toBe(boundary === "before" ? 0 : 1);
        expect(observer.tainted).toBe(true);
        const events = await store.client`SELECT event_type FROM pilot_eval.events`;
        expect(events.map((event) => event.event_type)).toEqual(boundary === "before" ? [] : ["callback_entered"]);
      } finally { await prepared.db.close(); await store.close(); }
    });
  }, 120_000);
});
