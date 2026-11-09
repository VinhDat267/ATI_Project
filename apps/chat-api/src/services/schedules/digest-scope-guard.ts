import type pg from 'pg';
import { decryptCredentials } from '@wap/tool-adapters';
import { normalizeTelegramChatId, TELEGRAM_CHAT_ID_PATTERN } from '@wap/tool-schemas';
import { isUuid } from '../../db/repositories/uuid.js';

type Queryable = pg.Pool | Pick<pg.Pool, 'query'>;

export type DigestScopeGuardCode =
  | 'DIGEST_SCHEDULE_NOT_FOUND'
  | 'DIGEST_USER_INACTIVE'
  | 'DIGEST_WORKSPACE_MEMBER_REVOKED'
  | 'DIGEST_CROSS_TENANT_SCOPE_MISMATCH'
  | 'DIGEST_CREDENTIAL_INVALID'
  | 'DIGEST_CREDENTIAL_SERVICE_MISMATCH'
  | 'DIGEST_CREDENTIAL_INACTIVE'
  | 'DIGEST_SCOPE_NOT_CONFIGURED'
  | 'DIGEST_SCOPE_REVOKED';

export interface DigestScopeGuardInput {
  pool: Queryable;
  scheduleId: string;
  claimedWorkspaceId?: string | null;
}

export interface DigestScopeGuardResult {
  allowed: boolean;
  code?: DigestScopeGuardCode;
  pauseReason?: string;
  trustedWorkspaceId: string | null;
  trustedWorkspaceMode: string;
}

export type PinnedTelegramContextCode =
  | DigestScopeGuardCode
  | 'DIGEST_TELEGRAM_CONTEXT_INVALID'
  | 'DIGEST_TELEGRAM_IDENTITY_MISMATCH'
  | 'DIGEST_TELEGRAM_CHAT_NOT_ALLOWED';

export interface PinnedTelegramAdapterContextResult {
  allowed: boolean;
  code?: PinnedTelegramContextCode;
  credentialId?: string;
  chatId?: string;
  telegramUserId?: string;
  username?: string;
  trustedWorkspaceId?: string | null;
  trustedWorkspaceMode?: string;
}

interface ScheduleGuardRow {
  id: string;
  user_id: string;
  workspace_id: string | null;
  workspace_mode: string | null;
  kind: string | null;
  digest_config: Record<string, unknown> | null;
  user_status: string | null;
}

interface CredentialRow {
  id: string;
  service: string;
  user_id: string | null;
  workspace_id: string | null;
  status: string;
  config: unknown;
}

/**
 * Digest kinds whose primary pinned `credentialId` is a personal row in `service_credentials`
 * (the same store every runner reads through `CredentialRepo.getPersonalCredentials`).
 * notion_digest (Notion connection store + identityVersion), myjira_digest (Jira OAuth grants) and
 * sheets_digest (Gate A owned; optional source credential) keep their runner-native identity checks.
 */
const PERSONAL_CREDENTIAL_SERVICE_BY_KIND: Record<string, string> = {
  github_digest: 'github',
  telegram_digest: 'telegram',
  calendar_digest: 'mycalendar',
  trello_digest: 'trello',
};

const SERVICE_LABEL: Record<string, string> = {
  github: 'GitHub',
  telegram: 'Telegram',
  mycalendar: 'Google Calendar',
  trello: 'Trello',
};

function deny(
  code: DigestScopeGuardCode,
  pauseReason: string,
  trustedWorkspaceId: string | null,
  trustedWorkspaceMode: string,
): DigestScopeGuardResult {
  return { allowed: false, code, pauseReason, trustedWorkspaceId, trustedWorkspaceMode };
}

/**
 * Fail-closed validation of a pinned personal credential against live `service_credentials`:
 * the id must be a UUID that exists, belong to the expected service, be owned by the schedule
 * owner as a personal row (workspace_id IS NULL, matching getPersonalCredentials), and be active.
 */
async function validatePinnedPersonalCredential(
  pool: Queryable,
  pinned: unknown,
  service: string,
  ownerId: string,
): Promise<{ ok: true; row: CredentialRow } | { ok: false; code: DigestScopeGuardCode; reason: string }> {
  const label = SERVICE_LABEL[service] ?? service;
  const id = typeof pinned === 'string' ? pinned.trim() : '';
  if (!id || !isUuid(id)) {
    return { ok: false, code: 'DIGEST_CREDENTIAL_INVALID', reason: `Kết nối ${label} được ghim trong lịch không hợp lệ. Hãy xác nhận lại lịch.` };
  }
  const row = (
    await pool.query<CredentialRow>(
      'SELECT id, service, user_id, workspace_id, status, config FROM service_credentials WHERE id = $1',
      [id],
    )
  ).rows[0];
  if (!row) {
    return { ok: false, code: 'DIGEST_CREDENTIAL_INVALID', reason: `Kết nối ${label} của chủ lịch đã thay đổi hoặc bị ngắt. Hãy kết nối lại.` };
  }
  if (row.service !== service) {
    return { ok: false, code: 'DIGEST_CREDENTIAL_SERVICE_MISMATCH', reason: `Kết nối ${label} được ghim trong lịch không đúng dịch vụ.` };
  }
  if (row.user_id !== ownerId || row.workspace_id !== null) {
    return { ok: false, code: 'DIGEST_CROSS_TENANT_SCOPE_MISMATCH', reason: `Kết nối ${label} thuộc về người dùng hoặc không gian làm việc khác.` };
  }
  if (row.status !== 'active') {
    return { ok: false, code: 'DIGEST_CREDENTIAL_INACTIVE', reason: `Kết nối ${label} của chủ lịch không còn hợp lệ hoặc cần kết nối lại.` };
  }
  return { ok: true, row };
}

async function loadScheduleRow(pool: Queryable, scheduleId: string): Promise<ScheduleGuardRow | undefined> {
  if (!isUuid(scheduleId)) return undefined;
  return (
    await pool.query<ScheduleGuardRow>(
      `SELECT s.id, s.user_id, s.workspace_id, s.workspace_mode, s.kind, s.digest_config, u.status AS user_status
         FROM schedules s
         JOIN users u ON u.id = s.user_id
        WHERE s.id = $1`,
      [scheduleId],
    )
  ).rows[0];
}

/**
 * Re-validates a digest schedule against live PostgreSQL state before any digest read or delivery:
 * 1. Reads authoritative workspace_id / workspace_mode from `schedules` (caller input is never trusted).
 * 2. Owner must be active (users.status = 'active').
 * 3. Organization schedules require active membership (workspace_members.status = 'active').
 * 4. Rejects cross-tenant workspace references in digest_config.
 * 5. Pinned personal credentials must be valid UUIDs that exist, match service, owner and personal
 *    scope, and are active (missing / malformed / stale pins fail closed).
 * 6. Organization GitHub digests must be authorized by the workspace's own scope rows
 *    (github_team_repos.scope_id = workspace id). The legacy global 'default' scope is never accepted
 *    as organization authority; it is quarantined by PR-R1-A1 (0034). Until A1 lands no
 *    workspace-scoped rows can exist, so organization GitHub digests fail closed.
 */
export async function assertDigestScheduleLiveScopeAndAuth(
  input: DigestScopeGuardInput,
): Promise<DigestScopeGuardResult> {
  const { pool, scheduleId } = input;
  const row = await loadScheduleRow(pool, scheduleId);
  if (!row) {
    return deny('DIGEST_SCHEDULE_NOT_FOUND', 'Không tìm thấy lịch chạy bản tin.', null, 'personal');
  }

  const trustedWorkspaceId = row.workspace_id ?? null;
  const trustedWorkspaceMode = row.workspace_mode ?? 'personal';
  const cfg = (row.digest_config ?? {}) as Record<string, unknown>;

  if (row.user_status !== 'active') {
    return deny('DIGEST_USER_INACTIVE', 'Tài khoản không còn hoạt động.', trustedWorkspaceId, trustedWorkspaceMode);
  }

  if (trustedWorkspaceMode === 'organization' || trustedWorkspaceId !== null) {
    const member = trustedWorkspaceId
      ? (
          await pool.query<{ status: string }>(
            'SELECT status FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
            [trustedWorkspaceId, row.user_id],
          )
        ).rows[0]
      : undefined;
    if (!member || member.status !== 'active') {
      return deny(
        'DIGEST_WORKSPACE_MEMBER_REVOKED',
        'Thành viên không còn quyền trong không gian làm việc này.',
        trustedWorkspaceId,
        trustedWorkspaceMode,
      );
    }
  }

  // notion_digest.workspaceId is the external Notion OAuth workspace id, not a Planora workspace id.
  const targetWsCandidates = [
    cfg.targetWorkspaceId,
    ...(row.kind !== 'notion_digest' ? [cfg.workspaceId] : []),
    cfg.scopeId,
  ].filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  if (targetWsCandidates.some((ws) => ws !== trustedWorkspaceId)) {
    return deny(
      'DIGEST_CROSS_TENANT_SCOPE_MISMATCH',
      'Cấu hình bản tin tham chiếu không gian làm việc khác.',
      trustedWorkspaceId,
      trustedWorkspaceMode,
    );
  }

  const primaryService = row.kind ? PERSONAL_CREDENTIAL_SERVICE_BY_KIND[row.kind] : undefined;
  if (primaryService) {
    const checked = await validatePinnedPersonalCredential(pool, cfg.credentialId, primaryService, row.user_id);
    if (!checked.ok) return deny(checked.code, checked.reason, trustedWorkspaceId, trustedWorkspaceMode);
  }
  // github_digest pins its Telegram destination credential (GithubDigestConfig.telegramCredentialId).
  // A Telegram destination without that pin must not fall back to whatever connection is live.
  const telegramPinRequired = row.kind === 'github_digest' && typeof cfg.telegramChatId === 'string' && cfg.telegramChatId.trim() !== '';
  if (telegramPinRequired || (cfg.telegramCredentialId !== undefined && cfg.telegramCredentialId !== null)) {
    const checked = await validatePinnedPersonalCredential(pool, cfg.telegramCredentialId, 'telegram', row.user_id);
    if (!checked.ok) return deny(checked.code, checked.reason, trustedWorkspaceId, trustedWorkspaceMode);
  }

  if (row.kind === 'github_digest' && trustedWorkspaceMode === 'organization' && trustedWorkspaceId) {
    const pinnedRepos = (Array.isArray(cfg.repos) ? cfg.repos : typeof cfg.repo === 'string' ? [cfg.repo] : [])
      .filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
      .map((r) => r.trim().toLowerCase());
    // Only the workspace's own scope authorizes repositories; no legacy 'default' fallback.
    const scopeRows = (
      await pool.query<{ full_name: string }>(
        'SELECT lower(full_name) AS full_name FROM github_team_repos WHERE scope_id = $1',
        [trustedWorkspaceId],
      )
    ).rows;
    if (scopeRows.length === 0) {
      return deny(
        'DIGEST_SCOPE_NOT_CONFIGURED',
        'Không gian làm việc chưa cấu hình phạm vi repository GitHub cho bản tin.',
        trustedWorkspaceId,
        trustedWorkspaceMode,
      );
    }
    const allowed = new Set(scopeRows.map((r) => r.full_name));
    if (pinnedRepos.length === 0 || !pinnedRepos.every((repo) => allowed.has(repo))) {
      return deny(
        'DIGEST_SCOPE_REVOKED',
        'Chủ lịch không còn quyền truy cập đầy đủ các repository trong bản tin.',
        trustedWorkspaceId,
        trustedWorkspaceMode,
      );
    }
  }

  return { allowed: true, trustedWorkspaceId, trustedWorkspaceMode };
}

/**
 * Builds the Telegram execution context for a telegram_digest from the verified schedule row and
 * the live personal Telegram connection. Uses the same semantics as TelegramDigestRunner step 1
 * (active credential id === pinned id, decrypted telegramUserId === pinned id, chat in selectedChats),
 * re-evaluated immediately before send. Any mismatch fails closed.
 */
export async function buildPinnedTelegramAdapterContext(input: {
  pool: Queryable;
  scheduleId: string;
  encryptionKey: string;
}): Promise<PinnedTelegramAdapterContextResult> {
  const guard = await assertDigestScheduleLiveScopeAndAuth({ pool: input.pool, scheduleId: input.scheduleId });
  const base = { trustedWorkspaceId: guard.trustedWorkspaceId, trustedWorkspaceMode: guard.trustedWorkspaceMode };
  if (!guard.allowed) return { allowed: false, code: guard.code, ...base };

  const row = await loadScheduleRow(input.pool, input.scheduleId);
  const cfg = (row?.digest_config ?? {}) as Record<string, unknown>;
  const pinnedChat = typeof cfg.chatId === 'string' ? cfg.chatId.trim() : '';
  const pinnedUser =
    typeof cfg.telegramUserId === 'string' && cfg.telegramUserId.trim() ? normalizeTelegramChatId(cfg.telegramUserId.trim()) : '';
  if (!row || row.kind !== 'telegram_digest' || !input.encryptionKey || !pinnedUser || !TELEGRAM_CHAT_ID_PATTERN.test(pinnedChat)) {
    return { allowed: false, code: 'DIGEST_TELEGRAM_CONTEXT_INVALID', ...base };
  }

  const cred = await validatePinnedPersonalCredential(input.pool, cfg.credentialId, 'telegram', row.user_id);
  if (!cred.ok) return { allowed: false, code: cred.code, ...base };

  let liveUser: string | undefined;
  const liveChats = new Set<string>();
  try {
    const decrypted = decryptCredentials(cred.row.config as any, input.encryptionKey) as Record<string, any>;
    liveUser =
      typeof decrypted.telegramUserId === 'string' && decrypted.telegramUserId.trim()
        ? normalizeTelegramChatId(decrypted.telegramUserId.trim())
        : undefined;
    for (const chat of Array.isArray(decrypted.selectedChats) ? decrypted.selectedChats : []) {
      if (chat && typeof chat.chatId === 'string' && TELEGRAM_CHAT_ID_PATTERN.test(chat.chatId.trim())) {
        liveChats.add(normalizeTelegramChatId(chat.chatId));
      }
    }
  } catch {
    return { allowed: false, code: 'DIGEST_TELEGRAM_CONTEXT_INVALID', ...base };
  }

  if (!liveUser || liveUser !== pinnedUser) {
    return { allowed: false, code: 'DIGEST_TELEGRAM_IDENTITY_MISMATCH', ...base };
  }
  const chatId = normalizeTelegramChatId(pinnedChat);
  if (!liveChats.has(chatId)) {
    return { allowed: false, code: 'DIGEST_TELEGRAM_CHAT_NOT_ALLOWED', ...base };
  }

  return {
    allowed: true,
    credentialId: cred.row.id,
    chatId,
    telegramUserId: liveUser,
    username: typeof cfg.username === 'string' && cfg.username.trim() ? cfg.username.trim() : undefined,
    ...base,
  };
}
