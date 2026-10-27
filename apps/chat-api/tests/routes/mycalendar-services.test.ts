import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { encryptCredentials, StepError } from '@wap/tool-adapters';
import { ALL_TOOLS, MYCALENDAR_TOOLS, type PlanResponse, type PlanStep } from '@wap/tool-schemas';
import { createApp } from '../../src/app.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { GmailConnectionRepo } from '../../src/db/repositories/gmail-connection-repo.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
import { AdapterFactory, type AdapterContext } from '../../src/services/adapter-factory.js';
import { getToolCatalogFor } from '../../src/services/registered-services.js';
import { ChatService } from '../../src/services/chat-service.js';
import { createGmailConnectionLookup, createMyCalendarConnectionLookup } from '../../src/services/gmail/connection-reference.js';
import { resourceLabels } from '../../src/services/resource-labels.js';
import { mayFallbackToShared } from '../../src/config/gmail-tools-runtime.js';
import { WorkingMemory } from '@wap/planner';

const secret = 'mycal_services_test_secret_at_least_32_characters';
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

type Person = Awaited<ReturnType<Awaited<ReturnType<typeof createMigratedSchema>>['person']>>;

describe('GET /api/services, AdapterFactory, ChatService, and health check for MyCalendar', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let credentials: CredentialRepo;
  let alice: Person;
  let bob: Person;
  let admin: Person;

  const buildApp = (mycalendarEnabled: boolean) =>
    createApp({
      jwtSecret: secret,
      userRepo: db.users,
      credentialRepo: credentials,
      encryptionKey: key,
      serviceAdminUserIds: [admin.id],
      mycalendar: {
        enabled: mycalendarEnabled,
        oauth,
        repo: new GmailConnectionRepo(db.pool, 'mycalendar'),
      },
    } as any);

  const bearer = (who: Person) => `Bearer ${generateAccessToken(who, secret, who.sid).accessToken}`;

  const listServices = async (enabled: boolean, who: Person) => {
    const res = await request(buildApp(enabled)).get('/api/services').set('Authorization', bearer(who));
    expect(res.status).toBe(200);
    return res.body.services as Array<Record<string, any>>;
  };

  const connectMyCalendar = (
    who: Person,
    email: string,
    selectedCalendars: Array<{ id: string; summary: string; timeZone: string; primary?: boolean }> = [],
  ) =>
    credentials.saveCredentials(
      'mycalendar',
      encryptCredentials(
        {
          refreshToken: `1//fake-mycal-${who.id}`,
          email,
          scopes: ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly'],
          connectedAt: '2026-10-27T08:00:00.000Z',
          selectedCalendars,
          allowedScope: {
            calendars: selectedCalendars.map((c) => c.id),
          },
        },
        key,
      ),
      who.id,
    );

  beforeAll(async () => {
    db = await createMigratedSchema('mycalendar_services');
    credentials = new CredentialRepo(db.pool);
  });

  beforeEach(async () => {
    await db.pool.query("DELETE FROM service_credentials WHERE service='mycalendar'");
    alice = await db.person('Alice');
    bob = await db.person('Bob');
    admin = await db.person('Admin');
  });

  afterAll(async () => {
    await db?.close();
  });

  describe('1. Flag off behavior', () => {
    it('omits mycalendarEnabled in /api/health and has no mycalendar in /api/services', async () => {
      await connectMyCalendar(alice, 'alice@example.com', [
        { id: 'alice@example.com', summary: 'Lịch chính', timeZone: 'Asia/Ho_Chi_Minh', primary: true },
      ]);

      const healthRes = await request(buildApp(false)).get('/api/health');
      expect(healthRes.status).toBe(200);
      expect(healthRes.body.mycalendarEnabled).toBeUndefined();

      const services = await listServices(false, alice);
      expect(services.map((s) => s.id)).not.toContain('mycalendar');
    });

    it('returns 404 for /api/connections/mycalendar/start when flag is off', async () => {
      const res = await request(buildApp(false))
        .post('/api/connections/mycalendar/start')
        .set('Authorization', bearer(alice))
        .send({});
      expect(res.status).toBe(404);
    });

    it('excludes MYCALENDAR_TOOLS from getToolCatalogFor when mycalendarEnabled is false', async () => {
      await connectMyCalendar(alice, 'alice@example.com', [
        { id: 'alice@example.com', summary: 'Lịch chính', timeZone: 'Asia/Ho_Chi_Minh', primary: true },
      ]);
      const catalog = await getToolCatalogFor(credentials, key, {
        userId: alice.id,
        gmailEnabled: false,
        mycalendarEnabled: false,
      });
      const toolNames = catalog.map((t) => t.name);
      expect(toolNames.some((n) => n.startsWith('mycalendar.'))).toBe(false);
    });
  });

  describe('2. scope_required state (authenticated Google, but no calendars selected yet)', () => {
    it('returns personalStatus: "scope_required", configured: false, connected: false in /api/services', async () => {
      await connectMyCalendar(alice, 'alice@example.com', []); // empty selectedCalendars

      const services = await listServices(true, alice);
      const mycal = services.find((s) => s.id === 'mycalendar');
      expect(mycal).toBeDefined();
      expect(mycal).toMatchObject({
        id: 'mycalendar',
        name: 'Google Calendar của bạn',
        connection: 'personal',
        personalStatus: 'scope_required',
        configured: false,
        connected: false,
        email: 'alice@example.com',
        selectedCalendars: [],
      });
    });

    it('excludes MYCALENDAR_TOOLS in getToolCatalogFor when in scope_required state', async () => {
      await connectMyCalendar(alice, 'alice@example.com', []);
      const catalog = await getToolCatalogFor(credentials, key, {
        userId: alice.id,
        gmailEnabled: false,
        mycalendarEnabled: true,
      });
      expect(catalog.some((t) => t.name.startsWith('mycalendar.'))).toBe(false);
    });

    it('ChatService.bindConnections refuses a mycalendar.* plan with unavailableServices', async () => {
      await connectMyCalendar(alice, 'alice@example.com', []); // scope_required
      const chatService = new ChatService({
        msgRepo: {} as any,
        planner: {} as any,
        eventEmitter: { emit: () => {} },
        mycalendarConnection: createMyCalendarConnectionLookup(credentials, key),
      });

      const plan: PlanResponse = {
        kind: 'plan',
        thinking: 'Tạo sự kiện',
        summary: 'Tạo sự kiện lịch cá nhân',
        steps: [
          {
            id: 's1',
            tool: 'mycalendar.create_event',
            description: 'Tạo sự kiện',
            args: { calendarId: 'alice@example.com', summary: 'Họp', start: '2026-10-28T09:00:00Z', end: '2026-10-28T10:00:00Z' },
            dependsOn: [],
          },
        ],
        warnings: [],
      };

      const result = await (chatService as any).bindConnections(plan, alice.id);
      expect(result.kind).toBe('refusal');
      expect(result.unavailableServices).toEqual([{ id: 'mycalendar', name: 'Google Calendar của bạn' }]);
    });
  });

  describe('3. connected state (after calendars selected)', () => {
    it('returns personalStatus: "connected", configured: true, connected: true, and selectedCalendars', async () => {
      const selected = [{ id: 'alice@example.com', summary: 'Lịch chính', timeZone: 'Asia/Ho_Chi_Minh', primary: true }];
      await connectMyCalendar(alice, 'alice@example.com', selected);

      const services = await listServices(true, alice);
      const mycal = services.find((s) => s.id === 'mycalendar');
      expect(mycal).toMatchObject({
        id: 'mycalendar',
        personalStatus: 'connected',
        configured: true,
        connected: true,
        email: 'alice@example.com',
        selectedCalendars: selected,
      });

      // Bob sees not_connected
      const bobServices = await listServices(true, bob);
      const bobCal = bobServices.find((s) => s.id === 'mycalendar');
      expect(bobCal?.personalStatus).toBe('not_connected');
      expect(bobCal?.email).toBeUndefined();
    });

    it('includes MYCALENDAR_TOOLS in getToolCatalogFor when connected', async () => {
      await connectMyCalendar(alice, 'alice@example.com', [
        { id: 'alice@example.com', summary: 'Lịch chính', timeZone: 'Asia/Ho_Chi_Minh', primary: true },
      ]);
      const catalog = await getToolCatalogFor(credentials, key, {
        userId: alice.id,
        gmailEnabled: false,
        mycalendarEnabled: true,
      });
      const mycalToolNames = MYCALENDAR_TOOLS.map((t) => t.name);
      for (const name of mycalToolNames) {
        expect(catalog.some((t) => t.name === name)).toBe(true);
      }
    });

    it('ChatService.bindConnections attaches connections.mycalendar before hashing', async () => {
      const selected = [
        { id: 'alice@example.com', summary: 'Lịch chính', timeZone: 'Asia/Ho_Chi_Minh', primary: true },
        { id: 'c_work_123', summary: 'Lịch việc riêng', timeZone: 'Asia/Ho_Chi_Minh' },
      ];
      const saved = await connectMyCalendar(alice, 'alice@example.com', selected);

      const chatService = new ChatService({
        msgRepo: {} as any,
        planner: {} as any,
        eventEmitter: { emit: () => {} },
        mycalendarConnection: createMyCalendarConnectionLookup(credentials, key),
      });

      const plan: PlanResponse = {
        kind: 'plan',
        thinking: 'Tạo sự kiện',
        summary: 'Tạo sự kiện trên lịch việc riêng',
        steps: [
          {
            id: 's1',
            tool: 'mycalendar.create_event',
            description: 'Tạo sự kiện',
            args: { calendarId: 'c_work_123', summary: 'Họp việc riêng', start: '2026-10-28T09:00:00Z', end: '2026-10-28T10:00:00Z' },
            dependsOn: [],
          },
        ],
        warnings: [],
      };

      const result = await (chatService as any).bindConnections(plan, alice.id);
      expect(result.kind).toBe('plan');
      expect(result.connections?.mycalendar).toEqual({
        credentialId: saved.id,
        email: 'alice@example.com',
        allowedCalendars: ['alice@example.com', 'c_work_123'],
      });
    });

    it('ChatService.bindConnections attaches both gmail and mycalendar when both are present in the same plan', async () => {
      const selected = [{ id: 'alice@example.com', summary: 'Lịch chính', timeZone: 'Asia/Ho_Chi_Minh', primary: true }];
      const calSaved = await connectMyCalendar(alice, 'alice@example.com', selected);
      const gmailSaved = await credentials.saveCredentials(
        'gmail',
        encryptCredentials(
          {
            refreshToken: `1//fake-gmail-${alice.id}`,
            email: 'alice.gmail@example.test',
            connectedAt: '2026-10-27T08:00:00.000Z',
          },
          key,
        ),
        alice.id,
      );

      const chatService = new ChatService({
        msgRepo: {} as any,
        planner: {} as any,
        eventEmitter: { emit: () => {} },
        gmailConnection: createGmailConnectionLookup(credentials, key),
        mycalendarConnection: createMyCalendarConnectionLookup(credentials, key),
      });

      const plan: PlanResponse = {
        kind: 'plan',
        thinking: 'Tạo lịch và gửi email',
        summary: 'Tạo lịch họp và thông báo qua Gmail',
        steps: [
          {
            id: 's1',
            tool: 'mycalendar.create_event',
            description: 'Tạo sự kiện',
            args: { calendarId: 'alice@example.com', summary: 'Họp', start: '2026-10-28T09:00:00Z', end: '2026-10-28T10:00:00Z' },
            dependsOn: [],
          },
          {
            id: 's2',
            tool: 'gmail.send_message',
            description: 'Gửi email xác nhận',
            args: { to: ['bob@example.test'], subject: 'Thông báo họp', body: 'Đã tạo lịch họp.' },
            dependsOn: ['s1'],
          },
        ],
        warnings: [],
      };

      const result = await (chatService as any).bindConnections(plan, alice.id);
      expect(result.kind).toBe('plan');
      expect(result.connections?.mycalendar).toEqual({
        credentialId: calSaved.id,
        email: 'alice@example.com',
        allowedCalendars: ['alice@example.com'],
      });
      expect(result.connections?.gmail).toEqual({
        credentialId: gmailSaved.id,
        email: 'alice.gmail@example.test',
      });
    });

    it('ChatService.bindConnections refuses if step uses a calendarId not in allowedCalendars', async () => {
      const selected = [{ id: 'alice@example.com', summary: 'Lịch chính', timeZone: 'Asia/Ho_Chi_Minh', primary: true }];
      await connectMyCalendar(alice, 'alice@example.com', selected);

      const chatService = new ChatService({
        msgRepo: {} as any,
        planner: {} as any,
        eventEmitter: { emit: () => {} },
        mycalendarConnection: createMyCalendarConnectionLookup(credentials, key),
      });

      const plan: PlanResponse = {
        kind: 'plan',
        thinking: 'Tạo sự kiện',
        summary: 'Tạo sự kiện trên lịch trái phép',
        steps: [
          {
            id: 's1',
            tool: 'mycalendar.create_event',
            description: 'Tạo sự kiện',
            args: { calendarId: 'unauthorized_cal_id', summary: 'Họp', start: '2026-10-28T09:00:00Z', end: '2026-10-28T10:00:00Z' },
            dependsOn: [],
          },
        ],
        warnings: [],
      };

      const result = await (chatService as any).bindConnections(plan, alice.id);
      expect(result.kind).toBe('refusal');
      expect(result.reason).toContain('unauthorized_cal_id');
      expect(result.unavailableServices).toEqual([{ id: 'mycalendar', name: 'Google Calendar của bạn' }]);
    });

    it('resourceLabels maps calendarId to the calendar title discovered from mycalendar.list_calendars', () => {
      const memory = new WorkingMemory();
      memory.setEntity('mycalendar', [
        { id: 'alice@example.com', title: 'Lịch chính', timeZone: 'Asia/Ho_Chi_Minh' },
        { id: 'c_work_123', title: 'Lịch việc riêng', timeZone: 'Asia/Ho_Chi_Minh' },
      ]);

      const plan: PlanResponse = {
        kind: 'plan',
        thinking: '',
        summary: '',
        steps: [
          {
            id: 'step_1',
            tool: 'mycalendar.create_event',
            description: 'Tạo lịch việc riêng',
            args: { calendarId: 'c_work_123', summary: 'Họp', start: '2026-10-28T09:00:00Z', end: '2026-10-28T10:00:00Z' },
            dependsOn: [],
          },
        ],
        warnings: [],
      };

      const labels = resourceLabels(plan, memory);
      expect(labels['c_work_123']).toBe('Lịch việc riêng');
    });
  });

  describe('4. Execution guard (Review Focus #3)', () => {
    it('AdapterFactory throws AUTH_ERROR when credentialId changed between planning and execution', async () => {
      const selected = [{ id: 'alice@example.com', summary: 'Lịch chính', timeZone: 'Asia/Ho_Chi_Minh', primary: true }];
      const oldRecord = await connectMyCalendar(alice, 'alice@example.com', selected);

      const factory = new AdapterFactory({
        credentialRepo: credentials,
        encryptionKey: key,
        createMyCalendarAdapter: () => ({ execute: async () => ({ ok: true }) } as any),
        mycalendarTokens: { forConnection: () => ({} as any), clear: () => {} } as any,
      });

      // Reconnect gives a new credentialId
      const newRecord = await connectMyCalendar(alice, 'alice@example.com', selected);
      expect(newRecord.id).not.toBe(oldRecord.id);

      const context: AdapterContext = {
        userId: alice.id,
        phase: 'execution',
        connections: {
          mycalendar: {
            credentialId: oldRecord.id, // previewed with old
            email: 'alice@example.com',
            allowedCalendars: ['alice@example.com'],
          },
        },
      };

      await expect(factory.getAdapterForService('mycalendar', context)).rejects.toThrow(
        /Kết nối hoặc phạm vi lịch Google Calendar đã thay đổi/i,
      );
    });

    it('AdapterFactory throws AUTH_ERROR when a previewed calendar was deselected before execution', async () => {
      const initialSelected = [
        { id: 'alice@example.com', summary: 'Lịch chính', timeZone: 'Asia/Ho_Chi_Minh', primary: true },
        { id: 'c_work_123', summary: 'Lịch việc riêng', timeZone: 'Asia/Ho_Chi_Minh' },
      ];
      const record = await connectMyCalendar(alice, 'alice@example.com', initialSelected);

      const factory = new AdapterFactory({
        credentialRepo: credentials,
        encryptionKey: key,
        createMyCalendarAdapter: () => ({ execute: async () => ({ ok: true }) } as any),
        mycalendarTokens: { forConnection: () => ({} as any), clear: () => {} } as any,
      });

      // Deselect 'c_work_123' by updating credentials with only primary calendar
      await credentials.saveCredentials(
        'mycalendar',
        encryptCredentials(
          {
            refreshToken: `1//fake-mycal-${alice.id}`,
            email: 'alice@example.com',
            scopes: ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly'],
            connectedAt: '2026-10-27T08:00:00.000Z',
            selectedCalendars: [{ id: 'alice@example.com', summary: 'Lịch chính', timeZone: 'Asia/Ho_Chi_Minh', primary: true }],
            allowedScope: { calendars: ['alice@example.com'] },
          },
          key,
        ),
        alice.id,
      );

      // Re-fetch the updated row to pass its id
      const updated = await credentials.getPersonalCredentials('mycalendar', alice.id);

      const context: AdapterContext = {
        userId: alice.id,
        phase: 'execution',
        connections: {
          mycalendar: {
            credentialId: updated!.id,
            email: 'alice@example.com',
            allowedCalendars: ['alice@example.com', 'c_work_123'], // previewed with c_work_123
          },
        },
      };

      await expect(factory.getAdapterForService('mycalendar', context)).rejects.toThrow(
        /Kết nối hoặc phạm vi lịch Google Calendar đã thay đổi/i,
      );
    });
  });

  describe('5. Shared administration route protection', () => {
    it('mayFallbackToShared prevents shared fallback when mycalendar intent is routed', () => {
      expect(mayFallbackToShared({ userMessage: 'Thêm vào lịch việc riêng', memory: {} as any }, false, true)).toBe(false);
      expect(mayFallbackToShared({ userMessage: 'Tạo sự kiện trong lịch cá nhân của tôi', memory: {} as any }, false, true)).toBe(false);
      expect(mayFallbackToShared({ userMessage: 'Tạo thẻ Trello', memory: {} as any }, false, true)).toBe(true);
    });

    it('refuses mycalendar on shared-key routes even for an administrator', async () => {
      const app = buildApp(true);
      for (const [method, path, body] of [
        ['post', '/api/services/mycalendar/credentials', { credentials: {}, allowedScope: ['x'] }],
        ['put', '/api/services/mycalendar/scope', { allowedScope: ['x'] }],
        ['post', '/api/services/mycalendar/test', {}],
      ] as const) {
        for (const who of [admin, alice]) {
          const res = await (request(app) as any)[method](path).set('Authorization', bearer(who)).send(body);
          expect(res.status, `${method} ${path}`).toBe(400);
          expect(res.body.code).toBe('PERSONAL_CONNECTION');
          expect(res.body.error).toContain('Google Calendar cá nhân do mỗi người tự kết nối');
        }
      }
    });
  });
});
