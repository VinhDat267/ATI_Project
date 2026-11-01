import { createServer } from 'node:http';
import { once } from 'node:events';

export async function providerFixture() {
  const requests = [], overrides = new Map(), codes = new Map(), access = new Map(), refresh = new Map(), barriers = new Map();
  let sequence = 0, refreshBarrier;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let raw = ''; for await (const chunk of req) raw += chunk;
    let body; try { body = raw ? JSON.parse(raw) : undefined; } catch { body = 'NOT_JSON'; }
    const record = { method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body, closedEarly: false };
    requests.push(record);
    const barrier = barriers.get(url.pathname);
    if (barrier) { barriers.delete(url.pathname); barrier.started(); await barrier.wait; }
    res.on('close', () => { if (!res.writableEnded) record.closedEarly = true; });
    const send = (status, value, headers = {}) => {
      if (res.destroyed) return;
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(value));
    };
    const override = overrides.get(url.pathname);
    if (override) { if (override.delayMs) await new Promise(r => setTimeout(r, override.delayMs)); return send(override.status ?? 200, override.body, override.headers); }
    if (url.pathname === '/oauth/token' && req.method === 'POST') {
      if (req.headers['content-type'] !== 'application/json' || body?.client_id !== 'test-client' || body?.client_secret !== 'SECRET_SENTINEL') return send(400, { error: 'invalid_client' });
      let grant;
      if (body.grant_type === 'authorization_code') {
        grant = codes.get(body.code); codes.delete(body.code);
        if (!body.redirect_uri) return send(400, { error: 'invalid_request' });
      } else if (body.grant_type === 'refresh_token') {
        grant = refresh.get(body.refresh_token); refresh.delete(body.refresh_token);
        if (refreshBarrier) { refreshBarrier.started(); await refreshBarrier.wait; refreshBarrier = undefined; }
      }
      if (!grant) return send(403, { error: 'invalid_grant', error_description: 'SECRET_SENTINEL rejected' });
      const n = ++sequence, accessToken = `ACCESS_SENTINEL_${n}`, refreshToken = `REFRESH_SENTINEL_${n}`;
      access.set(accessToken, grant); refresh.set(refreshToken, grant);
      return send(200, { access_token: accessToken, refresh_token: refreshToken, expires_in: 3600, scope: grant.scopes.join(' ') });
    }
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    const grant = access.get(token);
    if (!grant) return send(401, { error: 'unauthorized', token: 'ACCESS_SENTINEL' });
    if (url.pathname === '/me') return send(200, { account_id: grant.accountId, account_type: 'atlassian', name: 'Fixture Person', email: 'fixture@example.test' });
    if (url.pathname === '/oauth/token/accessible-resources') return send(200, grant.sites);
    if (/\/rest\/api\/3\/mypermissions$/.test(url.pathname)) return send(200, { permissions: { ADMINISTER: { key: 'ADMINISTER', type: 'GLOBAL', havePermission: grant.admin === true } } });
    return send(404, { error: 'not_found' });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    baseUrl, requests, overrides,
    issueCode({ accountId = 'account-one', scopes = ['read:me', 'offline_access'], sites = [], admin = false } = {}) {
      const code = `CODE_SENTINEL_${++sequence}`; codes.set(code, { accountId, scopes, sites, admin }); return code;
    },
    pauseRefresh() {
      let release, started; const wait = new Promise(r => { release = r; }); const reached = new Promise(r => { started = r; });
      refreshBarrier = { wait, started }; return { release, reached };
    },
    pauseNext(path) {
      let release, started; const wait = new Promise(r => { release = r; }); const reached = new Promise(r => { started = r; });
      barriers.set(path, { wait, started }); return { release, reached };
    },
    async close() { server.closeAllConnections(); await new Promise(r => server.close(r)); },
  };
}

export const site = (id = 'site-one', scopes = ['read:jira-work', 'write:jira-work']) => ({ id, name: id, url: `https://${id}.atlassian.net`, scopes, avatarUrl: 'https://avatar.example.test/site.png' });
export const configFor = (fixture, extra = {}) => ({
  clientId: 'test-client', clientSecret: 'SECRET_SENTINEL', redirectUri: 'http://127.0.0.1:4187/oauth/callback',
  mode: 'fixture', fixtureBaseUrl: fixture.baseUrl, ...extra,
});
