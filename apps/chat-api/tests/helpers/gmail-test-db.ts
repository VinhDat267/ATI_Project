import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { UserRepo } from '../../src/db/repositories/user-repo.js';

const directory = fileURLToPath(new URL('../../../../db/v3/', import.meta.url));

/** A private schema with every v3 migration, for one test file on the real PostgreSQL. */
export async function createMigratedSchema(prefix: string) {
  const db = process.env.DATABASE_URL || 'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3';
  const schema = `${prefix}_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: db });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const url = new URL(db); url.searchParams.set('options', `-c search_path=${schema}`);
  const pool = new pg.Pool({ connectionString: url.href, max: 12 });
  for (const f of (await readdir(directory)).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()) await pool.query(await readFile(`${directory}/${f}`, 'utf8'));
  const users = new UserRepo(pool);
  return {
    pool, users,
    /** An active, verified member with one live session. */
    async person(name = 'Thành viên') {
      const user = await users.createUser({ email: `${randomUUID()}@example.test`, name, password: 'Passw0rd!long-enough' });
      await pool.query("UPDATE users SET status='active', email_verified=true WHERE id=$1", [user.id]);
      const { sessionId } = await users.sessions.create(user.id, 'test');
      return { id: user.id, email: user.email, name, role: 'member' as const, sid: sessionId };
    },
    async close() {
      await pool.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    },
  };
}
