import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createApi } from "../src/app.js";
import { SessionStore } from "../src/auth.js";
import type { PilotAccountedPlanner } from "../src/pilot-planner.js";
import { makeApiFixture } from "./fixture.js";
import {
  evaluateChecklist, sourceKey, createIntentKey, ensurePostgresProviderCampaign,
  type PilotConfig, type PilotPolicy, type SourceRow,
} from "@wap/engine";

const row: SourceRow = {
  request_id: "REQ-PILOT-1",
  client_ref: "Client A",
  request_type: "web_change",
  raw_request: "Update /landing page",
  deliverable: "Landing page update",
  due_date: "2026-10-15",
  decision_status: "confirmed",
  source_note: "Approved scope",
};

afterEach(() => vi.restoreAllMocks());

function fakePlanner(propose: PilotAccountedPlanner["propose"]): PilotAccountedPlanner {
  return { provider: "google", model: "fake-model", estimatedCostMicros: 60, propose };
}

async function harness(
  writeEnabled = true,
  additionalPrincipals: string[] = [],
  planner?: PilotAccountedPlanner,
  plannerTimeoutMs?: number,
  provisionGrant = true,
) {
  const fixture = await makeApiFixture();
  const policy: PilotPolicy = {
    enabled: true, principals: [fixture.userId, ...additionalPrincipals],
    spreadsheetId: "sheet-pilot", tabId: "requests", boardId: "board-pilot",
  };
  if (planner && provisionGrant) {
    for (const principalId of additionalPrincipals) {
      await fixture.db.client`
        INSERT INTO users(id,email,password_hash) VALUES
        (${principalId},${`pilot-${principalId}@example.test`},${fixture.config.passwordHash})`;
    }
    for (const principalId of policy.principals) {
      const campaignId = `pilot-v2:${principalId}`;
      await ensurePostgresProviderCampaign(fixture.db, {
        campaignId, userId: principalId, limitMicros: 1000,
      });
      await fixture.db.client`
        INSERT INTO pilot_ai_grants(campaign_id,principal_id,provider,model,max_calls,
                                    max_estimated_cost_micros,expires_at)
        VALUES (${campaignId},${principalId},${planner.provider},${planner.model},5,
                ${planner.estimatedCostMicros},clock_timestamp() + interval '1 hour')`;
    }
  }

  const pilotConfig: PilotConfig = {
    ...policy,
    google: { apiKey: "fixture-google" },
    trello: { apiKey: "fixture-trello", apiToken: "fixture-token", listId: "list-todo" },
  };
  const checklist = evaluateChecklist(row);
  const key = sourceKey({
    groupId: policy.boardId, spreadsheetId: policy.spreadsheetId,
    tabId: policy.tabId, requestId: row.request_id,
  });
  const intentKey = createIntentKey({
    groupId: policy.boardId, spreadsheetId: policy.spreadsheetId,
    tabId: policy.tabId, requestId: row.request_id,
  }, policy.boardId);

  const customPrincipalTokens = new Map<string, string>();
  const sessions = new SessionStore({
    userId: fixture.userId,
    email: fixture.email,
    passwordHash: fixture.config.passwordHash,
    ttlMs: 60_000,
    principalExists: async () => true,
  });
  const originalAuth = sessions.authenticate.bind(sessions);
  sessions.authenticate = (input: any) => {
    const cred = typeof input === "object" && input !== null ? (input.authorization ?? "") : "";
    const bearer = typeof cred === "string" && cred.startsWith("Bearer ") ? cred.slice("Bearer ".length) : null;
    if (bearer && customPrincipalTokens.has(bearer)) {
      return customPrincipalTokens.get(bearer)!;
    }
    return originalAuth(input);
  };

  const requestLogs: string[] = [];
  const api = createApi({
    db: fixture.db, config: fixture.config,
    requestLogger: (entry) => { requestLogs.push(JSON.stringify(entry)); },
    sessionStore: sessions,
    pilotConfig, pilotPolicy: policy,
    pilotLiveWriteEnabled: writeEnabled,
    ...(planner ? { pilotPlanner: planner } : {}),
    ...(plannerTimeoutMs ? { pilotPlannerTimeoutMs: plannerTimeoutMs } : {}),
    readSheetsRequestFn: async () => ({
      row, checklist, sourceKey: key, sourceRevision: checklist.sourceRevision,
    }),
  });

  const baseUrl = await api.listen();
  const pilotUrl = baseUrl.replace(/\/api\/v1$/, "") + "/pilot/v2";
  const login = await fetch(`${baseUrl}/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: fixture.email, password: fixture.password }),
  });
  const { token } = await login.json() as { token: string };
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const create = async () => {
    const response = await fetch(`${pilotUrl}/runs`, {
      method: "POST", headers,
      body: JSON.stringify({
        spreadsheetId: policy.spreadsheetId,
        tabId: policy.tabId,
        requestId: row.request_id,
        userPrompt: "Create the reviewed card",
      }),
    });
    const body = await response.json() as Record<string, any>;
    expect(response.status, JSON.stringify(body)).toBe(202);
    return body.runId as string;
  };
  const detail = async (runId: string) => {
    const response = await fetch(`${pilotUrl}/runs/${runId}`, { headers });
    const body = await response.json() as Record<string, any>;
    expect(response.status, JSON.stringify(body)).toBe(200);
    return body;
  };
  const decide = (runId: string, decision: "approved" | "rejected", preview: {
    approvalId: string; versionId: string; snapshotHash: string;
  }) =>
    fetch(`${pilotUrl}/runs/${runId}/approve`, {
      method: "POST", headers,
      body: JSON.stringify({
        decision,
        approvalId: preview.approvalId,
        versionId: preview.versionId,
        snapshotHash: preview.snapshotHash,
      }),
    });
  const issueTokenFor = (userId: string): string => {
    const t = "token-" + randomUUID();
    customPrincipalTokens.set(t, userId);
    return t;
  };
  return {
    fixture, api, pilotUrl, headers, create, detail, decide, pilotConfig, intentKey, issueTokenFor,
    requestLogs,
    async close() { await api.close(); await fixture.close(); },
  };
}

function mockTrello(
  postFailure?: string,
  lists = [{ id: "list-todo", name: "To Do", closed: false }],
) {
  const realFetch = globalThis.fetch;
  let writes = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (!url.startsWith("https://api.trello.com/")) {
      return realFetch(input, init);
    }
    if (init?.method === "POST" && url.includes("/1/cards")) {
      writes++;
      if (postFailure) return new Response(postFailure, { status: 500 });
      return new Response(JSON.stringify({
        id: "card-pilot-1", url: "https://trello.com/c/card-pilot-1",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify(lists), {
      status: 200, headers: { "content-type": "application/json" },
    });
  });
  return { writes: () => writes };
}

describe("pilot durable approval over PostgreSQL and HTTP", () => {
  it("commits source before the opt-in planner and keeps write arguments policy-owned", async () => {
    let h!: Awaited<ReturnType<typeof harness>>;
    const propose = vi.fn(async (input: Parameters<PilotAccountedPlanner["propose"]>[0]) => {
      const saved = await h.fixture.db.client`
        SELECT source_revision, raw_data, checklist_result FROM source_snapshots
        WHERE run_id = ${input.runId}`;
      expect(saved).toHaveLength(1);
      expect(saved[0]?.raw_data.deliverable).toBe(row.deliverable);
      expect(saved[0]?.source_revision).toBe(input.sourceRevision);
      expect((await h.fixture.db.client`
        SELECT id FROM pilot_approvals WHERE run_id = ${input.runId}`)).toHaveLength(0);
      expect(input.context.envelope.clientUntrustedIntakeXml).toContain(row.deliverable);
      expect(input.context.userPrompt).not.toContain("fixture-token");
      return { proposal: { kind: "plan", tool: "trello.create_card" },
        usage: { inputTokens: 1, outputTokens: 1 }, costMicros: 3 };
    });
    h = await harness(false, [], fakePlanner(propose));
    try {
      const localFetch = globalThis.fetch;
      const requests = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
        if (new URL(String(input)).hostname !== "127.0.0.1")
          throw new Error("Unexpected external transport in offline planner test");
        return localFetch(input, init);
      });
      const runId = await h.create();
      expect(requests.mock.calls.every(([input]) =>
        new URL(String(input)).hostname === "127.0.0.1")).toBe(true);
      const detail = await h.detail(runId);
      expect(propose).toHaveBeenCalledTimes(1);
      expect(detail.status).toBe("awaiting_approval");
      expect(detail.preview.actions).toHaveLength(1);
      expect(detail.preview.actions[0].args).toMatchObject({
        boardId: h.pilotConfig.boardId, listId: h.pilotConfig.trello?.listId,
        title: row.deliverable, description: row.raw_request,
      });
      expect((await h.fixture.db.client`
        SELECT decision, expires_at, r.created_at FROM pilot_approvals a
        JOIN runs r ON r.id = a.run_id WHERE a.run_id = ${runId}`)).toHaveLength(1);
      expect(await h.fixture.db.client`
        SELECT status,cost_micros FROM ai_provider_calls WHERE run_id=${runId}`)
        .toEqual([{ status: "succeeded", cost_micros: "3" }]);
      expect(await h.fixture.db.client`
        SELECT kind,reason_code,message FROM pilot_planner_outcomes WHERE run_id=${runId}`)
        .toEqual([{ kind: "plan", reason_code: "PLAN_PROPOSED", message: null }]);
      const response = await h.decide(runId, "approved", detail.preview);
      expect(response.status).toBe(503);
      expect((await response.json() as any).error.code).toBe("LIVE_WRITE_BLOCKED");
    } finally {
      await h.close();
    }
  }, 45_000);

  it("does not return remote intake exception text to the HTTP client or request log", async () => {
    const fixture = await makeApiFixture();
    const policy: PilotPolicy = {
      enabled: true, principals: [fixture.userId], spreadsheetId: "sheet-pilot",
      tabId: "requests", boardId: "board-pilot",
    };
    const poison = "fixture-token Client A <script>remote error</script>";
    const requestLogs: string[] = [];
    const api = createApi({ db: fixture.db, config: fixture.config,
      pilotPolicy: policy, pilotConfig: { ...policy },
      requestLogger: (entry) => { requestLogs.push(JSON.stringify(entry)); },
      readSheetsRequestFn: async () => { throw new Error(poison); },
    });
    try {
      const base = await api.listen();
      const login = await fetch(`${base}/auth/login`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: fixture.email, password: fixture.password }),
      });
      const { token } = await login.json() as { token: string };
      const response = await fetch(`${base.replace(/\/api\/v1$/, "")}/pilot/v2/runs`, {
        method: "POST", headers: { authorization: `Bearer ${token}`,
          "content-type": "application/json" },
        body: JSON.stringify({ spreadsheetId: policy.spreadsheetId,
          tabId: policy.tabId, requestId: row.request_id,
          userPrompt: "Create the reviewed card" }),
      });
      expect(response.status).toBe(400);
      const payload = await response.json() as { error: { message: string } };
      expect(payload.error.message).toBe("Pilot intake unavailable");
      expect(JSON.stringify(payload)).not.toContain(poison);
      expect(JSON.stringify(requestLogs)).not.toContain(poison);
      expect(await fixture.db.client`SELECT id FROM runs WHERE profile='pilot-v2'`).toHaveLength(0);
    } finally { await api.close(); await fixture.close(); }
  }, 45_000);

  it("denies a missing grant before creating any run or provider call", async () => {
    const propose = vi.fn().mockResolvedValue({
      proposal: { kind: "plan", tool: "trello.create_card" }, usage: null, costMicros: 2,
    });
    const h = await harness(false, [], fakePlanner(propose), undefined, false);
    try {
      const response = await fetch(`${h.pilotUrl}/runs`, {
        method: "POST", headers: h.headers,
        body: JSON.stringify({ spreadsheetId: h.pilotConfig.spreadsheetId,
          tabId: h.pilotConfig.tabId, requestId: row.request_id,
          userPrompt: "Create the reviewed card" }),
      });
      expect(response.status).toBe(403);
      expect(propose).not.toHaveBeenCalled();
      expect(await h.fixture.db.client`SELECT id FROM runs WHERE profile='pilot-v2'`).toHaveLength(0);
      expect(await h.fixture.db.client`SELECT call_id FROM ai_provider_calls`).toHaveLength(0);
    } finally { await h.close(); }
  }, 45_000);

  it("revocation before claim makes no callback and settles zero cost", async () => {
    const propose = vi.fn().mockResolvedValue({
      proposal: { kind: "plan", tool: "trello.create_card" }, usage: null, costMicros: 2,
    });
    const h = await harness(false, [], fakePlanner(propose));
    try {
      await h.fixture.db.client`
        CREATE FUNCTION revoke_on_pilot_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN UPDATE pilot_ai_grants SET revoked_at=clock_timestamp()
          WHERE campaign_id=NEW.campaign_id; RETURN NEW; END $$`;
      await h.fixture.db.client`
        CREATE TRIGGER revoke_on_pilot_attempt AFTER INSERT ON pilot_ai_attempts
        FOR EACH ROW EXECUTE FUNCTION revoke_on_pilot_attempt()`;
      const response = await fetch(`${h.pilotUrl}/runs`, {
        method: "POST", headers: h.headers,
        body: JSON.stringify({ spreadsheetId: h.pilotConfig.spreadsheetId,
          tabId: h.pilotConfig.tabId, requestId: row.request_id,
          userPrompt: "Create the reviewed card" }),
      });
      expect(response.status).toBe(503);
      expect(propose).not.toHaveBeenCalled();
      expect(await h.fixture.db.client`
        SELECT status,cost_micros FROM ai_provider_calls`)
        .toEqual([{ status: "cancelled", cost_micros: "0" }]);
      expect(await h.fixture.db.client`SELECT id FROM pilot_approvals`).toHaveLength(0);
    } finally { await h.close(); }
  }, 45_000);

  it("revocation after claim charges known cost but creates no approval", async () => {
    let h!: Awaited<ReturnType<typeof harness>>;
    const propose = vi.fn(async () => {
      await h.fixture.db.client`UPDATE pilot_ai_grants SET revoked_at=clock_timestamp()
        WHERE principal_id=${h.fixture.userId}`;
      return { proposal: { kind: "plan", tool: "trello.create_card" },
        usage: null, costMicros: 2 };
    });
    h = await harness(false, [], fakePlanner(propose));
    try {
      const response = await fetch(`${h.pilotUrl}/runs`, {
        method: "POST", headers: h.headers,
        body: JSON.stringify({ spreadsheetId: h.pilotConfig.spreadsheetId,
          tabId: h.pilotConfig.tabId, requestId: row.request_id,
          userPrompt: "Create the reviewed card" }),
      });
      expect(response.status).toBe(503);
      expect(propose).toHaveBeenCalledTimes(1);
      expect(await h.fixture.db.client`
        SELECT status,cost_micros FROM ai_provider_calls`)
        .toEqual([{ status: "succeeded", cost_micros: "2" }]);
      expect(await h.fixture.db.client`SELECT id FROM pilot_approvals`).toHaveLength(0);
    } finally { await h.close(); }
  }, 45_000);

  it("unknown cost keeps the hold, and policy drift prevents approval", async () => {
    let h!: Awaited<ReturnType<typeof harness>>;
    const propose = vi.fn()
      .mockResolvedValueOnce({ proposal: { kind: "plan", tool: "trello.create_card" },
        usage: null, costMicros: null })
      .mockImplementationOnce(async () => {
        h.pilotConfig.enabled = false;
        return { proposal: { kind: "plan", tool: "trello.create_card" },
          usage: null, costMicros: 2 };
      });
    h = await harness(false, [], fakePlanner(propose));
    try {
      for (let i = 0; i < 2; i++) {
        const response = await fetch(`${h.pilotUrl}/runs`, {
          method: "POST", headers: h.headers,
          body: JSON.stringify({ spreadsheetId: h.pilotConfig.spreadsheetId,
            tabId: h.pilotConfig.tabId, requestId: row.request_id,
            userPrompt: "Create the reviewed card" }),
        });
        expect(response.status).toBe(503);
      }
      expect(await h.fixture.db.client`SELECT id FROM pilot_approvals`).toHaveLength(0);
      expect(await h.fixture.db.client`
        SELECT held_micros,committed_micros FROM ai_provider_campaigns
        WHERE campaign_id=${`pilot-v2:${h.fixture.userId}`}`)
        .toEqual([{ held_micros: "60", committed_micros: "2" }]);
    } finally { await h.close(); }
  }, 45_000);

  it("keeps two principals' pilot campaigns and call counts isolated", async () => {
    const userBId = randomUUID();
    const propose = vi.fn().mockResolvedValue({
      proposal: { kind: "plan", tool: "trello.create_card" }, usage: null, costMicros: 2,
    });
    const h = await harness(false, [userBId], fakePlanner(propose));
    try {
      const runA = await h.create();
      const detailA = await h.detail(runA);
      expect((await h.decide(runA, "rejected", detailA.preview)).status).toBe(200);
      const tokenB = h.issueTokenFor(userBId);
      const headersB = { ...h.headers, authorization: `Bearer ${tokenB}` };
      const responseB = await fetch(`${h.pilotUrl}/runs`, {
        method: "POST", headers: headersB,
        body: JSON.stringify({ spreadsheetId: h.pilotConfig.spreadsheetId,
          tabId: h.pilotConfig.tabId, requestId: row.request_id,
          userPrompt: "Create the reviewed card" }),
      });
      expect(responseB.status).toBe(202);
      const runB = (await responseB.json() as { runId: string }).runId;
      expect((await fetch(`${h.pilotUrl}/runs/${runB}`, { headers: h.headers })).status).toBe(404);
      expect(await h.fixture.db.client`
        SELECT campaign_id,committed_micros FROM ai_provider_campaigns
        WHERE campaign_id IN (${`pilot-v2:${h.fixture.userId}`},${`pilot-v2:${userBId}`})
        ORDER BY campaign_id`).toEqual([
        { campaign_id: `pilot-v2:${h.fixture.userId}`, committed_micros: "2" },
        { campaign_id: `pilot-v2:${userBId}`, committed_micros: "2" },
      ].sort((a, b) => a.campaign_id.localeCompare(b.campaign_id)));
      expect(await h.fixture.db.client`SELECT call_id FROM ai_provider_calls`).toHaveLength(2);
    } finally { await h.close(); }
  }, 45_000);

  it("rechecks grant after list lookup and prevents a Trello POST on revocation", async () => {
    const propose = vi.fn().mockResolvedValue({
      proposal: { kind: "plan", tool: "trello.create_card" }, usage: null, costMicros: 2,
    });
    const h = await harness(true, [], fakePlanner(propose));
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    try {
      const runId = await h.create();
      const detail = await h.detail(runId);
      const realFetch = globalThis.fetch;
      let writes = 0;
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const url = String(input);
        if (!url.startsWith("https://api.trello.com/")) return realFetch(input, init);
        if (init?.method === "POST" && url.includes("/1/cards")) {
          writes++;
          return new Response(JSON.stringify({ id: "card-unexpected", url: "https://trello.com/c/card-unexpected" }),
            { status: 200, headers: { "content-type": "application/json" } });
        }
        entered();
        await gate;
        return new Response(JSON.stringify([{ id: "list-todo", name: "To Do", closed: false }]),
          { status: 200, headers: { "content-type": "application/json" } });
      });
      const pending = h.decide(runId, "approved", detail.preview);
      await started;
      await h.fixture.db.client`UPDATE pilot_ai_grants SET revoked_at=clock_timestamp()
        WHERE principal_id=${h.fixture.userId}`;
      release();
      const result = await pending;
      expect(result.status).toBe(200);
      expect((await result.json() as { status: string }).status).toBe("reconciliation_required");
      expect(writes).toBe(0);
      expect((await h.detail(runId)).status).toBe("reconciliation_required");
    } finally { release?.(); await h.close(); }
  }, 45_000);

  it.each(["provider", "model"] as const)(
    "refuses approval before reservation when the AI grant %s drifts", async (field) => {
      const propose = vi.fn().mockResolvedValue({
        proposal: { kind: "plan", tool: "trello.create_card" }, usage: null, costMicros: 2,
      });
      const h = await harness(true, [], fakePlanner(propose));
      try {
        const runId = await h.create();
        const detail = await h.detail(runId);
        if (field === "model") await h.fixture.db.client`
          UPDATE pilot_ai_grants SET model='other-model'
          WHERE principal_id=${h.fixture.userId}`;
        else await h.fixture.db.client`
          UPDATE pilot_ai_grants SET provider='openai'
          WHERE principal_id=${h.fixture.userId}`;
        const trello = mockTrello();
        const response = await h.decide(runId, "approved", detail.preview);
        expect(response.status).toBe(403);
        expect(trello.writes()).toBe(0);
        expect(await h.fixture.db.client`
          SELECT decision FROM pilot_approvals WHERE run_id=${runId}`)
          .toEqual([{ decision: "pending" }]);
        expect(await h.fixture.db.client`
          SELECT status FROM runs WHERE id=${runId}`)
          .toEqual([{ status: "awaiting_approval" }]);
        expect(await h.fixture.db.client`SELECT id FROM business_reservations`).toHaveLength(0);
      } finally { await h.close(); }
    }, 45_000);

  it("does not dispatch an approved card after the pilot grant is revoked", async () => {
    const propose = vi.fn().mockResolvedValue({
      proposal: { kind: "plan", tool: "trello.create_card" }, usage: null, costMicros: 2,
    });
    const h = await harness(true, [], fakePlanner(propose));
    try {
      const runId = await h.create();
      const detail = await h.detail(runId);
      await h.fixture.db.client`UPDATE pilot_ai_grants SET revoked_at=clock_timestamp()
        WHERE principal_id=${h.fixture.userId}`;
      const trello = mockTrello();
      const response = await h.decide(runId, "approved", detail.preview);
      expect(response.status).toBe(403);
      expect(trello.writes()).toBe(0);
      expect(await h.fixture.db.client`
        SELECT decision FROM pilot_approvals WHERE run_id=${runId}`)
        .toEqual([{ decision: "pending" }]);
    } finally { await h.close(); }
  }, 45_000);

  it("projects only server-owned refusal/clarification messages to the owner", async () => {
    const userBId = randomUUID();
    const poison = "fixture-token Client A <script>alert(1)</script>";
    const propose = vi.fn()
      .mockResolvedValueOnce({ proposal: { kind: "refusal", reason: poison }, usage: null, costMicros: 2 })
      .mockResolvedValueOnce({ proposal: { kind: "clarification", question: poison }, usage: null, costMicros: 2 });
    const h = await harness(false, [userBId], fakePlanner(propose));
    try {
      const refused = await h.create();
      const refusal = await h.detail(refused);
      expect(refusal.status).toBe("refused");
      expect(refusal.preview).toBeNull();
      expect(refusal.refusalReason).toBeTruthy();
      expect(refusal.clarificationQuestion ?? null).toBeNull();
      const clarified = await h.create();
      const clarification = await h.detail(clarified);
      expect(clarification.status).toBe("needs_input");
      expect(clarification.preview).toBeNull();
      expect(clarification.clarificationQuestion).toBeTruthy();
      expect(clarification.refusalReason ?? null).toBeNull();
      const bHeaders = { ...h.headers, authorization: `Bearer ${h.issueTokenFor(userBId)}` };
      expect((await fetch(`${h.pilotUrl}/runs/${clarified}`, { headers: bHeaders })).status).toBe(404);
      const outcomes = await h.fixture.db.client`
        SELECT kind,reason_code,message FROM pilot_planner_outcomes ORDER BY created_at,run_id`;
      expect(outcomes).toHaveLength(2);
      expect(outcomes.map((item) => item.kind).sort()).toEqual(["clarification", "refusal"]);
      const events = await h.fixture.db.client`
        SELECT payload FROM run_events WHERE run_id IN (${refused},${clarified})`;
      for (const value of [JSON.stringify(outcomes), JSON.stringify(events),
        JSON.stringify(h.requestLogs),
        JSON.stringify({ refusalReason: refusal.refusalReason, error: refusal.error }),
        JSON.stringify({ clarificationQuestion: clarification.clarificationQuestion,
          error: clarification.error })]) {
        expect(value).not.toContain("fixture-token");
        expect(value).not.toContain("Client A");
        expect(value).not.toContain("<script>");
      }
    } finally { await h.close(); }
  }, 45_000);

  it("terminates planner refusal and clarification without approvals", async () => {
    const propose = vi.fn()
      .mockResolvedValueOnce({ proposal: { kind: "refusal", reason: "Unsupported" }, usage: null, costMicros: 2 })
      .mockResolvedValueOnce({ proposal: { kind: "clarification", question: "Which asset?" }, usage: null, costMicros: 2 });
    const h = await harness(false, [], fakePlanner(propose));
    try {
      expect((await h.detail(await h.create())).status).toBe("refused");
      expect((await h.detail(await h.create())).status).toBe("needs_input");
      expect(propose).toHaveBeenCalledTimes(2);
      expect(await h.fixture.db.client`SELECT id FROM pilot_approvals`).toHaveLength(0);
      expect(await h.fixture.db.client`SELECT id FROM business_reservations`).toHaveLength(0);
    } finally {
      await h.close();
    }
  }, 45_000);

  it("fails closed on malformed planner output or timeout without creating approval", async () => {
    const propose = vi.fn()
      .mockResolvedValueOnce({ proposal: { kind: "plan", tool: "trello.move_card" }, usage: null, costMicros: 2 })
      .mockResolvedValueOnce({ proposal: { kind: "plan", tool: "trello.create_card", args: { boardId: "other-board" } }, usage: null, costMicros: 2 })
      .mockImplementationOnce(() => new Promise(() => {}));
    const h = await harness(false, [], fakePlanner(propose), 15);
    try {
      for (let index = 0; index < 3; index++) {
        const response = await fetch(`${h.pilotUrl}/runs`, {
          method: "POST", headers: h.headers,
          body: JSON.stringify({
            spreadsheetId: h.pilotConfig.spreadsheetId,
            tabId: h.pilotConfig.tabId,
            requestId: row.request_id,
            userPrompt: "Create the reviewed card",
          }),
        });
        expect(response.status).toBe(503);
        expect((await response.json() as any).error.code).toBe("PILOT_PLANNING_FAILED");
      }
      expect(await h.fixture.db.client`
        SELECT status FROM runs WHERE profile = 'pilot-v2' AND status <> 'failed'`).toHaveLength(0);
      expect(await h.fixture.db.client`SELECT id FROM pilot_approvals`).toHaveLength(0);
      const failedRuns = await h.fixture.db.client`
        SELECT id FROM runs WHERE profile='pilot-v2' ORDER BY created_at,id`;
      expect(failedRuns).toHaveLength(3);
      for (const failed of failedRuns) {
        const detail = await h.detail(failed.id);
        expect(detail.status).toBe("failed");
        expect(detail.preview).toBeNull();
        expect(detail.error).toBeTruthy();
        expect(JSON.stringify(detail.error)).not.toContain("fixture-token");
      }
      expect(await h.fixture.db.client`
        SELECT kind,reason_code FROM pilot_planner_outcomes`)
        .toEqual(Array.from({ length: 3 }, () => ({
          kind: "failure", reason_code: "PLANNING_FAILED",
        })));
      expect(await h.fixture.db.client`
        SELECT held_micros,committed_micros FROM ai_provider_campaigns
        WHERE campaign_id=${`pilot-v2:${h.fixture.userId}`}`)
        .toEqual([{ held_micros: "60", committed_micros: "4" }]);
      expect(await h.fixture.db.client`
        SELECT status,cost_micros FROM ai_provider_calls ORDER BY created_at,call_id`)
        .toEqual([
          { status: "invalid_output", cost_micros: "2" },
          { status: "invalid_output", cost_micros: "2" },
          { status: "ambiguous", cost_micros: null },
        ]);
    } finally {
      await h.close();
    }
  }, 45_000);

  it("fails an abandoned planning run without accepting its late proposal", async () => {
    let started!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const propose = vi.fn()
      .mockImplementationOnce(async () => { started(); await gate; return {
        proposal: { kind: "plan", tool: "trello.create_card" }, usage: null, costMicros: 2,
      }; })
      .mockResolvedValue({ proposal: { kind: "plan", tool: "trello.create_card" }, usage: null, costMicros: 2 });
    const h = await harness(false, [], fakePlanner(propose));
    try {
      const first = fetch(`${h.pilotUrl}/runs`, {
        method: "POST", headers: h.headers,
        body: JSON.stringify({
          spreadsheetId: h.pilotConfig.spreadsheetId,
          tabId: h.pilotConfig.tabId,
          requestId: row.request_id,
          userPrompt: "Create the reviewed card",
        }),
      });
      await entered;
      const old = (await h.fixture.db.client`
        SELECT id FROM runs WHERE profile = 'pilot-v2' AND status = 'planning'`)[0];
      expect(old).toBeDefined();
      await h.fixture.db.client`
        UPDATE runs SET created_at = clock_timestamp() - interval '6 minutes'
        WHERE id = ${old!.id}`;
      const replacement = await h.create();
      expect((await h.detail(replacement)).status).toBe("awaiting_approval");
      release();
      expect((await first).status).toBe(503);
      expect((await h.fixture.db.client`
        SELECT status FROM runs WHERE id = ${old!.id}`)[0]?.status).toBe("failed");
      expect(await h.fixture.db.client`
        SELECT id FROM pilot_approvals WHERE run_id = ${old!.id}`).toHaveLength(0);
    } finally {
      release();
      await h.close();
    }
  }, 45_000);

  it("does not invoke planner for a checklist refusal", async () => {
    const fixture = await makeApiFixture();
    const badRow = { ...row, request_type: "unsupported" };
    const checklist = evaluateChecklist(badRow);
    const policy: PilotPolicy = {
      enabled: true, principals: [fixture.userId], spreadsheetId: "sheet-pilot",
      tabId: "requests", boardId: "board-pilot",
    };
    const propose = vi.fn();
    const api = createApi({
      db: fixture.db, config: fixture.config,
      pilotConfig: { ...policy }, pilotPolicy: policy,
      pilotPlanner: fakePlanner(propose),
      readSheetsRequestFn: async () => ({
        row: badRow, checklist,
        sourceKey: sourceKey({ groupId: policy.boardId, spreadsheetId: policy.spreadsheetId,
          tabId: policy.tabId, requestId: badRow.request_id }),
        sourceRevision: checklist.sourceRevision,
      }),
    });
    try {
      const baseUrl = await api.listen();
      const login = await fetch(`${baseUrl}/auth/login`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: fixture.email, password: fixture.password }),
      });
      const { token } = await login.json() as { token: string };
      const response = await fetch(`${baseUrl.replace(/\/api\/v1$/, "")}/pilot/v2/runs`, {
        method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ spreadsheetId: policy.spreadsheetId, tabId: policy.tabId,
          requestId: badRow.request_id, userPrompt: "Create the reviewed card" }),
      });
      expect(response.status).toBe(202);
      expect(propose).not.toHaveBeenCalled();
      expect((await fixture.db.client`SELECT status FROM runs WHERE profile = 'pilot-v2'`)[0]?.status)
        .toBe("refused");
      expect(await fixture.db.client`SELECT id FROM pilot_approvals`).toHaveLength(0);
    } finally {
      await api.close();
      await fixture.close();
    }
  }, 45_000);

  it("does not show a prior run receipt before approval and reuses the actual list ID", async () => {
    const h = await harness();
    try {
      const trello = mockTrello();
      const first = await h.create();
      const firstDetail = await h.detail(first);
      expect((await h.decide(first, "approved", firstDetail.preview)).status).toBe(200);
      const second = await h.create();
      const before = await h.detail(second);
      expect(before.status).toBe("awaiting_approval");
      expect(before.receipt).toBeNull();
      expect((await h.decide(second, "approved", before.preview)).status).toBe(200);
      const after = await h.detail(second);
      expect(after.status).toBe("succeeded");
      expect(after.receipt.listId).toBe("list-todo");
      expect(trello.writes()).toBe(1);
    } finally {
      await h.close();
    }
  }, 45_000);

  it("does not report success when an in-flight run was quarantined", async () => {
    const h = await harness();
    let releasePost: (() => void) | undefined;
    try {
      const runId = await h.create();
      const preview = (await h.detail(runId)).preview;
      const realFetch = globalThis.fetch;
      let started!: () => void;
      const postStarted = new Promise<void>((resolve) => { started = resolve; });
      const postGate = new Promise<void>((resolve) => { releasePost = resolve; });
      let posts = 0;
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const url = String(input);
        if (!url.startsWith("https://api.trello.com/")) return realFetch(input, init);
        if (init?.method === "POST") {
          posts++;
          started();
          await postGate;
          return new Response(JSON.stringify({
            id: "late-card", url: "https://trello.com/c/late-card",
          }), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response(JSON.stringify([
          { id: "list-todo", name: "To Do", closed: false },
        ]), { status: 200, headers: { "content-type": "application/json" } });
      });
      const responsePromise = h.decide(runId, "approved", preview);
      await postStarted;
      await h.fixture.db.client`
        UPDATE pilot_approvals SET decided_at = clock_timestamp() - interval '16 minutes'
        WHERE run_id = ${runId}`;
      expect((await h.detail(runId)).status).toBe("reconciliation_required");
      releasePost?.();
      const response = await responsePromise;
      expect(response.status).toBe(503);
      expect((await response.json() as any).error.code).toBe("DISPATCH_UNCERTAIN");
      expect((await h.detail(runId)).status).toBe("reconciliation_required");
      expect(posts).toBe(1);
    } finally {
      releasePost?.();
      await h.close();
    }
  }, 45_000);

  it("keeps live writes disabled unless explicitly enabled", async () => {
    const h = await harness(false);
    try {
      const runId = await h.create();
      const detail = await h.detail(runId);
      const trello = mockTrello();
      const response = await h.decide(runId, "approved", detail.preview);
      expect(response.status).toBe(503);
      expect((await response.json() as any).error.code).toBe("LIVE_WRITE_BLOCKED");
      expect((await h.fixture.db.client`
        SELECT decision FROM pilot_approvals WHERE run_id = ${runId}`)[0]?.decision).toBe("pending");
      expect(trello.writes()).toBe(0);
    } finally {
      await h.close();
    }
  }, 45_000);

  it("rejects a workflow version changed after preview", async () => {
    const h = await harness();
    try {
      const runId = await h.create();
      const detail = await h.detail(runId);
      const original = (await h.fixture.db.client`
        SELECT workflow_id FROM runs WHERE id = ${runId}`)[0];
      expect(original).toBeDefined();
      const nextVersion = randomUUID();
      await h.fixture.db.client`
        INSERT INTO workflow_versions(id, workflow_id, version_no, plan, origin)
        VALUES (${nextVersion}, ${original!.workflow_id}, 2, '{}'::jsonb, 'replan')`;
      await h.fixture.db.client`
        UPDATE runs SET workflow_version_id = ${nextVersion} WHERE id = ${runId}`;
      const trello = mockTrello();
      const response = await h.decide(runId, "approved", detail.preview);
      expect(response.status).toBe(409);
      expect((await response.json() as any).error.code).toBe("VERSION_MISMATCH");
      expect(trello.writes()).toBe(0);
    } finally {
      await h.close();
    }
  }, 45_000);

  it("rejects a configured Trello list changed after preview", async () => {
    const h = await harness();
    try {
      const runId = await h.create();
      const detail = await h.detail(runId);
      h.pilotConfig.trello!.listId = "different-list";
      const trello = mockTrello();
      const response = await h.decide(runId, "approved", detail.preview);
      expect(response.status).toBe(409);
      expect((await response.json() as any).error.code).toBe("SNAPSHOT_MISMATCH");
      expect(trello.writes()).toBe(0);
    } finally {
      await h.close();
    }
  }, 45_000);

  it("does not POST when the reviewed list ID disappears", async () => {
    const h = await harness();
    try {
      const runId = await h.create();
      const detail = await h.detail(runId);
      const trello = mockTrello(undefined, [
        { id: "different-list", name: "To Do", closed: false },
      ]);
      const response = await h.decide(runId, "approved", detail.preview);
      expect(response.status).toBe(200);
      expect((await response.json() as any).status).toBe("reconciliation_required");
      expect(trello.writes()).toBe(0);
    } finally {
      await h.close();
    }
  }, 45_000);

  it("expires untouched approvals before admitting a new run", async () => {
    const h = await harness();
    try {
      const first = await h.create();
      await h.fixture.db.client`
        UPDATE pilot_approvals SET expires_at = clock_timestamp() - interval '1 second'
        WHERE run_id = ${first}`;
      const second = await h.create();
      expect(second).not.toBe(first);
      expect((await h.fixture.db.client`
        SELECT decision FROM pilot_approvals WHERE run_id = ${first}`)[0]?.decision).toBe("expired");
      expect((await h.fixture.db.client`
        SELECT status FROM runs WHERE id = ${first}`)[0]?.status).toBe("expired");
      expect((await h.fixture.db.client`
        SELECT payload FROM run_events WHERE run_id = ${first} ORDER BY seq`))
        .toHaveLength(2);
    } finally {
      await h.close();
    }
  }, 45_000);

  it("quarantines an abandoned approved run before new intake", async () => {
    const h = await harness();
    try {
      const first = await h.create();
      await h.fixture.db.client`
        UPDATE pilot_approvals SET decision = 'approved',
          decided_at = clock_timestamp() - interval '16 minutes'
        WHERE run_id = ${first}`;
      await h.fixture.db.client`
        UPDATE runs SET status = 'running' WHERE id = ${first}`;
      const second = await h.create();
      expect(second).not.toBe(first);
      expect((await h.fixture.db.client`
        SELECT status FROM runs WHERE id = ${first}`)[0]?.status)
        .toBe("reconciliation_required");
    } finally {
      await h.close();
    }
  }, 45_000);

  it("persists the preview, approves once, and creates exactly one card", async () => {
    const h = await harness();
    try {
      const runId = await h.create();
      const detail = await h.detail(runId);
      expect(detail.status).toBe("awaiting_approval");
      const approval = await h.fixture.db.client`
        SELECT decision, snapshot_hash FROM pilot_approvals WHERE run_id = ${runId}`;
      expect(approval[0]?.decision).toBe("pending");
      expect(approval[0]?.snapshot_hash).toBe(detail.preview.snapshotHash);

      const trello = mockTrello();
      const response = await h.decide(runId, "approved", detail.preview);
      expect(response.status, await response.text()).toBe(200);
      expect(trello.writes()).toBe(1);
      expect((await h.detail(runId)).status).toBe("succeeded");
      expect((await h.fixture.db.client`
        SELECT decision FROM pilot_approvals WHERE run_id = ${runId}`)[0]?.decision).toBe("approved");
      expect((await h.fixture.db.client`
        SELECT status, remote_id FROM business_reservations WHERE intent_key = ${h.intentKey}`)[0])
        .toMatchObject({ status: "confirmed", remote_id: "card-pilot-1" });

      const replay = await h.decide(runId, "approved", detail.preview);
      expect(replay.status).toBe(409);
      expect(trello.writes()).toBe(1);
    } finally {
      await h.close();
    }
  }, 45_000);

  it("rejects a changed hash and expires using the database clock without a write", async () => {
    const h = await harness();
    try {
      const runId = await h.create();
      const detail = await h.detail(runId);
      const trello = mockTrello();
      const mismatch = await h.decide(runId, "approved", {
        ...detail.preview, snapshotHash: "0".repeat(64),
      });
      expect(mismatch.status).toBe(409);
      expect((await h.fixture.db.client`
        SELECT decision FROM pilot_approvals WHERE run_id = ${runId}`)[0]?.decision).toBe("pending");

      await h.fixture.db.client`
        UPDATE pilot_approvals SET expires_at = clock_timestamp() - interval '1 second'
        WHERE run_id = ${runId}`;
      await h.fixture.db.client`
        UPDATE source_snapshots
        SET raw_data = jsonb_set(raw_data, '{deliverable}', '"Changed after expiry"'::jsonb)
        WHERE run_id = ${runId}`;
      const expired = await h.decide(runId, "approved", detail.preview);
      expect(expired.status).toBe(409);
      expect((await expired.json() as any).error.code).toBe("APPROVAL_EXPIRED");
      expect((await h.fixture.db.client`
        SELECT decision FROM pilot_approvals WHERE run_id = ${runId}`)[0]?.decision).toBe("expired");
      expect(trello.writes()).toBe(0);
    } finally {
      await h.close();
    }
  }, 45_000);

  it("serializes two approval requests and sends only one Trello POST", async () => {
    const h = await harness();
    try {
      const runId = await h.create();
      const detail = await h.detail(runId);
      const trello = mockTrello();
      const responses = await Promise.all([
        h.decide(runId, "approved", detail.preview),
        h.decide(runId, "approved", detail.preview),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(trello.writes()).toBe(1);
      expect((await h.fixture.db.client`
        SELECT decision FROM pilot_approvals WHERE run_id = ${runId}`)[0]?.decision).toBe("approved");
    } finally {
      await h.close();
    }
  }, 45_000);

  it("keeps an ambiguous Trello error in reconciliation and blocks replay", async () => {
    const h = await harness();
    try {
      const runId = await h.create();
      const detail = await h.detail(runId);
      const poison = "fixture-token Client A <script>remote error</script>";
      const trello = mockTrello(poison);
      const response = await h.decide(runId, "approved", detail.preview);
      expect(response.status).toBe(200);
      const payload = await response.json() as { status: string; error: string };
      expect(payload.status).toBe("reconciliation_required");
      expect(payload.error).toBe("REMOTE_WRITE_UNKNOWN: Pilot dispatch requires reconciliation");
      expect(JSON.stringify(payload)).not.toContain(poison);
      expect(JSON.stringify(h.requestLogs)).not.toContain(poison);
      expect((await h.fixture.db.client`
        SELECT status FROM business_reservations WHERE intent_key = ${h.intentKey}`)[0]?.status)
        .toBe("unknown");
      expect((await h.detail(runId)).status).toBe("reconciliation_required");
      const replay = await h.decide(runId, "approved", detail.preview);
      expect(replay.status).toBe(409);
      expect(trello.writes()).toBe(1);
    } finally {
      await h.close();
    }
  }, 45_000);

  it("rejects a source snapshot changed after preview", async () => {
    const h = await harness();
    try {
      const runId = await h.create();
      const detail = await h.detail(runId);
      await h.fixture.db.client`
        UPDATE source_snapshots
        SET raw_data = jsonb_set(raw_data, '{deliverable}', '"Changed without approval"'::jsonb)
        WHERE run_id = ${runId}
      `;
      const trello = mockTrello();
      const changedPreview = await fetch(`${h.pilotUrl}/runs/${runId}`, { headers: h.headers });
      expect(changedPreview.status).toBe(409);
      const attempt = await h.decide(runId, "approved", detail.preview);
      expect(attempt.status).toBe(409);
      expect((await attempt.json() as any).error.code).toBe("SNAPSHOT_MISMATCH");
      expect(trello.writes()).toBe(0);
      expect((await h.fixture.db.client`
        SELECT decision FROM pilot_approvals WHERE run_id = ${runId}`)[0]?.decision).toBe("pending");
    } finally {
      await h.close();
    }
  }, 45_000);

  it("persists an explicit rejection without reserving or writing", async () => {
    const h = await harness();
    try {
      const runId = await h.create();
      const detail = await h.detail(runId);
      const trello = mockTrello();
      const response = await h.decide(runId, "rejected", detail.preview);
      expect(response.status).toBe(200);
      expect((await response.json() as any).status).toBe("rejected");
      expect((await h.fixture.db.client`
        SELECT decision FROM pilot_approvals WHERE run_id = ${runId}`)[0]?.decision).toBe("rejected");
      expect((await h.detail(runId)).status).toBe("rejected");
      expect((await h.fixture.db.client`
        SELECT id FROM business_reservations WHERE intent_key = ${detail.sourceKey}`)).toHaveLength(0);
      expect(trello.writes()).toBe(0);
    } finally {
      await h.close();
    }
  }, 45_000);

  it("enforces owner isolation: Operator B cannot read or approve Operator A's run", async () => {
    const userBId = randomUUID();
    const h = await harness(true, [userBId]);
    try {
      // Create run with Operator A
      const runIdA = await h.create();
      const detailA = await h.detail(runIdA);
      expect(detailA.status).toBe("awaiting_approval");

      // Generate authorized token for Operator B
      const tokenB = h.issueTokenFor(userBId);
      const headersB = {
        authorization: `Bearer ${tokenB}`,
        "content-type": "application/json",
      };

      const trello = mockTrello();


      // Operator B cannot read Operator A's run
      const getResponse = await fetch(`${h.pilotUrl}/runs/${runIdA}`, { headers: headersB });
      expect(getResponse.status).toBe(404);

      // Operator B cannot approve Operator A's run
      const approveResponse = await fetch(`${h.pilotUrl}/runs/${runIdA}/approve`, {
        method: "POST",
        headers: headersB,
        body: JSON.stringify({
          decision: "approved",
          approvalId: detailA.preview.approvalId,
          versionId: detailA.preview.versionId,
          snapshotHash: detailA.preview.snapshotHash,
        }),
      });
      expect(approveResponse.status).toBe(404);

      // Verify ZERO remote writes were dispatched by Operator B's unauthorized attempt
      expect(trello.writes()).toBe(0);

      // Verify run is still pending for Operator A
      const afterDetailA = await h.detail(runIdA);
      expect(afterDetailA.status).toBe("awaiting_approval");
    } finally {
      await h.close();
    }
  }, 45_000);

  it("quarantines as reconciliation_required and records unknown reservation when Trello returns an invalid receipt", async () => {
    const h = await harness();
    try {
      const runId = await h.create();
      const detail = await h.detail(runId);

      // Mock Trello returning 200 OK but with invalid/empty receipt payload
      let writes = 0;
      const realFetch = globalThis.fetch;
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const url = String(input);
        if (!url.startsWith("https://api.trello.com/")) return realFetch(input, init);
        if (init?.method === "POST" && url.includes("/1/cards")) {
          writes++;
          // Returns 200 OK but missing required id and url
          return new Response(JSON.stringify({ id: "", url: "" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify([{ id: "list-todo", name: "To Do", closed: false }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

      const response = await h.decide(runId, "approved", detail.preview);
      expect(response.status).toBe(200);
      expect((await response.json() as any).status).toBe("reconciliation_required");

      // Verify DB reservation status is quarantined as unknown
      const reservations = await h.fixture.db.client`
        SELECT status FROM business_reservations WHERE intent_key = ${h.intentKey}
      `;
      expect(reservations[0]?.status).toBe("unknown");

      // Verify run status in DB is reconciliation_required
      const runRows = await h.fixture.db.client`
        SELECT status FROM runs WHERE id = ${runId}
      `;
      expect(runRows[0]?.status).toBe("reconciliation_required");

      // Verify single write and zero blind retry
      expect(writes).toBe(1);

      // Replay must be blocked with 409
      const replay = await h.decide(runId, "approved", detail.preview);
      expect(replay.status).toBe(409);
      expect(writes).toBe(1);
    } finally {
      await h.close();
    }
  }, 45_000);
});

