import { Router, type Request, type Response } from 'express';
import {
  generateTokens,
  verifyRefreshToken,
  createAuthMiddleware,
  type AuthUser,
} from '../auth/jwt.js';

export interface AuthRoutesOptions {
  jwtSecret: string;
  findUserByEmail?: (email: string) => Promise<AuthUser | null>;
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

    // Default admin user or custom finder
    let user: AuthUser | null = null;
    if (options.findUserByEmail) {
      user = await options.findUserByEmail(email);
    } else if (email === 'admin@wap.local' && password === 'password123') {
      user = { id: 'u_admin', email: 'admin@wap.local', name: 'Administrator' };
    } else {
      // Allow standard demo user login
      user = {
        id: `u_${Buffer.from(email).toString('hex').slice(0, 8)}`,
        email,
        name: email.split('@')[0] || 'User',
      };
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
