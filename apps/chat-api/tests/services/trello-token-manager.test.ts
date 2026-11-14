import { randomUUID } from 'node:crypto';
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

    it('coordinates concurrent multi-instance refresh, reuses cached accessToken, rotates refreshToken on expiry, and enforces Disconnect-Wins and fail-closed fences', async () => {
      let currentNow = 1_700_000_000_000;
      const clock = () => currentNow;
      let serverBehavior: 'normal' | 'http500' | 'hang' | 'disconnect_midflight' = 'normal';
      let onHeldRequestReached: (() => void) | null = null;
      let releaseHeldRequest: (() => void) | null = null;
      const seenRefreshTokens: string[] = [];
      let stepCounter = 0;

      const server = createServer(async (req, res) => {
        if (req.method === 'POST' && req.url === '/oauth/token') {
          let bodyStr = '';
          req.on('data', (chunk) => {
            bodyStr += chunk;
          });
          req.on('end', async () => {
            stepCounter++;
            const body = JSON.parse(bodyStr);
            seenRefreshTokens.push(body.refresh_token);

            if (serverBehavior === 'http500') {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'internal_error' }));
              return;
            }
            if (serverBehavior === 'hang') {
              // Hold longer than refreshTimeoutMs until aborted.
              await new Promise<void>((resolve) => {
                const timer = setTimeout(resolve, 2000);
                req.on('close', () => {
                  clearTimeout(timer);
                  resolve();
                });
              });
              return;
            }
            if (serverBehavior === 'disconnect_midflight') {
              onHeldRequestReached?.();
              await new Promise<void>((resolve) => {
                releaseHeldRequest = resolve;
              });
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                access_token: `access-step-${stepCounter}`,
                refresh_token: `rotated-rt-${stepCounter}`,
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
      const oauthClient = new TrelloOAuthClient({
        clientId: 'cid',
        clientSecret: 'csec',
        redirectUri: 'http://127.0.0.1/callback',
        authorizationUrl: 'http://127.0.0.1/auth',
        tokenUrl: `http://127.0.0.1:${port}/oauth/token`,
        apiBaseUrl: 'http://127.0.0.1/api',
      });

      try {
        // 1. Two separate TrelloTokenManager instances race concurrently -> single HTTP refresh, both get access-step-1.
        const credentialsA = new CredentialRepo(db.pool, encryptionKey);
        const credentialsB = new CredentialRepo(db.pool, encryptionKey);
        const user1 = await db.person('MultiProcRace');
        const initialRt = 'rt-initial-0';
        const row1 = await credentialsA.saveCredentials(
          'trello',
          encryptCredentials({ refreshToken: initialRt, username: 'multi_race' }, encryptionKey),
          user1.id
        );

        const mgrA = new TrelloTokenManager({ client: oauthClient, credentials: credentialsA, clock, refreshTimeoutMs: 2000 });
        const mgrB = new TrelloTokenManager({ client: oauthClient, credentials: credentialsB, clock, refreshTimeoutMs: 2000 });

        const [tokA, tokB] = await Promise.all([
          mgrA.forConnection(user1.id, row1.id, initialRt).getAccessToken(),
          mgrB.forConnection(user1.id, row1.id, initialRt).getAccessToken(),
        ]);
        expect(tokA).toBe('access-step-1');
        expect(tokB).toBe('access-step-1');
        expect(seenRefreshTokens).toEqual([initialRt]);

        const afterFirst = await credentialsA.getPersonalConnectionStatus('trello', user1.id);
        expect(afterFirst?.token_version).toBe(2);
        expect(afterFirst?.refresh_state).toBe('idle');

        // 2. Third fresh instance reads unexpired persisted accessToken from PostgreSQL with ZERO HTTP calls.
        const credentialsC = new CredentialRepo(db.pool, encryptionKey);
        const mgrC = new TrelloTokenManager({ client: oauthClient, credentials: credentialsC, clock, refreshTimeoutMs: 2000 });
        const tokC = await mgrC.forConnection(user1.id, row1.id, initialRt).getAccessToken();
        expect(tokC).toBe('access-step-1');
        expect(seenRefreshTokens).toEqual([initialRt]);

        // 3. Advance clock past 3600s expiry -> post-expiry refresh uses DB-rotated refresh token, even if stale initialRt was passed.
        currentNow += 3600_000;
        const tok2 = await mgrC.forConnection(user1.id, row1.id, initialRt).getAccessToken();
        expect(tok2).toBe('access-step-2');
        expect(seenRefreshTokens).toEqual([initialRt, 'rotated-rt-1']);
        const afterSecond = await credentialsC.getPersonalConnectionStatus('trello', user1.id);
        expect(afterSecond?.token_version).toBe(3);

        // 4. Orphaned 'refreshing' lease past refreshTimeoutMs -> fail closed (CRASH_UNKNOWN_ROTATION), scrub tokens, 0 HTTP calls.
        const user2 = await db.person('OrphanedLease');
        const row2 = await credentialsA.saveCredentials(
          'trello',
          encryptCredentials({ refreshToken: 'rt-crashed', username: 'crashed_user' }, encryptionKey),
          user2.id
        );
        await db.pool.query(
          `UPDATE service_credentials
           SET refresh_state = 'refreshing',
               refresh_attempt_id = $2,
               refresh_started_at = clock_timestamp() - interval '20 seconds'
           WHERE id = $1`,
          [row2.id, randomUUID()]
        );
        const orphanReconnects: string[] = [];
        const mgrOrphan = new TrelloTokenManager({
          client: oauthClient,
          credentials: credentialsA,
          clock,
          refreshTimeoutMs: 2000,
          onReconnectRequired: (uid) => orphanReconnects.push(uid),
        });
        const httpCountBeforeOrphan = seenRefreshTokens.length;
        await expect(mgrOrphan.forConnection(user2.id, row2.id, 'rt-crashed').getAccessToken()).rejects.toMatchObject({
          category: 'AUTH_ERROR',
        });
        expect(seenRefreshTokens.length).toBe(httpCountBeforeOrphan);
        expect(orphanReconnects).toEqual([user2.id]);
        const orphanRow = await credentialsA.getPersonalConnectionStatus('trello', user2.id);
        expect(orphanRow?.status).toBe('reconnect_required');
        expect(orphanRow?.status_reason).toBe('CRASH_UNKNOWN_ROTATION');
        expect(orphanRow?.refresh_state).toBe('idle');
        expect(orphanRow?.refresh_attempt_id).toBeNull();
        expect(decryptCredentials<Record<string, any>>(orphanRow!.config, encryptionKey).refreshToken).toBeUndefined();

        // 5. Disconnect-Wins while HTTP refresh is in-flight -> old caller gets AUTH_ERROR, refreshed token discarded, onReconnectRequired NOT fired.
        const user3 = await db.person('DisconnectWins');
        const row3 = await credentialsA.saveCredentials(
          'trello',
          encryptCredentials({ refreshToken: 'rt-dw', username: 'dw_user' }, encryptionKey),
          user3.id
        );
        const dwReconnects: string[] = [];
        const mgrDw = new TrelloTokenManager({
          client: oauthClient,
          credentials: credentialsA,
          clock,
          refreshTimeoutMs: 2000,
          onReconnectRequired: (uid) => dwReconnects.push(uid),
        });
        serverBehavior = 'disconnect_midflight';
        const heldReached = new Promise<void>((resolve) => {
          onHeldRequestReached = resolve;
        });
        const dwPromise = mgrDw.forConnection(user3.id, row3.id, 'rt-dw').getAccessToken();
        await heldReached;
        await credentialsA.deletePersonalCredentials('trello', user3.id);
        releaseHeldRequest!();
        await expect(dwPromise).rejects.toMatchObject({ category: 'AUTH_ERROR' });
        expect(dwReconnects).toEqual([]);
        expect(await credentialsA.getPersonalConnectionStatus('trello', user3.id)).toBeNull();

        // 6a. Post-dispatch HTTP 500 -> fails closed with CRASH_UNKNOWN_ROTATION and never gets stuck 'refreshing'.
        serverBehavior = 'http500';
        const user4 = await db.person('PostDispatch500');
        const row4 = await credentialsA.saveCredentials(
          'trello',
          encryptCredentials({ refreshToken: 'rt-500', username: 'u500' }, encryptionKey),
          user4.id
        );
        const reconnect500: string[] = [];
        const mgr500 = new TrelloTokenManager({
          client: oauthClient,
          credentials: credentialsA,
          clock,
          refreshTimeoutMs: 500,
          onReconnectRequired: (uid) => reconnect500.push(uid),
        });
        await expect(mgr500.forConnection(user4.id, row4.id, 'rt-500').getAccessToken()).rejects.toMatchObject({
          category: 'AUTH_ERROR',
        });
        expect(reconnect500).toEqual([user4.id]);
        const row4After = await credentialsA.getPersonalConnectionStatus('trello', user4.id);
        expect(row4After?.status).toBe('reconnect_required');
        expect(row4After?.status_reason).toBe('CRASH_UNKNOWN_ROTATION');
        expect(row4After?.refresh_state).toBe('idle');

        // 6b. Real AbortSignal timeout -> fails closed with REFRESH_TIMEOUT, never replays consumed token.
        serverBehavior = 'hang';
        const user5 = await db.person('PostDispatchTimeout');
        const row5 = await credentialsA.saveCredentials(
          'trello',
          encryptCredentials({ refreshToken: 'rt-timeout', username: 'utimeout' }, encryptionKey),
          user5.id
        );
        const reconnectTimeout: string[] = [];
        const mgrTimeout = new TrelloTokenManager({
          client: oauthClient,
          credentials: credentialsA,
          clock,
          refreshTimeoutMs: 120,
          onReconnectRequired: (uid) => reconnectTimeout.push(uid),
        });
        await expect(mgrTimeout.forConnection(user5.id, row5.id, 'rt-timeout').getAccessToken()).rejects.toMatchObject({
          category: 'AUTH_ERROR',
        });
        expect(reconnectTimeout).toEqual([user5.id]);
        const row5After = await credentialsA.getPersonalConnectionStatus('trello', user5.id);
        expect(row5After?.status).toBe('reconnect_required');
        expect(row5After?.status_reason).toBe('REFRESH_TIMEOUT');
        expect(row5After?.refresh_state).toBe('idle');
        expect(decryptCredentials<Record<string, any>>(row5After!.config, encryptionKey).refreshToken).toBeUndefined();
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    });
  });
});
