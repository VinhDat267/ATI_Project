import { sameSlackBinding, validateSlackBinding, type SlackBinding } from './myslack-context.js';

/** Constructed by the backend from verified evidence, never from model output or OAuth scopes alone. */
export interface SlackModelPolicy {
  binding: SlackBinding;
  connectionActive: boolean;
  consent: { status: 'pending' | 'granted' | 'revoked'; policyVersion: string; providerId: string; retentionDays: number };
  provider: { id: string; verified: boolean; noTraining: boolean; maxRetentionDays: number };
}

export interface SlackModelRequest {
  binding: SlackBinding;
  policyVersion: string;
  requestedRetentionDays: number;
}

export type SlackModelBlockReason =
  | 'connection_inactive'
  | 'identity_changed'
  | 'consent_missing'
  | 'policy_changed'
  | 'provider_unverified'
  | 'retention_exceeded';

export type SlackModelUseDecision = { allowed: true } | { allowed: false; reason: SlackModelBlockReason };

export function decideSlackModelUse(policy: SlackModelPolicy, request: SlackModelRequest): SlackModelUseDecision {
  const deny = (reason: SlackModelBlockReason): SlackModelUseDecision => ({ allowed: false, reason });
  if (policy.connectionActive !== true) return deny('connection_inactive');
  try {
    if (!sameSlackBinding(validateSlackBinding(policy.binding), validateSlackBinding(request.binding))) return deny('identity_changed');
  } catch { return deny('identity_changed'); }
  if (policy.consent.status !== 'granted') return deny('consent_missing');
  if (typeof policy.consent.policyVersion !== 'string' || !policy.consent.policyVersion.trim() || policy.consent.policyVersion !== request.policyVersion) return deny('policy_changed');
  const provider = policy.provider;
  if (typeof provider.id !== 'string' || !provider.id.trim() || provider.id !== policy.consent.providerId || provider.verified !== true || provider.noTraining !== true) return deny('provider_unverified');
  const retention = [request.requestedRetentionDays, policy.consent.retentionDays, provider.maxRetentionDays];
  if (!retention.every(days => Number.isFinite(days) && days >= 0) || request.requestedRetentionDays > policy.consent.retentionDays || request.requestedRetentionDays > provider.maxRetentionDays) return deny('retention_exceeded');
  return { allowed: true };
}

export type SlackPolicyPurpose =
  | 'manual_lookup'
  | 'triage'
  | 'planning'
  | 'digest'
  | 'storage';

export const SLACK_POLICY_PURPOSES: readonly SlackPolicyPurpose[] = [
  'manual_lookup',
  'triage',
  'planning',
  'digest',
  'storage',
] as const;

export interface SlackPolicyReference {
  binding: SlackBinding;
  purpose: SlackPolicyPurpose;
  requestedRetentionDays: number;
  providerProfileId: string;
  configFingerprint: string;
  policyVersion: string;
  consentRevision: string;
  providerRevision: string;
}

const CANONICAL_REVISION_REGEX = /^[1-9][0-9]*$/;

export function validateSlackPolicyReference(value: unknown): SlackPolicyReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid Slack policy reference');
  }
  const record = value as Record<string, unknown>;

  if (!Object.hasOwn(record, 'binding')) {
    throw new TypeError('Slack policy reference missing binding');
  }
  const cleanBinding = validateSlackBinding(record.binding);

  if (!Object.hasOwn(record, 'purpose') || typeof record.purpose !== 'string' || !SLACK_POLICY_PURPOSES.includes(record.purpose as SlackPolicyPurpose)) {
    throw new TypeError('Invalid Slack policy reference purpose');
  }

  if (!Object.hasOwn(record, 'requestedRetentionDays') || !Number.isSafeInteger(record.requestedRetentionDays) || (record.requestedRetentionDays as number) < 0) {
    throw new TypeError('Invalid Slack policy reference requestedRetentionDays');
  }

  for (const strField of ['providerProfileId', 'configFingerprint', 'policyVersion'] as const) {
    if (!Object.hasOwn(record, strField) || typeof record[strField] !== 'string' || !(record[strField] as string).trim()) {
      throw new TypeError(`Invalid Slack policy reference ${strField}`);
    }
  }

  for (const revField of ['consentRevision', 'providerRevision'] as const) {
    if (!Object.hasOwn(record, revField) || typeof record[revField] !== 'string' || !CANONICAL_REVISION_REGEX.test(record[revField] as string)) {
      throw new TypeError(`Invalid Slack policy reference ${revField}`);
    }
  }

  return {
    binding: cleanBinding,
    purpose: record.purpose as SlackPolicyPurpose,
    requestedRetentionDays: record.requestedRetentionDays as number,
    providerProfileId: (record.providerProfileId as string).trim(),
    configFingerprint: (record.configFingerprint as string).trim(),
    policyVersion: (record.policyVersion as string).trim(),
    consentRevision: record.consentRevision as string,
    providerRevision: record.providerRevision as string,
  };
}

export interface SlackSourceStorageRequest {
  binding: SlackBinding;
  policyRef: SlackPolicyReference;
  requestedRetentionDays: number;
}

export type SlackStorageBlockReason =
  | SlackModelBlockReason
  | 'retention_zero_denied'
  | 'purpose_mismatch';

export type SlackSourceStorageDecision =
  | { allowed: true; maxRetentionDays: number }
  | { allowed: false; reason: SlackStorageBlockReason };

export function decideSlackSourceStorage(
  policy: SlackModelPolicy,
  request: SlackSourceStorageRequest
): SlackSourceStorageDecision {
  const deny = (reason: SlackStorageBlockReason): SlackSourceStorageDecision => ({ allowed: false, reason });

  let cleanRequestBinding: SlackBinding;
  let cleanPolicyRef: SlackPolicyReference;
  try {
    cleanRequestBinding = validateSlackBinding(request.binding);
    cleanPolicyRef = validateSlackPolicyReference(request.policyRef);
  } catch {
    return deny('identity_changed');
  }

  if (!sameSlackBinding(cleanRequestBinding, cleanPolicyRef.binding)) {
    return deny('identity_changed');
  }

  // Delegate baseline authorization gates to decideSlackModelUse
  const baseline = decideSlackModelUse(policy, {
    binding: cleanRequestBinding,
    policyVersion: cleanPolicyRef.policyVersion,
    requestedRetentionDays: request.requestedRetentionDays,
  });

  if (!baseline.allowed) {
    if (
      baseline.reason === 'retention_exceeded' &&
      (request.requestedRetentionDays <= 0 || policy.consent.retentionDays <= 0 || policy.provider.maxRetentionDays <= 0)
    ) {
      return deny('retention_zero_denied');
    }
    return deny(baseline.reason);
  }

  // Storage-specific matching checks
  if (cleanPolicyRef.providerProfileId !== policy.provider.id || cleanPolicyRef.policyVersion !== policy.consent.policyVersion) {
    return deny('policy_changed');
  }

  if (cleanPolicyRef.purpose !== 'storage') {
    return deny('purpose_mismatch');
  }

  if (
    request.requestedRetentionDays <= 0 ||
    cleanPolicyRef.requestedRetentionDays <= 0 ||
    policy.consent.retentionDays <= 0 ||
    policy.provider.maxRetentionDays <= 0
  ) {
    return deny('retention_zero_denied');
  }

  if (
    !Number.isSafeInteger(request.requestedRetentionDays) ||
    request.requestedRetentionDays > cleanPolicyRef.requestedRetentionDays ||
    request.requestedRetentionDays > policy.consent.retentionDays ||
    request.requestedRetentionDays > policy.provider.maxRetentionDays
  ) {
    return deny('retention_exceeded');
  }

  const maxRetentionDays = Math.min(
    request.requestedRetentionDays,
    cleanPolicyRef.requestedRetentionDays,
    policy.consent.retentionDays,
    policy.provider.maxRetentionDays
  );

  return { allowed: true, maxRetentionDays };
}
