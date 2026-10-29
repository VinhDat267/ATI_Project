import { describe, expect, it } from 'vitest';
import { decideSlackModelUse, type SlackModelPolicy, type SlackModelRequest } from '../src/index.js';

function inputs(): { policy: SlackModelPolicy; request: SlackModelRequest } {
  const binding = { atiUserId: 'ati-a', connectionId: 'conn-free', workspaceId: 'T_FREE', slackUserId: 'U_FREE_A', identityVersion: 1 };
  return {
    policy: { binding, connectionActive: true, consent: { status: 'granted', policyVersion: 'policy-1', providerId: 'verified-provider', retentionDays: 7 }, provider: { id: 'verified-provider', verified: true, noTraining: true, maxRetentionDays: 7 } },
    request: { binding: { ...binding }, policyVersion: 'policy-1', requestedRetentionDays: 7 },
  };
}

describe('Slack source model authorization', () => {
  it('allows the exact approved boundary without relying on OAuth scopes', () => {
    const { policy, request } = inputs();
    expect(decideSlackModelUse(policy, request)).toEqual({ allowed: true });
  });
  it('requires active connection even when consent and provider are valid', () => {
    const { policy, request } = inputs();
    policy.connectionActive = false;
    expect(decideSlackModelUse(policy, request)).toEqual({ allowed: false, reason: 'connection_inactive' });
  });
  it.each(['atiUserId', 'connectionId', 'workspaceId', 'slackUserId', 'identityVersion'] as const)('rejects changed %s before considering consent', field => {
    const { policy, request } = inputs();
    request.binding = { ...request.binding, [field]: field === 'identityVersion' ? 2 : 'different' };
    policy.consent.status = 'revoked';
    expect(decideSlackModelUse(policy, request)).toEqual({ allowed: false, reason: 'identity_changed' });
  });
  it.each(['pending', 'revoked'] as const)('blocks %s consent despite an active user connection', status => {
    const { policy, request } = inputs();
    policy.consent.status = status;
    expect(decideSlackModelUse(policy, request)).toEqual({ allowed: false, reason: 'consent_missing' });
  });
  it('rejects a stale policy version', () => {
    const { policy, request } = inputs();
    request.policyVersion = 'policy-old';
    expect(decideSlackModelUse(policy, request)).toEqual({ allowed: false, reason: 'policy_changed' });
  });
  it('never approves an empty policy version even if both sides match', () => {
    const { policy, request } = inputs();
    policy.consent.policyVersion = request.policyVersion = '';
    expect(decideSlackModelUse(policy, request)).toEqual({ allowed: false, reason: 'policy_changed' });
  });
  it.each(['id', 'verified', 'noTraining'] as const)('rejects provider %s outside approval', field => {
    const { policy, request } = inputs();
    policy.provider = { ...policy.provider, [field]: field === 'id' ? 'different-provider' : false };
    expect(decideSlackModelUse(policy, request)).toEqual({ allowed: false, reason: 'provider_unverified' });
  });
  it('never treats matching empty provider IDs as evidence', () => {
    const { policy, request } = inputs();
    policy.consent.providerId = policy.provider.id = '';
    expect(decideSlackModelUse(policy, request)).toEqual({ allowed: false, reason: 'provider_unverified' });
  });
  it.each(['requested', 'consent', 'provider'] as const)('rejects invalid %s retention values', field => {
    for (const invalid of [-1, NaN, Infinity, '7', undefined]) {
      const { policy, request } = inputs();
      if (field === 'requested') request.requestedRetentionDays = invalid as number;
      if (field === 'consent') policy.consent.retentionDays = invalid as number;
      if (field === 'provider') policy.provider.maxRetentionDays = invalid as number;
      expect(decideSlackModelUse(policy, request)).toEqual({ allowed: false, reason: 'retention_exceeded' });
    }
  });
  it.each(['consent', 'provider'] as const)('obeys the smaller %s cap', field => {
    const { policy, request } = inputs();
    if (field === 'consent') policy.consent.retentionDays = 6;
    else policy.provider.maxRetentionDays = 6;
    expect(decideSlackModelUse(policy, request)).toEqual({ allowed: false, reason: 'retention_exceeded' });
  });
  it('supports zero-retention processing with explicit valid approval', () => {
    const { policy, request } = inputs();
    policy.consent.retentionDays = policy.provider.maxRetentionDays = request.requestedRetentionDays = 0;
    expect(decideSlackModelUse(policy, request)).toEqual({ allowed: true });
  });
  it('does not accept a matching but malformed identity', () => {
    const { policy, request } = inputs();
    policy.binding.identityVersion = request.binding.identityVersion = 0;
    expect(decideSlackModelUse(policy, request)).toEqual({ allowed: false, reason: 'identity_changed' });
  });
  it('reports the first blocker consistently when several are present', () => {
    const { policy, request } = inputs();
    policy.connectionActive = false; request.binding.workspaceId = 'T_OTHER'; policy.consent.status = 'revoked';
    request.policyVersion = 'old'; policy.provider.verified = false; request.requestedRetentionDays = 100;
    expect(decideSlackModelUse(policy, request)).toEqual({ allowed: false, reason: 'connection_inactive' });
    policy.connectionActive = true; request.binding = { ...policy.binding };
    expect(decideSlackModelUse(policy, request)).toEqual({ allowed: false, reason: 'consent_missing' });
    policy.consent.status = 'granted';
    expect(decideSlackModelUse(policy, request)).toEqual({ allowed: false, reason: 'policy_changed' });
    request.policyVersion = policy.consent.policyVersion;
    expect(decideSlackModelUse(policy, request)).toEqual({ allowed: false, reason: 'provider_unverified' });
  });
});
