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
});
