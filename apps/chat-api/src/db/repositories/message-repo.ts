import type pg from 'pg';

export interface MessageRow {
  id: string;
  conv_id: string;
  role: string;
  content: string;
  metadata: any;
  created_at: Date;
}

export class MessageRepo {
  constructor(private pool: pg.Pool) {}

  async createMessage(
    convId: string,
    role: string,
    content: string,
    metadata?: any
  ): Promise<MessageRow> {
    const res = await this.pool.query(
      `INSERT INTO messages (conv_id, role, content, metadata)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [convId, role, content, metadata ? JSON.stringify(metadata) : null]
    );
    return res.rows[0];
  }

  async listMessages(convId: string, limit: number = 100): Promise<MessageRow[]> {
    const res = await this.pool.query(
      `SELECT * FROM messages
       WHERE conv_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2`,
      [convId, limit]
    );
    return res.rows.reverse();
  }
}
