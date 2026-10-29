import { apiClient } from './api-client';
import { gmailSessionOwner, conversationReturnPath } from './gmail-connection';
import {
  validateSlackConnectionPublicInfo,
  validateSlackCallbackResult,
  type SlackConnectionPublicInfo as BaseSlackConnectionPublicInfo,
  type SlackCallbackResult as BaseSlackCallbackResult,
  type SlackConnectionStatus,
  type SlackConsentStatus,
} from '@wap/tool-schemas';

export type { SlackConnectionStatus, SlackConsentStatus };

export interface SlackConnectionPublicInfo extends BaseSlackConnectionPublicInfo {
  missingScopes?: string[];
  actorId?: string;
}

export type SlackConnection = SlackConnectionPublicInfo;

export interface SlackStartConnectionOptions {
  returnTo?: string;
  workspaceHint?: string;
}

export interface SlackCallbackResult extends BaseSlackCallbackResult {
  actorId?: string;
}

export function normalizeSlackConnection(raw: unknown): SlackConnectionPublicInfo | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  // Check slackUserId (canonical) vs actorId (legacy alias)
  let slackUserId: unknown;
  if (Object.hasOwn(r, 'slackUserId')) {
    slackUserId = r.slackUserId;
  } else if (Object.hasOwn(r, 'actorId')) {
    slackUserId = r.actorId;
  }

  // Check slackUserLabel (canonical) vs actorId (legacy alias)
  let slackUserLabel: unknown;
  if (Object.hasOwn(r, 'slackUserLabel')) {
    slackUserLabel = r.slackUserLabel;
  } else if (Object.hasOwn(r, 'actorId')) {
    slackUserLabel = r.actorId;
  }

  // Absent consent defaults to 'pending'; absent readiness defaults to false
  const consentStatus = Object.hasOwn(r, 'consentStatus') ? r.consentStatus : 'pending';
  const processingReady = Object.hasOwn(r, 'processingReady') ? r.processingReady : false;

  const candidate: Record<string, unknown> = {
    id: r.id,
    workspaceId: r.workspaceId,
    workspaceName: r.workspaceName,
    slackUserId,
    slackUserLabel,
    status: r.status,
    identityVersion: r.identityVersion,
    scopes: r.scopes,
    connectedAt: r.connectedAt,
    consentStatus,
    processingReady,
  };
  if (Object.hasOwn(r, 'updatedAt') && r.updatedAt !== undefined) {
    candidate.updatedAt = r.updatedAt;
  }

  // Whitelist legacy optional missingScopes with valid entries
  let missingScopes: string[] | undefined;
  if (Object.hasOwn(r, 'missingScopes') && Array.isArray(r.missingScopes)) {
    missingScopes = r.missingScopes.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
  }

  try {
    const validated = validateSlackConnectionPublicInfo(candidate);
    const legacyActorId = typeof r.actorId === 'string' && r.actorId.trim().length > 0 ? r.actorId.trim() : undefined;
    const result: SlackConnectionPublicInfo = {
      ...validated,
    };
    if (missingScopes !== undefined) {
      result.missingScopes = missingScopes;
    }
    if (legacyActorId !== undefined) {
      result.actorId = legacyActorId;
    }
    return result;
  } catch {
    return null;
  }
}

export function normalizeSlackCallbackResult(raw: unknown): SlackCallbackResult | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  // Check connectionId (canonical) vs id (legacy alias)
  let connectionId: unknown;
  if (Object.hasOwn(r, 'connectionId')) {
    connectionId = r.connectionId;
  } else if (Object.hasOwn(r, 'id')) {
    connectionId = r.id;
  }

  // Check slackUserId (canonical) vs actorId (legacy alias)
  let slackUserId: unknown;
  if (Object.hasOwn(r, 'slackUserId')) {
    slackUserId = r.slackUserId;
  } else if (Object.hasOwn(r, 'actorId')) {
    slackUserId = r.actorId;
  }

  const candidate: Record<string, unknown> = {
    connectionId,
    workspaceId: r.workspaceId,
    workspaceName: r.workspaceName,
    slackUserId,
  };
  if (Object.hasOwn(r, 'returnTo') && r.returnTo !== undefined) {
    candidate.returnTo = r.returnTo;
  }

  try {
    const validated = validateSlackCallbackResult(candidate);
    const legacyActorId = typeof r.actorId === 'string' && r.actorId.trim().length > 0 ? r.actorId.trim() : undefined;
    return {
      ...validated,
      actorId: legacyActorId ?? validated.slackUserId,
    };
  } catch {
    return null;
  }
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
