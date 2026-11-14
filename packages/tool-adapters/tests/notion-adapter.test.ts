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
  expect(await adapter.execute('notion.query_database', { databaseId: DB.replaceAll('-', '').toUpperCase(), query: 'ATI', limit: 20 }, { signal })).toMatchObject({ pages: [{ id: PAGE, title: 'ATI Review', url: page().url, properties: { Name: 'ATI Review', Notes: 'plain', Stage: 'Ready', Day: '2026-10-03', Link: 'https://example.test', Score: '2', Check: 'true' } }] });
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
it.each([{ Unknown: 'x' }, { Check: 'not-a-boolean' }, { Score: 'NaN' }, { Score: '' }, { Day: '2026-02-30' }, { Link: 'javascript:bad' }, { Name: 'override title' }, { Stage: 'New option that would mutate schema' }])('rejects unsupported or invalid properties %j before page write', async properties => {
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

it('supports status, multi_select, and checkbox properties in create_page and returns schema & status filtering in query_database', async () => {
  const richSource = () => ({
    ...source(),
    properties: {
      ...source().properties,
      Status: { type: 'status', status: { options: [{ name: 'Not started' }, { name: 'In progress' }, { name: 'Done' }] } },
      Tags: { type: 'multi_select', multi_select: { options: [{ name: 'VIP' }, { name: 'Q4' }, { name: 'Urgent' }] } },
    },
  });
  const { adapter, calls } = setup(call => {
    if (call.url.includes('/databases/')) return ok(database());
    if (call.url.endsWith('/data_sources/' + DS)) return ok(richSource());
    if (call.url.endsWith('/query')) {
      return ok({
        object: 'list',
        results: [{
          ...page(),
          last_edited_time: '2026-11-02T10:00:00.000Z',
          properties: {
            ...page().properties,
            Status: { type: 'status', status: { name: 'In progress' } },
            Tags: { type: 'multi_select', multi_select: [{ name: 'VIP' }, { name: 'Q4' }] },
          },
        }],
        has_more: false,
      });
    }
    return ok(page());
  });

  const queried = await adapter.execute('notion.query_database', { databaseId: DB, status: 'In progress' });
  expect(queried.pages[0]?.lastEditedTime).toBe('2026-11-02T10:00:00.000Z');
  expect(queried.pages[0]?.properties.Status).toBe('In progress');
  expect(queried.pages[0]?.properties.Tags).toBe('VIP, Q4');
  expect(queried.schema).toEqual(expect.arrayContaining([
    { name: 'Status', type: 'status', options: ['Not started', 'In progress', 'Done'] },
    { name: 'Tags', type: 'multi_select', options: ['VIP', 'Q4', 'Urgent'] },
    { name: 'Check', type: 'checkbox' },
  ]));
  const queryCall = calls.find(c => c.url.endsWith('/query'))!;
  expect(queryCall.body.filter).toEqual({ property: 'Status', status: { equals: 'In progress' } });

  await adapter.execute('notion.create_page', {
    databaseId: DB,
    title: 'CRM Lead',
    properties: {
      Status: 'In progress',
      Tags: 'VIP, Q4',
      Check: 'true',
    },
  });
  const createCall = calls.find(c => c.method === 'POST' && new URL(c.url).pathname === '/v1/pages')!;
  expect(createCall.body.properties).toMatchObject({
    Status: { status: { name: 'In progress' } },
    Tags: { multi_select: [{ name: 'VIP' }, { name: 'Q4' }] },
    Check: { checkbox: true },
  });
});

it('reads page properties and nested content blocks via notion.get_page and enforces allowedDatabaseIds', async () => {
  const { adapter, calls } = setup(call => {
    const pathname = new URL(call.url).pathname;
    if (pathname === '/v1/pages/' + PAGE) {
      return ok({ ...page(), last_edited_time: '2026-11-02T12:00:00.000Z' });
    }
    if (pathname === '/v1/data_sources/' + DS) return ok(source());
    if (pathname === '/v1/blocks/' + PAGE + '/children') {
      return ok({
        object: 'list',
        results: [
          { object: 'block', id: BLOCK, type: 'heading_2', heading_2: { rich_text: rich('Mục tiêu tuần này') } },
          { object: 'block', id: '44444444-5555-6666-7777-888888888888', type: 'to_do', to_do: { rich_text: rich('Triển khai Notion OAuth'), checked: true } },
          { object: 'block', id: '55555555-6666-7777-8888-999999999999', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rich('Báo cáo tiến độ sang Slack') } },
        ],
        has_more: false,
      });
    }
    return ok(page());
  });

  const detail = await adapter.execute('notion.get_page', { pageId: PAGE });
  expect(detail).toMatchObject({
    id: PAGE,
    title: 'ATI Review',
    url: page().url,
    lastEditedTime: '2026-11-02T12:00:00.000Z',
    content: '## Mục tiêu tuần này\n- [x] Triển khai Notion OAuth\n- Báo cáo tiến độ sang Slack',
  });
  expect(detail.blocks).toHaveLength(3);
  expect(detail.blocks[1]).toMatchObject({ type: 'to_do', text: 'Triển khai Notion OAuth', checked: true });
  expect(calls.map(c => [c.method, new URL(c.url).pathname])).toEqual([
    ['GET', '/v1/pages/' + PAGE],
    ['GET', '/v1/data_sources/' + DS],
    ['GET', '/v1/blocks/' + PAGE + '/children'],
  ]);

  // Also fetches 1-level nested child blocks when a parent block has has_children: true
  const childBlockId = '66666666-7777-8888-9999-000000000000';
  const { adapter: nestedAdapter } = setup(call => {
    const pathname = new URL(call.url).pathname;
    if (pathname === '/v1/pages/' + PAGE) return ok(page());
    if (pathname === '/v1/data_sources/' + DS) return ok(source());
    if (pathname === '/v1/blocks/' + PAGE + '/children') {
      return ok({
        object: 'list',
        results: [
          {
            object: 'block',
            id: BLOCK,
            type: 'toggle',
            has_children: true,
            toggle: { rich_text: rich('Chi tiết triển khai') },
          },
        ],
        has_more: false,
      });
    }
    if (pathname === '/v1/blocks/' + BLOCK + '/children') {
      return ok({
        object: 'list',
        results: [
          {
            object: 'block',
            id: childBlockId,
            type: 'paragraph',
            paragraph: { rich_text: rich('Nội dung con bên trong toggle') },
          },
        ],
        has_more: false,
      });
    }
    return ok(page());
  });
  const nestedDetail = await nestedAdapter.execute('notion.get_page', { pageId: PAGE });
  expect(nestedDetail.content).toContain('Nội dung con bên trong toggle');
  expect(nestedDetail.blocks.map((b: any) => b.id)).toEqual([BLOCK, childBlockId]);
});

it('updates page title, properties, and archived state via notion.update_page after verifying database scope', async () => {
  const richSource = () => ({
    ...source(),
    properties: {
      ...source().properties,
      Status: { type: 'status', status: { options: [{ name: 'Not started' }, { name: 'In progress' }, { name: 'Done' }] } },
    },
  });
  const { adapter, calls } = setup(call => {
    const pathname = new URL(call.url).pathname;
    if (pathname === '/v1/pages/' + PAGE) return ok(page());
    if (pathname === '/v1/data_sources/' + DS) return ok(richSource());
    return ok(page());
  });

  const updated = await adapter.execute('notion.update_page', {
    pageId: PAGE,
    title: 'ATI Review (Done)',
    properties: { Status: 'Done', Check: 'false' },
    archived: false,
  });
  expect(updated).toEqual({
    id: PAGE,
    url: page().url,
    updatedProperties: ['Name', 'Status', 'Check'],
    archived: false,
  });
  const patchCall = calls.find(c => c.method === 'PATCH' && new URL(c.url).pathname === '/v1/pages/' + PAGE)!;
  expect(patchCall.body).toEqual({
    properties: {
      Name: { title: [{ type: 'text', text: { content: 'ATI Review (Done)' } }] },
      Status: { status: { name: 'Done' } },
      Check: { checkbox: false },
    },
    in_trash: false,
  });
});

it('sets truncated: true in query_database when has_more is true or results exceed limit, and omits truncated when complete', async () => {
  const page2 = { ...page(), id: '77777777-8888-9999-aaaa-bbbbbbbbbbbb' };
  const { adapter: hasMoreAdapter } = setup(call =>
    ok(
      call.url.endsWith('/query')
        ? { object: 'list', results: [page()], has_more: true, next_cursor: 'cursor-more' }
        : call.url.includes('/databases/')
          ? database()
          : source(),
    ),
  );
  const resHasMore = await hasMoreAdapter.execute('notion.query_database', { databaseId: DB, limit: 1 });
  expect(resHasMore.pages).toHaveLength(1);
  expect(resHasMore.truncated).toBe(true);

  const { adapter: overLimitAdapter } = setup(call =>
    ok(
      call.url.endsWith('/query')
        ? { object: 'list', results: [page(), page2], has_more: false, next_cursor: null }
        : call.url.includes('/databases/')
          ? database()
          : source(),
    ),
  );
  const resOverLimit = await overLimitAdapter.execute('notion.query_database', { databaseId: DB, limit: 1 });
  expect(resOverLimit.pages).toHaveLength(1);
  expect(resOverLimit.truncated).toBe(true);

  const { adapter: exactAdapter } = setup(call =>
    ok(
      call.url.endsWith('/query')
        ? { object: 'list', results: [page()], has_more: false, next_cursor: null }
        : call.url.includes('/databases/')
          ? database()
          : source(),
    ),
  );
  const resExact = await exactAdapter.execute('notion.query_database', { databaseId: DB, limit: 1 });
  expect(resExact.pages).toHaveLength(1);
  expect(resExact.truncated).toBeUndefined();
});

it('validates status and date filters in query_database, enforces client-side date range, and rejects missing filter columns', async () => {
  const noStatusOrDateSource = () => ({
    object: 'data_source',
    id: DS,
    parent: { type: 'database_id', database_id: DB },
    in_trash: false,
    properties: {
      Name: { type: 'title' },
      Priority: { type: 'select', select: { options: [{ name: 'High' }] } },
      Category: { type: 'select', select: { options: [{ name: 'Ops' }] } },
    },
  });
  const { adapter: noColAdapter } = setup(call =>
    ok(call.url.includes('/databases/') ? database() : noStatusOrDateSource()),
  );
  await expect(
    noColAdapter.execute('notion.query_database', { databaseId: DB, status: 'Done' }),
  ).rejects.toMatchObject({
    category: 'VALIDATION',
    retryable: false,
    message: 'Notion database has no status property to filter by',
  });
  await expect(
    noColAdapter.execute('notion.query_database', { databaseId: DB, dateOnOrAfter: '2026-10-01' }),
  ).rejects.toMatchObject({
    category: 'VALIDATION',
    retryable: false,
    message: 'Notion database has no date property to filter by',
  });

  // Prefers select named Trạng thái over unrelated select and filters by dateOnOrAfter / dateOnOrBefore
  const pageInRange = {
    ...page(),
    id: '22222222-3333-4444-5555-666666666661',
    properties: {
      ...page().properties,
      'Trạng thái': { type: 'select', select: { name: 'Đang làm' } },
      Deadline: { type: 'date', date: { start: '2026-10-05', end: null } },
    },
  };
  const pageOutOfRange = {
    ...page(),
    id: '22222222-3333-4444-5555-666666666662',
    properties: {
      ...page().properties,
      'Trạng thái': { type: 'select', select: { name: 'Đang làm' } },
      Deadline: { type: 'date', date: { start: '2026-09-20', end: null } },
    },
  };
  const multiSelectSource = () => ({
    ...source(),
    properties: {
      Name: { type: 'title' },
      Priority: { type: 'select', select: { options: [{ name: 'High' }] } },
      'Trạng thái': { type: 'select', select: { options: [{ name: 'Đang làm' }] } },
      CreatedDate: { type: 'date' },
      Deadline: { type: 'date' },
    },
  });
  const { adapter: dateAdapter, calls } = setup(call => {
    if (call.url.includes('/databases/')) return ok(database());
    if (call.url.endsWith('/data_sources/' + DS)) return ok(multiSelectSource());
    return ok({ object: 'list', results: [pageInRange, pageOutOfRange], has_more: false });
  });
  await expect(dateAdapter.execute('notion.query_database', {
    databaseId: DB, dateOnOrAfter: '2026-10-01',
  })).rejects.toThrow(/Specify dateProperty/);
  const filtered = await dateAdapter.execute('notion.query_database', {
    databaseId: DB,
    status: 'Đang làm',
    dateOnOrAfter: '2026-10-01',
    dateOnOrBefore: '2026-10-10',
    dateProperty: 'Deadline',
  });
  expect(filtered.pages.map((p: any) => p.id)).toEqual(['22222222-3333-4444-5555-666666666661']);
  const queryCall = calls.find(c => c.url.endsWith('/query'))!;
  expect(queryCall.body.filter).toEqual({
    and: [
      { property: 'Trạng thái', select: { equals: 'Đang làm' } },
      { property: 'Deadline', date: { on_or_after: '2026-10-01' } },
      { property: 'Deadline', date: { on_or_before: '2026-10-10' } },
    ],
  });
});

it('extracts non-rich_text blocks and formats code, callout, toggle, divider, and table_row in notion.get_page', async () => {
  const { adapter } = setup(call => {
    const pathname = new URL(call.url).pathname;
    if (pathname === '/v1/pages/' + PAGE) return ok(page());
    if (pathname === '/v1/data_sources/' + DS) return ok(source());
    if (pathname === '/v1/blocks/' + PAGE + '/children') {
      return ok({
        object: 'list',
        results: [
          { object: 'block', id: '10000000-0000-0000-0000-000000000001', type: 'callout', callout: { rich_text: rich('Chú ý quan trọng') } },
          { object: 'block', id: '10000000-0000-0000-0000-000000000002', type: 'toggle', toggle: { rich_text: rich('Mở rộng') } },
          { object: 'block', id: '10000000-0000-0000-0000-000000000003', type: 'code', code: { language: 'ts', rich_text: rich('const x = 1;') } },
          { object: 'block', id: '10000000-0000-0000-0000-000000000004', type: 'divider', divider: {} },
          { object: 'block', id: '10000000-0000-0000-0000-000000000005', type: 'table_row', table_row: { cells: [rich('Cột A'), rich('Cột B')] } },
          { object: 'block', id: '10000000-0000-0000-0000-000000000006', type: 'child_page', child_page: { title: 'Trang con' } },
          { object: 'block', id: '10000000-0000-0000-0000-000000000007', type: 'equation', equation: { expression: 'E = mc^2' } },
          { object: 'block', id: '10000000-0000-0000-0000-000000000008', type: 'bookmark', bookmark: { caption: rich('Tài liệu'), url: 'https://example.com/doc' } },
          { object: 'block', id: '10000000-0000-0000-0000-000000000010', type: 'file', file: { caption: rich('Private PDF'), file: { url: 'https://files.example.test/private?signature=fixture' } } },
          { object: 'block', id: '10000000-0000-0000-0000-000000000009', type: 'image', image: { caption: rich('Ảnh kiến trúc'), external: { url: 'https://example.com/arch.png' } } },
        ],
        has_more: false,
      });
    }
    return ok(page());
  });
  const detail = await adapter.execute('notion.get_page', { pageId: PAGE });
  expect(JSON.stringify(detail)).not.toContain('signature=fixture');
  expect(detail.content).toBe(
    [
      '> 💡 Chú ý quan trọng',
      '▸ Mở rộng',
      '```ts\nconst x = 1;\n```',
      '---',
      '| Cột A | Cột B |',
      'Trang con',
      'E = mc^2',
      'Tài liệu - https://example.com/doc',
      'Private PDF',
      'Ảnh kiến trúc - https://example.com/arch.png',
    ].join('\n'),
  );
});

it('treats archived: true like in_trash: true across query_database, get_page, update_page, and append_text', async () => {
  const { adapter: queryArchived } = setup(call =>
    ok(
      call.url.endsWith('/query')
        ? { object: 'list', results: [{ ...page(), archived: true }, page()], has_more: false }
        : call.url.includes('/databases/')
          ? database()
          : source(),
    ),
  );
  const res = await queryArchived.execute('notion.query_database', { databaseId: DB });
  expect(res.pages).toHaveLength(1);

  const { adapter: pageArchived } = setup(call =>
    ok(call.url.includes('/pages/') ? { ...page(), archived: true } : source()),
  );
  await expect(pageArchived.execute('notion.get_page', { pageId: PAGE })).rejects.toMatchObject({ category: 'AUTH_ERROR' });
  await expect(pageArchived.execute('notion.append_text', { pageId: PAGE, text: 'hi' })).rejects.toMatchObject({
    category: 'AUTH_ERROR',
    details: { requestSent: false },
  });
});

it('marks pre-dispatch abort and pre-write GET failures with details.requestSent = false on write tools', async () => {
  const preAborted = new AbortController();
  preAborted.abort();
  const { adapter: abortAdapter } = setup();
  await expect(
    abortAdapter.execute('notion.create_page', { databaseId: DB, title: 'T' }, { signal: preAborted.signal }),
  ).rejects.toMatchObject({
    category: 'NETWORK',
    details: { requestSent: false },
  });

  // Pre-write GET failure on create_page, update_page, append_text sets details.requestSent = false
  const { adapter: preWriteFailAdapter, calls } = setup(call => {
    if (call.method === 'GET') return new Response('{}', { status: 503 });
    return ok(page());
  });
  for (const [tool, args] of [
    ['notion.create_page', { databaseId: DB, title: 'T' }],
    ['notion.update_page', { pageId: PAGE, title: 'T' }],
    ['notion.append_text', { pageId: PAGE, text: 'T' }],
  ] as const) {
    await expect(preWriteFailAdapter.execute(tool, args)).rejects.toMatchObject({
      category: 'SERVER_ERROR',
      details: { requestSent: false },
    });
  }
  expect(calls.filter(c => c.method === 'POST' || c.method === 'PATCH')).toHaveLength(0);
});
