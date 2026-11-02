import {
  JIRA_PROJECT_PATTERN,
  JIRA_ISSUE_PATTERN,
  JIRA_SITE_ID_PATTERN,
  JIRA_CLOUD_ID_PATTERN,
  type WorkspaceJiraCapabilitiesResponse,
} from '@wap/tool-schemas';
import { BaseAdapter, StepError, type BaseAdapterConfig } from '../base-adapter.js';
import { GlobalRateLimiter } from '../rate-limiter.js';
import {
  PersonalJiraHttpTransport,
  type JiraAccessTokenProvider,
  createJiraStepError,
} from './personal-jira-http.js';

export interface PersonalJiraAdapterConfig extends BaseAdapterConfig {
  userId: string;
  workspaceId: string;
  capabilities: WorkspaceJiraCapabilitiesResponse;
  tokens: JiraAccessTokenProvider;
  apiBaseUrl?: string;
  fetchFn?: typeof fetch;
  rateLimiter?: GlobalRateLimiter;
  timeoutMs?: number;
}

interface ScopedProject {
  id: string;
  key: string;
  name: string;
}

interface ScopedSite {
  siteId: string;
  cloudId: string;
  name: string;
  url: string;
  projects: Map<string, ScopedProject>;
}

const sharedLimiter = new GlobalRateLimiter({ maxRequests: 5, windowMs: 1000 });

const fail = (category: Parameters<typeof createJiraStepError>[0], statusCode?: number, customMessage?: string) =>
  createJiraStepError(category, statusCode, customMessage);

const record = (v: unknown): v is Record<string, any> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const text = (v: unknown, min: number, max: number): v is string =>
  typeof v === 'string' && Array.from(v).length >= min && Array.from(v).length <= max;

const identifier = (v: unknown): v is string =>
  typeof v === 'string' && /^\d+$/.test(v);

export function plainTextToAdf(value: string): { version: number; type: string; content: any[] } {
  return {
    version: 1,
    type: 'doc',
    content: value.split(/\r\n|\r|\n/).map((line) => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line }] : [],
    })),
  };
}

export class PersonalJiraAdapter extends BaseAdapter {
  readonly service = 'myjira';
  private readonly userId: string;
  private readonly workspaceId: string;
  private readonly sitesBySiteId = new Map<string, ScopedSite>();
  private readonly transport: PersonalJiraHttpTransport;

  constructor(config: PersonalJiraAdapterConfig) {
    super(config ?? ({} as any));

    if (!config || typeof config !== 'object') {
      throw fail('VALIDATION', undefined, 'PersonalJiraAdapterConfig must be an object');
    }
    if (typeof config.userId !== 'string' || !config.userId.trim()) {
      throw fail('VALIDATION', undefined, 'PersonalJiraAdapter requires a valid userId');
    }
    if (typeof config.workspaceId !== 'string' || !config.workspaceId.trim()) {
      throw fail('VALIDATION', undefined, 'PersonalJiraAdapter requires a valid workspaceId');
    }
    if (
      !config.capabilities ||
      typeof config.capabilities !== 'object' ||
      !Array.isArray(config.capabilities.sites)
    ) {
      throw fail('VALIDATION', undefined, 'PersonalJiraAdapter requires a valid capabilities snapshot');
    }
    if (typeof config.capabilities.workspaceId !== 'string' || config.capabilities.workspaceId !== config.workspaceId) {
      throw fail('AUTH_ERROR', 403, 'Capabilities workspace mismatch');
    }
    if (!config.tokens || typeof config.tokens.getAccessToken !== 'function') {
      throw fail('VALIDATION', undefined, 'PersonalJiraAdapter requires a tokens provider');
    }

    this.userId = config.userId;
    this.workspaceId = config.workspaceId;
    this.rateLimiter = config.rateLimiter ?? sharedLimiter;

    this.transport = new PersonalJiraHttpTransport({
      apiBaseUrl: config.apiBaseUrl,
      userId: this.userId,
      tokens: config.tokens,
      fetchFn: config.fetchFn,
      rateLimiter: this.rateLimiter,
      timeoutMs: config.timeoutMs,
    });

    for (const site of config.capabilities.sites) {
      if (!site || typeof site !== 'object') continue;
      if (typeof site.siteId !== 'string' || !JIRA_SITE_ID_PATTERN.test(site.siteId)) continue;
      if (typeof site.cloudId !== 'string' || !JIRA_CLOUD_ID_PATTERN.test(site.cloudId)) continue;

      const projects = new Map<string, ScopedProject>();
      if (Array.isArray(site.projects)) {
        for (const proj of site.projects) {
          if (!proj || typeof proj !== 'object') continue;
          if (typeof proj.key === 'string' && JIRA_PROJECT_PATTERN.test(proj.key)) {
            projects.set(proj.key, {
              id: String(proj.id ?? ''),
              key: proj.key,
              name: String(proj.name ?? proj.key),
            });
          }
        }
      }

      this.sitesBySiteId.set(site.siteId, {
        siteId: site.siteId,
        cloudId: site.cloudId,
        name: String(site.name ?? site.siteId),
        url: String(site.url ?? '').replace(/\/+$/, ''),
        projects,
      });
    }
  }

  private resolveSite(siteId: unknown): ScopedSite {
    if (typeof siteId !== 'string' || !JIRA_SITE_ID_PATTERN.test(siteId)) {
      throw fail('VALIDATION');
    }
    const site = this.sitesBySiteId.get(siteId);
    if (!site) {
      throw fail('AUTH_ERROR', 403);
    }
    this.assertAllowedScope('sites', site.siteId);
    return site;
  }

  private resolveProject(site: ScopedSite, projectKey: unknown): ScopedProject {
    if (typeof projectKey !== 'string' || !JIRA_PROJECT_PATTERN.test(projectKey)) {
      throw fail('VALIDATION');
    }
    const project = site.projects.get(projectKey);
    if (!project) {
      throw fail('AUTH_ERROR', 403);
    }
    this.assertAllowedScope('projects', project.key);
    return project;
  }

  private input(args: unknown, required: string[], optional: string[] = []): asserts args is Record<string, any> {
    if (!record(args)) throw fail('VALIDATION');
    const allowed = new Set([...required, ...optional]);
    for (const key of Object.keys(args)) {
      if (!allowed.has(key)) throw fail('VALIDATION');
    }
    for (const key of required) {
      if (args[key] === undefined) throw fail('VALIDATION');
    }
  }

  private limit(value: unknown, maximum: number): number {
    if (value === undefined) return maximum;
    if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > maximum) {
      throw fail('VALIDATION');
    }
    return Number(value);
  }

  private identity(
    value: any,
    site: ScopedSite,
    projectKey: string,
    write = false
  ): { id: string; key: string; url: string } {
    if (
      !record(value) ||
      !identifier(value.id) ||
      typeof value.key !== 'string' ||
      !JIRA_ISSUE_PATTERN.test(value.key) ||
      value.key.split('-')[0] !== projectKey
    ) {
      throw fail(write ? 'UNKNOWN' : 'SERVER_ERROR');
    }
    return {
      id: value.id,
      key: value.key,
      url: site.url + '/browse/' + value.key,
    };
  }

  private issueRow(
    issue: any,
    site: ScopedSite,
    projectKey: string
  ): { siteId: string; id: string; key: string; url: string; title: string; status: string } {
    const idn = this.identity(issue, site, projectKey);
    if (
      issue.fields?.project?.key !== projectKey ||
      !text(issue.fields?.summary, 1, 255) ||
      !text(issue.fields?.status?.name, 1, 255)
    ) {
      throw fail('SERVER_ERROR');
    }
    return {
      siteId: site.siteId,
      id: idn.id,
      key: idn.key,
      url: idn.url,
      title: issue.fields.summary,
      status: issue.fields.status.name,
    };
  }

  private async issueByKey(
    site: ScopedSite,
    issueKey: string,
    projectKey: string,
    options?: { signal?: AbortSignal; timeoutMs?: number } | AbortSignal
  ) {
    const opts = options instanceof AbortSignal ? { signal: options } : options;
    let value: any;
    try {
      value = await this.transport.request(
        site.cloudId,
        '/issue/' + issueKey + '?fields=summary,status,project',
        false,
        opts
      );
    } catch (error) {
      if (error instanceof StepError && error.category === 'NOT_FOUND') return null;
      throw error;
    }
    if (!record(value) || !record(value.fields?.project)) throw fail('SERVER_ERROR');
    return value.fields.project.key === projectKey ? this.issueRow(value, site, projectKey) : null;
  }

  private async issueTypes(
    cloudId: string,
    projectKey: string,
    options?: { signal?: AbortSignal; timeoutMs?: number } | AbortSignal
  ): Promise<Array<{ id: string; name: string; subtask: boolean }>> {
    const opts = options instanceof AbortSignal ? { signal: options } : options;
    const types: Array<{ id: string; name: string; subtask: boolean }> = [];
    let start = 0;
    for (let page = 0; page < 10; page++) {
      const value = await this.transport.request(
        cloudId,
        '/issue/createmeta/' + projectKey + '/issuetypes?startAt=' + start + '&maxResults=50',
        false,
        opts
      );
      if (
        !record(value) ||
        !Array.isArray(value.issueTypes) ||
        !Number.isSafeInteger(value.total) ||
        value.total < 0 ||
        value.startAt !== start ||
        value.issueTypes.length > 50
      ) {
        throw fail('SERVER_ERROR');
      }
      for (const type of value.issueTypes) {
        if (!record(type) || !identifier(type.id) || !text(type.name, 1, 255) || typeof type.subtask !== 'boolean') {
          throw fail('SERVER_ERROR');
        }
        types.push({ id: type.id, name: type.name, subtask: type.subtask });
      }
      start += value.issueTypes.length;
      if (start >= value.total) return types;
      if (!value.issueTypes.length) throw fail('SERVER_ERROR');
    }
    throw fail('VALIDATION');
  }

  async checkConnection(signal?: AbortSignal): Promise<boolean> {
    let targetSite: ScopedSite | undefined;
    for (const site of this.sitesBySiteId.values()) {
      if (!this.allowedScope?.sites?.length || this.allowedScope.sites.includes(site.siteId)) {
        targetSite = site;
        break;
      }
    }
    if (!targetSite) return true;
    const value = await this.transport.request(targetSite.cloudId, '/myself', false, { signal });
    if (!record(value) || !text(value.accountId, 1, 255)) throw fail('SERVER_ERROR');
    return true;
  }

  async execute(
    tool: string,
    args: Record<string, any>,
    context?: { signal?: AbortSignal; timeoutMs?: number }
  ): Promise<any> {
    const signal = context?.signal;
    const timeoutMs = context?.timeoutMs;
    const callOpts = { signal, ...(timeoutMs !== undefined ? { timeoutMs } : {}) };

    if (tool === 'myjira.list_sites') {
      this.input(args, ['query'], ['limit']);
      if (!text(args.query, 0, 2000)) throw fail('VALIDATION');
      const limit = this.limit(args.limit, 10);
      const query = args.query.trim().toLowerCase();
      const results: Array<{ id: string; siteId: string; cloudId: string; name: string; url: string }> = [];

      for (const site of this.sitesBySiteId.values()) {
        if (this.allowedScope?.sites?.length && !this.allowedScope.sites.includes(site.siteId)) {
          continue;
        }
        if (!query || (site.name + ' ' + site.url).toLowerCase().includes(query)) {
          results.push({
            id: site.siteId,
            siteId: site.siteId,
            cloudId: site.cloudId,
            name: site.name,
            url: site.url,
          });
          if (results.length >= limit) break;
        }
      }
      return results;
    }

    if (tool === 'myjira.search_projects') {
      this.input(args, ['siteId', 'query'], ['limit']);
      const site = this.resolveSite(args.siteId);
      if (!text(args.query, 0, 2000)) throw fail('VALIDATION');
      const limit = this.limit(args.limit, 20);
      const query = args.query.trim().toLowerCase();
      const results: Array<{ siteId: string; id: string; key: string; name: string }> = [];

      for (const proj of site.projects.values()) {
        if (this.allowedScope?.projects?.length && !this.allowedScope.projects.includes(proj.key)) {
          continue;
        }
        if (!query || (proj.key + ' ' + proj.name).toLowerCase().includes(query)) {
          results.push({
            siteId: site.siteId,
            id: proj.id,
            key: proj.key,
            name: proj.name,
          });
          if (results.length >= limit) break;
        }
      }
      return results;
    }

    if (tool === 'myjira.search_issues') {
      this.input(args, ['siteId', 'projectKey'], ['query', 'limit']);
      const site = this.resolveSite(args.siteId);
      const proj = this.resolveProject(site, args.projectKey);
      const limit = this.limit(args.limit, 20);
      if (args.query !== undefined && !text(args.query, 0, 2000)) throw fail('VALIDATION');

      const query = (args.query ?? '').trim();
      const lucene = query.replace(/[+\-&|!(){}\[\]^~*?:\\\/"]/g, '\\$&');
      const escaped = lucene.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const directKey = query.toUpperCase();
      const isDirectKey = JIRA_ISSUE_PATTERN.test(directKey) && directKey.split('-')[0] === proj.key;
      const direct = isDirectKey ? await this.issueByKey(site, directKey, proj.key, callOpts) : null;

      const jql = 'project = "' + proj.key + '"' + (query ? ' AND text ~ "' + escaped + '"' : '') + ' ORDER BY updated DESC';
      const value = await this.transport.request(site.cloudId, '/search/jql', false, {
        ...callOpts,
        method: 'POST',
        body: { jql, maxResults: limit, fields: ['summary', 'status', 'project'] },
      });

      if (!record(value) || !Array.isArray(value.issues) || value.issues.length > limit) {
        throw fail('SERVER_ERROR');
      }

      const found = value.issues.map((issue: any) => this.issueRow(issue, site, proj.key));
      return {
        issues: direct
          ? [direct, ...found.filter((row: { id: string }) => row.id !== direct.id)].slice(0, limit)
          : found,
      };
    }

    if (tool === 'myjira.create_issue') {
      this.input(args, ['siteId', 'projectKey', 'summary'], ['description', 'issueType']);
      const site = this.resolveSite(args.siteId);
      const proj = this.resolveProject(site, args.projectKey);

      if (
        !text(args.summary, 1, 255) ||
        (args.description !== undefined && !text(args.description, 0, 4000)) ||
        (args.issueType !== undefined && !text(args.issueType, 1, 255))
      ) {
        throw fail('VALIDATION');
      }

      const types = await this.issueTypes(site.cloudId, proj.key, callOpts);
      const standard = types.filter((type) => type.subtask === false);
      const selected =
        args.issueType !== undefined
          ? standard.find((type) => type.name === args.issueType)
          : standard.find((type) => type.name === 'Task') ?? standard[0];

      if (!selected) {
        throw new StepError({
          category: 'VALIDATION',
          message:
            'Jira issueType must be a standard project type. Valid types: ' +
            standard.map((type) => type.name).join(', '),
        });
      }

      const value = await this.transport.request(site.cloudId, '/issue', true, {
        ...callOpts,
        method: 'POST',
        body: {
          fields: {
            project: { key: proj.key },
            summary: args.summary,
            issuetype: { id: selected.id },
            ...(args.description !== undefined ? { description: plainTextToAdf(args.description) } : {}),
          },
        },
      });

      const idn = this.identity(value, site, proj.key, true);
      return {
        siteId: site.siteId,
        id: idn.id,
        key: idn.key,
        url: idn.url,
      };
    }

    if (tool === 'myjira.add_comment') {
      this.input(args, ['siteId', 'issueKey', 'body']);
      const site = this.resolveSite(args.siteId);

      if (
        typeof args.issueKey !== 'string' ||
        !JIRA_ISSUE_PATTERN.test(args.issueKey) ||
        !text(args.body, 1, 4000)
      ) {
        throw fail('VALIDATION');
      }

      const initialProjectKey = args.issueKey.split('-')[0];
      this.resolveProject(site, initialProjectKey);

      const issue = await this.transport.request(
        site.cloudId,
        '/issue/' + args.issueKey + '?fields=project',
        false,
        callOpts
      );

      if (!record(issue) || !record(issue.fields?.project) || typeof issue.fields.project.key !== 'string') {
        throw fail('SERVER_ERROR');
      }

      const currentProjectKey = issue.fields.project.key;
      this.resolveProject(site, currentProjectKey);
      const idn = this.identity(issue, site, currentProjectKey);

      const value = await this.transport.request(site.cloudId, '/issue/' + idn.key + '/comment', true, {
        ...callOpts,
        method: 'POST',
        body: { body: plainTextToAdf(args.body) },
      });

      if (!record(value) || !identifier(value.id)) {
        throw fail('UNKNOWN');
      }

      return {
        siteId: site.siteId,
        id: value.id,
        issueKey: idn.key,
        url: idn.url + '?focusedCommentId=' + value.id,
      };
    }

    throw fail('VALIDATION');
  }
}

export function createPersonalJiraAdapter(config: PersonalJiraAdapterConfig): PersonalJiraAdapter {
  return new PersonalJiraAdapter(config);
}
