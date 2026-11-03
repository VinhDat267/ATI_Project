import { Router, type Request, type Response } from 'express';
import { randomBytes } from 'node:crypto';
import { decryptCredentials, encryptCredentials } from '@wap/tool-adapters';
import { createAuthMiddleware, type AuthUser } from '../../auth/jwt.js';
import type { NotionOAuthConfig } from '../../config/notion-env.js';
import type { GoogleAuthRepo } from '../../db/repositories/google-auth-repo.js';
import {
  NotionConnectionRepo,
  type NotionConnectionRow,
} from '../../db/repositories/notion-connection-repo.js';
import type { SessionRepo } from '../../db/repositories/session-repo.js';
import {
  extractNotionDatabaseId,
  NotionOAuthClient,
  NotionOAuthError,
} from '../../services/notion/oauth-client.js';
import { NotionTokenManager } from '../../services/notion/token-manager.js';

const NOTION_BROWSER_COOKIE = 'ati_notion_browser';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONVERSATION_PATH = /^\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const random = () => randomBytes(32).toString('base64url');
const validToken = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{32,64}$/.test(v);

export interface NotionConnectionsOptions {
  jwtSecret: string;
  encryptionKey?: string;
  sessionRepo?: SessionRepo;
  states?: GoogleAuthRepo;
  repo?: NotionConnectionRepo;
  oauth?: NotionOAuthConfig;
  tokens?: NotionTokenManager;
  fetchFn?: typeof fetch;
  clock?: () => number;
  notionTimeoutMs?: number;
  revokeTimeoutMs?: number;
  onConnectionChanged?: (userId: string) => void;
  conversationOwner?: (conversationId: string) => Promise<string | null>;
}

export function isNotionConnectAvailable(options: NotionConnectionsOptions): boolean {
  return Boolean(
    options.oauth &&
      options.oauth.clientId &&
      options.oauth.clientSecret &&
      options.oauth.redirectUri &&
      options.repo &&
      options.encryptionKey,
  );
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function setBrowserCookie(res: Response, value: string, redirectUri: string): void {
  const secure = redirectUri.startsWith('https://') ? '; Secure' : '';
  res.append(
    'Set-Cookie',
    `${NOTION_BROWSER_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure}`,
  );
}

function clearBrowserCookie(res: Response, redirectUri: string): void {
  const secure = redirectUri.startsWith('https://') ? '; Secure' : '';
  res.append(
    'Set-Cookie',
    `${NOTION_BROWSER_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
  );
}

async function resolveReturnTo(
  raw: unknown,
  userId: string,
  conversationOwner?: (conversationId: string) => Promise<string | null>,
): Promise<{ ok: true; value: string | null } | { ok: false }> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  let convId: string | undefined;
  if (typeof raw === 'string') {
    convId = CONVERSATION_PATH.exec(raw.trim())?.[1]?.toLowerCase();
  } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const rec = raw as Record<string, unknown>;
    if (rec.kind === 'chat' && typeof rec.conversationId === 'string' && UUID_PATTERN.test(rec.conversationId.trim())) {
      convId = rec.conversationId.trim().toLowerCase();
    }
  }
  if (!convId || !conversationOwner) return { ok: false };
  const owner = await conversationOwner(convId);
  if (owner !== userId) return { ok: false };
  return { ok: true, value: `/c/${convId}` };
}

export function notionConnectionView(row: NotionConnectionRow) {
  const toolsAvailable = row.status === 'active' && row.allowed_databases.length > 0;
  const status =
    row.status === 'active'
      ? toolsAvailable
        ? ('connected' as const)
        : ('scope_required' as const)
      : row.status;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    actorId: row.actor_id,
    botId: row.bot_id,
    identityVersion: row.identity_version,
    status,
    allowedDatabases: row.allowed_databases,
    selectedDatabases: row.selected_databases ?? [],
    isDefault: Boolean(row.is_default),
    isActive: Boolean(row.is_default),
    toolsAvailable,
    connectedAt: row.connected_at,
  };
}

export function createNotionConnectionRoutes(options: NotionConnectionsOptions): Router {
  const router = Router();
  const clock = options.clock ?? Date.now;
  const requireAuth = createAuthMiddleware(options.jwtSecret, {
    sessionRepo: options.sessionRepo,
    clock,
  });
  const timeoutMs = options.notionTimeoutMs ?? 10_000;
  const revokeTimeoutMs = options.revokeTimeoutMs ?? 3_000;
  const client = options.oauth ? new NotionOAuthClient(options.oauth, options.fetchFn) : undefined;
  const tokens =
    options.tokens ??
    (options.repo && client && options.encryptionKey
      ? new NotionTokenManager(options.repo, client, options.encryptionKey, options.onConnectionChanged)
      : undefined);

  router.use(requireAuth, (req, res, next) => {
    if (!isNotionConnectAvailable(options) || !client || !tokens) {
      if (req.method === 'GET' && (req.path === '/' || req.path === '')) {
        res.status(200).json({
          available: false,
          status: 'unconfigured',
          toolsAvailable: false,
          connections: [],
          activeConnection: null,
          selectedDatabases: [],
          databases: [],
        });
        return;
      }
      res.status(503).json({ error: 'Kết nối Notion cá nhân chưa được cấu hình.' });
      return;
    }
    if (!(req as any).user?.sid) {
      res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ.', code: 'INVALID_SESSION' });
      return;
    }
    next();
  });

  router.get('/', async (req: Request, res: Response) => {
    const user = (req as any).user as AuthUser;
    const rows = await options.repo!.list(user.id);
    const connections = rows.map(notionConnectionView);
    const activeConnection = connections.find((c) => c.isDefault) ?? connections[0] ?? null;
    res.status(200).json({
      available: true,
      status: activeConnection ? activeConnection.status : 'disconnected',
      toolsAvailable: Boolean(activeConnection?.toolsAvailable),
      activeConnectionId: activeConnection?.id,
      workspaceId: activeConnection?.workspaceId,
      workspaceName: activeConnection?.workspaceName,
      botId: activeConnection?.botId,
      selectedDatabases: activeConnection?.selectedDatabases ?? [],
      connections,
      activeConnection,
      databases: activeConnection?.selectedDatabases ?? [],
    });
  });

  router.post('/start', async (req: Request, res: Response) => {
    const user = (req as any).user as AuthUser;
    const parsedReturnTo = await resolveReturnTo(
      req.body?.returnTo,
      user.id,
      options.conversationOwner,
    );
    if (!parsedReturnTo.ok) {
      res.status(400).json({
        error: 'Không mở được kết nối từ hội thoại này.',
        code: 'RETURN_TO_INVALID',
      });
      return;
    }
    const state = random();
    const existingBrowser = readCookie(req, NOTION_BROWSER_COOKIE);
    const browser = validToken(existingBrowser) ? existingBrowser : random();
    await options.repo!.start(
      {
        userId: user.id,
        sessionId: user.sid!,
        stateHash: NotionConnectionRepo.hash(state),
        browserHash: NotionConnectionRepo.hash(browser),
        returnTo: parsedReturnTo.value,
      },
      clock(),
    );
    setBrowserCookie(res, browser, options.oauth!.redirectUri);
    const url = client!.authorizationUrl(state);
    res.status(200).json({ url, authorizationUrl: url });
  });

  router.post('/callback', async (req: Request, res: Response) => {
    const user = (req as any).user as AuthUser;
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    const state = typeof req.body?.state === 'string' ? req.body.state.trim() : '';
    const browser = readCookie(req, NOTION_BROWSER_COOKIE);
    if (!code || !state || !browser) {
      res.status(400).json({
        error: 'Phiên xác thực Notion không hợp lệ hoặc đã hết hạn.',
        code: 'NOTION_STATE_INVALID',
      });
      return;
    }
    const consumed = await options.repo!.consume(
      {
        userId: user.id,
        sessionId: user.sid!,
        state,
        browser,
      },
      clock(),
    );
    clearBrowserCookie(res, options.oauth!.redirectUri);
    if (!consumed) {
      res.status(400).json({
        error: 'Phiên xác thực Notion không hợp lệ hoặc đã hết hạn.',
        code: 'NOTION_STATE_INVALID',
      });
      return;
    }
    try {
      const grant = await client!.exchange(code, AbortSignal.timeout(timeoutMs));
      let row = await options.repo!.save(
        user.id,
        consumed.id,
        {
          appId: grant.appId,
          workspaceId: grant.workspaceId,
          workspaceName: grant.workspaceName,
          actorId: grant.actorId,
          botId: grant.botId,
          config: encryptCredentials(
            {
              accessToken: grant.accessToken,
              refreshToken: grant.refreshToken,
              botId: grant.botId,
            },
            options.encryptionKey!,
          ),
          scopes: grant.scopes,
        },
        clock,
      );
      if (!row) {
        res.status(401).json({
          error: 'Phiên đăng nhập không còn hợp lệ.',
          code: 'INVALID_SESSION',
        });
        return;
      }
      if (row.allowed_databases.length === 0) {
        try {
          const discovered = await client!.databases(grant.accessToken, '', AbortSignal.timeout(timeoutMs));
          if (discovered.databases.length >= 1 && discovered.databases.length <= 10 && !discovered.hasMore) {
            const autoScoped = await options.repo!.selectDatabases(
              user.id,
              row.id,
              row.identity_version,
              discovered.databases,
            );
            if (autoScoped) {
              const refreshed = await options.repo!.getActive(user.id, row.id);
              if (refreshed) row = refreshed;
            }
          }
        } catch {
          // Keep scope_required if auto-discovery fails transiently
        }
      }
      options.onConnectionChanged?.(user.id);
      res.status(200).json({
        ...notionConnectionView(row),
        ...(consumed.returnTo ? { returnTo: consumed.returnTo } : {}),
      });
    } catch (err: any) {
      const conflict = err?.message === 'NOTION_IDENTITY_CONFLICT' || err?.code === 'NOTION_IDENTITY_OWNED';
      res.status(conflict ? 409 : 400).json({
        error: conflict
          ? 'Workspace Notion này đã được liên kết với một tài khoản khác.'
          : err?.message || 'Không kết nối được Notion.',
        code: conflict ? 'NOTION_IDENTITY_CONFLICT' : 'NOTION_CONNECT_FAILED',
      });
    }
  });

  router.get('/:id/databases', async (req: Request, res: Response) => {
    const user = (req as any).user as AuthUser;
    const id = String(req.params.id ?? '');
    if (!UUID_PATTERN.test(id)) {
      res.status(404).json({ error: 'Không tìm thấy kết nối Notion.' });
      return;
    }
    const row = await options.repo!.getActive(user.id, id);
    if (!row) {
      res.status(404).json({ error: 'Không tìm thấy kết nối Notion.' });
      return;
    }
    const query = typeof req.query.query === 'string' ? req.query.query.slice(0, 120) : '';
    try {
      const result = await tokens!.execute(
        user.id,
        row.id,
        row.identity_version,
        (accessToken) => client!.databases(accessToken, query, AbortSignal.timeout(timeoutMs)),
      );
      res.status(200).json({
        databases: result.databases,
        selectedDatabases: row.selected_databases ?? [],
        allowedDatabases: row.allowed_databases,
        hasMore: result.hasMore,
      });
    } catch (err) {
      const status = err instanceof NotionOAuthError && err.authenticationLost ? 409 : 502;
      res.status(status).json({
        error: err instanceof Error ? err.message : 'Không tải được danh sách database Notion.',
      });
    }
  });

  router.put('/:id/scope', async (req: Request, res: Response) => {
    const user = (req as any).user as AuthUser;
    const id = String(req.params.id ?? '');
    if (!UUID_PATTERN.test(id)) {
      res.status(404).json({ error: 'Không tìm thấy kết nối Notion.' });
      return;
    }
    const rawIds = Array.isArray(req.body?.databaseIds)
      ? req.body.databaseIds
      : req.body?.databases;
    if (!Array.isArray(rawIds) || rawIds.length === 0 || rawIds.length > 10) {
      res.status(400).json({ error: 'Chọn từ 1 đến 10 database Notion hợp lệ.' });
      return;
    }
    const parsedIds: string[] = [];
    for (const rawItem of rawIds) {
      const candidate =
        typeof rawItem === 'string'
          ? rawItem
          : rawItem && typeof rawItem === 'object'
            ? ((rawItem as Record<string, unknown>).id ?? (rawItem as Record<string, unknown>).url)
            : undefined;
      const parsed = extractNotionDatabaseId(candidate);
      if (!parsed) {
        res.status(400).json({ error: 'Chọn từ 1 đến 10 database Notion hợp lệ.' });
        return;
      }
      if (!parsedIds.includes(parsed)) {
        parsedIds.push(parsed);
      }
    }
    if (parsedIds.length === 0 || parsedIds.length > 10) {
      res.status(400).json({ error: 'Chọn từ 1 đến 10 database Notion hợp lệ.' });
      return;
    }
    const row = await options.repo!.getActive(user.id, id);
    if (!row) {
      res.status(404).json({ error: 'Không tìm thấy kết nối Notion.' });
      return;
    }
    const expectedVersion = Number.isInteger(req.body?.identityVersion)
      ? Number(req.body.identityVersion)
      : row.identity_version;
    try {
      const verified = await tokens!.execute(
        user.id,
        row.id,
        expectedVersion,
        (accessToken) =>
          client!.validateDatabases(accessToken, parsedIds, AbortSignal.timeout(timeoutMs)),
      );
      const ok = await options.repo!.selectDatabases(user.id, row.id, expectedVersion, verified);
      const updated = ok ? await options.repo!.getActive(user.id, row.id) : null;
      if (!updated) {
        res.status(409).json({
          error: 'Kết nối Notion vừa thay đổi. Vui lòng chọn lại phạm vi database.',
        });
        return;
      }
      options.onConnectionChanged?.(user.id);
      res.status(200).json({ ...notionConnectionView(updated), databases: verified });
    } catch (err) {
      const status = err instanceof NotionOAuthError && err.authenticationLost ? 409 : 400;
      res.status(status).json({
        error: err instanceof Error ? err.message : 'Database Notion không hợp lệ.',
      });
    }
  });

  router.post('/:id/activate', async (req: Request, res: Response) => {
    const user = (req as any).user as AuthUser;
    const id = String(req.params.id ?? '');
    if (!UUID_PATTERN.test(id)) {
      res.status(404).json({ error: 'Không tìm thấy kết nối Notion.' });
      return;
    }
    const ok = await options.repo!.setActiveWorkspace(user.id, id);
    const updated = ok ? await options.repo!.getActive(user.id, id) : null;
    if (!updated) {
      res.status(404).json({ error: 'Không tìm thấy kết nối Notion.' });
      return;
    }
    options.onConnectionChanged?.(user.id);
    res.status(200).json(notionConnectionView(updated));
  });

  router.post('/:id/check', async (req: Request, res: Response) => {
    const user = (req as any).user as AuthUser;
    const id = String(req.params.id ?? '');
    if (!UUID_PATTERN.test(id)) {
      res.status(404).json({ error: 'Không tìm thấy kết nối Notion.' });
      return;
    }
    const row = await options.repo!.getActive(user.id, id);
    if (!row) {
      res.status(404).json({ error: 'Không tìm thấy kết nối Notion.' });
      return;
    }
    const startedAt = clock();
    try {
      await tokens!.execute(user.id, row.id, row.identity_version, (accessToken, botId) =>
        client!.verify(accessToken, botId, AbortSignal.timeout(timeoutMs)),
      );
      const latest = await options.repo!.getActive(user.id, row.id);
      const latencyMs = Math.max(0, clock() - startedAt);
      res.status(200).json({
        ...notionConnectionView(latest ?? row),
        healthStatus: 'healthy',
        latencyMs,
      });
    } catch (err) {
      const latest = await options.repo!.getActive(user.id, row.id);
      res.status(409).json({
        error: err instanceof Error ? err.message : 'Kết nối Notion cần kết nối lại.',
        ...(latest ? notionConnectionView(latest) : {}),
      });
    }
  });

  router.delete('/:id', async (req: Request, res: Response) => {
    const user = (req as any).user as AuthUser;
    const id = String(req.params.id ?? '');
    if (!UUID_PATTERN.test(id)) {
      res.status(404).json({ error: 'Không tìm thấy kết nối Notion.' });
      return;
    }
    await options.repo!.disconnect(user.id, id, async (row) => {
      if (!row.config) return;
      const cfg = decryptCredentials(row.config, options.encryptionKey!);
      await client!.revoke(cfg.accessToken, AbortSignal.timeout(revokeTimeoutMs));
    });
    options.onConnectionChanged?.(user.id);
    res.status(200).json({ disconnected: true, status: 'disconnected', toolsAvailable: false });
  });

  return router;
}
