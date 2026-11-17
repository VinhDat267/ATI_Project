import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, expect, describe, it } from 'vitest';
import {
  PersonalJiraAdapter,
  createPersonalJiraAdapter,
  plainTextToAdf,
  GlobalRateLimiter,
  StepError,
} from '../src/index.js';

const cloudId = '12345678-1234-1234-1234-123456789abc';
const cloudId2 = '87654321-4321-4321-4321-cba987654321';

const capability = {
  workspaceId: 'ws-1',
  sites: [
    {
      siteId: 'opaque_1',
      cloudId,
      name: 'Company Atlassian',
      url: 'https://company.atlassian.net',
      projects: [
        { id: '10000', key: 'ATI', name: 'ATI Project' },
        { id: '10001', key: 'CORE', name: 'Core Engine' },
      ],
    },
    {
      siteId: 'opaque_2',
      cloudId: cloudId2,
      name: 'Second Site',
      url: 'https://second.atlassian.net',
      projects: [{ id: '20000', key: 'SEC', name: 'Security' }],
    },
  ],
};

type RequestSeen = {
  method: string;
  url: string;
  auth: string | undefined;
  body: any;
  headers: Record<string, string | string[] | undefined>;
};

let server: Server;
let base: string;
let seen: RequestSeen[];
let reply: (request: RequestSeen) => {
  status?: number;
  headers?: Record<string, string>;
  body?: any;
  rawBody?: string;
  dropConnection?: boolean;
  hang?: boolean;
};

const project = { id: '10000', key: 'ATI', name: 'ATI Project' };
const issue = {
  id: '10042',
  key: 'ATI-42',
  fields: { summary: 'Login bug', status: { name: 'Open' }, project },
};

beforeEach(async () => {
  seen = [];
  reply = ({ url }) => {
    if (url.includes('createmeta')) {
      return {
        body: {
          startAt: 0,
          total: 3,
          issueTypes: [
            { id: '1', name: 'Sub-task', subtask: true },
            { id: '2', name: 'Task', subtask: false },
            { id: '3', name: 'Bug', subtask: false },
          ],
        },
      };
    }
    if (url.endsWith('/search/jql')) return { body: { issues: [issue] } };
    if (url.endsWith('/issue')) return { status: 201, body: { id: '10042', key: 'ATI-42' } };
    if (url.endsWith('/comment')) return { status: 201, body: { id: '900' } };
    if (url.includes('/issue/')) return { body: issue };
    if (url.endsWith('/myself')) return { body: { accountId: 'acc-123' } };
    return { status: 404, body: {} };
  };

  server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const request: RequestSeen = {
      method: req.method!,
      url: req.url!,
      auth: req.headers.authorization,
      headers: req.headers,
      body: raw ? JSON.parse(raw) : undefined,
    };
    seen.push(request);
    const result = reply(request);

    if (result.dropConnection) {
      req.socket.destroy();
      return;
    }

    if (result.hang) {
      return;
    }

    res.writeHead(result.status ?? 200, {
      'content-type': 'application/json',
      ...result.headers,
    });
    res.end(result.rawBody ?? JSON.stringify(result.body ?? {}));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});

afterEach(async () => {
  if (typeof (server as any).closeAllConnections === 'function') {
    (server as any).closeAllConnections();
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const make = (extra: Record<string, any> = {}) =>
  new PersonalJiraAdapter({
    userId: 'user-1',
    workspaceId: 'ws-1',
    capabilities: capability,
    tokens: { getAccessToken: async () => 'fixture-access-token' },
    apiBaseUrl: base,
    rateLimiter: new GlobalRateLimiter({ maxRequests: 1000, windowMs: 1 }),
    ...extra,
  });

const prefix = `/ex/jira/${cloudId}/rest/api/3`;

describe('PersonalJiraAdapter', () => {
  describe('Capability directory reads and scope validation', () => {
    it('lists only scoped sites and projects without trusting caller URLs', async () => {
      const adapter = make();
      expect(await adapter.execute('myjira.list_sites', { query: 'comp' })).toEqual([
        {
          id: 'opaque_1',
          siteId: 'opaque_1',
          cloudId,
          name: 'Company Atlassian',
          url: 'https://company.atlassian.net',
        },
      ]);
      expect(await adapter.execute('myjira.search_projects', { siteId: 'opaque_1', query: 'ati' })).toEqual([
        { siteId: 'opaque_1', ...project },
      ]);
      expect(seen).toEqual([]);
    });

    it('filters sites and projects by query case-insensitively and respects limits', async () => {
      const adapter = make();
      const allSites = await adapter.execute('myjira.list_sites', { query: '', limit: 1 });
      expect(allSites).toHaveLength(1);
      expect(allSites[0].siteId).toBe('opaque_1');

      const matchingSites = await adapter.execute('myjira.list_sites', { query: 'SECOND' });
      expect(matchingSites).toHaveLength(1);
      expect(matchingSites[0].siteId).toBe('opaque_2');

      const allProjects = await adapter.execute('myjira.search_projects', { siteId: 'opaque_1', query: '' });
      expect(allProjects).toHaveLength(2);
      expect(allProjects.map((p: any) => p.key)).toEqual(['ATI', 'CORE']);

      const limitedProjects = await adapter.execute('myjira.search_projects', {
        siteId: 'opaque_1',
        query: '',
        limit: 1,
      });
      expect(limitedProjects).toHaveLength(1);
      expect(limitedProjects[0].key).toBe('ATI');
    });

    it('enforces allowedScope.sites and allowedScope.projects whitelisting when configured', async () => {
      const adapter = make({
        allowedScope: {
          sites: ['opaque_1'],
          projects: ['CORE'],
        },
      });

      const sites = await adapter.execute('myjira.list_sites', { query: '' });
      expect(sites.map((s: any) => s.siteId)).toEqual(['opaque_1']);

      const projects = await adapter.execute('myjira.search_projects', { siteId: 'opaque_1', query: '' });
      expect(projects.map((p: any) => p.key)).toEqual(['CORE']);

      await expect(
        adapter.execute('myjira.search_projects', { siteId: 'opaque_2', query: '' })
      ).rejects.toMatchObject({ category: 'AUTH_ERROR', statusCode: 403 });

      await expect(
        adapter.execute('myjira.search_issues', { siteId: 'opaque_1', projectKey: 'ATI' })
      ).rejects.toMatchObject({ category: 'AUTH_ERROR', statusCode: 403 });
    });

    it('rejects forged site and project before transport', async () => {
      const adapter = make();
      await expect(
        adapter.execute('myjira.search_issues', { siteId: 'evil', projectKey: 'ATI' })
      ).rejects.toMatchObject({ category: 'AUTH_ERROR' });
      await expect(
        adapter.execute('myjira.create_issue', { siteId: 'opaque_1', projectKey: 'OTHER', summary: 'x' })
      ).rejects.toMatchObject({ category: 'AUTH_ERROR' });
      await expect(
        adapter.execute('myjira.add_comment', { siteId: 'opaque_1', issueKey: 'OTHER-1', body: 'x' })
      ).rejects.toMatchObject({ category: 'AUTH_ERROR' });
      expect(seen).toEqual([]);
    });

    it('validates adapter construction and capability snapshot integrity', () => {
      expect(() => new PersonalJiraAdapter(null as any)).toThrowError(StepError);
      expect(() => make({ userId: '' })).toThrowError(StepError);
      expect(() => make({ workspaceId: '' })).toThrowError(StepError);
      expect(() => make({ capabilities: null })).toThrowError(StepError);
      expect(() => make({ capabilities: { workspaceId: 'wrong-ws', sites: [] } })).toThrowError(StepError);
      expect(() => make({ tokens: null })).toThrowError(StepError);
      expect(() => make({ tokens: {} })).toThrowError(StepError);

      const created = createPersonalJiraAdapter({
        userId: 'user-1',
        workspaceId: 'ws-1',
        capabilities: capability,
        tokens: { getAccessToken: async () => 'test' },
      });
      expect(created).toBeInstanceOf(PersonalJiraAdapter);
      expect(created.service).toBe('myjira');
    });
  });

  describe('myjira.search_issues', () => {
    it('searches with fixed project JQL and Bearer cloud gateway; rejects cross-project rows', async () => {
      const adapter = make();
      expect(
        await adapter.execute('myjira.search_issues', {
          siteId: 'opaque_1',
          projectKey: 'ATI',
          query: 'x" OR project = OTHER',
          limit: 5,
        })
      ).toMatchObject({
        issues: [
          {
            siteId: 'opaque_1',
            id: '10042',
            key: 'ATI-42',
            title: 'Login bug',
            status: 'Open',
            url: 'https://company.atlassian.net/browse/ATI-42',
          },
        ],
        coverage: {
          itemsReturned: 1,
          pagesFetched: 1,
        },
      });
      expect(seen[0]).toMatchObject({
        method: 'POST',
        url: `${prefix}/search/jql`,
        auth: 'Bearer fixture-access-token',
      });
      expect(seen[0]!.body.jql).toMatch(/^project = "ATI" AND text ~ "/);
      expect(seen[0]!.body.jql).not.toContain('~ "x" OR');

      reply = () => ({
        body: {
          issues: [
            {
              ...issue,
              fields: { ...issue.fields, project: { ...project, key: 'OTHER' } },
            },
          ],
        },
      });
      await expect(
        adapter.execute('myjira.search_issues', { siteId: 'opaque_1', projectKey: 'ATI' })
      ).rejects.toMatchObject({ category: 'SERVER_ERROR' });
    });

    it('escapes Lucene characters and backslashes in issue search to prevent JQL injection', async () => {
      const adapter = make();
      await adapter.execute('myjira.search_issues', {
        siteId: 'opaque_1',
        projectKey: 'ATI',
        query: 'test [lucene] +special-char: (tag) \\back',
      });
      expect(seen[0]!.body.jql).toBe(
        'project = "ATI" AND text ~ "test \\\\[lucene\\\\] \\\\+special\\\\-char\\\\: \\\\(tag\\\\) \\\\\\\\back" ORDER BY updated DESC'
      );

      seen = [];
      await adapter.execute('myjira.search_issues', {
        siteId: 'opaque_1',
        projectKey: 'ATI',
        query: '   ',
      });
      expect(seen[0]!.body.jql).toBe('project = "ATI" ORDER BY updated DESC');
    });

    it('performs direct issue key lookup when query matches project key pattern and ignores missing direct hit', async () => {
      const adapter = make();
      const res = await adapter.execute('myjira.search_issues', {
        siteId: 'opaque_1',
        projectKey: 'ATI',
        query: 'ATI-42',
      });
      expect(res.issues).toHaveLength(1);
      expect(res.issues[0].key).toBe('ATI-42');
      expect(seen.some((s) => s.url.includes('/issue/ATI-42'))).toBe(true);
      expect(seen.some((s) => s.url.endsWith('/search/jql'))).toBe(true);

      seen = [];
      reply = ({ url }) => {
        if (url.includes('/issue/ATI-999')) return { status: 404, body: {} };
        if (url.endsWith('/search/jql')) return { body: { issues: [issue] } };
        return { status: 404, body: {} };
      };
      const res404 = await adapter.execute('myjira.search_issues', {
        siteId: 'opaque_1',
        projectKey: 'ATI',
        query: 'ATI-999',
      });
      expect(res404.issues).toHaveLength(1);
      expect(res404.issues[0].key).toBe('ATI-42');
    });
  });

  describe('myjira.create_issue & myjira.add_comment', () => {
    it('executes myjira.create_issue with ADF description and validates standard issueType', async () => {
      reply = ({ url }) => {
        if (url.includes('/issue/createmeta/ATI/issuetypes')) {
          return {
            body: {
              startAt: 0,
              total: 2,
              issueTypes: [
                { id: '1', name: 'Task', subtask: false },
                { id: '2', name: 'Bug', subtask: false },
              ],
            },
          };
        }
        if (url.endsWith('/issue')) {
          return { body: { id: '10042', key: 'ATI-42' } };
        }
        return { status: 404, body: {} };
      };
      const created = await make().execute('myjira.create_issue', {
        siteId: 'opaque_1',
        projectKey: 'ATI',
        summary: 'A bug report',
        description: '<b>plain</b>\nnext',
        issueType: 'Bug',
      });
      expect(created).toEqual({
        siteId: 'opaque_1',
        id: '10042',
        key: 'ATI-42',
        url: 'https://company.atlassian.net/browse/ATI-42',
      });
      const post = seen.find((s) => s.url.endsWith('/issue'));
      expect(post?.body.fields.issuetype).toEqual({ id: '2' });
      expect(post?.body.fields.description.type).toBe('doc');
    });

    it('executes myjira.add_comment after checking current project matches allowlist', async () => {
      reply = ({ url }) => {
        if (url.endsWith('/issue/ATI-42?fields=project')) {
          return { body: { id: '10042', key: 'ATI-42', fields: { project } } };
        }
        if (url.endsWith('/issue/ATI-42/comment')) {
          return { body: { id: '777' } };
        }
        return { status: 404, body: {} };
      };
      const comment = await make().execute('myjira.add_comment', {
        siteId: 'opaque_1',
        issueKey: 'ATI-42',
        body: 'hello',
      });
      expect(comment).toEqual({
        siteId: 'opaque_1',
        id: '777',
        issueKey: 'ATI-42',
        url: 'https://company.atlassian.net/browse/ATI-42?focusedCommentId=777',
      });
    });

    it('throws UNKNOWN when myjira.create_issue returns malformed id without auto-retry', async () => {
      let posts = 0;
      reply = ({ url }) => {
        if (url.includes('/issue/createmeta/ATI/issuetypes')) {
          return {
            body: {
              startAt: 0,
              total: 1,
              issueTypes: [{ id: '1', name: 'Task', subtask: false }],
            },
          };
        }
        if (url.endsWith('/issue')) {
          posts++;
          return { body: { broken: true } };
        }
        return { status: 404, body: {} };
      };
      await expect(
        make().execute('myjira.create_issue', { siteId: 'opaque_1', projectKey: 'ATI', summary: 'Ambiguous write' })
      ).rejects.toMatchObject({ category: 'UNKNOWN', retryable: false });
      expect(posts).toBe(1);
    });

    it('plainTextToAdf formats multiline text with empty paragraphs for blank lines', () => {
      const adf = plainTextToAdf('Line 1\r\n\nLine 3');
      expect(adf).toEqual({
        version: 1,
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Line 1' }] },
          { type: 'paragraph', content: [] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Line 3' }] },
        ],
      });
    });
  });

  describe('Read retries and error mapping', () => {

    it('retries read once on HTTP 500 and twice on network error before failing', async () => {
      let attempts500 = 0;
      reply = ({ url }) => {
        if (url.endsWith('/search/jql')) {
          attempts500++;
          return attempts500 === 1 ? { status: 500, body: {} } : { body: { issues: [issue] } };
        }
        return { status: 404, body: {} };
      };
      const res = await make().execute('myjira.search_issues', { siteId: 'opaque_1', projectKey: 'ATI' });
      expect(res.issues).toHaveLength(1);
      expect(attempts500).toBe(2);

      let drops = 0;
      reply = ({ url }) => {
        if (url.endsWith('/search/jql')) {
          drops++;
          return drops <= 2 ? { dropConnection: true } : { body: { issues: [issue] } };
        }
        return { status: 404, body: {} };
      };
      const resDrop = await make().execute('myjira.search_issues', { siteId: 'opaque_1', projectKey: 'ATI' });
      expect(resDrop.issues).toHaveLength(1);
      expect(drops).toBe(3);
    });
  });

  describe('Tokens, Auth, 401 refresh, 403, redirects and rate limits', () => {
    it('bounds rate limit and honors pre-aborted signal without HTTP', async () => {
      reply = () => ({ status: 429, headers: { 'retry-after': '3600' }, body: {} });
      await expect(
        make().execute('myjira.search_issues', { siteId: 'opaque_1', projectKey: 'ATI' })
      ).rejects.toMatchObject({ category: 'RATE_LIMIT', retryable: true });

      const abort = new AbortController();
      abort.abort();
      seen = [];
      await expect(
        make().execute(
          'myjira.search_issues',
          { siteId: 'opaque_1', projectKey: 'ATI' },
          { signal: abort.signal }
        )
      ).rejects.toMatchObject({ category: 'NETWORK' });
      expect(seen).toEqual([]);
    });

    it('retries 429 once when Retry-After is within wait budget', async () => {
      let callCount = 0;
      reply = ({ url }) => {
        if (url.endsWith('/search/jql')) {
          callCount++;
          return callCount === 1
            ? { status: 429, headers: { 'retry-after': '0.05' }, body: {} }
            : { body: { issues: [issue] } };
        }
        return { status: 404, body: {} };
      };
      const res = await make().execute('myjira.search_issues', { siteId: 'opaque_1', projectKey: 'ATI' });
      expect(res.issues).toHaveLength(1);
      expect(callCount).toBe(2);
    });

    it('enforces transport own deadline when caller does not pass AbortSignal (read tool times out as NETWORK)', async () => {
      reply = () => ({ hang: true });
      const adapter = make({ timeoutMs: 50 });
      await expect(
        adapter.execute('myjira.search_issues', { siteId: 'opaque_1', projectKey: 'ATI' })
      ).rejects.toMatchObject({
        category: 'NETWORK',
      });
    });

    it('enforces transport own deadline when caller passes non-expiring AbortSignal (read tool times out as NETWORK)', async () => {
      reply = () => ({ hang: true });
      const adapter = make({ timeoutMs: 50 });
      const controller = new AbortController();
      await expect(
        adapter.execute('myjira.search_issues', { siteId: 'opaque_1', projectKey: 'ATI' }, { signal: controller.signal })
      ).rejects.toMatchObject({
        category: 'NETWORK',
      });
    });

    it('refreshes token on 401 with forceRefresh: true and retries; fails if second attempt also 401', async () => {
      let tokenCalls: Array<{ forceRefresh?: boolean }> = [];
      let token = 'initial-token';
      const tokenProvider = {
        getAccessToken: async (opts?: any) => {
          tokenCalls.push(opts ?? {});
          if (opts?.forceRefresh) token = 'refreshed-token';
          return token;
        },
      };

      let attempt = 0;
      reply = ({ url }) => {
        if (url.endsWith('/search/jql')) {
          attempt++;
          return attempt === 1 ? { status: 401, body: {} } : { body: { issues: [issue] } };
        }
        return { status: 404, body: {} };
      };

      const adapter = make({ tokens: tokenProvider });
      const res = await adapter.execute('myjira.search_issues', { siteId: 'opaque_1', projectKey: 'ATI' });
      expect(res.issues).toHaveLength(1);
      expect(tokenCalls).toMatchObject([
        { forceRefresh: false },
        { forceRefresh: true },
      ]);
      expect(tokenCalls[0].signal).toBeInstanceOf(AbortSignal);
      expect(tokenCalls[1].signal).toBeInstanceOf(AbortSignal);
      expect(seen[0]!.auth).toBe('Bearer initial-token');
      expect(seen[1]!.auth).toBe('Bearer refreshed-token');

      attempt = 0;
      reply = () => ({ status: 401, body: {} });
      await expect(
        adapter.execute('myjira.search_issues', { siteId: 'opaque_1', projectKey: 'ATI' })
      ).rejects.toMatchObject({ category: 'AUTH_ERROR', statusCode: 401 });
    });

    it('supports two-argument getAccessToken provider matching JIRA-04 token manager', async () => {
      const calls: any[] = [];
      const tokenManager = {
        async getAccessToken(userId: string, opts?: any) {
          calls.push({ userId, opts });
          return 'manager-token';
        },
      };

      const adapter = make({ tokens: tokenManager });
      await adapter.execute('myjira.search_issues', { siteId: 'opaque_1', projectKey: 'ATI' });
      expect(calls[0]).toMatchObject({ userId: 'user-1' });
      expect(seen[0]!.auth).toBe('Bearer manager-token');
    });

    it('maps 403 Forbidden to AUTH_ERROR without retry', async () => {
      reply = () => ({ status: 403, body: { errorMessages: ['Forbidden'] } });
      await expect(
        make().execute('myjira.search_issues', { siteId: 'opaque_1', projectKey: 'ATI' })
      ).rejects.toMatchObject({ category: 'AUTH_ERROR', statusCode: 403 });
      expect(seen).toHaveLength(1);
    });

    it('blocks HTTP redirects with redirect: error to prevent token leakage', async () => {
      reply = () => ({
        status: 302,
        headers: { location: 'http://127.0.0.1:9999/attacker' },
        body: {},
      });
      await expect(
        make().execute('myjira.search_issues', { siteId: 'opaque_1', projectKey: 'ATI' })
      ).rejects.toMatchObject({ category: 'NETWORK' });
    });

    it('verifies connection with checkConnection via /myself', async () => {
      const adapter = make();
      expect(await adapter.checkConnection()).toBe(true);
      expect(seen[0]!.url).toBe(`${prefix}/myself`);

      reply = () => ({ status: 401, body: {} });
      await expect(adapter.checkConnection()).rejects.toMatchObject({
        category: 'AUTH_ERROR',
        statusCode: 401,
      });

      const emptyAdapter = make({ capabilities: { workspaceId: 'ws-1', sites: [] } });
      expect(await emptyAdapter.checkConnection()).toBe(true);
    });
  });

  describe('Input validation and scope enforcement across all 9 Jira tools', () => {
    it.each([
      ['myjira.list_sites', { query: 123 }],
      ['myjira.list_sites', { query: 'x', limit: 0 }],
      ['myjira.list_sites', { query: 'x', limit: 11 }],
      ['myjira.list_sites', { query: 'x', extra: true }],
      ['myjira.search_projects', { query: 'x' }],
      ['myjira.search_projects', { siteId: 'opaque_1', limit: 25, query: 'x' }],
      ['myjira.search_projects', { siteId: 'opaque_1', query: 'x', extra: true }],
      ['myjira.search_issues', { siteId: 'opaque_1' }],
      ['myjira.search_issues', { siteId: 'opaque_1', projectKey: 'invalid-key' }],
      ['myjira.search_issues', { siteId: 'opaque_1', projectKey: 'ATI', limit: 51 }],
      ['myjira.search_issues', { siteId: 'opaque_1', projectKey: 'ATI', overdueOnly: true, dueWithinDays: 3 }],
      ['myjira.search_issues', { siteId: 'opaque_1', projectKey: 'ATI', dueWithinDays: 31 }],
      ['myjira.search_issues', { siteId: 'opaque_1', projectKey: 'ATI', extra: true }],
      ['myjira.get_issue', { siteId: 'opaque_1', issueKey: 'bad' }],
      ['unknown_tool', {}],
    ])('rejects invalid args for %s before transport', async (tool, args) => {
      seen = [];
      await expect(make().execute(tool, args as any)).rejects.toMatchObject({ category: 'VALIDATION' });
      expect(seen).toEqual([]);
    });

    it.each([
      ['myjira.create_issue', { siteId: 'unknown', projectKey: 'ATI', summary: 'ok' }],
      ['myjira.add_comment', { siteId: 'opaque_1', issueKey: 'SECRET-1', body: 'ok' }],
      ['myjira.search_users', { siteId: 'opaque_1', projectKey: 'SECRET', query: 'Nguyen' }],
      ['myjira.transition_issue', { siteId: 'opaque_1', issueKey: 'SECRET-1', status: 'Done' }],
      ['myjira.update_issue', { siteId: 'opaque_1', issueKey: 'SECRET-1', priority: 'High' }],
    ])('rejects out-of-scope %s fail-closed with AUTH_ERROR 403 before transport', async (tool, args) => {
      seen = [];
      await expect(make().execute(tool, args as any)).rejects.toMatchObject({
        category: 'AUTH_ERROR',
        statusCode: 403,
      });
      expect(seen).toEqual([]);
    });
  });

  describe.each([
    ['myjira.add_comment', { body: 'Approved comment' }],
    ['myjira.transition_issue', { status: 'Done' }],
    ['myjira.update_issue', { priority: 'High' }],
  ] as const)('%s issue write target', (tool, args) => {
    it.each([
      { reason: 'the issue moved to another selected project', key: 'CORE-7', project: { id: '10001', key: 'CORE' } },
      { reason: 'the issue key changed in the selected project', key: 'ATI-43', project },
      { reason: 'the returned project key changed', key: 'ATI-42', project: { id: '10000', key: 'CORE' } },
      { reason: 'the returned project ID changed', key: 'ATI-42', project: { id: '19999', key: 'ATI' } },
      { reason: 'the response lacks a project ID', key: 'ATI-42', project: { key: 'ATI' } },
    ])('rejects before writing when $reason', async ({ key, project: currentProject }) => {
      reply = ({ url }) => {
        if (url.includes('/issue/ATI-42?fields=project')) {
          return { body: { id: '10042', key, fields: { project: currentProject, status: { name: 'Open' } } } };
        }
        if (url.endsWith('/transitions')) {
          return { body: { transitions: [{ id: '31', name: 'Done', to: { name: 'Done' } }] } };
        }
        return { status: 200, body: { id: '777' } };
      };

      await expect(make().execute(tool, { siteId: 'opaque_1', issueKey: 'ATI-42', ...args })).rejects.toMatchObject({
        category: 'AUTH_ERROR',
        details: { requestSent: false },
      });
      expect(seen.map(({ method }) => method)).toEqual(['GET']);
    });
  });

  describe('Business-ready tools: get_issue, search_users, transition_issue, update_issue, and enriched filters', () => {
    it('supports status, priority, and issueType filters in myjira.search_issues and returns enriched fields', async () => {
      reply = () => ({
        body: {
          issues: [
            {
              id: '10042',
              key: 'ATI-42',
              fields: {
                summary: 'Login bug',
                status: { name: 'In Progress' },
                priority: { name: 'High' },
                assignee: { displayName: 'Vinh Dat', accountId: 'acc-1' },
                issuetype: { name: 'Bug' },
                updated: '2026-11-03T10:00:00.000Z',
                duedate: '2026-11-10',
                project,
              },
            },
          ],
        },
      });

      const res = await make().execute('myjira.search_issues', {
        siteId: 'opaque_1',
        projectKey: 'ATI',
        status: 'In Progress',
        priority: 'High',
        issueType: 'Bug',
      });

      expect(seen[0]!.body.jql).toBe(
        'project = "ATI" AND status = "In Progress" AND priority = "High" AND issuetype = "Bug" ORDER BY updated DESC'
      );
      expect(res.issues[0]).toEqual({
        siteId: 'opaque_1',
        id: '10042',
        key: 'ATI-42',
        title: 'Login bug',
        status: 'In Progress',
        priority: 'High',
        assignee: 'Vinh Dat',
        issueType: 'Bug',
        updatedAt: '2026-11-03T10:00:00.000Z',
        dueDate: '2026-11-10',
        url: 'https://company.atlassian.net/browse/ATI-42',
      });
    });

    it('reads full issue details with ADF-to-text conversion via myjira.get_issue', async () => {
      reply = () => ({
        body: {
          id: '10042',
          key: 'ATI-42',
          fields: {
            summary: 'Checkout error',
            description: {
              type: 'doc',
              version: 1,
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Customer reported HTTP 500' }] },
              ],
            },
            status: { name: 'In Progress' },
            priority: { name: 'Highest' },
            assignee: { displayName: 'Alice' },
            issuetype: { name: 'Bug' },
            labels: ['urgent', 'checkout'],
            duedate: '2026-11-05',
            comment: {
              comments: [
                {
                  id: '501',
                  author: { displayName: 'Alice' },
                  body: {
                    type: 'doc',
                    version: 1,
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Investigating logs' }] }],
                  },
                  created: '2026-11-03T11:05:00.000Z',
                },
              ],
            },
            project,
          },
        },
      });

      const detail = await make().execute('myjira.get_issue', {
        siteId: 'opaque_1',
        issueKey: 'ATI-42',
      });

      expect(detail).toEqual({
        siteId: 'opaque_1',
        id: '10042',
        key: 'ATI-42',
        title: 'Checkout error',
        description: 'Customer reported HTTP 500',
        status: 'In Progress',
        priority: 'Highest',
        assignee: 'Alice',
        issueType: 'Bug',
        labels: ['urgent', 'checkout'],
        dueDate: '2026-11-05',
        url: 'https://company.atlassian.net/browse/ATI-42',
        comments: [
          {
            id: '501',
            author: 'Alice',
            body: 'Investigating logs',
            createdAt: '2026-11-03T11:05:00.000Z',
          },
        ],
      });
    });

    it('supports overdueOnly, dueWithinDays, and unassignedOnly JQL filters', async () => {
      reply = () => ({ body: { issues: [], isLast: true } });

      await make().execute('myjira.search_issues', {
        siteId: 'opaque_1',
        projectKey: 'ATI',
        overdueOnly: true,
        unassignedOnly: true,
      });
      expect(seen[0]!.body.jql).toBe(
        'project = "ATI" AND duedate < startOfDay() AND assignee is EMPTY AND resolution = Unresolved ORDER BY duedate ASC, updated DESC'
      );

      seen = [];
      await make().execute('myjira.search_issues', {
        siteId: 'opaque_1',
        projectKey: 'ATI',
        dueWithinDays: 3,
      });
      expect(seen[0]!.body.jql).toBe(
        'project = "ATI" AND duedate >= startOfDay() AND duedate <= "+3d" AND resolution = Unresolved ORDER BY duedate ASC, updated DESC'
      );
    });

    it('executes myjira.search_users, myjira.transition_issue, and myjira.update_issue with updatedFields', async () => {
      reply = ({ url }) => {
        if (url.includes('/user/assignable/search')) {
          return { body: [{ accountId: 'acc-9', displayName: 'Minh Nguyen' }] };
        }
        if (url.endsWith('/issue/ATI-42/transitions')) {
          return { body: { transitions: [{ id: '31', name: 'Start Progress', to: { name: 'In Progress' } }] } };
        }
        if (url.endsWith('/issue/ATI-42?fields=project')) {
          return { body: { id: '10042', key: 'ATI-42', fields: { project } } };
        }
        if (url.endsWith('/issue/ATI-42')) {
          return { body: {} };
        }
        return { status: 404, body: {} };
      };

      const users = await make().execute('myjira.search_users', {
        siteId: 'opaque_1',
        projectKey: 'ATI',
        query: 'Nguyen',
      });
      expect(users).toEqual([{ id: 'acc-9', siteId: 'opaque_1', accountId: 'acc-9', displayName: 'Minh Nguyen' }]);

      const transitioned = await make().execute('myjira.transition_issue', {
        siteId: 'opaque_1',
        issueKey: 'ATI-42',
        status: 'In Progress',
        comment: 'Starting work',
      });
      expect(transitioned).toEqual({
        siteId: 'opaque_1',
        id: '10042',
        key: 'ATI-42',
        status: 'In Progress',
        url: 'https://company.atlassian.net/browse/ATI-42',
      });

      const updated = await make().execute('myjira.update_issue', {
        siteId: 'opaque_1',
        issueKey: 'ATI-42',
        priority: 'High',
        dueDate: '2026-11-25',
      });
      expect(updated).toEqual({
        siteId: 'opaque_1',
        id: '10042',
        key: 'ATI-42',
        url: 'https://company.atlassian.net/browse/ATI-42',
        updatedFields: ['priority', 'dueDate'],
      });
    });

    it('fails fast with AUTH_ERROR on HTTP 401 scope mismatch without triggering forceRefresh loop', async () => {
      reply = () => ({
        status: 401,
        body: { code: 401, message: 'Unauthorized; scope does not match' },
      });

      const refreshFlags: boolean[] = [];
      const customAdapter = make({
        tokens: {
          getAccessToken: async (_userIdOrOpts?: any, opts?: any) => {
            const o = typeof _userIdOrOpts === 'object' ? _userIdOrOpts : opts;
            refreshFlags.push(Boolean(o?.forceRefresh));
            return 'tok-missing-scope';
          },
        },
      });

      await expect(
        customAdapter.execute('myjira.search_users', {
          siteId: 'opaque_1',
          projectKey: 'ATI',
          query: 'Nguyen',
        })
      ).rejects.toMatchObject({
        category: 'AUTH_ERROR',
        statusCode: 401,
        message: expect.stringContaining('read:jira-user'),
      });
      expect(refreshFlags).toEqual([false]);
      expect(seen).toHaveLength(1);
    });
  });
});
