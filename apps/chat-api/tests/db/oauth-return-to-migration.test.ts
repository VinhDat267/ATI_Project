import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../../../../db/v3/', import.meta.url));
const databaseUrl = process.env.DATABASE_URL || 'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3';
const hex = (n: number) => randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, n);

describe('migration 0011 (OAUTH-01) on PostgreSQL', () => {
  const schema = `oauth_return_to_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Pool, pool: pg.Pool, files: string[], userId: string, sessionId: string;
  const runAll = async () => { for (const f of files) await pool.query(await readFile(`${directory}/${f}`, 'utf8')); };
  const state = (mode: string, returnTo: unknown) => pool.query(
    `INSERT INTO oauth_states(state_hash,browser_binding_hash,code_verifier,nonce,mode,user_id,session_id,expires_at,return_to)
     VALUES($1,$2,'v','n',$3,$4,$5,now() + interval '10 minutes',$6)`,
    [hex(64), hex(64), mode, mode === 'login' ? null : userId, mode === 'login' ? null : sessionId, returnTo]);

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(databaseUrl); url.searchParams.set('options', `-c search_path=${schema}`);
    pool = new pg.Pool({ connectionString: url.href });
    files = (await readdir(directory)).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    expect(files).toContain('0011_oauth_return_to.sql');
    await runAll();
    userId = (await pool.query("INSERT INTO users(email,password,name) VALUES('owner@example.test','hash','Owner') RETURNING id")).rows[0].id;
    sessionId = (await pool.query("INSERT INTO auth_sessions(user_id,refresh_token_hash,expires_at) VALUES($1,'h',now() + interval '1 day') RETURNING id", [userId])).rows[0].id;
  });
  afterAll(async () => { await pool?.end(); await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin?.end(); });

  it('stores only a conversation path, in lower case', async () => {
    const conv = randomUUID();
    await expect(state('connect_gmail', `/c/${conv}`)).resolves.toBeTruthy();
    await expect(state('connect_gmail', null)).resolves.toBeTruthy();
    for (const bad of ['/settings', 'https://evil.example', '//evil.example', `/c/${conv.toUpperCase()}`, `/c/${conv}?x=1`, `/c/${conv}/x`]) {
      await expect(state('connect_gmail', bad), bad).rejects.toMatchObject({ code: '23514' });
    }
  });

  it('keeps the rule when every migration runs again', async () => {
    await runAll();
    await runAll();
    await expect(state('connect_gmail', '/settings')).rejects.toMatchObject({ code: '23514' });
    const rules = (await pool.query("SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid = 'oauth_states'::regclass AND conname = 'oauth_states_return_to_check'")).rows[0].n;
    expect(rules).toBe(1);
  });
});
