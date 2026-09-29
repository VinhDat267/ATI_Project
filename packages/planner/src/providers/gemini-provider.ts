import { GoogleGenAI } from '@google/genai';
import type { LLMProvider, LLMGeneratePlanInput } from '../types.js';

/** The slice of the Gemini SDK the provider uses; injectable for tests. */
export interface GeminiClient {
  models: {
    generateContent(request: {
      model: string;
      contents: Array<{ role: string; parts: Array<{ text: string }> }>;
      config?: { systemInstruction?: string; responseMimeType?: string; abortSignal?: AbortSignal };
    }): Promise<{ text?: string }>;
  };
}

export interface GeminiProviderConfig {
  apiKey?: string;
  model?: string;
  client?: GeminiClient;
  /** Per-attempt deadline; the request is aborted when it elapses. */
  timeoutMs?: number;
  /** Retries after a transient failure (429 or 5xx); other errors fail fast. */
  maxRetries?: number;
  /** Base backoff; attempt n waits retryDelayMs * 2^(n-1). */
  retryDelayMs?: number;
}

const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);

function isTransient(err: unknown): boolean {
  const status = (err as { status?: unknown })?.status;
  return typeof status === 'number' && TRANSIENT_STATUS.has(status);
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error('Gemini request aborted');
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortReason(signal));
    const onAbort = () => { clearTimeout(timer); reject(abortReason(signal!)); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export class GeminiProvider implements LLMProvider {
  public readonly name = 'gemini';
  private apiKey: string;
  private model: string;
  private client?: GeminiClient;
  private timeoutMs: number;
  private maxRetries: number;
  private retryDelayMs: number;

  constructor(config: GeminiProviderConfig = {}) {
    this.apiKey = config.apiKey || process.env.GEMINI_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY is required for GeminiProvider');
    }
    this.model = config.model || process.env.GEMINI_MODEL || 'gemini-3.8-flash';
    this.client = config.client;
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.maxRetries = config.maxRetries ?? 2;
    this.retryDelayMs = config.retryDelayMs ?? 1_000;
  }

  private getClient(): GeminiClient {
    this.client ??= new GoogleGenAI({ apiKey: this.apiKey });
    return this.client;
  }

  async generatePlan(input: LLMGeneratePlanInput): Promise<string> {
    const systemPrompt = `${input.systemPrompt}\n\nWorking Memory Context:\n${JSON.stringify(input.workingMemory, null, 2)}`;
    const contents = input.conversationHistory.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    for (let attempt = 0; ; attempt++) {
      if (input.signal?.aborted) throw abortReason(input.signal);
      try {
        return await this.attempt(systemPrompt, contents, input.signal);
      } catch (err) {
        if (input.signal?.aborted) throw abortReason(input.signal);
        if (!isTransient(err) || attempt >= this.maxRetries) throw err;
        await sleep(this.retryDelayMs * 2 ** attempt, input.signal);
      }
    }
  }

  private async attempt(
    systemInstruction: string,
    contents: Array<{ role: string; parts: Array<{ text: string }> }>,
    callerSignal?: AbortSignal,
  ): Promise<string> {
    const timeout = new AbortController();
    const timer = setTimeout(
      () => timeout.abort(new Error(`Gemini request timed out after ${this.timeoutMs}ms`)),
      this.timeoutMs,
    );
    const abortSignal = callerSignal ? AbortSignal.any([callerSignal, timeout.signal]) : timeout.signal;
    try {
      const response = await this.getClient().models.generateContent({
        model: this.model,
        contents,
        config: { systemInstruction, responseMimeType: 'application/json', abortSignal },
      });
      return response.text || '';
    } catch (err) {
      // Surface our own deadline rather than the SDK's generic abort error.
      if (timeout.signal.aborted && !callerSignal?.aborted) throw timeout.signal.reason;
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
