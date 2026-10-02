import { decryptCredentials } from '@wap/tool-adapters';
import { ALL_TOOLS, SERVICE_REGISTRY, type AllowedScope, type ServiceDefinition } from '@wap/tool-schemas';
import type { CredentialRepo } from '../db/repositories/credential-repo.js';
import type { ServiceTransport } from './transports/types.js';
import { TRELLO_TRANSPORT } from './transports/trello.js';
import { SLACK_TRANSPORT } from './transports/slack.js';
import { GITHUB_TRANSPORT } from './transports/github.js';
import { SHEETS_TRANSPORT } from './transports/sheets.js';

export const SERVICE_TRANSPORTS: Record<string, ServiceTransport> = Object.fromEntries(
  [TRELLO_TRANSPORT, SLACK_TRANSPORT, GITHUB_TRANSPORT, SHEETS_TRANSPORT].map(transport => [transport.id, transport]),
);

export function getRegisteredServices(): ServiceDefinition[] {
  return SERVICE_REGISTRY.filter(service => SERVICE_TRANSPORTS[service.id]);
}

export function getRegisteredService(id: string) {
  const definition = getRegisteredServices().find(service => service.id === id);
  return definition ? { definition, transport: SERVICE_TRANSPORTS[id]! } : undefined;
}

export function normalizeAllowedScope(definition: ServiceDefinition, value: unknown): AllowedScope | null {
  const { scopeKey, scopePattern } = definition;
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)[scopeKey]
      : null;
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every(entry => typeof entry === 'string' && entry.trim())) return null;
  const entries = [...new Set(raw.map((entry: string) => entry.trim()))];
  // RegExp instances with g/y flags must not carry state between entries or requests.
  if (scopePattern && !entries.every(entry => new RegExp(scopePattern.source, scopePattern.flags).test(entry))) return null;
  return { [scopeKey]: entries };
}

export function hasValidCredentials(fields: readonly { key: string }[], value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && fields.every(
    ({ key }) => typeof (value as Record<string, unknown>)[key] === 'string' && Boolean((value as Record<string, string>)[key]?.trim()),
  );
}

/** Only scoped, configured services may be described to the live planner. */
export async function getConfiguredToolCatalog(credentialRepo: CredentialRepo, encryptionKey: string) {
  const available = new Set<string>();
  for (const definition of getRegisteredServices()) {
    const record = await credentialRepo.getCredentials(definition.id);
    if (!record) continue;
    try {
      const config = decryptCredentials(record.config, encryptionKey);
      if (!hasValidCredentials(definition.credentialFields, config)) continue;
      if (!normalizeAllowedScope(definition, config.allowedScope)) continue;
      available.add(definition.id);
    } catch {
      // Corrupt or stale credentials do not authorize a service.
    }
  }
  return ALL_TOOLS.filter((tool) => available.has(tool.service));
}
