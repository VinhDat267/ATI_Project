import { Router, type Request, type Response } from 'express';
import type { AuthUser } from '../../auth/jwt.js';
import {
  AdminUserError,
  type AdminUserRepo,
  type AdminAction,
  type AccountStatus,
  type AccountRole,
} from '../../db/repositories/admin-user-repo.js';
import {
  approvalEmail,
  sendEmailSafely,
  sendEmailInBackground,
  workspaceApprovedEmail,
  type EmailSender,
} from '../../services/email/index.js';

export interface AdminUsersOptions {
  adminUserRepo?: AdminUserRepo;
  adminAuditLogger?: Pick<Console, 'info'>;
  emailSender?: EmailSender;
}

export type AdminUserRouteOptions = AdminUsersOptions;

const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const invalid = () => new AdminUserError(400, 'INVALID_ADMIN_REQUEST', 'Thông tin quản trị người dùng không hợp lệ.');

function integer(value: unknown, fallback: number, max: number) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || Number(value) > max) throw invalid();
  return Number(value);
}

function failure(res: Response, error: unknown) {
  if (error instanceof AdminUserError) {
    res.status(error.status).json({ code: error.code, error: error.message, message: error.message });
  } else {
    res.status(503).json({ code: 'ADMIN_DATABASE_UNAVAILABLE', error: 'Không thể truy cập dữ liệu quản trị. Hãy thử lại sau.' });
  }
}

export function createAdminUsersRoutes(options: AdminUsersOptions): Router {
  const router = Router();

  router.use((req, res, next) => {
    if (!options.adminUserRepo) {
      res.status(503).json({ error: 'Quản trị người dùng cần PostgreSQL.' });
      return;
    }
    const actor = (req as Request & { user?: AuthUser }).user;
    if (!actor || !actor.sid) {
      res.status(403).json({ code: 'ADMIN_REQUIRED', error: 'Bạn không có quyền quản trị người dùng.' });
      return;
    }

    if (req.workspace?.mode === 'organization' && req.workspace.workspaceId) {
      if (req.workspace.role !== 'admin') {
        res.status(403).json({ code: 'ADMIN_REQUIRED', error: 'Bạn không có quyền quản trị trong tổ chức này.' });
        return;
      }
    } else {
      if (actor.role !== 'admin') {
        res.status(403).json({ code: 'ADMIN_REQUIRED', error: 'Bạn không có quyền quản trị người dùng.' });
        return;
      }
    }
    next();
  });

  router.get('/', async (req, res) => {
    try {
      if (Object.keys(req.query).some(key => !['status', 'search', 'page', 'limit'].includes(key))) throw invalid();
      const status = req.query.status;
      if (status !== undefined && !['pending', 'active', 'disabled'].includes(status as string)) throw invalid();
      const search = req.query.search;
      if (search !== undefined && (typeof search !== 'string' || search.length > 200)) throw invalid();

      const filter = {
        status: status as AccountStatus | undefined,
        search: search as string | undefined,
        page: integer(req.query.page, 1, 100_000),
        limit: integer(req.query.limit, 20, 100),
      };

      const actor = (req as any).user as AuthUser;

      if (req.workspace?.mode === 'organization' && req.workspace.workspaceId) {
        const result = await options.adminUserRepo!.listForWorkspace(actor.id, req.workspace.workspaceId, filter);
        res.json(result);
      } else {
        const result = await options.adminUserRepo!.list(actor.id, filter);
        res.json(result);
      }
    } catch (error) {
      failure(res, error);
    }
  });

  router.post('/approve-all', async (req, res) => {
    try {
      if (req.workspace?.mode !== 'organization' || !req.workspace.workspaceId) {
        throw invalid();
      }
      const actor = (req as any).user as AuthUser;
      const workspaceId = req.workspace.workspaceId;
      const result = await options.adminUserRepo!.approveAllForWorkspace(actor.id, actor.sid!, workspaceId);

      (options.adminAuditLogger ?? console).info(
        JSON.stringify({
          event: 'admin_workspace_approve_all',
          actorId: actor.id,
          workspaceId,
          count: result.approvedCount,
          at: result.at.toISOString(),
        })
      );

      if (options.emailSender && result.approvedUsers.length > 0) {
        const wsName = req.workspace.workspaceName || 'tổ chức';
        for (const u of result.approvedUsers) {
          sendEmailInBackground(options.emailSender, workspaceApprovedEmail(u.email, u.name, wsName));
        }
      }

      res.json({ approvedCount: result.approvedCount, approvedUsers: result.approvedUsers });
    } catch (error) {
      failure(res, error);
    }
  });

  router.patch('/:id', async (req, res) => {
    try {
      const targetId = String(req.params.id).toLowerCase();
      if (!uuid.test(targetId)) throw invalid();

      const action = req.body?.action;
      const role = req.body?.role;
      const actor = (req as any).user as AuthUser;

      if (req.workspace?.mode === 'organization' && req.workspace.workspaceId) {
        if (!['approve', 'reject', 'disable', 'enable', 'role'].includes(action)) throw invalid();
        if (action === 'role' && role !== 'member' && role !== 'admin') throw invalid();

        const result = await options.adminUserRepo!.mutateForWorkspace(
          actor.id,
          actor.sid!,
          req.workspace.workspaceId,
          targetId,
          action,
          role as AccountRole | undefined
        );

        (options.adminAuditLogger ?? console).info(
          JSON.stringify({
            event: 'admin_workspace_member_changed',
            actorId: actor.id,
            workspaceId: req.workspace.workspaceId,
            targetId,
            action,
            at: result.at.toISOString(),
          })
        );

        if (action === 'approve' && options.emailSender && result.user) {
          const wsName = req.workspace.workspaceName || 'tổ chức';
          sendEmailInBackground(options.emailSender, workspaceApprovedEmail(result.user.email, result.user.name, wsName));
        }

        if (action === 'reject') {
          res.json({ rejectedId: result.rejectedId });
        } else {
          res.json({ user: result.user });
        }
      } else {
        if (!['approve', 'disable', 'enable', 'role'].includes(action)) throw invalid();
        if (action === 'role' && role !== 'member' && role !== 'admin') throw invalid();
        if (action === 'approve' && !options.emailSender) {
          throw new AdminUserError(503, 'APPROVAL_EMAIL_UNAVAILABLE', 'Chưa cấu hình email thông báo duyệt tài khoản.');
        }

        const result = await options.adminUserRepo!.mutate(actor.id, actor.sid!, targetId, action, role as AccountRole | undefined);
        (options.adminAuditLogger ?? console).info(
          JSON.stringify({ event: 'admin_user_changed', actorId: actor.id, targetId, action, at: result.at.toISOString() })
        );
        if (action === 'approve') await sendEmailSafely(options.emailSender, approvalEmail(result.user.email, result.user.name));
        res.json({ user: result.user });
      }
    } catch (error) {
      failure(res, error);
    }
  });

  for (const action of ['approve', 'disable', 'enable', 'role'] as const satisfies readonly AdminAction[]) {
    router.post(`/:id/${action}`, async (req, res) => {
      try {
        const targetId = String(req.params.id).toLowerCase();
        if (!uuid.test(targetId)) throw invalid();
        const role = req.body?.role;
        if (action === 'role' && role !== 'member' && role !== 'admin') throw invalid();
        const actor = (req as any).user as AuthUser;

        if (req.workspace?.mode === 'organization' && req.workspace.workspaceId) {
          const result = await options.adminUserRepo!.mutateForWorkspace(
            actor.id,
            actor.sid!,
            req.workspace.workspaceId,
            targetId,
            action,
            role as AccountRole | undefined
          );
          (options.adminAuditLogger ?? console).info(
            JSON.stringify({
              event: 'admin_workspace_member_changed',
              actorId: actor.id,
              workspaceId: req.workspace.workspaceId,
              targetId,
              action,
              at: result.at.toISOString(),
            })
          );
          if (action === 'approve' && options.emailSender && result.user) {
            const wsName = req.workspace.workspaceName || 'tổ chức';
            sendEmailInBackground(options.emailSender, workspaceApprovedEmail(result.user.email, result.user.name, wsName));
          }
          res.json({ user: result.user });
        } else {
          if (action === 'approve' && !options.emailSender) {
            throw new AdminUserError(503, 'APPROVAL_EMAIL_UNAVAILABLE', 'Chưa cấu hình email thông báo duyệt tài khoản.');
          }
          const result = await options.adminUserRepo!.mutate(actor.id, actor.sid!, targetId, action, role as AccountRole | undefined);
          (options.adminAuditLogger ?? console).info(
            JSON.stringify({ event: 'admin_user_changed', actorId: actor.id, targetId, action, at: result.at.toISOString() })
          );
          if (action === 'approve') await sendEmailSafely(options.emailSender, approvalEmail(result.user.email, result.user.name));
          res.json({ user: result.user });
        }
      } catch (error) {
        failure(res, error);
      }
    });
  }

  return router;
}

export const createAdminUserRouter = createAdminUsersRoutes;
