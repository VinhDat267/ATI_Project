import { afterAll, beforeAll, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { UserRepo } from '../../src/db/repositories/user-repo.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const databaseUrl = process.env.DATABASE_URL || 'postgresql://wap:wap@127.0.0.1:55532/ati_v3';
const schema = `auth_disable_race_${randomUUID().replaceAll('-', '')}`;
const scopedUrl = new URL(databaseUrl);
scopedUrl.searchParams.set('options', `-c search_path=${schema}`);
let admin: pg.Pool, pool: pg.Pool, users: UserRepo;
beforeAll(async () => {
  admin = new pg.Pool({ connectionString: databaseUrl });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  pool = new pg.Pool({ connectionString: scopedUrl.href, max: 8 });
  for (const file of ['0001_v3_core.sql', '0002_v3_invariants.sql', '0003_auth_sessions.sql']) {
    await pool.query(await readFile(`${root}/db/v3/${file}`, 'utf8'));
  }
  users = new UserRepo(pool);
});
afterAll(async () => { await pool?.end(); await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin?.end(); });

it('does not create a session from a stale active-account snapshot while disable commits', async () => {
  const target = randomUUID();
  await pool.query("INSERT INTO users(id,email,password,name,status,email_verified) VALUES($1,$2,'fixture-hash','Race fixture','active',true)", [target, `${target}@example.test`]);
  const blocker = await pool.connect();
  let pending: Promise<{ sessionId: string; refreshToken: string } | null> | undefined;
  try {
    await blocker.query('BEGIN');
    // Actual admin transaction sequence, held open to reproduce the race.
    await blocker.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [target]);
    await blocker.query("UPDATE users SET status='disabled' WHERE id=$1", [target]);
    await blocker.query('UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1', [target]);
    pending = users.sessions.create(target, 'concurrent-login').then(result => result, () => null);
    const deadline = Date.now() + 3_000;
    let waiting = false;
    while (Date.now() < deadline) {
      const locks = await pool.query("SELECT count(*)::int AS n FROM pg_locks WHERE locktype='transactionid' AND NOT granted");
      if (locks.rows[0].n > 0) { waiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(waiting).toBe(true);
  } finally { await blocker.query('COMMIT'); blocker.release(); }
  const late = await pending!;
  await pool.query("UPDATE users SET status='active' WHERE id=$1", [target]);
  if (late) expect(await users.sessions.findActiveUser(late.sessionId, target)).toBeNull();
  expect(late).toBeNull();
});
