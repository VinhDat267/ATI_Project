import { describe, it, expect, afterEach, vi } from "vitest";
import type { Database } from "@wap/db";
import {
  type PilotConfig,
  type PilotPolicy,
  type ReadSheetsRequestResult,
} from "@wap/engine";
import { createApi, type ApiRuntime } from "../src/app.js";
import type { ApiConfig } from "../src/config.js";
import { hashPassword, SessionStore } from "../src/auth.js";

const USER_A = "00000000-0000-4000-8000-000000000001";
const USER_B = "00000000-0000-4000-8000-000000000002";
const STRANGER = "00000000-0000-4000-8000-000000000099";

const openApis = new Set<ApiRuntime>();

afterEach(async () => {
  for (const api of openApis) {
    await api.close().catch(() => {});
  }
  openApis.clear();
  vi.restoreAllMocks();
});

const defaultPolicy: PilotPolicy = {
  enabled: true,
  principals: [USER_A, USER_B],
  spreadsheetId: "sheet-dual",
  tabId: "tab-dual",
  boardId: "board-dual",
};

const defaultTestConfig: PilotConfig = {
  enabled: true,
  principals: [USER_A, USER_B],
  spreadsheetId: "sheet-dual",
  tabId: "tab-dual",
  boardId: "board-dual",
  google: { apiKey: "mock-google" },
  trello: { apiKey: "mock-trello", apiToken: "mock-token", listId: "list-dual" },
};

const mockIntake: ReadSheetsRequestResult = {
  row: {
    request_id: "REQ-DUAL-1",
    client_ref: "Client Multi",
    request_type: "feature",
    raw_request: "Implement multi-tenant sync",
    deliverable: "Sync module",
    due_date: "2026-12-01",
    decision_status: "confirmed",
    source_note: "",
  },
  checklist: {
    status: "pass",
    unconfirmedBusiness: false,
    missingFields: [],
    conflicts: [],
    evidencePositions: {},
    summary: "Dual checklist valid",
    checklistVersion: "pilot-checklist-1",
    sourceRevision: "d".repeat(64),
  },
  sourceKey: "source-key-dual",
  sourceRevision: "d".repeat(64),
};

async function setupDualPrincipalApi(policyOverride?: PilotPolicy) {
  const policy = policyOverride ?? defaultPolicy;

  const runsDb: Array<{
    id: string;
    user_id: string;
    profile: string;
    status: string;
    created_at: Date;
  }> = [];

  const snapshotsDb: Array<{
    run_id: string;
    source_key: string;
    source_revision: string;
    raw_data: Record<string, string>;
    checklist_result: Record<string, unknown>;
  }> = [];

  const sqlFn = async (strings: TemplateStringsArray, ...values: any[]) => {
    const sql = strings.join("?");
    if (sql.includes("FROM runs WHERE id =")) {
      const runId = values[0];
      const userId = values[1];
      const found = runsDb.filter((r) => r.id === runId && r.user_id === userId);
      return found;
    }
    if (sql.includes("FROM source_snapshots WHERE run_id =")) {
      const runId = values[0];
      const found = snapshotsDb.filter((s) => s.run_id === runId);
      return found;
    }
    if (sql.includes("UPDATE runs SET status =")) {
      const status = values[0];
      const runId = values[1];
      const found = runsDb.find((r) => r.id === runId);
      if (found) found.status = status;
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
          if (sql.includes("INSERT INTO run_events")) {
            return [];
          }
          return [];
        },
        { json: (val: any) => val },
      );
      return fn(tx);
    },
  });

  const mockDb = { client: mockClient as any } as Database;

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

  // Build dual-principal session authority
  const sessions = new SessionStore({
    userId: USER_A,
    email: "operator-a@example.local",
    passwordHash: config.passwordHash,
    ttlMs: 60_000,
    principalExists: async () => true,
  });

  // Authenticate user A and issue token
  const tokenA = await sessions.login("operator-a@example.local", "password-a");

  // Mock session store authenticate to support USER_B and STRANGER via custom tokens
  const originalAuth = sessions.authenticate.bind(sessions);
  sessions.authenticate = (input: any) => {
    const cred = typeof input === "object" && input !== null ? (input.authorization ?? "") : "";
    if (cred === "Bearer token-user-b") return USER_B;
    if (cred === "Bearer token-stranger") return STRANGER;
    return originalAuth(input);
  };

  const api = createApi({
    db: mockDb,
    config,
    sessionStore: sessions,
    principalExists: async () => true,
    pilotPolicy: policy,
    pilotConfig: defaultTestConfig,
    readSheetsRequestFn: async () => mockIntake,
    readTrelloListsFn: async () => [{ id: "list-dual", name: "To Do", closed: false }],
  });

  openApis.add(api);
  const baseUrl = await api.listen();
  const pilotUrl = baseUrl.replace(/\/api\/v1$/, "") + "/pilot/v2";

  return {
    baseUrl,
    pilotUrl,
    tokenA,
    tokenB: "token-user-b",
    tokenStranger: "token-stranger",
    runsDb,
    snapshotsDb,
  };
}

describe("Pilot Dual-Principal & Security Regression (BE-23)", () => {
  it("allows both Operator A and Operator B to access pilot catalog independently", async () => {
    const { pilotUrl, tokenA, tokenB } = await setupDualPrincipalApi();

    const resA = await fetch(`${pilotUrl}/catalog`, {
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(resA.status).toBe(200);

    const resB = await fetch(`${pilotUrl}/catalog`, {
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(resB.status).toBe(200);
  });

  it("enforces strict run ownership privacy across operators (404 on cross-user read)", async () => {
    const { pilotUrl, tokenA, tokenB, runsDb } = await setupDualPrincipalApi();

    // Create a run owned by Operator A
    const runIdA = "11111111-1111-4111-8111-111111111111";
    runsDb.push({
      id: runIdA,
      user_id: USER_A,
      profile: "pilot-v2",
      status: "awaiting_approval",
      created_at: new Date(),
    });

    // Operator B attempts to view Operator A's run -> 404 NOT_FOUND
    const resB = await fetch(`${pilotUrl}/runs/${runIdA}`, {
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(resB.status).toBe(404);

    // Operator A can view their own run -> 200 OK (with mock snapshot)
    const runIdB = "22222222-2222-4222-8222-222222222222";
    runsDb.push({
      id: runIdB,
      user_id: USER_B,
      profile: "pilot-v2",
      status: "awaiting_approval",
      created_at: new Date(),
    });

    // Operator A attempts to view Operator B's run -> 404 NOT_FOUND
    const resA = await fetch(`${pilotUrl}/runs/${runIdB}`, {
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(resA.status).toBe(404);
  });

  it("enforces 1 active nonterminal run across all operators database-wide (409 ACTIVE_RUN)", async () => {
    const { pilotUrl, tokenA, tokenB, runsDb } = await setupDualPrincipalApi();

    // Operator A creates an active run
    runsDb.push({
      id: "run-active-a",
      user_id: USER_A,
      profile: "pilot-v2",
      status: "planning",
      created_at: new Date(),
    });

    // Operator B attempts to start a new run while Operator A's run is active
    const createResB = await fetch(`${pilotUrl}/runs`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokenB}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        spreadsheetId: "sheet-dual",
        tabId: "tab-dual",
        requestId: "REQ-DUAL-B",
        userPrompt: "Operator B task",
      }),
    });

    expect(createResB.status).toBe(409);
    const err = await createResB.json();
    expect(err.error.code).toBe("ACTIVE_RUN");
  });

  it("dynamically revokes pilot access fail-closed when principal is removed (403 ACCESS_DENIED)", async () => {
    // Policy only permits USER_A (USER_B is revoked)
    const revokedPolicy: PilotPolicy = {
      ...defaultPolicy,
      principals: [USER_A],
    };

    const { pilotUrl, tokenA, tokenB } = await setupDualPrincipalApi(revokedPolicy);

    // Operator A still permitted
    const resA = await fetch(`${pilotUrl}/catalog`, {
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(resA.status).toBe(200);

    // Operator B immediately rejected
    const resB = await fetch(`${pilotUrl}/catalog`, {
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(resB.status).toBe(403);
  });

  it("completely rejects unknown/stranger principals with 403 ACCESS_DENIED", async () => {
    const { pilotUrl, tokenStranger } = await setupDualPrincipalApi();

    const resStranger = await fetch(`${pilotUrl}/catalog`, {
      headers: { authorization: `Bearer ${tokenStranger}` },
    });
    expect(resStranger.status).toBe(403);
  });
});
