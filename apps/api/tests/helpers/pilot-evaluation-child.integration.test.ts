import { describe, it, vi } from "vitest";
import { EvaluationStore } from "../../src/pilot-evaluation/store.js";
import { runOfflineCampaign } from "../../src/pilot-evaluation/coordinator.js";
import type { FixtureBundle } from "../../src/pilot-evaluation/contracts.js";
import type { PrivateBootstrapReceipt } from "../../src/pilot-evaluation/provision.js";

// This is only a Vitest child worker fixture; it is never imported by production.
vi.mock("../../src/pilot-evaluation/git-evidence.js", () => ({
  observeGitEvidence: () => ({ head: "a".repeat(40), clean: true,
    sourceDigests: { code: "a".repeat(64), projection: "b".repeat(64),
      prompt: "c".repeat(64), schema: "d".repeat(64), fakeScript: "1".repeat(64),
      rubric: "2".repeat(64) } }),
}));

type ChildPayload = { boundary: "claim" | "intent" | "capture" | "settle";
  receipt: PrivateBootstrapReceipt; bundle: FixtureBundle };
describe.skipIf(!process.env.PILOT_EVAL_CHILD_PAYLOAD)("synthetic child process crash fixture", () => {
  it("exits the worker immediately after the selected durable boundary", async () => {
    const payload = JSON.parse(process.env.PILOT_EVAL_CHILD_PAYLOAD!) as ChildPayload;
    const claim = EvaluationStore.prototype.claimCampaign;
    const append = EvaluationStore.prototype.appendEvent;
    if (payload.boundary === "claim") vi.spyOn(EvaluationStore.prototype, "claimCampaign")
      .mockImplementation(async function (this: EvaluationStore) {
        const result = await claim.call(this);
        if (result) process.kill(process.pid, "SIGKILL");
        return result;
      });
    if (payload.boundary === "intent" || payload.boundary === "capture")
      vi.spyOn(EvaluationStore.prototype, "appendEvent")
        .mockImplementation(async function (this: EvaluationStore, input) {
          const result = await append.call(this, input);
          if (input.type === (payload.boundary === "intent" ? "slot_intent" : "callback_entered"))
            process.kill(process.pid, "SIGKILL");
          return result;
        });
    if (payload.boundary === "settle")
      vi.spyOn(EvaluationStore.prototype, "sealSlot")
        .mockImplementation(async () => {
          process.kill(process.pid, "SIGKILL");
          throw new Error("Child termination barrier returned unexpectedly");
        });
    await runOfflineCampaign({ manifest: payload.receipt.manifest, bundle: payload.bundle,
      receipt: payload.receipt, repoRoot: process.cwd() });
    throw new Error("Crash barrier was not reached");
  });
});
