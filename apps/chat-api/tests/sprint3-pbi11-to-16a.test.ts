import { createHash } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { encryptCredentials } from '@wap/tool-adapters';
import { generateAccessToken } from '../src/auth/jwt.js';
import { trelloOAuth } from '../src/config/env.js';
import { ConversationRepo } from '../src/db/repositories/conversation-repo.js';
import { JiraOAuthRepo } from '../src/db/repositories/jira-oauth-repo.js';
import { createGitHubConnectionRoutes } from '../src/routes/connections/github.js';
import { createTelegramConnectionRoutes } from '../src/routes/connections/telegram.js';
import { createTrelloConnectionRoutes } from '../src/routes/connections/trello.js';
import { createServicesRoutes } from '../src/routes/services-routes.js';
import { createBackupSandboxProvider, createSandboxProvider } from '../src/sandbox/scenarios.js';
import { JiraTokenManager } from '../src/services/jira/jira-token-manager.js';
import { evaluateCalendarDigestCandidate } from '../src/services/schedules/calendar-digest-candidate.js';
import { createCalendarDigestExecutor } from '../src/services/schedules/calendar-digest-runner.js';
import { ScheduleService } from '../src/services/schedules/schedule-service.js';
import { analyzeSheetsDigestCandidate } from '../src/services/schedules/sheets-digest-candidate.js';
import { SheetsDigestRunner } from '../src/services/schedules/sheets-digest-runner.js';

const TEST_JWT_SECRET = 'test-jwt-secret-minimum-32-characters!!';
const TEST_ENCRYPTION_KEY = 'a'.repeat(64);
const WRONG_ENCRYPTION_KEY = 'b'.repeat(64);
const TEST_SESSION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('Sprint 3 Backend PBIs (PBI-11 to PBI-16A)', () => {
  describe('PBI-11: Adaptive Sandbox Provider when SANDBOX_SCENARIO is unset', () => {
    it('returns slackOnlyPlan for Slack-only prompt without Trello', async () => {
      const provider = createSandboxProvider(undefined);
      const raw = await provider.generatePlan({
        systemPrompt: 'system',
        toolCatalog: [],
        workingMemory: {},
        conversationHistory: [
          { role: 'user', content: 'Gửi tin nhắn Slack vào kênh #general báo cáo tiến độ' },
        ],
      });
      const parsed = JSON.parse(raw);
      expect(parsed.kind).toBe('plan');
      expect(parsed.steps).toHaveLength(1);
      expect(parsed.steps[0].tool).toBe('slack.send_message');
      expect(parsed.steps[0].args.channel).toBe('#general');
    });

    it('returns sandboxPlan when Trello is mentioned', async () => {
      const provider = createSandboxProvider(undefined);
      const raw = await provider.generatePlan({
        systemPrompt: 'system',
        toolCatalog: [],
        workingMemory: {},
        conversationHistory: [
          { role: 'user', content: 'Tạo thẻ trên Trello và gửi thông báo lên Slack #general' },
        ],
      });
      const parsed = JSON.parse(raw);
      expect(parsed.kind).toBe('plan');
      expect(parsed.steps.some((s: any) => s.tool === 'trello.create_card')).toBe(true);
    });

    it('returns jiraPlan, notionPlan, telegramPlan, sheetsPlan, calendarPlan based on prompt keywords', async () => {
      const provider = createSandboxProvider(undefined);

      const jiraRaw = await provider.generatePlan({
        systemPrompt: 'system',
        toolCatalog: [],
        workingMemory: {},
        conversationHistory: [{ role: 'user', content: 'Tạo issue Jira cho lỗi đăng nhập' }],
      });
      expect(JSON.parse(jiraRaw).steps[0].tool).toBe('jira.create_issue');

      const notionRaw = await provider.generatePlan({
        systemPrompt: 'system',
        toolCatalog: [],
        workingMemory: {},
        conversationHistory: [{ role: 'user', content: 'Tạo trang Notion ghi chú cuộc họp' }],
      });
      expect(JSON.parse(notionRaw).steps[0].tool).toBe('notion.create_page');

      const telegramRaw = await provider.generatePlan({
        systemPrompt: 'system',
        toolCatalog: [],
        workingMemory: {},
        conversationHistory: [{ role: 'user', content: 'Gửi tin nhắn Telegram cho nhóm vận hành' }],
      });
      expect(JSON.parse(telegramRaw).steps[0].tool).toBe('telegram.send_message');

      const sheetsRaw = await provider.generatePlan({
        systemPrompt: 'system',
        toolCatalog: [],
        workingMemory: {},
        conversationHistory: [{ role: 'user', content: 'Ghi thêm dòng mới vào bảng tính doanh thu' }],
      });
      expect(JSON.parse(sheetsRaw).steps[0].tool).toBe('sheets.read_range');

      const calendarRaw = await provider.generatePlan({
        systemPrompt: 'system',
        toolCatalog: [],
        workingMemory: {},
        conversationHistory: [{ role: 'user', content: 'Tạo lịch họp nhóm vào 9h sáng mai' }],
      });
      expect(JSON.parse(calendarRaw).steps[0].tool).toBe('calendar.create_event');
    });

    it('returns schedule response for recurring schedule prompt unless in scheduled run turn', async () => {
      const provider = createSandboxProvider(undefined);
      const scheduleRaw = await provider.generatePlan({
        systemPrompt: 'system',
        toolCatalog: [],
        workingMemory: {},
        conversationHistory: [
          { role: 'user', content: 'Mỗi sáng 8h gửi báo cáo tiến độ vào Slack #general' },
        ],
      });
      const scheduleParsed = JSON.parse(scheduleRaw);
      expect(scheduleParsed.kind).toBe('schedule');

      const runTurnRaw = await provider.generatePlan({
        systemPrompt: 'system',
        toolCatalog: [],
        workingMemory: {},
        conversationHistory: [
          { role: 'user', content: '[Lượt chạy tự động] Mỗi sáng 8h gửi báo cáo tiến độ vào Slack #general' },
        ],
      });
      const runTurnParsed = JSON.parse(runTurnRaw);
      expect(runTurnParsed.kind).toBe('plan');
      expect(runTurnParsed.steps[0].tool).toBe('slack.send_message');
    });

    it('adapts createBackupSandboxProvider for Slack-only prompt as well', async () => {
      const backup = createBackupSandboxProvider();
      const raw = await backup.generatePlan({
        systemPrompt: 'system',
        toolCatalog: [],
        workingMemory: {},
        conversationHistory: [{ role: 'user', content: 'Gửi thông báo vào #general trên Slack' }],
      });
      const parsed = JSON.parse(raw);
      expect(parsed.kind).toBe('plan');
      expect(parsed.steps).toHaveLength(1);
      expect(parsed.steps[0].tool).toBe('slack.send_message');
    });
  });

  describe('PBI-12: Telegram connection selectedChats and GET /chats alias', () => {
    const user = { id: '11111111-1111-1111-1111-111111111111', email: 'alice@example.com', name: 'Alice', sid: TEST_SESSION_ID };
    const token = generateAccessToken(user, TEST_JWT_SECRET, TEST_SESSION_ID).accessToken;

    it('returns selectedChats alongside chats in GET /, POST /callback, PUT /scope and supports GET /chats', async () => {
      const savedStore = new Map<string, string>();
      const sampleChat = {
        chatId: '-100998877',
        title: 'Nhóm Kỹ Thuật ATI',
        type: 'supergroup' as const,
        username: 'ati_eng',
      };
      const encryptedInitial = encryptCredentials(
        {
          telegramUserId: '998877',
          username: 'alice_tg',
          displayName: 'Alice TG',
          selectedChats: [sampleChat],
          knownChats: [sampleChat],
        },
        TEST_ENCRYPTION_KEY,
      );
      savedStore.set(`telegram:${user.id}`, encryptedInitial);

      const credentialRepo = {
        getPersonalConnectionStatus: vi.fn(async (_service: string, userId: string) => {
          const cfg = savedStore.get(`telegram:${userId}`);
          return cfg ? { status: 'active', connected: true, config: cfg, updatedAt: new Date() } : null;
        }),
        saveCredentials: vi.fn(async (service: string, config: string, userId: string) => {
          savedStore.set(`${service}:${userId}`, config);
        }),
        deleteCredentials: vi.fn(),
      } as any;

      const botClient = {
        getMe: vi.fn(async () => ({ id: '12345', username: 'ati_bot' })),
        getChatMember: vi.fn(async () => true),
        getChat: vi.fn(async (chatId: string) => ({
          chatId,
          title: 'Nhóm Kỹ Thuật ATI',
          type: 'supergroup' as const,
          username: 'ati_eng',
        })),
        discoverGroups: vi.fn(async () => []),
      } as any;

      const app = express();
      app.use(express.json());
      app.use(
        '/api/connections/telegram',
        createTelegramConnectionRoutes({
          jwtSecret: TEST_JWT_SECRET,
          sessionRepo: { findActiveUser: async () => user } as any,
          states: {} as any,
          bot: {
            botToken: '12345:ABCDEF',
            botUsername: 'ati_bot',
            callbackUrl: 'http://localhost:5173/connections/telegram/callback',
          } as any,
          credentialRepo,
          encryptionKey: TEST_ENCRYPTION_KEY,
          botClient,
        }),
      );

      const getRes = await request(app)
        .get('/api/connections/telegram')
        .set('Authorization', `Bearer ${token}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.status).toBe('connected');
      expect(getRes.body.chats).toHaveLength(1);
      expect(getRes.body.selectedChats).toEqual([
        expect.objectContaining({
          chatId: '-100998877',
          title: 'Nhóm Kỹ Thuật ATI',
          type: 'supergroup',
          username: 'ati_eng',
          member: true,
        }),
      ]);

      const chatsAliasRes = await request(app)
        .get('/api/connections/telegram/chats')
        .set('Authorization', `Bearer ${token}`);
      expect(chatsAliasRes.status).toBe(200);
      expect(chatsAliasRes.body.chats).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            chatId: '-100998877',
            title: 'Nhóm Kỹ Thuật ATI',
          }),
        ]),
      );

      const putScopeRes = await request(app)
        .put('/api/connections/telegram/scope')
        .set('Authorization', `Bearer ${token}`)
        .send({ chatIds: ['-100998877'] });
      expect(putScopeRes.status).toBe(200);
      expect(putScopeRes.body.chats).toHaveLength(1);
      expect(putScopeRes.body.selectedChats).toEqual([
        expect.objectContaining({
          chatId: '-100998877',
          title: 'Nhóm Kỹ Thuật ATI',
          type: 'supergroup',
          member: true,
        }),
      ]);
    });
  });

  describe('PBI-13: Digest priority order and reading Telegram selectedChats', () => {
    it('reads Telegram selectedChats objects in evaluateCalendarDigestCandidate and analyzeSheetsDigestCandidate', async () => {
      const userId = '11111111-1111-1111-1111-111111111111';
      const telegramEncrypted = encryptCredentials(
        {
          telegramUserId: '998877',
          username: 'alice_tg',
          displayName: 'Alice TG',
          selectedChats: [
            { chatId: '-100555666', title: 'Kênh Báo Cáo Chung', type: 'supergroup' },
          ],
          knownChats: [
            { chatId: '-100555666', title: 'Kênh Báo Cáo Chung', type: 'supergroup' },
          ],
        },
        TEST_ENCRYPTION_KEY,
      );
      const sheetsEncrypted = encryptCredentials(
        {
          refreshToken: 'rt',
          email: 'alice@example.com',
          spreadsheets: [{ id: 'sheet-123', name: 'Doanh thu Q4' }],
        },
        TEST_ENCRYPTION_KEY,
      );

      const credentialRepo = {
        getPersonalConnectionStatus: vi.fn(async (service: string) => {
          if (service === 'telegram') {
            return { connected: true, config: telegramEncrypted, updatedAt: new Date() };
          }
          if (service === 'mysheets') {
            return { connected: true, config: sheetsEncrypted, updatedAt: new Date() };
          }
          return { connected: false, config: null };
        }),
        getStatus: vi.fn(async () => ({ connected: false, config: null })),
      } as any;

      const mycalEncrypted = encryptCredentials(
        {
          refreshToken: 'rt',
          email: 'alice@example.com',
          selectedCalendars: [{ id: 'primary', summary: 'Lịch chính', primary: true }],
        },
        TEST_ENCRYPTION_KEY,
      );
      const fakePool = {
        query: vi.fn(async (sql: string) => {
          if (sql.includes("service = 'mycalendar'")) {
            return {
              rowCount: 1,
              rows: [{ id: 'cred-cal-1', config: mycalEncrypted, status: 'active' }],
            };
          }
          if (sql.includes('FROM service_credentials')) {
            return {
              rowCount: 1,
              rows: [{ id: 'cred-tg-1', config: telegramEncrypted, status: 'active' }],
            };
          }
          return { rowCount: 0, rows: [] };
        }),
      } as any;

      const calDigest = await evaluateCalendarDigestCandidate({
        pool: fakePool,
        userId,
        services: ['mycalendar', 'telegram'],
        request: 'Mỗi sáng gửi lịch họp hôm nay qua Telegram',
        encryptionKey: TEST_ENCRYPTION_KEY,
      });

      expect(calDigest.candidate.canAutoDigest).toBe(true);
      expect(calDigest.config?.destination).toEqual({
        service: 'telegram',
        chatId: '-100555666',
      });

      const sheetsDigest = await analyzeSheetsDigestCandidate({
        userId,
        request: 'Mỗi sáng gửi báo cáo bảng tính Doanh thu Q4 qua Telegram',
        services: ['mysheets', 'telegram'],
        credentialRepo,
        encryptionKey: TEST_ENCRYPTION_KEY,
        mysheetsEnabled: true,
      });

      expect(sheetsDigest.canAutoDigest).toBe(true);
      expect(sheetsDigest.config?.destination).toEqual({
        service: 'telegram',
        chatId: '-100555666',
      });
    });

    it('prioritizes sheets_digest over telegram_digest in ScheduleService.confirmProposal when both services are present', async () => {
      const userId = '11111111-1111-1111-1111-111111111111';
      const convId = '22222222-2222-4222-8222-222222222222';
      const msgId = '33333333-3333-4333-8333-333333333333';
      const telegramEncrypted = encryptCredentials(
        {
          telegramUserId: '998877',
          username: 'alice_tg',
          displayName: 'Alice TG',
          selectedChats: [{ chatId: '-100555666', title: 'Kênh Báo Cáo', type: 'supergroup' }],
          knownChats: [{ chatId: '-100555666', title: 'Kênh Báo Cáo', type: 'supergroup' }],
        },
        TEST_ENCRYPTION_KEY,
      );
      const sheetsEncrypted = encryptCredentials(
        {
          refreshToken: 'rt',
          email: 'alice@example.com',
          spreadsheets: [{ id: 'sheet-123', name: 'Doanh thu Q4' }],
        },
        TEST_ENCRYPTION_KEY,
      );

      const credentialRepo = {
        getPersonalConnectionStatus: vi.fn(async (service: string) => {
          if (service === 'telegram') return { status: 'active', connected: true, config: telegramEncrypted };
          if (service === 'mysheets') return { status: 'active', connected: true, config: sheetsEncrypted };
          return null;
        }),
        getStatus: vi.fn(async () => ({ connected: false, config: null })),
      } as any;

      let insertedKind: string | null = null;
      const fakeClient = {
        query: vi.fn(async (sql: string, params?: any[]) => {
          if (sql.includes('FROM conversations WHERE id=$1 FOR UPDATE')) {
            return {
              rowCount: 1,
              rows: [{ user_id: userId, workspace_id: null, workspace_mode: 'personal' }],
            };
          }
          if (sql.includes('SELECT * FROM schedules WHERE conv_id=$1 FOR UPDATE')) {
            return { rowCount: 0, rows: [] };
          }
          if (sql.includes('COUNT(*)::int AS count FROM schedules')) {
            return { rowCount: 1, rows: [{ count: 0 }] };
          }
          if (sql.includes('FROM messages')) {
            return {
              rowCount: 1,
              rows: [
                {
                  id: msgId,
                  conv_id: convId,
                  role: 'assistant',
                  content: 'Đề xuất lịch',
                  user_id: userId,
                  workspace_id: null,
                  metadata: {
                    type: 'schedule_proposal',
                    proposal: {
                      kind: 'schedule',
                      action: 'create',
                      name: 'Báo cáo bảng tính',
                      request: 'Mỗi sáng gửi báo cáo bảng tính Doanh thu Q4 qua Telegram',
                      recurrence: { type: 'daily', time: '08:00' },
                      summary: 'Mỗi sáng 8h gửi báo cáo bảng tính qua Telegram',
                    },
                    services: ['mysheets', 'telegram'],
                    nextRuns: ['2026-11-03T01:00:00.000Z'],
                    scheduleId: null,
                    baseVersion: null,
                    digestCandidate: {
                      canAutoDigest: true,
                      config: {
                        version: 1,
                        source: {
                          service: 'mysheets',
                          spreadsheetId: 'sheet-123',
                          spreadsheetTitle: 'Doanh thu Q4',
                          tailRows: 20,
                        },
                        destination: {
                          service: 'telegram',
                          chatId: '-100555666',
                        },
                        includeAiSummary: true,
                      },
                    },
                  },
                },
              ],
            };
          }
          if (sql.includes('INSERT INTO schedules')) {
            insertedKind = params?.[10] ?? null;
            return {
              rowCount: 1,
              rows: [
                {
                  id: '44444444-4444-4444-8444-444444444444',
                  user_id: userId,
                  workspace_id: null,
                  conv_id: convId,
                  name: 'Báo cáo bảng tính',
                  request: 'Mỗi sáng gửi báo cáo bảng tính Doanh thu Q4 qua Telegram',
                  services: ['mysheets', 'telegram'],
                  recurrence: { type: 'daily', time: '08:00' },
                  time_zone: 'Asia/Ho_Chi_Minh',
                  status: 'active',
                  next_run_at: new Date('2026-11-03T01:00:00.000Z'),
                  last_run_at: null,
                  last_run_status: null,
                  last_run_error: null,
                  pause_reason: null,
                  version: 1,
                  kind: insertedKind,
                  digest_config: params?.[11] ? JSON.parse(params[11]) : null,
                  digest_state: {},
                },
              ],
            };
          }
          if (sql.includes('FROM schedule_runs')) {
            return { rowCount: 0, rows: [] };
          }
          return { rowCount: 1, rows: [{ id: '55555555-5555-4555-8555-555555555555' }] };
        }),
        release: vi.fn(),
      };

      const fakePool = {
        connect: vi.fn(async () => fakeClient),
        query: fakeClient.query,
      } as any;

      const scheduleService = new ScheduleService({
        pool: fakePool,
        timeZone: 'Asia/Ho_Chi_Minh',
        credentialRepo,
        encryptionKey: TEST_ENCRYPTION_KEY,
        mysheetsEnabled: true,
      });

      const result = await scheduleService.confirmProposal({
        convId,
        messageId: msgId,
        userId,
        now: new Date('2026-11-02T10:00:00.000Z'),
        approvalMode: 'auto_digest',
      });

      expect(insertedKind).toBe('sheets_digest');
      expect(result.schedule.kind).toBe('sheets_digest');
    });
  });

  describe('PBI-14A: Trello OAuth fallback & status consistency and GitHub workspace scope permissions', () => {
    it('falls back to TRELLO_API_KEY and TRELLO_API_SECRET in trelloOAuth()', () => {
      const cfg = trelloOAuth({
        TRELLO_OAUTH_CLIENT_ID: undefined,
        TRELLO_OAUTH_CLIENT_SECRET: undefined,
        TRELLO_API_KEY: 'trello-fallback-key',
        TRELLO_API_SECRET: 'trello-fallback-secret',
        TRELLO_OAUTH_REDIRECT_URI: 'http://localhost:5173/connections/trello/callback',
      } as any);

      expect(cfg).toMatchObject({
        clientId: 'trello-fallback-key',
        clientSecret: 'trello-fallback-secret',
        redirectUri: 'http://localhost:5173/connections/trello/callback',
      });
    });

    it('returns connected personal Trello status in GET /api/connections/trello when personal credential exists even without OAuth config', async () => {
      const user = { id: '22222222-2222-2222-2222-222222222222', email: 'bob@example.com', name: 'Bob', sid: TEST_SESSION_ID };
      const token = generateAccessToken(user, TEST_JWT_SECRET, TEST_SESSION_ID).accessToken;
      const encryptedTrello = encryptCredentials(
        {
          accessToken: 'trello-token',
          accessTokenSecret: 'trello-secret',
          trelloMemberId: 'member-1',
          username: 'bob_trello',
          fullName: 'Bob Trello',
          selectedBoards: [{ boardId: 'board-1', boardName: 'Sprint Board' }],
          knownBoards: [{ boardId: 'board-1', boardName: 'Sprint Board' }],
        },
        TEST_ENCRYPTION_KEY,
      );

      const credentialRepo = {
        getPersonalConnectionStatus: vi.fn(async (service: string, userId: string) => {
          if (service === 'trello' && userId === user.id) {
            return { status: 'active', connected: true, config: encryptedTrello, updatedAt: new Date() };
          }
          return null;
        }),
      } as any;

      const app = express();
      app.use(express.json());
      app.use(
        '/api/connections/trello',
        createTrelloConnectionRoutes({
          jwtSecret: TEST_JWT_SECRET,
          sessionRepo: { findActiveUser: async () => user } as any,
          oauth: undefined,
          credentialRepo,
          encryptionKey: TEST_ENCRYPTION_KEY,
        }),
      );

      const res = await request(app)
        .get('/api/connections/trello')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('connected');
      expect(res.body.username).toBe('bob_trello');
      expect(res.body.boards).toEqual([{ boardId: 'board-1', boardName: 'Sprint Board', selected: true }]);
    });

    it('allows personal workspace user and organization admin to call GitHub candidate-repos and PUT /scope', async () => {
      const memberUser = { id: '33333333-3333-3333-3333-333333333333', email: 'member@example.com', name: 'Member', sid: TEST_SESSION_ID };
      const token = generateAccessToken(memberUser, TEST_JWT_SECRET, TEST_SESSION_ID).accessToken;
      const encryptedGh = encryptCredentials(
        {
          accessToken: 'gho_token',
          githubUserId: '777',
          login: 'member_gh',
          name: 'Member GH',
          selectedRepos: [{ repoId: '1', fullName: 'ati/repo-one', name: 'repo-one', owner: 'ati', private: false }],
          knownRepos: [{ repoId: '1', fullName: 'ati/repo-one', name: 'repo-one', owner: 'ati', private: false }],
        },
        TEST_ENCRYPTION_KEY,
      );

      const credentialRepo = {
        getPersonalConnectionStatus: vi.fn(async () => ({
          status: 'active',
          connected: true,
          config: encryptedGh,
          updatedAt: new Date(),
        })),
        saveCredentials: vi.fn(async () => {}),
      } as any;

      const orgAdminWsId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const orgMemberWsId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      const workspaceRepo = {
        findMember: vi.fn(async (workspaceId: string) => {
          if (workspaceId === orgAdminWsId) {
            return { status: 'active', workspaceId: orgAdminWsId, workspaceName: 'Org Admin WS', role: 'admin' };
          }
          if (workspaceId === orgMemberWsId) {
            return { status: 'active', workspaceId: orgMemberWsId, workspaceName: 'Org Member WS', role: 'member' };
          }
          return null;
        }),
      } as any;

      const app = express();
      app.use(express.json());
      app.use(
        '/api/connections/github',
        createGitHubConnectionRoutes({
          jwtSecret: TEST_JWT_SECRET,
          sessionRepo: { findActiveUser: async () => memberUser } as any,
          states: {} as any,
          oauth: {
            clientId: 'gh-client',
            clientSecret: 'gh-secret',
            redirectUri: 'http://localhost:3001/api/connections/github/callback',
            returnOrigin: 'http://localhost:5173',
          },
          credentialRepo,
          workspaceRepo,
          encryptionKey: TEST_ENCRYPTION_KEY,
          adminUserIds: ['00000000-0000-0000-0000-000000000001'],
        } as any),
      );

      const personalRes = await request(app)
        .get('/api/connections/github/candidate-repos')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Workspace-Id', 'personal');
      expect(personalRes.status).toBe(200);
      expect(personalRes.body.repos).toHaveLength(1);

      const orgAdminScopeRes = await request(app)
        .put('/api/connections/github/scope')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Workspace-Id', orgAdminWsId)
        .send({ fullNames: ['ati/repo-one'] });
      expect(orgAdminScopeRes.status).toBe(200);

      const orgMemberScopeRes = await request(app)
        .put('/api/connections/github/scope')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Workspace-Id', orgMemberWsId)
        .send({ fullNames: ['ati/repo-one'] });
      expect(orgMemberScopeRes.status).toBe(403);
    });
  });

  describe('PBI-15: Resilient decryptCredentials in JiraOAuthRepo, JiraTokenManager, and PUT /api/services/:service/scope', () => {
    it('returns reconnect_required in JiraOAuthRepo.getConnectionStatus when stored token cannot be decrypted', async () => {
      const corruptedCiphertext = encryptCredentials({ token: 'secret' }, WRONG_ENCRYPTION_KEY);
      const fakePool = {
        query: vi.fn(async (sql: string) => {
          if (sql.includes('FROM jira_accounts')) {
            return {
              rowCount: 1,
              rows: [
                {
                  id: 'acc-1',
                  user_id: 'user-1',
                  atlassian_account_id: 'atl-1',
                  display_name: 'Alice Jira',
                  status: 'connected',
                  identity_version: 1,
                },
              ],
            };
          }
          if (sql.includes('FROM jira_oauth_grants')) {
            return {
              rowCount: 1,
              rows: [
                {
                  id: 'grant-1',
                  status: 'active',
                  encrypted_access_token: corruptedCiphertext,
                  encrypted_refresh_token: corruptedCiphertext,
                },
              ],
            };
          }
          if (sql.includes('FROM jira_grant_sites')) {
            return {
              rowCount: 1,
              rows: [
                {
                  cloud_id: 'cloud-1',
                  site_url: 'https://ati.atlassian.net',
                  site_name: 'ATI Jira',
                  last_verified_at: new Date(),
                },
              ],
            };
          }
          return { rowCount: 0, rows: [] };
        }),
      } as any;

      const repo = new JiraOAuthRepo(fakePool, TEST_ENCRYPTION_KEY);
      const status = await repo.getConnectionStatus('user-1');
      expect(status.connectionState).toBe('reconnect_required');
    });

    it('updates grant status and throws JiraTokenError(TOKEN_REFRESH_FAILED) in JiraTokenManager when decryption fails', async () => {
      const corruptedCiphertext = encryptCredentials({ token: 'secret' }, WRONG_ENCRYPTION_KEY);
      const updatedStatuses: string[] = [];
      const fakePool = {
        query: vi.fn(async (sql: string) => {
          if (sql.includes('FROM jira_accounts a')) {
            return {
              rowCount: 1,
              rows: [
                {
                  account_id: 'acc-1',
                  account_status: 'connected',
                  identity_version: 1,
                  grant_id: 'grant-1',
                  grant_status: 'active',
                  status_reason: null,
                  encrypted_access_token: corruptedCiphertext,
                  encrypted_refresh_token: corruptedCiphertext,
                  token_version: 1,
                  expires_at: new Date(Date.now() + 3600_000),
                  refresh_state: 'idle',
                  refresh_attempt_id: null,
                  refresh_started_at: null,
                },
              ],
            };
          }
          if (sql.includes('UPDATE jira_oauth_grants')) {
            updatedStatuses.push(sql);
            return { rowCount: 1, rows: [] };
          }
          return { rowCount: 0, rows: [] };
        }),
      } as any;

      const manager = new JiraTokenManager({
        pool: fakePool,
        encryptionKey: TEST_ENCRYPTION_KEY,
        client: {} as any,
      });

      await expect(manager.getAccessToken('user-1')).rejects.toMatchObject({
        code: 'TOKEN_REFRESH_FAILED',
      });
      expect(updatedStatuses.length).toBeGreaterThan(0);
    });

    it('returns 409 instead of 500 in PUT /api/services/:service/scope when stored credentials cannot be decrypted', async () => {
      const user = { id: '44444444-4444-4444-4444-444444444444', email: 'dave@example.com', name: 'Dave', sid: TEST_SESSION_ID };
      const token = generateAccessToken(user, TEST_JWT_SECRET, TEST_SESSION_ID).accessToken;
      const corruptedConfig = encryptCredentials({ botToken: 'xoxb-123' }, WRONG_ENCRYPTION_KEY);

      const credRepo = {
        getPersonalCredentials: vi.fn(async () => ({
          status: 'active',
          config: corruptedConfig,
          updatedAt: new Date(),
        })),
        updateCredentials: vi.fn(async (_service: string, updater: (cfg: string) => string) => {
          updater(corruptedConfig);
          return true;
        }),
      } as any;

      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        (req as any).user = user;
        (req as any).workspace = { workspaceId: 'ws-1', mode: 'personal', role: 'owner' };
        next();
      });
      app.use('/api/services', createServicesRoutes({ credentialRepo: credRepo, encryptionKey: TEST_ENCRYPTION_KEY }));

      const res = await request(app)
        .put('/api/services/slack/scope')
        .set('Authorization', `Bearer ${token}`)
        .send({ allowedScope: { channels: ['#general'] } });

      expect(res.status).toBe(409);
      expect(res.body.error).toBeTruthy();
    });
  });

  describe('PBI-16A: Conversation status resolves to completed when plan execution is completed', () => {
    it('projects completed status in ConversationRepo SQL when a conversation has a completed plan and no active plans', async () => {
      let capturedSql = '';
      const fakePool = {
        query: vi.fn(async (sql: string) => {
          capturedSql = sql;
          return {
            rowCount: 1,
            rows: [
              {
                id: 'conv-1',
                user_id: '11111111-1111-1111-1111-111111111111',
                title: 'Gửi Slack',
                status: 'completed',
                created_at: new Date(),
                updated_at: new Date(),
              },
            ],
          };
        }),
      } as any;

      const repo = new ConversationRepo(fakePool);
      const rows = await repo.listConversations('11111111-1111-1111-1111-111111111111');
      expect(rows[0]?.status).toBe('completed');
      expect(capturedSql).toContain("p.status = 'completed'");
    });
  });
});
