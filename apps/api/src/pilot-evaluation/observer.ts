import type { PilotAccountedPlanner } from "../pilot-planner.js";
import { canonicalHash } from "./manifest.js";
import { invokeBuiltinFake } from "./fake-adapter.js";
import type { FrozenManifest, SlotDescriptor } from "./contracts.js";
import type { EvaluationStore } from "./store.js";

export function createObservedFakePlanner(options: {
  store: EvaluationStore; manifest: FrozenManifest; slot: SlotDescriptor; script: string;
}): PilotAccountedPlanner & { readonly invocations: number; readonly tainted: boolean;
  finishLateEvidence(): Promise<void> } {
  const { store, manifest, slot, script } = options;
  if (script !== slot.scriptId || !manifest.slots.some((entry) =>
    entry.slotId === slot.slotId && canonicalHash(entry) === canonicalHash(slot)))
    throw new Error("Frozen fake script mismatch");
  let invocations = 0;
  let tainted = false;
  let entered = false;
  let releaseLate!: () => void;
  const sealed = new Promise<void>((resolve) => { releaseLate = resolve; });
  let inFlight: Promise<unknown> | undefined;
  return {
    provider: manifest.provider, model: manifest.model, estimatedCostMicros: manifest.estimatedCostMicros,
    get invocations() { return invocations; },
    get tainted() { return tainted; },
    async finishLateEvidence() {
      releaseLate();
      if (!inFlight) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([inFlight.then(() => undefined, () => undefined),
          new Promise<void>((resolve) => { timer = setTimeout(resolve, Math.min(31_000, manifest.timeoutMs + 1_000)); })]);
      } finally { if (timer) clearTimeout(timer); }
    },
    async propose(input) {
      if (entered) throw new Error("Pilot fake dispatch is single-use");
      entered = true;
      const started = performance.now();
      let callId: string;
      try {
        // Runtime may not have returned HTTP runId yet; callback supplies exact durable identity.
        const bound = await store.client`SELECT run_id FROM pilot_eval.slots
          WHERE measurement_id=${store.identity.measurementId} AND slot_id=${slot.slotId}`;
        if (bound[0]?.run_id === null) await store.bindRun(slot.slotId, input.runId);
        else if (bound[0]?.run_id !== input.runId) throw new Error("Foreign evaluator run");
        const attempt = await store.client`SELECT a.call_id FROM pilot_ai_attempts a
          JOIN ai_provider_calls c ON c.call_id=a.call_id AND c.run_id=a.run_id
            AND c.campaign_id=a.campaign_id AND c.user_id=a.principal_id
          WHERE a.run_id=${input.runId} AND a.principal_id=${input.principalId}
            AND a.campaign_id=${`pilot-v2:${input.principalId}`}
            AND a.state='dispatch_claimed' AND a.call_id IS NOT NULL`;
        if (attempt.length !== 1 || !attempt[0]?.call_id) throw new Error("Missing claimed pilot call");
        callId = attempt[0].call_id as string;
        await store.bindCall(slot.slotId, input.runId, input.principalId, callId);
        await store.appendEvent({ slotId: slot.slotId, type: "callback_entered", durationMs: 0,
          runId: input.runId, callId, payload: { code: "CALL_CLAIMED" } });
      } catch {
        tainted = true;
        throw new Error("OFFLINE_CAPTURE_UNAVAILABLE");
      }
      invocations++;
      inFlight = (async () => {
      try {
        const envelope = await invokeBuiltinFake(script, manifest, input.signal);
        const kind = (envelope.proposal as { kind: string }).kind;
        // Hash generated literal builtins only, never enumerate adapter-external/proxy data.
        const digest = canonicalHash(envelope.proposal);
        try {
          if (input.signal.aborted) await sealed;
          await store.appendEvent({ slotId: slot.slotId,
            type: input.signal.aborted ? "late_return" : "fake_return",
            runId: input.runId, callId, durationMs: performance.now() - started,
            payload: { kind: kind === "plan" || kind === "clarification" || kind === "refusal" ? kind : "invalid",
              valid: script !== "invalid", digest, usageKnown: envelope.usage !== null,
              costKnown: envelope.costMicros !== null, costMicros: envelope.costMicros,
              inputTokens: envelope.usage?.inputTokens ?? null,
              outputTokens: envelope.usage?.outputTokens ?? null } });
        } catch { tainted = true; /* Keep original cost envelope for runtime settlement. */ }
        return envelope;
      } catch {
        try {
          await store.appendEvent({ slotId: slot.slotId, type: "fake_error", runId: input.runId,
            callId, durationMs: performance.now() - started, payload: { code: "FAKE_FAILURE", kind: "error" } });
        } catch { tainted = true; }
        throw new Error("OFFLINE_FAKE_ERROR");
      }
      })();
      return inFlight as ReturnType<PilotAccountedPlanner["propose"]>;
    },
  };
}
