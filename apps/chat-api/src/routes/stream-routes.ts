import { Router, type Request, type Response } from 'express';
import type pg from 'pg';
import type { SSEManager } from '../sse/sse-manager.js';
import type { ConversationRepo } from '../db/repositories/conversation-repo.js';
import type { WorkspaceRepo } from '../db/repositories/workspace-repo.js';
import { assertConversationAccessWithFallback, ConversationAccessDeniedError } from '../services/conversation-access.js';

export interface StreamRoutesOptions {
  sseManager: SSEManager;
  convRepo?: ConversationRepo;
  workspaceRepo?: WorkspaceRepo;
  pool?: pg.Pool;
}

export function createStreamRoutes(options: StreamRoutesOptions): Router {
  const router = Router();
  const { sseManager, convRepo, workspaceRepo } = options;
  const pool = options.pool ?? convRepo?.getPool?.() ?? (workspaceRepo as any)?.pool;

  // GET /api/conversations/:id/stream
  router.get('/:id/stream', async (req: Request, res: Response): Promise<void> => {
    const convId = req.params.id as string;
    const userId = (req as any).user?.id;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!pool && !convRepo) {
      res.status(403).json({ error: 'Ownership verification unavailable' });
      return;
    }

    const reqWorkspace = (req as any).workspace;
    try {
      await assertConversationAccessWithFallback(
        { pool, convRepo },
        convId,
        userId,
        {
          legacyNonOwnerStatus: 403,
          expectedWorkspaceId: reqWorkspace?.workspaceId ?? null,
          expectedWorkspaceMode: reqWorkspace?.mode,
          ordinaryOrgAccessDeniedAs403: true,
        }
      );
    } catch (err: any) {
      if (err instanceof ConversationAccessDeniedError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: err?.message || 'Database error' });
      return;
    }

    // Set headers for standard SSE streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    // Check Last-Event-ID header and replay missed events
    const lastEventIdHeader = req.headers['last-event-id'];
    const missedEvents = sseManager.getMissedEventsForCursor(
      convId, typeof lastEventIdHeader === 'string' ? lastEventIdHeader : undefined
    );
    for (const evt of missedEvents) {
      res.write(sseManager.formatSSE(evt));
    }

    // Register client for live events
    const cleanup = sseManager.addClient(convId, res);

    // Keepalive comment ping every 20 seconds
    const keepaliveInterval = setInterval(() => {
      try {
        res.write(': keepalive\n\n');
      } catch {
        clearInterval(keepaliveInterval);
      }
    }, 20000);

    req.on('close', () => {
      clearInterval(keepaliveInterval);
      cleanup();
    });
  });

  return router;
}
