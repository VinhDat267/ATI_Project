import { BaseAdapter, StepError, type BaseAdapterConfig } from '../base-adapter.js';
import { GlobalRateLimiter } from '../rate-limiter.js';
import { GoogleServiceAccount, type GoogleServiceAccountCredentials } from '../google/service-account.js';
import { SHEETS_MAX_CELL_CHARS, SHEETS_MAX_COLUMNS, clipText } from '../bounds.js';

export interface SheetsAdapterConfig extends BaseAdapterConfig {
  credentials: GoogleServiceAccountCredentials;
  fetchFn?: typeof fetch;
}
export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const apiBase = 'https://sheets.googleapis.com/v4/spreadsheets/';
const spreadsheetPattern = /^[A-Za-z0-9_-]{20,}$/;
const sharedLimiter = new GlobalRateLimiter({ maxRequests: 60, windowMs: 60_000 });
function invalid(message: string): never { throw new StepError({ message: 'Sheets ' + message, category: 'VALIDATION' }); }
const badResponse = (writing = false): never => { throw new StepError({ message: 'Sheets returned an invalid response', category: writing ? 'UNKNOWN' : 'SERVER_ERROR' }); };
function bounded(value: unknown, max: number): number {
  if (value === undefined) return max;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) invalid('limit is outside its allowed range');
  return value;
}
function queryText(value: unknown): string {
  if (typeof value !== 'string') invalid('query must be a string');
  return value.trim().toLowerCase();
}
function a1(value: unknown): string {
  // Only cell addresses in this document. Quoted titles use doubled apostrophes.
  if (typeof value !== 'string' || value.length > 200 ||
    !/^(?:(?:'(?:[^'\[\]\/?#\u0000-\u001f]|'')*'|[\p{L}\p{N}_ -]+)!)?[A-Za-z]{1,3}[1-9]\d*(?::[A-Za-z]{1,3}[1-9]\d*)?$/u.test(value)) invalid('range must be a local A1 cell range');
  return value;
}
function titleText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 100 || /[\[\]:*?/\\\u0000-\u001f]/.test(value)) invalid('tab title is invalid');
  return value;
}
function safeRows(value: unknown): string[][] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20 || value.some(row =>
    !Array.isArray(row) || row.length < 1 || row.length > 20 || row.some(cell => typeof cell !== 'string' || cell.length > 1000))) invalid('rows exceed the allowed shape or size');
  return value.map(row => row.map((cell: string) => /^\s*[=+\-@]/u.test(cell) ? "'" + cell : cell));
}

/** Fixed Sheets v4 endpoints and allowlist. Only a definite 429 permits one write retry. */
export class SheetsAdapter extends BaseAdapter {
  readonly service = 'sheets';
  private readonly auth: GoogleServiceAccount;
  private readonly fetchFn: typeof fetch;
  private readonly account: string;
  constructor(config: SheetsAdapterConfig) {
    super(config);
    this.account = config.credentials.clientEmail;
    this.fetchFn = config.fetchFn ?? globalThis.fetch;
    this.auth = new GoogleServiceAccount({ credentials: config.credentials, fetchFn: this.fetchFn });
  }

  private allowedSpreadsheets(): string[] {
    const ids = this.allowedScope?.spreadsheets;
    if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string' || !spreadsheetPattern.test(id))) {
      throw new StepError({ message: 'Sheets requires an explicit spreadsheet allowlist', category: 'AUTH_ERROR', statusCode: 403 });
    }
    return [...new Set(ids)];
  }
  private checkedId(value: unknown): string {
    if (typeof value !== 'string' || !spreadsheetPattern.test(value)) invalid('spreadsheetId is invalid');
    this.allowedSpreadsheets();
    this.assertAllowedScope('spreadsheets', value);
    return value;
  }
  private async request(path: string, signal?: AbortSignal, body?: unknown): Promise<any> {
    if (signal?.aborted) throw new StepError({ message: 'Sheets request cancelled before dispatch', category: 'NETWORK' });
    const writing = body !== undefined;
    const token = await this.auth.getAccessToken(SHEETS_SCOPE, signal);
    let response: Response;
    let rateRetries = 0; let networkRetries = 0; let serverRetries = 0;
    for (;;) {
      try { await this.waitForTransportSlot(this.rateLimiter ?? sharedLimiter, 'sheets:' + this.account, signal); }
      catch (error) {
        // The limiter message carries its key (the service-account email); keep only the category.
        if (error instanceof StepError) throw new StepError({ message: 'Sheets request stopped before dispatch', category: error.category, statusCode: error.statusCode, retryable: error.retryable });
        throw new StepError({ message: 'Sheets request cancelled before dispatch', category: 'NETWORK' });
      }
      if (signal?.aborted) throw new StepError({ message: 'Sheets request cancelled before dispatch', category: 'NETWORK' });
      try {
        response = await this.fetchFn(apiBase + path, {
          method: writing ? 'POST' : 'GET', signal, redirect: 'error',
          headers: { Authorization: 'Bearer ' + token, ...(writing ? { 'Content-Type': 'application/json' } : {}) },
          ...(writing ? { body: JSON.stringify(body) } : {}),
        });
      } catch {
        if (!writing && !signal?.aborted && networkRetries < 2) { networkRetries++; continue; }
        throw new StepError({ message: 'Sheets transport failed', category: writing ? 'UNKNOWN' : 'NETWORK', retryable: !writing });
      }
      if (response.status === 429 && rateRetries === 0) {
        rateRetries++;
        try { await this.waitForRetryAfter(response.headers.get('Retry-After'), signal); }
        catch { throw new StepError({ message: 'Sheets rate-limit retry cancelled', category: 'RATE_LIMIT', statusCode: 429, retryable: false }); }
        continue;
      }
      if (!writing && response.status >= 500 && serverRetries === 0) { serverRetries++; continue; }
      break;
    }
    if (!response.ok) {
      const status = response.status;
      const category = status === 401 || status === 403 ? 'AUTH_ERROR' : status === 404 ? 'NOT_FOUND'
        : status === 429 ? 'RATE_LIMIT' : status >= 400 && status < 500 ? 'VALIDATION' : writing ? 'UNKNOWN' : 'SERVER_ERROR';
      throw new StepError({ message: 'Sheets request failed with HTTP ' + status, category, statusCode: status, retryable: !writing && (status === 429 || status >= 500) });
    }
    try { return await response.json(); } catch { return badResponse(writing); }
  }

  /** Lightweight read used by the connection transport. */
  async checkConnection(signal?: AbortSignal): Promise<boolean> {
    const id = this.allowedSpreadsheets()[0]!;
    const value = await this.request(id + '?fields=properties.title', signal);
    return typeof value?.properties?.title === 'string';
  }
  async execute(toolName: string, args: Record<string, any>, context?: { signal?: AbortSignal }): Promise<any> {
    const signal = context?.signal;
    if (toolName === 'sheets.list_spreadsheets') {
      const query = queryText(args.query); const limit = bounded(args.limit, 10);
      const matches = [];
      for (const id of this.allowedSpreadsheets()) {
        this.assertAllowedScope('spreadsheets', id);
        const value = await this.request(id + '?fields=properties.title', signal);
        if (typeof value?.properties?.title !== 'string') badResponse();
        if (value.properties.title.toLowerCase().includes(query)) matches.push({ id, title: value.properties.title, url: this.url(id) });
        if (matches.length >= limit) break;
      }
      return matches;
    }
    if (toolName === 'sheets.list_sheets') {
      const id = this.checkedId(args.spreadsheetId); const query = queryText(args.query); const limit = bounded(args.limit, 10);
      return (await this.tabs(id, signal)).filter(tab => tab.title.toLowerCase().includes(query)).slice(0, limit);
    }
    if (toolName === 'sheets.read_range') {
      const id = this.checkedId(args.spreadsheetId); const range = a1(args.range); const limit = bounded(args.limit, 50);
      const value = await this.request(id + '/values/' + encodeURIComponent(range), signal);
      if (typeof value?.range !== 'string' || (value.values !== undefined && (!Array.isArray(value.values) || value.values.some((row: unknown) => !Array.isArray(row))))) badResponse();
      let truncated = false;
      const values = (value.values ?? []).slice(0, limit).map((row: unknown[]) => {
        if (row.length > SHEETS_MAX_COLUMNS) truncated = true;
        return row.slice(0, SHEETS_MAX_COLUMNS).map(cell => {
          const clipped = clipText(cell == null ? '' : String(cell), SHEETS_MAX_CELL_CHARS);
          if (clipped.clipped) truncated = true;
          return clipped.text;
        });
      });
      return { range: value.range, values, ...(truncated ? { truncated: true } : {}) };
    }
    if (toolName === 'sheets.append_rows') {
      const id = this.checkedId(args.spreadsheetId); const sheet = titleText(args.sheet); const rows = safeRows(args.rows);
      const tabs = await this.tabs(id, signal);
      if (!tabs.some(tab => tab.title === sheet)) throw new StepError({ message: 'Sheets tab not found in the allowed spreadsheet', category: 'NOT_FOUND', statusCode: 404 });
      const range = "'" + sheet.replaceAll("'", "''") + "'!A1";
      const value = await this.request(id + '/values/' + encodeURIComponent(range) + ':append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS', signal, { majorDimension: 'ROWS', values: rows });
      if (value?.spreadsheetId !== id || typeof value.updates?.updatedRange !== 'string' || !Number.isInteger(value.updates?.updatedRows) || value.updates.updatedRows < 0) badResponse(true);
      return { spreadsheetId: id, updatedRange: value.updates.updatedRange, updatedRows: value.updates.updatedRows, url: this.url(id) };
    }
    return invalid('tool is unsupported');
  }
  private url(id: string): string { return 'https://docs.google.com/spreadsheets/d/' + id + '/edit'; }
  private async tabs(id: string, signal?: AbortSignal): Promise<Array<{ id: number; title: string; spreadsheetId: string }>> {
    const value = await this.request(id + '?fields=' + encodeURIComponent('sheets.properties(sheetId,title)'), signal);
    if (!Array.isArray(value?.sheets) || value.sheets.some((tab: any) => !Number.isSafeInteger(tab.properties?.sheetId) || typeof tab.properties?.title !== 'string')) badResponse();
    return value.sheets.map((tab: any) => ({ id: tab.properties.sheetId, title: tab.properties.title, spreadsheetId: id }));
  }
}
