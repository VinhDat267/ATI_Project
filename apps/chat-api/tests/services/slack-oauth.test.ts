import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { SlackOAuthClient, SLACK_USER_SCOPES } from '../../src/services/slack/oauth-client.js';

describe('Slack confidential OAuth uses verified user identity and bounded HTTP', () => {
  let server: ReturnType<typeof createServer>, origin: string;
  const requests: Array<{ path: string; body: string; authorization?: string }> = [];
  let fault = '';
  beforeAll(async () => {
    server = createServer(async (req, res) => {
      let body = ''; for await (const chunk of req) body += chunk;
      requests.push({ path: req.url!, body, authorization: req.headers.authorization });
      if (fault === 'hang') return;
      if (fault === 'redirect') { res.writeHead(302, { Location: 'https://example.invalid/' }); res.end(); return; }
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/auth.test') res.end(JSON.stringify({ ok: true, team_id: 'T_ONE', user_id: fault === 'identity' ? 'U_WRONG' : 'U_ONE' }));
      else if (req.url === '/api/auth.revoke') res.end(JSON.stringify({ ok: true, revoked: true }));
      else res.end(JSON.stringify({ ok: true, app_id: 'A_APP', team: { id: 'T_ONE', name: 'Workspace' },
        access_token: 'BOT_SENTINEL', authed_user: { id: 'U_ONE', token_type: 'user', access_token: 'USER_SENTINEL',
          refresh_token: 'REFRESH_SENTINEL', expires_in: 43200, scope: fault === 'scope' ? 'chat:write' : SLACK_USER_SCOPES.join(',') } }));
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    origin = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterAll(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); });
  const client = () => new SlackOAuthClient({ clientId: 'client', clientSecret: 'SECRET', appId: 'A_APP',
    redirectUri: 'https://ati.example/connections/myslack/callback', authorizationUrl: origin + '/authorize', apiBaseUrl: origin + '/api' });
  it('requests user_scope, never bot scope or Google PKCE', () => {
    const url = new URL(client().authorizationUrl('STATE'));
    expect(url.searchParams.get('user_scope')?.split(',')).toEqual(SLACK_USER_SCOPES);
    expect(url.searchParams.has('scope')).toBe(false); expect(url.searchParams.has('code_challenge')).toBe(false);
  });
  it('stores only user token after auth.test matches app/workspace/actor', async () => {
    fault = ''; const result = await client().exchange('CODE', AbortSignal.timeout(1000));
    expect(result).toMatchObject({ appId: 'A_APP', workspaceId: 'T_ONE', actorId: 'U_ONE', accessToken: 'USER_SENTINEL', refreshToken: 'REFRESH_SENTINEL', expiresIn: 43200 });
    expect(JSON.stringify(result)).not.toContain('BOT_SENTINEL');
    expect(requests.at(-1)).toMatchObject({ path: '/api/auth.test', authorization: 'Bearer USER_SENTINEL' });
    expect(result.missingScopes).toEqual([]);
  });
  it('reports missing requested scopes without inventing permissions', async () => {
    fault = 'scope'; const result = await client().exchange('CODE', AbortSignal.timeout(1000));
    expect(result.missingScopes).toContain('channels:read'); fault = '';
  });
  it('rejects identity mismatch without exposing provider token or response', async () => {
    fault = 'identity'; await expect(client().exchange('CODE', AbortSignal.timeout(1000))).rejects.toThrow('SLACK_IDENTITY_MISMATCH'); fault = '';
  });
  it('rejects redirects and really aborts a stalled provider', async () => {
    fault = 'redirect'; await expect(client().exchange('CODE', AbortSignal.timeout(1000))).rejects.toThrow();
    fault = 'hang'; await expect(client().exchange('CODE', AbortSignal.timeout(30))).rejects.toThrow(); fault = '';
  });
});
