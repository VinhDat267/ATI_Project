import { describe, expect, it } from 'vitest';
import {
  decideSlackModelUse,
  decideSlackSourceStorage,
  validateSlackPolicyReference,
  validateSlackPolicyEpoch,
  sameSlackPolicyEpoch,
  slackPolicyRefToEpoch,
  type SlackModelPolicy,
  type SlackModelRequest,
  type SlackPolicyReference,
  type SlackPolicyEpoch,
  type SlackSourceStorageRequest,
} from '../src/index.js';

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

  describe('Slack policy reference and source storage authorization', () => {
    function storageInputs(): { policy: SlackModelPolicy; request: SlackSourceStorageRequest } {
      const { policy } = inputs();
      const policyRef: SlackPolicyReference = {
        binding: { ...policy.binding },
        purpose: 'storage',
        requestedRetentionDays: 7,
        providerProfileId: 'verified-provider',
        configFingerprint: 'cfg-hash-123',
        policyVersion: 'policy-1',
        consentRevision: '1',
        providerRevision: '1',
      };
      return {
        policy,
        request: {
          binding: { ...policy.binding },
          policyRef,
          requestedRetentionDays: 7,
        },
      };
    }

    it('approves valid source storage request delegating to policy gates', () => {
      const { policy, request } = storageInputs();
      expect(decideSlackSourceStorage(policy, request)).toEqual({ allowed: true, maxRetentionDays: 7 });
    });

    it('prohibits persistent storage when retention is zero even with valid approval', () => {
      const { policy, request } = storageInputs();
      request.requestedRetentionDays = 0;
      expect(decideSlackSourceStorage(policy, request)).toEqual({ allowed: false, reason: 'retention_zero_denied' });

      const { policy: p2, request: r2 } = storageInputs();
      p2.consent.retentionDays = 0;
      expect(decideSlackSourceStorage(p2, r2)).toEqual({ allowed: false, reason: 'retention_zero_denied' });

      const { policy: p3, request: r3 } = storageInputs();
      r3.policyRef.requestedRetentionDays = 0;
      expect(decideSlackSourceStorage(p3, r3)).toEqual({ allowed: false, reason: 'retention_zero_denied' });
    });

    it('rejects storage request when purpose is not storage', () => {
      const { policy, request } = storageInputs();
      request.policyRef.purpose = 'manual_lookup';
      expect(decideSlackSourceStorage(policy, request)).toEqual({ allowed: false, reason: 'purpose_mismatch' });
    });

    it('delegates baseline authorization gates (connection_inactive, consent_missing, provider_unverified)', () => {
      const { policy, request } = storageInputs();
      policy.connectionActive = false;
      expect(decideSlackSourceStorage(policy, request)).toEqual({ allowed: false, reason: 'connection_inactive' });

      policy.connectionActive = true;
      policy.consent.status = 'revoked';
      expect(decideSlackSourceStorage(policy, request)).toEqual({ allowed: false, reason: 'consent_missing' });

      policy.consent.status = 'granted';
      policy.provider.verified = false;
      expect(decideSlackSourceStorage(policy, request)).toEqual({ allowed: false, reason: 'provider_unverified' });
    });

    it('rejects identity mismatch between request.binding and request.policyRef.binding', () => {
      const { policy, request } = storageInputs();
      request.policyRef.binding = { ...request.binding, atiUserId: 'another-user' };
      expect(decideSlackSourceStorage(policy, request)).toEqual({ allowed: false, reason: 'identity_changed' });
    });

    it('rejects policy version or providerProfileId mismatch between policyRef and server policy', () => {
      const { policy, request } = storageInputs();
      request.policyRef.policyVersion = 'policy-2';
      expect(decideSlackSourceStorage(policy, request)).toEqual({ allowed: false, reason: 'policy_changed' });

      const { policy: p2, request: r2 } = storageInputs();
      r2.policyRef.providerProfileId = 'other-provider';
      expect(decideSlackSourceStorage(p2, r2)).toEqual({ allowed: false, reason: 'policy_changed' });
    });

    it('obeys smaller retention ceiling among request, policyRef, consent, and provider', () => {
      const { policy, request } = storageInputs();
      request.requestedRetentionDays = 5;
      expect(decideSlackSourceStorage(policy, request)).toEqual({ allowed: true, maxRetentionDays: 5 });

      const { policy: p2, request: r2 } = storageInputs();
      r2.policyRef.requestedRetentionDays = 4;
      expect(decideSlackSourceStorage(p2, r2)).toEqual({ allowed: false, reason: 'retention_exceeded' });

      const { policy: p3, request: r3 } = storageInputs();
      r3.policyRef.requestedRetentionDays = 4;
      r3.requestedRetentionDays = 4;
      expect(decideSlackSourceStorage(p3, r3)).toEqual({ allowed: true, maxRetentionDays: 4 });
    });

    it('validates canonical SlackPolicyReference structure and positive decimal revisions', () => {
      const { request } = storageInputs();
      const valid = request.policyRef;
      expect(validateSlackPolicyReference(valid)).toEqual(valid);

      // Rejects non-canonical revisions: "0", "01", "-1", "v1", number, bigint
      for (const badRev of ['0', '01', '-1', 'v1', '1.0', '', '  ', null, undefined, 1 as any, 1n as any]) {
        expect(() => validateSlackPolicyReference({ ...valid, consentRevision: badRev })).toThrow(TypeError);
        expect(() => validateSlackPolicyReference({ ...valid, providerRevision: badRev })).toThrow(TypeError);
      }

      // Rejects purpose outside 5 canonical purposes
      for (const badPurpose of ['summarize', 'all', '', 'unknown', null, undefined]) {
        expect(() => validateSlackPolicyReference({ ...valid, purpose: badPurpose as any })).toThrow(TypeError);
      }

      // Rejects missing or non-string fields
      expect(() => validateSlackPolicyReference({ ...valid, providerProfileId: '' })).toThrow(TypeError);
      expect(() => validateSlackPolicyReference({ ...valid, configFingerprint: '   ' })).toThrow(TypeError);
      expect(() => validateSlackPolicyReference({ ...valid, policyVersion: '' })).toThrow(TypeError);

      // Rejects invalid retention days
      expect(() => validateSlackPolicyReference({ ...valid, requestedRetentionDays: -1 })).toThrow(TypeError);
      expect(() => validateSlackPolicyReference({ ...valid, requestedRetentionDays: 1.5 })).toThrow(TypeError);
      expect(() => validateSlackPolicyReference({ ...valid, requestedRetentionDays: '7' as any })).toThrow(TypeError);
    });

    it('strips extra properties and enforces own properties on SlackPolicyReference', () => {
      const { request } = storageInputs();
      const dirty = {
        ...request.policyRef,
        extraSecret: 'should-strip',
        nestedSecret: { token: '123' },
      };
      const clean = validateSlackPolicyReference(dirty);
      expect(clean).toEqual(request.policyRef);
      expect((clean as any).extraSecret).toBeUndefined();
    });

    it('validates canonical SlackPolicyEpoch and strips operational context', () => {
      const { request } = storageInputs();
      const epoch: SlackPolicyEpoch = {
        binding: request.policyRef.binding,
        providerProfileId: request.policyRef.providerProfileId,
        configFingerprint: request.policyRef.configFingerprint,
        policyVersion: request.policyRef.policyVersion,
        consentRevision: request.policyRef.consentRevision,
        providerRevision: request.policyRef.providerRevision,
      };

      const clean = validateSlackPolicyEpoch(epoch);
      expect(clean).toEqual(epoch);

      // Conversions from SlackPolicyReference drop purpose & requestedRetentionDays
      expect(slackPolicyRefToEpoch(request.policyRef)).toEqual(epoch);

      // Rejects non-canonical revisions: "0", "01", "-1", "v1", number
      for (const badRev of ['0', '01', '-1', 'v1', '1.0', '', '  ', null, undefined, 1 as any]) {
        expect(() => validateSlackPolicyEpoch({ ...epoch, consentRevision: badRev })).toThrow(TypeError);
        expect(() => validateSlackPolicyEpoch({ ...epoch, providerRevision: badRev })).toThrow(TypeError);
      }

      // Rejects missing/empty string fields
      expect(() => validateSlackPolicyEpoch({ ...epoch, providerProfileId: '' })).toThrow(TypeError);
      expect(() => validateSlackPolicyEpoch({ ...epoch, configFingerprint: '   ' })).toThrow(TypeError);
      expect(() => validateSlackPolicyEpoch({ ...epoch, policyVersion: '' })).toThrow(TypeError);

      // Strips extra fields
      const dirty = { ...epoch, purpose: 'storage', extraField: 'remove-me' };
      const cleaned = validateSlackPolicyEpoch(dirty);
      expect(cleaned).toEqual(epoch);
      expect((cleaned as any).purpose).toBeUndefined();
      expect((cleaned as any).extraField).toBeUndefined();
    });

    it('sameSlackPolicyEpoch checks exact immutable authorization identity', () => {
      const { request } = storageInputs();
      const epochA = slackPolicyRefToEpoch(request.policyRef);
      const epochB = slackPolicyRefToEpoch(request.policyRef);
      expect(sameSlackPolicyEpoch(epochA, epochB)).toBe(true);

      // Differentiates provider revision bump
      expect(sameSlackPolicyEpoch(epochA, { ...epochB, providerRevision: '2' })).toBe(false);

      // Differentiates consent revision bump
      expect(sameSlackPolicyEpoch(epochA, { ...epochB, consentRevision: '2' })).toBe(false);

      // Differentiates binding change
      expect(sameSlackPolicyEpoch(epochA, { ...epochB, binding: { ...epochB.binding, connectionId: 'other-conn' } })).toBe(false);
    });
  });
});
