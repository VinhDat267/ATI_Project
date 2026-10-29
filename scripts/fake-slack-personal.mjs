import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

const methods = new Set(['auth.test', 'conversations.list', 'conversations.history', 'conversations.replies', 'chat.postMessage']);
const types = { C_GENERAL: 'public_channel', G_PRIVATE: 'private_channel', D_PRIVATE: 'im' };
const readScopes = { public_channel: 'channels:read', private_channel: 'groups:read', im: 'im:read' };
const historyScopes = { public_channel: 'channels:history', private_channel: 'groups:history', im: 'im:history' };
const failure = error => ({ ok: false, error });

/** A deliberately bounded HTTP test provider. It is not a Slack OAuth implementation. */
export async function startFakeSlackPersonal({ port = 0 } = {}) {
  const fullScopes = ['channels:read', 'groups:read', 'im:read', 'channels:history', 'groups:history', 'im:history', 'chat:write'];
  const tokens = Object.fromEntries(['a', 'b', 'colleague'].map(key => [key, `fixture-slack-${key}-${randomBytes(12).toString('hex')}`]));
  const actors = new Map([
    [tokens.a, { team: 'T_FREE', user: 'U_FREE_A', visible: ['C_GENERAL', 'G_PRIVATE', 'D_PRIVATE'], scopes: fullScopes }],
    [tokens.b, { team: 'T_PRO', user: 'U_PRO_A', visible: ['C_GENERAL'], scopes: fullScopes }],
    [tokens.colleague, { team: 'T_FREE', user: 'U_FREE_B', visible: ['C_GENERAL'], scopes: ['channels:read', 'channels:history'] }],
  ]);
  const messages = new Map([
    ['T_FREE:C_GENERAL', [
      { type: 'message', user: 'U_FREE_B', text: 'Free root', ts: '1000.000001' },
      { type: 'message', user: 'U_FREE_A', text: 'Free reply one', ts: '1000.000002', thread_ts: '1000.000001' },
      { type: 'message', user: 'U_FREE_B', text: 'Free reply two', ts: '1000.000003', thread_ts: '1000.000001' },
    ]],
    ['T_PRO:C_GENERAL', [{ type: 'message', user: 'U_PRO_A', text: 'Pro root', ts: '2000.000001' }]],
    ['T_FREE:G_PRIVATE', [{ type: 'message', user: 'U_FREE_A', text: 'Private source', ts: '1100.000001' }]],
    ['T_FREE:D_PRIVATE', [{ type: 'message', user: 'U_FREE_A', text: 'Private DM', ts: '1200.000001' }]],
  ]);
  const faults = new Map();
  const timers = new Map();
  let sequence = 0;
  let closed = false;
  const pause = ms => new Promise(resolvePause => {
    const timer = setTimeout(() => { timers.delete(timer); resolvePause(); }, ms);
    timers.set(timer, resolvePause);
  });

  function page(items, args, key, field) {
    const limit = args.limit === undefined ? 1 : Number(args.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return failure('invalid_arguments');
    let offset = 0;
    if (args.cursor) {
      try {
        const cursor = JSON.parse(Buffer.from(args.cursor, 'base64url').toString());
        if (cursor.key !== key || !Number.isSafeInteger(cursor.offset) || cursor.offset <= 0 || cursor.offset >= items.length) return failure('invalid_cursor');
        offset = cursor.offset;
      } catch { return failure('invalid_cursor'); }
    }
    const next = offset + limit;
    return { ok: true, [field]: items.slice(offset, next), has_more: next < items.length, response_metadata: { next_cursor: next < items.length ? Buffer.from(JSON.stringify({ key, offset: next })).toString('base64url') : '' } };
  }

  function execute(method, actor, args) {
    if (method === 'auth.test') return { ok: true, team_id: actor.team, user_id: actor.user };
    if (method === 'conversations.list') {
      const requested = (args.types ?? 'public_channel').split(',').sort();
      if (!requested.length || requested.some(type => !Object.hasOwn(readScopes, type))) return failure('invalid_arguments');
      const channels = actor.visible.filter(id => requested.includes(types[id])).map(id => ({ id, name: id === 'C_GENERAL' ? 'general' : id === 'G_PRIVATE' ? 'private' : 'dm', is_private: id !== 'C_GENERAL', is_im: id === 'D_PRIVATE' }));
      const result = page(channels, args, JSON.stringify([actor.team, actor.user, method, requested]), 'channels');
      if (!result.ok) return result;
      if (requested.some(type => !actor.scopes.includes(readScopes[type]))) return failure('missing_scope');
      return result;
    }
    const conversation = `${actor.team}:${args.channel}`;
    if (!actor.visible.includes(args.channel) || !messages.has(conversation)) return failure('channel_not_found');
    const history = messages.get(conversation);
    if (method === 'conversations.history' || method === 'conversations.replies') {
      const needed = historyScopes[types[args.channel]];
      if (!actor.scopes.includes(needed)) return failure('missing_scope');
      if (method === 'conversations.replies' && !history.some(message => message.ts === args.ts && !message.thread_ts)) return failure('thread_not_found');
      const result = method === 'conversations.replies' ? history.filter(message => message.ts === args.ts || message.thread_ts === args.ts) : history;
      return page(result, args, JSON.stringify([actor.team, actor.user, method, args.channel, args.ts ?? null]), 'messages');
    }
    if (method === 'chat.postMessage') {
      if (!actor.scopes.includes('chat:write')) return failure('missing_scope');
      if (typeof args.text !== 'string' || !args.text.length) return failure('invalid_arguments');
      if (args.thread_ts && !history.some(message => message.ts === args.thread_ts && !message.thread_ts)) return failure('thread_not_found');
      const message = { type: 'message', user: actor.user, text: args.text, ts: `3000.${String(++sequence).padStart(6, '0')}`, ...(args.thread_ts ? { thread_ts: args.thread_ts } : {}) };
      history.push(message);
      return { ok: true, channel: args.channel, ts: message.ts, message };
    }
    return failure('unknown_method');
  }

  function send(response, value) {
    if (!response.destroyed && !response.writableEnded) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(value));
    }
  }
  async function handle(request, response) {
    const url = new URL(request.url, 'http://fixture.invalid');
    const method = url.pathname.startsWith('/api/') ? url.pathname.slice(5) : '';
    if (!methods.has(method)) return send(response, failure('unknown_method'));
    const token = /^Bearer (.+)$/i.exec(request.headers.authorization ?? '')?.[1];
    const actor = actors.get(token);
    if (!actor) return send(response, failure('invalid_auth'));
    let args = Object.fromEntries(url.searchParams);
    if (request.method === 'POST') {
      const chunks = []; let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 1024 * 1024) return send(response, failure('invalid_arguments'));
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks).toString('utf8');
      try {
        const input = (request.headers['content-type'] ?? '').includes('application/json') ? JSON.parse(body || '{}') : Object.fromEntries(new URLSearchParams(body));
        if (!input || typeof input !== 'object' || Array.isArray(input)) return send(response, failure('invalid_arguments'));
        args = { ...args, ...input };
      } catch { return send(response, failure('invalid_arguments')); }
    }
    const fault = faults.get(method);
    if (fault?.delayMs && !fault.afterCommit) await pause(fault.delayMs);
    if (closed) return;
    const result = execute(method, actor, args);
    if (fault?.delayMs && fault.afterCommit) await pause(fault.delayMs);
    send(response, result);
  }
  const server = createServer((request, response) => { handle(request, response).catch(() => send(response, failure('invalid_arguments'))); });
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolveListen); });
  return {
    origin: `http://127.0.0.1:${server.address().port}`, tokens,
    setFault(method, fault) {
      if (!methods.has(method) || !fault || !Number.isFinite(fault.delayMs ?? 0) || (fault.delayMs ?? 0) < 0 || (fault.afterCommit !== undefined && typeof fault.afterCommit !== 'boolean')) throw new TypeError('Invalid fixture fault');
      faults.set(method, { ...fault });
    },
    async close() {
      if (closed) return;
      closed = true;
      for (const [timer, finish] of timers) { clearTimeout(timer); finish(); }
      timers.clear();
      server.closeAllConnections();
      await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
    },
  };
}
