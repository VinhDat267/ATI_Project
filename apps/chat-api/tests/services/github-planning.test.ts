import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { encryptCredentials } from '@wap/tool-adapters';
import { GITHUB_OAUTH_TOOLS, GITHUB_TOOLS, type PlanResponse } from '@wap/tool-schemas';
import { getToolCatalogFor } from '../../src/services/registered-services.js';
import { runtimeToolCatalog, mayFallbackToShared } from '../../src/config/gmail-tools-runtime.js';
import { ChatService } from '../../src/services/chat-service.js';
import { resourceLabels } from '../../src/services/resource-labels.js';
import { AdapterFactory } from '../../src/services/adapter-factory.js';
import { createGitHubConnectionLookup } from '../../src/services/github/connection-reference.js';
import { GitHubOAuthClient } from '../../src/services/github/oauth-client.js';
import { WorkingMemory, validatePlan } from '@wap/planner';

describe('Task 6: GitHub personal OAuth planning, catalog, refusal, and execution guards', () => {
  const encryptionKey = '0123456789abcdef0123456789abcdef';
  const userId = 'user-1';

  describe('1. Tool Catalog: getToolCatalogFor & runtimeToolCatalog & mayFallbackToShared', () => {
    const mockCredRepo = (personalRecord: any = null, sharedRecord: any = null) =>
      ({
        getCredentials: vi.fn().mockImplementation(async (service: string) => {
          if (service === 'github') return sharedRecord;
          return null;
        }),
        getPersonalCredentials: vi.fn().mockImplementation(async (service: string, uId: string) => {
          if (service === 'github' && uId === userId) return personalRecord;
          return null;
        }),
        getPersonalConnectionStatus: vi.fn().mockImplementation(async (service: string, uId: string) => {
          if (service === 'github' && uId === userId) return personalRecord;
          return null;
        }),
      } as any);

    it('does not include github.* tools when caller has not connected, even if shared credentials exist', async () => {
      const repo = mockCredRepo(null, { id: 'shared-gh', config: 'shared-data' });
      const catalog = await getToolCatalogFor(repo, encryptionKey, {
        userId,
        gmailEnabled: false,
        githubConnection: async () => ({ status: 'not_connected', teamRepos: [], memberRepos: [] }),
      });
      expect(catalog.some((t) => t.service === 'github')).toBe(false);
    });

    it('does not include github.* tools when caller is connected but no team repos are chosen', async () => {
      const repo = mockCredRepo({ id: 'cred-1', status: 'active', config: 'dummy' });
      const catalog = await getToolCatalogFor(repo, encryptionKey, {
        userId,
        gmailEnabled: false,
        githubConnection: async () => ({ status: 'needs_scope', teamRepos: [], memberRepos: [] }),
      });
      expect(catalog.some((t) => t.service === 'github')).toBe(false);
    });

    it('does not include github.* tools when caller is connected but has no access to any chosen team repo', async () => {
      const repo = mockCredRepo({ id: 'cred-1', status: 'active', config: 'dummy' });
      const catalog = await getToolCatalogFor(repo, encryptionKey, {
        userId,
        gmailEnabled: false,
        githubConnection: async () => ({
          status: 'needs_membership',
          teamRepos: [{ repoId: '101', fullName: 'nhom/ati', name: 'ati' }],
          memberRepos: [],
        }),
      });
      expect(catalog.some((t) => t.service === 'github')).toBe(false);
    });

    it('includes all 9 github.* tools (GITHUB_TOOLS + GITHUB_OAUTH_TOOLS) when caller is connected and has access to at least one team repo', async () => {
      const repo = mockCredRepo({ id: 'cred-1', status: 'active', config: 'dummy' });
      const catalog = await getToolCatalogFor(repo, encryptionKey, {
        userId,
        gmailEnabled: false,
        githubConnection: async () => ({
          status: 'connected',
          connection: { credentialId: 'cred-1', githubUserId: '1001', login: 'octocat', repos: ['nhom/ati'] },
          teamRepos: [{ repoId: '101', fullName: 'nhom/ati', name: 'ati' }],
          memberRepos: [{ repoId: '101', fullName: 'nhom/ati', name: 'ati' }],
        }),
      });
      const githubTools = catalog.filter((t) => t.service === 'github');
      expect(githubTools.length).toBe(9);
      expect(githubTools.map((t) => t.name).sort()).toEqual(
        [...GITHUB_TOOLS, ...GITHUB_OAUTH_TOOLS].map((t) => t.name).sort(),
      );

      const validation = validatePlan(
        JSON.stringify({
          kind: 'plan',
          thinking: 'Close issue #42',
          summary: 'Đóng issue #42',
          steps: [
            {
              id: 'step_1',
              tool: 'github.update_issue',
              description: 'Đóng issue #42',
              args: { repo: 'nhom/ati', issueNumber: 42, state: 'closed' },
              dependsOn: [],
            },
          ],
          warnings: [],
        }),
        catalog,
      );
      expect(validation.valid).toBe(true);
    });

    it('includes all 9 github.* tools via fallback path using real GitHubOAuthClient.repos()', async () => {
      const encryptedConfig = encryptCredentials(
        { accessToken: 'gho_tok', githubUserId: '1001', login: 'octocat' },
        encryptionKey,
      );
      const repo = mockCredRepo({ id: 'cred-1', status: 'active', config: encryptedConfig });
      const client = new GitHubOAuthClient(
        {
          clientId: 'cid',
          clientSecret: 'csec',
          redirectUri: 'http://localhost/cb',
          authorizationUrl: 'http://localhost/authorize',
          tokenUrl: 'http://localhost/token',
          apiBaseUrl: 'http://localhost/api',
          scope: 'repo',
        },
        vi.fn(async () =>
          new Response(
            JSON.stringify([
              { id: 101, name: 'ati', full_name: 'nhom/ati', private: false, permissions: { push: true } },
            ]),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        ) as any,
      );
      const catalog = await getToolCatalogFor(repo, encryptionKey, {
        userId,
        gmailEnabled: false,
        githubTeamRepo: {
          repos: async () => [{ repoId: '101', fullName: 'nhom/ati', name: 'ati' }],
        },
        githubOAuthClient: client,
        githubTokens: {
          forConnection: () => ({
            getAccessToken: async () => 'gho_tok',
          }),
        },
      });
      const githubTools = catalog.filter((t) => t.service === 'github');
      expect(githubTools.length).toBe(9);
    });

    it('runtimeToolCatalog in sandbox mode omits github.* when caller is ineligible and includes them when eligible', async () => {
      const repoIneligible = mockCredRepo(null);
      const catalogIneligible = await runtimeToolCatalog('sandbox', repoIneligible, encryptionKey, {
        userId,
        gmailEnabled: false,
        githubConnection: async () => ({ status: 'not_connected', teamRepos: [], memberRepos: [] }),
      });
      expect(catalogIneligible.some((t) => t.service === 'github')).toBe(false);

      const repoEligible = mockCredRepo({ id: 'cred-1', status: 'active' });
      const catalogEligible = await runtimeToolCatalog('sandbox', repoEligible, encryptionKey, {
        userId,
        gmailEnabled: false,
        githubConnection: async () => ({
          status: 'connected',
          connection: { credentialId: 'cred-1', githubUserId: '1001', login: 'octocat', repos: ['nhom/ati'] },
          teamRepos: [{ repoId: '101', fullName: 'nhom/ati', name: 'ati' }],
          memberRepos: [{ repoId: '101', fullName: 'nhom/ati', name: 'ati' }],
        }),
      });
      expect(catalogEligible.filter((t) => t.service === 'github').length).toBe(9);
    });

    it('mayFallbackToShared returns false when user message routes to github', () => {
      expect(mayFallbackToShared({ userMessage: 'Tạo issue trên GitHub repo nhom/ati', memory: {} as any }, false)).toBe(false);
    });
  });

  describe('2. createGitHubConnectionLookup', () => {
    it('returns connected with intersection of teamRepos and caller member repos', async () => {
      const config = encryptCredentials(
        { accessToken: 'gho_tok', githubUserId: '1001', login: 'octocat' },
        encryptionKey,
      );
      const lookup = createGitHubConnectionLookup({
        credentialRepo: {
          getPersonalConnectionStatus: vi.fn().mockResolvedValue({ id: 'cred-1', status: 'active', config }),
        } as any,
        teamRepo: {
          get: vi.fn().mockResolvedValue({
            chosenBy: 'admin-1',
            updatedAt: new Date(),
            repos: [
              { repoId: '101', fullName: 'nhom/ati', name: 'ati' },
              { repoId: '102', fullName: 'nhom/secret', name: 'secret' },
            ],
          }),
        } as any,
        encryptionKey,
        tokens: {
          forConnection: vi.fn().mockReturnValue({
            getAccessToken: vi.fn().mockResolvedValue('gho_tok'),
          }),
        } as any,
        client: {
          repositories: vi.fn().mockResolvedValue([
            { id: '101', fullName: 'nhom/ati', name: 'ati', private: true, member: true },
            { id: '102', fullName: 'nhom/secret', name: 'secret', private: true, member: false },
          ]),
        } as any,
      });

      const res = await lookup(userId);
      expect(res.status).toBe('connected');
      expect(res.connection).toEqual({
        credentialId: 'cred-1',
        githubUserId: '1001',
        login: 'octocat',
        repos: ['nhom/ati'],
      });
    });
  });

  describe('3. ChatService: Refusals and plan binding', () => {
    const issueStep = (args: Record<string, any>): PlanResponse['steps'][number] => ({
      id: 'step_1',
      tool: 'github.create_issue',
      description: 'Tạo issue',
      args,
      dependsOn: [],
    });

    it('refuses with unavailableServices and reason containing "Kết nối GitHub" when caller is not connected', async () => {
      const chatService = new ChatService({
        msgRepo: {} as any,
        planner: {} as any,
        eventEmitter: { emit: () => {} },
        githubConnection: async () => ({ status: 'not_connected', teamRepos: [], memberRepos: [] }),
      });

      const plan: PlanResponse = {
        kind: 'plan',
        thinking: 'Tạo issue',
        summary: 'Tạo issue',
        steps: [issueStep({ repo: 'nhom/ati', title: 'Bug' })],
        warnings: [],
      };

      const result = await (chatService as any).bindConnections(plan, userId);
      expect(result.kind).toBe('refusal');
      expect(result.reason).toContain('Kết nối GitHub');
      expect(result.unavailableServices).toEqual([{ id: 'github', name: 'GitHub' }]);
    });

    it('refuses with "Quản trị chưa chọn repository GitHub." when no team scope is chosen', async () => {
      const chatService = new ChatService({
        msgRepo: {} as any,
        planner: {} as any,
        eventEmitter: { emit: () => {} },
        githubConnection: async () => ({ status: 'needs_scope', teamRepos: [], memberRepos: [] }),
      });

      const plan: PlanResponse = {
        kind: 'plan',
        thinking: 'Tạo issue',
        summary: 'Tạo issue',
        steps: [issueStep({ repo: 'nhom/ati', title: 'Bug' })],
        warnings: [],
      };

      const result = await (chatService as any).bindConnections(plan, userId);
      expect(result.kind).toBe('refusal');
      expect(result.reason).toBe('Quản trị chưa chọn repository GitHub.');
    });

    it('refuses with "Bạn cần được cấp quyền vào repository nhom/secret trên GitHub." when caller lacks access to that repo', async () => {
      const chatService = new ChatService({
        msgRepo: {} as any,
        planner: {} as any,
        eventEmitter: { emit: () => {} },
        githubConnection: async () => ({
          status: 'connected',
          connection: {
            credentialId: 'cred-1',
            githubUserId: '1001',
            login: 'octocat',
            repos: ['nhom/ati'],
          },
          teamRepos: [
            { repoId: '101', fullName: 'nhom/ati', name: 'ati' },
            { repoId: '102', fullName: 'nhom/secret', name: 'secret' },
          ],
          memberRepos: [{ repoId: '101', fullName: 'nhom/ati', name: 'ati' }],
        }),
      });

      const plan: PlanResponse = {
        kind: 'plan',
        thinking: 'Tạo issue',
        summary: 'Tạo issue trên nhom/secret',
        steps: [issueStep({ repo: 'nhom/secret', title: 'Secret bug' })],
        warnings: [],
      };

      const result = await (chatService as any).bindConnections(plan, userId);
      expect(result.kind).toBe('refusal');
      expect(result.reason).toBe('Bạn cần được cấp quyền vào repository nhom/secret trên GitHub.');
    });

    it('binds connections.github on valid plan (including $ref to github.search_repos) and hash changes if repos change', async () => {
      const memory = new WorkingMemory();
      memory.setEntity('__observed', {
        repository: [{ id: '101', fullName: 'nhom/ati', name: 'ati' }],
      });

      const chatService = new ChatService({
        msgRepo: {} as any,
        planner: {} as any,
        eventEmitter: { emit: () => {} },
        githubConnection: async () => ({
          status: 'connected',
          connection: {
            credentialId: 'cred-1',
            githubUserId: '1001',
            login: 'octocat',
            repos: ['nhom/ati', 'nhom/web'],
          },
          teamRepos: [
            { repoId: '101', fullName: 'nhom/ati', name: 'ati' },
            { repoId: '102', fullName: 'nhom/web', name: 'web' },
          ],
          memberRepos: [
            { repoId: '101', fullName: 'nhom/ati', name: 'ati' },
            { repoId: '102', fullName: 'nhom/web', name: 'web' },
          ],
        }),
      });

      const plan: PlanResponse = {
        kind: 'plan',
        thinking: 'Tìm repo rồi tạo issue',
        summary: 'Tạo issue trên nhom/ati',
        steps: [
          {
            id: 's1',
            tool: 'github.search_repos',
            description: 'Tìm repo ati',
            args: { query: 'ati' },
            dependsOn: [],
          },
          {
            id: 's2',
            tool: 'github.create_issue',
            description: 'Tạo issue',
            args: { repo: { $ref: 's1.output[0].fullName' }, title: 'Bug' },
            dependsOn: ['s1'],
          },
        ],
        warnings: [],
      };

      const result = await (chatService as any).bindConnections(plan, userId, undefined, memory);
      expect(result.kind).toBe('plan');
      expect((result as any).steps[1].repo).toBe('nhom/ati');
      expect((result as any).connections?.github).toEqual({
        credentialId: 'cred-1',
        githubUserId: '1001',
        login: 'octocat',
        repos: ['nhom/ati', 'nhom/web'],
      });

      const planA = {
        ...result,
        connections: {
          github: { credentialId: 'cred-1', githubUserId: '1001', login: 'octocat', repos: ['nhom/ati'] },
        },
      };
      const planB = {
        ...result,
        connections: {
          github: { credentialId: 'cred-1', githubUserId: '1001', login: 'octocat', repos: ['nhom/ati', 'nhom/web'] },
        },
      };
      const hashA = createHash('sha256').update(JSON.stringify(planA)).digest('hex');
      const hashB = createHash('sha256').update(JSON.stringify(planB)).digest('hex');
      expect(hashA).not.toBe(hashB);
    });
  });

  describe('4. AdapterFactory: Execution guards', () => {
    const mockOAuthClient = {
      repositories: vi.fn(),
    };
    const mockTokens = {
      forConnection: vi.fn().mockReturnValue({
        getAccessToken: vi.fn().mockResolvedValue('gho_live_token'),
      }),
      clear: vi.fn(),
    };

    it('throws AUTH_ERROR and does not call OAuth client if plan credentialId differs from active credential', async () => {
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
        githubTokens: mockTokens as any,
        githubOAuthClient: mockOAuthClient as any,
      });

      const context = {
        userId,
        phase: 'execution' as const,
        connections: {
          github: {
            credentialId: 'cred-old-in-plan',
            githubUserId: '1001',
            login: 'octocat',
            repos: ['nhom/ati'],
          },
        },
      };

      await expect(factory.getAdapterForService('github', context)).rejects.toMatchObject({
        category: 'AUTH_ERROR',
        message: 'Kết nối GitHub đã thay đổi, hãy lập lại kế hoạch.',
      });
      expect(mockOAuthClient.repositories).not.toHaveBeenCalled();
    });

    it('throws AUTH_ERROR before HTTP if all repos in plan hash were removed from team scope', async () => {
      const mockCredRepo = {
        getPersonalCredentials: vi.fn().mockResolvedValue({
          id: 'cred-1',
          status: 'active',
          config: encryptCredentials({ accessToken: 'gho_1', githubUserId: '1001', login: 'octocat' }, encryptionKey),
        }),
      };
      const mockTeamRepo = {
        get: vi.fn().mockResolvedValue({
          chosenBy: 'admin-1',
          updatedAt: new Date(),
          repos: [{ repoId: '102', fullName: 'nhom/other', name: 'other' }],
        }),
      };

      const factory = new AdapterFactory({
        credentialRepo: mockCredRepo as any,
        encryptionKey,
        githubTokens: mockTokens as any,
        githubOAuthClient: mockOAuthClient as any,
        githubTeamRepo: mockTeamRepo as any,
      });

      const context = {
        userId,
        phase: 'execution' as const,
        connections: {
          github: {
            credentialId: 'cred-1',
            githubUserId: '1001',
            login: 'octocat',
            repos: ['nhom/ati'],
          },
        },
      };

      await expect(factory.getAdapterForService('github', context)).rejects.toMatchObject({
        category: 'AUTH_ERROR',
      });
      expect(mockOAuthClient.repositories).not.toHaveBeenCalled();
    });

    it('throws AUTH_ERROR before HTTP if executor lost access to the repo on GitHub', async () => {
      const mockCredRepo = {
        getPersonalCredentials: vi.fn().mockResolvedValue({
          id: 'cred-1',
          status: 'active',
          config: encryptCredentials({ accessToken: 'gho_1', githubUserId: '1001', login: 'octocat' }, encryptionKey),
        }),
      };
      const mockTeamRepo = {
        get: vi.fn().mockResolvedValue({
          chosenBy: 'admin-1',
          updatedAt: new Date(),
          repos: [{ repoId: '101', fullName: 'nhom/ati', name: 'ati' }],
        }),
      };
      mockOAuthClient.repositories.mockResolvedValueOnce([
        { id: '101', fullName: 'nhom/ati', name: 'ati', private: true, member: false },
      ]);

      const factory = new AdapterFactory({
        credentialRepo: mockCredRepo as any,
        encryptionKey,
        githubTokens: mockTokens as any,
        githubOAuthClient: mockOAuthClient as any,
        githubTeamRepo: mockTeamRepo as any,
      });

      const context = {
        userId,
        phase: 'execution' as const,
        connections: {
          github: {
            credentialId: 'cred-1',
            githubUserId: '1001',
            login: 'octocat',
            repos: ['nhom/ati'],
          },
        },
      };

      await expect(factory.getAdapterForService('github', context)).rejects.toMatchObject({
        category: 'AUTH_ERROR',
      });
    });

    it('creates adapter with accessToken, allowedRepos intersection, and baseUrl when caller is valid', async () => {
      const mockCredRepo = {
        getPersonalCredentials: vi.fn().mockResolvedValue({
          id: 'cred-1',
          status: 'active',
          config: encryptCredentials({ accessToken: 'gho_1', githubUserId: '1001', login: 'octocat' }, encryptionKey),
        }),
      };
      const mockTeamRepo = {
        get: vi.fn().mockResolvedValue({
          chosenBy: 'admin-1',
          updatedAt: new Date(),
          repos: [
            { repoId: '101', fullName: 'nhom/ati', name: 'ati' },
            { repoId: '102', fullName: 'nhom/web', name: 'web' },
          ],
        }),
      };
      mockOAuthClient.repositories.mockResolvedValueOnce([
        { id: '101', fullName: 'nhom/ati', name: 'ati', private: true, member: true },
        { id: '102', fullName: 'nhom/web', name: 'web', private: true, member: true },
      ]);

      let createdWith: any;
      const factory = new AdapterFactory({
        credentialRepo: mockCredRepo as any,
        encryptionKey,
        githubTokens: mockTokens as any,
        githubOAuthClient: mockOAuthClient as any,
        githubTeamRepo: mockTeamRepo as any,
        githubApiBaseUrl: 'http://127.0.0.1:9999',
        createGitHubAdapter: (input) => {
          createdWith = input;
          return { execute: vi.fn() } as any;
        },
      });

      const context = {
        userId,
        phase: 'execution' as const,
        connections: {
          github: {
            credentialId: 'cred-1',
            githubUserId: '1001',
            login: 'octocat',
            repos: ['nhom/ati'],
          },
        },
      };

      const adapter = await factory.getAdapterForService('github', context);
      expect(adapter).toBeDefined();
      expect(createdWith).toEqual({
        userId,
        accessToken: 'gho_live_token',
        allowedRepos: ['nhom/ati'],
      });
    });
  });

  describe('5. resourceLabels: map repo from teamRepos', () => {
    it('maps repo in GitHub step from teamRepos when provided', () => {
      const memory = new WorkingMemory();
      const plan: PlanResponse = {
        kind: 'plan',
        thinking: '',
        summary: '',
        steps: [
          {
            id: 's1',
            tool: 'github.create_issue',
            description: 'Tạo issue',
            args: { repo: 'nhom/ati', title: 'Lỗi' },
            dependsOn: [],
          },
        ],
        warnings: [],
      };

      const labels = resourceLabels(plan, memory, [], {
        teamRepos: [{ repoId: '101', fullName: 'nhom/ati', name: 'ati' }],
      });
      expect(labels['nhom/ati']).toBe('nhom/ati');
    });
  });

  describe('6. Audit fixes & extended GitHub capabilities (Gói A + Gói B)', () => {
    it('getToolCatalogFor fallback branch calls githubTeamRepo.repos() and filters by member !== false', async () => {
      const mockRepo = {
        getCredentials: vi.fn().mockResolvedValue(null),
        getPersonalCredentials: vi.fn().mockResolvedValue({
          id: 'cred-1',
          status: 'active',
          config: encryptCredentials(
            { accessToken: 'gho_123', githubUserId: '1001', login: 'octocat' },
            encryptionKey
          ),
        }),
      };
      const mockTeamRepo = {
        repos: vi.fn().mockResolvedValue([
          { repoId: '101', fullName: 'nhom/ati', name: 'ati' },
          { repoId: '102', fullName: 'nhom/forbidden', name: 'forbidden' },
        ]),
      };
      const mockOAuthClient = {
        repositories: vi.fn().mockResolvedValue([
          { id: '101', fullName: 'nhom/ati', name: 'ati', private: true, member: true },
          { id: '102', fullName: 'nhom/forbidden', name: 'forbidden', private: true, member: false },
        ]),
      };
      const mockTokens = {
        forConnection: vi.fn().mockReturnValue({
          getAccessToken: vi.fn().mockResolvedValue('gho_live'),
        }),
      };

      const catalog = await getToolCatalogFor(mockRepo as any, encryptionKey, {
        userId,
        gmailEnabled: false,
        githubTeamRepo: mockTeamRepo as any,
        githubOAuthClient: mockOAuthClient as any,
        githubTokens: mockTokens as any,
      });

      expect(mockTeamRepo.repos).toHaveBeenCalledTimes(1);
      expect(mockTokens.forConnection).toHaveBeenCalledWith(
        userId,
        'cred-1',
        expect.objectContaining({ accessToken: 'gho_123' })
      );
      expect(catalog.some((t) => t.service === 'github')).toBe(true);
    });

    it('bindConnections normalizes short repo name into full owner/repo in step.args.repo and defaults single repo', async () => {
      const chatService = new ChatService({
        msgRepo: {} as any,
        planner: {} as any,
        eventEmitter: { emit: () => {} },
        githubConnection: async () => ({
          status: 'connected',
          connection: {
            credentialId: 'cred-1',
            githubUserId: '1001',
            login: 'octocat',
            repos: ['nhom/ati'],
          },
          teamRepos: [{ repoId: '101', fullName: 'nhom/ati', name: 'ati' }],
          memberRepos: [{ repoId: '101', fullName: 'nhom/ati', name: 'ati' }],
        }),
      });

      const plan: PlanResponse = {
        kind: 'plan',
        thinking: 'Create and close issue',
        summary: 'Tạo và đóng issue',
        steps: [
          {
            id: 's1',
            tool: 'github.create_issue',
            description: 'Tạo issue dùng short repo name',
            args: { repo: 'ati', title: 'Lỗi login' },
            dependsOn: [],
          },
          {
            id: 's2',
            tool: 'github.update_issue',
            description: 'Đóng issue khi user chỉ có 1 repo và LLM thiếu args.repo',
            args: { issueNumber: 7, state: 'closed' },
            dependsOn: ['s1'],
          },
        ],
        warnings: [],
      };

      const result = await (chatService as any).bindConnections(plan, userId);
      expect(result.kind).toBe('plan');
      expect(result.steps[0].repo).toBe('nhom/ati');
      expect(result.steps[0].args.repo).toBe('nhom/ati');
      expect(result.steps[1].repo).toBe('nhom/ati');
      expect(result.steps[1].args.repo).toBe('nhom/ati');
    });

    it('AdapterFactory rejects execution when step context.repo was removed from team scope even if another repo remains', async () => {
      const mockCredRepo = {
        getPersonalCredentials: vi.fn().mockResolvedValue({
          id: 'cred-1',
          status: 'active',
          config: encryptCredentials({ accessToken: 'gho_1', githubUserId: '1001', login: 'octocat' }, encryptionKey),
        }),
      };
      const mockTeamRepo = {
        get: vi.fn().mockResolvedValue({
          chosenBy: 'admin-1',
          updatedAt: new Date(),
          repos: [{ repoId: '102', fullName: 'nhom/web', name: 'web' }],
        }),
      };
      const mockOAuthClient = {
        repositories: vi.fn().mockResolvedValue([
          { id: '102', fullName: 'nhom/web', name: 'web', private: true, member: true },
        ]),
      };
      const mockTokens = {
        forConnection: vi.fn().mockReturnValue({
          getAccessToken: vi.fn().mockResolvedValue('gho_live_token'),
        }),
      };

      const factory = new AdapterFactory({
        credentialRepo: mockCredRepo as any,
        encryptionKey,
        githubTokens: mockTokens as any,
        githubOAuthClient: mockOAuthClient as any,
        githubTeamRepo: mockTeamRepo as any,
      });

      await expect(
        factory.getAdapterForService('github', {
          userId,
          phase: 'execution',
          repo: 'nhom/ati',
          connections: {
            github: {
              credentialId: 'cred-1',
              githubUserId: '1001',
              login: 'octocat',
              repos: ['nhom/ati', 'nhom/web'],
            },
          },
        })
      ).rejects.toMatchObject({
        category: 'AUTH_ERROR',
        message: 'Repository GitHub trong kế hoạch đã bị bỏ khỏi phạm vi nhóm.',
      });
    });

    it('sandbox GITHUB_FAKE matches outputSchema for all GitHub tools', async () => {
      const { GITHUB_FAKE } = await import('../../src/sandbox/fake-results/github.js');
      const addLabelOut = GITHUB_FAKE.tools['github.add_label']!({ repo: 'nhom/ati', issueNumber: 9, label: 'bug' });
      expect(addLabelOut).toMatchObject({
        number: 9,
        labels: ['bug'],
        repo: 'nhom/ati',
      });

      const searchIssuesOut = GITHUB_FAKE.tools['github.search_issues']!({ repo: 'nhom/ati', query: 'bug' }) as any[];
      expect(searchIssuesOut[0]).toMatchObject({
        repo: 'nhom/ati',
        number: expect.any(Number),
      });

      const updateIssueOut = GITHUB_FAKE.tools['github.update_issue']!({
        repo: 'nhom/ati',
        issueNumber: 9,
        state: 'closed',
        assignees: ['octocat'],
      });
      expect(updateIssueOut).toMatchObject({
        number: 9,
        repo: 'nhom/ati',
        state: 'closed',
        assignees: ['octocat'],
      });

      const commentOut = GITHUB_FAKE.tools['github.add_comment']!({
        repo: 'nhom/ati',
        issueNumber: 9,
        body: 'LGTM',
      });
      expect(commentOut).toMatchObject({
        issueNumber: 9,
        body: 'LGTM',
        repo: 'nhom/ati',
      });
    });
  });
});
