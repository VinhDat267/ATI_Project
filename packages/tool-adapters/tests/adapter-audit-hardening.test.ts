import { describe, expect, it, vi } from 'vitest';
import {
  GitHubAdapter,
  GlobalRateLimiter,
  NotionAdapter,
  PersonalCalendarAdapter,
  PersonalJiraAdapter,
  PersonalSheetsAdapter,
  SlackAdapter,
  StepError,
  TelegramAdapter,
  TrelloAdapter,
} from '../src/index.js';

const json = (body: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...(headers as Record<string, string>) },
  });

describe('Backend Audit Hardening — Tool Adapters (Task 2)', () => {
  describe('GitHubAdapter scope binding, options.repo filtering, and rich issue metadata', () => {
    it('rejects mismatched context.repo !== args.repo even when both repos are allowlisted, without HTTP calls', async () => {
      const fetchFn = vi.fn(async () => json({ id: 1, number: 1, title: 'created', html_url: 'https://github.com/team/other/issues/1' }, 201));
      const adapter = new GitHubAdapter({
        credentials: { token: 'test-token' },
        allowedScope: { repos: ['team/project', 'team/other'] },
        fetchFn: fetchFn as typeof fetch,
      });

      await expect(
        adapter.execute(
          'github.create_issue',
          { repo: 'team/other', title: 'Should fail scope check' },
          { repo: 'team/project' } as any,
        ),
      ).rejects.toMatchObject({
        category: 'AUTH_ERROR',
        statusCode: 403,
        details: { requestSent: false },
      });
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('restricts github.list_issues and github.list_pull_requests to [options.repo] when args.repo is omitted', async () => {
      const fetchFn = vi.fn(async (url: string) => {
        if (url.includes('/search/issues')) {
          return json({ items: [] });
        }
        return json([]);
      });
      const adapter = new GitHubAdapter({
        credentials: { token: 'test-token' },
        allowedScope: { repos: ['team/first', 'team/second'] },
        fetchFn: fetchFn as typeof fetch,
      });

      await adapter.execute('github.list_issues', { state: 'open' }, { repo: 'team/second' } as any);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(new URL(fetchFn.mock.calls[0]![0]).searchParams.get('q')).toContain('repo:team/second');

      fetchFn.mockClear();
      await adapter.execute('github.list_pull_requests', { state: 'open' }, { repo: 'team/second' } as any);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(fetchFn.mock.calls[0]![0]).toContain('/repos/team/second/pulls');
    });

    it('propagates optional state, author, assignees, and commentsCount in githubIssue without attaching labels', async () => {
      const fetchFn = vi.fn(async () =>
        json({
          items: [
            {
              id: 501,
              number: 18,
              title: 'Rich issue payload',
              html_url: 'https://github.com/team/project/issues/18',
              repository_url: 'https://api.github.com/repos/team/project',
              state: 'open',
              user: { login: 'alice' },
              assignees: [{ login: 'bob' }, { login: 'carol' }],
              comments: 4,
              labels: [{ name: 'bug' }],
              created_at: '2026-11-01T00:00:00Z',
              updated_at: '2026-11-02T00:00:00Z',
            },
          ],
        }),
      );
      const adapter = new GitHubAdapter({
        credentials: { token: 'test-token' },
        allowedScope: { repos: ['team/project'] },
        fetchFn: fetchFn as typeof fetch,
      });

      const issues = await adapter.execute('github.list_issues', { repo: 'team/project', state: 'open' });
      expect(issues).toEqual([
        {
          id: '501',
          number: 18,
          title: 'Rich issue payload',
          url: 'https://github.com/team/project/issues/18',
          repo: 'team/project',
          state: 'open',
          author: 'alice',
          assignees: ['bob', 'carol'],
          commentsCount: 4,
          createdAt: '2026-11-01T00:00:00Z',
          updatedAt: '2026-11-02T00:00:00Z',
        },
      ]);
      expect('labels' in issues[0]).toBe(false);
    });
  });

  describe('PersonalCalendarAdapter limit parity', () => {
    it('accepts limit: 20 on mycalendar.list_event_instances matching schema maximum 20', async () => {
      const fetchFn = vi.fn(async (url: string) => {
        if (String(url).includes('/instances')) {
          return json({
            timeZone: 'Asia/Ho_Chi_Minh',
            items: [
              {
                id: 'inst_1',
                htmlLink: 'https://calendar.google.com/event?eid=inst_1',
                summary: 'Weekly standup',
                start: { dateTime: '2026-11-19T09:00:00+07:00' },
                end: { dateTime: '2026-11-19T09:30:00+07:00' },
                status: 'confirmed',
              },
            ],
          });
        }
        return json({ timeZone: 'Asia/Ho_Chi_Minh' });
      });

      const adapter = new PersonalCalendarAdapter({
        userId: 'user-1',
        tokens: { getAccessToken: async () => 'cal-token' },
        allowedScope: { calendars: ['user@example.com'] },
        fetchFn: fetchFn as typeof fetch,
      });

      const out = await adapter.execute('mycalendar.list_event_instances', {
        calendarId: 'user@example.com',
        eventId: 'evt_recurring',
        timeMin: '2026-11-01T00:00:00Z',
        timeMax: '2026-12-01T00:00:00Z',
        limit: 20,
      });
      expect(out.events).toHaveLength(1);
    });
  });

  describe('PersonalSheetsAdapter query bound parity', () => {
    it('accepts a 150-character query on mysheets.list_drive_files matching schema maxLength 200', async () => {
      const fetchFn = vi.fn(async () =>
        json({
          files: [
            {
              id: 'file_1234567890',
              name: 'Matching doc',
              mimeType: 'application/vnd.google-apps.document',
            },
          ],
        }),
      );
      const adapter = new PersonalSheetsAdapter({
        userId: 'user-1',
        tokens: { getAccessToken: async () => 'sheets-token' },
        allowedScope: { spreadsheets: ['sheet_1234567890'] },
        fetchFn: fetchFn as typeof fetch,
      });

      const query150 = 'a'.repeat(150);
      const files = await adapter.execute('mysheets.list_drive_files', { query: query150 });
      expect(files).toHaveLength(1);
      await expect(
        adapter.execute('mysheets.list_drive_files', { query: 'b'.repeat(201) }),
      ).rejects.toMatchObject({ category: 'VALIDATION' });
    });
  });

  describe('PersonalJiraAdapter parentKey live verification', () => {
    it('verifies live project of parentKey before creating an issue and rejects moved parent with AUTH_ERROR requestSent=false', async () => {
      const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes('/issue/ATI-10')) {
          return json({
            id: '10010',
            key: 'ATI-10',
            fields: {
              project: { id: '99999', key: 'OTHER' },
            },
          });
        }
        if (String(url).includes('/createmeta/')) {
          return json({ startAt: 0, total: 1, issueTypes: [{ id: '2', name: 'Task', subtask: false }] });
        }
        if (init?.method === 'POST' && String(url).endsWith('/issue')) {
          throw new Error('POST /issue must not be called for cross-project moved parentKey');
        }
        return json({}, 404);
      });

      const adapter = new PersonalJiraAdapter({
        userId: 'user-1',
        workspaceId: 'ws-1',
        capabilities: {
          workspaceId: 'ws-1',
          connected: true,
          jiraAccessMode: 'g2a',
          canReadJira: true,
          canWriteJira: true,
          requiresReconnect: false,
          selectedSiteIds: ['site-1'],
          sites: [
            {
              siteId: 'site-1',
              cloudId: '11111111-1111-1111-1111-111111111111',
              name: 'ATI Jira',
              url: 'https://ati.atlassian.net',
              selected: true,
              projects: [{ id: '10000', key: 'ATI', name: 'ATI', selected: true }],
            },
          ],
        },
        tokens: { getAccessToken: async () => 'jira-token' },
        allowedScope: { sites: ['site-1'], projects: ['ATI'] },
        fetchFn: fetchFn as typeof fetch,
      });

      await expect(
        adapter.execute('myjira.create_issue', {
          siteId: 'site-1',
          projectKey: 'ATI',
          summary: 'Sub-item',
          parentKey: 'ATI-10',
        }),
      ).rejects.toMatchObject({
        category: 'AUTH_ERROR',
        statusCode: 403,
        details: { requestSent: false },
      });

      expect(fetchFn.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    });
  });

  describe('NotionAdapter expectedDataSources check in verifyPageInScope', () => {
    it('rejects a page whose data_source_id is a sibling source not pinned by expectedDataSources', async () => {
      const DB = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      const DS_PINNED = '11111111-2222-3333-4444-555555555555';
      const DS_SIBLING = '44444444-2222-3333-4444-555555555555';
      const PAGE = '22222222-3333-4444-5555-666666666666';

      const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'PATCH' || init?.method === 'POST') {
          throw new Error('Write must not execute when data source mismatches expectedDataSources');
        }
        const path = new URL(String(url)).pathname;
        if (path === `/v1/pages/${PAGE}`) {
          return json({
            object: 'page',
            id: PAGE,
            url: `https://www.notion.so/${PAGE.replaceAll('-', '')}`,
            in_trash: false,
            parent: { type: 'data_source_id', data_source_id: DS_SIBLING, database_id: DB },
            properties: {},
          });
        }
        if (path === `/v1/data_sources/${DS_SIBLING}`) {
          return json({
            object: 'data_source',
            id: DS_SIBLING,
            parent: { type: 'database_id', database_id: DB },
            in_trash: false,
            properties: { Name: { type: 'title' } },
          });
        }
        return json({}, 404);
      });

      const adapter = new NotionAdapter({
        credentials: { token: 'notion-token' },
        allowedScope: { databases: [DB] },
        expectedDataSources: new Map([[DB, DS_PINNED]]),
        fetchFn: fetchFn as typeof fetch,
        rateLimiter: new GlobalRateLimiter({ maxRequests: 1000, windowMs: 1 }),
      });

      await expect(
        adapter.execute('notion.append_text', { pageId: PAGE, text: 'hello' }),
      ).rejects.toMatchObject({
        category: 'AUTH_ERROR',
        statusCode: 403,
        details: { requestSent: false },
      });
      expect(fetchFn.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
    });
  });

  describe('SlackAdapter URL validation, redirect error, beforeDispatch, and JSON parse hardening', () => {
    const fastLimiter = () => new GlobalRateLimiter({ maxRequests: 1000, windowMs: 1 });

    it('rejects cross-origin full endpoint URL with VALIDATION before fetchFn', async () => {
      const fetchFn = vi.fn();
      const adapter = new SlackAdapter({
        credentials: { botToken: 'xoxb-test' },
        fetchFn: fetchFn as typeof fetch,
        rateLimiter: fastLimiter(),
      });

      await expect(
        adapter.request('https://evil.example/chat.postMessage', { method: 'POST', body: '{}' }),
      ).rejects.toMatchObject({
        category: 'VALIDATION',
        details: { requestSent: false },
      });
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('wraps beforeDispatch failures as StepError with requestSent=false and passes redirect:error', async () => {
      const fetchFn = vi.fn(async (_url: any, init?: RequestInit) => {
        expect(init?.redirect).toBe('error');
        return new Response('<html>not json</html>', { status: 200 });
      });
      const adapter = new SlackAdapter({
        credentials: { botToken: 'xoxb-test' },
        fetchFn: fetchFn as typeof fetch,
        rateLimiter: fastLimiter(),
      });

      const err = await adapter
        .request('/chat.postMessage', { method: 'POST', body: '{}' }, async () => {
          throw new Error('pre-dispatch schedule check failed');
        })
        .catch((e) => e);
      expect(err).toBeInstanceOf(StepError);
      expect(err).toMatchObject({ details: { requestSent: false } });
      expect(fetchFn).not.toHaveBeenCalled();

      const invalidJsonRead = await adapter.request('/conversations.list').catch((e) => e);
      expect(invalidJsonRead).toBeInstanceOf(StepError);
      expect(invalidJsonRead.category).toBe('SERVER_ERROR');

      const invalidJsonWrite = await adapter
        .request('/chat.postMessage', { method: 'POST', body: '{}' })
        .catch((e) => e);
      expect(invalidJsonWrite).toBeInstanceOf(StepError);
      expect(invalidJsonWrite.category).toBe('UNKNOWN');
    });
  });

  describe('TelegramAdapter & TrelloAdapter pre-dispatch StepError details.requestSent=false', () => {
    it('TelegramAdapter wraps pacing.beforeDispatch plain errors with details.requestSent=false', async () => {
      const fetchFn = vi.fn(async () =>
        json({ ok: true, result: { id: -1001234567890, title: 'Chat', type: 'supergroup' } }),
      );
      const fast = () => new GlobalRateLimiter({ maxRequests: 1000, windowMs: 1 });
      const adapter = new TelegramAdapter({
        credentials: { botToken: '123456789:synthetic_bot_token_abcdefghijkl' },
        allowedScope: { chats: ['-1001234567890'] },
        fetchFn: fetchFn as typeof fetch,
        rateLimiter: fast(),
        chatRateLimiter: fast(),
        groupRateLimiter: fast(),
      });

      const err = await adapter
        .execute(
          'telegram.send_message',
          { chatId: '-1001234567890', text: 'Hi' },
          {
            beforeDispatch: async () => {
              throw new Error('abort before telegram send');
            },
          } as any,
        )
        .catch((e) => e);

      expect(err).toBeInstanceOf(StepError);
      expect(err.details?.requestSent).toBe(false);
    });

    it('TrelloAdapter preWriteRequest preserves details.requestSent=false even when pre-write throws non-StepError', async () => {
      const fetchFn = vi.fn(async () => {
        throw new Error('ECONNRESET during GET /lists/L1');
      });
      const adapter = new TrelloAdapter({
        credentials: { accessToken: 'trello-tok' },
        allowedBoardIds: ['B1'],
        baseUrl: 'http://trello.test/1',
        fetchFn: fetchFn as typeof fetch,
      });
      // Force request() to reject with a plain non-StepError as could happen on unexpected runtime/signal errors.
      (adapter as any).request = async () => {
        throw new Error('unexpected pre-write abort error');
      };

      const err = await adapter
        .execute('trello.create_card', { listId: 'L1', title: 'Card' })
        .catch((e) => e);
      expect(err).toBeInstanceOf(StepError);
      expect(err.details?.requestSent).toBe(false);
    });
  });
});
