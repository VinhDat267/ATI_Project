import {readScheduleArtifact,captureScheduleArtifact,prelockScheduleArtifacts,scheduleRegistry} from '../../services/slack/slack-schedule-lineage.js';
import {messageFingerprint} from '../../services/slack/slack-message-selectors.js';
import type pg from 'pg';
import { sealMessageOrigin } from '../../services/slack/slack-message-origin.js';
import {
  encodeConversationCursor,
  validateConversationPage,
  validateConversationTitle,
  type ConversationPageOptions,
} from './conversation-history.js';
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

export interface ConversationScope {
  workspaceMode?: 'legacy' | 'personal' | 'organization';
  workspaceId?: string | null;
  jiraContext?: boolean;
}

export interface ConversationRow {
  id: string;
  user_id: string;
  status: string;
  title: string | null;
  workspace_id?: string | null;
  workspace_mode?: 'legacy' | 'personal' | 'organization';
  jira_context?: boolean;
  created_at: Date;
  updated_at: Date;
}

export class ConversationRepo {
  constructor(private pool: pg.Pool) {}

  getPool(): pg.Pool {
    return this.pool;
  }

  private async insertAndSealConversation(
    queryText: string,
    values: unknown[]
  ): Promise<ConversationRow> {
    if (typeof this.pool.connect !== 'function') {
      const res = await this.pool.query<ConversationRow>(queryText, values);
      const row = res.rows[0];
      if (!row) throw new Error('Insert returned no row');
      return row;
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query<ConversationRow>(queryText, values);
      const row = res.rows[0];
      if (!row) throw new Error('Insert returned no row');
      await client.query('SAVEPOINT conv_origin_seal');
      try {
        await sealMessageOrigin(client, 'conversations', row.id, 'conversation_create');
        await client.query('RELEASE SAVEPOINT conv_origin_seal');
      } catch (sealErr: any) {
        await client.query('ROLLBACK TO SAVEPOINT conv_origin_seal');
        if (sealErr?.code !== '42P01') throw sealErr;
      }
      await client.query('COMMIT');
      delete (row as any).slack_lineage_manifest;
      delete (row as any).slack_title_manual_fingerprint;
      return row;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  private async safeReadConversation(row: ConversationRow): Promise<ConversationRow> {
    if (typeof this.pool.connect !== 'function') return row;
    try {
      return (await readScheduleArtifact(this.pool, 'conversations', row.id)) ?? row;
    } catch (err: any) {
      if (err?.code === '42P01') return row;
      throw err;
    }
  }

  async createConversation(
    userId: string,
    titleOrScope?: string | ConversationScope,
    scopeArg?: ConversationScope
  ): Promise<ConversationRow> {
    if (!isUuid(userId)) {
      throw new ConversationAccessError('Invalid user ID', 'INVALID_USER_ID');
    }

    let title: string | null = null;
    let scope: ConversationScope | undefined = scopeArg;
    if (typeof titleOrScope === 'string') {
      title = titleOrScope;
    } else if (titleOrScope && typeof titleOrScope === 'object') {
      scope = titleOrScope;
    }

    const workspaceMode = scope?.workspaceMode ?? 'legacy';
    const workspaceId = workspaceMode === 'organization' ? scope?.workspaceId ?? null : null;
    const jiraContext = Boolean(scope?.jiraContext);

    // Validate jiraContext invariants: strictly organization mode with valid workspaceId
    if (jiraContext && (workspaceMode !== 'organization' || !workspaceId || !isUuid(workspaceId))) {
      throw new ConversationAccessError(
        'Jira context is only supported in an organization workspace',
        'INVALID_WORKSPACE_SCOPE'
      );
    }

    // Legacy un-scoped conversation
    if (!title && !workspaceId && workspaceMode === 'legacy') {
      return this.insertAndSealConversation(
        `INSERT INTO conversations (user_id, status, workspace_mode, jira_context)
         VALUES ($1, 'chatting', 'legacy', false)
         RETURNING *`,
        [userId]
      );
    }

    // Personal workspace conversation
    if (workspaceMode === 'personal') {
      return this.insertAndSealConversation(
        `INSERT INTO conversations (user_id, status, title, workspace_mode, jira_context)
         VALUES ($1, 'chatting', $2, 'personal', false)
         RETURNING *`,
        [userId, title]
      );
    }

    // Organization workspace conversation (ordinary or Jira)
    if (workspaceMode === 'organization') {
      if (!workspaceId || !isUuid(workspaceId)) {
        throw new ConversationAccessError('Workspace not found', 'WORKSPACE_NOT_FOUND');
      }

      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');

        // 1. Generic workspace lock & existence
        const wsRes = await client.query<{ id: string; name: string }>(
          'SELECT id, name FROM workspaces WHERE id = $1 FOR SHARE',
          [workspaceId]
        );
        if (!wsRes.rows[0]) {
          throw new ConversationAccessError('Workspace not found', 'WORKSPACE_NOT_FOUND');
        }

        // 2. Generic workspace membership lock & check
        const memberRes = await client.query<{ status: string; role: string }>(
          'SELECT status, role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 FOR SHARE',
          [workspaceId, userId]
        );
        if (!memberRes.rows[0] || memberRes.rows[0].status !== 'active') {
          throw new ConversationAccessError('Active workspace membership required', 'WORKSPACE_MEMBERSHIP_REQUIRED');
        }

        // 3. User status lock & check
        const userRes = await client.query<{ status: string }>(
          'SELECT status FROM users WHERE id = $1 FOR SHARE',
          [userId]
        );
        if (!userRes.rows[0] || userRes.rows[0].status !== 'active') {
          throw new ConversationAccessError('Active user required', 'USER_NOT_ACTIVE');
        }

        // 4. Jira layer checks (when jiraContext is true)
        if (jiraContext) {
          // 4a. Jira policy extension
          const jiraWsRes = await client.query<{ id: string; status: string }>(
            'SELECT id, status FROM ati_workspaces WHERE id = $1 FOR SHARE',
            [workspaceId]
          );
          if (!jiraWsRes.rows[0] || jiraWsRes.rows[0].status !== 'active') {
            throw new ConversationAccessError('Jira workspace policy is not active', 'WORKSPACE_NOT_FOUND');
          }

          // 4b. Jira membership
          const jiraMemberRes = await client.query<{ status: string; role: string }>(
            'SELECT status, role FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2 FOR SHARE',
            [workspaceId, userId]
          );
          if (!jiraMemberRes.rows[0] || jiraMemberRes.rows[0].status !== 'active') {
            throw new ConversationAccessError('Active Jira workspace membership required', 'WORKSPACE_MEMBERSHIP_REQUIRED');
          }
        }

        // 5. Insert conversation row
        const res = await client.query<ConversationRow>(
          `INSERT INTO conversations (user_id, status, title, workspace_id, workspace_mode, jira_context)
           VALUES ($1, 'chatting', $2, $3, 'organization', $4)
           RETURNING *`,
          [userId, title, workspaceId, jiraContext]
        );
        const row = res.rows[0];
        if (!row) throw new Error('Insert returned no row');
        await client.query('SAVEPOINT conv_origin_seal');
        try {
          await sealMessageOrigin(client, 'conversations', row.id, 'conversation_create');
          await client.query('RELEASE SAVEPOINT conv_origin_seal');
        } catch (sealErr: any) {
          await client.query('ROLLBACK TO SAVEPOINT conv_origin_seal');
          if (sealErr?.code !== '42P01') throw sealErr;
        }
        await client.query('COMMIT');
        delete (row as any).slack_lineage_manifest;
        delete (row as any).slack_title_manual_fingerprint;
        return row;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    }

    // Default legacy insert with title
    return this.insertAndSealConversation(
      `INSERT INTO conversations (user_id, status, title, workspace_mode, jira_context)
       VALUES ($1, 'chatting', $2, 'legacy', false)
       RETURNING *`,
      [userId, title]
    );
  }

  async listConversations(
    userId: string,
    limit: number = 50,
    scope?: ConversationScope
  ): Promise<ConversationRow[]> {
    if (!isUuid(userId)) return [];
    const values: unknown[] = [userId];
    let scopeClause = '';
    if (scope) {
      if (scope.workspaceMode === 'personal') {
        scopeClause = " AND workspace_mode IN ('personal', 'legacy') AND workspace_id IS NULL";
      } else if (scope.workspaceMode === 'organization' && scope.workspaceId) {
        values.push(scope.workspaceId);
        scopeClause = ` AND workspace_mode = 'organization' AND workspace_id = $${values.length}`;
        // Dual-layer filter: ordinary org conversations require generic membership;
        // Jira conversations require BOTH generic and Jira membership.
        scopeClause += ` AND (
          jira_context IS NOT TRUE OR EXISTS (
            SELECT 1 FROM ati_workspace_memberships jm
            JOIN ati_workspaces jw ON jw.id = jm.workspace_id
            WHERE jm.workspace_id = conversations.workspace_id
              AND jm.user_id = $1
              AND jm.status = 'active'
              AND jw.status = 'active'
          )
        )`;
      } else if (scope.workspaceMode === 'legacy') {
        scopeClause = " AND workspace_id IS NULL";
      }
    } else {
      scopeClause = ` AND (
        workspace_id IS NULL
        OR (
          EXISTS (
            SELECT 1 FROM workspace_members wm
            JOIN workspaces w ON w.id = wm.workspace_id
            WHERE wm.workspace_id = conversations.workspace_id
              AND wm.user_id = $1
              AND wm.status = 'active'
          )
          AND (
            jira_context IS NOT TRUE OR EXISTS (
              SELECT 1 FROM ati_workspace_memberships jm
              JOIN ati_workspaces jw ON jw.id = jm.workspace_id
              WHERE jm.workspace_id = conversations.workspace_id
                AND jm.user_id = $1
                AND jm.status = 'active'
                AND jw.status = 'active'
            )
          )
        )
      )`;
    }
    values.push(limit);
    try {
      const res = await this.pool.query<ConversationRow>(
        `SELECT * FROM conversations
         WHERE user_id = $1${scopeClause}
         ORDER BY updated_at DESC
         LIMIT $${values.length}`,
        values
      );
      return Promise.all(res.rows.map((row) => this.safeReadConversation(row)));
    } catch (err: any) {
      if (err?.code === '42703' && scope?.workspaceMode === 'legacy') {
        return this.listConversations(userId, limit, undefined);
      }
      throw err;
    }
  }

  async getConversation(id: string): Promise<ConversationRow | null> {
    if (!isUuid(id)) return null;
    const res = await this.pool.query<ConversationRow>('SELECT * FROM conversations WHERE id = $1', [id]);
    return res.rows[0] ? this.safeReadConversation(res.rows[0]) : null;
  }

  async getConversationForUser(
    userId: string,
    id: string,
    scope?: ConversationScope
  ): Promise<ConversationRow | null> {
    if (!isUuid(id) || !isUuid(userId)) return null;
    const values: unknown[] = [id, userId];
    let scopeClause = '';
    if (scope) {
      if (scope.workspaceMode === 'personal') {
        scopeClause = " AND workspace_mode IN ('personal', 'legacy') AND workspace_id IS NULL";
      } else if (scope.workspaceMode === 'organization' && scope.workspaceId) {
        values.push(scope.workspaceId);
        scopeClause = ` AND workspace_mode = 'organization' AND workspace_id = $${values.length}`;
        scopeClause += ` AND (
          jira_context IS NOT TRUE OR EXISTS (
            SELECT 1 FROM ati_workspace_memberships jm
            JOIN ati_workspaces jw ON jw.id = jm.workspace_id
            WHERE jm.workspace_id = conversations.workspace_id
              AND jm.user_id = $2
              AND jm.status = 'active'
              AND jw.status = 'active'
          )
        )`;
      } else if (scope.workspaceMode === 'legacy') {
        scopeClause = " AND workspace_id IS NULL";
      }
    }
    try {
      const res = await this.pool.query<ConversationRow>(
        `SELECT * FROM conversations WHERE id = $1 AND user_id = $2${scopeClause}`,
        values
      );
      return res.rows[0] ?? null;
    } catch (err: any) {
      if (err?.code === '42703' && scope?.workspaceMode === 'legacy') {
        return this.getConversationForUser(userId, id, undefined);
      }
      throw err;
    }
  }

  async listConversationPage(
    userId: string,
    options: ConversationPageOptions = {},
    scope?: ConversationScope
  ): Promise<{ conversations: ConversationRow[]; nextCursor: string | null }> {
    if (!isUuid(userId)) return { conversations: [], nextCursor: null };
    const { limit, search, cursor } = validateConversationPage(options);
    const values: unknown[] = [userId];
    const where = ['user_id = $1'];
    if (scope) {
      if (scope.workspaceMode === 'personal') {
        where.push("workspace_mode IN ('personal', 'legacy') AND workspace_id IS NULL");
      } else if (scope.workspaceMode === 'organization' && scope.workspaceId) {
        values.push(scope.workspaceId);
        where.push(`workspace_mode = 'organization' AND workspace_id = $${values.length}`);
        where.push(`(
          jira_context IS NOT TRUE OR EXISTS (
            SELECT 1 FROM ati_workspace_memberships jm
            JOIN ati_workspaces jw ON jw.id = jm.workspace_id
            WHERE jm.workspace_id = conversations.workspace_id
              AND jm.user_id = $1
              AND jm.status = 'active'
              AND jw.status = 'active'
          )
        )`);
      } else if (scope.workspaceMode === 'legacy') {
        where.push("workspace_id IS NULL");
      }
    } else {
      where.push(`(
        workspace_id IS NULL
        OR (
          EXISTS (
            SELECT 1 FROM workspace_members wm
            JOIN workspaces w ON w.id = wm.workspace_id
            WHERE wm.workspace_id = conversations.workspace_id
              AND wm.user_id = $1
              AND wm.status = 'active'
          )
          AND (
            jira_context IS NOT TRUE OR EXISTS (
              SELECT 1 FROM ati_workspace_memberships jm
              JOIN ati_workspaces jw ON jw.id = jm.workspace_id
              WHERE jm.workspace_id = conversations.workspace_id
                AND jm.user_id = $1
                AND jm.status = 'active'
                AND jw.status = 'active'
            )
          )
        )
      )`);
    }
    if (cursor) {
      values.push(cursor.updatedAt, cursor.id);
      where.push(`(updated_at, id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`);
    }
    values.push(search ? 500 : limit + 1);
    try {
      const result = await this.pool.query<ConversationRow & { cursor_updated_at: string }>(
        `SELECT *, to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_updated_at
         FROM conversations WHERE ${where.join(' AND ')} ORDER BY updated_at DESC, id DESC LIMIT $${values.length}`,
        values
      );
      const guarded = await Promise.all(
        result.rows.map(async (row) => ({
          ...(await this.safeReadConversation(row)),
          cursor_updated_at: row.cursor_updated_at,
        }))
      );
      const matching = search
        ? guarded.filter((row) => row.title?.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
        : guarded;
      const visible = matching.slice(0, limit);
      const last =
        matching.length > limit
          ? visible.at(-1)
          : result.rows.length === 500
            ? guarded.at(-1)
            : undefined;
      const nextCursor = last
        ? encodeConversationCursor({ updatedAt: last.cursor_updated_at, id: last.id })
        : null;
      return { conversations: visible.map(({ cursor_updated_at: _timestamp, ...row }) => row), nextCursor };
    } catch (err: any) {
      if (err?.code === '42703' && scope?.workspaceMode === 'legacy') {
        return this.listConversationPage(userId, options, undefined);
      }
      throw err;
    }
  }

  async renameConversation(id: string, userId: string, title: string): Promise<ConversationRow | null> {
    if (!isUuid(id) || !isUuid(userId)) return null;
    const cleaned = validateConversationTitle(title);
    if (typeof this.pool.connect !== 'function') {
      const result = await this.pool.query<ConversationRow>(
        `UPDATE conversations c SET title = $3, updated_at = clock_timestamp() WHERE c.id = $1 AND c.user_id = $2 RETURNING c.*`,
        [id, userId, cleaned]
      );
      return result.rows[0] ?? null;
    }
    const client = await this.pool.connect();
    const registry = scheduleRegistry(this.pool);
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout='5s'");
      const snapshot = await captureScheduleArtifact(client, registry, 'conversations', id);
      if (!snapshot || snapshot.owner !== userId) {
        await client.query('COMMIT');
        return null;
      }
      await prelockScheduleArtifacts(client, registry, [snapshot]);
      await client.query('SELECT id FROM conversations WHERE id=$1 AND user_id=$2 FOR UPDATE', [id, userId]);
      const current = await captureScheduleArtifact(client, registry, 'conversations', id);
      if (JSON.stringify(current?.copies) !== JSON.stringify(snapshot.copies)) {
        throw Error('SLACK_TITLE_CHANGED');
      }
      await client.query(
        "UPDATE slack_derived_copies SET status='retired',retired_at=clock_timestamp(),retired_reason='manual',updated_at=clock_timestamp() WHERE target_kind='scheduled_workflow_arg' AND target_id=$1 AND target_sub_id='title' AND status='active'",
        [id]
      );
      const result = await client.query<ConversationRow>(
        `UPDATE conversations c
         SET title = $3,
             updated_at = now(),
             slack_title_manual_fingerprint = $4,
             slack_lineage_manifest = NULL
         WHERE c.id = $1
           AND c.user_id = $2
           AND (
             c.workspace_id IS NULL
             OR (
               EXISTS (
                 SELECT 1 FROM workspace_members wm
                 JOIN workspaces w ON w.id = wm.workspace_id
                 WHERE wm.workspace_id = c.workspace_id
                   AND wm.user_id = $2
                   AND wm.status = 'active'
               )
               AND (
                 c.jira_context IS NOT TRUE
                 OR EXISTS (
                   SELECT 1 FROM ati_workspace_memberships jm
                   JOIN ati_workspaces jw ON jw.id = jm.workspace_id
                   WHERE jm.workspace_id = c.workspace_id
                     AND jm.user_id = $2
                     AND jm.status = 'active'
                     AND jw.status = 'active'
                 )
               )
             )
           )
         RETURNING c.*`,
        [id, userId, cleaned, messageFingerprint(cleaned, 'title')]
      );
      const row = result.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return null;
      }
      await sealMessageOrigin(client, 'conversations', id, 'title_manual');
      await client.query('COMMIT');
      delete (row as any).slack_lineage_manifest;
      delete (row as any).slack_title_manual_fingerprint;
      return row;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async updateStatus(id: string, status: string): Promise<void> {
    if (!isUuid(id)) return;
    await this.pool.query('UPDATE conversations SET status = $2, updated_at = clock_timestamp() WHERE id = $1', [id, status]);
  }
}
