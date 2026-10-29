import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { encryptCredentials, decryptCredentials } from '@wap/tool-adapters';
import { NotionConnectionRepo } from '../../src/db/repositories/notion-connection-repo.js';
import { NotionTokenManager } from '../../src/services/notion/token-manager.js';
import { NotionOAuthClient } from '../../src/services/notion/oauth-client.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
const key = '0123456789abcdef0123456789abcdef', workspace = '11111111-1111-4111-8111-111111111111', bot = '22222222-2222-4222-8222-222222222222';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
describe('Notion refresh uses committed checkpoints and PostgreSQL locks', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>, repo: NotionConnectionRepo, oauth: NotionOAuthClient;
  let server: ReturnType<typeof createServer>, refreshes = 0, fail = false, actor = '';
  beforeAll(async () => {
    db = await createMigratedSchema('notion_rotation'); repo = new NotionConnectionRepo(db.pool);
    server = createServer(async (req, res) => {
      let body = ''; for await (const chunk of req) body += chunk;
      if (req.url === '/oauth/token') { refreshes++; if (fail) { req.socket.destroy(); return; }
        const parsed = JSON.parse(body); expect(parsed.refresh_token).toBe('OLD_REFRESH');
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ token_type: 'bearer', access_token: 'NEW_ACCESS', refresh_token: 'NEW_REFRESH', workspace_id: workspace, bot_id: bot, owner: { type: 'user', user: { id: actor } } })); return;
      }
      res.setHeader('Content-Type', 'application/json');
      if (req.headers.authorization === 'Bearer OLD_ACCESS') { res.statusCode = 401; res.end(JSON.stringify({ object: 'error', code: 'unauthorized' })); }
      else res.end(JSON.stringify({ object: 'user', id: bot, type: 'bot' }));
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    oauth = new NotionOAuthClient({ clientId: 'CLIENT', clientSecret: 'SECRET', redirectUri: 'https://ati.example/connections/mynotion/callback', authorizationUrl: 'https://api.notion.com/v1/oauth/authorize', apiBaseUrl: `http://127.0.0.1:${(server.address() as any).port}` });
  });
  afterAll(async () => { server?.closeAllConnections(); if (server) await new Promise<void>(r => server.close(() => r())); await db?.close(); });
  async function seed() {
    const a = await db.person(); actor = a.id;
    const state = randomBytes(32).toString('base64url'), browser = randomBytes(32).toString('base64url');
    await repo.start({ userId: a.id, sessionId: a.sid, stateHash: hash(state), browserHash: hash(browser) });
    const consumed = await repo.consume({ userId: a.id, sessionId: a.sid, state, browser });
    const row = await repo.save(a.id, consumed!.id, { appId: 'CLIENT', workspaceId: workspace, workspaceName: 'Workspace', actorId: actor, scopes: [],
      config: encryptCredentials({ accessToken: 'OLD_ACCESS', refreshToken: 'OLD_REFRESH', botId: bot }, key) });
    return { a, row: row! };
  }
  const manager = () => new NotionTokenManager(repo, oauth, key);
  const use = (a: { id: string }, row: { id: string; identity_version: number }) => manager().execute(a.id, row.id, row.identity_version, (token, botId) => oauth.verify(token, botId, AbortSignal.timeout(1000)));
  it('two independent managers refresh a rejected token once, preserving generation', async () => {
    refreshes = 0; fail = false; const { a, row } = await seed(); await Promise.all([use(a, row), use(a, row)]);
    expect(refreshes).toBe(1); const stored = (await repo.list(a.id))[0]!; expect(stored.identity_version).toBe(row.identity_version);
    expect(decryptCredentials(stored.config!, key).refreshToken).toBe('NEW_REFRESH');
  });
  it('unknown refresh result is never retried with the old refresh token', async () => {
    refreshes = 0; fail = true; const { a, row } = await seed();
    await expect(use(a, row)).rejects.toThrow(); await expect(use(a, row)).rejects.toThrow(); expect(refreshes).toBe(1);
    expect((await repo.list(a.id))[0]).toMatchObject({ config: null, status: 'reconnect_required' }); fail = false;
  });
  it('a crashed checkpoint cannot resend a single-use token', async () => {
    refreshes = 0; const { a, row } = await seed(); await db.pool.query('UPDATE notion_connections SET refresh_in_flight=true WHERE id=$1', [row.id]);
    await expect(use(a, row)).rejects.toThrow(); expect(refreshes).toBe(0);
  });
});
