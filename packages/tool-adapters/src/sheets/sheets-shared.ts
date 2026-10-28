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

export function a1(value: unknown): string {
  // Only cell addresses in this document. Quoted titles use doubled apostrophes.
  if (
    typeof value !== 'string' ||
    value.length > 200 ||
    !/^(?:(?:'(?:[^'\[\]\/?#\u0000-\u001f]|'')*'|[\p{L}\p{N}_ -]+)!)?[A-Za-z]{1,3}[1-9]\d*(?::[A-Za-z]{1,3}[1-9]\d*)?$/u.test(
      value
    )
  ) {
    invalid('range must be a local A1 cell range');
  }
  return value;
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

export function safeRows(value: unknown): string[][] {
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
  return value.map((row) =>
    row.map((cell: string) => (/^\s*[=+\-@]/u.test(cell) ? "'" + cell : cell))
  );
}

export function spreadsheetUrl(id: string): string {
  return 'https://docs.google.com/spreadsheets/d/' + id + '/edit';
}
