import { Router, type NextFunction, type Request, type Response } from 'express';
import type { SlackIngressService } from '../services/slack/slack-ingress-service.js';

export const DEFAULT_MAX_BODY_BYTES = 1_048_576;
export const DEFAULT_STREAM_TIMEOUT_MS = 5_000;
/** After an early refusal, consume and discard at most this much more of the request body. */
const MAX_DISCARD_BYTES = 2_097_152;
/** ...and wait at most this long for the peer to finish sending before forcing the socket shut. */
const DRAIN_CLOSE_MS = 1_000;

export interface SlackEventsRouterOptions {
  service: SlackIngressService;
  maxBodyBytes?: number;
  streamTimeoutMs?: number;
}

interface SlackRawBodyRequest extends Request {
  slackRawBody?: Buffer;
}

function boundedRawBody(
  maxBodyBytes: number,
  streamTimeoutMs: number
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    // A destroyed or reset request stream must never surface as an uncaught 'error' event.
    req.on('error', () => {});
    res.on('error', () => {});

    let settled = false;
    let received = 0;
    const chunks: Buffer[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;

    const detach = () => {
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('aborted', onAborted);
      if (timer !== undefined) clearTimeout(timer);
    };

    /**
     * An early refusal must reach the peer. Destroying the socket while unread request bytes sit
     * in the kernel produces a reset that can discard the response, so the remainder of the body
     * is consumed and thrown away first, under a hard byte and time bound.
     */
    const refuse = (status: number, body: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      detach();
      chunks.length = 0;
      // A rejected request may still be incomplete. Prevent an HTTP client from
      // reusing its socket for the next request while these bytes are being drained.
      res.setHeader('Connection', 'close');
      res.status(status).json(body);

      let drained = 0;
      let requestEnded = false;
      let responseFinished = false;
      let closed = false;
      let drainTimer: ReturnType<typeof setTimeout> | undefined;

      const closeNow = () => {
        if (closed) return;
        closed = true;
        if (drainTimer !== undefined) clearTimeout(drainTimer);
        req.removeListener('data', onDiscard);
        req.removeListener('end', onRequestEnd);
        req.removeListener('aborted', closeNow);
        req.removeListener('error', closeNow);
        if (!req.destroyed) req.destroy();
      };

      const maybeClose = () => {
        if (requestEnded && responseFinished) closeNow();
      };

      function onDiscard(chunk: Buffer): void {
        drained += chunk.length;
        if (drained > MAX_DISCARD_BYTES) closeNow();
      }

      function onRequestEnd(): void {
        requestEnded = true;
        maybeClose();
      }

      res.on('finish', () => {
        responseFinished = true;
        maybeClose();
      });
      drainTimer = setTimeout(closeNow, DRAIN_CLOSE_MS);
      drainTimer.unref?.();
      req.on('data', onDiscard);
      req.on('end', onRequestEnd);
      req.on('aborted', closeNow);
      req.on('error', closeNow);
    };

    function onData(chunk: Buffer): void {
      if (settled) return;
      received += chunk.length;
      if (received > maxBodyBytes) {
        refuse(413, { error: 'Payload too large', code: 'PAYLOAD_TOO_LARGE' });
        return;
      }
      chunks.push(chunk);
    }

    function onEnd(): void {
      if (settled) return;
      settled = true;
      detach();
      (req as SlackRawBodyRequest).slackRawBody = Buffer.concat(chunks, received);
      next();
    }

    function onAborted(): void {
      // The peer is gone; there is no response to send. Cleanup only.
      if (settled) return;
      settled = true;
      detach();
    }

    const contentLength = req.headers['content-length'];
    if (contentLength !== undefined) {
      const value = Array.isArray(contentLength) ? contentLength[0] ?? '' : contentLength;
      if (!/^\d{1,12}$/.test(value)) {
        refuse(400, { error: 'Invalid content length', code: 'INVALID_CONTENT_LENGTH' });
        return;
      }
      if (Number(value) > maxBodyBytes) {
        refuse(413, { error: 'Payload too large', code: 'PAYLOAD_TOO_LARGE' });
        return;
      }
    }

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('aborted', onAborted);

    timer = setTimeout(() => {
      refuse(408, { error: 'Request body timed out', code: 'REQUEST_TIMEOUT' });
    }, streamTimeoutMs);
    timer.unref?.();
  };
}

/**
 * Router for POST /api/slack/events. It must be mounted before express.json() so the signature is
 * verified over the exact received bytes and no parser touches the body first.
 */
export function createSlackEventsRouter(options: SlackEventsRouterOptions): Router {
  if (!options || typeof options !== 'object') throw new TypeError('Slack events router options are required');
  if (!options.service) throw new TypeError('Slack events router service is required');
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const streamTimeoutMs = options.streamTimeoutMs ?? DEFAULT_STREAM_TIMEOUT_MS;
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes <= 0 || maxBodyBytes > DEFAULT_MAX_BODY_BYTES) {
    throw new TypeError('Slack events maxBodyBytes must be between 1 and 1048576');
  }
  if (!Number.isSafeInteger(streamTimeoutMs) || streamTimeoutMs <= 0 || streamTimeoutMs > 30_000) {
    throw new TypeError('Slack events streamTimeoutMs must be between 1 and 30000');
  }

  const router = Router();
  router.post(
    '/api/slack/events',
    boundedRawBody(maxBodyBytes, streamTimeoutMs),
    async (req: SlackRawBodyRequest, res: Response) => {
      const rawBody = req.slackRawBody;
      if (!rawBody) {
        res.status(400).json({ error: 'Request body is missing', code: 'MALFORMED_EVENT' });
        return;
      }
      try {
        const result = await options.service.handleRequest({
          signatureHeader: req.get('x-slack-signature') ?? undefined,
          timestampHeader: req.get('x-slack-request-timestamp') ?? undefined,
          rawBody,
        });
        res.status(result.status).json(result.body);
      } catch {
        // Never leak exception text (which could carry event content) into the HTTP response.
        res.status(503).json({ error: 'Slack event could not be processed', code: 'DATABASE_UNAVAILABLE' });
      }
    }
  );
  return router;
}
