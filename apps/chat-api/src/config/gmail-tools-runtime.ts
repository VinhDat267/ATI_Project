import { ALL_TOOLS, GMAIL_SERVICE, SERVICE_REGISTRY } from '@wap/tool-schemas';
import { createGmailToolAdapter, type GmailAccessTokenProvider } from '@wap/tool-adapters';
import { routeIntent, type ProcessMessageInput } from '@wap/planner';
import type { CredentialRepo } from '../db/repositories/credential-repo.js';
import type { AdapterContext } from '../services/adapter-factory.js';
import { getToolCatalogFor } from '../services/registered-services.js';
import { createSandboxAdapter } from '../sandbox/index.js';
import { createRuntimeAdapterFactory, type RuntimeMode } from './runtime-policy.js';

export const gmailServiceRegistry = (enabled: boolean) => enabled ? [...SERVICE_REGISTRY, GMAIL_SERVICE] : SERVICE_REGISTRY;
export async function runtimeToolCatalog(mode: RuntimeMode, repo: CredentialRepo, key: string, options: { userId?: string; gmailEnabled: boolean }) {
  const personal = await getToolCatalogFor(repo, key, options);
  return mode === 'live' ? personal : [...ALL_TOOLS, ...personal.filter(t => t.service === 'gmail')];
}
export function runtimeGmailAdapter(mode: RuntimeMode, tokens: GmailAccessTokenProvider, baseUrl?: string) {
  return mode === 'live' ? createGmailToolAdapter({ tokens, baseUrl }) : createSandboxAdapter('gmail');
}
export function createToolRuntimeFactory(mode: RuntimeMode, personal: (name: string, context?: AdapterContext) => Promise<any>, sandbox = createSandboxAdapter) {
  return createRuntimeAdapterFactory<AdapterContext>(mode, personal,
    (name, context) => name === 'gmail' ? personal(name, context) : sandbox(name));
}
/** A failed Gmail request must not become a canned shared-service write. */
export function mayFallbackToShared(input: ProcessMessageInput, gmailEnabled: boolean): boolean {
  if (!gmailEnabled) return true;
  const texts = [...(input.history ?? []).filter(m => m.role === 'user').map(m => m.content), input.userMessage];
  const catalog = [...ALL_TOOLS, { name: 'gmail.intent', service: 'gmail' } as typeof ALL_TOOLS[number]];
  return !routeIntent(texts.join('\n'), catalog, gmailServiceRegistry(true)).services.includes('gmail');
}
