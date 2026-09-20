import { afterEach, describe, expect, it } from "vitest";
import { createApi, type ApiConfig } from "../src/app.js";
import { hashPassword } from "../src/auth.js";
import type { Database } from "@wap/db";

const runtimes = new Set<{ close(): Promise<void> }>();

afterEach(async () => {
  for (const runtime of runtimes) await runtime.close();
  runtimes.clear();
});

describe("HTTP session revocation", () => {
  it("logs out a bearer session and prevents reuse", async () => {
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
    const api = createApi({
      db: {} as Database,
      config,
      principalExists: async () => true,
    });
    runtimes.add(api);
    const baseUrl = await api.listen();
    const login = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: config.email, password: "demo-secret" }),
    });
    const { token } = (await login.json()) as { token: string };

    const logout = await fetch(`${baseUrl}/auth/logout`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(logout.status).toBe(204);
    expect(logout.headers.get("x-request-id")).toMatch(
      /^[0-9a-f-]{36}$/i,
    );
    expect(await logout.text()).toBe("");

    const after = await fetch(`${baseUrl}/servers`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.status).toBe(401);
  });
});
