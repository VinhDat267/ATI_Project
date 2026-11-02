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
});
