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

describe('migration 0014 (trello oauth and team board scope) on PostgreSQL', () => {
  const schema = `trello_oauth_migration_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Pool, pool: pg.Pool, files: string[];
  let userId: string, sessionId: string;

  const runAll = async () => {
    for (const f of files) {
      await pool.query(await readFile(`${directory}/${f}`, 'utf8'));
    }
  };

  const state = (mode: string, user: string | null, session: string | null, returnTo: unknown = null) => pool.query(
    `INSERT INTO oauth_states(state_hash,browser_binding_hash,code_verifier,nonce,mode,user_id,session_id,expires_at,return_to)
     VALUES($1,$2,'verifier','nonce',$3,$4,$5,now()+interval '10 minutes',$6) RETURNING id`,
    [hex(), hex(), mode, user, session, returnTo]
  );

  beforeAll(async () => {
    const conn = await connectAdmin();
    admin = conn.admin;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(conn.databaseUrl);
    url.searchParams.set('options', `-c search_path=${schema}`);
    pool = new pg.Pool({ connectionString: url.href });
    files = (await readdir(directory)).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    expect(files).toContain('0014_trello_oauth.sql');
    await runAll();
    await runAll();
    userId = (await pool.query("INSERT INTO users(email,password,name) VALUES('owner@example.test','hash','Owner') RETURNING id")).rows[0].id;
    sessionId = (await pool.query("INSERT INTO auth_sessions(user_id,refresh_token_hash,expires_at) VALUES($1,$2,now()+interval '1 day') RETURNING id", [userId, hex()])).rows[0].id;
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  it('accepts connect_trello with user_id, session_id and return_to as /c/<uuid> or NULL', async () => {
    const convId = randomUUID();
    await expect(state('connect_trello', userId, sessionId, null)).resolves.toBeTruthy();
    await expect(state('connect_trello', userId, sessionId, `/c/${convId}`)).resolves.toBeTruthy();
  });

  it('rejects connect_trello without user_id/session_id or with invalid return_to', async () => {
    const convId = randomUUID();
    // Missing user_id / session_id
    await expect(state('connect_trello', null, null, null)).rejects.toMatchObject({ code: '23514' });
    await expect(state('connect_trello', userId, null, null)).rejects.toMatchObject({ code: '23514' });
    await expect(state('connect_trello', null, sessionId, null)).rejects.toMatchObject({ code: '23514' });

    // Invalid return_to
    for (const bad of ['/settings', 'https://evil.example', '//evil.example', `/c/${convId.toUpperCase()}`, `/c/${convId}?x=1`, `/c/${convId}/x`]) {
      await expect(state('connect_trello', userId, sessionId, bad), bad).rejects.toMatchObject({ code: '23514' });
    }
  });

  it('contains DELETE credential service = trello AND user_id IS NULL in the SQL file', async () => {
    const sqlContent = await readFile(`${directory}/0014_trello_oauth.sql`, 'utf8');
    expect(sqlContent).toMatch(/DELETE\s+FROM\s+service_credentials\s+WHERE\s+service\s*=\s*'trello'\s+AND\s+user_id\s+IS\s+NULL/i);
  });

  it('rejects service_credentials with service = trello and user_id IS NULL', async () => {
    await expect(pool.query("INSERT INTO service_credentials(service,user_id,config) VALUES('trello',NULL,'v1:x')")).rejects.toMatchObject({ code: '23514' });
    const own = (await pool.query("INSERT INTO service_credentials(service,user_id,config) VALUES('trello',$1,'v1:x') RETURNING id,status", [userId])).rows[0];
    expect(own.status).toBe('active');
    await pool.query('DELETE FROM service_credentials WHERE id=$1', [own.id]);
  });

  it('enforces team board scope limit of 10 boards and rejects boards with differing workspace_id', async () => {
    // Insert single team scope row
    await pool.query(
      `INSERT INTO trello_team_scope(id, workspace_id, workspace_name, chosen_by)
       VALUES('default', 'ws_main', 'Main Workspace', $1)
       ON CONFLICT (id) DO UPDATE SET workspace_id = EXCLUDED.workspace_id, workspace_name = EXCLUDED.workspace_name`,
      [userId]
    );

    await pool.query("DELETE FROM trello_team_boards WHERE scope_id = 'default'");

    // Insert exactly 10 boards: all should succeed
    for (let i = 1; i <= 10; i++) {
      await pool.query(
        `INSERT INTO trello_team_boards(scope_id, workspace_id, board_id, board_name, position)
         VALUES('default', 'ws_main', $1, $2, $3)`,
        [`board_${i}`, `Board ${i}`, i]
      );
    }

    // 11th board must be rejected
    await expect(
      pool.query(
        `INSERT INTO trello_team_boards(scope_id, workspace_id, board_id, board_name, position)
         VALUES('default', 'ws_main', 'board_11', 'Board 11', 11)`
      )
    ).rejects.toMatchObject({ code: '23514' });

    // Board with a different workspace_id must be rejected
    await expect(
      pool.query(
        `INSERT INTO trello_team_boards(scope_id, workspace_id, board_id, board_name, position)
         VALUES('default', 'ws_other', 'board_other', 'Other Board', 1)`
      )
    ).rejects.toThrow();
  });

  it('runs all migrations twice and keeps the exact 3 mode check constraint names', async () => {
    await pool.query('DELETE FROM oauth_states');
    await runAll();
    await runAll();

    const convId = randomUUID();
    await expect(state('connect_trello', userId, sessionId, `/c/${convId}`)).resolves.toBeTruthy();
    await expect(state('connect_trello', null, null, null)).rejects.toMatchObject({ code: '23514' });
    await expect(pool.query("INSERT INTO service_credentials(service,user_id,config) VALUES('trello',NULL,'v1:x')")).rejects.toMatchObject({ code: '23514' });

    const checks = (await pool.query(`SELECT conname FROM (SELECT c.oid, c.conname FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      WHERE n.nspname=$1 AND t.relname='oauth_states' AND c.contype='c' OFFSET 0) own WHERE pg_get_constraintdef(own.oid) LIKE '%mode%'`, [schema])).rows;
    expect(checks.map((c) => c.conname).sort()).toEqual(['oauth_states_mode_check', 'oauth_states_mode_owner_check', 'oauth_states_return_to_check']);
  });
});
