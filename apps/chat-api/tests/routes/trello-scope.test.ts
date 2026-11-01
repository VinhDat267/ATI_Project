import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { encryptCredentials } from '@wap/tool-adapters';
import { createApp } from '../../src/app.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { TrelloTeamRepo } from '../../src/db/repositories/trello-team-repo.js';
import { TRELLO_OAUTH_SCOPE } from '../../src/services/trello/oauth-client.js';
import { TrelloTokenManager } from '../../src/services/trello/token-manager.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

const secret = 'trello_scope_test_secret_at_least_32_characters';
const key = '0123456789abcdef0123456789abcdef';
type Person = Awaited<ReturnType<Awaited<ReturnType<typeof createMigratedSchema>>['person']>>;

describe('Trello scope and workspace management routes', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let credentials: CredentialRepo;
  let teamRepo: TrelloTeamRepo;
  let tokenManager: TrelloTokenManager;
  let admin: Person;
  let memberAlice: Person;
  let memberBob: Person;

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
    const authHeader = (init?.headers as any)?.Authorization || '';

    // Mock token endpoint
    if (url === 'https://auth.atlassian.com/oauth/token') {
      const body = JSON.parse(String(init?.body || '{}'));
      return new Response(
        JSON.stringify({
          access_token: `access-token-for-${body.refresh_token || 'code'}`,
          refresh_token: `refreshed-token-for-${body.refresh_token || 'code'}`,
          expires_in: 3600,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Mock workspaces endpoint
    if (url === 'https://api.trello.com/1/members/me/organizations') {
      if (!TRELLO_OAUTH_SCOPE.includes('read:organization:trello')) {
        return new Response(JSON.stringify({ error: 'insufficient_scope' }), { status: 403 });
      }
      return new Response(
        JSON.stringify([
          { id: 'ws-1', displayName: 'Engineering Workspace' },
          { id: 'ws-2', displayName: 'Design Workspace' },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Mock boards endpoint
    if (url === 'https://api.trello.com/1/members/me/boards') {
      if (authHeader.includes('admin')) {
        return new Response(
          JSON.stringify([
            { id: 'board-1', name: 'Sprint Board', idOrganization: 'ws-1', member: true },
            { id: 'board-2', name: 'Bug Tracker', idOrganization: 'ws-1', member: true },
            { id: 'board-alien', name: 'Alien Board', idOrganization: 'ws-foreign', member: true },
            { id: 'board-nonmember', name: 'Readonly Board', idOrganization: 'ws-1', member: false },
            { id: 'board-3', name: 'Design System', idOrganization: 'ws-2', member: true },
            // Extra boards for 11-board test
            { id: 'board-4', name: 'Board 4', idOrganization: 'ws-1', member: true },
            { id: 'board-5', name: 'Board 5', idOrganization: 'ws-1', member: true },
            { id: 'board-6', name: 'Board 6', idOrganization: 'ws-1', member: true },
            { id: 'board-7', name: 'Board 7', idOrganization: 'ws-1', member: true },
            { id: 'board-8', name: 'Board 8', idOrganization: 'ws-1', member: true },
            { id: 'board-9', name: 'Board 9', idOrganization: 'ws-1', member: true },
            { id: 'board-10', name: 'Board 10', idOrganization: 'ws-1', member: true },
            { id: 'board-11', name: 'Board 11', idOrganization: 'ws-1', member: true },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (authHeader.includes('alice')) {
        // Alice is only member of board-1
        return new Response(
          JSON.stringify([
            { id: 'board-1', name: 'Sprint Board', idOrganization: 'ws-1', member: true },
            { id: 'board-2', name: 'Bug Tracker', idOrganization: 'ws-1', member: false },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (authHeader.includes('bob')) {
        // Bob is member of neither board in ws-1
        return new Response(
          JSON.stringify([
            { id: 'board-1', name: 'Sprint Board', idOrganization: 'ws-1', member: false },
            { id: 'board-2', name: 'Bug Tracker', idOrganization: 'ws-1', member: false },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
  };

  const bearer = (who: Person) => `Bearer ${generateAccessToken(who, secret, who.sid).accessToken}`;

  const build = () =>
    createApp({
      jwtSecret: secret,
      userRepo: db.users,
      credentialRepo: credentials,
      encryptionKey: key,
      authClock: () => Date.now(),
      serviceAdminUserIds: [admin.id],
      trello: {
        oauth: mockOAuthConfig,
        fetchFn: fakeFetch,
        teamRepo,
        tokens: tokenManager,
      },
    } as any);

  beforeAll(async () => {
    db = await createMigratedSchema('trello_scope_routes');
    credentials = new CredentialRepo(db.pool, key);
    teamRepo = new TrelloTeamRepo(db.pool);
    tokenManager = new TrelloTokenManager({
      client: {
        refresh: async (token) => ({
          accessToken: `access-token-for-${token}`,
          refreshToken: `next-${token}`,
          expiresInSeconds: 3600,
        }),
      },
      credentials,
    });
  });

  beforeEach(async () => {
    admin = await db.person('Admin');
    (admin as any).role = 'admin';
    memberAlice = await db.person('Alice');
    memberBob = await db.person('Bob');

    // Connect all three users to Trello with their distinct refresh tokens
    await credentials.saveCredentials(
      'trello',
      encryptCredentials({ refreshToken: 'admin-token', username: 'admin_trello' }, key),
      admin.id
    );
    await credentials.saveCredentials(
      'trello',
      encryptCredentials({ refreshToken: 'alice-token', username: 'alice_trello' }, key),
      memberAlice.id
    );
    await credentials.saveCredentials(
      'trello',
      encryptCredentials({ refreshToken: 'bob-token', username: 'bob_trello' }, key),
      memberBob.id
    );

    // Clear any team scope
    await db.pool.query("DELETE FROM trello_team_boards WHERE scope_id = 'default'");
    await db.pool.query("DELETE FROM trello_team_scope WHERE id = 'default'");
  });

  afterAll(async () => {
    await db?.close();
  });

  describe('role restrictions', () => {
    it('returns 403 when a non-admin member calls PUT /scope, GET /workspaces, or GET /workspaces/:workspaceId/boards', async () => {
      const app = build();

      const putRes = await request(app)
        .put('/api/connections/trello/scope')
        .set('Authorization', bearer(memberAlice))
        .send({ workspaceId: 'ws-1', boardIds: ['board-1'] });
      expect(putRes.status).toBe(403);

      const getWsRes = await request(app)
        .get('/api/connections/trello/workspaces')
        .set('Authorization', bearer(memberAlice));
      expect(getWsRes.status).toBe(403);

      const getBoardsRes = await request(app)
        .get('/api/connections/trello/workspaces/ws-1/boards')
        .set('Authorization', bearer(memberAlice));
      expect(getBoardsRes.status).toBe(403);
    });

    it('allows an admin to get workspaces and candidate boards for an admin workspace', async () => {
      const app = build();

      const res = await request(app)
        .get('/api/connections/trello/workspaces')
        .set('Authorization', bearer(admin));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        workspaces: [
          { id: 'ws-1', name: 'Engineering Workspace' },
          { id: 'ws-2', name: 'Design Workspace' },
        ],
      });

      const boardsRes = await request(app)
        .get('/api/connections/trello/workspaces/ws-1/boards')
        .set('Authorization', bearer(admin));
      expect(boardsRes.status).toBe(200);
      expect(boardsRes.body.boards).toBeDefined();
      expect(boardsRes.body.boards).toEqual(
        expect.arrayContaining([
          { id: 'board-1', name: 'Sprint Board', member: true },
          { id: 'board-2', name: 'Bug Tracker', member: true },
          { id: 'board-nonmember', name: 'Readonly Board', member: false },
        ])
      );
      // alien board belongs to ws-foreign, not ws-1
      expect(boardsRes.body.boards.find((b: any) => b.id === 'board-alien')).toBeUndefined();
    });

    it('returns 404 when admin requests boards for a workspace that does not belong to the admin', async () => {
      const app = build();

      const res = await request(app)
        .get('/api/connections/trello/workspaces/ws-foreign/boards')
        .set('Authorization', bearer(admin));
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Workspace không tồn tại hoặc bạn không thuộc workspace này.');
    });
  });

  describe('scope pinning and status reflection', () => {
    it('shows needs_scope to both admin and member when scope has not been selected yet', async () => {
      const app = build();

      const adminRes = await request(app)
        .get('/api/connections/trello')
        .set('Authorization', bearer(admin));
      expect(adminRes.status).toBe(200);
      expect(adminRes.body).toMatchObject({ status: 'needs_scope', boards: [] });

      const memberRes = await request(app)
        .get('/api/connections/trello')
        .set('Authorization', bearer(memberAlice));
      expect(memberRes.status).toBe(200);
      expect(memberRes.body).toMatchObject({ status: 'needs_scope', boards: [] });
    });

    it('pins 2 boards in a workspace and accurately reflects membership for admin and members', async () => {
      const app = build();

      // Admin pins 2 boards
      const pinRes = await request(app)
        .put('/api/connections/trello/scope')
        .set('Authorization', bearer(admin))
        .send({ workspaceId: 'ws-1', boardIds: ['board-1', 'board-2'] });

      expect(pinRes.status).toBe(200);
      expect(pinRes.body).toMatchObject({
        workspaceId: 'ws-1',
        workspaceName: 'Engineering Workspace',
        boards: [
          { boardId: 'board-1', boardName: 'Sprint Board' },
          { boardId: 'board-2', boardName: 'Bug Tracker' },
        ],
      });

      // Admin GET: member of both -> status connected
      const adminGet = await request(app)
        .get('/api/connections/trello')
        .set('Authorization', bearer(admin));
      expect(adminGet.status).toBe(200);
      expect(adminGet.body).toMatchObject({
        status: 'connected',
        workspaceName: 'Engineering Workspace',
        boards: [
          { boardId: 'board-1', boardName: 'Sprint Board', member: true },
          { boardId: 'board-2', boardName: 'Bug Tracker', member: true },
        ],
      });

      // Alice GET: member of board-1 only -> status connected, board-2 member: false
      const aliceGet = await request(app)
        .get('/api/connections/trello')
        .set('Authorization', bearer(memberAlice));
      expect(aliceGet.status).toBe(200);
      expect(aliceGet.body).toMatchObject({
        status: 'connected',
        workspaceName: 'Engineering Workspace',
        boards: [
          { boardId: 'board-1', boardName: 'Sprint Board', member: true },
          { boardId: 'board-2', boardName: 'Bug Tracker', member: false },
        ],
      });

      // Bob GET: member of neither -> status needs_membership
      const bobGet = await request(app)
        .get('/api/connections/trello')
        .set('Authorization', bearer(memberBob));
      expect(bobGet.status).toBe(200);
      expect(bobGet.body).toMatchObject({
        status: 'needs_membership',
        workspaceName: 'Engineering Workspace',
        boards: [
          { boardId: 'board-1', boardName: 'Sprint Board', member: false },
          { boardId: 'board-2', boardName: 'Bug Tracker', member: false },
        ],
      });
    });

    it('rejects the 11th board or board from another workspace with 400 and keeps earlier scope', async () => {
      const app = build();

      // Pin initial valid scope
      await request(app)
        .put('/api/connections/trello/scope')
        .set('Authorization', bearer(admin))
        .send({ workspaceId: 'ws-1', boardIds: ['board-1'] });

      // Try pinning 11 boards
      const elevenBoards = [
        'board-1', 'board-2', 'board-4', 'board-5', 'board-6',
        'board-7', 'board-8', 'board-9', 'board-10', 'board-11', 'board-alien'
      ];
      const elevenRes = await request(app)
        .put('/api/connections/trello/scope')
        .set('Authorization', bearer(admin))
        .send({ workspaceId: 'ws-1', boardIds: elevenBoards });
      expect(elevenRes.status).toBe(400);

      // Try pinning board from different workspace
      const diffWsRes = await request(app)
        .put('/api/connections/trello/scope')
        .set('Authorization', bearer(admin))
        .send({ workspaceId: 'ws-1', boardIds: ['board-alien'] });
      expect(diffWsRes.status).toBe(400);

      // Try pinning board where admin is not a member (member: false)
      const nonMemberRes = await request(app)
        .put('/api/connections/trello/scope')
        .set('Authorization', bearer(admin))
        .send({ workspaceId: 'ws-1', boardIds: ['board-nonmember'] });
      expect(nonMemberRes.status).toBe(400);

      // GET still sees initial scope unchanged
      const currentGet = await request(app)
        .get('/api/connections/trello')
        .set('Authorization', bearer(admin));
      expect(currentGet.body.boards).toEqual([
        { boardId: 'board-1', boardName: 'Sprint Board', member: true },
      ]);
    });

    it('replaces all boards when workspace is changed', async () => {
      const app = build();

      // First workspace
      await request(app)
        .put('/api/connections/trello/scope')
        .set('Authorization', bearer(admin))
        .send({ workspaceId: 'ws-1', boardIds: ['board-1', 'board-2'] });

      // Change to second workspace
      const changeRes = await request(app)
        .put('/api/connections/trello/scope')
        .set('Authorization', bearer(admin))
        .send({ workspaceId: 'ws-2', boardIds: ['board-3'] });

      expect(changeRes.status).toBe(200);
      expect(changeRes.body).toMatchObject({
        workspaceId: 'ws-2',
        workspaceName: 'Design Workspace',
        boards: [{ boardId: 'board-3', boardName: 'Design System' }],
      });

      const afterGet = await request(app)
        .get('/api/connections/trello')
        .set('Authorization', bearer(admin));
      expect(afterGet.body.workspaceName).toBe('Design Workspace');
      expect(afterGet.body.boards).toEqual([
        { boardId: 'board-3', boardName: 'Design System', member: true },
      ]);
    });
  });
});
