import { Router, type Request, type Response } from 'express';
import type { ExecutionService } from '../services/execution-service.js';

export interface ExecutionRoutesOptions {
  executionService: ExecutionService;
}

export function createExecutionRoutes(options: ExecutionRoutesOptions): Router {
  const router = Router();
  const { executionService } = options;

  // GET /api/conversations/:convId/executions/latest (owner-scoped reload data)
  router.get('/conversations/:convId/executions/latest', async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
      const snapshot = await executionService.getLatestExecutionSnapshot(req.params.convId as string, userId);
      res.status(200).json(snapshot);
    } catch (error: any) {
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
      const result = await executionService.approveAndStart(planId, userId);
      res.status(result.status).json(result);
    } catch (err: any) {
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
      await executionService.getOwnedPlan(planId, userId);
      const rejected = await executionService.getPlanRepo().rejectPlan(planId, userId);
      if (!rejected) {
        res.status(409).json({ error: 'Plan is already decided or expired' });
        return;
      }
      res.status(200).json({ success: true, status: 'rejected' });
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err?.message || 'Failed to reject plan' });
    }
  });

  // POST /api/executions/:planId/steps/:stepId/retry
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
        const result = await executionService.retryStep(planId as string, stepId as string, userId);
        res.status(200).json(result);
      } catch (err: any) {
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

  // POST /api/executions/:planId/steps/:stepId/skip
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
        const result = await executionService.skipStep(planId as string, stepId as string, userId);
        res.status(200).json(result);
      } catch (err: any) {
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

  // POST /api/executions/:planId/stop
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
        const result = await executionService.stop(planId as string, userId);
        res.status(200).json(result);
      } catch (err: any) {
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

  // GET /api/executions/:planId/status
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
        await executionService.getOwnedPlan(planId as string, userId);
        const result = await executionService.getExecutionStatusDurable(planId as string);
        if (!result) {
          res.status(404).json({ error: 'No execution found for this plan' });
          return;
        }
        res.status(200).json(result);
      } catch (err: any) {
        res.status(err?.status || 500).json({ error: err?.message || 'Failed to fetch execution status' });
      }
    }
  );

  return router;
}
