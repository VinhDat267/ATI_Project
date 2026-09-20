import { DEMO_USER_ID } from "@wap/db";
import { z } from "zod";
import { parsePasswordHash } from "./auth.js";

export interface ApiConfig {
  host: "127.0.0.1";
  port: number;
  userId: string;
  email: string;
  passwordHash: string;
  sessionTtlMs: number;
  cursorKey: Buffer;
  plannerMode: "disabled" | "dev_fixture" | "ai";
  /** Production kill switch; omitted in older fixtures means enabled. */
  readonly allowNewRuns?: boolean;
  /** Provider-call kill switch; omitted in older fixtures means enabled. */
  readonly allowProviderCalls?: boolean;
  /** Retrieval is explicit; all_tools remains the fail-safe default. */
  readonly aiRetrievalVariant?: "all_tools" | "semantic" | "semantic_qe";
  /** Maximum time the API worker waits for an active tick during shutdown. */
  readonly workerShutdownTimeoutMs?: number;
  readonly oidc?: OidcConfig;
  readonly legacyPasswordAuthEnabled?: boolean;
}

export interface OidcConfig {
  readonly enabled: boolean;
  readonly issuerUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly audience: string;
  readonly scopes: string[];
  readonly webOrigin: string;
  readonly sessionCookieName: string;
  readonly transactionTtlMs: number;
  readonly sessionTtlMs: number;
  readonly clockSkewSeconds: number;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Missing required configuration ${name}`);
  return value;
}

function integer(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const value = env[name] ?? String(fallback);
  if (!/^(0|[1-9][0-9]*)$/.test(value))
    throw new Error(`Invalid integer configuration ${name}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 65_535)
    throw new Error(`Invalid integer configuration ${name}`);
  return parsed;
}

function sessionTtl(env: NodeJS.ProcessEnv): number {
  const value = env.API_SESSION_TTL_MS ?? String(8 * 60 * 60 * 1000);
  if (!/^[1-9][0-9]*$/.test(value))
    throw new Error("Invalid integer configuration API_SESSION_TTL_MS");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > 24 * 60 * 60 * 1000)
    throw new Error("Invalid integer configuration API_SESSION_TTL_MS");
  return parsed;
}

function cursorKey(value: string): Buffer {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value))
    throw new Error("API_CURSOR_KEY must be canonical base64 for 32 bytes");
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32 || decoded.toString("base64") !== value)
    throw new Error("API_CURSOR_KEY must be canonical base64 for 32 bytes");
  return decoded;
}

function boolean(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: boolean,
): boolean {
  const raw = (env[name] ?? (fallback ? "1" : "0")).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  throw new Error(`Invalid boolean configuration ${name}`);
}

function oidcString(
  env: NodeJS.ProcessEnv,
  name: string,
  enabled: boolean,
): string {
  const value = env[name]?.trim() ?? "";
  if (enabled && !value)
    throw new Error(`Missing required configuration ${name}`);
  return value;
}

function oidcPositiveInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  max: number,
): number {
  const value = env[name] ?? String(fallback);
  if (!/^[1-9][0-9]*$/.test(value))
    throw new Error(`Invalid integer configuration ${name}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > max)
    throw new Error(`Invalid integer configuration ${name}`);
  return parsed;
}

function oidcScopes(env: NodeJS.ProcessEnv, enabled: boolean): string[] {
  const raw = env.OIDC_SCOPES ?? "openid,profile,email";
  const parts = raw.split(",").map((scope) => scope.trim());
  const scopes = parts.filter(Boolean);
  if (enabled && parts.some((scope) => !scope))
    throw new Error("Invalid configuration OIDC_SCOPES");
  if (
    enabled &&
    (!scopes.includes("openid") || scopes.length !== new Set(scopes).size)
  )
    throw new Error("Invalid configuration OIDC_SCOPES");
  if (enabled && scopes.some((scope) => !/^[A-Za-z0-9._:-]+$/.test(scope)))
    throw new Error("Invalid configuration OIDC_SCOPES");
  return scopes;
}

function parseOrigin(value: string, name: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid configuration ${name}`);
  }
  if (
    !parsed.port &&
    (parsed.protocol === "http:" || parsed.protocol === "https:")
  ) {
    // URL.port is empty for default ports and is valid here.
  }
  if (
    !/^https?:$/.test(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  )
    throw new Error(`Invalid configuration ${name}`);
  return parsed;
}

function oidcConfig(env: NodeJS.ProcessEnv, sessionTtlMs: number): OidcConfig {
  const enabled = boolean(env, "OIDC_ENABLED", false);
  const issuerUrl = oidcString(env, "OIDC_ISSUER_URL", enabled);
  const clientId = oidcString(env, "OIDC_CLIENT_ID", enabled);
  const clientSecret = oidcString(env, "OIDC_CLIENT_SECRET", enabled);
  const redirectUri = oidcString(env, "OIDC_REDIRECT_URI", enabled);
  const audience = oidcString(env, "OIDC_AUDIENCE", enabled);
  const webOrigin = oidcString(env, "OIDC_WEB_ORIGIN", enabled);
  const scopes = oidcScopes(env, enabled);
  const sessionCookieName =
    env.OIDC_SESSION_COOKIE_NAME?.trim() || "wap_session";
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(sessionCookieName))
    throw new Error("Invalid configuration OIDC_SESSION_COOKIE_NAME");
  const transactionTtlMs = oidcPositiveInteger(
    env,
    "OIDC_TRANSACTION_TTL_MS",
    10 * 60 * 1000,
    15 * 60 * 1000,
  );
  const configuredSessionTtl = oidcPositiveInteger(
    env,
    "OIDC_SESSION_TTL_MS",
    sessionTtlMs,
    24 * 60 * 60 * 1000,
  );
  const clockSkewSeconds = oidcPositiveInteger(
    env,
    "OIDC_CLOCK_SKEW_SECONDS",
    60,
    300,
  );
  if (!enabled)
    return {
      enabled,
      issuerUrl,
      clientId,
      clientSecret,
      redirectUri,
      audience,
      scopes,
      webOrigin,
      sessionCookieName,
      transactionTtlMs,
      sessionTtlMs: configuredSessionTtl,
      clockSkewSeconds,
    };
  const issuer = parseOrigin(issuerUrl, "OIDC_ISSUER_URL");
  const redirect = parseOrigin(redirectUri, "OIDC_REDIRECT_URI");
  parseOrigin(webOrigin, "OIDC_WEB_ORIGIN");
  const loopback = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (issuer.protocol !== "https:" && !loopback.has(issuer.hostname))
    throw new Error("OIDC_ISSUER_URL must use HTTPS outside local loopback");
  if (redirect.protocol !== "https:" && !loopback.has(redirect.hostname))
    throw new Error("OIDC_REDIRECT_URI must use HTTPS outside local loopback");
  return {
    enabled,
    issuerUrl: issuer.toString().replace(/\/$/, ""),
    clientId,
    clientSecret,
    redirectUri: redirect.toString(),
    audience,
    scopes,
    webOrigin,
    sessionCookieName,
    transactionTtlMs,
    sessionTtlMs: configuredSessionTtl,
    clockSkewSeconds,
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const userId = env.G1_USER_ID ?? DEMO_USER_ID;
  z.uuid().parse(userId);
  const email = required(env, "API_DEMO_EMAIL");
  const passwordHash = required(env, "API_DEMO_PASSWORD_HASH");
  parsePasswordHash(passwordHash);
  const rawPlannerMode =
    env.WAP_PLANNER_MODE ?? env.API_PLANNER_MODE ?? "disabled";
  if (
    rawPlannerMode !== "disabled" &&
    rawPlannerMode !== "dev_fixture" &&
    rawPlannerMode !== "ai"
  )
    throw new Error("Invalid configuration API_PLANNER_MODE");
  const plannerMode = rawPlannerMode;
  const allowNewRuns = boolean(env, "API_NEW_RUNS_ENABLED", true);
  const allowProviderCalls = boolean(env, "AI_PROVIDER_CALLS_ENABLED", true);
  const rawRetrievalVariant = env.AI_RETRIEVAL_VARIANT ?? "all_tools";
  if (
    rawRetrievalVariant !== "all_tools" &&
    rawRetrievalVariant !== "semantic" &&
    rawRetrievalVariant !== "semantic_qe"
  )
    throw new Error("Invalid configuration AI_RETRIEVAL_VARIANT");
  const aiRetrievalVariant = rawRetrievalVariant;
  const workerShutdownTimeoutMs = integer(
    env,
    "API_WORKER_SHUTDOWN_TIMEOUT_MS",
    30_000,
  );
  const sessionTtlMs = sessionTtl(env);
  const oidc = oidcConfig(env, sessionTtlMs);
  const legacyPasswordAuthEnabled = boolean(
    env,
    "API_LEGACY_PASSWORD_AUTH_ENABLED",
    !oidc.enabled,
  );
  return {
    host: "127.0.0.1",
    port: integer(env, "API_PORT", 3001),
    userId,
    email,
    passwordHash,
    sessionTtlMs,
    cursorKey: cursorKey(required(env, "API_CURSOR_KEY")),
    plannerMode,
    allowNewRuns,
    allowProviderCalls,
    aiRetrievalVariant,
    workerShutdownTimeoutMs,
    oidc,
    legacyPasswordAuthEnabled,
  };
}
