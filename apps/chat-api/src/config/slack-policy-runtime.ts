import { createHash } from 'node:crypto';

export interface RuntimeProviderIdentity {
  providerId: string;
  name: string;
  model: string;
  endpoint: string;
  fingerprint: string;
}

/**
 * Resolves the runtime model provider identity and computes a configuration fingerprint.
 * This matches the environment-driven provider creation in packages/planner/src/providers/factory.ts.
 * Notice: Never includes API keys or credentials in the fingerprint.
 */
export function resolveRuntimeProviderIdentity(
  env: Record<string, string | undefined> = process.env
): RuntimeProviderIdentity {
  const kind = (env.LLM_PROVIDER || 'gemini').trim().toLowerCase();
  let providerId: string;
  let name: string;
  let model: string;
  let endpoint: string;

  if (kind === 'openai-compatible') {
    providerId = 'openai-compatible';
    name = 'OpenAI Compatible';
    model = (env.LLM_MODEL || 'gpt-4o').trim();
    endpoint = (env.LLM_BASE_URL || 'https://api.openai.com/v1').trim().replace(/\/+$/, '');
  } else if (kind === 'gemini') {
    providerId = 'gemini';
    name = 'Google Gemini';
    model = (env.GEMINI_MODEL || 'gemini-2.5-flash').trim();
    endpoint = 'https://generativelanguage.googleapis.com';
  } else {
    providerId = kind;
    name = kind;
    model = (env.LLM_MODEL || 'unknown').trim();
    endpoint = (env.LLM_BASE_URL || '').trim().replace(/\/+$/, '');
  }

  const canonicalConfig = `provider:${providerId}|name:${name}|model:${model}|endpoint:${endpoint}`;
  const fingerprint = createHash('sha256').update(canonicalConfig).digest('hex');

  return {
    providerId,
    name,
    model,
    endpoint,
    fingerprint,
  };
}
