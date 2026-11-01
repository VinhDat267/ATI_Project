import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import WorkspaceRepo from '../../src/db/repositories/workspace/index.js';
import { WorkspaceRepoError } from '../../src/db/repositories/workspace/errors.js';
import type {
  LinkWorkspaceSiteRequest,
  LinkWorkspaceSiteResponse,
  UpdateWorkspaceSiteRequest,
  UpdateWorkspaceSiteResponse,
  ConfigureWorkspaceProjectsRequest,
  ConfigureWorkspaceProjectsResponse,
  WorkspaceSiteItem,
  GetWorkspaceProjectsResponse,
  WorkspaceJiraCapabilitiesResponse,
} from '@wap/tool-schemas';
import {
  createIsolatedTestSchema,
  createSyntheticUser,
  waitForBlockedQueries,
  type IsolatedTestContext,
} from '../helpers/jira-test-db.js';

// ============================================================================
// Local Test Fixture Interfaces for Native Admin Verifier (Coordinator Ruling 3 & 4)
// ============================================================================

export interface NativeAdminVerifierEvidence {
  actorId: string;
  localAccountId: string;
  atlassianAccountId: string;
  grantId: string;
  identityVersion: number;
  workspaceId: string;
  cloudId: string;
  operation: 'link_site' | 'activate_site' | 'configure_projects';
}

export type NativeAdminVerifierResult =
  | {
      status: 'granted';
      siteName: string;
      siteUrl: string;
      verifiedProjectIds: string[];
      verifiedProjects: Array<{ projectId: string; key: string; name: string }>;
    }
  | { status: 'denied'; reason?: string }
  | { status: 'unavailable'; reason?: string };

export interface NativeAdminVerifier {
  verifyAdminister(evidence: NativeAdminVerifierEvidence): Promise<NativeAdminVerifierResult>;
}

class FakeNativeAdminVerifier implements NativeAdminVerifier {
  public recordedEvidences: NativeAdminVerifierEvidence[] = [];
  public handler?: (
    evidence: NativeAdminVerifierEvidence
  ) => Promise<NativeAdminVerifierResult> | NativeAdminVerifierResult;

  constructor(
    public defaultResult: NativeAdminVerifierResult = {
      status: 'granted',
      siteName: 'Verified Authoritative Site',
      siteUrl: 'https://verified.atlassian.net',
      verifiedProjectIds: ['10001', '10002'],
      verifiedProjects: [
        { projectId: '10001', key: 'ALPHA', name: 'Alpha Project' },
        { projectId: '10002', key: 'BETA', name: 'Beta Project' },
      ],
    }
  ) {}

  async verifyAdminister(
    evidence: NativeAdminVerifierEvidence
  ): Promise<NativeAdminVerifierResult> {
    this.recordedEvidences.push({ ...evidence });
    if (this.handler) {
      return this.handler(evidence);
    }
    return this.defaultResult;
  }
}

// ============================================================================
// Async Gated Barrier Helper with Deadlines
// ============================================================================

function createDeferredGate(timeoutMs = 5000, name = 'gate') {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  let settled = false;

  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const timer = setTimeout(() => {
    if (!settled) {
      settled = true;
      reject(new Error(`Timeout after ${timeoutMs}ms waiting on ${name}`));
    }
  }, timeoutMs);

  const safeResolve = () => {
    if (!settled) {
      settled = true;
      clearTimeout(timer);
      resolve();
    }
  };

  const safeReject = (err: Error) => {
    if (!settled) {
      settled = true;
      clearTimeout(timer);
      reject(err);
    }
  };

  return { promise, resolve: safeResolve, reject: safeReject };
}

// ============================================================================
// Test-Only Real PG Query Proxy Helper (Coordinator Ruling on TOCTOU Verification)
// ============================================================================

function createHookedPool(
  targetPool: pg.Pool,
  beforeQueryHook: (sql: string, params?: any[]) => Promise<void> | void
): pg.Pool {
  return new Proxy(targetPool, {
    get(target, prop, receiver) {
      if (prop === 'query') {
        return async (...args: any[]) => {
          const sql = typeof args[0] === 'string' ? args[0] : (args[0] as any)?.text ?? '';
          const params = Array.isArray(args[1]) ? args[1] : undefined;
          await beforeQueryHook(sql, params);
          return (target as any).query(...args);
        };
      }
      const val = Reflect.get(target, prop, receiver);
      if (typeof val === 'function') {
        return val.bind(target);
      }
      return val;
    },
  });
}

// ============================================================================
// Local Database Seed Helpers (Self-Contained & Isolated per Test)
// ============================================================================

async function seedWorkspace(
  pool: pg.Pool,
  creatorUserId: string,
  slugPrefix = 'ws-sp'
): Promise<{ workspaceId: string; slug: string; name: string }> {
  const slug = `${slugPrefix}-${randomUUID().slice(0, 8)}`;
  const name = `Workspace ${slug}`;
  const wsRes = await pool.query(
    `INSERT INTO ati_workspaces (slug, name, created_by, status, version)
     VALUES ($1, $2, $3, 'active', 1)
     RETURNING id`,
    [slug, name, creatorUserId]
  );
  const workspaceId = wsRes.rows[0].id;

  await pool.query(
    `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version)
     VALUES ($1, $2, 'admin', 'active', 1)`,
    [workspaceId, creatorUserId]
  );

  return { workspaceId, slug, name };
}

async function seedMembership(
  pool: pg.Pool,
  workspaceId: string,
  userId: string,
  role: 'admin' | 'member',
  status: 'pending' | 'active' | 'rejected' | 'removed'
): Promise<void> {
  await pool.query(
    `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version)
     VALUES ($1, $2, $3, $4, 1)
     ON CONFLICT (workspace_id, user_id)
     DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status, updated_at = clock_timestamp()`,
    [workspaceId, userId, role, status]
  );
}

/**
 * Seeds a Jira account and OAuth grant site.
 * Invariant: Reuses existing account for the same owner if one already exists,
 * adding grant/site rows without violating partial unique index jira_accounts_user_active_idx.
 * Respects status/identity-version-specific fixtures without accidentally reconnecting a disconnected account.
 */
async function seedJiraGrantAndSite(
  pool: pg.Pool,
  userId: string,
  cloudId: string,
  siteName = 'Seed Site',
  siteUrl = 'https://seed.atlassian.net',
  options?: {
    accountStatus?: 'connected' | 'disconnected';
    productType?: string;
    identityVersion?: number;
  }
): Promise<{ accountId: string; atlassianAccountId: string; grantId: string }> {
  const existingAcc = await pool.query(
    `SELECT id, atlassian_account_id, status, identity_version
     FROM jira_accounts
     WHERE user_id = $1`,
    [userId]
  );

  let accountId: string;
  let atlassianAccountId: string;

  if (existingAcc.rowCount! > 0) {
    accountId = existingAcc.rows[0].id;
    atlassianAccountId = existingAcc.rows[0].atlassian_account_id;

    // Respect status/identity-version-specific fixtures; don't accidentally reconnect a disconnected account
    if (options?.accountStatus || options?.identityVersion !== undefined) {
      const newStatus = options?.accountStatus ?? existingAcc.rows[0].status;
      const newVersion = options?.identityVersion ?? existingAcc.rows[0].identity_version;
      await pool.query(
        `UPDATE jira_accounts
         SET status = $1, identity_version = $2, updated_at = clock_timestamp()
         WHERE id = $3`,
        [newStatus, newVersion, accountId]
      );
    }
  } else {
    atlassianAccountId = `atlas-${randomUUID().slice(0, 8)}`;
    const accRes = await pool.query(
      `INSERT INTO jira_accounts (user_id, atlassian_account_id, status, identity_version)
       VALUES ($1, $2, $3, $4)
       RETURNING id, atlassian_account_id`,
      [
        userId,
        atlassianAccountId,
        options?.accountStatus ?? 'connected',
        options?.identityVersion ?? 1,
      ]
    );
    accountId = accRes.rows[0].id;
  }

  // Reuse existing OAuth grant for this account if present, or insert a new one
  const existingGrant = await pool.query(
    `SELECT id FROM jira_oauth_grants WHERE account_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [accountId]
  );

  let grantId: string;
  if (existingGrant.rowCount! > 0) {
    grantId = existingGrant.rows[0].id;
  } else {
    const grantRes = await pool.query(
      `INSERT INTO jira_oauth_grants (account_id, scopes, token_version, encrypted_access_token, encrypted_refresh_token)
       VALUES ($1, ARRAY['read:jira-work', 'write:jira-work'], 1, 'enc-access-token-secret-xyz', 'enc-refresh-token-secret-xyz')
       RETURNING id`,
      [accountId]
    );
    grantId = grantRes.rows[0].id;
  }

  await pool.query(
    `INSERT INTO jira_grant_sites (grant_id, cloud_id, site_url, site_name, product_type)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (grant_id, cloud_id)
     DO UPDATE SET site_url = EXCLUDED.site_url, site_name = EXCLUDED.site_name, product_type = EXCLUDED.product_type, last_verified_at = clock_timestamp()`,
    [grantId, cloudId, siteUrl, siteName, options?.productType ?? 'jira']
  );

  return { accountId, atlassianAccountId, grantId };
}

async function seedWorkspaceSite(
  pool: pg.Pool,
  workspaceId: string,
  cloudId: string,
  linkedBy: string,
  options?: {
    siteName?: string;
    siteUrl?: string;
    active?: boolean;
    policyVersion?: number;
  }
): Promise<{
  id: string;
  workspace_id: string;
  cloud_id: string;
  site_name: string;
  site_url: string;
  active: boolean;
  policy_version: number;
}> {
  const res = await pool.query(
    `INSERT INTO ati_workspace_jira_sites
       (workspace_id, cloud_id, site_name, site_url, active, policy_version, linked_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, workspace_id, cloud_id, site_name, site_url, active, policy_version`,
    [
      workspaceId,
      cloudId,
      options?.siteName ?? 'Existing Site',
      options?.siteUrl ?? 'https://existing.atlassian.net',
      options?.active ?? false,
      options?.policyVersion ?? 1,
      linkedBy,
    ]
  );
  return res.rows[0];
}

async function seedWorkspaceProject(
  pool: pg.Pool,
  workspaceId: string,
  siteId: string,
  cloudId: string,
  numericProjectId: string,
  key: string,
  name: string,
  options?: { selected?: boolean; policyVersion?: number }
): Promise<{ id: string; policy_version: number }> {
  const res = await pool.query(
    `INSERT INTO ati_workspace_jira_projects
       (workspace_id, site_id, cloud_id, numeric_project_id, project_key, project_name, selected, policy_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, policy_version`,
    [
      workspaceId,
      siteId,
      cloudId,
      numericProjectId,
      key,
      name,
      options?.selected ?? false,
      options?.policyVersion ?? 1,
    ]
  );
  return res.rows[0];
}

// ============================================================================
// Test Suite: Workspace Site & Project Repository (JIRA-03 Task 3)
// ============================================================================

describe('apps/chat-api — JIRA-03 Workspace Site & Project Repository & Fail-Closed Policy', () => {
  let ctx: IsolatedTestContext;
  let pool: pg.Pool;
  let sysAdminId: string;
  let sysMemberId: string;

  beforeAll(async () => {
    ctx = await createIsolatedTestSchema({ maxConnections: 10 });
    pool = ctx.pool;
    await ctx.runAllMigrations();
  });

  beforeEach(async () => {
    // Fresh synthetic users for each case to maintain strictly independent fixtures
    // and avoid schema unique index collisions (e.g. jira_accounts_user_active_idx)
    sysAdminId = await createSyntheticUser(pool, 'System Admin', 'sysadmin', {
      role: 'admin',
      status: 'active',
    });
    sysMemberId = await createSyntheticUser(pool, 'System Member', 'sysmember', {
      role: 'member',
      status: 'active',
    });
  });

  afterAll(async () => {
    await ctx?.cleanup();
  });

  // ==========================================================================
  // Suite 1: Absent Verifier Fail-Closed & Safe Deactivation
  // ==========================================================================
  describe('1. Absent Verifier Fail-Closed & Safe Deactivation (Coordinator Ruling 1)', () => {
    it('rejects linkSite and inserts no site row or audit row when verifier is absent', async () => {
      const { workspaceId } = await seedWorkspace(pool, sysAdminId);
      const cloudId = `cloud-${randomUUID().slice(0, 8)}`;
      await seedJiraGrantAndSite(pool, sysAdminId, cloudId);

      const repo = new WorkspaceRepo(pool);

      try {
        await repo.linkSite(workspaceId, sysAdminId, { cloudId });
        expect.unreachable('linkSite without verifier must reject');
      } catch (err: any) {
        expect([503, 403]).toContain(err.statusCode);
        expect(['NATIVE_VERIFIER_UNAVAILABLE', 'UNVERIFIED_SITE_CANNOT_ACTIVATE']).toContain(
          err.code
        );
      }

      // Assert no row was inserted into ati_workspace_jira_sites
      const siteRows = await pool.query(
        `SELECT * FROM ati_workspace_jira_sites WHERE workspace_id = $1 AND cloud_id = $2`,
        [workspaceId, cloudId]
      );
      expect(siteRows.rowCount).toBe(0);

      // Assert no audit entry was recorded
      const auditRows = await pool.query(
        `SELECT * FROM jira_authorization_audit WHERE workspace_id = $1`,
        [workspaceId]
      );
      expect(auditRows.rowCount).toBe(0);
    });

    it('rejects updateSite(active: true) and leaves existing disabled site row unchanged when verifier is absent', async () => {
      const { workspaceId } = await seedWorkspace(pool, sysAdminId);
      const cloudId = `cloud-${randomUUID().slice(0, 8)}`;
      await seedJiraGrantAndSite(pool, sysAdminId, cloudId);
      const existingSite = await seedWorkspaceSite(pool, workspaceId, cloudId, sysAdminId, {
        active: false,
        policyVersion: 1,
      });

      const repo = new WorkspaceRepo(pool);

      try {
        await repo.updateSite(workspaceId, sysAdminId, existingSite.id, {
          expectedPolicyVersion: 1,
          active: true,
        });
        expect.unreachable('updateSite(active: true) without verifier must reject');
      } catch (err: any) {
        expect([503, 403]).toContain(err.statusCode);
        expect(['NATIVE_VERIFIER_UNAVAILABLE', 'UNVERIFIED_SITE_CANNOT_ACTIVATE']).toContain(
          err.code
        );
      }

      // Assert site row in DB is still inactive and policy_version is unchanged
      const siteRows = await pool.query(
        `SELECT active, policy_version FROM ati_workspace_jira_sites WHERE id = $1`,
        [existingSite.id]
      );
      expect(siteRows.rows[0]).toEqual({
        active: false,
        policy_version: 1,
      });
    });

    it('rejects configureProjects and leaves projects unchanged when verifier is absent', async () => {
      const { workspaceId } = await seedWorkspace(pool, sysAdminId);
      const cloudId = `cloud-${randomUUID().slice(0, 8)}`;
      await seedJiraGrantAndSite(pool, sysAdminId, cloudId);
      const existingSite = await seedWorkspaceSite(pool, workspaceId, cloudId, sysAdminId, {
        active: false,
        policyVersion: 1,
      });
      await seedWorkspaceProject(
        pool,
        workspaceId,
        existingSite.id,
        cloudId,
        '10001',
        'INIT',
        'Initial Project',
        { selected: false, policyVersion: 1 }
      );

      const repo = new WorkspaceRepo(pool);

      try {
        await repo.configureProjects(workspaceId, sysAdminId, existingSite.id, {
          expectedPolicyVersion: 1,
          selectedProjectIds: ['10001'],
        });
        expect.unreachable('configureProjects without verifier must reject');
      } catch (err: any) {
        expect([503, 403]).toContain(err.statusCode);
        expect(['NATIVE_VERIFIER_UNAVAILABLE', 'UNVERIFIED_SITE_CANNOT_ACTIVATE']).toContain(
          err.code
        );
      }

      // Assert project row remains unselected
      const projRows = await pool.query(
        `SELECT selected, policy_version FROM ati_workspace_jira_projects
         WHERE workspace_id = $1 AND numeric_project_id = '10001'`,
        [workspaceId]
      );
      expect(projRows.rows[0]).toEqual({
        selected: false,
        policy_version: 1,
      });
    });

    it('succeeds on deactivation (active: false) and increments site policy_version even without a verifier', async () => {
      const { workspaceId } = await seedWorkspace(pool, sysAdminId);
      const cloudId = `cloud-${randomUUID().slice(0, 8)}`;
      await seedJiraGrantAndSite(pool, sysAdminId, cloudId);
      const existingSite = await seedWorkspaceSite(pool, workspaceId, cloudId, sysAdminId, {
        active: true,
        policyVersion: 1,
      });

      const repo = new WorkspaceRepo(pool); // No verifier configured

      const res = await repo.updateSite(workspaceId, sysAdminId, existingSite.id, {
        expectedPolicyVersion: 1,
        active: false,
      });

      expect(res.site).toBeDefined();
      expect(res.site.siteId).toBe(existingSite.id);
      expect(res.site.cloudId).toBe(cloudId);
      expect(res.site.active).toBe(false);
      expect(res.site.policyVersion).toBe(2);

      // Verify DB row was updated
      const siteRows = await pool.query(
        `SELECT active, policy_version FROM ati_workspace_jira_sites WHERE id = $1`,
        [existingSite.id]
      );
      expect(siteRows.rows[0]).toEqual({
        active: false,
        policy_version: 2,
      });

      // Verify deactivation audit log was recorded
      const auditRows = await pool.query(
        `SELECT action, decision, version FROM jira_authorization_audit
         WHERE workspace_id = $1 AND site_id = $2`,
        [workspaceId, existingSite.id]
      );
      expect(auditRows.rowCount).toBeGreaterThanOrEqual(1);
      expect(auditRows.rows[0].version).toBe(2);
    });
  });

  // ==========================================================================
  // Suite 2: Valid Injected Verifier, DTO Projections & Zero Secret Leakage
  // ==========================================================================
  describe('2. Valid Injected Verifier, DTO Projections & Zero Secret Leakage', () => {
    it('returns canonical shared DTO with site inactive and policyVersion 1 on verified linkSite', async () => {
      const { workspaceId } = await seedWorkspace(pool, sysAdminId);
      const cloudId = `cloud-${randomUUID().slice(0, 8)}`;
      await seedJiraGrantAndSite(
        pool,
        sysAdminId,
        cloudId,
        'Trusted Provider Name',
        'https://trusted-provider.atlassian.net'
      );

      const verifier = new FakeNativeAdminVerifier({
        status: 'granted',
        siteName: 'Trusted Provider Name',
        siteUrl: 'https://trusted-provider.atlassian.net',
        verifiedProjectIds: ['10001', '10002'],
        verifiedProjects: [
          { projectId: '10001', key: 'TRUST1', name: 'Trusted 1' },
          { projectId: '10002', key: 'TRUST2', name: 'Trusted 2' },
        ],
      });

      const repo = new WorkspaceRepo(pool, { verifier });

      const res = await repo.linkSite(workspaceId, sysAdminId, { cloudId });

      // Verifies canonical shared DTO shape from @wap/tool-schemas
      expect(res.site).toBeDefined();
      expect(res.site.siteId).toBeDefined();
      expect(res.site.cloudId).toBe(cloudId);
      expect(res.site.name).toBe('Trusted Provider Name');
      expect(res.site.url).toBe('https://trusted-provider.atlassian.net');
      expect(res.site.active).toBe(false); // Inactive by default per specification
      expect(res.site.policyVersion).toBe(1);

      // Verifies projection has no internal or leaky DB keys
      expect(Object.keys(res.site).sort()).toEqual([
        'active',
        'cloudId',
        'name',
        'policyVersion',
        'siteId',
        'url',
      ]);
    });

    it('overrides client-supplied metadata with trusted provider metadata and passes exact evidence to verifier', async () => {
      const { workspaceId } = await seedWorkspace(pool, sysAdminId);
      const cloudId = `cloud-${randomUUID().slice(0, 8)}`;
      const { accountId, atlassianAccountId, grantId } = await seedJiraGrantAndSite(
        pool,
        sysAdminId,
        cloudId,
        'Authoritative Server Name',
        'https://authoritative.atlassian.net'
      );

      const verifier = new FakeNativeAdminVerifier({
        status: 'granted',
        siteName: 'Authoritative Server Name',
        siteUrl: 'https://authoritative.atlassian.net',
        verifiedProjectIds: ['10001'],
        verifiedProjects: [{ projectId: '10001', key: 'AUTH', name: 'Authoritative Proj' }],
      });

      const repo = new WorkspaceRepo(pool, { verifier });

      // Client attempts to inject malicious metadata in request body
      const maliciousBody = {
        cloudId,
        siteName: 'HACKED SITE NAME',
        siteUrl: 'https://evil-phishing.test',
        active: true,
      };

      const res = await repo.linkSite(workspaceId, sysAdminId, maliciousBody as any);

      // Assert server metadata overrode malicious body fields
      expect(res.site.name).toBe('Authoritative Server Name');
      expect(res.site.url).toBe('https://authoritative.atlassian.net');
      expect(res.site.active).toBe(false);

      // Assert exact recorded evidence passed to verifier
      expect(verifier.recordedEvidences.length).toBe(1);
      const evidence = verifier.recordedEvidences[0];
      if (!evidence) {
        throw new Error('Expected verifier evidence to be recorded');
      }
      expect(evidence).toEqual({
        actorId: sysAdminId,
        localAccountId: accountId,
        atlassianAccountId: atlassianAccountId,
        grantId: grantId,
        identityVersion: 1,
        workspaceId: workspaceId,
        cloudId: cloudId,
        operation: 'link_site',
      });
    });

    it('never leaks secret tokens to verifier evidence, return DTO, or audit table details', async () => {
      const { workspaceId } = await seedWorkspace(pool, sysAdminId);
      const cloudId = `cloud-${randomUUID().slice(0, 8)}`;
      await seedJiraGrantAndSite(pool, sysAdminId, cloudId);

      const verifier = new FakeNativeAdminVerifier();
      const repo = new WorkspaceRepo(pool, { verifier });

      const res = await repo.linkSite(workspaceId, sysAdminId, { cloudId });

      // 1. Evidence check
      const evidenceStr = JSON.stringify(verifier.recordedEvidences);
      expect(evidenceStr).not.toContain('enc-access-token');
      expect(evidenceStr).not.toContain('enc-refresh-token');
      expect(evidenceStr).not.toContain('secret');

      // 2. DTO check
      const dtoStr = JSON.stringify(res);
      expect(dtoStr).not.toContain('enc-access-token');
      expect(dtoStr).not.toContain('enc-refresh-token');

      // 3. Database Audit details check
      const auditRes = await pool.query(
        `SELECT details FROM jira_authorization_audit WHERE workspace_id = $1`,
        [workspaceId]
      );
      expect(auditRes.rowCount).toBeGreaterThanOrEqual(1);
      const auditDetailsStr = JSON.stringify(auditRes.rows[0].details);
      expect(auditDetailsStr).not.toContain('enc-access-token');
      expect(auditDetailsStr).not.toContain('enc-refresh-token');
      expect(auditDetailsStr).not.toContain('secret');
    });

    it('activates site, increments policy_version, and records audit when updateSite(active: true) has valid verifier', async () => {
      const { workspaceId } = await seedWorkspace(pool, sysAdminId);
      const cloudId = `cloud-${randomUUID().slice(0, 8)}`;
      await seedJiraGrantAndSite(pool, sysAdminId, cloudId);
      const site = await seedWorkspaceSite(pool, workspaceId, cloudId, sysAdminId, {
        active: false,
        policyVersion: 1,
      });

      const verifier = new FakeNativeAdminVerifier();
      const repo = new WorkspaceRepo(pool, { verifier });

      const res = await repo.updateSite(workspaceId, sysAdminId, site.id, {
        expectedPolicyVersion: 1,
        active: true,
      });

      expect(res.site.active).toBe(true);
      expect(res.site.policyVersion).toBe(2);

      // Verify DB row
      const dbRows = await pool.query(
        `SELECT active, policy_version, verified_admin_by, admin_verified_at
         FROM ati_workspace_jira_sites WHERE id = $1`,
        [site.id]
      );
      expect(dbRows.rows[0].active).toBe(true);
      expect(dbRows.rows[0].policy_version).toBe(2);
      expect(dbRows.rows[0].verified_admin_by).toBe(sysAdminId);
      expect(dbRows.rows[0].admin_verified_at).not.toBeNull();
    });
  });

  // ==========================================================================
  // Suite 3: Pre-Verifier Authority, Account, Grant & Isolation Checks
  // ==========================================================================
  describe('3. Pre-Verifier Authority, Account, Grant & Isolation Checks', () => {
    it('denies without invoking verifier if actor has no connected Jira account', async () => {
      const { workspaceId } = await seedWorkspace(pool, sysAdminId);
      const cloudId = `cloud-${randomUUID().slice(0, 8)}`;

      const verifier = new FakeNativeAdminVerifier();
      const repo = new WorkspaceRepo(pool, { verifier });

      await expect(repo.linkSite(workspaceId, sysAdminId, { cloudId })).rejects.toMatchObject({
        statusCode: 403,
        code: expect.stringMatching(/ACCOUNT_NOT_CONNECTED|NO_CONNECTED_ACCOUNT/),
      });

      expect(verifier.recordedEvidences.length).toBe(0);
    });

    it('denies without invoking verifier if actor has connected account but no grant site matching cloudId', async () => {
      const { workspaceId } = await seedWorkspace(pool, sysAdminId);
      const otherCloudId = `cloud-other-${randomUUID().slice(0, 8)}`;
      const requestedCloudId = `cloud-target-${randomUUID().slice(0, 8)}`;
      await seedJiraGrantAndSite(pool, sysAdminId, otherCloudId);

      const verifier = new FakeNativeAdminVerifier();
      const repo = new WorkspaceRepo(pool, { verifier });

      await expect(
        repo.linkSite(workspaceId, sysAdminId, { cloudId: requestedCloudId })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: expect.stringMatching(/GRANT_NOT_FOUND|SITE_NOT_IN_GRANT|FORBIDDEN/),
      });

      expect(verifier.recordedEvidences.length).toBe(0);
    });

    it('denies without invoking verifier when requested cloudId belongs to another user grant', async () => {
      const { workspaceId } = await seedWorkspace(pool, sysAdminId);
      const victimCloudId = `cloud-victim-${randomUUID().slice(0, 8)}`;
      // Grant belongs to sysMemberId, NOT sysAdminId
      await seedJiraGrantAndSite(pool, sysMemberId, victimCloudId);

      const verifier = new FakeNativeAdminVerifier();
      const repo = new WorkspaceRepo(pool, { verifier });

      await expect(
        repo.linkSite(workspaceId, sysAdminId, { cloudId: victimCloudId })
      ).rejects.toMatchObject({
        statusCode: 403,
      });

      expect(verifier.recordedEvidences.length).toBe(0);
    });

    it('denies without invoking verifier if actor Jira account is disconnected', async () => {
      const { workspaceId } = await seedWorkspace(pool, sysAdminId);
      const cloudId = `cloud-${randomUUID().slice(0, 8)}`;
      await seedJiraGrantAndSite(pool, sysAdminId, cloudId, 'Disc Site', 'https://disc.test', {
        accountStatus: 'disconnected',
      });

      const verifier = new FakeNativeAdminVerifier();
      const repo = new WorkspaceRepo(pool, { verifier });

      await expect(repo.linkSite(workspaceId, sysAdminId, { cloudId })).rejects.toMatchObject({
        statusCode: 403,
      });

      expect(verifier.recordedEvidences.length).toBe(0);
    });

    it('returns 404 Hidden Pattern when caller is an outsider without workspace membership', async () => {
      const { workspaceId } = await seedWorkspace(pool, sysAdminId);
      const cloudId = `cloud-${randomUUID().slice(0, 8)}`;
      await seedJiraGrantAndSite(pool, sysMemberId, cloudId);

      const verifier = new FakeNativeAdminVerifier();
      const repo = new WorkspaceRepo(pool, { verifier });

      // sysMemberId is not a member of workspaceId
      await expect(repo.linkSite(workspaceId, sysMemberId, { cloudId })).rejects.toMatchObject({
        statusCode: 404,
        code: expect.stringMatching(/WORKSPACE_NOT_FOUND|NOT_FOUND/),
      });

      expect(verifier.recordedEvidences.length).toBe(0);
    });

    it('returns 404 Hidden Pattern when caller is a removed workspace member', async () => {
      const { workspaceId } = await seedWorkspace(pool, sysAdminId);
      const cloudId = `cloud-${randomUUID().slice(0, 8)}`;
      await seedMembership(pool, workspaceId, sysMemberId, 'member', 'removed');
      await seedJiraGrantAndSite(pool, sysMemberId, cloudId);

      const verifier = new FakeNativeAdminVerifier();
      const repo = new WorkspaceRepo(pool, { verifier });

      await expect(repo.linkSite(workspaceId, sysMemberId, { cloudId })).rejects.toMatchObject({
        statusCode: 404,
      });

      expect(verifier.recordedEvidences.length).toBe(0);
    });

    it('rejects with 403 ADMIN_REQUIRED when caller is an active regular member attempting mutation', async () => {
      const { workspaceId } = await seedWorkspace(pool, sysAdminId);
      const cloudId = `cloud-${randomUUID().slice(0, 8)}`;
      await seedMembership(pool, workspaceId, sysMemberId, 'member', 'active');
      await seedJiraGrantAndSite(pool, sysMemberId, cloudId);

      const verifier = new FakeNativeAdminVerifier();
      const repo = new WorkspaceRepo(pool, { verifier });

      await expect(repo.linkSite(workspaceId, sysMemberId, { cloudId })).rejects.toMatchObject({
        statusCode: 403,
        code: expect.stringMatching(/ADMIN_REQUIRED|FORBIDDEN/),
      });

      expect(verifier.recordedEvidences.length).toBe(0);
    });

    it('returns 404 before verifying when cross-workspace siteId is supplied', async () => {
      const wsA = await seedWorkspace(pool, sysAdminId, 'ws-a');
      const wsB = await seedWorkspace(pool, sysAdminId, 'ws-b');
      const cloudId = `cloud-${randomUUID().slice(0, 8)}`;
      await seedJiraGrantAndSite(pool, sysAdminId, cloudId);

      const siteInA = await seedWorkspaceSite(pool, wsA.workspaceId, cloudId, sysAdminId);

      const verifier = new FakeNativeAdminVerifier();
      const repo = new WorkspaceRepo(pool, { verifier });

      // Actor tries to update siteInA under wsB
      await expect(
        repo.updateSite(wsB.workspaceId, sysAdminId, siteInA.id, {
          expectedPolicyVersion: 1,
          active: true,
        })
      ).rejects.toMatchObject({
        statusCode: 404,
        code: expect.stringMatching(/SITE_NOT_FOUND|NOT_FOUND/),
      });

      expect(verifier.recordedEvidences.length).toBe(0);
    });

    it('isolates the same cloudId across two independent workspaces', async () => {
      const ws1 = await seedWorkspace(pool, sysAdminId, 'ws-iso1');
      const ws2 = await seedWorkspace(pool, sysAdminId, 'ws-iso2');
      const sharedCloudId = `cloud-shared-${randomUUID().slice(0, 8)}`;
      await seedJiraGrantAndSite(pool, sysAdminId, sharedCloudId);

      const verifier = new FakeNativeAdminVerifier();
      const repo = new WorkspaceRepo(pool, { verifier });

      const res1 = await repo.linkSite(ws1.workspaceId, sysAdminId, { cloudId: sharedCloudId });
      const res2 = await repo.linkSite(ws2.workspaceId, sysAdminId, { cloudId: sharedCloudId });

      expect(res1.site.siteId).not.toBe(res2.site.siteId);
      expect(res1.site.cloudId).toBe(sharedCloudId);
      expect(res2.site.cloudId).toBe(sharedCloudId);

      // Mutating ws1 does not affect ws2
      await repo.updateSite(ws1.workspaceId, sysAdminId, res1.site.siteId, {
        expectedPolicyVersion: 1,
        active: true,
      });

      const dbRow2 = await pool.query(
        `SELECT active, policy_version FROM ati_workspace_jira_sites WHERE id = $1`,
        [res2.site.siteId]
      );
      expect(dbRow2.rows[0].active).toBe(false);
      expect(dbRow2.rows[0].policy_version).toBe(1);
    });

    it('selects current connected account and ignores historical disconnected accounts for same owner', async () => {
      const { workspaceId } = await seedWorkspace(pool, sysAdminId);
      const cloudId = `cloud-${randomUUID().slice(0, 8)}`;

      // 1. Insert older disconnected account row for sysAdminId
      const oldAtlassianId = `atlas-old-${randomUUID().slice(0, 8)}`;
      await pool.query(
        `INSERT INTO jira_accounts (user_id, atlassian_account_id, status, identity_version)
         VALUES ($1, $2, 'disconnected', 1)`,
        [sysAdminId, oldAtlassianId]
      );

      // 2. Insert current connected account row with different atlassianAccountId for same owner
      const currentAtlassianId = `atlas-cur-${randomUUID().slice(0, 8)}`;
      const curAccRes = await pool.query(
        `INSERT INTO jira_accounts (user_id, atlassian_account_id, status, identity_version)
         VALUES ($1, $2, 'connected', 2)
         RETURNING id`,
        [sysAdminId, currentAtlassianId]
      );
      const currentAccountId = curAccRes.rows[0].id;

      // 3. Grant and grant site bound to the current connected account
      const grantRes = await pool.query(
        `INSERT INTO jira_oauth_grants (account_id, scopes, token_version, encrypted_access_token, encrypted_refresh_token)
         VALUES ($1, ARRAY['read:jira-work', 'write:jira-work'], 1, 'enc-acc-tok', 'enc-ref-tok')
         RETURNING id`,
        [currentAccountId]
      );
      const currentGrantId = grantRes.rows[0].id;
      await pool.query(
        `INSERT INTO jira_grant_sites (grant_id, cloud_id, site_url, site_name, product_type)
         VALUES ($1, $2, 'https://cur-reconnect.atlassian.net', 'Current Reconnected Site', 'jira')`,
        [currentGrantId, cloudId]
      );

      const verifier = new FakeNativeAdminVerifier({
        status: 'granted',
        siteName: 'Current Reconnected Site',
        siteUrl: 'https://cur-reconnect.atlassian.net',
        verifiedProjectIds: ['10001'],
        verifiedProjects: [{ projectId: '10001', key: 'RECON', name: 'Reconnected Proj' }],
      });
      const repo = new WorkspaceRepo(pool, { verifier });

      const res = await repo.linkSite(workspaceId, sysAdminId, { cloudId });
      expect(res.site.siteId).toBeDefined();
      expect(res.site.cloudId).toBe(cloudId);

      // Verify exact current account was passed in evidence, NOT historical disconnected account
      expect(verifier.recordedEvidences.length).toBe(1);
      const evidence = verifier.recordedEvidences[0];
      if (!evidence) {
        throw new Error('Expected verifier evidence to be recorded');
      }
      expect(evidence.localAccountId).toBe(currentAccountId);
      expect(evidence.atlassianAccountId).toBe(currentAtlassianId);
      expect(evidence.grantId).toBe(currentGrantId);
      expect(evidence.identityVersion).toBe(2);
    });
  });

  // ==========================================================================
  // Suite 4: Denied/Unavailable Verifier Results & Mid-Flight Revocation Barrier
  // ==========================================================================
  describe('4. Denied/Unavailable Verifier Results & Mid-Flight Revocation Barrier', () => {
    it('fails closed with 403 when verifier returns status denied', async () => {
      const { workspaceId } = await seedWorkspace(pool, sysAdminId);
      const cloudId = `cloud-${randomUUID().slice(0, 8)}`;
      await seedJiraGrantAndSite(pool, sysAdminId, cloudId);

      const verifier = new FakeNativeAdminVerifier({
        status: 'denied',
        reason: 'User lacks ADMINISTER global permission',
      });
      const repo = new WorkspaceRepo(pool, { verifier });

      await expect(repo.linkSite(workspaceId, sysAdminId, { cloudId })).rejects.toMatchObject({
        statusCode: 403,
        code: expect.stringMatching(
          /UNVERIFIED_SITE_CANNOT_ACTIVATE|NATIVE_PERMISSION_DENIED|FORBIDDEN/
        ),
      });

      const sites = await pool.query(
        `SELECT * FROM ati_workspace_jira_sites WHERE workspace_id = $1`,
        [workspaceId]
      );
      expect(sites.rowCount).toBe(0);
    });

    it('sanitizes public error message and omits sensitive upstream details or URLs from verifier denied/unavailable reasons', async () => {
      const { workspaceId } = await seedWorkspace(pool, sysAdminId);
      const cloudId = `cloud-${randomUUID().slice(0, 8)}`;
      await seedJiraGrantAndSite(pool, sysAdminId, cloudId);

      const secretDeniedReason =
        'Upstream failure: auth bearer sec-leaked-bearer-xyz-123 at https://internal-oauth.atlassian.com/v1/auth';
      const deniedVerifier = new FakeNativeAdminVerifier({
        status: 'denied',
        reason: secretDeniedReason,
      });
      const deniedRepo = new WorkspaceRepo(pool, { verifier: deniedVerifier });

      try {
        await deniedRepo.linkSite(workspaceId, sysAdminId, { cloudId });
        expect.unreachable('Must reject on denied');
      } catch (err: any) {
        expect(err.statusCode).toBe(403);
        expect(err.code).toMatch(/UNVERIFIED_SITE_CANNOT_ACTIVATE|NATIVE_PERMISSION_DENIED|FORBIDDEN/);
        expect(err.message).not.toContain('sec-leaked-bearer-xyz-123');
        expect(err.message).not.toContain('https://internal-oauth.atlassian.com');
        expect(err.message).not.toBe(secretDeniedReason);
      }

      const secretUnavailableReason =
        'Timeout gateway error sec-gateway-leak-789 https://private-proxy.internal.test/retry';
      const unavailableVerifier = new FakeNativeAdminVerifier({
        status: 'unavailable',
        reason: secretUnavailableReason,
      });
      const unavailRepo = new WorkspaceRepo(pool, { verifier: unavailableVerifier });

      try {
        await unavailRepo.linkSite(workspaceId, sysAdminId, { cloudId });
        expect.unreachable('Must reject on unavailable');
      } catch (err: any) {
        expect(err.statusCode).toBe(503);
        expect(err.code).toBe('NATIVE_VERIFIER_UNAVAILABLE');
        expect(err.message).not.toContain('sec-gateway-leak-789');
        expect(err.message).not.toContain('https://private-proxy.internal.test');
        expect(err.message).not.toBe(secretUnavailableReason);
      }
    });

    it('fails closed with 503 when verifier returns status unavailable', async () => {
      const { workspaceId } = await seedWorkspace(pool, sysAdminId);
      const cloudId = `cloud-${randomUUID().slice(0, 8)}`;
      await seedJiraGrantAndSite(pool, sysAdminId, cloudId);

      const verifier = new FakeNativeAdminVerifier({
        status: 'unavailable',
        reason: 'Atlassian API endpoint timeout',
      });
      const repo = new WorkspaceRepo(pool, { verifier });

      await expect(repo.linkSite(workspaceId, sysAdminId, { cloudId })).rejects.toMatchObject({
        statusCode: 503,
        code: expect.stringMatching(/NATIVE_VERIFIER_UNAVAILABLE|UPSTREAM_UNAVAILABLE/),
      });

      const sites = await pool.query(
        `SELECT * FROM ati_workspace_jira_sites WHERE workspace_id = $1`,
        [workspaceId]
      );
      expect(sites.rowCount).toBe(0);
    });

    it('denies operation when caller account is disconnected mid-flight via independent PG pool', async () => {
      const { workspaceId } = await seedWorkspace(pool, sysAdminId);
      const cloudId = `cloud-${randomUUID().slice(0, 8)}`;
      await seedJiraGrantAndSite(pool, sysAdminId, cloudId);
      const site = await seedWorkspaceSite(pool, workspaceId, cloudId, sysAdminId, {
        active: false,
        policyVersion: 1,
      });

      const barrierPool = ctx.createWorkerPool({ max: 1, applicationName: 'barrier_disc_worker' });
      const enteredGate = createDeferredGate(5000, 'enteredGate');
      const releaseGate = createDeferredGate(5000, 'releaseGate');

      const verifier = new FakeNativeAdminVerifier();
      verifier.handler = async () => {
        enteredGate.resolve();
        await releaseGate.promise;

        return {
          status: 'granted',
          siteName: 'Verified Site',
          siteUrl: 'https://verified.atlassian.net',
          verifiedProjectIds: ['10001'],
          verifiedProjects: [{ projectId: '10001', key: 'VER', name: 'Verified' }],
        };
      };

      const repo = new WorkspaceRepo(pool, { verifier });
      let opPromise: Promise<any> | null = null;
      let allSettledPromise: Promise<[PromiseSettledResult<any>]> | null = null;

      try {
        opPromise = repo.updateSite(workspaceId, sysAdminId, site.id, {
          expectedPolicyVersion: 1,
          active: true,
        });
        allSettledPromise = Promise.allSettled([opPromise]);

        // Await entered gate with deadline before performing real SQL mutation
        await enteredGate.promise;

        // Perform real SQL disconnect via independent PG pool with a deadline
        await barrierPool.query('SET statement_timeout = 4000');
        await barrierPool.query(
          `UPDATE jira_accounts
           SET status = 'disconnected', updated_at = clock_timestamp()
           WHERE user_id = $1`,
          [sysAdminId]
        );

        // Allow verifier to return granted
        releaseGate.resolve();
      } finally {
        releaseGate.resolve(); // Ensure verifier is released even if test fails/throws
        if (allSettledPromise) {
          await allSettledPromise; // Drain operation promise
        }
        await barrierPool.end().catch(() => {});
      }

      const [res] = await allSettledPromise!;
      expect(res.status).toBe('rejected');
      const err = (res as PromiseRejectedResult).reason;
      expect([403, 401]).toContain(err.statusCode);

      // Assert site row in DB was NOT activated
      const dbRow = await pool.query(
        `SELECT active, policy_version FROM ati_workspace_jira_sites WHERE id = $1`,
        [site.id]
      );
      expect(dbRow.rows[0].active).toBe(false);
      expect(dbRow.rows[0].policy_version).toBe(1);
    });

    it('denies operation when caller membership is removed mid-flight via independent PG pool', async () => {
      const { workspaceId } = await seedWorkspace(pool, sysAdminId);
      const cloudId = `cloud-${randomUUID().slice(0, 8)}`;
      await seedJiraGrantAndSite(pool, sysAdminId, cloudId);
      const site = await seedWorkspaceSite(pool, workspaceId, cloudId, sysAdminId, {
        active: false,
        policyVersion: 1,
      });

      const barrierPool = ctx.createWorkerPool({ max: 1, applicationName: 'barrier_mem_worker' });
      const enteredGate = createDeferredGate(5000, 'enteredGate');
      const releaseGate = createDeferredGate(5000, 'releaseGate');

      const verifier = new FakeNativeAdminVerifier();
      verifier.handler = async () => {
        enteredGate.resolve();
        await releaseGate.promise;

        return {
          status: 'granted',
          siteName: 'Verified Site',
          siteUrl: 'https://verified.atlassian.net',
          verifiedProjectIds: ['10001'],
          verifiedProjects: [{ projectId: '10001', key: 'VER', name: 'Verified' }],
        };
      };

      const repo = new WorkspaceRepo(pool, { verifier });
      let opPromise: Promise<any> | null = null;
      let allSettledPromise: Promise<[PromiseSettledResult<any>]> | null = null;

      try {
        opPromise = repo.updateSite(workspaceId, sysAdminId, site.id, {
          expectedPolicyVersion: 1,
          active: true,
        });
        allSettledPromise = Promise.allSettled([opPromise]);

        // Await entered gate with deadline before performing real SQL mutation
        await enteredGate.promise;

        // Perform real SQL membership removal via independent PG pool with a deadline
        await barrierPool.query('SET statement_timeout = 4000');
        await barrierPool.query(
          `UPDATE ati_workspace_memberships
           SET status = 'removed', updated_at = clock_timestamp()
           WHERE workspace_id = $1 AND user_id = $2`,
          [workspaceId, sysAdminId]
        );

        // Allow verifier to return granted
        releaseGate.resolve();
      } finally {
        releaseGate.resolve();
        if (allSettledPromise) {
          await allSettledPromise;
        }
        await barrierPool.end().catch(() => {});
      }

      const [res] = await allSettledPromise!;
      expect(res.status).toBe('rejected');
      const err = (res as PromiseRejectedResult).reason;
      expect([403, 404]).toContain(err.statusCode);

      const dbRow = await pool.query(
        `SELECT active, policy_version FROM ati_workspace_jira_sites WHERE id = $1`,
        [site.id]
      );
      expect(dbRow.rows[0].active).toBe(false);
      expect(dbRow.rows[0].policy_version).toBe(1);
    });

    it('denies operation when caller user status is pre-existing disabled in users table', async () => {
      const disabledUserId = await createSyntheticUser(pool, 'Disabled User', 'disuser', {
        role: 'admin',
        status: 'disabled',
      });
      const { workspaceId } = await seedWorkspace(pool, disabledUserId);
      const cloudId = `cloud-${randomUUID().slice(0, 8)}`;
      await seedJiraGrantAndSite(pool, disabledUserId, cloudId);

      const verifier = new FakeNativeAdminVerifier();
      const repo = new WorkspaceRepo(pool, { verifier });

      await expect(repo.linkSite(workspaceId, disabledUserId, { cloudId })).rejects.toMatchObject({
        statusCode: 404,
      });
      expect(verifier.recordedEvidences.length).toBe(0);
    });

    it('denies operation when caller user status is changed to disabled mid-flight via independent PG pool', async () => {
      const { workspaceId } = await seedWorkspace(pool, sysAdminId);
      const cloudId = `cloud-${randomUUID().slice(0, 8)}`;
      await seedJiraGrantAndSite(pool, sysAdminId, cloudId);
      const site = await seedWorkspaceSite(pool, workspaceId, cloudId, sysAdminId, {
        active: false,
        policyVersion: 1,
      });

      const barrierPool = ctx.createWorkerPool({ max: 1, applicationName: 'barrier_dis_worker' });
      const enteredGate = createDeferredGate(5000, 'enteredGate');
      const releaseGate = createDeferredGate(5000, 'releaseGate');

      const verifier = new FakeNativeAdminVerifier();
      verifier.handler = async () => {
        enteredGate.resolve();
        await releaseGate.promise;

        return {
          status: 'granted',
          siteName: 'Verified Site',
          siteUrl: 'https://verified.atlassian.net',
          verifiedProjectIds: ['10001'],
          verifiedProjects: [{ projectId: '10001', key: 'VER', name: 'Verified' }],
        };
      };

      const repo = new WorkspaceRepo(pool, { verifier });
      let opPromise: Promise<any> | null = null;
      let allSettledPromise: Promise<[PromiseSettledResult<any>]> | null = null;

      try {
        opPromise = repo.updateSite(workspaceId, sysAdminId, site.id, {
          expectedPolicyVersion: 1,
          active: true,
        });
        allSettledPromise = Promise.allSettled([opPromise]);

        await enteredGate.promise;

        await barrierPool.query('SET statement_timeout = 4000');
        await barrierPool.query(
          `UPDATE users
           SET status = 'disabled', updated_at = clock_timestamp()
           WHERE id = $1`,
          [sysAdminId]
        );

        releaseGate.resolve();
      } finally {
        releaseGate.resolve();
        if (allSettledPromise) {
          await allSettledPromise;
        }
        await barrierPool.end().catch(() => {});
      }

      const [res] = await allSettledPromise!;
      expect(res.status).toBe('rejected');
      const err = (res as PromiseRejectedResult).reason;
      expect([403, 404]).toContain(err.statusCode);

      const dbRow = await pool.query(
        `SELECT active, policy_version FROM ati_workspace_jira_sites WHERE id = $1`,
        [site.id]
      );
      expect(dbRow.rows[0].active).toBe(false);
      expect(dbRow.rows[0].policy_version).toBe(1);
    });

    it('denies operation when grant site product_type is changed mid-flight via independent PG pool', async () => {
      const { workspaceId } = await seedWorkspace(pool, sysAdminId);
      const cloudId = `cloud-${randomUUID().slice(0, 8)}`;
      const { grantId } = await seedJiraGrantAndSite(pool, sysAdminId, cloudId);
      const site = await seedWorkspaceSite(pool, workspaceId, cloudId, sysAdminId, {
        active: false,
        policyVersion: 1,
      });

      const barrierPool = ctx.createWorkerPool({ max: 1, applicationName: 'barrier_prod_worker' });
      const enteredGate = createDeferredGate(5000, 'enteredGate');
      const releaseGate = createDeferredGate(5000, 'releaseGate');

      const verifier = new FakeNativeAdminVerifier();
      verifier.handler = async () => {
        enteredGate.resolve();
        await releaseGate.promise;

        return {
          status: 'granted',
          siteName: 'Verified Site',
          siteUrl: 'https://verified.atlassian.net',
          verifiedProjectIds: ['10001'],
          verifiedProjects: [{ projectId: '10001', key: 'VER', name: 'Verified' }],
        };
      };

      const repo = new WorkspaceRepo(pool, { verifier });
      let opPromise: Promise<any> | null = null;
      let allSettledPromise: Promise<[PromiseSettledResult<any>]> | null = null;

      try {
        opPromise = repo.updateSite(workspaceId, sysAdminId, site.id, {
          expectedPolicyVersion: 1,
          active: true,
        });
        allSettledPromise = Promise.allSettled([opPromise]);

        await enteredGate.promise;

        await barrierPool.query('SET statement_timeout = 4000');
        // Mid-verifier change product_type to 'confluence' without changing identity_version
        await barrierPool.query(
          `UPDATE jira_grant_sites
           SET product_type = 'confluence', last_verified_at = clock_timestamp()
           WHERE grant_id = $1 AND cloud_id = $2`,
          [grantId, cloudId]
        );

        releaseGate.resolve();
      } finally {
        releaseGate.resolve();
        if (allSettledPromise) {
          await allSettledPromise;
        }
        await barrierPool.end().catch(() => {});
      }

      const [res] = await allSettledPromise!;
      expect(res.status).toBe('rejected');
      const err = (res as PromiseRejectedResult).reason;
      expect([403, 404]).toContain(err.statusCode);

      // Assert site row in DB was NOT activated
      const dbRow = await pool.query(
        `SELECT active, policy_version FROM ati_workspace_jira_sites WHERE id = $1`,
        [site.id]
      );
      expect(dbRow.rows[0].active).toBe(false);
      expect(dbRow.rows[0].policy_version).toBe(1);
    });
  });

  // ==========================================================================
  // Suite 5: Project Configuration Input Validation, Empty Selection & Stale CAS
  // ==========================================================================
  describe('5. Project Configuration Input Validation, Empty Selection & Stale CAS', () => {
    it('rejects wildcard project ID with 400 INVALID_PROJECT_ID', async () => {
      const { workspaceId } = await seedWorkspace(pool, sysAdminId);
      const cloudId = `cloud-${randomUUID().slice(0, 8)}`;
      await seedJiraGrantAndSite(pool, sysAdminId, cloudId);
      const site = await seedWorkspaceSite(pool, workspaceId, cloudId, sysAdminId, { active: true });

      const verifier = new FakeNativeAdminVerifier();
      const repo = new WorkspaceRepo(pool, { verifier });

      await expect(
        repo.configureProjects(workspaceId, sysAdminId, site.id, {
          expectedPolicyVersion: 1,
          selectedProjectIds: ['*'],
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: expect.stringMatching(/INVALID_PROJECT_ID|BAD_REQUEST/),
      });
    });

    it('rejects non-numeric project IDs with 400 INVALID_PROJECT_ID', async () => {
      const { workspaceId } = await seedWorkspace(pool, sysAdminId);
      const cloudId = `cloud-${randomUUID().slice(0, 8)}`;
      await seedJiraGrantAndSite(pool, sysAdminId, cloudId);
      const site = await seedWorkspaceSite(pool, workspaceId, cloudId, sysAdminId, { active: true });

      const verifier = new FakeNativeAdminVerifier();
      const repo = new WorkspaceRepo(pool, { verifier });

      for (const badId of ['PROJ-1', 'abc', '-5', '0', '10.5']) {
        await expect(
          repo.configureProjects(workspaceId, sysAdminId, site.id, {
            expectedPolicyVersion: 1,
            selectedProjectIds: [badId],
          })
        ).rejects.toMatchObject({
          statusCode: 400,
        });
      }
    });

    it('rejects duplicate project IDs with 400', async () => {
      const { workspaceId } = await seedWorkspace(pool, sysAdminId);
      const cloudId = `cloud-${randomUUID().slice(0, 8)}`;
      await seedJiraGrantAndSite(pool, sysAdminId, cloudId);
      const site = await seedWorkspaceSite(pool, workspaceId, cloudId, sysAdminId, { active: true });

      const verifier = new FakeNativeAdminVerifier();
      const repo = new WorkspaceRepo(pool, { verifier });

      await expect(
        repo.configureProjects(workspaceId, sysAdminId, site.id, {
          expectedPolicyVersion: 1,
          selectedProjectIds: ['10001', '10001'],
        })
      ).rejects.toMatchObject({
        statusCode: 400,
      });
    });

    it('rejects excessive project IDs with 400', async () => {
      const { workspaceId } = await seedWorkspace(pool, sysAdminId);
      const cloudId = `cloud-${randomUUID().slice(0, 8)}`;
      await seedJiraGrantAndSite(pool, sysAdminId, cloudId);
      const site = await seedWorkspaceSite(pool, workspaceId, cloudId, sysAdminId, { active: true });

      const verifier = new FakeNativeAdminVerifier();
      const repo = new WorkspaceRepo(pool, { verifier });

      const excessiveIds = Array.from({ length: 101 }, (_, i) => String(10000 + i));

      await expect(
        repo.configureProjects(workspaceId, sysAdminId, site.id, {
          expectedPolicyVersion: 1,
          selectedProjectIds: excessiveIds,
        })
      ).rejects.toMatchObject({
        statusCode: 400,
      });
    });

    it('allows empty selection as safe removal and deselects all projects under CAS', async () => {
      const { workspaceId } = await seedWorkspace(pool, sysAdminId);
      const cloudId = `cloud-${randomUUID().slice(0, 8)}`;
      await seedJiraGrantAndSite(pool, sysAdminId, cloudId);
      const site = await seedWorkspaceSite(pool, workspaceId, cloudId, sysAdminId, {
        active: true,
        policyVersion: 1,
      });
      await seedWorkspaceProject(
        pool,
        workspaceId,
        site.id,
        cloudId,
        '10001',
        'ALPHA',
        'Alpha Proj',
        { selected: true, policyVersion: 1 }
      );

      const verifier = new FakeNativeAdminVerifier();
      const repo = new WorkspaceRepo(pool, { verifier });

      const res = await repo.configureProjects(workspaceId, sysAdminId, site.id, {
        expectedPolicyVersion: 1,
        selectedProjectIds: [],
      });

      expect(res.sitePolicyVersion).toBe(2);

      // Verify project was deselected and project policy_version incremented
      const projRow = await pool.query(
        `SELECT selected, policy_version FROM ati_workspace_jira_projects
         WHERE workspace_id = $1 AND numeric_project_id = '10001'`,
        [workspaceId]
      );
      expect(projRow.rows[0].selected).toBe(false);
      expect(projRow.rows[0].policy_version).toBe(2);
    });

    it('rejects with 403 PROJECT_NOT_VERIFIED when selecting project not in verifier verified set', async () => {
      const { workspaceId } = await seedWorkspace(pool, sysAdminId);
      const cloudId = `cloud-${randomUUID().slice(0, 8)}`;
      await seedJiraGrantAndSite(pool, sysAdminId, cloudId);
      const site = await seedWorkspaceSite(pool, workspaceId, cloudId, sysAdminId, {
        active: true,
        policyVersion: 1,
      });

      const verifier = new FakeNativeAdminVerifier({
        status: 'granted',
        siteName: 'Verified Site',
        siteUrl: 'https://verified.atlassian.net',
        verifiedProjectIds: ['10001'], // 10002 is NOT verified
        verifiedProjects: [{ projectId: '10001', key: 'ALPHA', name: 'Alpha' }],
      });
      const repo = new WorkspaceRepo(pool, { verifier });

      await expect(
        repo.configureProjects(workspaceId, sysAdminId, site.id, {
          expectedPolicyVersion: 1,
          selectedProjectIds: ['10001', '10002'],
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: expect.stringMatching(/PROJECT_NOT_VERIFIED|NATIVE_PERMISSION_DENIED|FORBIDDEN/),
      });

      // Assert site version unchanged
      const siteRow = await pool.query(
        `SELECT policy_version FROM ati_workspace_jira_sites WHERE id = $1`,
        [site.id]
      );
      expect(siteRow.rows[0].policy_version).toBe(1);
    });

    it('rejects with 409 STALE_VERSION when expectedPolicyVersion does not match current site version', async () => {
      const { workspaceId } = await seedWorkspace(pool, sysAdminId);
      const cloudId = `cloud-${randomUUID().slice(0, 8)}`;
      await seedJiraGrantAndSite(pool, sysAdminId, cloudId);
      const site = await seedWorkspaceSite(pool, workspaceId, cloudId, sysAdminId, {
        active: true,
        policyVersion: 2,
      });

      const verifier = new FakeNativeAdminVerifier();
      const repo = new WorkspaceRepo(pool, { verifier });

      await expect(
        repo.configureProjects(workspaceId, sysAdminId, site.id, {
          expectedPolicyVersion: 1, // Stale! Current is 2
          selectedProjectIds: ['10001'],
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'STALE_VERSION',
      });
    });
  });

  // ==========================================================================
  // Suite 6: Trusted Labels Mapping, Independent Policy Versions & Concurrent Race
  // ==========================================================================
  describe('6. Trusted Labels Mapping, Independent Policy Versions & Concurrent Race', () => {
    it('maps trusted project labels from verifier and advances site and project versions independently', async () => {
      const { workspaceId } = await seedWorkspace(pool, sysAdminId);
      const cloudId = `cloud-${randomUUID().slice(0, 8)}`;
      await seedJiraGrantAndSite(pool, sysAdminId, cloudId);
      const site = await seedWorkspaceSite(pool, workspaceId, cloudId, sysAdminId, {
        active: true,
        policyVersion: 1,
      });

      const verifier = new FakeNativeAdminVerifier({
        status: 'granted',
        siteName: 'Verified Site',
        siteUrl: 'https://verified.atlassian.net',
        verifiedProjectIds: ['10001', '10002'],
        verifiedProjects: [
          { projectId: '10001', key: 'PROJ-ONE', name: 'Authoritative Project One' },
          { projectId: '10002', key: 'PROJ-TWO', name: 'Authoritative Project Two' },
        ],
      });
      const repo = new WorkspaceRepo(pool, { verifier });

      // Step 1: Select project 10001
      const res1 = await repo.configureProjects(workspaceId, sysAdminId, site.id, {
        expectedPolicyVersion: 1,
        selectedProjectIds: ['10001'],
      });
      expect(res1.sitePolicyVersion).toBe(2);

      const p1Rows = await pool.query(
        `SELECT numeric_project_id, project_key, project_name, selected, policy_version
         FROM ati_workspace_jira_projects
         WHERE workspace_id = $1 AND numeric_project_id = '10001'`,
        [workspaceId]
      );
      expect(p1Rows.rows[0]).toEqual({
        numeric_project_id: '10001',
        project_key: 'PROJ-ONE',
        project_name: 'Authoritative Project One',
        selected: true,
        policy_version: 1,
      });

      // Step 2: Deselect 10001 and select 10002
      const res2 = await repo.configureProjects(workspaceId, sysAdminId, site.id, {
        expectedPolicyVersion: 2,
        selectedProjectIds: ['10002'],
      });
      expect(res2.sitePolicyVersion).toBe(3);

      const p1RowsAfter = await pool.query(
        `SELECT selected, policy_version FROM ati_workspace_jira_projects
         WHERE workspace_id = $1 AND numeric_project_id = '10001'`,
        [workspaceId]
      );
      expect(p1RowsAfter.rows[0]).toEqual({
        selected: false,
        policy_version: 2, // Incremented independently on change
      });

      const p2RowsAfter = await pool.query(
        `SELECT selected, policy_version FROM ati_workspace_jira_projects
         WHERE workspace_id = $1 AND numeric_project_id = '10002'`,
        [workspaceId]
      );
      expect(p2RowsAfter.rows[0]).toEqual({
        selected: true,
        policy_version: 1, // Newly added
      });
    });

    it('keeps untouched project row policy_version unchanged across configuration mutations', async () => {
      const { workspaceId } = await seedWorkspace(pool, sysAdminId);
      const cloudId = `cloud-${randomUUID().slice(0, 8)}`;
      await seedJiraGrantAndSite(pool, sysAdminId, cloudId);
      const site = await seedWorkspaceSite(pool, workspaceId, cloudId, sysAdminId, {
        active: true,
        policyVersion: 1,
      });

      // Pre-seed 10001 (selected, ver 2) and 10002 (unselected, ver 1)
      await seedWorkspaceProject(
        pool,
        workspaceId,
        site.id,
        cloudId,
        '10001',
        'KEY1',
        'Name 1',
        { selected: true, policyVersion: 2 }
      );
      await seedWorkspaceProject(
        pool,
        workspaceId,
        site.id,
        cloudId,
        '10002',
        'KEY2',
        'Name 2',
        { selected: false, policyVersion: 1 }
      );

      const verifier = new FakeNativeAdminVerifier({
        status: 'granted',
        siteName: 'Verified Site',
        siteUrl: 'https://verified.atlassian.net',
        verifiedProjectIds: ['10001', '10002', '10003'],
        verifiedProjects: [
          { projectId: '10001', key: 'KEY1', name: 'Name 1' },
          { projectId: '10002', key: 'KEY2', name: 'Name 2' },
          { projectId: '10003', key: 'KEY3', name: 'Name 3' },
        ],
      });
      const repo = new WorkspaceRepo(pool, { verifier });

      // Configuration updates only 10003 (selects 10001 and 10003; 10001 was ALREADY selected; 10002 remains unselected)
      const res = await repo.configureProjects(workspaceId, sysAdminId, site.id, {
        expectedPolicyVersion: 1,
        selectedProjectIds: ['10001', '10003'],
      });
      expect(res.sitePolicyVersion).toBe(2);

      // 10001 selection did NOT change -> policy_version must remain 2!
      const p1Row = await pool.query(
        `SELECT selected, policy_version FROM ati_workspace_jira_projects
         WHERE workspace_id = $1 AND numeric_project_id = '10001'`,
        [workspaceId]
      );
      expect(p1Row.rows[0].policy_version).toBe(2);

      // 10002 selection did NOT change -> policy_version must remain 1!
      const p2Row = await pool.query(
        `SELECT selected, policy_version FROM ati_workspace_jira_projects
         WHERE workspace_id = $1 AND numeric_project_id = '10002'`,
        [workspaceId]
      );
      expect(p2Row.rows[0].policy_version).toBe(1);
    });

    it('resolves concurrent race with exactly one winner and one STALE_VERSION (409) via real PG lock barrier', async () => {
      const { workspaceId } = await seedWorkspace(pool, sysAdminId);
      const cloudId = `cloud-${randomUUID().slice(0, 8)}`;
      await seedJiraGrantAndSite(pool, sysAdminId, cloudId);
      const site = await seedWorkspaceSite(pool, workspaceId, cloudId, sysAdminId, {
        active: true,
        policyVersion: 1,
      });

      const schemaSuffix = ctx.schema.slice(-8);
      const tag1 = `race_proj1_${schemaSuffix}`;
      const tag2 = `race_proj2_${schemaSuffix}`;

      const racePool1 = ctx.createWorkerPool({ max: 2, applicationName: tag1 });
      const racePool2 = ctx.createWorkerPool({ max: 2, applicationName: tag2 });

      // Verifier fixture finishes immediately outside the SQL transaction so both participants proceed to lock acquisition
      const verifier = new FakeNativeAdminVerifier({
        status: 'granted',
        siteName: 'Verified Site',
        siteUrl: 'https://verified.atlassian.net',
        verifiedProjectIds: ['10001', '10002'],
        verifiedProjects: [
          { projectId: '10001', key: 'P1', name: 'Project 1' },
          { projectId: '10002', key: 'P2', name: 'Project 2' },
        ],
      });

      const repo1 = new WorkspaceRepo(racePool1, { verifier });
      const repo2 = new WorkspaceRepo(racePool2, { verifier });

      const barrierClient = await pool.connect();
      let allSettledPromise: Promise<[PromiseSettledResult<any>, PromiseSettledResult<any>]> | null = null;

      try {
        await barrierClient.query('BEGIN');
        // Independent barrier transaction holds exclusive lock on the common workspace and site rows
        await barrierClient.query('SELECT id FROM ati_workspaces WHERE id = $1 FOR UPDATE', [
          workspaceId,
        ]);
        await barrierClient.query('SELECT id FROM ati_workspace_jira_sites WHERE id = $1 FOR UPDATE', [
          site.id,
        ]);

        // Launch the TWO actual WorkspaceRepo.configureProjects calls on distinct application_name tagged pools
        const p1 = repo1.configureProjects(workspaceId, sysAdminId, site.id, {
          expectedPolicyVersion: 1,
          selectedProjectIds: ['10001'],
        });

        const p2 = repo2.configureProjects(workspaceId, sysAdminId, site.id, {
          expectedPolicyVersion: 1,
          selectedProjectIds: ['10002'],
        });

        // Attach allSettled immediately to capture results and prevent unhandled rejections
        allSettledPromise = Promise.allSettled([p1, p2]);

        // Observe BOTH expected participants waiting on the lock in PostgreSQL
        await waitForBlockedQueries(pool, [tag1, tag2], 5000);

        // Release the barrier by committing
        await barrierClient.query('COMMIT');
      } finally {
        try {
          await barrierClient.query('ROLLBACK');
        } catch {}
        barrierClient.release();
        if (allSettledPromise) {
          await allSettledPromise;
        }
        await Promise.allSettled([racePool1.end(), racePool2.end()]);
      }

      // Assert exactly one winner and one STALE_VERSION (409)
      const results = await allSettledPromise!;
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const winnerResult = (fulfilled[0] as PromiseFulfilledResult<ConfigureWorkspaceProjectsResponse>)
        .value;
      expect(winnerResult.sitePolicyVersion).toBe(2);

      const loserError: any = (rejected[0] as PromiseRejectedResult).reason;
      expect(loserError.statusCode).toBe(409);
      expect(loserError.code).toBe('STALE_VERSION'); // Agreed code, reject generic CONFLICT

      // Assert site policy_version advanced by exactly 1 generation
      const dbSite = await pool.query(
        `SELECT policy_version FROM ati_workspace_jira_sites WHERE id = $1`,
        [site.id]
      );
      expect(dbSite.rows[0].policy_version).toBe(2);

      // Assert coherent selected rows in PostgreSQL matching the winner's payload
      const selectedProjects = await pool.query(
        `SELECT numeric_project_id, selected, policy_version
         FROM ati_workspace_jira_projects
         WHERE workspace_id = $1 AND site_id = $2 AND selected = true`,
        [workspaceId, site.id]
      );
      expect(selectedProjects.rowCount).toBe(1);
      const winnerProjectId = selectedProjects.rows[0].numeric_project_id;
      expect(['10001', '10002']).toContain(winnerProjectId);

      const otherProjectId = winnerProjectId === '10001' ? '10002' : '10001';
      const loserProject = await pool.query(
        `SELECT selected FROM ati_workspace_jira_projects
         WHERE workspace_id = $1 AND site_id = $2 AND numeric_project_id = $3`,
        [workspaceId, site.id, otherProjectId]
      );
      if (typeof loserProject.rowCount === 'number' && loserProject.rowCount > 0 && loserProject.rows[0]) {
        expect(loserProject.rows[0].selected).toBe(false);
      }

      // Assert exactly one audit entry recorded at version 2
      const auditRes = await pool.query(
        `SELECT action, decision, version FROM jira_authorization_audit
         WHERE workspace_id = $1 AND site_id = $2 AND version = 2`,
        [workspaceId, site.id]
      );
      expect(auditRes.rowCount).toBe(1);
      expect(auditRes.rows[0].action).toMatch(/configure_projects/);
      expect(auditRes.rows[0].decision).toBe('granted');
    });
  });

  // ==========================================================================
  // Suite 7: Listing Metadata, Privacy Guards & Explicit 503 Capabilities
  // ==========================================================================
  describe('7. Listing Metadata, Privacy Guards & Explicit 503 Capabilities', () => {
    it('allows active member and admin to list sites and retrieve allowed metadata', async () => {
      const { workspaceId } = await seedWorkspace(pool, sysAdminId);
      const cloudId = `cloud-${randomUUID().slice(0, 8)}`;
      await seedMembership(pool, workspaceId, sysMemberId, 'member', 'active');
      await seedWorkspaceSite(pool, workspaceId, cloudId, sysAdminId, {
        siteName: 'Catalog Site',
        siteUrl: 'https://catalog.atlassian.net',
        active: false,
        policyVersion: 1,
      });

      const repo = new WorkspaceRepo(pool);

      // Both admin and regular active member can list sites
      const adminSites = await repo.listSites(workspaceId, sysAdminId);
      const memberSites = await repo.listSites(workspaceId, sysMemberId);

      expect(adminSites.length).toBe(1);
      expect(memberSites.length).toBe(1);
      expect(memberSites[0]).toEqual({
        siteId: expect.any(String),
        cloudId: cloudId,
        name: 'Catalog Site',
        url: 'https://catalog.atlassian.net',
        active: false,
        policyVersion: 1,
      });
    });

    it('allows active member and admin to get projects for a workspace site', async () => {
      const { workspaceId } = await seedWorkspace(pool, sysAdminId);
      const cloudId = `cloud-${randomUUID().slice(0, 8)}`;
      await seedMembership(pool, workspaceId, sysMemberId, 'member', 'active');
      const site = await seedWorkspaceSite(pool, workspaceId, cloudId, sysAdminId, {
        active: true,
        policyVersion: 2,
      });
      await seedWorkspaceProject(
        pool,
        workspaceId,
        site.id,
        cloudId,
        '10001',
        'PROJ',
        'Project Name',
        { selected: true, policyVersion: 1 }
      );

      const repo = new WorkspaceRepo(pool);

      const res = await repo.getProjects(workspaceId, sysMemberId, site.id);

      expect(res.sitePolicyVersion).toBe(2);
      expect(res.projects.length).toBe(1);
      expect(res.projects[0]).toEqual({
        projectId: '10001',
        key: 'PROJ',
        name: 'Project Name',
        selected: true,
      });
    });

    it('returns 404 Hidden Pattern when outsider or removed member attempts listing', async () => {
      const { workspaceId } = await seedWorkspace(pool, sysAdminId);
      const cloudId = `cloud-${randomUUID().slice(0, 8)}`;
      const site = await seedWorkspaceSite(pool, workspaceId, cloudId, sysAdminId);

      const outsiderId = await createSyntheticUser(pool, 'Outsider', 'outsider');
      const removedId = await createSyntheticUser(pool, 'Removed', 'removed');
      await seedMembership(pool, workspaceId, removedId, 'member', 'removed');

      const repo = new WorkspaceRepo(pool);

      await expect(repo.listSites(workspaceId, outsiderId)).rejects.toMatchObject({
        statusCode: 404,
      });
      await expect(repo.getProjects(workspaceId, outsiderId, site.id)).rejects.toMatchObject({
        statusCode: 404,
      });

      await expect(repo.listSites(workspaceId, removedId)).rejects.toMatchObject({
        statusCode: 404,
      });
      await expect(repo.getProjects(workspaceId, removedId, site.id)).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it('returns 404 when membership is revoked immediately before reading site data (single snapshot guard)', async () => {
      const { workspaceId } = await seedWorkspace(pool, sysAdminId);
      const cloudId = `cloud-${randomUUID().slice(0, 8)}`;
      await seedMembership(pool, workspaceId, sysMemberId, 'member', 'active');
      await seedWorkspaceSite(pool, workspaceId, cloudId, sysAdminId, {
        siteName: 'Revocation Guard Site',
        siteUrl: 'https://revoc.atlassian.net',
        active: false,
        policyVersion: 1,
      });

      const workerPool = ctx.createWorkerPool({ max: 1, applicationName: 'toctou_sites_worker' });
      let hookTriggered = false;

      const hookedPool = createHookedPool(pool, async (sql) => {
        // Hook immediately before actual query referencing site data
        if (sql.includes('ati_workspace_jira_sites') && !hookTriggered) {
          hookTriggered = true;
          // Execute real membership removal on independent PG connection
          await workerPool.query(
            `UPDATE ati_workspace_memberships
             SET status = 'removed', updated_at = clock_timestamp()
             WHERE workspace_id = $1 AND user_id = $2`,
            [workspaceId, sysMemberId]
          );
        }
      });

      const repo = new WorkspaceRepo(hookedPool);

      try {
        await expect(repo.listSites(workspaceId, sysMemberId)).rejects.toMatchObject({
          statusCode: 404,
          code: expect.stringMatching(/WORKSPACE_NOT_FOUND|NOT_FOUND/),
        });
        expect(hookTriggered).toBe(true);
      } finally {
        await workerPool.end().catch(() => {});
      }
    });

    it('returns coherent generation and project data when concurrent configuration commits during read', async () => {
      const { workspaceId } = await seedWorkspace(pool, sysAdminId);
      const cloudId = `cloud-${randomUUID().slice(0, 8)}`;
      await seedMembership(pool, workspaceId, sysMemberId, 'member', 'active');
      const site = await seedWorkspaceSite(pool, workspaceId, cloudId, sysAdminId, {
        active: true,
        policyVersion: 1,
      });
      await seedWorkspaceProject(
        pool,
        workspaceId,
        site.id,
        cloudId,
        '10001',
        'PROJ',
        'Project Name',
        { selected: true, policyVersion: 1 }
      );

      const workerPool = ctx.createWorkerPool({ max: 1, applicationName: 'toctou_gen_worker' });
      let hookTriggered = false;

      const hookedPool = createHookedPool(pool, async (sql) => {
        if (sql.includes('ati_workspace_jira_projects') && !hookTriggered) {
          hookTriggered = true;
          await workerPool.query('BEGIN');
          await workerPool.query(
            `UPDATE ati_workspace_jira_sites
             SET policy_version = 2, updated_at = clock_timestamp()
             WHERE id = $1`,
            [site.id]
          );
          await workerPool.query(
            `UPDATE ati_workspace_jira_projects
             SET selected = false, policy_version = 2, updated_at = clock_timestamp()
             WHERE workspace_id = $1 AND numeric_project_id = $2`,
            [workspaceId, '10001']
          );
          await workerPool.query('COMMIT');
        }
      });

      const repo = new WorkspaceRepo(hookedPool);

      try {
        const res = await repo.getProjects(workspaceId, sysMemberId, site.id);
        expect(hookTriggered).toBe(true);
        // Generation and project rows must belong to the coherent atomic snapshot (version 2)
        expect(res.sitePolicyVersion).toBe(2);
        expect(res.projects[0]?.selected).toBe(false);
      } finally {
        await workerPool.end().catch(() => {});
      }
    });

    it('explicitly throws 503 CAPABILITIES_UNAVAILABLE on getCapabilities rather than returning empty array', async () => {
      const { workspaceId } = await seedWorkspace(pool, sysAdminId);
      await seedMembership(pool, workspaceId, sysMemberId, 'member', 'active');

      const repo = new WorkspaceRepo(pool);

      // Coordinator ruling 1: capabilities always 503 CAPABILITIES_UNAVAILABLE until JIRA-05
      await expect(repo.getCapabilities(workspaceId, sysAdminId)).rejects.toMatchObject({
        statusCode: 503,
        code: 'CAPABILITIES_UNAVAILABLE',
      });

      await expect(repo.getCapabilities(workspaceId, sysMemberId)).rejects.toMatchObject({
        statusCode: 503,
        code: 'CAPABILITIES_UNAVAILABLE',
      });
    });
  });
});
