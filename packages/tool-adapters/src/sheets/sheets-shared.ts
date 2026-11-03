import { StepError } from '../base-adapter.js';
import { SHEETS_MAX_CELL_CHARS, clipText } from '../bounds.js';
import { GlobalRateLimiter } from '../rate-limiter.js';

export const spreadsheetPattern = /^[A-Za-z0-9_-]{20,}$/;
export const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets/';
export const sharedLimiter = new GlobalRateLimiter({ maxRequests: 60, windowMs: 60_000 });

export function invalid(message: string): never {
  throw new StepError({ message: 'Sheets ' + message, category: 'VALIDATION' });
}

export const badResponse = (writing = false): never => {
  throw new StepError({
    message: 'Sheets returned an invalid response',
    category: writing ? 'UNKNOWN' : 'SERVER_ERROR',
  });
};

export function bounded(value: unknown, max: number): number {
  if (value === undefined) return max;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
    invalid('limit is outside its allowed range');
  }
  return value;
}

export function queryText(value: unknown): string {
  if (typeof value !== 'string') invalid('query must be a string');
  return value.trim().toLowerCase();
}

const STANDARD_A1_RE =
  /^(?:(?:'(?:[^'\[\]\/?#\u0000-\u001f]|'')*'|[\p{L}\p{N}_ -]+)!)?[A-Za-z]{1,3}[1-9]\d*(?::[A-Za-z]{1,3}[1-9]\d*)?$/u;
const SHEET_TITLE_TOKEN_RE = /^(?:'(?:[^'\[\]\/?#\u0000-\u001f]|'')*'|[\p{L}\p{N}_ -]+)$/u;
const CELL_COORD_RE = /^[A-Za-z]{1,3}[1-9]\d*(?::[A-Za-z]{1,3}[1-9]\d*)?$/;
const COL_RANGE_RE = /^([A-Za-z]{1,3}):([A-Za-z]{1,3})$/;
const TAIL_SPEC_RE = /^tail:([1-9]\d*)$/i;

export function a1(value: unknown): string {
  // Only cell addresses in this document. Quoted titles use doubled apostrophes.
  if (
    typeof value !== 'string' ||
    value.length > 200 ||
    !STANDARD_A1_RE.test(value)
  ) {
    invalid('range must be a local A1 cell range');
  }
  return value;
}

export interface ResolvedReadRange {
  apiRange: string;
  isTail: boolean;
  tailCount?: number;
  headerAware: boolean;
}

function formatSheetPrefix(rawSheet: string): string {
  if (!rawSheet) return '';
  if (rawSheet.startsWith("'")) return rawSheet + '!';
  if (/\s/.test(rawSheet)) return "'" + rawSheet.replaceAll("'", "''") + "'!";
  return rawSheet + '!';
}

export function resolveReadRange(
  value: unknown,
  options?: { limit?: number; tail?: unknown; headerAware?: unknown }
): ResolvedReadRange {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 200 ||
    /[\[\]\/\\?#\u0000-\u001f]/.test(value)
  ) {
    invalid('range must be a local A1 cell range');
  }

  let tailCount: number | undefined;
  if (options?.tail !== undefined) {
    if (
      typeof options.tail !== 'number' ||
      !Number.isInteger(options.tail) ||
      options.tail < 1 ||
      options.tail > 50
    ) {
      invalid('tail is outside its allowed range');
    }
    tailCount = options.tail;
  }
  if (options?.headerAware !== undefined && typeof options.headerAware !== 'boolean') {
    invalid('headerAware must be a boolean');
  }
  const headerAwareOpt = options?.headerAware === true;

  if (STANDARD_A1_RE.test(value) && tailCount === undefined) {
    return {
      apiRange: value,
      isTail: false,
      headerAware: headerAwareOpt,
    };
  }

  const bangIdx = value.indexOf('!');
  let rawSheet = '';
  let spec = '';

  if (bangIdx !== -1) {
    rawSheet = value.slice(0, bangIdx);
    spec = value.slice(bangIdx + 1);
    if (!rawSheet || !SHEET_TITLE_TOKEN_RE.test(rawSheet) || spec.includes('!')) {
      invalid('range must be a local A1 cell range');
    }
  } else if (TAIL_SPEC_RE.test(value) || COL_RANGE_RE.test(value) || CELL_COORD_RE.test(value)) {
    rawSheet = '';
    spec = value;
  } else if (SHEET_TITLE_TOKEN_RE.test(value)) {
    rawSheet = value;
    spec = '';
  } else {
    invalid('range must be a local A1 cell range');
  }

  const sheetPrefix = formatSheetPrefix(rawSheet);
  const maxRow = options?.limit ?? 50;

  if (spec === '') {
    if (tailCount !== undefined) {
      return {
        apiRange: `${sheetPrefix}A1:Z500`,
        isTail: true,
        tailCount,
        headerAware: options?.headerAware !== false,
      };
    }
    return {
      apiRange: `${sheetPrefix}A1:Z${maxRow}`,
      isTail: false,
      headerAware: headerAwareOpt,
    };
  }

  const tailMatch = TAIL_SPEC_RE.exec(spec);
  if (tailMatch) {
    const n = Number(tailMatch[1]);
    if (!Number.isInteger(n) || n < 1 || n > 50) {
      invalid('range must be a local A1 cell range');
    }
    return {
      apiRange: `${sheetPrefix}A1:Z500`,
      isTail: true,
      tailCount: n,
      headerAware: options?.headerAware !== false,
    };
  }

  const colMatch = COL_RANGE_RE.exec(spec);
  if (colMatch) {
    const [, colStart, colEnd] = colMatch;
    if (tailCount !== undefined) {
      return {
        apiRange: `${sheetPrefix}${colStart}1:${colEnd}500`,
        isTail: true,
        tailCount,
        headerAware: options?.headerAware !== false,
      };
    }
    return {
      apiRange: `${sheetPrefix}${colStart}1:${colEnd}${maxRow}`,
      isTail: false,
      headerAware: headerAwareOpt,
    };
  }

  if (CELL_COORD_RE.test(spec) && tailCount !== undefined) {
    return {
      apiRange: `${sheetPrefix}${spec}`,
      isTail: true,
      tailCount,
      headerAware: options?.headerAware !== false,
    };
  }

  invalid('range must be a local A1 cell range');
}

export function applySmartReadTransform(
  range: string,
  rawRows: string[][],
  resolved: ResolvedReadRange,
  limit: number,
  truncated: boolean
): {
  range: string;
  values: string[][];
  truncated?: boolean;
  headers?: string[];
  records?: Array<Record<string, string>>;
  totalDataRows?: number;
} {
  if (!resolved.isTail && !resolved.headerAware) {
    return {
      range,
      values: rawRows.slice(0, limit),
      ...(truncated ? { truncated: true } : {}),
    };
  }

  // Drop trailing completely empty rows when slicing tail or building records
  const nonEmptyRows = [...rawRows];
  while (
    nonEmptyRows.length > 0 &&
    nonEmptyRows[nonEmptyRows.length - 1]!.every((cell) => cell.trim() === '')
  ) {
    nonEmptyRows.pop();
  }

  if (nonEmptyRows.length === 0) {
    return {
      range,
      values: [],
      ...(truncated ? { truncated: true } : {}),
      ...(resolved.headerAware ? { headers: [], records: [], totalDataRows: 0 } : {}),
    };
  }

  if (resolved.headerAware && nonEmptyRows.length >= 1) {
    const headerRow = nonEmptyRows[0]!;
    const headers = headerRow.map((h, idx) => {
      const trimmed = h.trim();
      return trimmed || `col_${idx + 1}`;
    });
    const allDataRows = nonEmptyRows.slice(1);
    const totalDataRows = allDataRows.length;
    const selectedDataRows =
      resolved.isTail && resolved.tailCount !== undefined
        ? allDataRows.slice(-Math.min(resolved.tailCount, limit))
        : allDataRows.slice(0, Math.max(0, limit - 1));

    const records = selectedDataRows.map((row) => {
      const record: Record<string, string> = {};
      for (let i = 0; i < headers.length; i++) {
        record[headers[i]!] = row[i] ?? '';
      }
      return record;
    });

    return {
      range,
      values: [headerRow, ...selectedDataRows],
      ...(truncated ? { truncated: true } : {}),
      headers,
      records,
      totalDataRows,
    };
  }

  const sliced =
    resolved.isTail && resolved.tailCount !== undefined
      ? nonEmptyRows.slice(-Math.min(resolved.tailCount, limit))
      : nonEmptyRows.slice(0, limit);

  return {
    range,
    values: sliced,
    ...(truncated ? { truncated: true } : {}),
  };
}

export function titleText(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 100 ||
    /[\[\]:*?/\\\u0000-\u001f]/.test(value)
  ) {
    invalid('tab title is invalid');
  }
  return value;
}

export function validateRawRows(value: unknown): string[][] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 20 ||
    value.some(
      (row) =>
        !Array.isArray(row) ||
        row.length < 1 ||
        row.length > 20 ||
        row.some((cell) => typeof cell !== 'string' || cell.length > 1000)
    )
  ) {
    invalid('rows exceed the allowed shape or size');
  }
  return value as string[][];
}

export function safeRows(value: unknown): string[][] {
  const validated = validateRawRows(value);
  return validated.map((row) =>
    row.map((cell: string) => (/^\s*[=+\-@]/u.test(cell) ? "'" + cell : cell))
  );
}

const EXTERNAL_SYNC_KEY_RE =
  /^(?:(?:GH|ISSUE|PR)#\d+|[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+|\[?[A-Z][A-Z0-9_]{1,9}-\d+\]?|https:\/\/(?:github\.com|trello\.com|[\w.-]+\.atlassian\.net|mail\.google\.com)\/\S+)$/i;

export interface DeduplicationPolicy {
  enabled: boolean;
  keyColumns: number[] | null;
  onDuplicate: 'skip' | 'update';
}

export function extractTabHeaders(tab: any): string[] {
  if (Array.isArray(tab?.headers)) {
    const cleaned = tab.headers
      .slice(0, 26)
      .map((h: unknown) => (h == null ? '' : String(h).trim()))
      .filter((h: string) => h.length > 0);
    if (cleaned.length > 0) return cleaned;
  }
  const rowValues = tab?.data?.[0]?.rowData?.[0]?.values;
  if (Array.isArray(rowValues)) {
    const raw = rowValues
      .slice(0, 26)
      .map((cell: any) =>
        typeof cell?.formattedValue === 'string'
          ? cell.formattedValue.trim()
          : typeof cell?.userEnteredValue?.stringValue === 'string'
            ? cell.userEnteredValue.stringValue.trim()
            : ''
      );
    while (raw.length > 0 && raw[raw.length - 1] === '') {
      raw.pop();
    }
    if (raw.some((h: string) => h.length > 0)) {
      return raw.map((h: string, idx: number) => h || `col_${idx + 1}`);
    }
  }
  return [];
}

export function resolveDeduplicationPolicy(
  rawRows: string[][],
  args: Record<string, unknown>,
  headers: string[] = []
): DeduplicationPolicy {
  if (args.deduplicate !== undefined && typeof args.deduplicate !== 'boolean') {
    invalid('deduplicate must be a boolean');
  }
  if (
    args.onDuplicate !== undefined &&
    args.onDuplicate !== 'skip' &&
    args.onDuplicate !== 'update'
  ) {
    invalid('onDuplicate must be skip or update');
  }
  const onDuplicate: 'skip' | 'update' = args.onDuplicate === 'update' ? 'update' : 'skip';

  if (args.deduplicate === false && args.onDuplicate !== 'update' && args.keyColumn === undefined) {
    return { enabled: false, keyColumns: null, onDuplicate: 'skip' };
  }

  if (args.keyColumn !== undefined) {
    if (typeof args.keyColumn !== 'string' || !args.keyColumn.trim() || args.keyColumn.length > 100) {
      invalid('keyColumn must be a non-empty string up to 100 characters');
    }
    const keyIdx = resolveSheetColumnIndex(args.keyColumn, headers);
    return { enabled: true, keyColumns: [keyIdx], onDuplicate };
  }

  if (args.deduplicateColumn !== undefined) {
    if (
      typeof args.deduplicateColumn !== 'number' ||
      !Number.isInteger(args.deduplicateColumn) ||
      args.deduplicateColumn < 0 ||
      args.deduplicateColumn > 19
    ) {
      invalid('deduplicateColumn is outside its allowed range');
    }
    return { enabled: true, keyColumns: [args.deduplicateColumn], onDuplicate };
  }

  if (args.deduplicateColumns !== undefined) {
    if (
      !Array.isArray(args.deduplicateColumns) ||
      args.deduplicateColumns.length < 1 ||
      args.deduplicateColumns.length > 20 ||
      args.deduplicateColumns.some(
        (col) => typeof col !== 'number' || !Number.isInteger(col) || col < 0 || col > 19
      )
    ) {
      invalid('deduplicateColumns is outside its allowed range');
    }
    return { enabled: true, keyColumns: [...new Set(args.deduplicateColumns as number[])], onDuplicate };
  }

  if (args.onDuplicate === 'update') {
    return { enabled: true, keyColumns: [0], onDuplicate: 'update' };
  }

  if (args.deduplicate === true) {
    return { enabled: true, keyColumns: null, onDuplicate };
  }

  // Auto-detect external sync keys (GitHub #123, JIRA-101, Trello/GitHub URL) in column 0
  const allHaveSyncKey =
    rawRows.length > 0 &&
    rawRows.every((row) => {
      const firstCell = (row[0] ?? '').trim();
      return firstCell.length > 0 && EXTERNAL_SYNC_KEY_RE.test(firstCell);
    });

  if (allHaveSyncKey) {
    return { enabled: true, keyColumns: [0], onDuplicate };
  }

  return { enabled: false, keyColumns: null, onDuplicate: 'skip' };
}

export function normalizeCellForDedup(cell: unknown): string {
  const str = cell == null ? '' : String(cell);
  const unescaped = /^'\s*[=+\-@]/u.test(str) ? str.slice(1) : str;
  return unescaped.trim();
}

export function buildRowDedupSignature(row: unknown[], keyColumns: number[] | null): string {
  if (keyColumns && keyColumns.length > 0) {
    return keyColumns.map((idx) => normalizeCellForDedup(row[idx])).join('\u001f');
  }
  const normalized = row.map((c) => normalizeCellForDedup(c));
  while (normalized.length > 0 && normalized[normalized.length - 1] === '') {
    normalized.pop();
  }
  return normalized.join('\u001f');
}

export function filterDuplicateRows(
  incomingRows: string[][],
  existingRows: unknown[][],
  keyColumns: number[] | null,
  onDuplicate: 'skip' | 'update' = 'skip'
): {
  newRows: string[][];
  updates: Array<{ rowNumber: number; row: string[] }>;
  skippedDuplicates: number;
} {
  const existingRowMap = new Map<string, { rowNumber: number; fullSig: string }>();
  for (let i = 1; i < existingRows.length; i++) {
    const existing = existingRows[i];
    if (!Array.isArray(existing)) continue;
    const sig = buildRowDedupSignature(existing, keyColumns);
    if (sig) {
      existingRowMap.set(sig, {
        rowNumber: i + 1,
        fullSig: buildRowDedupSignature(existing, null),
      });
    }
  }

  const seenNew = new Set<string>();
  const newRows: string[][] = [];
  const updatesByRow = new Map<number, string[]>();
  let skippedDuplicates = 0;

  for (const row of incomingRows) {
    const sig = buildRowDedupSignature(row, keyColumns);
    const existingMatch = sig ? existingRowMap.get(sig) : undefined;
    if (existingMatch) {
      const incomingFullSig = buildRowDedupSignature(row, null);
      if (onDuplicate === 'update' && incomingFullSig !== existingMatch.fullSig) {
        updatesByRow.set(existingMatch.rowNumber, row);
      } else {
        skippedDuplicates++;
      }
      continue;
    }
    if (sig && seenNew.has(sig)) {
      skippedDuplicates++;
      continue;
    }
    if (sig) seenNew.add(sig);
    newRows.push(row);
  }

  const updates = [...updatesByRow.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rowNumber, row]) => ({ rowNumber, row }));

  return { newRows, updates, skippedDuplicates };
}

export function normalizeSpreadsheetIdInput(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 512) return null;
  const urlMatch =
    /^https:\/\/docs\.google\.com\/spreadsheets\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{1,128})(?:\/|[?#]|$)/.exec(
      trimmed
    );
  if (urlMatch) return urlMatch[1]!;
  if (/^[A-Za-z0-9_-]{1,128}$/.test(trimmed)) return trimmed;
  return null;
}

export function spreadsheetUrl(id: string): string {
  return 'https://docs.google.com/spreadsheets/d/' + id + '/edit';
}

export function resolveSheetColumnIndex(colSpec: string, headers: string[]): number {
  const trimmed = colSpec.trim();
  if (!trimmed) invalid('column name is empty');
  const lower = trimmed.toLowerCase();

  // 1. Exact header match (case-insensitive)
  const exactIdx = headers.findIndex((h) => h.trim().toLowerCase() === lower);
  if (exactIdx !== -1) return exactIdx;

  // 2. Single letter A..Z column coordinate
  if (/^[A-Za-z]$/.test(trimmed)) {
    return trimmed.toUpperCase().charCodeAt(0) - 65;
  }

  // 3. Normalized match (diacritic-insensitive)
  const norm = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, 'd')
      .toLowerCase()
      .trim();
  const normTarget = norm(trimmed);
  const normIdx = headers.findIndex((h) => norm(h) === normTarget);
  if (normIdx !== -1) return normIdx;

  const partialIdx = headers.findIndex((h) => {
    const nh = norm(h);
    return nh.length > 0 && (nh.includes(normTarget) || normTarget.includes(nh));
  });
  if (partialIdx !== -1) return partialIdx;

  invalid(`column "${trimmed}" not found in sheet headers`);
}

export function columnIndexToLetter(colIdx: number): string {
  if (!Number.isInteger(colIdx) || colIdx < 0 || colIdx > 25) {
    invalid('column index is outside A..Z');
  }
  return String.fromCharCode(65 + colIdx);
}

export function mapRecordsToRows(records: unknown, headers: string[]): string[][] {
  if (!Array.isArray(records) || records.length < 1 || records.length > 20) {
    invalid('records must be an array of 1..20 objects');
  }
  if (headers.length === 0) {
    invalid('sheet has no header row in row 1 to map records');
  }

  const mapped: string[][] = [];
  for (const item of records) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      invalid('each record must be an object');
    }
    const entries = Object.entries(item as Record<string, unknown>);
    if (entries.length < 1 || entries.length > 20) {
      invalid('each record must contain between 1 and 20 fields');
    }
    const placements: Array<{ colIdx: number; value: string }> = [];
    let maxColIdx = headers.length - 1;
    for (const [colSpec, rawVal] of entries) {
      if (typeof rawVal !== 'string' || rawVal.length > 1000) {
        invalid('record field value must be a string up to 1000 characters');
      }
      const colIdx = resolveSheetColumnIndex(colSpec, headers);
      if (colIdx > 19) {
        invalid('record column index exceeds the 20-column limit');
      }
      if (colIdx > maxColIdx) maxColIdx = colIdx;
      placements.push({ colIdx, value: rawVal });
    }
    const rowWidth = Math.min(20, Math.max(1, maxColIdx + 1));
    const row = Array.from({ length: rowWidth }, () => '');
    for (const p of placements) {
      row[p.colIdx] = p.value;
    }
    mapped.push(row);
  }
  return mapped;
}

export function parseSheetNumber(raw: string): number | null {
  const hasVnCurrency = /(?:vnđ|vnd|đ|₫)/iu.test(raw);
  const cleaned = raw
    .replace(/(?:vnđ|vnd|usd|đ|₫|\$|€|%)/giu, '')
    .trim();
  if (!cleaned) return null;
  if (
    /^-?[1-9]\d{0,2}(?:\.\d{3}){2,}(?:,\d+)?$/.test(cleaned) ||
    /^-?[1-9]\d{0,2}(?:\.\d{3})+,\d+$/.test(cleaned) ||
    (hasVnCurrency && /^-?[1-9]\d{0,2}(?:\.\d{3})+$/.test(cleaned))
  ) {
    const normalized = cleaned.replaceAll('.', '').replace(',', '.');
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
  }
  if (/^-?[1-9]\d{0,2}(?:,\d{3})+(?:\.\d+)?$/.test(cleaned)) {
    const normalized = cleaned.replaceAll(',', '');
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
  }
  if (/^-?\d+,\d+$/.test(cleaned)) {
    const n = Number(cleaned.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  if (/^-?\d+(?:\.\d+)?$/.test(cleaned)) {
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function parseSheetDateMs(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const dmyMatch = /^(0?[1-9]|[12]\d|3[01])\/(0?[1-9]|1[0-2])\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(trimmed);
  if (dmyMatch) {
    const day = Number(dmyMatch[1]);
    const month = Number(dmyMatch[2]);
    const year = Number(dmyMatch[3]);
    const hour = dmyMatch[4] ? Number(dmyMatch[4]) : 0;
    const minute = dmyMatch[5] ? Number(dmyMatch[5]) : 0;
    return Date.UTC(year, month - 1, day, hour, minute);
  }
  const ymdOnly = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.exec(trimmed);
  if (ymdOnly) {
    return Date.UTC(Number(ymdOnly[1]), Number(ymdOnly[2]) - 1, Number(ymdOnly[3]));
  }
  if (/^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}/.test(trimmed)) {
    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

export type SheetFilterOperator =
  | 'contains'
  | 'equals'
  | 'not_equals'
  | 'empty'
  | 'not_empty'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte';

const ALLOWED_FILTER_OPS = new Set<string>([
  'contains',
  'equals',
  'not_equals',
  'empty',
  'not_empty',
  'gt',
  'gte',
  'lt',
  'lte',
]);

export function matchesSheetCondition(
  rawCell: string,
  op: SheetFilterOperator,
  rawTarget: string
): boolean {
  const trimmedCell = rawCell.trim();
  const cellLower = trimmedCell.toLowerCase();
  const targetTrimmed = rawTarget.trim();
  const targetLower = targetTrimmed.toLowerCase();

  if (op === 'empty') return trimmedCell === '';
  if (op === 'not_empty') return trimmedCell !== '';
  if (op === 'contains') return cellLower.includes(targetLower);

  if (op === 'equals' || op === 'not_equals') {
    let isEq = cellLower === targetLower;
    if (!isEq && trimmedCell && targetTrimmed) {
      const cellDate = parseSheetDateMs(trimmedCell);
      const targetDate = parseSheetDateMs(targetTrimmed);
      if (cellDate !== null && targetDate !== null) {
        isEq = cellDate === targetDate;
      } else {
        const cellNum = parseSheetNumber(trimmedCell);
        const targetNum = parseSheetNumber(targetTrimmed);
        if (cellNum !== null && targetNum !== null) {
          isEq = cellNum === targetNum;
        }
      }
    }
    return op === 'equals' ? isEq : !isEq;
  }

  if (!trimmedCell || !targetTrimmed) return false;

  const cellDate = parseSheetDateMs(trimmedCell);
  const targetDate = parseSheetDateMs(targetTrimmed);
  if (cellDate !== null && targetDate !== null) {
    if (op === 'gt') return cellDate > targetDate;
    if (op === 'gte') return cellDate >= targetDate;
    if (op === 'lt') return cellDate < targetDate;
    if (op === 'lte') return cellDate <= targetDate;
  }

  const cellNum = parseSheetNumber(trimmedCell);
  const targetNum = parseSheetNumber(targetTrimmed);
  if (cellNum !== null && targetNum !== null) {
    if (op === 'gt') return cellNum > targetNum;
    if (op === 'gte') return cellNum >= targetNum;
    if (op === 'lt') return cellNum < targetNum;
    if (op === 'lte') return cellNum <= targetNum;
  }

  const cmp = cellLower.localeCompare(targetLower);
  if (op === 'gt') return cmp > 0;
  if (op === 'gte') return cmp >= 0;
  if (op === 'lt') return cmp < 0;
  return cmp <= 0;
}

export function filterSearchedRows(
  sheet: string,
  rawRows: string[][],
  args: Record<string, unknown>,
  limit: number,
  initialTruncated = false
): {
  sheet: string;
  headers: string[];
  totalMatched: number;
  matches: Array<{ rowNumber: number; values: string[]; record: Record<string, string> }>;
  truncated?: boolean;
} {
  if (args.query !== undefined && (typeof args.query !== 'string' || args.query.length > 200)) {
    invalid('query must be a string up to 200 characters');
  }
  if (args.column !== undefined && (typeof args.column !== 'string' || !args.column.trim() || args.column.length > 100)) {
    invalid('column must be a non-empty string');
  }
  if (args.operator !== undefined && (typeof args.operator !== 'string' || !ALLOWED_FILTER_OPS.has(args.operator))) {
    invalid('operator is invalid');
  }
  if (args.value !== undefined && (typeof args.value !== 'string' || args.value.length > 500)) {
    invalid('value must be a string up to 500 characters');
  }

  let truncated = initialTruncated;
  const headerRow = rawRows[0] ?? [];
  const headers = headerRow.map((h, idx) => {
    const rawH = h.trim() || `col_${idx + 1}`;
    const clippedH = clipText(rawH, SHEETS_MAX_CELL_CHARS);
    if (clippedH.clipped) truncated = true;
    return clippedH.text;
  });

  const resolvedConditions: Array<{
    colIdx: number;
    op: SheetFilterOperator;
    value: string;
  }> = [];

  if (typeof args.column === 'string') {
    const colIdx = resolveSheetColumnIndex(args.column, headers);
    const op = (typeof args.operator === 'string' ? args.operator : 'contains') as SheetFilterOperator;
    const val = typeof args.value === 'string' ? args.value : '';
    resolvedConditions.push({ colIdx, op, value: val });
  }

  if (args.filters !== undefined) {
    if (!Array.isArray(args.filters) || args.filters.length < 1 || args.filters.length > 10) {
      invalid('filters must be an array of 1..10 conditions');
    }
    for (const cond of args.filters) {
      if (!cond || typeof cond !== 'object' || Array.isArray(cond)) {
        invalid('filter condition must be an object');
      }
      const c = cond as Record<string, unknown>;
      if (typeof c.column !== 'string' || !c.column.trim() || c.column.length > 100) {
        invalid('filter column must be a non-empty string');
      }
      if (c.operator !== undefined && (typeof c.operator !== 'string' || !ALLOWED_FILTER_OPS.has(c.operator))) {
        invalid('filter operator is invalid');
      }
      if (c.value !== undefined && (typeof c.value !== 'string' || c.value.length > 500)) {
        invalid('filter value must be a string up to 500 characters');
      }
      resolvedConditions.push({
        colIdx: resolveSheetColumnIndex(c.column, headers),
        op: (typeof c.operator === 'string' ? c.operator : 'contains') as SheetFilterOperator,
        value: typeof c.value === 'string' ? c.value : '',
      });
    }
  }

  const queryLower = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';

  const allMatches: Array<{ rowNumber: number; rawValues: string[] }> = [];
  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i] ?? [];
    if (row.every((c) => c.trim() === '')) continue;

    if (queryLower) {
      const hasQuery = row.some((c) => c.toLowerCase().includes(queryLower));
      if (!hasQuery) continue;
    }

    let allCondsPass = true;
    for (const cond of resolvedConditions) {
      const rawCell = row[cond.colIdx] ?? '';
      if (!matchesSheetCondition(rawCell, cond.op, cond.value)) {
        allCondsPass = false;
        break;
      }
    }
    if (!allCondsPass) continue;

    allMatches.push({
      rowNumber: i + 1,
      rawValues: row,
    });
  }

  const matches = allMatches.slice(0, limit).map(({ rowNumber, rawValues }) => {
    const clippedValues = rawValues.map((c) => {
      const clipped = clipText(c, SHEETS_MAX_CELL_CHARS);
      if (clipped.clipped) truncated = true;
      return clipped.text;
    });
    const record: Record<string, string> = {};
    const maxCols = Math.max(headers.length, clippedValues.length);
    for (let c = 0; c < maxCols; c++) {
      const key = headers[c] || `col_${c + 1}`;
      record[key] = clippedValues[c] ?? '';
    }
    return {
      rowNumber,
      values: clippedValues,
      record,
    };
  });

  return {
    sheet,
    headers,
    totalMatched: allMatches.length,
    matches,
    ...(truncated ? { truncated: true } : {}),
  };
}

export function computeSheetAggregation(
  sheet: string,
  rawRows: string[][],
  args: Record<string, unknown>
): {
  sheet: string;
  totalRowsScanned: number;
  matchedRows: number;
  groups: Array<{ key: string; count: number; metrics: Record<string, number> }>;
  totals: Record<string, number>;
} {
  const nonEmptyDataRows = rawRows.slice(1).filter((r) => r.some((c) => c.trim() !== ''));
  const searched = filterSearchedRows(
    sheet,
    rawRows,
    {
      ...(args.query !== undefined ? { query: args.query } : {}),
      ...(args.column !== undefined ? { column: args.column } : {}),
      ...(args.operator !== undefined ? { operator: args.operator } : {}),
      ...(args.value !== undefined ? { value: args.value } : {}),
      ...(args.filters !== undefined ? { filters: args.filters } : {}),
    },
    500
  );

  const headers = searched.headers;
  let groupByIdx: number | null = null;
  if (args.groupBy !== undefined) {
    if (typeof args.groupBy !== 'string' || !args.groupBy.trim() || args.groupBy.length > 100) {
      invalid('groupBy must be a non-empty string');
    }
    groupByIdx = resolveSheetColumnIndex(args.groupBy, headers);
  }

  const allowedFns = new Set(['sum', 'avg', 'min', 'max', 'count']);
  const metricSpecs: Array<{ colIdx: number; colName: string; fn: 'sum' | 'avg' | 'min' | 'max' | 'count' }> = [];
  if (args.metrics !== undefined) {
    if (!Array.isArray(args.metrics) || args.metrics.length < 1 || args.metrics.length > 10) {
      invalid('metrics must be an array of 1..10 items');
    }
    for (const m of args.metrics) {
      if (!m || typeof m !== 'object' || Array.isArray(m)) {
        invalid('metric item must be an object');
      }
      const item = m as Record<string, unknown>;
      if (typeof item.column !== 'string' || !item.column.trim()) {
        invalid('metric column must be a non-empty string');
      }
      if (typeof item.fn !== 'string' || !allowedFns.has(item.fn)) {
        invalid('metric fn must be sum, avg, min, max, or count');
      }
      const colIdx = resolveSheetColumnIndex(item.column, headers);
      metricSpecs.push({
        colIdx,
        colName: headers[colIdx] || item.column.trim(),
        fn: item.fn as 'sum' | 'avg' | 'min' | 'max' | 'count',
      });
    }
  }

  const computeMetricsForRows = (rows: Array<{ values: string[] }>): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const spec of metricSpecs) {
      const key = `${spec.colName}_${spec.fn}`;
      if (spec.fn === 'count') {
        out[key] = rows.filter((r) => (r.values[spec.colIdx] ?? '').trim() !== '').length;
        continue;
      }
      const nums: number[] = [];
      for (const r of rows) {
        const parsed = parseSheetNumber(r.values[spec.colIdx] ?? '');
        if (parsed !== null) nums.push(parsed);
      }
      if (nums.length === 0) {
        out[key] = 0;
        continue;
      }
      const sum = nums.reduce((acc, v) => acc + v, 0);
      if (spec.fn === 'sum') out[key] = Number(sum.toFixed(2));
      else if (spec.fn === 'avg') out[key] = Number((sum / nums.length).toFixed(2));
      else if (spec.fn === 'min') out[key] = Math.min(...nums);
      else if (spec.fn === 'max') out[key] = Math.max(...nums);
    }
    return out;
  };

  const groupsMap = new Map<string, Array<{ values: string[] }>>();
  for (const match of searched.matches) {
    const gKey =
      groupByIdx !== null ? (match.values[groupByIdx] ?? '').trim() || '(Trống)' : 'Tất cả';
    const bucket = groupsMap.get(gKey) ?? [];
    bucket.push(match);
    groupsMap.set(gKey, bucket);
  }

  const groups = [...groupsMap.entries()].map(([key, bucket]) => ({
    key,
    count: bucket.length,
    metrics: computeMetricsForRows(bucket),
  }));

  return {
    sheet,
    totalRowsScanned: nonEmptyDataRows.length,
    matchedRows: searched.matches.length,
    groups,
    totals: computeMetricsForRows(searched.matches),
  };
}

export function buildDeleteRowRequests(
  sheetId: number,
  existingRows: unknown[][],
  args: Record<string, unknown>
): {
  deletedRowNumbers: number[];
  requests: Array<{
    deleteDimension: {
      range: { sheetId: number; dimension: 'ROWS'; startIndex: number; endIndex: number };
    };
  }>;
} {
  const hasRowNumbers = args.rowNumbers !== undefined;
  const hasMatchCol = typeof args.matchColumn === 'string' && args.matchColumn.trim().length > 0;
  const hasMatchVal = typeof args.matchValue === 'string' && args.matchValue.trim().length > 0;

  if (!hasRowNumbers && (!hasMatchCol || !hasMatchVal)) {
    invalid('delete_rows requires either rowNumbers or matchColumn + matchValue');
  }
  if (hasRowNumbers && (args.matchColumn !== undefined || args.matchValue !== undefined)) {
    invalid('delete_rows accepts either rowNumbers or matchColumn + matchValue, not both');
  }

  const targetRowSet = new Set<number>();

  if (hasRowNumbers) {
    if (
      !Array.isArray(args.rowNumbers) ||
      args.rowNumbers.length < 1 ||
      args.rowNumbers.length > 20 ||
      args.rowNumbers.some(
        (n) => typeof n !== 'number' || !Number.isInteger(n) || n < 2 || n > 500
      )
    ) {
      invalid('rowNumbers must be an array of 1..20 integers between 2 and 500 (row 1 header cannot be deleted)');
    }
    for (const n of args.rowNumbers as number[]) {
      targetRowSet.add(n);
    }
  }

  if (hasMatchCol && hasMatchVal) {
    const headerRow = Array.isArray(existingRows[0])
      ? existingRows[0].map((c) => (c == null ? '' : String(c).trim()))
      : [];
    const colIdx = resolveSheetColumnIndex(args.matchColumn as string, headerRow);
    const needle = normalizeCellForDedup(args.matchValue).toLowerCase();
    for (let i = 1; i < existingRows.length; i++) {
      if (targetRowSet.size >= 20) break;
      const row = existingRows[i];
      if (!Array.isArray(row)) continue;
      if (normalizeCellForDedup(row[colIdx]).toLowerCase() === needle) {
        targetRowSet.add(i + 1);
        if (targetRowSet.size >= 20) break;
      }
    }
  }

  const deletedRowNumbers = [...targetRowSet].sort((a, b) => a - b);
  const requests = [...deletedRowNumbers]
    .sort((a, b) => b - a)
    .map((rowNumber) => ({
      deleteDimension: {
        range: {
          sheetId,
          dimension: 'ROWS' as const,
          startIndex: rowNumber - 1,
          endIndex: rowNumber,
        },
      },
    }));

  return { deletedRowNumbers, requests };
}

export function buildPartialCellUpdates(
  quotedSheet: string,
  existingRows: unknown[][],
  rawUpdates: unknown
): {
  batchData: Array<{ range: string; majorDimension: 'ROWS'; values: string[][] }>;
  updatedRowsCount: number;
  unmatchedKeys: string[];
} {
  if (!Array.isArray(rawUpdates) || rawUpdates.length < 1 || rawUpdates.length > 20) {
    invalid('updates must be an array of 1..20 items');
  }
  const headerRow = Array.isArray(existingRows[0])
    ? existingRows[0].map((c) => (c == null ? '' : String(c).trim()))
    : [];

  const batchData: Array<{ range: string; majorDimension: 'ROWS'; values: string[][] }> = [];
  const updatedRowSet = new Set<number>();
  const unmatchedKeys: string[] = [];

  for (const item of rawUpdates) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      invalid('update item must be an object');
    }
    const u = item as Record<string, unknown>;
    const hasRowNumber = u.rowNumber !== undefined;
    const hasMatchCol = typeof u.matchColumn === 'string' && u.matchColumn.trim().length > 0;
    const hasMatchVal = typeof u.matchValue === 'string' && u.matchValue.trim().length > 0;

    if (!hasRowNumber && (!hasMatchCol || !hasMatchVal)) {
      invalid('each update requires either rowNumber or matchColumn + matchValue');
    }
    if (
      hasRowNumber &&
      (typeof u.rowNumber !== 'number' || !Number.isInteger(u.rowNumber) || u.rowNumber < 2 || u.rowNumber > 500)
    ) {
      invalid('rowNumber must be an integer between 2 and 500');
    }

    if (!u.values || typeof u.values !== 'object' || Array.isArray(u.values)) {
      invalid('values must be a non-empty object mapping column names to string values');
    }
    const entries = Object.entries(u.values as Record<string, unknown>);
    if (entries.length < 1 || entries.length > 20) {
      invalid('values must contain between 1 and 20 column updates');
    }
    for (const [k, v] of entries) {
      if (!k.trim() || typeof v !== 'string' || v.length > 1000) {
        invalid('column update value must be a string up to 1000 characters');
      }
    }

    let targetRows: number[] = [];
    if (hasRowNumber) {
      targetRows = [u.rowNumber as number];
    } else {
      const matchColIdx = resolveSheetColumnIndex(u.matchColumn as string, headerRow);
      const needle = normalizeCellForDedup(u.matchValue).toLowerCase();
      for (let i = 1; i < existingRows.length; i++) {
        const row = existingRows[i];
        if (!Array.isArray(row)) continue;
        if (normalizeCellForDedup(row[matchColIdx]).toLowerCase() === needle) {
          targetRows.push(i + 1);
        }
      }
      if (targetRows.length === 0) {
        unmatchedKeys.push(`${String(u.matchColumn).trim()}=${String(u.matchValue).trim()}`);
        continue;
      }
    }

    for (const rowNumber of targetRows) {
      updatedRowSet.add(rowNumber);
      for (const [colSpec, rawVal] of entries) {
        const colIdx = resolveSheetColumnIndex(colSpec, headerRow);
        const colLetter = columnIndexToLetter(colIdx);
        const sanitizedCell = safeRows([[rawVal as string]])[0]![0]!;
        batchData.push({
          range: `${quotedSheet}!${colLetter}${rowNumber}`,
          majorDimension: 'ROWS',
          values: [[sanitizedCell]],
        });
      }
    }
  }

  return {
    batchData,
    updatedRowsCount: updatedRowSet.size,
    unmatchedKeys,
  };
}
