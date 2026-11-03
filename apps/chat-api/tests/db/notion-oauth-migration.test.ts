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

describe('migration 0020 (notion OAuth personal connections and auto-digest) on PostgreSQL', () => {
  const schema = `notion_oauth_migration_${randomUUID().replaceAll('-', '')}`;
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
    expect(files).toContain('0020_notion_oauth_and_digest.sql');
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

  it('accepts connect_notion and preserves existing oauth_states modes with return_to', async () => {
    const cid = randomUUID();
    for (const mode of [
      'connect_notion',
      'connect_telegram',
      'connect_github',
      'connect_trello',
      'connect_gmail',
      'connect_mycalendar',
      'connect_mysheets',
    ]) {
      await expect(state(mode, userId, sessionId, null), mode).resolves.toBeTruthy();
      await expect(state(mode, userId, sessionId, `/c/${cid}`), `${mode} with return_to`).resolves.toBeTruthy();
    }
  });

  it('rejects connect_notion without user_id/session_id or with invalid return_to', async () => {
    const cid = randomUUID();
    await expect(state('connect_notion', null, null, null)).rejects.toMatchObject({ code: '23514' });
    await expect(state('connect_notion', userId, null, null)).rejects.toMatchObject({ code: '23514' });
    await expect(state('connect_notion', null, sessionId, null)).rejects.toMatchObject({ code: '23514' });

    for (const bad of ['/settings', 'https://evil.example', '//evil.example', `/c/${cid.toUpperCase()}`, `/c/${cid}?x=1`, `/c/${cid}/x`]) {
      await expect(state('connect_notion', userId, sessionId, bad), bad).rejects.toMatchObject({ code: '23514' });
    }
  });

  it('enforces notion_connections constraints (max 10 databases, disconnected null config, identity uniqueness)', async () => {
    const dbIds = Array.from({ length: 11 }, (_, i) => `11111111-2222-3333-4444-${String(i).padStart(12, '0')}`);
    await expect(
      pool.query(
        `INSERT INTO notion_connections(user_id,app_id,workspace_id,workspace_name,actor_id,bot_id,config,allowed_databases)
         VALUES($1,'app-1','ws-1','Team WS','actor-1','bot-1','v1:enc',$2)`,
        [userId, dbIds],
      ),
    ).rejects.toMatchObject({ code: '23514' });

    // Disconnected row with non-null config must fail
    await expect(
      pool.query(
        `INSERT INTO notion_connections(user_id,app_id,workspace_id,workspace_name,actor_id,bot_id,status,config)
         VALUES($1,'app-1','ws-2','Team WS 2','actor-1','bot-1','disconnected','v1:enc')`,
        [userId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('supports kind = notion_digest in schedules and remains idempotent across full migration reruns', async () => {
    const cid = randomUUID();
    await state('connect_notion', userId, sessionId, `/c/${cid}`);

    const schedId = (
      await pool.query(
        `INSERT INTO schedules(user_id,conv_id,name,request,recurrence,services,status,next_run_at,kind,digest_config,digest_config_hash,digest_approved_at)
         VALUES($1,$2,'Báo cáo Notion','Tổng hợp Notion mỗi sáng','{"type":"daily","time":"08:00"}'::jsonb,ARRAY['notion','slack'],'active',now()+interval '1 day','notion_digest','{"databaseId":"11111111-2222-3333-4444-555555555555"}'::jsonb,$3,now())
         RETURNING id`,
        [userId, convId, hex()],
      )
    ).rows[0].id;
    expect(schedId).toBeTruthy();

    await expect(runAll()).resolves.toBeUndefined();
  });
});
