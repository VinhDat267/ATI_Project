import { describe, it, expect, vi } from 'vitest';
import { decideJiraModelUse, type JiraModelPolicy, type JiraSourceRef } from '@wap/tool-schemas';
import { AdapterFactory } from '../../src/services/adapter-factory.js';
import { JiraDispatchGuard } from '../../src/services/jira/jira-dispatch-guard.js';

const key = 'a'.repeat(32);

function createMockDispatchPool(versions: {
  workspaceVersion: number;
  sitePolicyVersion: number;
  projectPolicyVersion: number;
  siteId: string;
}) {
  const query = vi.fn(async (sql: string) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('FROM jira_authorization_leases') && sql.includes('FOR UPDATE')) {
      return { rows: [{ status: 'active', expired: false }], rowCount: 1 };
    }
    if (sql.includes('FROM jira_authorization_leases')) {
      return {
        rows: [{
          status: 'active',
          expired: false,
          grant_id: 'grant-1',
          jira_account_id: 'acc-1',
          atlassian_account_id: 'atl-1',
          membership_version: 1,
          identity_version: 1,
          workspace_version: versions.workspaceVersion,
        }],
        rowCount: 1,
      };
    }
    if (sql.includes('FROM ati_workspaces')) {
      return { rows: [{ status: 'active', version: versions.workspaceVersion }], rowCount: 1 };
    }
    if (sql.includes('FROM ati_workspace_memberships')) {
      return {
        rows: [{
          jira_member_status: 'active',
          membership_version: 1,
          general_member_status: 'active',
          user_status: 'active',
        }],
        rowCount: 1,
      };
    }
    if (sql.includes('FROM jira_accounts')) {
      return {
        rows: [{
          id: 'acc-1',
          atlassian_account_id: 'atl-1',
          status: 'connected',
          identity_version: 1,
        }],
        rowCount: 1,
      };
    }
    if (sql.includes('FROM jira_oauth_grants')) {
      return {
        rows: [{ status: 'active', account_id: 'acc-1', scopes: ['read:jira-work', 'write:jira-work'] }],
        rowCount: 1,
      };
    }
    if (sql.includes('FROM jira_grant_sites')) {
      return {
        rows: [{ id: 'gs-1', scopes: ['read:jira-work', 'write:jira-work'] }],
        rowCount: 1,
      };
    }
    if (sql.includes('FROM ati_workspace_jira_sites')) {
      return {
        rows: [{ id: versions.siteId, active: true, policy_version: versions.sitePolicyVersion }],
        rowCount: 1,
      };
    }
    if (sql.includes('FROM ati_workspace_jira_projects')) {
      return {
        rows: [{ selected: true, policy_version: versions.projectPolicyVersion }],
        rowCount: 1,
      };
    }
    if (sql.includes('UPDATE jira_authorization_leases')) {
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected SQL in mock dispatch pool: ${sql}`);
  });

  const client = { query, release: vi.fn() };
  return {
    connect: vi.fn(async () => client),
  };
}

function makePolicy(source: JiraSourceRef, versions: {
  workspaceVersion: number;
  sitePolicyVersion: number;
  projectPolicyVersion?: number;
}): JiraModelPolicy {
  return {
    source,
    currentBinding: source.binding,
    workspaceActive: true,
    currentWorkspaceVersion: versions.workspaceVersion,
    membershipStatus: 'active',
    siteActive: true,
    currentSitePolicyVersion: versions.sitePolicyVersion,
    projectAllowed: true,
    ...(source.resourceType === 'site'
      ? {}
      : { currentProjectPolicyVersion: versions.projectPolicyVersion ?? 1 }),
    nativePermission: 'granted',
  };
}

describe('Jira workspaceVersion propagation through JiraDispatchGuard and AdapterFactory', () => {
  it('propagates workspaceVersion > 1 into _sourceRef for search_projects and search_issues so revalidation does not fail with policy_stale', async () => {
    const versions = {
      workspaceVersion: 2,
      sitePolicyVersion: 3,
      projectPolicyVersion: 4,
      siteId: 'site-1',
    };

    const pool = createMockDispatchPool(versions);
    const leaseManager = {
      acquireLease: vi.fn(async (params: { projectId?: string }) => ({
        leaseId: 'lease-1',
        workspaceId: 'ws-1',
        cloudId: 'cloud-1',
        ttlMs: 15000,
        acquiredAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 15000).toISOString(),
        binding: {
          atiUserId: 'user-1',
          jiraAccountId: 'acc-1',
          atlassianAccountId: 'atl-1',
          workspaceId: 'ws-1',
          membershipVersion: 1,
          grantId: 'grant-1',
          identityVersion: 1,
        },
        workspaceVersion: versions.workspaceVersion,
        sitePolicyVersion: versions.sitePolicyVersion,
        siteId: versions.siteId,
        projectPolicyVersion: params.projectId ? versions.projectPolicyVersion : null,
      })),
      releaseLease: vi.fn(async () => undefined),
    };
    const tokenManager = {
      getAccessToken: vi.fn(async () => 'jira-access-token'),
    };
    const dispatchGuard = new JiraDispatchGuard(pool as any, leaseManager as any, tokenManager as any);

    const project = { id: '10000', key: 'ATIT', name: 'ATI Test' };
    Object.defineProperty(project, 'policyVersion', { value: versions.projectPolicyVersion, enumerable: false, configurable: true });
    const site = {
      siteId: 'site-1',
      cloudId: 'cloud-1',
      name: 'ati-workflow-test',
      url: 'https://ati-workflow-test.atlassian.net',
      projects: [project],
    };
    Object.defineProperty(site, 'policyVersion', { value: versions.sitePolicyVersion, enumerable: false, configurable: true });

    const factory = new AdapterFactory({
      credentialRepo: { getCredentials: vi.fn() } as any,
      encryptionKey: key,
      jiraWorkspaceRepo: {
        getCapabilities: vi.fn().mockResolvedValue({
          workspaceId: 'ws-1',
          sites: [site],
        }),
      },
      jiraDispatchGuard: dispatchGuard,
      jiraTokens: {
        forSite: vi.fn().mockReturnValue({ getAccessToken: vi.fn().mockResolvedValue('jira-access-token') }),
      } as any,
      createPersonalJiraAdapter: () => ({
        service: 'myjira',
        execute: vi.fn(async (tool: string) => {
          if (tool === 'myjira.search_projects') {
            return [{ id: '10000', key: 'ATIT', name: 'ATI Test', siteId: 'site-1' }];
          }
          if (tool === 'myjira.search_issues') {
            return {
              issues: [{ id: '10015', key: 'ATIT-6', title: 'Kiểm tra workflow', status: 'To Do' }],
              total: 1,
            };
          }
          throw new Error(`Unexpected tool ${tool}`);
        }),
      }),
    });

    const gatheredSourceRefs: JiraSourceRef[] = [];
    const adapter = await factory.getAdapterForService('myjira', {
      phase: 'planning',
      userId: 'user-1',
      workspaceId: 'ws-1',
      workspaceMode: 'organization',
      gatheredSourceRefs,
    });

    const projects = await adapter.execute('myjira.search_projects', { siteId: 'site-1' });
    expect(projects[0]._sourceRef.workspaceVersion).toBe(2);
    expect(projects[0]._sourceRef.sitePolicyVersion).toBe(3);
    expect(
      decideJiraModelUse(makePolicy(projects[0]._sourceRef, versions), { source: projects[0]._sourceRef })
    ).toEqual({ allowed: true });

    const issuesRes = await adapter.execute('myjira.search_issues', {
      siteId: 'site-1',
      projectKey: 'ATIT',
    });
    expect(issuesRes.issues[0]._sourceRef.workspaceVersion).toBe(2);
    expect(issuesRes.issues[0]._sourceRef.sitePolicyVersion).toBe(3);
    expect(issuesRes.issues[0]._sourceRef.projectPolicyVersion).toBe(4);
    expect(
      decideJiraModelUse(makePolicy(issuesRes.issues[0]._sourceRef, versions), {
        source: issuesRes.issues[0]._sourceRef,
      })
    ).toEqual({ allowed: true });

    expect(gatheredSourceRefs).toHaveLength(2);
    expect(gatheredSourceRefs.every((r) => r.workspaceVersion === 2)).toBe(true);
  });

  it('falls back to capabilities.workspaceVersion when a dispatch guard omits workspaceVersion on _leaseBinding', async () => {
    const site = {
      siteId: 'site-1',
      cloudId: 'cloud-1',
      name: 'ati-workflow-test',
      url: 'https://ati-workflow-test.atlassian.net',
      projects: [{ id: '10000', key: 'ATIT', name: 'ATI Test' }],
    };
    const capabilities: any = { workspaceId: 'ws-1', sites: [site] };
    Object.defineProperty(capabilities, 'workspaceVersion', { value: 5, enumerable: false, configurable: true });

    const executeGuardedDispatch = vi.fn().mockImplementation(async (_scope, _opts, fn) => {
      const out = await fn('tok-1', new AbortController().signal);
      Object.defineProperty(out, '_leaseBinding', {
        value: {
          jiraAccountId: 'acc-1',
          atlassianAccountId: 'atl-1',
          membershipVersion: 1,
          grantId: 'grant-1',
          identityVersion: 1,
        },
        enumerable: false,
      });
      return out;
    });

    const factory = new AdapterFactory({
      credentialRepo: { getCredentials: vi.fn() } as any,
      encryptionKey: key,
      jiraWorkspaceRepo: {
        getCapabilities: vi.fn().mockResolvedValue(capabilities),
      },
      jiraDispatchGuard: { executeGuardedDispatch } as any,
      jiraTokens: {
        forSite: vi.fn().mockReturnValue({ getAccessToken: vi.fn().mockResolvedValue('tok-1') }),
      } as any,
      createPersonalJiraAdapter: () => ({
        service: 'myjira',
        execute: vi.fn().mockResolvedValue([{ id: '10000', key: 'ATIT', name: 'ATI Test' }]),
      }),
    });

    const adapter = await factory.getAdapterForService('myjira', {
      phase: 'planning',
      userId: 'user-1',
      workspaceId: 'ws-1',
      workspaceMode: 'organization',
    });

    const projects = await adapter.execute('myjira.search_projects', { siteId: 'site-1' });
    expect(projects[0]._sourceRef.workspaceVersion).toBe(5);
  });
});
