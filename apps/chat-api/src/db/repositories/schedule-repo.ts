import type pg from 'pg';
import type { ScheduleKind, ScheduleRecurrence, ScheduleStatus, ScheduleView, SheetsDigestConfig } from '@wap/tool-schemas';
import { RUN_SELECT, runView, type RunRow } from '../../services/schedules/run-state.js';
import { localLabel, nextRuns } from '../../services/schedules/next-occurrence.js';
import { isUuid } from './uuid.js';

export type Queryable = Pick<pg.Pool | pg.PoolClient, 'query'>;

export interface ScheduleScope {
  workspaceMode?: 'legacy' | 'personal' | 'organization';
  workspaceId?: string | null;
}

export interface ScheduleRow {
  id: string;
  user_id: string;
  conv_id: string;
  name: string;
  request: string;
  recurrence: ScheduleRecurrence;
  services: string[];
  status: ScheduleStatus;
  pause_reason: string | null;
  version: number;
  next_run_at: Date | null;
  last_proposal_id: string | null;
  workspace_id?: string | null;
  workspace_mode?: 'legacy' | 'personal' | 'organization';
  kind?: ScheduleKind;
  digest_config?: SheetsDigestConfig | null;
  digest_config_hash?: string | null;
  digest_approved_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** The latest run of the schedule in the outer query, as JSON. */
const LAST_RUN = `(SELECT to_jsonb(x) FROM (${RUN_SELECT} WHERE r.schedule_id = s.id ORDER BY r.created_at DESC, r.id DESC LIMIT 1) x) AS last_run`;

export class ScheduleRepo {
  constructor(private pool: pg.Pool, private timeZone: string) {}

  view(row: ScheduleRow, lastRun: RunRow | null, now: Date): ScheduleView {
    const first = row.status === 'active' && row.next_run_at ? new Date(row.next_run_at) : null;
    const upcoming = first ? [first, ...nextRuns(row.recurrence, first, this.timeZone, 2)] : [];
    const isDigest = row.kind === 'sheets_digest';
    return {
      id: row.id,
      convId: row.conv_id,
      version: row.version,
      name: row.name,
      request: row.request,
      recurrence: row.recurrence,
      services: row.services,
      status: row.status,
      pauseReason: row.pause_reason,
      nextRuns: upcoming.map((d) => d.toISOString()),
      lastRun: lastRun ? runView(lastRun, now) : null,
      ...(isDigest
        ? {
            kind: 'sheets_digest' as const,
            approvalMode: 'auto_digest' as const,
            digestConfig: row.digest_config ?? null,
          }
        : {}),
    };
  }

  /** Vietnamese text of the state message written after each change. */
  stateText(view: ScheduleView): string {
    const name = `Lịch "${view.name}"`;
    switch (view.status) {
      case 'active':
        return `${name} đang bật, phiên bản ${view.version}. Lần chạy tới: ${localLabel(new Date(view.nextRuns[0]!), this.timeZone)}.`;
      case 'paused':
        return `${name} đã tạm dừng${view.pauseReason ? `: ${view.pauseReason}` : ''}.`;
      case 'cancelled':
        return `${name} đã hủy.`;
      case 'completed':
        return `${name} đã chạy xong.`;
    }
  }

  async lastRun(scheduleId: string, db: Queryable = this.pool): Promise<RunRow | null> {
    const res = await db.query(
      `${RUN_SELECT} WHERE r.schedule_id = $1 ORDER BY r.created_at DESC, r.id DESC LIMIT 1`,
      [scheduleId]
    );
    return res.rows[0] ?? null;
  }

  async getByConversation(convId: string, now = new Date()): Promise<ScheduleView | null> {
    if (!isUuid(convId)) return null;
    const res = await this.pool.query(`SELECT s.*, ${LAST_RUN} FROM schedules s WHERE s.conv_id = $1`, [convId]);
    const row = res.rows[0];
    return row ? this.view(row, row.last_run, now) : null;
  }

  /** Open schedules, and closed ones changed in the last 30 days. */
  async listForUser(userId: string, now: Date, scope?: ScheduleScope): Promise<ScheduleView[]> {
    let scopeClause = '';
    const args: any[] = [userId, now];
    if (scope) {
      if (scope.workspaceMode === 'personal') {
        scopeClause = " AND s.workspace_mode IN ('personal', 'legacy') AND s.workspace_id IS NULL";
      } else if (scope.workspaceMode === 'organization' && scope.workspaceId) {
        args.push(scope.workspaceId);
        scopeClause = ` AND s.workspace_mode = 'organization' AND s.workspace_id = $${args.length}`;
      } else if (scope.workspaceMode === 'legacy') {
        scopeClause = " AND s.workspace_id IS NULL";
      }
    }
    const res = await this.pool.query(
      `SELECT s.*, ${LAST_RUN} FROM schedules s
       WHERE s.user_id = $1 AND (s.status IN ('active', 'paused') OR s.updated_at > $2::timestamptz - interval '30 days')${scopeClause}
       ORDER BY s.created_at DESC, s.id DESC`,
      args
    );
    return res.rows.map((row) => this.view(row, row.last_run, now));
  }

  /**
   * With `lock`, locks the schedule's conversation first. Every path takes row
   * locks in one order and never goes back up: the schedule's conversation, the
   * schedule, its owner, its runs, then a run's conversation. Writing a message
   * locks its conversation, so locking the schedule and then writing its state
   * message would deadlock with a confirmation.
   */
  async ownedSchedule(
    id: string,
    userId: string,
    db: Queryable = this.pool,
    lock = false,
    scope?: ScheduleScope
  ): Promise<ScheduleRow | null> {
    if (!isUuid(id)) return null;
    let scopeClause = '';
    const args: any[] = [id, userId];
    if (scope) {
      if (scope.workspaceMode === 'personal') {
        scopeClause = " AND workspace_mode IN ('personal', 'legacy') AND workspace_id IS NULL";
      } else if (scope.workspaceMode === 'organization' && scope.workspaceId) {
        args.push(scope.workspaceId);
        scopeClause = ` AND workspace_mode = 'organization' AND workspace_id = $${args.length}`;
      } else if (scope.workspaceMode === 'legacy') {
        scopeClause = " AND workspace_id IS NULL";
      }
    }
    if (lock) {
      // conv_id never changes, so it can be read before the locks.
      const found = await db.query(`SELECT conv_id FROM schedules WHERE id = $1 AND user_id = $2${scopeClause}`, args);
      if (!found.rowCount) return null;
      await db.query('SELECT id FROM conversations WHERE id = $1 FOR UPDATE', [found.rows[0].conv_id]);
    }
    const res = await db.query(
      `SELECT * FROM schedules WHERE id = $1 AND user_id = $2${scopeClause}${lock ? ' FOR UPDATE' : ''}`,
      args
    );
    return res.rows[0] ?? null;
  }

  async listRuns(scheduleId: string, limit: number, now: Date) {
    const res = await this.pool.query(
      `${RUN_SELECT} WHERE r.schedule_id = $1 ORDER BY r.created_at DESC, r.id DESC LIMIT $2`,
      [scheduleId, limit]
    );
    return res.rows.map((row: RunRow) => runView(row, now));
  }

  async run(runId: string, db: Queryable = this.pool): Promise<RunRow | null> {
    if (!isUuid(runId)) return null;
    const res = await db.query(`${RUN_SELECT} WHERE r.id = $1`, [runId]);
    return res.rows[0] ?? null;
  }

  /** Runs of the member's schedules whose latest plan still waits for approval. */
  async pendingCount(userId: string, now: Date, scope?: ScheduleScope): Promise<number> {
    let scopeClause = '';
    const args: any[] = [userId, now];
    if (scope) {
      if (scope.workspaceMode === 'personal') {
        scopeClause = " AND s.workspace_mode IN ('personal', 'legacy') AND s.workspace_id IS NULL";
      } else if (scope.workspaceMode === 'organization' && scope.workspaceId) {
        args.push(scope.workspaceId);
        scopeClause = ` AND s.workspace_mode = 'organization' AND s.workspace_id = $${args.length}`;
      } else if (scope.workspaceMode === 'legacy') {
        scopeClause = " AND s.workspace_id IS NULL";
      }
    }
    const res = await this.pool.query(
      `SELECT count(*)::int AS n FROM (${RUN_SELECT}) runs JOIN schedules s ON s.id = runs.schedule_id
       WHERE s.user_id = $1 AND runs.status = 'planned' AND runs.plan_status = 'pending' AND runs.plan_expires_at > $2${scopeClause}`,
      args
    );
    return res.rows[0].n;
  }
}
