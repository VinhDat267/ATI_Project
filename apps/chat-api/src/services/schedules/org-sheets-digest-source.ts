import type pg from 'pg';
import { decryptCredentials, quoteSheetTitle } from '@wap/tool-adapters';
import type { TelegramDigestSource } from '@wap/tool-schemas';
import type { AdapterContext } from '../adapter-factory.js';
import { validateAndCanonicalizeDigestRange } from './sheets-digest-candidate.js';
import { orgSheetsWorkbookLookup, parseSheetsDigestRequest } from './sheets-digest-request.js';

export const ORG_SHEETS_DIGEST_REAPPROVAL =
  'Phạm vi Bảng tính nhóm chưa được xác nhận hoặc đã thay đổi. Hãy xác nhận lại bảng tính, tab và vùng ô của bản tin Slack.';
const CHOOSE_WORKBOOK = 'Hãy chỉ định một Bảng tính nhóm bằng tên hoặc ID để bật tự gửi.';
const CHOOSE_TAB = 'Hãy chỉ định một tab có trong bảng tính để bật tự gửi.';
const CHOOSE_RANGE = 'Hãy chỉ định vùng ô A1 cần đọc, ví dụ Backlog!A1:C10.';
const MAX_ROWS = 50;

type ApprovedRead = { spreadsheetId: string; sheetId: number; range: string };

function validId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{20,}$/.test(id);
}

function validSheetId(id: unknown): id is number {
  return typeof id === 'number' && Number.isInteger(id) && id >= 0 && id <= 2147483647;
}

function rangeIsBounded(cells: string): boolean {
  const validated = validateAndCanonicalizeDigestRange(cells);
  if (!validated.ok || validated.canonicalRange !== cells) return false;
  const [start, end] = cells.match(/\d+/g)!.map(Number) as [number, number];
  return Number.isSafeInteger(end) && end <= 2147483647 && end - start + 1 <= MAX_ROWS;
}

export function approvedOrgSheetsDigestRead(source: TelegramDigestSource | undefined): ApprovedRead | null {
  if (source?.service !== 'sheets' || source.tool !== 'sheets.read_range') return null;
  const { spreadsheetId, sheetId, range } = source.args ?? {};
  if (!validId(spreadsheetId) || !validSheetId(sheetId) || typeof range !== 'string') return null;
  const separator = range.lastIndexOf('!');
  if (separator <= 0 || !rangeIsBounded(range.slice(separator + 1))) return null;
  return { spreadsheetId, sheetId, range };
}

export function isOrgSheetsDigestSource(source: TelegramDigestSource | null | undefined): boolean {
  return source?.service === 'sheets' || (typeof source?.tool === 'string' && source.tool.startsWith('sheets.'));
}

export function readOrgSheetsDigestScope(
  config: { sources?: unknown } | null | undefined,
  services?: readonly string[] | null,
): { kind: 'none' | 'invalid' } | { kind: 'bound'; read: ApprovedRead } {
  const sources = Array.isArray(config?.sources)
    ? config.sources.filter(isOrgSheetsDigestSource)
    : [];
  if (sources.length === 0) return { kind: services?.includes('sheets') ? 'invalid' : 'none' };
  const read = sources.length === 1 ? approvedOrgSheetsDigestRead(sources[0]) : null;
  return read ? { kind: 'bound', read } : { kind: 'invalid' };
}

export async function allowsOrgSheetsDigestRead(
  db: Pick<pg.Pool, 'query'>,
  workspaceId: string | null,
  encryptionKey: string | undefined,
  read: ApprovedRead,
  lock?: 'share' | 'nowait',
): Promise<boolean> {
  if (!encryptionKey) return false;
  const { rows } = await db.query<{ config: string }>(
    "SELECT config FROM service_credentials WHERE service = 'sheets' AND user_id IS NULL " +
      "AND workspace_id IS NOT DISTINCT FROM $1 AND status = 'active'" + (lock === 'nowait' ? ' FOR SHARE NOWAIT' : lock === 'share' ? ' FOR SHARE' : ''),
    [workspaceId],
  );
  if (rows.length !== 1) return false;
  try {
    const spreadsheets = decryptCredentials(rows[0]!.config, encryptionKey)?.allowedScope?.spreadsheets;
    return Array.isArray(spreadsheets) && spreadsheets.includes(read.spreadsheetId);
  } catch {
    return false;
  }
}

export async function bindOrgSheetsDigestSource(
  source: TelegramDigestSource,
  request: string,
  previous: TelegramDigestSource | undefined,
  context: Pick<AdapterContext, 'userId' | 'workspaceMode' | 'workspaceId'>,
  getAdapter?: (service: string, context: AdapterContext) => Promise<any> | any,
  reauthorize = false,
): Promise<TelegramDigestSource | { disabledReason: string }> {
  const signal = AbortSignal.timeout(8_000);
  const previousRead = approvedOrgSheetsDigestRead(previous);
  try {
    const adapter = await getAdapter?.('sheets', { ...context, phase: 'execution', signal });
    if (!adapter) return { disabledReason: ORG_SHEETS_DIGEST_REAPPROVAL };
    if (reauthorize) {
      if (!previousRead) return { disabledReason: ORG_SHEETS_DIGEST_REAPPROVAL };
      // A saved planner summary cannot replace the user's previously approved sheet and cells.
      await adapter.execute('sheets.read_range', { ...previousRead, limit: 1 }, { signal });
      return previous!;
    }

    const lookup = orgSheetsWorkbookLookup(request);
    if (lookup && 'ambiguous' in lookup) return { disabledReason: CHOOSE_WORKBOOK };
    const workbooks = lookup
      ? await adapter.execute('sheets.list_spreadsheets', { ...lookup, exactMatch: true, limit: 2 }, { signal })
      : previousRead
        ? [{ id: previousRead.spreadsheetId, title: previous!.label.slice(0, -(previousRead.range.length + 3)) }]
        : [];
    if (!Array.isArray(workbooks) || workbooks.length !== 1 ||
      !validId(workbooks[0]?.id) || typeof workbooks[0].title !== 'string') {
      return { disabledReason: CHOOSE_WORKBOOK };
    }
    const workbook = workbooks[0];
    const requested = parseSheetsDigestRequest(request, [workbook.id], workbooks, { organization: true });
    if ('disabledReason' in requested) return requested;
    if (requested.allRequested || (!requested.requestedId && workbook.id !== previousRead?.spreadsheetId)) {
      return { disabledReason: CHOOSE_WORKBOOK };
    }

    const existingTab = previousRead?.spreadsheetId === workbook.id ? previousRead : null;
    if (!requested.tab && !requested.range && existingTab) return previous!;
    if (!requested.range) return { disabledReason: CHOOSE_RANGE };
    if (!rangeIsBounded(requested.range)) {
      return { disabledReason: 'Bản tin đa nguồn đọc tối đa 50 dòng trong một vùng ô A1. Hãy chọn vùng nhỏ hơn.' };
    }

    let sheetId: number;
    let tabPrefix: string;
    if (!requested.tab && existingTab) {
      sheetId = existingTab.sheetId;
      tabPrefix = existingTab.range.slice(0, existingTab.range.lastIndexOf('!'));
    } else {
      if (!requested.tab) return { disabledReason: CHOOSE_TAB };
      const tabs = await adapter.execute('sheets.list_sheets', {
        spreadsheetId: workbook.id, query: requested.tab, exactMatch: true, limit: 2,
      }, { signal });
      const matching = Array.isArray(tabs)
        ? tabs.filter((tab) => validSheetId(tab?.id) && tab.spreadsheetId === workbook.id &&
            typeof tab.title === 'string' && tab.title.toLowerCase() === requested.tab?.toLowerCase())
        : [];
      if (matching.length !== 1) return { disabledReason: CHOOSE_TAB };
      sheetId = matching[0].id;
      tabPrefix = quoteSheetTitle(matching[0].title);
      if (existingTab && existingTab.range.startsWith(tabPrefix + '!') && sheetId !== existingTab.sheetId) {
        return { disabledReason: ORG_SHEETS_DIGEST_REAPPROVAL };
      }
    }
    const range = tabPrefix + '!' + requested.range;
    return {
      ...source,
      args: { spreadsheetId: workbook.id, sheetId, range },
      label: workbook.title + ' · ' + range,
    };
  } catch {
    return { disabledReason: 'Chưa xác minh được bảng tính và tab trong phạm vi Bảng tính nhóm. Hãy kiểm tra kết nối rồi thử lại.' };
  }
}
