import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { decryptCredentials, encryptCredentials } from '@wap/tool-adapters';
import { createApp } from '../../src/app.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { TrelloTeamRepo } from '../../src/db/repositories/trello-team-repo.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

const secret = 'trello_connection_test_secret_at_least_32_characters';
const key = '0123456789abcdef0123456789abcdef';
type Person = Awaited<ReturnType<Awaited<ReturnType<typeof createMigratedSchema>>['person']>>;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

describe('Trello connection routes', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let credentials: CredentialRepo;
  let convRepo: ConversationRepo;
  let teamRepo: TrelloTeamRepo;
  let changed: string[];
  let now: number;
  let alice: Person;
  let bob: Person;

  const mockOAuthConfig = {
    clientId: 'fake-trello-client-id',
    clientSecret: 'fake-trello-client-secret',
    redirectUri: 'http://127.0.0.1:5174/connections/trello/callback',
    authorizationUrl: 'https://auth.atlassian.com/authorize',
    tokenUrl: 'https://auth.atlassian.com/oauth/token',
    apiBaseUrl: 'https://api.trello.com/1',
  };

  const fakeFetch: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url === 'https://auth.atlassian.com/oauth/token') {
      const body = JSON.parse(String(init?.body || '{}'));
      if (body.grant_type === 'authorization_code') {
        if (body.code === 'bad-code') {
          return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
        }
        return new Response(
          JSON.stringify({
            access_token: 'fake-access-token-from-code',
            refresh_token: 'fake-refresh-token-from-code',
            expires_in: 3600,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }
    if (url === 'https://api.trello.com/1/members/me') {
      return new Response(
        JSON.stringify({
          id: 'trello-member-123',
          username: 'alice_trello',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
  };

  const build = (trelloOpts: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
    createApp({
      jwtSecret: secret,
      userRepo: db.users,
      credentialRepo: credentials,
      convRepo,
      encryptionKey: key,
      authClock: () => now,
      appBaseUrl: 'http://127.0.0.1:5174',
      trello: {
        oauth: mockOAuthConfig,
        fetchFn: fakeFetch,
        teamRepo,
        onConnectionChanged: (id: string) => changed.push(id),
        ...trelloOpts,
      },
      ...extra,
    } as any);

  const bearer = (who: Person) => `Bearer ${generateAccessToken(who, secret, who.sid).accessToken}`;

  beforeAll(async () => {
    db = await createMigratedSchema('trello_routes');
    credentials = new CredentialRepo(db.pool, key);
    convRepo = new ConversationRepo(db.pool);
    teamRepo = new TrelloTeamRepo(db.pool);
  });

  beforeEach(async () => {
    changed = [];
    now = Date.now();
    alice = await db.person('Alice');
    bob = await db.person('Bob');
  });

  afterAll(async () => {
    await db?.close();
  });

  describe('configuration & start', () => {
    it('returns 503 without url property when TRELLO_OAUTH is missing', async () => {
      const app = build({ oauth: undefined });
      const res = await request(app)
        .post('/api/connections/trello/start')
        .set('Authorization', bearer(alice))
        .send({});

      expect(res.status).toBe(503);
      expect(res.body).toEqual({ error: 'Trello chưa được cấu hình trên máy chủ.' });
      expect(res.body.url).toBeUndefined();
    });

    it('requires a signed-in session for start', async () => {
      const app = build();
      const res = await request(app)
        .post('/api/connections/trello/start')
        .send({});

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_SESSION');
    });

    it('creates state mode connect_trello and returns authorization url without secret or audience', async () => {
      const app = build();
      const res = await request(app)
        .post('/api/connections/trello/start')
        .set('Authorization', bearer(alice))
        .send({});

      expect(res.status).toBe(200);
      expect(typeof res.body.url).toBe('string');
      expect(res.headers['cache-control']).toContain('no-store');

      const url = new URL(res.body.url);
      expect(url.origin + url.pathname).toBe(mockOAuthConfig.authorizationUrl);
      expect(url.searchParams.get('client_id')).toBe(mockOAuthConfig.clientId);
      expect(url.searchParams.get('redirect_uri')).toBe(mockOAuthConfig.redirectUri);
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('prompt')).toBe('consent');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');

      // Crucial security constraints
      expect(url.searchParams.get('client_secret')).toBeNull();
      expect(res.body.url).not.toContain(mockOAuthConfig.clientSecret);
      expect(url.searchParams.get('audience')).toBeNull();

      const rawCookie = (res.headers['set-cookie'] as unknown as string[])[0]!;
      expect(rawCookie).toMatch(/^ati_trello_browser=/);
      expect(rawCookie).toMatch(/HttpOnly/i);
      expect(rawCookie).toMatch(/Path=\/api\/connections\/trello/i);

      const cookieVal = rawCookie.split(';')[0]!.split('=')[1]!;
      const state = url.searchParams.get('state')!;
      const stateRow = (
        await db.pool.query('SELECT * FROM oauth_states WHERE state_hash = $1', [hash(state)])
      ).rows[0];

      expect(stateRow).toBeDefined();
      expect(stateRow).toMatchObject({
        mode: 'connect_trello',
        user_id: alice.id,
        session_id: alice.sid,
        browser_binding_hash: hash(cookieVal),
      });
    });

    it('accepts own conversation for returnTo and rejects other or invalid paths', async () => {
      const app = build();
      const aliceConv = await convRepo.createConversation(alice.id);
      const bobConv = await convRepo.createConversation(bob.id);

      // Own conversation -> accepted
      const okRes = await request(app)
        .post('/api/connections/trello/start')
        .set('Authorization', bearer(alice))
        .send({ returnTo: `/c/${aliceConv.id}` });
      expect(okRes.status).toBe(200);
      const okUrl = new URL(okRes.body.url);
      const okState = okUrl.searchParams.get('state')!;
      const row = (
        await db.pool.query('SELECT return_to FROM oauth_states WHERE state_hash = $1', [hash(okState)])
      ).rows[0];
      expect(row.return_to).toBe(`/c/${aliceConv.id}`);

      // Bob's conversation -> 400
      const bobRes = await request(app)
        .post('/api/connections/trello/start')
        .set('Authorization', bearer(alice))
        .send({ returnTo: `/c/${bobConv.id}` });
      expect(bobRes.status).toBe(400);
      expect(bobRes.body).toMatchObject({
        error: 'Không mở được kết nối từ hội thoại này.',
        code: 'RETURN_TO_INVALID',
      });

      // Arbitrary URL / string -> 400
      const evilRes = await request(app)
        .post('/api/connections/trello/start')
        .set('Authorization', bearer(alice))
        .send({ returnTo: 'https://evil.example.com' });
      expect(evilRes.status).toBe(400);
      expect(evilRes.body.code).toBe('RETURN_TO_INVALID');
    });
  });

  describe('CORS on callback', () => {
    it('permits configured app origin with credentials and refuses unknown origin', async () => {
      const app = build();

      const allowed = await request(app)
        .options('/api/connections/trello/callback')
        .set('Origin', 'http://127.0.0.1:5174');
      expect(allowed.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5174');
      expect(allowed.headers['access-control-allow-credentials']).toBe('true');

      const foreign = await request(app)
        .options('/api/connections/trello/callback')
        .set('Origin', 'https://evil.example');
      expect(foreign.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('callback', () => {
    it('refuses callback when state belongs to a different user', async () => {
      const app = build();

      // Alice starts a flow
      const startRes = await request(app)
        .post('/api/connections/trello/start')
        .set('Authorization', bearer(alice))
        .send({});
      const rawCookie = (startRes.headers['set-cookie'] as unknown as string[])[0]!;
      const cookie = rawCookie.split(';')[0]!;
      const state = new URL(startRes.body.url).searchParams.get('state')!;

      // Bob tries to consume Alice's state
      const res = await request(app)
        .post('/api/connections/trello/callback')
        .set('Authorization', bearer(bob))
        .set('Cookie', cookie)
        .send({ code: 'valid-auth-code', state });

      expect(res.status).toBe(400);
    });

    it('exchanges code, saves encrypted refresh token without access token, and returns username and returnTo', async () => {
      const app = build();
      const aliceConv = await convRepo.createConversation(alice.id);

      const startRes = await request(app)
        .post('/api/connections/trello/start')
        .set('Authorization', bearer(alice))
        .send({ returnTo: `/c/${aliceConv.id}` });
      const rawCookie = (startRes.headers['set-cookie'] as unknown as string[])[0]!;
      const cookie = rawCookie.split(';')[0]!;
      const state = new URL(startRes.body.url).searchParams.get('state')!;

      const callbackRes = await request(app)
        .post('/api/connections/trello/callback')
        .set('Authorization', bearer(alice))
        .set('Cookie', cookie)
        .send({ code: 'valid-auth-code', state });

      expect(callbackRes.status).toBe(200);
      expect(callbackRes.body).toEqual({
        username: 'alice_trello',
        returnTo: `/c/${aliceConv.id}`,
      });
      expect(changed).toContain(alice.id);

      // Verify stored credential
      const stored = await credentials.getPersonalConnectionStatus('trello', alice.id);
      expect(stored).toBeDefined();
      expect(stored!.status).toBe('active');
      expect(stored!.user_id).toBe(alice.id);

      const decrypted = decryptCredentials(stored!.config, key);
      expect(decrypted.refreshToken).toBe('fake-refresh-token-from-code');
      expect(decrypted.username).toBe('alice_trello');
      expect(decrypted.memberId).toBe('trello-member-123');
      // Access token must NOT be saved to DB
      expect(decrypted.accessToken).toBeUndefined();
    });
  });

  describe('delete / disconnect', () => {
    it('deletes only the caller credential and leaves another user credential intact', async () => {
      const app = build();

      // Setup credentials for Alice and Bob
      await credentials.saveCredentials(
        'trello',
        encryptCredentials({ refreshToken: 'alice-rf', username: 'alice' }, key),
        alice.id
      );
      await credentials.saveCredentials(
        'trello',
        encryptCredentials({ refreshToken: 'bob-rf', username: 'bob' }, key),
        bob.id
      );

      const res = await request(app)
        .delete('/api/connections/trello')
        .set('Authorization', bearer(alice));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(changed).toContain(alice.id);

      const aliceStatus = await credentials.getPersonalConnectionStatus('trello', alice.id);
      expect(aliceStatus).toBeNull();

      const bobStatus = await credentials.getPersonalConnectionStatus('trello', bob.id);
      expect(bobStatus).not.toBeNull();
      expect(bobStatus!.user_id).toBe(bob.id);
    });
  });

  describe('status GET /api/connections/trello', () => {
    it('returns unconfigured when OAuth is not configured', async () => {
      const app = build({ oauth: undefined });
      const res = await request(app)
        .get('/api/connections/trello')
        .set('Authorization', bearer(alice));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'unconfigured', boards: [] });
    });

    it('returns not_connected when user has no credential, ignoring shared credential with user_id null', async () => {
      const app = build();

      // Insert shared credential without user_id
      await db.pool.query(
        "INSERT INTO service_credentials (service, user_id, config) VALUES ('trello', NULL, $1) ON CONFLICT DO NOTHING",
        [encryptCredentials({ apiKey: 'shared', token: 'shared' }, key)]
      ).catch(() => {});

      const res = await request(app)
        .get('/api/connections/trello')
        .set('Authorization', bearer(alice));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'not_connected', boards: [] });
    });

    it('returns needs_scope when user is connected but no team scope has been selected', async () => {
      const app = build();

      await credentials.saveCredentials(
        'trello',
        encryptCredentials({ refreshToken: 'alice-rf', username: 'alice_trello' }, key),
        alice.id
      );

      const res = await request(app)
        .get('/api/connections/trello')
        .set('Authorization', bearer(alice));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        status: 'needs_scope',
        username: 'alice_trello',
        boards: [],
      });
    });
  });
});
