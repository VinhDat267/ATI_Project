import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/app.js';
import { generateAccessToken, generateTokens, verifyAccessToken } from '../../src/auth/jwt.js';
import { UserRepo, hashPassword, toAuthUser } from '../../src/db/repositories/user-repo.js';

const databaseUrl = process.env.DATABASE_URL || 'postgresql://wap:wap@127.0.0.1:55532/ati_v3';
const directory = fileURLToPath(new URL('../../../../db/v3/', import.meta.url));
const secret = 'auth05_account_fixture_secret_at_least_32_chars';
const password = 'Auth05Fixture!password';
const changed = 'Auth05Changed!password';
const storedPassword = hashPassword(password);
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

describe('AUTH-05 account management with real PostgreSQL and HTTP', () => {
  const schema = `auth05_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Pool, pool: pg.Pool, users: UserRepo, app: ReturnType<typeof createApp>;
  let now: number, userId: string, email: string;
  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(databaseUrl); url.searchParams.set('options', `-c search_path=${schema}`);
    pool = new pg.Pool({ connectionString: url.href, max: 12 });
    for (const file of (await readdir(directory)).filter(file => /^\d{4}_.*\.sql$/.test(file)).sort()) {
      await pool.query(await readFile(`${directory}/${file}`, 'utf8'));
    }
    users = new UserRepo(pool);
  });
  beforeEach(async () => {
    now = Date.now(); userId = randomUUID(); email = `${userId}@example.test`;
    await pool.query("INSERT INTO users(id,email,password,name,status,email_verified) VALUES($1,$2,$3,'Fixture','active',true)", [userId, email, storedPassword]);
    app = createApp({ jwtSecret: secret, userRepo: users, authClock: () => now } as any);
  });
  afterAll(async () => {
    await pool?.end(); await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin?.end();
  });
  const login = (agent = CHROME, who = email, value = password) => request(app).post('/api/auth/login').set('User-Agent', agent).send({ email: who, password: value });
  const as = (token: string) => ({
    get: (path: string) => request(app).get(path).set('Authorization', `Bearer ${token}`),
    post: (path: string, body: object = {}) => request(app).post(path).set('Authorization', `Bearer ${token}`).send(body),
    patch: (path: string, body: object = {}) => request(app).patch(path).set('Authorization', `Bearer ${token}`).send(body),
  });
  const refresh = (refreshToken: string) => request(app).post('/api/auth/refresh').send({ refreshToken });
  const otherUser = async () => {
    const id = randomUUID();
    await pool.query("INSERT INTO users(id,email,password,name,status,email_verified) VALUES($1,$2,$3,'Other','active',true)", [id, `${id}@example.test`, storedPassword]);
    return (await login(CHROME, `${id}@example.test`)).body;
  };

  it('changes the password, revokes every other session and keeps the current one', async () => {
    const current = (await login()).body, phone = (await login(IPHONE)).body;
    const response = await as(current.accessToken).post('/api/account/change-password', { currentPassword: password, newPassword: changed });
    expect(response.status).toBe(200);
    expect((await as(current.accessToken).get('/api/auth/me')).status).toBe(200);
    expect((await refresh(current.refreshToken)).status).toBe(200);
    expect((await as(phone.accessToken).get('/api/auth/me')).status).toBe(401);
    expect((await refresh(phone.refreshToken)).status).toBe(401);
    expect((await login(CHROME, email, changed)).status).toBe(200);
    expect((await login(CHROME, email, password)).status).toBe(401);
  });

  it('invalidates an unused password-reset link when the password is changed', async () => {
    const current = (await login()).body;
    const resetToken = await users.authTokens.issue(userId, 'reset_password', now);
    expect((await as(current.accessToken).post('/api/account/change-password', { currentPassword: password, newPassword: changed })).status).toBe(200);
    expect((await request(app).post('/api/auth/reset-password').send({ token: resetToken, password: 'Auth05Reset!password' })).status).toBe(400);
    expect((await login(CHROME, email, changed)).status).toBe(200);
  });

  it('rejects a wrong current password without logging out and counts it toward the login limit', async () => {
    const current = (await login()).body;
    for (let i = 0; i < 5; i++) {
      const wrong = await as(current.accessToken).post('/api/account/change-password', { currentPassword: 'Wrong!password-123', newPassword: changed });
      expect(wrong.status).toBe(400); expect(wrong.body.code).toBe('INVALID_CURRENT_PASSWORD');
    }
    const blocked = await as(current.accessToken).post('/api/account/change-password', { currentPassword: password, newPassword: changed });
    expect(blocked.status).toBe(429); expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect((await login()).status).toBe(429);
    expect((await users.findById(userId))!.password).toBe(storedPassword);
    expect((await as(current.accessToken).get('/api/auth/me')).status).toBe(200);
  });

  it('rejects a new password outside 12–128 characters before checking the current one', async () => {
    const current = (await login()).body;
    for (const newPassword of ['short', 'x'.repeat(11), 'x'.repeat(129), 12345678901234]) {
      for (let i = 0; i < 3; i++) {
        const response = await as(current.accessToken).post('/api/account/change-password', { currentPassword: 'Wrong!password-123', newPassword });
        expect(response.status).toBe(400); expect(response.body.code).toBe('NEW_PASSWORD_INVALID');
      }
    }
    expect((await login()).status).toBe(200);
    expect((await users.findById(userId))!.password).toBe(storedPassword);
  });

  it('tells a Google-only account to use password recovery instead of changing a password', async () => {
    await pool.query('UPDATE users SET password=NULL,google_sub=$2 WHERE id=$1', [userId, `google-${userId}`]);
    const session = await users.sessions.create(userId, CHROME, now);
    const { accessToken } = generateAccessToken(toAuthUser((await users.findById(userId))!), secret, session.sessionId, now);
    const response = await as(accessToken).post('/api/account/change-password', { currentPassword: 'anything-at-all', newPassword: changed });
    expect(response.status).toBe(409); expect(response.body.code).toBe('PASSWORD_NOT_SET');
    expect((await users.findById(userId))!.password).toBeNull();
  });

  it('renames within 1–100 characters; the new name reaches /me and later access tokens', async () => {
    const current = (await login()).body;
    for (const name of ['', '   ', 'x'.repeat(101), 42, undefined]) {
      expect((await as(current.accessToken).patch('/api/account/profile', { name })).status).toBe(400);
    }
    const renamed = await as(current.accessToken).patch('/api/account/profile', { name: '  Tên mới  ' });
    expect(renamed.status).toBe(200); expect(renamed.body.user).toMatchObject({ id: userId, name: 'Tên mới' });
    expect((await as(current.accessToken).get('/api/auth/me')).body.user.name).toBe('Tên mới');
    const refreshed = await refresh(current.refreshToken);
    expect(verifyAccessToken(refreshed.body.accessToken, secret).name).toBe('Tên mới');
    expect((await as(current.accessToken).patch('/api/account/profile', { name: 'ệ'.repeat(100) })).status).toBe(200);
  });

  it('shows the profile with creation date, role and sign-in methods, including the linked Google email', async () => {
    const current = (await login()).body;
    const profile = (await as(current.accessToken).get('/api/account')).body.account;
    expect(profile).toMatchObject({ id: userId, email, name: 'Fixture', role: 'member', hasPassword: true, hasGoogle: false, googleEmail: null });
    expect(Number.isNaN(Date.parse(profile.createdAt))).toBe(false);
    const sid = verifyAccessToken(current.accessToken, secret).sid!;
    const link = { state_hash: 'a'.repeat(64), browser_binding_hash: 'b'.repeat(64), code_verifier: 'v', nonce: 'n', mode: 'link' as const, user_id: userId, session_id: sid };
    await users.googleAuth.resolveAccount({ sub: `google-${userId}`, email: 'personal@gmail.test', name: 'Personal' }, link, false, now);
    expect((await as(current.accessToken).get('/api/account')).body.account).toMatchObject({ hasGoogle: true, googleEmail: 'personal@gmail.test' });
    await users.googleAuth.unlink(userId, sid, now);
    expect((await as(current.accessToken).get('/api/account')).body.account).toMatchObject({ hasGoogle: false, googleEmail: null });
  });

  it('lists only the caller\'s open sessions with a short device label and marks the current one', async () => {
    const current = (await login()).body; await login(IPHONE); await otherUser();
    const sessions = (await as(current.accessToken).get('/api/account/sessions')).body.sessions;
    expect(sessions).toHaveLength(2);
    expect(sessions.find((row: any) => row.current)).toMatchObject({ device: 'Chrome trên Windows', id: verifyAccessToken(current.accessToken, secret).sid });
    expect(sessions.find((row: any) => !row.current)).toMatchObject({ device: 'Safari trên iOS' });
    for (const row of sessions) expect(Number.isNaN(Date.parse(row.createdAt)) || Number.isNaN(Date.parse(row.lastUsedAt))).toBe(false);
    expect(JSON.stringify(sessions)).not.toContain('Mozilla');
  });

  it('never shows or revokes another user\'s session', async () => {
    const mine = (await login()).body, theirs = await otherUser();
    const [target] = (await as(theirs.accessToken).get('/api/account/sessions')).body.sessions;
    expect((await as(mine.accessToken).post(`/api/account/sessions/${target.id}/revoke`)).status).toBe(404);
    expect((await as(mine.accessToken).post('/api/account/sessions/not-a-session/revoke')).status).toBe(404);
    expect((await as(theirs.accessToken).get('/api/auth/me')).status).toBe(200);
    expect((await refresh(theirs.refreshToken)).status).toBe(200);
    expect((await as(mine.accessToken).get('/api/account/sessions')).body.sessions.map((row: any) => row.id)).not.toContain(target.id);
  });

  it('revokes one other session: it leaves the list, its refresh returns 401, the current one cannot be revoked here', async () => {
    const current = (await login()).body, phone = (await login(IPHONE)).body;
    const phoneId = verifyAccessToken(phone.accessToken, secret).sid!;
    expect((await as(current.accessToken).post(`/api/account/sessions/${phoneId}/revoke`)).status).toBe(200);
    expect((await as(current.accessToken).get('/api/account/sessions')).body.sessions.map((row: any) => row.id)).not.toContain(phoneId);
    expect((await refresh(phone.refreshToken)).status).toBe(401);
    expect((await as(phone.accessToken).get('/api/auth/me')).status).toBe(401);
    const own = await as(current.accessToken).post(`/api/account/sessions/${verifyAccessToken(current.accessToken, secret).sid}/revoke`);
    expect(own.status).toBe(400); expect(own.body.code).toBe('CURRENT_SESSION');
    expect((await as(current.accessToken).get('/api/auth/me')).status).toBe(200);
  });

  it('logs out every other device and keeps the current session', async () => {
    const current = (await login()).body, phone = (await login(IPHONE)).body, laptop = (await login()).body;
    const response = await as(current.accessToken).post('/api/account/sessions/revoke-others');
    expect(response.status).toBe(200); expect(response.body.revoked).toBe(2);
    expect((await as(current.accessToken).get('/api/account/sessions')).body.sessions.map((row: any) => row.current)).toEqual([true]);
    for (const other of [phone, laptop]) expect((await refresh(other.refreshToken)).status).toBe(401);
    expect((await as(current.accessToken).get('/api/auth/me')).status).toBe(200);
  });

  it('answers 401 without a session and 503 without PostgreSQL', async () => {
    expect((await request(app).get('/api/account/sessions')).status).toBe(401);
    const memory = createApp({ jwtSecret: secret } as any);
    const { accessToken } = generateTokens({ id: userId, email, name: 'Fixture' }, secret);
    expect((await request(memory).get('/api/account').set('Authorization', `Bearer ${accessToken}`)).status).toBe(503);
  });
});
