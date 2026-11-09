import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReadDigestWindowResult } from '@wap/tool-adapters';
import { isSheetsDigestConfigV2, type SheetsDigestConfig } from '@wap/tool-schemas';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
import {
  DIGEST_TEST_ENC_KEY,
  LEGACY_SPREADSHEET_ID,
  ORG_A_SPREADSHEET_ID,
  PERSONAL_A_SPREADSHEET_ID,
  seedSheetsDigestTenants,
  type SheetsDigestTenantFixtures,
} from '../helpers/sheets-digest-tenant-fixtures.js';
import { MessageRepo } from '../../src/db/repositories/message-repo.js';
import { ScheduleRepo } from '../../src/db/repositories/schedule-repo.js';
import { ChatService } from '../../src/services/chat-service.js';
import { ScheduleRunner } from '../../src/services/schedules/schedule-runner.js';
import { ScheduleService } from '../../src/services/schedules/schedule-service.js';
import {
  SheetsDigestRunner,
  type SheetsDigestScheduleContext,
} from '../../src/services/schedules/sheets-digest-runner.js';

const TZ = 'Asia/Ho_Chi_Minh';

describe('Task 4 (PR-4): End-to-End Trusted Context Pipeline (TC-19) & Legacy Scope Preservation (TC-22)', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let fixtures: SheetsDigestTenantFixtures;
  let messageRepo: MessageRepo;
  let scheduleRepo: ScheduleRepo;

  beforeAll(async () => {
    db = await createMigratedSchema('sheets_digest_pr4_e2e');
    messageRepo = new MessageRepo(db.pool);
    scheduleRepo = new ScheduleRepo(db.pool, TZ);
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.pool.query(
      'TRUNCATE sheets_digest_v2_migration_audit, schedule_runs, schedules, messages, conversations, workspace_members, workspaces, service_credentials CASCADE'
    );
    fixtures = await seedSheetsDigestTenants(db, DIGEST_TEST_ENC_KEY);
    await db.pool.query(
      "UPDATE service_credentials SET created_at = '2026-11-01T00:00:00.000Z', status_changed_at = NULL"
    );
  });

  async function runChatProposalAndConfirm(input: {
    userId: string;
    convId: string;
    promptText: string;
    routedServices: string[];
    fetchOrgSheetsMetadata?: any;
  }) {
    const emitted: Array<{ event: string; payload: any }> = [];
    const routeActors: Array<any> = [];

    const scheduleService = new ScheduleService({
      pool: db.pool,
      timeZone: TZ,
      credentialRepo: fixtures.credentialRepo,
      encryptionKey: fixtures.encryptionKey,
      mysheetsEnabled: true,
      emitV2: true,
      fetchOrgSheetsMetadata: input.fetchOrgSheetsMetadata,
    });

    const chatService = new ChatService({
      msgRepo: messageRepo,
      convRepo: fixtures.convRepo,
      workspaceRepo: fixtures.workspaceRepo,
      planner: {
        processMessage: async () => ({
          kind: 'schedule' as const,
          action: 'create' as const,
          name: 'Lịch Báo cáo Tự động',
          request: input.promptText,
          recurrence: { type: 'daily' as const, time: '08:00' },
          summary: 'Mỗi ngày lúc 08:00 gửi báo cáo tự động.',
        }),
        routeSchedule: async (_req: string, actor: any) => {
          routeActors.push(actor);
          return {
            services: input.routedServices,
            unavailable: [],
          };
        },
      } as any,
      eventEmitter: { emit: (event, payload) => emitted.push({ event, payload }) },
      schedules: {
        repo: scheduleService.repo,
        timeZone: TZ,
        credentialRepo: fixtures.credentialRepo,
        encryptionKey: fixtures.encryptionKey,
        mysheetsEnabled: true,
        emitV2: true,
        fetchOrgSheetsMetadata: input.fetchOrgSheetsMetadata,
        now: () => new Date('2026-11-02T00:00:00Z'),
      },
    });

    await chatService.handleUserMessage({
      conversationId: input.convId,
      userId: input.userId,
      content: input.promptText,
    });

    for (let i = 0; i < 100 && !emitted.some((e) => e.event === 'schedule_proposal' || e.event === 'error'); i++) {
      await new Promise((r) => setTimeout(r, 15));
    }

    const proposalEvent = emitted.find((e) => e.event === 'schedule_proposal');
    expect(proposalEvent).toBeDefined();

    const confirmed = await scheduleService.confirmProposal({
      userId: input.userId,
      convId: input.convId,
      messageId: proposalEvent!.payload.messageId,
      now: new Date('2026-11-02T00:00:00Z'),
      approvalMode: 'auto_digest',
    });

    return {
      proposalEvent: proposalEvent!,
      confirmed,
      scheduleService,
      routeActors,
    };
  }

  it('TC-19: executes all 5 hops end-to-end for Org Hybrid (mysheets -> slack), Org Standard (sheets -> slack), and Org Personal-to-Personal (mysheets -> gmail with senderEmail !== recipientEmail)', async () => {
    const { personalA, orgA, convRepo } = fixtures;

    const adapterCalls: Array<{
      serviceId: string;
      userId: string;
      config: SheetsDigestConfig;
      scheduleContext?: SheetsDigestScheduleContext;
    }> = [];
    const slackDeliveries: Array<{ channel: string; text: string }> = [];
    const gmailDeliveries: Array<{ to: string[]; subject: string; body: string }> = [];

    const createAdapter = vi.fn(
      async (
        serviceId: 'mysheets' | 'sheets' | 'slack' | 'telegram' | 'gmail',
        userId: string,
        config: SheetsDigestConfig,
        scheduleContext?: SheetsDigestScheduleContext
      ) => {
        adapterCalls.push({ serviceId, userId, config, scheduleContext });
        if (serviceId === 'mysheets' || serviceId === 'sheets') {
          return {
            execute: vi.fn(),
            readDigestWindow: vi.fn(async (): Promise<ReadDigestWindowResult> => ({
              spreadsheetId: config.source.spreadsheetId,
              sheetTitle: config.source.sheetName ?? 'KPI Tháng 11',
              scannedRange: "'KPI Tháng 11'!A1:Z502",
              explicitRangeRequested: false,
              dataScope: 'full_tab_verified',
              windowClipped: false,
              rowLimitExceeded: false,
              columnLimitExceeded: false,
              gridRowCapacity: 100,
              gridColumnCapacity: 10,
              populatedRowCountInWindow: 2,
              totalDataRows: 1,
              headers: ['Hạng mục', 'Trạng thái', 'Doanh thu'],
              values: [
                ['Hạng mục', 'Trạng thái', 'Doanh thu'],
                ['Mục tiêu 1', 'Hoàn thành', '50,000,000'],
              ],
              records: [{ 'Hạng mục': 'Mục tiêu 1', 'Trạng thái': 'Hoàn thành', 'Doanh thu': '50,000,000' }],
              tailRecords: [{ 'Hạng mục': 'Mục tiêu 1', 'Trạng thái': 'Hoàn thành', 'Doanh thu': '50,000,000' }],
              tailValues: [['Mục tiêu 1', 'Hoàn thành', '50,000,000']],
            })),
          };
        }
        if (serviceId === 'slack') {
          return {
            execute: vi.fn(async (_tool: string, args: any) => {
              slackDeliveries.push({ channel: args.channel, text: args.text });
              return { ok: true, channel: args.channel, ts: '1730509200.000111' };
            }),
          };
        }
        if (serviceId === 'gmail') {
          return {
            execute: vi.fn(async (_tool: string, args: any) => {
              gmailDeliveries.push({ to: args.to, subject: args.subject, body: args.body });
              return { id: 'gmail-msg-e2e-1', threadId: 'th-e2e-1' };
            }),
          };
        }
        throw new Error(`Unexpected service ${serviceId}`);
      }
    );

    const fetchOrgSheetsMetadata = vi.fn(async () => [
      { id: ORG_A_SPREADSHEET_ID, title: 'Bảng Doanh Thu Tổ Chức Alpha', sheets: ['KPI Tháng 11'] },
    ]);

    // 1. Org Hybrid: mysheets (Personal) -> slack (Org)
    const convHybrid = await convRepo.createConversation(personalA.user.id, 'Org Hybrid Conv', {
      workspaceMode: 'organization',
      workspaceId: orgA.workspaceId,
    });
    const hybrid = await runChatProposalAndConfirm({
      userId: personalA.user.id,
      convId: convHybrid.id,
      promptText: 'Đọc tab KPI Tháng 11 từ bảng Báo cáo KPI Cá nhân A và gửi vào Slack #general',
      routedServices: ['sheets', 'slack'],
      fetchOrgSheetsMetadata,
    });

    expect(hybrid.proposalEvent.payload.metadata.services).toEqual(['mysheets', 'slack']);
    const hybridCfg = hybrid.confirmed.schedule.digestConfig;
    expect(isSheetsDigestConfigV2(hybridCfg)).toBe(true);
    expect(hybridCfg).toMatchObject({
      version: 2,
      workspaceMode: 'organization',
      workspaceId: orgA.workspaceId,
      source: {
        service: 'mysheets',
        credentialId: personalA.mysheetsCred.id,
        email: 'alice@personal.test',
        spreadsheetId: PERSONAL_A_SPREADSHEET_ID,
      },
      destination: {
        service: 'slack',
        credentialId: orgA.slackCred.id,
        channelId: orgA.slackChannelId,
      },
    });

    // 2. Org Standard: sheets (Org) -> slack (Org)
    const convOrgStd = await convRepo.createConversation(personalA.user.id, 'Org Standard Conv', {
      workspaceMode: 'organization',
      workspaceId: orgA.workspaceId,
    });
    const fetchCountBeforeStd = fetchOrgSheetsMetadata.mock.calls.length;
    const orgStd = await runChatProposalAndConfirm({
      userId: personalA.user.id,
      convId: convOrgStd.id,
      promptText: 'Đọc bảng Bảng Doanh Thu Tổ Chức Alpha và gửi vào Slack #general',
      routedServices: ['sheets', 'slack'],
      fetchOrgSheetsMetadata,
    });
    // Called once during Hop 1 (prepareProposal) and 0 times during Hop 2 (confirmProposal)
    expect(fetchOrgSheetsMetadata.mock.calls.length - fetchCountBeforeStd).toBe(1);
    expect(orgStd.confirmed.schedule.digestConfig).toMatchObject({
      version: 2,
      workspaceMode: 'organization',
      workspaceId: orgA.workspaceId,
      source: {
        service: 'sheets',
        credentialId: orgA.sheetsCred.id,
        spreadsheetId: ORG_A_SPREADSHEET_ID,
      },
      destination: {
        service: 'slack',
        credentialId: orgA.slackCred.id,
        channelId: orgA.slackChannelId,
      },
    });

    // 3. Org Personal-to-Personal: mysheets (Personal) -> gmail (Personal) with senderEmail !== recipientEmail
    const convPersonalInOrg = await convRepo.createConversation(personalA.user.id, 'Org Personal Gmail Conv', {
      workspaceMode: 'organization',
      workspaceId: orgA.workspaceId,
    });
    const personalInOrg = await runChatProposalAndConfirm({
      userId: personalA.user.id,
      convId: convPersonalInOrg.id,
      promptText: 'Đọc bảng Báo cáo KPI Cá nhân A và gửi qua Gmail tới finance@company.com',
      routedServices: ['mysheets', 'gmail'],
      fetchOrgSheetsMetadata,
    });
    expect(personalInOrg.confirmed.schedule.digestConfig).toMatchObject({
      version: 2,
      workspaceMode: 'organization',
      workspaceId: orgA.workspaceId,
      source: {
        service: 'mysheets',
        credentialId: personalA.mysheetsCred.id,
        email: 'alice@personal.test',
        spreadsheetId: PERSONAL_A_SPREADSHEET_ID,
      },
      destination: {
        service: 'gmail',
        credentialId: personalA.gmailCred.id,
        senderEmail: 'alice@personal.test',
        recipientEmail: 'finance@company.com',
      },
    });

    // Hop 3, 4 & 5: Execute all 3 schedules via ScheduleRunner.tick() -> SheetsDigestRunner -> createAdapter
    const digestRunner = new SheetsDigestRunner({
      pool: db.pool,
      repo: scheduleRepo,
      credentialRepo: fixtures.credentialRepo,
      messageRepo,
      encryptionKey: fixtures.encryptionKey,
      mysheetsEnabled: true,
      v2Mode: 'enforce',
      createAdapter,
    });
    const runner = new ScheduleRunner({
      pool: db.pool,
      timeZone: TZ,
      planRun: vi.fn() as any,
      recordState: (client, row, now) => hybrid.scheduleService.recordState(client, row, now),
      sheetsDigestRunner: digestRunner,
      now: () => new Date('2026-11-02T01:00:05Z'),
    });

    await runner.tick();

    expect(slackDeliveries).toHaveLength(2);
    expect(gmailDeliveries).toHaveLength(1);
    expect(gmailDeliveries[0]?.to).toEqual(['finance@company.com']);

    // Verify every createAdapter call received trusted scheduleContext = { workspaceMode: 'organization', workspaceId: orgA.workspaceId }
    expect(adapterCalls.length).toBe(6);
    for (const call of adapterCalls) {
      expect(call.scheduleContext).toEqual({
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
      });
    }
  });

  it("TC-22: preserves workspaceMode='legacy' and workspaceId=null across all 5 hops even when workspaceRepo is active", async () => {
    const { legacy } = fixtures;

    // Verify conversation row in DB has workspace_mode = 'legacy' and workspace_id = null
    const convRow = await fixtures.convRepo.getConversation(legacy.conversation.id);
    expect(convRow?.workspace_mode).toBe('legacy');
    expect(convRow?.workspace_id).toBeNull();

    const legacyResult = await runChatProposalAndConfirm({
      userId: legacy.user.id,
      convId: legacy.conversation.id,
      promptText: `Đọc bảng ${LEGACY_SPREADSHEET_ID} và gửi báo cáo vào Slack ${legacy.slackChannelId}`,
      routedServices: ['sheets', 'slack'],
    });

    // Hop 1: routeSchedule and prepareProposal preserved workspaceMode = 'legacy', workspaceId = null
    expect(legacyResult.routeActors[0]).toMatchObject({
      userId: legacy.user.id,
      workspaceMode: 'legacy',
      workspaceId: null,
    });

    const candidate = legacyResult.proposalEvent.payload.metadata.digestCandidate;
    expect(candidate?.canAutoDigest).toBe(true);
    expect(candidate?.config).toMatchObject({
      version: 2,
      workspaceMode: 'legacy',
      workspaceId: null,
      source: {
        service: 'sheets',
        credentialId: legacy.sheetsCred.id,
        spreadsheetId: LEGACY_SPREADSHEET_ID,
      },
      destination: {
        service: 'slack',
        credentialId: legacy.slackCred.id,
        channelId: legacy.slackChannelId,
      },
    });

    // Hop 2: schedules table row has workspace_mode = 'legacy' and workspace_id = null
    const dbSched = (
      await db.pool.query('SELECT workspace_mode, workspace_id, kind, digest_config FROM schedules WHERE id = $1', [
        legacyResult.confirmed.schedule.id,
      ])
    ).rows[0];
    expect(dbSched.workspace_mode).toBe('legacy');
    expect(dbSched.workspace_id).toBeNull();
    expect(dbSched.kind).toBe('sheets_digest');
    expect(dbSched.digest_config.workspaceMode).toBe('legacy');

    // Hop 3-5: Execute via ScheduleRunner -> SheetsDigestRunner -> createAdapter
    const seenContexts: SheetsDigestScheduleContext[] = [];
    const digestRunner = new SheetsDigestRunner({
      pool: db.pool,
      repo: scheduleRepo,
      credentialRepo: fixtures.credentialRepo,
      messageRepo,
      encryptionKey: fixtures.encryptionKey,
      mysheetsEnabled: true,
      v2Mode: 'enforce',
      createAdapter: async (serviceId, _userId, config, scheduleContext) => {
        if (scheduleContext) seenContexts.push(scheduleContext);
        if (serviceId === 'sheets') {
          return {
            execute: vi.fn(),
            readDigestWindow: async (): Promise<ReadDigestWindowResult> => ({
              spreadsheetId: config.source.spreadsheetId,
              sheetTitle: 'Sheet1',
              scannedRange: 'Sheet1!A1:Z502',
              explicitRangeRequested: false,
              dataScope: 'full_tab_verified',
              windowClipped: false,
              rowLimitExceeded: false,
              columnLimitExceeded: false,
              gridRowCapacity: 100,
              gridColumnCapacity: 10,
              populatedRowCountInWindow: 2,
              totalDataRows: 1,
              headers: ['Task', 'Status'],
              values: [['Task', 'Status'], ['A', 'Done']],
              records: [{ Task: 'A', Status: 'Done' }],
              tailRecords: [{ Task: 'A', Status: 'Done' }],
              tailValues: [['A', 'Done']],
            }),
          };
        }
        return {
          execute: async () => ({ ok: true, channel: legacy.slackChannelId, ts: '1730509200.000222' }),
        };
      },
    });

    const runner = new ScheduleRunner({
      pool: db.pool,
      timeZone: TZ,
      planRun: vi.fn() as any,
      recordState: (client, row, now) => legacyResult.scheduleService.recordState(client, row, now),
      sheetsDigestRunner: digestRunner,
      now: () => new Date('2026-11-02T01:00:05Z'),
    });

    await runner.tick();

    expect(seenContexts).toEqual([
      { workspaceMode: 'legacy', workspaceId: null },
      { workspaceMode: 'legacy', workspaceId: null },
    ]);
  });
});
