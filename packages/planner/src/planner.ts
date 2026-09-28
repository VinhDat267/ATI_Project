import type { ToolDefinition, PlannerResponse } from '@wap/tool-schemas';
import type { LLMProvider, ChatMessage } from './types.js';
import { WorkingMemory } from './working-memory.js';
import { classifyIntent, type TargetService } from './router.js';
import { validatePlan } from './validator.js';
import { buildSystemPrompt } from './prompts/system-prompt.js';

export interface AIPlannerOptions {
  provider: LLMProvider;
  toolCatalog: ToolDefinition[];
}

export interface ProcessMessageInput {
  userMessage: string;
  history?: ChatMessage[];
  memory: WorkingMemory;
  signal?: AbortSignal;
}

export class AIPlanner {
  private provider: LLMProvider;
  private toolCatalog: ToolDefinition[];

  constructor(options: AIPlannerOptions) {
    this.provider = options.provider;
    this.toolCatalog = options.toolCatalog;
  }

  async processMessage(input: ProcessMessageInput): Promise<PlannerResponse> {
    const { userMessage, history = [], memory, signal } = input;

    // 1. Hierarchical Routing: filter tool catalog by intent
    const targetServices = classifyIntent(userMessage);
    const activeTools = this.toolCatalog.filter((tool) =>
      targetServices.includes(tool.service as TargetService)
    );

    // 2. Prepare System Prompt & Conversation
    const systemPrompt = buildSystemPrompt(activeTools);
    const conversationHistory: ChatMessage[] = [
      ...history,
      { role: 'user', content: userMessage },
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
