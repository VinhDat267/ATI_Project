import { createServer } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptCredentials, encryptCredentials, StepError } from '@wap/tool-adapters';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { TrelloTokenManager } from '../../src/services/trello/token-manager.js';
import { TrelloOAuthClient, TrelloOAuthError } from '../../src/services/trello/oauth-client.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

describe('TrelloTokenManager', () => {
  let now: number;
  let refreshCalls: string[];
  let rotateCalls: Array<{
    service: string;
    userId: string;
    credentialId: string;
    previousRefreshToken: string;
    nextRefreshToken: string;
  }>;
  let rotateOutcome: 'rotated' | 'mismatch' | 'missing';
  let reconnectCalls: Array<{ service: string; userId: string; credentialId: string }>;
  let onReconnectCalls: string[];

  const userId = 'user-1';
  const credentialId = 'cred-1';
  const initialRefreshToken = 'initial-refresh-token';

  const mockClient = {
    refresh: vi.fn().mockImplementation(async (refreshToken: string) => {
      refreshCalls.push(refreshToken);
      return {
        accessToken: `access-token-for-${refreshToken}`,
        refreshToken: `new-refresh-token-after-${refreshToken}`,
        expiresInSeconds: 3600,
      };
    }),
  };

  const mockCredentials = {
    rotatePersonalSecret: vi.fn().mockImplementation(async (input: any) => {
      rotateCalls.push(input);
      return rotateOutcome;
    }),
    markReconnectRequired: vi.fn().mockImplementation(async (service: string, uId: string, cId: string) => {
      reconnectCalls.push({ service, userId: uId, credentialId: cId });
      return true;
    }),
  };

  beforeEach(() => {
    now = 1_000_000;
    refreshCalls = [];
    rotateCalls = [];
    rotateOutcome = 'rotated';
    reconnectCalls = [];
    onReconnectCalls = [];
    vi.clearAllMocks();
  });

  const createManager = (extra: any = {}) =>
    new TrelloTokenManager({
      client: mockClient as any,
      credentials: mockCredentials as any,
      clock: () => now,
      onReconnectRequired: (uId) => onReconnectCalls.push(uId),
      ...extra,
    });

  it('does not call refresh when access token is still valid within skew window', async () => {
    const manager = createManager();
    const provider = manager.forConnection(userId, credentialId, initialRefreshToken);

    const first = await provider.getAccessToken();
    expect(first).toBe('access-token-for-initial-refresh-token');
    expect(refreshCalls).toEqual([initialRefreshToken]);

    // Token expires at now + 3600_000. Advance by 1000s (plenty of time before skew)
    now += 1_000_000;
    const second = await provider.getAccessToken();
    expect(second).toBe(first);
    expect(refreshCalls.length).toBe(1);
  });

  it('shares a single refresh between concurrent callers', async () => {
    const manager = createManager();
    // Simulate slow refresh
    mockClient.refresh.mockImplementationOnce(async (refreshToken: string) => {
      refreshCalls.push(refreshToken);
      await new Promise((r) => setTimeout(r, 50));
      return {
        accessToken: 'shared-access-token',
        refreshToken: 'next-shared-token',
        expiresInSeconds: 3600,
      };
    });

    const provider = manager.forConnection(userId, credentialId, initialRefreshToken);
    const [tokenA, tokenB] = await Promise.all([
      provider.getAccessToken(),
      provider.getAccessToken(),
    ]);

    expect(tokenA).toBe('shared-access-token');
    expect(tokenB).toBe('shared-access-token');
    expect(refreshCalls.length).toBe(1);
  });

  it('rotates refresh token and sends the newly stored token on subsequent refresh when token expires', async () => {
    const manager = createManager();
    const provider = manager.forConnection(userId, credentialId, initialRefreshToken);

    const firstAccess = await provider.getAccessToken();
    expect(firstAccess).toBe('access-token-for-initial-refresh-token');
    expect(refreshCalls).toEqual([initialRefreshToken]);
    expect(rotateCalls).toEqual([
      {
        service: 'trello',
        userId,
        credentialId,
        previousRefreshToken: initialRefreshToken,
        nextRefreshToken: 'new-refresh-token-after-initial-refresh-token',
      },
    ]);

    // Advance clock past expiration (3600s - 60s skew = 3540s)
    now += 3600_000;

    const secondAccess = await provider.getAccessToken();
    const expectedNextToken = 'new-refresh-token-after-initial-refresh-token';
    expect(secondAccess).toBe(`access-token-for-${expectedNextToken}`);
    expect(refreshCalls).toEqual([initialRefreshToken, expectedNextToken]);
    expect(rotateCalls[1]).toEqual({
      service: 'trello',
      userId,
      credentialId,
      previousRefreshToken: expectedNextToken,
      nextRefreshToken: `new-refresh-token-after-${expectedNextToken}`,
    });
  });

  it('handles rotatePersonalSecret mismatch by rejecting and blocking subsequent calls from using old token', async () => {
    rotateOutcome = 'mismatch';
    const manager = createManager();
    const provider = manager.forConnection(userId, credentialId, initialRefreshToken);

    await expect(provider.getAccessToken()).rejects.toSatisfy((err: any) => {
      expect(err).toBeInstanceOf(StepError);
      expect(err.category).toBe('AUTH_ERROR');
      expect(err.message).toBe('Trello cần được kết nối lại.');
      return true;
    });

    expect(reconnectCalls).toEqual([{ service: 'trello', userId, credentialId }]);
    expect(onReconnectCalls).toEqual([userId]);

    // Subsequent call must fail with AUTH_ERROR and not call refresh with old token
    refreshCalls = [];
    await expect(provider.getAccessToken()).rejects.toSatisfy((err: any) => {
      expect(err).toBeInstanceOf(StepError);
      expect(err.category).toBe('AUTH_ERROR');
      expect(err.message).toBe('Trello cần được kết nối lại.');
      return true;
    });
    expect(refreshCalls.length).toBe(0);
  });

  it('handles rotatePersonalSecret missing by rejecting with AUTH_ERROR', async () => {
    rotateOutcome = 'missing';
    const manager = createManager();
    const provider = manager.forConnection(userId, credentialId, initialRefreshToken);

    await expect(provider.getAccessToken()).rejects.toSatisfy((err: any) => {
      expect(err).toBeInstanceOf(StepError);
      expect(err.category).toBe('AUTH_ERROR');
      expect(err.message).toBe('Trello cần được kết nối lại.');
      return true;
    });
  });

  it('lets one caller abort without cancelling the shared refresh another caller waits on', async () => {
    const manager = createManager();
    mockClient.refresh.mockImplementationOnce(async (refreshToken: string) => {
      refreshCalls.push(refreshToken);
      await new Promise((r) => setTimeout(r, 100));
      return {
        accessToken: 'resilient-token',
        refreshToken: 'next-resilient-token',
        expiresInSeconds: 3600,
      };
    });

    const provider = manager.forConnection(userId, credentialId, initialRefreshToken);
    const controller = new AbortController();

    const callA = provider.getAccessToken({ signal: controller.signal });
    const callB = provider.getAccessToken();

    setTimeout(() => controller.abort(), 20);

    await expect(callA).rejects.toMatchObject({ category: 'NETWORK' });
    await expect(callB).resolves.toBe('resilient-token');
    expect(refreshCalls.length).toBe(1);
  });

  it('forces a fresh refresh after clear(userId)', async () => {
    const manager = createManager();
    const provider = manager.forConnection(userId, credentialId, initialRefreshToken);

    const first = await provider.getAccessToken();
    expect(refreshCalls.length).toBe(1);

    manager.clear(userId);

    // clear() forgets the user's secrets; callers hand in the stored token again.
    const second = await manager
      .forConnection(userId, credentialId, 'new-refresh-token-after-initial-refresh-token')
      .getAccessToken();
    expect(refreshCalls.length).toBe(2);
    expect(second).not.toBe(first);
  });

  it('handles TrelloOAuthError invalid_grant as AUTH_ERROR and marks reconnect required', async () => {
    mockClient.refresh.mockRejectedValueOnce(new TrelloOAuthError('invalid_grant', 400));
    const manager = createManager();
    const provider = manager.forConnection(userId, credentialId, initialRefreshToken);

    await expect(provider.getAccessToken()).rejects.toMatchObject({
      category: 'AUTH_ERROR',
      message: 'Trello cần được kết nối lại.',
    });
    expect(reconnectCalls).toEqual([{ service: 'trello', userId, credentialId }]);
  });

  it('preserves RATE_LIMIT when token refresh is throttled', async () => {
    mockClient.refresh.mockRejectedValueOnce(new TrelloOAuthError('rejected', 429));
    const manager = createManager();
    await expect(manager.forConnection(userId, credentialId, initialRefreshToken).getAccessToken()).rejects.toMatchObject({
      category: 'RATE_LIMIT',
      statusCode: 429,
      details: { requestSent: false },
    });
    expect(reconnectCalls).toEqual([]);
  });

  it('TrelloOAuthClient classifies Atlassian 403 refresh_token is invalid as invalid_grant', async () => {
    const client = new TrelloOAuthClient(
      {
        clientId: 'cid',
        clientSecret: 'csec',
        redirectUri: 'http://127.0.0.1/callback',
        authorizationUrl: 'http://127.0.0.1/auth',
        tokenUrl: 'http://127.0.0.1/oauth/token',
        apiBaseUrl: 'http://127.0.0.1/api',
      },
      (async () =>
        new Response(
          JSON.stringify({
            error: 'unauthorized_client',
            error_description: 'refresh_token is invalid',
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        )) as typeof fetch
    );

    await expect(client.refresh('expired-refresh-token', new AbortController().signal)).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(TrelloOAuthError);
      expect((err as TrelloOAuthError).kind).toBe('invalid_grant');
      expect((err as TrelloOAuthError).status).toBe(403);
      return true;
    });
  });

  it('rejects when refresh succeeds without returning a new refreshToken, marks reconnect required, and prevents subsequent calls from refreshing', async () => {
    mockClient.refresh.mockResolvedValueOnce({
      accessToken: 'access-token-without-refresh',
      expiresInSeconds: 3600,
    });
    const manager = createManager();
    const provider = manager.forConnection(userId, credentialId, initialRefreshToken);

    await expect(provider.getAccessToken()).rejects.toMatchObject({
      category: 'AUTH_ERROR',
      message: 'Trello cần được kết nối lại.',
    });

    expect(rotateCalls.length).toBe(0);
    expect(reconnectCalls).toEqual([{ service: 'trello', userId, credentialId }]);
    expect(onReconnectCalls).toEqual([userId]);

    refreshCalls = [];
    await expect(provider.getAccessToken()).rejects.toMatchObject({
      category: 'AUTH_ERROR',
      message: 'Trello cần được kết nối lại.',
    });
    expect(refreshCalls.length).toBe(0);
  });

  describe('real HTTP server and real CredentialRepo concurrency test', () => {
    const encryptionKey = '0123456789abcdef0123456789abcdef';
    let db: Awaited<ReturnType<typeof createMigratedSchema>>;

    beforeAll(async () => {
      db = await createMigratedSchema('trello_refresh_once');
    });

    afterAll(async () => {
      await db?.close();
    });

    it('holds initial refresh, calls clear(), requests token second time; provider only receives old token once', async () => {
      const credentials = new CredentialRepo(db.pool, encryptionKey);
      const user = await db.person('TestUser');
      const initialRefresh = 'initial-secret-refresh-token';

      const savedCred = await credentials.saveCredentials(
        'trello',
        encryptCredentials({ refreshToken: initialRefresh, username: 'test_trello' }, encryptionKey),
        user.id
      );

      let releaseFirstRefresh: () => void;
      const firstRefreshHold = new Promise<void>((resolve) => {
        releaseFirstRefresh = resolve;
      });

      const receivedRefreshTokens: string[] = [];
      let requestCount = 0;

      const server = createServer(async (req, res) => {
        if (req.method === 'POST' && req.url === '/oauth/token') {
          let bodyStr = '';
          req.on('data', (chunk) => {
            bodyStr += chunk;
          });
          req.on('end', async () => {
            requestCount++;
            const body = JSON.parse(bodyStr);
            receivedRefreshTokens.push(body.refresh_token);

            if (body.refresh_token === initialRefresh && requestCount === 1) {
              await firstRefreshHold;
            }

            if (receivedRefreshTokens.filter((t) => t === initialRefresh).length > 1) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'invalid_grant' }));
              return;
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                access_token: `access-token-step-${requestCount}`,
                refresh_token: `refreshed-token-step-${requestCount}`,
                expires_in: 3600,
                token_type: 'Bearer',
              })
            );
          });
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const port = (server.address() as any).port;
      const tokenUrl = `http://127.0.0.1:${port}/oauth/token`;

      try {
        const client = new TrelloOAuthClient({
          clientId: 'cid',
          clientSecret: 'csec',
          redirectUri: 'http://127.0.0.1/callback',
          authorizationUrl: 'http://127.0.0.1/auth',
          tokenUrl,
          apiBaseUrl: 'http://127.0.0.1/api',
        });

        const manager = new TrelloTokenManager({
          client,
          credentials,
          refreshTimeoutMs: 5000,
        });

        const provider = manager.forConnection(user.id, savedCred.id, initialRefresh);

        // 1. Start first token request (held by server)
        const firstPromise = provider.getAccessToken();

        // Give event loop a tick so request reaches server
        await new Promise((r) => setTimeout(r, 50));
        expect(receivedRefreshTokens).toEqual([initialRefresh]);

        // 2. Call clear() while first request is in flight
        manager.clear(user.id);

        // 3. Start second token request
        const secondPromise = provider.getAccessToken();

        // Give event loop a tick
        await new Promise((r) => setTimeout(r, 50));

        // Release first refresh response from HTTP server
        releaseFirstRefresh!();

        const [token1, token2] = await Promise.all([firstPromise, secondPromise]);
        expect(token1).toBe('access-token-step-1');
        expect(token2).toBe('access-token-step-1');

        // Crucial: Provider must only have used initialRefresh ONCE!
        expect(receivedRefreshTokens).toEqual([initialRefresh]);

        // Credential in DB is still active, not reconnect_required
        const credStatus = await credentials.getPersonalConnectionStatus('trello', user.id);
        expect(credStatus?.status).toBe('active');
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    });

    /** A token endpoint that, like Atlassian, accepts each refresh token once. */
    async function singleUseTokenServer() {
      const received: string[] = [];
      const used = new Set<string>();
      let hold: Promise<void> | null = null;
      let count = 0;
      const server = createServer((req, res) => {
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', async () => {
          const body = JSON.parse(raw);
          received.push(body.refresh_token);
          const step = ++count;
          if (hold) await hold;
          if (used.has(body.refresh_token)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'invalid_grant' }));
            return;
          }
          used.add(body.refresh_token);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ access_token: `access-${step}`, refresh_token: `refresh-${step}`, expires_in: 3600 }));
        });
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const port = (server.address() as any).port;
      const client = new TrelloOAuthClient({
        clientId: 'cid',
        clientSecret: 'csec',
        redirectUri: 'http://127.0.0.1/callback',
        authorizationUrl: 'http://127.0.0.1/auth',
        tokenUrl: `http://127.0.0.1:${port}/oauth/token`,
        apiBaseUrl: 'http://127.0.0.1/api',
      });
      return {
        client,
        received,
        holdNext() {
          let release!: () => void;
          hold = new Promise<void>((r) => (release = r));
          return () => {
            hold = null;
            release();
          };
        },
        close: () => new Promise((resolve) => server.close(resolve)),
      };
    }

    it('two processes refreshing the same credential use the single-use refresh token once and both get a token', async () => {
      const user = await db.person('Hai tiến trình');
      const initial = 'shared-initial-refresh';
      // Two managers with their own repo/pool view stand in for two chat-api instances.
      const repoA = new CredentialRepo(db.pool, encryptionKey);
      const repoB = new CredentialRepo(db.pool, encryptionKey);
      const saved = await repoA.saveCredentials(
        'trello',
        encryptCredentials({ refreshToken: initial, username: 'u' }, encryptionKey),
        user.id
      );
      const tokenServer = await singleUseTokenServer();
      try {
        const release = tokenServer.holdNext();
        const managerA = new TrelloTokenManager({ client: tokenServer.client, credentials: repoA, refreshTimeoutMs: 5000 });
        const managerB = new TrelloTokenManager({ client: tokenServer.client, credentials: repoB, refreshTimeoutMs: 5000 });
        const a = managerA.forConnection(user.id, saved.id, initial).getAccessToken();
        await new Promise((r) => setTimeout(r, 50));
        const b = managerB.forConnection(user.id, saved.id, initial).getAccessToken();
        await new Promise((r) => setTimeout(r, 100));
        release();
        const [tokenA, tokenB] = await Promise.all([a, b]);
        expect(tokenA).toBe('access-1');
        expect(tokenB).toBe('access-1');
        expect(tokenServer.received).toEqual([initial]);
        const row = await repoA.getPersonalConnectionStatus('trello', user.id);
        expect(row?.status).toBe('active');
        expect(decryptCredentials(row!.config, encryptionKey).refreshToken).toBe('refresh-1');
      } finally {
        await tokenServer.close();
      }
    });

    it.each(['statement', 'commit'] as const)('does not publish a rotation when PostgreSQL rejects the %s', async (failurePoint) => {
      const user = await db.person('Refresh storage fault');
      const repo = new CredentialRepo(db.pool, encryptionKey);
      const initial = 'initial-refresh';
      const saved = await repo.saveCredentials('trello', encryptCredentials({ refreshToken: initial }, encryptionKey), user.id);
      const refresh = vi.fn<TrelloOAuthClient['refresh']>()
        .mockResolvedValueOnce({ accessToken: 'fresh-access', refreshToken: 'fresh-refresh', expiresInSeconds: 3600 })
        .mockRejectedValueOnce(new TrelloOAuthError('invalid_grant', 400));
      const onReconnectRequired = vi.fn();
      const manager = new TrelloTokenManager({ client: { refresh }, credentials: repo, onReconnectRequired });
      const provider = manager.forConnection(user.id, saved.id, initial);

      await db.pool.query(`
        CREATE FUNCTION reject_trello_refresh() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'test rotation failure';
        END;
        $$;
      `);
      try {
        const trigger = failurePoint === 'statement' ? 'TRIGGER' : 'CONSTRAINT TRIGGER';
        const deferred = failurePoint === 'commit' ? 'DEFERRABLE INITIALLY DEFERRED' : '';
        await db.pool.query(`
          CREATE ${trigger} reject_trello_refresh
          AFTER UPDATE OF config ON service_credentials
          ${deferred}
          FOR EACH ROW EXECUTE FUNCTION reject_trello_refresh();
        `);

        await expect(provider.getAccessToken()).rejects.toMatchObject({
          category: 'NETWORK',
          details: { requestSent: false },
        });
        expect(onReconnectRequired).not.toHaveBeenCalled();
        const row = await repo.getPersonalConnectionStatus('trello', user.id);
        expect(row?.status).toBe('active');
        expect(decryptCredentials(row!.config, encryptionKey)).toEqual({ refreshToken: initial });

        // The provider consumed the old token before PostgreSQL rolled back the rotation.
        // The next call must use the stored token and surface the provider's definitive rejection.
        await expect(provider.getAccessToken()).rejects.toMatchObject({ category: 'AUTH_ERROR' });
        expect(refresh.mock.calls).toEqual([[initial, expect.any(AbortSignal)], [initial, expect.any(AbortSignal)]]);
        expect(onReconnectRequired).toHaveBeenCalledWith(user.id);
        expect((await repo.getPersonalConnectionStatus('trello', user.id))?.status).toBe('reconnect_required');
      } finally {
        await db.pool.query('DROP TRIGGER IF EXISTS reject_trello_refresh ON service_credentials');
        await db.pool.query('DROP FUNCTION reject_trello_refresh()');
      }
    });

    it('adopts the refresh token another process rotated instead of reusing its stale copy', async () => {
      const user = await db.person('Token cũ');
      const initial = 'stale-initial-refresh';
      const repo = new CredentialRepo(db.pool, encryptionKey);
      const saved = await repo.saveCredentials(
        'trello',
        encryptCredentials({ refreshToken: initial, username: 'u' }, encryptionKey),
        user.id
      );
      const tokenServer = await singleUseTokenServer();
      try {
        const managerA = new TrelloTokenManager({ client: tokenServer.client, credentials: repo, refreshTimeoutMs: 5000 });
        expect(await managerA.forConnection(user.id, saved.id, initial).getAccessToken()).toBe('access-1');
        // Process B still holds the stale initial token in memory and is forced to refresh.
        const managerB = new TrelloTokenManager({ client: tokenServer.client, credentials: repo, refreshTimeoutMs: 5000 });
        const providerB = managerB.forConnection(user.id, saved.id, initial);
        expect(await providerB.getAccessToken({ forceRefresh: true })).toBe('access-2');
        expect(tokenServer.received).toEqual([initial, 'refresh-1']);
        const row = await repo.getPersonalConnectionStatus('trello', user.id);
        expect(row?.status).toBe('active');
      } finally {
        await tokenServer.close();
      }
    });

    it('disconnect wins over a refresh another process is waiting to run', async () => {
      const user = await db.person('Ngắt kết nối');
      const initial = 'disconnect-initial-refresh';
      const repo = new CredentialRepo(db.pool, encryptionKey);
      const saved = await repo.saveCredentials(
        'trello',
        encryptCredentials({ refreshToken: initial, username: 'u' }, encryptionKey),
        user.id
      );
      const tokenServer = await singleUseTokenServer();
      try {
        const release = tokenServer.holdNext();
        const managerA = new TrelloTokenManager({ client: tokenServer.client, credentials: repo, refreshTimeoutMs: 5000 });
        const managerB = new TrelloTokenManager({ client: tokenServer.client, credentials: repo, refreshTimeoutMs: 5000 });
        const a = managerA.forConnection(user.id, saved.id, initial).getAccessToken();
        await new Promise((r) => setTimeout(r, 50));
        const b = managerB.forConnection(user.id, saved.id, initial).getAccessToken();
        await new Promise((r) => setTimeout(r, 50));
        await repo.deletePersonalCredentials('trello', user.id);
        release();
        const [ra, rb] = await Promise.allSettled([a, b]);
        expect(ra.status).toBe('rejected');
        expect((ra as PromiseRejectedResult).reason).toMatchObject({ category: 'AUTH_ERROR' });
        expect(rb.status).toBe('rejected');
        expect((rb as PromiseRejectedResult).reason).toMatchObject({ category: 'AUTH_ERROR' });
        // B never sent the refresh token: it saw the disconnect under the lock.
        expect(tokenServer.received).toEqual([initial]);
        expect(await repo.getPersonalConnectionStatus('trello', user.id)).toBeNull();
      } finally {
        await tokenServer.close();
      }
    });
  });

  it('clear(userId) drops the cached refresh tokens of that user', async () => {
    const manager = createManager();
    manager.forConnection(userId, credentialId, initialRefreshToken);
    manager.forConnection('other-user', 'cred-2', 'other-refresh');
    manager.clear(userId);
    const kept = [...((manager as any).refreshTokens as Map<string, string>).keys()];
    expect(kept).toEqual(['other-user:cred-2']);
  });
});
