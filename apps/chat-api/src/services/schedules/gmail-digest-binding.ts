import type pg from 'pg';
import { decryptCredentials } from '@wap/tool-adapters';
import { GMAIL_MODIFY_SCOPE, type GmailDigestBinding } from '@wap/tool-schemas';
import { isUuid } from '../../db/repositories/uuid.js';

type Queryable = pg.Pool | Pick<pg.Pool, 'query'>;

export type GmailBindingGuardCode =
  | 'DIGEST_GMAIL_CONFIG_INVALID'
  | 'DIGEST_GMAIL_SOURCE_INACTIVE'
  | 'DIGEST_GMAIL_SOURCE_MISMATCH'
  | 'DIGEST_GMAIL_ORIGIN_MISMATCH'
  | 'DIGEST_GMAIL_SCOPE_MISSING';

export type TelegramDigestGmailValidationResult =
  | { kind: 'non_gmail' }
  | { kind: 'gmail_bound'; binding: GmailDigestBinding }
  | { kind: 'gmail_legacy'; reason: string }
  | { kind: 'invalid'; reason: string };

export type GmailBindingAssertionResult =
  | { allowed: true; binding: GmailDigestBinding }
  | { allowed: false; code: GmailBindingGuardCode; reason: string };

interface GmailCredentialRow {
  id: string;
  service: string;
  user_id: string | null;
  workspace_id: string | null;
  status: string;
  config: unknown;
}

const FIXED_GMAIL_DIGEST_QUERY = 'in:inbox is:unread';
const EMAIL_PATTERN = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

export function normalizeGmailAddress(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase();
  if (!normalized || normalized.length > 320 || !EMAIL_PATTERN.test(normalized)) {
    return null;
  }
  return normalized;
}

export function isValidGmailDigestBinding(binding: unknown): binding is GmailDigestBinding {
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
    return false;
  }
  const obj = binding as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  if (
    keys.length !== 4 ||
    keys[0] !== 'credentialId' ||
    keys[1] !== 'email' ||
    keys[2] !== 'kind' ||
    keys[3] !== 'oauthClientId'
  ) {
    return false;
  }
  if (obj.kind !== 'gmail') return false;
  if (typeof obj.credentialId !== 'string' || !isUuid(obj.credentialId)) return false;
  if (typeof obj.email !== 'string' || normalizeGmailAddress(obj.email) !== obj.email) return false;
  if (
    typeof obj.oauthClientId !== 'string' ||
    obj.oauthClientId.trim().length === 0 ||
    obj.oauthClientId.trim() !== obj.oauthClientId
  ) {
    return false;
  }
  return true;
}

export function validateTelegramDigestGmailConfig(config: unknown): TelegramDigestGmailValidationResult {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { kind: 'invalid', reason: 'Cấu hình bản tin tự động không hợp lệ.' };
  }
  const cfg = config as Record<string, unknown>;
  if (cfg.sourceBindingVersion !== undefined && cfg.sourceBindingVersion !== 1) {
    return { kind: 'invalid', reason: 'Phiên bản ràng buộc nguồn Gmail không hợp lệ.' };
  }
  if (!Array.isArray(cfg.sources)) {
    if (cfg.sourceBindingVersion !== undefined) {
      return { kind: 'invalid', reason: 'Danh sách nguồn dữ liệu bản tin không hợp lệ.' };
    }
    return { kind: 'non_gmail' };
  }

  const gmailSources: Record<string, unknown>[] = [];
  for (const rawSource of cfg.sources) {
    if (!rawSource || typeof rawSource !== 'object' || Array.isArray(rawSource)) {
      return { kind: 'invalid', reason: 'Nguồn dữ liệu trong cấu hình bản tin không hợp lệ.' };
    }
    const s = rawSource as Record<string, unknown>;
    const isGmailService = s.service === 'gmail';
    const isGmailTool = typeof s.tool === 'string' && s.tool.startsWith('gmail.');
    if (!isGmailService && !isGmailTool) {
      if (s.binding !== undefined) {
        return {
          kind: 'invalid',
          reason: 'Nguồn không phải Gmail không được phép đính kèm thông tin ràng buộc Gmail.',
        };
      }
      continue;
    }
    gmailSources.push(s);
  }

  if (gmailSources.length === 0) {
    if (cfg.sourceBindingVersion !== undefined) {
      return {
        kind: 'invalid',
        reason: 'Phiên bản ràng buộc nguồn Gmail yêu cầu đúng một nguồn Gmail hợp lệ.',
      };
    }
    return { kind: 'non_gmail' };
  }

  if (gmailSources.length > 1) {
    return {
      kind: 'invalid',
      reason: 'Không hỗ trợ nhiều nguồn Gmail trùng lặp trong cùng một bản tin.',
    };
  }

  const gmailSource = gmailSources[0]!;
  const args = gmailSource.args;
  const hasFixedUnreadQuery =
    Boolean(args) &&
    typeof args === 'object' &&
    !Array.isArray(args) &&
    Object.keys(args as Record<string, unknown>).length === 1 &&
    (args as Record<string, unknown>).query === FIXED_GMAIL_DIGEST_QUERY;

  if (
    gmailSource.service !== 'gmail' ||
    gmailSource.tool !== 'gmail.search_threads' ||
    !hasFixedUnreadQuery
  ) {
    return {
      kind: 'invalid',
      reason: 'Công cụ hoặc truy vấn nguồn Gmail trong bản tin không nằm trong phạm vi cố định được duyệt.',
    };
  }

  if (cfg.sourceBindingVersion === undefined && gmailSource.binding === undefined) {
    return {
      kind: 'gmail_legacy',
      reason: 'Lịch Gmail tự động phiên bản cũ chưa ghim nguồn cụ thể. Vui lòng tạo đề xuất mới và xác nhận lại.',
    };
  }

  if (cfg.sourceBindingVersion !== 1 || !isValidGmailDigestBinding(gmailSource.binding)) {
    return {
      kind: 'invalid',
      reason: 'Thông tin ràng buộc nguồn Gmail trong lịch không hợp lệ hoặc không đầy đủ.',
    };
  }

  return { kind: 'gmail_bound', binding: gmailSource.binding };
}

export async function loadGmailDigestBinding(
  client: Queryable,
  userId: string,
  expectedClientId: string | undefined,
  encryptionKey: string = process.env.ENCRYPTION_KEY ?? '',
): Promise<GmailDigestBinding | null> {
  const normalizedClientId = typeof expectedClientId === 'string' ? expectedClientId.trim() : '';
  if (!isUuid(userId) || !normalizedClientId || !encryptionKey) {
    return null;
  }

  const res = await client.query<GmailCredentialRow>(
    `SELECT id, service, user_id, workspace_id, status, config
       FROM service_credentials
      WHERE service = 'gmail'
        AND user_id = $1
        AND workspace_id IS NULL
        AND status = 'active'`,
    [userId],
  );
  if (res.rows.length !== 1) {
    return null;
  }
  const row = res.rows[0]!;
  if (!isUuid(row.id) || row.service !== 'gmail' || row.user_id !== userId || row.workspace_id !== null) {
    return null;
  }

  let decrypted: Record<string, unknown>;
  try {
    decrypted = decryptCredentials(row.config as string, encryptionKey) as Record<string, unknown>;
  } catch {
    return null;
  }

  const email = normalizeGmailAddress(decrypted.email);
  const storedClientId = typeof decrypted.oauthClientId === 'string' ? decrypted.oauthClientId.trim() : '';
  const refreshToken = typeof decrypted.refreshToken === 'string' ? decrypted.refreshToken.trim() : '';
  const scopes = Array.isArray(decrypted.scopes) ? decrypted.scopes : [];

  if (
    !email ||
    storedClientId !== normalizedClientId ||
    !refreshToken ||
    !scopes.includes(GMAIL_MODIFY_SCOPE)
  ) {
    return null;
  }

  return {
    kind: 'gmail',
    credentialId: row.id,
    email,
    oauthClientId: normalizedClientId,
  };
}

export async function assertGmailDigestBinding(
  client: Queryable,
  ownerId: string,
  binding: unknown,
  expectedClientId: string | undefined,
  options?: {
    encryptionKey?: string;
    lock?: 'share_nowait';
  },
): Promise<GmailBindingAssertionResult> {
  if (!isUuid(ownerId) || !isValidGmailDigestBinding(binding)) {
    return {
      allowed: false,
      code: 'DIGEST_GMAIL_CONFIG_INVALID',
      reason: 'Thông tin ràng buộc nguồn Gmail của lịch không hợp lệ.',
    };
  }

  const normalizedClientId = typeof expectedClientId === 'string' ? expectedClientId.trim() : '';
  if (!normalizedClientId || binding.oauthClientId !== normalizedClientId) {
    return {
      allowed: false,
      code: 'DIGEST_GMAIL_ORIGIN_MISMATCH',
      reason: 'Ứng dụng OAuth của kết nối Gmail không khớp cấu hình máy chủ hiện tại.',
    };
  }

  const encryptionKey = options?.encryptionKey ?? process.env.ENCRYPTION_KEY ?? '';
  if (!encryptionKey) {
    return {
      allowed: false,
      code: 'DIGEST_GMAIL_CONFIG_INVALID',
      reason: 'Không kiểm chứng được khóa bảo mật cho kết nối Gmail.',
    };
  }

  const lockClause = options?.lock === 'share_nowait' ? ' FOR SHARE NOWAIT' : '';
  const row = (
    await client.query<GmailCredentialRow>(
      `SELECT id, service, user_id, workspace_id, status, config
         FROM service_credentials
        WHERE id = $1${lockClause}`,
      [binding.credentialId],
    )
  ).rows[0];

  if (!row) {
    return {
      allowed: false,
      code: 'DIGEST_GMAIL_SOURCE_MISMATCH',
      reason: 'Kết nối Gmail được ghim trong lịch đã bị ngắt hoặc thay đổi. Vui lòng xác nhận lại lịch.',
    };
  }

  if (row.service !== 'gmail' || row.user_id !== ownerId || row.workspace_id !== null) {
    return {
      allowed: false,
      code: 'DIGEST_GMAIL_SOURCE_MISMATCH',
      reason: 'Kết nối Gmail không thuộc phạm vi cá nhân của chủ lịch.',
    };
  }

  if (row.status !== 'active') {
    return {
      allowed: false,
      code: 'DIGEST_GMAIL_SOURCE_INACTIVE',
      reason: 'Kết nối Gmail của chủ lịch không còn hoạt động hoặc cần kết nối lại.',
    };
  }

  let decrypted: Record<string, unknown>;
  try {
    decrypted = decryptCredentials(row.config as string, encryptionKey) as Record<string, unknown>;
  } catch {
    return {
      allowed: false,
      code: 'DIGEST_GMAIL_SOURCE_INACTIVE',
      reason: 'Không đọc được thông tin xác thực Gmail đã lưu. Hãy kết nối lại.',
    };
  }

  const storedClientId = typeof decrypted.oauthClientId === 'string' ? decrypted.oauthClientId.trim() : '';
  if (!storedClientId || storedClientId !== normalizedClientId) {
    return {
      allowed: false,
      code: 'DIGEST_GMAIL_ORIGIN_MISMATCH',
      reason: 'Kết nối Gmail đã lưu không thuộc cùng ứng dụng OAuth của máy chủ.',
    };
  }

  const liveEmail = normalizeGmailAddress(decrypted.email);
  if (!liveEmail || liveEmail !== binding.email) {
    return {
      allowed: false,
      code: 'DIGEST_GMAIL_SOURCE_MISMATCH',
      reason: 'Địa chỉ hộp thư Gmail hiện tại không khớp với hộp thư đã xác nhận cho lịch.',
    };
  }

  const refreshToken = typeof decrypted.refreshToken === 'string' ? decrypted.refreshToken.trim() : '';
  if (!refreshToken) {
    return {
      allowed: false,
      code: 'DIGEST_GMAIL_SOURCE_INACTIVE',
      reason: 'Kết nối Gmail thiếu khóa làm mới hợp lệ. Hãy kết nối lại.',
    };
  }

  const scopes = Array.isArray(decrypted.scopes) ? decrypted.scopes : [];
  if (!scopes.includes(GMAIL_MODIFY_SCOPE)) {
    return {
      allowed: false,
      code: 'DIGEST_GMAIL_SCOPE_MISSING',
      reason: 'Kết nối Gmail không còn đủ quyền đọc hộp thư cần thiết. Hãy kết nối lại.',
    };
  }

  return {
    allowed: true,
    binding,
  };
}
