import { randomUUID } from "node:crypto";
import { test as base, expect } from "@playwright/test";
import { createApi } from "../../../api/src/app.js";
import { makeApiFixture } from "../../../api/tests/fixture.js";
import type { Database } from "@wap/db";
import {
  evaluateChecklist,
  sourceKey,
  createIntentKey,
  PostgresReservationStore,
  type PilotConfig,
  type PilotPolicy,
  type SourceRow,
} from "@wap/engine";
import { createLiveFixture, safeTeardown, type LiveFixtureContext } from "./cleanup.js";

export const UC1_REQUEST_ID = "REQ-2026-0922-05";
export const UC3_REQUEST_ID = "REQ-2026-0922-03";
export const UC3_CARD_ID = "trello-card-123";
export const UC3_CARD_URL = `https://trello.com/c/${UC3_CARD_ID}`;
export const UC3_CARD_TITLE = "Current Trello title from fixture";

const policy: PilotPolicy = {
  enabled: true,
  principals: ["00000000-0000-4000-8000-000000000001"],
  spreadsheetId: "sheet-pilot-001",
  tabId: "tab-001",
  boardId: "board-pilot",
};

const sourceRows = new Map<string, SourceRow>([
  [UC1_REQUEST_ID, {
    request_id: UC1_REQUEST_ID,
    client_ref: "UC1 browser fixture",
    request_type: "design_asset",
    raw_request: "Create a 1200x600 campaign banner",
    deliverable: "Campaign banner",
    due_date: "",
    decision_status: "confirmed",
    source_note: "Missing due date exercises clarification",
  }],
  [UC3_REQUEST_ID, {
    request_id: UC3_REQUEST_ID,
    client_ref: "UC3 browser fixture",
    request_type: "web_change",
    raw_request: "Look up the existing card at /landing",
    deliverable: "Landing page update",
    due_date: "2026-11-30",
    decision_status: "confirmed",
    source_note: "Linked card lookup fixture",
  }],
]);

export interface PilotUseCaseContext extends LiveFixtureContext {
  externalRequests: string[];
  trelloPosts: string[];
  seedConfirmedLookupReservation(): Promise<{ runId: string; token: string }>;
}

async function createPilotUseCaseFixture(): Promise<PilotUseCaseContext> {
  const externalRequests: string[] = [];
  const trelloPosts: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (!url.startsWith("https://")) return realFetch(input, init);
    const parsed = new URL(url);
    const method = init?.method ?? "GET";
    externalRequests.push(`${method} ${parsed.origin}${parsed.pathname}`);
    if (parsed.hostname !== "api.trello.com") {
      throw new Error(`Unexpected external request: ${parsed.origin}`);
    }
    if (method === "POST") {
      trelloPosts.push(`${method} ${parsed.pathname}`);
      throw new Error("UC1/UC3 must not issue Trello writes");
    }
    if (method === "GET" && parsed.pathname === `/1/cards/${UC3_CARD_ID}`) {
      return new Response(JSON.stringify({
        id: UC3_CARD_ID,
        idBoard: policy.boardId,
        name: UC3_CARD_TITLE,
        desc: "Current card description from Trello",
        idList: "list-current",
        due: "2026-11-30T00:00:00.000Z",
        idMembers: ["member-fixture"],
        url: UC3_CARD_URL,
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected Trello read: ${parsed.pathname}`);
  };

  try {
    const fixture = await createLiveFixture({
      makeApiFixture: async () => {
        const baseApi = await makeApiFixture();
        const pilotConfig: PilotConfig = {
          ...policy,
          google: { apiKey: "fixture-google" },
          trello: {
            apiKey: "fixture-trello",
            apiToken: "fixture-token",
            listId: "list-todo",
          },
        };
        const pilotApi = createApi({
          db: baseApi.db,
          config: baseApi.config,
          pilotConfig,
          pilotPolicy: policy,
          pilotLiveWriteEnabled: false,
          readSheetsRequestFn: async ({ spreadsheetId, tabId, requestId }) => {
            if (spreadsheetId !== policy.spreadsheetId || tabId !== policy.tabId)
              throw new Error("Source is not allowlisted");
            const row = sourceRows.get(requestId);
            if (!row) throw new Error("Source request was not found");
            const checklist = evaluateChecklist(row);
            return {
              row,
              checklist,
              sourceKey: sourceKey({
                groupId: policy.boardId,
                spreadsheetId,
                tabId,
                requestId,
              }),
              sourceRevision: checklist.sourceRevision,
            };
          },
          readTrelloListsFn: async () => [{ id: "list-todo", name: "To Do", closed: false }],
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
      async seedConfirmedLookupReservation() {
        const apiUrl = fixture.api.baseUrl;
        const pilotUrl = apiUrl.replace(/\/api\/v1$/, "/pilot/v2");
        const login = await fetch(`${apiUrl}/auth/login`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: fixture.email, password: fixture.password }),
        });
        if (login.status !== 200) throw new Error(`Fixture login failed: ${login.status}`);
        const { token } = await login.json() as { token: string };
        const created = await fetch(`${pilotUrl}/runs`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            spreadsheetId: policy.spreadsheetId,
            tabId: policy.tabId,
            requestId: UC3_REQUEST_ID,
            userPrompt: "Look up the existing confirmed card",
          }),
        });
        if (created.status !== 202)
          throw new Error(`Fixture run creation failed: ${created.status}`);
        const { runId } = await created.json() as { runId: string };
        const source = sourceRows.get(UC3_REQUEST_ID)!;
        const identity = {
          groupId: policy.boardId,
          spreadsheetId: policy.spreadsheetId,
          tabId: policy.tabId,
          requestId: source.request_id,
        };
        const intentKey = createIntentKey(identity, policy.boardId);
        const reservations = new PostgresReservationStore(
          fixture.api.db! as unknown as Database,
        );
        await reservations.reserve({
          intentKey,
          sourceKey: sourceKey(identity),
          boardId: policy.boardId,
          runId,
        });
        await reservations.claimDispatched(intentKey, randomUUID());
        await reservations.confirm(intentKey, UC3_CARD_ID, UC3_CARD_URL, "list-current");
        return { runId, token };
      },
    };
  } catch (error) {
    globalThis.fetch = realFetch;
    throw error;
  }
}

async function usePilotUseCaseContext(
  use: (context: PilotUseCaseContext) => Promise<void>,
): Promise<void> {
  const realFetch = globalThis.fetch;
  const fixture = await createPilotUseCaseFixture();
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

export const test = base.extend<{ pilotUseCaseContext: PilotUseCaseContext }>({
  pilotUseCaseContext: async ({}, use) => {
    await usePilotUseCaseContext(use);
  },
});

export { expect };
