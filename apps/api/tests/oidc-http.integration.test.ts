import { afterEach, describe, expect, it } from "vitest";
import { createApi, type ApiConfig } from "../src/app.js";
import { type SessionAuthority } from "../src/auth.js";
import type { OidcFlow } from "../src/oidc.js";
import type { Database } from "@wap/db";

const runtimes = new Set<{ close(): Promise<void> }>();

afterEach(async () => {
  for (const runtime of runtimes) await runtime.close();
  runtimes.clear();
});

function config(): ApiConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    userId: "00000000-0000-4000-8000-000000000001",
    email: "demo@example.local",
    passwordHash:
      "scrypt$16384$8$1$00000000000000000000000000000000$" + "0".repeat(128),
    sessionTtlMs: 60_000,
    cursorKey: Buffer.alloc(32, 7),
    plannerMode: "disabled",
    oidc: {
      enabled: true,
      issuerUrl: "http://127.0.0.1:8080/realms/wap",
      clientId: "wap-web",
      clientSecret: "secret",
      redirectUri: "http://127.0.0.1:3001/api/v1/auth/oidc/callback",
      audience: "wap-api",
      scopes: ["openid", "profile", "email"],
      webOrigin: "http://127.0.0.1:5173",
      sessionCookieName: "wap_session",
      transactionTtlMs: 60_000,
      sessionTtlMs: 60_000,
      clockSkewSeconds: 60,
    },
  };
}

describe("OIDC HTTP boundary", () => {
  it("starts, completes, hydrates and revokes a cookie session", async () => {
    const calls: string[] = [];
    const authority: SessionAuthority = {
      async login() {
        return "legacy";
      },
      async issue(userId, metadata) {
        calls.push(`issue:${userId}:${metadata.createdFrom}`);
        return "s".repeat(43);
      },
      async authenticate(input) {
        calls.push(`authenticate:${JSON.stringify(input)}`);
        return "00000000-0000-4000-8000-000000000001";
      },
      async revoke(input) {
        calls.push(`revoke:${JSON.stringify(input)}`);
      },
    };
    const flow: OidcFlow = {
      async start(returnTo) {
        expect(returnTo).toBe("/history");
        return {
          authorizationUrl: new URL(
            "http://issuer.local/authorize?state=state",
          ),
          transactionCookie: "transaction-cookie",
        };
      },
      async complete(input) {
        expect(input).toEqual({
          code: "code",
          state: "state",
          transactionCookie: "transaction-cookie",
        });
        return {
          userId: "00000000-0000-4000-8000-000000000001",
          identity: {
            issuer: "http://issuer.local",
            subject: "subject-1",
            email: "demo@example.local",
            emailVerified: true,
            displayName: "Demo",
            roles: ["user"],
          },
          sessionMetadata: {
            createdFrom: "oidc",
            issuer: "http://issuer.local",
            subject: "subject-1",
          },
          returnTo: "/history",
        };
      },
    };
    const api = createApi({
      db: {} as Database,
      config: config(),
      sessionStore: authority,
      oidcFlow: flow,
      identityLookup: async () => ({
        user_id: "00000000-0000-4000-8000-000000000001",
        email: "demo@example.local",
        display_name: "Demo",
        roles: ["user"],
      }),
    });
    runtimes.add(api);
    const base = await api.listen();
    const start = await fetch(`${base}/auth/oidc/start?return_to=%2Fhistory`, {
      redirect: "manual",
      headers: { origin: "http://127.0.0.1:5173" },
    });
    expect(start.status).toBe(302);
    expect(start.headers.get("location")).toContain("state=state");
    expect(start.headers.get("set-cookie")).toContain(
      "wap_oidc_tx=transaction-cookie",
    );

    const callback = await fetch(
      `${base}/auth/oidc/callback?code=code&state=state`,
      {
        redirect: "manual",
        headers: {
          origin: "http://127.0.0.1:5173",
          cookie: "wap_oidc_tx=transaction-cookie",
        },
      },
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(
      "http://127.0.0.1:5173/history",
    );
    expect(callback.headers.get("set-cookie")).toContain("wap_session=");

    const me = await fetch(`${base}/auth/me`, {
      headers: {
        origin: "http://127.0.0.1:5173",
        cookie: `wap_session=${"s".repeat(43)}`,
      },
    });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      user_id: "00000000-0000-4000-8000-000000000001",
      email: "demo@example.local",
      roles: ["user"],
    });

    const logout = await fetch(`${base}/auth/logout`, {
      method: "POST",
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": "csrf-token-123456",
        cookie: `wap_session=${"s".repeat(43)}; wap_csrf=csrf-token-123456`,
      },
    });
    expect(logout.status).toBe(204);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(calls.some((call) => call.startsWith("issue:"))).toBe(true);
    expect(calls.some((call) => call.startsWith("revoke:"))).toBe(true);
  });

  it("rejects a foreign origin before a cookie mutation", async () => {
    const authority: SessionAuthority = {
      async login() {
        return "legacy";
      },
      async issue() {
        return "s".repeat(43);
      },
      async authenticate() {
        return "00000000-0000-4000-8000-000000000001";
      },
      async revoke() {
        throw new Error("must not be called");
      },
    };
    const api = createApi({
      db: {} as Database,
      config: config(),
      sessionStore: authority,
      oidcFlow: {
        async start() {
          throw new Error("must not be called");
        },
        async complete() {
          throw new Error("must not be called");
        },
      },
    });
    runtimes.add(api);
    const base = await api.listen();
    const response = await fetch(`${base}/auth/logout`, {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        "x-csrf-token": "csrf",
        cookie: "wap_session=invalid",
      },
    });
    expect(response.status).toBe(403);
  });
});
