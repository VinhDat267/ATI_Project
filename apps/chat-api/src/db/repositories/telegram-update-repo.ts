import type pg from 'pg';
import { TELEGRAM_CURSOR_IDLE_MS, telegramUpdateRetention, type TelegramUpdateStore } from '../../services/telegram/update-inbox.js';

export class TelegramUpdateRepo implements TelegramUpdateStore {
  constructor(private pool: pg.Pool) {}

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
}
