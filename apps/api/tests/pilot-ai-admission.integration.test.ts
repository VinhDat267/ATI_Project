import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ensurePostgresProviderCampaign } from "@wap/engine";
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
