import { describe, expect, it } from 'vitest';
import type { JiraBinding, JiraSourceRef } from '../src/myjira-context.js';
import {
  type JiraModelPolicy,
  type JiraModelRequest,
  type JiraAuthorizationLease,
  type JiraVerifiedDirectorySite,
  decideJiraModelUse,
  validateJiraAuthorizationLease,
  validateVerifiedDirectory,
  JIRA_SQL_LOCK_HIERARCHY,
} from '../src/myjira-policy.js';

const binding: JiraBinding = {
  atiUserId: 'ati-user-001',
  jiraAccountId: 'jira-acc-local-01',
  atlassianAccountId: 'atlassian-account-opaque-id-99',
  workspaceId: 'ws-ati-01',
  membershipVersion: 1,
  grantId: 'grant-01',
  identityVersion: 1,
};

const issueSourceRef: JiraSourceRef = {
  binding,
  workspaceId: 'ws-ati-01',
  workspaceVersion: 1,
  siteId: 'site-1',
  cloudId: '12345678-1234-1234-1234-123456789abc',
  sitePolicyVersion: 1,
  projectId: '10001',
  projectPolicyVersion: 1,
  resourceType: 'issue',
  providerResourceId: '20002',
  revision: 'rev-issue-1',
};

const siteSourceRef: JiraSourceRef = {
  binding,
  workspaceId: 'ws-ati-01',
  workspaceVersion: 1,
  siteId: 'site-1',
  cloudId: '12345678-1234-1234-1234-123456789abc',
  sitePolicyVersion: 1,
  resourceType: 'site',
  providerResourceId: '12345678-1234-1234-1234-123456789abc',
  revision: 'rev-site-1',
};

function cloneBinding(b: JiraBinding): JiraBinding {
  return { ...b };
}

function cloneSource(s: JiraSourceRef): JiraSourceRef {
  return {
    ...s,
    binding: cloneBinding(s.binding),
  };
}

function validPolicyAndRequest(source: JiraSourceRef = issueSourceRef): {
  policy: JiraModelPolicy;
  request: JiraModelRequest;
} {
  const policySource = cloneSource(source);
  const requestSource = cloneSource(source);
  return {
    policy: {
      source: policySource,
      currentBinding: cloneBinding(policySource.binding),
      workspaceActive: true,
      currentWorkspaceVersion: policySource.workspaceVersion,
      membershipStatus: 'active',
      siteActive: true,
      currentSitePolicyVersion: policySource.sitePolicyVersion,
      projectAllowed: true,
      currentProjectPolicyVersion: policySource.projectPolicyVersion,
      nativePermission: 'granted',
    },
    request: {
      source: requestSource,
    },
  };
}

describe('decideJiraModelUse Pure Server Evidence Contract', () => {
  it('allows model use when all server-verified conditions are met and nativePermission is granted', () => {
    const { policy, request } = validPolicyAndRequest();
    expect(decideJiraModelUse(policy, request)).toEqual({ allowed: true });
  });

  it('allows site-level resource without requiring projectAllowed or projectPolicyVersion', () => {
    const { policy, request } = validPolicyAndRequest(siteSourceRef);
    policy.projectAllowed = false; // should not affect site resource
    policy.currentProjectPolicyVersion = undefined;
    expect(decideJiraModelUse(policy, request)).toEqual({ allowed: true });
  });

  it('blocks with identity_changed when binding actor or versions differ', () => {
    const { policy, request } = validPolicyAndRequest();
    request.source.binding = { ...binding, atiUserId: 'different-ati-user' };
    expect(decideJiraModelUse(policy, request)).toEqual({
      allowed: false,
      reason: 'identity_changed',
    });
  });

  it('blocks with source_mismatch and prevents borrowing native permissions when source targets differ', () => {
    // Attack scenario: Attacker tries to use nativePermission='granted' from Issue A
    // to access Issue B by modifying request.source.providerResourceId
    const { policy, request } = validPolicyAndRequest();
    request.source = { ...request.source, providerResourceId: '999999' };
    expect(decideJiraModelUse(policy, request)).toEqual({
      allowed: false,
      reason: 'source_mismatch',
    });

    // Swapping siteId or cloudId also fails closed with source_mismatch
    const { policy: p2, request: r2 } = validPolicyAndRequest();
    r2.source = { ...r2.source, siteId: 'different-site' };
    expect(decideJiraModelUse(p2, r2)).toEqual({
      allowed: false,
      reason: 'source_mismatch',
    });
  });

  it('blocks with workspace_inactive when workspaceActive is false', () => {
    const { policy, request } = validPolicyAndRequest();
    policy.workspaceActive = false;
    expect(decideJiraModelUse(policy, request)).toEqual({
      allowed: false,
      reason: 'workspace_inactive',
    });
  });

  it.each(['pending', 'rejected', 'removed'] as const)(
    'blocks with membership_inactive when membershipStatus is %s',
    (status) => {
      const { policy, request } = validPolicyAndRequest();
      policy.membershipStatus = status;
      expect(decideJiraModelUse(policy, request)).toEqual({
        allowed: false,
        reason: 'membership_inactive',
      });
    }
  );

  it('blocks with site_disabled when siteActive is false', () => {
    const { policy, request } = validPolicyAndRequest();
    policy.siteActive = false;
    expect(decideJiraModelUse(policy, request)).toEqual({
      allowed: false,
      reason: 'site_disabled',
    });
  });

  it('blocks with project_denied when resource is not site and projectAllowed is false', () => {
    const { policy, request } = validPolicyAndRequest();
    policy.projectAllowed = false;
    expect(decideJiraModelUse(policy, request)).toEqual({
      allowed: false,
      reason: 'project_denied',
    });
  });

  it('blocks with policy_stale when workspaceVersion is out of date', () => {
    const { policy, request } = validPolicyAndRequest();
    policy.currentWorkspaceVersion = policy.source.workspaceVersion + 1;
    expect(decideJiraModelUse(policy, request)).toEqual({
      allowed: false,
      reason: 'policy_stale',
    });
  });

  it('blocks with policy_stale when sitePolicyVersion is out of date', () => {
    const { policy, request } = validPolicyAndRequest();
    policy.currentSitePolicyVersion = policy.source.sitePolicyVersion + 1;
    expect(decideJiraModelUse(policy, request)).toEqual({
      allowed: false,
      reason: 'policy_stale',
    });
  });

  it('blocks with policy_stale when projectPolicyVersion is out of date', () => {
    const { policy, request } = validPolicyAndRequest();
    policy.currentProjectPolicyVersion = (policy.source.projectPolicyVersion ?? 1) + 1;
    expect(decideJiraModelUse(policy, request)).toEqual({
      allowed: false,
      reason: 'policy_stale',
    });
  });

  it('blocks with native_permission_denied when nativePermission is denied', () => {
    const { policy, request } = validPolicyAndRequest();
    policy.nativePermission = 'denied';
    expect(decideJiraModelUse(policy, request)).toEqual({
      allowed: false,
      reason: 'native_permission_denied',
    });
  });

  it.each(['unavailable', 'unknown_status' as any, null as any, undefined as any])(
    'fails closed with provider_unavailable when nativePermission is %s',
    (permission) => {
      const { policy, request } = validPolicyAndRequest();
      policy.nativePermission = permission;
      expect(decideJiraModelUse(policy, request)).toEqual({
        allowed: false,
        reason: 'provider_unavailable',
      });
    }
  );

  it('fails closed with provider_unavailable when nativePermission is inherited rather than an own property', () => {
    const proto = { nativePermission: 'granted' as const };
    const { policy, request } = validPolicyAndRequest();
    const evilPolicy = Object.create(proto);
    Object.assign(evilPolicy, policy);
    delete evilPolicy.nativePermission;
    expect(decideJiraModelUse(evilPolicy, request)).toEqual({
      allowed: false,
      reason: 'provider_unavailable',
    });
  });

  it('enforces strict priority ordering when multiple blockers are present simultaneously', () => {
    const { policy, request } = validPolicyAndRequest();
    // Configure multiple simultaneous failures:
    // 1. identity_changed (highest priority)
    // 2. workspace_inactive
    // 3. native_permission_denied
    request.source.binding = { ...binding, atiUserId: 'diff-user' };
    policy.workspaceActive = false;
    policy.nativePermission = 'denied';

    expect(decideJiraModelUse(policy, request)).toEqual({
      allowed: false,
      reason: 'identity_changed',
    });

    // Fix identity, next priority should be workspace_inactive
    request.source.binding = { ...binding };
    expect(decideJiraModelUse(policy, request)).toEqual({
      allowed: false,
      reason: 'workspace_inactive',
    });

    // Fix workspace, next should be native_permission_denied
    policy.workspaceActive = true;
    expect(decideJiraModelUse(policy, request)).toEqual({
      allowed: false,
      reason: 'native_permission_denied',
    });
  });

  describe('fail-closed invalid_evidence handling', () => {
    it.each([
      ['null policy', null, validPolicyAndRequest().request],
      ['undefined policy', undefined, validPolicyAndRequest().request],
      ['non-object policy', 'policy', validPolicyAndRequest().request],
      ['empty object policy', {}, validPolicyAndRequest().request],
      ['null request', validPolicyAndRequest().policy, null],
      ['undefined request', validPolicyAndRequest().policy, undefined],
      ['non-object request', validPolicyAndRequest().policy, 'request'],
      ['empty object request', validPolicyAndRequest().policy, {}],
      ['missing policy source', { ...validPolicyAndRequest().policy, source: undefined }, validPolicyAndRequest().request],
      ['null policy source', { ...validPolicyAndRequest().policy, source: null }, validPolicyAndRequest().request],
      ['missing request source', validPolicyAndRequest().policy, { source: undefined }],
      ['null request source', validPolicyAndRequest().policy, { source: null }],
      ['malformed policy source (invalid JiraSourceRef)', { ...validPolicyAndRequest().policy, source: { siteId: 'site-1' } }, validPolicyAndRequest().request],
      ['malformed request source (invalid JiraSourceRef)', validPolicyAndRequest().policy, { source: { siteId: 'site-1' } }],
    ])('denies with invalid_evidence when input or source is invalid: %s', (_, p, r) => {
      expect(decideJiraModelUse(p as any, r as any)).toEqual({
        allowed: false,
        reason: 'invalid_evidence',
      });
    });

    it.each([
      ['both workspace versions 0', { workspaceVersion: 0, currentWorkspaceVersion: 0 }],
      ['both site policy versions 0', { sitePolicyVersion: 0, currentSitePolicyVersion: 0 }],
      ['both project policy versions 0', { projectPolicyVersion: 0, currentProjectPolicyVersion: 0 }],
      ['non-safe integer currentWorkspaceVersion', { currentWorkspaceVersion: 1.5 }],
      ['negative currentWorkspaceVersion', { currentWorkspaceVersion: -1 }],
      ['NaN currentWorkspaceVersion', { currentWorkspaceVersion: NaN }],
      ['string currentWorkspaceVersion', { currentWorkspaceVersion: '1' }],
      ['currentSitePolicyVersion 0', { currentSitePolicyVersion: 0 }],
      ['currentProjectPolicyVersion 0 for issue', { currentProjectPolicyVersion: 0 }],
    ])('denies with invalid_evidence when versions are invalid: %s', (_, overrides) => {
      const { policy, request } = validPolicyAndRequest();
      if ('workspaceVersion' in overrides) {
        (policy.source as any).workspaceVersion = (overrides as any).workspaceVersion;
        (request.source as any).workspaceVersion = (overrides as any).workspaceVersion;
      }
      if ('sitePolicyVersion' in overrides) {
        (policy.source as any).sitePolicyVersion = (overrides as any).sitePolicyVersion;
        (request.source as any).sitePolicyVersion = (overrides as any).sitePolicyVersion;
      }
      if ('projectPolicyVersion' in overrides) {
        (policy.source as any).projectPolicyVersion = (overrides as any).projectPolicyVersion;
        (request.source as any).projectPolicyVersion = (overrides as any).projectPolicyVersion;
      }
      if ('currentWorkspaceVersion' in overrides) {
        (policy as any).currentWorkspaceVersion = (overrides as any).currentWorkspaceVersion;
      }
      if ('currentSitePolicyVersion' in overrides) {
        (policy as any).currentSitePolicyVersion = (overrides as any).currentSitePolicyVersion;
      }
      if ('currentProjectPolicyVersion' in overrides) {
        (policy as any).currentProjectPolicyVersion = (overrides as any).currentProjectPolicyVersion;
      }
      expect(decideJiraModelUse(policy, request)).toEqual({
        allowed: false,
        reason: 'invalid_evidence',
      });
    });

    it.each([
      ['workspaceActive is truthy string', { workspaceActive: 'true' }],
      ['workspaceActive is number 1', { workspaceActive: 1 }],
      ['workspaceActive is null', { workspaceActive: null }],
      ['siteActive is truthy string', { siteActive: 'true' }],
      ['siteActive is number 1', { siteActive: 1 }],
      ['projectAllowed is truthy string', { projectAllowed: 'true' }],
      ['projectAllowed is number 1', { projectAllowed: 1 }],
    ])('denies with invalid_evidence when boolean flags are non-boolean: %s', (_, flagOverrides) => {
      const { policy, request } = validPolicyAndRequest();
      Object.assign(policy, flagOverrides);
      expect(decideJiraModelUse(policy, request)).toEqual({
        allowed: false,
        reason: 'invalid_evidence',
      });
    });

    it('denies with invalid_evidence when flags are prototype-inherited rather than own properties', () => {
      const { policy, request } = validPolicyAndRequest();
      const proto = { workspaceActive: true, siteActive: true, projectAllowed: true };
      const evilPolicy = Object.create(proto);
      Object.assign(evilPolicy, policy);
      delete evilPolicy.workspaceActive;
      expect(decideJiraModelUse(evilPolicy, request)).toEqual({
        allowed: false,
        reason: 'invalid_evidence',
      });

      const evilPolicy2 = Object.create(proto);
      Object.assign(evilPolicy2, policy);
      delete evilPolicy2.siteActive;
      expect(decideJiraModelUse(evilPolicy2, request)).toEqual({
        allowed: false,
        reason: 'invalid_evidence',
      });

      const evilPolicy3 = Object.create(proto);
      Object.assign(evilPolicy3, policy);
      delete evilPolicy3.projectAllowed;
      expect(decideJiraModelUse(evilPolicy3, request)).toEqual({
        allowed: false,
        reason: 'invalid_evidence',
      });
    });

    it('denies with invalid_evidence when source or currentBinding is prototype-inherited rather than own property', () => {
      const { policy, request } = validPolicyAndRequest();

      // Inherited policy.source
      const protoPolicySource = { source: policy.source };
      const evilPolicy1 = Object.create(protoPolicySource);
      Object.assign(evilPolicy1, policy);
      delete evilPolicy1.source;
      expect(decideJiraModelUse(evilPolicy1, request)).toEqual({
        allowed: false,
        reason: 'invalid_evidence',
      });

      // Inherited request.source
      const protoReqSource = { source: request.source };
      const evilReq = Object.create(protoReqSource);
      Object.assign(evilReq, request);
      delete evilReq.source;
      expect(decideJiraModelUse(policy, evilReq)).toEqual({
        allowed: false,
        reason: 'invalid_evidence',
      });

      // Inherited policy.currentBinding
      const protoBinding = { currentBinding: policy.currentBinding };
      const evilPolicy2 = Object.create(protoBinding);
      Object.assign(evilPolicy2, policy);
      delete evilPolicy2.currentBinding;
      expect(decideJiraModelUse(evilPolicy2, request)).toEqual({
        allowed: false,
        reason: 'invalid_evidence',
      });
    });
  });

  describe('currentBinding authoritative binding tests (Backend Finding 1)', () => {
    it('denies with identity_changed when currentBinding membershipVersion changes even if source and request match', () => {
      const { policy, request } = validPolicyAndRequest();
      policy.currentBinding = {
        ...policy.source.binding,
        membershipVersion: policy.source.binding.membershipVersion + 1,
      };
      expect(decideJiraModelUse(policy, request)).toEqual({
        allowed: false,
        reason: 'identity_changed',
      });
    });

    it('denies with identity_changed when currentBinding identityVersion changes even if source and request match', () => {
      const { policy, request } = validPolicyAndRequest();
      policy.currentBinding = {
        ...policy.source.binding,
        identityVersion: policy.source.binding.identityVersion + 1,
      };
      expect(decideJiraModelUse(policy, request)).toEqual({
        allowed: false,
        reason: 'identity_changed',
      });
    });

    it('denies with identity_changed when currentBinding grantId or accountId changes', () => {
      const { policy, request } = validPolicyAndRequest();
      policy.currentBinding = {
        ...policy.source.binding,
        grantId: 'different-grant',
      };
      expect(decideJiraModelUse(policy, request)).toEqual({
        allowed: false,
        reason: 'identity_changed',
      });
    });

    it.each([
      ['missing currentBinding', undefined],
      ['null currentBinding', null],
      ['malformed currentBinding', { atiUserId: 'only-user' }],
    ])('denies with invalid_evidence when currentBinding is invalid: %s', (_, badBinding) => {
      const { policy, request } = validPolicyAndRequest();
      (policy as any).currentBinding = badBinding;
      expect(decideJiraModelUse(policy, request)).toEqual({
        allowed: false,
        reason: 'invalid_evidence',
      });
    });
  });
});

describe('JiraAuthorizationLease Contract', () => {
  const validLease: JiraAuthorizationLease = {
    leaseId: 'lease-001',
    binding,
    workspaceId: 'ws-ati-01',
    cloudId: '12345678-1234-1234-1234-123456789abc',
    acquiredAt: '2026-11-01T10:00:00.000Z',
    expiresAt: '2026-11-01T10:00:30.000Z',
    ttlMs: 30000,
  };

  it('validates a correct lease cleanly', () => {
    const validated = validateJiraAuthorizationLease(validLease);
    expect(validated).toEqual(validLease);
  });

  it('rejects lease when workspaceId differs from binding.workspaceId', () => {
    const mismatched = {
      ...validLease,
      workspaceId: 'different-ws-id',
    };
    expect(() => validateJiraAuthorizationLease(mismatched)).toThrow(TypeError);
  });

  it('rejects lease when ttlMs does not exactly equal expiresAt - acquiredAt in milliseconds', () => {
    // 30s TTL declared, but duration between acquiredAt and expiresAt is 1 hour (3600000ms)
    const mismatchedLease = {
      ...validLease,
      acquiredAt: '2026-11-01T10:00:00.000Z',
      expiresAt: '2026-11-01T11:00:00.000Z',
      ttlMs: 30000,
    };
    expect(() => validateJiraAuthorizationLease(mismatchedLease)).toThrow(TypeError);
  });

  it('rejects lease when expiresAt is not after acquiredAt', () => {
    const inverted = {
      ...validLease,
      acquiredAt: '2026-11-01T10:00:30.000Z',
      expiresAt: '2026-11-01T10:00:00.000Z',
    };
    expect(() => validateJiraAuthorizationLease(inverted)).toThrow(TypeError);
  });

  it.each([0, -1000, 1.5, NaN, Infinity, '30000', null, undefined])(
    'rejects non-positive safe integer ttlMs %s in validateJiraAuthorizationLease',
    (ttl) => {
      expect(() => validateJiraAuthorizationLease({ ...validLease, ttlMs: ttl })).toThrow(TypeError);
    }
  );

  it('deeply strips any sensitive credentials passed into lease', () => {
    const raw = {
      ...validLease,
      binding: {
        ...binding,
        accessToken: 'leak-token',
      },
      secretToken: 'leak-secret',
    };
    const cleaned = validateJiraAuthorizationLease(raw);
    expect((cleaned.binding as any).accessToken).toBeUndefined();
    expect((cleaned as any).secretToken).toBeUndefined();
  });

  it('validates only own properties on lease and ignores prototype pollution', () => {
    const proto = { leaseId: 'proto-lease' };
    const input = Object.create(proto);
    Object.assign(input, validLease);
    delete (input as any).leaseId;
    expect(() => validateJiraAuthorizationLease(input)).toThrow(TypeError);
  });
});

describe('JiraVerifiedDirectorySite Contract', () => {
  const validDirectory: JiraVerifiedDirectorySite[] = [
    {
      siteId: 'site-1',
      cloudId: '12345678-1234-1234-1234-123456789abc',
      name: 'Primary Jira Site',
      url: 'https://primary.atlassian.net',
      active: true,
      policyVersion: 1,
    },
    {
      siteId: 'site-2',
      cloudId: '87654321-4321-4321-4321-cba987654321',
      name: 'Secondary Jira Site',
      url: 'https://secondary.atlassian.net',
      active: false,
      policyVersion: 2,
    },
  ];

  it('validates a verified directory list cleanly', () => {
    const validated = validateVerifiedDirectory(validDirectory);
    expect(validated).toEqual(validDirectory);
  });

  it('rejects non-array or invalid entries in validateVerifiedDirectory', () => {
    expect(() => validateVerifiedDirectory(null)).toThrow(TypeError);
    expect(() => validateVerifiedDirectory({})).toThrow(TypeError);
    expect(() => validateVerifiedDirectory([{ siteId: 'site-1' }])).toThrow(TypeError);
    expect(() =>
      validateVerifiedDirectory([
        {
          ...validDirectory[0]!,
          policyVersion: 0,
        },
      ])
    ).toThrow(TypeError);
  });
});

describe('PostgreSQL Lock Hierarchy Invariant', () => {
  it('specifies exactly the 5 approved tables in strict ascending lock order and excludes jira_oauth_grants', () => {
    expect(JIRA_SQL_LOCK_HIERARCHY).toEqual([
      'ati_workspaces',
      'ati_workspace_memberships',
      'jira_accounts',
      'ati_workspace_jira_sites',
      'ati_workspace_jira_projects',
    ]);
    expect((JIRA_SQL_LOCK_HIERARCHY as readonly string[]).includes('jira_oauth_grants')).toBe(false);
  });
});
