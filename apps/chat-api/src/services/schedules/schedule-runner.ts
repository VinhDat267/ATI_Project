import {captureScheduleArtifact,guardScheduleArtifact,prelockScheduleArtifacts,registerScheduleFields,scheduleRegistry,scheduleSourceContext,tagScheduleContext} from '../slack/slack-schedule-lineage.js';
import type pg from 'pg';
import type { ScheduleRunMessageMetadata } from '@wap/tool-schemas';
import { MessageRepo } from '../../db/repositories/message-repo.js';
import type { Queryable, ScheduleRow } from '../../db/repositories/schedule-repo.js';
import { RUN_SELECT, runState, type RunRow } from './run-state.js';
import { localLabel, nextOccurrence } from './next-occurrence.js';
import type { ScheduleChange } from './schedule-service.js';

export interface RunToPlan {
  runId: string; scheduleId: string; scheduleVersion: number; userId: string;
  name: string; request: string; dueAt: Date; trigger: 'scheduled' | 'manual' | 'replan';
}
export interface PreparedRun {
  /** Writes the result with the client of the transaction that holds the schedule row. */
  persist(client: pg.PoolClient): Promise<{ state: 'planned'; planId: string } | { state: 'needs_attention' }>;
  /** Emits SSE after COMMIT. */
  afterCommit(): void;
}
export type PlanRun = (run: RunToPlan, convId: string, signal: AbortSignal) => Promise<PreparedRun>;

/** The message a run is planned from (design 5.5), saved first in the run's conversation. */
export function runMessage(run: Pick<RunToPlan, 'name' | 'request' | 'dueAt'>, timeZone: string): string {
  return `${run.request}\n\n(Lượt chạy theo lịch "${run.name}" lúc ${localLabel(run.dueAt, timeZone)}.)`;
}

export interface ScheduleRunnerOptions {
  pool: pg.Pool;
  planRun: PlanRun;
  timeZone: string;
  /** Writes the state message of a schedule the runner paused or completed (ScheduleService.recordState). */
  recordState: (client: Queryable, row: ScheduleRow, now: Date) => Promise<ScheduleChange>;
  emit?: (convId: string, event: string, payload: unknown) => unknown;
  now?: () => Date;
  tickMs?: number;
  planTimeoutMs?: number;
}

const LATE_MS = 10 * 60_000;
const DUE_PER_TICK = 5;
/** Uncertified rows stay due. A tick walks past them instead of rereading the same five. */
const SCAN_CAP = 50;
const MAX_MISSED = 1000;
const BLOCKED = 'Tài khoản không còn hoạt động.';
const UNAPPROVED = '3 lượt liền không được duyệt';
const DISCARDED = 'Lịch đã thay đổi trong lúc lập kế hoạch. Kết quả này bị bỏ.';
const FAILED = 'Không lập được kế hoạch lúc này. Hãy thử lại.';
const TIMED_OUT = 'Lập kế hoạch quá thời gian cho phép.';
const STOPPED = 'Máy chủ dừng khi đang lập kế hoạch.';
const INTERRUPTED = 'Máy chủ khởi động lại khi đang lập kế hoạch.';

async function inTransaction<T>(pool: pg.Pool, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Startup: a run that was planning when the server stopped is interrupted, never planned again on its own. */
export async function reconcileScheduleRuns(pool: pg.Pool): Promise<void> {
  const messages = new MessageRepo(pool);
  await inTransaction(pool, async (client) => {
    const res = await client.query(
      "UPDATE schedule_runs SET status='interrupted', error=$1, updated_at=now() WHERE status='planning' RETURNING conv_id", [INTERRUPTED]);
    for (const row of res.rows) {
      if (!row.conv_id) continue;
      // Answer the run's first message, so reopening the conversation ends its planning state.
      const first = (await client.query("SELECT id FROM messages WHERE conv_id=$1 AND metadata->>'type'='schedule_run' ORDER BY created_at, id LIMIT 1", [row.conv_id])).rows[0];
      await messages.createMessage(row.conv_id, 'system', `Lỗi: ${INTERRUPTED}`, { type: 'planning_error', ...(first ? { replyToMessageId: first.id } : {}) }, client);
    }
  });
}

/**
 * Picks up due schedules every tick and plans their runs one at a time. One API
 * instance: schedule rows are claimed with SKIP LOCKED and each scheduled time
 * is unique, but there is no lease (as for W2-01 recovery).
 */
export class ScheduleRunner {
  private messages: MessageRepo;
  private registry;
  private now: () => Date;
  private planTimeoutMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking: Promise<void> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private current: AbortController | null = null;
  private stopping = false;
  private scanCursor: { at: string; id: string } | null = null;

  constructor(private options: ScheduleRunnerOptions) {
    this.messages = new MessageRepo(options.pool);
    this.registry = scheduleRegistry(options.pool);
    this.now = options.now ?? (() => new Date());
    this.planTimeoutMs = options.planTimeoutMs ?? 180_000;
  }

  start(): void {
    const beat = () => {
      if (this.ticking || this.stopping) return;
      this.ticking = this.tick()
        .catch((error) => console.error('[schedules] tick failed:', error instanceof Error ? error.message : error))
        .finally(() => { this.ticking = null; });
    };
    this.timer = setInterval(beat, this.options.tickMs ?? 30_000);
    this.timer.unref?.();
    beat();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.current?.abort();
    await this.ticking;
    await this.queue;
  }

  /** Called after COMMIT only. */
  private send(convId: string, event: string, payload: unknown) {
    try {
      void Promise.resolve(this.options.emit?.(convId, event, payload)).catch(() => undefined);
    } catch { /* A listener cannot undo a committed change. */ }
  }

  private announce(changes: ScheduleChange[]) {
    for (const change of changes) {
      if (change.state) this.send(change.convId, 'schedule_updated', change.sourceBound ? {conversationId:change.convId,reload:true} : { conversationId: change.convId, messageId: change.state.messageId, ...change.state.metadata });
    }
  }

  private async lastThreeExpired(client: pg.PoolClient, scheduleId: string, now: Date): Promise<boolean> {
    const res = await client.query(`${RUN_SELECT} WHERE r.schedule_id=$1 AND r.trigger='scheduled' ORDER BY r.created_at DESC, r.id DESC LIMIT 3`, [scheduleId]);
    return res.rows.length === 3 && res.rows.every((row: RunRow) => runState(row, now) === 'expired');
  }

  private async pause(client: pg.PoolClient, id: string, reason: string): Promise<ScheduleRow> {
    return (await client.query(
      "UPDATE schedules SET status='paused', pause_reason=$2, next_run_at=NULL, version=version+1, updated_at=now() WHERE id=$1 RETURNING *", [id, reason])).rows[0];
  }

  private async advance(client: pg.PoolClient, id: string, next: Date | null): Promise<ScheduleRow> {
    return (await client.query(
      `UPDATE schedules SET next_run_at=$2, status=CASE WHEN $2::timestamptz IS NULL THEN 'completed' ELSE status END, updated_at=now()
       WHERE id=$1 RETURNING *`, [id, next])).rows[0];
  }

  private insertRun(client: pg.PoolClient, row: ScheduleRow, dueAt: Date, status: string, extra: { missedCount?: number; error?: string } = {}) {
    return client.query(
      `INSERT INTO schedule_runs(schedule_id, schedule_version, trigger, due_at, status, missed_count, error)
       VALUES($1, $2, 'scheduled', $3, $4, $5, $6)
       ON CONFLICT (schedule_id, due_at) WHERE trigger = 'scheduled' DO NOTHING RETURNING id`,
      [row.id, row.version, dueAt, status, extra.missedCount ?? 0, extra.error ?? null]);
  }

  /** One tick: claim due schedules, record their runs, then plan the new runs one at a time. */
  async tick(): Promise<void> {
    const now = this.now();
    const { timeZone } = this.options;
    const toPlan: string[] = [];
    const changes:ScheduleChange[]=[];
    // Read only bounded IDs first. Each candidate takes its complete source union
    // before conversation/schedule claims; SKIP LOCKED still applies to both.
    // A refused source-free row keeps its due time, so the cursor moves past it.
    let inspected = 0;
    while (toPlan.length < DUE_PER_TICK && inspected < SCAN_CAP) {
    const scan=await this.options.pool.connect();
    let candidates:any[];
    try{candidates=(await scan.query(`SELECT id, next_run_at::text AS cursor_at FROM schedules WHERE status='active' AND next_run_at<=$1
      AND ($2::timestamptz IS NULL OR (next_run_at, id) > ($2::timestamptz, $3::uuid))
      ORDER BY next_run_at, id LIMIT ${DUE_PER_TICK}`,[now, this.scanCursor?.at ?? null, this.scanCursor?.id ?? null])).rows;}finally{scan.release();}
    if (!candidates.length) { this.scanCursor = null; break; }
    let last: { id: string; cursor_at: string } | null = null;
    for(const candidate of candidates){
      if (toPlan.length >= DUE_PER_TICK) break;
      inspected++;
      last = candidate;
      const committed=await inTransaction(this.options.pool,async(client)=>{
      const changes:ScheduleChange[]=[];
      const state=await captureScheduleArtifact(client,this.registry,'schedules',candidate.id);
      if(!state)return changes;
      await prelockScheduleArtifacts(client,this.registry,[state]);
      const due=await client.query(`SELECT s.*,u.status AS owner_status FROM schedules s JOIN conversations c ON c.id=s.conv_id JOIN users u ON u.id=s.user_id
        WHERE s.id=$2 AND s.status='active' AND s.next_run_at<=$1 FOR UPDATE OF c,s SKIP LOCKED`,[now,candidate.id]);
      for (const row of due.rows as Array<ScheduleRow & { owner_status: string }>) {
        const checked=await guardScheduleArtifact(client,this.registry,state,'planning','UPDATE');
        if(!checked.allowed){if(checked.source)await this.pause(client,row.id,'slack_source_invalidated');continue;}
        const segments=checked.segments;
        tagScheduleContext(row,segments);
        // A run started by hand is still planning; look again next tick.
        if ((await client.query("SELECT 1 FROM schedule_runs WHERE schedule_id=$1 AND status='planning'", [row.id])).rowCount) continue;
        const dueAt = new Date(row.next_run_at!);
        if (row.owner_status !== 'active') {
          await this.insertRun(client, row, dueAt, 'blocked', { error: BLOCKED });
          changes.push(await this.options.recordState(client, tagScheduleContext(await this.pause(client, row.id, BLOCKED),segments), now));
          continue;
        }
        if (now.getTime() - dueAt.getTime() > LATE_MS) {
          // Missed while the server was off: one row for all of them, no write is ever replayed.
          let missed = 0;
          let next: Date | null = dueAt;
          while (next && next.getTime() <= now.getTime() && missed < MAX_MISSED) {
            missed++;
            next = nextOccurrence(row.recurrence, next, timeZone);
          }
          await this.insertRun(client, row, dueAt, 'missed', { missedCount: missed });
          const moved = await this.advance(client, row.id, next);
          if (moved.status === 'completed') changes.push(await this.options.recordState(client, tagScheduleContext(moved,segments), now));
          continue;
        }
        if (await this.lastThreeExpired(client, row.id, now)) {
          changes.push(await this.options.recordState(client, tagScheduleContext(await this.pause(client, row.id, UNAPPROVED),segments), now));
          continue;
        }
        const inserted = await this.insertRun(client, row, dueAt, 'planning');
        const moved = await this.advance(client, row.id, nextOccurrence(row.recurrence, new Date(Math.max(now.getTime(), dueAt.getTime())), timeZone));
        if (moved.status === 'completed') changes.push(await this.options.recordState(client, tagScheduleContext(moved,segments), now));
        if (inserted.rowCount) toPlan.push(inserted.rows[0].id);
      }
      return changes;
      });
      changes.push(...committed);
    }
    this.scanCursor = last && candidates.length === DUE_PER_TICK && toPlan.length < DUE_PER_TICK ? { at: last.cursor_at, id: last.id } : null;
    if (this.scanCursor === null) break;
    }
    this.announce(changes);
    for (const runId of toPlan) await this.planNow(runId);
  }

  /** Queues a planning run; runs are planned one at a time in this process. */
  planNow(runId: string): Promise<void> {
    const job = this.queue.then(() => this.planOne(runId));
    this.queue = job.catch(() => undefined);
    return job;
  }

  private async planOne(runId: string): Promise<void> {
    const { pool, timeZone } = this.options;
    const started = await inTransaction(pool, async (client) => {
      const found=(await client.query('SELECT schedule_id FROM schedule_runs WHERE id=$1',[runId])).rows[0];
      if(!found)return null;
      const state=await captureScheduleArtifact(client,this.registry,'schedules',found.schedule_id);
      const runState=await captureScheduleArtifact(client,this.registry,'schedule_runs',runId);
      if(!state||!runState)return null;
      await prelockScheduleArtifacts(client,this.registry,[state,runState]);
      const checked=await guardScheduleArtifact(client,this.registry,state,'planning','UPDATE');
      const runChecked=await guardScheduleArtifact(client,this.registry,runState,'planning','UPDATE');
      const run={...runChecked.row,user_id:state.owner,name:checked.row.name,request:checked.row.request};
      if(run.status!=='planning')return null;
      if(!checked.allowed||!runChecked.allowed||run.schedule_version!==checked.row.version||checked.row.status==='cancelled'){
        await client.query("UPDATE schedule_runs SET status='discarded',plan_id=NULL,error=$2,updated_at=now() WHERE id=$1",[runId,DISCARDED]);return null;
      }
      const segments=checked.segments;
      const dueAt = new Date(run.due_at);
      const label = localLabel(dueAt, timeZone);
      const convId = (await client.query("INSERT INTO conversations(user_id, status, title) VALUES($1, 'chatting', $2) RETURNING id",
        [run.user_id, `Lịch: ${run.name} · ${label}`])).rows[0].id as string;
      const metadata: ScheduleRunMessageMetadata = { type: 'schedule_run', scheduleId: run.schedule_id, runId: run.id, name: run.name, dueAt: dueAt.toISOString(), trigger: run.trigger };
      await client.query('UPDATE schedule_runs SET conv_id=$2, updated_at=now() WHERE id=$1', [runId, convId]);
      await registerScheduleFields(client,this.registry,'conversations',convId,run.user_id,segments,['title']);
      const content=runMessage({name:run.name,request:run.request,dueAt},timeZone);
      const first=segments.length?await this.messages.createSlackRunMessage(convId,content,metadata,{segments,selectors:['content','metadata.name']},client):
        await this.messages.createMessage(convId,'user',content,metadata,client);
      const toPlan: RunToPlan = { runId: run.id, scheduleId: run.schedule_id, scheduleVersion: run.schedule_version, userId: run.user_id,
        name: run.name, request: run.request, dueAt, trigger: run.trigger };
      return { toPlan:tagScheduleContext(toPlan,segments), convId, messageId: first.id };
    });
    if (!started) return;

    const controller = new AbortController();
    this.current = controller;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.planTimeoutMs);
    let prepared: PreparedRun | null = null;
    let failure: string | null = null;
    try {
      // Do not wait past the limit even if planning ignores its signal.
      const aborted = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
      prepared = await Promise.race([this.options.planRun(started.toPlan, started.convId, controller.signal), aborted]);
    } catch (error) {
      failure = timedOut ? TIMED_OUT : this.stopping ? STOPPED : FAILED;
      if (!timedOut && !this.stopping) console.error('[schedules] planning a run failed:', scheduleSourceContext(started.toPlan)?'SLACK_SCHEDULE_UNAVAILABLE':error instanceof Error ? error.message : error);
    } finally {
      clearTimeout(timer);
      this.current = null;
    }

    // 'planned', the text a run ended with when it has no result to announce, or null when another process ended it.
    const ended = await inTransaction(pool, async (client): Promise<string | null> => {
      const snapshot=await captureScheduleArtifact(client,this.registry,'schedules',started.toPlan.scheduleId);
      if(!snapshot)return null;
      // Include the ORIGINAL run sources even if a replacement schedule now uses
      // a different source set. Prepared plan/message writers only reacquire keys
      // from this prelocked union.
      const original=scheduleSourceContext(started.toPlan)?.segments??[];
      await prelockScheduleArtifacts(client,this.registry,[{...snapshot,segments:[...snapshot.segments,...original]}]);
      let originalAllowed=true;
      if(original.length)try{await this.registry.prepareConversationWriteInTransaction(client,snapshot.convId,snapshot.owner,original,'planning');}catch(error){if(error&&typeof error==='object'&&'code' in error)throw error;originalAllowed=false;}
      const checked=await guardScheduleArtifact(client,this.registry,snapshot,'planning','UPDATE');
      const schedule=checked.row;
      const run = (await client.query('SELECT status FROM schedule_runs WHERE id=$1 FOR UPDATE', [runId])).rows[0];
      if (run?.status !== 'planning') return null;
      // Both endings answer the run's first message, as the error of a chat turn answers its request.
      const replyTo = { replyToMessageId: started.messageId };
      if(!checked.allowed||!originalAllowed){
        await this.messages.createMessage(started.convId,'system',DISCARDED,{type:'schedule_discarded',...replyTo},client);
        await client.query("UPDATE schedule_runs SET status='discarded',plan_id=NULL,error=$2,updated_at=now() WHERE id=$1",[runId,DISCARDED]);return DISCARDED;
      }
      if (failure || !prepared) {
        const text = failure ?? FAILED;
        await this.messages.createMessage(started.convId, 'system', `Lỗi: ${text}`, { type: 'planning_error', ...replyTo }, client);
        await client.query("UPDATE schedule_runs SET status = $2, error=$3, updated_at=now() WHERE id=$1",
          [runId, failure === STOPPED ? 'interrupted' : 'planning_failed', text]);
        return text;
      }
      // Every change by the member bumps the version: a result planned for an older version is dropped.
      if (!checked.allowed || schedule.version !== started.toPlan.scheduleVersion || schedule.status === 'cancelled') {
        await this.messages.createMessage(started.convId, 'system', DISCARDED, { type: 'schedule_discarded', ...replyTo }, client);
        await client.query("UPDATE schedule_runs SET status='discarded', updated_at=now() WHERE id=$1", [runId]);
        return DISCARDED;
      }
      const outcome = await prepared.persist(client);
      await client.query('UPDATE schedule_runs SET status=$2, plan_id=$3, updated_at=now() WHERE id=$1',
        [runId, outcome.state, outcome.state === 'planned' ? outcome.planId : null]);
      return 'planned';
    });
    if (ended === 'planned') prepared!.afterCommit();
    // The page that showed "planning" for this run hears that it ended, once the ending is saved.
    else if (ended) this.send(started.convId, 'error', { conversationId: started.convId, message: ended, replyToMessageId: started.messageId });
  }
}
