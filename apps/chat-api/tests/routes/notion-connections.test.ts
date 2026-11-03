import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { NotionConnectionRepo } from '../../src/db/repositories/notion-connection-repo.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

const secret = 'notion_routes_test_secret_at_least_32_chars!';
const key = '0123456789abcdef0123456789abcdef';

describe('Notion OAuth connection routes (/api/connections/notion & /api/connections/mynotion)', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let repo: NotionConnectionRepo;
  let alice: Awaited<ReturnType<Awaited<ReturnType<typeof createMigratedSchema>>['person']>>;
  let bob: Awaited<ReturnType<Awaited<ReturnType<typeof createMigratedSchema>>['person']>>;
  let aliceToken: string;
  let bobToken: string;
  let aliceConvId: string;

  const wsId = '11111111-2222-3333-4444-555555555555';
  const botId = '22222222-3333-4444-5555-666666666666';
  const actorId = '33333333-4444-5555-6666-777777777777';
  const db1 = '44444444-5555-6666-7777-888888888888';

  const oauthConfig = {
    clientId: 'notion-client-id',
    clientSecret: 'notion-client-secret',
    redirectUri: 'http://127.0.0.1:5174/connections/notion/callback',
    authorizationUrl: 'http://127.0.0.1:4100/v1/oauth/authorize',
    apiBaseUrl: 'http://127.0.0.1:4100/v1',
  };

  const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/oauth/token')) {
      return new Response(
        JSON.stringify({
          access_token: 'ntn_tok_1',
          refresh_token: 'ntn_ref_1',
          token_type: 'bearer',
          workspace_id: wsId,
          workspace_name: 'ATI Notion WS',
          bot_id: botId,
          owner: { type: 'user', user: { id: actorId } },
        }),
      );
    }
    if (url.endsWith('/users/me')) {
      return new Response(JSON.stringify({ object: 'user', type: 'bot', id: botId }));
    }
    if (url.endsWith('/search')) {
      return new Response(
        JSON.stringify({
          object: 'list',
          results: [
            {
              object: 'data_source',
              id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
              parent: { type: 'database_id', database_id: db1 },
              title: [{ plain_text: 'Bảng Công Việc' }],
              url: 'https://www.notion.so/bang-cong-viec',
            },
          ],
          has_more: false,
        }),
      );
    }
    if (url.endsWith(`/databases/${db1}`)) {
      return new Response(
        JSON.stringify({
          object: 'database',
          id: db1,
          title: [{ plain_text: 'Bảng Công Việc' }],
          url: 'https://www.notion.so/bang-cong-viec',
        }),
      );
    }
    if (url.endsWith('/oauth/revoke')) {
      return new Response(JSON.stringify({ revoked: true }));
    }
    return new Response(JSON.stringify({ object: 'error' }), { status: 404 });
  }) as unknown as typeof fetch;

  beforeAll(async () => {
    db = await createMigratedSchema('notion_routes');
    repo = new NotionConnectionRepo(db.pool);
    alice = await db.person('alice');
    bob = await db.person('bob');
    aliceToken = generateAccessToken(alice, secret, alice.sid).accessToken;
    bobToken = generateAccessToken(bob, secret, bob.sid).accessToken;
    aliceConvId = (
      await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [alice.id])
    ).rows[0].id;
  });

  afterAll(async () => {
    await db?.close();
  });

  it('completes OAuth with returnTo, lists & validates databases (including pasted Notion URL), and enables toolsAvailable', async () => {
    const app = createApp({
      jwtSecret: secret,
      encryptionKey: key,
      userRepo: db.users,
      notion: {
        oauth: oauthConfig,
        repo,
        fetchFn,
        conversationOwner: async (id) => (id === aliceConvId ? alice.id : null),
      },
    });

    // Rejects foreign conversation in returnTo
    const badStart = await request(app)
      .post('/api/connections/notion/start')
      .set('Authorization', `Bearer ${bobToken}`)
      .send({ returnTo: `/c/${aliceConvId}` });
    expect(badStart.status).toBe(400);
    expect(badStart.body.code).toBe('RETURN_TO_INVALID');

    // Starts with valid returnTo
    const startRes = await request(app)
      .post('/api/connections/notion/start')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ returnTo: `/c/${aliceConvId}` });
    expect(startRes.status).toBe(200);
    const cookie = startRes.headers['set-cookie']?.[0]?.split(';')[0] ?? '';
    const state = new URL(startRes.body.url).searchParams.get('state')!;

    // Callback completes and auto-activates 1-Click scope when 1..20 databases were shared in Notion OAuth
    const cbRes = await request(app)
      .post('/api/connections/notion/callback')
      .set('Authorization', `Bearer ${aliceToken}`)
      .set('Cookie', cookie)
      .send({ code: 'auth-code-1', state });
    expect(cbRes.status).toBe(200);
    expect(cbRes.body).toMatchObject({
      workspaceId: wsId,
      workspaceName: 'ATI Notion WS',
      status: 'connected',
      toolsAvailable: true,
      allowedDatabases: [db1],
      selectedDatabases: [
        { id: db1, title: 'Bảng Công Việc', url: 'https://www.notion.so/bang-cong-viec' },
      ],
      returnTo: `/c/${aliceConvId}`,
    });

    const connId = cbRes.body.id;

    // Search databases
    const dbsRes = await request(app)
      .get(`/api/connections/notion/${connId}/databases?query=`)
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(dbsRes.status).toBe(200);
    expect(dbsRes.body.databases).toEqual([
      { id: db1, title: 'Bảng Công Việc', url: 'https://www.notion.so/bang-cong-viec' },
    ]);

    // Update scope using a full Notion database URL -> normalizes to UUID, verifies with Notion, and keeps toolsAvailable: true
    const scopeRes = await request(app)
      .put(`/api/connections/notion/${connId}/scope`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({
        identityVersion: cbRes.body.identityVersion,
        databaseIds: [`https://www.notion.so/workspace/Bang-Cong-Viec-${db1.replaceAll('-', '')}?v=123`],
      });
    expect(scopeRes.status).toBe(200);
    expect(scopeRes.body).toMatchObject({
      id: connId,
      status: 'connected',
      toolsAvailable: true,
      allowedDatabases: [db1],
      selectedDatabases: [
        { id: db1, title: 'Bảng Công Việc', url: 'https://www.notion.so/bang-cong-viec' },
      ],
    });

    // GET /api/connections/notion returns aggregate status and activeConnection
    const statusRes = await request(app)
      .get('/api/connections/notion')
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body).toMatchObject({
      status: 'connected',
      toolsAvailable: true,
      activeConnection: {
        id: connId,
        workspaceName: 'ATI Notion WS',
        allowedDatabases: [db1],
      },
    });
  });
});
