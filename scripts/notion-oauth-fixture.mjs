import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
/** Isolated public-integration fixture, no real Notion. Worker remains responsive to sync browser launcher. */
export async function startNotionOAuthFixture({ redirectUri }) {
  const worker = new Worker(new URL(import.meta.url), { workerData: { redirectUri } });
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { void worker.terminate(); reject(new Error('Notion fixture readiness timeout')); }, 10000);
    worker.once('error', error => { clearTimeout(timer); reject(error); });
    worker.once('message', value => { clearTimeout(timer); resolve(value.origin); });
  });
  return { origin, stop: () => worker.terminate() };
}
if (!isMainThread) {
  const codes = new Map(), tokens = new Map(); let n = 0;
  const bot = '22222222-2222-4222-8222-222222222222', owner = '33333333-3333-4333-8333-333333333333';
  const database = '44444444-4444-4444-8444-444444444444';
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname === '/authorize') {
      if (url.searchParams.get('client_id') !== 'notion-fixture-client' || url.searchParams.get('redirect_uri') !== workerData.redirectUri || url.searchParams.get('owner') !== 'user') { res.writeHead(400); res.end(); return; }
      const code = randomBytes(24).toString('base64url'), workspace = `11111111-1111-4111-8111-${String(++n).padStart(12, '0')}`; codes.set(code, workspace);
      const back = new URL(workerData.redirectUri); back.searchParams.set('code', code); back.searchParams.set('state', url.searchParams.get('state'));
      res.writeHead(302, { Location: back.href }); res.end(); return;
    }
    let body = ''; for await (const chunk of req) body += chunk;
    res.setHeader('Content-Type', 'application/json'); const reply = value => res.end(JSON.stringify(value));
    if (url.pathname === '/v1/oauth/token') {
      if (req.headers.authorization !== 'Basic ' + Buffer.from('notion-fixture-client:notion-fixture-secret').toString('base64')) { res.statusCode = 401; return reply({ object: 'error', code: 'invalid_client' }); }
      const params = JSON.parse(body), workspace = codes.get(params.code); codes.delete(params.code);
      if (!workspace) { res.statusCode = 400; return reply({ object: 'error', code: 'invalid_grant' }); }
      const access = 'fixture-notion-' + randomBytes(24).toString('hex'); tokens.set(access, workspace);
      return reply({ token_type: 'bearer', access_token: access, workspace_id: workspace, workspace_name: 'Notion Workspace ' + n, bot_id: bot, owner: { type: 'user', user: { id: owner } } });
    }
    if (url.pathname === '/v1/oauth/revoke') { tokens.delete(JSON.parse(body).token); return reply({}); }
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    if (!tokens.has(token)) { res.statusCode = 401; return reply({ object: 'error', code: 'unauthorized' }); }
    if (url.pathname === '/v1/users/me') return reply({ object: 'user', type: 'bot', id: bot });
    if (url.pathname === '/v1/search') return reply({ results: [{ object: 'data_source', id: owner, parent: { database_id: database }, title: [{ plain_text: 'Tasks fixture' }] }], has_more: false });
    if (url.pathname === '/v1/databases/' + database) return reply({ object: 'database', id: database, title: [{ plain_text: 'Tasks fixture' }] });
    res.statusCode = 404; reply({ object: 'error', code: 'object_not_found' });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  parentPort.postMessage({ origin: `http://127.0.0.1:${server.address().port}` });
}
