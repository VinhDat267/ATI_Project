import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSandboxAdapter } from '../../src/sandbox/index.js';
import { AdapterFactory } from '../../src/services/adapter-factory.js';
import { createToolRuntimeFactory } from '../../src/config/gmail-tools-runtime.js';
import { TRELLO_FAKE } from '../../src/sandbox/fake-results/trello.js';
import { StepError } from '@wap/tool-adapters';
import { encryptCredentials } from '@wap/tool-adapters';

describe('Task 11: Trello sandbox and personal connection enforcement', () => {
  const key = 'test-encryption-key-must-be-32-bytes!';
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (info: any) => {
      const url = typeof info === 'string' ? info : info?.url || '';
      if (url.includes('api.trello.com')) {
        throw new Error(`Real network call to api.trello.com was attempted: ${url}`);
      }
      return new Response('{}', { status: 200 });
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('TRELLO_FAKE implements fake results for all 9 Trello tools', async () => {
    const nineTools = [
      'trello.search_boards',
      'trello.search_lists',
      'trello.search_members',
      'trello.search_cards',
      'trello.get_card',
      'trello.create_card',
      'trello.update_card',
      'trello.add_member',
      'trello.add_checklist',
    ];

    for (const tool of nineTools) {
      expect(typeof TRELLO_FAKE.tools[tool], `Expected handler for ${tool}`).toBe('function');
    }

    const adapter = createSandboxAdapter('trello');
    const created = await adapter.execute('trello.create_card', {
      boardId: 'b1',
      listId: 'l1',
      title: 'Fix Bug',
      desc: 'Bug details',
    });
    expect(created).toMatchObject({
      name: 'Fix Bug',
      listId: 'l1',
      desc: 'Bug details',
      url: expect.stringContaining('trello.com'),
    });
    expect(created.id).toBeDefined();

    // Verify fetch was not called with api.trello.com
    for (const call of fetchSpy.mock.calls) {
      const url = String(call[0]);
      expect(url).not.toContain('api.trello.com');
    }
  });

  it('in sandbox mode, execution with valid connection returns fake result without calling api.trello.com', async () => {
    const userId = 'user-trello-1';
    const credentialId = 'cred-trello-1';
    const boardId = 'board-sprint';

    const credRepo: any = {
      getPersonalCredentials: vi.fn().mockResolvedValue({
        id: credentialId,
        service: 'trello',
        userId,
        status: 'active',
        config: encryptCredentials({ refreshToken: 'fake-refresh-token' }, key),
      }),
      getCredentials: vi.fn().mockResolvedValue(null),
    };

    const trelloTeamRepo: any = {
      get: vi.fn().mockResolvedValue({
        workspaceId: 'ws-1',
        workspaceName: 'Engineering Workspace',
        boards: [{ boardId, boardName: 'Sprint Board' }],
      }),
    };

    const trelloTokens: any = {
      forConnection: vi.fn().mockReturnValue({
        getAccessToken: vi.fn().mockResolvedValue('fake-access-token'),
      }),
    };

    const realFactory = new AdapterFactory({
      credentialRepo: credRepo,
      encryptionKey: key,
      trelloTokens,
      trelloTeamRepo,
      createTrelloAdapter: ({ allowedBoardIds }) => {
        const sandbox = createSandboxAdapter('trello');
        return {
          execute: async (tool, args, ctx) => {
            const targetBoardId = ctx?.boardId ?? args?.boardId;
            if (targetBoardId && !allowedBoardIds.includes(String(targetBoardId))) {
              throw new StepError({
                category: 'AUTH_ERROR',
                message: 'Bảng không nằm trong phạm vi được phép.',
              });
            }
            return sandbox.execute(tool, args, ctx);
          },
        };
      },
    });

    const factory = createToolRuntimeFactory(
      'sandbox',
      (service, ctx) => realFactory.getAdapterForService(service, ctx),
      (service) => createSandboxAdapter(service)
    );

    const adapter = await factory.getAdapterForService('trello', {
      userId,
      phase: 'execution',
      connections: {
        trello: {
          credentialId,
          memberId: 'm1',
          username: 'alice_trello',
          boardIds: [boardId],
        },
      },
    });

    const result = await adapter.execute('trello.create_card', {
      boardId,
      listId: 'list-1',
      title: 'Fix Bug in Sandbox',
    });

    expect(result).toMatchObject({
      name: 'Fix Bug in Sandbox',
      url: expect.stringContaining('trello.com'),
    });

    // fetch is NOT called with api.trello.com
    for (const call of fetchSpy.mock.calls) {
      const url = String(call[0]);
      expect(url).not.toContain('api.trello.com');
    }

    await expect(
      adapter.execute('trello.create_card', { listId: 'list-1', title: 'X' }, { boardId: 'board-forbidden' })
    ).rejects.toMatchObject({
      category: 'AUTH_ERROR',
    });
  });

  it('in sandbox mode, execution without connection fails with AUTH_ERROR and does not fall back to shared token', async () => {
    const credRepo: any = {
      getPersonalCredentials: vi.fn().mockResolvedValue(null),
      // Even if legacy shared credentials exist in the database:
      getCredentials: vi.fn().mockResolvedValue({
        service: 'trello',
        config: encryptCredentials({ apiKey: 'shared-key', token: 'shared-token' }, key),
      }),
    };

    const realFactory = new AdapterFactory({
      credentialRepo: credRepo,
      encryptionKey: key,
    });

    const factory = createToolRuntimeFactory(
      'sandbox',
      (service, ctx) => realFactory.getAdapterForService(service, ctx),
      (service) => createSandboxAdapter(service)
    );

    await expect(
      factory.getAdapterForService('trello', {
        userId: 'user-no-connection',
        phase: 'execution',
      })
    ).rejects.toMatchObject({
      category: 'AUTH_ERROR',
    });
  });
});
