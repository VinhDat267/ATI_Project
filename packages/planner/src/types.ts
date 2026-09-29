import type { ToolDefinition } from '@wap/tool-schemas';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'summary';
  content: string;
}

export interface LLMGeneratePlanInput {
  systemPrompt: string;
  conversationHistory: ChatMessage[];
  toolCatalog: ToolDefinition[];
  workingMemory: Record<string, any>;
  signal?: AbortSignal;
}

export interface LLMProvider {
  readonly name: string;
  generatePlan(input: LLMGeneratePlanInput): Promise<string>;
}
