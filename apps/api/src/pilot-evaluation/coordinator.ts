import { evaluateChecklist, sourceKey, type PilotConfig, type PilotPolicy, type SourceRow } from "@wap/engine";
import { openDatabase } from "@wap/db";
import { createApi, type ApiRuntime } from "../app.js";
import { assertCleanProvenance, assertFrozen, canonicalHash } from "./manifest.js";
import { FixtureBundleSchema, type FixtureBundle, type FrozenManifest, type SlotDescriptor } from "./contracts.js";
import { openEvaluationStore, type PrivateBootstrapReceipt } from "./provision.js";
import { createObservedFakePlanner } from "./observer.js";
import type { EvaluationStore } from "./store.js";
import { readAccountingSnapshot } from "./accounting.js";

type OfflineRunInput = {
  manifest: FrozenManifest; bundle: FixtureBundle; receipt: PrivateBootstrapReceipt; repoRoot: string;
};
export type CampaignRunResult = {
  measurementId: string; manifestHash: string; state: "completed" | "incomplete" | "blocked";
  completeness: "complete" | "incomplete"; sealHash?: string;
};

type Listener = { api: ApiRuntime; db: ReturnType<typeof openDatabase>; base: string; token: string; principalId: string };
const safeResponse = async (response: Response): Promise<Record<string, unknown>> => {
  const bytes = await response.text();
  if (bytes.length > 1_048_576) throw new Error("HTTP response exceeds fixture bound");
  const value: unknown = JSON.parse(bytes);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid pilot response");
  return value as Record<string, unknown>;
};
const post = (url: string, body: Record<string, unknown>, token?: string) => fetch(url, {
  method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});

async function openListeners(input: OfflineRunInput, store: EvaluationStore, slot: SlotDescriptor,
  row: SourceRow): Promise<{ listeners: [Listener, Listener]; observer: ReturnType<typeof createObservedFakePlanner> }> {
  const ids = input.manifest.principals.map((principal) => principal.id);
  const policy: PilotPolicy = { enabled: true, principals: ids,
    spreadsheetId: slot.fixture.spreadsheetId, tabId: slot.fixture.tabId, boardId: slot.fixture.boardId };
  const pilotConfig: PilotConfig = { ...policy, trello: { listId: slot.fixture.listId } };
  const observer = createObservedFakePlanner({ store, manifest: input.manifest, slot, script: slot.scriptId });
  const checklist = evaluateChecklist(row);
  const listeners: Listener[] = [];
  try {
    for (const [index, principal] of input.manifest.principals.entries()) {
      const login = input.receipt.logins[index]!;
      if (login.alias !== principal.alias || login.email !== `${principal.id}@offline.invalid`)
        throw new Error("Frozen login binding mismatch");
      const db = openDatabase(input.receipt.runtimeUrl);
      try {
        const api = createApi({ db, config: {
          host: "127.0.0.1", port: 0, userId: principal.id, email: login.email,
          passwordHash: login.passwordHash, sessionTtlMs: 60_000,
          cursorKey: Buffer.alloc(32, index + 1), plannerMode: "disabled",
        }, pilotConfig, pilotPolicy: policy, pilotLiveWriteEnabled: false,
        pilotPlanner: observer, pilotPlannerTimeoutMs: input.manifest.timeoutMs,
        requestLogger: () => undefined,
        readSheetsRequestFn: async (request) => {
          if (request.principalId !== principal.id || request.spreadsheetId !== slot.fixture.spreadsheetId ||
              request.tabId !== slot.fixture.tabId || request.requestId !== slot.fixture.requestId ||
              canonicalHash(request.policy) !== canonicalHash(policy) ||
              request.config.boardId !== slot.fixture.boardId || request.config.trello?.listId !== slot.fixture.listId)
            throw new Error("Frozen intake policy mismatch");
          return { row, checklist, sourceKey: sourceKey({ groupId: policy.boardId,
            spreadsheetId: policy.spreadsheetId, tabId: policy.tabId, requestId: row.request_id }),
          sourceRevision: checklist.sourceRevision };
        },
      });
        try {
          const base = await api.listen();
          const response = await post(`${base}/auth/login`, { email: login.email, password: login.password });
          const content = await safeResponse(response);
          if (response.status !== 200 || typeof content.token !== "string")
            throw new Error("Offline principal authentication failed");
          listeners.push({ api, db, base, token: content.token, principalId: principal.id });
        } catch (error) { await api.close(); throw error; }
      } catch (error) { await db.close(); throw error; }
    }
    return { listeners: listeners as [Listener, Listener], observer };
  } catch (error) {
    await Promise.all(listeners.map(async ({ api, db }) => { await api.close(); await db.close(); }));
    throw error;
  }
}

/** Production entry: Git proof is always obtained from the real checkout. */
export async function runOfflineCampaign(input: OfflineRunInput): Promise<CampaignRunResult> {
  const { manifest, receipt } = input;
  assertFrozen(manifest, receipt.manifest.artifacts);
  if (canonicalHash(manifest) !== canonicalHash(receipt.manifest) ||
      receipt.identity.measurementId !== manifest.measurementId)
    throw new Error("Frozen campaign/receipt mismatch");
  assertCleanProvenance(manifest, input.repoRoot);
  const bundle = FixtureBundleSchema.parse(input.bundle);
  if (canonicalHash(bundle) !== manifest.artifacts.fixtures ||
      bundle.slots.length !== manifest.slots.length || manifest.slots.some((slot, index) =>
        bundle.slots[index]?.slotId !== slot.slotId || bundle.slots[index]?.inputHash !== slot.inputHash ||
        bundle.slots[index]?.scriptId !== slot.scriptId || !bundle.slots[index]?.row ||
        canonicalHash(bundle.slots[index]!.row) !== slot.inputHash ||
        bundle.slots[index]!.row!.request_id !== slot.fixture.requestId))
    throw new Error("Frozen input or script hash mismatch");
  const store = await openEvaluationStore(receipt.runtimeUrl, receipt.identity);
  try {
    const frozen = await store.client`SELECT manifest_hash FROM pilot_eval.campaigns
      WHERE measurement_id=${manifest.measurementId}`;
    if (frozen.length !== 1 || frozen[0]?.manifest_hash !== manifest.manifestHash)
      throw new Error("Frozen database manifest mismatch");
    if (!await store.claimCampaign()) throw new Error("Campaign already claimed; report-only restart");
    let blocked = false;
    for (const [index, slot] of manifest.slots.entries()) {
      if (blocked) break;
      const fixture = bundle.slots[index]!;
      if (slot.declaredEligibility !== "eligible") {
        const snapshot = await readAccountingSnapshot(store.client, manifest);
        await store.sealSlot(slot.slotId, "complete", "INELIGIBLE", snapshot.digestForSlot(slot.slotId));
        continue;
      }
      const before = await readAccountingSnapshot(store.client, manifest);
      const active = await store.client`SELECT id FROM runs WHERE status::text NOT IN
        ('succeeded','failed','rejected','cancelled','expired','refused','needs_input','reconciliation_required') LIMIT 1`;
      if (before.unresolved || active.length) { blocked = true; break; }
      let opened: Awaited<ReturnType<typeof openListeners>> | undefined;
      try {
        opened = await openListeners(input, store, slot, fixture.row! as SourceRow);
        const ownerIndex = manifest.principals.findIndex((principal) => principal.alias === slot.principalAlias);
        const owner = opened.listeners[ownerIndex]!;
        const other = opened.listeners[1 - ownerIndex]!;
        const origin = new URL(owner.base).origin;
        const otherOrigin = new URL(other.base).origin;
        const path = "/pilot/v2";
        await store.appendEvent({ slotId: slot.slotId, type: "slot_intent", durationMs: 0,
          payload: { code: "SUBMISSION_INTENT" } });
        const submitted = await post(`${origin}${path}/runs`, {
          spreadsheetId: slot.fixture.spreadsheetId, tabId: slot.fixture.tabId,
          requestId: slot.fixture.requestId, userPrompt: "Create the reviewed synthetic card",
        }, owner.token);
        const accepted = await safeResponse(submitted);
        // 202.status may still say planning. Exact owner detail gives actual persisted outcome.
        if (submitted.status !== 202 || typeof accepted.runId !== "string") throw new Error("Unlinked HTTP submission");
        const runId = accepted.runId;
        const bound = await store.client`SELECT run_id FROM pilot_eval.slots
          WHERE measurement_id=${manifest.measurementId} AND slot_id=${slot.slotId}`;
        if (bound[0]?.run_id === null) await store.bindRun(slot.slotId, runId);
        else if (bound[0]?.run_id !== runId) throw new Error("HTTP/callback run mismatch");
        const unauthorizedDetail = await fetch(`${otherOrigin}${path}/runs/${runId}`, {
          headers: { authorization: `Bearer ${other.token}` },
        });
        if (unauthorizedDetail.status !== 404) throw new Error("Cross-owner detail access");
        const detailResponse = await fetch(`${origin}${path}/runs/${runId}`, {
          headers: { authorization: `Bearer ${owner.token}` },
        });
        const detail = await safeResponse(detailResponse);
        if (detailResponse.status !== 200 || detail.userId !== owner.principalId ||
            typeof detail.status !== "string") throw new Error("Owner detail mismatch");
        await store.appendEvent({ slotId: slot.slotId, type: "http_outcome", runId, durationMs: 0,
          payload: { code: "OWNER_DETAIL", status: detail.status,
            ...(detail.preview && typeof detail.preview === "object" &&
               typeof (detail.preview as Record<string, unknown>).snapshotHash === "string" ?
              { previewHash: (detail.preview as Record<string, string>).snapshotHash } : {}) } });
        await store.markSlot(slot.slotId, detail.status, null);
        let cleanupStatus = detail.status;
        if (detail.status === "awaiting_approval") {
          const preview = detail.preview as { approvalId?: string; versionId?: string; snapshotHash?: string } | undefined;
          if (!preview?.approvalId || !preview.versionId || !preview.snapshotHash)
            throw new Error("Missing owner preview");
          const reject = { approvalId: preview.approvalId, versionId: preview.versionId,
            snapshotHash: preview.snapshotHash, decision: "rejected" };
          const denied = await post(`${otherOrigin}${path}/runs/${runId}/approve`, reject, other.token);
          if (denied.status !== 404) throw new Error("Cross-owner approval access");
          const rejection = await post(`${origin}${path}/runs/${runId}/approve`, reject, owner.token);
          if (rejection.status !== 200) throw new Error("Owner rejection failed");
          const terminalResponse = await fetch(`${origin}${path}/runs/${runId}`, {
            headers: { authorization: `Bearer ${owner.token}` },
          });
          const terminal = await safeResponse(terminalResponse);
          if (terminalResponse.status !== 200 || terminal.status !== "rejected")
            throw new Error("Owner cleanup not terminal");
          cleanupStatus = "rejected";
          await store.appendEvent({ slotId: slot.slotId, type: "cleanup", runId,
            durationMs: 0, payload: { code: "OWNER_REJECTED", status: cleanupStatus } });
        }
        await store.markSlot(slot.slotId, detail.status, cleanupStatus);
        const after = await readAccountingSnapshot(store.client, manifest);
        if (opened.observer.tainted || after.unresolved || detail.status === "planning" ||
            detail.status === "running") { blocked = true; break; }
        await store.sealSlot(slot.slotId, "complete", "OK", after.digestForSlot(slot.slotId));
      } catch {
        blocked = true; // No retry after persisted intent; unknown HTTP/run/capture stays incomplete.
      } finally {
        if (opened) for (const listener of opened.listeners) {
          await listener.api.close(); await listener.db.close();
        }
      }
    }
    const snapshot = await readAccountingSnapshot(store.client, manifest);
    const rows = await store.client`SELECT s.slot_id,z.completeness FROM pilot_eval.slots s
      LEFT JOIN pilot_eval.seals z USING(measurement_id,slot_id)
      WHERE s.measurement_id=${manifest.measurementId} ORDER BY s.ordinal`;
    for (const row of rows) if (!row.completeness)
      await store.sealSlot(row.slot_id as string, "incomplete", "NOT_ATTEMPTED", snapshot.digestForSlot(row.slot_id as string));
    const complete = !blocked && !snapshot.unresolved && rows.every((row) => row.completeness === "complete");
    const state = complete ? "completed" : "incomplete";
    const sealHash = await store.sealCampaign(state);
    return { measurementId: manifest.measurementId, manifestHash: manifest.manifestHash,
      state, completeness: complete ? "complete" : "incomplete", sealHash };
  } finally { await store.close(); }
}
