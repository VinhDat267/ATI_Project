import type pg from 'pg';
import { decryptCredentials, encryptCredentials } from '@wap/tool-adapters';
import type { ScheduleRecurrence, ScheduleStatus, SheetsDigestConfig } from '@wap/tool-schemas';
import { CredentialRepo, type ServiceCredentialRow } from '../../src/db/repositories/credential-repo.js';
import { WorkspaceRepo, type WorkspaceSummary } from '../../src/db/repositories/workspace-repo.js';
import { ConversationRepo, type ConversationRow } from '../../src/db/repositories/conversation-repo.js';
import { computeSheetsDigestHash } from '../../src/services/schedules/sheets-digest-candidate.js';
import type { createMigratedSchema } from './gmail-test-db.js';

export const DIGEST_TEST_ENC_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

export const PERSONAL_A_SPREADSHEET_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upPA';
export const PERSONAL_B_SPREADSHEET_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upPB';
export const ORG_A_SPREADSHEET_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upOA';
export const ORG_B_SPREADSHEET_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upOB';
export const LEGACY_SPREADSHEET_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upLG';

export type TestPerson = Awaited<ReturnType<Awaited<ReturnType<typeof createMigratedSchema>>['person']>>;

export interface TenantPersonalFixture {
  user: TestPerson;
  conversation: ConversationRow;
  mysheetsCred: ServiceCredentialRow;
  gmailCred: ServiceCredentialRow;
  telegramCred: ServiceCredentialRow;
  spreadsheetId: string;
  spreadsheetTitle: string;
  email: string;
  telegramChatId: string;
  telegramGroupChatId: string;
}

export interface TenantOrgFixture {
  workspace: WorkspaceSummary;
  workspaceId: string;
  admin: TestPerson;
  member: TestPerson;
  conversation: ConversationRow;
  sheetsCred: ServiceCredentialRow;
  slackCred: ServiceCredentialRow;
  spreadsheetId: string;
  spreadsheetTitle: string;
  slackChannelId: string;
}

export interface TenantLegacyFixture {
  user: TestPerson;
  conversation: ConversationRow;
  sheetsCred: ServiceCredentialRow;
  slackCred: ServiceCredentialRow;
  spreadsheetId: string;
  slackChannelId: string;
}

export interface SheetsDigestTenantFixtures {
  encryptionKey: string;
  credentialRepo: CredentialRepo;
  workspaceRepo: WorkspaceRepo;
  convRepo: ConversationRepo;
  personalA: TenantPersonalFixture;
  personalB: TenantPersonalFixture;
  orgA: TenantOrgFixture;
  orgB: TenantOrgFixture;
  legacy: TenantLegacyFixture;
}

export async function seedSheetsDigestTenants(
  db: Awaited<ReturnType<typeof createMigratedSchema>>,
  encryptionKey: string = DIGEST_TEST_ENC_KEY
): Promise<SheetsDigestTenantFixtures> {
  const credentialRepo = new CredentialRepo(db.pool, encryptionKey);
  const workspaceRepo = new WorkspaceRepo(db.pool);
  const convRepo = new ConversationRepo(db.pool);

  const userA = await db.person('Personal User A');
  const userB = await db.person('Personal User B');
  const orgAdminA = await db.person('Org A Admin');
  const orgMemberA = await db.person('Org A Member');
  const orgAdminB = await db.person('Org B Admin');
  const orgMemberB = await db.person('Org B Member');
  const legacyUser = await db.person('Legacy User');

  // 1. Personal User A (mysheets, gmail, telegram)
  const mysheetsAConfig = encryptCredentials(
    {
      refreshToken: '1//personal-a-mysheets-refresh',
      email: 'alice@personal.test',
      scopes: ['https://www.googleapis.com/auth/drive.file'],
      selectedSpreadsheets: [
        {
          id: PERSONAL_A_SPREADSHEET_ID,
          title: 'Báo cáo KPI Cá nhân A',
          canEdit: true,
          sheets: ['KPI Tháng 11', 'Tasks'],
        },
      ],
      allowedScope: { spreadsheets: [PERSONAL_A_SPREADSHEET_ID] },
      connectedAt: '2026-11-01T00:00:00.000Z',
    },
    encryptionKey
  );
  const mysheetsCredA = await credentialRepo.saveCredentials('mysheets', mysheetsAConfig, userA.id, null);

  const gmailAConfig = encryptCredentials(
    {
      refreshToken: '1//personal-a-gmail-refresh',
      email: 'alice@personal.test',
      connectedAt: '2026-11-01T00:00:00.000Z',
    },
    encryptionKey
  );
  const gmailCredA = await credentialRepo.saveCredentials('gmail', gmailAConfig, userA.id, null);

  const telegramAConfig = encryptCredentials(
    {
      telegramUserId: '777000111',
      username: 'alice_tg',
      displayName: 'Personal User A',
      selectedChats: [
        { chatId: '777000111', title: 'Telegram Cá nhân A', type: 'private' },
        { chatId: '-100777888111', title: 'Nhóm KPI Cá nhân A', type: 'supergroup' },
      ],
      allowedScope: { chats: ['777000111', '-100777888111'] },
    },
    encryptionKey
  );
  const telegramCredA = await credentialRepo.upsertPersonalCredentials({
    service: 'telegram',
    userId: userA.id,
    config: telegramAConfig,
  });

  const convPersonalA = await convRepo.createConversation(userA.id, 'Hội thoại Cá nhân A', {
    workspaceMode: 'personal',
    workspaceId: null,
  });

  // 2. Personal User B (mysheets, gmail, telegram)
  const mysheetsBConfig = encryptCredentials(
    {
      refreshToken: '1//personal-b-mysheets-refresh',
      email: 'bob@personal.test',
      scopes: ['https://www.googleapis.com/auth/drive.file'],
      selectedSpreadsheets: [
        {
          id: PERSONAL_B_SPREADSHEET_ID,
          title: 'Báo cáo KPI Cá nhân B',
          canEdit: true,
          sheets: ['KPI B'],
        },
      ],
      allowedScope: { spreadsheets: [PERSONAL_B_SPREADSHEET_ID] },
      connectedAt: '2026-11-01T00:00:00.000Z',
    },
    encryptionKey
  );
  const mysheetsCredB = await credentialRepo.saveCredentials('mysheets', mysheetsBConfig, userB.id, null);

  const gmailBConfig = encryptCredentials(
    {
      refreshToken: '1//personal-b-gmail-refresh',
      email: 'bob@personal.test',
      connectedAt: '2026-11-01T00:00:00.000Z',
    },
    encryptionKey
  );
  const gmailCredB = await credentialRepo.saveCredentials('gmail', gmailBConfig, userB.id, null);

  const telegramBConfig = encryptCredentials(
    {
      telegramUserId: '777000222',
      username: 'bob_tg',
      displayName: 'Personal User B',
      selectedChats: [{ chatId: '777000222', title: 'Telegram Cá nhân B', type: 'private' }],
      allowedScope: { chats: ['777000222'] },
    },
    encryptionKey
  );
  const telegramCredB = await credentialRepo.upsertPersonalCredentials({
    service: 'telegram',
    userId: userB.id,
    config: telegramBConfig,
  });

  const convPersonalB = await convRepo.createConversation(userB.id, 'Hội thoại Cá nhân B', {
    workspaceMode: 'personal',
    workspaceId: null,
  });

  // 3. Organization A (workspace_id = wsA, shared sheets + slack)
  const wsA = await workspaceRepo.create(orgAdminA.id, 'Organization Alpha', false);
  await workspaceRepo.joinByInviteCode(orgMemberA.id, wsA.inviteCode!);
  await workspaceRepo.joinByInviteCode(userA.id, wsA.inviteCode!);

  const orgASheetsConfig = encryptCredentials(
    {
      clientEmail: 'sheets-sa@org-a.iam.gserviceaccount.com',
      privateKey: '-----BEGIN PRIVATE KEY-----\nFAKE_ORG_A_KEY\n-----END PRIVATE KEY-----\n',
      allowedScope: { spreadsheets: [ORG_A_SPREADSHEET_ID] },
    },
    encryptionKey
  );
  const orgASheetsCred = await credentialRepo.saveCredentials('sheets', orgASheetsConfig, null, wsA.id);

  const orgASlackConfig = encryptCredentials(
    {
      botToken: 'xoxb-org-a-slack-token',
      allowedScope: { channels: ['C_ORG_A_01'] },
    },
    encryptionKey
  );
  const orgASlackCred = await credentialRepo.saveCredentials('slack', orgASlackConfig, null, wsA.id);

  const convOrgA = await convRepo.createConversation(orgMemberA.id, 'Hội thoại Tổ chức A', {
    workspaceMode: 'organization',
    workspaceId: wsA.id,
  });

  // 4. Organization B (workspace_id = wsB, shared sheets + slack)
  const wsB = await workspaceRepo.create(orgAdminB.id, 'Organization Beta', false);
  await workspaceRepo.joinByInviteCode(orgMemberB.id, wsB.inviteCode!);

  const orgBSheetsConfig = encryptCredentials(
    {
      clientEmail: 'sheets-sa@org-b.iam.gserviceaccount.com',
      privateKey: '-----BEGIN PRIVATE KEY-----\nFAKE_ORG_B_KEY\n-----END PRIVATE KEY-----\n',
      allowedScope: { spreadsheets: [ORG_B_SPREADSHEET_ID] },
    },
    encryptionKey
  );
  const orgBSheetsCred = await credentialRepo.saveCredentials('sheets', orgBSheetsConfig, null, wsB.id);

  const orgBSlackConfig = encryptCredentials(
    {
      botToken: 'xoxb-org-b-slack-token',
      allowedScope: { channels: ['C_ORG_B_01'] },
    },
    encryptionKey
  );
  const orgBSlackCred = await credentialRepo.saveCredentials('slack', orgBSlackConfig, null, wsB.id);

  const convOrgB = await convRepo.createConversation(orgMemberB.id, 'Hội thoại Tổ chức B', {
    workspaceMode: 'organization',
    workspaceId: wsB.id,
  });

  // 5. Legacy (workspace_id = null, shared sheets + slack)
  const legacySheetsConfig = encryptCredentials(
    {
      clientEmail: 'sheets-sa@legacy.iam.gserviceaccount.com',
      privateKey: '-----BEGIN PRIVATE KEY-----\nFAKE_LEGACY_KEY\n-----END PRIVATE KEY-----\n',
      allowedScope: { spreadsheets: [LEGACY_SPREADSHEET_ID] },
    },
    encryptionKey
  );
  const legacySheetsCred = await credentialRepo.saveCredentials('sheets', legacySheetsConfig, null, null);

  const legacySlackConfig = encryptCredentials(
    {
      botToken: 'xoxb-legacy-slack-token',
      allowedScope: { channels: ['C_LEGACY_01'] },
    },
    encryptionKey
  );
  const legacySlackCred = await credentialRepo.saveCredentials('slack', legacySlackConfig, null, null);

  const convLegacy = await convRepo.createConversation(legacyUser.id);

  return {
    encryptionKey,
    credentialRepo,
    workspaceRepo,
    convRepo,
    personalA: {
      user: userA,
      conversation: convPersonalA,
      mysheetsCred: mysheetsCredA,
      gmailCred: gmailCredA,
      telegramCred: telegramCredA,
      spreadsheetId: PERSONAL_A_SPREADSHEET_ID,
      spreadsheetTitle: 'Báo cáo KPI Cá nhân A',
      email: 'alice@personal.test',
      telegramChatId: '777000111',
      telegramGroupChatId: '-100777888111',
    },
    personalB: {
      user: userB,
      conversation: convPersonalB,
      mysheetsCred: mysheetsCredB,
      gmailCred: gmailCredB,
      telegramCred: telegramCredB,
      spreadsheetId: PERSONAL_B_SPREADSHEET_ID,
      spreadsheetTitle: 'Báo cáo KPI Cá nhân B',
      email: 'bob@personal.test',
      telegramChatId: '777000222',
      telegramGroupChatId: '777000222',
    },
    orgA: {
      workspace: wsA,
      workspaceId: wsA.id,
      admin: orgAdminA,
      member: orgMemberA,
      conversation: convOrgA,
      sheetsCred: orgASheetsCred,
      slackCred: orgASlackCred,
      spreadsheetId: ORG_A_SPREADSHEET_ID,
      spreadsheetTitle: 'Bảng KPI Tổ chức A',
      slackChannelId: 'C_ORG_A_01',
    },
    orgB: {
      workspace: wsB,
      workspaceId: wsB.id,
      admin: orgAdminB,
      member: orgMemberB,
      conversation: convOrgB,
      sheetsCred: orgBSheetsCred,
      slackCred: orgBSlackCred,
      spreadsheetId: ORG_B_SPREADSHEET_ID,
      spreadsheetTitle: 'Bảng KPI Tổ chức B',
      slackChannelId: 'C_ORG_B_01',
    },
    legacy: {
      user: legacyUser,
      conversation: convLegacy,
      sheetsCred: legacySheetsCred,
      slackCred: legacySlackCred,
      spreadsheetId: LEGACY_SPREADSHEET_ID,
      slackChannelId: 'C_LEGACY_01',
    },
  };
}

export interface DigestProviderSpyRecord {
  service: 'mysheets' | 'sheets' | 'slack' | 'telegram' | 'gmail';
  toolName: string;
  userId: string;
  credentialId: string | null;
  workspaceMode: 'personal' | 'organization' | 'legacy';
  workspaceId: string | null;
  spreadsheetId: string | null;
  targetId: string | null;
  callCount: number;
  args: Record<string, unknown>;
}

export interface DigestProviderSpyOptions {
  defaultReadResult?: {
    range: string;
    headers: string[];
    records: Array<Record<string, string>>;
    values: string[][];
    totalDataRows: number;
  };
  onExecute?: (record: DigestProviderSpyRecord, context?: { signal?: AbortSignal }) => Promise<unknown> | unknown;
}

export function createDigestProviderSpy(options: DigestProviderSpyOptions = {}) {
  const calls: DigestProviderSpyRecord[] = [];
  const countsByKey = new Map<string, number>();

  const defaultRead = options.defaultReadResult ?? {
    range: "'KPI Tháng 11'!A1:D4",
    headers: ['Hạng mục', 'Chủ sở hữu', 'Trạng thái', 'Doanh thu'],
    records: [
      { 'Hạng mục': 'KPI 1', 'Chủ sở hữu': 'Alice', 'Trạng thái': 'Hoàn thành', 'Doanh thu': '10,000,000 đ' },
      { 'Hạng mục': 'KPI 2', 'Chủ sở hữu': 'Bob', 'Trạng thái': 'Đang làm', 'Doanh thu': '20,000,000 đ' },
    ],
    values: [
      ['Hạng mục', 'Chủ sở hữu', 'Trạng thái', 'Doanh thu'],
      ['KPI 1', 'Alice', 'Hoàn thành', '10,000,000 đ'],
      ['KPI 2', 'Bob', 'Đang làm', '20,000,000 đ'],
    ],
    totalDataRows: 2,
  };

  const resolveCredentialId = (
    serviceId: 'mysheets' | 'sheets' | 'slack' | 'telegram' | 'gmail',
    config: any
  ): string | null => {
    if (serviceId === 'mysheets' || serviceId === 'sheets') {
      return typeof config?.source?.credentialId === 'string' ? config.source.credentialId : null;
    }
    return typeof config?.destination?.credentialId === 'string' ? config.destination.credentialId : null;
  };

  const resolveTargetId = (
    serviceId: 'mysheets' | 'sheets' | 'slack' | 'telegram' | 'gmail',
    config: any,
    args: Record<string, unknown>
  ): string | null => {
    if (serviceId === 'slack') {
      return String(args.channel ?? config?.destination?.channelId ?? '');
    }
    if (serviceId === 'telegram') {
      return String(args.chatId ?? config?.destination?.chatId ?? '');
    }
    if (serviceId === 'gmail') {
      const to = Array.isArray(args.to) ? args.to[0] : args.to;
      return String(to ?? config?.destination?.recipientEmail ?? '');
    }
    return null;
  };

  const createAdapter = async (
    serviceId: 'mysheets' | 'sheets' | 'slack' | 'telegram' | 'gmail',
    userId: string,
    config: any,
    scheduleContext?: { workspaceMode?: 'personal' | 'organization' | 'legacy'; workspaceId?: string | null }
  ) => {
    const workspaceMode: 'personal' | 'organization' | 'legacy' =
      scheduleContext?.workspaceMode ??
      (config?.workspaceMode === 'personal' ||
      config?.workspaceMode === 'organization' ||
      config?.workspaceMode === 'legacy'
        ? config.workspaceMode
        : 'legacy');
    const workspaceId: string | null =
      scheduleContext?.workspaceId !== undefined
        ? scheduleContext.workspaceId
        : typeof config?.workspaceId === 'string'
          ? config.workspaceId
          : null;
    const credentialId = resolveCredentialId(serviceId, config);

    return {
      execute: async (
        toolName: string,
        args: Record<string, unknown>,
        context?: { signal?: AbortSignal }
      ): Promise<any> => {
        const spreadsheetId =
          serviceId === 'mysheets' || serviceId === 'sheets'
            ? String(args.spreadsheetId ?? config?.source?.spreadsheetId ?? '')
            : null;
        const targetId = resolveTargetId(serviceId, config, args);
        const key = `${serviceId}:${credentialId ?? 'unpinned'}:${workspaceMode}:${workspaceId ?? 'null'}:${spreadsheetId ?? targetId ?? ''}`;
        const nextCount = (countsByKey.get(key) ?? 0) + 1;
        countsByKey.set(key, nextCount);

        const record: DigestProviderSpyRecord = {
          service: serviceId,
          toolName,
          userId,
          credentialId,
          workspaceMode,
          workspaceId,
          spreadsheetId,
          targetId,
          callCount: nextCount,
          args,
        };
        calls.push(record);

        if (options.onExecute) {
          const custom = await options.onExecute(record, context);
          if (custom !== undefined) return custom;
        }

        if (serviceId === 'mysheets' || serviceId === 'sheets') {
          return defaultRead;
        }
        if (serviceId === 'slack') {
          return { ok: true, channel: targetId, ts: '1731000000.000100' };
        }
        if (serviceId === 'gmail') {
          return { id: 'gmail-msg-spy-1', threadId: 'gmail-th-spy-1' };
        }
        return { ok: true, message_id: 1001 };
      },
    };
  };

  return {
    calls,
    createAdapter,
    getCalls: () => [...calls],
    getCallCount: (filter?: Partial<Pick<DigestProviderSpyRecord, 'service' | 'credentialId' | 'workspaceMode' | 'workspaceId' | 'spreadsheetId' | 'targetId'>>) => {
      if (!filter) return calls.length;
      return calls.filter((c) => {
        if (filter.service !== undefined && c.service !== filter.service) return false;
        if (filter.credentialId !== undefined && c.credentialId !== filter.credentialId) return false;
        if (filter.workspaceMode !== undefined && c.workspaceMode !== filter.workspaceMode) return false;
        if (filter.workspaceId !== undefined && c.workspaceId !== filter.workspaceId) return false;
        if (filter.spreadsheetId !== undefined && c.spreadsheetId !== filter.spreadsheetId) return false;
        if (filter.targetId !== undefined && c.targetId !== filter.targetId) return false;
        return true;
      }).length;
    },
    reset: () => {
      calls.length = 0;
      countsByKey.clear();
    },
  };
}

export type SheetsDigestCompatClass =
  | 'v1_pinned_consistency_candidate'
  | 'v1_unpinned_fail_closed'
  | 'v2_ready';

export type SheetsDigestEvidenceBoundary =
  | 'consistency_only_not_config_immutability_proof'
  | 'unpinned_or_inconsistent'
  | 'v2_pinned';

export interface V1ScheduleInventoryItem {
  scheduleId: string;
  userId: string;
  convId: string;
  workspaceMode: 'personal' | 'organization' | 'legacy';
  workspaceId: string | null;
  status: ScheduleStatus;
  configVersion: number;
  sourceService: string | null;
  destService: string | null;
  hasSourceCredId: boolean;
  hasDestCredId: boolean;
  compatClass: SheetsDigestCompatClass;
  evidenceBoundary: SheetsDigestEvidenceBoundary;
  reasons: string[];
}

export interface V1ScheduleInventorySummaryGroup {
  workspaceMode: 'personal' | 'organization' | 'legacy';
  status: ScheduleStatus;
  configVersion: number;
  hasSourceCredId: boolean;
  hasDestCredId: boolean;
  compatClass: SheetsDigestCompatClass;
  evidenceBoundary: SheetsDigestEvidenceBoundary;
  count: number;
}

export interface V1ScheduleInventoryReport {
  summary: {
    totalSchedules: number;
    countsByClass: Record<SheetsDigestCompatClass, number>;
    evidenceBoundaryNote: string;
    groups: V1ScheduleInventorySummaryGroup[];
  };
  items: V1ScheduleInventoryItem[];
}

interface RawInventoryScheduleRow {
  id: string;
  user_id: string;
  conv_id: string;
  workspace_mode: 'personal' | 'organization' | 'legacy' | null;
  workspace_id: string | null;
  status: ScheduleStatus;
  recurrence: ScheduleRecurrence;
  digest_config: any;
  digest_config_hash: string | null;
  digest_approved_at: Date | string | null;
  user_status: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isNonEmptyUuid(val: unknown): val is string {
  return typeof val === 'string' && UUID_RE.test(val.trim());
}

function normalizeEmail(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

function toTimestampMs(val: Date | string | null | undefined): number | null {
  if (!val) return null;
  const ms = val instanceof Date ? val.getTime() : Date.parse(String(val));
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Evaluates Spec v2.4 §2.6.2 `isV1ConsistencyCandidate` criteria for a `version: 1` sheets_digest schedule.
 *
 * IMPORTANT EVIDENCE BOUNDARY (Pre-Task-3 Condition #1):
 * `service_credentials` has no `updated_at` column and no config-mutation audit log prior to `0033`.
 * `GmailConnectionRepo.updateConfigIfActive` and `CredentialRepo.updateCredentials` execute
 * `UPDATE service_credentials SET config = $1 WHERE id = $2` in place without changing `id`,
 * `created_at`, or `status_changed_at`. Therefore, satisfying all 6 criteria establishes
 * Class A (`v1_pinned_consistency_candidate`, `evidenceBoundary: 'consistency_only_not_config_immutability_proof'`)
 * and NEVER proves that `service_credentials.config` was never mutated in place.
 */
export function evaluateV1IdentityProven(input: {
  schedule: RawInventoryScheduleRow;
  credentialsById: ReadonlyMap<string, ServiceCredentialRow>;
  encryptionKey: string;
}): {
  proven: boolean;
  evidenceBoundary: 'consistency_only_not_config_immutability_proof' | 'unpinned_or_inconsistent';
  reasons: string[];
} {
  const { schedule, credentialsById, encryptionKey } = input;
  const reasons: string[] = [];
  const config = schedule.digest_config;
  const wsMode = schedule.workspace_mode ?? 'legacy';

  // Criterion 1: workspace_mode IN ('personal', 'legacy') AND workspace_id IS NULL
  if ((wsMode !== 'personal' && wsMode !== 'legacy') || schedule.workspace_id !== null) {
    reasons.push('ORG_V1_UNPINNED_WORKSPACE_SCOPE');
  }

  // Criterion 2: source.service === 'mysheets' with non-empty UUID source.credentialId AND non-empty source.email
  const source = config?.source;
  const sourceCredId = source?.credentialId;
  const sourceEmail = normalizeEmail(source?.email);

  if (source?.service !== 'mysheets') {
    reasons.push('SOURCE_SERVICE_NOT_MYSHEETS');
  }
  if (!isNonEmptyUuid(sourceCredId)) {
    reasons.push('MISSING_SOURCE_CREDENTIAL_ID');
  }
  if (!sourceEmail || !sourceEmail.includes('@')) {
    reasons.push('MISSING_SOURCE_EMAIL');
  }

  // Criterion 3: destination.service === 'gmail' with non-empty UUID destination.credentialId AND valid recipientEmail
  const dest = config?.destination;
  const destCredId = dest?.credentialId;
  const recipientEmail = normalizeEmail(dest?.recipientEmail);

  if (dest?.service !== 'gmail') {
    reasons.push('DEST_SERVICE_NOT_GMAIL');
  }
  if (!isNonEmptyUuid(destCredId)) {
    reasons.push('MISSING_DEST_CREDENTIAL_ID');
  }
  if (!recipientEmail || !recipientEmail.includes('@')) {
    reasons.push('INVALID_DEST_RECIPIENT_EMAIL');
  }

  const approvedAtMs = toTimestampMs(schedule.digest_approved_at);
  if (approvedAtMs === null) {
    reasons.push('MISSING_DIGEST_APPROVED_AT');
  }

  // Criterion 4: Live source credential row consistency verification
  if (source?.service === 'mysheets' && isNonEmptyUuid(sourceCredId)) {
    const srcRow = credentialsById.get(sourceCredId);
    if (
      !srcRow ||
      srcRow.service !== 'mysheets' ||
      srcRow.user_id !== schedule.user_id ||
      srcRow.workspace_id !== null ||
      srcRow.status !== 'active'
    ) {
      reasons.push('SOURCE_CREDENTIAL_INACTIVE_OR_MISSING');
    } else {
      const createdMs = toTimestampMs(srcRow.created_at);
      if (approvedAtMs !== null && (createdMs === null || createdMs > approvedAtMs)) {
        reasons.push('SOURCE_CREDENTIAL_CREATED_AFTER_APPROVAL');
      }
      const statusChangedMs = toTimestampMs(srcRow.status_changed_at);
      if (approvedAtMs !== null && statusChangedMs !== null && statusChangedMs > approvedAtMs) {
        reasons.push('SOURCE_CREDENTIAL_STATUS_CHANGED_AFTER_APPROVAL');
      }
      try {
        const decSource = decryptCredentials(srcRow.config, encryptionKey);
        const connectedAtMs = toTimestampMs(decSource?.connectedAt);
        if (approvedAtMs !== null && connectedAtMs !== null && connectedAtMs > approvedAtMs) {
          reasons.push('SOURCE_CREDENTIAL_CONNECTED_AFTER_APPROVAL');
        }
        const liveEmail = normalizeEmail(decSource?.email);
        if (!liveEmail || (sourceEmail && liveEmail !== sourceEmail)) {
          reasons.push('SOURCE_EMAIL_MISMATCH');
        }
        const allowedSpreadsheets: string[] = Array.isArray(decSource?.allowedScope?.spreadsheets)
          ? decSource.allowedScope.spreadsheets
          : Array.isArray(decSource?.selectedSpreadsheets)
            ? decSource.selectedSpreadsheets.map((s: any) => String(s?.id ?? ''))
            : [];
        if (
          typeof source?.spreadsheetId !== 'string' ||
          !allowedSpreadsheets.includes(source.spreadsheetId)
        ) {
          reasons.push('SOURCE_SPREADSHEET_OUT_OF_SCOPE');
        }
      } catch {
        reasons.push('SOURCE_CREDENTIAL_DECRYPT_FAILED');
      }
    }
  }

  // Criterion 5: Live destination credential row consistency verification
  if (dest?.service === 'gmail' && isNonEmptyUuid(destCredId)) {
    const destRow = credentialsById.get(destCredId);
    if (
      !destRow ||
      destRow.service !== 'gmail' ||
      destRow.user_id !== schedule.user_id ||
      destRow.workspace_id !== null ||
      destRow.status !== 'active'
    ) {
      reasons.push('DEST_CREDENTIAL_INACTIVE_OR_MISSING');
    } else {
      const createdMs = toTimestampMs(destRow.created_at);
      if (approvedAtMs !== null && (createdMs === null || createdMs > approvedAtMs)) {
        reasons.push('DEST_CREDENTIAL_CREATED_AFTER_APPROVAL');
      }
      const statusChangedMs = toTimestampMs(destRow.status_changed_at);
      if (approvedAtMs !== null && statusChangedMs !== null && statusChangedMs > approvedAtMs) {
        reasons.push('DEST_CREDENTIAL_STATUS_CHANGED_AFTER_APPROVAL');
      }
      try {
        const decDest = decryptCredentials(destRow.config, encryptionKey);
        const connectedAtMs = toTimestampMs(decDest?.connectedAt);
        if (approvedAtMs !== null && connectedAtMs !== null && connectedAtMs > approvedAtMs) {
          reasons.push('DEST_CREDENTIAL_CONNECTED_AFTER_APPROVAL');
        }
        const senderEmail = normalizeEmail(decDest?.email);
        if (!senderEmail || !senderEmail.includes('@')) {
          reasons.push('DEST_SENDER_EMAIL_MISSING');
        }
      } catch {
        reasons.push('DEST_CREDENTIAL_DECRYPT_FAILED');
      }
    }
  }

  // Criterion 6: Active user and matching v1 digest_config_hash
  if (schedule.user_status !== 'active') {
    reasons.push('USER_INACTIVE');
  }
  try {
    if (!config || typeof config !== 'object' || !schedule.digest_config_hash) {
      reasons.push('DIGEST_CONFIG_HASH_MISMATCH');
    } else {
      const expectedV1Hash = computeSheetsDigestHash({
        userId: schedule.user_id,
        recurrence: schedule.recurrence,
        config: config as SheetsDigestConfig,
      });
      if (expectedV1Hash !== schedule.digest_config_hash) {
        reasons.push('DIGEST_CONFIG_HASH_MISMATCH');
      }
    }
  } catch {
    reasons.push('DIGEST_CONFIG_HASH_MISMATCH');
  }

  const proven = reasons.length === 0;
  return {
    proven,
    evidenceBoundary: proven
      ? 'consistency_only_not_config_immutability_proof'
      : 'unpinned_or_inconsistent',
    reasons,
  };
}

/**
 * Read-only inventory helper (`inspectV1SheetsDigestSchedules`) that queries `schedules`
 * (`WHERE kind = 'sheets_digest'`) without mutating any rows, and classifies each schedule
 * into `'v1_pinned_consistency_candidate' | 'v1_unpinned_fail_closed' | 'v2_ready'` with
 * an explicit `evidenceBoundary`.
 */
export async function inspectV1SheetsDigestSchedules(
  pool: Pick<pg.Pool, 'query'>,
  encryptionKey: string = DIGEST_TEST_ENC_KEY
): Promise<V1ScheduleInventoryReport> {
  const schedRes = await pool.query<RawInventoryScheduleRow>(
    `SELECT
       s.id,
       s.user_id,
       s.conv_id,
       s.workspace_mode,
       s.workspace_id,
       s.status,
       s.recurrence,
       s.digest_config,
       s.digest_config_hash,
       s.digest_approved_at,
       u.status AS user_status
     FROM schedules s
     LEFT JOIN users u ON u.id = s.user_id
     WHERE s.kind = 'sheets_digest'
     ORDER BY s.created_at ASC, s.id ASC`
  );

  const credRes = await pool.query<ServiceCredentialRow>(
    `SELECT id, service, user_id, workspace_id, config, created_at, status, status_changed_at
     FROM service_credentials`
  );
  const credentialsById = new Map<string, ServiceCredentialRow>();
  for (const row of credRes.rows) {
    credentialsById.set(row.id, row);
  }

  const items: V1ScheduleInventoryItem[] = [];
  const countsByClass: Record<SheetsDigestCompatClass, number> = {
    v1_pinned_consistency_candidate: 0,
    v1_unpinned_fail_closed: 0,
    v2_ready: 0,
  };
  const groupMap = new Map<string, V1ScheduleInventorySummaryGroup>();

  for (const row of schedRes.rows) {
    const workspaceMode: 'personal' | 'organization' | 'legacy' = row.workspace_mode ?? 'legacy';
    const config = row.digest_config ?? {};
    const configVersion = typeof config.version === 'number' ? config.version : 1;
    const sourceService = typeof config?.source?.service === 'string' ? config.source.service : null;
    const destService =
      typeof config?.destination?.service === 'string' ? config.destination.service : null;
    const hasSourceCredId = isNonEmptyUuid(config?.source?.credentialId);
    const hasDestCredId = isNonEmptyUuid(config?.destination?.credentialId);

    let compatClass: SheetsDigestCompatClass;
    let evidenceBoundary: SheetsDigestEvidenceBoundary;
    let reasons: string[] = [];

    if (configVersion === 2) {
      compatClass = 'v2_ready';
      evidenceBoundary = 'v2_pinned';
    } else {
      const evaluation = evaluateV1IdentityProven({
        schedule: row,
        credentialsById,
        encryptionKey,
      });
      compatClass = evaluation.proven
        ? 'v1_pinned_consistency_candidate'
        : 'v1_unpinned_fail_closed';
      evidenceBoundary = evaluation.evidenceBoundary;
      reasons = evaluation.reasons;
    }

    countsByClass[compatClass]++;

    const item: V1ScheduleInventoryItem = {
      scheduleId: row.id,
      userId: row.user_id,
      convId: row.conv_id,
      workspaceMode,
      workspaceId: row.workspace_id ?? null,
      status: row.status,
      configVersion,
      sourceService,
      destService,
      hasSourceCredId,
      hasDestCredId,
      compatClass,
      evidenceBoundary,
      reasons,
    };
    items.push(item);

    const groupKey = [
      workspaceMode,
      row.status,
      String(configVersion),
      String(hasSourceCredId),
      String(hasDestCredId),
      compatClass,
      evidenceBoundary,
    ].join('|');

    const existingGroup = groupMap.get(groupKey);
    if (existingGroup) {
      existingGroup.count++;
    } else {
      groupMap.set(groupKey, {
        workspaceMode,
        status: row.status,
        configVersion,
        hasSourceCredId,
        hasDestCredId,
        compatClass,
        evidenceBoundary,
        count: 1,
      });
    }
  }

  return {
    summary: {
      totalSchedules: items.length,
      countsByClass,
      evidenceBoundaryNote:
        'service_credentials has no updated_at column or config-mutation audit log prior to 0033; Class A (v1_pinned_consistency_candidate) establishes consistency eligibility only and does NOT prove config immutability. Default SHEETS_DIGEST_V1_COMPAT_POLICY is strict_pause_all unless operator explicitly sets allow_consistency_candidate after reviewing this inventory.',
      groups: Array.from(groupMap.values()),
    },
    items,
  };
}

export async function insertTestSheetsDigestSchedule(
  pool: Pick<pg.Pool, 'query'>,
  input: {
    userId: string;
    convId: string;
    name?: string;
    request?: string;
    recurrence?: ScheduleRecurrence;
    services?: string[];
    status?: ScheduleStatus;
    workspaceMode: 'personal' | 'organization' | 'legacy';
    workspaceId: string | null;
    digestConfig: Record<string, unknown>;
    digestConfigHash?: string;
    digestApprovedAt?: Date;
    nextRunAt?: Date | null;
  }
): Promise<{ id: string; digest_config_hash: string; version: number; updated_at: Date }> {
  const recurrence: ScheduleRecurrence = input.recurrence ?? { type: 'daily', time: '08:00' };
  const status: ScheduleStatus = input.status ?? 'active';
  const approvedAt = input.digestApprovedAt ?? new Date('2026-11-02T00:00:00.000Z');
  const nextRunAt =
    status === 'active'
      ? input.nextRunAt ?? new Date('2026-11-03T01:00:00.000Z')
      : null;
  const hash =
    input.digestConfigHash ??
    computeSheetsDigestHash({
      userId: input.userId,
      recurrence,
      config: input.digestConfig as unknown as SheetsDigestConfig,
    });
  const srcService = String((input.digestConfig as any)?.source?.service ?? 'mysheets');
  const destService = String((input.digestConfig as any)?.destination?.service ?? 'gmail');
  const services = input.services ?? [srcService, destService];

  const res = await pool.query<{ id: string; digest_config_hash: string; version: number; updated_at: Date }>(
    `INSERT INTO schedules (
       user_id, conv_id, name, request, recurrence, services, status, next_run_at,
       workspace_id, workspace_mode, kind, digest_config, digest_config_hash, digest_approved_at
     )
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, 'sheets_digest', $11::jsonb, $12, $13)
     RETURNING id, digest_config_hash, version, updated_at`,
    [
      input.userId,
      input.convId,
      input.name ?? 'Báo cáo KPI định kỳ',
      input.request ?? 'Đọc bảng KPI và gửi báo cáo định kỳ',
      JSON.stringify(recurrence),
      services,
      status,
      nextRunAt,
      input.workspaceId,
      input.workspaceMode,
      JSON.stringify(input.digestConfig),
      hash,
      approvedAt,
    ]
  );
  return res.rows[0]!;
}
