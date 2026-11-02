import { Router, type Request, type Response, type NextFunction } from 'express';
import { WorkspaceError, sanitizeWorkspaceName, type WorkspaceRepo } from '../db/repositories/workspace-repo.js';
import { sendEmailInBackground, workspaceJoinRequestEmail, type EmailSender } from '../services/email/index.js';

export interface WorkspacesRouterOptions {
  workspaceRepo: WorkspaceRepo;
  emailSender?: EmailSender;
  clock?: () => number;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JOIN_WINDOW_MS = 15 * 60 * 1000;
const JOIN_MAX_ATTEMPTS = 10;

export function createWorkspacesRouter(options: WorkspacesRouterOptions): Router {
  const router = Router();
  const clock = options.clock ?? Date.now;
  const joinAttempts = new Map<string, number[]>();
  const joinEmailCooldown = new Map<string, number>();

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
      const trimmedName = sanitizeWorkspaceName(name);
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

      const now = clock();
      const rateKey = `${req.user!.id}:${req.ip ?? 'unknown'}`;
      const history = (joinAttempts.get(rateKey) ?? []).filter(ts => now - ts < JOIN_WINDOW_MS);
      if (history.length >= JOIN_MAX_ATTEMPTS) {
        const retryAfterSec = Math.max(1, Math.ceil((history[0]! + JOIN_WINDOW_MS - now) / 1000));
        res.setHeader('Retry-After', String(retryAfterSec));
        res.status(429).json({
          error: 'TOO_MANY_REQUESTS',
          message: 'Bạn đã nhập mã mời quá nhiều lần. Vui lòng thử lại sau.',
        });
        return;
      }
      history.push(now);
      joinAttempts.set(rateKey, history);

      const result = await options.workspaceRepo.joinByInviteCode(req.user!.id, inviteCode.trim());

      const emailKey = `${result.workspace.id}:${req.user!.id}`;
      const lastEmailAt = joinEmailCooldown.get(emailKey) ?? 0;
      if (
        result.created &&
        result.workspace.status === 'pending' &&
        result.admins.length > 0 &&
        options.emailSender &&
        now - lastEmailAt >= JOIN_WINDOW_MS
      ) {
        joinEmailCooldown.set(emailKey, now);
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
      const workspaceId = typeof req.params.id === 'string' ? req.params.id.trim() : '';
      if (!UUID_REGEX.test(workspaceId)) {
        res.status(400).json({ error: 'INVALID_WORKSPACE_ID', message: 'Mã không gian làm việc không hợp lệ.' });
        return;
      }
      const inviteCode = await options.workspaceRepo.regenerateInviteCode(req.user!.id, workspaceId);
      res.status(200).json({ inviteCode });
    } catch (err) {
      handleWorkspaceError(err, res, next);
    }
  });

  // PATCH /:id/settings - Update workspace settings
  router.patch('/:id/settings', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = typeof req.params.id === 'string' ? req.params.id.trim() : '';
      if (!UUID_REGEX.test(workspaceId)) {
        res.status(400).json({ error: 'INVALID_WORKSPACE_ID', message: 'Mã không gian làm việc không hợp lệ.' });
        return;
      }
      const { requireApproval } = req.body ?? {};
      if (typeof requireApproval !== 'boolean') {
        res.status(400).json({ error: 'INVALID_SETTINGS', message: 'requireApproval phải là boolean.' });
        return;
      }

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
