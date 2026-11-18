// Trang chủ "Cần bạn" (redesign 11/2026): việc đang chờ người dùng, trên PostgreSQL thật.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import { createConversationRoutes } from '../../src/routes/conversation-routes.js';

describe('ConversationRepo.listAttention and GET /api/conversations/attention', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let repo: ConversationRepo;
  beforeAll(async () => { db = await createMigratedSchema('conv_attention'); repo = new ConversationRepo(db.pool); });
  afterAll(async () => { await db?.close(); });

  // Tạo qua repo như code thật: hội thoại được niêm phong nguồn gốc, nên tiêu đề không bị che.
  async function conversation(userId: string, title: string, workspaceId: string | null = null) {
    const row = await repo.createConversation(userId, title, workspaceId ? { workspaceMode: 'organization', workspaceId } : { workspaceMode: 'personal' });
    return row.id;
  }
  async function plan(convId: string, status: string, options: { expiresInMinutes?: number; createdSecondsAgo?: number; steps?: number } = {}) {
    const json = { summary: `Kế hoạch ${status}`, steps: Array.from({ length: options.steps ?? 2 }, (_, i) => ({ id: `step_${i + 1}` })) };
    const { rows } = await db.pool.query<{ id: string }>(
      `INSERT INTO plans (conv_id, plan_json, plan_text, plan_hash, status, expires_at, created_at)
       VALUES ($1, $2::jsonb, $3, $4, $5, now() + make_interval(mins => $6), now() - make_interval(secs => $7)) RETURNING id`,
      [convId, JSON.stringify(json), JSON.stringify(json), randomUUID(), status, options.expiresInMinutes ?? 30, options.createdSecondsAgo ?? 0]
    );
    return rows[0].id;
  }
  async function workspace(createdBy: string, members: string[]) {
    const id = randomUUID();
    await db.pool.query(
      `INSERT INTO workspaces (id, name, invite_code, require_approval, created_by, created_at, updated_at)
       VALUES ($1, 'Nhóm thử', $2, false, $3, clock_timestamp(), clock_timestamp())`,
      [id, `INV-${id.slice(0, 8)}`.toUpperCase(), createdBy]
    );
    await db.pool.query(
      `INSERT INTO ati_workspaces (id, slug, status, version, created_by) VALUES ($1, $2, 'active', 1, $3)`,
      [id, `nhom-${id.slice(0, 8)}`, createdBy]
    );
    for (const userId of members) {
      await db.pool.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, status, created_at, updated_at)
         VALUES ($1, $2, 'member', 'active', clock_timestamp(), clock_timestamp())`,
        [id, userId]
      );
      await db.pool.query(
        `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version) VALUES ($1, $2, 'member', 'active', 1)`,
        [id, userId]
      );
    }
    return id;
  }

  it('lists the latest pending, unexpired plan and the runs that need a person, nothing else', async () => {
    const me = await db.person();
    const pending = await conversation(me.id, 'Tạo thẻ Trello');
    const pendingPlan = await plan(pending, 'pending', { steps: 3 });
    const expired = await conversation(me.id, 'Kế hoạch đã hết hạn');
    await plan(expired, 'pending', { expiresInMinutes: -1 });
    const superseded = await conversation(me.id, 'Đã chạy xong sau khi chờ');
    await plan(superseded, 'pending', { createdSecondsAgo: 60 });
    await plan(superseded, 'completed');
    const partial = await conversation(me.id, 'Chạy dở');
    const partialPlan = await plan(partial, 'partial', { createdSecondsAgo: 5 });
    const reconcile = await conversation(me.id, 'Cần đối soát');
    await plan(reconcile, 'reconciliation_required', { createdSecondsAgo: 10 });
    const unknown = await conversation(me.id, 'Chưa rõ kết quả');
    await plan(unknown, 'unknown', { createdSecondsAgo: 15 });
    for (const status of ['completed', 'rejected', 'stopped', 'failed', 'approved']) await plan(await conversation(me.id, status), status);

    const result = await repo.listAttention(me.id, { workspaceMode: 'personal' });
    expect(result.pendingPlans).toEqual([
      { conversationId: pending, title: 'Tạo thẻ Trello', planId: pendingPlan, summary: 'Kế hoạch pending', stepCount: 3, expiresAt: expect.any(String) },
    ]);
    expect(result.needsAttention.map(row => [row.conversationId, row.status])).toEqual([
      [partial, 'partial'], [reconcile, 'reconciliation_required'], [unknown, 'unknown'],
    ]);
    expect(result.needsAttention[0].planId).toBe(partialPlan);
  });

  it('never shows another user, and keeps personal and organization workspaces apart', async () => {
    const me = await db.person(), other = await db.person();
    const team = await workspace(me.id, [me.id, other.id]);
    const otherTeam = await workspace(other.id, [other.id, me.id]);
    const mine = await conversation(me.id, 'Của tôi');
    await plan(mine, 'pending');
    await plan(await conversation(other.id, 'Của người khác'), 'pending');
    const teamConv = await conversation(me.id, 'Trong nhóm', team);
    await plan(teamConv, 'pending');
    await plan(await conversation(other.id, 'Người khác trong nhóm', team), 'partial');
    await plan(await conversation(me.id, 'Nhóm khác', otherTeam), 'pending');

    const personal = await repo.listAttention(me.id, { workspaceMode: 'personal' });
    expect(personal.pendingPlans.map(row => row.conversationId)).toEqual([mine]);
    expect(personal.needsAttention).toEqual([]);
    const organization = await repo.listAttention(me.id, { workspaceMode: 'organization', workspaceId: team });
    expect(organization.pendingPlans.map(row => row.conversationId)).toEqual([teamConv]);
    expect(organization.needsAttention).toEqual([]);
    expect(await repo.listAttention('khong-phai-uuid', { workspaceMode: 'personal' })).toEqual({ pendingPlans: [], needsAttention: [] });
  });

  it('caps each list and serves the same result over HTTP for the request workspace', async () => {
    const me = await db.person();
    for (let index = 0; index < 4; index++) await plan(await conversation(me.id, `Chờ ${index}`), 'pending', { createdSecondsAgo: index });
    expect((await repo.listAttention(me.id, { workspaceMode: 'personal' }, 2)).pendingPlans.map(row => row.title)).toEqual(['Chờ 0', 'Chờ 1']);

    const app = express();
    app.use((req, _res, next) => {
      (req as any).user = req.headers['x-test-user'] ? { id: req.headers['x-test-user'] } : undefined;
      (req as any).workspace = { mode: 'personal', workspaceId: null };
      next();
    });
    app.use('/api/conversations', createConversationRoutes({ convRepo: repo, msgRepo: {} as any, chatService: {} as any }));
    const server = app.listen(0);
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/conversations/attention`;
      const ok = await fetch(`${base}?limit=3`, { headers: { 'x-test-user': me.id } });
      expect(ok.status).toBe(200);
      expect((await ok.json()).pendingPlans.map((row: { title: string }) => row.title)).toEqual(['Chờ 0', 'Chờ 1', 'Chờ 2']);
      expect((await fetch(base)).status).toBe(401);
      expect((await fetch(`${base}?limit=abc`, { headers: { 'x-test-user': me.id } })).status).toBe(400);
    } finally {
      server.close();
    }
  });
});
