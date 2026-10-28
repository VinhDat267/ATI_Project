import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../../../../db/v3/', import.meta.url));
const databaseUrl = process.env.DATABASE_URL || 'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:56533/ati_v3';
const hex = (n = 64) => randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, n);

describe('migration 0013 (mysheets personal connections) on PostgreSQL', () => {
  const schema = `mysheets_migration_${randomUUID().replaceAll('-', '')}`;
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
    admin = new pg.Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(databaseUrl);
    url.searchParams.set('options', `-c search_path=${schema}`);
    pool = new pg.Pool({ connectionString: url.href });
    files = (await readdir(directory)).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    expect(files).toContain('0013_mysheets_personal_connections.sql');
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

  it('accepts connect_mysheets with user_id, session_id and return_to as /c/<uuid> or NULL', async () => {
    const convId = randomUUID();
    await expect(state('connect_mysheets', userId, sessionId, null)).resolves.toBeTruthy();
    await expect(state('connect_mysheets', userId, sessionId, `/c/${convId}`)).resolves.toBeTruthy();
  });

  it('rejects connect_mysheets without user_id/session_id or with invalid return_to', async () => {
    const convId = randomUUID();
    // Missing user_id / session_id
    await expect(state('connect_mysheets', null, null, null)).rejects.toMatchObject({ code: '23514' });
    await expect(state('connect_mysheets', userId, null, null)).rejects.toMatchObject({ code: '23514' });
    await expect(state('connect_mysheets', null, sessionId, null)).rejects.toMatchObject({ code: '23514' });

    // Invalid return_to
    for (const bad of ['/settings', 'https://evil.example', '//evil.example', `/c/${convId.toUpperCase()}`, `/c/${convId}?x=1`, `/c/${convId}/x`]) {
      await expect(state('connect_mysheets', userId, sessionId, bad), bad).rejects.toMatchObject({ code: '23514' });
    }
  });

  it('rejects service_credentials with service = mysheets and user_id IS NULL', async () => {
    await expect(pool.query("INSERT INTO service_credentials(service,user_id,config) VALUES('mysheets',NULL,'v1:x')")).rejects.toMatchObject({ code: '23514' });
    const own = (await pool.query("INSERT INTO service_credentials(service,user_id,config) VALUES('mysheets',$1,'v1:x') RETURNING id,status", [userId])).rows[0];
    expect(own.status).toBe('active');
    await pool.query('DELETE FROM service_credentials WHERE id=$1', [own.id]);
  });

  it('runs all migrations twice and keeps the exact 3 mode check constraint names', async () => {
    await pool.query('DELETE FROM oauth_states');
    await runAll();
    await runAll();

    // Verify constraints still hold after running twice
    const convId = randomUUID();
    await expect(state('connect_mysheets', userId, sessionId, `/c/${convId}`)).resolves.toBeTruthy();
    await expect(state('connect_mysheets', null, null, null)).rejects.toMatchObject({ code: '23514' });
    await expect(pool.query("INSERT INTO service_credentials(service,user_id,config) VALUES('mysheets',NULL,'v1:x')")).rejects.toMatchObject({ code: '23514' });

    const checks = (await pool.query(`SELECT conname FROM (SELECT c.oid, c.conname FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      WHERE n.nspname=$1 AND t.relname='oauth_states' AND c.contype='c' OFFSET 0) own WHERE pg_get_constraintdef(own.oid) LIKE '%mode%'`, [schema])).rows;
    expect(checks.map((c) => c.conname).sort()).toEqual(['oauth_states_mode_check', 'oauth_states_mode_owner_check', 'oauth_states_return_to_check']);
  });
});
