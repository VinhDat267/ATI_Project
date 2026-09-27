import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { canonicalHash, freezeManifest } from "../../src/pilot-evaluation/manifest.js";
import type { FixtureBundle } from "../../src/pilot-evaluation/contracts.js";
import { FakeScriptIdSchema } from "../../src/pilot-evaluation/contracts.js";
import { provisionOfflineCampaign, type PrivateBootstrapReceipt } from "../../src/pilot-evaluation/provision.js";
import type { FrozenManifest } from "../../src/pilot-evaluation/contracts.js";

const adminUrl = process.env.API_TEST_ADMIN_URL ?? "postgresql://wap:wap@127.0.0.1:55532/wap_g1";
const hash = (character: string) => character.repeat(64);
export function syntheticBundle(firstScript: "plan" | "missing_usage" = "plan"): FixtureBundle {
  const row = (requestId: string) => ({
    request_id: requestId, client_ref: "Synthetic", request_type: "web_change",
    raw_request: "Update /landing", deliverable: "Landing update", due_date: "2026-10-15",
    decision_status: "confirmed", source_note: "confirmed",
  });
  return { slots: [
    { slotId: "slot-1", inputHash: canonicalHash(row("REQ-1")), scriptId: FakeScriptIdSchema.parse(firstScript), row: row("REQ-1") },
    { slotId: "slot-2", inputHash: canonicalHash(row("REQ-2")), scriptId: "plan", row: row("REQ-2") },
  ] };
}
export function syntheticOracle() {
  return { rubricVersion: "structural-1" as const, slots: [
    { slotId: "slot-1", kind: "plan" as const, precleanupStatus: "awaiting_approval" as const },
    { slotId: "slot-2", kind: "plan" as const, precleanupStatus: "awaiting_approval" as const },
  ] };
}
export function syntheticManifest(bundle = syntheticBundle()) {
  return freezeManifest({
    format: "pilot-advisory-offline-v1", measurementId: randomUUID(),
    gitCommit: "a".repeat(40), executionMode: "offline_fake", outputContract: "pilot-advisory-v1",
    catalogMode: "fixed", costEvidence: "SIMULATED_NOT_BILLED", schemaVersion: "pilot-eval-1",
    rubricVersion: "structural-1", fakeScriptVersion: "builtin-1", provider: "google",
    model: "offline-fixture-plan", estimatedCostMicros: 10, timeoutMs: 1000,
    principals: [
      { alias: "alpha", id: randomUUID(), maxCalls: 2, limitMicros: 100 },
      { alias: "beta", id: randomUUID(), maxCalls: 2, limitMicros: 100 },
    ],
    slots: bundle.slots.map((entry, ordinal) => ({ slotId: entry.slotId, ordinal,
      inputHash: entry.inputHash, language: "en" as const,
      principalAlias: ordinal === 0 ? "alpha" : "beta", declaredEligibility: "eligible" as const,
      scriptId: entry.scriptId,
      fixture: { spreadsheetId: "synthetic-sheet", tabId: "requests", boardId: "synthetic-board", listId: "todo", requestId: entry.row!.request_id },
    })),
  }, { code: hash("a"), projection: hash("b"), prompt: hash("c"), schema: hash("d"),
    fixtures: canonicalHash(bundle), oracle: canonicalHash(syntheticOracle()), fakeScript: hash("1"), rubric: hash("2") });
}

export async function withOfflineCampaign<T>(run: (context: {
  receipt: PrivateBootstrapReceipt; admin: ReturnType<typeof postgres>;
}) => Promise<T>, bundle = syntheticBundle(), manifest: FrozenManifest = syntheticManifest(bundle)): Promise<T> {
  const receipt = await provisionOfflineCampaign(adminUrl, manifest);
  const adminAddress = new URL(adminUrl);
  adminAddress.pathname = `/${receipt.identity.databaseName}`;
  const admin = postgres(adminAddress.href, { max: 1 });
  try { return await run({ receipt, admin }); }
  finally {
    await admin.end();
    const owner = postgres(adminUrl, { max: 1 });
    try {
      const db = receipt.identity.databaseName;
      await owner.unsafe(`DROP DATABASE "${db}" WITH (FORCE)`);
      for (const role of [receipt.identity.expectedRuntimeRole, receipt.reportRole, receipt.graderRole])
        await owner.unsafe(`DROP ROLE "${role}"`);
    } finally { await owner.end(); }
  }
}
