#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined || process.env[key] === "") {
      process.env[key] = val;
    }
  }
}

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

loadDotEnv(path.join(ROOT, ".env"));

const demoEmail = process.env.API_DEMO_EMAIL || "demo@local";
const demoPassword = process.env.API_DEMO_PASSWORD || "synthetic-password";
const passwordHash =
  process.env.API_DEMO_PASSWORD_HASH || hashPasswordSync(demoPassword);
const cursorKey =
  process.env.API_CURSOR_KEY || randomBytes(32).toString("base64");
const dbUrl =
  process.env.G1_DATABASE_URL ||
  "postgresql://wap:wap@127.0.0.1:55532/wap_g1";
const plannerMode = process.env.API_PLANNER_MODE || "dev_fixture";

const env = {
  ...process.env,
  G1_DATABASE_URL: dbUrl,
  API_DEMO_EMAIL: demoEmail,
  API_DEMO_PASSWORD_HASH: passwordHash,
  API_CURSOR_KEY: cursorKey,
  API_PORT: process.env.API_PORT || "3001",
  API_PLANNER_MODE: plannerMode,
  AI_PLANNING_PROVIDER: process.env.AI_PLANNING_PROVIDER || "google",
  AI_PLANNING_MODEL: process.env.AI_PLANNING_MODEL || "gemini-3.5-flash",
  AI_QE_PROVIDER: process.env.AI_QE_PROVIDER || "google",
  AI_QE_MODEL: process.env.AI_QE_MODEL || "gemini-3.5-flash",
  AI_EMBEDDING_PROVIDER: process.env.AI_EMBEDDING_PROVIDER || "google",
  AI_EMBEDDING_MODEL: process.env.AI_EMBEDDING_MODEL || "gemini-embedding-001",
  AI_EMBEDDING_DIMENSIONS: process.env.AI_EMBEDDING_DIMENSIONS || "1536",
};

if (existsSync(path.join(ROOT, "packages/db/dist/cli.js"))) {
  spawnSync("node", ["packages/db/dist/cli.js", "migrate"], {
    cwd: ROOT,
    env,
    stdio: "inherit",
  });
  spawnSync("node", ["packages/db/dist/cli.js", "seed"], {
    cwd: ROOT,
    env,
    stdio: "inherit",
  });
}

console.log(
  `\x1b[32m[API]\x1b[0m Đang chạy tại http://127.0.0.1:${env.API_PORT} (Tài khoản: ${demoEmail} / ${demoPassword})`,
);

const child = spawn("npm", ["run", "dev", "-w", "@wap/api"], {
  cwd: ROOT,
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
child.on("exit", (code) => process.exit(code ?? 0));
