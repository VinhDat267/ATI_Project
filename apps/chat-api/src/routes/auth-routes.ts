import { Router, type Request, type Response } from 'express';
import {
  generateTokens,
  verifyRefreshToken,
  createAuthMiddleware,
  type AuthUser,
} from '../auth/jwt.js';
import { UserRepo, verifyPassword } from '../db/repositories/user-repo.js';

export const DEMO_ADMIN_ID = 'a0000000-0000-4000-8000-000000000001';

export interface AuthRoutesOptions {
  jwtSecret: string;
  userRepo?: UserRepo;
  findUserByEmail?: (email: string) => Promise<AuthUser | null>;
  validateCredentials?: (
    email: string,
    password: string
  ) => Promise<AuthUser | null> | AuthUser | null;
}

export function createAuthRoutes(options: AuthRoutesOptions): Router {
  const router = Router();
  const { jwtSecret } = options;
  const authMiddleware = createAuthMiddleware(jwtSecret);

  // POST /api/auth/login
  router.post('/login', async (req: Request, res: Response): Promise<void> => {
    const { email, password } = req.body || {};

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    let user: AuthUser | null = null;
    if (options.validateCredentials) {
      user = await options.validateCredentials(email, password);
    } else if (options.userRepo) {
      const dbUser = await options.userRepo.findByEmail(email);
      if (dbUser && verifyPassword(password, dbUser.password)) {
        user = { id: dbUser.id, email: dbUser.email, name: dbUser.name };
      }
    } else if (options.findUserByEmail) {
      user = await options.findUserByEmail(email);
    } else if (email === 'admin@wap.local' && password === 'password123') {
      user = { id: DEMO_ADMIN_ID, email: 'admin@wap.local', name: 'Administrator' };
    }

    if (!user) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const tokens = generateTokens(user, jwtSecret);
    res.status(200).json({
      user,
      ...tokens,
    });
  });

  // POST /api/auth/refresh
  router.post('/refresh', (req: Request, res: Response): Promise<void> => {
    const { refreshToken } = req.body || {};

    if (!refreshToken) {
      res.status(400).json({ error: 'refreshToken is required' });
      return Promise.resolve();
    }

    try {
      const user = verifyRefreshToken(refreshToken, jwtSecret);
      const newTokens = generateTokens(user, jwtSecret);
      res.status(200).json(newTokens);
      return Promise.resolve();
    } catch (err: any) {
      res.status(401).json({ error: err?.message || 'Invalid or expired refresh token' });
      return Promise.resolve();
    }
  });

  // GET /api/auth/me
  router.get('/me', authMiddleware, (req: Request, res: Response): void => {
    res.status(200).json({ user: (req as any).user });
  });

  return router;
}
