import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { makeApiFixture, type ApiFixture } from "./fixture.js";
import {
  createApiAuthorizeCall,
  createAiRuntimePorts,
} from "../src/ai-runtime.js";
import { readAiProviderConfig } from "@wap/engine";
import {
  ensurePostgresProviderCampaign,
} from "@wap/engine";

const config = readAiProviderConfig({
  AI_PLANNING_PROVIDER: "openai",
  AI_PLANNING_MODEL: "gpt-5.6-terra",
  AI_EMBEDDING_PROVIDER: "google",
  AI_EMBEDDING_MODEL: "gemini-embedding-2",
});
const campaignId = "api-local-v1";
let fixture: ApiFixture | undefined;

async function createClaimedRun(current: ApiFixture) {
  const workflowId = randomUUID();
  const versionId = randomUUID();
  const runId = randomUUID();
  await current.db.client`
    INSERT INTO workflows(id,user_id,name,source_prompt)
    VALUES (${workflowId},${current.userId},'AI accounting','AI accounting')`;
  await current.db.client`
    INSERT INTO workflow_versions(id,workflow_id,version_no,plan,origin)
    VALUES (${versionId},${workflowId},1,'{}','initial')`;
  await current.db.client`
    INSERT INTO runs(id,user_id,workflow_id,workflow_version_id,status,source_prompt,time_zone,claimed_by,claimed_at,heartbeat_at)
    VALUES (${runId},${current.userId},${workflowId},${versionId},'planning','AI accounting','Asia/Ho_Chi_Minh','api-test-worker',now(),now())`;
  return runId;
}

function reservation(runId: string) {
  return {
    campaignId,
    runId,
    profileId: "api-profile-v1",
    provider: "openai" as const,
    purpose: "planning" as const,
    model: "gpt-5.6-terra",
    requestHash: "a".repeat(64),
    estimatedCostMicros: 1,
  };
}

describe("API durable AI authorization", () => {
  afterEach(async () => {
    await fixture?.close();
    fixture = undefined;
  });

  it("allows a claimed planning run and denies it before fake fetch after the claim is cleared", async () => {
    fixture = await makeApiFixture();
    const runId = await createClaimedRun(fixture);
    await ensurePostgresProviderCampaign(fixture.db, {
      campaignId,
      userId: fixture.userId,
      limitMicros: 1_000_000,
    });
    const authorizeCall = createApiAuthorizeCall({
      db: fixture.db,
      userId: fixture.userId,
      campaignId,
      leaseTtlMs: 60_000,
    });
    await expect(authorizeCall(reservation(runId))).resolves.toBeUndefined();

    let fetchCalls = 0;
    const ports = createAiRuntimePorts({
      config,
      credentials: { OPENAI_API_KEY: "openai-canary" },
      ledger: { async reserve() { return "call-1"; }, async settle() {} },
      authorizeCall,
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response(
          JSON.stringify({
            id: "resp_1",
            model: "gpt-5.6-terra",
            output_text: JSON.stringify({
              result: {
                kind: "refusal",
                plan: null,
                refusal: { reason: "test" },
                clarification: null,
              },
            }),
          }),
          { headers: { "content-type": "application/json" } },
        );
      },
      callContext: {
        campaignId,
        runId,
        profileId: "api-profile-v1",
      },
    });
    await ports.model.complete({ systemPrompt: "s", userPrompt: "u", schema: {} });
    expect(fetchCalls).toBe(1);

    await fixture.db.client`
      UPDATE runs SET claimed_by=NULL,claimed_at=NULL,heartbeat_at=NULL WHERE id=${runId}`;
    await expect(authorizeCall(reservation(runId))).rejects.toMatchObject({
      code: "AI_CALL_UNAUTHORIZED",
    });
    await expect(
      ports.model.complete({ systemPrompt: "s", userPrompt: "u", schema: {} }),
    ).rejects.toMatchObject({ code: "AI_CALL_UNAUTHORIZED" });
    expect(fetchCalls).toBe(1);
  });

  it("denies a stale claim before credential lookup", async () => {
    fixture = await makeApiFixture();
    const runId = await createClaimedRun(fixture);
    await ensurePostgresProviderCampaign(fixture.db, {
      campaignId,
      userId: fixture.userId,
      limitMicros: 1_000_000,
    });
    await fixture.db.client`
      UPDATE runs SET heartbeat_at=clock_timestamp()-interval '2 minutes' WHERE id=${runId}`;
    const authorizeCall = createApiAuthorizeCall({
      db: fixture.db,
      userId: fixture.userId,
      campaignId,
      leaseTtlMs: 60_000,
    });
    await expect(authorizeCall(reservation(runId))).rejects.toMatchObject({
      code: "AI_CALL_UNAUTHORIZED",
    });
  });

  it("rejects an exhausted campaign before credential lookup or reservation", async () => {
    fixture = await makeApiFixture();
    const runId = await createClaimedRun(fixture);
    await ensurePostgresProviderCampaign(fixture.db, {
      campaignId,
      userId: fixture.userId,
      limitMicros: 1,
    });
    await fixture.db.client`
      UPDATE ai_provider_campaigns
      SET committed_micros=1 WHERE campaign_id=${campaignId}`;
    const authorizeCall = createApiAuthorizeCall({
      db: fixture.db,
      userId: fixture.userId,
      campaignId,
      leaseTtlMs: 60_000,
    });
    let credentialLookups = 0;
    const credentials = {} as { OPENAI_API_KEY?: string };
    Object.defineProperty(credentials, "OPENAI_API_KEY", {
      enumerable: true,
      get() {
        credentialLookups += 1;
        return undefined;
      },
    });
    let reservations = 0;
    const ports = createAiRuntimePorts({
      config,
      credentials,
      ledger: {
        async reserve() {
          reservations += 1;
          return "unused";
        },
        async settle() {},
      },
      authorizeCall,
      callContext: { campaignId, runId, profileId: "api-profile-v1" },
      fetchImpl: async () => new Response("{}"),
    });
    await expect(
      ports.model.complete({ systemPrompt: "s", userPrompt: "u", schema: {} }),
    ).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
    expect(credentialLookups).toBe(0);
    expect(reservations).toBe(0);
  });
});
