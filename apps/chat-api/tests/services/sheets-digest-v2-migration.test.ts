import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
import {
  DIGEST_TEST_ENC_KEY,
  insertTestSheetsDigestSchedule,
  seedSheetsDigestTenants,
  type SheetsDigestTenantFixtures,
} from '../helpers/sheets-digest-tenant-fixtures.js';
import { computeSheetsDigestHash } from '../../src/services/schedules/sheets-digest-candidate.js';
import {
  REAUTH_REQUIRED_PAUSE_REASON,
  runSheetsDigestV2Migration,
} from '../../src/services/schedules/sheets-digest-v2-migration.js';
import { parseMigrationCliArgs } from '../../src/scripts/sheets-digest-v2-migrate.js';

describe('RMD-01 (PR-6): Controlled V1->V2 Migration CLI & CAS Rollback Tool', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let fixtures: SheetsDigestTenantFixtures;

  const credCreatedAt = new Date('2026-11-01T00:00:00.000Z');
  const approvedAt = new Date('2026-11-02T00:00:00.000Z');
  const postApprovalTime = new Date('2026-11-05T00:00:00.000Z');

  beforeAll(async () => {
    db = await createMigratedSchema('sheets_digest_rmd01_migration');
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
      'UPDATE service_credentials SET created_at = $1, status_changed_at = NULL WHERE id IN ($2, $3, $4, $5)',
      [
        credCreatedAt,
        fixtures.personalA.mysheetsCred.id,
        fixtures.personalA.gmailCred.id,
        fixtures.personalB.mysheetsCred.id,
        fixtures.personalB.gmailCred.id,
      ]
    );
  });

  async function seedMixedSchedules() {
    const { personalA, personalB, orgA, convRepo } = fixtures;

    // 1. Class A (`v1_pinned_consistency_candidate`): Personal A mysheets -> gmail (v1)
    const schedClassA = await insertTestSheetsDigestSchedule(db.pool, {
      userId: personalA.user.id,
      convId: personalA.conversation.id,
      workspaceMode: 'personal',
      workspaceId: null,
      digestApprovedAt: approvedAt,
      digestConfig: {
        version: 1,
        source: {
          service: 'mysheets',
          credentialId: personalA.mysheetsCred.id,
          email: personalA.email,
          spreadsheetId: personalA.spreadsheetId,
          spreadsheetTitle: personalA.spreadsheetTitle,
          sheetName: 'KPI Tháng 11',
          tailRows: 20,
        },
        destination: {
          service: 'gmail',
          credentialId: personalA.gmailCred.id,
          recipientEmail: 'finance@company.test',
        },
        includeAiSummary: true,
      },
    });

    // 2. Class B (`v1_unpinned_fail_closed`): Org A sheets -> slack (v1 unpinned)
    const schedOrgClassB = await insertTestSheetsDigestSchedule(db.pool, {
      userId: orgA.member.id,
      convId: orgA.conversation.id,
      workspaceMode: 'organization',
      workspaceId: orgA.workspaceId,
      digestApprovedAt: approvedAt,
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
        includeAiSummary: true,
      },
    });

    // 3. Class B (`v1_unpinned_fail_closed`): Personal A mysheets -> telegram (v1 unpinned dest)
    const convPersonalATg = await convRepo.createConversation(
      personalA.user.id,
      'Hội thoại Cá nhân A Telegram',
      { workspaceMode: 'personal', workspaceId: null }
    );
    const schedTelegramClassB = await insertTestSheetsDigestSchedule(db.pool, {
      userId: personalA.user.id,
      convId: convPersonalATg.id,
      workspaceMode: 'personal',
      workspaceId: null,
      digestApprovedAt: approvedAt,
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
          service: 'telegram',
          chatId: personalA.telegramGroupChatId,
          chatLabel: 'Nhóm KPI Cá nhân A',
        },
        includeAiSummary: true,
      },
    });

    // 4. Class B (`v1_unpinned_fail_closed`): Personal B mysheets -> gmail where source credential was rotated after approval
    await db.pool.query(
      'UPDATE service_credentials SET status_changed_at = $1 WHERE id = $2',
      [postApprovalTime, personalB.mysheetsCred.id]
    );
    const schedRotatedClassB = await insertTestSheetsDigestSchedule(db.pool, {
      userId: personalB.user.id,
      convId: personalB.conversation.id,
      workspaceMode: 'personal',
      workspaceId: null,
      digestApprovedAt: approvedAt,
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
          recipientEmail: personalB.email,
        },
        includeAiSummary: true,
      },
    });

    // 5. Already V2 (`v2_ready`): Personal A v2 schedule
    const convPersonalAV2 = await convRepo.createConversation(
      personalA.user.id,
      'Hội thoại Cá nhân A V2',
      { workspaceMode: 'personal', workspaceId: null }
    );
    const schedV2Ready = await insertTestSheetsDigestSchedule(db.pool, {
      userId: personalA.user.id,
      convId: convPersonalAV2.id,
      workspaceMode: 'personal',
      workspaceId: null,
      digestApprovedAt: approvedAt,
      digestConfig: {
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
          recipientEmail: 'board@company.test',
        },
        includeAiSummary: false,
      },
    });

    // 6. Inactive V1 (`status = 'paused'`): Personal A paused v1 schedule
    const convPersonalAPaused = await convRepo.createConversation(
      personalA.user.id,
      'Hội thoại Cá nhân A Paused',
      { workspaceMode: 'personal', workspaceId: null }
    );
    const schedPausedV1 = await insertTestSheetsDigestSchedule(db.pool, {
      userId: personalA.user.id,
      convId: convPersonalAPaused.id,
      workspaceMode: 'personal',
      workspaceId: null,
      status: 'paused',
      digestApprovedAt: approvedAt,
      digestConfig: {
        version: 1,
        source: {
          service: 'mysheets',
          spreadsheetId: personalA.spreadsheetId,
          spreadsheetTitle: personalA.spreadsheetTitle,
          tailRows: 20,
        },
        destination: {
          service: 'telegram',
          chatId: personalA.telegramGroupChatId,
        },
        includeAiSummary: true,
      },
    });

    return {
      schedClassA,
      schedOrgClassB,
      schedTelegramClassB,
      schedRotatedClassB,
      schedV2Ready,
      schedPausedV1,
    };
  }

  it('1. --mode=inventory and --mode=dry-run classify Class A, Class B, and v2_ready with 0 DB writes', async () => {
    const seeded = await seedMixedSchedules();

    const beforeSchedules = (
      await db.pool.query(
        'SELECT id, status, pause_reason, next_run_at, version, digest_config, digest_config_hash, updated_at FROM schedules ORDER BY id ASC'
      )
    ).rows;

    const invReport = await runSheetsDigestV2Migration(db.pool, {
      mode: 'inventory',
      encryptionKey: DIGEST_TEST_ENC_KEY,
    });

    expect(invReport.mode).toBe('inventory');
    expect(invReport.summary.totalSchedules).toBe(6);
    expect(invReport.summary.countsByClass).toEqual({
      v1_pinned_consistency_candidate: 1,
      v1_unpinned_fail_closed: 4,
      v2_ready: 1,
    });
    expect(invReport.summary.evidenceBoundaryNote).toContain('does NOT prove config immutability');

    const byIdInv = new Map(invReport.items.map((i) => [i.scheduleId, i]));
    expect(byIdInv.get(seeded.schedClassA.id)).toMatchObject({
      compatClass: 'v1_pinned_consistency_candidate',
      evidenceBoundary: 'consistency_only_not_config_immutability_proof',
    });
    expect(byIdInv.get(seeded.schedOrgClassB.id)).toMatchObject({
      compatClass: 'v1_unpinned_fail_closed',
      evidenceBoundary: 'unpinned_or_inconsistent',
    });
    expect(byIdInv.get(seeded.schedV2Ready.id)).toMatchObject({
      compatClass: 'v2_ready',
      evidenceBoundary: 'v2_pinned',
    });

    // Dry-run under default strict_pause_all
    const dryRunStrict = await runSheetsDigestV2Migration(db.pool, {
      mode: 'dry-run',
      encryptionKey: DIGEST_TEST_ENC_KEY,
    });
    expect(dryRunStrict.v1CompatPolicy).toBe('strict_pause_all');
    expect(dryRunStrict.summary.countsByOutcome).toEqual({
      upgraded_v2: 0,
      paused_reauth_required: 4,
      already_v2: 1,
      inactive_preserved: 1,
    });

    // Dry-run under allow_consistency_candidate
    const dryRunAllow = await runSheetsDigestV2Migration(db.pool, {
      mode: 'dry-run',
      v1CompatPolicy: 'allow_consistency_candidate',
      encryptionKey: DIGEST_TEST_ENC_KEY,
    });
    expect(dryRunAllow.v1CompatPolicy).toBe('allow_consistency_candidate');
    expect(dryRunAllow.summary.countsByOutcome).toEqual({
      upgraded_v2: 1,
      paused_reauth_required: 3,
      already_v2: 1,
      inactive_preserved: 1,
    });

    // Verify 0 writes to schedules, sheets_digest_v2_migration_audit, and messages
    const afterSchedules = (
      await db.pool.query(
        'SELECT id, status, pause_reason, next_run_at, version, digest_config, digest_config_hash, updated_at FROM schedules ORDER BY id ASC'
      )
    ).rows;
    expect(afterSchedules).toEqual(beforeSchedules);

    const auditCount = await db.pool.query('SELECT count(*)::int AS n FROM sheets_digest_v2_migration_audit');
    expect(auditCount.rows[0].n).toBe(0);

    const msgCount = await db.pool.query('SELECT count(*)::int AS n FROM messages');
    expect(msgCount.rows[0].n).toBe(0);
  });

  it('2. --mode=apply without confirmProductionApply throws CONFIRM_PRODUCTION_APPLY_REQUIRED and mutates 0 rows', async () => {
    await seedMixedSchedules();
    const beforeSchedules = (
      await db.pool.query(
        'SELECT id, status, pause_reason, version, digest_config, digest_config_hash FROM schedules ORDER BY id ASC'
      )
    ).rows;

    await expect(
      runSheetsDigestV2Migration(db.pool, {
        mode: 'apply',
        encryptionKey: DIGEST_TEST_ENC_KEY,
      })
    ).rejects.toThrow(/CONFIRM_PRODUCTION_APPLY_REQUIRED/);

    const afterSchedules = (
      await db.pool.query(
        'SELECT id, status, pause_reason, version, digest_config, digest_config_hash FROM schedules ORDER BY id ASC'
      )
    ).rows;
    expect(afterSchedules).toEqual(beforeSchedules);

    const auditCount = await db.pool.query('SELECT count(*)::int AS n FROM sheets_digest_v2_migration_audit');
    expect(auditCount.rows[0].n).toBe(0);
  });

  it('3. --mode=apply with default strict_pause_all pauses 100% of active v1 schedules (Class A + Class B), writes audit & notifications, and preserves v2/inactive', async () => {
    const seeded = await seedMixedSchedules();

    const applyReport = await runSheetsDigestV2Migration(db.pool, {
      mode: 'apply',
      confirmProductionApply: true,
      encryptionKey: DIGEST_TEST_ENC_KEY,
    });

    expect(applyReport.v1CompatPolicy).toBe('strict_pause_all');
    expect(applyReport.summary.countsByOutcome).toEqual({
      upgraded_v2: 0,
      paused_reauth_required: 4,
      already_v2: 1,
      inactive_preserved: 1,
    });

    // Verify all 4 active v1 schedules (including Class A) are now paused with REAUTH_REQUIRED_PAUSE_REASON and version incremented
    for (const sched of [
      seeded.schedClassA,
      seeded.schedOrgClassB,
      seeded.schedTelegramClassB,
      seeded.schedRotatedClassB,
    ]) {
      const rowRes = await db.pool.query('SELECT * FROM schedules WHERE id = $1', [sched.id]);
      const row = rowRes.rows[0]!;
      expect(row.status).toBe('paused');
      expect(row.pause_reason).toBe(REAUTH_REQUIRED_PAUSE_REASON);
      expect(row.next_run_at).toBeNull();
      expect(row.version).toBe(sched.version + 1);

      const auditRes = await db.pool.query(
        'SELECT * FROM sheets_digest_v2_migration_audit WHERE schedule_id = $1',
        [sched.id]
      );
      expect(auditRes.rows[0]).toMatchObject({
        schedule_id: sched.id,
        previous_status: 'active',
        previous_schedule_ver: sched.version,
        migrated_schedule_ver: sched.version + 1,
        outcome: 'paused_reauth_required',
        rolled_back_at: null,
      });

      const msgRes = await db.pool.query(
        'SELECT * FROM messages WHERE conv_id = $1 ORDER BY created_at DESC',
        [row.conv_id]
      );
      expect(msgRes.rows.length).toBeGreaterThanOrEqual(1);
      expect(msgRes.rows[0].content).toContain('REAUTH_REQUIRED');
      expect(msgRes.rows[0].metadata).toMatchObject({
        type: 'schedule_state',
        reason: REAUTH_REQUIRED_PAUSE_REASON,
        reasonCode: 'REAUTH_REQUIRED',
        scheduleId: sched.id,
        scheduleVersion: sched.version + 1,
        schedule: {
          id: sched.id,
          convId: row.conv_id,
          status: 'paused',
          pauseReason: REAUTH_REQUIRED_PAUSE_REASON,
          version: sched.version + 1,
          kind: 'sheets_digest',
          approvalMode: 'auto_digest',
          nextRunAt: null,
        },
      });
    }

    // Verify v2_ready schedule was not mutated
    const v2Row = (await db.pool.query('SELECT * FROM schedules WHERE id = $1', [seeded.schedV2Ready.id])).rows[0]!;
    expect(v2Row.status).toBe('active');
    expect(v2Row.version).toBe(seeded.schedV2Ready.version);

    // Verify inactive v1 schedule was not mutated
    const pausedRow = (await db.pool.query('SELECT * FROM schedules WHERE id = $1', [seeded.schedPausedV1.id])).rows[0]!;
    expect(pausedRow.status).toBe('paused');
    expect(pausedRow.pause_reason).toBeNull();
    expect(pausedRow.version).toBe(seeded.schedPausedV1.version);
  });

  it('4. --mode=apply with allow_consistency_candidate upgrades Class A to v2, pauses Class B, and never backfills missing credentialId or email', async () => {
    const seeded = await seedMixedSchedules();

    // Also seed a personal mysheets -> gmail v1 schedule MISSING destination.credentialId to prove zero heuristic backfill
    const convMissingCredId = await fixtures.convRepo.createConversation(
      fixtures.personalA.user.id,
      'Hội thoại Missing CredId',
      { workspaceMode: 'personal', workspaceId: null }
    );
    const schedMissingCredId = await insertTestSheetsDigestSchedule(db.pool, {
      userId: fixtures.personalA.user.id,
      convId: convMissingCredId.id,
      workspaceMode: 'personal',
      workspaceId: null,
      digestApprovedAt: approvedAt,
      digestConfig: {
        version: 1,
        source: {
          service: 'mysheets',
          credentialId: fixtures.personalA.mysheetsCred.id,
          email: fixtures.personalA.email,
          spreadsheetId: fixtures.personalA.spreadsheetId,
          spreadsheetTitle: fixtures.personalA.spreadsheetTitle,
          tailRows: 20,
        },
        destination: {
          service: 'gmail',
          // credentialId intentionally omitted!
          recipientEmail: 'cfo@company.test',
        },
        includeAiSummary: true,
      },
    });

    const applyReport = await runSheetsDigestV2Migration(db.pool, {
      mode: 'apply',
      v1CompatPolicy: 'allow_consistency_candidate',
      confirmProductionApply: true,
      encryptionKey: DIGEST_TEST_ENC_KEY,
    });

    expect(applyReport.v1CompatPolicy).toBe('allow_consistency_candidate');
    expect(applyReport.summary.countsByOutcome).toEqual({
      upgraded_v2: 1,
      paused_reauth_required: 4,
      already_v2: 1,
      inactive_preserved: 1,
    });

    // Class A schedule must be upgraded to v2 in-place while remaining active
    const rowA = (await db.pool.query('SELECT * FROM schedules WHERE id = $1', [seeded.schedClassA.id])).rows[0]!;
    expect(rowA.status).toBe('active');
    expect(rowA.version).toBe(seeded.schedClassA.version + 1);
    expect(rowA.digest_config).toEqual({
      version: 2,
      workspaceMode: 'personal',
      workspaceId: null,
      source: {
        service: 'mysheets',
        credentialId: fixtures.personalA.mysheetsCred.id,
        email: fixtures.personalA.email,
        spreadsheetId: fixtures.personalA.spreadsheetId,
        spreadsheetTitle: fixtures.personalA.spreadsheetTitle,
        sheetName: 'KPI Tháng 11',
        tailRows: 20,
      },
      destination: {
        service: 'gmail',
        credentialId: fixtures.personalA.gmailCred.id,
        senderEmail: fixtures.personalA.email,
        recipientEmail: 'finance@company.test',
      },
      includeAiSummary: true,
    });
    expect(rowA.digest_config_hash).toBe(
      computeSheetsDigestHash({
        userId: rowA.user_id,
        recurrence: rowA.recurrence,
        config: rowA.digest_config,
      })
    );

    const auditA = (
      await db.pool.query('SELECT * FROM sheets_digest_v2_migration_audit WHERE schedule_id = $1', [
        seeded.schedClassA.id,
      ])
    ).rows[0]!;
    expect(auditA.outcome).toBe('upgraded_v2');
    expect(auditA.previous_schedule_ver).toBe(seeded.schedClassA.version);
    expect(auditA.migrated_schedule_ver).toBe(seeded.schedClassA.version + 1);
    expect(auditA.previous_digest_config.version).toBe(1);

    // Zero Heuristic Backfill check: schedMissingCredId must be paused_reauth_required and NOT backfilled with gmailCred.id
    const rowMissing = (
      await db.pool.query('SELECT * FROM schedules WHERE id = $1', [schedMissingCredId.id])
    ).rows[0]!;
    expect(rowMissing.status).toBe('paused');
    expect(rowMissing.pause_reason).toBe(REAUTH_REQUIRED_PAUSE_REASON);
    expect(rowMissing.digest_config.version).toBe(1);
    expect(rowMissing.digest_config.destination.credentialId).toBeUndefined();
  });

  it('5. --mode=rollback without confirmProductionRollback throws CONFIRM_PRODUCTION_ROLLBACK_REQUIRED and mutates 0 rows', async () => {
    await seedMixedSchedules();
    await runSheetsDigestV2Migration(db.pool, {
      mode: 'apply',
      v1CompatPolicy: 'allow_consistency_candidate',
      confirmProductionApply: true,
      encryptionKey: DIGEST_TEST_ENC_KEY,
    });

    const beforeSchedules = (
      await db.pool.query(
        'SELECT id, status, pause_reason, version, digest_config, digest_config_hash FROM schedules ORDER BY id ASC'
      )
    ).rows;

    await expect(
      runSheetsDigestV2Migration(db.pool, {
        mode: 'rollback',
        encryptionKey: DIGEST_TEST_ENC_KEY,
      })
    ).rejects.toThrow(/CONFIRM_PRODUCTION_ROLLBACK_REQUIRED/);

    const afterSchedules = (
      await db.pool.query(
        'SELECT id, status, pause_reason, version, digest_config, digest_config_hash FROM schedules ORDER BY id ASC'
      )
    ).rows;
    expect(afterSchedules).toEqual(beforeSchedules);
  });

  it('6. --mode=rollback restores Class A state when valid, skips user-modified schedules via CAS, and keeps revoked/unpinned schedules paused', async () => {
    const seeded = await seedMixedSchedules();

    // Create a second Class A schedule for Personal A so we can test both restored_previous_state and restored_paused_due_to_revocation + skipped_user_modified
    const convClassA2 = await fixtures.convRepo.createConversation(
      fixtures.personalA.user.id,
      'Hội thoại Class A #2 (User Modified)',
      { workspaceMode: 'personal', workspaceId: null }
    );
    const schedClassAUserModified = await insertTestSheetsDigestSchedule(db.pool, {
      userId: fixtures.personalA.user.id,
      convId: convClassA2.id,
      workspaceMode: 'personal',
      workspaceId: null,
      digestApprovedAt: approvedAt,
      digestConfig: {
        version: 1,
        source: {
          service: 'mysheets',
          credentialId: fixtures.personalA.mysheetsCred.id,
          email: fixtures.personalA.email,
          spreadsheetId: fixtures.personalA.spreadsheetId,
          spreadsheetTitle: fixtures.personalA.spreadsheetTitle,
          tailRows: 20,
        },
        destination: {
          service: 'gmail',
          credentialId: fixtures.personalA.gmailCred.id,
          recipientEmail: 'ops@company.test',
        },
        includeAiSummary: true,
      },
    });

    // Make Personal B's schedule a valid Class A before migration, then revoke Personal B's credential AFTER migration
    await db.pool.query(
      'UPDATE service_credentials SET status_changed_at = NULL WHERE id = $1',
      [fixtures.personalB.mysheetsCred.id]
    );

    const applyRes = await runSheetsDigestV2Migration(db.pool, {
      mode: 'apply',
      v1CompatPolicy: 'allow_consistency_candidate',
      confirmProductionApply: true,
      encryptionKey: DIGEST_TEST_ENC_KEY,
    });
    expect(applyRes.summary.countsByOutcome.upgraded_v2).toBe(3);

    // 6a. Simulate user editing/reauthorizing schedClassAUserModified after migration (bumps version from 2 -> 3)
    const userEditedConfig = {
      version: 2,
      workspaceMode: 'personal',
      workspaceId: null,
      source: {
        service: 'mysheets',
        credentialId: fixtures.personalA.mysheetsCred.id,
        email: fixtures.personalA.email,
        spreadsheetId: fixtures.personalA.spreadsheetId,
        spreadsheetTitle: 'User Edited Title After Migration',
        tailRows: 10,
      },
      destination: {
        service: 'gmail',
        credentialId: fixtures.personalA.gmailCred.id,
        senderEmail: fixtures.personalA.email,
        recipientEmail: 'user-edited@company.test',
      },
      includeAiSummary: false,
    };
    await db.pool.query(
      'UPDATE schedules SET digest_config = $2::jsonb, version = version + 1 WHERE id = $1',
      [schedClassAUserModified.id, JSON.stringify(userEditedConfig)]
    );

    // 6b. Simulate Personal B revoking/marking reconnect_required on their mysheets credential AFTER migration
    await db.pool.query(
      "UPDATE service_credentials SET status = 'reconnect_required', status_changed_at = now() WHERE id = $1",
      [fixtures.personalB.mysheetsCred.id]
    );

    // Execute rollback
    const rollbackRes = await runSheetsDigestV2Migration(db.pool, {
      mode: 'rollback',
      confirmProductionRollback: true,
      encryptionKey: DIGEST_TEST_ENC_KEY,
    });

    const rbById = new Map(rollbackRes.rollbackItems.map((r) => [r.scheduleId, r]));

    // Case 1: schedClassA (Personal A, still valid) -> restored_previous_state
    expect(rbById.get(seeded.schedClassA.id)?.rollbackOutcome).toBe('restored_previous_state');
    const rowA = (await db.pool.query('SELECT * FROM schedules WHERE id = $1', [seeded.schedClassA.id])).rows[0]!;
    expect(rowA.status).toBe('active');
    expect(rowA.pause_reason).toBeNull();
    expect(rowA.digest_config.version).toBe(1);
    expect(rowA.digest_config_hash).toBe(seeded.schedClassA.digest_config_hash);
    expect(rowA.version).toBe(seeded.schedClassA.version + 2);

    // Case 2: schedClassAUserModified (version bumped by user) -> skipped_user_modified, user changes 100% intact
    expect(rbById.get(schedClassAUserModified.id)?.rollbackOutcome).toBe('skipped_user_modified');
    const rowUserMod = (
      await db.pool.query('SELECT * FROM schedules WHERE id = $1', [schedClassAUserModified.id])
    ).rows[0]!;
    expect(rowUserMod.version).toBe(schedClassAUserModified.version + 2);
    expect(rowUserMod.digest_config).toEqual(userEditedConfig);

    // Case 3: schedRotatedClassB (Personal B, credential revoked after migration) -> restored_paused_due_to_revocation (NEVER reactivated!)
    expect(rbById.get(seeded.schedRotatedClassB.id)?.rollbackOutcome).toBe(
      'restored_paused_due_to_revocation'
    );
    const rowRevokedB = (
      await db.pool.query('SELECT * FROM schedules WHERE id = $1', [seeded.schedRotatedClassB.id])
    ).rows[0]!;
    expect(rowRevokedB.status).toBe('paused');
    expect(rowRevokedB.next_run_at).toBeNull();
    expect(rowRevokedB.pause_reason).toContain('REAUTH_REQUIRED');
    expect(rowRevokedB.digest_config.version).toBe(1);

    // Case 4: Class B unpinned schedules (Org A, Telegram) remain paused after rollback
    expect(rbById.get(seeded.schedOrgClassB.id)?.rollbackOutcome).toBe(
      'restored_paused_due_to_revocation'
    );
    const rowOrgB = (
      await db.pool.query('SELECT * FROM schedules WHERE id = $1', [seeded.schedOrgClassB.id])
    ).rows[0]!;
    expect(rowOrgB.status).toBe('paused');
    expect(rowOrgB.next_run_at).toBeNull();
  });

  it('6b. protects non-sheets_digest schedules (kind = plan) in both apply and rollback', async () => {
    const { personalA, convRepo } = fixtures;
    const convPlan = await convRepo.createConversation(personalA.user.id, 'Hội thoại Plan', {
      workspaceMode: 'personal',
      workspaceId: null,
    });
    const planSchedRes = await db.pool.query<{ id: string; version: number }>(
      `INSERT INTO schedules (user_id, conv_id, name, request, recurrence, services, status, next_run_at, workspace_mode, kind)
       VALUES ($1, $2, 'Lịch Plan', 'Gửi tin nhắn', '{"type":"daily","time":"09:00"}'::jsonb, ARRAY['gmail'], 'active', now() + interval '1 day', 'personal', 'plan')
       RETURNING id, version`,
      [personalA.user.id, convPlan.id]
    );
    const planSched = planSchedRes.rows[0]!;

    const schedDigest = await insertTestSheetsDigestSchedule(db.pool, {
      userId: personalA.user.id,
      convId: personalA.conversation.id,
      workspaceMode: 'personal',
      workspaceId: null,
      digestApprovedAt: approvedAt,
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
          recipientEmail: 'finance@company.test',
        },
        includeAiSummary: true,
      },
    });

    await runSheetsDigestV2Migration(db.pool, {
      mode: 'apply',
      confirmProductionApply: true,
      encryptionKey: DIGEST_TEST_ENC_KEY,
    });

    // Plan schedule is untouched by apply
    const afterApplyPlan = (
      await db.pool.query('SELECT * FROM schedules WHERE id = $1', [planSched.id])
    ).rows[0]!;
    expect(afterApplyPlan.status).toBe('active');
    expect(afterApplyPlan.version).toBe(planSched.version);

    // If schedDigest's kind is converted to 'plan' (even without bumping version), rollback must skip it
    await db.pool.query(
      "UPDATE schedules SET kind = 'plan', digest_config = NULL, digest_config_hash = NULL, digest_approved_at = NULL WHERE id = $1",
      [schedDigest.id]
    );

    const rbRes = await runSheetsDigestV2Migration(db.pool, {
      mode: 'rollback',
      confirmProductionRollback: true,
      encryptionKey: DIGEST_TEST_ENC_KEY,
    });
    expect(rbRes.rollbackItems[0]).toMatchObject({
      scheduleId: schedDigest.id,
      rollbackOutcome: 'skipped_user_modified',
      reasons: ['SCHEDULE_KIND_CHANGED_AFTER_MIGRATION'],
    });
  });

  it('7. parseMigrationCliArgs parses CLI flags and defaults accurately', () => {
    expect(parseMigrationCliArgs([])).toEqual({
      mode: 'inventory',
      v1CompatPolicy: 'strict_pause_all',
      confirmProductionApply: false,
      confirmProductionRollback: false,
      scheduleId: undefined,
    });

    expect(
      parseMigrationCliArgs([
        '--mode=apply',
        '--v1-compat-policy=allow_consistency_candidate',
        '--confirm-production-apply',
        '--schedule-id=11111111-2222-3333-4444-555555555555',
      ])
    ).toEqual({
      mode: 'apply',
      v1CompatPolicy: 'allow_consistency_candidate',
      confirmProductionApply: true,
      confirmProductionRollback: false,
      scheduleId: '11111111-2222-3333-4444-555555555555',
    });

    expect(
      parseMigrationCliArgs([
        '--mode',
        'rollback',
        '--class-a-policy',
        'strict_pause_all',
        '--confirm-production-rollback',
      ])
    ).toEqual({
      mode: 'rollback',
      v1CompatPolicy: 'strict_pause_all',
      confirmProductionApply: false,
      confirmProductionRollback: true,
      scheduleId: undefined,
    });
  });

  it('8. Blocker 1a: apply pass 1 (strict_pause_all) -> apply pass 2 -> rollback preserves audit snapshot and restores original v1 state', async () => {
    const seeded = await seedMixedSchedules();
    const initialRowA = (
      await db.pool.query('SELECT * FROM schedules WHERE id = $1', [seeded.schedClassA.id])
    ).rows[0]!;

    // Pass 1: strict_pause_all
    const pass1 = await runSheetsDigestV2Migration(db.pool, {
      mode: 'apply',
      confirmProductionApply: true,
      encryptionKey: DIGEST_TEST_ENC_KEY,
    });
    expect(pass1.summary.countsByOutcome).toEqual({
      upgraded_v2: 0,
      paused_reauth_required: 4,
      already_v2: 1,
      inactive_preserved: 1,
    });

    // Natively v2 and natively inactive schedules must NOT have audit rows created
    const nonMutatedAudits = await db.pool.query(
      'SELECT * FROM sheets_digest_v2_migration_audit WHERE schedule_id = ANY($1::uuid[])',
      [[seeded.schedV2Ready.id, seeded.schedPausedV1.id]]
    );
    expect(nonMutatedAudits.rows).toHaveLength(0);

    // Pass 2: strict_pause_all (idempotent re-run)
    const pass2 = await runSheetsDigestV2Migration(db.pool, {
      mode: 'apply',
      confirmProductionApply: true,
      encryptionKey: DIGEST_TEST_ENC_KEY,
    });
    expect(pass2.summary.countsByOutcome).toEqual({
      upgraded_v2: 0,
      paused_reauth_required: 0,
      already_v2: 1,
      inactive_preserved: 5,
    });

    // Audit row for schedClassA must still retain the pass-1 pre-migration snapshot
    const auditBeforeRollback = (
      await db.pool.query(
        'SELECT * FROM sheets_digest_v2_migration_audit WHERE schedule_id = $1',
        [seeded.schedClassA.id]
      )
    ).rows[0]!;
    expect(auditBeforeRollback).toMatchObject({
      schedule_id: seeded.schedClassA.id,
      previous_status: 'active',
      previous_pause_reason: null,
      previous_schedule_ver: seeded.schedClassA.version,
      migrated_schedule_ver: seeded.schedClassA.version + 1,
      previous_config_version: 1,
      previous_config_hash: seeded.schedClassA.digest_config_hash,
      outcome: 'paused_reauth_required',
      rolled_back_at: null,
    });

    // Rollback after 2 apply passes must still restore the original v1 active state
    const rollbackReport = await runSheetsDigestV2Migration(db.pool, {
      mode: 'rollback',
      confirmProductionRollback: true,
      encryptionKey: DIGEST_TEST_ENC_KEY,
    });
    const rbItem = rollbackReport.rollbackItems.find(
      (i) => i.scheduleId === seeded.schedClassA.id
    );
    expect(rbItem).toMatchObject({
      scheduleId: seeded.schedClassA.id,
      auditOutcome: 'paused_reauth_required',
      rollbackOutcome: 'restored_previous_state',
    });

    const restoredRow = (
      await db.pool.query('SELECT * FROM schedules WHERE id = $1', [seeded.schedClassA.id])
    ).rows[0]!;
    expect(restoredRow.status).toBe('active');
    expect(restoredRow.pause_reason).toBeNull();
    expect(restoredRow.digest_config.version).toBe(1);
    expect(restoredRow.digest_config).toEqual(initialRowA.digest_config);
    expect(restoredRow.digest_config_hash).toBe(seeded.schedClassA.digest_config_hash);
    expect(restoredRow.version).toBe(seeded.schedClassA.version + 2);

    const auditAfterRollback = (
      await db.pool.query(
        'SELECT * FROM sheets_digest_v2_migration_audit WHERE schedule_id = $1',
        [seeded.schedClassA.id]
      )
    ).rows[0]!;
    expect(auditAfterRollback.outcome).toBe('paused_reauth_required');
    expect(auditAfterRollback.previous_schedule_ver).toBe(seeded.schedClassA.version);
    expect(auditAfterRollback.migrated_schedule_ver).toBe(seeded.schedClassA.version + 1);
    expect(auditAfterRollback.rolled_back_at).not.toBeNull();
    expect(auditAfterRollback.rollback_outcome).toBe('restored_previous_state');
  });

  it('9. Blocker 1b: apply pass 1 (allow_consistency_candidate) -> apply pass 2 -> rollback restores original v1 config & hash', async () => {
    const seeded = await seedMixedSchedules();
    const initialRowA = (
      await db.pool.query('SELECT * FROM schedules WHERE id = $1', [seeded.schedClassA.id])
    ).rows[0]!;

    // Pass 1: allow_consistency_candidate upgrades Class A to v2
    const pass1 = await runSheetsDigestV2Migration(db.pool, {
      mode: 'apply',
      v1CompatPolicy: 'allow_consistency_candidate',
      confirmProductionApply: true,
      encryptionKey: DIGEST_TEST_ENC_KEY,
    });
    expect(pass1.summary.countsByOutcome.upgraded_v2).toBe(1);

    // Pass 2: allow_consistency_candidate sees Class A as already v2, must NOT overwrite audit snapshot
    const pass2 = await runSheetsDigestV2Migration(db.pool, {
      mode: 'apply',
      v1CompatPolicy: 'allow_consistency_candidate',
      confirmProductionApply: true,
      encryptionKey: DIGEST_TEST_ENC_KEY,
    });
    expect(pass2.summary.countsByOutcome).toEqual({
      upgraded_v2: 0,
      paused_reauth_required: 0,
      already_v2: 2,
      inactive_preserved: 4,
    });

    const auditAfterPass2 = (
      await db.pool.query(
        'SELECT * FROM sheets_digest_v2_migration_audit WHERE schedule_id = $1',
        [seeded.schedClassA.id]
      )
    ).rows[0]!;
    expect(auditAfterPass2).toMatchObject({
      schedule_id: seeded.schedClassA.id,
      previous_status: 'active',
      previous_schedule_ver: seeded.schedClassA.version,
      migrated_schedule_ver: seeded.schedClassA.version + 1,
      previous_config_version: 1,
      previous_config_hash: seeded.schedClassA.digest_config_hash,
      outcome: 'upgraded_v2',
      rolled_back_at: null,
    });
    expect(auditAfterPass2.previous_digest_config.version).toBe(1);

    // Rollback restores original v1 config and hash
    const rbReport = await runSheetsDigestV2Migration(db.pool, {
      mode: 'rollback',
      confirmProductionRollback: true,
      encryptionKey: DIGEST_TEST_ENC_KEY,
    });
    const rbA = rbReport.rollbackItems.find((i) => i.scheduleId === seeded.schedClassA.id);
    expect(rbA).toMatchObject({
      scheduleId: seeded.schedClassA.id,
      auditOutcome: 'upgraded_v2',
      rollbackOutcome: 'restored_previous_state',
    });

    const rowAfterRollback = (
      await db.pool.query('SELECT * FROM schedules WHERE id = $1', [seeded.schedClassA.id])
    ).rows[0]!;
    expect(rowAfterRollback.status).toBe('active');
    expect(rowAfterRollback.pause_reason).toBeNull();
    expect(rowAfterRollback.digest_config).toEqual(initialRowA.digest_config);
    expect(rowAfterRollback.digest_config_hash).toBe(seeded.schedClassA.digest_config_hash);
    expect(rowAfterRollback.version).toBe(seeded.schedClassA.version + 2);

    const auditAfterRollback = (
      await db.pool.query(
        'SELECT * FROM sheets_digest_v2_migration_audit WHERE schedule_id = $1',
        [seeded.schedClassA.id]
      )
    ).rows[0]!;
    expect(auditAfterRollback.outcome).toBe('upgraded_v2');
    expect(auditAfterRollback.rolled_back_at).not.toBeNull();
    expect(auditAfterRollback.rollback_outcome).toBe('restored_previous_state');

    // Re-applying after rollback is permitted because rolled_back_at IS NOT NULL
    const pass3AfterRollback = await runSheetsDigestV2Migration(db.pool, {
      mode: 'apply',
      v1CompatPolicy: 'allow_consistency_candidate',
      confirmProductionApply: true,
      encryptionKey: DIGEST_TEST_ENC_KEY,
      scheduleId: seeded.schedClassA.id,
    });
    expect(pass3AfterRollback.summary.countsByOutcome.upgraded_v2).toBe(1);
    const auditAfterPass3 = (
      await db.pool.query(
        'SELECT * FROM sheets_digest_v2_migration_audit WHERE schedule_id = $1',
        [seeded.schedClassA.id]
      )
    ).rows[0]!;
    expect(auditAfterPass3.rolled_back_at).toBeNull();
    expect(auditAfterPass3.rollback_outcome).toBeNull();
    expect(auditAfterPass3.previous_schedule_ver).toBe(seeded.schedClassA.version + 2);
    expect(auditAfterPass3.migrated_schedule_ver).toBe(seeded.schedClassA.version + 3);
  });

  it('10. Blocker 1c: concurrent apply and repeated rollback are idempotent and preserve audit history', async () => {
    const { personalA } = fixtures;
    const initialDigestConfig = {
      version: 1 as const,
      source: {
        service: 'mysheets' as const,
        credentialId: personalA.mysheetsCred.id,
        email: personalA.email,
        spreadsheetId: personalA.spreadsheetId,
        spreadsheetTitle: personalA.spreadsheetTitle,
        sheetName: 'KPI Tháng 11',
        tailRows: 20,
      },
      destination: {
        service: 'gmail' as const,
        credentialId: personalA.gmailCred.id,
        recipientEmail: 'finance@company.test',
      },
      includeAiSummary: true,
    };
    const schedClassA = await insertTestSheetsDigestSchedule(db.pool, {
      userId: personalA.user.id,
      convId: personalA.conversation.id,
      workspaceMode: 'personal',
      workspaceId: null,
      digestApprovedAt: approvedAt,
      digestConfig: initialDigestConfig,
    });

    // Run two concurrent apply invocations
    await Promise.all([
      runSheetsDigestV2Migration(db.pool, {
        mode: 'apply',
        v1CompatPolicy: 'allow_consistency_candidate',
        confirmProductionApply: true,
        encryptionKey: DIGEST_TEST_ENC_KEY,
      }),
      runSheetsDigestV2Migration(db.pool, {
        mode: 'apply',
        v1CompatPolicy: 'allow_consistency_candidate',
        confirmProductionApply: true,
        encryptionKey: DIGEST_TEST_ENC_KEY,
      }),
    ]);

    const rowAfterConcurrentApply = (
      await db.pool.query('SELECT * FROM schedules WHERE id = $1', [schedClassA.id])
    ).rows[0]!;
    expect(rowAfterConcurrentApply.version).toBe(schedClassA.version + 1);
    expect(rowAfterConcurrentApply.digest_config.version).toBe(2);

    const auditAfterConcurrentApply = (
      await db.pool.query(
        'SELECT * FROM sheets_digest_v2_migration_audit WHERE schedule_id = $1',
        [schedClassA.id]
      )
    ).rows[0]!;
    expect(auditAfterConcurrentApply).toMatchObject({
      schedule_id: schedClassA.id,
      previous_status: 'active',
      previous_schedule_ver: schedClassA.version,
      migrated_schedule_ver: schedClassA.version + 1,
      previous_config_version: 1,
      previous_config_hash: schedClassA.digest_config_hash,
      outcome: 'upgraded_v2',
      rolled_back_at: null,
    });

    // Concurrent rollback invocations: only one restores the schedule, the other must NOT overwrite rollback_outcome to skipped_user_modified
    const [rbConcurrentA, rbConcurrentB] = await Promise.all([
      runSheetsDigestV2Migration(db.pool, {
        mode: 'rollback',
        confirmProductionRollback: true,
        encryptionKey: DIGEST_TEST_ENC_KEY,
      }),
      runSheetsDigestV2Migration(db.pool, {
        mode: 'rollback',
        confirmProductionRollback: true,
        encryptionKey: DIGEST_TEST_ENC_KEY,
      }),
    ]);
    const combinedConcurrentItems = [
      ...rbConcurrentA.rollbackItems,
      ...rbConcurrentB.rollbackItems,
    ];
    expect(combinedConcurrentItems).toHaveLength(1);
    expect(combinedConcurrentItems[0]?.rollbackOutcome).toBe('restored_previous_state');
    expect(
      rbConcurrentA.summary.countsByRollbackOutcome.skipped_user_modified +
        rbConcurrentB.summary.countsByRollbackOutcome.skipped_user_modified
    ).toBe(0);

    const rowAfterRb1 = (
      await db.pool.query('SELECT * FROM schedules WHERE id = $1', [schedClassA.id])
    ).rows[0]!;
    expect(rowAfterRb1.status).toBe('active');
    expect(rowAfterRb1.digest_config).toEqual(initialDigestConfig);
    expect(rowAfterRb1.digest_config_hash).toBe(schedClassA.digest_config_hash);
    expect(rowAfterRb1.version).toBe(schedClassA.version + 2);

    const auditAfterRb1 = (
      await db.pool.query(
        'SELECT * FROM sheets_digest_v2_migration_audit WHERE schedule_id = $1',
        [schedClassA.id]
      )
    ).rows[0]!;
    expect(auditAfterRb1.rolled_back_at).not.toBeNull();
    expect(auditAfterRb1.rollback_outcome).toBe('restored_previous_state');

    // Rollback pass 2 (idempotent: must not re-mutate schedule or erase audit history)
    const rb2 = await runSheetsDigestV2Migration(db.pool, {
      mode: 'rollback',
      confirmProductionRollback: true,
      encryptionKey: DIGEST_TEST_ENC_KEY,
    });
    expect(rb2.rollbackItems).toHaveLength(0);

    const rowAfterRb2 = (
      await db.pool.query('SELECT * FROM schedules WHERE id = $1', [schedClassA.id])
    ).rows[0]!;
    expect(rowAfterRb2.version).toBe(schedClassA.version + 2);
    expect(rowAfterRb2.digest_config).toEqual(initialDigestConfig);

    const auditAfterRb2 = (
      await db.pool.query(
        'SELECT * FROM sheets_digest_v2_migration_audit WHERE schedule_id = $1',
        [schedClassA.id]
      )
    ).rows[0]!;
    expect(auditAfterRb2.rolled_back_at).toEqual(auditAfterRb1.rolled_back_at);
    expect(auditAfterRb2.rollback_outcome).toBe('restored_previous_state');
    expect(auditAfterRb2.outcome).toBe('upgraded_v2');
    expect(auditAfterRb2.previous_schedule_ver).toBe(schedClassA.version);
  });

  it('11. Blocker 2: invalid --schedule-id throws INVALID_SCHEDULE_ID in CLI and service layer, and non-existent valid UUID matches 0 rows', async () => {
    await seedMixedSchedules();
    const beforeSchedules = (
      await db.pool.query(
        'SELECT id, status, pause_reason, version, digest_config, digest_config_hash FROM schedules ORDER BY id ASC'
      )
    ).rows;

    // 11a. CLI parser rejects invalid/empty/missing --schedule-id
    for (const badArgv of [
      ['--schedule-id', 'not-a-uuid'],
      ['--schedule-id=not-a-uuid'],
      ['--schedule-id', ''],
      ['--schedule-id='],
      ['--schedule-id'],
      ['--schedule-id', '--mode=apply'],
    ]) {
      let caught: any;
      try {
        parseMigrationCliArgs(badArgv);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught.message).toMatch(/INVALID_SCHEDULE_ID/);
      expect(caught.code).toBe('INVALID_SCHEDULE_ID');
    }

    // 11b. Service layer rejects invalid/empty/whitespace scheduleId across all modes with 0 DB mutations
    for (const badId of ['not-a-uuid', '', '   ']) {
      for (const mode of ['inventory', 'dry-run', 'apply', 'rollback'] as const) {
        let caught: any;
        try {
          await runSheetsDigestV2Migration(db.pool, {
            mode,
            scheduleId: badId,
            confirmProductionApply: true,
            confirmProductionRollback: true,
            encryptionKey: DIGEST_TEST_ENC_KEY,
          });
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(Error);
        expect(caught.message).toMatch(/INVALID_SCHEDULE_ID/);
        expect(caught.code).toBe('INVALID_SCHEDULE_ID');
      }
    }

    const afterBadIds = (
      await db.pool.query(
        'SELECT id, status, pause_reason, version, digest_config, digest_config_hash FROM schedules ORDER BY id ASC'
      )
    ).rows;
    expect(afterBadIds).toEqual(beforeSchedules);

    // 11c. Non-existent valid UUID matches 0 schedules and mutates 0 rows across all modes
    const nonExistentUuid = '00000000-0000-4000-8000-000000000999';
    for (const mode of ['inventory', 'dry-run', 'apply', 'rollback'] as const) {
      const report = await runSheetsDigestV2Migration(db.pool, {
        mode,
        scheduleId: nonExistentUuid,
        confirmProductionApply: true,
        confirmProductionRollback: true,
        encryptionKey: DIGEST_TEST_ENC_KEY,
      });
      expect(report.summary.totalSchedules).toBe(0);
      expect(report.items).toHaveLength(0);
      expect(report.rollbackItems).toHaveLength(0);
    }

    const afterNonExistent = (
      await db.pool.query(
        'SELECT id, status, pause_reason, version, digest_config, digest_config_hash FROM schedules ORDER BY id ASC'
      )
    ).rows;
    expect(afterNonExistent).toEqual(beforeSchedules);
  });

  it('12. Encryption Key Contract: honors process.env.ENCRYPTION_KEY, throws MISSING_ENCRYPTION_KEY when unset, and throws INVALID_ENCRYPTION_KEY on wrong key with 0 mutations', async () => {
    const seeded = await seedMixedSchedules();
    const beforeSchedules = (
      await db.pool.query(
        'SELECT id, status, pause_reason, version, digest_config, digest_config_hash FROM schedules ORDER BY id ASC'
      )
    ).rows;

    const prevEncKey = process.env.ENCRYPTION_KEY;
    const prevCredEncKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
    try {
      // 12a. Missing / empty encryptionKey throws MISSING_ENCRYPTION_KEY
      delete process.env.ENCRYPTION_KEY;
      delete process.env.CREDENTIALS_ENCRYPTION_KEY;

      for (const mode of ['inventory', 'dry-run', 'apply', 'rollback'] as const) {
        for (const badKey of [undefined, '', '   ']) {
          let caught: any;
          try {
            await runSheetsDigestV2Migration(db.pool, {
              mode,
              ...(badKey !== undefined ? { encryptionKey: badKey } : {}),
              v1CompatPolicy: 'allow_consistency_candidate',
              confirmProductionApply: true,
              confirmProductionRollback: true,
            });
          } catch (err) {
            caught = err;
          }
          expect(caught).toBeInstanceOf(Error);
          expect(caught.message).toMatch(/MISSING_ENCRYPTION_KEY/);
          expect(caught.code).toBe('MISSING_ENCRYPTION_KEY');
        }
      }

      // 12b. Wrong encryptionKey throws INVALID_ENCRYPTION_KEY instead of misclassifying Class A as Class B
      for (const mode of ['inventory', 'dry-run', 'apply', 'rollback'] as const) {
        let caught: any;
        try {
          await runSheetsDigestV2Migration(db.pool, {
            mode,
            encryptionKey: 'wrong-key-that-fails-aes-gcm-auth-tag-verification',
            v1CompatPolicy: 'allow_consistency_candidate',
            confirmProductionApply: true,
            confirmProductionRollback: true,
          });
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(Error);
        expect(caught.message).toMatch(/INVALID_ENCRYPTION_KEY/);
        expect(caught.code).toBe('INVALID_ENCRYPTION_KEY');
      }

      // Verify 0 mutations occurred from missing or wrong encryption keys
      const afterFailedKeyChecks = (
        await db.pool.query(
          'SELECT id, status, pause_reason, version, digest_config, digest_config_hash FROM schedules ORDER BY id ASC'
        )
      ).rows;
      expect(afterFailedKeyChecks).toEqual(beforeSchedules);

      // 12c. Using process.env.ENCRYPTION_KEY (without options.encryptionKey) succeeds and upgrades Class A
      process.env.ENCRYPTION_KEY = DIGEST_TEST_ENC_KEY;
      const applyViaEnv = await runSheetsDigestV2Migration(db.pool, {
        mode: 'apply',
        v1CompatPolicy: 'allow_consistency_candidate',
        confirmProductionApply: true,
      });
      expect(applyViaEnv.summary.countsByOutcome.upgraded_v2).toBe(1);

      // Order Class B audit row earlier than Class A audit row, then verify rollback with wrong key mutates 0 rows
      await db.pool.query(
        "UPDATE sheets_digest_v2_migration_audit SET migrated_at = now() - interval '10 minutes' WHERE schedule_id = $1",
        [seeded.schedOrgClassB.id]
      );
      const schedulesBeforeFailedRollback = (
        await db.pool.query(
          'SELECT id, status, pause_reason, version, digest_config, digest_config_hash FROM schedules ORDER BY id ASC'
        )
      ).rows;
      const auditsBeforeFailedRollback = (
        await db.pool.query(
          'SELECT id, schedule_id, outcome, rolled_back_at, rollback_outcome FROM sheets_digest_v2_migration_audit ORDER BY id ASC'
        )
      ).rows;

      let rollbackBadKeyErr: any;
      try {
        await runSheetsDigestV2Migration(db.pool, {
          mode: 'rollback',
          confirmProductionRollback: true,
          encryptionKey: 'wrong-key-during-rollback-must-not-partially-mutate',
        });
      } catch (err) {
        rollbackBadKeyErr = err;
      }
      expect(rollbackBadKeyErr).toBeInstanceOf(Error);
      expect(rollbackBadKeyErr.code).toBe('INVALID_ENCRYPTION_KEY');

      const schedulesAfterFailedRollback = (
        await db.pool.query(
          'SELECT id, status, pause_reason, version, digest_config, digest_config_hash FROM schedules ORDER BY id ASC'
        )
      ).rows;
      const auditsAfterFailedRollback = (
        await db.pool.query(
          'SELECT id, schedule_id, outcome, rolled_back_at, rollback_outcome FROM sheets_digest_v2_migration_audit ORDER BY id ASC'
        )
      ).rows;
      expect(schedulesAfterFailedRollback).toEqual(schedulesBeforeFailedRollback);
      expect(auditsAfterFailedRollback).toEqual(auditsBeforeFailedRollback);

      const upgradedRow = (
        await db.pool.query('SELECT * FROM schedules WHERE id = $1', [seeded.schedClassA.id])
      ).rows[0]!;
      expect(upgradedRow.status).toBe('active');
      expect(upgradedRow.digest_config.version).toBe(2);
    } finally {
      if (prevEncKey === undefined) {
        delete process.env.ENCRYPTION_KEY;
      } else {
        process.env.ENCRYPTION_KEY = prevEncKey;
      }
      if (prevCredEncKey === undefined) {
        delete process.env.CREDENTIALS_ENCRYPTION_KEY;
      } else {
        process.env.CREDENTIALS_ENCRYPTION_KEY = prevCredEncKey;
      }
    }
  });
});
