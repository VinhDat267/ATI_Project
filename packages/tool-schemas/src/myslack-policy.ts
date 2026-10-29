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

export type SlackModelBlockReason = 'connection_inactive' | 'identity_changed' | 'consent_missing' | 'policy_changed' | 'provider_unverified' | 'retention_exceeded';
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
