import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  LEGACY_JIRA_PAUSE_REASON,
  scanAndPauseLegacyJiraSchedules,
} from '../src/services/jira-legacy-migration.js';

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://ati_v3:ati_v3_local_only@127.0.0.1:56534/ati_v3';

describe('scanAndPauseLegacyJiraSchedules (real PostgreSQL)', () => {
  let pool: pg.Pool;
  const createdScheduleIds: string[] = [];
  const createdPlanIds: string[] = [];
  const createdConvIds: string[] = [];
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString });
  });

  afterAll(async () => {
    if (createdScheduleIds.length > 0) {
      await pool.query('DELETE FROM schedules WHERE id = ANY($1::uuid[])', [createdScheduleIds]);
    }
    if (createdPlanIds.length > 0) {
      await pool.query('DELETE FROM plans WHERE id = ANY($1::uuid[])', [createdPlanIds]);
    }
    if (createdConvIds.length > 0) {
      await pool.query('DELETE FROM messages WHERE conv_id = ANY($1::uuid[])', [createdConvIds]);
      await pool.query('DELETE FROM conversations WHERE id = ANY($1::uuid[])', [createdConvIds]);
    }
    if (createdUserIds.length > 0) {
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [createdUserIds]);
    }
    await pool.end();
  });

  async function seedUserAndConversation(label: string) {
    const userId = randomUUID();
    const convId = randomUUID();
    createdUserIds.push(userId);
    createdConvIds.push(convId);

    await pool.query(
      `INSERT INTO users (id, email, password, name)
       VALUES ($1, $2, 'pbkdf2$dummy', $3)`,
      [userId, `jira11-${label}-${userId}@example.test`, `User ${label}`]
    );
    await pool.query(
      `INSERT INTO conversations (id, user_id, status)
       VALUES ($1, $2, 'chatting')`,
      [convId, userId]
    );
    return { userId, convId };
  }

  it('supports dryRun without mutating active legacy Jira schedules or pending plans', async () => {
    const { userId, convId } = await seedUserAndConversation('dryrun');
    const scheduleId = randomUUID();
    const planId = randomUUID();
    createdScheduleIds.push(scheduleId);
    createdPlanIds.push(planId);

    await pool.query(
      `INSERT INTO schedules (id, user_id, conv_id, name, request, recurrence, services, status, version, next_run_at)
       VALUES ($1, $2, $3, 'Báo cáo Jira hàng ngày', 'Tạo ticket bằng jira.create_issue mỗi sáng', '{"kind":"daily","hour":9,"minute":0}'::jsonb, ARRAY['jira','slack'], 'active', 2, now() + interval '1 day')`,
      [scheduleId, userId, convId]
    );

    await pool.query(
      `INSERT INTO plans (id, conv_id, plan_json, plan_hash, status, expires_at)
       VALUES ($1, $2, $3::jsonb, 'hash-legacy-1', 'pending', now() + interval '30 minutes')`,
      [
        planId,
        convId,
        JSON.stringify({
          kind: 'plan',
          thinking: 'legacy jira',
          summary: 'Tạo issue Jira',
          steps: [{ id: 's1', tool: 'jira.create_issue', description: 'Create issue', args: { projectKey: 'FE', summary: 'Task' }, dependsOn: [] }],
          warnings: [],
        }),
      ]
    );

    const dryResult = await scanAndPauseLegacyJiraSchedules(pool, { dryRun: true });
    expect(dryResult.dryRun).toBe(true);
    expect(dryResult.pausedSchedules.some((s) => s.id === scheduleId)).toBe(true);
    expect(dryResult.pendingLegacyPlans.some((p) => p.id === planId)).toBe(true);
    expect(dryResult.expiredPlanIds).toHaveLength(0);
    expect(dryResult.notifiedConversationIds).toHaveLength(0);

    const afterDry = await pool.query(
      'SELECT status, pause_reason, version, next_run_at, services, request FROM schedules WHERE id = $1',
      [scheduleId]
    );
    expect(afterDry.rows[0].status).toBe('active');
    expect(afterDry.rows[0].pause_reason).toBeNull();
    expect(afterDry.rows[0].version).toBe(2);
    expect(afterDry.rows[0].next_run_at).not.toBeNull();
  });

  it('pauses active legacy Jira schedules with legacy_jira_retired, increments version, notifies owner, expires pending legacy plans, and leaves non-Jira schedules untouched', async () => {
    const legacyOwner = await seedUserAndConversation('legacy-active');
    const slackOwner = await seedUserAndConversation('slack-only');

    const legacyScheduleId = randomUUID();
    const slackScheduleId = randomUUID();
    const legacyPlanId = randomUUID();
    createdScheduleIds.push(legacyScheduleId, slackScheduleId);
    createdPlanIds.push(legacyPlanId);

    await pool.query(
      `INSERT INTO schedules (id, user_id, conv_id, name, request, recurrence, services, status, version, next_run_at)
       VALUES ($1, $2, $3, 'Đồng bộ Jira Sprint', 'Tổng hợp ticket Jira rồi gửi báo cáo Slack', '{"kind":"daily","hour":8,"minute":30}'::jsonb, ARRAY['jira','slack'], 'active', 4, now() + interval '2 hours')`,
      [legacyScheduleId, legacyOwner.userId, legacyOwner.convId]
    );

    await pool.query(
      `INSERT INTO schedules (id, user_id, conv_id, name, request, recurrence, services, status, version, next_run_at)
       VALUES ($1, $2, $3, 'Báo cáo Slack nội bộ', 'Gửi thông báo vào kênh general mỗi sáng', '{"kind":"daily","hour":9,"minute":0}'::jsonb, ARRAY['slack'], 'active', 1, now() + interval '3 hours')`,
      [slackScheduleId, slackOwner.userId, slackOwner.convId]
    );

    await pool.query(
      `INSERT INTO plans (id, conv_id, plan_json, plan_hash, status, expires_at)
       VALUES ($1, $2, $3::jsonb, 'hash-legacy-2', 'pending', now() + interval '25 minutes')`,
      [
        legacyPlanId,
        legacyOwner.convId,
        JSON.stringify({
          kind: 'plan',
          thinking: 'legacy comment',
          summary: 'Comment Jira',
          steps: [{ id: 's1', tool: 'jira.add_comment', description: 'Comment', args: { issueKey: 'FE-42', body: 'Done' }, dependsOn: [] }],
          warnings: [],
        }),
      ]
    );

    const applied = await scanAndPauseLegacyJiraSchedules(pool, {
      dryRun: false,
      notifyOwners: true,
      expirePendingPlans: true,
    });

    const paused = applied.pausedSchedules.find((s) => s.id === legacyScheduleId);
    expect(paused).toBeDefined();
    expect(paused?.status).toBe('paused');
    expect(paused?.pauseReason).toBe(LEGACY_JIRA_PAUSE_REASON);
    expect(paused?.version).toBe(5);
    // Must NEVER silently rewrite services or request to myjira
    expect(paused?.services).toEqual(['jira', 'slack']);
    expect(paused?.request).toBe('Tổng hợp ticket Jira rồi gửi báo cáo Slack');

    const dbLegacy = await pool.query(
      'SELECT status, pause_reason, version, next_run_at, services, request FROM schedules WHERE id = $1',
      [legacyScheduleId]
    );
    expect(dbLegacy.rows[0]).toMatchObject({
      status: 'paused',
      pause_reason: LEGACY_JIRA_PAUSE_REASON,
      version: 5,
      next_run_at: null,
      services: ['jira', 'slack'],
      request: 'Tổng hợp ticket Jira rồi gửi báo cáo Slack',
    });

    // Non-Jira schedule remains active and untouched
    const dbSlack = await pool.query(
      'SELECT status, pause_reason, version, next_run_at FROM schedules WHERE id = $1',
      [slackScheduleId]
    );
    expect(dbSlack.rows[0].status).toBe('active');
    expect(dbSlack.rows[0].pause_reason).toBeNull();
    expect(dbSlack.rows[0].version).toBe(1);
    expect(dbSlack.rows[0].next_run_at).not.toBeNull();

    // Owner notification message written to conversation
    const msgRes = await pool.query(
      `SELECT role, content, metadata FROM messages WHERE conv_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [legacyOwner.convId]
    );
    expect(msgRes.rowCount).toBe(1);
    expect(msgRes.rows[0].role).toBe('system');
    expect(msgRes.rows[0].content).toContain(LEGACY_JIRA_PAUSE_REASON);
    expect(msgRes.rows[0].metadata).toMatchObject({
      type: 'schedule_paused',
      reason: LEGACY_JIRA_PAUSE_REASON,
      scheduleId: legacyScheduleId,
      scheduleVersion: 5,
    });

    // Pending legacy plan expired
    expect(applied.expiredPlanIds).toContain(legacyPlanId);
    const planRes = await pool.query('SELECT status, decided_at FROM plans WHERE id = $1', [legacyPlanId]);
    expect(planRes.rows[0].status).toBe('expired');
    expect(planRes.rows[0].decided_at).not.toBeNull();

    // Idempotency: running a second time does not bump version or add duplicate messages
    const secondRun = await scanAndPauseLegacyJiraSchedules(pool, { dryRun: false });
    expect(secondRun.pausedSchedules.some((s) => s.id === legacyScheduleId)).toBe(false);
    expect(secondRun.alreadyPausedSchedules.some((s) => s.id === legacyScheduleId)).toBe(true);

    const dbAfterSecond = await pool.query('SELECT version FROM schedules WHERE id = $1', [legacyScheduleId]);
    expect(dbAfterSecond.rows[0].version).toBe(5);
    const msgCountAfterSecond = await pool.query('SELECT count(*)::int AS cnt FROM messages WHERE conv_id = $1', [legacyOwner.convId]);
    expect(msgCountAfterSecond.rows[0].cnt).toBe(1);
  });
});
