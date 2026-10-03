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
      `WITH locked_conversation AS (
         SELECT id FROM conversations WHERE id=$1 FOR UPDATE
       ), inserted AS (
         INSERT INTO messages (conv_id, role, content, metadata)
         SELECT id, $2, $3, $4 FROM locked_conversation RETURNING *
       ), touched AS (
         UPDATE conversations SET
           title=CASE WHEN $2='user' THEN COALESCE(title, left($3, 60)) ELSE title END,
           updated_at=now()
         WHERE id=(SELECT conv_id FROM inserted) RETURNING id
       ) SELECT inserted.* FROM inserted JOIN touched ON touched.id=inserted.conv_id`,
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
