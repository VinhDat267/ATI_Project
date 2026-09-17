import { afterEach, describe, expect, it } from "vitest";
import type { Database } from "@wap/db";
import { WorkflowEngine, type Gateway, type EngineTool } from "@wap/engine";
import { createApi, type ApiConfig, type ApiRuntime } from "../src/app.js";
import { createGatewayManager } from "../src/gateway-manager.js";
import { hashPassword } from "../src/auth.js";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const openApis = new Set<ApiRuntime>();

afterEach(async () => {
  for (const api of openApis) await api.close();
  openApis.clear();
});

const tool: EngineTool = {
  server: "task_hub",
  name: "list_cards",
  sideEffect: "read",
  policyVersion: "b-local-1",
  artifactHash: "a".repeat(64),
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object", properties: {} },
};

function reviewedGateway(
  inspectCalls: { value: number },
  connected = true,
): Gateway {
  return {
    userId: USER_ID,
    tools: [tool],
    isConnected: () => connected,
    async inspectServers() {
      inspectCalls.value++;
      return [
        {
          server: "task_hub",
          status: "connected",
          policyVersion: "b-local-1",
          tools: [tool],
        },
        {
          server: "filesystem",
          status: "disconnected",
          policyVersion: "b-local-fs-1",
          tools: [],
        },
      ];
    },
    async assertCurrent() {},
    async call() {
      return { structuredContent: {} };
    },
    async close() {},
  };
}

async function startApi(
  engine: WorkflowEngine | undefined,
  options: { now?: () => number; cooldownMs?: number } = {},
) {
  const config: ApiConfig = {
    host: "127.0.0.1",
    port: 0,
    userId: USER_ID,
    email: "catalog@example.local",
    passwordHash: await hashPassword("catalog-password"),
    sessionTtlMs: 60_000,
    cursorKey: Buffer.alloc(32, 19),
    plannerMode: "disabled",
  };
  const api = createApi({
    db: {} as Database,
    config,
    principalExists: async () => true,
    engine,
    catalogCheck: options,
  });
  openApis.add(api);
  const baseUrl = await api.listen();
  const login = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: config.email,
      password: "catalog-password",
    }),
  });
  expect(login.status).toBe(200);
  const { token } = (await login.json()) as { token: string };
  return { baseUrl, token };
}

describe("API-CATALOG HTTP boundary", () => {
  it("reads the catalog without launching a lazy gateway", async () => {
    let opens = 0;
    const manager = createGatewayManager(USER_ID, async () => {
      opens++;
      return reviewedGateway({ value: 0 });
    });
    const engine = new WorkflowEngine({} as Database, manager, USER_ID);
    const { baseUrl, token } = await startApi(engine);

    const response = await fetch(`${baseUrl}/servers/catalog`, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        slug: "task_hub",
        status: "disconnected",
        policy_version: "b-local-1",
        observed_at: expect.any(String),
        tools: [],
      },
      {
        slug: "filesystem",
        status: "disconnected",
        policy_version: "b-local-fs-1",
        observed_at: expect.any(String),
        tools: [],
      },
    ]);
    expect(opens).toBe(0);
    expect(manager.isConnected!()).toBe(false);
  });

  it("authenticates check, guards methods, and leaves unknown server paths 404", async () => {
    const engine = new WorkflowEngine({} as Database, undefined, USER_ID);
    const { baseUrl, token } = await startApi(engine);

    const unauthenticated = await fetch(`${baseUrl}/servers/check`, {
      method: "POST",
    });
    expect(unauthenticated.status).toBe(401);

    const wrongCatalogMethod = await fetch(`${baseUrl}/servers/catalog`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(wrongCatalogMethod.status).toBe(405);
    expect(wrongCatalogMethod.headers.get("allow")).toBe("GET");

    const wrongCheckMethod = await fetch(`${baseUrl}/servers/check`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(wrongCheckMethod.status).toBe(405);
    expect(wrongCheckMethod.headers.get("allow")).toBe("POST");

    const unknown = await fetch(`${baseUrl}/servers/not-a-route`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(unknown.status).toBe(404);
  });

  it("rate-limits active checks before launch and allows one after cooldown", async () => {
    let now = 1_000;
    let opens = 0;
    const inspectCalls = { value: 0 };
    const manager = createGatewayManager(USER_ID, async () => {
      opens++;
      return reviewedGateway(inspectCalls);
    });
    const engine = new WorkflowEngine({} as Database, manager, USER_ID);
    const { baseUrl, token } = await startApi(engine, {
      now: () => now,
      cooldownMs: 5_000,
    });
    const init = {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        slug: "evil",
        executable: "private-command",
        args: ["--must-not-be-used"],
      }),
    } satisfies RequestInit;

    const first = await fetch(`${baseUrl}/servers/check`, init);
    expect(first.status).toBe(200);
    expect(opens).toBe(1);
    expect(inspectCalls.value).toBe(1);

    const [second, concurrent] = await Promise.all([
      fetch(`${baseUrl}/servers/check`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      }),
      fetch(`${baseUrl}/servers/check`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      }),
    ]);
    expect(second.status).toBe(429);
    expect(concurrent.status).toBe(429);
    expect(Number(second.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(inspectCalls.value).toBe(1);
    expect(opens).toBe(1);

    now += 5_000;
    const afterCooldown = await fetch(`${baseUrl}/servers/check`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(afterCooldown.status).toBe(200);
    expect(inspectCalls.value).toBe(2);
    expect(opens).toBe(1);
  });

  it("isolates an active preset failure without installing a partial execution gateway", async () => {
    let atomicOpens = 0;
    let catalogChecks = 0;
    const manager = createGatewayManager(
      USER_ID,
      async () => {
        atomicOpens++;
        return reviewedGateway({ value: 0 });
      },
      async () => {
        catalogChecks++;
        return [
          {
            server: "task_hub",
            status: "connected",
            policyVersion: "b-local-1",
            tools: [tool],
          },
          {
            server: "filesystem",
            status: "error",
            policyVersion: "b-local-fs-1",
            tools: [],
          },
        ];
      },
    );
    const engine = new WorkflowEngine({} as Database, manager, USER_ID);
    const { baseUrl, token } = await startApi(engine);

    const response = await fetch(`${baseUrl}/servers/check`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        slug: "task_hub",
        status: "connected",
        policy_version: "b-local-1",
        observed_at: expect.any(String),
        tools: [
          {
            server: "task_hub",
            name: "list_cards",
            side_effect: "read",
            policy_version: "b-local-1",
            artifact_hash: "a".repeat(64),
            input_schema: { type: "object", properties: {} },
            output_schema: { type: "object", properties: {} },
          },
        ],
      },
      {
        slug: "filesystem",
        status: "error",
        policy_version: "b-local-fs-1",
        observed_at: expect.any(String),
        tools: [],
      },
    ]);
    expect(catalogChecks).toBe(1);
    expect(atomicOpens).toBe(0);
    expect(manager.isConnected!()).toBe(false);
    await expect(manager.assertCurrent()).rejects.toThrow("unavailable");
  });

  it("sanitizes connection/config failures as 503", async () => {
    const engine = {
      async serverCatalog() {
        throw new Error("private connection detail");
      },
      safeProjection<T>(value: T): T {
        return value;
      },
    } as unknown as WorkflowEngine;
    const { baseUrl, token } = await startApi(engine);

    const response = await fetch(`${baseUrl}/servers/check`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).not.toContain("private connection detail");
    expect(body).toContain("Service unavailable");
  });
});
