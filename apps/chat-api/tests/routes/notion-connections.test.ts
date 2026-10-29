import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createServer } from 'node:http';
import { createApp } from '../../src/app.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { NotionConnectionRepo } from '../../src/db/repositories/notion-connection-repo.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
const secret = 'notion-test-secret-more-than-32-chars', key = '0123456789abcdef0123456789abcdef';
const workspace = '11111111-1111-4111-8111-111111111111', bot = '22222222-2222-4222-8222-222222222222', owner = '33333333-3333-4333-8333-333333333333', database = '44444444-4444-4444-8444-444444444444';
describe('Notion OAuth and database selection through HTTP and PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>, repo: NotionConnectionRepo, server: ReturnType<typeof createServer>, origin: string;
  let revoked = false, calls = 0;
  beforeAll(async () => {
    db = await createMigratedSchema('notion_routes'); repo = new NotionConnectionRepo(db.pool);
    server = createServer(async (req, res) => {
      for await (const _ of req) {} calls++; res.setHeader('Content-Type', 'application/json');
      if (revoked && req.url !== '/v1/oauth/revoke') { res.statusCode = 401; res.end(JSON.stringify({ object: 'error', code: 'unauthorized' })); return; }
      if (req.url === '/v1/users/me') res.end(JSON.stringify({ object: 'user', type: 'bot', id: bot }));
      else if (req.url === '/v1/oauth/token') res.end(JSON.stringify({ token_type: 'bearer', access_token: 'SECRET_ACCESS', workspace_id: workspace, workspace_name: 'Workspace', bot_id: bot, owner: { type: 'user', user: { id: owner } } }));
      else if (req.url === '/v1/search') res.end(JSON.stringify({ results: [{ object: 'data_source', parent: { database_id: database }, title: [{ plain_text: 'Tasks' }] }], has_more: false }));
      else if (req.url === '/v1/databases/' + database) res.end(JSON.stringify({ object: 'database', id: database, title: [{ plain_text: 'Tasks' }] }));
      else if (req.url === '/v1/oauth/revoke') res.end('{}');
      else { res.statusCode = 404; res.end(JSON.stringify({ object: 'error', code: 'object_not_found' })); }
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); origin = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterAll(async () => { server?.closeAllConnections(); if (server) await new Promise<void>(r => server.close(() => r())); await db?.close(); });
  const app = () => createApp({ jwtSecret: secret, userRepo: db.users, encryptionKey: key,
    mynotion: { repo, oauth: { clientId: 'CLIENT', clientSecret: 'SECRET', redirectUri: 'http://127.0.0.1:5174/connections/mynotion/callback', authorizationUrl: origin + '/authorize', apiBaseUrl: origin + '/v1' } } });
  const bearer = (a: any) => 'Bearer ' + generateAccessToken(a, secret, a.sid).accessToken;
  async function start(a: any) { const r = await request(app()).post('/api/connections/mynotion/start').set('Authorization', bearer(a)); expect(r.status).toBe(200); return { state: new URL(r.body.url).searchParams.get('state')!, cookie: (r.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]! }; }
  const finish = (a: any, f: any) => request(app()).post('/api/connections/mynotion/callback').set('Authorization', bearer(a)).set('Cookie', f.cookie).send({ code: 'CODE', state: f.state });
  it('is absent when disabled and requires the caller session', async () => {
    expect((await request(createApp({ jwtSecret: secret })).get('/api/connections/mynotion')).status).toBe(404);
    expect((await request(app()).get('/api/connections/mynotion')).status).toBe(401);
  });
  it('connects, lists safe metadata, validates scope and blocks unknown database IDs', async () => {
    const a = await db.person(), f = await start(a), result = await finish(a, f);
    expect(result.status).toBe(200); expect(result.body).toMatchObject({ workspaceId: workspace, actorId: owner, status: 'scope_required', toolsAvailable: false });
    expect(JSON.stringify(result.body)).not.toContain('SECRET_ACCESS');
    expect((await finish(a, f)).status).toBe(400);
    const path = '/api/connections/mynotion/' + result.body.id;
    const choices = await request(app()).get(path + '/databases').set('Authorization', bearer(a)); expect(choices.body.databases).toEqual([{ id: database, title: 'Tasks' }]);
    expect((await request(app()).put(path + '/scope').set('Authorization', bearer(a)).send({ identityVersion: result.body.identityVersion, databaseIds: [owner] })).status).toBe(400);
    const selected = await request(app()).put(path + '/scope').set('Authorization', bearer(a)).send({ identityVersion: result.body.identityVersion, databaseIds: [database] });
    expect(selected.status).toBe(200); expect(selected.body.allowedDatabases).toEqual([database]); expect(selected.body.identityVersion).toBe(result.body.identityVersion + 1);
    expect((await request(app()).put(path + '/scope').set('Authorization', bearer(a)).send({ identityVersion: result.body.identityVersion, databaseIds: [database] })).status).toBe(409);
    const b = await db.person(), before = calls;
    expect((await request(app()).get(path + '/databases').set('Authorization', bearer(b))).status).toBe(404); expect(calls).toBe(before);
    expect((await request(app()).delete(path).set('Authorization', bearer(a))).body).toMatchObject({ success: true, revoked: true });
    expect(await repo.list(a.id)).toHaveLength(0);
  });
  it('denied consent is one-use and does not call Notion', async () => {
    const a = await db.person(), f = await start(a), before = calls;
    const r = await request(app()).post('/api/connections/mynotion/callback').set('Authorization', bearer(a)).set('Cookie', f.cookie).send({ state: f.state, error: 'denied' });
    expect(r.body.code).toBe('NOTION_DENIED'); expect(calls).toBe(before);
  });
  it('revoked authorization becomes reconnect_required without affecting other owners', async () => {
    const a = await db.person(), result = await finish(a, await start(a)); revoked = true;
    const check = await request(app()).post(`/api/connections/mynotion/${result.body.id}/check`).set('Authorization', bearer(a));
    expect(check.body.status).toBe('reconnect_required'); revoked = false;
    expect((await repo.list(a.id))[0]!.config).toBeNull();
  });
});
