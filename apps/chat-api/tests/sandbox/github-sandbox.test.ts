import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSandboxAdapter } from '../../src/sandbox/index.js';
import { AdapterFactory } from '../../src/services/adapter-factory.js';
import { createToolRuntimeFactory } from '../../src/config/gmail-tools-runtime.js';
import { GITHUB_FAKE } from '../../src/sandbox/fake-results/github.js';
import { StepError, encryptCredentials } from '@wap/tool-adapters';

describe('Task 10: GitHub sandbox and personal connection enforcement', () => {
  const key = 'test-encryption-key-must-be-32-bytes!';
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (info: any) => {
      const url = typeof info === 'string' ? info : info?.url || '';
      if (url.includes('api.github.com') || url.includes('github.com')) {
        throw new Error(`Real network call to GitHub was attempted: ${url}`);
      }
      return new Response('{}', { status: 200 });
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('GITHUB_FAKE implements fake results for all 5 GitHub tools', async () => {
    const fiveTools = [
      'github.search_repos',
      'github.search_issues',
      'github.get_issue',
      'github.create_issue',
      'github.add_label',
    ];

    for (const tool of fiveTools) {
      expect(typeof GITHUB_FAKE.tools[tool], `Expected handler for ${tool}`).toBe('function');
    }

    const adapter = createSandboxAdapter('github');
    const created = await adapter.execute('github.create_issue', {
      repo: 'owner/repo',
      title: 'Fix Bug',
      body: 'Bug details',
    });
    expect(created).toMatchObject({
      title: 'Fix Bug',
      repo: 'owner/repo',
      url: expect.stringContaining('github.com/owner/repo/issues/'),
    });
    expect(created.id).toBeDefined();

    const openIssues = await adapter.execute('github.search_issues', {
      repo: 'owner/repo',
      query: 'is:issue is:open',
    });
    expect(Array.isArray(openIssues)).toBe(true);
    expect(openIssues.length).toBeGreaterThan(0);

    const stalePrs = await adapter.execute('github.search_issues', {
      repo: 'owner/repo',
      query: 'is:pr is:open created:<=2026-10-30',
    });
    expect(Array.isArray(stalePrs)).toBe(true);
    expect(stalePrs[0]).toMatchObject({
      state: 'open',
      url: expect.stringContaining('github.com/owner/repo/pull/'),
    });

    for (const call of fetchSpy.mock.calls) {
      const url = String(call[0]);
      expect(url).not.toContain('api.github.com');
      expect(url).not.toContain('github.com');
    }
  });

  it('in sandbox mode, execution with valid connection returns fake result without calling api.github.com and enforces allowedRepos on ctx.repo ?? args.repo', async () => {
    const userId = 'user-github-1';
    const credentialId = 'cred-github-1';
    const repo = 'acme/ati';

    const credRepo: any = {
      getPersonalCredentials: vi.fn().mockResolvedValue({
        id: credentialId,
        service: 'github',
        userId,
        status: 'active',
        config: encryptCredentials(
          {
            accessToken: 'fake-access-token',
            githubUserId: 'gh-1',
            login: 'octo',
            repos: [{ repoId: '101', fullName: repo, name: 'ati' }],
          },
          key
        ),
      }),
      getCredentials: vi.fn().mockResolvedValue(null),
    };

    const githubTeamRepo: any = {
      get: vi.fn().mockResolvedValue({
        repos: [{ repoId: '101', fullName: repo, name: 'ati' }],
      }),
    };

    const githubTokens: any = {
      forConnection: vi.fn().mockReturnValue({
        getAccessToken: vi.fn().mockResolvedValue('fake-access-token'),
      }),
    };

    const realFactory = new AdapterFactory({
      credentialRepo: credRepo,
      encryptionKey: key,
      githubTokens,
      githubTeamRepo,
      createGitHubAdapter: ({ allowedRepos }) => {
        const sandbox = createSandboxAdapter('github');
        const allowedLower = new Set(allowedRepos.map((r) => r.toLowerCase()));
        return {
          execute: async (tool, args, ctx) => {
            const targetRepo = ctx?.repo ?? args?.repo;
            if (targetRepo && !allowedLower.has(String(targetRepo).toLowerCase())) {
              throw new StepError({
                category: 'AUTH_ERROR',
                message: 'Repository không nằm trong phạm vi được phép.',
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

    const adapter = await factory.getAdapterForService('github', {
      userId,
      phase: 'execution',
      connections: {
        github: {
          credentialId,
          githubUserId: 'gh-1',
          login: 'octo',
          repos: [repo],
        },
      },
    });

    const result = await adapter.execute('github.create_issue', {
      repo,
      title: 'Fix Bug in Sandbox',
    });

    expect(result).toMatchObject({
      title: 'Fix Bug in Sandbox',
      repo,
      url: expect.stringContaining('github.com/acme/ati/issues/'),
    });

    for (const call of fetchSpy.mock.calls) {
      const url = String(call[0]);
      expect(url).not.toContain('api.github.com');
    }

    await expect(
      adapter.execute('github.create_issue', { repo: 'acme/forbidden', title: 'X' })
    ).rejects.toMatchObject({
      category: 'AUTH_ERROR',
    });

    await expect(
      adapter.execute('github.create_issue', { repo, title: 'X' }, { repo: 'acme/forbidden' })
    ).rejects.toMatchObject({
      category: 'AUTH_ERROR',
    });
  });

  it('in sandbox mode, execution without connection fails with AUTH_ERROR and does not fall back to shared token', async () => {
    const credRepo: any = {
      getPersonalCredentials: vi.fn().mockResolvedValue(null),
      getCredentials: vi.fn().mockResolvedValue({
        service: 'github',
        config: encryptCredentials({ token: 'shared-pat', allowedScope: { repos: ['acme/ati'] } }, key),
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
      factory.getAdapterForService('github', {
        userId: 'user-no-connection',
        phase: 'execution',
      })
    ).rejects.toMatchObject({
      category: 'AUTH_ERROR',
    });
  });
});
