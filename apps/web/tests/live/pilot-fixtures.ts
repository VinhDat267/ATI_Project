import { test as base, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createApi } from "../../../api/src/app.js";
import type { SessionAuthority, SessionInput, SessionMetadata } from "../../../api/src/auth.js";
import { makeApiFixture } from "../../../api/tests/fixture.js";
import {
  evaluateChecklist,
  sourceKey,
  type PilotConfig,
  type PilotPolicy,
  type SourceRow,
} from "@wap/engine";
import { createLiveFixture, safeTeardown, type LiveFixtureContext } from "./cleanup.js";

const sourceRow: SourceRow = {
  request_id: "REQ-2026-0922-01",
  client_ref: "Browser test",
  request_type: "web_change",
  raw_request: "Update /landing page for browser acceptance",
  deliverable: "Landing page update",
  due_date: "2026-10-15",
  decision_status: "confirmed",
  source_note: "Browser acceptance fixture",
};

export interface PilotLiveContext extends LiveFixtureContext {
  externalRequests: string[];
  trelloPosts: string[];
  ownerB: { userId: string; email: string; password: string };
}

const OWNER_B_ID = "00000000-0000-4000-8000-000000000002";
const OWNER_B_EMAIL = "owner-b@browser.local";
const OWNER_B_PASSWORD = "owner-b-browser-fixture";

async function createPilotLiveFixture(writeEnabled: boolean): Promise<PilotLiveContext> {
  const externalRequests: string[] = [];
  const trelloPosts: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (!url.startsWith("https://")) return realFetch(input, init);
    externalRequests.push(`${init?.method ?? "GET"} ${new URL(url).origin}${new URL(url).pathname}`);
    if (!writeEnabled || new URL(url).hostname !== "api.trello.com") {
      throw new Error(`Unexpected external request: ${new URL(url).origin}`);
    }
    if (init?.method === "POST" && new URL(url).pathname === "/1/cards") {
      trelloPosts.push(new URL(url).pathname);
      return new Response(JSON.stringify({
        id: "browser-fixture-card", url: "https://trello.com/c/browser-fixture-card",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if ((init?.method ?? "GET") === "GET" && new URL(url).pathname.endsWith("/lists")) {
      return new Response(JSON.stringify([{ id: "list-todo", name: "To Do", closed: false }]), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`Unexpected Trello request: ${new URL(url).pathname}`);
  };
  try {
    const fixture = await createLiveFixture({
      makeApiFixture: async () => {
        const baseApi = await makeApiFixture();
        const ownerAToken = randomBytes(32).toString("base64url");
        const ownerBToken = randomBytes(32).toString("base64url");
        const tokenOwners = new Map<string, string>([
          [ownerAToken, baseApi.userId],
          [ownerBToken, OWNER_B_ID],
        ]);
        const tokenFor = (userId: string): string => {
          if (userId === baseApi.userId) return ownerAToken;
          if (userId === OWNER_B_ID) return ownerBToken;
          throw new Error("Unknown browser fixture principal");
        };
        const sessionStore: SessionAuthority = {
          async login(email: string, password: string) {
            if (email === baseApi.email && password === baseApi.password)
              return ownerAToken;
            if (email === OWNER_B_EMAIL && password === OWNER_B_PASSWORD)
              return ownerBToken;
            throw new Error("Invalid browser fixture credentials");
          },
          async issue(userId: string, _metadata: SessionMetadata) {
            return tokenFor(userId);
          },
          authenticate(input: SessionInput) {
            const authorization = typeof input === "string"
              ? input
              : input?.authorization;
            const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization ?? "")?.[1];
            const userId = token ? tokenOwners.get(token) : undefined;
            if (!userId) throw new Error("Authentication required");
            return userId;
          },
          revoke(input: SessionInput) {
            const authorization = typeof input === "string"
              ? input
              : input?.authorization;
            const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization ?? "")?.[1];
            if (!token || !tokenOwners.delete(token))
              throw new Error("Authentication required");
          },
        };
        const policy: PilotPolicy = {
          enabled: true,
          principals: [baseApi.userId, OWNER_B_ID],
          spreadsheetId: "sheet-pilot-001",
          tabId: "tab-001",
          boardId: "board-pilot",
        };
        const pilotConfig: PilotConfig = {
          ...policy,
          google: { apiKey: "fixture-google" },
          trello: {
            apiKey: "fixture-trello",
            apiToken: "fixture-token",
            listId: "list-todo",
          },
        };
        const checklist = evaluateChecklist(sourceRow);
        const pilotApi = createApi({
          db: baseApi.db,
          config: baseApi.config,
          sessionStore,
          identityLookup: async (userId) => {
            if (userId === OWNER_B_ID) {
              return {
                user_id: OWNER_B_ID,
                email: OWNER_B_EMAIL,
                display_name: "Browser owner B",
                roles: ["user"],
              };
            }
            const rows = await baseApi.db.client<Array<{
              id: string; email: string; display_name: string | null; roles: string[];
            }>>`SELECT id,email,display_name,roles FROM users WHERE id=${userId}`;
            const user = rows[0];
            if (!user) throw new Error("Authentication principal not found");
            return {
              user_id: user.id,
              email: user.email,
              display_name: user.display_name,
              roles: user.roles?.length
                ? user.roles.filter((role): role is "user" | "operator" => role === "user" || role === "operator")
                : ["user"],
            };
          },
          pilotConfig,
          pilotPolicy: policy,
          pilotLiveWriteEnabled: writeEnabled,
          readSheetsRequestFn: async () => ({
            row: sourceRow,
            checklist,
            sourceKey: sourceKey({
              groupId: policy.boardId,
              spreadsheetId: policy.spreadsheetId,
              tabId: policy.tabId,
              requestId: sourceRow.request_id,
            }),
            sourceRevision: checklist.sourceRevision,
          }),
        });
        let pilotUrl: string;
        try {
          pilotUrl = await pilotApi.listen();
        } catch (error) {
          await baseApi.close();
          throw error;
        }
        return {
          ...baseApi,
          baseUrl: pilotUrl,
          close: async () => {
            await pilotApi.close();
            await baseApi.close();
          },
        };
      },
    });
    return {
      ...fixture,
      externalRequests,
      trelloPosts,
      ownerB: { userId: OWNER_B_ID, email: OWNER_B_EMAIL, password: OWNER_B_PASSWORD },
    };
  } catch (error) {
    globalThis.fetch = realFetch;
    throw error;
  }
}

async function usePilotContext(
  writeEnabled: boolean,
  use: (context: PilotLiveContext) => Promise<void>,
): Promise<void> {
  const realFetch = globalThis.fetch;
  const fixture = await createPilotLiveFixture(writeEnabled);
  try {
    await use(fixture);
  } finally {
    try {
      await safeTeardown(fixture);
    } finally {
      globalThis.fetch = realFetch;
    }
  }
}

export const test = base.extend<{
  pilotContext: PilotLiveContext;
  pilotWriteContext: PilotLiveContext;
}>({
  pilotContext: async ({}, use) => {
    await usePilotContext(false, use);
  },
  pilotWriteContext: async ({}, use) => {
    await usePilotContext(true, use);
  },
});

export { expect };
