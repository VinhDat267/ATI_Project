import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../../../../db/v3/', import.meta.url));
const databaseUrl = process.env.DATABASE_URL || 'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3';
const daily = JSON.stringify({ type: 'daily', time: '08:00' });
const sampleDigestConfig = JSON.stringify({
  version: 1,
  source: {
    service: 'mysheets',
    credentialId: '00000000-0000-4000-8000-000000000001',
    email: 'owner@example.test',
    spreadsheetId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
    spreadsheetTitle: 'Báo cáo KPI Q4',
    sheetName: 'KPI Tháng 11',
    tailRows: 20,
  },
  destination: {
    service: 'slack',
    channelId: 'C12345678',
    channelLabel: '#bao-cao-kpi',
  },
  includeAiSummary: true,
});
const sampleHash = 'a'.repeat(64);
const sampleDelivery = JSON.stringify({
  destination: 'slack',
  targetId: 'C12345678',
  targetLabel: '#bao-cao-kpi',
  spreadsheetId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
  spreadsheetTitle: 'Báo cáo KPI Q4',
  sheetName: 'KPI Tháng 11',
  rowCount: 12,
  summaryMode: 'ai',
  sentAt: '2026-11-02T01:00:00Z',
});

describe('migration 0016 (sheets_digest schedules & runs) on PostgreSQL', () => {
  const schema = `sheets_digest_migration_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Pool, pool: pg.Pool, files: string[], userId: string;

  const run = async (names: string[]) => {
    for (const f of names) {
      await pool.query(await readFile(`${directory}/${f}`, 'utf8'));
    }
  };
  const conversation = async () =>
    (await pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [userId])).rows[0].id as string;

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(databaseUrl);
    url.searchParams.set('options', `-c search_path=${schema}`);
    pool = new pg.Pool({ connectionString: url.href });
    files = (await readdir(directory)).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    expect(files).toContain('0016_sheets_automation_and_digest.sql');
    await run(files);
    userId = (await pool.query("INSERT INTO users(email,password,name) VALUES('owner@example.test','hash','Owner') RETURNING id")).rows[0].id;
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  it('enforces two-way schedules_kind_digest_check on schedules', async () => {
    // Valid plan schedule (default kind = 'plan')
    const conv1 = await conversation();
    const planSched = (
      await pool.query(
        `INSERT INTO schedules(user_id,conv_id,name,request,recurrence,services,status,next_run_at)
         VALUES($1,$2,'Lịch KPI','Đọc KPI gửi Slack',$3,'{mysheets,slack}','active','2026-11-03T01:00:00Z')
         RETURNING id, kind, digest_config`,
        [userId, conv1, daily]
      )
    ).rows[0];
    expect(planSched.kind).toBe('plan');
    expect(planSched.digest_config).toBeNull();

    // Valid sheets_digest schedule
    const conv2 = await conversation();
    const digestSched = (
      await pool.query(
        `INSERT INTO schedules(user_id,conv_id,name,request,recurrence,services,status,next_run_at,kind,digest_config,digest_config_hash,digest_approved_at)
         VALUES($1,$2,'Báo cáo KPI sáng','Đọc KPI gửi Slack',$3,'{mysheets,slack}','active','2026-11-03T01:00:00Z','sheets_digest',$4::jsonb,$5,now())
         RETURNING id, kind`,
        [userId, conv2, daily, sampleDigestConfig, sampleHash]
      )
    ).rows[0];
    expect(digestSched.kind).toBe('sheets_digest');

    // Invalid: kind = 'plan' with non-null digest_config
    const conv3 = await conversation();
    await expect(
      pool.query(
        `INSERT INTO schedules(user_id,conv_id,name,request,recurrence,services,status,next_run_at,kind,digest_config)
         VALUES($1,$2,'Bad','Req',$3,'{mysheets,slack}','active','2026-11-03T01:00:00Z','plan',$4::jsonb)`,
        [userId, conv3, daily, sampleDigestConfig]
      )
    ).rejects.toMatchObject({ code: '23514' });

    // Invalid: kind = 'sheets_digest' without digest_config_hash or invalid hash
    const conv4 = await conversation();
    await expect(
      pool.query(
        `INSERT INTO schedules(user_id,conv_id,name,request,recurrence,services,status,next_run_at,kind,digest_config,digest_config_hash,digest_approved_at)
         VALUES($1,$2,'Bad','Req',$3,'{mysheets,slack}','active','2026-11-03T01:00:00Z','sheets_digest',$4::jsonb,'short-hash',now())`,
        [userId, conv4, daily, sampleDigestConfig]
      )
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('enforces schedule_runs_status_check and schedule_runs_delivery_check for digest_sent and digest_failed', async () => {
    const conv = await conversation();
    const scheduleId = (
      await pool.query(
        `INSERT INTO schedules(user_id,conv_id,name,request,recurrence,services,status,next_run_at,kind,digest_config,digest_config_hash,digest_approved_at)
         VALUES($1,$2,'KPI','Req',$3,'{mysheets,slack}','active','2026-11-03T01:00:00Z','sheets_digest',$4::jsonb,$5,now())
         RETURNING id`,
        [userId, conv, daily, sampleDigestConfig, sampleHash]
      )
    ).rows[0].id as string;

    // Valid digest_sent with delivery JSON object
    await expect(
      pool.query(
        `INSERT INTO schedule_runs(schedule_id,schedule_version,trigger,due_at,status,delivery)
         VALUES($1,1,'scheduled','2026-11-03T01:00:00Z','digest_sent',$2::jsonb)`,
        [scheduleId, sampleDelivery]
      )
    ).resolves.toBeTruthy();

    // Valid digest_failed with NULL delivery
    await expect(
      pool.query(
        `INSERT INTO schedule_runs(schedule_id,schedule_version,trigger,due_at,status,error)
         VALUES($1,1,'manual','2026-11-03T02:00:00Z','digest_failed','Không đọc được bảng tính.')`,
        [scheduleId]
      )
    ).resolves.toBeTruthy();

    // Invalid: digest_sent without delivery
    await expect(
      pool.query(
        `INSERT INTO schedule_runs(schedule_id,schedule_version,trigger,due_at,status)
         VALUES($1,1,'manual','2026-11-03T03:00:00Z','digest_sent')`,
        [scheduleId]
      )
    ).rejects.toMatchObject({ code: '23514' });

    // Invalid: digest_failed with delivery
    await expect(
      pool.query(
        `INSERT INTO schedule_runs(schedule_id,schedule_version,trigger,due_at,status,delivery)
         VALUES($1,1,'manual','2026-11-03T04:00:00Z','digest_failed',$2::jsonb)`,
        [scheduleId, sampleDelivery]
      )
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('is idempotent when re-running all migrations', async () => {
    await expect(run(files)).resolves.toBeUndefined();
  });
});
