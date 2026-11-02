import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../../../../db/v3/', import.meta.url));
const hex = (n = 64) => randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, n);

async function connectAdmin(): Promise<{ admin: pg.Pool; databaseUrl: string }> {
  const candidates = [
    process.env.DATABASE_URL,
    'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3',
    'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:56533/ati_v3',
  ].filter(Boolean) as string[];

  for (const url of candidates) {
    try {
      const p = new pg.Pool({ connectionString: url });
      await p.query('SELECT 1');
      return { admin: p, databaseUrl: url };
    } catch {
      // try next candidate
    }
  }
  throw new Error('Cannot connect to PostgreSQL on any candidate port (55533, 56533)');
}

describe('migration 0019 (telegram 1-click pairing and auto-digest) on PostgreSQL', () => {
  const schema = `telegram_oauth_migration_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Pool, pool: pg.Pool, files: string[];
  let userId: string, sessionId: string, convId: string;

  const runAll = async () => {
    for (const f of files) {
      await pool.query(await readFile(`${directory}/${f}`, 'utf8'));
    }
  };

  const state = (mode: string, user: string | null, session: string | null, returnTo: unknown = null) =>
    pool.query(
      `INSERT INTO oauth_states(state_hash,browser_binding_hash,code_verifier,nonce,mode,user_id,session_id,expires_at,return_to)
       VALUES($1,$2,'verifier','nonce',$3,$4,$5,now()+interval '10 minutes',$6) RETURNING id`,
      [hex(), hex(), mode, user, session, returnTo],
    );

  beforeAll(async () => {
    const conn = await connectAdmin();
    admin = conn.admin;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(conn.databaseUrl);
    url.searchParams.set('options', `-c search_path=${schema}`);
    pool = new pg.Pool({ connectionString: url.href });
    files = (await readdir(directory)).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    expect(files).toContain('0019_telegram_oauth_and_digest.sql');
    await runAll();
    await runAll();
    userId = (await pool.query("INSERT INTO users(email,password,name) VALUES('owner@example.test','hash','Owner') RETURNING id")).rows[0].id;
    sessionId = (
      await pool.query(
        "INSERT INTO auth_sessions(user_id,refresh_token_hash,expires_at) VALUES($1,$2,now()+interval '1 day') RETURNING id",
        [userId, hex()],
      )
    ).rows[0].id;
    convId = (await pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [userId])).rows[0].id;
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  it('accepts connect_telegram and preserves connect_github, connect_trello, connect_gmail, connect_mycalendar, connect_mysheets', async () => {
    const cid = randomUUID();
    for (const mode of ['connect_telegram', 'connect_github', 'connect_trello', 'connect_gmail', 'connect_mycalendar', 'connect_mysheets']) {
      await expect(state(mode, userId, sessionId, null), mode).resolves.toBeTruthy();
      await expect(state(mode, userId, sessionId, `/c/${cid}`), `${mode} with return_to`).resolves.toBeTruthy();
    }
  });

  it('rejects connect_telegram without user_id/session_id or with invalid return_to', async () => {
    const cid = randomUUID();
    await expect(state('connect_telegram', null, null, null)).rejects.toMatchObject({ code: '23514' });
    await expect(state('connect_telegram', userId, null, null)).rejects.toMatchObject({ code: '23514' });
    await expect(state('connect_telegram', null, sessionId, null)).rejects.toMatchObject({ code: '23514' });

    for (const bad of ['/settings', 'https://evil.example', '//evil.example', `/c/${cid.toUpperCase()}`, `/c/${cid}?x=1`, `/c/${cid}/x`]) {
      await expect(state('connect_telegram', userId, sessionId, bad), bad).rejects.toMatchObject({ code: '23514' });
    }
  });

  it('deletes shared telegram credentials and enforces service_credentials_telegram_owner_check', async () => {
    const sqlContent = await readFile(`${directory}/0019_telegram_oauth_and_digest.sql`, 'utf8');
    expect(sqlContent).toMatch(/DELETE\s+FROM\s+service_credentials\s+WHERE\s+service\s*=\s*'telegram'\s+AND\s+user_id\s+IS\s+NULL/i);
    await expect(
      pool.query("INSERT INTO service_credentials(service,user_id,config) VALUES('telegram',NULL,'v1:x')"),
    ).rejects.toMatchObject({ code: '23514' });

    const own = (
      await pool.query(
        "INSERT INTO service_credentials(service,user_id,config) VALUES('telegram',$1,'v1:x') RETURNING id,status",
        [userId],
      )
    ).rows[0];
    expect(own.status).toBe('active');
    await pool.query('DELETE FROM service_credentials WHERE id=$1', [own.id]);
  });

  it('enforces telegram_team_chats limit of 10 chats', async () => {
    await pool.query(
      `INSERT INTO telegram_team_scope(id, chosen_by)
       VALUES('default', $1)
       ON CONFLICT (id) DO UPDATE SET chosen_by = EXCLUDED.chosen_by`,
      [userId],
    );
    await pool.query("DELETE FROM telegram_team_chats WHERE scope_id = 'default'");

    for (let i = 1; i <= 10; i++) {
      await pool.query(
        `INSERT INTO telegram_team_chats(scope_id, chat_id, title, chat_type, position)
         VALUES('default', $1, $2, 'supergroup', $3)`,
        [`-10010000000${i}`, `Nhóm ${i}`, i],
      );
    }

    await expect(
      pool.query(
        `INSERT INTO telegram_team_chats(scope_id, chat_id, title, chat_type, position)
         VALUES('default', '-1001000000011', 'Nhóm 11', 'supergroup', 10)`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('enforces schedules_kind_digest_check and schedule_runs_delivery_check', async () => {
    // kind = telegram_digest without digest_config must fail
    await expect(
      pool.query(
        `INSERT INTO schedules(user_id,conv_id,name,request,recurrence,services,status,next_run_at,kind)
         VALUES($1,$2,'Bản tin sáng','Gửi báo cáo sáng','{"type":"daily","time":"08:00"}'::jsonb,ARRAY['github','telegram'],'active',now()+interval '1 day','telegram_digest')`,
        [userId, convId],
      ),
    ).rejects.toMatchObject({ code: '23514' });

    // kind = plan with digest_config must fail
    await expect(
      pool.query(
        `INSERT INTO schedules(user_id,conv_id,name,request,recurrence,services,status,next_run_at,kind,digest_config,digest_config_hash,digest_approved_at)
         VALUES($1,$2,'Bản tin sáng','Gửi báo cáo sáng','{"type":"daily","time":"08:00"}'::jsonb,ARRAY['github','telegram'],'active',now()+interval '1 day','plan','{}'::jsonb,'hash',now())`,
        [userId, convId],
      ),
    ).rejects.toMatchObject({ code: '23514' });

    // Valid telegram_digest schedule succeeds
    const schedId = (
      await pool.query(
        `INSERT INTO schedules(user_id,conv_id,name,request,recurrence,services,status,next_run_at,kind,digest_config,digest_config_hash,digest_approved_at)
         VALUES($1,$2,'Bản tin sáng','Gửi báo cáo sáng','{"type":"daily","time":"08:00"}'::jsonb,ARRAY['github','telegram'],'active',now()+interval '1 day','telegram_digest','{"chatId":"12345"}'::jsonb,$3,now())
         RETURNING id`,
        [userId, convId, hex()],
      )
    ).rows[0].id;

    // digest_sent without delivery must fail
    await expect(
      pool.query(
        `INSERT INTO schedule_runs(schedule_id,schedule_version,trigger,due_at,status,delivery)
         VALUES($1,1,'manual',now(),'digest_sent',NULL)`,
        [schedId],
      ),
    ).rejects.toMatchObject({ code: '23514' });

    // digest_failed with delivery must fail
    await expect(
      pool.query(
        `INSERT INTO schedule_runs(schedule_id,schedule_version,trigger,due_at,status,delivery)
         VALUES($1,1,'manual',now(),'digest_failed','{"messageId":1}'::jsonb)`,
        [schedId],
      ),
    ).rejects.toMatchObject({ code: '23514' });

    // Valid digest_sent with delivery and digest_failed without delivery succeed
    await expect(
      pool.query(
        `INSERT INTO schedule_runs(schedule_id,schedule_version,trigger,due_at,status,delivery)
         VALUES($1,1,'manual',now(),'digest_sent','{"messageId":42,"chatId":"12345"}'::jsonb)`,
        [schedId],
      ),
    ).resolves.toBeTruthy();

    await expect(
      pool.query(
        `INSERT INTO schedule_runs(schedule_id,schedule_version,trigger,due_at,status,error)
         VALUES($1,1,'manual',now(),'digest_failed','Lỗi mạng')`,
        [schedId],
      ),
    ).resolves.toBeTruthy();
  });

  it('is idempotent when re-running all migrations with existing digest schedules and oauth states', async () => {
    await expect(runAll()).resolves.toBeUndefined();
  });
});
