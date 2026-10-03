import { JiraAdapter } from '@wap/tool-adapters';
import type { ServiceTransport } from './types.js';
const credentials = (config: Record<string, unknown>) => ({ siteUrl: String(config.siteUrl ?? ''), email: String(config.email ?? ''), apiToken: String(config.apiToken ?? '') });
export const JIRA_TRANSPORT: ServiceTransport = {
  id: 'jira',
  createAdapter: (config, allowedScope) => new JiraAdapter({ credentials: credentials(config), allowedScope }),
  checkConnection: (config, fetchFn, signal) => new JiraAdapter({ credentials: credentials(config), fetchFn }).checkConnection(signal),
};
