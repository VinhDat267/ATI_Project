import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { encryptCredentials } from '@wap/tool-adapters';
import { createApp } from '../../src/app.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { GmailConnectionRepo } from '../../src/db/repositories/gmail-connection-repo.js';
import {
  deliverCalendarTriggerNotification,
  listCalendarTriggerDestinations,
  verifyCalendarTriggerDestination,
} from '../../src/services/schedules/calendar-digest-runner.js';
import { CalendarTriggerService, signCalendarWatchToken } from '../../src/services/calendar/calendar-trigger-service.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

const secret = 'mycal_triggers_routes_secret_at_least_32_chars';
const key = '0123456789abcdef0123456789abcdef';
const oauth = {
  clientId: 'mycal-client',
  clientSecret: 'mycal-secret',
  redirectUri: 'http://127.0.0.1:5174/connections/mycalendar/callback',
  authorizationUrl: 'http://127.0.0.1:1/auth',
  tokenUrl: 'http://127.0.0.1:1/token',
  revokeUrl: 'http://127.0.0.1:1/revoke',
  apiBaseUrl: 'http://127.0.0.1:1',
};

type Db = Awaited<ReturnType<typeof createMigratedSchema>>;
type Person = Awaited<ReturnType<Db['person']>>;

describe('/api/connections/mycalendar/triggers & webhook routes on PostgreSQL 16', () => {
  let db: Db;
  let credentials: CredentialRepo;
  let alice: Person;
  let bob: Person;
  let sentNotifications: Array<{ tool: string; args: Record<string, any> }>;
  let fixedNow: Date;
  let upcomingEvents: any[];

  beforeAll(async () => {
    db = await createMigratedSchema('mycalendar_triggers_routes');
    credentials = new CredentialRepo(db.pool, key);
  });

  beforeEach(async () => {
    await db.pool.query('DELETE FROM calendar_trigger_dispatches; DELETE FROM calendar_event_triggers; DELETE FROM service_credentials;');
    alice = await db.person('Alice');
    bob = await db.person('Bob');
    sentNotifications = [];
    fixedNow = new Date('2026-11-18T02:00:00.000Z');
    upcomingEvents = [
      {
        id: 'evt_route_1',
        title: 'Họp Planning Tuần',
        start: '2026-11-18T09:10:00+07:00',
        end: '2026-11-18T10:00:00+07:00',
        url: 'https://calendar.google.com/event?eid=r1',
        meetLink: 'https://meet.google.com/aaa-bbbb-ccc',
      },
    ];

    await credentials.saveCredentials(
      'mycalendar',
      encryptCredentials(
        {
          refreshToken: '1//alice-cal',
          email: 'alice@example.test',
          scopes: ['https://www.googleapis.com/auth/calendar'],
          selectedCalendars: [{ id: 'alice@example.test', summary: 'Lịch Alice', primary: true }],
          allowedScope: { calendars: ['alice@example.test'] },
        },
        key,
      ),
      alice.id,
    );
    await credentials.saveCredentials(
      'slack',
      encryptCredentials({ botToken: 'xoxb-fake', allowedScope: { channels: ['C_ALLOWED_1'] } }, key),
      null,
    );
  });

  afterAll(async () => {
    await db?.close();
  });

  const bearer = (who: Person) => `Bearer ${generateAccessToken(who, secret, who.sid).accessToken}`;

  const makeTestApp = () => {
    const triggerService = new CalendarTriggerService({
      pool: db.pool,
      encryptionKey: key,
      timeZone: 'Asia/Ho_Chi_Minh',
      clock: () => fixedNow,
      webhookSecret: secret,
      verifyDestination: verifyCalendarTriggerDestination,
      listDestinations: listCalendarTriggerDestinations,
      deliverNotification: deliverCalendarTriggerNotification,
      getAdapter: async (svc) => {
        if (svc === 'mycalendar') {
          return {
            execute: async () => ({
              events: upcomingEvents,
              coverage: { complete: true, returned: upcomingEvents.length, totalAvailable: upcomingEvents.length },
            }),
          };
        }
        return {
          execute: async (tool: string, args: Record<string, any>) => {
            sentNotifications.push({ tool, args });
            return { ok: true, messageId: 'msg-1' };
          },
        };
      },
    });

    return {
      triggerService,
      app: createApp({
        jwtSecret: secret,
        userRepo: db.users,
        credentialRepo: credentials,
        encryptionKey: key,
        mycalendar: {
          enabled: true,
          oauth,
          repo: new GmailConnectionRepo(db.pool, 'mycalendar'),
          triggerService,
        },
      } as any),
    };
  };

  it('supports trigger CRUD, manual run-now, destination validation, and owner isolation', async () => {
    const { app } = makeTestApp();

    // Unapproved calendar rejected
    const badCal = await request(app)
      .post('/api/connections/mycalendar/triggers')
      .set('Authorization', bearer(alice))
      .send({
        name: 'Bad Cal',
        triggerType: 'pre_meeting_reminder',
        calendarIds: ['other-cal@example.test'],
        leadMinutes: 15,
        destination: { service: 'slack', channelId: 'C_ALLOWED_1' },
      });
    expect(badCal.status).toBe(400);

    // Unapproved Slack channel rejected
    const badChan = await request(app)
      .post('/api/connections/mycalendar/triggers')
      .set('Authorization', bearer(alice))
      .send({
        name: 'Bad Chan',
        triggerType: 'pre_meeting_reminder',
        calendarIds: ['alice@example.test'],
        leadMinutes: 15,
        destination: { service: 'slack', channelId: 'C_SECRET_999' },
      });
    expect(badChan.status).toBe(400);

    const created = await request(app)
      .post('/api/connections/mycalendar/triggers')
      .set('Authorization', bearer(alice))
      .send({
        name: 'Nhắc họp Sprint',
        triggerType: 'pre_meeting_reminder',
        calendarIds: ['alice@example.test'],
        leadMinutes: 15,
        destination: { service: 'slack', channelId: 'C_ALLOWED_1', channelName: '#general' },
      });
    expect(created.status).toBe(201);
    const triggerId = created.body.trigger.id as string;

    const listRes = await request(app)
      .get('/api/connections/mycalendar/triggers')
      .set('Authorization', bearer(alice));
    expect(listRes.status).toBe(200);
    expect(listRes.body.triggers).toHaveLength(1);
    expect(listRes.body.destinations.some((d: any) => d.channelId === 'C_ALLOWED_1')).toBe(true);

    // Bob cannot view, update, run, or delete Alice's trigger
    expect(
      (await request(app).post(`/api/connections/mycalendar/triggers/${triggerId}/run-now`).set('Authorization', bearer(bob))).status,
    ).toBe(404);
    expect(
      (await request(app).patch(`/api/connections/mycalendar/triggers/${triggerId}`).set('Authorization', bearer(bob)).send({ status: 'paused' })).status,
    ).toBe(404);
    expect(
      (await request(app).delete(`/api/connections/mycalendar/triggers/${triggerId}`).set('Authorization', bearer(bob))).status,
    ).toBe(404);

    // Manual test run sends alert once
    const runRes = await request(app)
      .post(`/api/connections/mycalendar/triggers/${triggerId}/run-now`)
      .set('Authorization', bearer(alice));
    expect(runRes.status).toBe(200);
    expect(runRes.body.result.notificationsSent).toBe(1);
    expect(sentNotifications).toHaveLength(1);

    const dispatchesRes = await request(app)
      .get(`/api/connections/mycalendar/triggers/${triggerId}/dispatches`)
      .set('Authorization', bearer(alice));
    expect(dispatchesRes.status).toBe(200);
    expect(dispatchesRes.body.dispatches).toHaveLength(1);

    const pausedRes = await request(app)
      .patch(`/api/connections/mycalendar/triggers/${triggerId}`)
      .set('Authorization', bearer(alice))
      .send({ status: 'paused' });
    expect(pausedRes.status).toBe(200);
    expect(pausedRes.body.trigger.status).toBe('paused');

    const delRes = await request(app)
      .delete(`/api/connections/mycalendar/triggers/${triggerId}`)
      .set('Authorization', bearer(alice));
    expect(delRes.status).toBe(200);
    expect(delRes.body.deleted).toBe(true);
  });

  it('rejects unauthenticated webhook spoof requests and dispatches when HMAC channel token matches', async () => {
    const { app } = makeTestApp();
    const created = await request(app)
      .post('/api/connections/mycalendar/triggers')
      .set('Authorization', bearer(alice))
      .send({
        name: 'Push Webhook Trigger',
        triggerType: 'pre_meeting_reminder',
        calendarIds: ['alice@example.test'],
        leadMinutes: 15,
        destination: { service: 'slack', channelId: 'C_ALLOWED_1' },
      });
    const triggerId = created.body.trigger.id as string;
    const channelId = 'chan-watch-abc-123';
    await db.pool.query(
      'UPDATE calendar_event_triggers SET watch_channel_id = $1, watch_resource_id = $2 WHERE id = $3',
      [channelId, 'res-watch-1', triggerId],
    );

    const spoofed = await request(app)
      .post('/api/connections/mycalendar/webhook')
      .set('x-goog-channel-id', channelId)
      .set('x-goog-channel-token', `${triggerId}.deadbeef`)
      .set('x-goog-resource-state', 'exists')
      .send({});
    expect(spoofed.status).toBe(401);
    expect(sentNotifications).toHaveLength(0);

    const validToken = signCalendarWatchToken(secret, channelId, triggerId);
    const syncPush = await request(app)
      .post('/api/connections/mycalendar/webhook')
      .set('x-goog-channel-id', channelId)
      .set('x-goog-resource-id', 'res-watch-1')
      .set('x-goog-channel-token', validToken)
      .set('x-goog-resource-state', 'sync')
      .send({});
    expect(syncPush.status).toBe(200);
    expect(sentNotifications).toHaveLength(0);

    const existsPush = await request(app)
      .post('/api/connections/mycalendar/webhook')
      .set('x-goog-channel-id', channelId)
      .set('x-goog-resource-id', 'res-watch-1')
      .set('x-goog-channel-token', validToken)
      .set('x-goog-resource-state', 'exists')
      .send({});
    expect(existsPush.status).toBe(200);
    expect(existsPush.body.notificationsSent).toBe(1);
    expect(sentNotifications).toHaveLength(1);
  });
});
