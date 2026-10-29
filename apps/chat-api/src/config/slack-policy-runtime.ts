import { createHash } from 'node:crypto';

export interface RuntimeProviderIdentity {
  providerId: string;
  name: string;
  model: string;
  endpoint: string;
  accountIdentifier: string;
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
  const kind = (env?.LLM_PROVIDER || 'gemini').trim().toLowerCase();
  let providerId: string;
  let name: string;
  let model: string;
  let endpoint: string;

  if (kind === 'openai-compatible') {
    providerId = 'openai-compatible';
    name = 'OpenAI Compatible';
    model = (env?.LLM_MODEL || '').trim();
    endpoint = (env?.LLM_BASE_URL || '').trim().replace(/\/+$/, '');
  } else if (kind === 'gemini') {
    providerId = 'gemini';
    name = 'Google Gemini';
    model = (env?.GEMINI_MODEL || 'gemini-3.8-flash').trim();
    endpoint = 'https://generativelanguage.googleapis.com';
  } else {
    providerId = 'unknown';
    name = kind || 'Unknown';
    model = (env?.LLM_MODEL || '').trim();
    endpoint = (env?.LLM_BASE_URL || '').trim().replace(/\/+$/, '');
  }

  const accountIdentifier = (
    env?.RUNTIME_ACCOUNT_ID ||
    env?.LLM_ACCOUNT_ID ||
    env?.GEMINI_ACCOUNT_ID ||
    env?.SLACK_POLICY_ACCOUNT_ID ||
    ''
  ).trim();

  const canonicalConfig = `provider:${providerId}|name:${name}|model:${model}|endpoint:${endpoint}|account:${accountIdentifier}`;
  const fingerprint = createHash('sha256').update(canonicalConfig).digest('hex');

  return {
    providerId,
    name,
    model,
    endpoint,
    accountIdentifier,
    fingerprint,
  };
}
