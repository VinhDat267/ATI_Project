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
  /** Private source-processing gate; called before each actual transport attempt. */
  beforeModelAttempt?: (signal: AbortSignal) => Promise<void>;
  maxOutputTokens?: number;
}

export interface LLMProvider {
  readonly name: string;
  /** Implemented transports enforce a bounded output and a mandatory per-attempt hook. */
  readonly supportsModelBudget?: true;
  /** Diagnostic side channel; never includes request/response text or headers. */
  readonly lastCallMetrics?: ModelCallMetrics;
  generatePlan(input: LLMGeneratePlanInput): Promise<string>;
}

export interface ModelAttemptMetrics {
  startedAtMs: number;
  durationMs: number;
  outcome: 'success' | 'timeout' | 'transient' | 'cancelled' | 'error';
  status?: number;
  retryReason?: 'timeout' | `http_${number}`;
}
export interface ModelCallMetrics {
  durationMs: number;
  attempts: ModelAttemptMetrics[];
  servedModel?: string;
  usage: { totalTokens?:number|null; promptTokens: number | null; completionTokens: number | null; reasoningTokens: number | null };
}
export interface PlanningPhaseMetrics {
  phase: 'prefetch' | 'search' | 'gather';
  startedAtMs: number;
  durationMs: number;
}
