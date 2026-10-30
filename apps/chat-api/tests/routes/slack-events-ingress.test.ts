import { createHmac, randomUUID } from 'node:crypto';
import http from 'node:http';
import { once } from 'node:events';
import express from 'express';
import request from 'supertest';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
import { SlackEventReceiptRepo } from '../../src/db/repositories/slack-event-receipt-repo.js';
import { SlackIngressService, type SlackIngressRuntimeConfig } from '../../src/services/slack/slack-ingress-service.js';
import { SlackInvalidationService } from '../../src/services/slack/slack-invalidation-service.js';
import { createSlackEventsRouter, DEFAULT_MAX_BODY_BYTES } from '../../src/routes/slack-events.js';

const SECRET = 'route-test-signing-secret';
const APP_ID = 'A04AROUTE';
const TEAM_ID = 'T04AROUTE';
const NOW_MS = 1_730_214_000_500;
const NOW_SECONDS = 1_730_214_000;

function signature(raw: Buffer, timestampHeader: string, secret = SECRET): string {
  return `v0=${createHmac('sha256', secret).update(`v0:${timestampHeader}:`).update(raw).digest('hex')}`;
}

function signedJson(body: unknown, secret = SECRET) {
  const raw = Buffer.from(JSON.stringify(body), 'utf8');
  const timestampHeader = String(NOW_SECONDS);
  return { raw, timestampHeader, signatureHeader: signature(raw, timestampHeader, secret) };
}

function eventBody(overrides: Record<string, unknown> = {}) {
  return {
    token: 'verification-token',
    team_id: TEAM_ID,
    api_app_id: APP_ID,
    type: 'event_callback',
    event_id: `Ev${randomUUID().replaceAll('-', '')}`,
    event_time: NOW_SECONDS,
    event_context: 'connect',
    event: {
      type: 'message',
      channel: 'C04A',
      user: 'U04A',
      text: 'ROUTE_CONFIDENTIAL_TEXT',
      ts: '1730214000.000100',
      event_ts: '1730214000.000100',
    },
    ...overrides,
  };
}

interface RawResponse {
  status: number;
  body: string;
}

function rawRequest(
  url: URL,
  options: {
    headers?: Record<string, string>;
    chunks?: Buffer[];
    endWithoutBody?: boolean;
    /** Leave the request open after the listed chunks; the peer must answer while it is in flight. */
    keepRequestOpen?: boolean;
  }
): Promise<RawResponse> {
  return new Promise(resolve => {
    let settled = false;
    let status = 0;
    let request: http.ClientRequest | undefined;
    const chunks: Buffer[] = [];
    const finish = () => {
      if (settled) return;
      settled = true;
      if (options.keepRequestOpen) request?.destroy();
      resolve({ status, body: Buffer.concat(chunks).toString('utf8') });
    };
    const req = http.request(url, { method: 'POST', headers: options.headers ?? {} }, res => {
      if (process.env.SLACK_ROUTE_DEBUG) console.error('[raw] response callback', res.statusCode, options.keepRequestOpen);
      status = res.statusCode ?? 0;
      res.on('data', chunk => chunks.push(Buffer.from(chunk)));
      res.on('end', finish);
      // Covers both a normal close and the deliberate socket destroy after a 413/408.
      res.on('close', finish);
    });
    request = req;
    // Only a request error with no response at all settles here; once headers have arrived the
    // response events above decide (a request 'close' fires as soon as the body is written).
    req.on('error', (error: NodeJS.ErrnoException) => {
      if (process.env.SLACK_ROUTE_DEBUG) console.error('[raw] error', error.code, error.message, 'status', status, options.keepRequestOpen);
      if (status === 0) finish();
    });
    if (options.endWithoutBody) {
      req.end();
      return;
    }
    // Pace writes by socket backpressure so the peer can read and answer while a large body is
    // still in flight; dumping it all synchronously races the early 413 against a socket reset.
    const pending = options.chunks ?? [];
    let index = 0;
    const writeNext = () => {
      if (settled) {
        req.destroy();
        return;
      }
      if (index === pending.length) {
        if (options.keepRequestOpen) return;
        req.end();
        return;
      }
      const chunk = pending[index]!;
      index += 1;
      if (req.write(chunk)) setImmediate(writeNext);
      else req.once('drain', writeNext);
    };
    writeNext();
  });
}

describe('POST /api/slack/events (SLACK-04A)', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let invalidation: SlackInvalidationService;
  let repo: SlackEventReceiptRepo;
  let service: SlackIngressService;
  let app: express.Express;
  let server: http.Server;
  let baseUrl: URL;
  let brokenPool: pg.Pool;

  const config: SlackIngressRuntimeConfig = { signingSecret: SECRET, appId: APP_ID, automationEnabled: true };

  interface SignedRequest {
    raw: Buffer;
    timestampHeader: string;
    signatureHeader: string;
  }

  /** Sends the exact signed bytes over a real socket; supertest would JSON-serialize a Buffer. */
  async function postSigned(
    signed: SignedRequest,
    target: URL = baseUrl
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await rawRequest(target, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(signed.raw.length),
        'X-Slack-Request-Timestamp': signed.timestampHeader,
        'X-Slack-Signature': signed.signatureHeader,
      },
      chunks: [signed.raw],
    });
    return { status: response.status, body: response.body ? JSON.parse(response.body) : {} };
  }

  beforeAll(async () => {
    db = await createMigratedSchema('slack_events_route');
    invalidation = new SlackInvalidationService(db.pool);
    repo = new SlackEventReceiptRepo(db.pool, invalidation);
    service = new SlackIngressService({ config, repo, clock: () => NOW_MS });

    app = express();
    app.use(createSlackEventsRouter({ service }));
    app.use(express.json());
    app.post('/api/probe', (req, res) => {
      res.json({ parsed: req.body });
    });

    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not bind');
    baseUrl = new URL(`http://127.0.0.1:${address.port}/api/slack/events`);
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server?.close(() => resolve()));
    server?.closeAllConnections?.();
    await brokenPool?.end();
    await db?.close();
  });

  it('T4.1: streams exact raw bytes to the verifier even with express.json mounted afterwards', async () => {
    const body = {
      token: 'verification-token',
      challenge: 'route-challenge-中文-🚀',
      type: 'url_verification',
    };
    const signed = signedJson(body);
    const res = await postSigned(signed);
    expect({ status: res.status, body: res.body }).toEqual({ status: 200, body: { challenge: 'route-challenge-中文-🚀' } });
    expect(JSON.stringify(res.body)).not.toContain(SECRET);

    const probe = await request(app).post('/api/probe').send({ hello: 'world' });
    expect(probe.status).toBe(200);
    expect(probe.body).toEqual({ parsed: { hello: 'world' } });
  });

  it('T4.1b: commits an ordinary event receipt through the real HTTP stack', async () => {
    const body = eventBody();
    const signed = signedJson(body);
    const res = await postSigned(signed);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(JSON.stringify(res.body)).not.toContain('ROUTE_CONFIDENTIAL_TEXT');

    const rows = await db.pool.query(
      'SELECT * FROM slack_event_receipts WHERE slack_app_id = $1 AND event_id = $2',
      [APP_ID, body.event_id]
    );
    expect(rows.rows[0]).toMatchObject({
      status: 'pending_fanout',
      source_event_ts: '1730214000.000100',
      channel_id: 'C04A',
    });
  });

  it('T4.2: rejects an over-limit Content-Length with 413 before reading the body', async () => {
    const timestamp = String(NOW_SECONDS);
    const response = await rawRequest(baseUrl, {
      headers: {
        'Content-Type': 'application/json',
        'X-Slack-Request-Timestamp': timestamp,
        'X-Slack-Signature': `v0=${'a'.repeat(64)}`,
        'Content-Length': String(DEFAULT_MAX_BODY_BYTES + 1),
      },
      endWithoutBody: true,
    });
    expect(response.status).toBe(413);
    expect(JSON.parse(response.body)).toEqual({ error: 'Payload too large', code: 'PAYLOAD_TOO_LARGE' });
  });

  it('T4.2b: rejects a chunked stream that crosses 1 MiB with 413', async () => {
    const timestamp = String(NOW_SECONDS);
    const chunk = Buffer.alloc(64 * 1024, 0x61);
    const chunks = Array.from({ length: 17 }, () => chunk);
    const response = await rawRequest(baseUrl, {
      headers: {
        'Content-Type': 'application/json',
        'X-Slack-Request-Timestamp': timestamp,
        'X-Slack-Signature': `v0=${'a'.repeat(64)}`,
      },
      chunks,
      keepRequestOpen: true,
    });
    expect(response.status).toBe(413);
    expect(JSON.parse(response.body).code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('T4.3: a stalled stream times out safely and the server keeps serving', async () => {
    const timedService = new SlackIngressService({ config, repo, clock: () => NOW_MS });
    const timedApp = express();
    timedApp.use(createSlackEventsRouter({ service: timedService, streamTimeoutMs: 150 }));
    const timedServer = timedApp.listen(0, '127.0.0.1');
    await once(timedServer, 'listening');
    const address = timedServer.address();
    if (!address || typeof address === 'string') throw new Error('server did not bind');
    const url = new URL(`http://127.0.0.1:${address.port}/api/slack/events`);

    try {
      const response = await new Promise<RawResponse>(resolve => {
        const req = http.request(
          url,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Slack-Request-Timestamp': String(NOW_SECONDS),
              'X-Slack-Signature': `v0=${'a'.repeat(64)}`,
              'Content-Length': '10',
            },
          },
          res => {
            const chunks: Buffer[] = [];
            res.on('data', chunk => chunks.push(Buffer.from(chunk)));
            res.on('end', () =>
              resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
            );
            res.on('error', () => {});
          }
        );
        req.on('error', () => {});
        req.write(Buffer.from('ab', 'utf8'));
      });
      expect(response.status).toBe(408);
      expect(JSON.parse(response.body).code).toBe('REQUEST_TIMEOUT');
    } finally {
      timedServer.closeAllConnections?.();
      await new Promise<void>(resolve => timedServer.close(() => resolve()));
    }

    const signed = signedJson({ type: 'url_verification', challenge: 'after-timeout' });
    const res = await postSigned(signed);
    expect(res.status).toBe(200);
  });

  it('T4.3b: an aborted request does not crash the server', async () => {
    await new Promise<void>(resolve => {
      const req = http.request(
        baseUrl,
        { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': '10' } },
        res => {
          res.resume();
          res.on('end', resolve);
          res.on('error', () => resolve());
        }
      );
      req.on('error', () => resolve());
      req.write(Buffer.from('ab', 'utf8'));
      setTimeout(() => {
        req.destroy();
        resolve();
      }, 20);
    });
    await new Promise(resolve => setTimeout(resolve, 50));

    const signed = signedJson({ type: 'url_verification', challenge: 'after-abort' });
    const res = await postSigned(signed);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ challenge: 'after-abort' });
  });

  it('T4.4: rejects bad signatures, stale timestamps and malformed JSON', async () => {
    const body = eventBody();
    const signed = signedJson(body);

    const badSignature = await postSigned({ ...signed, signatureHeader: `v0=${'0'.repeat(64)}` });
    expect(badSignature.status).toBe(401);
    expect(badSignature.body.code).toBe('INVALID_SIGNATURE');

    const staleHeader = String(NOW_SECONDS - 301);
    const stale = await postSigned({
      raw: signed.raw,
      timestampHeader: staleHeader,
      signatureHeader: signature(signed.raw, staleHeader),
    });
    expect(stale.status).toBe(400);
    expect(stale.body.code).toBe('INVALID_TIMESTAMP');

    const raw = Buffer.from('{not json', 'utf8');
    const malformed = await postSigned({
      raw,
      timestampHeader: String(NOW_SECONDS),
      signatureHeader: signature(raw, String(NOW_SECONDS)),
    });
    expect(malformed.status).toBe(400);
    expect(malformed.body.code).toBe('INVALID_JSON');

    const missingApp = eventBody({ api_app_id: 'A_WRONG' });
    const mismatch = await postSigned(signedJson(missingApp));
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.code).toBe('APP_ID_MISMATCH');
  });

  it('T4.4b: a real database outage returns 503 and never a fake 200', async () => {
    brokenPool = new pg.Pool({
      connectionString: 'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:1/ati_v3',
      connectionTimeoutMillis: 500,
      max: 1,
    });
    const brokenRepo = new SlackEventReceiptRepo(brokenPool, new SlackInvalidationService(brokenPool));
    const brokenApp = express();
    brokenApp.use(
      createSlackEventsRouter({ service: new SlackIngressService({ config, repo: brokenRepo, clock: () => NOW_MS }) })
    );
    const brokenServer = brokenApp.listen(0, '127.0.0.1');
    await once(brokenServer, 'listening');
    const address = brokenServer.address();
    if (!address || typeof address === 'string') throw new Error('broken server did not bind');

    try {
      const body = eventBody();
      const res = await postSigned(signedJson(body), new URL(`http://127.0.0.1:${address.port}/api/slack/events`));
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('DATABASE_UNAVAILABLE');
      expect(JSON.stringify(res.body)).not.toContain('ROUTE_CONFIDENTIAL_TEXT');
    } finally {
      brokenServer.closeAllConnections?.();
      await new Promise<void>(resolve => brokenServer.close(() => resolve()));
    }
  });

  it('T4.5: duplicate deliveries over HTTP return 200 once without duplicating receipts', async () => {
    const body = eventBody();
    const signed = signedJson(body);
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await postSigned(signed);
      expect(res.status).toBe(200);
    }
    const count = await db.pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM slack_event_receipts WHERE slack_app_id = $1 AND event_id = $2',
      [APP_ID, body.event_id]
    );
    expect(count.rows[0]?.n).toBe('1');
  });
});
