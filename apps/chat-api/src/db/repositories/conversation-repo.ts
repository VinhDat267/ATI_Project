import type pg from 'pg';
import {
  encodeConversationCursor,
  validateConversationPage,
  validateConversationTitle,
  type ConversationPageOptions,
} from './conversation-history.js';
import { isUuid } from './uuid.js';

export interface ConversationScope {
  workspaceMode?: 'legacy' | 'personal' | 'organization';
  workspaceId?: string | null;
}

export interface ConversationRow {
  id: string;
  user_id: string;
  status: string;
  title: string | null;
  workspace_id?: string | null;
  workspace_mode?: 'legacy' | 'personal' | 'organization';
  created_at: Date;
  updated_at: Date;
}

export class ConversationRepo {
  constructor(private pool: pg.Pool) {}

  async createConversation(
    userId: string,
    titleOrScope?: string | ConversationScope,
    scopeArg?: ConversationScope
  ): Promise<ConversationRow> {
    let title: string | null = null;
    let scope: ConversationScope | undefined;
    if (typeof titleOrScope === 'string') {
      title = titleOrScope;
      scope = scopeArg;
    } else if (titleOrScope && typeof titleOrScope === 'object') {
      scope = titleOrScope;
    }
    const workspaceMode = scope?.workspaceMode ?? 'legacy';
    const workspaceId = workspaceMode === 'organization' ? scope?.workspaceId ?? null : null;

    if (!title && !workspaceId && workspaceMode === 'legacy') {
      const res = await this.pool.query(
        `INSERT INTO conversations (user_id, status)
         VALUES ($1, 'chatting')
         RETURNING *`,
        [userId]
      );
      return res.rows[0];
    }

    const res = await this.pool.query(
      `INSERT INTO conversations (user_id, status, title, workspace_id, workspace_mode)
       VALUES ($1, 'chatting', $2, $3, $4)
       RETURNING *`,
      [userId, title, workspaceId, workspaceMode]
    );
    return res.rows[0];
  }

  async listConversations(
    userId: string,
    limit: number = 50,
    scope?: ConversationScope
  ): Promise<ConversationRow[]> {
    const values: unknown[] = [userId];
    let scopeClause = '';
    if (scope) {
      if (scope.workspaceMode === 'personal') {
        scopeClause = " AND workspace_mode IN ('personal', 'legacy') AND workspace_id IS NULL";
      } else if (scope.workspaceMode === 'organization' && scope.workspaceId) {
        values.push(scope.workspaceId);
        scopeClause = ` AND workspace_mode = 'organization' AND workspace_id = $${values.length}`;
      } else if (scope.workspaceMode === 'legacy') {
        scopeClause = " AND workspace_id IS NULL";
      }
    }
    values.push(limit);
    const res = await this.pool.query(
      `SELECT * FROM conversations
       WHERE user_id = $1${scopeClause}
       ORDER BY updated_at DESC
       LIMIT $${values.length}`,
      values
    );
    return res.rows;
  }

  async getConversation(id: string): Promise<ConversationRow | null> {
    if (!isUuid(id)) return null;
    const res = await this.pool.query('SELECT * FROM conversations WHERE id = $1', [id]);
    return res.rows[0] || null;
  }

  async getConversationForUser(
    userId: string,
    id: string,
    scope?: ConversationScope
  ): Promise<ConversationRow | null> {
    if (!isUuid(id)) return null;
    const values: unknown[] = [id, userId];
    let scopeClause = '';
    if (scope) {
      if (scope.workspaceMode === 'personal') {
        scopeClause = " AND workspace_mode IN ('personal', 'legacy') AND workspace_id IS NULL";
      } else if (scope.workspaceMode === 'organization' && scope.workspaceId) {
        values.push(scope.workspaceId);
        scopeClause = ` AND workspace_mode = 'organization' AND workspace_id = $${values.length}`;
      } else if (scope.workspaceMode === 'legacy') {
        scopeClause = " AND workspace_id IS NULL";
      }
    }
    const res = await this.pool.query(
      `SELECT * FROM conversations WHERE id = $1 AND user_id = $2${scopeClause}`,
      values
    );
    return res.rows[0] || null;
  }

  async listConversationPage(
    userId: string,
    options: ConversationPageOptions = {},
    scope?: ConversationScope
  ): Promise<{ conversations: ConversationRow[]; nextCursor: string | null }> {
    const { limit, search, cursor } = validateConversationPage(options);
    const values: unknown[] = [userId];
    const where = ['user_id = $1'];
    if (scope) {
      if (scope.workspaceMode === 'personal') {
        where.push("workspace_mode IN ('personal', 'legacy') AND workspace_id IS NULL");
      } else if (scope.workspaceMode === 'organization' && scope.workspaceId) {
        values.push(scope.workspaceId);
        where.push(`workspace_mode = 'organization' AND workspace_id = $${values.length}`);
      } else if (scope.workspaceMode === 'legacy') {
        where.push("workspace_id IS NULL");
      }
    }
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
       FROM conversations WHERE ${where.join(' AND ')} ORDER BY updated_at DESC, id DESC LIMIT $${values.length}`,
      values
    );
    const visible = result.rows.slice(0, limit);
    const last = visible.at(-1);
    const nextCursor =
      result.rows.length > limit && last
        ? encodeConversationCursor({ updatedAt: last.cursor_updated_at, id: last.id })
        : null;
    return { conversations: visible.map(({ cursor_updated_at: _timestamp, ...row }) => row), nextCursor };
  }

  async renameConversation(id: string, userId: string, title: string): Promise<ConversationRow | null> {
    if (!isUuid(id)) return null;
    const result = await this.pool.query<ConversationRow>(
      'UPDATE conversations SET title=$3, updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *',
      [id, userId, validateConversationTitle(title)]
    );
    return result.rows[0] ?? null;
  }

  async updateStatus(id: string, status: string): Promise<void> {
    await this.pool.query('UPDATE conversations SET status = $2, updated_at = now() WHERE id = $1', [id, status]);
  }
}
