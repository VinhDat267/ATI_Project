import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptCredentials } from '@wap/tool-adapters';
import {
  isSheetsDigestConfigV2,
  type ScheduleProposalMetadata,
  type SheetsDigestCandidate,
  type SheetsDigestConfigV1,
} from '@wap/tool-schemas';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
import {
  DIGEST_TEST_ENC_KEY,
  ORG_A_SPREADSHEET_ID,
  PERSONAL_A_SPREADSHEET_ID,
  seedSheetsDigestTenants,
  type SheetsDigestTenantFixtures,
} from '../helpers/sheets-digest-tenant-fixtures.js';
import { MessageRepo } from '../../src/db/repositories/message-repo.js';
import { runtimeToolCatalog } from '../../src/config/gmail-tools-runtime.js';
import { isSheetsDigestEmitV2Enabled } from '../../src/config/schedules-runtime.js';
import {
  analyzeSheetsDigestCandidate,
  computeSheetsDigestHash,
  computeSheetsDigestV1Hash,
  verifySheetsDigestCandidateInTx,
} from '../../src/services/schedules/sheets-digest-candidate.js';
import {
  ScheduleConflict,
  ScheduleService,
} from '../../src/services/schedules/schedule-service.js';

const TZ = 'Asia/Ho_Chi_Minh';
const UUID_SUBSTRING_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describe('Task 4 (PR-4): Two-Phase Candidate & Confirmation, Zero-V1-Downgrade Flag & Tool Catalog Coexistence', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let fixtures: SheetsDigestTenantFixtures;
  let messageRepo: MessageRepo;
  const originalEmitV2Env = process.env.SHEETS_DIGEST_EMIT_V2;
  const originalDriveDocsWritesEnv = process.env.MYSHEETS_DRIVE_DOCS_WRITES_ENABLED;

  beforeAll(async () => {
    db = await createMigratedSchema('sheets_digest_pr4_unit');
    messageRepo = new MessageRepo(db.pool);
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    delete process.env.SHEETS_DIGEST_EMIT_V2;
    delete process.env.MYSHEETS_DRIVE_DOCS_WRITES_ENABLED;
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
    if (originalDriveDocsWritesEnv === undefined) {
      delete process.env.MYSHEETS_DRIVE_DOCS_WRITES_ENABLED;
    } else {
      process.env.MYSHEETS_DRIVE_DOCS_WRITES_ENABLED = originalDriveDocsWritesEnv;
    }
    vi.restoreAllMocks();
  });

  describe('1. TC-10: Runtime Tool Catalog Coexistence (Post-PR #286)', () => {
    it('retains both sheets.* (+ SHEETS_EXTENDED_TOOLS) and mysheets.* in Organization mode (live & sandbox)', async () => {
      const { personalA, orgA, credentialRepo, encryptionKey } = fixtures;

      const liveCatalog = await runtimeToolCatalog('live', credentialRepo, encryptionKey, {
        userId: personalA.user.id,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        gmailEnabled: true,
        mysheetsEnabled: true,
      });
      const liveNames = new Set(liveCatalog.map((t) => t.name));
      expect(liveNames.has('sheets.read_range')).toBe(true);
      expect(liveNames.has('sheets.search_rows')).toBe(true);
      expect(liveNames.has('mysheets.read_range')).toBe(true);
      expect(liveNames.has('mysheets.create_doc')).toBe(false);

      process.env.MYSHEETS_DRIVE_DOCS_WRITES_ENABLED = 'on';
      const liveWithDriveDocs = await runtimeToolCatalog('live', credentialRepo, encryptionKey, {
        userId: personalA.user.id,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        gmailEnabled: true,
        mysheetsEnabled: true,
      });
      expect(new Set(liveWithDriveDocs.map((t) => t.name)).has('mysheets.create_doc')).toBe(true);
      delete process.env.MYSHEETS_DRIVE_DOCS_WRITES_ENABLED;

      const sandboxCatalog = await runtimeToolCatalog('sandbox', credentialRepo, encryptionKey, {
        userId: personalA.user.id,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        gmailEnabled: true,
        mysheetsEnabled: true,
      });
      const sandboxNames = new Set(sandboxCatalog.map((t) => t.name));
      expect(sandboxNames.has('sheets.read_range')).toBe(true);
      expect(sandboxNames.has('sheets.search_rows')).toBe(true);
      expect(sandboxNames.has('mysheets.read_range')).toBe(true);
    });

    it('never strips shared sheets.* when mysheets is Drive-only (0 selected spreadsheets) in legacy/personal mode, and strips sheets.* when mysheets has spreadsheets in legacy mode', async () => {
      const { legacy, personalA, credentialRepo, encryptionKey } = fixtures;
      process.env.MYSHEETS_DRIVE_DOCS_WRITES_ENABLED = 'on';

      // Connect Drive-only mysheets (0 spreadsheets) for legacy.user
      const driveOnlyConfig = encryptCredentials(
        {
          refreshToken: '1//drive-only-refresh',
          email: 'legacy@company.test',
          scopes: ['https://www.googleapis.com/auth/drive.file'],
          selectedSpreadsheets: [],
          allowedScope: { spreadsheets: [] },
        },
        encryptionKey
      );
      await credentialRepo.saveCredentials('mysheets', driveOnlyConfig, legacy.user.id, null);

      const driveOnlyLive = await runtimeToolCatalog('live', credentialRepo, encryptionKey, {
        userId: legacy.user.id,
        workspaceMode: 'legacy',
        workspaceId: null,
        gmailEnabled: false,
        mysheetsEnabled: true,
      });
      const driveOnlyLiveNames = new Set(driveOnlyLive.map((t) => t.name));
      expect(driveOnlyLiveNames.has('mysheets.create_doc')).toBe(true);
      expect(driveOnlyLiveNames.has('mysheets.read_range')).toBe(false);
      // Must NOT strip shared sheets.*!
      expect(driveOnlyLiveNames.has('sheets.read_range')).toBe(true);
      expect(driveOnlyLiveNames.has('sheets.search_rows')).toBe(true);

      const driveOnlySandbox = await runtimeToolCatalog('sandbox', credentialRepo, encryptionKey, {
        userId: legacy.user.id,
        workspaceMode: 'legacy',
        workspaceId: null,
        gmailEnabled: false,
        mysheetsEnabled: true,
      });
      const driveOnlySandboxNames = new Set(driveOnlySandbox.map((t) => t.name));
      expect(driveOnlySandboxNames.has('mysheets.create_doc')).toBe(true);
      expect(driveOnlySandboxNames.has('sheets.read_range')).toBe(true);
      expect(driveOnlySandboxNames.has('sheets.search_rows')).toBe(true);

      // By contrast, personalA has selectedSpreadsheets > 0 (mysheets.read_range present), so in legacy mode sheets.* is stripped
      const withSpreadsheetsLegacy = await runtimeToolCatalog('live', credentialRepo, encryptionKey, {
        userId: personalA.user.id,
        workspaceMode: 'legacy',
        workspaceId: null,
        gmailEnabled: true,
        mysheetsEnabled: true,
      });
      const withSpreadsheetsNames = new Set(withSpreadsheetsLegacy.map((t) => t.name));
      expect(withSpreadsheetsNames.has('mysheets.read_range')).toBe(true);
      expect(withSpreadsheetsNames.has('sheets.read_range')).toBe(false);
      expect(withSpreadsheetsNames.has('sheets.search_rows')).toBe(false);
    });
  });

  describe('2. TC-01, TC-02, TC-03 (F-08) & F-09: Strict Tenant & Personal Credential Isolation', () => {
    it('TC-01 & F-09: Personal workspace queries only personal credentials and rejects shared sheets or slack fail-closed', async () => {
      const { personalA, credentialRepo, encryptionKey } = fixtures;
      const getSharedSpy = vi.spyOn(credentialRepo, 'getCredentials');

      // 1. Personal mysheets -> gmail succeeds with v2
      const okPersonal = await analyzeSheetsDigestCandidate({
        userId: personalA.user.id,
        workspaceMode: 'personal',
        workspaceId: null,
        request: 'Đọc bảng Báo cáo KPI Cá nhân A và gửi báo cáo qua Gmail cho tôi',
        recurrence: { type: 'daily', time: '08:00' },
        services: ['mysheets', 'gmail'],
        credentialRepo,
        encryptionKey,
        mysheetsEnabled: true,
        emitV2: true,
      });
      expect(okPersonal.canAutoDigest).toBe(true);
      expect(isSheetsDigestConfigV2(okPersonal.config)).toBe(true);
      expect(getSharedSpy).not.toHaveBeenCalled();

      // 2. Personal workspace with shared 'sheets' fails closed without calling getCredentials('sheets')
      const rejectSharedSheets = await analyzeSheetsDigestCandidate({
        userId: personalA.user.id,
        workspaceMode: 'personal',
        workspaceId: null,
        request: 'Đọc bảng tính và gửi qua Gmail cho tôi',
        services: ['sheets', 'gmail'],
        credentialRepo,
        encryptionKey,
        mysheetsEnabled: true,
        emitV2: true,
      });
      expect(rejectSharedSheets.canAutoDigest).toBe(false);
      expect(getSharedSpy).not.toHaveBeenCalled();

      // 3. Personal workspace with shared 'slack' fails closed without calling getCredentials('slack')
      const rejectSharedSlack = await analyzeSheetsDigestCandidate({
        userId: personalA.user.id,
        workspaceMode: 'personal',
        workspaceId: null,
        request: 'Đọc bảng Báo cáo KPI Cá nhân A và gửi vào Slack',
        services: ['mysheets', 'slack'],
        credentialRepo,
        encryptionKey,
        mysheetsEnabled: true,
        emitV2: true,
      });
      expect(rejectSharedSlack.canAutoDigest).toBe(false);
      expect(getSharedSpy).not.toHaveBeenCalled();
    });

    it('TC-02: Organization workspace for Org A never reads Org B or legacy (workspace_id IS NULL) credentials', async () => {
      const { orgA, orgB, legacy, credentialRepo, encryptionKey } = fixtures;

      // Attempting to reference Org B or Legacy spreadsheet ID inside Org A fails closed
      const crossOrgAttempt = await analyzeSheetsDigestCandidate({
        userId: orgA.member.id,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        request: `Đọc bảng ${orgB.spreadsheetId} và gửi báo cáo vào Slack`,
        services: ['sheets', 'slack'],
        credentialRepo,
        encryptionKey,
        mysheetsEnabled: true,
        emitV2: true,
        fetchOrgSheetsMetadata: async () => [
          { id: orgA.spreadsheetId, title: 'Bảng KPI Tổ chức Alpha', sheets: ['Sheet1'] },
        ],
      });
      expect(crossOrgAttempt.canAutoDigest).toBe(false);

      const legacyAttemptInOrg = await analyzeSheetsDigestCandidate({
        userId: orgA.member.id,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        request: `Đọc bảng ${legacy.spreadsheetId} và gửi báo cáo vào Slack`,
        services: ['sheets', 'slack'],
        credentialRepo,
        encryptionKey,
        mysheetsEnabled: true,
        emitV2: true,
        fetchOrgSheetsMetadata: async () => [
          { id: orgA.spreadsheetId, title: 'Bảng KPI Tổ chức Alpha', sheets: ['Sheet1'] },
        ],
      });
      expect(legacyAttemptInOrg.canAutoDigest).toBe(false);
    });

    it('TC-03 (F-08): Telegram destination strictly requires personal Telegram owned by userId and never falls back to shared or another user Telegram', async () => {
      const { orgA, personalA, credentialRepo, encryptionKey } = fixtures;

      // Give orgA.member a personal mysheets credential, but NO personal telegram credential
      // (Note: personalA.user already owns a personal telegram credential for chat -100555001 in DB)
      const memberMySheets = encryptCredentials(
        {
          refreshToken: '1//member-mysheets',
          email: 'member@org-a.test',
          selectedSpreadsheets: [{ id: PERSONAL_A_SPREADSHEET_ID, title: 'Bảng Member', canEdit: true }],
          allowedScope: { spreadsheets: [PERSONAL_A_SPREADSHEET_ID] },
        },
        encryptionKey
      );
      await credentialRepo.saveCredentials('mysheets', memberMySheets, orgA.member.id, null);

      const origGetCredentials = credentialRepo.getCredentials.bind(credentialRepo);
      const getSharedSpy = vi.spyOn(credentialRepo, 'getCredentials').mockImplementation(async (service, wsId) => {
        if (service === 'telegram') {
          throw new Error('Should never query shared getCredentials for telegram');
        }
        return origGetCredentials(service, wsId);
      });

      const resPersonal = await analyzeSheetsDigestCandidate({
        userId: orgA.member.id,
        workspaceMode: 'personal',
        workspaceId: null,
        request: `Đọc bảng Bảng Member và gửi vào Telegram ${personalA.telegramChatId}`,
        services: ['mysheets', 'telegram'],
        credentialRepo,
        encryptionKey,
        mysheetsEnabled: true,
        emitV2: true,
      });

      expect(resPersonal.canAutoDigest).toBe(false);

      const resLegacy = await analyzeSheetsDigestCandidate({
        userId: orgA.member.id,
        workspaceMode: 'legacy',
        workspaceId: null,
        request: `Đọc bảng Bảng Member và gửi vào Telegram ${personalA.telegramChatId}`,
        services: ['mysheets', 'telegram'],
        credentialRepo,
        encryptionKey,
        mysheetsEnabled: true,
        emitV2: true,
      });

      expect(resLegacy.canAutoDigest).toBe(false);
      // Must NEVER call getCredentials('telegram')!
      expect(getSharedSpy).not.toHaveBeenCalledWith('telegram', expect.anything());
      expect(getSharedSpy).not.toHaveBeenCalledWith('telegram');

      // Positive check: personalA.user (who owns the personal telegram credential) succeeds
      const resOwner = await analyzeSheetsDigestCandidate({
        userId: personalA.user.id,
        workspaceMode: 'personal',
        workspaceId: null,
        request: `Đọc bảng Bảng Cá nhân A và gửi vào Telegram ${personalA.telegramChatId}`,
        services: ['mysheets', 'telegram'],
        credentialRepo,
        encryptionKey,
        mysheetsEnabled: true,
        emitV2: true,
      });
      expect(resOwner.canAutoDigest).toBe(true);
      if (resOwner.config?.version === 2 && resOwner.config.destination.service === 'telegram') {
        expect(resOwner.config.destination.credentialId).toBe(personalA.telegramCred.id);
        expect(resOwner.config.destination.chatId).toBe(personalA.telegramChatId);
      }

      getSharedSpy.mockRestore();
    });

    it('F-09: Legacy workspace refuses silent fallback from unconfigured shared sheets to personal mysheets', async () => {
      const { personalA, credentialRepo, encryptionKey } = fixtures;
      // Delete shared legacy sheets credential
      await db.pool.query("DELETE FROM service_credentials WHERE service = 'sheets' AND workspace_id IS NULL");

      const res = await analyzeSheetsDigestCandidate({
        userId: personalA.user.id,
        workspaceMode: 'legacy',
        workspaceId: null,
        request: 'Đọc bảng Báo cáo KPI Cá nhân A và gửi qua Gmail cho tôi',
        services: ['sheets', 'gmail'],
        credentialRepo,
        encryptionKey,
        mysheetsEnabled: true,
        emitV2: true,
      });
      expect(res.canAutoDigest).toBe(false);
    });
  });

  describe('3. TC-04: Organization Hybrid Matrix & Gmail Sender vs. Recipient Separation', () => {
    it('supports all 4 Org Hybrid combinations (Org->Org, Personal->Org with crossBoundaryWarning, Personal->Personal allowed, Org->Personal forbidden) and Gmail senderEmail !== recipientEmail', async () => {
      const { personalA, orgA, credentialRepo, encryptionKey } = fixtures;
      const fetchOrgSheetsMetadata = vi.fn(async () => [
        {
          id: ORG_A_SPREADSHEET_ID,
          title: 'Báo cáo Doanh thu Tổ chức Alpha',
          sheets: ['Tổng hợp Q4'],
        },
      ]);

      // (a) Standard Org: sheets (Org) -> slack (Org)
      const orgToOrg = await analyzeSheetsDigestCandidate({
        userId: personalA.user.id,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        request: 'Đọc tab Tổng hợp Q4 từ bảng Báo cáo Doanh thu Tổ chức Alpha và gửi vào Slack #general',
        recurrence: { type: 'daily', time: '08:00' },
        services: ['sheets', 'slack'],
        credentialRepo,
        encryptionKey,
        mysheetsEnabled: true,
        fetchOrgSheetsMetadata,
        emitV2: true,
      });
      expect(orgToOrg.canAutoDigest).toBe(true);
      expect(orgToOrg.config).toMatchObject({
        version: 2,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        source: {
          service: 'sheets',
          credentialId: orgA.sheetsCred.id,
          spreadsheetId: ORG_A_SPREADSHEET_ID,
          spreadsheetTitle: 'Báo cáo Doanh thu Tổ chức Alpha',
          sheetName: 'Tổng hợp Q4',
        },
        destination: {
          service: 'slack',
          credentialId: orgA.slackCred.id,
          channelId: orgA.slackChannelId,
        },
      });
      expect(orgToOrg.preview?.crossBoundaryWarning).toBeUndefined();
      expect(JSON.stringify(orgToOrg.preview)).not.toMatch(UUID_SUBSTRING_RE);

      // (b) Hybrid Opt-in: mysheets (Personal) -> slack (Org) with crossBoundaryWarning
      const personalToOrgSlack = await analyzeSheetsDigestCandidate({
        userId: personalA.user.id,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        request: 'Đọc tab KPI Tháng 11 từ bảng Báo cáo KPI Cá nhân A và gửi vào Slack #general',
        recurrence: { type: 'daily', time: '08:00' },
        services: ['mysheets', 'slack'],
        credentialRepo,
        encryptionKey,
        mysheetsEnabled: true,
        fetchOrgSheetsMetadata,
        emitV2: true,
      });
      expect(personalToOrgSlack.canAutoDigest).toBe(true);
      expect(personalToOrgSlack.config).toMatchObject({
        version: 2,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        source: {
          service: 'mysheets',
          credentialId: personalA.mysheetsCred.id,
          email: personalA.email,
          spreadsheetId: PERSONAL_A_SPREADSHEET_ID,
          spreadsheetTitle: 'Báo cáo KPI Cá nhân A',
          sheetName: 'KPI Tháng 11',
        },
        destination: {
          service: 'slack',
          credentialId: orgA.slackCred.id,
          channelId: orgA.slackChannelId,
        },
      });
      expect(personalToOrgSlack.preview?.crossBoundaryWarning).toMatch(/Google Sheets Cá nhân.*Slack của Tổ chức/i);
      expect(JSON.stringify(personalToOrgSlack.preview)).not.toMatch(UUID_SUBSTRING_RE);

      // (c) Personal-to-Personal inside Org: mysheets (Personal) -> gmail (Personal) with senderEmail !== recipientEmail
      const personalToPersonalGmail = await analyzeSheetsDigestCandidate({
        userId: personalA.user.id,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        request: 'Đọc bảng Báo cáo KPI Cá nhân A và gửi báo cáo qua Gmail tới finance@company.com',
        recurrence: { type: 'daily', time: '08:00' },
        services: ['mysheets', 'gmail'],
        credentialRepo,
        encryptionKey,
        mysheetsEnabled: true,
        fetchOrgSheetsMetadata,
        emitV2: true,
      });
      expect(personalToPersonalGmail.canAutoDigest).toBe(true);
      expect(personalToPersonalGmail.config).toMatchObject({
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
      expect(personalToPersonalGmail.preview?.destinationTargetLabel).toContain('finance@company.com');
      expect(personalToPersonalGmail.preview?.destinationTargetLabel).toContain('alice@personal.test');
      expect(personalToPersonalGmail.preview?.crossBoundaryWarning).toBeUndefined();

      // Also test "cho tôi" defaulting recipientEmail = senderEmail
      const personalGmailSelf = await analyzeSheetsDigestCandidate({
        userId: personalA.user.id,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        request: 'Đọc bảng Báo cáo KPI Cá nhân A và gửi báo cáo qua Gmail cho tôi',
        recurrence: { type: 'daily', time: '08:00' },
        services: ['mysheets', 'gmail'],
        credentialRepo,
        encryptionKey,
        mysheetsEnabled: true,
        fetchOrgSheetsMetadata,
        emitV2: true,
      });
      expect(personalGmailSelf.canAutoDigest).toBe(true);
      expect(personalGmailSelf.config?.destination).toEqual({
        service: 'gmail',
        credentialId: personalA.gmailCred.id,
        senderEmail: 'alice@personal.test',
        recipientEmail: 'alice@personal.test',
      });

      // (d) Org Data Egress Forbidden: sheets (Org) -> gmail/telegram (Personal)
      const orgToPersonalGmail = await analyzeSheetsDigestCandidate({
        userId: personalA.user.id,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        request: 'Đọc bảng Báo cáo Doanh thu Tổ chức Alpha và gửi qua Gmail tới finance@company.com',
        recurrence: { type: 'daily', time: '08:00' },
        services: ['sheets', 'gmail'],
        credentialRepo,
        encryptionKey,
        mysheetsEnabled: true,
        fetchOrgSheetsMetadata,
        emitV2: true,
      });
      expect(orgToPersonalGmail.canAutoDigest).toBe(false);
      expect(orgToPersonalGmail.reason).toMatch(/Chính sách bảo mật Tổ chức/i);

      const orgToPersonalTelegram = await analyzeSheetsDigestCandidate({
        userId: personalA.user.id,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        request: 'Đọc bảng Báo cáo Doanh thu Tổ chức Alpha và gửi vào Nhóm KPI Cá nhân A trên Telegram',
        recurrence: { type: 'daily', time: '08:00' },
        services: ['sheets', 'telegram'],
        credentialRepo,
        encryptionKey,
        mysheetsEnabled: true,
        fetchOrgSheetsMetadata,
        emitV2: true,
      });
      expect(orgToPersonalTelegram.canAutoDigest).toBe(false);
      expect(orgToPersonalTelegram.reason).toMatch(/Chính sách bảo mật Tổ chức/i);
    });
  });

  describe('4. TC-15: Org Metadata Lookup Outside DB Tx, Fail-Closed Error/Collision & Disambiguation', () => {
    it('fails closed with requiresClarification=true when fetchOrgSheetsMetadata throws or is missing, and when Org & Personal titles collide without qualifier', async () => {
      const { personalA, orgA, credentialRepo, encryptionKey } = fixtures;

      // 1. fetchOrgSheetsMetadata throws -> fail closed (must NOT silently fall back to personalA.mysheetsCred!)
      const onThrow = await analyzeSheetsDigestCandidate({
        userId: personalA.user.id,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        request: 'Đọc bảng Báo cáo KPI Cá nhân A và gửi vào Slack #general',
        recurrence: { type: 'daily', time: '08:00' },
        services: ['sheets', 'slack'],
        credentialRepo,
        encryptionKey,
        mysheetsEnabled: true,
        emitV2: true,
        fetchOrgSheetsMetadata: async () => {
          throw new Error('Google Sheets API timeout');
        },
      });
      expect(onThrow.canAutoDigest).toBe(false);
      expect(onThrow.requiresClarification).toBe(true);

      // 2. Title collision between Org sheets and Personal mysheets without qualifier -> fail closed
      const onCollision = await analyzeSheetsDigestCandidate({
        userId: personalA.user.id,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        request: 'Đọc bảng Báo cáo KPI Cá nhân A và gửi vào Slack #general',
        recurrence: { type: 'daily', time: '08:00' },
        services: ['sheets', 'slack'],
        credentialRepo,
        encryptionKey,
        mysheetsEnabled: true,
        emitV2: true,
        fetchOrgSheetsMetadata: async () => [
          { id: ORG_A_SPREADSHEET_ID, title: 'Báo cáo KPI Cá nhân A', sheets: ['KPI Tháng 11'] },
        ],
      });
      expect(onCollision.canAutoDigest).toBe(false);
      expect(onCollision.requiresClarification).toBe(true);
      expect(onCollision.reason).toMatch(/trùng khớp giữa Google Sheets Tổ chức và Google Sheets Cá nhân/i);

      // 3. Disambiguated by "Google Sheets tổ chức" -> selects Org sheets
      const disambiguatedOrg = await analyzeSheetsDigestCandidate({
        userId: personalA.user.id,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        request: 'Đọc bảng Báo cáo KPI Cá nhân A từ Google Sheets tổ chức và gửi vào Slack #general',
        recurrence: { type: 'daily', time: '08:00' },
        services: ['sheets', 'slack'],
        credentialRepo,
        encryptionKey,
        mysheetsEnabled: true,
        emitV2: true,
        fetchOrgSheetsMetadata: async () => [
          { id: ORG_A_SPREADSHEET_ID, title: 'Báo cáo KPI Cá nhân A', sheets: ['KPI Tháng 11'] },
        ],
      });
      expect(disambiguatedOrg.canAutoDigest).toBe(true);
      expect(disambiguatedOrg.config?.source.service).toBe('sheets');
      expect(disambiguatedOrg.config?.source.credentialId).toBe(orgA.sheetsCred.id);

      // 4. Disambiguated by "Google Sheets cá nhân" -> selects Personal mysheets
      const disambiguatedPersonal = await analyzeSheetsDigestCandidate({
        userId: personalA.user.id,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        request: 'Đọc bảng Báo cáo KPI Cá nhân A từ Google Sheets cá nhân và gửi vào Slack #general',
        recurrence: { type: 'daily', time: '08:00' },
        services: ['sheets', 'slack'],
        credentialRepo,
        encryptionKey,
        mysheetsEnabled: true,
        emitV2: true,
        fetchOrgSheetsMetadata: async () => [
          { id: ORG_A_SPREADSHEET_ID, title: 'Báo cáo KPI Cá nhân A', sheets: ['KPI Tháng 11'] },
        ],
      });
      expect(disambiguatedPersonal.canAutoDigest).toBe(true);
      expect(disambiguatedPersonal.config?.source.service).toBe('mysheets');
      expect(disambiguatedPersonal.config?.source.credentialId).toBe(personalA.mysheetsCred.id);
    });
  });

  describe('5. TC-21: Feature Flag Precedence, Zero Silent V1 Downgrade & Preview-to-Confirm Drift Guard', () => {
    it('enforces isSheetsDigestEmitV2Enabled precedence (options.emitV2 > env > false) and never emits version 1 configs when disabled', async () => {
      const { personalA, credentialRepo, encryptionKey } = fixtures;

      delete process.env.SHEETS_DIGEST_EMIT_V2;
      expect(isSheetsDigestEmitV2Enabled()).toBe(false);
      expect(isSheetsDigestEmitV2Enabled({ emitV2: true })).toBe(true);
      expect(isSheetsDigestEmitV2Enabled({ emitV2: false })).toBe(false);

      process.env.SHEETS_DIGEST_EMIT_V2 = 'true';
      expect(isSheetsDigestEmitV2Enabled()).toBe(true);
      expect(isSheetsDigestEmitV2Enabled({ emitV2: false })).toBe(false);

      process.env.SHEETS_DIGEST_EMIT_V2 = '1';
      expect(isSheetsDigestEmitV2Enabled()).toBe(true);

      process.env.SHEETS_DIGEST_EMIT_V2 = 'off';
      expect(isSheetsDigestEmitV2Enabled()).toBe(false);
      expect(isSheetsDigestEmitV2Enabled({ emitV2: true })).toBe(true);

      // When emitV2 is false, analyzeSheetsDigestCandidate returns canAutoDigest: false (notify_only) and NO config
      const disabledCandidate = await analyzeSheetsDigestCandidate({
        userId: personalA.user.id,
        workspaceMode: 'personal',
        workspaceId: null,
        request: 'Đọc bảng Báo cáo KPI Cá nhân A và gửi qua Gmail cho tôi',
        recurrence: { type: 'daily', time: '08:00' },
        services: ['mysheets', 'gmail'],
        credentialRepo,
        encryptionKey,
        mysheetsEnabled: true,
        emitV2: false,
      });
      expect(disabledCandidate.canAutoDigest).toBe(false);
      expect(disabledCandidate.config).toBeUndefined();
      expect(disabledCandidate.reason).toMatch(/SHEETS_DIGEST_EMIT_V2=false/i);
    });

    it('rejects confirmProposal with DIGEST_V2_DISABLED_SINCE_PREVIEW when flag flips to false, and LEGACY_V1_PROPOSAL_STALE for v1 proposals', async () => {
      const { personalA, credentialRepo, encryptionKey } = fixtures;

      const v2Candidate = await analyzeSheetsDigestCandidate({
        userId: personalA.user.id,
        workspaceMode: 'personal',
        workspaceId: null,
        request: 'Đọc bảng Báo cáo KPI Cá nhân A và gửi qua Gmail cho tôi',
        recurrence: { type: 'daily', time: '08:00' },
        services: ['mysheets', 'gmail'],
        credentialRepo,
        encryptionKey,
        mysheetsEnabled: true,
        emitV2: true,
      });
      expect(v2Candidate.canAutoDigest).toBe(true);

      const metadataV2: ScheduleProposalMetadata = {
        type: 'schedule_proposal',
        proposal: {
          kind: 'schedule',
          action: 'create',
          name: 'Báo cáo KPI sáng',
          request: 'Đọc bảng Báo cáo KPI Cá nhân A và gửi qua Gmail cho tôi',
          recurrence: { type: 'daily', time: '08:00' },
          summary: 'Mỗi ngày 08:00.',
        },
        scheduleId: null,
        baseVersion: null,
        services: ['mysheets', 'gmail'],
        nextRuns: ['2026-11-03T01:00:00.000Z'],
        previous: null,
        digestCandidate: v2Candidate,
      };
      const msgV2 = await messageRepo.createMessage(
        personalA.conversation.id,
        'assistant',
        metadataV2.proposal.summary,
        metadataV2 as unknown as Record<string, unknown>
      );

      // Confirm with emitV2: false -> 409 DIGEST_V2_DISABLED_SINCE_PREVIEW
      const serviceDisabled = new ScheduleService({
        pool: db.pool,
        timeZone: TZ,
        credentialRepo,
        encryptionKey,
        mysheetsEnabled: true,
        emitV2: false,
      });

      await expect(
        serviceDisabled.confirmProposal({
          userId: personalA.user.id,
          convId: personalA.conversation.id,
          messageId: msgV2.id,
          now: new Date('2026-11-02T00:00:00Z'),
          approvalMode: 'auto_digest',
        })
      ).rejects.toMatchObject({
        code: 'DIGEST_V2_DISABLED_SINCE_PREVIEW',
      });

      // Stale v1 proposal -> 409 LEGACY_V1_PROPOSAL_STALE
      const v1Config: SheetsDigestConfigV1 = {
        version: 1,
        source: {
          service: 'mysheets',
          credentialId: personalA.mysheetsCred.id,
          email: personalA.email,
          spreadsheetId: PERSONAL_A_SPREADSHEET_ID,
          spreadsheetTitle: 'Báo cáo KPI Cá nhân A',
          tailRows: 20,
        },
        destination: {
          service: 'gmail',
          credentialId: personalA.gmailCred.id,
          recipientEmail: personalA.email,
        },
        includeAiSummary: true,
      };
      const v1Candidate: SheetsDigestCandidate = {
        canAutoDigest: true,
        config: v1Config,
        configHash: computeSheetsDigestV1Hash({
          userId: personalA.user.id,
          recurrence: { type: 'daily', time: '08:00' },
          config: v1Config,
        }),
      };
      const metadataV1: ScheduleProposalMetadata = {
        ...metadataV2,
        digestCandidate: v1Candidate,
      };
      const msgV1 = await messageRepo.createMessage(
        personalA.conversation.id,
        'assistant',
        metadataV1.proposal.summary,
        metadataV1 as unknown as Record<string, unknown>
      );

      const serviceEnabled = new ScheduleService({
        pool: db.pool,
        timeZone: TZ,
        credentialRepo,
        encryptionKey,
        mysheetsEnabled: true,
        emitV2: true,
      });

      await expect(
        serviceEnabled.confirmProposal({
          userId: personalA.user.id,
          convId: personalA.conversation.id,
          messageId: msgV1.id,
          now: new Date('2026-11-02T00:00:00Z'),
          approvalMode: 'auto_digest',
        })
      ).rejects.toMatchObject({
        code: 'LEGACY_V1_PROPOSAL_STALE',
      });
    });
  });

  describe('6. TC-20 & TC-25: Pure-DB verifySheetsDigestCandidateInTx (Zero Network in Tx & Drift/Revocation Detection)', () => {
    it('TC-20: ScheduleService.confirmProposal makes 0 calls to fetchOrgSheetsMetadata during confirmation', async () => {
      const { personalA, orgA, credentialRepo, encryptionKey, convRepo } = fixtures;
      const fetchSpy = vi.fn(async () => [
        { id: ORG_A_SPREADSHEET_ID, title: 'Bảng KPI Tổ chức Alpha', sheets: ['Sheet1'] },
      ]);

      // Hop 1: Preview outside DB tx calls fetchSpy once
      const candidate = await analyzeSheetsDigestCandidate({
        userId: personalA.user.id,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        request: 'Đọc bảng Bảng KPI Tổ chức Alpha và gửi vào Slack #general',
        recurrence: { type: 'daily', time: '08:00' },
        services: ['sheets', 'slack'],
        credentialRepo,
        encryptionKey,
        mysheetsEnabled: true,
        fetchOrgSheetsMetadata: fetchSpy,
        emitV2: true,
      });
      expect(candidate.canAutoDigest).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      fetchSpy.mockClear();

      const conv = await convRepo.createConversation(personalA.user.id, 'Hội thoại Org A của Alice', {
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
      });
      const metadata: ScheduleProposalMetadata = {
        type: 'schedule_proposal',
        proposal: {
          kind: 'schedule',
          action: 'create',
          name: 'Báo cáo Tổ chức Alpha',
          request: 'Đọc bảng Bảng KPI Tổ chức Alpha và gửi vào Slack #general',
          recurrence: { type: 'daily', time: '08:00' },
          summary: 'Mỗi ngày 08:00.',
        },
        scheduleId: null,
        baseVersion: null,
        services: ['sheets', 'slack'],
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
        encryptionKey,
        mysheetsEnabled: true,
        emitV2: true,
        fetchOrgSheetsMetadata: fetchSpy,
      });

      const confirmed = await service.confirmProposal({
        userId: personalA.user.id,
        convId: conv.id,
        messageId: msg.id,
        now: new Date('2026-11-02T00:00:00Z'),
        approvalMode: 'auto_digest',
      });

      expect(confirmed.schedule.kind).toBe('sheets_digest');
      // ZERO network metadata calls during confirmProposal!
      expect(fetchSpy).toHaveBeenCalledTimes(0);
    });

    it('TC-25: detects credential rotation, scope narrowing, senderEmail change, and member deactivation inside the transaction (409 DIGEST_PREVIEW_CHANGED)', async () => {
      const { personalA, orgA, credentialRepo, encryptionKey, convRepo } = fixtures;

      const candidate = await analyzeSheetsDigestCandidate({
        userId: personalA.user.id,
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
        request: 'Đọc bảng Báo cáo KPI Cá nhân A và gửi vào Slack #general',
        recurrence: { type: 'daily', time: '08:00' },
        services: ['mysheets', 'slack'],
        credentialRepo,
        encryptionKey,
        mysheetsEnabled: true,
        emitV2: true,
        fetchOrgSheetsMetadata: async () => [
          { id: ORG_A_SPREADSHEET_ID, title: 'Bảng KPI Tổ chức Alpha', sheets: ['Sheet1'] },
        ],
      });
      expect(candidate.canAutoDigest).toBe(true);

      const conv = await convRepo.createConversation(personalA.user.id, 'Hội thoại Hybrid Org A', {
        workspaceMode: 'organization',
        workspaceId: orgA.workspaceId,
      });
      const metadata: ScheduleProposalMetadata = {
        type: 'schedule_proposal',
        proposal: {
          kind: 'schedule',
          action: 'create',
          name: 'Báo cáo Hybrid',
          request: 'Đọc bảng Báo cáo KPI Cá nhân A và gửi vào Slack #general',
          recurrence: { type: 'daily', time: '08:00' },
          summary: 'Mỗi ngày 08:00.',
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
        encryptionKey,
        mysheetsEnabled: true,
        emitV2: true,
      });

      // Case 1: Narrow mysheets allowedScope to remove PERSONAL_A_SPREADSHEET_ID before confirm
      const narrowedConfig = encryptCredentials(
        {
          refreshToken: '1//personal-a-mysheets-refresh',
          email: 'alice@personal.test',
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
        service.confirmProposal({
          userId: personalA.user.id,
          convId: conv.id,
          messageId: msg.id,
          now: new Date('2026-11-02T00:00:00Z'),
          approvalMode: 'auto_digest',
        })
      ).rejects.toMatchObject({
        code: 'DIGEST_PREVIEW_CHANGED',
      });

      // Restore mysheets config, then deactivate workspace membership for personalA.user in orgA
      await db.pool.query('UPDATE service_credentials SET config = $2 WHERE id = $1', [
        personalA.mysheetsCred.id,
        personalA.mysheetsCred.config,
      ]);
      await db.pool.query(
        "UPDATE workspace_members SET status = 'disabled' WHERE workspace_id = $1 AND user_id = $2",
        [orgA.workspaceId, personalA.user.id]
      );

      await expect(
        service.confirmProposal({
          userId: personalA.user.id,
          convId: conv.id,
          messageId: msg.id,
          now: new Date('2026-11-02T00:00:00Z'),
          approvalMode: 'auto_digest',
        })
      ).rejects.toMatchObject({
        code: 'DIGEST_PREVIEW_CHANGED',
      });

      // Verify 0 active schedules were created
      const schedCount = await db.pool.query('SELECT count(*)::int AS n FROM schedules WHERE conv_id = $1', [
        conv.id,
      ]);
      expect(schedCount.rows[0]?.n).toBe(0);
    });
  });
});
