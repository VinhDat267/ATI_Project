import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  JiraNativeVerifier,
  type JiraNativeVerifierOptions,
  type ExtendedNativeVerifier,
  type NativeUserPermissionsEvidence,
  type NativeUserPermissionsResult,
} from '../../src/services/jira/jira-native-verifier.js';
import type { JiraTokenManager } from '../../src/services/jira/jira-token-manager.js';
import type {
  NativeAdminVerifier,
  NativeAdminVerifierEvidence,
  NativeAdminVerifierResult,
} from '../../src/db/repositories/workspace/workspace-site-project-repo.js';
import {
  createJiraNativeTestFixture,
  type JiraNativeTestFixture,
} from '../helpers/jira-native-test-fixture.js';

describe('JiraNativeVerifier (Task 2 Tests)', () => {
  let fixture: JiraNativeTestFixture;

  beforeAll(async () => {
    fixture = await createJiraNativeTestFixture();
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(() => {
    fixture.reset();
  });

  function createTestTokenManager(options?: {
    token?: string;
    onGetToken?: (userId: string, opts?: { signal?: AbortSignal }) => Promise<string> | string;
  }): JiraTokenManager {
    const defaultToken = options?.token ?? 'test-bearer-token-sentinel';
    return {
      getAccessToken: async (userId: string, opts?: { signal?: AbortSignal }) => {
        if (opts?.signal?.aborted) {
          throw opts.signal.reason ?? new Error('Aborted');
        }
        if (options?.onGetToken) {
          return options.onGetToken(userId, opts);
        }
        return defaultToken;
      },
      clear: () => {},
    } as unknown as JiraTokenManager;
  }

  function createDefaultAdminEvidence(
    overrides?: Partial<NativeAdminVerifierEvidence>
  ): NativeAdminVerifierEvidence {
    return {
      actorId: overrides?.actorId ?? randomUUID(),
      localAccountId: overrides?.localAccountId ?? randomUUID(),
      atlassianAccountId: overrides?.atlassianAccountId ?? `atl-${randomUUID().slice(0, 8)}`,
      grantId: overrides?.grantId ?? randomUUID(),
      identityVersion: overrides?.identityVersion ?? 1,
      workspaceId: overrides?.workspaceId ?? randomUUID(),
      cloudId: overrides?.cloudId ?? 'cloud-site-alpha',
      operation: overrides?.operation ?? 'link_site',
    };
  }

  function createDefaultUserEvidence(
    overrides?: Partial<NativeUserPermissionsEvidence>
  ): NativeUserPermissionsEvidence {
    return {
      actorId: overrides?.actorId ?? randomUUID(),
      workspaceId: overrides?.workspaceId ?? randomUUID(),
      cloudId: overrides?.cloudId ?? 'cloud-site-alpha',
      projectId: overrides?.projectId ?? '10001',
      ...overrides,
    };
  }

  // ==========================================================================
  // 1. verifyAdminister & /project/search metadata
  // ==========================================================================
  describe('verifyAdminister and /project/search metadata', () => {
    it('verifies ADMINISTER permission and fetches project metadata successfully (status: granted)', async () => {
      const cloudId = 'cloud-site-alpha';
      fixture.registerSite({
        cloudId,
        siteName: 'Acme Jira Cloud',
        siteUrl: 'https://acme.atlassian.net',
        administer: true,
        projects: [
          { id: '10001', key: 'PROJ', name: 'Project Alpha', projectTypeKey: 'software' },
          { id: '10002', key: 'BETA', name: 'Project Beta', projectTypeKey: 'business' },
        ],
      });

      const tokenManager = createTestTokenManager({ token: 'bearer-token-valid-admin' });
      const verifier: ExtendedNativeVerifier = new JiraNativeVerifier({
        tokenManager,
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      const evidence = createDefaultAdminEvidence({ cloudId });
      const result = await verifier.verifyAdminister(evidence);

      expect(result.status).toBe('granted');
      if (result.status === 'granted') {
        expect(result.siteName).toBe('Acme Jira Cloud');
        expect(result.siteUrl).toBe('https://acme.atlassian.net');
        expect(result.verifiedProjectIds).toEqual(['10001', '10002']);
        expect(result.verifiedProjects).toEqual([
          { projectId: '10001', key: 'PROJ', name: 'Project Alpha' },
          { projectId: '10002', key: 'BETA', name: 'Project Beta' },
        ]);
      }

      // Verify HTTP requests carried the Bearer token
      const myPermsReq = fixture.requests.find(
        (r) => r.path.includes('/mypermissions') && r.query.permissions?.includes('ADMINISTER')
      );
      expect(myPermsReq).toBeDefined();
      expect(myPermsReq?.headers['authorization']).toBe('Bearer bearer-token-valid-admin');

      const projectSearchReq = fixture.requests.find((r) => r.path.includes('/project/search'));
      expect(projectSearchReq).toBeDefined();
      expect(projectSearchReq?.headers['authorization']).toBe('Bearer bearer-token-valid-admin');
    });

    it('returns status denied without querying /project/search when ADMINISTER is false', async () => {
      const cloudId = 'cloud-site-nonadmin';
      fixture.registerSite({
        cloudId,
        siteName: 'Restricted Jira Site',
        siteUrl: 'https://restricted.atlassian.net',
        administer: false,
        projects: [{ id: '20001', key: 'SECRET', name: 'Secret Project' }],
      });

      const tokenManager = createTestTokenManager();
      const verifier = new JiraNativeVerifier({
        tokenManager,
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      const evidence = createDefaultAdminEvidence({ cloudId });
      const result = await verifier.verifyAdminister(evidence);

      expect(result.status).toBe('denied');
      if (result.status === 'denied') {
        expect(result.reason).toBeDefined();
      }

      // /project/search should NOT be called when ADMINISTER is denied
      const projectSearchReq = fixture.requests.find((r) => r.path.includes('/project/search'));
      expect(projectSearchReq).toBeUndefined();
    });

    it('handles site with empty project list returning empty arrays', async () => {
      const cloudId = 'cloud-site-empty';
      fixture.registerSite({
        cloudId,
        siteName: 'Empty Jira Site',
        siteUrl: 'https://empty.atlassian.net',
        administer: true,
        projects: [],
      });

      const tokenManager = createTestTokenManager();
      const verifier = new JiraNativeVerifier({
        tokenManager,
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      const evidence = createDefaultAdminEvidence({ cloudId });
      const result = await verifier.verifyAdminister(evidence);

      expect(result.status).toBe('granted');
      if (result.status === 'granted') {
        expect(result.verifiedProjectIds).toEqual([]);
        expect(result.verifiedProjects).toEqual([]);
      }
    });
  });

  // ==========================================================================
  // 2. verifyUserPermissions (BROWSE_PROJECTS, CREATE_ISSUES, ADD_COMMENTS)
  // ==========================================================================
  describe('verifyUserPermissions (user rights evaluation)', () => {
    it('returns all true when BROWSE_PROJECTS, CREATE_ISSUES, ADD_COMMENTS are granted', async () => {
      const cloudId = 'cloud-user-test';
      const projectId = '10001';
      fixture.registerSite({
        cloudId,
        siteName: 'User Site',
        siteUrl: 'https://user-site.atlassian.net',
        userPermissions: {
          [projectId]: { canBrowse: true, canCreateIssue: true, canAddComment: true },
        },
      });

      const tokenManager = createTestTokenManager({ token: 'bearer-token-user-full' });
      const verifier: ExtendedNativeVerifier = new JiraNativeVerifier({
        tokenManager,
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      const evidence = createDefaultUserEvidence({ cloudId, projectId });
      const result: NativeUserPermissionsResult = await verifier.verifyUserPermissions(evidence);

      expect(result).toEqual({
        canBrowse: true,
        canCreateIssue: true,
        canAddComment: true,
      });

      // Verify query params sent to /mypermissions
      const userReq = fixture.requests.find(
        (r) =>
          r.path.includes('/mypermissions') &&
          r.query.permissions?.includes('BROWSE_PROJECTS') &&
          r.query.permissions?.includes('CREATE_ISSUES') &&
          r.query.permissions?.includes('ADD_COMMENTS') &&
          r.query.projectId === projectId
      );
      expect(userReq).toBeDefined();
      expect(userReq?.headers['authorization']).toBe('Bearer bearer-token-user-full');
    });

    it('returns accurate partial permissions when certain rights are denied', async () => {
      const cloudId = 'cloud-user-partial';
      const projectId = '10002';
      fixture.registerSite({
        cloudId,
        siteName: 'Partial Site',
        siteUrl: 'https://partial.atlassian.net',
        userPermissions: {
          [projectId]: { canBrowse: true, canCreateIssue: false, canAddComment: true },
        },
      });

      const tokenManager = createTestTokenManager();
      const verifier = new JiraNativeVerifier({
        tokenManager,
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      const evidence = createDefaultUserEvidence({ cloudId, projectId });
      const result = await verifier.verifyUserPermissions(evidence);

      expect(result).toEqual({
        canBrowse: true,
        canCreateIssue: false,
        canAddComment: true,
      });
    });

    it('supports checking user permissions at global level when projectId is omitted', async () => {
      const cloudId = 'cloud-user-global';
      fixture.registerSite({
        cloudId,
        siteName: 'Global Scope Site',
        siteUrl: 'https://global.atlassian.net',
        userPermissions: {
          global: { canBrowse: true, canCreateIssue: true, canAddComment: false },
        },
      });

      const tokenManager = createTestTokenManager();
      const verifier = new JiraNativeVerifier({
        tokenManager,
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      const evidence: NativeUserPermissionsEvidence = {
        actorId: randomUUID(),
        workspaceId: randomUUID(),
        cloudId,
      };

      const result = await verifier.verifyUserPermissions(evidence);
      expect(result).toEqual({
        canBrowse: true,
        canCreateIssue: true,
        canAddComment: false,
      });

      const req = fixture.requests.find((r) => r.path.includes('/mypermissions'));
      expect(req?.query.projectId).toBeUndefined();
    });
  });

  // ==========================================================================
  // 3. Denied / Unavailable Mapping
  // ==========================================================================
  describe('Denied and unavailable mapping', () => {
    it('maps upstream HTTP 403 Forbidden to denied or unavailable status', async () => {
      fixture.setOverride('/rest/api/3/mypermissions', {
        status: 403,
        body: { errorMessages: ['You do not have permission to administer Jira'] },
      });

      const tokenManager = createTestTokenManager();
      const verifier = new JiraNativeVerifier({
        tokenManager,
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      const evidence = createDefaultAdminEvidence();
      const result = await verifier.verifyAdminister(evidence);

      expect(['denied', 'unavailable']).toContain(result.status);
    });

    it('maps upstream HTTP 500 / 503 Internal Server Error to unavailable status', async () => {
      fixture.setOverride('/rest/api/3/mypermissions', {
        status: 503,
        body: { errorMessages: ['Jira service temporarily unavailable'] },
      });

      const tokenManager = createTestTokenManager();
      const verifier = new JiraNativeVerifier({
        tokenManager,
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      const evidence = createDefaultAdminEvidence();
      const result = await verifier.verifyAdminister(evidence);

      expect(result.status).toBe('unavailable');
      if (result.status === 'unavailable') {
        expect(result.reason).toBeDefined();
      }
    });

    it('maps malformed JSON response from upstream to unavailable status (fail-closed)', async () => {
      fixture.setOverride('/rest/api/3/mypermissions', {
        status: 502,
        rawBody: '<html><head><title>502 Bad Gateway</title></head><body>502 Bad Gateway</body></html>',
        headers: { 'Content-Type': 'text/html' },
      });

      const tokenManager = createTestTokenManager();
      const verifier = new JiraNativeVerifier({
        tokenManager,
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      const evidence = createDefaultAdminEvidence();
      const result = await verifier.verifyAdminister(evidence);

      expect(result.status).toBe('unavailable');
    });

    it('maps socket hangup / network drop to unavailable status', async () => {
      fixture.setOverride('/rest/api/3/mypermissions', {
        closeImmediately: true,
      });

      const tokenManager = createTestTokenManager();
      const verifier = new JiraNativeVerifier({
        tokenManager,
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      const evidence = createDefaultAdminEvidence();
      const result = await verifier.verifyAdminister(evidence);

      expect(result.status).toBe('unavailable');
    });

    it('verifyUserPermissions safely handles provider failure (fail-closed)', async () => {
      fixture.setOverride('/rest/api/3/mypermissions', {
        status: 503,
        body: { errorMessages: ['Service unavailable'] },
      });

      const tokenManager = createTestTokenManager();
      const verifier = new JiraNativeVerifier({
        tokenManager,
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      const evidence = createDefaultUserEvidence();
      const result = await verifier.verifyUserPermissions(evidence);
      expect(result).toEqual({ canBrowse: false, canCreateIssue: false, canAddComment: false, status: 'unavailable' });
    });
  });

  // ==========================================================================
  // 4. AbortSignal Cancellation
  // ==========================================================================
  describe('AbortSignal cancellation', () => {
    it('immediately rejects when AbortSignal is pre-aborted', async () => {
      const controller = new AbortController();
      controller.abort(new Error('Pre-aborted test signal'));

      const tokenManager = createTestTokenManager();
      const verifier = new JiraNativeVerifier({
        tokenManager,
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      const evidence = createDefaultAdminEvidence();
      await expect(
        verifier.verifyAdminister(evidence, { signal: controller.signal })
      ).rejects.toThrow();

      // No network request should have been dispatched to fixture
      expect(fixture.requests.length).toBe(0);
    });

    it('cancels in-flight HTTP request when AbortSignal triggers during execution', async () => {
      const barrier = fixture.pauseNext('/rest/api/3/mypermissions');

      const controller = new AbortController();
      const tokenManager = createTestTokenManager();
      const verifier = new JiraNativeVerifier({
        tokenManager,
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      const evidence = createDefaultAdminEvidence();
      const promise = verifier.verifyAdminister(evidence, { signal: controller.signal });

      // Wait until the fixture receives the request
      await barrier.reached;

      // Abort the caller signal while request is in flight
      controller.abort(new Error('Caller timed out during in-flight call'));
      barrier.release();

      await expect(promise).rejects.toThrow();
    });
  });

  // ==========================================================================
  // 5. Network Defense: No Redirects & 64 KB Body Cap
  // ==========================================================================
  describe('Network defense (no redirects and 64KB cap)', () => {
    it('strictly rejects HTTP redirects (301, 302, 307) without following to prevent credential leak', async () => {
      fixture.setOverride('/rest/api/3/mypermissions', {
        status: 302,
        headers: {
          Location: `${fixture.baseUrl}/untrusted-redirect-sink`,
        },
      });

      const tokenManager = createTestTokenManager();
      const verifier = new JiraNativeVerifier({
        tokenManager,
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      const evidence = createDefaultAdminEvidence();
      try {
        const result = await verifier.verifyAdminister(evidence);
        expect(result.status).toBe('unavailable');
      } catch (err: any) {
        expect(err).toBeDefined();
      }

      // Assert that the redirected endpoint was NEVER called
      const leakedReq = fixture.requests.find((r) => r.path.includes('/untrusted-redirect-sink'));
      expect(leakedReq).toBeUndefined();
    });

    it('rejects upstream response body exceeding 64 KB limit', async () => {
      // Create a response body exceeding 65536 bytes
      const largePayload = JSON.stringify({
        permissions: { ADMINISTER: { havePermission: true } },
        padding: 'X'.repeat(70000),
      });

      fixture.setOverride('/rest/api/3/mypermissions', {
        status: 200,
        rawBody: largePayload,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(largePayload, 'utf8')),
        },
      });

      const tokenManager = createTestTokenManager();
      const verifier = new JiraNativeVerifier({
        tokenManager,
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      const evidence = createDefaultAdminEvidence();
      try {
        const result = await verifier.verifyAdminister(evidence);
        expect(result.status).toBe('unavailable');
      } catch (err: any) {
        expect(err.message).toMatch(/64\s*KB|limit|exceed/i);
      }
    });
  });

  // ==========================================================================
  // 6. Security: Bearer Token Protection (No Leakage)
  // ==========================================================================
  describe('Security: Bearer token protection', () => {
    it('never leaks Bearer token in error messages or status reasons on upstream failure', async () => {
      const secretToken = 'SECRET_OAUTH_BEARER_TOKEN_99999_SENTINEL';
      const tokenManager = createTestTokenManager({ token: secretToken });

      fixture.setOverride('/rest/api/3/mypermissions', {
        status: 500,
        rawBody: JSON.stringify({
          error: `Internal error processing token ${secretToken}`,
        }),
      });

      const verifier = new JiraNativeVerifier({
        tokenManager,
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      const evidence = createDefaultAdminEvidence();
      try {
        const result = await verifier.verifyAdminister(evidence);
        if (result.status === 'unavailable' || result.status === 'denied') {
          expect(result.reason ?? '').not.toContain(secretToken);
        }
      } catch (err: any) {
        expect(err.message).not.toContain(secretToken);
        expect(JSON.stringify(err)).not.toContain(secretToken);
      }
    });
  });

  // ==========================================================================
  // 7. Cache Key Composite Partitioning and Isolation
  // Key: ${userId}:${accountId}:${identityVersion}:${workspaceId}:${cloudId}:${projectId ?? 'global'}
  // ==========================================================================
  describe('Cache composite partitioning and isolation', () => {
    it('hits cache on repeated identical queries without issuing new HTTP requests', async () => {
      const cloudId = 'cloud-cache-test';
      fixture.registerSite({
        cloudId,
        siteName: 'Cache Site',
        siteUrl: 'https://cache.atlassian.net',
        administer: true,
        projects: [{ id: '10001', key: 'C1', name: 'Proj 1' }],
      });

      const tokenManager = createTestTokenManager();
      const verifier = new JiraNativeVerifier({
        tokenManager,
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      const evidence = createDefaultAdminEvidence({ cloudId });

      // First call: cache miss -> issues HTTP requests
      const result1 = await verifier.verifyAdminister(evidence);
      expect(result1.status).toBe('granted');
      const reqCountAfterFirst = fixture.requests.length;
      expect(reqCountAfterFirst).toBeGreaterThan(0);

      // Second call: cache hit -> NO new HTTP requests issued
      const result2 = await verifier.verifyAdminister(evidence);
      expect(result2.status).toBe('granted');
      expect(fixture.requests.length).toBe(reqCountAfterFirst);
    });

    it('invalidates cache when identityVersion increments (reconnect / identity change)', async () => {
      const cloudId = 'cloud-identity-version';
      fixture.registerSite({
        cloudId,
        siteName: 'Identity Site',
        siteUrl: 'https://id.atlassian.net',
        administer: true,
        projects: [{ id: '10001', key: 'ID1', name: 'Id Proj' }],
      });

      const tokenManager = createTestTokenManager();
      const verifier = new JiraNativeVerifier({
        tokenManager,
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      const evidenceV1 = createDefaultAdminEvidence({ cloudId, identityVersion: 1 });
      await verifier.verifyAdminister(evidenceV1);
      const countAfterV1 = fixture.requests.length;

      // Increment identityVersion (e.g. user reconnected or account rotated)
      const evidenceV2 = createDefaultAdminEvidence({
        ...evidenceV1,
        identityVersion: 2,
      });
      await verifier.verifyAdminister(evidenceV2);

      // Fresh HTTP requests should be dispatched due to identityVersion partition
      expect(fixture.requests.length).toBeGreaterThan(countAfterV1);
    });

    it('isolates cache by workspaceId', async () => {
      const cloudId = 'cloud-ws-isolation';
      fixture.registerSite({
        cloudId,
        siteName: 'Shared Site Across Workspaces',
        siteUrl: 'https://shared.atlassian.net',
        administer: true,
        projects: [{ id: '10001', key: 'SH1', name: 'Shared Proj' }],
      });

      const tokenManager = createTestTokenManager();
      const verifier = new JiraNativeVerifier({
        tokenManager,
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      const baseEvidence = createDefaultAdminEvidence({ cloudId });
      const ws1Evidence = { ...baseEvidence, workspaceId: 'ws-uuid-alpha' };
      const ws2Evidence = { ...baseEvidence, workspaceId: 'ws-uuid-beta' };

      await verifier.verifyAdminister(ws1Evidence);
      const countAfterWs1 = fixture.requests.length;

      await verifier.verifyAdminister(ws2Evidence);
      expect(fixture.requests.length).toBeGreaterThan(countAfterWs1);
    });

    it('isolates cache by cloudId', async () => {
      fixture.registerSite({
        cloudId: 'cloud-site-1',
        siteName: 'Site 1',
        siteUrl: 'https://site1.atlassian.net',
        administer: true,
        projects: [{ id: '10001', key: 'S1', name: 'Site 1 Proj' }],
      });
      fixture.registerSite({
        cloudId: 'cloud-site-2',
        siteName: 'Site 2',
        siteUrl: 'https://site2.atlassian.net',
        administer: true,
        projects: [{ id: '20001', key: 'S2', name: 'Site 2 Proj' }],
      });

      const tokenManager = createTestTokenManager();
      const verifier = new JiraNativeVerifier({
        tokenManager,
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      const baseEvidence = createDefaultAdminEvidence();
      await verifier.verifyAdminister({ ...baseEvidence, cloudId: 'cloud-site-1' });
      const countAfterSite1 = fixture.requests.length;

      await verifier.verifyAdminister({ ...baseEvidence, cloudId: 'cloud-site-2' });
      expect(fixture.requests.length).toBeGreaterThan(countAfterSite1);
    });

    it('isolates cache by projectId for user permissions', async () => {
      const cloudId = 'cloud-project-isolation';
      fixture.registerSite({
        cloudId,
        siteName: 'Proj Isolation Site',
        siteUrl: 'https://proj.atlassian.net',
        userPermissions: {
          '10001': { canBrowse: true, canCreateIssue: true, canAddComment: true },
          '10002': { canBrowse: true, canCreateIssue: false, canAddComment: true },
          global: { canBrowse: true, canCreateIssue: true, canAddComment: false },
        },
      });

      const tokenManager = createTestTokenManager();
      const verifier = new JiraNativeVerifier({
        tokenManager,
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      const baseUserEvidence = createDefaultUserEvidence({ cloudId });

      // Call for project 10001
      const res1 = await verifier.verifyUserPermissions({ ...baseUserEvidence, projectId: '10001' });
      expect(res1.canCreateIssue).toBe(true);
      const countAfter10001 = fixture.requests.length;

      // Repeated call for 10001 -> cache hit
      await verifier.verifyUserPermissions({ ...baseUserEvidence, projectId: '10001' });
      expect(fixture.requests.length).toBe(countAfter10001);

      // Call for project 10002 -> cache miss
      const res2 = await verifier.verifyUserPermissions({ ...baseUserEvidence, projectId: '10002' });
      expect(res2.canCreateIssue).toBe(false);
      expect(fixture.requests.length).toBeGreaterThan(countAfter10001);
      const countAfter10002 = fixture.requests.length;

      // Call without projectId (global) -> cache miss
      const resGlobal = await verifier.verifyUserPermissions({ ...baseUserEvidence, projectId: undefined });
      expect(resGlobal.canAddComment).toBe(false);
      expect(fixture.requests.length).toBeGreaterThan(countAfter10002);
    });

    it('isolates cache by actorId / localAccountId (multi-tenant tenant boundary)', async () => {
      const cloudId = 'cloud-tenant-isolation';
      fixture.registerSite({
        cloudId,
        siteName: 'Tenant Site',
        siteUrl: 'https://tenant.atlassian.net',
        administer: true,
        projects: [{ id: '10001', key: 'T1', name: 'Tenant Proj' }],
      });

      const tokenManager = createTestTokenManager();
      const verifier = new JiraNativeVerifier({
        tokenManager,
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      const baseEvidence = createDefaultAdminEvidence({ cloudId });
      const user1Evidence = { ...baseEvidence, actorId: 'user-111', localAccountId: 'acc-111' };
      const user2Evidence = { ...baseEvidence, actorId: 'user-222', localAccountId: 'acc-222' };

      await verifier.verifyAdminister(user1Evidence);
      const countAfterUser1 = fixture.requests.length;

      await verifier.verifyAdminister(user2Evidence);
      expect(fixture.requests.length).toBeGreaterThan(countAfterUser1);
    });

    it('clears cached entries when clearCache() is called', async () => {
      const cloudId = 'cloud-clear-cache';
      fixture.registerSite({
        cloudId,
        siteName: 'Clear Cache Site',
        siteUrl: 'https://clearcache.atlassian.net',
        administer: true,
        projects: [{ id: '10001', key: 'CC1', name: 'Clear Proj' }],
      });

      const tokenManager = createTestTokenManager();
      const verifier = new JiraNativeVerifier({
        tokenManager,
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      const evidence = createDefaultAdminEvidence({ cloudId });

      await verifier.verifyAdminister(evidence);
      const countAfterFirst = fixture.requests.length;

      // Invalidate cache explicitly
      verifier.clearCache();

      // Next call must issue fresh HTTP requests
      await verifier.verifyAdminister(evidence);
      expect(fixture.requests.length).toBeGreaterThan(countAfterFirst);
    });
  });
  it('rejects fixture mode without an explicit loopback base URL before any provider call', () => {
    const tokenManager = createTestTokenManager();
    expect(() => new JiraNativeVerifier({ tokenManager, mode: 'fixture' })).toThrow();
    expect(() => new JiraNativeVerifier({ tokenManager, mode: 'fixture', fixtureBaseUrl: 'https://evil.example' })).toThrow();
  });

  it('honors an already aborted caller even when the native permission result is cached', async () => {
    fixture.registerSite({ cloudId: 'cloud-abort-cache', siteName: 'Abort Cache', siteUrl: 'https://abort.atlassian.net', administer: true, projects: [] });
    const verifier = new JiraNativeVerifier({ tokenManager: createTestTokenManager(), mode: 'fixture', fixtureBaseUrl: fixture.baseUrl });
    const evidence = createDefaultAdminEvidence({ cloudId: 'cloud-abort-cache' });
    expect((await verifier.verifyAdminister(evidence)).status).toBe('granted');
    const controller = new AbortController();
    controller.abort(new Error('caller cancelled'));
    await expect(verifier.verifyAdminister(evidence, { signal: controller.signal })).rejects.toThrow();
  });
});
