import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { freezeManifest } from "../../src/pilot-evaluation/manifest.js";
import { provisionOfflineCampaign, type PrivateBootstrapReceipt } from "../../src/pilot-evaluation/provision.js";

const adminUrl = process.env.API_TEST_ADMIN_URL ?? "postgresql://wap:wap@127.0.0.1:55532/wap_g1";
const hash = (character: string) => character.repeat(64);
export function syntheticManifest() {
  return freezeManifest({
    format: "pilot-advisory-offline-v1", measurementId: randomUUID(),
    gitCommit: hash("a"), executionMode: "offline_fake", outputContract: "pilot-advisory-v1",
    catalogMode: "fixed", costEvidence: "SIMULATED_NOT_BILLED", schemaVersion: "pilot-eval-1",
    rubricVersion: "structural-1", fakeScriptVersion: "builtin-1", provider: "google",
    model: "offline-fixture-plan", estimatedCostMicros: 10, timeoutMs: 1000,
    principals: [
      { alias: "alpha", id: randomUUID(), maxCalls: 2, limitMicros: 100 },
      { alias: "beta", id: randomUUID(), maxCalls: 2, limitMicros: 100 },
    ],
    slots: [{ slotId: "slot-1", ordinal: 0, inputHash: hash("3"), language: "en",
      principalAlias: "alpha", declaredEligibility: "eligible", scriptId: "plan",
      fixture: { spreadsheetId: "synthetic-sheet", tabId: "requests", boardId: "synthetic-board", listId: "todo", requestId: "REQ-1" },
    }],
  }, { code: hash("a"), projection: hash("b"), prompt: hash("c"), schema: hash("d"),
    fixtures: hash("e"), oracle: hash("f"), fakeScript: hash("1"), rubric: hash("2") });
}

export async function withOfflineCampaign<T>(run: (context: {
  receipt: PrivateBootstrapReceipt; admin: ReturnType<typeof postgres>;
}) => Promise<T>): Promise<T> {
  const manifest = syntheticManifest();
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
      for (const role of [receipt.identity.expectedRuntimeRole, receipt.reportRole])
        await owner.unsafe(`DROP ROLE "${role}"`);
    } finally { await owner.end(); }
  }
}
