import { JIRA_PROJECT_PATTERN, JIRA_ISSUE_PATTERN, JIRA_SITE_PATTERN } from '@wap/tool-schemas';
import { BaseAdapter, StepError, type BaseAdapterConfig, type ErrorCategory } from '../base-adapter.js';
import { GlobalRateLimiter, waitWithSignal } from '../rate-limiter.js';

export interface JiraAdapterConfig extends BaseAdapterConfig {
  credentials: { siteUrl: string; email: string; apiToken: string };
  fetchFn?: typeof fetch;
}
// Conservative process-local pacing; provider burst limits remain authoritative.
const sharedLimiter = new GlobalRateLimiter({ maxRequests: 5, windowMs: 1000 });
const fail = (category: ErrorCategory, statusCode?: number) => new StepError({ category, statusCode, retryable: false,
  message: category === 'UNKNOWN' ? 'Jira write outcome is unknown; verify before writing again.' : 'Jira request failed: ' + category });
const record = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, min: number, max: number): v is string => typeof v === 'string' && Array.from(v).length >= min && Array.from(v).length <= max;
const identifier = (v: unknown): v is string => typeof v === 'string' && /^\d+$/.test(v);
const adf = (value: string) => ({ version: 1, type: 'doc', content: value.split(/\r\n|\r|\n/).map(line => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })) });
export function validJiraCredentials(value: Record<string, unknown>): boolean {
  return typeof value.siteUrl === 'string' && value.siteUrl.trim() === value.siteUrl && JIRA_SITE_PATTERN.test(value.siteUrl) &&
    typeof value.email === 'string' && /^[^\s:@]+@[^\s:@]+$/.test(value.email) && typeof value.apiToken === 'string' && Boolean(value.apiToken.trim());
}

export class JiraAdapter extends BaseAdapter {
  readonly service = 'jira';
  private readonly site: string;
  private readonly authorization: string;
  private readonly fetchFn: typeof fetch;
  constructor(config: JiraAdapterConfig) {
    super(config); if (!validJiraCredentials(config.credentials)) throw fail('VALIDATION');
    this.site = config.credentials.siteUrl; this.authorization = 'Basic ' + Buffer.from(config.credentials.email + ':' + config.credentials.apiToken).toString('base64');
    this.fetchFn = config.fetchFn ?? fetch; this.rateLimiter = config.rateLimiter ?? sharedLimiter;
  }
  private scope(): string[] {
    const keys = this.allowedScope?.projects;
    if (!Array.isArray(keys) || !keys.length || !keys.every(key => typeof key === 'string' && JIRA_PROJECT_PATTERN.test(key))) throw fail('AUTH_ERROR', 403);
    return [...new Set(keys)];
  }
  private project(key: unknown): string {
    if (typeof key !== 'string' || !JIRA_PROJECT_PATTERN.test(key)) throw fail('VALIDATION');
    this.scope(); this.assertAllowedScope('projects', key); return key;
  }
  private input(args: unknown, keys: string[]): asserts args is Record<string, any> {
    if (!record(args) || Object.keys(args).some(key => !keys.includes(key))) throw fail('VALIDATION');
  }
  private limit(value: unknown, maximum: number): number {
    if (value === undefined) return maximum;
    if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > maximum) throw fail('VALIDATION'); return Number(value);
  }
  private identity(value: any, project: string, write = false): { id: string; key: string; url: string } {
    if (!record(value) || !identifier(value.id) || typeof value.key !== 'string' || !JIRA_ISSUE_PATTERN.test(value.key) || value.key.split('-')[0] !== project) throw fail(write ? 'UNKNOWN' : 'SERVER_ERROR');
    return { id: value.id, key: value.key, url: this.site + '/browse/' + value.key };
  }
  async checkConnection(signal?: AbortSignal): Promise<boolean> {
    const value = await this.request('/myself', false, signal);
    if (!record(value) || !text(value.accountId, 1, 255)) throw fail('SERVER_ERROR'); return true;
  }
  async execute(tool: string, args: Record<string, any>, context?: { signal?: AbortSignal }): Promise<any> {
    const signal = context?.signal;
    if (tool === 'jira.search_projects') {
      this.input(args, ['query', 'limit']); if (!text(args.query, 0, 2000)) throw fail('VALIDATION');
      const limit = this.limit(args.limit, 10); const results: Array<{ key: string; id: string; name: string }> = [];
      for (const key of this.scope()) {
        const value = await this.request('/project/' + key, false, signal);
        if (!record(value) || value.key !== key || !identifier(value.id) || !text(value.name, 1, 1000)) throw fail('SERVER_ERROR');
        if (!args.query.trim() || (value.name + ' ' + key).toLocaleLowerCase().includes(args.query.trim().toLocaleLowerCase())) results.push({ key, id: value.id, name: value.name });
        if (results.length >= limit) break;
      }
      return results;
    }
    if (tool === 'jira.search_issues') {
      this.input(args, ['projectKey', 'query', 'limit']); const key = this.project(args.projectKey); const limit = this.limit(args.limit, 20);
      if (args.query !== undefined && !text(args.query, 0, 2000)) throw fail('VALIDATION');
      // Strip Lucene metacharacters permitted by the card, then escape JQL string quotes/backslashes.
      const query = (args.query ?? '').replace(/[+\-&|!(){}\[\]^~*?:]/g, ' ').trim();
      const lucene = query.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const escaped = lucene.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const jql = 'project = "' + key + '"' + (query ? ' AND text ~ "' + escaped + '"' : '') + ' ORDER BY updated DESC';
      const value = await this.request('/search/jql', false, signal, 'POST', { jql, maxResults: limit, fields: ['summary', 'status', 'project'] });
      if (!record(value) || !Array.isArray(value.issues) || value.issues.length > limit) throw fail('SERVER_ERROR');
      return { issues: value.issues.map((issue: any) => {
        const identity = this.identity(issue, key);
        if (issue.fields?.project?.key !== key || !text(issue.fields?.summary, 1, 255) || !text(issue.fields?.status?.name, 1, 255)) throw fail('SERVER_ERROR');
        return { ...identity, title: issue.fields.summary, status: issue.fields.status.name };
      }) };
    }
    if (tool === 'jira.create_issue') {
      this.input(args, ['projectKey', 'summary', 'description', 'issueType']); const key = this.project(args.projectKey);
      if (!text(args.summary, 1, 255) || (args.description !== undefined && !text(args.description, 0, 4000)) || (args.issueType !== undefined && !text(args.issueType, 1, 255))) throw fail('VALIDATION');
      const types = await this.issueTypes(key, signal); const standard = types.filter(type => type.subtask === false);
      const selected = args.issueType !== undefined ? standard.find(type => type.name === args.issueType) : standard.find(type => type.name === 'Task') ?? standard[0];
      if (!selected) throw new StepError({ category: 'VALIDATION', message: 'Jira issueType must be a standard project type. Valid types: ' + standard.map(type => type.name).join(', ') });
      const value = await this.request('/issue', true, signal, 'POST', { fields: { project: { key }, summary: args.summary, issuetype: { id: selected.id }, ...(args.description !== undefined ? { description: adf(args.description) } : {}) } });
      return this.identity(value, key, true);
    }
    if (tool === 'jira.add_comment') {
      this.input(args, ['issueKey', 'body']);
      if (typeof args.issueKey !== 'string' || !JIRA_ISSUE_PATTERN.test(args.issueKey) || !text(args.body, 1, 4000)) throw fail('VALIDATION');
      this.project(args.issueKey.split('-')[0]);
      const issue = await this.request('/issue/' + args.issueKey + '?fields=project', false, signal);
      // Parent/key can change after a move: re-check the actual parent before write, use the current key.
      const key = this.project(issue?.fields?.project?.key); const identity = this.identity(issue, key);
      const value = await this.request('/issue/' + identity.key + '/comment', true, signal, 'POST', { body: adf(args.body) });
      if (!record(value) || !identifier(value.id)) throw fail('UNKNOWN');
      return { id: value.id, issueKey: identity.key, url: identity.url + '?focusedCommentId=' + value.id };
    }
    throw fail('VALIDATION');
  }
  private async issueTypes(key: string, signal?: AbortSignal): Promise<Array<{ id: string; name: string; subtask: boolean }>> {
    const types: Array<{ id: string; name: string; subtask: boolean }> = []; let start = 0;
    for (let page = 0; page < 10; page++) {
      const value = await this.request('/issue/createmeta/' + key + '/issuetypes?startAt=' + start + '&maxResults=50', false, signal);
      if (!record(value) || !Array.isArray(value.issueTypes) || !Number.isSafeInteger(value.total) || value.total < 0 || value.startAt !== start || value.issueTypes.length > 50) throw fail('SERVER_ERROR');
      for (const type of value.issueTypes) {
        if (!record(type) || !identifier(type.id) || !text(type.name, 1, 255) || typeof type.subtask !== 'boolean') throw fail('SERVER_ERROR');
        types.push({ id: type.id, name: type.name, subtask: type.subtask });
      }
      start += value.issueTypes.length;
      if (start >= value.total) return types;
      if (!value.issueTypes.length) throw fail('SERVER_ERROR');
    }
    throw fail('VALIDATION'); // Never pick a default from a truncated directory.
  }
  private async request(path: string, writing: boolean, signal?: AbortSignal, method = 'GET', body?: object): Promise<any> {
    let network = 0; let server = 0; let rate = 0;
    for (;;) {
      if (signal?.aborted) throw fail('NETWORK');
      try { await this.waitForTransportSlot(this.rateLimiter!, this.site + ':' + this.authorization, signal); }
      catch { throw fail(signal?.aborted ? 'NETWORK' : 'RATE_LIMIT'); }
      if (signal?.aborted) throw fail('NETWORK');
      let response: Response;
      try { response = await this.fetchFn(this.site + '/rest/api/3' + path, { method, signal, redirect: 'error', headers: { Accept: 'application/json', Authorization: this.authorization, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); }
      catch { if (!writing && !signal?.aborted && network++ < 2) continue; throw fail(writing ? 'UNKNOWN' : 'NETWORK'); }
      let value: any; try { value = await response.json(); } catch { if (response.ok) throw fail(writing ? 'UNKNOWN' : 'SERVER_ERROR'); }
      if (!response.ok && writing && record(value) && identifier(value.id)) throw fail('UNKNOWN', response.status);
      if (response.status === 429) {
        const raw = response.headers.get('Retry-After')?.trim();
        const delay = raw && /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) * 1000 : raw ? Date.parse(raw) - Date.now() : NaN;
        if (rate++ < 1 && Number.isFinite(delay) && delay >= 0 && delay <= 30000) {
          try { await waitWithSignal(delay, signal); } catch { throw fail('RATE_LIMIT', 429); } continue;
        }
        throw fail('RATE_LIMIT', 429);
      }
      if (response.status === 401 || response.status === 403) throw fail('AUTH_ERROR', response.status);
      if (response.status === 404) throw fail('NOT_FOUND', 404);
      if (response.status >= 500) { if (!writing && !signal?.aborted && server++ < 1) continue; throw fail(writing ? 'UNKNOWN' : 'SERVER_ERROR', response.status); }
      if (!response.ok) throw fail(response.status >= 400 ? 'VALIDATION' : writing ? 'UNKNOWN' : 'SERVER_ERROR', response.status);
      return value;
    }
  }
}
