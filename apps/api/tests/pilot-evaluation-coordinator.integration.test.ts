import { describe, expect, it, vi } from "vitest";
import { runOfflineCampaign } from "../src/pilot-evaluation/coordinator.js";
import { freezeManifest } from "../src/pilot-evaluation/manifest.js";
import { openEvaluationStore } from "../src/pilot-evaluation/provision.js";
import { syntheticBundle, syntheticManifest, withOfflineCampaign } from "./helpers/pilot-evaluation-fixture.js";

// Only Git observation is substituted in dirty TDD; DB/auth/ledger are real.
vi.mock("../src/pilot-evaluation/git-evidence.js", () => ({
  observeGitEvidence: () => ({ head: "a".repeat(40), clean: true,
    sourceDigests: { code: "a".repeat(64), projection: "b".repeat(64),
      prompt: "c".repeat(64), schema: "d".repeat(64), fakeScript: "1".repeat(64),
      rubric: "2".repeat(64) } }),
}));

describe("sequential authenticated offline pilot HTTP lifecycle", () => {
  it("logs in two actual principals, owner rejects both previews and settles simulated accounting", async () => {
    await withOfflineCampaign(async ({ receipt, admin }) => {
      const result = await runOfflineCampaign({ manifest: receipt.manifest,
        bundle: syntheticBundle(), receipt, repoRoot: process.cwd() });
      expect(result.state).toBe("completed");
      expect(result.completeness).toBe("complete");
      const runs = await admin`SELECT user_id,status FROM runs WHERE profile='pilot-v2' ORDER BY created_at`;
      expect(runs).toHaveLength(2);
      expect(runs.map((run) => run.status)).toEqual(["rejected", "rejected"]);
      expect(new Set(runs.map((run) => run.user_id)).size).toBe(2);
      const calls = await admin`SELECT user_id,status,cost_micros FROM ai_provider_calls ORDER BY created_at`;
      expect(calls).toHaveLength(2);
      expect(calls.map((call) => Number(call.cost_micros))).toEqual([10, 10]);
      expect(await admin`SELECT id FROM business_reservations`).toHaveLength(0);
      const store = await openEvaluationStore(receipt.runtimeUrl, receipt.identity);
      try {
        expect(await store.claimCampaign()).toBe(false);
        const events = await store.client`SELECT event_type FROM pilot_eval.events ORDER BY seq`;
        expect(events.filter((event) => event.event_type === "callback_entered")).toHaveLength(2);
        const slots = await store.client`SELECT precleanup_status,cleanup_status FROM pilot_eval.slots ORDER BY ordinal`;
        expect(slots).toEqual([
          { precleanup_status: "awaiting_approval", cleanup_status: "rejected" },
          { precleanup_status: "awaiting_approval", cleanup_status: "rejected" },
        ]);
      } finally { await store.close(); }
    });
  }, 120_000);

  it("rejects changed fixture bytes before a campaign claim or HTTP invocation", async () => {
    await withOfflineCampaign(async ({ receipt, admin }) => {
      const changed = syntheticBundle();
      changed.slots[0]!.row!.deliverable = "Unreviewed mutation";
      await expect(runOfflineCampaign({ manifest: receipt.manifest, bundle: changed,
        receipt, repoRoot: process.cwd() })).rejects.toThrow("Frozen input or script hash mismatch");
      expect((await admin`SELECT state FROM pilot_eval.campaigns`)[0]?.state).toBe("frozen");
      expect(await admin`SELECT id FROM runs WHERE profile='pilot-v2'`).toHaveLength(0);
    });
  }, 120_000);

  it("honors the principal call cap without a second fake dispatch", async () => {
    const bundle = syntheticBundle();
    const initial = syntheticManifest(bundle);
    const { manifestHash: _ignored, artifacts, ...draft } = initial;
    const manifest = freezeManifest({ ...draft,
      principals: [{ ...initial.principals[0], maxCalls: 1 }, initial.principals[1]],
      slots: [initial.slots[0]!, { ...initial.slots[1]!, principalAlias: "alpha" }],
    }, artifacts);
    await withOfflineCampaign(async ({ receipt, admin }) => {
      const result = await runOfflineCampaign({ manifest: receipt.manifest, bundle,
        receipt, repoRoot: process.cwd() });
      expect(result.state).toBe("incomplete");
      expect(await admin`SELECT call_id FROM ai_provider_calls`).toHaveLength(1);
      expect(await admin`SELECT id FROM runs WHERE profile='pilot-v2'`).toHaveLength(2);
      const callbacks = await admin`SELECT seq FROM pilot_eval.events WHERE event_type='callback_entered'`;
      expect(callbacks).toHaveLength(1);
    }, bundle, manifest);
  }, 120_000);
});
