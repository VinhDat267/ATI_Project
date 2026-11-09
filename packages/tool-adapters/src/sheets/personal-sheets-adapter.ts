import { BaseAdapter, StepError, type BaseAdapterConfig } from '../base-adapter.js';
import type { GmailAccessTokenProvider } from '../gmail/token-provider.js';
import { SHEETS_MAX_CELL_CHARS, SHEETS_MAX_COLUMNS, clipText } from '../bounds.js';
import {
  a1,
  applySmartReadTransform,
  badResponse,
  bounded,
  buildDeleteRowRequests,
  buildPartialCellUpdates,
  computeSheetAggregation,
  extractTabHeaders,
  filterDuplicateRows,
  filterSearchedRows,
  invalid,
  mapRecordsToRows,
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
  /**
   * Server-owned Dual Kill-Switch flag for the 4 Drive/Docs write tools:
   * - mysheets.create_drive_folder
   * - mysheets.create_doc
   * - mysheets.append_doc_text
   * - mysheets.move_drive_file
   * Populated ONLY from server env/config, NEVER from HTTP request body, AdapterContext, persisted planJson, or step.args.
   * Defaults to false (Default OFF).
   */
  enableDriveWriteTools?: boolean;
}

export const MYSHEETS_DRIVE_READ_TOOLS: ReadonlySet<string> = new Set([
  'mysheets.list_drive_files',
  'mysheets.get_doc',
]);

export const MYSHEETS_DRIVE_WRITE_TOOLS: ReadonlySet<string> = new Set([
  'mysheets.create_drive_folder',
  'mysheets.create_doc',
  'mysheets.append_doc_text',
  'mysheets.move_drive_file',
]);

const DRIVE_API_DEFAULT_BASE = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_DEFAULT_BASE = 'https://www.googleapis.com/upload/drive/v3/files';
const DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]{10,128}$/;

function driveFileUrl(id: string, mimeType?: string): string {
  if (mimeType === 'application/vnd.google-apps.document') {
    return `https://docs.google.com/document/d/${id}/edit`;
  }
  if (mimeType === 'application/vnd.google-apps.spreadsheet') {
    return spreadsheetUrl(id);
  }
  if (mimeType === 'application/vnd.google-apps.folder') {
    return `https://drive.google.com/drive/folders/${id}`;
  }
  return `https://drive.google.com/file/d/${id}/view`;
}

/**
 * Personal Google Sheets v4 + Google Docs & Google Drive v3 adapter (OAuth 2.0 user credentials via drive.file scope);
 * explicit spreadsheet allowlist; indeterminate writes are never replayed.
 */
export class PersonalSheetsAdapter extends BaseAdapter {
  readonly service = 'mysheets';
  private readonly userId: string;
  private readonly tokens: GmailAccessTokenProvider;
  private readonly apiBase: string;
  private readonly driveApiBase: string;
  private readonly driveUploadBase: string;
  private readonly fetchFn: typeof fetch;
  private readonly enableDriveWriteTools: boolean;

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
    this.enableDriveWriteTools =
      typeof config.enableDriveWriteTools === 'boolean'
        ? config.enableDriveWriteTools
        : process.env.ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS === 'true' ||
          process.env.ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS === 'on';
    const rawBase = config.apiBaseUrl ?? SHEETS_API_BASE;
    this.apiBase = rawBase.includes('/v4/spreadsheets')
      ? rawBase.replace(/\/+$/, '') + '/'
      : `${rawBase.replace(/\/+$/, '')}/v4/spreadsheets/`;
    const host = config.apiBaseUrl
      ? config.apiBaseUrl.replace(/\/v4\/spreadsheets\/?$/, '').replace(/\/+$/, '')
      : '';
    if (host && host !== 'https://sheets.googleapis.com') {
      this.driveApiBase = `${host}/drive/v3/files`;
      this.driveUploadBase = `${host}/upload/drive/v3/files`;
    } else {
      this.driveApiBase = DRIVE_API_DEFAULT_BASE;
      this.driveUploadBase = DRIVE_UPLOAD_DEFAULT_BASE;
    }
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

  private checkedDriveId(value: unknown, fieldName: string): string {
    if (typeof value !== 'string' || !DRIVE_ID_PATTERN.test(value.trim())) {
      invalid(`${fieldName} is invalid`);
    }
    return value.trim();
  }

  private async driveRequest(
    options: {
      url: string;
      method?: 'GET' | 'POST' | 'PATCH';
      headers?: Record<string, string>;
      body?: string;
      responseType?: 'json' | 'text';
      writing?: boolean;
    },
    signal?: AbortSignal,
    onDispatch?: (dispatched: boolean) => void
  ): Promise<any> {
    if (signal?.aborted) throw new StepError({ message: 'Sheets request cancelled before dispatch', category: 'NETWORK' });
    const writing = Boolean(options.writing);
    const method = options.method ?? (writing ? 'POST' : 'GET');
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
        response = await this.fetchFn(options.url, {
          method,
          signal,
          redirect: 'error',
          headers: {
            Authorization: 'Bearer ' + token,
            ...(options.headers ?? {}),
          },
          ...(options.body !== undefined ? { body: options.body } : {}),
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
        if (options.responseType === 'text') {
          return await response.text();
        }
        return await response.json();
      } catch {
        return badResponse(writing);
      }
    }
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
    if (MYSHEETS_DRIVE_WRITE_TOOLS.has(toolName) && !this.enableDriveWriteTools) {
      throw new StepError({
        category: 'AUTH_ERROR',
        statusCode: 403,
        message: `Google Drive/Docs write tool '${toolName}' is disabled by server policy.`,
        retryable: false,
        details: {
          code: 'MYSHEETS_DRIVE_WRITE_DISABLED',
          tool: toolName,
          requestSent: false,
        },
      });
    }

    const signal = context?.signal;
    const isWrite =
      toolName === 'mysheets.append_rows' ||
      toolName === 'mysheets.update_rows' ||
      toolName === 'mysheets.delete_rows' ||
      toolName === 'mysheets.create_sheet' ||
      toolName === 'mysheets.create_drive_folder' ||
      toolName === 'mysheets.create_doc' ||
      toolName === 'mysheets.append_doc_text' ||
      toolName === 'mysheets.move_drive_file';
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
        return (await this.tabs(id, signal, true)).filter(tab => tab.title.toLowerCase().includes(query)).slice(0, limit);
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

      if (toolName === 'mysheets.search_rows') {
        const id = this.checkedId(args.spreadsheetId);
        const sheet = titleText(args.sheet);
        const limit = args.limit === undefined ? 20 : bounded(args.limit, 50);
        const tabs = await this.tabs(id, signal);
        if (!tabs.some((tab) => tab.title === sheet)) {
          throw new StepError({
            message: 'Sheets tab not found in the allowed spreadsheet',
            category: 'NOT_FOUND',
            statusCode: 404,
          });
        }
        const quotedSheet = /\s|'/.test(sheet) ? "'" + sheet.replaceAll("'", "''") + "'" : sheet;
        const readRange = `${quotedSheet}!A1:Z500`;
        const value = await this.request(id + '/values/' + encodeURIComponent(readRange), signal);
        const rawValues: unknown[][] = Array.isArray(value?.values) ? value.values : [];
        const rowTruncated =
          rawValues.length > 500 ||
          rawValues.slice(0, 500).some((r) => Array.isArray(r) && r.length > SHEETS_MAX_COLUMNS);
        const rawRows = rawValues.slice(0, 500).map((row: unknown[]) =>
          (Array.isArray(row) ? row : []).slice(0, SHEETS_MAX_COLUMNS).map((cell) =>
            cell == null ? '' : String(cell)
          )
        );
        return filterSearchedRows(sheet, rawRows, args, limit, rowTruncated);
      }

      if (toolName === 'mysheets.aggregate_rows') {
        const id = this.checkedId(args.spreadsheetId);
        const sheet = titleText(args.sheet);
        const tabs = await this.tabs(id, signal);
        if (!tabs.some((tab) => tab.title === sheet)) {
          throw new StepError({
            message: 'Sheets tab not found in the allowed spreadsheet',
            category: 'NOT_FOUND',
            statusCode: 404,
          });
        }
        const quotedSheet = /\s|'/.test(sheet) ? "'" + sheet.replaceAll("'", "''") + "'" : sheet;
        const readRange = `${quotedSheet}!A1:Z500`;
        const value = await this.request(id + '/values/' + encodeURIComponent(readRange), signal);
        const rawRows = (Array.isArray(value?.values) ? value.values : []).slice(0, 500).map((row: unknown[]) =>
          (Array.isArray(row) ? row : []).slice(0, SHEETS_MAX_COLUMNS).map((cell) =>
            cell == null ? '' : String(cell)
          )
        );
        return computeSheetAggregation(sheet, rawRows, args);
      }

      if (toolName === 'mysheets.append_rows') {
        const id = this.checkedId(args.spreadsheetId);
        const sheet = titleText(args.sheet);
        const needsHeaderLookup = args.records !== undefined || args.keyColumn !== undefined;
        let rawRows = needsHeaderLookup ? [] : validateRawRows(args.rows);
        if (!needsHeaderLookup) {
          resolveDeduplicationPolicy(rawRows, args);
        }
        const tabs = await this.tabs(id, signal);
        if (!tabs.some(tab => tab.title === sheet)) {
          throw new StepError({ message: 'Sheets tab not found in the allowed spreadsheet', category: 'NOT_FOUND', statusCode: 404 });
        }
        const quotedSheet = /\s|'/.test(sheet) ? "'" + sheet.replaceAll("'", "''") + "'" : sheet;
        const range = "'" + sheet.replaceAll("'", "''") + "'!A1";
        let existingRows: unknown[][] | undefined;
        let headers: string[] = [];
        if (needsHeaderLookup) {
          const readRange = `${quotedSheet}!A1:Z500`;
          const existingData = await this.request(id + '/values/' + encodeURIComponent(readRange), signal);
          const fetchedRows: unknown[][] = Array.isArray(existingData?.values) ? existingData.values : [];
          existingRows = fetchedRows;
          headers = Array.isArray(fetchedRows[0])
            ? fetchedRows[0].map((c) => (c == null ? '' : String(c).trim()))
            : [];
          rawRows = args.records !== undefined ? mapRecordsToRows(args.records, headers) : validateRawRows(args.rows);
        }
        const dedupPolicy = resolveDeduplicationPolicy(rawRows, args, headers);
        let rowsToWrite = rawRows;
        let skippedDuplicates = 0;
        let batchUpdatedRows = 0;
        let lastUpdatedRange = `${quotedSheet}!A1`;
        if (dedupPolicy.enabled) {
          if (!existingRows) {
            const readRange = `${quotedSheet}!A1:Z500`;
            const existingData = await this.request(id + '/values/' + encodeURIComponent(readRange), signal);
            existingRows = Array.isArray(existingData?.values) ? (existingData.values as unknown[][]) : [];
          }
          const filtered = filterDuplicateRows(rawRows, existingRows ?? [], dedupPolicy.keyColumns, dedupPolicy.onDuplicate);
          rowsToWrite = filtered.newRows;
          skippedDuplicates = filtered.skippedDuplicates;
          if (filtered.updates.length > 0) {
            const batchData = filtered.updates.map((u) => ({
              range: `${quotedSheet}!A${u.rowNumber}`,
              majorDimension: 'ROWS',
              values: safeRows([u.row]),
            }));
            const batchRes = await this.request(
              id + '/values:batchUpdate',
              signal,
              { valueInputOption: 'USER_ENTERED', data: batchData },
              (dispatched) => { writeDispatched = dispatched; }
            );
            const respRange = batchRes?.responses?.[batchRes.responses.length - 1]?.updatedRange;
            if (typeof respRange === 'string') lastUpdatedRange = respRange;
            batchUpdatedRows = Number.isInteger(batchRes?.totalUpdatedRows)
              ? batchRes.totalUpdatedRows
              : filtered.updates.length;
          }
          if (rowsToWrite.length === 0) {
            return {
              spreadsheetId: id,
              updatedRange: lastUpdatedRange,
              updatedRows: batchUpdatedRows,
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
          updatedRows: batchUpdatedRows + value.updates.updatedRows,
          ...(dedupPolicy.enabled ? { skippedDuplicates } : {}),
          url: spreadsheetUrl(id),
        };
      }

      if (toolName === 'mysheets.update_rows') {
        const id = this.checkedId(args.spreadsheetId);
        const sheet = titleText(args.sheet);
        const tabs = await this.tabs(id, signal);
        if (!tabs.some((tab) => tab.title === sheet)) {
          throw new StepError({
            message: 'Sheets tab not found in the allowed spreadsheet',
            category: 'NOT_FOUND',
            statusCode: 404,
          });
        }
        const quotedSheet = /\s|'/.test(sheet) ? "'" + sheet.replaceAll("'", "''") + "'" : sheet;
        const readRange = `${quotedSheet}!A1:Z500`;
        const existingData = await this.request(id + '/values/' + encodeURIComponent(readRange), signal);
        const existingRows = Array.isArray(existingData?.values) ? existingData.values : [];
        const { batchData, updatedRowsCount, unmatchedKeys } = buildPartialCellUpdates(
          quotedSheet,
          existingRows,
          args.updates
        );

        let lastUpdatedRange = `${quotedSheet}!A1`;
        if (batchData.length > 0) {
          const batchRes = await this.request(
            id + '/values:batchUpdate',
            signal,
            { valueInputOption: 'USER_ENTERED', data: batchData },
            (dispatched) => {
              writeDispatched = dispatched;
            }
          );
          const respRange = batchRes?.responses?.[batchRes.responses.length - 1]?.updatedRange;
          if (typeof respRange === 'string') {
            lastUpdatedRange = respRange;
          } else {
            lastUpdatedRange = batchData[batchData.length - 1]!.range;
          }
        }

        return {
          spreadsheetId: id,
          updatedRange: lastUpdatedRange,
          updatedRows: updatedRowsCount,
          updatedCells: batchData.length,
          ...(unmatchedKeys.length > 0 ? { unmatchedKeys } : {}),
          url: spreadsheetUrl(id),
        };
      }

      if (toolName === 'mysheets.delete_rows') {
        const id = this.checkedId(args.spreadsheetId);
        const sheet = titleText(args.sheet);
        if (args.rowNumbers !== undefined) {
          buildDeleteRowRequests(0, [], args);
        }
        const tabs = await this.tabs(id, signal);
        const matchedTab = tabs.find((tab) => tab.title === sheet);
        if (!matchedTab) {
          throw new StepError({
            message: 'Sheets tab not found in the allowed spreadsheet',
            category: 'NOT_FOUND',
            statusCode: 404,
          });
        }
        let existingRows: unknown[][] = [];
        if (typeof args.matchColumn === 'string' && args.matchColumn.trim().length > 0) {
          const quotedSheet = /\s|'/.test(sheet) ? "'" + sheet.replaceAll("'", "''") + "'" : sheet;
          const readRange = `${quotedSheet}!A1:Z500`;
          const existingData = await this.request(id + '/values/' + encodeURIComponent(readRange), signal);
          existingRows = Array.isArray(existingData?.values) ? existingData.values : [];
        }
        const { deletedRowNumbers, requests } = buildDeleteRowRequests(
          matchedTab.id,
          existingRows,
          args
        );
        if (requests.length > 0) {
          await this.request(
            id + ':batchUpdate',
            signal,
            { requests },
            (dispatched) => {
              writeDispatched = dispatched;
            }
          );
        }
        return {
          spreadsheetId: id,
          sheet,
          deletedRows: deletedRowNumbers.length,
          deletedRowNumbers,
          url: spreadsheetUrl(id),
        };
      }

      if (toolName === 'mysheets.create_sheet') {
        const id = this.checkedId(args.spreadsheetId);
        const title = titleText(args.title);
        let rawHeaders: string[] | undefined;
        if (args.headers !== undefined) {
          if (
            !Array.isArray(args.headers) ||
            args.headers.length < 1 ||
            args.headers.length > 20 ||
            args.headers.some((h: unknown) => typeof h !== 'string' || !h.trim() || h.length > 200)
          ) {
            invalid('headers must be an array of 1..20 non-empty strings');
          }
          rawHeaders = args.headers as string[];
        }

        const existingTabs = await this.tabs(id, signal, true);
        const existing = existingTabs.find((t) => t.title.toLowerCase() === title.toLowerCase());
        let sheetId: number;
        let actualTitle: string;

        if (existing) {
          sheetId = existing.id;
          actualTitle = existing.title;
        } else {
          const createRes = await this.request(
            id + ':batchUpdate',
            signal,
            { requests: [{ addSheet: { properties: { title } } }] },
            (dispatched) => {
              writeDispatched = dispatched;
            }
          );
          const props = createRes?.replies?.[0]?.addSheet?.properties;
          sheetId = Number.isSafeInteger(props?.sheetId) ? props.sheetId : 0;
          actualTitle = typeof props?.title === 'string' ? props.title : title;
        }

        let existingHeaders = existing?.headers && existing.headers.length > 0 ? existing.headers : undefined;
        if (existing && !existingHeaders) {
          const quotedExisting = /\s|'/.test(actualTitle) ? "'" + actualTitle.replaceAll("'", "''") + "'" : actualTitle;
          const row1Data = await this.request(
            id + '/values/' + encodeURIComponent(`${quotedExisting}!A1:Z1`),
            signal,
          );
          const row1 = Array.isArray(row1Data?.values?.[0]) ? row1Data.values[0] : [];
          const extracted = row1
            .slice(0, SHEETS_MAX_COLUMNS)
            .map((cell: unknown) => clipText(cell == null ? '' : String(cell).trim(), SHEETS_MAX_CELL_CHARS).text)
            .filter((cell: string) => cell.length > 0);
          if (extracted.length > 0) {
            existingHeaders = extracted;
          }
        }

        if (rawHeaders && (!existingHeaders || existingHeaders.length === 0)) {
          const quotedTitle = /\s|'/.test(actualTitle) ? "'" + actualTitle.replaceAll("'", "''") + "'" : actualTitle;
          await this.request(
            id + '/values:batchUpdate',
            signal,
            {
              valueInputOption: 'USER_ENTERED',
              data: [
                {
                  range: `${quotedTitle}!A1`,
                  majorDimension: 'ROWS',
                  values: safeRows([rawHeaders]),
                },
              ],
            },
            (dispatched) => {
              writeDispatched = dispatched;
            }
          );
        }

        const finalHeaders = existingHeaders && existingHeaders.length > 0 ? existingHeaders : rawHeaders;
        return {
          id: sheetId,
          title: actualTitle,
          spreadsheetId: id,
          ...(finalHeaders && finalHeaders.length > 0 ? { headers: finalHeaders } : {}),
          url: spreadsheetUrl(id),
        };
      }

      if (toolName === 'mysheets.list_drive_files') {
        if (args.query !== undefined && (typeof args.query !== 'string' || args.query.length > 100)) {
          invalid('query must be a string up to 100 chars');
        }
        const query = typeof args.query === 'string' ? args.query.trim() : '';
        const mimeTypeFilter = args.mimeType === undefined ? 'all' : args.mimeType;
        if (
          mimeTypeFilter !== 'doc' &&
          mimeTypeFilter !== 'sheet' &&
          mimeTypeFilter !== 'folder' &&
          mimeTypeFilter !== 'all'
        ) {
          invalid('mimeType must be doc, sheet, folder, or all');
        }
        const limit = bounded(args.limit, 20);
        const clauses: string[] = ['trashed = false'];
        if (mimeTypeFilter === 'doc') {
          clauses.push("mimeType = 'application/vnd.google-apps.document'");
        } else if (mimeTypeFilter === 'sheet') {
          clauses.push("mimeType = 'application/vnd.google-apps.spreadsheet'");
        } else if (mimeTypeFilter === 'folder') {
          clauses.push("mimeType = 'application/vnd.google-apps.folder'");
        }
        if (query) {
          const escaped = query.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
          clauses.push(`name contains '${escaped}'`);
        }
        const q = clauses.join(' and ');
        const res = await this.driveRequest(
          {
            url: `${this.driveApiBase}?q=${encodeURIComponent(q)}&pageSize=${limit}&fields=${encodeURIComponent('files(id,name,mimeType,webViewLink)')}`,
          },
          signal
        );
        if (!Array.isArray(res?.files)) badResponse();
        return res.files.slice(0, limit).map((f: any) => {
          const fileId = typeof f?.id === 'string' ? f.id : '';
          const fileName = typeof f?.name === 'string' ? f.name : '';
          const fileMime = typeof f?.mimeType === 'string' ? f.mimeType : '';
          if (!fileId) badResponse();
          return {
            id: fileId,
            title: fileName,
            mimeType: fileMime,
            url: typeof f?.webViewLink === 'string' && f.webViewLink ? f.webViewLink : driveFileUrl(fileId, fileMime),
          };
        });
      }

      if (toolName === 'mysheets.create_drive_folder') {
        if (typeof args.name !== 'string' || !args.name.trim() || args.name.length > 200) {
          invalid('name must be a non-empty string up to 200 chars');
        }
        const name = args.name.trim();
        const parentFolderId =
          args.parentFolderId !== undefined ? this.checkedDriveId(args.parentFolderId, 'parentFolderId') : undefined;
        const body = {
          name,
          mimeType: 'application/vnd.google-apps.folder',
          ...(parentFolderId ? { parents: [parentFolderId] } : {}),
        };
        const res = await this.driveRequest(
          {
            url: `${this.driveApiBase}?fields=${encodeURIComponent('id,name,mimeType,webViewLink')}`,
            method: 'POST',
            writing: true,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
          signal,
          (dispatched) => {
            writeDispatched = dispatched;
          }
        );
        if (typeof res?.id !== 'string' || !res.id) badResponse(true);
        return {
          id: res.id,
          title: typeof res.name === 'string' && res.name ? res.name : name,
          mimeType: 'application/vnd.google-apps.folder',
          url:
            typeof res.webViewLink === 'string' && res.webViewLink
              ? res.webViewLink
              : driveFileUrl(res.id, 'application/vnd.google-apps.folder'),
        };
      }

      if (toolName === 'mysheets.create_doc') {
        if (typeof args.title !== 'string' || !args.title.trim() || args.title.length > 200) {
          invalid('title must be a non-empty string up to 200 chars');
        }
        const title = args.title.trim();
        if (args.content !== undefined && (typeof args.content !== 'string' || args.content.length > 12000)) {
          invalid('content must be a string up to 12000 chars');
        }
        const content = typeof args.content === 'string' ? args.content : '';
        const folderId = args.folderId !== undefined ? this.checkedDriveId(args.folderId, 'folderId') : undefined;

        const boundary = '-------ati_doc_boundary_v3';
        const metadata = {
          name: title,
          mimeType: 'application/vnd.google-apps.document',
          ...(folderId ? { parents: [folderId] } : {}),
        };
        const multipartBody =
          `--${boundary}\r\n` +
          `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
          `${JSON.stringify(metadata)}\r\n` +
          `--${boundary}\r\n` +
          `Content-Type: text/plain; charset=UTF-8\r\n\r\n` +
          `${content}\r\n` +
          `--${boundary}--`;

        const res = await this.driveRequest(
          {
            url: `${this.driveUploadBase}?uploadType=multipart&fields=${encodeURIComponent('id,name,mimeType,webViewLink')}`,
            method: 'POST',
            writing: true,
            headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
            body: multipartBody,
          },
          signal,
          (dispatched) => {
            writeDispatched = dispatched;
          }
        );
        if (typeof res?.id !== 'string' || !res.id) badResponse(true);
        return {
          id: res.id,
          title: typeof res.name === 'string' && res.name ? res.name : title,
          url:
            typeof res.webViewLink === 'string' && res.webViewLink
              ? res.webViewLink
              : driveFileUrl(res.id, 'application/vnd.google-apps.document'),
          ...(folderId ? { folderId } : {}),
        };
      }

      if (toolName === 'mysheets.get_doc') {
        const documentId = this.checkedDriveId(args.documentId, 'documentId');
        const meta = await this.driveRequest(
          {
            url: `${this.driveApiBase}/${encodeURIComponent(documentId)}?fields=${encodeURIComponent('id,name,mimeType,webViewLink')}`,
          },
          signal
        );
        if (typeof meta?.id !== 'string' || !meta.id) badResponse();
        const rawText = await this.driveRequest(
          {
            url: `${this.driveApiBase}/${encodeURIComponent(documentId)}/export?mimeType=${encodeURIComponent('text/plain')}`,
            responseType: 'text',
          },
          signal
        );
        if (typeof rawText !== 'string') badResponse();
        const clipped = clipText(rawText, 12000);
        return {
          id: meta.id,
          title: typeof meta.name === 'string' && meta.name ? meta.name : documentId,
          content: clipped.text,
          url:
            typeof meta.webViewLink === 'string' && meta.webViewLink
              ? meta.webViewLink
              : driveFileUrl(meta.id, 'application/vnd.google-apps.document'),
          ...(clipped.clipped ? { truncated: true } : {}),
        };
      }

      if (toolName === 'mysheets.append_doc_text') {
        const documentId = this.checkedDriveId(args.documentId, 'documentId');
        if (typeof args.text !== 'string' || !args.text.trim() || args.text.length > 8000) {
          invalid('text must be a non-empty string up to 8000 chars');
        }
        const existingText = await this.driveRequest(
          {
            url: `${this.driveApiBase}/${encodeURIComponent(documentId)}/export?mimeType=${encodeURIComponent('text/plain')}`,
            responseType: 'text',
          },
          signal
        );
        if (typeof existingText !== 'string') badResponse();
        const baseText = existingText.replace(/\r?\n$/, '');
        const combined = baseText.length > 0 ? `${baseText}\n\n${args.text}` : args.text;

        const res = await this.driveRequest(
          {
            url: `${this.driveUploadBase}/${encodeURIComponent(documentId)}?uploadType=media&fields=${encodeURIComponent('id,name,webViewLink')}`,
            method: 'PATCH',
            writing: true,
            headers: { 'Content-Type': 'text/plain; charset=UTF-8' },
            body: combined,
          },
          signal,
          (dispatched) => {
            writeDispatched = dispatched;
          }
        );
        if (typeof res?.id !== 'string' || !res.id) badResponse(true);
        return {
          id: res.id,
          title: typeof res.name === 'string' && res.name ? res.name : documentId,
          url:
            typeof res.webViewLink === 'string' && res.webViewLink
              ? res.webViewLink
              : driveFileUrl(res.id, 'application/vnd.google-apps.document'),
        };
      }

      if (toolName === 'mysheets.move_drive_file') {
        const fileId = this.checkedDriveId(args.fileId, 'fileId');
        const folderId = this.checkedDriveId(args.folderId, 'folderId');
        const res = await this.driveRequest(
          {
            url: `${this.driveApiBase}/${encodeURIComponent(fileId)}?addParents=${encodeURIComponent(folderId)}&fields=${encodeURIComponent('id,name,mimeType,webViewLink')}`,
            method: 'PATCH',
            writing: true,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          },
          signal,
          (dispatched) => {
            writeDispatched = dispatched;
          }
        );
        if (typeof res?.id !== 'string' || !res.id) badResponse(true);
        return {
          id: res.id,
          folderId,
          url:
            typeof res.webViewLink === 'string' && res.webViewLink
              ? res.webViewLink
              : driveFileUrl(res.id, res.mimeType),
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
        details: { ...(e.details ?? {}), requestSent: false },
      });
    }
  }

  private async tabs(
    id: string,
    signal?: AbortSignal,
    includeHeaders = false
  ): Promise<Array<{ id: number; title: string; spreadsheetId: string; headers?: string[] }>> {
    const query = includeHeaders
      ? '?ranges=1:1&fields=' +
        encodeURIComponent('sheets.properties(sheetId,title),sheets.data.rowData.values.formattedValue')
      : '?fields=' + encodeURIComponent('sheets.properties(sheetId,title)');
    const value = await this.request(id + query, signal);
    if (
      !Array.isArray(value?.sheets) ||
      value.sheets.some((tab: any) => !Number.isSafeInteger(tab.properties?.sheetId) || typeof tab.properties?.title !== 'string')
    ) {
      badResponse();
    }
    return value.sheets.map((tab: any) => {
      const headers = extractTabHeaders(tab);
      return {
        id: tab.properties.sheetId,
        title: tab.properties.title,
        spreadsheetId: id,
        ...(headers.length > 0 ? { headers } : {}),
      };
    });
  }
}

export function createPersonalSheetsAdapter(config: PersonalSheetsAdapterConfig): PersonalSheetsAdapter {
  return new PersonalSheetsAdapter(config);
}
