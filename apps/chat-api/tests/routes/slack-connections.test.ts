import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createServer } from 'node:http';
import { createApp } from '../../src/app.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { SlackConnectionRepo } from '../../src/db/repositories/slack-connection-repo.js';
import { SLACK_USER_SCOPES } from '../../src/services/slack/oauth-client.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
const secret = 'slack-test-secret-more-than-32-chars', key = '0123456789abcdef0123456789abcdef';
describe('Slack connection routes through HTTP, sessions and PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>, repo: SlackConnectionRepo, server: ReturnType<typeof createServer>, origin: string;
  let team = 'T_FIRST', calls = 0, revoked = false;
  beforeAll(async () => {
    db = await createMigratedSchema('slack_routes'); repo = new SlackConnectionRepo(db.pool);
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString('utf8');
      const params = new URLSearchParams(body);
      const code = params.get('code');
      const authHeader = req.headers.authorization ?? '';
      calls++; res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/auth.test') {
        const teamForToken = authHeader.includes('TOKEN_FOR_T1') ? 'T_ROUTE_1'
          : authHeader.includes('TOKEN_FOR_T2') ? 'T_ROUTE_2'
          : team;
        res.end(JSON.stringify(revoked ? { ok: false, error: 'token_revoked' } : { ok: true, team_id: teamForToken, user_id: 'U_ACTOR' }));
      }
      else if (req.url === '/api/auth.revoke') res.end(JSON.stringify({ ok: true, revoked: true }));
      else {
        const teamForCode = code === 'CODE_T1' ? 'T_ROUTE_1' : code === 'CODE_T2' ? 'T_ROUTE_2' : team;
        const tokenForCode = code === 'CODE_T1' ? 'TOKEN_FOR_T1' : code === 'CODE_T2' ? 'TOKEN_FOR_T2' : 'SECRET_ACCESS_TOKEN';
        res.end(JSON.stringify({ ok: true, app_id: 'A_APP', team: { id: teamForCode, name: 'Workspace ' + teamForCode }, authed_user: { id: 'U_ACTOR', token_type: 'user', access_token: tokenForCode, scope: SLACK_USER_SCOPES.join(',') } }));
      }
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); origin = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterAll(async () => { server?.closeAllConnections(); if (server) await new Promise<void>(r => server.close(() => r())); await db?.close(); });
  const app = () => createApp({ jwtSecret: secret, userRepo: db.users, encryptionKey: key,
    myslack: { repo, oauth: { appId: 'A_APP', clientId: 'CLIENT', clientSecret: 'CLIENT_SECRET', redirectUri: 'http://127.0.0.1:5174/connections/myslack/callback', authorizationUrl: origin + '/authorize', apiBaseUrl: origin + '/api' } } });
  const bearer = (a: any) => 'Bearer ' + generateAccessToken(a, secret, a.sid).accessToken;
  async function start(a: any) {
    const r = await request(app()).post('/api/connections/myslack/start').set('Authorization', bearer(a));
    expect(r.status).toBe(200); return { state: new URL(r.body.url).searchParams.get('state')!, cookie: (r.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]! };
  }
  const finish = (a: any, f: any, code = 'CODE') => request(app()).post('/api/connections/myslack/callback').set('Authorization', bearer(a)).set('Cookie', f.cookie).send({ code, state: f.state });
  it('is absent when not configured and requires a persistent session when enabled', async () => {
    const a = await db.person();
    expect((await request(createApp({ jwtSecret: secret })).get('/api/connections/myslack')).status).toBe(404);
    expect((await request(app()).get('/api/connections/myslack')).status).toBe(401);
    expect((await request(app()).get('/api/connections/myslack').set('Authorization', 'Bearer ' + generateAccessToken(a, secret, '').accessToken)).status).toBe(401);
  });
  it('connects two named workspaces without secrets in any response; pending processing', async () => {
    const a = await db.person(); team = 'T_ROUTE_A';
    const first = await finish(a, await start(a)); expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ workspaceId: team, actorId: 'U_ACTOR', processingStatus: 'pending' });
    team = 'T_ROUTE_B'; expect((await finish(a, await start(a))).status).toBe(200);
    const list = await request(app()).get('/api/connections/myslack').set('Authorization', bearer(a));
    expect(list.body.connections).toHaveLength(2); expect(JSON.stringify(list.body)).not.toMatch(/SECRET_ACCESS_TOKEN|CLIENT_SECRET|config|refreshToken/);
    const stored = await repo.list(a.id); expect(stored[0]!.config).not.toContain('SECRET_ACCESS_TOKEN');
    const b = await db.person(); expect((await request(app()).get('/api/connections/myslack').set('Authorization', bearer(b))).body.connections).toEqual([]);
    const removed = await request(app()).delete('/api/connections/myslack/' + first.body.id).set('Authorization', bearer(a));
    expect(removed.body).toMatchObject({ success: true, revoked: true }); expect(await repo.list(a.id)).toHaveLength(1);
  });
  it('wrong browser/owner and repeated callbacks cannot exchange the code', async () => {
    const a = await db.person(), b = await db.person(), f = await start(a); team = 'T_ONCE';
    const before = calls;
    expect((await finish(b, f)).status).toBe(400);
    expect((await finish(a, { ...f, cookie: 'ati_slack_browser=' + 'x'.repeat(43) })).status).toBe(400);
    expect(calls).toBe(before);
    expect((await finish(a, f)).status).toBe(200); const after = calls;
    expect((await finish(a, f)).status).toBe(400); expect(calls).toBe(after);
  });
  it('cancellation consumes state without exchanging or reading Slack', async () => {
    const a = await db.person(), f = await start(a), before = calls;
    const r = await request(app()).post('/api/connections/myslack/callback').set('Authorization', bearer(a)).set('Cookie', f.cookie).send({ state: f.state, error: 'denied' });
    expect(r.body.code).toBe('SLACK_DENIED'); expect((await finish(a, f)).status).toBe(400); expect(calls).toBe(before);
  });
  it('metadata check recognizes revoked grants and never checks another owner', async () => {
    const a = await db.person(), b = await db.person(); team = 'T_REVOKED';
    const connected = await finish(a, await start(a)), before = calls;
    expect((await request(app()).post(`/api/connections/myslack/${connected.body.id}/check`).set('Authorization', bearer(b))).status).toBe(404);
    expect(calls).toBe(before); revoked = true;
    const check = await request(app()).post(`/api/connections/myslack/${connected.body.id}/check`).set('Authorization', bearer(a));
    expect(check.body.status).toBe('reconnect_required');
    expect((await repo.list(a.id))[0]).toMatchObject({ status: 'reconnect_required', config: null }); revoked = false;
  });
  it('allows two parallel OAuth flows to both complete for different workspaces', async () => {
    const a = await db.person();
    // 1. Start first flow, receiving browser cookie
    const start1 = await request(app()).post('/api/connections/myslack/start').set('Authorization', bearer(a));
    expect(start1.status).toBe(200);
    const cookie = (start1.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    const state1 = new URL(start1.body.url).searchParams.get('state')!;

    // 2. Start second flow in the same browser session (passing shared browser cookie)
    const start2 = await request(app()).post('/api/connections/myslack/start').set('Authorization', bearer(a)).set('Cookie', cookie);
    expect(start2.status).toBe(200);
    const state2 = new URL(start2.body.url).searchParams.get('state')!;

    // 3. Complete both callbacks concurrently via Promise.all
    const [r1, r2] = await Promise.all([
      finish(a, { state: state1, cookie }, 'CODE_T1'),
      finish(a, { state: state2, cookie }, 'CODE_T2'),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r1.body.workspaceId).toBe('T_ROUTE_1');
    expect(r2.body.workspaceId).toBe('T_ROUTE_2');
    const list = await request(app()).get('/api/connections/myslack').set('Authorization', bearer(a));
    expect(list.body.connections).toHaveLength(2);
  });
});
