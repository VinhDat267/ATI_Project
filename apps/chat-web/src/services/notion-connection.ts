import { apiClient } from './api-client';
export interface NotionConnection {
  id: string; workspaceId: string; workspaceName: string; actorId: string;
  identityVersion: number; status: 'connected' | 'scope_required' | 'reconnect_required'; allowedDatabases: string[]; toolsAvailable: false;
}
export const notionConnectionApi = {
  list: () => apiClient.request<{ connections: NotionConnection[] }>('/api/connections/mynotion'),
  start: () => apiClient.request<{ url: string }>('/api/connections/mynotion/start', { method: 'POST', credentials: 'include' }),
  complete: (input: { code?: string; state: string; error?: string }) => apiClient.request<NotionConnection>('/api/connections/mynotion/callback', { method: 'POST', credentials: 'include', body: JSON.stringify(input), signal: AbortSignal.timeout(20000) }, true),
  disconnect: (id: string) => apiClient.request<{ success: true; revoked: boolean }>('/api/connections/mynotion/' + encodeURIComponent(id), { method: 'DELETE', credentials: 'include' }),
  databases: (id: string, query: string) => apiClient.request<{ databases: Array<{ id: string; title: string }>; hasMore: boolean; identityVersion: number }>(`/api/connections/mynotion/${encodeURIComponent(id)}/databases?query=${encodeURIComponent(query)}`),
  select: (id: string, identityVersion: number, databaseIds: string[]) => apiClient.request<NotionConnection>(`/api/connections/mynotion/${encodeURIComponent(id)}/scope`, { method: 'PUT', body: JSON.stringify({ identityVersion, databaseIds }) }),
};
export function openNotionAuthorization(value: string): void {
  const url = new URL(value);
  const notion = url.origin === 'https://api.notion.com' && url.pathname === '/v1/oauth/authorize';
  const fixture = url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname);
  if ((!notion && !fixture) || url.username || url.password || url.hash) throw new Error('Không mở được trang kết nối Notion.');
  window.location.assign(url.href);
}
