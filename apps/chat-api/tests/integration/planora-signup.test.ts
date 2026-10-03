import { beforeAll, afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createApp } from "../../src/app.js";
import {
  UserRepo,
  verifyPassword,
} from "../../src/db/repositories/user-repo.js";
import { hashToken } from "../../src/auth/accounts.js";

const schema = `planora_auth_${randomUUID().replaceAll("-", "")}`;
const db =
  process.env.DATABASE_URL || "postgresql://wap:wap@127.0.0.1:55532/ati_v3";
const scoped = new URL(db);
scoped.searchParams.set("options", `-c search_path=${schema}`);
const migrations = new URL("../../../../db/v3/", import.meta.url);
const password = "Registration-fixture-only-2026";
describe("Planora registration — real PostgreSQL and HTTP", () => {
  let root: pg.Pool,
    pool: pg.Pool,
    app: ReturnType<typeof createApp>,
    adminToken: string;
  let memberId: string, adminId: string;
  beforeAll(async () => {
    root = new pg.Pool({ connectionString: db });
    await root.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({ connectionString: scoped.href });
    await pool.query(
      await readFile(new URL("0001_v3_core.sql", migrations), "utf8"),
    );
    const users = new UserRepo(pool);
    adminId = (
      await users.createUser({
        email: "admin@planora.test",
        name: "Admin fixture",
        password,
      })
    ).id;
    for (const file of (await readdir(migrations))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await pool.query(await readFile(new URL(file, migrations), "utf8"));
    app = createApp({
      jwtSecret: "planora-test-secret-at-least-32-bytes",
      userRepo: users,
      serviceAdminUserIds: [adminId],
    });
    adminToken = (
      await request(app)
        .post("/api/auth/login")
        .send({ email: "admin@planora.test", password })
    ).body.accessToken;
  });
  afterAll(async () => {
    await pool?.end();
    await root?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await root?.end();
  });
  const signup = (email = "member@planora.test") =>
    request(app)
      .post("/api/auth/signup")
      .send({ name: "Thành viên Planora", email, password });
  const latestToken = async (email = "member@planora.test") => {
    const mail = (
      await pool.query(
        "SELECT body_text FROM email_outbox WHERE to_address=$1 AND subject LIKE 'Xác minh%' ORDER BY created_at DESC, id DESC LIMIT 1",
        [email],
      )
    ).rows[0];
    return new URL(mail.body_text.match(/https?:\/\/\S+/)[0]).searchParams.get(
      "token",
    );
  };
  it("creates a pending account, sends verification, never exposes duplicate emails or plaintext secrets", async () => {
    const res = await signup();
    expect(res.status).toBe(202);
    const row = (
      await pool.query("SELECT * FROM users WHERE email=$1", [
        "member@planora.test",
      ])
    ).rows[0];
    memberId = row.id;
    expect(row.status).toBe("pending");
    expect(row.email_verified).toBe(false);
    expect(row.password).not.toBe(password);
    expect(verifyPassword(password, row.password)).toBe(true);
    const token = await latestToken();
    expect(token).toBeTruthy();
    const saved = (
      await pool.query("SELECT token_hash FROM auth_tokens WHERE user_id=$1", [
        memberId,
      ])
    ).rows[0];
    expect(saved.token_hash).not.toBe(token);
    expect(saved.token_hash).toHaveLength(64);
    const duplicate = await signup();
    expect(duplicate.status).toBe(res.status);
    expect(duplicate.body).toEqual(res.body);
    expect(
      (
        await pool.query("SELECT id FROM users WHERE email=$1", [
          "member@planora.test",
        ])
      ).rowCount,
    ).toBe(1);
  });
  it("validates passwords and rejects unverified/pending accounts without leaking status for wrong passwords", async () => {
    expect(
      (
        await request(app)
          .post("/api/auth/signup")
          .send({ name: "Test", email: "weak@planora.test", password: "short" })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post("/api/auth/login")
          .send({ email: "member@planora.test", password: "wrong" })
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post("/api/auth/login")
          .send({ email: "member@planora.test", password })
      ).body.code,
    ).toBe("EMAIL_UNVERIFIED");
    expect(
      (
        await request(app)
          .post(`/api/admin/users/${memberId}/approve`)
          .set("Authorization", `Bearer ${adminToken}`)
      ).status,
    ).toBe(409);
  });
  it("resends invalidate old tokens; concurrent verification only succeeds once; pending stays pending", async () => {
    const old = await latestToken();
    expect(
      (
        await request(app)
          .post("/api/auth/resend-verification")
          .send({ email: "member@planora.test" })
      ).status,
    ).toBe(202);
    expect(
      (await request(app).post("/api/auth/verify-email").send({ token: old }))
        .status,
    ).toBe(400);
    const token = await latestToken();
    const pair = await Promise.all(
      [1, 2].map(() =>
        request(app).post("/api/auth/verify-email").send({ token }),
      ),
    );
    expect(pair.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(
      (
        await request(app)
          .post("/api/auth/login")
          .send({ email: "member@planora.test", password })
      ).body.code,
    ).toBe("ACCOUNT_PENDING");
  });
  it("only an active admin can approve, one approval wins, then member can login and cannot administer", async () => {
    expect(
      (await request(app).post(`/api/admin/users/${memberId}/approve`)).status,
    ).toBe(401);
    const pair = await Promise.all(
      [1, 2].map(() =>
        request(app)
          .post(`/api/admin/users/${memberId}/approve`)
          .set("Authorization", `Bearer ${adminToken}`),
      ),
    );
    expect(pair.map((r) => r.status).sort()).toEqual([200, 409]);
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "member@planora.test", password });
    expect(login.status).toBe(200);
    expect(login.body.user.isAdmin).toBe(false);
    expect(
      (
        await request(app)
          .get("/api/admin/users")
          .set("Authorization", `Bearer ${login.body.accessToken}`)
      ).status,
    ).toBe(403);
    const listing = await request(app)
      .get("/api/admin/users")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(listing.status).toBe(200);
    expect(JSON.stringify(listing.body)).not.toContain("pbkdf2");
  });
  it("rotates refresh atomically, handles multi-tab grace, revokes access and refresh on logout", async () => {
    const login = (
      await request(app)
        .post("/api/auth/login")
        .send({ email: "member@planora.test", password })
    ).body;
    expect(login.refreshToken.split(".")).toHaveLength(1);
    const pair = await Promise.all(
      [1, 2].map(() =>
        request(app)
          .post("/api/auth/refresh")
          .send({ refreshToken: login.refreshToken }),
      ),
    );
    expect(pair.map((r) => r.status).sort()).toEqual([200, 409]);
    const refreshed = pair.find((r) => r.status === 200)!.body;
    expect(
      (
        await request(app)
          .post("/api/auth/logout")
          .set("Authorization", `Bearer ${refreshed.accessToken}`)
      ).status,
    ).toBe(204);
    expect(
      (
        await request(app)
          .get("/api/auth/me")
          .set("Authorization", `Bearer ${refreshed.accessToken}`)
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post("/api/auth/refresh")
          .send({ refreshToken: refreshed.refreshToken })
      ).status,
    ).toBe(401);
  });
  it("rejects expired and wrong-purpose verification tokens without changing the account", async () => {
    await signup("expired@planora.test");
    const token = await latestToken("expired@planora.test");
    await pool.query(
      "UPDATE auth_tokens SET expires_at=NOW()-INTERVAL '1 second' WHERE token_hash=$1",
      [hashToken(token!)],
    );
    expect(
      (await request(app).post("/api/auth/verify-email").send({ token }))
        .status,
    ).toBe(400);
    await pool.query(
      "UPDATE auth_tokens SET expires_at=NOW()+INTERVAL '1 hour',purpose='reset_password' WHERE token_hash=$1",
      [hashToken(token!)],
    );
    expect(
      (await request(app).post("/api/auth/verify-email").send({ token }))
        .status,
    ).toBe(400);
    expect(
      (
        await pool.query(
          "SELECT email_verified FROM users WHERE email='expired@planora.test'",
        )
      ).rows[0].email_verified,
    ).toBe(false);
  });
  it("detects refresh replay beyond grace and after several rotations; logout-all revokes other devices", async () => {
    const login = async () =>
      (
        await request(app)
          .post("/api/auth/login")
          .send({ email: "member@planora.test", password })
      ).body;
    const first = await login();
    const rotated = (
      await request(app)
        .post("/api/auth/refresh")
        .send({ refreshToken: first.refreshToken })
    ).body;
    const saved = (
      await pool.query(
        "SELECT refresh_token_hash FROM auth_sessions WHERE refresh_token_hash=$1",
        [hashToken(rotated.refreshToken)],
      )
    ).rows[0];
    expect(saved.refresh_token_hash).not.toBe(rotated.refreshToken);
    await pool.query(
      "UPDATE auth_sessions SET rotated_at=NOW()-INTERVAL '31 seconds' WHERE refresh_token_hash=$1",
      [hashToken(rotated.refreshToken)],
    );
    expect(
      (
        await request(app)
          .post("/api/auth/refresh")
          .send({ refreshToken: first.refreshToken })
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .get("/api/auth/me")
          .set("Authorization", `Bearer ${rotated.accessToken}`)
      ).status,
    ).toBe(401);
    const next = await login();
    const second = (
      await request(app)
        .post("/api/auth/refresh")
        .send({ refreshToken: next.refreshToken })
    ).body;
    const third = (
      await request(app)
        .post("/api/auth/refresh")
        .send({ refreshToken: second.refreshToken })
    ).body;
    expect(
      (
        await request(app)
          .post("/api/auth/refresh")
          .send({ refreshToken: next.refreshToken })
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .get("/api/auth/me")
          .set("Authorization", `Bearer ${third.accessToken}`)
      ).status,
    ).toBe(401);
    const deviceA = await login(),
      deviceB = await login();
    expect(
      (
        await request(app)
          .post("/api/auth/logout-all")
          .set("Authorization", `Bearer ${deviceA.accessToken}`)
      ).status,
    ).toBe(204);
    expect(
      (
        await request(app)
          .get("/api/auth/me")
          .set("Authorization", `Bearer ${deviceB.accessToken}`)
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post("/api/auth/refresh")
          .send({ refreshToken: deviceB.refreshToken })
      ).status,
    ).toBe(401);
  });
  it("limits registration, failed login and resend; closing signup keeps existing verification available", async () => {
    const options = {
      jwtSecret: "planora-test-secret-at-least-32-bytes",
      userRepo: new UserRepo(pool),
      serviceAdminUserIds: [adminId],
    };
    const limited = createApp(options);
    for (let i = 0; i < 10; i++)
      expect(
        (await request(limited).post("/api/auth/signup").send({})).status,
      ).toBe(400);
    const blocked = await request(limited).post("/api/auth/signup").send({});
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    for (let i = 0; i < 5; i++)
      expect(
        (
          await request(limited)
            .post("/api/auth/login")
            .send({ email: "missing@planora.test", password })
        ).status,
      ).toBe(401);
    expect(
      (
        await request(limited)
          .post("/api/auth/login")
          .send({ email: "missing@planora.test", password })
      ).status,
    ).toBe(429);
    for (let i = 0; i < 3; i++)
      expect(
        (
          await request(limited)
            .post("/api/auth/resend-verification")
            .send({ email: "expired@planora.test" })
        ).status,
      ).toBe(202);
    expect(
      (
        await request(limited)
          .post("/api/auth/resend-verification")
          .send({ email: "expired@planora.test" })
      ).status,
    ).toBe(429);
    const closed = createApp({ ...options, signupEnabled: false });
    expect(
      (await request(closed).get("/api/auth/config")).body.signupEnabled,
    ).toBe(false);
    expect(
      (
        await request(closed)
          .post("/api/auth/signup")
          .send({ name: "Closed", email: "closed@planora.test", password })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(closed)
          .post("/api/auth/verify-email")
          .send({ token: await latestToken("expired@planora.test") })
      ).status,
    ).toBe(200);
  });
  it("migration reruns preserve pending status, disabled users cannot use an existing access token", async () => {
    await signup("still-pending@planora.test");
    for (const file of (await readdir(migrations))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await pool.query(await readFile(new URL(file, migrations), "utf8"));
    expect(
      (
        await pool.query(
          "SELECT status FROM users WHERE email='still-pending@planora.test'",
        )
      ).rows[0].status,
    ).toBe("pending");
    const login = (
      await request(app)
        .post("/api/auth/login")
        .send({ email: "member@planora.test", password })
    ).body;
    await pool.query("UPDATE users SET status='disabled' WHERE id=$1", [
      memberId,
    ]);
    expect(
      (
        await request(app)
          .get("/api/auth/me")
          .set("Authorization", `Bearer ${login.accessToken}`)
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post("/api/auth/refresh")
          .send({ refreshToken: login.refreshToken })
      ).status,
    ).toBe(401);
  });
});
