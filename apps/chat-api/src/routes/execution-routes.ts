import { Router, type Request, type Response } from 'express';
import type pg from 'pg';
import type { ExecutionService } from '../services/execution-service.js';
import type { ConversationRepo } from '../db/repositories/conversation-repo.js';
import type { PlanRepo } from '../db/repositories/plan-repo.js';
import {
  assertConversationAccessWithFallback,
  resolveAndAssertPlanAccess,
  ConversationAccessDeniedError,
} from '../services/conversation-access.js';

export interface ExecutionRoutesOptions {
  executionService: ExecutionService;
  pool?: pg.Pool;
  convRepo?: ConversationRepo;
  planRepo?: PlanRepo;
}

export function createExecutionRoutes(options: ExecutionRoutesOptions): Router {
  const router = Router();
  const { executionService } = options;
  const convRepo = options.convRepo ?? (executionService as any).convRepo;
  const planRepo =
    options.planRepo ??
    (executionService as any).planRepo ??
    (executionService as any).getPlanRepo?.();
  const pool =
    options.pool ??
    (convRepo as any)?.getPool?.() ??
    (planRepo as any)?.pool ??
    (executionService as any)?.getPlanRepo?.()?.pool;

  const accessContext = { pool, convRepo, planRepo };

  const guardPlan = async (planId: string, userId: string): Promise<void> => {
    await resolveAndAssertPlanAccess(accessContext, planId, userId, { legacyNonOwnerStatus: 403 });
  };

  router.post('/executions/:planId/continue', async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
      const planId = req.params.planId as string;
      await guardPlan(planId, userId);
      res.status(200).json(await executionService.continueExecution(planId, userId));
    } catch (error: any) {
      if (error instanceof ConversationAccessDeniedError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      res.status(error?.status || 500).json({ error: error?.message || 'Failed to continue execution' });
    }
  });

  // GET /api/conversations/:convId/executions/latest (owner-scoped reload data)
  router.get('/conversations/:convId/executions/latest', async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
      const convId = req.params.convId as string;
      await assertConversationAccessWithFallback(accessContext, convId, userId, { legacyNonOwnerStatus: 403 });
      const snapshot = await executionService.getLatestExecutionSnapshot(convId, userId);
      res.status(200).json(snapshot);
    } catch (error: any) {
      if (error instanceof ConversationAccessDeniedError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      res.status(error?.status || 500).json({ error: error?.message || 'Failed to fetch execution snapshot' });
    }
  });

  // POST /api/plans/:id/approve
  router.post('/plans/:id/approve', async (req: Request, res: Response): Promise<void> => {
    try {
      const planId = req.params.id as string;
      const userId = (req as any).user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      await guardPlan(planId, userId);
      const result = await executionService.approveAndStart(planId, userId);
      res.status(result.status).json(result);
    } catch (err: any) {
      if (err instanceof ConversationAccessDeniedError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: err?.message || 'Failed to approve plan' });
    }
  });

  // POST /api/plans/:id/reject
  router.post('/plans/:id/reject', async (req: Request, res: Response): Promise<void> => {
    try {
      const planId = req.params.id as string;
      const userId = (req as any).user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      await guardPlan(planId, userId);
      await executionService.getOwnedPlan(planId, userId);
      const rejected = await executionService.getPlanRepo().rejectPlan(planId, userId);
      if (!rejected) {
        res.status(409).json({ error: 'Plan is already decided or expired' });
        return;
      }
      res.status(200).json({ success: true, status: 'rejected' });
    } catch (err: any) {
      if (err instanceof ConversationAccessDeniedError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      res.status(err?.status || 500).json({ error: err?.message || 'Failed to reject plan' });
    }
  });

  // POST /executions/:planId/steps/:stepId/retry
  router.post(
    '/executions/:planId/steps/:stepId/retry',
    async (req: Request, res: Response): Promise<void> => {
      try {
        const userId = (req as any).user?.id;
        if (!userId) {
          res.status(401).json({ error: 'Unauthorized' });
          return;
        }
        const { planId, stepId } = req.params;
        await guardPlan(planId as string, userId);
        const result = await executionService.retryStep(planId as string, stepId as string, userId);
        res.status(200).json(result);
      } catch (err: any) {
        if (err instanceof ConversationAccessDeniedError) {
          res.status(err.status).json({ error: err.message });
          return;
        }
        const msg = err?.message || '';
        if (err?.status === 409) {
          res.status(409).json({ error: msg });
        } else if (msg.startsWith('Forbidden')) {
          res.status(403).json({ error: msg });
        } else if (msg.includes('not found') || msg.includes('No active')) {
          res.status(404).json({ error: msg });
        } else if (msg.startsWith('Cannot retry') || msg.startsWith('Cannot skip')) {
          res.status(400).json({ error: msg });
        } else {
          res.status(500).json({ error: msg || 'Failed to retry step' });
        }
      }
    }
  );

  // POST /executions/:planId/steps/:stepId/skip
  router.post(
    '/executions/:planId/steps/:stepId/skip',
    async (req: Request, res: Response): Promise<void> => {
      try {
        const userId = (req as any).user?.id;
        if (!userId) {
          res.status(401).json({ error: 'Unauthorized' });
          return;
        }
        const { planId, stepId } = req.params;
        await guardPlan(planId as string, userId);
        const result = await executionService.skipStep(planId as string, stepId as string, userId);
        res.status(200).json(result);
      } catch (err: any) {
        if (err instanceof ConversationAccessDeniedError) {
          res.status(err.status).json({ error: err.message });
          return;
        }
        const msg = err?.message || '';
        if (err?.status === 409) {
          res.status(409).json({ error: msg });
        } else if (msg.startsWith('Forbidden')) {
          res.status(403).json({ error: msg });
        } else if (msg.includes('not found') || msg.includes('No active')) {
          res.status(404).json({ error: msg });
        } else if (msg.startsWith('Cannot skip')) {
          res.status(400).json({ error: msg });
        } else {
          res.status(500).json({ error: msg || 'Failed to skip step' });
        }
      }
    }
  );

  // POST /executions/:planId/stop
  router.post(
    '/executions/:planId/stop',
    async (req: Request, res: Response): Promise<void> => {
      try {
        const userId = (req as any).user?.id;
        if (!userId) {
          res.status(401).json({ error: 'Unauthorized' });
          return;
        }
        const { planId } = req.params;
        await guardPlan(planId as string, userId);
        const result = await executionService.stop(planId as string, userId);
        res.status(200).json(result);
      } catch (err: any) {
        if (err instanceof ConversationAccessDeniedError) {
          res.status(err.status).json({ error: err.message });
          return;
        }
        const msg = err?.message || '';
        if (err?.status === 409) {
          res.status(409).json({ error: msg });
        } else if (msg.startsWith('Forbidden')) {
          res.status(403).json({ error: msg });
        } else if (msg.includes('not found') || msg.includes('No active')) {
          res.status(404).json({ error: msg });
        } else {
          res.status(500).json({ error: msg || 'Failed to stop execution' });
        }
      }
    }
  );

  // GET /executions/:planId/status
  router.get(
    '/executions/:planId/status',
    async (req: Request, res: Response): Promise<void> => {
      try {
        const { planId } = req.params;
        const userId = (req as any).user?.id;
        if (!userId) {
          res.status(401).json({ error: 'Unauthorized' });
          return;
        }
        await guardPlan(planId as string, userId);
        await executionService.getOwnedPlan(planId as string, userId);
        const result = await executionService.getExecutionStatusDurable(planId as string);
        if (!result) {
          res.status(404).json({ error: 'No execution found for this plan' });
          return;
        }
        res.status(200).json(result);
      } catch (err: any) {
        if (err instanceof ConversationAccessDeniedError) {
          res.status(err.status).json({ error: err.message });
          return;
        }
        res.status(err?.status || 500).json({ error: err?.message || 'Failed to fetch execution status' });
      }
    }
  );

  return router;
}
