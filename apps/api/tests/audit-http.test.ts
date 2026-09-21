import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { Database } from "@wap/db";
import {
  EngineError,
  WorkflowEngine,
  type Gateway,
  type EngineTool,
} from "@wap/engine";
import {
  createApi,
  type ApiConfig,
  type ApiRuntime,
  type PrincipalEngineFactory,
} from "../src/app.js";
import { hashPassword } from "../src/auth.js";
import { redact } from "../src/redaction.js";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const RUN_ID = "00000000-0000-4000-8000-000000000002";
const openApis = new Set<ApiRuntime>();

afterEach(async () => {
  for (const api of openApis) await api.close();
  openApis.clear();
});

async function startApi(
  engine?: WorkflowEngine,
  engineFactory?: PrincipalEngineFactory,
) {
  const config: ApiConfig = {
    host: "127.0.0.1",
    port: 0,
    userId: USER_ID,
    email: "audit@example.local",
    passwordHash: await hashPassword("login-password"),
    sessionTtlMs: 60_000,
    cursorKey: Buffer.alloc(32, 11),
    plannerMode: "disabled",
  };
  const api = createApi({
    db: {} as Database,
    config,
    principalExists: async () => true,
    engine,
    engineFactory,
  });
  openApis.add(api);
  const baseUrl = await api.listen();
  const login = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: config.email,
      password: "login-password",
    }),
  });
  const { token } = (await login.json()) as { token: string };
  return { api, baseUrl, config, token };
}

function tool(
  server: "task_hub" | "filesystem",
  policyVersion: string,
): EngineTool {
  return {
    server,
    name: server === "task_hub" ? "list_cards" : "read_file",
    sideEffect: "read",
    policyVersion,
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object", properties: {} },
    artifactHash: "a".repeat(64),
  };
}

function gateway(options: {
  tools?: readonly EngineTool[];
  current?: boolean;
}): Gateway {
  return {
    userId: USER_ID,
    tools: options.tools ?? [],
    async assertCurrent() {
      if (options.current === false) throw new Error("registry drift");
    },
    async call() {
      throw new Error("not used");
    },
    async close() {},
  };
}

describe("audit HTTP boundary fixes", () => {
  it("authenticates before resolving a principal engine", async () => {
    const calls: string[] = [];
    const principalEngine = {
      list: async () => [],
      safeProjection: <T>(value: T): T => value,
    } as unknown as WorkflowEngine;
    const factory: PrincipalEngineFactory = (userId) => {
      calls.push(userId);
      return principalEngine;
    };
    const { baseUrl, token } = await startApi(undefined, factory);

    const unauthenticated = await fetch(`${baseUrl}/runs`);
    expect(unauthenticated.status).toBe(401);
    expect(calls).toEqual([]);

    const authenticated = await fetch(`${baseUrl}/runs`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(authenticated.status).toBe(200);
    expect(await authenticated.json()).toEqual([]);
    expect(calls).toEqual([USER_ID]);
  });

  it("preserves schema property names while redacting sensitive data", () => {
    const projected = redact(
      {
        tool_snapshot: {
          input_schema: {
            type: "object",
            properties: { password: { type: "string" } },
          },
        },
        resolved_args: {
          password: "ordinary-sensitive-value",
          content: "prefix configured-secret-canary suffix",
        },
      },
      ["configured-secret-canary"],
    ) as Record<string, any>;

    expect(projected.tool_snapshot.input_schema.properties).toEqual({
      password: { type: "string" },
    });
    expect(projected.resolved_args).toEqual({
      password: "[REDACTED]",
      content: "prefix [REDACTED] suffix",
    });
  });

  it("maps malformed path input to 400 without invoking the engine", async () => {
    let detailCalls = 0;
    const engine = {
      async detail() {
        detailCalls++;
        return {};
      },
    } as unknown as WorkflowEngine;
    const { baseUrl, token } = await startApi(engine);

    const response = await fetch(`${baseUrl}/runs/not-a-uuid`, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(400);
    expect(detailCalls).toBe(0);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
  });

  it("maps an internal Zod contract failure to a sanitized 500", async () => {
    const engine = {
      async detail() {
        return z.object({ required: z.string() }).parse({});
      },
    } as unknown as WorkflowEngine;
    const { baseUrl, token } = await startApi(engine);

    const response = await fetch(`${baseUrl}/runs/${RUN_ID}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      error: { code: "INTERNAL", message: "Internal server error" },
    });
  });

  it("does not expose configured values from engine error messages", async () => {
    const engine = {
      async detail() {
        throw new EngineError(
          "CONFLICT",
          "configured-secret-canary must not cross HTTP",
        );
      },
    } as unknown as WorkflowEngine;
    const { baseUrl, token } = await startApi(engine);

    const response = await fetch(`${baseUrl}/runs/${RUN_ID}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const raw = await response.text();

    expect(response.status).toBe(409);
    expect(raw).not.toContain("configured-secret-canary");
  });

  it("reports live reviewed servers from the gateway", async () => {
    const engine = new WorkflowEngine(
      {} as Database,
      gateway({
        tools: [
          tool("task_hub", "b-local-1"),
          tool("filesystem", "b-local-fs-1"),
        ],
      }),
      USER_ID,
    );
    const { baseUrl, token } = await startApi(engine);

    const response = await fetch(`${baseUrl}/servers`, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { slug: "task_hub", status: "connected", policy_version: "b-local-1" },
      {
        slug: "filesystem",
        status: "connected",
        policy_version: "b-local-fs-1",
      },
    ]);
  });

  it("reports gateway validation failure as server error state", async () => {
    const engine = new WorkflowEngine(
      {} as Database,
      gateway({
        tools: [tool("task_hub", "b-local-1")],
        current: false,
      }),
      USER_ID,
    );
    const { baseUrl, token } = await startApi(engine);

    const response = await fetch(`${baseUrl}/servers`, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { slug: "task_hub", status: "error", policy_version: "b-local-1" },
      {
        slug: "filesystem",
        status: "disconnected",
        policy_version: "b-local-fs-1",
      },
    ]);
  });
});
