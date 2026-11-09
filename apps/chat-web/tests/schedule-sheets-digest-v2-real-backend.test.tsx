/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import {
  URL as NodeURL,
  URLSearchParams as NodeURLSearchParams,
  pathToFileURL,
} from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SheetsDigestConfigV1 } from '@wap/tool-schemas';
import { ScheduleMoment } from '../src/pages/Cockpit/ScheduleMoment';
import { ScheduleRunRecovery } from '../src/pages/Cockpit/ScheduleRunRecovery';
import { ScheduleSection } from '../src/pages/History/ScheduleSection';
import { apiClient } from '../src/services/api-client';
import * as useSchedulesHook from '../src/hooks/use-schedules';
import { schedulesChanged } from '../src/hooks/use-schedules';
import { useChatStore } from '../src/store/chat-store';
import type { ChatMessage, User } from '../src/types';

const REPO_ROOT = resolve(process.cwd(), '../..');
const EFFECTIVE_REPO_ROOT = existsSync(resolve( process.cwd(), 'db/v3'))
  ? process.cwd()
  : REPO_ROOT;

// Ensure Vite's import.meta.url rewrites (base = http://localhost:3000/) resolve to Node file:// URLs for repo files
class ViteFsAwareURL extends NodeURL {
  constructor(input: string | URL, base?: string | URL) {
    if (
      typeof input === 'string' &&
      base &&
      String(base).startsWith('http://localhost:3000') &&
      input.startsWith('/') &&
      !input.startsWith('/api/')
    ) {
      const candidatePath = resolve(EFFECTIVE_REPO_ROOT, input.slice(1));
      if (existsSync(candidatePath)) {
        return pathToFileURL(candidatePath) as this;
      }
    }
    super(input as any, base as any);
  }
}
globalThis.URL = ViteFsAwareURL as unknown as typeof globalThis.URL;
globalThis.URLSearchParams = NodeURLSearchParams as unknown as typeof globalThis.URLSearchParams;

const TZ = 'Asia/Ho_Chi_Minh';
const JWT_SECRET = 'sheets_digest_real_backend_ui_smoke_secret_32_chars';
const NOW = new Date('2026-11-09T01:00:00.000Z');
const CHAT_API_ROOT = '../../chat-api';

describe('Task 7 Real-Backend + Isolated PostgreSQL + React UI Integration Smoke Test', () => {
  const realFetch = globalThis.fetch;
  let createAppFn: any;
  let generateAccessTokenFn: any;
  let MessageRepoCls: any;
  let computeSheetsDigestV1HashFn: any;
  let SHEETS_DELIVERY_UNKNOWN_CONST: string;
  let ScheduleServiceCls: any;
  let createMigratedSchemaFn: any;
  let DIGEST_TEST_ENC_KEY_CONST: string;
  let PERSONAL_A_SPREADSHEET_ID_CONST: string;
  let insertTestSheetsDigestScheduleFn: any;
  let seedSheetsDigestTenantsFn: any;

  let db: any;
  let fixtures: any;
  let messageRepo: any;
  let server: Server | null = null;
  let backendBaseUrl = '';
  let plannedFollowupRuns: string[] = [];

  beforeAll(async () => {
    const appMod = await import(`${CHAT_API_ROOT}/src/app.js`);
    const jwtMod = await import(`${CHAT_API_ROOT}/src/auth/jwt.js`);
    const msgRepoMod = await import(`${CHAT_API_ROOT}/src/db/repositories/message-repo.js`);
    const candidateMod = await import(
      `${CHAT_API_ROOT}/src/services/schedules/sheets-digest-candidate.js`
    );
    const runnerMod = await import(
      `${CHAT_API_ROOT}/src/services/schedules/sheets-digest-runner.js`
    );
    const schedServiceMod = await import(
      `${CHAT_API_ROOT}/src/services/schedules/schedule-service.js`
    );
    const testDbMod = await import(`${CHAT_API_ROOT}/tests/helpers/gmail-test-db.js`);
    const tenantFixturesMod = await import(
      `${CHAT_API_ROOT}/tests/helpers/sheets-digest-tenant-fixtures.js`
    );

    createAppFn = appMod.createApp;
    generateAccessTokenFn = jwtMod.generateAccessToken;
    MessageRepoCls = msgRepoMod.MessageRepo;
    computeSheetsDigestV1HashFn = candidateMod.computeSheetsDigestV1Hash;
    SHEETS_DELIVERY_UNKNOWN_CONST = runnerMod.SHEETS_DELIVERY_UNKNOWN;
    ScheduleServiceCls = schedServiceMod.ScheduleService;
    createMigratedSchemaFn = testDbMod.createMigratedSchema;
    DIGEST_TEST_ENC_KEY_CONST = tenantFixturesMod.DIGEST_TEST_ENC_KEY;
    PERSONAL_A_SPREADSHEET_ID_CONST = tenantFixturesMod.PERSONAL_A_SPREADSHEET_ID;
    insertTestSheetsDigestScheduleFn = tenantFixturesMod.insertTestSheetsDigestSchedule;
    seedSheetsDigestTenantsFn = tenantFixturesMod.seedSheetsDigestTenants;

    db = await createMigratedSchemaFn('sheets_digest_web_real_backend');
    messageRepo = new MessageRepoCls(db.pool);
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>(resolve => server!.close(() => resolve()));
      server = null;
    }
    if (db) {
      await db.close();
    }
  });

  beforeEach(async () => {
    plannedFollowupRuns = [];
    await db.pool.query(
      'TRUNCATE sheets_digest_v2_migration_audit, schedule_runs, schedules, messages, conversations, workspace_members, workspaces, service_credentials CASCADE'
    );
    fixtures = await seedSheetsDigestTenantsFn(db, DIGEST_TEST_ENC_KEY_CONST);
    await db.pool.query(
      "UPDATE service_credentials SET created_at = '2026-11-01T00:00:00.000Z', status_changed_at = NULL"
    );

    const scheduleService = new ScheduleServiceCls({
      pool: db.pool,
      timeZone: TZ,
      credentialRepo: fixtures.credentialRepo,
      encryptionKey: fixtures.encryptionKey,
      mysheetsEnabled: true,
      emitV2: true,
      runner: {
        planNow: async (runId: string) => {
          plannedFollowupRuns.push(runId);
        },
      },
    });

    const app = createAppFn({
      jwtSecret: JWT_SECRET,
      userRepo: db.users,
      workspaceRepo: fixtures.workspaceRepo,
      convRepo: fixtures.convRepo,
      msgRepo: messageRepo,
      chatService: {} as any,
      pool: db.pool,
      schedules: {
        service: scheduleService,
        clock: () => NOW,
        pool: db.pool,
        convRepo: fixtures.convRepo,
      },
    });

    server = createServer(app);
    await new Promise<void>(resolve => {
      server!.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr !== 'object') {
      throw new Error('Failed to bind ephemeral test HTTP server');
    }
    backendBaseUrl = `http://127.0.0.1:${addr.port}`;

    // Forward /api/** calls to the real Express + PostgreSQL server; mock only external Google Sheets API calls
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const rawUrl =
          typeof input === 'string'
            ? input
            : input instanceof NodeURL || input instanceof URL
              ? input.toString()
              : input.url;

        if (rawUrl.startsWith('https://sheets.googleapis.com/')) {
          return new Response(
            JSON.stringify({
              spreadsheetId: PERSONAL_A_SPREADSHEET_ID_CONST,
              properties: { title: fixtures.personalA.spreadsheetTitle },
              sheets: [{ properties: { title: 'KPI Tháng 11' } }],
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }
          );
        }

        if (rawUrl.startsWith('/')) {
          return realFetch(`${backendBaseUrl}${rawUrl}`, init);
        }
        if (rawUrl.startsWith('http://localhost/')) {
          const parsed = new NodeURL(rawUrl);
          return realFetch(`${backendBaseUrl}${parsed.pathname}${parsed.search}`, init);
        }
        return realFetch(input, init);
      }
    );
  });

  afterEach(async () => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
    useChatStore.getState().reset();
    if (server) {
      await new Promise<void>(resolve => server!.close(() => resolve()));
      server = null;
    }
  });

  it('executes full end-to-end journey against real backend + isolated PostgreSQL: reauthorize-preview -> confirm -> resolve-delivery (retry_new_run & mark_sent)', async () => {
    const { personalA } = fixtures;
    vi.spyOn(useSchedulesHook, 'useSchedulesEnabled').mockReturnValue(true);

    // 0. Authenticate personalA.user in localStorage with real signed JWT backed by SessionRepo
    const { accessToken } = generateAccessTokenFn(
      personalA.user,
      JWT_SECRET,
      personalA.user.sid
    );
    window.localStorage.setItem('wap_access_token', accessToken);
    window.localStorage.setItem('wap_refresh_token', 'refresh-token-real-backend');
    const uiUser: User = {
      id: personalA.user.id,
      email: personalA.user.email,
      name: personalA.user.name,
      role: personalA.user.role,
    };
    window.localStorage.setItem('wap_user', JSON.stringify(uiUser));

    // Seed a paused v1 sheets_digest schedule in PostgreSQL
    const recurrence = { type: 'daily' as const, time: '08:00' };
    const v1Config: SheetsDigestConfigV1 = {
      version: 1,
      source: {
        service: 'mysheets',
        credentialId: personalA.mysheetsCred.id,
        email: personalA.email,
        spreadsheetId: PERSONAL_A_SPREADSHEET_ID_CONST,
        spreadsheetTitle: personalA.spreadsheetTitle,
        sheetName: 'KPI Tháng 11',
        tailRows: 20,
      },
      destination: {
        service: 'gmail',
        credentialId: personalA.gmailCred.id,
        recipientEmail: 'cfo@company.example.com',
      },
      includeAiSummary: true,
    };
    const v1Hash = computeSheetsDigestV1HashFn({
      userId: personalA.user.id,
      recurrence,
      config: v1Config,
    });

    const seeded = await insertTestSheetsDigestScheduleFn(db.pool, {
      userId: personalA.user.id,
      convId: personalA.conversation.id,
      name: 'Báo cáo KPI Cá nhân A mỗi sáng',
      request:
        'Đọc bảng Báo cáo KPI Cá nhân A tab KPI Tháng 11 và gửi qua Gmail cho cfo@company.example.com',
      recurrence,
      services: ['mysheets', 'gmail'],
      status: 'paused',
      workspaceMode: 'personal',
      workspaceId: null,
      digestConfig: v1Config as unknown as Record<string, unknown>,
      digestConfigHash: v1Hash,
    });
    await db.pool.query(
      `UPDATE schedules
       SET pause_reason = $2, version = 3
       WHERE id = $1`,
      [
        seeded.id,
        'REAUTH_REQUIRED: Lịch gửi báo cáo Google Sheets tự động thuộc phiên bản cũ (v1). Vui lòng mở lịch và xác nhận lại để tiếp tục chạy tự động.',
      ]
    );

    // =========================================================================
    // STEP 1: reauthorize-preview via <ScheduleSection /> -> real PostgreSQL
    // =========================================================================
    const navigate = vi.fn();
    const sectionView = render(<ScheduleSection user={uiUser} navigate={navigate} />);

    expect(await screen.findByText('Báo cáo KPI Cá nhân A mỗi sáng')).toBeInTheDocument();
    expect(
      screen.getByText(
        /REAUTH_REQUIRED: Lịch gửi báo cáo Google Sheets tự động thuộc phiên bản cũ \(v1\)/
      )
    ).toBeInTheDocument();

    const reauthBtn = screen.getByTestId('btn-reauthorize-schedule-preview');
    fireEvent.click(reauthBtn);

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith(`/c/${personalA.conversation.id}`);
    });

    // Prove real schedule_proposal message was persisted in PostgreSQL messages table
    const msgRows = await db.pool.query(
      `SELECT id, content, metadata
       FROM messages
       WHERE conv_id = $1 AND metadata->>'type' = 'schedule_proposal'
       ORDER BY created_at DESC LIMIT 1`,
      [personalA.conversation.id]
    );
    expect(msgRows.rowCount).toBe(1);
    const persistedProposal = msgRows.rows[0]!;
    expect(persistedProposal.metadata.reauthorize).toBe(true);
    expect(persistedProposal.metadata.scheduleId).toBe(seeded.id);
    expect(persistedProposal.metadata.baseVersion).toBe(3);
    expect(typeof persistedProposal.metadata.expiresAt).toBe('string');
    expect(persistedProposal.metadata.digestCandidate?.config?.version).toBe(2);
    expect(persistedProposal.metadata.digestCandidate?.config?.source?.credentialId).toBe(
      personalA.mysheetsCred.id
    );
    expect(persistedProposal.metadata.digestCandidate?.config?.destination?.credentialId).toBe(
      personalA.gmailCred.id
    );

    sectionView.unmount();
    cleanup();

    // =========================================================================
    // STEP 2: confirm via <ScheduleMoment /> -> real PostgreSQL schedules update
    // =========================================================================
    useChatStore.getState().setConversationId(personalA.conversation.id);
    const convData = await apiClient.getConversation(personalA.conversation.id);
    const proposalMsg = convData.messages.find(m => m.id === persistedProposal.id);
    expect(proposalMsg).toBeDefined();

    const momentView = render(
      <ScheduleMoment
        message={proposalMsg!}
        convId={personalA.conversation.id}
        navigate={navigate}
        onEdit={vi.fn()}
      />
    );

    expect(screen.getByTestId('reauthorize-proposal-banner')).toBeInTheDocument();
    const previewBox = screen.getByTestId('sheets-digest-v2-preview');
    expect(previewBox).toHaveTextContent(personalA.spreadsheetTitle);
    expect(previewBox).toHaveTextContent(personalA.email);
    expect(previewBox).toHaveTextContent('cfo@company.example.com');

    // Never leak raw credential UUIDs in DOM text
    const domText = document.body.textContent ?? '';
    expect(domText).not.toContain(personalA.mysheetsCred.id);
    expect(domText).not.toContain(personalA.gmailCred.id);

    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));

    expect(await screen.findByText(/Đang bật/)).toBeInTheDocument();

    // Verify PostgreSQL schedules row was upgraded to V2 and reactivated
    const schedAfterConfirm = (
      await db.pool.query(
        'SELECT status, pause_reason, version, next_run_at, digest_config FROM schedules WHERE id = $1',
        [seeded.id]
      )
    ).rows[0]!;
    expect(schedAfterConfirm.status).toBe('active');
    expect(schedAfterConfirm.pause_reason).toBeNull();
    expect(schedAfterConfirm.version).toBe(4);
    expect(schedAfterConfirm.next_run_at).not.toBeNull();
    expect(schedAfterConfirm.digest_config?.version).toBe(2);

    momentView.unmount();
    cleanup();

    // =========================================================================
    // STEP 3: resolve-delivery recovery API -> persisted DB state -> UI refresh
    // =========================================================================
    const runConv1 = await fixtures.convRepo.createConversation(
      personalA.user.id,
      'Lượt chạy cần kiểm tra 1',
      { workspaceMode: 'personal', workspaceId: null }
    );
    const runConv2 = await fixtures.convRepo.createConversation(
      personalA.user.id,
      'Lượt chạy cần kiểm tra 2',
      { workspaceMode: 'personal', workspaceId: null }
    );

    // Insert Run 2 (older) and Run 1 (latest, so schedule.lastRun points to Run 1)
    const run2Insert = await db.pool.query(
      `INSERT INTO schedule_runs (
         schedule_id, schedule_version, trigger, due_at, created_at, status, conv_id, error, delivery_started_at
       )
       VALUES ($1, 4, 'scheduled', $2, $3, 'needs_attention', $4, $5, $6)
       RETURNING id, due_at`,
      [
        seeded.id,
        new Date('2026-11-09T00:00:00.000Z'),
        new Date('2026-11-09T00:00:02.000Z'),
        runConv2.id,
        `${SHEETS_DELIVERY_UNKNOWN_CONST}: Mất kết nối sau khi gửi lượt 2.`,
        new Date('2026-11-09T00:00:05.000Z'),
      ]
    );
    const run2Id = run2Insert.rows[0]!.id as string;

    const run1Insert = await db.pool.query(
      `INSERT INTO schedule_runs (
         schedule_id, schedule_version, trigger, due_at, created_at, status, conv_id, error, delivery_started_at
       )
       VALUES ($1, 4, 'scheduled', $2, $3, 'needs_attention', $4, $5, $6)
       RETURNING id, due_at`,
      [
        seeded.id,
        new Date('2026-11-09T00:30:00.000Z'),
        new Date('2026-11-09T00:30:02.000Z'),
        runConv1.id,
        `${SHEETS_DELIVERY_UNKNOWN_CONST}: Mất kết nối sau khi gửi lượt 1.`,
        new Date('2026-11-09T00:30:05.000Z'),
      ]
    );
    const run1Id = run1Insert.rows[0]!.id as string;

    // Part 3A: Resolve Run 1 with retry_new_run via <ScheduleSection />
    const recoverySectionView = render(<ScheduleSection user={uiUser} navigate={navigate} />);
    schedulesChanged();

    const recoveryPanel1 = await screen.findByTestId('sheets-delivery-recovery-panel');
    expect(recoveryPanel1).toBeInTheDocument();

    const retryBtn = screen.getByTestId('btn-resolve-retry-new-run');
    const dupCheckbox = screen.getByTestId('checkbox-confirm-duplicate-risk') as HTMLInputElement;
    expect(retryBtn).toBeDisabled();

    fireEvent.click(dupCheckbox);
    expect(retryBtn).toBeEnabled();
    fireEvent.click(retryBtn);

    const badge1 = await screen.findByTestId('delivery-resolution-badge');
    expect(badge1).toHaveAttribute('data-resolution', 'retried_new_run');
    expect(badge1).toHaveTextContent('Đã tạo lượt gửi bù mới');

    // Query PostgreSQL schedule_runs directly to verify Run 1 resolution and follow-up run row
    const run1Db = (
      await db.pool.query(
        `SELECT status, delivery_resolution, delivery_resolved_by, delivery_resolved_at, delivery_followup_run_id
         FROM schedule_runs WHERE id = $1`,
        [run1Id]
      )
    ).rows[0]!;
    expect(run1Db.delivery_resolution).toBe('retried_new_run');
    expect(run1Db.delivery_resolved_by).toBe(personalA.user.id);
    expect(run1Db.delivery_resolved_at).not.toBeNull();
    expect(run1Db.delivery_followup_run_id).not.toBeNull();

    const followUpDb = await db.pool.query(
      'SELECT id, trigger, status FROM schedule_runs WHERE id = $1',
      [run1Db.delivery_followup_run_id]
    );
    expect(followUpDb.rowCount).toBe(1);
    expect(followUpDb.rows[0]!.trigger).toBe('manual');
    expect(plannedFollowupRuns).toContain(run1Db.delivery_followup_run_id);

    recoverySectionView.unmount();
    cleanup();

    // Part 3B: Resolve Run 2 with mark_sent via <ScheduleRunRecovery />
    useChatStore.getState().setConversationId(runConv2.id);
    const run2Msg: ChatMessage = {
      id: 'msg-run-2-recovery',
      role: 'user',
      content:
        'Đọc bảng Báo cáo KPI Cá nhân A tab KPI Tháng 11 và gửi qua Gmail cho cfo@company.example.com',
      metadata: {
        type: 'schedule_run',
        scheduleId: seeded.id,
        runId: run2Id,
        name: 'Báo cáo KPI Cá nhân A mỗi sáng',
        dueAt: new Date('2026-11-09T00:00:00.000Z').toISOString(),
        trigger: 'scheduled',
      },
    };

    render(<ScheduleRunRecovery message={run2Msg} navigate={navigate} />);

    const recoveryPanel2 = await screen.findByTestId('sheets-delivery-recovery-panel');
    expect(recoveryPanel2).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('btn-resolve-mark-sent'));

    const badge2 = await screen.findByTestId('delivery-resolution-badge');
    expect(badge2).toHaveAttribute('data-resolution', 'confirmed_sent');
    expect(badge2).toHaveTextContent('Đã xác nhận thủ công là đã gửi');

    // Query PostgreSQL schedule_runs directly to verify Run 2 resolution
    const run2Db = (
      await db.pool.query(
        `SELECT status, error, delivery_resolution, delivery_resolved_by, delivery_resolved_at, delivery_followup_run_id
         FROM schedule_runs WHERE id = $1`,
        [run2Id]
      )
    ).rows[0]!;
    expect(run2Db.status).toBe('digest_sent');
    expect(run2Db.error).toBeNull();
    expect(run2Db.delivery_resolution).toBe('confirmed_sent');
    expect(run2Db.delivery_resolved_by).toBe(personalA.user.id);
    expect(run2Db.delivery_resolved_at).not.toBeNull();
    expect(run2Db.delivery_followup_run_id).toBeNull();
  });
});
