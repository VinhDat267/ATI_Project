import {
  GitHubAdapter,
  SlackAdapter,
  TrelloAdapter,
  decryptCredentials,
  type SlackCredentials,
  type TrelloCredentials,
} from '@wap/tool-adapters';
import { ALL_TOOLS, SERVICE_REGISTRY } from '@wap/tool-schemas';
import type { AllowedScope } from '@wap/tool-schemas';
import type { CredentialRepo } from '../db/repositories/credential-repo.js';

type CredentialConfig = Record<string, unknown>;
type Adapter = { execute: (toolName: string, args: Record<string, any>, context?: { signal?: AbortSignal }) => Promise<any> };

interface ServiceTransport {
  createAdapter: (config: CredentialConfig, allowedScope: AllowedScope) => Adapter;
  checkConnection: (config: CredentialConfig, fetchFn: typeof fetch, signal: AbortSignal) => Promise<boolean>;
}

const transports: Record<string, ServiceTransport> = {
  trello: {
    createAdapter: (config, allowedScope) => new TrelloAdapter({ credentials: config as unknown as TrelloCredentials, allowedScope }),
    checkConnection: async (config, fetchFn, signal) => {
      const url = new URL('https://api.trello.com/1/members/me');
      url.searchParams.set('key', String(config.apiKey));
      url.searchParams.set('token', String(config.token));
      const response = await fetchFn(url, { method: 'GET', signal });
      const body = await response.json().catch(() => ({})) as { id?: unknown };
      return response.ok && typeof body.id === 'string' && body.id.length > 0;
    },
  },
  slack: {
    createAdapter: (config, allowedScope) => new SlackAdapter({ credentials: config as unknown as SlackCredentials, allowedScope }),
    checkConnection: async (config, fetchFn, signal) => {
      const response = await fetchFn('https://slack.com/api/auth.test', {
        method: 'POST', headers: { Authorization: `Bearer ${config.botToken}` }, signal,
      });
      const body = await response.json().catch(() => ({})) as { ok?: unknown };
      return response.ok && body.ok === true;
    },
  },
  github: {
    createAdapter: (config, allowedScope) => new GitHubAdapter({ credentials: { token: String(config.token) }, allowedScope }),
    checkConnection: async (config, fetchFn, signal) => {
      const response = await fetchFn('https://api.github.com/user', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${config.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal,
      });
      const body = await response.json().catch(() => ({})) as { id?: unknown; login?: unknown };
      return response.ok && (typeof body.id === 'number' || typeof body.id === 'string') && typeof body.login === 'string';
    },
  },
};

export const REGISTERED_SERVICES = SERVICE_REGISTRY.filter((service) => transports[service.id]);

export function getRegisteredService(id: string) {
  const definition = REGISTERED_SERVICES.find((service) => service.id === id);
  return definition ? { definition, transport: transports[id]! } : undefined;
}

export function normalizeAllowedScope(scopeKey: 'boards' | 'channels' | 'repos', value: unknown): AllowedScope | null {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)[scopeKey]
      : null;
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every((entry) => typeof entry === 'string' && entry.trim())) return null;
  const entries = [...new Set(raw.map((entry: string) => entry.trim()))];
  if (scopeKey === 'repos' && !entries.every((entry) => /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(entry))) return null;
  return { [scopeKey]: entries } as AllowedScope;
}

export function hasValidCredentials(fields: readonly { key: string }[], value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && fields.every(
    ({ key }) => typeof (value as Record<string, unknown>)[key] === 'string' && Boolean((value as Record<string, string>)[key]?.trim()),
  );
}

/** Only scoped, configured services may be described to the live planner. */
export async function getConfiguredToolCatalog(credentialRepo: CredentialRepo, encryptionKey: string) {
  const available = new Set<string>();
  for (const definition of REGISTERED_SERVICES) {
    const record = await credentialRepo.getCredentials(definition.id);
    if (!record) continue;
    try {
      const config = decryptCredentials(record.config, encryptionKey);
      if (!hasValidCredentials(definition.credentialFields, config)) continue;
      if (!normalizeAllowedScope(definition.scopeKey, config.allowedScope)) continue;
      available.add(definition.id);
    } catch {
      // Corrupt or stale credentials do not authorize a service.
    }
  }
  return ALL_TOOLS.filter((tool) => available.has(tool.service));
}
