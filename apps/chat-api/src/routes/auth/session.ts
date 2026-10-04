import { Router, type Request, type Response } from 'express';
import { createAuthMiddleware, generateAccessToken, generateTokens, verifyRefreshToken, type AuthUser } from '../../auth/jwt.js';
import { hashPassword, toAuthUser, verifyPassword } from '../../db/repositories/user-repo.js';
import type { AuthRoutesOptions } from './index.js';
import { InvalidSessionUserError } from '../../db/repositories/session-repo.js';

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const DUMMY_PASSWORD = hashPassword('dummy-login-password-for-missing-users');

export function createSessionRoutes(options: AuthRoutesOptions): Router {
  const router = Router();
  const clock = options.clock ?? Date.now;
  const sessions = options.sessionRepo ?? options.userRepo?.sessions;
  const auth = createAuthMiddleware(options.jwtSecret, { sessionRepo: sessions, clock });
  const failures = new Map<string, { count: number; expiresAt: number }>();
  const pendingLogins = new Map<string, Promise<void>>();

  router.post('/login', async (req: Request, res: Response): Promise<void> => {
    const body = req.body ?? {};
    if (typeof body.email !== 'string' || !body.email.trim() || typeof body.password !== 'string' || !body.password || body.password.length > 128) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }
    const email = body.email.trim().toLowerCase();
    const key = JSON.stringify([req.ip, email]);
    // Serialize password verification per IP/email so concurrent requests cannot
    // all pass the failure limit before PostgreSQL returns their account lookup.
    const preceding = pendingLogins.get(key) ?? Promise.resolve();
    const verification = preceding.catch(() => {}).then(async () => {
      const now = clock();
      let bucket = failures.get(key);
      if (bucket && bucket.expiresAt <= now) { failures.delete(key); bucket = undefined; }
      if (bucket && bucket.count >= 5) {
        res.setHeader('Retry-After', String(Math.ceil((bucket.expiresAt - now) / 1000)));
        res.status(429).json({ error: 'Too many login attempts. Try again later.' });
        return;
      }

      let user: AuthUser | null = null;
      let expectedPasswordHash: string | null | undefined;
      if (options.userRepo) {
        const found = await options.userRepo.findByEmail(email);
        const valid = verifyPassword(body.password, found?.password ?? DUMMY_PASSWORD);
        if (found && found.password && valid) { user = toAuthUser(found); expectedPasswordHash = found.password; }
      } else if (options.validateCredentials) {
        user = await options.validateCredentials(email, body.password);
      }
      if (!user) {
        const finishedAt = clock();
        for (const [oldKey, failure] of failures) if (failure.expiresAt <= finishedAt) failures.delete(oldKey);
        // The lookup awaits PostgreSQL: count against the current bucket, including
        // failures that other requests completed during that await.
        const current = failures.get(key);
        failures.set(key, { count: (current?.count ?? 0) + 1, expiresAt: current?.expiresAt ?? finishedAt + LOGIN_WINDOW_MS });
        res.status(401).json({ error: 'Invalid email or password' });
        return;
      }
      failures.delete(key);
      if (options.userRepo && user.status !== 'active') {
        const code = user.status === 'disabled' ? 'ACCOUNT_DISABLED' : 'ACCOUNT_PENDING';
        res.status(403).json({ error: 'Account is not active', code });
        return;
      }
      if (options.userRepo && !sessions) {
        res.status(503).json({ error: 'PostgreSQL sessions are required' });
        return;
      }
      if (sessions) {
        let session;
        try { session = await sessions.create(user.id, req.get('User-Agent'), now, expectedPasswordHash); }
        catch (error) {
          if (!(error instanceof InvalidSessionUserError)) throw error;
          res.status(401).json({ error: 'Email hoặc mật khẩu không chính xác' }); return;
        }
        res.json({ user, ...generateAccessToken(user, options.jwtSecret, session.sessionId, now), refreshToken: session.refreshToken });
        return;
      }
      res.json({ user, ...generateTokens(user, options.jwtSecret) });
    });
    pendingLogins.set(key, verification);
    try { await verification; }
    finally { if (pendingLogins.get(key) === verification) pendingLogins.delete(key); }
  });

  router.post('/refresh', async (req: Request, res: Response): Promise<void> => {
    const refreshToken = req.body?.refreshToken;
    if (typeof refreshToken !== 'string' || !refreshToken) {
      res.status(400).json({ error: 'refreshToken is required' });
      return;
    }
    if (sessions) {
      const now = clock();
      const result = await sessions.rotate(refreshToken, now);
      if (result.kind === 'conflict') {
        res.status(409).json({ error: 'Refresh token was rotated by another request', code: 'REFRESH_ROTATED' });
      } else if (result.kind === 'invalid') {
        res.status(401).json({ error: 'Invalid or expired refresh token' });
      } else {
        res.json({ ...generateAccessToken(result.user, options.jwtSecret, result.sessionId, now), refreshToken: result.refreshToken });
      }
      return;
    }
    if (options.userRepo) {
      res.status(503).json({ error: 'PostgreSQL sessions are required' });
      return;
    }
    try {
      const user = verifyRefreshToken(refreshToken, options.jwtSecret);
      res.json(generateTokens(user, options.jwtSecret));
    } catch {
      res.status(401).json({ error: 'Invalid or expired refresh token' });
    }
  });

  const requireSessions = (_req: Request, res: Response, next: () => void) => {
    if (!sessions) { res.status(503).json({ error: 'PostgreSQL is required for session revocation' }); return; }
    next();
  };
  router.post('/logout', requireSessions, auth, async (req, res): Promise<void> => {
    const user = (req as any).user as AuthUser;
    await sessions!.revoke(user.sid!, user.id, clock());
    res.json({ success: true });
  });
  router.post('/logout-all', requireSessions, auth, async (req, res): Promise<void> => {
    const user = (req as any).user as AuthUser;
    await sessions!.revokeAll(user.id, clock());
    res.json({ success: true });
  });
  router.get('/me', auth, (req, res) => res.json({ user: (req as any).user }));
  return router;
}
