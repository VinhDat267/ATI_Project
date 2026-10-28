import assert from 'node:assert/strict';
import { test } from 'node:test';
import { request as httpRequest } from 'node:http';
import { startFakeSlackPersonal } from './fake-slack-personal.mjs';

async function fixture(t) { const provider = await startFakeSlackPersonal(); t.after(() => provider.close()); return provider; }
async function call(p, token, method, args = {}, options = {}) {
  const response = await fetch(`${p.origin}/api/${method}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(args), ...options });
  return { status: response.status, body: await response.json() };
}
async function pages(p, token, method, field, args) {
  const all = []; let cursor;
  do {
    const { body } = await call(p, token, method, { ...args, cursor, limit: 1 });
    assert.equal(body.ok, true);
    all.push(...body[field]); cursor = body.response_metadata.next_cursor;
  } while (cursor);
  return all;
}

test('personal fixture binds each token to its exact actor and workspace over HTTP', async t => {
  const p = await fixture(t);
  for (const [key, team, user] of [['a','T_FREE','U_FREE_A'],['b','T_PRO','U_PRO_A'],['colleague','T_FREE','U_FREE_B']]) {
    const { status, body } = await call(p, p.tokens[key], 'auth.test');
    assert.equal(status, 200); assert.equal(body.ok, true); assert.equal(body.team_id, team); assert.equal(body.user_id, user);
  }
  assert.match(p.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
});
test('unknown tokens fail without a transport-status illusion', async t => {
  const p = await fixture(t);
  assert.deepEqual(await call(p, 'invalid', 'auth.test'), { status: 200, body: { ok: false, error: 'invalid_auth' } });
});
test('list pagination includes only the token owner resources and preserves colliding IDs', async t => {
  const p = await fixture(t);
  const a = await pages(p, p.tokens.a, 'conversations.list', 'channels', { types: 'public_channel,private_channel,im' });
  const b = await pages(p, p.tokens.b, 'conversations.list', 'channels', {});
  const colleague = await pages(p, p.tokens.colleague, 'conversations.list', 'channels', {});
  assert.deepEqual(a.map(x => x.id), ['C_GENERAL','G_PRIVATE','D_PRIVATE']);
  assert.deepEqual(b.map(x => x.id), ['C_GENERAL']); assert.deepEqual(colleague.map(x => x.id), ['C_GENERAL']);
  assert.equal(a[0].name, 'general'); assert.equal(b[0].name, 'general');
});
test('cursors cannot be reused by another member, workspace, method or query', async t => {
  const p = await fixture(t);
  const args = { types: 'public_channel,private_channel,im', limit: 1 };
  const { body } = await call(p, p.tokens.a, 'conversations.list', args);
  const cursor = body.response_metadata.next_cursor; assert.ok(cursor);
  assert.equal((await call(p, p.tokens.b, 'conversations.list', { ...args, cursor })).body.error, 'invalid_cursor');
  assert.equal((await call(p, p.tokens.colleague, 'conversations.list', { ...args, cursor })).body.error, 'invalid_cursor');
  assert.equal((await call(p, p.tokens.a, 'conversations.list', { cursor })).body.error, 'invalid_cursor');
  assert.equal((await call(p, p.tokens.a, 'conversations.history', { channel: 'C_GENERAL', cursor })).body.error, 'invalid_cursor');
});
test('history and threads page through the right workspace without exposing private sources', async t => {
  const p = await fixture(t);
  const free = await pages(p, p.tokens.a, 'conversations.history', 'messages', { channel: 'C_GENERAL' });
  const pro = await pages(p, p.tokens.b, 'conversations.history', 'messages', { channel: 'C_GENERAL' });
  assert.equal(free.length, 3); assert.equal(pro.length, 1);
  assert.equal(pro[0].text, 'Pro root'); assert.equal(free[0].text, 'Free root');
  const thread = await pages(p, p.tokens.a, 'conversations.replies', 'messages', { channel: 'C_GENERAL', ts: '1000.000001' });
  assert.equal(thread.length, 3); assert.equal(thread[0].ts, '1000.000001');
  for (const channel of ['G_PRIVATE','D_PRIVATE']) {
    assert.equal((await call(p, p.tokens.colleague, 'conversations.history', { channel })).body.error, 'channel_not_found');
    assert.equal((await call(p, p.tokens.b, 'conversations.history', { channel })).body.error, 'channel_not_found');
    assert.equal((await call(p, p.tokens.a, 'conversations.history', { channel })).body.ok, true);
  }
});
test('posting uses the authorized user, stores state once and supports thread readback', async t => {
  const p = await fixture(t);
  const { body } = await call(p, p.tokens.a, 'chat.postMessage', { channel: 'C_GENERAL', text: 'A authored this', thread_ts: '1000.000001', user: 'forged-user' });
  assert.equal(body.ok, true); assert.equal(body.message.user, 'U_FREE_A');
  const history = await pages(p, p.tokens.a, 'conversations.history', 'messages', { channel: 'C_GENERAL' });
  assert.equal(history.filter(x => x.text === 'A authored this').length, 1);
  const replies = await pages(p, p.tokens.a, 'conversations.replies', 'messages', { channel: 'C_GENERAL', ts: '1000.000001' });
  assert.equal(replies.find(x => x.ts === body.ts).user, 'U_FREE_A');
  const pro = await pages(p, p.tokens.b, 'conversations.history', 'messages', { channel: 'C_GENERAL' });
  assert.equal(pro.some(x => x.text === 'A authored this'), false);
});
test('read-only member cannot post even to a visible public channel', async t => {
  const p = await fixture(t);
  assert.deepEqual(await call(p, p.tokens.colleague, 'chat.postMessage', { channel: 'C_GENERAL', text: 'must not appear' }), { status: 200, body: { ok: false, error: 'missing_scope' } });
  const history = await pages(p, p.tokens.a, 'conversations.history', 'messages', { channel: 'C_GENERAL' });
  assert.equal(history.some(x => x.text === 'must not appear'), false);
});
test('chunked UTF-8 input preserves Vietnamese message content exactly', async t => {
  const p = await fixture(t);
  const text = 'Việt Nam: nhận việc thứ Sáu';
  const bytes = Buffer.from(JSON.stringify({ channel: 'C_GENERAL', text }));
  const cut = bytes.indexOf(Buffer.from('ệ')) + 1;
  const result = await new Promise((resolveResult, reject) => {
    const req = httpRequest(`${p.origin}/api/chat.postMessage`, { method: 'POST', headers: { authorization: `Bearer ${p.tokens.a}`, 'content-type': 'application/json' } }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', chunk => body += chunk); res.on('end', () => resolveResult(JSON.parse(body))); res.on('error', reject);
    });
    req.on('error', reject); req.write(bytes.subarray(0, cut)); setTimeout(() => req.end(bytes.subarray(cut)), 25);
  });
  assert.equal(result.ok, true); assert.equal(result.message.text, text);
});
test('invalid cursor, missing channel and nonexistent thread are explicit failures', async t => {
  const p = await fixture(t);
  assert.equal((await call(p, p.tokens.a, 'conversations.list', { cursor: 'garbage' })).body.error, 'invalid_cursor');
  assert.equal((await call(p, p.tokens.a, 'conversations.history', { channel: 'missing' })).body.error, 'channel_not_found');
  assert.equal((await call(p, p.tokens.a, 'conversations.replies', { channel: 'C_GENERAL', ts: 'missing' })).body.error, 'thread_not_found');
  assert.equal((await call(p, p.tokens.a, 'chat.postMessage', { channel: 'C_GENERAL', text: 'bad thread', thread_ts: 'missing' })).body.error, 'thread_not_found');
});
test('fault delays cause a real AbortSignal timeout and do not affect another method', async t => {
  const p = await fixture(t);
  p.setFault('conversations.list', { delayMs: 300 });
  const signal = AbortSignal.timeout(40);
  await assert.rejects(call(p, p.tokens.a, 'conversations.list', {}, { signal }), error => error.name === 'TimeoutError');
  assert.equal(signal.aborted, true);
  assert.equal((await call(p, p.tokens.a, 'auth.test')).body.ok, true);
});
test('a timed-out write can already have committed, and readback proves exactly one message', async t => {
  const p = await fixture(t);
  p.setFault('chat.postMessage', { delayMs: 5000, afterCommit: true });
  const controller = new AbortController();
  const rejection = assert.rejects(call(p, p.tokens.a, 'chat.postMessage', { channel: 'C_GENERAL', text: 'committed before timeout' }, { signal: controller.signal }), error => error.name === 'TimeoutError');
  let observed = false;
  for (let attempt = 0; attempt < 40 && !observed; attempt++) {
    observed = (await pages(p, p.tokens.a, 'conversations.history', 'messages', { channel: 'C_GENERAL' })).some(x => x.text === 'committed before timeout');
    if (!observed) await new Promise(resolveWait => setTimeout(resolveWait, 10));
  }
  assert.equal(observed, true, 'server committed before starting the response timeout');
  const timeout = AbortSignal.timeout(30);
  timeout.addEventListener('abort', () => controller.abort(timeout.reason), { once: true });
  await rejection;
  const history = await pages(p, p.tokens.a, 'conversations.history', 'messages', { channel: 'C_GENERAL' });
  assert.equal(history.filter(x => x.text === 'committed before timeout').length, 1);
});
