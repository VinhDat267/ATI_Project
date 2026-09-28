import { Router, type Request, type Response } from 'express';
import type { SSEManager } from '../sse/sse-manager.js';

export interface StreamRoutesOptions {
  sseManager: SSEManager;
}

export function createStreamRoutes(options: StreamRoutesOptions): Router {
  const router = Router();
  const { sseManager } = options;

  // GET /api/conversations/:id/stream
  router.get('/:id/stream', (req: Request, res: Response): void => {
    const convId = req.params.id as string;

    // Set headers for standard SSE streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    // Check Last-Event-ID header and replay missed events
    const lastEventIdHeader = req.headers['last-event-id'];
    if (lastEventIdHeader) {
      const lastId = parseInt(String(lastEventIdHeader), 10);
      if (!isNaN(lastId)) {
        const missedEvents = sseManager.getMissedEvents(convId, lastId);
        for (const evt of missedEvents) {
          res.write(sseManager.formatSSE(evt));
        }
      }
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
