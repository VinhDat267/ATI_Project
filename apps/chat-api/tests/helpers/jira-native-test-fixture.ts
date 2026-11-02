import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket, AddressInfo } from 'node:net';

export interface JiraProjectFixtureData {
  id: string;
  key: string;
  name: string;
  projectTypeKey?: string;
  simplified?: boolean;
  style?: string;
  isPrivate?: boolean;
}

export interface UserPermissionSet {
  canBrowse: boolean;
  canCreateIssue: boolean;
  canAddComment: boolean;
}

export interface JiraNativeSiteConfig {
  cloudId: string;
  siteName: string;
  siteUrl: string;
  administer?: boolean;
  projects?: JiraProjectFixtureData[];
  userPermissions?: Record<string, UserPermissionSet>; // Key: projectId or 'global'
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

export interface RecordedNativeRequest {
  method: string;
  path: string;
  url: string;
  query: Record<string, string>;
  headers: Record<string, string | string[] | undefined>;
  body: any;
  rawBody: string;
}

export interface PauseBarrier {
  reached: Promise<void>;
  release: () => void;
}

interface InternalPauseEntry {
  reachedPromise: Promise<void>;
  resolveReached: () => void;
  releasePromise: Promise<void>;
  resolveRelease: () => void;
}

export interface JiraNativeTestFixture {
  readonly baseUrl: string;
  readonly port: number;
  readonly requests: RecordedNativeRequest[];
  registerSite(site: JiraNativeSiteConfig): void;
  setAdministerPermission(cloudId: string, havePermission: boolean): void;
  setUserPermissions(cloudId: string, projectId: string | 'global', perms: UserPermissionSet): void;
  setProjects(cloudId: string, projects: JiraProjectFixtureData[]): void;
  setOverride(path: string, override: FixtureOverride): void;
  clearOverrides(): void;
  pauseNext(path: string): PauseBarrier;
  reset(): void;
  close(): Promise<void>;
}

export async function createJiraNativeTestFixture(): Promise<JiraNativeTestFixture> {
  const recordedRequests: RecordedNativeRequest[] = [];
  const sites = new Map<string, JiraNativeSiteConfig>();
  const overrides = new Map<string, FixtureOverride>();
  const pauseMap = new Map<string, InternalPauseEntry[]>();
  const activeSockets = new Set<Socket>();

  // Default site setup for convenience
  const defaultSite: JiraNativeSiteConfig = {
    cloudId: 'default-cloud-id',
    siteName: 'Default Jira Site',
    siteUrl: 'https://default-site.atlassian.net',
    administer: true,
    projects: [
      { id: '10001', key: 'PROJ', name: 'Project Alpha', projectTypeKey: 'software' },
      { id: '10002', key: 'BETA', name: 'Project Beta', projectTypeKey: 'business' },
    ],
    userPermissions: {
      '10001': { canBrowse: true, canCreateIssue: true, canAddComment: true },
      '10002': { canBrowse: true, canCreateIssue: true, canAddComment: false },
      global: { canBrowse: true, canCreateIssue: true, canAddComment: true },
    },
  };
  sites.set(defaultSite.cloudId, defaultSite);

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
      const parsedUrl = new URL(reqUrl, 'http://127.0.0.1');
      const pathname = parsedUrl.pathname;
      const query = Object.fromEntries(parsedUrl.searchParams.entries());

      // 3. Extract cloudId if prefixed with /ex/jira/:cloudId
      const exJiraMatch = /^\/ex\/jira\/([^/]+)(\/.*)$/.exec(pathname);
      const cloudIdFromPath = exJiraMatch ? exJiraMatch[1] : undefined;
      const apiPath = exJiraMatch?.[2] ?? pathname;

      // 4. Record request
      recordedRequests.push({
        method,
        path: pathname,
        url: reqUrl,
        query,
        headers: req.headers,
        body: parsedBody,
        rawBody,
      });

      // 5. Pause barrier check (matches pathname or normalized apiPath)
      const pauseKey = pauseMap.has(pathname) ? pathname : pauseMap.has(apiPath) ? apiPath : undefined;
      if (pauseKey) {
        const pauses = pauseMap.get(pauseKey);
        if (pauses && pauses.length > 0) {
          const pauseEntry = pauses.shift();
          if (pauseEntry) {
            pauseEntry.resolveReached();
            await pauseEntry.releasePromise;
          }
        }
      }

      // 6. Check overrides (exact pathname or normalized apiPath)
      const override = overrides.get(pathname) ?? overrides.get(apiPath);
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

      // 7. Verify Authorization header (Bearer token is required by Atlassian REST APIs)
      const authHeader = req.headers['authorization'];
      const tokenMatch = /^Bearer\s+(.+)$/i.exec(typeof authHeader === 'string' ? authHeader : '');
      const bearerToken = tokenMatch?.[1]?.trim();
      if (!bearerToken) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            code: 401,
            errorMessages: ['Unauthorized: Missing or invalid Bearer token in Authorization header'],
          })
        );
        return;
      }

      // 8. Resolve active site
      const targetCloudId = cloudIdFromPath ?? query.cloudId;
      let site: JiraNativeSiteConfig | undefined;
      if (targetCloudId && sites.has(targetCloudId)) {
        site = sites.get(targetCloudId);
      } else if (sites.size === 1) {
        site = sites.values().next().value;
      } else if (targetCloudId) {
        site = undefined;
      } else {
        site = sites.get(defaultSite.cloudId);
      }

      // 9. Standard Jira REST API Handlers
      if (apiPath === '/rest/api/3/mypermissions' && method === 'GET') {
        if (!site) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ errorMessages: [`Site not found for cloudId: ${targetCloudId}`] }));
          return;
        }

        const requestedPerms = (query.permissions ?? '')
          .split(',')
          .map((p) => p.trim().toUpperCase())
          .filter(Boolean);

        const permissionsObj: Record<string, any> = {};

        // ADMINISTER permission
        if (requestedPerms.length === 0 || requestedPerms.includes('ADMINISTER')) {
          permissionsObj['ADMINISTER'] = {
            id: '0',
            key: 'ADMINISTER',
            name: 'Administer Jira',
            type: 'GLOBAL',
            description: 'Ability to perform most administration tasks (including project creation).',
            havePermission: site.administer ?? true,
          };
        }

        // User permissions (BROWSE_PROJECTS, CREATE_ISSUES, ADD_COMMENTS)
        const projectId = query.projectId;
        const projectKey = query.projectKey;
        const lookupKey = projectId ?? projectKey ?? 'global';

        const userPerms =
          site.userPermissions?.[lookupKey] ??
          site.userPermissions?.['global'] ?? {
            canBrowse: true,
            canCreateIssue: true,
            canAddComment: true,
          };

        if (requestedPerms.length === 0 || requestedPerms.includes('BROWSE_PROJECTS')) {
          permissionsObj['BROWSE_PROJECTS'] = {
            id: '10',
            key: 'BROWSE_PROJECTS',
            name: 'Browse Projects',
            type: 'PROJECT',
            description: 'Ability to browse projects and the issues within them.',
            havePermission: userPerms.canBrowse,
          };
        }

        if (requestedPerms.length === 0 || requestedPerms.includes('CREATE_ISSUES')) {
          permissionsObj['CREATE_ISSUES'] = {
            id: '11',
            key: 'CREATE_ISSUES',
            name: 'Create Issues',
            type: 'PROJECT',
            description: 'Ability to create issues in projects.',
            havePermission: userPerms.canCreateIssue,
          };
        }

        if (requestedPerms.length === 0 || requestedPerms.includes('ADD_COMMENTS')) {
          permissionsObj['ADD_COMMENTS'] = {
            id: '15',
            key: 'ADD_COMMENTS',
            name: 'Add Comments',
            type: 'PROJECT',
            description: 'Ability to add comments to issues.',
            havePermission: userPerms.canAddComment,
          };
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ permissions: permissionsObj }));
        return;
      }

      if (apiPath === '/rest/api/3/project/search' && method === 'GET') {
        if (!site) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ errorMessages: [`Site not found for cloudId: ${targetCloudId}`] }));
          return;
        }

        const projectList = site.projects ?? [];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            self: `http://127.0.0.1:${port}${pathname}`,
            maxResults: 50,
            startAt: 0,
            total: projectList.length,
            isLast: true,
            values: projectList,
          })
        );
        return;
      }

      if (apiPath === '/oauth/token/accessible-resources' && method === 'GET') {
        const accessible = Array.from(sites.values()).map((s) => ({
          id: s.cloudId,
          name: s.siteName,
          url: s.siteUrl,
          scopes: ['read:jira-work', 'write:jira-work'],
        }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(accessible));
        return;
      }

      // Default fallback
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'fixture_internal_error', message: String(err) }));
      }
    }
  });

  server.on('connection', (socket: Socket) => {
    activeSockets.add(socket);
    socket.on('close', () => {
      activeSockets.delete(socket);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.once('error', reject);
  });

  const address = server.address() as AddressInfo;
  const port = address.port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const fixture: JiraNativeTestFixture = {
    get baseUrl() {
      return baseUrl;
    },
    get port() {
      return port;
    },
    get requests() {
      return recordedRequests;
    },
    registerSite(site: JiraNativeSiteConfig) {
      sites.set(site.cloudId, {
        ...site,
        projects: site.projects ? [...site.projects] : [],
        userPermissions: site.userPermissions ? { ...site.userPermissions } : {},
      });
    },
    setAdministerPermission(cloudId: string, havePermission: boolean) {
      const site = sites.get(cloudId);
      if (site) {
        site.administer = havePermission;
      }
    },
    setUserPermissions(cloudId: string, projectId: string | 'global', perms: UserPermissionSet) {
      const site = sites.get(cloudId);
      if (site) {
        site.userPermissions = site.userPermissions ?? {};
        site.userPermissions[projectId] = { ...perms };
      }
    },
    setProjects(cloudId: string, projects: JiraProjectFixtureData[]) {
      const site = sites.get(cloudId);
      if (site) {
        site.projects = [...projects];
      }
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
      overrides.clear();
      pauseMap.clear();
      sites.clear();
      sites.set(defaultSite.cloudId, {
        ...defaultSite,
        projects: [...(defaultSite.projects ?? [])],
        userPermissions: { ...(defaultSite.userPermissions ?? {}) },
      });
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
