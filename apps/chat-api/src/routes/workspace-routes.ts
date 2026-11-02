import { Router, type Request, type Response } from 'express';
import { isUuid } from '../db/repositories/uuid.js';
import { WorkspaceRepoError } from '../db/repositories/workspace/errors.js';
import type WorkspaceRepo from '../db/repositories/workspace/index.js';
import {
  WorkspaceRateLimiter,
  createWorkspaceRateLimitMiddleware,
  type WorkspaceRateLimitConfig,
} from './workspace-rate-limiter.js';
import type {
  CreateWorkspaceRequest,
  CreateInviteRequest,
  MemberDecisionRequest,
  LinkWorkspaceSiteRequest,
  UpdateWorkspaceSiteRequest,
  ConfigureWorkspaceProjectsRequest,
} from '@wap/tool-schemas';

export interface WorkspaceRoutesOptions {
  workspaceRepo: WorkspaceRepo;
  rateLimit?: WorkspaceRateLimitConfig;
}

export interface WorkspaceRouters {
  adminRouter: Router;
  workspaceRouter: Router;
  joinRouter: Router;
}

/**
 * Narrows Express route parameter (which can be string | string[] | undefined in Express 5)
 * to a non-empty trimmed string or null, preserving strict typing and security checks.
 */
function getScalarParam(param: unknown): string | null {
  if (typeof param === 'string' && param.trim().length > 0) {
    return param.trim();
  }
  return null;
}

function handleRouteError(res: Response, err: any): void {
  if (err?.code === '23505' || err?.code === 'DUPLICATE_SLUG') {
    res.status(409).json({ code: 'DUPLICATE_SLUG', error: 'Workspace slug already exists' });
    return;
  }
  if (err instanceof WorkspaceRepoError) {
    res.status(err.statusCode).json({ code: err.code, error: err.message });
    return;
  }
  const status =
    typeof err?.statusCode === 'number'
      ? err.statusCode
      : typeof err?.status === 'number'
        ? err.status
        : 500;
  res.status(status).json({
    code: err?.code || 'INTERNAL_ERROR',
    error: err?.message || 'Internal server error',
  });
}

export function createWorkspaceRoutes(options: WorkspaceRoutesOptions): WorkspaceRouters {
  const { workspaceRepo } = options;
  const limiter = new WorkspaceRateLimiter(options.rateLimit);

  const adminRouter = Router();
  const workspaceRouter = Router();
  const joinRouter = Router();

  // ============================================================================
  // 1. Admin Workspace Lifecycle Routes (/api/admin/jira-workspaces)
  // ============================================================================

  // POST /api/admin/jira-workspaces
  adminRouter.post('/', async (req: Request, res: Response): Promise<void> => {
    const user = (req as any).user;
    if (!user || user.role !== 'admin') {
      res.status(403).json({ code: 'ADMIN_REQUIRED', error: 'Only system administrators can create workspaces' });
      return;
    }

    const { name, slug, bootstrapAdminUserId } = (req.body || {}) as CreateWorkspaceRequest;

    if (!name || typeof name !== 'string' || !name.trim() || name.length > 255) {
      res.status(400).json({ code: 'INVALID_NAME', error: 'Valid name is required' });
      return;
    }
    if (!slug || typeof slug !== 'string' || !slug.trim() || slug.length > 100) {
      res.status(400).json({ code: 'INVALID_SLUG', error: 'Valid slug is required' });
      return;
    }
    if (!bootstrapAdminUserId || typeof bootstrapAdminUserId !== 'string' || !isUuid(bootstrapAdminUserId)) {
      res.status(400).json({ code: 'INVALID_BOOTSTRAP_ADMIN', error: 'Valid bootstrapAdminUserId is required' });
      return;
    }

    try {
      const result = await workspaceRepo.createWorkspaceWithBootstrapAdmin(user.id, {
        name: name.trim(),
        slug: slug.trim(),
        bootstrapAdminUserId,
      });
      res.status(201).json(result);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // POST /api/admin/jira-workspaces/:id/archive
  adminRouter.post('/:id/archive', async (req: Request, res: Response): Promise<void> => {
    const user = (req as any).user;
    if (!user || user.role !== 'admin') {
      res.status(403).json({ code: 'ADMIN_REQUIRED', error: 'Only system administrators can archive workspaces' });
      return;
    }

    const workspaceId = getScalarParam(req.params.id);
    if (!workspaceId || !isUuid(workspaceId)) {
      res.status(404).json({ code: 'WORKSPACE_NOT_FOUND', error: 'Workspace not found' });
      return;
    }

    const { expectedVersion } = req.body || {};
    if (typeof expectedVersion !== 'number' || !Number.isSafeInteger(expectedVersion) || expectedVersion <= 0) {
      res.status(400).json({ code: 'INVALID_VERSION', error: 'expectedVersion must be a positive integer' });
      return;
    }

    try {
      const result = await workspaceRepo.archiveWorkspace(user.id, workspaceId, expectedVersion);
      res.status(200).json({ archived: true, workspaceVersion: result.workspaceVersion });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // POST /api/admin/jira-workspaces/:id/recover-admin
  adminRouter.post('/:id/recover-admin', async (req: Request, res: Response): Promise<void> => {
    const user = (req as any).user;
    if (!user || user.role !== 'admin') {
      res.status(403).json({ code: 'ADMIN_REQUIRED', error: 'Only system administrators can recover workspaces' });
      return;
    }

    const workspaceId = getScalarParam(req.params.id);
    if (!workspaceId || !isUuid(workspaceId)) {
      res.status(404).json({ code: 'WORKSPACE_NOT_FOUND', error: 'Workspace not found' });
      return;
    }

    const { expectedVersion, newAdminUserId } = req.body || {};
    if (typeof expectedVersion !== 'number' || !Number.isSafeInteger(expectedVersion) || expectedVersion <= 0) {
      res.status(400).json({ code: 'INVALID_VERSION', error: 'expectedVersion must be a positive integer' });
      return;
    }
    if (!newAdminUserId || typeof newAdminUserId !== 'string' || !isUuid(newAdminUserId)) {
      res.status(400).json({ code: 'INVALID_TARGET_USER', error: 'newAdminUserId must be a valid UUID' });
      return;
    }

    try {
      const result = await workspaceRepo.recoverWorkspaceAdmin(user.id, workspaceId, {
        expectedVersion,
        userId: newAdminUserId,
      });
      res.status(200).json({ recovered: true, workspaceVersion: result.workspaceVersion });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // POST /api/admin/jira-workspaces/:id/enable
  adminRouter.post('/:id/enable', async (req: Request, res: Response): Promise<void> => {
    const user = (req as any).user;
    if (!user || user.role !== 'admin') {
      res.status(403).json({ code: 'ADMIN_REQUIRED', error: 'Only system administrators can enable workspaces' });
      return;
    }

    const workspaceId = getScalarParam(req.params.id);
    if (!workspaceId || !isUuid(workspaceId)) {
      res.status(404).json({ code: 'WORKSPACE_NOT_FOUND', error: 'Workspace not found' });
      return;
    }

    const { slug, bootstrapAdminUserId } = (req.body || {}) as { slug?: unknown; bootstrapAdminUserId?: unknown };
    if (!slug || typeof slug !== 'string' || !slug.trim() || slug.length > 100) {
      res.status(400).json({ code: 'INVALID_SLUG', error: 'Valid slug is required' });
      return;
    }
    if (!bootstrapAdminUserId || typeof bootstrapAdminUserId !== 'string' || !isUuid(bootstrapAdminUserId)) {
      res.status(400).json({ code: 'INVALID_BOOTSTRAP_ADMIN', error: 'Valid bootstrapAdminUserId is required' });
      return;
    }

    try {
      const result = await workspaceRepo.enableExistingWorkspace(user.id, workspaceId, {
        slug: slug.trim(),
        bootstrapAdminUserId,
      });
      res.status(200).json(result);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // ============================================================================
  // 2. Personal Workspace Listing Routes (/api/jira-workspaces)
  // ============================================================================

  // GET /api/jira-workspaces
  workspaceRouter.get('/', async (req: Request, res: Response): Promise<void> => {
    const user = (req as any).user;
    if (!user?.id) {
      res.status(401).json({ code: 'UNAUTHORIZED', error: 'Authentication required' });
      return;
    }

    try {
      const workspaces = await workspaceRepo.listWorkspacesForUser(user.id);
      res.status(200).json({ workspaces });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // ============================================================================
  // 3. Workspace Join Requests (/api/jira-workspace-join-requests)
  // ============================================================================

  // POST /api/jira-workspace-join-requests
  joinRouter.post(
    '/',
    createWorkspaceRateLimitMiddleware(limiter, 'join'),
    async (req: Request, res: Response): Promise<void> => {
      const user = (req as any).user;
      if (!user?.id) {
        res.status(401).json({ code: 'UNAUTHORIZED', error: 'Authentication required' });
        return;
      }

      const { inviteToken } = req.body || {};
      if (!inviteToken || typeof inviteToken !== 'string' || inviteToken.trim().length < 32) {
        res.status(404).json({ code: 'INVITE_NOT_FOUND', error: 'Invalid invite token' });
        return;
      }

      try {
        const result = await workspaceRepo.joinWorkspaceWithInvite(user.id, inviteToken.trim());
        if (result.outcome === 'already_active') {
          res.status(409).json({
            code: 'ALREADY_WORKSPACE_MEMBER',
            error: 'Bạn đã là thành viên hoạt động của workspace này.',
          });
          return;
        }

        res.status(201).json({
          requestId: result.requestId,
          workspaceId: result.workspaceId,
          status: 'pending',
        });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  // ============================================================================
  // 4. Workspace Members & Decisions (/api/jira-workspaces/:id/members)
  // ============================================================================

  // GET /api/jira-workspaces/:id/members
  workspaceRouter.get('/:id/members', async (req: Request, res: Response): Promise<void> => {
    const user = (req as any).user;
    if (!user?.id) {
      res.status(401).json({ code: 'UNAUTHORIZED', error: 'Authentication required' });
      return;
    }

    const workspaceId = getScalarParam(req.params.id);
    if (!workspaceId || !isUuid(workspaceId)) {
      res.status(404).json({ code: 'WORKSPACE_NOT_FOUND', error: 'Workspace not found' });
      return;
    }

    try {
      const members = await workspaceRepo.listMembers(workspaceId, user.id);
      res.status(200).json({ members });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // POST /api/jira-workspaces/:id/members/:userId/decision
  workspaceRouter.post(
    '/:id/members/:userId/decision',
    createWorkspaceRateLimitMiddleware(limiter, 'decision'),
    async (req: Request, res: Response): Promise<void> => {
      const user = (req as any).user;
      if (!user?.id) {
        res.status(401).json({ code: 'UNAUTHORIZED', error: 'Authentication required' });
        return;
      }

      const workspaceId = getScalarParam(req.params.id);
      if (!workspaceId || !isUuid(workspaceId)) {
        res.status(404).json({ code: 'WORKSPACE_NOT_FOUND', error: 'Workspace not found' });
        return;
      }

      const targetUserId = getScalarParam(req.params.userId);
      if (!targetUserId || !isUuid(targetUserId)) {
        res.status(400).json({ code: 'INVALID_TARGET_USER', error: 'Invalid target user ID' });
        return;
      }

      const { expectedVersion, decision } = (req.body || {}) as MemberDecisionRequest;

      if (typeof expectedVersion !== 'number' || !Number.isSafeInteger(expectedVersion) || expectedVersion <= 0) {
        res.status(400).json({ code: 'INVALID_VERSION', error: 'expectedVersion must be a positive integer' });
        return;
      }
      if (decision !== 'approve' && decision !== 'reject' && decision !== 'remove') {
        res.status(400).json({ code: 'INVALID_DECISION', error: 'decision must be approve, reject, or remove' });
        return;
      }

      try {
        const result = await workspaceRepo.decideMember(workspaceId, user.id, targetUserId, {
          expectedVersion,
          decision,
        });
        res.status(200).json(result);
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  // ============================================================================
  // 5. Workspace Invites (/api/jira-workspaces/:id/invites)
  // ============================================================================

  // POST /api/jira-workspaces/:id/invites
  workspaceRouter.post(
    '/:id/invites',
    createWorkspaceRateLimitMiddleware(limiter, 'invite'),
    async (req: Request, res: Response): Promise<void> => {
      const user = (req as any).user;
      if (!user?.id) {
        res.status(401).json({ code: 'UNAUTHORIZED', error: 'Authentication required' });
        return;
      }

      const workspaceId = getScalarParam(req.params.id);
      if (!workspaceId || !isUuid(workspaceId)) {
        res.status(404).json({ code: 'WORKSPACE_NOT_FOUND', error: 'Workspace not found' });
        return;
      }

      let requestObj: CreateInviteRequest | undefined = undefined;
      if (req.body && typeof req.body === 'object' && 'expiresInDays' in req.body) {
        const exp = req.body.expiresInDays;
        if (typeof exp !== 'number' || !Number.isSafeInteger(exp) || exp < 1 || exp > 30) {
          res.status(400).json({ code: 'INVALID_EXPIRY', error: 'expiresInDays must be an integer between 1 and 30' });
          return;
        }
        requestObj = { expiresInDays: exp };
      }

      try {
        const result = await workspaceRepo.createInvite(workspaceId, user.id, requestObj);
        res.status(201).json(result);
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  // GET /api/jira-workspaces/:id/invites
  workspaceRouter.get('/:id/invites', async (req: Request, res: Response): Promise<void> => {
    const user = (req as any).user;
    if (!user?.id) {
      res.status(401).json({ code: 'UNAUTHORIZED', error: 'Authentication required' });
      return;
    }

    const workspaceId = getScalarParam(req.params.id);
    if (!workspaceId || !isUuid(workspaceId)) {
      res.status(404).json({ code: 'WORKSPACE_NOT_FOUND', error: 'Workspace not found' });
      return;
    }

    try {
      const invites = await workspaceRepo.listInvites(workspaceId, user.id);
      res.status(200).json({ invites });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // DELETE /api/jira-workspaces/:id/invites/:inviteId
  workspaceRouter.delete('/:id/invites/:inviteId', async (req: Request, res: Response): Promise<void> => {
    const user = (req as any).user;
    if (!user?.id) {
      res.status(401).json({ code: 'UNAUTHORIZED', error: 'Authentication required' });
      return;
    }

    const workspaceId = getScalarParam(req.params.id);
    if (!workspaceId || !isUuid(workspaceId)) {
      res.status(404).json({ code: 'WORKSPACE_NOT_FOUND', error: 'Workspace not found' });
      return;
    }

    const inviteId = getScalarParam(req.params.inviteId);
    if (!inviteId || !isUuid(inviteId)) {
      res.status(404).json({ code: 'INVITE_NOT_FOUND', error: 'Invite not found' });
      return;
    }

    try {
      const result = await workspaceRepo.revokeInvite(workspaceId, user.id, inviteId);
      res.status(200).json(result);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // ============================================================================
  // 6. Jira Sites & Projects (/api/jira-workspaces/:id/jira-sites)
  // ============================================================================

  // GET /api/jira-workspaces/:id/jira-sites
  workspaceRouter.get('/:id/jira-sites', async (req: Request, res: Response): Promise<void> => {
    const user = (req as any).user;
    if (!user?.id) {
      res.status(401).json({ code: 'UNAUTHORIZED', error: 'Authentication required' });
      return;
    }

    const workspaceId = getScalarParam(req.params.id);
    if (!workspaceId || !isUuid(workspaceId)) {
      res.status(404).json({ code: 'WORKSPACE_NOT_FOUND', error: 'Workspace not found' });
      return;
    }

    try {
      const sites = await workspaceRepo.listSites(workspaceId, user.id);
      res.status(200).json({ sites });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // POST /api/jira-workspaces/:id/jira-sites
  workspaceRouter.post('/:id/jira-sites', async (req: Request, res: Response): Promise<void> => {
    const user = (req as any).user;
    if (!user?.id) {
      res.status(401).json({ code: 'UNAUTHORIZED', error: 'Authentication required' });
      return;
    }

    const workspaceId = getScalarParam(req.params.id);
    if (!workspaceId || !isUuid(workspaceId)) {
      res.status(404).json({ code: 'WORKSPACE_NOT_FOUND', error: 'Workspace not found' });
      return;
    }

    const { cloudId } = (req.body || {}) as LinkWorkspaceSiteRequest;
    if (!cloudId || typeof cloudId !== 'string' || !cloudId.trim()) {
      res.status(400).json({ code: 'INVALID_CLOUD_ID', error: 'cloudId is required' });
      return;
    }

    try {
      const result = await workspaceRepo.linkSite(workspaceId, user.id, { cloudId: cloudId.trim() });
      res.status(201).json(result);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // PATCH /api/jira-workspaces/:id/jira-sites/:siteId
  workspaceRouter.patch('/:id/jira-sites/:siteId', async (req: Request, res: Response): Promise<void> => {
    const user = (req as any).user;
    if (!user?.id) {
      res.status(401).json({ code: 'UNAUTHORIZED', error: 'Authentication required' });
      return;
    }

    const workspaceId = getScalarParam(req.params.id);
    const siteId = getScalarParam(req.params.siteId);
    if (!workspaceId || !isUuid(workspaceId) || !siteId || !isUuid(siteId)) {
      res.status(404).json({ code: 'NOT_FOUND', error: 'Workspace or site not found' });
      return;
    }

    const { expectedPolicyVersion, active } = (req.body || {}) as UpdateWorkspaceSiteRequest;

    if (typeof expectedPolicyVersion !== 'number' || !Number.isSafeInteger(expectedPolicyVersion) || expectedPolicyVersion <= 0) {
      res.status(400).json({ code: 'INVALID_VERSION', error: 'expectedPolicyVersion must be a positive integer' });
      return;
    }
    if (typeof active !== 'boolean') {
      res.status(400).json({ code: 'INVALID_ACTIVE', error: 'active must be a boolean' });
      return;
    }

    try {
      const result = await workspaceRepo.updateSite(workspaceId, user.id, siteId, {
        expectedPolicyVersion,
        active,
      });
      res.status(200).json(result);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // GET /api/jira-workspaces/:id/jira-sites/:siteId/projects
  workspaceRouter.get('/:id/jira-sites/:siteId/projects', async (req: Request, res: Response): Promise<void> => {
    const user = (req as any).user;
    if (!user?.id) {
      res.status(401).json({ code: 'UNAUTHORIZED', error: 'Authentication required' });
      return;
    }

    const workspaceId = getScalarParam(req.params.id);
    const siteId = getScalarParam(req.params.siteId);
    if (!workspaceId || !isUuid(workspaceId) || !siteId || !isUuid(siteId)) {
      res.status(404).json({ code: 'NOT_FOUND', error: 'Workspace or site not found' });
      return;
    }

    try {
      const result = await workspaceRepo.getProjects(workspaceId, user.id, siteId);
      res.status(200).json(result);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // PUT /api/jira-workspaces/:id/jira-sites/:siteId/projects
  workspaceRouter.put('/:id/jira-sites/:siteId/projects', async (req: Request, res: Response): Promise<void> => {
    const user = (req as any).user;
    if (!user?.id) {
      res.status(401).json({ code: 'UNAUTHORIZED', error: 'Authentication required' });
      return;
    }

    const workspaceId = getScalarParam(req.params.id);
    const siteId = getScalarParam(req.params.siteId);
    if (!workspaceId || !isUuid(workspaceId) || !siteId || !isUuid(siteId)) {
      res.status(404).json({ code: 'NOT_FOUND', error: 'Workspace or site not found' });
      return;
    }

    const { expectedPolicyVersion, selectedProjectIds } = (req.body || {}) as ConfigureWorkspaceProjectsRequest;

    if (typeof expectedPolicyVersion !== 'number' || !Number.isSafeInteger(expectedPolicyVersion) || expectedPolicyVersion <= 0) {
      res.status(400).json({ code: 'INVALID_VERSION', error: 'expectedPolicyVersion must be a positive integer' });
      return;
    }
    if (!Array.isArray(selectedProjectIds)) {
      res.status(400).json({ code: 'INVALID_PROJECTS', error: 'selectedProjectIds must be an array' });
      return;
    }
    for (const p of selectedProjectIds) {
      if (typeof p !== 'string' || !/^\d+$/.test(p)) {
        res.status(400).json({ code: 'INVALID_PROJECT_ID', error: 'Project IDs must be numeric strings' });
        return;
      }
    }

    try {
      const result = await workspaceRepo.configureProjects(workspaceId, user.id, siteId, {
        expectedPolicyVersion,
        selectedProjectIds,
      });
      res.status(200).json(result);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // GET /api/jira-workspaces/:id/jira-capabilities
  workspaceRouter.get('/:id/jira-capabilities', async (req: Request, res: Response): Promise<void> => {
    const user = (req as any).user;
    if (!user?.id) {
      res.status(401).json({ code: 'UNAUTHORIZED', error: 'Authentication required' });
      return;
    }

    const workspaceId = getScalarParam(req.params.id);
    if (!workspaceId || !isUuid(workspaceId)) {
      res.status(404).json({ code: 'WORKSPACE_NOT_FOUND', error: 'Workspace not found' });
      return;
    }

    try {
      const result = await workspaceRepo.getCapabilities(workspaceId, user.id);
      res.status(200).json(result);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  return { adminRouter, workspaceRouter, joinRouter };
}
