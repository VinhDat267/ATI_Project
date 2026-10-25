import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { ScheduleResponse } from '@wap/tool-schemas';
import { createApp } from '../../src/app.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { ScheduleService } from '../../src/services/schedules/schedule-service.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

const secret = 'schedule_routes_test_secret_at_least_32_characters';
const VN = 'Asia/Ho_Chi_Minh';
// Sunday 25/10/2026, 09:00 in Viet Nam.
const NOW = new Date('2026-10-25T02:00:00.000Z');
type Db = Awaited<ReturnType<typeof createMigratedSchema>>;
type Person = Awaited<ReturnType<Db['person']>>;

const create = (over: Partial<ScheduleResponse> = {}): ScheduleResponse => ({ kind: 'schedule', action: 'create', name: 'Lịch họp hằng ngày',
  request: 'Gửi lịch họp hôm nay lên Slack #ati-test', recurrence: { type: 'daily', time: '08:00' }, summary: 'Mỗi sáng 8 giờ gửi lịch họp.', ...over });

describe('schedule routes over HTTP and PostgreSQL', () => {
  let db: Db, alice: Person, bob: Person, now: Date, events: Array<{ convId: string; event: string; payload: any; committed: boolean }>;
  let planned: string[], app: ReturnType<typeof createApp>;
  const bearer = (who: Person) => `Bearer ${generateAccessToken(who, secret, who.sid).accessToken}`;
  const api = (who: Person) => ({
    get: (path: string) => request(app).get(path).set('Authorization', bearer(who)),
    post: (path: string, body: object = {}) => request(app).post(path).set('Authorization', bearer(who)).send(body),
  });
  const conversation = async (who: Person) => (await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [who.id])).rows[0].id as string;
  const propose = async (convId: string, proposal: ScheduleResponse, scheduleId: string | null = null, baseVersion: number | null = null) =>
    (await db.pool.query("INSERT INTO messages(conv_id,role,content,metadata) VALUES($1,'assistant',$2,$3) RETURNING id", [convId, proposal.summary,
      JSON.stringify({ type: 'schedule_proposal', proposal, scheduleId, baseVersion, services: ['calendar', 'slack'], nextRuns: [], previous: null })])).rows[0].id as string;
  const confirm = (who: Person, convId: string, messageId: string) => api(who).post(`/api/conversations/${convId}/schedule-proposals/${messageId}/confirm`);
  /** A confirmed daily schedule owned by `who`. */
  const scheduled = async (who: Person, proposal = create()) => {
    const convId = await conversation(who);
    const r = await confirm(who, convId, await propose(convId, proposal));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return { convId, schedule: r.body.schedule };
  };
  const stateMessages = async (convId: string) => (await db.pool.query(
    "SELECT metadata FROM messages WHERE conv_id=$1 AND metadata->>'type'='schedule_state' ORDER BY created_at, id", [convId])).rows.map((r) => r.metadata);
  const run = async (scheduleId: string, status: string, plan?: { status: string; expiresAt: Date }) => {
    const owner = (await db.pool.query('SELECT user_id FROM schedules WHERE id=$1', [scheduleId])).rows[0].user_id;
    const convId = (await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [owner])).rows[0].id;
    const planId = plan ? (await db.pool.query('INSERT INTO plans(conv_id,plan_json,plan_hash,expires_at,status) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [convId, '{}', 'hash', plan.expiresAt, plan.status])).rows[0].id : null;
    return (await db.pool.query(`INSERT INTO schedule_runs(schedule_id,schedule_version,trigger,due_at,status,conv_id,plan_id)
      VALUES($1,1,'manual',$2,$3,$4,$5) RETURNING id`, [scheduleId, new Date(NOW.getTime() - 3_600_000), status, convId, planId])).rows[0].id as string;
  };

  beforeAll(async () => {
    db = await createMigratedSchema('schedule_routes');
  });
  beforeEach(async () => {
    now = NOW; events = []; planned = [];
    alice = await db.person('Alice'); bob = await db.person('Bob');
    const service = new ScheduleService({ pool: db.pool, timeZone: VN, runner: { planNow: async (id: string) => { planned.push(id); } } });
    app = createApp({ jwtSecret: secret, userRepo: db.users, schedules: { service, clock: () => now,
      emit: async (convId: string, event: string, payload: any) => {
        // Listeners must only hear about committed changes.
        const committed = (await db.pool.query('SELECT 1 FROM messages WHERE id=$1', [payload.messageId])).rowCount === 1;
        events.push({ convId, event, payload, committed });
      } } } as any);
  });
  afterAll(async () => { await db?.close(); });

  describe('flag', () => {
    it('reports schedules in health only when mounted', async () => {
      expect((await request(app).get('/api/health')).body.schedulesEnabled).toBe(true);
      const off = createApp({ jwtSecret: secret, userRepo: db.users } as any);
      expect((await request(off).get('/api/health')).body).not.toHaveProperty('schedulesEnabled');
      expect((await request(off).get('/api/schedules').set('Authorization', bearer(alice))).status).toBe(404);
      expect((await request(off).get('/api/schedules/pending-count').set('Authorization', bearer(alice))).status).toBe(404);
    });
  });

  describe('confirming proposals', () => {
    it('creates a schedule, records its state and announces it after commit', async () => {
      const convId = await conversation(alice);
      const r = await confirm(alice, convId, await propose(convId, create()));
      expect(r.status).toBe(200);
      expect(r.body.schedule).toMatchObject({ convId, version: 1, name: 'Lịch họp hằng ngày', request: 'Gửi lịch họp hôm nay lên Slack #ati-test',
        recurrence: { type: 'daily', time: '08:00' }, services: ['calendar', 'slack'], status: 'active', pauseReason: null, lastRun: null,
        nextRuns: ['2026-10-26T01:00:00.000Z', '2026-10-27T01:00:00.000Z', '2026-10-28T01:00:00.000Z'] });
      const states = await stateMessages(convId);
      expect(states).toHaveLength(1);
      expect(states[0].schedule).toMatchObject({ id: r.body.schedule.id, version: 1, status: 'active' });
      expect(events).toEqual([expect.objectContaining({ convId, event: 'schedule_updated', committed: true,
        payload: expect.objectContaining({ conversationId: convId, type: 'schedule_state', schedule: expect.objectContaining({ version: 1 }) }) })]);
    });

    it('applies update, pause, resume and cancel in order of version', async () => {
      const { convId, schedule } = await scheduled(alice);
      const weekly = create({ action: 'update', recurrence: { type: 'weekly', time: '08:30', days: [1, 2, 3, 4, 5] } });
      let r = await confirm(alice, convId, await propose(convId, weekly, schedule.id, 1));
      expect(r.body.schedule).toMatchObject({ version: 2, recurrence: { type: 'weekly', time: '08:30', days: [1, 2, 3, 4, 5] },
        nextRuns: ['2026-10-26T01:30:00.000Z', '2026-10-27T01:30:00.000Z', '2026-10-28T01:30:00.000Z'] });
      r = await confirm(alice, convId, await propose(convId, { kind: 'schedule', action: 'pause', summary: 'Tạm dừng.' }, schedule.id, 2));
      expect(r.body.schedule).toMatchObject({ version: 3, status: 'paused', nextRuns: [] });
      // Three days later: resuming starts from now and records nothing for the paused days.
      now = new Date('2026-10-28T05:00:00.000Z');
      r = await confirm(alice, convId, await propose(convId, { kind: 'schedule', action: 'resume', summary: 'Chạy tiếp.' }, schedule.id, 3));
      expect(r.body.schedule).toMatchObject({ version: 4, status: 'active', nextRuns: expect.arrayContaining(['2026-10-29T01:30:00.000Z']) });
      expect(r.body.schedule.nextRuns[0]).toBe('2026-10-29T01:30:00.000Z');
      expect((await db.pool.query('SELECT count(*)::int AS n FROM schedule_runs WHERE schedule_id=$1', [schedule.id])).rows[0].n).toBe(0);
      r = await confirm(alice, convId, await propose(convId, { kind: 'schedule', action: 'cancel', summary: 'Hủy.' }, schedule.id, 4));
      expect(r.body.schedule).toMatchObject({ version: 5, status: 'cancelled', nextRuns: [] });
      r = await confirm(alice, convId, await propose(convId, create({ action: 'update' }), schedule.id, 5));
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('SCHEDULE_CLOSED');
      expect((await stateMessages(convId)).map((m) => m.schedule.version)).toEqual([1, 2, 3, 4, 5]);
    });

    it('refuses an older proposal and changes nothing', async () => {
      const { convId, schedule } = await scheduled(alice);
      const older = await propose(convId, create({ action: 'update', name: 'Cũ' }), schedule.id, 1);
      const newer = await propose(convId, create({ action: 'update', name: 'Mới' }), schedule.id, 1);
      const r = await confirm(alice, convId, older);
      expect(r.status).toBe(409);
      expect(r.body.error).toEqual({ code: 'STALE_PROPOSAL', message: 'Đề xuất này đã cũ. Hãy xem đề xuất mới nhất.' });
      expect((await db.pool.query('SELECT name, version FROM schedules WHERE id=$1', [schedule.id])).rows[0]).toEqual({ name: 'Lịch họp hằng ngày', version: 1 });
      expect((await confirm(alice, convId, newer)).body.schedule).toMatchObject({ name: 'Mới', version: 2 });
    });

    it('refuses a proposal written against an older version', async () => {
      const { convId, schedule } = await scheduled(alice);
      await db.pool.query('UPDATE schedules SET version=2 WHERE id=$1', [schedule.id]);
      const r = await confirm(alice, convId, await propose(convId, create({ action: 'update' }), schedule.id, 1));
      expect(r.body.error?.code).toBe('STALE_PROPOSAL');
    });

    it('applies the same proposal once when it is confirmed twice at the same time', async () => {
      const convId = await conversation(alice);
      const messageId = await propose(convId, create());
      const [a, b] = await Promise.all([confirm(alice, convId, messageId), confirm(alice, convId, messageId)]);
      expect([a.status, b.status]).toEqual([200, 200]);
      expect(a.body.schedule.id).toBe(b.body.schedule.id);
      expect((await db.pool.query('SELECT count(*)::int AS n FROM schedules WHERE conv_id=$1', [convId])).rows[0].n).toBe(1);
      expect(await stateMessages(convId)).toHaveLength(1);
      expect(events).toHaveLength(1);
    });

    it('refuses a second schedule in one conversation', async () => {
      const { convId } = await scheduled(alice);
      const r = await confirm(alice, convId, await propose(convId, create({ name: 'Lịch thứ hai' })));
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('CONVERSATION_HAS_SCHEDULE');
    });

    it('refuses an eleventh schedule', async () => {
      for (let i = 0; i < 10; i++) await scheduled(alice, create({ name: `Lịch ${i}` }));
      const convId = await conversation(alice);
      const r = await confirm(alice, convId, await propose(convId, create()));
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('LIMIT_REACHED');
      // Bob has his own limit.
      await scheduled(bob);
    });

    it('refuses a one-off time that has already passed when confirmed', async () => {
      const convId = await conversation(alice);
      const messageId = await propose(convId, create({ recurrence: { type: 'once', date: '2026-10-25', time: '10:00' } }));
      now = new Date('2026-10-25T03:00:00.000Z');
      const r = await confirm(alice, convId, messageId);
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('SCHEDULE_IN_PAST');
      expect((await db.pool.query('SELECT count(*)::int AS n FROM schedules WHERE conv_id=$1', [convId])).rows[0].n).toBe(0);
    });

    it('turns a finished one-off schedule back on when it is updated', async () => {
      const { convId, schedule } = await scheduled(alice, create({ recurrence: { type: 'once', date: '2026-10-25', time: '10:00' } }));
      await db.pool.query("UPDATE schedules SET status='completed', next_run_at=NULL WHERE id=$1", [schedule.id]);
      const r = await confirm(alice, convId, await propose(convId, create({ action: 'update', recurrence: { type: 'once', date: '2026-10-25', time: '17:00' } }), schedule.id, 1));
      expect(r.body.schedule).toMatchObject({ status: 'active', version: 2, nextRuns: ['2026-10-25T10:00:00.000Z'] });
    });
  });

  describe('buttons', () => {
    it('pause, resume and cancel need the version the page shows', async () => {
      const { convId, schedule } = await scheduled(alice);
      let r = await api(alice).post(`/api/schedules/${schedule.id}/pause`, { version: 0 });
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('STALE_VERSION');
      r = await api(alice).post(`/api/schedules/${schedule.id}/pause`, { version: 1 });
      expect(r.body.schedule).toMatchObject({ status: 'paused', version: 2 });
      r = await api(alice).post(`/api/schedules/${schedule.id}/resume`, { version: 2 });
      expect(r.body.schedule).toMatchObject({ status: 'active', version: 3 });
      r = await api(alice).post(`/api/schedules/${schedule.id}/cancel`, { version: 3 });
      expect(r.body.schedule).toMatchObject({ status: 'cancelled', version: 4 });
      expect((await stateMessages(convId)).map((m) => m.schedule.status)).toEqual(['active', 'paused', 'active', 'cancelled']);
    });

    it('runs now once at a time and hands the run to the scheduler', async () => {
      const { schedule } = await scheduled(alice);
      const r = await api(alice).post(`/api/schedules/${schedule.id}/run-now`);
      expect(r.status).toBe(201);
      expect(r.body.run).toMatchObject({ scheduleId: schedule.id, trigger: 'manual', state: 'planning', dueAt: NOW.toISOString() });
      expect(planned).toEqual([r.body.run.id]);
      const again = await api(alice).post(`/api/schedules/${schedule.id}/run-now`);
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('RUN_IN_PROGRESS');
      expect((await db.pool.query('SELECT next_run_at FROM schedules WHERE id=$1', [schedule.id])).rows[0].next_run_at.toISOString()).toBe('2026-10-26T01:00:00.000Z');
    });

    it('does not run a cancelled schedule', async () => {
      const { schedule } = await scheduled(alice);
      await api(alice).post(`/api/schedules/${schedule.id}/cancel`, { version: 1 });
      const r = await api(alice).post(`/api/schedules/${schedule.id}/run-now`);
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('SCHEDULE_CLOSED');
    });

    it('plans again only for a run that needs it', async () => {
      const { schedule } = await scheduled(alice);
      const waiting = await run(schedule.id, 'planned', { status: 'pending', expiresAt: new Date(NOW.getTime() + 600_000) });
      let r = await api(alice).post(`/api/schedule-runs/${waiting}/replan`);
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('RUN_NOT_REPLANNABLE');
      const expired = await run(schedule.id, 'planned', { status: 'pending', expiresAt: new Date(NOW.getTime() - 600_000) });
      r = await api(alice).post(`/api/schedule-runs/${expired}/replan`);
      expect(r.status).toBe(201);
      expect(r.body.run).toMatchObject({ trigger: 'replan', state: 'planning' });
      expect(planned).toEqual([r.body.run.id]);
    });
  });

  describe('reading', () => {
    it('lists schedules with the last run and counts runs waiting for approval', async () => {
      const { schedule } = await scheduled(alice);
      await run(schedule.id, 'planned', { status: 'pending', expiresAt: new Date(NOW.getTime() - 600_000) });
      expect((await api(alice).get('/api/schedules/pending-count')).body).toEqual({ count: 0 });
      const waiting = await run(schedule.id, 'planned', { status: 'pending', expiresAt: new Date(NOW.getTime() + 600_000) });
      expect((await api(alice).get('/api/schedules/pending-count')).body).toEqual({ count: 1 });
      expect((await api(bob).get('/api/schedules/pending-count')).body).toEqual({ count: 0 });
      const list = (await api(alice).get('/api/schedules')).body.schedules;
      expect(list).toHaveLength(1);
      expect(list[0].lastRun).toMatchObject({ id: waiting, state: 'awaiting_approval', planStatus: 'pending' });
      const runs = (await api(alice).get(`/api/schedules/${schedule.id}/runs?limit=20`)).body.runs;
      expect(runs.map((r: any) => r.state)).toEqual(['awaiting_approval', 'expired']);
    });

    it('derives the state of a run from the latest plan of its conversation', async () => {
      const { schedule } = await scheduled(alice);
      const id = await run(schedule.id, 'planned', { status: 'superseded', expiresAt: new Date(NOW.getTime() + 600_000) });
      const convId = (await db.pool.query('SELECT conv_id FROM schedule_runs WHERE id=$1', [id])).rows[0].conv_id;
      await db.pool.query("INSERT INTO plans(conv_id,plan_json,plan_hash,expires_at,status) VALUES($1,'{}','h2',$2,'completed')", [convId, new Date(NOW.getTime() + 600_000)]);
      const runs = (await api(alice).get(`/api/schedules/${schedule.id}/runs`)).body.runs;
      expect(runs[0]).toMatchObject({ id, state: 'approved', planStatus: 'completed' });
    });
  });

  describe('ownership', () => {
    it('answers 404 to another member and to malformed ids, and changes nothing', async () => {
      const { convId, schedule } = await scheduled(alice);
      const messageId = await propose(convId, create({ action: 'update', name: 'Của Bob' }), schedule.id, 1);
      const runId = await run(schedule.id, 'missed');
      const calls = [
        api(bob).post(`/api/conversations/${convId}/schedule-proposals/${messageId}/confirm`),
        api(bob).post(`/api/schedules/${schedule.id}/pause`, { version: 1 }),
        api(bob).post(`/api/schedules/${schedule.id}/cancel`, { version: 1 }),
        api(bob).post(`/api/schedules/${schedule.id}/run-now`),
        api(bob).post(`/api/schedule-runs/${runId}/replan`),
        api(bob).get(`/api/schedules/${schedule.id}/runs`),
        api(alice).post('/api/schedules/not-a-uuid/pause', { version: 1 }),
        api(alice).get('/api/schedules/not-a-uuid/runs'),
        api(alice).post('/api/schedule-runs/not-a-uuid/replan'),
      ];
      const statuses = (await Promise.all(calls)).map((r) => r.status);
      expect(statuses).toEqual(calls.map(() => 404));
      expect((await api(bob).get('/api/schedules')).body.schedules).toEqual([]);
      expect((await db.pool.query('SELECT name, version, status FROM schedules WHERE id=$1', [schedule.id])).rows[0]).toEqual({ name: 'Lịch họp hằng ngày', version: 1, status: 'active' });
      expect(planned).toEqual([]);
    });

    it('requires a signed-in member', async () => {
      expect((await request(app).get('/api/schedules')).status).toBe(401);
    });

    it('checks the session only for schedule paths, not again for other /api requests', async () => {
      let checks = 0;
      const sessions = db.users.sessions;
      const counted = createApp({ jwtSecret: secret, userRepo: db.users, schedules: { service: new ScheduleService({ pool: db.pool, timeZone: VN }) },
        sessionRepo: { findActiveUser: (...args: Parameters<typeof sessions.findActiveUser>) => { checks++; return sessions.findActiveUser(...args); } } } as any);
      await request(counted).get('/api/not-a-schedule-path').set('Authorization', bearer(alice));
      expect(checks).toBe(0);
      expect((await request(counted).get('/api/schedules').set('Authorization', bearer(alice))).status).toBe(200);
      expect(checks).toBe(1);
    });
  });
});
