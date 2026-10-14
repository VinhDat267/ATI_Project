import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { decryptCredentials } from '@wap/tool-adapters';
import { startFakeGoogleGmail, type FakeGoogleGmail } from '../../../../scripts/fake-google-gmail.mjs';
import { createApp } from '../../src/app.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { GmailConnectionRepo } from '../../src/db/repositories/gmail-connection-repo.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

const secret = 'gmail_connection_test_secret_at_least_32_characters';
const key = '0123456789abcdef0123456789abcdef';
const SENTINEL = 'ya29.SENTINEL-GMAIL-TOKEN';
type Person = Awaited<ReturnType<Awaited<ReturnType<typeof createMigratedSchema>>['person']>>;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

describe('Gmail connection routes over HTTP, PostgreSQL and the fake Google server', () => {
  let google: FakeGoogleGmail, db: Awaited<ReturnType<typeof createMigratedSchema>>, credentials: CredentialRepo, repo: GmailConnectionRepo;
  let changed: string[], now: number, alice: Person, bob: Person, seen: string[], logs: string[];
  const oauth = () => ({ clientId: 'gmail-test.apps.googleusercontent.com', clientSecret: 'fake-gmail-secret',
    redirectUri: 'http://127.0.0.1:5174/connections/gmail/callback', ...google.endpoints });
  const build = (gmail: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => createApp({
    jwtSecret: secret, userRepo: db.users, credentialRepo: credentials, encryptionKey: key, authClock: () => now,
    gmail: { enabled: true, oauth: oauth(), repo, revokeTimeoutMs: 300, onConnectionChanged: (id: string) => changed.push(id), ...gmail },
    ...extra,
  } as any);
  const bearer = (who: Person) => `Bearer ${generateAccessToken(who, secret, who.sid).accessToken}`;
  const record = <T extends { body: unknown; headers: Record<string, unknown> }>(response: T): T => {
    seen.push(JSON.stringify(response.body), JSON.stringify(response.headers));
    return response;
  };
  const start = async (app: ReturnType<typeof build>, who: Person) => {
    const r = record(await request(app).post('/api/connections/gmail/start').set('Authorization', bearer(who)));
    expect(r.status).toBe(200);
    const raw = (r.headers['set-cookie'] as unknown as string[])[0]!;
    const url = new URL(r.body.url);
    return { url, raw, cookie: raw.split(';')[0]!, binding: raw.split(';')[0]!.split('=')[1]!, state: url.searchParams.get('state')! };
  };
  const authorize = async (url: URL) => {
    const r = await fetch(url, { redirect: 'manual' });
    expect(r.status).toBe(302);
    const back = new URL(r.headers.get('location')!);
    return { code: back.searchParams.get('code')!, state: back.searchParams.get('state')! };
  };
  const callback = async (app: ReturnType<typeof build>, who: Person, cookie: string, body: object) =>
    record(await request(app).post('/api/connections/gmail/callback').set('Authorization', bearer(who)).set('Cookie', cookie).send(body));
  const connect = async (app: ReturnType<typeof build>, who: Person) => {
    const s = await start(app, who);
    return callback(app, who, s.cookie, await authorize(s.url));
  };
  const stored = async (who: Person) => credentials.getPersonalConnectionStatus('gmail', who.id);

  beforeAll(async () => {
    google = await startFakeGoogleGmail();
    db = await createMigratedSchema('gmail_routes');
    credentials = new CredentialRepo(db.pool);
    repo = new GmailConnectionRepo(db.pool);
  });
  beforeEach(async () => {
    Object.assign(google.settings, { email: 'Owner.Mailbox@Example.test', grantedScopes: ['https://www.googleapis.com/auth/gmail.modify'],
      issueRefreshToken: true, accessTokenPrefix: SENTINEL, exchange: 'ok', exchangeDelayMs: 0, revoke: 'ok', profile: 'ok' });
    changed = []; now = Date.now(); seen = []; logs = [];
    for (const level of ['log', 'warn', 'error', 'info'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(' ')); });
    }
    alice = await db.person('Alice'); bob = await db.person('Bob');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    // No response, header or log line ever carries a token, code, state or verifier.
    const everything = [...seen, ...logs].join('\n');
    expect(everything).not.toContain('SENTINEL');
    expect(everything).not.toContain('1//fake-');
  });
  afterAll(async () => { await google?.close(); await db?.close(); });

  describe('flag and availability', () => {
    it('answers 404 on every route when GMAIL_ENABLED is off, and health keeps its old shape', async () => {
      const app = build({ enabled: false });
      for (const [method, path] of [['post', '/start'], ['post', '/callback'], ['delete', '']] as const) {
        const r = await (request(app) as any)[method](`/api/connections/gmail${path}`).set('Authorization', bearer(alice)).send({});
        expect(r.status, `${method} ${path}`).toBe(404);
      }
      expect((await request(app).get('/api/health')).body).toEqual({ status: 'ok', version: 'v3', runtimeMode: 'sandbox' });
      expect((await request(createApp({ jwtSecret: secret } as any)).get('/api/health')).body.gmailEnabled).toBeUndefined();
    });

    it('answers 503 when the flag is on but OAuth or PostgreSQL is missing (sandbox without stand-ins)', async () => {
      for (const app of [build({ oauth: undefined }), build({ repo: undefined }), build({}, { encryptionKey: undefined })]) {
        expect((await request(app).post('/api/connections/gmail/start').set('Authorization', bearer(alice))).status).toBe(503);
        expect((await request(app).get('/api/health')).body.gmailEnabled).toBe(false);
      }
      expect((await request(build()).get('/api/health')).body.gmailEnabled).toBe(true);
    });

    it('requires a signed-in session on every route', async () => {
      const app = build();
      for (const [method, path] of [['post', '/start'], ['post', '/callback'], ['delete', '']] as const) {
        const r = await (request(app) as any)[method](`/api/connections/gmail${path}`).send({});
        expect(r.status).toBe(401);
        expect(r.body.code).toBe('INVALID_SESSION');
      }
    });
  });

  describe('start', () => {
    it('stores a hash-only connect_gmail state bound to user, session and browser, with S256 PKCE and offline consent', async () => {
      const s = await start(build(), alice);
      expect(s.url.origin + s.url.pathname).toBe(google.endpoints.authorizationUrl);
      const params = s.url.searchParams;
      expect(params.get('scope')).toBe('https://www.googleapis.com/auth/gmail.modify');
      expect(params.get('access_type')).toBe('offline');
      expect(params.get('prompt')).toBe('consent');
      expect(params.get('code_challenge_method')).toBe('S256');
      expect(params.get('redirect_uri')).toBe(oauth().redirectUri);
      const row = (await db.pool.query('SELECT * FROM oauth_states WHERE state_hash=$1', [hash(s.state)])).rows[0];
      expect(row).toMatchObject({ mode: 'connect_gmail', user_id: alice.id, session_id: alice.sid, browser_binding_hash: hash(s.binding) });
      expect(params.get('code_challenge')).toBe(createHash('sha256').update(row.code_verifier).digest('base64url'));
      expect(s.raw).toMatch(/^ati_gmail_browser=/);
      expect(s.raw).toMatch(/HttpOnly/); expect(s.raw).toMatch(/Path=\/api\/connections\/gmail/); expect(s.raw).toMatch(/Max-Age=600/);
    });
  });

  describe('callback', () => {
    it('saves an encrypted config with refresh token, lowercase address, scopes and time, then drops cached adapters', async () => {
      const r = await connect(build(), alice);
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ email: 'owner.mailbox@example.test' });
      const row = (await stored(alice))!;
      expect(row).toMatchObject({ service: 'gmail', user_id: alice.id, status: 'active' });
      expect(row.config).toMatch(/^v1:/);
      expect(row.config).not.toContain('1//fake-');
      const config = decryptCredentials(row.config, key);
      expect(config).toMatchObject({ email: 'owner.mailbox@example.test', scopes: ['https://www.googleapis.com/auth/gmail.modify'] });
      expect(config.refreshToken).toMatch(/^1\/\/fake-/);
      expect(Date.parse(config.connectedAt)).toBe(now);
      expect(changed).toEqual([alice.id]);
    });

    it('stores nothing when Google returns no refresh token', async () => {
      google.settings.issueRefreshToken = false;
      const r = await connect(build(), alice);
      expect(r.status).toBe(400); expect(r.body.code).toBe('GMAIL_REFRESH_TOKEN_MISSING');
      expect(await stored(alice)).toBeNull();
    });

    it('stores nothing and revokes the grant when gmail.modify was not granted', async () => {
      google.settings.grantedScopes = ['openid'];
      const before = google.stats.revocations;
      const r = await connect(build(), alice);
      expect(r.status).toBe(400); expect(r.body.code).toBe('GMAIL_SCOPE_MISSING');
      expect(await stored(alice)).toBeNull();
      await vi.waitFor(() => expect(google.stats.revocations).toBe(before + 1));
    });

    it('reports a failed token exchange or profile read as GMAIL_CONNECT_FAILED and stores nothing', async () => {
      google.settings.exchange = 'server_error';
      expect((await connect(build(), alice)).body.code).toBe('GMAIL_CONNECT_FAILED');
      google.settings.exchange = 'ok'; google.settings.profile = 'server_error';
      expect((await connect(build(), alice)).body.code).toBe('GMAIL_CONNECT_FAILED');
      expect(await stored(alice)).toBeNull();
    });

    it('refuses expired, reused, foreign-user, foreign-session and foreign-browser states', async () => {
      const app = build();
      const expired = await start(app, alice);
      const grant = await authorize(expired.url);
      now += 601_000;
      expect((await callback(app, alice, expired.cookie, grant)).body.code).toBe('GMAIL_STATE_INVALID');
      now = Date.now();

      const reused = await start(app, alice);
      const reusedGrant = await authorize(reused.url);
      expect((await callback(app, alice, reused.cookie, reusedGrant)).status).toBe(200);
      expect((await callback(app, alice, reused.cookie, reusedGrant)).body.code).toBe('GMAIL_STATE_INVALID');

      const foreign = await start(app, alice);
      const foreignGrant = await authorize(foreign.url);
      expect((await callback(app, bob, foreign.cookie, foreignGrant)).body.code).toBe('GMAIL_STATE_INVALID');
      const otherSession = { ...alice, sid: (await db.users.sessions.create(alice.id, 'second tab')).sessionId };
      expect((await callback(app, otherSession, foreign.cookie, foreignGrant)).body.code).toBe('GMAIL_STATE_INVALID');
      expect((await callback(app, alice, `ati_gmail_browser=${'b'.repeat(43)}`, foreignGrant)).body.code).toBe('GMAIL_STATE_INVALID');
      expect((await callback(app, alice, 'other=1', foreignGrant)).body.code).toBe('GMAIL_STATE_INVALID');
      // The state survived every refused attempt: the right owner, session and browser can still finish.
      expect((await callback(app, alice, foreign.cookie, foreignGrant)).status).toBe(200);
    });

    it('rejects a callback after the session logged out, without storing anything', async () => {
      const app = build();
      const s = await start(app, alice);
      const grant = await authorize(s.url);
      await db.pool.query('UPDATE auth_sessions SET revoked_at=now() WHERE id=$1', [alice.sid]);
      const r = await callback(app, alice, s.cookie, grant);
      expect(r.status).toBe(401); expect(r.body.code).toBe('INVALID_SESSION');
      expect(await stored(alice)).toBeNull();
    });

    it('keeps login states and Gmail states in separate flows', async () => {
      const googleLogin = { clientId: 'login-client', clientSecret: 'login-secret', redirectUri: 'http://127.0.0.1:5174/auth/google/callback',
        authorizationUrl: 'http://127.0.0.1:1/authorize', tokenUrl: 'http://127.0.0.1:1/token', jwksUrl: 'http://127.0.0.1:1/jwks' };
      const app = build({}, { googleOAuth: googleLogin, googleFetchFn: async () => { throw new Error('login provider must not be called'); } });
      // A connect_gmail state presented to the sign-in callback is unknown there and stays unused.
      const gmailFlow = await start(app, alice);
      const grant = await authorize(gmailFlow.url);
      const login = record(await request(app).post('/api/auth/google/callback').set('Cookie', `ati_google_browser=${gmailFlow.binding}`).send(grant));
      expect(login.status).toBe(400); expect(login.body.code).toBe('GOOGLE_AUTH_FAILED');
      expect((await callback(app, alice, gmailFlow.cookie, grant)).status).toBe(200);
      // A sign-in state presented to the Gmail callback is refused.
      const loginStart = record(await request(app).post('/api/auth/google/start').send({ mode: 'login' }));
      const loginState = new URL(loginStart.body.url).searchParams.get('state')!;
      const loginBinding = (loginStart.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!.split('=')[1]!;
      expect((await callback(app, alice, `ati_gmail_browser=${loginBinding}`, { state: loginState, code: 'some-code' })).body.code).toBe('GMAIL_STATE_INVALID');
      expect((await db.pool.query('SELECT used_at FROM oauth_states WHERE state_hash=$1', [hash(loginState)])).rows[0].used_at).toBeNull();
    });

    it('does not bring the connection back when the callback finishes after disconnect', async () => {
      const app = build();
      const s = await start(app, alice);
      const grant = await authorize(s.url);
      google.settings.exchangeDelayMs = 300;
      const before = google.stats.revocations;
      const late = callback(app, alice, s.cookie, grant);
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(record(await request(app).delete('/api/connections/gmail').set('Authorization', bearer(alice))).status).toBe(200);
      const r = await late;
      expect(r.status).toBe(400); expect(r.body.code).toBe('GMAIL_STATE_INVALID');
      expect(await stored(alice)).toBeNull();
      // The orphaned grant from the late exchange is revoked as well.
      await vi.waitFor(() => expect(google.stats.revocations).toBe(before + 1));
    });
  });

  describe('disconnect', () => {
    it('revokes the refresh token, deletes the row and drops cached adapters', async () => {
      const app = build();
      await connect(app, alice);
      const token = decryptCredentials((await stored(alice))!.config, key).refreshToken as string;
      changed = [];
      const r = record(await request(app).delete('/api/connections/gmail').set('Authorization', bearer(alice)));
      expect(r.status).toBe(200); expect(r.body).toEqual({ success: true });
      expect(google.isRevoked(token)).toBe(true);
      expect(await stored(alice)).toBeNull();
      expect(changed).toEqual([alice.id]);
    });

    it('still deletes when revocation fails or hangs past its deadline', async () => {
      const app = build();
      for (const outcome of ['server_error', 'hang'] as const) {
        await connect(app, alice);
        google.settings.revoke = outcome;
        const started = Date.now();
        const r = record(await request(app).delete('/api/connections/gmail').set('Authorization', bearer(alice)));
        expect(r.status, outcome).toBe(200);
        expect(Date.now() - started).toBeLessThan(3_000);
        expect(await stored(alice), outcome).toBeNull();
        google.settings.revoke = 'ok';
      }
    });

    it("succeeds when nothing is connected and never touches another person's connection", async () => {
      const app = build();
      await connect(app, bob);
      expect(record(await request(app).delete('/api/connections/gmail').set('Authorization', bearer(alice))).body).toEqual({ success: true });
      expect((await stored(bob))?.status).toBe('active');
    });
  });
});
