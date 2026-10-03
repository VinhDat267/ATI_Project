import { Router } from "express";
import { createAuthMiddleware } from "../../auth/jwt.js";
import { AccountRepo, publicUser } from "../../auth/accounts.js";
import { OutboxEmailSender } from "../../services/email/sender.js";
import type { EmailSender } from "../../services/email/sender.js";
import type { UserRepo } from "../../db/repositories/user-repo.js";
import type { AuthUser } from "../../auth/jwt.js";
import { sessionRoutes } from "./session.js";
import { signupRoutes } from "./signup.js";
import { adminUserRoutes } from "./admin-users.js";
import type { AuthContext } from "./context.js";
export const DEMO_ADMIN_ID = "a0000000-0000-4000-8000-000000000001";
export interface AuthRoutesOptions {
  jwtSecret: string;
  userRepo?: UserRepo;
  validateCredentials?: (
    email: string,
    password: string,
  ) => Promise<AuthUser | null> | AuthUser | null;
  adminIds?: string[];
  signupEnabled?: boolean;
  emailSender?: EmailSender;
  appBaseUrl?: string;
}
export function authContext(options: AuthRoutesOptions): AuthContext {
  const accountRepo = options.userRepo?.pool
      ? new AccountRepo(options.userRepo.pool)
      : undefined,
    adminIds = options.adminIds || [];
  const middleware = createAuthMiddleware(
    options.jwtSecret,
    accountRepo
      ? {
          validateSession: async (sid, id) => {
            const row = await accountRepo.validateSession(sid, id);
            return row ? publicUser(row, adminIds) : null;
          },
        }
      : undefined,
  );
  return {
    ...options,
    accountRepo,
    adminIds,
    middleware,
    signupEnabled: options.signupEnabled ?? true,
    emailSender:
      options.emailSender ||
      (accountRepo ? new OutboxEmailSender(accountRepo.pool) : undefined),
    appBaseUrl: options.appBaseUrl || "http://127.0.0.1:5175/",
  };
}
export function createAuthRoutes(options: AuthRoutesOptions | AuthContext) {
  const ctx = "middleware" in options ? options : authContext(options),
    router = Router();
  router.get("/config", (_req, res) => {
    res.json({
      signupEnabled:
        ctx.signupEnabled && Boolean(ctx.accountRepo && ctx.emailSender),
      googleEnabled: false,
    });
  });
  router.use(sessionRoutes(ctx));
  router.use(signupRoutes(ctx));
  return router;
}
export { adminUserRoutes };
