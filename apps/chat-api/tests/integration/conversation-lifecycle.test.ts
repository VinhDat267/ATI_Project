import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createApp } from "../../src/app.js";
import { ConversationRepo } from "../../src/db/repositories/conversation-repo.js";
import { MessageRepo } from "../../src/db/repositories/message-repo.js";
import { UserRepo } from "../../src/db/repositories/user-repo.js";
import { generateTokens } from "../../src/auth/jwt.js";
import { PlanRepo } from "../../src/db/repositories/plan-repo.js";
import { ExecutionService } from "../../src/services/execution-service.js";
import { SSEManager } from "../../src/sse/sse-manager.js";

const schema = `ui_lifecycle_${randomUUID().replaceAll("-", "")}`;
const root = new URL("../../../../db/v3/", import.meta.url);
const databaseUrl =
  process.env.DATABASE_URL || "postgresql://wap:wap@127.0.0.1:55532/ati_v3";
const scoped = new URL(databaseUrl);
scoped.searchParams.set("options", `-c search_path=${schema}`);
scoped.searchParams.set("application_name", schema);
const secret = "ui-lifecycle-test-secret-at-least-32-bytes";
describe("conversation lifecycle with real PostgreSQL and HTTP", () => {
  let admin: pg.Pool,
    pool: pg.Pool,
    repo: ConversationRepo,
    app: ReturnType<typeof createApp>;
  let owner: string, token: string, otherToken: string;
  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({ connectionString: scoped.href });
    for (const file of ["0001_v3_core.sql", "0002_v3_invariants.sql"])
      await pool.query(await readFile(new URL(file, root), "utf8"));
    const migration = await readFile(
      new URL("0003_conversation_visibility.sql", root),
      "utf8",
    );
    await pool.query(migration);
    await pool.query(migration);
    repo = new ConversationRepo(pool);
    const users = new UserRepo(pool);
    const user = await users.createUser({
      email: "owner@lifecycle.test",
      name: "Owner",
      password: "Fixture-only",
    });
    const other = await users.createUser({
      email: "other@lifecycle.test",
      name: "Other",
      password: "Fixture-only",
    });
    owner = user.id;
    token = generateTokens(user, secret).accessToken;
    otherToken = generateTokens(other, secret).accessToken;
    const executionService = new ExecutionService({
      convRepo: repo,
      planRepo: new PlanRepo(pool),
      adapterFactory: {
        getAdapterForService: () => {
          throw new Error("This test must never dispatch an adapter");
        },
      },
    });
    app = createApp({
      jwtSecret: secret,
      convRepo: repo,
      msgRepo: new MessageRepo(pool),
      chatService: {} as any,
      executionService,
      sseManager: new SSEManager(),
    });
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });
  const list = (filter: string) =>
    request(app)
      .get(`/api/conversations?filter=${filter}`)
      .set("Authorization", `Bearer ${token}`);

  it("archives and restores without changing execution status or messages; migration is idempotent", async () => {
    const conv = await repo.createConversation(owner);
    await pool.query(
      "UPDATE conversations SET status = 'completed' WHERE id = $1",
      [conv.id],
    );
    await pool.query(
      "INSERT INTO messages (conv_id, role, content) VALUES ($1, 'user', 'Preserved request')",
      [conv.id],
    );
    const archived = await request(app)
      .post(`/api/conversations/${conv.id}/archive`)
      .set("Authorization", `Bearer ${token}`);
    expect(archived.status).toBe(200);
    expect(archived.body.conversation.archived_at).toBeTruthy();
    expect(archived.body.conversation.status).toBe("completed");
    expect(
      (await list("active")).body.conversations.map((c: any) => c.id),
    ).not.toContain(conv.id);
    expect(
      (await list("archived")).body.conversations.map((c: any) => c.id),
    ).toContain(conv.id);
    expect(
      (
        await request(app)
          .get(`/api/conversations/${conv.id}`)
          .set("Authorization", `Bearer ${token}`)
      ).body.messages[0].content,
    ).toBe("Preserved request");
    const write = await request(app)
      .post(`/api/conversations/${conv.id}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .send({ content: "Do not ingest" });
    expect(write.status).toBe(409);
    const restored = await request(app)
      .post(`/api/conversations/${conv.id}/restore`)
      .set("Authorization", `Bearer ${token}`);
    expect(restored.status).toBe(200);
    expect(restored.body.conversation.archived_at).toBeNull();
    expect(
      (await list("active")).body.conversations.map((c: any) => c.id),
    ).toContain(conv.id);
    await pool.query(
      await readFile(new URL("0003_conversation_visibility.sql", root), "utf8"),
    );
    expect((await repo.getConversation(conv.id))?.status).toBe("completed");
  });

  it("soft deletes, hides direct reads and restores all original data", async () => {
    const conv = await repo.createConversation(owner);
    await pool.query(
      "INSERT INTO messages (conv_id, role, content) VALUES ($1, 'user', 'Keep this message')",
      [conv.id],
    );
    expect(
      (
        await request(app)
          .delete(`/api/conversations/${conv.id}`)
          .set("Authorization", `Bearer ${token}`)
      ).status,
    ).toBe(204);
    expect(
      (
        await request(app)
          .get(`/api/conversations/${conv.id}`)
          .set("Authorization", `Bearer ${token}`)
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get(`/api/conversations/${conv.id}/stream`)
          .set("Authorization", `Bearer ${token}`)
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get(`/api/conversations/${conv.id}/plans/active`)
          .set("Authorization", `Bearer ${token}`)
      ).status,
    ).toBe(404);
    expect(
      (await list("deleted")).body.conversations.map((c: any) => c.id),
    ).toContain(conv.id);
    expect(
      (
        await pool.query("SELECT content FROM messages WHERE conv_id = $1", [
          conv.id,
        ])
      ).rows[0].content,
    ).toBe("Keep this message");
    expect(
      (
        await request(app)
          .post(`/api/conversations/${conv.id}/restore`)
          .set("Authorization", `Bearer ${token}`)
      ).status,
    ).toBe(200);
    expect((await repo.getConversation(conv.id))?.deleted_at).toBeNull();
  });

  it("rejects other owners and missing authentication for every mutation", async () => {
    const conv = await repo.createConversation(owner);
    for (const action of ["archive", "restore", "delete"]) {
      const call = () =>
        action === "delete"
          ? request(app).delete(`/api/conversations/${conv.id}`)
          : request(app).post(`/api/conversations/${conv.id}/${action}`);
      expect(
        (await call().set("Authorization", `Bearer ${otherToken}`)).status,
      ).toBe(404);
      expect((await call()).status).toBe(401);
    }
    expect((await repo.getConversation(conv.id))?.archived_at).toBeNull();
  });

  it.each([
    "pending",
    "approved",
    "executing",
    "partial",
    "reconciliation_required",
  ])("does not hide a conversation with a %s plan", async (status) => {
    const conv = await repo.createConversation(owner);
    await pool.query(
      "INSERT INTO plans (conv_id, plan_json, plan_hash, status, expires_at) VALUES ($1, '{}', 'fixture', $2, now() + interval '1 hour')",
      [conv.id, status],
    );
    expect(
      (
        await request(app)
          .delete(`/api/conversations/${conv.id}`)
          .set("Authorization", `Bearer ${token}`)
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .post(`/api/conversations/${conv.id}/archive`)
          .set("Authorization", `Bearer ${token}`)
      ).status,
    ).toBe(409);
    expect((await repo.getConversation(conv.id))?.deleted_at).toBeNull();
  });

  it("serializes archiving behind a real SQL lock and sees the newly proposed plan", async () => {
    const conv = await repo.createConversation(owner);
    const proposal = await pool.connect();
    try {
      await proposal.query("BEGIN");
      await proposal.query(
        "SELECT id FROM conversations WHERE id = $1 FOR UPDATE",
        [conv.id],
      );
      const response = request(app)
        .post(`/api/conversations/${conv.id}/archive`)
        .set("Authorization", `Bearer ${token}`)
        .then((result) => result);
      const deadline = Date.now() + 3000;
      let locks;
      do {
        locks = await pool.query(
          "SELECT pid FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'",
          [schema],
        );
        if (locks.rowCount) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      } while (Date.now() < deadline);
      expect(locks?.rowCount).toBeGreaterThan(0);
      await proposal.query(
        "INSERT INTO plans (conv_id, plan_json, plan_hash, expires_at) VALUES ($1, '{}', 'fixture', now() + interval '1 hour')",
        [conv.id],
      );
      await proposal.query("COMMIT");
      expect((await response).status).toBe(409);
      expect((await repo.getConversation(conv.id))?.archived_at).toBeNull();
    } finally {
      await proposal.query("ROLLBACK");
      proposal.release();
    }
  });

  it("blocks approval if a background proposal arrives after archiving", async () => {
    const conv = await repo.createConversation(owner);
    expect(
      (
        await request(app)
          .post(`/api/conversations/${conv.id}/archive`)
          .set("Authorization", `Bearer ${token}`)
      ).status,
    ).toBe(200);
    const plan = await new PlanRepo(pool).createPlan({
      convId: conv.id,
      planJson: { steps: [] },
      planHash: "fixture",
      expiresAt: new Date(Date.now() + 60000),
    });
    const approval = await request(app)
      .post(`/api/plans/${plan.id}/approve`)
      .set("Authorization", `Bearer ${token}`);
    expect(approval.status).toBe(409);
    expect(
      (await pool.query("SELECT status FROM plans WHERE id = $1", [plan.id]))
        .rows[0].status,
    ).toBe("pending");
  });
});
