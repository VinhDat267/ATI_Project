import type { LLMProvider } from '../types.js';
import { GeminiProvider } from './gemini-provider.js';
import { OpenAICompatibleProvider } from './openai-compatible-provider.js';
import { DeepSeekProvider } from './deepseek-provider.js';

export type LLMProviderKind = 'gemini' | 'openai-compatible' | 'deepseek';

/**
 * Selects the planning provider from environment settings:
 * LLM_PROVIDER=gemini (default) uses GEMINI_API_KEY/GEMINI_MODEL;
 * LLM_PROVIDER=openai-compatible uses LLM_BASE_URL, LLM_API_KEY and LLM_MODEL;
 * LLM_PROVIDER=deepseek uses DEEPSEEK_API_KEY, DEEPSEEK_MODEL (default deepseek-chat) and DEEPSEEK_BASE_URL.
 */
export function createProviderFromEnv(env: Record<string, string | undefined> = process.env): LLMProvider & { model: string } {
  const kind = env.LLM_PROVIDER || 'gemini';
  if (kind === 'openai-compatible') {
    return new OpenAICompatibleProvider({
      baseUrl: env.LLM_BASE_URL ?? '', apiKey: env.LLM_API_KEY, model: env.LLM_MODEL ?? '',
    });
  }
  if (kind === 'deepseek') {
    return new DeepSeekProvider({
      apiKey: env.DEEPSEEK_API_KEY,
      model: env.DEEPSEEK_MODEL || 'deepseek-chat',
      baseUrl: env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    });
  }
  if (kind === 'gemini') {
    return new GeminiProvider({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL });
  }
  throw new Error(`LLM_PROVIDER must be gemini, openai-compatible, or deepseek, got ${kind}`);
}
