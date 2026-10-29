import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { NotionOAuthClient } from '../../src/services/notion/oauth-client.js';
const workspace = '11111111-1111-4111-8111-111111111111', bot = '22222222-2222-4222-8222-222222222222', owner = '33333333-3333-4333-8333-333333333333', database = '44444444-4444-4444-8444-444444444444';
describe('Notion public OAuth identity and shared-database metadata over HTTP', () => {
  let server: ReturnType<typeof createServer>, origin: string, mode = '', seen: Array<{ url: string; body: string; auth?: string }> = [];
  beforeAll(async () => {
    server = createServer(async (req, res) => {
      let body = ''; for await (const chunk of req) body += chunk;
      seen.push({ url: req.url!, body, auth: req.headers.authorization });
      if (mode === 'hang') return;
      if (mode === 'redirect') { res.writeHead(302, { Location: 'https://example.invalid' }); res.end(); return; }
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/v1/oauth/token') res.end(JSON.stringify({ token_type: 'bearer', access_token: 'ACCESS_SENTINEL', refresh_token: 'REFRESH_SENTINEL', workspace_id: workspace, workspace_name: 'Workspace', bot_id: bot, owner: { type: 'user', user: { id: owner } } }));
      else if (req.url === '/v1/users/me') res.end(JSON.stringify({ object: 'user', type: 'bot', id: mode === 'identity' ? owner : bot, bot: { owner: { type: 'user', user: { id: owner } } } }));
      else if (req.url === '/v1/search') res.end(JSON.stringify({ results: [{ object: 'data_source', id: bot, parent: { database_id: database }, title: [{ plain_text: 'Tasks' }] }], has_more: true, next_cursor: 'more' }));
      else if (req.url === '/v1/databases/' + database) res.end(JSON.stringify({ object: 'database', id: database, title: [{ plain_text: 'Tasks' }] }));
      else if (req.url === '/v1/oauth/revoke') { res.statusCode = 200; res.end('{}'); }
      else { res.statusCode = 404; res.end(JSON.stringify({ object: 'error', code: 'object_not_found' })); }
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); origin = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterAll(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); });
  const client = () => new NotionOAuthClient({ clientId: 'CLIENT', clientSecret: 'SECRET', redirectUri: 'https://ati.example/connections/mynotion/callback', authorizationUrl: origin + '/authorize', apiBaseUrl: origin + '/v1' });
  it('uses public integration owner=user and confidential Basic token exchange', async () => {
    const url = new URL(client().authorizationUrl('STATE')); expect(url.searchParams.get('owner')).toBe('user'); expect(url.searchParams.get('state')).toBe('STATE');
    const grant = await client().exchange('CODE', AbortSignal.timeout(1000));
    expect(grant).toMatchObject({ workspaceId: workspace, botId: bot, actorId: owner, accessToken: 'ACCESS_SENTINEL', refreshToken: 'REFRESH_SENTINEL' });
    expect(seen.find(r => r.url === '/v1/oauth/token')?.auth).toBe('Basic ' + Buffer.from('CLIENT:SECRET').toString('base64'));
  });
  it('rejects bot identity mismatch instead of adopting the wrong grant', async () => {
    mode = 'identity'; await expect(client().exchange('CODE', AbortSignal.timeout(1000))).rejects.toThrow(); mode = '';
  });
  it('uses data_source parent IDs; partial search is explicit and selection is verified', async () => {
    const result = await client().databases('ACCESS_SENTINEL', '', AbortSignal.timeout(1000));
    expect(result).toEqual({ databases: [{ id: database, title: 'Tasks' }], hasMore: true });
    expect(JSON.parse(seen.find(r => r.url === '/v1/search')!.body).filter.value).toBe('data_source');
    await expect(client().validateDatabases('ACCESS_SENTINEL', [database], AbortSignal.timeout(1000))).resolves.toEqual([{ id: database, title: 'Tasks' }]);
    await expect(client().validateDatabases('ACCESS_SENTINEL', [owner], AbortSignal.timeout(1000))).rejects.toThrow();
  });
  it('blocks redirects and aborts stalled requests', async () => {
    mode = 'redirect'; await expect(client().exchange('CODE', AbortSignal.timeout(1000))).rejects.toThrow();
    mode = 'hang'; await expect(client().exchange('CODE', AbortSignal.timeout(30))).rejects.toThrow(); mode = '';
  });
});
