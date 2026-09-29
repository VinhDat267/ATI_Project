#!/usr/bin/env node
import { spawnSync, spawn } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import process from "node:process";

function hashPasswordSync(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64, {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 33_554_432,
  });
  return `scrypt$16384$8$1$${salt.toString("hex")}$${key.toString("hex")}`;
}

const demoEmail = process.env.API_DEMO_EMAIL || "demo@local";
const demoPassword = process.env.API_DEMO_PASSWORD || "synthetic-password";
const passwordHash =
  process.env.API_DEMO_PASSWORD_HASH || hashPasswordSync(demoPassword);
const cursorKey =
  process.env.API_CURSOR_KEY || randomBytes(32).toString("base64");
const plannerMode = process.env.API_PLANNER_MODE || "dev_fixture";

const env = {
  ...process.env,
  API_HOST: process.env.API_HOST || "0.0.0.0",
  API_PORT: process.env.API_PORT || "3001",
  API_DEMO_EMAIL: demoEmail,
  API_DEMO_PASSWORD_HASH: passwordHash,
  API_CURSOR_KEY: cursorKey,
  API_PLANNER_MODE: plannerMode,
  AI_PLANNING_PROVIDER: process.env.AI_PLANNING_PROVIDER || "google",
  AI_PLANNING_MODEL: process.env.AI_PLANNING_MODEL || "gemini-3.5-flash",
  AI_QE_PROVIDER: process.env.AI_QE_PROVIDER || "google",
  AI_QE_MODEL: process.env.AI_QE_MODEL || "gemini-3.5-flash",
  AI_EMBEDDING_PROVIDER: process.env.AI_EMBEDDING_PROVIDER || "google",
  AI_EMBEDDING_MODEL: process.env.AI_EMBEDDING_MODEL || "gemini-embedding-001",
  AI_EMBEDDING_DIMENSIONS: process.env.AI_EMBEDDING_DIMENSIONS || "1536",
};

console.log("[DOCKER-API] Running PostgreSQL migrations...");
const mig = spawnSync("node", ["packages/db/dist/cli.js", "migrate"], {
  env,
  stdio: "inherit",
});
if (mig.status !== 0) process.exit(mig.status ?? 1);

console.log("[DOCKER-API] Seeding initial database state...");
const seed = spawnSync("node", ["packages/db/dist/cli.js", "seed"], {
  env,
  stdio: "inherit",
});
if (seed.status !== 0) process.exit(seed.status ?? 1);

const { openDatabase } = await import("@wap/db");
const db = openDatabase(
  process.env.G1_DATABASE_URL || "postgresql://wap:wap@postgres:5432/wap_g1",
);
const demoUserId =
  process.env.API_DEMO_USER_ID || "00000000-0000-4000-8000-000000000001";
await db.client`
  INSERT INTO users (id, email, password_hash, display_name)
  VALUES (${demoUserId}, ${demoEmail}, ${passwordHash}, 'Operator')
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email, password_hash = EXCLUDED.password_hash
`;
await db.close();

console.log(
  `[DOCKER-API] Starting API server on ${env.API_HOST}:${env.API_PORT} (demo email: ${demoEmail})...`,
);
const child = spawn("node", ["apps/api/dist/main.js"], {
  env,
  stdio: "inherit",
});

process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
child.on("exit", (code) => process.exit(code ?? 0));
