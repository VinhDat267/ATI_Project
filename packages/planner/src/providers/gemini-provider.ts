import { GoogleGenAI } from '@google/genai';
import type { LLMProvider, LLMGeneratePlanInput, ModelCallMetrics } from '../types.js';
import { callWithRetry, validateModelOutputLimit } from './transport.js';

/** The slice of the Gemini SDK the provider uses; injectable for tests. */
export interface GeminiClient {
  models: {
    generateContent(request: {
      model: string;
      contents: Array<{ role: string; parts: Array<{ text: string }> }>;
      config?: { systemInstruction?: string; responseMimeType?: string; abortSignal?: AbortSignal; maxOutputTokens?: number; httpOptions?: {retryOptions?: {attempts: number}} };
    }): Promise<{ text?: string;usageMetadata?:{promptTokenCount?:number;candidatesTokenCount?:number;thoughtsTokenCount?:number;totalTokenCount?:number} }>;
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
  /** Retries after the per-attempt deadline elapses (default 1). */
  timeoutRetries?: number;
  /** Base backoff; attempt n waits retryDelayMs * 2^(n-1). */
  retryDelayMs?: number;
}

export class GeminiProvider implements LLMProvider {
  public readonly name = 'gemini';
  public readonly supportsModelBudget = true as const;
  public lastCallMetrics?:ModelCallMetrics;
  private apiKey: string;
  public readonly model: string;
  private client?: GeminiClient;
  private timeoutMs: number;
  private maxRetries: number;
  private timeoutRetries: number;
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
    this.timeoutRetries = config.timeoutRetries ?? 1;
    this.retryDelayMs = config.retryDelayMs ?? 1_000;
  }

  private getClient(): GeminiClient {
    this.client ??= new GoogleGenAI({ apiKey: this.apiKey });
    return this.client;
  }

  async generatePlan(input: LLMGeneratePlanInput): Promise<string> {
    validateModelOutputLimit(input.maxOutputTokens);
    const systemPrompt = `${input.systemPrompt}\n\nWorking Memory Context:\n${JSON.stringify(input.workingMemory, null, 2)}`;
    const contents = input.conversationHistory.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const started=performance.now(),metrics:ModelCallMetrics={durationMs:0,attempts:[],usage:{promptTokens:null,completionTokens:null,reasoningTokens:null,totalTokens:null}};
    this.lastCallMetrics=metrics;
    try{return await callWithRetry(async (abortSignal) => {
      const response = await this.getClient().models.generateContent({
        model: this.model,
        contents,
        config: { systemInstruction: systemPrompt, responseMimeType: 'application/json', abortSignal,
          ...(input.maxOutputTokens !== undefined ? {maxOutputTokens: input.maxOutputTokens} : {}),
          ...(input.beforeModelAttempt ? {httpOptions: {retryOptions: {attempts: 1}}} : {}),
        },
      });
      const count=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:null,u=response.usageMetadata;
      metrics.usage={promptTokens:count(u?.promptTokenCount),completionTokens:count(u?.candidatesTokenCount),reasoningTokens:count(u?.thoughtsTokenCount),totalTokens:count(u?.totalTokenCount)};
      return response.text || '';
    }, {
      label: 'Gemini', timeoutMs: this.timeoutMs, maxRetries: this.maxRetries, timeoutRetries: this.timeoutRetries,
      retryDelayMs: this.retryDelayMs, signal: input.signal, beforeAttempt: input.beforeModelAttempt,onAttempt:attempt=>metrics.attempts.push(attempt),
    });}finally{metrics.durationMs=performance.now()-started;}
  }
}
