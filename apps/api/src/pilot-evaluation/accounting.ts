import type postgres from "postgres";
import { canonicalHash } from "./manifest.js";
import type { FrozenManifest } from "./contracts.js";

type SqlClient = ReturnType<typeof postgres>;

/** Includes every principal campaign call, even calls not linked to any selected slot. */
export async function readAccountingSnapshot(client: SqlClient, manifest: FrozenManifest,
  enforceCurrentGrants = false): Promise<{
  calls: Array<Record<string, unknown>>; heldMicros: number; committedMicros: number;
  unresolved: boolean; orphanCalls: number; unknownUsageCalls: number; unknownCostCalls: number;
  knownCostMicros: number | null; digestForSlot: (slotId: string) => string;
}> {
  const ids = manifest.principals.map((principal) => `pilot-v2:${principal.id}`);
  const campaigns = await client`SELECT campaign_id,user_id,limit_micros,held_micros,committed_micros,halted FROM ai_provider_campaigns
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
  const grants = enforceCurrentGrants ? await client`SELECT principal_id,campaign_id,provider,model,max_calls,
    max_estimated_cost_micros,(revoked_at IS NULL AND expires_at > clock_timestamp()) AS valid
    FROM pilot_ai_grants WHERE campaign_id IN (${ids[0]!},${ids[1]!})` : [];
  const drift = enforceCurrentGrants && manifest.principals.some((principal) => {
    const campaign = campaigns.find((entry) => entry.campaign_id === `pilot-v2:${principal.id}`);
    const grant = grants.find((entry) => entry.principal_id === principal.id);
    return !campaign || !grant || campaign.user_id !== principal.id ||
      Number(campaign.limit_micros) !== principal.limitMicros || !grant.valid ||
      grant.campaign_id !== `pilot-v2:${principal.id}` || grant.provider !== manifest.provider ||
      grant.model !== manifest.model || grant.max_calls !== principal.maxCalls ||
      Number(grant.max_estimated_cost_micros) !== manifest.estimatedCostMicros;
  });
  const unresolved = drift || campaigns.length !== 2 || !Number.isSafeInteger(heldMicros) ||
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
