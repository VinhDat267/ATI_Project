import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express, { type Express } from 'express';
import { createHash } from 'node:crypto';
import { decryptCredentials, encryptCredentials } from '@wap/tool-adapters';
import { MYCALENDAR_SCOPE } from '@wap/tool-schemas';
import { startFakeGoogleGmail, type FakeGoogleGmail } from '../../../../scripts/fake-google-gmail.mjs';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { validateEnv } from '../../src/config/env.js';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { GmailConnectionRepo } from '../../src/db/repositories/gmail-connection-repo.js';
import { GmailTokenManager } from '../../src/services/gmail/token-manager.js';
import { GmailOAuthClient } from '../../src/services/gmail/oauth-client.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
import { createGmailConnectionRoutes } from '../../src/routes/connections/gmail.js';
import {
  createMyCalendarConnectionRoutes,
  isMyCalendarAvailable,
  type MyCalendarConnectionsOptions,
} from '../../src/routes/connections/mycalendar.js';

const secret = 'mycalendar_test_secret_at_least_32_characters';
const key = '0123456789abcdef0123456789abcdef';
const SENTINEL = 'ya29.SENTINEL-MYCALENDAR-TOKEN';
type Person = Awaited<ReturnType<Awaited<ReturnType<typeof createMigratedSchema>>['person']>>;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

describe('MyCalendar connection routes over HTTP, PostgreSQL and the fake Google server', () => {
  let google: FakeGoogleGmail,
    db: Awaited<ReturnType<typeof createMigratedSchema>>,
    credentials: CredentialRepo,
    repo: GmailConnectionRepo,
    gmailRepo: GmailConnectionRepo;
  let changed: string[], now: number, alice: Person, bob: Person, seen: string[], logs: string[];

  const oauth = () => ({
    clientId: 'mycalendar-test.apps.googleusercontent.com',
    clientSecret: 'fake-mycalendar-secret',
    redirectUri: 'http://127.0.0.1:5174/connections/mycalendar/callback',
    ...google.endpoints,
  });

  const build = (mycalendar: Partial<MyCalendarConnectionsOptions> = {}, extra: { convRepo?: ConversationRepo } = {}): Express => {
    const app = express();
    app.use(express.json());
    const options: MyCalendarConnectionsOptions = {
      jwtSecret: secret,
      sessionRepo: db.users.sessions,
      states: db.users.googleAuth,
      credentialRepo: credentials,
      repo,
      oauth: oauth(),
      encryptionKey: key,
      clock: () => now,
      revokeTimeoutMs: 300,
      onConnectionChanged: (id: string) => changed.push(id),
      conversationOwner: extra.convRepo
        ? async (id: string) => (await extra.convRepo!.getConversation(id))?.user_id ?? null
        : undefined,
      ...mycalendar,
    };
    app.use('/api/connections/mycalendar', createMyCalendarConnectionRoutes(options));
    return app;
  };

  const bearer = (who: Person) => `Bearer ${generateAccessToken(who, secret, who.sid).accessToken}`;
  const record = <T extends { body: unknown; headers: Record<string, unknown> }>(response: T): T => {
    seen.push(JSON.stringify(response.body), JSON.stringify(response.headers));
    return response;
  };

  const start = async (app: Express, who: Person, browserCookie?: string) => {
    const req = request(app).post('/api/connections/mycalendar/start').set('Authorization', bearer(who));
    if (browserCookie) req.set('Cookie', browserCookie);
    const r = record(await req);
    expect(r.status).toBe(200);
    const raw = (r.headers['set-cookie'] as unknown as string[])[0]!;
    const url = new URL(r.body.url);
    return {
      url,
      raw,
      cookie: raw.split(';')[0]!,
      binding: raw.split(';')[0]!.split('=')[1]!,
      state: url.searchParams.get('state')!,
    };
  };

  const authorize = async (url: URL) => {
    const r = await fetch(url, { redirect: 'manual' });
    expect(r.status).toBe(302);
    const back = new URL(r.headers.get('location')!);
    return { code: back.searchParams.get('code')!, state: back.searchParams.get('state')! };
  };

  const callback = async (app: Express, who: Person, cookie: string, body: object) =>
    record(await request(app).post('/api/connections/mycalendar/callback').set('Authorization', bearer(who)).set('Cookie', cookie).send(body));

  const connect = async (app: Express, who: Person) => {
    const s = await start(app, who);
    return callback(app, who, s.cookie, await authorize(s.url));
  };

  const stored = async (who: Person) => credentials.getPersonalConnectionStatus('mycalendar', who.id);

  beforeAll(async () => {
    google = await startFakeGoogleGmail();
    db = await createMigratedSchema('mycalendar_routes');
    credentials = new CredentialRepo(db.pool);
    repo = new GmailConnectionRepo(db.pool, 'mycalendar', 'connect_mycalendar');
    gmailRepo = new GmailConnectionRepo(db.pool, 'gmail', 'connect_gmail');
  });

  beforeEach(async () => {
    Object.assign(google.settings, {
      email: 'owner.calendar@example.test',
      grantedScopes: MYCALENDAR_SCOPE.split(' '),
      issueRefreshToken: true,
      accessTokenPrefix: SENTINEL,
      exchange: 'ok',
      exchangeDelayMs: 0,
      refresh: 'ok',
      revoke: 'ok',
      profile: 'ok',
    });
    changed = [];
    now = Date.now();
    seen = [];
    logs = [];
    for (const level of ['log', 'warn', 'error', 'info'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      });
    }
    alice = await db.person('Alice');
    bob = await db.person('Bob');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    const everything = [...seen, ...logs].join('\n');
    expect(everything).not.toContain('SENTINEL');
    expect(everything).not.toContain('1//fake-');
  });

  afterAll(async () => {
    await google?.close();
    await db?.close();
  });

  describe('validateEnv rules for MYCALENDAR_ENABLED', () => {
    const base = {
      MYCALENDAR_ENABLED: 'on',
      MYCALENDAR_OAUTH_PROJECT_ID: 'ati-calendar-test',
      MYCALENDAR_OAUTH_CLIENT_ID: 'cal-client',
      MYCALENDAR_OAUTH_CLIENT_SECRET: 'cal-secret',
      MYCALENDAR_OAUTH_REDIRECT_URI: 'http://localhost:5174/connections/mycalendar/callback',
    };
    const fake = {
      MYCALENDAR_OAUTH_AUTH_URL: 'http://127.0.0.1:4100/o/oauth2/v2/auth',
      MYCALENDAR_OAUTH_TOKEN_URL: 'http://127.0.0.1:4100/token',
      MYCALENDAR_OAUTH_REVOKE_URL: 'http://127.0.0.1:4100/revoke',
      MYCALENDAR_API_BASE_URL: 'http://127.0.0.1:4100',
    };
    const live = {
      RUNTIME_MODE: 'live',
      DATABASE_URL: 'postgresql://local',
      JWT_SECRET: 'private-secret-at-least-32-characters',
      ENCRYPTION_KEY: 'a'.repeat(32),
      GEMINI_API_KEY: 'fake-for-validation',
    };

    it('is off by default and keeps MyCalendar unconfigured even when every variable is present', () => {
      const config = validateEnv({ ...base, ...fake, MYCALENDAR_ENABLED: undefined });
      expect(config.MYCALENDAR_ENABLED).toBe(false);
      expect(config.MYCALENDAR_OAUTH).toBeUndefined();
      expect(validateEnv({ ...live, ...base, MYCALENDAR_ENABLED: 'off' }).MYCALENDAR_OAUTH).toBeUndefined();
    });

    it.each(['true', 'ON', '1', 'yes'])('rejects the flag value %j', (value) => {
      expect(() => validateEnv({ MYCALENDAR_ENABLED: value })).toThrow('MYCALENDAR_ENABLED must be on or off');
    });

    it('treats an empty flag like an unset one', () => {
      expect(validateEnv({ MYCALENDAR_ENABLED: '' }).MYCALENDAR_ENABLED).toBe(false);
    });

    it('pins the real Google endpoints in live and ignores the test overrides', () => {
      const config = validateEnv({
        ...live,
        ...base,
        ...fake,
        MYCALENDAR_OAUTH_REDIRECT_URI: 'https://ati.example/connections/mycalendar/callback',
      });
      expect(config.MYCALENDAR_ENABLED).toBe(true);
      expect(config.MYCALENDAR_OAUTH).toEqual({
        clientId: 'cal-client',
        clientSecret: 'cal-secret',
        redirectUri: 'https://ati.example/connections/mycalendar/callback',
        authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        revokeUrl: 'https://oauth2.googleapis.com/revoke',
        apiBaseUrl: 'https://www.googleapis.com',
      });
    });

    it('refuses to start live when the flag is on but a variable is missing', () => {
      for (const k of ['MYCALENDAR_OAUTH_CLIENT_ID', 'MYCALENDAR_OAUTH_CLIENT_SECRET', 'MYCALENDAR_OAUTH_REDIRECT_URI']) {
        expect(() => validateEnv({ ...live, ...base, [k]: ' ' }), k).toThrow(
          `${k} is required when MYCALENDAR_ENABLED=on in live mode`
        );
      }
    });

    it('uses fake endpoints in sandbox and disables MyCalendar without them or without credentials', () => {
      expect(validateEnv({ ...base, ...fake }).MYCALENDAR_OAUTH).toMatchObject({
        tokenUrl: fake.MYCALENDAR_OAUTH_TOKEN_URL,
        revokeUrl: fake.MYCALENDAR_OAUTH_REVOKE_URL,
        apiBaseUrl: fake.MYCALENDAR_API_BASE_URL,
      });
      for (const k of [...Object.keys(fake), 'MYCALENDAR_OAUTH_CLIENT_ID', 'MYCALENDAR_OAUTH_CLIENT_SECRET', 'MYCALENDAR_OAUTH_REDIRECT_URI']) {
        const config = validateEnv({ ...base, ...fake, [k]: '' });
        expect(config.MYCALENDAR_ENABLED, k).toBe(true);
        expect(config.MYCALENDAR_OAUTH, k).toBeUndefined();
      }
    });

    it('requires the web /connections/mycalendar/callback URL without query, fragment or credentials', () => {
      for (const redirect of [
        'http://localhost:5174/connections/gmail/callback',
        'http://localhost:5174/connections/mycalendar/callback?x=1',
        'http://localhost:5174/connections/mycalendar/callback#code',
        'http://u:p@localhost:5174/connections/mycalendar/callback',
        'ftp://localhost/connections/mycalendar/callback',
      ]) {
        expect(() => validateEnv({ ...base, ...fake, MYCALENDAR_OAUTH_REDIRECT_URI: redirect }), redirect).toThrow(
          'MYCALENDAR_OAUTH_REDIRECT_URI'
        );
      }
      expect(() =>
        validateEnv({ ...live, ...base, MYCALENDAR_OAUTH_REDIRECT_URI: 'http://remote.test/connections/mycalendar/callback' })
      ).toThrow('MYCALENDAR_OAUTH_REDIRECT_URI');
    });

    it('rejects a malformed sandbox endpoint override', () => {
      expect(() => validateEnv({ ...base, ...fake, MYCALENDAR_OAUTH_TOKEN_URL: 'not a url' })).toThrow(
        'MYCALENDAR_OAUTH_TOKEN_URL'
      );
      expect(() => validateEnv({ ...base, ...fake, MYCALENDAR_API_BASE_URL: 'http://u:p@127.0.0.1:4100' })).toThrow(
        'MYCALENDAR_API_BASE_URL'
      );
    });
  });

  describe('availability and session enforcement', () => {
    it('answers 503 when OAuth, repo, or encryptionKey is missing', async () => {
      for (const app of [build({ oauth: undefined }), build({ repo: undefined }), build({ encryptionKey: undefined })]) {
        const r = await request(app).post('/api/connections/mycalendar/start').set('Authorization', bearer(alice));
        expect(r.status).toBe(503);
        expect(r.body).toEqual({ error: 'Kết nối Google Calendar chưa sẵn sàng.' });
      }
    });

    it('requires a signed-in session on every route', async () => {
      const app = build();
      for (const [method, path] of [
        ['post', '/start'],
        ['post', '/callback'],
        ['get', '/calendars'],
        ['put', '/scope'],
        ['delete', ''],
      ] as const) {
        const r = await (request(app) as any)[method](`/api/connections/mycalendar${path}`).send({});
        expect(r.status, `${method} ${path}`).toBe(401);
        expect(r.body.code).toBe('INVALID_SESSION');
      }
    });
  });

  describe('POST /start', () => {
    it('stores a hash-only connect_mycalendar state bound to user, session and browser with S256 PKCE and offline consent', async () => {
      const s = await start(build(), alice);
      expect(s.url.origin + s.url.pathname).toBe(google.endpoints.authorizationUrl);
      const params = s.url.searchParams;
      expect(params.get('scope')).toBe(MYCALENDAR_SCOPE);
      expect(params.get('access_type')).toBe('offline');
      expect(params.get('prompt')).toBe('consent');
      expect(params.get('code_challenge_method')).toBe('S256');
      expect(params.get('redirect_uri')).toBe(oauth().redirectUri);
      const row = (await db.pool.query('SELECT * FROM oauth_states WHERE state_hash=$1', [hash(s.state)])).rows[0];
      expect(row).toMatchObject({
        mode: 'connect_mycalendar',
        user_id: alice.id,
        session_id: alice.sid,
        browser_binding_hash: hash(s.binding),
      });
      expect(params.get('code_challenge')).toBe(createHash('sha256').update(row.code_verifier).digest('base64url'));
      expect(s.raw).toMatch(/^ati_mycalendar_browser=/);
      expect(s.raw).toMatch(/HttpOnly/);
      expect(s.raw).toMatch(/Path=\/api\/connections\/mycalendar/);
      expect(s.raw).toMatch(/Max-Age=600/);
    });

    it('handles returnTo: accepts owned conversation, rejects foreign or malformed returnTo', async () => {
      const convRepo = new ConversationRepo(db.pool);
      const app = build({}, { convRepo });
      const conv = (await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [alice.id])).rows[0].id as string;
      const foreignConv = (await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [bob.id])).rows[0].id as string;

      // Valid own conversation
      const validReq = await request(app)
        .post('/api/connections/mycalendar/start')
        .set('Authorization', bearer(alice))
        .send({ returnTo: `/c/${conv.toUpperCase()}` });
      expect(validReq.status).toBe(200);
      const stateRow = (await db.pool.query("SELECT return_to FROM oauth_states WHERE user_id=$1 AND mode='connect_mycalendar'", [alice.id])).rows[0];
      expect(stateRow.return_to).toBe(`/c/${conv}`);

      // Invalid / foreign conversation
      await db.pool.query("DELETE FROM oauth_states WHERE user_id=$1 AND mode='connect_mycalendar'", [alice.id]);
      for (const bad of [`/c/${foreignConv}`, '/settings', 'https://evil.example', '/c/invalid-uuid', 42, null]) {
        const r = await request(app)
          .post('/api/connections/mycalendar/start')
          .set('Authorization', bearer(alice))
          .send({ returnTo: bad });
        expect(r.status, String(bad)).toBe(400);
        expect(r.body.code).toBe('RETURN_TO_INVALID');
      }
    });
  });

  describe('POST /callback (Review Focus #1)', () => {
    it('exchanges code, filters out read-only calendars, saves encrypted config with selectedCalendars: [] and returns returnTo', async () => {
      const convRepo = new ConversationRepo(db.pool);
      const app = build({}, { convRepo });
      const conv = (await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [alice.id])).rows[0].id as string;

      const s = await request(app)
        .post('/api/connections/mycalendar/start')
        .set('Authorization', bearer(alice))
        .send({ returnTo: `/c/${conv}` });
      expect(s.status).toBe(200);
      const cookie = (s.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
      const authResult = await authorize(new URL(s.body.url));

      const r = await callback(app, alice, cookie, authResult);
      expect(r.status).toBe(200);
      expect(r.body.email).toBe('owner.calendar@example.test');
      expect(r.body.returnTo).toBe(`/c/${conv}`);

      // REVIEW FOCUS #1: Verify read-only calendar was filtered out from calendars
      const calendars = r.body.calendars;
      expect(calendars).toEqual([
        { id: 'owner.calendar@example.test', summary: 'Lịch chính', timeZone: 'Asia/Ho_Chi_Minh', primary: true },
        { id: 'c_work@group.calendar.google.com', summary: 'Lịch việc riêng', timeZone: 'Asia/Ho_Chi_Minh' },
      ]);
      expect(calendars.some((c: any) => c.id.includes('holiday') || c.accessRole === 'reader')).toBe(false);

      // Verify stored credential
      const row = (await stored(alice))!;
      expect(row).toMatchObject({ service: 'mycalendar', user_id: alice.id, status: 'active' });
      const decrypted = decryptCredentials(row.config, key);
      expect(decrypted.email).toBe('owner.calendar@example.test');
      expect(decrypted.selectedCalendars).toEqual([]);
      expect(decrypted.allowedScope).toEqual({ calendars: [] });
      expect(decrypted.refreshToken).toMatch(/^1\/\/fake-/);
      expect(changed).toEqual([alice.id]);
    });

    it('stores nothing when Google returns no refresh token', async () => {
      google.settings.issueRefreshToken = false;
      const r = await connect(build(), alice);
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('MYCALENDAR_REFRESH_TOKEN_MISSING');
      expect(await stored(alice)).toBeNull();
    });

    it('stores nothing and revokes the grant when MYCALENDAR_SCOPE was not granted', async () => {
      google.settings.grantedScopes = ['openid'];
      const before = google.stats.revocations;
      const r = await connect(build(), alice);
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('MYCALENDAR_SCOPE_MISSING');
      expect(await stored(alice)).toBeNull();
      await vi.waitFor(() => expect(google.stats.revocations).toBe(before + 1));
    });

    it('reports token exchange failure as MYCALENDAR_CONNECT_FAILED and stores nothing', async () => {
      google.settings.exchange = 'server_error';
      const r = await connect(build(), alice);
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('MYCALENDAR_CONNECT_FAILED');
      expect(await stored(alice)).toBeNull();
    });

    it('refuses expired, reused, foreign-user, foreign-session and foreign-browser states', async () => {
      const app = build();
      const expired = await start(app, alice);
      const grant = await authorize(expired.url);
      now += 601_000;
      expect((await callback(app, alice, expired.cookie, grant)).body.code).toBe('MYCALENDAR_STATE_INVALID');
      now = Date.now();

      const reused = await start(app, alice);
      const reusedGrant = await authorize(reused.url);
      expect((await callback(app, alice, reused.cookie, reusedGrant)).status).toBe(200);
      expect((await callback(app, alice, reused.cookie, reusedGrant)).body.code).toBe('MYCALENDAR_STATE_INVALID');

      const foreign = await start(app, alice);
      const foreignGrant = await authorize(foreign.url);
      expect((await callback(app, bob, foreign.cookie, foreignGrant)).body.code).toBe('MYCALENDAR_STATE_INVALID');
      const otherSession = { ...alice, sid: (await db.users.sessions.create(alice.id, 'tab 2')).sessionId };
      expect((await callback(app, otherSession, foreign.cookie, foreignGrant)).body.code).toBe('MYCALENDAR_STATE_INVALID');
      expect((await callback(app, alice, `ati_mycalendar_browser=${'x'.repeat(43)}`, foreignGrant)).body.code).toBe(
        'MYCALENDAR_STATE_INVALID'
      );
    });
  });

  describe('GET /calendars', () => {
    it('returns 409 MYCALENDAR_NOT_CONNECTED when not connected or reconnect_required', async () => {
      const app = build();
      const r1 = await request(app).get('/api/connections/mycalendar/calendars').set('Authorization', bearer(alice));
      expect(r1.status).toBe(409);
      expect(r1.body.code).toBe('MYCALENDAR_NOT_CONNECTED');

      // Connected then reconnect_required
      await connect(app, alice);
      const row = (await stored(alice))!;
      await credentials.markReconnectRequired('mycalendar', alice.id, row.id);
      const r2 = await request(app).get('/api/connections/mycalendar/calendars').set('Authorization', bearer(alice));
      expect(r2.status).toBe(409);
      expect(r2.body.code).toBe('MYCALENDAR_NOT_CONNECTED');
    });

    it('returns email, writable calendars, and selectedCalendarIds using token', async () => {
      const app = build();
      await connect(app, alice);
      const r = await request(app).get('/api/connections/mycalendar/calendars').set('Authorization', bearer(alice));
      expect(r.status).toBe(200);
      expect(r.body.email).toBe('owner.calendar@example.test');
      expect(r.body.calendars).toEqual([
        { id: 'owner.calendar@example.test', summary: 'Lịch chính', timeZone: 'Asia/Ho_Chi_Minh', primary: true },
        { id: 'c_work@group.calendar.google.com', summary: 'Lịch việc riêng', timeZone: 'Asia/Ho_Chi_Minh' },
      ]);
      expect(r.body.selectedCalendarIds).toEqual([]);
    });

    it('marks reconnect_required and returns 409 when refresh returns invalid_grant', async () => {
      const app = build();
      await connect(app, alice);
      google.settings.refresh = 'invalid_grant';
      const r = await request(app).get('/api/connections/mycalendar/calendars').set('Authorization', bearer(alice));
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('MYCALENDAR_NOT_CONNECTED');
      const row = (await stored(alice))!;
      expect(row.status).toBe('reconnect_required');
    });

    it('returns 502 MYCALENDAR_FETCH_FAILED on server error from Google', async () => {
      const app = build();
      await connect(app, alice);
      google.settings.refresh = 'server_error';
      const r = await request(app).get('/api/connections/mycalendar/calendars').set('Authorization', bearer(alice));
      expect(r.status).toBe(502);
      expect(r.body.code).toBe('MYCALENDAR_FETCH_FAILED');
    });
  });

  describe('PUT /scope (Review Focus #1 & #2)', () => {
    it('validates calendarIds: rejects empty array, > 20 items, invalid patterns with 400 MYCALENDAR_SCOPE_INVALID', async () => {
      const app = build();
      await connect(app, alice);

      for (const bad of [{ calendarIds: [] }, { calendarIds: 'not-array' }, { calendarIds: Array(21).fill('primary@example.com') }, { calendarIds: ['invalid calendar id with spaces!'] }, {}]) {
        const r = await request(app).put('/api/connections/mycalendar/scope').set('Authorization', bearer(alice)).send(bad);
        expect(r.status).toBe(400);
        expect(r.body.code).toBe('MYCALENDAR_SCOPE_INVALID');
      }
    });

    it('REVIEW FOCUS #1: rejects calendarId not in live writable calendars (read-only or unowned)', async () => {
      const app = build();
      await connect(app, alice);

      // Try selecting read-only holiday calendar
      const r1 = await request(app)
        .put('/api/connections/mycalendar/scope')
        .set('Authorization', bearer(alice))
        .send({ calendarIds: ['vi.vietnamese@holiday.calendar.google.com'] });
      expect(r1.status).toBe(400);
      expect(r1.body.code).toBe('MYCALENDAR_SCOPE_INVALID');

      // Try selecting unknown/unowned calendar
      const r2 = await request(app)
        .put('/api/connections/mycalendar/scope')
        .set('Authorization', bearer(alice))
        .send({ calendarIds: ['unknown_unowned_calendar@group.calendar.google.com'] });
      expect(r2.status).toBe(400);
      expect(r2.body.code).toBe('MYCALENDAR_SCOPE_INVALID');
    });

    it('saves selectedCalendars and allowedScope from Google metadata, updates config, and notifies', async () => {
      const app = build();
      await connect(app, alice);
      changed = [];

      const r = await request(app)
        .put('/api/connections/mycalendar/scope')
        .set('Authorization', bearer(alice))
        .send({ calendarIds: ['c_work@group.calendar.google.com', 'owner.calendar@example.test'] });

      expect(r.status).toBe(200);
      expect(r.body.email).toBe('owner.calendar@example.test');
      expect(r.body.allowedScope).toEqual(['c_work@group.calendar.google.com', 'owner.calendar@example.test']);
      expect(r.body.selectedCalendars).toEqual([
        { id: 'c_work@group.calendar.google.com', summary: 'Lịch việc riêng', timeZone: 'Asia/Ho_Chi_Minh' },
        { id: 'owner.calendar@example.test', summary: 'Lịch chính', timeZone: 'Asia/Ho_Chi_Minh', primary: true },
      ]);

      const row = (await stored(alice))!;
      const config = decryptCredentials(row.config, key);
      expect(config.selectedCalendars).toEqual(r.body.selectedCalendars);
      expect(config.allowedScope).toEqual({ calendars: r.body.allowedScope });
      expect(changed).toEqual([alice.id]);

      // GET /calendars now returns selectedCalendarIds
      const list = await request(app).get('/api/connections/mycalendar/calendars').set('Authorization', bearer(alice));
      expect(list.body.selectedCalendarIds).toEqual(r.body.allowedScope);
    });

    it('REVIEW FOCUS #2: returns 409 MYCALENDAR_NOT_CONNECTED if concurrent disconnect/reconnect changed credential row', async () => {
      const app = build();
      await connect(app, alice);

      // Simulate concurrent disconnect during PUT /scope by deleting the row right before updateConfigIfActive
      const origUpdate = repo.updateConfigIfActive.bind(repo);
      vi.spyOn(repo, 'updateConfigIfActive').mockImplementationOnce(async (userId, expectedId, transform) => {
        // Disconnect occurred concurrently
        await repo.disconnect(userId);
        return origUpdate(userId, expectedId, transform);
      });

      const r = await request(app)
        .put('/api/connections/mycalendar/scope')
        .set('Authorization', bearer(alice))
        .send({ calendarIds: ['owner.calendar@example.test'] });

      expect(r.status).toBe(409);
      expect(r.body.code).toBe('MYCALENDAR_NOT_CONNECTED');
    });

    it('POST /callback with autoSelectPrimary: true automatically selects the primary writable calendar', async () => {
      const app = build();
      const s = await start(app, alice);
      const grant = await authorize(s.url);
      const r = await request(app)
        .post('/api/connections/mycalendar/callback')
        .set('Authorization', bearer(alice))
        .set('Cookie', s.cookie)
        .send({ ...grant, autoSelectPrimary: true });

      expect(r.status).toBe(200);
      expect(r.body.selectedCalendars).toEqual([
        {
          id: 'owner.calendar@example.test',
          summary: 'Lịch chính',
          timeZone: 'Asia/Ho_Chi_Minh',
          primary: true,
        },
      ]);
      expect(r.body.allowedScope).toEqual(['owner.calendar@example.test']);
    });

    it('POST /select-primary selects the primary writable calendar in 1 click', async () => {
      const app = build();
      await connect(app, alice);

      const r = await request(app)
        .post('/api/connections/mycalendar/select-primary')
        .set('Authorization', bearer(alice));

      expect(r.status).toBe(200);
      expect(r.body.selectedCalendars).toEqual([
        {
          id: 'owner.calendar@example.test',
          summary: 'Lịch chính',
          timeZone: 'Asia/Ho_Chi_Minh',
          primary: true,
        },
      ]);
      expect(r.body.allowedScope).toEqual(['owner.calendar@example.test']);
    });
  });

  describe('DELETE / and cross-service isolation with Gmail', () => {
    it.each(['gmail', 'mycalendar'] as const)('disconnecting %s preserves a refreshable grant of the other service for the same Google account', async (disconnecting) => {
      google.settings.grantedScopes = ['https://www.googleapis.com/auth/gmail.modify', ...MYCALENDAR_SCOPE.split(' ')];
      const gmailOAuth = {
        clientId: 'gmail-test.apps.googleusercontent.com', clientSecret: 'fake-gmail-secret',
        redirectUri: 'http://127.0.0.1:5174/connections/gmail/callback', ...google.endpoints,
      };
      const app = build();
      app.use('/api/connections/gmail', createGmailConnectionRoutes({
        jwtSecret: secret, sessionRepo: db.users.sessions, states: db.users.googleAuth,
        credentialRepo: credentials, repo: gmailRepo, oauth: gmailOAuth, encryptionKey: key, clock: () => now,
      }));
      for (const service of ['gmail', 'mycalendar']) {
        const begun = await request(app).post(`/api/connections/${service}/start`).set('Authorization', bearer(alice));
        expect(begun.status).toBe(200);
        const cookie = (begun.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
        const grant = await authorize(new URL(begun.body.url));
        const connected = await request(app).post(`/api/connections/${service}/callback`)
          .set('Authorization', bearer(alice)).set('Cookie', cookie).send(grant);
        expect(connected.status).toBe(200);
      }
      const remaining = disconnecting === 'gmail' ? 'mycalendar' : 'gmail';
      const before = (await credentials.getPersonalConnectionStatus(remaining, alice.id))!;
      const beforeConfig = decryptCredentials(before.config, key);
      expect(beforeConfig.email).toBe(google.settings.email);
      expect((await request(app).delete(`/api/connections/${disconnecting}`).set('Authorization', bearer(alice))).status).toBe(200);
      expect(await credentials.getPersonalConnectionStatus(disconnecting, alice.id)).toBeNull();
      expect(await credentials.getPersonalConnectionStatus(remaining, alice.id)).toEqual(before);
      const survivingClient = new GmailOAuthClient(remaining === 'gmail' ? gmailOAuth : oauth());
      await expect(survivingClient.refresh(String(beforeConfig.refreshToken), AbortSignal.timeout(2000))).resolves.toHaveProperty('accessToken');
    });

    it('revokes the mycalendar token, deletes the mycalendar row, leaving gmail row active and untouched', async () => {
      const app = build();
      await connect(app, alice);

      // Also create an active Gmail connection for Alice using gmailRepo
      const gmailConfig = encryptCredentials(
        { refreshToken: '1//fake-gmail-token-alice', email: 'alice.gmail@example.test', scopes: ['https://www.googleapis.com/auth/gmail.modify'], connectedAt: new Date().toISOString() },
        key
      );
      await credentials.saveCredentials('gmail', gmailConfig, alice.id);
      expect((await credentials.getPersonalConnectionStatus('gmail', alice.id))?.status).toBe('active');

      const mycalToken = decryptCredentials((await stored(alice))!.config, key).refreshToken as string;
      changed = [];

      const r = await request(app).delete('/api/connections/mycalendar').set('Authorization', bearer(alice));
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ success: true });
      expect(google.isRevoked(mycalToken)).toBe(true);
      expect(await stored(alice)).toBeNull();
      expect(changed).toEqual([alice.id]);

      // Cross-service isolation check: Gmail connection must remain active and untouched!
      const gmailStatus = await credentials.getPersonalConnectionStatus('gmail', alice.id);
      expect(gmailStatus?.status).toBe('active');
      expect(decryptCredentials(gmailStatus!.config, key).email).toBe('alice.gmail@example.test');

      // Now disconnect Gmail via gmailRepo, verify MyCalendar remains unaffected (null)
      await gmailRepo.disconnect(alice.id);
      expect(await credentials.getPersonalConnectionStatus('gmail', alice.id)).toBeNull();
    });
  });
});
