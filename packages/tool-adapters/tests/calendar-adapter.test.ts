import { afterEach, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import * as adapters from '../src/index.js';

const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const credentials = { clientEmail: 'calendar@unit.iam.gserviceaccount.com', privateKey };
const id = 'ati@group.calendar.google.com';
const start = '2026-10-09T15:00:00+07:00'; const end = '2026-10-09T16:00:00+07:00';
const args = { calendarId: id, summary: 'Review', start, end };
const event = { id: 'evt_fixture', summary: 'Review', htmlLink: 'https://www.google.com/calendar/event?eid=fixture', start: { dateTime: start }, end: { dateTime: end } };
const json = (data: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(data), { status, headers });
function setup(handler: (url: URL, init: RequestInit) => Response | Promise<Response> = () => json(event), allowedScope: any = { calendars: [id] }) {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const fetchFn = vi.fn(async (url: any, init: any) => {
    if (String(url) === 'https://oauth2.googleapis.com/token') return json({ access_token: 'fixture-secret-token', token_type: 'Bearer', expires_in: 3600 });
    const parsed = new URL(String(url)); calls.push({ url: parsed, init }); return handler(parsed, init);
  }) as unknown as typeof fetch;
  const adapter = new adapters.CalendarAdapter({ credentials, allowedScope, fetchFn, rateLimiter: new adapters.GlobalRateLimiter({ maxRequests: 1000, windowMs: 60_000 }) });
  return { adapter, fetchFn, calls };
}
afterEach(() => vi.useRealTimers());

it('lists only allowlisted calendar metadata, filters titles and checks connection without writes', async () => {
  const { adapter, calls } = setup(() => json({ id, summary: 'ATI Review', timeZone: 'Asia/Ho_Chi_Minh' }));
  expect(await adapter.execute('calendar.list_calendars', { query: '', limit: 10 })).toEqual([{ id, title: 'ATI Review', timeZone: 'Asia/Ho_Chi_Minh' }]);
  expect(calls[0]!.url.hostname).toBe('www.googleapis.com');
  expect(decodeURIComponent(calls[0]!.url.pathname)).toBe('/calendar/v3/calendars/' + id);
  expect(calls[0]!.init).toMatchObject({ method: 'GET', redirect: 'error', headers: { Authorization: 'Bearer fixture-secret-token' } });
  expect(await adapter.execute('calendar.list_calendars', { query: 'absent' })).toEqual([]);
  expect(await adapter.checkConnection()).toBe(true);
  expect(calls.every(c => c.init.method === 'GET')).toBe(true);
});
it('lists bounded events with expansion, chronological ordering and normalized timed/all-day output', async () => {
  const { adapter, calls } = setup(() => json({ items: [event, { ...event, id: 'all_day', summary: undefined, start: { date: '2026-10-10' }, end: { date: '2026-10-11' } }] }));
  const signal = new AbortController().signal;
  expect(await adapter.execute('calendar.list_events', { calendarId: id, timeMin: start, timeMax: end, query: 'review & prep', limit: 20 }, { signal })).toEqual({ events: [
    { id: event.id, title: 'Review', start, end, url: event.htmlLink },
    { id: 'all_day', title: '(Không có tiêu đề)', start: '2026-10-10', end: '2026-10-11', url: event.htmlLink },
  ] });
  const params = calls[0]!.url.searchParams;
  expect(Object.fromEntries(params)).toEqual({ timeMin: start, timeMax: end, singleEvents: 'true', orderBy: 'startTime', maxResults: '20', q: 'review & prep' });
  expect(calls[0]!.init.signal).toBe(signal);
});
it('creates once with explicit time offsets, no attendees, sendUpdates none and literal description data', async () => {
  const { adapter, calls } = setup(); const signal = new AbortController().signal;
  expect(await adapter.execute('calendar.create_event', { ...args, description: '<b>hello</b> & text', location: 'Room A' }, { signal })).toEqual({ id: event.id, title: 'Review', start, end, url: event.htmlLink });
  expect(calls).toHaveLength(1);
  expect(calls[0]!.url.searchParams.get('sendUpdates')).toBe('none');
  expect(calls[0]!.init).toMatchObject({ method: 'POST', signal, headers: { 'Content-Type': 'application/json' } });
  expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ summary: 'Review', description: '&lt;b&gt;hello&lt;/b&gt; &amp; text', location: 'Room A', start: { dateTime: start }, end: { dateTime: end } });
});
it('follows an empty Calendar event page instead of reporting no events and bounds returned rows', async () => {
  const { adapter, calls } = setup(url => url.searchParams.has('pageToken') ? json({ items: [event, { ...event, id: 'next' }], nextPageToken: 'more' }) : json({ items: [], nextPageToken: 'page & two' }));
  const value = await adapter.execute('calendar.list_events', { calendarId: id, timeMin: start, timeMax: end, limit: 1 });
  expect(value.events.map((row: any) => row.id)).toEqual([event.id]);
  expect(calls).toHaveLength(2); expect(calls[1]!.url.searchParams.get('pageToken')).toBe('page & two');
});
it('rejects a repeated pagination token rather than silently returning an incomplete read', async () => {
  const { adapter, calls } = setup(() => json({ items: [], nextPageToken: 'repeat' }));
  await expect(adapter.execute('calendar.list_events', { calendarId: id, timeMin: start, timeMax: end })).rejects.toMatchObject({ category: 'SERVER_ERROR' });
  expect(calls).toHaveLength(2);
});
it.each([{}, { calendars: [] }, { calendars: ['outside@group.calendar.google.com'] }])('blocks unscoped/outside resource before any fetch %j', async scope => {
  const { adapter, fetchFn } = setup(undefined, scope);
  await expect(adapter.execute('calendar.create_event', args)).rejects.toMatchObject({ category: 'AUTH_ERROR' });
  expect(fetchFn).not.toHaveBeenCalled();
});
it.each(['.', '..'])('rejects dot-segment resource ids before any fetch even when allowlisted: %s', async calendarId => {
  const { adapter, fetchFn } = setup(undefined, { calendars: [calendarId] });
  await expect(adapter.execute('calendar.create_event', { ...args, calendarId })).rejects.toMatchObject({ category: 'VALIDATION' });
  expect(fetchFn).not.toHaveBeenCalled();
});
it.each([
  { end: '2026-10-09T14:00:00+07:00' }, { end: start }, { end: '2026-10-10T15:00:01+07:00' },
  { start: '2026-10-09T15:00:00' }, { start: '2026-02-30T15:00:00Z' }, { start: '2026-10-09T24:00:00Z' },
  { start: '2026-10-09T15:00:00+25:00' }, { summary: 'x'.repeat(201) }, { summary: ' ' }, { description: 'x'.repeat(4001) },
  { attendees: [{ email: 'outside@example.test' }] }, { calendarId: 'bad/id' },
])('rejects invalid create input before even token exchange %j', async patch => {
  const { adapter, fetchFn } = setup();
  await expect(adapter.execute('calendar.create_event', { ...args, ...patch })).rejects.toMatchObject({ category: 'VALIDATION' });
  expect(fetchFn).not.toHaveBeenCalled();
});
it.each([
  { timeMin: start, timeMax: '2026-11-09T16:00:00+07:00' }, { timeMin: start, timeMax: start },
  { timeMin: '2026-10-09T15:00:00', timeMax: end }, { timeMin: start, timeMax: end, limit: 21 },
])('rejects invalid event read window before fetch %j', async input => {
  const { adapter, fetchFn } = setup();
  await expect(adapter.execute('calendar.list_events', { calendarId: id, ...input })).rejects.toMatchObject({ category: 'VALIDATION' });
  expect(fetchFn).not.toHaveBeenCalled();
});
it.each([[401, 'AUTH_ERROR'], [403, 'AUTH_ERROR'], [404, 'NOT_FOUND'], [400, 'VALIDATION'], [500, 'UNKNOWN'], [503, 'UNKNOWN']] as const)('sanitizes write HTTP %s as %s without retry', async (status, category) => {
  const { adapter, calls } = setup(() => new Response('fixture-secret-token ' + privateKey, { status }));
  try { await adapter.execute('calendar.create_event', args); expect.fail('must reject'); }
  catch (error: any) {
    expect(error).toMatchObject({ category, statusCode: status, retryable: false });
    expect(error.message + JSON.stringify(error)).not.toContain('fixture-secret-token');
    expect(error.message + JSON.stringify(error)).not.toContain(privateKey); expect(error.cause).toBeUndefined();
  }
  expect(calls).toHaveLength(1);
});
it.each([429, 403])('waits Retry-After and retries one definite rate rejection %s, never more', async status => {
  vi.useFakeTimers();
  const { adapter, calls } = setup(() => json({ error: { errors: [{ reason: 'rateLimitExceeded' }] } }, status, { 'Retry-After': '1' }));
  const promise = adapter.execute('calendar.create_event', args);
  const assertion = expect(promise).rejects.toMatchObject({ category: 'RATE_LIMIT', statusCode: status, retryable: false });
  await vi.advanceTimersByTimeAsync(999); expect(calls).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1); await assertion; expect(calls).toHaveLength(2);
});
it.each([
  ['120', 429],
  [new Date(Date.now() + 120_000).toUTCString(), 403],
])('does not retry before a long Retry-After delay (%s, HTTP %s)', async (retryAfter, status) => {
  vi.useFakeTimers();
  const { adapter, calls } = setup(() => json({ error: { errors: [{ reason: 'rateLimitExceeded' }] } }, status, { 'Retry-After': retryAfter }));
  await expect(adapter.execute('calendar.create_event', args)).rejects.toMatchObject({ category: 'RATE_LIMIT', statusCode: status, retryable: false });
  expect(calls).toHaveLength(1);
});
it('retries transient read network twice and server once', async () => {
  let count = 0; const metadata = { id, summary: 'ATI', timeZone: 'UTC' };
  const network = setup(() => { if (count++ < 2) throw Error('secret'); return json(metadata); });
  expect(await network.adapter.checkConnection()).toBe(true); expect(network.calls).toHaveLength(3);
  count = 0; const server = setup(() => count++ === 0 ? json({}, 503) : json(metadata));
  expect(await server.adapter.checkConnection()).toBe(true); expect(server.calls).toHaveLength(2);
  const exhausted = setup(() => { throw Error('secret'); });
  await expect(exhausted.adapter.checkConnection()).rejects.toMatchObject({ category: 'NETWORK' }); expect(exhausted.calls).toHaveLength(3);
});
it('treats a real in-flight AbortSignal cancellation as UNKNOWN and never repeats a write', async () => {
  const controller = new AbortController(); let dispatched!: () => void;
  const reached = new Promise<void>(resolve => { dispatched = resolve; });
  const { adapter, calls } = setup((_url, init) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => reject(Error('fixture-secret-token')), { once: true }); dispatched();
  }));
  const promise = adapter.execute('calendar.create_event', args, { signal: controller.signal });
  const assertion = expect(promise).rejects.toMatchObject({ category: 'UNKNOWN', retryable: false });
  await reached; controller.abort(); await assertion; expect(calls).toHaveLength(1);
});
it.each(['network', 'json', 'shape'])('does not retry an indeterminate write %s', async mode => {
  const { adapter, calls } = setup(() => { if (mode === 'network') throw Error(privateKey); return mode === 'json' ? new Response(privateKey) : json({ id: 'partial' }); });
  await expect(adapter.execute('calendar.create_event', args)).rejects.toMatchObject({ category: 'UNKNOWN', retryable: false }); expect(calls).toHaveLength(1);
});
it('uses two distinct cached scopes for Sheets and Calendar with the same real signed service-account credentials', async () => {
  const scopes: string[] = [];
  const fetchFn = vi.fn(async (url: any, init: any) => {
    if (String(url).includes('oauth2.googleapis.com')) {
      const assertion = new URLSearchParams(String(init.body)).get('assertion')!;
      const scope = JSON.parse(Buffer.from(assertion.split('.')[1]!, 'base64url').toString()).scope;
      scopes.push(scope); return json({ access_token: 'scoped-token-' + scopes.length, token_type: 'Bearer', expires_in: 3600 });
    }
    if (String(url).includes('sheets.googleapis.com')) { expect(init.headers.Authorization).toBe('Bearer scoped-token-1'); return json({ properties: { title: 'ATI' } }); }
    expect(init.headers.Authorization).toBe('Bearer scoped-token-2'); return json({ id, summary: 'ATI', timeZone: 'UTC' });
  }) as unknown as typeof fetch;
  const sheets = new adapters.SheetsAdapter({ credentials, fetchFn, allowedScope: { spreadsheets: ['spreadsheet_fixture_123456'] } });
  const calendar = new adapters.CalendarAdapter({ credentials, fetchFn, allowedScope: { calendars: [id] } });
  await sheets.checkConnection(); await calendar.checkConnection(); await sheets.checkConnection(); await calendar.checkConnection();
  expect(scopes).toEqual([adapters.SHEETS_SCOPE, 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly']);
});
