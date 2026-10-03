import { GitHubAdapter, SlackAdapter, TrelloAdapter, SheetsAdapter, CalendarAdapter, NotionAdapter } from '@wap/tool-adapters';
import { ALL_TOOLS, getServiceDefinition } from '@wap/tool-schemas';
import type { LiveService } from './harness.js';

export interface LiveServiceDefinition {
  id: string;
  credentials: Record<string, string>;
  scopeKey: string;
  scopeEnv: string;
  missingCredentials: string;
  missingScope: string;
  scopePattern?: RegExp;
  invalidScope?: string;
  createAdapter: (config: LiveService) => { execute(tool: string, args: any, options?: { signal?: AbortSignal }): Promise<any> };
}

/** Existing env names remain stable; future services add one entry here. */
export const LIVE_SERVICES: LiveServiceDefinition[] = [
  {
    id: 'notion', credentials: { token: 'NOTION_TOKEN' }, scopeKey: 'databases', scopeEnv: 'LIVE_NOTION_DATABASE_IDS',
    missingCredentials: 'NOTION_TOKEN is required', missingScope: 'LIVE_NOTION_DATABASE_IDS must list database ids',
    scopePattern: getServiceDefinition('notion')!.scopePattern, invalidScope: 'LIVE_NOTION_DATABASE_IDS entries must be UUID database ids',
    createAdapter: ({ credentials, allowedScope }) => new NotionAdapter({ credentials: { token: credentials.token! }, allowedScope }),
  },
  {
    id: 'calendar', credentials: { clientEmail: 'GOOGLE_CLIENT_EMAIL', privateKey: 'GOOGLE_PRIVATE_KEY' },
    scopeKey: 'calendars', scopeEnv: 'LIVE_CALENDAR_IDS',
    missingCredentials: 'GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY are required',
    missingScope: 'LIVE_CALENDAR_IDS must list calendar ids',
    scopePattern: getServiceDefinition('calendar')!.scopePattern,
    invalidScope: 'LIVE_CALENDAR_IDS entries must be explicit calendar ids',
    createAdapter: ({ credentials, allowedScope }) => new CalendarAdapter({ credentials: { clientEmail: credentials.clientEmail!, privateKey: credentials.privateKey! }, allowedScope }),
  },
  {
    id: 'sheets', credentials: { clientEmail: 'GOOGLE_CLIENT_EMAIL', privateKey: 'GOOGLE_PRIVATE_KEY' },
    scopeKey: 'spreadsheets', scopeEnv: 'LIVE_SHEETS_SPREADSHEET_IDS',
    missingCredentials: 'GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY are required',
    missingScope: 'LIVE_SHEETS_SPREADSHEET_IDS must list spreadsheet ids',
    scopePattern: getServiceDefinition('sheets')!.scopePattern,
    invalidScope: 'LIVE_SHEETS_SPREADSHEET_IDS entries must be spreadsheet ids',
    createAdapter: ({ credentials, allowedScope }) => new SheetsAdapter({ credentials: { clientEmail: credentials.clientEmail!, privateKey: credentials.privateKey! }, allowedScope }),
  },
  {
    id: 'trello', credentials: { apiKey: 'TRELLO_API_KEY', token: 'TRELLO_TOKEN' },
    scopeKey: 'boards', scopeEnv: 'LIVE_TRELLO_BOARD_IDS',
    missingCredentials: 'TRELLO_API_KEY and TRELLO_TOKEN are required',
    missingScope: 'LIVE_TRELLO_BOARD_IDS must list the board ids a run may use',
    createAdapter: ({ credentials, allowedScope }) => new TrelloAdapter({ credentials: credentials as any, allowedScope }),
  },
  {
    id: 'slack', credentials: { botToken: 'SLACK_BOT_TOKEN' }, scopeKey: 'channels', scopeEnv: 'LIVE_SLACK_CHANNELS',
    missingCredentials: 'SLACK_BOT_TOKEN is required',
    missingScope: 'LIVE_SLACK_CHANNELS must list the channel ids a run may use',
    createAdapter: ({ credentials, allowedScope }) => new SlackAdapter({ credentials: credentials as any, allowedScope }),
  },
  {
    id: 'github', credentials: { token: 'GITHUB_TOKEN' }, scopeKey: 'repos', scopeEnv: 'LIVE_GITHUB_REPOS',
    missingCredentials: 'GITHUB_TOKEN is required',
    missingScope: 'LIVE_GITHUB_REPOS must list the repositories a run may use',
    scopePattern: getServiceDefinition('github')!.scopePattern,
    invalidScope: 'LIVE_GITHUB_REPOS entries must be owner/name',
    createAdapter: ({ credentials, allowedScope }) => new GitHubAdapter({ credentials: { token: credentials.token! }, allowedScope }),
  },
];

/** Read-only reachability based on directory contracts, including observed child scopes. */
export async function checkLiveService(service: string, adapter: ReturnType<LiveServiceDefinition['createAdapter']>): Promise<number> {
  const listable = ALL_TOOLS.filter(tool => tool.service === service && tool.sideEffect === 'read' && tool.listable);
  const resourceArguments = (tool: typeof ALL_TOOLS[number]) => Object.entries<any>(tool.inputSchema.properties ?? {})
    .filter(([, property]) => property['x-resource']);
  const directory = listable.find(tool => resourceArguments(tool).length === 0);
  if (!directory) throw new Error('Service has no registered directory');
  const resources = await adapter.execute(directory.name, { query: '', limit: 10 });
  if (!Array.isArray(resources) || resources.length === 0) throw new Error('Service has no allowlisted resource visible to these credentials');
  // Preserve the existing board/list reachability check; Sheets tabs follow the same contract.
  const children = listable.filter(tool => resourceArguments(tool).length === 1 && resourceArguments(tool)[0]![1]['x-resource'] === directory.discovers);
  for (const child of children) for (const resource of resources) {
    const argument = resourceArguments(child)[0]![0];
    await adapter.execute(child.name, { query: '', limit: 10, [argument]: resource.id });
  }
  return resources.length;
}
