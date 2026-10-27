import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

export const GMAIL_MODIFY_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';
export const CALENDAR_EVENTS_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
export const CALENDAR_READONLY_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const defaults = {
  clientId: 'gmail-test.apps.googleusercontent.com', clientSecret: 'fake-gmail-secret',
  redirectUri: 'http://127.0.0.1:5174/connections/gmail/callback', email: 'gmail-owner@example.test',
};
const defaultRedirectUris = [
  'http://127.0.0.1:5174/connections/gmail/callback',
  'http://127.0.0.1:5174/connections/mycalendar/callback',
  'http://localhost:5174/connections/gmail/callback',
  'http://localhost:5174/connections/mycalendar/callback',
];
function defaultCalendars(email = defaults.email) {
  return [
    { id: email, summary: 'Lịch chính', timeZone: 'Asia/Ho_Chi_Minh', primary: true, accessRole: 'owner' },
    { id: 'c_work@group.calendar.google.com', summary: 'Lịch việc riêng', timeZone: 'Asia/Ho_Chi_Minh', accessRole: 'writer' },
    { id: 'vi.vietnamese@holiday.calendar.google.com', summary: 'Ngày lễ Việt Nam', timeZone: 'Asia/Ho_Chi_Minh', accessRole: 'reader' },
  ];
}
const equal = (a, b) => typeof a === 'string' && typeof b === 'string'
  && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const json = (response, status, body) => {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
};
const random = () => randomBytes(24).toString('base64url');
function defaultThreads() {
  const message = { id: 'message-1', labelIds: ['INBOX', 'UNREAD'], snippet: 'Chào nhóm, họp lúc 9 giờ.', payload: {
    mimeType: 'text/plain', headers: [
      { name: 'From', value: 'Lan <lan@example.com>' }, { name: 'To', value: defaults.email }, { name: 'Cc', value: 'Minh <minh@example.com>' },
      { name: 'Subject', value: 'Họp nhóm ATI' }, { name: 'Date', value: 'Wed, 14 Oct 2026 09:00:00 +0700' },
      { name: 'Message-ID', value: '<original@example.com>' }, { name: 'References', value: '<ancestor@example.com>' },
    ], body: { data: Buffer.from('Chào nhóm, họp lúc 9 giờ.').toString('base64url') },
  } };
  return [{ id: 'thread-1', messages: [message] }, { id: 'draft-only', messages: [{ ...message, id: 'draft-message', labelIds: ['DRAFT'] }] }];
}
async function form(request) {
  if (!request.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) return null;
  let body = '';
  for await (const chunk of request) {
    body += chunk.toString('utf8');
    if (body.length > 16_384) return null;
  }
  return new URLSearchParams(body);
}

/**
 * Local stand-in for Google OAuth and the Gmail profile endpoint (GMAIL-01).
 * GMAIL-02 adds the Gmail API. It never calls Google and logs no tokens.
 * `settings` may be changed while running to script failures; `stats` counts requests.
 */
export async function startFakeGoogleGmail(options = {}) {
  const { port = 0, now = Date.now, clientId, clientSecret, redirectUri, email } = { ...defaults, ...options };
  const settings = {
    email, grantedScopes: [GMAIL_MODIFY_SCOPE, CALENDAR_EVENTS_SCOPE, CALENDAR_READONLY_SCOPE], issueRefreshToken: true, accessTokenTtlSeconds: 3600,
    accessTokenPrefix: 'ya29.fake', exchange: 'ok', exchangeDelayMs: 0, refresh: 'ok', refreshDelayMs: 0, revoke: 'ok', profile: 'ok',
    threads: defaultThreads(), calendars: defaultCalendars(email), calendarEvents: [], apiResponses: [], ...options.settings,
  };
  const stats = { authorizations: 0, exchanges: 0, refreshes: 0, revocations: 0, profiles: 0, apiRequests: [], writes: 0 };
  const codes = new Map();
  const refreshTokens = new Map();
  const accessTokens = new Map();
  const hanging = new Set();
  const hang = (response) => { hanging.add(response); response.on('close', () => hanging.delete(response)); };
  // Clients in the same project share revocation, as Google's real OAuth endpoint does.
  const projectFor = (id) => options.clientProjects?.[id]
    ?? (id === 'mycalendar-test.apps.googleusercontent.com' ? 'fake-calendar-project' : 'fake-gmail-project');
  const issueAccessToken = (account, tokenClientId = clientId) => {
    const token = `${settings.accessTokenPrefix}-${random()}`;
    accessTokens.set(token, { email: account, clientId: tokenClientId, projectId: projectFor(tokenClientId), expiresAt: now() + settings.accessTokenTtlSeconds * 1000 });
    return token;
  };
  const mintRefreshToken = (account = settings.email, scopes = settings.grantedScopes, tokenClientId = clientId) => {
    const token = `1//fake-${random()}`;
    refreshTokens.set(token, { email: account, clientId: tokenClientId, projectId: projectFor(tokenClientId), revoked: false, scopes });
    return token;
  };
  const isAllowedRedirect = (uri) => {
    if (!uri) return false;
    if (uri === redirectUri) return true;
    if (Array.isArray(options.redirectUris) && options.redirectUris.includes(uri)) return true;
    return defaultRedirectUris.includes(uri);
  };
  const isAllowedClient = (id) => id === clientId || id === 'mycalendar-test.apps.googleusercontent.com' || (Array.isArray(options.clientIds) && options.clientIds.includes(id));

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, { ready: true });
      if (request.method === 'GET' && url.pathname === '/o/oauth2/v2/auth') {
        stats.authorizations++;
        const params = url.searchParams;
        const scopes = (params.get('scope') ?? '').split(' ');
        const reqRedirectUri = params.get('redirect_uri');
        const hasValidScope = scopes.includes(GMAIL_MODIFY_SCOPE)
          || (scopes.includes(CALENDAR_EVENTS_SCOPE) && scopes.includes(CALENDAR_READONLY_SCOPE))
          || scopes.some(s => s.includes('calendar'));
        if (!isAllowedClient(params.get('client_id')) || !isAllowedRedirect(reqRedirectUri) || params.get('response_type') !== 'code'
          || params.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(params.get('code_challenge') ?? '')
          || !hasValidScope || params.get('access_type') !== 'offline' || params.get('prompt') !== 'consent'
          || !params.get('state') || params.get('state').length > 1024) {
          return json(response, 400, { error: 'invalid_request' });
        }
        const code = random();
        const granted = scopes.filter((s) => (settings.grantedScopes ?? []).includes(s));
        const finalScopes = granted.length > 0 ? granted : (settings.grantedScopes ?? scopes);
        codes.set(code, { clientId: params.get('client_id'), challenge: params.get('code_challenge'), email: settings.email, expiresAt: now() + 600_000, redirectUri: reqRedirectUri, scopes: finalScopes });
        const callback = new URL(reqRedirectUri);
        callback.searchParams.set('state', params.get('state'));
        callback.searchParams.set('code', code);
        callback.searchParams.set('scope', finalScopes.join(' '));
        response.writeHead(302, { Location: callback.href, 'Cache-Control': 'no-store' });
        return response.end();
      }
      if (request.method === 'POST' && url.pathname === '/token') {
        const params = await form(request);
        const reqClientId = params?.get('client_id');
        const reqClientSecret = params?.get('client_secret');
        const clientValid = (equal(reqClientId, clientId) && equal(reqClientSecret, clientSecret))
          || (reqClientId === 'mycalendar-test.apps.googleusercontent.com' && equal(reqClientSecret, 'fake-mycalendar-secret'))
          || (isAllowedClient(reqClientId) && equal(reqClientSecret, clientSecret));
        if (!params || !clientValid) {
          return json(response, 401, { error: 'invalid_client' });
        }
        if (params.get('grant_type') === 'authorization_code') {
          stats.exchanges++;
          if (settings.exchangeDelayMs) await new Promise((resolve) => setTimeout(resolve, settings.exchangeDelayMs));
          if (settings.exchange === 'server_error') return json(response, 500, { error: 'internal_failure' });
          if (settings.exchange === 'hang') return hang(response);
          const entry = codes.get(params.get('code'));
          const verifier = params.get('code_verifier') ?? '';
          if (!entry || entry.clientId !== reqClientId || entry.expiresAt <= now() || (entry.redirectUri && params.get('redirect_uri') !== entry.redirectUri)
            || !equal(createHash('sha256').update(verifier).digest('base64url'), entry.challenge)) {
            return json(response, 400, { error: 'invalid_grant' });
          }
          codes.delete(params.get('code'));
          const granted = entry.scopes?.length ? entry.scopes : settings.grantedScopes;
          const body = { access_token: issueAccessToken(entry.email, reqClientId), expires_in: settings.accessTokenTtlSeconds,
            scope: granted.join(' '), token_type: 'Bearer' };
          if (settings.issueRefreshToken) body.refresh_token = mintRefreshToken(entry.email, granted, reqClientId);
          return json(response, 200, body);
        }
        if (params.get('grant_type') === 'refresh_token') {
          stats.refreshes++;
          if (settings.refreshDelayMs) await new Promise((resolve) => setTimeout(resolve, settings.refreshDelayMs));
          if (settings.refresh === 'hang') return hang(response);
          if (settings.refresh === 'server_error') return json(response, 503, { error: 'backend_error' });
          const entry = refreshTokens.get(params.get('refresh_token'));
          if (settings.refresh === 'invalid_grant' || !entry || entry.revoked || entry.clientId !== reqClientId) return json(response, 400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
          const granted = entry.scopes?.length ? entry.scopes : settings.grantedScopes;
          return json(response, 200, { access_token: issueAccessToken(entry.email, reqClientId), expires_in: settings.accessTokenTtlSeconds,
            scope: granted.join(' '), token_type: 'Bearer' });
        }
        return json(response, 400, { error: 'unsupported_grant_type' });
      }
      if (request.method === 'POST' && url.pathname === '/revoke') {
        stats.revocations++;
        if (settings.revoke === 'hang') return hang(response);
        if (settings.revoke === 'server_error') return json(response, 503, { error: 'backend_error' });
        const params = await form(request);
        const token = params?.get('token') ?? '';
        const entry = refreshTokens.get(token) ?? accessTokens.get(token);
        if (!entry) return json(response, 400, { error: 'invalid_token' });
        for (const grant of refreshTokens.values()) {
          if (grant.email === entry.email && grant.projectId === entry.projectId) grant.revoked = true;
        }
        for (const [accessToken, grant] of accessTokens) {
          if (grant.email === entry.email && grant.projectId === entry.projectId) accessTokens.delete(accessToken);
        }
        return json(response, 200, {});
      }
      if (request.method === 'GET' && url.pathname === '/gmail/v1/users/me/profile') {
        stats.profiles++;
        if (settings.profile === 'server_error') return json(response, 500, { error: { code: 500 } });
        const token = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1];
        const entry = token ? accessTokens.get(token) : undefined;
        if (!entry || entry.expiresAt <= now()) return json(response, 401, { error: { code: 401, status: 'UNAUTHENTICATED' } });
        return json(response, 200, { emailAddress: entry.email, messagesTotal: 0, threadsTotal: 0, historyId: '1' });
      }
      if (url.pathname.startsWith('/gmail/v1/users/me/')) {
        const path = url.pathname.slice('/gmail/v1/users/me/'.length);
        let body;
        if (request.method === 'POST') { let raw = ''; for await (const chunk of request) raw += chunk; body = JSON.parse(raw || '{}'); stats.writes++; }
        stats.apiRequests.push({ method: request.method, path, query: Object.fromEntries(url.searchParams), body });
        const scripted = settings.apiResponses.shift();
        if (scripted?.mode === 'hang') return hang(response);
        if (scripted?.mode === 'disconnect') return response.destroy();
        if (scripted?.mode === 'invalid_json') { response.writeHead(200); return response.end('not json'); }
        if (scripted?.mode === 'redirect') { response.writeHead(307, { Location: '/gmail/v1/users/me/profile' }); return response.end(); }
        if (scripted?.mode === 'server_error') return json(response, 503, { error: { code: 503 } });
        if (scripted && Object.hasOwn(scripted, 'body')) return json(response, scripted.status ?? 200, scripted.body);
        if (scripted?.status) {
          if (scripted.retryAfter != null) response.setHeader('Retry-After', scripted.retryAfter);
          return json(response, scripted.status, { error: { code: scripted.status, errors: [{ reason: scripted.reason ?? 'forbidden' }] } });
        }
        const token = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1];
        const entry = accessTokens.get(token);
        if (!entry || entry.expiresAt <= now()) return json(response, 401, { error: { code: 401 } });
        if (path === 'threads' && request.method === 'GET') return json(response, 200, { threads: settings.threads.slice(0, Number(url.searchParams.get('maxResults') ?? 10)).map(t => ({ id: t.id })) });
        if (path === 'labels' && request.method === 'GET') return json(response, 200, { labels: ['INBOX', 'UNREAD', 'STARRED'].map(id => ({ id, name: id, type: 'system' })) });
        if (path === 'labels' && request.method === 'POST') return json(response, 200, { id: `label-${stats.writes}`, name: body.name, type: 'user' });
        if (path === 'messages/send') return json(response, 200, { id: `sent-${stats.writes}`, threadId: body.threadId ?? `new-thread-${stats.writes}` });
        if (path === 'drafts') return json(response, 200, { id: `draft-${stats.writes}`, message: { id: `draft-message-${stats.writes}`, threadId: body.message.threadId ?? 'draft-thread' } });
        const match = /^threads\/([^/]+)(?:\/(modify|trash))?$/.exec(path);
        const thread = match && settings.threads.find(t => t.id === decodeURIComponent(match[1]));
        if (thread) {
          if (match[2] === 'modify') return json(response, 200, { ...thread, messages: thread.messages.map(message => ({ ...message,
            labelIds: [...new Set([...(message.labelIds ?? []).filter(id => !body.removeLabelIds?.includes(id)), ...(body.addLabelIds ?? [])])],
          })) });
          return json(response, 200, match[2] === 'trash' ? { id: thread.id } : thread);
        }
      }
      if (url.pathname === '/calendar/v3/users/me/calendarList') {
        stats.apiRequests.push({ method: request.method, path: 'calendarList', query: Object.fromEntries(url.searchParams) });
        if (settings.calendarList === 'server_error') return json(response, 500, { error: { code: 500 } });
        const token = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1];
        const entry = token ? accessTokens.get(token) : undefined;
        if (!entry || entry.expiresAt <= now()) return json(response, 401, { error: { code: 401, status: 'UNAUTHENTICATED' } });
        const email = entry.email || settings.email;
        const items = settings.calendars.map(c => c.primary ? { ...c, id: email } : c);
        return json(response, 200, { kind: 'calendar#calendarList', items });
      }
      if (url.pathname.startsWith('/calendar/v3/calendars/')) {
        const sub = url.pathname.slice('/calendar/v3/calendars/'.length);
        const token = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1];
        const entry = token ? accessTokens.get(token) : undefined;
        if (!entry || entry.expiresAt <= now()) return json(response, 401, { error: { code: 401, status: 'UNAUTHENTICATED' } });

        const eventsMatch = /^([^/]+)\/events(?:\/(.+))?$/.exec(sub);
        if (eventsMatch) {
          const calId = decodeURIComponent(eventsMatch[1]);
          if (request.method === 'GET' && !eventsMatch[2]) {
            stats.apiRequests.push({ method: 'GET', path: `calendars/${calId}/events`, query: Object.fromEntries(url.searchParams) });
            return json(response, 200, { kind: 'calendar#events', items: settings.calendarEvents ?? [] });
          }
          if (request.method === 'POST' && !eventsMatch[2]) {
            let raw = ''; for await (const chunk of request) raw += chunk;
            const body = JSON.parse(raw || '{}');
            stats.writes++;
            stats.apiRequests.push({ method: 'POST', path: `calendars/${calId}/events`, query: Object.fromEntries(url.searchParams), body });
            const id = `event-${stats.writes}`;
            return json(response, 200, {
              id,
              summary: body.summary,
              description: body.description,
              start: body.start,
              end: body.end,
              location: body.location,
              htmlLink: `https://calendar.google.com/event?eid=${id}`,
            });
          }
        } else {
          const calId = decodeURIComponent(sub);
          stats.apiRequests.push({ method: request.method, path: `calendars/${calId}`, query: Object.fromEntries(url.searchParams) });
          const email = entry.email || settings.email;
          const items = settings.calendars.map(c => c.primary ? { ...c, id: email } : c);
          const found = items.find(c => c.id === calId || (c.primary && (calId === 'primary' || calId === email)));
          if (!found) return json(response, 404, { error: { code: 404, message: 'Not Found' } });
          return json(response, 200, { id: found.id, summary: found.summary, timeZone: found.timeZone, ...(found.primary ? { primary: true } : {}) });
        }
      }
      return json(response, 404, { error: 'not_found' });
    } catch {
      if (!response.headersSent) json(response, 400, { error: 'invalid_request' });
      else response.end();
    }
  });
  server.requestTimeout = 60_000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    server, origin, settings, stats, mintRefreshToken,
    isRevoked: (token) => refreshTokens.get(token)?.revoked === true,
    endpoints: { authorizationUrl: `${origin}/o/oauth2/v2/auth`, tokenUrl: `${origin}/token`, revokeUrl: `${origin}/revoke`, apiBaseUrl: origin },
    close: () => new Promise((resolve, reject) => {
      for (const response of hanging) response.destroy();
      server.closeAllConnections?.();
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const provider = await startFakeGoogleGmail({ port: Number(process.env.FAKE_GOOGLE_GMAIL_PORT ?? 0),
    ...(process.env.FAKE_GOOGLE_GMAIL_REDIRECT_URI ? { redirectUri: process.env.FAKE_GOOGLE_GMAIL_REDIRECT_URI } : {}),
    ...(process.env.FAKE_GOOGLE_GMAIL_EMAIL ? { email: process.env.FAKE_GOOGLE_GMAIL_EMAIL } : {}) });
  process.stdout.write(`${JSON.stringify({ status: 'ready', port: provider.server.address().port })}\n`);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await provider.close();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
