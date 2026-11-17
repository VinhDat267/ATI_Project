import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../../../../db/v3/', import.meta.url));
const databaseUrl = process.env.DATABASE_URL || 'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:56544/ati_v3';

describe('migration 0039 (calendar event triggers & dispatch barrier) on PostgreSQL', () => {
  const schema = `cal_triggers_mig_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Pool;
  let pool: pg.Pool;
  let files: string[];
  let userId: string;

  const runAll = async () => {
    for (const f of files) {
      await pool.query(await readFile(`${directory}/${f}`, 'utf8'));
    }
  };

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(databaseUrl);
    url.searchParams.set('options', `-c search_path=${schema}`);
    pool = new pg.Pool({ connectionString: url.href });
    files = (await readdir(directory)).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    expect(files).toContain('0039_calendar_event_triggers.sql');
    await runAll();
    await runAll();
    userId = (
      await pool.query(
        "INSERT INTO users(email,password,name) VALUES('trigger-owner@example.test','hash','Trigger Owner') RETURNING id",
      )
    ).rows[0].id;
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  it('enforces trigger constraints and unique (trigger_id, dedupe_key) atomic dispatch barrier across double migration', async () => {
    const credId = randomUUID();
    const dest = JSON.stringify({ service: 'slack', channelId: 'C123456' });

    await expect(
      pool.query(
        `INSERT INTO calendar_event_triggers(user_id, name, trigger_type, credential_id, calendar_ids, lead_minutes, destination)
         VALUES($1, 'Bad type', 'unknown_kind', $2, '["primary"]'::jsonb, 15, $3::jsonb)`,
        [userId, credId, dest],
      ),
    ).rejects.toMatchObject({ code: '23514' });

    await expect(
      pool.query(
        `INSERT INTO calendar_event_triggers(user_id, name, trigger_type, credential_id, calendar_ids, lead_minutes, destination)
         VALUES($1, 'Bad lead', 'pre_meeting_reminder', $2, '["primary"]'::jsonb, 0, $3::jsonb)`,
        [userId, credId, dest],
      ),
    ).rejects.toMatchObject({ code: '23514' });

    await expect(
      pool.query(
        `INSERT INTO calendar_event_triggers(user_id, name, trigger_type, credential_id, calendar_ids, lead_minutes, destination)
         VALUES($1, 'Empty cal', 'pre_meeting_reminder', $2, '[]'::jsonb, 15, $3::jsonb)`,
        [userId, credId, dest],
      ),
    ).rejects.toMatchObject({ code: '23514' });

    const created = await pool.query(
      `INSERT INTO calendar_event_triggers(user_id, name, trigger_type, credential_id, calendar_ids, lead_minutes, destination)
       VALUES($1, 'Nhắc họp 15p', 'pre_meeting_reminder', $2, '["primary"]'::jsonb, 15, $3::jsonb)
       RETURNING id, status`,
      [userId, credId, dest],
    );
    expect(created.rows[0].status).toBe('active');
    const triggerId = created.rows[0].id as string;

    const first = await pool.query(
      `INSERT INTO calendar_trigger_dispatches(trigger_id, user_id, dedupe_key, event_id, delivery_status, summary)
       VALUES($1, $2, 'pre:primary:evt1:2026-11-18T09:00:00+07:00', 'evt1', 'pending', 'Sprint Review')
       ON CONFLICT (trigger_id, dedupe_key) DO NOTHING RETURNING id`,
      [triggerId, userId],
    );
    const duplicate = await pool.query(
      `INSERT INTO calendar_trigger_dispatches(trigger_id, user_id, dedupe_key, event_id, delivery_status, summary)
       VALUES($1, $2, 'pre:primary:evt1:2026-11-18T09:00:00+07:00', 'evt1', 'pending', 'Sprint Review')
       ON CONFLICT (trigger_id, dedupe_key) DO NOTHING RETURNING id`,
      [triggerId, userId],
    );
    expect(first.rowCount).toBe(1);
    expect(duplicate.rowCount).toBe(0);

    await runAll();
    const stillThere = await pool.query('SELECT COUNT(*)::int AS cnt FROM calendar_trigger_dispatches WHERE trigger_id=$1', [triggerId]);
    expect(stillThere.rows[0].cnt).toBe(1);

    await pool.query('DELETE FROM calendar_event_triggers WHERE id=$1', [triggerId]);
    const cascaded = await pool.query('SELECT COUNT(*)::int AS cnt FROM calendar_trigger_dispatches WHERE trigger_id=$1', [triggerId]);
    expect(cascaded.rows[0].cnt).toBe(0);
  });
});
