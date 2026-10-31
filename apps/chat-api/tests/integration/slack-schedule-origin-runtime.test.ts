import {afterAll, beforeAll, expect, it} from 'vitest';
import express from 'express';
import request from 'supertest';
import {createMigratedSchema} from '../helpers/gmail-test-db.js';
import {ConversationRepo} from '../../src/db/repositories/conversation-repo.js';
import {MessageRepo} from '../../src/db/repositories/message-repo.js';
import {createScheduleRoutes} from '../../src/routes/schedule-routes.js';
import {ScheduleRunner} from '../../src/services/schedules/schedule-runner.js';
import {ScheduleService} from '../../src/services/schedules/schedule-service.js';
import {eraseSlackArtifact, lockSlackArtifact} from '../../src/services/slack/slack-artifact-targets.js';
import {SlackScheduleOriginBackfill} from '../../src/services/slack/slack-schedule-origin-backfill.js';

const zone = 'Asia/Ho_Chi_Minh';
const due = new Date('2026-10-25T01:00:00.000Z');
const tickAt = new Date('2026-10-25T01:00:30.000Z');
const beforeDue = new Date('2026-10-25T00:30:00.000Z');
const secret = 'uncertified schedule private name';
let db: Awaited<ReturnType<typeof createMigratedSchema>>;
let conversations: ConversationRepo;
let messages: MessageRepo;
let schedules: ScheduleService;

beforeAll(async () => {
  db = await createMigratedSchema('schedule_origin');
  conversations = new ConversationRepo(db.pool);
  messages = new MessageRepo(db.pool);
  schedules = new ScheduleService({pool: db.pool, timeZone: zone});
});
afterAll(async () => { await db?.close(); });

function runner() {
  return new ScheduleRunner({
    pool: db.pool, timeZone: zone, now: () => tickAt,
    recordState: (client, row, at) => schedules.recordState(client, row, at),
    planRun: async () => ({async persist() { return {state: 'needs_attention' as const}; }, afterCommit() {}}),
  });
}

async function rawSchedule(ownerId: string, name: string, text = 'plain request', next = due) {
  const conv = await conversations.createConversation(ownerId);
  const row = (await db.pool.query(
    `INSERT INTO schedules(user_id,conv_id,name,request,recurrence,services,status,next_run_at)
     VALUES($1,$2,$3,$4,'{"type":"daily","time":"08:00"}','{calendar}','active',$5) RETURNING id`,
    [ownerId, conv.id, name, text, next],
  )).rows[0];
  return {convId: conv.id, id: row.id as string};
}

async function proposal(ownerId: string, name: string, action: 'create' | 'update', baseVersion: number | null) {
  const conv = await conversations.createConversation(ownerId);
  const metadata = {
    type: 'schedule_proposal',
    proposal: {kind: 'schedule', action, name, request: 'certified request', recurrence: {type: 'daily', time: '08:00'}, summary: name},
    services: ['calendar'], scheduleId: null, baseVersion, previous: null, nextRuns: [],
  };
  const message = await messages.createMessage(conv.id, 'assistant', name, metadata);
  return {convId: conv.id, messageId: message.id};
}

it('refuses an unmarked schedule before a run exists and keeps the stored name', async () => {
  const owner = await db.person();
  const row = await rawSchedule(owner.id, secret);
  await runner().tick();
  expect((await db.pool.query('SELECT count(*)::int AS n FROM schedule_runs WHERE schedule_id=$1', [row.id])).rows[0].n).toBe(0);
  expect((await db.pool.query('SELECT name,status FROM schedules WHERE id=$1', [row.id])).rows[0]).toMatchObject({name: secret, status: 'active'});
  expect(JSON.stringify(await schedules.list(owner.id, tickAt))).not.toContain(secret);
  const runId = (await db.pool.query(
    `INSERT INTO schedule_runs(schedule_id,schedule_version,trigger,due_at,status) VALUES($1,1,'scheduled',$2,'planning') RETURNING id`,
    [row.id, due],
  )).rows[0].id;
  await runner().planNow(runId);
  const planned = (await db.pool.query('SELECT status, conv_id FROM schedule_runs WHERE id=$1', [runId])).rows[0];
  expect(planned).toMatchObject({status: 'discarded', conv_id: null});
});

it('seals a source-free schedule in the writer, ignores scheduler columns, and refuses a later SQL edit', async () => {
  const owner = await db.person();
  const created = await proposal(owner.id, 'Lịch được chứng nhận', 'create', null);
  const change = await schedules.confirmProposal({userId: owner.id, convId: created.convId, messageId: created.messageId, now: beforeDue});
  expect((await db.pool.query("SELECT producer FROM slack_schedule_origins WHERE schedule_id=$1", [change.schedule.id])).rows[0].producer).toBe('schedule_writer');
  expect((await db.pool.query('SELECT count(*)::int AS n FROM slack_plan_origins')).rows[0].n).toBe(0);
  await db.pool.query('UPDATE schedules SET next_run_at=$2 WHERE id=$1', [change.schedule.id, due]);
  await runner().tick();
  const run = (await db.pool.query('SELECT id, conv_id, status FROM schedule_runs WHERE schedule_id=$1', [change.schedule.id])).rows[0];
  expect(run.status).toBe('needs_attention');
  expect((await conversations.getConversation(run.conv_id))?.title).toContain('Lịch được chứng nhận');
  await schedules.setStatus({userId: owner.id, scheduleId: change.schedule.id, action: 'pause', version: change.schedule.version, now: tickAt});
  expect(JSON.stringify(await schedules.list(owner.id, tickAt))).toContain('Lịch được chứng nhận');
  await db.pool.query('UPDATE schedules SET name=$2, status=$3, next_run_at=$4 WHERE id=$1', [change.schedule.id, secret, 'active', due]);
  expect(JSON.stringify(await schedules.list(owner.id, tickAt))).not.toContain(secret);
  expect((await db.pool.query('SELECT name FROM schedules WHERE id=$1', [change.schedule.id])).rows[0].name).toBe(secret);
  const before = (await db.pool.query('SELECT count(*)::int AS n FROM schedule_runs WHERE schedule_id=$1', [change.schedule.id])).rows[0].n;
  await runner().tick();
  expect((await db.pool.query('SELECT count(*)::int AS n FROM schedule_runs WHERE schedule_id=$1', [change.schedule.id])).rows[0].n).toBe(before);
});

it('reseals a purge only when the previous certificate still matched', async () => {
  const owner = await db.person();
  const created = await proposal(owner.id, 'Lịch trước khi xóa', 'create', null);
  const change = await schedules.confirmProposal({userId: owner.id, convId: created.convId, messageId: created.messageId, now: beforeDue});
  const target = {atiUserId: owner.id, targetKind: 'scheduled_workflow_arg', targetId: change.schedule.id, targetSubId: 'name'};
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM conversations WHERE id=$1 FOR UPDATE', [created.convId]);
    await eraseSlackArtifact(client, target, await lockSlackArtifact(client, target, 'UPDATE'));
    await client.query('COMMIT');
  } finally { client.release(); }
  expect((await db.pool.query('SELECT producer FROM slack_schedule_origins WHERE schedule_id=$1', [change.schedule.id])).rows[0].producer).toBe('physical_purge');
  expect(JSON.stringify(await schedules.list(owner.id, tickAt))).toContain('Slack content is unavailable.');

  const broken = await proposal(owner.id, 'Lịch chứng nhận rồi sửa tay', 'create', null);
  const second = await schedules.confirmProposal({userId: owner.id, convId: broken.convId, messageId: broken.messageId, now: beforeDue});
  await db.pool.query('UPDATE schedules SET name=$2 WHERE id=$1', [second.schedule.id, secret]);
  const again = {atiUserId: owner.id, targetKind: 'scheduled_workflow_arg', targetId: second.schedule.id, targetSubId: 'name'};
  const other = await db.pool.connect();
  try {
    await other.query('BEGIN');
    await other.query('SELECT id FROM conversations WHERE id=$1 FOR UPDATE', [broken.convId]);
    await eraseSlackArtifact(other, again, await lockSlackArtifact(other, again, 'UPDATE'));
    await other.query('COMMIT');
  } finally { other.release(); }
  expect((await db.pool.query('SELECT producer FROM slack_schedule_origins WHERE schedule_id=$1', [second.schedule.id])).rows[0].producer).toBe('schedule_writer');
  expect(JSON.stringify(await schedules.list(owner.id, tickAt))).not.toContain(secret);
});

it('backfill keeps unmarked legacy and a mutated certificate quarantined', async () => {
  const owner = await db.person();
  const plain = await rawSchedule(owner.id, 'plain legacy schedule', 'plain legacy request');
  const marked = await rawSchedule(owner.id, 'marked legacy schedule', 'mentions myslack.list');
  const created = await proposal(owner.id, 'Lịch đã chứng nhận', 'create', null);
  const change = await schedules.confirmProposal({userId: owner.id, convId: created.convId, messageId: created.messageId, now: beforeDue});
  const tampered = 'request rewritten by sql';
  await db.pool.query('UPDATE schedules SET request=$2 WHERE id=$1', [change.schedule.id, tampered]);
  const backfill = new SlackScheduleOriginBackfill(db.pool);
  const preview = await backfill.page({limit: 50});
  expect(preview.applied).toBe(0);
  const applied = await backfill.page({limit: 50, apply: true});
  expect(applied.applied).toBe(0);
  expect(applied.quarantined).toBeGreaterThan(0);
  expect(JSON.stringify(await schedules.list(owner.id, tickAt))).not.toContain('plain legacy request');
  expect(JSON.stringify(await schedules.list(owner.id, tickAt))).not.toContain(tampered);
  expect((await db.pool.query('SELECT count(*)::int AS n FROM slack_schedule_origins WHERE schedule_id=$1', [plain.id])).rows[0].n).toBe(0);
  expect((await db.pool.query('SELECT count(*)::int AS n FROM slack_schedule_origins WHERE schedule_id=$1', [marked.id])).rows[0].n).toBe(0);
  expect((await db.pool.query('SELECT producer FROM slack_schedule_origins WHERE schedule_id=$1', [change.schedule.id])).rows[0].producer).toBe('schedule_writer');
  const seen: string[] = [];
  const planned = new ScheduleRunner({
    pool: db.pool, timeZone: zone, now: () => tickAt,
    recordState: (client, row, at) => schedules.recordState(client, row, at),
    planRun: async (run) => { seen.push(run.request); return {async persist() { return {state: 'needs_attention' as const}; }, afterCommit() {}}; },
  });
  await planned.tick();
  expect(seen).not.toContain('plain legacy request');
  expect(seen).not.toContain(tampered);
});

it('plans a certified schedule that sits behind five uncertified due rows', async () => {
  const blockedOwner = await db.person();
  const owner = await db.person();
  const earlier = new Date('2026-10-25T00:59:00.000Z');
  const blocked = [];
  for (let i = 0; i < 5; i++) blocked.push(await rawSchedule(blockedOwner.id, `blocked ${i}`, `blocked request ${i}`, earlier));
  const created = await proposal(owner.id, 'Lịch hợp lệ phía sau', 'create', null);
  const change = await schedules.confirmProposal({userId: owner.id, convId: created.convId, messageId: created.messageId, now: beforeDue});
  await db.pool.query('UPDATE schedules SET next_run_at=$2 WHERE id=$1', [change.schedule.id, due]);
  const seen: string[] = [];
  const planned = new ScheduleRunner({
    pool: db.pool, timeZone: zone, now: () => tickAt,
    recordState: (client, row, at) => schedules.recordState(client, row, at),
    planRun: async (run) => { seen.push(run.name); return {async persist() { return {state: 'needs_attention' as const}; }, afterCommit() {}}; },
  });
  await planned.tick();
  await planned.tick();
  await planned.tick();
  expect((await db.pool.query('SELECT count(*)::int AS n FROM schedule_runs WHERE schedule_id=$1', [change.schedule.id])).rows[0].n).toBeGreaterThan(0);
  expect(seen).toContain('Lịch hợp lệ phía sau');
  const stored = await db.pool.query('SELECT name, status, pause_reason FROM schedules WHERE id=ANY($1::uuid[]) ORDER BY name', [blocked.map(row => row.id)]);
  expect(stored.rows).toEqual([0, 1, 2, 3, 4].map(i => ({name: `blocked ${i}`, status: 'active', pause_reason: null})));
});

it('hides a schedule whose user id was rewritten from its owner', async () => {
  const owner = await db.person();
  const other = await db.person();
  const created = await proposal(owner.id, 'Lịch của A', 'create', null);
  const change = await schedules.confirmProposal({userId: owner.id, convId: created.convId, messageId: created.messageId, now: beforeDue});
  await db.pool.query('UPDATE schedules SET user_id=$2 WHERE id=$1', [change.schedule.id, other.id]);
  expect(JSON.stringify(await schedules.list(other.id, tickAt))).not.toContain('Lịch của A');
  expect(JSON.stringify(await schedules.list(other.id, tickAt))).not.toContain('certified request');
  expect((await db.pool.query('SELECT request FROM schedules WHERE id=$1', [change.schedule.id])).rows[0].request).toBe('certified request');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as {user?: {id: string}}).user = {id: String(req.headers['x-fixture-owner'] ?? '')}; next(); });
  app.use('/api', createScheduleRoutes({service: schedules, clock: () => tickAt}));
  const response = await request(app).get('/api/schedules').set('x-fixture-owner', other.id);
  expect(response.status).toBe(200);
  expect(response.text).not.toContain('Lịch của A');
  expect(response.text).not.toContain('certified request');
});
