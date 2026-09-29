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

function runStep(label, cmd, args, env = process.env) {
  console.log(`\x1b[36m[SYSTEM]\x1b[0m ${label}...`);
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (res.status !== 0) {
    console.error(`\x1b[31m[ERROR]\x1b[0m Step failed: ${label}`);
    process.exit(res.status ?? 1);
  }
}

async function main() {
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

  const sharedEnv = {
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
    WAP_API_TARGET: process.env.WAP_API_TARGET || "http://127.0.0.1:3001",
    WAP_FRONTEND_ORIGIN:
      process.env.WAP_FRONTEND_ORIGIN || "http://127.0.0.1:5173",
  };

  // 1. Start Docker PostgreSQL & Redis
  runStep(
    "Khởi động Docker hạ tầng (PostgreSQL & Redis)",
    "docker",
    ["compose", "-f", "compose.g1.yaml", "up", "-d", "--wait"],
    sharedEnv,
  );

  // 2. Build core packages if dist is missing
  if (
    !existsSync(path.join(ROOT, "packages/db/dist/cli.js")) ||
    !existsSync(path.join(ROOT, "apps/mcp-task-hub/dist/server.js"))
  ) {
    runStep(
      "Build các gói nền tảng (@wap/dsl, @wap/db, @wap/mcp-task-hub, @wap/engine)",
      "npm",
      ["run", "build"],
      sharedEnv,
    );
  } else {
    runStep(
      "Chuẩn bị hợp đồng DSL (@wap/dsl)",
      "npm",
      ["run", "build", "-w", "@wap/dsl"],
      sharedEnv,
    );
  }

  // 3. Migrate & Seed Database
  runStep(
    "Chạy Database Migrations",
    "node",
    ["packages/db/dist/cli.js", "migrate"],
    sharedEnv,
  );
  runStep(
    "Khởi tạo dữ liệu nền (Seed)",
    "node",
    ["packages/db/dist/cli.js", "seed"],
    sharedEnv,
  );

  console.log("\n==============================================================");
  console.log("🚀 HỆ THỐNG ĐÃ SẴN SÀNG KHỞI CHẠY (1-COMMAND LIVE STACK)");
  console.log("--------------------------------------------------------------");
  console.log("🌐 Giao diện Web (Live Mode): http://127.0.0.1:5173");
  console.log("⚙️  Backend API Server      : http://127.0.0.1:3001");
  console.log(`🔑 Tài khoản đăng nhập     : ${demoEmail}`);
  console.log(`🔒 Mật khẩu                : ${demoPassword}`);
  console.log(`🧠 Chế độ Planner          : ${plannerMode}`);
  console.log("==============================================================\n");

  const isWin = process.platform === "win32";
  const apiProc = spawn("npm", ["run", "dev", "-w", "@wap/api"], {
    cwd: ROOT,
    env: sharedEnv,
    stdio: "inherit",
    shell: isWin,
  });

  const webProc = spawn("npm", ["run", "dev:live", "-w", "@wap/web"], {
    cwd: ROOT,
    env: sharedEnv,
    stdio: "inherit",
    shell: isWin,
  });

  const shutdown = () => {
    console.log("\n\x1b[33m[SYSTEM]\x1b[0m Đang dừng các tiến trình API và Web...");
    apiProc.kill();
    webProc.kill();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
