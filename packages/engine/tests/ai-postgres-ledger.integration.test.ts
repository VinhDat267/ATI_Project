import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { DEMO_USER_ID, migrate, openDatabase, seedDemo } from "@wap/db";
import {
  createPostgresProviderCallLedger,
  ensurePostgresProviderCampaign,
} from "../src/ai/providers/postgres-ledger.js";
import type { ProviderCallReservation } from "../src/ai/providers/accounting.js";

const adminUrl = "postgresql://wap:wap@127.0.0.1:55532/wap_g1";
const dbName = `engine_ai_ledger_${randomUUID().replaceAll("-", "")}`;
const address = new URL(adminUrl);
address.pathname = `/${dbName}`;
const databaseUrl = address.href;
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
let db: ReturnType<typeof openDatabase>;
let runId: string;
const campaignId = "api-local-v1";

async function createRun(userId = DEMO_USER_ID, status = "planning") {
  const workflowId = randomUUID();
  const versionId = randomUUID();
  const id = randomUUID();
  await db.client`
    INSERT INTO workflows(id,user_id,name,source_prompt)
    VALUES (${workflowId},${userId},'ledger test','ledger test')`;
  await db.client`
    INSERT INTO workflow_versions(id,workflow_id,version_no,plan,origin)
    VALUES (${versionId},${workflowId},1,'{}','initial')`;
  await db.client`
    INSERT INTO runs(id,user_id,workflow_id,workflow_version_id,status,source_prompt,time_zone,claimed_by,claimed_at,heartbeat_at)
    VALUES (${id},${userId},${workflowId},${versionId},${status},'ledger test','Asia/Ho_Chi_Minh','ledger-worker',now(),now())`;
  return id;
}

function reservation(overrides: Partial<ProviderCallReservation> = {}) {
  return {
    campaignId,
    runId,
    profileId: "api-profile-v1",
    provider: "google" as const,
    purpose: "planning" as const,
    model: "gemini-3.5-flash",
    requestHash: randomUUID().replaceAll("-", ""),
    estimatedCostMicros: 60,
    ...overrides,
  } satisfies ProviderCallReservation;
}

describe("PostgreSQL provider call ledger", () => {
  beforeAll(async () => {
    await admin.unsafe(`CREATE DATABASE "${dbName}"`);
    await migrate(databaseUrl);
    db = openDatabase(databaseUrl);
    await seedDemo(db);
    runId = await createRun();
  });

  beforeEach(async () => {
    await db.client`TRUNCATE ai_provider_calls, ai_provider_campaigns CASCADE`;
    await ensurePostgresProviderCampaign(db, {
      campaignId,
      userId: DEMO_USER_ID,
      limitMicros: 100,
    });
  });

  afterAll(async () => {
    await db?.close();
    await admin.unsafe(`DROP DATABASE "${dbName}" WITH (FORCE)`);
    await admin.end();
  });

  it("persists a reservation and rejects the next reservation when the cap is exceeded", async () => {
    const ledger = createPostgresProviderCallLedger(db, {
      campaignId,
      userId: DEMO_USER_ID,
    });
    const callId = await ledger.reserve(reservation({ estimatedCostMicros: 60 }));
    expect(callId).toMatch(/^[0-9a-f-]{36}$/);
    await expect(
      ledger.reserve(reservation({ estimatedCostMicros: 41 })),
    ).rejects.toMatchObject({
      code: "BUDGET_EXCEEDED",
    });
    await expect(
      db.client`SELECT held_micros,committed_micros FROM ai_provider_campaigns WHERE campaign_id=${campaignId}`,
    ).resolves.toEqual([{ held_micros: "60", committed_micros: "0" }]);
  });

  it("keeps committed spend after a new ledger instance is created", async () => {
    const first = createPostgresProviderCallLedger(db, {
      campaignId,
      userId: DEMO_USER_ID,
    });
    const callId = await first.reserve(reservation({ estimatedCostMicros: 60 }));
    await first.settle(callId, {
      status: "succeeded",
      usage: { totalTokens: 12 },
      costMicros: 60,
    });
    const second = createPostgresProviderCallLedger(db, {
      campaignId,
      userId: DEMO_USER_ID,
    });
    await expect(
      second.reserve(reservation({ estimatedCostMicros: 41 })),
    ).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
  });

  it("allows identical settlement replay but rejects a conflicting settlement", async () => {
    const ledger = createPostgresProviderCallLedger(db, {
      campaignId,
      userId: DEMO_USER_ID,
    });
    const callId = await ledger.reserve(reservation({ estimatedCostMicros: 60 }));
    const outcome = {
      status: "succeeded" as const,
      usage: {
        inputTokens: 4,
        cachedInputTokens: 1,
        outputTokens: 7,
        totalTokens: 12,
      },
      costMicros: 60,
    };
    await ledger.settle(callId, outcome);
    await expect(ledger.settle(callId, outcome)).resolves.toBeUndefined();
    await expect(
      ledger.settle(callId, { ...outcome, costMicros: 61 }),
    ).rejects.toMatchObject({ code: "CALL_ALREADY_SETTLED" });
    await expect(
      ledger.reserve(reservation({ estimatedCostMicros: 1 })),
    ).rejects.toMatchObject({ code: "CAMPAIGN_HALTED" });
  });

  it("serializes concurrent reservations against one campaign cap", async () => {
    const ledger = createPostgresProviderCallLedger(db, {
      campaignId,
      userId: DEMO_USER_ID,
    });
    const results = await Promise.allSettled([
      ledger.reserve(reservation({ estimatedCostMicros: 60 })),
      ledger.reserve(reservation({ estimatedCostMicros: 60 })),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    await expect(
      db.client`SELECT held_micros,committed_micros FROM ai_provider_campaigns WHERE campaign_id=${campaignId}`,
    ).resolves.toEqual([{ held_micros: "60", committed_micros: "0" }]);
  });
});
