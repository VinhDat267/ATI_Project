import { TrelloAdapter, type TrelloCredentials } from '@wap/tool-adapters';
import type { CredentialConfig, ServiceTransport } from './types.js';

const DEFAULT_TRELLO_API_BASE_URL = 'https://api.trello.com/1';

/** The stored config's base URL, then TRELLO_API_BASE_URL (sandbox/e2e), then production. */
function trelloApiBaseUrl(config: CredentialConfig): string {
  const configured = [config.apiBaseUrl, config.baseUrl, process.env.TRELLO_API_BASE_URL].find(
    (value): value is string => typeof value === 'string' && value.trim().length > 0
  );
  return (configured ?? DEFAULT_TRELLO_API_BASE_URL).trim().replace(/\/+$/, '');
}

export const TRELLO_TRANSPORT: ServiceTransport = {
  id: 'trello',
  createAdapter: (config, allowedScope) =>
    new TrelloAdapter({
      credentials: config as unknown as TrelloCredentials,
      allowedScope,
      allowedBoardIds: allowedScope?.boards,
      baseUrl: trelloApiBaseUrl(config),
    }),
  checkConnection: async (config, fetchFn, signal) => {
    const url = new URL(`${trelloApiBaseUrl(config)}/members/me`);
    const response = await fetchFn(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${String(config.accessToken)}` },
      signal,
    });
    const body = ((await response.json().catch(() => ({}))) || {}) as { id?: unknown };
    return response.ok && typeof body.id === 'string' && body.id.length > 0;
  },
};
