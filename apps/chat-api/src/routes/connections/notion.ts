import { Router, type Request, type Response } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { encryptCredentials, decryptCredentials } from '@wap/tool-adapters';
import { NOTION_ID_PATTERN, normalizeNotionId } from '@wap/tool-schemas';
import { createAuthMiddleware, type AuthUser } from '../../auth/jwt.js';
import type { SessionRepo } from '../../db/repositories/session-repo.js';
import type { NotionConnectionRepo, NotionConnectionRow } from '../../db/repositories/notion-connection-repo.js';
import { NotionOAuthClient, NotionOAuthError, type NotionOAuthConfig } from '../../services/notion/oauth-client.js';
import { NotionTokenManager } from '../../services/notion/token-manager.js';
const name = 'ati_notion_browser', path = '/api/connections/mynotion';
const random = () => randomBytes(32).toString('base64url');
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const valid = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_-]{43}$/.test(s);
export interface NotionConnectionsOptions {
  oauth: NotionOAuthConfig; repo: NotionConnectionRepo; jwtSecret: string; encryptionKey: string;
  sessionRepo: SessionRepo; fetchFn?: typeof fetch; clock?: () => number; timeoutMs?: number;
}
export const notionConnectionView = (row: NotionConnectionRow) => ({
  id: row.id, workspaceId: row.workspace_id, workspaceName: row.workspace_name, actorId: row.actor_id,
  identityVersion: row.identity_version, status: row.status === 'active' ? row.allowed_databases.length ? 'connected' : 'scope_required' : row.status,
  connectedAt: row.connected_at, allowedDatabases: row.allowed_databases, toolsAvailable: false,
});
export function createNotionConnectionRoutes(o: NotionConnectionsOptions): Router {
  const router = Router(), client = new NotionOAuthClient(o.oauth, o.fetchFn), clock = o.clock ?? Date.now;
  const tokens = new NotionTokenManager(o.repo, client, o.encryptionKey, o.timeoutMs);
  const signal = () => AbortSignal.timeout(o.timeoutMs ?? 10000);
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.use(createAuthMiddleware(o.jwtSecret, { sessionRepo: o.sessionRepo, clock }));
  router.use((req, res, next) => { if (!(req as any).user?.sid) { res.status(401).json({ code: 'INVALID_SESSION', error: 'Phiên đăng nhập đã hết hạn.' }); return; } next(); });
  const who = (req: Request) => (req as any).user as AuthUser;
  const fail = (res: Response, code: string, status = 400) => res.status(status).json({ code, error: code === 'NOTION_DENIED' ? 'Bạn đã hủy kết nối Notion.' : 'Không hoàn tất được thao tác Notion. Hãy kiểm tra quyền và thử lại.' });
  const own = async (req: Request, res: Response): Promise<NotionConnectionRow | undefined> => {
    const value = req.params.id;
    const row = typeof value === 'string' && NOTION_ID_PATTERN.test(value) ? (await o.repo.list(who(req).id)).find(r => r.id === value) : undefined;
    if (!row) fail(res, 'NOTION_NOT_FOUND', 404); return row;
  };
  router.get('/', async (req, res) => { try { res.json({ connections: (await o.repo.list(who(req).id)).map(notionConnectionView) }); } catch { fail(res, 'NOTION_UNAVAILABLE', 503); } });
  router.post('/start', async (req, res) => {
    const user = who(req), state = random();
    const cookie = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))?.slice(name.length + 1);
    const browser = valid(cookie) ? cookie : random();
    try {
      await o.repo.start({ userId: user.id, sessionId: user.sid!, stateHash: hash(state), browserHash: hash(browser) }, clock());
      res.cookie(name, browser, { httpOnly: true, secure: o.oauth.redirectUri.startsWith('https:'), sameSite: 'lax', path, maxAge: 600000 });
      res.json({ url: client.authorizationUrl(state) });
    } catch { fail(res, 'NOTION_UNAVAILABLE', 503); }
  });
  router.post('/callback', async (req, res) => {
    const user = who(req), { code, state, error } = req.body ?? {};
    const browser = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))?.slice(name.length + 1);
    if (!valid(state) || !valid(browser) || (!error && (typeof code !== 'string' || !code || code.length > 4096))) { fail(res, 'NOTION_STATE_INVALID'); return; }
    try {
      const consumed = await o.repo.consume({ userId: user.id, sessionId: user.sid!, state, browser }, clock());
      if (!consumed) { fail(res, 'NOTION_STATE_INVALID'); return; }
      if (error) { fail(res, 'NOTION_DENIED'); return; }
      const grant = await client.exchange(code, signal());
      const config = encryptCredentials({ accessToken: grant.accessToken, ...(grant.refreshToken ? { refreshToken: grant.refreshToken } : {}), botId: grant.botId }, o.encryptionKey);
      const row = await o.repo.save(user.id, consumed.id, { ...grant, config }, clock);
      if (!row) { fail(res, 'NOTION_STATE_INVALID'); return; }
      res.json(notionConnectionView(row));
    } catch { fail(res, 'NOTION_CONNECT_FAILED'); }
  });
  router.get('/:id/databases', async (req, res) => {
    try {
      const row = await own(req, res); if (!row) return;
      const data = await tokens.execute(who(req).id, row.id, row.identity_version, token => client.databases(token, typeof req.query.query === 'string' ? req.query.query : '', signal()));
      res.json({ ...data, identityVersion: row.identity_version });
    } catch (e) { fail(res, e instanceof NotionOAuthError && e.authenticationLost ? 'NOTION_RECONNECT_REQUIRED' : 'NOTION_LOOKUP_FAILED', 503); }
  });
  router.put('/:id/scope', async (req, res) => {
    const { identityVersion, databaseIds } = req.body ?? {};
    if (!Number.isSafeInteger(identityVersion) || identityVersion < 1 || !Array.isArray(databaseIds) || !databaseIds.length || databaseIds.length > 10 || !databaseIds.every((id: unknown) => typeof id === 'string' && NOTION_ID_PATTERN.test(id))) { fail(res, 'NOTION_SCOPE_INVALID'); return; }
    const ids = databaseIds.map(normalizeNotionId);
    if (new Set(ids).size !== ids.length) { fail(res, 'NOTION_SCOPE_INVALID'); return; }
    try {
      const row = await own(req, res); if (!row) return;
      if (row.identity_version !== identityVersion) { fail(res, 'NOTION_CONNECTION_CHANGED', 409); return; }
      await tokens.execute(who(req).id, row.id, row.identity_version, token => client.validateDatabases(token, ids, signal()));
      if (!await o.repo.selectDatabases(who(req).id, row.id, identityVersion, ids)) { fail(res, 'NOTION_CONNECTION_CHANGED', 409); return; }
      const current = (await o.repo.list(who(req).id)).find(r => r.id === row.id)!; res.json(notionConnectionView(current));
    } catch { fail(res, 'NOTION_SCOPE_INVALID'); }
  });
  router.post('/:id/check', async (req, res) => {
    try {
      const row = await own(req, res); if (!row) return;
      try { await tokens.execute(who(req).id, row.id, row.identity_version, (token, botId) => client.verify(token, botId, signal())); }
      catch (e) { if (!(e instanceof NotionOAuthError && e.authenticationLost)) throw e; }
      const current = (await o.repo.list(who(req).id)).find(r => r.id === row.id);
      if (!current) { fail(res, 'NOTION_NOT_FOUND', 404); return; } res.json(notionConnectionView(current));
    } catch { fail(res, 'NOTION_UNAVAILABLE', 503); }
  });
  router.delete('/:id', async (req, res) => {
    try {
      const row = await own(req, res); if (!row) return; let revoked = false;
      await o.repo.disconnect(who(req).id, row.id, async current => {
        try { const token = decryptCredentials(current.config!, o.encryptionKey).accessToken; if (typeof token === 'string') { await client.revoke(token, signal()); revoked = true; } } catch { /* Local removal remains complete. */ }
      }); res.json({ success: true, revoked });
    } catch { fail(res, 'NOTION_UNAVAILABLE', 503); }
  });
  return router;
}
