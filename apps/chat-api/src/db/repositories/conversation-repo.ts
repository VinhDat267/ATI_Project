import {readScheduleArtifact,captureScheduleArtifact,prelockScheduleArtifacts,scheduleRegistry} from '../../services/slack/slack-schedule-lineage.js';
import {messageFingerprint} from '../../services/slack/slack-message-selectors.js';
import type pg from 'pg';
import { sealMessageOrigin } from '../../services/slack/slack-message-origin.js';
import { validateJiraApprovalBinding } from '../../services/jira/jira-approval-guard.js';
import {
  encodeConversationCursor,
  ConversationDeleteConflictError,
  isRemovableConversationPlanStatus,
  validateConversationPage,
  validateConversationTitle,
  type ConversationPageOptions,
} from './conversation-history.js';
import { isUuid } from './uuid.js';
import { EXECUTION_PLAN_STATUSES, PlanRepo, type PlanRow } from './plan-repo.js';
import { assertConversationAccess, ConversationAccessDeniedError } from '../../services/conversation-access.js';

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

/** Kế hoạch mới nhất của một hội thoại, đang chờ duyệt và chưa hết hạn. */
export interface AttentionPlan {
  conversationId: string;
  title: string | null;
  planId: string;
  summary: string | null;
  stepCount: number;
  expiresAt: string;
}

/** Lượt chạy mới nhất của một hội thoại, dừng ở trạng thái cần người xử lý. */
export interface AttentionRun {
  conversationId: string;
  title: string | null;
  planId: string;
  status: 'partial' | 'unknown' | 'reconciliation_required';
  updatedAt: string;
}

const ATTENTION_RUN_STATUSES = ['partial', 'unknown', 'reconciliation_required'] as const;

function isAttentionRunStatus(status: string): status is AttentionRun['status'] {
  return ATTENTION_RUN_STATUSES.some(candidate => candidate === status);
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
    const where = this.visibleConversationConditions(values, scope);
    where.push(`(
      title IS NOT NULL
      OR EXISTS (SELECT 1 FROM messages WHERE messages.conv_id = conversations.id)
      OR EXISTS (SELECT 1 FROM plans WHERE plans.conv_id = conversations.id)
    )`);
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

  /**
   * Việc đang chờ người dùng (trang chủ, redesign 11/2026), chỉ trong các hội thoại mà listConversationPage cho thấy:
   * kế hoạch mới nhất còn chờ duyệt, và lượt thực thi mới nhất nếu lượt đó cần người xử lý.
   */
  async listAttention(
    userId: string,
    scope?: ConversationScope,
    limit = 8
  ): Promise<{ pendingPlans: AttentionPlan[]; needsAttention: AttentionRun[] }> {
    if (!isUuid(userId)) return { pendingPlans: [], needsAttention: [] };
    const cap = Math.min(Math.max(Math.trunc(limit) || 8, 1), 20);
    const values: unknown[] = [userId];
    const where = this.visibleConversationConditions(values, scope);
    const plans = new PlanRepo(this.pool);
    try {
      const [pendingPlans, needsAttention] = await Promise.all([
        this.readAttentionGroup(plans, where, values, cap, 'pending', async (plan, title): Promise<AttentionPlan | null> => {
          if (plan.status !== 'pending' || plan.expires_at.getTime() <= Date.now()) return null;
          let payload = plan.plan_json;
          if (typeof payload === 'string') {
            try {
              payload = JSON.parse(payload);
            } catch {
              return null;
            }
          }
          if (payload?.connections?.myjira && !(await validateJiraApprovalBinding(this.pool, payload.connections.myjira)).valid) return null;
          // Both rows would open the same conversation, where recovery takes precedence.
          const execution = await plans.getLatestExecutedPlan(plan.conv_id, { omitUnreadable: true });
          if (execution && isAttentionRunStatus(execution.status)) return null;
          return {
            conversationId: plan.conv_id,
            title,
            planId: plan.id,
            summary: typeof payload?.summary === 'string' ? payload.summary : null,
            stepCount: Array.isArray(payload?.steps) ? payload.steps.length : 0,
            expiresAt: plan.expires_at.toISOString(),
          };
        }),
        this.readAttentionGroup(plans, where, values, cap, 'execution', (plan, title): AttentionRun | null => {
          if (!isAttentionRunStatus(plan.status)) return null;
          return {
            conversationId: plan.conv_id,
            title,
            planId: plan.id,
            status: plan.status,
            updatedAt: plan.created_at.toISOString(),
          };
        }),
      ]);
      return { pendingPlans, needsAttention };
    } catch (err: any) {
      if (err?.code === '42703' && scope?.workspaceMode === 'legacy') return this.listAttention(userId, undefined, limit);
      throw err;
    }
  }

  private async readAttentionGroup<T>(
    plans: PlanRepo,
    where: string[],
    scopeValues: unknown[],
    limit: number,
    group: 'pending' | 'execution',
    toItem: (plan: PlanRow, title: string | null) => T | null | Promise<T | null>,
  ): Promise<T[]> {
    const pending = group === 'pending';
    const cursor = scopeValues.length + 1;
    const batchSize = Math.max(limit, 8);
    const items: T[] = [];
    let after: { id: string; timestamp: string } | undefined;
    while (items.length < limit) {
      // Apply the cursor after choosing the latest plan, so pagination cannot
      // promote an older plan or execution from the same conversation.
      const { rows } = await this.pool.query<{ id: string; timestamp: string; conversation: ConversationRow }>(
        `WITH visible AS (SELECT * FROM conversations WHERE ${where.join(' AND ')})
         SELECT p.id, p.created_at::text AS timestamp, to_jsonb(v.*) AS conversation
         FROM visible v
         CROSS JOIN LATERAL (
           SELECT id, status, expires_at, created_at FROM plans
           WHERE conv_id = v.id ${pending ? '' : `AND status = ANY($${cursor + 3}::text[])`}
           ORDER BY created_at DESC, id DESC LIMIT 1
         ) p
         WHERE ${pending ? "p.status = 'pending' AND p.expires_at > now()" : `p.status = ANY($${cursor + 4}::text[])`}
           AND ($${cursor}::timestamptz IS NULL OR (p.created_at, p.id) < ($${cursor}::timestamptz, $${cursor + 1}::uuid))
         ORDER BY p.created_at DESC, p.id DESC
         LIMIT $${cursor + 2}`,
        [ ...scopeValues, after?.timestamp ?? null, after?.id ?? null, batchSize,
          ...(pending ? [] : [EXECUTION_PLAN_STATUSES, ATTENTION_RUN_STATUSES]) ],
      );
      for (const candidate of rows) {
        const plan = await plans.getPlan(candidate.id, 'manual_lookup', { omitUnreadable: true });
        const raw = candidate.conversation;
        if (!plan || plan.conv_id !== raw.id) continue;
        const conversation = await this.safeReadConversation({
          ...raw,
          created_at: new Date(raw.created_at),
          updated_at: new Date(raw.updated_at),
        });
        const item = await toItem(plan, conversation.title ?? null);
        if (item !== null) items.push(item);
        if (items.length === limit) break;
      }
      if (rows.length < batchSize) break;
      after = rows.at(-1);
    }
    return items;
  }

  /** Điều kiện "người dùng được thấy hội thoại này" dùng chung cho lịch sử và việc đang chờ. values[0] phải là userId. */
  private visibleConversationConditions(values: unknown[], scope?: ConversationScope): string[] {
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
    return where;
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

  async deleteConversation(id: string, userId: string, scope: ConversationScope): Promise<boolean> {
    const workspaceId = scope.workspaceMode === 'organization' ? scope.workspaceId : null;
    if (!isUuid(id) || !isUuid(userId) || (scope.workspaceMode === 'organization' && (!workspaceId || !isUuid(workspaceId)))) return false;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '5s'");
      const locked = await client.query(
        `SELECT c.id FROM conversations c JOIN users u ON u.id = c.user_id
         WHERE c.id = $1 AND c.user_id = $2 AND c.workspace_id IS NOT DISTINCT FROM $3::uuid
           AND u.status = 'active'
         FOR UPDATE OF c FOR SHARE OF u`,
        [id, userId, workspaceId],
      );
      if (!locked.rowCount) {
        await client.query('COMMIT');
        return false;
      }
      await assertConversationAccess(client, id, userId, {
        expectedWorkspaceMode: scope.workspaceMode,
        expectedWorkspaceId: workspaceId ?? null,
        lockMembership: true,
      });

      // Serialize with plan approval and execution claims before deciding which rows can be removed.
      const plans = await client.query<{ id: string; status: string }>(
        'SELECT id, status FROM plans WHERE conv_id = $1 ORDER BY id FOR UPDATE',
        [id],
      );
      if (plans.rows.some(plan => !isRemovableConversationPlanStatus(plan.status))) {
        throw new ConversationDeleteConflictError('Hãy xử lý lượt chạy còn dang dở trước khi xoá hội thoại.');
      }
      const planIds = plans.rows.map(plan => plan.id);
      const { rows: [links] } = await client.query<{
        unresolved: boolean; scheduled: boolean; slack: boolean;
      }>(`
        SELECT EXISTS (
          SELECT 1 FROM execution_steps WHERE plan_id = ANY($2::uuid[]) AND status IN ('running', 'unknown')
        ) AS unresolved,
        (EXISTS (SELECT 1 FROM schedules WHERE conv_id = $1)
          OR EXISTS (SELECT 1 FROM schedule_runs WHERE conv_id = $1 OR plan_id = ANY($2::uuid[]))
        ) AS scheduled,
        (EXISTS (SELECT 1 FROM slack_write_outbox WHERE plan_id = ANY($2::uuid[]))
          OR EXISTS (SELECT 1 FROM slack_assistant_artifacts WHERE conv_id = $1 OR active_plan_id = ANY($2::uuid[]))
          OR EXISTS (SELECT 1 FROM slack_derived_artifact_payloads WHERE conv_id = $1)
        ) AS slack`, [id, planIds]);
      if (!links) throw new Error('Conversation links lookup returned no row');
      if (links.unresolved) throw new ConversationDeleteConflictError('Hãy xử lý lượt chạy còn dang dở trước khi xoá hội thoại.');
      if (links.scheduled) throw new ConversationDeleteConflictError('Hội thoại này gắn với lịch tự động hoặc nhật ký chạy của lịch.');
      if (links.slack) throw new ConversationDeleteConflictError('Hội thoại này có dữ liệu Slack cần giữ để đối soát.');

      await client.query('DELETE FROM execution_steps WHERE plan_id = ANY($1::uuid[])', [planIds]);
      await client.query('DELETE FROM plans WHERE conv_id = $1', [id]);
      await client.query('DELETE FROM messages WHERE conv_id = $1', [id]);
      await client.query('DELETE FROM conversations WHERE id = $1', [id]);
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error instanceof ConversationAccessDeniedError) return false;
      if (error && typeof error === 'object' && 'code' in error && error.code === '23503') {
        throw new ConversationDeleteConflictError('Hội thoại còn dữ liệu liên kết cần giữ lại.');
      }
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
