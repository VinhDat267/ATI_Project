import { Router } from 'express';
import { createSessionRoutes } from './session.js';
import { createSignupRoutes } from './signup.js';
import { createPasswordRoutes } from './password.js';
import { createGoogleRoutes, isGoogleEnabled } from './google.js';
import type { GoogleOAuthConfig } from '../../auth/google-oidc.js';
import type { EmailSender } from '../../services/email/index.js';
import type { AuthUser } from '../../auth/jwt.js';
import type { UserRepo } from '../../db/repositories/user-repo.js';
import type { SessionRepo } from '../../db/repositories/session-repo.js';
import { SignupQuota } from '../../auth/signup-quota.js';
import type { LoginFailures } from '../../auth/login-failures.js';

export const DEMO_ADMIN_ID = 'a0000000-0000-4000-8000-000000000001';

export interface AuthRoutesOptions {
  jwtSecret: string;
  userRepo?: UserRepo;
  sessionRepo?: SessionRepo;
  clock?: () => number;
  signupEnabled?: boolean;
  appBaseUrl?: string;
  emailSender?: EmailSender;
  runtimeMode?: 'sandbox' | 'live';
  googleOAuth?: GoogleOAuthConfig;
  googleFetchFn?: typeof fetch;
  googleSignupEnabled?: boolean;
  signupQuota?: SignupQuota;
  /** Shared with the account routes so a wrong current password counts as a failed login (AUTH-05). */
  loginFailures?: LoginFailures;
  validateCredentials?: (email: string, password: string) => Promise<AuthUser | null> | AuthUser | null;
}

export function createAuthRoutes(options: AuthRoutesOptions): Router {
  // Both identity providers spend the same in-memory IP/hour budget.
  options = { ...options, signupQuota: new SignupQuota(options.clock) };
  const router = Router();
  router.get('/config', (_req, res) => res.json({ signupEnabled: options.signupEnabled ?? false, googleEnabled: isGoogleEnabled(options) }));
  router.use(createSessionRoutes(options));
  router.use(createSignupRoutes(options));
  router.use(createPasswordRoutes(options));
  router.use(createGoogleRoutes(options));
  return router;
}
