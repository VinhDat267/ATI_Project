import { describe, expect, it, vi } from 'vitest';
import {
  TrelloOAuthClient,
  TrelloOAuthError,
  TRELLO_OAUTH_SCOPE,
} from '../../src/services/trello/oauth-client.js';

const config = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  redirectUri: 'http://127.0.0.1:5174/connections/trello/callback',
  authorizationUrl: 'https://auth.atlassian.com/authorize',
  tokenUrl: 'https://auth.atlassian.com/oauth/token',
  apiBaseUrl: 'https://api.trello.com/1',
};

describe('TrelloOAuthClient', () => {
  it('builds authorizationUrl with PKCE S256, required params, exact scope, and no audience', () => {
    const client = new TrelloOAuthClient(config);
    const urlString = client.authorizationUrl({ state: 'state-123', codeChallenge: 'challenge-xyz' });
    const url = new URL(urlString);

    expect(url.origin + url.pathname).toBe('https://auth.atlassian.com/authorize');
    expect(url.searchParams.get('client_id')).toBe('test-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:5174/connections/trello/callback');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('state')).toBe('state-123');
    expect(url.searchParams.get('code_challenge')).toBe('challenge-xyz');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe('read:board:trello write:board:trello read:member:trello offline_access');
    expect(TRELLO_OAUTH_SCOPE).toBe('read:board:trello write:board:trello read:member:trello offline_access');
    expect(url.searchParams.has('audience')).toBe(false);
  });

  it('exchanges authorization code with PKCE verifier to tokenUrl', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;

    const mockFetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(JSON.stringify({
        access_token: 'acc-token-123',
        refresh_token: 'ref-token-456',
        expires_in: 3600,
        token_type: 'Bearer',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    const client = new TrelloOAuthClient(config, mockFetch as any);
    const result = await client.exchangeCode('auth-code-789', 'code-verifier-abc', new AbortController().signal);

    expect(capturedUrl).toBe(config.tokenUrl);
    expect(capturedInit?.method).toBe('POST');
    const body = JSON.parse(String(capturedInit?.body));
    expect(body).toEqual({
      grant_type: 'authorization_code',
      client_id: 'test-client-id',
      client_secret: 'test-client-secret',
      code: 'auth-code-789',
      redirect_uri: 'http://127.0.0.1:5174/connections/trello/callback',
      code_verifier: 'code-verifier-abc',
    });
    expect(result).toEqual({
      accessToken: 'acc-token-123',
      refreshToken: 'ref-token-456',
      expiresInSeconds: 3600,
    });
  });

  it('refreshes token using grant_type=refresh_token to tokenUrl', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;

    const mockFetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(JSON.stringify({
        access_token: 'acc-token-new',
        refresh_token: 'ref-token-new',
        expires_in: 3600,
        token_type: 'Bearer',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    const client = new TrelloOAuthClient(config, mockFetch as any);
    const result = await client.refresh('old-ref-token', new AbortController().signal);

    expect(capturedUrl).toBe(config.tokenUrl);
    expect(capturedInit?.method).toBe('POST');
    const body = JSON.parse(String(capturedInit?.body));
    expect(body).toEqual({
      grant_type: 'refresh_token',
      client_id: 'test-client-id',
      client_secret: 'test-client-secret',
      refresh_token: 'old-ref-token',
    });
    expect(result).toEqual({
      accessToken: 'acc-token-new',
      refreshToken: 'ref-token-new',
      expiresInSeconds: 3600,
    });
  });

  it('fetches member profile returning id and username', async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      expect(url).toContain('/members/me');
      expect((init.headers as any)?.Authorization).toBe('Bearer token-xyz');
      return new Response(JSON.stringify({
        id: 'member-001',
        username: 'user_trello',
        fullName: 'User Trello',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    const client = new TrelloOAuthClient(config, mockFetch as any);
    const member = await client.member('token-xyz', new AbortController().signal);
    expect(member).toEqual({ id: 'member-001', username: 'user_trello' });
  });

  it('fetches workspaces returning id and name', async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      expect(url).toContain('/members/me/organizations');
      expect((init.headers as any)?.Authorization).toBe('Bearer token-xyz');
      return new Response(JSON.stringify([
        { id: 'org-1', displayName: 'Workspace One' },
        { id: 'org-2', name: 'workspace_two' },
      ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    const client = new TrelloOAuthClient(config, mockFetch as any);
    const workspaces = await client.workspaces('token-xyz', new AbortController().signal);
    expect(workspaces).toEqual([
      { id: 'org-1', name: 'Workspace One' },
      { id: 'org-2', name: 'workspace_two' },
    ]);
  });

  it('fetches boards and discards boards with idOrganization not equal to target workspaceId', async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      expect(url).toContain('/members/me/boards');
      expect((init.headers as any)?.Authorization).toBe('Bearer token-xyz');
      return new Response(JSON.stringify([
        { id: 'board-1', name: 'Board One', idOrganization: 'ws-target', member: true },
        { id: 'board-2', name: 'Board Two', idOrganization: 'ws-other', member: true },
        { id: 'board-3', name: 'Board Three', idOrganization: 'ws-target', member: false },
        { id: 'board-4', name: 'Personal Board', idOrganization: null, member: true },
      ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    const client = new TrelloOAuthClient(config, mockFetch as any);
    const boards = await client.boards('token-xyz', 'ws-target', new AbortController().signal);

    expect(boards).toEqual([
      { id: 'board-1', name: 'Board One', workspaceId: 'ws-target', member: true },
      { id: 'board-3', name: 'Board Three', workspaceId: 'ws-target', member: false },
    ]);
  });

  it('does not leak access tokens, refresh tokens or authorization codes in TrelloOAuthError messages', async () => {
    const secretCode = 'super_secret_auth_code_123';
    const secretToken = 'super_secret_refresh_token_456';
    const secretAccessToken = 'super_secret_access_token_789';

    const mockFetch400 = vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify({
        error: 'invalid_grant',
        error_description: `Token ${secretToken} was revoked with code ${secretCode}`,
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    });

    const client400 = new TrelloOAuthClient(config, mockFetch400 as any);

    try {
      await client400.exchangeCode(secretCode, 'verifier', new AbortController().signal);
      expect.unreachable('Should have thrown TrelloOAuthError');
    } catch (err: any) {
      expect(err).toBeInstanceOf(TrelloOAuthError);
      expect(err.kind).toBe('invalid_grant');
      expect(err.message).not.toContain(secretCode);
      expect(err.message).not.toContain(secretToken);
      expect(err.message).not.toContain(secretAccessToken);
    }

    const mockFetch500 = vi.fn().mockImplementation(async () => {
      return new Response(`Server error exposing ${secretAccessToken}`, { status: 500 });
    });

    const client500 = new TrelloOAuthClient(config, mockFetch500 as any);

    try {
      await client500.refresh(secretToken, new AbortController().signal);
      expect.unreachable('Should have thrown TrelloOAuthError');
    } catch (err: any) {
      expect(err).toBeInstanceOf(TrelloOAuthError);
      expect(err.kind).toBe('server');
      expect(err.message).not.toContain(secretCode);
      expect(err.message).not.toContain(secretToken);
      expect(err.message).not.toContain(secretAccessToken);
    }
  });

  it('rejects with kind network without calling fetch when signal is already aborted', async () => {
    const mockFetch = vi.fn();
    const client = new TrelloOAuthClient(config, mockFetch as any);

    const controller = new AbortController();
    controller.abort();

    await expect(client.exchangeCode('code', 'verifier', controller.signal)).rejects.toMatchObject({
      kind: 'network',
    });
    await expect(client.refresh('token', controller.signal)).rejects.toMatchObject({
      kind: 'network',
    });
    await expect(client.member('token', controller.signal)).rejects.toMatchObject({
      kind: 'network',
    });
    await expect(client.workspaces('token', controller.signal)).rejects.toMatchObject({
      kind: 'network',
    });
    await expect(client.boards('token', 'ws', controller.signal)).rejects.toMatchObject({
      kind: 'network',
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
