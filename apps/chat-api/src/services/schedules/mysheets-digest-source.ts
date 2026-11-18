import type pg from 'pg';
import type { MySheetsDigestSourceBinding, PlanConnections, TelegramDigestSource } from '@wap/tool-schemas';
import { isUuid } from '../../db/repositories/uuid.js';
import { createMySheetsConnectionLookup } from '../gmail/connection-reference.js';

export type MySheetsDigestConnection = NonNullable<PlanConnections['mysheets']>;
export const MYSHEETS_DIGEST_SPREADSHEET_LIMIT = 5;
export const MYSHEETS_DIGEST_REAPPROVAL =
  'Kết nối hoặc phạm vi Google Sheets của bản tin đã thay đổi. Hãy cấp quyền lại và xác nhận bản xem trước mới.';

export type MySheetsDigestConfig = { sources?: TelegramDigestSource[] };

function isSpreadsheetId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id === id.trim();
}

export function isMySheetsDigestSource(source: TelegramDigestSource | null | undefined): boolean {
  return source?.service === 'mysheets' ||
    (typeof source?.tool === 'string' && source.tool.startsWith('mysheets.')) ||
    source?.mysheetsBinding !== undefined;
}

export function approvedMySheetsDigestBinding(source: TelegramDigestSource): MySheetsDigestSourceBinding | null {
  const binding = source.mysheetsBinding;
  if (
    source.service !== 'mysheets' ||
    (source.tool !== 'mysheets.list_spreadsheets' && source.tool !== 'mysheets.read_range') ||
    !binding ||
    typeof binding.credentialId !== 'string' ||
    !isUuid(binding.credentialId) ||
    typeof binding.email !== 'string' ||
    !binding.email.trim() ||
    typeof binding.truncated !== 'boolean' ||
    !Array.isArray(binding.spreadsheetIds) ||
    binding.spreadsheetIds.length === 0 ||
    binding.spreadsheetIds.length > MYSHEETS_DIGEST_SPREADSHEET_LIMIT ||
    !binding.spreadsheetIds.every(isSpreadsheetId) ||
    new Set(binding.spreadsheetIds).size !== binding.spreadsheetIds.length
  ) {
    return null;
  }
  const explicitId = source.args?.spreadsheetId;
  if (explicitId !== undefined && (binding.spreadsheetIds.length !== 1 || binding.spreadsheetIds[0] !== explicitId)) {
    return null;
  }
  return binding;
}

export function readMySheetsDigestBinding(
  config: MySheetsDigestConfig | null | undefined,
  services: readonly string[] | null,
): { kind: 'none' } | { kind: 'invalid' } | { kind: 'bound'; binding: MySheetsDigestSourceBinding } {
  const sources = Array.isArray(config?.sources) ? config.sources.filter(isMySheetsDigestSource) : [];
  if (sources.length === 0) return { kind: services?.includes('mysheets') ? 'invalid' : 'none' };
  const binding = sources.length === 1 ? approvedMySheetsDigestBinding(sources[0]!) : null;
  return binding ? { kind: 'bound', binding } : { kind: 'invalid' };
}

export function matchesMySheetsDigestBinding(
  live: MySheetsDigestConnection | null | undefined,
  binding: MySheetsDigestSourceBinding,
): boolean {
  return Boolean(
    live &&
      live.credentialId === binding.credentialId &&
      live.email === binding.email &&
      binding.spreadsheetIds.every((id) => live.allowedSpreadsheets.includes(id)),
  );
}

export function bindMySheetsDigestSource(
  source: TelegramDigestSource,
  live: MySheetsDigestConnection | null | undefined,
  previous: TelegramDigestSource | undefined,
  reauthorize: boolean,
): TelegramDigestSource | null {
  if (!live || !isUuid(live.credentialId) || !live.email.trim()) return null;

  if (previous && !reauthorize) {
    const binding = approvedMySheetsDigestBinding(previous);
    return binding && matchesMySheetsDigestBinding(live, binding) ? previous : null;
  }

  const selected = [...new Set(live.allowedSpreadsheets.filter(isSpreadsheetId))];
  const explicitId = previous?.args?.spreadsheetId;
  if (explicitId !== undefined && (!isSpreadsheetId(explicitId) || !selected.includes(explicitId))) return null;
  const spreadsheetIds = explicitId !== undefined ? [explicitId] : selected.slice(0, MYSHEETS_DIGEST_SPREADSHEET_LIMIT);
  if (spreadsheetIds.length === 0) return null;
  const truncated = explicitId === undefined && selected.length > spreadsheetIds.length;
  return {
    ...source,
    ...(previous?.args ? { args: previous.args } : {}),
    mysheetsBinding: { credentialId: live.credentialId, email: live.email, spreadsheetIds, truncated },
  };
}

export async function loadLiveMySheetsDigestConnection(
  pool: Pick<pg.Pool, 'query'>,
  userId: string,
  encryptionKey?: string,
  options?: { oauthClientId?: string; lock?: 'share' | 'nowait' },
): Promise<MySheetsDigestConnection | null> {
  if (!encryptionKey) return null;
  const lockClause = options?.lock === 'nowait' ? 'FOR SHARE NOWAIT' : options?.lock === 'share' ? 'FOR SHARE' : '';
  const lookup = createMySheetsConnectionLookup(
    {
      async getPersonalCredentials(service, ownerId) {
        const { rows } = await pool.query(
          `SELECT * FROM service_credentials
           WHERE service = $1 AND user_id = $2 AND workspace_id IS NULL AND status = 'active' ${lockClause}`,
          [service, ownerId],
        );
        return rows[0] ?? null;
      },
    },
    encryptionKey,
    undefined,
    options?.oauthClientId,
  );
  return lookup(userId);
}
