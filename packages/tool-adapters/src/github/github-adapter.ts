import { BaseAdapter, StepError } from '../base-adapter.js';
import { GlobalRateLimiter } from '../rate-limiter.js';
import type { BaseAdapterConfig } from '../base-adapter.js';

export interface GitHubAdapterConfig extends BaseAdapterConfig {
  credentials: { token: string };
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

const defaultApiBase = 'https://api.github.com';
const sharedGitHubLimiter = new GlobalRateLimiter({ maxRequests: 5000, windowMs: 60 * 60 * 1000 });
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SAFE_QUALIFIER_RE = /^(?:is:(?:open|closed|issue|pr)|no:assignee|review:(?:none|required)|draft:false|label:[A-Za-z0-9_.-]+|(?:created|updated):(?:>=|<=|>|<)\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}Z)?)$/i;

export function buildIssueSearchQuery(repo: string, rawQuery: string): { q: string; allowPullRequests: boolean } {
  const trimmed = rawQuery.trim();
  const lower = trimmed.toLowerCase();
  if (lower === '*' || lower === 'open') {
    return { q: `repo:${repo} is:issue is:open`, allowPullRequests: false };
  }
  if (lower === 'unassigned') {
    return { q: `repo:${repo} is:issue is:open no:assignee`, allowPullRequests: false };
  }
  if (lower === 'pr' || lower === 'pull request') {
    return { q: `repo:${repo} is:pr is:open`, allowPullRequests: true };
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const qualifiers: string[] = [];
  const keywords: string[] = [];

  for (const token of tokens) {
    if (SAFE_QUALIFIER_RE.test(token)) {
      qualifiers.push(token);
    } else {
      const cleaned = token.replace(/["\\]/g, ' ').trim();
      if (cleaned) keywords.push(cleaned);
    }
  }

  const hasIsPr = qualifiers.some((q) => q.toLowerCase() === 'is:pr');
  const hasIsIssue = qualifiers.some((q) => q.toLowerCase() === 'is:issue');
  const typePrefix = hasIsPr || hasIsIssue ? [] : ['is:issue'];
  const keywordPart = keywords.length > 0 ? [`"${keywords.join(' ')}"`] : [];
  const parts = [`repo:${repo}`, ...typePrefix, ...qualifiers, ...keywordPart];
  return {
    q: parts.join(' '),
    allowPullRequests: hasIsPr,
  };
}

function validRepository(value: unknown): value is string {
  if (typeof value !== 'string' || !repositoryPattern.test(value)) return false;
  const [owner, name] = value.split('/');
  return owner !== '.' && owner !== '..' && name !== '.' && name !== '..';
}

function validation(message: string): never {
  throw new StepError({ message, category: 'VALIDATION', retryable: false });
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) validation(`GitHub ${field} must be a non-empty string`);
  return value.trim();
}

function issueNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    validation('GitHub issueNumber must be a positive integer');
  }
  return value;
}

function limit(value: unknown): number {
  if (value === undefined) return 10;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 10) {
    validation('GitHub limit must be an integer between 1 and 10');
  }
  return value;
}

function normalizeAssignees(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) validation('GitHub assignees must be an array of strings');
  return value.map((item) => {
    if (typeof item !== 'string') validation('GitHub assignees must be non-empty strings');
    const cleaned = item.trim().replace(/^@+/, '');
    if (!cleaned) validation('GitHub assignees must be non-empty strings');
    return cleaned;
  });
}

function githubIssue(value: any, repo: string, writing: boolean, allowPullRequests = false) {
  if (!value || typeof value !== 'object' || !Number.isSafeInteger(value.id) ||
      !Number.isSafeInteger(value.number) || typeof value.title !== 'string' ||
      typeof value.html_url !== 'string') {
    throw new StepError({
      message: 'GitHub returned an invalid issue response',
      category: writing ? 'UNKNOWN' : 'SERVER_ERROR',
      retryable: false,
    });
  }
  if (value.pull_request && !allowPullRequests) validation('GitHub returned a pull request where an issue was required');
  return { id: String(value.id), number: value.number as number, title: value.title as string, url: value.html_url as string, repo };
}

/** GitHub REST adapter. All endpoints are fixed and each target must be on the exact allowlist. */
export class GitHubAdapter extends BaseAdapter {
  public readonly service = 'github';
  private readonly token: string;
  private readonly apiBase: string;
  private readonly fetchFn: typeof fetch;

  constructor(config: GitHubAdapterConfig) {
    super(config);
    this.token = text(config.credentials?.token, 'token');
    this.apiBase = (config.baseUrl?.trim() || defaultApiBase).replace(/\/+$/, '');
    this.fetchFn = config.fetchFn ?? globalThis.fetch;
  }

  private allowedRepositories(): string[] {
    const repos = this.allowedScope?.repos;
    if (!Array.isArray(repos) || repos.length === 0 || repos.some((repo) => !validRepository(repo))) {
      throw new StepError({ message: 'GitHub requires an explicit repository allowlist', category: 'AUTH_ERROR', statusCode: 403, retryable: false });
    }
    return repos;
  }

  private checkedRepo(value: unknown, contextRepo?: unknown): string {
    if (contextRepo !== undefined && contextRepo !== null) {
      if (!validRepository(contextRepo)) validation('GitHub repo must be owner/repo');
      this.allowedRepositories();
      try {
        this.assertAllowedScope('repos', contextRepo);
      } catch {
        throw new StepError({ message: `GitHub repository '${contextRepo}' is outside allowed scope`, category: 'AUTH_ERROR', statusCode: 403, retryable: false });
      }
    }
    if (!validRepository(value)) validation('GitHub repo must be owner/repo');
    this.allowedRepositories();
    try {
      this.assertAllowedScope('repos', value);
    } catch {
      throw new StepError({ message: `GitHub repository '${value}' is outside allowed scope`, category: 'AUTH_ERROR', statusCode: 403, retryable: false });
    }
    return value;
  }

  private async request<T>(path: string, signal?: AbortSignal, body?: unknown, method?: 'GET' | 'POST' | 'PATCH'): Promise<T> {
    const writing = body !== undefined;
    if (signal?.aborted) {
      throw new StepError({ message: 'GitHub request was cancelled before dispatch', category: 'NETWORK', retryable: false });
    }
    const limiter = this.rateLimiter ?? sharedGitHubLimiter;
    await this.waitForTransportSlot(limiter, this.service, signal);
    const init: RequestInit = {
      method: method ?? (writing ? 'POST' : 'GET'),
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(writing ? { 'Content-Type': 'application/json' } : {}),
      },
      signal,
      redirect: 'error',
      ...(writing ? { body: JSON.stringify(body) } : {}),
    };
    let response: Response;
    for (let attempt = 0; ; attempt++) {
      try {
        response = await this.fetchFn(`${this.apiBase}${path}`, init);
      } catch (cause) {
        throw new StepError({
          message: writing ? 'GitHub write result is unknown after transport failure' : 'GitHub read request failed',
          category: writing ? 'UNKNOWN' : 'NETWORK', retryable: !writing, cause,
        });
      }
      const rateLimited = response.status === 429 ||
        (response.status === 403 && (response.headers.get('Retry-After') !== null || response.headers.get('X-RateLimit-Remaining') === '0'));
      if (rateLimited && !writing && attempt === 0) {
        await this.waitForRetryAfter(response.headers.get('Retry-After'), signal);
        await this.waitForTransportSlot(limiter, this.service, signal);
        continue;
      }
      if (rateLimited) {
        throw new StepError({ message: 'GitHub rate limit exceeded', category: 'RATE_LIMIT', statusCode: response.status, retryable: !writing });
      }
      break;
    }
    if (!response.ok) {
      const status = response.status;
      const category = status === 401 || status === 403 ? 'AUTH_ERROR'
        : status === 404 ? 'NOT_FOUND'
        : status === 400 || status === 422 ? 'VALIDATION'
        : writing ? 'UNKNOWN' : 'SERVER_ERROR';
      throw new StepError({ message: `GitHub request failed with HTTP ${status}`, category, statusCode: status, retryable: !writing && status >= 500 });
    }
    try {
      return await response.json() as T;
    } catch (cause) {
      throw new StepError({
        message: writing ? 'GitHub write result is unknown after an unreadable response' : 'GitHub returned an unreadable response',
        category: writing ? 'UNKNOWN' : 'SERVER_ERROR', retryable: false, cause,
      });
    }
  }

  async searchRepos(args: { query: string; limit?: number }, options?: { signal?: AbortSignal }) {
    // An empty query lists every allowed repository; the allowlist bounds the result.
    if (typeof args.query !== 'string') validation('GitHub query must be a string');
    const query = args.query.trim().toLowerCase();
    const max = limit(args.limit);
    const repos = this.allowedRepositories();
    const matches = [] as Array<{ id: string; name: string; fullName: string; url: string }>;
    for (const repo of repos) {
      let value: any;
      try {
        value = await this.request<any>(`/repos/${repo}`, options?.signal);
      } catch (error) {
        if (error instanceof StepError && error.category === 'NOT_FOUND') continue;
        throw error;
      }
      if (value?.full_name !== repo || !Number.isSafeInteger(value.id) || typeof value.name !== 'string' || typeof value.html_url !== 'string') {
        continue;
      }
      if (`${value.full_name} ${value.name} ${value.description ?? ''}`.toLowerCase().includes(query)) {
        matches.push({ id: String(value.id), name: value.name, fullName: value.full_name, url: value.html_url });
      }
      if (matches.length >= max) break;
    }
    return matches;
  }

  async searchIssues(args: { repo: string; query: string; limit?: number }, options?: { signal?: AbortSignal; repo?: string }) {
    const repo = this.checkedRepo(args.repo, options?.repo);
    const rawQuery = text(args.query, 'query');
    const max = limit(args.limit);
    const { q, allowPullRequests } = buildIssueSearchQuery(repo, rawQuery);
    const params = new URLSearchParams({ q, per_page: String(max) });
    const value = await this.request<any>(`/search/issues?${params}`, options?.signal);
    const expectedUrl = `${this.apiBase}/repos/${repo}`;
    if (!Array.isArray(value?.items)) {
      throw new StepError({ message: 'GitHub returned an invalid search response', category: 'SERVER_ERROR', retryable: false });
    }
    return value.items
      .filter((item: any) => item?.repository_url === expectedUrl && (allowPullRequests || !item.pull_request))
      .slice(0, max)
      .map((item: any) => githubIssue(item, repo, false, allowPullRequests));
  }

  async getIssue(
    args: { repo: string; issueNumber: number; includePullRequest?: boolean },
    options?: { signal?: AbortSignal; repo?: string; allowPullRequests?: boolean; requirePullRequest?: boolean },
  ) {
    const repo = this.checkedRepo(args.repo, options?.repo);
    const number = issueNumber(args.issueNumber);
    const value = await this.request<any>(`/repos/${repo}/issues/${number}`, options?.signal);
    const allowPr = Boolean(args.includePullRequest || options?.allowPullRequests);
    const normalized = githubIssue(value, repo, false, allowPr);
    if (options?.requirePullRequest && !value?.pull_request) {
      validation('GitHub item is an issue, not a pull request');
    }
    return {
      ...normalized,
      body: typeof value.body === 'string' ? value.body : '',
      labels: Array.isArray(value.labels) ? value.labels.filter((label: any) => typeof label?.name === 'string').map((label: any) => label.name as string) : [],
      ...(allowPr ? { state: typeof value.state === 'string' ? value.state : 'open', isPullRequest: Boolean(value.pull_request) } : {}),
    };
  }

  async getPullRequest(args: { repo: string; issueNumber: number }, options?: { signal?: AbortSignal; repo?: string }) {
    return this.getIssue({ ...args, includePullRequest: true }, { ...options, allowPullRequests: true, requirePullRequest: true });
  }

  async createIssue(args: { repo: string; title: string; body?: string; labels?: string[]; assignees?: string[] }, options?: { signal?: AbortSignal; repo?: string }) {
    const repo = this.checkedRepo(args.repo, options?.repo);
    const title = text(args.title, 'title');
    if (args.body !== undefined && typeof args.body !== 'string') validation('GitHub body must be a string');
    if (args.labels !== undefined && (!Array.isArray(args.labels) || args.labels.some((label) => typeof label !== 'string' || !label.trim()))) {
      validation('GitHub labels must be non-empty strings');
    }
    const assignees = normalizeAssignees(args.assignees);
    const value = await this.request<any>(`/repos/${repo}/issues`, options?.signal, {
      title,
      ...(args.body !== undefined ? { body: args.body } : {}),
      ...(args.labels !== undefined ? { labels: args.labels } : {}),
      ...(assignees !== undefined ? { assignees } : {}),
    });
    return githubIssue(value, repo, true);
  }

  async updateIssue(
    args: {
      repo: string;
      issueNumber: number;
      title?: string;
      body?: string;
      state?: 'open' | 'closed';
      labels?: string[];
      assignees?: string[];
    },
    options?: { signal?: AbortSignal; repo?: string },
  ) {
    const repo = this.checkedRepo(args.repo, options?.repo);
    const number = issueNumber(args.issueNumber);
    const payload: Record<string, unknown> = {};
    if (args.title !== undefined) payload.title = text(args.title, 'title');
    if (args.body !== undefined) {
      if (typeof args.body !== 'string') validation('GitHub body must be a string');
      payload.body = args.body;
    }
    if (args.state !== undefined) {
      if (args.state !== 'open' && args.state !== 'closed') validation('GitHub state must be open or closed');
      payload.state = args.state;
    }
    if (args.labels !== undefined) {
      if (!Array.isArray(args.labels) || args.labels.some((label) => typeof label !== 'string' || !label.trim())) {
        validation('GitHub labels must be non-empty strings');
      }
      payload.labels = args.labels;
    }
    const assignees = normalizeAssignees(args.assignees);
    if (assignees !== undefined) payload.assignees = assignees;
    if (Object.keys(payload).length === 0) {
      validation('GitHub update_issue requires at least one field to update');
    }

    const value = await this.request<any>(`/repos/${repo}/issues/${number}`, options?.signal, payload, 'PATCH');
    const normalized = githubIssue(value, repo, true, true);
    return {
      ...normalized,
      state: typeof value.state === 'string' ? value.state : (args.state ?? 'open'),
      labels: Array.isArray(value.labels)
        ? value.labels.filter((label: any) => typeof label?.name === 'string').map((label: any) => label.name as string)
        : [],
      assignees: Array.isArray(value.assignees)
        ? value.assignees.filter((entry: any) => typeof entry?.login === 'string').map((entry: any) => entry.login as string)
        : [],
    };
  }

  async addComment(args: { repo: string; issueNumber: number; body: string }, options?: { signal?: AbortSignal; repo?: string }) {
    const repo = this.checkedRepo(args.repo, options?.repo);
    const number = issueNumber(args.issueNumber);
    const body = text(args.body, 'body');
    const value = await this.request<any>(`/repos/${repo}/issues/${number}/comments`, options?.signal, { body });
    if (!value || typeof value !== 'object' || !Number.isSafeInteger(value.id) || typeof value.html_url !== 'string') {
      throw new StepError({ message: 'GitHub comment write returned an invalid response', category: 'UNKNOWN', retryable: false });
    }
    return {
      id: String(value.id),
      issueNumber: number,
      body: typeof value.body === 'string' ? value.body : body,
      repo,
      url: value.html_url as string,
    };
  }

  async listIssues(
    args: { repo?: string; state?: 'open' | 'closed'; query?: string; limit?: number },
    options?: { signal?: AbortSignal; repo?: string },
  ) {
    const state = args.state ?? 'open';
    if (state !== 'open' && state !== 'closed') validation('GitHub state must be open or closed');
    const max = limit(args.limit);
    const rawQuery = args.query?.trim()
      ? `is:${state} ${args.query.trim()}`
      : `is:issue is:${state}`;

    if (args.repo !== undefined) {
      return this.searchIssues({ repo: args.repo, query: rawQuery, limit: max }, options);
    }

    const repos = this.allowedRepositories();
    const collected: Array<{ id: string; number: number; title: string; url: string; repo: string }> = [];
    for (const repo of repos) {
      const remaining = max - collected.length;
      if (remaining <= 0) break;
      const items = await this.searchIssues({ repo, query: rawQuery, limit: remaining }, options);
      collected.push(...items);
    }
    return collected.slice(0, max);
  }

  async listPullRequests(
    args: { repo?: string; state?: 'open' | 'closed' | 'all'; query?: string; limit?: number },
    options?: { signal?: AbortSignal; repo?: string },
  ) {
    const state = args.state ?? 'open';
    if (state !== 'open' && state !== 'closed' && state !== 'all') {
      validation('GitHub pull request state must be open, closed, or all');
    }
    const max = limit(args.limit);
    const queryLower = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
    const targetRepos =
      args.repo !== undefined ? [this.checkedRepo(args.repo, options?.repo)] : this.allowedRepositories();

    const collected: Array<{
      id: string;
      number: number;
      title: string;
      url: string;
      repo: string;
      state: string;
      author?: string;
      draft?: boolean;
    }> = [];

    for (const repo of targetRepos) {
      const remaining = max - collected.length;
      if (remaining <= 0) break;
      const params = new URLSearchParams({ state, per_page: String(Math.max(remaining, 10)) });
      const items = await this.request<any[]>(`/repos/${repo}/pulls?${params}`, options?.signal);
      if (!Array.isArray(items)) {
        throw new StepError({
          message: 'GitHub returned an invalid pull requests response',
          category: 'SERVER_ERROR',
          retryable: false,
        });
      }
      for (const item of items) {
        const normalized = githubIssue(item, repo, false, true);
        const prState = typeof item.state === 'string' ? item.state : state === 'all' ? 'open' : state;
        const author = typeof item.user?.login === 'string' ? item.user.login : undefined;
        if (queryLower) {
          const hay = `${normalized.title} ${item.body ?? ''} ${author ?? ''}`.toLowerCase();
          if (!hay.includes(queryLower)) continue;
        }
        collected.push({
          ...normalized,
          state: prState,
          ...(author ? { author } : {}),
          ...(typeof item.draft === 'boolean' ? { draft: item.draft } : {}),
        });
        if (collected.length >= max) break;
      }
    }
    return collected.slice(0, max);
  }

  async addLabel(args: { repo: string; issueNumber: number; label: string }, options?: { signal?: AbortSignal; repo?: string }) {
    const repo = this.checkedRepo(args.repo, options?.repo);
    const number = issueNumber(args.issueNumber);
    const label = text(args.label, 'label');
    const value = await this.request<any>(`/repos/${repo}/issues/${number}/labels`, options?.signal, { labels: [label] });
    if (!Array.isArray(value) || value.some((entry) => typeof entry?.name !== 'string')) {
      throw new StepError({ message: 'GitHub label write returned an invalid response', category: 'UNKNOWN', retryable: false });
    }
    const labels = value.map((entry: any) => entry.name as string);
    if (!labels.some((name) => name.toLowerCase() === label.toLowerCase())) {
      throw new StepError({ message: 'GitHub label write was not confirmed by the response', category: 'UNKNOWN', retryable: false });
    }
    return { number, labels, repo, url: `https://github.com/${repo}/issues/${number}` };
  }

  override async execute(toolName: string, args: Record<string, any>, context?: { signal?: AbortSignal; repo?: string }): Promise<any> {
    switch (toolName) {
      case 'github.search_repos': return this.searchRepos(args as any, context);
      case 'github.search_issues': return this.searchIssues(args as any, context);
      case 'github.list_issues': return this.listIssues(args as any, context);
      case 'github.list_pull_requests': return this.listPullRequests(args as any, context);
      case 'github.get_issue': return this.getIssue(args as any, context);
      case 'github.get_pull_request': return this.getPullRequest(args as any, context);
      case 'github.create_issue': return this.createIssue(args as any, context);
      case 'github.update_issue': return this.updateIssue(args as any, context);
      case 'github.add_comment': return this.addComment(args as any, context);
      case 'github.add_label': return this.addLabel(args as any, context);
      default: validation(`Tool '${toolName}' is not supported by GitHubAdapter`);
    }
  }
}
