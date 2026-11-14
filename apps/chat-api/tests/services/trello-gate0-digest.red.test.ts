import { describe, expect, it, vi } from 'vitest';
import { computeTrelloDigestConfigHash } from '../../src/services/schedules/trello-digest-candidate.js';
import { createTrelloDigestRunner } from '../../src/services/schedules/trello-digest-runner.js';

// TRELLO-G0: intentionally RED on main. All external calls are injected fakes.
// The real-provider OAuth probe is tracked separately as NOT_RUN.
const userId = 'gate0-owner';
const recurrence = { type: 'daily' as const, time: '08:30' };
const baseConfig = {
  credentialId: 'cred-gate0',
  trelloMemberId: 'mem-gate0',
  username: 'owner',
  boards: [{ id: 'b1', name: 'Frontend' }],
  channelId: 'C_DEV',
  channelName: 'dev',
  dueSoonHours: 24,
};

function scenario(options: {
  cards?: any[];
  slackReceipt?: unknown;
  telegramReceipt?: unknown;
  failChannelLookup?: boolean;
  viaTelegram?: boolean;
} = {}) {
  const config = options.viaTelegram
    ? {
        ...baseConfig,
        channelId: '',
        channelName: '',
        telegramChatId: 'tg-123',
        telegramChatTitle: 'Ops',
      }
    : baseConfig;
  const cards = options.cards ?? [];
  const trelloExecute = vi.fn(async (tool: string, args: { limit?: number }) => {
    if (tool !== 'trello.search_cards') throw new Error('Unexpected Trello tool');
    return cards.slice(0, args.limit ?? 10);
  });
  const slackSend = vi.fn(async () => options.slackReceipt ?? { ts: '1700000000.001' });
  const tgSend = vi.fn(async () => options.telegramReceipt ?? { messageId: 100 });
  const slackExecute = vi.fn(async (tool: string) => {
    if (tool === 'slack.search_channels') {
      if (options.failChannelLookup) throw new Error('Slack channel lookup timed out');
      return [{ id: 'C_DEV', name: 'dev' }];
    }
    if (tool === 'slack.send_message') return slackSend();
    throw new Error('Unexpected Slack tool');
  });
  const runner = createTrelloDigestRunner({
    pool: {
      query: vi.fn(async () => ({ rows: [{ version: 1, status: 'active' }], rowCount: 1 })),
    } as any,
    trelloConnection: async () => ({
      status: 'connected',
      connection: {
        credentialId: 'cred-gate0',
        memberId: 'mem-gate0',
        username: 'owner',
        boardIds: ['b1'],
      },
    }),
    telegramConnection: async () => ({
      status: 'connected',
      connection: { chatIds: ['tg-123'] },
    }),
    getAdapter: async (service: string) => {
      if (service === 'trello') return { execute: trelloExecute };
      if (service === 'slack') return { execute: slackExecute };
      if (service === 'telegram') return { execute: tgSend };
      throw new Error('Unexpected service ' + service);
    },
  });
  const run = () => runner({
    // Non-UUID fixture avoids a fake DB claiming real transaction safety.
    // The delivery CAS must also receive separate PostgreSQL integration coverage in GREEN.
    runId: 'fixture-non-uuid',
    scheduleId: 'fixture-schedule',
    scheduleVersion: 1,
    userId,
    name: 'Trello Gate 0',
    request: 'Báo cáo Trello mỗi sáng',
    dueAt: new Date('2026-11-09T01:30:00.000Z'),
    trigger: 'scheduled' as const,
    recurrence,
    digestConfig: config,
    digestConfigHash: computeTrelloDigestConfigHash({ config, recurrence, userId }),
  }, 'fixture-conv', new AbortController().signal);

  return { run, trelloExecute, slackSend, tgSend };
}

describe('TRELLO-G0 — digest coverage and delivery receipt (RED contracts)', () => {
  it('never presents capped results as a complete board-wide total', async () => {
    const allCards = Array.from({ length: 70 }, (_, i) => ({
      id: 'c' + i,
      name: 'Overdue card ' + i,
      url: 'https://trello.com/c/' + i,
      boardId: 'b1',
      listId: 'l1',
      due: '2026-11-01T08:00:00.000Z',
      dueComplete: false,
      idMembers: ['member-1'],
    }));
    const { run, trelloExecute } = scenario({ cards: allCards });
    const result = await run();

    expect(trelloExecute).toHaveBeenCalled();
    // Accept an explicit partial-coverage message or a non-sent outcome.
    // Do not silently call 15 selected cards the complete overdue count.
    if (result.state === 'digest_sent') {
      expect(result.text).toMatch(/(?:dữ liệu một phần|chưa đầy đủ|không đầy đủ|bị giới hạn|truncated|partial)/i);
    }
  });

  it('does not certify Slack delivery when provider response lacks a message timestamp', async () => {
    const { run, slackSend } = scenario({ slackReceipt: {} });
    const result = await run();
    expect(slackSend).toHaveBeenCalledTimes(1);
    expect(result.state).toBe('delivery_unknown');
  });

  it('does not certify Telegram delivery when response lacks messageId', async () => {
    const { run, tgSend } = scenario({ viaTelegram: true, telegramReceipt: {} });
    const result = await run();
    expect(tgSend).toHaveBeenCalledTimes(1);
    expect(result.state).toBe('delivery_unknown');
  });

  it('does not send when Slack destination membership cannot be verified', async () => {
    const { run, slackSend } = scenario({ failChannelLookup: true });
    const result = await run();
    expect(slackSend).not.toHaveBeenCalled();
    expect(result.state).toBe('blocked');
  });
});
