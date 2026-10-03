import { Router } from "express";
import { generateTokens, verifyRefreshToken } from "../../auth/jwt.js";
import { publicUser } from "../../auth/accounts.js";
import {
  hashPassword,
  verifyPassword,
} from "../../db/repositories/user-repo.js";
import { RateLimit } from "../../auth/rate-limit.js";
import type { AuthContext } from "./context.js";
const dummyPassword = hashPassword("Not-a-real-account-password");
export function sessionRoutes(ctx: AuthContext) {
  const router = Router(),
    failures = new RateLimit(5, 15 * 60_000);
  router.post("/login", async (req, res) => {
    const { email, password } = req.body || {};
    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !email.trim() ||
      !password ||
      email.length > 254 ||
      password.length > 128
    ) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }
    const normalized = email.trim().toLowerCase(),
      key = `${req.ip}:${normalized}`,
      delay = failures.blocked(key);
    if (delay) {
      res.setHeader("Retry-After", delay);
      res
        .status(429)
        .json({
          error: "Bạn đã thử quá nhiều lần. Vui lòng thử lại sau 15 phút.",
        });
      return;
    }
    let user = null;
    if (ctx.accountRepo && ctx.userRepo) {
      const row = await ctx.userRepo.findByEmail(normalized),
        valid = verifyPassword(password, row?.password || dummyPassword);
      if (row && valid) {
        if (row.status === "disabled") {
          res
            .status(403)
            .json({
              code: "ACCOUNT_DISABLED",
              error: "Tài khoản đã bị khóa. Hãy liên hệ quản trị viên.",
            });
          return;
        }
        if (!row.email_verified) {
          res
            .status(403)
            .json({
              code: "EMAIL_UNVERIFIED",
              error: "Hãy xác minh email trước khi đăng nhập.",
            });
          return;
        }
        if (row.status !== "active") {
          res
            .status(403)
            .json({
              code: "ACCOUNT_PENDING",
              error:
                "Email đã xác minh. Tài khoản đang chờ quản trị viên duyệt.",
            });
          return;
        }
        user = publicUser(row, ctx.adminIds);
      }
    } else if (ctx.validateCredentials)
      user = await ctx.validateCredentials(normalized, password);
    else if (ctx.userRepo) {
      const row = await ctx.userRepo.findByEmail(normalized);
      if (row && verifyPassword(password, row.password))
        user = { id: row.id, email: row.email, name: row.name };
    }
    if (!user) {
      failures.record(key);
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }
    failures.clear(key);
    if (ctx.accountRepo) {
      const session = await ctx.accountRepo.createSession(
        user.id,
        req.get("user-agent"),
      );
      res.json({
        ...generateTokens(user, ctx.jwtSecret, { sessionId: session.sid }),
        refreshToken: session.refreshToken,
        user,
      });
    } else res.json({ ...generateTokens(user, ctx.jwtSecret), user });
  });
  router.post("/refresh", async (req, res) => {
    const token = req.body?.refreshToken;
    if (typeof token !== "string" || !token || token.length > 2048) {
      res.status(400).json({ error: "refreshToken is required" });
      return;
    }
    if (ctx.accountRepo && ctx.userRepo) {
      const rotated = await ctx.accountRepo.rotate(token);
      if (rotated.code === "REFRESH_ROTATED") {
        res
          .status(409)
          .json({
            code: "REFRESH_ROTATED",
            error: "Phiên đã được làm mới ở cửa sổ khác.",
          });
        return;
      }
      if (rotated.code !== "OK") {
        res
          .status(401)
          .json({ error: "Phiên đã hết hiệu lực. Vui lòng đăng nhập lại." });
        return;
      }
      const row = await ctx.userRepo.findById(rotated.userId);
      if (!row) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      res.json({
        ...generateTokens(publicUser(row, ctx.adminIds), ctx.jwtSecret, {
          sessionId: rotated.sid,
        }),
        refreshToken: rotated.refreshToken,
      });
      return;
    }
    try {
      res.json(
        generateTokens(verifyRefreshToken(token, ctx.jwtSecret), ctx.jwtSecret),
      );
    } catch {
      res.status(401).json({ error: "Invalid or expired refresh token" });
    }
  });
  router.get("/me", ctx.middleware, (req, res) => {
    res.json({ user: (req as any).user });
  });
  router.post("/logout", ctx.middleware, async (req, res) => {
    const user = (req as any).user;
    if (ctx.accountRepo) await ctx.accountRepo.revoke(user.id, user.sid);
    res.sendStatus(204);
  });
  router.post("/logout-all", ctx.middleware, async (req, res) => {
    if (ctx.accountRepo) await ctx.accountRepo.revoke((req as any).user.id);
    res.sendStatus(204);
  });
  return router;
}
