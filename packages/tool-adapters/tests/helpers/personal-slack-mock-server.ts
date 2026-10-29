import http from 'node:http';
import { URL } from 'node:url';

export interface PersonalSlackRequestRecord {
  path: string;
  query: Record<string, string>;
}

export interface PersonalSlackMockServer {
  url: string;
  close: () => Promise<void>;
  setDelayMs: (ms: number) => void;
  setRateLimitRemainingAttempts: (count: number) => void;
  setNextResponse: (status: number, body: unknown) => void;
  getRequestsCount: () => number;
  getRequestLog: () => PersonalSlackRequestRecord[];
  waitForRequestCount: (count: number, timeoutMs?: number) => Promise<void>;
  reset: () => void;
}

export async function createPersonalSlackMockServer(): Promise<PersonalSlackMockServer> {
  let delayMs = 0;
  let rateLimitRemainingAttempts = 0;
  let requestCount = 0;
  let nextResponse: { status: number; body: unknown } | undefined;
  const requestLog: PersonalSlackRequestRecord[] = [];
  const stalledSockets = new Set<import('node:net').Socket>();
  const requestWaiters: Array<{ count: number; resolve: () => void }> = [];

  function notifyRequestWaiters(): void {
    for (let i = requestWaiters.length - 1; i >= 0; i--) {
      const waiter = requestWaiters[i];
      if (waiter && requestCount >= waiter.count) {
        requestWaiters.splice(i, 1);
        waiter.resolve();
      }
    }
  }

  const server = http.createServer((req, res) => {
    let clientGone = false;
    res.once('close', () => {
      clientGone = true;
    });
    requestCount++;
    if (!stalledSockets.has(req.socket)) {
      stalledSockets.add(req.socket);
      req.socket.once('close', () => stalledSockets.delete(req.socket));
    }
    const authHeader = req.headers['authorization'];
    const token = authHeader?.replace(/^Bearer\s+/i, '');

    const reqUrl = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const pathname = reqUrl.pathname;
    const query = reqUrl.searchParams;
    requestLog.push({ path: pathname, query: Object.fromEntries(query.entries()) });
    notifyRequestWaiters();

    const execute = () => {
      if (clientGone) return;

      // 1. Check redirect simulation
      if (query.get('simulate_redirect') === 'true' || query.get('types') === 'simulate_redirect') {
        res.writeHead(302, { Location: 'https://malicious-site.example.com/steal' });
        res.end();
        return;
      }

      // 2. Check 429 simulation
      if (rateLimitRemainingAttempts > 0) {
        rateLimitRemainingAttempts--;
        res.writeHead(429, {
          'Content-Type': 'application/json',
          'Retry-After': '1',
        });
        res.end(JSON.stringify({ ok: false, error: 'ratelimited' }));
        return;
      }

      // 3. Check large payload simulation (>2MB)
      if (query.get('simulate_oversize') === 'true' || query.get('types') === 'simulate_oversize') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        // Send a 2.5MB payload
        const bigChunk = 'A'.repeat(1024 * 1024); // 1MB
        res.write('{"ok":true,"data":"');
        res.write(bigChunk);
        res.write(bigChunk);
        res.write(bigChunk.slice(0, 600 * 1024));
        res.write('"}');
        res.end();
        return;
      }

      // 4. Token & Workspace Authentication
      if (!token) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'not_authed' }));
        return;
      }

      let workspace = '';
      let actor = '';

      if (token === 'xoxp-token-workspace-a') {
        workspace = 'T_WORKSPACE_A';
        actor = 'U_ACTOR_A';
      } else if (token === 'xoxp-token-workspace-b') {
        workspace = 'T_WORKSPACE_B';
        actor = 'U_ACTOR_B';
      } else if (token === 'xoxp-token-colleague-a') {
        workspace = 'T_WORKSPACE_A';
        actor = 'U_COLLEAGUE';
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'invalid_auth' }));
        return;
      }

      // 5. Stream stall simulation: headers plus a partial body that never ends.
      if (query.get('simulate_stream_stall') === 'true' || query.get('types') === 'simulate_stream_stall') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.write('{"ok":true,"channels":[');
        return;
      }

      // 6. Exact provider response fixture (used for malformed-body boundaries).
      if (nextResponse) {
        const { status, body } = nextResponse;
        nextResponse = undefined;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(typeof body === 'string' ? body : JSON.stringify(body));
        return;
      }

      // 7. Dispatch endpoints
      if (pathname === '/conversations.list') {
        if (workspace === 'T_WORKSPACE_A') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              ok: true,
              channels: [
                {
                  id: 'C_GENERAL_A',
                  name: 'general',
                  is_channel: true,
                  is_private: false,
                  num_members: 2,
                },
                ...(actor === 'U_ACTOR_A'
                  ? [
                      {
                        id: 'C_PRIVATE_A',
                        name: 'secret-a',
                        is_channel: false,
                        is_private: true,
                        num_members: 1,
                      },
                    ]
                  : []),
              ],
              response_metadata: { next_cursor: '' },
            })
          );
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              ok: true,
              channels: [
                {
                  id: 'C_GENERAL_B',
                  name: 'workspace-b-general',
                  is_channel: true,
                  is_private: false,
                  num_members: 1,
                },
              ],
              response_metadata: { next_cursor: '' },
            })
          );
        }
        return;
      }

      if (pathname === '/conversations.info') {
        const channel = query.get('channel');
        if (workspace === 'T_WORKSPACE_A') {
          if (channel === 'C_GENERAL_A') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                ok: true,
                channel: {
                  id: 'C_GENERAL_A',
                  name: 'general',
                  is_private: false,
                  topic: { value: 'General discussion', creator: 'U_ACTOR_A', last_set: 1712345000 },
                  purpose: { value: 'Public channel', creator: 'U_ACTOR_A', last_set: 1712345000 },
                  num_members: 2,
                },
              })
            );
            return;
          }
          if (channel === 'C_PRIVATE_A') {
            if (actor !== 'U_ACTOR_A') {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: 'channel_not_found' }));
              return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                ok: true,
                channel: {
                  id: 'C_PRIVATE_A',
                  name: 'secret-a',
                  is_private: true,
                  num_members: 1,
                },
              })
            );
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'channel_not_found' }));
          return;
        } else {
          // Workspace B
          if (channel === 'C_GENERAL_B') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                ok: true,
                channel: {
                  id: 'C_GENERAL_B',
                  name: 'workspace-b-general',
                  is_private: false,
                  num_members: 1,
                },
              })
            );
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'channel_not_found' }));
          return;
        }
      }

      if (pathname === '/conversations.history') {
        const channel = query.get('channel');
        if (workspace === 'T_WORKSPACE_A' && channel === 'C_GENERAL_A') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              ok: true,
              messages: [
                {
                  type: 'message',
                  user: 'U_ACTOR_A',
                  text: 'Hello from Workspace A',
                  ts: '1712345678.000100',
                  edited: {
                    user: 'U_ACTOR_A',
                    ts: '1712345679.000200',
                  },
                },
                {
                  type: 'message',
                  user: 'U_COLLEAGUE',
                  text: 'Thread parent',
                  ts: '1712345680.000300',
                  reply_count: 1,
                },
                {
                  type: 'message',
                  user: 'U_COLLEAGUE',
                  text: 'Solo message with zero replies',
                  ts: '1712345685.000400',
                  reply_count: 0,
                },
              ],
              has_more: false,
            })
          );
          return;
        }

        if (workspace === 'T_WORKSPACE_B' && channel === 'C_GENERAL_B') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              ok: true,
              messages: [
                {
                  type: 'message',
                  user: 'U_ACTOR_B',
                  text: 'Hello from Workspace B',
                  ts: '1712345999.000100',
                },
              ],
              has_more: false,
            })
          );
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'channel_not_found' }));
        return;
      }

      if (pathname === '/conversations.replies') {
        const channel = query.get('channel');
        const ts = query.get('ts');

        if (workspace === 'T_WORKSPACE_A' && channel === 'C_GENERAL_A') {
          if (ts === '1712345680.000300') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                ok: true,
                messages: [
                  {
                    type: 'message',
                    user: 'U_COLLEAGUE',
                    text: 'Thread parent',
                    ts: '1712345680.000300',
                    reply_count: 1,
                  },
                  {
                    type: 'message',
                    user: 'U_ACTOR_A',
                    text: 'Reply to parent',
                    ts: '1712345681.000100',
                    thread_ts: '1712345680.000300',
                  },
                ],
                has_more: false,
              })
            );
            return;
          }
          if (ts === '1712345685.000400') {
            // Slack contract: message without replies returns ok: true, messages: [root_message]
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                ok: true,
                messages: [
                  {
                    type: 'message',
                    user: 'U_COLLEAGUE',
                    text: 'Solo message with zero replies',
                    ts: '1712345685.000400',
                    reply_count: 0,
                  },
                ],
                has_more: false,
              })
            );
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'thread_not_found' }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'channel_not_found' }));
        return;
      }

      if (pathname === '/conversations.members') {
        const channel = query.get('channel');
        if (workspace === 'T_WORKSPACE_A' && channel === 'C_GENERAL_A') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              ok: true,
              members: ['U_ACTOR_A', 'U_COLLEAGUE'],
              response_metadata: { next_cursor: '' },
            })
          );
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'channel_not_found' }));
        return;
      }

      if (pathname === '/users.list') {
        if (workspace === 'T_WORKSPACE_A') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              ok: true,
              members: [
                {
                  id: 'U_ACTOR_A',
                  team_id: 'T_WORKSPACE_A',
                  name: 'actor_a',
                  deleted: false,
                  real_name: 'Actor Alpha',
                  tz: 'Asia/Saigon',
                  is_bot: false,
                  is_admin: true,
                  profile: {
                    email: 'secret_actor_a@example.com',
                    avatar_hash: 'secret_hash_a',
                    image_24: 'https://avatar.example.com/24.png',
                  },
                },
                {
                  id: 'U_COLLEAGUE',
                  team_id: 'T_WORKSPACE_A',
                  name: 'colleague',
                  deleted: false,
                  real_name: 'Colleague User',
                  tz: 'Asia/Saigon',
                  is_bot: false,
                  profile: {
                    email: 'colleague@example.com',
                  },
                },
              ],
              response_metadata: { next_cursor: '' },
            })
          );
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            members: [
              {
                id: 'U_ACTOR_B',
                team_id: 'T_WORKSPACE_B',
                name: 'actor_b',
                deleted: false,
                real_name: 'Actor Beta',
                tz: 'UTC',
                is_bot: false,
              },
            ],
            response_metadata: { next_cursor: '' },
          })
        );
        return;
      }

      if (pathname === '/users.info') {
        const user = query.get('user');
        if (workspace === 'T_WORKSPACE_A' && (user === 'U_ACTOR_A' || user === 'U_COLLEAGUE')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              ok: true,
              user: {
                id: user,
                team_id: 'T_WORKSPACE_A',
                name: user === 'U_ACTOR_A' ? 'actor_a' : 'colleague',
                deleted: false,
                real_name: user === 'U_ACTOR_A' ? 'Actor Alpha' : 'Colleague User',
                tz: 'Asia/Saigon',
                is_bot: false,
                profile: {
                  email: user === 'U_ACTOR_A' ? 'secret_actor_a@example.com' : 'colleague@example.com',
                  avatar_hash: 'secret_avatar_hash',
                },
              },
            })
          );
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'user_not_found' }));
        return;
      }

      if (pathname === '/chat.getPermalink') {
        const channel = query.get('channel');
        const message_ts = query.get('message_ts');

        if (workspace === 'T_WORKSPACE_A' && channel === 'C_GENERAL_A' && message_ts) {
          const permalinkTs = message_ts.replace('.', '');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              ok: true,
              channel: 'C_GENERAL_A',
              permalink: `https://workspace-a.slack.com/archives/C_GENERAL_A/p${permalinkTs}`,
            })
          );
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'message_not_found' }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'unknown_method' }));
    };

    if (delayMs > 0) {
      setTimeout(execute, delayMs);
    } else {
      execute();
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const url = `http://127.0.0.1:${port}`;

  return {
    url,
    close: () => new Promise<void>((resolve, reject) => {
      for (const socket of stalledSockets) socket.destroy();
      stalledSockets.clear();
      server.closeAllConnections();
      server.close((err) => (err ? reject(err) : resolve()));
    }),
    setDelayMs: (ms: number) => {
      delayMs = ms;
    },
    setRateLimitRemainingAttempts: (count: number) => {
      rateLimitRemainingAttempts = count;
    },
    setNextResponse: (status: number, body: unknown) => {
      nextResponse = { status, body };
    },
    getRequestsCount: () => requestCount,
    getRequestLog: () => requestLog.map((entry) => ({ path: entry.path, query: { ...entry.query } })),
    waitForRequestCount: (count: number, timeoutMs = 5000) =>
      new Promise<void>((resolve, reject) => {
        if (requestCount >= count) {
          resolve();
          return;
        }
        const waiter = {
          count,
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
        };
        const timer = setTimeout(() => {
          const index = requestWaiters.indexOf(waiter);
          if (index >= 0) requestWaiters.splice(index, 1);
          reject(new Error(`Timed out waiting for ${count} mock server requests (saw ${requestCount})`));
        }, timeoutMs);
        requestWaiters.push(waiter);
      }),
    reset: () => {
      delayMs = 0;
      rateLimitRemainingAttempts = 0;
      requestCount = 0;
      nextResponse = undefined;
      requestLog.length = 0;
    },
  };
}
