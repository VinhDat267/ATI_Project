import { StepError } from '../base-adapter.js';
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
}

export function resolveDeduplicationPolicy(
  rawRows: string[][],
  args: Record<string, unknown>
): DeduplicationPolicy {
  if (args.deduplicate !== undefined && typeof args.deduplicate !== 'boolean') {
    invalid('deduplicate must be a boolean');
  }
  if (args.deduplicate === false) {
    return { enabled: false, keyColumns: null };
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
    return { enabled: true, keyColumns: [args.deduplicateColumn] };
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
    return { enabled: true, keyColumns: [...new Set(args.deduplicateColumns as number[])] };
  }

  if (args.deduplicate === true) {
    return { enabled: true, keyColumns: null };
  }

  // Auto-detect external sync keys (GitHub #123, JIRA-101, Trello/GitHub URL) in column 0
  const allHaveSyncKey =
    rawRows.length > 0 &&
    rawRows.every((row) => {
      const firstCell = (row[0] ?? '').trim();
      return firstCell.length > 0 && EXTERNAL_SYNC_KEY_RE.test(firstCell);
    });

  if (allHaveSyncKey) {
    return { enabled: true, keyColumns: [0] };
  }

  return { enabled: false, keyColumns: null };
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
  keyColumns: number[] | null
): { newRows: string[][]; skippedDuplicates: number } {
  const seen = new Set<string>();
  for (const existing of existingRows) {
    if (!Array.isArray(existing)) continue;
    const sig = buildRowDedupSignature(existing, keyColumns);
    if (sig) seen.add(sig);
  }

  const newRows: string[][] = [];
  let skippedDuplicates = 0;
  for (const row of incomingRows) {
    const sig = buildRowDedupSignature(row, keyColumns);
    if (sig && seen.has(sig)) {
      skippedDuplicates++;
      continue;
    }
    if (sig) seen.add(sig);
    newRows.push(row);
  }

  return { newRows, skippedDuplicates };
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
