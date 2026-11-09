import { SERVICE_REGISTRY, requiresReportEvidence, reportLiteralBodies, reportOutputTargets, isWorkItemWriteStep, REPORT_SOURCE_TOOLS, type ToolDefinition, type PlannerResponse, type ServiceDefinition, type GatherRule, type AnswerLookup, type ReportKind } from '@wap/tool-schemas';
import type { LLMProvider, ChatMessage, PlanningPhaseMetrics } from './types.js';
import { WorkingMemory } from './working-memory.js';
import { routeIntent, unavailableServiceReason, type RoutedIntent } from './router.js';
import { validatePlan, validateAnswer, type ValidationResult } from './validator.js';
import { validateSchedule } from './schedule-validator.js';
import { buildSystemPrompt } from './prompts/system-prompt.js';
import {
  MAX_DIRECTORY_CALLS, MAX_DIRECTORY_PARENTS, MAX_RESULTS_PER_CALL, formatSearchResults, groundingMemory, parseSearchRequest, prepareSearchCall, recordObserved, recordThreadLabels, providerMemory, sanitizeEntities, searchEntities,
  type SearchOutcome,
} from './search.js';
import { extractWorkspaceRecipients } from './recipients.js';
import { ReportArtifactStore } from './reports/artifacts.js';
import {
  renderGithubPrsReport,
  renderGithubIssueAgingReport,
  renderJiraProgressReport,
  renderSheetSummaryReport,
  type SheetSummaryData,
  type RenderedReport,
} from './reports/renderers.js';

export interface AIPlannerOptions {
  provider: LLMProvider;
  toolCatalog: ToolDefinition[];
  gatherSearch?: (request: GatherSearchRequest) => Promise<unknown>;
  serviceRegistry?: ServiceDefinition[];
  reportEvidenceStore?: ReportArtifactStore;
  /**
   * Reject plans whose resource IDs were not looked up, typed by the user or
   * produced by an earlier step. Only canned providers that never read
   * working memory (sandbox fixtures) should disable this.
   */
  requireGroundedResources?: boolean;
  readAnswers?: boolean;
  /** Clock used to resolve relative dates such as "thứ 6"; defaults to the system clock. */
  now?: () => Date;
  /** IANA time zone users plan in; defaults to Asia/Ho_Chi_Minh. */
  timeZone?: string;
  /**
   * How names become IDs. 'regex' (default) resolves names with the registry's
   * gather rules before the model runs. 'llm' lets the model call the read-only
   * search tools itself through `gatherSearch`, in a bounded loop.
   */
  searchMode?: 'regex' | 'llm';
  /** Model-driven search rounds allowed per turn (default 4). */
  maxSearchRounds?: number;
  /** In 'llm' mode, list the workspace before the first model call (default true). */
  prefetchDirectory?: boolean;
  /** Time allowed for that listing before planning continues without the rest (default 2500 ms). */
  directoryBudgetMs?: number;
  /** Scheduled workflows (SCHEDULES_ENABLED): off, the prompt is unchanged and a schedule is never accepted. */
  schedules?: boolean;
}

export interface GatherSearchRequest {
  tool: string;
  args: Record<string, unknown>;
  signal?: AbortSignal;
  /** Who is planning; forwarded untouched so personal/workspace connections use the caller's own adapter. */
  actor?: {
    userId: string;
    workspaceId?: string | null;
    workspaceMode?: 'legacy' | 'personal' | 'organization';
  };
}

export interface GatherEvent {
  tool: string;
  status: 'started' | 'completed';
  output?: unknown;
}

export interface ProcessMessageInput {
  userMessage: string;
  history?: ChatMessage[];
  memory: WorkingMemory;
  signal?: AbortSignal;
  onGatherEvent?: (event: GatherEvent) => void;
  /** Optional diagnostics, independent of product/SSE events. */
  onTiming?: (metrics: PlanningPhaseMetrics) => void;
  /** Internal turn clock forwarded through all phases. */
  timingStarted?: number;
  /** The signed-in caller. The planner never reads it; it only passes it to `gatherSearch`. */
  actor?: {
    userId: string;
    workspaceId?: string | null;
    workspaceMode?: 'legacy' | 'personal' | 'organization';
  };
  /** The conversation's schedule: its services join the routed ones, and only update, pause, resume or cancel are accepted. */
  schedule?: { services: string[] };
  /** Planning a run of a schedule: the prompt is the one of schedules off and a schedule is refused. */
  scheduledRun?: boolean;
}

interface GatherCandidate { id: string; name: string; [key: string]: unknown }
interface PendingGather { key: string; query: string; candidates: GatherCandidate[] }
interface GatherRequest { key: string; query: string; rule: GatherRule }

/**
 * The first message naming a resource wins, so a clarification reply can name resources the original request left out.
 * A registered service's id or name is never a resource name: "kênh Slack" or "bảng Trello" names where the
 * resource lives, so that match is skipped and the next one in the message is tried.
 */
function entityNames(messages: string[], rules: GatherRule[], serviceNames: Set<string>): Array<GatherRequest & { fromMessage: number }> {
  return rules.flatMap((rule) => {
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags.replace(/[gy]/g, '') + 'g');
    for (const [fromMessage, message] of messages.entries()) {
      for (const match of message.matchAll(pattern)) {
        const query = match[1]?.trim();
        if (query && !serviceNames.has(query.toLocaleLowerCase())) return [{ key: rule.entityKey, query, rule, fromMessage }];
      }
    }
    return [];
  });
}

function asCandidates(value: unknown, nameField?: string): GatherCandidate[] {
  if (!Array.isArray(value)) throw new Error('Gather search must return an array');
  return value.map((item) => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string') {
      throw new Error('Gather search returned an item without an ID');
    }
    const name = (nameField ? item[nameField] : undefined) ?? item.name ?? item.fullName;
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error('Gather search returned an item without a name');
    }
    return { ...item, name } as GatherCandidate;
  });
}

// A request that names an unconfigured service is refused, never rerouted to another service.
export function unroutable(unavailable: RoutedIntent['unavailable']): PlannerResponse {
  return { kind: 'refusal',
    reason: unavailable.length > 0 ? unavailableServiceReason(unavailable) : 'Dịch vụ được yêu cầu chưa khả dụng hoặc chưa được cấp quyền trong kết nối này.',
    suggestion: 'Hãy kết nối dịch vụ và cấp phạm vi tài nguyên được phép trước khi lập kế hoạch.',
    ...(unavailable.length > 0 ? { unavailableServices: unavailable } : {}) };
}

function answerLookup(outcome: SearchOutcome): AnswerLookup {
  const links = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (key === 'url' && typeof child === 'string' && child.startsWith('https://') && links.size < 5) links.add(child);
        else if (typeof child === 'object') visit(child);
      }
    }
  };
  visit(outcome.result);
  return { tool: outcome.tool, ...(typeof outcome.args.query === 'string' ? { query: outcome.args.query } : {}),
    resultCount: Array.isArray(outcome.result) ? outcome.result.length : 1, links: [...links] };
}

function asksForPullRequests(texts: string[]): boolean {
  return /pull request|\bprs?\b/iu.test(texts.join('\n'));
}

function asksForCalendarEvents(texts: string[]): boolean {
  return /sự kiện|su kien/iu.test(texts.join('\n'));
}

function readOnlyQuestion(): PlannerResponse {
  return { kind: 'clarification', question: 'Bạn muốn làm gì với dữ liệu này, chẳng hạn gửi thông báo, ghi vào bảng tính hoặc tạo công việc?',
    context: 'Kế hoạch cần ít nhất một hành động ghi. Hãy chọn hành động trên dịch vụ đã kết nối.', reason: 'read_only' };
}

function isClarificationAssistantMessage(content: unknown): boolean {
  if (!content) return false;
  if (typeof content === 'object') {
    const obj = content as Record<string, unknown>;
    if (obj.kind === 'clarification') return true;
    if (obj.kind === 'plan' || Array.isArray(obj.steps) || obj.kind === 'answer' || obj.kind === 'refusal' || obj.kind === 'schedule_proposal') {
      return false;
    }
  }
  if (typeof content === 'string') {
    const trimmed = content.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object') {
          if (parsed.kind === 'clarification') return true;
          if (parsed.kind === 'plan' || Array.isArray(parsed.steps) || parsed.kind === 'answer' || parsed.kind === 'refusal' || parsed.kind === 'schedule_proposal') {
            return false;
          }
        }
      } catch {
        // Not valid JSON
      }
    }
    if (trimmed.startsWith('Previous answer.') || trimmed.includes('<previous_answer>')) {
      return false;
    }
  }
  return true;
}

export function relevantGroundingUserTexts(history: ChatMessage[] = [], currentMessage: string): string[] {
  const texts: string[] = [currentMessage];
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (!msg) continue;
    if (msg.role === 'assistant') {
      if (!isClarificationAssistantMessage(msg.content)) {
        break;
      }
      continue;
    }
    if (msg.role === 'user') {
      texts.unshift(msg.content);
    }
  }
  return texts;
}

export class AIPlanner {
  private async measure<T>(phase: PlanningPhaseMetrics['phase'], input: ProcessMessageInput, work: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try { return await work(); }
    finally {
      try { input.onTiming?.({ phase, startedAtMs: started - (input.timingStarted ?? started), durationMs: performance.now() - started }); }
      catch { /* Diagnostics cannot change the planning result. */ }
    }
  }
  private provider: LLMProvider;
  private toolCatalog: ToolDefinition[];
  private gatherSearch?: (request: GatherSearchRequest) => Promise<unknown>;
  private serviceRegistry: ServiceDefinition[];
  private requireGroundedResources: boolean;
  private readAnswers: boolean;
  private now: () => Date;
  private timeZone: string;
  private searchMode: 'regex' | 'llm';
  private maxSearchRounds: number;
  private prefetchDirectory: boolean;
  private directoryBudgetMs: number;
  private schedules: boolean;
  private reportEvidenceStore: ReportArtifactStore;

  constructor(options: AIPlannerOptions) {
    this.schedules = options.schedules ?? false;
    this.searchMode = options.searchMode ?? 'regex';
    this.maxSearchRounds = options.maxSearchRounds ?? 4;
    this.prefetchDirectory = options.prefetchDirectory ?? true;
    this.directoryBudgetMs = options.directoryBudgetMs ?? 2500;
    this.now = options.now ?? (() => new Date());
    this.timeZone = options.timeZone ?? 'Asia/Ho_Chi_Minh';
    this.provider = options.provider;
    this.toolCatalog = options.toolCatalog;
    this.gatherSearch = options.gatherSearch;
    this.serviceRegistry = options.serviceRegistry ?? SERVICE_REGISTRY;
    this.requireGroundedResources = options.requireGroundedResources ?? true;
    this.readAnswers = options.readAnswers ?? false;
    this.reportEvidenceStore = options.reportEvidenceStore ?? new ReportArtifactStore();
  }

  getReportEvidenceStore(): ReportArtifactStore {
    return this.reportEvidenceStore;
  }

  private async bindReportEvidenceIfApplicable(
    rawOutput: string,
    input: ProcessMessageInput,
    successfulReads: SearchOutcome[],
    groundingUserTexts: string[],
  ): Promise<string> {
    let parsed: any;
    try {
      parsed = JSON.parse(rawOutput);
    } catch {
      return rawOutput;
    }
    if (!parsed || parsed.kind !== 'plan' || !Array.isArray(parsed.steps)) {
      return rawOutput;
    }
    delete parsed.reportEvidence;

    if (!requiresReportEvidence(groundingUserTexts.length ? groundingUserTexts : [parsed.summary || '', parsed.thinking || ''])) return rawOutput;
    if (parsed.steps.some((s: any) => !s || typeof s.id !== 'string' || typeof s.tool !== 'string' || !s.args || typeof s.args !== 'object')) return rawOutput;
    if (reportLiteralBodies(groundingUserTexts).length > 0) {
      return JSON.stringify({ kind: 'clarification', question: 'Bạn muốn gửi báo cáo có nguồn và một tin nhắn nguyên văn riêng. Hãy tách hai yêu cầu để tôi giữ đúng nội dung và người nhận của từng phần.', context: 'Chưa gửi nội dung nào; tránh đưa báo cáo vào đích chỉ nhận tin nhắn nguyên văn.' });
    }
    const targets = reportOutputTargets(parsed.steps);
    const primary = targets.at(-1);
    if (!primary) return rawOutput;

    const hasWorkItemStep = parsed.steps.some((s: any) => isWorkItemWriteStep(s));
    if (hasWorkItemStep) {
      const alreadyClarifiedWorkItem = (input.history ?? []).some(
        (msg) =>
          msg.role === 'assistant' &&
          typeof msg.content === 'string' &&
          msg.content.includes('Bạn muốn nội dung công việc mới là báo cáo dữ liệu hay một nội dung riêng?'),
      );
      const hasDedicatedNotificationTarget = targets.some((target) => {
        const step = parsed.steps.find((s: any) => s.id === target.stepId);
        return step && !isWorkItemWriteStep(step);
      });
      const hasExplicitWorkItemPayload = groundingUserTexts.some((text) =>
        /(?:với\s+|with\s+)?(?:tiêu\s+đề|tieu\s+de|title)\s*[:=]?\s*(?:"[^"\n]+"|“[^”\n]+”|'[^'\n]+').*(?:nội\s+dung|noi\s+dung|mô\s+tả|mo\s+ta|body|description)\s*[:=]?\s*(?:"[^"\n]+"|“[^”\n]+”|'[^'\n]+')/iu.test(
          text,
        ),
      );
      if (!alreadyClarifiedWorkItem && !(hasDedicatedNotificationTarget && hasExplicitWorkItemPayload)) {
        return JSON.stringify({
          kind: 'clarification',
          question:
            'Bạn muốn nội dung công việc mới là báo cáo dữ liệu hay một nội dung riêng? Hãy tách hoặc xác nhận nội dung để tôi giữ đúng từng phần.',
          context: 'Yêu cầu kết hợp báo cáo với nội dung tạo/cập nhật công việc; chưa gửi hoặc thay đổi dữ liệu.',
        });
      }
    }

    // Find observation from successfulReads or execute plan's read step via gatherSearch
    let readTool: string | undefined;
    let readArgs: Record<string, unknown> = {};
    let rawResult: unknown;

    const priorRead = [...successfulReads].reverse().find((r) => REPORT_SOURCE_TOOLS.has(r.tool) && r.result !== undefined && r.error === undefined);
    if (priorRead) {
      readTool = priorRead.tool;
      readArgs = priorRead.args ?? {};
      rawResult = priorRead.result;
    } else if (this.gatherSearch) {
      const readStep = parsed.steps.find((s: any) => s && typeof s.tool === 'string' && REPORT_SOURCE_TOOLS.has(s.tool));
      if (readStep) {
        readTool = readStep.tool;
        readArgs = readStep.args ?? {};
        rawResult = await this.gatherSearch({
          tool: readStep.tool,
          args: readArgs,
          signal: input.signal,
          actor: input.actor,
        });
      }
    }

    if (!readTool || rawResult === undefined || rawResult === null) {
      return rawOutput;
    }
    if (
      Array.isArray(rawResult) &&
      rawResult.length === 1 &&
      rawResult[0] &&
      typeof rawResult[0] === 'object' &&
      !Array.isArray(rawResult[0]) &&
      ('values' in rawResult[0] || 'records' in rawResult[0] || 'groups' in rawResult[0] || 'headers' in rawResult[0] || 'matches' in rawResult[0])
    ) {
      rawResult = rawResult[0];
    }

    if (readTool.endsWith('.read_range') && Array.isArray((rawResult as any)?.values) &&
        (rawResult as any).values.length > 0 && !Array.isArray((rawResult as any).headers) &&
        !Array.isArray((rawResult as any).records)) {
      return JSON.stringify({ kind: 'clarification', question: 'Dòng đầu của vùng dữ liệu này có phải tiêu đề cột không? Hãy xác nhận hàng tiêu đề hoặc chọn vùng có tiêu đề để tôi tổng hợp chính xác.', context: 'Chưa xác định tiêu đề cột; dữ liệu đọc có dòng và chưa được gửi.' });
    }

    let kind: ReportKind;
    let rendered: RenderedReport;
    let sourceLabel: string;
    let artifactItems: unknown[];

    const combinedText = groundingUserTexts.join(' ');
    if (readTool === 'github.list_pull_requests') {
      const items = Array.isArray(rawResult)
        ? rawResult
        : Array.isArray((rawResult as any)?.pullRequests)
          ? (rawResult as any).pullRequests
          : Array.isArray((rawResult as any)?.items)
            ? (rawResult as any).items
            : null;
      if (!Array.isArray(items)) return rawOutput;
      kind = 'github_prs';
      const repo = typeof readArgs.repo === 'string' ? readArgs.repo : undefined;
      rendered = renderGithubPrsReport(items as any, { repo });
      sourceLabel = repo || 'GitHub Pull Requests';
      artifactItems = items;
    } else if (readTool === 'myjira.search_issues' || readTool === 'jira.search_issues') {
      const items = Array.isArray(rawResult)
        ? rawResult
        : Array.isArray((rawResult as any)?.issues)
          ? (rawResult as any).issues
          : Array.isArray((rawResult as any)?.items)
            ? (rawResult as any).items
            : null;
      if (!Array.isArray(items)) return rawOutput;
      kind = 'jira_progress';
      const projectKey = typeof readArgs.projectKey === 'string' ? readArgs.projectKey : undefined;
      rendered = renderJiraProgressReport(items as any, { projectKey });
      sourceLabel = projectKey ? `Jira ${projectKey}` : 'Jira Sprint';
      artifactItems = items;
    } else if (readTool === 'github.list_issues' || readTool.endsWith('.search_issues')) {
      const items = Array.isArray(rawResult)
        ? rawResult
        : Array.isArray((rawResult as any)?.issues)
          ? (rawResult as any).issues
          : Array.isArray((rawResult as any)?.items)
            ? (rawResult as any).items
            : null;
      if (!Array.isArray(items)) return rawOutput;
      kind = 'github_issues';
      const repo = typeof readArgs.repo === 'string' ? readArgs.repo : undefined;
      const ageMatch = combinedText.match(/(?:quá|trên|hơn)\s*(\d+)\s*ngày/i);
      const agingDays = ageMatch?.[1] ? Number.parseInt(ageMatch[1], 10) : 7;
      rendered = renderGithubIssueAgingReport(items as any, { repo, agingDays, clock: this.now() });
      sourceLabel = repo ? `${repo} (>${agingDays}d)` : 'GitHub Issues';
      artifactItems = items;
    } else {
      let sheetData: SheetSummaryData | null = null;
      if (Array.isArray(rawResult)) {
        sheetData = { values: rawResult as any };
      } else if (rawResult && typeof rawResult === 'object') {
        sheetData = rawResult as SheetSummaryData;
      }
      if (!sheetData) return rawOutput;
      kind = 'sheets_summary';
      const sheetTitle =
        typeof readArgs.range === 'string'
          ? readArgs.range.split('!')[0]?.replace(/^'|'$/g, '') || 'Sheet1'
          : typeof readArgs.sheet === 'string'
            ? readArgs.sheet
            : 'Sheet1';
      rendered = renderSheetSummaryReport(sheetData, { sheetName: sheetTitle });
      sourceLabel = `${typeof readArgs.spreadsheetId === 'string' ? readArgs.spreadsheetId : 'Spreadsheet'} (${sheetTitle})`;
      artifactItems = Array.isArray(rawResult) ? rawResult : [rawResult];
    }

    const artifact = this.reportEvidenceStore.createArtifact({
      kind,
      sourceTool: readTool,
      sourceLabel,
      items: artifactItems,
      renderedText: rendered.text,
      actor: {
        userId: input.actor?.userId ?? 'anonymous',
        workspaceId: input.actor?.workspaceId ?? 'default',
      },
    });

    for (const target of targets) {
      const step = parsed.steps.find((s: any) => s.id === target.stepId);
      step.args[target.argument] = artifact.renderedText;
    }
    parsed.reportEvidence = {
      artifactId: artifact.id,
      kind,
      stepId: primary.stepId,
      argument: primary.argument,
      sourceTool: readTool,
      sourceLabel,
      readAt: artifact.createdAt,
      itemCount: rendered.itemCount,
      coverage: rendered.coverage,
      contentHash: artifact.contentHash,
    };
    return JSON.stringify(parsed);
  }

  /** The services a schedule's request needs, by the same router as planning; the model never names them. */
  routeSchedule(request: string): RoutedIntent {
    return routeIntent(request, this.toolCatalog, this.serviceRegistry);
  }

  /**
   * Routes the turn. In a conversation with a schedule, the schedule's services
   * join the routed ones, and only a service this message names can refuse the
   * turn: managing the schedule needs none of its services, which the request
   * that created it may have named before one was unconfigured.
   */
  private route(text: string, input: ProcessMessageInput): RoutedIntent {
    const route = routeIntent(text, this.toolCatalog, this.serviceRegistry);
    if (!input.schedule) return route;
    const current = text === input.userMessage ? route : routeIntent(input.userMessage, this.toolCatalog, this.serviceRegistry);
    if (current.unavailable.length > 0) return current;
    const routed = route.unavailable.length > 0 ? current.services : route.services;
    return { services: [...new Set([...routed, ...input.schedule.services])], unavailable: [] };
  }

  /**
   * A turn with no service tool is refused before the model, except in a
   * conversation with a schedule when the message names no unconfigured
   * service: pausing, resuming or cancelling the schedule needs no tool.
   */
  private refusedWithoutTools(activeTools: ToolDefinition[], route: RoutedIntent, input: ProcessMessageInput): boolean {
    if (activeTools.length > 0) return false;
    return !(input.schedule && this.scheduling(input) && route.unavailable.length === 0);
  }

  /** A scheduled run plans with the prompt of schedules off. */
  private scheduling(input: ProcessMessageInput): boolean {
    return this.schedules && !input.scheduledRun;
  }

  /** With schedules on, a schedule goes through validateSchedule; any other output keeps the plan path. */
  private scheduleValidation(output: string, input: ProcessMessageInput): ValidationResult | null {
    if (!this.schedules) return null;
    let kind: unknown;
    try { kind = JSON.parse(output)?.kind; } catch { return null; }
    if (kind !== 'schedule') return null;
    return validateSchedule(output, { enabled: !input.scheduledRun, now: this.now(), timeZone: this.timeZone, hasSchedule: Boolean(input.schedule) });
  }

  private async gather(input: ProcessMessageInput): Promise<PlannerResponse | undefined> {
    const { memory, userMessage, signal, onGatherEvent } = input;
    const bindings = memory.getEntity<Record<string, string>>('__gatherBindings') ?? {};
    const pending = memory.getEntity<PendingGather>('__gatherPending');
    if (pending) {
      const choice = userMessage.trim();
      const selected = pending.candidates.find((c) =>
        c.id === choice || c.name.toLocaleLowerCase() === choice.toLocaleLowerCase()
      ) ?? (Number.isInteger(Number(choice)) ? pending.candidates[Number(choice) - 1] : undefined);
      if (!selected) {
        return { kind: 'clarification', question: `Bạn muốn chọn ${pending.key} nào?`,
          options: pending.candidates.map((c) => c.name), context: `Chọn một kết quả cho ${pending.query}` };
      }
      memory.setEntity(pending.key, selected);
      bindings[pending.key] = pending.query;
      memory.setEntity('__gatherBindings', bindings);
      memory.deleteEntity('__gatherPending');
    }

    const intent = memory.getEntity<string>('__gatherIntent') || userMessage;
    const missing = memory.getEntity<{ key: string }>('__gatherMissing');
    const rules = this.serviceRegistry.flatMap((service) => service.gatherRules ?? [])
      .filter((rule) => this.toolCatalog.some((tool) => tool.name === rule.tool && tool.sideEffect === 'read'));
    const serviceNames = new Set(this.serviceRegistry.flatMap((service) => [service.id, service.name].map((name) => name.toLocaleLowerCase())));
    // A reply that names the missing resource itself ("kênh general") is searched by that name, not as a whole.
    const requests: GatherRequest[] = entityNames(intent === userMessage ? [intent] : [userMessage, intent], rules, serviceNames)
      .map(({ fromMessage, ...request }) => missing?.key === request.key && fromMessage > 0 ? { ...request, query: userMessage.trim() } : request);
    if (missing && !requests.some((request) => request.key === missing.key)) {
      const rule = rules.find((candidate) => candidate.entityKey === missing.key);
      if (rule) requests.unshift({ key: missing.key, query: userMessage.trim(), rule });
    }
    if (missing) memory.deleteEntity('__gatherMissing');
    if (requests.length === 0) return;
    if (!this.gatherSearch) {
      return { kind: 'clarification', question: 'Vui lòng cung cấp ID đã xác minh của các tài nguyên được nêu.',
        context: 'Công cụ tra cứu chưa khả dụng nên chưa thể xác định tài nguyên an toàn.' };
    }
    for (const request of requests) {
      const resolved = memory.getEntity<GatherCandidate>(request.key);
      if (resolved && (bindings[request.key]?.toLocaleLowerCase() === request.query.toLocaleLowerCase() ||
        (!bindings[request.key] && resolved.name?.toLocaleLowerCase() === request.query.toLocaleLowerCase()))) continue;
      if (resolved) for (const dependent of request.rule.invalidates ?? []) memory.deleteEntity(dependent);
      const tool = this.toolCatalog.find((candidate) => candidate.name === request.rule.tool);
      if (!tool || tool.sideEffect !== 'read' || !tool.name.includes('.search_')) {
        throw new Error(`Gather tool ${request.rule.tool} is unavailable or not read-only`);
      }
      const args: Record<string, unknown> = { query: request.query, limit: 5 };
      if (request.rule.requires) {
        const required = request.rule.requires;
        const parent = memory.getEntity<GatherCandidate>(required.entityKey);
        if (!parent?.id) {
          memory.setEntity('__gatherIntent', intent);
          memory.setEntity('__gatherMissing', { key: required.entityKey });
          return { kind: 'clarification', question: required.question, context: required.context };
        }
        args[required.argument] = parent.id;
      }
      onGatherEvent?.({ tool: request.rule.tool, status: 'started' });
      const candidates = asCandidates(await this.gatherSearch({ tool: request.rule.tool, args, signal, actor: input.actor }), request.rule.nameField);
      onGatherEvent?.({ tool: request.rule.tool, status: 'completed', output: candidates });
      if (candidates.length === 0) {
        memory.setEntity('__gatherIntent', intent);
        memory.setEntity('__gatherMissing', { key: request.key });
        return { kind: 'clarification', question: `Không tìm thấy ${request.query}. Vui lòng cung cấp tên ${request.key} khác.`,
          context: `Không có ${request.key} phù hợp với kết quả tra cứu.` };
      }
      const exact = candidates.filter((c) => c.name.toLocaleLowerCase() === request.query.toLocaleLowerCase());
      if (exact.length === 1 || candidates.length === 1) {
        memory.setEntity(request.key, exact[0] ?? candidates[0]);
        bindings[request.key] = request.query;
        memory.setEntity('__gatherBindings', bindings);
      } else {
        memory.setEntity('__gatherPending', { key: request.key, query: request.query, candidates });
        memory.setEntity('__gatherIntent', intent);
        return { kind: 'clarification', question: `Bạn muốn chọn ${request.key} nào?`,
          options: candidates.map((c) => c.name), context: `Có nhiều kết quả phù hợp với ${request.query}.` };
      }
    }
    memory.deleteEntity('__gatherIntent');
    return;
  }

  /** Runs the model's search calls; only read tools that pass schema checks reach the service. */
  private async runSearches(
    calls: Array<{ tool: string; args: Record<string, unknown> }>,
    activeTools: ToolDefinition[],
    input: ProcessMessageInput,
  ): Promise<SearchOutcome[]> {
    const { signal } = input;
    // The calls of one request are independent, so they run in parallel.
    return Promise.all(calls.map(async (call): Promise<SearchOutcome> => {
      const prepared = prepareSearchCall(call, activeTools);
      if ('error' in prepared) return { tool: call.tool, args: call.args, error: prepared.error };
      const tool = activeTools.find((candidate) => candidate.name === call.tool)!;
      // Remember the parent a scoped search ran under, e.g. the board of a member.
      const stamp = Object.fromEntries(Object.entries(tool.inputSchema.properties ?? {})
        .filter(([name, schema]) => typeof (schema as any)['x-resource'] === 'string' && typeof prepared.args[name] === 'string')
        .map(([name]) => [name, prepared.args[name]]));
      const outcome = await this.lookup(tool, prepared.args, signal, input, stamp);
      if (outcome.error !== undefined && signal?.aborted) throw signal.reason ?? new Error('Planning was aborted');
      return outcome;
    }));
  }

  /** One read-only call to a service; results are remembered under the resource the tool discovers. */
  private async lookup(
    tool: ToolDefinition,
    args: Record<string, unknown>,
    signal: AbortSignal | undefined,
    input: ProcessMessageInput,
    stamp: Record<string, unknown> = {},
  ): Promise<SearchOutcome> {
    const { memory, onGatherEvent } = input;
    if (!this.gatherSearch) return { tool: tool.name, args, error: 'Search is unavailable in this session' };
    onGatherEvent?.({ tool: tool.name, status: 'started' });
    try {
      const raw = await this.gatherSearch({ tool: tool.name, args, signal, actor: input.actor });
      const list = searchEntities(raw, tool.outputSchema);
      if (signal?.aborted) throw signal.reason ?? new Error('Lookup was aborted');
      const sanitized = (sanitizeEntities(list) as unknown[]) ?? [];
      const result = sanitized.slice(0, MAX_RESULTS_PER_CALL);
      if (tool.discovers) {
        const enrichedStamp: Record<string, unknown> = { ...stamp };
        if (input.actor?.workspaceId && !enrichedStamp.workspaceId) {
          enrichedStamp.workspaceId = input.actor.workspaceId;
        }
        if (tool.service === 'myjira') {
          const siteId = typeof args.siteId === 'string'
            ? args.siteId
            : (typeof enrichedStamp.siteId === 'string' ? (enrichedStamp.siteId as string) : undefined);
          if (siteId) {
            const observedMap = memory.getEntity<Record<string, Array<Record<string, unknown>>>>('__observed');
            const observedSites = observedMap?.jira_site ?? [];
            const explicitSites = memory.getEntity<Array<Record<string, unknown>>>('jira_site') ?? [];
            const allSites = [...observedSites, ...explicitSites];
            const matchedSite = allSites.find((s) => s.siteId === siteId || s.id === siteId);
            if (matchedSite?.cloudId && !enrichedStamp.cloudId) {
              enrichedStamp.cloudId = matchedSite.cloudId;
            }
            if (matchedSite?.workspaceId && !enrichedStamp.workspaceId) {
              enrichedStamp.workspaceId = matchedSite.workspaceId;
            }
          }
        }
        // `stamp` records the parent a result was found under, e.g. the board of a member.
        const stamped = result.map((entity) => (entity && typeof entity === 'object' ? { ...enrichedStamp, ...entity } : entity));
        memory.setEntity('__observed', recordObserved(memory.getEntity('__observed'), tool.discovers, stamped, tool.observedFields));
        if (tool.service === 'gmail' && tool.discovers === 'thread') {
          const labels = memory.getEntity('__labels') ?? {};
          memory.setEntity('__labels', { ...labels, thread: recordThreadLabels(labels.thread, stamped) });
        }
      }
      const workspaceRecipients = extractWorkspaceRecipients(tool.service, raw);
      if (workspaceRecipients.length > 0) {
        memory.setEntity('__observed', recordObserved(memory.getEntity('__observed'), 'recipient', workspaceRecipients, ['id', 'service']));
      }
      onGatherEvent?.({ tool: tool.name, status: 'completed', output: result });
      return { tool: tool.name, args, result };
    } catch (err: any) {
      onGatherEvent?.({ tool: tool.name, status: 'completed', output: [] });
      return { tool: tool.name, args, error: String(err?.message ?? err).slice(0, 300) };
    }
  }

  /**
   * Lists the workspace (boards, channels, repositories, then lists and members
   * of a few boards) before the first model call, so most requests can be planned
   * without search rounds. Bounded by a call cap and a time budget; whatever is
   * missing the model can still search for.
   */
  private async listDirectory(activeTools: ToolDefinition[], input: ProcessMessageInput): Promise<string[]> {
    const { memory } = input;
    const successful = new Set<string>();
    const budget = new AbortController();
    const timer = setTimeout(() => budget.abort(new Error('Directory lookup budget exceeded')), this.directoryBudgetMs);
    const signal = input.signal ? AbortSignal.any([input.signal, budget.signal]) : budget.signal;
    const expired = new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    const observed = () => memory.getEntity<Record<string, Array<Record<string, unknown>>>>('__observed') ?? {};
    const parentsOf = (tool: ToolDefinition) => Object.entries<Record<string, any>>(tool.inputSchema.properties ?? {})
      .filter(([name, property]) => (tool.inputSchema.required ?? []).includes(name) && property['x-resource'])
      .map(([argument, property]) => ({ argument, resource: property['x-resource'] as string }));
    const known = observed();
    const listable = activeTools.filter((tool) => tool.listable && tool.discovers && tool.sideEffect === 'read' && !known[tool.discovers]);
    const run = (calls: Array<{ tool: ToolDefinition; args: Record<string, unknown>; stamp?: Record<string, unknown> }>) =>
      Promise.race([Promise.all(calls.map(async (call) => {
        const outcome = await this.lookup(call.tool, call.args, signal, input, call.stamp);
        if (!signal.aborted && outcome.result !== undefined && outcome.error === undefined) successful.add(call.tool.service);
        return outcome;
      })), expired]);

    try {
      await run(listable.filter((tool) => parentsOf(tool).length === 0)
        .map((tool) => ({ tool, args: { query: '', limit: MAX_RESULTS_PER_CALL } })));
      if (signal.aborted) return [...successful];
      const children = listable.flatMap((tool) => {
        const parents = parentsOf(tool);
        if (parents.length !== 1) return [];
        const { argument, resource } = parents[0]!;
        const entities = observed()[resource] ?? [];
        if (entities.length === 0 || entities.length > MAX_DIRECTORY_PARENTS) return [];
        return entities.map((entity) => ({
          tool, args: { query: '', limit: MAX_RESULTS_PER_CALL, [argument]: entity.id }, stamp: { [argument]: entity.id },
        }));
      });
      await run(children.slice(0, MAX_DIRECTORY_CALLS));
    } finally {
      clearTimeout(timer);
      budget.abort();
    }
    return [...successful];
  }

  /**
   * Model-driven planning: the model may answer with a search request, the
   * results come back as data, and the loop ends with a plan, clarification or
   * refusal. Every step is bounded, and plans must still be grounded in IDs the
   * model actually saw, typed by the user, or took from earlier steps.
   */
  private async planWithSearch(input: ProcessMessageInput): Promise<PlannerResponse> {
    const { userMessage, history = [], memory, signal } = input;
    const conversation: ChatMessage[] = [...history, { role: 'user', content: userMessage }];
    const userTexts = conversation.filter((message) => message.role === 'user').map((message) => message.content);
    const groundingUserTexts = relevantGroundingUserTexts(history, userMessage);

    // Route on the whole conversation: a short answer such as "Minh Anh" names no service.
    const route = this.route(userTexts.join('\n'), input);
    const activeTools = this.toolCatalog.filter((tool) => route.services.includes(tool.service));
    if (this.refusedWithoutTools(activeTools, route, input)) return unroutable(route.unavailable);

    if (signal?.aborted) throw signal.reason ?? new Error('Planning was aborted');

    const systemPrompt = buildSystemPrompt(activeTools, { now: this.now(), timeZone: this.timeZone },
      { search: Boolean(this.gatherSearch), readAnswers: this.readAnswers, schedules: this.scheduling(input) });
    let searchRounds = 0;
    let rejectedPlans = 0;
    const successfulReads: SearchOutcome[] = [];
    let usedDirectory: string[] = [];
    // Changing a schedule needs no resources: they are looked up when each run is planned.
    if (this.prefetchDirectory && this.gatherSearch && !input.schedule) {
      usedDirectory = await this.measure('prefetch', input, () => this.listDirectory(activeTools, input));
      if (signal?.aborted) throw signal.reason ?? new Error('Planning was aborted');
    }
    // Search rounds, one final answer, and one correction of a rejected plan.
    for (let call = 0; call < this.maxSearchRounds + 2; call++) {
      const output = await this.provider.generatePlan({
        systemPrompt, conversationHistory: conversation, toolCatalog: activeTools, workingMemory: providerMemory(memory.getAll()), signal,
      });

      const request = parseSearchRequest(output);
      if (request) {
        conversation.push({ role: 'assistant', content: output });
        if ('error' in request) {
          conversation.push({ role: 'user', content: `Your search request was invalid: ${request.error}` });
        } else if (searchRounds >= this.maxSearchRounds) {
          conversation.push({ role: 'user', content: 'The search limit was reached, so no more searches are allowed. Answer now with a plan, or ask the user for what is still missing.' });
        } else {
          searchRounds++;
          const outcomes = await this.measure('search', input, () => this.runSearches(request.calls, activeTools, input));
          successfulReads.push(...outcomes.filter(outcome => outcome.result !== undefined && outcome.error === undefined));
          conversation.push({ role: 'user', content: formatSearchResults(outcomes, { readAnswers: this.readAnswers }) });
        }
        continue;
      }

      let answerOutput = false;
      try { answerOutput = this.readAnswers && JSON.parse(output)?.kind === 'answer'; } catch { /* Normal JSON validation reports this. */ }
      const boundOutput = answerOutput
        ? output
        : await this.bindReportEvidenceIfApplicable(output, input, successfulReads, groundingUserTexts);
      const validation = answerOutput ? validateAnswer(output, { readAnswers: this.readAnswers,
        hasReadData: asksForPullRequests(userTexts)
          ? successfulReads.some((read) => read.tool === 'github.list_pull_requests' && read.error === undefined && read.result !== undefined)
          : asksForCalendarEvents(userTexts)
            ? successfulReads.some((read) => read.tool.endsWith('.list_events') && read.error === undefined && read.result !== undefined)
            : successfulReads.length > 0 || usedDirectory.length > 0 }) : this.scheduleValidation(boundOutput, input) ?? validatePlan(boundOutput, activeTools,
        {
          ...(this.requireGroundedResources ? { grounding: { memory: groundingMemory(memory.getAll(), memory.getEntity('__observed')), userTexts: groundingUserTexts } } : {}),
          reportEvidenceStore: this.reportEvidenceStore,
        });
      if (validation.valid) {
        if (validation.parsed.kind === 'answer') return { ...validation.parsed,
          lookups: successfulReads.map(answerLookup), usedDirectory };
        return validation.parsed;
      }
      if (validation.code === 'READ_ONLY_PLAN') return readOnlyQuestion();

      if (++rejectedPlans > 1) {
        // A turn let through without tools for its schedule ends as it would have without one.
        if (activeTools.length === 0) return unroutable(route.unavailable);
        if (answerOutput) return readOnlyQuestion();
        if (validation.layer === 'grounding' && validation.ungrounded) {
          const resources = [...new Set(validation.ungrounded.map((u) => u.resource))];
          return {
            kind: 'clarification',
            question: resources.includes('recipient') ? 'Bạn muốn gửi tới địa chỉ email nào?' : `Bạn muốn dùng tài nguyên ${resources.join(', ')} nào?`,
            context: `Chưa xác minh được các giá trị này qua dịch vụ đã kết nối: ${validation.ungrounded
              .map((u) => `${u.argument}=${JSON.stringify(u.value)}`).join(', ')}. Vui lòng nêu tên tài nguyên hoặc ID chính xác.`,
          };
        }
        throw new Error(`Validation failed after retry: [${validation.layer}] ${validation.error}`);
      }
      conversation.push({ role: 'assistant', content: output });
      conversation.push({
        role: 'user',
        content: `Your previous response failed validation (${validation.layer} error):\n${validation.error}\nPlease fix the plan and return only the corrected valid JSON response.`,
      });
    }

    return {
      kind: 'clarification',
      question: 'Chưa hoàn tất việc tra cứu tài nguyên. Bạn muốn dùng board, list hoặc channel nào?',
      context: 'Đã đạt giới hạn tra cứu trước khi có thể lập kế hoạch.',
    };
  }

  async processMessage(input: ProcessMessageInput): Promise<PlannerResponse> {
    input = { ...input, timingStarted: performance.now() };
    if (this.searchMode === 'llm') return this.planWithSearch(input);
    const { userMessage, history = [], memory, signal } = input;

    // Gather may clear this key after resolving the answer; keep the original
    // workflow for both service routing and the final provider turn.
    const originalIntent = memory.getEntity<string>('__gatherIntent');
    const gathered = await this.measure('gather', input, () => this.gather(input));
    if (gathered) return gathered;
    // This planning turn consumes a pending intent even when gather had nothing to resolve.
    memory.deleteEntity('__gatherIntent');
    const planningMessage = originalIntent
      ? `Original request: ${originalIntent}\nClarification answer: ${userMessage}`
      : userMessage;

    // 1. Hierarchical Routing: filter tool catalog by intent
    const route = this.route(originalIntent ?? userMessage, input);
    const activeTools = this.toolCatalog.filter((tool) => route.services.includes(tool.service));
    if (this.refusedWithoutTools(activeTools, route, input)) return unroutable(route.unavailable);

    // 2. Prepare System Prompt & Conversation
    const systemPrompt = buildSystemPrompt(activeTools, { now: this.now(), timeZone: this.timeZone }, { schedules: this.scheduling(input) });
    const conversationHistory: ChatMessage[] = [
      ...history,
      { role: 'user', content: planningMessage },
    ];

    const groundingUserTexts = relevantGroundingUserTexts(history, planningMessage);
    const validationOptions = {
      ...(this.requireGroundedResources ? { grounding: {
        memory: groundingMemory(memory.getAll(), memory.getEntity('__observed')),
        userTexts: groundingUserTexts,
      } } : {}),
      reportEvidenceStore: this.reportEvidenceStore,
    };

    // 3. Attempt 1: Call LLM provider
    const firstRawOutput = await this.provider.generatePlan({
      systemPrompt,
      conversationHistory,
      toolCatalog: activeTools,
      workingMemory: providerMemory(memory.getAll()),
      signal,
    });
    const firstOutput = await this.bindReportEvidenceIfApplicable(firstRawOutput, input, [], groundingUserTexts);

    const firstValidation = this.scheduleValidation(firstOutput, input) ?? validatePlan(firstOutput, activeTools, validationOptions);
    if (firstValidation.valid) {
      return firstValidation.parsed;
    }
    if (firstValidation.code === 'READ_ONLY_PLAN') return readOnlyQuestion();

    // 4. Attempt 2: Retry exactly 1x with feedback
    const feedbackTurn: ChatMessage[] = [
      ...conversationHistory,
      { role: 'assistant', content: firstRawOutput },
      {
        role: 'user',
        content: `Your previous response failed validation (${firstValidation.layer} error):\n${firstValidation.error}\nPlease fix the plan and return only the corrected valid JSON response.`,
      },
    ];

    const retryRawOutput = await this.provider.generatePlan({
      systemPrompt,
      conversationHistory: feedbackTurn,
      toolCatalog: activeTools,
      workingMemory: providerMemory(memory.getAll()),
      signal,
    });
    const retryOutput = await this.bindReportEvidenceIfApplicable(retryRawOutput, input, [], groundingUserTexts);

    const retryValidation = this.scheduleValidation(retryOutput, input) ?? validatePlan(retryOutput, activeTools, validationOptions);
    if (retryValidation.valid) {
      return retryValidation.parsed;
    }
    if (retryValidation.code === 'READ_ONLY_PLAN') return readOnlyQuestion();
    // A turn let through without tools for its schedule ends as it would have without one.
    if (activeTools.length === 0) return unroutable(route.unavailable);

    // Never preview a plan built on invented IDs; ask for the resources and
    // keep the original request so the answer resumes the same workflow.
    if (retryValidation.layer === 'grounding' && retryValidation.ungrounded) {
      memory.setEntity('__gatherIntent', originalIntent ?? userMessage);
      const resources = [...new Set(retryValidation.ungrounded.map((u) => u.resource))];
      return {
        kind: 'clarification',
        question: resources.includes('recipient') ? 'Bạn muốn gửi tới địa chỉ email nào?' : `Bạn muốn dùng tài nguyên ${resources.join(', ')} nào?`,
        context: `Chưa xác minh được các giá trị này qua dịch vụ đã kết nối: ${retryValidation.ungrounded
          .map((u) => `${u.argument}=${JSON.stringify(u.value)}`).join(', ')}. Vui lòng nêu tên tài nguyên (ví dụ "board Frontend list To Do") hoặc ID chính xác.`,
      };
    }

    // If both failed, throw error
    throw new Error(
      `Validation failed after retry: [${retryValidation.layer}] ${retryValidation.error}`
    );
  }
}
