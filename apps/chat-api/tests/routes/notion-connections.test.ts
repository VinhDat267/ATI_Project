import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { NotionConnectionRepo } from '../../src/db/repositories/notion-connection-repo.js';
import { AdapterFactory } from '../../src/services/adapter-factory.js';
import { NotionOAuthClient } from '../../src/services/notion/oauth-client.js';
import { NotionTokenManager } from '../../src/services/notion/token-manager.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
import { fingerprintSecret, startNotionLoopbackServer } from '../helpers/notion-oauth-test-env.js';

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

  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (!body.start_cursor) {
        return new Response(
          JSON.stringify({
            object: 'list',
            results: [
              {
                object: 'page',
                id: 'cccccccc-dddd-eeee-ffff-000000000000',
              },
            ],
            has_more: true,
            next_cursor: 'search-page-2',
          }),
        );
      }
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
          next_cursor: null,
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

  const buildLoopbackHarness = async (loopback: Awaited<ReturnType<typeof startNotionLoopbackServer>>) => {
    const user = await db.person(`route-owner-${randomUUID().slice(0, 8)}`);
    const userJwt = generateAccessToken(user, secret, user.sid).accessToken;
    const loopCfg = loopback.oauthConfig('notion-route-app');

    const connectFresh = async (wsSuffix: string, accessTok: string) => {
      const curWs = `11111111-2222-3333-4444-${wsSuffix.padStart(12, '0')}`;
      const curActor = `33333333-4444-5555-6666-${wsSuffix.padStart(12, '0')}`;
      loopback.enqueue('POST', '/oauth/token', {
        kind: 'json',
        status: 200,
        body: {
          access_token: accessTok,
          refresh_token: `ref_${accessTok}`,
          workspace_id: curWs,
          workspace_name: `WS ${wsSuffix}`,
          bot_id: botId,
          owner: { type: 'user', user: { id: curActor } },
        },
      });
      loopback.enqueue('GET', '/users/me', {
        kind: 'json',
        status: 200,
        body: { object: 'user', type: 'bot', id: botId },
      });
      loopback.enqueue('POST', '/search', {
        kind: 'json',
        status: 200,
        body: {
          object: 'list',
          results: [
            {
              object: 'database',
              id: db1,
              title: [{ plain_text: 'Permitted DB' }],
              url: 'https://www.notion.so/permitted',
            },
          ],
          has_more: false,
        },
      });

      let notifyCount = 0;
      const credRepo = new CredentialRepo(db.pool, key);
      const oauthClient = new NotionOAuthClient(loopCfg);
      const tokenManager = new NotionTokenManager(repo, oauthClient, key, (uId) => {
        notifyCount++;
        factory.clearPersonal(uId);
      });
      const factory = new AdapterFactory({
        credentialRepo: credRepo,
        encryptionKey: key,
        notionRepo: repo,
        notionTokens: tokenManager,
      });
      const routeApp = createApp({
        jwtSecret: secret,
        encryptionKey: key,
        userRepo: db.users,
        notion: {
          oauth: loopCfg,
          repo,
          tokens: tokenManager,
          revokeTimeoutMs: 80,
          onConnectionChanged: (uId) => {
            notifyCount++;
            factory.clearPersonal(uId);
          },
        },
      });

      const sRes = await request(routeApp)
        .post('/api/connections/notion/start')
        .set('Authorization', `Bearer ${userJwt}`)
        .send({});
      expect(sRes.status).toBe(200);
      const cookie = sRes.headers['set-cookie']?.[0]?.split(';')[0] ?? '';
      const st = new URL(sRes.body.url).searchParams.get('state')!;
      const cRes = await request(routeApp)
        .post('/api/connections/notion/callback')
        .set('Authorization', `Bearer ${userJwt}`)
        .set('Cookie', cookie)
        .send({ code: `code-${wsSuffix}`, state: st });
      expect(cRes.status).toBe(200);
      notifyCount = 0;
      loopback.resetLedger();
      return {
        connId: cRes.body.id as string,
        version: cRes.body.identityVersion as number,
        routeApp,
        factory,
        getNotifyCount: () => notifyCount,
        resetNotifyCount: () => {
          notifyCount = 0;
        },
      };
    };

    return { user, userJwt, loopCfg, connectFresh };
  };

  it('preserves active connection, ciphertext, version, and scope on PUT /:id/scope 403 and allows next permitted DB 200', async () => {
    const loopback = await startNotionLoopbackServer();
    try {
      const { user, userJwt, connectFresh } = await buildLoopbackHarness(loopback);
      const forbiddenDb = '99999999-8888-7777-6666-555555555555';
      const c1 = await connectFresh('1', 'syn_tok_c1');
      const rowBefore403 = (await repo.getActive(user.id, c1.connId))!;
      const fpBefore403 = fingerprintSecret(rowBefore403.config);

      loopback.enqueue('GET', `/databases/${forbiddenDb}`, {
        kind: 'json',
        status: 403,
        body: { object: 'error', status: 403, code: 'restricted_resource' },
      });
      const scope403 = await request(c1.routeApp)
        .put(`/api/connections/notion/${c1.connId}/scope`)
        .set('Authorization', `Bearer ${userJwt}`)
        .send({ identityVersion: c1.version, databaseIds: [forbiddenDb] });
      expect(scope403.status).toBe(400);
      expect(loopback.countPath('/oauth/token')).toBe(0);

      const rowAfter403 = (await repo.getActive(user.id, c1.connId))!;
      expect(rowAfter403.status).toBe('active');
      expect(fingerprintSecret(rowAfter403.config)).toBe(fpBefore403);
      expect(rowAfter403.identity_version).toBe(c1.version);
      expect(rowAfter403.allowed_databases).toEqual([db1]);

      loopback.enqueue('GET', `/databases/${db1}`, {
        kind: 'json',
        status: 200,
        body: { object: 'database', id: db1, title: [{ plain_text: 'Permitted DB' }], url: '' },
      });
      const scope200 = await request(c1.routeApp)
        .put(`/api/connections/notion/${c1.connId}/scope`)
        .set('Authorization', `Bearer ${userJwt}`)
        .send({ identityVersion: c1.version, databaseIds: [db1] });
      expect(scope200.status).toBe(200);
    } finally {
      await loopback.close();
    }
  });

  it('keeps an active connection when the provider returns unreadable identity JSON', async () => {
    const loopback = await startNotionLoopbackServer();
    try {
      const { user, userJwt, connectFresh } = await buildLoopbackHarness(loopback);
      const connection = await connectFresh('26', 'syn_tok_c26');
      const before = await repo.getActive(user.id, connection.connId);

      loopback.enqueue('GET', '/users/me', { kind: 'raw', status: 200, rawBody: '{"id":' });
      const check = await request(connection.routeApp)
        .post(`/api/connections/notion/${connection.connId}/check`)
        .set('Authorization', `Bearer ${userJwt}`);

      expect(check.status).toBe(502);
      expect(await repo.getActive(user.id, connection.connId)).toEqual(before);
      expect(loopback.countPath('/oauth/token')).toBe(0);
      expect(connection.getNotifyCount()).toBe(0);
    } finally {
      await loopback.close();
    }
  });

  it('reports uncertain provider revocation after a lost refresh response even when revoking the saved token succeeds', async () => {
    const loopback = await startNotionLoopbackServer();
    try {
      const { user, userJwt, connectFresh } = await buildLoopbackHarness(loopback);
      const connection = await connectFresh('27', 'syn_tok_c27');

      loopback.enqueue('GET', '/users/me', {
        kind: 'json', status: 401, body: { code: 'unauthorized' },
      });
      loopback.enqueue('POST', '/oauth/token', { kind: 'destroy_socket' });
      const check = await request(connection.routeApp)
        .post(`/api/connections/notion/${connection.connId}/check`)
        .set('Authorization', `Bearer ${userJwt}`);
      expect(check.status).toBe(409);
      expect(check.body.authFailureCode).toBe('rotation_unknown');
      expect(loopback.countPath('/oauth/token')).toBe(1);

      loopback.enqueue('POST', '/oauth/revoke', { kind: 'json', status: 200, body: {} });
      const result = await request(connection.routeApp)
        .delete(`/api/connections/notion/${connection.connId}`)
        .set('Authorization', `Bearer ${userJwt}`);
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ disconnected: true, providerRevocation: 'unconfirmed' });
      expect(await repo.getActive(user.id, connection.connId)).toBeNull();
      expect(loopback.countPath('/oauth/revoke')).toBe(1);
    } finally {
      await loopback.close();
    }
  });

  it('enforces transactional local disconnect vs providerRevocation across 200/502/timeout/socket-loss/local-failure/idempotency and denies cached AdapterFactory execution', async () => {
    const loopback = await startNotionLoopbackServer();
    try {
      const { user, userJwt, loopCfg, connectFresh } = await buildLoopbackHarness(loopback);
      const c1 = await connectFresh('21', 'syn_tok_c21');

      // 1) DELETE /:id with /oauth/revoke 200 -> providerRevocation: 'confirmed', stale OAuth states invalidated, notified once
      await repo.start({
        userId: user.id,
        sessionId: user.sid,
        stateHash: NotionConnectionRepo.hash('pending-stale-state'),
        browserHash: NotionConnectionRepo.hash('pending-stale-browser'),
      });
      c1.resetNotifyCount();
      loopback.resetLedger();
      loopback.enqueue('POST', '/oauth/revoke', { kind: 'json', status: 200, body: {} });

      const delOk = await request(c1.routeApp)
        .delete(`/api/connections/notion/${c1.connId}`)
        .set('Authorization', `Bearer ${userJwt}`);
      expect(delOk.status).toBe(200);
      expect(delOk.body).toEqual({
        disconnected: true,
        status: 'disconnected',
        toolsAvailable: false,
        providerRevocation: 'confirmed',
      });
      expect(c1.getNotifyCount()).toBe(1);
      expect(loopback.countPath('/oauth/revoke')).toBe(1);

      const rawDisc1 = (
        await db.pool.query('SELECT * FROM notion_connections WHERE id=$1', [c1.connId])
      ).rows[0];
      expect(rawDisc1.status).toBe('disconnected');
      expect(rawDisc1.config).toBeNull();
      expect(rawDisc1.identity_version).toBe(c1.version + 1);
      expect(
        await repo.consume({
          userId: user.id,
          sessionId: user.sid,
          state: 'pending-stale-state',
          browser: 'pending-stale-browser',
        }),
      ).toBeNull();

      // 2) Repeated DELETE on already-disconnected row AND absent UUID -> 0 revoke HTTP calls, providerRevocation: 'unconfirmed'
      loopback.resetLedger();
      const delRepeat = await request(c1.routeApp)
        .delete(`/api/connections/notion/${c1.connId}`)
        .set('Authorization', `Bearer ${userJwt}`);
      expect(delRepeat.status).toBe(200);
      expect(delRepeat.body).toEqual({
        disconnected: true,
        status: 'disconnected',
        toolsAvailable: false,
        providerRevocation: 'unconfirmed',
      });
      const delAbsent = await request(c1.routeApp)
        .delete(`/api/connections/notion/${randomUUID()}`)
        .set('Authorization', `Bearer ${userJwt}`);
      expect(delAbsent.status).toBe(200);
      expect(delAbsent.body.providerRevocation).toBe('unconfirmed');
      expect(loopback.countPath('/oauth/revoke')).toBe(0);

      // 3) DELETE /:id with revoke 502 + READ-ONLY AdapterFactory cached personal adapter invalidation
      const c2 = await connectFresh('22', 'syn_tok_c22');
      const cachedAdapter = await c2.factory.getAdapterForService('notion', {
        userId: user.id,
        phase: 'execution',
        connections: {
          notion: {
            credentialId: c2.connId,
            workspaceId: `11111111-2222-3333-4444-${'22'.padStart(12, '0')}`,
            workspaceName: 'WS 22',
            botId,
            identityVersion: c2.version,
            databaseIds: [db1],
          },
        },
      });

      c2.resetNotifyCount();
      loopback.resetLedger();
      loopback.enqueue('POST', '/oauth/revoke', {
        kind: 'json',
        status: 502,
        body: { message: 'bad gateway' },
      });

      const del502 = await request(c2.routeApp)
        .delete(`/api/connections/notion/${c2.connId}`)
        .set('Authorization', `Bearer ${userJwt}`);
      expect(del502.status).toBe(200);
      expect(del502.body).toEqual({
        disconnected: true,
        status: 'disconnected',
        toolsAvailable: false,
        providerRevocation: 'unconfirmed',
      });
      expect(c2.getNotifyCount()).toBe(1);
      expect(loopback.countPath('/oauth/revoke')).toBe(1);

      loopback.resetLedger();
      await expect(
        c2.factory.getAdapterForService('notion', { userId: user.id, phase: 'planning' }),
      ).rejects.toThrow();
      await expect(cachedAdapter.execute('notion.search_databases', {})).rejects.toThrow();
      expect(loopback.ledger).toHaveLength(0);

      // 4) DELETE /:id with real AbortSignal revoke timeout AND accepted-socket-destroy -> both commit locally & return 'unconfirmed'
      const c3 = await connectFresh('23', 'syn_tok_c23');
      loopback.enqueue('POST', '/oauth/revoke', { kind: 'hang', holdMs: 300 });
      const delTimeout = await request(c3.routeApp)
        .delete(`/api/connections/notion/${c3.connId}`)
        .set('Authorization', `Bearer ${userJwt}`);
      expect(delTimeout.status).toBe(200);
      expect(delTimeout.body.providerRevocation).toBe('unconfirmed');
      expect(c3.getNotifyCount()).toBe(1);
      expect(loopback.countPath('/oauth/revoke')).toBe(1);

      const c4 = await connectFresh('24', 'syn_tok_c24');
      loopback.enqueue('POST', '/oauth/revoke', { kind: 'destroy_socket' });
      const delSocketLoss = await request(c4.routeApp)
        .delete(`/api/connections/notion/${c4.connId}`)
        .set('Authorization', `Bearer ${userJwt}`);
      expect(delSocketLoss.status).toBe(200);
      expect(delSocketLoss.body.providerRevocation).toBe('unconfirmed');
      expect(c4.getNotifyCount()).toBe(1);
      expect(loopback.countPath('/oauth/revoke')).toBe(1);

      // 5) Local DB transaction failure during disconnect -> HTTP 500, no notification, no remote revoke, active row preserved
      const c5 = await connectFresh('25', 'syn_tok_c25');
      const failingRepo = new Proxy(repo, {
        get(target, prop, receiver) {
          if (prop === 'withOwner') {
            return async (uId: string, action: (client: pg.PoolClient) => Promise<unknown>) =>
              target.withOwner(uId, async (realClient) => {
                const origQuery = realClient.query.bind(realClient);
                const failClient = new Proxy(realClient, {
                  get(cTarget, cProp) {
                    if (cProp === 'query') {
                      return async (sql: any, params?: any) => {
                        const text = typeof sql === 'string' ? sql : String(sql?.text ?? '');
                        if (/SET\s+status\s*=\s*'disconnected'/i.test(text)) {
                          throw new Error('simulated local pg write failure');
                        }
                        return origQuery(sql, params);
                      };
                    }
                    return Reflect.get(cTarget, cProp);
                  },
                });
                return action(failClient);
              });
          }
          return Reflect.get(target, prop, receiver);
        },
      });

      let failNotify = 0;
      const failApp = createApp({
        jwtSecret: secret,
        encryptionKey: key,
        userRepo: db.users,
        notion: {
          oauth: loopCfg,
          repo: failingRepo,
          onConnectionChanged: () => {
            failNotify++;
          },
        },
      });
      loopback.resetLedger();
      const delLocalFail = await request(failApp)
        .delete(`/api/connections/notion/${c5.connId}`)
        .set('Authorization', `Bearer ${userJwt}`);
      expect(delLocalFail.status).toBeGreaterThanOrEqual(500);
      expect(failNotify).toBe(0);
      expect(loopback.countPath('/oauth/revoke')).toBe(0);
      expect((await repo.getActive(user.id, c5.connId))?.status).toBe('active');
    } finally {
      await loopback.close();
    }
  });

  it('exposes authFailureCode on quarantined connections, recovers refresh_retryable via POST /:id/check, denies rotation_unknown replay, and resets diagnostics on reconnect', async () => {
    const loopback = await startNotionLoopbackServer();
    try {
      const { userJwt, connectFresh } = await buildLoopbackHarness(loopback);
      const c5 = await connectFresh('31', 'syn_tok_c31');

      // 1) Trigger rotation_unknown via /users/me 401 + /oauth/token 503 during health check
      loopback.enqueue('GET', '/users/me', {
        kind: 'json',
        status: 401,
        body: { object: 'error', status: 401, code: 'unauthorized' },
      });
      loopback.enqueue('POST', '/oauth/token', {
        kind: 'json',
        status: 503,
        body: { error: 'service_unavailable' },
      });
      const check503 = await request(c5.routeApp)
        .post(`/api/connections/notion/${c5.connId}/check`)
        .set('Authorization', `Bearer ${userJwt}`);
      expect(check503.status).toBe(409);

      const statusBeforeReconn = await request(c5.routeApp)
        .get('/api/connections/notion')
        .set('Authorization', `Bearer ${userJwt}`);
      expect(statusBeforeReconn.body.activeConnection.authFailureCode).toBe('rotation_unknown');

      // POST /:id/check on rotation_unknown must NEVER replay /oauth/token
      loopback.resetLedger();
      const checkBlocked = await request(c5.routeApp)
        .post(`/api/connections/notion/${c5.connId}/check`)
        .set('Authorization', `Bearer ${userJwt}`);
      expect(checkBlocked.status).toBe(409);
      expect(loopback.countPath('/oauth/token')).toBe(0);

      // Reconnecting same workspace/actor increments identity_version and resets auth_failure_code to null
      const reconnected = await connectFresh('31', 'syn_tok_c31_reconnected');
      expect(reconnected.connId).toBe(c5.connId);
      expect(reconnected.version).toBeGreaterThan(c5.version);
      const afterReconn = (
        await db.pool.query('SELECT * FROM notion_connections WHERE id=$1', [c5.connId])
      ).rows[0];
      expect(afterReconn.status).toBe('active');
      expect(afterReconn.auth_failure_code).toBeNull();
      expect(afterReconn.refresh_in_flight).toBe(false);
    } finally {
      await loopback.close();
    }
  });
});
