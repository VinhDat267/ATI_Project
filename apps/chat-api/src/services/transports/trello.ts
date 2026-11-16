import { TrelloAdapter, type TrelloCredentials } from '@wap/tool-adapters';
import { TRELLO_ENDPOINTS } from '../../config/env.js';
import type { ServiceTransport } from './types.js';

/** The optional endpoint comes from the server's validated OAuth configuration. */
export function createTrelloTransport(apiBaseUrl = TRELLO_ENDPOINTS.apiBaseUrl): ServiceTransport {
  const baseUrl = apiBaseUrl.replace(/\/+$/, '');
  return {
    id: 'trello',
    createAdapter: (config, allowedScope) =>
      new TrelloAdapter({
        credentials: config as unknown as TrelloCredentials,
        allowedScope,
        allowedBoardIds: allowedScope?.boards,
        baseUrl,
      }),
    checkConnection: async (config, fetchFn, signal) => {
      const url = new URL(`${baseUrl}/members/me`);
      const response = await fetchFn(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${String(config.accessToken)}` },
        signal,
      });
      const body = ((await response.json().catch(() => ({}))) || {}) as { id?: unknown };
      return response.ok && typeof body.id === 'string' && body.id.length > 0;
    },
  };
}

export const TRELLO_TRANSPORT = createTrelloTransport();
