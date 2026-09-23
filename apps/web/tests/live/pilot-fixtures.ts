import { test as base, expect } from "@playwright/test";
import { createApi } from "../../../api/src/app.js";
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
}

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
        const policy: PilotPolicy = {
          enabled: true,
          principals: [baseApi.userId],
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
    return { ...fixture, externalRequests, trelloPosts };
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
