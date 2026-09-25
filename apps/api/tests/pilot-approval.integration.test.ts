import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createApi } from "../src/app.js";
import { SessionStore } from "../src/auth.js";
import { makeApiFixture } from "./fixture.js";
import {
  evaluateChecklist, sourceKey, createIntentKey,
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

async function harness(writeEnabled = true, secondPrincipal = false) {
  const fixture = await makeApiFixture();
  const otherEmail = `other-${randomUUID()}@local.invalid`;
  const otherUserId = randomUUID();
  if (secondPrincipal) {
    await fixture.db.client`
      INSERT INTO users (id, email, password_hash, display_name)
      VALUES (${otherUserId}, ${otherEmail},
        (SELECT password_hash FROM users WHERE id = ${fixture.userId}), 'Other operator')`;
  }
  const policy: PilotPolicy = {
    enabled: true, principals: secondPrincipal ? [fixture.userId, otherUserId] : [fixture.userId],
    spreadsheetId: "sheet-pilot", tabId: "requests", boardId: "board-pilot",
  };
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
  const ownerSession = new SessionStore({
    userId: fixture.userId, email: fixture.email,
    passwordHash: fixture.config.passwordHash,
    ttlMs: fixture.config.sessionTtlMs,
    principalExists: async () => true,
  });
  const sessionStore = secondPrincipal ? {
    login: ownerSession.login.bind(ownerSession),
    issue: ownerSession.issue.bind(ownerSession),
    authenticate(input: Parameters<SessionStore["authenticate"]>[0]) {
      if (typeof input !== "string" && input?.authorization === "Bearer test-other-token") {
        return otherUserId;
      }
      return ownerSession.authenticate(input);
    },
    revoke: ownerSession.revoke.bind(ownerSession),
  } : undefined;
  const api = createApi({
    db: fixture.db, config: fixture.config,
    pilotConfig, pilotPolicy: policy,
    pilotLiveWriteEnabled: writeEnabled,
    sessionStore,
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
  return {
    fixture, api, pilotUrl, headers, create, detail, decide, pilotConfig, intentKey,
    async otherHeaders() {
      return { authorization: "Bearer test-other-token", "content-type": "application/json" };
    },
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
      const trello = mockTrello("LIST_NOT_FOUND after POST acceptance is unknown");
      const response = await h.decide(runId, "approved", detail.preview);
      expect(response.status).toBe(200);
      expect((await response.json() as any).status).toBe("reconciliation_required");
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

  it("quarantines a Trello response without a card ID and never replays the POST", async () => {
    const h = await harness();
    try {
      const runId = await h.create();
      const preview = (await h.detail(runId)).preview;
      const realFetch = globalThis.fetch;
      let posts = 0;
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const url = String(input);
        if (!url.startsWith("https://api.trello.com/")) return realFetch(input, init);
        if (init?.method === "POST") {
          posts++;
          return new Response(JSON.stringify({ url: "https://trello.com/c/unknown" }), {
            status: 200, headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify([{ id: "list-todo", name: "To Do", closed: false }]), {
          status: 200, headers: { "content-type": "application/json" },
        });
      });
      const response = await h.decide(runId, "approved", preview);
      expect(response.status).toBe(200);
      expect((await response.json() as any).status).toBe("reconciliation_required");
      expect((await h.fixture.db.client`
        SELECT status FROM business_reservations WHERE intent_key = ${h.intentKey}`)[0]?.status)
        .toBe("unknown");
      expect((await h.decide(runId, "approved", preview)).status).toBe(409);
      expect(posts).toBe(1);
    } finally {
      await h.close();
    }
  }, 45_000);

  it("keeps the intent unknown when DB receipt confirmation fails after one POST", async () => {
    const h = await harness();
    try {
      const runId = await h.create();
      const preview = (await h.detail(runId)).preview;
      await h.fixture.db.client.unsafe(`
        CREATE FUNCTION block_pilot_confirmation() RETURNS trigger AS $$
        BEGIN
          IF NEW.status = 'confirmed' THEN
            RAISE EXCEPTION 'confirmation unavailable';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER block_pilot_confirmation
        BEFORE UPDATE ON business_reservations
        FOR EACH ROW EXECUTE FUNCTION block_pilot_confirmation();
      `);
      const trello = mockTrello();
      const response = await h.decide(runId, "approved", preview);
      expect(response.status).toBe(200);
      expect((await response.json() as any).status).toBe("reconciliation_required");
      expect((await h.fixture.db.client`
        SELECT status, remote_id FROM business_reservations WHERE intent_key = ${h.intentKey}`)[0])
        .toMatchObject({ status: "unknown", remote_id: null });
      expect((await h.detail(runId)).status).toBe("reconciliation_required");
      expect((await h.decide(runId, "approved", preview)).status).toBe(409);
      expect(trello.writes()).toBe(1);
    } finally {
      await h.close();
    }
  }, 45_000);

  it("rejects approval replay from a fresh API instance using the same database", async () => {
    const h = await harness();
    let nextApi: ReturnType<typeof createApi> | undefined;
    let firstClosed = false;
    try {
      const runId = await h.create();
      const preview = (await h.detail(runId)).preview;
      const trello = mockTrello();
      expect((await h.decide(runId, "approved", preview)).status).toBe(200);
      expect(trello.writes()).toBe(1);

      await h.api.close();
      firstClosed = true;
      nextApi = createApi({
        db: h.fixture.db, config: h.fixture.config,
        pilotConfig: h.pilotConfig, pilotPolicy: h.pilotConfig,
        pilotLiveWriteEnabled: true,
      });
      const nextBase = await nextApi.listen();
      const login = await fetch(`${nextBase}/auth/login`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: h.fixture.email, password: h.fixture.password }),
      });
      expect(login.status).toBe(200);
      const { token } = await login.json() as { token: string };
      const nextPilotUrl = nextBase.replace(/\/api\/v1$/, "") + "/pilot/v2";
      const replay = await fetch(`${nextPilotUrl}/runs/${runId}/approve`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          decision: "approved", approvalId: preview.approvalId,
          versionId: preview.versionId, snapshotHash: preview.snapshotHash,
        }),
      });
      expect(replay.status).toBe(409);
      expect(trello.writes()).toBe(1);
      expect((await h.fixture.db.client`
        SELECT status FROM runs WHERE id = ${runId}`)[0]?.status).toBe("succeeded");
    } finally {
      await nextApi?.close();
      if (!firstClosed) await h.api.close();
      await h.fixture.close();
    }
  }, 45_000);

  it("conceals operator A's run and approval from another permitted operator", async () => {
    const h = await harness(true, true);
    try {
      const runId = await h.create();
      const preview = (await h.detail(runId)).preview;
      const otherHeaders = await h.otherHeaders();
      const trello = mockTrello();
      const read = await fetch(`${h.pilotUrl}/runs/${runId}`, { headers: otherHeaders });
      const approve = await fetch(`${h.pilotUrl}/runs/${runId}/approve`, {
        method: "POST", headers: otherHeaders,
        body: JSON.stringify({
          decision: "approved", approvalId: preview.approvalId,
          versionId: preview.versionId, snapshotHash: preview.snapshotHash,
        }),
      });
      expect(read.status).toBe(404);
      expect(approve.status, await approve.text()).toBe(404);
      expect(trello.writes()).toBe(0);
      expect((await h.detail(runId)).status).toBe("awaiting_approval");
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
});
