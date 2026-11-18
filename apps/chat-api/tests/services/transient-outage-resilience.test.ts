import { describe, expect, it, vi } from 'vitest';
import { encryptCredentials, StepError } from '@wap/tool-adapters';
import { computeDigestConfigHash } from '../../src/services/schedules/github-digest-candidate.js';
import { computeJiraDigestConfigHash } from '../../src/services/schedules/jira-digest-candidate.js';
import { computeNotionDigestConfigHash } from '../../src/services/schedules/notion-digest-candidate.js';
import { computeTrelloDigestConfigHash } from '../../src/services/schedules/trello-digest-candidate.js';
import { createGitHubConnectionLookup } from '../../src/services/github/connection-reference.js';
import { GitHubOAuthError } from '../../src/services/github/oauth-client.js';
import { createTelegramConnectionLookup } from '../../src/services/telegram/connection-reference.js';
import { TelegramBotError } from '../../src/services/telegram/bot-client.js';
import { ChatService } from '../../src/services/chat-service.js';
import { createGithubDigestRunner } from '../../src/services/schedules/github-digest-runner.js';
import { createTrelloDigestRunner } from '../../src/services/schedules/trello-digest-runner.js';
import { createNotionDigestRunner } from '../../src/services/schedules/notion-digest-runner.js';
import { runJiraDigest } from '../../src/services/schedules/jira-digest-runner.js';

const encKey = '0123456789abcdef0123456789abcdef';

describe('Transient provider outage resilience across GitHub, Telegram, ChatService & Digest Runners (Task 5)', () => {
  it('createGitHubConnectionLookup returns status=unavailable (not reconnect_required) on 502/network errors', async () => {
    const markReconnectRequired = vi.fn().mockResolvedValue(true);
    const credConfig = encryptCredentials(
      { accessToken: 'ghu_valid', refreshToken: 'ghr_valid', githubUserId: '100', login: 'octo' },
      encKey,
    );

    const lookup = createGitHubConnectionLookup({
      credentialRepo: {
        getPersonalConnectionStatus: vi.fn().mockResolvedValue({ id: 'cred-gh-1', status: 'active', config: credConfig }),
        markReconnectRequired,
      } as any,
      teamRepo: {
        get: vi.fn().mockResolvedValue({
          chosenBy: 'u1',
          updatedAt: new Date(),
          repos: [{ repoId: '1', fullName: 'org/app', name: 'app' }],
        }),
      } as any,
      encryptionKey: encKey,
      tokens: {
        forConnection: vi.fn().mockReturnValue({ getAccessToken: vi.fn().mockResolvedValue('ghu_valid') }),
      } as any,
      client: {
        repos: vi.fn().mockRejectedValue(new GitHubOAuthError('server', 502)),
      } as any,
    });

    const result = await lookup('u1');
    expect(result.status).toBe('unavailable');
    expect(markReconnectRequired).not.toHaveBeenCalled();
  });

  it('createTelegramConnectionLookup distinguishes transient 5xx/network outages from non-membership', async () => {
    const tgConfig = encryptCredentials(
      {
        telegramUserId: '10001',
        username: 'tguser',
        displayName: 'TG User',
        selectedChats: [{ chatId: '-100999', title: 'Team Chat', type: 'supergroup' }],
      },
      encKey,
    );

    const lookupOnlyGroupDown = createTelegramConnectionLookup({
      credentialRepo: {
        getPersonalConnectionStatus: vi.fn().mockResolvedValue({ id: 'cred-tg-1', status: 'active', config: tgConfig }),
      } as any,
      encryptionKey: encKey,
      botClient: {
        getChatMember: vi.fn().mockRejectedValue(new TelegramBotError('server', 502)),
      },
    });

    const res1 = await lookupOnlyGroupDown('u1');
    expect(res1.status).toBe('unavailable');
    expect(res1.unavailableChatIds).toEqual(['-100999']);

    const mixedConfig = encryptCredentials(
      {
        telegramUserId: '10001',
        username: 'tguser',
        displayName: 'TG User',
        selectedChats: [
          { chatId: '10001', title: 'Personal', type: 'private' },
          { chatId: '-100999', title: 'Team Chat', type: 'supergroup' },
        ],
      },
      encKey,
    );

    const lookupPartial = createTelegramConnectionLookup({
      credentialRepo: {
        getPersonalConnectionStatus: vi.fn().mockResolvedValue({ id: 'cred-tg-1', status: 'active', config: mixedConfig }),
      } as any,
      encryptionKey: encKey,
      botClient: {
        getChatMember: vi.fn().mockRejectedValue(new TelegramBotError('network')),
      },
    });

    const res2 = await lookupPartial('u1');
    expect(res2.status).toBe('connected');
    expect(res2.connection?.chatIds).toEqual(['10001']);
    expect(res2.unavailableChatIds).toEqual(['-100999']);
  });

  it('ChatService returns temporary unavailability refusal (not reconnect_required) for GitHub and Telegram outages', async () => {
    const ghChat = new ChatService({
      msgRepo: {} as any,
      planner: {} as any,
      eventEmitter: { emit: () => {} },
      githubConnection: async () => ({ status: 'unavailable' as const, teamRepos: [], memberRepos: [] }),
    });

    const ghRefusal = await (ghChat as any).bindConnections(
      {
        kind: 'plan',
        thinking: 't',
        summary: 's',
        warnings: [],
        steps: [{ id: 's1', tool: 'github.search_issues', description: 'd', args: { repo: 'a/b', query: 'is:open' }, dependsOn: [] }],
      },
      'u1',
    );
    expect(ghRefusal).toMatchObject({
      kind: 'refusal',
      reason: expect.stringContaining('GitHub tạm thời không phản hồi'),
    });

    const tgChat = new ChatService({
      msgRepo: {} as any,
      planner: {} as any,
      eventEmitter: { emit: () => {} },
      telegramConnection: async () => ({ status: 'unavailable' as const, selectedChats: [] }),
    });

    const tgRefusal = await (tgChat as any).bindConnections(
      {
        kind: 'plan',
        thinking: 't',
        summary: 's',
        warnings: [],
        steps: [{ id: 's1', tool: 'telegram.send_message', description: 'd', args: { chatId: '-100999', text: 'hi' }, dependsOn: [] }],
      },
      'u1',
    );
    expect(tgRefusal).toMatchObject({
      kind: 'refusal',
      reason: expect.stringContaining('Telegram tạm thời không phản hồi'),
    });
  });

  it('keeps github_digest, trello_digest, and notion_digest active (digest_failed, not blocked) on transient destination/source outages', async () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    const recurrence = { type: 'daily' as const, time: '08:30' };

    // 1. GitHub digest: githubConnection status=unavailable -> digest_failed
    const ghConfig = {
      credentialId: 'gh-cred',
      githubUserId: '100',
      login: 'octo',
      repos: ['org/repo'],
      channelId: 'C1',
      channelName: 'dev',
      staleDays: 2,
    };
    const ghRunner = createGithubDigestRunner({
      pool: {} as any,
      githubConnection: async () => ({ status: 'unavailable', teamRepos: [], memberRepos: [] }),
      getAdapter: vi.fn(),
    });
    const ghOutcome = await ghRunner(
      {
        runId: 'r1',
        scheduleId: 's1',
        scheduleVersion: 1,
        userId,
        name: 'GH',
        request: 'gh digest',
        dueAt: new Date('2026-11-18T01:30:00Z'),
        trigger: 'scheduled',
        recurrence,
        digestConfig: ghConfig,
        digestConfigHash: computeDigestConfigHash({ config: ghConfig, recurrence, userId }),
      },
      'c1',
      new AbortController().signal,
    );
    expect(ghOutcome.state).toBe('digest_failed');

    // 2. GitHub digest -> Telegram destination transiently unavailable -> digest_failed
    const ghTgConfig = {
      ...ghConfig,
      channelId: '',
      channelName: '',
      telegramChatId: '-100999',
      telegramChatTitle: 'Team',
      telegramCredentialId: 'tg-cred',
    };
    const ghTgRunner = createGithubDigestRunner({
      pool: { query: vi.fn().mockResolvedValue({ rowCount: 0, rows: [] }) } as any,
      githubConnection: async () => ({
        status: 'connected',
        connection: { credentialId: 'gh-cred', githubUserId: '100', login: 'octo', repos: ['org/repo'] },
      }),
      telegramConnection: async () => ({
        status: 'connected',
        connection: { credentialId: 'tg-cred', telegramUserId: '100', username: 'u', chatIds: ['100'] },
        unavailableChatIds: ['-100999'],
      }),
      getAdapter: async (serviceName) =>
        serviceName === 'github'
          ? { execute: async () => [] }
          : { execute: vi.fn() },
    });
    const ghTgOutcome = await ghTgRunner(
      {
        runId: 'r2',
        scheduleId: 's2',
        scheduleVersion: 1,
        userId,
        name: 'GH TG',
        request: 'gh tg digest',
        dueAt: new Date('2026-11-18T01:30:00Z'),
        trigger: 'scheduled',
        recurrence,
        digestConfig: ghTgConfig,
        digestConfigHash: computeDigestConfigHash({ config: ghTgConfig, recurrence, userId }),
      },
      'c2',
      new AbortController().signal,
    );
    expect(ghTgOutcome.state).toBe('digest_failed');

    // 3. Trello digest -> Telegram target group transiently unavailable -> digest_failed
    const trConfig = {
      credentialId: 'tr-cred',
      trelloMemberId: 'm1',
      username: 'alice',
      boards: [{ id: 'b1', name: 'Board' }],
      channelId: '',
      channelName: '',
      dueSoonHours: 24,
      destination: 'telegram' as const,
      telegramChatId: '-100999',
      telegramChatTitle: 'Team',
      telegramCredentialId: 'tg-cred',
    };
    const trRunner = createTrelloDigestRunner({
      pool: {} as any,
      trelloConnection: async () => ({
        status: 'connected',
        connection: { credentialId: 'tr-cred', memberId: 'm1', username: 'alice', boardIds: ['b1'] },
      }),
      telegramConnection: async () => ({
        status: 'connected',
        connection: { credentialId: 'tg-cred', telegramUserId: '100', username: 'u', chatIds: ['100'] },
        unavailableChatIds: ['-100999'],
      }),
      getAdapter: async () => ({ execute: vi.fn().mockResolvedValue([]) }),
    });
    const trOutcome = await trRunner(
      {
        runId: 'r3',
        scheduleId: 's3',
        scheduleVersion: 1,
        userId,
        name: 'Trello TG',
        request: 'trello tg digest',
        dueAt: new Date('2026-11-18T01:30:00Z'),
        trigger: 'scheduled',
        recurrence,
        digestConfig: trConfig,
        digestConfigHash: computeTrelloDigestConfigHash({ config: trConfig, recurrence, userId }),
      },
      'c3',
      new AbortController().signal,
    );
    expect(trOutcome.state).toBe('digest_failed');

    // 4. Notion digest -> Slack channel search fails with transient 503 -> digest_failed (not blocked)
    const notionBinding = {
      version: 1 as const,
      ownerId: userId,
      credentialId: 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee',
      workspaceId: 'ws-notion-1',
      workspaceName: 'ATI Notion',
      appId: 'notion-app',
      actorId: 'actor-1',
      botId: 'bot-1',
      identityVersion: 1,
      databases: [{ databaseId: 'aabbccdd-1122-3344-5566-77889900aabb', dataSourceId: 'ffffffff-6666-4666-8666-ffffffffffff', title: 'Sprint' }],
    };
    const notionConfig = {
      notionBinding,
      credentialId: notionBinding.credentialId,
      workspaceId: 'ws-notion-1',
      workspaceName: 'ATI Notion',
      botId: 'bot-1',
      identityVersion: 1,
      databases: [{ id: 'aabbccdd-1122-3344-5566-77889900aabb', title: 'Sprint' }],
      channelId: 'C_DEV',
      channelName: 'dev',
    };
    const notionRunner = createNotionDigestRunner({
      pool: { query: vi.fn() } as any,
      notionSources: {
        read: vi.fn(),
        withSource: vi.fn(),
      } as any,
      getAdapter: async (serviceName) => {
        if (serviceName === 'slack') {
          return {
            execute: vi.fn().mockRejectedValue(
              new StepError({ category: 'SERVER_ERROR', statusCode: 503, retryable: true, message: 'Slack 503' }),
            ),
          };
        }
        return null;
      },
    });
    const notionOutcome = await notionRunner(
      {
        runId: 'r4',
        scheduleId: 's4',
        scheduleVersion: 1,
        userId,
        name: 'Notion',
        request: 'notion digest',
        dueAt: new Date('2026-11-18T01:30:00Z'),
        trigger: 'scheduled',
        recurrence,
        digestConfig: notionConfig,
        digestConfigHash: computeNotionDigestConfigHash({ config: notionConfig, recurrence, userId }),
      },
      'c4',
      new AbortController().signal,
    );
    expect(notionOutcome.state).toBe('digest_failed');
  });

  it('runJiraDigest forwards workspaceId, connections.telegram, and chatId context when sending to Telegram', async () => {
    const config = {
      workspaceId: 'ws-jira-1',
      grantId: 'grant-1',
      atlassianAccountId: 'acc-1',
      projects: [{ siteId: 'site-1', siteName: 'Acme', projectKey: 'ATI' }],
      channelId: '',
      channelName: '',
      destination: 'telegram' as const,
      telegramChatId: '-100888777',
      telegramCredentialId: 'tg-cred-1',
    };
    const tgExecute = vi.fn().mockResolvedValue({ messageId: 11 });
    const getAdapter = vi.fn(async (serviceName: string) => {
      if (serviceName === 'myjira') return { execute: vi.fn().mockResolvedValue([]) };
      if (serviceName === 'telegram') return { execute: tgExecute };
      return null;
    });

    const outcome = await runJiraDigest({
      userId: 'u-jira',
      recurrence: { type: 'daily', time: '08:30' },
      digestConfig: config as any,
      digestConfigHash: computeJiraDigestConfigHash({
        config: config as any,
        recurrence: { type: 'daily', time: '08:30' },
        userId: 'u-jira',
      }),
      revalidatePolicy: async () => ({ allowed: true }),
      getAdapter,
    });

    expect(outcome.state).toBe('digest_sent');
    expect(getAdapter).toHaveBeenCalledWith('telegram', {
      userId: 'u-jira',
      phase: 'execution',
      workspaceId: 'ws-jira-1',
      workspaceMode: 'organization',
      connections: {
        telegram: {
          credentialId: 'tg-cred-1',
          telegramUserId: '',
          username: '',
          chatIds: ['-100888777'],
        },
      },
    });
    expect(tgExecute).toHaveBeenCalledWith(
      'telegram.send_message',
      expect.objectContaining({ chatId: '-100888777' }),
      { signal: undefined, chatId: '-100888777' },
    );
  });
});
