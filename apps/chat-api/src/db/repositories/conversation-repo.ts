import type pg from 'pg';

export interface ConversationRow {
  id: string;
  user_id: string;
  status: string;
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
    const res = await this.pool.query(
      'SELECT * FROM conversations WHERE id = $1',
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
}
