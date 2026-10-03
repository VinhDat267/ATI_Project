import { Router } from 'express';
import { createSessionRoutes } from './session.js';
import type { AuthUser } from '../../auth/jwt.js';
import type { UserRepo } from '../../db/repositories/user-repo.js';
import type { SessionRepo } from '../../db/repositories/session-repo.js';

export const DEMO_ADMIN_ID = 'a0000000-0000-4000-8000-000000000001';

export interface AuthRoutesOptions {
  jwtSecret: string;
  userRepo?: UserRepo;
  sessionRepo?: SessionRepo;
  clock?: () => number;
  validateCredentials?: (email: string, password: string) => Promise<AuthUser | null> | AuthUser | null;
}

export function createAuthRoutes(options: AuthRoutesOptions): Router {
  const router = Router();
  router.get('/config', (_req, res) => res.json({ signupEnabled: false, googleEnabled: false }));
  router.use(createSessionRoutes(options));
  return router;
}
