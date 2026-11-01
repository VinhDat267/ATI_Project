import { describe, expect, it, vi } from 'vitest';
import { TelegramBotClient, TelegramBotError } from '../../src/services/telegram/bot-client.js';

const config = {
  botToken: '123456789:AAH_secret_bot_token_1234567890',
  botUsername: 'ati_workflow_bot',
  callbackUrl: 'http://127.0.0.1:5174/connections/telegram/callback',
  apiBaseUrl: 'https://api.telegram.org',
  deepLinkBaseUrl: 'https://t.me',
};

describe('TelegramBotClient', () => {
  it('builds 1-click deepLinkUrl, groupDeepLinkUrl, and web callbackUrl with state', () => {
    const client = new TelegramBotClient(config);
    const state = 'a'.repeat(43);

    expect(client.deepLinkUrl(state)).toBe(`https://t.me/ati_workflow_bot?start=ati_${state}`);
    expect(client.groupDeepLinkUrl(state)).toBe(`https://t.me/ati_workflow_bot?startgroup=ati_${state}`);
    expect(client.callbackUrl(state)).toBe(`http://127.0.0.1:5174/connections/telegram/callback?state=${state}`);
  });

  it('verifyPairing matches /start ati_<state> from a non-bot user and extracts identity + group chats', async () => {
    const state = 'b'.repeat(43);
    const mockFetch = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe(`https://api.telegram.org/bot${config.botToken}/getUpdates`);
      expect(init.method).toBe('POST');
      return new Response(
        JSON.stringify({
          ok: true,
          result: [
            // Bot message with same state must be ignored
            {
              update_id: 1,
              message: {
                message_id: 10,
                from: { id: 999, is_bot: true, first_name: 'OtherBot', username: 'other_bot' },
                chat: { id: 999, type: 'private', first_name: 'OtherBot' },
                text: `/start ati_${state}`,
              },
            },
            // Real user message matching /start@ati_workflow_bot ati_<state> inside a group
            {
              update_id: 2,
              message: {
                message_id: 11,
                from: { id: 778899, is_bot: false, first_name: 'Nguyễn', last_name: 'Văn A', username: 'nguyenvana' },
                chat: { id: -1001234567890, type: 'supergroup', title: 'Đội Sản Phẩm' },
                text: `/start@ati_workflow_bot ati_${state}`,
              },
            },
            // Another group seen in updates
            {
              update_id: 3,
              my_chat_member: {
                chat: { id: -1009876543210, type: 'group', title: 'Kỹ thuật ATI' },
                new_chat_member: { status: 'member' },
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const client = new TelegramBotClient(config, mockFetch as any);
    const result = await client.verifyPairing(state, new AbortController().signal);

    expect(result).toEqual({
      matched: true,
      telegramUserId: '778899',
      username: 'nguyenvana',
      displayName: 'Nguyễn Văn A',
      pairedChat: {
        chatId: '-1001234567890',
        title: 'Đội Sản Phẩm',
        type: 'supergroup',
      },
      discoveredGroups: [
        { chatId: '-1001234567890', title: 'Đội Sản Phẩm', type: 'supergroup' },
        { chatId: '-1009876543210', title: 'Kỹ thuật ATI', type: 'group' },
      ],
    });
  });

  it('verifyPairing returns matched: false when no non-bot update matches state', async () => {
    const state = 'c'.repeat(43);
    const mockFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          result: [
            {
              update_id: 1,
              message: {
                from: { id: 111, is_bot: false, first_name: 'Alice' },
                chat: { id: 111, type: 'private' },
                text: '/start ati_different_state',
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const client = new TelegramBotClient(config, mockFetch as any);
    expect(await client.verifyPairing(state, new AbortController().signal)).toEqual({ matched: false });
  });

  it('getChatMember returns true only for active members and false for left/kicked/restricted-out or 400/403', async () => {
    const statuses: Record<string, any> = {
      '-1001': { status: 'creator' },
      '-1002': { status: 'administrator' },
      '-1003': { status: 'member' },
      '-1004': { status: 'restricted', is_member: true },
      '-1005': { status: 'restricted', is_member: false },
      '-1006': { status: 'left' },
      '-1007': { status: 'kicked' },
    };

    const mockFetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.chat_id === '-100403') {
        return new Response(JSON.stringify({ ok: false, error_code: 403, description: 'Forbidden: bot was kicked' }), {
          status: 403,
        });
      }
      const member = statuses[String(body.chat_id)];
      return new Response(JSON.stringify({ ok: true, result: member }), { status: 200 });
    });

    const client = new TelegramBotClient(config, mockFetch as any);
    const signal = new AbortController().signal;

    expect(await client.getChatMember('-1001', '778899', signal)).toBe(true);
    expect(await client.getChatMember('-1002', '778899', signal)).toBe(true);
    expect(await client.getChatMember('-1003', '778899', signal)).toBe(true);
    expect(await client.getChatMember('-1004', '778899', signal)).toBe(true);
    expect(await client.getChatMember('-1005', '778899', signal)).toBe(false);
    expect(await client.getChatMember('-1006', '778899', signal)).toBe(false);
    expect(await client.getChatMember('-1007', '778899', signal)).toBe(false);
    expect(await client.getChatMember('-100403', '778899', signal)).toBe(false);
  });

  it('never leaks botToken in TelegramBotError messages and honors real AbortSignal', async () => {
    const mockFetch401 = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, error_code: 401, description: `Unauthorized ${config.botToken}` }), {
        status: 401,
      }),
    );

    const client401 = new TelegramBotClient(config, mockFetch401 as any);
    try {
      await client401.verifyPairing('d'.repeat(43), new AbortController().signal);
      expect.unreachable('Should have thrown TelegramBotError');
    } catch (err: any) {
      expect(err).toBeInstanceOf(TelegramBotError);
      expect(err.kind).toBe('unauthorized');
      expect(err.message).not.toContain(config.botToken);
    }

    const aborted = new AbortController();
    aborted.abort();
    const neverFetch = vi.fn();
    const clientAbort = new TelegramBotClient(config, neverFetch as any);
    await expect(clientAbort.verifyPairing('d'.repeat(43), aborted.signal)).rejects.toMatchObject({ kind: 'network' });
    expect(neverFetch).not.toHaveBeenCalled();
  });
});
