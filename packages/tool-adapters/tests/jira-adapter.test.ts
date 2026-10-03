import { afterEach, expect, it, vi } from 'vitest';
import * as adapters from '../src/index.js';
const credentials = { siteUrl: 'https://ati-test.atlassian.net', email: 'fixture@example.test', apiToken: 'synthetic_private_token_xyz' };
const json = (value: unknown, status = 200, headers?: Record<string, string>) => new Response(JSON.stringify(value), { status, headers });
const project = { key: 'ATI', id: '10000', name: 'ATI Project' };
const issue = { key: 'ATI-42', id: '10042', fields: { summary: 'Login bug', status: { name: 'Open' }, project } };
const types = { startAt: 0, maxResults: 50, total: 2, issueTypes: [{ id: '1', name: 'Bug', subtask: false }, { id: '2', name: 'Task', subtask: false }] };
function make(fetchFn: any, extra: any = {}) {
  const Constructor = (adapters as any).JiraAdapter; expect(Constructor).toBeTypeOf('function');
  return new Constructor({ credentials, allowedScope: { projects: ['ATI'] }, fetchFn, rateLimiter: new adapters.GlobalRateLimiter({ maxRequests: 10000, windowMs: 1 }), ...extra });
}
function scripted(overrides?: (url: string, init: any) => Response | undefined) {
  return vi.fn(async (url: any, init: any) => overrides?.(String(url), init) ??
    json(String(url).includes('createmeta') ? types : String(url).endsWith('/issue') ? { key: issue.key, id: issue.id } : String(url).includes('/comment') ? { id: '900' } : String(url).includes('search/jql') ? { issues: [issue], isLast: true } : String(url).includes('/myself') ? { accountId: 'fixture' } : String(url).includes('/issue/') ? issue : project));
}
const create = (a: any, signal?: AbortSignal) => a.execute('jira.create_issue', { projectKey: 'ATI', summary: 'Login bug', description: '<b>plain</b>\n* wiki' }, { signal });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it.each(['http://ati-test.atlassian.net', 'https://ati-test.atlassian.net/', 'https://ati-test.atlassian.net:443', 'https://evil.com', 'https://ati.atlassian.net.evil.com', 'https://user@ati.atlassian.net', 'https://ati.atlassian.net?q=1', 'https://ATI.atlassian.net'])('rejects SSRF site before transport: %s', siteUrl => {
  const fetchFn = vi.fn(); make(fetchFn); expect(() => make(fetchFn, { credentials: { ...credentials, siteUrl } })).toThrow(); expect(fetchFn).not.toHaveBeenCalled();
});
it('lists exactly allowlisted projects, filtered by key/name and respects limit', async () => {
  const f = scripted((url) => url.includes('/project/OTHER') ? json({ key: 'OTHER', id: '2', name: 'Other' }) : undefined);
  const a = make(f, { allowedScope: { projects: ['ATI', 'OTHER', 'ATI'] } });
  expect(await a.execute('jira.search_projects', { query: '', limit: 1 })).toEqual([project]); expect(f).toHaveBeenCalledTimes(1);
  expect(await a.execute('jira.search_projects', { query: 'other' })).toEqual([{ key: 'OTHER', id: '2', name: 'Other' }]);
  for (const [url, init] of f.mock.calls) { expect(url).toMatch(/^https:\/\/ati-test\.atlassian\.net\/rest\/api\/3\/project\/(ATI|OTHER)$/); expect(init.method).toBe('GET'); expect(init.redirect).toBe('error'); expect(init.headers.Authorization).toBe('Basic ' + Buffer.from(credentials.email + ':' + credentials.apiToken).toString('base64')); }
});
it.each([undefined, { projects: [] }, { projects: ['ATI', 'bad'] }])('requires complete valid scope before reads/writes %j', async allowedScope => {
  const f = vi.fn(); const a = make(f, { allowedScope }); await expect(a.execute('jira.search_projects', { query: '' })).rejects.toMatchObject({ category: 'AUTH_ERROR' }); await expect(create(a)).rejects.toMatchObject({ category: 'AUTH_ERROR' }); expect(f).not.toHaveBeenCalled();
});
it('rejects outside project and issue prefix before fetch', async () => {
  const f = vi.fn(); const a = make(f);
  await expect(a.execute('jira.search_issues', { projectKey: 'OTHER' })).rejects.toMatchObject({ category: 'AUTH_ERROR' });
  await expect(a.execute('jira.create_issue', { projectKey: 'OTHER', summary: 'x' })).rejects.toMatchObject({ category: 'AUTH_ERROR' });
  await expect(a.execute('jira.add_comment', { issueKey: 'OTHER-1', body: 'x' })).rejects.toMatchObject({ category: 'AUTH_ERROR' }); expect(f).not.toHaveBeenCalled();
});
it('constructs new endpoint POST JQL, escaping injection and Lucene punctuation; maps grounding output', async () => {
  const f = scripted(); const a = make(f); const query = 'x" OR project = OTHER OR text ~ "y + - & | ! ( ) { } [ ] ^ ~ * ? \\ :';
  expect(await a.execute('jira.search_issues', { projectKey: 'ATI', query, limit: 20 })).toEqual({ issues: [{ id: '10042', key: 'ATI-42', title: 'Login bug', status: 'Open', url: credentials.siteUrl + '/browse/ATI-42' }] });
  const [url, init] = f.mock.calls[0]!; expect(url).toBe(credentials.siteUrl + '/rest/api/3/search/jql'); expect(init.method).toBe('POST');
  const body = JSON.parse(init.body); expect(body.jql).toMatch(/^project = "ATI" AND text ~ "/); expect(body.jql).toContain('x' + '\\'.repeat(3) + '" OR project'); expect(body.jql).toContain('\\'.repeat(3) + '"y'); expect(body.jql).not.toContain('~ "x" OR'); expect(body.fields).toEqual(['summary', 'status', 'project']); expect(body.maxResults).toBe(20);
  // Every double quote in the text operand is escaped; symbols are removed as permitted by the card.
  const operand = body.jql.slice(body.jql.indexOf('text ~ "') + 8, -'" ORDER BY updated DESC'.length); expect(operand).not.toMatch(/[+&|!(){}\[\]^~*?:]/);
  f.mockClear(); await a.execute('jira.search_issues', { projectKey: 'ATI', query: '' }); expect(JSON.parse(f.mock.calls[0]![1].body).jql).toBe('project = "ATI" ORDER BY updated DESC');
});
it('escapes quote and backslash at both Lucene and JQL layers, including unpaired quote', async () => {
  const f = scripted(); await make(f).execute('jira.search_issues', { projectKey: 'ATI', query: 'a"b\\c' });
  const jql = JSON.parse(f.mock.calls[0]![1].body).jql;
  const operand = jql.slice('project = "ATI" AND text ~ '.length, -' ORDER BY updated DESC'.length);
  expect(JSON.parse(operand)).toBe('a\\"b\\\\c');
});
it('does not leak out-of-project search results or missing identities', async () => {
  for (const result of [{ ...issue, key: 'OTHER-42', fields: { ...issue.fields, project: { key: 'OTHER' } } }, { ...issue, id: undefined }]) {
    const a = make(scripted(url => url.includes('search/jql') ? json({ issues: [result] }) : undefined)); await expect(a.execute('jira.search_issues', { projectKey: 'ATI' })).rejects.toMatchObject({ category: 'SERVER_ERROR' });
  }
});
it('creates with metadata Task id and plaintext paragraph ADF; never follows self URL', async () => {
  const f = scripted(); expect(await create(make(f))).toEqual({ key: 'ATI-42', id: '10042', url: credentials.siteUrl + '/browse/ATI-42' });
  expect(f.mock.calls[0]![0]).toBe(credentials.siteUrl + '/rest/api/3/issue/createmeta/ATI/issuetypes?startAt=0&maxResults=50');
  const write = JSON.parse(f.mock.calls[1]![1].body); expect(write.fields).toEqual({ project: { key: 'ATI' }, summary: 'Login bug', issuetype: { id: '2' }, description: { version: 1, type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '<b>plain</b>' }] }, { type: 'paragraph', content: [{ type: 'text', text: '* wiki' }] }] } });
});
it('uses first standard type without Task, refuses missing/unknown/subtask names before write', async () => {
  const f = scripted(url => url.includes('createmeta') ? json({ ...types, issueTypes: [{ id: '3', name: 'Child', subtask: true }, { id: '4', name: 'Tâche', subtask: false }], total: 2 }) : undefined); const a = make(f);
  await create(a); expect(JSON.parse(f.mock.calls[1]![1].body).fields.issuetype).toEqual({ id: '4' }); f.mockClear();
  for (const issueType of ['Missing', 'Child']) { await expect(a.execute('jira.create_issue', { projectKey: 'ATI', summary: 'x', issueType })).rejects.toMatchObject({ category: 'VALIDATION', message: expect.stringContaining('Tâche') }); }
  expect(f.mock.calls.every(c => c[1].method === 'GET')).toBe(true);
});
it('paginates issue types before picking Task and fails closed on stalled metadata', async () => {
  const f = scripted(url => url.includes('createmeta') ? json(url.includes('startAt=0') ? { ...types, maxResults: 1, issueTypes: [types.issueTypes[0]] } : { ...types, startAt: 1, maxResults: 1, issueTypes: [types.issueTypes[1]] }) : undefined);
  await create(make(f)); expect(f).toHaveBeenCalledTimes(3); expect(JSON.parse(f.mock.calls[2]![1].body).fields.issuetype.id).toBe('2');
  const bad = scripted(url => url.includes('createmeta') ? json({ ...types, total: 3, issueTypes: [] }) : undefined); await expect(create(make(bad))).rejects.toMatchObject({ category: 'SERVER_ERROR' }); expect(bad).toHaveBeenCalledTimes(1);
});
it('reads real issue parent then comments on resolved current key, with ADF and safe URL', async () => {
  const f = scripted(); const output = await make(f).execute('jira.add_comment', { issueKey: 'ATI-42', body: 'hello\n\nworld' });
  expect(output).toEqual({ id: '900', issueKey: 'ATI-42', url: credentials.siteUrl + '/browse/ATI-42?focusedCommentId=900' });
  expect(f.mock.calls[0]![0]).toBe(credentials.siteUrl + '/rest/api/3/issue/ATI-42?fields=project');
  expect(f.mock.calls[1]![0]).toBe(credentials.siteUrl + '/rest/api/3/issue/ATI-42/comment');
  expect(JSON.parse(f.mock.calls[1]![1].body).body.content[1]).toEqual({ type: 'paragraph', content: [] });
});
it('refuses moved issue outside scope before comment even if old prefix allowed', async () => {
  const f = scripted(url => url.includes('/issue/ATI-42') ? json({ ...issue, key: 'OTHER-42', fields: { project: { key: 'OTHER' } } }) : undefined);
  await expect(make(f).execute('jira.add_comment', { issueKey: 'ATI-42', body: 'x' })).rejects.toMatchObject({ category: 'AUTH_ERROR' }); expect(f).toHaveBeenCalledTimes(1);
});
it.each([['jira.search_projects', { query: '', limit: 11 }], ['jira.search_issues', { projectKey: 'ATI', limit: 21 }], ['jira.search_issues', { projectKey: 'ATI', jql: 'x' }], ['jira.create_issue', { projectKey: 'ATI', summary: '' }], ['jira.create_issue', { projectKey: 'ATI', summary: 'x'.repeat(256) }], ['jira.add_comment', { issueKey: 'ATI-1', body: 'x'.repeat(4001) }]])('rejects bad %s arguments before network', async (tool, args) => {
  const f = vi.fn(); await expect(make(f).execute(tool as string, args)).rejects.toMatchObject({ category: 'VALIDATION' }); expect(f).not.toHaveBeenCalled();
});
it.each([[400, 'VALIDATION'], [401, 'AUTH_ERROR'], [403, 'AUTH_ERROR'], [404, 'NOT_FOUND'], [429, 'RATE_LIMIT'], [503, 'UNKNOWN']])('classifies write HTTP %i with no replay and no secret body', async (status, category) => {
  const f = scripted((_url, init) => init.method === 'POST' ? json({ errorMessages: [credentials.apiToken + ' Authorization ' + credentials.email] }, status as number, { 'Retry-After': '60' }) : undefined);
  const error = await create(make(f)).catch((e: any) => e); expect(error.category).toBe(category); expect(JSON.stringify(error) + error.message).not.toContain(credentials.apiToken); expect(error.cause).toBeUndefined(); expect(f).toHaveBeenCalledTimes(2);
});
it.each([400, 401, 403, 404, 429, 503])('treats success-shaped write body on HTTP %i as UNKNOWN once', async status => {
  const f = scripted((_url, init) => init.method === 'POST' ? json({ id: '10042', key: 'ATI-42' }, status, { 'Retry-After': '0' }) : undefined);
  await expect(create(make(f))).rejects.toMatchObject({ category: 'UNKNOWN' }); expect(f).toHaveBeenCalledTimes(2);
});
it('read retries network twice/server once, write network or malformed success stays UNKNOWN once', async () => {
  const f = vi.fn().mockRejectedValueOnce(new Error(credentials.apiToken)).mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(json(project)); expect(await make(f).execute('jira.search_projects', { query: '' })).toEqual([project]); expect(f).toHaveBeenCalledTimes(3);
  const server = vi.fn().mockResolvedValueOnce(json({}, 503)).mockResolvedValueOnce(json(project)); expect(await make(server).execute('jira.search_projects', { query: '' })).toEqual([project]); expect(server).toHaveBeenCalledTimes(2);
  for (const outcome of [() => Promise.reject(new Error(credentials.apiToken)), () => Promise.resolve(new Response('bad json')), () => Promise.resolve(json({ id: '10042', key: 'OTHER-42' }))]) {
    const write = scripted(); write.mockImplementation(async (url, init) => init.method === 'POST' ? outcome() : json(types)); await expect(create(make(write))).rejects.toMatchObject({ category: 'UNKNOWN' }); expect(write).toHaveBeenCalledTimes(2);
  }
});
it('honors definite 429 Retry-After once and real signal cancellation while waiting', async () => {
  vi.useFakeTimers(); let writes = 0; const f = scripted((_url, init) => init.method === 'POST' && ++writes === 1 ? json({ errorMessages: ['rate'] }, 429, { 'Retry-After': '2' }) : undefined);
  const promise = create(make(f)); await vi.advanceTimersByTimeAsync(1999); expect(writes).toBe(1); await vi.advanceTimersByTimeAsync(1); await expect(promise).resolves.toMatchObject({ key: 'ATI-42' }); expect(writes).toBe(2);
  const controller = new AbortController(); const rate = scripted((_url, init) => init.method === 'POST' ? json({}, 429, { 'Retry-After': '2' }) : undefined); const cancelled = create(make(rate), controller.signal).catch((e: any) => e); await vi.advanceTimersByTimeAsync(0); controller.abort(); expect((await cancelled).category).toBe('RATE_LIMIT'); expect(rate).toHaveBeenCalledTimes(2);
});
it('actual in-flight write AbortSignal produces UNKNOWN; pre-aborted dispatch has zero fetch', async () => {
  const controller = new AbortController(); const f = scripted(); f.mockImplementation(async (_url, init) => init.method === 'POST' ? new Promise((_resolve, reject) => { init.signal.addEventListener('abort', () => reject(new Error('aborted ' + credentials.apiToken)), { once: true }); controller.abort(); }) : json(types));
  await expect(create(make(f), controller.signal)).rejects.toMatchObject({ category: 'UNKNOWN' }); expect(f).toHaveBeenCalledTimes(2);
  const pre = new AbortController(); pre.abort(); const no = vi.fn(); await expect(create(make(no), pre.signal)).rejects.toMatchObject({ category: 'NETWORK' }); expect(no).not.toHaveBeenCalled();
});
it('shared limiter throttles two instances and aborts actual wait before dispatch', async () => {
  vi.useFakeTimers(); const limiter = new adapters.GlobalRateLimiter({ maxRequests: 1, windowMs: 1000 }); const f = scripted(); const a = make(f, { rateLimiter: limiter }); const b = make(f, { rateLimiter: limiter });
  await a.checkConnection(); const second = b.checkConnection(); await vi.advanceTimersByTimeAsync(999); expect(f).toHaveBeenCalledTimes(1); await vi.advanceTimersByTimeAsync(1); await second; expect(f).toHaveBeenCalledTimes(2);
  const controller = new AbortController(); const stopped = a.checkConnection(controller.signal).catch((e: any) => e); await vi.advanceTimersByTimeAsync(0); controller.abort(); expect((await stopped).category).toBe('NETWORK'); expect(f).toHaveBeenCalledTimes(2);
});
it('checkConnection reads myself and refuses anonymous/malformed identities', async () => {
  const f = scripted(); expect(await make(f).checkConnection()).toBe(true); expect(f.mock.calls[0]![0]).toBe(credentials.siteUrl + '/rest/api/3/myself');
  await expect(make(vi.fn(async () => json({}))).checkConnection()).rejects.toMatchObject({ category: 'SERVER_ERROR' });
});
