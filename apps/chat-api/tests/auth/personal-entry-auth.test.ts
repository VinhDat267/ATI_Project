import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import pg from 'pg';
import request from 'supertest';
import { randomUUID, createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/app.js';
import { UserRepo, hashPassword } from '../../src/db/repositories/user-repo.js';
import { OutboxEmailSender } from '../../src/services/email/index.js';

const directory = fileURLToPath(new URL('../../../../db/v3/', import.meta.url));
const secret = 'personal_auth_test_secret_at_least_32_characters';
const password = 'PersonalAuth123!test';
const storedPassword = hashPassword(password);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

const config = {
  clientId: 'test-google-client',
  clientSecret: 'private-google-secret',
  redirectUri: 'http://localhost:5174/auth/google/callback',
  authorizationUrl: 'http://127.0.0.1/authorize',
  tokenUrl: 'http://127.0.0.1/token',
  jwksUrl: 'http://127.0.0.1/jwks',
};

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...keys.publicKey.export({ format: 'jwk' }), kid: 'rsa-personal', alg: 'RS256', use: 'sig' };

function createIdToken(claims: object) {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid })).toString('base64url');
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${h}.${p}.${sign('RSA-SHA256', Buffer.from(`${h}.${p}`), keys.privateKey).toString('base64url')}`;
}

describe('Personal Entry Auth (Task 1: Auto-Login after verify-email & Google auto-active)', () => {
  const schema = `personal_auth_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Pool;
  let pool: pg.Pool;
  let users: UserRepo;
  let app: ReturnType<typeof createApp>;
  let now: number;
  let email: string;
  let googleSubject: string;
  let googleEmail: string;
  let googleNonce: string;
  let exchanges: URLSearchParams[];
  let adminEmail: string;

  const fetchFn: typeof fetch = async (input, init) => {
    if (String(input) === config.jwksUrl) {
      return Response.json({ keys: [jwk] }, { headers: { 'Cache-Control': 'max-age=300' } });
    }
    exchanges.push(new URLSearchParams(String(init?.body)));
    return Response.json({
      id_token: createIdToken({
        iss: 'https://accounts.google.com',
        aud: config.clientId,
        sub: googleSubject,
        email: googleEmail,
        name: 'Người dùng Google',
        email_verified: true,
        iat: Math.floor(now / 1000),
        exp: Math.floor(now / 1000) + 300,
        nonce: googleNonce,
      }),
    });
  };

  const buildApp = (extra = {}) =>
    createApp({
      jwtSecret: secret,
      userRepo: users,
      authClock: () => now,
      signupEnabled: true,
      googleSignupEnabled: true,
      appBaseUrl: 'http://localhost:5174',
      emailSender: new OutboxEmailSender(pool),
      googleOAuth: config,
      googleFetchFn: fetchFn,
      ...extra,
    } as any);

  beforeAll(async () => {
    const db = process.env.DATABASE_URL || 'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3';
    admin = new pg.Pool({ connectionString: db });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(db);
    url.searchParams.set('options', `-c search_path=${schema}`);
    pool = new pg.Pool({ connectionString: url.href, max: 12 });
    for (const f of (await readdir(directory)).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort()) {
      await pool.query(await readFile(`${directory}/${f}`, 'utf8'));
    }
    users = new UserRepo(pool);
  });

  beforeEach(async () => {
    now = Date.now();
    email = `${randomUUID()}@example.test`;
    googleSubject = randomUUID();
    googleEmail = `${randomUUID()}@google.test`;
    googleNonce = '';
    exchanges = [];
    adminEmail = `admin-${randomUUID()}@example.test`;
    await pool.query(
      "INSERT INTO users(email,password,name,role,status,email_verified) VALUES($1,$2,'Admin Test','admin','active',true)",
      [adminEmail, storedPassword]
    );
    app = buildApp();
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  it('1. rejects login with 403 EMAIL_NOT_VERIFIED before email verification', async () => {
    const signupRes = await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Chưa Verify', email, password });
    expect(signupRes.status).toBe(200);

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email, password });
    expect(loginRes.status).toBe(403);
    expect(loginRes.body).toEqual({
      error: 'Vui lòng xác minh email trước khi đăng nhập.',
      code: 'EMAIL_NOT_VERIFIED',
    });
  });

  it('2. verifies email, activates account, issues tokens immediately, and allows GET /api/auth/me without admin notify', async () => {
    await request(app)
      .post('/api/auth/signup')
      .send({ name: 'User Kích Hoạt', email, password });

    const mail = (
      await pool.query('SELECT * FROM email_outbox WHERE to_address=$1 ORDER BY created_at DESC LIMIT 1', [email])
    ).rows[0];
    expect(mail).toBeDefined();
    const link = mail.body_text.match(/http[^\s]+/)![0];
    const token = new URL(link).searchParams.get('token')!;
    expect(token).toBeTruthy();

    // Verify email
    const verifyRes = await request(app)
      .post('/api/auth/verify-email')
      .send({ token });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.message).toContain('Email đã xác minh');
    expect(verifyRes.body.user).toMatchObject({
      email,
      status: 'active',
      emailVerified: true,
    });
    expect(verifyRes.body.accessToken).toBeDefined();
    expect(verifyRes.body.refreshToken).toBeDefined();
    expect(verifyRes.body.tokenType).toBe('Bearer');
    expect(verifyRes.body.expiresIn).toBeGreaterThan(0);

    // Call /api/auth/me immediately with accessToken
    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${verifyRes.body.accessToken}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.email).toBe(email);
    expect(meRes.body.user.status).toBe('active');

    // Confirm NO pending approval email sent to admin
    const adminMails = (
      await pool.query('SELECT * FROM email_outbox WHERE to_address=$1', [adminEmail])
    ).rows;
    expect(adminMails).toHaveLength(0);
  });

  it('3. creates active user and issues session immediately on first Google callback without admin notify', async () => {
    // Start Google OAuth
    const startRes = await request(app)
      .post('/api/auth/google/start')
      .send({ mode: 'login' });
    expect(startRes.status).toBe(200);
    const url = new URL(startRes.body.url);
    googleNonce = url.searchParams.get('nonce')!;
    const state = url.searchParams.get('state')!;
    const cookie = (startRes.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;

    // Callback
    const callbackRes = await request(app)
      .post('/api/auth/google/callback')
      .set('Cookie', cookie)
      .send({ state, code: 'mock-auth-code' });

    expect(callbackRes.status).toBe(200);
    expect(callbackRes.body.accessToken).toBeDefined();
    expect(callbackRes.body.refreshToken).toBeDefined();
    expect(callbackRes.body.user).toMatchObject({
      email: googleEmail,
      status: 'active',
      emailVerified: true,
      hasGoogle: true,
    });

    const userInDb = await users.findByEmail(googleEmail);
    expect(userInDb).toMatchObject({
      status: 'active',
      email_verified: true,
      google_sub: googleSubject,
    });

    // Verify NO admin email sent
    const adminMails = (
      await pool.query('SELECT * FROM email_outbox WHERE to_address=$1', [adminEmail])
    ).rows;
    expect(adminMails).toHaveLength(0);
  });

  it('4. retains status = disabled when disabled user clicks verify email and does not issue session', async () => {
    const disabledEmail = `${randomUUID()}@disabled.test`;
    const disabledUser = await users.createUser({
      email: disabledEmail,
      name: 'Người Bị Vô Hiệu',
      password,
    });
    await pool.query("UPDATE users SET status='disabled', email_verified=false WHERE id=$1", [disabledUser.id]);

    const token = await users.authTokens.issue(disabledUser.id, 'verify_email', now);

    const verifyRes = await request(app)
      .post('/api/auth/verify-email')
      .send({ token });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.message).toBe('Email đã xác minh.');
    expect(verifyRes.body.accessToken).toBeUndefined();
    expect(verifyRes.body.refreshToken).toBeUndefined();

    const afterDb = await users.findById(disabledUser.id);
    expect(afterDb).toMatchObject({
      status: 'disabled',
      email_verified: true,
    });
  });
});
