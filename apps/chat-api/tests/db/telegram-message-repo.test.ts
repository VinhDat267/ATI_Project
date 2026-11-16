import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
import { TelegramMessageRepo } from '../../src/db/repositories/telegram-message-repo.js';

const migration0037 = fileURLToPath(
  new URL('../../../../db/v3/0037_telegram_chat_messages.sql', import.meta.url),
);

describe('TelegramMessageRepo on PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let repo: TelegramMessageRepo;

  beforeAll(async () => {
    db = await createMigratedSchema('telegram_msg_repo');
    repo = new TelegramMessageRepo(db.pool);
  });

  afterAll(async () => {
    await db?.close();
  });

  it('searches every retained message before limiting results', async () => {
    const now = new Date('2026-11-16T08:00:00Z');
    const sentAt = Math.floor(now.getTime() / 1000) - 10 * 60;
    const botKey = 'search-bot';
    const chatId = '-1001234567890';
    await repo.upsertMany(botKey, [
      { chatId, messageId: 1, senderName: 'An', text: 'Đối soát 100%_xong', date: sentAt },
      ...Array.from({ length: 200 }, (_, i) => ({
        chatId, messageId: i + 2, senderName: 'An', text: 'Khong khop', date: sentAt + i + 1,
      })),
    ], now);

    expect(await repo.list(botKey, chatId, 1, now, ({ text }) => text.includes('100%_xong')))
      .toMatchObject([{ messageId: 1 }]);
    expect(await repo.list(botKey, chatId, 1, now, ({ text }) => text.includes('100% xong'))).toEqual([]);
  });

  it('clears legacy expired rows in the background without polling Telegram', async () => {
    const botKey = 'cleanup-bot';
    const now = new Date();
    const chatId = '-1001234567890';
    await db.pool.query('INSERT INTO telegram_update_cursors(bot_key) VALUES ($1)', [botKey]);
    await db.pool.query(
      'INSERT INTO telegram_chat_messages VALUES ($1, $2, 1, $3, $4, $5, $6)',
      [botKey, chatId, 'An', 'Old row', new Date(now.getTime() - 25 * 60 * 60_000), new Date(now.getTime() + 60_000)],
    );
    const purge = vi.spyOn(repo, 'purgeExpired');
    const onError = vi.fn();
    const stop = repo.startCleanup(onError, 50);
    try {
      expect(purge).toHaveBeenCalledOnce();
      await purge.mock.results[0]?.value;
      expect((await db.pool.query('SELECT * FROM telegram_chat_messages WHERE bot_key = $1', [botKey])).rows)
        .toEqual([]);

      await db.pool.query(
        'INSERT INTO telegram_chat_messages VALUES ($1, $2, 2, $3, $4, $5, $6)',
        [botKey, chatId, 'An', 'Expired row', new Date(now.getTime() - 25 * 60 * 60_000), now],
      );
      await vi.waitFor(async () => {
        expect((await db.pool.query('SELECT * FROM telegram_chat_messages WHERE bot_key = $1', [botKey])).rows)
          .toEqual([]);
      });
      expect(onError).not.toHaveBeenCalled();
    } finally {
      stop();
      purge.mockRestore();
    }
  });

  it('inserts, lists newest first, overwrites edited_message, filters/purges expired rows, and keeps migration idempotent', async () => {
    const sql = await readFile(migration0037, 'utf8');
    await db.pool.query(sql);

    const botKey = 'bot-key-1';
    const chatId = '-1001234567890';
    const otherChat = '-100999888777';
    const t0 = new Date('2026-11-16T08:00:00Z');

    await repo.upsertMany(
      botKey,
      [
        { chatId, messageId: 10, senderName: 'An', text: 'Tin cũ nhất', date: 1794815000 },
        { chatId, messageId: 11, senderName: 'Bình', text: 'Tin mới hơn', date: 1794815500 },
        { chatId: otherChat, messageId: 12, senderName: 'Chi', text: 'Tin nhóm khác', date: 1794815900 },
      ],
      t0,
    );

    // Same timestamp tiebreaker: higher messageId comes first
    await repo.upsertMany(
      botKey,
      [{ chatId, messageId: 13, senderName: 'Dũng', text: 'Tin mới nhất', date: 1794815500 }],
      t0,
    );

    expect(await repo.list(botKey, chatId, 10, t0)).toEqual([
      { chatId, messageId: 13, senderName: 'Dũng', text: 'Tin mới nhất', date: 1794815500 },
      { chatId, messageId: 11, senderName: 'Bình', text: 'Tin mới hơn', date: 1794815500 },
      { chatId, messageId: 10, senderName: 'An', text: 'Tin cũ nhất', date: 1794815000 },
    ]);

    // Edits replace the text without resetting the original expiry.
    const tEdit = new Date(t0.getTime() + 12 * 60 * 60_000);
    await repo.upsertMany(
      botKey,
      [{ chatId, messageId: 10, senderName: 'An', text: 'Tin đã sửa', date: 1794815000 }],
      tEdit,
    );

    expect(await repo.list(botKey, chatId, 2, tEdit)).toEqual([
      { chatId, messageId: 13, senderName: 'Dũng', text: 'Tin mới nhất', date: 1794815500 },
      { chatId, messageId: 11, senderName: 'Bình', text: 'Tin mới hơn', date: 1794815500 },
    ]);

    const expiry = new Date((1794815000 + 24 * 60 * 60) * 1000);
    expect(await repo.list(botKey, chatId, 10, expiry)).toMatchObject([{ messageId: 13 }, { messageId: 11 }]);

    // A delayed update or an edit after expiry cannot resurrect the original message.
    const tAfter25h = new Date(t0.getTime() + 25 * 60 * 60_000);
    await repo.upsertMany(botKey, [
      { chatId, messageId: 10, senderName: 'An', text: 'Late edit', date: 1794815000 },
      { chatId, messageId: 20, senderName: 'An', text: 'Delayed update', date: 1794815000 },
    ], tAfter25h);
    expect(await repo.list(botKey, chatId, 10, tAfter25h)).toEqual([]);
    await repo.purgeExpired(tAfter25h);
    expect(
      (await db.pool.query('SELECT message_id FROM telegram_chat_messages WHERE bot_key = $1', [botKey])).rows,
    ).toEqual([]);
  });
});
