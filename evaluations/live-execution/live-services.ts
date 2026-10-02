import { GitHubAdapter, SlackAdapter, TrelloAdapter, SheetsAdapter } from '@wap/tool-adapters';
import { getServiceDefinition } from '@wap/tool-schemas';
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
