import type { LLMProvider } from '../types.js';
import { GeminiProvider } from './gemini-provider.js';
import { OpenAICompatibleProvider } from './openai-compatible-provider.js';

export type LLMProviderKind = 'gemini' | 'openai-compatible';

/**
 * Selects the planning provider from environment settings:
 * LLM_PROVIDER=gemini (default) uses GEMINI_API_KEY/GEMINI_MODEL;
 * LLM_PROVIDER=openai-compatible uses LLM_BASE_URL, LLM_API_KEY, LLM_MODEL and
 * the optional LLM_HEDGE_AFTER_MS.
 */
export function createProviderFromEnv(env: Record<string, string | undefined> = process.env): LLMProvider & { model: string } {
  const kind = env.LLM_PROVIDER || 'gemini';
  if (kind === 'openai-compatible') {
    const hedgeAfterMs = env.LLM_HEDGE_AFTER_MS ? Number(env.LLM_HEDGE_AFTER_MS) : undefined;
    if (hedgeAfterMs !== undefined && !(Number.isFinite(hedgeAfterMs) && hedgeAfterMs > 0)) {
      throw new Error('LLM_HEDGE_AFTER_MS must be a positive number of milliseconds');
    }
    return new OpenAICompatibleProvider({
      baseUrl: env.LLM_BASE_URL ?? '', apiKey: env.LLM_API_KEY, model: env.LLM_MODEL ?? '', hedgeAfterMs,
    });
  }
  if (kind === 'gemini') {
    return new GeminiProvider({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL });
  }
  throw new Error(`LLM_PROVIDER must be gemini or openai-compatible, got ${kind}`);
}
