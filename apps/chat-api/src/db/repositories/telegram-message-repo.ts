import type pg from 'pg';
import { normalizeTelegramChatId, TELEGRAM_CHAT_ID_PATTERN } from '@wap/tool-schemas';
import type { TelegramChatMessage } from '@wap/tool-adapters';

export const TELEGRAM_MESSAGE_RETENTION_MS = 24 * 60 * 60_000;

type Queryable = Pick<pg.Pool, 'query'>;

export class TelegramMessageRepo {
  constructor(private pool: pg.Pool) {}

  async upsertMany(
    botKey: string,
    messages: TelegramChatMessage[],
    now: Date = new Date(),
    client?: Queryable,
  ): Promise<void> {
    if (messages.length === 0) return;
    const db = client ?? this.pool;

    // Deduplicate by (chatId, messageId), keeping the latest copy (e.g., edited_message)
    // so Postgres ON CONFLICT DO UPDATE never attempts to update one row twice in one statement.
    const deduped = new Map<string, TelegramChatMessage>();
    for (const msg of messages) {
      if (
        !msg ||
        typeof msg.chatId !== 'string' ||
        !TELEGRAM_CHAT_ID_PATTERN.test(msg.chatId.trim()) ||
        !Number.isSafeInteger(msg.messageId) ||
        msg.messageId <= 0 ||
        !Number.isSafeInteger(msg.date) ||
        msg.date < 0 ||
        typeof msg.text !== 'string'
      ) {
        continue;
      }
      const chatId = normalizeTelegramChatId(msg.chatId);
      const text = Array.from(msg.text.trim()).slice(0, 4000).join('');
      if (!text) continue;
      const senderName =
        Array.from((typeof msg.senderName === 'string' ? msg.senderName : '').trim() || 'Thành viên')
          .slice(0, 200)
          .join('');
      deduped.set(`${chatId}:${msg.messageId}`, {
        chatId,
        messageId: msg.messageId,
        senderName,
        text,
        date: msg.date,
      });
    }
    if (deduped.size === 0) return;

    await db.query(
      'INSERT INTO telegram_update_cursors(bot_key) VALUES($1) ON CONFLICT DO NOTHING',
      [botKey],
    );

    const expiresAt = new Date(now.getTime() + TELEGRAM_MESSAGE_RETENTION_MS);
    const values: any[] = [];
    const tuples: string[] = [];
    let param = 1;
    for (const item of deduped.values()) {
      tuples.push(`($${param++}, $${param++}, $${param++}, $${param++}, $${param++}, $${param++}, $${param++})`);
      values.push(
        botKey,
        item.chatId,
        item.messageId,
        item.senderName,
        item.text,
        new Date(item.date * 1000),
        expiresAt,
      );
    }

    await db.query(
      `INSERT INTO telegram_chat_messages(bot_key, chat_id, message_id, sender_name, text, sent_at, expires_at)
       VALUES ${tuples.join(', ')}
       ON CONFLICT (bot_key, chat_id, message_id) DO UPDATE
       SET sender_name = EXCLUDED.sender_name,
           text = EXCLUDED.text,
           sent_at = EXCLUDED.sent_at,
           expires_at = EXCLUDED.expires_at`,
      values,
    );
  }

  async list(
    botKey: string,
    chatId: string,
    limit: number,
    now: Date = new Date(),
  ): Promise<TelegramChatMessage[]> {
    if (typeof chatId !== 'string' || !TELEGRAM_CHAT_ID_PATTERN.test(chatId.trim())) {
      return [];
    }
    const normalizedChatId = normalizeTelegramChatId(chatId);
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.trunc(limit))) : 50;
    const res = await this.pool.query<{
      chat_id: string;
      message_id: string;
      sender_name: string;
      text: string;
      sent_at: Date;
    }>(
      `SELECT chat_id, message_id, sender_name, text, sent_at
       FROM telegram_chat_messages
       WHERE bot_key = $1 AND chat_id = $2 AND expires_at > $3
       ORDER BY sent_at DESC, message_id DESC
       LIMIT $4`,
      [botKey, normalizedChatId, now, safeLimit],
    );

    return res.rows.map((row) => ({
      chatId: row.chat_id,
      messageId: Number(row.message_id),
      senderName: row.sender_name,
      text: row.text,
      date: Math.floor(row.sent_at.getTime() / 1000),
    }));
  }

  async purgeExpired(now: Date = new Date()): Promise<number> {
    const res = await this.pool.query(
      'DELETE FROM telegram_chat_messages WHERE expires_at <= $1',
      [now],
    );
    return res.rowCount ?? 0;
  }
}
