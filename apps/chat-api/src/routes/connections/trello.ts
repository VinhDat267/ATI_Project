import { Router, type Request, type Response } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { decryptCredentials, encryptCredentials } from '@wap/tool-adapters';
import { createAuthMiddleware, type AuthUser } from '../../auth/jwt.js';
import type { TrelloOAuthConfig } from '../../config/env.js';
import type { CredentialRepo } from '../../db/repositories/credential-repo.js';
import type { GoogleAuthRepo } from '../../db/repositories/google-auth-repo.js';
import type { SessionRepo } from '../../db/repositories/session-repo.js';
import type { TrelloTeamRepo } from '../../db/repositories/trello-team-repo.js';
import { TrelloOAuthClient, type TrelloBoardSummary } from '../../services/trello/oauth-client.js';
import type { TrelloTokenManager } from '../../services/trello/token-manager.js';

const COOKIE = 'ati_trello_browser';
const COOKIE_PATH = '/api/connections/trello';
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

export interface TrelloConnectionsOptions {
  jwtSecret: string;
  sessionRepo?: SessionRepo;
  states?: GoogleAuthRepo;
  credentialRepo?: CredentialRepo;
  teamRepo?: TrelloTeamRepo;
  oauth?: TrelloOAuthConfig;
  encryptionKey?: string;
  fetchFn?: typeof fetch;
  clock?: () => number;
  trelloTimeoutMs?: number;
  onConnectionChanged?: (userId: string) => void;
  conversationOwner?: (conversationId: string) => Promise<string | null>;
  tokens?: Pick<TrelloTokenManager, 'forConnection'>;
  adminUserIds?: string[];
}

export function isTrelloConnectAvailable(
  options: Pick<
    TrelloConnectionsOptions,
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

export function createTrelloConnectionRoutes(options: TrelloConnectionsOptions): Router {
  const router = Router();
  const clock = options.clock ?? Date.now;
  const trelloTimeoutMs = options.trelloTimeoutMs ?? 10_000;
  const client = options.oauth ? new TrelloOAuthClient(options.oauth, options.fetchFn) : undefined;
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
    if (!isTrelloConnectAvailable(options)) {
      if (req.method === 'GET' && (req.path === '/' || req.path === '')) {
        res.json({ status: 'unconfigured', boards: [] });
        return;
      }
      res.status(503).json({ error: 'Trello chưa được cấu hình trên máy chủ.' });
      return;
    }
    next();
  });

  const fail = (
    res: Response,
    code: 'TRELLO_STATE_INVALID' | 'TRELLO_REFRESH_TOKEN_MISSING' | 'TRELLO_CONNECT_FAILED'
  ) => {
    const messages = {
      TRELLO_STATE_INVALID:
        'Yêu cầu kết nối Trello đã hết hạn hoặc không còn hợp lệ. Hãy bấm "Kết nối Trello" lại.',
      TRELLO_REFRESH_TOKEN_MISSING: 'Trello không trả quyền truy cập lâu dài. Hãy kết nối lại.',
      TRELLO_CONNECT_FAILED: 'Không kết nối được Trello. Vui lòng thử lại.',
    };
    res.status(400).json({ error: messages[code], code });
  };

  const ownConversation = async (value: unknown, userId: string): Promise<string | null> => {
    const id = typeof value === 'string' ? CONVERSATION_PATH.exec(value)?.[1]?.toLowerCase() : undefined;
    if (!id || !options.conversationOwner) return null;
    return (await options.conversationOwner(id)) === userId ? `/c/${id}` : null;
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
          mode: 'connect_trello',
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
      res.status(500).json({ error: 'Không bắt đầu được kết nối Trello.' });
    }
  });

  router.post('/callback', async (req, res) => {
    const user = (req as any).user as AuthUser;
    const state = req.body?.state;
    const code = req.body?.code;
    const browser = binding(req);
    res.setHeader('Cache-Control', 'no-store');

    if (!valid(state) || !valid(browser) || typeof code !== 'string' || !code || code.length > 4096) {
      fail(res, 'TRELLO_STATE_INVALID');
      return;
    }

    try {
      const consumed = await options.states!.consumeState(
        state,
        browser,
        clock(),
        ['connect_trello'],
        user.id,
        user.sid
      );
      if (!consumed?.id) {
        fail(res, 'TRELLO_STATE_INVALID');
        return;
      }

      let tokens;
      try {
        tokens = await client!.exchangeCode(code, consumed.code_verifier, AbortSignal.timeout(trelloTimeoutMs));
      } catch {
        fail(res, 'TRELLO_CONNECT_FAILED');
        return;
      }

      if (!tokens.refreshToken) {
        fail(res, 'TRELLO_REFRESH_TOKEN_MISSING');
        return;
      }

      let member;
      try {
        member = await client!.member(tokens.accessToken, AbortSignal.timeout(trelloTimeoutMs));
      } catch {
        fail(res, 'TRELLO_CONNECT_FAILED');
        return;
      }

      const now = clock();
      const config = encryptCredentials(
        {
          refreshToken: tokens.refreshToken,
          username: member.username,
          memberId: member.id,
          connectedAt: new Date(now).toISOString(),
        },
        options.encryptionKey!
      );

      await options.credentialRepo!.saveCredentials('trello', config, user.id);

      options.onConnectionChanged?.(user.id);
      res.json({
        username: member.username,
        ...(consumed.return_to ? { returnTo: consumed.return_to } : {}),
      });
    } catch {
      fail(res, 'TRELLO_CONNECT_FAILED');
    }
  });

  router.delete('/', async (req, res) => {
    const user = (req as any).user as AuthUser;
    try {
      await options.credentialRepo!.deleteCredentials('trello', user.id);
      options.onConnectionChanged?.(user.id);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: 'Không ngắt được kết nối Trello. Vui lòng thử lại.' });
    }
  });

  router.get('/', async (req, res) => {
    const user = (req as any).user as AuthUser;
    try {
      const cred = await options.credentialRepo!.getPersonalConnectionStatus('trello', user.id);
      if (!cred) {
        res.json({ status: 'not_connected', boards: [] });
        return;
      }

      if (cred.status === 'reconnect_required') {
        let username: string | undefined;
        try {
          const dec = decryptCredentials(cred.config, options.encryptionKey!);
          username = dec.username;
        } catch {
          // ignore decryption failure
        }
        res.json({ status: 'reconnect_required', username, boards: [] });
        return;
      }

      let username: string | undefined;
      let refreshToken: string | undefined;
      try {
        const dec = decryptCredentials(cred.config, options.encryptionKey!);
        username = dec.username;
        refreshToken = dec.refreshToken;
      } catch {
        res.json({ status: 'reconnect_required', boards: [] });
        return;
      }

      const scope = options.teamRepo ? await options.teamRepo.get() : null;
      if (!scope || !scope.boards || scope.boards.length === 0) {
        res.json({
          status: 'needs_scope',
          username,
          boards: [],
        });
        return;
      }

      let callerBoards: TrelloBoardSummary[] = [];
      if (options.tokens && refreshToken && client) {
        try {
          const provider = options.tokens.forConnection(user.id, cred.id, refreshToken);
          const accessToken = await provider.getAccessToken();
          callerBoards = await client.boards(
            accessToken,
            scope.workspaceId,
            AbortSignal.timeout(trelloTimeoutMs)
          );
        } catch {
          // ignore error fetching live boards
        }
      }

      const boards = scope.boards.map((b) => {
        const found = callerBoards.find((cb) => cb.id === b.boardId);
        return {
          boardId: b.boardId,
          boardName: b.boardName,
          member: found ? found.member : false,
        };
      });

      const anyMember = boards.some((b) => b.member);
      const status = anyMember ? 'connected' : 'needs_membership';

      res.json({
        status,
        username,
        workspaceName: scope.workspaceName,
        boards,
      });
    } catch {
      res.status(500).json({ error: 'Không lấy được trạng thái kết nối Trello.' });
    }
  });

  return router;
}
