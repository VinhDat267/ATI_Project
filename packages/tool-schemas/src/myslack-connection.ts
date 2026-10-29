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
  consentStatus: SlackConsentStatus;
  processingReady: boolean;
  connectedAt: string;
  updatedAt: string;
}

export interface SlackProcessingConsentInfo {
  id: string;
  workspaceId: string;
  providerId: string;
  status: SlackConsentStatus;
  evidenceRef?: string;
  authorizedBy?: string;
  grantedAt?: string;
  retentionDays: number;
  updatedAt: string;
}

export interface SlackCallbackResult {
  ok: boolean;
  connection?: SlackConnectionPublicInfo;
  error?: string;
  errorCode?: string;
  returnTo?: string;
}

export interface SlackListConnectionsResponse {
  connections: SlackConnectionPublicInfo[];
}

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function isValidIsoUtcDate(dateStr: unknown): dateStr is string {
  if (typeof dateStr !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(dateStr)) {
    return false;
  }
  const timestamp = Date.parse(dateStr);
  if (Number.isNaN(timestamp)) return false;
  const date = new Date(timestamp);
  return date.toISOString().startsWith(dateStr.slice(0, 10));
}

function requireNonEmptyString(val: unknown, fieldName: string): string {
  if (typeof val !== 'string' || val.trim().length === 0) {
    throw new TypeError(`Field '${fieldName}' must be a non-empty string`);
  }
  return val;
}

const VALID_CONNECTION_STATUSES: Set<SlackConnectionStatus> = new Set([
  'active',
  'reconnect_required',
  'revoked',
]);

const VALID_CONSENT_STATUSES: Set<SlackConsentStatus> = new Set([
  'pending',
  'granted',
  'revoked',
]);

export function validateSlackConnectionPublicInfo(input: unknown): SlackConnectionPublicInfo {
  if (!isRecord(input)) {
    throw new TypeError('Expected an object for SlackConnectionPublicInfo');
  }

  const id = requireNonEmptyString(input.id, 'id');
  const workspaceId = requireNonEmptyString(input.workspaceId, 'workspaceId');
  const workspaceName = requireNonEmptyString(input.workspaceName, 'workspaceName');
  const slackUserId = requireNonEmptyString(input.slackUserId, 'slackUserId');
  const slackUserLabel = requireNonEmptyString(input.slackUserLabel, 'slackUserLabel');

  if (typeof input.status !== 'string' || !VALID_CONNECTION_STATUSES.has(input.status as SlackConnectionStatus)) {
    throw new TypeError(`Invalid connection status: ${String(input.status)}`);
  }
  const status = input.status as SlackConnectionStatus;

  if (typeof input.consentStatus !== 'string' || !VALID_CONSENT_STATUSES.has(input.consentStatus as SlackConsentStatus)) {
    throw new TypeError(`Invalid consentStatus: ${String(input.consentStatus)}`);
  }
  const consentStatus = input.consentStatus as SlackConsentStatus;

  if (
    typeof input.identityVersion !== 'number' ||
    !Number.isSafeInteger(input.identityVersion) ||
    input.identityVersion <= 0
  ) {
    throw new TypeError(
      `Field 'identityVersion' must be a positive safe integer, got: ${String(input.identityVersion)}`
    );
  }
  const identityVersion = input.identityVersion;

  if (!Array.isArray(input.scopes) || !input.scopes.every((s) => typeof s === 'string')) {
    throw new TypeError("Field 'scopes' must be an array of strings");
  }
  const scopes = [...input.scopes];

  if (!isValidIsoUtcDate(input.connectedAt)) {
    throw new TypeError(
      `Field 'connectedAt' must be a valid ISO 8601 UTC date string, got: ${String(input.connectedAt)}`
    );
  }
  const connectedAt = input.connectedAt;

  if (!isValidIsoUtcDate(input.updatedAt)) {
    throw new TypeError(
      `Field 'updatedAt' must be a valid ISO 8601 UTC date string, got: ${String(input.updatedAt)}`
    );
  }
  const updatedAt = input.updatedAt;

  if (typeof input.processingReady !== 'boolean') {
    throw new TypeError("Field 'processingReady' must be a boolean");
  }
  const processingReady = input.processingReady;

  if (processingReady === true) {
    if (status !== 'active') {
      throw new TypeError("processingReady requires status === 'active'");
    }
    if (consentStatus !== 'granted') {
      throw new TypeError("processingReady requires consentStatus === 'granted'");
    }
  }

  return {
    id,
    workspaceId,
    workspaceName,
    slackUserId,
    slackUserLabel,
    status,
    identityVersion,
    scopes,
    consentStatus,
    processingReady,
    connectedAt,
    updatedAt,
  };
}

export function validateSlackProcessingConsentInfo(input: unknown): SlackProcessingConsentInfo {
  if (!isRecord(input)) {
    throw new TypeError('Expected an object for SlackProcessingConsentInfo');
  }

  const id = requireNonEmptyString(input.id, 'id');
  const workspaceId = requireNonEmptyString(input.workspaceId, 'workspaceId');
  const providerId = requireNonEmptyString(input.providerId, 'providerId');

  if (typeof input.status !== 'string' || !VALID_CONSENT_STATUSES.has(input.status as SlackConsentStatus)) {
    throw new TypeError(`Invalid consent status: ${String(input.status)}`);
  }
  const status = input.status as SlackConsentStatus;

  if (
    typeof input.retentionDays !== 'number' ||
    !Number.isSafeInteger(input.retentionDays) ||
    input.retentionDays <= 0
  ) {
    throw new TypeError(
      `Field 'retentionDays' must be a positive safe integer, got: ${String(input.retentionDays)}`
    );
  }
  const retentionDays = input.retentionDays;

  if (!isValidIsoUtcDate(input.updatedAt)) {
    throw new TypeError(
      `Field 'updatedAt' must be a valid ISO 8601 UTC date string, got: ${String(input.updatedAt)}`
    );
  }
  const updatedAt = input.updatedAt;

  let evidenceRef: string | undefined;
  let authorizedBy: string | undefined;
  let grantedAt: string | undefined;

  if (status === 'granted') {
    evidenceRef = requireNonEmptyString(input.evidenceRef, 'evidenceRef');
    authorizedBy = requireNonEmptyString(input.authorizedBy, 'authorizedBy');
    if (!isValidIsoUtcDate(input.grantedAt)) {
      throw new TypeError(
        `Field 'grantedAt' must be a valid ISO 8601 UTC date string when status is 'granted', got: ${String(
          input.grantedAt
        )}`
      );
    }
    grantedAt = input.grantedAt;
  } else {
    if (typeof input.evidenceRef === 'string' && input.evidenceRef.trim().length > 0) {
      evidenceRef = input.evidenceRef;
    }
    if (typeof input.authorizedBy === 'string' && input.authorizedBy.trim().length > 0) {
      authorizedBy = input.authorizedBy;
    }
    if (isValidIsoUtcDate(input.grantedAt)) {
      grantedAt = input.grantedAt;
    }
  }

  const result: SlackProcessingConsentInfo = {
    id,
    workspaceId,
    providerId,
    status,
    retentionDays,
    updatedAt,
  };
  if (evidenceRef !== undefined) result.evidenceRef = evidenceRef;
  if (authorizedBy !== undefined) result.authorizedBy = authorizedBy;
  if (grantedAt !== undefined) result.grantedAt = grantedAt;

  return result;
}

export function validateSlackCallbackResult(input: unknown): SlackCallbackResult {
  if (!isRecord(input)) {
    throw new TypeError('Expected an object for SlackCallbackResult');
  }

  if (typeof input.ok !== 'boolean') {
    throw new TypeError("Field 'ok' must be a boolean");
  }

  const result: SlackCallbackResult = { ok: input.ok };

  if (input.connection !== undefined && input.connection !== null) {
    result.connection = validateSlackConnectionPublicInfo(input.connection);
  }

  if (typeof input.error === 'string') {
    result.error = input.error;
  }
  if (typeof input.errorCode === 'string') {
    result.errorCode = input.errorCode;
  }
  if (typeof input.returnTo === 'string') {
    result.returnTo = input.returnTo;
  }

  return result;
}

export function validateSlackListConnectionsResponse(input: unknown): SlackListConnectionsResponse {
  if (!isRecord(input)) {
    throw new TypeError('Expected an object for SlackListConnectionsResponse');
  }

  if (!Array.isArray(input.connections)) {
    throw new TypeError("Field 'connections' must be an array");
  }

  return {
    connections: input.connections.map(validateSlackConnectionPublicInfo),
  };
}
