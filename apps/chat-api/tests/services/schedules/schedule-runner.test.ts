import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { ScheduleRecurrence } from '@wap/tool-schemas';
import { ScheduleRunner, reconcileScheduleRuns, type PlanRun, type PreparedRun, type RunToPlan } from '../../../src/services/schedules/schedule-runner.js';
import { ScheduleService } from '../../../src/services/schedules/schedule-service.js';
import { createMigratedSchema } from '../../helpers/gmail-test-db.js';

const VN = 'Asia/Ho_Chi_Minh';
const daily: ScheduleRecurrence = { type: 'daily', time: '08:00' };
type Db = Awaited<ReturnType<typeof createMigratedSchema>>;
type Person = Awaited<ReturnType<Db['person']>>;

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('ScheduleRunner on PostgreSQL', () => {
  let db: Db, owner: Person, service: ScheduleService, now: Date, calls: RunToPlan[], committed: string[];
  const runners: ScheduleRunner[] = [];
  const pools: pg.Pool[] = [];

  /** A plan written with the caller's client, so it commits with the run. */
  const planned = (run: RunToPlan, convId: string): PreparedRun => ({
    async persist(client) {
      const planId = (await client.query("INSERT INTO plans(conv_id,plan_json,plan_hash,expires_at) VALUES($1,'{}','h',now()+interval '30 minutes') RETURNING id", [convId])).rows[0].id;
      return { state: 'planned', planId };
    },
    afterCommit() { committed.push(run.runId); },
  });
  const planRunOk: PlanRun = async (run, convId) => { calls.push(run); return planned(run, convId); };
  const runner = (options: Partial<ConstructorParameters<typeof ScheduleRunner>[0]> = {}) => {
    const created = new ScheduleRunner({ pool: db.pool, timeZone: VN, now: () => now, planRun: planRunOk,
      recordState: (client, row, at) => service.recordState(client, row, at), ...options });
    runners.push(created);
    return created;
  };
  const schedule = async (next: string | null, recurrence: ScheduleRecurrence = daily, who: Person = owner) => {
    const convId = (await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [who.id])).rows[0].id;
    return (await db.pool.query(`INSERT INTO schedules(user_id,conv_id,name,request,recurrence,services,status,next_run_at)
      VALUES($1,$2,'Lịch họp','Gửi lịch họp hôm nay lên Slack #ati-test',$3,'{calendar,slack}',$4,$5) RETURNING *`,
      [who.id, convId, JSON.stringify(recurrence), next ? 'active' : 'paused', next])).rows[0];
  };
  const runs = async (scheduleId: string) => (await db.pool.query('SELECT * FROM schedule_runs WHERE schedule_id=$1 ORDER BY created_at, id', [scheduleId])).rows;
  const scheduleRow = async (id: string) => (await db.pool.query('SELECT * FROM schedules WHERE id=$1', [id])).rows[0];
  const messages = async (convId: string) => (await db.pool.query('SELECT role, content, metadata FROM messages WHERE conv_id=$1 ORDER BY created_at, id', [convId])).rows;
  const secondPool = async () => {
    const schema = (await db.pool.query('SELECT current_schema() AS s')).rows[0].s;
    const url = new URL(process.env.DATABASE_URL || 'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3');
    url.searchParams.set('options', `-c search_path=${schema}`);
    const pool = new pg.Pool({ connectionString: url.href });
    pools.push(pool);
    return pool;
  };

  beforeAll(async () => { db = await createMigratedSchema('schedule_runner'); });
  beforeEach(async () => {
    // Each case sees only its own schedules: a leftover due schedule would be ticked too.
    await db.pool.query('DELETE FROM schedule_runs; DELETE FROM schedules;');
    owner = await db.person('Chủ lịch');
    service = new ScheduleService({ pool: db.pool, timeZone: VN });
    now = new Date('2026-10-25T01:00:30.000Z'); // 08:00:30 in Viet Nam, Sunday 25/10/2026
    calls = []; committed = [];
  });
  afterEach(async () => { for (const r of runners.splice(0)) await r.stop(); });
  afterAll(async () => { for (const p of pools) await p.end(); await db?.close(); });

  describe('a tick', () => {
    it('plans a due run in its own conversation and moves the schedule on', async () => {
      const s = await schedule('2026-10-25T01:00:00.000Z');
      await runner().tick();
      const [run] = await runs(s.id);
      expect(run).toMatchObject({ status: 'planned', trigger: 'scheduled', schedule_version: 1, missed_count: 0 });
      expect(run.due_at.toISOString()).toBe('2026-10-25T01:00:00.000Z');
      expect((await scheduleRow(s.id)).next_run_at.toISOString()).toBe('2026-10-26T01:00:00.000Z');
      expect(calls).toEqual([expect.objectContaining({ runId: run.id, scheduleId: s.id, scheduleVersion: 1, userId: owner.id,
        name: 'Lịch họp', request: 'Gửi lịch họp hôm nay lên Slack #ati-test', trigger: 'scheduled' })]);
      const conv = (await db.pool.query('SELECT user_id, title FROM conversations WHERE id=$1', [run.conv_id])).rows[0];
      expect(conv).toEqual({ user_id: owner.id, title: 'Lịch: Lịch họp · 25/10 08:00' });
      expect(await messages(run.conv_id)).toEqual([{ role: 'user',
        content: 'Gửi lịch họp hôm nay lên Slack #ati-test\n\n(Lượt chạy theo lịch "Lịch họp" lúc 25/10 08:00.)',
        metadata: { type: 'schedule_run', scheduleId: s.id, runId: run.id, name: 'Lịch họp', dueAt: '2026-10-25T01:00:00.000Z', trigger: 'scheduled' } }]);
      expect(committed).toEqual([run.id]);
    });

    it('calls afterCommit only after the transaction that wrote the plan committed', async () => {
      const s = await schedule('2026-10-25T01:00:00.000Z');
      // Observe the real clients the runner uses: every COMMIT they send, in order.
      const order: string[] = [];
      const wrapped = new WeakSet<object>();
      const observed = new Proxy(db.pool, { get(target, prop, receiver) {
        if (prop !== 'connect') return Reflect.get(target, prop, receiver);
        return async () => {
          const client = await target.connect();
          if (!wrapped.has(client)) {
            wrapped.add(client);
            const query = client.query.bind(client) as (...args: unknown[]) => unknown;
            (client as any).query = (...args: unknown[]) => { if (args[0] === 'COMMIT') order.push('COMMIT'); return query(...args); };
          }
          return client;
        };
      } });
      await runner({ pool: observed, planRun: async (run, convId) => ({
        persist: async (client) => { order.push('persist'); return planned(run, convId).persist(client); },
        afterCommit: () => { order.push('afterCommit'); } }) }).tick();
      expect(order.slice(-3)).toEqual(['persist', 'COMMIT', 'afterCommit']);
      expect((await runs(s.id))[0].status).toBe('planned');
    });

    it('creates one run per scheduled time when two processes tick together', async () => {
      const s = await schedule('2026-10-25T01:00:00.000Z');
      const other = runner({ pool: await secondPool() });
      await Promise.all([runner().tick(), other.tick()]);
      expect(await runs(s.id)).toHaveLength(1);
      expect(calls).toHaveLength(1);
    });

    it('never waits for a schedule another process holds', async () => {
      const s = await schedule('2026-10-25T01:00:00.000Z');
      const holder = await (await secondPool()).connect();
      try {
        await holder.query('BEGIN');
        await holder.query('SELECT id FROM schedules WHERE id=$1 FOR UPDATE', [s.id]);
        const outcome = await Promise.race([runner().tick().then(() => 'done'), new Promise((r) => setTimeout(() => r('blocked'), 2000))]);
        expect(outcome).toBe('done');
        expect(await runs(s.id)).toHaveLength(0);
      } finally {
        await holder.query('ROLLBACK');
        holder.release();
      }
    });

    it('still plans a run that is late by less than 10 minutes', async () => {
      const s = await schedule('2026-10-25T01:00:00.000Z');
      now = new Date('2026-10-25T01:09:59.000Z');
      await runner().tick();
      expect((await runs(s.id)).map((r) => r.status)).toEqual(['planned']);
    });

    it('records the times missed while the server was off as one run and plans nothing', async () => {
      const s = await schedule('2026-10-22T01:00:00.000Z');
      now = new Date('2026-10-25T01:11:00.000Z');
      await runner().tick();
      const all = await runs(s.id);
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({ status: 'missed', missed_count: 4, conv_id: null, plan_id: null });
      expect(all[0].due_at.toISOString()).toBe('2026-10-22T01:00:00.000Z');
      expect((await scheduleRow(s.id)).next_run_at.toISOString()).toBe('2026-10-26T01:00:00.000Z');
      expect(calls).toEqual([]);
    });

    it('completes a one-off schedule once its run is created', async () => {
      const s = await schedule('2026-10-25T01:00:00.000Z', { type: 'once', date: '2026-10-25', time: '08:00' });
      await runner().tick();
      expect(await scheduleRow(s.id)).toMatchObject({ status: 'completed', next_run_at: null, version: 1 });
      expect((await runs(s.id)).map((r) => r.status)).toEqual(['planned']);
      const state = (await messages(s.conv_id)).at(-1);
      expect(state.metadata).toMatchObject({ type: 'schedule_state', schedule: { status: 'completed' } });
    });

    it('leaves a schedule alone while one of its runs is still planning', async () => {
      const s = await schedule('2026-10-25T01:00:00.000Z');
      await db.pool.query("INSERT INTO schedule_runs(schedule_id,schedule_version,trigger,due_at,status) VALUES($1,1,'manual',$2,'planning')", [s.id, now]);
      await runner().tick();
      expect((await runs(s.id)).map((r) => r.trigger)).toEqual(['manual']);
      expect((await scheduleRow(s.id)).next_run_at.toISOString()).toBe('2026-10-25T01:00:00.000Z');
    });

    it('blocks the run and pauses the schedule when the owner is no longer active', async () => {
      const s = await schedule('2026-10-25T01:00:00.000Z');
      await db.pool.query("UPDATE users SET status='disabled' WHERE id=$1", [owner.id]);
      await runner().tick();
      expect((await runs(s.id))[0]).toMatchObject({ status: 'blocked', error: 'Tài khoản không còn hoạt động.' });
      expect(await scheduleRow(s.id)).toMatchObject({ status: 'paused', pause_reason: 'Tài khoản không còn hoạt động.', next_run_at: null, version: 2 });
      expect(calls).toEqual([]);
    });

    it('pauses after three runs in a row were never approved', async () => {
      const s = await schedule('2026-10-25T01:00:00.000Z');
      for (const day of [22, 23, 24]) {
        const convId = (await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [owner.id])).rows[0].id;
        const planId = (await db.pool.query("INSERT INTO plans(conv_id,plan_json,plan_hash,expires_at) VALUES($1,'{}','h',$2) RETURNING id",
          [convId, `2026-10-${day}T01:30:00.000Z`])).rows[0].id;
        await db.pool.query(`INSERT INTO schedule_runs(schedule_id,schedule_version,trigger,due_at,status,conv_id,plan_id,created_at)
          VALUES($1,1,'scheduled',$2,'planned',$3,$4,$2)`, [s.id, `2026-10-${day}T01:00:00.000Z`, convId, planId]);
      }
      const events: string[] = [];
      await runner({ emit: (_conv, event) => { events.push(event); } }).tick();
      expect(await runs(s.id)).toHaveLength(3);
      expect(await scheduleRow(s.id)).toMatchObject({ status: 'paused', pause_reason: '3 lượt liền không được duyệt', version: 2 });
      expect(events).toEqual(['schedule_updated']);
    });
  });

  describe('planning a run', () => {
    it('discards the result when the schedule changed while planning', async () => {
      const s = await schedule('2026-10-25T01:00:00.000Z');
      const gate = deferred<void>();
      let persisted = false;
      const tick = runner({ planRun: async (run, convId) => { await gate.promise; return { ...planned(run, convId), persist: async (c) => { persisted = true; return planned(run, convId).persist(c); } }; } }).tick();
      await expect.poll(async () => (await runs(s.id))[0]?.conv_id ?? null).not.toBeNull();
      await service.setStatus({ userId: owner.id, scheduleId: s.id, action: 'pause', version: 1, now });
      gate.resolve();
      await tick;
      const [run] = await runs(s.id);
      expect(run).toMatchObject({ status: 'discarded', plan_id: null });
      expect(persisted).toBe(false);
      expect((await db.pool.query('SELECT count(*)::int AS n FROM plans WHERE conv_id=$1', [run.conv_id])).rows[0].n).toBe(0);
      expect((await messages(run.conv_id)).at(-1)).toMatchObject({ role: 'system', content: 'Lịch đã thay đổi trong lúc lập kế hoạch. Kết quả này bị bỏ.' });
      expect(committed).toEqual([]);
    });

    it('fails a run whose planning takes longer than the limit, through its signal', async () => {
      const s = await schedule('2026-10-25T01:00:00.000Z');
      let signal: AbortSignal | undefined;
      await runner({ planTimeoutMs: 100, planRun: (_run, _conv, sig) => { signal = sig;
        return new Promise((_resolve, reject) => sig.addEventListener('abort', () => reject(new Error('aborted')))); } }).tick();
      expect(signal?.aborted).toBe(true);
      const [run] = await runs(s.id);
      expect(run).toMatchObject({ status: 'planning_failed', error: 'Lập kế hoạch quá thời gian cho phép.' });
      expect((await messages(run.conv_id)).at(-1)).toMatchObject({ role: 'system', metadata: { type: 'planning_error' } });
    });

    it('fails a run when planning throws', async () => {
      const s = await schedule('2026-10-25T01:00:00.000Z');
      await runner({ planRun: async () => { throw new Error('provider exploded with secret details'); } }).tick();
      const [run] = await runs(s.id);
      expect(run).toMatchObject({ status: 'planning_failed', error: 'Không lập được kế hoạch lúc này. Hãy thử lại.' });
      expect(JSON.stringify(await messages(run.conv_id))).not.toContain('secret details');
    });

    it('records a clarification or refusal as needing attention', async () => {
      const s = await schedule('2026-10-25T01:00:00.000Z');
      await runner({ planRun: async (run) => ({ persist: async () => ({ state: 'needs_attention' }), afterCommit: () => { committed.push(run.runId); } }) }).tick();
      expect((await runs(s.id))[0]).toMatchObject({ status: 'needs_attention', plan_id: null });
      expect(committed).toHaveLength(1);
    });

    it('plans one run at a time across schedules', async () => {
      await schedule('2026-10-25T01:00:00.000Z');
      await schedule('2026-10-25T01:00:00.000Z');
      let active = 0, peak = 0;
      await runner({ planRun: async (run, convId) => {
        active++; peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 30));
        active--;
        return planned(run, convId);
      } }).tick();
      expect(peak).toBe(1);
    });

    it('plans a manual run handed over by planNow', async () => {
      const s = await schedule(null);
      const runId = (await db.pool.query("INSERT INTO schedule_runs(schedule_id,schedule_version,trigger,due_at,status) VALUES($1,1,'manual',$2,'planning') RETURNING id", [s.id, now])).rows[0].id;
      await runner().planNow(runId);
      expect((await runs(s.id))[0]).toMatchObject({ id: runId, status: 'planned' });
    });
  });

  describe('restart', () => {
    it('marks runs that were planning as interrupted without planning them again', async () => {
      const s = await schedule('2026-10-26T01:00:00.000Z');
      const convId = (await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [owner.id])).rows[0].id;
      await db.pool.query("INSERT INTO schedule_runs(schedule_id,schedule_version,trigger,due_at,status,conv_id) VALUES($1,1,'manual',$2,'planning',$3)", [s.id, now, convId]);
      await reconcileScheduleRuns(db.pool);
      expect((await runs(s.id))[0]).toMatchObject({ status: 'interrupted', error: 'Máy chủ khởi động lại khi đang lập kế hoạch.' });
      expect((await messages(convId)).at(-1)).toMatchObject({ role: 'system', metadata: { type: 'planning_error' } });
      await runner().tick();
      expect(calls).toEqual([]);
    });
  });
});
