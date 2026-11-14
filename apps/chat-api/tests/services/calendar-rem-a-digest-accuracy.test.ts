import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import {
  encryptCredentials,
  GlobalRateLimiter,
  PersonalCalendarAdapter,
  SlackAdapter,
  StepError,
} from '@wap/tool-adapters';
import type { CalendarDigestConfig } from '@wap/tool-schemas';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { computeCalendarDigestHash } from '../../src/services/schedules/calendar-digest-candidate.js';
import {
  createCalendarDigestExecutor,
  formatCalendarDigestMessage,
} from '../../src/services/schedules/calendar-digest-runner.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

const KEY = '0123456789abcdef0123456789abcdef';
const VN = 'Asia/Ho_Chi_Minh';

type Db = Awaited<ReturnType<typeof createMigratedSchema>>;
type Person = Awaited<ReturnType<Db['person']>>;

describe('CALENDAR-REM-A: Calendar Digest Accuracy (CALENDAR-AUDIT-01) & Window Boundaries (CALENDAR-AUDIT-05)', () => {
  let db: Db;
  let owner: Person;
  let credentials: CredentialRepo;
  const servers: Server[] = [];

  beforeAll(async () => {
    db = await createMigratedSchema('calendar_rem_a');
    credentials = new CredentialRepo(db.pool, KEY);
  });

  beforeEach(async () => {
    await db.pool.query('DELETE FROM schedule_runs; DELETE FROM schedules; DELETE FROM service_credentials;');
    owner = await db.person('Rem A Tester');
  });

  afterEach(async () => {
    for (const s of servers.splice(0)) {
      s.closeAllConnections();
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  });

  afterAll(async () => {
    await db?.close();
  });

  async function seedScheduleRun(options?: {
    calendars?: Array<{ id: string; summary: string; primary?: boolean }>;
    windowHours?: number;
    includeSummary?: boolean;
    dueAtIso?: string;
  }) {
    const calendars = options?.calendars ?? [{ id: 'work@example.test', summary: 'Work', primary: true }];
    const dueAtIso = options?.dueAtIso ?? '2026-11-16T01:00:00.000Z';
    const source = await credentials.saveCredentials(
      'mycalendar',
      encryptCredentials(
        {
          refreshToken: 'fixture-refresh-token',
          email: 'owner@example.test',
          selectedCalendars: calendars,
          allowedScope: { calendars: calendars.map((c) => c.id) },
        },
        KEY,
      ),
      owner.id,
    );
    await credentials.saveCredentials(
      'slack',
      encryptCredentials({ botToken: 'xoxb-fixture-token', allowedScope: { channels: ['C0123456789'] } }, KEY),
      null,
    );
    const convId = (
      await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [owner.id])
    ).rows[0].id as string;

    const config: CalendarDigestConfig = {
      version: 1,
      source: 'mycalendar',
      credentialId: source.id,
      email: 'owner@example.test',
      calendars,
      destination: { service: 'slack', channelId: 'C0123456789', channelName: 'daily-briefing' },
      windowHours: options?.windowHours ?? 24,
      includeSummary: options?.includeSummary ?? true,
    };
    const hash = computeCalendarDigestHash(config);

    const schedule = (
      await db.pool.query(
        `INSERT INTO schedules(user_id, conv_id, name, request, recurrence, services, status, next_run_at, kind, digest_config, digest_config_hash, digest_approved_at)
         VALUES($1, $2, 'Agenda', 'Send daily agenda', '{"type":"daily","time":"08:00"}', $3, 'active', $4, 'calendar_digest', $5, $6, now())
         RETURNING *`,
        [owner.id, convId, ['mycalendar', 'slack'], dueAtIso, JSON.stringify(config), hash],
      )
    ).rows[0];

    const run = (
      await db.pool.query(
        `INSERT INTO schedule_runs(schedule_id, due_at, status, schedule_version, trigger)
         VALUES($1, $2, 'planning', $3, 'manual')
         RETURNING *`,
        [schedule.id, dueAtIso, schedule.version],
      )
    ).rows[0];

    return {
      config,
      hash,
      schedule,
      run,
      runInput: {
        runId: run.id as string,
        scheduleId: schedule.id as string,
        scheduleVersion: schedule.version as number,
        userId: owner.id,
        name: schedule.name as string,
        request: schedule.request as string,
        trigger: 'manual' as const,
        dueAt: new Date(dueAtIso),
        digestConfig: config,
        digestConfigHash: hash,
      },
    };
  }

  it('CALENDAR-AUDIT-01 (Real PG + HTTP Loopback): does not claim conflict-free or complete total when provider has >20 events with unread pagination and conflicts on page 2', async () => {
    const calId = 'work@example.test';
    const googleCalls: Array<{ path: string; query: Record<string, string> }> = [];
    const slackPosts: Array<{ channel: string; text: string }> = [];

    const googleServer = createServer((req, res) => {
      const u = new URL(req.url!, 'http://127.0.0.1');
      googleCalls.push({ path: u.pathname, query: Object.fromEntries(u.searchParams) });
      res.setHeader('Content-Type', 'application/json');

      const pageToken = u.searchParams.get('pageToken');
      if (!pageToken) {
        const page1Items = Array.from({ length: 20 }, (_, i) => ({
          id: `early-${i + 1}`,
          summary: `Morning Check-in ${i + 1}`,
          htmlLink: `https://calendar.google.com/event?eid=early-${i + 1}`,
          start: { dateTime: `2026-11-16T08:${String(i).padStart(2, '0')}:00+07:00` },
          end: { dateTime: `2026-11-16T08:${String(i + 1).padStart(2, '0')}:00+07:00` },
        }));
        res.end(JSON.stringify({ items: page1Items, nextPageToken: 'page-2-with-conflict' }));
        return;
      }

      // Page 2 has overlapping events at 14:00-15:00 and 14:30-15:30
      res.end(
        JSON.stringify({
          items: [
            {
              id: 'late-conflict-1',
              summary: 'Architecture Review',
              htmlLink: 'https://calendar.google.com/event?eid=late-1',
              start: { dateTime: '2026-11-16T14:00:00+07:00' },
              end: { dateTime: '2026-11-16T15:00:00+07:00' },
            },
            {
              id: 'late-conflict-2',
              summary: 'Customer Escalation',
              htmlLink: 'https://calendar.google.com/event?eid=late-2',
              start: { dateTime: '2026-11-16T14:30:00+07:00' },
              end: { dateTime: '2026-11-16T15:30:00+07:00' },
            },
          ],
        }),
      );
    });
    servers.push(googleServer);
    googleServer.listen(0, '127.0.0.1');
    await once(googleServer, 'listening');
    const googleBaseUrl = `http://127.0.0.1:${(googleServer.address() as { port: number }).port}`;

    const slackServer = createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      slackPosts.push(JSON.parse(body));
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, ts: '1700000001.000100', channel: 'C0123456789' }));
    });
    servers.push(slackServer);
    slackServer.listen(0, '127.0.0.1');
    await once(slackServer, 'listening');
    const slackBaseUrl = `http://127.0.0.1:${(slackServer.address() as { port: number }).port}`;

    const mycalAdapter = new PersonalCalendarAdapter({
      userId: owner.id,
      tokens: { getAccessToken: async () => 'fixture-access-token' },
      allowedScope: { calendars: [calId] },
      apiBaseUrl: googleBaseUrl,
      rateLimiter: new GlobalRateLimiter({ maxRequests: 1000, windowMs: 1 }),
    });
    const slackAdapter = new SlackAdapter({
      credentials: { botToken: 'xoxb-fixture-token' },
      allowedScope: { channels: ['C0123456789'] },
      baseUrl: slackBaseUrl,
      rateLimiter: new GlobalRateLimiter({ maxRequests: 1000, windowMs: 1 }),
    });

    const { runInput, run } = await seedScheduleRun({ includeSummary: true });
    let summaryCalls = 0;

    const execute = createCalendarDigestExecutor({
      pool: db.pool,
      encryptionKey: KEY,
      timeZone: VN,
      getAdapter: async (name) => (name === 'mycalendar' ? mycalAdapter : slackAdapter),
      summarizeDigest: async () => {
        summaryCalls++;
        return 'Mọi thứ hôm nay hoàn toàn trống trải, không có xung đột.';
      },
    });

    const outcome = await execute(runInput, new AbortController().signal);
    expect(outcome.state).toBe('digest_sent');
    if (outcome.state !== 'digest_sent') return;

    // Must NOT claim unconditional conflict-free when unread pages / unknown or partial coverage exist
    expect(outcome.messageText).not.toMatch(/Không có xung đột/iu);
    // Must disclose UNKNOWN or PARTIAL coverage and never invent 20/20 total denominator
    expect(outcome.messageText).toMatch(/UNKNOWN|PARTIAL/u);
    expect(outcome.messageText).toContain('hiển thị 20/20');
    expect(outcome.messageText).not.toContain('đã đọc 20/20');
    // Must suppress AI summary when coverage is not complete
    expect(summaryCalls).toBe(0);
    expect(outcome.delivery.summaryIncluded).toBe(false);
    // Legacy DTO totalEvents remains observed count
    expect(outcome.delivery.totalEvents).toBe(20);
    expect(slackPosts).toHaveLength(1);

    const runRow = (await db.pool.query('SELECT delivery_started_at FROM schedule_runs WHERE id = $1', [run.id])).rows[0];
    expect(runRow.delivery_started_at).not.toBeNull();
  });

  it('CALENDAR-AUDIT-01 (Contract coverage matrix): distinguishes <20 complete, exact 20 complete, exact 20 incomplete (nextPageToken), and >20 partial without inventing denominators', async () => {
    const mkEvents = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `ev-${i + 1}`,
        title: `Event ${i + 1}`,
        start: `2026-11-16T${String(8 + Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}:00+07:00`,
        end: `2026-11-16T${String(8 + Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15 + 10).padStart(2, '0')}:00+07:00`,
        url: `https://calendar.google.com/event?eid=${i + 1}`,
      }));

    // 1. <20 complete (4 events)
    {
      const { runInput } = await seedScheduleRun({ includeSummary: true });
      let summaryCalls = 0;
      const execute = createCalendarDigestExecutor({
        pool: db.pool,
        encryptionKey: KEY,
        timeZone: VN,
        getAdapter: async (name) =>
          name === 'mycalendar'
            ? {
                execute: async () => ({
                  events: mkEvents(4),
                  coverage: { complete: true, returned: 4, totalAvailable: 4 },
                }),
              }
            : { execute: async () => ({ ts: '1.100000', channel: 'C0123456789' }) },
        summarizeDigest: async () => {
          summaryCalls++;
          return '4 cuộc họp ngắn buổi sáng, lịch trình thông suốt.';
        },
      });
      const outcome = await execute(runInput, new AbortController().signal);
      expect(outcome.state).toBe('digest_sent');
      if (outcome.state !== 'digest_sent') return;
      expect(outcome.messageText).toContain('COMPLETE');
      expect(outcome.messageText).toContain('đã đọc 4/4');
      expect(outcome.messageText).toContain('hiển thị 4/4');
      expect(outcome.messageText).toContain('✅ Không có xung đột giờ họp');
      expect(summaryCalls).toBe(1);
      expect(outcome.delivery.summaryIncluded).toBe(true);
    }

    // 2. Exact 20 complete (no more pages)
    {
      await db.pool.query('DELETE FROM schedule_runs; DELETE FROM schedules; DELETE FROM service_credentials;');
      const { runInput } = await seedScheduleRun({ includeSummary: true });
      let summaryCalls = 0;
      const execute = createCalendarDigestExecutor({
        pool: db.pool,
        encryptionKey: KEY,
        timeZone: VN,
        getAdapter: async (name) =>
          name === 'mycalendar'
            ? {
                execute: async () => ({
                  events: mkEvents(20),
                  coverage: { complete: true, returned: 20, totalAvailable: 20 },
                }),
              }
            : { execute: async () => ({ ts: '1.200000', channel: 'C0123456789' }) },
        summarizeDigest: async () => {
          summaryCalls++;
          return 'Đủ 20 sự kiện trong ngày, không trùng giờ.';
        },
      });
      const outcome = await execute(runInput, new AbortController().signal);
      expect(outcome.state).toBe('digest_sent');
      if (outcome.state !== 'digest_sent') return;
      expect(outcome.messageText).toContain('COMPLETE');
      expect(outcome.messageText).toContain('đã đọc 20/20');
      expect(outcome.messageText).toContain('hiển thị 20/20');
      expect(outcome.messageText).toContain('✅ Không có xung đột giờ họp');
      expect(summaryCalls).toBe(1);
      expect(outcome.delivery.summaryIncluded).toBe(true);
    }

    // 3. Exact 20 incomplete (nextPageToken present -> totalAvailable: null)
    {
      await db.pool.query('DELETE FROM schedule_runs; DELETE FROM schedules; DELETE FROM service_credentials;');
      const { runInput } = await seedScheduleRun({ includeSummary: true });
      let summaryCalls = 0;
      const execute = createCalendarDigestExecutor({
        pool: db.pool,
        encryptionKey: KEY,
        timeZone: VN,
        getAdapter: async (name) =>
          name === 'mycalendar'
            ? {
                execute: async () => ({
                  events: mkEvents(20),
                  coverage: { complete: false, returned: 20, totalAvailable: null, reason: 'next_page_token' },
                }),
              }
            : { execute: async () => ({ ts: '1.300000', channel: 'C0123456789' }) },
        summarizeDigest: async () => {
          summaryCalls++;
          return 'Should be suppressed';
        },
      });
      const outcome = await execute(runInput, new AbortController().signal);
      expect(outcome.state).toBe('digest_sent');
      if (outcome.state !== 'digest_sent') return;
      expect(outcome.messageText).toContain('PARTIAL');
      expect(outcome.messageText).toContain('tổng số thực tế: UNKNOWN');
      expect(outcome.messageText).toContain('hiển thị 20/20');
      expect(outcome.messageText).not.toContain('20/20 sự kiện khớp');
      expect(outcome.messageText).not.toMatch(/Không có xung đột/iu);
      expect(summaryCalls).toBe(0);
      expect(outcome.delivery.summaryIncluded).toBe(false);
    }

    // 4. >20 on provider with known totalAvailable (e.g. 34) vs contradictory complete:true with totalAvailable: 34
    {
      await db.pool.query('DELETE FROM schedule_runs; DELETE FROM schedules; DELETE FROM service_credentials;');
      const { runInput } = await seedScheduleRun({ includeSummary: true });
      let summaryCalls = 0;
      const execute = createCalendarDigestExecutor({
        pool: db.pool,
        encryptionKey: KEY,
        timeZone: VN,
        getAdapter: async (name) =>
          name === 'mycalendar'
            ? {
                execute: async () => ({
                  events: mkEvents(20),
                  // Even if a buggy producer claims complete:true while totalAvailable > returned (34 > 20), consumer treats it as PARTIAL
                  coverage: { complete: true, returned: 20, totalAvailable: 34, reason: 'limit_20' },
                }),
              }
            : { execute: async () => ({ ts: '1.300000', channel: 'C0123456789' }) },
        summarizeDigest: async () => {
          summaryCalls++;
          return 'Should be suppressed';
        },
      });
      const outcome = await execute(runInput, new AbortController().signal);
      expect(outcome.state).toBe('digest_sent');
      if (outcome.state !== 'digest_sent') return;
      expect(outcome.messageText).toContain('PARTIAL');
      expect(outcome.messageText).toContain('tổng số thực tế: 34');
      expect(outcome.messageText).not.toMatch(/Không có xung đột/iu);
      expect(summaryCalls).toBe(0);
      expect(outcome.delivery.summaryIncluded).toBe(false);
    }
  });

  it('CALENDAR-AUDIT-01 (Unknown coverage): treats missing coverage metadata as UNKNOWN, never complete, and suppresses summary', async () => {
    const { runInput } = await seedScheduleRun({ includeSummary: true });
    let summaryCalls = 0;
    const execute = createCalendarDigestExecutor({
      pool: db.pool,
      encryptionKey: KEY,
      timeZone: VN,
      getAdapter: async (name) =>
        name === 'mycalendar'
          ? {
              execute: async () => ({
                events: [
                  {
                    id: 'ev-1',
                    title: '1:1 Sync',
                    start: '2026-11-16T09:00:00+07:00',
                    end: '2026-11-16T09:30:00+07:00',
                    url: 'https://calendar.google.com/event?eid=1',
                  },
                ],
                // coverage intentionally omitted
              }),
            }
          : { execute: async () => ({ ts: '1.400000', channel: 'C0123456789' }) },
      summarizeDigest: async () => {
        summaryCalls++;
        return 'Should not run on unknown coverage';
      },
    });

    const outcome = await execute(runInput, new AbortController().signal);
    expect(outcome.state).toBe('digest_sent');
    if (outcome.state !== 'digest_sent') return;
    expect(outcome.messageText).toContain('UNKNOWN');
    expect(outcome.messageText).not.toContain('COMPLETE');
    expect(outcome.messageText).not.toMatch(/Không có xung đột/iu);
    expect(summaryCalls).toBe(0);
    expect(outcome.delivery.summaryIncluded).toBe(false);
  });

  it('CALENDAR-AUDIT-01 (Multi-calendar mixed coverage & >20 beyond display cap): detects conflicts beyond first 20, discloses per-calendar coverage and display clipping, and suppresses AI summary', async () => {
    const calendars = [
      { id: 'work@example.test', summary: 'Work', primary: true },
      { id: 'team@example.test', summary: 'Team' },
      { id: 'ops@example.test', summary: 'Ops' },
    ];
    const { runInput } = await seedScheduleRun({ calendars, includeSummary: true });

    const workEvents = Array.from({ length: 15 }, (_, i) => ({
      id: `work-${i + 1}`,
      title: `Work Task ${i + 1}`,
      start: `2026-11-16T08:${String(i * 2).padStart(2, '0')}:00+07:00`,
      end: `2026-11-16T08:${String(i * 2 + 1).padStart(2, '0')}:00+07:00`,
      url: `https://calendar.google.com/event?eid=work-${i + 1}`,
    }));

    // Team has 8 events: first 5 (indices 15..19) non-conflicting; indices 20 and 21 (beyond first 20!) overlap at 15:00-16:00 and 15:30-16:30
    const teamEvents = [
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `team-${i + 1}`,
        title: `Team Standup ${i + 1}`,
        start: `2026-11-16T10:${String(i * 5).padStart(2, '0')}:00+07:00`,
        end: `2026-11-16T10:${String(i * 5 + 3).padStart(2, '0')}:00+07:00`,
        url: `https://calendar.google.com/event?eid=team-${i + 1}`,
      })),
      {
        id: 'team-conflict-21',
        title: 'Release Go/No-Go',
        start: '2026-11-16T15:00:00+07:00',
        end: '2026-11-16T16:00:00+07:00',
        url: 'https://calendar.google.com/event?eid=team-21',
      },
      {
        id: 'team-conflict-22',
        title: 'Security Incident Bridge',
        start: '2026-11-16T15:30:00+07:00',
        end: '2026-11-16T16:30:00+07:00',
        url: 'https://calendar.google.com/event?eid=team-22',
      },
      {
        id: 'team-23',
        title: 'Wrap-up',
        start: '2026-11-16T17:00:00+07:00',
        end: '2026-11-16T17:15:00+07:00',
        url: 'https://calendar.google.com/event?eid=team-23',
      },
    ];

    const opsEvents = [
      {
        id: 'ops-24',
        title: 'Handover',
        start: '2026-11-16T18:00:00+07:00',
        end: '2026-11-16T18:30:00+07:00',
        url: 'https://calendar.google.com/event?eid=ops-24',
      },
      {
        id: 'ops-25',
        title: 'Night Check',
        start: '2026-11-16T19:00:00+07:00',
        end: '2026-11-16T19:30:00+07:00',
        url: 'https://calendar.google.com/event?eid=ops-25',
      },
    ];

    let summaryCalls = 0;
    const execute = createCalendarDigestExecutor({
      pool: db.pool,
      encryptionKey: KEY,
      timeZone: VN,
      getAdapter: async (name) => {
        if (name === 'mycalendar') {
          return {
            execute: async (_tool: string, args: { calendarId: string }) => {
              if (args.calendarId === 'work@example.test') {
                return {
                  events: workEvents,
                  coverage: { complete: true, returned: 15, totalAvailable: 15 },
                };
              }
              if (args.calendarId === 'team@example.test') {
                return {
                  events: teamEvents,
                  coverage: { complete: false, returned: 8, totalAvailable: null, reason: 'page_cap' },
                };
              }
              // ops@example.test omits coverage metadata -> UNKNOWN
              return { events: opsEvents };
            },
          };
        }
        return { execute: async () => ({ ts: '1.500000', channel: 'C0123456789' }) };
      },
      summarizeDigest: async () => {
        summaryCalls++;
        return 'Should not summarize partial/clipped multi-calendar data';
      },
    });

    const outcome = await execute(runInput, new AbortController().signal);
    expect(outcome.state).toBe('digest_sent');
    if (outcome.state !== 'digest_sent') return;

    // 25 observed events total, 2 conflicting events at indices 20 & 21 (beyond first 20)
    expect(outcome.delivery.totalEvents).toBe(25);
    expect(outcome.delivery.conflictCount).toBe(2);
    expect(outcome.delivery.summaryIncluded).toBe(false);
    expect(summaryCalls).toBe(0);

    // Must disclose observed 25, displayed 20/25, per-calendar coverage, and omitted conflicts
    expect(outcome.messageText).toContain('hiển thị 20/25');
    expect(outcome.messageText).toContain('Work: đầy đủ (15/15)');
    expect(outcome.messageText).toContain('Team: một phần');
    expect(outcome.messageText).toContain('Ops: UNKNOWN');
    expect(outcome.messageText).toContain('Đã lược bớt 5 sự kiện');
    expect(outcome.messageText).toContain('2 sự kiện trùng giờ');
  });

  it('CALENDAR-AUDIT-01 (Multi-calendar complete >20 display cap): suppresses AI summary when combined complete calendars exceed 20-event display cap', async () => {
    const calendars = [
      { id: 'cal1@example.test', summary: 'Cal 1', primary: true },
      { id: 'cal2@example.test', summary: 'Cal 2' },
    ];
    const { runInput } = await seedScheduleRun({ calendars, includeSummary: true });

    const cal1Events = Array.from({ length: 12 }, (_, i) => ({
      id: `c1-${i + 1}`,
      title: `C1 Meeting ${i + 1}`,
      start: `2026-11-16T08:${String(i * 4).padStart(2, '0')}:00+07:00`,
      end: `2026-11-16T08:${String(i * 4 + 2).padStart(2, '0')}:00+07:00`,
      url: `https://calendar.google.com/event?eid=c1-${i + 1}`,
    }));
    const cal2Events = Array.from({ length: 12 }, (_, i) => ({
      id: `c2-${i + 1}`,
      title: `C2 Meeting ${i + 1}`,
      start: `2026-11-16T13:${String(i * 4).padStart(2, '0')}:00+07:00`,
      end: `2026-11-16T13:${String(i * 4 + 2).padStart(2, '0')}:00+07:00`,
      url: `https://calendar.google.com/event?eid=c2-${i + 1}`,
    }));

    let summaryCalls = 0;
    const execute = createCalendarDigestExecutor({
      pool: db.pool,
      encryptionKey: KEY,
      timeZone: VN,
      getAdapter: async (name) => {
        if (name === 'mycalendar') {
          return {
            execute: async (_tool: string, args: { calendarId: string }) => {
              const items = args.calendarId === 'cal1@example.test' ? cal1Events : cal2Events;
              return {
                events: items,
                coverage: { complete: true, returned: 12, totalAvailable: 12 },
              };
            },
          };
        }
        return { execute: async () => ({ ts: '1.500000', channel: 'C0123456789' }) };
      },
      summarizeDigest: async () => {
        summaryCalls++;
        return 'Should not summarize when >20 combined events would be clipped to 20 in prompt';
      },
    });

    const outcome = await execute(runInput, new AbortController().signal);
    expect(outcome.state).toBe('digest_sent');
    if (outcome.state !== 'digest_sent') return;
    expect(outcome.delivery.totalEvents).toBe(24);
    expect(outcome.delivery.conflictCount).toBe(0);
    expect(outcome.delivery.summaryIncluded).toBe(false);
    expect(summaryCalls).toBe(0);
    expect(outcome.messageText).toContain('đã đọc 24/24');
    expect(outcome.messageText).toContain('hiển thị 20/24');
    expect(outcome.messageText).toContain('Đã lược bớt 4 sự kiện');
    expect(outcome.messageText).toContain('✅ Không có xung đột giờ họp');
  });

  it('CALENDAR-AUDIT-01 (Truthful 3900-char clipping): never slices event lines mid-string and reports exact displayed/observed counts', () => {
    const longEvents = Array.from({ length: 20 }, (_, i) => ({
      id: `long-${i + 1}`,
      title: `Cuộc họp chiến lược liên phòng ban quý 4 năm 2026 - Phiên thảo luận chuyên sâu số ${i + 1} về kiến trúc hệ thống và vận hành an toàn`,
      start: `2026-11-16T${String(8 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 === 0 ? '00' : '30'}:00+07:00`,
      end: `2026-11-16T${String(8 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 === 0 ? '25' : '55'}:00+07:00`,
      url: `https://calendar.google.com/event?eid=long-${i + 1}`,
      calendarId: 'work@example.test',
      calendarSummary: 'Lịch Công Việc Tập Đoàn',
      meetLink: `https://meet.google.com/abc-defg-${String(i + 100)}`,
      location: 'Phòng Hội Nghị Quốc Tế Tầng 18 - Tòa Nhà Trung Tâm Điều Hành Khu Vực Phía Nam',
      attendeesCount: 15 + i,
    }));

    const formatted = formatCalendarDigestMessage({
      scheduleName: 'Bản tin Lịch dày đặc',
      dueAt: new Date('2026-11-16T01:00:00.000Z'),
      timeZone: VN,
      calendarsChecked: 1,
      events: longEvents,
    });

    expect(formatted.text.length).toBeLessThanOrEqual(3900);
    const detailLines = formatted.text.split('\n').filter((line) => line.startsWith('- ['));
    expect(detailLines.length).toBeGreaterThan(0);
    expect(detailLines.length).toBeLessThan(20);
    // Every detail line must be complete (ending with 'người tham dự') rather than chopped mid-line
    for (const line of detailLines) {
      expect(line).toMatch(/người tham dự$/u);
    }
    expect(formatted.text).toContain(`hiển thị ${detailLines.length}/20`);
    expect(formatted.text).toContain(`Đã lược bớt ${20 - detailLines.length} sự kiện`);
  });

  it('CALENDAR-AUDIT-01 (Provider mid-read failure & malformed response): fails closed as digest_failed before dispatch marker on 2nd-calendar error or non-array events', async () => {
    const calendars = [
      { id: 'work@example.test', summary: 'Work', primary: true },
      { id: 'broken@example.test', summary: 'Broken' },
    ];
    const { runInput, run } = await seedScheduleRun({ calendars });
    let slackCalls = 0;

    // 1. Mid-read error on 2nd calendar after 1st calendar succeeded
    const executeMidReadError = createCalendarDigestExecutor({
      pool: db.pool,
      encryptionKey: KEY,
      timeZone: VN,
      getAdapter: async (name) => {
        if (name === 'mycalendar') {
          return {
            execute: async (_tool: string, args: { calendarId: string }) => {
              if (args.calendarId === 'work@example.test') {
                return { events: [], coverage: { complete: true, returned: 0, totalAvailable: 0 } };
              }
              throw new StepError({ message: 'Calendar upstream 503', category: 'SERVER_ERROR', statusCode: 503 });
            },
          };
        }
        return {
          execute: async () => {
            slackCalls++;
            return { ts: '1.600000', channel: 'C0123456789' };
          },
        };
      },
    });

    const midReadOutcome = await executeMidReadError(runInput, new AbortController().signal);
    expect(midReadOutcome.state).toBe('digest_failed');
    expect(slackCalls).toBe(0);
    const rowAfterMidError = (await db.pool.query('SELECT delivery_started_at FROM schedule_runs WHERE id = $1', [run.id])).rows[0];
    expect(rowAfterMidError.delivery_started_at).toBeNull();

    // 2. Malformed response where events is null/missing instead of an array
    const executeMalformed = createCalendarDigestExecutor({
      pool: db.pool,
      encryptionKey: KEY,
      timeZone: VN,
      getAdapter: async (name) => {
        if (name === 'mycalendar') {
          return {
            execute: async () => ({ events: null }),
          };
        }
        return {
          execute: async () => {
            slackCalls++;
            return { ts: '1.700000', channel: 'C0123456789' };
          },
        };
      },
    });

    const malformedOutcome = await executeMalformed(runInput, new AbortController().signal);
    expect(malformedOutcome.state).toBe('digest_failed');
    expect(slackCalls).toBe(0);
  });

  it('CALENDAR-AUDIT-05 (Real PG + HTTP Loopback last-second & midnight boundary): uses half-open [00:00:00, next-day 00:00:00) so 23:59:58 and 23:59:59 are included and next-day 00:00:00 is excluded', async () => {
    const calId = 'work@example.test';
    const capturedQueries: Array<Record<string, string>> = [];

    const googleServer = createServer((req, res) => {
      const u = new URL(req.url!, 'http://127.0.0.1');
      capturedQueries.push(Object.fromEntries(u.searchParams));
      const reqMin = Date.parse(u.searchParams.get('timeMin')!);
      const reqMax = Date.parse(u.searchParams.get('timeMax')!);

      const providerEvents = [
        {
          id: 'ev-235958',
          summary: 'Late Night Deploy 23:59:58',
          htmlLink: 'https://calendar.google.com/event?eid=235958',
          start: { dateTime: '2026-11-16T23:59:58+07:00' },
          end: { dateTime: '2026-11-17T00:05:00+07:00' },
        },
        {
          id: 'ev-235959',
          summary: 'Final Second Cutover 23:59:59',
          htmlLink: 'https://calendar.google.com/event?eid=235959',
          start: { dateTime: '2026-11-16T23:59:59+07:00' },
          end: { dateTime: '2026-11-17T00:10:00+07:00' },
        },
        {
          id: 'ev-next-midnight',
          summary: 'Next Day Midnight 00:00:00',
          htmlLink: 'https://calendar.google.com/event?eid=next-midnight',
          start: { dateTime: '2026-11-17T00:00:00+07:00' },
          end: { dateTime: '2026-11-17T00:30:00+07:00' },
        },
      ];

      // Official Google Calendar half-open interval filter: [timeMin, timeMax)
      const items = providerEvents.filter(
        (ev) => Date.parse(ev.start.dateTime) < reqMax && Date.parse(ev.end.dateTime) > reqMin,
      );
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ items }));
    });
    servers.push(googleServer);
    googleServer.listen(0, '127.0.0.1');
    await once(googleServer, 'listening');
    const googleBaseUrl = `http://127.0.0.1:${(googleServer.address() as { port: number }).port}`;

    const mycalAdapter = new PersonalCalendarAdapter({
      userId: owner.id,
      tokens: { getAccessToken: async () => 'fixture-access-token' },
      allowedScope: { calendars: [calId] },
      apiBaseUrl: googleBaseUrl,
      rateLimiter: new GlobalRateLimiter({ maxRequests: 1000, windowMs: 1 }),
    });

    const { runInput } = await seedScheduleRun({
      dueAtIso: '2026-11-16T01:00:00.000Z',
      windowHours: 24,
      includeSummary: false,
    });

    const execute = createCalendarDigestExecutor({
      pool: db.pool,
      encryptionKey: KEY,
      timeZone: VN,
      getAdapter: async (name) =>
        name === 'mycalendar' ? mycalAdapter : { execute: async () => ({ ts: '1.800000', channel: 'C0123456789' }) },
    });

    const outcome = await execute(runInput, new AbortController().signal);
    expect(outcome.state).toBe('digest_sent');
    if (outcome.state !== 'digest_sent') return;

    expect(capturedQueries).toHaveLength(1);
    expect(capturedQueries[0]!.timeMin).toBe('2026-11-16T00:00:00+07:00');
    expect(capturedQueries[0]!.timeMax).toBe('2026-11-17T00:00:00+07:00');

    expect(outcome.delivery.totalEvents).toBe(2);
    expect(outcome.messageText).toContain('Late Night Deploy 23:59:58');
    expect(outcome.messageText).toContain('Final Second Cutover 23:59:59');
    expect(outcome.messageText).not.toContain('Next Day Midnight 00:00:00');
  });

  it('CALENDAR-AUDIT-05 (24h/48h, month, year & leap-year boundaries): computes half-open calendar day bounds across month, year, and leap-year rollovers', async () => {
    const cases = [
      {
        label: '48h window in Asia/Ho_Chi_Minh',
        timeZone: 'Asia/Ho_Chi_Minh',
        dueAtIso: '2026-11-16T01:00:00.000Z',
        windowHours: 48,
        expectedMin: '2026-11-16T00:00:00+07:00',
        expectedMax: '2026-11-18T00:00:00+07:00',
      },
      {
        label: 'Month boundary (2026-11-30 24h)',
        timeZone: 'Asia/Ho_Chi_Minh',
        dueAtIso: '2026-11-30T01:00:00.000Z',
        windowHours: 24,
        expectedMin: '2026-11-30T00:00:00+07:00',
        expectedMax: '2026-12-01T00:00:00+07:00',
      },
      {
        label: 'Year boundary (2026-12-31 24h)',
        timeZone: 'Asia/Ho_Chi_Minh',
        dueAtIso: '2026-12-31T01:00:00.000Z',
        windowHours: 24,
        expectedMin: '2026-12-31T00:00:00+07:00',
        expectedMax: '2027-01-01T00:00:00+07:00',
      },
      {
        label: 'Leap year Feb 28 -> Feb 29 (2024-02-28 24h)',
        timeZone: 'Asia/Ho_Chi_Minh',
        dueAtIso: '2024-02-28T01:00:00.000Z',
        windowHours: 24,
        expectedMin: '2024-02-28T00:00:00+07:00',
        expectedMax: '2024-02-29T00:00:00+07:00',
      },
      {
        label: 'Leap year Feb 28 48h -> Mar 01 (2024-02-28 48h)',
        timeZone: 'Asia/Ho_Chi_Minh',
        dueAtIso: '2024-02-28T01:00:00.000Z',
        windowHours: 48,
        expectedMin: '2024-02-28T00:00:00+07:00',
        expectedMax: '2024-03-01T00:00:00+07:00',
      },
      {
        label: 'Leap day Feb 29 -> Mar 01 (2024-02-29 24h)',
        timeZone: 'Asia/Ho_Chi_Minh',
        dueAtIso: '2024-02-29T01:00:00.000Z',
        windowHours: 24,
        expectedMin: '2024-02-29T00:00:00+07:00',
        expectedMax: '2024-03-01T00:00:00+07:00',
      },
      {
        label: 'Non-leap year Feb 28 -> Mar 01 (2026-02-28 24h)',
        timeZone: 'Asia/Ho_Chi_Minh',
        dueAtIso: '2026-02-28T01:00:00.000Z',
        windowHours: 24,
        expectedMin: '2026-02-28T00:00:00+07:00',
        expectedMax: '2026-03-01T00:00:00+07:00',
      },
    ];

    for (const tc of cases) {
      await db.pool.query('DELETE FROM schedule_runs; DELETE FROM schedules; DELETE FROM service_credentials;');
      const { runInput } = await seedScheduleRun({
        dueAtIso: tc.dueAtIso,
        windowHours: tc.windowHours,
        includeSummary: false,
      });

      let capturedArgs: { timeMin?: string; timeMax?: string } | undefined;
      const execute = createCalendarDigestExecutor({
        pool: db.pool,
        encryptionKey: KEY,
        timeZone: tc.timeZone,
        getAdapter: async (name) =>
          name === 'mycalendar'
            ? {
                execute: async (_tool: string, args: { timeMin: string; timeMax: string }) => {
                  capturedArgs = args;
                  return { events: [], coverage: { complete: true, returned: 0, totalAvailable: 0 } };
                },
              }
            : { execute: async () => ({ ts: '1.900000', channel: 'C0123456789' }) },
      });

      const outcome = await execute(runInput, new AbortController().signal);
      expect(outcome.state, tc.label).toBe('digest_sent');
      expect(capturedArgs, tc.label).toEqual(
        expect.objectContaining({
          timeMin: tc.expectedMin,
          timeMax: tc.expectedMax,
        }),
      );
    }
  });

  it('CALENDAR-AUDIT-05 (DST named-zone day boundaries): resolves true midnight offset instead of applying offset-at-dueAt across spring-forward and fall-back transitions', async () => {
    const dstCases = [
      {
        label: 'DST spring-forward America/New_York (2026-03-08 dueAt 08:00 EDT -04:00, midnight was EST -05:00)',
        timeZone: 'America/New_York',
        dueAtIso: '2026-03-08T12:00:00.000Z',
        windowHours: 24,
        expectedMin: '2026-03-08T00:00:00-05:00',
        expectedMax: '2026-03-09T00:00:00-04:00',
      },
      {
        label: 'DST fall-back America/New_York (2026-11-01 dueAt 08:00 EST -05:00, midnight was EDT -04:00)',
        timeZone: 'America/New_York',
        dueAtIso: '2026-11-01T13:00:00.000Z',
        windowHours: 24,
        expectedMin: '2026-11-01T00:00:00-04:00',
        expectedMax: '2026-11-02T00:00:00-05:00',
      },
      {
        label: 'DST spring-forward Europe/Berlin (2026-03-29 dueAt 08:00 CEST +02:00, midnight was CET +01:00)',
        timeZone: 'Europe/Berlin',
        dueAtIso: '2026-03-29T06:00:00.000Z',
        windowHours: 24,
        expectedMin: '2026-03-29T00:00:00+01:00',
        expectedMax: '2026-03-30T00:00:00+02:00',
      },
      {
        label: 'DST fall-back Europe/Berlin (2026-10-25 dueAt 08:00 CET +01:00, midnight was CEST +02:00)',
        timeZone: 'Europe/Berlin',
        dueAtIso: '2026-10-25T07:00:00.000Z',
        windowHours: 24,
        expectedMin: '2026-10-25T00:00:00+02:00',
        expectedMax: '2026-10-26T00:00:00+01:00',
      },
    ];

    for (const tc of dstCases) {
      await db.pool.query('DELETE FROM schedule_runs; DELETE FROM schedules; DELETE FROM service_credentials;');
      const { runInput } = await seedScheduleRun({
        dueAtIso: tc.dueAtIso,
        windowHours: tc.windowHours,
        includeSummary: false,
      });

      let capturedArgs: { timeMin?: string; timeMax?: string } | undefined;
      const execute = createCalendarDigestExecutor({
        pool: db.pool,
        encryptionKey: KEY,
        timeZone: tc.timeZone,
        getAdapter: async (name) =>
          name === 'mycalendar'
            ? {
                execute: async (_tool: string, args: { timeMin: string; timeMax: string }) => {
                  capturedArgs = args;
                  return { events: [], coverage: { complete: true, returned: 0, totalAvailable: 0 } };
                },
              }
            : { execute: async () => ({ ts: '1.100000', channel: 'C0123456789' }) },
      });

      const outcome = await execute(runInput, new AbortController().signal);
      expect(outcome.state, tc.label).toBe('digest_sent');
      expect(capturedArgs, tc.label).toEqual(
        expect.objectContaining({
          timeMin: tc.expectedMin,
          timeMax: tc.expectedMax,
        }),
      );
    }
  });
});
