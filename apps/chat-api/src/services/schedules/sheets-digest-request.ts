import { extractPromptDigestRange, extractSheetTabFromPrompt } from './sheets-digest-candidate.js';

export const CHOOSE_SPREADSHEET =
  'Hãy ghi rõ tên hoặc ID một bảng tính đã chọn, hoặc yêu cầu báo cáo tất cả bảng tính đã chọn.';
const ALL_SPREADSHEETS_RE =
  /(?:tất\s+cả\s+(?:các\s+)?bảng\s+tính|toàn\s+bộ\s+(?:các\s+)?bảng\s+tính|all\s+(?:selected\s+)?spreadsheets)/iu;
const WORKBOOK_REFERENCE_RE =
  /(?:^|(?<=[^\p{L}\p{N}_]))(?:bảng\s+tính|spreadsheet|google\s+sheets?|file|tệp)\s+(?!(?:và|and|cùng|kèm|lên|trên|qua|sang|vào|to|gửi|mỗi|sáng|chiều|hôm|tab|trang\s+tính|vùng|range|ô|cell)(?=$|[^\p{L}\p{N}_]))(?:["“]([^"”\n]+)["”]|['‘]([^'’\n]+)['’]|([^\n]+?)(?=\s+(?:tab|sheet|worksheet|trang\s+tính|vùng|range|ô|cell|và\s+(?:trello|github|jira|calendar|lịch|gmail|bảng\s+tính|tab|sheet|worksheet|trang\s+tính)|and\s+(?:trello|github|jira|calendar|gmail|spreadsheet|tab|sheet|worksheet|trang\s+tính)|cùng|kèm|lên|qua|sang|vào|gửi|to|mỗi|sáng|chiều|hôm)(?=$|[^\p{L}\p{N}_])|[(),;!?\n]|$))/giu;
const GENERIC_WORKBOOK_RE = /^(?:google\s+sheets?(?:\s+cá\s+nhân)?|cá\s+nhân|của\s+(?:tôi|bạn)|đã\s+(?:chọn|cấp\s+quyền)|được\s+phép)$/iu;
const SPREADSHEET_URL_ID_RE = /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/g;
const SCOPED_SPREADSHEET_URL_RE = /\/spreadsheets\/d\/[A-Za-z0-9_-]+[^\s]*[?&#](?:gid|range)=/iu;
const EXCLUDED_WORKBOOK_RE = /(?:^|[^\p{L}\p{N}_])(?:trừ|except|exclude|không\s+lấy)\s+/iu;
const TAB_KEYWORD_RE = /(?:^|[^\p{L}\p{N}_])(?:tab|sheet|worksheet|trang\s+tính)\s+(?=[\p{L}\p{N}"'“‘])/giu;
const CHOOSE_TAB = 'Hãy chỉ định một tab duy nhất cho vùng ô của bản tin Google Sheets.';

function workbookReferences(request: string, organization = false): string[] {
  return Array.from(request.matchAll(WORKBOOK_REFERENCE_RE), (match) =>
    (match[1] ?? match[2] ?? match[3] ?? '').trim()
  ).filter((reference) => reference && !GENERIC_WORKBOOK_RE.test(reference) &&
    !(organization && /^(?:nhóm|tổ chức)$/iu.test(reference)));
}

export function orgSheetsWorkbookLookup(request: string):
  { query: string; spreadsheetId?: string } | { ambiguous: true } | undefined {
  const link = [...request.matchAll(SPREADSHEET_URL_ID_RE)][0];
  if (link) return { query: '', spreadsheetId: link[1]! };
  const name = workbookReferences(request, true)[0];
  if (name) return { query: name };
  const bareIds = [...new Set(request.match(/(?<![\w-])[A-Za-z0-9_-]{20,}(?![\w-])/gu))];
  if (bareIds.length > 1) return { ambiguous: true };
  return bareIds[0] ? { query: '', spreadsheetId: bareIds[0] } : undefined;
}

export function parseSheetsDigestRequest(
  requestText: string,
  selected: string[],
  spreadsheets: ReadonlyArray<{ id: string; title: string }> | undefined,
  options?: { organization?: boolean },
): {
  requestedId?: string;
  allRequested: boolean;
  range?: string;
  tab?: string;
} | { disabledReason: string } {
  if (SCOPED_SPREADSHEET_URL_RE.test(requestText)) {
    return { disabledReason: 'Hãy dùng tên hoặc ID bảng tính và ghi rõ tên tab, vùng ô trong yêu cầu thay cho liên kết có mã tab hoặc vùng ô.' };
  }

  const references = workbookReferences(requestText, options?.organization);
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
    const titleMatches = spreadsheets?.filter((item) =>
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
  const tabText = scopeText.replace(/\$?[A-Z]{1,3}\$?\d+\s*:\s*\$?[A-Z]{1,3}\$?\d+/giu, '');
  const tabFromPrompt = extractSheetTabFromPrompt(tabText, tabText.toLowerCase(), undefined, { keywordOnly: true });
  const unsupportedCoordinates = /(?<![\p{L}\p{N}_#/-])(?:\$?[A-Z]{1,3}\$?[1-9]\d*|\$?[A-Z]{1,3}\s*:\s*\$?[A-Z]{1,3}|\d+\s*:\s*\d+)(?![\p{L}\p{N}_/-])/iu;
  // Avoid treating an explicit tab name or the schedule time as a cell address.
  const namedTab = range.sheetFromRange ?? tabFromPrompt;
  const remainingText = namedTab ? tabText.replace(namedTab, '') : tabText;
  const remainingCells = remainingText.replace(/\b\d{1,2}:\d{2}\b/g, '');
  if (options?.organization && unsupportedCoordinates.test(remainingCells)) {
    return { disabledReason: 'Hãy dùng một vùng ô A1 hữu hạn, ví dụ B2:B2 hoặc A1:C10.' };
  }
  if (Array.from(scopeText.matchAll(TAB_KEYWORD_RE)).length > 1 ||
    (tabFromPrompt && range.sheetFromRange && tabFromPrompt.toLowerCase() !== range.sheetFromRange.toLowerCase())) {
    return { disabledReason: CHOOSE_TAB };
  }

  return {
    requestedId: [...requestedIds][0],
    allRequested,
    range: range.canonicalRange,
    tab: range.sheetFromRange ?? tabFromPrompt,
  };
}
