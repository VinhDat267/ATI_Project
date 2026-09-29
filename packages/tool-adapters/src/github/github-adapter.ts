import { BaseAdapter, StepError } from '../base-adapter.js';
import { GlobalRateLimiter } from '../rate-limiter.js';
import type { BaseAdapterConfig } from '../base-adapter.js';

export interface GitHubAdapterConfig extends BaseAdapterConfig {
  credentials: { token: string };
  fetchFn?: typeof fetch;
}

const apiBase = 'https://api.github.com';
const sharedGitHubLimiter = new GlobalRateLimiter({ maxRequests: 5000, windowMs: 60 * 60 * 1000 });
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

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
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 100) {
    validation('GitHub limit must be an integer between 1 and 100');
  }
  return value;
}

function githubIssue(value: any, repo: string, writing: boolean) {
  if (!value || typeof value !== 'object' || !Number.isSafeInteger(value.id) ||
      !Number.isSafeInteger(value.number) || typeof value.title !== 'string' ||
      typeof value.html_url !== 'string') {
    throw new StepError({
      message: 'GitHub returned an invalid issue response',
      category: writing ? 'UNKNOWN' : 'SERVER_ERROR',
      retryable: false,
    });
  }
  if (value.pull_request) validation('GitHub returned a pull request where an issue was required');
  return { id: String(value.id), number: value.number as number, title: value.title as string, url: value.html_url as string, repo };
}

/** GitHub REST adapter. All endpoints are fixed and each target must be on the exact allowlist. */
export class GitHubAdapter extends BaseAdapter {
  public readonly service = 'github';
  private readonly token: string;
  private readonly fetchFn: typeof fetch;

  constructor(config: GitHubAdapterConfig) {
    super(config);
    this.token = text(config.credentials?.token, 'token');
    this.fetchFn = config.fetchFn ?? globalThis.fetch;
  }

  private allowedRepositories(): string[] {
    const repos = this.allowedScope?.repos;
    if (!Array.isArray(repos) || repos.length === 0 || repos.some((repo) => !validRepository(repo))) {
      throw new StepError({ message: 'GitHub requires an explicit repository allowlist', category: 'AUTH_ERROR', statusCode: 403, retryable: false });
    }
    return repos;
  }

  private checkedRepo(value: unknown): string {
    if (!validRepository(value)) validation('GitHub repo must be owner/repo');
    if (!this.allowedRepositories().includes(value)) {
      throw new StepError({ message: `GitHub repository '${value}' is outside allowed scope`, category: 'AUTH_ERROR', statusCode: 403, retryable: false });
    }
    return value;
  }

  private async request<T>(path: string, signal?: AbortSignal, body?: unknown): Promise<T> {
    const writing = body !== undefined;
    if (signal?.aborted) {
      throw new StepError({ message: 'GitHub request was cancelled before dispatch', category: 'NETWORK', retryable: false });
    }
    const limiter = this.rateLimiter ?? sharedGitHubLimiter;
    await this.waitForTransportSlot(limiter, this.service, signal);
    const init: RequestInit = {
      method: writing ? 'POST' : 'GET',
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
        response = await this.fetchFn(`${apiBase}${path}`, init);
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
    const query = text(args.query, 'query').toLowerCase();
    const max = limit(args.limit);
    const repos = this.allowedRepositories();
    const matches = [] as Array<{ id: string; name: string; fullName: string; url: string }>;
    for (const repo of repos) {
      const value = await this.request<any>(`/repos/${repo}`, options?.signal);
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

  async searchIssues(args: { repo: string; query: string; limit?: number }, options?: { signal?: AbortSignal }) {
    const repo = this.checkedRepo(args.repo);
    const query = text(args.query, 'query').replace(/["\\]/g, ' ');
    const max = limit(args.limit);
    const params = new URLSearchParams({ q: `repo:${repo} is:issue "${query}"`, per_page: String(max) });
    const value = await this.request<any>(`/search/issues?${params}`, options?.signal);
    const expectedUrl = `${apiBase}/repos/${repo}`;
    if (!Array.isArray(value?.items)) {
      throw new StepError({ message: 'GitHub returned an invalid search response', category: 'SERVER_ERROR', retryable: false });
    }
    return value.items
      .filter((item: any) => item?.repository_url === expectedUrl && !item.pull_request)
      .slice(0, max)
      .map((item: any) => githubIssue(item, repo, false));
  }

  async getIssue(args: { repo: string; issueNumber: number }, options?: { signal?: AbortSignal }) {
    const repo = this.checkedRepo(args.repo);
    const number = issueNumber(args.issueNumber);
    const value = await this.request<any>(`/repos/${repo}/issues/${number}`, options?.signal);
    const normalized = githubIssue(value, repo, false);
    return {
      ...normalized,
      body: typeof value.body === 'string' ? value.body : '',
      labels: Array.isArray(value.labels) ? value.labels.filter((label: any) => typeof label?.name === 'string').map((label: any) => label.name as string) : [],
    };
  }

  async createIssue(args: { repo: string; title: string; body?: string; labels?: string[] }, options?: { signal?: AbortSignal }) {
    const repo = this.checkedRepo(args.repo);
    const title = text(args.title, 'title');
    if (args.body !== undefined && typeof args.body !== 'string') validation('GitHub body must be a string');
    if (args.labels !== undefined && (!Array.isArray(args.labels) || args.labels.some((label) => typeof label !== 'string' || !label.trim()))) {
      validation('GitHub labels must be non-empty strings');
    }
    const value = await this.request<any>(`/repos/${repo}/issues`, options?.signal, {
      title,
      ...(args.body !== undefined ? { body: args.body } : {}),
      ...(args.labels !== undefined ? { labels: args.labels } : {}),
    });
    return githubIssue(value, repo, true);
  }

  async addLabel(args: { repo: string; issueNumber: number; label: string }, options?: { signal?: AbortSignal }) {
    const repo = this.checkedRepo(args.repo);
    const number = issueNumber(args.issueNumber);
    const label = text(args.label, 'label');
    const value = await this.request<any>(`/repos/${repo}/issues/${number}/labels`, options?.signal, { labels: [label] });
    if (!Array.isArray(value) || value.some((entry) => typeof entry?.name !== 'string')) {
      throw new StepError({ message: 'GitHub label write returned an invalid response', category: 'UNKNOWN', retryable: false });
    }
    return { number, labels: value.map((entry: any) => entry.name as string), repo, url: `https://github.com/${repo}/issues/${number}` };
  }

  override async execute(toolName: string, args: Record<string, any>, context?: { signal?: AbortSignal }): Promise<any> {
    switch (toolName) {
      case 'github.search_repos': return this.searchRepos(args as any, context);
      case 'github.search_issues': return this.searchIssues(args as any, context);
      case 'github.get_issue': return this.getIssue(args as any, context);
      case 'github.create_issue': return this.createIssue(args as any, context);
      case 'github.add_label': return this.addLabel(args as any, context);
      default: validation(`Tool '${toolName}' is not supported by GitHubAdapter`);
    }
  }
}
