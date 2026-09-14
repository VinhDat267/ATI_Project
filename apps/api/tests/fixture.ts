import { randomUUID } from "node:crypto";
import postgres from "postgres";
import {
  DEMO_USER_ID,
  migrate,
  openDatabase,
  seedDemo,
  type Database,
} from "@wap/db";
import { createApi, type ApiRuntime } from "../src/app.js";
import { hashPassword } from "../src/auth.js";
import type { ApiConfig } from "../src/config.js";
import { loadDevPlanner } from "../src/dev-planner.js";
import { createPrepareWorker, type WorkerControl } from "../src/worker.js";
import { createExpiryMaintenance } from "../src/maintenance.js";
import { WorkflowEngine, openLocalGateway, type Gateway } from "@wap/engine";
import { fileURLToPath } from "node:url";
import path from "node:path";

const adminUrl =
  process.env.API_TEST_ADMIN_URL ??
  "postgresql://wap:wap@127.0.0.1:55432/wap_g1";

export interface ApiFixture {
  baseUrl: string;
  db: Database;
  api: ApiRuntime;
  userId: string;
  email: string;
  password: string;
  b02Prompt: string;
  login(): Promise<string>;
  call(path: string, init?: RequestInit): Promise<Response>;
  close(): Promise<void>;
}

export async function makeApiFixture(
  options: {
    workerEnabled?: boolean;
    plannerMode?: "disabled" | "dev_fixture";
    filesystemEnabled?: boolean;
  } = {},
): Promise<ApiFixture> {
  const dbName = `api_it_${randomUUID().replaceAll("-", "")}`;
  const address = new URL(adminUrl);
  address.pathname = `/${dbName}`;
  const databaseUrl = address.href;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
  await admin.unsafe(`CREATE DATABASE "${dbName}"`);
  const userId = DEMO_USER_ID;
  const email = `${dbName}@local.invalid`;
  const password = `test-${randomUUID()}`;
  const passwordHash = await hashPassword(password);
  await migrate(databaseUrl);
  const db = openDatabase(databaseUrl);
  await seedDemo(db, userId);
  await db.client`UPDATE users SET email=${email},password_hash=${passwordHash} WHERE id=${userId}`;
  const config: ApiConfig = {
    host: "127.0.0.1",
    port: 0,
    userId,
    email,
    passwordHash,
    sessionTtlMs: 60_000,
    cursorKey: Buffer.alloc(32, 7),
    plannerMode: options.plannerMode ?? "disabled",
  };
  const root = path.resolve(
    fileURLToPath(new URL("../../../", import.meta.url)),
  );
  const planner =
    config.plannerMode === "dev_fixture" ? loadDevPlanner(root) : undefined;
  let gateway: Gateway | undefined;
  let worker: WorkerControl | undefined;
  if (options.workerEnabled) {
    gateway = await openLocalGateway({ root, databaseUrl, userId });
  }
  const engine = new WorkflowEngine(db, gateway, userId);
  if (options.workerEnabled && planner)
    worker = createPrepareWorker({ db, userId, engine, planner });
  const maintenance = createExpiryMaintenance({ engine });
  const api = createApi({ db, config, engine, worker, maintenance });
  const baseUrl = await api.listen();
  worker?.start();
  maintenance.start();
  let closed = false;
  return {
    baseUrl,
    db,
    api,
    userId,
    email,
    password,
    b02Prompt: planner?.b02Prompt ?? "",
    async login() {
      const response = await fetch(`${baseUrl}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (response.status !== 200)
        throw new Error(`Login failed: ${response.status}`);
      const body = (await response.json()) as { token?: string };
      if (!body.token)
        throw new Error("Login response did not contain a token");
      return body.token;
    },
    call(path, init = {}) {
      return fetch(`${baseUrl}${path}`, init);
    },
    async close() {
      if (closed) return;
      closed = true;
      await api.close();
      await gateway?.close();
      await db.close();
      await admin.unsafe(`DROP DATABASE "${dbName}" WITH (FORCE)`);
      await admin.end();
    },
  };
}
