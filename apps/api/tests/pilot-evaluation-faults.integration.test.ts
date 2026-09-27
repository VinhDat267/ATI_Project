import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runOfflineCampaign } from "../src/pilot-evaluation/coordinator.js";
import { openReadonlyEvaluationStore, buildOfflineReport } from "../src/pilot-evaluation/report.js";
import { openEvaluationStore } from "../src/pilot-evaluation/provision.js";
import { syntheticBundle, syntheticOracle, withOfflineCampaign } from "./helpers/pilot-evaluation-fixture.js";

vi.mock("../src/pilot-evaluation/git-evidence.js", () => ({
  observeGitEvidence: () => ({ head: "a".repeat(40), clean: true }),
}));

const apiRoot = fileURLToPath(new URL("../", import.meta.url));
const runner = path.resolve(apiRoot, "../../node_modules/vitest/vitest.mjs");

describe("real child termination at durable evaluator boundaries", () => {
  it.each(["claim", "intent", "capture", "settle"] as const)("stops at %s and refuses restart after process exit", async (boundary) => {
    await withOfflineCampaign(async ({ receipt, admin }) => {
      const child = spawnSync(process.execPath, [runner, "run", "--config", "vitest.integration.config.ts",
        "tests/helpers/pilot-evaluation-child.integration.test.ts"], {
        cwd: apiRoot, encoding: "utf8", timeout: 45_000,
        env: { ...process.env, PILOT_EVAL_CHILD_PAYLOAD: JSON.stringify({ boundary, receipt, bundle: syntheticBundle() }) },
      });
      // Deliberate process exit happens in a Vitest worker: launcher returns a nonzero failure.
      expect(child.error).toBeUndefined();
      expect(child.status).not.toBe(0);
      expect(child.stdout + child.stderr).toMatch(/worker|exited|terminated|86/i);
      const db = await openEvaluationStore(receipt.runtimeUrl, receipt.identity);
      const report = await openReadonlyEvaluationStore(receipt.reportUrl, receipt.identity);
      try {
        const state = await db.client`SELECT state FROM pilot_eval.campaigns`;
        const events = await db.client`SELECT event_type FROM pilot_eval.events ORDER BY seq`;
        expect(state[0]?.state).toBe("running");
        expect(events.map((entry) => entry.event_type)).toEqual(
          boundary === "claim" ? [] : boundary === "intent" ? ["slot_intent"] :
          boundary === "capture" ? ["slot_intent", "callback_entered"] :
          ["slot_intent", "callback_entered", "fake_return", "http_outcome", "cleanup"]);
        const calls = await admin`SELECT status,cost_micros,reservation_held FROM ai_provider_calls`;
        expect(calls).toHaveLength(boundary === "claim" || boundary === "intent" ? 0 : 1);
        if (boundary === "capture") expect(calls[0]?.reservation_held).toBe(true);
        if (boundary === "settle") expect(Number(calls[0]?.cost_micros)).toBe(10);
        expect((await buildOfflineReport(report, syntheticOracle())).verdict).toBe("INCOMPLETE");
        await expect(runOfflineCampaign({ manifest: receipt.manifest, bundle: syntheticBundle(),
          receipt, repoRoot: process.cwd() })).rejects.toThrow("report-only restart");
        expect(await admin`SELECT id FROM runs WHERE profile='pilot-v2'`).toHaveLength(
          boundary === "claim" || boundary === "intent" ? 0 : 1);
      } finally { await report.close(); await db.close(); }
    });
  }, 120_000);

  it("blocks a broken runtime grant before claiming or appending intent", async () => {
    await withOfflineCampaign(async ({ receipt, admin }) => {
      await admin.unsafe(`REVOKE SELECT ON pilot_ai_grants FROM "${receipt.identity.expectedRuntimeRole}"`);
      await expect(openEvaluationStore(receipt.runtimeUrl, receipt.identity)).rejects.toThrow("privilege");
      expect((await admin`SELECT state FROM pilot_eval.campaigns`)[0]?.state).toBe("frozen");
      expect(await admin`SELECT seq FROM pilot_eval.events`).toHaveLength(0);
    });
  }, 120_000);

  it("stops on missing usage even when fake cost was known and settled", async () => {
    const bundle = syntheticBundle("missing_usage");
    await withOfflineCampaign(async ({ receipt, admin }) => {
      const result = await runOfflineCampaign({ manifest: receipt.manifest, bundle,
        receipt, repoRoot: process.cwd() });
      expect(result.state).toBe("incomplete");
      const calls = await admin`SELECT usage,cost_micros,reservation_held FROM ai_provider_calls`;
      expect(calls).toHaveLength(1);
      expect(calls[0]?.usage).toBeNull();
      expect(Number(calls[0]?.cost_micros)).toBe(10);
      const readOnly = await openReadonlyEvaluationStore(receipt.reportUrl, receipt.identity);
      try {
        const report = await buildOfflineReport(readOnly, syntheticOracle());
        expect(report.accounting.unknownUsageCalls).toBe(1);
        expect(report.accounting.knownCostMicros).toBe(10);
        expect(report.selectedSlots).toBe(2);
        expect(report.verdict).toBe("INCOMPLETE");
      } finally { await readOnly.close(); }
    }, bundle);
  }, 120_000);

  it("does not dispatch a second slot after owner reject HTTP fails", async () => {
    await withOfflineCampaign(async ({ receipt, admin }) => {
      const actualFetch = globalThis.fetch;
      let rejections = 0;
      const spy = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
        const body = typeof init?.body === "string" ? init.body : "";
        if (new URL(String(input)).pathname.endsWith("/approve") && body.includes('"decision":"rejected"')) {
          rejections++;
          // First negative cross-owner request reaches real API; second owner cleanup is faulted.
          if (rejections === 2) return Promise.resolve(new Response("{}", { status: 503 }));
        }
        return actualFetch(input, init);
      });
      let result;
      try { result = await runOfflineCampaign({ manifest: receipt.manifest,
        bundle: syntheticBundle(), receipt, repoRoot: process.cwd() }); }
      finally { spy.mockRestore(); }
      expect(result.state).toBe("incomplete");
      expect(rejections).toBe(2);
      expect(await admin`SELECT id FROM runs WHERE profile='pilot-v2'`).toHaveLength(1);
      expect(await admin`SELECT call_id FROM ai_provider_calls`).toHaveLength(1);
    });
  }, 120_000);

  it("allows only one concurrent campaign claim and cannot rerun an incomplete campaign", async () => {
    await withOfflineCampaign(async ({ receipt }) => {
      const first = await openEvaluationStore(receipt.runtimeUrl, receipt.identity);
      const second = await openEvaluationStore(receipt.runtimeUrl, receipt.identity);
      try {
        expect((await Promise.all([first.claimCampaign(), second.claimCampaign()])).sort()).toEqual([false, true]);
        expect(await first.claimCampaign()).toBe(false);
      } finally { await first.close(); await second.close(); }
    });
  }, 120_000);

  it("stops the next principal slot when the previous principal grant drifts after cleanup", async () => {
    await withOfflineCampaign(async ({ receipt, admin }) => {
      const actualFetch = globalThis.fetch;
      let decisions = 0;
      const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const response = await actualFetch(input, init);
        if (new URL(String(input)).pathname.endsWith("/approve") && response.status === 200) {
          decisions++;
          await admin`UPDATE pilot_ai_grants SET revoked_at=clock_timestamp()
            WHERE principal_id=${receipt.manifest.principals[0].id}`;
        }
        return response;
      });
      let result;
      try { result = await runOfflineCampaign({ manifest: receipt.manifest,
        bundle: syntheticBundle(), receipt, repoRoot: process.cwd() }); }
      finally { spy.mockRestore(); }
      expect(decisions).toBe(1);
      expect(result.state).toBe("incomplete");
      expect(await admin`SELECT id FROM runs WHERE profile='pilot-v2'`).toHaveLength(1);
      expect(await admin`SELECT call_id FROM ai_provider_calls`).toHaveLength(1);
    });
  }, 120_000);

  it("stops before fake on grant revocation without treating the failed run as model refusal", async () => {
    await withOfflineCampaign(async ({ receipt, admin }) => {
      const principal = receipt.manifest.principals[0].id;
      await admin`UPDATE pilot_ai_grants SET revoked_at=clock_timestamp() WHERE principal_id=${principal}`;
      const result = await runOfflineCampaign({ manifest: receipt.manifest, bundle: syntheticBundle(),
        receipt, repoRoot: process.cwd() });
      expect(result.state).toBe("incomplete");
      expect(await admin`SELECT call_id FROM ai_provider_calls`).toHaveLength(0);
      const readOnly = await openReadonlyEvaluationStore(receipt.reportUrl, receipt.identity);
      try {
        const report = await buildOfflineReport(readOnly, syntheticOracle());
        expect(report.verdict).toBe("INCOMPLETE");
        expect(report.selectedSlots).toBe(2);
        expect(report.structural.pass).toBe(0);
        expect(report.structural.notRun).toBe(2);
      } finally { await readOnly.close(); }
    });
  }, 120_000);
});
