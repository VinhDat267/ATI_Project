import type pg from 'pg';
import type { ScheduleRecurrence, ScheduleStatus, ScheduleView } from '@wap/tool-schemas';
import { RUN_SELECT, runView, type RunRow } from '../../services/schedules/run-state.js';
import { localLabel, nextRuns } from '../../services/schedules/next-occurrence.js';
import { isUuid } from './uuid.js';

export type Queryable = Pick<pg.Pool | pg.PoolClient, 'query'>;

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
    return {
      id: row.id, convId: row.conv_id, version: row.version,
      name: row.name, request: row.request, recurrence: row.recurrence, services: row.services,
      status: row.status, pauseReason: row.pause_reason,
      nextRuns: upcoming.map((d) => d.toISOString()),
      lastRun: lastRun ? runView(lastRun, now) : null,
    };
  }

  /** Vietnamese text of the state message written after each change. */
  stateText(view: ScheduleView): string {
    const name = `Lịch "${view.name}"`;
    switch (view.status) {
      case 'active': return `${name} đang bật, phiên bản ${view.version}. Lần chạy tới: ${localLabel(new Date(view.nextRuns[0]!), this.timeZone)}.`;
      case 'paused': return `${name} đã tạm dừng${view.pauseReason ? `: ${view.pauseReason}` : ''}.`;
      case 'cancelled': return `${name} đã hủy.`;
      case 'completed': return `${name} đã chạy xong.`;
    }
  }

  async lastRun(scheduleId: string, db: Queryable = this.pool): Promise<RunRow | null> {
    const res = await db.query(`${RUN_SELECT} WHERE r.schedule_id = $1 ORDER BY r.created_at DESC, r.id DESC LIMIT 1`, [scheduleId]);
    return res.rows[0] ?? null;
  }

  async getByConversation(convId: string, now = new Date()): Promise<ScheduleView | null> {
    if (!isUuid(convId)) return null;
    const res = await this.pool.query(`SELECT s.*, ${LAST_RUN} FROM schedules s WHERE s.conv_id = $1`, [convId]);
    const row = res.rows[0];
    return row ? this.view(row, row.last_run, now) : null;
  }

  /** Open schedules, and closed ones changed in the last 30 days. */
  async listForUser(userId: string, now: Date): Promise<ScheduleView[]> {
    const res = await this.pool.query(
      `SELECT s.*, ${LAST_RUN} FROM schedules s
       WHERE s.user_id = $1 AND (s.status IN ('active', 'paused') OR s.updated_at > $2::timestamptz - interval '30 days')
       ORDER BY s.created_at DESC, s.id DESC`,
      [userId, now],
    );
    return res.rows.map((row) => this.view(row, row.last_run, now));
  }

  async ownedSchedule(id: string, userId: string, db: Queryable = this.pool, lock = false): Promise<ScheduleRow | null> {
    if (!isUuid(id)) return null;
    const res = await db.query(`SELECT * FROM schedules WHERE id = $1 AND user_id = $2${lock ? ' FOR UPDATE' : ''}`, [id, userId]);
    return res.rows[0] ?? null;
  }

  async listRuns(scheduleId: string, limit: number, now: Date) {
    const res = await this.pool.query(`${RUN_SELECT} WHERE r.schedule_id = $1 ORDER BY r.created_at DESC, r.id DESC LIMIT $2`, [scheduleId, limit]);
    return res.rows.map((row: RunRow) => runView(row, now));
  }

  async run(runId: string, db: Queryable = this.pool): Promise<RunRow | null> {
    if (!isUuid(runId)) return null;
    const res = await db.query(`${RUN_SELECT} WHERE r.id = $1`, [runId]);
    return res.rows[0] ?? null;
  }

  /** Runs of the member's schedules whose latest plan still waits for approval. */
  async pendingCount(userId: string, now: Date): Promise<number> {
    const res = await this.pool.query(
      `SELECT count(*)::int AS n FROM (${RUN_SELECT}) runs JOIN schedules s ON s.id = runs.schedule_id
       WHERE s.user_id = $1 AND runs.status = 'planned' AND runs.plan_status = 'pending' AND runs.plan_expires_at > $2`,
      [userId, now],
    );
    return res.rows[0].n;
  }
}
