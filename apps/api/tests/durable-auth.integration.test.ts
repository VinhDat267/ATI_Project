import { afterEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { migrate, openDatabase, type Database } from "@wap/db";
import { randomUUID } from "node:crypto";
import {
  createAuthRepository,
  type AuthRepository,
} from "../src/durable-auth.js";

const adminUrl =
  process.env.API_TEST_ADMIN_URL ??
  "postgresql://wap:wap@127.0.0.1:55532/wap_g1";

const opened: Array<{
  db: Database;
  admin: ReturnType<typeof postgres>;
  name: string;
}> = [];

afterEach(async () => {
  for (const { db, admin, name } of opened.splice(0)) {
    await db.close();
    await admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
});

async function makeRepository(): Promise<{
  repository: AuthRepository;
  db: Database;
}> {
  const name = `auth_it_${randomUUID().replaceAll("-", "")}`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  await migrate(url.href);
  const db = openDatabase(url.href);
  opened.push({ db, admin, name });
  return { repository: createAuthRepository(db), db };
}

describe("durable OIDC identity/session repository", () => {
  it("maps one provider subject, persists a hash-only session, and consumes a transaction once", async () => {
    const { repository, db } = await makeRepository();
    const user = await db.client<{ id: string }[]>`
      INSERT INTO users (email,password_hash,display_name)
      VALUES ('oidc-user@local.invalid','OIDC_MANAGED','OIDC User')
      RETURNING id`;
    const userId = user[0]!.id;
    const identity = await repository.findOrCreateIdentity({
      issuer: "http://127.0.0.1:8080/realms/wap",
      subject: "subject-1",
      email: "oidc-user@local.invalid",
      displayName: "OIDC User",
    });
    expect(identity.userId).toBe(userId);
    expect(
      await repository.findOrCreateIdentity({
        issuer: "http://127.0.0.1:8080/realms/wap",
        subject: "subject-1",
        email: "oidc-user@local.invalid",
        displayName: "OIDC User",
      }),
    ).toEqual(identity);

    const sessionHash = "a".repeat(64);
    await repository.createSession({
      sessionHash,
      userId,
      createdFrom: "oidc",
      issuer: "http://127.0.0.1:8080/realms/wap",
      subject: "subject-1",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const stored = await db.client<{ session_hash: string; user_id: string }[]>`
      SELECT session_hash,user_id FROM auth_sessions`;
    expect(stored).toEqual([{ session_hash: sessionHash, user_id: userId }]);
    expect(await repository.findSession(sessionHash)).toMatchObject({ userId });
    await repository.revokeSession(sessionHash);
    expect(await repository.findSession(sessionHash)).toBeNull();

    const transaction = await repository.createOidcTransaction({
      stateHash: "b".repeat(64),
      nonceHash: "c".repeat(64),
      verifierHash: "d".repeat(64),
      issuer: "http://127.0.0.1:8080/realms/wap",
      clientId: "wap-web",
      redirectUri: "http://127.0.0.1:3001/api/v1/auth/oidc/callback",
      returnTo: "/",
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(
      await repository.consumeOidcTransaction(transaction.stateHash),
    ).not.toBeNull();
    expect(
      await repository.consumeOidcTransaction(transaction.stateHash),
    ).toBeNull();
  });
});
