import postgres from "postgres";
import { z } from "zod";
import { assertFrozen, canonicalHash } from "./manifest.js";
import { DatabaseIdentitySchema, FrozenManifestSchema, SlotSealSchema,
  type DatabaseIdentity, type FrozenManifest } from "./contracts.js";
import { readAccountingSnapshot } from "./accounting.js";

const StructuralOracleSchema = z.object({
  rubricVersion: z.string().min(1).max(64),
  slots: z.array(z.object({
    slotId: z.string().min(1).max(128),
    kind: z.enum(["plan", "clarification", "refusal", "none"]),
    precleanupStatus: z.enum(["awaiting_approval", "needs_input", "refused", "failed", "out_of_scope"]),
  }).strict()).min(1).max(100),
}).strict();
export type StructuralOracle = z.infer<typeof StructuralOracleSchema>;

type ActualSlot = { kind: "plan" | "clarification" | "refusal" | "invalid" | "error" | "none";
  precleanupStatus: string | null; cleanupStatus: string | null };
export function gradeStructuralSlot(expected: StructuralOracle["slots"][number], actual: ActualSlot): "pass" | "fail" {
  return expected.kind === actual.kind && expected.precleanupStatus === actual.precleanupStatus ? "pass" : "fail";
}

type OutcomeGroup = { selected: number; completed: number; blocked: number;
  notAttempted: number; outOfScope: number; statuses: Record<string, number> };
type OutcomeGroups = { byLanguage: Record<string, OutcomeGroup>;
  byPrincipal: Record<string, OutcomeGroup>; byRoute: Record<string, OutcomeGroup> };
type Observations = { claimedCalls: number; fakeInvocations: number | null;
  validOutputs: number; invalidOutputs: number; errors: number; lateReturns: number };
type Safety = { unauthorizedCalls: number | null; unauthorizedWrites: number | null;
  preapprovalWrites: number | null; wrongTarget: number | null; retries: number | null;
  metadataLeakage: number | null; accountingMismatch: number | null;
  localBusinessReservations: number };

function groupOutcomes(rows: Array<Record<string, unknown>>,
  metadata: Array<{ slotId: string; language: string; principal: string; route: string }>,
  complete: Set<string>, attempted: Set<string>): OutcomeGroups {
  const groups: OutcomeGroups = { byLanguage: {}, byPrincipal: {}, byRoute: {} };
  for (const item of metadata) {
    const row = rows.find((entry) => entry.slot_id === item.slotId);
    if (!row) continue;
    const category = complete.has(item.slotId) ?
      item.route === "out_of_scope" ? "outOfScope" : "completed" :
      !attempted.has(item.slotId) && !row.run_id && row.reason !== "POLICY_BLOCKED" ?
        "notAttempted" : "blocked";
    const status = typeof row.precleanup_status === "string" &&
      ["awaiting_approval","needs_input","refused","failed"].includes(row.precleanup_status) ?
      row.precleanup_status : item.route === "out_of_scope" ? "out_of_scope" : "unknown";
    for (const [dimension, key] of [[groups.byLanguage, item.language],
      [groups.byPrincipal, item.principal], [groups.byRoute, item.route]] as const) {
      const group = dimension[key] ??= { selected: 0, completed: 0, blocked: 0,
        notAttempted: 0, outOfScope: 0, statuses: {} };
      group.selected++;
      group[category]++;
      group.statuses[status] = (group.statuses[status] ?? 0) + 1;
    }
  }
  return groups;
}

function observedCounts(events: Array<Record<string, unknown>>,
  calls: Array<Record<string, unknown>>, intact: boolean): Observations {
  const callbacks = events.filter((event) => event.event_type === "callback_entered").length;
  const outputs = events.filter((event) => event.event_type === "fake_return");
  const errors = events.filter((event) => event.event_type === "fake_error").length;
  const lateReturns = events.filter((event) => event.event_type === "late_return").length;
  return { claimedCalls: calls.filter((call) => call.dispatch_claimed === true).length,
    fakeInvocations: intact && callbacks === outputs.length + errors + lateReturns ? callbacks : null,
    validOutputs: outputs.filter((event) => event.payload &&
      (event.payload as Record<string, unknown>).valid === true).length,
    invalidOutputs: outputs.filter((event) => event.payload &&
      (event.payload as Record<string, unknown>).valid === false).length,
    errors, lateReturns };
}

export interface CampaignReport {
  measurementId: string;
  verdict: "OFFLINE_MEASUREMENT_CONTRACT_TESTED" | "INCOMPLETE" | "BLOCKED";
  integrity: "valid" | "invalid"; completeness: "complete" | "incomplete";
  selectedSlots: number; denominators: {
    byLanguage: Record<string, number>; byPrincipal: Record<string, number>;
    eligible: number; deterministic: number; outOfScope: number;
  };
  structural: { pass: number; fail: number; notRun: number };
  observations: Observations; outcomes: OutcomeGroups; safety: Safety;
  accounting: { calls: number; orphanCalls: number; unknownUsageCalls: number;
    unknownCostCalls: number; knownCostMicros: number | null; heldMicros: number; committedMicros: number };
  safeReasons: string[];
  costEvidence: "SIMULATED_NOT_BILLED";
  aiQuality: "AI_QUALITY_NOT_MEASURED";
  providerLatency: "NOT_RUN";
  customerValidation: "CUSTOMER_VALIDATED_NOT_RUN";
  handoff: "HANDOFF_BLOCKED";
}

/** No mutation methods; the SQL login itself is also SELECT-only. */
export class ReadonlyEvaluationStore {
  constructor(readonly client: ReturnType<typeof postgres>, readonly identity: DatabaseIdentity) {}
  async close(): Promise<void> { await this.client.end({ timeout: 5 }); }
}
export async function openReadonlyEvaluationStore(url: string, expected: DatabaseIdentity): Promise<ReadonlyEvaluationStore> {
  const identity = DatabaseIdentitySchema.parse(expected);
  const address = new URL(url);
  if (address.protocol !== "postgresql:" || address.hostname !== "127.0.0.1" || address.port !== "55532" ||
      address.pathname !== `/${identity.databaseName}` ||
      !/^pilot_report_[0-9a-f]{32}$/.test(decodeURIComponent(address.username)))
    throw new Error("Read-only evaluator identity mismatch");
  const client = postgres(url, { max: 2, connect_timeout: 5 });
  try {
    const marker = await client`SELECT measurement_id,schema_version,nonce_hash,database_name,runtime_role,
      current_database() AS actual_database,current_user AS actual_role FROM pilot_eval_bootstrap.marker`;
    if (marker.length !== 1 || marker[0]?.measurement_id !== identity.measurementId ||
        marker[0]?.schema_version !== identity.schemaVersion || marker[0]?.nonce_hash !== identity.markerNonceHash ||
        marker[0]?.database_name !== identity.databaseName || marker[0]?.runtime_role !== identity.expectedRuntimeRole ||
        marker[0]?.actual_database !== identity.databaseName || marker[0]?.actual_role !== decodeURIComponent(address.username))
      throw new Error("Read-only evaluator marker mismatch");
    const permissions = await client`SELECT r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolbypassrls,
      has_database_privilege(current_user,current_database(),'CREATE') AS db_create,
      has_schema_privilege(current_user,'public','CREATE') AS public_create,
      has_schema_privilege(current_user,'pilot_eval','CREATE') AS eval_create,
      has_table_privilege(current_user,'pilot_eval.events','INSERT') AS event_insert,
      has_table_privilege(current_user,'pilot_eval.events','UPDATE') AS event_update,
      has_table_privilege(current_user,'pilot_eval.events','DELETE') AS event_delete,
      has_table_privilege(current_user,'pilot_eval.grades','INSERT') AS grade_insert,
      (SELECT count(*)::int FROM pg_auth_members WHERE member=r.oid) AS memberships,
      (SELECT count(*)::int FROM pg_class WHERE relowner=r.oid) AS owned
      FROM pg_roles r WHERE r.rolname=current_user`;
    const role = permissions[0];
    if (!role || Object.entries(role).some(([key, value]) =>
      key === "memberships" || key === "owned" ? value !== 0 : value !== false))
      throw new Error("Report role has mutation or DDL privilege");
    const writable = await client`SELECT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum > 0 AND NOT a.attisdropped
      WHERE n.nspname IN ('public','pilot_eval','pilot_eval_bootstrap') AND c.relkind IN ('r','p')
        AND (has_table_privilege(current_user,c.oid,'INSERT') OR
             has_table_privilege(current_user,c.oid,'UPDATE') OR
             has_table_privilege(current_user,c.oid,'DELETE') OR
             (a.attnum IS NOT NULL AND
              (has_column_privilege(current_user,c.oid,a.attnum,'INSERT') OR
               has_column_privilege(current_user,c.oid,a.attnum,'UPDATE'))))
    ) AS any_write`;
    if (writable[0]?.any_write) throw new Error("Report role has mutation privilege");
    return new ReadonlyEvaluationStore(client, identity);
  } catch (error) { await client.end(); throw error; }
}

/** Pure SQL snapshot only: never calls owner detail GET, HTTP, coordinator or provision. */
export async function buildOfflineReport(store: ReadonlyEvaluationStore, oracle: StructuralOracle): Promise<CampaignReport> {
  const measurementId = store.identity.measurementId;
  const campaigns = await store.client`SELECT manifest_json,manifest_hash,state,sealed_hash
    FROM pilot_eval.campaigns WHERE measurement_id=${measurementId}`;
  if (campaigns.length !== 1) throw new Error("Missing evaluator campaign");
  const rows = await store.client`SELECT s.slot_id,s.ordinal,s.principal_id,s.input_hash,s.eligibility,
    s.run_id,s.call_id,s.precleanup_status,s.cleanup_status,
    z.event_start,z.event_end,z.event_hash,z.ledger_snapshot_hash,z.completeness,z.reason,z.seal_hash
    FROM pilot_eval.slots s LEFT JOIN pilot_eval.seals z USING(measurement_id,slot_id)
    WHERE s.measurement_id=${measurementId} ORDER BY s.ordinal`;
  const events = await store.client`SELECT seq,slot_id,event_type,run_id,call_id,duration_ms,payload,
    previous_hash,event_hash FROM pilot_eval.events WHERE measurement_id=${measurementId} ORDER BY seq`;
  const reservations = await store.client`SELECT count(*)::int AS n FROM business_reservations`;
  const localBusinessReservations = Number(reservations[0]?.n);
  const safeReasons = new Set<string>();
  let integrity = true;
  let manifest: FrozenManifest;
  try {
    manifest = FrozenManifestSchema.parse(campaigns[0]!.manifest_json);
    assertFrozen(manifest, manifest.artifacts);
    if (campaigns[0]!.manifest_hash !== manifest.manifestHash || manifest.measurementId !== measurementId ||
        rows.length !== manifest.slots.length) throw new Error("Manifest drift");
    for (const [index, slot] of manifest.slots.entries()) {
      const row = rows[index];
      if (row?.slot_id !== slot.slotId || row?.ordinal !== slot.ordinal || row?.input_hash !== slot.inputHash ||
          row?.principal_id !== manifest.principals.find((principal) => principal.alias === slot.principalAlias)?.id)
        throw new Error("Slot drift");
    }
  } catch {
    integrity = false; safeReasons.add("MANIFEST_DRIFT");
    // A database belongs to exactly one measurement. Even with a corrupt manifest,
    // enumerate its real ledger rows; unknown metadata is not presented as zero.
    const rawCalls = await store.client`SELECT c.call_id,c.cost_micros,c.usage,
      (a.dispatch_claimed_at IS NOT NULL) AS dispatch_claimed,s.slot_id
      FROM ai_provider_calls c LEFT JOIN pilot_ai_attempts a ON a.call_id=c.call_id
      LEFT JOIN pilot_eval.slots s ON s.call_id=c.call_id
        AND s.measurement_id=${measurementId}`;
    const rawCampaigns = await store.client`SELECT held_micros,committed_micros FROM ai_provider_campaigns`;
    const unknownCostCalls = rawCalls.filter((entry) => entry.cost_micros === null).length;
    const principalCounts: Record<string, number> = {};
    for (const row of rows) principalCounts[row.principal_id as string] =
      (principalCounts[row.principal_id as string] ?? 0) + 1;
    return { measurementId, verdict: "BLOCKED", integrity: "invalid", completeness: "incomplete",
      selectedSlots: rows.length, denominators: { byLanguage: { unknown: rows.length },
        byPrincipal: principalCounts,
        eligible: rows.filter((row) => row.eligibility === "eligible").length,
        deterministic: rows.filter((row) => row.eligibility === "deterministic").length,
        outOfScope: rows.filter((row) => row.eligibility === "out_of_scope").length },
      structural: { pass: 0, fail: 0, notRun: rows.length },
      observations: observedCounts(events, rawCalls, false),
      outcomes: groupOutcomes(rows, rows.map((row) => ({ slotId: String(row.slot_id),
        language: "unknown", principal: String(row.principal_id), route: String(row.eligibility) })),
        new Set(), new Set(events.filter((event) => event.event_type === "slot_intent")
          .map((event) => String(event.slot_id)))),
      safety: { unauthorizedCalls: null, unauthorizedWrites: null, preapprovalWrites: null,
        wrongTarget: null, retries: null, metadataLeakage: null, accountingMismatch: null,
        localBusinessReservations },
      accounting: { calls: rawCalls.length, orphanCalls: rawCalls.filter((entry) => !entry.slot_id).length,
        unknownUsageCalls: rawCalls.filter((entry) => entry.usage === null).length, unknownCostCalls,
        knownCostMicros: unknownCostCalls ? null :
          rawCalls.reduce((sum, entry) => sum + Number(entry.cost_micros), 0),
        heldMicros: rawCampaigns.reduce((sum, entry) => sum + Number(entry.held_micros), 0),
        committedMicros: rawCampaigns.reduce((sum, entry) => sum + Number(entry.committed_micros), 0) },
      safeReasons: [...safeReasons], costEvidence: "SIMULATED_NOT_BILLED",
      aiQuality: "AI_QUALITY_NOT_MEASURED", providerLatency: "NOT_RUN",
      customerValidation: "CUSTOMER_VALIDATED_NOT_RUN", handoff: "HANDOFF_BLOCKED" };
  }
  const accounting = await readAccountingSnapshot(store.client, manifest);
  if (localBusinessReservations !== 0) safeReasons.add("LOCAL_SIDE_EFFECT");
  if (events.some((event) => event.event_type === "fake_return" && event.payload?.valid === false))
    safeReasons.add("OUTPUT_INVALID");
  let previousHash = "0".repeat(64);
  for (const [index, event] of events.entries()) {
    const body = { seq: event.seq, type: event.event_type, slotId: event.slot_id,
      ...(event.run_id ? { runId: event.run_id } : {}), ...(event.call_id ? { callId: event.call_id } : {}),
      durationMs: event.duration_ms, payload: event.payload, previousHash: event.previous_hash };
    if (event.seq !== index + 1 || event.previous_hash !== previousHash ||
        canonicalHash(body) !== event.event_hash || !rows.some((row) => row.slot_id === event.slot_id)) {
      integrity = false; safeReasons.add("EVENT_CHAIN_DRIFT");
    }
    previousHash = event.event_hash as string;
  }
  for (const row of rows) {
    if (!row.seal_hash) { safeReasons.add("MISSING_SEAL"); continue; }
    const body = { slotId: row.slot_id, eventStart: row.event_start, eventEnd: row.event_end,
      eventHash: row.event_hash, ledgerSnapshotHash: row.ledger_snapshot_hash,
      completeness: row.completeness, reason: row.reason };
    try {
      const seal = SlotSealSchema.parse({ ...body, sealHash: row.seal_hash });
      const before = events.filter((event) => event.slot_id === row.slot_id && event.seq <= seal.eventEnd);
      const after = events.filter((event) => event.slot_id === row.slot_id && event.seq > seal.eventEnd);
      if (canonicalHash(body) !== seal.sealHash ||
          seal.eventStart !== (before[0]?.seq ?? 0) || seal.eventEnd !== (before.at(-1)?.seq ?? 0) ||
          seal.eventHash !== (before.at(-1)?.event_hash ?? "0".repeat(64)) ||
          after.some((event) => event.event_type !== "late_return" || seal.completeness !== "incomplete"))
        throw new Error("Seal drift");
      if (seal.ledgerSnapshotHash !== accounting.digestForSlot(row.slot_id as string))
        safeReasons.add("LEDGER_DRIFT");
      if (seal.completeness === "incomplete") safeReasons.add("INCOMPLETE_SEAL");
    } catch { integrity = false; safeReasons.add("SEAL_DRIFT"); }
  }
  const campaignSeal = canonicalHash({ manifestHash: manifest.manifestHash,
    slots: rows.map((row) => ({ slot_id: row.slot_id, seal_hash: row.seal_hash,
      completeness: row.completeness })) });
  if (campaigns[0]!.sealed_hash && campaigns[0]!.sealed_hash !== campaignSeal) {
    integrity = false; safeReasons.add("CAMPAIGN_SEAL_DRIFT");
  }
  if (!campaigns[0]!.sealed_hash || campaigns[0]!.state !== "completed") safeReasons.add("CAMPAIGN_INCOMPLETE");
  if (accounting.counterMismatchCampaigns) safeReasons.add("ACCOUNTING_COUNTER_MISMATCH");
  if (accounting.unresolved) safeReasons.add("ACCOUNTING_UNKNOWN");
  const parsedOracle = StructuralOracleSchema.safeParse(oracle);
  if (!parsedOracle.success || canonicalHash(parsedOracle.data) !== manifest.artifacts.oracle ||
      parsedOracle.data.rubricVersion !== manifest.rubricVersion ||
      parsedOracle.data.slots.length !== manifest.slots.length ||
      parsedOracle.data.slots.some((entry, index) => entry.slotId !== manifest.slots[index]?.slotId))
    safeReasons.add("ORACLE_MISMATCH");
  const completeSlots = new Set<string>();
  for (const row of rows) {
    const slot = manifest.slots.find((entry) => entry.slotId === row.slot_id)!;
    if (slot.declaredEligibility === "out_of_scope") {
      if (row.run_id || row.call_id || row.completeness !== "complete" || row.reason !== "INELIGIBLE" ||
          events.some((event) => event.slot_id === row.slot_id)) safeReasons.add("OUT_OF_SCOPE_ACTIVITY");
      else completeSlots.add(row.slot_id as string);
      continue;
    }
    if (slot.declaredEligibility === "deterministic") {
      const own = events.filter((event) => event.slot_id === row.slot_id);
      const intents = own.filter((event) => event.event_type === "slot_intent");
      const outcomes = own.filter((event) => event.event_type === "http_outcome");
      const expectedStatus = parsedOracle.success ? parsedOracle.data.slots.find((entry) =>
        entry.slotId === slot.slotId)?.precleanupStatus : undefined;
      if (row.reason === "POLICY_BLOCKED" || row.call_id ||
          own.some((event) => ["callback_entered","fake_return","fake_error","late_return"].includes(event.event_type)) ||
          accounting.calls.some((call) => call.slot_id === slot.slotId))
        safeReasons.add("DETERMINISTIC_CLASSIFIER_MISMATCH");
      if (row.completeness !== "complete" || !row.run_id ||
          !["needs_input","refused"].includes(row.precleanup_status as string) ||
          row.precleanup_status !== row.cleanup_status || row.precleanup_status !== expectedStatus ||
          intents.length !== 1 || outcomes.length !== 1 ||
          outcomes[0]?.run_id !== row.run_id || outcomes[0]?.payload?.status !== row.precleanup_status ||
          own.length !== 2) safeReasons.add("MISSING_DETERMINISTIC_EVIDENCE");
      else if (!row.call_id && !own.some((event) =>
        ["callback_entered","fake_return","fake_error","late_return"].includes(event.event_type)))
        completeSlots.add(row.slot_id as string);
      continue;
    }
    const own = events.filter((event) => event.slot_id === row.slot_id &&
      event.seq <= (row.event_end as number | null ?? 0));
    const count = (type: string) => own.filter((event) => event.event_type === type);
    const call = accounting.calls.find((entry) => entry.call_id === row.call_id);
    const principal = manifest.principals.find((entry) => entry.alias === slot.principalAlias)!;
    const hasRun = typeof row.run_id === "string" && row.run_id.length > 0;
    const hasCall = typeof row.call_id === "string" && row.call_id.length > 0;
    const awaiting = row.precleanup_status === "awaiting_approval";
    if (row.completeness !== "complete" || !hasRun || !hasCall ||
        !call || call.run_id !== row.run_id || call.user_id !== principal.id ||
        call.campaign_id !== `pilot-v2:${principal.id}` ||
        call.attempt_run_id !== row.run_id || call.attempt_principal_id !== principal.id ||
        call.attempt_campaign_id !== call.campaign_id || !call.dispatch_claimed ||
        count("slot_intent").length !== 1 || count("callback_entered").length !== 1 ||
        count("fake_return").length !== 1 || count("http_outcome").length !== 1 ||
        count("callback_entered")[0]?.run_id !== row.run_id ||
        count("callback_entered")[0]?.call_id !== row.call_id ||
        count("fake_return")[0]?.run_id !== row.run_id ||
        count("fake_return")[0]?.call_id !== row.call_id ||
        count("http_outcome")[0]?.run_id !== row.run_id ||
        count("http_outcome")[0]?.payload?.status !== row.precleanup_status ||
        !row.precleanup_status || !row.cleanup_status ||
        (awaiting ? row.cleanup_status !== "rejected" || count("cleanup").length !== 1 ||
          count("cleanup")[0]?.run_id !== row.run_id ||
          count("cleanup")[0]?.payload?.status !== "rejected" :
          row.cleanup_status !== row.precleanup_status || count("cleanup").length !== 0))
      safeReasons.add("MISSING_ELIGIBLE_EVIDENCE");
    else completeSlots.add(row.slot_id as string);
  }
  const structural = { pass: 0, fail: 0, notRun: 0 };
  for (const [index, row] of rows.entries()) {
    const expected = parsedOracle.success ? parsedOracle.data.slots[index] : undefined;
    if (row.eligibility !== "eligible" || !expected || !row.seal_hash || row.completeness !== "complete") {
      structural.notRun++; continue;
    }
    const returned = events.find((event) => event.slot_id === row.slot_id && event.event_type === "fake_return");
    if (!returned) { structural.notRun++; continue; }
    const actual: ActualSlot = { kind: returned.payload?.kind ?? "none",
      precleanupStatus: row.precleanup_status as string | null,
      cleanupStatus: row.cleanup_status as string | null };
    structural[gradeStructuralSlot(expected, actual)]++;
  }
  const denominators = { byLanguage: {} as Record<string, number>, byPrincipal: {} as Record<string, number>,
    eligible: 0, deterministic: 0, outOfScope: 0 };
  for (const slot of manifest.slots) {
    denominators.byLanguage[slot.language] = (denominators.byLanguage[slot.language] ?? 0) + 1;
    denominators.byPrincipal[slot.principalAlias] = (denominators.byPrincipal[slot.principalAlias] ?? 0) + 1;
    if (slot.declaredEligibility === "eligible") denominators.eligible++;
    else if (slot.declaredEligibility === "deterministic") denominators.deterministic++;
    else denominators.outOfScope++;
  }
  if (!integrity) safeReasons.add("INTEGRITY_INVALID");
  const completeness = integrity && !safeReasons.size;
  return { measurementId, verdict: !integrity ? "BLOCKED" : completeness ?
    "OFFLINE_MEASUREMENT_CONTRACT_TESTED" : "INCOMPLETE", integrity: integrity ? "valid" : "invalid",
    completeness: completeness ? "complete" : "incomplete", selectedSlots: rows.length,
    denominators, structural,
    observations: observedCounts(events, accounting.calls, integrity),
    outcomes: groupOutcomes(rows, manifest.slots.map((slot) => ({ slotId: slot.slotId,
      language: slot.language, principal: slot.principalAlias, route: slot.declaredEligibility })),
      completeSlots, new Set(events.filter((event) => event.event_type === "slot_intent")
        .map((event) => String(event.slot_id)))),
    safety: { unauthorizedCalls: null, unauthorizedWrites: null, preapprovalWrites: null,
      wrongTarget: null, retries: integrity && !safeReasons.size ?
        accounting.calls.length - new Set(accounting.calls.map((call) => call.slot_id)).size : null,
      metadataLeakage: null, accountingMismatch: accounting.counterMismatchCampaigns,
      localBusinessReservations },
    accounting: { calls: accounting.calls.length, orphanCalls: accounting.orphanCalls,
      unknownUsageCalls: accounting.unknownUsageCalls, unknownCostCalls: accounting.unknownCostCalls,
      knownCostMicros: accounting.knownCostMicros, heldMicros: accounting.heldMicros,
      committedMicros: accounting.committedMicros },
    safeReasons: [...safeReasons].sort(), costEvidence: "SIMULATED_NOT_BILLED",
    aiQuality: "AI_QUALITY_NOT_MEASURED", providerLatency: "NOT_RUN",
    customerValidation: "CUSTOMER_VALIDATED_NOT_RUN", handoff: "HANDOFF_BLOCKED" };
}
