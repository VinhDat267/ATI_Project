import type pg from 'pg';
import { encodeConversationCursor, validateConversationPage, validateConversationTitle, type ConversationPageOptions } from './conversation-history.js';
import { isUuid } from './uuid.js';

export class ConversationAccessError extends Error {
  readonly status = 404;
  readonly code: string;

  constructor(message = 'Conversation not found', code = 'CONVERSATION_NOT_FOUND') {
    super(message);
    this.name = 'ConversationAccessError';
    this.code = code;
  }
}

export interface ConversationRow {
  id: string;
  user_id: string;
  workspace_id?: string | null;
  status: string;
  title: string | null;
  created_at: Date;
  updated_at: Date;
}

export class ConversationRepo {
  constructor(private pool: pg.Pool) {}

  getPool(): pg.Pool {
    return this.pool;
  }

  async createConversation(userId: string, workspaceId?: string | null): Promise<ConversationRow> {
    if (!isUuid(userId)) {
      throw new ConversationAccessError('Invalid user ID', 'INVALID_USER_ID');
    }

    // Scoped workspace conversation
    if (workspaceId !== undefined && workspaceId !== null) {
      if (!isUuid(workspaceId)) {
        throw new ConversationAccessError('Workspace not found', 'WORKSPACE_NOT_FOUND');
      }

      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');

        // Lock hierarchy: ati_workspaces -> ati_workspace_memberships
        const wsRes = await client.query<{ id: string; status: string }>(
          'SELECT id, status FROM ati_workspaces WHERE id = $1 FOR SHARE',
          [workspaceId]
        );
        const ws = wsRes.rows[0];
        if (!ws || ws.status !== 'active') {
          throw new ConversationAccessError('Workspace not found or not active', 'WORKSPACE_NOT_FOUND');
        }

        const memRes = await client.query<{ status: string }>(
          'SELECT status FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2 FOR SHARE',
          [workspaceId, userId]
        );
        const mem = memRes.rows[0];
        if (!mem || mem.status !== 'active') {
          throw new ConversationAccessError('Active workspace membership required', 'WORKSPACE_MEMBERSHIP_REQUIRED');
        }

        const res = await client.query<ConversationRow>(
          `INSERT INTO conversations (user_id, status, workspace_id)
           VALUES ($1, 'chatting', $2)
           RETURNING *`,
          [userId, workspaceId]
        );
        const row = res.rows[0];
        if (!row) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw new ConversationAccessError('Failed to create conversation row', 'CONVERSATION_CREATE_FAILED');
        }
        await client.query('COMMIT');
        return row;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    }

    // Legacy NULL conversation
    const res = await this.pool.query<ConversationRow>(
      `INSERT INTO conversations (user_id, status, workspace_id)
       VALUES ($1, 'chatting', NULL)
       RETURNING *`,
      [userId]
    );
    const row = res.rows[0];
    if (!row) {
      throw new ConversationAccessError('Failed to create conversation row', 'CONVERSATION_CREATE_FAILED');
    }
    return row;
  }

  async listConversations(userId: string, limit: number = 50): Promise<ConversationRow[]> {
    if (!isUuid(userId)) return [];
    const res = await this.pool.query<ConversationRow>(
      `SELECT c.* FROM conversations c
       WHERE c.user_id = $1
         AND (
           c.workspace_id IS NULL
           OR EXISTS (
             SELECT 1 FROM ati_workspace_memberships m
             JOIN ati_workspaces w ON w.id = m.workspace_id
             WHERE m.workspace_id = c.workspace_id
               AND m.user_id = $1
               AND m.status = 'active'
               AND w.status = 'active'
           )
         )
       ORDER BY c.updated_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return res.rows;
  }

  async getConversation(id: string): Promise<ConversationRow | null> {
    if (!isUuid(id)) return null;
    const res = await this.pool.query<ConversationRow>(
      'SELECT * FROM conversations WHERE id = $1',
      [id]
    );
    return res.rows[0] || null;
  }

  async listConversationPage(
    userId: string,
    options: ConversationPageOptions = {}
  ): Promise<{ conversations: ConversationRow[]; nextCursor: string | null }> {
    const { limit, search, cursor } = validateConversationPage(options);
    const values: unknown[] = [userId];
    const where = [
      'c.user_id = $1',
      `(c.workspace_id IS NULL OR EXISTS (
        SELECT 1 FROM ati_workspace_memberships m
        JOIN ati_workspaces w ON w.id = m.workspace_id
        WHERE m.workspace_id = c.workspace_id
          AND m.user_id = $1
          AND m.status = 'active'
          AND w.status = 'active'
      ))`
    ];

    if (search) {
      values.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`);
      where.push(`c.title ILIKE $${values.length} ESCAPE '\\'`);
    }
    if (cursor) {
      values.push(cursor.updatedAt, cursor.id);
      where.push(`(c.updated_at, c.id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`);
    }
    values.push(limit + 1);

    const result = await this.pool.query<ConversationRow & { cursor_updated_at: string }>(
      `SELECT c.*, to_char(c.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_updated_at
       FROM conversations c
       WHERE ${where.join(' AND ')}
       ORDER BY c.updated_at DESC, c.id DESC
       LIMIT $${values.length}`,
      values
    );

    const visible = result.rows.slice(0, limit);
    const last = visible.at(-1);
    const nextCursor =
      result.rows.length > limit && last
        ? encodeConversationCursor({ updatedAt: last.cursor_updated_at, id: last.id })
        : null;

    return {
      conversations: visible.map(({ cursor_updated_at: _timestamp, ...row }) => row),
      nextCursor,
    };
  }

  async renameConversation(id: string, userId: string, title: string): Promise<ConversationRow | null> {
    if (!isUuid(id) || !isUuid(userId)) return null;
    const result = await this.pool.query<ConversationRow>(
      `UPDATE conversations c
       SET title = $3, updated_at = clock_timestamp()
       WHERE c.id = $1
         AND c.user_id = $2
         AND (
           c.workspace_id IS NULL
           OR EXISTS (
             SELECT 1 FROM ati_workspace_memberships m
             JOIN ati_workspaces w ON w.id = m.workspace_id
             WHERE m.workspace_id = c.workspace_id
               AND m.user_id = $2
               AND m.status = 'active'
               AND w.status = 'active'
           )
         )
       RETURNING c.*`,
      [id, userId, validateConversationTitle(title)]
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
