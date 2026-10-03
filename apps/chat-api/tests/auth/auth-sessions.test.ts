import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import request from 'supertest';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createApp } from '../../src/app.js';
import { generateAccessToken, generateTokens, verifyAccessToken } from '../../src/auth/jwt.js';
import { UserRepo, hashPassword, verifyPassword } from '../../src/db/repositories/user-repo.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { decryptCredentials } from '@wap/tool-adapters';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const databaseUrl = process.env.DATABASE_URL || 'postgresql://wap:wap@127.0.0.1:55532/ati_v3';
const secret = 'auth01_http_test_secret_at_least_32_chars';
const password = 'Auth01Fixture!password';
const storedPassword = hashPassword(password);
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

describe('AUTH-01 server sessions with real PostgreSQL and HTTP', () => {
  const schema = `auth_sessions_${randomUUID().replaceAll('-', '')}`;
  const scopedUrl = new URL(databaseUrl);
  scopedUrl.searchParams.set('options', `-c search_path=${schema}`);
  let admin: pg.Pool;
  let pool: pg.Pool;
  let users: UserRepo;
  let app: ReturnType<typeof createApp>;
  let userId: string;
  let email: string;
  let now: number;

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({ connectionString: scopedUrl.href, max: 12 });
    for (const file of ['0001_v3_core.sql', '0002_v3_invariants.sql', '0003_auth_sessions.sql']) {
      await pool.query(await readFile(`${root}/db/v3/${file}`, 'utf8'));
    }
    users = new UserRepo(pool);
  });
  beforeEach(async () => {
    now = Date.now();
    userId = randomUUID(); email = `${userId}@example.test`;
    await pool.query("INSERT INTO users(id,email,password,name,status,email_verified) VALUES($1,$2,$3,'Fixture','active',true)", [userId, email, storedPassword]);
    app = createApp({ jwtSecret: secret, userRepo: users, authClock: () => now } as any);
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });
  const login = () => request(app).post('/api/auth/login').set('User-Agent', 'AUTH-01 fixture').send({ email, password });
  const refresh = (refreshToken: string) => request(app).post('/api/auth/refresh').send({ refreshToken });
  const me = (accessToken: string) => request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`);

  it('issues a sid access token and a 32-byte opaque refresh token while storing hashes only', async () => {
    const response = await login();
    expect(response.status).toBe(200);
    expect(response.body.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(response.body.refreshToken, 'base64url')).toHaveLength(32);
    const payload = JSON.parse(Buffer.from(response.body.accessToken.split('.')[1], 'base64url').toString());
    expect(payload.sid).toMatch(/^[a-f0-9-]{36}$/);
    const session = (await pool.query('SELECT * FROM auth_sessions WHERE id=$1', [payload.sid])).rows[0];
    expect(session).toMatchObject({ user_id: userId, refresh_token_hash: hash(response.body.refreshToken), user_agent: 'AUTH-01 fixture', previous_token_hash: null, revoked_at: null });
    expect(session.expires_at.getTime() - now).toBe(7 * 24 * 60 * 60 * 1000);
    expect(JSON.stringify(session)).not.toContain(response.body.refreshToken);
    expect(response.body.user).toMatchObject({ role: 'member', status: 'active', emailVerified: true, hasPassword: true, hasGoogle: false });
    expect(response.body.user.password).toBeUndefined();
  });

  it('rotates once under concurrent real PostgreSQL CAS and gives the immediately previous token a 30-second grace response', async () => {
    const first = (await login()).body;
    const results = await Promise.all(Array.from({ length: 4 }, () => refresh(first.refreshToken)));
    expect(results.map(result => result.status).sort()).toEqual([200, 409, 409, 409]);
    const winner = results.find(result => result.status === 200)!;
    expect(winner.body.refreshToken).not.toBe(first.refreshToken);
    expect(results.filter(result => result.status === 409).every(result => result.body.code === 'REFRESH_ROTATED')).toBe(true);
    now += 30_000;
    expect((await refresh(first.refreshToken)).status).toBe(409);
    expect((await me(winner.body.accessToken)).status).toBe(200);
    const history = (await pool.query('SELECT * FROM auth_session_refresh_history WHERE token_hash=$1', [hash(first.refreshToken)])).rows;
    expect(history).toHaveLength(1);
    expect(JSON.stringify(history)).not.toContain(first.refreshToken);
    now += 1;
    expect((await refresh(first.refreshToken)).status).toBe(401);
    expect((await me(winner.body.accessToken)).status).toBe(401);
    expect((await refresh(winner.body.refreshToken)).status).toBe(401);
  });

  it('identifies an older-than-previous replay after two rotations and revokes any simultaneous winning rotation', async () => {
    const first = (await login()).body;
    const second = (await refresh(first.refreshToken)).body;
    const third = (await refresh(second.refreshToken)).body;
    now += 30_001;
    const [replay, racing] = await Promise.all([refresh(first.refreshToken), refresh(third.refreshToken)]);
    expect(replay.status).toBe(401);
    expect([200, 401]).toContain(racing.status);
    expect((await me(third.accessToken)).status).toBe(401);
    if (racing.status === 200) {
      expect((await me(racing.body.accessToken)).status).toBe(401);
      expect((await refresh(racing.body.refreshToken)).status).toBe(401);
    }
    const sessions = (await pool.query('SELECT revoked_at FROM auth_sessions WHERE user_id=$1', [userId])).rows;
    expect(sessions[0].revoked_at).not.toBeNull();
  });

  it('does not grant the multi-tab grace response to an arbitrary retired token', async () => {
    const first = (await login()).body;
    const second = (await refresh(first.refreshToken)).body;
    await refresh(second.refreshToken);
    expect((await refresh(first.refreshToken)).status).toBe(401);
    expect((await me(second.accessToken)).status).toBe(401);
  });

  it('logout rejects both access and refresh immediately while another session remains usable', async () => {
    const first = (await login()).body;
    const second = (await login()).body;
    const response = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${first.accessToken}`);
    expect(response.status).toBe(200);
    expect((await me(first.accessToken)).status).toBe(401);
    expect((await refresh(first.refreshToken)).status).toBe(401);
    expect((await me(second.accessToken)).status).toBe(200);
  });

  it('logout-all revokes all sessions of this user without revoking another user', async () => {
    const first = (await login()).body;
    const second = (await login()).body;
    const outsider = randomUUID();
    await pool.query("INSERT INTO users(id,email,password,name,status) VALUES($1,$2,$3,'Other','active')", [outsider, `${outsider}@example.test`, storedPassword]);
    const other = (await request(app).post('/api/auth/login').send({ email: `${outsider}@example.test`, password })).body;
    expect((await request(app).post('/api/auth/logout-all').set('Authorization', `Bearer ${first.accessToken}`)).status).toBe(200);
    for (const session of [first, second]) {
      expect((await me(session.accessToken)).status).toBe(401);
      expect((await refresh(session.refreshToken)).status).toBe(401);
    }
    expect((await me(other.accessToken)).status).toBe(200);
  });

  it('rejects disabled users and sessionless legacy JWTs in the database middleware', async () => {
    const tokens = (await login()).body;
    await pool.query("UPDATE users SET status='disabled' WHERE id=$1", [userId]);
    expect((await me(tokens.accessToken)).status).toBe(401);
    expect((await refresh(tokens.refreshToken)).status).toBe(401);
    await pool.query("UPDATE users SET status='active' WHERE id=$1", [userId]);
    const legacy = generateTokens({ id: userId, email, name: 'Fixture' }, secret);
    expect((await me(legacy.accessToken)).status).toBe(401);
  });

  it('refresh rejects expired sessions and unknown tokens without creating a session', async () => {
    const tokens = (await login()).body;
    now += 7 * 24 * 60 * 60 * 1000;
    expect((await refresh(tokens.refreshToken)).status).toBe(401);
    expect((await refresh('unknown-opaque-token')).status).toBe(401);
    expect((await pool.query('SELECT count(*)::int AS count FROM auth_sessions WHERE user_id=$1', [userId])).rows[0].count).toBe(1);
  });

  it.each([['pending', 'ACCOUNT_PENDING'], ['disabled', 'ACCOUNT_DISABLED']])('reveals %s status only after verifying the password', async (status, code) => {
    await pool.query('UPDATE users SET status=$1 WHERE id=$2', [status, userId]);
    const wrong = await request(app).post('/api/auth/login').send({ email, password: 'wrong-password' });
    const missing = await request(app).post('/api/auth/login').send({ email: 'missing@example.test', password });
    expect(wrong.status).toBe(401);
    expect(wrong.body).toEqual(missing.body);
    const correct = await login();
    expect(correct.status).toBe(403);
    expect(correct.body.code).toBe(code);
    expect((await pool.query('SELECT count(*)::int AS count FROM auth_sessions WHERE user_id=$1', [userId])).rows[0].count).toBe(0);
  });

  it('rejects password login for a Google-only account and returns fresh account metadata from me', async () => {
    const tokens = (await login()).body;
    await pool.query("UPDATE users SET password=NULL,google_sub='google-user',role='admin',email_verified=false WHERE id=$1", [userId]);
    expect((await login()).status).toBe(401);
    const response = await me(tokens.accessToken);
    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ role: 'admin', status: 'active', hasPassword: false, hasGoogle: true, emailVerified: false });
  });

  it('blocks the sixth login attempt after five failures per normalized IP/email and resets after 15 minutes', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await request(app).post('/api/auth/login').send({ email: ` ${email.toUpperCase()} `, password: 'wrong-password' })).status).toBe(401);
    }
    const blocked = await login();
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBe('900');
    expect((await request(app).post('/api/auth/login').send({ email: 'different@example.test', password: 'wrong-password' })).status).toBe(401);
    now += 15 * 60 * 1000;
    expect((await login()).status).toBe(200);
  });

  it('bounds concurrent password verification to five failures for the same IP/email', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => request(app).post('/api/auth/login').send({ email, password: 'wrong-password' })));
    expect(results.filter(result => result.status === 401)).toHaveLength(5);
    const blocked = results.filter(result => result.status === 429);
    expect(blocked).toHaveLength(7);
    expect(blocked.every(result => result.headers['retry-after'] === '900')).toBe(true);
    expect((await login()).status).toBe(429);
    now += 15 * 60 * 1000;
    expect((await login()).status).toBe(200);
  });

  it('rejects malformed credential bodies without reaching password verification', async () => {
    for (const body of [{ email: {}, password }, { email, password: {} }, { email: [], password }, { email: '', password }]) {
      expect((await request(app).post('/api/auth/login').send(body)).status).toBe(400);
    }
  });

  it('checks the current session and active user in one actual database query', async () => {
    const tokens = (await login()).body;
    const queries: string[] = [];
    const observed = { query: (sql: string, args?: unknown[]) => { queries.push(sql); return pool.query(sql, args); } } as unknown as pg.Pool;
    const observedApp = createApp({ jwtSecret: secret, userRepo: new UserRepo(observed), authClock: () => now } as any);
    const response = await request(observedApp).get('/api/auth/me').set('Authorization', `Bearer ${tokens.accessToken}`);
    expect(response.status).toBe(200);
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatch(/JOIN users/i);
    expect(queries[0]).toMatch(/s\.id\s*=\s*\$1/i);
  });

  it('authorizes the admin role and the legacy administrator allowlist using current database roles', async () => {
    const tokens = (await login()).body;
    const key = 'a'.repeat(64);
    const credentialRepo = new CredentialRepo(pool);
    app = createApp({ jwtSecret: secret, userRepo: users, credentialRepo, encryptionKey: key });
    const credentials = () => request(app).post('/api/services/trello/credentials').set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ credentials: { apiKey: 'fixture-key', token: 'fixture-token' }, allowedScope: ['fixture-board'] });
    expect((await credentials()).status).toBe(403);
    expect(await credentialRepo.getCredentials('trello')).toBeNull();
    await pool.query("UPDATE users SET role='admin' WHERE id=$1", [userId]);
    expect((await credentials()).status).toBe(200);
    const stored = await credentialRepo.getCredentials('trello');
    expect(decryptCredentials(stored!.config, key)).toEqual({ apiKey: 'fixture-key', token: 'fixture-token', allowedScope: { boards: ['fixture-board'] } });
    await pool.query("UPDATE users SET role='member' WHERE id=$1", [userId]);
    expect((await credentials()).status).toBe(403);
    app = createApp({ jwtSecret: secret, userRepo: users, credentialRepo, encryptionKey: key, serviceAdminUserIds: [userId] });
    expect((await credentials()).status).toBe(200);
  });

  it('provisions both a new and an existing administrator as active and verified via the CLI', async () => {
    const cliEmail = `${randomUUID()}@provision.example.test`;
    const run = promisify(execFile);
    const cli = () => run(process.execPath, ['--import', 'tsx', 'apps/chat-api/src/cli/provision-user.ts'], {
      cwd: root, env: { ...process.env, DATABASE_URL: scopedUrl.href, CHAT_ADMIN_EMAIL: cliEmail, CHAT_ADMIN_PASSWORD: password },
    });
    const first = await cli();
    expect(first.stdout).not.toContain(password);
    const created = await users.findByEmail(cliEmail);
    expect(created).toMatchObject({ role: 'admin', status: 'active', email_verified: true });
    await pool.query("UPDATE users SET status='disabled',role='member',email_verified=false WHERE id=$1", [created!.id]);
    await cli();
    const updated = await users.findByEmail(cliEmail);
    expect(updated).toMatchObject({ id: created!.id, role: 'admin', status: 'active', email_verified: true });
    expect(verifyPassword(password, updated!.password)).toBe(true);
  });
});

describe('AUTH-01 memory compatibility', () => {
  const user = { id: 'memory-fixture', email: 'memory@example.test', name: 'Memory' };
  const app = createApp({ jwtSecret: secret, validateCredentials: (email, supplied) => email === user.email && supplied === password ? user : null });
  it('keeps legacy memory login/refresh and requires PostgreSQL for revocation', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: user.email, password });
    expect(login.status).toBe(200);
    expect(verifyAccessToken(login.body.accessToken, secret).id).toBe(user.id);
    expect((await request(app).post('/api/auth/refresh').send({ refreshToken: login.body.refreshToken })).status).toBe(200);
    for (const endpoint of ['logout', 'logout-all']) {
      expect((await request(app).post(`/api/auth/${endpoint}`).set('Authorization', `Bearer ${login.body.accessToken}`)).status).toBe(503);
    }
  });
  it('exposes the disabled signup/Google flags without authentication', async () => {
    const response = await request(app).get('/api/auth/config');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ signupEnabled: false, googleEnabled: false });
  });
  it('never accepts a database sid token when storage has fallen back to memory', async () => {
    const token = generateAccessToken(user, secret, randomUUID()).accessToken;
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(503);
  });
});
