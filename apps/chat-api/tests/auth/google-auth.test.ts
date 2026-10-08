import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import pg from 'pg';
import request from 'supertest';
import { randomUUID, createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/app.js';
import { UserRepo, verifyPassword } from '../../src/db/repositories/user-repo.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { OutboxEmailSender, type EmailMessage } from '../../src/services/email/index.js';
const directory = fileURLToPath(new URL('../../../../db/v3/', import.meta.url));
const secret = 'google_auth_test_secret_at_least_32_characters';
const config = { clientId: 'test-client', clientSecret: 'private-test-secret', redirectUri: 'http://localhost:5174/auth/google/callback',
  authorizationUrl: 'http://127.0.0.1/authorize', tokenUrl: 'http://127.0.0.1/token', jwksUrl: 'http://127.0.0.1/jwks' };
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...keys.publicKey.export({ format: 'jwk' }), kid: 'rsa-test', alg: 'RS256', use: 'sig' };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function token(claims: object) {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid })).toString('base64url');
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${h}.${p}.${sign('RSA-SHA256', Buffer.from(`${h}.${p}`), keys.privateKey).toString('base64url')}`;
}
describe('AUTH-04 Google OAuth with real PostgreSQL', () => {
  const schema = `auth04_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Pool, pool: pg.Pool, users: UserRepo, app: ReturnType<typeof createApp>, now: number;
  let subject: string, email: string, nonce: string, exchanges: URLSearchParams[], claims: Record<string, unknown>;
  const fetchFn: typeof fetch = async (input, init) => {
    if (String(input) === config.jwksUrl) return Response.json({ keys: [jwk] }, { headers: { 'Cache-Control': 'max-age=300' } });
    exchanges.push(new URLSearchParams(String(init?.body)));
    return Response.json({ id_token: token({ iss: 'https://accounts.google.com', aud: config.clientId,
      sub: subject, email, name: 'Người Google', email_verified: true, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 300, nonce, ...claims }) });
  };
  const build = (extra = {}) => createApp({ jwtSecret: secret, userRepo: users, authClock: () => now,
    googleOAuth: config, googleFetchFn: fetchFn, googleSignupEnabled: true, emailSender: new OutboxEmailSender(pool), ...extra } as any);
  const post = (path: string, body: object, cookie?: string, access?: string) => {
    const r = request(app).post(`/api/auth/google/${path}`).send(body);
    if (cookie) r.set('Cookie', cookie); if (access) r.set('Authorization', `Bearer ${access}`); return r;
  };
  const start = async (mode = 'login', access?: string) => {
    const r = await post('start', { mode }, undefined, access); expect(r.status).toBe(200);
    const url = new URL(r.body.url); nonce = url.searchParams.get('nonce')!;
    return { url, state: url.searchParams.get('state')!, cookie: (r.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!, response: r };
  };
  const login = async () => { const s = await start(); return post('callback', { state: s.state, code: 'private-code' }, s.cookie); };
  const user = async (verified = true, status = 'active') => {
    const u = await users.createUser({ email, name: 'Email owner', password: 'Old!password123456' });
    await pool.query('UPDATE users SET status=$2,email_verified=$3 WHERE id=$1', [u.id, status, verified]); return u;
  };
  beforeAll(async () => {
    const db = process.env.DATABASE_URL || 'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3';
    admin = new pg.Pool({ connectionString: db }); await admin.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(db); url.searchParams.set('options', `-c search_path=${schema}`); pool = new pg.Pool({ connectionString: url.href, max: 12 });
    for (const f of (await readdir(directory)).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort()) await pool.query(await readFile(`${directory}/${f}`, 'utf8'));
    users = new UserRepo(pool);
  });
  beforeEach(() => { now = Date.now(); subject = randomUUID(); email = `${randomUUID()}@example.test`; nonce = ''; exchanges = []; claims = {}; app = build(); });
  afterAll(async () => { await pool?.end(); await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin?.end(); });
  it('enables Google only with complete OAuth configuration and PostgreSQL', async () => {
    expect((await request(app).get('/api/auth/config')).body.googleEnabled).toBe(true);
    for (const field of ['clientId', 'clientSecret', 'redirectUri']) {
      app = build({ googleOAuth: { ...config, [field]: '' } });
      expect((await request(app).get('/api/auth/config')).body.googleEnabled).toBe(false);
      expect((await post('start', { mode: 'login' })).status).toBe(503);
    }
    app = build({ userRepo: undefined }); expect((await post('start', { mode: 'login' })).status).toBe(503);
  });
  it('creates hash-only browser-bound state, S256 PKCE, nonce and 10-minute host-only HttpOnly cookie', async () => {
    const s = await start(); expect(s.url.searchParams.get('scope')).toBe('openid email profile');
    expect(s.url.searchParams.get('response_type')).toBe('code'); expect(s.url.searchParams.get('code_challenge_method')).toBe('S256');
    const row = (await pool.query('SELECT * FROM oauth_states WHERE state_hash=$1', [hash(s.state)])).rows[0];
    expect(row.state_hash).not.toBe(s.state); expect(row.browser_binding_hash).toBe(hash(s.cookie.split('=')[1]!));
    expect(row.expires_at.getTime() - now).toBe(600000); expect(row.nonce).toBe(nonce);
    expect(s.url.searchParams.get('code_challenge')).toBe(createHash('sha256').update(row.code_verifier).digest('base64url'));
    const cookie = s.response.headers['set-cookie']![0]; expect(cookie).toMatch(/HttpOnly/); expect(cookie).toMatch(/SameSite=Lax/); expect(cookie).toMatch(/Max-Age=600/); expect(cookie).not.toMatch(/Domain=/);
    expect((await post('callback', { state: s.state, code: 'private-code' }, s.cookie)).body.code).toBe('ACCOUNT_PENDING');
    expect(exchanges[0]!.get('code_verifier')).toBe(row.code_verifier); expect(exchanges[0]!.get('client_secret')).toBe(config.clientSecret);
  });
  it('migrates twice without reviving consumed states', async () => {
    const s = await start(); await post('callback', { state: s.state, code: 'private-code' }, s.cookie);
    const sql = await readFile(`${directory}/0007_oauth_states.sql`, 'utf8'); await pool.query(sql); await pool.query(sql);
    expect((await post('callback', { state: s.state, code: 'private-code' }, s.cookie)).status).toBe(400);
  });
  it('rejects missing, unknown, expired and replayed states before exchange; wrong browser does not consume state', async () => {
    const s = await start();
    expect((await post('callback', { state: s.state, code: 'code' })).status).toBe(400);
    expect((await post('callback', { state: s.state, code: 'code' }, 'ati_google_browser=wrong')).status).toBe(400);
    expect(exchanges).toHaveLength(0);
    expect((await post('callback', { state: randomUUID(), code: 'code' }, s.cookie)).status).toBe(400);
    now += 600000; expect((await post('callback', { state: s.state, code: 'code' }, s.cookie)).status).toBe(400); expect(exchanges).toHaveLength(0);
    now = Date.now(); const fresh = await start(); await post('callback', { state: fresh.state, code: 'code' }, fresh.cookie);
    expect((await post('callback', { state: fresh.state, code: 'code' }, fresh.cookie)).status).toBe(400); expect(exchanges).toHaveLength(1);
  });
  it('allows only one token exchange for two concurrent callbacks on the same state', async () => {
    await user(); const s = await start();
    const r = await Promise.all([post('callback', { state: s.state, code: 'code' }, s.cookie), post('callback', { state: s.state, code: 'code' }, s.cookie)]);
    expect(r.map(x => x.status).sort()).toEqual([200, 400]); expect(exchanges).toHaveLength(1);
  });
  it('creates a verified pending Google-only account and notifies active admins; respects closed signup', async () => {
    const adminUser = await users.provisionAdmin({ email: `${randomUUID()}@example.test`, name: 'Admin', password: 'Admin!password123' });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const deliveries: Promise<void>[] = [];
    const sender = new OutboxEmailSender(pool);
    app = build({ emailSender: { send: (message: EmailMessage) => {
      const delivery = gate.then(() => sender.send(message)); deliveries.push(delivery); return delivery;
    } } });
    try {
      const r = await login(); expect(r.status).toBe(403); expect(r.body.code).toBe('ACCOUNT_PENDING');
      const u = await users.findByEmail(email); expect(u).toMatchObject({ password: null, email_verified: true, status: 'pending', google_sub: subject });
      expect(deliveries.length).toBeGreaterThan(0);
      // The response intentionally precedes background delivery. Hold a real
      // outbox INSERT to prove that boundary, then observe persisted delivery.
      expect((await pool.query('SELECT count(*)::int AS n FROM email_outbox WHERE to_address=$1', [adminUser.email])).rows[0].n).toBe(0);
      release();
      await vi.waitFor(async () => {
        expect((await pool.query('SELECT count(*)::int AS n FROM email_outbox WHERE to_address=$1', [adminUser.email])).rows[0].n).toBeGreaterThan(0);
      }, { timeout: 3000 });
    } finally { release(); await Promise.allSettled(deliveries); }
    email = `${randomUUID()}@example.test`; subject = randomUUID(); app = build({ googleSignupEnabled: false });
    expect((await login()).body.code).toBe('SIGNUP_DISABLED'); expect(await users.findByEmail(email)).toBeNull();
  });
  it('auto-links verified email without replacing password, then identifies stable sub after Google email changes', async () => {
    const u = await user(); const r = await login(); expect(r.status).toBe(200); expect(r.body.user.id).toBe(u.id);
    expect(r.body.refreshToken).toBeTruthy(); expect((await users.findById(u.id))!.password).toBe(u.password);
    email = `${randomUUID()}@example.test`; expect((await login()).body.user.id).toBe(u.id); expect(await users.findByEmail(email)).toBeNull();
    await vi.waitFor(async () => {
      expect((await pool.query('SELECT count(*)::int AS n FROM email_outbox WHERE to_address=$1', [u.email])).rows[0].n).toBe(1);
    }, { timeout: 3000 });
  });
  it('reclaims unverified email by clearing password and revoking sessions and outstanding auth tokens, preserving status', async () => {
    const u = await user(false); const old = await users.sessions.create(u.id, 'old', now); const authToken = await users.authTokens.issue(u.id, 'reset_password', now);
    const r = await login(); expect(r.status).toBe(200); expect(r.body.user.hasPassword).toBe(false);
    const fresh = await users.findById(u.id); expect(fresh).toMatchObject({ status: 'active', email_verified: true, google_sub: subject, password: null });
    expect(verifyPassword('Old!password123456', fresh!.password)).toBe(false); expect(await users.sessions.findActiveUser(old.sessionId, u.id, now)).toBeNull();
    expect((await pool.query('SELECT used_at FROM auth_tokens WHERE token_hash=$1', [hash(authToken)])).rows[0].used_at).not.toBeNull();
    expect((await request(app).post('/api/auth/login').send({ email, password: 'Old!password123456' })).status).toBe(401);
  });
  it.each(['pending', 'disabled'])('retains %s and refuses login', async status => {
    await user(false, status); const r = await login(); expect(r.status).toBe(403); expect(r.body.code).toBe(status === 'pending' ? 'ACCOUNT_PENDING' : 'ACCOUNT_DISABLED');
    expect((await users.findByEmail(email))!.status).toBe(status);
  });
  it('never overwrites a different Google sub already attached to the same email', async () => {
    const u = await user(); await pool.query('UPDATE users SET google_sub=$2 WHERE id=$1', [u.id, 'different-sub']);
    expect((await login()).body.code).toBe('GOOGLE_LINK_CONFLICT'); expect((await users.findById(u.id))!.google_sub).toBe('different-sub');
  });
  it('requires a valid session for link and uses the original user/session rather than browser user_id', async () => {
    const u = await user(); const session = await users.sessions.create(u.id, undefined, now); const access = generateAccessToken(u, secret, session.sessionId, now).accessToken;
    expect((await post('start', { mode: 'link' })).status).toBe(401);
    const s = await start('link', access); const victim = await users.createUser({ email: `${randomUUID()}@example.test`, name: 'Victim', password: 'Victim!password123' });
    const missing = await post('callback', { state: s.state, code: 'code' }, s.cookie); expect(missing.status).toBe(401);
    const r = await post('callback', { state: s.state, code: 'code', user_id: victim.id }, s.cookie, access); expect(r.body).toEqual({ success: true });
    expect((await users.findById(u.id))!.google_sub).toBe(subject); expect((await users.findById(victim.id))!.google_sub).toBeNull();
  });
  it('rejects link after logout and when sub is owned by another user', async () => {
    const u = await user(); const session = await users.sessions.create(u.id, undefined, now); const access = generateAccessToken(u, secret, session.sessionId, now).accessToken;
    const s = await start('link', access); await users.sessions.revoke(session.sessionId, u.id, now);
    expect((await post('callback', { state: s.state, code: 'code' }, s.cookie, access)).status).toBe(401); expect(exchanges).toHaveLength(0);
    const fresh = await users.sessions.create(u.id, undefined, now); const bearer = generateAccessToken(u, secret, fresh.sessionId, now).accessToken;
    const other = await users.createUser({ email: `${randomUUID()}@example.test`, name: 'Other', password: 'Other!password123' });
    await pool.query('UPDATE users SET google_sub=$2 WHERE id=$1', [other.id, subject]); const link = await start('link', bearer);
    expect((await post('callback', { state: link.state, code: 'code' }, link.cookie, bearer)).body.code).toBe('GOOGLE_LINK_CONFLICT');
  });
  it('requires password and authenticated session to unlink', async () => {
    const u = await user(); await pool.query('UPDATE users SET google_sub=$2 WHERE id=$1', [u.id, subject]);
    const s = await users.sessions.create(u.id, undefined, now); const access = generateAccessToken(u, secret, s.sessionId, now).accessToken;
    expect((await post('unlink', { currentPassword: 'Old!password123456' })).status).toBe(401);
    expect((await post('unlink', { currentPassword: 'Old!password123456' }, undefined, access)).body.success).toBe(true);
    await pool.query('UPDATE users SET google_sub=$2,password=NULL WHERE id=$1', [u.id, subject]);
    expect((await post('unlink', { currentPassword: 'Old!password123456' }, undefined, access)).status).toBe(409); expect((await users.findById(u.id))!.google_sub).toBe(subject);
  });
  it('rechecks the original link session after the token endpoint returns, so logout during exchange cannot link', async () => {
    const u = await user(); const session = await users.sessions.create(u.id, undefined, now);
    const access = generateAccessToken(u, secret, session.sessionId, now).accessToken;
    let reached!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { reached = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    app = build({ googleFetchFn: async (input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) => {
      if (String(input) === config.tokenUrl) { reached(); await gate; }
      return fetchFn(input, init);
    } });
    const s = await start('link', access);
    const callback = post('callback', { state: s.state, code: 'code' }, s.cookie, access).then(r => r);
    await entered; await users.sessions.revoke(session.sessionId, u.id, now); release();
    expect((await callback).body.code).toBe('INVALID_SESSION'); expect((await users.findById(u.id))!.google_sub).toBeNull();
  });
  it('rejects a different active session for link without consuming the original request', async () => {
    const u = await user(); const first = await users.sessions.create(u.id, undefined, now); const second = await users.sessions.create(u.id, undefined, now);
    const bearer = (id: string) => generateAccessToken(u, secret, id, now).accessToken;
    const s = await start('link', bearer(first.sessionId));
    expect((await post('callback', { state: s.state, code: 'code' }, s.cookie, bearer(second.sessionId))).status).toBe(400);
    expect(exchanges).toHaveLength(0);
    expect((await post('callback', { state: s.state, code: 'code' }, s.cookie, bearer(first.sessionId))).body.success).toBe(true);
  });
  it('serializes concurrent distinct subjects for one verified email without replacing the first link', async () => {
    const u = await user(); const first = await start(), second = await start();
    const states = await pool.query('SELECT * FROM oauth_states WHERE state_hash=ANY($1::text[])', [[hash(first.state), hash(second.state)]]);
    const profile = { email, name: 'Google user' };
    const results = await Promise.allSettled(states.rows.map((state, i) => users.googleAuth.resolveAccount({ ...profile, sub: `different-${i}-${subject}` }, state, true, now)));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason.code).toBe('GOOGLE_LINK_CONFLICT'); expect((await users.findById(u.id))!.google_sub).toMatch(/^different-/);
  });
  it('does not create a Google-authenticated session if unlink wins after account resolution', async () => {
    const u = await user(); await pool.query('UPDATE users SET google_sub=$2 WHERE id=$1', [u.id, subject]);
    const original = await users.sessions.create(u.id, undefined, now);
    await users.googleAuth.unlink(u.id, original.sessionId, u.password!, now);
    await expect(users.sessions.create(u.id, undefined, now, undefined, subject)).rejects.toThrow();
    expect((await pool.query('SELECT count(*)::int AS n FROM auth_sessions WHERE user_id=$1', [u.id])).rows[0].n).toBe(1);
  });
  it('permits only ten new Google accounts per IP/hour and rejects attempt eleven before inserting its user', async () => {
    for (let i = 0; i < 10; i++) {
      email = `${randomUUID()}@example.test`; subject = randomUUID();
      expect((await login()).body.code).toBe('ACCOUNT_PENDING');
    }
    email = `${randomUUID()}@example.test`; subject = randomUUID();
    const r = await login(); expect(r.status).toBe(429); expect(r.headers['retry-after']).toBe('3600');
    expect(await users.findByEmail(email)).toBeNull();
    now += 3600000; expect((await login()).body.code).toBe('ACCOUNT_PENDING'); expect(await users.findByEmail(email)).not.toBeNull();
  });
  it('shares one creation budget across email signup and new Google accounts in both directions', async () => {
    app = build({ signupEnabled: true });
    for (let i = 0; i < 9; i++) {
      expect((await request(app).post('/api/auth/signup').send({ email: `${randomUUID()}@example.test`, name: 'Email signup', password: 'Email!password123' })).status).toBe(200);
    }
    expect((await login()).body.code).toBe('ACCOUNT_PENDING');
    const blockedEmail = `${randomUUID()}@example.test`;
    const denied = await request(app).post('/api/auth/signup').send({ email: blockedEmail, name: 'Email signup', password: 'Email!password123' });
    expect(denied.status).toBe(429); expect(denied.headers['retry-after']).toBe('3600'); expect(await users.findByEmail(blockedEmail)).toBeNull();
    email = `${randomUUID()}@example.test`; subject = randomUUID();
    expect((await login()).status).toBe(429); expect(await users.findByEmail(email)).toBeNull();
  });
  it('keeps stable-sub login, verified email merge, recovery and explicit link available after signup quota is full', async () => {
    for (let i = 0; i < 10; i++) { email = `${randomUUID()}@example.test`; subject = randomUUID(); expect((await login()).body.code).toBe('ACCOUNT_PENDING'); }
    await pool.query("UPDATE users SET status='active' WHERE email=$1", [email]); expect((await login()).status).toBe(200);
    email = `${randomUUID()}@example.test`; subject = randomUUID(); const verified = await user(true); expect((await login()).body.user.id).toBe(verified.id);
    email = `${randomUUID()}@example.test`; subject = randomUUID(); const unverified = await user(false); expect((await login()).body.user.id).toBe(unverified.id); expect((await users.findById(unverified.id))!.password).toBeNull();
    email = `${randomUUID()}@example.test`; subject = randomUUID(); const target = await user(true);
    const session = await users.sessions.create(target.id, undefined, now); const bearer = generateAccessToken(target, secret, session.sessionId, now).accessToken;
    const s = await start('link', bearer); expect((await post('callback', { state: s.state, code: 'code' }, s.cookie, bearer)).body.success).toBe(true);
  });
  it('rejects bad ID tokens, consumes state even on exchange failure, and never logs provider body/code/secret', async () => {
    const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
    try {
      claims = { nonce: 'bad-nonce' }; const s = await start(); const r = await post('callback', { state: s.state, code: 'private-code' }, s.cookie);
      expect(r.status).toBe(400); expect(JSON.stringify(r.body)).not.toContain('private-code');
      expect((await post('callback', { state: s.state, code: 'private-code' }, s.cookie)).status).toBe(400);
      app = build({ googleFetchFn: async () => { throw new Error('private-code private-test-secret private-token'); } }); const failed = await start();
      const err = await post('callback', { state: failed.state, code: 'private-code' }, failed.cookie); expect(err.status).toBe(400); expect(JSON.stringify(err.body)).not.toContain('private');
      expect(JSON.stringify(logs.flatMap(log => log.mock.calls))).not.toMatch(/private-code|private-test-secret|private-token/);
    } finally { logs.forEach(log => log.mockRestore()); }
  });
});
