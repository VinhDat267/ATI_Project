import type pg from 'pg';
import type { ScheduleProposalMetadata, ScheduleResponse, ScheduleRunView, ScheduleStateMetadata, ScheduleView } from '@wap/tool-schemas';
import { MessageRepo } from '../../db/repositories/message-repo.js';
import { ScheduleRepo, type Queryable, type ScheduleRow } from '../../db/repositories/schedule-repo.js';
import { isUuid } from '../../db/repositories/uuid.js';
import { runState, runView } from './run-state.js';
import { nextOccurrence } from './next-occurrence.js';
import { captureScheduleArtifact,guardScheduleArtifact,prelockScheduleArtifacts,registerScheduleFields,scheduleRegistry,scheduleSourceContext,tagScheduleContext } from '../slack/slack-schedule-lineage.js';
import { messageOutputSelectors } from '../slack/slack-message-selectors.js';
import type { DerivedSegmentInput } from '../../db/repositories/slack-derived-lineage-repo.js';

export const SCHEDULE_CONFLICTS = {
  STALE_PROPOSAL: 'Đề xuất này đã cũ. Hãy xem đề xuất mới nhất.',
  LIMIT_REACHED: 'Bạn đã có 10 lịch. Hãy hủy bớt một lịch rồi thử lại.',
  CONVERSATION_HAS_SCHEDULE: 'Hội thoại này đã có lịch. Hãy mở hội thoại mới để tạo lịch khác.',
  SCHEDULE_IN_PAST: 'Giờ hẹn đã qua. Hãy nhắn giờ mới.',
  SCHEDULE_CLOSED: 'Lịch đã hủy hoặc đã chạy xong.',
  STALE_VERSION: 'Lịch vừa thay đổi ở nơi khác. Đã tải lại.',
  RUN_IN_PROGRESS: 'Lịch đang lập kế hoạch cho một lượt. Hãy chờ lượt đó xong.',
  RUN_NOT_REPLANNABLE: 'Lượt này không cần lập lại kế hoạch.',
  SCHEDULE_SOURCE_PURGED: 'Nguồn Slack của đề xuất này chưa thể dùng để tạo lịch. Hãy tạo đề xuất mới.',
} as const;
export type ScheduleConflictCode = keyof typeof SCHEDULE_CONFLICTS;

export class ScheduleConflict extends Error {
  constructor(readonly code: ScheduleConflictCode) { super(SCHEDULE_CONFLICTS[code]); }
}
export class ScheduleNotFound extends Error {
  constructor() { super('Không tìm thấy lịch.'); }
}

/** The schedule after a request, and the state message to announce when something changed. */
export interface ScheduleChange {
  schedule: ScheduleView;
  convId: string;
  /** Null when the request changed nothing (a repeated confirmation, pausing a paused schedule). */
  sourceBound?: boolean;
  state: { messageId: string; metadata: ScheduleStateMetadata } | null;
}

type Action = ScheduleResponse['action'];
type Fields = Pick<ScheduleRow, 'name' | 'request' | 'recurrence' | 'services' | 'status' | 'pause_reason' | 'next_run_at'>;

export interface ScheduleServiceOptions {
  pool: pg.Pool;
  timeZone: string;
  /** Plans a run in the background; the scheduler (SCHED-01) or nothing in tests. */
  runner?: { planNow(runId: string): Promise<void> };
  maxSchedules?: number;
}

const REPLANNABLE = new Set(['expired', 'planning_failed', 'interrupted', 'missed']);
/** Schedules that count toward the limit. */
const OPEN = new Set(['active', 'paused']);

export class ScheduleService {
  readonly repo: ScheduleRepo;
  private messages: MessageRepo;
  private maxSchedules: number;
  private registry;

  constructor(private options: ScheduleServiceOptions) {
    this.repo = new ScheduleRepo(options.pool, options.timeZone);
    this.messages = new MessageRepo(options.pool);
    this.registry = scheduleRegistry(options.pool);
    this.maxSchedules = options.maxSchedules ?? 10;
  }

  private async transaction<T>(work: (client: pg.PoolClient) => Promise<T>, staleCode:'STALE_VERSION'|'STALE_PROPOSAL'='STALE_VERSION'): Promise<T> {
    const client = await this.options.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if(error instanceof Error&&error.message==='SLACK_SCHEDULE_CHANGED')throw new ScheduleConflict(staleCode);
      throw error;
    } finally {
      client.release();
    }
  }

  private next(row: Pick<ScheduleRow, 'recurrence'>, now: Date): Date {
    const next = nextOccurrence(row.recurrence, now, this.options.timeZone);
    if (!next) throw new ScheduleConflict('SCHEDULE_IN_PAST');
    return next;
  }

  /** The fields after `action`, or null when the schedule already is that way. */
  private transition(row: ScheduleRow, action: Action, proposal: ScheduleResponse | null, services: string[] | null, now: Date): Fields | null {
    const closed = row.status === 'cancelled' || row.status === 'completed';
    switch (action) {
      case 'update': {
        if (row.status === 'cancelled') throw new ScheduleConflict('SCHEDULE_CLOSED');
        const fields = { name: proposal!.name!, request: proposal!.request!, recurrence: proposal!.recurrence!, services: services ?? row.services };
        // Changing a one-off schedule that already ran turns it back on.
        const status = row.status === 'paused' ? 'paused' : 'active';
        return { ...fields, status, pause_reason: status === 'paused' ? row.pause_reason : null, next_run_at: status === 'active' ? this.next(fields, now) : null };
      }
      case 'pause':
        if (closed) throw new ScheduleConflict('SCHEDULE_CLOSED');
        return row.status === 'paused' ? null : { ...row, status: 'paused', pause_reason: null, next_run_at: null };
      case 'resume':
        if (closed) throw new ScheduleConflict('SCHEDULE_CLOSED');
        // Times missed while paused are not recorded: the next run counts from now.
        return row.status === 'active' ? null : { ...row, status: 'active', pause_reason: null, next_run_at: this.next(row, now) };
      case 'cancel':
        return row.status === 'cancelled' ? null : { ...row, status: 'cancelled', next_run_at: null };
      case 'create':
        throw new ScheduleConflict('CONVERSATION_HAS_SCHEDULE');
    }
  }

  private async saveFields(client: pg.PoolClient, id: string, fields: Fields, proposalId: string | null, segments: DerivedSegmentInput[] = []): Promise<ScheduleRow> {
    const res = await client.query(
      `UPDATE schedules SET name=$2, request=$3, recurrence=$4, services=$5, status=$6, pause_reason=$7, next_run_at=$8,
         version=version+1, updated_at=now(), last_proposal_id=COALESCE($9, last_proposal_id)
       WHERE id=$1 RETURNING *`,
      [id, fields.name, fields.request, JSON.stringify(fields.recurrence), fields.services, fields.status, fields.pause_reason, fields.next_run_at, proposalId],
    );
    await registerScheduleFields(client,this.registry,'schedules',id,res.rows[0].user_id,segments,['name','request','recurrence']);
    return tagScheduleContext(res.rows[0],segments);
  }

  /** Writes the state message in the same transaction as the change. */
  async recordState(client: Queryable, row: ScheduleRow, now: Date): Promise<ScheduleChange> {
    const schedule = this.repo.view(row, await this.repo.lastRun(row.id, client), now);
    const metadata: ScheduleStateMetadata = { type: 'schedule_state', schedule };
    const context=scheduleSourceContext(row),content=this.repo.stateText(schedule);
    const message = context ? await this.messages.createSlackMessage(row.conv_id,'assistant',content,metadata,{...context,selectors:messageOutputSelectors({content,metadata})},client as pg.PoolClient) : await this.messages.createMessage(row.conv_id,'assistant',content,metadata,client);
    return { schedule, convId: row.conv_id, sourceBound:!!context, state: { messageId: message.id, metadata } };
  }

  private async unchanged(client: Queryable, row: ScheduleRow, now: Date): Promise<ScheduleChange> {
    return { schedule: this.repo.view(row, await this.repo.lastRun(row.id, client), now), convId: row.conv_id, state: null };
  }

  /** The owner row serializes the count across the member's conversations; it comes after the conversation and schedule locks. */
  private async ensureRoom(client: pg.PoolClient, userId: string): Promise<void> {
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
    const open = await client.query("SELECT count(*)::int AS n FROM schedules WHERE user_id=$1 AND status IN ('active', 'paused')", [userId]);
    if (open.rows[0].n >= this.maxSchedules) throw new ScheduleConflict('LIMIT_REACHED');
  }

  async confirmProposal(input: { userId: string; convId: string; messageId: string; now: Date }): Promise<ScheduleChange> {
    const { userId, convId, messageId, now } = input;
    if (!isUuid(convId) || !isUuid(messageId)) throw new ScheduleNotFound();
    return this.transaction(async (client) => {
      const proposed=await captureScheduleArtifact(client,this.registry,'messages',messageId);
      const existingId=(await client.query('SELECT id FROM schedules WHERE conv_id=$1',[convId])).rows[0]?.id;
      let saved=existingId?await captureScheduleArtifact(client,this.registry,'schedules',existingId):null;
      if(!proposed||proposed.convId!==convId||proposed.owner!==userId)throw new ScheduleNotFound();
      await prelockScheduleArtifacts(client,this.registry,[proposed,saved]);
      const guarded=await guardScheduleArtifact(client,this.registry,proposed,'planning','UPDATE');
      if(!guarded.allowed)throw new ScheduleConflict('SCHEDULE_SOURCE_PURGED');
      const metadata=guarded.row.metadata as ScheduleProposalMetadata;
      if(metadata?.type!=='schedule_proposal')throw new ScheduleNotFound();
      if(!saved){
        const arrived=(await client.query('SELECT id FROM schedules WHERE conv_id=$1',[convId])).rows[0];
        if(arrived){
          saved=await captureScheduleArtifact(client,this.registry,'schedules',arrived.id);
          if(saved?.segments.some(s=>!proposed.segments.some(p=>JSON.stringify(p)===JSON.stringify(s))))throw new ScheduleConflict('STALE_PROPOSAL');
        }
      }
      const checked=saved?await guardScheduleArtifact(client,this.registry,saved,'planning','UPDATE'):null;
      if(checked&&!checked.allowed)throw new ScheduleConflict('SCHEDULE_SOURCE_PURGED');
      const existing:ScheduleRow|undefined=checked?.row;
      const segments=[...guarded.segments,...(checked?.segments??[])];
      // Confirming an applied proposal again changes nothing.
      if (existing?.last_proposal_id === messageId) return this.unchanged(client, existing, now);
      const latest = await client.query(
        "SELECT id FROM messages WHERE conv_id=$1 AND metadata->>'type'='schedule_proposal' ORDER BY created_at DESC, id DESC LIMIT 1", [convId]);
      if (latest.rows[0].id !== messageId) throw new ScheduleConflict('STALE_PROPOSAL');

      const proposal = metadata.proposal;
      if (proposal.action === 'create') {
        if (existing) throw new ScheduleConflict('CONVERSATION_HAS_SCHEDULE');
        await this.ensureRoom(client, userId);
        const next = this.next({ recurrence: proposal.recurrence! }, now);
        const created = await client.query(
          `INSERT INTO schedules(user_id, conv_id, name, request, recurrence, services, status, next_run_at, last_proposal_id)
           VALUES($1, $2, $3, $4, $5, $6, 'active', $7, $8) RETURNING *`,
          [userId, convId, proposal.name, proposal.request, JSON.stringify(proposal.recurrence), metadata.services, next, messageId],
        );
        await registerScheduleFields(client,this.registry,'schedules',created.rows[0].id,userId,segments,['name','request','recurrence']);
        return this.recordState(client, tagScheduleContext(created.rows[0],segments), now);
      }
      if (!existing || metadata.baseVersion !== existing.version) throw new ScheduleConflict('STALE_PROPOSAL');
      const fields = this.transition(existing, proposal.action, proposal, metadata.services, now);
      if (!fields) {
        await client.query('UPDATE schedules SET last_proposal_id=$2 WHERE id=$1', [existing.id, messageId]);
        return this.unchanged(client, existing, now);
      }
      // Turning a finished schedule back on takes a place again.
      if (!OPEN.has(existing.status) && OPEN.has(fields.status)) await this.ensureRoom(client, userId);
      return this.recordState(client, await this.saveFields(client, existing.id, fields, messageId,segments), now);
    },'STALE_PROPOSAL');
  }

  private async lockSchedule(client:pg.PoolClient,id:string,owner:string):Promise<ScheduleRow|null> {
    if(!isUuid(id))return null;
    const state=await captureScheduleArtifact(client,this.registry,'schedules',id);
    if(!state||state.owner!==owner)return null;
    await prelockScheduleArtifacts(client,this.registry,[state]);
    const guarded=await guardScheduleArtifact(client,this.registry,state,'planning','UPDATE');
    if(!guarded.allowed)throw new ScheduleConflict('SCHEDULE_SOURCE_PURGED');
    return guarded.row;
  }

  async setStatus(input: { userId: string; scheduleId: string; action: 'pause' | 'resume' | 'cancel'; version: number; now: Date }): Promise<ScheduleChange> {
    return this.transaction(async (client) => {
      const row = await this.lockSchedule(client,input.scheduleId,input.userId);
      if (!row) throw new ScheduleNotFound();
      if (row.version !== input.version) throw new ScheduleConflict('STALE_VERSION');
      const fields = this.transition(row, input.action, null, null, input.now);
      if (!fields) return this.unchanged(client, row, input.now);
      return this.recordState(client, await this.saveFields(client, row.id, fields, null,scheduleSourceContext(row)?.segments??[]), input.now);
    });
  }

  list(userId: string, now: Date) {
    return this.repo.listForUser(userId, now);
  }

  async listRuns(userId: string, scheduleId: string, limit: number, now: Date) {
    if (!await this.repo.ownedSchedule(scheduleId, userId)) throw new ScheduleNotFound();
    return this.repo.listRuns(scheduleId, limit, now);
  }

  pendingCount(userId: string, now: Date) {
    return this.repo.pendingCount(userId, now);
  }

  /** Creates a run that plans now ("Chạy lượt này ngay", "Lập lại kế hoạch") and hands it to the scheduler. */
  async startRun(input: ({ scheduleId: string; trigger: 'manual' } | { runId: string; trigger: 'replan' }) & { userId: string; now: Date }): Promise<ScheduleRunView> {
    const { userId, now } = input;
    const row = await this.transaction(async (client) => {
      let scheduleId: string;
      if (input.trigger === 'replan') {
        const previous = await this.repo.run(input.runId,client);
        if (!previous || !await this.repo.ownedSchedule(previous.schedule_id, userId, client)) throw new ScheduleNotFound();
        if (!REPLANNABLE.has(runState(previous, now))) throw new ScheduleConflict('RUN_NOT_REPLANNABLE');
        scheduleId = previous.schedule_id;
      } else {
        scheduleId = input.scheduleId;
      }
      const schedule = await this.lockSchedule(client,scheduleId,userId);
      if (!schedule) throw new ScheduleNotFound();
      // A finished one-off schedule may plan again for a run that needs it, but not start new runs.
      if (schedule.status === 'cancelled' || (input.trigger === 'manual' && schedule.status === 'completed')) throw new ScheduleConflict('SCHEDULE_CLOSED');
      const busy = await client.query("SELECT 1 FROM schedule_runs WHERE schedule_id=$1 AND status='planning'", [schedule.id]);
      if (busy.rowCount) throw new ScheduleConflict('RUN_IN_PROGRESS');
      const created = await client.query(
        `INSERT INTO schedule_runs(schedule_id, schedule_version, trigger, due_at, status) VALUES($1, $2, $3, $4, 'planning') RETURNING *`,
        [schedule.id, schedule.version, input.trigger, now],
      );
      return created.rows[0];
    });
    this.options.runner?.planNow(row.id).catch((error) => console.error('[schedules] planning a run failed:', error instanceof Error ? error.message : error));
    return runView(row, now);
  }
}
