import { afterEach, describe, expect, it } from "vitest";
import { request } from "node:http";
import { createApi, type ApiConfig } from "../src/app.js";
import { hashPassword } from "../src/auth.js";
import type { Database } from "@wap/db";

const servers = new Set<{ close(): Promise<void> }>();
afterEach(async () => {
  for (const server of servers) await server.close();
  servers.clear();
});

async function makeApi(options: { principalExists?: () => Promise<boolean> } = {}) {
  const config: ApiConfig = {
    host: "127.0.0.1",
    port: 0,
    userId: "00000000-0000-4000-8000-000000000001",
    email: "demo@example.local",
    passwordHash: await hashPassword("demo-secret"),
    sessionTtlMs: 60_000,
    cursorKey: Buffer.alloc(32, 7),
    plannerMode: "disabled",
  };
  const db = {} as Database;
  const api = createApi({
    db,
    config,
    principalExists: options.principalExists ?? (async () => true),
  });
  servers.add(api);
  const baseUrl = await api.listen();
  return { api, baseUrl };
}

async function sendChunkedJson(baseUrl: string, chunks: readonly string[]) {
  const target = new URL(`${baseUrl}/auth/login`);
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const outgoing = request(
      target,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "transfer-encoding": "chunked",
        },
      },
      (incoming) => {
        const body: Buffer[] = [];
        incoming.on("data", (chunk) => body.push(Buffer.from(chunk)));
        incoming.on("end", () => {
          try {
            resolve({
              status: incoming.statusCode ?? 0,
              body: JSON.parse(Buffer.concat(body).toString("utf8")),
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    outgoing.on("error", reject);
    for (const chunk of chunks) outgoing.write(chunk);
    outgoing.end();
  });
}

describe("API-01 HTTP boundary", () => {
  it("returns 415 for a non-JSON login request without mutating state", async () => {
    const { baseUrl } = await makeApi();
    const response = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "email=demo@example.local",
    });
    expect(response.status).toBe(415);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      error: { code: "UNSUPPORTED_MEDIA" },
    });
  });

  it("rejects unknown login fields and authenticates the protected servers route", async () => {
    const { baseUrl } = await makeApi();
    const invalid = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "demo@example.local",
        password: "demo-secret",
        user_id: "x",
      }),
    });
    expect(invalid.status).toBe(400);
    const unauthenticated = await fetch(`${baseUrl}/servers`);
    expect(unauthenticated.status).toBe(401);

    const login = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "demo@example.local",
        password: "demo-secret",
      }),
    });
    expect(login.status).toBe(200);
    const { token } = (await login.json()) as { token: string };
    const serversResponse = await fetch(`${baseUrl}/servers`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(serversResponse.status).toBe(200);
    expect(await serversResponse.json()).toEqual([
      { slug: "task_hub", status: "disconnected", policy_version: "b-local-1" },
      {
        slug: "filesystem",
        status: "disconnected",
        policy_version: "b-local-fs-1",
      },
    ]);
  });

  it("caps a streaming request body at 64 KiB", async () => {
    const { baseUrl } = await makeApi();
    const response = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "demo@example.local",
        password: "x".repeat(70_000),
      }),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      error: { code: "BODY_TOO_LARGE" },
    });
  });

  it("rejects malformed and oversized chunked JSON before principal lookup", async () => {
    let principalLookups = 0;
    const { baseUrl } = await makeApi({
      principalExists: async () => {
        principalLookups++;
        return true;
      },
    });

    await expect(sendChunkedJson(baseUrl, ['{"email":'])).resolves.toEqual({
      status: 400,
      body: expect.objectContaining({
        error: expect.objectContaining({ code: "INVALID_JSON" }),
      }),
    });
    await expect(
      sendChunkedJson(baseUrl, [
        '{"email":"demo@example.local","password":"',
        "x".repeat(65_536),
        '"}',
      ]),
    ).resolves.toEqual({
      status: 413,
      body: expect.objectContaining({
        error: expect.objectContaining({ code: "BODY_TOO_LARGE" }),
      }),
    });
    expect(principalLookups).toBe(0);
  });
});
