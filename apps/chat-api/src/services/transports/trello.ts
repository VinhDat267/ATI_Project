import { TrelloAdapter, type TrelloCredentials } from '@wap/tool-adapters';
import type { ServiceTransport } from './types.js';

export const TRELLO_TRANSPORT: ServiceTransport = {
    id: 'trello',
    createAdapter: (config, allowedScope) => new TrelloAdapter({ credentials: config as unknown as TrelloCredentials, allowedScope }),
    checkConnection: async (config, fetchFn, signal) => {
      const url = new URL('https://api.trello.com/1/members/me');
      url.searchParams.set('key', String(config.apiKey));
      url.searchParams.set('token', String(config.token));
      const response = await fetchFn(url, { method: 'GET', signal });
      const body = await response.json().catch(() => ({})) as { id?: unknown };
      return response.ok && typeof body.id === 'string' && body.id.length > 0;
    },
  };
