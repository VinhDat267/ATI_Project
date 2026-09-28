import type { Database } from "@wap/db";
import {
  assertPilotAccess,
  reservePostgresProviderCallInTransaction,
  settlePostgresProviderCallInTransaction,
  type ChecklistResult,
  type PilotConfig,
  type PilotPolicy,
  type ProviderCallSettlement,
  type SourceRow,
} from "@wap/engine";
import type postgres from "postgres";

export class PilotAiAdmissionError extends Error {
  constructor(readonly code: "PILOT_AI_UNAUTHORIZED" | "PILOT_AI_BUDGET" | "PILOT_AI_CALL_LIMIT" | "PILOT_AI_CONFLICT") {
    super("Pilot AI call is unavailable");
  }
}

type Grant = {
  principal_id: string;
  campaign_id: string;
  provider: string;
  model: string;
  billing_mode: string;
  endpoint: string | null;
  no_paid_fallback: boolean;
  max_calls: number;
  max_estimated_cost_micros: string | number;
  valid: boolean;
};
type Campaign = {
  campaign_id: string;
  user_id: string;
  halted: boolean;
  held_micros: string | number;
  committed_micros: string | number;
  limit_micros: string | number;
};
type Run = { id: string; workflow_version_id: string; status: string; profile: string };
type Snapshot = {
  source_key: string;
  source_revision: string;
  checklist_result: {
    status?: string;
    sourceRevision?: string;
    unconfirmedBusiness?: boolean;
    missingFields?: unknown;
  };
};

export interface PilotAiAdmissionInput {
  readonly runId: string;
  readonly principalId: string;
  readonly versionId: string;
  readonly sourceKey: string;
  readonly sourceRevision: string;
  readonly provider: "google" | "openai";
  readonly model: string;
  readonly estimate: number;
  readonly billingMode?: "METERED" | "INCLUDED_SUBSCRIPTION";
  readonly endpoint?: string;
  readonly noPaidFallback?: boolean;
  readonly requestHash: string;
  readonly snapshot: { readonly rawData: SourceRow; readonly checklist: ChecklistResult };
}

export interface PilotAiClaimInput {
  readonly runId: string;
  readonly principalId: string;
  readonly callId: string;
  readonly versionId: string;
  readonly sourceKey: string;
  readonly sourceRevision: string;
  readonly snapshot: { readonly rawData: SourceRow; readonly checklist: ChecklistResult };
}

function campaignFor(principalId: string): string {
  return `pilot-v2:${principalId}`;
}

function validSnapshot(snapshot: Snapshot | undefined, sourceRevision: string, sourceKey?: string): boolean {
  const checklist = snapshot?.checklist_result;
  return Boolean(snapshot && snapshot.source_revision === sourceRevision &&
    (sourceKey === undefined || snapshot.source_key === sourceKey) &&
    checklist?.sourceRevision === sourceRevision && checklist.status === "pass" &&
    !checklist.unconfirmedBusiness && Array.isArray(checklist.missingFields) &&
    checklist.missingFields.length === 0);
}

export function matchesPilotGrant(grant: Grant | undefined, principalId: string, planner: {
  provider: "google" | "openai"; model: string; estimatedCostMicros: number;
  billingMode?: "METERED" | "INCLUDED_SUBSCRIPTION";
  endpoint?: string; noPaidFallback?: boolean;
}): boolean {
  if (!grant || !grant.valid || grant.principal_id !== principalId ||
      grant.campaign_id !== campaignFor(principalId) || grant.provider !== planner.provider ||
      grant.model !== planner.model || grant.billing_mode !== (planner.billingMode ?? "METERED") ||
      grant.endpoint !== (planner.endpoint ?? null) ||
      grant.no_paid_fallback !== (planner.noPaidFallback ?? false) ||
      !Number.isSafeInteger(planner.estimatedCostMicros)) return false;
  return grant.billing_mode === "INCLUDED_SUBSCRIPTION"
    ? grant.provider === "openai" && grant.model === "cx/gpt-5.6-sol" &&
      grant.endpoint === "http://localhost:20128/v1" && grant.no_paid_fallback &&
      grant.max_calls === 1 && planner.estimatedCostMicros === 0 &&
      Number(grant.max_estimated_cost_micros) === 0
    : grant.billing_mode === "METERED" && planner.estimatedCostMicros > 0 &&
      planner.estimatedCostMicros <= Number(grant.max_estimated_cost_micros);
}

export function createPilotAiAdmission(options: {
  db: Database;
  policy: PilotPolicy;
  config: PilotConfig;
}) {
  const { db, policy, config } = options;
  const checkPolicy = (principalId: string): void => {
    if (!policy.enabled || !config.enabled ||
        !policy.principals.includes(principalId) || !config.principals.includes(principalId) ||
        policy.spreadsheetId !== config.spreadsheetId || policy.tabId !== config.tabId ||
        policy.boardId !== config.boardId)
      throw new PilotAiAdmissionError("PILOT_AI_UNAUTHORIZED");
    assertPilotAccess(policy, principalId, {
      kind: "source", spreadsheetId: config.spreadsheetId, tabId: config.tabId,
    });
  };

  const grantRows = (tx: postgres.TransactionSql, principalId: string, lock: boolean) => {
    const campaignId = campaignFor(principalId);
    return lock
      ? tx<Grant[]>`
          SELECT principal_id,campaign_id,provider,model,billing_mode,endpoint,no_paid_fallback,max_calls,max_estimated_cost_micros,
                 (revoked_at IS NULL AND expires_at > clock_timestamp()) AS valid
          FROM pilot_ai_grants WHERE campaign_id=${campaignId} AND principal_id=${principalId}
          FOR UPDATE`
      : tx<Grant[]>`
          SELECT principal_id,campaign_id,provider,model,billing_mode,endpoint,no_paid_fallback,max_calls,max_estimated_cost_micros,
                 (revoked_at IS NULL AND expires_at > clock_timestamp()) AS valid
          FROM pilot_ai_grants WHERE campaign_id=${campaignId} AND principal_id=${principalId}`;
  };

  async function preflight(principalId: string, planner: {
    readonly provider: "google" | "openai";
    readonly model: string;
    readonly estimatedCostMicros: number;
    readonly billingMode?: "METERED" | "INCLUDED_SUBSCRIPTION";
    readonly endpoint?: string;
    readonly noPaidFallback?: boolean;
  }): Promise<void> {
    checkPolicy(principalId);
    const campaignId = campaignFor(principalId);
    const rows = await db.client<Grant[]>`
      SELECT g.principal_id,g.campaign_id,g.provider,g.model,g.billing_mode,g.endpoint,g.no_paid_fallback,g.max_calls,
             g.max_estimated_cost_micros,
             (g.revoked_at IS NULL AND g.expires_at > clock_timestamp() AND NOT c.halted) AS valid
      FROM pilot_ai_grants g JOIN ai_provider_campaigns c
        ON c.campaign_id=g.campaign_id AND c.user_id=g.principal_id
      WHERE g.campaign_id=${campaignId} AND g.principal_id=${principalId}`;
    if (!matchesPilotGrant(rows[0], principalId, planner))
      throw new PilotAiAdmissionError("PILOT_AI_UNAUTHORIZED");
  }

  async function admit(input: PilotAiAdmissionInput): Promise<{ callId: string; campaignId: string }> {
    checkPolicy(input.principalId);
    if (!/^[a-f0-9]{64}$/.test(input.requestHash))
      throw new PilotAiAdmissionError("PILOT_AI_UNAUTHORIZED");
    const campaignId = campaignFor(input.principalId);
    return db.client.begin(async (tx) => {
      // Campaign first serializes the count/budget across all runs of a principal.
      const campaign = (await tx<Campaign[]>`
        SELECT campaign_id,user_id,halted,held_micros,committed_micros,limit_micros
        FROM ai_provider_campaigns WHERE campaign_id=${campaignId} FOR UPDATE`)[0];
      if (!campaign || campaign.user_id !== input.principalId || campaign.halted)
        throw new PilotAiAdmissionError("PILOT_AI_UNAUTHORIZED");
      const grant = (await grantRows(tx, input.principalId, true))[0];
      if (!matchesPilotGrant(grant, input.principalId, { provider: input.provider,
        model: input.model, estimatedCostMicros: input.estimate,
        billingMode: input.billingMode, endpoint: input.endpoint,
        noPaidFallback: input.noPaidFallback }))
        throw new PilotAiAdmissionError("PILOT_AI_UNAUTHORIZED");
      const run = (await tx<Run[]>`
        SELECT id,workflow_version_id,status,profile FROM runs
        WHERE id=${input.runId} AND user_id=${input.principalId} FOR UPDATE`)[0];
      const snapshot = (await tx<Snapshot[]>`
        SELECT source_key,source_revision,checklist_result FROM source_snapshots
        WHERE run_id=${input.runId}
          AND raw_data=${tx.json(input.snapshot.rawData)}::jsonb
          AND checklist_result=${tx.json(input.snapshot.checklist)}::jsonb
        FOR UPDATE`)[0];
      if (!run || run.profile !== "pilot-v2" || run.status !== "planning" ||
          run.workflow_version_id !== input.versionId ||
          !validSnapshot(snapshot, input.sourceRevision, input.sourceKey))
        throw new PilotAiAdmissionError("PILOT_AI_CONFLICT");
      const countRows = await tx<{ count: number }[]>`
        SELECT count(*)::int AS count FROM ai_provider_calls WHERE campaign_id=${campaignId}`;
      if ((countRows[0]?.count ?? 0) >= grant!.max_calls)
        throw new PilotAiAdmissionError("PILOT_AI_CALL_LIMIT");
      const held = Number(campaign.held_micros);
      const committed = Number(campaign.committed_micros);
      const limit = Number(campaign.limit_micros);
      if (![held, committed, limit].every(Number.isSafeInteger) ||
          held + committed + input.estimate > limit)
        throw new PilotAiAdmissionError("PILOT_AI_BUDGET");
      await tx`
        INSERT INTO pilot_ai_attempts(run_id,principal_id,campaign_id,state)
        VALUES (${input.runId},${input.principalId},${campaignId},'reserved')`;
      const callId = await reservePostgresProviderCallInTransaction(tx,
        { campaignId, userId: input.principalId }, {
          campaignId, runId: input.runId, profileId: "pilot-v2",
          provider: input.provider, purpose: "planning", model: input.model,
          requestHash: input.requestHash, estimatedCostMicros: input.estimate,
          billingMode: input.billingMode, endpoint: input.endpoint,
          noPaidFallback: input.noPaidFallback,
        });
      await tx`
        UPDATE pilot_ai_attempts SET call_id=${callId},updated_at=clock_timestamp()
        WHERE run_id=${input.runId} AND principal_id=${input.principalId}`;
      return { callId, campaignId };
    });
  }

  async function claim(input: PilotAiClaimInput): Promise<boolean> {
    try { checkPolicy(input.principalId); } catch { return false; }
    const campaignId = campaignFor(input.principalId);
    return db.client.begin(async (tx) => {
      const campaign = (await tx<Campaign[]>`
        SELECT campaign_id,user_id,halted,held_micros,committed_micros,limit_micros
        FROM ai_provider_campaigns WHERE campaign_id=${campaignId} FOR UPDATE`)[0];
      if (!campaign || campaign.halted || campaign.user_id !== input.principalId) return false;
      const grant = (await grantRows(tx, input.principalId, true))[0];
      if (!grant?.valid) return false;
      const reservedCall = (await tx<Array<{
        provider: "google" | "openai"; model: string; status: string;
        billing_mode: "METERED" | "INCLUDED_SUBSCRIPTION";
        endpoint: string | null; no_paid_fallback: boolean; estimated_cost_micros: string | number;
      }>>`
        SELECT provider,model,status,billing_mode,endpoint,no_paid_fallback,estimated_cost_micros FROM ai_provider_calls
        WHERE call_id=${input.callId} AND campaign_id=${campaignId}
          AND user_id=${input.principalId} AND run_id=${input.runId}`)[0];
      if (!reservedCall || reservedCall.status !== "reserved" ||
          !matchesPilotGrant(grant, input.principalId, {
            provider: reservedCall.provider, model: reservedCall.model,
            estimatedCostMicros: Number(reservedCall.estimated_cost_micros),
            billingMode: reservedCall.billing_mode, endpoint: reservedCall.endpoint ?? undefined,
            noPaidFallback: reservedCall.no_paid_fallback,
          }))
        return false;
      const run = (await tx<Run[]>`
        SELECT id,workflow_version_id,status,profile FROM runs
        WHERE id=${input.runId} AND user_id=${input.principalId} FOR UPDATE`)[0];
      const snapshot = (await tx<Snapshot[]>`
        SELECT source_key,source_revision,checklist_result FROM source_snapshots
        WHERE run_id=${input.runId}
          AND raw_data=${tx.json(input.snapshot.rawData)}::jsonb
          AND checklist_result=${tx.json(input.snapshot.checklist)}::jsonb
        FOR UPDATE`)[0];
      if (!run || run.status !== "planning" || run.profile !== "pilot-v2" ||
          run.workflow_version_id !== input.versionId ||
          !validSnapshot(snapshot, input.sourceRevision, input.sourceKey)) return false;
      const changed = await tx`
        UPDATE pilot_ai_attempts
        SET state='dispatch_claimed',dispatch_claimed_at=clock_timestamp(),
            updated_at=clock_timestamp()
        WHERE run_id=${input.runId} AND principal_id=${input.principalId}
          AND campaign_id=${campaignId} AND call_id=${input.callId} AND state='reserved'
        RETURNING run_id`;
      return changed.length === 1;
    });
  }

  async function settle(input: {
    runId: string; principalId: string; callId: string; outcome: ProviderCallSettlement;
  }): Promise<{ overrun: boolean; conflict: boolean }> {
    const { runId, principalId, callId, outcome } = input;
    if (outcome.costMicros !== null &&
        (!Number.isSafeInteger(outcome.costMicros) || outcome.costMicros < 0))
      throw new PilotAiAdmissionError("PILOT_AI_CONFLICT");
    const campaignId = campaignFor(principalId);
    return db.client.begin(async (tx) => {
      const attempts = await tx<{ state: string; dispatch_claimed_at: Date | null }[]>`
        SELECT a.state,a.dispatch_claimed_at FROM pilot_ai_attempts a JOIN runs r ON r.id=a.run_id
        WHERE a.run_id=${runId} AND r.user_id=${principalId} AND r.profile='pilot-v2'
          AND a.principal_id=${principalId} AND a.campaign_id=${campaignId}
          AND a.call_id=${callId}`;
      const attempt = attempts[0];
      if (!attempt || (outcome.costMicros === null && !attempt.dispatch_claimed_at))
        throw new PilotAiAdmissionError("PILOT_AI_CONFLICT");
      const call = (await tx<Array<{ billing_mode: string }>>`
        SELECT billing_mode FROM ai_provider_calls WHERE call_id=${callId}
          AND campaign_id=${campaignId} AND user_id=${principalId} AND run_id=${runId}`)[0];
      if (!call || (call.billing_mode === "INCLUDED_SUBSCRIPTION" && outcome.costMicros !== null &&
          (outcome.costMicros !== 0 || !outcome.usage && outcome.status !== "cancelled")) ||
          !["METERED", "INCLUDED_SUBSCRIPTION"].includes(call.billing_mode))
        throw new PilotAiAdmissionError("PILOT_AI_CONFLICT");
      const result = await settlePostgresProviderCallInTransaction(tx,
        { campaignId, userId: principalId }, callId, outcome);
      if (!result.conflict) {
        await tx`
          UPDATE pilot_ai_attempts
          SET state=${outcome.costMicros === null ? "uncertain" : "settled"},
              updated_at=clock_timestamp()
          WHERE run_id=${runId} AND principal_id=${principalId} AND call_id=${callId}`;
      }
      return result;
    });
  }

  return { preflight, admit, claim, settle };
}
