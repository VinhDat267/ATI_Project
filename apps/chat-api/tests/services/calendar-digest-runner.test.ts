import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { encryptCredentials } from '@wap/tool-adapters';
import type { CalendarDigestConfig, ScheduleRecurrence } from '@wap/tool-schemas';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { computeCalendarDigestHash } from '../../src/services/schedules/calendar-digest-candidate.js';
import {
  createCalendarDigestExecutor,
  escapeDigestText,
} from '../../src/services/schedules/calendar-digest-runner.js';
import { ScheduleRunner } from '../../src/services/schedules/schedule-runner.js';
import { ScheduleService } from '../../src/services/schedules/schedule-service.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

const VN = 'Asia/Ho_Chi_Minh';
const key = '0123456789abcdef0123456789abcdef';
const daily: ScheduleRecurrence = { type: 'daily', time: '07:30' };
type Db = Awaited<ReturnType<typeof createMigratedSchema>>;
type Person = Awaited<ReturnType<Db['person']>>;

describe('Calendar Digest Runner & ScheduleRunner integration on PostgreSQL 16', () => {
  let db: Db;
  let owner: Person;
  let credentials: CredentialRepo;
  let service: ScheduleService;
  let now: Date;
  const runners: ScheduleRunner[] = [];

  beforeAll(async () => {
    db = await createMigratedSchema('calendar_digest_runner');
    credentials = new CredentialRepo(db.pool, key);
  });

  beforeEach(async () => {
    await db.pool.query('DELETE FROM schedule_runs; DELETE FROM schedules; DELETE FROM service_credentials;');
    owner = await db.person('Chủ lịch');
    service = new ScheduleService({ pool: db.pool, timeZone: VN, encryptionKey: key });
    now = new Date('2026-10-25T00:30:30.000Z'); // 07:30:30 in Viet Nam
  });

  afterEach(async () => {
    for (const r of runners.splice(0)) await r.stop();
  });

  afterAll(async () => {
    await db?.close();
  });

  const seedConnections = async (dest: 'slack' | 'telegram' = 'slack') => {
    const mycal = await credentials.saveCredentials(
      'mycalendar',
      encryptCredentials(
        {
          refreshToken: '1//fake-cal-refresh',
          email: 'owner.calendar@example.test',
          scopes: ['openid', 'email', 'https://www.googleapis.com/auth/calendar'],
          selectedCalendars: [{ id: 'owner.calendar@example.test', summary: 'Lịch chính', primary: true }],
          allowedScope: { calendars: ['owner.calendar@example.test'] },
          connectedAt: new Date().toISOString(),
        },
        key,
      ),
      owner.id,
    );
    if (dest === 'slack') {
      await credentials.saveCredentials(
        'slack',
        encryptCredentials({ botToken: 'xoxb-fake', allowedScope: { channels: ['C0123456789'] } }, key),
        null,
      );
    } else {
      await credentials.saveCredentials(
        'telegram',
        encryptCredentials({ botToken: '123456:ABC', allowedScope: { chats: ['-100123456789'] } }, key),
        null,
      );
    }
    return mycal.id;
  };

  const insertDigestSchedule = async (
    credentialId: string,
    dest: 'slack' | 'telegram' = 'slack',
    nextRunAt = '2026-10-25T00:30:00.000Z',
  ) => {
    const convId = (await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [owner.id])).rows[0].id as string;
    const config: CalendarDigestConfig = {
      version: 1,
      source: 'mycalendar',
      credentialId,
      email: 'owner.calendar@example.test',
      calendars: [{ id: 'owner.calendar@example.test', summary: 'Lịch chính', primary: true }],
      destination:
        dest === 'slack'
          ? { service: 'slack', channelId: 'C0123456789', channelName: 'daily-briefing' }
          : { service: 'telegram', chatId: '-100123456789', chatTitle: 'Nhóm Lịch' },
      windowHours: 24,
      includeSummary: true,
    };
    const hash = computeCalendarDigestHash(config);
    const row = (
      await db.pool.query(
        `INSERT INTO schedules(user_id, conv_id, name, request, recurrence, services, status, next_run_at, kind, digest_config, digest_config_hash, digest_approved_at)
         VALUES($1, $2, 'Bản tin Lịch sáng', 'Gửi lịch họp sáng nay', $3::jsonb, $4, 'active', $5, 'calendar_digest', $6::jsonb, $7, now())
         RETURNING *`,
        [
          owner.id,
          convId,
          JSON.stringify(daily),
          dest === 'slack' ? ['mycalendar', 'slack'] : ['mycalendar', 'telegram'],
          nextRunAt,
          JSON.stringify(config),
          hash,
        ],
      )
    ).rows[0];
    return { row, config };
  };

  it('executes a due calendar_digest schedule, detects overlapping events, escapes mentions, sends to Slack, and records digest_sent', async () => {
    const credId = await seedConnections('slack');
    const { row: sched } = await insertDigestSchedule(credId, 'slack');

    const sentSlack: Array<{ channel: string; text: string }> = [];
    const runDigest = createCalendarDigestExecutor({
      pool: db.pool,
      encryptionKey: key,
      timeZone: VN,
      getAdapter: async (serviceName) => {
        if (serviceName === 'mycalendar') {
          return {
            execute: async () => ({
              events: [
                {
                  id: 'ev1',
                  title: 'Sprint Planning <!channel> & Review',
                  start: '2026-10-25T09:00:00+07:00',
                  end: '2026-10-25T10:00:00+07:00',
                  url: 'https://calendar.google.com/event?eid=1',
                },
                {
                  id: 'ev2',
                  title: 'Client Sync @here <script>',
                  start: '2026-10-25T09:30:00+07:00',
                  end: '2026-10-25T10:30:00+07:00',
                  url: 'https://calendar.google.com/event?eid=2',
                },
              ],
            }),
          };
        }
        if (serviceName === 'slack') {
          return {
            execute: async (_tool: string, args: { channel: string; text: string }) => {
              sentSlack.push(args);
              return { ts: '1700000000.000100', channel: args.channel };
            },
          };
        }
        throw new Error(`Unexpected service ${serviceName}`);
      },
      summarizeDigest: async () => 'Hôm nay bạn có 2 cuộc họp buổi sáng bị trùng giờ lúc 09:30–10:00.',
    });

    const r = new ScheduleRunner({
      pool: db.pool,
      timeZone: VN,
      now: () => now,
      planRun: async () => {
        throw new Error('planRun must not be called for calendar_digest');
      },
      runDigest,
      recordState: (client, row, at) => service.recordState(client, row, at),
    });
    runners.push(r);

    await r.tick();

    expect(sentSlack).toHaveLength(1);
    expect(sentSlack[0]!.channel).toBe('C0123456789');
    expect(sentSlack[0]!.text).toContain('&lt;!channel&gt;');
    expect(sentSlack[0]!.text).toContain('@\u200bhere');
    expect(sentSlack[0]!.text).toContain('&lt;script&gt;');
    expect(sentSlack[0]!.text).toContain('Trùng giờ với');

    const runRows = (await db.pool.query('SELECT * FROM schedule_runs WHERE schedule_id = $1', [sched.id])).rows;
    expect(runRows).toHaveLength(1);
    expect(runRows[0]!.status).toBe('digest_sent');
    expect(runRows[0]!.delivery).toMatchObject({
      destinationService: 'slack',
      channelId: 'C0123456789',
      calendarsChecked: 1,
      totalEvents: 2,
      conflictCount: 2,
      summaryIncluded: true,
    });
  });

  it('blocks the run and pauses the schedule without calling Google or Slack when mycalendar is disconnected', async () => {
    const credId = await seedConnections('slack');
    const { row: sched } = await insertDigestSchedule(credId, 'slack');
    await credentials.markReconnectRequired('mycalendar', owner.id, credId);

    let adapterCalls = 0;
    const runDigest = createCalendarDigestExecutor({
      pool: db.pool,
      encryptionKey: key,
      timeZone: VN,
      getAdapter: async () => {
        adapterCalls++;
        throw new Error('must not be called');
      },
    });

    const r = new ScheduleRunner({
      pool: db.pool,
      timeZone: VN,
      now: () => now,
      planRun: async () => {
        throw new Error('must not be called');
      },
      runDigest,
      recordState: (client, row, at) => service.recordState(client, row, at),
    });
    runners.push(r);

    await r.tick();

    expect(adapterCalls).toBe(0);
    const runRows = (await db.pool.query('SELECT * FROM schedule_runs WHERE schedule_id = $1', [sched.id])).rows;
    expect(runRows[0]!.status).toBe('blocked');
    const updatedSched = (await db.pool.query('SELECT status, pause_reason FROM schedules WHERE id = $1', [sched.id])).rows[0];
    expect(updatedSched.status).toBe('paused');
    expect(updatedSched.pause_reason).toContain('Google Calendar');
  });

  it('aborts AI summary via real AbortSignal when it exceeds summaryTimeoutMs and still sends the digest', async () => {
    const credId = await seedConnections('telegram');
    const { row: sched } = await insertDigestSchedule(credId, 'telegram');

    let summaryAborted = false;
    const sentTelegram: Array<{ chatId: string; text: string }> = [];

    const runDigest = createCalendarDigestExecutor({
      pool: db.pool,
      encryptionKey: key,
      timeZone: VN,
      summaryTimeoutMs: 40,
      getAdapter: async (serviceName) => {
        if (serviceName === 'mycalendar') {
          return {
            execute: async () => ({
              events: [
                {
                  id: 'ev1',
                  title: 'Daily Standup',
                  start: '2026-10-25T09:00:00+07:00',
                  end: '2026-10-25T09:15:00+07:00',
                  url: 'https://calendar.google.com/event?eid=1',
                },
              ],
            }),
          };
        }
        return {
          execute: async (_tool: string, args: { chatId: string; text: string }) => {
            sentTelegram.push(args);
            return { messageId: 101, chatId: args.chatId, date: 1700000000 };
          },
        };
      },
      summarizeDigest: async (_events, signal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              summaryAborted = signal.aborted;
              reject(new Error('Summary timed out'));
            },
            { once: true },
          );
        }),
    });

    const r = new ScheduleRunner({
      pool: db.pool,
      timeZone: VN,
      now: () => now,
      planRun: async () => {
        throw new Error('must not be called');
      },
      runDigest,
      recordState: (client, row, at) => service.recordState(client, row, at),
    });
    runners.push(r);

    await r.tick();

    expect(summaryAborted).toBe(true);
    expect(sentTelegram).toHaveLength(1);
    expect(sentTelegram[0]!.chatId).toBe('-100123456789');
    const runRows = (await db.pool.query('SELECT * FROM schedule_runs WHERE schedule_id = $1', [sched.id])).rows;
    expect(runRows[0]!.status).toBe('digest_sent');
    expect(runRows[0]!.delivery.summaryIncluded).toBe(false);
  });

  it('discards the digest before sending if the schedule version changed during calendar read', async () => {
    const credId = await seedConnections('slack');
    const { row: sched } = await insertDigestSchedule(credId, 'slack');

    let slackCalled = 0;
    const runDigest = createCalendarDigestExecutor({
      pool: db.pool,
      encryptionKey: key,
      timeZone: VN,
      getAdapter: async (serviceName) => {
        if (serviceName === 'mycalendar') {
          return {
            execute: async () => {
              // Simulate user modifying the schedule while calendar read is in progress
              await db.pool.query('UPDATE schedules SET version = version + 1 WHERE id = $1', [sched.id]);
              return { events: [] };
            },
          };
        }
        return {
          execute: async () => {
            slackCalled++;
            return { ts: '1', channel: 'C0123456789' };
          },
        };
      },
    });

    const r = new ScheduleRunner({
      pool: db.pool,
      timeZone: VN,
      now: () => now,
      planRun: async () => {
        throw new Error('must not be called');
      },
      runDigest,
      recordState: (client, row, at) => service.recordState(client, row, at),
    });
    runners.push(r);

    await r.tick();

    expect(slackCalled).toBe(0);
    const runRows = (await db.pool.query('SELECT * FROM schedule_runs WHERE schedule_id = $1', [sched.id])).rows;
    expect(runRows[0]!.status).toBe('discarded');
  });

  it('auto-pauses the schedule on the next tick after 3 consecutive digest_failed runs', async () => {
    const credId = await seedConnections('slack');
    const { row: sched } = await insertDigestSchedule(credId, 'slack');

    for (let i = 3; i >= 1; i--) {
      await db.pool.query(
        `INSERT INTO schedule_runs(schedule_id, schedule_version, trigger, due_at, status, error)
         VALUES($1, 1, 'scheduled', $2, 'digest_failed', 'Lỗi mạng')`,
        [sched.id, new Date(now.getTime() - i * 86_400_000)],
      );
    }

    const r = new ScheduleRunner({
      pool: db.pool,
      timeZone: VN,
      now: () => now,
      planRun: async () => {
        throw new Error('must not be called');
      },
      recordState: (client, row, at) => service.recordState(client, row, at),
    });
    runners.push(r);

    await r.tick();

    const updatedSched = (await db.pool.query('SELECT status, pause_reason FROM schedules WHERE id = $1', [sched.id])).rows[0];
    expect(updatedSched.status).toBe('paused');
    expect(updatedSched.pause_reason).toBe('3 lượt gửi bản tin liên tiếp thất bại');
  });

  it('escapeDigestText neutralizes HTML entities and Slack/Telegram mass mentions', () => {
    expect(escapeDigestText('Hello <!channel> & @here <https://evil.test|click>')).toBe(
      'Hello &lt;!channel&gt; &amp; @\u200bhere &lt;https://evil.test|click&gt;',
    );
  });
});
