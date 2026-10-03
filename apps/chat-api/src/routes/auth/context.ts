import type { RequestHandler } from "express";
import type { AuthUser } from "../../auth/jwt.js";
import type { AccountRepo } from "../../auth/accounts.js";
import type { UserRepo } from "../../db/repositories/user-repo.js";
import type { EmailSender } from "../../services/email/sender.js";
export interface AuthContext {
  jwtSecret: string;
  userRepo?: UserRepo;
  accountRepo?: AccountRepo;
  validateCredentials?: (
    email: string,
    password: string,
  ) => Promise<AuthUser | null> | AuthUser | null;
  adminIds: string[];
  middleware: RequestHandler;
  signupEnabled: boolean;
  emailSender?: EmailSender;
  appBaseUrl: string;
}
