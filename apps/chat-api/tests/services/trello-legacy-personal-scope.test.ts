import { describe, expect, it, vi } from 'vitest';
import { encryptCredentials } from '@wap/tool-adapters';
import { createTrelloConnectionLookup } from '../../src/services/trello/connection-reference.js';
import { AdapterFactory } from '../../src/services/adapter-factory.js';

const key = '0123456789abcdef0123456789abcdef';
const userId = 'user-demo-1';

function makeCredentialRepo() {
  const config = encryptCredentials(
    { refreshToken: 'rt-1', username: 'vinh', memberId: 'm-1' },
    key,
  );
  const record = { id: 'cred-trello-1', service: 'trello', user_id: userId, status: 'active', config };
  return {
    getPersonalConnectionStatus: vi.fn(async () => record),
    getPersonalCredentials: vi.fn(async () => record),
    getCredentials: vi.fn(async () => null),
  } as any;
}

describe('Trello legacy/personal scope alignment', () => {
  it('resolves personal:<userId> scope in legacy mode when user saved personal boards and default is empty', async () => {
    const teamRepo = {
      get: vi.fn(async (scopeId = 'default') => {
        if (scopeId === `personal:${userId}`) {
          return {
            workspaceId: 'ws-trello-1',
            workspaceName: 'My Trello',
            boards: [{ boardId: 'board-personal', boardName: 'Personal Board' }],
          };
        }
        return null;
      }),
    };
    const lookup = createTrelloConnectionLookup({
      credentialRepo: makeCredentialRepo(),
      teamRepo,
      encryptionKey: key,
      tokens: {
        forConnection: () => ({ getAccessToken: async () => 'access-1' }) as any,
      },
      client: {
        boards: async () => [{ id: 'board-personal', name: 'Personal Board', workspaceId: 'ws-trello-1', member: true }],
      },
    });

    const result = await lookup(userId, 'default');
    expect(result.status).toBe('connected');
    expect(result.connection?.boardIds).toEqual(['board-personal']);
  });

  it('keeps strict isolation for organization scope without falling back to personal or default', async () => {
    const teamRepo = {
      get: vi.fn(async (scopeId = 'default') => {
        if (scopeId === `personal:${userId}` || scopeId === 'default') {
          return {
            workspaceId: 'ws-trello-1',
            workspaceName: 'My Trello',
            boards: [{ boardId: 'board-personal', boardName: 'Personal Board' }],
          };
        }
        return null;
      }),
    };
    const lookup = createTrelloConnectionLookup({
      credentialRepo: makeCredentialRepo(),
      teamRepo,
      encryptionKey: key,
    });

    const orgResult = await lookup(userId, '44a6149f-3ff1-418e-b900-5742e53cc96e');
    expect(orgResult.status).toBe('needs_scope');
  });

  it('AdapterFactory uses personal:<userId> in legacy mode when default has no boards, while keeping org isolated', async () => {
    const teamRepo = {
      get: vi.fn(async (scopeId = 'default') => {
        if (scopeId === `personal:${userId}`) {
          return {
            workspaceId: 'ws-trello-1',
            workspaceName: 'My Trello',
            boards: [{ boardId: 'board-personal', boardName: 'Personal Board' }],
          };
        }
        return null;
      }),
    };
    const capturedAllowed: string[][] = [];
    const factory = new AdapterFactory({
      credentialRepo: makeCredentialRepo(),
      encryptionKey: key,
      trelloTeamRepo: teamRepo as any,
      trelloTokens: {
        forConnection: () => ({ getAccessToken: async () => 'access-1' }) as any,
      } as any,
      trelloOAuthClient: {
        boards: async () => [{ id: 'board-personal', name: 'Personal Board', member: true }],
      } as any,
      createTrelloAdapter: ({ allowedBoardIds }) => {
        capturedAllowed.push(allowedBoardIds);
        return { execute: async () => ({ ok: true }) };
      },
    });

    await factory.getAdapterForService('trello', { userId, phase: 'planning', workspaceMode: 'legacy', workspaceId: null });
    expect(capturedAllowed).toEqual([['board-personal']]);

    await expect(
      factory.getAdapterForService('trello', {
        userId,
        phase: 'planning',
        workspaceMode: 'organization',
        workspaceId: '44a6149f-3ff1-418e-b900-5742e53cc96e',
      }),
    ).rejects.toThrow(/chưa chọn bảng Trello/i);
  });
});
