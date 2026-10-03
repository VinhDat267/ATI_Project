import { describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const databaseUrl = process.env.DATABASE_URL || 'postgresql://wap:wap@127.0.0.1:55532/ati_v3';
const migrations = fileURLToPath(new URL('../../../../db/v3/', import.meta.url));

describe('AUTH-01 migration on PostgreSQL', () => {
  it('preserves existing accounts, defaults future users to pending, and can run twice without resetting users', async () => {
    const schema = `auth_migration_${randomUUID().replaceAll('-', '')}`;
    const admin = new pg.Pool({ connectionString: databaseUrl });
    const scopedUrl = new URL(databaseUrl);
    scopedUrl.searchParams.set('options', `-c search_path=${schema}`);
    const pool = new pg.Pool({ connectionString: scopedUrl.href });
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
      await pool.query(await readFile(`${migrations}/0001_v3_core.sql`, 'utf8'));
      const legacy = (await pool.query("INSERT INTO users(email,password,name) VALUES('legacy@example.test','legacy-hash','Legacy') RETURNING id")).rows[0];
      // An absent migration is the missing behavior, rather than a module-load error.
      const sql = await readFile(`${migrations}/0003_auth_sessions.sql`, 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return '';
        throw error;
      });
      if (sql) await pool.query(sql);
      const before = (await pool.query('SELECT * FROM users WHERE id=$1', [legacy.id])).rows[0];
      expect(before).toMatchObject({ status: 'active', role: 'member', email_verified: true, google_sub: null });
      const newer = (await pool.query("INSERT INTO users(email,password,name) VALUES('google@example.test',NULL,'Google') RETURNING *")).rows[0];
      expect(newer).toMatchObject({ status: 'pending', role: 'member', email_verified: false, password: null });
      await pool.query("UPDATE users SET status='disabled',role='admin',email_verified=false,google_sub='google-123' WHERE id=$1", [legacy.id]);
      await pool.query(sql);
      expect((await pool.query('SELECT * FROM users WHERE id=$1', [legacy.id])).rows[0]).toMatchObject({ status: 'disabled', role: 'admin', email_verified: false, google_sub: 'google-123' });
      expect((await pool.query('SELECT status FROM users WHERE id=$1', [newer.id])).rows[0].status).toBe('pending');
      await expect(pool.query("INSERT INTO users(email,name,google_sub) VALUES('duplicate@example.test','Duplicate','google-123')")).rejects.toMatchObject({ code: '23505' });
      await expect(pool.query("UPDATE users SET status='invented' WHERE id=$1", [legacy.id])).rejects.toMatchObject({ code: '23514' });
      await expect(pool.query("UPDATE users SET role='owner' WHERE id=$1", [legacy.id])).rejects.toMatchObject({ code: '23514' });
      const indexes = (await pool.query("SELECT indexdef FROM pg_indexes WHERE schemaname=$1 AND tablename='auth_sessions'", [schema])).rows.map(row => row.indexdef).join('\n');
      expect(indexes).toMatch(/\(user_id\)/);
      expect(indexes).toMatch(/\(refresh_token_hash\)/);
    } finally {
      await pool.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });
});
