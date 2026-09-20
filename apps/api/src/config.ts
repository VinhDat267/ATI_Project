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
  const allowProviderCalls = boolean(
    env,
    "AI_PROVIDER_CALLS_ENABLED",
    true,
  );
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
  return {
    host: "127.0.0.1",
    port: integer(env, "API_PORT", 3001),
    userId,
    email,
    passwordHash,
    sessionTtlMs: sessionTtl(env),
    cursorKey: cursorKey(required(env, "API_CURSOR_KEY")),
    plannerMode,
    allowNewRuns,
    allowProviderCalls,
    aiRetrievalVariant,
    workerShutdownTimeoutMs,
  };
}
