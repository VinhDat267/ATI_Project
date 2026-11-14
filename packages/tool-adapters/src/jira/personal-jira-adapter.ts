import {
  JIRA_PROJECT_PATTERN,
  JIRA_ISSUE_PATTERN,
  JIRA_SITE_ID_PATTERN,
  JIRA_CLOUD_ID_PATTERN,
  JIRA_CAPABILITY_DISABLED_IN_G2A,
  MYJIRA_TOOLS,
  isJiraG2AAllowedTool,
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

const fail = (
  category: Parameters<typeof createJiraStepError>[0],
  statusCode?: number,
  customMessage?: string,
  details?: Record<string, unknown>
) => createJiraStepError(category, statusCode, customMessage, false, details);

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

export function adfToPlainText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!record(value)) return '';
  if (value.type === 'text' && typeof value.text === 'string') return value.text;
  if (value.type === 'hardBreak') return '\n';
  if (Array.isArray(value.content)) {
    const joiner = value.type === 'doc' ? '\n' : '';
    return value.content.map((child) => adfToPlainText(child)).join(joiner);
  }
  return '';
}

const VALID_PRIORITIES = new Set(['Highest', 'High', 'Medium', 'Low', 'Lowest']);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LABEL_PATTERN = /^[^\s]{1,100}$/;

export class PersonalJiraAdapter extends BaseAdapter {
  readonly service = 'myjira';
  private readonly userId: string;
  private readonly workspaceId: string;
  private readonly sitesBySiteId = new Map<string, ScopedSite>();
  private readonly transport: PersonalJiraHttpTransport;
  private readonly defaultTimeoutMs?: number;

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
    this.defaultTimeoutMs = config.timeoutMs;

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

  private limit(value: unknown, maximum: number, defaultValue = maximum): number {
    if (value === undefined) return defaultValue;
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
  ): {
    siteId: string;
    id: string;
    key: string;
    url: string;
    title: string;
    status: string;
    priority?: string;
    assignee?: string | null;
    issueType?: string;
    updatedAt?: string;
    dueDate?: string | null;
  } {
    const idn = this.identity(issue, site, projectKey);
    if (
      issue.fields?.project?.key !== projectKey ||
      !this.matchesProjectId(issue.fields?.project, this.resolveProject(site, projectKey)) ||
      !text(issue.fields?.summary, 1, 255) ||
      !text(issue.fields?.status?.name, 1, 255)
    ) {
      throw fail('SERVER_ERROR');
    }
    const row: {
      siteId: string;
      id: string;
      key: string;
      url: string;
      title: string;
      status: string;
      priority?: string;
      assignee?: string | null;
      issueType?: string;
      updatedAt?: string;
      dueDate?: string | null;
    } = {
      siteId: site.siteId,
      id: idn.id,
      key: idn.key,
      url: idn.url,
      title: issue.fields.summary,
      status: issue.fields.status.name,
    };
    if (typeof issue.fields?.priority?.name === 'string') {
      row.priority = issue.fields.priority.name;
    }
    if (issue.fields && 'assignee' in issue.fields) {
      row.assignee =
        typeof issue.fields.assignee?.displayName === 'string'
          ? issue.fields.assignee.displayName
          : null;
    }
    if (typeof issue.fields?.issuetype?.name === 'string') {
      row.issueType = issue.fields.issuetype.name;
    }
    if (typeof issue.fields?.updated === 'string') {
      row.updatedAt = issue.fields.updated;
    }
    if (issue.fields && 'duedate' in issue.fields) {
      row.dueDate = typeof issue.fields.duedate === 'string' ? issue.fields.duedate : null;
    }
    return row;
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
        '/issue/' + issueKey + '?fields=summary,status,project,priority,issuetype,assignee,updated,duedate',
        false,
        opts
      );
    } catch (error) {
      if (error instanceof StepError && error.category === 'NOT_FOUND') return null;
      throw error;
    }
    if (!record(value) || !record(value.fields?.project)) throw fail('SERVER_ERROR');
    return value.fields.project.key === projectKey && value.key === issueKey &&
      this.matchesProjectId(value.fields.project, this.resolveProject(site, projectKey))
      ? this.issueRow(value, site, projectKey)
      : null;
  }

  private matchesProjectId(project: any, bound: ScopedProject): boolean {
    return !bound.id || String(project?.id ?? '') === bound.id;
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
        throw fail('SERVER_ERROR', undefined, undefined, { requestSent: false });
      }
      for (const type of value.issueTypes) {
        if (!record(type) || !identifier(type.id) || !text(type.name, 1, 255) || typeof type.subtask !== 'boolean') {
          throw fail('SERVER_ERROR', undefined, undefined, { requestSent: false });
        }
        types.push({ id: type.id, name: type.name, subtask: type.subtask });
      }
      start += value.issueTypes.length;
      if (start >= value.total) return types;
      if (!value.issueTypes.length) throw fail('SERVER_ERROR', undefined, undefined, { requestSent: false });
    }
    throw fail('VALIDATION', undefined, undefined, { requestSent: false });
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

    if (typeof tool === 'string' && tool.startsWith('myjira.')) {
      const knownMyJiraTool = MYJIRA_TOOLS.some((t) => t.name === tool);
      if (!knownMyJiraTool) {
        throw fail('VALIDATION');
      }
      if (!isJiraG2AAllowedTool(tool)) {
        throw new StepError({
          category: 'AUTH_ERROR',
          statusCode: 403,
          retryable: false,
          message: `${JIRA_CAPABILITY_DISABLED_IN_G2A}: Tool '${tool}' is disabled in Jira G2A read-only mode`,
          details: { requestSent: false },
        });
      }
    }

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
      this.input(args, ['siteId', 'projectKey'], ['query', 'status', 'priority', 'issueType', 'limit']);
      const site = this.resolveSite(args.siteId);
      const proj = this.resolveProject(site, args.projectKey);
      const limit = this.limit(args.limit, 50, 20);
      if (args.query !== undefined && !text(args.query, 0, 2000)) throw fail('VALIDATION');
      if (args.status !== undefined && !text(args.status, 1, 100)) throw fail('VALIDATION');
      if (args.priority !== undefined && !text(args.priority, 1, 100)) throw fail('VALIDATION');
      if (args.issueType !== undefined && !text(args.issueType, 1, 100)) throw fail('VALIDATION');

      const startedAt = Date.now();
      const baseBudgetMs = timeoutMs ?? this.defaultTimeoutMs;
      const effectiveBudgetMs = baseBudgetMs !== undefined ? Math.min(Math.max(1, baseBudgetMs), 8_000) : 8_000;
      const MAX_PAGES = 3;

      const escapeJqlString = (raw: string) => raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const query = (args.query ?? '').trim();
      const lucene = query.replace(/[+\-&|!(){}\[\]^~*?:\\\/"]/g, '\\$&');
      const escaped = lucene.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const directKey = query.toUpperCase();
      const isDirectKey = JIRA_ISSUE_PATTERN.test(directKey) && directKey.split('-')[0] === proj.key;
      const directRemainingMs = Math.max(1, effectiveBudgetMs - (Date.now() - startedAt));
      const directCandidate = isDirectKey
        ? await this.issueByKey(site, directKey, proj.key, { signal, timeoutMs: directRemainingMs })
        : null;
      const direct = directCandidate &&
        (args.status === undefined || directCandidate.status.toLowerCase() === args.status.trim().toLowerCase()) &&
        (args.priority === undefined || directCandidate.priority?.toLowerCase() === args.priority.trim().toLowerCase()) &&
        (args.issueType === undefined || directCandidate.issueType?.toLowerCase() === args.issueType.trim().toLowerCase())
        ? directCandidate : null;

      let jql = 'project = "' + proj.key + '"';
      if (query) jql += ' AND text ~ "' + escaped + '"';
      if (args.status !== undefined) jql += ' AND status = "' + escapeJqlString(args.status.trim()) + '"';
      if (args.priority !== undefined) jql += ' AND priority = "' + escapeJqlString(args.priority.trim()) + '"';
      if (args.issueType !== undefined) jql += ' AND issuetype = "' + escapeJqlString(args.issueType.trim()) + '"';
      jql += ' ORDER BY updated DESC';

      const collected: Array<ReturnType<PersonalJiraAdapter['issueRow']>> = [];
      const seenIds = new Set<string>();
      if (direct) {
        collected.push(direct);
        seenIds.add(direct.id);
      }

      let pagesFetched = 0;
      let nextPageToken: string | undefined;
      let lastProviderIsLast: boolean | undefined;
      let interrupted = false;
      let deadlineStopped = false;

      for (let page = 1; page <= MAX_PAGES; page++) {
        if (collected.length >= limit) break;
        const elapsedBeforePage = Date.now() - startedAt;
        if (page > 1 && elapsedBeforePage >= effectiveBudgetMs) {
          deadlineStopped = true;
          break;
        }
        const pageTimeoutMs = Math.max(1, effectiveBudgetMs - elapsedBeforePage);
        const pageMaxResults = Math.min(50, Math.max(1, limit - collected.length));

        let value: any;
        try {
          value = await this.transport.request(site.cloudId, '/search/jql', false, {
            signal,
            timeoutMs: pageTimeoutMs,
            method: 'POST',
            body: {
              jql,
              maxResults: pageMaxResults,
              fields: ['summary', 'status', 'project', 'priority', 'assignee', 'issuetype', 'updated', 'duedate'],
              ...(nextPageToken ? { nextPageToken } : {}),
            },
          });
        } catch (err) {
          if (page === 1 || signal?.aborted) {
            throw err;
          }
          interrupted = true;
          break;
        }

        if (!record(value) || !Array.isArray(value.issues) || value.issues.length > pageMaxResults) {
          throw fail('SERVER_ERROR');
        }

        pagesFetched++;
        lastProviderIsLast = typeof value.isLast === 'boolean' ? value.isLast : undefined;
        const rawNextToken =
          typeof value.nextPageToken === 'string' && value.nextPageToken.trim().length > 0
            ? value.nextPageToken
            : undefined;

        for (const issue of value.issues) {
          const row = this.issueRow(issue, site, proj.key);
          if (!seenIds.has(row.id) && collected.length < limit) {
            seenIds.add(row.id);
            collected.push(row);
          }
        }

        nextPageToken = rawNextToken;
        if (lastProviderIsLast === true || !nextPageToken) {
          break;
        }
      }

      const elapsedMs = Math.max(0, Date.now() - startedAt);
      let completeness: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';
      let truncationReason: string | undefined;

      if (interrupted) {
        completeness = 'UNKNOWN';
        truncationReason = 'PAGINATION_INTERRUPTED';
      } else if (lastProviderIsLast === true && !nextPageToken) {
        completeness = 'COMPLETE';
      } else if (nextPageToken) {
        completeness = 'PARTIAL';
        if (deadlineStopped || elapsedMs >= effectiveBudgetMs) {
          truncationReason = 'DEADLINE_EXCEEDED';
        } else if (collected.length >= limit) {
          truncationReason = 'ITEM_CAP_REACHED';
        } else if (pagesFetched >= MAX_PAGES) {
          truncationReason = 'PAGE_CAP_REACHED';
        } else {
          truncationReason = 'MORE_PAGES_AVAILABLE';
        }
      } else if (lastProviderIsLast === false) {
        completeness = 'PARTIAL';
        truncationReason = collected.length >= limit ? 'ITEM_CAP_REACHED' : 'PROVIDER_NOT_LAST';
      } else {
        completeness = 'UNKNOWN';
        truncationReason = 'PROVIDER_COMPLETENESS_OMITTED';
      }

      return {
        issues: collected.slice(0, limit),
        coverage: {
          completeness,
          pagesFetched,
          itemsReturned: Math.min(collected.length, limit),
          budgetMs: effectiveBudgetMs,
          elapsedMs,
          ...(truncationReason ? { truncationReason } : {}),
          ...(typeof lastProviderIsLast === 'boolean' ? { providerIsLast: lastProviderIsLast } : {}),
        },
      };
    }

    if (tool === 'myjira.create_issue') {
      this.input(
        args,
        ['siteId', 'projectKey', 'summary'],
        ['description', 'issueType', 'priority', 'labels', 'dueDate', 'assigneeAccountId', 'parentKey']
      );
      const site = this.resolveSite(args.siteId);
      const proj = this.resolveProject(site, args.projectKey);

      if (
        !text(args.summary, 1, 255) ||
        (args.description !== undefined && !text(args.description, 0, 4000)) ||
        (args.issueType !== undefined && !text(args.issueType, 1, 255)) ||
        (args.priority !== undefined && (typeof args.priority !== 'string' || !VALID_PRIORITIES.has(args.priority))) ||
        (args.dueDate !== undefined && (typeof args.dueDate !== 'string' || !DATE_PATTERN.test(args.dueDate))) ||
        (args.assigneeAccountId !== undefined && !text(args.assigneeAccountId, 1, 128)) ||
        (args.parentKey !== undefined &&
          (typeof args.parentKey !== 'string' ||
            !JIRA_ISSUE_PATTERN.test(args.parentKey) ||
            args.parentKey.split('-')[0] !== proj.key))
      ) {
        throw fail('VALIDATION');
      }

      if (args.labels !== undefined) {
        if (
          !Array.isArray(args.labels) ||
          args.labels.length > 20 ||
          !args.labels.every((lbl: unknown) => typeof lbl === 'string' && LABEL_PATTERN.test(lbl))
        ) {
          throw fail('VALIDATION');
        }
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
            ...(args.priority !== undefined ? { priority: { name: args.priority } } : {}),
            ...(args.labels !== undefined ? { labels: args.labels } : {}),
            ...(args.dueDate !== undefined ? { duedate: args.dueDate } : {}),
            ...(args.assigneeAccountId !== undefined ? { assignee: { id: args.assigneeAccountId } } : {}),
            ...(args.parentKey !== undefined ? { parent: { key: args.parentKey } } : {}),
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
        throw fail('SERVER_ERROR', undefined, undefined, { requestSent: false });
      }

      const currentProjectKey = issue.fields.project.key;
      this.resolveProject(site, currentProjectKey);
      let idn: { id: string; key: string; url: string };
      try {
        idn = this.identity(issue, site, currentProjectKey);
      } catch (err) {
        if (err instanceof StepError) {
          throw new StepError({
            category: err.category,
            statusCode: err.statusCode,
            retryable: err.retryable,
            message: err.message,
            details: { ...(err.details ?? {}), requestSent: false },
          });
        }
        throw err;
      }

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

    if (tool === 'myjira.get_issue') {
      this.input(args, ['siteId', 'issueKey']);
      const site = this.resolveSite(args.siteId);
      if (typeof args.issueKey !== 'string' || !JIRA_ISSUE_PATTERN.test(args.issueKey)) {
        throw fail('VALIDATION');
      }
      const initialProjectKey = args.issueKey.split('-')[0];
      const initialProject = this.resolveProject(site, initialProjectKey);

      const issue = await this.transport.request(
        site.cloudId,
        '/issue/' +
          args.issueKey +
          '?fields=summary,status,project,description,priority,assignee,issuetype,labels,duedate,comment',
        false,
        callOpts
      );

      if (
        !record(issue) ||
        !record(issue.fields?.project) ||
        typeof issue.fields.project.key !== 'string' ||
        !text(issue.fields?.summary, 1, 255) ||
        !text(issue.fields?.status?.name, 1, 255)
      ) {
        throw fail('SERVER_ERROR');
      }

      const currentProjectKey = issue.fields.project.key;
      if (currentProjectKey !== initialProject.key || issue.key !== args.issueKey ||
          !this.matchesProjectId(issue.fields.project, initialProject)) throw fail('AUTH_ERROR');
      const idn = this.identity(issue, site, currentProjectKey);

      const rawComments = Array.isArray(issue.fields?.comment?.comments)
        ? issue.fields.comment.comments.slice(-5)
        : [];
      const comments = rawComments
        .filter((c: unknown): c is Record<string, any> => record(c) && typeof c.id === 'string')
        .map((c: Record<string, any>) => ({
          id: String(c.id),
          author:
            typeof c.author?.displayName === 'string' && c.author.displayName.trim()
              ? c.author.displayName
              : 'Unknown',
          body: adfToPlainText(c.body),
          createdAt: typeof c.created === 'string' ? c.created : '',
        }));

      return {
        siteId: site.siteId,
        id: idn.id,
        key: idn.key,
        url: idn.url,
        title: issue.fields.summary,
        status: issue.fields.status.name,
        description: adfToPlainText(issue.fields.description),
        ...(typeof issue.fields?.priority?.name === 'string' ? { priority: issue.fields.priority.name } : {}),
        assignee:
          typeof issue.fields?.assignee?.displayName === 'string'
            ? issue.fields.assignee.displayName
            : null,
        ...(typeof issue.fields?.issuetype?.name === 'string' ? { issueType: issue.fields.issuetype.name } : {}),
        labels: Array.isArray(issue.fields?.labels)
          ? issue.fields.labels.filter((l: unknown): l is string => typeof l === 'string')
          : [],
        dueDate: typeof issue.fields?.duedate === 'string' ? issue.fields.duedate : null,
        comments,
      };
    }

    if (tool === 'myjira.search_users') {
      this.input(args, ['siteId', 'projectKey', 'query'], ['limit']);
      const site = this.resolveSite(args.siteId);
      const proj = this.resolveProject(site, args.projectKey);
      if (!text(args.query, 0, 200)) throw fail('VALIDATION');
      const limit = this.limit(args.limit, 20);
      const query = args.query.trim();

      const value = await this.transport.request(
        site.cloudId,
        '/user/assignable/search?project=' +
          encodeURIComponent(proj.key) +
          '&query=' +
          encodeURIComponent(query) +
          '&maxResults=' +
          limit,
        false,
        callOpts
      );

      if (!Array.isArray(value)) throw fail('SERVER_ERROR');

      return value
        .filter(
          (u: unknown): u is Record<string, any> =>
            record(u) && text(u.accountId, 1, 128) && text(u.displayName, 1, 255)
        )
        .slice(0, limit)
        .map((u) => ({
          id: String(u.accountId),
          siteId: site.siteId,
          accountId: String(u.accountId),
          displayName: String(u.displayName),
        }));
    }

    if (tool === 'myjira.transition_issue') {
      this.input(args, ['siteId', 'issueKey', 'status'], ['comment']);
      const site = this.resolveSite(args.siteId);
      if (
        typeof args.issueKey !== 'string' ||
        !JIRA_ISSUE_PATTERN.test(args.issueKey) ||
        !text(args.status, 1, 100) ||
        (args.comment !== undefined && !text(args.comment, 1, 4000))
      ) {
        throw fail('VALIDATION');
      }

      const initialProjectKey = args.issueKey.split('-')[0];
      this.resolveProject(site, initialProjectKey);

      const issue = await this.transport.request(
        site.cloudId,
        '/issue/' + args.issueKey + '?fields=project,status',
        false,
        callOpts
      );
      if (!record(issue) || !record(issue.fields?.project) || typeof issue.fields.project.key !== 'string') {
        throw fail('SERVER_ERROR');
      }
      const currentProjectKey = issue.fields.project.key;
      this.resolveProject(site, currentProjectKey);
      const idn = this.identity(issue, site, currentProjectKey);

      const transitionsRes = await this.transport.request(
        site.cloudId,
        '/issue/' + idn.key + '/transitions',
        false,
        callOpts
      );
      if (!record(transitionsRes) || !Array.isArray(transitionsRes.transitions)) {
        throw fail('SERVER_ERROR');
      }

      const targetNorm = args.status.trim().toLowerCase();
      const matched = transitionsRes.transitions.find(
        (t: any) =>
          record(t) &&
          identifier(t.id) &&
          (String(t.to?.name ?? '').trim().toLowerCase() === targetNorm ||
            String(t.name ?? '').trim().toLowerCase() === targetNorm)
      );

      if (!matched) {
        const available = transitionsRes.transitions
          .filter((t: any) => record(t) && typeof (t.to?.name ?? t.name) === 'string')
          .map((t: any) => String(t.to?.name ?? t.name));
        throw new StepError({
          category: 'VALIDATION',
          message:
            `Không tìm thấy trạng thái chuyển tiếp "${args.status}" cho issue ${idn.key}. Các trạng thái hợp lệ: ` +
            available.join(', '),
        });
      }

      await this.transport.request(site.cloudId, '/issue/' + idn.key + '/transitions', true, {
        ...callOpts,
        method: 'POST',
        body: {
          transition: { id: String(matched.id) },
          ...(args.comment !== undefined
            ? { update: { comment: [{ add: { body: plainTextToAdf(args.comment) } }] } }
            : {}),
        },
      });

      const resolvedStatus = String(matched.to?.name ?? matched.name ?? args.status);
      return {
        siteId: site.siteId,
        id: idn.id,
        key: idn.key,
        status: resolvedStatus,
        url: idn.url,
      };
    }

    if (tool === 'myjira.update_issue') {
      this.input(
        args,
        ['siteId', 'issueKey'],
        ['summary', 'description', 'priority', 'assigneeAccountId', 'labels', 'dueDate']
      );
      const site = this.resolveSite(args.siteId);
      if (typeof args.issueKey !== 'string' || !JIRA_ISSUE_PATTERN.test(args.issueKey)) {
        throw fail('VALIDATION');
      }

      const hasMutationField =
        args.summary !== undefined ||
        args.description !== undefined ||
        args.priority !== undefined ||
        args.assigneeAccountId !== undefined ||
        args.labels !== undefined ||
        args.dueDate !== undefined;
      if (!hasMutationField) {
        throw fail('VALIDATION');
      }

      if (
        (args.summary !== undefined && !text(args.summary, 1, 255)) ||
        (args.description !== undefined && !text(args.description, 0, 4000)) ||
        (args.priority !== undefined && (typeof args.priority !== 'string' || !VALID_PRIORITIES.has(args.priority))) ||
        (args.assigneeAccountId !== undefined &&
          args.assigneeAccountId !== null &&
          !text(args.assigneeAccountId, 1, 128)) ||
        (args.dueDate !== undefined &&
          args.dueDate !== null &&
          (typeof args.dueDate !== 'string' || !DATE_PATTERN.test(args.dueDate)))
      ) {
        throw fail('VALIDATION');
      }

      if (args.labels !== undefined) {
        if (
          !Array.isArray(args.labels) ||
          args.labels.length > 20 ||
          !args.labels.every((lbl: unknown) => typeof lbl === 'string' && LABEL_PATTERN.test(lbl))
        ) {
          throw fail('VALIDATION');
        }
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

      const fields: Record<string, any> = {};
      if (args.summary !== undefined) fields.summary = args.summary;
      if (args.description !== undefined) fields.description = plainTextToAdf(args.description);
      if (args.priority !== undefined) fields.priority = { name: args.priority };
      if (args.assigneeAccountId !== undefined) {
        fields.assignee = args.assigneeAccountId === null ? null : { id: args.assigneeAccountId };
      }
      if (args.labels !== undefined) fields.labels = args.labels;
      if (args.dueDate !== undefined) fields.duedate = args.dueDate;

      await this.transport.request(site.cloudId, '/issue/' + idn.key, true, {
        ...callOpts,
        method: 'PUT',
        body: { fields },
      });

      return {
        siteId: site.siteId,
        id: idn.id,
        key: idn.key,
        url: idn.url,
      };
    }

    throw fail('VALIDATION');
  }
}

export function createPersonalJiraAdapter(config: PersonalJiraAdapterConfig): PersonalJiraAdapter {
  return new PersonalJiraAdapter(config);
}
