import { TrelloAdapter, type TrelloCredentials } from '@wap/tool-adapters';
import type { ServiceTransport } from './types.js';

export const TRELLO_TRANSPORT: ServiceTransport = {
  id: 'trello',
  createAdapter: (config, allowedScope) =>
    new TrelloAdapter({
      credentials: config as unknown as TrelloCredentials,
      allowedScope,
      allowedBoardIds: allowedScope?.boards,
    }),
  checkConnection: async (config, fetchFn, signal) => {
    const url = new URL('https://api.trello.com/1/members/me');
    const response = await fetchFn(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${String(config.accessToken)}` },
      signal,
    });
    const body = ((await response.json().catch(() => ({}))) || {}) as { id?: unknown };
    return response.ok && typeof body.id === 'string' && body.id.length > 0;
  },
};
