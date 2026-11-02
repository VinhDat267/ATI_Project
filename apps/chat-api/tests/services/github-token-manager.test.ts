import { describe, expect, it, vi } from 'vitest';
import { GitHubOAuthError } from '../../src/services/github/oauth-client.js';
import { GitHubTokenManager } from '../../src/services/github/token-manager.js';

describe('GitHubTokenManager', () => {
  it('returns stored accessToken directly for non-expiring OAuth tokens without calling refresh', async () => {
    const refresh = vi.fn();
    const rotatePersonalSecret = vi.fn();
    const markReconnectRequired = vi.fn();

    const manager = new GitHubTokenManager({
      client: { refresh },
      credentials: { rotatePersonalSecret, markReconnectRequired },
    });

    const provider = manager.forConnection('user-1', 'cred-1', {
      accessToken: 'gho_static_token',
    });

    const token = await provider.getAccessToken();
    expect(token).toBe('gho_static_token');
    expect(refresh).not.toHaveBeenCalled();

    // If forceRefresh is called on a non-expiring token (e.g. after 401 from GitHub API), marks reconnect_required
    await expect(provider.getAccessToken({ forceRefresh: true })).rejects.toMatchObject({
      category: 'AUTH_ERROR',
      message: 'GitHub cần được kết nối lại.',
    });
    expect(markReconnectRequired).toHaveBeenCalledWith('github', 'user-1', 'cred-1');
  });

  it('refreshes and rotates expiring tokens once under concurrent getAccessToken calls', async () => {
    let now = 1_000_000;
    const refresh = vi.fn().mockResolvedValue({
      accessToken: 'ghu_fresh_access',
      refreshToken: 'ghr_fresh_refresh',
      expiresInSeconds: 28800,
    });
    const rotatePersonalSecret = vi.fn().mockResolvedValue('rotated');
    const markReconnectRequired = vi.fn();

    const manager = new GitHubTokenManager({
      client: { refresh },
      credentials: { rotatePersonalSecret, markReconnectRequired },
      clock: () => now,
    });

    const provider = manager.forConnection('user-1', 'cred-1', {
      refreshToken: 'ghr_initial_refresh',
    });

    const [t1, t2] = await Promise.all([
      provider.getAccessToken(),
      provider.getAccessToken(),
    ]);

    expect(t1).toBe('ghu_fresh_access');
    expect(t2).toBe('ghu_fresh_access');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(rotatePersonalSecret).toHaveBeenCalledWith({
      service: 'github',
      userId: 'user-1',
      credentialId: 'cred-1',
      previousRefreshToken: 'ghr_initial_refresh',
      nextRefreshToken: 'ghr_fresh_refresh',
      nextAccessToken: 'ghu_fresh_access',
    });
  });

  it('marks reconnect_required and throws StepError AUTH_ERROR on invalid_grant', async () => {
    const refresh = vi.fn().mockRejectedValue(new GitHubOAuthError('invalid_grant', 200));
    const rotatePersonalSecret = vi.fn();
    const markReconnectRequired = vi.fn().mockResolvedValue(true);

    const manager = new GitHubTokenManager({
      client: { refresh },
      credentials: { rotatePersonalSecret, markReconnectRequired },
    });

    const provider = manager.forConnection('user-1', 'cred-1', {
      refreshToken: 'ghr_revoked',
    });

    await expect(provider.getAccessToken()).rejects.toMatchObject({
      category: 'AUTH_ERROR',
      message: 'GitHub cần được kết nối lại.',
    });
    expect(markReconnectRequired).toHaveBeenCalledWith('github', 'user-1', 'cred-1');
  });
});
