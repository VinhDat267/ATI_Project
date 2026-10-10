import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/app.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { UserRepo, hashPassword, toAuthUser } from '../../src/db/repositories/user-repo.js';

const directory = fileURLToPath(new URL('../../../../db/v3/', import.meta.url));
const password = 'Auth07Fixture!password';
const storedPassword = hashPassword(password);
const secret = 'auth07_fixture_secret_at_least_32_characters';
const config = { clientId: 'local-client', clientSecret: 'local-client-secret', redirectUri: 'http://localhost/auth/google/callback',
  authorizationUrl: 'http://127.0.0.1/authorize', tokenUrl: 'http://127.0.0.1/token', jwksUrl: 'http://127.0.0.1/jwks' };

describe('AUTH-07 current password for Google unlink with real HTTP and PostgreSQL', () => {
  const schema = `auth07_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Pool, pool: pg.Pool, users: UserRepo, app: ReturnType<typeof createApp>;
  let now: number, userId: string, email: string, subject: string, access: string;
  let current: { sessionId: string; refreshToken: string }, other: { sessionId: string; refreshToken: string };
  const post = (body: object, token = access) => request(app).post('/api/auth/google/unlink').set('Authorization', `Bearer ${token}`).send(body);
  const me = () => request(app).get('/api/auth/me').set('Authorization', `Bearer ${access}`);
  const login = (value: string) => request(app).post('/api/auth/login').send({ email, password: value });
  const profile = async () => (await pool.query('SELECT google_sub,google_email FROM users WHERE id=$1', [userId])).rows[0];
  const unchanged = async () => {
    expect(await profile()).toEqual({ google_sub: subject, google_email: 'linked@example.test' });
    expect((await pool.query('SELECT count(*)::int AS n FROM auth_sessions WHERE user_id=$1 AND revoked_at IS NULL', [userId])).rows[0].n).toBe(2);
    expect((await me()).status).toBe(200);
  };
  const waitingOn = async (table: 'users' | 'auth_sessions') => vi.waitFor(async () => {
    const pending = await admin.query(`SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE $2`, [schema, `%FROM ${table}%FOR UPDATE%`]);
    expect(pending.rows[0].n).toBe(1);
  }, { timeout: 5000, interval: 10 });

  beforeAll(async () => {
    const db = process.env.DATABASE_URL || 'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3';
    admin = new pg.Pool({ connectionString: db }); await admin.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(db); url.searchParams.set('options', `-c search_path=${schema}`); url.searchParams.set('application_name', schema);
    pool = new pg.Pool({ connectionString: url.href, max: 12 });
    for (const file of (await readdir(directory)).filter(file => /^\d{4}_.*\.sql$/.test(file)).sort()) await pool.query(await readFile(`${directory}/${file}`, 'utf8'));
    users = new UserRepo(pool);
  });
  beforeEach(async () => {
    now = Date.now(); userId = randomUUID(); email = `${userId}@example.test`; subject = `google-${userId}`;
    await pool.query("INSERT INTO users(id,email,password,name,status,email_verified,google_sub,google_email) VALUES($1,$2,$3,'Fixture','active',true,$4,'linked@example.test')",
      [userId, email, storedPassword, subject]);
    current = await users.sessions.create(userId, 'current fixture', now); other = await users.sessions.create(userId, 'other fixture', now);
    access = generateAccessToken(toAuthUser((await users.findById(userId))!), secret, current.sessionId, now).accessToken;
    app = createApp({ jwtSecret: secret, userRepo: users, authClock: () => now, googleOAuth: config });
  });
  afterAll(async () => { await pool?.end(); await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin?.end(); });

  it('requires a nonempty bounded current password without spending the failure budget', async () => {
    for (const body of [{}, { currentPassword: null }, { currentPassword: 123 }, { currentPassword: '' }, { currentPassword: 'x'.repeat(129) }]) {
      const response = await post(body);
      expect(response.status).toBe(400); expect(response.body.code).toBe('CURRENT_PASSWORD_REQUIRED');
      await unchanged();
    }
    expect((await post({ currentPassword: password })).status).toBe(200);
  });

  it('rejects the wrong current password while preserving both sessions and the link', async () => {
    const response = await post({ currentPassword: 'Incorrect!fixture' });
    expect(response.status).toBe(400); expect(response.body.code).toBe('INVALID_CURRENT_PASSWORD');
    await unchanged();
    expect((await request(app).post('/api/auth/refresh').send({ refreshToken: current.refreshToken })).status).toBe(200);
    expect((await request(app).post('/api/auth/refresh').send({ refreshToken: other.refreshToken })).status).toBe(200);
  });

  it('unlinks with the actual password without changing the password or creating or revoking sessions', async () => {
    const response = await post({ currentPassword: password, user_id: randomUUID() });
    expect(response.status).toBe(200); expect(response.body).toEqual({ success: true });
    expect(await profile()).toEqual({ google_sub: null, google_email: null });
    expect((await users.findById(userId))!.password === storedPassword).toBe(true);
    expect((await pool.query('SELECT count(*)::int AS n FROM auth_sessions WHERE user_id=$1', [userId])).rows[0].n).toBe(2);
    expect((await pool.query('SELECT count(*)::int AS n FROM auth_sessions WHERE user_id=$1 AND revoked_at IS NULL', [userId])).rows[0].n).toBe(2);
    expect((await me()).status).toBe(200);
  });

  it('retains the passwordless conflict and leaves the Google-only account unchanged', async () => {
    await pool.query('UPDATE users SET password=NULL WHERE id=$1', [userId]);
    const response = await post({ currentPassword: password });
    expect(response.status).toBe(409); expect(response.body.code).toBe('PASSWORD_REQUIRED');
    await unchanged();
  });

  it.each([1, 128])('accepts an existing password length of %i characters', async length => {
    const value = 'x'.repeat(length);
    await pool.query('UPDATE users SET password=$2 WHERE id=$1', [userId, hashPassword(value)]);
    expect((await post({ currentPassword: value })).status).toBe(200);
    expect(await profile()).toEqual({ google_sub: null, google_email: null });
  });

  it('shares the wrong-password budget with login and password change and includes Retry-After', async () => {
    expect((await login('Incorrect!fixture')).status).toBe(401);
    expect((await request(app).post('/api/account/change-password').set('Authorization', `Bearer ${access}`)
      .send({ currentPassword: 'Incorrect!fixture', newPassword: 'Replacement!fixture' })).status).toBe(400);
    for (let i = 0; i < 3; i++) expect((await post({ currentPassword: 'Incorrect!fixture' })).status).toBe(400);
    const blocked = await post({ currentPassword: password });
    expect(blocked.status).toBe(429); expect(blocked.headers['retry-after']).toBe('900');
    expect((await login(password)).status).toBe(429);
    await unchanged();
    now += 15 * 60_000;
    access = generateAccessToken(toAuthUser((await users.findById(userId))!), secret, current.sessionId, now).accessToken;
    expect((await post({ currentPassword: password })).status).toBe(200);
  });

  it('allows only five simultaneous wrong-password checks and blocks the rest', async () => {
    const responses = await Promise.all(Array.from({ length: 8 }, () => post({ currentPassword: 'Incorrect!fixture' })));
    expect(responses.filter(response => response.status === 400)).toHaveLength(5);
    const blocked = responses.filter(response => response.status === 429);
    expect(blocked).toHaveLength(3); expect(blocked.every(response => response.headers['retry-after'] === '900')).toBe(true);
    await unchanged();
  });

  it('rejects a verified password snapshot when another connection changes it before the write lock is acquired', async () => {
    const blocker = await pool.connect(); await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
    const pending = post({ currentPassword: password }).then(response => response);
    try {
      await waitingOn('users');
      await blocker.query('UPDATE users SET password=$2 WHERE id=$1', [userId, hashPassword('Changed!fixture')]);
      await blocker.query('COMMIT');
      const response = await pending;
      expect(response.status).toBe(409); expect(response.body.code).toBe('PASSWORD_CHANGED_ELSEWHERE');
      await unchanged();
    } finally { await blocker.query('ROLLBACK'); blocker.release(); await pending; }
  });

  it.each(['revoked', 'expired'])('rechecks a %s session after waiting on its real row lock', async state => {
    const blocker = await pool.connect(); await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM auth_sessions WHERE id=$1 FOR UPDATE', [current.sessionId]);
    const pending = post({ currentPassword: password }).then(response => response);
    try {
      await waitingOn('auth_sessions');
      await blocker.query(state === 'revoked' ? 'UPDATE auth_sessions SET revoked_at=$2 WHERE id=$1' : 'UPDATE auth_sessions SET expires_at=$2 WHERE id=$1', [current.sessionId, new Date(now)]);
      await blocker.query('COMMIT');
      const response = await pending;
      expect(response.status).toBe(401); expect(response.body.code).toBe('INVALID_SESSION');
      expect(await profile()).toEqual({ google_sub: subject, google_email: 'linked@example.test' });
      expect(await users.sessions.findActiveUser(other.sessionId, userId, now)).not.toBeNull();
    } finally { await blocker.query('ROLLBACK'); blocker.release(); await pending; }
  });

  it.each(['users', 'auth_sessions'] as const)('rejects natural session expiry while waiting on the %s row without changing its expiry', async table => {
    const blocker = await pool.connect(); await blocker.query('BEGIN');
    await blocker.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`, [table === 'users' ? userId : current.sessionId]);
    const pending = post({ currentPassword: password }).then(response => response);
    try {
      await waitingOn(table);
      now += 7 * 24 * 60 * 60_000;
      await blocker.query('COMMIT');
      const response = await pending;
      expect(response.status).toBe(401); expect(response.body.code).toBe('INVALID_SESSION');
      expect(await profile()).toEqual({ google_sub: subject, google_email: 'linked@example.test' });
      expect((await pool.query('SELECT count(*)::int AS n FROM auth_sessions WHERE user_id=$1 AND revoked_at IS NULL', [userId])).rows[0].n).toBe(2);
    } finally { await blocker.query('ROLLBACK'); blocker.release(); await pending; }
  });

  it('rechecks the user status after another connection disables the account under the user lock', async () => {
    const blocker = await pool.connect(); await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
    const pending = post({ currentPassword: password }).then(response => response);
    try {
      await waitingOn('users');
      await blocker.query("UPDATE users SET status='disabled' WHERE id=$1", [userId]); await blocker.query('COMMIT');
      const response = await pending;
      expect(response.status).toBe(401); expect(response.body.code).toBe('INVALID_SESSION');
      expect(await profile()).toEqual({ google_sub: subject, google_email: 'linked@example.test' });
    } finally { await blocker.query('ROLLBACK'); blocker.release(); await pending; }
  });

  it('keeps invalid-session and unauthenticated requests rejected', async () => {
    expect((await request(app).post('/api/auth/google/unlink').send({ currentPassword: password })).status).toBe(401);
    await users.sessions.revoke(current.sessionId, userId, now);
    expect((await post({ currentPassword: password })).status).toBe(401);
    expect(await profile()).toEqual({ google_sub: subject, google_email: 'linked@example.test' });
  });
});
