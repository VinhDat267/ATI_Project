import type pg from 'pg';
import { decryptCredentials, encryptCredentials } from '@wap/tool-adapters';
import {
  TELEGRAM_CHAT_MESSAGE_LIMIT,
  TELEGRAM_CHAT_MESSAGE_RETENTION_MS,
  TELEGRAM_CHAT_MESSAGES,
  TELEGRAM_CURSOR_IDLE_MS,
  telegramUpdateRetention,
  type TelegramCachedChatMessage,
  type TelegramProjectedBatch,
  type TelegramUpdateStore,
} from '../../services/telegram/update-inbox.js';

export class TelegramUpdateRepo implements TelegramUpdateStore {
  constructor(private pool: pg.Pool, private encryptionKey?: string) {}

  async poll(botKey: string, signal: AbortSignal, fetchPage: (offset?: number) => Promise<any[]>): Promise<any[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '10s'");
      await client.query('INSERT INTO telegram_update_cursors(bot_key) VALUES($1) ON CONFLICT DO NOTHING', [botKey]);
      const cursor = (await client.query(
        'SELECT next_update_id,updated_at FROM telegram_update_cursors WHERE bot_key=$1 FOR UPDATE', [botKey],
      )).rows[0];
      signal.throwIfAborted();
      const idle = Date.now() - cursor.updated_at.getTime() >= TELEGRAM_CURSOR_IDLE_MS;
      const offset = cursor.next_update_id === null || idle ? undefined : Number(cursor.next_update_id);
      const batch = await fetchPage(offset);
      signal.throwIfAborted();
      const now = Date.now();
      // Remove expired IDs before upserting: Telegram may reuse an ID after idle.
      await client.query('DELETE FROM telegram_update_inbox WHERE expires_at<=$1', [new Date(now)]);
      await client.query('DELETE FROM telegram_chat_message_cache WHERE expires_at<=$1', [new Date(now)]);
      let next = offset;
      for (const update of batch) {
        if (!Number.isSafeInteger(update.update_id) || update.update_id < 0) throw new Error('Invalid Telegram update ID');
        next = Math.max(next ?? 0, update.update_id + 1);
        if (update.message) {
          await client.query(
            `INSERT INTO telegram_update_inbox(bot_key,update_id,payload,expires_at) VALUES($1,$2,$3,$4)
             ON CONFLICT (bot_key,update_id) DO NOTHING`,
            [botKey, update.update_id, JSON.stringify(update), new Date(now + telegramUpdateRetention(update))],
          );
        }
      }
      const chatMessages = (batch as TelegramProjectedBatch)[TELEGRAM_CHAT_MESSAGES];
      if (Array.isArray(chatMessages) && chatMessages.length > 0) {
        const deduped = new Map<string, TelegramCachedChatMessage>();
        const touchedChatIds = new Set<string>();
        for (const msg of chatMessages) {
          deduped.set(`${msg.chatId}:${msg.messageId}`, msg);
          touchedChatIds.add(msg.chatId);
        }
        const expiresAt = new Date(now + TELEGRAM_CHAT_MESSAGE_RETENTION_MS);
        for (const msg of deduped.values()) {
          const encoded = this.encryptionKey
            ? encryptCredentials(msg, this.encryptionKey)
            : JSON.stringify(msg);
          await client.query(
            `INSERT INTO telegram_chat_message_cache(bot_key, chat_id, message_id, message_date, payload, expires_at)
             VALUES($1, $2, $3, $4, $5, $6)
             ON CONFLICT (bot_key, chat_id, message_id) DO UPDATE
             SET message_date = EXCLUDED.message_date, payload = EXCLUDED.payload, expires_at = EXCLUDED.expires_at`,
            [botKey, msg.chatId, msg.messageId, msg.date, encoded, expiresAt],
          );
        }
        for (const chatId of touchedChatIds) {
          await client.query(
            `DELETE FROM telegram_chat_message_cache
             WHERE bot_key = $1 AND chat_id = $2
               AND message_id NOT IN (
                 SELECT message_id FROM telegram_chat_message_cache
                 WHERE bot_key = $1 AND chat_id = $2
                 ORDER BY message_date DESC, message_id DESC
                 LIMIT $3
               )`,
            [botKey, chatId, TELEGRAM_CHAT_MESSAGE_LIMIT],
          );
        }
      }
      await client.query(
        'UPDATE telegram_update_cursors SET next_update_id=$2,updated_at=CASE WHEN $4 THEN $3 ELSE updated_at END WHERE bot_key=$1',
        [botKey, next ?? null, new Date(now), batch.length > 0],
      );
      const saved = await client.query(
        'SELECT payload FROM telegram_update_inbox WHERE bot_key=$1 AND expires_at>$2 ORDER BY update_id',
        [botKey, new Date(now)],
      );
      signal.throwIfAborted();
      // A subsequent provider call may acknowledge this batch only after this commit.
      await client.query('COMMIT');
      return saved.rows.map(row => row.payload);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async readChatMessages(botKey: string, chatId: string): Promise<TelegramCachedChatMessage[]> {
    const res = await this.pool.query<{ payload: string }>(
      `SELECT payload
       FROM telegram_chat_message_cache
       WHERE bot_key = $1 AND chat_id = $2 AND expires_at > now()
       ORDER BY message_date DESC, message_id DESC
       LIMIT $3`,
      [botKey, chatId, TELEGRAM_CHAT_MESSAGE_LIMIT],
    );
    const messages: TelegramCachedChatMessage[] = [];
    for (const row of res.rows) {
      try {
        const parsed = this.encryptionKey && row.payload.startsWith('v1:')
          ? decryptCredentials<TelegramCachedChatMessage>(row.payload, this.encryptionKey)
          : JSON.parse(row.payload);
        if (
          parsed &&
          typeof parsed.chatId === 'string' &&
          Number.isSafeInteger(parsed.messageId) &&
          Number.isSafeInteger(parsed.date) &&
          typeof parsed.text === 'string'
        ) {
          messages.push(parsed);
        }
      } catch {
        // Ignore undecryptable legacy/rotated cache rows rather than blocking read_messages.
      }
    }
    return messages;
  }
}
