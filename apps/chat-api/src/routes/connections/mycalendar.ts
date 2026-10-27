import { Router, type Request, type Response } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { decryptCredentials, encryptCredentials } from '@wap/tool-adapters';
import { CALENDAR_ID_PATTERN, MYCALENDAR_SCOPE, type PersonalCalendarItem } from '@wap/tool-schemas';
import { createAuthMiddleware, type AuthUser } from '../../auth/jwt.js';
import type { GmailOAuthConfig } from '../../config/env.js';
import type { CredentialRepo } from '../../db/repositories/credential-repo.js';
import type { GmailConnectionRepo } from '../../db/repositories/gmail-connection-repo.js';
import type { GoogleAuthRepo } from '../../db/repositories/google-auth-repo.js';
import type { SessionRepo } from '../../db/repositories/session-repo.js';
import { GmailOAuthClient, GmailOAuthError } from '../../services/gmail/oauth-client.js';
import type { GmailTokenManager } from '../../services/gmail/token-manager.js';

const COOKIE = 'ati_mycalendar_browser';
const COOKIE_PATH = '/api/connections/mycalendar';
const random = () => randomBytes(32).toString('base64url');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const valid = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);

function binding(req: Request): string | undefined {
  return req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
}

const CONVERSATION_PATH = /^\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export interface MyCalendarConnectionsOptions {
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
}

export function isMyCalendarAvailable(
  options: Pick<MyCalendarConnectionsOptions, 'oauth' | 'repo' | 'states' | 'sessionRepo' | 'credentialRepo' | 'encryptionKey'>
): boolean {
  return Boolean(options.oauth && options.repo && options.states && options.sessionRepo && options.credentialRepo && options.encryptionKey);
}

/** Mounted only when MYCALENDAR_ENABLED=on; every route needs the caller's own live session. */
export function createMyCalendarConnectionRoutes(options: MyCalendarConnectionsOptions): Router {
  const router = Router();
  const clock = options.clock ?? Date.now;
  const googleTimeoutMs = options.googleTimeoutMs ?? 10_000;
  const revokeTimeoutMs = options.revokeTimeoutMs ?? 10_000;
  const client = options.oauth ? new GmailOAuthClient(options.oauth, options.fetchFn) : undefined;
  const auth = createAuthMiddleware(options.jwtSecret, { sessionRepo: options.sessionRepo, clock });

  router.use((_req, res, next) => {
    const json = res.json.bind(res);
    res.json = (body: any) =>
      json(res.statusCode === 401 && body && typeof body === 'object' && !body.code ? { ...body, code: 'INVALID_SESSION' } : body);
    if (!isMyCalendarAvailable(options)) {
      res.status(503).json({ error: 'Kết nối Google Calendar chưa sẵn sàng.' });
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
      | 'MYCALENDAR_STATE_INVALID'
      | 'MYCALENDAR_SCOPE_MISSING'
      | 'MYCALENDAR_REFRESH_TOKEN_MISSING'
      | 'MYCALENDAR_CONNECT_FAILED'
  ) => {
    const messages = {
      MYCALENDAR_STATE_INVALID:
        'Yêu cầu kết nối Google Calendar đã hết hạn hoặc không còn hợp lệ. Hãy bấm "Kết nối Google Calendar" lại.',
      MYCALENDAR_SCOPE_MISSING:
        'Google chưa cấp quyền quản lý sự kiện lịch cho ATI. Hãy kết nối lại và đồng ý quyền Google Calendar.',
      MYCALENDAR_REFRESH_TOKEN_MISSING: 'Google không trả quyền truy cập lâu dài. Hãy kết nối lại.',
      MYCALENDAR_CONNECT_FAILED: 'Không kết nối được Google Calendar. Vui lòng thử lại.',
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
      console.warn(`[chat-api] MyCalendar revoke failed: ${error instanceof GmailOAuthError ? error.kind : 'error'}`);
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
          mode: 'connect_mycalendar',
          user_id: user.id,
          session_id: user.sid!,
          return_to: returnTo,
        },
        clock()
      );
      const url = client!.authorizationUrl({
        state,
        scope: MYCALENDAR_SCOPE,
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
      res.status(500).json({ error: 'Không bắt đầu được kết nối Google Calendar.' });
    }
  });

  router.post('/callback', async (req, res) => {
    const user = (req as any).user as AuthUser;
    const state = req.body?.state,
      code = req.body?.code,
      browser = binding(req);
    res.setHeader('Cache-Control', 'no-store');
    if (!valid(state) || !valid(browser) || typeof code !== 'string' || !code || code.length > 4096) {
      fail(res, 'MYCALENDAR_STATE_INVALID');
      return;
    }
    try {
      const consumed = await options.states!.consumeState(
        state,
        browser,
        clock(),
        ['connect_mycalendar'],
        user.id,
        user.sid
      );
      if (!consumed?.id) {
        fail(res, 'MYCALENDAR_STATE_INVALID');
        return;
      }
      let tokens;
      try {
        tokens = await client!.exchangeCode(code, consumed.code_verifier, AbortSignal.timeout(googleTimeoutMs));
      } catch {
        fail(res, 'MYCALENDAR_CONNECT_FAILED');
        return;
      }
      const requiredScopes = MYCALENDAR_SCOPE.split(' ');
      if (!requiredScopes.every((s) => tokens.scopes.includes(s))) {
        revokeRefusedGrant(user.id, consumed.id, tokens.refreshToken ?? tokens.accessToken);
        fail(res, 'MYCALENDAR_SCOPE_MISSING');
        return;
      }
      if (!tokens.refreshToken) {
        fail(res, 'MYCALENDAR_REFRESH_TOKEN_MISSING');
        return;
      }
      let live;
      try {
        live = await client!.writableCalendars(tokens.accessToken, AbortSignal.timeout(googleTimeoutMs));
      } catch {
        revokeRefusedGrant(user.id, consumed.id, tokens.refreshToken);
        fail(res, 'MYCALENDAR_CONNECT_FAILED');
        return;
      }
      const now = clock();
      const config = encryptCredentials(
        {
          refreshToken: tokens.refreshToken,
          email: live.email,
          scopes: tokens.scopes,
          selectedCalendars: [],
          allowedScope: { calendars: [] },
          connectedAt: new Date(now).toISOString(),
        },
        options.encryptionKey!
      );
      const saved = await options.repo!.saveConnection(user.id, consumed.id, config, clock);
      if (!saved) {
        revokeRefusedGrant(user.id, consumed.id, tokens.refreshToken, live.email);
        fail(res, 'MYCALENDAR_STATE_INVALID');
        return;
      }
      options.onConnectionChanged?.(user.id);
      res.json({ email: live.email, calendars: live.calendars, ...(consumed.return_to ? { returnTo: consumed.return_to } : {}) });
    } catch {
      fail(res, 'MYCALENDAR_CONNECT_FAILED');
    }
  });

  router.get('/calendars', async (req, res) => {
    const user = (req as any).user as AuthUser;
    try {
      const record = await options.credentialRepo!.getPersonalCredentials('mycalendar', user.id);
      if (!record) {
        res.status(409).json({
          error: 'Google Calendar của bạn chưa được kết nối hoặc cần kết nối lại.',
          code: 'MYCALENDAR_NOT_CONNECTED',
        });
        return;
      }
      let decrypted: any;
      try {
        decrypted = decryptCredentials(record.config, options.encryptionKey!);
      } catch {
        res.status(409).json({
          error: 'Google Calendar của bạn chưa được kết nối hoặc cần kết nối lại.',
          code: 'MYCALENDAR_NOT_CONNECTED',
        });
        return;
      }
      let accessToken: string;
      try {
        accessToken = await getAccessToken(user.id, record.id, decrypted.refreshToken);
      } catch (error: any) {
        if ((error instanceof GmailOAuthError && error.kind === 'invalid_grant') || error?.category === 'AUTH_ERROR') {
          try {
            await options.credentialRepo!.markReconnectRequired('mycalendar', user.id, record.id);
          } catch {}
          options.onConnectionChanged?.(user.id);
          res.status(409).json({
            error: 'Google Calendar của bạn chưa được kết nối hoặc cần kết nối lại.',
            code: 'MYCALENDAR_NOT_CONNECTED',
          });
          return;
        }
        res.status(502).json({
          error: 'Không tải được danh sách lịch từ Google Calendar. Hãy thử lại.',
          code: 'MYCALENDAR_FETCH_FAILED',
        });
        return;
      }
      let live;
      try {
        live = await client!.writableCalendars(accessToken, AbortSignal.timeout(googleTimeoutMs));
      } catch (error: any) {
        if (error instanceof GmailOAuthError && error.kind === 'invalid_grant') {
          try {
            await options.credentialRepo!.markReconnectRequired('mycalendar', user.id, record.id);
          } catch {}
          options.onConnectionChanged?.(user.id);
          res.status(409).json({
            error: 'Google Calendar của bạn chưa được kết nối hoặc cần kết nối lại.',
            code: 'MYCALENDAR_NOT_CONNECTED',
          });
          return;
        }
        res.status(502).json({
          error: 'Không tải được danh sách lịch từ Google Calendar. Hãy thử lại.',
          code: 'MYCALENDAR_FETCH_FAILED',
        });
        return;
      }
      const selectedCalendarIds = Array.isArray(decrypted.selectedCalendars)
        ? decrypted.selectedCalendars.map((c: any) => c.id)
        : [];
      res.json({ email: decrypted.email, calendars: live.calendars, selectedCalendarIds });
    } catch {
      res.status(502).json({
        error: 'Không tải được danh sách lịch từ Google Calendar. Hãy thử lại.',
        code: 'MYCALENDAR_FETCH_FAILED',
      });
    }
  });

  router.put('/scope', async (req, res) => {
    const user = (req as any).user as AuthUser;
    try {
      const requested = req.body?.calendarIds;
      if (!Array.isArray(requested) || !requested.length || requested.length > 20) {
        res.status(400).json({ error: 'Vui lòng chọn ít nhất một lịch hợp lệ.', code: 'MYCALENDAR_SCOPE_INVALID' });
        return;
      }
      const deduplicated = [...new Set(requested)];
      if (deduplicated.some((id) => typeof id !== 'string' || !CALENDAR_ID_PATTERN.test(id))) {
        res.status(400).json({ error: 'Vui lòng chọn ít nhất một lịch hợp lệ.', code: 'MYCALENDAR_SCOPE_INVALID' });
        return;
      }
      const record = await options.credentialRepo!.getPersonalCredentials('mycalendar', user.id);
      if (!record) {
        res.status(409).json({
          error: 'Google Calendar của bạn chưa được kết nối hoặc cần kết nối lại.',
          code: 'MYCALENDAR_NOT_CONNECTED',
        });
        return;
      }
      let decrypted: any;
      try {
        decrypted = decryptCredentials(record.config, options.encryptionKey!);
      } catch {
        res.status(409).json({
          error: 'Google Calendar của bạn chưa được kết nối hoặc cần kết nối lại.',
          code: 'MYCALENDAR_NOT_CONNECTED',
        });
        return;
      }
      let accessToken: string;
      try {
        accessToken = await getAccessToken(user.id, record.id, decrypted.refreshToken);
      } catch (error: any) {
        if ((error instanceof GmailOAuthError && error.kind === 'invalid_grant') || error?.category === 'AUTH_ERROR') {
          try {
            await options.credentialRepo!.markReconnectRequired('mycalendar', user.id, record.id);
          } catch {}
          options.onConnectionChanged?.(user.id);
          res.status(409).json({
            error: 'Google Calendar của bạn chưa được kết nối hoặc cần kết nối lại.',
            code: 'MYCALENDAR_NOT_CONNECTED',
          });
          return;
        }
        res.status(502).json({
          error: 'Không tải được danh sách lịch từ Google Calendar. Hãy thử lại.',
          code: 'MYCALENDAR_FETCH_FAILED',
        });
        return;
      }
      let live;
      try {
        live = await client!.writableCalendars(accessToken, AbortSignal.timeout(googleTimeoutMs));
      } catch (error: any) {
        if (error instanceof GmailOAuthError && error.kind === 'invalid_grant') {
          try {
            await options.credentialRepo!.markReconnectRequired('mycalendar', user.id, record.id);
          } catch {}
          options.onConnectionChanged?.(user.id);
          res.status(409).json({
            error: 'Google Calendar của bạn chưa được kết nối hoặc cần kết nối lại.',
            code: 'MYCALENDAR_NOT_CONNECTED',
          });
          return;
        }
        res.status(502).json({
          error: 'Không tải được danh sách lịch từ Google Calendar. Hãy thử lại.',
          code: 'MYCALENDAR_FETCH_FAILED',
        });
        return;
      }

      const writableMap = new Map<string, PersonalCalendarItem>(live.calendars.map((c) => [c.id, c]));
      for (const id of deduplicated) {
        if (!writableMap.has(id)) {
          res.status(400).json({
            error: 'Một hoặc nhiều lịch đã chọn không hợp lệ hoặc bạn không có quyền ghi.',
            code: 'MYCALENDAR_SCOPE_INVALID',
          });
          return;
        }
      }

      const selectedCalendars = deduplicated.map((id) => {
        const cal = writableMap.get(id)!;
        return {
          id: cal.id,
          summary: cal.summary,
          timeZone: cal.timeZone,
          ...(cal.primary ? { primary: true } : {}),
        };
      });

      const updated = await options.repo!.updateConfigIfActive(user.id, record.id, (oldConfig) => {
        const prev = decryptCredentials(oldConfig, options.encryptionKey!);
        return encryptCredentials(
          {
            ...prev,
            selectedCalendars,
            allowedScope: { calendars: selectedCalendars.map((c) => c.id) },
          },
          options.encryptionKey!
        );
      });

      if (!updated) {
        res.status(409).json({
          error: 'Kết nối Google Calendar đã thay đổi. Hãy thử lại.',
          code: 'MYCALENDAR_NOT_CONNECTED',
        });
        return;
      }

      options.onConnectionChanged?.(user.id);
      res.json({
        email: decrypted.email || live.email,
        selectedCalendars,
        allowedScope: selectedCalendars.map((c) => c.id),
      });
    } catch {
      res.status(500).json({ error: 'Không cập nhật được phạm vi Google Calendar. Vui lòng thử lại.' });
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
          console.warn(`[chat-api] MyCalendar revoke failed: ${error instanceof GmailOAuthError ? error.kind : 'error'}`);
        }
      };
      const current = await options.credentialRepo!.getPersonalConnectionStatus('mycalendar', user.id);
      await revokeRow(current?.config);
      const removed = await options.repo!.disconnect(user.id);
      if (removed && removed.id !== current?.id) await revokeRow(removed.config);
      options.onConnectionChanged?.(user.id);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: 'Không ngắt được kết nối Google Calendar. Vui lòng thử lại.' });
    }
  });

  return router;
}
