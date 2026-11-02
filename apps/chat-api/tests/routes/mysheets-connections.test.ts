import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { decryptCredentials, encryptCredentials } from '@wap/tool-adapters';
import { MYSHEETS_SCOPE } from '@wap/tool-schemas';
import { createApp, type AppOptions } from '../../src/app.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { GmailConnectionRepo } from '../../src/db/repositories/gmail-connection-repo.js';
import { GoogleAuthRepo } from '../../src/db/repositories/google-auth-repo.js';
import { SessionRepo } from '../../src/db/repositories/session-repo.js';
import { UserRepo } from '../../src/db/repositories/user-repo.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
import { startFakeGoogleGmail, type FakeGoogleGmail } from '../../../../scripts/fake-google-gmail.mjs';

const secret = 'test-jwt-secret-at-least-32-chars-long';
const SENTINEL = 'ya29.live-token-secret-sentinel';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

type Person = Awaited<ReturnType<Awaited<ReturnType<typeof createMigratedSchema>>['person']>>;

const key = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('Routes: /api/connections/mysheets', () => {
  let google: FakeGoogleGmail;
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let credentials: CredentialRepo;
  let repo: GmailConnectionRepo;
  let alice: Person;
  let bob: Person;
  let changed: string[] = [];
  let seen: string[] = [];
  let logs: string[] = [];
  let now: number;

  const oauth = () => ({
    clientId: 'mysheets-test.apps.googleusercontent.com',
    clientSecret: 'fake-mysheets-secret',
    redirectUri: 'http://127.0.0.1:5174/connections/mysheets/callback',
    projectId: 'fake-sheets-project',
    authorizationUrl: google.endpoints.authorizationUrl,
    tokenUrl: google.endpoints.tokenUrl,
    revokeUrl: google.endpoints.revokeUrl,
    apiBaseUrl: google.endpoints.apiBaseUrl,
  });

  const bearer = (who: Person) => `Bearer ${generateAccessToken(who, secret, who.sid).accessToken}`;

  const build = (overrides: Partial<AppOptions> = {}, extra: Record<string, any> = {}) =>
    createApp({
      jwtSecret: 'test-jwt-secret-at-least-32-chars-long',
      authClock: () => now,
      sessionRepo: new SessionRepo(db.pool),
      userRepo: new UserRepo(db.pool),
      credentialRepo: credentials,
      encryptionKey: key,
      states: new GoogleAuthRepo(db.pool),
      mysheets: {
        enabled: true,
        oauth: oauth(),
        repo,
        onConnectionChanged: (id) => changed.push(id),
        fakePickerBaseUrl: google.origin,
        driveApiBaseUrl: google.origin,
        picker: { apiKey: 'test-picker-key', appId: '123456789' },
      },
      ...overrides,
      ...extra,
    });

  const record = (response: request.Response) => {
    seen.push(JSON.stringify(response.body ?? {}));
    return response;
  };

  const start = async (app: Express, who: Person, browserCookie?: string) => {
    const req = request(app).post('/api/connections/mysheets/start').set('Authorization', bearer(who));
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
    record(await request(app).post('/api/connections/mysheets/callback').set('Authorization', bearer(who)).set('Cookie', cookie).send(body));

  const connect = async (app: Express, who: Person) => {
    const s = await start(app, who);
    return callback(app, who, s.cookie, await authorize(s.url));
  };

  const stored = async (who: Person) => credentials.getPersonalConnectionStatus('mysheets', who.id);

  beforeAll(async () => {
    google = await startFakeGoogleGmail();
    db = await createMigratedSchema('mysheets_routes');
    credentials = new CredentialRepo(db.pool);
    repo = new GmailConnectionRepo(db.pool, 'mysheets', 'connect_mysheets');
  });

  beforeEach(async () => {
    Object.assign(google.settings, {
      email: 'owner.sheets@example.test',
      grantedScopes: [MYSHEETS_SCOPE],
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
    expect(everything).not.toContain(SENTINEL);
    expect(everything).not.toContain('1//fake-');
  });

  afterAll(async () => {
    await google?.close();
    await db?.close();
  });

  describe('Session auth gating', () => {
    it('requires active session for all endpoints (401 INVALID_SESSION)', async () => {
      const app = build();
      for (const [method, path] of [
        ['post', '/start'],
        ['post', '/callback'],
        ['post', '/picker-session'],
        ['get', '/spreadsheets'],
        ['put', '/scope'],
        ['delete', ''],
      ] as const) {
        const r = await (request(app) as any)[method](`/api/connections/mysheets${path}`).send({});
        expect(r.status, `${method} ${path}`).toBe(401);
        expect(r.body.code).toBe('INVALID_SESSION');
      }
    });
  });

  describe('POST /start', () => {
    it('creates state with mode connect_mysheets, cookie, S256 PKCE, returnTo', async () => {
      const convRepo = new ConversationRepo(db.pool);
      const app = build({}, { convRepo });
      const conv = (await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [alice.id])).rows[0].id as string;

      const s = await request(app)
        .post('/api/connections/mysheets/start')
        .set('Authorization', bearer(alice))
        .send({ returnTo: `/c/${conv}` });
      expect(s.status).toBe(200);
      const raw = (s.headers['set-cookie'] as unknown as string[])[0]!;
      expect(raw).toMatch(/^ati_mysheets_browser=/);
      expect(raw).toMatch(/Path=\/api\/connections\/mysheets/);

      const url = new URL(s.body.url);
      expect(url.searchParams.get('scope')).toBe(MYSHEETS_SCOPE);
      expect(url.searchParams.get('access_type')).toBe('offline');

      const stateRow = (await db.pool.query("SELECT * FROM oauth_states WHERE user_id=$1 AND mode='connect_mysheets'", [alice.id])).rows[0];
      expect(stateRow.return_to).toBe(`/c/${conv}`);
    });

    it('handles returnTo: rejects foreign or malformed returnTo', async () => {
      const convRepo = new ConversationRepo(db.pool);
      const app = build({}, { convRepo });
      const foreignConv = (await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [bob.id])).rows[0].id as string;

      for (const bad of [`/c/${foreignConv}`, '/settings', 'https://evil.example', '/c/invalid-uuid', 42, null]) {
        const r = await request(app)
          .post('/api/connections/mysheets/start')
          .set('Authorization', bearer(alice))
          .send({ returnTo: bad });
        expect(r.status, String(bad)).toBe(400);
        expect(r.body.code).toBe('RETURN_TO_INVALID');
      }
    });
  });

  describe('POST /callback', () => {
    it('stores nothing when Google returns no refresh token', async () => {
      google.settings.issueRefreshToken = false;
      const app = build();
      const r = await connect(app, alice);
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('MYSHEETS_REFRESH_TOKEN_MISSING');
      expect(await stored(alice)).toBeNull();
    });

    it('stores nothing and revokes the grant when MYSHEETS_SCOPE was not granted', async () => {
      google.settings.grantedScopes = ['openid'];
      const app = build();
      const r = await connect(app, alice);
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('MYSHEETS_SCOPE_MISSING');
      expect(await stored(alice)).toBeNull();
    });

    it('exchanges code, retrieves email via Drive about.get, saves selectedSpreadsheets: [] (scope_required)', async () => {
      const convRepo = new ConversationRepo(db.pool);
      const app = build({}, { convRepo });
      const conv = (await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [alice.id])).rows[0].id as string;

      const s = await request(app)
        .post('/api/connections/mysheets/start')
        .set('Authorization', bearer(alice))
        .send({ returnTo: `/c/${conv}` });
      const cookie = (s.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
      const authResult = await authorize(new URL(s.body.url));

      const r = await callback(app, alice, cookie, authResult);
      expect(r.status).toBe(200);
      expect(r.body.email).toBe('owner.sheets@example.test');
      expect(r.body.returnTo).toBe(`/c/${conv}`);

      const row = (await stored(alice))!;
      expect(row).toMatchObject({ service: 'mysheets', user_id: alice.id, status: 'active' });
      const decrypted = decryptCredentials(row.config, key);
      expect(decrypted.email).toBe('owner.sheets@example.test');
      expect(decrypted.selectedSpreadsheets).toEqual([]);
      expect(decrypted.allowedScope).toEqual({ spreadsheets: [] });
    });
  });

  describe('POST /picker-session', () => {
    it('returns 409 MYSHEETS_NOT_CONNECTED if not connected', async () => {
      const app = build();
      const r = await request(app)
        .post('/api/connections/mysheets/picker-session')
        .set('Authorization', bearer(bob));
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('MYSHEETS_NOT_CONNECTED');
    });

    it('returns accessToken and fake picker info with Cache-Control: no-store', async () => {
      const app = build();
      await connect(app, alice);

      const r = await request(app)
        .post('/api/connections/mysheets/picker-session')
        .set('Authorization', bearer(alice));
      expect(r.status).toBe(200);
      expect(r.headers['cache-control']).toBe('no-store');
      expect(r.body.mode).toBe('fake');
      expect(r.body.accessToken).toBeTruthy();
      expect(r.body.fakePickerBaseUrl).toBe(google.origin);
    });

    it('returns live google mode picker info when fakePickerBaseUrl is omitted', async () => {
      const app = build({
        mysheets: {
          enabled: true,
          oauth: oauth(),
          repo,
          onConnectionChanged: (id) => changed.push(id),
          driveApiBaseUrl: google.origin,
          picker: { apiKey: 'test-picker-key', appId: '123456789' },
        },
      });
      await connect(app, alice);

      const r = await request(app)
        .post('/api/connections/mysheets/picker-session')
        .set('Authorization', bearer(alice));
      expect(r.status).toBe(200);
      expect(r.headers['cache-control']).toBe('no-store');
      expect(r.body.mode).toBe('google');
      expect(r.body.accessToken).toBeTruthy();
      expect(r.body.developerKey).toBe('test-picker-key');
      expect(r.body.appId).toBe('123456789');
    });

    it('enforces 10 requests per minute rate limit', async () => {
      const app = build();
      await connect(app, alice);

      for (let i = 0; i < 10; i++) {
        const r = await request(app)
          .post('/api/connections/mysheets/picker-session')
          .set('Authorization', bearer(alice));
        expect(r.status).toBe(200);
      }

      const throttled = await request(app)
        .post('/api/connections/mysheets/picker-session')
        .set('Authorization', bearer(alice));
      expect(throttled.status).toBe(429);
    });
  });

  describe('GET /spreadsheets', () => {
    it('returns email and selectedSpreadsheets from active credential', async () => {
      const app = build();
      await connect(app, alice);

      const r = await request(app)
        .get('/api/connections/mysheets/spreadsheets')
        .set('Authorization', bearer(alice));
      expect(r.status).toBe(200);
      expect(r.body.email).toBe('owner.sheets@example.test');
      expect(r.body.selectedSpreadsheets).toEqual([]);
    });
  });

  describe('PUT /scope', () => {
    const validSpreadsheetId = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
    const readOnlySpreadsheetId = '3DziOXt2ZTC7pHOfMxDfDBliowWsrvndu96QixG4wrpu';

    it('rejects empty or invalid spreadsheetIds (400 MYSHEETS_SCOPE_INVALID)', async () => {
      const app = build();
      await connect(app, alice);

      for (const bad of [[], ['short'], new Array(11).fill(validSpreadsheetId)]) {
        const r = await request(app)
          .put('/api/connections/mysheets/scope')
          .set('Authorization', bearer(alice))
          .send({ spreadsheetIds: bad });
        expect(r.status).toBe(400);
        expect(r.body.code).toBe('MYSHEETS_SCOPE_INVALID');
      }
    });

    it('rejects spreadsheetId not granted in Drive (400 MYSHEETS_SCOPE_INVALID)', async () => {
      const app = build();
      await connect(app, alice);

      const ungrantedId = '2CyiNWs1YSB6oGNeLwCeCAkhnVVrqumct85PhwF3vqnt';
      const r = await request(app)
        .put('/api/connections/mysheets/scope')
        .set('Authorization', bearer(alice))
        .send({ spreadsheetIds: [ungrantedId] });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('MYSHEETS_SCOPE_INVALID');
    });

    it('fetches metadata from Drive files.get and stores title and canEdit directly from Google', async () => {
      const app = build();
      await connect(app, alice);

      // Grant both spreadsheets via fake-picker first
      const session = await request(app)
        .post('/api/connections/mysheets/picker-session')
        .set('Authorization', bearer(alice));
      const token = session.body.accessToken;

      await fetch(`${google.origin}/fake-picker/grant`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileIds: [validSpreadsheetId, readOnlySpreadsheetId] }),
      });

      const r = await request(app)
        .put('/api/connections/mysheets/scope')
        .set('Authorization', bearer(alice))
        .send({ spreadsheetIds: [validSpreadsheetId, readOnlySpreadsheetId] });
      expect(r.status).toBe(200);
      expect(r.body.selectedSpreadsheets).toEqual([
        { id: validSpreadsheetId, title: 'Việc của tôi', canEdit: true },
        { id: readOnlySpreadsheetId, title: 'Tiến độ cá nhân', canEdit: false },
      ]);

      const storedRow = (await stored(alice))!;
      const decrypted = decryptCredentials(storedRow.config, key);
      expect(decrypted.allowedScope.spreadsheets).toEqual([validSpreadsheetId, readOnlySpreadsheetId]);
      expect(decrypted.selectedSpreadsheets).toHaveLength(2);
    });

    it('accepts full Google Sheets URLs in spreadsheetIds and discovers tab titles (sheets)', async () => {
      const app = build();
      await connect(app, alice);

      const session = await request(app)
        .post('/api/connections/mysheets/picker-session')
        .set('Authorization', bearer(alice));
      const token = session.body.accessToken;

      await fetch(`${google.origin}/fake-picker/grant`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileIds: [validSpreadsheetId] }),
      });

      const fullUrl = `https://docs.google.com/spreadsheets/d/${validSpreadsheetId}/edit#gid=0`;
      const r = await request(app)
        .put('/api/connections/mysheets/scope')
        .set('Authorization', bearer(alice))
        .send({ spreadsheetIds: [fullUrl] });

      expect(r.status).toBe(200);
      expect(r.body.selectedSpreadsheets).toEqual([
        {
          id: validSpreadsheetId,
          title: 'Việc của tôi',
          canEdit: true,
          sheets: ['Sheet1', 'Tasks'],
        },
      ]);
    });
  });

  describe('DELETE /', () => {
    it('revokes refresh token, removes db row and states, clears cache', async () => {
      const app = build();
      await connect(app, alice);

      const r = await request(app)
        .delete('/api/connections/mysheets')
        .set('Authorization', bearer(alice));
      expect(r.status).toBe(200);
      expect(r.body.success).toBe(true);

      expect(await stored(alice)).toBeNull();
      const states = (await db.pool.query("SELECT * FROM oauth_states WHERE user_id=$1 AND mode='connect_mysheets'", [alice.id])).rows;
      expect(states).toHaveLength(0);
    });

    it('revokes the mysheets token, deletes the mysheets row, leaving gmail row active and untouched', async () => {
      const app = build();
      await connect(app, alice);

      // Also create an active Gmail connection for Alice
      const gmailConfig = encryptCredentials(
        { refreshToken: '1//fake-gmail-token-alice', email: 'alice.gmail@example.test', scopes: ['https://www.googleapis.com/auth/gmail.modify'], connectedAt: new Date().toISOString() },
        key
      );
      await credentials.saveCredentials('gmail', gmailConfig, alice.id);
      expect((await credentials.getPersonalConnectionStatus('gmail', alice.id))?.status).toBe('active');

      const r = await request(app)
        .delete('/api/connections/mysheets')
        .set('Authorization', bearer(alice));
      expect(r.status).toBe(200);

      // Verify mysheets is disconnected
      expect(await stored(alice)).toBeNull();

      // Verify gmail remains active and untouched
      const gmailStatus = await credentials.getPersonalConnectionStatus('gmail', alice.id);
      expect(gmailStatus?.status).toBe('active');
      expect(decryptCredentials(gmailStatus!.config, key).email).toBe('alice.gmail@example.test');
    });
  });
});
