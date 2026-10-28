import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startFakeSlackPersonal } from '../fake-slack-personal.mjs';

const rejectedWrites = new Set(['invalid_auth', 'not_authed', 'missing_scope', 'channel_not_found', 'thread_not_found', 'invalid_arguments']);
const cancelled = () => new DOMException('Fixture probe cancelled', 'AbortError');
const freeSeeds = [
  { user: 'U_FREE_B', text: 'Free root', ts: '1000.000001' },
  { user: 'U_FREE_A', text: 'Free reply one', ts: '1000.000002', thread_ts: '1000.000001' },
  { user: 'U_FREE_B', text: 'Free reply two', ts: '1000.000003', thread_ts: '1000.000001' },
];
const proSeeds = [{ user: 'U_PRO_A', text: 'Pro root', ts: '2000.000001' }];
function sameMessages(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length &&
    expected.every(seed => actual.filter(message => message && ['user', 'text', 'ts', 'thread_ts'].every(key => message[key] === seed[key])).length === 1);
}
class ProbeFailure extends Error {
  constructor(status = 'fail', providerCode) { super('Fixture contract failed'); this.status = status; this.providerCode = providerCode; }
}

/** Requires a fresh fixture with its fixed seeds. It cannot certify native Slack capability. */
export async function runFixtureProbes({ baseUrl, tokens, signal, requestTimeoutMs = 1000 }) {
  if (typeof baseUrl !== 'string' || !/^http:\/\/(?:127\.0\.0\.1|\[::1\])(?::[1-9]\d{0,4})?\/?$/.test(baseUrl)) throw new TypeError('Expected an HTTP literal loopback origin');
  const origin = new URL(baseUrl).origin;
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0 || requestTimeoutMs > 2_147_483_647) throw new TypeError('Invalid fixture request timeout');
  if (!tokens || !['a', 'b', 'colleague'].every(key => typeof tokens[key] === 'string' && tokens[key].startsWith('fixture-slack-'))) throw new TypeError('Expected synthetic fixture tokens');
  if (signal?.aborted) throw cancelled();
  const report = { mode: 'fixture', verifiedLive: false, checks: [] };

  async function request(method, token, args = {}, write = false) {
    if (signal?.aborted) throw cancelled();
    const deadline = AbortSignal.timeout(requestTimeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    let sent = false;
    try {
      sent = true;
      const response = await fetch(`${origin}/api/${method}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(args), signal: requestSignal, redirect: 'error' });
      if (!response.ok) throw new ProbeFailure(write ? 'unknown' : 'fail');
      const data = await response.json();
      if (!data || data.ok !== true) {
        const explicitRejection = data?.ok === false && typeof data.error === 'string';
        throw new ProbeFailure(write && (!explicitRejection || !rejectedWrites.has(data.error)) ? 'unknown' : 'fail', explicitRejection ? data.error : undefined);
      }
      if (signal?.aborted) throw cancelled();
      return data;
    } catch (error) {
      if (signal?.aborted) throw cancelled();
      if (error instanceof ProbeFailure) throw error;
      throw new ProbeFailure(write && sent ? 'unknown' : 'fail');
    }
  }
  async function check(name, operation) {
    try {
      if (signal?.aborted) throw cancelled();
      const ok = await operation();
      report.checks.push({ name, status: ok === true ? 'pass' : 'fail' });
      return ok === true;
    } catch (error) {
      if (signal?.aborted || error.name === 'AbortError') throw cancelled();
      report.checks.push({ name, status: error instanceof ProbeFailure ? error.status : 'fail' });
      return false;
    }
  }
  async function pages(method, token, args, field) {
    const items = []; const seen = new Set(); let cursor;
    for (let count = 0; count < 100; count++) {
      const data = await request(method, token, { ...args, cursor, limit: 1 });
      if (!Array.isArray(data[field]) || typeof data.response_metadata?.next_cursor !== 'string') throw new ProbeFailure();
      items.push(...data[field]);
      cursor = data.response_metadata.next_cursor;
      if (data.has_more === true && !cursor) throw new ProbeFailure();
      if (!cursor) return items;
      if (seen.has(cursor)) throw new ProbeFailure();
      seen.add(cursor);
    }
    throw new ProbeFailure();
  }
  async function denied(method, token, args, code, write = false) {
    try { await request(method, token, args, write); return false; }
    catch (error) {
      if (signal?.aborted) throw cancelled();
      if (error instanceof ProbeFailure && error.providerCode === code) return true;
      throw error;
    }
  }

  for (const [key, team, user] of [['a', 'T_FREE', 'U_FREE_A'], ['b', 'T_PRO', 'U_PRO_A'], ['colleague', 'T_FREE', 'U_FREE_B']]) {
    if (!await check(`identity:${key}`, async () => {
      const data = await request('auth.test', tokens[key]);
      return data.team_id === team && data.user_id === user;
    })) return report;
  }
  for (const [key, expected, types] of [['a', ['C_GENERAL', 'D_PRIVATE', 'G_PRIVATE'], 'public_channel,private_channel,im'], ['b', ['C_GENERAL'], 'public_channel'], ['colleague', ['C_GENERAL'], 'public_channel']]) {
    if (!await check(`channels:${key}`, async () => {
      const channels = await pages('conversations.list', tokens[key], { types }, 'channels');
      return JSON.stringify(channels.map(channel => channel.id).sort()) === JSON.stringify(expected);
    })) return report;
  }
  if (!await check('sources:visibility', async () => {
    const free = await pages('conversations.history', tokens.a, { channel: 'C_GENERAL' }, 'messages');
    const pro = await pages('conversations.history', tokens.b, { channel: 'C_GENERAL' }, 'messages');
    if (!sameMessages(free, freeSeeds) || !sameMessages(pro, proSeeds)) return false;
    for (const channel of ['G_PRIVATE', 'D_PRIVATE']) {
      const own = await request('conversations.history', tokens.a, { channel });
      if (!Array.isArray(own.messages) || !own.messages.length) return false;
      for (const key of ['b', 'colleague']) if (!await denied('conversations.history', tokens[key], { channel }, 'channel_not_found')) return false;
    }
    return true;
  })) return report;

  const forbidden = `fixture-forbidden-${randomUUID()}`;
  if (!await check('readonly:write', async () => {
    if (!await denied('chat.postMessage', tokens.colleague, { channel: 'C_GENERAL', text: forbidden }, 'missing_scope', true)) return false;
    const history = await pages('conversations.history', tokens.a, { channel: 'C_GENERAL' }, 'messages');
    return !history.some(message => message.text === forbidden);
  })) return report;

  const text = `fixture-probe-${randomUUID()}`;
  let receipt;
  if (!await check('post:a', async () => {
    receipt = await request('chat.postMessage', tokens.a, { channel: 'C_GENERAL', text, thread_ts: '1000.000001' }, true);
    return receipt.channel === 'C_GENERAL' && typeof receipt.ts === 'string' && receipt.ts.length > 0 && receipt.message?.ts === receipt.ts && receipt.message.user === 'U_FREE_A' && receipt.message.text === text && receipt.message.thread_ts === '1000.000001';
  })) return report;
  if (!await check('readback:a', async () => {
    const messages = await pages('conversations.replies', tokens.a, { channel: 'C_GENERAL', ts: '1000.000001' }, 'messages');
    return sameMessages(messages, [...freeSeeds, { user: 'U_FREE_A', ts: receipt.ts, text, thread_ts: '1000.000001' }]);
  })) return report;
  await check('isolation:b', async () => {
    const messages = await pages('conversations.history', tokens.b, { channel: 'C_GENERAL' }, 'messages');
    return sameMessages(messages, proSeeds);
  });
  return report;
}

async function main(args) {
  if (args.length !== 1 || args[0] !== '--fixture') throw new Error('Usage: contract-probe.mjs --fixture (live mode is unavailable)');
  const provider = await startFakeSlackPersonal();
  try {
    const report = await runFixtureProbes({ baseUrl: provider.origin, tokens: provider.tokens });
    console.log(JSON.stringify(report));
    if (!report.checks.length || report.checks.some(check => check.status !== 'pass')) process.exitCode = 1;
  } finally { await provider.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(() => { console.error('Fixture probe failed; use --fixture only.'); process.exitCode = 1; });
}
