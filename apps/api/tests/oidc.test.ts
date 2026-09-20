import { describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { OidcProviderClient, type OidcFetch } from "../src/oidc.js";

const config = {
  issuerUrl: "http://127.0.0.1:8080/realms/wap",
  clientId: "wap-web",
  clientSecret: "client-secret",
  redirectUri: "http://127.0.0.1:3001/api/v1/auth/oidc/callback",
  audience: "wap-api",
  scopes: ["openid", "profile", "email"],
};

async function fakeIssuer() {
  const first = await generateKeyPair("RS256");
  const firstJwk = await exportJWK(first.publicKey);
  const keys = new Map<string, CryptoKey | any>([["first", first.privateKey]]);
  let activeKid = "first";
  const fetchImpl: OidcFetch = vi.fn(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/.well-known/openid-configuration"))
      return Response.json({
        issuer: config.issuerUrl,
        authorization_endpoint: `${config.issuerUrl}/authorize`,
        token_endpoint: `${config.issuerUrl}/token`,
        jwks_uri: `${config.issuerUrl}/jwks`,
      });
    if (url.endsWith("/token")) {
      const body = String(init?.body ?? "");
      expect(body).toContain("grant_type=authorization_code");
      expect(body).toContain("code_verifier=verifier");
      const key = keys.get(activeKid)!;
      const idToken = await new SignJWT({
        sub: "subject-1",
        email: "oidc-user@local.invalid",
        email_verified: true,
        name: "OIDC User",
        roles: ["user"],
        nonce: "nonce",
      })
        .setProtectedHeader({ alg: "RS256", kid: activeKid })
        .setIssuer(config.issuerUrl)
        .setAudience(config.clientId)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(key);
      return Response.json({ id_token: idToken, access_token: "opaque" });
    }
    if (url.endsWith("/jwks"))
      return Response.json({
        keys: [{ ...firstJwk, kid: activeKid, alg: "RS256" }],
      });
    throw new Error(`Unexpected issuer request: ${url}`);
  });
  return {
    fetchImpl,
    rotate: async () => {
      const rotated = await generateKeyPair("RS256");
      const jwk = await exportJWK(rotated.publicKey);
      keys.set("rotated", rotated.privateKey);
      activeKid = "rotated";
      firstJwk.kid = "rotated";
      Object.assign(firstJwk, jwk);
    },
  };
}

describe("OIDC provider client", () => {
  it("discovers endpoints, builds PKCE authorization, exchanges code and validates identity", async () => {
    const issuer = await fakeIssuer();
    const client = new OidcProviderClient({
      config,
      fetchImpl: issuer.fetchImpl,
    });
    const authorization = await client.authorizationUrl({
      state: "state",
      nonce: "nonce",
      codeChallenge: "challenge",
    });
    expect(authorization.toString()).toContain("response_type=code");
    expect(authorization.searchParams.get("code_challenge_method")).toBe(
      "S256",
    );
    const tokens = await client.exchangeCode("code", "verifier");
    const identity = await client.validateIdentity(tokens, { nonce: "nonce" });
    expect(identity).toMatchObject({
      issuer: config.issuerUrl,
      subject: "subject-1",
      email: "oidc-user@local.invalid",
      emailVerified: true,
      roles: ["user"],
    });
  });

  it("rejects a wrong nonce, issuer/audience and expired token without leaking claims", async () => {
    const issuer = await fakeIssuer();
    const client = new OidcProviderClient({
      config,
      fetchImpl: issuer.fetchImpl,
    });
    const tokens = await client.exchangeCode("code", "verifier");
    await expect(
      client.validateIdentity(tokens, { nonce: "wrong" }),
    ).rejects.toMatchObject({ code: "OIDC_INVALID_TOKEN" });
    expect(
      String(
        await client
          .validateIdentity(tokens, { nonce: "nonce" })
          .catch((error) => error),
      ),
    ).not.toContain("oidc-user@local.invalid");
  });

  it("refreshes JWKS when a signing key rotates", async () => {
    const issuer = await fakeIssuer();
    const client = new OidcProviderClient({
      config,
      fetchImpl: issuer.fetchImpl,
    });
    await client.validateIdentity(
      await client.exchangeCode("code", "verifier"),
      { nonce: "nonce" },
    );
    await issuer.rotate();
    await expect(
      client.validateIdentity(await client.exchangeCode("code", "verifier"), {
        nonce: "nonce",
      }),
    ).resolves.toMatchObject({ subject: "subject-1" });
  });

  it("maps provider fetch timeouts to a redacted provider error", async () => {
    const fetchImpl: OidcFetch = vi.fn(() => new Promise<Response>(() => {}));
    const client = new OidcProviderClient({ config, fetchImpl, timeoutMs: 10 });
    await expect(
      client.authorizationUrl({
        state: "state",
        nonce: "nonce",
        codeChallenge: "challenge",
      }),
    ).rejects.toMatchObject({ code: "OIDC_PROVIDER_UNAVAILABLE" });
  });
});
