import type { ToolDefinition, PlannerResponse } from '@wap/tool-schemas';
import type { LLMProvider, ChatMessage } from './types.js';
import { WorkingMemory } from './working-memory.js';
import { classifyIntent, type TargetService } from './router.js';
import { validatePlan } from './validator.js';
import { buildSystemPrompt } from './prompts/system-prompt.js';

export interface AIPlannerOptions {
  provider: LLMProvider;
  toolCatalog: ToolDefinition[];
  gatherSearch?: (request: GatherSearchRequest) => Promise<unknown>;
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

function entityNames(message: string): Array<{ key: string; query: string; tool: string }> {
  const patterns: Array<[string, string, RegExp]> = [
    ['board', 'trello.search_boards', /\b(?:board|bảng)\s+["']?([\p{L}\p{N}_-]+)["']?/iu],
    ['list', 'trello.search_lists', /\b(?:list|danh sách)\s+["']?([\p{L}\p{N}_-]+(?:\s+[\p{L}\p{N}_-]+)?)["']?/iu],
    ['member', 'trello.search_members', /\b(?:member|gán|assign(?:\s+to)?)\s+["']?([\p{L}\p{N}_-]+)["']?/iu],
    ['channel', 'slack.search_channels', /(?:#|\b(?:channel|kênh)\s+)["']?([\p{L}\p{N}_-]+)["']?/iu],
  ];
  return patterns.flatMap(([key, tool, pattern]) => {
    const query = pattern.exec(message)?.[1]?.trim();
    return query ? [{ key, query, tool }] : [];
  });
}

function asCandidates(value: unknown): GatherCandidate[] {
  if (!Array.isArray(value)) throw new Error('Gather search must return an array');
  return value.map((item) => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string') {
      throw new Error('Gather search returned an item without an ID');
    }
    const name = item.name ?? item.fullName;
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

  constructor(options: AIPlannerOptions) {
    this.provider = options.provider;
    this.toolCatalog = options.toolCatalog;
    this.gatherSearch = options.gatherSearch;
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
    const requests = entityNames(intent).map((request) =>
      missing?.key === request.key ? { ...request, query: userMessage.trim() } : request
    );
    if (missing?.key === 'board' && !requests.some((request) => request.key === 'board')) {
      requests.unshift({ key: 'board', query: userMessage.trim(), tool: 'trello.search_boards' });
    }
    if (missing) memory.deleteEntity('__gatherMissing');
    if (requests.length === 0) return;
    if (!this.gatherSearch) {
      return { kind: 'clarification', question: 'Please provide the verified IDs for the named board, list, member or channel.',
        context: 'Search tools are unavailable, so names cannot be resolved safely.' };
    }
    for (const request of requests) {
      const resolved = memory.getEntity<GatherCandidate>(request.key);
      if (resolved && (bindings[request.key]?.toLocaleLowerCase() === request.query.toLocaleLowerCase() ||
        (!bindings[request.key] && resolved.name?.toLocaleLowerCase() === request.query.toLocaleLowerCase()))) continue;
      if (request.key === 'board' && resolved) memory.deleteEntity('list');
      const tool = this.toolCatalog.find((candidate) => candidate.name === request.tool);
      if (!tool || tool.sideEffect !== 'read' || !tool.name.includes('.search_')) {
        throw new Error(`Gather tool ${request.tool} is unavailable or not read-only`);
      }
      const args: Record<string, unknown> = { query: request.query, limit: 5 };
      if (request.tool === 'trello.search_lists') {
        const board = memory.getEntity<GatherCandidate>('board');
        if (!board?.id) {
          return { kind: 'clarification', question: 'Which board contains this list?',
            context: 'A board must be selected before searching lists.' };
        }
        args.boardId = board.id;
      } else if (request.tool === 'trello.search_members') {
        const board = memory.getEntity<GatherCandidate>('board');
        if (!board?.id) {
          memory.setEntity('__gatherIntent', intent);
          memory.setEntity('__gatherMissing', { key: 'board' });
          return { kind: 'clarification', question: 'Which board contains this member?',
            context: 'A board must be selected before searching members.' };
        }
        args.boardId = board.id;
      }
      onGatherEvent?.({ tool: request.tool, status: 'started' });
      const candidates = asCandidates(await this.gatherSearch({ tool: request.tool, args, signal }));
      onGatherEvent?.({ tool: request.tool, status: 'completed', output: candidates });
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

  async processMessage(input: ProcessMessageInput): Promise<PlannerResponse> {
    const { userMessage, history = [], memory, signal } = input;

    // Gather may clear this key after resolving the answer; keep the original
    // workflow for both service routing and the final provider turn.
    const originalIntent = memory.getEntity<string>('__gatherIntent');
    const gathered = await this.gather(input);
    if (gathered) return gathered;
    const planningMessage = originalIntent
      ? `Original request: ${originalIntent}\nClarification answer: ${userMessage}`
      : userMessage;

    // 1. Hierarchical Routing: filter tool catalog by intent
    const targetServices = classifyIntent(originalIntent ?? userMessage);
    const activeTools = this.toolCatalog.filter((tool) =>
      targetServices.includes(tool.service as TargetService)
    );

    // 2. Prepare System Prompt & Conversation
    const systemPrompt = buildSystemPrompt(activeTools);
    const conversationHistory: ChatMessage[] = [
      ...history,
      { role: 'user', content: planningMessage },
    ];

    // 3. Attempt 1: Call LLM provider
    const firstOutput = await this.provider.generatePlan({
      systemPrompt,
      conversationHistory,
      toolCatalog: activeTools,
      workingMemory: memory.getAll(),
      signal,
    });

    const firstValidation = validatePlan(firstOutput, activeTools);
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

    const retryValidation = validatePlan(retryOutput, activeTools);
    if (retryValidation.valid) {
      return retryValidation.parsed;
    }

    // If both failed, throw error
    throw new Error(
      `Validation failed after retry: [${retryValidation.layer}] ${retryValidation.error}`
    );
  }
}
