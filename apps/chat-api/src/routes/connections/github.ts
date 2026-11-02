import { Router, type Request, type Response } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { decryptCredentials, encryptCredentials } from '@wap/tool-adapters';
import { createAuthMiddleware, isAdmin, type AuthUser } from '../../auth/jwt.js';
import type { GitHubOAuthConfig } from '../../config/env.js';
import type { CredentialRepo } from '../../db/repositories/credential-repo.js';
import type { GoogleAuthRepo } from '../../db/repositories/google-auth-repo.js';
import type { SessionRepo } from '../../db/repositories/session-repo.js';
import {
  isValidGitHubRepoFullName,
  type GitHubTeamRepo,
  type GitHubTeamRepoItem,
} from '../../db/repositories/github-team-repo.js';
import {
  GitHubOAuthClient,
  GitHubOAuthError,
  type GitHubRepoSummary,
} from '../../services/github/oauth-client.js';
import type { GitHubTokenManager } from '../../services/github/token-manager.js';

const COOKIE = 'ati_github_browser';
const COOKIE_PATH = '/api/connections/github';
const random = () => randomBytes(32).toString('base64url');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const valid = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);

function binding(req: Request): string | undefined {
  return req.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
}

const CONVERSATION_PATH = /^\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export interface GitHubConnectionsOptions {
  jwtSecret: string;
  sessionRepo?: SessionRepo;
  states?: GoogleAuthRepo;
  credentialRepo?: CredentialRepo;
  teamRepo?: GitHubTeamRepo;
  oauth?: GitHubOAuthConfig;
  encryptionKey?: string;
  fetchFn?: typeof fetch;
  clock?: () => number;
  githubTimeoutMs?: number;
  onConnectionChanged?: (userId: string) => void;
  conversationOwner?: (conversationId: string) => Promise<string | null>;
  tokens?: Pick<GitHubTokenManager, 'forConnection'>;
  adminUserIds?: string[];
}

export function isGitHubConnectAvailable(
  options: Pick<
    GitHubConnectionsOptions,
    'oauth' | 'states' | 'sessionRepo' | 'credentialRepo' | 'encryptionKey'
  >
): boolean {
  return Boolean(
    options.oauth &&
      options.oauth.clientId &&
      options.oauth.clientSecret &&
      options.oauth.redirectUri &&
      options.states &&
      options.sessionRepo &&
      options.credentialRepo &&
      options.encryptionKey
  );
}

export function createGitHubConnectionRoutes(options: GitHubConnectionsOptions): Router {
  const router = Router();
  const clock = options.clock ?? Date.now;
  const githubTimeoutMs = options.githubTimeoutMs ?? 10_000;
  const client = options.oauth ? new GitHubOAuthClient(options.oauth, options.fetchFn) : undefined;
  const auth = createAuthMiddleware(options.jwtSecret, { sessionRepo: options.sessionRepo, clock });

  router.use((_req, res, next) => {
    const json = res.json.bind(res);
    res.json = (body: any) =>
      json(
        res.statusCode === 401 && body && typeof body === 'object' && !body.code
          ? { ...body, code: 'INVALID_SESSION' }
          : body
      );
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

  router.use((req, res, next) => {
    if (!isGitHubConnectAvailable(options)) {
      if (req.method === 'GET' && (req.path === '/' || req.path === '')) {
        res.json({ status: 'unconfigured', repos: [] });
        return;
      }
      res.status(503).json({ error: 'GitHub chưa được cấu hình trên máy chủ.' });
      return;
    }
    next();
  });

  const fail = (
    res: Response,
    code: 'GITHUB_STATE_INVALID' | 'GITHUB_CONNECT_FAILED'
  ) => {
    const messages = {
      GITHUB_STATE_INVALID:
        'Yêu cầu kết nối GitHub đã hết hạn hoặc không còn hợp lệ. Hãy bấm "Kết nối GitHub" lại.',
      GITHUB_CONNECT_FAILED: 'Không kết nối được GitHub. Vui lòng thử lại.',
    };
    res.status(400).json({ error: messages[code], code });
  };

  const ownConversation = async (value: unknown, userId: string): Promise<string | null> => {
    const id = typeof value === 'string' ? CONVERSATION_PATH.exec(value)?.[1]?.toLowerCase() : undefined;
    if (!id || !options.conversationOwner) return null;
    return (await options.conversationOwner(id)) === userId ? `/c/${id}` : null;
  };

  const resolveAccessToken = async (
    userId: string,
    credentialId: string,
    decrypted: Record<string, any>
  ): Promise<string> => {
    if (options.tokens) {
      const provider = options.tokens.forConnection(userId, credentialId, {
        accessToken: typeof decrypted.accessToken === 'string' ? decrypted.accessToken : undefined,
        refreshToken: typeof decrypted.refreshToken === 'string' ? decrypted.refreshToken : undefined,
      });
      return provider.getAccessToken({ signal: AbortSignal.timeout(githubTimeoutMs) });
    }
    if (typeof decrypted.accessToken === 'string' && decrypted.accessToken.trim()) {
      return decrypted.accessToken.trim();
    }
    throw new Error('Missing GitHub access token');
  };

  router.post('/start', async (req, res) => {
    const user = (req as any).user as AuthUser;
    try {
      let returnTo: string | null = null;
      if (req.body?.returnTo !== undefined) {
        returnTo = await ownConversation(req.body.returnTo, user.id);
        if (!returnTo) {
          res.status(400).json({
            error: 'Không mở được kết nối từ hội thoại này.',
            code: 'RETURN_TO_INVALID',
          });
          return;
        }
      }

      const state = random();
      const verifier = random();
      const browser = valid(binding(req)) ? binding(req)! : random();

      await options.states!.createState(
        {
          state_hash: hash(state),
          browser_binding_hash: hash(browser),
          code_verifier: verifier,
          nonce: random(),
          mode: 'connect_github',
          user_id: user.id,
          session_id: user.sid!,
          return_to: returnTo,
        },
        clock()
      );

      const codeChallenge = createHash('sha256').update(verifier).digest('base64url');
      const url = client!.authorizationUrl({ state, codeChallenge });

      res.cookie(COOKIE, browser, {
        httpOnly: true,
        sameSite: 'lax',
        secure: options.oauth?.redirectUri ? new URL(options.oauth.redirectUri).protocol === 'https:' : false,
        maxAge: 600_000,
        path: COOKIE_PATH,
      });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ url });
    } catch {
      res.status(500).json({ error: 'Không bắt đầu được kết nối GitHub.' });
    }
  });

  router.post('/callback', async (req, res) => {
    const user = (req as any).user as AuthUser;
    const state = req.body?.state;
    const code = req.body?.code;
    const browser = binding(req);
    res.setHeader('Cache-Control', 'no-store');

    if (!valid(state) || !valid(browser) || typeof code !== 'string' || !code || code.length > 4096) {
      fail(res, 'GITHUB_STATE_INVALID');
      return;
    }

    try {
      const consumed = await options.states!.consumeState(
        state,
        browser,
        clock(),
        ['connect_github'],
        user.id,
        user.sid
      );
      if (!consumed?.id) {
        fail(res, 'GITHUB_STATE_INVALID');
        return;
      }

      let tokens;
      try {
        tokens = await client!.exchangeCode(code, consumed.code_verifier, AbortSignal.timeout(githubTimeoutMs));
      } catch {
        fail(res, 'GITHUB_CONNECT_FAILED');
        return;
      }

      let ghUser;
      try {
        ghUser = await client!.user(tokens.accessToken, AbortSignal.timeout(githubTimeoutMs));
      } catch {
        fail(res, 'GITHUB_CONNECT_FAILED');
        return;
      }

      const now = clock();
      const config = encryptCredentials(
        {
          accessToken: tokens.accessToken,
          ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
          login: ghUser.login,
          githubUserId: ghUser.id,
          connectedAt: new Date(now).toISOString(),
        },
        options.encryptionKey!
      );

      await options.credentialRepo!.saveCredentials('github', config, user.id);

      options.onConnectionChanged?.(user.id);
      res.json({
        login: ghUser.login,
        ...(consumed.return_to ? { returnTo: consumed.return_to } : {}),
      });
    } catch {
      fail(res, 'GITHUB_CONNECT_FAILED');
    }
  });

  router.delete('/', async (req, res) => {
    const user = (req as any).user as AuthUser;
    try {
      await options.credentialRepo!.deleteCredentials('github', user.id);
      options.onConnectionChanged?.(user.id);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: 'Không ngắt được kết nối GitHub. Vui lòng thử lại.' });
    }
  });

  router.get('/candidate-repos', async (req, res) => {
    const user = (req as any).user as AuthUser;
    if (!isAdmin(user, options.adminUserIds)) {
      res.status(403).json({ error: 'Chỉ quản trị viên mới có quyền chọn repository GitHub cho nhóm.' });
      return;
    }

    try {
      const cred = await options.credentialRepo!.getPersonalConnectionStatus('github', user.id);
      if (!cred || cred.status !== 'active') {
        res.status(400).json({ error: 'Quản trị viên cần kết nối tài khoản GitHub trước.' });
        return;
      }

      let dec: Record<string, any>;
      try {
        dec = decryptCredentials(cred.config, options.encryptionKey!);
      } catch {
        res.status(400).json({ error: 'Không đọc được thông tin xác thực GitHub.' });
        return;
      }

      if (!client) {
        res.status(503).json({ error: 'Dịch vụ GitHub chưa sẵn sàng.' });
        return;
      }

      const accessToken = await resolveAccessToken(user.id, cred.id, dec);
      const rawRepos = await client.repos(accessToken, AbortSignal.timeout(githubTimeoutMs));
      res.json({
        repos: rawRepos.map((r) => ({
          repoId: r.id,
          fullName: r.fullName,
          name: r.name,
          private: r.private,
        })),
      });
    } catch {
      res.status(500).json({ error: 'Không tải được danh sách repository GitHub.' });
    }
  });

  router.put('/scope', async (req, res) => {
    const user = (req as any).user as AuthUser;
    if (!isAdmin(user, options.adminUserIds)) {
      res.status(403).json({ error: 'Chỉ quản trị viên mới có quyền chọn repository GitHub cho nhóm.' });
      return;
    }

    const rawRepos = req.body?.repos;
    if (!Array.isArray(rawRepos) || !rawRepos.every((r) => typeof r === 'string' && isValidGitHubRepoFullName(r.trim()))) {
      res.status(400).json({ error: 'Phải chọn từ 1 đến 10 repository hợp lệ.' });
      return;
    }

    const uniqueFullNames = [...new Set(rawRepos.map((r: string) => r.trim()))];
    if (uniqueFullNames.length < 1 || uniqueFullNames.length > 10) {
      res.status(400).json({ error: 'Phải chọn từ 1 đến 10 repository hợp lệ.' });
      return;
    }

    try {
      const cred = await options.credentialRepo!.getPersonalConnectionStatus('github', user.id);
      if (!cred || cred.status !== 'active') {
        res.status(400).json({ error: 'Quản trị viên cần kết nối tài khoản GitHub trước.' });
        return;
      }

      let dec: Record<string, any>;
      try {
        dec = decryptCredentials(cred.config, options.encryptionKey!);
      } catch {
        res.status(400).json({ error: 'Không đọc được thông tin xác thực GitHub.' });
        return;
      }

      if (!client || !options.teamRepo) {
        res.status(503).json({ error: 'Dịch vụ GitHub chưa sẵn sàng.' });
        return;
      }

      const accessToken = await resolveAccessToken(user.id, cred.id, dec);
      const liveRepos = await client.repos(accessToken, AbortSignal.timeout(githubTimeoutMs));
      const selected: GitHubTeamRepoItem[] = [];
      for (const fullName of uniqueFullNames) {
        const found = liveRepos.find((r) => r.fullName.toLowerCase() === fullName.toLowerCase());
        if (!found) {
          res.status(400).json({ error: `Repository ${fullName} không tồn tại hoặc tài khoản của bạn không có quyền truy cập.` });
          return;
        }
        selected.push({
          repoId: found.id,
          fullName: found.fullName,
          name: found.name,
        });
      }

      const saved = await options.teamRepo.replace({
        chosenBy: user.id,
        repos: selected,
      });

      options.onConnectionChanged?.(user.id);
      res.json(saved);
    } catch {
      res.status(500).json({ error: 'Không lưu được danh sách repository GitHub.' });
    }
  });

  router.get('/', async (req, res) => {
    const user = (req as any).user as AuthUser;
    try {
      const cred = await options.credentialRepo!.getPersonalConnectionStatus('github', user.id);
      if (!cred) {
        res.json({ status: 'not_connected', repos: [] });
        return;
      }

      if (cred.status === 'reconnect_required') {
        let login: string | undefined;
        try {
          const dec = decryptCredentials(cred.config, options.encryptionKey!);
          login = typeof dec.login === 'string' ? dec.login : undefined;
        } catch {
          // ignore
        }
        res.json({ status: 'reconnect_required', ...(login ? { login } : {}), repos: [] });
        return;
      }

      let dec: Record<string, any>;
      try {
        dec = decryptCredentials(cred.config, options.encryptionKey!);
      } catch {
        res.json({ status: 'reconnect_required', repos: [] });
        return;
      }
      const login = typeof dec.login === 'string' ? dec.login : undefined;

      const scope = options.teamRepo ? await options.teamRepo.get() : null;
      if (!scope || !scope.repos || scope.repos.length === 0) {
        res.json({
          status: 'needs_scope',
          ...(login ? { login } : {}),
          repos: [],
        });
        return;
      }

      let callerRepos: GitHubRepoSummary[] = [];
      if (client) {
        try {
          const accessToken = await resolveAccessToken(user.id, cred.id, dec);
          callerRepos = await client.repos(accessToken, AbortSignal.timeout(githubTimeoutMs));
        } catch (err) {
          if (err instanceof GitHubOAuthError && err.kind === 'invalid_grant') {
            await options.credentialRepo!.markReconnectRequired('github', user.id, cred.id);
            res.json({ status: 'reconnect_required', ...(login ? { login } : {}), repos: [] });
            return;
          }
          const updated = await options.credentialRepo!.getPersonalConnectionStatus('github', user.id);
          if (updated?.status === 'reconnect_required') {
            res.json({ status: 'reconnect_required', ...(login ? { login } : {}), repos: [] });
            return;
          }
        }
      }

      const accessibleSet = new Set(callerRepos.map((r) => r.fullName.toLowerCase()));
      const repos = scope.repos.map((r) => ({
        repoId: r.repoId,
        fullName: r.fullName,
        name: r.name,
        accessible: accessibleSet.has(r.fullName.toLowerCase()),
      }));

      const anyAccessible = repos.some((r) => r.accessible);
      const status = anyAccessible ? 'connected' : 'needs_membership';

      res.json({
        status,
        ...(login ? { login } : {}),
        repos,
      });
    } catch {
      res.status(500).json({ error: 'Không lấy được trạng thái kết nối GitHub.' });
    }
  });

  return router;
}
