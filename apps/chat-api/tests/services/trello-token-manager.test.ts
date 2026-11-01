import { createServer } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptCredentials, StepError } from '@wap/tool-adapters';
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

    const second = await provider.getAccessToken();
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

    it('holds initial refresh, calls clear(), requests token second time; provider only receives old token once', async () => {
      const db = await createMigratedSchema('trello_refresh_once');
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
        await db.close();
      }
    });
  });
});
