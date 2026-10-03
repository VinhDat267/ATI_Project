import { Router } from "express";
import { RateLimit } from "../../auth/rate-limit.js";
import { hashPassword } from "../../db/repositories/user-repo.js";
import { sendAccountEmail } from "../../services/email/sender.js";
import type { AuthContext } from "./context.js";
const accepted = {
  message:
    "Kiểm tra email để xác minh tài khoản. Sau khi xác minh, quản trị viên sẽ duyệt quyền truy cập.",
};
export function signupRoutes(ctx: AuthContext) {
  const router = Router(),
    signupLimit = new RateLimit(10, 60 * 60_000),
    resendLimit = new RateLimit(3, 60 * 60_000);
  const sendVerification = async (user: { id: string; email: string }) => {
    const token = await ctx.accountRepo!.issueVerification(user.id);
    const url = new URL(ctx.appBaseUrl);
    url.search = "";
    url.hash = "";
    url.searchParams.set("view", "verify-email");
    url.searchParams.set("token", token);
    await sendAccountEmail(ctx.emailSender!, {
      to: user.email,
      subject: "Xác minh email của bạn · Planora",
      text: `Chào bạn,\nXác minh email để tiếp tục đăng ký Planora:\n${url.href}\nLink dùng một lần, có hiệu lực trong 24 giờ. Sau đó tài khoản cần quản trị viên duyệt.`,
    });
  };
  router.use((req, res, next) => {
    if (!ctx.accountRepo || !ctx.emailSender) {
      res
        .status(503)
        .json({ error: "Đăng ký và xác minh tài khoản cần PostgreSQL." });
      return;
    }
    next();
  });
  router.post("/signup", async (req, res) => {
    if (!ctx.signupEnabled) {
      res
        .status(403)
        .json({ error: "Đăng ký hiện đang đóng. Hãy liên hệ quản trị viên." });
      return;
    }
    const key = req.ip || "unknown",
      delay = signupLimit.blocked(key);
    if (delay) {
      res.setHeader("Retry-After", delay);
      res
        .status(429)
        .json({ error: "Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau." });
      return;
    }
    signupLimit.record(key);
    const { name, email, password } = req.body || {};
    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.trim().length > 100 ||
      typeof email !== "string" ||
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      typeof password !== "string" ||
      password.length < 12 ||
      password.length > 128
    ) {
      res
        .status(400)
        .json({
          error: "Nhập tên, email hợp lệ và mật khẩu từ 12 đến 128 ký tự.",
        });
      return;
    }
    const normalized = email.trim().toLowerCase();
    const { rows } = await ctx.accountRepo!.pool.query(
      `INSERT INTO users(email,name,password,status,email_verified,role)
      VALUES($1,$2,$3,'pending',FALSE,'member') ON CONFLICT(email) DO NOTHING RETURNING id,email`,
      [normalized, name.trim(), hashPassword(password)],
    );
    if (rows[0]) await sendVerification(rows[0]);
    else
      await sendAccountEmail(ctx.emailSender!, {
        to: normalized,
        subject: "Một yêu cầu đăng ký với email của bạn · Planora",
        text: "Có người vừa thử đăng ký Planora bằng email này. Tài khoản hiện tại không thay đổi. Nếu không phải bạn, có thể bỏ qua thư này.",
      });
    res.status(202).json(accepted);
  });
  router.post("/resend-verification", async (req, res) => {
    const email =
      typeof req.body?.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";
    if (
      !email ||
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      res.status(400).json({ error: "Nhập email hợp lệ." });
      return;
    }
    const key = email,
      delay = resendLimit.blocked(key);
    if (delay) {
      res.setHeader("Retry-After", delay);
      res
        .status(429)
        .json({ error: "Hãy đợi trước khi yêu cầu email xác minh tiếp theo." });
      return;
    }
    resendLimit.record(key);
    const user = await ctx.userRepo!.findByEmail(email);
    if (user && !user.email_verified && user.status !== "disabled")
      await sendVerification(user);
    res.status(202).json(accepted);
  });
  router.post("/verify-email", async (req, res) => {
    const token = req.body?.token;
    if (typeof token !== "string" || token.length > 128) {
      res
        .status(400)
        .json({ error: "Link xác minh không hợp lệ hoặc đã hết hạn." });
      return;
    }
    const user = await ctx.accountRepo!.verifyEmail(token);
    if (!user) {
      res
        .status(400)
        .json({
          error:
            "Link xác minh không hợp lệ hoặc đã hết hạn. Hãy yêu cầu email mới.",
        });
      return;
    }
    const { rows } = await ctx.accountRepo!.pool.query(
      "SELECT email FROM users WHERE status='active' AND (role='admin' OR id=ANY($1::uuid[]))",
      [ctx.adminIds],
    );
    for (const admin of rows)
      await sendAccountEmail(ctx.emailSender!, {
        to: admin.email,
        subject: "Tài khoản mới chờ duyệt · Planora",
        text: "Có tài khoản đã xác minh email và đang chờ duyệt. Mở Cài đặt → Duyệt tài khoản trong Planora để kiểm tra.",
      });
    res.json({
      message: "Email đã xác minh. Tài khoản đang chờ quản trị viên duyệt.",
    });
  });
  return router;
}
