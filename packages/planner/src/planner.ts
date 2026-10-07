import { SERVICE_REGISTRY, type ToolDefinition, type PlannerResponse, type ServiceDefinition, type GatherRule } from '@wap/tool-schemas';
import type { LLMProvider, ChatMessage, PlanningPhaseMetrics } from './types.js';
import { WorkingMemory } from './working-memory.js';
import { routeIntent, unavailableServiceReason, type RoutedIntent } from './router.js';
import { validatePlan } from './validator.js';
import { buildSystemPrompt } from './prompts/system-prompt.js';
import {
  MAX_DIRECTORY_CALLS, MAX_DIRECTORY_PARENTS, MAX_RESULTS_PER_CALL, formatSearchResults, groundingMemory, parseSearchRequest, prepareSearchCall, recordObserved, searchEntities,
  type SearchOutcome,
} from './search.js';

export interface AIPlannerOptions {
  provider: LLMProvider;
  toolCatalog: ToolDefinition[];
  gatherSearch?: (request: GatherSearchRequest) => Promise<unknown>;
  serviceRegistry?: ServiceDefinition[];
  /**
   * Reject plans whose resource IDs were not looked up, typed by the user or
   * produced by an earlier step. Only canned providers that never read
   * working memory (sandbox fixtures) should disable this.
   */
  requireGroundedResources?: boolean;
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
  /** In 'llm' mode, list the workspace on the first model search request (default true). */
  prefetchDirectory?: boolean;
  /** Time allowed for that listing before planning continues without the rest (default 2500 ms). */
  directoryBudgetMs?: number;
}

export interface GatherSearchRequest {
  tool: string;
  args: Record<string, unknown>;
  signal?: AbortSignal;
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
}

interface GatherCandidate { id: string; name: string; [key: string]: unknown }
interface PendingGather { key: string; query: string; candidates: GatherCandidate[] }
interface GatherRequest { key: string; query: string; rule: GatherRule }

/** The first message naming a resource wins, so a clarification reply can name resources the original request left out. */
function entityNames(messages: string[], rules: GatherRule[]): GatherRequest[] {
  return rules.flatMap((rule) => {
    for (const message of messages) {
      const query = rule.pattern.exec(message)?.[1]?.trim();
      if (query) return [{ key: rule.entityKey, query, rule }];
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
function unroutable(unavailable: RoutedIntent['unavailable']): PlannerResponse {
  return { kind: 'refusal',
    reason: unavailable.length > 0 ? unavailableServiceReason(unavailable) : 'Dịch vụ được yêu cầu chưa khả dụng hoặc chưa được cấp quyền trong kết nối này.',
    suggestion: 'Hãy kết nối dịch vụ và cấp phạm vi tài nguyên được phép trước khi lập kế hoạch.',
    ...(unavailable.length > 0 ? { unavailableServices: unavailable } : {}) };
}

function readOnlyQuestion(): PlannerResponse {
  return { kind: 'clarification', question: 'Bạn muốn làm gì với dữ liệu này, chẳng hạn gửi thông báo, ghi vào bảng tính hoặc tạo công việc?',
    context: 'Kế hoạch cần ít nhất một hành động ghi. Hãy chọn hành động trên dịch vụ đã kết nối.' };
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
  private now: () => Date;
  private timeZone: string;
  private searchMode: 'regex' | 'llm';
  private maxSearchRounds: number;
  private prefetchDirectory: boolean;
  private directoryBudgetMs: number;

  constructor(options: AIPlannerOptions) {
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
    const requests = entityNames(intent === userMessage ? [intent] : [userMessage, intent], rules).map((request) =>
      missing?.key === request.key ? { ...request, query: userMessage.trim() } : request
    );
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
      const candidates = asCandidates(await this.gatherSearch({ tool: request.rule.tool, args, signal }), request.rule.nameField);
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
      const raw = await this.gatherSearch({ tool: tool.name, args, signal });
      const list = searchEntities(raw, tool.outputSchema);
      if (signal?.aborted) throw signal.reason ?? new Error('Lookup was aborted');
      const result = list.slice(0, MAX_RESULTS_PER_CALL);
      if (tool.discovers) {
        // `stamp` records the parent a result was found under, e.g. the board of a member.
        const stamped = result.map((entity) => (entity && typeof entity === 'object' ? { ...stamp, ...entity } : entity));
        memory.setEntity('__observed', recordObserved(memory.getEntity('__observed'), tool.discovers, stamped));
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
  private async listDirectory(activeTools: ToolDefinition[], input: ProcessMessageInput): Promise<void> {
    const { memory } = input;
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
      Promise.race([Promise.all(calls.map((call) => this.lookup(call.tool, call.args, signal, input, call.stamp))), expired]);

    try {
      await run(listable.filter((tool) => parentsOf(tool).length === 0)
        .map((tool) => ({ tool, args: { query: '', limit: MAX_RESULTS_PER_CALL } })));
      if (signal.aborted) return;
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

    // Route on the whole conversation: a short answer such as "Minh Anh" names no service.
    const route = routeIntent(userTexts.join('\n'), this.toolCatalog, this.serviceRegistry);
    const activeTools = this.toolCatalog.filter((tool) => route.services.includes(tool.service));
    if (activeTools.length === 0) return unroutable(route.unavailable);

    if (signal?.aborted) throw signal.reason ?? new Error('Planning was aborted');

    const systemPrompt = buildSystemPrompt(activeTools, { now: this.now(), timeZone: this.timeZone }, { search: Boolean(this.gatherSearch) });
    let searchRounds = 0;
    let rejectedPlans = 0;
    let directoryListed = false;
    // Search rounds, one final answer, and one correction of a rejected plan.
    for (let call = 0; call < this.maxSearchRounds + 2; call++) {
      const output = await this.provider.generatePlan({
        systemPrompt, conversationHistory: conversation, toolCatalog: activeTools, workingMemory: memory.getAll(), signal,
      });

      const request = parseSearchRequest(output);
      if (request) {
        conversation.push({ role: 'assistant', content: output });
        if ('error' in request) {
          conversation.push({ role: 'user', content: `Your search request was invalid: ${request.error}` });
        } else if (searchRounds >= this.maxSearchRounds) {
          conversation.push({ role: 'user', content: 'The search limit was reached, so no more searches are allowed. Answer now with a plan, or ask the user for what is still missing.' });
        } else {
          // Let the model decide whether any data is needed before doing I/O.
          // Clarification/refusal and already-grounded plans need no directory.
          if (!directoryListed && this.prefetchDirectory && this.gatherSearch) {
            directoryListed = true;
            await this.measure('prefetch', input, () => this.listDirectory(activeTools, input));
            if (signal?.aborted) throw signal.reason ?? new Error('Planning was aborted');
          }
          searchRounds++;
          conversation.push({ role: 'user', content: formatSearchResults(await this.measure('search', input, () => this.runSearches(request.calls, activeTools, input))) });
        }
        continue;
      }

      const validation = validatePlan(output, activeTools, this.requireGroundedResources ? { grounding: {
        memory: groundingMemory(memory.getAll(), memory.getEntity('__observed')), userTexts,
      } } : {});
      if (validation.valid) return validation.parsed;
      if (validation.code === 'READ_ONLY_PLAN') return readOnlyQuestion();

      if (++rejectedPlans > 1) {
        if (validation.layer === 'grounding' && validation.ungrounded) {
          const resources = [...new Set(validation.ungrounded.map((u) => u.resource))];
          return {
            kind: 'clarification',
            question: `Bạn muốn dùng tài nguyên ${resources.join(', ')} nào?`,
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
    const route = routeIntent(originalIntent ?? userMessage, this.toolCatalog, this.serviceRegistry);
    const activeTools = this.toolCatalog.filter((tool) => route.services.includes(tool.service));
    if (activeTools.length === 0) return unroutable(route.unavailable);

    // 2. Prepare System Prompt & Conversation
    const systemPrompt = buildSystemPrompt(activeTools, { now: this.now(), timeZone: this.timeZone });
    const conversationHistory: ChatMessage[] = [
      ...history,
      { role: 'user', content: planningMessage },
    ];

    const validationOptions = this.requireGroundedResources ? { grounding: {
      memory: memory.getAll(),
      userTexts: conversationHistory.filter((message) => message.role === 'user').map((message) => message.content),
    } } : {};

    // 3. Attempt 1: Call LLM provider
    const firstOutput = await this.provider.generatePlan({
      systemPrompt,
      conversationHistory,
      toolCatalog: activeTools,
      workingMemory: memory.getAll(),
      signal,
    });

    const firstValidation = validatePlan(firstOutput, activeTools, validationOptions);
    if (firstValidation.valid) {
      return firstValidation.parsed;
    }
    if (firstValidation.code === 'READ_ONLY_PLAN') return readOnlyQuestion();

    // 4. Attempt 2: Retry exactly 1x with feedback
    const feedbackTurn: ChatMessage[] = [
      ...conversationHistory,
      { role: 'assistant', content: firstOutput },
      {
        role: 'user',
        content: `Your previous response failed validation (${firstValidation.layer} error):\n${firstValidation.error}\nPlease fix the plan and return only the corrected valid JSON response.`,
      },
    ];

    const retryOutput = await this.provider.generatePlan({
      systemPrompt,
      conversationHistory: feedbackTurn,
      toolCatalog: activeTools,
      workingMemory: memory.getAll(),
      signal,
    });

    const retryValidation = validatePlan(retryOutput, activeTools, validationOptions);
    if (retryValidation.valid) {
      return retryValidation.parsed;
    }
    if (retryValidation.code === 'READ_ONLY_PLAN') return readOnlyQuestion();

    // Never preview a plan built on invented IDs; ask for the resources and
    // keep the original request so the answer resumes the same workflow.
    if (retryValidation.layer === 'grounding' && retryValidation.ungrounded) {
      memory.setEntity('__gatherIntent', originalIntent ?? userMessage);
      const resources = [...new Set(retryValidation.ungrounded.map((u) => u.resource))];
      return {
        kind: 'clarification',
        question: `Bạn muốn dùng tài nguyên ${resources.join(', ')} nào?`,
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
