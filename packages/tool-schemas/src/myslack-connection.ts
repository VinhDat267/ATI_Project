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
  updatedAt?: string;
}

export interface SlackProcessingConsentInfo {
  workspaceId: string;
  providerId: string;
  policyVersion: string;
  status: SlackConsentStatus;
  retentionDays: number;
  evidenceRef?: string;
  authorizedBy?: string;
  grantedAt?: string;
  revokedAt?: string;
  id?: string;
  updatedAt?: string;
}

export interface SlackStartConnectionResponse {
  url: string;
}

export interface SlackCallbackResult {
  connectionId: string;
  workspaceId: string;
  workspaceName: string;
  slackUserId: string;
  returnTo?: string;
}

export interface SlackListConnectionsResponse {
  connections: SlackConnectionPublicInfo[];
}

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function requireOwnProperty(obj: Record<string, unknown>, prop: string): unknown {
  if (!Object.hasOwn(obj, prop)) {
    throw new TypeError(`Field '${prop}' is required as an own property`);
  }
  return obj[prop];
}

function requireNonBlankString(val: unknown, fieldName: string): string {
  if (typeof val !== 'string' || val.trim().length === 0) {
    throw new TypeError(`Field '${fieldName}' must be a non-blank string`);
  }
  return val;
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

function validateIsoUtcDate(val: unknown, fieldName: string): string {
  if (!isValidIsoUtcDate(val)) {
    throw new TypeError(`Field '${fieldName}' must be a valid ISO 8601 UTC date string, got: ${String(val)}`);
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

  const id = requireNonBlankString(requireOwnProperty(input, 'id'), 'id');
  const workspaceId = requireNonBlankString(requireOwnProperty(input, 'workspaceId'), 'workspaceId');
  const workspaceName = requireNonBlankString(requireOwnProperty(input, 'workspaceName'), 'workspaceName');
  const slackUserId = requireNonBlankString(requireOwnProperty(input, 'slackUserId'), 'slackUserId');
  const slackUserLabel = requireNonBlankString(requireOwnProperty(input, 'slackUserLabel'), 'slackUserLabel');

  const rawStatus = requireOwnProperty(input, 'status');
  if (typeof rawStatus !== 'string' || !VALID_CONNECTION_STATUSES.has(rawStatus as SlackConnectionStatus)) {
    throw new TypeError(`Invalid connection status: ${String(rawStatus)}`);
  }
  const status = rawStatus as SlackConnectionStatus;

  const rawConsentStatus = requireOwnProperty(input, 'consentStatus');
  if (typeof rawConsentStatus !== 'string' || !VALID_CONSENT_STATUSES.has(rawConsentStatus as SlackConsentStatus)) {
    throw new TypeError(`Invalid consentStatus: ${String(rawConsentStatus)}`);
  }
  const consentStatus = rawConsentStatus as SlackConsentStatus;

  const rawIdentityVersion = requireOwnProperty(input, 'identityVersion');
  if (
    typeof rawIdentityVersion !== 'number' ||
    !Number.isSafeInteger(rawIdentityVersion) ||
    rawIdentityVersion <= 0
  ) {
    throw new TypeError(
      `Field 'identityVersion' must be a positive safe integer, got: ${String(rawIdentityVersion)}`
    );
  }
  const identityVersion = rawIdentityVersion;

  const rawScopes = requireOwnProperty(input, 'scopes');
  if (!Array.isArray(rawScopes)) {
    throw new TypeError("Field 'scopes' must be an array of non-blank strings");
  }
  for (const s of rawScopes) {
    if (typeof s !== 'string' || s.trim().length === 0) {
      throw new TypeError("Field 'scopes' must contain only non-blank strings");
    }
  }
  const scopes = [...rawScopes];

  const connectedAt = validateIsoUtcDate(requireOwnProperty(input, 'connectedAt'), 'connectedAt');

  const rawProcessingReady = requireOwnProperty(input, 'processingReady');
  if (typeof rawProcessingReady !== 'boolean') {
    throw new TypeError("Field 'processingReady' must be a boolean");
  }
  const processingReady = rawProcessingReady;

  if (processingReady === true) {
    if (status !== 'active') {
      throw new TypeError("processingReady requires status === 'active'");
    }
    if (consentStatus !== 'granted') {
      throw new TypeError("processingReady requires consentStatus === 'granted'");
    }
  }

  let updatedAt: string | undefined;
  if (Object.hasOwn(input, 'updatedAt') && input.updatedAt !== undefined) {
    updatedAt = validateIsoUtcDate(input.updatedAt, 'updatedAt');
  }

  const result: SlackConnectionPublicInfo = {
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
  };
  if (updatedAt !== undefined) {
    result.updatedAt = updatedAt;
  }
  return result;
}

export function validateSlackProcessingConsentInfo(input: unknown): SlackProcessingConsentInfo {
  if (!isRecord(input)) {
    throw new TypeError('Expected an object for SlackProcessingConsentInfo');
  }

  const workspaceId = requireNonBlankString(requireOwnProperty(input, 'workspaceId'), 'workspaceId');
  const providerId = requireNonBlankString(requireOwnProperty(input, 'providerId'), 'providerId');
  const policyVersion = requireNonBlankString(requireOwnProperty(input, 'policyVersion'), 'policyVersion');

  const rawStatus = requireOwnProperty(input, 'status');
  if (typeof rawStatus !== 'string' || !VALID_CONSENT_STATUSES.has(rawStatus as SlackConsentStatus)) {
    throw new TypeError(`Invalid consent status: ${String(rawStatus)}`);
  }
  const status = rawStatus as SlackConsentStatus;

  const rawRetentionDays = requireOwnProperty(input, 'retentionDays');
  if (
    typeof rawRetentionDays !== 'number' ||
    !Number.isSafeInteger(rawRetentionDays) ||
    rawRetentionDays < 0
  ) {
    throw new TypeError(
      `Field 'retentionDays' must be a non-negative safe integer (>= 0), got: ${String(rawRetentionDays)}`
    );
  }
  const retentionDays = rawRetentionDays;

  let evidenceRef: string | undefined;
  let authorizedBy: string | undefined;
  let grantedAt: string | undefined;
  let revokedAt: string | undefined;
  let id: string | undefined;
  let updatedAt: string | undefined;

  if (status === 'granted') {
    evidenceRef = requireNonBlankString(requireOwnProperty(input, 'evidenceRef'), 'evidenceRef');
    authorizedBy = requireNonBlankString(requireOwnProperty(input, 'authorizedBy'), 'authorizedBy');
    grantedAt = validateIsoUtcDate(requireOwnProperty(input, 'grantedAt'), 'grantedAt');
  } else {
    if (Object.hasOwn(input, 'evidenceRef') && input.evidenceRef !== undefined) {
      evidenceRef = requireNonBlankString(input.evidenceRef, 'evidenceRef');
    }
    if (Object.hasOwn(input, 'authorizedBy') && input.authorizedBy !== undefined) {
      authorizedBy = requireNonBlankString(input.authorizedBy, 'authorizedBy');
    }
    if (Object.hasOwn(input, 'grantedAt') && input.grantedAt !== undefined) {
      grantedAt = validateIsoUtcDate(input.grantedAt, 'grantedAt');
    }
  }

  if (Object.hasOwn(input, 'revokedAt') && input.revokedAt !== undefined) {
    revokedAt = validateIsoUtcDate(input.revokedAt, 'revokedAt');
  }

  if (Object.hasOwn(input, 'id') && input.id !== undefined) {
    id = requireNonBlankString(input.id, 'id');
  }

  if (Object.hasOwn(input, 'updatedAt') && input.updatedAt !== undefined) {
    updatedAt = validateIsoUtcDate(input.updatedAt, 'updatedAt');
  }

  const result: SlackProcessingConsentInfo = {
    workspaceId,
    providerId,
    policyVersion,
    status,
    retentionDays,
  };
  if (id !== undefined) result.id = id;
  if (evidenceRef !== undefined) result.evidenceRef = evidenceRef;
  if (authorizedBy !== undefined) result.authorizedBy = authorizedBy;
  if (grantedAt !== undefined) result.grantedAt = grantedAt;
  if (revokedAt !== undefined) result.revokedAt = revokedAt;
  if (updatedAt !== undefined) result.updatedAt = updatedAt;

  return result;
}

export function validateSlackStartConnectionResponse(input: unknown): SlackStartConnectionResponse {
  if (!isRecord(input)) {
    throw new TypeError('Expected an object for SlackStartConnectionResponse');
  }
  const url = requireNonBlankString(requireOwnProperty(input, 'url'), 'url');
  return { url };
}

export function validateSlackCallbackResult(input: unknown): SlackCallbackResult {
  if (!isRecord(input)) {
    throw new TypeError('Expected an object for SlackCallbackResult');
  }

  const connectionId = requireNonBlankString(requireOwnProperty(input, 'connectionId'), 'connectionId');
  const workspaceId = requireNonBlankString(requireOwnProperty(input, 'workspaceId'), 'workspaceId');
  const workspaceName = requireNonBlankString(requireOwnProperty(input, 'workspaceName'), 'workspaceName');
  const slackUserId = requireNonBlankString(requireOwnProperty(input, 'slackUserId'), 'slackUserId');

  let returnTo: string | undefined;
  if (Object.hasOwn(input, 'returnTo') && input.returnTo !== undefined) {
    returnTo = requireNonBlankString(input.returnTo, 'returnTo');
  }

  const result: SlackCallbackResult = {
    connectionId,
    workspaceId,
    workspaceName,
    slackUserId,
  };
  if (returnTo !== undefined) {
    result.returnTo = returnTo;
  }
  return result;
}

export function validateSlackListConnectionsResponse(input: unknown): SlackListConnectionsResponse {
  if (!isRecord(input)) {
    throw new TypeError('Expected an object for SlackListConnectionsResponse');
  }

  const rawConnections = requireOwnProperty(input, 'connections');
  if (!Array.isArray(rawConnections)) {
    throw new TypeError("Field 'connections' must be an array");
  }

  return {
    connections: rawConnections.map(validateSlackConnectionPublicInfo),
  };
}
