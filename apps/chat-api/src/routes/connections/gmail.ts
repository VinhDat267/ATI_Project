import { Router, type Request, type Response } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { decryptCredentials, encryptCredentials } from '@wap/tool-adapters';
import { GMAIL_MODIFY_SCOPE } from '@wap/tool-schemas';
import { createAuthMiddleware, type AuthUser } from '../../auth/jwt.js';
import type { GmailOAuthConfig } from '../../config/env.js';
import type { CredentialRepo } from '../../db/repositories/credential-repo.js';
import type { GmailConnectionRepo } from '../../db/repositories/gmail-connection-repo.js';
import type { GoogleAuthRepo } from '../../db/repositories/google-auth-repo.js';
import type { SessionRepo } from '../../db/repositories/session-repo.js';
import { GmailOAuthClient, GmailOAuthError } from '../../services/gmail/oauth-client.js';

const COOKIE = 'ati_gmail_browser';
const COOKIE_PATH = '/api/connections/gmail';
const random = () => randomBytes(32).toString('base64url');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const valid = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
function binding(req: Request): string | undefined {
  return req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
}

export interface GmailConnectionsOptions {
  jwtSecret: string;
  sessionRepo?: SessionRepo;
  states?: GoogleAuthRepo;
  credentialRepo?: CredentialRepo;
  repo?: GmailConnectionRepo;
  oauth?: GmailOAuthConfig;
  encryptionKey?: string;
  fetchFn?: typeof fetch;
  clock?: () => number;
  /** Deadline of each Google request made while connecting. */
  googleTimeoutMs?: number;
  /** Deadline of token revocation on disconnect; a failure never blocks the disconnect. */
  revokeTimeoutMs?: number;
  /** Drops cached access tokens and adapters of this person. */
  onConnectionChanged?: (userId: string) => void;
}

export function isGmailAvailable(options: Pick<GmailConnectionsOptions, 'oauth' | 'repo' | 'states' | 'sessionRepo' | 'credentialRepo' | 'encryptionKey'>): boolean {
  return Boolean(options.oauth && options.repo && options.states && options.sessionRepo && options.credentialRepo && options.encryptionKey);
}

/** Mounted only when GMAIL_ENABLED=on; every route needs the caller's own live session. */
export function createGmailConnectionRoutes(options: GmailConnectionsOptions): Router {
  const router = Router();
  const clock = options.clock ?? Date.now;
  const googleTimeoutMs = options.googleTimeoutMs ?? 10_000;
  const revokeTimeoutMs = options.revokeTimeoutMs ?? 10_000;
  const client = options.oauth ? new GmailOAuthClient(options.oauth, options.fetchFn) : undefined;
  const auth = createAuthMiddleware(options.jwtSecret, { sessionRepo: options.sessionRepo, clock });

  router.use((_req, res, next) => {
    // The shared auth middleware answers 401 without a code; the Gmail contract names it.
    const json = res.json.bind(res);
    res.json = (body: any) => json(res.statusCode === 401 && body && typeof body === 'object' && !body.code ? { ...body, code: 'INVALID_SESSION' } : body);
    if (!isGmailAvailable(options)) { res.status(503).json({ error: 'Kết nối Gmail chưa sẵn sàng.' }); return; }
    next();
  });
  router.use(auth);
  router.use((req, res, next) => {
    if (!(req as any).user?.sid) { res.status(401).json({ error: 'Phiên đăng nhập không còn hợp lệ.', code: 'INVALID_SESSION' }); return; }
    next();
  });

  const fail = (res: Response, code: 'GMAIL_STATE_INVALID' | 'GMAIL_SCOPE_MISSING' | 'GMAIL_REFRESH_TOKEN_MISSING' | 'GMAIL_CONNECT_FAILED') => {
    const messages = {
      GMAIL_STATE_INVALID: 'Yêu cầu kết nối Gmail đã hết hạn hoặc không còn hợp lệ. Hãy bấm "Kết nối Gmail" lại.',
      GMAIL_SCOPE_MISSING: 'Google chưa cấp quyền đọc và gửi thư cho ATI. Hãy kết nối lại và đồng ý quyền Gmail.',
      GMAIL_REFRESH_TOKEN_MISSING: 'Google không trả quyền truy cập lâu dài. Hãy kết nối lại.',
      GMAIL_CONNECT_FAILED: 'Không kết nối được Gmail. Vui lòng thử lại.',
    };
    res.status(400).json({ error: messages[code], code });
  };
  // Best effort, in the background: an orphaned grant should not outlive a refused connection.
  const revokeQuietly = (token: string) => {
    client!.revoke(token, AbortSignal.timeout(revokeTimeoutMs)).catch((error) => {
      console.warn(`[chat-api] Gmail revoke failed: ${error instanceof GmailOAuthError ? error.kind : 'error'}`);
    });
  };

  router.post('/start', async (req, res) => {
    const user = (req as any).user as AuthUser;
    try {
      const state = random(), verifier = random();
      const browser = valid(binding(req)) ? binding(req)! : random();
      await options.states!.createState({ state_hash: hash(state), browser_binding_hash: hash(browser), code_verifier: verifier, nonce: random(),
        mode: 'connect_gmail', user_id: user.id, session_id: user.sid! }, clock());
      const url = client!.authorizationUrl({ state, scope: GMAIL_MODIFY_SCOPE, codeChallenge: createHash('sha256').update(verifier).digest('base64url') });
      res.cookie(COOKIE, browser, { httpOnly: true, sameSite: 'lax', secure: new URL(options.oauth!.redirectUri).protocol === 'https:', maxAge: 600_000, path: COOKIE_PATH });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ url });
    } catch {
      res.status(500).json({ error: 'Không bắt đầu được kết nối Gmail.' });
    }
  });

  router.post('/callback', async (req, res) => {
    const user = (req as any).user as AuthUser;
    const state = req.body?.state, code = req.body?.code, browser = binding(req);
    res.setHeader('Cache-Control', 'no-store');
    if (!valid(state) || !valid(browser) || typeof code !== 'string' || !code || code.length > 4096) { fail(res, 'GMAIL_STATE_INVALID'); return; }
    try {
      const consumed = await options.states!.consumeState(state, browser, clock(), ['connect_gmail'], user.id, user.sid);
      if (!consumed?.id) { fail(res, 'GMAIL_STATE_INVALID'); return; }
      let tokens;
      try {
        tokens = await client!.exchangeCode(code, consumed.code_verifier, AbortSignal.timeout(googleTimeoutMs));
      } catch { fail(res, 'GMAIL_CONNECT_FAILED'); return; }
      if (!tokens.scopes.includes(GMAIL_MODIFY_SCOPE)) {
        revokeQuietly(tokens.refreshToken ?? tokens.accessToken);
        fail(res, 'GMAIL_SCOPE_MISSING'); return;
      }
      if (!tokens.refreshToken) { fail(res, 'GMAIL_REFRESH_TOKEN_MISSING'); return; }
      let email: string;
      try {
        email = await client!.profileEmail(tokens.accessToken, AbortSignal.timeout(googleTimeoutMs));
      } catch {
        revokeQuietly(tokens.refreshToken);
        fail(res, 'GMAIL_CONNECT_FAILED'); return;
      }
      const now = clock();
      const config = encryptCredentials({ refreshToken: tokens.refreshToken, email, scopes: tokens.scopes, connectedAt: new Date(now).toISOString() }, options.encryptionKey!);
      const saved = await options.repo!.saveConnection(user.id, consumed.id, config, now);
      if (!saved) {
        // Disconnected or signed out while Google answered: never write, and give the grant back.
        revokeQuietly(tokens.refreshToken);
        fail(res, 'GMAIL_STATE_INVALID'); return;
      }
      options.onConnectionChanged?.(user.id);
      res.json({ email });
    } catch {
      fail(res, 'GMAIL_CONNECT_FAILED');
    }
  });

  router.delete('/', async (req, res) => {
    const user = (req as any).user as AuthUser;
    try {
      const revokeRow = async (config: string | undefined) => {
        if (!config) return;
        try {
          const token = decryptCredentials(config, options.encryptionKey!).refreshToken;
          if (typeof token === 'string' && token) await client!.revoke(token, AbortSignal.timeout(revokeTimeoutMs));
        } catch (error) {
          console.warn(`[chat-api] Gmail revoke failed: ${error instanceof GmailOAuthError ? error.kind : 'error'}`);
        }
      };
      const current = await options.credentialRepo!.getPersonalConnectionStatus('gmail', user.id);
      await revokeRow(current?.config);
      const removed = await options.repo!.disconnect(user.id);
      // A connection saved by another tab between the two reads is revoked too.
      if (removed && removed.id !== current?.id) await revokeRow(removed.config);
      options.onConnectionChanged?.(user.id);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: 'Không ngắt được kết nối Gmail. Vui lòng thử lại.' });
    }
  });

  return router;
}
