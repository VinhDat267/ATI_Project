import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GlobalRateLimiter, PersonalJiraAdapter, StepError } from '../src/index.js';
import { MYJIRA_SCOPES } from '@wap/tool-schemas';

const cloudId = '12345678-1234-1234-1234-123456789abc';
const capability = {
  workspaceId: 'ws-g2a',
  sites: [
    {
      siteId: 'site_opaque_1',
      cloudId,
      name: 'ATI Cloud Site',
      url: 'https://ati-cloud.atlassian.net',
      projects: [{ id: '10000', key: 'ATI', name: 'ATI Project' }],
    },
  ],
};

describe('JIRA-G2A Adapter Read-Only Policy & Search Coverage Contracts', () => {
  let server: Server;
  let baseUrl: string;
  let requests: Array<{ method: string; url: string; body: any }>;
  let handler: (req: { method: string; url: string; body: any }) => {
    status?: number;
    body?: any;
    delayMs?: number;
  };

  beforeEach(async () => {
    requests = [];
    handler = () => ({ status: 200, body: { issues: [], isLast: true } });

    server = createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const parsed = {
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        body: raw ? JSON.parse(raw) : undefined,
      };
      requests.push(parsed);
      const reply = handler(parsed);
      if (reply.delayMs) {
        await new Promise((r) => setTimeout(r, reply.delayMs));
      }
      if (res.destroyed) return;
      res.writeHead(reply.status ?? 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply.body ?? {}));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
  });

  afterEach(async () => {
    if (typeof (server as any).closeAllConnections === 'function') {
      (server as any).closeAllConnections();
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function makeAdapter(extra: Record<string, any> = {}) {
    return new PersonalJiraAdapter({
      userId: 'user-g2a',
      workspaceId: 'ws-g2a',
      capabilities: capability,
      tokens: { getAccessToken: async () => 'g2a-access-token' },
      apiBaseUrl: baseUrl,
      rateLimiter: new GlobalRateLimiter({ maxRequests: 1000, windowMs: 1 }),
      ...extra,
    });
  }

  function issue(n: number, fields: Record<string, any> = {}) {
    return {
      id: String(1000 + n), key: `ATI-${n}`,
      fields: { summary: `Issue ${n}`, status: { name: 'Open' },
        project: { id: '10000', key: 'ATI' }, priority: { name: 'High' },
        issuetype: { name: 'Bug' }, ...fields },
    };
  }

  it('P1-02: requests only remaining capacity on subsequent pages', async () => {
    let page = 0;
    handler = ({ body }) => {
      page++;
      if (page === 1) return { body: { issues: Array.from({ length: 25 }, (_, i) => issue(i + 1)), isLast: false, nextPageToken: 'p2' } };
      return { body: { issues: Array.from({ length: 25 }, (_, i) => issue(i + 26)), isLast: false, nextPageToken: 'p3' } };
    };
    const res: any = await makeAdapter().execute('myjira.search_issues', { siteId: 'site_opaque_1', projectKey: 'ATI', limit: 50 });
    expect(res.issues).toHaveLength(50);
    expect(requests[1]!.body.maxResults).toBe(25);
    expect(res.coverage).toMatchObject({ completeness: 'PARTIAL', truncationReason: 'ITEM_CAP_REACHED' });
  });

  it('P1-02: rejects an oversized terminal page instead of claiming COMPLETE for 50 of 55', async () => {
    let page = 0;
    handler = () => ++page === 1
      ? { body: { issues: Array.from({ length: 25 }, (_, i) => issue(i + 1)), isLast: false, nextPageToken: 'p2' } }
      : { body: { issues: Array.from({ length: 30 }, (_, i) => issue(i + 26)), isLast: true } };
    await expect(makeAdapter().execute('myjira.search_issues', { siteId: 'site_opaque_1', projectKey: 'ATI', limit: 50 }))
      .rejects.toMatchObject({ category: 'SERVER_ERROR' });
  });

  it('P1-02: reserves capacity for the direct-key match before requesting the first page', async () => {
    handler = ({ url, body }) => {
      if (url.includes('/issue/')) return { body: issue(1) };
      return { body: { issues: Array.from({ length: 19 }, (_, i) => issue(i + 2)), isLast: false, nextPageToken: 'p2' } };
    };
    const res: any = await makeAdapter().execute('myjira.search_issues', { siteId: 'site_opaque_1', projectKey: 'ATI', query: 'ATI-1' });
    expect(res.issues).toHaveLength(20);
    expect(requests[1]!.body.maxResults).toBe(19);
    expect(res.coverage).toMatchObject({ completeness: 'PARTIAL', truncationReason: 'ITEM_CAP_REACHED' });
  });

  it.each([{ status: 'Done' }, { priority: 'Low' }, { issueType: 'Task' }])('P1-02: does not inject a direct-key match outside filters %j', async (filter) => {
    handler = ({ url }) => url.includes('/issue/') ? { body: issue(1) } : { body: { issues: [], isLast: true } };
    const res: any = await makeAdapter().execute('myjira.search_issues', { siteId: 'site_opaque_1', projectKey: 'ATI', query: 'ATI-1', ...filter });
    expect(res.issues).toEqual([]);
  });

  it('P1-02: preserves matching direct-key filters case-insensitively and requests filter fields', async () => {
    handler = ({ url }) => {
      if (url.includes('/issue/')) {
        return { body: issue(1) };
      }
      return { body: { issues: [], isLast: true } };
    };
    const res: any = await makeAdapter().execute('myjira.search_issues', { siteId: 'site_opaque_1', projectKey: 'ATI', query: 'ATI-1', status: 'open', priority: 'HIGH', issueType: 'bug' });
    expect(res.issues.map((x: any) => x.key)).toEqual(['ATI-1']);
    const fields = new URL(requests[0]!.url, baseUrl).searchParams.get('fields')!.split(',');
    expect(fields).toEqual(expect.arrayContaining(['priority', 'issuetype']));
  });

  it.each(['99999', undefined])('P1-02: drops direct-key results with wrong or missing numeric project ID %s', async (id) => {
    handler = ({ url }) => url.includes('/issue/') ? { body: issue(1, { project: { id, key: 'ATI' } }) } : { body: { issues: [], isLast: true } };
    const res: any = await makeAdapter().execute('myjira.search_issues', { siteId: 'site_opaque_1', projectKey: 'ATI', query: 'ATI-1' });
    expect(res.issues).toEqual([]);
  });

  it.each(['myjira.search_issues', 'myjira.get_issue'])('P1-02: rejects numeric project ID mismatch after fetching %s', async (tool) => {
    const wrong = issue(1, { project: { id: '99999', key: 'ATI' } });
    handler = () => ({ body: tool === 'myjira.get_issue' ? wrong : { issues: [wrong], isLast: true } });
    const args = tool === 'myjira.get_issue' ? { siteId: 'site_opaque_1', issueKey: 'ATI-1' } : { siteId: 'site_opaque_1', projectKey: 'ATI' };
    await expect(makeAdapter().execute(tool, args)).rejects.toBeInstanceOf(StepError);
  });

  it.each(['NEW-8', 'ATI-2'])('P1-02: rejects an issue moved or substituted after binding ATI-1: %s', async (returnedKey) => {
    handler = () => ({ body: { ...issue(1, { project: returnedKey.startsWith('NEW-')
      ? { id: '20000', key: 'NEW' } : { id: '10000', key: 'ATI' } }), key: returnedKey } });
    const capabilities = structuredClone(capability);
    capabilities.sites[0]!.projects.push({ id: '20000', key: 'NEW', name: 'Another allowed project' });
    await expect(makeAdapter({ capabilities }).execute('myjira.get_issue', { siteId: 'site_opaque_1', issueKey: 'ATI-1' }))
      .rejects.toMatchObject({ category: 'AUTH_ERROR' });
  });

  it('LOCK-02 (D02-A1): MYJIRA_SCOPES excludes write:jira-work in G2A', () => {
    expect(MYJIRA_SCOPES).toEqual(['offline_access', 'read:me', 'read:jira-work']);
    expect(MYJIRA_SCOPES).not.toContain('write:jira-work');
  });

  it.each([
    ['myjira.create_issue', { siteId: 'site_opaque_1', projectKey: 'ATI', summary: 'Blocked write' }],
    ['myjira.add_comment', { siteId: 'site_opaque_1', issueKey: 'ATI-1', body: 'Blocked comment' }],
    ['myjira.update_issue', { siteId: 'site_opaque_1', issueKey: 'ATI-1', priority: 'High' }],
    ['myjira.transition_issue', { siteId: 'site_opaque_1', issueKey: 'ATI-1', status: 'Done' }],
    ['myjira.search_users', { siteId: 'site_opaque_1', projectKey: 'ATI', query: 'alice' }],
  ])('LOCK-04: PersonalJiraAdapter denies %s fail-closed before any HTTP call', async (tool, args) => {
    const adapter = makeAdapter();
    await expect(adapter.execute(tool, args)).rejects.toSatisfy((err: unknown) => {
      return (
        err instanceof StepError &&
        err.category === 'AUTH_ERROR' &&
        err.retryable === false &&
        err.message.includes('JIRA_CAPABILITY_DISABLED_IN_G2A')
      );
    });
    expect(requests).toEqual([]);
  });

  it('LOCK-05: myjira.search_issues paginates up to 3 pages and 50 items with COMPLETE coverage when isLast=true', async () => {
    let page = 0;
    handler = ({ url, body }) => {
      if (url.endsWith('/search/jql')) {
        page++;
        if (page === 1) {
          expect(body.nextPageToken).toBeUndefined();
          return {
            body: {
              issues: Array.from({ length: 20 }, (_, i) => ({
                id: String(1000 + i),
                key: `ATI-${i + 1}`,
                fields: { summary: `Issue ${i + 1}`, status: { name: 'Open' }, project: { id: '10000', key: 'ATI' } },
              })),
              isLast: false,
              nextPageToken: 'tok-page-2',
            },
          };
        }
        expect(body.nextPageToken).toBe('tok-page-2');
        return {
          body: {
            issues: Array.from({ length: 15 }, (_, i) => ({
              id: String(2000 + i),
              key: `ATI-${21 + i}`,
              fields: { summary: `Issue ${21 + i}`, status: { name: 'Open' }, project: { id: '10000', key: 'ATI' } },
            })),
            isLast: true,
          },
        };
      }
      return { status: 404, body: {} };
    };

    const res: any = await makeAdapter().execute('myjira.search_issues', {
      siteId: 'site_opaque_1',
      projectKey: 'ATI',
      limit: 50,
    });

    expect(res.issues).toHaveLength(35);
    expect(res.coverage).toMatchObject({
      completeness: 'COMPLETE',
      pagesFetched: 2,
      itemsReturned: 35,
      providerIsLast: true,
    });
  });

  it('LOCK-05: myjira.search_issues caps at 3 pages and reports PARTIAL coverage when nextPageToken remains', async () => {
    let page = 0;
    handler = ({ url }) => {
      if (url.endsWith('/search/jql')) {
        page++;
        return {
          body: {
            issues: Array.from({ length: 10 }, (_, i) => ({
              id: String(page * 100 + i),
              key: `ATI-${(page - 1) * 10 + i + 1}`,
              fields: { summary: `P${page}-${i}`, status: { name: 'Open' }, project: { id: '10000', key: 'ATI' } },
            })),
            isLast: false,
            nextPageToken: `tok-after-${page}`,
          },
        };
      }
      return { status: 404, body: {} };
    };

    const res: any = await makeAdapter().execute('myjira.search_issues', {
      siteId: 'site_opaque_1',
      projectKey: 'ATI',
      limit: 50,
    });

    expect(requests.filter((r) => r.url.endsWith('/search/jql'))).toHaveLength(3);
    expect(res.issues).toHaveLength(30);
    expect(res.coverage).toMatchObject({
      completeness: 'PARTIAL',
      pagesFetched: 3,
      itemsReturned: 30,
      truncationReason: 'PAGE_CAP_REACHED',
      providerIsLast: false,
    });
  });

  it('LOCK-05: myjira.search_issues reports UNKNOWN coverage when provider omits isLast and nextPageToken', async () => {
    handler = ({ url }) => {
      if (url.endsWith('/search/jql')) {
        return {
          body: {
            issues: [
              {
                id: '1001',
                key: 'ATI-1',
                fields: { summary: 'Ambiguous page', status: { name: 'Open' }, project: { id: '10000', key: 'ATI' } },
              },
            ],
          },
        };
      }
      return { status: 404, body: {} };
    };

    const res: any = await makeAdapter().execute('myjira.search_issues', {
      siteId: 'site_opaque_1',
      projectKey: 'ATI',
      limit: 20,
    });

    expect(res.issues).toHaveLength(1);
    expect(res.coverage).toMatchObject({
      completeness: 'UNKNOWN',
      pagesFetched: 1,
      itemsReturned: 1,
    });
  });

  it('LOCK-05: direct-key lookup inside myjira.search_issues rejects moved cross-project issue and never leaks unauthorized key', async () => {
    handler = ({ url }) => {
      if (url.includes('/issue/ATI-77')) {
        return {
          body: {
            id: '9077',
            key: 'SECRET-77',
            fields: {
              summary: 'Moved to secret project',
              status: { name: 'Open' },
              project: { id: '99999', key: 'SECRET', name: 'Secret' },
            },
          },
        };
      }
      if (url.endsWith('/search/jql')) {
        return { body: { issues: [], isLast: true } };
      }
      return { status: 404, body: {} };
    };

    const res: any = await makeAdapter().execute('myjira.search_issues', {
      siteId: 'site_opaque_1',
      projectKey: 'ATI',
      query: 'ATI-77',
    });

    expect(res.issues).toEqual([]);
    expect(res.coverage.completeness).toBe('COMPLETE');
  });
});
