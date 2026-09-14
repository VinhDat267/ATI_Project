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
  plannerMode: "disabled" | "dev_fixture";
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const userId = env.G1_USER_ID ?? DEMO_USER_ID;
  z.uuid().parse(userId);
  const email = required(env, "API_DEMO_EMAIL");
  const passwordHash = required(env, "API_DEMO_PASSWORD_HASH");
  parsePasswordHash(passwordHash);
  const plannerMode = env.API_PLANNER_MODE ?? "disabled";
  if (plannerMode !== "disabled" && plannerMode !== "dev_fixture")
    throw new Error("Invalid configuration API_PLANNER_MODE");
  return {
    host: "127.0.0.1",
    port: integer(env, "API_PORT", 3001),
    userId,
    email,
    passwordHash,
    sessionTtlMs: sessionTtl(env),
    cursorKey: cursorKey(required(env, "API_CURSOR_KEY")),
    plannerMode,
  };
}
