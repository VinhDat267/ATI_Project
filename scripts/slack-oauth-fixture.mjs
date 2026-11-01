import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
/** OAuth setup fixture only; never reads or writes real Slack. Codes and tokens are stateful. */
export async function startSlackOAuthFixture({ redirectUri, readFixtures = false }) {
  const worker = new Worker(new URL(import.meta.url), { workerData: { redirectUri, readFixtures } });
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { void worker.terminate(); reject(new Error('Slack fixture readiness timeout')); }, 10000);
    worker.once('error', error => { clearTimeout(timer); reject(error); });
    worker.once('message', value => { clearTimeout(timer); resolve(value.origin); });
  });
  return { origin, stop: () => worker.terminate() };
}
async function serveSlackOAuthFixture({ redirectUri, readFixtures }) {
  const codes = new Map(), tokens = new Map(); let installs = 0;
  const instanceId=randomBytes(6).toString('hex').toUpperCase();
  let reads = 0;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture');
    if(readFixtures && url.pathname==='/__stats'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({reads}));return;}
    if (url.pathname === '/authorize') {
      if (url.searchParams.get('client_id') !== 'slack-fixture-client' || url.searchParams.get('redirect_uri') !== redirectUri) { res.writeHead(400); res.end(); return; }
      const code = randomBytes(24).toString('base64url'), workspaceId = `T_FIXTURE_${instanceId}_${++installs}`;
      codes.set(code, {team:workspaceId,scope:url.searchParams.get('user_scope')??''});
      const back = new URL(redirectUri); back.searchParams.set('code', code); back.searchParams.set('state', url.searchParams.get('state'));
      res.writeHead(302, { Location: back.href }); res.end(); return;
    }
    let body = ''; for await (const chunk of req) body += chunk;
    const params = new URLSearchParams(body); res.setHeader('Content-Type', 'application/json');
    const reply = value => res.end(JSON.stringify(value));
    if (url.pathname === '/api/oauth.v2.access') {
      if (params.get('client_id') !== 'slack-fixture-client' || params.get('client_secret') !== 'slack-fixture-secret') return reply({ ok: false, error: 'invalid_client_id' });
      const code = params.get('code'), grant = codes.get(code); codes.delete(code);
      if (!grant) return reply({ ok: false, error: 'invalid_code' });
      const {team,scope}=grant;
      const token = 'fixture-user-' + randomBytes(24).toString('hex'); tokens.set(token, team);
      return reply({ ok: true, app_id: 'A_FIXTURE', team: { id: team, name: 'Workspace ' + team }, authed_user: { id: 'U_FIXTURE', token_type: 'user', access_token: token, scope } });
    }
    const token = req.headers.authorization?.replace(/^Bearer /, ''), team = tokens.get(token);
    if (!team) return reply({ ok: false, error: 'invalid_auth' });
    if (url.pathname === '/api/auth.test') return reply({ ok: true, team_id: team, user_id: 'U_FIXTURE' });
    if (url.pathname === '/api/auth.revoke') { tokens.delete(token); return reply({ ok: true, revoked: true }); }
    if(readFixtures && req.method==='GET'){
      const channel={id:'C_FIXTURE',name:'ati-test',is_channel:true,is_private:false};
      const message={type:'message',ts:'1730000000.000001',user:'U_FIXTURE',text:'Nội dung Slack fixture M2 · '+team};
      const user={id:'U_FIXTURE',team_id:team,name:'Lan fixture'};
      const methods={
        '/api/conversations.list':()=>({channels:[channel],response_metadata:{next_cursor:''}}),
        '/api/conversations.info':()=>({channel}),
        '/api/conversations.history':()=>({messages:[message],has_more:false,response_metadata:{next_cursor:''}}),
        '/api/conversations.replies':()=>({messages:[message],has_more:false,response_metadata:{next_cursor:''}}),
        '/api/conversations.members':()=>({members:['U_FIXTURE'],response_metadata:{next_cursor:''}}),
        '/api/users.list':()=>({members:[user],response_metadata:{next_cursor:''}}),
        '/api/users.info':()=>({user:{...user,id:url.searchParams.get('user')}}),
        '/api/chat.getPermalink':()=>({channel:'C_FIXTURE',permalink:'https://fixture.slack.com/archives/C_FIXTURE/p1730000000000001'}),
      };
      const methodPath=url.pathname.startsWith('/api/')?url.pathname:'/api'+url.pathname;
      if(methods[methodPath]){reads++;return reply({ok:true,...methods[methodPath]()});}
    }
    reply({ ok: false, error: 'unknown_method' });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, stop: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
if (!isMainThread) {
  const fixture = await serveSlackOAuthFixture(workerData);
  parentPort.postMessage({ origin: fixture.origin });
}
