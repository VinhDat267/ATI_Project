import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { readFile, readdir } from 'node:fs/promises';
import { encryptCredentials, GlobalRateLimiter, SlackAdapter, TelegramAdapter } from '@wap/tool-adapters';
import type { CalendarDigestConfig } from '@wap/tool-schemas';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { computeCalendarDigestHash } from '../../src/services/schedules/calendar-digest-candidate.js';
import { createCalendarDigestExecutor } from '../../src/services/schedules/calendar-digest-runner.js';
import { reconcileScheduleRuns, ScheduleRunner } from '../../src/services/schedules/schedule-runner.js';
import { ScheduleService } from '../../src/services/schedules/schedule-service.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

const key = '0123456789abcdef0123456789abcdef';
const TZ = 'Asia/Ho_Chi_Minh';
const now = new Date('2026-11-02T00:00:00Z');
describe('Calendar delivery recovery with real HTTP and PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let owner: Awaited<ReturnType<typeof db.person>>;
  let service: ScheduleService;
  const servers: Server[] = [];
  const runners: ScheduleRunner[] = [];
  beforeAll(async () => { db = await createMigratedSchema('calendar_delivery'); });
  beforeEach(async () => {
    await db.pool.query('DELETE FROM schedule_runs; DELETE FROM schedules; DELETE FROM service_credentials');
    owner = await db.person();
    service = new ScheduleService({ pool: db.pool, timeZone: TZ, encryptionKey: key });
  });
  afterEach(async () => {
    for (const runner of runners.splice(0)) await runner.stop();
    for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  afterAll(async () => db?.close());

  async function setup(destination: 'slack' | 'telegram' = 'slack', response: 'lost' | 'reject' | 'hold' | 'success' | 'server_error' | 'malformed' = 'lost') {
    const posts: { url: string; body: any }[] = [];
    let received!: () => void;
    const requestReceived = new Promise<void>(resolve => { received = resolve; });
    let beforeReply = async () => {};
    const server = createServer(async (req, res) => {
      let body = ''; for await (const chunk of req) body += chunk;
      if (req.url?.endsWith('/getChat')) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, result: { id: 123456789, type: 'private', first_name: 'Fixture' } }));
        return;
      }
      posts.push({ url: req.url!, body: JSON.parse(body) }); received();
      await beforeReply();
      if (response === 'lost') res.destroy();
      else if (response === 'reject') { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'invalid_auth' })); }
      else if (response === 'server_error') { res.writeHead(500); res.end('upstream unavailable'); }
      else if (response === 'malformed') { res.writeHead(200); res.end('{'); }
      else if (response === 'success') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, ts: '1.0001', channel: 'C0123456789' })); }
    });
    servers.push(server); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const credentials = new CredentialRepo(db.pool, key);
    const source = await credentials.saveCredentials('mycalendar', encryptCredentials({ refreshToken: 'fixture', email: 'owner@example.test',
      selectedCalendars: [{ id: 'work@example.test', summary: 'Work' }], allowedScope: { calendars: ['work@example.test'] } }, key), owner.id);
    await credentials.saveCredentials(destination, encryptCredentials({ botToken: 'fixture', allowedScope: destination === 'slack'
      ? { channels: ['C0123456789'] } : { chats: ['123456789'] } }, key), destination === 'slack' ? null : owner.id);
    const convId = (await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [owner.id])).rows[0].id;
    const config: CalendarDigestConfig = { version: 1, source: 'mycalendar', credentialId: source.id, email: 'owner@example.test',
      calendars: [{ id: 'work@example.test', summary: 'Work' }], destination: destination === 'slack' ? { service: 'slack', channelId: 'C0123456789' }
        : { service: 'telegram', chatId: '123456789' }, windowHours: 24, includeSummary: false };
    const schedule = (await db.pool.query(`INSERT INTO schedules(user_id,conv_id,name,request,recurrence,services,status,next_run_at,kind,digest_config,digest_config_hash,digest_approved_at)
      VALUES($1,$2,'Agenda','Send agenda','{"type":"daily","time":"08:00"}',$3,'active','2026-11-03T01:00:00Z','calendar_digest',$4,$5,now()) RETURNING *`,
      [owner.id, convId, ['mycalendar', destination], JSON.stringify(config), computeCalendarDigestHash(config)])).rows[0];
    const limiter = () => new GlobalRateLimiter({ maxRequests: 1000, windowMs: 1 });
    const adapter = destination === 'slack'
      ? new SlackAdapter({ credentials: { botToken: 'fixture' }, allowedScope: { channels: ['C0123456789'] }, baseUrl, rateLimiter: limiter() })
      : new TelegramAdapter({ credentials: { botToken: '123456:fixture_token_only' }, allowedScope: { chats: ['123456789'] }, baseUrl, chatRateLimiter: limiter(), rateLimiter: limiter() });
    const getAdapter = async (name: string) => name === 'mycalendar' ? { execute: async () => ({ events: [] }) } : adapter;
    const executor = createCalendarDigestExecutor({ pool: db.pool, encryptionKey: key, timeZone: TZ, getAdapter });
    const makeRunner = (planTimeoutMs = 10_000, runDigest = executor) => {
      const runner = new ScheduleRunner({ pool: db.pool, timeZone: TZ, planTimeoutMs, runDigest,
        planRun: async () => { throw new Error('Calendar must not use the planner'); },
        recordState: (client, row, at) => service.recordState(client, row, at) });
      runners.push(runner); return runner;
    };
    const run = await service.startRun({ scheduleId: schedule.id, trigger: 'manual', userId: owner.id, now });
    const row = async () => (await db.pool.query('SELECT * FROM schedule_runs WHERE id=$1', [run.id])).rows[0];
    const replan = () => service.startRun({ runId: run.id, trigger: 'replan', userId: owner.id, now });
    return { posts, requestReceived, schedule, run, row, replan, makeRunner, executor, beforeReply: (work: () => Promise<void>) => { beforeReply = work; } };
  }

  it.each(['slack', 'telegram'] as const)('does not offer replan after %s accepted POST but lost its response', async destination => {
    const f = await setup(destination);
    await f.makeRunner().planNow(f.run.id);
    expect(f.posts).toHaveLength(1);
    expect((await f.row()).status).toBe('needs_attention');
    expect((await f.row()).error).toContain('kiểm tra');
    await expect(f.replan()).rejects.toMatchObject({ code: 'RUN_NOT_REPLANNABLE' });
    expect(f.posts).toHaveLength(1);
    expect((await f.row()).delivery).toBeNull();
  });

  it('keeps a definite authentication rejection recoverable', async () => {
    const f = await setup('slack', 'reject');
    await f.makeRunner().planNow(f.run.id);
    expect((await f.row()).status).toBe('digest_failed');
    expect((await f.replan()).state).toBe('planning');
  });

  it.each(['server_error', 'malformed'] as const)('does not replay a write after a %s response', async response => {
    const f = await setup('slack', response);
    await f.makeRunner().planNow(f.run.id);
    expect((await f.row()).status).toBe('needs_attention');
    await expect(f.replan()).rejects.toMatchObject({ code: 'RUN_NOT_REPLANNABLE' });
    expect(f.posts).toHaveLength(1);
  });

  it('keeps confirmed delivery when the schedule is cancelled before the HTTP response arrives', async () => {
    const f = await setup('slack', 'success');
    f.beforeReply(async () => { await service.setStatus({ userId: owner.id, scheduleId: f.schedule.id, version: 1, action: 'cancel', now }); });
    await f.makeRunner().planNow(f.run.id);
    expect((await f.row()).status).toBe('digest_sent');
    expect((await f.row()).delivery.channelId).toBe('C0123456789');
    expect(f.posts).toHaveLength(1);
  });

  it.each(['timeout', 'stop'] as const)('preserves uncertain delivery after %s with a POST in flight', async cause => {
    const f = await setup('slack', 'hold');
    const runner = f.makeRunner(cause === 'timeout' ? 500 : 10_000);
    const running = runner.planNow(f.run.id);
    await f.requestReceived;
    if (cause === 'stop') await runner.stop();
    await running;
    expect(f.posts).toHaveLength(1);
    expect((await f.row()).status).toBe('needs_attention');
    await expect(f.replan()).rejects.toMatchObject({ code: 'RUN_NOT_REPLANNABLE' });
  });

  it.each(['calendar_digest', 'plan'] as const)('keeps restart after dispatch non-replannable even when kind is now %s', async kind => {
    const f = await setup();
    await db.pool.query('UPDATE schedule_runs SET delivery_started_at=now() WHERE id=$1', [f.run.id]);
    if (kind === 'plan') await db.pool.query("UPDATE schedules SET kind='plan', digest_config=NULL, digest_config_hash=NULL, digest_approved_at=NULL WHERE id=$1", [f.schedule.id]);
    await reconcileScheduleRuns(db.pool);
    expect((await f.row()).status).toBe('needs_attention');
    await expect(f.replan()).rejects.toMatchObject({ code: 'RUN_NOT_REPLANNABLE' });
    const safe = await service.startRun({ scheduleId: f.schedule.id, trigger: 'manual', userId: owner.id, now });
    await reconcileScheduleRuns(db.pool);
    expect((await db.pool.query('SELECT status FROM schedule_runs WHERE id=$1', [safe.id])).rows[0].status).toBe('interrupted');
    expect((await service.startRun({ runId: safe.id, trigger: 'replan', userId: owner.id, now })).state).toBe('planning');
    expect(f.posts).toHaveLength(0);
  });

  it('preserves the dispatch marker across the entire migration chain rerun', async () => {
    const f = await setup();
    await db.pool.query('UPDATE schedule_runs SET delivery_started_at=now() WHERE id=$1', [f.run.id]);
    const before = (await f.row()).delivery_started_at;
    const directory = new URL('../../../../db/v3/', import.meta.url);
    for (const name of (await readdir(directory)).filter(name => /^\d{4}_.*\.sql$/.test(name)).sort()) {
      await db.pool.query(await readFile(new URL(name, directory), 'utf8'));
    }
    expect((await f.row()).delivery_started_at).toEqual(before);
    await reconcileScheduleRuns(db.pool);
    expect((await f.row()).status).toBe('needs_attention');
  });

  it('keeps timeout before dispatch recoverable and aborts the actual read signal', async () => {
    const f = await setup();
    let readSignal: AbortSignal | undefined;
    const executor = createCalendarDigestExecutor({ pool: db.pool, encryptionKey: key, timeZone: TZ,
      getAdapter: async () => ({ execute: async (_tool: string, _args: unknown, context: { signal: AbortSignal }) => {
        readSignal = context.signal;
        await new Promise((_, reject) => context.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
      } }) });
    await f.makeRunner(250, executor).planNow(f.run.id);
    expect(readSignal?.aborted).toBe(true);
    expect((await f.row()).status).toBe('digest_failed');
    expect((await f.replan()).state).toBe('planning');
    expect(f.posts).toHaveLength(0);
  });

  it('keeps read errors before dispatch recoverable', async () => {
    const f = await setup();
    const executor = createCalendarDigestExecutor({ pool: db.pool, encryptionKey: key, timeZone: TZ,
      getAdapter: async () => ({ execute: async () => { throw new Error('Calendar unavailable'); } }) });
    await f.makeRunner(10_000, executor).planNow(f.run.id);
    expect((await f.row()).status).toBe('digest_failed');
    expect((await f.replan()).state).toBe('planning');
    expect(f.posts).toHaveLength(0);
  });
});
