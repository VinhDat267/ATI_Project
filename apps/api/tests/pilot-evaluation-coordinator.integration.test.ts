import { describe, expect, it, vi } from "vitest";
import { runOfflineCampaign } from "../src/pilot-evaluation/coordinator.js";
import { openEvaluationStore } from "../src/pilot-evaluation/provision.js";
import { syntheticBundle, withOfflineCampaign } from "./helpers/pilot-evaluation-fixture.js";

// Only Git observation is substituted in dirty TDD; DB/auth/ledger are real.
vi.mock("../src/pilot-evaluation/git-evidence.js", () => ({
  observeGitEvidence: () => ({ head: "a".repeat(40), clean: true }),
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
});
