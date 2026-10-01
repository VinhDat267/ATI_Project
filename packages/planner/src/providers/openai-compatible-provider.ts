import type { LLMProvider, LLMGeneratePlanInput } from '../types.js';
import { callWithRetry } from './transport.js';

export interface OpenAICompatibleProviderConfig {
  /** Gateway root including the version segment, e.g. http://localhost:20128/v1 */
  baseUrl: string;
  apiKey?: string;
  model: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  /** Retries after the per-attempt deadline elapses (default 1). */
  timeoutRetries?: number;
  retryDelayMs?: number;
}

export class OpenAICompatibleError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'OpenAICompatibleError';
  }
}

/** Drops a gateway routing prefix such as "ag/" so served and requested names compare. */
function baseModel(name: string): string {
  return name.replace(/^[^/]+\//, '');
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => (part && typeof part === 'object' && typeof part.text === 'string' ? part.text : '')).join('');
  }
  return '';
}

/**
 * Chat Completions provider for OpenAI-compatible gateways (9router, OpenRouter,
 * Ollama, OpenAI). A completion served by a model other than the configured one
 * is rejected, so gateway fallback cannot silently change the evaluated model.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  public readonly name = 'openai-compatible';
  public readonly model: string;
  /** Model name reported by the gateway for the latest completion. */
  public lastServedModel?: string;
  private endpoint: string;
  private apiKey?: string;
  private fetchFn: typeof fetch;
  private timeoutMs: number;
  private maxRetries: number;
  private timeoutRetries: number;
  private retryDelayMs: number;

  constructor(config: OpenAICompatibleProviderConfig) {
    if (!config.baseUrl) throw new Error('LLM_BASE_URL is required for the OpenAI-compatible provider');
    if (!config.model) throw new Error('LLM_MODEL is required for the OpenAI-compatible provider');
    this.endpoint = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    this.model = config.model;
    this.apiKey = config.apiKey || undefined;
    this.fetchFn = config.fetch ?? fetch;
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.maxRetries = config.maxRetries ?? 2;
    this.timeoutRetries = config.timeoutRetries ?? 1;
    this.retryDelayMs = config.retryDelayMs ?? 1_000;
  }

  async generatePlan(input: LLMGeneratePlanInput): Promise<string> {
    const system = `${input.systemPrompt}\n\nWorking Memory Context:\n${JSON.stringify(input.workingMemory, null, 2)}`;
    const body = JSON.stringify({
      model: this.model,
      stream: false,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        ...input.conversationHistory.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
      ],
    });
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;

    return callWithRetry(async (signal) => {
      const response = await this.fetchFn(this.endpoint, { method: 'POST', headers, body, signal });
      const text = await response.text();
      if (!response.ok) {
        let detail = text.slice(0, 300);
        try { detail = String(JSON.parse(text)?.error?.message ?? detail).slice(0, 300); } catch { /* keep raw text */ }
        if (this.apiKey) detail = detail.split(this.apiKey).join('[redacted]');
        throw new OpenAICompatibleError(`LLM gateway returned ${response.status}: ${detail}`, response.status);
      }
      const json = JSON.parse(text) as { model?: unknown; choices?: Array<{ message?: { content?: unknown } }> };
      const served = typeof json.model === 'string' ? json.model : undefined;
      this.lastServedModel = served;
      if (served && baseModel(served) !== baseModel(this.model)) {
        throw new Error(`Completion was served by ${served}, not the configured ${this.model}; disable gateway fallback for this model`);
      }
      return messageText(json.choices?.[0]?.message?.content);
    }, {
      label: 'LLM gateway', timeoutMs: this.timeoutMs, maxRetries: this.maxRetries, timeoutRetries: this.timeoutRetries,
      retryDelayMs: this.retryDelayMs, signal: input.signal,
    });
  }
}
