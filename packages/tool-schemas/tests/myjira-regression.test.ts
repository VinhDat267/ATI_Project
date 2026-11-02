import { describe, expect, it, vi } from 'vitest';
import {
  ALL_TOOLS,
  SERVICE_REGISTRY,
  getServiceDefinition,
} from '../src/index.js';
import { MYJIRA_SERVICE } from '../src/registry/myjira.js';
import {
  validateJiraPlanConnection,
  type JiraPlanConnection,
} from '../src/myjira-context.js';

describe('Catalog and Registry Invariants (Flag-Off Isolation)', () => {
  it('preserves exactly 33 tools in ALL_TOOLS with no myjira tools included', () => {
    expect(ALL_TOOLS).toHaveLength(33);
    expect(ALL_TOOLS.some((t) => t.service === 'myjira')).toBe(false);
  });

  it('preserves exactly 8 services in SERVICE_REGISTRY with no myjira service included', () => {
    expect(SERVICE_REGISTRY).toHaveLength(8);
    expect(SERVICE_REGISTRY.some((s) => s.id === 'myjira')).toBe(false);
  });

  it('keeps ALL_TOOLS at 33 and SERVICE_REGISTRY at 8 even if MYJIRA_ENABLED is set in process.env', async () => {
    const prev = process.env.MYJIRA_ENABLED;
    try {
      process.env.MYJIRA_ENABLED = 'true';
      vi.resetModules();
      const freshIndex = await import('../src/index.js');
      expect(freshIndex.ALL_TOOLS).toHaveLength(33);
      expect(freshIndex.SERVICE_REGISTRY).toHaveLength(8);
      expect(freshIndex.ALL_TOOLS.some((t) => t.service === 'myjira')).toBe(false);
      expect(freshIndex.SERVICE_REGISTRY.some((s) => s.id === 'myjira')).toBe(false);
    } finally {
      if (prev === undefined) {
        delete process.env.MYJIRA_ENABLED;
      } else {
        process.env.MYJIRA_ENABLED = prev;
      }
      vi.resetModules();
    }
  });

  it('keeps legacy shared Jira service definition unchanged', () => {
    const legacyJira = getServiceDefinition('jira');
    expect(legacyJira).toBeDefined();
    expect(legacyJira!.id).toBe('jira');
    expect(legacyJira!.connection).toBeUndefined(); // shared
    expect(legacyJira!.scopes).toEqual(['read', 'write']);
    expect(legacyJira!.credentialFields).toHaveLength(3);
  });

  it('defines MYJIRA_SERVICE as an opt-in personal connection service', () => {
    expect(MYJIRA_SERVICE.id).toBe('myjira');
    expect(MYJIRA_SERVICE.name).toBe('Jira');
    expect(MYJIRA_SERVICE.connection).toBe('personal');
    expect(MYJIRA_SERVICE.scopes).toEqual([
      'offline_access',
      'read:me',
      'read:jira-work',
      'write:jira-work',
    ]);
    expect(MYJIRA_SERVICE.scopeKey).toBe('sites');
    expect(MYJIRA_SERVICE.scopeLabel).toBe('Jira sites của bạn');
    expect(MYJIRA_SERVICE.credentialFields).toEqual([]);
    expect(MYJIRA_SERVICE.intentKeywords).toContain('jira');
    expect(MYJIRA_SERVICE.intentKeywords).toContain('ticket');
    expect(MYJIRA_SERVICE.intentKeywords).toContain('jira cá nhân');
  });
});

describe('JiraPlanConnection Validation & Purity', () => {
  const validPlanConn: JiraPlanConnection = {
    atiUserId: 'ati-user-001',
    jiraAccountId: 'jira-acc-local-01',
    atlassianAccountId: 'atlassian-account-opaque-id-99',
    workspaceId: 'ws-ati-01',
    membershipVersion: 1,
    grantId: 'grant-01',
    identityVersion: 1,
    workspaceVersion: 1,
    siteSteps: {
      step_1: {
        siteId: 'site-1',
        cloudId: '12345678-1234-1234-1234-123456789abc',
        sitePolicyVersion: 1,
      },
      step_2: {
        siteId: 'site-1',
        cloudId: '12345678-1234-1234-1234-123456789abc',
        sitePolicyVersion: 1,
        projectId: '10001',
        projectPolicyVersion: 1,
      },
    },
  };

  it('validates a valid JiraPlanConnection cleanly', () => {
    const validated = validateJiraPlanConnection(validPlanConn);
    expect(validated).toEqual(validPlanConn);
    expect(validated).not.toBe(validPlanConn);
  });

  it('deeply strips sensitive credentials from JiraPlanConnection and siteSteps', () => {
    const raw = {
      ...validPlanConn,
      accessToken: 'leak-token',
      refreshToken: 'leak-refresh',
      tokenVersion: 99, // tokenVersion is DB-only, must NOT be in plan connection
      siteSteps: {
        ...validPlanConn.siteSteps,
        step_1: {
          ...validPlanConn.siteSteps.step_1,
          apiKey: 'leak-site-key',
        },
      },
    };
    const cleaned = validateJiraPlanConnection(raw);
    expect((cleaned as any).accessToken).toBeUndefined();
    expect((cleaned as any).refreshToken).toBeUndefined();
    expect((cleaned as any).tokenVersion).toBeUndefined();
    expect((cleaned.siteSteps.step_1 as any).apiKey).toBeUndefined();
    expect(cleaned).toEqual(validPlanConn);
  });

  it('validates only own properties on siteSteps and ignores inherited prototype properties', () => {
    const proto = { evilStep: { siteId: 'evil' } };
    const raw = Object.assign(Object.create(proto), validPlanConn);
    const cleaned = validateJiraPlanConnection(raw);
    expect((cleaned.siteSteps as any).evilStep).toBeUndefined();
  });

  it.each([0, -1, 1.5, NaN, Infinity, '1', null, undefined])(
    'rejects non-positive safe integer workspaceVersion %s',
    (version) => {
      expect(() => validateJiraPlanConnection({ ...validPlanConn, workspaceVersion: version })).toThrow(
        TypeError
      );
    }
  );

  it.each([0, -1, 1.5, NaN, Infinity, '1', null, undefined])(
    'rejects non-positive safe integer sitePolicyVersion %s in siteSteps',
    (version) => {
      const invalid = {
        ...validPlanConn,
        siteSteps: {
          step_1: {
            siteId: 'site-1',
            cloudId: 'cloud-1',
            sitePolicyVersion: version,
          },
        },
      };
      expect(() => validateJiraPlanConnection(invalid)).toThrow(TypeError);
    }
  );

  it.each([0, -1, 1.5, NaN, Infinity, '1', null])(
    'rejects invalid projectPolicyVersion %s when present in siteSteps',
    (version) => {
      const invalid = {
        ...validPlanConn,
        siteSteps: {
          step_1: {
            siteId: 'site-1',
            cloudId: 'cloud-1',
            sitePolicyVersion: 1,
            projectId: '10001',
            projectPolicyVersion: version,
          },
        },
      };
      expect(() => validateJiraPlanConnection(invalid)).toThrow(TypeError);
    }
  );

  it('rejects siteSteps that are not a record or have invalid step scope shape', () => {
    expect(() => validateJiraPlanConnection({ ...validPlanConn, siteSteps: null })).toThrow(TypeError);
    expect(() => validateJiraPlanConnection({ ...validPlanConn, siteSteps: [] })).toThrow(TypeError);
    expect(() =>
      validateJiraPlanConnection({
        ...validPlanConn,
        siteSteps: {
          step_1: { siteId: 'site-1' }, // missing cloudId, sitePolicyVersion
        },
      })
    ).toThrow(TypeError);
  });

  it('rejects siteSteps entry that has projectId but is missing projectPolicyVersion', () => {
    const invalid = {
      ...validPlanConn,
      siteSteps: {
        step_1: {
          siteId: 'site-1',
          cloudId: '12345678-1234-1234-1234-123456789abc',
          sitePolicyVersion: 1,
          projectId: '10001',
          // missing projectPolicyVersion
        },
      },
    };
    expect(() => validateJiraPlanConnection(invalid)).toThrow(TypeError);
  });

  it('rejects siteSteps entry that has projectPolicyVersion but is missing projectId', () => {
    const invalid = {
      ...validPlanConn,
      siteSteps: {
        step_1: {
          siteId: 'site-1',
          cloudId: '12345678-1234-1234-1234-123456789abc',
          sitePolicyVersion: 1,
          projectPolicyVersion: 1,
          // missing projectId
        },
      },
    };
    expect(() => validateJiraPlanConnection(invalid)).toThrow(TypeError);
  });

  it('safely preserves arbitrary valid step ID "__proto__" as an own property without prototype corruption', () => {
    const stepScope = {
      siteId: 'site-1',
      cloudId: '12345678-1234-1234-1234-123456789abc',
      sitePolicyVersion: 1,
    };
    const raw = {
      ...validPlanConn,
      siteSteps: {
        ['__proto__']: stepScope,
      },
    };
    // Assert fixture hasOwn('__proto__') BEFORE validator
    expect(Object.prototype.hasOwnProperty.call(raw.siteSteps, '__proto__')).toBe(true);

    const cleaned = validateJiraPlanConnection(raw);
    expect(Object.prototype.hasOwnProperty.call(cleaned.siteSteps, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(cleaned.siteSteps)).not.toBe(raw.siteSteps['__proto__']);
    expect(cleaned.siteSteps['__proto__'].siteId).toBe('site-1');
  });
});
