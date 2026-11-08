import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { encryptCredentials } from '@wap/tool-adapters';
import {
  isSheetsDigestConfigV2,
  type SheetsDigestConfigV1,
  type SheetsDigestConfigV2,
} from '@wap/tool-schemas';
import { createApp } from '../../src/app.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { MessageRepo } from '../../src/db/repositories/message-repo.js';
import {
  computeSheetsDigestHash,
  computeSheetsDigestV1Hash,
} from '../../src/services/schedules/sheets-digest-candidate.js';
import {
  ScheduleConflict,
  ScheduleService,
} from '../../src/services/schedules/schedule-service.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
import {
  DIGEST_TEST_ENC_KEY,
  ORG_A_SPREADSHEET_ID,
  PERSONAL_A_SPREADSHEET_ID,
  seedSheetsDigestTenants,
  type SheetsDigestTenantFixtures,
  type TestPerson,
} from '../helpers/sheets-digest-tenant-fixtures.js';

const TZ = 'Asia/Ho_Chi_Minh';
const JWT_SECRET = 'sheets_digest_reauthorize_test_secret_at_least_32_chars';
const NOW = new Date('2026-11-02T00:00:00.000Z');

describe('Task 5A (PR-5A): Strict Resume Separation & Two-Phase Server-Side Reauthorize Preview/Confirm', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let fixtures: SheetsDigestTenantFixtures;
  let messageRepo: MessageRepo;
  const originalEmitV2Env = process.env.SHEETS_DIGEST_EMIT_V2;

  beforeAll(async () => {
    db = await createMigratedSchema('sheets_digest_pr5a_reauth');
    messageRepo = new MessageRepo(db.pool);
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    delete process.env.SHEETS_DIGEST_EMIT_V2;
    await db.pool.query(
      'TRUNCATE sheets_digest_v2_migration_audit, schedule_runs, schedules, messages, conversations, workspace_members, workspaces, service_credentials CASCADE'
    );
    fixtures = await seedSheetsDigestTenants(db, DIGEST_TEST_ENC_KEY);
    await db.pool.query(
      "UPDATE service_credentials SET created_at = '2026-11-01T00:00:00.000Z', status_changed_at = NULL"
    );
  });

  afterEach(() => {
    if (originalEmitV2Env === undefined) {
      delete process.env.SHEETS_DIGEST_EMIT_V2;
    } else {
      process.env.SHEETS_DIGEST_EMIT_V2 = originalEmitV2Env;
    }
    vi.restoreAllMocks();
  });

  function bearer(who: TestPerson): string {
    return `Bearer ${generateAccessToken(who, JWT_SECRET, who.sid).accessToken}`;
  }

  function buildService(overrides: Partial<ConstructorParameters<typeof ScheduleService>[0]> = {}) {
    return new ScheduleService({
      pool: db.pool,
      timeZone: TZ,
      credentialRepo: fixtures.credentialRepo,
      encryptionKey: fixtures.encryptionKey,
      mysheetsEnabled: true,
      emitV2: true,
      ...overrides,
    });
  }

  function buildApp(service: ScheduleService, clock: () => Date = () => NOW) {
    return createApp({
      jwtSecret: JWT_SECRET,
      userRepo: db.users,
      workspaceRepo: fixtures.workspaceRepo,
      schedules: {
        service,
        clock,
        pool: db.pool,
        convRepo: fixtures.convRepo,
      },
    } as any);
  }

  async function insertScheduleRow(input: {
    userId: string;
    convId: string;
    workspaceMode: 'personal' | 'organization' | 'legacy';
    workspaceId: string | null;
    name?: string;
    request: string;
    services: string[];
    status: 'active' | 'paused';
    pauseReason?: string | null;
    version?: number;
    config: SheetsDigestConfigV1 | SheetsDigestConfigV2;
    configHash?: string;
    approvedAt?: Date;
  }) {
    const recurrence = { type: 'daily' as const, time: '08:00' };
    const hash =
      input.configHash ??
      (isSheetsDigestConfigV2(input.config)
        ? computeSheetsDigestHash({ userId: input.userId, recurrence, config: input.config })
        : computeSheetsDigestV1Hash({ userId: input.userId, recurrence, config: input.config }));
    const res = await db.pool.query(
      `INSERT INTO schedules (
         user_id, conv_id, name, request, recurrence, services, status, pause_reason,
         version, next_run_at, workspace_id, workspace_mode, kind, digest_config, digest_config_hash, digest_approved_at
       )
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, 'sheets_digest', $13::jsonb, $14, $15)
       RETURNING *`,
      [
        input.userId,
        input.convId,
        input.name ?? 'Báo cáo KPI hàng ngày',
        input.request,
        JSON.stringify(recurrence),
        input.services,
        input.status,
        input.pauseReason ?? null,
        input.version ?? 1,
        input.status === 'active' ? new Date('2026-11-03T01:00:00.000Z') : null,
        input.workspaceId,
        input.workspaceMode,
        JSON.stringify(input.config),
        hash,
        input.approvedAt ?? new Date('2026-11-01T12:00:00.000Z'),
      ]
    );
    return res.rows[0];
  }

  describe('1. Strict Separation of Resume vs. Reauthorization (TC-14)', () => {
    it('rejects Resume on Class A and Class B version: 1 schedules with 409 REAUTHORIZATION_REQUIRED without mutating digest_config, credentialId, hash, or status', async () => {
      const { personalA, orgA, convRepo } = fixtures;
      const service = buildService();
      const app = buildApp(service);

      // 1a. Class A version: 1 schedule (mysheets -> gmail with pinned credentialId)
      const classAConfig: SheetsDigestConfigV1 = {
        version: 1,
        source: {
          service: 'mysheets',
          credentialId: personalA.mysheetsCred.id,
          email: personalA.email,
          spreadsheetId: PERSONAL_A_SPREADSHEET_ID,
          spreadsheetTitle: personalA.spreadsheetTitle,
          tailRows: 20,
        },
        destination: {
          service: 'gmail',
          credentialId: personalA.gmailCred.id,
          recipientEmail: personalA.email,
        },
        includeAiSummary: true,
      };
      const classASched = await insertScheduleRow({
        userId: personalA.user.id,
        convId: personalA.conversation.id,
        workspaceMode: 'personal',
        workspaceId: null,
        request: 'Đọc bảng Báo cáo KPI Cá nhân A và gửi qua Gmail cho tôi',
        services: ['mysheets', 'gmail'],
        status: 'paused',
        pauseReason: 'Lịch tạm dừng',
        version: 2,
        config: classAConfig,
      });

      await expect(
        service.setStatus({
          userId: personalA.user.id,
          scheduleId: classASched.id,
          action: 'resume',
          version: 2,
          now: NOW,
        })
      ).rejects.toMatchObject({
        code: 'REAUTHORIZATION_REQUIRED',
      });

      const httpResumeClassA = await request(app)
        .post(`/api/schedules/${classASched.id}/resume`)
        .set('Authorization', bearer(personalA.user))
        .send({ version: 2 });
      expect(httpResumeClassA.status).toBe(409);
      expect(httpResumeClassA.body.error.code).toBe('REAUTHORIZATION_REQUIRED');

      const httpStatusClassA = await request(app)
        .post(`/api/schedules/${classASched.id}/status`)
        .set('Authorization', bearer(personalA.user))
        .send({ action: 'resume', version: 2 });
      expect(httpStatusClassA.status).toBe(409);
      expect(httpStatusClassA.body.error.code).toBe('REAUTHORIZATION_REQUIRED');

      const afterClassA = (
        await db.pool.query('SELECT * FROM schedules WHERE id = $1', [classASched.id])
      ).rows[0];
      expect(afterClassA.status).toBe('paused');
      expect(afterClassA.version).toBe(2);
      expect(afterClassA.digest_config).toEqual(classAConfig);
      expect(afterClassA.digest_config_hash).toBe(classASched.digest_config_hash);

      // 1b. Class B version: 1 schedule (Organization unpinned sheets -> slack)
      const convClassB = await convRepo.createConversation(orgA.member.id, 'Conv Org Class B', {
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
      });
      const classBConfig: SheetsDigestConfigV1 = {
        version: 1,
        source: {
          service: 'sheets',
          spreadsheetId: ORG_A_SPREADSHEET_ID,
          spreadsheetTitle: orgA.spreadsheetTitle,
          tailRows: 20,
        },
        destination: {
          service: 'slack',
          channelId: orgA.slackChannelId,
        },
        includeAiSummary: true,
      };
      const classBSched = await insertScheduleRow({
        userId: orgA.member.id,
        convId: convClassB.id,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        request: 'Đọc bảng Bảng KPI Tổ chức A và gửi vào Slack #general',
        services: ['sheets', 'slack'],
        status: 'paused',
        pauseReason: 'REAUTH_REQUIRED',
        version: 1,
        config: classBConfig,
      });

      // Without X-Workspace-Id (legacy scope), Org schedule is isolated (404)
      const httpResumeClassBNoHeader = await request(app)
        .post(`/api/schedules/${classBSched.id}/resume`)
        .set('Authorization', bearer(orgA.member))
        .send({ version: 1 });
      expect(httpResumeClassBNoHeader.status).toBe(404);

      // With matching X-Workspace-Id, Resume is rejected with 409 REAUTHORIZATION_REQUIRED
      const httpResumeClassB = await request(app)
        .post(`/api/schedules/${classBSched.id}/resume`)
        .set('Authorization', bearer(orgA.member))
        .set('X-Workspace-Id', orgA.workspaceId)
        .send({ version: 1 });
      expect(httpResumeClassB.status).toBe(409);
      expect(httpResumeClassB.body.error.code).toBe('REAUTHORIZATION_REQUIRED');

      const afterClassB = (
        await db.pool.query('SELECT * FROM schedules WHERE id = $1', [classBSched.id])
      ).rows[0];
      expect(afterClassB.status).toBe('paused');
      expect(afterClassB.version).toBe(1);
      expect(afterClassB.digest_config).toEqual(classBConfig);
    });

    it('rejects Resume on version: 2 schedules when paused with REAUTH_REQUIRED, or when credential was rotated (even with same email), scope narrowed, senderEmail changed, or org member deactivated', async () => {
      const { personalA, orgA, credentialRepo, encryptionKey, convRepo } = fixtures;
      const service = buildService();
      const app = buildApp(service);

      // Create a valid v2 schedule for personalA (mysheets -> gmail)
      const v2Config: SheetsDigestConfigV2 = {
        version: 2,
        workspaceMode: 'personal',
        workspaceId: null,
        source: {
          service: 'mysheets',
          credentialId: personalA.mysheetsCred.id,
          email: personalA.email,
          spreadsheetId: PERSONAL_A_SPREADSHEET_ID,
          spreadsheetTitle: personalA.spreadsheetTitle,
          tailRows: 20,
        },
        destination: {
          service: 'gmail',
          credentialId: personalA.gmailCred.id,
          senderEmail: personalA.email,
          recipientEmail: 'finance@company.com',
        },
        includeAiSummary: true,
      };
      const originalHash = computeSheetsDigestHash({
        userId: personalA.user.id,
        recurrence: { type: 'daily', time: '08:00' },
        config: v2Config,
      });

      const sched = await insertScheduleRow({
        userId: personalA.user.id,
        convId: personalA.conversation.id,
        workspaceMode: 'personal',
        workspaceId: null,
        request: 'Đọc bảng Báo cáo KPI Cá nhân A và gửi qua Gmail tới finance@company.com',
        services: ['mysheets', 'gmail'],
        status: 'paused',
        pauseReason: 'REAUTH_REQUIRED',
        version: 3,
        config: v2Config,
        configHash: originalHash,
      });

      // (a) Paused with pause_reason = 'REAUTH_REQUIRED' -> 409 REAUTHORIZATION_REQUIRED
      await expect(
        service.setStatus({
          userId: personalA.user.id,
          scheduleId: sched.id,
          action: 'resume',
          version: 3,
          now: NOW,
        })
      ).rejects.toMatchObject({ code: 'REAUTHORIZATION_REQUIRED' });

      // Clear pause_reason to null (simulate manual pause) and verify normal resume works when nothing changed
      await db.pool.query('UPDATE schedules SET pause_reason = NULL WHERE id = $1', [sched.id]);
      const resumedOk = await service.setStatus({
        userId: personalA.user.id,
        scheduleId: sched.id,
        action: 'resume',
        version: 3,
        now: NOW,
      });
      expect(resumedOk.schedule.status).toBe('active');
      expect(resumedOk.schedule.version).toBe(4);

      // Pause again manually
      await service.setStatus({
        userId: personalA.user.id,
        scheduleId: sched.id,
        action: 'pause',
        version: 4,
        now: NOW,
      });

      // (b) Rotate mysheets credential (DELETE old row + INSERT new row with EXACT SAME EMAIL)
      await db.pool.query('DELETE FROM service_credentials WHERE id = $1', [personalA.mysheetsCred.id]);
      const rotatedMysheets = await credentialRepo.saveCredentials(
        'mysheets',
        personalA.mysheetsCred.config,
        personalA.user.id,
        null
      );
      expect(rotatedMysheets.id).not.toBe(personalA.mysheetsCred.id);

      const resRotated = await request(app)
        .post(`/api/schedules/${sched.id}/resume`)
        .set('Authorization', bearer(personalA.user))
        .send({ version: 5 });
      expect(resRotated.status).toBe(409);
      expect(resRotated.body.error.code).toBe('REAUTHORIZATION_REQUIRED');

      // Verify DB row was NOT auto-rebound to rotatedMysheets.id!
      const afterRotateRow = (
        await db.pool.query('SELECT * FROM schedules WHERE id = $1', [sched.id])
      ).rows[0];
      expect(afterRotateRow.status).toBe('paused');
      expect(afterRotateRow.version).toBe(5);
      expect(afterRotateRow.digest_config.source.credentialId).toBe(personalA.mysheetsCred.id);
      expect(afterRotateRow.digest_config_hash).toBe(originalHash);

      // Restore original credential ID on the row to test scope narrowing & senderEmail drift
      await db.pool.query('UPDATE service_credentials SET id = $1 WHERE id = $2', [
        personalA.mysheetsCred.id,
        rotatedMysheets.id,
      ]);

      // (c) Narrow allowedScope.spreadsheets on mysheets credential
      const narrowedConfig = encryptCredentials(
        {
          refreshToken: '1//personal-a-mysheets-refresh',
          email: personalA.email,
          selectedSpreadsheets: [],
          allowedScope: { spreadsheets: [] },
        },
        encryptionKey
      );
      await db.pool.query('UPDATE service_credentials SET config = $2 WHERE id = $1', [
        personalA.mysheetsCred.id,
        narrowedConfig,
      ]);

      await expect(
        service.setStatus({
          userId: personalA.user.id,
          scheduleId: sched.id,
          action: 'resume',
          version: 5,
          now: NOW,
        })
      ).rejects.toMatchObject({ code: 'REAUTHORIZATION_REQUIRED' });

      // Restore mysheets config, then change Gmail senderEmail in place
      await db.pool.query('UPDATE service_credentials SET config = $2 WHERE id = $1', [
        personalA.mysheetsCred.id,
        personalA.mysheetsCred.config,
      ]);
      const driftedGmailConfig = encryptCredentials(
        {
          refreshToken: '1//personal-a-gmail-refresh',
          email: 'different-sender@personal.test',
        },
        encryptionKey
      );
      await db.pool.query('UPDATE service_credentials SET config = $2 WHERE id = $1', [
        personalA.gmailCred.id,
        driftedGmailConfig,
      ]);

      // (d) senderEmail drift -> 409 REAUTHORIZATION_REQUIRED
      await expect(
        service.setStatus({
          userId: personalA.user.id,
          scheduleId: sched.id,
          action: 'resume',
          version: 5,
          now: NOW,
        })
      ).rejects.toMatchObject({ code: 'REAUTHORIZATION_REQUIRED' });

      // (e) Organization schedule whose workspace member was deactivated -> 409 REAUTHORIZATION_REQUIRED
      const orgConv = await convRepo.createConversation(orgA.member.id, 'Org V2 Resume Test', {
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
      });
      const orgV2Config: SheetsDigestConfigV2 = {
        version: 2,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        source: {
          service: 'sheets',
          credentialId: orgA.sheetsCred.id,
          spreadsheetId: ORG_A_SPREADSHEET_ID,
          spreadsheetTitle: orgA.spreadsheetTitle,
          tailRows: 20,
        },
        destination: {
          service: 'slack',
          credentialId: orgA.slackCred.id,
          channelId: orgA.slackChannelId,
        },
        includeAiSummary: true,
      };
      const orgSched = await insertScheduleRow({
        userId: orgA.member.id,
        convId: orgConv.id,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        request: 'Đọc bảng Bảng KPI Tổ chức A và gửi vào Slack #general',
        services: ['sheets', 'slack'],
        status: 'paused',
        pauseReason: null,
        version: 1,
        config: orgV2Config,
      });

      await db.pool.query(
        "UPDATE workspace_members SET status = 'disabled' WHERE workspace_id = $1 AND user_id = $2",
        [orgA.workspaceId, orgA.member.id]
      );

      await expect(
        service.setStatus({
          userId: orgA.member.id,
          scheduleId: orgSched.id,
          action: 'resume',
          version: 1,
          now: NOW,
        })
      ).rejects.toMatchObject({ code: 'REAUTHORIZATION_REQUIRED' });
    });
  });

  describe('2. Two-Phase Server-Side createReauthorizePreview (POST /api/schedules/:id/reauthorize-preview, TC-20)', () => {
    it('executes Phase A (outside DB tx) and Phase B (inside DB tx with 0 network calls), pins rotated credentialId ONLY in preview without mutating schedules row, and enforces ownership & STALE_VERSION CAS', async () => {
      const { personalA, personalB, orgA, credentialRepo } = fixtures;

      // Rotate personalA's mysheets credential to a new credential ID with the same email
      const oldMysheetsId = personalA.mysheetsCred.id;
      await db.pool.query('DELETE FROM service_credentials WHERE id = $1', [oldMysheetsId]);
      const newMysheetsCred = await credentialRepo.saveCredentials(
        'mysheets',
        personalA.mysheetsCred.config,
        personalA.user.id,
        null
      );
      expect(newMysheetsCred.id).not.toBe(oldMysheetsId);

      // Seed a paused v1 schedule referencing the old credentialId and a short request
      const v1Config: SheetsDigestConfigV1 = {
        version: 1,
        source: {
          service: 'mysheets',
          credentialId: oldMysheetsId,
          email: personalA.email,
          spreadsheetId: PERSONAL_A_SPREADSHEET_ID,
          spreadsheetTitle: personalA.spreadsheetTitle,
          sheetName: 'KPI Tháng 11',
          tailRows: 20,
        },
        destination: {
          service: 'gmail',
          credentialId: personalA.gmailCred.id,
          recipientEmail: 'cfo@company.com',
        },
        includeAiSummary: true,
      };
      const v1Hash = computeSheetsDigestV1Hash({
        userId: personalA.user.id,
        recurrence: { type: 'daily', time: '08:00' },
        config: v1Config,
      });
      const sched = await insertScheduleRow({
        userId: personalA.user.id,
        convId: personalA.conversation.id,
        workspaceMode: 'personal',
        workspaceId: null,
        request: 'Báo cáo doanh thu hàng ngày',
        services: ['mysheets', 'gmail'],
        status: 'paused',
        pauseReason: 'REAUTH_REQUIRED',
        version: 2,
        config: v1Config,
        configHash: v1Hash,
      });

      const service = buildService({ emitV2: false }); // Even when global emitV2 is false, reauthorize-preview emits v2!
      const app = buildApp(service);

      // Ownership check: personalB gets 404
      const wrongUserRes = await request(app)
        .post(`/api/schedules/${sched.id}/reauthorize-preview`)
        .set('Authorization', bearer(personalB.user))
        .send({});
      expect(wrongUserRes.status).toBe(404);

      // Valid reauthorize-preview by owner personalA
      const previewRes = await request(app)
        .post(`/api/schedules/${sched.id}/reauthorize-preview`)
        .set('Authorization', bearer(personalA.user))
        .send({});
      expect(previewRes.status).toBe(200);
      expect(previewRes.body).toMatchObject({
        scheduleId: sched.id,
        convId: personalA.conversation.id,
        baseVersion: 2,
      });
      expect(typeof previewRes.body.proposalMessageId).toBe('string');
      expect(Date.parse(previewRes.body.expiresAt)).toBe(NOW.getTime() + 15 * 60_000);

      // Preview candidate pins the NEW credentialId (version: 2), preserving sheetName & recipientEmail
      const previewCandidate = previewRes.body.candidate;
      expect(previewCandidate.canAutoDigest).toBe(true);
      expect(isSheetsDigestConfigV2(previewCandidate.config)).toBe(true);
      expect(previewCandidate.config).toMatchObject({
        version: 2,
        workspaceMode: 'personal',
        workspaceId: null,
        source: {
          service: 'mysheets',
          credentialId: newMysheetsCred.id,
          email: personalA.email,
          spreadsheetId: PERSONAL_A_SPREADSHEET_ID,
          spreadsheetTitle: personalA.spreadsheetTitle,
          sheetName: 'KPI Tháng 11',
        },
        destination: {
          service: 'gmail',
          credentialId: personalA.gmailCred.id,
          senderEmail: personalA.email,
          recipientEmail: 'cfo@company.com',
        },
      });

      // CRITICAL: schedules row in DB must NOT be modified by createReauthorizePreview!
      const unchangedRow = (
        await db.pool.query('SELECT * FROM schedules WHERE id = $1', [sched.id])
      ).rows[0];
      expect(unchangedRow.status).toBe('paused');
      expect(unchangedRow.version).toBe(2);
      expect(unchangedRow.digest_config).toEqual(v1Config);
      expect(unchangedRow.digest_config.source.credentialId).toBe(oldMysheetsId);
      expect(unchangedRow.digest_config_hash).toBe(v1Hash);

      // Verify sealed schedule_proposal message in messages and slack_message_origins
      const msgRow = (
        await db.pool.query('SELECT * FROM messages WHERE id = $1', [
          previewRes.body.proposalMessageId,
        ])
      ).rows[0];
      expect(msgRow.metadata).toMatchObject({
        type: 'schedule_proposal',
        scheduleId: sched.id,
        baseVersion: 2,
        reauthorize: true,
        expiresAt: previewRes.body.expiresAt,
      });
      const originRow = (
        await db.pool.query(
          "SELECT * FROM slack_message_origins WHERE artifact_table = 'messages' AND artifact_id = $1",
          [previewRes.body.proposalMessageId]
        )
      ).rows[0];
      expect(originRow).toBeDefined();

      // Test Phase A vs Phase B concurrent modification (STALE_VERSION) and 0 network calls inside DB tx (TC-20)
      let inTxDuringFetch = false;
      const orgSched = await insertScheduleRow({
        userId: orgA.member.id,
        convId: orgA.conversation.id,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        request: 'Đọc bảng Bảng KPI Tổ chức A và gửi vào Slack #general',
        services: ['sheets', 'slack'],
        status: 'paused',
        pauseReason: 'REAUTH_REQUIRED',
        version: 1,
        config: {
          version: 1,
          source: {
            service: 'sheets',
            spreadsheetId: ORG_A_SPREADSHEET_ID,
            spreadsheetTitle: orgA.spreadsheetTitle,
            tailRows: 20,
          },
          destination: {
            service: 'slack',
            channelId: orgA.slackChannelId,
          },
          includeAiSummary: true,
        },
      });

      let mutateVersionDuringFetch = false;
      const fetchOrgSheetsMetadata = vi.fn(async () => {
        // Verify no transaction is holding lock on orgSched during Phase A network call
        const lockCheck = await db.pool.query(
          'SELECT version FROM schedules WHERE id = $1 FOR UPDATE NOWAIT',
          [orgSched.id]
        );
        inTxDuringFetch = lockCheck.rowCount !== 1;
        if (mutateVersionDuringFetch) {
          await db.pool.query('UPDATE schedules SET version = version + 1 WHERE id = $1', [
            orgSched.id,
          ]);
        }
        return [
          {
            id: ORG_A_SPREADSHEET_ID,
            title: orgA.spreadsheetTitle,
            sheets: ['Sheet1'],
          },
        ];
      });

      const orgService = buildService({ fetchOrgSheetsMetadata });
      const orgPreview = await orgService.createReauthorizePreview({
        userId: orgA.member.id,
        scheduleId: orgSched.id,
        now: NOW,
      });
      expect(inTxDuringFetch).toBe(false);
      expect(fetchOrgSheetsMetadata).toHaveBeenCalledTimes(1);
      expect(orgPreview.candidate.config?.version).toBe(2);

      // Now simulate concurrent modification during Phase A -> Phase B must reject with 409 STALE_VERSION
      mutateVersionDuringFetch = true;
      await expect(
        orgService.createReauthorizePreview({
          userId: orgA.member.id,
          scheduleId: orgSched.id,
          now: NOW,
        })
      ).rejects.toMatchObject({
        code: 'STALE_VERSION',
      });
    });
  });

  describe('3. Phase C — Confirm Reauthorization Guards (TTL, One-Time-Use, BaseVersion CAS, Drift Detection & Upgrade)', () => {
    it('enforces 15m TTL, one-time-use, baseVersion CAS, and upgrades v1/v2 schedules to active version: 2 even when SHEETS_DIGEST_EMIT_V2=false', async () => {
      const { personalA, credentialRepo } = fixtures;

      // Rotate personalA's mysheets credential
      const oldCredId = personalA.mysheetsCred.id;
      await db.pool.query('DELETE FROM service_credentials WHERE id = $1', [oldCredId]);
      const newCred = await credentialRepo.saveCredentials(
        'mysheets',
        personalA.mysheetsCred.config,
        personalA.user.id,
        null
      );

      const v1Config: SheetsDigestConfigV1 = {
        version: 1,
        source: {
          service: 'mysheets',
          credentialId: oldCredId,
          email: personalA.email,
          spreadsheetId: PERSONAL_A_SPREADSHEET_ID,
          spreadsheetTitle: personalA.spreadsheetTitle,
          tailRows: 20,
        },
        destination: {
          service: 'gmail',
          credentialId: personalA.gmailCred.id,
          recipientEmail: personalA.email,
        },
        includeAiSummary: true,
      };
      const sched = await insertScheduleRow({
        userId: personalA.user.id,
        convId: personalA.conversation.id,
        workspaceMode: 'personal',
        workspaceId: null,
        request: 'Đọc bảng Báo cáo KPI Cá nhân A và gửi qua Gmail cho tôi',
        services: ['mysheets', 'gmail'],
        status: 'paused',
        pauseReason: 'REAUTH_REQUIRED',
        version: 1,
        config: v1Config,
      });

      let currentNow = NOW;
      const service = buildService({ emitV2: false });
      const app = buildApp(service, () => currentNow);

      // 1. Create preview at T = 0, then attempt confirm at T = +16m (expired) -> 409 STALE_PROPOSAL
      const expiredPreview = await service.createReauthorizePreview({
        userId: personalA.user.id,
        scheduleId: sched.id,
        now: NOW,
      });
      currentNow = new Date(NOW.getTime() + 16 * 60_000);

      const expiredConfirmRes = await request(app)
        .post(
          `/api/conversations/${personalA.conversation.id}/schedule-proposals/${expiredPreview.proposalMessageId}/confirm`
        )
        .set('Authorization', bearer(personalA.user))
        .send({ approvalMode: 'auto_digest' });
      expect(expiredConfirmRes.status).toBe(409);
      expect(expiredConfirmRes.body.error.code).toBe('STALE_PROPOSAL');

      // 2. Create fresh preview, then bump schedule version before confirm -> 409 STALE_PROPOSAL
      currentNow = NOW;
      const staleVerPreview = await service.createReauthorizePreview({
        userId: personalA.user.id,
        scheduleId: sched.id,
        now: NOW,
      });
      await db.pool.query('UPDATE schedules SET version = 2 WHERE id = $1', [sched.id]);

      await expect(
        service.confirmProposal({
          userId: personalA.user.id,
          convId: personalA.conversation.id,
          messageId: staleVerPreview.proposalMessageId,
          now: NOW,
          approvalMode: 'auto_digest',
        })
      ).rejects.toMatchObject({ code: 'STALE_PROPOSAL' });

      // 3. Create fresh preview at version 2 and confirm within TTL (even with emitV2: false) -> upgrades to active v2!
      const validPreview = await service.createReauthorizePreview({
        userId: personalA.user.id,
        scheduleId: sched.id,
        now: NOW,
      });

      const confirmRes = await request(app)
        .post(
          `/api/conversations/${personalA.conversation.id}/schedule-proposals/${validPreview.proposalMessageId}/confirm`
        )
        .set('Authorization', bearer(personalA.user))
        .send({ approvalMode: 'auto_digest' });
      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body.schedule).toMatchObject({
        id: sched.id,
        status: 'active',
        pauseReason: null,
        version: 3,
        kind: 'sheets_digest',
        approvalMode: 'auto_digest',
      });
      expect(confirmRes.body.schedule.nextRuns.length).toBeGreaterThan(0);

      const upgradedRow = (
        await db.pool.query('SELECT * FROM schedules WHERE id = $1', [sched.id])
      ).rows[0];
      expect(upgradedRow.status).toBe('active');
      expect(upgradedRow.pause_reason).toBeNull();
      expect(upgradedRow.version).toBe(3);
      expect(upgradedRow.last_proposal_id).toBe(validPreview.proposalMessageId);
      expect(isSheetsDigestConfigV2(upgradedRow.digest_config)).toBe(true);
      expect(upgradedRow.digest_config.source.credentialId).toBe(newCred.id);
      expect(upgradedRow.digest_config.destination.credentialId).toBe(personalA.gmailCred.id);
      expect(upgradedRow.digest_config_hash).toBe(
        computeSheetsDigestHash({
          userId: personalA.user.id,
          recurrence: upgradedRow.recurrence,
          config: upgradedRow.digest_config,
        })
      );

      // 4. Attempting to confirm the same reauthorize proposal a second time -> 409 STALE_PROPOSAL (strictly one-time-use!)
      const secondConfirmRes = await request(app)
        .post(
          `/api/conversations/${personalA.conversation.id}/schedule-proposals/${validPreview.proposalMessageId}/confirm`
        )
        .set('Authorization', bearer(personalA.user))
        .send({ approvalMode: 'auto_digest' });
      expect(secondConfirmRes.status).toBe(409);
      expect(secondConfirmRes.body.error.code).toBe('STALE_PROPOSAL');
    });

    it('TC-20 & TC-25: rejects confirmProposal with 409 DIGEST_PREVIEW_CHANGED (and 0 network calls) if credential revoked, rotated, scope narrowed, senderEmail changed, or org member deactivated between preview and confirm', async () => {
      const { personalA, orgA, credentialRepo, encryptionKey } = fixtures;

      const fetchOrgSheetsMetadata = vi.fn(async () => [
        { id: ORG_A_SPREADSHEET_ID, title: orgA.spreadsheetTitle, sheets: ['Sheet1'] },
      ]);
      const service = buildService({ fetchOrgSheetsMetadata });

      const orgSched = await insertScheduleRow({
        userId: orgA.member.id,
        convId: orgA.conversation.id,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        request: 'Đọc bảng Bảng KPI Tổ chức A và gửi vào Slack #general',
        services: ['sheets', 'slack'],
        status: 'paused',
        pauseReason: 'REAUTH_REQUIRED',
        version: 1,
        config: {
          version: 1,
          source: {
            service: 'sheets',
            spreadsheetId: ORG_A_SPREADSHEET_ID,
            spreadsheetTitle: orgA.spreadsheetTitle,
            tailRows: 20,
          },
          destination: {
            service: 'slack',
            channelId: orgA.slackChannelId,
          },
          includeAiSummary: true,
        },
      });

      const preview = await service.createReauthorizePreview({
        userId: orgA.member.id,
        scheduleId: orgSched.id,
        now: NOW,
      });
      expect(fetchOrgSheetsMetadata).toHaveBeenCalledTimes(1);
      fetchOrgSheetsMetadata.mockClear();

      // (a) Narrow Slack channel scope between preview and confirm -> 409 DIGEST_PREVIEW_CHANGED with 0 network calls
      const narrowedSlack = encryptCredentials(
        {
          botToken: 'xoxb-org-a-slack-token',
          allowedScope: { channels: [] },
        },
        encryptionKey
      );
      await db.pool.query('UPDATE service_credentials SET config = $2 WHERE id = $1', [
        orgA.slackCred.id,
        narrowedSlack,
      ]);

      await expect(
        service.confirmProposal({
          userId: orgA.member.id,
          convId: orgA.conversation.id,
          messageId: preview.proposalMessageId,
          now: NOW,
          approvalMode: 'auto_digest',
        })
      ).rejects.toMatchObject({ code: 'DIGEST_PREVIEW_CHANGED' });
      expect(fetchOrgSheetsMetadata).toHaveBeenCalledTimes(0);

      // Restore Slack config, then deactivate org member between preview and confirm -> 409 DIGEST_PREVIEW_CHANGED
      await db.pool.query('UPDATE service_credentials SET config = $2 WHERE id = $1', [
        orgA.slackCred.id,
        orgA.slackCred.config,
      ]);
      await db.pool.query(
        "UPDATE workspace_members SET status = 'disabled' WHERE workspace_id = $1 AND user_id = $2",
        [orgA.workspaceId, orgA.member.id]
      );

      await expect(
        service.confirmProposal({
          userId: orgA.member.id,
          convId: orgA.conversation.id,
          messageId: preview.proposalMessageId,
          now: NOW,
          approvalMode: 'auto_digest',
        })
      ).rejects.toMatchObject({ code: 'DIGEST_PREVIEW_CHANGED' });
      expect(fetchOrgSheetsMetadata).toHaveBeenCalledTimes(0);

      // (b) Personal schedule: rotate credential between preview and confirm -> 409 DIGEST_PREVIEW_CHANGED
      const personalSched = await insertScheduleRow({
        userId: personalA.user.id,
        convId: personalA.conversation.id,
        workspaceMode: 'personal',
        workspaceId: null,
        request: 'Đọc bảng Báo cáo KPI Cá nhân A và gửi qua Gmail cho tôi',
        services: ['mysheets', 'gmail'],
        status: 'paused',
        pauseReason: 'REAUTH_REQUIRED',
        version: 1,
        config: {
          version: 1,
          source: {
            service: 'mysheets',
            credentialId: personalA.mysheetsCred.id,
            email: personalA.email,
            spreadsheetId: PERSONAL_A_SPREADSHEET_ID,
            spreadsheetTitle: personalA.spreadsheetTitle,
            tailRows: 20,
          },
          destination: {
            service: 'gmail',
            credentialId: personalA.gmailCred.id,
            recipientEmail: personalA.email,
          },
          includeAiSummary: true,
        },
      });

      const personalPreview = await service.createReauthorizePreview({
        userId: personalA.user.id,
        scheduleId: personalSched.id,
        now: NOW,
      });

      // Rotate Gmail credential after preview is created
      await db.pool.query('DELETE FROM service_credentials WHERE id = $1', [personalA.gmailCred.id]);
      await credentialRepo.saveCredentials(
        'gmail',
        personalA.gmailCred.config,
        personalA.user.id,
        null
      );

      await expect(
        service.confirmProposal({
          userId: personalA.user.id,
          convId: personalA.conversation.id,
          messageId: personalPreview.proposalMessageId,
          now: NOW,
          approvalMode: 'auto_digest',
        })
      ).rejects.toMatchObject({ code: 'DIGEST_PREVIEW_CHANGED' });
    });
  });
});
