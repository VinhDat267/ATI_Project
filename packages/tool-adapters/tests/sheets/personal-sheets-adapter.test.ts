import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PersonalSheetsAdapter,
  createPersonalSheetsAdapter,
  type PersonalSheetsAdapterConfig,
} from '../../src/sheets/personal-sheets-adapter.js';
import { StepError, GlobalRateLimiter } from '../../src/index.js';
import type { GmailAccessTokenProvider } from '../../src/gmail/token-provider.js';

const userId = 'usr_fixture_personal_sheets';
const spreadsheetId = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
const secondSpreadsheetId = '2CyiNWs1YSB6oGNeLwCeCAkhnVVrqumct85PhwF3vqnt';
const range = 'Sheet1!A1:B2';
const sheet = 'Sheet1';
const appendArgs = {
  spreadsheetId,
  sheet,
  rows: [['Name', 'Score'], ['=SUM(A1:B1)', '+100'], ['-50', '@danger']],
};

const json = (data: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

function setup(options?: {
  handler?: (url: URL, init: RequestInit) => Response | Promise<Response>;
  allowedScope?: any;
  token?: string;
  tokenError?: Error;
  onTokenCall?: (opts?: { signal?: AbortSignal; forceRefresh?: boolean }) => void;
  apiBaseUrl?: string;
}) {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const tokenCalls: Array<{ signal?: AbortSignal; forceRefresh?: boolean }> = [];

  const fetchFn = vi.fn(async (input: any, init: any) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (options?.handler) return options.handler(url, init);
    // Default handler based on path
    if (url.pathname.includes(':append')) {
      return json({
        spreadsheetId,
        updates: { updatedRange: 'Sheet1!A3:B5', updatedRows: 3 },
      });
    }
    if (url.searchParams.get('fields')?.includes('sheets.properties')) {
      return json({
        sheets: [
          { properties: { sheetId: 0, title: 'Sheet1' } },
          { properties: { sheetId: 1, title: 'Archive' } },
        ],
      });
    }
    return json({
      properties: { title: 'Personal Tasks' },
    });
  }) as unknown as typeof fetch;

  const tokens: GmailAccessTokenProvider = {
    getAccessToken: vi.fn(async (opts) => {
      tokenCalls.push(opts ?? {});
      options?.onTokenCall?.(opts);
      if (options?.tokenError) throw options.tokenError;
      return options?.token ?? 'mock-sheets-token';
    }),
  };

  const adapter = createPersonalSheetsAdapter({
    userId,
    tokens,
    allowedScope: options?.allowedScope ?? { spreadsheets: [spreadsheetId] },
    fetchFn,
    apiBaseUrl: options?.apiBaseUrl,
    rateLimiter: new GlobalRateLimiter({ maxRequests: 1000, windowMs: 60_000 }),
  });

  return { adapter, tokens, fetchFn, calls, tokenCalls };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('PersonalSheetsAdapter', () => {
  it('has service name mysheets and passes checkConnection', async () => {
    const { adapter, calls } = setup({
      handler: () => json({ properties: { title: 'Personal Tasks' } }),
    });
    expect(adapter.service).toBe('mysheets');
    expect(await adapter.checkConnection()).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init.method).toBe('GET');
    expect(calls[0]!.init.headers).toMatchObject({ Authorization: 'Bearer mock-sheets-token' });
  });

  it('mysheets.list_spreadsheets returns only allowlisted spreadsheets matching query with id, title, url', async () => {
    const { adapter, calls } = setup({
      allowedScope: { spreadsheets: [spreadsheetId, secondSpreadsheetId] },
      handler: (url) => {
        if (url.pathname.includes(spreadsheetId)) {
          return json({ properties: { title: 'Personal Tasks' } });
        }
        return json({ properties: { title: 'Project Budget' } });
      },
    });

    const all = await adapter.execute('mysheets.list_spreadsheets', { query: '', limit: 10 });
    expect(all).toEqual([
      { id: spreadsheetId, title: 'Personal Tasks', url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` },
      { id: secondSpreadsheetId, title: 'Project Budget', url: `https://docs.google.com/spreadsheets/d/${secondSpreadsheetId}/edit` },
    ]);
    expect(calls).toHaveLength(2);

    const filtered = await adapter.execute('mysheets.list_spreadsheets', { query: 'budget', limit: 10 });
    expect(filtered).toEqual([
      { id: secondSpreadsheetId, title: 'Project Budget', url: `https://docs.google.com/spreadsheets/d/${secondSpreadsheetId}/edit` },
    ]);
  });

  it('mysheets.list_sheets returns tab metadata for allowed spreadsheet', async () => {
    const { adapter, calls } = setup();
    const tabs = await adapter.execute('mysheets.list_sheets', {
      spreadsheetId,
      query: 'arch',
      limit: 10,
    });
    expect(tabs).toEqual([
      { id: 1, title: 'Archive', spreadsheetId },
    ]);
    expect(calls).toHaveLength(1);
  });

  it('mysheets.read_range returns bounded values and checks truncation', async () => {
    const { adapter } = setup({
      handler: () =>
        json({
          range: 'Sheet1!A1:B2',
          values: [
            ['Task', 'Done'],
            ['Buy milk', 'true'],
          ],
        }),
    });
    const result = await adapter.execute('mysheets.read_range', {
      spreadsheetId,
      range: 'Sheet1!A1:B2',
      limit: 50,
    });
    expect(result).toEqual({
      range: 'Sheet1!A1:B2',
      values: [
        ['Task', 'Done'],
        ['Buy milk', 'true'],
      ],
    });
  });

  it('rejects spreadsheetId not in allowedScope.spreadsheets (AUTH_ERROR, 403, details.requestSent === false on write)', async () => {
    const { adapter, fetchFn } = setup({ allowedScope: { spreadsheets: [spreadsheetId] } });
    const outsideId = '9ZxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upmz';

    // Read rejection: AUTH_ERROR 403
    await expect(
      adapter.execute('mysheets.read_range', {
        spreadsheetId: outsideId,
        range,
      })
    ).rejects.toMatchObject({ category: 'AUTH_ERROR', statusCode: 403 });
    expect(fetchFn).not.toHaveBeenCalled();

    // Write rejection: AUTH_ERROR 403 with details.requestSent === false
    try {
      await adapter.execute('mysheets.append_rows', { ...appendArgs, spreadsheetId: outsideId });
      expect.fail('must reject');
    } catch (err: any) {
      expect(err).toBeInstanceOf(StepError);
      expect(err.category).toBe('AUTH_ERROR');
      expect(err.statusCode).toBe(403);
      expect(err.details).toEqual({ requestSent: false });
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([{}, { spreadsheets: [] }, { spreadsheets: ['short-invalid-id'] }])(
    'rejects empty or invalid scope on write with details.requestSent === false: %j',
    async (scope) => {
      const { adapter, fetchFn } = setup({ allowedScope: scope });
      try {
        await adapter.execute('mysheets.append_rows', appendArgs);
        expect.fail('must reject');
      } catch (err: any) {
        expect(err).toBeInstanceOf(StepError);
        expect(err.category).toBe('AUTH_ERROR');
        expect(err.statusCode).toBe(403);
        expect(err.details).toEqual({ requestSent: false });
      }
      expect(fetchFn).not.toHaveBeenCalled();
    }
  );

  it('mysheets.append_rows applies formula protection and escapes =, +, -, @', async () => {
    const { adapter, calls } = setup();
    const result = await adapter.execute('mysheets.append_rows', appendArgs);

    expect(result).toEqual({
      spreadsheetId,
      updatedRange: 'Sheet1!A3:B5',
      updatedRows: 3,
      url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    });
    expect(calls).toHaveLength(2); // 1: tabs, 2: append
    expect(calls[1]!.init.method).toBe('POST');
    expect(calls[1]!.url.pathname).toContain(':append');

    const body = JSON.parse(String(calls[1]!.init.body));
    expect(body.values).toEqual([
      ['Name', 'Score'],
      ["'=SUM(A1:B1)", "'+100"],
      ["'-50", "'@danger"],
    ]);
  });

  it('rejects append_rows when tab does not exist in spreadsheet (NOT_FOUND, 404, details.requestSent === false)', async () => {
    const { adapter } = setup();
    try {
      await adapter.execute('mysheets.append_rows', {
        ...appendArgs,
        sheet: 'NonExistentTab',
      });
      expect.fail('must reject');
    } catch (err: any) {
      expect(err).toBeInstanceOf(StepError);
      expect(err.category).toBe('NOT_FOUND');
      expect(err.statusCode).toBe(404);
      expect(err.details).toEqual({ requestSent: false });
    }
  });

  it('on HTTP 401, calls tokens.getAccessToken({ signal, forceRefresh: true }) once and retries', async () => {
    let attempt = 0;
    const { adapter, calls, tokenCalls } = setup({
      handler: (url) => {
        if (url.pathname.includes(':append')) {
          if (attempt++ === 0) return new Response('Unauthorized', { status: 401 });
          return json({
            spreadsheetId,
            updates: { updatedRange: 'Sheet1!A3:B5', updatedRows: 3 },
          });
        }
        return json({
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        });
      },
    });

    const result = await adapter.execute('mysheets.append_rows', appendArgs);
    expect(result.updatedRows).toBe(3);
    expect(calls).toHaveLength(3); // tabs, 1st append (401), 2nd append (200)
    expect(tokenCalls).toHaveLength(3);
    expect(tokenCalls[2]).toMatchObject({ forceRefresh: true });
  });

  it('when second 401 occurs after retry on append_rows, throws AUTH_ERROR 401 with details.requestSent === false', async () => {
    const { adapter, calls, tokenCalls } = setup({
      handler: (url) => {
        if (url.pathname.includes(':append')) {
          return new Response('Unauthorized', { status: 401 });
        }
        return json({
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        });
      },
    });

    try {
      await adapter.execute('mysheets.append_rows', appendArgs);
      expect.fail('must reject');
    } catch (err: any) {
      expect(err).toBeInstanceOf(StepError);
      expect(err.category).toBe('AUTH_ERROR');
      expect(err.statusCode).toBe(401);
      expect(err.details).toEqual({ requestSent: false });
    }
    expect(calls).toHaveLength(3); // tabs, append 1 (401), append 2 (401)
    expect(tokenCalls[2]).toMatchObject({ forceRefresh: true });
  });

  it('when tokens.getAccessToken fails before append_rows dispatches HTTP, throws StepError with details.requestSent === false', async () => {
    const tokenError = new StepError({
      message: 'Token expired and refresh token revoked',
      category: 'AUTH_ERROR',
      statusCode: 401,
    });
    const { adapter, fetchFn } = setup({ tokenError });

    try {
      await adapter.execute('mysheets.append_rows', appendArgs);
      expect.fail('must reject');
    } catch (err: any) {
      expect(err).toBeInstanceOf(StepError);
      expect(err.category).toBe('AUTH_ERROR');
      expect(err.statusCode).toBe(401);
      expect(err.details).toEqual({ requestSent: false });
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('when tokens.getAccessToken fails during 401 refresh on append_rows, throws StepError with details.requestSent === false', async () => {
    let tokenAttempt = 0;
    const { adapter, calls } = setup({
      handler: (url) => {
        if (url.pathname.includes(':append')) {
          return new Response('Unauthorized', { status: 401 });
        }
        return json({
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        });
      },
      onTokenCall: () => {
        tokenAttempt++;
        if (tokenAttempt === 3) {
          throw new StepError({
            message: 'Refresh failed on network',
            category: 'NETWORK',
          });
        }
      },
    });

    try {
      await adapter.execute('mysheets.append_rows', appendArgs);
      expect.fail('must reject');
    } catch (err: any) {
      expect(err).toBeInstanceOf(StepError);
      expect(err.category).toBe('NETWORK');
      expect(err.details).toEqual({ requestSent: false });
    }
    expect(calls).toHaveLength(2); // tabs, 1st append (401), refresh fails before 2nd append
  });

  it('when fetchFn rejects after append_rows is sent, throws StepError with category UNKNOWN and never retries', async () => {
    const { adapter, calls } = setup({
      handler: (url) => {
        if (url.pathname.includes(':append')) {
          throw new Error('Connection reset by peer');
        }
        return json({
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        });
      },
    });

    try {
      await adapter.execute('mysheets.append_rows', appendArgs);
      expect.fail('must reject');
    } catch (err: any) {
      expect(err).toBeInstanceOf(StepError);
      expect(err.category).toBe('UNKNOWN');
      expect(err.retryable).toBe(false);
      expect(err.details?.requestSent).toBeUndefined();
    }
    expect(calls).toHaveLength(2); // tabs, 1 append attempt
  });

  it('when fetchFn returns 503 after append_rows is sent, throws StepError with category UNKNOWN and never retries', async () => {
    const { adapter, calls } = setup({
      handler: (url) => {
        if (url.pathname.includes(':append')) {
          return new Response('Backend unavailable', { status: 503 });
        }
        return json({
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        });
      },
    });

    try {
      await adapter.execute('mysheets.append_rows', appendArgs);
      expect.fail('must reject');
    } catch (err: any) {
      expect(err).toBeInstanceOf(StepError);
      expect(err.category).toBe('UNKNOWN');
      expect(err.statusCode).toBe(503);
      expect(err.retryable).toBe(false);
      expect(err.details?.requestSent).toBeUndefined();
    }
    expect(calls).toHaveLength(2);
  });

  it('real AbortSignal cancellation before dispatch throws StepError with details.requestSent === false', async () => {
    const controller = new AbortController();
    controller.abort();
    const { adapter, fetchFn } = setup();

    try {
      await adapter.execute('mysheets.append_rows', appendArgs, { signal: controller.signal });
      expect.fail('must reject');
    } catch (err: any) {
      expect(err).toBeInstanceOf(StepError);
      expect(err.category).toBe('NETWORK');
      expect(err.details).toEqual({ requestSent: false });
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('real AbortSignal cancellation during fetch on append_rows throws UNKNOWN and never retries', async () => {
    const controller = new AbortController();
    let dispatched!: () => void;
    const reached = new Promise<void>((resolve) => {
      dispatched = resolve;
    });

    const { adapter, calls } = setup({
      handler: (url, init) => {
        if (url.pathname.includes(':append')) {
          return new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new Error('AbortError: request was aborted')), {
              once: true,
            });
            dispatched();
          });
        }
        return json({
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        });
      },
    });

    const promise = adapter.execute('mysheets.append_rows', appendArgs, { signal: controller.signal });
    const assertion = expect(promise).rejects.toMatchObject({ category: 'UNKNOWN', retryable: false });
    await reached;
    await controller.abort();
    await assertion;
    expect(calls).toHaveLength(2); // tabs, 1 append
  });

  it('supports smart tab-only, tail:N and headerAware reading in PersonalSheetsAdapter', async () => {
    const { adapter, calls } = setup({
      handler: () =>
        json({
          range: "'Báo cáo KPI'!A1:Z500",
          values: [
            ['Hạng mục', 'Chủ sở hữu', 'Trạng thái'],
            ['KPI 1', 'Minh', 'Hoàn thành'],
            ['KPI 2', 'Lan', 'Đang làm'],
            ['KPI 3', 'Huy', 'Quá hạn'],
          ],
        }),
    });

    const res = await adapter.execute('mysheets.read_range', {
      spreadsheetId,
      range: 'Báo cáo KPI!tail:2',
    });
    expect(decodeURIComponent(calls[0]!.url.pathname)).toContain("/values/'Báo cáo KPI'!A1:Z500");
    expect(res).toEqual({
      range: "'Báo cáo KPI'!A1:Z500",
      values: [
        ['Hạng mục', 'Chủ sở hữu', 'Trạng thái'],
        ['KPI 2', 'Lan', 'Đang làm'],
        ['KPI 3', 'Huy', 'Quá hạn'],
      ],
      headers: ['Hạng mục', 'Chủ sở hữu', 'Trạng thái'],
      records: [
        { 'Hạng mục': 'KPI 2', 'Chủ sở hữu': 'Lan', 'Trạng thái': 'Đang làm' },
        { 'Hạng mục': 'KPI 3', 'Chủ sở hữu': 'Huy', 'Trạng thái': 'Quá hạn' },
      ],
      totalDataRows: 3,
    });
  });

  it('deduplicates mysheets.append_rows idempotently and preserves formula injection escaping', async () => {
    const { adapter, calls } = setup({
      handler: (url, init) => {
        if (init.method === 'POST') {
          return json({
            spreadsheetId,
            updates: { updatedRange: 'Sheet1!A3:C3', updatedRows: 1 },
          });
        }
        if (url.pathname.includes('/values/')) {
          return json({
            range: 'Sheet1!A1:Z500',
            values: [
              ['Ticket', 'Summary', 'Formula'],
              ['JIRA-101', 'Already synced', "'=1+1"],
            ],
          });
        }
        return json({
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        });
      },
    });

    const res = await adapter.execute('mysheets.append_rows', {
      spreadsheetId,
      sheet: 'Sheet1',
      rows: [
        ['JIRA-101', 'Already synced', '=1+1'],
        ['JIRA-102', 'New ticket', '@channel +alert'],
      ],
    });

    expect(res).toEqual({
      spreadsheetId,
      updatedRange: 'Sheet1!A3:C3',
      updatedRows: 1,
      skippedDuplicates: 1,
      url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    });
    const postCalls = calls.filter((c) => c.init.method === 'POST');
    expect(postCalls).toHaveLength(1);
    expect(JSON.parse(String(postCalls[0]!.init.body)).values).toEqual([
      ['JIRA-102', 'New ticket', "'@channel +alert"],
    ]);
  });

  it('mysheets.list_sheets extracts row 1 headers when returned by Google Sheets metadata', async () => {
    const { adapter, calls } = setup({
      handler: () =>
        json({
          sheets: [
            {
              properties: { sheetId: 0, title: 'KPI Tháng 11' },
              data: [
                {
                  rowData: [
                    {
                      values: [
                        { formattedValue: 'Mã việc' },
                        { formattedValue: 'Tiêu đề' },
                        { formattedValue: 'Người phụ trách' },
                        { formattedValue: 'Trạng thái' },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        }),
    });

    const tabs = await adapter.execute('mysheets.list_sheets', {
      spreadsheetId,
      query: '',
      limit: 10,
    });

    expect(tabs).toEqual([
      {
        id: 0,
        title: 'KPI Tháng 11',
        spreadsheetId,
        headers: ['Mã việc', 'Tiêu đề', 'Người phụ trách', 'Trạng thái'],
      },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.searchParams.get('fields')).toContain('sheets.data.rowData.values.formattedValue');
  });

  it('supports upsert via onDuplicate="update" in mysheets.append_rows, updating matched key rows with formula protection and appending new rows', async () => {
    const { adapter, calls } = setup({
      handler: (url, init) => {
        if (init.method === 'POST' && url.pathname.endsWith('/values:batchUpdate')) {
          return json({
            spreadsheetId,
            totalUpdatedRows: 1,
            responses: [
              {
                spreadsheetId,
                updatedRange: 'Sheet1!A2:C2',
                updatedRows: 1,
              },
            ],
          });
        }
        if (init.method === 'POST' && url.pathname.includes(':append')) {
          return json({
            spreadsheetId,
            updates: { updatedRange: 'Sheet1!A4:C4', updatedRows: 1 },
          });
        }
        if (url.pathname.includes('/values/')) {
          return json({
            range: 'Sheet1!A1:Z500',
            values: [
              ['Ticket', 'Status', 'Note'],
              ['JIRA-101', 'In Progress', 'Working'],
              ['JIRA-102', 'Done', 'Unchanged row'],
            ],
          });
        }
        return json({
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        });
      },
    });

    const res = await adapter.execute('mysheets.append_rows', {
      spreadsheetId,
      sheet: 'Sheet1',
      deduplicate: true,
      deduplicateColumn: 0,
      onDuplicate: 'update',
      rows: [
        ['JIRA-101', 'Done', '=HYPERLINK("https://evil.example")'], // Changed -> should update row 2
        ['JIRA-102', 'Done', 'Unchanged row'], // Identical -> should skip
        ['JIRA-103', 'To Do', '+New task'], // New key -> should append
      ],
    });

    expect(res).toEqual({
      spreadsheetId,
      updatedRange: 'Sheet1!A4:C4',
      updatedRows: 2,
      skippedDuplicates: 1,
      url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    });

    const postCalls = calls.filter((c) => c.init.method === 'POST');
    expect(postCalls).toHaveLength(2);
    expect(postCalls[0]!.url.pathname).toContain('/values:batchUpdate');
    expect(JSON.parse(String(postCalls[0]!.init.body))).toEqual({
      valueInputOption: 'USER_ENTERED',
      data: [
        {
          range: 'Sheet1!A2',
          majorDimension: 'ROWS',
          values: [['JIRA-101', 'Done', '\'=HYPERLINK("https://evil.example")']],
        },
      ],
    });

    expect(postCalls[1]!.url.pathname).toContain(':append');
    expect(JSON.parse(String(postCalls[1]!.init.body)).values).toEqual([
      ['JIRA-103', 'To Do', "'+New task"],
    ]);
  });

  it('mysheets.search_rows scans up to 500 rows, filters by column/operator/query beyond row 50, and returns 1-based rowNumber + record', async () => {
    const rows: string[][] = [['Mã UV', 'Họ tên', 'Email', 'Trạng thái gửi mail']];
    for (let i = 1; i <= 120; i++) {
      rows.push([
        `UV-${i}`,
        `Ứng viên ${i}`,
        `uv${i}@example.com`,
        i === 85 || i === 112 ? 'Chưa gửi' : 'Đã gửi',
      ]);
    }

    const { adapter } = setup({
      handler: (url) => {
        if (url.pathname.includes('/values/')) {
          return json({
            range: "'Ứng viên'!A1:D121",
            values: rows,
          });
        }
        return json({
          sheets: [{ properties: { sheetId: 0, title: 'Ứng viên' } }],
        });
      },
    });

    const result = await adapter.execute('mysheets.search_rows', {
      spreadsheetId,
      sheet: 'Ứng viên',
      column: 'Trạng thái gửi mail',
      operator: 'equals',
      value: 'chưa gửi',
      limit: 10,
    });

    expect(result).toEqual({
      sheet: 'Ứng viên',
      headers: ['Mã UV', 'Họ tên', 'Email', 'Trạng thái gửi mail'],
      totalMatched: 2,
      matches: [
        {
          rowNumber: 86,
          values: ['UV-85', 'Ứng viên 85', 'uv85@example.com', 'Chưa gửi'],
          record: {
            'Mã UV': 'UV-85',
            'Họ tên': 'Ứng viên 85',
            Email: 'uv85@example.com',
            'Trạng thái gửi mail': 'Chưa gửi',
          },
        },
        {
          rowNumber: 113,
          values: ['UV-112', 'Ứng viên 112', 'uv112@example.com', 'Chưa gửi'],
          record: {
            'Mã UV': 'UV-112',
            'Họ tên': 'Ứng viên 112',
            Email: 'uv112@example.com',
            'Trạng thái gửi mail': 'Chưa gửi',
          },
        },
      ],
    });
  });

  it('mysheets.update_rows updates only target columns by matchColumn or rowNumber, preserving formula columns and escaping formula injection', async () => {
    const { adapter, calls } = setup({
      handler: (url, init) => {
        if (init.method === 'POST' && url.pathname.includes('/values:batchUpdate')) {
          return json({
            spreadsheetId,
            totalUpdatedRows: 2,
            totalUpdatedCells: 3,
            responses: [
              { updatedRange: "'Ứng viên'!E2" },
              { updatedRange: "'Ứng viên'!F2" },
              { updatedRange: "'Ứng viên'!E3" },
            ],
          });
        }
        if (url.pathname.includes('/values/')) {
          return json({
            range: "'Ứng viên'!A1:F3",
            values: [
              ['Mã UV', 'Họ tên', 'Email', 'Lương dự kiến', 'Trạng thái', 'Ghi chú'],
              ['UV-1', 'Nguyễn Lan', 'lan@example.com', '=C2*1.2', 'Chưa gửi', ''],
              ['UV-2', 'Trần Minh', 'minh@example.com', '=C3*1.2', 'Chưa gửi', ''],
            ],
          });
        }
        return json({
          sheets: [{ properties: { sheetId: 0, title: 'Ứng viên' } }],
        });
      },
    });

    const res = await adapter.execute('mysheets.update_rows', {
      spreadsheetId,
      sheet: 'Ứng viên',
      updates: [
        {
          matchColumn: 'Email',
          matchValue: 'lan@example.com',
          values: {
            'Trạng thái': 'Đã gửi thư mời',
            'Ghi chú': '=CMD("calc")',
          },
        },
        {
          rowNumber: 3,
          values: {
            E: 'Đã đặt lịch',
          },
        },
      ],
    });

    expect(res).toEqual({
      spreadsheetId,
      updatedRange: "'Ứng viên'!E3",
      updatedRows: 2,
      updatedCells: 3,
      url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    });

    const postCalls = calls.filter((c) => c.init.method === 'POST');
    expect(postCalls).toHaveLength(1);
    expect(JSON.parse(String(postCalls[0]!.init.body))).toEqual({
      valueInputOption: 'USER_ENTERED',
      data: [
        {
          range: "'Ứng viên'!E2",
          majorDimension: 'ROWS',
          values: [['Đã gửi thư mời']],
        },
        {
          range: "'Ứng viên'!F2",
          majorDimension: 'ROWS',
          values: [["'=CMD(\"calc\")"]],
        },
        {
          range: "'Ứng viên'!E3",
          majorDimension: 'ROWS',
          values: [['Đã đặt lịch']],
        },
      ],
    });
  });

  it('mysheets.create_sheet creates a new tab via batchUpdate addSheet and initializes row 1 headers with formula protection', async () => {
    const { adapter, calls } = setup({
      handler: (url, init) => {
        if (init.method === 'POST' && url.pathname.endsWith(':batchUpdate') && !url.pathname.includes('/values')) {
          return json({
            spreadsheetId,
            replies: [{ addSheet: { properties: { sheetId: 77, title: 'Sprint 15' } } }],
          });
        }
        if (init.method === 'POST' && url.pathname.includes('/values:batchUpdate')) {
          return json({
            spreadsheetId,
            totalUpdatedRows: 1,
            responses: [{ updatedRange: "'Sprint 15'!A1:C1" }],
          });
        }
        return json({
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        });
      },
    });

    const res = await adapter.execute('mysheets.create_sheet', {
      spreadsheetId,
      title: 'Sprint 15',
      headers: ['Mã thẻ', 'Tiêu đề', '=Trạng thái'],
    });

    expect(res).toEqual({
      id: 77,
      title: 'Sprint 15',
      spreadsheetId,
      headers: ['Mã thẻ', 'Tiêu đề', '=Trạng thái'],
      url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    });

    const postCalls = calls.filter((c) => c.init.method === 'POST');
    expect(postCalls).toHaveLength(2);
    expect(JSON.parse(String(postCalls[0]!.init.body))).toEqual({
      requests: [{ addSheet: { properties: { title: 'Sprint 15' } } }],
    });
    expect(JSON.parse(String(postCalls[1]!.init.body))).toEqual({
      valueInputOption: 'USER_ENTERED',
      data: [
        {
          range: "'Sprint 15'!A1",
          majorDimension: 'ROWS',
          values: [['Mã thẻ', 'Tiêu đề', "'=Trạng thái"]],
        },
      ],
    });
  });

  it('mysheets.append_rows supports header-aware records[] and keyColumn upsert without misaligning intermediate columns', async () => {
    const { adapter, calls } = setup({
      handler: (url, init) => {
        if (init.method === 'POST' && url.pathname.endsWith('/values:batchUpdate')) {
          return json({
            spreadsheetId,
            totalUpdatedRows: 1,
            responses: [{ updatedRange: 'Sheet1!A2:E2', updatedRows: 1 }],
          });
        }
        if (init.method === 'POST' && url.pathname.includes(':append')) {
          return json({
            spreadsheetId,
            updates: { updatedRange: 'Sheet1!A3:E3', updatedRows: 1 },
          });
        }
        if (url.pathname.includes('/values/')) {
          return json({
            range: 'Sheet1!A1:Z500',
            values: [
              ['Mã KH', 'Tên khách', 'Email', 'Công thức tự động', 'Trạng thái'],
              ['KH-01', 'Công ty Cũ', 'abc@example.com', '=B2', 'Đang tư vấn'],
            ],
          });
        }
        return json({
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        });
      },
    });

    const res = await adapter.execute('mysheets.append_rows', {
      spreadsheetId,
      sheet: 'Sheet1',
      keyColumn: 'Email',
      onDuplicate: 'update',
      records: [
        {
          'Mã KH': 'KH-01',
          'Tên khách': 'Công ty ABC (Đã chốt)',
          Email: 'abc@example.com',
          'Trạng thái': 'Hoàn thành',
        },
        {
          'Mã KH': 'KH-02',
          'Ten khach': 'Công ty XYZ',
          Email: 'xyz@example.com',
          'Trang thai': '=Mới',
        },
      ],
    });

    expect(res).toEqual({
      spreadsheetId,
      updatedRange: 'Sheet1!A3:E3',
      updatedRows: 2,
      skippedDuplicates: 0,
      url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    });

    const postCalls = calls.filter((c) => c.init.method === 'POST');
    expect(postCalls).toHaveLength(2);
    // First POST: batchUpdate for existing Email abc@example.com
    expect(JSON.parse(String(postCalls[0]!.init.body))).toEqual({
      valueInputOption: 'USER_ENTERED',
      data: [
        {
          range: 'Sheet1!A2',
          majorDimension: 'ROWS',
          values: [['KH-01', 'Công ty ABC (Đã chốt)', 'abc@example.com', '', 'Hoàn thành']],
        },
      ],
    });
    // Second POST: append for new Email xyz@example.com with formula protection
    expect(JSON.parse(String(postCalls[1]!.init.body)).values).toEqual([
      ['KH-02', 'Công ty XYZ', 'xyz@example.com', '', "'=Mới"],
    ]);
  });

  it('mysheets.search_rows supports numeric/currency and date operators (gt, gte, lt, lte) and multi-column filters', async () => {
    const { adapter } = setup({
      handler: (url) => {
        if (url.pathname.includes('/values/')) {
          return json({
            range: "'Công nợ'!A1:E5",
            values: [
              ['Mã ĐH', 'Khách hàng', 'Số tiền nợ', 'Hạn thanh toán', 'Trạng thái'],
              ['DH-01', 'Công ty A', '15.000.000 đ', '10/11/2026', 'Chưa thanh toán'],
              ['DH-02', 'Công ty B', '35.000.000 đ', '01/11/2026', 'Chưa thanh toán'],
              ['DH-03', 'Công ty C', '50.000.000 đ', '20/11/2026', 'Chưa thanh toán'],
              ['DH-04', 'Công ty D', '40.000.000 đ', '01/11/2026', 'Đã thanh toán'],
            ],
          });
        }
        return json({
          sheets: [{ properties: { sheetId: 0, title: 'Công nợ' } }],
        });
      },
    });

    const res = await adapter.execute('mysheets.search_rows', {
      spreadsheetId,
      sheet: 'Công nợ',
      filters: [
        { column: 'Số tiền nợ', operator: 'gt', value: '20000000' },
        { column: 'Hạn thanh toán', operator: 'lte', value: '2026-11-05' },
        { column: 'Trạng thái', operator: 'equals', value: 'Chưa thanh toán' },
      ],
    });

    expect(res.totalMatched).toBe(1);
    expect(res.matches[0]?.rowNumber).toBe(3);
    expect(res.matches[0]?.record['Khách hàng']).toBe('Công ty B');
  });

  it('mysheets.aggregate_rows computes sum, avg, min, max, count grouped by column across rows', async () => {
    const { adapter } = setup({
      handler: (url) => {
        if (url.pathname.includes('/values/')) {
          return json({
            range: "'Doanh thu'!A1:D6",
            values: [
              ['Mã ĐH', 'Nhân viên', 'Doanh thu', 'Trạng thái'],
              ['DH-1', 'Minh', '10.000.000 đ', 'Thành công'],
              ['DH-2', 'Lan', '25.000.000 đ', 'Thành công'],
              ['DH-3', 'Minh', '30.000.000 đ', 'Thành công'],
              ['DH-4', 'Minh', '50.000.000 đ', 'Đã huỷ'],
              ['DH-5', 'Lan', '15.000.000 đ', 'Thành công'],
            ],
          });
        }
        return json({
          sheets: [{ properties: { sheetId: 0, title: 'Doanh thu' } }],
        });
      },
    });

    const res = await adapter.execute('mysheets.aggregate_rows', {
      spreadsheetId,
      sheet: 'Doanh thu',
      filters: [{ column: 'Trạng thái', operator: 'equals', value: 'Thành công' }],
      groupBy: 'Nhân viên',
      metrics: [
        { column: 'Doanh thu', fn: 'sum' },
        { column: 'Doanh thu', fn: 'avg' },
        { column: 'Doanh thu', fn: 'count' },
      ],
    });

    expect(res).toEqual({
      sheet: 'Doanh thu',
      totalRowsScanned: 5,
      matchedRows: 4,
      groups: [
        {
          key: 'Minh',
          count: 2,
          metrics: {
            'Doanh thu_sum': 40_000_000,
            'Doanh thu_avg': 20_000_000,
            'Doanh thu_count': 2,
          },
        },
        {
          key: 'Lan',
          count: 2,
          metrics: {
            'Doanh thu_sum': 40_000_000,
            'Doanh thu_avg': 20_000_000,
            'Doanh thu_count': 2,
          },
        },
      ],
      totals: {
        'Doanh thu_sum': 80_000_000,
        'Doanh thu_avg': 20_000_000,
        'Doanh thu_count': 4,
      },
    });
  });

  it('mysheets.delete_rows deletes matched rows bottom-up via deleteDimension and protects header row 1', async () => {
    const { adapter, calls } = setup({
      handler: (url, init) => {
        if (init.method === 'POST' && url.pathname.endsWith(':batchUpdate')) {
          return json({ spreadsheetId, replies: [{}, {}] });
        }
        if (url.pathname.includes('/values/')) {
          return json({
            range: 'Sheet1!A1:C5',
            values: [
              ['Mã ĐH', 'Khách hàng', 'Trạng thái'],
              ['DH-1', 'Khách A', 'Đã huỷ'],
              ['DH-2', 'Khách B', 'Thành công'],
              ['DH-3', 'Khách C', 'Đã huỷ'],
            ],
          });
        }
        return json({
          sheets: [{ properties: { sheetId: 42, title: 'Sheet1' } }],
        });
      },
    });

    const res = await adapter.execute('mysheets.delete_rows', {
      spreadsheetId,
      sheet: 'Sheet1',
      matchColumn: 'Trạng thái',
      matchValue: 'Đã huỷ',
    });

    expect(res).toEqual({
      spreadsheetId,
      sheet: 'Sheet1',
      deletedRows: 2,
      deletedRowNumbers: [2, 4],
      url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    });

    const postCalls = calls.filter((c) => c.init.method === 'POST');
    expect(postCalls).toHaveLength(1);
    // Must delete row 4 (index 3..4) BEFORE row 2 (index 1..2) so indices don't shift!
    expect(JSON.parse(String(postCalls[0]!.init.body))).toEqual({
      requests: [
        {
          deleteDimension: {
            range: { sheetId: 42, dimension: 'ROWS', startIndex: 3, endIndex: 4 },
          },
        },
        {
          deleteDimension: {
            range: { sheetId: 42, dimension: 'ROWS', startIndex: 1, endIndex: 2 },
          },
        },
      ],
    });

    // Rejects deleting row 1 (header row)
    await expect(
      adapter.execute('mysheets.delete_rows', {
        spreadsheetId,
        sheet: 'Sheet1',
        rowNumbers: [1],
      })
    ).rejects.toMatchObject({ category: 'VALIDATION' });

    // Rejects combining rowNumbers with matchColumn/matchValue
    await expect(
      adapter.execute('mysheets.delete_rows', {
        spreadsheetId,
        sheet: 'Sheet1',
        rowNumbers: [2],
        matchColumn: 'Trạng thái',
        matchValue: 'Đã huỷ',
      })
    ).rejects.toMatchObject({ category: 'VALIDATION' });
  });

  it('preserves existing tab headers in create_sheet, skips header row 1 during upsert, parses English decimals accurately, and filters unclipped cells before clipping output', async () => {
    const longCell = 'a'.repeat(500) + ' needle-target';
    const { adapter, calls } = setup({
      handler: (url, init) => {
        if (init.method === 'POST' && url.pathname.endsWith('/values:batchUpdate')) {
          return json({
            spreadsheetId,
            totalUpdatedRows: 1,
            responses: [{ updatedRange: 'Tasks!A2:B2', updatedRows: 1 }],
          });
        }
        if (init.method === 'POST' && url.pathname.includes(':append')) {
          return json({
            spreadsheetId,
            updates: { updatedRange: 'Tasks!A2:B2', updatedRows: 1 },
          });
        }
        if (url.pathname.includes('/values/')) {
          const decoded = decodeURIComponent(url.pathname);
          if (decoded.endsWith('!A1:Z1')) {
            return json({
              range: 'Tasks!A1:B1',
              values: [['RealHeaderA', 'RealHeaderB']],
            });
          }
          return json({
            range: 'Tasks!A1:C3',
            values: [
              ['ID', 'Rate', 'Notes'],
              ['row-1', '0.125', longCell],
              ['row-2', '0.875', 'short note'],
            ],
          });
        }
        return json({
          sheets: [{ properties: { sheetId: 10, title: 'Tasks' } }],
        });
      },
    });

    // F5: create_sheet on existing tab preserves RealHeaderA, RealHeaderB without POSTing values:batchUpdate
    const createdTab = await adapter.execute('mysheets.create_sheet', {
      spreadsheetId,
      title: 'Tasks',
      headers: ['NewA', 'NewB'],
    });
    expect(createdTab.headers).toEqual(['RealHeaderA', 'RealHeaderB']);
    expect(calls.filter((c) => c.init.method === 'POST')).toHaveLength(0);

    // F8: append_rows upsert with row matching header key ('ID') appends as new data row instead of overwriting row 1
    await adapter.execute('mysheets.append_rows', {
      spreadsheetId,
      sheet: 'Tasks',
      keyColumn: 'ID',
      onDuplicate: 'update',
      rows: [['ID', '0.500', 'should-not-overwrite-header']],
    });
    expect(
      calls.filter((c) => c.init.method === 'POST' && c.url.pathname.endsWith('/values:batchUpdate'))
    ).toHaveLength(0);

    // F9: aggregate_rows parses 0.125 + 0.875 = 1 (avg 0.5), not 1000
    const agg = await adapter.execute('mysheets.aggregate_rows', {
      spreadsheetId,
      sheet: 'Tasks',
      metrics: [
        { column: 'Rate', fn: 'sum' },
        { column: 'Rate', fn: 'avg' },
      ],
    });
    expect(agg.totals).toEqual({
      Rate_sum: 1,
      Rate_avg: 0.5,
    });

    // F10: search_rows finds 'needle-target' beyond char 500, then clips returned cell to 500 chars with truncated: true
    const searched = await adapter.execute('mysheets.search_rows', {
      spreadsheetId,
      sheet: 'Tasks',
      query: 'needle-target',
    });
    expect(searched.totalMatched).toBe(1);
    expect(searched.truncated).toBe(true);
    expect(searched.matches[0]?.record.Notes).toHaveLength(500);
  });
});
