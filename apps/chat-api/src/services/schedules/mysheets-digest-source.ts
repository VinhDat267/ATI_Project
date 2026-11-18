import type pg from 'pg';
import { quoteSheetTitle, StepError } from '@wap/tool-adapters';
import type { MySheetsDigestSourceBinding, TelegramDigestSource } from '@wap/tool-schemas';
import { isUuid } from '../../db/repositories/uuid.js';
import type { AdapterContext } from '../adapter-factory.js';
import {
  createMySheetsConnectionLookup,
  type MySheetsConnectionReference,
  type MySheetsConnectionLookupResult,
} from '../gmail/connection-reference.js';
import { CHOOSE_SPREADSHEET, parseSheetsDigestRequest } from './sheets-digest-request.js';

export type MySheetsDigestConnection = MySheetsConnectionReference &
  Partial<Pick<MySheetsConnectionLookupResult, 'selectedSpreadsheets'>>;
export const MYSHEETS_DIGEST_SPREADSHEET_LIMIT = 5;
export const MYSHEETS_DIGEST_ROW_LIMIT = 50;
export const MYSHEETS_DIGEST_DEFAULT_RANGE = `A1:Z${MYSHEETS_DIGEST_ROW_LIMIT}`;
export const MYSHEETS_DIGEST_REAPPROVAL =
  'Kết nối hoặc phạm vi Google Sheets của bản tin đã thay đổi. Hãy cấp quyền lại và xác nhận bản xem trước mới.';
export type MySheetsDigestConfig = { sources?: TelegramDigestSource[] };

export function mySheetsDigestScanRange(args: TelegramDigestSource['args']): string {
  if (typeof args?.range === 'string') return args.range;
  if (typeof args?.sheetName === 'string') return `${quoteSheetTitle(args.sheetName)}!${MYSHEETS_DIGEST_DEFAULT_RANGE}`;
  return MYSHEETS_DIGEST_DEFAULT_RANGE;
}

/** Selected tab names can be stale. Check the exact requested range before offering auto-send. */
export async function verifyMySheetsDigestPreview(
  config: MySheetsDigestConfig,
  scope: Pick<AdapterContext, 'userId' | 'workspaceMode' | 'workspaceId'>,
  getAdapter?: (service: string, context: AdapterContext) => Promise<any> | any,
): Promise<string | undefined> {
  const source = config.sources?.find(isMySheetsDigestSource);
  if (!getAdapter || !source || !(source.args?.range || source.args?.sheetName)) return;
  const binding = approvedMySheetsDigestBinding(source);
  if (!binding || binding.spreadsheetIds.length !== 1) return MYSHEETS_DIGEST_REAPPROVAL;

  const range = mySheetsDigestScanRange(source.args);
  const signal = AbortSignal.timeout(8_000);
  try {
    const adapter = await getAdapter('mysheets', {
      ...scope,
      phase: 'execution',
      signal,
      connections: {
        mysheets: {
          credentialId: binding.credentialId,
          email: binding.email,
          allowedSpreadsheets: binding.spreadsheetIds,
        },
      },
    });
    await adapter.execute('mysheets.read_range', { spreadsheetId: binding.spreadsheetIds[0], range, limit: 1 }, { signal });
  } catch (error) {
    if (error instanceof StepError && (error.statusCode === 400 || error.statusCode === 404)) {
      return 'Google Sheets không đọc được vùng đã yêu cầu. Hãy kiểm tra tên tab và vùng ô, rồi tạo bản xem trước mới.';
    }
    return 'Chưa xác minh được vùng ô trên Google Sheets. Hãy kiểm tra kết nối rồi thử lại.';
  }
}

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
  requestText: string,
): TelegramDigestSource | { disabledReason: string } {
  const selected = [...new Set(live?.allowedSpreadsheets.filter(isSpreadsheetId))];
  if (!live || !isUuid(live.credentialId) || !live.email.trim() || selected.length === 0) {
    return { disabledReason: previous ? MYSHEETS_DIGEST_REAPPROVAL :
      'Hãy kết nối Google Sheets cá nhân và chọn ít nhất 1 bảng tính trước khi bật tự gửi báo cáo.' };
  }
  const requested = parseSheetsDigestRequest(requestText, selected, live.selectedSpreadsheets);
  if ('disabledReason' in requested) return requested;
  const { requestedId, allRequested } = requested;

  const previousBinding = previous ? approvedMySheetsDigestBinding(previous) : null;
  const previousId = previous?.args?.spreadsheetId ??
    (previousBinding?.spreadsheetIds.length === 1 ? previousBinding.spreadsheetIds[0] : undefined);
  const spreadsheetId = requestedId ?? previousId ??
    (!previousBinding && selected.length === 1 ? selected[0] : undefined);
  if (spreadsheetId !== undefined && (!isSpreadsheetId(spreadsheetId) || !selected.includes(spreadsheetId))) {
    return { disabledReason: MYSHEETS_DIGEST_REAPPROVAL };
  }
  let requestedRange: string | undefined;
  let requestedTab: string | undefined;
  if (requested.range || requested.tab) {
    if (!spreadsheetId) return { disabledReason: CHOOSE_SPREADSHEET };
    const tabs = live.selectedSpreadsheets?.find((item) => item.id === spreadsheetId)?.sheets;
    const tab = requested.tab ?? (tabs?.length === 1 ? tabs[0] : undefined);
    if (!tab) return { disabledReason: 'Hãy ghi rõ tên tab cần đọc cùng với vùng ô của bản tin Google Sheets.' };
    if (requested.range) {
      const [first, last] = requested.range.match(/\d+/g)!.map(Number) as [number, number];
      if (last - first + 1 > MYSHEETS_DIGEST_ROW_LIMIT) {
        return { disabledReason: `Bản tin đa nguồn đọc tối đa ${MYSHEETS_DIGEST_ROW_LIMIT} dòng cho mỗi bảng tính. Hãy chọn vùng ô nhỏ hơn.` };
      }
    }
    const canonicalTab = tabs?.find((name) => name.toLowerCase() === tab.toLowerCase()) ?? tab;
    if (requested.range) requestedRange = `${quoteSheetTitle(canonicalTab)}!${requested.range}`;
    else requestedTab = canonicalTab;
  }

  if (previous && !reauthorize) {
    if (!previousBinding || !matchesMySheetsDigestBinding(live, previousBinding) ||
      (requestedId && (previousBinding.spreadsheetIds.length !== 1 || previousBinding.spreadsheetIds[0] !== requestedId)) ||
      (requestedRange && previous.args?.range !== requestedRange) ||
      (requestedTab && previous.args?.sheetName !== requestedTab)) {
      return { disabledReason: MYSHEETS_DIGEST_REAPPROVAL };
    }
    return previous;
  }

  if (!spreadsheetId && !allRequested && !previousBinding) return { disabledReason: CHOOSE_SPREADSHEET };
  const spreadsheetIds = spreadsheetId ? [spreadsheetId] :
    previousBinding?.spreadsheetIds ?? selected.slice(0, MYSHEETS_DIGEST_SPREADSHEET_LIMIT);
  if (spreadsheetIds.some((id) => !selected.includes(id))) return { disabledReason: MYSHEETS_DIGEST_REAPPROVAL };
  const args = {
    ...previous?.args,
    ...(spreadsheetId ? { spreadsheetId } : {}),
    ...(requestedRange ? { range: requestedRange } : {}),
    ...(requestedTab ? { sheetName: requestedTab } : {}),
  };
  const title = live.selectedSpreadsheets?.find((item) => item.id === spreadsheetId)?.title.trim();
  const scannedRange = mySheetsDigestScanRange(args);
  return {
    ...source,
    ...(spreadsheetId ? { tool: 'mysheets.read_range', label: `${title || spreadsheetId} · ${scannedRange}` } : {}),
    ...(Object.keys(args).length > 0 ? { args } : {}),
    mysheetsBinding: {
      credentialId: live.credentialId, email: live.email, spreadsheetIds,
      truncated: !spreadsheetId && (previousBinding?.truncated ?? selected.length > spreadsheetIds.length),
    },
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
