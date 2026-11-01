import { Router, type Request, type Response } from 'express';
import { ScheduleConflict, ScheduleNotFound, type ScheduleChange, type ScheduleService } from '../services/schedules/schedule-service.js';

export interface ScheduleRoutesOptions {
  service: ScheduleService;
  clock?: () => Date;
  /** Sends an SSE event to a conversation; called only after the change committed. */
  emit?: (convId: string, event: string, payload: unknown) => unknown;
}

/** The paths below /api that belong to these routes. */
export function isSchedulePath(path: string): boolean {
  return /^\/(schedules|schedule-runs)(\/|$)/.test(path) || /^\/conversations\/[^/]+\/schedule-proposals\//.test(path);
}

/** Mounted at /api behind the auth middleware, only when SCHEDULES_ENABLED is on and PostgreSQL is available. */
export function createScheduleRoutes(options: ScheduleRoutesOptions): Router {
  const router = Router();
  const { service } = options;
  const now = () => options.clock?.() ?? new Date();

  const handle = (work: (req: Request, res: Response, userId: string) => Promise<void>) => async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    try {
      await work(req, res, userId);
    } catch (error) {
      if (error instanceof ScheduleConflict) res.status(409).json({ error: { code: error.code, message: error.message } });
      else if (error instanceof ScheduleNotFound) res.status(404).json({ error: { code: 'NOT_FOUND', message: error.message } });
      else {
        console.error('[schedules] request failed:', error instanceof Error ? error.message : error);
        res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Máy chủ gặp lỗi khi xử lý lịch.' } });
      }
    }
  };

  const announce = async (change: ScheduleChange) => {
    if (!change.state) return;
    try {
      await options.emit?.(change.convId, 'schedule_updated', { conversationId: change.convId, messageId: change.state.messageId, ...change.state.metadata });
    } catch (error) {
      console.error('[schedules] could not announce a change:', error instanceof Error ? error.message : error);
    }
  };

  router.get('/schedules', handle(async (req, res, userId) => {
    const scope = req.workspace ? { workspaceMode: req.workspace.mode, workspaceId: req.workspace.workspaceId } : undefined;
    res.json({ schedules: await service.list(userId, now(), scope) });
  }));

  router.get('/schedules/pending-count', handle(async (req, res, userId) => {
    const scope = req.workspace ? { workspaceMode: req.workspace.mode, workspaceId: req.workspace.workspaceId } : undefined;
    res.json({ count: await service.pendingCount(userId, now(), scope) });
  }));

  router.get('/schedules/:id/runs', handle(async (req, res, userId) => {
    const raw = req.query.limit;
    const limit = typeof raw === 'string' && /^\d+$/.test(raw) ? Math.min(50, Math.max(1, Number(raw))) : 20;
    res.json({ runs: await service.listRuns(userId, String(req.params.id), limit, now()) });
  }));

  router.post('/conversations/:convId/schedule-proposals/:messageId/confirm', handle(async (req, res, userId) => {
    const change = await service.confirmProposal({ userId, convId: String(req.params.convId), messageId: String(req.params.messageId), now: now() });
    await announce(change);
    res.json({ schedule: change.schedule });
  }));

  for (const action of ['pause', 'resume', 'cancel'] as const) {
    router.post(`/schedules/:id/${action}`, handle(async (req, res, userId) => {
      const version = req.body?.version;
      if (!Number.isInteger(version)) {
        res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Thiếu phiên bản của lịch.' } });
        return;
      }
      const change = await service.setStatus({ userId, scheduleId: String(req.params.id), action, version, now: now() });
      await announce(change);
      res.json({ schedule: change.schedule });
    }));
  }

  router.post('/schedules/:id/run-now', handle(async (req, res, userId) => {
    res.status(201).json({ run: await service.startRun({ userId, scheduleId: String(req.params.id), trigger: 'manual', now: now() }) });
  }));

  router.post('/schedule-runs/:id/replan', handle(async (req, res, userId) => {
    res.status(201).json({ run: await service.startRun({ userId, runId: String(req.params.id), trigger: 'replan', now: now() }) });
  }));

  return router;
}
