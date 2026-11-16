import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

    // Edited message overwrites text & refreshes TTL
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

    // After 25h from t0, messages 11 and 13 expire while edited message 10 (refreshed at t0+12h -> expires at t0+36h) stays
    const tAfter25h = new Date(t0.getTime() + 25 * 60 * 60_000);
    expect(await repo.list(botKey, chatId, 10, tAfter25h)).toEqual([
      { chatId, messageId: 10, senderName: 'An', text: 'Tin đã sửa', date: 1794815000 },
    ]);

    expect(await repo.purgeExpired(tAfter25h)).toBe(3);
    expect(
      (await db.pool.query('SELECT message_id FROM telegram_chat_messages WHERE bot_key = $1', [botKey])).rows,
    ).toEqual([{ message_id: '10' }]);
  });
});
