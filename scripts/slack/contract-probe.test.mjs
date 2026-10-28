import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { startFakeSlackPersonal } from '../fake-slack-personal.mjs';
import { runFixtureProbes } from './contract-probe.mjs';

async function fixture(t) { const p = await startFakeSlackPersonal(); t.after(() => p.close()); return p; }
async function gateway(t, provider, intercept, host = '127.0.0.1') {
  const requests = [];
  const server = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString('utf8');
      const args = JSON.parse(body || '{}');
      const entry = { path: req.url, token: (req.headers.authorization ?? '').replace(/^Bearer /, ''), args };
      requests.push(entry);
      const result = await intercept?.(entry);
      if (result) {
        res.writeHead(result.status ?? 200, { 'content-type': 'application/json', ...result.headers });
        return res.end(result.raw ?? JSON.stringify(result.body));
      }
      const response = await fetch(provider.origin + req.url, { method: 'POST', headers: { authorization: req.headers.authorization, 'content-type': 'application/json' }, body, redirect: 'error' });
      const text = await response.text();
      if (!res.destroyed) { res.writeHead(response.status, { 'content-type': 'application/json' }); res.end(text); }
    } catch { if (!res.destroyed) { res.writeHead(500); res.end('{}'); } }
  });
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, host, resolveListen); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolveClose => server.close(resolveClose)); });
  return { origin: `http://${host === '::1' ? '[::1]' : host}:${server.address().port}`, requests };
}
function run(provider, options = {}) { return runFixtureProbes({ baseUrl: provider.origin, tokens: provider.tokens, ...options }); }
async function allMessages(p) {
  const messages = []; let cursor;
  do {
    const res = await fetch(p.origin + '/api/conversations.history', { method: 'POST', headers: { authorization: `Bearer ${p.tokens.a}`, 'content-type': 'application/json' }, body: JSON.stringify({ channel: 'C_GENERAL', limit: 100, cursor }) });
    const data = await res.json(); assert.equal(data.ok, true); messages.push(...data.messages); cursor = data.response_metadata.next_cursor;
  } while (cursor);
  return messages;
}

test('fixture probe verifies identity, pagination, scope, thread write/readback and isolation without live claims', async t => {
  const p = await fixture(t);
  const report = await run(p);
  assert.equal(report.mode, 'fixture'); assert.equal(report.verifiedLive, false);
  assert.ok(report.checks.length >= 10); assert.ok(report.checks.every(check => check.status === 'pass'), JSON.stringify(report));
  const output = JSON.stringify(report);
  for (const token of Object.values(p.tokens)) assert.equal(output.includes(token), false);
  for (const text of ['Free root','Private source','fixture-probe-']) assert.equal(output.includes(text), false);
});
test('non-literal, public, HTTPS or credential-bearing origins fail preflight', async t => {
  const p = await fixture(t);
  const invalid = ['https://slack.com','https://127.0.0.1:1234','http://localhost:1234','http://2130706433:1234','http://127.1:1234','http://127.0.0.1.evil.test:1234',p.origin.replace('http://','http://secret:password@'),p.origin + '/api',p.origin + '?token=secret',p.origin + '#secret'];
  for (const baseUrl of invalid) await assert.rejects(run(p, { baseUrl }), error => error instanceof TypeError && /loopback/i.test(error.message));
});
test('literal IPv6 loopback can use the same bounded fixture contract', async t => {
  const p = await fixture(t);
  const relay = await gateway(t, p, undefined, '::1');
  const report = await run(p, { baseUrl: relay.origin });
  assert.ok(report.checks.every(check => check.status === 'pass'));
});
test('redirects are rejected after one allowed request without contacting the target', async t => {
  const p = await fixture(t);
  const target = await gateway(t, p);
  const redirect = await gateway(t, p, () => ({ status: 302, headers: { location: target.origin + '/api/auth.test' }, body: {} }));
  const report = await run(p, { baseUrl: redirect.origin });
  assert.equal(report.checks[0].status, 'fail'); assert.equal(redirect.requests.length, 1); assert.equal(target.requests.length, 0);
});
test('HTTP 200 with ok:false and wrong actors stop before writes', async t => {
  const p = await fixture(t);
  for (const response of [{ ok: false, error: 'invalid_auth' }, { ok: true, team_id: 'T_FREE', user_id: 'U_FORGED' }]) {
    const relay = await gateway(t, p, entry => entry.path === '/api/auth.test' ? { body: response } : undefined);
    const report = await run(p, { baseUrl: relay.origin });
    assert.equal(report.checks[0].status, 'fail');
    assert.equal(relay.requests.some(entry => entry.path === '/api/chat.postMessage'), false);
  }
});
test('missing pages fail exact resource coverage rather than accepting the first page', async t => {
  const p = await fixture(t);
  const relay = await gateway(t, p, entry => entry.path === '/api/conversations.list' && entry.args.cursor ? { body: { ok: true, channels: [], response_metadata: { next_cursor: '' } } } : undefined);
  const report = await run(p, { baseUrl: relay.origin });
  assert.equal(report.checks.find(check => check.name === 'channels:a').status, 'fail');
  assert.equal(relay.requests.some(entry => entry.path === '/api/chat.postMessage'), false);
});
test('history with has_more but no continuation cursor fails before writes', async t => {
  const p = await fixture(t);
  let truncated = 0;
  const relay = await gateway(t, p, async entry => {
    if (entry.path !== '/api/conversations.history' || entry.token !== p.tokens.a) return;
    const response = await fetch(p.origin + entry.path, { method: 'POST', headers: { authorization: `Bearer ${entry.token}`, 'content-type': 'application/json' }, body: JSON.stringify(entry.args) });
    const data = await response.json();
    if (data.has_more) { data.response_metadata.next_cursor = ''; truncated++; }
    return { body: data };
  });
  const report = await run(p, { baseUrl: relay.origin });
  assert.ok(truncated > 0);
  assert.equal(report.checks.find(check => check.name === 'sources:visibility').status, 'fail');
  assert.equal(relay.requests.some(entry => entry.path === '/api/chat.postMessage'), false);
});
test('history that falsely claims completion still fails missing fixture seed coverage', async t => {
  const p = await fixture(t);
  const relay = await gateway(t, p, async entry => {
    if (entry.path !== '/api/conversations.history' || entry.token !== p.tokens.a) return;
    const response = await fetch(p.origin + entry.path, { method: 'POST', headers: { authorization: `Bearer ${entry.token}`, 'content-type': 'application/json' }, body: JSON.stringify(entry.args) });
    const data = await response.json();
    data.has_more = false; data.response_metadata.next_cursor = '';
    return { body: data };
  });
  const report = await run(p, { baseUrl: relay.origin });
  assert.equal(report.checks.find(check => check.name === 'sources:visibility').status, 'fail');
  assert.equal(relay.requests.some(entry => entry.path === '/api/chat.postMessage'), false);
});
test('a Pro source injected into Free history fails workspace isolation before writes', async t => {
  const p = await fixture(t);
  let injected = 0;
  const relay = await gateway(t, p, async entry => {
    if (entry.path !== '/api/conversations.history' || entry.token !== p.tokens.a || entry.args.channel !== 'C_GENERAL') return;
    const response = await fetch(p.origin + entry.path, { method: 'POST', headers: { authorization: `Bearer ${entry.token}`, 'content-type': 'application/json' }, body: JSON.stringify(entry.args) });
    const data = await response.json();
    if (data.response_metadata.next_cursor === '') {
      data.messages.push({ type: 'message', user: 'U_PRO_A', text: 'Pro root', ts: '2000.000001' }); injected++;
    }
    return { body: data };
  });
  const report = await run(p, { baseUrl: relay.origin });
  assert.ok(injected > 0);
  assert.equal(report.checks.find(check => check.name === 'sources:visibility').status, 'fail');
  assert.equal(relay.requests.some(entry => entry.path === '/api/chat.postMessage'), false);
});
test('a seed attributed to the wrong actor fails source verification before writes', async t => {
  const p = await fixture(t);
  const relay = await gateway(t, p, async entry => {
    if (entry.path !== '/api/conversations.history' || entry.token !== p.tokens.a || entry.args.channel !== 'C_GENERAL') return;
    const response = await fetch(p.origin + entry.path, { method: 'POST', headers: { authorization: `Bearer ${entry.token}`, 'content-type': 'application/json' }, body: JSON.stringify(entry.args) });
    const data = await response.json();
    for (const message of data.messages) message.user = 'U_PRO_A';
    return { body: data };
  });
  const report = await run(p, { baseUrl: relay.origin });
  assert.equal(report.checks.find(check => check.name === 'sources:visibility').status, 'fail');
  assert.equal(relay.requests.some(entry => entry.path === '/api/chat.postMessage'), false);
});
test('thread readback missing the root and seed replies fails despite a genuine write receipt', async t => {
  const p = await fixture(t);
  let dropped = 0;
  const relay = await gateway(t, p, async entry => {
    if (entry.path !== '/api/conversations.replies' || entry.token !== p.tokens.a) return;
    const response = await fetch(p.origin + entry.path, { method: 'POST', headers: { authorization: `Bearer ${entry.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ ...entry.args, cursor: undefined, limit: 100 }) });
    const data = await response.json();
    const complete = data.messages;
    data.messages = complete.filter(message => message.text.startsWith('fixture-probe-'));
    dropped = complete.length - data.messages.length;
    data.has_more = false; data.response_metadata.next_cursor = '';
    return { body: data };
  });
  const report = await run(p, { baseUrl: relay.origin });
  assert.equal(dropped, 3);
  assert.equal(report.checks.find(check => check.name === 'post:a').status, 'pass');
  assert.equal(report.checks.find(check => check.name === 'readback:a').status, 'fail');
});
test('an error response that nevertheless wrote cannot pass the read-only permission check', async t => {
  const p = await fixture(t);
  const relay = await gateway(t, p, async entry => {
    if (entry.path !== '/api/chat.postMessage' || entry.token !== p.tokens.colleague) return;
    await fetch(p.origin + entry.path, { method: 'POST', headers: { authorization: `Bearer ${p.tokens.a}`, 'content-type': 'application/json' }, body: JSON.stringify(entry.args) });
    return { body: { ok: false, error: 'missing_scope' } };
  });
  const report = await run(p, { baseUrl: relay.origin });
  assert.equal(report.checks.find(check => check.name === 'readonly:write').status, 'fail');
});
test('a malformed permission error without explicit ok:false is UNKNOWN rather than proof of rejection', async t => {
  const p = await fixture(t);
  const relay = await gateway(t, p, entry => entry.path === '/api/chat.postMessage' && entry.token === p.tokens.colleague ? { body: { error: 'missing_scope' } } : undefined);
  const report = await run(p, { baseUrl: relay.origin });
  assert.equal(report.checks.find(check => check.name === 'readonly:write').status, 'unknown');
});
test('a forged successful receipt cannot replace actual correlated readback', async t => {
  const p = await fixture(t);
  const relay = await gateway(t, p, entry => entry.path === '/api/chat.postMessage' && entry.token === p.tokens.a ? { body: { ok: true, channel: 'C_GENERAL', ts: '9999.000001', message: { user: 'U_FREE_A', ts: '9999.000001', text: entry.args.text, thread_ts: '1000.000001' } } } : undefined);
  const report = await run(p, { baseUrl: relay.origin });
  assert.equal(report.checks.find(check => check.name === 'post:a').status, 'pass');
  assert.equal(report.checks.find(check => check.name === 'readback:a').status, 'fail');
});
test('response timeout after write is UNKNOWN, never automatically retried', async t => {
  const p = await fixture(t);
  const relay = await gateway(t, p, entry => {
    if (entry.path === '/api/chat.postMessage' && entry.token === p.tokens.a) p.setFault('chat.postMessage', { delayMs: 5000, afterCommit: true });
  });
  const report = await run(p, { baseUrl: relay.origin, requestTimeoutMs: 500 });
  assert.equal(report.checks.find(check => check.name === 'post:a')?.status, 'unknown', JSON.stringify(report));
  assert.equal(relay.requests.filter(entry => entry.path === '/api/chat.postMessage' && entry.token === p.tokens.a).length, 1);
  assert.equal((await allMessages(p)).filter(message => message.text.startsWith('fixture-probe-')).length, 1);
});
test('malformed response after a committed write remains UNKNOWN without resend', async t => {
  const p = await fixture(t);
  const relay = await gateway(t, p, async entry => {
    if (entry.path !== '/api/chat.postMessage' || entry.token !== p.tokens.a) return;
    await fetch(p.origin + entry.path, { method: 'POST', headers: { authorization: `Bearer ${p.tokens.a}`, 'content-type': 'application/json' }, body: JSON.stringify(entry.args) });
    return { raw: 'not-json' };
  });
  const report = await run(p, { baseUrl: relay.origin });
  assert.equal(report.checks.find(check => check.name === 'post:a').status, 'unknown');
  assert.equal(relay.requests.filter(entry => entry.path === '/api/chat.postMessage' && entry.token === p.tokens.a).length, 1);
  assert.equal((await allMessages(p)).filter(message => message.text.startsWith('fixture-probe-')).length, 1);
});
test('external cancellation propagates AbortError without recording a false success', async t => {
  const p = await fixture(t); p.setFault('auth.test', { delayMs: 5000 });
  const controller = new AbortController();
  const pending = run(p, { signal: controller.signal });
  setTimeout(() => controller.abort(new Error('private cancellation reason')), 30);
  await assert.rejects(pending, error => error.name === 'AbortError');
  await assert.rejects(run(p, { signal: controller.signal }), error => error.name === 'AbortError');
});
test('CLI starts its own fixture, emits only metadata and refuses live/unknown arguments', () => {
  const success = spawnSync(process.execPath, ['scripts/slack/contract-probe.mjs','--fixture'], { encoding: 'utf8' });
  assert.equal(success.status, 0, success.stderr);
  const report = JSON.parse(success.stdout);
  assert.equal(report.mode, 'fixture'); assert.equal(report.verifiedLive, false); assert.ok(report.checks.every(check => check.status === 'pass'));
  assert.equal(success.stdout.includes('fixture-slack-'), false); assert.equal(success.stdout.includes('Free root'), false);
  for (const args of [[],['--live'],['--fixture','--token','sensitive-argument']]) {
    const failure = spawnSync(process.execPath, ['scripts/slack/contract-probe.mjs',...args], { encoding: 'utf8' });
    assert.equal(failure.status, 1); assert.equal((failure.stdout + failure.stderr).includes('sensitive-argument'), false);
  }
});
