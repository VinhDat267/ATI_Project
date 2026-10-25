import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../../../../db/v3/', import.meta.url));
const databaseUrl = process.env.DATABASE_URL || 'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3';
const daily = JSON.stringify({ type: 'daily', time: '08:00' });

describe('migration 0010 on PostgreSQL with 0001-0009 data', () => {
  const schema = `schedule_migration_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Pool, pool: pg.Pool, files: string[], userId: string, convId: string, messageId: string;
  const run = async (names: string[]) => { for (const f of names) await pool.query(await readFile(`${directory}/${f}`, 'utf8')); };
  const conversation = async () => (await pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [userId])).rows[0].id as string;
  const schedule = async (status = 'active', next: string | null = '2026-10-26T01:00:00Z', conv?: string) =>
    (await pool.query(`INSERT INTO schedules(user_id,conv_id,name,request,recurrence,services,status,next_run_at)
      VALUES($1,$2,'Lịch họp','Gửi lịch họp hôm nay lên Slack #ati-test',$3,'{calendar,slack}',$4,$5) RETURNING id`,
      [userId, conv ?? await conversation(), daily, status, next])).rows[0].id as string;
  const runRow = (scheduleId: string, trigger: string, status: string, due = '2026-10-26T01:00:00Z', planId: string | null = null) =>
    pool.query(`INSERT INTO schedule_runs(schedule_id,schedule_version,trigger,due_at,status,plan_id) VALUES($1,1,$2,$3,$4,$5) RETURNING id`,
      [scheduleId, trigger, due, status, planId]);

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(databaseUrl); url.searchParams.set('options', `-c search_path=${schema}`);
    pool = new pg.Pool({ connectionString: url.href });
    files = (await readdir(directory)).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    expect(files).toContain('0010_schedules.sql');
    await run(files.filter((f) => f < '0010'));
    userId = (await pool.query("INSERT INTO users(email,password,name) VALUES('owner@example.test','hash','Owner') RETURNING id")).rows[0].id;
    convId = await conversation();
    messageId = (await pool.query("INSERT INTO messages(conv_id,role,content) VALUES($1,'user','Xin chào') RETURNING id", [convId])).rows[0].id;
    await run(files.filter((f) => f >= '0010'));
  });
  afterAll(async () => { await pool?.end(); await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin?.end(); });

  it('keeps existing rows', async () => {
    expect((await pool.query('SELECT content FROM messages WHERE id=$1', [messageId])).rows[0].content).toBe('Xin chào');
    expect((await pool.query('SELECT count(*)::int AS n FROM conversations')).rows[0].n).toBe(1);
  });

  it('ties an active schedule to a next run time and nothing else to one', async () => {
    await expect(schedule('active', null)).rejects.toMatchObject({ code: '23514' });
    await expect(schedule('paused', '2026-10-26T01:00:00Z')).rejects.toMatchObject({ code: '23514' });
    await expect(schedule('archived', null)).rejects.toMatchObject({ code: '23514' });
    for (const status of ['paused', 'cancelled', 'completed']) await expect(schedule(status, null)).resolves.toBeTruthy();
  });

  it('allows one schedule per conversation', async () => {
    const conv = await conversation();
    await schedule('active', '2026-10-26T01:00:00Z', conv);
    await expect(schedule('paused', null, conv)).rejects.toMatchObject({ code: '23505' });
  });

  it('keeps a plan id exactly on planned runs', async () => {
    const id = await schedule();
    await expect(runRow(id, 'manual', 'planned')).rejects.toMatchObject({ code: '23514' });
    const plan = (await pool.query("INSERT INTO plans(conv_id,plan_json,plan_hash,expires_at) VALUES($1,'{}','h',now()) RETURNING id", [convId])).rows[0].id;
    await expect(runRow(id, 'manual', 'missed', '2026-10-27T01:00:00Z', plan)).rejects.toMatchObject({ code: '23514' });
    await expect(runRow(id, 'manual', 'planned', '2026-10-27T01:00:00Z', plan)).resolves.toBeTruthy();
    await expect(runRow(id, 'magic', 'missed')).rejects.toMatchObject({ code: '23514' });
    await expect(runRow(id, 'manual', 'unknown')).rejects.toMatchObject({ code: '23514' });
  });

  it('records each scheduled time once, but not manual runs', async () => {
    const id = await schedule();
    await runRow(id, 'scheduled', 'missed');
    await expect(runRow(id, 'scheduled', 'blocked')).rejects.toMatchObject({ code: '23505' });
    await runRow(id, 'manual', 'missed');
    await expect(runRow(id, 'manual', 'blocked')).resolves.toBeTruthy();
  });

  it('allows one planning run per schedule at a time', async () => {
    const id = await schedule();
    await runRow(id, 'manual', 'planning', '2026-10-26T02:00:00Z');
    await expect(runRow(id, 'replan', 'planning', '2026-10-26T03:00:00Z')).rejects.toMatchObject({ code: '23505' });
  });

  it('runs the whole migration set again without changing data or constraints', async () => {
    const before = (await pool.query('SELECT count(*)::int AS n FROM schedules')).rows[0].n;
    await run(files);
    expect((await pool.query('SELECT count(*)::int AS n FROM schedules')).rows[0].n).toBe(before);
    await expect(schedule('active', null)).rejects.toMatchObject({ code: '23514' });
    const indexes = (await pool.query("SELECT indexname FROM pg_indexes WHERE schemaname=$1 AND tablename IN ('schedules','schedule_runs') ORDER BY 1", [schema])).rows.map((r) => r.indexname);
    expect(indexes).toEqual(expect.arrayContaining(['schedule_runs_one_planning', 'schedule_runs_slot', 'schedules_due']));
  });
});
