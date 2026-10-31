import {PlanRepo} from './plan-repo.js';
import type pg from 'pg';
import type { ScheduleRecurrence, ScheduleStatus, ScheduleView } from '@wap/tool-schemas';
import { RUN_SELECT, runView, type RunRow } from '../../services/schedules/run-state.js';
import { localLabel, nextRuns } from '../../services/schedules/next-occurrence.js';
import { readScheduleArtifact,scheduleSourceContext,tagScheduleContext,maskScheduleArtifact } from '../../services/slack/slack-schedule-lineage.js';
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
    return tagScheduleContext({
      id: row.id, convId: row.conv_id, version: row.version,
      name: row.name, request: row.request, recurrence: row.recurrence, services: row.services,
      status: row.status, pauseReason: row.pause_reason,
      nextRuns: upcoming.map((d) => d.toISOString()),
      lastRun: lastRun ? runView(lastRun, now) : null,
    },scheduleSourceContext(row)?.segments??[]);
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
    const row=res.rows[0];
    if(!row)return null;
    if(db===this.pool)return this.safeRun(row);
    // A caller holding schedule parents must never discover new source keys late.
    const registered=(await db.query("SELECT 1 FROM slack_derived_copies WHERE target_kind='scheduled_workflow_arg' AND target_id=$1 AND target_sub_id='error' LIMIT 1",[row.id])).rowCount;
    if(row.slack_lineage_manifest!=null||registered)row.error=row.error==null?null:'Slack content is unavailable.';
    return row;
  }

  async getByConversation(convId: string, now = new Date(), purpose: 'manual_lookup'|'planning' = 'manual_lookup'): Promise<ScheduleView | null> {
    if (!isUuid(convId)) return null;
    const res = await this.pool.query(`SELECT s.*, ${LAST_RUN} FROM schedules s WHERE s.conv_id = $1`, [convId]);
    const row = res.rows[0];
    const safe=row?await readScheduleArtifact(this.pool,'schedules',row.id,purpose):null;
    return safe ? this.view(safe, await this.lastRun(safe.id), now) : null;
  }

  /** Open schedules, and closed ones changed in the last 30 days. */
  async listForUser(userId: string, now: Date): Promise<ScheduleView[]> {
    const res = await this.pool.query(
      `SELECT s.*, ${LAST_RUN} FROM schedules s
       WHERE s.user_id = $1 AND (s.status IN ('active', 'paused') OR s.updated_at > $2::timestamptz - interval '30 days')
       ORDER BY s.created_at DESC, s.id DESC`,
      [userId, now],
    );
    return Promise.all(res.rows.map(async row=>{const safe=await readScheduleArtifact(this.pool,'schedules',row.id);return this.view(safe,await this.lastRun(row.id),now);}));
  }

  /**
   * With `lock`, locks the schedule's conversation first. Every path takes row
   * locks in one order and never goes back up: the schedule's conversation, the
   * schedule, its owner, its runs, then a run's conversation. Writing a message
   * locks its conversation, so locking the schedule and then writing its state
   * message would deadlock with a confirmation.
   */
  async ownedSchedule(id: string, userId: string, db: Queryable = this.pool, lock = false): Promise<ScheduleRow | null> {
    if (!isUuid(id)) return null;
    if(db===this.pool){const row=await readScheduleArtifact(this.pool,'schedules',id);return row?.user_id===userId?row:null;}
    if (lock) {
      // conv_id never changes, so it can be read before the locks.
      const found = await db.query('SELECT conv_id FROM schedules WHERE id = $1 AND user_id = $2', [id, userId]);
      if (!found.rowCount) return null;
      await db.query('SELECT id FROM conversations WHERE id = $1 FOR UPDATE', [found.rows[0].conv_id]);
    }
    const res = await db.query(`SELECT * FROM schedules WHERE id = $1 AND user_id = $2${lock ? ' FOR UPDATE' : ''}`, [id, userId]);
    return res.rows[0] ?? null;
  }

  async listRuns(scheduleId: string, limit: number, now: Date) {
    const res = await this.pool.query(`${RUN_SELECT} WHERE r.schedule_id = $1 ORDER BY r.created_at DESC, r.id DESC LIMIT $2`, [scheduleId, limit]);
    return Promise.all(res.rows.map(async (row:RunRow)=>runView(await this.safeRun(row),now)));
  }

  async run(runId: string, db: Queryable = this.pool): Promise<RunRow | null> {
    if (!isUuid(runId)) return null;
    const res = await db.query(`${RUN_SELECT} WHERE r.id = $1`, [runId]);
    return res.rows[0] ? (db===this.pool?this.safeRun(res.rows[0]):res.rows[0]) : null;
  }

  private async safeRun(row:any):Promise<any>{
    const schedule=await readScheduleArtifact(this.pool,'schedules',row.schedule_id);
    const safe=await readScheduleArtifact(this.pool,'schedule_runs',row.id);
    return schedule?.pause_reason==='slack_source_invalidated'?maskScheduleArtifact({...row,...safe},'schedule_runs'):{...row,...safe};
  }

  /** Runs of the member's schedules whose latest plan still waits for approval. */
  async pendingCount(userId: string, now: Date): Promise<number> {
    const res = await this.pool.query(
      `SELECT runs.* FROM (${RUN_SELECT}) runs JOIN schedules s ON s.id = runs.schedule_id
       WHERE s.user_id = $1 AND runs.status = 'planned' AND runs.plan_status = 'pending' AND runs.plan_expires_at > $2`,
      [userId, now],
    );
    let count=0;const plans=new PlanRepo(this.pool);
    for(const row of res.rows){const safe=await this.safeRun(row);if(safe.status!=='planned')continue;const plan=await plans.getPlan(safe.latest_plan_id??safe.plan_id);if(plan?.status==='pending'&&new Date(plan.expires_at)>now)count++;}
    return count;
  }
}
