import { describe, expect, it, vi } from 'vitest';
import { GitHubAdapter } from '../src/index.js';

const repo = 'team/project';
const allowedScope = { repos: [repo] };
const issue = { id: 12, number: 7, title: 'Fix login', body: 'Details', html_url: 'https://github.com/team/project/issues/7', labels: [{ name: 'bug' }] };
const json = (body: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(body), { status, headers });

describe('GitHub adapter', () => {
  it('fails closed without a token or an explicit, valid repository allowlist', async () => {
    const fetchFn = vi.fn();
    expect(() => new GitHubAdapter({ credentials: { token: '' }, allowedScope, fetchFn: fetchFn as typeof fetch })).toThrow();
    const adapter = new GitHubAdapter({ credentials: { token: 'test' }, fetchFn: fetchFn as typeof fetch });
    await expect(adapter.execute('github.search_repos', { query: 'project' })).rejects.toMatchObject({ category: 'AUTH_ERROR', statusCode: 403 });
    await expect(adapter.execute('github.create_issue', { repo, title: 'Hello' })).rejects.toMatchObject({ category: 'AUTH_ERROR', statusCode: 403 });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('searches only allowed repositories, forwards auth and signal, and normalizes output', async () => {
    const controller = new AbortController();
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => json({ id: 2, name: 'project', full_name: repo, html_url: 'https://github.com/team/project', description: 'Demo' }));
    const adapter = new GitHubAdapter({ credentials: { token: 'test' }, allowedScope, fetchFn: fetchFn as typeof fetch });
    await expect(adapter.execute('github.search_repos', { query: 'project' }, { signal: controller.signal })).resolves.toEqual([
      { id: '2', name: 'project', fullName: repo, url: 'https://github.com/team/project' },
    ]);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://api.github.com/repos/team/project');
    expect(init?.method).toBe('GET');
    expect(init?.signal).toBe(controller.signal);
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test');
  });

  it('lists every allowed repository for an empty query and still rejects a non-string query', async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => json({ id: 2, name: 'project', full_name: repo, html_url: 'https://github.com/team/project' }));
    const adapter = new GitHubAdapter({ credentials: { token: 'test' }, allowedScope, fetchFn: fetchFn as typeof fetch });
    await expect(adapter.execute('github.search_repos', { query: '' })).resolves.toEqual([
      { id: '2', name: 'project', fullName: repo, url: 'https://github.com/team/project' },
    ]);
    await expect(adapter.execute('github.search_repos', { query: 42 as any })).rejects.toMatchObject({ category: 'VALIDATION' });
  });

  it('continues past a missing allowed repository but stops on an authorization error', async () => {
    const scope = { repos: ['team/removed', repo] };
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(json({ message: 'Not Found' }, 404))
      .mockResolvedValueOnce(json({ id: 2, name: 'project', full_name: repo, html_url: 'https://github.com/team/project' }));
    const adapter = new GitHubAdapter({ credentials: { token: 'test' }, allowedScope: scope, fetchFn: fetchFn as typeof fetch });
    await expect(adapter.execute('github.search_repos', { query: 'project' })).resolves.toEqual([
      { id: '2', name: 'project', fullName: repo, url: 'https://github.com/team/project' },
    ]);
    expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([
      'https://api.github.com/repos/team/removed',
      'https://api.github.com/repos/team/project',
    ]);

    const deniedFetch = vi.fn()
      .mockResolvedValueOnce(json({ message: 'Forbidden' }, 403))
      .mockResolvedValueOnce(json({ id: 2, name: 'project', full_name: repo, html_url: 'https://github.com/team/project' }));
    const deniedAdapter = new GitHubAdapter({ credentials: { token: 'test' }, allowedScope: scope, fetchFn: deniedFetch as typeof fetch });
    await expect(deniedAdapter.execute('github.search_repos', { query: 'project' })).rejects.toMatchObject({ category: 'AUTH_ERROR', statusCode: 403 });
    expect(deniedFetch).toHaveBeenCalledTimes(1);
  });

  it('prevents out-of-scope issue reads and writes before transport', async () => {
    const fetchFn = vi.fn();
    const adapter = new GitHubAdapter({ credentials: { token: 'test' }, allowedScope, fetchFn: fetchFn as typeof fetch });
    for (const [tool, args] of [
      ['github.search_issues', { repo: 'other/private', query: 'x' }],
      ['github.get_issue', { repo: 'other/private', issueNumber: 7 }],
      ['github.create_issue', { repo: 'other/private', title: 'x' }],
      ['github.add_label', { repo: 'other/private', issueNumber: 7, label: 'bug' }],
    ] as const) {
      await expect(adapter.execute(tool, args)).rejects.toMatchObject({ category: 'AUTH_ERROR', statusCode: 403 });
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('searches issues within a repository and filters unverified or foreign results', async () => {
    const fetchFn = vi.fn(async (_url: string) => json({ items: [
      { ...issue, repository_url: 'https://api.github.com/repos/team/project' },
      { ...issue, id: 99, repository_url: 'https://api.github.com/repos/other/private' },
      { ...issue, id: 100, repository_url: 'https://api.github.com/repos/team/project', pull_request: {} },
      { ...issue, id: 101 },
    ] }));
    const adapter = new GitHubAdapter({ credentials: { token: 'test' }, allowedScope, fetchFn: fetchFn as typeof fetch });
    await expect(adapter.execute('github.search_issues', { repo, query: 'Fix login' })).resolves.toEqual([
      { id: '12', number: 7, title: 'Fix login', url: issue.html_url, repo },
    ]);
    const url = new URL(fetchFn.mock.calls[0]![0]);
    expect(url.pathname).toBe('/search/issues');
    expect(url.searchParams.get('q')).toContain('repo:team/project');
  });

  it('gets issue details and rejects a pull request from the issues API', async () => {
    const fetchFn = vi.fn(async (_url: string) => json(issue));
    const adapter = new GitHubAdapter({ credentials: { token: 'test' }, allowedScope, fetchFn: fetchFn as typeof fetch });
    await expect(adapter.execute('github.get_issue', { repo, issueNumber: 7 })).resolves.toEqual({
      id: '12', number: 7, title: 'Fix login', body: 'Details', url: issue.html_url, repo, labels: ['bug'],
    });
    expect(fetchFn.mock.calls[0]![0]).toBe('https://api.github.com/repos/team/project/issues/7');
    fetchFn.mockResolvedValueOnce(json({ ...issue, pull_request: {} }));
    await expect(adapter.execute('github.get_issue', { repo, issueNumber: 7 })).rejects.toMatchObject({ category: 'VALIDATION' });
  });

  it('creates an issue once and adds a label with the agreed request bodies', async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => url.endsWith('/labels')
      ? json([{ name: 'bug' }, { name: 'urgent' }])
      : json(issue, 201));
    const adapter = new GitHubAdapter({ credentials: { token: 'test' }, allowedScope, fetchFn: fetchFn as typeof fetch });
    await expect(adapter.execute('github.create_issue', { repo, title: 'Fix login', body: 'Details', labels: ['bug'] })).resolves.toEqual({
      id: '12', number: 7, title: 'Fix login', url: issue.html_url, repo,
    });
    await expect(adapter.execute('github.add_label', { repo, issueNumber: 7, label: 'urgent' })).resolves.toEqual({
      number: 7, labels: ['bug', 'urgent'], repo, url: issue.html_url,
    });
    expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([
      'https://api.github.com/repos/team/project/issues',
      'https://api.github.com/repos/team/project/issues/7/labels',
    ]);
    expect(JSON.parse(String(fetchFn.mock.calls[0]![1]?.body))).toEqual({ title: 'Fix login', body: 'Details', labels: ['bug'] });
    expect(JSON.parse(String(fetchFn.mock.calls[1]![1]?.body))).toEqual({ labels: ['urgent'] });
  });

  it('requires the acknowledged label in a successful write response', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json([{ name: 'other' }]))
      .mockResolvedValueOnce(json([{ name: 'BUG' }]));
    const adapter = new GitHubAdapter({ credentials: { token: 'test' }, allowedScope, fetchFn: fetchFn as typeof fetch });
    await expect(adapter.execute('github.add_label', { repo, issueNumber: 7, label: 'bug' })).rejects.toMatchObject({ category: 'UNKNOWN', retryable: false });
    await expect(adapter.execute('github.add_label', { repo, issueNumber: 7, label: 'bug' })).rejects.toMatchObject({ category: 'UNKNOWN', retryable: false });
    await expect(adapter.execute('github.add_label', { repo, issueNumber: 7, label: 'bug' })).resolves.toMatchObject({ labels: ['BUG'] });
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('retries a 429 read after Retry-After and never retries a rate-limited write', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(json({}, 429, { 'Retry-After': '0' })).mockResolvedValueOnce(json(issue));
    const adapter = new GitHubAdapter({ credentials: { token: 'test' }, allowedScope, fetchFn: fetchFn as typeof fetch });
    await expect(adapter.execute('github.get_issue', { repo, issueNumber: 7 })).resolves.toMatchObject({ number: 7 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    fetchFn.mockResolvedValueOnce(json({}, 429, { 'Retry-After': '0' }));
    await expect(adapter.execute('github.create_issue', { repo, title: 'x' })).rejects.toMatchObject({ category: 'RATE_LIMIT', statusCode: 429 });
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('marks an ambiguous write transport failure UNKNOWN without retry', async () => {
    const fetchFn = vi.fn(async () => { throw new Error('connection reset after send'); });
    const adapter = new GitHubAdapter({ credentials: { token: 'test' }, allowedScope, fetchFn: fetchFn as typeof fetch });
    await expect(adapter.execute('github.create_issue', { repo, title: 'x' })).rejects.toMatchObject({ category: 'UNKNOWN', retryable: false });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('forwards cancellation to a write and treats an interrupted dispatch as UNKNOWN', async () => {
    const controller = new AbortController();
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      controller.abort();
      throw new Error('aborted after dispatch');
    });
    const adapter = new GitHubAdapter({ credentials: { token: 'test' }, allowedScope, fetchFn: fetchFn as typeof fetch });
    await expect(adapter.execute('github.create_issue', { repo, title: 'x' }, { signal: controller.signal })).rejects.toMatchObject({ category: 'UNKNOWN', retryable: false });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('treats a server error after a write as UNKNOWN and does not resend', async () => {
    const fetchFn = vi.fn(async () => json({ message: 'unavailable' }, 502));
    const adapter = new GitHubAdapter({ credentials: { token: 'test' }, allowedScope, fetchFn: fetchFn as typeof fetch });
    await expect(adapter.execute('github.add_label', { repo, issueNumber: 7, label: 'bug' })).rejects.toMatchObject({ category: 'UNKNOWN', statusCode: 502, retryable: false });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('normalizes HTTP errors and validates arguments before sending', async () => {
    const fetchFn = vi.fn(async () => json({ message: 'rejected' }, 422));
    const adapter = new GitHubAdapter({ credentials: { token: 'test' }, allowedScope, fetchFn: fetchFn as typeof fetch });
    await expect(adapter.execute('github.create_issue', { repo, title: 'x' })).rejects.toMatchObject({ category: 'VALIDATION', statusCode: 422, retryable: false });
    await expect(adapter.execute('github.add_label', { repo, issueNumber: 0, label: 'bug' })).rejects.toMatchObject({ category: 'VALIDATION' });
    await expect(adapter.execute('github.create_issue', { repo: 'team/project/../../other', title: 'x' })).rejects.toMatchObject({ category: 'VALIDATION' });
    await expect(adapter.execute('github.get_issue', { repo: 'team/..', issueNumber: 7 })).rejects.toMatchObject({ category: 'VALIDATION' });
    await expect(adapter.execute('github.search_repos', { query: 'x', limit: 11 })).rejects.toMatchObject({ category: 'VALIDATION' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('supports structured issue/PR filter qualifiers and shorthand queries without breaking keyword search', async () => {
    const prItem = {
      id: 201,
      number: 42,
      title: 'Feat: add OAuth',
      html_url: 'https://github.com/team/project/pull/42',
      repository_url: 'https://api.github.com/repos/team/project',
      pull_request: { url: 'https://api.github.com/repos/team/project/pulls/42' },
    };
    const issueItem = {
      ...issue,
      repository_url: 'https://api.github.com/repos/team/project',
    };
    const fetchFn = vi.fn(async () => json({ items: [issueItem, prItem] }));
    const adapter = new GitHubAdapter({ credentials: { token: 'test' }, allowedScope, fetchFn: fetchFn as typeof fetch });

    // 1. Structured qualifiers: is:open no:assignee
    const unassignedRes = await adapter.execute('github.search_issues', { repo, query: 'is:open no:assignee' });
    expect(unassignedRes).toEqual([{ id: '12', number: 7, title: 'Fix login', url: issue.html_url, repo }]);
    expect(new URL(fetchFn.mock.calls[0]![0]).searchParams.get('q')).toBe('repo:team/project is:issue is:open no:assignee');

    // 2. Pull request qualifiers: is:pr is:open draft:false review:none created:<=2026-10-30T00:00:00Z
    const prRes = await adapter.execute('github.search_issues', {
      repo,
      query: 'is:pr is:open draft:false review:none created:<=2026-10-30T00:00:00Z',
    });
    expect(prRes).toEqual([
      { id: '12', number: 7, title: 'Fix login', url: issue.html_url, repo },
      { id: '201', number: 42, title: 'Feat: add OAuth', url: prItem.html_url, repo },
    ]);
    expect(new URL(fetchFn.mock.calls[1]![0]).searchParams.get('q')).toBe(
      'repo:team/project is:pr is:open draft:false review:none created:<=2026-10-30T00:00:00Z'
    );

    // 3. Shorthands: *, unassigned, pr
    await adapter.execute('github.search_issues', { repo, query: '*' });
    expect(new URL(fetchFn.mock.calls[2]![0]).searchParams.get('q')).toBe('repo:team/project is:issue is:open');

    await adapter.execute('github.search_issues', { repo, query: 'unassigned' });
    expect(new URL(fetchFn.mock.calls[3]![0]).searchParams.get('q')).toBe('repo:team/project is:issue is:open no:assignee');

    await adapter.execute('github.search_issues', { repo, query: 'pr' });
    expect(new URL(fetchFn.mock.calls[4]![0]).searchParams.get('q')).toBe('repo:team/project is:pr is:open');

    // 4. Plain keywords use AND search (unquoted) while quoted phrases remain exact
    const kwRes = await adapter.execute('github.search_issues', { repo, query: 'login crash' });
    expect(kwRes).toEqual([{ id: '12', number: 7, title: 'Fix login', url: issue.html_url, repo }]);
    expect(new URL(fetchFn.mock.calls[5]![0]).searchParams.get('q')).toBe('repo:team/project is:issue login crash');

    await adapter.execute('github.search_issues', { repo, query: '"login crash" is:open' });
    expect(new URL(fetchFn.mock.calls[6]![0]).searchParams.get('q')).toBe('repo:team/project is:issue is:open "login crash"');

    // 5. Unwhitelisted qualifiers (e.g. repo:, org:) are neutralized to plain text
    await adapter.execute('github.search_issues', { repo, query: 'repo:other/secret author:vinhdat bug' });
    expect(new URL(fetchFn.mock.calls[7]![0]).searchParams.get('q')).toBe('repo:team/project is:issue author:vinhdat repo other/secret bug');
  });

  it('supports custom baseUrl and rejects out-of-scope context.repo before HTTP dispatch', async () => {
    const fetchFn = vi.fn(async () =>
      json({
        items: [
          {
            ...issue,
            repository_url: 'http://127.0.0.1:9999/repos/team/project',
          },
        ],
      })
    );
    const adapter = new GitHubAdapter({
      credentials: { token: 'test' },
      allowedScope,
      baseUrl: 'http://127.0.0.1:9999/',
      fetchFn: fetchFn as typeof fetch,
    });

    await expect(
      adapter.execute('github.get_issue', { repo, issueNumber: 7 }, { repo: 'octo/forbidden' } as any)
    ).rejects.toMatchObject({ category: 'AUTH_ERROR', statusCode: 403 });
    expect(fetchFn).not.toHaveBeenCalled();

    const found = await adapter.execute('github.search_issues', { repo, query: '*' });
    expect(found).toEqual([{ id: '12', number: 7, title: 'Fix login', url: issue.html_url, repo }]);
    expect(fetchFn.mock.calls[0]![0]).toMatch(/^http:\/\/127\.0\.0\.1:9999\/search\/issues\?/);
  });

  it('returns pull request metadata from the pull detail endpoint', async () => {
    const issueView = {
      id: 301,
      number: 42,
      title: 'Feat: OAuth',
      body: 'PR description',
      state: 'open',
      html_url: 'https://github.com/team/project/pull/42',
      labels: [{ name: 'enhancement' }],
      user: { login: 'octocat' },
      assignees: [{ login: 'vinhdat' }],
      comments: 2,
    };
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'GET' && url.endsWith('/pulls/42')) {
        return json({
          ...issueView,
          id: 201,
          draft: false,
          merged: false,
          head: { ref: 'feature/oauth' },
          base: { ref: 'main' },
          requested_reviewers: [{ login: 'reviewer' }],
        });
      }
      if (init?.method === 'GET' && url.endsWith('/issues/42')) {
        return json({ ...issueView, pull_request: { url: 'https://api.github.com/repos/team/project/pulls/42' } });
      }
      return json({ message: 'Not Found' }, 404);
    });
    const adapter = new GitHubAdapter({ credentials: { token: 'test' }, allowedScope, fetchFn: fetchFn as typeof fetch });

    await expect(adapter.execute('github.get_pull_request', { repo, issueNumber: 42 })).resolves.toEqual({
      id: '201',
      number: 42,
      title: 'Feat: OAuth',
      body: 'PR description',
      url: 'https://github.com/team/project/pull/42',
      repo,
      labels: ['enhancement'],
      state: 'open',
      isPullRequest: true,
      author: 'octocat',
      assignees: ['vinhdat'],
      commentsCount: 2,
      draft: false,
      merged: false,
      headRef: 'feature/oauth',
      baseRef: 'main',
      requestedReviewers: ['reviewer'],
    });
  });

  it('returns not found for an issue number with no matching pull request', async () => {
    const fetchFn = vi.fn(async (url: string) => url.endsWith('/issues/7')
      ? json(issue)
      : json({ message: 'Not Found' }, 404));
    const adapter = new GitHubAdapter({ credentials: { token: 'test' }, allowedScope, fetchFn: fetchFn as typeof fetch });

    await expect(adapter.execute('github.get_pull_request', { repo, issueNumber: 7 })).rejects.toMatchObject({
      category: 'NOT_FOUND',
      statusCode: 404,
      retryable: false,
    });
  });

  it('supports assignees on create_issue, update_issue (close/reopen/edit), add_comment, and list_issues across allowed repos', async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/issues') && init?.method === 'POST') {
        return json({ ...issue, assignees: [{ login: 'octocat' }, { login: 'vinhdat' }] }, 201);
      }
      if (url.endsWith('/issues/7') && init?.method === 'PATCH') {
        return json({
          ...issue,
          state: 'closed',
          title: 'Fixed login',
          assignees: [{ login: 'vinhdat' }],
          labels: [{ name: 'bug' }, { name: 'resolved' }],
        });
      }
      if (url.endsWith('/issues/7/comments') && init?.method === 'POST') {
        return json({
          id: 9001,
          body: 'Đã kiểm tra và xác nhận fix.',
          html_url: 'https://github.com/team/project/issues/7#issuecomment-9001',
        }, 201);
      }
      if (url.includes('/search/issues')) {
        return json({
          items: [
            { ...issue, repository_url: 'https://api.github.com/repos/team/project' },
          ],
        });
      }
      return json({ message: 'Unexpected URL' }, 404);
    });

    const adapter = new GitHubAdapter({ credentials: { token: 'test' }, allowedScope, fetchFn: fetchFn as typeof fetch });

    // 1. create_issue with assignees normalizes leading @
    await adapter.execute('github.create_issue', {
      repo,
      title: 'Fix login',
      assignees: ['@octocat', 'vinhdat'],
    });
    expect(JSON.parse(String(fetchFn.mock.calls[0]![1]?.body))).toEqual({
      title: 'Fix login',
      assignees: ['octocat', 'vinhdat'],
    });

    // 2. update_issue sends PATCH to close/update issue
    const updated = await adapter.execute('github.update_issue', {
      repo,
      issueNumber: 7,
      state: 'closed',
      title: 'Fixed login',
      assignees: ['@vinhdat'],
      labels: ['bug', 'resolved'],
    });
    expect(updated).toEqual({
      id: '12',
      number: 7,
      title: 'Fixed login',
      url: issue.html_url,
      repo,
      state: 'closed',
      labels: ['bug', 'resolved'],
      assignees: ['vinhdat'],
    });
    expect(fetchFn.mock.calls[1]![1]?.method).toBe('PATCH');
    expect(JSON.parse(String(fetchFn.mock.calls[1]![1]?.body))).toEqual({
      title: 'Fixed login',
      state: 'closed',
      labels: ['bug', 'resolved'],
      assignees: ['vinhdat'],
    });

    // 3. add_comment posts comment to issue
    const comment = await adapter.execute('github.add_comment', {
      repo,
      issueNumber: 7,
      body: 'Đã kiểm tra và xác nhận fix.',
    });
    expect(comment).toEqual({
      id: '9001',
      issueNumber: 7,
      body: 'Đã kiểm tra và xác nhận fix.',
      repo,
      url: 'https://github.com/team/project/issues/7#issuecomment-9001',
    });

    // 4. list_issues works without repo (iterating allowedRepositories for TelegramDigestRunner)
    const listed = await adapter.execute('github.list_issues', { state: 'open' });
    expect(listed).toEqual([
      { id: '12', number: 7, title: 'Fix login', url: issue.html_url, repo },
    ]);

    // 5. list_issues preserves created_at and updated_at as createdAt and updatedAt for aging reports
    const timestampedFetch = vi.fn(async () =>
      json({
        items: [
          {
            ...issue,
            repository_url: 'https://api.github.com/repos/team/project',
            created_at: '2026-10-01T00:00:00Z',
            updated_at: '2026-10-05T12:00:00Z',
          },
        ],
      }),
    );
    const timestampedAdapter = new GitHubAdapter({
      credentials: { token: 'test' },
      allowedScope,
      fetchFn: timestampedFetch as typeof fetch,
    });
    const timestampedListed = await timestampedAdapter.execute('github.list_issues', { repo, state: 'open' });
    expect(timestampedListed).toEqual([
      {
        id: '12',
        number: 7,
        title: 'Fix login',
        url: issue.html_url,
        repo,
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-05T12:00:00Z',
      },
    ]);
  });

  it('lists pull requests from allowed repository with state and keyword filtering', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('/repos/team/project/pulls')) {
        return json([
          {
            id: 501,
            number: 88,
            title: 'Feat: Google Meet & Drive integration',
            body: 'Adds Google Workspace tools',
            state: 'open',
            draft: false,
            html_url: 'https://github.com/team/project/pull/88',
            user: { login: 'vinhdat' },
          },
          {
            id: 502,
            number: 89,
            title: 'Chore: bump deps',
            body: 'Routine update',
            state: 'open',
            draft: true,
            html_url: 'https://github.com/team/project/pull/89',
            user: { login: 'dependabot' },
          },
        ]);
      }
      return json({ message: 'Not Found' }, 404);
    });
    const adapter = new GitHubAdapter({
      credentials: { token: 'test' },
      allowedScope,
      fetchFn: fetchFn as typeof fetch,
    });

    const prs = await adapter.execute('github.list_pull_requests', {
      repo,
      state: 'open',
      query: 'Google Meet',
      limit: 5,
    });
    expect(prs).toEqual([
      {
        id: '501',
        number: 88,
        title: 'Feat: Google Meet & Drive integration',
        url: 'https://github.com/team/project/pull/88',
        repo,
        state: 'open',
        author: 'vinhdat',
        draft: false,
      },
    ]);
  });

  it('matches repo allowlist case-insensitively, marks pre-dispatch aborts requestSent:false, and allows issue/PR limits up to 50', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/repos/team/project')) {
        return json({ id: 2, name: 'project', full_name: 'Team/Project', html_url: 'https://github.com/Team/Project' });
      }
      if (url.includes('/search/issues')) {
        return json({
          items: [{ ...issue, repository_url: 'https://api.github.com/repos/Team/Project' }],
        });
      }
      if (url.includes('/repos/team/project/pulls')) {
        return json([]);
      }
      return json({ message: 'Not Found' }, 404);
    });
    const adapter = new GitHubAdapter({ credentials: { token: 'test' }, allowedScope, fetchFn: fetchFn as typeof fetch });

    await expect(adapter.execute('github.search_repos', { query: 'project' })).resolves.toEqual([
      { id: '2', name: 'project', fullName: 'Team/Project', url: 'https://github.com/Team/Project' },
    ]);
    await expect(adapter.execute('github.search_issues', { repo: 'TEAM/project', query: 'open', limit: 35 })).resolves.toEqual([
      { id: '12', number: 7, title: 'Fix login', url: issue.html_url, repo },
    ]);
    await expect(adapter.execute('github.list_pull_requests', { repo: 'Team/Project', limit: 50 })).resolves.toEqual([]);
    await expect(adapter.execute('github.search_issues', { repo, query: 'open', limit: 51 })).rejects.toMatchObject({ category: 'VALIDATION' });

    const preAborted = new AbortController();
    preAborted.abort();
    await expect(adapter.execute('github.create_issue', { repo, title: 'aborted' }, { signal: preAborted.signal })).rejects.toMatchObject({
      category: 'NETWORK',
      details: { requestSent: false },
    });
    await expect(adapter.execute('github.create_issue', { repo: 'other/private', title: 'denied' })).rejects.toMatchObject({
      category: 'AUTH_ERROR',
      details: { requestSent: false },
    });
  });

  it('supports list_comments, create_pull_request, and request_reviewers with fail-closed validation and acknowledgment checks', async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/issues/7/comments') && init?.method === 'GET') {
        return json([
          {
            id: 3001,
            body: 'Đã reproduce trên staging.',
            html_url: 'https://github.com/team/project/issues/7#issuecomment-3001',
            user: { login: 'qa-bot' },
            created_at: '2026-10-05T10:00:00Z',
          },
        ]);
      }
      if (url.endsWith('/repos/team/project/pulls') && init?.method === 'POST') {
        const parsed = JSON.parse(String(init.body));
        return json(
          {
            id: 601,
            number: 99,
            title: parsed.title,
            html_url: 'https://github.com/team/project/pull/99',
            state: 'open',
            draft: Boolean(parsed.draft),
            head: { ref: parsed.head },
            base: { ref: parsed.base },
          },
          201,
        );
      }
      if (url.endsWith('/pulls/99/requested_reviewers') && init?.method === 'POST') {
        const parsed = JSON.parse(String(init.body));
        if (parsed.reviewers.includes('missing')) {
          return json({ html_url: 'https://github.com/team/project/pull/99', requested_reviewers: [] }, 201);
        }
        return json(
          {
            html_url: 'https://github.com/team/project/pull/99',
            requested_reviewers: parsed.reviewers.map((login: string) => ({ login })),
          },
          201,
        );
      }
      return json({ message: 'Not Found' }, 404);
    });
    const adapter = new GitHubAdapter({ credentials: { token: 'test' }, allowedScope, fetchFn: fetchFn as typeof fetch });

    const comments = await adapter.execute('github.list_comments', { repo, issueNumber: 7, limit: 20 });
    expect(comments).toEqual([
      {
        id: '3001',
        issueNumber: 7,
        author: 'qa-bot',
        body: 'Đã reproduce trên staging.',
        url: 'https://github.com/team/project/issues/7#issuecomment-3001',
        repo,
        createdAt: '2026-10-05T10:00:00Z',
      },
    ]);

    const pr = await adapter.execute('github.create_pull_request', {
      repo,
      title: 'Fix login race',
      head: 'fix/login-race',
      base: 'main',
      body: 'Closes #7',
      draft: true,
    });
    expect(pr).toEqual({
      id: '601',
      number: 99,
      title: 'Fix login race',
      url: 'https://github.com/team/project/pull/99',
      repo,
      state: 'open',
      draft: true,
      headRef: 'fix/login-race',
      baseRef: 'main',
    });

    await expect(
      adapter.execute('github.create_pull_request', { repo, title: 'Bad PR', head: 'main', base: 'main' }),
    ).rejects.toMatchObject({ category: 'VALIDATION' });

    const reviewed = await adapter.execute('github.request_reviewers', {
      repo,
      issueNumber: 99,
      reviewers: ['@alice', 'bob'],
    });
    expect(reviewed).toEqual({
      number: 99,
      reviewers: ['alice', 'bob'],
      repo,
      url: 'https://github.com/team/project/pull/99',
    });

    await expect(
      adapter.execute('github.request_reviewers', { repo, issueNumber: 99, reviewers: ['missing'] }),
    ).rejects.toMatchObject({ category: 'UNKNOWN', retryable: false });

    await expect(
      adapter.execute('github.request_reviewers', {
        repo,
        issueNumber: 99,
        reviewers: Array.from({ length: 11 }, (_, i) => `u${i}`),
      }),
    ).rejects.toMatchObject({ category: 'VALIDATION' });
  });
});
