import type postgres from "postgres";
import { canonicalHash, canonicalJson } from "./manifest.js";
import { SafeEventSchema, SlotSealSchema, type DatabaseIdentity, type SafeEvent, type SlotSeal } from "./contracts.js";

export class EvaluationStore {
  constructor(readonly client: ReturnType<typeof postgres>, readonly identity: DatabaseIdentity) {}
  async close(): Promise<void> { await this.client.end({ timeout: 5 }); }

  async claimCampaign(): Promise<boolean> {
    const rows = await this.client`UPDATE pilot_eval.campaigns SET state='running'
      WHERE measurement_id=${this.identity.measurementId} AND state='frozen' RETURNING measurement_id`;
    return rows.length === 1;
  }

  async appendEvent(input: {
    slotId: string; type: SafeEvent["type"]; durationMs: number;
    payload: SafeEvent["payload"]; runId?: string; callId?: string;
  }): Promise<SafeEvent> {
    return this.client.begin(async (tx) => {
      const campaign = await tx`SELECT state FROM pilot_eval.campaigns
        WHERE measurement_id=${this.identity.measurementId} FOR UPDATE`;
      const slot = await tx`SELECT run_id,call_id FROM pilot_eval.slots
        WHERE measurement_id=${this.identity.measurementId} AND slot_id=${input.slotId}`;
      if (campaign.length !== 1 || !["running", "incomplete"].includes(campaign[0]!.state) ||
          (campaign[0]!.state === "incomplete" && input.type !== "late_return") || slot.length !== 1 ||
          (input.runId && slot[0]?.run_id !== input.runId) ||
          (input.callId && slot[0]?.call_id !== input.callId))
        throw new Error("Invalid evaluator event linkage/state");
      const sealed = await tx`SELECT completeness FROM pilot_eval.seals
        WHERE measurement_id=${this.identity.measurementId} AND slot_id=${input.slotId}`;
      if (sealed.length && (sealed[0]?.completeness !== "incomplete" || input.type !== "late_return"))
        throw new Error("Sealed slot cannot be rewritten");
      const payload = SafeEventSchema.shape.payload.parse(input.payload);
      if (Buffer.byteLength(canonicalJson(payload)) > 16_384) throw new Error("Event payload exceeds bound");
      const prior = await tx`SELECT seq,event_hash FROM pilot_eval.events
        WHERE measurement_id=${this.identity.measurementId} ORDER BY seq DESC LIMIT 1`;
      const seq = (prior[0]?.seq as number | undefined ?? 0) + 1;
      const previousHash = prior[0]?.event_hash as string | undefined ?? "0".repeat(64);
      const body = { seq, type: input.type, slotId: input.slotId, ...(input.runId ? { runId: input.runId } : {}),
        ...(input.callId ? { callId: input.callId } : {}), durationMs: input.durationMs, payload, previousHash };
      const event = SafeEventSchema.parse({ ...body, eventHash: canonicalHash(body) });
      await tx`INSERT INTO pilot_eval.events(measurement_id,seq,slot_id,event_type,run_id,call_id,duration_ms,payload,previous_hash,event_hash)
        VALUES (${this.identity.measurementId},${seq},${input.slotId},${input.type},${input.runId ?? null},${input.callId ?? null},
          ${input.durationMs},${tx.json(payload)},${previousHash},${event.eventHash})`;
      return event;
    });
  }

  async bindRun(slotId: string, runId: string): Promise<void> {
    const changed = await this.client`UPDATE pilot_eval.slots SET run_id=${runId}
      WHERE measurement_id=${this.identity.measurementId} AND slot_id=${slotId} AND run_id IS NULL RETURNING slot_id`;
    if (changed.length !== 1) throw new Error("Duplicate evaluator run binding");
  }

  async bindCall(slotId: string, runId: string, principalId: string, callId: string): Promise<void> {
    const rows = await this.client`SELECT a.call_id FROM pilot_ai_attempts a
      JOIN ai_provider_calls c ON c.call_id=a.call_id AND c.run_id=a.run_id
        AND c.user_id=a.principal_id AND c.campaign_id=a.campaign_id
      JOIN pilot_eval.slots s ON s.run_id=a.run_id AND s.principal_id=a.principal_id
      WHERE s.measurement_id=${this.identity.measurementId} AND s.slot_id=${slotId}
        AND a.run_id=${runId} AND a.principal_id=${principalId}
        AND a.call_id=${callId} AND a.state='dispatch_claimed' AND a.dispatch_claimed_at IS NOT NULL
        AND a.campaign_id=${`pilot-v2:${principalId}`}`;
    if (rows.length !== 1) throw new Error("Unclaimed or foreign pilot call");
    const changed = await this.client`UPDATE pilot_eval.slots SET call_id=${callId}
      WHERE measurement_id=${this.identity.measurementId} AND slot_id=${slotId}
        AND run_id=${runId} AND principal_id=${principalId} AND call_id IS NULL RETURNING slot_id`;
    if (changed.length !== 1) throw new Error("Duplicate evaluator call binding");
  }

  async markSlot(slotId: string, precleanupStatus: string | null, cleanupStatus: string | null): Promise<void> {
    const changed = await this.client`UPDATE pilot_eval.slots
      SET precleanup_status=${precleanupStatus},cleanup_status=${cleanupStatus}
      WHERE measurement_id=${this.identity.measurementId} AND slot_id=${slotId} RETURNING slot_id`;
    if (changed.length !== 1) throw new Error("Unknown or sealed evaluator slot");
  }

  async sealSlot(slotId: string, completeness: SlotSeal["completeness"],
    reason: SlotSeal["reason"], ledgerSnapshotHash: string): Promise<SlotSeal> {
    return this.client.begin(async (tx) => {
      const campaign = await tx`SELECT state FROM pilot_eval.campaigns WHERE measurement_id=${this.identity.measurementId} FOR UPDATE`;
      if (campaign[0]?.state !== "running") throw new Error("Campaign cannot seal slot");
      const slot = await tx`SELECT slot_id FROM pilot_eval.slots WHERE measurement_id=${this.identity.measurementId} AND slot_id=${slotId}`;
      if (slot.length !== 1) throw new Error("Unknown evaluator slot");
      const events = await tx`SELECT seq,event_hash FROM pilot_eval.events
        WHERE measurement_id=${this.identity.measurementId} AND slot_id=${slotId} ORDER BY seq`;
      const body = {
        slotId, eventStart: (events[0]?.seq as number | undefined) ?? 0,
        eventEnd: (events.at(-1)?.seq as number | undefined) ?? 0,
        eventHash: (events.at(-1)?.event_hash as string | undefined) ?? "0".repeat(64),
        ledgerSnapshotHash, completeness, reason,
      };
      const seal = SlotSealSchema.parse({ ...body, sealHash: canonicalHash(body) });
      await tx`INSERT INTO pilot_eval.seals(measurement_id,slot_id,event_start,event_end,event_hash,ledger_snapshot_hash,completeness,reason,seal_hash)
        VALUES (${this.identity.measurementId},${slotId},${body.eventStart},${body.eventEnd},${body.eventHash},${ledgerSnapshotHash},${completeness},${reason},${seal.sealHash})`;
      return seal;
    });
  }

  async sealCampaign(state: "completed" | "incomplete" | "blocked"): Promise<string> {
    return this.client.begin(async (tx) => {
      const campaign = await tx`SELECT state,manifest_hash FROM pilot_eval.campaigns
        WHERE measurement_id=${this.identity.measurementId} FOR UPDATE`;
      const rows = await tx`SELECT s.slot_id,z.seal_hash,z.completeness FROM pilot_eval.slots s
        LEFT JOIN pilot_eval.seals z USING(measurement_id,slot_id)
        WHERE s.measurement_id=${this.identity.measurementId} ORDER BY s.ordinal`;
      if (campaign[0]?.state !== "running" || (state === "completed" &&
          rows.some((row) => !row.seal_hash || row.completeness !== "complete")))
        throw new Error("Campaign incomplete or already claimed");
      const hash = canonicalHash({ manifestHash: campaign[0]!.manifest_hash, slots: rows });
      await tx`UPDATE pilot_eval.campaigns SET state=${state},sealed_hash=${hash}
        WHERE measurement_id=${this.identity.measurementId} AND state='running'`;
      return hash;
    });
  }

}
