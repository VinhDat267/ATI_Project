import { decryptCredentials } from '@wap/tool-adapters';
import { ALL_TOOLS, GMAIL_TOOLS, MYCALENDAR_TOOLS, MYSHEETS_TOOLS, SERVICE_REGISTRY, type AllowedScope, type ServiceDefinition, type ToolDefinition } from '@wap/tool-schemas';
import type { CredentialRepo } from '../db/repositories/credential-repo.js';
import type { ServiceTransport } from './transports/types.js';
import { TRELLO_TRANSPORT } from './transports/trello.js';
import { SLACK_TRANSPORT } from './transports/slack.js';
import { GITHUB_TRANSPORT } from './transports/github.js';
import { SHEETS_TRANSPORT } from './transports/sheets.js';
import { CALENDAR_TRANSPORT } from './transports/calendar.js';
import { NOTION_TRANSPORT } from './transports/notion.js';
import { TELEGRAM_TRANSPORT } from './transports/telegram.js';
import { JIRA_TRANSPORT } from './transports/jira.js';

export const SERVICE_TRANSPORTS: Record<string, ServiceTransport> = Object.fromEntries(
  [TRELLO_TRANSPORT, SLACK_TRANSPORT, GITHUB_TRANSPORT, SHEETS_TRANSPORT, CALENDAR_TRANSPORT, NOTION_TRANSPORT, TELEGRAM_TRANSPORT, JIRA_TRANSPORT].map(transport => [transport.id, transport]),
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
  return { [scopeKey]: [...new Set(entries.map(entry => definition.normalizeScopeEntry?.(entry) ?? entry))] };
}

export function hasValidCredentials(fields: readonly { key: string; pattern?: string }[], value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && fields.every(
    ({ key, pattern }) => typeof (value as Record<string, unknown>)[key] === 'string' && Boolean((value as Record<string, string>)[key]?.trim()) && (!pattern || new RegExp(pattern).test((value as Record<string, string>)[key]!)),
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

/**
 * The catalog one caller may plan with: the shared services exactly as
 * getConfiguredToolCatalog, plus Gmail only when Gmail is enabled and this
 * caller has an active connection of their own, plus MyCalendar only when
 * MyCalendar is enabled and this caller has selected at least 1 calendar.
 */
export async function getToolCatalogFor(
  credentialRepo: CredentialRepo,
  encryptionKey: string,
  options: { userId?: string; gmailEnabled: boolean; mycalendarEnabled?: boolean; mysheetsEnabled?: boolean },
): Promise<ToolDefinition[]> {
  let catalog = await getConfiguredToolCatalog(credentialRepo, encryptionKey);
  if (!options.userId) return catalog;
  if (options.gmailEnabled) {
    const gmail = await credentialRepo.getPersonalCredentials('gmail', options.userId);
    if (gmail && gmail.status === 'active') catalog = [...catalog, ...GMAIL_TOOLS];
  }
  if (options.mycalendarEnabled) {
    const mycal = await credentialRepo.getPersonalCredentials('mycalendar', options.userId);
    if (mycal && mycal.status === 'active') {
      try {
        const config = decryptCredentials(mycal.config, encryptionKey);
        const calendars: string[] = Array.isArray(config.allowedScope?.calendars)
          ? config.allowedScope.calendars
          : Array.isArray(config.selectedCalendars)
            ? config.selectedCalendars.map((c: any) => c.id)
            : [];
        if (calendars.length > 0) {
          catalog = [...catalog, ...MYCALENDAR_TOOLS];
        }
      } catch {
        // stale or unreadable connection does not add tools
      }
    }
  }
  if (options.mysheetsEnabled) {
    const mysheets = await credentialRepo.getPersonalCredentials('mysheets', options.userId);
    if (mysheets && mysheets.status === 'active') {
      try {
        const config = decryptCredentials(mysheets.config, encryptionKey);
        const spreadsheets: string[] = Array.isArray(config.allowedScope?.spreadsheets)
          ? config.allowedScope.spreadsheets
          : Array.isArray(config.selectedSpreadsheets)
            ? config.selectedSpreadsheets.map((s: any) => s.id)
            : [];
        if (spreadsheets.length > 0) {
          catalog = [...catalog, ...MYSHEETS_TOOLS];
        }
      } catch {
        // stale or unreadable connection does not add tools
      }
    }
  }
  return catalog;
}
