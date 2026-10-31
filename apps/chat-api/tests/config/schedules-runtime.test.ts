import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createScheduleRuntime } from '../../src/config/schedules-runtime.js';
import { certifyScheduleFixture } from '../../src/services/slack/slack-schedule-origin.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

describe('createScheduleRuntime', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  beforeAll(async () => { db = await createMigratedSchema('schedule_runtime'); });
  afterAll(async () => { await db?.close(); });

  it('creates nothing when the flag is off or there is no PostgreSQL', () => {
    expect(createScheduleRuntime({ enabled: false, pool: db.pool, timeZone: 'Asia/Ho_Chi_Minh' })).toBeUndefined();
    expect(createScheduleRuntime({ enabled: true, pool: null, timeZone: 'Asia/Ho_Chi_Minh' })).toBeUndefined();
  });

  it('fails runs until the planner is connected, without calling a model', async () => {
    const runtime = createScheduleRuntime({ enabled: true, pool: db.pool, timeZone: 'Asia/Ho_Chi_Minh', now: () => new Date('2026-10-25T01:00:30.000Z') })!;
    const owner = await db.person();
    const convId = (await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [owner.id])).rows[0].id;
    const id = (await db.pool.query(`INSERT INTO schedules(user_id,conv_id,name,request,recurrence,services,status,next_run_at)
      VALUES($1,$2,'Lịch','Gửi lịch họp','{"type":"daily","time":"08:00"}','{calendar,slack}','active','2026-10-25T01:00:00Z') RETURNING id`, [owner.id, convId])).rows[0].id;
    await certifyScheduleFixture(db.pool, id);
    await runtime.runner.tick();
    expect((await db.pool.query('SELECT status FROM schedule_runs WHERE schedule_id=$1', [id])).rows).toEqual([{ status: 'planning_failed' }]);
    await runtime.runner.stop();
  });
});
