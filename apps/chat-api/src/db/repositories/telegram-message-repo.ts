import type pg from 'pg';
import { normalizeTelegramChatId, TELEGRAM_CHAT_ID_PATTERN, TELEGRAM_MESSAGE_RETENTION_MS } from '@wap/tool-schemas';
import type { TelegramChatMessage, TelegramMessageFilter } from '@wap/tool-adapters';

const CLEANUP_INTERVAL_MS = 60_000;

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
    const cutoff = now.getTime() - TELEGRAM_MESSAGE_RETENTION_MS;

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
        msg.date * 1000 <= cutoff ||
        !Number.isFinite(new Date(msg.date * 1000).getTime()) ||
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
      const key = `${chatId}:${msg.messageId}`;
      deduped.set(key, {
        chatId,
        messageId: msg.messageId,
        senderName,
        text,
        date: Math.min(deduped.get(key)?.date ?? msg.date, msg.date),
      });
    }
    if (deduped.size === 0) return;

    await db.query(
      'INSERT INTO telegram_update_cursors(bot_key) VALUES($1) ON CONFLICT DO NOTHING',
      [botKey],
    );

    const values: any[] = [];
    const tuples: string[] = [];
    let param = 1;
    for (const item of deduped.values()) {
      const sentAt = new Date(item.date * 1000);
      const expiresAt = new Date(Math.min(sentAt.getTime(), now.getTime()) + TELEGRAM_MESSAGE_RETENTION_MS);
      tuples.push(`($${param++}, $${param++}, $${param++}, $${param++}, $${param++}, $${param++}, $${param++})`);
      values.push(
        botKey,
        item.chatId,
        item.messageId,
        item.senderName,
        item.text,
        sentAt,
        expiresAt,
      );
    }

    await db.query(
      `INSERT INTO telegram_chat_messages(bot_key, chat_id, message_id, sender_name, text, sent_at, expires_at)
       VALUES ${tuples.join(', ')}
       ON CONFLICT (bot_key, chat_id, message_id) DO UPDATE
       SET sender_name = EXCLUDED.sender_name,
           text = EXCLUDED.text,
           sent_at = LEAST(telegram_chat_messages.sent_at, EXCLUDED.sent_at),
           expires_at = LEAST(telegram_chat_messages.expires_at, EXCLUDED.expires_at)`,
      values,
    );
  }

  async list(
    botKey: string,
    chatId: string,
    limit: number,
    now: Date = new Date(),
    matches?: TelegramMessageFilter,
    signal?: AbortSignal,
  ): Promise<TelegramChatMessage[]> {
    if (typeof chatId !== 'string' || !TELEGRAM_CHAT_ID_PATTERN.test(chatId.trim())) {
      return [];
    }
    const normalizedChatId = normalizeTelegramChatId(chatId);
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.trunc(limit))) : 50;
    const cutoff = new Date(now.getTime() - TELEGRAM_MESSAGE_RETENTION_MS);
    // Page through all eligible messages when searching. The adapter uses the
    // same matcher for stored and pinned text, irrespective of DB collation.
    const batchSize = matches ? 100 : safeLimit;
    const messages: TelegramChatMessage[] = [];
    let after: { sentAt: string; messageId: string } | undefined;
    do {
      signal?.throwIfAborted();
      const res = await this.pool.query<{
        chat_id: string;
        message_id: string;
        sender_name: string;
        text: string;
        sent_at: Date;
        sent_at_cursor: string;
      }>(
        `SELECT chat_id, message_id, sender_name, text, sent_at, sent_at::text AS sent_at_cursor
         FROM telegram_chat_messages
         WHERE bot_key = $1 AND chat_id = $2 AND expires_at > $3 AND sent_at > $4
           ${after ? 'AND (sent_at, message_id) < ($6::timestamptz, $7::bigint)' : ''}
         ORDER BY sent_at DESC, message_id DESC
         LIMIT $5`,
        [botKey, normalizedChatId, now, cutoff, batchSize, ...(after ? [after.sentAt, after.messageId] : [])],
      );
      signal?.throwIfAborted();
      for (const row of res.rows) {
        const message = {
          chatId: row.chat_id,
          messageId: Number(row.message_id),
          senderName: row.sender_name,
          text: row.text,
          date: Math.floor(row.sent_at.getTime() / 1000),
        };
        if (matches && !matches(message)) continue;
        messages.push(message);
        if (messages.length === safeLimit) return messages;
      }
      if (res.rows.length < batchSize) break;
      const last = res.rows[res.rows.length - 1]!;
      after = { sentAt: last.sent_at_cursor, messageId: last.message_id };
    } while (after);
    return messages;
  }

  async purgeExpired(now: Date = new Date()): Promise<number> {
    const res = await this.pool.query(
      'DELETE FROM telegram_chat_messages WHERE expires_at <= $1 OR sent_at <= $2',
      [now, new Date(now.getTime() - TELEGRAM_MESSAGE_RETENTION_MS)],
    );
    return res.rowCount ?? 0;
  }

  startCleanup(onError: (error: unknown) => void, intervalMs = CLEANUP_INTERVAL_MS): () => void {
    let inFlight = false;
    const sweep = () => {
      if (inFlight) return;
      inFlight = true;
      void this.purgeExpired().catch(onError).finally(() => { inFlight = false; });
    };
    const timer = setInterval(sweep, intervalMs);
    timer.unref();
    sweep();
    return () => clearInterval(timer);
  }
}
