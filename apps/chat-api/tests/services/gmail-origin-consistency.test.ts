import { describe, expect, it } from 'vitest';
import { encryptCredentials } from '@wap/tool-adapters';
import type { SheetsDigestConfigV2 } from '@wap/tool-schemas';
import type { CredentialRepo, ServiceCredentialRow } from '../../src/db/repositories/credential-repo.js';
import type { ScheduleRepo, ScheduleRow } from '../../src/db/repositories/schedule-repo.js';
import { getToolCatalogFor } from '../../src/services/registered-services.js';
import { runtimeToolCatalog } from '../../src/config/gmail-tools-runtime.js';
import { createGmailConnectionLookup } from '../../src/services/gmail/connection-reference.js';
import {
  analyzeSheetsDigestCandidate,
  computeSheetsDigestHash,
  verifySheetsDigestCandidateInTx,
} from '../../src/services/schedules/sheets-digest-candidate.js';
import { SheetsDigestRunner } from '../../src/services/schedules/sheets-digest-runner.js';

const ENC_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const LIVE_CLIENT_ID = '111111111111-live-gmail.apps.googleusercontent.com';
const OTHER_CLIENT_ID = '999999999999-other-gmail.apps.googleusercontent.com';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONV_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SCHED_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const MYSHEETS_CRED_ID = '11111111-1111-4111-8111-111111111111';
const GMAIL_CRED_ID = '22222222-2222-4222-8222-222222222222';
const SPREADSHEET_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upPA';
const SPREADSHEET_TITLE = 'Báo cáo KPI Cá nhân A';

function makeGmailConfig(oauthClientId?: string): string {
  return encryptCredentials(
    {
      refreshToken: '1//gmail-refresh-token',
      email: 'alice@personal.test',
      scopes: ['https://www.googleapis.com/auth/gmail.modify'],
      ...(oauthClientId !== undefined ? { oauthClientId } : {}),
      connectedAt: '2026-11-01T00:00:00.000Z',
    },
    ENC_KEY,
  );
}

function makeMySheetsConfig(): string {
  return encryptCredentials(
    {
      refreshToken: '1//mysheets-refresh-token',
      email: 'alice@personal.test',
      scopes: ['https://www.googleapis.com/auth/drive.file'],
      oauthClientId: LIVE_CLIENT_ID,
      selectedSpreadsheets: [
        {
          id: SPREADSHEET_ID,
          title: SPREADSHEET_TITLE,
          canEdit: true,
          sheets: ['KPI Tháng 11'],
        },
      ],
      allowedScope: { spreadsheets: [SPREADSHEET_ID] },
      connectedAt: '2026-11-01T00:00:00.000Z',
    },
    ENC_KEY,
  );
}

function makeMemoryRepo(gmailOAuthInRow?: string): {
  credentialRepo: CredentialRepo;
  rowsById: Map<string, ServiceCredentialRow>;
} {
  const createdAt = new Date('2026-11-01T00:00:00.000Z');
  const rows: ServiceCredentialRow[] = [
    {
      id: MYSHEETS_CRED_ID,
      service: 'mysheets',
      user_id: USER_ID,
      workspace_id: null,
      workspaceId: null,
      config: makeMySheetsConfig(),
      created_at: createdAt,
      status: 'active',
      status_changed_at: null,
    },
    {
      id: GMAIL_CRED_ID,
      service: 'gmail',
      user_id: USER_ID,
      workspace_id: null,
      workspaceId: null,
      config: makeGmailConfig(gmailOAuthInRow),
      created_at: createdAt,
      status: 'active',
      status_changed_at: null,
    },
  ];
  const rowsById = new Map(rows.map((r) => [r.id, r]));

  const credentialRepo = {
    async getPersonalCredentials(service: string, userId: string): Promise<ServiceCredentialRow | null> {
      return rows.find((r) => r.service === service && r.user_id === userId && r.status === 'active') ?? null;
    },
    async getCredentials(): Promise<ServiceCredentialRow | null> {
      return null;
    },
  } as unknown as CredentialRepo;

  return { credentialRepo, rowsById };
}

function makeFakeTxClient(rowsById: Map<string, ServiceCredentialRow>) {
  return {
    async query(sql: string, params: unknown[]) {
      if (sql.includes('FROM users')) {
        return { rows: [{ id: String(params[0]), status: 'active' }] };
      }
      if (sql.includes('FROM service_credentials')) {
        const ids = Array.isArray(params[0]) ? (params[0] as string[]) : [];
        return {
          rows: ids
            .map((id) => rowsById.get(id))
            .filter((r): r is ServiceCredentialRow => Boolean(r))
            .sort((a, b) => a.id.localeCompare(b.id)),
        };
      }
      return { rows: [] };
    },
  } as any;
}

function makeScheduleRow(config: SheetsDigestConfigV2, configHash: string): ScheduleRow {
  const createdAt = new Date('2026-11-02T00:00:00.000Z');
  return {
    id: SCHED_ID,
    user_id: USER_ID,
    conv_id: CONV_ID,
    name: 'Báo cáo KPI hàng ngày',
    request: `Đọc bảng ${SPREADSHEET_TITLE} và gửi báo cáo qua Gmail cho tôi`,
    recurrence: { type: 'daily', time: '08:00' },
    services: ['mysheets', 'gmail'],
    status: 'active',
    pause_reason: null,
    version: 1,
    next_run_at: new Date('2026-11-03T01:00:00.000Z'),
    last_proposal_id: null,
    workspace_mode: 'personal',
    workspace_id: null,
    kind: 'sheets_digest',
    digest_config: config,
    digest_config_hash: configHash,
    digest_approved_at: createdAt,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

describe('GMAIL-AUDIT-08: Consistent OAuth clientId origin enforcement across catalog, lookup, and digests', () => {
  it('enforces gmailOAuthClientId in getToolCatalogFor and runtimeToolCatalog while keeping omitted-origin backward compat', async () => {
    const matched = makeMemoryRepo(LIVE_CLIENT_ID);
    const mismatched = makeMemoryRepo(OTHER_CLIENT_ID);
    const missingOrigin = makeMemoryRepo(undefined);

    const liveMatched = await getToolCatalogFor(matched.credentialRepo, ENC_KEY, {
      userId: USER_ID,
      workspaceMode: 'personal',
      workspaceId: null,
      gmailEnabled: true,
      gmailOAuthClientId: LIVE_CLIENT_ID,
    });
    expect(liveMatched.some((t) => t.service === 'gmail')).toBe(true);

    const liveMismatched = await getToolCatalogFor(mismatched.credentialRepo, ENC_KEY, {
      userId: USER_ID,
      workspaceMode: 'personal',
      workspaceId: null,
      gmailEnabled: true,
      gmailOAuthClientId: LIVE_CLIENT_ID,
    });
    expect(liveMismatched.some((t) => t.service === 'gmail')).toBe(false);

    const liveMissingOrigin = await getToolCatalogFor(missingOrigin.credentialRepo, ENC_KEY, {
      userId: USER_ID,
      workspaceMode: 'personal',
      workspaceId: null,
      gmailEnabled: true,
      gmailOAuthClientId: LIVE_CLIENT_ID,
    });
    expect(liveMissingOrigin.some((t) => t.service === 'gmail')).toBe(false);

    // Backward compat when gmailOAuthClientId is omitted
    const liveCompat = await getToolCatalogFor(missingOrigin.credentialRepo, ENC_KEY, {
      userId: USER_ID,
      workspaceMode: 'personal',
      workspaceId: null,
      gmailEnabled: true,
    });
    expect(liveCompat.some((t) => t.service === 'gmail')).toBe(true);

    // runtimeToolCatalog ('live') forwards gmailOAuthClientId cleanly
    const rtMatched = await runtimeToolCatalog('live', matched.credentialRepo, ENC_KEY, {
      userId: USER_ID,
      workspaceMode: 'personal',
      workspaceId: null,
      gmailEnabled: true,
      gmailOAuthClientId: LIVE_CLIENT_ID,
    });
    expect(rtMatched.some((t) => t.service === 'gmail')).toBe(true);

    const rtMismatched = await runtimeToolCatalog('live', mismatched.credentialRepo, ENC_KEY, {
      userId: USER_ID,
      workspaceMode: 'personal',
      workspaceId: null,
      gmailEnabled: true,
      gmailOAuthClientId: LIVE_CLIENT_ID,
    });
    expect(rtMismatched.some((t) => t.service === 'gmail')).toBe(false);
  });

  it('enforces oauthClientId in createGmailConnectionLookup and preserves legacy lookup when omitted', async () => {
    const matched = makeMemoryRepo(LIVE_CLIENT_ID);
    const mismatched = makeMemoryRepo(OTHER_CLIENT_ID);
    const missingOrigin = makeMemoryRepo(undefined);

    expect(await createGmailConnectionLookup(matched.credentialRepo, ENC_KEY, LIVE_CLIENT_ID)(USER_ID)).toEqual({
      credentialId: GMAIL_CRED_ID,
      email: 'alice@personal.test',
    });
    expect(await createGmailConnectionLookup(mismatched.credentialRepo, ENC_KEY, LIVE_CLIENT_ID)(USER_ID)).toBeNull();
    expect(await createGmailConnectionLookup(missingOrigin.credentialRepo, ENC_KEY, LIVE_CLIENT_ID)(USER_ID)).toBeNull();

    // Omitting oauthClientId maintains legacy test/sandbox compatibility
    expect(await createGmailConnectionLookup(missingOrigin.credentialRepo, ENC_KEY)(USER_ID)).toEqual({
      credentialId: GMAIL_CRED_ID,
      email: 'alice@personal.test',
    });
  });

  it('enforces gmailOAuthClientId in analyzeSheetsDigestCandidate, verifySheetsDigestCandidateInTx, and SheetsDigestRunner', async () => {
    const matched = makeMemoryRepo(LIVE_CLIENT_ID);
    const mismatched = makeMemoryRepo(OTHER_CLIENT_ID);
    const missingOrigin = makeMemoryRepo(undefined);

    const baseInput = {
      userId: USER_ID,
      workspaceMode: 'personal' as const,
      workspaceId: null,
      request: `Đọc bảng ${SPREADSHEET_TITLE} và gửi báo cáo qua Gmail cho tôi`,
      recurrence: { type: 'daily' as const, time: '08:00' },
      services: ['mysheets', 'gmail'],
      encryptionKey: ENC_KEY,
      mysheetsEnabled: true,
      emitV2: true,
    };

    // 1. analyzeSheetsDigestCandidate
    const candidateOk = await analyzeSheetsDigestCandidate({
      ...baseInput,
      credentialRepo: matched.credentialRepo,
      gmailOAuthClientId: LIVE_CLIENT_ID,
    });
    expect(candidateOk.canAutoDigest).toBe(true);
    expect(candidateOk.config).toBeDefined();
    expect(candidateOk.configHash).toBeDefined();

    const candidateMismatch = await analyzeSheetsDigestCandidate({
      ...baseInput,
      credentialRepo: mismatched.credentialRepo,
      gmailOAuthClientId: LIVE_CLIENT_ID,
    });
    expect(candidateMismatch.canAutoDigest).toBe(false);
    expect(candidateMismatch.reason).toMatch(/OAuth|kết nối lại/i);

    const candidateMissing = await analyzeSheetsDigestCandidate({
      ...baseInput,
      credentialRepo: missingOrigin.credentialRepo,
      gmailOAuthClientId: LIVE_CLIENT_ID,
    });
    expect(candidateMissing.canAutoDigest).toBe(false);

    const candidateCompat = await analyzeSheetsDigestCandidate({
      ...baseInput,
      credentialRepo: missingOrigin.credentialRepo,
    });
    expect(candidateCompat.canAutoDigest).toBe(true);

    // 2. verifySheetsDigestCandidateInTx
    const config = candidateOk.config as SheetsDigestConfigV2;
    const configHash = computeSheetsDigestHash({
      userId: USER_ID,
      recurrence: baseInput.recurrence,
      config,
    });

    const txOk = await verifySheetsDigestCandidateInTx(makeFakeTxClient(matched.rowsById), {
      userId: USER_ID,
      recurrence: baseInput.recurrence,
      config,
      expectedHash: configHash,
      trustedScope: { workspaceMode: 'personal', workspaceId: null },
      encryptionKey: ENC_KEY,
      gmailOAuthClientId: LIVE_CLIENT_ID,
      mysheetsEnabled: true,
    });
    expect(txOk.ok).toBe(true);

    const txMismatch = await verifySheetsDigestCandidateInTx(makeFakeTxClient(mismatched.rowsById), {
      userId: USER_ID,
      recurrence: baseInput.recurrence,
      config,
      expectedHash: configHash,
      trustedScope: { workspaceMode: 'personal', workspaceId: null },
      encryptionKey: ENC_KEY,
      gmailOAuthClientId: LIVE_CLIENT_ID,
      mysheetsEnabled: true,
    });
    expect(txMismatch.ok).toBe(false);
    if (!txMismatch.ok) {
      expect(txMismatch.reason).toMatch(/OAuth|kết nối lại/i);
    }

    const txCompat = await verifySheetsDigestCandidateInTx(makeFakeTxClient(missingOrigin.rowsById), {
      userId: USER_ID,
      recurrence: baseInput.recurrence,
      config,
      expectedHash: configHash,
      trustedScope: { workspaceMode: 'personal', workspaceId: null },
      encryptionKey: ENC_KEY,
      mysheetsEnabled: true,
    });
    expect(txCompat.ok).toBe(true);

    // 3. SheetsDigestRunner.verifyConfigAndScope
    const schedule = makeScheduleRow(config, configHash);
    const noopCreateAdapter = async () => ({ execute: async () => ({}) }) as any;
    const runnerOk = new SheetsDigestRunner({
      repo: {} as ScheduleRepo,
      credentialRepo: matched.credentialRepo,
      encryptionKey: ENC_KEY,
      gmailOAuthClientId: LIVE_CLIENT_ID,
      mysheetsEnabled: true,
      createAdapter: noopCreateAdapter,
    });
    expect((await runnerOk.verifyConfigAndScope(schedule)).ok).toBe(true);

    const runnerMismatch = new SheetsDigestRunner({
      repo: {} as ScheduleRepo,
      credentialRepo: mismatched.credentialRepo,
      encryptionKey: ENC_KEY,
      gmailOAuthClientId: LIVE_CLIENT_ID,
      mysheetsEnabled: true,
      createAdapter: noopCreateAdapter,
    });
    const runMismatchRes = await runnerMismatch.verifyConfigAndScope(schedule);
    expect(runMismatchRes.ok).toBe(false);
    if (!runMismatchRes.ok) {
      expect(runMismatchRes.reason).toMatch(/OAuth|kết nối lại/i);
    }

    const runnerMissing = new SheetsDigestRunner({
      repo: {} as ScheduleRepo,
      credentialRepo: missingOrigin.credentialRepo,
      encryptionKey: ENC_KEY,
      gmailOAuthClientId: LIVE_CLIENT_ID,
      mysheetsEnabled: true,
      createAdapter: noopCreateAdapter,
    });
    expect((await runnerMissing.verifyConfigAndScope(schedule)).ok).toBe(false);

    const runnerCompat = new SheetsDigestRunner({
      repo: {} as ScheduleRepo,
      credentialRepo: missingOrigin.credentialRepo,
      encryptionKey: ENC_KEY,
      mysheetsEnabled: true,
      createAdapter: noopCreateAdapter,
    });
    expect((await runnerCompat.verifyConfigAndScope(schedule)).ok).toBe(true);
  });
});
