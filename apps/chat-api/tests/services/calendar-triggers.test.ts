import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { encryptCredentials, StepError } from '@wap/tool-adapters';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import {
  deliverCalendarTriggerNotification,
  listCalendarTriggerDestinations,
  verifyCalendarTriggerDestination,
} from '../../src/services/schedules/calendar-digest-runner.js';
import { CalendarTriggerService } from '../../src/services/calendar/calendar-trigger-service.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

const VN = 'Asia/Ho_Chi_Minh';
const key = '0123456789abcdef0123456789abcdef';
type Db = Awaited<ReturnType<typeof createMigratedSchema>>;
type Person = Awaited<ReturnType<Db['person']>>;

describe('CalendarTriggerService on PostgreSQL 16', () => {
  let db: Db;
  let owner: Person;
  let credentials: CredentialRepo;
  const services: CalendarTriggerService[] = [];

  beforeAll(async () => {
    db = await createMigratedSchema('calendar_triggers_svc');
    credentials = new CredentialRepo(db.pool, key);
  });

  beforeEach(async () => {
    await db.pool.query('DELETE FROM calendar_trigger_dispatches; DELETE FROM calendar_event_triggers; DELETE FROM service_credentials;');
    owner = await db.person('Chủ lịch');
  });

  afterEach(async () => {
    for (const s of services.splice(0)) await s.stop();
  });

  afterAll(async () => {
    await db?.close();
  });

  const seed = async (dest: 'slack' | 'telegram' = 'slack') => {
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
        encryptCredentials(
          {
            botToken: '123456:ABC',
            selectedChats: [{ chatId: '-100123456789', title: 'Nhóm Lịch' }],
            allowedScope: { chats: ['-100123456789'] },
          },
          key,
        ),
        owner.id,
      );
    }
    return mycal.id;
  };

  it('sends pre-meeting reminder once across concurrent evaluations with Meet link and attendees', async () => {
    await seed('slack');
    const fixedNow = new Date('2026-11-18T02:00:00.000Z'); // 09:00+07:00
    const sentMessages: Array<{ tool: string; args: Record<string, any> }> = [];

    const service = new CalendarTriggerService({
      pool: db.pool,
      encryptionKey: key,
      timeZone: VN,
      clock: () => fixedNow,
      verifyDestination: verifyCalendarTriggerDestination,
      listDestinations: listCalendarTriggerDestinations,
      deliverNotification: deliverCalendarTriggerNotification,
      getAdapter: async (svcName, context) => {
        if (svcName === 'mycalendar') {
          expect(context?.connections?.mycalendar?.credentialId).toBeTruthy();
          expect(context?.connections?.mycalendar?.allowedCalendars).toEqual(['owner.calendar@example.test']);
          return {
            execute: async (tool: string) => {
              expect(tool).toBe('mycalendar.list_events');
              return {
                events: [
                  {
                    id: 'evt_soon_meet',
                    title: 'Demo Sản phẩm @everyone',
                    start: '2026-11-18T09:10:00+07:00',
                    end: '2026-11-18T09:45:00+07:00',
                    url: 'https://calendar.google.com/event?eid=1',
                    meetLink: 'https://meet.google.com/abc-defg-hij',
                    location: 'Phòng họp B2',
                    attendees: ['pm@example.test', 'dev@example.test'],
                  },
                  {
                    id: 'evt_transparent',
                    title: 'Block tự do',
                    start: '2026-11-18T09:05:00+07:00',
                    end: '2026-11-18T09:30:00+07:00',
                    url: 'https://calendar.google.com/event?eid=2',
                    transparency: 'transparent',
                  },
                  {
                    id: 'evt_too_late',
                    title: 'Chiều họp',
                    start: '2026-11-18T11:00:00+07:00',
                    end: '2026-11-18T12:00:00+07:00',
                    url: 'https://calendar.google.com/event?eid=3',
                  },
                ],
                coverage: { complete: true, returned: 3, totalAvailable: 3 },
              };
            },
          };
        }
        return {
          execute: async (tool: string, args: Record<string, any>) => {
            sentMessages.push({ tool, args });
            return { messageId: 'm-1', ok: true };
          },
        };
      },
    });
    services.push(service);

    const trigger = await service.createTrigger(owner.id, {
      name: 'Nhắc trước họp 15p',
      triggerType: 'pre_meeting_reminder',
      calendarIds: ['owner.calendar@example.test'],
      leadMinutes: 15,
      destination: { service: 'slack', channelId: 'C0123456789', channelName: '#daily' },
    });

    const [r1, r2] = await Promise.all([
      service.evaluateTriggerById(trigger.id),
      service.evaluateTriggerById(trigger.id),
    ]);

    expect(sentMessages).toHaveLength(1);
    expect(r1.notificationsSent + r2.notificationsSent).toBe(1);
    expect(sentMessages[0]!.tool).toBe('slack.send_message');
    expect(sentMessages[0]!.args.channel).toBe('C0123456789');
    expect(sentMessages[0]!.args.text).toContain('Demo Sản phẩm');
    expect(sentMessages[0]!.args.text).not.toMatch(/@everyone/);
    expect(sentMessages[0]!.args.text).toContain('https://meet.google.com/abc-defg-hij');
    expect(sentMessages[0]!.args.text).toContain('Phòng họp B2');

    const dispatches = await service.listDispatches(owner.id, trigger.id);
    expect(dispatches).not.toBeNull();
    expect(dispatches!).toHaveLength(1);
    expect(dispatches![0]!.deliveryStatus).toBe('sent');
  });

  it('seeds silent baseline on first run for event_change_watch, then alerts added, rescheduled, and future cancelled events on next run', async () => {
    await seed('telegram');
    let fixedNow = new Date('2026-11-18T02:00:00.000Z');
    let currentEvents: any[] = [
      {
        id: 'evt_keep',
        title: 'Daily Standup',
        start: '2026-11-18T10:00:00+07:00',
        end: '2026-11-18T10:15:00+07:00',
        url: 'https://calendar.google.com/event?eid=keep',
      },
      {
        id: 'evt_cancel_me',
        title: 'Phỏng vấn ứng viên',
        start: '2026-11-19T14:00:00+07:00',
        end: '2026-11-19T15:00:00+07:00',
        url: 'https://calendar.google.com/event?eid=canc',
      },
      {
        id: 'evt_past_ok',
        title: 'Họp sáng đã xong',
        start: '2026-11-18T09:00:00+07:00',
        end: '2026-11-18T09:30:00+07:00',
        url: 'https://calendar.google.com/event?eid=past',
      },
    ];
    const sentMessages: Array<{ tool: string; args: Record<string, any> }> = [];

    const service = new CalendarTriggerService({
      pool: db.pool,
      encryptionKey: key,
      timeZone: VN,
      clock: () => fixedNow,
      verifyDestination: verifyCalendarTriggerDestination,
      listDestinations: listCalendarTriggerDestinations,
      deliverNotification: deliverCalendarTriggerNotification,
      getAdapter: async (svcName, context) => {
        if (svcName === 'mycalendar') {
          expect(context?.connections?.mycalendar?.credentialId).toBeTruthy();
          expect(context?.connections?.mycalendar?.allowedCalendars).toEqual(['owner.calendar@example.test']);
          return {
            execute: async () => ({
              events: currentEvents,
              coverage: { complete: true, returned: currentEvents.length, totalAvailable: currentEvents.length },
            }),
          };
        }
        return {
          execute: async (tool: string, args: Record<string, any>) => {
            sentMessages.push({ tool, args });
            return { messageId: 'tg-1', ok: true };
          },
        };
      },
    });
    services.push(service);

    const trigger = await service.createTrigger(owner.id, {
      name: 'Theo dõi đổi lịch',
      triggerType: 'event_change_watch',
      calendarIds: ['owner.calendar@example.test'],
      destination: { service: 'telegram', channelId: '-100123456789', channelName: 'Nhóm Lịch' },
    });

    const first = await service.evaluateTriggerById(trigger.id);
    expect(first.baselineSeeded).toBe(true);
    expect(first.notificationsSent).toBe(0);
    expect(sentMessages).toHaveLength(0);

    // Move clock forward to 09:30+07:00 so evt_past_ok fell behind naturally,
    // reschedule evt_keep, add evt_new, cancel evt_cancel_me
    fixedNow = new Date('2026-11-18T02:30:00.000Z');
    currentEvents = [
      {
        id: 'evt_keep',
        title: 'Daily Standup',
        start: '2026-11-18T11:00:00+07:00',
        end: '2026-11-18T11:15:00+07:00',
        url: 'https://calendar.google.com/event?eid=keep',
      },
      {
        id: 'evt_new',
        title: 'Review Thiết kế khẩn',
        start: '2026-11-18T16:00:00+07:00',
        end: '2026-11-18T17:00:00+07:00',
        url: 'https://calendar.google.com/event?eid=new',
      },
    ];

    const second = await service.evaluateTriggerById(trigger.id);
    expect(second.notificationsSent).toBe(3); // updated + added + future cancelled; NOT past_ok
    expect(sentMessages).toHaveLength(3);
    const texts = sentMessages.map((m) => m.args.text).join('\n');
    expect(texts).toContain('Review Thiết kế khẩn');
    expect(texts).toContain('Daily Standup');
    expect(texts).toContain('Phỏng vấn ứng viên');
    expect(texts).not.toContain('Họp sáng đã xong');
  });

  it('blocks trigger without dispatching when mycalendar AUTH_ERROR occurs or scope changes', async () => {
    await seed('slack');
    const fixedNow = new Date('2026-11-18T02:00:00.000Z');
    const service = new CalendarTriggerService({
      pool: db.pool,
      encryptionKey: key,
      timeZone: VN,
      clock: () => fixedNow,
      verifyDestination: verifyCalendarTriggerDestination,
      listDestinations: listCalendarTriggerDestinations,
      deliverNotification: deliverCalendarTriggerNotification,
      getAdapter: async (svcName, context) => {
        if (svcName === 'mycalendar') {
          expect(context?.connections?.mycalendar?.credentialId).toBeTruthy();
          expect(context?.connections?.mycalendar?.allowedCalendars).toEqual(['owner.calendar@example.test']);
          return {
            execute: async () => {
              throw new StepError({ category: 'AUTH_ERROR', message: 'Token revoked', statusCode: 401 });
            },
          };
        }
        throw new Error('Destination should not be called');
      },
    });
    services.push(service);

    const trigger = await service.createTrigger(owner.id, {
      name: 'Nhắc họp bảo vệ Auth',
      triggerType: 'pre_meeting_reminder',
      calendarIds: ['owner.calendar@example.test'],
      leadMinutes: 15,
      destination: { service: 'slack', channelId: 'C0123456789' },
    });

    const outcome = await service.evaluateTriggerById(trigger.id);
    expect(outcome.status).toBe('blocked');
    expect(outcome.pauseReason).toBeTruthy();
    expect(outcome.notificationsSent).toBe(0);
  });
});
