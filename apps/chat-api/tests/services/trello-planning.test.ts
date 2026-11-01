import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { StepError } from '@wap/tool-adapters';
import { ALL_TOOLS, TRELLO_TOOLS, type PlanResponse } from '@wap/tool-schemas';
import { getToolCatalogFor } from '../../src/services/registered-services.js';
import { runtimeToolCatalog } from '../../src/config/gmail-tools-runtime.js';
import { ChatService } from '../../src/services/chat-service.js';
import { resourceLabels } from '../../src/services/resource-labels.js';
import { AdapterFactory } from '../../src/services/adapter-factory.js';
import { WorkingMemory } from '@wap/planner';

describe('Task 8: Trello planning, catalog, refusal, and execution guards', () => {
  const encryptionKey = '0123456789abcdef0123456789abcdef';
  const userId = 'user-1';

  describe('1. Tool Catalog: getToolCatalogFor & runtimeToolCatalog', () => {
    const mockCredRepo = (personalRecord: any = null, sharedRecord: any = null) =>
      ({
        getCredentials: vi.fn().mockImplementation(async (service: string) => {
          if (service === 'trello') return sharedRecord;
          return null;
        }),
        getPersonalCredentials: vi.fn().mockImplementation(async (service: string, uId: string) => {
          if (service === 'trello' && uId === userId) return personalRecord;
          return null;
        }),
        getPersonalConnectionStatus: vi.fn().mockImplementation(async (service: string, uId: string) => {
          if (service === 'trello' && uId === userId) return personalRecord;
          return null;
        }),
      } as any);

    it('does not include trello.* tools when caller has not connected, even if shared credentials exist', async () => {
      const repo = mockCredRepo(null, { id: 'shared-trello', config: 'shared-data' });
      const catalog = await getToolCatalogFor(repo, encryptionKey, {
        userId,
        gmailEnabled: false,
        trelloConnection: async () => ({ status: 'not_connected', teamBoards: [], memberBoards: [] }),
      });
      expect(catalog.some((t) => t.service === 'trello')).toBe(false);
    });

    it('does not include trello.* tools when caller is connected but no team boards are chosen', async () => {
      const repo = mockCredRepo({ id: 'cred-1', status: 'active', config: 'dummy' });
      const catalog = await getToolCatalogFor(repo, encryptionKey, {
        userId,
        gmailEnabled: false,
        trelloConnection: async () => ({ status: 'needs_scope', teamBoards: [], memberBoards: [] }),
      });
      expect(catalog.some((t) => t.service === 'trello')).toBe(false);
    });

    it('does not include trello.* tools when caller is connected but is not a member of any chosen board', async () => {
      const repo = mockCredRepo({ id: 'cred-1', status: 'active', config: 'dummy' });
      const catalog = await getToolCatalogFor(repo, encryptionKey, {
        userId,
        gmailEnabled: false,
        trelloConnection: async () => ({ status: 'needs_membership', teamBoards: [{ boardId: 'b1', boardName: 'Bugs' }], memberBoards: [] }),
      });
      expect(catalog.some((t) => t.service === 'trello')).toBe(false);
    });

    it('includes all 9 trello.* tools when caller is connected and is a member of at least one board', async () => {
      const repo = mockCredRepo({ id: 'cred-1', status: 'active', config: 'dummy' });
      const catalog = await getToolCatalogFor(repo, encryptionKey, {
        userId,
        gmailEnabled: false,
        trelloConnection: async () => ({
          status: 'connected',
          connection: { credentialId: 'cred-1', memberId: 'm1', username: 'alice', boardIds: ['b1'] },
          teamBoards: [{ boardId: 'b1', boardName: 'Bugs' }],
          memberBoards: [{ boardId: 'b1', boardName: 'Bugs' }],
        }),
      });
      const trelloTools = catalog.filter((t) => t.service === 'trello');
      expect(trelloTools.length).toBe(9);
      expect(trelloTools.map((t) => t.name).sort()).toEqual(TRELLO_TOOLS.map((t) => t.name).sort());
    });

    it('runtimeToolCatalog in sandbox mode omits trello.* when caller is ineligible and includes them when eligible', async () => {
      const repoIneligible = mockCredRepo(null);
      const catalogIneligible = await runtimeToolCatalog('sandbox', repoIneligible, encryptionKey, {
        userId,
        gmailEnabled: false,
        trelloConnection: async () => ({ status: 'not_connected', teamBoards: [], memberBoards: [] }),
      });
      expect(catalogIneligible.some((t) => t.service === 'trello')).toBe(false);

      const repoEligible = mockCredRepo({ id: 'cred-1', status: 'active' });
      const catalogEligible = await runtimeToolCatalog('sandbox', repoEligible, encryptionKey, {
        userId,
        gmailEnabled: false,
        trelloConnection: async () => ({
          status: 'connected',
          connection: { credentialId: 'cred-1', memberId: 'm1', username: 'alice', boardIds: ['b1'] },
          teamBoards: [{ boardId: 'b1', boardName: 'Bugs' }],
          memberBoards: [{ boardId: 'b1', boardName: 'Bugs' }],
        }),
      });
      expect(catalogEligible.filter((t) => t.service === 'trello').length).toBe(9);
    });
  });

  describe('2. ChatService: Refusals and plan binding', () => {
    const cardStep = (args: Record<string, any>): PlanResponse['steps'][number] => ({
      id: 'step_1',
      tool: 'trello.create_card',
      description: 'Tạo thẻ',
      args,
      dependsOn: [],
    });

    it('refuses with unavailableServices and reason containing "Kết nối Trello" when caller is not connected', async () => {
      const chatService = new ChatService({
        msgRepo: {} as any,
        planner: {} as any,
        eventEmitter: { emit: () => {} },
        trelloConnection: async () => ({ status: 'not_connected', teamBoards: [], memberBoards: [] }),
      });

      const plan: PlanResponse = {
        kind: 'plan',
        thinking: 'Tạo thẻ',
        summary: 'Tạo thẻ',
        steps: [cardStep({ listId: 'L1', title: 'Task' })],
        warnings: [],
      };

      const result = await (chatService as any).bindConnections(plan, userId);
      expect(result.kind).toBe('refusal');
      expect(result.reason).toContain('Kết nối Trello');
      expect(result.unavailableServices).toEqual([{ id: 'trello', name: 'Trello' }]);
    });

    it('refuses with "Quản trị chưa chọn bảng Trello." when no team scope is chosen', async () => {
      const chatService = new ChatService({
        msgRepo: {} as any,
        planner: {} as any,
        eventEmitter: { emit: () => {} },
        trelloConnection: async () => ({ status: 'needs_scope', teamBoards: [], memberBoards: [] }),
      });

      const plan: PlanResponse = {
        kind: 'plan',
        thinking: 'Tạo thẻ',
        summary: 'Tạo thẻ',
        steps: [cardStep({ listId: 'L1', title: 'Task' })],
        warnings: [],
      };

      const result = await (chatService as any).bindConnections(plan, userId);
      expect(result.kind).toBe('refusal');
      expect(result.reason).toBe('Quản trị chưa chọn bảng Trello.');
    });

    it('refuses with "Bạn cần được thêm vào bảng Bugs trên Trello." when caller is not a member of that board', async () => {
      const memory = new WorkingMemory();
      memory.setEntity('__observed', {
        list: [{ id: 'L_bugs', name: 'Cần làm', boardId: 'board_bugs' }],
      });

      const chatService = new ChatService({
        msgRepo: {} as any,
        planner: {} as any,
        eventEmitter: { emit: () => {} },
        trelloConnection: async () => ({
          status: 'connected',
          connection: {
            credentialId: 'cred-1',
            memberId: 'mem-1',
            username: 'alice',
            boardIds: ['board_frontend'], // Only member of Frontend, not Bugs
          },
          teamBoards: [
            { boardId: 'board_frontend', boardName: 'Frontend' },
            { boardId: 'board_bugs', boardName: 'Bugs' },
          ],
          memberBoards: [{ boardId: 'board_frontend', boardName: 'Frontend' }],
        }),
      });

      const plan: PlanResponse = {
        kind: 'plan',
        thinking: 'Tạo thẻ',
        summary: 'Tạo thẻ trên bảng Bugs',
        steps: [cardStep({ listId: 'L_bugs', title: 'Fix bug' })],
        warnings: [],
      };

      const result = await (chatService as any).bindConnections(plan, userId, undefined, memory);
      expect(result.kind).toBe('refusal');
      expect(result.reason).toBe('Bạn cần được thêm vào bảng Bugs trên Trello.');
    });

    it('binds connections.trello on valid plan and hash changes if boardIds change', async () => {
      const memory = new WorkingMemory();
      memory.setEntity('__observed', {
        list: [{ id: 'L_frontend', name: 'Cần làm', boardId: 'board_frontend' }],
      });

      const chatService = new ChatService({
        msgRepo: {} as any,
        planner: {} as any,
        eventEmitter: { emit: () => {} },
        trelloConnection: async () => ({
          status: 'connected',
          connection: {
            credentialId: 'cred-1',
            memberId: 'mem-1',
            username: 'alice',
            boardIds: ['board_frontend'],
          },
          teamBoards: [{ boardId: 'board_frontend', boardName: 'Frontend' }],
          memberBoards: [{ boardId: 'board_frontend', boardName: 'Frontend' }],
        }),
      });

      const plan: PlanResponse = {
        kind: 'plan',
        thinking: 'Tạo thẻ',
        summary: 'Tạo thẻ trên bảng Frontend',
        steps: [cardStep({ listId: 'L_frontend', title: 'Task' })],
        warnings: [],
      };

      const result = await (chatService as any).bindConnections(plan, userId, undefined, memory);
      expect(result.kind).toBe('plan');
      expect((result as any).steps[0].boardId).toBe('board_frontend');
      expect((result as any).connections?.trello).toEqual({
        credentialId: 'cred-1',
        memberId: 'mem-1',
        username: 'alice',
        boardIds: ['board_frontend'],
      });
      expect((result as any).connections?.trello?.refreshToken).toBeUndefined();

      // Hash changes if boardIds change
      const planA = { ...result, connections: { trello: { credentialId: 'cred-1', memberId: 'm1', username: 'alice', boardIds: ['b1'] } } };
      const planB = { ...result, connections: { trello: { credentialId: 'cred-1', memberId: 'm1', username: 'alice', boardIds: ['b1', 'b2'] } } };
      const hashA = createHash('sha256').update(JSON.stringify(planA)).digest('hex');
      const hashB = createHash('sha256').update(JSON.stringify(planB)).digest('hex');
      expect(hashA).not.toBe(hashB);
    });
  });

  describe('3. resourceLabels: map boardId and listId to board name from team scope', () => {
    it('maps boardId and listId of Trello step to the board name from team scope, not from model text', () => {
      const memory = new WorkingMemory();
      // Model invented "Hallucinated Board Name" in memory
      memory.setEntity('__observed', {
        board: [{ id: 'board_bugs', name: 'Model Hallucinated Board Name' }],
        list: [{ id: 'list_123', name: 'Đang làm', boardId: 'board_bugs' }],
      });

      const plan: PlanResponse = {
        kind: 'plan',
        thinking: '',
        summary: '',
        steps: [
          {
            id: 's1',
            tool: 'trello.search_cards',
            description: 'Tìm thẻ',
            args: { boardId: 'board_bugs', query: 'auth' },
            dependsOn: [],
          },
          {
            id: 's2',
            tool: 'trello.create_card',
            description: 'Tạo thẻ',
            args: { listId: 'list_123', title: 'Thẻ mới' },
            dependsOn: [],
          },
        ],
        warnings: [],
      };

      const teamBoards = [{ boardId: 'board_bugs', boardName: 'Bugs' }];
      const labels = resourceLabels(plan, memory, [], { teamBoards });

      expect(labels['board_bugs']).toBe('Bugs');
      expect(labels['list_123']).toBe('Đang làm (board Bugs)');
      expect(JSON.stringify(labels)).not.toContain('Model Hallucinated Board Name');
    });
  });

  describe('4. AdapterFactory: Execution guards', () => {
    const mockOAuthClient = {
      boards: vi.fn(),
    };
    const mockTokens = {
      forConnection: vi.fn().mockReturnValue({
        getAccessToken: vi.fn().mockResolvedValue('live-access-token'),
      }),
      clear: vi.fn(),
    };

    it('throws AUTH_ERROR and does not call adapter if plan credentialId differs from active credential', async () => {
      const mockCredRepo = {
        getPersonalCredentials: vi.fn().mockResolvedValue({
          id: 'cred-current-active',
          status: 'active',
          config: 'encrypted',
        }),
      };

      const factory = new AdapterFactory({
        credentialRepo: mockCredRepo as any,
        encryptionKey,
        trelloTokens: mockTokens as any,
        trelloOAuthClient: mockOAuthClient as any,
      });

      const context = {
        userId,
        phase: 'execution' as const,
        connections: {
          trello: {
            credentialId: 'cred-old-in-plan',
            memberId: 'm1',
            username: 'alice',
            boardIds: ['b1'],
          },
        },
      };

      await expect(factory.getAdapterForService('trello', context)).rejects.toMatchObject({
        category: 'AUTH_ERROR',
        message: 'Kết nối Trello đã thay đổi, hãy lập lại kế hoạch.',
      });
      expect(mockOAuthClient.boards).not.toHaveBeenCalled();
    });

    it('throws AUTH_ERROR before HTTP if a board in plan hash was removed from team scope', async () => {
      const mockCredRepo = {
        getPersonalCredentials: vi.fn().mockResolvedValue({
          id: 'cred-1',
          status: 'active',
          config: JSON.stringify({ refreshToken: 'ref-1', username: 'alice' }),
        }),
      };
      const mockTeamRepo = {
        get: vi.fn().mockResolvedValue({
          workspaceId: 'ws-1',
          workspaceName: 'Work',
          boards: [{ boardId: 'b2', boardName: 'Backend' }], // b1 was removed!
        }),
      };

      const factory = new AdapterFactory({
        credentialRepo: mockCredRepo as any,
        encryptionKey,
        trelloTokens: mockTokens as any,
        trelloOAuthClient: mockOAuthClient as any,
        trelloTeamRepo: mockTeamRepo as any,
      });

      const context = {
        userId,
        phase: 'execution' as const,
        connections: {
          trello: {
            credentialId: 'cred-1',
            memberId: 'm1',
            username: 'alice',
            boardIds: ['b1'],
          },
        },
      };

      await expect(factory.getAdapterForService('trello', context)).rejects.toMatchObject({
        category: 'AUTH_ERROR',
      });
      expect(mockOAuthClient.boards).not.toHaveBeenCalled();
    });

    it('throws AUTH_ERROR before HTTP if executor is no longer a member of the board', async () => {
      const mockCredRepo = {
        getPersonalCredentials: vi.fn().mockResolvedValue({
          id: 'cred-1',
          status: 'active',
          config: JSON.stringify({ refreshToken: 'ref-1', username: 'alice' }),
        }),
      };
      const mockTeamRepo = {
        get: vi.fn().mockResolvedValue({
          workspaceId: 'ws-1',
          workspaceName: 'Work',
          boards: [{ boardId: 'b1', boardName: 'Frontend' }],
        }),
      };
      mockOAuthClient.boards.mockResolvedValueOnce([
        { id: 'b1', name: 'Frontend', member: false }, // No longer member!
      ]);

      const factory = new AdapterFactory({
        credentialRepo: mockCredRepo as any,
        encryptionKey,
        trelloTokens: mockTokens as any,
        trelloOAuthClient: mockOAuthClient as any,
        trelloTeamRepo: mockTeamRepo as any,
      });

      const context = {
        userId,
        phase: 'execution' as const,
        connections: {
          trello: {
            credentialId: 'cred-1',
            memberId: 'm1',
            username: 'alice',
            boardIds: ['b1'],
          },
        },
      };

      await expect(factory.getAdapterForService('trello', context)).rejects.toMatchObject({
        category: 'AUTH_ERROR',
      });
    });

    it('creates adapter with access token and allowedBoardIds as intersection when caller is valid', async () => {
      const mockCredRepo = {
        getPersonalCredentials: vi.fn().mockResolvedValue({
          id: 'cred-1',
          status: 'active',
          config: JSON.stringify({ refreshToken: 'ref-1', username: 'alice' }),
        }),
      };
      const mockTeamRepo = {
        get: vi.fn().mockResolvedValue({
          workspaceId: 'ws-1',
          workspaceName: 'Work',
          boards: [
            { boardId: 'b1', boardName: 'Frontend' },
            { boardId: 'b2', boardName: 'Backend' },
          ],
        }),
      };
      mockOAuthClient.boards.mockResolvedValueOnce([
        { id: 'b1', name: 'Frontend', member: true },
        { id: 'b2', name: 'Backend', member: true },
      ]);

      let createdWith: any;
      const factory = new AdapterFactory({
        credentialRepo: mockCredRepo as any,
        encryptionKey,
        trelloTokens: mockTokens as any,
        trelloOAuthClient: mockOAuthClient as any,
        trelloTeamRepo: mockTeamRepo as any,
        createTrelloAdapter: (input) => {
          createdWith = input;
          return { execute: vi.fn() } as any;
        },
      });

      const context = {
        userId,
        phase: 'execution' as const,
        connections: {
          trello: {
            credentialId: 'cred-1',
            memberId: 'm1',
            username: 'alice',
            boardIds: ['b1'], // Plan only requested b1
          },
        },
      };

      const adapter = await factory.getAdapterForService('trello', context);
      expect(adapter).toBeDefined();
      expect(createdWith).toEqual({
        userId,
        accessToken: 'live-access-token',
        allowedBoardIds: ['b1'],
      });
    });

    it('creates adapter with allowedBoardIds [b1] when boardIds has [b1, b2] but team scope only has b1 and caller is member of b1', async () => {
      const mockCredRepo = {
        getPersonalCredentials: vi.fn().mockResolvedValue({
          id: 'cred-1',
          status: 'active',
          config: JSON.stringify({ refreshToken: 'ref-1', username: 'alice' }),
        }),
      };
      const mockTeamRepo = {
        get: vi.fn().mockResolvedValue({
          workspaceId: 'ws-1',
          workspaceName: 'Work',
          boards: [{ boardId: 'b1', boardName: 'Frontend' }], // Only b1 in team scope
        }),
      };
      mockOAuthClient.boards.mockResolvedValueOnce([
        { id: 'b1', name: 'Frontend', member: true },
      ]);

      let createdWith: any;
      const factory = new AdapterFactory({
        credentialRepo: mockCredRepo as any,
        encryptionKey,
        trelloTokens: mockTokens as any,
        trelloOAuthClient: mockOAuthClient as any,
        trelloTeamRepo: mockTeamRepo as any,
        createTrelloAdapter: (input) => {
          createdWith = input;
          return { execute: vi.fn() } as any;
        },
      });

      const context = {
        userId,
        phase: 'execution' as const,
        connections: {
          trello: {
            credentialId: 'cred-1',
            memberId: 'm1',
            username: 'alice',
            boardIds: ['b1', 'b2'],
          },
        },
      };

      const adapter = await factory.getAdapterForService('trello', context);
      expect(adapter).toBeDefined();
      expect(createdWith).toEqual({
        userId,
        accessToken: 'live-access-token',
        allowedBoardIds: ['b1'],
      });
    });

    it('creates adapter with allowedBoardIds [b1] when boardIds has [b1, b2], both in team scope, but caller is only member of b1', async () => {
      const mockCredRepo = {
        getPersonalCredentials: vi.fn().mockResolvedValue({
          id: 'cred-1',
          status: 'active',
          config: JSON.stringify({ refreshToken: 'ref-1', username: 'alice' }),
        }),
      };
      const mockTeamRepo = {
        get: vi.fn().mockResolvedValue({
          workspaceId: 'ws-1',
          workspaceName: 'Work',
          boards: [
            { boardId: 'b1', boardName: 'Frontend' },
            { boardId: 'b2', boardName: 'Backend' },
          ],
        }),
      };
      mockOAuthClient.boards.mockResolvedValueOnce([
        { id: 'b1', name: 'Frontend', member: true },
        { id: 'b2', name: 'Backend', member: false }, // Lost membership in b2
      ]);

      let createdWith: any;
      const factory = new AdapterFactory({
        credentialRepo: mockCredRepo as any,
        encryptionKey,
        trelloTokens: mockTokens as any,
        trelloOAuthClient: mockOAuthClient as any,
        trelloTeamRepo: mockTeamRepo as any,
        createTrelloAdapter: (input) => {
          createdWith = input;
          return { execute: vi.fn() } as any;
        },
      });

      const context = {
        userId,
        phase: 'execution' as const,
        connections: {
          trello: {
            credentialId: 'cred-1',
            memberId: 'm1',
            username: 'alice',
            boardIds: ['b1', 'b2'],
          },
        },
      };

      const adapter = await factory.getAdapterForService('trello', context);
      expect(adapter).toBeDefined();
      expect(createdWith).toEqual({
        userId,
        accessToken: 'live-access-token',
        allowedBoardIds: ['b1'],
      });
    });
  });
});
