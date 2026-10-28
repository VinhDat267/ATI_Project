import { Router, type Request, type Response } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { decryptCredentials, encryptCredentials, GlobalRateLimiter } from '@wap/tool-adapters';
import { MYSHEETS_SCOPE, type PersonalSpreadsheetItem } from '@wap/tool-schemas';
import { createAuthMiddleware, type AuthUser } from '../../auth/jwt.js';
import type { GmailOAuthConfig } from '../../config/env.js';
import type { CredentialRepo } from '../../db/repositories/credential-repo.js';
import type { GmailConnectionRepo } from '../../db/repositories/gmail-connection-repo.js';
import type { GoogleAuthRepo } from '../../db/repositories/google-auth-repo.js';
import type { SessionRepo } from '../../db/repositories/session-repo.js';
import { GmailOAuthClient, GmailOAuthError } from '../../services/gmail/oauth-client.js';
import type { GmailTokenManager } from '../../services/gmail/token-manager.js';

const COOKIE = 'ati_mysheets_browser';
const COOKIE_PATH = '/api/connections/mysheets';
const random = () => randomBytes(32).toString('base64url');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const valid = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const SPREADSHEET_ID_PATTERN = /^[A-Za-z0-9_-]{20,}$/;

function binding(req: Request): string | undefined {
  return req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
}

const CONVERSATION_PATH = /^\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export interface MySheetsConnectionsOptions {
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
  /** The owner of a conversation, or null; without it no flow may return to a conversation. */
  conversationOwner?: (conversationId: string) => Promise<string | null>;
  tokens?: Pick<GmailTokenManager, 'forConnection'>;
  picker?: { apiKey: string; appId: string };
  fakePickerBaseUrl?: string;
  driveApiBaseUrl?: string;
  pickerLimiter?: GlobalRateLimiter;
}

export function isMySheetsAvailable(
  options: Pick<MySheetsConnectionsOptions, 'oauth' | 'repo' | 'states' | 'sessionRepo' | 'credentialRepo' | 'encryptionKey'>
): boolean {
  return Boolean(options.oauth && options.repo && options.states && options.sessionRepo && options.credentialRepo && options.encryptionKey);
}

/** Mounted only when MYSHEETS_ENABLED=on; every route needs the caller's own live session. */
export function createMySheetsConnectionRoutes(options: MySheetsConnectionsOptions): Router {
  const router = Router();
  const clock = options.clock ?? Date.now;
  const googleTimeoutMs = options.googleTimeoutMs ?? 10_000;
  const revokeTimeoutMs = options.revokeTimeoutMs ?? 10_000;
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const client = options.oauth ? new GmailOAuthClient(options.oauth, fetchFn) : undefined;
  const auth = createAuthMiddleware(options.jwtSecret, { sessionRepo: options.sessionRepo, clock });
  const pickerLimiter = options.pickerLimiter ?? new GlobalRateLimiter({ maxRequests: 10, windowMs: 60_000 });
  const driveBase = (options.driveApiBaseUrl ?? 'https://www.googleapis.com').replace(/\/+$/, '');

  router.use((_req, res, next) => {
    const json = res.json.bind(res);
    res.json = (body: any) =>
      json(res.statusCode === 401 && body && typeof body === 'object' && !body.code ? { ...body, code: 'INVALID_SESSION' } : body);
    if (!isMySheetsAvailable(options)) {
      res.status(503).json({ error: 'Kết nối Google Sheets chưa sẵn sàng.' });
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

  const fail = (
    res: Response,
    code:
      | 'MYSHEETS_STATE_INVALID'
      | 'MYSHEETS_SCOPE_MISSING'
      | 'MYSHEETS_REFRESH_TOKEN_MISSING'
      | 'MYSHEETS_CONNECT_FAILED'
  ) => {
    const messages = {
      MYSHEETS_STATE_INVALID:
        'Yêu cầu kết nối Google Sheets đã hết hạn hoặc không còn hợp lệ. Hãy bấm "Kết nối Google Sheets" lại.',
      MYSHEETS_SCOPE_MISSING:
        'Google chưa cấp quyền truy cập file cho ATI. Hãy kết nối lại và đồng ý quyền Google Sheets.',
      MYSHEETS_REFRESH_TOKEN_MISSING: 'Google không trả quyền truy cập lâu dài. Hãy kết nối lại.',
      MYSHEETS_CONNECT_FAILED: 'Không kết nối được Google Sheets. Vui lòng thử lại.',
    };
    res.status(400).json({ error: messages[code], code });
  };

  const revokeRefusedGrant = (userId: string, stateId: string, token: string, email?: string) => {
    options.repo!.withLockedConnection(userId, async (current, otherFlows) => {
      if (otherFlows) return;
      if (current) {
        let connectedEmail: unknown;
        try {
          connectedEmail = decryptCredentials(current.config, options.encryptionKey!).email;
        } catch {
          return;
        }
        if (
          !email ||
          typeof connectedEmail !== 'string' ||
          !connectedEmail.trim() ||
          connectedEmail.trim().toLowerCase() === email.trim().toLowerCase()
        )
          return;
      }
      await client!.revoke(token, AbortSignal.timeout(revokeTimeoutMs));
    }, stateId).catch((error) => {
      console.warn(`[chat-api] MySheets revoke failed: ${error instanceof GmailOAuthError ? error.kind : 'error'}`);
    });
  };

  const ownConversation = async (value: unknown, userId: string): Promise<string | null> => {
    const id = typeof value === 'string' ? CONVERSATION_PATH.exec(value)?.[1]?.toLowerCase() : undefined;
    if (!id || !options.conversationOwner) return null;
    return (await options.conversationOwner(id)) === userId ? `/c/${id}` : null;
  };

  const getAccessToken = async (userId: string, credentialId: string, refreshToken: string): Promise<string> => {
    if (options.tokens) {
      const provider = options.tokens.forConnection(userId, credentialId, refreshToken);
      return provider.getAccessToken({ signal: AbortSignal.timeout(googleTimeoutMs) });
    }
    const tokens = await client!.refresh(refreshToken, AbortSignal.timeout(googleTimeoutMs));
    return tokens.accessToken;
  };

  router.post('/start', async (req, res) => {
    const user = (req as any).user as AuthUser;
    try {
      let returnTo: string | null = null;
      if (req.body?.returnTo !== undefined) {
        returnTo = await ownConversation(req.body.returnTo, user.id);
        if (!returnTo) {
          res.status(400).json({ error: 'Không mở được kết nối từ hội thoại này.', code: 'RETURN_TO_INVALID' });
          return;
        }
      }
      const state = random(),
        verifier = random();
      const browser = valid(binding(req)) ? binding(req)! : random();
      await options.states!.createState(
        {
          state_hash: hash(state),
          browser_binding_hash: hash(browser),
          code_verifier: verifier,
          nonce: random(),
          mode: 'connect_mysheets',
          user_id: user.id,
          session_id: user.sid!,
          return_to: returnTo,
        },
        clock()
      );
      const url = client!.authorizationUrl({
        state,
        scope: MYSHEETS_SCOPE,
        codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
      });
      res.cookie(COOKIE, browser, {
        httpOnly: true,
        sameSite: 'lax',
        secure: new URL(options.oauth!.redirectUri).protocol === 'https:',
        maxAge: 600_000,
        path: COOKIE_PATH,
      });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ url });
    } catch {
      res.status(500).json({ error: 'Không bắt đầu được kết nối Google Sheets.' });
    }
  });

  router.post('/callback', async (req, res) => {
    const user = (req as any).user as AuthUser;
    const state = req.body?.state,
      code = req.body?.code,
      browser = binding(req);
    res.setHeader('Cache-Control', 'no-store');
    if (!valid(state) || !valid(browser) || typeof code !== 'string' || !code || code.length > 4096) {
      fail(res, 'MYSHEETS_STATE_INVALID');
      return;
    }
    try {
      const consumed = await options.states!.consumeState(
        state,
        browser,
        clock(),
        ['connect_mysheets'],
        user.id,
        user.sid
      );
      if (!consumed?.id) {
        fail(res, 'MYSHEETS_STATE_INVALID');
        return;
      }
      let tokens;
      try {
        tokens = await client!.exchangeCode(code, consumed.code_verifier, AbortSignal.timeout(googleTimeoutMs));
      } catch {
        fail(res, 'MYSHEETS_CONNECT_FAILED');
        return;
      }
      const requiredScopes = MYSHEETS_SCOPE.split(' ');
      if (!requiredScopes.every((s) => tokens.scopes.includes(s))) {
        revokeRefusedGrant(user.id, consumed.id, tokens.refreshToken ?? tokens.accessToken);
        fail(res, 'MYSHEETS_SCOPE_MISSING');
        return;
      }
      if (!tokens.refreshToken) {
        fail(res, 'MYSHEETS_REFRESH_TOKEN_MISSING');
        return;
      }

      // Fetch user email via Drive about.get
      let email: string | undefined;
      try {
        const aboutRes = await fetchFn(`${driveBase}/drive/v3/about?fields=user(emailAddress)`, {
          headers: { Authorization: `Bearer ${tokens.accessToken}` },
          signal: AbortSignal.timeout(googleTimeoutMs),
          redirect: 'manual',
        });
        if (aboutRes.ok) {
          const aboutData = (await aboutRes.json()) as any;
          if (typeof aboutData?.user?.emailAddress === 'string') {
            email = aboutData.user.emailAddress;
          }
        }
      } catch {
        // Handled below
      }

      if (!email) {
        revokeRefusedGrant(user.id, consumed.id, tokens.refreshToken);
        fail(res, 'MYSHEETS_CONNECT_FAILED');
        return;
      }

      const now = clock();
      const config = encryptCredentials(
        {
          refreshToken: tokens.refreshToken,
          email,
          scopes: tokens.scopes,
          selectedSpreadsheets: [],
          allowedScope: { spreadsheets: [] },
          connectedAt: new Date(now).toISOString(),
        },
        options.encryptionKey!
      );
      const saved = await options.repo!.saveConnection(user.id, consumed.id, config, clock);
      if (!saved) {
        revokeRefusedGrant(user.id, consumed.id, tokens.refreshToken, email);
        fail(res, 'MYSHEETS_STATE_INVALID');
        return;
      }
      options.onConnectionChanged?.(user.id);
      res.json({ email, ...(consumed.return_to ? { returnTo: consumed.return_to } : {}) });
    } catch {
      fail(res, 'MYSHEETS_CONNECT_FAILED');
    }
  });

  router.post('/picker-session', async (req, res) => {
    const user = (req as any).user as AuthUser;
    res.setHeader('Cache-Control', 'no-store');

    if (!(await pickerLimiter.acquire(`picker:${user.id}`))) {
      res.status(429).json({ error: 'Quá nhiều yêu cầu mở Picker. Vui lòng thử lại sau một phút.', code: 'RATE_LIMIT' });
      return;
    }

    try {
      const record = await options.credentialRepo!.getPersonalCredentials('mysheets', user.id);
      if (!record || record.status !== 'active') {
        res.status(409).json({
          error: 'Google Sheets của bạn chưa được kết nối hoặc cần kết nối lại.',
          code: 'MYSHEETS_NOT_CONNECTED',
        });
        return;
      }
      let decrypted: any;
      try {
        decrypted = decryptCredentials(record.config, options.encryptionKey!);
      } catch {
        res.status(409).json({
          error: 'Google Sheets của bạn chưa được kết nối hoặc cần kết nối lại.',
          code: 'MYSHEETS_NOT_CONNECTED',
        });
        return;
      }
      let accessToken: string;
      try {
        accessToken = await getAccessToken(user.id, record.id, decrypted.refreshToken);
      } catch (error: any) {
        if ((error instanceof GmailOAuthError && error.kind === 'invalid_grant') || error?.category === 'AUTH_ERROR') {
          try {
            await options.credentialRepo!.markReconnectRequired('mysheets', user.id, record.id);
          } catch {}
          options.onConnectionChanged?.(user.id);
          res.status(409).json({
            error: 'Google Sheets của bạn chưa được kết nối hoặc cần kết nối lại.',
            code: 'MYSHEETS_NOT_CONNECTED',
          });
          return;
        }
        res.status(502).json({
          error: 'Không lấy được quyền truy cập Google Sheets. Hãy thử lại.',
          code: 'MYSHEETS_FETCH_FAILED',
        });
        return;
      }

      const expiresAt = clock() + 3600_000;
      if (options.fakePickerBaseUrl) {
        res.json({
          mode: 'fake',
          accessToken,
          expiresAt,
          fakePickerBaseUrl: options.fakePickerBaseUrl,
        });
        return;
      }

      res.json({
        mode: 'google',
        accessToken,
        expiresAt,
        developerKey: options.picker?.apiKey,
        appId: options.picker?.appId,
      });
    } catch {
      res.status(502).json({
        error: 'Không bắt đầu được phiên Google Picker. Hãy thử lại.',
        code: 'MYSHEETS_FETCH_FAILED',
      });
    }
  });

  router.get('/spreadsheets', async (req, res) => {
    const user = (req as any).user as AuthUser;
    try {
      const record = await options.credentialRepo!.getPersonalCredentials('mysheets', user.id);
      if (!record || record.status !== 'active') {
        res.status(409).json({
          error: 'Google Sheets của bạn chưa được kết nối hoặc cần kết nối lại.',
          code: 'MYSHEETS_NOT_CONNECTED',
        });
        return;
      }
      let decrypted: any;
      try {
        decrypted = decryptCredentials(record.config, options.encryptionKey!);
      } catch {
        res.status(409).json({
          error: 'Google Sheets của bạn chưa được kết nối hoặc cần kết nối lại.',
          code: 'MYSHEETS_NOT_CONNECTED',
        });
        return;
      }
      res.json({
        email: decrypted.email,
        selectedSpreadsheets: Array.isArray(decrypted.selectedSpreadsheets) ? decrypted.selectedSpreadsheets : [],
      });
    } catch {
      res.status(500).json({ error: 'Không tải được danh sách bảng tính. Hãy thử lại.' });
    }
  });

  router.put('/scope', async (req, res) => {
    const user = (req as any).user as AuthUser;
    try {
      const requested = req.body?.spreadsheetIds;
      if (!Array.isArray(requested) || !requested.length || requested.length > 10) {
        res.status(400).json({ error: 'Vui lòng chọn 1 đến 10 bảng tính hợp lệ.', code: 'MYSHEETS_SCOPE_INVALID' });
        return;
      }
      const deduplicated = [...new Set(requested)];
      if (deduplicated.some((id) => typeof id !== 'string' || !SPREADSHEET_ID_PATTERN.test(id))) {
        res.status(400).json({ error: 'Mã bảng tính không đúng định dạng.', code: 'MYSHEETS_SCOPE_INVALID' });
        return;
      }
      const record = await options.credentialRepo!.getPersonalCredentials('mysheets', user.id);
      if (!record || record.status !== 'active') {
        res.status(409).json({
          error: 'Google Sheets của bạn chưa được kết nối hoặc cần kết nối lại.',
          code: 'MYSHEETS_NOT_CONNECTED',
        });
        return;
      }
      let decrypted: any;
      try {
        decrypted = decryptCredentials(record.config, options.encryptionKey!);
      } catch {
        res.status(409).json({
          error: 'Google Sheets của bạn chưa được kết nối hoặc cần kết nối lại.',
          code: 'MYSHEETS_NOT_CONNECTED',
        });
        return;
      }
      let accessToken: string;
      try {
        accessToken = await getAccessToken(user.id, record.id, decrypted.refreshToken);
      } catch (error: any) {
        if ((error instanceof GmailOAuthError && error.kind === 'invalid_grant') || error?.category === 'AUTH_ERROR') {
          try {
            await options.credentialRepo!.markReconnectRequired('mysheets', user.id, record.id);
          } catch {}
          options.onConnectionChanged?.(user.id);
          res.status(409).json({
            error: 'Google Sheets của bạn chưa được kết nối hoặc cần kết nối lại.',
            code: 'MYSHEETS_NOT_CONNECTED',
          });
          return;
        }
        res.status(502).json({
          error: 'Không lấy được quyền truy cập Google Drive. Hãy thử lại.',
          code: 'MYSHEETS_FETCH_FAILED',
        });
        return;
      }

      // Check each spreadsheet with Drive files.get
      const items: PersonalSpreadsheetItem[] = [];
      for (const id of deduplicated) {
        let driveRes: Response;
        try {
          driveRes = await fetchFn(
            `${driveBase}/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType,trashed,capabilities(canEdit)&supportsAllDrives=true`,
            {
              headers: { Authorization: `Bearer ${accessToken}` },
              signal: AbortSignal.timeout(googleTimeoutMs),
              redirect: 'manual',
            }
          );
        } catch {
          res.status(502).json({
            error: 'Không kiểm tra được bảng tính trong Google Drive. Vui lòng thử lại.',
            code: 'MYSHEETS_FETCH_FAILED',
          });
          return;
        }

        if (driveRes.status === 404) {
          res.status(400).json({
            error: `Bảng tính "${id}" chưa được cấp quyền trong Google Drive hoặc không tồn tại.`,
            code: 'MYSHEETS_SCOPE_INVALID',
          });
          return;
        }

        if (!driveRes.ok) {
          res.status(502).json({
            error: 'Không kiểm tra được bảng tính trong Google Drive. Vui lòng thử lại.',
            code: 'MYSHEETS_FETCH_FAILED',
          });
          return;
        }

        let fileData: any;
        try {
          fileData = await driveRes.json();
        } catch {
          res.status(502).json({
            error: 'Phản hồi từ Google Drive không hợp lệ.',
            code: 'MYSHEETS_FETCH_FAILED',
          });
          return;
        }

        if (
          fileData?.mimeType !== 'application/vnd.google-apps.spreadsheet' ||
          fileData?.trashed === true ||
          typeof fileData?.name !== 'string' ||
          !fileData.name.trim()
        ) {
          res.status(400).json({
            error: 'Một hoặc nhiều file đã chọn không phải bảng tính Google Sheets hoặc đã bị xoá.',
            code: 'MYSHEETS_SCOPE_INVALID',
          });
          return;
        }

        items.push({
          id: fileData.id,
          title: fileData.name,
          canEdit: Boolean(fileData.capabilities?.canEdit),
        });
      }

      const updated = await options.repo!.updateConfigIfActive(user.id, record.id, (oldConfig) => {
        const prev = decryptCredentials(oldConfig, options.encryptionKey!);
        return encryptCredentials(
          {
            ...prev,
            selectedSpreadsheets: items,
            allowedScope: { spreadsheets: items.map((s) => s.id) },
          },
          options.encryptionKey!
        );
      });

      if (!updated) {
        res.status(409).json({
          error: 'Kết nối Google Sheets đã thay đổi. Hãy thử lại.',
          code: 'MYSHEETS_NOT_CONNECTED',
        });
        return;
      }

      options.onConnectionChanged?.(user.id);
      res.json({
        email: decrypted.email,
        selectedSpreadsheets: items,
      });
    } catch {
      res.status(500).json({ error: 'Không cập nhật được phạm vi Google Sheets. Vui lòng thử lại.' });
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
          console.warn(`[chat-api] MySheets revoke failed: ${error instanceof GmailOAuthError ? error.kind : 'error'}`);
        }
      };
      const current = await options.credentialRepo!.getPersonalConnectionStatus('mysheets', user.id);
      await revokeRow(current?.config);
      const removed = await options.repo!.disconnect(user.id);
      if (removed && removed.id !== current?.id) await revokeRow(removed.config);
      options.onConnectionChanged?.(user.id);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: 'Không ngắt được kết nối Google Sheets. Vui lòng thử lại.' });
    }
  });

  return router;
}
