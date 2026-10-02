import { SlackAdapter, type SlackCredentials } from '@wap/tool-adapters';
import type { ServiceTransport } from './types.js';

export const SLACK_TRANSPORT: ServiceTransport = {
    id: 'slack',
    createAdapter: (config, allowedScope) => new SlackAdapter({ credentials: config as unknown as SlackCredentials, allowedScope }),
    checkConnection: async (config, fetchFn, signal) => {
      const response = await fetchFn('https://slack.com/api/auth.test', {
        method: 'POST', headers: { Authorization: `Bearer ${config.botToken}` }, signal,
      });
      const body = await response.json().catch(() => ({})) as { ok?: unknown };
      return response.ok && body.ok === true;
    },
  };
