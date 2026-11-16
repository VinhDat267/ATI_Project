import { describe, expect, it, vi } from 'vitest';
import type { TrelloDigestConfig } from '@wap/tool-schemas';
import {
  buildConfirmedTrelloDigestDelivery,
  computeTrelloDigestConfigHash,
  evaluateTrelloDigestCandidate,
  getTrelloDigestPinnedCredentialIds,
} from '../../../src/services/schedules/trello-digest-candidate.js';
import { createTrelloDigestRunner, isTrelloDoneListName } from '../../../src/services/schedules/trello-digest-runner.js';

const TRELLO_CRED_ID = '0b5c1f0e-7a6d-4c1e-9d2a-1a2b3c4d5e03';
const TG_CRED_ID = '2c5c1f0e-7a6d-4c1e-9d2a-1a2b3c4d5e05';
const TG_CRED_SWAPPED = '3d5c1f0e-7a6d-4c1e-9d2a-1a2b3c4d5e06';
const userId = 'user-trello-pin';
const daily = { type: 'daily' as const, time: '08:30' };
const NOW = new Date('2026-11-02T08:30:00.000Z');

const trelloConnection = async () => ({
  status: 'connected',
  connection: {
    credentialId: TRELLO_CRED_ID,
    memberId: 'mem-1',
    username: 'alice_trello',
    boardIds: ['b1'],
  },
  memberBoards: [{ boardId: 'b1', boardName: 'Frontend' }],
});

function telegramConfig(overrides: Partial<TrelloDigestConfig> = {}): TrelloDigestConfig {
  return {
    credentialId: TRELLO_CRED_ID,
    trelloMemberId: 'mem-1',
    username: 'alice_trello',
    boards: [{ id: 'b1', name: 'Frontend' }],
    channelId: '',
    channelName: '',
    dueSoonHours: 24,
    destination: 'telegram',
    telegramChatId: '777009',
    telegramChatTitle: 'Nhóm dự án',
    telegramCredentialId: TG_CRED_ID,
    ...overrides,
  };
}

function runInput(config: TrelloDigestConfig, recurrence: any = daily) {
  return {
    runId: 'run-pin-1',
    scheduleId: 'sched-pin-1',
    scheduleVersion: 1,
    userId,
    name: 'Bản tin Trello',
    request: 'Bản tin Trello',
    dueAt: NOW,
    trigger: 'scheduled' as const,
    recurrence,
    digestConfig: config,
    digestConfigHash: computeTrelloDigestConfigHash({ config, recurrence, userId }),
  };
}

const mockPool = {
  query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ version: 1, status: 'active' }] }),
} as any;

describe('Trello digest Telegram credential pin (M1)', () => {
  it('candidate pins destination=telegram and the Telegram credential id', async () => {
    const candidate = await evaluateTrelloDigestCandidate({
      userId,
      request: 'Mỗi sáng gửi bản tin bảng Frontend qua Telegram',
      services: ['trello', 'telegram'],
      recurrence: daily,
      trelloConnection,
      telegramConnection: async () => ({
        status: 'connected',
        selectedChats: [{ chatId: '777009', title: 'Nhóm dự án' }],
        connection: { credentialId: TG_CRED_ID, telegramUserId: '777009', username: 'tg', chatIds: ['777009'] },
      }),
    });
    expect(candidate.canAutoDigest).toBe(true);
    expect(candidate.config).toMatchObject({
      destination: 'telegram',
      telegramChatId: '777009',
      telegramCredentialId: TG_CRED_ID,
    });
    expect(getTrelloDigestPinnedCredentialIds(candidate.config!)).toEqual([TRELLO_CRED_ID, TG_CRED_ID]);
  });

  it('candidate marks Slack destination explicitly', async () => {
    const candidate = await evaluateTrelloDigestCandidate({
      userId,
      request: 'Mỗi sáng báo cáo bảng Frontend gửi vào kênh #dev',
      services: ['trello', 'slack'],
      recurrence: daily,
      trelloConnection,
      getAdapter: async () => ({ execute: vi.fn().mockResolvedValue([{ id: 'C_DEV', name: 'dev' }]) }),
    });
    expect(candidate.canAutoDigest).toBe(true);
    expect(candidate.config).toMatchObject({ destination: 'slack', channelId: 'C_DEV' });
  });

  it('pinned-credential helper treats legacy configs with telegramChatId but no destination as Telegram', () => {
    const legacy = telegramConfig({ destination: undefined });
    delete (legacy as any).destination;
    expect(getTrelloDigestPinnedCredentialIds(legacy)).toEqual([TRELLO_CRED_ID, TG_CRED_ID]);
  });

  async function runWithTelegramConnection(config: TrelloDigestConfig, tgConnection: any) {
    const sends: any[] = [];
    const runner = createTrelloDigestRunner({
      pool: mockPool,
      trelloConnection,
      telegramConnection: async () => tgConnection,
      getAdapter: async (serviceName: string) => {
        if (serviceName === 'trello') return { execute: vi.fn().mockResolvedValue([]) };
        if (serviceName === 'telegram') {
          return {
            execute: vi.fn().mockImplementation(async (_tool: string, args: any) => {
              sends.push(args);
              return { messageId: 42 };
            }),
          };
        }
        return null;
      },
    });
    const outcome = await runner(runInput(config), 'conv-1', new AbortController().signal);
    return { outcome, sends };
  }

  it('blocks with 0 sends when the Telegram bot credential was swapped', async () => {
    const { outcome, sends } = await runWithTelegramConnection(telegramConfig(), {
      status: 'connected',
      connection: { credentialId: TG_CRED_SWAPPED, chatIds: ['777009'] },
    });
    expect(outcome.state).toBe('blocked');
    expect(sends).toHaveLength(0);
  });

  it('fails closed when the pinned Telegram credential cannot be verified (connection has no credentialId)', async () => {
    const { outcome, sends } = await runWithTelegramConnection(telegramConfig(), {
      status: 'connected',
      connection: { chatIds: ['777009'] },
    });
    expect(outcome.state).toBe('blocked');
    expect(sends).toHaveLength(0);
  });

  it('still runs a legacy Telegram config without destination/telegramCredentialId (same as GitHub digest)', async () => {
    const legacy = telegramConfig();
    delete (legacy as any).destination;
    delete (legacy as any).telegramCredentialId;
    const { outcome, sends } = await runWithTelegramConnection(legacy, {
      status: 'connected',
      connection: { credentialId: TG_CRED_ID, telegramUserId: '777009', username: 'tg', chatIds: ['777009'] },
    });
    expect(outcome.state).toBe('digest_sent');
    expect(sends).toHaveLength(1);
  });

  it('blocks when destination is telegram but no chat id is stored', async () => {
    const broken = telegramConfig();
    delete (broken as any).telegramChatId;
    const { outcome, sends } = await runWithTelegramConnection(broken, {
      status: 'connected',
      connection: { credentialId: TG_CRED_ID, chatIds: ['777009'] },
    });
    expect(outcome.state).toBe('blocked');
    expect(sends).toHaveLength(0);
  });
});

describe('buildConfirmedTrelloDigestDelivery (mark_sent recovery)', () => {
  it('records the Telegram chat as targetId even though channelId is an empty string (legacy config without destination)', () => {
    const legacy = telegramConfig();
    delete (legacy as any).destination;
    const confirmed = buildConfirmedTrelloDigestDelivery({
      config: legacy,
      previousDelivery: {},
      resolvedAtIso: '2026-11-10T10:00:00.000Z',
      resolvedBy: userId,
    });
    expect(confirmed).toMatchObject({ destination: 'telegram', targetId: '777009', targetLabel: 'Nhóm dự án' });
  });

  it('prefers the runner receipt (telegramChatId) and its counts over empty channelId', () => {
    const confirmed = buildConfirmedTrelloDigestDelivery({
      config: null,
      previousDelivery: {
        channelId: '',
        channelName: '',
        ts: null,
        telegramChatId: '555',
        telegramChatTitle: 'Chat 555',
        messageId: 9,
        counts: { overdueCards: 2, dueSoonCards: 1, unassignedCards: 3 },
      },
      resolvedAtIso: '2026-11-10T10:00:00.000Z',
      resolvedBy: userId,
    });
    expect(confirmed).toMatchObject({
      destination: 'telegram',
      targetId: '555',
      targetLabel: 'Chat 555',
      overdueCount: 2,
      dueSoonCount: 1,
      unassignedCount: 3,
    });
  });

  it('falls back to "unknown" rather than an empty targetId', () => {
    const confirmed = buildConfirmedTrelloDigestDelivery({
      config: telegramConfig({ telegramChatId: '' }),
      previousDelivery: { targetId: '' },
      resolvedAtIso: '2026-11-10T10:00:00.000Z',
      resolvedBy: userId,
    });
    expect(confirmed.targetId).toBe('unknown');
  });
});

describe('Trello digest completed + no-due sections', () => {
  const slackConfig: TrelloDigestConfig = {
    credentialId: TRELLO_CRED_ID,
    trelloMemberId: 'mem-1',
    username: 'alice_trello',
    boards: [{ id: 'b1', name: 'Frontend' }],
    channelId: 'C_DEV',
    channelName: 'dev',
    dueSoonHours: 24,
    includeAiSummary: false,
  };

  const cards = [
    // open, overdue, assigned
    { id: 'c_over', name: 'Overdue task', url: 'https://trello.com/c/over', listId: 'l_todo', due: '2026-11-01T08:00:00.000Z', dueComplete: false, idMembers: ['m1'], dateLastActivity: '2026-10-20T00:00:00.000Z' },
    // open, no due, unassigned
    { id: 'c_nodue1', name: 'No due A', url: 'https://trello.com/c/nd1', listId: 'l_todo', due: null, dueComplete: false, idMembers: [], dateLastActivity: '2026-10-20T00:00:00.000Z' },
    // open, no due, assigned
    { id: 'c_nodue2', name: 'No due B', url: 'https://trello.com/c/nd2', listId: 'l_todo', dueComplete: false, idMembers: ['m1'] },
    // completed via dueComplete, activity 2h ago -> counted
    { id: 'c_done_flag', name: 'Shipped login', url: 'https://trello.com/c/df', listId: 'l_todo', due: '2026-11-01T00:00:00.000Z', dueComplete: true, idMembers: ['m1'], dateLastActivity: '2026-11-02T06:30:00.000Z' },
    // in Done list (no due, unassigned), activity 3h ago -> counted, and NOT reported as unassigned/no-due
    { id: 'c_done_list', name: 'Wrote docs', url: 'https://trello.com/c/dl', listId: 'l_done', due: null, dueComplete: false, idMembers: [], dateLastActivity: '2026-11-02T05:30:00.000Z' },
    // in Done list but activity 3 days ago -> not counted for 24h window
    { id: 'c_done_old', name: 'Old done', url: 'https://trello.com/c/do', listId: 'l_done', due: '2026-10-25T00:00:00.000Z', dueComplete: false, idMembers: [], dateLastActivity: '2026-10-30T08:00:00.000Z' },
    // completed but no activity timestamp -> disclosed as unknown time
    { id: 'c_done_unknown', name: 'Done unknown time', url: 'https://trello.com/c/du', listId: 'l_done', dueComplete: true, idMembers: ['m1'] },
  ];

  function makeRunner(summarizeDigest?: any) {
    const sent: any[] = [];
    const runner = createTrelloDigestRunner({
      pool: mockPool,
      trelloConnection,
      getAdapter: async (serviceName: string) => {
        if (serviceName === 'trello') {
          return {
            execute: vi.fn().mockImplementation(async (tool: string) => {
              if (tool === 'trello.search_lists') {
                return [
                  { id: 'l_todo', name: 'Cần làm', boardId: 'b1' },
                  { id: 'l_done', name: 'Hoàn thành ✅', boardId: 'b1' },
                ];
              }
              return cards;
            }),
          };
        }
        if (serviceName === 'slack') {
          return {
            execute: vi.fn().mockImplementation(async (tool: string, args: any) => {
              if (tool === 'slack.search_channels') return [{ id: 'C_DEV', name: 'dev' }];
              if (tool === 'slack.send_message') {
                sent.push(args);
                return { ts: '1700000000.002' };
              }
            }),
          };
        }
        return null;
      },
      ...(summarizeDigest ? { summarizeDigest } : {}),
    });
    return { runner, sent };
  }

  it('reports completed-in-24h (dueComplete or Done list) and open cards without due date; done cards leave other sections', async () => {
    const { runner, sent } = makeRunner();
    const outcome = await runner(runInput(slackConfig), 'conv-1', new AbortController().signal);
    expect(outcome.state).toBe('digest_sent');
    if (outcome.state !== 'digest_sent') return;
    const delivery = outcome.delivery as any;
    expect(delivery.counts).toMatchObject({
      overdueCards: 1,
      dueSoonCards: 0,
      unassignedCards: 1, // only c_nodue1; Done-list cards are excluded
      completedCards: 2,
      noDueCards: 2,
    });
    expect(delivery.coverage.matchedCounts).toMatchObject({ completedCards: 2, noDueCards: 2 });
    expect(delivery.coverage.displayedCounts).toMatchObject({ completedCards: 2 });
    expect(delivery.coverage.completedWindowHours).toBe(24);
    expect(outcome.text).toContain('24h qua (2)');
    expect(outcome.text).toContain('Shipped login');
    expect(outcome.text).toContain('Wrote docs');
    expect(outcome.text).not.toContain('Old done');
    expect(outcome.text).toMatch(/chưa có hạn[^\n]*2/i);
    expect(outcome.text).toMatch(/1 thẻ đã xong nhưng không rõ thời điểm/);
    expect(outcome.text).toContain('Phạm vi dữ liệu');
    expect(sent).toHaveLength(1);
    // Unassigned section must not list Done-list cards
    const unassignedSection = outcome.text.split('Thẻ chưa gán người phụ trách')[1]!.split('\n•')[0]!;
    expect(unassignedSection).not.toContain('Wrote docs');
  });

  it('uses a 7-day window for weekly schedules', async () => {
    const { runner } = makeRunner();
    const weekly = { type: 'weekly' as const, time: '08:30', days: [1] };
    const outcome = await runner(runInput(slackConfig, weekly), 'conv-1', new AbortController().signal);
    expect(outcome.state).toBe('digest_sent');
    if (outcome.state !== 'digest_sent') return;
    expect((outcome.delivery as any).counts.completedCards).toBe(3);
    expect(outcome.text).toContain('7 ngày qua (3)');
    expect(outcome.text).toContain('Old done');
  });

  it('still sends when list lookup fails, falling back to dueComplete only', async () => {
    const sent: any[] = [];
    const runner = createTrelloDigestRunner({
      pool: mockPool,
      trelloConnection,
      getAdapter: async (serviceName: string) => {
        if (serviceName === 'trello') {
          return {
            execute: vi.fn().mockImplementation(async (tool: string) => {
              if (tool === 'trello.search_lists') throw Object.assign(new Error('boom'), { category: 'UNKNOWN' });
              return cards;
            }),
          };
        }
        return {
          execute: vi.fn().mockImplementation(async (tool: string, args: any) => {
            if (tool === 'slack.search_channels') return [{ id: 'C_DEV', name: 'dev' }];
            sent.push(args);
            return { ts: '1700000000.003' };
          }),
        };
      },
    });
    const outcome = await runner(runInput(slackConfig), 'conv-1', new AbortController().signal);
    expect(outcome.state).toBe('digest_sent');
    if (outcome.state !== 'digest_sent') return;
    expect((outcome.delivery as any).counts.completedCards).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it('allows the AI summary to cite the new counts (grounding check)', async () => {
    const summarize = vi.fn().mockResolvedValue('Có 2 thẻ đã xong trong 24h qua và 2 thẻ chưa có hạn.');
    const { runner } = makeRunner(summarize);
    const outcome = await runner(
      runInput({ ...slackConfig, includeAiSummary: true }),
      'conv-1',
      new AbortController().signal,
    );
    expect(outcome.state).toBe('digest_sent');
    if (outcome.state !== 'digest_sent') return;
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(summarize.mock.calls[0]![0]).toMatchObject({ completedCount: 2, noDueCount: 2, completedWindowHours: 24 });
    expect(outcome.text).toContain('Có 2 thẻ đã xong trong 24h qua');
  });

  it('Telegram output stays plain text with the new sections', async () => {
    const sends: any[] = [];
    const config = telegramConfig({ includeAiSummary: false });
    const runner = createTrelloDigestRunner({
      pool: mockPool,
      trelloConnection,
      telegramConnection: async () => ({
        status: 'connected',
        connection: { credentialId: TG_CRED_ID, chatIds: ['777009'] },
      }),
      getAdapter: async (serviceName: string) => {
        if (serviceName === 'trello') {
          return {
            execute: vi.fn().mockImplementation(async (tool: string) =>
              tool === 'trello.search_lists' ? [{ id: 'l_done', name: 'Done', boardId: 'b1' }] : cards,
            ),
          };
        }
        return {
          execute: vi.fn().mockImplementation(async (_tool: string, args: any) => {
            sends.push(args);
            return { messageId: 77 };
          }),
        };
      },
    });
    const outcome = await runner(runInput(config), 'conv-1', new AbortController().signal);
    expect(outcome.state).toBe('digest_sent');
    expect(sends).toHaveLength(1);
    const text: string = sends[0].text;
    expect(text).toContain('Wrote docs');
    expect(text).not.toMatch(/<https?:[^>]*\|/);
    expect(text).not.toContain('*✅');
  });
});

describe('isTrelloDoneListName', () => {
  it.each(['Done', '✅ Done', '05 - Hoàn thành', 'Xong', 'Đã xong', 'Completed', 'Complete', 'DONE this sprint'])(
    'matches done list name %s',
    (name) => {
      expect(isTrelloDoneListName(name)).toBe(true);
    },
  );

  it.each([
    'Not done',
    'Not yet done',
    'not-done',
    'Undone',
    'Incomplete',
    'Chưa xong',
    'Chưa hoàn thành',
    'Không hoàn thành',
    'Chưa được hoàn thành',
    'Doing',
    'Donation ideas',
    'Cần làm',
  ])('does not match open-work list name %s', (name) => {
    expect(isTrelloDoneListName(name)).toBe(false);
  });
});
