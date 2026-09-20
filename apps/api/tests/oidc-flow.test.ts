import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createOidcFlow, type OidcProviderClient } from "../src/oidc.js";
import type { AuthRepository } from "../src/durable-auth.js";

const config = {
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
};

const digest = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

describe("OIDC flow transaction binding", () => {
  it("binds state, nonce and PKCE verifier and consumes the transaction once", async () => {
    let stored: any;
    let consumed = false;
    const repository: AuthRepository = {
      async createOidcTransaction(input) {
        stored = input;
        return { id: "tx-1", stateHash: input.stateHash };
      },
      async consumeOidcTransaction(stateHash) {
        if (consumed || !stored || stored.stateHash !== stateHash) return null;
        consumed = true;
        return {
          id: "tx-1",
          stateHash: stored.stateHash,
          nonceHash: stored.nonceHash,
          verifierHash: stored.verifierHash,
          issuer: stored.issuer,
          clientId: stored.clientId,
          redirectUri: stored.redirectUri,
          returnTo: stored.returnTo,
        };
      },
      async findOrCreateIdentity() {
        return {
          identityId: "identity-1",
          userId: "00000000-0000-4000-8000-000000000001",
          email: "oidc-user@local.invalid",
          displayName: "OIDC User",
          roles: ["user"],
        };
      },
      async createSession() {},
      async findSession() {
        return null;
      },
      async revokeSession() {
        return false;
      },
    };
    const provider = {
      authorizationUrl: vi.fn(
        async () => new URL("http://issuer.local/authorize"),
      ),
      exchangeCode: vi.fn(async () => ({ idToken: "id-token" })),
      validateIdentity: vi.fn(async () => ({
        issuer: config.issuerUrl,
        subject: "subject-1",
        email: "oidc-user@local.invalid",
        emailVerified: true,
        displayName: "OIDC User",
        roles: ["user"],
      })),
    } as unknown as OidcProviderClient;
    const flow = createOidcFlow({
      config,
      repository,
      provider,
      now: () => 1_000,
    });
    const started = await flow.start("/history");
    const completed = await flow.complete({
      code: "code",
      state: (() => {
        const value = JSON.parse(
          Buffer.from(started.transactionCookie, "base64url").toString(),
        );
        return value.state;
      })(),
      transactionCookie: started.transactionCookie,
    });
    expect(completed.userId).toBe("00000000-0000-4000-8000-000000000001");
    expect(provider.exchangeCode).toHaveBeenCalledOnce();
    await expect(
      flow.complete({
        code: "code",
        state: (() => {
          const value = JSON.parse(
            Buffer.from(started.transactionCookie, "base64url").toString(),
          );
          return value.state;
        })(),
        transactionCookie: started.transactionCookie,
      }),
    ).rejects.toMatchObject({ code: "OIDC_INVALID_TOKEN" });
    expect(stored.stateHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.nonceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.verifierHash).toMatch(/^[a-f0-9]{64}$/);
    expect(digest("not-the-verifier")).not.toBe(stored.verifierHash);
  });
});
