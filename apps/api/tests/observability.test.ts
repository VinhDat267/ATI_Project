import { afterEach, describe, expect, it } from "vitest";
import { createApi, type ApiConfig } from "../src/app.js";
import { hashPassword } from "../src/auth.js";
import {
  requestRouteTemplate,
  type RequestLogEntry,
} from "../src/observability.js";
import type { Database } from "@wap/db";

const runtimes = new Set<{ close(): Promise<void> }>();

afterEach(async () => {
  for (const runtime of runtimes) await runtime.close();
  runtimes.clear();
});

describe("request observability", () => {
  it("maps request paths to stable route templates without user data", () => {
    expect(requestRouteTemplate("/auth/login")).toBe("/auth/login");
    expect(requestRouteTemplate("/auth/logout")).toBe("/auth/logout");
    expect(requestRouteTemplate("/servers")).toBe("/servers");
    expect(requestRouteTemplate("/runs")).toBe("/runs");
    expect(requestRouteTemplate("/runs/secret-value")).toBe("/runs/:runId");
    expect(requestRouteTemplate("/runs/secret-value/events")).toBe(
      "/runs/:runId/events",
    );
    expect(requestRouteTemplate("/runs/secret-value/private-token")).toBe(
      "/runs/:runId/unknown",
    );
    expect(requestRouteTemplate("/internal/private-token")).toBe("/unknown");
  });

  it("emits only method, stable route, status, and request correlation", async () => {
    const entries: RequestLogEntry[] = [];
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
      requestLogger: (entry) => entries.push(entry),
    });
    runtimes.add(api);
    const baseUrl = await api.listen();

    const response = await fetch(`${baseUrl}/servers?secret=must-not-log`, {
      headers: { authorization: "Bearer not-a-real-token" },
    });
    expect(response.status).toBe(401);
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry).toBeDefined();
    if (!entry) throw new Error("request log entry was not captured");
    expect(entry).toMatchObject({
      event: "http_request",
      method: "GET",
      route: "/servers",
      status: 401,
    });
    expect(entry.request_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(JSON.stringify(entry)).not.toContain("must-not-log");
    expect(JSON.stringify(entry)).not.toContain("not-a-real-token");
  });
});
