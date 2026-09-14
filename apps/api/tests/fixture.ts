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
  call(path: string, init?: RequestInit): Promise<Response>;
  close(): Promise<void>;
}

export async function makeApiFixture(): Promise<ApiFixture> {
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
    plannerMode: "disabled",
  };
  const api = createApi({ db, config });
  const baseUrl = await api.listen();
  let closed = false;
  return {
    baseUrl,
    db,
    api,
    userId,
    email,
    password,
    call(path, init = {}) {
      return fetch(`${baseUrl}${path}`, init);
    },
    async close() {
      if (closed) return;
      closed = true;
      await api.close();
      await db.close();
      await admin.unsafe(`DROP DATABASE "${dbName}" WITH (FORCE)`);
      await admin.end();
    },
  };
}
