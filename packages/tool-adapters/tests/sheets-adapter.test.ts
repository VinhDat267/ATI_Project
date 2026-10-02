import { afterEach, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import * as adapters from '../src/index.js';

const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const id = 'spreadsheet_fixture_123456';
const other = 'spreadsheet_another_123456';
const credentials = { clientEmail: 'sheets@unit.iam.gserviceaccount.com', privateKey };
const json = (data: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(data), { status, headers });
const metadata = { spreadsheetId: id, properties: { title: 'ATI Test Tracker' }, sheets: [{ properties: { sheetId: 0, title: 'Tasks' } }, { properties: { sheetId: 2, title: "Team's Tasks" } }] };
function setup(handler: (url: URL, init: RequestInit) => Response | Promise<Response> = () => json(metadata), allowedScope: any = { spreadsheets: [id] }) {
  const apiCalls: Array<{ url: URL; init: RequestInit }> = [];
  const fetchFn = vi.fn(async (url: any, init: any) => {
    if (String(url) === 'https://oauth2.googleapis.com/token') return json({ access_token: 'fixture-secret-token', token_type: 'Bearer', expires_in: 3600 });
    const parsed = new URL(String(url)); apiCalls.push({ url: parsed, init });
    return handler(parsed, init);
  }) as unknown as typeof fetch;
  const adapter = new adapters.SheetsAdapter({ credentials, allowedScope, fetchFn, rateLimiter: new adapters.GlobalRateLimiter({ maxRequests: 1000, windowMs: 60_000 }) });
  return { adapter, fetchFn, apiCalls };
}
afterEach(() => vi.useRealTimers());

it('lists only allowed spreadsheets with metadata fields and returns grounded ids/titles/urls', async () => {
  const { adapter, apiCalls } = setup();
  expect(await adapter.execute('sheets.list_spreadsheets', { query: '', limit: 10 })).toEqual([{ id, title: 'ATI Test Tracker', url: 'https://docs.google.com/spreadsheets/d/' + id + '/edit' }]);
  expect(apiCalls).toHaveLength(1);
  expect(apiCalls[0]!.url.pathname).toBe('/v4/spreadsheets/' + id);
  expect(apiCalls[0]!.url.searchParams.get('fields')).toBe('properties.title');
  expect(await adapter.execute('sheets.list_spreadsheets', { query: 'no-match', limit: 1 })).toEqual([]);
});

it('lists child sheets with numeric id zero preserved and parent id, including quoted titles', async () => {
  const { adapter, apiCalls } = setup();
  expect(await adapter.execute('sheets.list_sheets', { spreadsheetId: id, query: '', limit: 10 })).toEqual([
    { id: 0, title: 'Tasks', spreadsheetId: id }, { id: 2, title: "Team's Tasks", spreadsheetId: id },
  ]);
  expect(apiCalls[0]!.url.searchParams.get('fields')).toBe('sheets.properties(sheetId,title)');
  expect(await adapter.execute('sheets.list_sheets', { spreadsheetId: id, query: 'team', limit: 1 })).toHaveLength(1);
});

it('reads a bounded A1 range, encodes it as one path segment and normalizes scalar values', async () => {
  const controller = new AbortController();
  const { adapter, apiCalls } = setup(() => json({ range: 'Tasks!A1:B3', values: [['A', 2], [true, null], ['last']] }));
  expect(await adapter.execute('sheets.read_range', { spreadsheetId: id, range: 'Tasks!A1:B3', limit: 2 }, { signal: controller.signal })).toEqual({ range: 'Tasks!A1:B3', values: [['A', '2'], ['true', '']] });
  expect(decodeURIComponent(apiCalls[0]!.url.pathname)).toBe('/v4/spreadsheets/' + id + '/values/Tasks!A1:B3');
  expect(apiCalls[0]!.init).toMatchObject({ method: 'GET', signal: controller.signal, redirect: 'error', headers: { Authorization: 'Bearer fixture-secret-token' } });
});

it('appends escaped data once to a quoted tab with the required options, validating the parent first', async () => {
  const { adapter, apiCalls } = setup((url, init) => init.method === 'POST'
    ? json({ spreadsheetId: id, updates: { updatedRange: "'Team''s Tasks'!A4:D5", updatedRows: 2 } }) : json(metadata));
  const rows = [['=SUM(A1)', '+1', '-2', '@name'], [' =1', '\t+1', ' -1', ' @x']];
  const original = structuredClone(rows);
  expect(await adapter.execute('sheets.append_rows', { spreadsheetId: id, sheet: "Team's Tasks", rows })).toMatchObject({ spreadsheetId: id, updatedRows: 2 });
  expect(rows).toEqual(original);
  expect(apiCalls.map(call => call.init.method)).toEqual(['GET', 'POST']);
  const write = apiCalls[1]!;
  expect(decodeURIComponent(write.url.pathname)).toContain("/values/'Team''s Tasks'!A1:append");
  expect(write.url.searchParams.get('valueInputOption')).toBe('USER_ENTERED');
  expect(write.url.searchParams.get('insertDataOption')).toBe('INSERT_ROWS');
  expect(JSON.parse(String(write.init.body))).toMatchObject({ majorDimension: 'ROWS', values: rows.map(row => row.map(cell => "'" + cell)) });
});

it.each([undefined, {}, { spreadsheets: [] }, { spreadsheets: [other] }])('rejects missing/outside allowlist before any fetch: %j', async scope => {
  const { adapter, fetchFn } = setup(undefined, scope ?? {});
  await expect(adapter.execute('sheets.append_rows', { spreadsheetId: id, sheet: 'Tasks', rows: [['x']] })).rejects.toMatchObject({ category: 'AUTH_ERROR' });
  expect(fetchFn).not.toHaveBeenCalled();
});

it.each(['https://docs.google.com/spreadsheets/d/other/edit#A1', '[other]Tasks!A1:B2', 'other/Tasks!A1:B2', 'Tasks!A1:B2?x=1', 'Tasks!A1:B2#other'])('rejects cross-document or injected range before fetch: %s', async range => {
  const { adapter, fetchFn } = setup();
  await expect(adapter.execute('sheets.read_range', { spreadsheetId: id, range, limit: 10 })).rejects.toMatchObject({ category: 'VALIDATION' });
  expect(fetchFn).not.toHaveBeenCalled();
});

it('rejects a tab from another spreadsheet before the write, and validates input bounds locally', async () => {
  const { adapter, apiCalls, fetchFn } = setup();
  await expect(adapter.execute('sheets.append_rows', { spreadsheetId: id, sheet: 'Other', rows: [['x']] })).rejects.toMatchObject({ category: 'NOT_FOUND' });
  expect(apiCalls.map(call => call.init.method)).toEqual(['GET']);
  const count = apiCalls.length;
  for (const rows of [[], Array(21).fill(['x']), [Array(21).fill('x')], [['x'.repeat(1001)]], [[3]]]) {
    await expect(adapter.execute('sheets.append_rows', { spreadsheetId: id, sheet: 'Tasks', rows })).rejects.toMatchObject({ category: 'VALIDATION' });
  }
  await expect(adapter.execute('sheets.read_range', { spreadsheetId: id, range: 'A1:B2', limit: 51 })).rejects.toMatchObject({ category: 'VALIDATION' });
  expect(apiCalls).toHaveLength(count);
});

it.each([[401, 'AUTH_ERROR'], [403, 'AUTH_ERROR'], [404, 'NOT_FOUND'], [400, 'VALIDATION'], [422, 'VALIDATION'], [500, 'SERVER_ERROR']])('maps read HTTP %i to %s without exposing body', async (status, category) => {
  const { adapter } = setup(() => json({ secret: privateKey, token: 'fixture-secret-token' }, status));
  try { await adapter.execute('sheets.read_range', { spreadsheetId: id, range: 'A1:B2' }); expect.fail(); }
  catch (error: any) { expect(error.category).toBe(category); expect(error.message).not.toContain('secret'); expect(error.cause).toBeUndefined(); }
});

it('honors Retry-After without retrying an append', async () => {
  vi.useFakeTimers();
  const { adapter, apiCalls } = setup((_url, init) => init.method === 'POST' ? json({}, 429, { 'Retry-After': '2' }) : json(metadata));
  const pending = adapter.execute('sheets.append_rows', { spreadsheetId: id, sheet: 'Tasks', rows: [['x']] });
  const assertion = expect(pending).rejects.toMatchObject({ category: 'RATE_LIMIT', retryable: false });
  await vi.advanceTimersByTimeAsync(1999); expect(apiCalls.filter(call => call.init.method === 'POST')).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1); await assertion;
  expect(apiCalls.filter(call => call.init.method === 'POST')).toHaveLength(1);
});

it.each(['500', 'network', 'json', 'invalid-success', 'timeout'])('makes append result UNKNOWN after dispatch: %s', async mode => {
  const controller = new AbortController();
  let sent = false;
  const { adapter, apiCalls } = setup(async (_url, init) => {
    if (init.method !== 'POST') return json(metadata);
    sent = true;
    if (mode === '500') return json({}, 500);
    if (mode === 'json') return new Response('invalid');
    if (mode === 'invalid-success') return json({});
    if (mode === 'network') throw new Error('Authorization: fixture-secret-token');
    return new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true }));
  });
  const pending = adapter.execute('sheets.append_rows', { spreadsheetId: id, sheet: 'Tasks', rows: [['x']] }, { signal: controller.signal });
  const assertion = expect(pending).rejects.toMatchObject({ category: 'UNKNOWN', retryable: false });
  if (mode === 'timeout') { await vi.waitFor(() => expect(sent).toBe(true)); controller.abort(new Error('real timeout')); }
  await assertion;
  expect(apiCalls.filter(call => call.init.method === 'POST')).toHaveLength(1);
});

it('does not dispatch a pre-cancelled request and uses a rate bucket per account across instances', async () => {
  const { adapter, fetchFn } = setup(); const controller = new AbortController(); controller.abort();
  await expect(adapter.execute('sheets.read_range', { spreadsheetId: id, range: 'A1:B2' }, { signal: controller.signal })).rejects.toMatchObject({ category: 'NETWORK' });
  expect(fetchFn).not.toHaveBeenCalled();
  const limiter = new adapters.GlobalRateLimiter({ maxRequests: 1, windowMs: 60_000 });
  const wait = vi.spyOn(limiter, 'waitForSlot').mockResolvedValue(true);
  const one = new adapters.SheetsAdapter({ credentials, allowedScope: { spreadsheets: [id] }, fetchFn, rateLimiter: limiter });
  await one.execute('sheets.list_spreadsheets', { query: '', limit: 10 });
  expect(wait.mock.calls[0]![0]).toBe('sheets:' + credentials.clientEmail);
});
