import { BaseAdapter, StepError, type BaseAdapterConfig } from '../base-adapter.js';
import type { GmailAccessTokenProvider } from '../gmail/token-provider.js';
import { SHEETS_MAX_CELL_CHARS, SHEETS_MAX_COLUMNS, clipText } from '../bounds.js';
import {
  a1,
  applySmartReadTransform,
  badResponse,
  bounded,
  filterDuplicateRows,
  invalid,
  queryText,
  resolveDeduplicationPolicy,
  resolveReadRange,
  safeRows,
  sharedLimiter,
  SHEETS_API_BASE,
  spreadsheetPattern,
  spreadsheetUrl,
  titleText,
  validateRawRows,
} from './sheets-shared.js';

export interface PersonalSheetsAdapterConfig extends BaseAdapterConfig {
  userId: string;
  tokens: GmailAccessTokenProvider;
  apiBaseUrl?: string;
  fetchFn?: typeof fetch;
}

/**
 * Personal Google Sheets v4 adapter (OAuth 2.0 user credentials via drive.file scope);
 * explicit spreadsheet allowlist; indeterminate writes are never replayed.
 */
export class PersonalSheetsAdapter extends BaseAdapter {
  readonly service = 'mysheets';
  private readonly userId: string;
  private readonly tokens: GmailAccessTokenProvider;
  private readonly apiBase: string;
  private readonly fetchFn: typeof fetch;

  constructor(config: PersonalSheetsAdapterConfig) {
    super(config);
    if (!config.userId || typeof config.userId !== 'string') {
      throw new StepError({ message: 'PersonalSheetsAdapter requires a userId', category: 'VALIDATION' });
    }
    if (!config.tokens || typeof config.tokens.getAccessToken !== 'function') {
      throw new StepError({ message: 'PersonalSheetsAdapter requires a tokens provider', category: 'VALIDATION' });
    }
    this.userId = config.userId;
    this.tokens = config.tokens;
    const rawBase = config.apiBaseUrl ?? SHEETS_API_BASE;
    this.apiBase = rawBase.includes('/v4/spreadsheets')
      ? rawBase.replace(/\/+$/, '') + '/'
      : `${rawBase.replace(/\/+$/, '')}/v4/spreadsheets/`;
    this.fetchFn = config.fetchFn ?? globalThis.fetch;
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

  private async request(
    path: string,
    signal?: AbortSignal,
    body?: unknown,
    onDispatch?: (dispatched: boolean) => void
  ): Promise<any> {
    if (signal?.aborted) throw new StepError({ message: 'Sheets request cancelled before dispatch', category: 'NETWORK' });
    const writing = body !== undefined;
    let networkRetries = 0;
    let serverRetries = 0;
    let rateRetries = 0;
    let refreshed = false;
    let forceRefresh = false;

    for (;;) {
      if (signal?.aborted) throw new StepError({ message: 'Sheets request cancelled before dispatch', category: 'NETWORK' });
      try {
        await this.waitForTransportSlot(this.rateLimiter ?? sharedLimiter, 'mysheets:' + this.userId, signal);
      } catch (error) {
        throw new StepError({
          message: 'Sheets request stopped before dispatch',
          category: error instanceof StepError ? error.category : 'NETWORK',
        });
      }
      if (signal?.aborted) throw new StepError({ message: 'Sheets request cancelled before dispatch', category: 'NETWORK' });

      const token = await this.tokens.getAccessToken({ signal, ...(forceRefresh ? { forceRefresh: true } : {}) });
      forceRefresh = false;

      if (signal?.aborted) throw new StepError({ message: 'Sheets request cancelled before dispatch', category: 'NETWORK' });

      let response: Response;
      try {
        if (writing) onDispatch?.(true);
        response = await this.fetchFn(this.apiBase + path, {
          method: writing ? 'POST' : 'GET',
          signal,
          redirect: 'error',
          headers: {
            Authorization: 'Bearer ' + token,
            ...(writing ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(writing ? { body: JSON.stringify(body) } : {}),
        });
      } catch {
        if (!writing && !signal?.aborted && networkRetries++ < 2) continue;
        throw new StepError({
          message: 'Sheets transport failed',
          category: writing ? 'UNKNOWN' : 'NETWORK',
          retryable: !writing,
        });
      }

      if (response.status === 401 && !refreshed) {
        refreshed = true;
        forceRefresh = true;
        if (writing) onDispatch?.(false);
        continue;
      }

      if (response.status === 429 && rateRetries++ === 0) {
        try {
          await this.waitForRetryAfter(response.headers.get('Retry-After'), signal);
        } catch {
          throw new StepError({
            message: 'Sheets rate-limit retry cancelled',
            category: 'RATE_LIMIT',
            statusCode: 429,
            retryable: false,
          });
        }
        if (writing) onDispatch?.(false);
        continue;
      }

      if (!writing && response.status >= 500 && serverRetries++ === 0) continue;

      if (!response.ok) {
        const status = response.status;
        const category =
          status === 401 || status === 403
            ? 'AUTH_ERROR'
            : status === 404
            ? 'NOT_FOUND'
            : status === 429
            ? 'RATE_LIMIT'
            : status >= 400 && status < 500
            ? 'VALIDATION'
            : writing
            ? 'UNKNOWN'
            : 'SERVER_ERROR';

        throw new StepError({
          message: 'Sheets request failed with HTTP ' + status,
          category,
          statusCode: status,
          retryable: !writing && (status === 429 || status >= 500),
          ...(writing && status === 401 ? { details: { requestSent: false } } : {}),
        });
      }

      try {
        return await response.json();
      } catch {
        return badResponse(writing);
      }
    }
  }

  async checkConnection(signal?: AbortSignal): Promise<boolean> {
    const id = this.allowedSpreadsheets()[0]!;
    this.assertAllowedScope('spreadsheets', id);
    const value = await this.request(id + '?fields=properties.title', signal);
    return typeof value?.properties?.title === 'string';
  }

  async execute(toolName: string, args: Record<string, any>, context?: { signal?: AbortSignal }): Promise<any> {
    const signal = context?.signal;
    const isWrite = toolName === 'mysheets.append_rows';
    let writeDispatched = false;

    try {
      if (toolName === 'mysheets.list_spreadsheets') {
        const query = queryText(args.query);
        const limit = bounded(args.limit, 10);
        const matches = [];
        for (const id of this.allowedSpreadsheets()) {
          this.assertAllowedScope('spreadsheets', id);
          const value = await this.request(id + '?fields=properties.title', signal);
          if (typeof value?.properties?.title !== 'string') badResponse();
          if (value.properties.title.toLowerCase().includes(query)) {
            matches.push({ id, title: value.properties.title, url: spreadsheetUrl(id) });
          }
          if (matches.length >= limit) break;
        }
        return matches;
      }

      if (toolName === 'mysheets.list_sheets') {
        const id = this.checkedId(args.spreadsheetId);
        const query = queryText(args.query);
        const limit = bounded(args.limit, 10);
        return (await this.tabs(id, signal)).filter(tab => tab.title.toLowerCase().includes(query)).slice(0, limit);
      }

      if (toolName === 'mysheets.read_range') {
        const id = this.checkedId(args.spreadsheetId);
        const limit = bounded(args.limit, 50);
        const resolved = resolveReadRange(args.range, { limit, tail: args.tail, headerAware: args.headerAware });
        const fetchLimit = resolved.isTail ? 500 : limit;
        const value = await this.request(id + '/values/' + encodeURIComponent(resolved.apiRange), signal);
        if (
          typeof value?.range !== 'string' ||
          (value.values !== undefined && (!Array.isArray(value.values) || value.values.some((row: unknown) => !Array.isArray(row))))
        ) {
          badResponse();
        }
        let truncated = false;
        const values = (value.values ?? []).slice(0, fetchLimit).map((row: unknown[]) => {
          if (row.length > SHEETS_MAX_COLUMNS) truncated = true;
          return row.slice(0, SHEETS_MAX_COLUMNS).map((cell) => {
            const clipped = clipText(cell == null ? '' : String(cell), SHEETS_MAX_CELL_CHARS);
            if (clipped.clipped) truncated = true;
            return clipped.text;
          });
        });
        return applySmartReadTransform(value.range, values, resolved, limit, truncated);
      }

      if (toolName === 'mysheets.append_rows') {
        const id = this.checkedId(args.spreadsheetId);
        const sheet = titleText(args.sheet);
        const rawRows = validateRawRows(args.rows);
        const dedupPolicy = resolveDeduplicationPolicy(rawRows, args);
        const tabs = await this.tabs(id, signal);
        if (!tabs.some(tab => tab.title === sheet)) {
          throw new StepError({ message: 'Sheets tab not found in the allowed spreadsheet', category: 'NOT_FOUND', statusCode: 404 });
        }
        const quotedSheet = /\s|'/.test(sheet) ? "'" + sheet.replaceAll("'", "''") + "'" : sheet;
        const range = "'" + sheet.replaceAll("'", "''") + "'!A1";
        let rowsToWrite = rawRows;
        let skippedDuplicates = 0;
        if (dedupPolicy.enabled) {
          const readRange = `${quotedSheet}!A1:Z500`;
          const existingData = await this.request(id + '/values/' + encodeURIComponent(readRange), signal);
          const existingRows = Array.isArray(existingData?.values) ? existingData.values : [];
          const filtered = filterDuplicateRows(rawRows, existingRows, dedupPolicy.keyColumns);
          rowsToWrite = filtered.newRows;
          skippedDuplicates = filtered.skippedDuplicates;
          if (rowsToWrite.length === 0) {
            return {
              spreadsheetId: id,
              updatedRange: `${quotedSheet}!A1`,
              updatedRows: 0,
              skippedDuplicates,
              url: spreadsheetUrl(id),
            };
          }
        }
        const rows = safeRows(rowsToWrite);
        const value = await this.request(
          id + '/values/' + encodeURIComponent(range) + ':append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS',
          signal,
          { majorDimension: 'ROWS', values: rows },
          (dispatched) => { writeDispatched = dispatched; }
        );
        if (
          value?.spreadsheetId !== id ||
          typeof value.updates?.updatedRange !== 'string' ||
          !Number.isInteger(value.updates?.updatedRows) ||
          value.updates.updatedRows < 0
        ) {
          badResponse(true);
        }
        return {
          spreadsheetId: id,
          updatedRange: value.updates.updatedRange,
          updatedRows: value.updates.updatedRows,
          ...(dedupPolicy.enabled ? { skippedDuplicates } : {}),
          url: spreadsheetUrl(id),
        };
      }

      return invalid('tool is unsupported');
    } catch (error) {
      const e = error instanceof StepError
        ? error
        : new StepError({
            message: error instanceof Error ? error.message : 'MySheets transport failed',
            category: isWrite && writeDispatched ? 'UNKNOWN' : 'NETWORK',
            retryable: false,
          });

      if (!isWrite) throw e;
      if (writeDispatched) {
        if (e.statusCode === 401) {
          throw new StepError({
            category: 'AUTH_ERROR',
            statusCode: 401,
            retryable: false,
            message: e.message,
            details: { requestSent: false },
          });
        }
        throw e;
      }
      throw new StepError({
        category: e.category,
        statusCode: e.statusCode,
        retryable: e.retryable,
        message: e.message,
        details: { requestSent: false },
      });
    }
  }

  private async tabs(id: string, signal?: AbortSignal): Promise<Array<{ id: number; title: string; spreadsheetId: string }>> {
    const value = await this.request(id + '?fields=' + encodeURIComponent('sheets.properties(sheetId,title)'), signal);
    if (
      !Array.isArray(value?.sheets) ||
      value.sheets.some((tab: any) => !Number.isSafeInteger(tab.properties?.sheetId) || typeof tab.properties?.title !== 'string')
    ) {
      badResponse();
    }
    return value.sheets.map((tab: any) => ({ id: tab.properties.sheetId, title: tab.properties.title, spreadsheetId: id }));
  }
}

export function createPersonalSheetsAdapter(config: PersonalSheetsAdapterConfig): PersonalSheetsAdapter {
  return new PersonalSheetsAdapter(config);
}
