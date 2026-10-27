import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../../../../db/v3/', import.meta.url));
const databaseUrl = process.env.DATABASE_URL || 'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3';
const hex = () => randomUUID().replaceAll('-', '').padEnd(64, '0');

describe('migration 0009 on PostgreSQL with 0001-0008 data', () => {
  const schema = `gmail_migration_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Pool, pool: pg.Pool, files: string[];
  let userId: string, sessionId: string, sharedId: string, loginStateId: string, linkStateId: string;
  const run = async (names: string[]) => { for (const f of names) await pool.query(await readFile(`${directory}/${f}`, 'utf8')); };
  const state = (mode: string, user: string | null, session: string | null) => pool.query(
    `INSERT INTO oauth_states(state_hash,browser_binding_hash,code_verifier,nonce,mode,user_id,session_id,expires_at)
     VALUES($1,$2,'verifier','nonce',$3,$4,$5,now()+interval '10 minutes') RETURNING id`, [hex(), hex(), mode, user, session]);

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(databaseUrl); url.searchParams.set('options', `-c search_path=${schema}`);
    pool = new pg.Pool({ connectionString: url.href });
    files = (await readdir(directory)).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    expect(files).toContain('0009_gmail_personal_connections.sql');
    await run(files.filter((f) => f < '0009'));
    userId = (await pool.query("INSERT INTO users(email,password,name) VALUES('owner@example.test','hash','Owner') RETURNING id")).rows[0].id;
    sessionId = (await pool.query("INSERT INTO auth_sessions(user_id,refresh_token_hash,expires_at) VALUES($1,$2,now()+interval '1 day') RETURNING id", [userId, hex()])).rows[0].id;
    sharedId = (await pool.query("INSERT INTO service_credentials(service,user_id,config) VALUES('trello',NULL,'v1:shared') RETURNING id")).rows[0].id;
    loginStateId = (await state('login', null, null)).rows[0].id;
    linkStateId = (await state('link', userId, sessionId)).rows[0].id;
    await run(files.filter((f) => f >= '0009'));
  });
  afterAll(async () => { await pool?.end(); await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin?.end(); });

  it('keeps existing rows and marks existing credentials active', async () => {
    expect((await pool.query('SELECT service,user_id,config,status,status_changed_at FROM service_credentials WHERE id=$1', [sharedId])).rows[0])
      .toEqual({ service: 'trello', user_id: null, config: 'v1:shared', status: 'active', status_changed_at: null });
    expect((await pool.query('SELECT mode FROM oauth_states WHERE id = ANY($1) ORDER BY mode', [[loginStateId, linkStateId]])).rows.map((r) => r.mode)).toEqual(['link', 'login']);
  });

  it('accepts connect_gmail states only with both owner and session, and keeps the login/link rules', async () => {
    await expect(state('connect_gmail', userId, sessionId)).resolves.toBeTruthy();
    const refused: Array<[string, string | null, string | null]> = [['connect_gmail', userId, null], ['connect_gmail', null, null],
      ['login', userId, null], ['link', userId, null], ['link', null, null], ['connect_calendar', userId, sessionId]];
    for (const [mode, user, session] of refused) {
      await expect(state(mode, user, session), `${mode} ${user} ${session}`).rejects.toMatchObject({ code: '23514' });
    }
  });

  it('refuses a Gmail credential without an owner and an unknown status', async () => {
    await expect(pool.query("INSERT INTO service_credentials(service,user_id,config) VALUES('gmail',NULL,'v1:x')")).rejects.toMatchObject({ code: '23514' });
    const own = (await pool.query("INSERT INTO service_credentials(service,user_id,config) VALUES('gmail',$1,'v1:x') RETURNING id,status", [userId])).rows[0];
    expect(own.status).toBe('active');
    await expect(pool.query("UPDATE service_credentials SET status='revoked' WHERE id=$1", [own.id])).rejects.toMatchObject({ code: '23514' });
    await pool.query("UPDATE service_credentials SET status='reconnect_required', status_changed_at=now() WHERE id=$1", [own.id]);
    await pool.query('DELETE FROM service_credentials WHERE id=$1', [own.id]);
  });

  it('runs the whole migration set again without changing data or constraints', async () => {
    await pool.query("UPDATE service_credentials SET status='reconnect_required', status_changed_at=now() WHERE id=$1", [sharedId]);
    await run(files);
    await run(files.filter((f) => f >= '0009'));
    expect((await pool.query('SELECT status FROM service_credentials WHERE id=$1', [sharedId])).rows[0].status).toBe('reconnect_required');
    await expect(state('connect_gmail', userId, null)).rejects.toMatchObject({ code: '23514' });
    await expect(pool.query("INSERT INTO service_credentials(service,user_id,config) VALUES('gmail',NULL,'v1:x')")).rejects.toMatchObject({ code: '23514' });
    // OFFSET 0 keeps pg_get_constraintdef on this schema's rows: other test files drop their schemas meanwhile.
    const checks = (await pool.query(`SELECT conname FROM (SELECT c.oid, c.conname FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      WHERE n.nspname=$1 AND t.relname='oauth_states' AND c.contype='c' OFFSET 0) own WHERE pg_get_constraintdef(own.oid) LIKE '%mode%'`, [schema])).rows;
    // Exactly the named checks on mode, once each: the two of 0009 and the return path of 0011 (OAUTH-01).
    expect(checks.map((c) => c.conname).sort()).toEqual(['oauth_states_mode_check', 'oauth_states_mode_owner_check', 'oauth_states_return_to_check']);
  });
});
