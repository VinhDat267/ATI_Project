import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { encryptCredentials, decryptCredentials } from '@wap/tool-adapters';
import { SlackConnectionRepo } from '../../src/db/repositories/slack-connection-repo.js';
import { SlackTokenManager } from '../../src/services/slack/token-manager.js';
import { SlackOAuthClient } from '../../src/services/slack/oauth-client.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
const key = '0123456789abcdef0123456789abcdef';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
describe('Slack rotation checkpoints under actual PostgreSQL locks and HTTP', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>, repo: SlackConnectionRepo, oauth: SlackOAuthClient;
  let server: ReturnType<typeof createServer>, count = 0, fail = false;
  beforeAll(async () => {
    db = await createMigratedSchema('slack_rotation'); repo = new SlackConnectionRepo(db.pool);
    server = createServer(async (req, res) => {
      let body = ''; for await (const chunk of req) body += chunk; count++;
      const params = new URLSearchParams(body);
      await new Promise(r => setTimeout(r, 30));
      if (fail) { req.socket.destroy(); return; }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, token_type: 'user', access_token: 'ROTATED_ACCESS', refresh_token: 'ROTATED_REFRESH', expires_in: 43200 }));
      expect(params.get('refresh_token')).toBe('OLD_REFRESH');
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    oauth = new SlackOAuthClient({ appId: 'A_APP', clientId: 'CLIENT', clientSecret: 'SECRET', redirectUri: 'https://ati.example/connections/myslack/callback', authorizationUrl: 'https://slack.com/oauth/v2/authorize', apiBaseUrl: `http://127.0.0.1:${(server.address() as any).port}` });
  });
  afterAll(async () => { server?.closeAllConnections(); if (server) await new Promise<void>(r => server.close(() => r())); await db?.close(); });
  async function seed() {
    const a = await db.person(), state = randomBytes(32).toString('base64url'), browser = randomBytes(32).toString('base64url');
    await repo.start({ userId: a.id, sessionId: a.sid, stateHash: hash(state), browserHash: hash(browser) });
    const consumed = await repo.consume({ userId: a.id, sessionId: a.sid, state, browser });
    const row = await repo.save(a.id, consumed!.id, { appId: 'A_APP', workspaceId: 'T_' + a.id, workspaceName: 'Workspace', actorId: 'U_A', scopes: [],
      config: encryptCredentials({ accessToken: 'OLD_ACCESS', refreshToken: 'OLD_REFRESH', expiresAt: Date.now() - 1000 }, key) });
    return { a, row: row! };
  }
  const manager = () => new SlackTokenManager(repo, oauth, key);
  it('two independent managers rotate once and preserve identity version', async () => {
    count = 0; fail = false; const { a, row } = await seed();
    const tokens = await Promise.all([manager().getAccessToken(a.id, row.id, row.identity_version), manager().getAccessToken(a.id, row.id, row.identity_version)]);
    expect(tokens).toEqual(['ROTATED_ACCESS', 'ROTATED_ACCESS']); expect(count).toBe(1);
    const saved = (await repo.list(a.id))[0]!;
    expect(saved.identity_version).toBe(row.identity_version); expect(saved.refresh_in_flight).toBe(false);
    expect(saved.config).not.toContain('ROTATED_ACCESS'); expect(decryptCredentials(saved.config!, key).refreshToken).toBe('ROTATED_REFRESH');
  });
  it('uncertain provider result loses permission and never reuses old refresh', async () => {
    count = 0; fail = true; const { a, row } = await seed();
    await expect(manager().getAccessToken(a.id, row.id, row.identity_version)).rejects.toThrow('SLACK_RECONNECT_REQUIRED');
    await expect(manager().getAccessToken(a.id, row.id, row.identity_version)).rejects.toThrow('SLACK_RECONNECT_REQUIRED');
    expect(count).toBe(1); expect((await repo.list(a.id))[0]).toMatchObject({ status: 'reconnect_required', config: null }); fail = false;
  });
  it('a crashed refresh checkpoint cannot resend the retired token', async () => {
    count = 0; const { a, row } = await seed();
    await db.pool.query('UPDATE slack_connections SET refresh_in_flight=true WHERE id=$1', [row.id]);
    await expect(manager().getAccessToken(a.id, row.id, row.identity_version)).rejects.toThrow('SLACK_RECONNECT_REQUIRED'); expect(count).toBe(0);
  });
  it('wrong owner or preview generation never reaches provider', async () => {
    count = 0; const { a, row } = await seed(), b = await db.person();
    await expect(manager().getAccessToken(b.id, row.id, row.identity_version)).rejects.toThrow();
    await expect(manager().getAccessToken(a.id, row.id, row.identity_version + 1)).rejects.toThrow(); expect(count).toBe(0);
  });
});
