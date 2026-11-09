import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import {
  GlobalRateLimiter,
  PersonalSheetsAdapter,
  SheetsAdapter,
  StepError,
  createPersonalSheetsAdapter,
  createSheetsAdapter,
  SHEETS_DIGEST_MAX_COLUMNS,
  SHEETS_DIGEST_MAX_DATA_ROWS,
  SHEETS_DIGEST_SCAN_ROW_LIMIT,
} from '../../src/index.js';
import type { GmailAccessTokenProvider } from '../../src/gmail/token-provider.js';

const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ type: 'pkcs8', format: 'pem' })
  .toString();

const spreadsheetId = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
const otherSpreadsheetId = '2CyiNWs1YSB6oGNeLwCeCAkhnVVrqumct85PhwF3vqnt';
const serviceAccountCreds = {
  clientEmail: 'sheets-digest@unit.iam.gserviceaccount.com',
  privateKey,
};

const json = (data: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

function buildDataRows(count: number, colCount = 4): string[][] {
  const rows: string[][] = [];
  for (let r = 1; r <= count; r++) {
    const row: string[] = [
      `TASK-${r}`,
      `Hạng mục ${r}`,
      r % 3 === 0 ? 'Hoàn thành' : r % 2 === 0 ? 'Đang làm' : 'Chờ xử lý',
      String(r * 1000),
    ];
    while (row.length < colCount) {
      row.push(`extra_${r}_${row.length + 1}`);
    }
    rows.push(row.slice(0, colCount));
  }
  return rows;
}

function setupOrgAdapter(options: {
  handler: (url: URL, init: RequestInit) => Response | Promise<Response>;
  allowedScope?: Record<string, string[]>;
}) {
  const apiCalls: Array<{ url: URL; init: RequestInit }> = [];
  const fetchFn = vi.fn(async (input: any, init: any) => {
    if (String(input) === 'https://oauth2.googleapis.com/token') {
      return json({
        access_token: 'org-sheets-token',
        token_type: 'Bearer',
        expires_in: 3600,
      });
    }
    const url = new URL(String(input));
    apiCalls.push({ url, init });
    return options.handler(url, init);
  }) as unknown as typeof fetch;

  const adapter = createSheetsAdapter({
    credentials: serviceAccountCreds,
    allowedScope: options.allowedScope ?? { spreadsheets: [spreadsheetId] },
    fetchFn,
    rateLimiter: new GlobalRateLimiter({ maxRequests: 1000, windowMs: 60_000 }),
  });

  return { adapter, fetchFn, apiCalls };
}

function setupPersonalAdapter(options: {
  handler: (url: URL, init: RequestInit) => Response | Promise<Response>;
  allowedScope?: Record<string, string[]>;
}) {
  const apiCalls: Array<{ url: URL; init: RequestInit }> = [];
  const fetchFn = vi.fn(async (input: any, init: any) => {
    const url = new URL(String(input));
    apiCalls.push({ url, init });
    return options.handler(url, init);
  }) as unknown as typeof fetch;

  const tokens: GmailAccessTokenProvider = {
    getAccessToken: vi.fn(async () => 'personal-mysheets-token'),
  };

  const adapter = createPersonalSheetsAdapter({
    userId: 'usr_digest_test',
    tokens,
    allowedScope: options.allowedScope ?? { spreadsheets: [spreadsheetId] },
    fetchFn,
    rateLimiter: new GlobalRateLimiter({ maxRequests: 1000, windowMs: 60_000 }),
  });

  return { adapter, fetchFn, apiCalls };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Bounded Digest Reader readDigestWindow & 3-Tier dataScope (RMD-04)', () => {
  it('exports expected digest window constants', () => {
    expect(SHEETS_DIGEST_MAX_DATA_ROWS).toBe(500);
    expect(SHEETS_DIGEST_SCAN_ROW_LIMIT).toBe(502);
    expect(SHEETS_DIGEST_MAX_COLUMNS).toBe(26);
  });

  it('Scenario 1 (TC-16): 20 populated rows on a 1,000-row default grid reports dataScope="partial", windowClipped=false, populatedRowCountInWindow=20 (never 1,000)', async () => {
    const header = ['Mã việc', 'Hạng mục', 'Trạng thái', 'Chi phí'];
    const dataRows = buildDataRows(20);

    const handler = (url: URL) => {
      if (url.searchParams.get('fields')?.includes('gridProperties')) {
        return json({
          sheets: [
            {
              properties: {
                sheetId: 0,
                title: 'Sheet1',
                gridProperties: { rowCount: 1000, columnCount: 26 },
              },
            },
          ],
        });
      }
      if (url.pathname.includes('/values/')) {
        return json({
          range: 'Sheet1!A1:D21',
          values: [header, ...dataRows],
        });
      }
      throw new Error(`Unexpected URL: ${url.toString()}`);
    };

    const { adapter: orgAdapter, apiCalls: orgCalls } = setupOrgAdapter({ handler });
    const orgRes = await orgAdapter.readDigestWindow({ spreadsheetId });

    expect(decodeURIComponent(orgCalls[1]!.url.pathname)).toContain('/values/Sheet1!A1:Z502');
    expect(orgRes).toMatchObject({
      spreadsheetId,
      sheetTitle: 'Sheet1',
      scannedRange: 'Sheet1!A1:Z502',
      explicitRangeRequested: false,
      dataScope: 'partial',
      windowClipped: false,
      rowLimitExceeded: false,
      columnLimitExceeded: false,
      gridRowCapacity: 1000,
      gridColumnCapacity: 26,
      populatedRowCountInWindow: 20,
      totalDataRows: 20,
      headers: header,
    });
    expect(orgRes.populatedRowCountInWindow).not.toBe(1000);
    expect(orgRes.records).toHaveLength(20);
    expect(orgRes.values).toHaveLength(21);
    expect(orgRes.tailRecords).toHaveLength(20);
    expect(orgRes.tailValues).toHaveLength(21);

    const { adapter: personalAdapter } = setupPersonalAdapter({ handler });
    const personalRes = await personalAdapter.readDigestWindow({ spreadsheetId });
    expect(personalRes).toEqual(orgRes);
  });

  it('Scenario 2 (TC-11 / TC-16): small bounded tab (gridProperties 100x10 with 50 populated rows) reports dataScope="full_tab_verified"', async () => {
    const header = ['Mã việc', 'Hạng mục', 'Trạng thái', 'Chi phí'];
    const dataRows = buildDataRows(50);

    const handler = (url: URL) => {
      if (url.searchParams.get('fields')?.includes('gridProperties')) {
        return json({
          sheets: [
            {
              properties: {
                sheetId: 0,
                title: 'KPI Tháng 11',
                gridProperties: { rowCount: 100, columnCount: 10 },
              },
            },
          ],
        });
      }
      if (url.pathname.includes('/values/')) {
        return json({
          range: "'KPI Tháng 11'!A1:D51",
          values: [header, ...dataRows],
        });
      }
      throw new Error(`Unexpected URL: ${url.toString()}`);
    };

    const { adapter, apiCalls } = setupOrgAdapter({ handler });
    const res = await adapter.readDigestWindow({
      spreadsheetId,
      sheetName: 'KPI Tháng 11',
      tailRows: 15,
    });

    expect(decodeURIComponent(apiCalls[1]!.url.pathname)).toContain(
      "/values/'KPI Tháng 11'!A1:Z502"
    );
    expect(res.dataScope).toBe('full_tab_verified');
    expect(res.windowClipped).toBe(false);
    expect(res.rowLimitExceeded).toBe(false);
    expect(res.columnLimitExceeded).toBe(false);
    expect(res.explicitRangeRequested).toBe(false);
    expect(res.gridRowCapacity).toBe(100);
    expect(res.gridColumnCapacity).toBe(10);
    expect(res.populatedRowCountInWindow).toBe(50);
    expect(res.totalDataRows).toBe(50);
    expect(res.records).toHaveLength(50);
    expect(res.values).toHaveLength(51);
    expect(res.tailRecords).toHaveLength(15);
    expect(res.tailRecords[0]?.['Mã việc']).toBe('TASK-36');
    expect(res.tailRecords[14]?.['Mã việc']).toBe('TASK-50');
    expect(res.tailValues).toHaveLength(16);
  });

  it('Scenario 3 (TC-11 / TC-16): 500 populated rows on a 501x26 grid reports dataScope="full_tab_verified" with all 500 records and 20 tailRecords', async () => {
    const header = ['Mã việc', 'Hạng mục', 'Trạng thái', 'Doanh thu'];
    const dataRows = buildDataRows(500);

    const handler = (url: URL) => {
      if (url.searchParams.get('fields')?.includes('gridProperties')) {
        return json({
          sheets: [
            {
              properties: {
                sheetId: 0,
                title: 'Tasks',
                gridProperties: { rowCount: 501, columnCount: 26 },
              },
            },
          ],
        });
      }
      if (url.pathname.includes('/values/')) {
        return json({
          range: 'Tasks!A1:D501',
          values: [header, ...dataRows],
        });
      }
      throw new Error(`Unexpected URL: ${url.toString()}`);
    };

    const { adapter } = setupOrgAdapter({ handler });
    const res = await adapter.readDigestWindow({
      spreadsheetId,
      range: 'Tasks!tail:20',
    });

    expect(res.dataScope).toBe('full_tab_verified');
    expect(res.windowClipped).toBe(false);
    expect(res.rowLimitExceeded).toBe(false);
    expect(res.columnLimitExceeded).toBe(false);
    expect(res.explicitRangeRequested).toBe(false);
    expect(res.populatedRowCountInWindow).toBe(500);
    expect(res.totalDataRows).toBe(500);
    expect(res.records).toHaveLength(500);
    expect(res.values).toHaveLength(501);
    expect(res.tailRecords).toHaveLength(20);
    expect(res.tailRecords[0]?.['Mã việc']).toBe('TASK-481');
    expect(res.tailRecords[19]?.['Mã việc']).toBe('TASK-500');
    expect(res.tailValues).toHaveLength(21);
  });

  it('Scenario 4 (TC-12): overflow >500 data rows (501 data rows in A1:Z502) and >26 columns report dataScope="partial" and windowClipped=true', async () => {
    const header = ['Mã việc', 'Hạng mục', 'Trạng thái', 'Doanh thu'];
    const dataRows501 = buildDataRows(501);

    const rowOverflowHandler = (url: URL) => {
      if (url.searchParams.get('fields')?.includes('gridProperties')) {
        return json({
          sheets: [
            {
              properties: {
                sheetId: 0,
                title: 'BigSheet',
                gridProperties: { rowCount: 650, columnCount: 26 },
              },
            },
          ],
        });
      }
      if (url.pathname.includes('/values/')) {
        return json({
          range: 'BigSheet!A1:D502',
          values: [header, ...dataRows501],
        });
      }
      throw new Error(`Unexpected URL: ${url.toString()}`);
    };

    const { adapter: rowAdapter } = setupOrgAdapter({ handler: rowOverflowHandler });
    const rowRes = await rowAdapter.readDigestWindow({ spreadsheetId });

    expect(rowRes.dataScope).toBe('partial');
    expect(rowRes.rowLimitExceeded).toBe(true);
    expect(rowRes.columnLimitExceeded).toBe(false);
    expect(rowRes.windowClipped).toBe(true);
    expect(rowRes.populatedRowCountInWindow).toBe(500);
    expect(rowRes.totalDataRows).toBe(500);
    expect(rowRes.records).toHaveLength(500);
    expect(rowRes.records[499]?.['Mã việc']).toBe('TASK-500');
    expect(rowRes.values).toHaveLength(501);

    // Also test sparse rows where row 502 has data even though <500 rows are non-empty
    const sparseRows: string[][] = [header];
    for (let i = 1; i <= 500; i++) {
      sparseRows.push(i <= 30 ? [`TASK-${i}`, `Item ${i}`, 'Done', '100'] : ['', '', '', '']);
    }
    sparseRows.push(['TASK-501', 'Overflow probe row at 502', 'Pending', '500']); // 502nd row in sheet

    const { adapter: sparseAdapter } = setupOrgAdapter({
      handler: (url) => {
        if (url.searchParams.get('fields')?.includes('gridProperties')) {
          return json({
            sheets: [
              {
                properties: {
                  sheetId: 0,
                  title: 'SparseSheet',
                  gridProperties: { rowCount: 502, columnCount: 10 },
                },
              },
            ],
          });
        }
        return json({ range: 'SparseSheet!A1:D502', values: sparseRows });
      },
    });
    const sparseRes = await sparseAdapter.readDigestWindow({ spreadsheetId });
    expect(sparseRes.rowLimitExceeded).toBe(true);
    expect(sparseRes.windowClipped).toBe(true);
    expect(sparseRes.dataScope).toBe('partial');
    expect(sparseRes.populatedRowCountInWindow).toBe(31);

    // Also test >26 columns overflow
    const wideHeader = Array.from({ length: 28 }, (_, idx) => `Col_${idx + 1}`);
    const wideRows = buildDataRows(10, 28);
    const { adapter: colAdapter } = setupPersonalAdapter({
      handler: (url) => {
        if (url.searchParams.get('fields')?.includes('gridProperties')) {
          return json({
            sheets: [
              {
                properties: {
                  sheetId: 0,
                  title: 'WideSheet',
                  gridProperties: { rowCount: 100, columnCount: 28 },
                },
              },
            ],
          });
        }
        return json({
          range: 'WideSheet!A1:AB11',
          values: [wideHeader, ...wideRows],
        });
      },
    });

    const colRes = await colAdapter.readDigestWindow({ spreadsheetId });
    expect(colRes.columnLimitExceeded).toBe(true);
    expect(colRes.rowLimitExceeded).toBe(false);
    expect(colRes.windowClipped).toBe(true);
    expect(colRes.dataScope).toBe('partial');
    expect(colRes.headers).toHaveLength(26);
    expect(colRes.values[1]).toHaveLength(26);
  });

  it('Scenario 5 (TC-16): explicit bounded A1 range (Tasks!A1:F100 with 80 rows on a 1,000-row grid) reports dataScope="full_requested_range"', async () => {
    const header = ['Mã việc', 'Hạng mục', 'Trạng thái', 'Chi phí', 'Phụ trách', 'Hạn chót'];
    const dataRows = buildDataRows(80, 6);

    const handler = (url: URL) => {
      if (url.searchParams.get('fields')?.includes('gridProperties')) {
        return json({
          sheets: [
            {
              properties: {
                sheetId: 0,
                title: 'Overview',
                gridProperties: { rowCount: 1000, columnCount: 26 },
              },
            },
            {
              properties: {
                sheetId: 1,
                title: 'Tasks',
                gridProperties: { rowCount: 1000, columnCount: 26 },
              },
            },
          ],
        });
      }
      if (url.pathname.includes('/values/')) {
        return json({
          range: 'Tasks!A1:F81',
          values: [header, ...dataRows],
        });
      }
      throw new Error(`Unexpected URL: ${url.toString()}`);
    };

    const { adapter, apiCalls } = setupOrgAdapter({ handler });
    const res = await adapter.readDigestWindow({
      spreadsheetId,
      range: 'Tasks!A1:F100',
    });

    expect(decodeURIComponent(apiCalls[1]!.url.pathname)).toContain('/values/Tasks!A1:F100');
    expect(res).toMatchObject({
      spreadsheetId,
      sheetTitle: 'Tasks',
      scannedRange: 'Tasks!A1:F100',
      explicitRangeRequested: true,
      dataScope: 'full_requested_range',
      windowClipped: false,
      rowLimitExceeded: false,
      columnLimitExceeded: false,
      gridRowCapacity: 1000,
      gridColumnCapacity: 26,
      populatedRowCountInWindow: 80,
      totalDataRows: 80,
      headers: header,
    });
    expect(res.records).toHaveLength(80);
    expect(res.tailRecords).toHaveLength(20);
  });

  it('Scenario 6 (TC-11): public read_range tools remain strictly capped at limit <= 50 and tail <= 50 while PersonalSheetsAdapter.readDigestWindow enforces scope', async () => {
    const header = ['Mã việc', 'Hạng mục', 'Trạng thái', 'Chi phí'];
    const dataRows = buildDataRows(60);

    const handler = (url: URL) => {
      if (url.searchParams.get('fields')?.includes('sheets.properties')) {
        return json({
          sheets: [
            {
              properties: {
                sheetId: 0,
                title: 'Sheet1',
                gridProperties: { rowCount: 200, columnCount: 10 },
              },
            },
          ],
        });
      }
      return json({
        range: 'Sheet1!A1:Z500',
        values: [header, ...dataRows],
      });
    };

    const { adapter: orgAdapter } = setupOrgAdapter({ handler });
    const { adapter: personalAdapter, fetchFn: personalFetch } = setupPersonalAdapter({ handler });

    expect(orgAdapter).toBeInstanceOf(SheetsAdapter);
    expect(personalAdapter).toBeInstanceOf(PersonalSheetsAdapter);

    // Public limit > 50 must still reject with VALIDATION
    await expect(
      orgAdapter.execute('sheets.read_range', {
        spreadsheetId,
        range: 'Sheet1!A1:D60',
        limit: 51,
      })
    ).rejects.toMatchObject({ category: 'VALIDATION' });

    await expect(
      personalAdapter.execute('mysheets.read_range', {
        spreadsheetId,
        range: 'Sheet1!A1:D60',
        limit: 51,
      })
    ).rejects.toMatchObject({ category: 'VALIDATION' });

    // Public tail > 50 must still reject with VALIDATION
    await expect(
      orgAdapter.execute('sheets.read_range', {
        spreadsheetId,
        range: 'Sheet1!tail:51',
      })
    ).rejects.toMatchObject({ category: 'VALIDATION' });

    await expect(
      personalAdapter.execute('mysheets.read_range', {
        spreadsheetId,
        range: 'Sheet1',
        tail: 51,
      })
    ).rejects.toMatchObject({ category: 'VALIDATION' });

    // Public tail:20 still slices to 20 records
    const publicTail = await personalAdapter.execute('mysheets.read_range', {
      spreadsheetId,
      range: 'Sheet1!tail:20',
      limit: 50,
      headerAware: true,
    });
    expect(publicTail.records).toHaveLength(20);
    expect(publicTail.values).toHaveLength(21);

    // Scope enforcement on readDigestWindow before any HTTP call
    personalFetch.mockClear();
    await expect(
      personalAdapter.readDigestWindow({ spreadsheetId: otherSpreadsheetId })
    ).rejects.toBeInstanceOf(StepError);
    await expect(
      personalAdapter.readDigestWindow({ spreadsheetId: otherSpreadsheetId })
    ).rejects.toMatchObject({ category: 'AUTH_ERROR', statusCode: 403 });
    expect(personalFetch).not.toHaveBeenCalled();

    // Missing tab throws NOT_FOUND 404
    await expect(
      personalAdapter.readDigestWindow({ spreadsheetId, sheetName: 'NonExistentTab' })
    ).rejects.toMatchObject({ category: 'NOT_FOUND', statusCode: 404 });
  });
});
