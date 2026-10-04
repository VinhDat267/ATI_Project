import { expect, it, vi, afterEach } from 'vitest';
import * as adapters from '../src/index.js';
import { GlobalRateLimiter } from '../src/rate-limiter.js';

const DB = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const DS = '11111111-2222-3333-4444-555555555555';
const PAGE = '22222222-3333-4444-5555-666666666666';
const BLOCK = '33333333-4444-5555-6666-777777777777';
const OTHER = '99999999-8888-7777-6666-555555555555';
const TOKEN = 'synthetic-notion-token-must-not-leak';
const rich = (content: string) => [{ type: 'text', text: { content }, plain_text: content }];
const database = () => ({ object: 'database', id: DB, title: rich('ATI Notes'), url: 'https://www.notion.so/' + DB.replaceAll('-', ''), in_trash: false, data_sources: [{ id: DS, name: 'Notes' }] });
const source = () => ({ object: 'data_source', id: DS, parent: { type: 'database_id', database_id: DB }, in_trash: false, properties: {
  Name: { type: 'title' }, Notes: { type: 'rich_text' }, Stage: { type: 'select', select: { options: [{ name: 'Ready', id: 'existing-option' }] } }, Day: { type: 'date' }, Link: { type: 'url' }, Score: { type: 'number' }, Check: { type: 'checkbox' },
} });
const page = () => ({ object: 'page', id: PAGE, url: 'https://www.notion.so/' + PAGE.replaceAll('-', ''), in_trash: false, parent: { type: 'data_source_id', data_source_id: DS, database_id: DB }, properties: {
  Name: { type: 'title', title: rich('ATI Review') }, Notes: { type: 'rich_text', rich_text: rich('plain') }, Stage: { type: 'select', select: { name: 'Ready' } }, Day: { type: 'date', date: { start: '2026-10-03', end: null } }, Link: { type: 'url', url: 'https://example.test' }, Score: { type: 'number', number: 2 }, Check: { type: 'checkbox', checkbox: true },
} });
type Call = { url: string; method: string; body: any; headers: Headers; signal?: AbortSignal };
function setup(handler?: (call: Call) => Response | Promise<Response>, scope: string[] = [DB], limiter = new GlobalRateLimiter({ maxRequests: 10_000, windowMs: 1 })) {
  const calls: Call[] = [];
  const fetchFn = vi.fn(async (url: any, init: any) => {
    const call: Call = { url: String(url), method: init.method, body: init.body ? JSON.parse(init.body) : undefined, headers: new Headers(init.headers), signal: init.signal };
    calls.push(call);
    if (handler) return handler(call);
    const path = new URL(call.url).pathname;
    const value = path === '/v1/databases/' + DB ? database() : path === '/v1/data_sources/' + DS ? source() : path.endsWith('/query') ? { object: 'list', results: [page()], has_more: false, next_cursor: null }
      : call.method === 'PATCH' ? { object: 'list', results: [{ object: 'block', id: BLOCK }], has_more: false } : page();
    return new Response(JSON.stringify(value));
  }) as unknown as typeof fetch;
  const Adapter = (adapters as any).NotionAdapter; expect(Adapter).toBeTypeOf('function');
  return { adapter: new Adapter({ credentials: { token: TOKEN }, allowedScope: { databases: scope }, fetchFn, rateLimiter: limiter }), calls };
}
const ok = (value: any) => new Response(JSON.stringify(value));
afterEach(() => vi.useRealTimers());

it('lists only allowlisted databases with canonical ids, title filtering and pinned headers on every request', async () => {
  const { adapter, calls } = setup(undefined, [DB.replaceAll('-', '').toUpperCase(), DB]);
  expect(await adapter.execute('notion.search_databases', { query: 'ATI', limit: 10 })).toEqual([{ id: DB, title: 'ATI Notes', url: database().url }]);
  expect(calls.map(c => [c.method, new URL(c.url).pathname])).toEqual([['GET', '/v1/databases/' + DB]]);
  expect(calls[0]!.headers.get('Notion-Version')).toBe('2026-03-11'); expect(calls[0]!.headers.get('Authorization')).toBe('Bearer ' + TOKEN);
  expect(await adapter.execute('notion.search_databases', { query: 'missing' })).toEqual([]);
  expect(await adapter.checkConnection()).toBe(true);
  expect(calls.every(c => c.method === 'GET')).toBe(true);
});
it('resolves database to data source and queries title with flattened properties and normalized ids', async () => {
  const { adapter, calls } = setup(); const signal = new AbortController().signal;
  expect(await adapter.execute('notion.query_database', { databaseId: DB.replaceAll('-', '').toUpperCase(), query: 'ATI', limit: 20 }, { signal })).toEqual({ pages: [{ id: PAGE, title: 'ATI Review', url: page().url, properties: { Name: 'ATI Review', Notes: 'plain', Stage: 'Ready', Day: '2026-10-03', Link: 'https://example.test', Score: '2', Check: 'true' } }] });
  expect(calls.map(c => new URL(c.url).pathname)).toEqual(['/v1/databases/' + DB, '/v1/data_sources/' + DS, '/v1/data_sources/' + DS + '/query']);
  expect(calls[2]!.method).toBe('POST'); expect(calls[2]!.body).toEqual({ page_size: 20, filter: { property: 'Name', title: { contains: 'ATI' } } });
  expect(calls.every(c => c.headers.get('Notion-Version') === '2026-03-11' && c.signal === signal)).toBe(true);
});
async function queryProperties(properties: Record<string, any>) {
  const { adapter, calls } = setup(call => ok(call.url.endsWith('/query')
    ? { object: 'list', results: [{ ...page(), properties: { ...page().properties, ...properties } }], has_more: false }
    : call.url.includes('/databases/') ? database() : source()));
  const result = await adapter.execute('notion.query_database', { databaseId: DB });
  return { properties: result.pages[0].properties, calls };
}
it('preserves formula primitives, false and zero, dates and explicitly unavailable results', async () => {
  const values = {
    Label: { type: 'string', string: 'Ready for release' }, Approved: { type: 'boolean', boolean: true },
    Rejected: { type: 'boolean', boolean: false }, Zero: { type: 'number', number: 0 },
    Period: { type: 'date', date: { start: '2026-10-03', end: '2026-10-04' } },
    Empty: { type: 'string', string: null }, Unsupported: { type: 'unsupported', unsupported: {} },
  };
  const { properties } = await queryProperties(Object.fromEntries(Object.entries(values).map(([key, formula]) => [key, { type: 'formula', formula }])));
  expect(properties).toMatchObject({ Label: 'Ready for release', Approved: 'true', Rejected: 'false', Zero: '0', Period: '2026-10-03 → 2026-10-04', Empty: '', Unsupported: '[unsupported]' });
});
it('preserves recursive rollup values and marks incomplete rollups', async () => {
  const { properties } = await queryProperties({
    Labels: { type: 'rollup', rollup: { type: 'array', array: [
      { type: 'formula', formula: { type: 'string', string: 'One' } },
      { type: 'formula', formula: { type: 'string', string: 'Two' } },
      { type: 'formula', formula: { type: 'boolean', boolean: false } },
    ] } },
    Total: { type: 'rollup', rollup: { type: 'number', number: 0 } },
    Pending: { type: 'rollup', rollup: { type: 'incomplete', incomplete: {} } },
  });
  expect(properties).toMatchObject({ Labels: 'One, Two, false', Total: '0', Pending: '[incomplete]' });
});
it('returns file display names without signed download URLs', async () => {
  const { properties } = await queryProperties({
    Attachments: { type: 'files', files: [
      { name: 'Project brief.pdf', type: 'file', file: { url: 'https://files.example.test/signed?secret=fixture', expiry_time: '2026-10-04T00:00:00Z' } },
      { name: 'Notes.txt', type: 'external', external: { url: 'https://example.test/notes.txt' } },
    ] }, EmptyFiles: { type: 'files', files: [] },
  });
  expect(properties.Attachments).toBe('Project brief.pdf, Notes.txt'); expect(properties.EmptyFiles).toBe('');
  expect(JSON.stringify(properties)).not.toContain('signed?secret'); expect(JSON.stringify(properties)).not.toContain('/notes.txt');
});
it('preserves unique ID labels, zero and nullable prefix or number', async () => {
  const { properties } = await queryProperties({
    TaskID: { type: 'unique_id', unique_id: { prefix: 'TASK', number: 42 } },
    ZeroID: { type: 'unique_id', unique_id: { prefix: null, number: 0 } },
    PrefixOnly: { type: 'unique_id', unique_id: { prefix: 'TASK', number: null } },
    EmptyID: { type: 'unique_id', unique_id: { prefix: null, number: null } },
  });
  expect(properties).toMatchObject({ TaskID: 'TASK-42', ZeroID: '0', PrefixOnly: 'TASK', EmptyID: '' });
});
it('preserves place names, addresses and coordinates including zero', async () => {
  const { properties } = await queryProperties({
    Office: { type: 'place', place: { name: 'ATI Office', address: '123 Test Street', lat: 10.5, lon: 106.5, google_place_id: 'provider-private-id' } },
    Origin: { type: 'place', place: { name: null, address: null, lat: 0, lon: 0 } },
    EmptyPlace: { type: 'place', place: null },
  });
  expect(properties).toMatchObject({ Office: 'ATI Office; 123 Test Street; 10.5, 106.5', Origin: '0, 0', EmptyPlace: '' });
  expect(JSON.stringify(properties)).not.toContain('provider-private-id');
});
it('preserves wiki verification state, period and verifier without unrelated user details', async () => {
  const { properties } = await queryProperties({
    Verified: { type: 'verification', verification: { state: 'verified', date: { start: '2026-10-03T00:00:00Z', end: '2026-10-04T00:00:00Z' }, verified_by: { id: OTHER, name: 'Reviewer', person: { email: 'private@example.test' } } } },
    Unverified: { type: 'verification', verification: { state: 'unverified', date: null, verified_by: null } },
    Expired: { type: 'verification', verification: { state: 'expired', date: null, verified_by: null } },
    EmptyVerification: { type: 'verification', verification: null },
  });
  expect(properties).toMatchObject({ Verified: 'verified; 2026-10-03T00:00:00Z → 2026-10-04T00:00:00Z; Reviewer', Unverified: 'unverified', Expired: 'expired', EmptyVerification: '' });
  expect(JSON.stringify(properties)).not.toContain('private@example.test');
});
it('marks unknown and API-unavailable property values instead of silently reporting empty', async () => {
  const { properties } = await queryProperties({
    Future: { type: 'future_property', future_property: { internal: 'provider-private-payload' } },
    Button: { type: 'button', button: {} },
  });
  expect(properties).toMatchObject({ Future: '[unsupported]', Button: '[unavailable]' });
  expect(JSON.stringify(properties)).not.toContain('provider-private-payload');
});
it('marks a partial relation snapshot without following resources beyond its scope', async () => {
  const ids = Array.from({ length: 25 }, () => ({ id: OTHER }));
  const { properties, calls } = await queryProperties({
    Related: { type: 'relation', relation: ids, has_more: true },
    Complete: { type: 'relation', relation: [{ id: PAGE }], has_more: false },
  });
  // W3-08: a long relation list is clipped at 500 characters; the marker still signals an incomplete list.
  expect(properties.Related.length).toBeLessThanOrEqual(500);
  expect(properties.Related.startsWith(ids.slice(0, 5).map(item => item.id).join(', '))).toBe(true);
  expect(properties.Related.endsWith('…[đã cắt]')).toBe(true);
  expect(properties.Complete).toBe(PAGE); expect(calls).toHaveLength(3);
});
it('creates with data-source parent and validated property conversions; splits content into plain 2000-char paragraphs', async () => {
  const { adapter, calls } = setup(); const content = '# ' + 'x'.repeat(3998);
  expect(await adapter.execute('notion.create_page', { databaseId: DB, title: 'Review', content, properties: { Notes: '*plain*', Stage: 'Ready', Day: '2026-10-03', Link: 'https://example.test', Score: '2.5' } })).toEqual({ id: PAGE, url: page().url });
  const write = calls.find(c => c.method === 'POST' && new URL(c.url).pathname === '/v1/pages')!;
  expect(write.body.parent).toEqual({ type: 'data_source_id', data_source_id: DS });
  expect(write.body.properties).toEqual({ Name: { title: [{ type: 'text', text: { content: 'Review' } }] }, Notes: { rich_text: [{ type: 'text', text: { content: '*plain*' } }] }, Stage: { select: { name: 'Ready' } }, Day: { date: { start: '2026-10-03' } }, Link: { url: 'https://example.test' }, Score: { number: 2.5 } });
  expect(write.body.children.map((b: any) => b.type)).toEqual(['paragraph', 'paragraph']);
  expect(write.body.children.map((b: any) => b.paragraph.rich_text[0].text.content.length)).toEqual([2000, 2000]);
  expect(write.body.children.map((b: any) => b.paragraph.rich_text[0].text.content).join('')).toBe(content);
});
it('does not split an emoji surrogate pair at a content chunk boundary', async () => {
  const { adapter, calls } = setup(); const content = 'x'.repeat(1999) + '🚀' + 'z';
  await adapter.execute('notion.create_page', { databaseId: DB, title: 'Emoji', content });
  const chunks = calls.at(-1)!.body.children.map((b: any) => b.paragraph.rich_text[0].text.content);
  expect(chunks).toEqual(['x'.repeat(1999), '🚀z']);
});
it('checks page and its real data-source parent before appending plain text', async () => {
  const { adapter, calls } = setup();
  expect(await adapter.execute('notion.append_text', { pageId: PAGE.replaceAll('-', '').toUpperCase(), text: '**plain**' })).toEqual({ pageId: PAGE, blockIds: [BLOCK], url: page().url });
  expect(calls.map(c => [c.method, new URL(c.url).pathname])).toEqual([['GET', '/v1/pages/' + PAGE], ['GET', '/v1/data_sources/' + DS], ['PATCH', '/v1/blocks/' + PAGE + '/children']]);
  expect(calls[2]!.body).toEqual({ children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: '**plain**' } }] } }] });
});
it.each(['notion.query_database', 'notion.create_page'])('rejects an outside database before any fetch for %s', async tool => {
  const { adapter, calls } = setup(); await expect(adapter.execute(tool, { databaseId: OTHER, ...(tool === 'notion.create_page' ? { title: 'No' } : {}) })).rejects.toMatchObject({ category: 'AUTH_ERROR' }); expect(calls).toHaveLength(0);
});
it('requires an explicit nonempty allowlist before any fetch', async () => {
  const { adapter, calls } = setup(undefined, []); await expect(adapter.execute('notion.search_databases', { query: '' })).rejects.toMatchObject({ category: 'AUTH_ERROR' }); expect(calls).toHaveLength(0);
});
it.each(['outside', 'page_parent', 'in_trash', 'source_mismatch'])('rejects %s parent before append write', async kind => {
  const { adapter, calls } = setup(call => {
    if (call.url.includes('/pages/')) { const p = page(); if (kind === 'page_parent') p.parent = { type: 'page_id', page_id: OTHER } as any; if (kind === 'in_trash') p.in_trash = true; return ok(p); }
    const s = source(); if (kind === 'outside') s.parent.database_id = OTHER; if (kind === 'source_mismatch') s.id = OTHER; return ok(s);
  });
  await expect(adapter.execute('notion.append_text', { pageId: PAGE, text: 'No' })).rejects.toMatchObject({ category: kind === 'source_mismatch' ? 'SERVER_ERROR' : 'AUTH_ERROR' });
  expect(calls.filter(c => c.method === 'PATCH' || c.method === 'POST')).toHaveLength(0);
});
it.each([{ Unknown: 'x' }, { Check: 'true' }, { Score: 'NaN' }, { Score: '' }, { Day: '2026-02-30' }, { Link: 'javascript:bad' }, { Name: 'override title' }, { Stage: 'New option that would mutate schema' }])('rejects unsupported or invalid properties %j before page write', async properties => {
  const { adapter, calls } = setup(); await expect(adapter.execute('notion.create_page', { databaseId: DB, title: 'No', properties })).rejects.toMatchObject({ category: 'VALIDATION' }); expect(calls.filter(c => c.url.endsWith('/pages') && c.method === 'POST')).toHaveLength(0);
});
it.each(['query', 'create'])('rejects ambiguous multi-source database before %s dispatch', async operation => {
  const { adapter, calls } = setup(() => ok({ ...database(), data_sources: [{ id: DS }, { id: OTHER }] }));
  await expect(adapter.execute(operation === 'query' ? 'notion.query_database' : 'notion.create_page', { databaseId: DB, ...(operation === 'create' ? { title: 'No' } : {}) })).rejects.toMatchObject({ category: 'VALIDATION' }); expect(calls).toHaveLength(1);
});
it.each([{ title: 'x'.repeat(201) }, { content: 'x'.repeat(4001), title: 'No' }, { title: 'No', unexpected: true }, { title: ' ' }, { title: 'No', databaseId: '../outside' }, { title: 'No', properties: null }])('rejects invalid input %j before fetch', async input => {
  const { adapter, calls } = setup(); await expect(adapter.execute('notion.create_page', { databaseId: DB, ...input })).rejects.toMatchObject({ category: 'VALIDATION' }); expect(calls).toHaveLength(0);
});
it.each([[401, 'AUTH_ERROR'], [403, 'AUTH_ERROR'], [404, 'NOT_FOUND'], [400, 'VALIDATION'], [409, 'VALIDATION'], [429, 'RATE_LIMIT'], [500, 'UNKNOWN'], [503, 'UNKNOWN'], [529, 'UNKNOWN']])('classifies create HTTP %i as %s without secret leakage or unknown replay', async (status, category) => {
  const { adapter, calls } = setup(call => call.url.endsWith('/pages') ? new Response(TOKEN + ' Authorization: Bearer secret', { status: status as number, headers: { 'Retry-After': '0' } }) : ok(call.url.includes('/databases/') ? database() : source()));
  const error = await adapter.execute('notion.create_page', { databaseId: DB, title: 'No' }).catch((e: any) => e);
  expect(error.category).toBe(category); expect(JSON.stringify(error) + error.message).not.toContain(TOKEN);
  expect(calls.filter(c => c.url.endsWith('/pages'))).toHaveLength(status === 429 ? 2 : 1);
});
it('never replays malformed successful create response', async () => {
  const { adapter, calls } = setup(call => call.url.endsWith('/pages') ? ok({ id: PAGE }) : ok(call.url.includes('/databases/') ? database() : source()));
  await expect(adapter.execute('notion.create_page', { databaseId: DB, title: 'No' })).rejects.toMatchObject({ category: 'UNKNOWN' }); expect(calls.filter(c => c.url.endsWith('/pages'))).toHaveLength(1);
});
it('uses the real AbortSignal for a dispatched write timeout and keeps UNKNOWN without retry', async () => {
  const controller = new AbortController();
  const { adapter, calls } = setup(call => call.url.endsWith('/pages') ? new Promise<Response>((_resolve, reject) => { expect(call.signal).toBe(controller.signal); call.signal!.addEventListener('abort', () => reject(new Error(TOKEN)), { once: true }); controller.abort(); }) : Promise.resolve(ok(call.url.includes('/databases/') ? database() : source())));
  await expect(adapter.execute('notion.create_page', { databaseId: DB, title: 'No' }, { signal: controller.signal })).rejects.toMatchObject({ category: 'UNKNOWN' }); expect(calls.filter(c => c.url.endsWith('/pages'))).toHaveLength(1);
});
it('returns NETWORK for pre-dispatch cancellation without any fetch', async () => {
  const controller = new AbortController(); controller.abort(); const { adapter, calls } = setup();
  await expect(adapter.execute('notion.create_page', { databaseId: DB, title: 'No' }, { signal: controller.signal })).rejects.toMatchObject({ category: 'NETWORK' }); expect(calls).toHaveLength(0);
});
it('waits Retry-After and retries a definitely rejected write once', async () => {
  vi.useFakeTimers(); let writes = 0;
  const { adapter, calls } = setup(call => call.url.endsWith('/pages') ? (++writes === 1 ? new Response('{}', { status: 429, headers: { 'Retry-After': '1' } }) : ok(page())) : ok(call.url.includes('/databases/') ? database() : source()));
  const promise = adapter.execute('notion.create_page', { databaseId: DB, title: 'Retry' });
  await vi.advanceTimersByTimeAsync(999); expect(writes).toBe(1); await vi.advanceTimersByTimeAsync(1); expect(await promise).toEqual({ id: PAGE, url: page().url }); expect(calls.filter(c => c.url.endsWith('/pages'))).toHaveLength(2);
});
it('does not cut a long Retry-After short or retry a blocked public request', async () => {
  for (const blocked of [false, true]) {
    const { adapter, calls } = setup(call => call.url.endsWith('/pages') ? new Response(JSON.stringify({ code: blocked ? 'public_api_request_blocked' : 'rate_limited' }), { status: 429, headers: { 'Retry-After': blocked ? '0' : '60' } }) : ok(call.url.includes('/databases/') ? database() : source()));
    await expect(adapter.execute('notion.create_page', { databaseId: DB, title: 'No' })).rejects.toMatchObject({ category: 'RATE_LIMIT' }); expect(calls.filter(c => c.url.endsWith('/pages'))).toHaveLength(1);
  }
});
it('cancel during Retry-After prevents a second write', async () => {
  const controller = new AbortController();
  const { adapter, calls } = setup(call => { if (call.url.endsWith('/pages')) { setTimeout(() => controller.abort(), 10); return new Response('{}', { status: 429, headers: { 'Retry-After': '1' } }); } return ok(call.url.includes('/databases/') ? database() : source()); });
  await expect(adapter.execute('notion.create_page', { databaseId: DB, title: 'No' }, { signal: controller.signal })).rejects.toMatchObject({ category: 'RATE_LIMIT' }); expect(calls.filter(c => c.url.endsWith('/pages'))).toHaveLength(1);
});
it.each(['network', 'server'])('retries read-only POST query %s faults without treating the query as a write', async kind => {
  let attempts = 0; const { adapter } = setup(call => { if (!call.url.endsWith('/query')) return ok(call.url.includes('/databases/') ? database() : source()); attempts++; if (kind === 'network') throw new Error(TOKEN); return new Response('{}', { status: 503 }); });
  await expect(adapter.execute('notion.query_database', { databaseId: DB })).rejects.toMatchObject({ category: kind === 'network' ? 'NETWORK' : 'SERVER_ERROR' }); expect(attempts).toBe(kind === 'network' ? 3 : 2);
});
it('follows short query pages up to the requested limit and rejects repeated cursors', async () => {
  let queries = 0; const { adapter, calls } = setup(call => { if (!call.url.endsWith('/query')) return ok(call.url.includes('/databases/') ? database() : source()); queries++; return ok({ object: 'list', results: queries === 1 ? [] : [page()], has_more: queries === 1, next_cursor: queries === 1 ? 'cursor' : null }); });
  expect((await adapter.execute('notion.query_database', { databaseId: DB, limit: 1 })).pages).toHaveLength(1); expect(calls.at(-1)!.body.start_cursor).toBe('cursor');
  const looping = setup(call => ok(call.url.endsWith('/query') ? { object: 'list', results: [], has_more: true, next_cursor: 'same' } : call.url.includes('/databases/') ? database() : source()));
  await expect(looping.adapter.execute('notion.query_database', { databaseId: DB })).rejects.toMatchObject({ category: 'SERVER_ERROR' });
});
it('uses shared limiter slots for database/data-source/page requests', async () => {
  vi.useFakeTimers(); const limiter = new GlobalRateLimiter({ maxRequests: 3, windowMs: 1000 }); const { adapter, calls } = setup(undefined, [DB], limiter);
  await adapter.execute('notion.create_page', { databaseId: DB, title: 'First' });
  const pending = adapter.execute('notion.search_databases', { query: '' }); await vi.advanceTimersByTimeAsync(999); expect(calls).toHaveLength(3); await vi.advanceTimersByTimeAsync(1); await pending; expect(calls).toHaveLength(4);
});

// W3-07 live run (04/10/2026): Notion now returns https://app.notion.com/... URLs.
it.each(['https://app.notion.com/', 'https://www.notion.so/', 'https://notion.so/'])('accepts Notion resource URLs on %s', async base => {
  const { adapter } = setup(call => ok(call.url.includes('/databases/') ? { ...database(), url: base + DB.replaceAll('-', '') } : source()));
  expect(await adapter.execute('notion.search_databases', { query: '' })).toEqual([{ id: DB, title: 'ATI Notes', url: base + DB.replaceAll('-', '') }]);
});
it.each(['https://app.notion.com.evil.test/', 'https://evil.test/app.notion.com/', 'http://app.notion.com/', 'https://user:pass@app.notion.com/', 'https://notion.site/'])('rejects a non-Notion or unsafe resource URL %s', async base => {
  const { adapter } = setup(call => ok(call.url.includes('/databases/') ? { ...database(), url: base + DB.replaceAll('-', '') } : source()));
  await expect(adapter.execute('notion.search_databases', { query: '' })).rejects.toMatchObject({ category: 'SERVER_ERROR' });
});
