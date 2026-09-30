import { SERVICE_REGISTRY, type ToolDefinition, type PlannerResponse, type ServiceDefinition, type GatherRule } from '@wap/tool-schemas';
import type { LLMProvider, ChatMessage } from './types.js';
import { WorkingMemory } from './working-memory.js';
import { classifyIntent } from './router.js';
import { validatePlan } from './validator.js';
import { buildSystemPrompt } from './prompts/system-prompt.js';
import {
  MAX_RESULTS_PER_CALL, formatSearchResults, groundingMemory, parseSearchRequest, prepareSearchCall, recordObserved,
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

export class AIPlanner {
  private provider: LLMProvider;
  private toolCatalog: ToolDefinition[];
  private gatherSearch?: (request: GatherSearchRequest) => Promise<unknown>;
  private serviceRegistry: ServiceDefinition[];
  private requireGroundedResources: boolean;
  private now: () => Date;
  private timeZone: string;
  private searchMode: 'regex' | 'llm';
  private maxSearchRounds: number;

  constructor(options: AIPlannerOptions) {
    this.searchMode = options.searchMode ?? 'regex';
    this.maxSearchRounds = options.maxSearchRounds ?? 4;
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
        return { kind: 'clarification', question: `Which ${pending.key} do you mean?`,
          options: pending.candidates.map((c) => c.name), context: `Select a result for ${pending.query}` };
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
      return { kind: 'clarification', question: 'Please provide the verified IDs for the named resources.',
        context: 'Search tools are unavailable, so names cannot be resolved safely.' };
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
        return { kind: 'clarification', question: `I could not find ${request.query}. Please provide another ${request.key} name.`,
          context: `No ${request.key} matched the search.` };
      }
      const exact = candidates.filter((c) => c.name.toLocaleLowerCase() === request.query.toLocaleLowerCase());
      if (exact.length === 1 || candidates.length === 1) {
        memory.setEntity(request.key, exact[0] ?? candidates[0]);
        bindings[request.key] = request.query;
        memory.setEntity('__gatherBindings', bindings);
      } else {
        memory.setEntity('__gatherPending', { key: request.key, query: request.query, candidates });
        memory.setEntity('__gatherIntent', intent);
        return { kind: 'clarification', question: `Which ${request.key} do you mean?`,
          options: candidates.map((c) => c.name), context: `Multiple results matched ${request.query}.` };
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
    const { memory, signal, onGatherEvent } = input;
    const outcomes: SearchOutcome[] = [];
    for (const call of calls) {
      const prepared = prepareSearchCall(call, activeTools);
      if ('error' in prepared) {
        outcomes.push({ tool: call.tool, args: call.args, error: prepared.error });
        continue;
      }
      if (!this.gatherSearch) {
        outcomes.push({ tool: call.tool, args: prepared.args, error: 'Search is unavailable in this session' });
        continue;
      }
      onGatherEvent?.({ tool: call.tool, status: 'started' });
      try {
        const raw = await this.gatherSearch({ tool: call.tool, args: prepared.args, signal });
        // Search tools return lists; get_* tools return one object.
        const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : undefined;
        if (!list) throw new Error('The tool did not return a result');
        const result = list.slice(0, MAX_RESULTS_PER_CALL);
        const resource = activeTools.find((tool) => tool.name === call.tool)?.discovers;
        if (resource) {
          memory.setEntity('__observed', recordObserved(memory.getEntity('__observed'), resource, result));
        }
        onGatherEvent?.({ tool: call.tool, status: 'completed', output: result });
        outcomes.push({ tool: call.tool, args: prepared.args, result });
      } catch (err: any) {
        if (signal?.aborted) throw err;
        onGatherEvent?.({ tool: call.tool, status: 'completed', output: [] });
        outcomes.push({ tool: call.tool, args: prepared.args, error: String(err?.message ?? err).slice(0, 300) });
      }
    }
    return outcomes;
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
    const targetServices = classifyIntent(userTexts.join('\n'), this.toolCatalog, this.serviceRegistry);
    const activeTools = this.toolCatalog.filter((tool) => targetServices.includes(tool.service));
    if (activeTools.length === 0) {
      return { kind: 'refusal', reason: 'The requested service is not available or authorized in this connection.',
        suggestion: 'Connect the service with an allowed resource scope before planning this workflow.' };
    }

    const systemPrompt = buildSystemPrompt(activeTools, { now: this.now(), timeZone: this.timeZone }, { search: Boolean(this.gatherSearch) });
    let searchRounds = 0;
    let rejectedPlans = 0;
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
          searchRounds++;
          conversation.push({ role: 'user', content: formatSearchResults(await this.runSearches(request.calls, activeTools, input)) });
        }
        continue;
      }

      const validation = validatePlan(output, activeTools, this.requireGroundedResources ? { grounding: {
        memory: groundingMemory(memory.getAll(), memory.getEntity('__observed')), userTexts,
      } } : {});
      if (validation.valid) return validation.parsed;

      if (++rejectedPlans > 1) {
        if (validation.layer === 'grounding' && validation.ungrounded) {
          const resources = [...new Set(validation.ungrounded.map((u) => u.resource))];
          return {
            kind: 'clarification',
            question: `Which ${resources.join(', ')} should I use?`,
            context: `These values could not be verified against your connected services: ${validation.ungrounded
              .map((u) => `${u.argument}=${JSON.stringify(u.value)}`).join(', ')}. Name the resource or give its exact ID.`,
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
      question: 'I could not finish looking up the resources for this request. Which board, list or channel do you mean?',
      context: 'The lookup limit was reached before a plan could be built.',
    };
  }

  async processMessage(input: ProcessMessageInput): Promise<PlannerResponse> {
    if (this.searchMode === 'llm') return this.planWithSearch(input);
    const { userMessage, history = [], memory, signal } = input;

    // Gather may clear this key after resolving the answer; keep the original
    // workflow for both service routing and the final provider turn.
    const originalIntent = memory.getEntity<string>('__gatherIntent');
    const gathered = await this.gather(input);
    if (gathered) return gathered;
    // This planning turn consumes a pending intent even when gather had nothing to resolve.
    memory.deleteEntity('__gatherIntent');
    const planningMessage = originalIntent
      ? `Original request: ${originalIntent}\nClarification answer: ${userMessage}`
      : userMessage;

    // 1. Hierarchical Routing: filter tool catalog by intent
    const targetServices = classifyIntent(originalIntent ?? userMessage, this.toolCatalog, this.serviceRegistry);
    const activeTools = this.toolCatalog.filter((tool) =>
      targetServices.includes(tool.service)
    );
    if (activeTools.length === 0) {
      return { kind: 'refusal', reason: 'The requested service is not available or authorized in this connection.',
        suggestion: 'Connect the service with an allowed resource scope before planning this workflow.' };
    }

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

    // Never preview a plan built on invented IDs; ask for the resources and
    // keep the original request so the answer resumes the same workflow.
    if (retryValidation.layer === 'grounding' && retryValidation.ungrounded) {
      memory.setEntity('__gatherIntent', originalIntent ?? userMessage);
      const resources = [...new Set(retryValidation.ungrounded.map((u) => u.resource))];
      return {
        kind: 'clarification',
        question: `Which ${resources.join(', ')} should I use?`,
        context: `These values could not be verified against your connected services: ${retryValidation.ungrounded
          .map((u) => `${u.argument}=${JSON.stringify(u.value)}`).join(', ')}. Name the resource (for example "board Frontend list To Do") or give its exact ID.`,
      };
    }

    // If both failed, throw error
    throw new Error(
      `Validation failed after retry: [${retryValidation.layer}] ${retryValidation.error}`
    );
  }
}
