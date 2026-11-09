import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { decryptCredentials } from '@wap/tool-adapters';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
import {
  DIGEST_TEST_ENC_KEY,
  LEGACY_SPREADSHEET_ID,
  ORG_A_SPREADSHEET_ID,
  ORG_B_SPREADSHEET_ID,
  PERSONAL_A_SPREADSHEET_ID,
  PERSONAL_B_SPREADSHEET_ID,
  createDigestProviderSpy,
  inspectV1SheetsDigestSchedules,
  insertTestSheetsDigestSchedule,
  seedSheetsDigestTenants,
  type SheetsDigestTenantFixtures,
} from '../helpers/sheets-digest-tenant-fixtures.js';

describe('RMD-00: Sheets Digest Multi-Tenant Fixtures, Provider Spy & V1 Schedule Inventory', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let fixtures: SheetsDigestTenantFixtures;

  beforeAll(async () => {
    db = await createMigratedSchema('sheets_digest_rmd00');
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.pool.query(
      'TRUNCATE schedule_runs, schedules, messages, conversations, workspace_members, workspaces, service_credentials CASCADE'
    );
    fixtures = await seedSheetsDigestTenants(db, DIGEST_TEST_ENC_KEY);
  });

  it('seeds isolated Personal User A, Personal User B, Org A, Org B, and Legacy tenants in PostgreSQL', async () => {
    const { credentialRepo, personalA, personalB, orgA, orgB, legacy } = fixtures;

    // 1. Personal User A vs Personal User B isolation
    const mysheetsA = await credentialRepo.getPersonalCredentials('mysheets', personalA.user.id);
    const mysheetsB = await credentialRepo.getPersonalCredentials('mysheets', personalB.user.id);
    expect(mysheetsA?.id).toBe(personalA.mysheetsCred.id);
    expect(mysheetsB?.id).toBe(personalB.mysheetsCred.id);
    expect(mysheetsA?.id).not.toBe(mysheetsB?.id);
    expect(mysheetsA?.workspace_id).toBeNull();
    expect(mysheetsB?.workspace_id).toBeNull();

    const decMysheetsA = decryptCredentials(mysheetsA!.config, DIGEST_TEST_ENC_KEY);
    const decMysheetsB = decryptCredentials(mysheetsB!.config, DIGEST_TEST_ENC_KEY);
    expect(decMysheetsA.allowedScope.spreadsheets).toEqual([PERSONAL_A_SPREADSHEET_ID]);
    expect(decMysheetsB.allowedScope.spreadsheets).toEqual([PERSONAL_B_SPREADSHEET_ID]);

    const gmailA = await credentialRepo.getPersonalCredentials('gmail', personalA.user.id);
    const gmailB = await credentialRepo.getPersonalCredentials('gmail', personalB.user.id);
    expect(gmailA?.id).toBe(personalA.gmailCred.id);
    expect(gmailB?.id).toBe(personalB.gmailCred.id);
    expect(gmailA?.id).not.toBe(gmailB?.id);

    const tgA = await credentialRepo.getPersonalCredentials('telegram', personalA.user.id);
    const tgB = await credentialRepo.getPersonalCredentials('telegram', personalB.user.id);
    expect(tgA?.id).toBe(personalA.telegramCred.id);
    expect(tgB?.id).toBe(personalB.telegramCred.id);
    expect(tgA?.id).not.toBe(tgB?.id);

    // 2. Org A vs Org B vs Legacy isolation
    const sheetsOrgA = await credentialRepo.getCredentials('sheets', orgA.workspaceId);
    const sheetsOrgB = await credentialRepo.getCredentials('sheets', orgB.workspaceId);
    const sheetsLegacy = await credentialRepo.getCredentials('sheets', null);

    expect(sheetsOrgA?.id).toBe(orgA.sheetsCred.id);
    expect(sheetsOrgB?.id).toBe(orgB.sheetsCred.id);
    expect(sheetsLegacy?.id).toBe(legacy.sheetsCred.id);
    expect(new Set([sheetsOrgA?.id, sheetsOrgB?.id, sheetsLegacy?.id]).size).toBe(3);

    const decOrgA = decryptCredentials(sheetsOrgA!.config, DIGEST_TEST_ENC_KEY);
    const decOrgB = decryptCredentials(sheetsOrgB!.config, DIGEST_TEST_ENC_KEY);
    const decLegacy = decryptCredentials(sheetsLegacy!.config, DIGEST_TEST_ENC_KEY);
    expect(decOrgA.allowedScope.spreadsheets).toEqual([ORG_A_SPREADSHEET_ID]);
    expect(decOrgB.allowedScope.spreadsheets).toEqual([ORG_B_SPREADSHEET_ID]);
    expect(decLegacy.allowedScope.spreadsheets).toEqual([LEGACY_SPREADSHEET_ID]);

    const slackOrgA = await credentialRepo.getCredentials('slack', orgA.workspaceId);
    const slackOrgB = await credentialRepo.getCredentials('slack', orgB.workspaceId);
    const slackLegacy = await credentialRepo.getCredentials('slack', null);
    expect(slackOrgA?.id).toBe(orgA.slackCred.id);
    expect(slackOrgB?.id).toBe(orgB.slackCred.id);
    expect(slackLegacy?.id).toBe(legacy.slackCred.id);

    // 3. Conversations have exact trusted workspace_mode and workspace_id
    expect(personalA.conversation.workspace_mode).toBe('personal');
    expect(personalA.conversation.workspace_id).toBeNull();
    expect(personalB.conversation.workspace_mode).toBe('personal');
    expect(personalB.conversation.workspace_id).toBeNull();
    expect(orgA.conversation.workspace_mode).toBe('organization');
    expect(orgA.conversation.workspace_id).toBe(orgA.workspaceId);
    expect(orgB.conversation.workspace_mode).toBe('organization');
    expect(orgB.conversation.workspace_id).toBe(orgB.workspaceId);
    expect(legacy.conversation.workspace_mode).toBe('legacy');
    expect(legacy.conversation.workspace_id).toBeNull();
  });

  it('records outbound provider calls deterministically in createDigestProviderSpy with zero real HTTP calls', async () => {
    const spy = createDigestProviderSpy();
    const { personalA, orgA } = fixtures;

    const orgConfig = {
      version: 2,
      workspaceMode: 'organization' as const,
      workspaceId: orgA.workspaceId,
      source: {
        service: 'sheets' as const,
        credentialId: orgA.sheetsCred.id,
        spreadsheetId: orgA.spreadsheetId,
        spreadsheetTitle: orgA.spreadsheetTitle,
        tailRows: 20,
      },
      destination: {
        service: 'slack' as const,
        credentialId: orgA.slackCred.id,
        channelId: orgA.slackChannelId,
      },
      includeAiSummary: true,
    };

    const sheetsAdapter = await spy.createAdapter('sheets', orgA.member.id, orgConfig, {
      workspaceMode: 'organization',
      workspaceId: orgA.workspaceId,
    });
    const readRes = await sheetsAdapter.execute('sheets.read_range', {
      spreadsheetId: orgA.spreadsheetId,
      range: 'tail:20',
    });
    expect(readRes.totalDataRows).toBe(2);

    const slackAdapter = await spy.createAdapter('slack', orgA.member.id, orgConfig, {
      workspaceMode: 'organization',
      workspaceId: orgA.workspaceId,
    });
    await slackAdapter.execute('slack.send_message', {
      channel: orgA.slackChannelId,
      text: 'Báo cáo KPI Tổ chức A',
    });

    const personalConfig = {
      version: 1,
      source: {
        service: 'mysheets' as const,
        credentialId: personalA.mysheetsCred.id,
        email: personalA.email,
        spreadsheetId: personalA.spreadsheetId,
        spreadsheetTitle: personalA.spreadsheetTitle,
        tailRows: 20,
      },
      destination: {
        service: 'gmail' as const,
        credentialId: personalA.gmailCred.id,
        recipientEmail: 'ceo@company.test',
      },
      includeAiSummary: true,
    };
    const gmailAdapter = await spy.createAdapter('gmail', personalA.user.id, personalConfig, {
      workspaceMode: 'personal',
      workspaceId: null,
    });
    await gmailAdapter.execute('gmail.send_message', {
      to: ['ceo@company.test'],
      subject: 'KPI',
      body: 'Body',
    });

    expect(spy.getCallCount()).toBe(3);
    expect(
      spy.getCallCount({
        service: 'sheets',
        credentialId: orgA.sheetsCred.id,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        spreadsheetId: orgA.spreadsheetId,
      })
    ).toBe(1);
    expect(
      spy.getCallCount({
        service: 'slack',
        credentialId: orgA.slackCred.id,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        targetId: orgA.slackChannelId,
      })
    ).toBe(1);
    expect(
      spy.getCallCount({
        service: 'gmail',
        credentialId: personalA.gmailCred.id,
        workspaceMode: 'personal',
        workspaceId: null,
        targetId: 'ceo@company.test',
      })
    ).toBe(1);

    const calls = spy.getCalls();
    expect(calls[0]).toMatchObject({
      service: 'sheets',
      credentialId: orgA.sheetsCred.id,
      workspaceMode: 'organization',
      workspaceId: orgA.workspaceId,
      spreadsheetId: orgA.spreadsheetId,
      targetId: null,
      callCount: 1,
    });
    expect(calls[1]).toMatchObject({
      service: 'slack',
      credentialId: orgA.slackCred.id,
      workspaceMode: 'organization',
      workspaceId: orgA.workspaceId,
      spreadsheetId: null,
      targetId: orgA.slackChannelId,
      callCount: 1,
    });

    spy.reset();
    expect(spy.getCallCount()).toBe(0);
    expect(spy.getCalls()).toHaveLength(0);
  });

  it('classifies Class A (v1_pinned_consistency_candidate with explicit evidenceBoundary) vs Class B (v1_unpinned_fail_closed) v1 schedules and mutates 0 rows', async () => {
    const { personalA, personalB, orgA, legacy, convRepo } = fixtures;

    // Ensure Personal A and Legacy credentials have created_at strictly before approval time
    const credCreatedAt = new Date('2026-11-01T00:00:00.000Z');
    const approvedAt = new Date('2026-11-02T00:00:00.000Z');
    await db.pool.query(
      'UPDATE service_credentials SET created_at = $1, status_changed_at = NULL WHERE id IN ($2, $3)',
      [credCreatedAt, personalA.mysheetsCred.id, personalA.gmailCred.id]
    );

    // Case 1: Class A (`v1_pinned_consistency_candidate`) — Personal mysheets -> gmail with pinned credentialIds, email, scope, and valid v1 hash
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

    // Case 2: Class B (`v1_unpinned_fail_closed`) — Organization (`workspace_mode = 'organization'`) sheets -> slack v1 schedule
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

    // Case 3: Class B (`v1_unpinned_fail_closed`) — Personal mysheets -> telegram v1 schedule (lacks destination.credentialId)
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

    // Case 4a: Class B (`v1_unpinned_fail_closed`) — Personal mysheets -> gmail where credential was created AFTER digest_approved_at
    const postApprovalTime = new Date('2026-11-05T00:00:00.000Z');
    await db.pool.query(
      'UPDATE service_credentials SET created_at = $1, status_changed_at = NULL WHERE id = $2',
      [postApprovalTime, personalB.mysheetsCred.id]
    );
    await db.pool.query(
      'UPDATE service_credentials SET created_at = $1, status_changed_at = NULL WHERE id = $2',
      [credCreatedAt, personalB.gmailCred.id]
    );
    const schedRotatedCreatedClassB = await insertTestSheetsDigestSchedule(db.pool, {
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

    // Case 4b: Class B (`v1_unpinned_fail_closed`) — Legacy mysheets -> gmail where status_changed_at > digest_approved_at
    const legacyMysheets = await fixtures.credentialRepo.saveCredentials(
      'mysheets',
      personalA.mysheetsCred.config,
      legacy.user.id,
      null
    );
    const legacyGmail = await fixtures.credentialRepo.saveCredentials(
      'gmail',
      personalA.gmailCred.config,
      legacy.user.id,
      null
    );
    await db.pool.query(
      'UPDATE service_credentials SET created_at = $1, status_changed_at = $2 WHERE id IN ($3, $4)',
      [credCreatedAt, postApprovalTime, legacyMysheets.id, legacyGmail.id]
    );
    const schedStatusChangedClassB = await insertTestSheetsDigestSchedule(db.pool, {
      userId: legacy.user.id,
      convId: legacy.conversation.id,
      workspaceMode: 'legacy',
      workspaceId: null,
      digestApprovedAt: approvedAt,
      digestConfig: {
        version: 1,
        source: {
          service: 'mysheets',
          credentialId: legacyMysheets.id,
          email: personalA.email,
          spreadsheetId: personalA.spreadsheetId,
          spreadsheetTitle: personalA.spreadsheetTitle,
          tailRows: 20,
        },
        destination: {
          service: 'gmail',
          credentialId: legacyGmail.id,
          recipientEmail: personalA.email,
        },
        includeAiSummary: true,
      },
    });

    // Snapshot schedules table before running read-only inventory
    const beforeSnapshot = (
      await db.pool.query(
        'SELECT id, status, version, digest_config, digest_config_hash, updated_at FROM schedules ORDER BY id ASC'
      )
    ).rows;

    const report = await inspectV1SheetsDigestSchedules(db.pool, DIGEST_TEST_ENC_KEY);

    // Snapshot schedules table after running read-only inventory -> must be identical (0 mutations)
    const afterSnapshot = (
      await db.pool.query(
        'SELECT id, status, version, digest_config, digest_config_hash, updated_at FROM schedules ORDER BY id ASC'
      )
    ).rows;
    expect(afterSnapshot).toEqual(beforeSnapshot);

    expect(report.summary.totalSchedules).toBe(5);
    expect(report.summary.countsByClass).toEqual({
      v1_pinned_consistency_candidate: 1,
      v1_unpinned_fail_closed: 4,
      v2_ready: 0,
    });
    expect(report.summary.evidenceBoundaryNote).toContain(
      'does NOT prove config immutability'
    );

    const byId = new Map(report.items.map((item) => [item.scheduleId, item]));

    // Verify Case 1: Class A (`v1_pinned_consistency_candidate`) with explicit evidenceBoundary
    const itemA = byId.get(schedClassA.id)!;
    expect(itemA.compatClass).toBe('v1_pinned_consistency_candidate');
    expect(itemA.evidenceBoundary).toBe('consistency_only_not_config_immutability_proof');
    expect(itemA.hasSourceCredId).toBe(true);
    expect(itemA.hasDestCredId).toBe(true);
    expect(itemA.reasons).toEqual([]);

    // Verify Case 2: Organization v1 schedule is Class B (`v1_unpinned_fail_closed`)
    const itemOrgB = byId.get(schedOrgClassB.id)!;
    expect(itemOrgB.compatClass).toBe('v1_unpinned_fail_closed');
    expect(itemOrgB.evidenceBoundary).toBe('unpinned_or_inconsistent');
    expect(itemOrgB.workspaceMode).toBe('organization');
    expect(itemOrgB.hasSourceCredId).toBe(false);
    expect(itemOrgB.hasDestCredId).toBe(false);
    expect(itemOrgB.reasons).toEqual(
      expect.arrayContaining([
        'ORG_V1_UNPINNED_WORKSPACE_SCOPE',
        'SOURCE_SERVICE_NOT_MYSHEETS',
        'MISSING_SOURCE_CREDENTIAL_ID',
        'DEST_SERVICE_NOT_GMAIL',
        'MISSING_DEST_CREDENTIAL_ID',
      ])
    );

    // Verify Case 3: Personal mysheets -> telegram v1 schedule is Class B (`v1_unpinned_fail_closed`)
    const itemTgB = byId.get(schedTelegramClassB.id)!;
    expect(itemTgB.compatClass).toBe('v1_unpinned_fail_closed');
    expect(itemTgB.evidenceBoundary).toBe('unpinned_or_inconsistent');
    expect(itemTgB.hasSourceCredId).toBe(true);
    expect(itemTgB.hasDestCredId).toBe(false);
    expect(itemTgB.reasons).toEqual(
      expect.arrayContaining(['DEST_SERVICE_NOT_GMAIL', 'MISSING_DEST_CREDENTIAL_ID'])
    );

    // Verify Case 4a: created_at > digest_approved_at is Class B (`v1_unpinned_fail_closed`)
    const itemRotatedB = byId.get(schedRotatedCreatedClassB.id)!;
    expect(itemRotatedB.compatClass).toBe('v1_unpinned_fail_closed');
    expect(itemRotatedB.evidenceBoundary).toBe('unpinned_or_inconsistent');
    expect(itemRotatedB.reasons).toContain('SOURCE_CREDENTIAL_CREATED_AFTER_APPROVAL');

    // Verify Case 4b: status_changed_at > digest_approved_at is Class B (`v1_unpinned_fail_closed`)
    const itemStatusChangedB = byId.get(schedStatusChangedClassB.id)!;
    expect(itemStatusChangedB.compatClass).toBe('v1_unpinned_fail_closed');
    expect(itemStatusChangedB.evidenceBoundary).toBe('unpinned_or_inconsistent');
    expect(itemStatusChangedB.reasons).toEqual(
      expect.arrayContaining([
        'SOURCE_CREDENTIAL_STATUS_CHANGED_AFTER_APPROVAL',
        'DEST_CREDENTIAL_STATUS_CHANGED_AFTER_APPROVAL',
      ])
    );
  });
});
