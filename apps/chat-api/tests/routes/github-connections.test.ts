import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { decryptCredentials, encryptCredentials } from '@wap/tool-adapters';
import { createApp } from '../../src/app.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { GitHubTeamRepo } from '../../src/db/repositories/github-team-repo.js';
import { GitHubOAuthClient } from '../../src/services/github/oauth-client.js';
import { GitHubTokenManager } from '../../src/services/github/token-manager.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

const secret = 'github_connection_test_secret_at_least_32_characters';
const key = '0123456789abcdef0123456789abcdef';
type Person = Awaited<ReturnType<Awaited<ReturnType<typeof createMigratedSchema>>['person']>>;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

describe('GitHub connection routes', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let credentials: CredentialRepo;
  let convRepo: ConversationRepo;
  let teamRepo: GitHubTeamRepo;
  let changed: string[];
  let now: number;
  let alice: Person;
  let bob: Person;

  const mockOAuthConfig = {
    clientId: 'fake-github-client-id',
    clientSecret: 'fake-github-client-secret',
    redirectUri: 'http://127.0.0.1:5174/connections/github/callback',
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    apiBaseUrl: 'https://api.github.com',
    scope: 'repo read:user',
  };

  let fakeReposResponse: { status: number; body: any } = {
    status: 200,
    body: [{ id: 101, name: 'ati', full_name: 'nhom/ati', private: true }],
  };

  const fakeFetch: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url === 'https://github.com/login/oauth/access_token') {
      const body = JSON.parse(String(init?.body || '{}'));
      if (body.code === 'bad-code') {
        return new Response(JSON.stringify({ error: 'bad_verification_code' }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          access_token: 'gho_fake_access_token',
          token_type: 'bearer',
          scope: 'repo,read:user',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url === 'https://api.github.com/user') {
      return new Response(
        JSON.stringify({
          id: 98765,
          login: 'alice_octo',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.startsWith('https://api.github.com/user/repos')) {
      return new Response(
        JSON.stringify(fakeReposResponse.body),
        { status: fakeReposResponse.status, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
  };

  const build = (githubOpts: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => {
    const oauthClient = new GitHubOAuthClient(mockOAuthConfig, fakeFetch);
    const tokenManager = new GitHubTokenManager({
      client: oauthClient,
      credentials,
      clock: () => now,
    });
    return createApp({
      jwtSecret: secret,
      userRepo: db.users,
      credentialRepo: credentials,
      convRepo,
      encryptionKey: key,
      authClock: () => now,
      appBaseUrl: 'http://127.0.0.1:5174',
      github: {
        oauth: mockOAuthConfig,
        fetchFn: fakeFetch,
        teamRepo,
        tokens: tokenManager,
        onConnectionChanged: (id: string) => changed.push(id),
        ...githubOpts,
      },
      ...extra,
    } as any);
  };

  const bearer = (who: Person) => `Bearer ${generateAccessToken(who, secret, who.sid).accessToken}`;

  beforeAll(async () => {
    db = await createMigratedSchema('github_routes');
    credentials = new CredentialRepo(db.pool, key);
    convRepo = new ConversationRepo(db.pool);
    teamRepo = new GitHubTeamRepo(db.pool);
  });

  beforeEach(async () => {
    changed = [];
    now = Date.now();
    fakeReposResponse = {
      status: 200,
      body: [{ id: 101, name: 'ati', full_name: 'nhom/ati', private: true }],
    };
    await db.pool.query("DELETE FROM github_team_repos WHERE scope_id = 'default'");
    await db.pool.query("DELETE FROM github_team_scope WHERE id = 'default'");
    alice = await db.person('Alice');
    bob = await db.person('Bob');
  });

  afterAll(async () => {
    await db?.close();
  });

  it('returns 503 when GITHUB_OAUTH is missing on start and candidate-repos, and unconfigured on GET /', async () => {
    const app = build({ oauth: undefined });
    const startRes = await request(app)
      .post('/api/connections/github/start')
      .set('Authorization', bearer(alice))
      .send({});
    expect(startRes.status).toBe(503);
    expect(startRes.body).toEqual({ error: 'GitHub chưa được cấu hình trên máy chủ.' });

    const statusRes = await request(app)
      .get('/api/connections/github')
      .set('Authorization', bearer(alice));
    expect(statusRes.status).toBe(200);
    expect(statusRes.body).toEqual({ status: 'unconfigured', repos: [] });
  });

  it('creates state mode connect_github and exchanges code in callback, validating returnTo ownership', async () => {
    const app = build();
    const aliceConv = await convRepo.createConversation(alice.id);
    const bobConv = await convRepo.createConversation(bob.id);

    const bobRes = await request(app)
      .post('/api/connections/github/start')
      .set('Authorization', bearer(alice))
      .send({ returnTo: `/c/${bobConv.id}` });
    expect(bobRes.status).toBe(400);
    expect(bobRes.body.code).toBe('RETURN_TO_INVALID');

    const startRes = await request(app)
      .post('/api/connections/github/start')
      .set('Authorization', bearer(alice))
      .send({ returnTo: `/c/${aliceConv.id}` });
    expect(startRes.status).toBe(200);
    const url = new URL(startRes.body.url);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('client_secret')).toBeNull();

    const rawCookie = (startRes.headers['set-cookie'] as unknown as string[])[0]!;
    const cookie = rawCookie.split(';')[0]!;
    const state = url.searchParams.get('state')!;

    // Bob cannot consume Alice's state
    const hijackRes = await request(app)
      .post('/api/connections/github/callback')
      .set('Authorization', bearer(bob))
      .set('Cookie', cookie)
      .send({ code: 'valid-code', state });
    expect(hijackRes.status).toBe(400);

    // Alice consumes her own state
    const callbackRes = await request(app)
      .post('/api/connections/github/callback')
      .set('Authorization', bearer(alice))
      .set('Cookie', cookie)
      .send({ code: 'valid-code', state });
    expect(callbackRes.status).toBe(200);
    expect(callbackRes.body).toEqual({
      login: 'alice_octo',
      returnTo: `/c/${aliceConv.id}`,
    });

    const stored = await credentials.getPersonalConnectionStatus('github', alice.id);
    expect(stored?.status).toBe('active');
    const dec = decryptCredentials(stored!.config, key);
    expect(dec.login).toBe('alice_octo');
    expect(dec.githubUserId).toBe('98765');
    expect(dec.accessToken).toBe('gho_fake_access_token');
  });

  it('DELETE /api/connections/github deletes only the caller connection and marks reconnect_required when token is revoked (401)', async () => {
    const app = build();
    await credentials.saveCredentials(
      'github',
      encryptCredentials({ accessToken: 'gho_alice', login: 'alice_octo', githubUserId: '1' }, key),
      alice.id
    );
    await credentials.saveCredentials(
      'github',
      encryptCredentials({ accessToken: 'gho_bob', login: 'bob_octo', githubUserId: '2' }, key),
      bob.id
    );
    await teamRepo.replace({
      chosenBy: alice.id,
      repos: [{ repoId: '101', fullName: 'nhom/ati', name: 'ati' }],
    });

    // Simulate 401 on /user/repos for Alice -> marks reconnect_required
    fakeReposResponse = { status: 401, body: { message: 'Bad credentials' } };
    const statusRes = await request(app)
      .get('/api/connections/github')
      .set('Authorization', bearer(alice));
    expect(statusRes.status).toBe(200);
    expect(statusRes.body).toEqual({
      status: 'reconnect_required',
      login: 'alice_octo',
      repos: [],
    });

    // Disconnect Alice leaves Bob intact
    const delRes = await request(app)
      .delete('/api/connections/github')
      .set('Authorization', bearer(alice));
    expect(delRes.status).toBe(200);
    expect(await credentials.getPersonalConnectionStatus('github', alice.id)).toBeNull();
    expect(await credentials.getPersonalConnectionStatus('github', bob.id)).not.toBeNull();
  });
});
