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
import { CalendarTriggerService } from '../../src/services/calendar/calendar-trigger-service.js';
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
    await db.pool.query('DELETE FROM calendar_trigger_watch_channels; DELETE FROM calendar_trigger_dispatches; DELETE FROM calendar_event_triggers; DELETE FROM service_credentials;');
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
          selectedCalendars: [{ id: 'alice@example.test', summary: 'Lịch Alice', primary: true }, { id: 'team@example.test' }],
          allowedScope: { calendars: ['alice@example.test', 'team@example.test'] },
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
  const triggersPath = '/api/connections/mycalendar/triggers';

  const makeTestApp = (watch?: ConstructorParameters<typeof CalendarTriggerService>[0]['watch']) => {
    const triggerService = new CalendarTriggerService({
      pool: db.pool,
      encryptionKey: key,
      timeZone: 'Asia/Ho_Chi_Minh',
      clock: () => fixedNow,
      webhookSecret: secret,
      watch,
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

    const reminder = {
      name: 'Nhắc họp Sprint',
      triggerType: 'pre_meeting_reminder',
      calendarIds: ['alice@example.test'],
      leadMinutes: 15,
      destination: { service: 'slack', channelId: 'C_ALLOWED_1', channelName: '#general' },
    };
    const unapproved = await request(app).post(triggersPath).set('Authorization', bearer(alice)).send(reminder);
    expect(unapproved.status).toBe(409);
    expect(unapproved.body.code).toBe('CALENDAR_TRIGGER_APPROVAL_REQUIRED');
    const preview = await request(app).post(`${triggersPath}/preview`).set('Authorization', bearer(alice)).send(reminder);
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ sourceEmail: 'alice@example.test', trigger: reminder });
    expect((await request(app).get(triggersPath).set('Authorization', bearer(alice))).body.triggers).toEqual([]);
    expect((await request(app).post(triggersPath).set('Authorization', bearer(alice))
      .send({ ...reminder, leadMinutes: 20, planHash: preview.body.planHash })).status).toBe(409);
    const created = await request(app)
      .post(triggersPath)
      .set('Authorization', bearer(alice))
      .send({ ...reminder, planHash: preview.body.planHash });
    expect(created.status).toBe(201);
    const triggerId = created.body.trigger.id as string;
    expect((await request(app).post(triggersPath).set('Authorization', bearer(alice))
      .send({ ...reminder, planHash: preview.body.planHash })).status).toBe(409);
    expect((await request(app).patch(`${triggersPath}/${triggerId}`).set('Authorization', bearer(alice))
      .send({ leadMinutes: 10 })).status).toBe(409);

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

  it('blocks legacy triggers and requires a fresh approval when the source connection changes', async () => {
    const { app } = makeTestApp();
    const auth = bearer(alice);
    const draft = {
      name: 'Nhắc họp',
      triggerType: 'pre_meeting_reminder',
      calendarIds: ['team@example.test'],
      destination: { service: 'slack', channelId: 'C_ALLOWED_1' },
    };
    const original = await credentials.getPersonalCredentials('mycalendar', alice.id);
    const legacy = await db.pool.query<{ id: string }>(
      `INSERT INTO calendar_event_triggers (user_id, name, trigger_type, credential_id, calendar_ids, destination)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb) RETURNING id`,
      [alice.id, draft.name, draft.triggerType, original!.id, JSON.stringify(draft.calendarIds), JSON.stringify(draft.destination)],
    );
    const path = `${triggersPath}/${legacy.rows[0]!.id}`;
    const blocked = await request(app).post(`${path}/run-now`).set('Authorization', auth);
    expect(blocked.body.result).toMatchObject({ status: 'blocked', notificationsSent: 0 });
    expect(sentNotifications).toHaveLength(0);
    const activate = { status: 'active' };
    const firstPreview = await request(app).post(`${path}/preview`).set('Authorization', auth).send(activate);
    expect(firstPreview.status).toBe(200);

    await credentials.saveCredentials('mycalendar', encryptCredentials({
      email: 'replacement@example.test', refreshToken: '1//replacement', allowedScope: { calendars: draft.calendarIds },
    }, key), alice.id);
    for (const input of [activate, { ...activate, planHash: firstPreview.body.planHash }]) {
      const denied = await request(app).patch(path).set('Authorization', auth).send(input);
      expect(denied.status).toBe(409);
      expect(denied.body.code).toBe('CALENDAR_TRIGGER_APPROVAL_REQUIRED');
    }
    const fresh = await request(app).post(`${path}/preview`).set('Authorization', auth).send(activate);
    expect(fresh.body.sourceEmail).toBe('replacement@example.test');
    const approved = await request(app).patch(path).set('Authorization', auth).send({ ...activate, planHash: fresh.body.planHash });
    expect(approved.body.trigger.status).toBe('active');
    const run = await request(app).post(`${path}/run-now`).set('Authorization', auth);
    expect(run.body.result.notificationsSent).toBe(1);
  });

  it('registers, renews and retires each selected Google channel and validates signed notifications', async () => {
    const watched: Array<{ id: string; resourceId: string; calendar: string; token: string }> = [];
    const stopped: Array<{ id: string; resourceId: string }> = [];
    const callbackUrl = 'https://calendar.example.test/api/connections/mycalendar/webhook';
    const { app, triggerService } = makeTestApp({
      callbackUrl,
      apiBaseUrl: 'https://www.googleapis.com',
      tokens: {
        forConnection: (userId, _credentialId, refreshToken) => {
          expect(userId).toBe(alice.id);
          expect(refreshToken).toBe('1//alice-cal');
          return { getAccessToken: async () => 'test-calendar-access' };
        },
      },
      fetchFn: async (url, init) => {
        expect(init?.method).toBe('POST');
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-calendar-access');
        const body = JSON.parse(String(init?.body));
        if (String(url).endsWith('/channels/stop')) {
          stopped.push(body);
          return new Response(null, { status: 204 });
        }
        const calendar = decodeURIComponent(new URL(String(url)).pathname.split('/')[4]!);
        expect(body).toMatchObject({ type: 'web_hook', address: callbackUrl });
        const resourceId = `resource-${watched.length}`;
        watched.push({ id: body.id, calendar, token: body.token, resourceId });
        return Response.json({ id: body.id, resourceId, expiration: `${fixedNow.getTime() + 3_600_000}` });
      },
    });
    upcomingEvents = [];
    const config = {
      name: 'Push Webhook Trigger',
      triggerType: 'event_change_watch',
      calendarIds: ['alice@example.test', 'team@example.test'],
      destination: { service: 'slack', channelId: 'C_ALLOWED_1' },
    };
    const preview = await request(app).post(`${triggersPath}/preview`).set('Authorization', bearer(alice)).send(config);
    expect(preview.status).toBe(200);
    const created = await request(app)
      .post(triggersPath)
      .set('Authorization', bearer(alice))
      .send({ ...config, planHash: preview.body.planHash });
    const triggerId = created.body.trigger.id as string;
    expect(created.status).toBe(201);
    expect(created.body.trigger.watchActive).toBe(false);
    await triggerService.evaluateAllActiveTriggers();
    expect(watched.map((channel) => channel.calendar)).toEqual(['alice@example.test', 'team@example.test']);
    expect((await triggerService.listTriggers(alice.id))[0]).toMatchObject({ watchActive: true, watchExpiration: '2026-11-18T03:00:00.000Z' });
    const { id: channelId, token: validToken, resourceId } = watched[0]!;

    const spoofed = await request(app)
      .post('/api/connections/mycalendar/webhook')
      .set('x-goog-channel-id', channelId)
      .set('x-goog-channel-token', `${triggerId}.deadbeef`)
      .set('x-goog-resource-state', 'exists')
      .send({});
    expect(spoofed.status).toBe(401);
    expect(sentNotifications).toHaveLength(0);

    const syncPush = await request(app)
      .post('/api/connections/mycalendar/webhook')
      .set('x-goog-channel-id', channelId)
      .set('x-goog-resource-id', resourceId)
      .set('x-goog-channel-token', validToken)
      .set('x-goog-resource-state', 'sync')
      .send({});
    expect(syncPush.status).toBe(200);
    expect(sentNotifications).toHaveLength(0);
    const missingResource = await request(app)
      .post('/api/connections/mycalendar/webhook')
      .set('x-goog-channel-id', channelId)
      .set('x-goog-channel-token', validToken)
      .set('x-goog-resource-state', 'exists');
    expect(missingResource.status).toBe(401);

    upcomingEvents = [{ id: 'new-event', title: 'Họp mới', start: '2026-11-18T09:15:00+07:00', end: '2026-11-18T10:00:00+07:00' }];
    const existsPush = await request(app)
      .post('/api/connections/mycalendar/webhook')
      .set('x-goog-channel-id', channelId)
      .set('x-goog-resource-id', resourceId)
      .set('x-goog-channel-token', validToken)
      .set('x-goog-resource-state', 'exists')
      .send({});
    expect(existsPush.status).toBe(200);
    expect(existsPush.body.notificationsSent).toBe(2);
    expect(sentNotifications).toHaveLength(2);

    fixedNow = new Date('2026-11-18T02:55:00.000Z');
    await triggerService.evaluateAllActiveTriggers();
    expect(watched).toHaveLength(4);
    expect(stopped).toEqual(watched.slice(0, 2).map(({ id, resourceId }) => ({ id, resourceId })));
    expect((await triggerService.listTriggers(alice.id))[0]).toMatchObject({ watchActive: true, watchExpiration: '2026-11-18T03:55:00.000Z' });

    await triggerService.updateTrigger(alice.id, triggerId, { status: 'paused' });
    expect((await triggerService.listTriggers(alice.id))[0]?.watchActive).toBe(false);
    await triggerService.evaluateAllActiveTriggers();
    expect(stopped).toHaveLength(4);
  });
});
