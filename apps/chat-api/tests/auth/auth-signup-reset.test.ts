import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import request from 'supertest';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/app.js';
import { UserRepo, hashPassword, verifyPassword } from '../../src/db/repositories/user-repo.js';

const databaseUrl = process.env.DATABASE_URL || 'postgresql://wap:wap@127.0.0.1:55532/ati_v3';
const directory = fileURLToPath(new URL('../../../../db/v3/', import.meta.url));
const secret = 'auth02_http_fixture_secret_at_least_32_chars';
const password = 'Auth02!local-password';
const storedPassword = hashPassword(password);
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

describe('AUTH-02 signup and password recovery with PostgreSQL and HTTP', () => {
  const schema = `auth02_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Pool, pool: pg.Pool, users: UserRepo;
  let app: ReturnType<typeof createApp>, now: number;
  let email: string;
  const send = async (message: { to: string; subject: string; text: string; html: string }) => {
    await pool.query('INSERT INTO email_outbox(to_address,subject,body_text,body_html) VALUES($1,$2,$3,$4)', [message.to, message.subject, message.text, message.html]);
  };
  const buildApp = (extra: Record<string, unknown> = {}) => createApp({ jwtSecret: secret, userRepo: users, authClock: () => now,
    signupEnabled: true, appBaseUrl: 'http://localhost:5174', emailSender: { send }, ...extra } as any);
  const post = (path: string, data: object) => request(app).post(`/api/auth/${path}`).send(data);
  const signup = () => post('signup', { name: 'Người dùng', email, password });
  const tokenFromMail = async (recipient = email, view = 'verify-email') => {
    const mail = (await pool.query('SELECT * FROM email_outbox WHERE to_address=$1 ORDER BY created_at DESC,id DESC LIMIT 1', [recipient])).rows[0];
    expect(mail).toBeDefined();
    const link = mail.body_text.match(/http[^\s]+/)![0];
    expect(new URL(link).searchParams.get('view')).toBe(view);
    return { token: new URL(link).searchParams.get('token')!, mail };
  };
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
  beforeEach(() => { now = Date.now(); email = `${randomUUID()}@example.test`; app = buildApp(); });
  afterAll(async () => {
    await pool?.end(); await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin?.end();
  });

  it('creates a pending unverified account, hashes its password and issues a hash-only 24-hour token and Vietnamese email', async () => {
    const result = await signup();
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ message: 'Kiểm tra email để xác minh tài khoản.' });
    const user = await users.findByEmail(email);
    expect(user).toMatchObject({ status: 'pending', email_verified: false, role: 'member', name: 'Người dùng' });
    expect(verifyPassword(password, user!.password)).toBe(true);
    expect(user!.password).not.toBe(password);
    const { token, mail } = await tokenFromMail();
    const row = (await pool.query('SELECT * FROM auth_tokens WHERE user_id=$1', [user!.id])).rows[0];
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(row).toMatchObject({ purpose: 'verify_email', token_hash: hash(token), used_at: null });
    expect(row.expires_at.getTime() - now).toBe(24 * 60 * 60 * 1000);
    expect(JSON.stringify(row)).not.toContain(token);
    expect(mail.body_html).toContain('xác minh');
  });

  it('returns identical signup HTTP data for a duplicate and notifies the existing email without replacing the account', async () => {
    const first = await signup(); expect(first.status).toBe(200);
    const user = await users.findByEmail(email);
    const second = await post('signup', { email: email.toUpperCase(), name: 'Khác', password: 'Changed!password123' });
    expect(second.status).toBe(first.status); expect(second.body).toEqual(first.body);
    expect(await users.findByEmail(email)).toMatchObject({ id: user!.id, name: 'Người dùng', password: user!.password });
    const mails = (await pool.query('SELECT subject FROM email_outbox WHERE to_address=$1', [email])).rows;
    expect(mails).toHaveLength(2); expect(mails.some(row => row.subject.includes('thử đăng ký'))).toBe(true);
    expect((await pool.query('SELECT count(*)::int AS n FROM auth_tokens WHERE user_id=$1', [user!.id])).rows[0].n).toBe(1);
  });

  it('rejects a password outside 12–128 characters before creating an account', async () => {
    for (const invalid of ['short', 'x'.repeat(129)]) expect((await post('signup', { email, name: 'Test', password: invalid })).status).toBe(400);
    expect(await users.findByEmail(email)).toBeNull();
  });

  it('verifies email once under a real PostgreSQL race and notifies only active admins while retaining pending', async () => {
    const adminEmail = `${randomUUID()}@example.test`;
    await pool.query("INSERT INTO users(email,password,name,role,status,email_verified) VALUES($1,$2,'Quản trị','admin','active',true),($3,$2,'Tắt','admin','disabled',true)", [adminEmail, storedPassword, `disabled-${adminEmail}`]);
    expect((await signup()).status).toBe(200);
    const { token } = await tokenFromMail();
    const results = await Promise.all(Array.from({ length: 4 }, () => post('verify-email', { token })));
    expect(results.map(result => result.status).sort()).toEqual([200, 400, 400, 400]);
    expect(results.find(result => result.status === 200)!.body.message).toContain('chờ quản trị viên duyệt');
    expect(await users.findByEmail(email)).toMatchObject({ status: 'pending', email_verified: true });
    expect((await pool.query('SELECT subject FROM email_outbox WHERE to_address=$1', [adminEmail])).rows).toHaveLength(1);
    expect((await pool.query('SELECT id FROM email_outbox WHERE to_address=$1', [`disabled-${adminEmail}`])).rows).toHaveLength(0);
  });

  it('rejects unknown, expired and wrong-purpose tokens without changing the user', async () => {
    expect((await signup()).status).toBe(200);
    const { token } = await tokenFromMail();
    expect((await post('reset-password', { token, password })).status).toBe(400);
    expect((await post('verify-email', { token: 'unknown' })).status).toBe(400);
    now += 24 * 60 * 60 * 1000;
    expect((await post('verify-email', { token })).status).toBe(400);
    expect(await users.findByEmail(email)).toMatchObject({ email_verified: false });
  });

  it('resends a new token, invalidates the old one and never reveals an unknown recipient', async () => {
    expect((await signup()).status).toBe(200);
    const first = await tokenFromMail(); now += 1;
    const known = await post('resend-verification', { email });
    const absent = await post('resend-verification', { email: `missing-${email}` });
    expect(known.status).toBe(200); expect(absent.status).toBe(known.status); expect(absent.body).toEqual(known.body);
    const next = await tokenFromMail(); expect(next.token).not.toBe(first.token);
    expect((await post('verify-email', { token: first.token })).status).toBe(400);
    expect((await post('verify-email', { token: next.token })).status).toBe(200);
  });

  it('creates only one usable token during concurrent reissues', async () => {
    expect((await signup()).status).toBe(200);
    const results = await Promise.all([post('resend-verification', { email }), post('resend-verification', { email })]);
    expect(results.every(result => result.status === 200)).toBe(true);
    const user = await users.findByEmail(email);
    const tokens = (await pool.query('SELECT * FROM auth_tokens WHERE user_id=$1 AND used_at IS NULL', [user!.id])).rows;
    expect(tokens).toHaveLength(1);
  });

  it('forgets identically for known and absent emails and resets atomically once while revoking every old session', async () => {
    const user = (await pool.query("INSERT INTO users(email,password,name,status,email_verified) VALUES($1,$2,'Test','active',false) RETURNING *", [email, storedPassword])).rows[0];
    const first = await users.sessions.create(user.id, 'one', now), second = await users.sessions.create(user.id, 'two', now);
    const known = await post('forgot-password', { email }), absent = await post('forgot-password', { email: `absent-${email}` });
    expect(known.status).toBe(200); expect(absent.status).toBe(known.status); expect(absent.body).toEqual(known.body);
    const { token } = await tokenFromMail(email, 'reset-password');
    const row = (await pool.query('SELECT * FROM auth_tokens WHERE token_hash=$1', [hash(token)])).rows[0];
    expect(row.expires_at.getTime() - now).toBe(30 * 60 * 1000);
    const responses = await Promise.all([post('reset-password', { token, password: 'NewAuth02!password' }), post('reset-password', { token, password: 'OtherAuth02!password' })]);
    expect(responses.map(result => result.status).sort()).toEqual([200, 400]);
    for (const session of [first, second]) expect((await post('refresh', { refreshToken: session.refreshToken })).status).toBe(401);
    const updated = (await users.findByEmail(email))!;
    expect(updated.email_verified).toBe(true);
    expect(verifyPassword(password, updated.password)).toBe(false);
    const winningPassword = responses[0].status === 200 ? 'NewAuth02!password' : 'OtherAuth02!password';
    expect((await post('login', { email, password: winningPassword })).status).toBe(200);
    expect((await post('login', { email, password })).status).toBe(401);
  });

  it('lets a Google-only account set its first password and rejects reset expiry and malformed passwords without burning the token', async () => {
    await pool.query("INSERT INTO users(email,password,name,status,google_sub) VALUES($1,NULL,'Google','active',$2)", [email, randomUUID()]);
    expect((await post('forgot-password', { email })).status).toBe(200);
    const { token } = await tokenFromMail(email, 'reset-password');
    expect((await post('reset-password', { token, password: 'short' })).status).toBe(400);
    expect((await post('reset-password', { token, password })).status).toBe(200);
    expect(await users.findByEmail(email)).toMatchObject({ email_verified: true });
    expect((await post('login', { email, password })).status).toBe(200);
    now += 1; await post('forgot-password', { email });
    const expired = await tokenFromMail(email, 'reset-password'); now += 30 * 60 * 1000;
    expect((await post('reset-password', { token: expired.token, password: 'ExpiredAuth02!password' })).status).toBe(400);
  });

  it('rejects delayed session creation from an old password authenticated before reset committed', async () => {
    const user = (await pool.query("INSERT INTO users(email,password,name,status,email_verified) VALUES($1,$2,'Stale','active',true) RETURNING *", [email, storedPassword])).rows[0];
    const snapshot = (await users.findByEmail(email))!;
    expect(verifyPassword(password, snapshot.password)).toBe(true);
    expect((await post('forgot-password', { email })).status).toBe(200);
    const { token } = await tokenFromMail(email, 'reset-password');
    expect((await post('reset-password', { token, password: 'ChangedAuth02!password' })).status).toBe(200);
    const delayed = await (users.sessions as any).create(user.id, 'stale-login', now, snapshot.password).catch(() => null);
    expect(delayed).toBeNull();
    expect((await pool.query('SELECT id FROM auth_sessions WHERE user_id=$1 AND revoked_at IS NULL', [user.id])).rows).toHaveLength(0);
  });

  it('enforces signup IP and forgot/resend email limits and Retry-After using an injected clock', async () => {
    for (let i = 0; i < 10; i++) expect((await post('signup', { email: `limit-${i}-${email}`, name: 'Test', password })).status).toBe(200);
    const blocked = await signup(); expect(blocked.status).toBe(429); expect(blocked.headers['retry-after']).toBe('3600');
    for (const path of ['forgot-password', 'resend-verification']) {
      for (let i = 0; i < 3; i++) expect((await post(path, { email })).status).toBe(200);
      const response = await post(path, { email: email.toUpperCase() }); expect(response.status).toBe(429); expect(response.headers['retry-after']).toBe('3600');
      expect((await post(path, { email: `other-${email}` })).status).toBe(200);
    }
    now += 60 * 60 * 1000;
    expect((await signup()).status).toBe(200);
    expect((await post('forgot-password', { email })).status).toBe(200);
    expect((await post('resend-verification', { email })).status).toBe(200);
  });

  it('keeps signup disabled by default and returns PostgreSQL-required 503 for new memory-only features', async () => {
    const closed = createApp({ jwtSecret: secret, userRepo: users, emailSender: { send } } as any);
    expect((await request(closed).get('/api/auth/config')).body.signupEnabled).toBe(false);
    expect((await request(closed).post('/api/auth/signup').send({ email, password, name: 'Test' })).status).toBe(403);
    const memory = createApp({ jwtSecret: secret, signupEnabled: true } as any);
    for (const path of ['signup', 'verify-email', 'resend-verification', 'forgot-password', 'reset-password']) {
      const response = await request(memory).post(`/api/auth/${path}`).send({ email, password, name: 'Test', token: 'token' });
      expect(response.status).toBe(503); expect(response.body.error).toContain('PostgreSQL');
    }
  });

  it('preserves public responses on sender failures and never logs token, links, email or provider error text', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      app = buildApp({ emailSender: { send: async (message: { text: string }) => { throw new Error(message.text); } } });
      expect((await signup()).status).toBe(200);
      expect((await post('forgot-password', { email })).status).toBe(200);
      expect(warning).toHaveBeenCalled();
      const text = JSON.stringify(warning.mock.calls);
      expect(text).not.toContain('http'); expect(text).not.toContain('token'); expect(text).not.toContain(email);
      expect(text).not.toContain(password);
    } finally { warning.mockRestore(); }
  });
});

it('AUTH-02 migration can run twice without resurrecting used tokens or replacing outbox data', async () => {
  const schema = `auth02_migration_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const url = new URL(databaseUrl); url.searchParams.set('options', `-c search_path=${schema}`);
  const pool = new pg.Pool({ connectionString: url.href });
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const files = (await readdir(directory)).filter(file => /^\d{4}_.*\.sql$/.test(file)).sort();
    for (const file of files) await pool.query(await readFile(`${directory}/${file}`, 'utf8'));
    const found = await pool.query("SELECT to_regclass('auth_tokens') AS tokens,to_regclass('email_outbox') AS outbox");
    expect(found.rows[0]).toMatchObject({ tokens: 'auth_tokens', outbox: 'email_outbox' });
    const user = (await pool.query("INSERT INTO users(email,name) VALUES('migration@example.test','Test') RETURNING id")).rows[0];
    const token = (await pool.query("INSERT INTO auth_tokens(user_id,purpose,token_hash,expires_at,used_at) VALUES($1,'verify_email',$2,now()+interval '1 day',now()) RETURNING *", [user.id, 'a'.repeat(64)])).rows[0];
    const mail = (await pool.query("INSERT INTO email_outbox(to_address,subject,body_text,body_html) VALUES('test@example.test','Test','body','<p>body</p>') RETURNING *")).rows[0];
    for (const file of files) await pool.query(await readFile(`${directory}/${file}`, 'utf8'));
    expect((await pool.query('SELECT * FROM auth_tokens WHERE id=$1', [token.id])).rows[0]).toEqual(token);
    expect((await pool.query('SELECT * FROM email_outbox WHERE id=$1', [mail.id])).rows[0]).toEqual(mail);
  } finally { await pool.end(); await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end(); }
});
