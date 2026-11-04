import type { LLMProvider, LLMGeneratePlanInput, ModelCallMetrics } from '../types.js';
import { callWithRetry, validateModelOutputLimit } from './transport.js';
import { OpenAICompatibleError } from './openai-compatible-provider.js';

export interface DeepSeekProviderConfig {
  /** DeepSeek API key (`DEEPSEEK_API_KEY`). */
  apiKey?: string;
  /** Model ID: 'deepseek-chat' (default, DeepSeek-V3.2 non-thinking) or 'deepseek-reasoner' (thinking mode). */
  model?: string;
  /** Optional API base URL (default: https://api.deepseek.com). */
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  timeoutRetries?: number;
  retryDelayMs?: number;
}

function baseModel(name: string): string {
  return name.replace(/^[^/]+\//, '');
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === 'object' && typeof part.text === 'string' ? part.text : ''))
      .join('');
  }
  return '';
}

function stripMarkdownFenceIfPresent(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1]!.trim() : raw;
}

/**
 * First-class DeepSeek API provider (`https://api.deepseek.com/chat/completions`).
 * Supports both `deepseek-chat` (JSON mode + max_tokens <= 8192) and
 * `deepseek-reasoner` (Chain-of-Thought reasoning_content + reasoning_tokens).
 */
export class DeepSeekProvider implements LLMProvider {
  public readonly name = 'deepseek';
  public readonly supportsModelBudget = true as const;
  public readonly model: string;
  public lastServedModel?: string;
  public lastCallMetrics?: ModelCallMetrics;
  private readonly endpoint: string;
  private readonly apiKey?: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly timeoutRetries: number;
  private readonly retryDelayMs: number;

  constructor(config: DeepSeekProviderConfig = {}) {
    const rawBase = (config.baseUrl || 'https://api.deepseek.com').trim().replace(/\/+$/, '');
    this.endpoint = `${rawBase}/chat/completions`;
    this.model = (config.model || 'deepseek-chat').trim();
    this.apiKey = config.apiKey?.trim() || undefined;
    this.fetchFn = config.fetch ?? fetch;
    const isReasoner = baseModel(this.model) === 'deepseek-reasoner';
    this.timeoutMs = config.timeoutMs ?? (isReasoner ? 60_000 : 30_000);
    this.maxRetries = config.maxRetries ?? 2;
    this.timeoutRetries = config.timeoutRetries ?? 1;
    this.retryDelayMs = config.retryDelayMs ?? 1_000;
  }

  async generatePlan(input: LLMGeneratePlanInput): Promise<string> {
    validateModelOutputLimit(input.maxOutputTokens);
    const started = performance.now();
    const metrics: ModelCallMetrics = {
      durationMs: 0,
      attempts: [],
      usage: { promptTokens: null, completionTokens: null, reasoningTokens: null },
    };
    this.lastCallMetrics = metrics;
    this.lastServedModel = undefined;

    const isReasoner = baseModel(this.model) === 'deepseek-reasoner';
    const maxTokensCeiling = isReasoner ? 65_536 : 8_192;
    const maxTokens =
      input.maxOutputTokens !== undefined ? Math.min(input.maxOutputTokens, maxTokensCeiling) : undefined;

    const system = `${input.systemPrompt}\n\nWorking Memory Context:\n${JSON.stringify(input.workingMemory, null, 2)}`;
    const body = JSON.stringify({
      model: this.model,
      stream: false,
      ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
      ...(isReasoner ? {} : { response_format: { type: 'json_object' } }),
      messages: [
        { role: 'system', content: system },
        ...input.conversationHistory.map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        })),
      ],
    });

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;

    try {
      return await callWithRetry(
        async (signal) => {
          const response = await this.fetchFn(this.endpoint, { method: 'POST', headers, body, signal });
          const text = await response.text();
          if (!response.ok) {
            let detail = text.slice(0, 300);
            try {
              detail = String(JSON.parse(text)?.error?.message ?? detail).slice(0, 300);
            } catch {
              /* keep raw text */
            }
            if (this.apiKey) detail = detail.split(this.apiKey).join('[redacted]');
            throw new OpenAICompatibleError(`DeepSeek API returned ${response.status}: ${detail}`, response.status);
          }

          const json = JSON.parse(text) as {
            model?: unknown;
            usage?: {
              prompt_tokens?: unknown;
              completion_tokens?: unknown;
              completion_tokens_details?: { reasoning_tokens?: unknown };
              prompt_tokens_details?: { reasoning_tokens?: unknown };
            };
            choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown } }>;
          };

          const served = typeof json.model === 'string' ? json.model : undefined;
          this.lastServedModel = served;
          metrics.servedModel = served;

          const count = (value: unknown) =>
            typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
          metrics.usage = {
            promptTokens: count(json.usage?.prompt_tokens),
            completionTokens: count(json.usage?.completion_tokens),
            reasoningTokens: count(
              json.usage?.completion_tokens_details?.reasoning_tokens ??
                json.usage?.prompt_tokens_details?.reasoning_tokens,
            ),
          };

          const confirmedDeepSeekAlias =
            (baseModel(this.model) === 'deepseek-chat' && served === 'deepseek-flash') ||
            (baseModel(this.model) === 'deepseek-reasoner' &&
              (served === 'deepseek-reasoner' || served === 'deepseek-r1' || served === 'deepseek-v3.2-reasoner'));
          if (served && baseModel(served) !== baseModel(this.model) && !confirmedDeepSeekAlias) {
            throw new Error(
              `Completion was served by ${served}, not the configured ${this.model}; disable gateway fallback for this model`,
            );
          }

          const rawContent = messageText(json.choices?.[0]?.message?.content);
          return stripMarkdownFenceIfPresent(rawContent);
        },
        {
          label: 'DeepSeek API',
          timeoutMs: this.timeoutMs,
          maxRetries: this.maxRetries,
          timeoutRetries: this.timeoutRetries,
          retryDelayMs: this.retryDelayMs,
          signal: input.signal,
          onAttempt: (attempt) => metrics.attempts.push(attempt),
          beforeAttempt: input.beforeModelAttempt,
        },
      );
    } finally {
      metrics.durationMs = performance.now() - started;
    }
  }
}
