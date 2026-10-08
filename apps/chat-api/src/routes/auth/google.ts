import { Router, type Request, type Response } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { createAuthMiddleware, generateAccessToken, type AuthUser } from '../../auth/jwt.js';
import { LoginFailures } from '../../auth/login-failures.js';
import { GOOGLE_ENDPOINTS, GoogleOIDC } from '../../auth/google-oidc.js';
import { GoogleAccountError } from '../../db/repositories/google-auth-repo.js';
import { toAuthUser, verifyPassword } from '../../db/repositories/user-repo.js';
import { InvalidSessionUserError } from '../../db/repositories/session-repo.js';
import { googleLinkedEmail, pendingApprovalEmail, sendEmailInBackground } from '../../services/email/index.js';
import type { AuthRoutesOptions } from './index.js';
import { SignupQuota, SignupRateLimitError } from '../../auth/signup-quota.js';
const random = () => randomBytes(32).toString('base64url');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const COOKIE = 'ati_google_browser';
const valid = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
function binding(req: Request): string | undefined {
  return req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
}
export function isGoogleEnabled(options: AuthRoutesOptions): boolean {
  return Boolean(options.userRepo && options.googleOAuth?.clientId && options.googleOAuth.clientSecret && options.googleOAuth.redirectUri);
}
export function createGoogleRoutes(options: AuthRoutesOptions): Router {
  const router = Router();
  const clock = options.clock ?? Date.now;
  const failures = options.loginFailures ?? new LoginFailures(clock);
  const signupQuota = options.signupQuota ?? new SignupQuota(clock);
  const sessions = options.sessionRepo ?? options.userRepo?.sessions;
  const repo = options.userRepo?.googleAuth;
  const config = options.googleOAuth ? { ...options.googleOAuth, ...(options.runtimeMode === 'live' ? GOOGLE_ENDPOINTS : {}) } : undefined;
  const oidc = config ? new GoogleOIDC(config, { fetchFn: options.googleFetchFn, clock }) : undefined;
  const auth = createAuthMiddleware(options.jwtSecret, { sessionRepo: sessions, clock });
  const unavailable = (_req: Request, res: Response, next: () => void) => {
    if (!isGoogleEnabled(options) || !repo || !sessions) { res.status(503).json({ error: 'Đăng nhập Google chưa được cấu hình.' }); return; }
    next();
  };
  const failure = (res: Response, error: unknown) => {
    if (error instanceof SignupRateLimitError) {
      res.setHeader('Retry-After', String(error.retryAfter));
      res.status(429).json({ error: error.message, code: 'SIGNUP_RATE_LIMITED' });
    } else if (error instanceof GoogleAccountError) {
      const code = error.code;
      res.status(code === 'INVALID_SESSION' ? 401 : code === 'SIGNUP_DISABLED' ? 403 : 409).json({ error: error.message, code });
    } else if (error instanceof InvalidSessionUserError) {
      res.status(401).json({ error: 'Phiên đăng nhập không còn hợp lệ.', code: 'INVALID_SESSION' });
    } else res.status(400).json({ error: 'Không thể xác thực Google. Vui lòng thử lại.', code: 'GOOGLE_AUTH_FAILED' });
  };
  router.post('/google/start', unavailable, (req, res, next) => {
    if (req.body?.mode === 'link') auth(req, res, next); else next();
  }, async (req, res) => {
    const mode = req.body?.mode;
    if (mode !== 'login' && mode !== 'link') { res.status(400).json({ error: 'Chế độ đăng nhập Google không hợp lệ.' }); return; }
    try {
      const state = random(), nonce = random(), verifier = random();
      const browser = valid(binding(req)) ? binding(req)! : random();
      const user = (req as any).user as AuthUser | undefined;
      await repo!.createState({ state_hash: hash(state), browser_binding_hash: hash(browser), code_verifier: verifier, nonce,
        mode, user_id: mode === 'link' ? user!.id : null, session_id: mode === 'link' ? user!.sid! : null }, clock());
      const url = new URL(config!.authorizationUrl);
      for (const [key, value] of Object.entries({ client_id: config!.clientId, redirect_uri: config!.redirectUri, response_type: 'code',
        scope: 'openid email profile', state, nonce, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') })) url.searchParams.set(key, value);
      res.cookie(COOKIE, browser, { httpOnly: true, sameSite: 'lax', secure: new URL(config!.redirectUri).protocol === 'https:', maxAge: 600000, path: '/api/auth/google' });
      res.setHeader('Cache-Control', 'no-store'); res.json({ url: url.href });
    } catch (error) { failure(res, error); }
  });
  router.post('/google/callback', unavailable, async (req, res, next) => {
    const state = req.body?.state, code = req.body?.code, browser = binding(req);
    if (!valid(state) || !valid(browser) || typeof code !== 'string' || !code || code.length > 4096) {
      res.status(400).json({ error: 'Yêu cầu Google không hợp lệ.', code: 'GOOGLE_AUTH_FAILED' }); return;
    }
    try {
      const stored = await repo!.findState(state, browser, clock());
      if (!stored) { res.status(400).json({ error: 'Yêu cầu Google đã hết hạn hoặc đã sử dụng.', code: 'GOOGLE_AUTH_FAILED' }); return; }
      if (stored.mode === 'link') auth(req, res, next); else next();
    } catch (error) { failure(res, error); }
  }, async (req, res) => {
    try {
      const caller = (req as any).user as AuthUser | undefined;
      const state = await repo!.consumeState(req.body.state, binding(req)!, clock(), caller?.id, caller?.sid);
      if (!state) { res.status(400).json({ error: 'Yêu cầu Google đã hết hạn hoặc đã sử dụng.', code: 'GOOGLE_AUTH_FAILED' }); return; }
      const profile = await oidc!.exchangeCode(req.body.code, state.code_verifier, state.nonce);
      const result = await repo!.resolveAccount(profile, state, options.googleSignupEnabled ?? options.signupEnabled ?? false, clock(),
        () => signupQuota.take(req.ip ?? 'unknown'));
      if (result.linked) sendEmailInBackground(options.emailSender, googleLinkedEmail(result.user.email));
      if (result.created && options.emailSender) {
        const admins = await options.userRepo!.listActiveAdmins();
        for (const admin of admins) sendEmailInBackground(options.emailSender, pendingApprovalEmail(admin.email, result.user.name, result.user.email));
      }
      if (state.mode === 'link') { res.json({ success: true }); return; }
      if (result.user.status !== 'active') {
        res.status(403).json({ error: 'Tài khoản chưa được phép đăng nhập.', code: result.user.status === 'disabled' ? 'ACCOUNT_DISABLED' : 'ACCOUNT_PENDING' }); return;
      }
      const user = toAuthUser(result.user);
      const session = await sessions!.create(user.id, req.get('User-Agent'), clock(), undefined, profile.sub);
      res.setHeader('Cache-Control', 'no-store'); res.json({ user, ...generateAccessToken(user, options.jwtSecret, session.sessionId, clock()), refreshToken: session.refreshToken });
    } catch (error) { failure(res, error); }
  });
  router.post('/google/unlink', unavailable, auth, async (req, res) => {
    const currentPassword = req.body?.currentPassword;
    if (typeof currentPassword !== 'string' || !currentPassword || currentPassword.length > 128) {
      res.status(400).json({ error: 'Vui lòng nhập mật khẩu hiện tại.', code: 'CURRENT_PASSWORD_REQUIRED' }); return;
    }
    try {
      const user = (req as any).user as AuthUser;
      const account = await options.userRepo!.findById(user.id);
      if (!account || account.status !== 'active') throw new GoogleAccountError('INVALID_SESSION');
      if (!account.password) throw new GoogleAccountError('PASSWORD_REQUIRED');
      const key = LoginFailures.key(req.ip, account.email);
      await failures.serialize(key, async () => {
        const retryAfter = failures.retryAfter(key);
        if (retryAfter !== null) {
          res.setHeader('Retry-After', String(retryAfter));
          res.status(429).json({ error: 'Bạn đã nhập sai mật khẩu quá nhiều lần. Vui lòng thử lại sau.' }); return;
        }
        // Wrong credentials do not invalidate an otherwise valid account session.
        if (!verifyPassword(currentPassword, account.password)) {
          failures.record(key);
          res.status(400).json({ error: 'Mật khẩu hiện tại không đúng.', code: 'INVALID_CURRENT_PASSWORD' }); return;
        }
        await repo!.unlink(user.id, user.sid!, account.password!, clock());
        failures.clear(key);
        res.json({ success: true });
      });
    }
    catch (error) { failure(res, error); }
  });
  return router;
}
