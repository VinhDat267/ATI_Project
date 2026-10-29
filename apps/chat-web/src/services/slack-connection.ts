import { apiClient } from './api-client';
export interface SlackConnection {
  id: string; workspaceId: string; workspaceName: string; actorId: string;
  identityVersion: number; status: 'active' | 'reconnect_required'; scopes: string[]; missingScopes: string[]; processingStatus: 'pending';
}
export const slackConnectionApi = {
  list: () => apiClient.request<{ connections: SlackConnection[] }>('/api/connections/myslack'),
  start: () => apiClient.request<{ url: string }>('/api/connections/myslack/start', { method: 'POST', credentials: 'include' }),
  complete: (input: { code?: string; state: string; error?: string }) => apiClient.request<SlackConnection>('/api/connections/myslack/callback', { method: 'POST', credentials: 'include', body: JSON.stringify(input), signal: AbortSignal.timeout(20000) }, true),
  disconnect: (id: string) => apiClient.request<{ success: true; revoked: boolean }>('/api/connections/myslack/' + encodeURIComponent(id), { method: 'DELETE', credentials: 'include' }),
};
export function openSlackAuthorization(value: string): void {
  const url = new URL(value);
  const slack = url.origin === 'https://slack.com' && url.pathname === '/oauth/v2/authorize';
  const fixture = url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname);
  if ((!slack && !fixture) || url.username || url.password || url.hash) throw new Error('Không mở được trang kết nối Slack.');
  window.location.assign(url.href);
}
