import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { encryptCredentials } from '@wap/tool-adapters';
import { UserRepo } from '../../src/db/repositories/user-repo.js';
import { NotionConnectionRepo } from '../../src/db/repositories/notion-connection-repo.js';

const V3_MIGRATIONS_DIR = fileURLToPath(new URL('../../../../db/v3/', import.meta.url));
const FORBIDDEN_DB_PORTS = new Set([55533, 56533, 56534, 51850]);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);
const GUARD_SYMBOL = Symbol.for('ati.notion.n2b.loopbackGuard');

interface GuardState {
  allowedDbPort: number;
  ephemeralServers: Set<net.Server>;
}

export function fingerprintSecret(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

export function assertAssignedNotionTestDatabaseUrl(): { connectionString: string; port: number } {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error(
      '[N2B_DB_GUARD] DATABASE_URL must be explicitly set to the assigned disposable Notion N2-B PostgreSQL instance.',
    );
  }
  const parsed = new URL(raw);
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const port = Number(parsed.port || 5432);
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(`[N2B_DB_GUARD] Non-loopback DATABASE_URL host is forbidden: ${host}`);
  }
  if (FORBIDDEN_DB_PORTS.has(port)) {
    throw new Error(`[N2B_DB_GUARD] Shared/foreign PostgreSQL port ${port} is strictly forbidden.`);
  }
  installLoopbackOnlyNetworkGuard(port);
  return { connectionString: raw, port };
}

export function installLoopbackOnlyNetworkGuard(allowedDbPort: number): void {
  const g = globalThis as Record<symbol, GuardState | undefined>;
  if (g[GUARD_SYMBOL]) {
    return;
  }
  const state: GuardState = {
    allowedDbPort,
    ephemeralServers: new Set<net.Server>(),
  };
  g[GUARD_SYMBOL] = state;

  const origListen = net.Server.prototype.listen;
  net.Server.prototype.listen = function patchedListen(this: net.Server, ...args: any[]) {
    let requestedPort: number | undefined;
    if (typeof args[0] === 'number') {
      requestedPort = args[0];
    } else if (args[0] && typeof args[0] === 'object' && 'port' in args[0]) {
      requestedPort = args[0].port;
    }
    if (requestedPort === 0 || requestedPort === undefined) {
      state.ephemeralServers.add(this);
      this.once('close', () => state.ephemeralServers.delete(this));
    }
    return origListen.apply(this, args as any);
  };

  const isAllowedLoopbackPort = (port: number): boolean => {
    if (port === state.allowedDbPort) return true;
    const explicitChildPort = Number(process.env.N2B_ALLOWED_LOOPBACK_PORT || 0);
    if (explicitChildPort > 1024 && !FORBIDDEN_DB_PORTS.has(explicitChildPort) && port === explicitChildPort) {
      return true;
    }
    for (const srv of state.ephemeralServers) {
      const addr = srv.address();
      if (addr && typeof addr === 'object' && addr.port === port) {
        return true;
      }
    }
    return false;
  };

  const parseConnectArgs = (args: any[]): { ipc?: boolean; host: string; port: number } => {
    if (Array.isArray(args[0])) return parseConnectArgs(args[0]);
    if (args[0] && typeof args[0] === 'object') {
      if (args[0].path) return { ipc: true, host: '', port: 0 };
      return {
        host: String(args[0].host || args[0].hostname || '127.0.0.1'),
        port: Number(args[0].port),
      };
    }
    if (typeof args[0] === 'string' && Number.isNaN(Number(args[0]))) {
      return { ipc: true, host: '', port: 0 };
    }
    return {
      port: Number(args[0]),
      host: typeof args[1] === 'string' ? args[1] : '127.0.0.1',
    };
  };

  const enforceTarget = (kind: string, target: { ipc?: boolean; host: string; port: number }) => {
    if (target.ipc) return;
    const host = target.host.replace(/^\[|\]$/g, '').toLowerCase();
    if (!LOOPBACK_HOSTS.has(host)) {
      throw new Error(`[N2B_NET_GUARD] Blocked ${kind} to external host ${host}:${target.port}`);
    }
    if (!isAllowedLoopbackPort(target.port)) {
      throw new Error(`[N2B_NET_GUARD] Blocked ${kind} to unauthorized loopback port ${host}:${target.port}`);
    }
  };

  const origSocketConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function patchedConnect(this: net.Socket, ...args: any[]) {
    enforceTarget('tcp', parseConnectArgs(args));
    return origSocketConnect.apply(this, args as any);
  };

  const origTlsConnect = tls.connect;
  (tls as any).connect = function patchedTlsConnect(...args: any[]) {
    enforceTarget('tls', parseConnectArgs(args));
    return (origTlsConnect as any).apply(tls, args);
  };
}

export async function listV3MigrationFiles(): Promise<string[]> {
  return (await readdir(V3_MIGRATIONS_DIR)).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
}

export async function applyMigrations(
  db: Pick<pg.Pool, 'query'>,
  filterFn?: (fileName: string) => boolean,
): Promise<string[]> {
  const files = (await listV3MigrationFiles()).filter((f) => (filterFn ? filterFn(f) : true));
  for (const file of files) {
    const sql = await readFile(`${V3_MIGRATIONS_DIR}/${file}`, 'utf8');
    await db.query(sql);
  }
  return files;
}

export interface InspectedNotionRow {
  id: string;
  userId: string;
  appId: string;
  workspaceId: string;
  workspaceName: string;
  actorId: string;
  botId: string;
  identityVersion: number;
  status: 'active' | 'reconnect_required' | 'disconnected';
  authFailureCode: string | null;
  refreshInFlight: boolean;
  isDefault: boolean;
  allowedDatabases: string[];
  configPresent: boolean;
  configFingerprint: string | null;
  xmin: string;
}

export async function createNotionDurabilitySchema(prefix: string) {
  const { connectionString } = assertAssignedNotionTestDatabaseUrl();
  const schema = `${prefix}_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString, max: 2, connectionTimeoutMillis: 5000 });
  await admin.query(`CREATE SCHEMA "${schema}"`);

  const url = new URL(connectionString);
  url.searchParams.set('options', `-c search_path=${schema} -c lock_timeout=4000ms -c statement_timeout=10000ms`);
  const pool = new pg.Pool({ connectionString: url.href, max: 14, connectionTimeoutMillis: 5000 });
  await applyMigrations(pool);

  const users = new UserRepo(pool);
  const repo = new NotionConnectionRepo(pool);

  return {
    schema,
    schemaDatabaseUrl: url.href,
    pool,
    users,
    repo,
    async person(name = 'Notion Test Member') {
      const user = await users.createUser({
        email: `${randomUUID()}@notion-n2b.test`,
        name,
        password: 'SyntheticPassword!2026#Safe',
      });
      await pool.query("UPDATE users SET status='active', email_verified=true WHERE id=$1", [user.id]);
      const { sessionId } = await users.sessions.create(user.id, 'notion-n2b-test');
      return { id: user.id, email: user.email, name, role: 'member' as const, sid: sessionId };
    },
    async seedConnection(input: {
      userId: string;
      sessionId: string;
      encryptionKey: string;
      appId?: string;
      workspaceId?: string;
      workspaceName?: string;
      actorId?: string;
      botId?: string;
      accessToken?: string;
      refreshToken?: string;
      databases?: Array<{ id: string; title: string; url?: string }>;
    }) {
      const stateToken = `state_${randomUUID().replaceAll('-', '')}`;
      const browserToken = `browser_${randomUUID().replaceAll('-', '')}`;
      await repo.start({
        userId: input.userId,
        sessionId: input.sessionId,
        stateHash: NotionConnectionRepo.hash(stateToken),
        browserHash: NotionConnectionRepo.hash(browserToken),
      });
      const consumed = await repo.consume({
        userId: input.userId,
        sessionId: input.sessionId,
        state: stateToken,
        browser: browserToken,
      });
      if (!consumed) throw new Error('Failed to consume synthetic OAuth state');

      const botId = input.botId ?? randomUUID();
      const ciphertext = encryptCredentials(
        {
          accessToken: input.accessToken ?? `syn_access_${randomUUID()}`,
          refreshToken: input.refreshToken ?? `syn_refresh_${randomUUID()}`,
          botId,
        },
        input.encryptionKey,
      );
      let row = await repo.save(input.userId, consumed.id, {
        appId: input.appId ?? 'notion-app-1',
        workspaceId: input.workspaceId ?? randomUUID(),
        workspaceName: input.workspaceName ?? 'Synthetic Workspace',
        actorId: input.actorId ?? randomUUID(),
        botId,
        config: ciphertext,
        scopes: ['read_content'],
      });
      if (!row) throw new Error('Failed to save synthetic Notion connection');

      if (input.databases && input.databases.length > 0) {
        const ok = await repo.selectDatabases(input.userId, row.id, row.identity_version, input.databases);
        if (!ok) throw new Error('Failed to select synthetic databases');
        row = (await repo.getActive(input.userId, row.id))!;
      }
      return row;
    },
    async inspectRow(id: string): Promise<InspectedNotionRow | null> {
      const res = await pool.query<any>(
        'SELECT *, xmin::text AS tuple_xmin FROM notion_connections WHERE id = $1',
        [id],
      );
      const r = res.rows[0];
      if (!r) return null;
      return {
        id: r.id,
        userId: r.user_id,
        appId: r.app_id,
        workspaceId: r.workspace_id,
        workspaceName: r.workspace_name,
        actorId: r.actor_id,
        botId: r.bot_id,
        identityVersion: r.identity_version,
        status: r.status,
        authFailureCode: r.auth_failure_code ?? null,
        refreshInFlight: Boolean(r.refresh_in_flight),
        isDefault: Boolean(r.is_default),
        allowedDatabases: r.allowed_databases ?? [],
        configPresent: typeof r.config === 'string' && r.config.length > 0,
        configFingerprint: fingerprintSecret(r.config),
        xmin: String(r.tuple_xmin),
      };
    },
    async close() {
      await pool.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    },
  };
}

export async function inspectOwnerAdvisoryLocks(
  pool: Pick<pg.Pool, 'query'>,
  userId: string,
): Promise<{ grantedCount: number; waitingCount: number }> {
  const res = await pool.query<{ granted: boolean; cnt: number }>(
    `SELECT granted, count(*)::int AS cnt
       FROM pg_locks
      WHERE locktype = 'advisory'
        AND classid = hashtext('ati-notion-owner')
        AND objid = hashtext($1)
      GROUP BY granted`,
    [userId],
  );
  let grantedCount = 0;
  let waitingCount = 0;
  for (const row of res.rows) {
    if (row.granted) grantedCount += row.cnt;
    else waitingCount += row.cnt;
  }
  return { grantedCount, waitingCount };
}

export async function waitForOwnerLockWaiter(
  pool: Pick<pg.Pool, 'query'>,
  userId: string,
  timeoutMs = 3000,
): Promise<{ grantedCount: number; waitingCount: number }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snap = await inspectOwnerAdvisoryLocks(pool, userId);
    if (snap.grantedCount >= 1 && snap.waitingCount >= 1) {
      return snap;
    }
    await new Promise((r) => setTimeout(r, 15));
  }
  return inspectOwnerAdvisoryLocks(pool, userId);
}

export interface RecordedProviderCall {
  seq: number;
  method: string;
  path: string;
  authScheme: 'Bearer' | 'Basic' | 'none';
  bearerFingerprint: string | null;
  grantType: string | null;
  refreshTokenFingerprint: string | null;
}

export type LoopbackRouteAction =
  | {
      kind: 'json';
      status?: number;
      body: unknown;
      onRequest?: (call: RecordedProviderCall) => Promise<void> | void;
    }
  | {
      kind: 'raw';
      status?: number;
      rawBody: string;
      contentType?: string;
      onRequest?: (call: RecordedProviderCall) => Promise<void> | void;
    }
  | {
      kind: 'destroy_socket';
      onRequest?: (call: RecordedProviderCall) => Promise<void> | void;
    }
  | {
      kind: 'hang';
      holdMs: number;
      onRequest?: (call: RecordedProviderCall) => Promise<void> | void;
    };

export async function startNotionLoopbackServer() {
  assertAssignedNotionTestDatabaseUrl();
  const ledger: RecordedProviderCall[] = [];
  const queues = new Map<string, LoopbackRouteAction[]>();
  const fallbacks = new Map<string, (call: RecordedProviderCall, body: any) => Promise<LoopbackRouteAction> | LoopbackRouteAction>();
  const openSockets = new Set<net.Socket>();
  const pendingTimers = new Set<NodeJS.Timeout>();
  let seq = 0;

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
      const rawText = Buffer.concat(chunks).toString('utf8');
      let parsedBody: any = null;
      try {
        parsedBody = rawText ? JSON.parse(rawText) : null;
      } catch {
        parsedBody = null;
      }
      const authHeader = String(req.headers.authorization ?? '');
      let authScheme: 'Bearer' | 'Basic' | 'none' = 'none';
      let bearerFingerprint: string | null = null;
      if (authHeader.startsWith('Bearer ')) {
        authScheme = 'Bearer';
        bearerFingerprint = fingerprintSecret(authHeader.slice('Bearer '.length).trim());
      } else if (authHeader.startsWith('Basic ')) {
        authScheme = 'Basic';
      }

      const urlObj = new URL(req.url ?? '/', 'http://127.0.0.1');
      const key = `${req.method ?? 'GET'} ${urlObj.pathname}`;
      const call: RecordedProviderCall = {
        seq: ++seq,
        method: req.method ?? 'GET',
        path: urlObj.pathname,
        authScheme,
        bearerFingerprint,
        grantType: typeof parsedBody?.grant_type === 'string' ? parsedBody.grant_type : null,
        refreshTokenFingerprint:
          typeof parsedBody?.refresh_token === 'string'
            ? fingerprintSecret(parsedBody.refresh_token)
            : null,
      };
      ledger.push(call);

      const q = queues.get(key);
      let action: LoopbackRouteAction | undefined = q && q.length > 0 ? q.shift() : undefined;
      if (!action) {
        const fb = fallbacks.get(key);
        if (fb) action = await fb(call, parsedBody);
      }
      if (!action) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ object: 'error', status: 404, code: 'object_not_found' }));
        return;
      }

      if (action.onRequest) {
        await action.onRequest(call);
      }

      if (action.kind === 'destroy_socket') {
        req.socket.destroy();
        return;
      }
      if (action.kind === 'hang') {
        const t = setTimeout(() => {
          pendingTimers.delete(t);
          if (!res.writableEnded) {
            res.writeHead(504, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ object: 'error', status: 504, code: 'service_unavailable' }));
          }
        }, action.holdMs);
        pendingTimers.add(t);
        req.once('close', () => {
          clearTimeout(t);
          pendingTimers.delete(t);
        });
        return;
      }
      if (action.kind === 'raw') {
        res.writeHead(action.status ?? 200, {
          'Content-Type': action.contentType ?? 'text/plain; charset=utf-8',
        });
        res.end(action.rawBody);
        return;
      }
      res.writeHead(action.status ?? 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(action.body));
    });
  });

  server.on('connection', (sock) => {
    openSockets.add(sock);
    sock.once('close', () => openSockets.delete(sock));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address();
  if (!addr || typeof addr !== 'object') {
    throw new Error('Failed to bind Notion loopback server');
  }
  const baseUrl = `http://127.0.0.1:${addr.port}/v1`;

  return {
    port: addr.port,
    baseUrl,
    oauthConfig(clientId = 'notion-app-1') {
      return {
        clientId,
        clientSecret: 'synthetic-client-secret-only',
        redirectUri: `http://127.0.0.1:${addr.port}/connections/notion/callback`,
        authorizationUrl: `${baseUrl}/oauth/authorize`,
        apiBaseUrl: baseUrl,
      };
    },
    ledger,
    countPath(pathSuffix: string): number {
      return ledger.filter((c) => c.path.endsWith(pathSuffix)).length;
    },
    resetLedger() {
      ledger.length = 0;
    },
    enqueue(method: string, pathAfterV1: string, ...actions: LoopbackRouteAction[]) {
      const key = `${method.toUpperCase()} /v1${pathAfterV1}`;
      const existing = queues.get(key) ?? [];
      existing.push(...actions);
      queues.set(key, existing);
    },
    setDefault(
      method: string,
      pathAfterV1: string,
      handler: (call: RecordedProviderCall, body: any) => Promise<LoopbackRouteAction> | LoopbackRouteAction,
    ) {
      fallbacks.set(`${method.toUpperCase()} /v1${pathAfterV1}`, handler);
    },
    clearRoutes() {
      queues.clear();
      fallbacks.clear();
      ledger.length = 0;
    },
    async close() {
      for (const t of pendingTimers) clearTimeout(t);
      pendingTimers.clear();
      for (const s of openSockets) s.destroy();
      openSockets.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function buildIsolatedChildEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const allowlist = [
    'PATH',
    'Path',
    'SystemRoot',
    'SYSTEMROOT',
    'WINDIR',
    'windir',
    'COMSPEC',
    'ComSpec',
    'PATHEXT',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'HOMEDRIVE',
    'HOMEPATH',
    'APPDATA',
    'LOCALAPPDATA',
    'OS',
    'PROCESSOR_ARCHITECTURE',
    'NUMBER_OF_PROCESSORS',
    'NODE_OPTIONS',
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const k of allowlist) {
    if (process.env[k] !== undefined) env[k] = process.env[k];
  }
  const { connectionString } = assertAssignedNotionTestDatabaseUrl();
  env.NODE_ENV = 'test';
  env.DATABASE_URL = connectionString;
  env.NO_COLOR = '1';
  for (const [k, v] of Object.entries(extra)) {
    env[k] = v;
  }
  return env;
}
