import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import pg from 'pg';
import { encryptCredentials, GlobalRateLimiter, SlackAdapter } from '@wap/tool-adapters';
import type { CalendarDigestConfig, ScheduleResponse } from '@wap/tool-schemas';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { MessageRepo } from '../../src/db/repositories/message-repo.js';
import { computeCalendarDigestHash } from '../../src/services/schedules/calendar-digest-candidate.js';
import { createCalendarDigestExecutor } from '../../src/services/schedules/calendar-digest-runner.js';
import { ScheduleRunner } from '../../src/services/schedules/schedule-runner.js';
import { ScheduleConflict, ScheduleService } from '../../src/services/schedules/schedule-service.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

const KEY = '0123456789abcdef0123456789abcdef';
const TZ = 'Asia/Ho_Chi_Minh';
const BASE_NOW = new Date('2026-11-04T01:00:00.000Z'); // 08:00 in Vietnam

describe('FLOW-06: Schedule approval modes, recovery, and delivery safety', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let owner: Awaited<ReturnType<typeof db.person>>;
  let service: ScheduleService;
  const servers: Server[] = [];
  const runners: ScheduleRunner[] = [];

  beforeAll(async () => {
    db = await createMigratedSchema('sched_recovery');
  });

  beforeEach(async () => {
    await db.pool.query('DELETE FROM schedule_runs; DELETE FROM schedules; DELETE FROM service_credentials;');
    owner = await db.person('Chủ lịch FLOW-06');
    service = new ScheduleService({ pool: db.pool, timeZone: TZ, encryptionKey: KEY });
  });

  afterEach(async () => {
    for (const runner of runners.splice(0)) await runner.stop();
    for (const server of servers.splice(0)) {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  afterAll(async () => {
    await db?.close();
  });

  const propose = async (convId: string, proposal: ScheduleResponse, extraMeta: Record<string, unknown> = {}) => {
    const messages = new MessageRepo(db.pool);
    const msg = await messages.createMessage(convId, 'assistant', proposal.summary, {
      type: 'schedule_proposal',
      proposal,
      services: ['slack'],
      nextRuns: ['2026-11-05T01:00:00.000Z'],
      ...extraMeta,
    });
    return msg.id;
  };

  const createProposal = (over: Partial<ScheduleResponse> = {}): ScheduleResponse => ({
    kind: 'schedule',
    action: 'create',
    name: 'Báo cáo hàng ngày',
    request: 'Mỗi sáng 8h kiểm tra tiến độ và thông báo lên Slack',
    recurrence: { type: 'daily', time: '08:00' },
    summary: 'Mỗi sáng 8h gửi báo cáo lên Slack.',
    ...over,
  });

  describe('1. Approval mode distinction & refusal of invalid auto-digest', () => {
    it('sets kind = "plan" when approvalMode is "manual" or omitted', async () => {
      const convId = (await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [owner.id])).rows[0].id as string;
      const messageId = await propose(convId, createProposal());

      const result = await service.confirmProposal({
        userId: owner.id,
        convId,
        messageId,
        now: BASE_NOW,
        approvalMode: 'manual',
      });

      expect(result.schedule.kind).toBe('plan');
      const row = (await db.pool.query('SELECT kind, digest_config FROM schedules WHERE id=$1', [result.schedule.id])).rows[0];
      expect(row.kind).toBe('plan');
      expect(row.digest_config).toBeNull();
    });

    it('refuses auto_digest when schedule proposal lacks eligible digest candidate', async () => {
      const convId = (await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [owner.id])).rows[0].id as string;
      const messageId = await propose(convId, createProposal());

      await expect(
        service.confirmProposal({
          userId: owner.id,
          convId,
          messageId,
          now: BASE_NOW,
          approvalMode: 'auto_digest',
        }),
      ).rejects.toMatchObject({
        code: expect.stringMatching(/DIGEST_NOT_ELIGIBLE|AUTO_DIGEST_NOT_ALLOWED/),
      });

      // No schedule created
      const count = (await db.pool.query('SELECT count(*)::int AS n FROM schedules WHERE conv_id=$1', [convId])).rows[0].n;
      expect(count).toBe(0);
    });
  });

  describe('2. Pause, resume, and no replay of missed occurrences', () => {
    it('clears next_run_at on pause, and resume calculates next_run_at from current now without backfilling', async () => {
      const convId = (await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [owner.id])).rows[0].id as string;
      const messageId = await propose(convId, createProposal());

      const confirmed = await service.confirmProposal({
        userId: owner.id,
        convId,
        messageId,
        now: BASE_NOW,
      });

      const scheduleId = confirmed.schedule.id;
      expect(confirmed.schedule.status).toBe('active');
      expect(confirmed.schedule.nextRuns[0]).toBeDefined();

      // Pause schedule
      const paused = await service.setStatus({
        userId: owner.id,
        scheduleId,
        action: 'pause',
        version: confirmed.schedule.version,
        now: BASE_NOW,
      });
      expect(paused.schedule.status).toBe('paused');
      expect(paused.schedule.nextRuns).toHaveLength(0);

      const pausedRow = (await db.pool.query('SELECT next_run_at, status FROM schedules WHERE id=$1', [scheduleId])).rows[0];
      expect(pausedRow.next_run_at).toBeNull();
      expect(pausedRow.status).toBe('paused');

      // Fast forward by 3 days while paused
      const threeDaysLater = new Date('2026-11-07T03:00:00.000Z'); // 10:00 in Vietnam on Nov 7

      // Resume schedule
      const resumed = await service.setStatus({
        userId: owner.id,
        scheduleId,
        action: 'resume',
        version: paused.schedule.version,
        now: threeDaysLater,
      });

      expect(resumed.schedule.status).toBe('active');
      // Next run is calculated strictly into the future from Nov 7 (i.e. Nov 8 at 08:00 VN = 2026-11-08T01:00:00.000Z)
      expect(resumed.schedule.nextRuns[0]).toBe('2026-11-08T01:00:00.000Z');

      // Crucial: no backfilled runs were created during the pause period
      const runs = (await db.pool.query('SELECT * FROM schedule_runs WHERE schedule_id=$1', [scheduleId])).rows;
      expect(runs).toHaveLength(0);
    });
  });

  describe('3. Credential drift & revocation prevents invalid auto-digest', () => {
    it('rejects confirmation with DIGEST_PREVIEW_CHANGED when destination channel changes', async () => {
      const credentials = new CredentialRepo(db.pool, KEY);
      const source = await credentials.saveCredentials(
        'mycalendar',
        encryptCredentials(
          {
            refreshToken: 'fixture',
            email: 'owner@example.test',
            selectedCalendars: [{ id: 'work@example.test', summary: 'Work' }],
            allowedScope: { calendars: ['work@example.test'] },
          },
          KEY,
        ),
        owner.id,
      );

      await credentials.saveCredentials(
        'slack',
        encryptCredentials({ botToken: 'fixture', allowedScope: { channels: ['C0123456789'] } }, KEY),
        null,
      );

      const convId = (await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [owner.id])).rows[0].id as string;
      const config: CalendarDigestConfig = {
        version: 1,
        source: 'mycalendar',
        credentialId: source.id,
        email: 'owner@example.test',
        calendars: [{ id: 'work@example.test', summary: 'Work' }],
        destination: { service: 'slack', channelId: 'C0123456789' },
        windowHours: 24,
        includeSummary: false,
      };

      const candidate = {
        eligible: true,
        canAutoDigest: true,
        config,
        configHash: computeCalendarDigestHash(config),
        configPreview: {
          calendarCount: 1,
          calendarSummary: 'Work',
          destinationService: 'slack',
          destinationId: 'C0123456789',
          destinationLabel: '#general',
        },
      };

      const messageId = await propose(convId, createProposal(), {
        services: ['mycalendar', 'slack'],
        digestCandidate: candidate,
      });

      // Now change the destination channel before confirmation
      await credentials.saveCredentials(
        'slack',
        encryptCredentials({ botToken: 'fixture', allowedScope: { channels: ['C0999999999'] } }, KEY),
        null,
      );

      await expect(
        service.confirmProposal({
          userId: owner.id,
          convId,
          messageId,
          now: BASE_NOW,
          approvalMode: 'auto_digest',
        }),
      ).rejects.toMatchObject({
        code: 'DIGEST_PREVIEW_CHANGED',
      });
    });
  });

  describe('4. Real Loopback HTTP Server: Ambiguous delivery vs Definite rejection', () => {
    async function setupLoopback(responseType: 'lost' | 'server_error' | 'reject' | 'success') {
      const posts: { url: string; body: unknown }[] = [];
      let received!: () => void;
      const requestReceived = new Promise<void>(resolve => {
        received = resolve;
      });

      const server = createServer(async (req, res) => {
        let body = '';
        for await (const chunk of req) body += chunk;
        posts.push({ url: req.url!, body: body ? JSON.parse(body) : null });
        received();

        if (responseType === 'lost') {
          res.destroy(); // Socket abruptly closed after write
        } else if (responseType === 'server_error') {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Internal Gateway Error');
        } else if (responseType === 'reject') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'invalid_auth' }));
        } else if (responseType === 'success') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, ts: '1700000000.0001', channel: 'C0123456789' }));
        }
      });

      servers.push(server);
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

      const credentials = new CredentialRepo(db.pool, KEY);
      const source = await credentials.saveCredentials(
        'mycalendar',
        encryptCredentials(
          {
            refreshToken: 'fixture',
            email: 'owner@example.test',
            selectedCalendars: [{ id: 'work@example.test', summary: 'Work' }],
            allowedScope: { calendars: ['work@example.test'] },
          },
          KEY,
        ),
        owner.id,
      );

      await credentials.saveCredentials(
        'slack',
        encryptCredentials({ botToken: 'fixture', allowedScope: { channels: ['C0123456789'] } }, KEY),
        null,
      );

      const convId = (await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [owner.id])).rows[0].id as string;
      const config: CalendarDigestConfig = {
        version: 1,
        source: 'mycalendar',
        credentialId: source.id,
        email: 'owner@example.test',
        calendars: [{ id: 'work@example.test', summary: 'Work' }],
        destination: { service: 'slack', channelId: 'C0123456789' },
        windowHours: 24,
        includeSummary: false,
      };

      const schedule = (
        await db.pool.query(
          `INSERT INTO schedules(user_id, conv_id, name, request, recurrence, services, status, next_run_at, kind, digest_config, digest_config_hash, digest_approved_at)
           VALUES($1, $2, 'Bản tin', 'Gửi lịch', '{"type":"daily","time":"08:00"}', $3, 'active', '2026-11-04T01:00:00Z', 'calendar_digest', $4, $5, now())
           RETURNING *`,
          [owner.id, convId, ['mycalendar', 'slack'], JSON.stringify(config), computeCalendarDigestHash(config)],
        )
      ).rows[0];

      const limiter = () => new GlobalRateLimiter({ maxRequests: 1000, windowMs: 1 });
      const adapter = new SlackAdapter({
        credentials: { botToken: 'fixture' },
        allowedScope: { channels: ['C0123456789'] },
        baseUrl,
        rateLimiter: limiter(),
      });

      const executor = createCalendarDigestExecutor({
        pool: db.pool,
        encryptionKey: KEY,
        timeZone: TZ,
        getAdapter: async (name: string) => (name === 'mycalendar' ? { execute: async () => ({ events: [] }) } : adapter),
      });

      const runner = new ScheduleRunner({
        pool: db.pool,
        timeZone: TZ,
        runDigest: executor,
        planRun: async () => {
          throw new Error('Not used for calendar digest');
        },
        recordState: (client, row, at) => service.recordState(client, row, at),
      });
      runners.push(runner);

      const run = await service.startRun({ scheduleId: schedule.id, trigger: 'manual', userId: owner.id, now: BASE_NOW });

      return {
        posts,
        requestReceived,
        schedule,
        run,
        runner,
        row: async () => (await db.pool.query('SELECT * FROM schedule_runs WHERE id=$1', [run.id])).rows[0],
        replan: () => service.startRun({ runId: run.id, trigger: 'replan', userId: owner.id, now: BASE_NOW }),
      };
    }

    it('marks run as needs_attention and blocks replan when external server drops connection after receiving write', async () => {
      const f = await setupLoopback('lost');
      await f.runner.planNow(f.run.id);

      expect(f.posts).toHaveLength(1);
      const row = await f.row();
      expect(row.status).toBe('needs_attention');
      expect(row.error).toContain('kiểm tra');

      // Must refuse replan to prevent sending duplicate notifications!
      await expect(f.replan()).rejects.toMatchObject({
        code: 'RUN_NOT_REPLANNABLE',
      });
      expect(f.posts).toHaveLength(1);
    });

    it('marks run as needs_attention and blocks replan when external server returns HTTP 500 after receiving write', async () => {
      const f = await setupLoopback('server_error');
      await f.runner.planNow(f.run.id);

      expect(f.posts).toHaveLength(1);
      const row = await f.row();
      expect(row.status).toBe('needs_attention');

      // Must refuse replan
      await expect(f.replan()).rejects.toMatchObject({
        code: 'RUN_NOT_REPLANNABLE',
      });
    });

    it('permits replan when external service definitely rejects write before execution (HTTP 401)', async () => {
      const f = await setupLoopback('reject');
      await f.runner.planNow(f.run.id);

      expect(f.posts).toHaveLength(1);
      const row = await f.row();
      expect(row.status).toBe('digest_failed');

      // Replan is allowed because write definitely did not succeed
      const replanned = await f.replan();
      expect(replanned.state).toBe('planning');
    });

    it('aborts the actual AbortSignal when timing out before write dispatch', async () => {
      let signalReceived: AbortSignal | undefined;
      const convId = (await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [owner.id])).rows[0].id as string;
      const messageId = await propose(convId, createProposal(), { services: ['slack'] });
      const confirmed = await service.confirmProposal({ userId: owner.id, convId, messageId, now: BASE_NOW });
      const schedule = confirmed.schedule;

      const runner = new ScheduleRunner({
        pool: db.pool,
        timeZone: TZ,
        planTimeoutMs: 200,
        planRun: async (_toPlan, _runConvId, signal) => {
          signalReceived = signal;
          await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
          return { persist: async () => ({ state: 'planned', planId: 'p-1' }), afterCommit() {} };
        },
        recordState: (client, row, at) => service.recordState(client, row, at),
      });
      runners.push(runner);

      const run = await service.startRun({ scheduleId: schedule.id, trigger: 'manual', userId: owner.id, now: BASE_NOW });
      await runner.planNow(run.id);

      expect(signalReceived?.aborted).toBe(true);
      const runRow = (await db.pool.query('SELECT status, error FROM schedule_runs WHERE id=$1', [run.id])).rows[0];
      expect(runRow.status).toBe('planning_failed');
      expect(runRow.error).toContain('quá thời gian');

      // Replan IS allowed since no write was dispatched
      const replanResult = await service.startRun({ runId: run.id, trigger: 'replan', userId: owner.id, now: BASE_NOW });
      expect(replanResult.state).toBe('planning');
    });
  });
});
