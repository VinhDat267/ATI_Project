import { Router, type Request, type Response, type NextFunction } from 'express';
import { WorkspaceError, type WorkspaceRepo } from '../db/repositories/workspace-repo.js';
import { sendEmailInBackground, workspaceJoinRequestEmail, type EmailSender } from '../services/email/index.js';

export interface WorkspacesRouterOptions {
  workspaceRepo: WorkspaceRepo;
  emailSender?: EmailSender;
}

export function createWorkspacesRouter(options: WorkspacesRouterOptions): Router {
  const router = Router();

  // Authentication guard
  router.use((req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Yêu cầu đăng nhập.' });
      return;
    }
    next();
  });

  // GET / - List user workspaces
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const organizations = await options.workspaceRepo.listForUser(req.user!.id);
      res.status(200).json({
        personal: {
          id: 'personal',
          name: 'Không gian Cá nhân',
          role: 'admin',
          status: 'active',
        },
        organizations,
      });
    } catch (err) {
      handleWorkspaceError(err, res, next);
    }
  });

  // POST / - Create a new workspace
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, requireApproval } = req.body ?? {};
      const trimmedName = typeof name === 'string' ? name.trim() : '';
      if (!trimmedName || trimmedName.length > 100) {
        res.status(400).json({ error: 'INVALID_NAME', message: 'Tên tổ chức phải từ 1 đến 100 ký tự.' });
        return;
      }
      if (requireApproval !== undefined && typeof requireApproval !== 'boolean') {
        res.status(400).json({ error: 'INVALID_REQUIRE_APPROVAL', message: 'Cấu hình phê duyệt không hợp lệ.' });
        return;
      }

      const workspace = await options.workspaceRepo.create(req.user!.id, trimmedName, requireApproval ?? true);
      res.status(201).json({ workspace });
    } catch (err) {
      handleWorkspaceError(err, res, next);
    }
  });

  // POST /join - Join workspace by invite code
  router.post('/join', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { inviteCode } = req.body ?? {};
      if (typeof inviteCode !== 'string' || !inviteCode.trim()) {
        res.status(400).json({ error: 'INVALID_INVITE_CODE', message: 'Mã mời không hợp lệ hoặc không tồn tại.' });
        return;
      }

      const result = await options.workspaceRepo.joinByInviteCode(req.user!.id, inviteCode.trim());

      if (result.created && result.workspace.status === 'pending' && result.admins.length > 0 && options.emailSender) {
        const requesterName = req.user!.name || req.user!.email;
        const requesterEmail = req.user!.email;
        for (const admin of result.admins) {
          sendEmailInBackground(
            options.emailSender,
            workspaceJoinRequestEmail(admin.email, admin.name, requesterName, requesterEmail, result.workspace.name)
          );
        }
      }

      res.status(200).json({ workspace: result.workspace, created: result.created });
    } catch (err) {
      handleWorkspaceError(err, res, next);
    }
  });

  // POST /:id/invite-code/regenerate - Regenerate invite code
  router.post('/:id/invite-code/regenerate', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = typeof req.params.id === 'string' ? req.params.id : '';
      const inviteCode = await options.workspaceRepo.regenerateInviteCode(req.user!.id, workspaceId);
      res.status(200).json({ inviteCode });
    } catch (err) {
      handleWorkspaceError(err, res, next);
    }
  });

  // PATCH /:id/settings - Update workspace settings
  router.patch('/:id/settings', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { requireApproval } = req.body ?? {};
      if (typeof requireApproval !== 'boolean') {
        res.status(400).json({ error: 'INVALID_SETTINGS', message: 'requireApproval phải là boolean.' });
        return;
      }

      const workspaceId = typeof req.params.id === 'string' ? req.params.id : '';
      const updated = await options.workspaceRepo.updateSettings(req.user!.id, workspaceId, { requireApproval });
      res.status(200).json({ requireApproval: updated.requireApproval });
    } catch (err) {
      handleWorkspaceError(err, res, next);
    }
  });

  return router;
}

function handleWorkspaceError(err: unknown, res: Response, next: NextFunction) {
  if (err instanceof WorkspaceError) {
    res.status(err.status).json({ error: err.code, message: err.message });
    return;
  }
  next(err);
}
