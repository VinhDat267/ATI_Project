import { apiClient } from './api-client';
import { gmailSessionOwner, conversationReturnPath } from './gmail-connection';

export type SlackConnectionStatus = 'active' | 'reconnect_required' | 'revoked';
export type SlackConsentStatus = 'pending' | 'granted' | 'revoked';

export interface SlackConnectionPublicInfo {
  id: string;
  workspaceId: string;
  workspaceName: string;
  slackUserId: string;
  slackUserLabel: string;
  status: SlackConnectionStatus;
  identityVersion: number;
  scopes: string[];
  connectedAt: string;
  consentStatus: SlackConsentStatus;
  processingReady: boolean;
  missingScopes?: string[];
  updatedAt?: string;
  actorId?: string;
}

export type SlackConnection = SlackConnectionPublicInfo;

export interface SlackStartConnectionOptions {
  returnTo?: string;
  workspaceHint?: string;
}

export interface SlackCallbackResult {
  connectionId: string;
  workspaceId: string;
  workspaceName: string;
  slackUserId: string;
  returnTo?: string;
  actorId?: string;
}

export function normalizeSlackConnection(raw: unknown): SlackConnectionPublicInfo | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const id = typeof r.id === 'string' && r.id.trim() ? r.id.trim() : null;
  const workspaceId = typeof r.workspaceId === 'string' && r.workspaceId.trim() ? r.workspaceId.trim() : null;
  const workspaceName = typeof r.workspaceName === 'string' && r.workspaceName.trim() ? r.workspaceName.trim() : null;
  if (!id || !workspaceId || !workspaceName) return null;

  // actorId can supply slackUserId and slackUserLabel if absent
  const legacyActorId = typeof r.actorId === 'string' && r.actorId.trim() ? r.actorId.trim() : undefined;
  const rawUserId = typeof r.slackUserId === 'string' && r.slackUserId.trim() ? r.slackUserId.trim() : legacyActorId;
  if (!rawUserId) return null;
  const slackUserId = rawUserId;

  const rawUserLabel = typeof r.slackUserLabel === 'string' && r.slackUserLabel.trim() ? r.slackUserLabel.trim() : (legacyActorId ?? slackUserId);
  const slackUserLabel = rawUserLabel;

  const rawStatus = typeof r.status === 'string' ? r.status : '';
  const status: SlackConnectionStatus = (rawStatus === 'active' || rawStatus === 'reconnect_required' || rawStatus === 'revoked')
    ? rawStatus
    : 'reconnect_required';

  const identityVersion = typeof r.identityVersion === 'number' && Number.isSafeInteger(r.identityVersion) && r.identityVersion > 0
    ? r.identityVersion
    : 1;

  const scopes: string[] = Array.isArray(r.scopes)
    ? r.scopes.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    : [];

  let missingScopes: string[] | undefined;
  if (Array.isArray(r.missingScopes)) {
    missingScopes = r.missingScopes.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
  }

  const connectedAt = typeof r.connectedAt === 'string' && r.connectedAt.trim()
    ? r.connectedAt.trim()
    : new Date().toISOString();

  // Absent consent remains 'pending'
  const consentStatus: SlackConsentStatus = (r.consentStatus === 'granted' || r.consentStatus === 'revoked')
    ? r.consentStatus
    : 'pending';

  // processingReady requires server-owned boolean true AND active status AND granted consent.
  // Never trust unknown properties or infer readiness from active+granted alone.
  const processingReady = r.processingReady === true && status === 'active' && consentStatus === 'granted';

  const normalized: SlackConnectionPublicInfo = {
    id,
    workspaceId,
    workspaceName,
    slackUserId,
    slackUserLabel,
    status,
    identityVersion,
    scopes,
    connectedAt,
    consentStatus,
    processingReady,
    actorId: legacyActorId ?? slackUserId,
  };

  if (missingScopes !== undefined) {
    normalized.missingScopes = missingScopes;
  }
  if (typeof r.updatedAt === 'string' && r.updatedAt.trim()) {
    normalized.updatedAt = r.updatedAt.trim();
  }
  return normalized;
}

export function normalizeSlackCallbackResult(raw: unknown): SlackCallbackResult | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const workspaceId = typeof r.workspaceId === 'string' && r.workspaceId.trim() ? r.workspaceId.trim() : null;
  const workspaceName = typeof r.workspaceName === 'string' && r.workspaceName.trim() ? r.workspaceName.trim() : null;
  if (!workspaceId || !workspaceName) return null;

  const connectionId = typeof r.connectionId === 'string' && r.connectionId.trim()
    ? r.connectionId.trim()
    : (typeof r.id === 'string' && r.id.trim() ? r.id.trim() : workspaceId);

  const legacyActorId = typeof r.actorId === 'string' && r.actorId.trim() ? r.actorId.trim() : undefined;
  const slackUserId = typeof r.slackUserId === 'string' && r.slackUserId.trim()
    ? r.slackUserId.trim()
    : (legacyActorId ?? 'unknown');

  const result: SlackCallbackResult = {
    connectionId,
    workspaceId,
    workspaceName,
    slackUserId,
    actorId: legacyActorId ?? slackUserId,
  };

  if (typeof r.returnTo === 'string' && r.returnTo.trim()) {
    result.returnTo = r.returnTo.trim();
  }
  return result;
}

export const slackConnectionApi = {
  list: async (): Promise<{ connections: SlackConnectionPublicInfo[] }> => {
    const data = await apiClient.request<{ connections: unknown[] }>('/api/connections/myslack');
    const rawList = Array.isArray(data?.connections) ? data.connections : [];
    const connections: SlackConnectionPublicInfo[] = [];
    for (const item of rawList) {
      const normalized = normalizeSlackConnection(item);
      if (normalized) connections.push(normalized);
    }
    return { connections };
  },

  start: (options?: SlackStartConnectionOptions): Promise<{ url: string }> => {
    const body = options ? JSON.stringify(options) : undefined;
    return apiClient.request<{ url: string }>('/api/connections/myslack/start', {
      method: 'POST',
      credentials: 'include',
      ...(body ? { body } : {}),
    });
  },

  complete: async (input: { code?: string; state: string; error?: string }): Promise<SlackCallbackResult> => {
    const raw = await apiClient.request<unknown>('/api/connections/myslack/callback', {
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(20000),
    }, true);
    const normalized = normalizeSlackCallbackResult(raw);
    if (!normalized) {
      throw new Error('Dữ liệu phản hồi kết nối Slack không hợp lệ.');
    }
    return normalized;
  },

  disconnect: (id: string): Promise<{ success: true; revoked: boolean }> =>
    apiClient.request<{ success: true; revoked: boolean }>(
      '/api/connections/myslack/' + encodeURIComponent(id),
      { method: 'DELETE', credentials: 'include' }
    ),
};

export const slackSessionOwner = gmailSessionOwner;
export { conversationReturnPath };

export function openSlackAuthorization(value: string): void {
  const url = new URL(value);
  const slack = url.origin === 'https://slack.com' && url.pathname === '/oauth/v2/authorize';
  const fixture = url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  if ((!slack && !fixture) || url.username || url.password || url.hash) {
    throw new Error('Không mở được trang kết nối Slack.');
  }
  window.location.assign(url.href);
}
