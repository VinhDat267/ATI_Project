import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import type { ScheduleRecurrence, TrelloDigestConfig } from '@wap/tool-schemas';
import {
  buildSlackDigestBlocks,
  buildSlackMarkdownDigestBlocks,
  SLACK_MAX_BLOCKS,
  SLACK_SECTION_MAX_CHARS,
} from '../../../src/services/slack/slack-digest-blocks.js';
import {
  buildSlackMentionIndex,
  fetchSlackMentionIndexSafe,
  formatAssigneeForSlack,
  resolveSlackUserId,
} from '../../../src/services/slack/slack-mention-resolver.js';
import { createTrelloDigestRunner } from '../../../src/services/schedules/trello-digest-runner.js';
import { computeTrelloDigestConfigHash } from '../../../src/services/schedules/trello-digest-candidate.js';
import { createJiraDigestExecutor, runJiraDigest } from '../../../src/services/schedules/jira-digest-runner.js';
import { computeJiraDigestConfigHash, type JiraDigestConfig } from '../../../src/services/schedules/jira-digest-candidate.js';

describe('Slack Block Kit & Safe Mention Resolution', () => {
  it('builds valid Block Kit payloads within Slack hard limits (50 blocks, 150 header, 3000 section, https-only actions)', () => {
    const longLines = Array.from({ length: 80 }, (_, idx) => `• Mục số ${idx + 1}: ${'x'.repeat(90)}`).join('\n');
    const blocks = buildSlackDigestBlocks({
      headerTitle: `Bản tin rất dài ${'A'.repeat(200)}`,
      subtitle: 'Tóm tắt hàng ngày',
      sections: [
        { heading: '*Phần 1*', body: longLines },
        ...Array.from({ length: 55 }, (_, i) => ({ heading: `*Nhóm ${i}*`, body: `Nội dung ${i}` })),
      ],
      footer: 'ℹ️ Đã quét 80 mục',
      actionButton: { label: 'Mở ứng dụng', url: 'https://app.planora.example/dashboard' },
    });

    expect(blocks.length).toBeLessThanOrEqual(SLACK_MAX_BLOCKS);
    const headerBlock = blocks[0] as any;
    expect(headerBlock.type).toBe('header');
    expect(Array.from(headerBlock.text.text).length).toBeLessThanOrEqual(150);

    for (const block of blocks) {
      if ((block as any).type === 'section') {
        expect((block as any).text.text.length).toBeLessThanOrEqual(SLACK_SECTION_MAX_CHARS);
      }
    }

    const actionsBlock = blocks.find((b: any) => b.type === 'actions') as any;
    expect(actionsBlock?.elements?.[0]?.url).toBe('https://app.planora.example/dashboard');

    const unsafeUrlBlocks = buildSlackDigestBlocks({
      headerTitle: 'Safe check',
      sections: [{ body: 'Body' }],
      actionButton: { label: 'Unsafe', url: 'javascript:alert(1)' },
    });
    expect(unsafeUrlBlocks.some((b: any) => b.type === 'actions')).toBe(false);

    const wrapped = buildSlackMarkdownDigestBlocks({
      headerTitle: 'Bản tin Trello',
      messageText: '*Bản tin Trello*\n• *Quá hạn (1):*\n  - Thẻ A\nℹ️ _Đã quét đủ_',
    });
    expect(wrapped[0]).toMatchObject({ type: 'header' });
    expect(wrapped.at(-1)).toMatchObject({ type: 'context' });
  });

  it('resolves unique emails and names to <@U...>, avoids ambiguous matches, and degrades gracefully on errors', async () => {
    const index = buildSlackMentionIndex([
      { id: 'U01AN001', name: 'an.nguyen', realName: 'Nguyễn Văn An', displayName: 'an', email: 'an1@ati.local' },
      { id: 'U01AN002', name: 'an.tran', realName: 'Nguyễn Văn An', displayName: 'an2', email: 'an2@ati.local' },
      { id: 'U02BINH', name: 'binh', realName: 'Trần Thị Bình', displayName: 'binh', email: 'binh@ati.local' },
      { id: 'U_BAD_INJECT>', name: 'bad', realName: 'Invalid User', displayName: 'bad', email: 'bad@ati.local' },
    ]);

    // Email disambiguates identical real_name
    expect(resolveSlackUserId({ email: 'an1@ati.local', displayName: 'Nguyễn Văn An' }, index)).toBe('U01AN001');
    // Ambiguous displayName without email returns null rather than pinging the wrong person
    expect(resolveSlackUserId({ displayName: 'Nguyễn Văn An' }, index)).toBeNull();
    expect(formatAssigneeForSlack({ displayName: 'Nguyễn Văn An' }, index, (s) => s)).toBe('Nguyễn Văn An');
    // Unique name resolves cleanly
    expect(formatAssigneeForSlack({ displayName: 'Trần Thị Bình' }, index, (s) => s)).toBe('<@U02BINH>');
    // Non-alphanumeric Slack IDs are rejected safely instead of injecting arbitrary <@...> markup
    expect(resolveSlackUserId({ email: 'bad@ati.local' }, index)).toBeNull();

    const failAdapter = {
      execute: vi.fn().mockRejectedValue(new Error('Slack permission denied: missing_scope')),
    };
    const safeNull = await fetchSlackMentionIndexSafe(failAdapter);
    expect(safeNull).toBeNull();
  });

  it('resolves Trello card assignees into <@U...> on Slack delivery when resolveSlackMentions=true and attaches Block Kit blocks, while keeping Telegram clean', async () => {
    const recurrence: ScheduleRecurrence = { type: 'daily', time: '08:00' };
    const slackSent: any[] = [];
    const tgSent: any[] = [];

    const makeMockPool = () =>
      ({
        query: vi.fn().mockResolvedValue({ rows: [{ version: 1, status: 'active' }] }),
      }) as unknown as pg.Pool;

    const getAdapter = (service: string) => {
      if (service === 'trello') {
        return {
          execute: vi.fn().mockImplementation(async (tool: string) => {
            if (tool === 'trello.search_lists') return [];
            if (tool === 'trello.search_members') {
              return [{ id: 'mem-binh', fullName: 'Trần Thị Bình', username: 'binh' }];
            }
            if (tool === 'trello.search_cards') {
              return [
                {
                  id: 'card-1',
                  name: 'Sửa luồng OAuth',
                  url: 'https://trello.com/c/card1',
                  listId: 'l1',
                  boardId: 'b1',
                  due: '2026-10-31T08:00:00.000Z',
                  dueComplete: false,
                  idMembers: ['mem-binh'],
                },
              ];
            }
            return [];
          }),
        };
      }
      if (service === 'slack') {
        return {
          execute: vi.fn().mockImplementation(async (tool: string, args: any) => {
            if (tool === 'slack.search_channels') return [{ id: 'C_DEV', name: 'dev' }];
            if (tool === 'slack.search_users') {
              return [{ id: 'U02BINH', name: 'binh', realName: 'Trần Thị Bình', displayName: 'binh' }];
            }
            if (tool === 'slack.send_message') {
              slackSent.push(args);
              return { ts: '1700000100.000100', channel: args.channel };
            }
            return [];
          }),
        };
      }
      if (service === 'telegram') {
        return {
          execute: vi.fn().mockImplementation(async (_tool: string, args: any) => {
            tgSent.push(args);
            return { messageId: 901 };
          }),
        };
      }
      return null;
    };

    const trelloConnection = vi.fn().mockResolvedValue({
      status: 'connected',
      connection: { credentialId: 'cred-trello-1', boardIds: ['b1'] },
    });

    const trelloSlackConfig: TrelloDigestConfig = {
      credentialId: 'cred-trello-1',
      trelloMemberId: 'mem-owner',
      username: 'owner',
      boards: [{ id: 'b1', name: 'Sprint' }],
      channelId: 'C_DEV',
      channelName: 'dev',
      dueSoonHours: 24,
      destination: 'slack',
    };
    const runner = createTrelloDigestRunner({
      pool: makeMockPool(),
      timeZone: 'Asia/Ho_Chi_Minh',
      trelloConnection,
      getAdapter,
      resolveSlackMentions: true,
    });
    const resSlack = await runner(
      {
        runId: 'run-1',
        scheduleId: 'sched-1',
        scheduleVersion: 1,
        userId: 'user-1',
        name: 'Trello Slack',
        request: 'Trello digest',
        dueAt: new Date('2026-11-02T01:00:00.000Z'),
        trigger: 'scheduled',
        recurrence,
        digestConfig: trelloSlackConfig,
        digestConfigHash: computeTrelloDigestConfigHash({
          config: trelloSlackConfig,
          recurrence,
          userId: 'user-1',
        }),
      },
      'conv-1',
      new AbortController().signal,
    );

    expect(resSlack.state).toBe('digest_sent');
    expect(slackSent).toHaveLength(1);
    expect(slackSent[0].text).toContain('<@U02BINH>');
    expect(Array.isArray(slackSent[0].blocks)).toBe(true);
    expect(slackSent[0].blocks.some((b: any) => b.type === 'section' && String(b.text?.text).includes('<@U02BINH>'))).toBe(true);

    // Telegram destination must NOT query Slack users or emit <@U...>
    const trelloTgConfig: TrelloDigestConfig = {
      ...trelloSlackConfig,
      channelId: '',
      channelName: '',
      destination: 'telegram',
      telegramChatId: '-100555',
      telegramChatTitle: 'Dev Team',
    };
    const resTg = await runner(
      {
        runId: 'run-2',
        scheduleId: 'sched-2',
        scheduleVersion: 1,
        userId: 'user-1',
        name: 'Trello TG',
        request: 'Trello TG',
        dueAt: new Date('2026-11-02T01:00:00.000Z'),
        trigger: 'scheduled',
        recurrence,
        digestConfig: trelloTgConfig,
        digestConfigHash: computeTrelloDigestConfigHash({
          config: trelloTgConfig,
          recurrence,
          userId: 'user-1',
        }),
      },
      'conv-2',
      new AbortController().signal,
    );
    expect(resTg.state).toBe('digest_sent');
    expect(tgSent[0].text).not.toContain('<@U02BINH>');
  });

  it('resolves Jira issue assignees to <@U...> on Slack standup digests and emits Block Kit blocks', async () => {
    const recurrence: ScheduleRecurrence = { type: 'daily', time: '09:00' };
    const jiraConfig: JiraDigestConfig = {
      workspaceId: 'ws-1',
      grantId: 'grant-1',
      atlassianAccountId: 'acc-1',
      projects: [{ siteId: 'site-1', siteName: 'Acme', projectKey: 'ATI', projectName: 'Platform' }],
      channelId: 'C_JIRA',
      channelName: 'jira-alerts',
    };
    const sentPayloads: any[] = [];
    const getAdapter = async (serviceName: string) => {
      if (serviceName === 'myjira') {
        return {
          execute: async () => [
            {
              key: 'ATI-77',
              summary: 'Khắc phục timeout Redis',
              status: 'In Progress',
              priority: 'High',
              assignee: 'Trần Thị Bình',
              url: 'https://acme.atlassian.net/browse/ATI-77',
            },
          ],
        };
      }
      return {
        execute: async (tool: string, args: any) => {
          if (tool === 'slack.search_users') {
            return [{ id: 'U02BINH', name: 'binh', realName: 'Trần Thị Bình', displayName: 'binh' }];
          }
          if (tool === 'slack.send_message') {
            sentPayloads.push(args);
            return { ok: true, ts: '1700000200.000100' };
          }
          return [];
        },
      };
    };

    const outcome = await runJiraDigest({
      userId: 'user-1',
      recurrence,
      digestConfig: jiraConfig,
      digestConfigHash: computeJiraDigestConfigHash({ config: jiraConfig, recurrence, userId: 'user-1' }),
      revalidatePolicy: async () => ({ allowed: true }),
      getAdapter,
      resolveSlackMentions: true,
    });

    expect(outcome.state).toBe('digest_sent');
    expect(sentPayloads).toHaveLength(1);
    expect(sentPayloads[0].text).toContain('👤 <@U02BINH>');
    expect(Array.isArray(sentPayloads[0].blocks)).toBe(true);
    expect(sentPayloads[0].blocks[0].type).toBe('header');

    // Also verify createJiraDigestExecutor builds blocks when resolving mentions
    const execSent: any[] = [];
    const executor = createJiraDigestExecutor({
      pool: { query: vi.fn().mockResolvedValue({ rows: [{ version: 1, status: 'active' }] }) } as unknown as pg.Pool,
      timeZone: 'Asia/Ho_Chi_Minh',
      resolveSlackMentions: true,
      getAdapter: async (svc: string) => {
        if (svc === 'myjira') return getAdapter('myjira');
        return {
          execute: async (tool: string, args: any) => {
            if (tool === 'slack.search_channels') return [{ id: 'C_JIRA', name: 'jira-alerts' }];
            if (tool === 'slack.search_users') return [{ id: 'U02BINH', name: 'binh', realName: 'Trần Thị Bình' }];
            if (tool === 'slack.send_message') {
              execSent.push(args);
              return { ts: '1700000200.000200' };
            }
            return [];
          },
        };
      },
    });
    const execOut = await executor(
      {
        runId: 'not-a-uuid',
        scheduleId: 'sched-j1',
        scheduleVersion: 1,
        userId: 'user-1',
        name: 'Jira Standup',
        request: 'Jira',
        dueAt: new Date('2026-11-02T02:00:00.000Z'),
        trigger: 'scheduled',
        workspaceId: 'ws-1',
        workspaceMode: 'organization',
        recurrence,
        digestConfig: jiraConfig,
        digestConfigHash: computeJiraDigestConfigHash({ config: jiraConfig, recurrence, userId: 'user-1' }),
      },
      'conv-j1',
      new AbortController().signal,
    );
    expect(execOut.state).toBe('digest_sent');
    expect(execSent[0].text).toContain('👤 <@U02BINH>');
    expect(Array.isArray(execSent[0].blocks)).toBe(true);
  });
});
