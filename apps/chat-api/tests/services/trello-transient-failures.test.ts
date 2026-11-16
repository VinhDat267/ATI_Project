import { afterEach, describe, expect, it, vi } from 'vitest';
import { encryptCredentials, StepError } from '@wap/tool-adapters';
import { createTrelloConnectionLookup } from '../../src/services/trello/connection-reference.js';
import { TrelloOAuthClient, TrelloOAuthError } from '../../src/services/trello/oauth-client.js';
import { AdapterFactory } from '../../src/services/adapter-factory.js';
import { TRELLO_TRANSPORT } from '../../src/services/transports/trello.js';

const encryptionKey = '0123456789abcdef0123456789abcdef';
const userId = 'user-1';
const record = {
  id: 'cred-1',
  status: 'active',
  config: encryptCredentials({ refreshToken: 'ref-1', username: 'alice', memberId: 'm1' }, encryptionKey),
};
const teamRepo = {
  get: vi.fn().mockResolvedValue({
    workspaceId: 'ws-1',
    workspaceName: 'Work',
    boards: [{ boardId: 'b1', boardName: 'Frontend' }],
  }),
};

const stepError = (category: 'AUTH_ERROR' | 'NETWORK' | 'SERVER_ERROR') =>
  new StepError({ category, retryable: false, message: category });

describe('Trello connection lookup: transient vs. lost grant', () => {
  const lookupWith = (getAccessToken: () => Promise<string>, boards: () => Promise<any[]>) =>
    createTrelloConnectionLookup({
      credentialRepo: { getPersonalConnectionStatus: vi.fn().mockResolvedValue(record) } as any,
      teamRepo: teamRepo as any,
      encryptionKey,
      tokens: { forConnection: () => ({ getAccessToken }) } as any,
      client: { boards } as any,
    });

  it.each([
    ['token refresh network failure', () => Promise.reject(stepError('NETWORK')), () => Promise.resolve([])],
    ['token refresh 5xx', () => Promise.reject(stepError('SERVER_ERROR')), () => Promise.resolve([])],
    ['boards network failure', () => Promise.resolve('at'), () => Promise.reject(new TrelloOAuthError('network'))],
    ['boards 5xx', () => Promise.resolve('at'), () => Promise.reject(new TrelloOAuthError('server', 502))],
    ['boards 429', () => Promise.resolve('at'), () => Promise.reject(new TrelloOAuthError('rejected', 429))],
  ])('%s is unavailable, not reconnect_required', async (_label, token, boards) => {
    const result = await lookupWith(token as any, boards as any)(userId, 'default');
    expect(result.status).toBe('unavailable');
    expect(result.connection).toBeUndefined();
  });

  it.each([
    ['lost grant from token refresh', () => Promise.reject(stepError('AUTH_ERROR')), () => Promise.resolve([])],
    ['boards 401', () => Promise.resolve('at'), () => Promise.reject(new TrelloOAuthError('rejected', 401))],
    ['boards 403', () => Promise.resolve('at'), () => Promise.reject(new TrelloOAuthError('rejected', 403))],
    ['boards invalid_grant', () => Promise.resolve('at'), () => Promise.reject(new TrelloOAuthError('invalid_grant', 400))],
  ])('%s is reconnect_required', async (_label, token, boards) => {
    const result = await lookupWith(token as any, boards as any)(userId, 'default');
    expect(result.status).toBe('reconnect_required');
  });
});

describe('AdapterFactory Trello: boards failures and signals', () => {
  const build = (boards: (...args: any[]) => Promise<any[]>, getAccessToken = vi.fn().mockResolvedValue('at')) =>
    ({
      getAccessToken,
      factory: new AdapterFactory({
        credentialRepo: { getPersonalCredentials: vi.fn().mockResolvedValue(record) } as any,
        encryptionKey,
        trelloTokens: { forConnection: () => ({ getAccessToken }), clear: vi.fn() } as any,
        trelloOAuthClient: { boards } as any,
        trelloTeamRepo: teamRepo as any,
        createTrelloAdapter: () => ({ execute: vi.fn() }) as any,
      }),
    });
  const context = (signal?: AbortSignal) => ({
    userId,
    phase: 'execution' as const,
    connections: { trello: { credentialId: 'cred-1', memberId: 'm1', username: 'alice', boardIds: ['b1'] } },
    ...(signal ? { signal } : {}),
  });

  it('turns a boards network failure into a NETWORK StepError instead of a raw OAuth error', async () => {
    const { factory } = build(() => Promise.reject(new TrelloOAuthError('network')));
    await expect(factory.getAdapterForService('trello', context())).rejects.toSatisfy((err: any) => {
      expect(err).toBeInstanceOf(StepError);
      expect(err.category).toBe('NETWORK');
      return true;
    });
  });

  it('turns a boards 5xx into SERVER_ERROR and a boards 401 into AUTH_ERROR', async () => {
    const down = build(() => Promise.reject(new TrelloOAuthError('server', 503)));
    await expect(down.factory.getAdapterForService('trello', context())).rejects.toMatchObject({ category: 'SERVER_ERROR' });
    const revoked = build(() => Promise.reject(new TrelloOAuthError('rejected', 401)));
    await expect(revoked.factory.getAdapterForService('trello', context())).rejects.toMatchObject({ category: 'AUTH_ERROR' });
  });

  it('passes the run signal to token refresh and boards lookup', async () => {
    const controller = new AbortController();
    let boardsSignal: AbortSignal | undefined;
    const { factory, getAccessToken } = build(async (_t: string, _w: string, signal: AbortSignal) => {
      boardsSignal = signal;
      return [{ id: 'b1', name: 'Frontend', member: true }];
    });
    await factory.getAdapterForService('trello', context(controller.signal) as any);
    const tokenSignal = getAccessToken.mock.calls[0]?.[0]?.signal as AbortSignal | undefined;
    expect(tokenSignal).toBeDefined();
    expect(boardsSignal).toBeDefined();
    expect(tokenSignal!.aborted).toBe(false);
    controller.abort();
    expect(tokenSignal!.aborted).toBe(true);
    expect(boardsSignal!.aborted).toBe(true);
  });
});

describe('TrelloOAuthClient.boards', () => {
  const config = {
    clientId: 'cid',
    clientSecret: 'csec',
    redirectUri: 'http://127.0.0.1/callback',
    authorizationUrl: 'http://127.0.0.1/auth',
    tokenUrl: 'http://127.0.0.1/token',
    apiBaseUrl: 'http://127.0.0.1/api',
  };

  it('lists the caller boards without a membership filter and drops closed boards', async () => {
    let requested = '';
    const client = new TrelloOAuthClient(config, (async (url: string) => {
      requested = String(url);
      return new Response(
        JSON.stringify([
          { id: 'open', name: 'Open', idOrganization: 'ws-1', closed: false },
          { id: 'archived', name: 'Archived', idOrganization: 'ws-1', closed: true, member: true },
          { id: 'left', name: 'Left', idOrganization: 'ws-1', member: false },
        ]),
        { status: 200 }
      );
    }) as any);
    const boards = await client.boards('at', 'ws-1', new AbortController().signal);
    // Live Trello drops workspace-visible boards the caller belongs to when
    // `filter=members` is sent, which made a real connection `needs_membership`.
    expect(new URL(requested).searchParams.has('filter')).toBe(false);
    expect(boards).toEqual([
      { id: 'open', name: 'Open', workspaceId: 'ws-1', member: true },
      { id: 'left', name: 'Left', workspaceId: 'ws-1', member: false },
    ]);
  });
});

describe('Trello shared transport checkConnection', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the configured API base URL instead of the hard-coded production host', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'm1' }), { status: 200 }));
    const ok = await TRELLO_TRANSPORT.checkConnection(
      { accessToken: 'at', apiBaseUrl: 'http://127.0.0.1:9/trello/1' },
      fetchFn as any,
      new AbortController().signal
    );
    expect(ok).toBe(true);
    expect(String(fetchFn.mock.calls[0]?.[0])).toBe('http://127.0.0.1:9/trello/1/members/me');
  });

  it('falls back to TRELLO_API_BASE_URL from the environment', async () => {
    vi.stubEnv('TRELLO_API_BASE_URL', 'http://127.0.0.1:9/fake/1/');
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'm1' }), { status: 200 }));
    await TRELLO_TRANSPORT.checkConnection({ accessToken: 'at' }, fetchFn as any, new AbortController().signal);
    expect(String(fetchFn.mock.calls[0]?.[0])).toBe('http://127.0.0.1:9/fake/1/members/me');
  });
});
