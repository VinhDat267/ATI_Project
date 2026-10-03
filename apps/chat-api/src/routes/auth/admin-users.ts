import { Router } from "express";
import { isAdmin, publicUser } from "../../auth/accounts.js";
import { sendAccountEmail } from "../../services/email/sender.js";
import type { AuthContext } from "./context.js";
export function adminUserRoutes(ctx: AuthContext) {
  const router = Router();
  router.use(ctx.middleware, (req, res, next) => {
    if (!ctx.accountRepo) {
      res.status(503).json({ error: "Quản lý tài khoản cần PostgreSQL." });
      return;
    }
    if (!isAdmin((req as any).user, ctx.adminIds)) {
      res
        .status(403)
        .json({ error: "Chỉ quản trị viên được duyệt tài khoản." });
      return;
    }
    next();
  });
  router.get("/", async (req, res) => {
    const status = req.query.status === "all" ? null : "pending",
      search = typeof req.query.q === "string" ? req.query.q.slice(0, 100) : "";
    const page = Math.floor(
        Math.max(1, Math.min(10000, Number(req.query.page) || 1)),
      ),
      params = [status, `%${search}%`];
    const count = await ctx.accountRepo!.pool.query(
      "SELECT COUNT(*) FROM users WHERE ($1::text IS NULL OR status=$1) AND (email ILIKE $2 OR name ILIKE $2)",
      params,
    );
    const { rows } = await ctx.accountRepo!.pool.query(
      `SELECT * FROM users WHERE ($1::text IS NULL OR status=$1) AND (email ILIKE $2 OR name ILIKE $2)
      ORDER BY created_at DESC,id LIMIT 20 OFFSET $3`,
      [...params, (page - 1) * 20],
    );
    res.json({
      users: rows.map((row) => ({
        ...publicUser(row, ctx.adminIds),
        createdAt: row.created_at,
      })),
      total: Number(count.rows[0].count),
      page,
    });
  });
  router.post("/:id/approve", async (req, res) => {
    const id = String(req.params.id);
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      )
    ) {
      res.status(400).json({ error: "Tài khoản không hợp lệ." });
      return;
    }
    const row = await ctx.accountRepo!.approve(id);
    if (!row) {
      res
        .status(409)
        .json({
          error:
            "Chỉ duyệt tài khoản đang chờ và đã xác minh email. Hãy tải lại danh sách.",
        });
      return;
    }
    if (ctx.emailSender)
      await sendAccountEmail(ctx.emailSender, {
        to: row.email,
        subject: "Tài khoản đã được duyệt · Planora",
        text: "Tài khoản Planora của bạn đã được quản trị viên duyệt. Bạn có thể đăng nhập và bắt đầu làm việc.",
      });
    console.info(
      JSON.stringify({
        event: "account_approved",
        actor: (req as any).user.id,
        target: row.id,
        at: new Date().toISOString(),
      }),
    );
    res.json({ user: publicUser(row, ctx.adminIds) });
  });
  return router;
}
