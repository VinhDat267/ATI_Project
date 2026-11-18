import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { decryptCredentials, encryptCredentials, StepError } from '@wap/tool-adapters';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { GitHubOAuthClient, GitHubOAuthError } from '../../src/services/github/oauth-client.js';
import { GitHubTokenManager } from '../../src/services/github/token-manager.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

describe('GitHubTokenManager cross-process locking & resilience (Task 5)', () => {
  const encryptionKey = '0123456789abcdef0123456789abcdef';
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;

  beforeAll(async () => {
    db = await createMigratedSchema('github_token_lock');
  });

  afterAll(async () => {
    await db?.close();
  });

  it('serializes concurrent expiring-token refresh across two independent GitHubTokenManager instances via withPersonalSecretLock', async () => {
    const credentials = new CredentialRepo(db.pool, encryptionKey);
    const user = await db.person('GitHub Lock User');
    const initialRefresh = 'ghr_single_use_initial';
    const initialAccess = 'ghu_expired_access';

    const saved = await credentials.saveCredentials(
      'github',
      encryptCredentials(
        {
          accessToken: initialAccess,
          refreshToken: initialRefresh,
          accessTokenExpiresAt: 500, // already expired relative to clock()
          githubUserId: '1001',
          login: 'octo-lock',
        },
        encryptionKey,
      ),
      user.id,
    );

    const seenRefreshTokens: string[] = [];
    let releaseFirst!: () => void;
    const firstHold = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const server = createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/login/oauth/access_token') {
        let raw = '';
        req.on('data', (chunk) => {
          raw += chunk;
        });
        req.on('end', async () => {
          const parsed = JSON.parse(raw);
          const rt = String(parsed.refresh_token || '');
          seenRefreshTokens.push(rt);
          if (seenRefreshTokens.length === 1) {
            await firstHold;
          }
          if (seenRefreshTokens.filter((t) => t === initialRefresh).length > 1) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'invalid_grant' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              access_token: 'ghu_rotated_once',
              refresh_token: 'ghr_rotated_once',
              expires_in: 3600,
              token_type: 'bearer',
            }),
          );
        });
      } else {
        res.writeHead(404).end();
      }
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as any).port;

    try {
      const client = new GitHubOAuthClient({
        clientId: 'cid',
        clientSecret: 'csec',
        redirectUri: 'http://127.0.0.1/callback',
        authorizationUrl: 'http://127.0.0.1/auth',
        tokenUrl: `http://127.0.0.1:${port}/login/oauth/access_token`,
        apiBaseUrl: 'http://127.0.0.1/api',
        scope: 'repo read:user',
      });

      const now = 1_000_000;
      // Simulate two separate server processes sharing PostgreSQL CredentialRepo
      const managerA = new GitHubTokenManager({
        client,
        credentials,
        clock: () => now,
        refreshTimeoutMs: 5_000,
      });
      const managerB = new GitHubTokenManager({
        client,
        credentials,
        clock: () => now,
        refreshTimeoutMs: 5_000,
      });

      const pA = managerA
        .forConnection(user.id, saved.id, { accessToken: initialAccess, refreshToken: initialRefresh })
        .getAccessToken();

      await new Promise((r) => setTimeout(r, 40));
      expect(seenRefreshTokens).toEqual([initialRefresh]);

      const pB = managerB
        .forConnection(user.id, saved.id, { accessToken: initialAccess, refreshToken: initialRefresh })
        .getAccessToken();

      await new Promise((r) => setTimeout(r, 40));
      releaseFirst();

      const [tokA, tokB] = await Promise.all([pA, pB]);
      expect(tokA).toBe('ghu_rotated_once');
      expect(tokB).toBe('ghu_rotated_once');
      // Second instance must adopt the rotated token stored under PostgreSQL advisory lock, never re-sending initialRefresh
      expect(seenRefreshTokens).toEqual([initialRefresh]);

      const stored = await credentials.getPersonalConnectionStatus('github', user.id);
      expect(stored?.status).toBe('active');
      const dec = decryptCredentials(stored!.config, encryptionKey);
      expect(dec.refreshToken).toBe('ghr_rotated_once');
      expect(dec.accessToken).toBe('ghu_rotated_once');
      expect(typeof dec.accessTokenExpiresAt).toBe('number');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('maps 429 rate-limit to RATE_LIMIT without wiping grant, and keeps grant intact when DB lock throws transiently', async () => {
    const refresh = vi
      .fn()
      .mockRejectedValueOnce(new GitHubOAuthError('rejected', 429))
      .mockResolvedValueOnce({
        accessToken: 'ghu_recovered',
        refreshToken: 'ghr_recovered',
        expiresInSeconds: 3600,
      });
    const markReconnectRequired = vi.fn().mockResolvedValue(true);
    const rotatePersonalSecret = vi.fn().mockResolvedValue('rotated');

    const withPersonalSecretLock = vi
      .fn()
      .mockImplementationOnce(async (_opts, fn) =>
        fn({
          read: async () => ({ status: 'active', refreshToken: 'ghr_1' }),
          rotate: async () => 'rotated' as const,
          markReconnectRequired: async () => true,
        }),
      )
      .mockRejectedValueOnce(new Error('connection terminated unexpectedly'))
      .mockImplementationOnce(async (_opts, fn) =>
        fn({
          read: async () => ({ status: 'active', refreshToken: 'ghr_1' }),
          rotate: async () => 'rotated' as const,
          markReconnectRequired: async () => true,
        }),
      );

    const manager = new GitHubTokenManager({
      client: { refresh },
      credentials: { rotatePersonalSecret, markReconnectRequired, withPersonalSecretLock },
    });

    const provider = manager.forConnection('u-rl', 'cred-rl', { refreshToken: 'ghr_1' });

    // 1. 429 -> RATE_LIMIT with requestSent: false, no markReconnectRequired
    await expect(provider.getAccessToken()).rejects.toSatisfy((err: any) => {
      expect(err).toBeInstanceOf(StepError);
      expect(err.category).toBe('RATE_LIMIT');
      expect(err.statusCode).toBe(429);
      expect(err.details).toEqual({ requestSent: false });
      return true;
    });
    expect(markReconnectRequired).not.toHaveBeenCalled();

    // 2. Transient DB lock failure -> NETWORK with requestSent: false, does not revoke connection
    await expect(provider.getAccessToken()).rejects.toMatchObject({
      category: 'NETWORK',
      details: { requestSent: false },
    });
    expect(markReconnectRequired).not.toHaveBeenCalled();

    // 3. Subsequent retry succeeds cleanly
    await expect(provider.getAccessToken()).resolves.toBe('ghu_recovered');
  });

  it('runs a forced refresh instead of returning an in-flight non-forced DB token result when forceRefresh=true arrives concurrently', async () => {
    const refresh = vi.fn().mockResolvedValue({
      accessToken: 'ghu_forced_fresh',
      refreshToken: 'ghr_forced_fresh',
      expiresInSeconds: 3600,
    });
    const markReconnectRequired = vi.fn().mockResolvedValue(true);
    const rotatePersonalSecret = vi.fn().mockResolvedValue('rotated');

    let signalFirstLockEntered!: () => void;
    const firstLockEntered = new Promise<void>((resolve) => {
      signalFirstLockEntered = resolve;
    });
    let releaseFirstLock!: () => void;
    const holdFirstLock = new Promise<void>((resolve) => {
      releaseFirstLock = resolve;
    });

    const now = 1_000_000;
    let lockCall = 0;
    const withPersonalSecretLock = vi.fn().mockImplementation(async (_opts, fn) => {
      lockCall += 1;
      if (lockCall === 1) {
        signalFirstLockEntered();
        await holdFirstLock;
      }
      return fn({
        read: async () => ({
          status: 'active',
          accessToken: 'ghu_stale_but_unexpired_in_db',
          accessTokenExpiresAt: now + 3_600_000,
          refreshToken: 'ghr_valid',
        }),
        rotate: async () => 'rotated' as const,
        markReconnectRequired: async () => true,
      });
    });

    const manager = new GitHubTokenManager({
      client: { refresh },
      credentials: { rotatePersonalSecret, markReconnectRequired, withPersonalSecretLock },
      clock: () => now,
    });

    const provider = manager.forConnection('u-force', 'cred-force', { refreshToken: 'ghr_valid' });

    const nonForcedPromise = provider.getAccessToken();
    await firstLockEntered;

    const forcedPromise = provider.getAccessToken({ forceRefresh: true });
    releaseFirstLock();

    const [nonForcedToken, forcedToken] = await Promise.all([nonForcedPromise, forcedPromise]);
    expect(nonForcedToken).toBe('ghu_stale_but_unexpired_in_db');
    expect(forcedToken).toBe('ghu_forced_fresh');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith('ghr_valid', expect.any(AbortSignal));
  });
});
