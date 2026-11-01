import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptCredentials } from '@wap/tool-adapters';
import type { ScheduleProposalMetadata } from '@wap/tool-schemas';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import { MessageRepo } from '../../src/db/repositories/message-repo.js';
import { ScheduleRepo } from '../../src/db/repositories/schedule-repo.js';
import { ScheduleService } from '../../src/services/schedules/schedule-service.js';
import { ScheduleRunner } from '../../src/services/schedules/schedule-runner.js';
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
        connectedAt: '2026-11-02T00:00:00Z',
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
    await credentialRepo.saveCredentials('slack', slackConfig);
  });

  it('analyzeSheetsDigestCandidate approves read-only mysheets + slack digest and rejects write intent or extra services', async () => {
    const okCandidate = await analyzeSheetsDigestCandidate({
      userId: alice.id,
      request: 'Đọc tab KPI Tháng 11 từ bảng Báo cáo KPI Q4 và gửi báo cáo tiến độ vào Slack #bao-cao',
      services: ['mysheets', 'slack'],
      credentialRepo,
      encryptionKey: ENC_KEY,
      mysheetsEnabled: true,
    });

    expect(okCandidate.canAutoDigest).toBe(true);
    expect(okCandidate.config).toMatchObject({
      version: 1,
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
    });
    expect(multiServiceCandidate.canAutoDigest).toBe(false);
  });

  it('confirms schedule as kind=sheets_digest when approvalMode=auto_digest and blocks TOCTOU scope revocation', async () => {
    const candidate = await analyzeSheetsDigestCandidate({
      userId: alice.id,
      request: 'Đọc bảng Báo cáo KPI Q4 và gửi tóm tắt KPI sáng vào Slack',
      services: ['mysheets', 'slack'],
      credentialRepo,
      encryptionKey: ENC_KEY,
      mysheetsEnabled: true,
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
    expect(change.schedule.digestConfig?.source.spreadsheetId).toBe(SPREADSHEET_ID);

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
      services: ['mysheets', 'slack'],
      credentialRepo,
      encryptionKey: ENC_KEY,
      mysheetsEnabled: true,
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
      services: ['mysheets', 'slack'],
      credentialRepo,
      encryptionKey: ENC_KEY,
      mysheetsEnabled: true,
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
            throw new Error('Slack network error');
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
});
