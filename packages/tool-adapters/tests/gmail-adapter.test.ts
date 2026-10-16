import { afterEach, describe, expect, it } from 'vitest';
import * as adapters from '../src/index.js';
import { startFakeGoogleGmail, type FakeGoogleGmail } from '../../../scripts/fake-google-gmail.mjs';
import type { GmailAccessTokenProvider } from '../src/gmail/token-provider.js';
import { validatePlan } from '@wap/planner';
import { GMAIL_TOOLS } from '@wap/tool-schemas';
import { StepRunner } from '@wap/executor';

const servers: FakeGoogleGmail[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(s => s.close())); });
async function setup() {
  const server = await startFakeGoogleGmail(); servers.push(server);
  const refresh = server.mintRefreshToken();
  const calls: any[] = [];
  const tokens: GmailAccessTokenProvider = { async getAccessToken(options) {
    calls.push(options);
    const response = await fetch(server.endpoints.tokenUrl, { method: 'POST', signal: options?.signal,
      body: new URLSearchParams({ client_id: 'gmail-test.apps.googleusercontent.com', client_secret: 'fake-gmail-secret',
        grant_type: 'refresh_token', refresh_token: refresh }) });
    if (!response.ok) throw new adapters.StepError({ category: 'SERVER_ERROR', message: 'Refresh failed' });
    return (await response.json()).access_token;
  } };
  return { server, tokens, calls, adapter: adapters.createGmailToolAdapter({ tokens, baseUrl: server.origin }) };
}
const send = { to: [' Lan@Example.COM '], subject: 'Lịch họp tiếng Việt 📨', body: 'Chào Lan 😊\nHẹn gặp.' };
const cases: [string, any][] = [
  ['search_threads', { query: 'họp', limit: 2 }], ['get_thread', { threadId: 'thread-1' }],
  ['list_labels', { query: '' }], ['send_message', send], ['reply', { threadId: 'thread-1', to: send.to, body: send.body }],
  ['forward', { threadId: 'thread-1', to: send.to, note: 'Xem nhé' }], ['create_draft', send],
  ['modify_thread_labels', { threadId: 'thread-1', addLabelIds: ['STARRED'], removeLabelIds: ['UNREAD'] }],
  ['trash_thread', { threadId: 'thread-1' }], ['create_label', { name: 'Dự án ATI' }],
];
describe('Gmail native HTTP adapter', () => {
  it.each(cases)('executes gmail.%s against the real fake HTTP endpoint', async (tool, args) => {
    const { adapter, server } = await setup();
    const result = await adapter.execute(`gmail.${tool}`, args);
    expect(result).toBeTruthy(); expect(server.stats.apiRequests.length).toBeGreaterThan(0);
    if (tool === 'search_threads') {
      expect(result[0]).toMatchObject({ id: 'thread-1', subject: 'Họp nhóm ATI', participants: ['lan@example.com', 'gmail-owner@example.test', 'minh@example.com'] });
      expect(Array.from(result[0].snippet).length).toBeLessThanOrEqual(200);
      expect(result[0]).not.toHaveProperty('title');
    }
    if (tool === 'get_thread') expect(result).toMatchObject({ id: 'thread-1', messages: [{ body: 'Chào nhóm, họp lúc 9 giờ.' }] });
  });
  it.each(['send_message', 'reply', 'forward', 'create_draft'])('encodes Unicode MIME and threading for %s', async tool => {
    const { adapter, server } = await setup();
    const args = tool === 'send_message' || tool === 'create_draft' ? send : { threadId: 'thread-1', to: send.to, body: send.body, ...(tool === 'forward' ? { note: 'Ghi chú' } : {}) };
    if (tool === 'forward') delete args.body;
    await adapter.execute(`gmail.${tool}`, args);
    const request = server.stats.apiRequests.find(r => r.method === 'POST')!;
    const message = request.body.message ?? request.body;
    const mime = Buffer.from(message.raw, 'base64url').toString('utf8');
    expect(mime).toContain('To: lan@example.com\r\n'); expect(mime).toContain('Content-Type: text/plain; charset=UTF-8');
    const subject = mime.replace(/\r\n /g, ' ').match(/Subject: ([^\r]+)/)![1];
    const decoded = subject.replace(/\?=\s+=\?/g, '?==?').replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_, b) => Buffer.from(b, 'base64').toString('utf8'));
    const text = Buffer.from(mime.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8');
    if (tool === 'reply') { expect(decoded).toBe('Re: Họp nhóm ATI'); expect(mime).toContain('In-Reply-To: <original@example.com>'); expect(mime).toContain('References: <ancestor@example.com> <original@example.com>'); expect(message.threadId).toBe('thread-1'); }
    else if (tool === 'forward') { expect(decoded).toBe('Fwd: Họp nhóm ATI'); expect(text).toContain('Chào nhóm, họp lúc 9 giờ.'); }
    else { expect(decoded).toBe(send.subject); expect(text).toBe(send.body.replace(/\n/g, '\r\n')); }
  });
  it.each(['reply', 'forward', 'create_draft'])('rejects a draft-only thread for %s before any write', async tool => {
    const { adapter, server } = await setup();
    await expect(adapter.execute(`gmail.${tool}`, { threadId: 'draft-only', to: send.to, ...(tool === 'forward' ? { note: 'OK' } : { body: 'OK' }) })).rejects.toMatchObject({ category: 'VALIDATION', message: expect.stringContaining('only drafts'), details: { requestSent: false } });
    expect(server.stats.writes).toBe(0);
  });
  it('draft reply selects the last non-draft and keeps references', async () => {
    const { adapter, server } = await setup();
    await adapter.execute('gmail.create_draft', { threadId: 'thread-1', to: send.to, body: 'Nháp' });
    const req = server.stats.apiRequests.find(r => r.method === 'POST')!;
    expect(Buffer.from(req.body.message.raw, 'base64url').toString()).toContain('In-Reply-To: <original@example.com>');
  });
  it.each([
    { ...send, subject: 'Hello\r\nBcc: attacker@example.com' }, { ...send, to: ['a@example.com\r\nBcc: b@example.com'] },
    { ...send, to: ['Lan <lan@example.com>'] }, { ...send, to: Array.from({ length: 21 }, (_, i) => `a${i}@example.com`) },
    { ...send, cc: Array.from({ length: 20 }, (_, i) => `a${i}@example.com`) }, { ...send, subject: '😊'.repeat(251) },
    { ...send, body: '😊'.repeat(20001) }, { ...send, from: 'attacker@example.com' }, { ...send, to: { $ref: 'x.output' } },
    { ...send, to: ['${x.output.email}'] },
  ])('rejects invalid input with no HTTP dispatch: %j', async args => {
    const { adapter, server } = await setup();
    await expect(adapter.execute('gmail.send_message', args)).rejects.toMatchObject({ category: 'VALIDATION', details: { requestSent: false } });
    expect(server.stats.apiRequests).toHaveLength(0);
  });
  it('accepts boundary Unicode lengths without splitting surrogate pairs', async () => {
    const { adapter, server } = await setup();
    await adapter.execute('gmail.send_message', { ...send, subject: '😊'.repeat(250), body: '😊'.repeat(20000) });
    expect(server.stats.writes).toBe(1);
  });
  it('caps last five plain/HTML messages, total text and attachments; participants come only from headers', async () => {
    const { adapter, server } = await setup();
    const header = [{ name: 'From', value: 'Lan <LAN@example.com>' }, { name: 'Subject', value: 'Giới hạn 😊' }];
    server.settings.threads = [{ id: 'large', messages: Array.from({ length: 8 }, (_, i) => ({ id: `m${i}`, payload: {
      headers: header, mimeType: 'multipart/mixed', parts: [
        { mimeType: 'text/html', body: { data: Buffer.from('<p>' + '😊'.repeat(5000) + 'attacker@example.com</p>').toString('base64url') } },
        { mimeType: 'application/pdf', filename: 'báo cáo.pdf', body: { size: 123, attachmentId: 'private-file' } },
      ] }, labelIds: ['INBOX'] })) }];
    const result = await adapter.execute('gmail.get_thread', { threadId: 'large' });
    expect(result.messages).toHaveLength(5); expect(result.messages[0].messageId).toBe('m3');
    expect(result.messages.reduce((n: number, m: any) => n + Array.from(m.body).length, 0)).toBe(12000);
    expect(result.messages.every((m: any) => Array.from(m.body).length <= 4000 && !m.body.includes('\uFFFD'))).toBe(true);
    expect(result.messages[0].attachments).toEqual([{ filename: 'báo cáo.pdf', size: 123 }]);
    expect(result.participants).toEqual(['lan@example.com']);
  });
  it.each([[400, 'badRequest', 'VALIDATION'], [403, 'forbidden', 'AUTH_ERROR'], [404, 'notFound', 'NOT_FOUND'],
    [403, 'userRateLimitExceeded', 'RATE_LIMIT'], [429, 'rateLimitExceeded', 'RATE_LIMIT']])('maps HTTP %s %s to %s', async (status, reason, category) => {
    const { adapter, server } = await setup(); server.settings.apiResponses = [{ status: Number(status), reason: String(reason) }];
    await expect(adapter.execute('gmail.send_message', send)).rejects.toMatchObject({ category }); expect(server.stats.writes).toBe(1);
  });
  it('refreshes once on 401, and never loops on a second 401', async () => {
    const { adapter, server, calls } = await setup(); server.settings.apiResponses = [{ status: 401 }, { status: 401 }];
    await expect(adapter.execute('gmail.send_message', send)).rejects.toMatchObject({ category: 'AUTH_ERROR' });
    expect(calls.filter(c => c?.forceRefresh)).toHaveLength(1); expect(server.stats.writes).toBe(2);
  });
  it('a definitive first 401 can be retried once with a refreshed token', async () => {
    const { adapter, server, calls } = await setup(); server.settings.apiResponses = [{ status: 401 }];
    await expect(adapter.execute('gmail.send_message', send)).resolves.toMatchObject({ id: 'sent-2' });
    expect(calls.filter(c => c?.forceRefresh)).toHaveLength(1); expect(server.stats.writes).toBe(2);
  });
  it('chooses the most recent delivered message even if a later draft exists', async () => {
    const { adapter, server } = await setup(); const original = server.settings.threads[0]!.messages[0];
    server.settings.threads[0]!.messages.push({ ...original, id: 'latest-draft', labelIds: ['DRAFT'], payload: { ...original.payload, headers: [{ name: 'Subject', value: 'DO NOT REPLY TO DRAFT' }] } });
    await adapter.execute('gmail.reply', { threadId: 'thread-1', to: send.to, body: 'OK' });
    const message = server.stats.apiRequests.find(r => r.method === 'POST')!.body;
    const mime = Buffer.from(message.raw, 'base64url').toString(); expect(mime).toContain('In-Reply-To: <original@example.com>'); expect(mime).not.toContain('DO NOT REPLY');
  });
  it('parses validated header participants only, deduplicated and capped at twenty', async () => {
    const { adapter, server } = await setup();
    server.settings.threads[0]!.messages[0].payload.headers = [
      { name: 'From', value: '"Nguyễn, Lan" <LAN@example.com>' },
      { name: 'To', value: Array.from({ length: 25 }, (_, i) => `user${i}@example.com`).join(', ') },
      { name: 'Cc', value: 'invalid, LAN@example.com, injected@example.com\r\nBcc: attacker@example.com' },
    ];
    const result = await adapter.execute('gmail.get_thread', { threadId: 'thread-1' }); expect(result.participants).toHaveLength(20);
    expect(result.participants[0]).toBe('lan@example.com'); expect(result.participants).not.toContain('attacker@example.com'); expect(result.participants).not.toContain('invalid');
  });
  it.each([
    ['"hello,attacker@example.com,world" <lan@example.com>', ['lan@example.com']],
    ['"<attacker@example.com>" <lan@example.com>', ['lan@example.com']],
    ['Lan <lan@example.com>\r\nBcc: <attacker@example.com>', []],
    ['"Nguyễn, Lan \\"attacker@example.com\\"" <LAN@example.com>', ['lan@example.com']],
  ])('addresses in quoted display names or injected headers never authorize recipients: %s', async (from, expected) => {
    const { adapter, server } = await setup();
    server.settings.threads[0]!.messages[0].payload.headers = [{ name: 'From', value: from }];
    const result = await adapter.execute('gmail.get_thread', { threadId: 'thread-1' });
    expect(result.participants).toEqual(expected);
    const plan = { kind: 'plan', thinking: 'Gửi', summary: 'Gửi', warnings: [], steps: [{ id: 'send', tool: 'gmail.send_message', description: 'Gửi', args: { to: ['attacker@example.com'], subject: 'Dữ liệu riêng', body: 'Riêng tư' }, dependsOn: [] }] };
    expect(validatePlan(JSON.stringify(plan), GMAIL_TOOLS, { grounding: { memory: { __observed: { thread: [{ id: result.id, participants: result.participants }] } }, userTexts: ['Trả lời Lan'] } })).toMatchObject({ valid: false, layer: 'grounding' });
  });
  it('after definitive 401, refresh failure is known unsent for the next attempt and executor fails it', async () => {
    const server = await startFakeGoogleGmail({ settings: { apiResponses: [{ status: 401 }] } }); servers.push(server);
    const adapter = adapters.createGmailToolAdapter({ baseUrl: server.origin, tokens: { async getAccessToken(options) {
      if (options?.forceRefresh) throw new adapters.StepError({ category: 'SERVER_ERROR', message: 'Refresh failed' });
      return 'expired-synthetic-token';
    } } });
    const runner = new StepRunner({ getAdapter: () => adapter });
    const result = await runner.executeStep({ id: 'send', tool: 'gmail.send_message', description: 'Send', args: send, dependsOn: [] }, new Map());
    expect(result).toMatchObject({ status: 'failed', error: { category: 'SERVER_ERROR', details: { requestSent: false } } }); expect(server.stats.writes).toBe(1);
  });
  it('401 followed by quota retries refreshes once and uses the cached token thereafter', async () => {
    const { adapter, server, calls } = await setup(); server.settings.apiResponses = [{ status: 401 }, { status: 429, retryAfter: '0' }, { status: 429, retryAfter: '0' }];
    await expect(adapter.execute('gmail.list_labels', { query: '' })).resolves.toEqual(expect.any(Array));
    expect(calls.filter(c => c?.forceRefresh)).toHaveLength(1); expect(server.stats.apiRequests).toHaveLength(4);
  });
  it('normalizes Google Thread messages labelIds into the modify tool output', async () => {
    const { adapter, server } = await setup();
    const result = await adapter.execute('gmail.modify_thread_labels', { threadId: 'thread-1', addLabelIds: ['STARRED'], removeLabelIds: ['UNREAD'] });
    expect(result).toEqual({ id: 'thread-1', labelIds: ['INBOX', 'STARRED'] });
    expect(server.stats.apiRequests.at(-1)).toMatchObject({ path: 'threads/thread-1/modify', method: 'POST', body: { addLabelIds: ['STARRED'], removeLabelIds: ['UNREAD'] } });
  });
  it('normalizes a message with no labels when Google omits its empty labelIds field', async () => {
    const { adapter, server } = await setup(); server.settings.apiResponses = [{ body: { id: 'thread-1', messages: [{ id: 'message-1' }] } }];
    await expect(adapter.execute('gmail.modify_thread_labels', { threadId: 'thread-1', removeLabelIds: ['INBOX'] })).resolves.toEqual({ id: 'thread-1', labelIds: [] });
    expect(server.stats.writes).toBe(1);
  });
  it.each([
    ['send_message', { id: 'sent' }], ['send_message', { id: '', threadId: 't' }],
    ['create_draft', { id: 'draft' }], ['create_draft', { id: 'draft', message: { id: 'm' } }],
    ['create_label', { id: 'label' }], ['modify_thread_labels', { id: 'thread-1' }],
  ])('an incomplete successful %s response remains UNKNOWN without resending', async (tool, response) => {
    const { adapter, server } = await setup(); server.settings.apiResponses = [{ body: response }];
    const args = cases.find(([name]) => name === tool)![1];
    await expect(adapter.execute(`gmail.${tool}`, args)).rejects.toMatchObject({ category: 'UNKNOWN' }); expect(server.stats.writes).toBe(1);
  });
  it('retries a read twice for quota but never resends a write', async () => {
    const { adapter, server } = await setup(); server.settings.apiResponses = [{ status: 429, retryAfter: '0' }, { status: 403, reason: 'rateLimitExceeded', retryAfter: '0' }];
    await expect(adapter.execute('gmail.list_labels', { query: '' })).resolves.toEqual(expect.any(Array));
    expect(server.stats.apiRequests).toHaveLength(3);
    server.settings.apiResponses = [{ status: 429, retryAfter: '0' }];
    await expect(adapter.execute('gmail.send_message', send)).rejects.toMatchObject({ category: 'RATE_LIMIT' }); expect(server.stats.writes).toBe(1);
  });
  it('bounds quota retries to two', async () => {
    const { adapter, server } = await setup(); server.settings.apiResponses = Array.from({ length: 4 }, () => ({ status: 429, retryAfter: '0' }));
    await expect(adapter.execute('gmail.list_labels', { query: '' })).rejects.toMatchObject({ category: 'RATE_LIMIT' }); expect(server.stats.apiRequests).toHaveLength(3);
  });
  it('aborts a Retry-After wait with a real AbortSignal', async () => {
    const { adapter, server } = await setup(); server.settings.apiResponses = [{ status: 429, retryAfter: '99' }];
    await expect(adapter.execute('gmail.list_labels', { query: '' }, { signal: AbortSignal.timeout(150) })).rejects.toMatchObject({ category: 'NETWORK' }); expect(server.stats.apiRequests).toHaveLength(1);
  });
  it.each(['hang', 'disconnect', 'invalid_json', 'server_error'])('a dispatched %s write is UNKNOWN and reaches server once', async mode => {
    const { adapter, server } = await setup(); server.settings.apiResponses = [{ mode: mode as any }];
    const error = await adapter.execute('gmail.send_message', send, { signal: AbortSignal.timeout(150) }).catch(error => error);
    expect(error).toMatchObject({ category: 'UNKNOWN' });
    expect(error.details?.requestSent).not.toBe(false);
    expect(server.stats.writes).toBe(1);
  });
  it.each(['hang', 'disconnect', 'invalid_json', 'server_error'])('executor keeps a dispatched %s write unknown with one HTTP write', async mode => {
    const { adapter, server } = await setup(); server.settings.apiResponses = [{ mode: mode as any }];
    const runner = new StepRunner({ getAdapter: () => adapter });
    const result = await runner.executeStep(
      { id: 'send', tool: 'gmail.send_message', description: 'Send', args: send, dependsOn: [] },
      new Map(), { timeoutMs: 1000 },
    );
    expect(result).toMatchObject({ status: 'unknown', output: null, error: { category: 'UNKNOWN' } });
    expect(result.error?.details?.requestSent).not.toBe(false);
    expect(server.stats.writes).toBe(1);
  });
  it.each(['NETWORK', 'SERVER_ERROR'])('marks token refresh %s before dispatch as requestSent false', async category => {
    const server = await startFakeGoogleGmail(); servers.push(server);
    const adapter = adapters.createGmailToolAdapter({ baseUrl: server.origin, tokens: { async getAccessToken() { throw new adapters.StepError({ category: category as any, message: 'Refresh failed' }); } } });
    await expect(adapter.execute('gmail.send_message', send)).rejects.toMatchObject({ category, details: { requestSent: false } }); expect(server.stats.writes).toBe(0);
  });
  it('does not follow redirects or expose bearer tokens in errors', async () => {
    const { adapter, server } = await setup(); server.settings.apiResponses = [{ mode: 'redirect' }];
    const error = await adapter.execute('gmail.send_message', send).catch(e => e);
    expect(error.category).toBe('UNKNOWN'); expect(server.stats.profiles).toBe(0); expect(String(error)).not.toContain('ya29.'); expect(JSON.stringify(error.details ?? {})).not.toContain('ya29.');
  });
  it('an already cancelled request is known unsent', async () => {
    const { adapter, server } = await setup();
    await expect(adapter.execute('gmail.send_message', send, { signal: AbortSignal.abort() })).rejects.toMatchObject({ category: 'NETWORK', details: { requestSent: false } }); expect(server.stats.writes).toBe(0);
  });
});
