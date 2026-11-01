import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../../../../db/v3/', import.meta.url));
const databaseUrl = process.env.DATABASE_URL || 'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3';
const hex = (n = 64) => randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, n);
const recurrence = JSON.stringify({ type: 'daily', time: '07:30' });

describe('migration 0017 (calendar automation digest) on PostgreSQL 16', () => {
  const schema = `calendar_digest_mig_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Pool;
  let pool: pg.Pool;
  let files: string[];
  let userId: string;

  const runAll = async () => {
    for (const f of files) {
      await pool.query(await readFile(`${directory}/${f}`, 'utf8'));
    }
  };

  const makeConv = async () =>
    (await pool.query("INSERT INTO conversations(user_id, status, title) VALUES($1, 'chatting', 'Schedule Conv') RETURNING id", [userId])).rows[0].id as string;

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(databaseUrl);
    url.searchParams.set('options', `-c search_path=${schema}`);
    pool = new pg.Pool({ connectionString: url.href });
    files = (await readdir(directory)).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    expect(files).toContain('0017_calendar_automation_digest.sql');
    await runAll();
    await runAll();
    userId = (await pool.query("INSERT INTO users(email,password,name) VALUES('owner@example.test','hash','Owner') RETURNING id")).rows[0].id;
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  it('enforces schedules_kind_digest_check for plan and calendar_digest schedules', async () => {
    const convPlan = await makeConv();
    const planSched = await pool.query(
      `INSERT INTO schedules(user_id, conv_id, name, request, recurrence, services, status, next_run_at)
       VALUES($1, $2, 'Manual Plan', 'Tóm tắt lịch hôm nay', $3::jsonb, ARRAY['mycalendar','slack'], 'active', now() + interval '1 hour')
       RETURNING kind, digest_config, digest_config_hash, digest_approved_at`,
      [userId, convPlan, recurrence]
    );
    expect(planSched.rows[0]).toEqual({
      kind: 'plan',
      digest_config: null,
      digest_config_hash: null,
      digest_approved_at: null,
    });

    const convDigest = await makeConv();
    const configJson = JSON.stringify({
      version: 1,
      source: 'mycalendar',
      credentialId: randomUUID(),
      email: 'owner@example.test',
      calendars: [{ id: 'primary', summary: 'Lịch chính', primary: true }],
      destination: { service: 'slack', channelId: 'C0123456789', channelName: 'daily-briefing' },
      windowHours: 24,
      includeSummary: true,
    });
    const digestSched = await pool.query(
      `INSERT INTO schedules(user_id, conv_id, name, request, recurrence, services, status, next_run_at, kind, digest_config, digest_config_hash, digest_approved_at)
       VALUES($1, $2, 'Morning Calendar Digest', 'Gửi lịch họp sáng vào Slack', $3::jsonb, ARRAY['mycalendar','slack'], 'active', now() + interval '1 hour', 'calendar_digest', $4::jsonb, $5, now())
       RETURNING kind, digest_config_hash`,
      [userId, convDigest, recurrence, configJson, hex()]
    );
    expect(digestSched.rows[0].kind).toBe('calendar_digest');

    const convMissingHash = await makeConv();
    await expect(
      pool.query(
        `INSERT INTO schedules(user_id, conv_id, name, request, recurrence, services, status, next_run_at, kind, digest_config, digest_approved_at)
         VALUES($1, $2, 'Missing Hash', 'Req', $3::jsonb, ARRAY['mycalendar','slack'], 'active', now() + interval '1 hour', 'calendar_digest', $4::jsonb, now())`,
        [userId, convMissingHash, recurrence, configJson]
      )
    ).rejects.toMatchObject({ code: '23514', constraint: 'schedules_kind_digest_check' });

    const convPlanWithConfig = await makeConv();
    await expect(
      pool.query(
        `INSERT INTO schedules(user_id, conv_id, name, request, recurrence, services, status, next_run_at, kind, digest_config)
         VALUES($1, $2, 'Plan With Config', 'Req', $3::jsonb, ARRAY['mycalendar','slack'], 'active', now() + interval '1 hour', 'plan', $4::jsonb)`,
        [userId, convPlanWithConfig, recurrence, configJson]
      )
    ).rejects.toMatchObject({ code: '23514', constraint: 'schedules_kind_digest_check' });
  });

  it('enforces schedule_runs_status_check and schedule_runs_delivery_check for digest_sent and digest_failed', async () => {
    const conv = await makeConv();
    const schedId = (
      await pool.query(
        `INSERT INTO schedules(user_id, conv_id, name, request, recurrence, services, status, next_run_at, kind, digest_config, digest_config_hash, digest_approved_at)
         VALUES($1, $2, 'Digest Run Test', 'Req', $3::jsonb, ARRAY['mycalendar','slack'], 'active', now() + interval '1 hour', 'calendar_digest', '{"version":1}'::jsonb, $4, now())
         RETURNING id`,
        [userId, conv, recurrence, hex()]
      )
    ).rows[0].id as string;

    const sentRun = await pool.query(
      `INSERT INTO schedule_runs(schedule_id, schedule_version, trigger, due_at, status, delivery)
       VALUES($1, 1, 'scheduled', now(), 'digest_sent', '{"channelId":"C0123456789","totalEvents":4,"conflictCount":1}'::jsonb)
       RETURNING status, delivery`,
      [schedId]
    );
    expect(sentRun.rows[0].status).toBe('digest_sent');
    expect(sentRun.rows[0].delivery.totalEvents).toBe(4);

    await expect(
      pool.query(
        `INSERT INTO schedule_runs(schedule_id, schedule_version, trigger, due_at, status)
         VALUES($1, 1, 'manual', now() + interval '1 minute', 'digest_sent')`,
        [schedId]
      )
    ).rejects.toMatchObject({ code: '23514', constraint: 'schedule_runs_delivery_check' });

    const failedRun = await pool.query(
      `INSERT INTO schedule_runs(schedule_id, schedule_version, trigger, due_at, status, error)
       VALUES($1, 1, 'manual', now() + interval '2 minutes', 'digest_failed', 'Không đọc được Google Calendar.')
       RETURNING status, delivery`,
      [schedId]
    );
    expect(failedRun.rows[0].status).toBe('digest_failed');
    expect(failedRun.rows[0].delivery).toBeNull();

    await expect(
      pool.query(
        `INSERT INTO schedule_runs(schedule_id, schedule_version, trigger, due_at, status, delivery)
         VALUES($1, 1, 'manual', now() + interval '3 minutes', 'digest_failed', '{"channelId":"C0123456789"}'::jsonb)`,
        [schedId]
      )
    ).rejects.toMatchObject({ code: '23514', constraint: 'schedule_runs_delivery_check' });
  });
});
