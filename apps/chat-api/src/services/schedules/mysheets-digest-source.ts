import type pg from 'pg';
import { quoteSheetTitle } from '@wap/tool-adapters';
import type { MySheetsDigestSourceBinding, TelegramDigestSource } from '@wap/tool-schemas';
import { isUuid } from '../../db/repositories/uuid.js';
import {
  createMySheetsConnectionLookup,
  type MySheetsConnectionReference,
  type MySheetsConnectionLookupResult,
} from '../gmail/connection-reference.js';
import { extractPromptDigestRange, extractSheetTabFromPrompt } from './sheets-digest-candidate.js';

export type MySheetsDigestConnection = MySheetsConnectionReference &
  Partial<Pick<MySheetsConnectionLookupResult, 'selectedSpreadsheets'>>;
export const MYSHEETS_DIGEST_SPREADSHEET_LIMIT = 5;
export const MYSHEETS_DIGEST_ROW_LIMIT = 50;
export const MYSHEETS_DIGEST_DEFAULT_RANGE = `A1:Z${MYSHEETS_DIGEST_ROW_LIMIT}`;
export const MYSHEETS_DIGEST_REAPPROVAL =
  'Kết nối hoặc phạm vi Google Sheets của bản tin đã thay đổi. Hãy cấp quyền lại và xác nhận bản xem trước mới.';
const CHOOSE_SPREADSHEET =
  'Hãy ghi rõ tên hoặc ID một bảng tính đã chọn, hoặc yêu cầu báo cáo tất cả bảng tính đã chọn.';
const ALL_SPREADSHEETS_RE =
  /(?:tất\s+cả\s+(?:các\s+)?bảng\s+tính|toàn\s+bộ\s+(?:các\s+)?bảng\s+tính|all\s+(?:selected\s+)?spreadsheets)/iu;
const WORKBOOK_REFERENCE_RE =
  /(?:^|(?<=[^\p{L}\p{N}_]))(?:bảng\s+tính|spreadsheet|google\s+sheets?)\s+(?!(?:và|and|cùng|kèm|lên|trên|qua|sang|vào|to|gửi|mỗi|sáng|chiều|hôm|tab|trang\s+tính|vùng|range|ô|cell)(?=$|[^\p{L}\p{N}_]))(?:["“]([^"”\n]+)["”]|['‘]([^'’\n]+)['’]|([^\n]+?)(?=\s+(?:tab|sheet|worksheet|trang\s+tính|vùng|range|ô|cell|và\s+(?:trello|github|jira|calendar|gmail|bảng\s+tính|tab|sheet|worksheet|trang\s+tính)|and\s+(?:trello|github|jira|calendar|gmail|spreadsheet|tab|sheet|worksheet|trang\s+tính)|cùng|kèm|lên|qua|sang|vào|gửi|to|mỗi|sáng|chiều|hôm)(?=$|[^\p{L}\p{N}_])|[(),;!?\n]|$))/giu;
const GENERIC_WORKBOOK_RE = /^(?:google\s+sheets?(?:\s+cá\s+nhân)?|cá\s+nhân|của\s+(?:tôi|bạn)|đã\s+(?:chọn|cấp\s+quyền)|được\s+phép)$/iu;
const SPREADSHEET_URL_ID_RE = /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/g;
const SCOPED_SPREADSHEET_URL_RE = /\/spreadsheets\/d\/[A-Za-z0-9_-]+[^\s]*[?&#](?:gid|range)=/iu;
const EXCLUDED_WORKBOOK_RE = /(?:^|[^\p{L}\p{N}_])(?:trừ|except|exclude|không\s+lấy)\s+/iu;
const TAB_KEYWORD_RE = /(?:^|[^\p{L}\p{N}_])(?:tab|sheet|worksheet|trang\s+tính)\s+(?=[\p{L}\p{N}"'“‘])/giu;
const CHOOSE_TAB = 'Hãy chỉ định một tab duy nhất cho vùng ô của bản tin Google Sheets.';

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
  requestText: string,
): TelegramDigestSource | { disabledReason: string } {
  const selected = [...new Set(live?.allowedSpreadsheets.filter(isSpreadsheetId))];
  if (!live || !isUuid(live.credentialId) || !live.email.trim() || selected.length === 0) {
    return { disabledReason: previous ? MYSHEETS_DIGEST_REAPPROVAL :
      'Hãy kết nối Google Sheets cá nhân và chọn ít nhất 1 bảng tính trước khi bật tự gửi báo cáo.' };
  }
  if (SCOPED_SPREADSHEET_URL_RE.test(requestText)) {
    return { disabledReason: 'Hãy dùng tên hoặc ID bảng tính và ghi rõ tên tab, vùng ô trong yêu cầu thay cho liên kết có mã tab hoặc vùng ô.' };
  }

  const references = Array.from(requestText.matchAll(WORKBOOK_REFERENCE_RE), (match) => (match[1] ?? match[2] ?? match[3] ?? '').trim())
    .filter((reference) => reference && !GENERIC_WORKBOOK_RE.test(reference));
  const allRequested = ALL_SPREADSHEETS_RE.test(requestText);
  if (EXCLUDED_WORKBOOK_RE.test(requestText) || (allRequested && references.length > 0)) {
    return { disabledReason: CHOOSE_SPREADSHEET };
  }

  const requestedIds = new Set(Array.from(requestText.matchAll(SPREADSHEET_URL_ID_RE), (match) => match[1]!));
  const requestTokens = new Set(requestText.match(/[A-Za-z0-9_-]+/g));
  for (const id of selected) if (requestTokens.has(id)) requestedIds.add(id);
  for (const reference of references) {
    const referenceUrlId = Array.from(reference.matchAll(SPREADSHEET_URL_ID_RE), (match) => match[1])[0];
    if (referenceUrlId) {
      requestedIds.add(referenceUrlId);
      continue;
    }
    if (selected.includes(reference)) {
      requestedIds.add(reference);
      continue;
    }
    const titleMatches = live.selectedSpreadsheets?.filter((item) =>
      selected.includes(item.id) && item.title.trim().toLowerCase() === reference.toLowerCase()
    );
    if (titleMatches?.length !== 1) return { disabledReason: CHOOSE_SPREADSHEET };
    requestedIds.add(titleMatches[0]!.id);
  }
  if (requestedIds.size > 1 || (allRequested && requestedIds.size > 0) || [...requestedIds].some((id) => !selected.includes(id))) {
    return { disabledReason: CHOOSE_SPREADSHEET };
  }

  const scopeText = requestText.replace(WORKBOOK_REFERENCE_RE, ' ').replace(/\bgoogle\s+sheets?\b/giu, '');
  const range = extractPromptDigestRange(scopeText);
  if (!range.ok) return { disabledReason: range.reason };
  if (!range.canonicalRange && /!\$?[A-Z]{1,3}\$?\d+\b/iu.test(scopeText)) {
    return { disabledReason: 'Hãy chỉ định vùng ô A1 có ô đầu và ô cuối, ví dụ Tasks!B2:B2.' };
  }
  const tabFromPrompt = extractSheetTabFromPrompt(scopeText, scopeText.toLowerCase(), undefined, { keywordOnly: true });
  if (Array.from(scopeText.matchAll(TAB_KEYWORD_RE)).length > 1 ||
    (tabFromPrompt && range.sheetFromRange && tabFromPrompt.toLowerCase() !== range.sheetFromRange.toLowerCase())) {
    return { disabledReason: CHOOSE_TAB };
  }

  const previousBinding = previous ? approvedMySheetsDigestBinding(previous) : null;
  const previousId = previous?.args?.spreadsheetId ??
    (previousBinding?.spreadsheetIds.length === 1 ? previousBinding.spreadsheetIds[0] : undefined);
  const requestedId = [...requestedIds][0];
  const spreadsheetId = requestedId ?? previousId ??
    (!previousBinding && selected.length === 1 ? selected[0] : undefined);
  if (spreadsheetId !== undefined && (!isSpreadsheetId(spreadsheetId) || !selected.includes(spreadsheetId))) {
    return { disabledReason: MYSHEETS_DIGEST_REAPPROVAL };
  }
  let requestedRange: string | undefined;
  let requestedTab: string | undefined;
  if (range.canonicalRange || tabFromPrompt) {
    if (!spreadsheetId) return { disabledReason: CHOOSE_SPREADSHEET };
    const tabs = live.selectedSpreadsheets?.find((item) => item.id === spreadsheetId)?.sheets;
    const tab = range.sheetFromRange ?? tabFromPrompt ?? (tabs?.length === 1 ? tabs[0] : undefined);
    if (!tab) return { disabledReason: 'Hãy ghi rõ tên tab cần đọc cùng với vùng ô của bản tin Google Sheets.' };
    if (range.canonicalRange) {
      const [first, last] = range.canonicalRange.match(/\d+/g)!.map(Number) as [number, number];
      if (last - first + 1 > MYSHEETS_DIGEST_ROW_LIMIT) {
        return { disabledReason: `Bản tin đa nguồn đọc tối đa ${MYSHEETS_DIGEST_ROW_LIMIT} dòng cho mỗi bảng tính. Hãy chọn vùng ô nhỏ hơn.` };
      }
    }
    const canonicalTab = tabs?.find((name) => name.toLowerCase() === tab.toLowerCase()) ?? tab;
    if (range.canonicalRange) requestedRange = `${quoteSheetTitle(canonicalTab)}!${range.canonicalRange}`;
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
  const scannedRange = args.range ?? (args.sheetName
    ? `${quoteSheetTitle(args.sheetName)}!${MYSHEETS_DIGEST_DEFAULT_RANGE}`
    : MYSHEETS_DIGEST_DEFAULT_RANGE);
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
