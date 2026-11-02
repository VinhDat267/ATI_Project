import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket, AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';

export interface IssuedCodeOptions {
  accountId: string;
  scopes?: string[];
  sites?: Array<{ id: string; name: string; url: string; scopes: string[] }>;
  expiresInSeconds?: number;
}

export interface FixtureOverride {
  delayMs?: number;
  status?: number;
  headers?: Record<string, string>;
  body?: any;
  rawBody?: string | Buffer;
  hang?: boolean;
  closeImmediately?: boolean;
}

export interface RecordedRequest {
  method: string;
  path: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: any;
  rawBody: string;
}

interface IssuedCodeData {
  accountId: string;
  scopes: string[];
  sites: Array<{ id: string; name: string; url: string; scopes: string[] }>;
  expiresInSeconds: number;
}

interface TokenData {
  accountId: string;
  scopes: string[];
  sites: Array<{ id: string; name: string; url: string; scopes: string[] }>;
}

interface PauseBarrier {
  reached: Promise<void>;
  release: () => void;
}

interface InternalPauseEntry {
  reachedPromise: Promise<void>;
  resolveReached: () => void;
  releasePromise: Promise<void>;
  resolveRelease: () => void;
}

export interface JiraOAuthFixture {
  readonly baseUrl: string;
  readonly port: number;
  readonly requests: RecordedRequest[];
  issueCode(options: IssuedCodeOptions): string;
  registerToken(
    accessToken: string,
    data: {
      accountId: string;
      scopes?: string[];
      sites?: Array<{ id: string; name: string; url: string; scopes: string[] }>;
    }
  ): void;
  setOverride(path: string, override: FixtureOverride): void;
  clearOverrides(): void;
  pauseNext(path: string): PauseBarrier;
  reset(): void;
  close(): Promise<void>;
}

export async function createJiraOAuthTestFixture(): Promise<JiraOAuthFixture> {
  const recordedRequests: RecordedRequest[] = [];
  const issuedCodes = new Map<string, IssuedCodeData>();
  const tokens = new Map<string, TokenData>();
  const refreshTokens = new Map<string, TokenData>();
  const overrides = new Map<string, FixtureOverride>();
  const pauseMap = new Map<string, InternalPauseEntry[]>();
  const activeSockets = new Set<Socket>();

  const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      // 1. Buffer the body chunks
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      const rawBody = Buffer.concat(chunks).toString('utf8');

      // 2. Parse body depending on Content-Type
      let parsedBody: any = null;
      if (rawBody.length > 0) {
        const contentType = req.headers['content-type'] ?? '';
        if (contentType.includes('application/json')) {
          try {
            parsedBody = JSON.parse(rawBody);
          } catch {
            parsedBody = rawBody;
          }
        } else if (contentType.includes('application/x-www-form-urlencoded')) {
          const params = new URLSearchParams(rawBody);
          parsedBody = Object.fromEntries(params.entries());
        } else {
          try {
            parsedBody = JSON.parse(rawBody);
          } catch {
            parsedBody = rawBody;
          }
        }
      }

      const method = (req.method ?? 'GET').toUpperCase();
      const reqUrl = req.url ?? '/';
      const parsedUrl = new URL(reqUrl, `http://127.0.0.1`);
      const path = parsedUrl.pathname;

      // 3. Record request
      recordedRequests.push({
        method,
        path,
        url: reqUrl,
        headers: req.headers,
        body: parsedBody,
        rawBody,
      });

      // 4. Check if next request on this path is paused via barrier
      const pauses = pauseMap.get(path);
      if (pauses && pauses.length > 0) {
        const pauseEntry = pauses.shift();
        if (pauseEntry) {
          pauseEntry.resolveReached();
          await pauseEntry.releasePromise;
        }
      }

      // 5. Check overrides for this exact path
      const override = overrides.get(path);
      if (override) {
        if (override.delayMs && override.delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, override.delayMs));
        }

        if (override.closeImmediately) {
          req.socket.destroy();
          return;
        }

        if (override.hang) {
          // Never respond or close, simulating a permanently stalled upstream response
          return;
        }

        if (override.rawBody !== undefined) {
          const status = override.status ?? 200;
          const headers = override.headers ?? { 'Content-Type': 'application/json' };
          res.writeHead(status, headers);
          res.end(override.rawBody);
          return;
        }

        if (override.body !== undefined) {
          const status = override.status ?? 200;
          const headers = override.headers ?? { 'Content-Type': 'application/json' };
          res.writeHead(status, headers);
          res.end(typeof override.body === 'string' ? override.body : JSON.stringify(override.body));
          return;
        }

        if (override.status !== undefined) {
          res.writeHead(override.status, override.headers ?? {});
          res.end();
          return;
        }
      }

      // 6. Default endpoint handlers
      if (path === '/oauth/token' && method === 'POST') {
        const grantType = parsedBody?.grant_type;

        if (grantType === 'authorization_code') {
          const code = parsedBody?.code;
          const codeData = issuedCodes.get(code);

          if (!codeData) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid or consumed authorization code' }));
            return;
          }

          // Single use: consume code immediately
          issuedCodes.delete(code);

          const accessToken = `at_${randomUUID().replaceAll('-', '')}`;
          const refreshToken = `rt_${randomUUID().replaceAll('-', '')}`;

          tokens.set(accessToken, {
            accountId: codeData.accountId,
            scopes: codeData.scopes,
            sites: codeData.sites,
          });

          refreshTokens.set(refreshToken, {
            accountId: codeData.accountId,
            scopes: codeData.scopes,
            sites: codeData.sites,
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              access_token: accessToken,
              refresh_token: refreshToken,
              expires_in: codeData.expiresInSeconds,
              scope: codeData.scopes.join(' '),
              token_type: 'Bearer',
            })
          );
          return;
        }

        if (grantType === 'refresh_token') {
          const incomingRefreshToken = parsedBody?.refresh_token;
          const tokenData = refreshTokens.get(incomingRefreshToken);

          if (!tokenData) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid or expired refresh token' }));
            return;
          }

          // Rotating refresh tokens: delete the old one
          refreshTokens.delete(incomingRefreshToken);

          const newAccessToken = `at_${randomUUID().replaceAll('-', '')}`;
          const newRefreshToken = `rt_${randomUUID().replaceAll('-', '')}`;

          tokens.set(newAccessToken, {
            accountId: tokenData.accountId,
            scopes: tokenData.scopes,
            sites: tokenData.sites,
          });

          refreshTokens.set(newRefreshToken, {
            accountId: tokenData.accountId,
            scopes: tokenData.scopes,
            sites: tokenData.sites,
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              access_token: newAccessToken,
              refresh_token: newRefreshToken,
              expires_in: 3600,
              scope: tokenData.scopes.join(' '),
              token_type: 'Bearer',
            })
          );
          return;
        }

        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unsupported_grant_type', error_description: `Unsupported grant_type: ${grantType}` }));
        return;
      }

      if (path === '/me' && method === 'GET') {
        const authHeader = req.headers['authorization'];
        const match = /^Bearer\s+(.+)$/i.exec(typeof authHeader === 'string' ? authHeader : '');
        const token = match?.[1]?.trim();
        if (!token) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'unauthorized', message: 'Missing or malformed Authorization header' }));
          return;
        }

        const tokenData = tokens.get(token);
        if (!tokenData) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_token', message: 'Token not found or expired' }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            account_id: tokenData.accountId,
            email: `${tokenData.accountId}@example.test`,
            name: `User ${tokenData.accountId}`,
          })
        );
        return;
      }

      if (path === '/oauth/token/accessible-resources' && method === 'GET') {
        const authHeader = req.headers['authorization'];
        const match = /^Bearer\s+(.+)$/i.exec(typeof authHeader === 'string' ? authHeader : '');
        const token = match?.[1]?.trim();
        if (!token) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'unauthorized', message: 'Missing or malformed Authorization header' }));
          return;
        }

        const tokenData = tokens.get(token);
        if (!tokenData) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_token', message: 'Token not found or expired' }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(tokenData.sites));
        return;
      }

      // Default fallback for any other path (e.g. /authorize)
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'fixture_internal_error', message: String(err) }));
      }
    }
  });

  // Track all sockets to permit fast and clean termination
  server.on('connection', (socket: Socket) => {
    activeSockets.add(socket);
    socket.on('close', () => {
      activeSockets.delete(socket);
    });
  });

  // Listen on loopback 127.0.0.1 on ephemeral port 0
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.once('error', reject);
  });

  const address = server.address() as AddressInfo;
  const port = address.port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const fixture: JiraOAuthFixture = {
    get baseUrl() {
      return baseUrl;
    },
    get port() {
      return port;
    },
    get requests() {
      return recordedRequests;
    },
    issueCode(options: IssuedCodeOptions): string {
      const code = `code_${randomUUID().replaceAll('-', '')}`;
      issuedCodes.set(code, {
        accountId: options.accountId,
        scopes: options.scopes ?? ['read:me', 'read:jira-work', 'offline_access'],
        sites: options.sites ?? [],
        expiresInSeconds: options.expiresInSeconds ?? 3600,
      });
      return code;
    },
    registerToken(accessToken: string, data) {
      tokens.set(accessToken, {
        accountId: data.accountId,
        scopes: data.scopes ?? ['read:me', 'read:jira-work', 'offline_access'],
        sites: data.sites ?? [],
      });
    },
    setOverride(path: string, override: FixtureOverride) {
      overrides.set(path, override);
    },
    clearOverrides() {
      overrides.clear();
    },
    pauseNext(path: string): PauseBarrier {
      let resolveReached!: () => void;
      const reached = new Promise<void>((resolve) => {
        resolveReached = resolve;
      });
      let resolveRelease!: () => void;
      const releasePromise = new Promise<void>((resolve) => {
        resolveRelease = resolve;
      });

      const entry: InternalPauseEntry = {
        reachedPromise: reached,
        resolveReached,
        releasePromise,
        resolveRelease,
      };

      const list = pauseMap.get(path) ?? [];
      list.push(entry);
      pauseMap.set(path, list);

      return {
        reached,
        release: resolveRelease,
      };
    },
    reset() {
      recordedRequests.length = 0;
      issuedCodes.clear();
      tokens.clear();
      refreshTokens.clear();
      overrides.clear();
      pauseMap.clear();
    },
    async close(): Promise<void> {
      for (const socket of activeSockets) {
        socket.destroy();
      }
      activeSockets.clear();
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };

  return fixture;
}
