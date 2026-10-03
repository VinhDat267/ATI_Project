import { expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import * as adapters from '../src/index.js';

// W3-08: free-text read results are bounded before they reach planner prompts, output_json or templates.
const MARKER = '…[đã cắt]';
const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const json = (data: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(data), { status, headers });
const unlimited = () => new adapters.GlobalRateLimiter({ maxRequests: 10_000, windowMs: 60_000 });
const hasLoneSurrogate = (value: string) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value);

function google(handler: (url: URL) => Response, token: () => Response = () => json({ access_token: 'fixture-secret-token', token_type: 'Bearer', expires_in: 3600 })) {
  const calls: URL[] = [];
  const fetchFn = vi.fn(async (url: any) => {
    if (String(url) === 'https://oauth2.googleapis.com/token') return token();
    const parsed = new URL(String(url)); calls.push(parsed); return handler(parsed);
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

const sheetId = 'spreadsheet_fixture_123456';
const sheetCredentials = { clientEmail: 'bounded-sheets@unit.iam.gserviceaccount.com', privateKey };

it('caps Sheets read_range at 26 columns and 500 characters per cell, marking the result truncated', async () => {
  const wide = Array.from({ length: 10 }, () => Array.from({ length: 300 }, () => 'x'.repeat(5000)));
  const { fetchFn } = google(() => json({ range: 'Tasks!A1:KN10', values: wide }));
  const adapter = new adapters.SheetsAdapter({ credentials: sheetCredentials, allowedScope: { spreadsheets: [sheetId] }, fetchFn, rateLimiter: unlimited() });
  const result = await adapter.execute('sheets.read_range', { spreadsheetId: sheetId, range: 'Tasks!A1:KN10', limit: 10 });
  expect(result.truncated).toBe(true);
  expect(result.values).toHaveLength(10);
  for (const row of result.values) {
    expect(row).toHaveLength(26);
    for (const cell of row) { expect(cell.length).toBeLessThanOrEqual(500); expect(cell.endsWith(MARKER)).toBe(true); }
  }
  expect(JSON.stringify(result).length).toBeLessThan(150_000);
});

it('never splits a surrogate pair when clipping a Sheets cell', async () => {
  const { fetchFn } = google(() => json({ range: 'A1:A1', values: [['😀'.repeat(400)]] }));
  const adapter = new adapters.SheetsAdapter({ credentials: sheetCredentials, allowedScope: { spreadsheets: [sheetId] }, fetchFn, rateLimiter: unlimited() });
  const result = await adapter.execute('sheets.read_range', { spreadsheetId: sheetId, range: 'A1:A1' });
  const cell = result.values[0][0] as string;
  expect(cell.length).toBeLessThanOrEqual(500);
  expect(cell.endsWith(MARKER)).toBe(true);
  expect(hasLoneSurrogate(cell)).toBe(false);
});

it('keeps small Sheets reads unchanged, without a truncated flag', async () => {
  const { fetchFn } = google(() => json({ range: 'Tasks!A1:B2', values: [['a', 'b'], ['c']] }));
  const adapter = new adapters.SheetsAdapter({ credentials: sheetCredentials, allowedScope: { spreadsheets: [sheetId] }, fetchFn, rateLimiter: unlimited() });
  expect(await adapter.execute('sheets.read_range', { spreadsheetId: sheetId, range: 'Tasks!A1:B2' })).toEqual({ range: 'Tasks!A1:B2', values: [['a', 'b'], ['c']] });
});

it('does not reveal the service-account email when the Sheets rate limiter refuses a slot', async () => {
  const { fetchFn } = google(() => json({ range: 'A1:A1', values: [] }));
  const refusing = { waitForSlot: async () => false } as unknown as adapters.GlobalRateLimiter;
  const adapter = new adapters.SheetsAdapter({ credentials: sheetCredentials, allowedScope: { spreadsheets: [sheetId] }, fetchFn, rateLimiter: refusing });
  try { await adapter.execute('sheets.read_range', { spreadsheetId: sheetId, range: 'A1:A1' }); expect.fail('must reject'); }
  catch (error: any) {
    expect(error).toMatchObject({ category: 'RATE_LIMIT' });
    expect(error.message + JSON.stringify(error)).not.toContain(sheetCredentials.clientEmail);
  }
});

const calendarId = 'ati@group.calendar.google.com';
const calendarCredentials = { clientEmail: 'bounded-calendar@unit.iam.gserviceaccount.com', privateKey };
const window = { timeMin: '2026-10-09T00:00:00+07:00', timeMax: '2026-10-10T00:00:00+07:00' };

it('caps Calendar event titles at 200 characters and marks the list truncated', async () => {
  const item = (n: number, summary: string) => ({ id: 'evt' + n, summary, htmlLink: 'https://www.google.com/calendar/event?eid=' + n, start: { dateTime: '2026-10-09T09:00:00+07:00' }, end: { dateTime: '2026-10-09T10:00:00+07:00' } });
  const { fetchFn } = google(() => json({ items: [item(1, 'T'.repeat(5000)), item(2, 'Short')] }));
  const adapter = new adapters.CalendarAdapter({ credentials: calendarCredentials, allowedScope: { calendars: [calendarId] }, fetchFn, rateLimiter: unlimited() });
  const result = await adapter.execute('calendar.list_events', { calendarId, ...window });
  expect(result.truncated).toBe(true);
  expect(result.events[0].title.length).toBeLessThanOrEqual(200);
  expect(result.events[0].title.endsWith(MARKER)).toBe(true);
  expect(result.events[1].title).toBe('Short');
});

it.each([
  ['forbidden JSON reason', () => json({ error: { errors: [{ reason: 'forbidden' }] } }, 403, { 'Retry-After': '1' })],
  ['insufficientPermissions JSON reason', () => json({ error: { errors: [{ reason: 'insufficientPermissions' }] } }, 403)],
])('treats a Calendar 403 with %s as AUTH_ERROR after one request, without waiting', async (_name, response) => {
  vi.useFakeTimers();
  try {
    const { fetchFn, calls } = google(response);
    const adapter = new adapters.CalendarAdapter({ credentials: calendarCredentials, allowedScope: { calendars: [calendarId] }, fetchFn, rateLimiter: unlimited() });
    await expect(adapter.execute('calendar.list_events', { calendarId, ...window })).rejects.toMatchObject({ category: 'AUTH_ERROR', statusCode: 403 });
    expect(calls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

const DB = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const DS = '11111111-2222-3333-4444-555555555555';
const PAGE = '22222222-3333-4444-5555-666666666666';
const rich = (content: string) => [{ type: 'text', text: { content }, plain_text: content }];

it('caps each Notion property at 500 characters and marks the query result truncated', async () => {
  const pageWith = (notes: string) => ({ object: 'page', id: PAGE, url: 'https://www.notion.so/' + PAGE.replaceAll('-', ''), in_trash: false,
    parent: { type: 'data_source_id', data_source_id: DS, database_id: DB },
    properties: { Name: { type: 'title', title: rich('N'.repeat(3000)) }, Notes: { type: 'rich_text', rich_text: rich('n'.repeat(20_000)) } } });
  const fetchFn = vi.fn(async (url: any) => {
    const path = new URL(String(url)).pathname;
    if (path === '/v1/databases/' + DB) return json({ object: 'database', id: DB, title: rich('Notes'), url: 'https://www.notion.so/' + DB.replaceAll('-', ''), in_trash: false, data_sources: [{ id: DS }] });
    if (path === '/v1/data_sources/' + DS) return json({ object: 'data_source', id: DS, parent: { type: 'database_id', database_id: DB }, in_trash: false, properties: { Name: { type: 'title' }, Notes: { type: 'rich_text' } } });
    return json({ object: 'list', results: [pageWith('x')], has_more: false, next_cursor: null });
  }) as unknown as typeof fetch;
  const adapter = new adapters.NotionAdapter({ credentials: { token: 'synthetic-notion-token' }, allowedScope: { databases: [DB] }, fetchFn, rateLimiter: unlimited() });
  const result = await adapter.execute('notion.query_database', { databaseId: DB });
  expect(result.truncated).toBe(true);
  const [first] = result.pages;
  for (const value of Object.values(first.properties) as string[]) { expect(value.length).toBeLessThanOrEqual(500); expect(value.endsWith(MARKER)).toBe(true); }
  expect(first.title.length).toBeLessThanOrEqual(500);
});

const auth = (fetchFn: typeof fetch) => new adapters.GoogleServiceAccount({ credentials: { clientEmail: 'token-errors@unit.iam.gserviceaccount.com', privateKey }, fetchFn });

it.each([
  [400, { error: 'invalid_grant' }, 'AUTH_ERROR'],
  [401, { error: 'invalid_client' }, 'AUTH_ERROR'],
  [403, { error: 'access_denied' }, 'AUTH_ERROR'],
  [429, { error: 'rate_limit' }, 'RATE_LIMIT'],
  [500, { error: 'internal' }, 'SERVER_ERROR'],
  [503, { error: 'unavailable' }, 'SERVER_ERROR'],
] as const)('classifies a Google token endpoint HTTP %s (%j) as %s without leaking the key', async (status, body, category) => {
  const fetchFn = vi.fn(async () => json(body, status)) as unknown as typeof fetch;
  try { await auth(fetchFn).getAccessToken('scope-' + status); expect.fail('must reject'); }
  catch (error: any) {
    expect(error).toMatchObject({ category });
    expect(error.message + JSON.stringify(error)).not.toContain('PRIVATE KEY');
    expect(error.cause).toBeUndefined();
  }
});

it('classifies token transport failure and cancellation as NETWORK, not as bad credentials', async () => {
  const failing = vi.fn(async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
  await expect(auth(failing).getAccessToken('scope-network')).rejects.toMatchObject({ category: 'NETWORK' });
  const controller = new AbortController(); controller.abort();
  const unused = vi.fn() as unknown as typeof fetch;
  await expect(auth(unused).getAccessToken('scope-abort', controller.signal)).rejects.toMatchObject({ category: 'NETWORK' });
  expect(unused).not.toHaveBeenCalled();
});

it('keeps malformed private keys and malformed token bodies distinct', async () => {
  const fetchFn = vi.fn(async () => json({ access_token: '' })) as unknown as typeof fetch;
  await expect(new adapters.GoogleServiceAccount({ credentials: { clientEmail: 'x@unit.iam.gserviceaccount.com', privateKey: 'not-a-key' }, fetchFn }).getAccessToken('scope-key'))
    .rejects.toMatchObject({ category: 'AUTH_ERROR' });
  expect(fetchFn).not.toHaveBeenCalled();
  await expect(auth(fetchFn).getAccessToken('scope-body')).rejects.toMatchObject({ category: 'SERVER_ERROR' });
});
