import { afterEach, describe, expect, it } from "vitest";
import { createApi, type ApiConfig } from "../src/app.js";
import { hashPassword, type SessionAuthority } from "../src/auth.js";
import type { Database } from "@wap/db";

const runtimes = new Set<{ close(): Promise<void> }>();

afterEach(async () => {
  for (const runtime of runtimes) await runtime.close();
  runtimes.clear();
});

describe("session authority seam", () => {
  it("allows an injected authority without changing the API route contract", async () => {
    const calls: string[] = [];
    const authority: SessionAuthority = {
      async login() {
        calls.push("login");
        return "token";
      },
      authenticate(header) {
        calls.push(`authenticate:${header ?? "none"}`);
        return "00000000-0000-4000-8000-000000000001";
      },
      revoke(header) {
        calls.push(`revoke:${header ?? "none"}`);
      },
    };
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
      sessionStore: authority,
    });
    runtimes.add(api);
    const baseUrl = await api.listen();
    const response = await fetch(`${baseUrl}/servers`, {
      headers: { authorization: "Bearer injected" },
    });
    expect(response.status).toBe(200);
    expect(calls).toEqual(["authenticate:Bearer injected"]);
  });
});
