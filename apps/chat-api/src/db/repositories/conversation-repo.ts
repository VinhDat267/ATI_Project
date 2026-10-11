import type pg from 'pg';
import { encodeConversationCursor, validateConversationPage, validateConversationTitle, type ConversationPageOptions } from './conversation-history.js';
import { isUuid } from './uuid.js';

export interface ConversationRow {
  id: string;
  user_id: string;
  status: string;
  title: string | null;
  created_at: Date;
  updated_at: Date;
}

export class ConversationRepo {
  constructor(private pool: pg.Pool) {}

  async createConversation(userId: string): Promise<ConversationRow> {
    const res = await this.pool.query(
      `INSERT INTO conversations (user_id, status)
       VALUES ($1, 'chatting')
       RETURNING *`,
      [userId]
    );
    return res.rows[0];
  }

  async listConversations(userId: string, limit: number = 50): Promise<ConversationRow[]> {
    const res = await this.pool.query(
      `SELECT * FROM conversations
       WHERE user_id = $1
       ORDER BY updated_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return res.rows;
  }

  async getConversation(id: string): Promise<ConversationRow | null> {
    if (!isUuid(id)) return null;
    const res = await this.pool.query(
      'SELECT * FROM conversations WHERE id = $1',
      [id]
    );
    return res.rows[0] || null;
  }

  async listConversationPage(userId: string, options: ConversationPageOptions = {}): Promise<{ conversations: ConversationRow[]; nextCursor: string | null }> {
    const { limit, search, cursor } = validateConversationPage(options);
    const values: unknown[] = [userId];
    const where = ['user_id = $1'];
    if (search) {
      values.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`);
      where.push(`title ILIKE $${values.length} ESCAPE '\\'`);
    }
    if (cursor) {
      values.push(cursor.updatedAt, cursor.id);
      where.push(`(updated_at, id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`);
    }
    values.push(limit + 1);
    const result = await this.pool.query<ConversationRow & { cursor_updated_at: string }>(
      `SELECT *, to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_updated_at
       FROM conversations WHERE ${where.join(' AND ')} ORDER BY updated_at DESC, id DESC LIMIT $${values.length}`, values,
    );
    const visible = result.rows.slice(0, limit);
    const last = visible.at(-1);
    const nextCursor = result.rows.length > limit && last
      ? encodeConversationCursor({ updatedAt: last.cursor_updated_at, id: last.id }) : null;
    return { conversations: visible.map(({ cursor_updated_at: _timestamp, ...row }) => row), nextCursor };
  }

  async renameConversation(id: string, userId: string, title: string): Promise<ConversationRow | null> {
    if (!isUuid(id)) return null;
    const result = await this.pool.query<ConversationRow>(
      'UPDATE conversations SET title=$3, updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *',
      [id, userId, validateConversationTitle(title)],
    );
    return result.rows[0] ?? null;
  }

  async updateStatus(id: string, status: string): Promise<void> {
    await this.pool.query(
      'UPDATE conversations SET status = $2, updated_at = now() WHERE id = $1',
      [id, status]
    );
  }
}
