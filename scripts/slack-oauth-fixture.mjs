import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
/** OAuth setup fixture only; never reads or writes real Slack. Codes and tokens are stateful. */
export async function startSlackOAuthFixture({ redirectUri }) {
  const worker = new Worker(new URL(import.meta.url), { workerData: { redirectUri } });
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { void worker.terminate(); reject(new Error('Slack fixture readiness timeout')); }, 10000);
    worker.once('error', error => { clearTimeout(timer); reject(error); });
    worker.once('message', value => { clearTimeout(timer); resolve(value.origin); });
  });
  return { origin, stop: () => worker.terminate() };
}
async function serveSlackOAuthFixture({ redirectUri }) {
  const codes = new Map(), tokens = new Map(); let installs = 0;
  const scopes = 'channels:read,groups:read,im:read,mpim:read,channels:history,groups:history,im:history,mpim:history,search:read,chat:write';
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname === '/authorize') {
      if (url.searchParams.get('client_id') !== 'slack-fixture-client' || url.searchParams.get('redirect_uri') !== redirectUri) { res.writeHead(400); res.end(); return; }
      const code = randomBytes(24).toString('base64url'), workspaceId = `T_FIXTURE_${++installs}`;
      codes.set(code, workspaceId);
      const back = new URL(redirectUri); back.searchParams.set('code', code); back.searchParams.set('state', url.searchParams.get('state'));
      res.writeHead(302, { Location: back.href }); res.end(); return;
    }
    let body = ''; for await (const chunk of req) body += chunk;
    const params = new URLSearchParams(body); res.setHeader('Content-Type', 'application/json');
    const reply = value => res.end(JSON.stringify(value));
    if (url.pathname === '/api/oauth.v2.access') {
      if (params.get('client_id') !== 'slack-fixture-client' || params.get('client_secret') !== 'slack-fixture-secret') return reply({ ok: false, error: 'invalid_client_id' });
      const code = params.get('code'), team = codes.get(code); codes.delete(code);
      if (!team) return reply({ ok: false, error: 'invalid_code' });
      const token = 'fixture-user-' + randomBytes(24).toString('hex'); tokens.set(token, team);
      return reply({ ok: true, app_id: 'A_FIXTURE', team: { id: team, name: 'Workspace ' + team }, authed_user: { id: 'U_FIXTURE', token_type: 'user', access_token: token, scope: scopes } });
    }
    const token = req.headers.authorization?.replace(/^Bearer /, ''), team = tokens.get(token);
    if (!team) return reply({ ok: false, error: 'invalid_auth' });
    if (url.pathname === '/api/auth.test') return reply({ ok: true, team_id: team, user_id: 'U_FIXTURE' });
    if (url.pathname === '/api/auth.revoke') { tokens.delete(token); return reply({ ok: true, revoked: true }); }
    reply({ ok: false, error: 'unknown_method' });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, stop: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
if (!isMainThread) {
  const fixture = await serveSlackOAuthFixture(workerData);
  parentPort.postMessage({ origin: fixture.origin });
}
