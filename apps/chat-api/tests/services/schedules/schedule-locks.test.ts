import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import type { ScheduleResponse } from '@wap/tool-schemas';
import { ScheduleRunner } from '../../../src/services/schedules/schedule-runner.js';
import { ScheduleConflict, ScheduleService } from '../../../src/services/schedules/schedule-service.js';
import { createMigratedSchema } from '../../helpers/gmail-test-db.js';
import {MessageRepo} from '../../../src/db/repositories/message-repo.js';

const VN = 'Asia/Ho_Chi_Minh';
type Db = Awaited<ReturnType<typeof createMigratedSchema>>;
type Person = Awaited<ReturnType<Db['person']>>;

/**
 * Two transactions that lock the same rows in opposite orders deadlock, and
 * PostgreSQL then aborts one of them (40P01). These cases hold real row locks
 * from another connection to put the transactions in the order that deadlocks.
 */
describe('schedule lock order on PostgreSQL', () => {
  let db: Db, owner: Person, now: Date;
  const pools: pg.Pool[] = [];

  /** A pool whose connections PostgreSQL lists under their own name. */
  const namedPool = async (role: string) => {
    const schema = (await db.pool.query('SELECT current_schema() AS s')).rows[0].s;
    const url = new URL(process.env.DATABASE_URL || 'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3');
    url.searchParams.set('options', `-c search_path=${schema}`);
    const name = `sched-${role}-${randomUUID().slice(0, 8)}`;
    const pool = new pg.Pool({ connectionString: url.href, application_name: name });
    pools.push(pool);
    return { pool, name };
  };
  const waitsForLock = (name: string) => vi.waitFor(async () => expect((await db.pool.query(
    "SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'", [name])).rowCount).toBe(1), { timeout: 5_000, interval: 20 });
  const propose = async (convId: string, proposal: ScheduleResponse, scheduleId: string | null = null, baseVersion: number | null = null) =>
    (await new MessageRepo(db.pool).createMessage(convId,'assistant',proposal.summary,
      {type:'schedule_proposal',proposal,scheduleId,baseVersion,services:['calendar','slack'],nextRuns:[],previous:null})).id;
  const create = (over: Partial<ScheduleResponse> = {}): ScheduleResponse => ({ kind: 'schedule', action: 'create', name: 'Lịch họp',
    request: 'Gửi lịch họp hôm nay lên Slack #ati-test', recurrence: { type: 'daily', time: '08:00' }, summary: 'Mỗi sáng 8 giờ gửi lịch họp.', ...over });
  const confirmed = async (service: ScheduleService, proposal = create()) => {
    const convId = (await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [owner.id])).rows[0].id as string;
    const change = await service.confirmProposal({ userId: owner.id, convId, messageId: await propose(convId, proposal), now });
    return { convId, scheduleId: change.schedule.id };
  };
  const scheduleRow = async (id: string) => (await db.pool.query('SELECT status, version FROM schedules WHERE id=$1', [id])).rows[0];

  beforeAll(async () => { db = await createMigratedSchema('schedule_locks'); });
  beforeEach(async () => {
    await db.pool.query('DELETE FROM schedule_runs; DELETE FROM schedules;');
    owner = await db.person('Chủ lịch');
    now = new Date('2026-10-25T01:00:30.000Z'); // 08:00:30 in Viet Nam, Sunday 25/10/2026
  });
  afterAll(async () => { for (const p of pools) await p.end(); await db?.close(); });

  it('pauses and confirms the same schedule at the same time without a deadlock', async () => {
    const pausing = await namedPool('pause');
    const confirming = await namedPool('confirm');
    const pauses = new ScheduleService({ pool: pausing.pool, timeZone: VN });
    const confirms = new ScheduleService({ pool: confirming.pool, timeZone: VN });
    const { convId, scheduleId } = await confirmed(confirms);
    const rename = await propose(convId, create({ action: 'update', name: 'Lịch họp mới' }), scheduleId, 1);
    const holder = await db.pool.connect();
    let pause: Promise<unknown> | undefined, confirm: Promise<unknown> | undefined;
    try {
      // Hold the schedule so the pause waits first, then the confirmation queues behind it.
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM schedules WHERE id=$1 FOR UPDATE', [scheduleId]);
      pause = pauses.setStatus({ userId: owner.id, scheduleId, action: 'pause', version: 1, now });
      await waitsForLock(pausing.name);
      confirm = confirms.confirmProposal({ userId: owner.id, convId, messageId: rename, now });
      await waitsForLock(confirming.name);
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }
    const [paused, renamed] = await Promise.allSettled([pause!, confirm!]);
    expect(paused).toMatchObject({ status: 'fulfilled', value: { schedule: { status: 'paused', version: 2 } } });
    // The confirmation sees the pause and refuses the proposal written for version 1.
    expect(renamed.status).toBe('rejected');
    expect((renamed as PromiseRejectedResult).reason).toBeInstanceOf(ScheduleConflict);
    expect((renamed as PromiseRejectedResult).reason.code).toBe('STALE_PROPOSAL');
    expect(await scheduleRow(scheduleId)).toEqual({ status: 'paused', version: 2 });
  });

  it('counts a schedule turned back on and a new one under the same owner lock', async () => {
    const setup = new ScheduleService({ pool: db.pool, timeZone: VN });
    await confirmed(setup);
    const finished = await confirmed(setup, create({ name: 'Một lần', recurrence: { type: 'once', date: '2026-10-25', time: '17:00' } }));
    await db.pool.query("UPDATE schedules SET status='completed', next_run_at=NULL WHERE id=$1", [finished.scheduleId]);
    const reopen = await propose(finished.convId, create({ action: 'update', name: 'Một lần' }), finished.scheduleId, 1);
    const fresh = (await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [owner.id])).rows[0].id as string;
    const freshProposal = await propose(fresh, create({ name: 'Lịch mới' }));
    const reopening = await namedPool('reopen');
    const creating = await namedPool('create');
    const holder = await db.pool.connect();
    let reopened: Promise<unknown> | undefined, created: Promise<unknown> | undefined;
    try {
      // With room for two, one open schedule and both requests waiting on the owner: only one may pass.
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [owner.id]);
      reopened = new ScheduleService({ pool: reopening.pool, timeZone: VN, maxSchedules: 2 })
        .confirmProposal({ userId: owner.id, convId: finished.convId, messageId: reopen, now });
      created = new ScheduleService({ pool: creating.pool, timeZone: VN, maxSchedules: 2 })
        .confirmProposal({ userId: owner.id, convId: fresh, messageId: freshProposal, now });
      await waitsForLock(reopening.name);
      await waitsForLock(creating.name);
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }
    const outcomes = await Promise.allSettled([reopened!, created!]);
    expect(outcomes.map((o) => o.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect((outcomes.find((o) => o.status === 'rejected') as PromiseRejectedResult).reason.code).toBe('LIMIT_REACHED');
    expect((await db.pool.query("SELECT count(*)::int AS n FROM schedules WHERE user_id=$1 AND status IN ('active','paused')", [owner.id])).rows[0].n).toBe(2);
  });

  it('never waits for the conversation of a due schedule another transaction holds', async () => {
    const service = new ScheduleService({ pool: db.pool, timeZone: VN });
    const { convId, scheduleId } = await confirmed(service, create({ recurrence: { type: 'once', date: '2026-10-25', time: '09:00' } }));
    now = new Date('2026-10-25T02:00:30.000Z');
    const runner = new ScheduleRunner({ pool: db.pool, timeZone: VN, now: () => now, recordState: (client, row, at) => service.recordState(client, row, at),
      planRun: async () => ({ persist: async () => ({ state: 'needs_attention' }), afterCommit() {} }) });
    const holder = await db.pool.connect();
    try {
      // A confirmation holds the conversation first, then waits for the schedule.
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM conversations WHERE id=$1 FOR UPDATE', [convId]);
      const outcome = await Promise.race([runner.tick().then(() => 'done'), new Promise((r) => setTimeout(() => r('blocked'), 2000))]);
      expect(outcome).toBe('done');
      await holder.query('SELECT id FROM schedules WHERE conv_id=$1 FOR UPDATE NOWAIT', [convId]);
      expect(await scheduleRow(scheduleId)).toEqual({ status: 'active', version: 1 });
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }
    await runner.tick();
    await runner.stop();
    expect(await scheduleRow(scheduleId)).toEqual({ status: 'completed', version: 1 });
    expect((await db.pool.query('SELECT status FROM schedule_runs WHERE schedule_id=$1', [scheduleId])).rows).toEqual([{ status: 'needs_attention' }]);
  });
});
