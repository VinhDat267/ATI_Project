import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

export const GMAIL_MODIFY_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';
const defaults = {
  clientId: 'gmail-test.apps.googleusercontent.com', clientSecret: 'fake-gmail-secret',
  redirectUri: 'http://127.0.0.1:5174/connections/gmail/callback', email: 'gmail-owner@example.test',
};
const equal = (a, b) => typeof a === 'string' && typeof b === 'string'
  && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const json = (response, status, body) => {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
};
const random = () => randomBytes(24).toString('base64url');
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
    email, grantedScopes: [GMAIL_MODIFY_SCOPE], issueRefreshToken: true, accessTokenTtlSeconds: 3600,
    accessTokenPrefix: 'ya29.fake', exchange: 'ok', exchangeDelayMs: 0, refresh: 'ok', refreshDelayMs: 0, revoke: 'ok', profile: 'ok',
    ...options.settings,
  };
  const stats = { authorizations: 0, exchanges: 0, refreshes: 0, revocations: 0, profiles: 0 };
  const codes = new Map();
  const refreshTokens = new Map();
  const accessTokens = new Map();
  const hanging = new Set();
  const hang = (response) => { hanging.add(response); response.on('close', () => hanging.delete(response)); };
  const issueAccessToken = (account) => {
    const token = `${settings.accessTokenPrefix}-${random()}`;
    accessTokens.set(token, { email: account, expiresAt: now() + settings.accessTokenTtlSeconds * 1000 });
    return token;
  };
  const mintRefreshToken = (account = settings.email) => {
    const token = `1//fake-${random()}`;
    refreshTokens.set(token, { email: account, revoked: false });
    return token;
  };

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, { ready: true });
      if (request.method === 'GET' && url.pathname === '/o/oauth2/v2/auth') {
        stats.authorizations++;
        const params = url.searchParams;
        const scopes = (params.get('scope') ?? '').split(' ');
        if (params.get('client_id') !== clientId || params.get('redirect_uri') !== redirectUri || params.get('response_type') !== 'code'
          || params.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(params.get('code_challenge') ?? '')
          || !scopes.includes(GMAIL_MODIFY_SCOPE) || params.get('access_type') !== 'offline' || params.get('prompt') !== 'consent'
          || !params.get('state') || params.get('state').length > 1024) {
          return json(response, 400, { error: 'invalid_request' });
        }
        const code = random();
        codes.set(code, { challenge: params.get('code_challenge'), email: settings.email, expiresAt: now() + 600_000 });
        const callback = new URL(redirectUri);
        callback.searchParams.set('state', params.get('state'));
        callback.searchParams.set('code', code);
        callback.searchParams.set('scope', settings.grantedScopes.join(' '));
        response.writeHead(302, { Location: callback.href, 'Cache-Control': 'no-store' });
        return response.end();
      }
      if (request.method === 'POST' && url.pathname === '/token') {
        const params = await form(request);
        if (!params || !equal(params.get('client_id'), clientId) || !equal(params.get('client_secret'), clientSecret)) {
          return json(response, 401, { error: 'invalid_client' });
        }
        if (params.get('grant_type') === 'authorization_code') {
          stats.exchanges++;
          if (settings.exchangeDelayMs) await new Promise((resolve) => setTimeout(resolve, settings.exchangeDelayMs));
          if (settings.exchange === 'server_error') return json(response, 500, { error: 'internal_failure' });
          if (settings.exchange === 'hang') return hang(response);
          const entry = codes.get(params.get('code'));
          const verifier = params.get('code_verifier') ?? '';
          if (!entry || entry.expiresAt <= now() || params.get('redirect_uri') !== redirectUri
            || !equal(createHash('sha256').update(verifier).digest('base64url'), entry.challenge)) {
            return json(response, 400, { error: 'invalid_grant' });
          }
          codes.delete(params.get('code'));
          const body = { access_token: issueAccessToken(entry.email), expires_in: settings.accessTokenTtlSeconds,
            scope: settings.grantedScopes.join(' '), token_type: 'Bearer' };
          if (settings.issueRefreshToken) body.refresh_token = mintRefreshToken(entry.email);
          return json(response, 200, body);
        }
        if (params.get('grant_type') === 'refresh_token') {
          stats.refreshes++;
          if (settings.refreshDelayMs) await new Promise((resolve) => setTimeout(resolve, settings.refreshDelayMs));
          if (settings.refresh === 'hang') return hang(response);
          if (settings.refresh === 'server_error') return json(response, 503, { error: 'backend_error' });
          const entry = refreshTokens.get(params.get('refresh_token'));
          if (settings.refresh === 'invalid_grant' || !entry || entry.revoked) return json(response, 400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
          return json(response, 200, { access_token: issueAccessToken(entry.email), expires_in: settings.accessTokenTtlSeconds,
            scope: settings.grantedScopes.join(' '), token_type: 'Bearer' });
        }
        return json(response, 400, { error: 'unsupported_grant_type' });
      }
      if (request.method === 'POST' && url.pathname === '/revoke') {
        stats.revocations++;
        if (settings.revoke === 'hang') return hang(response);
        if (settings.revoke === 'server_error') return json(response, 503, { error: 'backend_error' });
        const params = await form(request);
        const token = params?.get('token') ?? '';
        const entry = refreshTokens.get(token);
        if (entry) entry.revoked = true;
        else if (accessTokens.has(token)) accessTokens.delete(token);
        else return json(response, 400, { error: 'invalid_token' });
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
