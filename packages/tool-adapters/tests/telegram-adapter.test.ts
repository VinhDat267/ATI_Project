import { afterEach, expect, it, vi } from 'vitest';
import * as adapters from '../src/index.js';

const token = '123456789:synthetic_bot_token_abcdefghijkl';
const id = '-1001234567890';
const chat = { id: -1001234567890, title: 'ATI Test', type: 'supergroup' };
const message = { message_id: 42, chat, date: 1791014400 };
const ok = (result: unknown) => new Response(JSON.stringify({ ok: true, result }));
const error = (code: number, status = 200, parameters?: object) => new Response(JSON.stringify({ ok: false, error_code: code, description: 'provider ' + token + ' https://api.telegram.org/bot' + token, parameters }), { status });
const fast = () => new adapters.GlobalRateLimiter({ maxRequests: 10000, windowMs: 1 });
function make(fetchFn: any, extra: any = {}) {
  const Constructor = (adapters as any).TelegramAdapter;
  expect(Constructor, 'Telegram adapter must be exported').toBeTypeOf('function');
  return new Constructor({ credentials: { botToken: token }, allowedScope: { chats: [id] }, fetchFn, rateLimiter: fast(), chatRateLimiter: fast(), groupRateLimiter: fast(), ...extra });
}
const dispatch = (a: any, signal?: AbortSignal) => a.execute('telegram.send_message', { chatId: id, text: '<b>plain</b> https://example.test' }, { signal });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('lists only scoped chats, preserves canonical IDs, names private chats, filters and limits', async () => {
  const fetchFn = vi.fn(async (_url, init) => {
    const requested = JSON.parse(init.body).chat_id;
    return ok(requested === id ? chat : { id: 42, type: 'private', first_name: 'An', last_name: 'Nguyen', username: 'other' });
  });
  const a = make(fetchFn, { allowedScope: { chats: ['-001001234567890', '00042', id] } });
  expect(await a.execute('telegram.list_chats', { query: '', limit: 10 })).toEqual([{ id, title: 'ATI Test', type: 'supergroup' }, { id: '42', title: 'An Nguyen', type: 'private' }]);
  expect(fetchFn.mock.calls.map(c => JSON.parse(c[1].body).chat_id)).toEqual([id, '42']);
  fetchFn.mockClear();
  expect(await a.execute('telegram.list_chats', { query: 'nguyen', limit: 1 })).toEqual([{ id: '42', title: 'An Nguyen', type: 'private' }]);
});

it.each([undefined, { chats: [] }, { chats: ['@outside'] }, { chats: [id, 'bad'] }])('requires complete nonempty scope before any request: %j', async scope => {
  const fetchFn = vi.fn(); const a = make(fetchFn, { allowedScope: scope });
  await expect(a.execute('telegram.list_chats', { query: '' })).rejects.toMatchObject({ category: 'AUTH_ERROR' });
  await expect(dispatch(a)).rejects.toMatchObject({ category: 'AUTH_ERROR' });
  expect(fetchFn).not.toHaveBeenCalled();
});

it.each([{ query: '', limit: 11 }, { query: '', limit: 0 }, { query: 1 }, {}, { query: '', limit: 1.5 }])('rejects invalid list input before transport: %j', async args => {
  const fetchFn = vi.fn(); await expect(make(fetchFn).execute('telegram.list_chats', args)).rejects.toMatchObject({ category: 'VALIDATION' }); expect(fetchFn).not.toHaveBeenCalled();
});

it('rejects out-of-scope, invalid IDs, empty/oversized text and markup options before getChat', async () => {
  const fetchFn = vi.fn(); const a = make(fetchFn);
  await expect(a.execute('telegram.send_message', { chatId: '42', text: 'x' })).rejects.toMatchObject({ category: 'AUTH_ERROR' });
  for (const args of [{ chatId: '@outside', text: 'x' }, { chatId: id, text: '' }, { chatId: id, text: 'x'.repeat(4097) }, { chatId: id, text: 'x', parse_mode: 'HTML' }]) await expect(a.execute('telegram.send_message', args)).rejects.toMatchObject({ category: 'VALIDATION' });
  expect(fetchFn).not.toHaveBeenCalled();
});

it('sends plain text with link previews and paid broadcast disabled after identity-checked getChat', async () => {
  const fetchFn = vi.fn().mockResolvedValueOnce(ok(chat)).mockResolvedValueOnce(ok(message));
  const controller = new AbortController();
  expect(await dispatch(make(fetchFn), controller.signal)).toEqual({ messageId: 42, chatId: id, date: 1791014400 });
  expect(fetchFn.mock.calls.map(c => String(c[0]).split('/').at(-1))).toEqual(['getChat', 'sendMessage']);
  const init = fetchFn.mock.calls[1]![1];
  expect(JSON.parse(init.body)).toEqual({ chat_id: id, text: '<b>plain</b> https://example.test', link_preview_options: { is_disabled: true }, allow_paid_broadcast: false });
  expect(init).toMatchObject({ method: 'POST', redirect: 'error', signal: controller.signal });
  expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
});

it('accepts 4096 Unicode codepoints consistently with the JSON schema', async () => {
  const fetchFn = vi.fn().mockResolvedValueOnce(ok(chat)).mockResolvedValueOnce(ok(message));
  expect(await make(fetchFn).execute('telegram.send_message', { chatId: id, text: '😀'.repeat(4096) })).toMatchObject({ messageId: 42 });
});

it('checks getMe without requiring a chat scope and returns only health', async () => {
  const fetchFn = vi.fn().mockResolvedValue(ok({ id: 123456789, is_bot: true, first_name: 'Fixture' }));
  expect(await make(fetchFn, { allowedScope: undefined }).checkConnection()).toBe(true);
  expect(String(fetchFn.mock.calls[0]![0])).toBe('https://api.telegram.org/bot' + token + '/getMe');
  expect(JSON.parse(fetchFn.mock.calls[0]![1].body)).toEqual({});
});

it.each([['invalid/token', 'AUTH_ERROR'], ['', 'AUTH_ERROR']])('rejects unsafe credentials without constructing a request URL', async (botToken, category) => {
  const fetchFn = vi.fn(); await expect(make(fetchFn, { credentials: { botToken } }).checkConnection()).rejects.toMatchObject({ category }); expect(fetchFn).not.toHaveBeenCalled();
});

it.each([[400, 'VALIDATION'], [401, 'AUTH_ERROR'], [403, 'AUTH_ERROR'], [404, 'NOT_FOUND'], [409, 'VALIDATION']])('classifies JSON ok:false %i despite HTTP 200', async (code, category) => {
  const fetchFn = vi.fn().mockResolvedValue(error(Number(code)));
  await expect(make(fetchFn).execute('telegram.list_chats', { query: '' })).rejects.toMatchObject({ category, statusCode: code, retryable: false });
  expect(fetchFn).toHaveBeenCalledTimes(1);
});

it('classifies actual HTTP status before contradictory JSON codes', async () => {
  const fetchFn = vi.fn().mockResolvedValueOnce(ok(chat)).mockResolvedValueOnce(error(403, 503));
  await expect(dispatch(make(fetchFn))).rejects.toMatchObject({ category: 'UNKNOWN', statusCode: 503, retryable: false });
  expect(fetchFn).toHaveBeenCalledTimes(2);
});

it('never auto-migrates an allowlisted group to a new unapproved ID', async () => {
  const fetchFn = vi.fn().mockResolvedValueOnce(ok(chat)).mockResolvedValueOnce(error(400, 200, { migrate_to_chat_id: -1009999999999 }));
  await expect(dispatch(make(fetchFn))).rejects.toMatchObject({ category: 'VALIDATION', retryable: false }); expect(fetchFn).toHaveBeenCalledTimes(2);
});

it('retries read network failures twice and read server failures once', async () => {
  const network = vi.fn().mockRejectedValue(new Error('request ' + token));
  await expect(make(network).execute('telegram.list_chats', { query: '' })).rejects.toMatchObject({ category: 'NETWORK' }); expect(network).toHaveBeenCalledTimes(3);
  const server = vi.fn().mockResolvedValue(error(500));
  await expect(make(server).execute('telegram.list_chats', { query: '' })).rejects.toMatchObject({ category: 'SERVER_ERROR' }); expect(server).toHaveBeenCalledTimes(2);
});

it.each(['network', 'server', 'malformed', 'body-error', 'missing-message', 'wrong-chat'])('leaves a dispatched write UNKNOWN without replay: %s', async failure => {
  const fetchFn = vi.fn().mockResolvedValueOnce(ok(chat));
  if (failure === 'network') fetchFn.mockRejectedValueOnce(new Error('fetch https://api.telegram.org/bot' + token + '/sendMessage'));
  if (failure === 'server') fetchFn.mockResolvedValueOnce(error(500));
  if (failure === 'malformed') fetchFn.mockResolvedValueOnce(new Response('not JSON ' + token));
  if (failure === 'body-error') fetchFn.mockResolvedValueOnce({ status: 200, json: async () => { throw new Error(token); } });
  if (failure === 'missing-message') fetchFn.mockResolvedValueOnce(ok({ ...message, message_id: 0 }));
  if (failure === 'wrong-chat') fetchFn.mockResolvedValueOnce(ok({ ...message, chat: { ...chat, id: -1009999999999 } }));
  const thrown = await dispatch(make(fetchFn)).catch((e: any) => e);
  expect(thrown).toBeInstanceOf(adapters.StepError); expect(thrown).toMatchObject({ category: 'UNKNOWN', retryable: false });
  expect(thrown.message).not.toContain(token); expect(thrown.message).not.toContain('api.telegram.org/bot');
  expect(thrown.cause).toBeUndefined(); expect(thrown.details).toBeUndefined(); expect(JSON.stringify(thrown)).not.toContain(token);
  expect(fetchFn).toHaveBeenCalledTimes(2);
});

it.each([{ ...chat, id: -1009999999999 }, { ...chat, id: Number.MAX_SAFE_INTEGER + 1 }, { ...chat, title: token }, { ...chat, type: 'future' }])('rejects unsafe or mismatched getChat results before writing: %j', async result => {
  const fetchFn = vi.fn().mockResolvedValue(ok(result)); await expect(dispatch(make(fetchFn))).rejects.toMatchObject({ category: 'SERVER_ERROR' }); expect(fetchFn).toHaveBeenCalledTimes(1);
});

it('redacts provider errors and transport failures for reads, including stacks and causes', async () => {
  for (const response of [error(403), new Error('request https://api.telegram.org/bot' + token + '/getChat')]) {
    const fetchFn = vi.fn(); response instanceof Error ? fetchFn.mockRejectedValue(response) : fetchFn.mockResolvedValue(response);
    const thrown = await make(fetchFn).execute('telegram.list_chats', { query: '' }).catch((e: any) => e);
    expect(thrown).toBeInstanceOf(adapters.StepError);
    expect(thrown.stack).not.toContain(token); expect(thrown.stack).not.toContain('api.telegram.org/bot');
    expect(thrown.cause).toBeUndefined(); expect(thrown.details).toBeUndefined();
  }
});

it('honors body retry_after for HTTP200/429 and retries a rejected write only once', async () => {
  vi.useFakeTimers(); const times: number[] = [];
  const fetchFn = vi.fn(async (url: any) => { if (String(url).endsWith('/getChat')) return ok(chat); times.push(Date.now()); return times.length === 1 ? error(429, 200, { retry_after: 2 }) : ok(message); });
  const pending = dispatch(make(fetchFn));
  await vi.advanceTimersByTimeAsync(1999); expect(times).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1); expect(await pending).toMatchObject({ messageId: 42 }); expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(2000);
});

it('uses HTTP Retry-After when body is absent and stops after a second 429', async () => {
  vi.useFakeTimers();
  const fetchFn = vi.fn().mockResolvedValueOnce(ok(chat)).mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '1' } })).mockResolvedValueOnce(error(429, 200, { retry_after: 1 }));
  const pending = dispatch(make(fetchFn)).catch((e: any) => e);
  await vi.advanceTimersByTimeAsync(999); expect(fetchFn).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1); expect(await pending).toMatchObject({ category: 'RATE_LIMIT', retryable: false }); expect(fetchFn).toHaveBeenCalledTimes(3);
});

it('does not clamp long retry_after into an early retry or accept invalid delays', async () => {
  for (const retry_after of [31, -1, '1', 1.5]) {
    const fetchFn = vi.fn().mockResolvedValueOnce(ok(chat)).mockResolvedValueOnce(error(429, 200, { retry_after }));
    await expect(dispatch(make(fetchFn))).rejects.toMatchObject({ category: 'RATE_LIMIT', retryable: false }); expect(fetchFn).toHaveBeenCalledTimes(2);
  }
});

it('shares one-second private-chat pacing across adapter instances', async () => {
  vi.useFakeTimers(); const times: number[] = []; const privateChat = { id: 42, type: 'private', first_name: 'An' };
  const fetchFn = vi.fn(async (url: any) => { if (String(url).endsWith('/getChat')) return ok(privateChat); times.push(Date.now()); return ok({ ...message, chat: privateChat }); });
  const config = { credentials: { botToken: '123456780:private_rate_fixture_abcdefghijkl' }, allowedScope: { chats: ['42'] }, chatRateLimiter: undefined, groupRateLimiter: undefined };
  const first = make(fetchFn, config); const second = make(fetchFn, config);
  await first.execute('telegram.send_message', { chatId: '42', text: 'one' });
  const pending = second.execute('telegram.send_message', { chatId: '42', text: 'two' });
  await vi.advanceTimersByTimeAsync(999); expect(times).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1); await pending; expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(1000);
});

it('paces groups at three seconds and never exceeds twenty sends per sliding minute', async () => {
  vi.useFakeTimers(); const times: number[] = [];
  const fetchFn = vi.fn(async (url: any) => { if (String(url).endsWith('/getChat')) return ok(chat); times.push(Date.now()); return ok(message); });
  const a = make(fetchFn, { credentials: { botToken: '123456781:group_rate_fixture_abcdefghijkl' }, chatRateLimiter: undefined, groupRateLimiter: undefined });
  const pending = (async () => { for (let i = 0; i < 21; i++) await dispatch(a); })();
  await vi.advanceTimersByTimeAsync(2999); expect(times).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(57000); expect(times).toHaveLength(20);
  await vi.advanceTimersByTimeAsync(1); await pending; expect(times).toHaveLength(21);
  for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(3000);
  expect(times[20]! - times[0]!).toBeGreaterThanOrEqual(60000);
});

it('cancels real limiter waits without sending and sanitizes the abort reason', async () => {
  const fetchFn = vi.fn(async (url: any) => String(url).endsWith('/getChat') ? ok(chat) : ok(message));
  const a = make(fetchFn, { credentials: { botToken: '123456782:abort_rate_fixture_abcdefghijkl' }, groupRateLimiter: undefined });
  await dispatch(a); const controller = new AbortController();
  const pending = dispatch(a, controller.signal).catch((e: any) => e);
  await new Promise(resolve => setTimeout(resolve, 5)); controller.abort(new Error(token));
  const thrown = await pending; expect(thrown).toMatchObject({ category: 'NETWORK', retryable: false }); expect(thrown.message).not.toContain(token);
  expect(fetchFn.mock.calls.filter(c => String(c[0]).endsWith('/sendMessage'))).toHaveLength(1);
});

it('uses a real fetch AbortSignal for in-flight write cancellation and never replays', async () => {
  const controller = new AbortController(); let observed: AbortSignal | undefined;
  const fetchFn = vi.fn().mockResolvedValueOnce(ok(chat)).mockImplementationOnce(async (_url, init) => {
    observed = init.signal; return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
  });
  const pending = dispatch(make(fetchFn), controller.signal).catch((e: any) => e);
  await new Promise(resolve => setTimeout(resolve, 5)); expect(observed).toBe(controller.signal); controller.abort(new Error(token));
  expect(await pending).toMatchObject({ category: 'UNKNOWN', retryable: false }); expect(fetchFn).toHaveBeenCalledTimes(2);
});

it('rejects cancellation before transport and unknown tools without fetching', async () => {
  const fetchFn = vi.fn(); const a = make(fetchFn); const controller = new AbortController(); controller.abort(new Error(token));
  await expect(dispatch(a, controller.signal)).rejects.toMatchObject({ category: 'NETWORK', retryable: false });
  await expect(a.execute('telegram.delete_message', {})).rejects.toMatchObject({ category: 'VALIDATION' });
  expect(fetchFn).not.toHaveBeenCalled();
});
