import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  encryptCredentials,
  SlackAdapter,
  StepError,
  TelegramAdapter,
} from '@wap/tool-adapters';
import {
  type CalendarDigestConfig,
  type ScheduleProposalMetadata,
  type ScheduleResponse,
  type SheetsDigestConfigV2,
  type SlackDigestConfig,
  type TelegramDigestConfig,
} from '@wap/tool-schemas';
import { runtimeToolCatalog, wrapSandboxAdapterWithScope } from '../../src/config/gmail-tools-runtime.js';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { MessageRepo } from '../../src/db/repositories/message-repo.js';
import { CalendarTriggerService } from '../../src/services/calendar/calendar-trigger-service.js';
import { ChatService } from '../../src/services/chat-service.js';
import {
  computeCalendarDigestHash,
  evaluateCalendarDigestCandidate,
} from '../../src/services/schedules/calendar-digest-candidate.js';
import {
  createCalendarDigestExecutor,
  deliverCalendarTriggerNotification,
  listCalendarTriggerDestinations,
  verifyCalendarTriggerDestination,
} from '../../src/services/schedules/calendar-digest-runner.js';
import { computeSheetsDigestHash, analyzeSheetsDigestCandidate } from '../../src/services/schedules/sheets-digest-candidate.js';
import { SHEETS_DELIVERY_UNKNOWN } from '../../src/services/schedules/sheets-digest-runner.js';
import { ScheduleRunner } from '../../src/services/schedules/schedule-runner.js';
import { ScheduleService } from '../../src/services/schedules/schedule-service.js';
import { computeSlackDigestConfigHash } from '../../src/services/schedules/slack-digest-candidate.js';
import { SlackDigestRunner } from '../../src/services/schedules/slack-digest-runner.js';
import { computeTelegramDigestConfigHash } from '../../src/services/schedules/telegram-digest-candidate.js';
import { TelegramDigestRunner } from '../../src/services/schedules/telegram-digest-runner.js';
import {
  computeTrelloDigestConfigHash,
  evaluateTrelloDigestCandidate,
} from '../../src/services/schedules/trello-digest-candidate.js';
import { createTrelloDigestRunner } from '../../src/services/schedules/trello-digest-runner.js';
import { certifyScheduleFixture } from '../../src/services/slack/slack-schedule-origin.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
import {
  DIGEST_TEST_ENC_KEY,
  ORG_A_SPREADSHEET_ID,
  PERSONAL_A_SPREADSHEET_ID,
  seedSheetsDigestTenants,
  type SheetsDigestTenantFixtures,
} from '../helpers/sheets-digest-tenant-fixtures.js';

const TZ = 'Asia/Ho_Chi_Minh';
const KEY = DIGEST_TEST_ENC_KEY;
const NOW = new Date('2026-11-02T01:00:30.000Z'); // 08:00:30 VN

describe('Task 6 Backend Audit Hardening on PostgreSQL 16', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let fixtures: SheetsDigestTenantFixtures;
  let convRepo: ConversationRepo;
  let msgRepo: MessageRepo;
  let credRepo: CredentialRepo;

  beforeAll(async () => {
    db = await createMigratedSchema('sched_audit_hardening');
    convRepo = new ConversationRepo(db.pool);
    msgRepo = new MessageRepo(db.pool);
    credRepo = new CredentialRepo(db.pool, KEY);
  }, 30_000);

  afterAll(async () => {
    await db?.close();
  });

  beforeEach(async () => {
    await db.pool.query(
      'TRUNCATE calendar_trigger_dispatches, calendar_event_triggers, sheets_digest_v2_migration_audit, schedule_runs, schedules, messages, conversations, workspace_members, workspaces, service_credentials CASCADE',
    );
    fixtures = await seedSheetsDigestTenants(db, KEY);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. dispatches one-time (recurrence.type=once) telegram_digest and slack_digest instead of discarding on completed status', async () => {
    const owner = fixtures.personalA.user;
    const schedService = new ScheduleService({ pool: db.pool, timeZone: TZ });

    const tgCred = await credRepo.saveCredentials(
      'telegram',
      encryptCredentials(
        {
          telegramUserId: '777101',
          username: 'once_user',
          selectedChats: [{ chatId: '777101', title: 'Telegram Cá Nhân', type: 'private' }],
        },
        KEY,
      ),
      owner.id,
    );
    const ghCred = await credRepo.saveCredentials(
      'github',
      encryptCredentials(
        {
          accessToken: 'ghp_test',
          githubUserId: '101',
          login: 'once_gh',
          selectedRepos: ['acme/once-repo'],
          allowedScope: { repos: ['acme/once-repo'] },
        },
        KEY,
      ),
      owner.id,
      null,
    );
    const slackCred = await credRepo.saveCredentials(
      'slack',
      encryptCredentials(
        { botToken: 'xoxb-once-slack', allowedScope: { channels: ['C_ONCE'] } },
        KEY,
      ),
      null,
    );

    const onceRecurrence = { type: 'once' as const, date: '2026-11-02', time: '08:00' };
    const tgConfig: TelegramDigestConfig = {
      credentialId: tgCred.id,
      telegramUserId: '777101',
      username: 'once_user',
      chatId: '777101',
      chatTitle: 'Telegram Cá Nhân',
      sources: [{ service: 'github', tool: 'github.search_issues', args: { repo: 'acme/once-repo' }, label: 'GitHub Issues' }],
      recurrence: onceRecurrence,
      timeZone: TZ,
    };
    const slackConfig: SlackDigestConfig = {
      destination: 'slack',
      workspaceMode: 'personal',
      workspaceId: null,
      slackCredentialId: slackCred.id,
      channelId: 'C_ONCE',
      channelName: 'once-channel',
      sources: [{ service: 'github', tool: 'github.search_issues', args: { repo: 'acme/once-repo' }, label: 'GitHub Issues' }],
      recurrence: onceRecurrence,
      timeZone: TZ,
    };

    const tgConv = await convRepo.createConversation(owner.id, 'Once Telegram');
    const slackConv = await convRepo.createConversation(owner.id, 'Once Slack');

    const tgSched = (
      await db.pool.query(
        `INSERT INTO schedules(user_id, conv_id, name, request, recurrence, services, status, next_run_at, kind, digest_config, digest_config_hash, digest_approved_at)
         VALUES($1, $2, 'Once TG', 'Once GitHub -> TG', $3::jsonb, '{github,telegram}', 'active', '2026-11-02T01:00:00Z', 'telegram_digest', $4::jsonb, $5, now())
         RETURNING id`,
        [owner.id, tgConv.id, JSON.stringify(onceRecurrence), JSON.stringify(tgConfig), computeTelegramDigestConfigHash(tgConfig)],
      )
    ).rows[0]!;
    await certifyScheduleFixture(db.pool, tgSched.id);

    const slackSched = (
      await db.pool.query(
        `INSERT INTO schedules(user_id, conv_id, name, request, recurrence, services, status, next_run_at, workspace_mode, kind, digest_config, digest_config_hash, digest_approved_at)
         VALUES($1, $2, 'Once Slack', 'Once GitHub -> Slack', $3::jsonb, '{github,slack}', 'active', '2026-11-02T01:00:00Z', 'personal', 'slack_digest', $4::jsonb, $5, now())
         RETURNING id`,
        [owner.id, slackConv.id, JSON.stringify(onceRecurrence), JSON.stringify(slackConfig), computeSlackDigestConfigHash(slackConfig)],
      )
    ).rows[0]!;
    await certifyScheduleFixture(db.pool, slackSched.id);

    const tgSent: unknown[] = [];
    const slackSent: unknown[] = [];
    const telegramAdapter = new TelegramAdapter({
      credentials: { botToken: '123456:once_bot_token' },
      telegramUserId: '777101',
      allowedScope: { chats: ['777101'] },
      fetchFn: async (url, init) => {
        const method = String(url).split('/').at(-1);
        if (method === 'getChat') return Response.json({ ok: true, result: { id: 777101, type: 'private', first_name: 'Once' } });
        if (method === 'sendMessage') {
          tgSent.push(JSON.parse(String(init?.body)));
          return Response.json({ ok: true, result: { message_id: 501, date: 1793581200, chat: { id: 777101, type: 'private' } } });
        }
        throw new Error(`Unexpected Telegram method: ${method}`);
      },
    });
    const slackAdapter = new SlackAdapter({
      credentials: { botToken: 'xoxb-once-slack' },
      allowedScope: { channels: ['C_ONCE'] },
      fetchFn: async (url, init) => {
        const endpoint = new URL(String(url)).pathname.split('/').at(-1);
        if (endpoint === 'conversations.info') {
          return Response.json({ ok: true, channel: { id: 'C_ONCE', name: 'once-channel', is_channel: true } });
        }
        if (endpoint === 'conversations.list') {
          return Response.json({ ok: true, channels: [{ id: 'C_ONCE', name: 'once-channel', is_channel: true }] });
        }
        if (endpoint === 'chat.postMessage') {
          slackSent.push(JSON.parse(String(init?.body)));
          return Response.json({ ok: true, ts: '1700000100.000100', channel: 'C_ONCE' });
        }
        throw new Error(`Unexpected Slack endpoint: ${endpoint}`);
      },
    });

    const adapterFactory = {
      getAdapterForService: async (serviceName: string) => {
        if (serviceName === 'telegram') return telegramAdapter;
        if (serviceName === 'slack') return slackAdapter;
        if (serviceName === 'github') return { execute: async () => [{ number: 1, title: 'Issue once', html_url: 'https://github.com/acme/once-repo/issues/1' }] };
        return null;
      },
    };

    const tgRunner = new TelegramDigestRunner({
      pool: db.pool,
      credentialRepo: credRepo,
      encryptionKey: KEY,
      timeZone: TZ,
      adapterFactory: adapterFactory as any,
    });
    const slRunner = new SlackDigestRunner({
      pool: db.pool,
      credentialRepo: credRepo,
      encryptionKey: KEY,
      timeZone: TZ,
      adapterFactory: adapterFactory as any,
    });
    const runner = new ScheduleRunner({
      pool: db.pool,
      timeZone: TZ,
      now: () => NOW,
      planRun: async () => {
        throw new Error('Should not use manual planRun for once digest');
      },
      executeDigestRun: (run, signal) => tgRunner.execute(run, signal),
      executeSlackDigestRun: (run, signal) => slRunner.execute(run, signal),
      recordState: (client, row, now) => schedService.recordState(client, row, now),
    });

    await runner.tick();

    expect(tgSent).toHaveLength(1);
    expect(slackSent).toHaveLength(1);
    const tgRun = (await db.pool.query('SELECT status FROM schedule_runs WHERE schedule_id = $1', [tgSched.id])).rows[0];
    const slRun = (await db.pool.query('SELECT status FROM schedule_runs WHERE schedule_id = $1', [slackSched.id])).rows[0];
    expect(tgRun?.status).toBe('digest_sent');
    expect(slRun?.status).toBe('digest_sent');
    expect(ghCred.id).toBeTruthy();

    const tgSchedAfter = (await db.pool.query('SELECT status FROM schedules WHERE id = $1', [tgSched.id])).rows[0];
    const slSchedAfter = (await db.pool.query('SELECT status FROM schedules WHERE id = $1', [slackSched.id])).rows[0];
    expect(tgSchedAfter?.status).toBe('completed');
    expect(slSchedAfter?.status).toBe('completed');
  });

  it('2. ChatService routes Trello+Telegram schedule proposals to trello_digest and runs verifyMySheetsDigestPreview on update', async () => {
    const owner = fixtures.personalA.user;
    const schedService = new ScheduleService({ pool: db.pool, timeZone: TZ });

    // Part A: Trello + Telegram create proposal routes to evaluateTrelloDigestCandidate -> trelloMemberId & destination:'telegram'
    const trelloProposal: ScheduleResponse = {
      kind: 'schedule',
      action: 'create',
      name: 'Bản tin Trello Telegram',
      request: 'Mỗi sáng báo cáo thẻ quá hạn bảng Frontend gửi vào Telegram của tôi',
      recurrence: { type: 'daily', time: '08:30' },
      summary: 'Mỗi ngày 08:30 gửi bản tin Trello vào Telegram.',
    };
    const emitted: Array<{ event: string; payload: any }> = [];
    const trelloCredId = randomUUID();
    const tgCredId = randomUUID();

    const chatServiceA = new ChatService({
      msgRepo,
      convRepo,
      planner: {
        processMessage: async () => structuredClone(trelloProposal),
        routeSchedule: async () => ({ services: ['trello', 'telegram'], unavailable: [] }),
      } as any,
      eventEmitter: { emit: (event, payload) => emitted.push({ event, payload }) },
      trelloConnection: async () => ({
        status: 'connected',
        connection: { credentialId: trelloCredId, memberId: 'mem-t6', username: 'alice_t', boardIds: ['b-fe'] },
        memberBoards: [{ boardId: 'b-fe', boardName: 'Frontend' }],
      }),
      telegramConnection: async () => ({
        status: 'connected',
        selectedChats: [{ chatId: '999001', title: 'Telegram cá nhân', type: 'private' }],
        connection: { credentialId: tgCredId, telegramUserId: '999001', username: 'alice_tg', chatIds: ['999001'] },
      }),
      schedules: { repo: schedService.repo, pool: db.pool, timeZone: TZ, now: () => NOW },
    });

    const convA = await convRepo.createConversation(owner.id, 'Trello TG Routing');
    await chatServiceA.handleUserMessage({
      conversationId: convA.id,
      userId: owner.id,
      content: trelloProposal.request!,
    });
    for (let i = 0; i < 80 && !emitted.some((e) => e.event === 'schedule_proposal' || e.event === 'error'); i++) {
      await new Promise((r) => setTimeout(r, 15));
    }
    const propA = emitted.find((e) => e.event === 'schedule_proposal');
    expect(propA).toBeDefined();
    expect(propA!.payload.metadata.digestCandidate).toMatchObject({
      canAutoDigest: true,
      config: {
        credentialId: trelloCredId,
        trelloMemberId: 'mem-t6',
        boards: [{ id: 'b-fe', name: 'Frontend' }],
        destination: 'telegram',
        telegramChatId: '999001',
        telegramCredentialId: tgCredId,
      },
    });

    // Part B: update proposal referencing mysheets tab triggers verifyMySheetsDigestPreview (fails closed on 404 from mysheets adapter)
    const tgConvB = await convRepo.createConversation(owner.id, 'Update Preview Check');
    const existingRec = { type: 'daily' as const, time: '08:00' };
    const existingCfg: TelegramDigestConfig = {
      credentialId: fixtures.personalA.telegramCred.id,
      telegramUserId: '100555001',
      username: 'alice',
      chatId: fixtures.personalA.telegramChatId,
      chatTitle: 'Nhóm KPI Cá nhân A',
      sources: [
        {
          service: 'mysheets',
          tool: 'mysheets.read_range',
          args: { spreadsheetId: PERSONAL_A_SPREADSHEET_ID, range: "'KPI Tháng 11'!A1:D10" },
          label: 'Google Sheets (Báo cáo KPI Cá nhân A)',
          mysheetsBinding: {
            credentialId: fixtures.personalA.mysheetsCred.id,
            email: fixtures.personalA.email,
            spreadsheetIds: [PERSONAL_A_SPREADSHEET_ID],
            truncated: false,
          },
        },
      ],
      recurrence: existingRec,
      timeZone: TZ,
    };
    const existingSched = (
      await db.pool.query(
        `INSERT INTO schedules(user_id, conv_id, name, request, recurrence, services, status, next_run_at, kind, digest_config, digest_config_hash, digest_approved_at)
         VALUES($1, $2, 'Old TG Digest', 'Old request', $3::jsonb, '{github,mysheets,telegram}', 'active', '2026-11-03T01:00:00Z', 'telegram_digest', $4::jsonb, $5, now())
         RETURNING id, version`,
        [owner.id, tgConvB.id, JSON.stringify(existingRec), JSON.stringify(existingCfg), computeTelegramDigestConfigHash(existingCfg)],
      )
    ).rows[0]!;

    const ghCredB = await credRepo.saveCredentials(
      'github',
      encryptCredentials({ accessToken: 'ghp_b', githubUserId: '2', login: 'bob', selectedRepos: ['acme/app'], allowedScope: { repos: ['acme/app'] } }, KEY),
      owner.id,
      null,
    );
    expect(existingSched.id && ghCredB.id).toBeTruthy();

    const updateProposal: ScheduleResponse = {
      kind: 'schedule',
      action: 'update',
      name: 'Bản tin đa nguồn cập nhật',
      request: "Tổng hợp GitHub issue và đọc vùng 'KPI Tháng 11'!A1:D10 bảng Báo cáo KPI Cá nhân A gửi vào Telegram",
      recurrence: { type: 'daily', time: '09:00' },
      summary: 'Cập nhật lịch đọc KPI Tháng 11.',
    };
    emitted.length = 0;
    const chatServiceB = new ChatService({
      msgRepo,
      convRepo,
      planner: {
        processMessage: async () => structuredClone(updateProposal),
        routeSchedule: async () => ({ services: ['github', 'mysheets', 'telegram'], unavailable: [] }),
      } as any,
      eventEmitter: { emit: (event, payload) => emitted.push({ event, payload }) },
      telegramConnection: async () => ({
        status: 'connected',
        selectedChats: [{ chatId: fixtures.personalA.telegramChatId, title: 'Nhóm KPI Cá nhân A', type: 'private' }],
        connection: {
          credentialId: fixtures.personalA.telegramCred.id,
          telegramUserId: '100555001',
          username: 'alice',
          chatIds: [fixtures.personalA.telegramChatId],
        },
      }),
      githubConnection: async () => ({
        status: 'connected',
        connection: { credentialId: ghCredB.id, githubUserId: '2', login: 'bob', repos: ['acme/app'] },
        teamRepos: [],
        memberRepos: [],
      }),
      getAdapter: async (serviceName: string) => {
        if (serviceName === 'mysheets') {
          return {
            execute: async () => {
              throw new StepError({ category: 'NOT_FOUND', statusCode: 404, message: 'Tab not found' });
            },
          };
        }
        return null;
      },
      schedules: {
        repo: schedService.repo,
        pool: db.pool,
        credentialRepo: credRepo,
        encryptionKey: KEY,
        mysheetsEnabled: true,
        timeZone: TZ,
        now: () => NOW,
      },
    });

    await chatServiceB.handleUserMessage({
      conversationId: tgConvB.id,
      userId: owner.id,
      content: updateProposal.request!,
    });
    for (let i = 0; i < 80 && !emitted.some((e) => e.event === 'schedule_proposal' || e.event === 'error'); i++) {
      await new Promise((r) => setTimeout(r, 15));
    }
    const propB = emitted.find((e) => e.event === 'schedule_proposal');
    expect(propB).toBeDefined();
    expect(propB!.payload.metadata.digestCandidate).toMatchObject({
      canAutoDigest: false,
      disabledReason: expect.stringMatching(/Google Sheets không đọc được vùng đã yêu cầu/i),
    });
  });

  it('3. analyzeSheetsDigestCandidate checks Org spreadsheets and detects TC-15 collision even when planner passes services=["mysheets","slack"]', async () => {
    const { personalA, orgA } = fixtures;

    const orgResolvedFromMysheetsRoute = await analyzeSheetsDigestCandidate({
      userId: personalA.user.id,
      workspaceMode: 'organization',
      workspaceId: orgA.workspaceId,
      request: 'Đọc bảng Báo cáo Doanh thu Tổ chức Alpha và gửi vào Slack #general',
      recurrence: { type: 'daily', time: '08:00' },
      services: ['mysheets', 'slack'],
      credentialRepo: credRepo,
      encryptionKey: KEY,
      mysheetsEnabled: true,
      emitV2: true,
      fetchOrgSheetsMetadata: async () => [
        { id: ORG_A_SPREADSHEET_ID, title: 'Báo cáo Doanh thu Tổ chức Alpha', sheets: ['Sheet1'] },
      ],
    });
    expect(orgResolvedFromMysheetsRoute.canAutoDigest).toBe(true);
    expect(orgResolvedFromMysheetsRoute.config?.source.service).toBe('sheets');
    expect(orgResolvedFromMysheetsRoute.config?.source.credentialId).toBe(orgA.sheetsCred.id);

    const collisionDetected = await analyzeSheetsDigestCandidate({
      userId: personalA.user.id,
      workspaceMode: 'organization',
      workspaceId: orgA.workspaceId,
      request: 'Đọc bảng Báo cáo KPI Cá nhân A và gửi vào Slack #general',
      recurrence: { type: 'daily', time: '08:00' },
      services: ['mysheets', 'slack'],
      credentialRepo: credRepo,
      encryptionKey: KEY,
      mysheetsEnabled: true,
      emitV2: true,
      fetchOrgSheetsMetadata: async () => [
        { id: ORG_A_SPREADSHEET_ID, title: 'Báo cáo KPI Cá nhân A', sheets: ['KPI Tháng 11'] },
      ],
    });
    expect(collisionDetected.canAutoDigest).toBe(false);
    expect(collisionDetected.requiresClarification).toBe(true);
    expect(collisionDetected.reason).toMatch(/trùng khớp giữa Google Sheets Tổ chức và Google Sheets Cá nhân/i);
  });

  it('4. persists trello_digest dispatch snapshot, supports canRetryDelivery + mark_sent after kind edit, and only auto-pauses on 3 scheduled failures', async () => {
    const owner = fixtures.personalA.user;
    const schedService = new ScheduleService({
      pool: db.pool,
      timeZone: TZ,
      credentialRepo: credRepo,
      encryptionKey: KEY,
      mysheetsEnabled: true,
      emitV2: true,
    });
    const trelloCred = await credRepo.saveCredentials(
      'trello',
      encryptCredentials({ accessToken: 'trello-tok', memberId: 'mem-1', username: 'alice_tr', allowedScope: { boards: ['b1'] } }, KEY),
      owner.id,
    );
    const slackCred = await credRepo.saveCredentials(
      'slack',
      encryptCredentials({ botToken: 'xoxb-tr', allowedScope: { channels: ['C_DEV'] } }, KEY),
      null,
    );
    expect(slackCred.id).toBeTruthy();

    const dailyRec = { type: 'daily' as const, time: '08:30' };
    const trConfig = {
      credentialId: trelloCred.id,
      trelloMemberId: 'mem-1',
      username: 'alice_tr',
      boards: [{ id: 'b1', name: 'Frontend' }],
      channelId: 'C_DEV',
      channelName: 'dev',
      dueSoonHours: 24,
      destination: 'slack' as const,
    };
    const trHash = computeTrelloDigestConfigHash({ config: trConfig, recurrence: dailyRec, userId: owner.id });
    const conv = await convRepo.createConversation(owner.id, 'Trello Snapshot');
    const sched = (
      await db.pool.query(
        `INSERT INTO schedules(user_id, conv_id, name, request, recurrence, services, status, next_run_at, kind, digest_config, digest_config_hash, digest_approved_at)
         VALUES($1, $2, 'Trello Recovery', 'Trello Slack', $3::jsonb, '{trello,slack}', 'active', '2026-11-02T01:30:00Z', 'trello_digest', $4::jsonb, $5, now())
         RETURNING id, version`,
        [owner.id, conv.id, JSON.stringify(dailyRec), JSON.stringify(trConfig), trHash],
      )
    ).rows[0]!;
    await certifyScheduleFixture(db.pool, sched.id);

    const runnerUnknown = new ScheduleRunner({
      pool: db.pool,
      timeZone: TZ,
      now: () => new Date('2026-11-02T01:31:00Z'),
      planRun: async () => {
        throw new Error('Unexpected manual plan');
      },
      runTrelloDigest: createTrelloDigestRunner({
        pool: db.pool,
        trelloConnection: async () => ({
          status: 'connected',
          connection: { credentialId: trelloCred.id, memberId: 'mem-1', username: 'alice_tr', boardIds: ['b1'] },
        }),
        getAdapter: async (svc: string) => {
          if (svc === 'trello') return { execute: async () => [] };
          if (svc === 'slack') {
            return {
              execute: async (tool: string) => {
                if (tool === 'slack.search_channels') return [{ id: 'C_DEV', name: 'dev' }];
                throw new Error('Socket hang up after Slack send');
              },
            };
          }
          return null;
        },
      }),
      recordState: (client, row, now) => schedService.recordState(client, row, now),
    });

    await runnerUnknown.tick();

    const rawRun = (await db.pool.query('SELECT * FROM schedule_runs WHERE schedule_id = $1', [sched.id])).rows[0]!;
    expect(rawRun.status).toBe('needs_attention');
    expect(rawRun.dispatched_config).toMatchObject({ trelloMemberId: 'mem-1', channelId: 'C_DEV' });
    expect(rawRun.dispatched_config_hash).toBe(trHash);

    const [beforeEditView] = await schedService.listRuns(owner.id, sched.id, 10, NOW);
    expect(beforeEditView?.canRetryDelivery).toBe(true);

    // Edit schedule kind to manual ('plan')
    const updateMsg = await msgRepo.createMessage(conv.id, 'assistant', 'Đổi sang duyệt tay', {
      type: 'schedule_proposal',
      proposal: {
        kind: 'schedule',
        action: 'update',
        name: 'Trello Manual',
        request: 'Tạo thẻ Trello mới gửi vào Slack #dev',
        recurrence: dailyRec,
        summary: 'Đổi sang duyệt tay.',
      },
      scheduleId: sched.id,
      baseVersion: sched.version,
      services: ['trello', 'slack'],
      nextRuns: [],
      previous: null,
    } satisfies ScheduleProposalMetadata as unknown as Record<string, unknown>);
    await schedService.confirmProposal({
      userId: owner.id,
      convId: conv.id,
      messageId: updateMsg.id,
      approvalMode: 'manual',
      now: NOW,
    });

    const [afterEditView] = await schedService.listRuns(owner.id, sched.id, 10, NOW);
    expect(afterEditView?.canRetryDelivery).toBe(false);

    await expect(
      schedService.resolveRunDelivery({
        userId: owner.id,
        runId: rawRun.id,
        resolution: 'retry_new_run',
        confirmDuplicateRisk: true,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'CONFIG_CHANGED_SINCE_RUN' });

    const marked = await schedService.resolveRunDelivery({
      userId: owner.id,
      runId: rawRun.id,
      resolution: 'mark_sent',
      now: NOW,
    });
    expect(marked.run.state).toBe('digest_sent');
    expect(marked.run.deliveryResolution).toBe('confirmed_sent');

    // Sheets v2 snapshot mark_sent after kind edit to 'plan'
    const sheetsCfg: SheetsDigestConfigV2 = {
      version: 2,
      workspaceMode: 'personal',
      workspaceId: null,
      source: {
        service: 'mysheets',
        credentialId: fixtures.personalA.mysheetsCred.id,
        email: fixtures.personalA.email,
        spreadsheetId: PERSONAL_A_SPREADSHEET_ID,
        spreadsheetTitle: fixtures.personalA.spreadsheetTitle,
        tailRows: 20,
      },
      destination: {
        service: 'gmail',
        credentialId: fixtures.personalA.gmailCred.id,
        senderEmail: fixtures.personalA.email,
        recipientEmail: fixtures.personalA.email,
      },
      includeAiSummary: false,
    };
    const sheetsHash = computeSheetsDigestHash({ userId: owner.id, recurrence: dailyRec, config: sheetsCfg });
    const sheetsConv = await convRepo.createConversation(owner.id, 'Sheets Edited Kind');
    const sheetsSched = (
      await db.pool.query(
        `INSERT INTO schedules(user_id, conv_id, name, request, recurrence, services, status, next_run_at, workspace_mode, kind, digest_config, digest_config_hash, digest_approved_at)
         VALUES($1, $2, 'Sheets Manual Now', 'Manual plan now', $3::jsonb, '{mysheets,gmail}', 'active', '2026-11-03T01:00:00Z', 'personal', 'plan', NULL, NULL, NULL)
         RETURNING id`,
        [owner.id, sheetsConv.id, JSON.stringify(dailyRec)],
      )
    ).rows[0]!;
    await certifyScheduleFixture(db.pool, sheetsSched.id);
    const sheetsRun = (
      await db.pool.query(
        `INSERT INTO schedule_runs(schedule_id, schedule_version, trigger, due_at, status, conv_id, error, delivery_started_at, dispatched_config, dispatched_config_hash)
         VALUES($1, 1, 'scheduled', $2, 'needs_attention', $3, $4, $2, $5::jsonb, $6)
         RETURNING id`,
        [sheetsSched.id, NOW, sheetsConv.id, SHEETS_DELIVERY_UNKNOWN, JSON.stringify(sheetsCfg), sheetsHash],
      )
    ).rows[0]!;

    const sheetsMarked = await schedService.resolveRunDelivery({
      userId: owner.id,
      runId: sheetsRun.id,
      resolution: 'mark_sent',
      now: NOW,
      scope: { workspaceMode: 'personal', workspaceId: null },
    });
    expect(sheetsMarked.run.state).toBe('digest_sent');
    expect(sheetsMarked.run.deliveryResolution).toBe('confirmed_sent');

    // Manual runs failing 3x must NOT auto-pause scheduled calendar digest
    const calCred = await credRepo.saveCredentials(
      'mycalendar',
      encryptCredentials(
        {
          refreshToken: '1//cal-refresh',
          email: 'owner.cal@example.test',
          selectedCalendars: [{ id: 'owner.cal@example.test', summary: 'Chính', primary: true }],
          allowedScope: { calendars: ['owner.cal@example.test'] },
        },
        KEY,
      ),
      owner.id,
    );
    const calCfg: CalendarDigestConfig = {
      version: 1,
      source: 'mycalendar',
      credentialId: calCred.id,
      email: 'owner.cal@example.test',
      calendars: [{ id: 'owner.cal@example.test', summary: 'Chính', primary: true }],
      destination: { service: 'slack', channelId: 'C_DEV', channelName: 'dev' },
      windowHours: 24,
      includeSummary: false,
    };
    const calConv = await convRepo.createConversation(owner.id, 'Manual Failure Isolation');
    const calSched = (
      await db.pool.query(
        `INSERT INTO schedules(user_id, conv_id, name, request, recurrence, services, status, next_run_at, kind, digest_config, digest_config_hash, digest_approved_at)
         VALUES($1, $2, 'Cal Manual Failures', 'Cal Slack', $3::jsonb, '{mycalendar,slack}', 'active', '2026-11-10T01:00:00Z', 'calendar_digest', $4::jsonb, $5, now())
         RETURNING id`,
        [owner.id, calConv.id, JSON.stringify(dailyRec), JSON.stringify(calCfg), computeCalendarDigestHash(calCfg)],
      )
    ).rows[0]!;
    await certifyScheduleFixture(db.pool, calSched.id);

    for (let i = 0; i < 3; i++) {
      await db.pool.query(
        `INSERT INTO schedule_runs(schedule_id, schedule_version, trigger, due_at, status, error, created_at)
         VALUES($1, 1, 'manual', $2, 'digest_failed', 'Transient error', $2)`,
        [calSched.id, new Date(NOW.getTime() + i * 60_000)],
      );
    }

    const triggerFailOnce = new ScheduleRunner({
      pool: db.pool,
      timeZone: TZ,
      now: () => NOW,
      planRun: async () => {
        throw new Error('Unexpected');
      },
      runDigest: async () => ({ state: 'digest_failed' as const, error: 'Manual run failed once' }),
      recordState: (client, row, now) => schedService.recordState(client, row, now),
    });
    const manualRunId = (
      await db.pool.query(
        `INSERT INTO schedule_runs(schedule_id, schedule_version, trigger, due_at, status, conv_id)
         VALUES($1, 1, 'manual', $2, 'planning', $3)
         RETURNING id`,
        [calSched.id, NOW, calConv.id],
      )
    ).rows[0]!.id as string;
    await triggerFailOnce.planNow(manualRunId);

    const calAfterManual = (await db.pool.query('SELECT status FROM schedules WHERE id = $1', [calSched.id])).rows[0];
    expect(calAfterManual?.status).toBe('active');

    // Companion check: 3 scheduled digest_failed runs DO pause the schedule
    for (let i = 0; i < 2; i++) {
      await db.pool.query(
        `INSERT INTO schedule_runs(schedule_id, schedule_version, trigger, due_at, status, error, created_at)
         VALUES($1, 1, 'scheduled', $2, 'digest_failed', 'Scheduled failure', $2)`,
        [calSched.id, new Date(NOW.getTime() + (10 + i) * 60_000)],
      );
    }
    const schedFail3rdId = (
      await db.pool.query(
        `INSERT INTO schedule_runs(schedule_id, schedule_version, trigger, due_at, status, conv_id)
         VALUES($1, 1, 'scheduled', $2, 'planning', $3)
         RETURNING id`,
        [calSched.id, new Date(NOW.getTime() + 12 * 60_000), calConv.id],
      )
    ).rows[0]!.id as string;
    await triggerFailOnce.planNow(schedFail3rdId);

    const calAfter3Scheduled = (await db.pool.query('SELECT status FROM schedules WHERE id = $1', [calSched.id])).rows[0];
    expect(calAfter3Scheduled?.status).toBe('paused');
  });

  it('5. enforces mycalendarOAuthClientId origin across candidate, confirm, executor, triggers, and multi-source reader', async () => {
    const owner = fixtures.personalA.user;
    await db.pool.query("DELETE FROM service_credentials WHERE service = 'slack'");
    const oldOriginCred = await credRepo.saveCredentials(
      'mycalendar',
      encryptCredentials(
        {
          oauthClientId: 'cal-client-old',
          refreshToken: '1//old-cal',
          email: 'cal.origin@example.test',
          selectedCalendars: [{ id: 'cal.origin@example.test', summary: 'Origin Cal', primary: true }],
          allowedScope: { calendars: ['cal.origin@example.test'] },
        },
        KEY,
      ),
      owner.id,
    );
    await credRepo.saveCredentials(
      'slack',
      encryptCredentials({ botToken: 'xoxb-cal', allowedScope: { channels: ['C0123456789'] } }, KEY),
      null,
    );

    const mismatchedCandidate = await evaluateCalendarDigestCandidate({
      pool: db.pool,
      encryptionKey: KEY,
      mycalendarOAuthClientId: 'cal-client-current',
      userId: owner.id,
      services: ['mycalendar', 'slack'],
      request: 'Gửi lịch họp sáng nay lên Slack #cal',
    });
    expect(mismatchedCandidate.candidate.canAutoDigest).toBe(false);
    expect(mismatchedCandidate.candidate.disabledReason).toMatch(/OAuth/i);

    // Candidate with matching current origin succeeds, then swapping origin before confirmProposal rejects
    await db.pool.query(
      'UPDATE service_credentials SET config = $2 WHERE id = $1',
      [
        oldOriginCred.id,
        encryptCredentials(
          {
            oauthClientId: 'cal-client-current',
            refreshToken: '1//cur-cal',
            email: 'cal.origin@example.test',
            selectedCalendars: [{ id: 'cal.origin@example.test', summary: 'Origin Cal', primary: true }],
            allowedScope: { calendars: ['cal.origin@example.test'] },
          },
          KEY,
        ),
      ],
    );
    const matchedCandidate = await evaluateCalendarDigestCandidate({
      pool: db.pool,
      encryptionKey: KEY,
      mycalendarOAuthClientId: 'cal-client-current',
      userId: owner.id,
      services: ['mycalendar', 'slack'],
      request: 'Gửi lịch họp sáng nay lên Slack #cal',
    });
    expect(matchedCandidate.candidate.canAutoDigest).toBe(true);

    const conv = await convRepo.createConversation(owner.id, 'MyCal Origin');
    const msg = await msgRepo.createMessage(conv.id, 'assistant', 'Đề xuất lịch', {
      type: 'schedule_proposal',
      proposal: {
        kind: 'schedule',
        action: 'create',
        name: 'Cal Origin Guard',
        request: 'Gửi lịch họp sáng nay lên Slack #cal',
        recurrence: { type: 'daily', time: '07:30' },
        summary: 'Mỗi sáng gửi lịch.',
      },
      scheduleId: null,
      baseVersion: null,
      services: ['mycalendar', 'slack'],
      nextRuns: [],
      previous: null,
      digestCandidate: matchedCandidate.candidate,
    } satisfies ScheduleProposalMetadata as unknown as Record<string, unknown>);

    // Swap back to mismatched origin before confirmProposal
    await db.pool.query(
      'UPDATE service_credentials SET config = $2 WHERE id = $1',
      [
        oldOriginCred.id,
        encryptCredentials(
          {
            oauthClientId: 'cal-client-old',
            refreshToken: '1//old-cal',
            email: 'cal.origin@example.test',
            selectedCalendars: [{ id: 'cal.origin@example.test', summary: 'Origin Cal', primary: true }],
            allowedScope: { calendars: ['cal.origin@example.test'] },
          },
          KEY,
        ),
      ],
    );

    const schedService = new ScheduleService({
      pool: db.pool,
      timeZone: TZ,
      encryptionKey: KEY,
      mycalendarOAuthClientId: 'cal-client-current',
    });
    await expect(
      schedService.confirmProposal({
        userId: owner.id,
        convId: conv.id,
        messageId: msg.id,
        approvalMode: 'auto_digest',
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'AUTO_DIGEST_NOT_ELIGIBLE' });

    // Executor fails closed when credential origin mismatches
    let calReads = 0;
    const calExecutor = createCalendarDigestExecutor({
      pool: db.pool,
      encryptionKey: KEY,
      mycalendarOAuthClientId: 'cal-client-current',
      timeZone: TZ,
      getAdapter: async () => ({
        execute: async () => {
          calReads++;
          return { events: [] };
        },
      }),
    });
    const cfg: CalendarDigestConfig = {
      version: 1,
      source: 'mycalendar',
      credentialId: oldOriginCred.id,
      email: 'cal.origin@example.test',
      calendars: [{ id: 'cal.origin@example.test', summary: 'Origin Cal', primary: true }],
      destination: { service: 'slack', channelId: 'C0123456789', channelName: 'cal' },
      windowHours: 24,
      includeSummary: false,
    };
    const calSched = (
      await db.pool.query(
        `INSERT INTO schedules(user_id, conv_id, name, request, recurrence, services, status, next_run_at, kind, digest_config, digest_config_hash, digest_approved_at)
         VALUES($1, $2, 'Exec Origin', 'Exec Cal', '{"type":"daily","time":"07:30"}'::jsonb, '{mycalendar,slack}', 'active', '2026-11-03T00:30:00Z', 'calendar_digest', $3::jsonb, $4, now())
         RETURNING id`,
        [owner.id, conv.id, JSON.stringify(cfg), computeCalendarDigestHash(cfg)],
      )
    ).rows[0]!;
    const execOutcome = await calExecutor(
      {
        runId: randomUUID(),
        scheduleId: calSched.id,
        scheduleVersion: 1,
        userId: owner.id,
        name: 'Exec Origin',
        request: 'Exec Cal',
        dueAt: NOW,
        trigger: 'scheduled',
        digestConfig: cfg,
        digestConfigHash: computeCalendarDigestHash(cfg),
        workspaceId: null,
        workspaceMode: 'legacy',
      },
      new AbortController().signal,
    );
    expect(execOutcome).toMatchObject({ state: 'blocked' });
    expect(calReads).toBe(0);

    // CalendarTriggerService rejects mismatched origin on previewTrigger
    const calTriggerSvc = new CalendarTriggerService({
      pool: db.pool,
      encryptionKey: KEY,
      mycalendarOAuthClientId: 'cal-client-current',
      clock: () => NOW,
      verifyDestination: verifyCalendarTriggerDestination,
      listDestinations: listCalendarTriggerDestinations,
      deliverNotification: deliverCalendarTriggerNotification,
      getAdapter: async () => ({ execute: async () => ({ events: [] }) }),
    });
    await expect(
      calTriggerSvc.previewTrigger(owner.id, {
        name: 'Origin trigger',
        triggerType: 'pre_meeting_reminder',
        calendarIds: ['cal.origin@example.test'],
        destination: { service: 'slack', channelId: 'C0123456789' },
      }),
    ).rejects.toThrow();

    // Multi-source TelegramDigestRunner skips mismatched mycalendar origin (0 calendar adapter calls)
    const msTgCred = await credRepo.saveCredentials(
      'telegram',
      encryptCredentials(
        {
          telegramUserId: '888202',
          username: 'ms_cal_user',
          selectedChats: [{ chatId: '888202', title: 'MS Cal TG', type: 'private' }],
        },
        KEY,
      ),
      owner.id,
    );
    const dailyRec = { type: 'daily' as const, time: '08:00' };
    const msConfig: TelegramDigestConfig = {
      credentialId: msTgCred.id,
      telegramUserId: '888202',
      username: 'ms_cal_user',
      chatId: '888202',
      chatTitle: 'MS Cal TG',
      sources: [
        {
          service: 'mycalendar',
          tool: 'mycalendar.list_events',
          label: 'Calendar',
          mycalendarBinding: {
            credentialId: oldOriginCred.id,
            email: 'cal.origin@example.test',
            calendarIds: ['cal.origin@example.test'],
            truncated: false,
          },
        } as any,
      ],
      recurrence: dailyRec,
      timeZone: TZ,
    };
    const msConv = await convRepo.createConversation(owner.id, 'MS Cal Origin Conv');
    const msSched = (
      await db.pool.query(
        `INSERT INTO schedules(user_id, conv_id, name, request, recurrence, services, status, next_run_at, kind, digest_config, digest_config_hash, digest_approved_at)
         VALUES($1, $2, 'MS Cal Origin', 'MS Cal Origin', $3::jsonb, '{mycalendar,telegram}', 'active', '2026-11-02T01:00:00Z', 'telegram_digest', $4::jsonb, $5, now())
         RETURNING id`,
        [owner.id, msConv.id, JSON.stringify(dailyRec), JSON.stringify(msConfig), computeTelegramDigestConfigHash(msConfig)],
      )
    ).rows[0]!;
    await certifyScheduleFixture(db.pool, msSched.id);

    let msCalReads = 0;
    const msRunner = new TelegramDigestRunner({
      pool: db.pool,
      credentialRepo: credRepo,
      encryptionKey: KEY,
      mycalendarOAuthClientId: 'cal-client-current',
      timeZone: TZ,
      adapterFactory: {
        getAdapterForService: async (svc: string) => {
          if (svc === 'mycalendar') {
            return {
              execute: async () => {
                msCalReads++;
                return { events: [] };
              },
            };
          }
          if (svc === 'telegram') {
            return { execute: async () => ({ messageId: 1 }) };
          }
          return null;
        },
      } as any,
    });
    const msOutcome = await msRunner.execute(
      {
        runId: randomUUID(),
        scheduleId: msSched.id,
        scheduleVersion: 1,
        userId: owner.id,
        name: 'MS Cal Origin',
        request: 'MS Cal Origin',
        dueAt: NOW,
        trigger: 'scheduled',
        digestConfig: msConfig,
        digestConfigHash: computeTelegramDigestConfigHash(msConfig),
        workspaceId: null,
        workspaceMode: 'legacy',
      },
      new AbortController().signal,
    );
    expect(msCalReads).toBe(0);
    expect(msOutcome.status).not.toBe('digest_sent');
  });

  it('6. runtimeToolCatalog includes myjira tools when myjiraConnection returns { projects } and wrapSandboxAdapterWithScope blocks out-of-scope calls', async () => {
    const catalog = await runtimeToolCatalog('live', credRepo, KEY, {
      userId: fixtures.orgA.member.id,
      workspaceMode: 'organization',
      workspaceId: fixtures.orgA.workspaceId,
      gmailEnabled: false,
      myjiraEnabled: true,
      myjiraConnection: async () => ({
        status: 'connected',
        projects: [{ id: '10001', key: 'OPS', name: 'Operations' }],
      }),
    });
    expect(catalog.some((t) => t.name.startsWith('myjira.'))).toBe(true);

    const innerExec = vi.fn(async (_tool: string, _args: unknown, _ctx?: unknown) => ({ ok: true }));
    const inner = { execute: innerExec };

    const trelloWrapped = wrapSandboxAdapterWithScope('trello', inner, {
      userId: 'u1',
      phase: 'execution',
      connections: { trello: { credentialId: 'c1', memberId: 'm1', username: 'u', boardIds: ['b_allowed'] } },
    });
    await expect(trelloWrapped.execute('trello.create_card', { boardId: 'b_forbidden' })).rejects.toMatchObject({
      category: 'AUTH_ERROR',
      details: expect.objectContaining({ requestSent: false }),
    });
    expect(innerExec).not.toHaveBeenCalled();
    await expect(trelloWrapped.execute('trello.search_cards', { boardId: 'b_allowed' })).resolves.toEqual({ ok: true });

    const githubWrapped = wrapSandboxAdapterWithScope('github', inner, {
      userId: 'u1',
      phase: 'execution',
      connections: { github: { credentialId: 'c2', githubUserId: '1', login: 'u', repos: ['Org/Allowed'] } },
    });
    await expect(githubWrapped.execute('github.create_issue', { repo: 'evil/repo' })).rejects.toMatchObject({
      category: 'AUTH_ERROR',
      details: expect.objectContaining({ requestSent: false }),
    });
    await expect(githubWrapped.execute('github.search_issues', { repo: 'org/allowed' })).resolves.toEqual({ ok: true });

    const tgWrapped = wrapSandboxAdapterWithScope('telegram', inner, {
      userId: 'u1',
      phase: 'execution',
      connections: { telegram: { credentialId: 'c3', telegramUserId: '1', username: 'u', chatIds: ['-100999'] } },
    });
    await expect(tgWrapped.execute('telegram.send_message', { chatId: '-100666' })).rejects.toMatchObject({
      category: 'AUTH_ERROR',
      details: expect.objectContaining({ requestSent: false }),
    });
    await expect(tgWrapped.execute('telegram.send_message', { chatId: '-100999' })).resolves.toEqual({ ok: true });
  });
});
