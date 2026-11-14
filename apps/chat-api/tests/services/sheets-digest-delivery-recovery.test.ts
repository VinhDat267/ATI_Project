import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { SheetsDigestConfigV2 } from '@wap/tool-schemas';
import { createApp } from '../../src/app.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { computeSheetsDigestHash } from '../../src/services/schedules/sheets-digest-candidate.js';
import { SHEETS_DELIVERY_UNKNOWN } from '../../src/services/schedules/sheets-digest-runner.js';
import { ScheduleService } from '../../src/services/schedules/schedule-service.js';
import { certifyScheduleFixture } from '../../src/services/slack/slack-schedule-origin.js';
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
const JWT_SECRET = 'sheets_digest_delivery_recovery_test_secret_32_chars';
const NOW = new Date('2026-11-02T02:00:00.000Z');
const CLAIMED_AT = new Date('2026-11-02T01:55:00.000Z');

describe('Task 5B (PR-5B): Manual Delivery Recovery API & Audit Preservation (TC-17)', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let fixtures: SheetsDigestTenantFixtures;
  let plannedRuns: string[];

  beforeAll(async () => {
    db = await createMigratedSchema('sheets_digest_pr5b_recovery');
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    plannedRuns = [];
    await db.pool.query(
      'TRUNCATE sheets_digest_v2_migration_audit, schedule_runs, schedules, messages, conversations, workspace_members, workspaces, service_credentials CASCADE'
    );
    fixtures = await seedSheetsDigestTenants(db, DIGEST_TEST_ENC_KEY);
  });

  function bearer(who: TestPerson): string {
    return `Bearer ${generateAccessToken(who, JWT_SECRET, who.sid).accessToken}`;
  }

  function buildService() {
    return new ScheduleService({
      pool: db.pool,
      timeZone: TZ,
      credentialRepo: fixtures.credentialRepo,
      encryptionKey: fixtures.encryptionKey,
      mysheetsEnabled: true,
      emitV2: true,
      runner: {
        planNow: async (runId: string) => {
          plannedRuns.push(runId);
        },
      },
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

  async function seedPersonalDigestScheduleWithUnknownRun() {
    const { personalA, convRepo } = fixtures;
    const recurrence = { type: 'daily' as const, time: '08:00' };
    const config: SheetsDigestConfigV2 = {
      version: 2,
      workspaceMode: 'personal',
      workspaceId: null,
      source: {
        service: 'mysheets',
        credentialId: personalA.mysheetsCred.id,
        email: personalA.email,
        spreadsheetId: PERSONAL_A_SPREADSHEET_ID,
        spreadsheetTitle: personalA.spreadsheetTitle,
        sheetName: 'KPI Tháng 11',
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
    const hash = computeSheetsDigestHash({
      userId: personalA.user.id,
      recurrence,
      config,
    });

    const schedRes = await db.pool.query(
      `INSERT INTO schedules (
         user_id, conv_id, name, request, recurrence, services, status, pause_reason,
         version, next_run_at, workspace_id, workspace_mode, kind, digest_config, digest_config_hash, digest_approved_at
       )
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'active', NULL, 1, $7, NULL, 'personal', 'sheets_digest', $8::jsonb, $9, $10)
       RETURNING *`,
      [
        personalA.user.id,
        personalA.conversation.id,
        'Báo cáo KPI Cá nhân A',
        'Đọc bảng Báo cáo KPI Cá nhân A và gửi qua Gmail tới finance@company.com',
        JSON.stringify(recurrence),
        ['mysheets', 'gmail'],
        new Date('2026-11-03T01:00:00.000Z'),
        JSON.stringify(config),
        hash,
        new Date('2026-11-01T12:00:00.000Z'),
      ]
    );
    const schedule = schedRes.rows[0];

    const runConv = await convRepo.createConversation(
      personalA.user.id,
      'Lịch: Báo cáo KPI Cá nhân A · 02/11/2026',
      { workspaceMode: 'personal', workspaceId: null }
    );

    const runRes = await db.pool.query(
      `INSERT INTO schedule_runs (
         schedule_id, schedule_version, trigger, due_at, status, conv_id, error, delivery_started_at
       )
       VALUES ($1, 1, 'scheduled', $2, 'needs_attention', $3, $4, $5)
       RETURNING *`,
      [
        schedule.id,
        new Date('2026-11-02T01:00:00.000Z'),
        runConv.id,
        SHEETS_DELIVERY_UNKNOWN,
        CLAIMED_AT,
      ]
    );

    return {
      schedule,
      run: runRes.rows[0],
      runConv,
      owner: personalA.user,
      config,
    };
  }

  async function seedOrgDigestScheduleWithUnknownRun() {
    const { orgA, convRepo } = fixtures;
    const recurrence = { type: 'daily' as const, time: '08:00' };
    const config: SheetsDigestConfigV2 = {
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
        channelLabel: '#general',
      },
      includeAiSummary: false,
    };
    const hash = computeSheetsDigestHash({
      userId: orgA.member.id,
      recurrence,
      config,
    });

    const schedRes = await db.pool.query(
      `INSERT INTO schedules (
         user_id, conv_id, name, request, recurrence, services, status, pause_reason,
         version, next_run_at, workspace_id, workspace_mode, kind, digest_config, digest_config_hash, digest_approved_at
       )
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'active', NULL, 1, $7, $8, 'organization', 'sheets_digest', $9::jsonb, $10, $11)
       RETURNING *`,
      [
        orgA.member.id,
        orgA.conversation.id,
        'Báo cáo KPI Tổ chức A',
        'Đọc bảng Bảng KPI Tổ chức A và gửi vào Slack #general',
        JSON.stringify(recurrence),
        ['sheets', 'slack'],
        new Date('2026-11-03T01:00:00.000Z'),
        orgA.workspaceId,
        JSON.stringify(config),
        hash,
        new Date('2026-11-01T12:00:00.000Z'),
      ]
    );
    const schedule = schedRes.rows[0];

    const runConv = await convRepo.createConversation(
      orgA.member.id,
      'Lịch: Báo cáo KPI Tổ chức A · 02/11/2026',
      { workspaceMode: 'organization', workspaceId: orgA.workspaceId }
    );

    const runRes = await db.pool.query(
      `INSERT INTO schedule_runs (
         schedule_id, schedule_version, trigger, due_at, status, conv_id, error, delivery_started_at
       )
       VALUES ($1, 1, 'scheduled', $2, 'needs_attention', $3, $4, $5)
       RETURNING *`,
      [
        schedule.id,
        new Date('2026-11-02T01:00:00.000Z'),
        runConv.id,
        SHEETS_DELIVERY_UNKNOWN,
        CLAIMED_AT,
      ]
    );

    return {
      schedule,
      run: runRes.rows[0],
      runConv,
      owner: orgA.member,
      workspaceId: orgA.workspaceId,
      config,
    };
  }

  it('1. rejects startRun({ trigger: "replan" }) and POST /api/schedule-runs/:id/replan on a needs_attention (SHEETS_DELIVERY_UNKNOWN) run with 409 RUN_NOT_REPLANNABLE', async () => {
    const service = buildService();
    const app = buildApp(service);
    const { run, owner } = await seedPersonalDigestScheduleWithUnknownRun();

    await expect(
      service.startRun({
        userId: owner.id,
        runId: run.id,
        trigger: 'replan',
        now: NOW,
        scope: { workspaceMode: 'personal', workspaceId: null },
      })
    ).rejects.toMatchObject({
      code: 'RUN_NOT_REPLANNABLE',
    });

    const httpRes = await request(app)
      .post(`/api/schedule-runs/${run.id}/replan`)
      .set('Authorization', bearer(owner))
      .send({});
    expect(httpRes.status).toBe(409);
    expect(httpRes.body.error.code).toBe('RUN_NOT_REPLANNABLE');
    expect(plannedRuns).toEqual([]);

    const dbRun = (await db.pool.query('SELECT * FROM schedule_runs WHERE id = $1', [run.id])).rows[0];
    expect(dbRun.status).toBe('needs_attention');
    expect(new Date(dbRun.delivery_started_at).toISOString()).toBe(CLAIMED_AT.toISOString());
    expect(dbRun.delivery_resolution).toBeNull();
  });

  it('2. rejects POST /api/schedule-runs/:id/resolve-delivery when resolution is invalid or when retry_new_run lacks confirmDuplicateRisk === true (400 DUPLICATE_RISK_CONFIRMATION_REQUIRED)', async () => {
    const service = buildService();
    const app = buildApp(service);
    const { run, owner } = await seedPersonalDigestScheduleWithUnknownRun();

    const invalidRes = await request(app)
      .post(`/api/schedule-runs/${run.id}/resolve-delivery`)
      .set('Authorization', bearer(owner))
      .send({ resolution: 'force_overwrite' });
    expect(invalidRes.status).toBe(400);
    expect(invalidRes.body.error.code).toBe('INVALID_DELIVERY_RESOLUTION');

    const missingConfirmRes = await request(app)
      .post(`/api/schedule-runs/${run.id}/resolve-delivery`)
      .set('Authorization', bearer(owner))
      .send({ resolution: 'retry_new_run' });
    expect(missingConfirmRes.status).toBe(400);
    expect(missingConfirmRes.body.error.code).toBe('DUPLICATE_RISK_CONFIRMATION_REQUIRED');
    expect(missingConfirmRes.body.error.message).toContain('xác nhận rủi ro gửi trùng');

    const falseConfirmRes = await request(app)
      .post(`/api/schedule-runs/${run.id}/resolve-delivery`)
      .set('Authorization', bearer(owner))
      .send({ resolution: 'retry_new_run', confirmDuplicateRisk: false });
    expect(falseConfirmRes.status).toBe(400);
    expect(falseConfirmRes.body.error.code).toBe('DUPLICATE_RISK_CONFIRMATION_REQUIRED');

    expect(plannedRuns).toEqual([]);
    const dbRun = (await db.pool.query('SELECT * FROM schedule_runs WHERE id = $1', [run.id])).rows[0];
    expect(dbRun.status).toBe('needs_attention');
    expect(dbRun.delivery_resolution).toBeNull();
    expect(dbRun.delivery_followup_run_id).toBeNull();
  });

  it('3. resolves with retry_new_run + confirmDuplicateRisk: true by preserving original run at needs_attention with write-once delivery_started_at, recording retried_new_run, creating a new planning run, sealing audit message, and triggering runner.planNow', async () => {
    const service = buildService();
    const app = buildApp(service);
    const { schedule, run, runConv, owner } = await seedPersonalDigestScheduleWithUnknownRun();

    const res = await request(app)
      .post(`/api/schedule-runs/${run.id}/resolve-delivery`)
      .set('Authorization', bearer(owner))
      .send({ resolution: 'retry_new_run', confirmDuplicateRisk: true });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.run).toMatchObject({
      id: run.id,
      scheduleId: schedule.id,
      state: 'needs_attention',
      deliveryStartedAt: CLAIMED_AT.toISOString(),
      deliveryResolution: 'retried_new_run',
      deliveryResolvedAt: NOW.toISOString(),
    });
    expect(res.body.followUpRun).toBeDefined();
    const followUpRunId = res.body.followUpRun.id as string;
    expect(followUpRunId).not.toBe(run.id);
    expect(res.body.run.deliveryFollowupRunId).toBe(followUpRunId);
    expect(res.body.followUpRun).toMatchObject({
      id: followUpRunId,
      scheduleId: schedule.id,
      trigger: 'manual',
      state: 'planning',
      deliveryStartedAt: null,
      deliveryResolution: null,
      deliveryResolvedAt: null,
      deliveryFollowupRunId: null,
    });

    // Verify DB state of original run: NEVER falsified as 'digest_failed', write-once delivery_started_at preserved
    const dbOldRun = (await db.pool.query('SELECT * FROM schedule_runs WHERE id = $1', [run.id])).rows[0];
    expect(dbOldRun.status).toBe('needs_attention');
    expect(new Date(dbOldRun.delivery_started_at).toISOString()).toBe(CLAIMED_AT.toISOString());
    expect(dbOldRun.delivery_resolution).toBe('retried_new_run');
    expect(new Date(dbOldRun.delivery_resolved_at).toISOString()).toBe(NOW.toISOString());
    expect(dbOldRun.delivery_resolved_by).toBe(owner.id);
    expect(dbOldRun.delivery_followup_run_id).toBe(followUpRunId);

    // Verify DB state of follow-up run: brand-new row with delivery_started_at = NULL
    const dbNewRun = (await db.pool.query('SELECT * FROM schedule_runs WHERE id = $1', [followUpRunId])).rows[0];
    expect(dbNewRun.status).toBe('planning');
    expect(dbNewRun.trigger).toBe('manual');
    expect(dbNewRun.delivery_started_at).toBeNull();
    expect(dbNewRun.delivery_resolution).toBeNull();

    // Verify runner.planNow was called with the new run ID
    expect(plannedRuns).toEqual([followUpRunId]);

    // Verify sealed audit message written to run.conv_id
    const auditMsgs = (
      await db.pool.query(
        `SELECT m.*, o.producer
         FROM messages m
         LEFT JOIN slack_message_origins o ON o.artifact_table = 'messages' AND o.artifact_id = m.id
         WHERE m.conv_id = $1
         ORDER BY m.created_at DESC`,
        [runConv.id]
      )
    ).rows;
    expect(auditMsgs.length).toBeGreaterThanOrEqual(1);
    expect(auditMsgs[0].producer).toBe('message_writer');
    expect(auditMsgs[0].metadata).toMatchObject({
      type: 'schedule_delivery_resolved',
      runId: run.id,
      resolution: 'retry_new_run',
      deliveryResolution: 'retried_new_run',
      followUpRunId,
    });

    // Verify GET /api/schedules/:id/runs projects the new fields accurately
    const runsListRes = await request(app)
      .get(`/api/schedules/${schedule.id}/runs`)
      .set('Authorization', bearer(owner));
    expect(runsListRes.status).toBe(200);
    const listedOld = runsListRes.body.runs.find((r: any) => r.id === run.id);
    expect(listedOld).toMatchObject({
      id: run.id,
      state: 'needs_attention',
      deliveryStartedAt: CLAIMED_AT.toISOString(),
      deliveryResolution: 'retried_new_run',
      deliveryResolvedAt: NOW.toISOString(),
      deliveryFollowupRunId: followUpRunId,
    });
  });

  it('4. resolves with mark_sent by transitioning run to digest_sent, clearing error, preserving write-once delivery_started_at, and recording honest manual-confirmation metadata without fabricating rowCount, sentAt, or provider receipts', async () => {
    const service = buildService();
    const app = buildApp(service);
    const { schedule, run, runConv, owner, workspaceId } = await seedOrgDigestScheduleWithUnknownRun();

    const res = await request(app)
      .post(`/api/schedule-runs/${run.id}/resolve-delivery`)
      .set('Authorization', bearer(owner))
      .set('X-Workspace-Id', workspaceId)
      .send({ resolution: 'mark_sent' });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.run).toMatchObject({
      id: run.id,
      scheduleId: schedule.id,
      state: 'digest_sent',
      error: null,
      deliveryStartedAt: CLAIMED_AT.toISOString(),
      deliveryResolution: 'confirmed_sent',
      deliveryResolvedAt: NOW.toISOString(),
      deliveryFollowupRunId: null,
      delivery: {
        destination: 'slack',
        targetId: fixtures.orgA.slackChannelId,
        targetLabel: '#general',
        spreadsheetId: ORG_A_SPREADSHEET_ID,
        spreadsheetTitle: fixtures.orgA.spreadsheetTitle,
        rowCount: null,
        summaryMode: 'deterministic',
        sentAt: null,
        providerSentAt: null,
        manualConfirmedAt: NOW.toISOString(),
        manualResolution: {
          status: 'confirmed_sent',
          resolvedAt: NOW.toISOString(),
          manualConfirmedAt: NOW.toISOString(),
          resolvedBy: owner.id,
        },
      },
    });
    expect(res.body.run.delivery.slackMessageTs).toBeUndefined();
    expect(res.body.run.delivery.telegramMessageId).toBeUndefined();
    expect(res.body.run.delivery.gmailMessageId).toBeUndefined();
    expect(res.body.run.delivery.ts).toBeUndefined();
    expect(res.body.run.delivery.id).toBeUndefined();
    expect(res.body.run.delivery.messageId).toBeUndefined();
    expect(plannedRuns).toEqual([]);

    const dbRun = (await db.pool.query('SELECT * FROM schedule_runs WHERE id = $1', [run.id])).rows[0];
    expect(dbRun.status).toBe('digest_sent');
    expect(dbRun.error).toBeNull();
    expect(new Date(dbRun.delivery_started_at).toISOString()).toBe(CLAIMED_AT.toISOString());
    expect(dbRun.delivery_resolution).toBe('confirmed_sent');
    expect(new Date(dbRun.delivery_resolved_at).toISOString()).toBe(NOW.toISOString());
    expect(dbRun.delivery_resolved_by).toBe(owner.id);
    expect(dbRun.delivery.rowCount).toBeNull();
    expect(dbRun.delivery.sentAt).toBeNull();
    expect(dbRun.delivery.providerSentAt).toBeNull();
    expect(dbRun.delivery.manualConfirmedAt).toBe(NOW.toISOString());
    expect(dbRun.delivery.slackMessageTs).toBeUndefined();
    expect(dbRun.delivery.telegramMessageId).toBeUndefined();
    expect(dbRun.delivery.gmailMessageId).toBeUndefined();
    expect(dbRun.delivery.manualResolution).toEqual({
      status: 'confirmed_sent',
      resolvedAt: NOW.toISOString(),
      manualConfirmedAt: NOW.toISOString(),
      resolvedBy: owner.id,
    });

    // Sealed audit message in runConv
    const auditMsgs = (
      await db.pool.query(
        `SELECT m.*, o.producer
         FROM messages m
         LEFT JOIN slack_message_origins o ON o.artifact_table = 'messages' AND o.artifact_id = m.id
         WHERE m.conv_id = $1`,
        [runConv.id]
      )
    ).rows;
    expect(auditMsgs).toHaveLength(1);
    expect(auditMsgs[0].producer).toBe('message_writer');
    expect(auditMsgs[0].metadata).toMatchObject({
      type: 'schedule_delivery_resolved',
      runId: run.id,
      resolution: 'mark_sent',
      deliveryResolution: 'confirmed_sent',
    });
  });

  it('4b. preserves pre-existing genuine delivery metadata when already present on run.delivery during mark_sent', async () => {
    const service = buildService();
    const app = buildApp(service);
    const { run, owner, workspaceId } = await seedOrgDigestScheduleWithUnknownRun();

    const preExistingSentAt = '2026-11-02T01:55:04.000Z';
    const origRunForUpdate = (service as any).repo.runForUpdate.bind((service as any).repo);
    const spy = vi.spyOn((service as any).repo, 'runForUpdate').mockImplementationOnce(async (...args: unknown[]) => {
      const row = await origRunForUpdate(args[0] as string, args[1]);
      if (row) {
        row.delivery = {
          destination: 'slack',
          targetId: fixtures.orgA.slackChannelId,
          targetLabel: '#general-custom',
          spreadsheetId: ORG_A_SPREADSHEET_ID,
          spreadsheetTitle: fixtures.orgA.spreadsheetTitle,
          sheetName: 'Tab Doanh Thu',
          rowCount: 42,
          dataScope: 'full_tab_verified',
          scannedRange: 'Tab Doanh Thu!A1:F43',
          windowClipped: false,
          summaryMode: 'ai',
          sentAt: preExistingSentAt,
          providerSentAt: preExistingSentAt,
          slackMessageTs: '1730512504.000200',
          skippedEmpty: false,
        };
      }
      return row;
    });

    const res = await request(app)
      .post(`/api/schedule-runs/${run.id}/resolve-delivery`)
      .set('Authorization', bearer(owner))
      .set('X-Workspace-Id', workspaceId)
      .send({ resolution: 'mark_sent' });

    spy.mockRestore();

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.run.delivery).toEqual({
      destination: 'slack',
      targetId: fixtures.orgA.slackChannelId,
      targetLabel: '#general-custom',
      spreadsheetId: ORG_A_SPREADSHEET_ID,
      spreadsheetTitle: fixtures.orgA.spreadsheetTitle,
      sheetName: 'Tab Doanh Thu',
      rowCount: 42,
      dataScope: 'full_tab_verified',
      scannedRange: 'Tab Doanh Thu!A1:F43',
      windowClipped: false,
      summaryMode: 'ai',
      sentAt: preExistingSentAt,
      providerSentAt: preExistingSentAt,
      manualConfirmedAt: NOW.toISOString(),
      slackMessageTs: '1730512504.000200',
      skippedEmpty: false,
      manualResolution: {
        status: 'confirmed_sent',
        resolvedAt: NOW.toISOString(),
        manualConfirmedAt: NOW.toISOString(),
        resolvedBy: owner.id,
      },
    });
  });

  it('5. enforces single-resolution CAS under sequential and concurrent Promise.all requests (409 DELIVERY_ALREADY_RESOLVED, at most 1 follow-up run created)', async () => {
    const service = buildService();
    const app = buildApp(service);
    const { schedule, run, owner } = await seedPersonalDigestScheduleWithUnknownRun();

    // Concurrent race: two simultaneous retry_new_run requests on the same unresolved run
    const [resA, resB] = await Promise.all([
      request(app)
        .post(`/api/schedule-runs/${run.id}/resolve-delivery`)
        .set('Authorization', bearer(owner))
        .send({ resolution: 'retry_new_run', confirmDuplicateRisk: true }),
      request(app)
        .post(`/api/schedule-runs/${run.id}/resolve-delivery`)
        .set('Authorization', bearer(owner))
        .send({ resolution: 'retry_new_run', confirmDuplicateRisk: true }),
    ]);

    const statuses = [resA.status, resB.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);

    const conflictRes = resA.status === 409 ? resA : resB;
    expect(conflictRes.body.error.code).toBe('DELIVERY_ALREADY_RESOLVED');

    // Only 1 follow-up run created in DB (total 2 runs for this schedule: original + 1 follow-up)
    const allRuns = (
      await db.pool.query('SELECT * FROM schedule_runs WHERE schedule_id = $1 ORDER BY created_at ASC', [
        schedule.id,
      ])
    ).rows;
    expect(allRuns).toHaveLength(2);
    expect(plannedRuns).toHaveLength(1);

    // Subsequent sequential attempt (e.g. mark_sent) also rejects with 409 DELIVERY_ALREADY_RESOLVED
    const secondAttempt = await request(app)
      .post(`/api/schedule-runs/${run.id}/resolve-delivery`)
      .set('Authorization', bearer(owner))
      .send({ resolution: 'mark_sent' });
    expect(secondAttempt.status).toBe(409);
    expect(secondAttempt.body.error.code).toBe('DELIVERY_ALREADY_RESOLVED');
  });

  it('6. enforces cross-tenant & non-owner isolation (404 NOT_FOUND) and rejects runs not awaiting delivery resolution (409 RUN_NOT_AWAITING_DELIVERY_RESOLUTION)', async () => {
    const service = buildService();
    const app = buildApp(service);
    const { schedule: personalSchedule, run: personalRun, owner: personalOwner } =
      await seedPersonalDigestScheduleWithUnknownRun();
    const { run: orgRun, owner: orgOwner, workspaceId: orgWorkspaceId } =
      await seedOrgDigestScheduleWithUnknownRun();

    // Non-owner Personal User B attempting to resolve Personal User A's run -> 404
    const nonOwnerRes = await request(app)
      .post(`/api/schedule-runs/${personalRun.id}/resolve-delivery`)
      .set('Authorization', bearer(fixtures.personalB.user))
      .send({ resolution: 'mark_sent' });
    expect(nonOwnerRes.status).toBe(404);

    // Org member calling without X-Workspace-Id header on Org run -> 404
    const orgMissingHeaderRes = await request(app)
      .post(`/api/schedule-runs/${orgRun.id}/resolve-delivery`)
      .set('Authorization', bearer(orgOwner))
      .send({ resolution: 'mark_sent' });
    expect(orgMissingHeaderRes.status).toBe(404);

    // Org B member attempting to resolve Org A's run -> 404
    const crossOrgRes = await request(app)
      .post(`/api/schedule-runs/${orgRun.id}/resolve-delivery`)
      .set('Authorization', bearer(fixtures.orgB.member))
      .set('X-Workspace-Id', fixtures.orgB.workspaceId)
      .send({ resolution: 'mark_sent' });
    expect(crossOrgRes.status).toBe(404);

    // Run without delivery_started_at (e.g. pre-claim interrupted/planning_failed) -> 409 RUN_NOT_AWAITING_DELIVERY_RESOLUTION
    const unclaimedRunRes = await db.pool.query(
      `INSERT INTO schedule_runs (schedule_id, schedule_version, trigger, due_at, status, delivery_started_at)
       VALUES ($1, 1, 'scheduled', $2, 'needs_attention', NULL)
       RETURNING id`,
      [personalSchedule.id, new Date('2026-11-02T03:00:00.000Z')]
    );
    const unclaimedResolve = await request(app)
      .post(`/api/schedule-runs/${unclaimedRunRes.rows[0].id}/resolve-delivery`)
      .set('Authorization', bearer(personalOwner))
      .send({ resolution: 'mark_sent' });
    expect(unclaimedResolve.status).toBe(409);
    expect(unclaimedResolve.body.error.code).toBe('RUN_NOT_AWAITING_DELIVERY_RESOLUTION');
  });

  it('7. rejects non-digest schedules (plan) with 409 RUN_NOT_AWAITING_DELIVERY_RESOLUTION and zero DB mutations', async () => {
    const service = buildService();
    const app = buildApp(service);
    const { personalA } = fixtures;
    const recurrence = { type: 'daily' as const, time: '08:00' };

    const wrongKinds = ['plan'] as const;

    for (const kind of wrongKinds) {
      const kindConv = await fixtures.convRepo.createConversation(
        personalA.user.id,
        `Hội thoại ${kind}`,
        { workspaceMode: 'personal', workspaceId: null }
      );
      const schedRes = await db.pool.query(
        `INSERT INTO schedules (
           user_id, conv_id, name, request, recurrence, services, status, pause_reason,
           version, next_run_at, workspace_id, workspace_mode, kind, digest_config, digest_config_hash, digest_approved_at
         )
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'active', NULL, 1, $7, NULL, 'personal', $8, $9::jsonb, $10, $11)
         RETURNING *`,
        [
          personalA.user.id,
          kindConv.id,
          `Lịch ${kind}`,
          `Yêu cầu ${kind}`,
          JSON.stringify(recurrence),
          ['slack'],
          new Date('2026-11-03T01:00:00.000Z'),
          kind,
          null,
          null,
          null,
        ]
      );
      const sched = schedRes.rows[0];
      await certifyScheduleFixture(db.pool, sched.id);

      const runRes = await db.pool.query(
        `INSERT INTO schedule_runs (
           schedule_id, schedule_version, trigger, due_at, status, conv_id, error, delivery_started_at
         )
         VALUES ($1, 1, 'scheduled', $2, 'needs_attention', $3, $4, $5)
         RETURNING *`,
        [
          sched.id,
          new Date('2026-11-02T01:00:00.000Z'),
          kindConv.id,
          SHEETS_DELIVERY_UNKNOWN,
          CLAIMED_AT,
        ]
      );
      const wrongKindRun = runRes.rows[0];

      const markSentRes = await request(app)
        .post(`/api/schedule-runs/${wrongKindRun.id}/resolve-delivery`)
        .set('Authorization', bearer(personalA.user))
        .send({ resolution: 'mark_sent' });
      expect(markSentRes.status, `mark_sent for kind=${kind}`).toBe(409);
      expect(markSentRes.body.error.code).toBe('RUN_NOT_AWAITING_DELIVERY_RESOLUTION');

      const retryRes = await request(app)
        .post(`/api/schedule-runs/${wrongKindRun.id}/resolve-delivery`)
        .set('Authorization', bearer(personalA.user))
        .send({ resolution: 'retry_new_run', confirmDuplicateRisk: true });
      expect(retryRes.status, `retry_new_run for kind=${kind}`).toBe(409);
      expect(retryRes.body.error.code).toBe('RUN_NOT_AWAITING_DELIVERY_RESOLUTION');

      // Verify zero DB mutations on schedule_runs for this schedule
      const runsInDb = (
        await db.pool.query('SELECT * FROM schedule_runs WHERE schedule_id = $1', [sched.id])
      ).rows;
      expect(runsInDb).toHaveLength(1);
      expect(runsInDb[0].status).toBe('needs_attention');
      expect(runsInDb[0].delivery).toBeNull();
      expect(runsInDb[0].delivery_resolution).toBeNull();
      expect(runsInDb[0].delivery_resolved_at).toBeNull();
      expect(runsInDb[0].delivery_followup_run_id).toBeNull();
      expect(runsInDb[0].error).toBe(SHEETS_DELIVERY_UNKNOWN);
    }
    expect(plannedRuns).toEqual([]);
  });

  it('8. rejects needs_attention runs whose error does not include SHEETS_DELIVERY_UNKNOWN with 409 RUN_NOT_AWAITING_DELIVERY_RESOLUTION and zero DB mutations', async () => {
    const service = buildService();
    const app = buildApp(service);
    const { schedule, owner } = await seedPersonalDigestScheduleWithUnknownRun();

    const wrongErrorRunRes = await db.pool.query(
      `INSERT INTO schedule_runs (
         schedule_id, schedule_version, trigger, due_at, status, error, delivery_started_at
       )
       VALUES ($1, 1, 'scheduled', $2, 'needs_attention', $3, $4)
       RETURNING *`,
      [
        schedule.id,
        new Date('2026-11-02T04:00:00.000Z'),
        'NETWORK_TIMEOUT_NON_SHEETS: Không thể kết nối dịch vụ.',
        CLAIMED_AT,
      ]
    );
    const wrongErrorRun = wrongErrorRunRes.rows[0];

    const markSentRes = await request(app)
      .post(`/api/schedule-runs/${wrongErrorRun.id}/resolve-delivery`)
      .set('Authorization', bearer(owner))
      .send({ resolution: 'mark_sent' });
    expect(markSentRes.status).toBe(409);
    expect(markSentRes.body.error.code).toBe('RUN_NOT_AWAITING_DELIVERY_RESOLUTION');

    const retryRes = await request(app)
      .post(`/api/schedule-runs/${wrongErrorRun.id}/resolve-delivery`)
      .set('Authorization', bearer(owner))
      .send({ resolution: 'retry_new_run', confirmDuplicateRisk: true });
    expect(retryRes.status).toBe(409);
    expect(retryRes.body.error.code).toBe('RUN_NOT_AWAITING_DELIVERY_RESOLUTION');

    const dbRun = (await db.pool.query('SELECT * FROM schedule_runs WHERE id = $1', [wrongErrorRun.id])).rows[0];
    expect(dbRun.status).toBe('needs_attention');
    expect(dbRun.delivery).toBeNull();
    expect(dbRun.delivery_resolution).toBeNull();
    expect(dbRun.delivery_resolved_at).toBeNull();
    expect(dbRun.delivery_followup_run_id).toBeNull();
    expect(dbRun.error).toBe('NETWORK_TIMEOUT_NON_SHEETS: Không thể kết nối dịch vụ.');
    expect(plannedRuns).toEqual([]);
  });

  it('9. rejects both mark_sent and retry_new_run on a cancelled schedule with 409 SCHEDULE_CLOSED and zero DB mutations', async () => {
    const service = buildService();
    const app = buildApp(service);
    const { schedule, run, owner } = await seedPersonalDigestScheduleWithUnknownRun();

    await db.pool.query("UPDATE schedules SET status = 'cancelled', next_run_at = NULL WHERE id = $1", [schedule.id]);

    const markSentRes = await request(app)
      .post(`/api/schedule-runs/${run.id}/resolve-delivery`)
      .set('Authorization', bearer(owner))
      .send({ resolution: 'mark_sent' });
    expect(markSentRes.status).toBe(409);
    expect(markSentRes.body.error.code).toBe('SCHEDULE_CLOSED');

    const retryRes = await request(app)
      .post(`/api/schedule-runs/${run.id}/resolve-delivery`)
      .set('Authorization', bearer(owner))
      .send({ resolution: 'retry_new_run', confirmDuplicateRisk: true });
    expect(retryRes.status).toBe(409);
    expect(retryRes.body.error.code).toBe('SCHEDULE_CLOSED');

    const runsInDb = (
      await db.pool.query('SELECT * FROM schedule_runs WHERE schedule_id = $1', [schedule.id])
    ).rows;
    expect(runsInDb).toHaveLength(1);
    expect(runsInDb[0].status).toBe('needs_attention');
    expect(runsInDb[0].delivery).toBeNull();
    expect(runsInDb[0].delivery_resolution).toBeNull();
    expect(runsInDb[0].delivery_resolved_at).toBeNull();
    expect(runsInDb[0].delivery_followup_run_id).toBeNull();
    expect(plannedRuns).toEqual([]);
  });
});
