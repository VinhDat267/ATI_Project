// Trang chủ "Cần bạn" (redesign 11/2026): việc đang chờ người dùng, trên PostgreSQL thật.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import { createConversationRoutes } from '../../src/routes/conversation-routes.js';
import { sealPlanOrigin } from '../../src/services/slack/slack-plan-origin.js';

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
  async function plan(convId: string, status: string, options: {
    expiresInMinutes?: number;
    createdSecondsAgo?: number;
    steps?: number;
    unavailableLineage?: boolean;
    unsealed?: boolean;
    invalidJiraBinding?: boolean;
    malformedLegacyPayload?: boolean;
  } = {}) {
    const json = {
      summary: `Kế hoạch ${status}`,
      steps: Array.from({ length: options.steps ?? 2 }, (_, i) => ({ id: `step_${i + 1}` })),
      ...(options.invalidJiraBinding ? { connections: { myjira: {} } } : {}),
    };
    const payload = JSON.stringify(options.malformedLegacyPayload ? 'Malformed legacy text' : json);
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO plans (conv_id, plan_json, plan_text, plan_hash, status, expires_at, created_at, slack_lineage_manifest)
         VALUES ($1, $2::jsonb, $3, $4, $5, now() + make_interval(mins => $6), now() - make_interval(secs => $7), $8::jsonb)
         RETURNING id`,
        [convId, payload, payload, randomUUID(), status, options.expiresInMinutes ?? 30,
          options.createdSecondsAgo ?? 0, options.unavailableLineage ? JSON.stringify(['plan_json', 'plan_text', 'plan_hash']) : null]
      );
      const id = rows[0]!.id;
      if (!options.unavailableLineage && !options.unsealed) await sealPlanOrigin(client, 'plans', id, 'plan_writer');
      await client.query('COMMIT');
      return id;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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
    expect(result.needsAttention[0]?.planId).toBe(partialPlan);
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

  it('fills each queue independently when newer items would consume the shared limit', async () => {
    const me = await db.person();
    const run = await plan(await conversation(me.id, 'Đối soát trước đó'), 'unknown', { createdSecondsAgo: 60 });
    const pending = await plan(await conversation(me.id, 'Chờ mới nhất'), 'pending');
    await plan(await conversation(me.id, 'Chờ thứ hai'), 'pending', { createdSecondsAgo: 30 });

    const result = await repo.listAttention(me.id, { workspaceMode: 'personal' }, 1);
    expect(result.pendingPlans.map(row => row.planId)).toEqual([pending]);
    expect(result.needsAttention.map(row => row.planId)).toEqual([run]);
  });

  it('continues to surface the latest unresolved execution after a newer proposal was rejected', async () => {
    const me = await db.person();
    const unresolved = await conversation(me.id, 'Lượt chạy chưa rõ');
    const run = await plan(unresolved, 'unknown', { createdSecondsAgo: 60 });
    await plan(unresolved, 'rejected');
    const resolved = await conversation(me.id, 'Đã có lượt chạy mới hơn');
    await plan(resolved, 'unknown', { createdSecondsAgo: 60 });
    await plan(resolved, 'completed');

    const result = await repo.listAttention(me.id, { workspaceMode: 'personal' });
    expect(result.pendingPlans).toEqual([]);
    expect(result.needsAttention.map(row => row.planId)).toEqual([run]);
  });

  it('prioritizes recovery when the same conversation also has a pending plan beyond the run limit', async () => {
    const me = await db.person();
    const blocked = await conversation(me.id, 'Yêu cầu còn phải đối soát');
    const blockedRun = await plan(blocked, 'unknown', { createdSecondsAgo: 60 });
    await plan(blocked, 'pending');
    const newerRun = await plan(await conversation(me.id, 'Đối soát gần đây hơn'), 'unknown', { createdSecondsAgo: 30 });
    const available = await conversation(me.id, 'Yêu cầu có thể duyệt');
    await plan(available, 'unknown', { unavailableLineage: true, createdSecondsAgo: 60 });
    const availablePlan = await plan(available, 'pending', { createdSecondsAgo: 10 });

    const scoped = await repo.listAttention(me.id, { workspaceMode: 'personal' }, 1);
    expect(scoped.pendingPlans.map(row => row.planId)).toEqual([availablePlan]);
    expect(scoped.needsAttention.map(row => row.planId)).toEqual([newerRun]);
    const all = await repo.listAttention(me.id, { workspaceMode: 'personal' });
    expect(all.needsAttention.map(row => row.planId)).toContain(blockedRun);
  });

  it('omits plans with unavailable provenance and fills the pending slot from readable plans', async () => {
    const me = await db.person();
    await plan(await conversation(me.id, 'Nguồn Slack không còn khả dụng'), 'pending', { unavailableLineage: true });
    await plan(await conversation(me.id, 'Kế hoạch cũ chưa được niêm phong'), 'pending', { unsealed: true, createdSecondsAgo: 10 });
    await plan(await conversation(me.id, 'Lượt chạy không còn nguồn'), 'unknown', { unavailableLineage: true });
    await plan(await conversation(me.id, 'Kế hoạch Jira mất ràng buộc'), 'pending', { invalidJiraBinding: true, createdSecondsAgo: 15 });
    for (let i = 0; i < 6; i++) {
      await plan(await conversation(me.id, `Kế hoạch chưa được niêm phong ${i}`), 'pending', { unsealed: true, createdSecondsAgo: 20 + i });
    }
    const readable = await plan(await conversation(me.id, 'Kế hoạch hợp lệ'), 'pending', { createdSecondsAgo: 30 });

    const result = await repo.listAttention(me.id, { workspaceMode: 'personal' }, 1);
    expect(result.pendingPlans.map(row => row.planId)).toEqual([readable]);
    expect(result.needsAttention).toEqual([]);
  });

  it('skips an unreadable legacy JSON string without failing the rest of the queue', async () => {
    const me = await db.person();
    await plan(await conversation(me.id, 'Kế hoạch cũ bị lỗi định dạng'), 'pending', { malformedLegacyPayload: true });
    const readable = await plan(await conversation(me.id, 'Kế hoạch hợp lệ'), 'pending', { createdSecondsAgo: 30 });
    const result = await repo.listAttention(me.id, { workspaceMode: 'personal' }, 1);
    expect(result.pendingPlans.map(row => row.planId)).toEqual([readable]);
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
