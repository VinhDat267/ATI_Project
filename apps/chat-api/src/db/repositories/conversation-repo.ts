import type pg from 'pg';

export interface ConversationRow {
  id: string;
  user_id: string;
  status: string;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
  deleted_at: Date | null;
  title?: string | null;
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

  async listConversations(userId: string, limit: number = 50, filter: 'active' | 'archived' | 'deleted' = 'active'): Promise<ConversationRow[]> {
    const condition = filter === 'deleted' ? 'deleted_at IS NOT NULL'
      : filter === 'archived' ? 'deleted_at IS NULL AND archived_at IS NOT NULL'
      : 'deleted_at IS NULL AND archived_at IS NULL';
    const res = await this.pool.query(
      `SELECT conversations.*,
       (SELECT LEFT(content, 60) FROM messages WHERE conv_id = conversations.id AND role = 'user' ORDER BY created_at ASC, id ASC LIMIT 1) AS title
       FROM conversations
       WHERE user_id = $1 AND ${condition}
       ORDER BY updated_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return res.rows;
  }

  async getConversation(id: string): Promise<ConversationRow | null> {
    const res = await this.pool.query(
      'SELECT * FROM conversations WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );
    return res.rows[0] || null;
  }

  async updateStatus(id: string, status: string): Promise<void> {
    await this.pool.query(
      'UPDATE conversations SET status = $2, updated_at = now() WHERE id = $1',
      [id, status]
    );
  }

  async changeVisibility(id: string, userId: string, action: 'archive' | 'delete' | 'restore'): Promise<ConversationRow> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize against new plan proposals, which lock this same parent row.
      const found = await client.query('SELECT * FROM conversations WHERE id = $1 AND user_id = $2 FOR UPDATE', [id, userId]);
      const conversation = found.rows[0];
      if (!conversation || (conversation.deleted_at && action === 'archive'))
        throw Object.assign(new Error('Không tìm thấy hội thoại.'), { status: 404 });
      if (action !== 'restore') {
        const unresolved = await client.query(
          `SELECT id FROM plans WHERE conv_id = $1
           AND status NOT IN ('completed', 'failed', 'rejected', 'expired', 'superseded', 'stopped')
           AND NOT (status = 'pending' AND expires_at <= now()) FOR UPDATE`, [id]);
        if (unresolved.rowCount)
          throw Object.assign(new Error('Hãy hủy kế hoạch chờ duyệt hoặc kết thúc quy trình trước khi lưu trữ hay xóa hội thoại.'), { status: 409 });
      }
      const values = action === 'restore' ? 'archived_at = NULL, deleted_at = NULL'
        : action === 'archive' ? 'archived_at = COALESCE(archived_at, now())'
        : 'deleted_at = COALESCE(deleted_at, now())';
      const changed = await client.query(`UPDATE conversations SET ${values}, updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING *`, [id, userId]);
      await client.query('COMMIT');
      return changed.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
}
