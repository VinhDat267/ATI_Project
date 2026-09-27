import type postgres from "postgres";
import { canonicalHash } from "./manifest.js";
import type { FrozenManifest } from "./contracts.js";

type SqlClient = ReturnType<typeof postgres>;

/** Includes every principal campaign call, even calls not linked to any selected slot. */
export async function readAccountingSnapshot(client: SqlClient, manifest: FrozenManifest): Promise<{
  calls: Array<Record<string, unknown>>; heldMicros: number; committedMicros: number;
  unresolved: boolean; orphanCalls: number; unknownUsageCalls: number; unknownCostCalls: number;
  knownCostMicros: number | null; digestForSlot: (slotId: string) => string;
}> {
  const ids = manifest.principals.map((principal) => `pilot-v2:${principal.id}`);
  const campaigns = await client`SELECT campaign_id,held_micros,committed_micros,halted FROM ai_provider_campaigns
    WHERE campaign_id IN (${ids[0]!},${ids[1]!}) ORDER BY campaign_id`;
  const calls = await client`SELECT c.call_id,c.campaign_id,c.user_id,c.run_id,c.status,c.usage,c.cost_micros,c.reservation_held,
    a.state AS attempt_state,s.slot_id
    FROM ai_provider_calls c LEFT JOIN pilot_ai_attempts a ON a.call_id=c.call_id
    LEFT JOIN pilot_eval.slots s ON s.call_id=c.call_id AND s.measurement_id=${manifest.measurementId}
    WHERE c.campaign_id IN (${ids[0]!},${ids[1]!}) ORDER BY c.call_id`;
  const events = await client`SELECT call_id,event_type FROM pilot_eval.events
    WHERE measurement_id=${manifest.measurementId} AND call_id IS NOT NULL`;
  const unknownUsageCalls = calls.filter((call) => call.usage === null).length;
  const unknownCostCalls = calls.filter((call) => call.cost_micros === null).length;
  const orphanCalls = calls.filter((call) => !call.slot_id).length;
  const heldMicros = campaigns.reduce((sum, item) => sum + Number(item.held_micros), 0);
  const committedMicros = campaigns.reduce((sum, item) => sum + Number(item.committed_micros), 0);
  const unresolved = campaigns.length !== 2 || !Number.isSafeInteger(heldMicros) ||
    !Number.isSafeInteger(committedMicros) || heldMicros !== 0 ||
    campaigns.some((campaign) => campaign.halted) || calls.some((call) =>
      !call.slot_id || !call.call_id || call.reservation_held || call.cost_micros === null ||
      call.usage === null || call.attempt_state !== "settled" ||
      !["succeeded", "failed", "invalid_output", "cancelled"].includes(call.status as string) ||
      events.filter((event) => event.call_id === call.call_id && event.event_type === "callback_entered").length !== 1 ||
      events.filter((event) => event.call_id === call.call_id && event.event_type === "fake_return").length !== 1);
  const cost = calls.reduce((sum, item) => sum + Number(item.cost_micros ?? 0), 0);
  return { calls: [...calls], heldMicros, committedMicros, unresolved, orphanCalls,
    unknownUsageCalls, unknownCostCalls, knownCostMicros: unknownCostCalls ? null : cost,
    digestForSlot: (slotId) => canonicalHash(calls.filter((item) => item.slot_id === slotId)),
  };
}
