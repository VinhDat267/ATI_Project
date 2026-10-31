import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StepError } from '@wap/tool-adapters';
import { TrelloTokenManager } from '../../src/services/trello/token-manager.js';
import { TrelloOAuthError } from '../../src/services/trello/oauth-client.js';

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
});
