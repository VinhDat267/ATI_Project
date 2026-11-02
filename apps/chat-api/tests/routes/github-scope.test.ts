import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { encryptCredentials } from '@wap/tool-adapters';
import { createApp } from '../../src/app.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { GitHubTeamRepo } from '../../src/db/repositories/github-team-repo.js';
import { GitHubOAuthClient } from '../../src/services/github/oauth-client.js';
import { GitHubTokenManager } from '../../src/services/github/token-manager.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

const secret = 'github_scope_test_secret_at_least_32_characters';
const key = '0123456789abcdef0123456789abcdef';
type Person = Awaited<ReturnType<Awaited<ReturnType<typeof createMigratedSchema>>['person']>>;

describe('GitHub team repository scope routes', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let credentials: CredentialRepo;
  let teamRepo: GitHubTeamRepo;
  let admin: Person;
  let member: Person;

  const mockOAuthConfig = {
    clientId: 'fake-github-client-id',
    clientSecret: 'fake-github-client-secret',
    redirectUri: 'http://127.0.0.1:5174/connections/github/callback',
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    apiBaseUrl: 'https://api.github.com',
    scope: 'repo read:user',
  };

  let reposByToken: Record<string, any[]> = {};

  const fakeFetch: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const authHeader = (init?.headers as any)?.Authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (url.startsWith('https://api.github.com/user/repos')) {
      return new Response(JSON.stringify(reposByToken[token] ?? []), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
  };

  const build = () => {
    const oauthClient = new GitHubOAuthClient(mockOAuthConfig, fakeFetch);
    const tokenManager = new GitHubTokenManager({
      client: oauthClient,
      credentials,
    });
    return createApp({
      jwtSecret: secret,
      userRepo: db.users,
      credentialRepo: credentials,
      encryptionKey: key,
      serviceAdminUserIds: [admin.id],
      github: {
        oauth: mockOAuthConfig,
        fetchFn: fakeFetch,
        teamRepo,
        tokens: tokenManager,
      },
    } as any);
  };

  const bearer = (who: Person) => `Bearer ${generateAccessToken(who, secret, who.sid).accessToken}`;

  beforeAll(async () => {
    db = await createMigratedSchema('github_scope_routes');
    credentials = new CredentialRepo(db.pool, key);
    teamRepo = new GitHubTeamRepo(db.pool);
  });

  beforeEach(async () => {
    await db.pool.query("DELETE FROM github_team_repos WHERE scope_id = 'default'");
    await db.pool.query("DELETE FROM github_team_scope WHERE id = 'default'");
    await db.pool.query("DELETE FROM service_credentials WHERE service = 'github'");
    admin = await db.person('Admin');
    member = await db.person('Member');

    reposByToken = {
      gho_admin: [
        { id: 101, name: 'ati', full_name: 'nhom/ati', private: true },
        { id: 102, name: 'web', full_name: 'nhom/web', private: false },
      ],
      gho_member_partial: [
        { id: 101, name: 'ati', full_name: 'nhom/ati', private: true },
      ],
      gho_member_none: [
        { id: 999, name: 'other', full_name: 'other/repo', private: false },
      ],
    };

    await credentials.saveCredentials(
      'github',
      encryptCredentials({ accessToken: 'gho_admin', login: 'admin_octo', githubUserId: '1' }, key),
      admin.id
    );
  });

  afterAll(async () => {
    await db?.close();
  });

  it('forbids non-admin from listing candidate-repos or updating team scope', async () => {
    await credentials.saveCredentials(
      'github',
      encryptCredentials({ accessToken: 'gho_member_partial', login: 'member_octo', githubUserId: '2' }, key),
      member.id
    );
    const app = build();

    const candRes = await request(app)
      .get('/api/connections/github/candidate-repos')
      .set('Authorization', bearer(member));
    expect(candRes.status).toBe(403);

    const scopeRes = await request(app)
      .put('/api/connections/github/scope')
      .set('Authorization', bearer(member))
      .send({ repos: ['nhom/ati'] });
    expect(scopeRes.status).toBe(403);
  });

  it('allows admin to list candidate-repos and save 1..10 accessible repos, rejecting invalid or inaccessible repos without overwriting existing scope', async () => {
    const app = build();

    const candRes = await request(app)
      .get('/api/connections/github/candidate-repos')
      .set('Authorization', bearer(admin));
    expect(candRes.status).toBe(200);
    expect(candRes.body).toEqual({
      repos: [
        { repoId: '101', fullName: 'nhom/ati', name: 'ati', private: true },
        { repoId: '102', fullName: 'nhom/web', name: 'web', private: false },
      ],
    });

    const saveRes = await request(app)
      .put('/api/connections/github/scope')
      .set('Authorization', bearer(admin))
      .send({ repos: ['nhom/ati', 'nhom/web', 'nhom/ati'] });
    expect(saveRes.status).toBe(200);
    expect(saveRes.body.repos).toEqual([
      { repoId: '101', fullName: 'nhom/ati', name: 'ati' },
      { repoId: '102', fullName: 'nhom/web', name: 'web' },
    ]);

    // Reject 0 repos, >10 repos, or repo not accessible to admin
    for (const bad of [[], Array.from({ length: 11 }, (_, i) => `nhom/r${i}`), ['nhom/secret']]) {
      const badRes = await request(app)
        .put('/api/connections/github/scope')
        .set('Authorization', bearer(admin))
        .send({ repos: bad });
      expect(badRes.status).toBe(400);
    }

    // Existing scope remains intact
    const current = await teamRepo.get();
    expect(current?.repos.map((r) => r.fullName)).toEqual(['nhom/ati', 'nhom/web']);
  });

  it('computes member status as connected (subset accessible) or needs_membership (0 accessible)', async () => {
    const app = build();
    await request(app)
      .put('/api/connections/github/scope')
      .set('Authorization', bearer(admin))
      .send({ repos: ['nhom/ati', 'nhom/web'] });

    // Member with access to nhom/ati only -> connected, 1 accessible, 1 not accessible
    await credentials.saveCredentials(
      'github',
      encryptCredentials({ accessToken: 'gho_member_partial', login: 'member_octo', githubUserId: '2' }, key),
      member.id
    );
    const partialRes = await request(app)
      .get('/api/connections/github')
      .set('Authorization', bearer(member));
    expect(partialRes.status).toBe(200);
    expect(partialRes.body).toEqual({
      status: 'connected',
      login: 'member_octo',
      repos: [
        { repoId: '101', fullName: 'nhom/ati', name: 'ati', accessible: true },
        { repoId: '102', fullName: 'nhom/web', name: 'web', accessible: false },
      ],
    });

    // Member with access to neither -> needs_membership
    await credentials.saveCredentials(
      'github',
      encryptCredentials({ accessToken: 'gho_member_none', login: 'outsider_octo', githubUserId: '3' }, key),
      member.id
    );
    const noneRes = await request(app)
      .get('/api/connections/github')
      .set('Authorization', bearer(member));
    expect(noneRes.status).toBe(200);
    expect(noneRes.body).toEqual({
      status: 'needs_membership',
      login: 'outsider_octo',
      repos: [
        { repoId: '101', fullName: 'nhom/ati', name: 'ati', accessible: false },
        { repoId: '102', fullName: 'nhom/web', name: 'web', accessible: false },
      ],
    });
  });
});
