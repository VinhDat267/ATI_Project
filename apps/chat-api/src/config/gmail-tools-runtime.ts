import { ALL_TOOLS, GMAIL_SERVICE, GMAIL_TOOLS, MYCALENDAR_SERVICE, MYJIRA_SERVICE, MYSHEETS_SERVICE, NOTION_OAUTH_TOOLS, SERVICE_REGISTRY, SHEETS_EXTENDED_TOOLS, SLACK_EXTENDED_TOOLS, type AllowedScope, type SheetsAppendLeaseStore } from '@wap/tool-schemas';
import { createGmailToolAdapter, createPersonalCalendarAdapter, createPersonalSheetsAdapter, type GmailAccessTokenProvider } from '@wap/tool-adapters';
import { routeIntent, type ProcessMessageInput } from '@wap/planner';
import type { CredentialRepo } from '../db/repositories/credential-repo.js';
import type { AdapterContext } from '../services/adapter-factory.js';
import { getToolCatalogFor } from '../services/registered-services.js';
import { createSandboxAdapter } from '../sandbox/index.js';
import { createRuntimeAdapterFactory, type RuntimeMode } from './runtime-policy.js';

const CANNED_SHARED_JIRA_SCENARIOS = new Set(['four_service', 'five_service', 'nine_service']);

/** Canned sandbox plans call jira.create_issue. MyJira must not hide that tool or steal the route. */
export function sandboxKeepsSharedJira(scenario = process.env.SANDBOX_SCENARIO, mode = process.env.RUNTIME_MODE ?? 'sandbox'): boolean {
  return mode === 'sandbox' && CANNED_SHARED_JIRA_SCENARIOS.has(scenario ?? '');
}

export const serviceRegistryForRuntime = (
  gmailEnabled: boolean,
  mycalendarEnabled: boolean = false,
  mysheetsEnabled: boolean = false,
  myjiraEnabled: boolean = false,
) => {
  const keepSharedJira = sandboxKeepsSharedJira();
  const personalJira = myjiraEnabled && !keepSharedJira;
  return [
    ...SERVICE_REGISTRY.filter((s) => keepSharedJira || s.id !== 'jira'),
    ...(gmailEnabled ? [GMAIL_SERVICE] : []),
    ...(mycalendarEnabled ? [MYCALENDAR_SERVICE] : []),
    ...(mysheetsEnabled ? [MYSHEETS_SERVICE] : []),
    ...(personalJira ? [MYJIRA_SERVICE] : []),
  ];
};

export const gmailServiceRegistry = (enabled: boolean) => serviceRegistryForRuntime(enabled, false, false, false);

/**
 * The Gmail fixture explicitly searches before planning, unlike regex canned plans.
 * The schedule fixture names "#ati-test", which regex gather would look up in a
 * sandbox Slack that has no channels, asking back before the model runs.
 */
export function runtimePlannerSearchMode(mode: RuntimeMode, configured: 'llm' | 'regex', scenario?: string): 'llm' | 'regex' {
  return mode === 'sandbox' && (scenario === 'gmail' || scenario === 'schedule' || scenario === 'mycalendar' || scenario === 'mysheets' || scenario === 'nine_service' || scenario === 'five_service' || scenario === 'four_service') ? 'llm' : configured;
}

export async function runtimeToolCatalog(
  mode: RuntimeMode,
  repo: CredentialRepo,
  key: string,
  options: {
    userId?: string;
    workspaceMode?: 'legacy' | 'personal' | 'organization';
    workspaceId?: string | null;
    gmailEnabled: boolean;
    mycalendarEnabled?: boolean;
    mysheetsEnabled?: boolean;
    trelloEnabled?: boolean;
    trelloTeamRepo?: any;
    trelloOAuthClient?: any;
    trelloTokens?: any;
    trelloConnection?: (userId: string, scopeId?: string) => Promise<any>;
    githubEnabled?: boolean;
    githubTeamRepo?: any;
    githubOAuthClient?: any;
    githubTokens?: any;
    githubConnection?: (userId: string, scopeId?: string) => Promise<any>;
    telegramEnabled?: boolean;
    telegramConnection?: (userId: string) => Promise<any>;
    notionEnabled?: boolean;
    notionConnection?: (userId: string) => Promise<any>;
    myjiraEnabled?: boolean;
    jiraWorkspaceRepo?: {
      getCapabilities: (workspaceId: string, userId: string) => Promise<{ sites?: unknown[] } | null>;
    };
    myjiraConnection?: (userId: string, workspaceId?: string | null) => Promise<any>;
  },
) {
  const personal = await getToolCatalogFor(repo, key, options);
  const hasMyCalendar = personal.some((t) => t.service === 'mycalendar');
  const hasMySheetsSpreadsheets = personal.some((t) => t.name === 'mysheets.read_range');
  const isOrgMode = options.workspaceMode === 'organization' && Boolean(options.workspaceId);
  const stripSharedSheets = hasMySheetsSpreadsheets && !isOrgMode;
  if (mode === 'live') {
    const hasSlack = personal.some((t) => t.service === 'slack');
    const hasSheets = personal.some((t) => t.service === 'sheets');
    const unified = [
      ...personal.filter(
        (t) =>
          (!hasMyCalendar || t.service !== 'calendar') &&
          (!stripSharedSheets || t.service !== 'sheets')
      ),
      ...(hasSlack ? SLACK_EXTENDED_TOOLS : []),
      ...(hasSheets && !stripSharedSheets ? SHEETS_EXTENDED_TOOLS : []),
    ];
    return Array.from(new Map(unified.map((t) => [t.name, t])).values());
  }
  const keepSharedJira = sandboxKeepsSharedJira(process.env.SANDBOX_SCENARIO, mode);
  const baseTools = [
    ...ALL_TOOLS.filter(
      (t) =>
        t.service !== 'trello' &&
        t.service !== 'github' &&
        t.service !== 'telegram' &&
        (keepSharedJira || t.service !== 'jira') &&
        (!hasMyCalendar || t.service !== 'calendar') &&
        (!stripSharedSheets || t.service !== 'sheets')
    ),
    ...SLACK_EXTENDED_TOOLS,
    ...(!stripSharedSheets ? SHEETS_EXTENDED_TOOLS : []),
    ...NOTION_OAUTH_TOOLS,
    ...(process.env.SANDBOX_SCENARIO === 'nine_service' ? GMAIL_TOOLS : []),
  ];
  const tools = [
    ...baseTools,
    ...personal.filter(
      (t) =>
        t.service === 'gmail' ||
        t.service === 'mycalendar' ||
        t.service === 'mysheets' ||
        t.service === 'trello' ||
        t.service === 'github' ||
        t.service === 'telegram' ||
        t.service === 'notion' ||
        t.service === 'myjira'
    ),
  ];
  return Array.from(new Map(tools.map((t) => [t.name, t])).values());
}

export function runtimeGmailAdapter(mode: RuntimeMode, tokens: GmailAccessTokenProvider, baseUrl?: string) {
  return mode === 'live' ? createGmailToolAdapter({ tokens, baseUrl }) : createSandboxAdapter('gmail');
}

/**
 * Unlike Gmail, every mode uses the HTTP adapter. Outside live, env.ts accepts
 * MYCALENDAR_OAUTH only when all four MYCALENDAR_* endpoint overrides are set,
 * and calls go wherever they point; it does not check that they are fakes.
 * Pointing them at a local fake (scripts/fake-google-gmail.mjs, as the browser
 * runner does) is the caller's job.
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

export function runtimeMySheetsAdapter(
  _mode: RuntimeMode,
  input: {
    userId: string;
    tokens: GmailAccessTokenProvider;
    allowedScope: AllowedScope;
    appendLeaseStore?: SheetsAppendLeaseStore;
  },
  baseUrl?: string,
) {
  return createPersonalSheetsAdapter({
    userId: input.userId,
    tokens: input.tokens,
    allowedScope: input.allowedScope,
    apiBaseUrl: baseUrl,
    appendLeaseStore: input.appendLeaseStore,
  });
}

export function runtimeMySheetsEndpoints(mode: RuntimeMode, apiBaseUrl?: string) {
  return {
    fakePickerBaseUrl: mode === 'sandbox' ? apiBaseUrl : undefined,
    driveApiBaseUrl: mode === 'sandbox' ? apiBaseUrl : undefined,
  };
}

export function createToolRuntimeFactory(
  mode: RuntimeMode,
  personal: (name: string, context?: AdapterContext) => Promise<any>,
  sandbox = createSandboxAdapter,
) {
  return createRuntimeAdapterFactory<AdapterContext>(mode, personal,
    (name, context) => (name === 'gmail' || name === 'mycalendar' || name === 'mysheets' || name === 'myslack' || name === 'trello' || name === 'github' || name === 'telegram' || name === 'myjira' || (name === 'jira' && !sandboxKeepsSharedJira())) ? personal(name, context) : sandbox(name));
}

/** A failed Gmail, MyCalendar, MySheets, Trello, GitHub, Telegram or MyJira request must not become a canned shared-service write. */
export function mayFallbackToShared(
  input: ProcessMessageInput,
  gmailEnabled: boolean,
  mycalendarEnabled: boolean = false,
  mysheetsEnabled: boolean = false,
  myjiraEnabled: boolean = false,
): boolean {
  const texts = [...(input.history ?? []).filter((m) => m.role === 'user').map((m) => m.content), input.userMessage];
  const joined = texts.join('\n');
  if (!sandboxKeepsSharedJira() && /\b(myjira|jira)\b/i.test(joined)) {
    return false;
  }
  const catalog = [
    ...ALL_TOOLS.filter((t) => sandboxKeepsSharedJira() || t.service !== 'jira'),
    ...(gmailEnabled ? [{ name: 'gmail.intent', service: 'gmail' } as typeof ALL_TOOLS[number]] : []),
    ...(mycalendarEnabled ? [{ name: 'mycalendar.intent', service: 'mycalendar' } as typeof ALL_TOOLS[number]] : []),
    ...(mysheetsEnabled ? [{ name: 'mysheets.intent', service: 'mysheets' } as typeof ALL_TOOLS[number]] : []),
    ...(myjiraEnabled ? [{ name: 'myjira.intent', service: 'myjira' } as typeof ALL_TOOLS[number]] : []),
  ];
  const registry = serviceRegistryForRuntime(gmailEnabled, mycalendarEnabled, mysheetsEnabled, myjiraEnabled);
  const routed = routeIntent(joined, catalog, registry).services;
  if (routed.includes('trello') || routed.includes('github') || routed.includes('telegram')) return false;
  if (gmailEnabled && routed.includes('gmail')) return false;
  if (mycalendarEnabled && routed.includes('mycalendar')) return false;
  if (mysheetsEnabled && routed.includes('mysheets')) return false;
  if (routed.includes('myjira') || (!sandboxKeepsSharedJira() && routed.includes('jira'))) return false;
  return true;
}
