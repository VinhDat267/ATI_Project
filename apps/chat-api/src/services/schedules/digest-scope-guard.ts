import type pg from 'pg';
import { isUuid } from '../../db/repositories/uuid.js';

export interface DigestScopeGuardInput {
  pool: pg.Pool | Pick<pg.Pool, 'query'>;
  scheduleId: string;
  claimedWorkspaceId?: string | null;
}

export interface DigestScopeGuardResult {
  allowed: boolean;
  code?:
    | 'DIGEST_SCHEDULE_NOT_FOUND'
    | 'DIGEST_USER_INACTIVE'
    | 'DIGEST_WORKSPACE_MEMBER_REVOKED'
    | 'DIGEST_CROSS_TENANT_SCOPE_MISMATCH'
    | 'DIGEST_CREDENTIAL_INACTIVE'
    | 'DIGEST_SCOPE_REVOKED';
  pauseReason?: string;
  trustedWorkspaceId: string | null;
  trustedWorkspaceMode: string;
}

export interface PinnedTelegramAdapterContextResult {
  allowed: boolean;
  code?: string;
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

/**
 * Re-validates a digest schedule against live PostgreSQL state before any digest read or delivery:
 * 1. Reads authoritative workspace_id and workspace_mode from the schedules table (never trusting caller input).
 * 2. Verifies schedule owner is active (users.status = 'active').
 * 3. When workspace_mode = 'organization', verifies active workspace membership (workspace_members.status = 'active').
 * 4. Rejects cross-tenant workspace/credential references in digest_config.
 * 5. Verifies pinned or owner credentials in service_credentials are active (not reconnect_required/revoked).
 * 6. Verifies pinned workspace resources (e.g. GitHub team repos) remain within live workspace scope.
 */
export async function assertDigestScheduleLiveScopeAndAuth(
  input: DigestScopeGuardInput,
): Promise<DigestScopeGuardResult> {
  const { pool, scheduleId } = input;
  if (!isUuid(scheduleId)) {
    return {
      allowed: false,
      code: 'DIGEST_SCHEDULE_NOT_FOUND',
      pauseReason: 'Không tìm thấy lịch chạy bản tin.',
      trustedWorkspaceId: null,
      trustedWorkspaceMode: 'personal',
    };
  }

  const schedRes = await pool.query<ScheduleGuardRow>(
    `SELECT s.id,
            s.user_id,
            s.workspace_id,
            s.workspace_mode,
            s.kind,
            s.digest_config,
            u.status AS user_status
       FROM schedules s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = $1`,
    [scheduleId],
  );

  const row = schedRes.rows[0];
  if (!row) {
    return {
      allowed: false,
      code: 'DIGEST_SCHEDULE_NOT_FOUND',
      pauseReason: 'Không tìm thấy lịch chạy bản tin.',
      trustedWorkspaceId: null,
      trustedWorkspaceMode: 'personal',
    };
  }

  const trustedWorkspaceId = row.workspace_id ?? null;
  const trustedWorkspaceMode = row.workspace_mode ?? 'personal';
  const cfg = (row.digest_config ?? {}) as Record<string, unknown>;

  if (row.user_status !== 'active') {
    return {
      allowed: false,
      code: 'DIGEST_USER_INACTIVE',
      pauseReason: 'Tài khoản không còn hoạt động.',
      trustedWorkspaceId,
      trustedWorkspaceMode,
    };
  }

  if (trustedWorkspaceMode === 'organization' || trustedWorkspaceId !== null) {
    if (!trustedWorkspaceId) {
      return {
        allowed: false,
        code: 'DIGEST_WORKSPACE_MEMBER_REVOKED',
        pauseReason: 'Thành viên không còn quyền trong không gian làm việc này.',
        trustedWorkspaceId,
        trustedWorkspaceMode,
      };
    }
    const memberRes = await pool.query<{ status: string }>(
      `SELECT status
         FROM workspace_members
        WHERE workspace_id = $1
          AND user_id = $2`,
      [trustedWorkspaceId, row.user_id],
    );
    const member = memberRes.rows[0];
    if (!member || member.status !== 'active') {
      return {
        allowed: false,
        code: 'DIGEST_WORKSPACE_MEMBER_REVOKED',
        pauseReason: 'Thành viên không còn quyền trong không gian làm việc này.',
        trustedWorkspaceId,
        trustedWorkspaceMode,
      };
    }
  }

  const targetWsCandidates = [cfg.targetWorkspaceId, cfg.workspaceId, cfg.scopeId].filter(
    (v): v is string => typeof v === 'string' && v.trim().length > 0,
  );
  for (const targetWs of targetWsCandidates) {
    if (targetWs !== trustedWorkspaceId) {
      return {
        allowed: false,
        code: 'DIGEST_CROSS_TENANT_SCOPE_MISMATCH',
        pauseReason: 'Cấu hình bản tin tham chiếu không gian làm việc khác.',
        trustedWorkspaceId,
        trustedWorkspaceMode,
      };
    }
  }

  const pinnedCredentialId =
    typeof cfg.credentialId === 'string' && cfg.credentialId.trim().length > 0
      ? cfg.credentialId.trim()
      : null;

  if (pinnedCredentialId && isUuid(pinnedCredentialId)) {
    const credRes = await pool.query<{
      id: string;
      user_id: string | null;
      workspace_id: string | null;
      status: string;
    }>(
      `SELECT id, user_id, workspace_id, status
         FROM service_credentials
        WHERE id = $1`,
      [pinnedCredentialId],
    );
    const cred = credRes.rows[0];
    if (!cred) {
      return {
        allowed: false,
        code: 'DIGEST_CREDENTIAL_INACTIVE',
        pauseReason: 'Kết nối dịch vụ của chủ lịch không còn hợp lệ hoặc đã thay đổi.',
        trustedWorkspaceId,
        trustedWorkspaceMode,
      };
    }
    if (
      (cred.user_id && cred.user_id !== row.user_id) ||
      (cred.workspace_id && cred.workspace_id !== trustedWorkspaceId)
    ) {
      return {
        allowed: false,
        code: 'DIGEST_CROSS_TENANT_SCOPE_MISMATCH',
        pauseReason: 'Kết nối dịch vụ thuộc về không gian làm việc hoặc người dùng khác.',
        trustedWorkspaceId,
        trustedWorkspaceMode,
      };
    }
    if (cred.status !== 'active') {
      return {
        allowed: false,
        code: 'DIGEST_CREDENTIAL_INACTIVE',
        pauseReason: 'Kết nối dịch vụ của chủ lịch không còn hợp lệ hoặc cần kết nối lại.',
        trustedWorkspaceId,
        trustedWorkspaceMode,
      };
    }
  }

  if (row.kind === 'github_digest' && trustedWorkspaceMode === 'organization' && trustedWorkspaceId) {
    const pinnedRepos = (
      Array.isArray(cfg.repos)
        ? cfg.repos
        : typeof cfg.repo === 'string'
          ? [cfg.repo]
          : []
    )
      .filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
      .map((r) => r.trim().toLowerCase());

    if (pinnedRepos.length > 0) {
      const scopeRes = await pool.query<{ full_name: string }>(
        `SELECT lower(r.full_name) AS full_name
           FROM github_team_repos r
           JOIN github_team_scope s ON s.id = r.scope_id
          WHERE r.scope_id = $1
             OR (r.scope_id = 'default' AND s.chosen_by = $2)`,
        [trustedWorkspaceId, row.user_id],
      );
      const allowedRepoSet = new Set(scopeRes.rows.map((r) => r.full_name));
      const allInScope = pinnedRepos.every((repo) => allowedRepoSet.has(repo));
      if (!allInScope) {
        return {
          allowed: false,
          code: 'DIGEST_SCOPE_REVOKED',
          pauseReason: 'Chủ lịch không còn quyền truy cập đầy đủ các repository trong bản tin.',
          trustedWorkspaceId,
          trustedWorkspaceMode,
        };
      }
    }
  }

  return {
    allowed: true,
    trustedWorkspaceId,
    trustedWorkspaceMode,
  };
}

/**
 * Resolves and binds the Telegram adapter execution context (credentialId, chatId, telegramUserId)
 * directly from the verified schedule row in PostgreSQL.
 */
export async function buildPinnedTelegramAdapterContext(input: {
  pool: pg.Pool | Pick<pg.Pool, 'query'>;
  scheduleId: string;
}): Promise<PinnedTelegramAdapterContextResult> {
  const guard = await assertDigestScheduleLiveScopeAndAuth({
    pool: input.pool,
    scheduleId: input.scheduleId,
  });
  if (!guard.allowed) {
    return {
      allowed: false,
      code: guard.code,
      trustedWorkspaceId: guard.trustedWorkspaceId,
      trustedWorkspaceMode: guard.trustedWorkspaceMode,
    };
  }

  const schedRes = await input.pool.query<{ digest_config: Record<string, unknown> | null }>(
    `SELECT digest_config FROM schedules WHERE id = $1`,
    [input.scheduleId],
  );
  const cfg = (schedRes.rows[0]?.digest_config ?? {}) as Record<string, unknown>;
  const chatId =
    typeof cfg.chatId === 'string' && cfg.chatId.trim()
      ? cfg.chatId.trim()
      : typeof cfg.telegramChatId === 'string' && cfg.telegramChatId.trim()
        ? cfg.telegramChatId.trim()
        : '';
  const credentialId =
    typeof cfg.credentialId === 'string' && cfg.credentialId.trim()
      ? cfg.credentialId.trim()
      : typeof cfg.telegramCredentialId === 'string' && cfg.telegramCredentialId.trim()
        ? cfg.telegramCredentialId.trim()
        : '';
  const telegramUserId =
    typeof cfg.telegramUserId === 'string' && cfg.telegramUserId.trim()
      ? cfg.telegramUserId.trim()
      : undefined;
  const username =
    typeof cfg.username === 'string' && cfg.username.trim() ? cfg.username.trim() : undefined;

  if (!chatId || !credentialId) {
    return {
      allowed: false,
      code: 'DIGEST_TELEGRAM_CONTEXT_INVALID',
      trustedWorkspaceId: guard.trustedWorkspaceId,
      trustedWorkspaceMode: guard.trustedWorkspaceMode,
    };
  }

  return {
    allowed: true,
    credentialId,
    chatId,
    telegramUserId,
    username,
    trustedWorkspaceId: guard.trustedWorkspaceId,
    trustedWorkspaceMode: guard.trustedWorkspaceMode,
  };
}
