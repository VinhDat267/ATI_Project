import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptCredentials, SlackAdapter, StepError, type ReadDigestWindowResult } from '@wap/tool-adapters';
import type { SheetsDigestConfigV1, SheetsDigestConfigV2 } from '@wap/tool-schemas';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
import {
  DIGEST_TEST_ENC_KEY,
  ORG_A_SPREADSHEET_ID,
  ORG_B_SPREADSHEET_ID,
  PERSONAL_A_SPREADSHEET_ID,
  createDigestProviderSpy,
  insertTestSheetsDigestSchedule,
  seedSheetsDigestTenants,
  type SheetsDigestTenantFixtures,
} from '../helpers/sheets-digest-tenant-fixtures.js';
import { MessageRepo } from '../../src/db/repositories/message-repo.js';
import { ScheduleRepo } from '../../src/db/repositories/schedule-repo.js';
import { ScheduleService } from '../../src/services/schedules/schedule-service.js';
import { ScheduleRunner, reconcileScheduleRuns } from '../../src/services/schedules/schedule-runner.js';
import {
  computeSheetsDigestHash,
  computeSheetsDigestV1Hash,
} from '../../src/services/schedules/sheets-digest-candidate.js';
import {
  SHEETS_DELIVERY_UNKNOWN,
  SheetsDigestRunner,
  resolveTrustedScheduleScope,
} from '../../src/services/schedules/sheets-digest-runner.js';

const TZ = 'Asia/Ho_Chi_Minh';
const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../db/v3/', import.meta.url));
const MIGRATION_0033_PATH = fileURLToPath(
  new URL('../../../../db/v3/0033_sheets_digest_v2_remediation.sql', import.meta.url)
);

function createBarrier() {
  let release!: () => void;
  let markReached!: () => void;
  const reached = new Promise<void>((resolve) => {
    markReached = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    reached,
    release,
    async wait() {
      markReached();
      await gate;
    },
  };
}

describe('Task 3 (PR-3): 0033 DDL, Controlled V1/V2 Runner, Mandatory Pre-Send Admission & Concurrency', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let fixtures: SheetsDigestTenantFixtures;
  let scheduleRepo: ScheduleRepo;
  let messageRepo: MessageRepo;

  beforeAll(async () => {
    db = await createMigratedSchema('sheets_digest_pr3');
    scheduleRepo = new ScheduleRepo(db.pool, TZ);
    messageRepo = new MessageRepo(db.pool);
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.pool.query(
      'TRUNCATE sheets_digest_v2_migration_audit, schedule_runs, schedules, messages, conversations, workspace_members, workspaces, service_credentials CASCADE'
    );
    fixtures = await seedSheetsDigestTenants(db, DIGEST_TEST_ENC_KEY);
    // Backdate all seeded credentials to 2026-11-01T00:00:00Z so approval at 2026-11-02T00:00:00Z is after credential creation
    await db.pool.query(
      "UPDATE service_credentials SET created_at = '2026-11-01T00:00:00.000Z', status_changed_at = NULL"
    );
  });

  async function insertPlanningRun(scheduleId: string, scheduleVersion: number, dueIso = '2026-11-03T01:00:00.000Z') {
    await db.pool.query(
      "UPDATE schedule_runs SET status = 'discarded' WHERE schedule_id = $1 AND status = 'planning'",
      [scheduleId]
    );
    const res = await db.pool.query<{ id: string }>(
      `INSERT INTO schedule_runs (schedule_id, schedule_version, trigger, due_at, status)
       VALUES ($1, $2, 'scheduled', $3, 'planning')
       RETURNING id`,
      [scheduleId, scheduleVersion, new Date(dueIso)]
    );
    return res.rows[0]!.id;
  }

  describe('1. Migration 0033 DDL & Idempotency', () => {
    it('applies 0033_sheets_digest_v2_remediation.sql idempotently without mutating schedules rows and enforces audit + delivery_resolution constraints', async () => {
      const { personalA } = fixtures;
      const v1Config: SheetsDigestConfigV1 = {
        version: 1,
        source: {
          service: 'mysheets',
          credentialId: personalA.mysheetsCred.id,
          email: personalA.email,
          spreadsheetId: personalA.spreadsheetId,
          spreadsheetTitle: personalA.spreadsheetTitle,
          tailRows: 20,
        },
        destination: {
          service: 'gmail',
          credentialId: personalA.gmailCred.id,
          recipientEmail: 'ceo@company.test',
        },
        includeAiSummary: true,
      };
      const sched = await insertTestSheetsDigestSchedule(db.pool, {
        userId: personalA.user.id,
        convId: personalA.conversation.id,
        workspaceMode: 'personal',
        workspaceId: null,
        digestConfig: v1Config as unknown as Record<string, unknown>,
      });

      const beforeRows = (await db.pool.query('SELECT * FROM schedules WHERE id = $1', [sched.id])).rows;
      const ddlSql = await readFile(MIGRATION_0033_PATH, 'utf8');

      // Re-run 0033 twice to verify idempotency and zero data mutation
      await db.pool.query(ddlSql);
      await db.pool.query(ddlSql);

      const afterRows = (await db.pool.query('SELECT * FROM schedules WHERE id = $1', [sched.id])).rows;
      expect(afterRows).toEqual(beforeRows);

      // Verify sheets_digest_v2_migration_audit columns & check constraint
      const auditInsert = await db.pool.query(
        `INSERT INTO sheets_digest_v2_migration_audit (
           schedule_id, user_id, workspace_mode, workspace_id,
           previous_status, previous_pause_reason, previous_next_run_at,
           previous_schedule_ver, migrated_schedule_ver, previous_config_version,
           previous_digest_config, previous_config_hash,
           outcome, reason_code, reason_detail
         ) VALUES ($1, $2, 'personal', NULL, 'active', NULL, now(), 1, 2, 1, $3::jsonb, $4, 'upgraded_v2', 'CLASS_A_UPGRADED', 'Upgraded')
         RETURNING id, migrated_schedule_ver`,
        [sched.id, personalA.user.id, JSON.stringify(v1Config), sched.digest_config_hash]
      );
      expect(auditInsert.rows[0]?.migrated_schedule_ver).toBe(2);

      await expect(
        db.pool.query(
          `UPDATE sheets_digest_v2_migration_audit SET outcome = 'invalid_outcome' WHERE schedule_id = $1`,
          [sched.id]
        )
      ).rejects.toThrow();

      // Verify schedule_runs recovery columns and delivery_resolution check constraint
      const runId = await insertPlanningRun(sched.id, sched.version);
      await db.pool.query(
        `UPDATE schedule_runs
         SET delivery_started_at = now(),
             delivery_resolution = 'confirmed_sent',
             delivery_resolved_at = now(),
             delivery_resolved_by = $2
         WHERE id = $1`,
        [runId, personalA.user.id]
      );
      const runRow = (
        await db.pool.query(
          'SELECT delivery_started_at, delivery_resolution, delivery_resolved_at, delivery_resolved_by, delivery_followup_run_id FROM schedule_runs WHERE id = $1',
          [runId]
        )
      ).rows[0];
      expect(runRow.delivery_started_at).toBeInstanceOf(Date);
      expect(runRow.delivery_resolution).toBe('confirmed_sent');
      expect(runRow.delivery_resolved_by).toBe(personalA.user.id);
      expect(runRow.delivery_followup_run_id).toBeNull();

      await expect(
        db.pool.query("UPDATE schedule_runs SET delivery_resolution = 'bogus' WHERE id = $1", [runId])
      ).rejects.toThrow();

      // Verify upgrading a prior-schema (0001..0032 only) database with pre-existing schedules & schedule_runs rows
      // and re-applying 0033 idempotently (2nd and 3rd times) with zero data mutation
      const dbConnStr = process.env.DATABASE_URL || 'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3';
      const priorSchema = `sheets_digest_prior_0032_${randomUUID().replaceAll('-', '')}`;
      const adminPool = new pg.Pool({ connectionString: dbConnStr });
      await adminPool.query(`CREATE SCHEMA "${priorSchema}"`);
      const priorUrl = new URL(dbConnStr);
      priorUrl.searchParams.set('options', `-c search_path=${priorSchema}`);
      const priorPool = new pg.Pool({ connectionString: priorUrl.href, max: 4 });
      try {
        const files0001To0032 = (await readdir(MIGRATIONS_DIR))
          .filter((f) => /^\d{4}_.*\.sql$/.test(f) && !f.startsWith('0033_'))
          .sort();
        for (const f of files0001To0032) {
          await priorPool.query(await readFile(`${MIGRATIONS_DIR}/${f}`, 'utf8'));
        }

        // Seed user, conversation, schedule, and schedule_run on 0001..0032 schema BEFORE 0033
        const uRes = await priorPool.query<{ id: string }>(
          `INSERT INTO users (email, name, password, status, email_verified)
           VALUES ('prior@example.test', 'Prior User', 'hash', 'active', true)
           RETURNING id`
        );
        const uid = uRes.rows[0]!.id;
        const cRes = await priorPool.query<{ id: string }>(
          `INSERT INTO conversations (user_id, status, title, workspace_mode)
           VALUES ($1, 'chatting', 'Prior Conv', 'personal')
           RETURNING id`,
          [uid]
        );
        const cid = cRes.rows[0]!.id;
        const sInserted = await insertTestSheetsDigestSchedule(priorPool, {
          userId: uid,
          convId: cid,
          workspaceMode: 'personal',
          workspaceId: null,
          digestConfig: v1Config as unknown as Record<string, unknown>,
        });
        const sid = sInserted.id;
        const rRes = await priorPool.query<{ id: string }>(
          `INSERT INTO schedule_runs (schedule_id, schedule_version, trigger, due_at, status)
           VALUES ($1, 1, 'scheduled', '2026-11-03T01:00:00Z', 'planning')
           RETURNING id`,
          [sid]
        );
        const rid = rRes.rows[0]!.id;

        const priorSchedBefore = (await priorPool.query('SELECT * FROM schedules WHERE id = $1', [sid])).rows;
        const priorRunBefore = (
          await priorPool.query(
            'SELECT id, schedule_id, schedule_version, status FROM schedule_runs WHERE id = $1',
            [rid]
          )
        ).rows;

        // Apply 0033 1st, 2nd, and 3rd times on prior-schema DB
        await priorPool.query(ddlSql);
        await priorPool.query(ddlSql);
        await priorPool.query(ddlSql);

        const priorSchedAfter = (await priorPool.query('SELECT * FROM schedules WHERE id = $1', [sid])).rows;
        const priorRunAfter = (
          await priorPool.query(
            'SELECT id, schedule_id, schedule_version, status, delivery_started_at, delivery_resolution, delivery_resolved_at, delivery_resolved_by, delivery_followup_run_id FROM schedule_runs WHERE id = $1',
            [rid]
          )
        ).rows;
        expect(priorSchedAfter).toEqual(priorSchedBefore);
        expect(priorRunAfter[0]).toMatchObject({
          ...priorRunBefore[0],
          delivery_started_at: null,
          delivery_resolution: null,
          delivery_resolved_at: null,
          delivery_resolved_by: null,
          delivery_followup_run_id: null,
        });
      } finally {
        await priorPool.end();
        await adminPool.query(`DROP SCHEMA IF EXISTS "${priorSchema}" CASCADE`);
        await adminPool.end();
      }
    });
  });

  describe('2. Hash Computation (v1 vs v2) & Trusted Scope Helper', () => {
    it('computes distinct canonical hashes for version 1 and version 2 and resolves trusted scope accurately', () => {
      const { personalA, orgA } = fixtures;
      const recurrence = { type: 'daily' as const, time: '08:00' };
      const v1Config: SheetsDigestConfigV1 = {
        version: 1,
        source: {
          service: 'mysheets',
          credentialId: personalA.mysheetsCred.id,
          email: personalA.email,
          spreadsheetId: personalA.spreadsheetId,
          spreadsheetTitle: personalA.spreadsheetTitle,
          tailRows: 20,
        },
        destination: {
          service: 'gmail',
          credentialId: personalA.gmailCred.id,
          recipientEmail: 'ceo@company.test',
        },
        includeAiSummary: true,
      };
      const v2Config: SheetsDigestConfigV2 = {
        version: 2,
        workspaceMode: 'personal',
        workspaceId: null,
        source: {
          service: 'mysheets',
          credentialId: personalA.mysheetsCred.id,
          email: personalA.email,
          spreadsheetId: personalA.spreadsheetId,
          spreadsheetTitle: personalA.spreadsheetTitle,
          tailRows: 20,
        },
        destination: {
          service: 'gmail',
          credentialId: personalA.gmailCred.id,
          senderEmail: personalA.email,
          recipientEmail: 'ceo@company.test',
        },
        includeAiSummary: true,
      };

      const h1 = computeSheetsDigestV1Hash({ userId: personalA.user.id, recurrence, config: v1Config });
      const h1ViaGeneric = computeSheetsDigestHash({ userId: personalA.user.id, recurrence, config: v1Config });
      const h2 = computeSheetsDigestHash({ userId: personalA.user.id, recurrence, config: v2Config });

      expect(h1).toBe(h1ViaGeneric);
      expect(h2).toMatch(/^[0-9a-f]{64}$/);
      expect(h2).not.toBe(h1);

      // Mutating senderEmail or workspaceId in v2 changes the hash
      const h2DiffSender = computeSheetsDigestHash({
        userId: personalA.user.id,
        recurrence,
        config: {
          ...v2Config,
          destination: {
            service: 'gmail',
            credentialId: personalA.gmailCred.id,
            senderEmail: 'other@personal.test',
            recipientEmail: 'ceo@company.test',
          },
        },
      });
      expect(h2DiffSender).not.toBe(h2);

      expect(resolveTrustedScheduleScope({ workspace_mode: 'organization', workspace_id: orgA.workspaceId })).toEqual({
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
      });
      expect(resolveTrustedScheduleScope({ workspace_mode: 'personal', workspace_id: null })).toEqual({
        workspaceMode: 'personal',
        workspaceId: null,
      });
      expect(resolveTrustedScheduleScope({ workspace_mode: 'legacy', workspace_id: null })).toEqual({
        workspaceMode: 'legacy',
        workspaceId: null,
      });
    });
  });

  describe('3. TC-13a & TC-23: Controlled V1 Compatibility Mode vs Strict Pause & Enforce Mode', () => {
    it('fails closed on BOTH Class A and Class B v1 schedules by default (v1CompatPolicy=strict_pause_all) with 0 sends', async () => {
      const { personalA, orgA, credentialRepo } = fixtures;
      const spy = createDigestProviderSpy();

      // 1. Class A (v1_pinned_consistency_candidate, evidenceBoundary: consistency_only_not_config_immutability_proof)
      const classASched = await insertTestSheetsDigestSchedule(db.pool, {
        userId: personalA.user.id,
        convId: personalA.conversation.id,
        workspaceMode: 'personal',
        workspaceId: null,
        digestApprovedAt: new Date('2026-11-02T00:00:00.000Z'),
        nextRunAt: new Date('2026-11-03T01:00:00.000Z'),
        digestConfig: {
          version: 1,
          source: {
            service: 'mysheets',
            credentialId: personalA.mysheetsCred.id,
            email: personalA.email,
            spreadsheetId: personalA.spreadsheetId,
            spreadsheetTitle: personalA.spreadsheetTitle,
            tailRows: 20,
          },
          destination: {
            service: 'gmail',
            credentialId: personalA.gmailCred.id,
            recipientEmail: 'ceo@company.test',
          },
          includeAiSummary: false,
        },
      });

      // 2. Class B (v1_unpinned_fail_closed): Organization v1 schedule (sheets -> slack)
      const classBOrgSched = await insertTestSheetsDigestSchedule(db.pool, {
        userId: orgA.member.id,
        convId: orgA.conversation.id,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        digestApprovedAt: new Date('2026-11-02T00:00:00.000Z'),
        nextRunAt: new Date('2026-11-03T01:00:00.000Z'),
        digestConfig: {
          version: 1,
          source: {
            service: 'sheets',
            spreadsheetId: orgA.spreadsheetId,
            spreadsheetTitle: orgA.spreadsheetTitle,
            tailRows: 20,
          },
          destination: {
            service: 'slack',
            channelId: orgA.slackChannelId,
          },
          includeAiSummary: false,
        },
      });

      let runner!: ScheduleRunner;
      const service = new ScheduleService({
        pool: db.pool,
        timeZone: TZ,
        runner: { planNow: (runId) => runner.planNow(runId) },
        credentialRepo,
        encryptionKey: DIGEST_TEST_ENC_KEY,
        mysheetsEnabled: true,
      });
      // Default SheetsDigestRunner (no v1CompatPolicy passed, SHEETS_DIGEST_V1_COMPAT_POLICY unset -> 'strict_pause_all')
      const defaultDigestRunner = new SheetsDigestRunner({
        pool: db.pool,
        repo: scheduleRepo,
        credentialRepo,
        messageRepo,
        encryptionKey: DIGEST_TEST_ENC_KEY,
        mysheetsEnabled: true,
        createAdapter: spy.createAdapter,
      });
      runner = new ScheduleRunner({
        pool: db.pool,
        timeZone: TZ,
        planRun: vi.fn() as any,
        recordState: (client, row, now) => service.recordState(client, row, now),
        sheetsDigestRunner: defaultDigestRunner,
        now: () => new Date('2026-11-03T01:00:05.000Z'),
      });

      await runner.tick();

      // Both Class A and Class B must be paused under default strict_pause_all with 0 sends
      const classAAfter = await scheduleRepo.ownedSchedule(classASched.id, personalA.user.id);
      expect(classAAfter?.status).toBe('paused');
      expect(classAAfter?.pause_reason).toMatch(/cấp quyền lại \(v2\)/i);

      const classBOrgAfter = await scheduleRepo.ownedSchedule(classBOrgSched.id, orgA.member.id);
      expect(classBOrgAfter?.status).toBe('paused');
      expect(classBOrgAfter?.pause_reason).toMatch(/cấp quyền lại \(v2\)/i);

      expect(spy.getCallCount()).toBe(0);
    });

    it('allows Class A (v1_pinned_consistency_candidate) only under explicit v1CompatPolicy=allow_consistency_candidate while failing closed on all Class B v1 schedules with 0 sends', async () => {
      const { personalA, personalB, orgA, credentialRepo } = fixtures;
      const spy = createDigestProviderSpy();

      // 1. Class A: Personal mysheets -> gmail with valid pre-approval timestamps and matching hash
      const classASched = await insertTestSheetsDigestSchedule(db.pool, {
        userId: personalA.user.id,
        convId: personalA.conversation.id,
        workspaceMode: 'personal',
        workspaceId: null,
        digestApprovedAt: new Date('2026-11-02T00:00:00.000Z'),
        nextRunAt: new Date('2026-11-03T01:00:00.000Z'),
        digestConfig: {
          version: 1,
          source: {
            service: 'mysheets',
            credentialId: personalA.mysheetsCred.id,
            email: personalA.email,
            spreadsheetId: personalA.spreadsheetId,
            spreadsheetTitle: personalA.spreadsheetTitle,
            tailRows: 20,
          },
          destination: {
            service: 'gmail',
            credentialId: personalA.gmailCred.id,
            recipientEmail: 'ceo@company.test',
          },
          includeAiSummary: false,
        },
      });

      // 2. Class B (a): Organization v1 schedule (sheets -> slack)
      const classBOrgSched = await insertTestSheetsDigestSchedule(db.pool, {
        userId: orgA.member.id,
        convId: orgA.conversation.id,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        digestApprovedAt: new Date('2026-11-02T00:00:00.000Z'),
        nextRunAt: new Date('2026-11-03T01:00:00.000Z'),
        digestConfig: {
          version: 1,
          source: {
            service: 'sheets',
            spreadsheetId: orgA.spreadsheetId,
            spreadsheetTitle: orgA.spreadsheetTitle,
            tailRows: 20,
          },
          destination: {
            service: 'slack',
            channelId: orgA.slackChannelId,
          },
          includeAiSummary: false,
        },
      });

      // 3. Class B (b): Unpinned mysheets -> slack v1 schedule in legacy mode
      const convUnpinnedSlack = await fixtures.convRepo.createConversation(personalA.user.id, 'Unpinned Slack V1');
      const classBSlackSched = await insertTestSheetsDigestSchedule(db.pool, {
        userId: personalA.user.id,
        convId: convUnpinnedSlack.id,
        workspaceMode: 'legacy',
        workspaceId: null,
        digestApprovedAt: new Date('2026-11-02T00:00:00.000Z'),
        nextRunAt: new Date('2026-11-03T01:00:00.000Z'),
        digestConfig: {
          version: 1,
          source: {
            service: 'mysheets',
            credentialId: personalA.mysheetsCred.id,
            email: personalA.email,
            spreadsheetId: personalA.spreadsheetId,
            spreadsheetTitle: personalA.spreadsheetTitle,
            tailRows: 20,
          },
          destination: {
            service: 'slack',
            channelId: 'C_LEGACY_01',
          },
          includeAiSummary: false,
        },
      });

      // 4. Class B (c): Personal mysheets -> gmail v1 schedule where credential was rotated AFTER digest_approved_at
      await db.pool.query(
        "UPDATE service_credentials SET created_at = '2026-11-05T00:00:00.000Z' WHERE id = $1",
        [personalB.mysheetsCred.id]
      );
      const classBRotatedSched = await insertTestSheetsDigestSchedule(db.pool, {
        userId: personalB.user.id,
        convId: personalB.conversation.id,
        workspaceMode: 'personal',
        workspaceId: null,
        digestApprovedAt: new Date('2026-11-02T00:00:00.000Z'),
        nextRunAt: new Date('2026-11-03T01:00:00.000Z'),
        digestConfig: {
          version: 1,
          source: {
            service: 'mysheets',
            credentialId: personalB.mysheetsCred.id,
            email: personalB.email,
            spreadsheetId: personalB.spreadsheetId,
            spreadsheetTitle: personalB.spreadsheetTitle,
            tailRows: 20,
          },
          destination: {
            service: 'gmail',
            credentialId: personalB.gmailCred.id,
            recipientEmail: 'cfo@company.test',
          },
          includeAiSummary: false,
        },
      });

      let runner!: ScheduleRunner;
      const service = new ScheduleService({
        pool: db.pool,
        timeZone: TZ,
        runner: { planNow: (runId) => runner.planNow(runId) },
        credentialRepo,
        encryptionKey: DIGEST_TEST_ENC_KEY,
        mysheetsEnabled: true,
      });
      const digestRunner = new SheetsDigestRunner({
        pool: db.pool,
        repo: scheduleRepo,
        credentialRepo,
        messageRepo,
        encryptionKey: DIGEST_TEST_ENC_KEY,
        mysheetsEnabled: true,
        v1CompatPolicy: 'allow_consistency_candidate',
        createAdapter: spy.createAdapter,
      });
      runner = new ScheduleRunner({
        pool: db.pool,
        timeZone: TZ,
        planRun: vi.fn() as any,
        recordState: (client, row, now) => service.recordState(client, row, now),
        sheetsDigestRunner: digestRunner,
        now: () => new Date('2026-11-03T01:00:05.000Z'),
      });

      await runner.tick();

      // Class A succeeded and sent 1 Gmail message
      const classAAfter = await scheduleRepo.ownedSchedule(classASched.id, personalA.user.id);
      expect(classAAfter?.status).toBe('active');
      expect(spy.getCallCount({ service: 'gmail', credentialId: personalA.gmailCred.id })).toBe(1);

      // All 3 Class B schedules failed closed (`blocked` -> `paused`) with 0 sends!
      const orgBAfter = await scheduleRepo.ownedSchedule(classBOrgSched.id, orgA.member.id);
      expect(orgBAfter?.status).toBe('paused');
      expect(orgBAfter?.pause_reason).toMatch(/v1|cấp quyền lại|credentialId/i);

      const slackBAfter = await scheduleRepo.ownedSchedule(classBSlackSched.id, personalA.user.id);
      expect(slackBAfter?.status).toBe('paused');
      expect(slackBAfter?.pause_reason).toMatch(/v1|cấp quyền lại|credentialId/i);

      const rotatedBAfter = await scheduleRepo.ownedSchedule(classBRotatedSched.id, personalB.user.id);
      expect(rotatedBAfter?.status).toBe('paused');
      expect(rotatedBAfter?.pause_reason).toMatch(/thay đổi sau thời điểm phê duyệt|cấp quyền lại/i);

      expect(spy.getCallCount({ service: 'slack' })).toBe(0);
      expect(spy.getCallCount({ service: 'sheets' })).toBe(0);
      expect(spy.getCallCount({ service: 'gmail', credentialId: personalB.gmailCred.id })).toBe(0);
    });

    it('proves policy switch (strict_pause_all <-> allow_consistency_candidate) never upgrades digest_config to v2, never unpauses paused schedules, and never revives revoked/rotated credentials, and blocks enforce mode or malformed scope', async () => {
      const { personalA, personalB, credentialRepo } = fixtures;
      const spy = createDigestProviderSpy();

      const classAConfig: SheetsDigestConfigV1 = {
        version: 1,
        source: {
          service: 'mysheets',
          credentialId: personalA.mysheetsCred.id,
          email: personalA.email,
          spreadsheetId: personalA.spreadsheetId,
          spreadsheetTitle: personalA.spreadsheetTitle,
          tailRows: 20,
        },
        destination: {
          service: 'gmail',
          credentialId: personalA.gmailCred.id,
          recipientEmail: 'ceo@company.test',
        },
        includeAiSummary: false,
      };

      const classASched = await insertTestSheetsDigestSchedule(db.pool, {
        userId: personalA.user.id,
        convId: personalA.conversation.id,
        workspaceMode: 'personal',
        workspaceId: null,
        digestApprovedAt: new Date('2026-11-02T00:00:00.000Z'),
        nextRunAt: new Date('2026-11-03T01:00:00.000Z'),
        digestConfig: classAConfig as unknown as Record<string, unknown>,
      });

      // Step 1: Under default strict_pause_all, ScheduleRunner.tick() pauses Class A and never mutates digest_config
      let activePolicy: 'strict_pause_all' | 'allow_consistency_candidate' = 'strict_pause_all';
      let runner!: ScheduleRunner;
      const service = new ScheduleService({
        pool: db.pool,
        timeZone: TZ,
        runner: { planNow: (runId) => runner.planNow(runId) },
        credentialRepo,
        encryptionKey: DIGEST_TEST_ENC_KEY,
        mysheetsEnabled: true,
      });
      const makeRunnerForPolicy = (policy: 'strict_pause_all' | 'allow_consistency_candidate') =>
        new SheetsDigestRunner({
          pool: db.pool,
          repo: scheduleRepo,
          credentialRepo,
          messageRepo,
          encryptionKey: DIGEST_TEST_ENC_KEY,
          mysheetsEnabled: true,
          v2Mode: 'compat',
          v1CompatPolicy: policy,
          createAdapter: spy.createAdapter,
        });

      runner = new ScheduleRunner({
        pool: db.pool,
        timeZone: TZ,
        planRun: vi.fn() as any,
        recordState: (client, row, now) => service.recordState(client, row, now),
        sheetsDigestRunner: makeRunnerForPolicy(activePolicy),
        now: () => new Date('2026-11-03T01:00:05.000Z'),
      });

      await runner.tick();

      const afterStrictPause = (await scheduleRepo.ownedSchedule(classASched.id, personalA.user.id))!;
      expect(afterStrictPause.status).toBe('paused');
      expect((afterStrictPause.digest_config as any)?.version).toBe(1);
      expect(afterStrictPause.digest_config_hash).toBe(classASched.digest_config_hash);
      expect(spy.getCallCount()).toBe(0);

      // Step 2: Switching policy to 'allow_consistency_candidate' NEVER unpauses an already-paused schedule or upgrades digest_config to v2
      activePolicy = 'allow_consistency_candidate';
      const allowDigestRunner = makeRunnerForPolicy(activePolicy);
      const runnerWithAllow = new ScheduleRunner({
        pool: db.pool,
        timeZone: TZ,
        planRun: vi.fn() as any,
        recordState: (client, row, now) => service.recordState(client, row, now),
        sheetsDigestRunner: allowDigestRunner,
        now: () => new Date('2026-11-03T02:00:05.000Z'),
      });
      await runnerWithAllow.tick();

      const stillPaused = (await scheduleRepo.ownedSchedule(classASched.id, personalA.user.id))!;
      expect(stillPaused.status).toBe('paused');
      expect((stillPaused.digest_config as any)?.version).toBe(1);
      expect(spy.getCallCount()).toBe(0);

      // Step 3: Even on an active schedule, allow_consistency_candidate executes without upgrading digest_config to v2,
      // and NEVER revives a schedule whose credential was revoked (reconnect_required) or rotated
      const activeClassBRevoked = await insertTestSheetsDigestSchedule(db.pool, {
        userId: personalB.user.id,
        convId: personalB.conversation.id,
        workspaceMode: 'personal',
        workspaceId: null,
        digestApprovedAt: new Date('2026-11-02T00:00:00.000Z'),
        nextRunAt: new Date('2026-11-03T02:00:00.000Z'),
        digestConfig: {
          version: 1,
          source: {
            service: 'mysheets',
            credentialId: personalB.mysheetsCred.id,
            email: personalB.email,
            spreadsheetId: personalB.spreadsheetId,
            spreadsheetTitle: personalB.spreadsheetTitle,
            tailRows: 20,
          },
          destination: {
            service: 'gmail',
            credentialId: personalB.gmailCred.id,
            recipientEmail: 'cfo@company.test',
          },
          includeAiSummary: false,
        },
      });
      await credentialRepo.markReconnectRequired('gmail', personalB.user.id, personalB.gmailCred.id);
      const revokedRow = (await scheduleRepo.ownedSchedule(activeClassBRevoked.id, personalB.user.id))!;
      const runRevoked = await insertPlanningRun(revokedRow.id, revokedRow.version, '2026-11-03T02:00:00.000Z');
      const revokedOutcome = await allowDigestRunner.executeDigest(revokedRow, revokedRow.version, runRevoked);
      expect(revokedOutcome.status).toBe('blocked');
      expect(spy.getCallCount()).toBe(0);

      // Step 4: v2Mode=enforce blocks Class A even when v1CompatPolicy=allow_consistency_candidate
      await db.pool.query(
        "UPDATE schedules SET status = 'active', pause_reason = NULL, next_run_at = '2026-11-03T02:30:00.000Z' WHERE id = $1",
        [classASched.id]
      );
      const row = (await scheduleRepo.ownedSchedule(classASched.id, personalA.user.id))!;
      const enforceRunner = new SheetsDigestRunner({
        pool: db.pool,
        repo: scheduleRepo,
        credentialRepo,
        messageRepo,
        encryptionKey: DIGEST_TEST_ENC_KEY,
        mysheetsEnabled: true,
        v2Mode: 'enforce',
        v1CompatPolicy: 'allow_consistency_candidate',
        createAdapter: spy.createAdapter,
      });
      const runId2 = await insertPlanningRun(row.id, row.version, '2026-11-03T02:30:00.000Z');
      const enforceOutcome = await enforceRunner.executeDigest(row, row.version, runId2);
      expect(enforceOutcome.status).toBe('blocked');
      if (enforceOutcome.status === 'blocked') {
        expect(enforceOutcome.pauseReason).toMatch(/phiên bản cũ \(v1\)/i);
      }

      // Step 5: Malformed scope guard: workspace_mode = 'organization' with workspace_id = null must fail closed (never downgrade to 'legacy')
      const malformedOrgRow = { ...row, workspace_mode: 'organization' as const, workspace_id: null };
      const malformedScopeCheck = await allowDigestRunner.verifyConfigAndScope(malformedOrgRow);
      expect(malformedScopeCheck.ok).toBe(false);
      if (!malformedScopeCheck.ok) {
        expect(malformedScopeCheck.reason).toMatch(/thiếu định danh không gian làm việc hợp lệ/i);
      }
      const runId3 = await insertPlanningRun(row.id, row.version, '2026-11-03T03:00:00.000Z');
      const malformedOutcome = await allowDigestRunner.executeDigest(malformedOrgRow, row.version, runId3);
      expect(malformedOutcome.status).toBe('blocked');
      expect(spy.getCallCount()).toBe(0);
    });
  });

  describe('4. TC-02, TC-03 (F-08) & ORG_DATA_EGRESS_FORBIDDEN in SheetsDigestRunner', () => {
    it('enforces Organization A vs B isolation, blocks Org sheets -> Personal Gmail/Telegram egress, and enforces F-08 personal-only Telegram', async () => {
      const { personalA, personalB, orgA, orgB, credentialRepo } = fixtures;
      const spy = createDigestProviderSpy();

      const digestRunner = new SheetsDigestRunner({
        pool: db.pool,
        repo: scheduleRepo,
        credentialRepo,
        messageRepo,
        encryptionKey: DIGEST_TEST_ENC_KEY,
        mysheetsEnabled: true,
        v2Mode: 'enforce',
        createAdapter: spy.createAdapter,
      });

      // 1. TC-02: Org A schedule with Org B credentialId is blocked
      const crossOrgConfig: SheetsDigestConfigV2 = {
        version: 2,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        source: {
          service: 'sheets',
          credentialId: orgB.sheetsCred.id, // Cross-tenant credential ID!
          spreadsheetId: ORG_A_SPREADSHEET_ID,
          spreadsheetTitle: orgA.spreadsheetTitle,
          tailRows: 20,
        },
        destination: {
          service: 'slack',
          credentialId: orgA.slackCred.id,
          channelId: orgA.slackChannelId,
        },
        includeAiSummary: false,
      };
      const crossOrgSched = await insertTestSheetsDigestSchedule(db.pool, {
        userId: orgA.member.id,
        convId: orgA.conversation.id,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        digestConfig: crossOrgConfig as unknown as Record<string, unknown>,
      });
      const crossOrgRow = (await scheduleRepo.ownedSchedule(crossOrgSched.id, orgA.member.id))!;
      const runCrossOrg = await insertPlanningRun(crossOrgRow.id, crossOrgRow.version);
      const resCrossOrg = await digestRunner.executeDigest(crossOrgRow, crossOrgRow.version, runCrossOrg);
      expect(resCrossOrg.status).toBe('blocked');

      // 2. ORG_DATA_EGRESS_FORBIDDEN: Org sheets -> Personal gmail in Organization mode is blocked
      const egressConfig: SheetsDigestConfigV2 = {
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
          service: 'gmail',
          credentialId: personalA.gmailCred.id,
          senderEmail: personalA.email,
          recipientEmail: personalA.email,
        },
        includeAiSummary: false,
      };
      const convEgress = await fixtures.convRepo.createConversation(personalA.user.id, 'Org Egress', {
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
      });
      const egressSched = await insertTestSheetsDigestSchedule(db.pool, {
        userId: personalA.user.id,
        convId: convEgress.id,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        digestConfig: egressConfig as unknown as Record<string, unknown>,
      });
      const egressRow = (await scheduleRepo.ownedSchedule(egressSched.id, personalA.user.id))!;
      const runEgress = await insertPlanningRun(egressRow.id, egressRow.version);
      const resEgress = await digestRunner.executeDigest(egressRow, egressRow.version, runEgress);
      expect(resEgress).toEqual({
        status: 'blocked',
        pauseReason:
          'Chính sách bảo mật Tổ chức hiện chưa cho phép tự động gửi dữ liệu từ Google Sheets Tổ chức ra Gmail hoặc Telegram cá nhân.',
      });

      // 3. TC-03 (F-08): Personal Telegram never falls back to another user's telegram credential or unpinned telegram
      await credentialRepo.deletePersonalCredentials('telegram', personalA.user.id);

      const tgConfig: SheetsDigestConfigV2 = {
        version: 2,
        workspaceMode: 'legacy',
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
          service: 'telegram',
          credentialId: personalB.telegramCred.id, // Attempt to use personalB's telegram credential
          chatId: personalB.telegramGroupChatId,
        },
        includeAiSummary: false,
      };
      const convTg = await fixtures.convRepo.createConversation(personalA.user.id, 'F-08 Telegram');
      const tgSched = await insertTestSheetsDigestSchedule(db.pool, {
        userId: personalA.user.id,
        convId: convTg.id,
        workspaceMode: 'legacy',
        workspaceId: null,
        digestConfig: tgConfig as unknown as Record<string, unknown>,
      });
      const tgRow = (await scheduleRepo.ownedSchedule(tgSched.id, personalA.user.id))!;
      const runTg = await insertPlanningRun(tgRow.id, tgRow.version);
      const resTg = await digestRunner.executeDigest(tgRow, tgRow.version, runTg);
      expect(resTg.status).toBe('blocked');
      expect(spy.getCallCount()).toBe(0);
    });
  });

  describe('5. TC-24: Mandatory runId & Non-Bypassable Pre-Send Admission', () => {
    it('fails closed with 0 network calls when runId is invalid, non-existent, or already claimed', async () => {
      const { orgA, credentialRepo } = fixtures;
      const spy = createDigestProviderSpy();

      const v2Config: SheetsDigestConfigV2 = {
        version: 2,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        source: {
          service: 'sheets',
          credentialId: orgA.sheetsCred.id,
          spreadsheetId: orgA.spreadsheetId,
          spreadsheetTitle: orgA.spreadsheetTitle,
          tailRows: 20,
        },
        destination: {
          service: 'slack',
          credentialId: orgA.slackCred.id,
          channelId: orgA.slackChannelId,
        },
        includeAiSummary: false,
      };

      const sched = await insertTestSheetsDigestSchedule(db.pool, {
        userId: orgA.member.id,
        convId: orgA.conversation.id,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        digestConfig: v2Config as unknown as Record<string, unknown>,
      });
      const row = (await scheduleRepo.ownedSchedule(sched.id, orgA.member.id))!;

      const digestRunner = new SheetsDigestRunner({
        pool: db.pool,
        repo: scheduleRepo,
        credentialRepo,
        messageRepo,
        encryptionKey: DIGEST_TEST_ENC_KEY,
        mysheetsEnabled: true,
        createAdapter: spy.createAdapter,
      });

      // 1. Invalid UUID runId
      const badRunOutcome = await digestRunner.executeDigest(row, row.version, 'not-a-uuid');
      expect(badRunOutcome.status).toBe('digest_failed');
      expect(spy.getCallCount()).toBe(0);

      // 2. Non-existent UUID runId
      const missingRunOutcome = await digestRunner.executeDigest(
        row,
        row.version,
        '00000000-0000-4000-8000-000000000999'
      );
      expect(missingRunOutcome.status).toBe('digest_failed');
      expect(spy.getCallCount()).toBe(0);

      // 3. Already-claimed schedule_runs row (delivery_started_at IS NOT NULL)
      const claimedRunId = await insertPlanningRun(row.id, row.version);
      await db.pool.query('UPDATE schedule_runs SET delivery_started_at = now() WHERE id = $1', [claimedRunId]);

      const alreadyClaimedOutcome = await digestRunner.executeDigest(row, row.version, claimedRunId);
      expect(alreadyClaimedOutcome.status).toBe('digest_failed');
      expect(spy.getCallCount()).toBe(0);
    });
  });

  describe('6. TC-05, TC-06, TC-07, TC-08, TC-18: Real PostgreSQL Concurrency, Lock Graph & Two-Worker Claim', () => {
    it('TC-05: aborts with discarded and 0 sends when schedule is paused concurrently while reading Sheets', async () => {
      const { orgA, credentialRepo } = fixtures;
      const barrier = createBarrier();
      let slackSendCalls = 0;

      const v2Config: SheetsDigestConfigV2 = {
        version: 2,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        source: {
          service: 'sheets',
          credentialId: orgA.sheetsCred.id,
          spreadsheetId: orgA.spreadsheetId,
          spreadsheetTitle: orgA.spreadsheetTitle,
          tailRows: 20,
        },
        destination: {
          service: 'slack',
          credentialId: orgA.slackCred.id,
          channelId: orgA.slackChannelId,
        },
        includeAiSummary: false,
      };
      const sched = await insertTestSheetsDigestSchedule(db.pool, {
        userId: orgA.member.id,
        convId: orgA.conversation.id,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        digestConfig: v2Config as unknown as Record<string, unknown>,
      });

      const service = new ScheduleService({
        pool: db.pool,
        timeZone: TZ,
        credentialRepo,
        encryptionKey: DIGEST_TEST_ENC_KEY,
        mysheetsEnabled: true,
      });

      const digestRunner = new SheetsDigestRunner({
        pool: db.pool,
        repo: scheduleRepo,
        credentialRepo,
        messageRepo,
        encryptionKey: DIGEST_TEST_ENC_KEY,
        mysheetsEnabled: true,
        createAdapter: async (serviceId) => {
          if (serviceId === 'sheets') {
            return {
              execute: async () => {
                await barrier.wait();
                return {
                  headers: ['Task', 'Status'],
                  records: [{ Task: 'Item 1', Status: 'Done' }],
                  values: [['Task', 'Status'], ['Item 1', 'Done']],
                };
              },
            };
          }
          return {
            execute: async () => {
              slackSendCalls++;
              return { ok: true, ts: '1731000000.000100' };
            },
          };
        },
      });

      const row = (await scheduleRepo.ownedSchedule(sched.id, orgA.member.id))!;
      const runId = await insertPlanningRun(row.id, row.version);

      const execPromise = digestRunner.executeDigest(row, row.version, runId);
      await barrier.reached;

      // Pause schedule on real PostgreSQL while Sheets read is in flight (proves zero DB locks held during HTTP read)
      await service.setStatus({
        userId: orgA.member.id,
        scheduleId: sched.id,
        action: 'pause',
        version: row.version,
        now: new Date('2026-11-03T01:00:10.000Z'),
      });

      barrier.release();
      const outcome = await execPromise;

      expect(outcome).toEqual({ status: 'discarded' });
      expect(slackSendCalls).toBe(0);
      const runAfter = (await db.pool.query('SELECT delivery_started_at FROM schedule_runs WHERE id = $1', [runId])).rows[0];
      expect(runAfter.delivery_started_at).toBeNull();
    });

    it('TC-06: aborts with blocked and 0 sends when workspace member is deactivated concurrently during Sheets read', async () => {
      const { orgA, credentialRepo } = fixtures;
      const barrier = createBarrier();
      let slackSendCalls = 0;

      const v2Config: SheetsDigestConfigV2 = {
        version: 2,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        source: {
          service: 'sheets',
          credentialId: orgA.sheetsCred.id,
          spreadsheetId: orgA.spreadsheetId,
          spreadsheetTitle: orgA.spreadsheetTitle,
          tailRows: 20,
        },
        destination: {
          service: 'slack',
          credentialId: orgA.slackCred.id,
          channelId: orgA.slackChannelId,
        },
        includeAiSummary: false,
      };
      const sched = await insertTestSheetsDigestSchedule(db.pool, {
        userId: orgA.member.id,
        convId: orgA.conversation.id,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        digestConfig: v2Config as unknown as Record<string, unknown>,
      });

      const digestRunner = new SheetsDigestRunner({
        pool: db.pool,
        repo: scheduleRepo,
        credentialRepo,
        messageRepo,
        encryptionKey: DIGEST_TEST_ENC_KEY,
        mysheetsEnabled: true,
        createAdapter: async (serviceId) => {
          if (serviceId === 'sheets') {
            return {
              execute: async () => {
                await barrier.wait();
                return {
                  headers: ['Task', 'Status'],
                  records: [{ Task: 'Item 1', Status: 'Done' }],
                  values: [['Task', 'Status'], ['Item 1', 'Done']],
                };
              },
            };
          }
          return {
            execute: async () => {
              slackSendCalls++;
              return { ok: true, ts: '1731000000.000100' };
            },
          };
        },
      });

      const row = (await scheduleRepo.ownedSchedule(sched.id, orgA.member.id))!;
      const runId = await insertPlanningRun(row.id, row.version);

      const execPromise = digestRunner.executeDigest(row, row.version, runId);
      await barrier.reached;

      // Deactivate workspace member in PostgreSQL before claim
      await db.pool.query(
        "UPDATE workspace_members SET status = 'disabled' WHERE workspace_id = $1 AND user_id = $2",
        [orgA.workspaceId, orgA.member.id]
      );

      barrier.release();
      const outcome = await execPromise;

      expect(outcome.status).toBe('blocked');
      if (outcome.status === 'blocked') {
        expect(outcome.pauseReason).toMatch(/Quyền thành viên trong Tổ chức/i);
      }
      expect(slackSendCalls).toBe(0);
      const runAfter = (await db.pool.query('SELECT delivery_started_at FROM schedule_runs WHERE id = $1', [runId])).rows[0];
      expect(runAfter.delivery_started_at).toBeNull();
    });

    it('TC-07: aborts with blocked and 0 sends when credential scope is narrowed concurrently during Sheets read', async () => {
      const { orgA, credentialRepo } = fixtures;
      const barrier = createBarrier();
      let slackSendCalls = 0;

      const v2Config: SheetsDigestConfigV2 = {
        version: 2,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        source: {
          service: 'sheets',
          credentialId: orgA.sheetsCred.id,
          spreadsheetId: orgA.spreadsheetId,
          spreadsheetTitle: orgA.spreadsheetTitle,
          tailRows: 20,
        },
        destination: {
          service: 'slack',
          credentialId: orgA.slackCred.id,
          channelId: orgA.slackChannelId,
        },
        includeAiSummary: false,
      };
      const sched = await insertTestSheetsDigestSchedule(db.pool, {
        userId: orgA.member.id,
        convId: orgA.conversation.id,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        digestConfig: v2Config as unknown as Record<string, unknown>,
      });

      const digestRunner = new SheetsDigestRunner({
        pool: db.pool,
        repo: scheduleRepo,
        credentialRepo,
        messageRepo,
        encryptionKey: DIGEST_TEST_ENC_KEY,
        mysheetsEnabled: true,
        createAdapter: async (serviceId) => {
          if (serviceId === 'sheets') {
            return {
              execute: async () => {
                await barrier.wait();
                return {
                  headers: ['Task', 'Status'],
                  records: [{ Task: 'Item 1', Status: 'Done' }],
                  values: [['Task', 'Status'], ['Item 1', 'Done']],
                };
              },
            };
          }
          return {
            execute: async () => {
              slackSendCalls++;
              return { ok: true, ts: '1731000000.000100' };
            },
          };
        },
      });

      const row = (await scheduleRepo.ownedSchedule(sched.id, orgA.member.id))!;
      const runId = await insertPlanningRun(row.id, row.version);

      const execPromise = digestRunner.executeDigest(row, row.version, runId);
      await barrier.reached;

      // Narrow allowedScope in-place on service_credentials (preserving credential id!)
      const narrowedConfig = encryptCredentials(
        {
          clientEmail: 'sheets-sa@org-a.iam.gserviceaccount.com',
          privateKey: '-----BEGIN PRIVATE KEY-----\nFAKE_ORG_A_KEY\n-----END PRIVATE KEY-----\n',
          allowedScope: { spreadsheets: ['1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvOTHER'] },
        },
        DIGEST_TEST_ENC_KEY
      );
      await db.pool.query('UPDATE service_credentials SET config = $1 WHERE id = $2', [
        narrowedConfig,
        orgA.sheetsCred.id,
      ]);

      barrier.release();
      const outcome = await execPromise;

      expect(outcome.status).toBe('blocked');
      if (outcome.status === 'blocked') {
        expect(outcome.pauseReason).toMatch(/không còn trong phạm vi/i);
      }
      expect(slackSendCalls).toBe(0);
      const runAfter = (await db.pool.query('SELECT delivery_started_at FROM schedule_runs WHERE id = $1', [runId])).rows[0];
      expect(runAfter.delivery_started_at).toBeNull();
    });

    it('TC-08: admits recurrence.type = once schedule after tick() transitions schedules.status to completed', async () => {
      const { orgA, credentialRepo } = fixtures;
      const spy = createDigestProviderSpy();

      const onceRecurrence = { type: 'once' as const, date: '2026-11-03', time: '08:00' };
      const v2Config: SheetsDigestConfigV2 = {
        version: 2,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        source: {
          service: 'sheets',
          credentialId: orgA.sheetsCred.id,
          spreadsheetId: orgA.spreadsheetId,
          spreadsheetTitle: orgA.spreadsheetTitle,
          tailRows: 20,
        },
        destination: {
          service: 'slack',
          credentialId: orgA.slackCred.id,
          channelId: orgA.slackChannelId,
        },
        includeAiSummary: false,
      };
      const sched = await insertTestSheetsDigestSchedule(db.pool, {
        userId: orgA.member.id,
        convId: orgA.conversation.id,
        recurrence: onceRecurrence,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        nextRunAt: new Date('2026-11-03T01:00:00.000Z'),
        digestConfig: v2Config as unknown as Record<string, unknown>,
      });

      let runner!: ScheduleRunner;
      const service = new ScheduleService({
        pool: db.pool,
        timeZone: TZ,
        runner: { planNow: (runId) => runner.planNow(runId) },
        credentialRepo,
        encryptionKey: DIGEST_TEST_ENC_KEY,
        mysheetsEnabled: true,
      });
      const digestRunner = new SheetsDigestRunner({
        pool: db.pool,
        repo: scheduleRepo,
        credentialRepo,
        messageRepo,
        encryptionKey: DIGEST_TEST_ENC_KEY,
        mysheetsEnabled: true,
        createAdapter: spy.createAdapter,
      });
      runner = new ScheduleRunner({
        pool: db.pool,
        timeZone: TZ,
        planRun: vi.fn() as any,
        recordState: (client, row, now) => service.recordState(client, row, now),
        sheetsDigestRunner: digestRunner,
        now: () => new Date('2026-11-03T01:00:05.000Z'),
      });

      await runner.tick();

      const schedAfter = await scheduleRepo.ownedSchedule(sched.id, orgA.member.id);
      expect(schedAfter?.status).toBe('completed');
      expect(spy.getCallCount({ service: 'slack', credentialId: orgA.slackCred.id })).toBe(1);

      const runs = await service.listRuns(orgA.member.id, sched.id, 5, new Date('2026-11-03T01:01:00.000Z'));
      expect(runs[0]?.state).toBe('digest_sent');
    });

    it('TC-18: guarantees at most 1 outbound send when two workers concurrently claim the same runId and retries 55P03 lock contention with 0 deadlocks', async () => {
      const { orgA, credentialRepo } = fixtures;
      let slackSendCalls = 0;

      const v2Config: SheetsDigestConfigV2 = {
        version: 2,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        source: {
          service: 'sheets',
          credentialId: orgA.sheetsCred.id,
          spreadsheetId: orgA.spreadsheetId,
          spreadsheetTitle: orgA.spreadsheetTitle,
          tailRows: 20,
        },
        destination: {
          service: 'slack',
          credentialId: orgA.slackCred.id,
          channelId: orgA.slackChannelId,
        },
        includeAiSummary: false,
      };
      const sched = await insertTestSheetsDigestSchedule(db.pool, {
        userId: orgA.member.id,
        convId: orgA.conversation.id,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        digestConfig: v2Config as unknown as Record<string, unknown>,
      });

      const createWorkerRunner = () =>
        new SheetsDigestRunner({
          pool: db.pool,
          repo: scheduleRepo,
          credentialRepo,
          messageRepo,
          encryptionKey: DIGEST_TEST_ENC_KEY,
          mysheetsEnabled: true,
          createAdapter: async (serviceId) => {
            if (serviceId === 'sheets') {
              return {
                execute: async () => ({
                  headers: ['Task', 'Status'],
                  records: [{ Task: 'Item 1', Status: 'Done' }],
                  values: [['Task', 'Status'], ['Item 1', 'Done']],
                }),
              };
            }
            return {
              execute: async () => {
                slackSendCalls++;
                return { ok: true, ts: '1731000000.000100' };
              },
            };
          },
        });

      const worker1 = createWorkerRunner();
      const worker2 = createWorkerRunner();

      const row = (await scheduleRepo.ownedSchedule(sched.id, orgA.member.id))!;
      const runId1 = await insertPlanningRun(row.id, row.version, '2026-11-03T01:00:00.000Z');

      // Part 1: Two workers simultaneously invoke executeDigest on the same planning runId
      const [out1, out2] = await Promise.all([
        worker1.executeDigest(row, row.version, runId1),
        worker2.executeDigest(row, row.version, runId1),
      ]);

      const sentOutcomes = [out1, out2].filter((o) => o.status === 'digest_sent');
      expect(sentOutcomes).toHaveLength(1);
      expect(slackSendCalls).toBe(1);

      // Part 2: Hold a brief FOR UPDATE lock on users from a separate PoolClient to trigger 55P03 on FOR SHARE NOWAIT, then release
      const runId2 = await insertPlanningRun(row.id, row.version, '2026-11-03T02:00:00.000Z');
      const lockClient = await db.pool.connect();
      try {
        await lockClient.query('BEGIN');
        await lockClient.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [orgA.member.id]);

        const releaseTimer = setTimeout(async () => {
          await lockClient.query('COMMIT').catch(() => undefined);
        }, 45);

        const retryOutcome = await worker1.executeDigest(row, row.version, runId2);
        clearTimeout(releaseTimer);
        expect(retryOutcome.status).toBe('digest_sent');
        expect(slackSendCalls).toBe(2);
      } finally {
        await lockClient.query('ROLLBACK').catch(() => undefined);
        lockClient.release();
      }
    });

    it('Linearization boundary (T_claim < T_revoke vs T_revoke < T_claim): revocation during in-flight post-claim HTTP send commits immediately without DB lock contention, allows the 1 already-claimed send to complete, and blocks any subsequent run with 0 sends', async () => {
      const { personalA, credentialRepo } = fixtures;
      const sendBarrier = createBarrier();
      let gmailSendCalls = 0;

      const v2Config: SheetsDigestConfigV2 = {
        version: 2,
        workspaceMode: 'personal',
        workspaceId: null,
        source: {
          service: 'mysheets',
          credentialId: personalA.mysheetsCred.id,
          email: personalA.email,
          spreadsheetId: personalA.spreadsheetId,
          spreadsheetTitle: personalA.spreadsheetTitle,
          tailRows: 20,
        },
        destination: {
          service: 'gmail',
          credentialId: personalA.gmailCred.id,
          senderEmail: personalA.email,
          recipientEmail: 'ceo@company.test',
        },
        includeAiSummary: false,
      };

      const sched = await insertTestSheetsDigestSchedule(db.pool, {
        userId: personalA.user.id,
        convId: personalA.conversation.id,
        workspaceMode: 'personal',
        workspaceId: null,
        digestConfig: v2Config as unknown as Record<string, unknown>,
      });

      const digestRunner = new SheetsDigestRunner({
        pool: db.pool,
        repo: scheduleRepo,
        credentialRepo,
        messageRepo,
        encryptionKey: DIGEST_TEST_ENC_KEY,
        mysheetsEnabled: true,
        createAdapter: async (serviceId) => {
          if (serviceId === 'mysheets') {
            return {
              execute: async () => ({
                headers: ['Task', 'Status'],
                records: [{ Task: 'Item 1', Status: 'Done' }],
                values: [['Task', 'Status'], ['Item 1', 'Done']],
              }),
            };
          }
          return {
            execute: async () => {
              await sendBarrier.wait();
              gmailSendCalls++;
              return { id: 'gmail-msg-linear-1', threadId: 'th-linear-1' };
            },
          };
        },
      });

      const row = (await scheduleRepo.ownedSchedule(sched.id, personalA.user.id))!;
      const run1Id = await insertPlanningRun(row.id, row.version, '2026-11-03T01:00:00.000Z');

      // Start Run 1; wait until claimSheetsDigestDelivery has committed delivery_started_at and destAdapter.execute is in flight
      const run1Promise = digestRunner.executeDigest(row, row.version, run1Id);
      await sendBarrier.reached;

      // Verify delivery_started_at is already committed in PostgreSQL (T_claim)
      const claimedRunRow = (
        await db.pool.query('SELECT delivery_started_at FROM schedule_runs WHERE id = $1', [run1Id])
      ).rows[0];
      expect(claimedRunRow.delivery_started_at).toBeInstanceOf(Date);

      // Now execute credential revocation at T_revoke > T_claim while outbound HTTP call is still paused on sendBarrier
      const revokeStartMs = Date.now();
      const revoked = await credentialRepo.markReconnectRequired(
        'gmail',
        personalA.user.id,
        personalA.gmailCred.id
      );
      const revokeElapsedMs = Date.now() - revokeStartMs;
      expect(revoked).toBe(true);
      // Zero DB locks are held during outbound HTTP send, so revocation commits immediately without blocking
      expect(revokeElapsedMs).toBeLessThan(1000);

      // Release in-flight HTTP send: Run 1 (admitted at T_claim < T_revoke) completes its single send
      sendBarrier.release();
      const run1Outcome = await run1Promise;
      expect(run1Outcome.status).toBe('digest_sent');
      expect(gmailSendCalls).toBe(1);

      // Subsequent Run 2 (T_revoke < T_claim_2) fails closed ('blocked') with 0 additional sends
      const run2Id = await insertPlanningRun(row.id, row.version, '2026-11-03T02:00:00.000Z');
      const run2Outcome = await digestRunner.executeDigest(row, row.version, run2Id);
      expect(run2Outcome.status).toBe('blocked');
      expect(gmailSendCalls).toBe(1);
    });
  });

  describe('7. TC-09 & AUD-W1-06: Real HTTP Slack Fixture — Ambiguous Post-Claim Failure, Zero Retries & Write-Once delivery_started_at', () => {
    it('classifies socket drop (SlackAdapter StepError category=NETWORK, retryable=true), HTTP 502, missing ts receipt, and post-claim crash as needs_attention with SHEETS_DELIVERY_UNKNOWN and 0 retries', async () => {
      const { orgA, credentialRepo } = fixtures;
      let serverBehavior: 'drop_socket' | 'http_502' | 'missing_ts' = 'drop_socket';
      let receivedPostCount = 0;

      const server = http.createServer((req, res) => {
        if (req.method === 'POST' && req.url?.includes('/chat.postMessage')) {
          receivedPostCount++;
          // Consume request body
          req.on('data', () => undefined);
          req.on('end', () => {
            if (serverBehavior === 'drop_socket') {
              req.socket.destroy();
              return;
            }
            if (serverBehavior === 'http_502') {
              res.writeHead(502, { 'Content-Type': 'text/plain' });
              res.end('Bad Gateway');
              return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, channel: orgA.slackChannelId })); // Missing `ts` receipt!
          });
          return;
        }
        res.writeHead(404);
        res.end();
      });

      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const baseUrl = `http://127.0.0.1:${port}`;

      try {
        const v2Config: SheetsDigestConfigV2 = {
          version: 2,
          workspaceMode: 'organization',
          workspaceId: orgA.workspaceId,
          source: {
            service: 'sheets',
            credentialId: orgA.sheetsCred.id,
            spreadsheetId: orgA.spreadsheetId,
            spreadsheetTitle: orgA.spreadsheetTitle,
            tailRows: 20,
          },
          destination: {
            service: 'slack',
            credentialId: orgA.slackCred.id,
            channelId: orgA.slackChannelId,
          },
          includeAiSummary: false,
        };
        const sched = await insertTestSheetsDigestSchedule(db.pool, {
          userId: orgA.member.id,
          convId: orgA.conversation.id,
          workspaceMode: 'organization',
          workspaceId: orgA.workspaceId,
          digestConfig: v2Config as unknown as Record<string, unknown>,
        });

        const realSlackAdapter = new SlackAdapter({
          credentials: { botToken: 'xoxb-real-http-fixture-token' },
          allowedScope: { channels: [orgA.slackChannelId] },
          baseUrl,
        });

        let runner!: ScheduleRunner;
        const service = new ScheduleService({
          pool: db.pool,
          timeZone: TZ,
          runner: { planNow: (runId) => runner.planNow(runId) },
          credentialRepo,
          encryptionKey: DIGEST_TEST_ENC_KEY,
          mysheetsEnabled: true,
        });
        const digestRunner = new SheetsDigestRunner({
          pool: db.pool,
          repo: scheduleRepo,
          credentialRepo,
          messageRepo,
          encryptionKey: DIGEST_TEST_ENC_KEY,
          mysheetsEnabled: true,
          createAdapter: async (serviceId) => {
            if (serviceId === 'sheets') {
              return {
                execute: async () => ({
                  headers: ['Hạng mục', 'Trạng thái'],
                  records: [{ 'Hạng mục': 'KPI A', 'Trạng thái': 'Hoàn thành' }],
                  values: [['Hạng mục', 'Trạng thái'], ['KPI A', 'Hoàn thành']],
                }),
              };
            }
            return realSlackAdapter;
          },
        });
        runner = new ScheduleRunner({
          pool: db.pool,
          timeZone: TZ,
          planRun: vi.fn() as any,
          recordState: (client, row, now) => service.recordState(client, row, now),
          sheetsDigestRunner: digestRunner,
          now: () => new Date('2026-11-03T01:00:05.000Z'),
        });

        // Scenario A: Socket dropped after POST received (SlackAdapter throws StepError category=NETWORK, retryable=true)
        serverBehavior = 'drop_socket';
        receivedPostCount = 0;
        const runA = await service.startRun({
          userId: orgA.member.id,
          scheduleId: sched.id,
          trigger: 'manual',
          now: new Date('2026-11-03T01:01:00.000Z'),
        });
        await runner.planNow(runA.id);

        expect(receivedPostCount).toBe(1); // Strictly 1 POST, 0 retries!
        const dbRunA = (
          await db.pool.query(
            'SELECT status, error, delivery, delivery_started_at FROM schedule_runs WHERE id = $1',
            [runA.id]
          )
        ).rows[0];
        expect(dbRunA.status).toBe('needs_attention');
        expect(dbRunA.error).toBe(SHEETS_DELIVERY_UNKNOWN);
        expect(dbRunA.delivery).toBeNull();
        expect(dbRunA.delivery_started_at).toBeInstanceOf(Date);

        // Scenario B1: HTTP 502 Bad Gateway
        serverBehavior = 'http_502';
        receivedPostCount = 0;
        const runB1 = await service.startRun({
          userId: orgA.member.id,
          scheduleId: sched.id,
          trigger: 'manual',
          now: new Date('2026-11-03T01:02:00.000Z'),
        });
        await runner.planNow(runB1.id);
        expect(receivedPostCount).toBe(1);
        const dbRunB1 = (
          await db.pool.query(
            'SELECT status, error, delivery_started_at FROM schedule_runs WHERE id = $1',
            [runB1.id]
          )
        ).rows[0];
        expect(dbRunB1.status).toBe('needs_attention');
        expect(dbRunB1.error).toBe(SHEETS_DELIVERY_UNKNOWN);
        expect(dbRunB1.delivery_started_at).toBeInstanceOf(Date);

        // Scenario B2: HTTP 200 OK with missing `ts` receipt
        serverBehavior = 'missing_ts';
        receivedPostCount = 0;
        const runB2 = await service.startRun({
          userId: orgA.member.id,
          scheduleId: sched.id,
          trigger: 'manual',
          now: new Date('2026-11-03T01:03:00.000Z'),
        });
        await runner.planNow(runB2.id);
        expect(receivedPostCount).toBe(1);
        const dbRunB2 = (
          await db.pool.query(
            'SELECT status, error, delivery_started_at FROM schedule_runs WHERE id = $1',
            [runB2.id]
          )
        ).rows[0];
        expect(dbRunB2.status).toBe('needs_attention');
        expect(dbRunB2.error).toBe(SHEETS_DELIVERY_UNKNOWN);
        expect(dbRunB2.delivery_started_at).toBeInstanceOf(Date);

        // Schedule must remain active (needs_attention does not trigger 3-strike digest_failed pause)
        const schedAfter = await scheduleRepo.ownedSchedule(sched.id, orgA.member.id);
        expect(schedAfter?.status).toBe('active');

        // Scenario C: reconcileScheduleRuns marks crashed post-claim sheets_digest run with SHEETS_DELIVERY_UNKNOWN
        const crashedRunId = await insertPlanningRun(sched.id, sched.version, '2026-11-03T04:00:00.000Z');
        await db.pool.query(
          'UPDATE schedule_runs SET delivery_started_at = now(), conv_id = $2 WHERE id = $1',
          [crashedRunId, orgA.conversation.id]
        );
        await reconcileScheduleRuns(db.pool);
        const reconciledRun = (
          await db.pool.query(
            'SELECT status, error, delivery_started_at FROM schedule_runs WHERE id = $1',
            [crashedRunId]
          )
        ).rows[0];
        expect(reconciledRun.status).toBe('needs_attention');
        expect(reconciledRun.error).toBe(SHEETS_DELIVERY_UNKNOWN);
        expect(reconciledRun.delivery_started_at).toBeInstanceOf(Date);

        // Scenario D: Post-claim StepError(category=UNKNOWN, statusCode=400) and StepError(category=RATE_LIMIT, statusCode=403, retryable=true) classify as delivery_unknown
        const rowForStepErrors = (await scheduleRepo.ownedSchedule(sched.id, orgA.member.id))!;
        let nextPostClaimErr: Error = new StepError({
          message: 'Contradictory envelope',
          category: 'UNKNOWN',
          statusCode: 400,
          retryable: false,
        });
        const stepErrRunner = new SheetsDigestRunner({
          pool: db.pool,
          repo: scheduleRepo,
          credentialRepo,
          messageRepo,
          encryptionKey: DIGEST_TEST_ENC_KEY,
          mysheetsEnabled: true,
          createAdapter: async (serviceId) => {
            if (serviceId === 'sheets') {
              return {
                execute: async () => ({
                  headers: ['Hạng mục', 'Trạng thái'],
                  records: [{ 'Hạng mục': 'KPI A', 'Trạng thái': 'Hoàn thành' }],
                  values: [['Hạng mục', 'Trạng thái'], ['KPI A', 'Hoàn thành']],
                }),
              };
            }
            return {
              execute: async () => {
                throw nextPostClaimErr;
              },
            };
          },
        });

        const runD1 = await insertPlanningRun(sched.id, rowForStepErrors.version, '2026-11-03T05:00:00.000Z');
        const outD1 = await stepErrRunner.executeDigest(rowForStepErrors, rowForStepErrors.version, runD1);
        expect(outD1).toEqual({
          status: 'delivery_unknown',
          error: SHEETS_DELIVERY_UNKNOWN,
        });

        nextPostClaimErr = new StepError({
          message: 'Quota exceeded',
          category: 'RATE_LIMIT',
          statusCode: 403,
          retryable: true,
        });
        const runD2 = await insertPlanningRun(sched.id, rowForStepErrors.version, '2026-11-03T06:00:00.000Z');
        const outD2 = await stepErrRunner.executeDigest(rowForStepErrors, rowForStepErrors.version, runD2);
        expect(outD2).toEqual({
          status: 'delivery_unknown',
          error: SHEETS_DELIVERY_UNKNOWN,
        });
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });

  describe('8. TC-11, TC-12, TC-16: 3-Tier Honest dataScope Formatting via readDigestWindow', () => {
    it('calls readDigestWindow when present, formats all 4 dataScope tiers accurately, and persists dataScope metadata in delivery', async () => {
      const { orgA, credentialRepo } = fixtures;

      const v2Config: SheetsDigestConfigV2 = {
        version: 2,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        source: {
          service: 'sheets',
          credentialId: orgA.sheetsCred.id,
          spreadsheetId: orgA.spreadsheetId,
          spreadsheetTitle: orgA.spreadsheetTitle,
          sheetName: 'Tasks',
          tailRows: 20,
        },
        destination: {
          service: 'slack',
          credentialId: orgA.slackCred.id,
          channelId: orgA.slackChannelId,
        },
        includeAiSummary: false,
      };
      const sched = await insertTestSheetsDigestSchedule(db.pool, {
        userId: orgA.member.id,
        convId: orgA.conversation.id,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        digestConfig: v2Config as unknown as Record<string, unknown>,
      });
      const row = (await scheduleRepo.ownedSchedule(sched.id, orgA.member.id))!;

      let mockWindowResult!: ReadDigestWindowResult;
      const readDigestWindowSpy = vi.fn(async () => mockWindowResult);

      const digestRunner = new SheetsDigestRunner({
        pool: db.pool,
        repo: scheduleRepo,
        credentialRepo,
        messageRepo,
        encryptionKey: DIGEST_TEST_ENC_KEY,
        mysheetsEnabled: true,
        createAdapter: async (serviceId) => {
          if (serviceId === 'sheets') {
            return {
              execute: vi.fn(async () => {
                throw new Error('execute should not be called when readDigestWindow is present');
              }),
              readDigestWindow: readDigestWindowSpy,
            };
          }
          return {
            execute: async () => ({ ok: true, channel: orgA.slackChannelId, ts: '1731000000.000500' }),
          };
        },
      });

      const makeRows = (count: number) => {
        const records = Array.from({ length: count }, (_, idx) => ({
          Task: `Hạng mục ${idx + 1}`,
          Status: 'Hoàn thành',
          'Doanh thu': '1000',
        }));
        const values = [
          ['Task', 'Status', 'Doanh thu'],
          ...records.map((r) => [r.Task, r.Status, r['Doanh thu']]),
        ];
        return { headers: ['Task', 'Status', 'Doanh thu'], records, values };
      };

      // Case 1: full_tab_verified (<= 501 grid capacity)
      const data20 = makeRows(20);
      mockWindowResult = {
        spreadsheetId: orgA.spreadsheetId,
        sheetTitle: 'Tasks',
        scannedRange: 'Tasks!A1:Z502',
        explicitRangeRequested: false,
        dataScope: 'full_tab_verified',
        windowClipped: false,
        rowLimitExceeded: false,
        columnLimitExceeded: false,
        gridRowCapacity: 200,
        gridColumnCapacity: 10,
        populatedRowCountInWindow: 20,
        totalDataRows: 20,
        ...data20,
        tailRecords: data20.records,
        tailValues: data20.values,
      };
      const out1 = await digestRunner.executeDigest(
        row,
        row.version,
        await insertPlanningRun(row.id, row.version, '2026-11-03T01:00:00.000Z')
      );
      expect(out1.status).toBe('digest_sent');
      if (out1.status === 'digest_sent') {
        expect(out1.text).toContain(
          'Phạm vi dữ liệu: Đã xác minh toàn bộ trang tính (Tasks!A1:Z502 · 20 dòng có dữ liệu).'
        );
        expect(out1.delivery).toMatchObject({
          dataScope: 'full_tab_verified',
          scannedRange: 'Tasks!A1:Z502',
          windowClipped: false,
          rowCount: 20,
        });
      }

      // Case 2: full_requested_range (explicit range Tasks!A1:F100)
      const data50 = makeRows(50);
      mockWindowResult = {
        ...mockWindowResult,
        scannedRange: 'Tasks!A1:F100',
        explicitRangeRequested: true,
        dataScope: 'full_requested_range',
        windowClipped: false,
        populatedRowCountInWindow: 50,
        totalDataRows: 50,
        ...data50,
        tailRecords: data50.records,
        tailValues: data50.values,
      };
      const out2 = await digestRunner.executeDigest(
        row,
        row.version,
        await insertPlanningRun(row.id, row.version, '2026-11-03T02:00:00.000Z')
      );
      expect(out2.status).toBe('digest_sent');
      if (out2.status === 'digest_sent') {
        expect(out2.text).toContain(
          'Phạm vi dữ liệu: Toàn bộ vùng yêu cầu (Tasks!A1:F100 · 50 dòng có dữ liệu).'
        );
        expect(out2.delivery).toMatchObject({
          dataScope: 'full_requested_range',
          scannedRange: 'Tasks!A1:F100',
          windowClipped: false,
          rowCount: 50,
        });
      }

      // Case 3a: partial with windowClipped = false (20 populated rows on 1,000-row default grid)
      mockWindowResult = {
        ...mockWindowResult,
        scannedRange: 'Tasks!A1:Z502',
        explicitRangeRequested: false,
        dataScope: 'partial',
        windowClipped: false,
        gridRowCapacity: 1000,
        gridColumnCapacity: 26,
        populatedRowCountInWindow: 20,
        totalDataRows: 20,
        ...data20,
        tailRecords: data20.records,
        tailValues: data20.values,
      };
      const out3a = await digestRunner.executeDigest(
        row,
        row.version,
        await insertPlanningRun(row.id, row.version, '2026-11-03T03:00:00.000Z')
      );
      expect(out3a.status).toBe('digest_sent');
      if (out3a.status === 'digest_sent') {
        expect(out3a.text).toContain(
          'Phạm vi dữ liệu (trong vùng đã quét Tasks!A1:Z502): Ghi nhận 20 dòng có dữ liệu trong vùng quét (không quét ngoài vùng Tasks!A1:Z502).'
        );
        expect(out3a.text).not.toContain('1000');
        expect(out3a.delivery).toMatchObject({
          dataScope: 'partial',
          scannedRange: 'Tasks!A1:Z502',
          windowClipped: false,
          rowCount: 20,
        });
      }

      // Case 3b: partial with windowClipped = true (500 rows capped from >500-row sheet)
      const data500 = makeRows(500);
      mockWindowResult = {
        ...mockWindowResult,
        scannedRange: 'Tasks!A1:Z502',
        explicitRangeRequested: false,
        dataScope: 'partial',
        windowClipped: true,
        rowLimitExceeded: true,
        gridRowCapacity: 1000,
        gridColumnCapacity: 26,
        populatedRowCountInWindow: 500,
        totalDataRows: 500,
        ...data500,
        tailRecords: data500.records.slice(-20),
        tailValues: data500.values.slice(-20),
      };
      const out3b = await digestRunner.executeDigest(
        row,
        row.version,
        await insertPlanningRun(row.id, row.version, '2026-11-03T04:00:00.000Z')
      );
      expect(out3b.status).toBe('digest_sent');
      if (out3b.status === 'digest_sent') {
        expect(out3b.text).toContain(
          '⚠️ Phạm vi dữ liệu một phần (partial — vượt giới hạn quét Tasks!A1:Z502): Chỉ thống kê trên 500 dòng dữ liệu đầu tiên trong vùng đã quét (KHÔNG phải tổng toàn bảng).'
        );
        expect(out3b.text).toContain('Tổng Doanh thu: 500,000');
        expect(out3b.delivery).toMatchObject({
          dataScope: 'partial',
          scannedRange: 'Tasks!A1:Z502',
          windowClipped: true,
          rowCount: 500,
        });
      }
      expect(readDigestWindowSpy).toHaveBeenCalledTimes(4);
    });
  });
});
