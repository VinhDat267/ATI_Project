import { Router, type Request, type Response } from 'express';
import type { AuthUser } from '../../auth/jwt.js';
import { AdminUserError, type AdminUserRepo, type AdminAction, type AccountStatus, type AccountRole } from '../../db/repositories/admin-user-repo.js';
import { approvalEmail, sendEmailSafely, type EmailSender } from '../../services/email/index.js';

export interface AdminUsersOptions {
  adminUserRepo?: AdminUserRepo;
  adminAuditLogger?: Pick<Console, 'info'>;
  emailSender?: EmailSender;
}
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const invalid = () => new AdminUserError(400, 'INVALID_ADMIN_REQUEST', 'Thông tin quản trị người dùng không hợp lệ.');
function integer(value: unknown, fallback: number, max: number) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || Number(value) > max) throw invalid();
  return Number(value);
}
function failure(res: Response, error: unknown) {
  if (error instanceof AdminUserError) res.status(error.status).json({ code: error.code, error: error.message });
  else res.status(503).json({ code: 'ADMIN_DATABASE_UNAVAILABLE', error: 'Không thể truy cập dữ liệu quản trị. Hãy thử lại sau.' });
}
export function createAdminUsersRoutes(options: AdminUsersOptions): Router {
  const router = Router();
  router.use((req, res, next) => {
    if (!options.adminUserRepo) { res.status(503).json({ error: 'Quản trị người dùng cần PostgreSQL.' }); return; }
    const actor = (req as Request & { user?: AuthUser }).user;
    // This user has already been read from PostgreSQL by auth middleware;
    // the repository checks again inside each transaction after lock wait.
    if (!actor || actor.role !== 'admin' || !actor.sid) { res.status(403).json({ code: 'ADMIN_REQUIRED', error: 'Bạn không có quyền quản trị người dùng.' }); return; }
    next();
  });
  router.get('/', async (req, res) => {
    try {
      if (Object.keys(req.query).some(key => !['status', 'search', 'page', 'limit'].includes(key))) throw invalid();
      const status = req.query.status;
      if (status !== undefined && !['pending', 'active', 'disabled'].includes(status as string)) throw invalid();
      const search = req.query.search;
      if (search !== undefined && (typeof search !== 'string' || search.length > 200)) throw invalid();
      const result = await options.adminUserRepo!.list((req as any).user.id, { status: status as AccountStatus | undefined, search: search as string | undefined, page: integer(req.query.page, 1, 100_000), limit: integer(req.query.limit, 20, 100) });
      res.json(result);
    } catch (error) { failure(res, error); }
  });
  for (const action of ['approve', 'disable', 'enable', 'role'] as const satisfies readonly AdminAction[]) {
    router.post(`/:id/${action}`, async (req, res) => {
      try {
        const targetId = String(req.params.id).toLowerCase();
        if (!uuid.test(targetId)) throw invalid();
        const role = req.body?.role;
        if (action === 'role' && role !== 'member' && role !== 'admin') throw invalid();
        if (action === 'approve' && !options.emailSender) throw new AdminUserError(503, 'APPROVAL_EMAIL_UNAVAILABLE', 'Chưa cấu hình email thông báo duyệt tài khoản.');
        const actor = (req as any).user as AuthUser;
        const result = await options.adminUserRepo!.mutate(actor.id, actor.sid!, targetId, action, role as AccountRole | undefined);
        (options.adminAuditLogger ?? console).info(JSON.stringify({ event: 'admin_user_changed', actorId: actor.id, targetId, action, at: result.at.toISOString() }));
        if (action === 'approve') await sendEmailSafely(options.emailSender, approvalEmail(result.user.email, result.user.name));
        res.json({ user: result.user });
      } catch (error) { failure(res, error); }
    });
  }
  return router;
}
