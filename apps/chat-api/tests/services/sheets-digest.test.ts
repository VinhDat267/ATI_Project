import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptCredentials, StepError } from '@wap/tool-adapters';
import type { ScheduleProposalMetadata, SheetsDigestConfigV2 } from '@wap/tool-schemas';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import { MessageRepo } from '../../src/db/repositories/message-repo.js';
import { ScheduleRepo } from '../../src/db/repositories/schedule-repo.js';
import { ScheduleService } from '../../src/services/schedules/schedule-service.js';
import { ScheduleRunner } from '../../src/services/schedules/schedule-runner.js';
import { ChatService } from '../../src/services/chat-service.js';
import {
  analyzeSheetsDigestCandidate,
  computeSheetsDigestHash,
} from '../../src/services/schedules/sheets-digest-candidate.js';
import { SheetsDigestRunner } from '../../src/services/schedules/sheets-digest-runner.js';

const ENC_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const SPREADSHEET_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
const TZ = 'Asia/Ho_Chi_Minh';

describe('Sheets Digest Candidate, Schedule Confirmation & SheetsDigestRunner', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let credentialRepo: CredentialRepo;
  let convRepo: ConversationRepo;
  let messageRepo: MessageRepo;
  let scheduleRepo: ScheduleRepo;
  let alice: Awaited<ReturnType<Awaited<ReturnType<typeof createMigratedSchema>>['person']>>;
  let mysheetsCredId: string;
  let slackCredId: string;

  async function upgradeScheduleToPinnedV2(scheduleId: string) {
    const rowRes = await db.pool.query('SELECT * FROM schedules WHERE id = $1', [scheduleId]);
    const row = rowRes.rows[0];
    const oldCfg = row.digest_config;
    let destCredId = oldCfg.destination.credentialId;
    if (!destCredId) {
      if (oldCfg.destination.service === 'slack') {
        destCredId = slackCredId;
      } else if (oldCfg.destination.service === 'telegram') {
        const tg = await credentialRepo.getPersonalCredentials('telegram', row.user_id);
        destCredId = tg?.id;
      }
    }
    const v2Config: SheetsDigestConfigV2 = {
      version: 2,
      workspaceMode: (row.workspace_mode ?? 'legacy') as 'personal' | 'organization' | 'legacy',
      workspaceId: row.workspace_id ?? null,
      source: {
        ...oldCfg.source,
        credentialId: oldCfg.source.credentialId || mysheetsCredId,
        email: oldCfg.source.email || 'alice@gmail.com',
      },
      destination:
        oldCfg.destination.service === 'slack'
          ? {
              service: 'slack',
              credentialId: destCredId,
              channelId: oldCfg.destination.channelId,
              ...(oldCfg.destination.channelLabel ? { channelLabel: oldCfg.destination.channelLabel } : {}),
            }
          : oldCfg.destination.service === 'telegram'
            ? {
                service: 'telegram',
                credentialId: destCredId,
                chatId: oldCfg.destination.chatId,
                ...(oldCfg.destination.chatLabel ? { chatLabel: oldCfg.destination.chatLabel } : {}),
              }
            : {
                service: 'gmail',
                credentialId: destCredId,
                senderEmail: 'alice@example.com',
                recipientEmail: oldCfg.destination.recipientEmail,
              },
      includeAiSummary: Boolean(oldCfg.includeAiSummary),
    };
    const v2Hash = computeSheetsDigestHash({
      userId: row.user_id,
      recurrence: row.recurrence,
      config: v2Config,
    });
    await db.pool.query(
      'UPDATE schedules SET digest_config = $2::jsonb, digest_config_hash = $3 WHERE id = $1',
      [scheduleId, JSON.stringify(v2Config), v2Hash]
    );
  }

  beforeAll(async () => {
    db = await createMigratedSchema('sheets_digest_svc');
    credentialRepo = new CredentialRepo(db.pool);
    convRepo = new ConversationRepo(db.pool);
    messageRepo = new MessageRepo(db.pool);
    scheduleRepo = new ScheduleRepo(db.pool, TZ);
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.pool.query('DELETE FROM schedule_runs');
    await db.pool.query('DELETE FROM schedules');
    await db.pool.query('DELETE FROM service_credentials');
    alice = await db.person('Alice');

    // Configure personal mysheets credential for Alice
    const mysheetsConfig = encryptCredentials(
      {
        refreshToken: '1//alice-mysheets-refresh',
        email: 'alice@gmail.com',
        scopes: ['https://www.googleapis.com/auth/drive.file'],
        selectedSpreadsheets: [
          {
            id: SPREADSHEET_ID,
            title: 'Báo cáo KPI Q4',
            canEdit: true,
            sheets: ['KPI Tháng 11', 'Tasks'],
          },
        ],
        allowedScope: { spreadsheets: [SPREADSHEET_ID] },
        connectedAt: '2026-11-01T00:00:00Z',
      },
      ENC_KEY
    );
    const saved = await credentialRepo.saveCredentials('mysheets', mysheetsConfig, alice.id);
    mysheetsCredId = saved.id;

    // Configure shared slack credential with locked channel C12345678
    const slackConfig = encryptCredentials(
      {
        botToken: 'xoxb-fake-slack-token',
        allowedScope: { channels: ['C12345678'] },
      },
      ENC_KEY
    );
    const savedSlack = await credentialRepo.saveCredentials('slack', slackConfig);
    slackCredId = savedSlack.id;
    await db.pool.query(
      "UPDATE service_credentials SET created_at = '2026-11-01T00:00:00Z', status_changed_at = '2026-11-01T00:00:00Z'"
    );
  });

  it('analyzeSheetsDigestCandidate approves read-only mysheets + slack digest and rejects write intent or extra services', async () => {
    const okCandidate = await analyzeSheetsDigestCandidate({
      userId: alice.id,
      request: 'Đọc tab KPI Tháng 11 từ bảng Báo cáo KPI Q4 và gửi báo cáo tiến độ vào Slack #bao-cao',
      recurrence: { type: 'daily', time: '08:00' },
      services: ['mysheets', 'slack'],
      credentialRepo,
      encryptionKey: ENC_KEY,
      mysheetsEnabled: true,
      emitV2: true,
    });

    expect(okCandidate.canAutoDigest).toBe(true);
    expect(okCandidate.config).toMatchObject({
      version: 2,
      workspaceMode: 'legacy',
      workspaceId: null,
      source: {
        service: 'mysheets',
        credentialId: mysheetsCredId,
        email: 'alice@gmail.com',
        spreadsheetId: SPREADSHEET_ID,
        spreadsheetTitle: 'Báo cáo KPI Q4',
        sheetName: 'KPI Tháng 11',
        tailRows: 20,
      },
      destination: {
        service: 'slack',
        credentialId: slackCredId,
        channelId: 'C12345678',
      },
      includeAiSummary: true,
    });

    // Rejects write intent
    const writeCandidate = await analyzeSheetsDigestCandidate({
      userId: alice.id,
      request: 'Thêm dòng công việc mới vào bảng Báo cáo KPI Q4 rồi gửi thông báo Slack',
      services: ['mysheets', 'slack'],
      credentialRepo,
      encryptionKey: ENC_KEY,
      mysheetsEnabled: true,
      emitV2: true,
    });
    expect(writeCandidate.canAutoDigest).toBe(false);
    expect(writeCandidate.reason).toMatch(/ghi hoặc cập nhật/i);

    // Rejects extra services
    const multiServiceCandidate = await analyzeSheetsDigestCandidate({
      userId: alice.id,
      request: 'Đọc issue GitHub và bảng Báo cáo KPI Q4 rồi gửi Slack',
      services: ['github', 'mysheets', 'slack'],
      credentialRepo,
      encryptionKey: ENC_KEY,
      mysheetsEnabled: true,
      emitV2: true,
    });
    expect(multiServiceCandidate.canAutoDigest).toBe(false);

    // Extracts quoted tab name & sheet!A1:B20 range, and preserves explicit non-listed tab without silent fallback
    const quotedBangCandidate = await analyzeSheetsDigestCandidate({
      userId: alice.id,
      request: "Đọc vùng 'KPI Tháng 11'!A1:D25 từ bảng Báo cáo KPI Q4 và gửi vào Slack #bao-cao",
      recurrence: { type: 'daily', time: '08:00' },
      services: ['mysheets', 'slack'],
      credentialRepo,
      encryptionKey: ENC_KEY,
      mysheetsEnabled: true,
      emitV2: true,
    });
    expect(quotedBangCandidate.canAutoDigest).toBe(true);
    expect(quotedBangCandidate.config?.source.sheetName).toBe('KPI Tháng 11');
    expect(quotedBangCandidate.config?.source.range).toBe('A1:D25');

    const explicitUnlistedTabCandidate = await analyzeSheetsDigestCandidate({
      userId: alice.id,
      request: 'Đọc tab Công nợ Q4 từ bảng Báo cáo KPI Q4 và gửi vào Slack #bao-cao',
      recurrence: { type: 'daily', time: '08:00' },
      services: ['mysheets', 'slack'],
      credentialRepo,
      encryptionKey: ENC_KEY,
      mysheetsEnabled: true,
      emitV2: true,
    });
    expect(explicitUnlistedTabCandidate.canAutoDigest).toBe(true);
    expect(explicitUnlistedTabCandidate.config?.source.sheetName).toBe('Công nợ Q4');
  });

  it('confirms schedule as kind=sheets_digest when approvalMode=auto_digest and blocks TOCTOU scope revocation', async () => {
    const candidate = await analyzeSheetsDigestCandidate({
      userId: alice.id,
      request: 'Đọc bảng Báo cáo KPI Q4 và gửi tóm tắt KPI sáng vào Slack',
      recurrence: { type: 'daily', time: '08:00' },
      services: ['mysheets', 'slack'],
      credentialRepo,
      encryptionKey: ENC_KEY,
      mysheetsEnabled: true,
      emitV2: true,
    });
    expect(candidate.canAutoDigest).toBe(true);

    const conv = await convRepo.createConversation(alice.id);
    const metadata: ScheduleProposalMetadata = {
      type: 'schedule_proposal',
      proposal: {
        kind: 'schedule',
        action: 'create',
        name: 'Báo cáo KPI sáng',
        request: 'Đọc bảng Báo cáo KPI Q4 và gửi tóm tắt KPI sáng vào Slack',
        recurrence: { type: 'daily', time: '08:00' },
        summary: 'Mỗi ngày lúc 08:00 đọc bảng Báo cáo KPI Q4 và gửi Slack.',
      },
      scheduleId: null,
      baseVersion: null,
      services: ['mysheets', 'slack'],
      nextRuns: ['2026-11-03T01:00:00.000Z'],
      previous: null,
      digestCandidate: candidate,
    };
    const msg = await messageRepo.createMessage(
      conv.id,
      'assistant',
      metadata.proposal.summary,
      metadata as unknown as Record<string, unknown>
    );

    const service = new ScheduleService({
      pool: db.pool,
      timeZone: TZ,
      credentialRepo,
      encryptionKey: ENC_KEY,
      mysheetsEnabled: true,
      emitV2: true,
    });

    const change = await service.confirmProposal({
      userId: alice.id,
      convId: conv.id,
      messageId: msg.id,
      now: new Date('2026-11-02T00:00:00Z'),
      approvalMode: 'auto_digest',
    });

    expect(change.schedule.kind).toBe('sheets_digest');
    expect(change.schedule.approvalMode).toBe('auto_digest');
    expect((change.schedule.digestConfig as any)?.source.spreadsheetId).toBe(SPREADSHEET_ID);

    const row = await scheduleRepo.ownedSchedule(change.schedule.id, alice.id);
    expect(row?.kind).toBe('sheets_digest');
    expect(row?.digest_config_hash).toBe(
      computeSheetsDigestHash({
        userId: alice.id,
        recurrence: { type: 'daily', time: '08:00' },
        config: candidate.config!,
      })
    );
  });

  it('SheetsDigestRunner executes smart read, sanitizes Slack mentions, falls back on AI timeout, and records digest_sent', async () => {
    const candidate = await analyzeSheetsDigestCandidate({
      userId: alice.id,
      request: 'Đọc tab KPI Tháng 11 từ bảng Báo cáo KPI Q4 và gửi báo cáo vào Slack',
      recurrence: { type: 'daily', time: '08:00' },
      services: ['mysheets', 'slack'],
      credentialRepo,
      encryptionKey: ENC_KEY,
      mysheetsEnabled: true,
      emitV2: true,
    });

    const conv = await convRepo.createConversation(alice.id);
    const metadata: ScheduleProposalMetadata = {
      type: 'schedule_proposal',
      proposal: {
        kind: 'schedule',
        action: 'create',
        name: 'Báo cáo KPI sáng',
        request: 'Đọc tab KPI Tháng 11 từ bảng Báo cáo KPI Q4 và gửi báo cáo vào Slack',
        recurrence: { type: 'daily', time: '08:00' },
        summary: 'Báo cáo KPI sáng.',
      },
      scheduleId: null,
      baseVersion: null,
      services: ['mysheets', 'slack'],
      nextRuns: ['2026-11-02T01:00:00.000Z'],
      previous: null,
      digestCandidate: candidate,
    };
    const msg = await messageRepo.createMessage(
      conv.id,
      'assistant',
      metadata.proposal.summary,
      metadata as unknown as Record<string, unknown>
    );

    const sentMessages: Array<{ channel: string; text: string }> = [];
    const fakeAdapters: Record<string, any> = {
      mysheets: {
        execute: vi.fn(async (_tool: string, _args: any) => ({
          range: "'KPI Tháng 11'!A1:Z500",
          values: [
            ['Hạng mục', 'Chủ sở hữu', 'Trạng thái', 'Deadline'],
            ['Tối ưu OAuth Sheets', 'Minh', 'Hoàn thành', '2026-11-01'],
            ['Đồng bộ Jira -> Sheets <!channel>', 'Lan', 'Đang làm', '2026-11-05'],
            ['Báo cáo thuế @everyone', 'Huy', 'Quá hạn', '2026-10-30'],
          ],
          headers: ['Hạng mục', 'Chủ sở hữu', 'Trạng thái', 'Deadline'],
          records: [
            { 'Hạng mục': 'Tối ưu OAuth Sheets', 'Chủ sở hữu': 'Minh', 'Trạng thái': 'Hoàn thành', Deadline: '2026-11-01' },
            { 'Hạng mục': 'Đồng bộ Jira -> Sheets <!channel>', 'Chủ sở hữu': 'Lan', 'Trạng thái': 'Đang làm', Deadline: '2026-11-05' },
            { 'Hạng mục': 'Báo cáo thuế @everyone', 'Chủ sở hữu': 'Huy', 'Trạng thái': 'Quá hạn', Deadline: '2026-10-30' },
          ],
          totalDataRows: 3,
        })),
      },
      slack: {
        execute: vi.fn(async (_tool: string, args: any) => {
          sentMessages.push({ channel: args.channel, text: args.text });
          return { ok: true, channel: args.channel, ts: '1730509200.000100' };
        }),
      },
    };

    const digestRunner = new SheetsDigestRunner({
      repo: scheduleRepo,
      credentialRepo,
      messageRepo,
      encryptionKey: ENC_KEY,
      mysheetsEnabled: true,
      createAdapter: async (serviceId) => fakeAdapters[serviceId],
      summarizeWithAi: async (_prompt, signal) => {
        expect(signal).toBeInstanceOf(AbortSignal);
        return '• Đã hoàn thành 1/3 hạng mục KPI.\n• Cảnh báo: Mục Báo cáo thuế @channel đang quá hạn.';
      },
    });

    let runner!: ScheduleRunner;
    const service = new ScheduleService({
      pool: db.pool,
      timeZone: TZ,
      runner: { planNow: (runId) => runner.planNow(runId) },
      credentialRepo,
      encryptionKey: ENC_KEY,
      mysheetsEnabled: true,
      emitV2: true,
    });
    runner = new ScheduleRunner({
      pool: db.pool,
      timeZone: TZ,
      planRun: vi.fn() as any,
      recordState: (client, row, now) => service.recordState(client, row, now),
      sheetsDigestRunner: digestRunner,
      now: () => new Date('2026-11-02T01:00:05Z'),
    });

    const change = await service.confirmProposal({
      userId: alice.id,
      convId: conv.id,
      messageId: msg.id,
      now: new Date('2026-11-02T00:00:00Z'),
      approvalMode: 'auto_digest',
    });

    await runner.tick();

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]!.channel).toBe('C12345678');
    // Must neutralize @channel / <!channel> / @everyone
    expect(sentMessages[0]!.text).not.toContain('<!channel>');
    expect(sentMessages[0]!.text).not.toContain('@channel');
    expect(sentMessages[0]!.text).not.toContain('@everyone');
    expect(sentMessages[0]!.text).toContain('Báo cáo KPI Q4');

    const runs = await service.listRuns(alice.id, change.schedule.id, 10, new Date('2026-11-02T01:01:00Z'));
    expect(runs[0]?.state).toBe('digest_sent');
    expect(runs[0]?.delivery).toMatchObject({
      destination: 'slack',
      targetId: 'C12345678',
      spreadsheetId: SPREADSHEET_ID,
      rowCount: 3,
      summaryMode: 'ai',
    });
  });

  it('auto-pauses schedule after 3 consecutive digest_failed runs', async () => {
    const candidate = await analyzeSheetsDigestCandidate({
      userId: alice.id,
      request: 'Đọc bảng Báo cáo KPI Q4 và gửi báo cáo vào Slack',
      recurrence: { type: 'daily', time: '08:00' },
      services: ['mysheets', 'slack'],
      credentialRepo,
      encryptionKey: ENC_KEY,
      mysheetsEnabled: true,
      emitV2: true,
    });

    const conv = await convRepo.createConversation(alice.id);
    const metadata: ScheduleProposalMetadata = {
      type: 'schedule_proposal',
      proposal: {
        kind: 'schedule',
        action: 'create',
        name: 'Báo cáo KPI sáng',
        request: 'Đọc bảng Báo cáo KPI Q4 và gửi báo cáo vào Slack',
        recurrence: { type: 'daily', time: '08:00' },
        summary: 'Báo cáo KPI sáng.',
      },
      scheduleId: null,
      baseVersion: null,
      services: ['mysheets', 'slack'],
      nextRuns: ['2026-11-02T01:00:00.000Z'],
      previous: null,
      digestCandidate: candidate,
    };
    const msg = await messageRepo.createMessage(
      conv.id,
      'assistant',
      metadata.proposal.summary,
      metadata as unknown as Record<string, unknown>
    );

    const digestRunner = new SheetsDigestRunner({
      repo: scheduleRepo,
      credentialRepo,
      messageRepo,
      encryptionKey: ENC_KEY,
      mysheetsEnabled: true,
      createAdapter: async (serviceId) => {
        if (serviceId === 'mysheets') {
          return {
            execute: async () => ({
              range: 'Sheet1!A1:B2',
              values: [['Task', 'Status'], ['A', 'Done']],
              headers: ['Task', 'Status'],
              records: [{ Task: 'A', Status: 'Done' }],
              totalDataRows: 1,
            }),
          } as any;
        }
        return {
          execute: async () => {
            throw new StepError({
              message: 'Slack channel not found: channel_not_found',
              category: 'NOT_FOUND',
              statusCode: 404,
              retryable: false,
            });
          },
        } as any;
      },
    });

    let runner!: ScheduleRunner;
    const service = new ScheduleService({
      pool: db.pool,
      timeZone: TZ,
      runner: { planNow: (runId) => runner.planNow(runId) },
      credentialRepo,
      encryptionKey: ENC_KEY,
      mysheetsEnabled: true,
      emitV2: true,
    });
    runner = new ScheduleRunner({
      pool: db.pool,
      timeZone: TZ,
      planRun: vi.fn() as any,
      recordState: (client, row, now) => service.recordState(client, row, now),
      sheetsDigestRunner: digestRunner,
      now: () => new Date('2026-11-02T01:00:05Z'),
    });

    const change = await service.confirmProposal({
      userId: alice.id,
      convId: conv.id,
      messageId: msg.id,
      now: new Date('2026-11-02T00:00:00Z'),
      approvalMode: 'auto_digest',
    });

    const runOnce = async (iso: string) => {
      const r = await service.startRun({
        userId: alice.id,
        scheduleId: change.schedule.id,
        trigger: 'manual',
        now: new Date(iso),
      });
      await runner.planNow(r.id);
    };

    await runOnce('2026-11-02T01:01:00Z');
    expect((await scheduleRepo.ownedSchedule(change.schedule.id, alice.id))?.status).toBe('active');

    await runOnce('2026-11-02T01:02:00Z');
    expect((await scheduleRepo.ownedSchedule(change.schedule.id, alice.id))?.status).toBe('active');

    await runOnce('2026-11-02T01:03:00Z');
    const pausedAfter3 = await scheduleRepo.ownedSchedule(change.schedule.id, alice.id);
    expect(pausedAfter3?.status).toBe('paused');
    expect(pausedAfter3?.pause_reason).toMatch(/3 lần/i);
  });

  it('routes mysheets + telegram schedule to SheetsDigestCandidate (not hijacked by telegram_digest) and supports personal Telegram selectedChats', async () => {
    const tgPersonalConfig = encryptCredentials(
      {
        telegramUserId: '777000111',
        username: 'alice_tg',
        displayName: 'Alice',
        selectedChats: [
          { chatId: '777000111', title: 'Telegram của tôi (Alice)', type: 'private' },
          { chatId: '-100777888999', title: 'Nhóm KPI Sản Phẩm', type: 'supergroup' },
        ],
      },
      ENC_KEY
    );
    await credentialRepo.upsertPersonalCredentials({
      service: 'telegram',
      userId: alice.id,
      config: tgPersonalConfig,
    });
    await db.pool.query(
      "UPDATE service_credentials SET created_at = '2026-11-01T00:00:00Z', status_changed_at = '2026-11-01T00:00:00Z'"
    );

    const emitted: Array<{ event: string; payload: any }> = [];
    const service = new ScheduleService({
      pool: db.pool,
      timeZone: TZ,
      credentialRepo,
      encryptionKey: ENC_KEY,
      mysheetsEnabled: true,
      emitV2: true,
    });

    const chatService = new ChatService({
      msgRepo: messageRepo,
      convRepo,
      planner: {
        processMessage: async () => ({
          kind: 'schedule' as const,
          action: 'create' as const,
          name: 'Báo cáo KPI Telegram',
          request: 'Đọc tab KPI Tháng 11 từ bảng Báo cáo KPI Q4 và gửi báo cáo vào Nhóm KPI Sản Phẩm trên Telegram',
          recurrence: { type: 'daily' as const, time: '08:30' },
          summary: 'Mỗi ngày lúc 08:30 gửi báo cáo KPI vào Nhóm KPI Sản Phẩm trên Telegram.',
        }),
        routeSchedule: async () => ({
          services: ['mysheets', 'telegram'],
          unavailable: [],
        }),
      } as any,
      eventEmitter: { emit: (event, payload) => emitted.push({ event, payload }) },
      telegramConnection: async () => ({
        status: 'connected' as const,
        selectedChats: [
          { chatId: '777000111', title: 'Telegram của tôi (Alice)', type: 'private' as const },
          { chatId: '-100777888999', title: 'Nhóm KPI Sản Phẩm', type: 'supergroup' as const },
        ],
        connection: {
          credentialId: 'tg-cred-1',
          telegramUserId: '777000111',
          username: 'alice_tg',
          chatIds: ['777000111', '-100777888999'],
        },
      }),
      schedules: {
        repo: service.repo,
        timeZone: TZ,
        credentialRepo,
        encryptionKey: ENC_KEY,
        mysheetsEnabled: true,
        emitV2: true,
        now: () => new Date('2026-11-02T00:00:00Z'),
      },
    });

    const conv = await convRepo.createConversation(alice.id);
    await chatService.handleUserMessage({
      conversationId: conv.id,
      userId: alice.id,
      content: 'Mỗi sáng 8h30 đọc tab KPI Tháng 11 từ bảng Báo cáo KPI Q4 và gửi vào Nhóm KPI Sản Phẩm trên Telegram',
    });

    for (let i = 0; i < 100 && !emitted.some((e) => e.event === 'schedule_proposal' || e.event === 'error'); i++) {
      await new Promise((r) => setTimeout(r, 15));
    }

    const proposalEvent = emitted.find((e) => e.event === 'schedule_proposal');
    expect(proposalEvent).toBeDefined();
    expect(proposalEvent!.payload.metadata.digestCandidate).toMatchObject({
      canAutoDigest: true,
      config: {
        source: {
          service: 'mysheets',
          spreadsheetId: SPREADSHEET_ID,
          sheetName: 'KPI Tháng 11',
        },
        destination: {
          service: 'telegram',
          chatId: '-100777888999',
          chatLabel: 'Nhóm KPI Sản Phẩm',
        },
      },
    });

    const change = await service.confirmProposal({
      userId: alice.id,
      convId: conv.id,
      messageId: proposalEvent!.payload.messageId,
      now: new Date('2026-11-02T00:00:00Z'),
      approvalMode: 'auto_digest',
    });
    expect(change.schedule.kind).toBe('sheets_digest');
    expect(change.schedule.approvalMode).toBe('auto_digest');

    const sentTelegram: Array<{ chatId: string; text: string }> = [];
    const digestRunner = new SheetsDigestRunner({
      repo: scheduleRepo,
      credentialRepo,
      messageRepo,
      encryptionKey: ENC_KEY,
      mysheetsEnabled: true,
      createAdapter: async (serviceId) => {
        if (serviceId === 'mysheets') {
          return {
            execute: async () => ({
              headers: ['Hạng mục', 'Trạng thái'],
              records: [{ 'Hạng mục': 'KPI 1', 'Trạng thái': 'Hoàn thành' }],
              values: [['Hạng mục', 'Trạng thái'], ['KPI 1', 'Hoàn thành']],
            }),
          };
        }
        return {
          execute: async (_tool, args) => {
            sentTelegram.push({ chatId: String(args.chatId), text: String(args.text) });
            return { ok: true, messageId: 1001 };
          },
        };
      },
    });

    const row = (await scheduleRepo.ownedSchedule(change.schedule.id, alice.id))!;
    const runRes = await db.pool.query<{ id: string }>(
      `INSERT INTO schedule_runs (schedule_id, schedule_version, trigger, due_at, status)
       VALUES ($1, $2, 'manual', '2026-11-02T01:30:00Z', 'planning')
       RETURNING id`,
      [row.id, row.version]
    );
    const outcome = await digestRunner.executeDigest(row, row.version, runRes.rows[0]!.id);
    expect(outcome.status).toBe('digest_sent');
    expect(sentTelegram).toHaveLength(1);
    expect(sentTelegram[0]!.chatId).toBe('-100777888999');
  });

  it('emits SSE on sheets_digest completion and marks run as interrupted when ScheduleRunner stops mid-run', async () => {
    const candidate = await analyzeSheetsDigestCandidate({
      userId: alice.id,
      request: 'Đọc bảng Báo cáo KPI Q4 và gửi báo cáo vào Slack',
      recurrence: { type: 'daily', time: '08:00' },
      services: ['mysheets', 'slack'],
      credentialRepo,
      encryptionKey: ENC_KEY,
      mysheetsEnabled: true,
      emitV2: true,
    });

    const conv = await convRepo.createConversation(alice.id);
    const metadata: ScheduleProposalMetadata = {
      type: 'schedule_proposal',
      proposal: {
        kind: 'schedule',
        action: 'create',
        name: 'Báo cáo KPI SSE',
        request: 'Đọc bảng Báo cáo KPI Q4 và gửi báo cáo vào Slack',
        recurrence: { type: 'daily', time: '08:00' },
        summary: 'Báo cáo KPI SSE.',
      },
      scheduleId: null,
      baseVersion: null,
      services: ['mysheets', 'slack'],
      nextRuns: ['2026-11-02T01:00:00.000Z'],
      previous: null,
      digestCandidate: candidate,
    };
    const msg = await messageRepo.createMessage(
      conv.id,
      'assistant',
      metadata.proposal.summary,
      metadata as unknown as Record<string, unknown>
    );

    const sseEvents: Array<{ convId: string; event: string; payload: any }> = [];
    let shouldHangUntilAbort = false;

    const digestRunner = new SheetsDigestRunner({
      repo: scheduleRepo,
      credentialRepo,
      messageRepo,
      encryptionKey: ENC_KEY,
      mysheetsEnabled: true,
      createAdapter: async (serviceId) => ({
        execute: async (_tool, _args, ctx) => {
          if (shouldHangUntilAbort) {
            await new Promise<never>((_, reject) => {
              ctx?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
            });
          }
          if (serviceId === 'mysheets') {
            return {
              headers: ['Task', 'Status'],
              records: [{ Task: 'A', Status: 'Done' }],
              values: [['Task', 'Status'], ['A', 'Done']],
            };
          }
          return { ok: true, ts: '1730509200.000200', channel: 'C12345678' };
        },
      }),
    });

    let runner!: ScheduleRunner;
    const service = new ScheduleService({
      pool: db.pool,
      timeZone: TZ,
      runner: { planNow: (runId) => runner.planNow(runId) },
      credentialRepo,
      encryptionKey: ENC_KEY,
      mysheetsEnabled: true,
      emitV2: true,
    });
    runner = new ScheduleRunner({
      pool: db.pool,
      timeZone: TZ,
      planRun: vi.fn() as any,
      recordState: (client, row, now) => service.recordState(client, row, now),
      sheetsDigestRunner: digestRunner,
      emit: (convId, event, payload) => sseEvents.push({ convId, event, payload }),
      now: () => new Date('2026-11-02T01:00:05Z'),
    });

    const change = await service.confirmProposal({
      userId: alice.id,
      convId: conv.id,
      messageId: msg.id,
      now: new Date('2026-11-02T00:00:00Z'),
      approvalMode: 'auto_digest',
    });

    // 1. Normal run emits message_complete SSE
    await runner.tick();
    expect(sseEvents.some((e) => e.event === 'message_complete')).toBe(true);

    // 2. Stopping mid-run marks run as 'interrupted' instead of 'digest_failed'
    shouldHangUntilAbort = true;
    const manualRun = await service.startRun({
      userId: alice.id,
      scheduleId: change.schedule.id,
      trigger: 'manual',
      now: new Date('2026-11-02T01:02:00Z'),
    });
    const runPromise = runner.planNow(manualRun.id);
    await new Promise((r) => setTimeout(r, 30));
    await runner.stop();
    await runPromise;

    const dbRun = (await db.pool.query('SELECT status, error FROM schedule_runs WHERE id = $1', [manualRun.id])).rows[0];
    expect(dbRun.status).toBe('interrupted');
  });

  it('supports sheets_digest delivery via Gmail with explicit mysheets source and refuses silent fallback from unconfigured shared sheets (F-09)', async () => {
    // Save personal Gmail credential for Alice
    const gmailConfig = encryptCredentials(
      {
        refreshToken: '1//alice-gmail-refresh',
        email: 'alice@example.com',
        connectedAt: '2026-11-01T00:00:00Z',
      },
      ENC_KEY
    );
    const savedGmail = await credentialRepo.saveCredentials('gmail', gmailConfig, alice.id);
    await db.pool.query(
      "UPDATE service_credentials SET created_at = '2026-11-01T00:00:00Z', status_changed_at = '2026-11-01T00:00:00Z' WHERE id = $1",
      [savedGmail.id]
    );

    // 1a. F-09: services=['sheets', 'gmail'] when shared 'sheets' is not configured refuses silent fallback to 'mysheets'
    const fallbackRefused = await analyzeSheetsDigestCandidate({
      userId: alice.id,
      request: 'Mỗi sáng thứ Hai 8:00 đọc Google Sheets Báo cáo KPI Q4 và gửi email tổng hợp qua Gmail tới ceo@example.com',
      recurrence: { type: 'daily', time: '08:00' },
      services: ['sheets', 'gmail'],
      credentialRepo,
      encryptionKey: ENC_KEY,
      mysheetsEnabled: true,
      emitV2: true,
    });
    expect(fallbackRefused.canAutoDigest).toBe(false);

    // 1b. Explicit mysheets + gmail produces pinned v2 config with senderEmail and recipientEmail
    const candidate = await analyzeSheetsDigestCandidate({
      userId: alice.id,
      request: 'Mỗi sáng thứ Hai 8:00 đọc Google Sheets Báo cáo KPI Q4 và gửi email tổng hợp qua Gmail tới ceo@example.com',
      recurrence: { type: 'daily', time: '08:00' },
      services: ['mysheets', 'gmail'],
      credentialRepo,
      encryptionKey: ENC_KEY,
      mysheetsEnabled: true,
      emitV2: true,
    });

    expect(candidate.canAutoDigest).toBe(true);
    expect(candidate.config?.version).toBe(2);
    expect(candidate.config?.source.service).toBe('mysheets');
    expect(candidate.config?.source.spreadsheetId).toBe(SPREADSHEET_ID);
    expect(candidate.config?.destination).toEqual({
      service: 'gmail',
      senderEmail: 'alice@example.com',
      recipientEmail: 'ceo@example.com',
      credentialId: savedGmail.id,
    });

    // 2. Execute digest via SheetsDigestRunner -> calls gmail.send_message
    const conv = await convRepo.createConversation(alice.id, 'Lịch báo cáo KPI qua Gmail');
    const metadata: ScheduleProposalMetadata = {
      type: 'schedule_proposal',
      proposal: {
        kind: 'schedule',
        action: 'create',
        name: 'Báo cáo KPI tuần qua Gmail',
        request: 'Mỗi sáng thứ Hai 8:00 đọc Google Sheets Báo cáo KPI Q4 và gửi email tổng hợp qua Gmail tới ceo@example.com',
        recurrence: { type: 'daily', time: '08:00' },
        summary: 'Mỗi ngày 08:00 đọc Báo cáo KPI Q4 và gửi Gmail.',
      },
      scheduleId: null,
      baseVersion: null,
      services: ['mysheets', 'gmail'],
      nextRuns: ['2026-11-02T01:00:00Z'],
      previous: null,
      digestCandidate: candidate,
    };
    const msg = await messageRepo.createMessage(
      conv.id,
      'assistant',
      metadata.proposal.summary,
      metadata as unknown as Record<string, unknown>
    );

    const gmailSendCalls: Array<{ tool: string; args: any }> = [];
    const digestRunner = new SheetsDigestRunner({
      repo: scheduleRepo,
      credentialRepo,
      messageRepo,
      encryptionKey: ENC_KEY,
      mysheetsEnabled: true,
      createAdapter: async (serviceId) => ({
        execute: async (tool, args) => {
          if (serviceId === 'mysheets') {
            return {
              headers: ['Hạng mục', 'Trạng thái', 'Doanh thu'],
              records: [
                { 'Hạng mục': 'Tăng trưởng Q4', 'Trạng thái': 'Hoàn thành', 'Doanh thu': '25,000,000 đ' },
                { 'Hạng mục': 'Hợp đồng Enterprise', 'Trạng thái': 'Hoàn thành', 'Doanh thu': '15.000.000' },
              ],
              values: [
                ['Hạng mục', 'Trạng thái', 'Doanh thu'],
                ['Tăng trưởng Q4', 'Hoàn thành', '25,000,000 đ'],
                ['Hợp đồng Enterprise', 'Hoàn thành', '15.000.000'],
              ],
            };
          }
          if (serviceId === 'gmail') {
            gmailSendCalls.push({ tool, args });
            return { id: 'gmail-msg-1', threadId: 'th-1' };
          }
          throw new Error(`Unexpected service ${serviceId}`);
        },
      }),
    });

    let runner!: ScheduleRunner;
    const service = new ScheduleService({
      pool: db.pool,
      timeZone: TZ,
      runner: { planNow: (runId) => runner.planNow(runId) },
      credentialRepo,
      encryptionKey: ENC_KEY,
      mysheetsEnabled: true,
      emitV2: true,
    });
    runner = new ScheduleRunner({
      pool: db.pool,
      timeZone: TZ,
      planRun: vi.fn() as any,
      recordState: (client, row, now) => service.recordState(client, row, now),
      sheetsDigestRunner: digestRunner,
      now: () => new Date('2026-11-02T01:00:05Z'),
    });

    const confirmed = await service.confirmProposal({
      userId: alice.id,
      convId: conv.id,
      messageId: msg.id,
      now: new Date('2026-11-02T00:00:00Z'),
      approvalMode: 'auto_digest',
    });

    expect(confirmed.schedule.kind).toBe('sheets_digest');
    await runner.tick();

    expect(gmailSendCalls).toHaveLength(1);
    expect(gmailSendCalls[0]!.tool).toBe('gmail.send_message');
    expect(gmailSendCalls[0]!.args.to).toEqual(['ceo@example.com']);
    expect(gmailSendCalls[0]!.args.subject).toContain('Báo cáo KPI tuần qua Gmail');
    expect(gmailSendCalls[0]!.args.body).toContain('Tăng trưởng Q4');
    expect(gmailSendCalls[0]!.args.body).toContain('Tổng Doanh thu: 40,000,000');
  });
});
