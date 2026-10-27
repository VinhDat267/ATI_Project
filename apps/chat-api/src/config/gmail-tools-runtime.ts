import { ALL_TOOLS, GMAIL_SERVICE, MYCALENDAR_SERVICE, SERVICE_REGISTRY, type AllowedScope } from '@wap/tool-schemas';
import { createGmailToolAdapter, createPersonalCalendarAdapter, type GmailAccessTokenProvider } from '@wap/tool-adapters';
import { routeIntent, type ProcessMessageInput } from '@wap/planner';
import type { CredentialRepo } from '../db/repositories/credential-repo.js';
import type { AdapterContext } from '../services/adapter-factory.js';
import { getToolCatalogFor } from '../services/registered-services.js';
import { createSandboxAdapter } from '../sandbox/index.js';
import { createRuntimeAdapterFactory, type RuntimeMode } from './runtime-policy.js';

export const serviceRegistryForRuntime = (gmailEnabled: boolean, mycalendarEnabled: boolean = false) => [
  ...SERVICE_REGISTRY,
  ...(gmailEnabled ? [GMAIL_SERVICE] : []),
  ...(mycalendarEnabled ? [MYCALENDAR_SERVICE] : []),
];

export const gmailServiceRegistry = (enabled: boolean) => serviceRegistryForRuntime(enabled, false);

/**
 * The Gmail fixture explicitly searches before planning, unlike regex canned plans.
 * The schedule fixture names "#ati-test", which regex gather would look up in a
 * sandbox Slack that has no channels, asking back before the model runs.
 */
export function runtimePlannerSearchMode(mode: RuntimeMode, configured: 'llm' | 'regex', scenario?: string): 'llm' | 'regex' {
  return mode === 'sandbox' && (scenario === 'gmail' || scenario === 'schedule' || scenario === 'mycalendar') ? 'llm' : configured;
}

export async function runtimeToolCatalog(
  mode: RuntimeMode,
  repo: CredentialRepo,
  key: string,
  options: { userId?: string; gmailEnabled: boolean; mycalendarEnabled?: boolean },
) {
  const personal = await getToolCatalogFor(repo, key, options);
  return mode === 'live' ? personal : [...ALL_TOOLS, ...personal.filter((t) => t.service === 'gmail' || t.service === 'mycalendar')];
}

export function runtimeGmailAdapter(mode: RuntimeMode, tokens: GmailAccessTokenProvider, baseUrl?: string) {
  return mode === 'live' ? createGmailToolAdapter({ tokens, baseUrl }) : createSandboxAdapter('gmail');
}

/**
 * Unlike Gmail, every mode uses the HTTP adapter: outside live, env.ts accepts
 * MYCALENDAR_OAUTH only with every endpoint pointing at a fake, so a sandbox
 * reaches the fake Calendar server (scripts/fake-google-gmail.mjs), never Google.
 */
export function runtimeMyCalendarAdapter(
  _mode: RuntimeMode,
  input: { userId: string; tokens: GmailAccessTokenProvider; allowedScope: AllowedScope },
  baseUrl?: string,
) {
  return createPersonalCalendarAdapter({
    userId: input.userId,
    tokens: input.tokens,
    allowedScope: input.allowedScope,
    apiBaseUrl: baseUrl,
  });
}

export function createToolRuntimeFactory(
  mode: RuntimeMode,
  personal: (name: string, context?: AdapterContext) => Promise<any>,
  sandbox = createSandboxAdapter,
) {
  return createRuntimeAdapterFactory<AdapterContext>(mode, personal,
    (name, context) => (name === 'gmail' || name === 'mycalendar') ? personal(name, context) : sandbox(name));
}

/** A failed Gmail or MyCalendar request must not become a canned shared-service write. */
export function mayFallbackToShared(input: ProcessMessageInput, gmailEnabled: boolean, mycalendarEnabled: boolean = false): boolean {
  if (!gmailEnabled && !mycalendarEnabled) return true;
  const texts = [...(input.history ?? []).filter((m) => m.role === 'user').map((m) => m.content), input.userMessage];
  const catalog = [
    ...ALL_TOOLS,
    ...(gmailEnabled ? [{ name: 'gmail.intent', service: 'gmail' } as typeof ALL_TOOLS[number]] : []),
    ...(mycalendarEnabled ? [{ name: 'mycalendar.intent', service: 'mycalendar' } as typeof ALL_TOOLS[number]] : []),
  ];
  const registry = serviceRegistryForRuntime(gmailEnabled, mycalendarEnabled);
  const routed = routeIntent(texts.join('\n'), catalog, registry).services;
  if (gmailEnabled && routed.includes('gmail')) return false;
  if (mycalendarEnabled && routed.includes('mycalendar')) return false;
  return true;
}
