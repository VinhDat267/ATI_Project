import { describe, expect, it } from 'vitest';
import {
  type JiraBinding,
  type JiraCompoundKey,
  type JiraResourceType,
  type JiraSourceRef,
  formatJiraCompoundKey,
  parseJiraCompoundKey,
  isCrossSiteReference,
  validateJiraBinding,
  sameJiraBinding,
  validateJiraSourceRef,
  sameJiraSourceRef,
} from '../src/myjira-context.js';

const validBinding: JiraBinding = {
  atiUserId: 'ati-user-001',
  jiraAccountId: 'jira-acc-local-01',
  atlassianAccountId: 'atlassian-account-opaque-id-99',
  workspaceId: 'ws-ati-01',
  membershipVersion: 1,
  grantId: 'grant-01',
  identityVersion: 1,
};

const validSiteSourceRef: JiraSourceRef = {
  binding: validBinding,
  workspaceId: 'ws-ati-01',
  workspaceVersion: 1,
  siteId: 'site-1',
  cloudId: '12345678-1234-1234-1234-123456789abc',
  sitePolicyVersion: 1,
  resourceType: 'site',
  providerResourceId: '12345678-1234-1234-1234-123456789abc',
  revision: 'rev-site-1',
};

const validIssueSourceRef: JiraSourceRef = {
  binding: validBinding,
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

describe('Jira personal identity and binding boundaries (7 fields)', () => {
  it('recognizes an independent copy of the exact same 7-field identity', () => {
    expect(sameJiraBinding(validBinding, { ...validBinding })).toBe(true);
    expect(validateJiraBinding(validBinding)).toEqual(validBinding);
  });

  it.each([
    'atiUserId',
    'jiraAccountId',
    'atlassianAccountId',
    'workspaceId',
    'grantId',
  ] as const)('never equates bindings with different %s', (field) => {
    expect(sameJiraBinding(validBinding, { ...validBinding, [field]: 'different-value' })).toBe(false);
  });

  it.each([
    'membershipVersion',
    'identityVersion',
  ] as const)('never equates bindings with different %s', (field) => {
    expect(sameJiraBinding(validBinding, { ...validBinding, [field]: 2 })).toBe(false);
  });

  it.each([
    'atiUserId',
    'jiraAccountId',
    'atlassianAccountId',
    'workspaceId',
    'grantId',
  ] as const)('rejects missing, blank or non-string %s in validateJiraBinding', (field) => {
    for (const invalid of ['', '   ', null, undefined, 42, {}]) {
      expect(() => validateJiraBinding({ ...validBinding, [field]: invalid })).toThrow(TypeError);
    }
    const incomplete = { ...validBinding };
    delete (incomplete as any)[field];
    expect(() => validateJiraBinding(incomplete)).toThrow(TypeError);
  });

  it.each([0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, '1', null, undefined])(
    'rejects invalid membershipVersion %s in validateJiraBinding',
    (version) => {
      expect(() => validateJiraBinding({ ...validBinding, membershipVersion: version })).toThrow(TypeError);
    }
  );

  it.each([0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, '1', null, undefined])(
    'rejects invalid identityVersion %s in validateJiraBinding',
    (version) => {
      expect(() => validateJiraBinding({ ...validBinding, identityVersion: version })).toThrow(TypeError);
    }
  );

  it.each([null, undefined, [], 42, 'binding-string', true])(
    'rejects non-record input %s in validateJiraBinding',
    (input) => {
      expect(() => validateJiraBinding(input)).toThrow(TypeError);
    }
  );

  it('deeply strips sensitive properties (e.g. accessToken, refreshToken) and does not mutate input', () => {
    const rawInput = {
      ...validBinding,
      accessToken: 'leak-access-token-secret',
      refreshToken: 'leak-refresh-token-secret',
      clientSecret: 'leak-client-secret',
      tokenHash: 'leak-token-hash',
    };
    const cleaned = validateJiraBinding(rawInput);
    expect(cleaned).toEqual(validBinding);
    expect(cleaned).not.toBe(rawInput);
    expect((cleaned as any).accessToken).toBeUndefined();
    expect((cleaned as any).refreshToken).toBeUndefined();
    expect((rawInput as any).accessToken).toBe('leak-access-token-secret');
  });

  it('validates only own properties and does not read identity fields from prototype', () => {
    const proto = { atiUserId: 'proto-user' };
    const input = Object.create(proto);
    Object.assign(input, validBinding);
    delete (input as any).atiUserId;
    expect(() => validateJiraBinding(input)).toThrow(TypeError);
  });
});

describe('Canonical JSON Compound Keys & Cross-Site Detection', () => {
  it('formats compound keys using strict JSON.stringify tuple [workspaceId, cloudId, resourceType, providerId]', () => {
    const key: JiraCompoundKey = {
      workspaceId: 'ws-1',
      cloudId: 'cloud-1',
      resourceType: 'issue',
      providerId: '10001',
    };
    const formatted = formatJiraCompoundKey(key);
    expect(formatted).toBe(JSON.stringify(['ws-1', 'cloud-1', 'issue', '10001']));
  });

  it('proves anti-collision when IDs contain separator characters (e.g. colon ":")', () => {
    // Naive colon joining would yield "a:b:c:issue:1" for both.
    const keyA: JiraCompoundKey = {
      workspaceId: 'a:b',
      cloudId: 'c',
      resourceType: 'issue',
      providerId: '1',
    };
    const keyB: JiraCompoundKey = {
      workspaceId: 'a',
      cloudId: 'b:c',
      resourceType: 'issue',
      providerId: '1',
    };

    const formattedA = formatJiraCompoundKey(keyA);
    const formattedB = formatJiraCompoundKey(keyB);

    expect(formattedA).not.toBe(formattedB);
    expect(parseJiraCompoundKey(formattedA)).toEqual(keyA);
    expect(parseJiraCompoundKey(formattedB)).toEqual(keyB);
  });

  it('produces distinct compound keys for the same providerId across different workspaces or sites', () => {
    const keySiteA: JiraCompoundKey = {
      workspaceId: 'ws-1',
      cloudId: 'cloud-a',
      resourceType: 'issue',
      providerId: '10002',
    };
    const keySiteB: JiraCompoundKey = {
      workspaceId: 'ws-1',
      cloudId: 'cloud-b',
      resourceType: 'issue',
      providerId: '10002',
    };
    const keyWs2: JiraCompoundKey = {
      workspaceId: 'ws-2',
      cloudId: 'cloud-a',
      resourceType: 'issue',
      providerId: '10002',
    };

    expect(formatJiraCompoundKey(keySiteA)).not.toBe(formatJiraCompoundKey(keySiteB));
    expect(formatJiraCompoundKey(keySiteA)).not.toBe(formatJiraCompoundKey(keyWs2));
  });

  it('parses valid canonical compound keys correctly', () => {
    const raw = JSON.stringify(['ws-1', 'cloud-1', 'project', '10001']);
    const parsed = parseJiraCompoundKey(raw);
    expect(parsed).toEqual({
      workspaceId: 'ws-1',
      cloudId: 'cloud-1',
      resourceType: 'project',
      providerId: '10001',
    });
  });

  it.each([
    'not-json',
    '{}',
    '123',
    'null',
    '["ws-1", "cloud-1", "issue"]', // length 3
    '["ws-1", "cloud-1", "issue", "1", "extra"]', // length 5
    '["ws-1", "cloud-1", 123, "1"]', // non-string item
    '["", "cloud-1", "issue", "1"]', // empty string
    '["ws-1", "   ", "issue", "1"]', // blank string
    '["ws-1", "cloud-1", "unsupported_type", "1"]', // invalid resourceType
  ])('parseJiraCompoundKey rejects malformed input %s', (raw) => {
    expect(() => parseJiraCompoundKey(raw)).toThrow(TypeError);
  });

  it('isCrossSiteReference accurately flags cross-site and cross-workspace attempts', () => {
    const refA = { workspaceId: 'ws-1', cloudId: 'cloud-1' };
    const sameSite = { workspaceId: 'ws-1', cloudId: 'cloud-1' };
    const diffCloud = { workspaceId: 'ws-1', cloudId: 'cloud-2' };
    const diffWs = { workspaceId: 'ws-2', cloudId: 'cloud-1' };

    expect(isCrossSiteReference(refA, sameSite)).toBe(false);
    expect(isCrossSiteReference(refA, diffCloud)).toBe(true);
    expect(isCrossSiteReference(refA, diffWs)).toBe(true);
  });

  it('isCrossSiteReference returns true for missing, null, undefined, blank, or inherited fields (fail closed)', () => {
    const validRef = { workspaceId: 'ws-1', cloudId: 'cloud-1' };
    expect(isCrossSiteReference(null as any, validRef as any)).toBe(true);
    expect(isCrossSiteReference(validRef as any, null as any)).toBe(true);
    expect(isCrossSiteReference({} as any, {} as any)).toBe(true);
    expect(isCrossSiteReference({ workspaceId: '', cloudId: 'cloud-1' } as any, validRef as any)).toBe(true);
    expect(isCrossSiteReference({ workspaceId: 'ws-1', cloudId: '   ' } as any, validRef as any)).toBe(true);
    expect(
      isCrossSiteReference(
        { workspaceId: 'ws-1', cloudId: null } as any,
        { workspaceId: 'ws-1', cloudId: null } as any
      )
    ).toBe(true);

    // Inherited properties: two objects inheriting same workspaceId/cloudId must not bypass
    const proto = { workspaceId: 'ws-1', cloudId: 'cloud-1' };
    const evilA = Object.create(proto);
    const evilB = Object.create(proto);
    expect(isCrossSiteReference(evilA, evilB)).toBe(true);
  });
});

describe('JiraSourceRef Validation & Swap Invariants', () => {
  it('validates a site source ref cleanly', () => {
    const validated = validateJiraSourceRef(validSiteSourceRef);
    expect(validated).toEqual(validSiteSourceRef);
    expect(sameJiraSourceRef(validSiteSourceRef, validated)).toBe(true);
  });

  it('validates an issue source ref with required projectId and projectPolicyVersion', () => {
    const validated = validateJiraSourceRef(validIssueSourceRef);
    expect(validated).toEqual(validIssueSourceRef);
    expect(sameJiraSourceRef(validIssueSourceRef, validated)).toBe(true);
  });

  it('rejects source ref when workspaceId does not match binding.workspaceId', () => {
    const mismatched = {
      ...validSiteSourceRef,
      workspaceId: 'different-ws-id',
    };
    expect(() => validateJiraSourceRef(mismatched)).toThrow(TypeError);
  });

  it.each(['project', 'issue', 'comment'] as const)(
    'rejects %s source ref when missing projectId or projectPolicyVersion',
    (resourceType) => {
      const missingProjId = {
        ...validIssueSourceRef,
        resourceType,
        projectId: undefined,
      };
      expect(() => validateJiraSourceRef(missingProjId)).toThrow(TypeError);

      const missingPolicyVersion = {
        ...validIssueSourceRef,
        resourceType,
        projectPolicyVersion: undefined,
      };
      expect(() => validateJiraSourceRef(missingPolicyVersion)).toThrow(TypeError);

      const invalidPolicyVersion = {
        ...validIssueSourceRef,
        resourceType,
        projectPolicyVersion: 0,
      };
      expect(() => validateJiraSourceRef(invalidPolicyVersion)).toThrow(TypeError);
    }
  );

  it('rejects source ref when resourceType is project but projectId !== providerResourceId', () => {
    const mismatchedProjectRef: JiraSourceRef = {
      ...validIssueSourceRef,
      resourceType: 'project',
      projectId: '10001',
      providerResourceId: '10002', // mismatch with projectId
    };
    expect(() => validateJiraSourceRef(mismatchedProjectRef)).toThrow(TypeError);
  });

  it('rejects source ref when resourceType is site but providerResourceId !== cloudId', () => {
    const mismatchedSiteRef: JiraSourceRef = {
      ...validSiteSourceRef,
      resourceType: 'site',
      cloudId: '12345678-1234-1234-1234-123456789abc',
      providerResourceId: 'different-cloud-id', // mismatch with cloudId
    };
    expect(() => validateJiraSourceRef(mismatchedSiteRef)).toThrow(TypeError);
  });

  it.each([
    'PROJ-123',
    'PROJ',
    'issue-99',
    '0',
    '-1',
    '0123',
    '1.5',
    'abc',
    '',
    '   ',
  ])('rejects non-canonical positive decimal string %s as providerResourceId for issue/project/comment', (badId) => {
    const badRef = {
      ...validIssueSourceRef,
      providerResourceId: badId,
    };
    expect(() => validateJiraSourceRef(badRef)).toThrow(TypeError);
  });

  it.each([
    'PROJ',
    '0',
    '-1',
    '0123',
    '1.5',
    'abc',
    '',
    '   ',
  ])('rejects non-canonical positive decimal string %s as projectId for issue/project/comment', (badProjId) => {
    const badRef = {
      ...validIssueSourceRef,
      projectId: badProjId,
    };
    expect(() => validateJiraSourceRef(badRef)).toThrow(TypeError);
  });

  it.each([
    ['10001', '20002'],
    ['1', '1'],
    ['999999999', '888888888'],
  ])('accepts canonical positive decimal strings for projectId %s and providerResourceId %s', (projId, resId) => {
    const okRef = {
      ...validIssueSourceRef,
      projectId: projId,
      providerResourceId: resId,
    };
    expect(validateJiraSourceRef(okRef).projectId).toBe(projId);
  });

  it.each(['workspaceVersion', 'sitePolicyVersion'] as const)(
    'rejects non-positive %s in validateJiraSourceRef',
    (field) => {
      for (const invalid of [0, -1, 1.2, NaN, Infinity, '1', null, undefined]) {
        expect(() => validateJiraSourceRef({ ...validSiteSourceRef, [field]: invalid })).toThrow(TypeError);
      }
    }
  );

  it('sameJiraSourceRef returns false when any identity, target, or generation field is swapped', () => {
    expect(sameJiraSourceRef(validIssueSourceRef, { ...validIssueSourceRef, cloudId: 'other-cloud-id' })).toBe(false);
    expect(sameJiraSourceRef(validIssueSourceRef, { ...validIssueSourceRef, siteId: 'other-site' })).toBe(false);
    expect(sameJiraSourceRef(validIssueSourceRef, { ...validIssueSourceRef, projectId: 'other-proj' })).toBe(false);
    expect(sameJiraSourceRef(validIssueSourceRef, { ...validIssueSourceRef, providerResourceId: 'other-res' })).toBe(false);
    expect(sameJiraSourceRef(validIssueSourceRef, { ...validIssueSourceRef, sitePolicyVersion: 2 })).toBe(false);
    expect(sameJiraSourceRef(validIssueSourceRef, { ...validIssueSourceRef, projectPolicyVersion: 2 })).toBe(false);
    expect(sameJiraSourceRef(validIssueSourceRef, { ...validIssueSourceRef, workspaceVersion: 2 })).toBe(false);
    expect(sameJiraSourceRef(validIssueSourceRef, { ...validIssueSourceRef, revision: 'different-rev' })).toBe(false);

    // Swapping actor binding
    const otherBinding = { ...validBinding, atiUserId: 'other-ati-user' };
    expect(sameJiraSourceRef(validIssueSourceRef, {
      ...validIssueSourceRef,
      binding: otherBinding,
    })).toBe(false);
  });

  it('distinguishes revision change from policy version change', () => {
    const revChanged = { ...validIssueSourceRef, revision: 'rev-2' };
    const policyChanged = { ...validIssueSourceRef, projectPolicyVersion: 2 };

    expect(sameJiraSourceRef(validIssueSourceRef, revChanged)).toBe(false);
    expect(sameJiraSourceRef(validIssueSourceRef, policyChanged)).toBe(false);
    expect(revChanged.projectPolicyVersion).toBe(validIssueSourceRef.projectPolicyVersion);
    expect(policyChanged.revision).toBe(validIssueSourceRef.revision);
  });

  it('validates only own properties on JiraSourceRef and ignores prototype fields', () => {
    const proto = { siteId: 'proto-site' };
    const input = Object.create(proto);
    Object.assign(input, validSiteSourceRef);
    delete (input as any).siteId;
    expect(() => validateJiraSourceRef(input)).toThrow(TypeError);
  });
});
