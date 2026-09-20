import { afterEach, describe, expect, it } from "vitest";
import { createApi, type ApiConfig } from "../src/app.js";
import { hashPassword } from "../src/auth.js";
import type { Database } from "@wap/db";

const runtimes = new Set<{ close(): Promise<void> }>();

afterEach(async () => {
  for (const runtime of runtimes) await runtime.close();
  runtimes.clear();
});

async function startApi(readiness: () => Promise<boolean>) {
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
    health: { readiness },
  });
  runtimes.add(api);
  return { api, baseUrl: await api.listen() };
}

describe("deployment health boundary", () => {
  it("reports liveness without auth or dependency access", async () => {
    let readinessCalls = 0;
    const { baseUrl } = await startApi(async () => {
      readinessCalls += 1;
      return true;
    });
    const response = await fetch(`${baseUrl}/health/live`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(readinessCalls).toBe(0);
  });

  it("returns 503 when readiness dependency is unavailable", async () => {
    const { baseUrl } = await startApi(async () => false);
    const response = await fetch(`${baseUrl}/health/ready`);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "NOT_READY" },
    });
  });

  it("returns ready without bearer when dependency check succeeds", async () => {
    const { baseUrl } = await startApi(async () => true);
    const response = await fetch(`${baseUrl}/health/ready`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready" });
  });
});
