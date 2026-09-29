import { Router, type Request, type Response } from 'express';
import type { ExecutionService } from '../services/execution-service.js';

export interface ExecutionRoutesOptions {
  executionService: ExecutionService;
}

export function createExecutionRoutes(options: ExecutionRoutesOptions): Router {
  const router = Router();
  const { executionService } = options;

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

  // POST /api/executions/:planId/steps/:stepId/retry
  router.post(
    '/executions/:planId/steps/:stepId/retry',
    async (req: Request, res: Response): Promise<void> => {
      try {
        const { planId, stepId } = req.params;
        const result = await executionService.retryStep(planId as string, stepId as string);
        res.status(200).json(result);
      } catch (err: any) {
        res.status(500).json({ error: err?.message || 'Failed to retry step' });
      }
    }
  );

  // POST /api/executions/:planId/steps/:stepId/skip
  router.post(
    '/executions/:planId/steps/:stepId/skip',
    async (req: Request, res: Response): Promise<void> => {
      try {
        const { planId, stepId } = req.params;
        const result = await executionService.skipStep(planId as string, stepId as string);
        res.status(200).json(result);
      } catch (err: any) {
        res.status(500).json({ error: err?.message || 'Failed to skip step' });
      }
    }
  );

  // POST /api/executions/:planId/stop
  router.post(
    '/executions/:planId/stop',
    async (req: Request, res: Response): Promise<void> => {
      try {
        const { planId } = req.params;
        const result = await executionService.stop(planId as string);
        res.status(200).json(result);
      } catch (err: any) {
        res.status(500).json({ error: err?.message || 'Failed to stop execution' });
      }
    }
  );

  // GET /api/executions/:planId/status
  router.get(
    '/executions/:planId/status',
    async (req: Request, res: Response): Promise<void> => {
      try {
        const { planId } = req.params;
        const result = executionService.getExecutionStatus(planId as string);
        if (!result) {
          res.status(404).json({ error: 'No execution found for this plan' });
          return;
        }
        res.status(200).json(result);
      } catch (err: any) {
        res.status(500).json({ error: err?.message || 'Failed to fetch execution status' });
      }
    }
  );

  return router;
}
