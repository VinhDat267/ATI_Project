import { Router, type Request, type Response } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import type {
  JiraOAuthCallbackResponse,
  JiraSyncSitesResponse,
  JiraDisconnectResponse,
} from '@wap/tool-schemas';
import { createAuthMiddleware, type AuthUser } from '../../auth/jwt.js';
import type { GoogleAuthRepo } from '../../db/repositories/google-auth-repo.js';
import type { SessionRepo } from '../../db/repositories/session-repo.js';
import type { JiraOAuthRepo } from '../../db/repositories/jira-oauth-repo.js';
import type {
  JiraOAuthClient,
  JiraTokensResult,
  JiraProfileResult,
} from '../../services/jira/jira-oauth-client.js';
import type { JiraTokenManager } from '../../services/jira/jira-token-manager.js';

const COOKIE = 'ati_jira_browser';
const COOKIE_PATH = '/api/connections/myjira';
const random = () => randomBytes(32).toString('base64url');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const valid = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);

function binding(req: Request): string | undefined {
  return req.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
}

const CONVERSATION_PATH =
  /^\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export interface MyJiraConnectionsOptions {
  jwtSecret: string;
  sessionRepo?: SessionRepo;
  states?: GoogleAuthRepo;
  repo?: JiraOAuthRepo;
  client?: JiraOAuthClient;
  tokens?: JiraTokenManager;
  clock?: () => number;
  jiraTimeoutMs?: number;
  onConnectionChanged?: (userId: string) => void;
  conversationOwner?: (conversationId: string) => Promise<string | null>;
  enabled?: boolean;
}

export function isMyJiraAvailable(
  options: Pick<
    MyJiraConnectionsOptions,
    'client' | 'repo' | 'states' | 'sessionRepo' | 'tokens' | 'enabled'
  >
): boolean {
  return Boolean(
    options.enabled !== false &&
      options.client &&
      options.repo &&
      options.states &&
      options.sessionRepo &&
      options.tokens
  );
}

/** Mounted only when MYJIRA_ENABLED=on; every route requires caller's live session. */
export function createMyJiraConnectionRoutes(options: MyJiraConnectionsOptions): Router {
  const router = Router();
  const clock = options.clock ?? Date.now;
  const jiraTimeoutMs = options.jiraTimeoutMs ?? 10_000;
  const auth = createAuthMiddleware(options.jwtSecret, { sessionRepo: options.sessionRepo, clock });

  router.use((_req, res, next) => {
    const json = res.json.bind(res);
    res.json = (body: any) =>
      json(
        res.statusCode === 401 && body && typeof body === 'object' && !body.code
          ? { ...body, code: 'INVALID_SESSION' }
          : body
      );
    if (!isMyJiraAvailable(options)) {
      res.status(503).json({ error: 'Kết nối Jira chưa sẵn sàng.' });
      return;
    }
    next();
  });

  router.use(auth);

  router.use((req, res, next) => {
    if (!(req as any).user?.sid) {
      res.status(401).json({ error: 'Phiên đăng nhập không còn hợp lệ.', code: 'INVALID_SESSION' });
      return;
    }
    next();
  });

  const ownConversation = async (value: unknown, userId: string): Promise<string | null> => {
    const id = typeof value === 'string' ? CONVERSATION_PATH.exec(value)?.[1]?.toLowerCase() : undefined;
    if (!id || !options.conversationOwner) return null;
    return (await options.conversationOwner(id)) === userId ? `/c/${id}` : null;
  };

  router.post('/start', async (req, res) => {
    const user = (req as any).user as AuthUser;
    try {
      const mode = req.body?.mode;
      if (mode !== 'identity' && mode !== 'authorize_sites') {
        res.status(400).json({ error: 'Chế độ kết nối không hợp lệ.', code: 'INVALID_MODE' });
        return;
      }

      let returnTo: string | null = null;
      if (req.body?.returnTo !== undefined) {
        returnTo = await ownConversation(req.body.returnTo, user.id);
        if (!returnTo) {
          res.status(400).json({ error: 'Không mở được kết nối từ hội thoại này.', code: 'RETURN_TO_INVALID' });
          return;
        }
      }

      const state = random();
      const verifier = random();
      const nonce = random();
      const browser = valid(binding(req)) ? binding(req)! : random();
      const stateMode = mode === 'identity' ? 'connect_jira_identity' : 'connect_jira_sites';

      await options.states!.createState(
        {
          state_hash: hash(state),
          browser_binding_hash: hash(browser),
          code_verifier: verifier,
          nonce,
          mode: stateMode,
          user_id: user.id,
          session_id: user.sid!,
          return_to: returnTo,
        },
        clock()
      );

      const authUrl = options.client!.authorizationUrl({
        state,
        mode,
      });

      res.cookie(COOKIE, browser, {
        httpOnly: true,
        sameSite: 'lax',
        secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
        maxAge: 600_000,
        path: COOKIE_PATH,
      });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ authUrl });
    } catch {
      res.status(500).json({ error: 'Không bắt đầu được kết nối Jira.' });
    }
  });

  router.post('/callback', async (req, res) => {
    const user = (req as any).user as AuthUser;
    const state = req.body?.state;
    const code = req.body?.code;
    const browser = binding(req);
    res.setHeader('Cache-Control', 'no-store');

    if (!valid(state) || !valid(browser) || typeof code !== 'string' || !code || code.length > 4096) {
      res.status(400).json({
        error: 'Yêu cầu kết nối Jira đã hết hạn hoặc không còn hợp lệ. Hãy bấm "Kết nối Jira" lại.',
        code: 'JIRA_STATE_INVALID',
      });
      return;
    }

    try {
      const consumed = await options.states!.consumeState(
        state,
        browser,
        clock(),
        ['connect_jira_identity', 'connect_jira_sites'],
        user.id,
        user.sid
      );
      if (!consumed?.id) {
        res.status(400).json({
          error: 'Yêu cầu kết nối Jira đã hết hạn hoặc không còn hợp lệ. Hãy bấm "Kết nối Jira" lại.',
          code: 'JIRA_STATE_INVALID',
        });
        return;
      }

      let tokens: JiraTokensResult;
      try {
        tokens = await options.client!.exchangeCode(code, AbortSignal.timeout(jiraTimeoutMs));
      } catch {
        res.status(400).json({
          error: 'Không thể xác thực mã từ Atlassian. Vui lòng thử lại.',
          code: 'JIRA_CONNECT_FAILED',
        });
        return;
      }

      let profile: JiraProfileResult;
      try {
        profile = await options.client!.getProfile(tokens.accessToken, AbortSignal.timeout(jiraTimeoutMs));
      } catch {
        res.status(400).json({
          error: 'Không thể lấy thông tin tài khoản Atlassian. Vui lòng thử lại.',
          code: 'JIRA_CONNECT_FAILED',
        });
        return;
      }

      if (consumed.mode === 'connect_jira_identity') {
        try {
          const result = await options.repo!.saveIdentityGrant(user.id, {
            atlassianAccountId: profile.accountId,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresInSeconds: tokens.expiresInSeconds,
            scopes: tokens.scopes,
          });
          options.onConnectionChanged?.(user.id);
      res.clearCookie(COOKIE, { path: COOKIE_PATH });
          const responseBody: JiraOAuthCallbackResponse & { returnTo?: string } = {
            connected: true,
            connectionState: result.connectionState,
            jiraAccountId: result.accountId,
            atlassianAccountId: profile.accountId,
            siteCount: 0,
            ...(consumed.return_to ? { returnTo: consumed.return_to } : {}),
          };
          res.json(responseBody);
          return;
        } catch (err: any) {
          if (err?.code === 'ATLASSIAN_ACCOUNT_IN_USE') {
            res.status(409).json({
              error: 'Tài khoản Atlassian này đã được liên kết với một tài khoản người dùng khác.',
              code: 'ATLASSIAN_ACCOUNT_IN_USE',
            });
            return;
          }
          if (err?.code === 'ACCOUNT_CHANGED') {
            res.status(409).json({
              error: 'Không thể đổi tài khoản Atlassian khi chưa ngắt kết nối tài khoản cũ.',
              code: 'ACCOUNT_CHANGED',
            });
            return;
          }
          res.status(400).json({
            error: 'Không thể lưu kết nối danh tính Jira.',
            code: 'JIRA_CONNECT_FAILED',
          });
          return;
        }
      } else {
        // connect_jira_sites
        try {
          const sites = await options.client!.getAccessibleResources(
            tokens.accessToken,
            AbortSignal.timeout(jiraTimeoutMs)
          );

          const result = await options.repo!.saveSitesGrant(user.id, {
            atlassianAccountId: profile.accountId,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresInSeconds: tokens.expiresInSeconds,
            scopes: tokens.scopes,
            sites,
          });
          options.onConnectionChanged?.(user.id);
      res.clearCookie(COOKIE, { path: COOKIE_PATH });
          const responseBody: JiraOAuthCallbackResponse & { returnTo?: string } = {
            connected: true,
            connectionState: result.connectionState,
            jiraAccountId: result.accountId,
            atlassianAccountId: profile.accountId,
            siteCount: result.siteCount,
            ...(consumed.return_to ? { returnTo: consumed.return_to } : {}),
          };
          res.json(responseBody);
          return;
        } catch (err: any) {
          if (err?.code === 'ACCOUNT_CHANGED') {
            res.status(409).json({
              error: 'Tài khoản Atlassian được cấp quyền không khớp với danh tính đã kết nối.',
              code: 'ACCOUNT_CHANGED',
            });
            return;
          }
          if (err?.code === 'ACCOUNT_NOT_CONNECTED') {
            res.status(403).json({
              error: 'Chưa có kết nối danh tính Atlassian.',
              code: 'ACCOUNT_NOT_CONNECTED',
            });
            return;
          }
          res.status(400).json({
            error: 'Không thể lưu quyền Jira site.',
            code: 'JIRA_CONNECT_FAILED',
          });
          return;
        }
      }
    } catch {
      res.status(400).json({
        error: 'Không kết nối được Jira. Vui lòng thử lại.',
        code: 'JIRA_CONNECT_FAILED',
      });
    }
  });

  router.get('/', async (req, res) => {
    const user = (req as any).user as AuthUser;
    try {
      const status = await options.repo!.getConnectionStatus(user.id);
      res.json(status);
    } catch {
      res.status(500).json({ error: 'Không thể lấy trạng thái kết nối Jira.' });
    }
  });

  router.post('/sync-sites', async (req, res) => {
    const user = (req as any).user as AuthUser;
    try {
      const accessToken = await options.tokens!.getAccessToken(user.id, {
        signal: AbortSignal.timeout(jiraTimeoutMs),
      });
      const sites = await options.client!.getAccessibleResources(
        accessToken,
        AbortSignal.timeout(jiraTimeoutMs)
      );
      const syncedCount = await options.repo!.syncSites(user.id, sites);
      options.onConnectionChanged?.(user.id);
      res.clearCookie(COOKIE, { path: COOKIE_PATH });
      const response: JiraSyncSitesResponse = {
        syncedCount,
        sites: sites.map((s) => ({ cloudId: s.id, name: s.name, url: s.url })),
      };
      res.json(response);
    } catch (err: any) {
      if (
        err?.code === 'ACCOUNT_NOT_CONNECTED' ||
        err?.code === 'ACCOUNT_NOT_FOUND' ||
        err?.code === 'ACCOUNT_DISCONNECTED' ||
        err?.code === 'GRANT_REVOKED' ||
        err?.code === 'RECONNECT_REQUIRED' ||
        err?.statusCode === 403 ||
        err?.statusCode === 404
      ) {
        res.status(err?.statusCode ?? 403).json({
          error: 'Chưa có kết nối Jira hoạt động.',
          code: 'NOT_CONNECTED',
        });
        return;
      }
      res.status(500).json({ error: 'Không thể đồng bộ Jira sites.', code: 'SYNC_FAILED' });
    }
  });

  router.delete('/', async (req, res) => {
    const user = (req as any).user as AuthUser;
    try {
      const result = await options.repo!.disconnect(user.id);
      options.tokens?.clear(user.id);
      options.onConnectionChanged?.(user.id);
      res.clearCookie(COOKIE, { path: COOKIE_PATH });
      const response: JiraDisconnectResponse = {
        disconnected: result.disconnected,
        revokedAt: result.revokedAt.toISOString(),
        identityVersion: result.identityVersion,
      };
      res.json(response);
    } catch {
      res.status(500).json({ error: 'Không thể ngắt kết nối Jira.' });
    }
  });

  return router;
}
