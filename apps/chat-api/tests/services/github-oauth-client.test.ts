import { describe, expect, it, vi } from 'vitest';
import {
  GITHUB_OAUTH_DEFAULT_SCOPE,
  GitHubOAuthClient,
  GitHubOAuthError,
} from '../../src/services/github/oauth-client.js';

const config = {
  clientId: 'github-client-id',
  clientSecret: 'github-client-secret-top-secret',
  redirectUri: 'https://ati.example/connections/github/callback',
  authorizationUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  apiBaseUrl: 'https://api.github.com',
  scope: GITHUB_OAUTH_DEFAULT_SCOPE,
};

describe('GitHubOAuthClient', () => {
  it('builds authorizationUrl with PKCE S256, state, client_id, redirect_uri, and scope', () => {
    const client = new GitHubOAuthClient(config);
    const urlStr = client.authorizationUrl({
      state: 'state-123',
      codeChallenge: 'challenge-abc',
    });
    const url = new URL(urlStr);
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('github-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe('https://ati.example/connections/github/callback');
    expect(url.searchParams.get('state')).toBe('state-123');
    expect(url.searchParams.get('code_challenge')).toBe('challenge-abc');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe('repo read:user');
  });

  it('exchanges code with Accept: application/json and handles both expiring and non-expiring tokens', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'gho_non_expiring_token',
          token_type: 'bearer',
          scope: 'repo,read:user',
        }),
        { status: 200 }
      )
    ).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'ghu_expiring_token',
          refresh_token: 'ghr_refresh_token',
          expires_in: 28800,
        }),
        { status: 200 }
      )
    );

    const client = new GitHubOAuthClient(config, fetchFn as any);
    const nonExpiring = await client.exchangeCode('code-1', 'verifier-1', new AbortController().signal);
    expect(nonExpiring).toEqual({
      accessToken: 'gho_non_expiring_token',
      refreshToken: undefined,
      expiresInSeconds: undefined,
    });
    const [, init] = fetchFn.mock.calls[0]!;
    expect(init.headers).toMatchObject({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });

    const expiring = await client.exchangeCode('code-2', 'verifier-2', new AbortController().signal);
    expect(expiring).toEqual({
      accessToken: 'ghu_expiring_token',
      refreshToken: 'ghr_refresh_token',
      expiresInSeconds: 28800,
    });
  });

  it('classifies HTTP 200 { error: "bad_verification_code" } or { error: "bad_refresh_token" } as invalid_grant without leaking secrets', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: 'bad_verification_code',
          error_description: 'The code passed is incorrect or expired: secret-code-999',
        }),
        { status: 200 }
      )
    );

    const client = new GitHubOAuthClient(config, fetchFn as any);
    await expect(
      client.exchangeCode('secret-code-999', 'verifier-secret', new AbortController().signal)
    ).rejects.toSatisfy((err: any) => {
      expect(err).toBeInstanceOf(GitHubOAuthError);
      expect(err.kind).toBe('invalid_grant');
      expect(err.message).not.toContain('secret-code-999');
      expect(err.message).not.toContain('github-client-secret-top-secret');
      return true;
    });
  });

  it('fetches authenticated user and candidate repositories with GitHub API headers and filters invalid full_name', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 42, login: 'octocat' }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { id: 101, name: 'ati', full_name: 'nhom/ati', private: true },
            { id: 102, name: 'bad', full_name: '../escape', private: false },
            { id: 103, name: 'web', full_name: 'nhom/web', private: false },
          ]),
          { status: 200 }
        )
      );

    const client = new GitHubOAuthClient(config, fetchFn as any);
    const user = await client.user('gho_token', new AbortController().signal);
    expect(user).toEqual({ id: '42', login: 'octocat' });

    const repos = await client.repos('gho_token', new AbortController().signal);
    expect(repos).toEqual([
      { id: '101', name: 'ati', fullName: 'nhom/ati', private: true },
      { id: '103', name: 'web', fullName: 'nhom/web', private: false },
    ]);
  });

  it('does not call fetch when AbortSignal is already aborted', async () => {
    const fetchFn = vi.fn();
    const client = new GitHubOAuthClient(config, fetchFn as any);
    const controller = new AbortController();
    controller.abort();
    await expect(client.user('gho_token', controller.signal)).rejects.toMatchObject({ kind: 'network' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
