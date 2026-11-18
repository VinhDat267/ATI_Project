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
const SAFE_QUALIFIER_RE = /^(?:-?is:(?:open|closed|issue|pr|merged|unmerged|draft)|no:(?:assignee|label|milestone|review)|review:(?:none|required|approved|changes_requested)|draft:(?:true|false)|-?label:[A-Za-z0-9_.-]+|assignee:[A-Za-z0-9_-]+|author:[A-Za-z0-9_-]+|involves:[A-Za-z0-9_-]+|mentions:[A-Za-z0-9_-]+|head:[A-Za-z0-9_./-]+|base:[A-Za-z0-9_./-]+|(?:created|updated|closed|merged):(?:>=|<=|>|<)\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}Z)?)$/i;

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

  const rawTokens = trimmed.match(/"[^"]*"|\S+/g) ?? [];
  const qualifiers: string[] = [];
  const keywords: string[] = [];

  for (const token of rawTokens) {
    if (token.startsWith('"') && token.endsWith('"') && token.length >= 2) {
      const inner = token.slice(1, -1).replace(/["\\:]/g, ' ').replace(/\s+/g, ' ').trim();
      if (inner) keywords.push(`"${inner}"`);
      continue;
    }
    if (SAFE_QUALIFIER_RE.test(token)) {
      qualifiers.push(token);
    } else {
      // Neutralize unwhitelisted search qualifiers (e.g. repo:, org:) before joining as plain keywords.
      const cleaned = token.replace(/["\\:]/g, ' ').replace(/\s+/g, ' ').trim();
      if (cleaned) keywords.push(cleaned);
    }
  }

  const hasIsPr = qualifiers.some((q) => q.toLowerCase() === 'is:pr' || q.toLowerCase() === 'is:merged' || q.toLowerCase() === 'is:unmerged');
  const hasIsIssue = qualifiers.some((q) => q.toLowerCase() === 'is:issue');
  const typePrefix = hasIsPr || hasIsIssue ? [] : ['is:issue'];
  const keywordPart = keywords.length > 0 ? [keywords.join(' ')] : [];
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
  throw new StepError({ message, category: 'VALIDATION', retryable: false, details: { requestSent: false } });
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

function limit(value: unknown, maxLimit = 10): number {
  if (value === undefined) return 10;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maxLimit) {
    validation(`GitHub limit must be an integer between 1 and ${maxLimit}`);
  }
  return value;
}

function normalizeLogins(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) validation(`GitHub ${field} must be an array of strings`);
  return value.map((item) => {
    if (typeof item !== 'string') validation(`GitHub ${field} must be non-empty strings`);
    const cleaned = item.trim().replace(/^@+/, '');
    if (!cleaned) validation(`GitHub ${field} must be non-empty strings`);
    return cleaned;
  });
}

function refName(value: unknown, field: string): string {
  const cleaned = text(value, field);
  if (/[\s\u0000-\u001f\u007f]/.test(cleaned) || cleaned.includes('..') || cleaned.startsWith('/')) {
    validation(`GitHub ${field} must be a valid branch reference`);
  }
  return cleaned;
}

function isoTimestamp(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
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
  const createdAt =
    typeof value.created_at === 'string' && value.created_at.trim()
      ? value.created_at.trim()
      : typeof value.createdAt === 'string' && value.createdAt.trim()
        ? value.createdAt.trim()
        : undefined;
  const updatedAt =
    typeof value.updated_at === 'string' && value.updated_at.trim()
      ? value.updated_at.trim()
      : typeof value.updatedAt === 'string' && value.updatedAt.trim()
        ? value.updatedAt.trim()
        : undefined;
  const state =
    typeof value.state === 'string' && value.state.trim()
      ? value.state.trim()
      : undefined;
  const author =
    typeof value.user?.login === 'string' && value.user.login.trim()
      ? value.user.login.trim()
      : undefined;
  const assignees = Array.isArray(value.assignees)
    ? value.assignees
        .filter((entry: any) => typeof entry?.login === 'string' && entry.login.trim())
        .map((entry: any) => entry.login.trim() as string)
    : undefined;
  const commentsCount = Number.isSafeInteger(value.comments) ? (value.comments as number) : undefined;
  return {
    id: String(value.id),
    number: value.number as number,
    title: value.title as string,
    url: value.html_url as string,
    repo,
    ...(state ? { state } : {}),
    ...(author ? { author } : {}),
    ...(assignees ? { assignees } : {}),
    ...(commentsCount !== undefined ? { commentsCount } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
  };
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
      throw new StepError({
        message: 'GitHub requires an explicit repository allowlist',
        category: 'AUTH_ERROR',
        statusCode: 403,
        retryable: false,
        details: { requestSent: false },
      });
    }
    return repos;
  }

  private checkedRepo(value: unknown, contextRepo?: unknown): string {
    const repos = this.allowedRepositories();
    let matchedContext: string | undefined;
    if (contextRepo !== undefined && contextRepo !== null) {
      if (!validRepository(contextRepo)) validation('GitHub repo must be owner/repo');
      matchedContext = repos.find((repo) => repo.toLowerCase() === contextRepo.toLowerCase());
      if (!matchedContext) {
        throw new StepError({
          message: `GitHub repository '${contextRepo}' is outside allowed scope`,
          category: 'AUTH_ERROR',
          statusCode: 403,
          retryable: false,
          details: { requestSent: false },
        });
      }
    }
    if (!validRepository(value)) validation('GitHub repo must be owner/repo');
    const matched = repos.find((repo) => repo.toLowerCase() === value.toLowerCase());
    if (!matched) {
      throw new StepError({
        message: `GitHub repository '${value}' is outside allowed scope`,
        category: 'AUTH_ERROR',
        statusCode: 403,
        retryable: false,
        details: { requestSent: false },
      });
    }
    if (matchedContext && matchedContext.toLowerCase() !== matched.toLowerCase()) {
      throw new StepError({
        message: `GitHub repository '${matched}' does not match bound context repository '${matchedContext}'`,
        category: 'AUTH_ERROR',
        statusCode: 403,
        retryable: false,
        details: { requestSent: false },
      });
    }
    return matched;
  }

  private async request<T>(path: string, signal?: AbortSignal, body?: unknown, method?: 'GET' | 'POST' | 'PATCH' | 'PUT'): Promise<T> {
    const writing = body !== undefined;
    if (signal?.aborted) {
      throw new StepError({
        message: 'GitHub request was cancelled before dispatch',
        category: 'NETWORK',
        retryable: false,
        details: { requestSent: false },
      });
    }
    const limiter = this.rateLimiter ?? sharedGitHubLimiter;
    try {
      await this.waitForTransportSlot(limiter, this.service, signal);
    } catch (cause) {
      if (cause instanceof StepError) {
        throw new StepError({
          message: cause.message,
          category: signal?.aborted ? 'NETWORK' : cause.category,
          statusCode: cause.statusCode,
          retryable: cause.retryable,
          details: {
            ...(cause.details && typeof cause.details === 'object' ? cause.details : {}),
            requestSent: false,
          },
          cause: cause.cause ?? cause,
        });
      }
      throw new StepError({
        message: 'GitHub request was cancelled before dispatch',
        category: 'NETWORK',
        retryable: false,
        cause,
        details: { requestSent: false },
      });
    }
    if (signal?.aborted) {
      throw new StepError({
        message: 'GitHub request was cancelled before dispatch',
        category: 'NETWORK',
        retryable: false,
        details: { requestSent: false },
      });
    }
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
          category: writing ? 'UNKNOWN' : 'NETWORK',
          retryable: !writing,
          cause,
          ...(!writing ? { details: { requestSent: false } } : {}),
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
        throw new StepError({
          message: 'GitHub rate limit exceeded',
          category: 'RATE_LIMIT',
          statusCode: response.status,
          retryable: !writing,
          ...(!writing ? { details: { requestSent: false } } : {}),
        });
      }
      break;
    }
    if (!response.ok) {
      const status = response.status;
      const category = status === 401 || status === 403 ? 'AUTH_ERROR'
        : status === 404 ? 'NOT_FOUND'
        : status === 400 || status === 422 ? 'VALIDATION'
        : writing ? 'UNKNOWN' : 'SERVER_ERROR';
      throw new StepError({
        message: `GitHub request failed with HTTP ${status}`,
        category,
        statusCode: status,
        retryable: !writing && status >= 500,
        ...(!writing ? { details: { requestSent: false } } : {}),
      });
    }
    try {
      return await response.json() as T;
    } catch (cause) {
      throw new StepError({
        message: writing ? 'GitHub write result is unknown after an unreadable response' : 'GitHub returned an unreadable response',
        category: writing ? 'UNKNOWN' : 'SERVER_ERROR',
        retryable: false,
        cause,
        ...(!writing ? { details: { requestSent: false } } : {}),
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
      if (typeof value?.full_name !== 'string' || value.full_name.toLowerCase() !== repo.toLowerCase() || !Number.isSafeInteger(value.id) || typeof value.name !== 'string' || typeof value.html_url !== 'string') {
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
    const max = limit(args.limit, 50);
    const { q, allowPullRequests } = buildIssueSearchQuery(repo, rawQuery);
    const params = new URLSearchParams({ q, per_page: String(max) });
    const value = await this.request<any>(`/search/issues?${params}`, options?.signal);
    const expectedUrl = `${this.apiBase}/repos/${repo}`.toLowerCase();
    if (!Array.isArray(value?.items)) {
      throw new StepError({ message: 'GitHub returned an invalid search response', category: 'SERVER_ERROR', retryable: false });
    }
    return value.items
      .filter((item: any) => typeof item?.repository_url === 'string' && item.repository_url.toLowerCase() === expectedUrl && (allowPullRequests || !item.pull_request))
      .slice(0, max)
      .map((item: any) => githubIssue(item, repo, false, allowPullRequests));
  }

  async getIssue(
    args: { repo: string; issueNumber: number; includePullRequest?: boolean },
    options?: { signal?: AbortSignal; repo?: string; allowPullRequests?: boolean },
  ) {
    const repo = this.checkedRepo(args.repo, options?.repo);
    const number = issueNumber(args.issueNumber);
    const value = await this.request<any>(`/repos/${repo}/issues/${number}`, options?.signal);
    const allowPr = Boolean(args.includePullRequest || options?.allowPullRequests);
    return this.normalizeIssueDetails(value, repo, allowPr, Boolean(value?.pull_request));
  }

  async getPullRequest(args: { repo: string; issueNumber: number }, options?: { signal?: AbortSignal; repo?: string }) {
    const repo = this.checkedRepo(args.repo, options?.repo);
    const number = issueNumber(args.issueNumber);
    const value = await this.request<any>(`/repos/${repo}/pulls/${number}`, options?.signal);
    return this.normalizeIssueDetails(value, repo, true, true);
  }

  private normalizeIssueDetails(value: any, repo: string, allowPr: boolean, isPullRequest: boolean) {
    const normalized = githubIssue(value, repo, false, allowPr);
    const author = typeof value.user?.login === 'string' && value.user.login.trim() ? value.user.login.trim() : undefined;
    const assignees = Array.isArray(value.assignees)
      ? value.assignees.filter((entry: any) => typeof entry?.login === 'string').map((entry: any) => entry.login as string)
      : undefined;
    const commentsCount = Number.isSafeInteger(value.comments) ? (value.comments as number) : undefined;
    const requestedReviewers = allowPr && Array.isArray(value.requested_reviewers)
      ? value.requested_reviewers.filter((entry: any) => typeof entry?.login === 'string').map((entry: any) => entry.login as string)
      : undefined;
    const headRef = allowPr && typeof value.head?.ref === 'string' ? value.head.ref : undefined;
    const baseRef = allowPr && typeof value.base?.ref === 'string' ? value.base.ref : undefined;

    return {
      ...normalized,
      body: typeof value.body === 'string' ? value.body : '',
      labels: Array.isArray(value.labels) ? value.labels.filter((label: any) => typeof label?.name === 'string').map((label: any) => label.name as string) : [],
      ...(allowPr
        ? {
            state: typeof value.state === 'string' ? value.state : 'open',
            isPullRequest,
            ...(typeof value.draft === 'boolean' ? { draft: value.draft } : {}),
            ...(typeof value.merged === 'boolean' ? { merged: value.merged } : {}),
            ...(headRef ? { headRef } : {}),
            ...(baseRef ? { baseRef } : {}),
            ...(requestedReviewers ? { requestedReviewers } : {}),
          }
        : {
            ...(typeof value.state === 'string' && value.state.trim() ? { state: value.state.trim() } : {}),
          }),
      ...(author ? { author } : {}),
      ...(assignees ? { assignees } : {}),
      ...(commentsCount !== undefined ? { commentsCount } : {}),
    };
  }

  async createIssue(args: { repo: string; title: string; body?: string; labels?: string[]; assignees?: string[] }, options?: { signal?: AbortSignal; repo?: string }) {
    const repo = this.checkedRepo(args.repo, options?.repo);
    const title = text(args.title, 'title');
    if (args.body !== undefined && typeof args.body !== 'string') validation('GitHub body must be a string');
    if (args.labels !== undefined && (!Array.isArray(args.labels) || args.labels.some((label) => typeof label !== 'string' || !label.trim()))) {
      validation('GitHub labels must be non-empty strings');
    }
    const assignees = normalizeLogins(args.assignees, 'assignees');
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
    const assignees = normalizeLogins(args.assignees, 'assignees');
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

  async listComments(
    args: { repo: string; issueNumber: number; limit?: number },
    options?: { signal?: AbortSignal; repo?: string },
  ) {
    const repo = this.checkedRepo(args.repo, options?.repo);
    const number = issueNumber(args.issueNumber);
    const max = limit(args.limit, 50);
    const params = new URLSearchParams({ per_page: String(max) });
    const items = await this.request<any[]>(`/repos/${repo}/issues/${number}/comments?${params}`, options?.signal);
    if (!Array.isArray(items)) {
      throw new StepError({
        message: 'GitHub returned an invalid comments response',
        category: 'SERVER_ERROR',
        retryable: false,
      });
    }
    return items.slice(0, max).map((item: any) => {
      if (!item || typeof item !== 'object' || !Number.isSafeInteger(item.id) || typeof item.html_url !== 'string') {
        throw new StepError({
          message: 'GitHub returned an invalid comment item',
          category: 'SERVER_ERROR',
          retryable: false,
        });
      }
      const author =
        typeof item.user?.login === 'string' && item.user.login.trim()
          ? item.user.login.trim()
          : 'unknown';
      const createdAt = isoTimestamp(item.created_at);
      const updatedAt = isoTimestamp(item.updated_at);
      return {
        id: String(item.id),
        issueNumber: number,
        author,
        body: typeof item.body === 'string' ? item.body : '',
        url: item.html_url as string,
        repo,
        ...(createdAt ? { createdAt } : {}),
        ...(updatedAt ? { updatedAt } : {}),
      };
    });
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

  async createPullRequest(
    args: { repo: string; title: string; head: string; base: string; body?: string; draft?: boolean },
    options?: { signal?: AbortSignal; repo?: string },
  ) {
    const repo = this.checkedRepo(args.repo, options?.repo);
    const title = text(args.title, 'title');
    const head = refName(args.head, 'head');
    const base = refName(args.base, 'base');
    if (head === base) validation('GitHub head and base branch must differ');
    if (args.body !== undefined && typeof args.body !== 'string') validation('GitHub body must be a string');
    if (args.draft !== undefined && typeof args.draft !== 'boolean') validation('GitHub draft must be a boolean');
    const value = await this.request<any>(`/repos/${repo}/pulls`, options?.signal, {
      title,
      head,
      base,
      ...(args.body !== undefined ? { body: args.body } : {}),
      ...(args.draft !== undefined ? { draft: args.draft } : {}),
    });
    const normalized = githubIssue(value, repo, true, true);
    const headRef = typeof value.head?.ref === 'string' ? value.head.ref : head;
    const baseRef = typeof value.base?.ref === 'string' ? value.base.ref : base;
    return {
      ...normalized,
      state: typeof value.state === 'string' ? value.state : 'open',
      ...(typeof value.draft === 'boolean' ? { draft: value.draft } : {}),
      headRef,
      baseRef,
    };
  }

  async requestReviewers(
    args: { repo: string; issueNumber: number; reviewers: string[] },
    options?: { signal?: AbortSignal; repo?: string },
  ) {
    const repo = this.checkedRepo(args.repo, options?.repo);
    const number = issueNumber(args.issueNumber);
    const reviewers = normalizeLogins(args.reviewers, 'reviewers');
    if (!reviewers || reviewers.length === 0 || reviewers.length > 10) {
      validation('GitHub request_reviewers requires 1 to 10 reviewers');
    }
    const value = await this.request<any>(
      `/repos/${repo}/pulls/${number}/requested_reviewers`,
      options?.signal,
      { reviewers },
    );
    if (!value || typeof value !== 'object' || !Array.isArray(value.requested_reviewers)) {
      throw new StepError({
        message: 'GitHub reviewer request returned an invalid response',
        category: 'UNKNOWN',
        retryable: false,
      });
    }
    const acknowledged: string[] = value.requested_reviewers
      .filter((entry: any) => typeof entry?.login === 'string')
      .map((entry: any) => entry.login as string);
    if (
      reviewers.some(
        (requested) => !acknowledged.some((login) => login.toLowerCase() === requested.toLowerCase()),
      )
    ) {
      throw new StepError({
        message: 'GitHub reviewer request was not confirmed by the response',
        category: 'UNKNOWN',
        retryable: false,
      });
    }
    return {
      number,
      reviewers: acknowledged,
      repo,
      url: typeof value.html_url === 'string' ? value.html_url : `https://github.com/${repo}/pull/${number}`,
    };
  }

  async listIssues(
    args: { repo?: string; state?: 'open' | 'closed'; query?: string; limit?: number },
    options?: { signal?: AbortSignal; repo?: string },
  ) {
    const state = args.state ?? 'open';
    if (state !== 'open' && state !== 'closed') validation('GitHub state must be open or closed');
    const max = limit(args.limit, 50);
    const rawQuery = args.query?.trim()
      ? `is:${state} ${args.query.trim()}`
      : `is:issue is:${state}`;

    if (args.repo !== undefined) {
      return this.searchIssues({ repo: args.repo, query: rawQuery, limit: max }, options);
    }

    const repos =
      options?.repo !== undefined
        ? [this.checkedRepo(options.repo, options.repo)]
        : this.allowedRepositories();
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
    const max = limit(args.limit, 50);
    const queryLower = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
    const targetRepos =
      args.repo !== undefined
        ? [this.checkedRepo(args.repo, options?.repo)]
        : options?.repo !== undefined
          ? [this.checkedRepo(options.repo, options.repo)]
          : this.allowedRepositories();

    const collected: Array<{
      id: string;
      number: number;
      title: string;
      url: string;
      repo: string;
      state: string;
      author?: string;
      draft?: boolean;
      labels?: string[];
      assignees?: string[];
      requestedReviewers?: string[];
      headRef?: string;
      baseRef?: string;
    }> = [];

    for (const repo of targetRepos) {
      const remaining = max - collected.length;
      if (remaining <= 0) break;
      const perPage = Math.min(Math.max(remaining, queryLower ? 30 : 10), 50);
      const params = new URLSearchParams({ state, per_page: String(perPage) });
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
        const labels = Array.isArray(item.labels)
          ? item.labels.filter((label: any) => typeof label?.name === 'string').map((label: any) => label.name as string)
          : undefined;
        const assignees = Array.isArray(item.assignees)
          ? item.assignees.filter((entry: any) => typeof entry?.login === 'string').map((entry: any) => entry.login as string)
          : undefined;
        const requestedReviewers = Array.isArray(item.requested_reviewers)
          ? item.requested_reviewers.filter((entry: any) => typeof entry?.login === 'string').map((entry: any) => entry.login as string)
          : undefined;
        const headRef = typeof item.head?.ref === 'string' ? item.head.ref : undefined;
        const baseRef = typeof item.base?.ref === 'string' ? item.base.ref : undefined;
        if (queryLower) {
          const hay = `${normalized.title} ${item.body ?? ''} ${author ?? ''} ${headRef ?? ''} ${baseRef ?? ''}`.toLowerCase();
          if (!hay.includes(queryLower)) continue;
        }
        collected.push({
          ...normalized,
          state: prState,
          ...(author ? { author } : {}),
          ...(typeof item.draft === 'boolean' ? { draft: item.draft } : {}),
          ...(labels ? { labels } : {}),
          ...(assignees ? { assignees } : {}),
          ...(requestedReviewers ? { requestedReviewers } : {}),
          ...(headRef ? { headRef } : {}),
          ...(baseRef ? { baseRef } : {}),
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
      case 'github.list_comments': return this.listComments(args as any, context);
      case 'github.create_issue': return this.createIssue(args as any, context);
      case 'github.update_issue': return this.updateIssue(args as any, context);
      case 'github.add_comment': return this.addComment(args as any, context);
      case 'github.create_pull_request': return this.createPullRequest(args as any, context);
      case 'github.request_reviewers': return this.requestReviewers(args as any, context);
      case 'github.add_label': return this.addLabel(args as any, context);
      default: validation(`Tool '${toolName}' is not supported by GitHubAdapter`);
    }
  }
}
