import {
  decodeProtectedHeader,
  importJWK,
  jwtVerify,
  type JWK,
  type JWTPayload,
} from "jose";
import { createHash, randomBytes } from "node:crypto";
import type { OidcConfig } from "./config.js";
import type { SessionMetadata } from "./auth.js";
import type { AuthRepository } from "./durable-auth.js";

export type OidcFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface OidcClientConfig extends Pick<
  OidcConfig,
  | "issuerUrl"
  | "clientId"
  | "clientSecret"
  | "redirectUri"
  | "audience"
  | "scopes"
> {}
export interface OidcClientConfig {
  readonly clockSkewSeconds?: number;
}

export interface OidcTransactionContext {
  state: string;
  nonce: string;
  codeChallenge: string;
  redirectUri?: string;
}

export interface OidcTokenSet {
  idToken: string;
  accessToken?: string;
  tokenType?: string;
}

export interface OidcIdentity {
  issuer: string;
  subject: string;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  roles: string[];
}

export interface OidcFlow {
  start(returnTo: string): Promise<{
    authorizationUrl: URL;
    transactionCookie: string;
  }>;
  complete(input: {
    code: string;
    state: string;
    transactionCookie: string;
  }): Promise<{
    userId: string;
    identity: OidcIdentity;
    sessionMetadata: SessionMetadata;
    returnTo: string;
  }>;
}

interface ProviderMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

export class OidcProviderError extends Error {
  constructor(
    readonly code:
      | "OIDC_PROVIDER_UNAVAILABLE"
      | "OIDC_INVALID_TOKEN"
      | "OIDC_INVALID_RESPONSE",
    message: string,
  ) {
    super(message);
    this.name = "OidcProviderError";
  }
}

export class OidcProviderClient {
  private readonly fetchImpl: OidcFetch;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private metadataCache: { value: ProviderMetadata; expiresAt: number } | null =
    null;
  private jwksCache: { value: JWK[]; expiresAt: number } | null = null;

  constructor(
    private readonly options: {
      config: OidcClientConfig;
      fetchImpl?: OidcFetch;
      timeoutMs?: number;
      now?: () => number;
    },
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.now = options.now ?? Date.now;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0)
      throw new Error("OIDC provider timeout must be a positive integer");
  }

  async authorizationUrl(transaction: OidcTransactionContext): Promise<URL> {
    const metadata = await this.discover();
    const url = new URL(metadata.authorization_endpoint);
    url.searchParams.set("client_id", this.options.config.clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set(
      "redirect_uri",
      transaction.redirectUri ?? this.options.config.redirectUri,
    );
    url.searchParams.set("scope", this.options.config.scopes.join(" "));
    url.searchParams.set("state", transaction.state);
    url.searchParams.set("nonce", transaction.nonce);
    url.searchParams.set("code_challenge", transaction.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url;
  }

  async exchangeCode(code: string, verifier: string): Promise<OidcTokenSet> {
    const metadata = await this.discover();
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.options.config.redirectUri,
      client_id: this.options.config.clientId,
      client_secret: this.options.config.clientSecret,
      code_verifier: verifier,
    });
    const response = await this.request(metadata.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (typeof response.id_token !== "string" || response.id_token.length < 20)
      throw new OidcProviderError(
        "OIDC_INVALID_RESPONSE",
        "OIDC provider did not return an ID token",
      );
    return {
      idToken: response.id_token,
      ...(typeof response.access_token === "string"
        ? { accessToken: response.access_token }
        : {}),
      ...(typeof response.token_type === "string"
        ? { tokenType: response.token_type }
        : {}),
    };
  }

  async validateIdentity(
    tokens: OidcTokenSet,
    transaction: { nonce: string },
  ): Promise<OidcIdentity> {
    const metadata = await this.discover();
    let header: ReturnType<typeof decodeProtectedHeader>;
    try {
      header = decodeProtectedHeader(tokens.idToken);
    } catch {
      throw new OidcProviderError(
        "OIDC_INVALID_TOKEN",
        "OIDC ID token is malformed",
      );
    }
    if (typeof header.kid !== "string" || typeof header.alg !== "string")
      throw new OidcProviderError(
        "OIDC_INVALID_TOKEN",
        "OIDC ID token key metadata is invalid",
      );
    let jwk = (await this.jwks()).find((key) => key.kid === header.kid);
    if (!jwk) {
      this.jwksCache = null;
      jwk = (await this.jwks()).find((key) => key.kid === header.kid);
    }
    if (!jwk)
      throw new OidcProviderError(
        "OIDC_INVALID_TOKEN",
        "OIDC signing key is not trusted",
      );
    let payload: JWTPayload;
    try {
      const key = await importJWK(jwk, header.alg);
      ({ payload } = await jwtVerify(tokens.idToken, key, {
        issuer: this.options.config.issuerUrl,
        audience: this.options.config.clientId,
        clockTolerance: this.options.config.clockSkewSeconds ?? 60,
      }));
    } catch {
      throw new OidcProviderError(
        "OIDC_INVALID_TOKEN",
        "OIDC ID token claims or signature are invalid",
      );
    }
    if (payload.nonce !== transaction.nonce)
      throw new OidcProviderError(
        "OIDC_INVALID_TOKEN",
        "OIDC nonce does not match the transaction",
      );
    if (typeof payload.sub !== "string" || typeof payload.email !== "string")
      throw new OidcProviderError(
        "OIDC_INVALID_TOKEN",
        "OIDC identity claims are incomplete",
      );
    if (payload.email_verified !== true)
      throw new OidcProviderError(
        "OIDC_INVALID_TOKEN",
        "OIDC email is not verified",
      );
    if (tokens.accessToken && tokens.accessToken.split(".").length === 3)
      await this.verifyAccessToken(tokens.accessToken, metadata);
    const roles = extractRoles(payload);
    return {
      issuer: metadata.issuer,
      subject: payload.sub,
      email: payload.email,
      emailVerified: true,
      displayName:
        typeof payload.name === "string"
          ? payload.name
          : typeof payload.preferred_username === "string"
            ? payload.preferred_username
            : null,
      roles: roles.includes("operator") ? ["user", "operator"] : ["user"],
    };
  }

  private async verifyAccessToken(
    token: string,
    metadata: ProviderMetadata,
  ): Promise<void> {
    let header: ReturnType<typeof decodeProtectedHeader>;
    try {
      header = decodeProtectedHeader(token);
      if (typeof header.kid !== "string" || typeof header.alg !== "string")
        throw new Error("invalid header");
      let jwk = (await this.jwks()).find((key) => key.kid === header.kid);
      if (!jwk) {
        this.jwksCache = null;
        jwk = (await this.jwks()).find((key) => key.kid === header.kid);
      }
      if (!jwk) throw new Error("untrusted key");
      const key = await importJWK(jwk, header.alg);
      await jwtVerify(token, key, {
        issuer: metadata.issuer,
        audience: this.options.config.audience,
        clockTolerance: this.options.config.clockSkewSeconds ?? 60,
      });
    } catch {
      throw new OidcProviderError(
        "OIDC_INVALID_TOKEN",
        "OIDC access token claims or signature are invalid",
      );
    }
  }

  private async discover(): Promise<ProviderMetadata> {
    const cached = this.metadataCache;
    if (cached && cached.expiresAt > this.now()) return cached.value;
    const issuer = this.options.config.issuerUrl.replace(/\/$/, "");
    const metadata = await this.request(
      `${issuer}/.well-known/openid-configuration`,
    );
    if (
      metadata.issuer !== this.options.config.issuerUrl ||
      typeof metadata.authorization_endpoint !== "string" ||
      typeof metadata.token_endpoint !== "string" ||
      typeof metadata.jwks_uri !== "string"
    )
      throw new OidcProviderError(
        "OIDC_INVALID_RESPONSE",
        "OIDC discovery metadata is invalid",
      );
    const value = metadata as ProviderMetadata;
    this.metadataCache = { value, expiresAt: this.now() + 5 * 60_000 };
    return value;
  }

  private async jwks(): Promise<JWK[]> {
    const cached = this.jwksCache;
    if (cached && cached.expiresAt > this.now()) return cached.value;
    const metadata = await this.discover();
    const response = await this.request(metadata.jwks_uri);
    if (
      !response ||
      !Array.isArray(response.keys) ||
      !response.keys.every((key: unknown) => key && typeof key === "object")
    )
      throw new OidcProviderError(
        "OIDC_INVALID_RESPONSE",
        "OIDC JWKS response is invalid",
      );
    const value = response.keys as JWK[];
    this.jwksCache = { value, expiresAt: this.now() + 60_000 };
    return value;
  }

  private async request(url: string, init?: RequestInit): Promise<any> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const responsePromise = this.fetchImpl(url, {
        ...init,
        signal: controller.signal,
      });
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(
            new OidcProviderError(
              "OIDC_PROVIDER_UNAVAILABLE",
              "OIDC provider request timed out",
            ),
          );
        }, this.timeoutMs);
      });
      const response = await Promise.race([responsePromise, timeoutPromise]);
      if (!response.ok)
        throw new OidcProviderError(
          "OIDC_PROVIDER_UNAVAILABLE",
          "OIDC provider request failed",
        );
      try {
        return await response.json();
      } catch {
        throw new OidcProviderError(
          "OIDC_INVALID_RESPONSE",
          "OIDC provider response is not JSON",
        );
      }
    } catch (error) {
      if (error instanceof OidcProviderError) throw error;
      throw new OidcProviderError(
        "OIDC_PROVIDER_UNAVAILABLE",
        "OIDC provider is unavailable",
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

export function createOidcFlow(options: {
  config: OidcConfig;
  repository: AuthRepository;
  provider: OidcProviderClient;
  now?: () => number;
}): OidcFlow {
  const now = options.now ?? Date.now;
  const hash = (value: string) =>
    createHash("sha256").update(value, "utf8").digest("hex");
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const decode = (
    value: string,
  ): {
    state: string;
    nonce: string;
    verifier: string;
    returnTo: string;
  } => {
    try {
      const parsed = JSON.parse(
        Buffer.from(value, "base64url").toString("utf8"),
      ) as Record<string, unknown>;
      if (
        typeof parsed.state !== "string" ||
        typeof parsed.nonce !== "string" ||
        typeof parsed.verifier !== "string" ||
        typeof parsed.returnTo !== "string"
      )
        throw new Error("invalid transaction");
      return {
        state: parsed.state,
        nonce: parsed.nonce,
        verifier: parsed.verifier,
        returnTo: parsed.returnTo,
      };
    } catch {
      throw new OidcProviderError(
        "OIDC_INVALID_TOKEN",
        "OIDC transaction cookie is invalid",
      );
    }
  };
  const normalizeReturnTo = (value: string): string => {
    if (
      value.length > 512 ||
      !value.startsWith("/") ||
      value.startsWith("//") ||
      value.includes("\\")
    )
      return "/";
    return value;
  };
  return {
    async start(returnTo) {
      const normalized = normalizeReturnTo(returnTo);
      const state = randomBytes(32).toString("base64url");
      const nonce = randomBytes(32).toString("base64url");
      const verifier = randomBytes(32).toString("base64url");
      const codeChallenge = createHash("sha256")
        .update(verifier, "utf8")
        .digest("base64url");
      await options.repository.createOidcTransaction({
        stateHash: hash(state),
        nonceHash: hash(nonce),
        verifierHash: hash(verifier),
        issuer: options.config.issuerUrl,
        clientId: options.config.clientId,
        redirectUri: options.config.redirectUri,
        returnTo: normalized,
        expiresAt: new Date(now() + options.config.transactionTtlMs),
      });
      return {
        authorizationUrl: await options.provider.authorizationUrl({
          state,
          nonce,
          codeChallenge,
        }),
        transactionCookie: encode({
          state,
          nonce,
          verifier,
          returnTo: normalized,
        }),
      };
    },

    async complete(input) {
      const envelope = decode(input.transactionCookie);
      if (envelope.state !== input.state)
        throw new OidcProviderError(
          "OIDC_INVALID_TOKEN",
          "OIDC transaction state does not match",
        );
      const transaction = await options.repository.consumeOidcTransaction(
        hash(input.state),
      );
      if (
        !transaction ||
        transaction.nonceHash !== hash(envelope.nonce) ||
        transaction.verifierHash !== hash(envelope.verifier) ||
        transaction.returnTo !== envelope.returnTo
      )
        throw new OidcProviderError(
          "OIDC_INVALID_TOKEN",
          "OIDC transaction is invalid or expired",
        );
      const tokens = await options.provider.exchangeCode(
        input.code,
        envelope.verifier,
      );
      const identity = await options.provider.validateIdentity(tokens, {
        nonce: envelope.nonce,
      });
      const local = await options.repository.findOrCreateIdentity({
        issuer: identity.issuer,
        subject: identity.subject,
        email: identity.email,
        displayName: identity.displayName,
      });
      return {
        userId: local.userId,
        identity,
        sessionMetadata: {
          createdFrom: "oidc",
          issuer: identity.issuer,
          subject: identity.subject,
        },
        returnTo: transaction.returnTo,
      };
    },
  };
}

function extractRoles(payload: JWTPayload): string[] {
  const direct = Array.isArray(payload.roles)
    ? payload.roles.filter((role): role is string => typeof role === "string")
    : [];
  const nested = payload.realm_access;
  const realmRoles =
    nested && typeof nested === "object" && Array.isArray((nested as any).roles)
      ? (nested as any).roles.filter(
          (role: unknown): role is string => typeof role === "string",
        )
      : [];
  return [...new Set([...direct, ...realmRoles])];
}
