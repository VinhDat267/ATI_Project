import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ensurePostgresProviderCampaign, evaluateChecklist,
  type PilotConfig, type PilotPolicy, type SourceRow,
} from "@wap/engine";
import { createPilotAiAdmission } from "../src/pilot-ai-admission.js";
import { createApi } from "../src/app.js";
import { makeApiFixture } from "./fixture.js";

describe("pilot AI admission schema on isolated PostgreSQL", () => {
  it("rejects wrong campaign owner, duplicate principal and invalid grant limits", async () => {
    const fixture = await makeApiFixture();
    try {
      const otherId = randomUUID();
      await fixture.db.client`
        INSERT INTO users(id,email,password_hash)
        VALUES (${otherId},${`other-${otherId}@local.invalid`},'test-hash')`;
      const campaignId = `pilot-v2:${fixture.userId}`;
      const otherCampaign = `pilot-v2:${otherId}`;
      await ensurePostgresProviderCampaign(fixture.db, {
        campaignId, userId: fixture.userId, limitMicros: 100,
      });
      await ensurePostgresProviderCampaign(fixture.db, {
        campaignId: otherCampaign, userId: otherId, limitMicros: 100,
      });
      const insert = (campaign: string, principal: string, maxCalls = 2) => fixture.db.client`
        INSERT INTO pilot_ai_grants(
          campaign_id,principal_id,provider,model,max_calls,
          max_estimated_cost_micros,expires_at
        ) VALUES (${campaign},${principal},'google','fake-model',${maxCalls},60,
                  clock_timestamp() + interval '1 hour')`;
      await expect(insert(campaignId, otherId)).rejects.toThrow();
      await expect(insert(`api-local-v1:${fixture.userId}`, fixture.userId)).rejects.toThrow();
      await expect(insert(campaignId, fixture.userId, 0)).rejects.toThrow();
      await insert(campaignId, fixture.userId);
      await expect(insert(campaignId, fixture.userId)).rejects.toThrow();
      const grants = await fixture.db.client`
        SELECT campaign_id,principal_id,max_calls FROM pilot_ai_grants`;
      expect(grants).toEqual([{
        campaign_id: campaignId, principal_id: fixture.userId, max_calls: 2,
      }]);
    } finally {
      await fixture.close();
    }
  }, 45_000);

  it("allows one durable attempt and one owner-scoped outcome per run", async () => {
    const fixture = await makeApiFixture();
    try {
      const campaignId = `pilot-v2:${fixture.userId}`;
      await ensurePostgresProviderCampaign(fixture.db, {
        campaignId, userId: fixture.userId, limitMicros: 100,
      });
      await fixture.db.client`
        INSERT INTO pilot_ai_grants(
          campaign_id,principal_id,provider,model,max_calls,
          max_estimated_cost_micros,expires_at
        ) VALUES (${campaignId},${fixture.userId},'google','fake-model',2,60,
                  clock_timestamp() + interval '1 hour')`;
      const workflowId = randomUUID();
      const versionId = randomUUID();
      const runId = randomUUID();
      await fixture.db.client`
        INSERT INTO workflows(id,user_id,name,source_prompt)
        VALUES (${workflowId},${fixture.userId},'schema test','schema test')`;
      await fixture.db.client`
        INSERT INTO workflow_versions(id,workflow_id,version_no,plan,origin)
        VALUES (${versionId},${workflowId},1,'{}','initial')`;
      await fixture.db.client`
        INSERT INTO runs(id,user_id,workflow_id,workflow_version_id,status,source_prompt,time_zone,profile)
        VALUES (${runId},${fixture.userId},${workflowId},${versionId},'planning',
                'schema test','Asia/Ho_Chi_Minh','pilot-v2')`;
      const insertAttempt = () => fixture.db.client`
        INSERT INTO pilot_ai_attempts(run_id,principal_id,campaign_id,state)
        VALUES (${runId},${fixture.userId},${campaignId},'reserved')`;
      await insertAttempt();
      await expect(insertAttempt()).rejects.toThrow();
      expect(await fixture.db.client`
        SELECT run_id,state FROM pilot_ai_attempts WHERE run_id=${runId}`)
        .toEqual([{ run_id: runId, state: "reserved" }]);
      expect(await fixture.db.client`
        SELECT run_id FROM pilot_planner_outcomes WHERE run_id=${runId}`)
        .toEqual([]);
    } finally {
      await fixture.close();
    }
  }, 45_000);
});

const row: SourceRow = {
  request_id: "REQ-AI-1", client_ref: "Client A", request_type: "web_change",
  raw_request: "Update /landing", deliverable: "Landing update", due_date: "2026-10-15",
  decision_status: "confirmed", source_note: "confirmed",
};

function pilotScope(principalId: string) {
  const policy: PilotPolicy = {
    enabled: true, principals: [principalId], spreadsheetId: "sheet-pilot",
    tabId: "requests", boardId: "board-pilot",
  };
  const config: PilotConfig = { ...policy, trello: { listId: "list-todo" } };
  return { policy, config };
}

async function preparedRun(
  fixture: Awaited<ReturnType<typeof makeApiFixture>>,
  options: { maxCalls?: number; campaignLimit?: number; createGrant?: boolean } = {},
) {
  const { policy, config } = pilotScope(fixture.userId);
  const campaignId = `pilot-v2:${fixture.userId}`;
  await ensurePostgresProviderCampaign(fixture.db, {
    campaignId, userId: fixture.userId, limitMicros: options.campaignLimit ?? 100,
  });
  if (options.createGrant !== false) await fixture.db.client`
    INSERT INTO pilot_ai_grants(campaign_id,principal_id,provider,model,max_calls,
                                max_estimated_cost_micros,expires_at)
    VALUES (${campaignId},${fixture.userId},'google','fake-model',${options.maxCalls ?? 2},60,
            clock_timestamp() + interval '1 hour')
    ON CONFLICT (principal_id) DO NOTHING`;
  const workflowId = randomUUID();
  const versionId = randomUUID();
  const runId = randomUUID();
  const checklist = evaluateChecklist(row);
  const sourceKey = `source-${runId}`;
  await fixture.db.client`
    INSERT INTO workflows(id,user_id,name,source_prompt)
    VALUES (${workflowId},${fixture.userId},'AI gate','AI gate')`;
  await fixture.db.client`
    INSERT INTO workflow_versions(id,workflow_id,version_no,plan,origin)
    VALUES (${versionId},${workflowId},1,'{}','initial')`;
  await fixture.db.client`
    INSERT INTO runs(id,user_id,workflow_id,workflow_version_id,status,source_prompt,time_zone,profile)
    VALUES (${runId},${fixture.userId},${workflowId},${versionId},'planning',
            'AI gate','Asia/Ho_Chi_Minh','pilot-v2')`;
  await fixture.db.client`
    INSERT INTO source_snapshots(run_id,source_key,source_revision,raw_data,
                                 checklist_version,checklist_result)
    VALUES (${runId},${sourceKey},${checklist.sourceRevision},${fixture.db.client.json(row)},
            ${checklist.checklistVersion},${fixture.db.client.json(checklist)})`;
  const coordinator = createPilotAiAdmission({ db: fixture.db, policy, config });
  const planner = { provider: "google" as const, model: "fake-model",
    estimatedCostMicros: 60, propose: async () => ({
      proposal: { kind: "plan", tool: "trello.create_card" },
      usage: { inputTokens: 1, outputTokens: 1 }, costMicros: 2,
    }) };
  const admitInput = {
    runId, principalId: fixture.userId, versionId, sourceKey,
    sourceRevision: checklist.sourceRevision,
    provider: "google" as const, model: "fake-model", estimate: 60,
    requestHash: "a".repeat(64),
    snapshot: { rawData: row, checklist },
  };
  return { coordinator, planner, admitInput, campaignId, runId, versionId, policy, config };
}

describe("pilot AI atomic admission and dispatch", () => {
  it("rejects a missing grant before reserving budget", async () => {
    const fixture = await makeApiFixture();
    try {
      const setup = await preparedRun(fixture, { createGrant: false });
      await expect(setup.coordinator.preflight(fixture.userId, setup.planner)).rejects.toThrow();
      await expect(setup.coordinator.admit(setup.admitInput)).rejects.toThrow();
      expect(await fixture.db.client`SELECT call_id FROM ai_provider_calls`).toHaveLength(0);
      expect(await fixture.db.client`SELECT run_id FROM pilot_ai_attempts`).toHaveLength(0);
      expect(await fixture.db.client`
        SELECT held_micros FROM ai_provider_campaigns WHERE campaign_id=${setup.campaignId}`)
        .toEqual([{ held_micros: "0" }]);
    } finally { await fixture.close(); }
  }, 45_000);

  it("rejects revoked, foreign owner/model and over-cap admission", async () => {
    const fixture = await makeApiFixture();
    try {
      const setup = await preparedRun(fixture);
      await expect(setup.coordinator.admit({ ...setup.admitInput,
        principalId: randomUUID() })).rejects.toThrow();
      await expect(setup.coordinator.admit({ ...setup.admitInput,
        model: "unapproved-model" })).rejects.toThrow();
      await expect(setup.coordinator.admit({ ...setup.admitInput,
        provider: "openai" })).rejects.toThrow();
      await expect(setup.coordinator.admit({ ...setup.admitInput,
        estimate: 61 })).rejects.toThrow();
      await fixture.db.client`UPDATE pilot_ai_grants SET revoked_at=clock_timestamp()
        WHERE campaign_id=${setup.campaignId}`;
      await expect(setup.coordinator.admit(setup.admitInput)).rejects.toThrow();
      expect(await fixture.db.client`SELECT call_id FROM ai_provider_calls`).toHaveLength(0);
    } finally { await fixture.close(); }
  }, 45_000);

  it("admits one call under a single-call cap and claims dispatch only once", async () => {
    const fixture = await makeApiFixture();
    try {
      const one = await preparedRun(fixture, { maxCalls: 1 });
      const two = await preparedRun(fixture, { maxCalls: 1 });
      const admissions = await Promise.allSettled([
        one.coordinator.admit(one.admitInput), two.coordinator.admit(two.admitInput),
      ]);
      expect(admissions.filter((value) => value.status === "fulfilled")).toHaveLength(1);
      const winner = admissions[0]?.status === "fulfilled" ? one : two;
      const callId = (admissions.find((value) => value.status === "fulfilled") as
        PromiseFulfilledResult<{ callId: string }>).value.callId;
      expect(await winner.coordinator.claim({
        runId: winner.runId, principalId: fixture.userId, callId,
        versionId: winner.versionId, sourceKey: winner.admitInput.sourceKey,
        sourceRevision: winner.admitInput.sourceRevision,
        snapshot: winner.admitInput.snapshot,
      })).toBe(true);
      expect(await winner.coordinator.claim({
        runId: winner.runId, principalId: fixture.userId, callId,
        versionId: winner.versionId, sourceKey: winner.admitInput.sourceKey,
        sourceRevision: winner.admitInput.sourceRevision,
        snapshot: winner.admitInput.snapshot,
      })).toBe(false);
      expect(await fixture.db.client`
        SELECT held_micros FROM ai_provider_campaigns WHERE campaign_id=${one.campaignId}`)
        .toEqual([{ held_micros: "60" }]);
    } finally { await fixture.close(); }
  }, 45_000);

  it("rejects mutated source bytes even when its revision field is unchanged", async () => {
    const fixture = await makeApiFixture();
    try {
      const beforeAdmit = await preparedRun(fixture);
      await fixture.db.client`
        UPDATE source_snapshots SET raw_data=jsonb_set(raw_data,'{deliverable}',
          '"unreviewed"'::jsonb) WHERE run_id=${beforeAdmit.runId}`;
      await expect(beforeAdmit.coordinator.admit(beforeAdmit.admitInput)).rejects.toThrow();
      expect(await fixture.db.client`SELECT call_id FROM ai_provider_calls`).toHaveLength(0);
    } finally { await fixture.close(); }
  }, 45_000);

  it("rejects dispatch if the source identity changes after reservation", async () => {
    const fixture = await makeApiFixture();
    try {
      const setup = await preparedRun(fixture);
      const admitted = await setup.coordinator.admit(setup.admitInput);
      await fixture.db.client`
        UPDATE source_snapshots SET raw_data=jsonb_set(raw_data,'{deliverable}',
          '"swapped"'::jsonb) WHERE run_id=${setup.runId}`;
      expect(await setup.coordinator.claim({
        snapshot: setup.admitInput.snapshot,
        runId: setup.runId, principalId: fixture.userId, callId: admitted.callId,
        versionId: setup.versionId, sourceKey: setup.admitInput.sourceKey,
        sourceRevision: setup.admitInput.sourceRevision,
      })).toBe(false);
      expect(await fixture.db.client`
        SELECT state FROM pilot_ai_attempts WHERE run_id=${setup.runId}`)
        .toEqual([{ state: "reserved" }]);
    } finally { await fixture.close(); }
  }, 45_000);

  it.each(["model", "provider"] as const)(
    "blocks a reserved call when grant %s changes before claim", async (field) => {
      const fixture = await makeApiFixture();
      try {
        const setup = await preparedRun(fixture);
        const admitted = await setup.coordinator.admit(setup.admitInput);
        if (field === "model") await fixture.db.client`
          UPDATE pilot_ai_grants SET model='other-model'
          WHERE campaign_id=${setup.campaignId}`;
        else await fixture.db.client`
          UPDATE pilot_ai_grants SET provider='openai'
          WHERE campaign_id=${setup.campaignId}`;
        expect(await setup.coordinator.claim({
          runId: setup.runId, principalId: fixture.userId, callId: admitted.callId,
          versionId: setup.versionId, sourceKey: setup.admitInput.sourceKey,
          sourceRevision: setup.admitInput.sourceRevision,
          snapshot: setup.admitInput.snapshot,
        })).toBe(false);
        expect(await fixture.db.client`
          SELECT state FROM pilot_ai_attempts WHERE run_id=${setup.runId}`)
          .toEqual([{ state: "reserved" }]);
        expect(await setup.coordinator.settle({
          runId: setup.runId, principalId: fixture.userId, callId: admitted.callId,
          outcome: { status: "cancelled", usage: null, costMicros: 0 },
        })).toEqual({ overrun: false, conflict: false });
        expect(await fixture.db.client`
          SELECT held_micros FROM ai_provider_campaigns WHERE campaign_id=${setup.campaignId}`)
          .toEqual([{ held_micros: "0" }]);
      } finally { await fixture.close(); }
    }, 45_000);

  it("blocks claim after grant revocation but allows known-cost settlement", async () => {
    const fixture = await makeApiFixture();
    try {
      const setup = await preparedRun(fixture);
      const admitted = await setup.coordinator.admit(setup.admitInput);
      await fixture.db.client`UPDATE pilot_ai_grants SET revoked_at=clock_timestamp()
        WHERE campaign_id=${setup.campaignId}`;
      expect(await setup.coordinator.claim({
        runId: setup.runId, principalId: fixture.userId, callId: admitted.callId,
        versionId: setup.versionId, sourceKey: setup.admitInput.sourceKey,
        sourceRevision: setup.admitInput.sourceRevision,
        snapshot: setup.admitInput.snapshot,
      })).toBe(false);
      expect(await setup.coordinator.settle({
        runId: setup.runId, principalId: fixture.userId, callId: admitted.callId,
        outcome: { status: "cancelled", usage: null, costMicros: 0 },
      })).toEqual({ overrun: false, conflict: false });
      expect(await fixture.db.client`
        SELECT held_micros,committed_micros FROM ai_provider_campaigns
        WHERE campaign_id=${setup.campaignId}`)
        .toEqual([{ held_micros: "0", committed_micros: "0" }]);
    } finally { await fixture.close(); }
  }, 45_000);

  it("denies expired grants and changed checklist before reserving", async () => {
    const fixture = await makeApiFixture();
    try {
      const setup = await preparedRun(fixture);
      await fixture.db.client`
        UPDATE pilot_ai_grants SET expires_at=clock_timestamp() - interval '1 second'
        WHERE campaign_id=${setup.campaignId}`;
      await expect(setup.coordinator.admit(setup.admitInput)).rejects.toThrow();
      await fixture.db.client`
        UPDATE pilot_ai_grants SET expires_at=clock_timestamp() + interval '1 hour'
        WHERE campaign_id=${setup.campaignId}`;
      await fixture.db.client`
        UPDATE source_snapshots SET checklist_result=jsonb_set(checklist_result,
          '{unconfirmedBusiness}', 'true'::jsonb)
        WHERE run_id=${setup.runId}`;
      await expect(setup.coordinator.admit(setup.admitInput)).rejects.toThrow();
      expect(await fixture.db.client`SELECT call_id FROM ai_provider_calls`).toHaveLength(0);
    } finally { await fixture.close(); }
  }, 45_000);

  it("rejects budget above the campaign cap without creating an attempt", async () => {
    const fixture = await makeApiFixture();
    try {
      const setup = await preparedRun(fixture, { campaignLimit: 50 });
      await expect(setup.coordinator.admit(setup.admitInput)).rejects.toThrow();
      expect(await fixture.db.client`SELECT run_id FROM pilot_ai_attempts`).toHaveLength(0);
      expect(await fixture.db.client`SELECT call_id FROM ai_provider_calls`).toHaveLength(0);
    } finally { await fixture.close(); }
  }, 45_000);

  it("halts the pilot campaign after a known-cost overrun", async () => {
    const fixture = await makeApiFixture();
    try {
      const setup = await preparedRun(fixture);
      const { callId } = await setup.coordinator.admit(setup.admitInput);
      expect(await setup.coordinator.claim({
        runId: setup.runId, principalId: fixture.userId, callId,
        versionId: setup.versionId, sourceKey: setup.admitInput.sourceKey,
        sourceRevision: setup.admitInput.sourceRevision,
        snapshot: setup.admitInput.snapshot,
      })).toBe(true);
      expect(await setup.coordinator.settle({
        runId: setup.runId, principalId: fixture.userId, callId,
        outcome: { status: "succeeded", usage: null, costMicros: 101 },
      })).toEqual({ overrun: true, conflict: false });
      expect(await fixture.db.client`
        SELECT halted,held_micros,committed_micros FROM ai_provider_campaigns
        WHERE campaign_id=${setup.campaignId}`)
        .toEqual([{ halted: true, held_micros: "0", committed_micros: "101" }]);
      expect(await setup.coordinator.claim({
        runId: setup.runId, principalId: fixture.userId, callId,
        versionId: setup.versionId, sourceKey: setup.admitInput.sourceKey,
        sourceRevision: setup.admitInput.sourceRevision,
        snapshot: setup.admitInput.snapshot,
      })).toBe(false);
    } finally { await fixture.close(); }
  }, 45_000);

  it("rolls back the attempt and budget hold if provider reservation insert fails", async () => {
    const fixture = await makeApiFixture();
    try {
      const setup = await preparedRun(fixture);
      await fixture.db.client`
        CREATE FUNCTION abort_pilot_provider_insert() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'fixture reservation fault'; END $$`;
      await fixture.db.client`
        CREATE TRIGGER abort_pilot_provider_insert BEFORE INSERT ON ai_provider_calls
        FOR EACH ROW EXECUTE FUNCTION abort_pilot_provider_insert()`;
      await expect(setup.coordinator.admit(setup.admitInput)).rejects.toThrow();
      expect(await fixture.db.client`SELECT run_id FROM pilot_ai_attempts`).toHaveLength(0);
      expect(await fixture.db.client`SELECT call_id FROM ai_provider_calls`).toHaveLength(0);
      expect(await fixture.db.client`
        SELECT held_micros,committed_micros FROM ai_provider_campaigns
        WHERE campaign_id=${setup.campaignId}`)
        .toEqual([{ held_micros: "0", committed_micros: "0" }]);
    } finally { await fixture.close(); }
  }, 45_000);

  it("quarantines a post-claim crash without retrying or releasing its hold", async () => {
    const fixture = await makeApiFixture();
    let api: ReturnType<typeof createApi> | undefined;
    try {
      const setup = await preparedRun(fixture);
      const { callId } = await setup.coordinator.admit(setup.admitInput);
      expect(await setup.coordinator.claim({
        runId: setup.runId, principalId: fixture.userId, callId,
        versionId: setup.versionId, sourceKey: setup.admitInput.sourceKey,
        sourceRevision: setup.admitInput.sourceRevision,
        snapshot: setup.admitInput.snapshot,
      })).toBe(true);
      await fixture.db.client`UPDATE runs SET created_at=clock_timestamp() - interval '6 minutes'
        WHERE id=${setup.runId}`;
      api = createApi({ db: fixture.db, config: fixture.config,
        pilotConfig: setup.config, pilotPolicy: setup.policy });
      const base = await api.listen();
      const login = await fetch(`${base}/auth/login`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: fixture.email, password: fixture.password }),
      });
      const { token } = await login.json() as { token: string };
      const response = await fetch(`${base.replace(/\/api\/v1$/, "")}/pilot/v2/runs/${setup.runId}`,
        { headers: { authorization: `Bearer ${token}` } });
      expect(response.status).toBe(200);
      const detail = await response.json() as Record<string, unknown>;
      expect(detail.status).toBe("failed");
      expect(detail.preview).toBeNull();
      expect(detail.error).toBeTruthy();
      expect(await fixture.db.client`
        SELECT state FROM pilot_ai_attempts WHERE run_id=${setup.runId}`)
        .toEqual([{ state: "dispatch_claimed" }]);
      expect(await fixture.db.client`
        SELECT status FROM ai_provider_calls WHERE call_id=${callId}`)
        .toEqual([{ status: "reserved" }]);
      expect(await fixture.db.client`
        SELECT held_micros FROM ai_provider_campaigns WHERE campaign_id=${setup.campaignId}`)
        .toEqual([{ held_micros: "60" }]);
      expect(await fixture.db.client`SELECT id FROM pilot_approvals`).toHaveLength(0);
    } finally { await api?.close(); await fixture.close(); }
  }, 45_000);

  it("halts on conflicting repeated settlement while retaining the first cost", async () => {
    const fixture = await makeApiFixture();
    try {
      const setup = await preparedRun(fixture);
      const { callId } = await setup.coordinator.admit(setup.admitInput);
      expect(await setup.coordinator.claim({
        runId: setup.runId, principalId: fixture.userId, callId,
        versionId: setup.versionId, sourceKey: setup.admitInput.sourceKey,
        sourceRevision: setup.admitInput.sourceRevision,
        snapshot: setup.admitInput.snapshot,
      })).toBe(true);
      const first = { runId: setup.runId, principalId: fixture.userId, callId,
        outcome: { status: "succeeded" as const, usage: null, costMicros: 2 } };
      expect(await setup.coordinator.settle(first)).toEqual({ overrun: false, conflict: false });
      expect(await setup.coordinator.settle(first)).toEqual({ overrun: false, conflict: false });
      expect(await setup.coordinator.settle({ ...first,
        outcome: { status: "failed", usage: null, costMicros: 3 },
      })).toEqual({ overrun: false, conflict: true });
      expect(await fixture.db.client`
        SELECT halted,held_micros,committed_micros FROM ai_provider_campaigns
        WHERE campaign_id=${setup.campaignId}`)
        .toEqual([{ halted: true, held_micros: "0", committed_micros: "2" }]);
      expect(await fixture.db.client`SELECT id FROM pilot_approvals`).toHaveLength(0);
    } finally { await fixture.close(); }
  }, 45_000);

  it("holds unknown cost after dispatch and never releases it on repeated settlement", async () => {
    const fixture = await makeApiFixture();
    try {
      const setup = await preparedRun(fixture);
      const { callId } = await setup.coordinator.admit(setup.admitInput);
      expect(await setup.coordinator.claim({
        runId: setup.runId, principalId: fixture.userId, callId,
        versionId: setup.versionId, sourceKey: setup.admitInput.sourceKey,
        sourceRevision: setup.admitInput.sourceRevision,
        snapshot: setup.admitInput.snapshot,
      })).toBe(true);
      const ambiguous = {
        status: "ambiguous" as const, usage: null, costMicros: null,
      };
      await setup.coordinator.settle({
        runId: setup.runId, principalId: fixture.userId, callId, outcome: ambiguous,
      });
      await setup.coordinator.settle({
        runId: setup.runId, principalId: fixture.userId, callId, outcome: ambiguous,
      });
      expect(await fixture.db.client`
        SELECT held_micros,committed_micros FROM ai_provider_campaigns
        WHERE campaign_id=${setup.campaignId}`)
        .toEqual([{ held_micros: "60", committed_micros: "0" }]);
      expect(await fixture.db.client`
        SELECT state FROM pilot_ai_attempts WHERE run_id=${setup.runId}`)
        .toEqual([{ state: "uncertain" }]);
    } finally { await fixture.close(); }
  }, 45_000);
});
