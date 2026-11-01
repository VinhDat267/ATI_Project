import type { Request, Response, NextFunction } from 'express';
import type { WorkspaceRepo } from '../db/repositories/workspace-repo.js';
import type { AuthUser } from '../auth/jwt.js';

export interface WorkspaceContext {
  mode: 'legacy' | 'personal' | 'organization';
  workspaceId: string | null;
  workspaceName?: string;
  role: 'admin' | 'member';
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      workspace?: WorkspaceContext;
    }
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createWorkspaceContextMiddleware(workspaceRepo?: WorkspaceRepo) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      next();
      return;
    }

    const rawHeader = req.headers['x-workspace-id'];
    const header = typeof rawHeader === 'string'
      ? rawHeader.trim()
      : Array.isArray(rawHeader)
        ? rawHeader[0]?.trim() ?? ''
        : '';

    // Case 1: No header sent -> legacy mode (backward-compatible for existing tests and default sessions)
    if (!header) {
      req.workspace = {
        mode: 'legacy',
        workspaceId: null,
        role: req.user.role === 'admin' ? 'admin' : 'member',
      };
      next();
      return;
    }

    // Case 2: 'personal' -> personal mode
    if (header === 'personal') {
      req.workspace = {
        mode: 'personal',
        workspaceId: null,
        role: 'admin',
      };
      next();
      return;
    }

    // Case 3: other string -> organization mode
    if (!UUID_REGEX.test(header)) {
      res.status(400).json({
        error: 'INVALID_WORKSPACE_ID',
        message: 'Mã không gian làm việc không hợp lệ.',
      });
      return;
    }

    if (!workspaceRepo) {
      res.status(403).json({
        error: 'WORKSPACE_ACCESS_DENIED',
        message: 'Bạn không thuộc không gian làm việc này.',
      });
      return;
    }

    try {
      const member = await workspaceRepo.findMember(header, req.user.id);
      if (!member) {
        res.status(403).json({
          error: 'WORKSPACE_ACCESS_DENIED',
          message: 'Bạn không thuộc không gian làm việc này.',
        });
        return;
      }

      if (member.status === 'pending') {
        res.status(403).json({
          error: 'WORKSPACE_MEMBER_PENDING',
          message: 'Yêu cầu tham gia tổ chức của bạn đang chờ Quản trị viên phê duyệt.',
        });
        return;
      }

      if (member.status === 'disabled') {
        res.status(403).json({
          error: 'WORKSPACE_MEMBER_DISABLED',
          message: 'Quyền truy cập của bạn trong tổ chức này đã bị khóa.',
        });
        return;
      }

      if (member.status === 'active') {
        req.workspace = {
          mode: 'organization',
          workspaceId: member.workspaceId,
          workspaceName: member.workspaceName,
          role: member.role,
        };
        next();
        return;
      }

      res.status(403).json({
        error: 'WORKSPACE_ACCESS_DENIED',
        message: 'Bạn không thuộc không gian làm việc này.',
      });
    } catch (err) {
      next(err);
    }
  };
}
