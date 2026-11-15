import { createServer, type Server } from 'node:http';
import { deflateRawSync, deflateSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import * as adapters from '../src/index.js';
import { startFakeGoogleGmail, type FakeGoogleGmail } from '../../../scripts/fake-google-gmail.mjs';
import type { GmailAccessTokenProvider } from '../src/gmail/token-provider.js';
import { recordObserved, recordThreadLabels, validatePlan, validateSchemaValue } from '@wap/planner';
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
  it('refreshes once on a 401 with a non-JSON body on a write instead of failing with UNKNOWN', async () => {
    const { adapter, server, calls } = await setup();
    server.settings.apiResponses = [{ mode: 'invalid_json', status: 401 }];
    await expect(adapter.execute('gmail.send_message', send)).resolves.toEqual({ id: 'sent-2', threadId: 'new-thread-2' });
    expect(calls.filter(c => c?.forceRefresh)).toHaveLength(1);
    expect(server.stats.writes).toBe(2);
  });
  it('normalizes send_message, reply, forward, trash_thread and create_label outputs to their outputSchema fields', async () => {
    const { adapter, server } = await setup();
    server.settings.apiResponses = [
      { body: { id: 'sent-1', threadId: 'thread-1', labelIds: ['SENT'], extra: 'ignored' } },
    ];
    await expect(adapter.execute('gmail.send_message', send)).resolves.toEqual({ id: 'sent-1', threadId: 'thread-1' });

    server.settings.apiResponses = [
      { body: server.settings.threads[0] },
      { body: { id: 'reply-1', threadId: 'thread-1', labelIds: ['SENT'] } },
    ];
    await expect(adapter.execute('gmail.reply', { threadId: 'thread-1', to: send.to, body: send.body })).resolves.toEqual({ id: 'reply-1', threadId: 'thread-1' });

    server.settings.apiResponses = [
      { body: server.settings.threads[0] },
      { body: { id: 'fwd-1', threadId: 'thread-2', labelIds: ['SENT'] } },
    ];
    await expect(adapter.execute('gmail.forward', { threadId: 'thread-1', to: send.to, note: 'Xem nhé' })).resolves.toEqual({ id: 'fwd-1', threadId: 'thread-2' });

    server.settings.apiResponses = [
      { body: { id: 'thread-1', historyId: '999', messages: [{ id: 'm1' }] } },
    ];
    await expect(adapter.execute('gmail.trash_thread', { threadId: 'thread-1' })).resolves.toEqual({ id: 'thread-1' });

    server.settings.apiResponses = [
      { body: { id: 'Label_1', name: 'Dự án ATI', type: 'user', messageListVisibility: 'show', labelListVisibility: 'labelShow' } },
    ];
    await expect(adapter.execute('gmail.create_label', { name: 'Dự án ATI' })).resolves.toEqual({ id: 'Label_1', name: 'Dự án ATI' });

    server.settings.threads[0]!.messages[0]!.payload.parts = [
      { mimeType: 'application/pdf', filename: 'hop-dong.pdf', body: { size: 450, attachmentId: 'att-1' } },
    ];
    const searched = await adapter.execute('gmail.search_threads', { query: 'họp', limit: 1 });
    expect(searched[0]).toMatchObject({ id: 'thread-1', hasAttachment: true, attachmentNames: ['hop-dong.pdf'] });
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
  it('batch modifies multiple threads and returns deduplicated ids and labelIds', async () => {
    const { adapter, server } = await setup();
    const result = await adapter.execute('gmail.batch_modify_threads', {
      threadIds: ['thread-1', 'thread-1'],
      addLabelIds: ['STARRED'],
      removeLabelIds: ['UNREAD'],
    });
    expect(result).toEqual({ ids: ['thread-1'], labelIds: ['INBOX', 'STARRED'] });
    expect(server.stats.apiRequests.at(-1)).toMatchObject({
      path: 'threads/thread-1/modify',
      method: 'POST',
      body: { addLabelIds: ['STARRED'], removeLabelIds: ['UNREAD'] },
    });
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

  describe('G2 B1 remediation: findings 02, 03, and 04', () => {
    const rawServers: Server[] = [];
    afterEach(async () => {
      await Promise.all(rawServers.splice(0).map(s => new Promise<void>(resolve => {
        s.closeAllConnections?.();
        s.close(() => resolve());
      })));
    });

    function decodePostedMime(server: FakeGoogleGmail) {
      const request = server.stats.apiRequests.find(r => r.method === 'POST');
      expect(request).toBeDefined();
      const message = request!.body.message ?? request!.body;
      const mime = Buffer.from(message.raw, 'base64url').toString('utf8');
      const [headerSection = '', bodySection = ''] = mime.split('\r\n\r\n');
      const rawSubject = headerSection.replace(/\r\n /g, ' ').match(/^Subject: ([^\r]*)/m)?.[1] ?? '';
      const subject = rawSubject
        .replace(/\?=\s+=\?/g, '?==?')
        .replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_, b) => Buffer.from(b, 'base64').toString('utf8'));
      const text = Buffer.from(bodySection.replace(/\r\n/g, ''), 'base64').toString('utf8');
      return { message, mime, headerSection, subject, text };
    }

    function seedBatchThreads(server: FakeGoogleGmail) {
      const baseMsg = server.settings.threads[0]!.messages[0]!;
      server.settings.threads = [
        { id: 't1', messages: [{ ...baseMsg, id: 't1-m1', labelIds: ['INBOX', 'UNREAD'] }] },
        { id: 't2', messages: [{ ...baseMsg, id: 't2-m1', labelIds: ['INBOX', 'UNREAD'] }] },
        { id: 't3', messages: [{ ...baseMsg, id: 't3-m1', labelIds: ['INBOX', 'UNREAD'] }] },
      ];
    }

    it('TDD02: t1 committed then t2=401 then refresh failure => UNKNOWN, requestSent true, completedThreadIds [t1], failedThreadId t2, causeCategory original', async () => {
      const server = await startFakeGoogleGmail(); servers.push(server);
      seedBatchThreads(server);
      const refresh = server.mintRefreshToken();
      let cachedToken: string | undefined;
      const tokens: GmailAccessTokenProvider = {
        async getAccessToken(options) {
          if (!cachedToken || options?.forceRefresh) {
            const response = await fetch(server.endpoints.tokenUrl, {
              method: 'POST',
              signal: options?.signal,
              body: new URLSearchParams({
                client_id: 'gmail-test.apps.googleusercontent.com',
                client_secret: 'fake-gmail-secret',
                grant_type: 'refresh_token',
                refresh_token: refresh,
              }),
            });
            if (!response.ok) {
              throw new adapters.StepError({
                category: response.status === 400 ? 'AUTH_ERROR' : 'SERVER_ERROR',
                statusCode: response.status,
                message: 'Refresh failed',
              });
            }
            cachedToken = (await response.json()).access_token;
          }
          return cachedToken!;
        },
      };
      // Prime initial valid token so t1 commits on real loopback HTTP, then t2 gets 401 and /token fails with 503
      await tokens.getAccessToken();
      server.settings.refresh = 'server_error';
      server.settings.apiResponses = [null as any, { status: 401 }];

      const adapter = adapters.createGmailToolAdapter({ baseUrl: server.origin, tokens });
      const runner = new StepRunner({ getAdapter: () => adapter });
      const result = await runner.executeStep(
        {
          id: 'batch-1',
          tool: 'gmail.batch_modify_threads',
          description: 'Batch star threads',
          args: { threadIds: ['t1', 't2', 't3'], addLabelIds: ['STARRED'], removeLabelIds: ['UNREAD'] },
          dependsOn: [],
        },
        new Map(),
      );

      expect(result).toMatchObject({
        status: 'unknown',
        output: null,
        error: {
          category: 'UNKNOWN',
          details: {
            requestSent: true,
            completedThreadIds: ['t1'],
            failedThreadId: 't2',
            causeCategory: 'SERVER_ERROR',
          },
        },
      });
      expect(server.stats.apiRequests.map(r => r.path)).toEqual(['threads/t1/modify', 'threads/t2/modify']);
      expect(server.stats.writes).toBe(2);
      expect(server.stats.refreshes).toBe(2);
      const serializedDetails = JSON.stringify(result.error?.details ?? {});
      expect(serializedDetails).not.toContain('ya29.');
      expect(serializedDetails).not.toContain('Chào nhóm');
    });

    it.each([
      [404, 'notFound', 'NOT_FOUND'],
      [400, 'badRequest', 'VALIDATION'],
      [403, 'forbidden', 'AUTH_ERROR'],
      [429, 'rateLimitExceeded', 'RATE_LIMIT'],
    ])('TDD02: t1 committed then t2=%s (%s) => compound UNKNOWN with completedThreadIds [t1], failedThreadId t2, causeCategory %s', async (status, reason, causeCategory) => {
      const { adapter, server } = await setup();
      seedBatchThreads(server);
      server.settings.apiResponses = [null as any, { status: Number(status), reason: String(reason) }];

      const runner = new StepRunner({ getAdapter: () => adapter });
      const result = await runner.executeStep(
        {
          id: 'batch-later-err',
          tool: 'gmail.batch_modify_threads',
          description: 'Batch modify',
          args: { threadIds: ['t1', 't2', 't3'], addLabelIds: ['STARRED'] },
          dependsOn: [],
        },
        new Map(),
      );

      expect(result).toMatchObject({
        status: 'unknown',
        output: null,
        error: {
          category: 'UNKNOWN',
          details: {
            requestSent: true,
            completedThreadIds: ['t1'],
            failedThreadId: 't2',
            causeCategory,
          },
        },
      });
      expect(server.stats.apiRequests.map(r => r.path)).toEqual(['threads/t1/modify', 'threads/t2/modify']);
      expect(server.stats.writes).toBe(2);
    });

    it('TDD02: t1 committed then t2=401 followed by second 401 after refresh => compound UNKNOWN with causeCategory AUTH_ERROR', async () => {
      const { adapter, server } = await setup();
      seedBatchThreads(server);
      server.settings.apiResponses = [null as any, { status: 401 }, { status: 401 }];

      const runner = new StepRunner({ getAdapter: () => adapter });
      const result = await runner.executeStep(
        {
          id: 'batch-double-401',
          tool: 'gmail.batch_modify_threads',
          description: 'Batch modify',
          args: { threadIds: ['t1', 't2', 't3'], addLabelIds: ['STARRED'] },
          dependsOn: [],
        },
        new Map(),
      );

      expect(result).toMatchObject({
        status: 'unknown',
        output: null,
        error: {
          category: 'UNKNOWN',
          details: {
            requestSent: true,
            completedThreadIds: ['t1'],
            failedThreadId: 't2',
            causeCategory: 'AUTH_ERROR',
          },
        },
      });
      expect(server.stats.writes).toBe(3);
      expect(server.stats.apiRequests.map(r => r.path)).toEqual([
        'threads/t1/modify',
        'threads/t2/modify',
        'threads/t2/modify',
      ]);
    });

    it('TDD02: first 401 on t1 followed by refresh failure before any mutation => failed known unsent', async () => {
      const server = await startFakeGoogleGmail({ settings: { apiResponses: [{ status: 401 }] } }); servers.push(server);
      seedBatchThreads(server);
      const adapter = adapters.createGmailToolAdapter({
        baseUrl: server.origin,
        tokens: {
          async getAccessToken(options) {
            if (options?.forceRefresh) throw new adapters.StepError({ category: 'SERVER_ERROR', message: 'Refresh failed' });
            return 'expired-synthetic-token';
          },
        },
      });
      const runner = new StepRunner({ getAdapter: () => adapter });
      const result = await runner.executeStep(
        {
          id: 'batch-first-401',
          tool: 'gmail.batch_modify_threads',
          description: 'Batch modify',
          args: { threadIds: ['t1', 't2'], addLabelIds: ['STARRED'] },
          dependsOn: [],
        },
        new Map(),
      );

      expect(result).toMatchObject({
        status: 'failed',
        output: null,
        error: {
          category: 'SERVER_ERROR',
          details: { requestSent: false },
        },
      });
      expect(server.stats.writes).toBe(1);
      expect(server.stats.apiRequests.map(r => r.path)).toEqual(['threads/t1/modify']);
    });

    it('TDD02: multi-thread batch success preserves { ids, labelIds } including mid-batch 401 refresh recovery', async () => {
      const { adapter, server, calls } = await setup();
      seedBatchThreads(server);
      server.settings.apiResponses = [null as any, { status: 401 }];

      const result = await adapter.execute('gmail.batch_modify_threads', {
        threadIds: ['t1', 't2', 't1'],
        addLabelIds: ['STARRED'],
        removeLabelIds: ['UNREAD'],
      });

      expect(result).toEqual({ ids: ['t1', 't2'], labelIds: ['INBOX', 'STARRED'] });
      expect(calls.filter(c => c?.forceRefresh)).toHaveLength(1);
      expect(server.stats.writes).toBe(3);
    });

    it('TDD03: normalizes inbound CRLF+WSP folded References, Subject, and From into clean MIME headers', async () => {
      const { adapter, server } = await setup();
      server.settings.threads[0]!.messages[0]!.payload.headers = [
        { name: 'From', value: 'Lan\r\n <lan@example.com>' },
        { name: 'To', value: 'gmail-owner@example.test' },
        { name: 'Cc', value: 'Minh <minh@example.com>,\r\n\tHoa <hoa@example.com>' },
        { name: 'Subject', value: '  Họp nhóm\r\n\tATI  ' },
        { name: 'Date', value: 'Wed, 14 Oct 2026 09:00:00 +0700' },
        { name: 'Message-ID', value: '<original@example.com>' },
        { name: 'References', value: ' <root@example.com>\r\n <ancestor@example.com>\r\n\t<parent@example.com> ' },
      ];

      const threadView = await adapter.execute('gmail.get_thread', { threadId: 'thread-1' });
      expect(threadView.subject).toBe('Họp nhóm ATI');
      expect(threadView.participants).toEqual([
        'lan@example.com',
        'gmail-owner@example.test',
        'minh@example.com',
        'hoa@example.com',
      ]);

      await adapter.execute('gmail.reply', { threadId: 'thread-1', to: send.to, body: 'Đã nhận' });
      const { mime, subject } = decodePostedMime(server);
      expect(subject).toBe('Re: Họp nhóm ATI');
      expect(mime).toContain('In-Reply-To: <original@example.com>\r\n');
      expect(mime).toContain('References: <root@example.com> <ancestor@example.com> <parent@example.com> <original@example.com>\r\n');
      expect(server.stats.writes).toBe(1);
    });

    it.each([
      '  <original@example.com>\t ',
      '\r\n <original@example.com>\r\n\t',
    ])('TDD03: accepts padded/folded inbound Message-ID (%j) when inner angle token is valid', async paddedId => {
      const { adapter, server } = await setup();
      const headers = server.settings.threads[0]!.messages[0]!.payload.headers;
      const msgIdHeader = headers.find((h: any) => h.name === 'Message-ID')!;
      msgIdHeader.value = paddedId;

      await adapter.execute('gmail.reply', { threadId: 'thread-1', to: send.to, body: 'Trả lời' });
      const { mime } = decodePostedMime(server);
      expect(mime).toContain('In-Reply-To: <original@example.com>\r\n');
      expect(server.stats.writes).toBe(1);
    });

    it.each([
      ['reply', 'Message-ID', '<original@example.com>\r\nBcc: attacker@example.com'],
      ['reply', 'Message-ID', '<original@example.com>\n <second@example.com>'],
      ['reply', 'Message-ID', '<original@example.com>\r <second@example.com>'],
      ['reply', 'Message-ID', '<original@example.com>\r\n'],
      ['reply', 'Message-ID', '<original@example.com>\x00'],
      ['reply', 'References', '<ancestor@example.com>\r\nBcc: attacker@example.com'],
      ['reply', 'References', '<ancestor@example.com>\r\n \r\nInjected body'],
      ['reply', 'References', '<ancestor@example.com>\n <parent@example.com>'],
      ['reply', 'Subject', 'Họp nhóm\r\nBcc: attacker@example.com'],
      ['forward', 'From', 'Lan <lan@example.com>\r\nBcc: attacker@example.com'],
    ])('TDD03: rejects malicious leftover CR/LF/NUL in inbound %s %s with 0 POST dispatches', async (tool, headerName, maliciousValue) => {
      const { adapter, server } = await setup();
      const headers = server.settings.threads[0]!.messages[0]!.payload.headers;
      const target = headers.find((h: any) => h.name === headerName)!;
      target.value = maliciousValue;

      const args = tool === 'forward'
        ? { threadId: 'thread-1', to: send.to, note: 'Xem' }
        : { threadId: 'thread-1', to: send.to, body: 'Trả lời' };
      await expect(adapter.execute(`gmail.${tool}`, args)).rejects.toMatchObject({
        category: 'VALIDATION',
        message: 'Gmail header contains CR/LF or NUL',
        details: { requestSent: false },
      });
      expect(server.stats.writes).toBe(0);
    });

    it.each([
      ['Message-ID', '<original@example.com> (CFWS comment)'],
      ['Message-ID', '(comment) <original@example.com>'],
      ['Message-ID', '<a@example.com> <b@example.com>'],
      ['Message-ID', 'original@example.com'],
      ['Message-ID', '<>'],
      ['References', '<ancestor@example.com> (comment)\r\n <parent@example.com>'],
      ['References', 'ancestor@example.com'],
    ])('TDD03: rejects invalid inbound %s token shape (%s) without comment salvage and 0 POST', async (headerName, invalidValue) => {
      const { adapter, server } = await setup();
      const headers = server.settings.threads[0]!.messages[0]!.payload.headers;
      const target = headers.find((h: any) => h.name === headerName)!;
      target.value = invalidValue;

      await expect(adapter.execute('gmail.reply', { threadId: 'thread-1', to: send.to, body: 'Trả lời' })).rejects.toMatchObject({
        category: 'VALIDATION',
        details: { requestSent: false },
      });
      expect(server.stats.writes).toBe(0);
    });

    it.each([
      ['gmail.send_message', { ...send, subject: 'Chủ đề\r\n gập dòng' }],
      ['gmail.send_message', { ...send, to: ['lan@example.com\r\n '] }],
      ['gmail.create_label', { name: 'Nhãn\r\n Mới' }],
    ])('TDD03: keeps outbound safeHeader strict against folded CRLF+WSP in %s user args', async (tool, args) => {
      const { adapter, server } = await setup();
      await expect(adapter.execute(tool, args)).rejects.toMatchObject({
        category: 'VALIDATION',
        message: 'Gmail header contains CR/LF or NUL',
        details: { requestSent: false },
      });
      expect(server.stats.apiRequests).toHaveLength(0);
      expect(server.stats.writes).toBe(0);
    });

    it.each([
      'Biên bản chốt ngân sách riêng (Approved by User)',
      'Họp nhóm ATI',
      'Re: Chủ đề khác không khớp',
    ])('TDD04: rejects threaded create_draft with incompatible custom subject (%s) before POST with standalone-draft guidance', async customSubject => {
      const { adapter, server } = await setup();
      await expect(
        adapter.execute('gmail.create_draft', {
          threadId: 'thread-1',
          to: send.to,
          subject: customSubject,
          body: 'Nội dung nháp trả lời',
        }),
      ).rejects.toMatchObject({
        category: 'VALIDATION',
        details: { requestSent: false },
        message: expect.stringContaining('Tạo bản nháp thư mới nếu muốn đổi tiêu đề.'),
      });
      expect(server.stats.writes).toBe(0);
    });

    it.each([
      undefined,
      '',
      '   ',
      'Re: Họp nhóm ATI',
    ])('TDD04: threaded create_draft accepts equal/absent/blank subject (%j) and writes canonical derived Re subject', async explicitSubject => {
      const { adapter, server } = await setup();
      const result = await adapter.execute('gmail.create_draft', {
        threadId: 'thread-1',
        to: send.to,
        ...(explicitSubject !== undefined ? { subject: explicitSubject } : {}),
        body: 'Nội dung nháp trả lời',
      });

      expect(result).toEqual({ id: 'draft-1', messageId: 'draft-message-1', threadId: 'thread-1' });
      expect(server.stats.writes).toBe(1);
      const { message, mime, subject } = decodePostedMime(server);
      expect(message.threadId).toBe('thread-1');
      expect(subject).toBe('Re: Họp nhóm ATI');
      expect(mime).toContain('In-Reply-To: <original@example.com>\r\n');
    });

    it('TDD04: standalone create_draft without threadId preserves custom subject verbatim', async () => {
      const { adapter, server } = await setup();
      const customSubject = 'Biên bản chốt ngân sách riêng (Độc lập)';
      const result = await adapter.execute('gmail.create_draft', {
        to: send.to,
        subject: customSubject,
        body: 'Nội dung nháp mới hoàn toàn',
      });

      expect(result).toEqual({ id: 'draft-1', messageId: 'draft-message-1', threadId: 'draft-thread' });
      expect(server.stats.writes).toBe(1);
      const { message, subject } = decodePostedMime(server);
      expect(message.threadId).toBeUndefined();
      expect(subject).toBe(customSubject);
    });

    it('TDD04: forward quotes originalSubject without added Fwd prefix while outer MIME Subject uses Fwd prefix', async () => {
      const { adapter, server } = await setup();
      await adapter.execute('gmail.forward', { threadId: 'thread-1', to: send.to, note: 'Xem nhé' });

      expect(server.stats.writes).toBe(1);
      const { subject, text } = decodePostedMime(server);
      expect(subject).toBe('Fwd: Họp nhóm ATI');
      expect(text).toContain('---------- Forwarded message ----------\r\nFrom: Lan <lan@example.com>\r\nSubject: Họp nhóm ATI\r\n\r\nChào nhóm, họp lúc 9 giờ.');
      expect(text).not.toContain('Subject: Fwd: Họp nhóm ATI');
    });

    it.each([
      'timeout',
      'reset',
      'malformed_json',
      'empty_receipt',
      'blank_id',
    ] as const)('B04 negative guard: consumed POST write then %s => UNKNOWN with requestSent true and 1 HTTP dispatch', async failureMode => {
      let consumedWrites = 0;
      let socketClosedWhilePending = false;
      const rawServer = createServer(async (req, res) => {
        if (req.method === 'POST') {
          for await (const _chunk of req) { /* consume full request body */ }
          consumedWrites++;
          if (failureMode === 'timeout') {
            req.socket.on('close', () => {
              if (!res.writableEnded) socketClosedWhilePending = true;
            });
            return;
          }
          if (failureMode === 'reset') {
            req.socket.destroy();
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          if (failureMode === 'malformed_json') { res.end('{"truncated'); return; }
          if (failureMode === 'empty_receipt') { res.end('{}'); return; }
          res.end(JSON.stringify({ id: '   ', threadId: 'thread-1' }));
          return;
        }
        res.writeHead(404).end();
      });
      rawServers.push(rawServer);
      await new Promise<void>((resolve, reject) => {
        rawServer.once('error', reject);
        rawServer.listen(0, '127.0.0.1', () => resolve());
      });
      const port = (rawServer.address() as { port: number }).port;

      const adapter = adapters.createGmailToolAdapter({
        baseUrl: `http://127.0.0.1:${port}`,
        tokens: { async getAccessToken() { return 'synthetic-live-token'; } },
      });
      const runner = new StepRunner({ getAdapter: () => adapter });
      const result = await runner.executeStep(
        { id: 'send-neg', tool: 'gmail.send_message', description: 'Send', args: send, dependsOn: [] },
        new Map(),
        { timeoutMs: 120 },
      );

      expect(consumedWrites).toBe(1);
      if (failureMode === 'timeout') {
        await new Promise(resolve => setTimeout(resolve, 25));
        expect(socketClosedWhilePending).toBe(true);
      }
      expect(result).toMatchObject({
        status: 'unknown',
        output: null,
        error: {
          category: 'UNKNOWN',
          details: { requestSent: true },
        },
      });
    });

    it.each(['AUTH_ERROR', 'SERVER_ERROR', 'NETWORK'] as const)('B04 negative guard: token failure (%s) before write => failed with requestSent false and 0 writes', async category => {
      const server = await startFakeGoogleGmail(); servers.push(server);
      const adapter = adapters.createGmailToolAdapter({
        baseUrl: server.origin,
        tokens: {
          async getAccessToken() {
            throw new adapters.StepError({ category, message: 'Token unavailable' });
          },
        },
      });
      const runner = new StepRunner({ getAdapter: () => adapter });

      const writeCases: [string, Record<string, any>][] = [
        ['gmail.send_message', send],
        ['gmail.batch_modify_threads', { threadIds: ['t1', 't2'], addLabelIds: ['STARRED'] }],
      ];
      for (const [tool, args] of writeCases) {
        const result = await runner.executeStep(
          { id: 'tok-fail', tool, description: 'Write', args, dependsOn: [] },
          new Map(),
        );
        expect(result).toMatchObject({
          status: 'failed',
          output: null,
          error: {
            category,
            details: { requestSent: false },
          },
        });
      }
      expect(server.stats.writes).toBe(0);
      expect(server.stats.apiRequests).toHaveLength(0);
    });
  });

  describe('G2 C1 remediation: finding 14 read-state projection (isDraft / hasDraft)', () => {
    const searchOutputSchema = GMAIL_TOOLS.find(t => t.name === 'gmail.search_threads')!.outputSchema;
    const getThreadOutputSchema = GMAIL_TOOLS.find(t => t.name === 'gmail.get_thread')!.outputSchema;

    it('C04-1: delivered received message followed by saved draft => search summary uses newest non-DRAFT delivered sender/snippet/date/subject with hasDraft true; get_thread retains marked draft', async () => {
      const { adapter, server } = await setup();
      server.settings.threads = [{
        id: 'thread-delivered-then-draft',
        messages: [
          {
            id: 'msg-delivered-1',
            labelIds: ['INBOX', 'UNREAD'],
            snippet: 'Nhờ bạn xác nhận ngân sách trước 17h hôm nay.',
            payload: {
              mimeType: 'text/plain',
              headers: [
                { name: 'From', value: 'Lan <lan@example.com>' },
                { name: 'To', value: 'gmail-owner@example.test' },
                { name: 'Cc', value: 'Minh <minh@example.com>' },
                { name: 'Subject', value: 'Họp chốt ngân sách quý 4' },
                { name: 'Date', value: 'Wed, 14 Oct 2026 09:00:00 +0700' },
                { name: 'Message-ID', value: '<msg-delivered-1@example.com>' },
              ],
              body: { data: Buffer.from('Nhờ bạn xác nhận ngân sách trước 17h hôm nay.').toString('base64url') },
            },
          },
          {
            id: 'msg-draft-2',
            labelIds: ['DRAFT'],
            snippet: 'Tôi đã phê duyệt ngân sách rồi nhé (NHÁP CHƯA GỬI)',
            payload: {
              mimeType: 'text/plain',
              headers: [
                { name: 'From', value: 'Owner <gmail-owner@example.test>' },
                { name: 'To', value: 'lan@example.com' },
                { name: 'Subject', value: 'Re: Họp chốt ngân sách quý 4 (Bản nháp)' },
                { name: 'Date', value: 'Wed, 14 Oct 2026 09:30:00 +0700' },
                { name: 'Message-ID', value: '<msg-draft-2@example.com>' },
              ],
              body: { data: Buffer.from('Tôi đã phê duyệt ngân sách rồi nhé (NHÁP CHƯA GỬI)').toString('base64url') },
            },
          },
        ],
      }];

      const searched = await adapter.execute('gmail.search_threads', { query: 'ngân sách', limit: 5 });
      expect(searched).toHaveLength(1);
      expect(searched[0]).toEqual({
        id: 'thread-delivered-then-draft',
        subject: 'Họp chốt ngân sách quý 4',
        from: 'Lan <lan@example.com>',
        to: ['gmail-owner@example.test'],
        cc: ['minh@example.com'],
        snippet: 'Nhờ bạn xác nhận ngân sách trước 17h hôm nay.',
        date: 'Wed, 14 Oct 2026 09:00:00 +0700',
        labels: ['INBOX', 'UNREAD', 'DRAFT'],
        messageCount: 2,
        unread: true,
        hasAttachment: false,
        attachmentNames: [],
        hasDraft: true,
        participants: ['lan@example.com', 'gmail-owner@example.test', 'minh@example.com'],
      });
      expect(validateSchemaValue(searched, searchOutputSchema, 'output')).toBeNull();

      const threadView = await adapter.execute('gmail.get_thread', { threadId: 'thread-delivered-then-draft' });
      expect(threadView).toEqual({
        id: 'thread-delivered-then-draft',
        subject: 'Họp chốt ngân sách quý 4',
        participants: ['lan@example.com', 'gmail-owner@example.test', 'minh@example.com'],
        totalMessages: 2,
        omittedMessages: 0,
        messages: [
          {
            messageId: 'msg-delivered-1',
            from: 'Lan <lan@example.com>',
            to: ['gmail-owner@example.test'],
            cc: ['minh@example.com'],
            date: 'Wed, 14 Oct 2026 09:00:00 +0700',
            subject: 'Họp chốt ngân sách quý 4',
            body: 'Nhờ bạn xác nhận ngân sách trước 17h hôm nay.',
            attachments: [],
            isDraft: false,
          },
          {
            messageId: 'msg-draft-2',
            from: 'Owner <gmail-owner@example.test>',
            to: ['lan@example.com'],
            cc: [],
            date: 'Wed, 14 Oct 2026 09:30:00 +0700',
            subject: 'Re: Họp chốt ngân sách quý 4 (Bản nháp)',
            body: 'Tôi đã phê duyệt ngân sách rồi nhé (NHÁP CHƯA GỬI)',
            attachments: [],
            isDraft: true,
          },
        ],
      });
      expect(validateSchemaValue(threadView, getThreadOutputSchema, 'output')).toBeNull();
    });

    it('C04-2: multi-message thread with older draft and newer delivered message + trailing draft picks newest non-DRAFT delivered message and keeps hasDraft true', async () => {
      const { adapter, server } = await setup();
      server.settings.threads = [
        {
          id: 'thread-mixed-history',
          messages: [
            {
              id: 'm1-delivered',
              labelIds: ['INBOX'],
              snippet: 'Tin đầu tiên từ Lan.',
              payload: {
                mimeType: 'text/plain',
                headers: [
                  { name: 'From', value: 'Lan <lan@example.com>' },
                  { name: 'To', value: 'gmail-owner@example.test' },
                  { name: 'Subject', value: 'Luồng trao đổi dự án' },
                  { name: 'Date', value: 'Wed, 14 Oct 2026 08:00:00 +0700' },
                ],
                body: { data: Buffer.from('Tin đầu tiên từ Lan.').toString('base64url') },
              },
            },
            {
              id: 'm2-old-draft',
              labelIds: ['DRAFT'],
              snippet: 'Nháp cũ chưa xóa.',
              payload: {
                mimeType: 'text/plain',
                headers: [
                  { name: 'From', value: 'Owner <gmail-owner@example.test>' },
                  { name: 'To', value: 'lan@example.com' },
                  { name: 'Subject', value: 'Re: Luồng trao đổi dự án (Nháp 1)' },
                  { name: 'Date', value: 'Wed, 14 Oct 2026 08:15:00 +0700' },
                ],
                body: { data: Buffer.from('Nháp cũ chưa xóa.').toString('base64url') },
              },
            },
            {
              id: 'm3-newest-delivered',
              labelIds: ['INBOX', 'UNREAD'],
              snippet: 'Cập nhật mới nhất từ Minh đã gửi thật.',
              payload: {
                mimeType: 'text/plain',
                headers: [
                  { name: 'From', value: 'Minh <minh@example.com>' },
                  { name: 'To', value: 'gmail-owner@example.test' },
                  { name: 'Cc', value: 'lan@example.com' },
                  { name: 'Subject', value: 'Re: Luồng trao đổi dự án' },
                  { name: 'Date', value: 'Wed, 14 Oct 2026 10:05:00 +0700' },
                ],
                body: { data: Buffer.from('Cập nhật mới nhất từ Minh đã gửi thật.').toString('base64url') },
              },
            },
          ],
        },
      ];

      const [summaryWithMidDraft] = await adapter.execute('gmail.search_threads', { query: 'dự án', limit: 1 });
      expect(summaryWithMidDraft).toMatchObject({
        id: 'thread-mixed-history',
        from: 'Minh <minh@example.com>',
        to: ['gmail-owner@example.test'],
        cc: ['lan@example.com'],
        snippet: 'Cập nhật mới nhất từ Minh đã gửi thật.',
        date: 'Wed, 14 Oct 2026 10:05:00 +0700',
        subject: 'Re: Luồng trao đổi dự án',
        hasDraft: true,
      });

      const threadView = await adapter.execute('gmail.get_thread', { threadId: 'thread-mixed-history' });
      expect(threadView.messages.map((m: any) => ({ id: m.messageId, isDraft: m.isDraft }))).toEqual([
        { id: 'm1-delivered', isDraft: false },
        { id: 'm2-old-draft', isDraft: true },
        { id: 'm3-newest-delivered', isDraft: false },
      ]);
      expect(validateSchemaValue([summaryWithMidDraft], searchOutputSchema, 'output')).toBeNull();
      expect(validateSchemaValue(threadView, getThreadOutputSchema, 'output')).toBeNull();
    });

    it('C04-3: draft-only thread => search summary reports hasDraft true and empty delivered sender/snippet/date/subject without implying sent status; get_thread retains marked draft', async () => {
      const { adapter, server } = await setup();
      server.settings.threads = [{
        id: 'draft-only-thread',
        messages: [{
          id: 'standalone-draft-1',
          labelIds: ['DRAFT'],
          snippet: 'Bản nháp đề xuất hợp tác chưa từng được gửi đi.',
          payload: {
            mimeType: 'text/plain',
            headers: [
              { name: 'From', value: 'Owner <gmail-owner@example.test>' },
              { name: 'To', value: 'lan@example.com' },
              { name: 'Cc', value: 'minh@example.com' },
              { name: 'Subject', value: 'Đề xuất hợp tác chưa gửi' },
              { name: 'Date', value: 'Wed, 14 Oct 2026 11:00:00 +0700' },
            ],
            body: { data: Buffer.from('Bản nháp đề xuất hợp tác chưa từng được gửi đi.').toString('base64url') },
          },
        }],
      }];

      const [draftSummary] = await adapter.execute('gmail.search_threads', { query: 'hợp tác', limit: 1 });
      expect(draftSummary).toEqual({
        id: 'draft-only-thread',
        subject: '',
        from: '',
        to: [],
        cc: [],
        snippet: '',
        date: '',
        labels: ['DRAFT'],
        messageCount: 1,
        unread: false,
        hasAttachment: false,
        attachmentNames: [],
        hasDraft: true,
        participants: ['gmail-owner@example.test', 'lan@example.com', 'minh@example.com'],
      });
      expect(validateSchemaValue([draftSummary], searchOutputSchema, 'output')).toBeNull();

      const draftThread = await adapter.execute('gmail.get_thread', { threadId: 'draft-only-thread' });
      expect(draftThread).toEqual({
        id: 'draft-only-thread',
        subject: '',
        participants: ['gmail-owner@example.test', 'lan@example.com', 'minh@example.com'],
        totalMessages: 1,
        omittedMessages: 0,
        messages: [{
          messageId: 'standalone-draft-1',
          from: 'Owner <gmail-owner@example.test>',
          to: ['lan@example.com'],
          cc: ['minh@example.com'],
          date: 'Wed, 14 Oct 2026 11:00:00 +0700',
          subject: 'Đề xuất hợp tác chưa gửi',
          body: 'Bản nháp đề xuất hợp tác chưa từng được gửi đi.',
          attachments: [],
          isDraft: true,
        }],
      });
      expect(validateSchemaValue(draftThread, getThreadOutputSchema, 'output')).toBeNull();
    });

    it('C04-4: no-draft thread emits explicit boolean hasDraft false and per-message isDraft false even when labelIds is omitted', async () => {
      const { adapter, server } = await setup();
      server.settings.threads = [{
        id: 'thread-no-draft',
        messages: [
          {
            id: 'm1',
            labelIds: ['INBOX'],
            snippet: 'Thư đến.',
            payload: {
              mimeType: 'text/plain',
              headers: [
                { name: 'From', value: 'Lan <lan@example.com>' },
                { name: 'To', value: 'gmail-owner@example.test' },
                { name: 'Subject', value: 'Thư không có bản nháp' },
                { name: 'Date', value: 'Wed, 14 Oct 2026 09:00:00 +0700' },
              ],
              body: { data: Buffer.from('Thư đến.').toString('base64url') },
            },
          },
          {
            id: 'm2-no-labels',
            snippet: 'Phản hồi đã gửi thật (không có labelIds).',
            payload: {
              mimeType: 'text/plain',
              headers: [
                { name: 'From', value: 'Owner <gmail-owner@example.test>' },
                { name: 'To', value: 'lan@example.com' },
                { name: 'Subject', value: 'Re: Thư không có bản nháp' },
                { name: 'Date', value: 'Wed, 14 Oct 2026 09:10:00 +0700' },
              ],
              body: { data: Buffer.from('Phản hồi đã gửi thật (không có labelIds).').toString('base64url') },
            },
          },
        ],
      }];

      const [summary] = await adapter.execute('gmail.search_threads', { query: 'nháp', limit: 1 });
      expect(summary.hasDraft).toBe(false);
      expect(summary.from).toBe('Owner <gmail-owner@example.test>');
      expect(summary.snippet).toBe('Phản hồi đã gửi thật (không có labelIds).');
      expect(summary.subject).toBe('Re: Thư không có bản nháp');
      expect(validateSchemaValue([summary], searchOutputSchema, 'output')).toBeNull();

      const threadView = await adapter.execute('gmail.get_thread', { threadId: 'thread-no-draft' });
      expect(threadView.messages.map((m: any) => m.isDraft)).toEqual([false, false]);
      expect(validateSchemaValue(threadView, getThreadOutputSchema, 'output')).toBeNull();
    });

    it('C04-5: preserves last-5 messages, 4k per-message / 12k total Unicode budgets, 20 header-only participants, and attachment metadata without bytes across delivered + draft messages', async () => {
      const { adapter, server } = await setup();
      const longDeliveredSubject = 'Tiêu đề Tiếng Việt 😊 '.repeat(15); // > 250 code points
      const longDeliveredSnippet = 'Đoạn trích Tiếng Việt 😊 '.repeat(12); // > 200 code points
      const secretAttachmentBytes = Buffer.from('SECRET_RAW_ATTACHMENT_BYTES_NEVER_RETURNED').toString('base64url');
      const manyRecipients = Array.from({ length: 25 }, (_, i) => `member${i}@example.com`).join(', ');

      server.settings.threads = [{
        id: 'thread-bounds-unicode-draft',
        messages: [
          ...Array.from({ length: 6 }, (_, i) => ({
            id: `delivered-${i}`,
            labelIds: ['INBOX'],
            snippet: i === 5 ? longDeliveredSnippet : `Snippet ${i}`,
            payload: {
              mimeType: 'multipart/mixed',
              headers: [
                { name: 'From', value: 'Lan <LAN@example.com>' },
                { name: 'To', value: manyRecipients },
                { name: 'Subject', value: i === 5 ? longDeliveredSubject : `Chủ đề ${i}` },
                { name: 'Date', value: `Wed, 14 Oct 2026 0${i}:00:00 +0700` },
              ],
              parts: [
                {
                  mimeType: 'text/plain',
                  body: { data: Buffer.from('😊'.repeat(4500) + ' body-injected@example.com').toString('base64url') },
                },
                ...(i === 5 ? [{
                  mimeType: 'application/pdf',
                  filename: 'hợp-đồng-📎.pdf',
                  body: { size: 4096, attachmentId: 'att-secret-delivered', data: secretAttachmentBytes },
                }] : []),
              ],
            },
          })),
          {
            id: 'draft-6',
            labelIds: ['DRAFT'],
            snippet: 'NHÁP KHÔNG ĐƯỢC LẤY LÀM SUMMARY SNIPPET',
            payload: {
              mimeType: 'multipart/mixed',
              headers: [
                { name: 'From', value: 'Owner <gmail-owner@example.test>' },
                { name: 'To', value: 'lan@example.com' },
                { name: 'Subject', value: 'NHÁP KHÔNG ĐƯỢC LẤY LÀM SUMMARY SUBJECT' },
                { name: 'Date', value: 'Wed, 14 Oct 2026 12:00:00 +0700' },
              ],
              parts: [
                {
                  mimeType: 'text/plain',
                  body: { data: Buffer.from('📝'.repeat(4500) + ' draft-body@example.com').toString('base64url') },
                },
                {
                  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                  filename: 'bản-nháp-đính-kèm-📎.docx',
                  body: { size: 2048, attachmentId: 'att-secret-draft', data: secretAttachmentBytes },
                },
              ],
            },
          },
        ],
      }];

      const [summary] = await adapter.execute('gmail.search_threads', { query: 'hợp-đồng', limit: 1 });
      expect(summary.hasDraft).toBe(true);
      expect(summary.from).toBe('Lan <LAN@example.com>');
      expect(summary.date).toBe('Wed, 14 Oct 2026 05:00:00 +0700');
      expect(Array.from(summary.subject as string)).toHaveLength(250);
      expect(summary.subject).not.toContain('\uFFFD');
      expect(summary.subject).not.toContain('NHÁP');
      expect(Array.from(summary.snippet as string)).toHaveLength(200);
      expect(summary.snippet).not.toContain('\uFFFD');
      expect(summary.snippet).not.toContain('NHÁP');
      expect(summary.hasAttachment).toBe(true);
      expect(summary.attachmentNames).toEqual(['hợp-đồng-📎.pdf', 'bản-nháp-đính-kèm-📎.docx']);
      expect(summary.participants).toHaveLength(20);
      expect(summary.participants).not.toContain('body-injected@example.com');
      expect(summary.participants).not.toContain('draft-body@example.com');
      expect(JSON.stringify(summary)).not.toContain(secretAttachmentBytes);
      expect(JSON.stringify(summary)).not.toContain('att-secret');
      expect(validateSchemaValue([summary], searchOutputSchema, 'output')).toBeNull();

      const threadView = await adapter.execute('gmail.get_thread', { threadId: 'thread-bounds-unicode-draft' });
      expect(threadView.messages).toHaveLength(5);
      expect(threadView.messages.map((m: any) => ({ id: m.messageId, isDraft: m.isDraft }))).toEqual([
        { id: 'delivered-2', isDraft: false },
        { id: 'delivered-3', isDraft: false },
        { id: 'delivered-4', isDraft: false },
        { id: 'delivered-5', isDraft: false },
        { id: 'draft-6', isDraft: true },
      ]);
      expect(threadView.messages.every((m: any) => Array.from(m.body as string).length <= 4000 && !m.body.includes('\uFFFD'))).toBe(true);
      expect(threadView.messages.reduce((sum: number, m: any) => sum + Array.from(m.body as string).length, 0)).toBe(12000);
      expect(threadView.messages[3]!.attachments).toEqual([{ filename: 'hợp-đồng-📎.pdf', size: 4096 }]);
      expect(threadView.messages[4]!.attachments).toEqual([{ filename: 'bản-nháp-đính-kèm-📎.docx', size: 2048 }]);
      expect(threadView.participants).toHaveLength(20);
      expect(threadView.participants).not.toContain('body-injected@example.com');
      expect(threadView.participants).not.toContain('draft-body@example.com');
      const serializedThread = JSON.stringify(threadView);
      expect(serializedThread).not.toContain(secretAttachmentBytes);
      expect(serializedThread).not.toContain('SECRET_RAW_ATTACHMENT_BYTES');
      expect(serializedThread).not.toContain('att-secret');
      expect(validateSchemaValue(threadView, getThreadOutputSchema, 'output')).toBeNull();
    });

    it('C04-6: preserves B1 unfolded headers, reply/forward/threaded-draft latest non-DRAFT selection, and planner memory/label consumer contracts on additive output', async () => {
      const { adapter, server } = await setup();
      server.settings.threads = [{
        id: 'thread-b1-and-c1',
        messages: [
          {
            id: 'm1-folded-delivered',
            labelIds: ['INBOX', 'UNREAD'],
            snippet: 'Nội dung thư gốc đã nhận.',
            payload: {
              mimeType: 'text/plain',
              headers: [
                { name: 'From', value: 'Lan\r\n <lan@example.com>' },
                { name: 'To', value: 'gmail-owner@example.test' },
                { name: 'Subject', value: '  Họp nhóm\r\n\tATI  ' },
                { name: 'Date', value: 'Wed, 14 Oct 2026 09:00:00 +0700' },
                { name: 'Message-ID', value: ' <original@example.com>\r\n\t' },
                { name: 'References', value: ' <root@example.com>\r\n <ancestor@example.com> ' },
              ],
              body: { data: Buffer.from('Nội dung thư gốc đã nhận.').toString('base64url') },
            },
          },
          {
            id: 'm2-later-draft',
            labelIds: ['DRAFT'],
            snippet: 'Nháp trả lời đang soạn dở.',
            payload: {
              mimeType: 'text/plain',
              headers: [
                { name: 'From', value: 'Owner <gmail-owner@example.test>' },
                { name: 'To', value: 'lan@example.com' },
                { name: 'Subject', value: 'Re: Họp nhóm ATI' },
                { name: 'Date', value: 'Wed, 14 Oct 2026 09:45:00 +0700' },
                { name: 'Message-ID', value: '<draft-not-for-reply@example.com>' },
              ],
              body: { data: Buffer.from('Nháp trả lời đang soạn dở.').toString('base64url') },
            },
          },
        ],
      }];

      const searched = await adapter.execute('gmail.search_threads', { query: 'Họp', limit: 1 });
      expect(searched[0]).toMatchObject({
        id: 'thread-b1-and-c1',
        subject: 'Họp nhóm ATI',
        from: 'Lan <lan@example.com>',
        snippet: 'Nội dung thư gốc đã nhận.',
        hasDraft: true,
      });
      const threadView = await adapter.execute('gmail.get_thread', { threadId: 'thread-b1-and-c1' });
      expect(threadView.subject).toBe('Họp nhóm ATI');
      expect(threadView.messages.map((m: any) => m.isDraft)).toEqual([false, true]);

      // Planner working-memory & label projections ignore hasDraft/isDraft and keep only id + participants / delivered subject
      const observedFromSearch = recordObserved(undefined, 'thread', searched, ['id', 'participants']);
      expect(observedFromSearch.thread).toEqual([{
        id: 'thread-b1-and-c1',
        participants: ['lan@example.com', 'gmail-owner@example.test'],
      }]);
      const observedFromThread = recordObserved(undefined, 'thread', [threadView], ['id', 'participants']);
      expect(observedFromThread.thread).toEqual([{
        id: 'thread-b1-and-c1',
        participants: ['lan@example.com', 'gmail-owner@example.test'],
      }]);
      expect(recordThreadLabels(undefined, searched)).toEqual({ 'thread-b1-and-c1': 'Họp nhóm ATI' });

      // Reply still selects m1-folded-delivered (latest non-DRAFT), unfolds Message-ID/References, and never replies to m2-later-draft
      await adapter.execute('gmail.reply', { threadId: 'thread-b1-and-c1', to: send.to, body: 'Phản hồi chính thức' });
      expect(server.stats.writes).toBe(1);
      const replyReq = server.stats.apiRequests.find(r => r.method === 'POST')!;
      const replyMime = Buffer.from(replyReq.body.raw, 'base64url').toString('utf8');
      expect(replyMime).toContain('In-Reply-To: <original@example.com>\r\n');
      expect(replyMime).toContain('References: <root@example.com> <ancestor@example.com> <original@example.com>\r\n');
      expect(replyMime).not.toContain('draft-not-for-reply');

      // B1 custom threaded draft subject mismatch still rejects before POST
      await expect(
        adapter.execute('gmail.create_draft', {
          threadId: 'thread-b1-and-c1',
          to: send.to,
          subject: 'Đổi chủ đề trái phép',
          body: 'Nháp mới',
        }),
      ).rejects.toMatchObject({
        category: 'VALIDATION',
        details: { requestSent: false },
      });
      expect(server.stats.writes).toBe(1);
    });
  });

  describe('GMAIL-AUDIT-10 & 11: thread window counts, newest participants cap, and MIME/HTML formatting', () => {
    it('emits totalMessages and omittedMessages on gmail.get_thread for truncated and untruncated threads', async () => {
      const { adapter, server } = await setup();
      const mkMsg = (idx: number) => ({
        id: `m-${idx}`,
        labelIds: ['INBOX'],
        payload: {
          mimeType: 'text/plain',
          headers: [
            { name: 'From', value: `user${idx}@example.com` },
            { name: 'Subject', value: 'Luồng dài' },
            { name: 'Date', value: `Wed, 14 Oct 2026 09:0${idx}:00 +0700` },
          ],
          body: { data: Buffer.from(`Thư ${idx}`).toString('base64url') },
        },
      });
      server.settings.threads = [
        { id: 'thread-8', messages: Array.from({ length: 8 }, (_, i) => mkMsg(i + 1)) },
        { id: 'thread-2', messages: Array.from({ length: 2 }, (_, i) => mkMsg(i + 1)) },
      ];

      const view8 = await adapter.execute('gmail.get_thread', { threadId: 'thread-8' });
      expect(view8.totalMessages).toBe(8);
      expect(view8.omittedMessages).toBe(3);
      expect(view8.messages).toHaveLength(5);

      const view2 = await adapter.execute('gmail.get_thread', { threadId: 'thread-2' });
      expect(view2.totalMessages).toBe(2);
      expect(view2.omittedMessages).toBe(0);
      expect(view2.messages).toHaveLength(2);
    });

    it('retains newest message participants within the 20-address cap in forward chronological order', async () => {
      const { adapter, server } = await setup();
      server.settings.threads = [{
        id: 'thread-many-participants',
        messages: Array.from({ length: 22 }, (_, i) => ({
          id: `pm-${i}`,
          labelIds: ['INBOX'],
          payload: {
            mimeType: 'text/plain',
            headers: [
              { name: 'From', value: `user${i}@example.com` },
              { name: 'Subject', value: 'Nhiều người tham gia' },
              { name: 'Date', value: 'Wed, 14 Oct 2026 09:00:00 +0700' },
            ],
            body: { data: Buffer.from(`Tin nhắn ${i}`).toString('base64url') },
          },
        })),
      }];

      const view = await adapter.execute('gmail.get_thread', { threadId: 'thread-many-participants' });
      expect(view.participants).toHaveLength(20);
      expect(view.participants).toContain('user21@example.com');
      expect(view.participants).toContain('user2@example.com');
      expect(view.participants).not.toContain('user0@example.com');
      expect(view.participants).not.toContain('user1@example.com');
      expect(view.participants.indexOf('user2@example.com')).toBeLessThan(
        view.participants.indexOf('user21@example.com'),
      );
    });

    it('decodes parameterized uppercase TEXT/HTML MIME types and preserves block-tag newlines', async () => {
      const { adapter, server } = await setup();
      const htmlBody = '<style>.hidden{display:none}</style><div>Alpha</div><p>Beta</p><li>Gamma<br/>Delta</li>';
      server.settings.threads = [{
        id: 'thread-html-blocks',
        messages: [{
          id: 'html-1',
          labelIds: ['INBOX'],
          payload: {
            mimeType: 'TEXT/HTML; charset=UTF-8',
            headers: [
              { name: 'From', value: 'lan@example.com' },
              { name: 'Subject', value: 'HTML test' },
              { name: 'Date', value: 'Wed, 14 Oct 2026 09:00:00 +0700' },
            ],
            body: { data: Buffer.from(htmlBody).toString('base64url') },
          },
        }],
      }];

      const view = await adapter.execute('gmail.get_thread', { threadId: 'thread-html-blocks' });
      expect(view.messages[0]!.body).toBe('Alpha\nBeta\nGamma\nDelta');
    });
  });

  describe('Attachment extraction, attachment-preserving forward, and full draft lifecycle', () => {
    function crc32(buf: Buffer): number {
      let crc = 0xffffffff;
      for (const byte of buf) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) {
          crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
        }
      }
      return (crc ^ 0xffffffff) >>> 0;
    }

    function buildZipBuffer(files: Record<string, string | Buffer>): Buffer {
      const locals: Buffer[] = [];
      const centrals: Buffer[] = [];
      let offset = 0;
      for (const [name, content] of Object.entries(files)) {
        const nameBuf = Buffer.from(name, 'utf8');
        const raw = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
        const compressed = deflateRawSync(raw);
        const crc = crc32(raw);

        const local = Buffer.alloc(30 + nameBuf.length);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0, 6);
        local.writeUInt16LE(8, 8);
        local.writeUInt16LE(0, 10);
        local.writeUInt16LE(0, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(compressed.length, 18);
        local.writeUInt32LE(raw.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        local.writeUInt16LE(0, 28);
        nameBuf.copy(local, 30);
        locals.push(local, compressed);

        const central = Buffer.alloc(46 + nameBuf.length);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0, 8);
        central.writeUInt16LE(8, 10);
        central.writeUInt16LE(0, 12);
        central.writeUInt16LE(0, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(compressed.length, 20);
        central.writeUInt32LE(raw.length, 24);
        central.writeUInt16LE(nameBuf.length, 28);
        central.writeUInt16LE(0, 30);
        central.writeUInt16LE(0, 32);
        central.writeUInt16LE(0, 34);
        central.writeUInt16LE(0, 36);
        central.writeUInt32LE(0, 38);
        central.writeUInt32LE(offset, 42);
        nameBuf.copy(central, 46);
        centrals.push(central);

        offset += local.length + compressed.length;
      }
      const centralDir = Buffer.concat(centrals);
      const eocd = Buffer.alloc(22);
      eocd.writeUInt32LE(0x06054b50, 0);
      eocd.writeUInt16LE(0, 4);
      eocd.writeUInt16LE(0, 6);
      eocd.writeUInt16LE(Object.keys(files).length, 8);
      eocd.writeUInt16LE(Object.keys(files).length, 10);
      eocd.writeUInt32LE(centralDir.length, 12);
      eocd.writeUInt32LE(offset, 16);
      eocd.writeUInt16LE(0, 20);
      return Buffer.concat([...locals, centralDir, eocd]);
    }

    it('extracts text from CSV, DOCX, XLSX, and FlateDecode PDF attachments via gmail.read_attachment', async () => {
      const { adapter, server } = await setup();
      const csvBuf = Buffer.from('MaHoaDon,KhachHang,TongTien\nINV-001,Cong ty ABC,15000000\n', 'utf8');
      const docxBuf = buildZipBuffer({
        'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Hợp đồng ATI &amp; Đối tác</w:t></w:r></w:p><w:p><w:r><w:t>Giá trị: 250 triệu</w:t></w:r></w:p></w:body></w:document>',
      });
      const xlsxBuf = buildZipBuffer({
        'xl/sharedStrings.xml': '<sst><si><t>Sản phẩm</t></si><si><t>Doanh thu</t></si><si><t>Gói Pro</t></si></sst>',
        'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row><row><c t="s"><v>2</v></c><c><v>9800</v></c></row></sheetData></worksheet>',
      });
      const pdfStream = deflateSync(Buffer.from('BT /F1 12 Tf 72 720 Td (Invoice INV-2026 Total 420 USD) Tj ET', 'latin1'));
      const pdfBuf = Buffer.concat([
        Buffer.from('%PDF-1.4\n4 0 obj\n<< /Length ' + pdfStream.length + ' /Filter /FlateDecode >>\nstream\n', 'latin1'),
        pdfStream,
        Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1'),
      ]);

      server.settings.attachments['m-att:att-csv'] = csvBuf;
      server.settings.attachments['m-att:att-docx'] = docxBuf;
      server.settings.attachments['m-att:att-xlsx'] = xlsxBuf;
      server.settings.attachments['m-att:att-pdf'] = pdfBuf;
      server.settings.attachments['m-att:att-big'] = Buffer.alloc(16, 0x41);
      server.settings.threads = [{
        id: 'thread-att-suite',
        messages: [{
          id: 'm-att',
          labelIds: ['INBOX'],
          payload: {
            mimeType: 'multipart/mixed',
            headers: [
              { name: 'From', value: 'Lan <lan@example.com>' },
              { name: 'Subject', value: 'Tài liệu đính kèm' },
              { name: 'Date', value: 'Wed, 14 Oct 2026 09:00:00 +0700' },
              { name: 'Message-ID', value: '<att-suite@example.com>' },
            ],
            parts: [
              { mimeType: 'text/plain', body: { data: Buffer.from('Xem tệp đính kèm nhé.').toString('base64url') } },
              { mimeType: 'text/csv', filename: 'bao-cao.csv', body: { size: csvBuf.length, attachmentId: 'att-csv' } },
              { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', filename: 'hop-dong.docx', body: { size: docxBuf.length, attachmentId: 'att-docx' } },
              { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: 'doanh-so.xlsx', body: { size: xlsxBuf.length, attachmentId: 'att-xlsx' } },
              { mimeType: 'application/pdf', filename: 'invoice.pdf', body: { size: pdfBuf.length, attachmentId: 'att-pdf' } },
              { mimeType: 'application/octet-stream', filename: 'too-big.bin', body: { size: 6 * 1024 * 1024, attachmentId: 'att-big' } },
            ],
          },
        }],
      }];

      const csv = await adapter.execute('gmail.read_attachment', { threadId: 'thread-att-suite', filename: 'bao-cao.csv' });
      expect(csv).toMatchObject({ filename: 'bao-cao.csv', extracted: true, truncated: false });
      expect(csv.text).toContain('INV-001,Cong ty ABC,15000000');

      const docx = await adapter.execute('gmail.read_attachment', { threadId: 'thread-att-suite', filename: 'hop-dong.docx' });
      expect(docx.extracted).toBe(true);
      expect(docx.text).toContain('Hợp đồng ATI & Đối tác');
      expect(docx.text).toContain('Giá trị: 250 triệu');

      const xlsx = await adapter.execute('gmail.read_attachment', { threadId: 'thread-att-suite', filename: 'doanh-so.xlsx' });
      expect(xlsx.extracted).toBe(true);
      expect(xlsx.text).toContain('Sản phẩm\tDoanh thu');
      expect(xlsx.text).toContain('Gói Pro\t9800');

      const pdf = await adapter.execute('gmail.read_attachment', { threadId: 'thread-att-suite', filename: 'invoice.pdf' });
      expect(pdf.extracted).toBe(true);
      expect(pdf.text).toContain('Invoice INV-2026 Total 420 USD');

      await expect(
        adapter.execute('gmail.read_attachment', { threadId: 'thread-att-suite', filename: 'too-big.bin' }),
      ).rejects.toMatchObject({ category: 'VALIDATION', message: expect.stringContaining('5 MB') });
    });

    it('forwards attachments as multipart/mixed only when includeAttachments=true while defaulting to plain text', async () => {
      const { adapter, server } = await setup();
      const fileBytes = Buffer.from('Hello attachment bytes!', 'utf8');
      server.settings.attachments['m-fwd:att-1'] = fileBytes;
      server.settings.threads = [{
        id: 'thread-fwd-att',
        messages: [{
          id: 'm-fwd',
          labelIds: ['INBOX'],
          payload: {
            mimeType: 'multipart/mixed',
            headers: [
              { name: 'From', value: 'Lan <lan@example.com>' },
              { name: 'Subject', value: 'Báo giá Q4' },
              { name: 'Date', value: 'Wed, 14 Oct 2026 09:00:00 +0700' },
              { name: 'Message-ID', value: '<fwd@example.com>' },
            ],
            parts: [
              { mimeType: 'text/plain', body: { data: Buffer.from('Đính kèm bảng giá.').toString('base64url') } },
              { mimeType: 'text/plain', filename: 'bang-gia.txt', body: { size: fileBytes.length, attachmentId: 'att-1' } },
            ],
          },
        }],
      }];

      const args = { threadId: 'thread-fwd-att', to: ['minh@example.com'], includeAttachments: true };
      const approvedSource = await adapter.execute('gmail.prepare_write', { tool: 'gmail.forward', args });
      await adapter.execute('gmail.forward', { ...args, approvedSource });
      const req = server.stats.apiRequests.find((r) => r.method === 'POST' && r.path === 'messages/send')!;
      const mime = Buffer.from(req.body.raw, 'base64url').toString('utf8');
      expect(mime).toContain('Content-Type: multipart/mixed; boundary=');
      expect(mime).toContain('filename="bang-gia.txt"');
      expect(mime).toContain(fileBytes.toString('base64'));
    });

    it('lists, updates (PUT), and securely sends drafts only when recipients match approved preview', async () => {
      const { adapter, server } = await setup();
      const drafts = await adapter.execute('gmail.list_drafts', {});
      expect(drafts).toHaveLength(1);
      expect(drafts[0]).toMatchObject({ id: 'draft-seed-1', threadId: 'thread-1', subject: 'Re: Họp nhóm ATI', to: ['lan@example.com'] });

      const updateArgs = {
        draftId: 'draft-seed-1',
        threadId: 'thread-1',
        to: ['lan@example.com'],
        cc: ['minh@example.com'],
        subject: 'Re: Họp nhóm ATI',
        body: 'Nội dung bản nháp đã cập nhật.',
      };
      const updateSource = await adapter.execute('gmail.prepare_write', { tool: 'gmail.update_draft', args: updateArgs });
      const updated = await adapter.execute('gmail.update_draft', { ...updateArgs, approvedSource: updateSource });
      expect(updated).toMatchObject({ draftId: 'draft-seed-1', threadId: 'thread-1' });
      expect(server.stats.apiRequests.some((r) => r.method === 'PUT' && r.path === 'drafts/draft-seed-1')).toBe(true);

      const sendArgs = { draftId: 'draft-seed-1', to: ['lan@example.com'], cc: ['minh@example.com'] };
      const approvedSource = await adapter.execute('gmail.prepare_write', { tool: 'gmail.send_draft', args: sendArgs });
      const draft = server.settings.drafts[0]!.message;
      const originalRaw = draft.raw;
      draft.raw = Buffer.from('Bcc: hidden@example.com\r\n' + Buffer.from(originalRaw, 'base64url').toString('utf8')).toString('base64url');
      const writesBeforeBlockedSend = server.stats.writes;
      await expect(
        adapter.execute('gmail.send_draft', { ...sendArgs, approvedSource }),
      ).rejects.toMatchObject({ category: 'VALIDATION', details: { requestSent: false } });
      expect(server.stats.writes).toBe(writesBeforeBlockedSend);

      draft.raw = originalRaw;
      const sentDraft = await adapter.execute('gmail.send_draft', { ...sendArgs, approvedSource });
      expect(sentDraft).toMatchObject({ id: expect.stringMatching(/^sent-/), threadId: 'thread-1' });
    });

    it('rejects gmail.send_draft when recipient headers swap between To and Bcc', async () => {
      const { adapter, server } = await setup();
      server.settings.drafts[0]!.message.payload.headers = [
        { name: 'To', value: 'lan@example.com' },
        { name: 'Bcc', value: 'minh@example.com' },
        { name: 'Subject', value: 'Re: Họp nhóm ATI' },
      ];
      const writesBefore = server.stats.writes;
      await expect(
        adapter.execute('gmail.prepare_write', {
          tool: 'gmail.send_draft',
          args: { draftId: 'draft-seed-1', to: ['lan@example.com', 'minh@example.com'] },
        }),
      ).rejects.toMatchObject({ category: 'VALIDATION', details: { requestSent: false } });
      expect(server.stats.writes).toBe(writesBefore);
    });

    it('enforces cumulative 15 MB decompression budget across multi-stream PDFs and multi-entry ZIPs', async () => {
      const { adapter, server } = await setup();
      const nineMbSpaces = ' '.repeat(9 * 1024 * 1024);
      const stream1 = deflateSync(Buffer.from(`BT /F1 12 Tf (FirstStreamOK) Tj ET ${nineMbSpaces}`, 'latin1'));
      const stream2 = deflateSync(Buffer.from(`BT /F1 12 Tf (SecondStreamShouldStop) Tj ET ${nineMbSpaces}`, 'latin1'));
      const multiStreamPdf = Buffer.concat([
        Buffer.from('%PDF-1.4\n1 0 obj\n<< /Filter /FlateDecode >>\nstream\n', 'latin1'),
        stream1,
        Buffer.from('\nendstream\nendobj\n2 0 obj\n<< /Filter /FlateDecode >>\nstream\n', 'latin1'),
        stream2,
        Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1'),
      ]);
      const nineMbXmlPad = ' '.repeat(9 * 1024 * 1024);
      const multiEntryZip = buildZipBuffer({
        'word/pad1.xml': Buffer.from(`<w:t>${nineMbXmlPad}</w:t>`, 'utf8'),
        'word/document.xml': Buffer.from(`<w:document><w:body><w:p><w:r><w:t>${nineMbXmlPad}OverBudgetDoc</w:t></w:r></w:p></w:body></w:document>`, 'utf8'),
      });
      server.settings.attachments['m-bomb:pdf'] = multiStreamPdf;
      server.settings.attachments['m-bomb:docx'] = multiEntryZip;
      server.settings.threads = [{
        id: 'thread-bomb',
        messages: [{
          id: 'm-bomb',
          labelIds: ['INBOX'],
          payload: {
            mimeType: 'multipart/mixed',
            headers: [
              { name: 'From', value: 'lan@example.com' },
              { name: 'Subject', value: 'Check budget' },
            ],
            parts: [
              { mimeType: 'application/pdf', filename: 'multi.pdf', body: { size: multiStreamPdf.length, attachmentId: 'pdf' } },
              { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', filename: 'multi.docx', body: { size: multiEntryZip.length, attachmentId: 'docx' } },
            ],
          },
        }],
      }];

      const pdfRes = await adapter.execute('gmail.read_attachment', { threadId: 'thread-bomb', filename: 'multi.pdf' });
      expect(pdfRes.extracted).toBe(true);
      expect(pdfRes.text).toContain('FirstStreamOK');
      expect(pdfRes.text).not.toContain('SecondStreamShouldStop');

      const docxRes = await adapter.execute('gmail.read_attachment', { threadId: 'thread-bomb', filename: 'multi.docx' });
      expect(docxRes.extracted).toBe(false);
    });
  });
});
