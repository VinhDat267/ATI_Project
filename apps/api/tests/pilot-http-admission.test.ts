import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@wap/db";
import { createApi, type ApiConfig, type ApiRuntime } from "../src/app.js";
import { hashPassword } from "../src/auth.js";
import {
  PILOT_TOOL_CATALOG,
  type PilotConfig,
  type PilotPolicy,
  type ReadSheetsRequestResult,
} from "@wap/engine";
import { buildPilotApproval } from "../src/pilot-approval.js";

const USER_A = "00000000-0000-4000-8000-000000000001";
const USER_B = "00000000-0000-4000-8000-000000000002";
const STRANGER = "00000000-0000-4000-8000-000000000099";
const VERSION_ID = "11111111-2222-4444-8888-000000000002";
const APPROVAL_ID = "11111111-2222-4444-8888-000000000003";

const openApis = new Set<ApiRuntime>();

afterEach(async () => {
  for (const api of openApis) await api.close();
  openApis.clear();
  vi.restoreAllMocks();
});

const testPolicy: PilotPolicy = {
  enabled: true,
  principals: [USER_A, USER_B],
  spreadsheetId: "sheet-abc",
  tabId: "tab-1",
  boardId: "board-xyz",
};

const testConfig: PilotConfig = {
  enabled: true,
  principals: [USER_A, USER_B],
  spreadsheetId: "sheet-abc",
  tabId: "tab-1",
  boardId: "board-xyz",
  google: { apiKey: "key-123" },
  trello: { apiKey: "key-123", apiToken: "token-123", listId: "list-todo" },
};

const mockIntakeResult: ReadSheetsRequestResult = {
  row: {
    request_id: "REQ-101",
    client_ref: "Client Alpha",
    request_type: "web_change",
    raw_request: "Update banner image",
    deliverable: "New banner",
    due_date: "2026-10-15",
    decision_status: "confirmed",
    source_note: "",
  },
  checklist: {
    status: "pass",
    unconfirmedBusiness: false,
    missingFields: [],
    conflicts: [],
    evidencePositions: {},
    summary: "Intake valid",
    checklistVersion: "pilot-checklist-v1",
    sourceRevision: "r".repeat(64),
  },
  sourceKey: "source-key-101",
  sourceRevision: "r".repeat(64),
};

async function createTestApi(options?: {
  activeRunExists?: boolean;
  intakeResult?: ReadSheetsRequestResult;
  pilotPolicy?: PilotPolicy | null;
  pilotConfig?: PilotConfig | null;
  pilotLiveWriteEnabled?: boolean;
  trelloLists?: Array<{ id: string; name: string; closed: boolean }>;
}) {
  const config: ApiConfig = {
    host: "127.0.0.1",
    port: 0,
    userId: USER_A,
    email: "operator-a@example.local",
    passwordHash: await hashPassword("password-a"),
    sessionTtlMs: 60_000,
    cursorKey: Buffer.alloc(32, 11),
    plannerMode: "disabled",
  };

  const runsDb: Array<{
    id: string;
    user_id: string;
    profile: string;
    status: string;
    created_at: Date;
    workflow_version_id: string;
  }> = [];

  const snapshotsDb: Array<{
    run_id: string;
    source_key: string;
    source_revision: string;
    raw_data: Record<string, string>;
    checklist_result: Record<string, unknown>;
  }> = [];
  const approvalsDb: Array<{
    id: string;
    run_id: string;
    owner_id: string;
    version_id: string;
    snapshot_hash: string;
    decision: string;
    expires_at: Date;
  }> = [];

  const sqlFn = async (strings: TemplateStringsArray, ...values: any[]) => {
    const sql = strings.join("?");
    if (/SELECT\s+plan\s+FROM\s+workflow_versions/i.test(sql)) {
      return [{ plan: { targetListName: "To Do" } }];
    }
    if (/FROM\s+runs\s+WHERE\s+id\s*=/i.test(sql)) {
      const runId = values[0];
      const userId = values[1];
      const found = runsDb.filter((r) => r.id === runId && r.user_id === userId);
      return found;
    }
    if (/FROM\s+source_snapshots\s+WHERE\s+run_id\s*=/i.test(sql)) {
      const runId = values[0];
      const found = snapshotsDb.filter((s) => s.run_id === runId);
      return found;
    }
    if (/FROM\s+pilot_approvals\s+WHERE\s+run_id\s*=/i.test(sql)) {
      return approvalsDb.filter((a) => a.run_id === values[0] && a.owner_id === values[1])
        .map((a) => ({ ...a, live: a.expires_at.getTime() > Date.now() }));
    }
    if (/UPDATE\s+runs\s+SET\s+status\s*=/i.test(sql)) {
      const literalStatus = sql.match(/SET\s+status\s*=\s*'([^']+)'/i)?.[1];
      const status = literalStatus ?? values[0];
      const runId = literalStatus ? values[0] : values[1];
      const found = runsDb.find((r) => r.id === runId);
      if (found) found.status = status;
      return [];
    }
    if (/UPDATE\s+pilot_approvals\s+SET\s+decision\s*=/i.test(sql)) {
      const decision = sql.match(/SET\s+decision\s*=\s*'([^']+)'/i)?.[1];
      const found = approvalsDb.find((a) => a.run_id === values[0]);
      if (found && decision) found.decision = decision;
      return [];
    }
    if (/FROM\s+business_reservations\s+WHERE\s+intent_key\s*=/i.test(sql)) {
      return [];
    }
    return [];
  };

  const mockClient = Object.assign(sqlFn, {
    begin: async (fn: (tx: any) => Promise<any>) => {
      const tx = Object.assign(
        async (strings: TemplateStringsArray, ...values: any[]) => {
          const sql = strings.join("?");
          if (sql.includes("pg_advisory_xact_lock")) {
            return [];
          }
          if (sql.includes("SELECT 1 FROM runs")) {
            if (options?.activeRunExists) return [{ 1: 1 }];
            const active = runsDb.filter(
              (r) =>
                ![
                  "succeeded",
                  "failed",
                  "rejected",
                  "cancelled",
                  "expired",
                  "refused",
                  "needs_input",
                  "reconciliation_required",
                ].includes(r.status),
            );
            return active.length > 0 ? [{ 1: 1 }] : [];
          }
          if (sql.includes("INSERT INTO workflows")) {
            return [];
          }
          if (sql.includes("INSERT INTO runs")) {
            runsDb.push({
              id: values[0],
              user_id: values[1],
              profile: "pilot-v2",
              status: values[8],
              created_at: new Date(),
              workflow_version_id: values[3],
            });
            return [];
          }
          if (sql.includes("INSERT INTO source_snapshots")) {
            snapshotsDb.push({
              run_id: values[0],
              source_key: values[1],
              source_revision: values[2],
              raw_data: values[3],
              checklist_result: values[5],
            });
            return [];
          }
          if (sql.includes("INSERT INTO pilot_approvals")) {
            const run = runsDb.find((r) => r.id === values[0]);
            approvalsDb.push({
              id: APPROVAL_ID,
              run_id: values[0], owner_id: values[1], version_id: values[2], snapshot_hash: values[3],
              decision: "pending",
              expires_at: new Date((run?.created_at.getTime() ?? Date.now()) + 600_000),
            });
            return [];
          }
          if (sql.includes("INSERT INTO run_events")) {
            return [];
          }
          return sqlFn(strings, ...values);
        },
        {
          json: (val: any) => val,
        },
      );
      return fn(tx);
    },
  });

  const mockDb = {
    client: mockClient as any,
  } as Database;

  const api = createApi({
    db: mockDb,
    config,
    principalExists: async () => true,
    pilotPolicy: options?.pilotPolicy === null ? undefined : options?.pilotPolicy ?? testPolicy,
    pilotConfig: options?.pilotConfig === null ? undefined : options?.pilotConfig ?? testConfig,
    pilotLiveWriteEnabled: options?.pilotLiveWriteEnabled ?? true,
    readSheetsRequestFn: async () => options?.intakeResult ?? mockIntakeResult,
    readTrelloListsFn: async () => options?.trelloLists ?? [{ id: "list-todo", name: "To Do", closed: false }],
    pilotRouter: undefined, // uses createPilotRouter
  });

  openApis.add(api);
  const baseUrl = await api.listen();

  // Login as USER_A
  const loginA = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: config.email, password: "password-a" }),
  });
  const { token: tokenA } = (await loginA.json()) as { token: string };
  const pilotUrl = baseUrl.replace(/\/api\/v1$/, "") + "/pilot/v2";

  return { baseUrl, pilotUrl, tokenA, runsDb, snapshotsDb, approvalsDb };
}

describe("Pilot V2 API Admission & Router Integration (BE-19)", () => {
  const closedCases: Array<[{ pilotPolicy?: PilotPolicy | null; pilotConfig?: PilotConfig | null }, string]> = [
    [{ pilotPolicy: null }, "missing policy"],
    [{ pilotConfig: null }, "missing config"],
    [{ pilotConfig: { ...testConfig, enabled: false } }, "disabled config"],
    [{ pilotPolicy: { ...testPolicy, enabled: false } }, "disabled policy"],
  ];
  it.each(closedCases)("fails closed with %s (%s)", async (options, _label) => {
    const { pilotUrl, tokenA } = await createTestApi(options);
    const response = await fetch(`${pilotUrl}/catalog`, {
      headers: { authorization: `Bearer ${tokenA}` },
  });
    expect(response.status).toBe(403);
    });

  it("GET /pilot/v2/catalog returns 200 with reviewed pilot catalog", async () => {
    const { pilotUrl, tokenA } = await createTestApi();

    const response = await fetch(`${pilotUrl}/catalog`, {
      headers: { authorization: `Bearer ${tokenA}` },
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.profile).toBe("pilot-v2");
    expect(data.tools).toHaveLength(PILOT_TOOL_CATALOG.length);
    expect(data.tools[0]!.name).toBe(PILOT_TOOL_CATALOG[0]!.name);
  });

  it("GET /pilot/v2/catalog without authentication returns 401", async () => {
    const { pilotUrl } = await createTestApi();

    const response = await fetch(`${pilotUrl}/catalog`);
    expect(response.status).toBe(401);
  });

  it("GET /pilot/v2/catalog with unauthorized principal returns 403", async () => {
    // Policy does NOT include USER_A
    const disabledPolicy: PilotPolicy = {
      ...testPolicy,
      principals: [STRANGER],
    };
    const { pilotUrl, tokenA } = await createTestApi({ pilotPolicy: disabledPolicy });

    const response = await fetch(`${pilotUrl}/catalog`, {
      headers: { authorization: `Bearer ${tokenA}` },
    });

    expect(response.status).toBe(403);
  });

  it("POST /pilot/v2/runs creates a new run with intake and returns 202", async () => {
    const { pilotUrl, tokenA, runsDb, snapshotsDb } = await createTestApi();

    const createRes = await fetch(`${pilotUrl}/runs`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokenA}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        spreadsheetId: "sheet-abc",
        tabId: "tab-1",
        requestId: "REQ-101",
        userPrompt: "Create trello task for client request",
      }),
    });

    expect(createRes.status).toBe(202);
    const result = await createRes.json();
    expect(result.status).toBe("planning");
    expect(result.profile).toBe("pilot-v2");
    expect(result.runId).toBeDefined();

    expect(runsDb).toHaveLength(1);
    expect(runsDb[0]!.id).toBe(result.runId);
    expect(snapshotsDb).toHaveLength(1);
    expect(snapshotsDb[0]!.run_id).toBe(result.runId);
  });

  it("does not create a run when the configured Trello list is closed", async () => {
    const { pilotUrl, tokenA, runsDb, snapshotsDb } = await createTestApi({
      trelloLists: [{ id: "list-todo", name: "Cần làm", closed: true }],
    });
    const response = await fetch(`${pilotUrl}/runs`, {
      method: "POST",
      headers: { authorization: `Bearer ${tokenA}`, "content-type": "application/json" },
      body: JSON.stringify({ spreadsheetId: "sheet-abc", tabId: "tab-1", requestId: "REQ-101", userPrompt: "Create reviewed card" }),
    });
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("TARGET_LIST_UNAVAILABLE");
    expect(runsDb).toHaveLength(0);
    expect(snapshotsDb).toHaveLength(0);
  });

  it("does not create a run when the target list ID has surrounding whitespace", async () => {
    const config = { ...testConfig, trello: { ...testConfig.trello!, listId: " list-todo " } };
    const { pilotUrl, tokenA, runsDb } = await createTestApi({ pilotConfig: config });
    const response = await fetch(`${pilotUrl}/runs`, {
      method: "POST",
      headers: { authorization: `Bearer ${tokenA}`, "content-type": "application/json" },
      body: JSON.stringify({ spreadsheetId: "sheet-abc", tabId: "tab-1", requestId: "REQ-101", userPrompt: "Create reviewed card" }),
    });
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("TARGET_NOT_BOUND");
    expect(runsDb).toHaveLength(0);
  });

  it("blocks approval when the durable approval row is missing", async () => {
    const { pilotUrl, tokenA, runsDb } = await createTestApi();
    const runId = "11111111-2222-4444-8888-999999999998";
    runsDb.push({
      id: runId, user_id: USER_A, profile: "pilot-v2",
      status: "awaiting_approval", created_at: new Date(), workflow_version_id: VERSION_ID,
    });
    const response = await fetch(`${pilotUrl}/runs/${runId}/approve`, {
      method: "POST",
      headers: { authorization: `Bearer ${tokenA}`, "content-type": "application/json" },
      body: JSON.stringify({
        decision: "approved", approvalId: APPROVAL_ID, versionId: VERSION_ID,
        snapshotHash: "r".repeat(64),
      }),
    });
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("APPROVAL_NOT_PENDING");
    expect(runsDb[0]?.status).toBe("awaiting_approval");
  });

  it("POST /pilot/v2/runs returns 409 ACTIVE_RUN when another run is currently active", async () => {
    const { pilotUrl, tokenA } = await createTestApi({ activeRunExists: true });

    const createRes = await fetch(`${pilotUrl}/runs`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokenA}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        spreadsheetId: "sheet-abc",
        tabId: "tab-1",
        requestId: "REQ-101",
        userPrompt: "Try creating run while another is active",
      }),
    });

    expect(createRes.status).toBe(409);
    const errorData = await createRes.json();
    expect(errorData.error.code).toBe("ACTIVE_RUN");
  });

  it("GET /pilot/v2/runs/:runId enforces strict ownership privacy (404 for non-owner)", async () => {
    const { pilotUrl, tokenA, runsDb } = await createTestApi();

    const strangerRunId = "11111111-2222-4444-8888-999999999999";
    // Place a run belonging to USER_B in DB
    runsDb.push({
      id: strangerRunId,
      user_id: USER_B,
      profile: "pilot-v2",
      status: "awaiting_approval",
      created_at: new Date(),
      workflow_version_id: VERSION_ID,
    });

    // USER_A requests USER_B's run
    const res = await fetch(`${pilotUrl}/runs/${strangerRunId}`, {
      headers: { authorization: `Bearer ${tokenA}` },
    });

    expect(res.status).toBe(404);
  });

  it("GET /pilot/v2/runs/:runId returns 200 with normalized checklist and fixed TTL preview for owner", async () => {
    const { pilotUrl, tokenA, runsDb, snapshotsDb, approvalsDb } = await createTestApi();

    const ownRunId = "11111111-2222-4444-8888-000000000001";
    const runCreatedAt = new Date();
    runsDb.push({
      id: ownRunId,
      user_id: USER_A,
      profile: "pilot-v2",
      status: "awaiting_approval",
      created_at: runCreatedAt,
      workflow_version_id: VERSION_ID,
    });

    snapshotsDb.push({
      run_id: ownRunId,
      source_key: "source-key-101",
      source_revision: "r".repeat(64),
      raw_data: { ...mockIntakeResult.row, deliverable: "Website update", raw_request: "Update home page" },
      checklist_result: {
        status: "pass",
        unconfirmedBusiness: false,
        missingFields: [],
        evidencePositions: { due_date: "row-2-col-6" },
        summary: "Valid",
      },
    });

    const snapshotHash = buildPilotApproval({
      runId: ownRunId, ownerId: USER_A, versionId: VERSION_ID, sourceKey: "source-key-101",
      sourceRevision: "r".repeat(64),
      row: snapshotsDb[0]!.raw_data as typeof mockIntakeResult.row,
      policy: testPolicy, targetListId: testConfig.trello!.listId!, targetListName: "To Do",
    }).snapshotHash;
    approvalsDb.push({
      id: APPROVAL_ID, run_id: ownRunId, owner_id: USER_A, version_id: VERSION_ID,
      snapshot_hash: snapshotHash,
      decision: "pending", expires_at: new Date(runCreatedAt.getTime() + 600_000),
    });

    const res = await fetch(`${pilotUrl}/runs/${ownRunId}`, {
      headers: { authorization: `Bearer ${tokenA}` },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(ownRunId);
    expect(data.status).toBe("awaiting_approval");
    expect(data.checklistResult.valid).toBe(true);
    expect(data.checklistResult.unconfirmedBusiness).toBe(false);
    expect(data.preview).toBeDefined();
    expect(data.preview.snapshotHash).toBe(snapshotHash);
    expect(data.preview.actions).toHaveLength(1);
    expect(data.preview.actions[0].tool).toBe("trello.create_card");

    // Verify fixed expiresAt bound to run.created_at + 10 min
    const expectedExpiry = new Date(runCreatedAt.getTime() + 10 * 60 * 1000).toISOString();
    expect(data.preview.expiresAt).toBe(expectedExpiry);
  });
});
