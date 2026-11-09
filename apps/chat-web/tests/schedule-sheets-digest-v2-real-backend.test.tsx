/**
 * @vitest-environment jsdom
 *
 * Real-Backend React Integration Smoke Test (React/JSDOM + real Express HTTP backend + isolated PostgreSQL schema).
 * Note: Browser UI E2E with mocked API is covered separately in tests/browser/sheets-digest-v2-recovery.spec.ts.
 */
import '@testing-library/jest-dom/vitest';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import pg from 'pg';
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
const EFFECTIVE_REPO_ROOT = existsSync(resolve(process.cwd(), 'db/v3'))
  ? process.cwd()
  : REPO_ROOT;
const V3_MIGRATIONS_DIR = resolve(EFFECTIVE_REPO_ROOT, 'db/v3');

const TZ = 'Asia/Ho_Chi_Minh';
const JWT_SECRET = 'sheets_digest_real_backend_ui_smoke_secret_32_chars';
const NOW = new Date('2026-11-09T01:00:00.000Z');

// Re-export the real schedule occurrence math directly without loading prompt-file readers from the @wap/planner barrel in JSDOM
vi.mock('@wap/planner', () => import('@wap/planner-schedule-occurrence'));

/**
 * Fail-closed test database URL validator:
 * - No fallback to runtime port 55533 or any implicit connection string.
 * - Rejects missing/empty DATABASE_URL, runtime port 55533, non-loopback hosts,
 *   non-postgres schemes, and non-dedicated database names/ports before any Pool is created.
 * - Never leaks credentials or raw connection strings in error messages.
 */
export function validateTestDatabaseUrl(rawUrl?: string): string {
  const urlString = rawUrl !== undefined ? rawUrl : process.env.DATABASE_URL;
  if (!urlString || urlString.trim() === '') {
    throw new Error(
      'DATABASE_URL is required; dedicated test connection must be explicitly configured.'
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error('Invalid DATABASE_URL format: unable to parse connection URL.');
  }

  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error('Invalid DATABASE_URL protocol: must be postgres: or postgresql:.');
  }

  if (parsed.port === '55533') {
    throw new Error(
      'DATABASE_URL on port 55533 is strictly forbidden for tests (runtime database port).'
    );
  }

  const isLoopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname);
  if (!isLoopback) {
    throw new Error(
      `DATABASE_URL host must be localhost or loopback (127.0.0.1), got "${parsed.hostname}".`
    );
  }

  const isDedicatedDbName = parsed.pathname === '/ati_v3' || parsed.pathname === '/ati_v3/';
  const isCI = process.env.CI === 'true' || process.env.CI === '1';
  const isCIAllowed =
    isCI && (parsed.port === '5432' || parsed.port === '') && isDedicatedDbName;
  const isLocalDedicatedAllowed = parsed.port === '56534' && isDedicatedDbName;

  if (!isCIAllowed && !isLocalDedicatedAllowed) {
    throw new Error(
      `Dedicated test database required: localhost:56534/ati_v3 for local tests (or loopback:5432/ati_v3 when CI=true). Received port "${parsed.port}" and pathname "${parsed.pathname}".`
    );
  }

  return urlString;
}

async function createIsolatedMigratedSchema(
  prefix: string,
  UserRepoCls: any,
  options?: { rawUrl?: string; migrationsDir?: string }
) {
  if (!/^[a-z][a-z0-9_]{0,30}$/.test(prefix)) {
    throw new Error(`Invalid schema prefix: ${prefix}`);
  }

  const connectionString = validateTestDatabaseUrl(options?.rawUrl);
  const ownedSchema = `${prefix}_${randomUUID().replaceAll('-', '')}`;
  if (!/^[a-z][a-z0-9_]{0,30}_[0-9a-f]{32}$/.test(ownedSchema)) {
    throw new Error(`Generated schema identifier is invalid: ${ownedSchema}`);
  }

  const admin = new pg.Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 5000,
  });

  let schemaCreated = false;
  let pool: pg.Pool | null = null;

  try {
    await admin.query(`CREATE SCHEMA "${ownedSchema}"`);
    schemaCreated = true;

    const url = new URL(connectionString);
    url.searchParams.set('options', `-c search_path=${ownedSchema}`);
    pool = new pg.Pool({
      connectionString: url.href,
      max: 10,
      connectionTimeoutMillis: 5000,
    });

    const migrationsDir = options?.migrationsDir ?? V3_MIGRATIONS_DIR;
    const migrationFiles = (await readdir(migrationsDir))
      .filter(f => /^\d{4}_.*\.sql$/.test(f))
      .sort();
    for (const file of migrationFiles) {
      const sql = await readFile(resolve(migrationsDir, file), 'utf8');
      await pool.query(sql);
    }

    const activePool = pool;
    const users = new UserRepoCls(activePool);
    return {
      schema: ownedSchema,
      pool: activePool,
      users,
      async person(name = 'Thành viên') {
        const user = await users.createUser({
          email: `${randomUUID()}@example.test`,
          name,
          password: 'Passw0rd!long-enough',
        });
        await activePool.query(
          "UPDATE users SET status='active', email_verified=true WHERE id=$1",
          [user.id]
        );
        const { sessionId } = await users.sessions.create(user.id, 'test');
        return { id: user.id, email: user.email, name, role: 'member' as const, sid: sessionId };
      },
      async close() {
        try {
          await activePool.end();
        } catch {
          // Ignore pool close error during teardown so schema drop still executes
        }
        try {
          if (/^[a-z][a-z0-9_]{0,30}_[0-9a-f]{32}$/.test(ownedSchema)) {
            await admin.query(`DROP SCHEMA IF EXISTS "${ownedSchema}" CASCADE`);
          }
        } finally {
          await admin.end();
        }
      },
    };
  } catch (setupErr) {
    if (pool) {
      try {
        await pool.end();
      } catch {
        // Ignore pool termination error during failed setup cleanup
      }
    }
    try {
      if (schemaCreated && /^[a-z][a-z0-9_]{0,30}_[0-9a-f]{32}$/.test(ownedSchema)) {
        await admin.query(`DROP SCHEMA IF EXISTS "${ownedSchema}" CASCADE`);
      }
    } catch {
      // Ignore drop error during failed setup cleanup
    } finally {
      try {
        await admin.end();
      } catch {
        // Ignore admin pool termination error
      }
    }
    throw setupErr;
  }
}

describe('Task 7 Real-Backend React Integration Smoke Test (React/JSDOM + Real Express HTTP + Isolated PostgreSQL)', () => {
  const realFetch = globalThis.fetch;
  let expressFn: any;
  let createAuthMiddlewareFn: any;
  let createWorkspaceContextMiddlewareFn: any;
  let createScheduleRoutesFn: any;
  let isSchedulePathFn: any;
  let createConversationRoutesFn: any;
  let userFacingErrorFn: any;
  let generateAccessTokenFn: any;
  let MessageRepoCls: any;
  let UserRepoCls: any;
  let computeSheetsDigestV1HashFn: any;
  let SHEETS_DELIVERY_UNKNOWN_CONST: string;
  let ScheduleServiceCls: any;
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
    const expressMod = await import('express');
    const jwtMod = await import('@wap/chat-api/src/auth/jwt.js');
    const wsMiddlewareMod = await import('@wap/chat-api/src/middleware/workspace-context.js');
    const schedRoutesMod = await import('@wap/chat-api/src/routes/schedule-routes.js');
    const convRoutesMod = await import('@wap/chat-api/src/routes/conversation-routes.js');
    const userErrorMod = await import('@wap/chat-api/src/services/user-facing-error.js');
    const msgRepoMod = await import('@wap/chat-api/src/db/repositories/message-repo.js');
    const userRepoMod = await import('@wap/chat-api/src/db/repositories/user-repo.js');
    const candidateMod = await import(
      '@wap/chat-api/src/services/schedules/sheets-digest-candidate.js'
    );
    const runnerMod = await import(
      '@wap/chat-api/src/services/schedules/sheets-digest-runner.js'
    );
    const schedServiceMod = await import(
      '@wap/chat-api/src/services/schedules/schedule-service.js'
    );
    const tenantFixturesMod = await import(
      '@wap/chat-api/tests/helpers/sheets-digest-tenant-fixtures.js'
    );

    expressFn = expressMod.default;
    createAuthMiddlewareFn = jwtMod.createAuthMiddleware;
    generateAccessTokenFn = jwtMod.generateAccessToken;
    createWorkspaceContextMiddlewareFn = wsMiddlewareMod.createWorkspaceContextMiddleware;
    createScheduleRoutesFn = schedRoutesMod.createScheduleRoutes;
    isSchedulePathFn = schedRoutesMod.isSchedulePath;
    createConversationRoutesFn = convRoutesMod.createConversationRoutes;
    userFacingErrorFn = userErrorMod.userFacingError;
    MessageRepoCls = msgRepoMod.MessageRepo;
    UserRepoCls = userRepoMod.UserRepo;
    computeSheetsDigestV1HashFn = candidateMod.computeSheetsDigestV1Hash;
    SHEETS_DELIVERY_UNKNOWN_CONST = runnerMod.SHEETS_DELIVERY_UNKNOWN;
    ScheduleServiceCls = schedServiceMod.ScheduleService;
    DIGEST_TEST_ENC_KEY_CONST = tenantFixturesMod.DIGEST_TEST_ENC_KEY;
    PERSONAL_A_SPREADSHEET_ID_CONST = tenantFixturesMod.PERSONAL_A_SPREADSHEET_ID;
    insertTestSheetsDigestScheduleFn = tenantFixturesMod.insertTestSheetsDigestSchedule;
    seedSheetsDigestTenantsFn = tenantFixturesMod.seedSheetsDigestTenants;

    db = await createIsolatedMigratedSchema('sheets_digest_web_real_backend', UserRepoCls);
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

  async function setupRealBackendFixtureAndServer() {
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

    const app = expressFn();
    app.use(expressFn.json());
    app.use((_req: any, res: any, next: any) => {
      const json = res.json.bind(res);
      res.json = (body: any) => {
        if (body && typeof body === 'object' && !Array.isArray(body)) {
          if (typeof body.error === 'string') {
            body = { ...body, error: userFacingErrorFn(body.error) };
          }
          if (typeof body.message === 'string' && res.statusCode >= 400) {
            body = { ...body, message: userFacingErrorFn(body.message) };
          }
        }
        return json(body);
      };
      next();
    });

    const authMiddleware = createAuthMiddlewareFn(JWT_SECRET, {
      sessionRepo: db.users.sessions,
    });
    const workspaceContextMiddleware = createWorkspaceContextMiddlewareFn(fixtures.workspaceRepo);
    const withAuthAndWorkspace = (req: any, res: any, next: any) => {
      authMiddleware(req, res, (err?: any) => {
        if (err) return next(err);
        workspaceContextMiddleware(req, res, next);
      });
    };

    app.use(
      '/api',
      (req: any, res: any, next: any) =>
        isSchedulePathFn(req.path) ? withAuthAndWorkspace(req, res, next) : next(),
      createScheduleRoutesFn({
        service: scheduleService,
        clock: () => NOW,
        pool: db.pool,
        convRepo: fixtures.convRepo,
      })
    );
    app.use(
      '/api/conversations',
      withAuthAndWorkspace,
      createConversationRoutesFn({
        convRepo: fixtures.convRepo,
        msgRepo: messageRepo,
        chatService: {} as any,
        pool: db.pool,
      })
    );

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
            : input instanceof URL
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
          const parsed = new URL(rawUrl);
          return realFetch(`${backendBaseUrl}${parsed.pathname}${parsed.search}`, init);
        }
        return realFetch(input, init);
      }
    );
  }

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
    await setupRealBackendFixtureAndServer();
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

    expect(
      await screen.findByText('Báo cáo KPI Cá nhân A mỗi sáng', {}, { timeout: 5000 })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /REAUTH_REQUIRED: Lịch gửi báo cáo Google Sheets tự động thuộc phiên bản cũ \(v1\)/
      )
    ).toBeInTheDocument();

    const reauthBtn = screen.getByTestId('btn-reauthorize-schedule-preview');
    fireEvent.click(reauthBtn);

    await waitFor(
      () => {
        expect(navigate).toHaveBeenCalledWith(`/c/${personalA.conversation.id}`);
      },
      { timeout: 5000 }
    );

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

    expect(await screen.findByText(/Đang bật/, {}, { timeout: 5000 })).toBeInTheDocument();

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

    const recoveryPanel1 = await screen.findByTestId(
      'sheets-delivery-recovery-panel',
      {},
      { timeout: 5000 }
    );
    expect(recoveryPanel1).toBeInTheDocument();

    const retryBtn = screen.getByTestId('btn-resolve-retry-new-run');
    const dupCheckbox = screen.getByTestId('checkbox-confirm-duplicate-risk') as HTMLInputElement;
    expect(retryBtn).toBeDisabled();

    fireEvent.click(dupCheckbox);
    expect(retryBtn).toBeEnabled();
    fireEvent.click(retryBtn);

    const badge1 = await screen.findByTestId('delivery-resolution-badge', {}, { timeout: 5000 });
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

    const recoveryPanel2 = await screen.findByTestId(
      'sheets-delivery-recovery-panel',
      {},
      { timeout: 5000 }
    );
    expect(recoveryPanel2).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('btn-resolve-mark-sent'));

    const badge2 = await screen.findByTestId('delivery-resolution-badge', {}, { timeout: 5000 });
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

  it('rejects missing, runtime-port 55533, remote-host, wrong-database, or non-dedicated DATABASE_URL fail-closed with 0 DB connections and 0 DB mutations', async () => {
    const querySpy = vi.spyOn(pg.Pool.prototype, 'query');
    const origDbUrl = process.env.DATABASE_URL;
    const origCi = process.env.CI;

    try {
      delete process.env.DATABASE_URL;
      delete process.env.CI;

      const invalidCases: Array<{ label: string; rawUrl?: string; ci?: string; expected: RegExp }> = [
        { label: 'missing undefined', rawUrl: undefined, expected: /DATABASE_URL is required/i },
        { label: 'empty string', rawUrl: '', expected: /DATABASE_URL is required/i },
        { label: 'whitespace only', rawUrl: '   ', expected: /DATABASE_URL is required/i },
        {
          label: 'runtime port 55533',
          rawUrl: 'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3',
          expected: /55533.*forbidden/i,
        },
        {
          label: 'remote host',
          rawUrl: 'postgresql://ati_v3:ati_v3_local_only@db.production.example.com:56534/ati_v3',
          expected: /loopback/i,
        },
        {
          label: 'non-loopback LAN IP',
          rawUrl: 'postgresql://ati_v3:ati_v3_local_only@192.168.1.50:56534/ati_v3',
          expected: /loopback/i,
        },
        {
          label: 'wrong database on local test port 56534',
          rawUrl: 'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:56534/ati_prod',
          expected: /Dedicated test database required/i,
        },
        {
          label: 'wrong database on CI port 5432',
          rawUrl: 'postgresql://ati_v3:ati_v3_ci_only@127.0.0.1:5432/ati_prod',
          ci: 'true',
          expected: /Dedicated test database required/i,
        },
        {
          label: 'port 5432 when CI is not enabled',
          rawUrl: 'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:5432/ati_v3',
          expected: /56534/i,
        },
        {
          label: 'invalid scheme',
          rawUrl: 'http://127.0.0.1:56534/ati_v3',
          expected: /postgres/i,
        },
      ];

      for (const tc of invalidCases) {
        if (tc.ci !== undefined) {
          process.env.CI = tc.ci;
        } else {
          delete process.env.CI;
        }
        expect(() => validateTestDatabaseUrl(tc.rawUrl), tc.label).toThrow(tc.expected);
        await expect(
          createIsolatedMigratedSchema('should_not_connect', UserRepoCls, { rawUrl: tc.rawUrl }),
          tc.label
        ).rejects.toThrow(tc.expected);
      }

      // Malformed URL with secret credentials must never leak credentials in error message
      const secretPw = 'top_secret_db_password_987654';
      try {
        validateTestDatabaseUrl(`postgresql://dbadmin:${secretPw}@invalid-host:notaport/ati_v3`);
        expect.unreachable('Expected malformed URL to throw');
      } catch (err: any) {
        expect(String(err?.message ?? err)).not.toContain(secretPw);
        expect(String(err?.message ?? err)).not.toContain('dbadmin');
      }

      // Invalid schema prefix must also be rejected before any DB connection
      await expect(
        createIsolatedMigratedSchema('bad-prefix; DROP SCHEMA public;', UserRepoCls, {
          rawUrl: 'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:56534/ati_v3',
        })
      ).rejects.toThrow(/Invalid schema prefix/i);

      // Prove 0 PostgreSQL queries / connections were issued across all rejected invocations
      expect(querySpy).toHaveBeenCalledTimes(0);
    } finally {
      querySpy.mockRestore();
      if (origDbUrl !== undefined) {
        process.env.DATABASE_URL = origDbUrl;
      } else {
        delete process.env.DATABASE_URL;
      }
      if (origCi !== undefined) {
        process.env.CI = origCi;
      } else {
        delete process.env.CI;
      }
    }
  });

  it('cleans up the newly created schema when migration fails mid-way and never drops foreign schemas', async () => {
    const foreignSchema = `foreign_preserved_${randomUUID().replaceAll('-', '')}`;
    const scratchDir = await mkdtemp(join(tmpdir(), 'ati-sheets-digest-mig-fail-'));

    await db.pool.query(`CREATE SCHEMA "${foreignSchema}"`);
    await db.pool.query(`CREATE TABLE "${foreignSchema}".sentinel (id int PRIMARY KEY)`);
    await db.pool.query(`INSERT INTO "${foreignSchema}".sentinel (id) VALUES (42)`);

    try {
      // Write a valid 0001 migration followed by a broken 0002 migration
      await writeFile(
        join(scratchDir, '0001_valid.sql'),
        'CREATE TABLE partial_migration_probe (id serial PRIMARY KEY);',
        'utf8'
      );
      await writeFile(
        join(scratchDir, '0002_broken.sql'),
        'SELECT * FROM table_that_does_not_exist_999999;',
        'utf8'
      );

      const failedPrefix = `mig_fail_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
      await expect(
        createIsolatedMigratedSchema(failedPrefix, UserRepoCls, { migrationsDir: scratchDir })
      ).rejects.toThrow(/table_that_does_not_exist_999999/i);

      // Prove the partially migrated schema was automatically dropped during error cleanup
      const leakedSchemas = await db.pool.query(
        `SELECT schema_name
         FROM information_schema.schemata
         WHERE schema_name LIKE $1`,
        [`${failedPrefix}_%`]
      );
      expect(leakedSchemas.rowCount).toBe(0);

      // Prove the foreign schema and its data remain 100% untouched
      const foreignCheck = await db.pool.query(`SELECT id FROM "${foreignSchema}".sentinel`);
      expect(foreignCheck.rows).toEqual([{ id: 42 }]);
    } finally {
      await db.pool.query(`DROP SCHEMA IF EXISTS "${foreignSchema}" CASCADE`);
      await rm(scratchDir, { recursive: true, force: true });
    }
  });
});
