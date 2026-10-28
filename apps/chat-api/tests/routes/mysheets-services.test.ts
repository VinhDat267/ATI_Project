import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { encryptCredentials, StepError } from '@wap/tool-adapters';
import { ALL_TOOLS, MYSHEETS_TOOLS, type PersonalSpreadsheetItem, type PlanResponse, type PlanStep } from '@wap/tool-schemas';
import { createApp } from '../../src/app.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { GmailConnectionRepo } from '../../src/db/repositories/gmail-connection-repo.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
import { AdapterFactory, type AdapterContext } from '../../src/services/adapter-factory.js';
import { getToolCatalogFor } from '../../src/services/registered-services.js';
import { ChatService } from '../../src/services/chat-service.js';
import { createGmailConnectionLookup, createMyCalendarConnectionLookup, createMySheetsConnectionLookup } from '../../src/services/gmail/connection-reference.js';
import { resourceLabels } from '../../src/services/resource-labels.js';
import { mayFallbackToShared } from '../../src/config/gmail-tools-runtime.js';
import { WorkingMemory } from '@wap/planner';

const secret = 'mysheets_services_test_secret_32_chars_min';
const key = '0123456789abcdef0123456789abcdef';
const oauth = {
  clientId: 'mysheets-client',
  clientSecret: 'mysheets-secret',
  redirectUri: 'http://127.0.0.1:5174/connections/mysheets/callback',
  authorizationUrl: 'http://127.0.0.1:1/auth',
  tokenUrl: 'http://127.0.0.1:1/token',
  revokeUrl: 'http://127.0.0.1:1/revoke',
  apiBaseUrl: 'http://127.0.0.1:1',
};

type Person = Awaited<ReturnType<Awaited<ReturnType<typeof createMigratedSchema>>['person']>>;

describe('GET /api/services, AdapterFactory, ChatService, and health check for MySheets', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let credentials: CredentialRepo;
  let alice: Person;
  let bob: Person;
  let admin: Person;

  const buildApp = (mysheetsEnabled: boolean) =>
    createApp({
      jwtSecret: secret,
      userRepo: db.users,
      credentialRepo: credentials,
      encryptionKey: key,
      serviceAdminUserIds: [admin.id],
      mysheets: {
        enabled: mysheetsEnabled,
        oauth,
        repo: new GmailConnectionRepo(db.pool, 'mysheets', 'connect_mysheets'),
      },
    } as any);

  const bearer = (who: Person) => `Bearer ${generateAccessToken(who, secret, who.sid).accessToken}`;

  const listServices = async (enabled: boolean, who: Person) => {
    const res = await request(buildApp(enabled)).get('/api/services').set('Authorization', bearer(who));
    expect(res.status).toBe(200);
    return res.body.services as Array<Record<string, any>>;
  };

  const connectMySheets = (
    who: Person,
    email: string,
    selectedSpreadsheets: PersonalSpreadsheetItem[] = [],
  ) =>
    credentials.saveCredentials(
      'mysheets',
      encryptCredentials(
        {
          refreshToken: `1//fake-mysheets-${who.id}`,
          email,
          scopes: ['https://www.googleapis.com/auth/drive.file'],
          connectedAt: '2026-10-28T08:00:00.000Z',
          selectedSpreadsheets,
          allowedScope: {
            spreadsheets: selectedSpreadsheets.map((s) => s.id),
          },
        },
        key,
      ),
      who.id,
    );

  beforeAll(async () => {
    db = await createMigratedSchema('mysheets_services');
    credentials = new CredentialRepo(db.pool);
  });

  beforeEach(async () => {
    await db.pool.query("DELETE FROM service_credentials WHERE service='mysheets'");
    alice = await db.person('Alice');
    bob = await db.person('Bob');
    admin = await db.person('Admin');
  });

  afterAll(async () => {
    await db?.close();
  });

  describe('1. Flag off behavior', () => {
    it('omits mysheetsEnabled in /api/health and has no mysheets in /api/services', async () => {
      await connectMySheets(alice, 'alice@example.com', [
        { id: 'sheet_alice_1', title: 'Bảng tính 1', canEdit: true },
      ]);

      const healthRes = await request(buildApp(false)).get('/api/health');
      expect(healthRes.status).toBe(200);
      expect(healthRes.body.mysheetsEnabled).toBeUndefined();

      const services = await listServices(false, alice);
      expect(services.map((s) => s.id)).not.toContain('mysheets');
    });

    it('returns 404 for /api/connections/mysheets/start when flag is off', async () => {
      const res = await request(buildApp(false))
        .post('/api/connections/mysheets/start')
        .set('Authorization', bearer(alice))
        .send({});
      expect(res.status).toBe(404);
    });

    it('excludes MYSHEETS_TOOLS from getToolCatalogFor when mysheetsEnabled is false', async () => {
      await connectMySheets(alice, 'alice@example.com', [
        { id: 'sheet_alice_1', title: 'Bảng tính 1', canEdit: true },
      ]);
      const catalog = await getToolCatalogFor(credentials, key, {
        userId: alice.id,
        gmailEnabled: false,
        mycalendarEnabled: false,
        mysheetsEnabled: false,
      });
      const toolNames = catalog.map((t) => t.name);
      expect(toolNames.some((n) => n.startsWith('mysheets.'))).toBe(false);
    });
  });

  describe('2. scope_required state (authenticated Google, but no spreadsheets selected yet)', () => {
    it('returns personalStatus: "scope_required", configured: false, connected: false in /api/services', async () => {
      await connectMySheets(alice, 'alice@example.com', []);

      const services = await listServices(true, alice);
      const mysheets = services.find((s) => s.id === 'mysheets');
      expect(mysheets).toBeDefined();
      expect(mysheets).toMatchObject({
        id: 'mysheets',
        name: 'Google Sheets của bạn',
        connection: 'personal',
        personalStatus: 'scope_required',
        configured: false,
        connected: false,
        email: 'alice@example.com',
        selectedSpreadsheets: [],
      });
    });

    it('excludes MYSHEETS_TOOLS in getToolCatalogFor when in scope_required state', async () => {
      await connectMySheets(alice, 'alice@example.com', []);
      const catalog = await getToolCatalogFor(credentials, key, {
        userId: alice.id,
        gmailEnabled: false,
        mysheetsEnabled: true,
      });
      expect(catalog.some((t) => t.name.startsWith('mysheets.'))).toBe(false);
    });

    it('ChatService.bindConnections refuses a mysheets.* plan with unavailableServices', async () => {
      await connectMySheets(alice, 'alice@example.com', []); // scope_required
      const chatService = new ChatService({
        msgRepo: {} as any,
        planner: {} as any,
        eventEmitter: { emit: () => {} },
        mysheetsConnection: createMySheetsConnectionLookup(credentials, key),
      });

      const plan: PlanResponse = {
        kind: 'plan',
        thinking: 'Đọc dữ liệu',
        summary: 'Đọc bảng tính cá nhân',
        steps: [
          {
            id: 's1',
            tool: 'mysheets.read_range',
            description: 'Đọc bảng',
            args: { spreadsheetId: 'sheet_alice_1', range: 'Sheet1!A1:B10' },
            dependsOn: [],
          },
        ],
        warnings: [],
      };

      const result = await (chatService as any).bindConnections(plan, alice.id);
      expect(result.kind).toBe('refusal');
      expect(result.unavailableServices).toEqual([{ id: 'mysheets', name: 'Google Sheets của bạn' }]);
    });
  });

  describe('3. connected state (after spreadsheets selected)', () => {
    it('returns personalStatus: "connected", configured: true, connected: true, and selectedSpreadsheets', async () => {
      const selected = [
        { id: 'sheet_alice_1', title: 'Bảng tính 1', canEdit: true },
        { id: 'sheet_alice_ro', title: 'Bảng tính xem', canEdit: false },
      ];
      await connectMySheets(alice, 'alice@example.com', selected);

      const services = await listServices(true, alice);
      const mysheets = services.find((s) => s.id === 'mysheets');
      expect(mysheets).toMatchObject({
        id: 'mysheets',
        personalStatus: 'connected',
        configured: true,
        connected: true,
        email: 'alice@example.com',
        selectedSpreadsheets: selected,
      });

      // Bob sees not_connected
      const bobServices = await listServices(true, bob);
      const bobSheets = bobServices.find((s) => s.id === 'mysheets');
      expect(bobSheets?.personalStatus).toBe('not_connected');
      expect(bobSheets?.email).toBeUndefined();
    });

    it('includes MYSHEETS_TOOLS in getToolCatalogFor when connected', async () => {
      await connectMySheets(alice, 'alice@example.com', [
        { id: 'sheet_alice_1', title: 'Bảng tính 1', canEdit: true },
      ]);
      const catalog = await getToolCatalogFor(credentials, key, {
        userId: alice.id,
        gmailEnabled: false,
        mysheetsEnabled: true,
      });
      const mysheetsToolNames = MYSHEETS_TOOLS.map((t) => t.name);
      for (const name of mysheetsToolNames) {
        expect(catalog.some((t) => t.name === name)).toBe(true);
      }
    });

    it('ChatService.bindConnections attaches connections.mysheets before hashing', async () => {
      const selected = [
        { id: 'sheet_alice_1', title: 'Bảng tính việc', canEdit: true },
        { id: 'sheet_alice_2', title: 'Bảng tính phụ', canEdit: true },
      ];
      const saved = await connectMySheets(alice, 'alice@example.com', selected);

      const chatService = new ChatService({
        msgRepo: {} as any,
        planner: {} as any,
        eventEmitter: { emit: () => {} },
        mysheetsConnection: createMySheetsConnectionLookup(credentials, key),
      });

      const plan: PlanResponse = {
        kind: 'plan',
        thinking: 'Thêm dòng mới',
        summary: 'Thêm dòng mới vào bảng việc',
        steps: [
          {
            id: 's1',
            tool: 'mysheets.append_rows',
            description: 'Thêm dòng',
            args: { spreadsheetId: 'sheet_alice_1', range: 'Sheet1!A:B', values: [['Slide', '05/11']] },
            dependsOn: [],
          },
        ],
        warnings: [],
      };

      const result = await (chatService as any).bindConnections(plan, alice.id);
      expect(result.kind).toBe('plan');
      expect(result.connections?.mysheets).toEqual({
        credentialId: saved.id,
        email: 'alice@example.com',
        allowedSpreadsheets: ['sheet_alice_1', 'sheet_alice_2'],
      });
    });

    it('ChatService.bindConnections attaches gmail, mycalendar, and mysheets when all three are present', async () => {
      const sheetsSaved = await connectMySheets(alice, 'alice@example.com', [
        { id: 'sheet_1', title: 'Bảng 1', canEdit: true },
      ]);
      const calSaved = await credentials.saveCredentials(
        'mycalendar',
        encryptCredentials(
          {
            refreshToken: `1//fake-mycal-${alice.id}`,
            email: 'alice@example.com',
            scopes: ['https://www.googleapis.com/auth/calendar.events'],
            connectedAt: '2026-10-28T08:00:00.000Z',
            selectedCalendars: [{ id: 'cal_1', summary: 'Lịch 1', timeZone: 'Asia/Ho_Chi_Minh' }],
            allowedScope: { calendars: ['cal_1'] },
          },
          key,
        ),
        alice.id,
      );
      const gmailSaved = await credentials.saveCredentials(
        'gmail',
        encryptCredentials(
          {
            refreshToken: `1//fake-gmail-${alice.id}`,
            email: 'alice.gmail@example.test',
            connectedAt: '2026-10-28T08:00:00.000Z',
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
        mysheetsConnection: createMySheetsConnectionLookup(credentials, key),
      });

      const plan: PlanResponse = {
        kind: 'plan',
        thinking: 'Tạo lịch, đọc sheet, gửi mail',
        summary: 'Quy trình tổng hợp',
        steps: [
          {
            id: 's1',
            tool: 'mycalendar.create_event',
            description: 'Tạo sự kiện',
            args: { calendarId: 'cal_1', summary: 'Họp', start: '2026-10-28T09:00:00Z', end: '2026-10-28T10:00:00Z' },
            dependsOn: [],
          },
          {
            id: 's2',
            tool: 'mysheets.read_range',
            description: 'Đọc dữ liệu',
            args: { spreadsheetId: 'sheet_1', range: 'Sheet1!A1:B5' },
            dependsOn: [],
          },
          {
            id: 's3',
            tool: 'gmail.send_message',
            description: 'Gửi thư',
            args: { to: ['bob@example.test'], subject: 'Thông báo', body: 'Đã xong' },
            dependsOn: ['s1', 's2'],
          },
        ],
        warnings: [],
      };

      const result = await (chatService as any).bindConnections(plan, alice.id);
      expect(result.kind).toBe('plan');
      expect(result.connections?.mysheets).toEqual({
        credentialId: sheetsSaved.id,
        email: 'alice@example.com',
        allowedSpreadsheets: ['sheet_1'],
      });
      expect(result.connections?.mycalendar).toEqual({
        credentialId: calSaved.id,
        email: 'alice@example.com',
        allowedCalendars: ['cal_1'],
      });
      expect(result.connections?.gmail).toEqual({
        credentialId: gmailSaved.id,
        email: 'alice.gmail@example.test',
      });
    });

    it('ChatService.bindConnections refuses if step uses a spreadsheetId not in allowedSpreadsheets', async () => {
      await connectMySheets(alice, 'alice@example.com', [
        { id: 'sheet_alice_1', title: 'Bảng tính 1', canEdit: true },
      ]);

      const chatService = new ChatService({
        msgRepo: {} as any,
        planner: {} as any,
        eventEmitter: { emit: () => {} },
        mysheetsConnection: createMySheetsConnectionLookup(credentials, key),
      });

      const plan: PlanResponse = {
        kind: 'plan',
        thinking: 'Đọc bảng trái phép',
        summary: 'Đọc bảng',
        steps: [
          {
            id: 's1',
            tool: 'mysheets.read_range',
            description: 'Đọc bảng',
            args: { spreadsheetId: 'unauthorized_sheet_id', range: 'Sheet1!A1:B10' },
            dependsOn: [],
          },
        ],
        warnings: [],
      };

      const result = await (chatService as any).bindConnections(plan, alice.id);
      expect(result.kind).toBe('refusal');
      expect(result.reason).toContain('unauthorized_sheet_id');
      expect(result.unavailableServices).toEqual([{ id: 'mysheets', name: 'Google Sheets của bạn' }]);
    });

    it('ChatService.bindConnections refuses if mysheets.append_rows is called on a read-only spreadsheet', async () => {
      await connectMySheets(alice, 'alice@example.com', [
        { id: 'sheet_alice_ro', title: 'Bảng Điểm Danh (Chỉ xem)', canEdit: false },
      ]);

      const chatService = new ChatService({
        msgRepo: {} as any,
        planner: {} as any,
        eventEmitter: { emit: () => {} },
        mysheetsConnection: createMySheetsConnectionLookup(credentials, key),
      });

      const plan: PlanResponse = {
        kind: 'plan',
        thinking: 'Thêm dòng vào bảng chỉ xem',
        summary: 'Thêm dòng',
        steps: [
          {
            id: 's1',
            tool: 'mysheets.append_rows',
            description: 'Thêm dòng',
            args: { spreadsheetId: 'sheet_alice_ro', range: 'Sheet1!A:B', values: [['Alice', 'Present']] },
            dependsOn: [],
          },
        ],
        warnings: [],
      };

      const result = await (chatService as any).bindConnections(plan, alice.id);
      expect(result.kind).toBe('refusal');
      expect(result.reason).toBe('Bảng tính "Bảng Điểm Danh (Chỉ xem)" chỉ cho xem, ATI không thêm dòng được.');
      expect(result.unavailableServices).toEqual([{ id: 'mysheets', name: 'Google Sheets của bạn' }]);
    });

    it('ChatService.bindConnections refuses a plan targeting a read-only spreadsheet via $ref', async () => {
      await connectMySheets(alice, 'alice@example.com', [
        { id: 'sheet_alice_ro', title: 'Bảng Điểm Danh (Chỉ xem)', canEdit: false },
      ]);

      const chatService = new ChatService({
        msgRepo: {} as any,
        planner: {} as any,
        eventEmitter: { emit: () => {} },
        mysheetsConnection: createMySheetsConnectionLookup(credentials, key),
      });

      const plan: any = {
        kind: 'plan',
        title: 'Thêm dòng bằng tham chiếu',
        summary: 'Thêm dòng',
        steps: [
          {
            id: 'find',
            tool: 'mysheets.list_spreadsheets',
            description: 'Tìm bảng tính',
            args: { query: 'Điểm Danh' },
            dependsOn: [],
          },
          {
            id: 's2',
            tool: 'mysheets.append_rows',
            description: 'Thêm dòng',
            args: { spreadsheetId: { $ref: 'find.output[0].id' }, range: 'Sheet1!A:B', rows: [['Alice', 'Present']] },
            dependsOn: ['find'],
          },
        ],
        warnings: [],
      };

      const result = await (chatService as any).bindConnections(plan, alice.id);
      expect(result.kind).toBe('refusal');
      expect(result.reason).toBe('Bảng tính "Bảng Điểm Danh (Chỉ xem)" chỉ cho xem, ATI không thêm dòng được.');
      expect(result.unavailableServices).toEqual([{ id: 'mysheets', name: 'Google Sheets của bạn' }]);
    });

    it('ChatService.bindConnections refuses append_rows via $ref when query specifically matches a read-only spreadsheet', async () => {
      await connectMySheets(alice, 'alice@example.com', [
        { id: 'sheet_writable', title: 'Việc của tôi', canEdit: true },
        { id: 'sheet_ro', title: 'Báo cáo mật (Chỉ xem)', canEdit: false },
      ]);

      const chatService = new ChatService({
        msgRepo: {} as any,
        planner: {} as any,
        eventEmitter: { emit: () => {} },
        mysheetsConnection: createMySheetsConnectionLookup(credentials, key),
      });

      const plan: any = {
        kind: 'plan',
        title: 'Thêm dòng vào báo cáo mật',
        summary: 'Thêm dòng',
        steps: [
          {
            id: 'find',
            tool: 'mysheets.list_spreadsheets',
            description: 'Tìm bảng tính',
            args: { query: 'Báo cáo mật' },
            dependsOn: [],
          },
          {
            id: 's2',
            tool: 'mysheets.append_rows',
            description: 'Thêm dòng',
            args: { spreadsheetId: { $ref: 'find.output[0].id' }, range: 'Sheet1!A:B', rows: [['Dòng mới']] },
            dependsOn: ['find'],
          },
        ],
        warnings: [],
      };

      const result = await (chatService as any).bindConnections(plan, alice.id);
      expect(result.kind).toBe('refusal');
      expect(result.reason).toBe('Bảng tính "Báo cáo mật (Chỉ xem)" chỉ cho xem, ATI không thêm dòng được.');
    });
  });

  describe('4. reconnect_required state', () => {
    it('returns personalStatus: "reconnect_required" and unconfigured in /api/services', async () => {
      const saved = await connectMySheets(
        alice,
        'alice@example.com',
        [{ id: 'sheet_1', title: 'Bảng 1', canEdit: true }],
      );
      await credentials.markReconnectRequired('mysheets', alice.id, saved.id);

      const services = await listServices(true, alice);
      const mysheets = services.find((s) => s.id === 'mysheets');
      expect(mysheets?.personalStatus).toBe('reconnect_required');
      expect(mysheets?.configured).toBe(false);
      expect(mysheets?.connected).toBe(false);
    });
  });

  describe('5. Admin shared-key routes reject mysheets', () => {
    it('POST /api/services/mysheets/credentials returns 400 PERSONAL_CONNECTION', async () => {
      const res = await request(buildApp(true))
        .post('/api/services/mysheets/credentials')
        .set('Authorization', bearer(admin))
        .send({ credentials: {}, allowedScope: [] });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('PERSONAL_CONNECTION');
    });

    it('PUT /api/services/mysheets/scope returns 400 PERSONAL_CONNECTION', async () => {
      const res = await request(buildApp(true))
        .put('/api/services/mysheets/scope')
        .set('Authorization', bearer(admin))
        .send({ allowedScope: [] });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('PERSONAL_CONNECTION');
    });

    it('POST /api/services/mysheets/test returns 400 PERSONAL_CONNECTION', async () => {
      const res = await request(buildApp(true))
        .post('/api/services/mysheets/test')
        .set('Authorization', bearer(admin));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('PERSONAL_CONNECTION');
    });
  });

  describe('6. AdapterFactory for MySheets', () => {
    it('throws AUTH_ERROR during execution if previewed credentialId does not match current', async () => {
      const saved = await connectMySheets(alice, 'alice@example.com', [
        { id: 'sheet_1', title: 'Bảng 1', canEdit: true },
      ]);

      const factory = new AdapterFactory({
        credentialRepo: credentials,
        encryptionKey: key,
        mysheetsTokens: {} as any,
        createMySheetsAdapter: () => ({ execute: async () => ({}) }),
      });

      const context: AdapterContext = {
        userId: alice.id,
        phase: 'execution',
        connections: {
          mysheets: {
            credentialId: 'different_credential_id',
            email: 'alice@example.com',
            allowedSpreadsheets: ['sheet_1'],
          },
        },
      };

      await expect(factory.getAdapterForService('mysheets', context)).rejects.toThrow(
        'Kết nối hoặc danh sách bảng tính đã đổi, hãy lập lại kế hoạch.',
      );
    });

    it('throws AUTH_ERROR during execution if allowedSpreadsheets changed', async () => {
      const saved = await connectMySheets(alice, 'alice@example.com', [
        { id: 'sheet_1', title: 'Bảng 1', canEdit: true },
      ]);

      const factory = new AdapterFactory({
        credentialRepo: credentials,
        encryptionKey: key,
        mysheetsTokens: {} as any,
        createMySheetsAdapter: () => ({ execute: async () => ({}) }),
      });

      const context: AdapterContext = {
        userId: alice.id,
        phase: 'execution',
        connections: {
          mysheets: {
            credentialId: saved.id,
            email: 'alice@example.com',
            allowedSpreadsheets: ['sheet_1', 'sheet_removed'],
          },
        },
      };

      await expect(factory.getAdapterForService('mysheets', context)).rejects.toThrow(
        'Kết nối hoặc danh sách bảng tính đã đổi, hãy lập lại kế hoạch.',
      );
    });

    it('clearPersonal clears mysheets cache and tokens', async () => {
      const mockTokens = {
        clear: (userId: string) => {},
      };
      let clearedUserId = '';
      mockTokens.clear = (userId: string) => { clearedUserId = userId; };

      const factory = new AdapterFactory({
        credentialRepo: credentials,
        encryptionKey: key,
        mysheetsTokens: mockTokens as any,
      });

      factory.clearPersonal('user_test_123');
      expect(clearedUserId).toBe('user_test_123');
    });
  });

  describe('7. resourceLabels for MySheets', () => {
    it('maps spreadsheetId to the title discovered from mysheets.list_spreadsheets', () => {
      const memory = new WorkingMemory();
      memory.setEntity('myspreadsheet', [
        { id: 'sheet_personal_abc', title: 'Bảng Kế Hoạch 2026' },
      ]);

      const plan: PlanResponse = {
        kind: 'plan',
        thinking: '',
        summary: '',
        steps: [
          {
            id: 'step_1',
            tool: 'mysheets.read_range',
            description: 'Đọc kế hoạch',
            args: { spreadsheetId: 'sheet_personal_abc', range: 'Sheet1!A1:C10' },
            dependsOn: [],
          },
        ],
        warnings: [],
      };

      const labels = resourceLabels(plan, memory);
      expect(labels['sheet_personal_abc']).toBe('Bảng Kế Hoạch 2026');
    });
  });

  describe('8. mayFallbackToShared for MySheets', () => {
    it('returns false when query mentions personal spreadsheet and mysheetsEnabled is true', () => {
      const result = mayFallbackToShared(
        { userMessage: 'Ghi một dòng vào bảng tính của tôi', memory: new WorkingMemory() },
        false,
        false,
        true,
      );
      expect(result).toBe(false);
    });

    it('returns true when query mentions shared spreadsheet', () => {
      const result = mayFallbackToShared(
        { userMessage: 'Ghi một dòng vào bảng tính chung của nhóm', memory: new WorkingMemory() },
        false,
        false,
        true,
      );
      expect(result).toBe(true);
    });
  });
});
