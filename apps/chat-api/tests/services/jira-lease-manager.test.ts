import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import WorkspaceRepo from '../../src/db/repositories/workspace/index.js';
import { JiraOAuthRepo } from '../../src/db/repositories/jira-oauth-repo.js';
import {
  createIsolatedTestSchema,
  createSyntheticUser,
  connectSyntheticJiraAccount,
  type IsolatedTestContext,
} from '../helpers/jira-test-db.js';
import {
  validateJiraAuthorizationLease,
  JIRA_SQL_LOCK_HIERARCHY,
  type JiraAuthorizationLease,
} from '@wap/tool-schemas';
import {
  JiraLeaseManager,
  type JiraLeaseTokenManager,
  type AcquireLeaseParams,
  type MarkRevokedFilter,
  type RevalidateLeaseResult,
} from '../../src/services/jira/jira-lease-manager.js';

interface TestFixtureContext {
  userId: string;
  workspaceId: string;
  accountId: string;
  atlassianAccountId: string;
  grantId: string;
  cloudId: string;
  siteId: string;
  projectId: string;
  projectKey: string;
}

interface JiraAuthorizationLeaseRow {
  id: string;
  lease_id: string;
  workspace_id: string;
  cloud_id: string;
  ati_user_id: string;
  jira_account_id: string;
  atlassian_account_id: string;
  grant_id: string;
  membership_version: number;
  identity_version: number;
  workspace_version: number;
  site_policy_version: number;
  project_id: string | null;
  project_policy_version: number | null;
  ttl_ms: number;
  acquired_at: Date;
  expires_at: Date;
  released_at: Date | null;
  status: 'active' | 'released' | 'expired' | 'revoked';
  created_at: Date;
}

const createStubTokenManager = (overrides?: {
  accessToken?: string;
  shouldThrow?: Error;
}): JiraLeaseTokenManager => ({
  getAccessToken: async (_userId: string, options?: { signal?: AbortSignal }): Promise<string> => {
    if (options?.signal?.aborted) {
      throw options.signal.reason ?? new Error('Aborted');
    }
    if (overrides?.shouldThrow) {
      throw overrides.shouldThrow;
    }
    return overrides?.accessToken ?? 'mock_token_sentence_sentinel';
  },
});

async function seedJiraWorkspaceFixture(
  pool: pg.Pool,
  prefix = 'lease_mgr'
): Promise<TestFixtureContext> {
  const userId = await createSyntheticUser(pool, `User ${prefix}`, prefix);
  const atlassianAccountId = `atlassian-${randomUUID()}`;
  const accountId = await connectSyntheticJiraAccount(pool, userId, atlassianAccountId);

  const grantRes = await pool.query<{ id: string }>(
    `INSERT INTO jira_oauth_grants (
      account_id, app_client_id, grant_kind, refresh_state, status, token_version
    ) VALUES ($1, 'atlassian_3lo', '3lo', 'idle', 'active', 1)
    RETURNING id`,
    [accountId]
  );
  const grantId = grantRes.rows[0]!.id;

  const cloudId = `cloud-${randomUUID().slice(0, 8)}`;
  await pool.query(
    `INSERT INTO jira_grant_sites (
      grant_id, cloud_id, site_name, site_url, product_type, scopes, last_verified_at
    ) VALUES ($1, $2, $3, $4, 'jira', $5, clock_timestamp())`,
    [
      grantId,
      cloudId,
      `Site ${prefix}`,
      `https://${prefix}.atlassian.net`,
      ['read:jira-work', 'write:jira-work'],
    ]
  );

  const workspaceId = randomUUID();
  const inviteCode = `ATI-${randomUUID().slice(0, 4)}-${randomUUID().slice(0, 4)}`.toUpperCase();
  const slug = `ws-${randomUUID().slice(0, 8)}`;

  await pool.query(
    `INSERT INTO workspaces (id, name, invite_code, require_approval, created_by)
     VALUES ($1, $2, $3, true, $4)`,
    [workspaceId, `Workspace ${prefix}`, inviteCode, userId]
  );

  await pool.query(
    `INSERT INTO ati_workspaces (id, slug, status, version, created_by)
     VALUES ($1, $2, 'active', 1, $3)`,
    [workspaceId, slug, userId]
  );

  await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role, status)
     VALUES ($1, $2, 'admin', 'active')`,
    [workspaceId, userId]
  );

  await pool.query(
    `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version)
     VALUES ($1, $2, 'admin', 'active', 1)`,
    [workspaceId, userId]
  );

  const siteRes = await pool.query<{ id: string }>(
    `INSERT INTO ati_workspace_jira_sites (
      workspace_id, cloud_id, site_name, site_url, active, policy_version, linked_by, verified_admin_by, admin_verified_at
    ) VALUES ($1, $2, $3, $4, true, 1, $5, $5, clock_timestamp())
    RETURNING id`,
    [workspaceId, cloudId, `Site ${prefix}`, `https://${prefix}.atlassian.net`, userId]
  );
  const siteId = siteRes.rows[0]!.id;

  const projectId = '10001';
  const projectKey = 'TEST';
  await pool.query(
    `INSERT INTO ati_workspace_jira_projects (
      workspace_id, site_id, cloud_id, numeric_project_id, project_key, project_name, selected, policy_version
    ) VALUES ($1, $2, $3, $4, $5, $6, true, 1)`,
    [workspaceId, siteId, cloudId, projectId, projectKey, 'Test Project']
  );

  return {
    userId,
    workspaceId,
    accountId,
    atlassianAccountId,
    grantId,
    cloudId,
    siteId,
    projectId,
    projectKey,
  };
}

async function addSecondSite(
  pool: pg.Pool,
  fixture: TestFixtureContext,
  prefix = 'site2'
): Promise<{ cloudId: string; siteId: string }> {
  const cloudId = `cloud-${randomUUID().slice(0, 8)}`;
  await pool.query(
    `INSERT INTO jira_grant_sites (
      grant_id, cloud_id, site_name, site_url, product_type, scopes, last_verified_at
    ) VALUES ($1, $2, $3, $4, 'jira', $5, clock_timestamp())`,
    [
      fixture.grantId,
      cloudId,
      `Site ${prefix}`,
      `https://${prefix}.atlassian.net`,
      ['read:jira-work', 'write:jira-work'],
    ]
  );

  const siteRes = await pool.query<{ id: string }>(
    `INSERT INTO ati_workspace_jira_sites (
      workspace_id, cloud_id, site_name, site_url, active, policy_version, linked_by, verified_admin_by, admin_verified_at
    ) VALUES ($1, $2, $3, $4, true, 1, $5, $5, clock_timestamp())
    RETURNING id`,
    [fixture.workspaceId, cloudId, `Site ${prefix}`, `https://${prefix}.atlassian.net`, fixture.userId]
  );
  return { cloudId, siteId: siteRes.rows[0]!.id };
}

async function addSecondUser(
  pool: pg.Pool,
  fixture: TestFixtureContext,
  prefix = 'user2'
): Promise<{ userId: string; accountId: string; grantId: string }> {
  const userId = await createSyntheticUser(pool, `User ${prefix}`, prefix);
  const atlassianAccountId = `atlassian-${randomUUID()}`;
  const accountId = await connectSyntheticJiraAccount(pool, userId, atlassianAccountId);

  const grantRes = await pool.query<{ id: string }>(
    `INSERT INTO jira_oauth_grants (
      account_id, app_client_id, grant_kind, refresh_state, status, token_version
    ) VALUES ($1, 'atlassian_3lo', '3lo', 'idle', 'active', 1)
    RETURNING id`,
    [accountId]
  );
  const grantId = grantRes.rows[0]!.id;

  await pool.query(
    `INSERT INTO jira_grant_sites (
      grant_id, cloud_id, site_name, site_url, product_type, scopes, last_verified_at
    ) VALUES ($1, $2, $3, $4, 'jira', $5, clock_timestamp())`,
    [
      grantId,
      fixture.cloudId,
      `Site ${prefix}`,
      `https://${prefix}.atlassian.net`,
      ['read:jira-work', 'write:jira-work'],
    ]
  );

  await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role, status)
     VALUES ($1, $2, 'member', 'active')`,
    [fixture.workspaceId, userId]
  );

  await pool.query(
    `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version)
     VALUES ($1, $2, 'member', 'active', 1)`,
    [fixture.workspaceId, userId]
  );

  return { userId, accountId, grantId };
}

describe('JiraLeaseManager (JIRA-05 Task 3 Real PostgreSQL Tests)', () => {
  let ctx: IsolatedTestContext;
  let defaultFixture: TestFixtureContext;

  beforeAll(async () => {
    ctx = await createIsolatedTestSchema({ maxConnections: 10 });
    await ctx.runAllMigrations();
    defaultFixture = await seedJiraWorkspaceFixture(ctx.pool, 'init_lease_mgr');
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  // ==========================================================================
  // Suite 1: Lease Acquisition & Immediate Short-Transaction Commit
  // ==========================================================================
  describe('Suite 1: Lease Acquisition & Immediate Short-Transaction Commit', () => {
    it('acquires authorization lease, commits short transaction immediately, and persists active row in PostgreSQL', async () => {
      const stubTokenManager = createStubTokenManager();
      const leaseManager = new JiraLeaseManager({ pool: ctx.pool, tokenManager: stubTokenManager });

      const lease = await leaseManager.acquireLease({
        userId: defaultFixture.userId,
        workspaceId: defaultFixture.workspaceId,
        cloudId: defaultFixture.cloudId,
      });

      // Assert lease matches contract and passes schema validator
      const validated = validateJiraAuthorizationLease(lease);
      expect(validated.leaseId).toBe(lease.leaseId);
      expect(validated.workspaceId).toBe(defaultFixture.workspaceId);
      expect(validated.cloudId).toBe(defaultFixture.cloudId);
      expect(validated.ttlMs).toBe(15000);
      expect(validated.binding.atiUserId).toBe(defaultFixture.userId);
      expect(validated.binding.jiraAccountId).toBe(defaultFixture.accountId);
      expect(validated.binding.atlassianAccountId).toBe(defaultFixture.atlassianAccountId);
      expect(validated.binding.workspaceId).toBe(defaultFixture.workspaceId);
      expect(validated.binding.grantId).toBe(defaultFixture.grantId);

      // Verify row is already committed in database and accessible outside the acquisition transaction
      const checkRes = await ctx.pool.query<JiraAuthorizationLeaseRow>(
        `SELECT * FROM jira_authorization_leases WHERE lease_id = $1`,
        [lease.leaseId]
      );
      expect(checkRes.rowCount).toBe(1);
      const row = checkRes.rows[0]!;
      expect(row.status).toBe('active');
      expect(row.released_at).toBeNull();
      expect(row.ttl_ms).toBe(15000);
      expect(row.workspace_id).toBe(defaultFixture.workspaceId);
      expect(row.cloud_id).toBe(defaultFixture.cloudId);
      expect(row.ati_user_id).toBe(defaultFixture.userId);
      expect(row.jira_account_id).toBe(defaultFixture.accountId);
      expect(row.grant_id).toBe(defaultFixture.grantId);

      const diffMs = row.expires_at.getTime() - row.acquired_at.getTime();
      expect(diffMs).toBeGreaterThanOrEqual(14900);
      expect(diffMs).toBeLessThanOrEqual(15100);
    });

    it('supports custom ttlMs parameter within boundary limits (5000ms and 60000ms)', async () => {
      const leaseManager = new JiraLeaseManager({
        pool: ctx.pool,
        tokenManager: createStubTokenManager(),
      });

      const lease5s = await leaseManager.acquireLease({
        userId: defaultFixture.userId,
        workspaceId: defaultFixture.workspaceId,
        cloudId: defaultFixture.cloudId,
        ttlMs: 5000,
      });
      expect(lease5s.ttlMs).toBe(5000);

      const check5s = await ctx.pool.query<JiraAuthorizationLeaseRow>(
        `SELECT ttl_ms, acquired_at, expires_at FROM jira_authorization_leases WHERE lease_id = $1`,
        [lease5s.leaseId]
      );
      expect(check5s.rows[0]!.ttl_ms).toBe(5000);

      const lease60s = await leaseManager.acquireLease({
        userId: defaultFixture.userId,
        workspaceId: defaultFixture.workspaceId,
        cloudId: defaultFixture.cloudId,
        ttlMs: 60000,
      });
      expect(lease60s.ttlMs).toBe(60000);

      const check60s = await ctx.pool.query<JiraAuthorizationLeaseRow>(
        `SELECT ttl_ms FROM jira_authorization_leases WHERE lease_id = $1`,
        [lease60s.leaseId]
      );
      expect(check60s.rows[0]!.ttl_ms).toBe(60000);
    });

    it('rejects invalid ttlMs (0, negative, or exceeding 60000ms) fail-closed', async () => {
      const leaseManager = new JiraLeaseManager({
        pool: ctx.pool,
        tokenManager: createStubTokenManager(),
      });

      await expect(
        leaseManager.acquireLease({
          userId: defaultFixture.userId,
          workspaceId: defaultFixture.workspaceId,
          cloudId: defaultFixture.cloudId,
          ttlMs: 0,
        })
      ).rejects.toThrow();

      await expect(
        leaseManager.acquireLease({
          userId: defaultFixture.userId,
          workspaceId: defaultFixture.workspaceId,
          cloudId: defaultFixture.cloudId,
          ttlMs: -100,
        })
      ).rejects.toThrow();

      await expect(
        leaseManager.acquireLease({
          userId: defaultFixture.userId,
          workspaceId: defaultFixture.workspaceId,
          cloudId: defaultFixture.cloudId,
          ttlMs: 60001,
        })
      ).rejects.toThrow();
    });

    it('respects AbortSignal passed to acquireLease without committing orphan rows', async () => {
      const leaseManager = new JiraLeaseManager({
        pool: ctx.pool,
        tokenManager: createStubTokenManager(),
      });
      const controller = new AbortController();
      controller.abort(new Error('Caller cancelled lease acquisition'));

      const beforeCount = await ctx.pool.query<{ count: string }>(
        `SELECT count(*)::text as count FROM jira_authorization_leases`
      );

      await expect(
        leaseManager.acquireLease({
          userId: defaultFixture.userId,
          workspaceId: defaultFixture.workspaceId,
          cloudId: defaultFixture.cloudId,
          signal: controller.signal,
        })
      ).rejects.toThrow(/cancelled|abort/i);

      const afterCount = await ctx.pool.query<{ count: string }>(
        `SELECT count(*)::text as count FROM jira_authorization_leases`
      );
      expect(afterCount.rows[0]!.count).toBe(beforeCount.rows[0]!.count);
    });
  });

  // ==========================================================================
  // Suite 2: Snapshot Versions & Strict Authorization Checks
  // ==========================================================================
  describe('Suite 2: Snapshot Versions & Strict Authorization Checks', () => {
    it('captures exact snapshot versions for site-level lease (project_id null)', async () => {
      const fixture = await seedJiraWorkspaceFixture(ctx.pool, 'snap_site');
      const leaseManager = new JiraLeaseManager({ pool: ctx.pool, tokenManager: createStubTokenManager() });

      const lease = await leaseManager.acquireLease({
        userId: fixture.userId,
        workspaceId: fixture.workspaceId,
        cloudId: fixture.cloudId,
      });

      const rowRes = await ctx.pool.query<JiraAuthorizationLeaseRow>(
        `SELECT * FROM jira_authorization_leases WHERE lease_id = $1`,
        [lease.leaseId]
      );
      const row = rowRes.rows[0]!;
      expect(row.membership_version).toBe(1);
      expect(row.identity_version).toBe(1);
      expect(row.workspace_version).toBe(1);
      expect(row.site_policy_version).toBe(1);
      expect(row.project_id).toBeNull();
      expect(row.project_policy_version).toBeNull();

      expect(lease.binding.membershipVersion).toBe(1);
      expect(lease.binding.identityVersion).toBe(1);
    });

    it('captures exact snapshot versions for project-level lease', async () => {
      const fixture = await seedJiraWorkspaceFixture(ctx.pool, 'snap_proj');
      const leaseManager = new JiraLeaseManager({ pool: ctx.pool, tokenManager: createStubTokenManager() });

      const lease = await leaseManager.acquireLease({
        userId: fixture.userId,
        workspaceId: fixture.workspaceId,
        cloudId: fixture.cloudId,
        projectId: fixture.projectId,
      });

      const rowRes = await ctx.pool.query<JiraAuthorizationLeaseRow>(
        `SELECT * FROM jira_authorization_leases WHERE lease_id = $1`,
        [lease.leaseId]
      );
      const row = rowRes.rows[0]!;
      expect(row.project_id).toBe(fixture.projectId);
      expect(row.project_policy_version).toBe(1);
    });

    it('fails closed when ati_workspaces is inactive or archived', async () => {
      const fixture = await seedJiraWorkspaceFixture(ctx.pool, 'archived_ws');
      await ctx.pool.query(
        `UPDATE ati_workspaces SET status = 'archived' WHERE id = $1`,
        [fixture.workspaceId]
      );

      const leaseManager = new JiraLeaseManager({ pool: ctx.pool, tokenManager: createStubTokenManager() });
      await expect(
        leaseManager.acquireLease({
          userId: fixture.userId,
          workspaceId: fixture.workspaceId,
          cloudId: fixture.cloudId,
        })
      ).rejects.toThrow();
    });

    it('fails closed when ati_workspace_memberships is removed or inactive', async () => {
      const fixture = await seedJiraWorkspaceFixture(ctx.pool, 'removed_mem');
      await ctx.pool.query(
        `UPDATE ati_workspace_memberships SET status = 'removed' WHERE workspace_id = $1 AND user_id = $2`,
        [fixture.workspaceId, fixture.userId]
      );

      const leaseManager = new JiraLeaseManager({ pool: ctx.pool, tokenManager: createStubTokenManager() });
      await expect(
        leaseManager.acquireLease({
          userId: fixture.userId,
          workspaceId: fixture.workspaceId,
          cloudId: fixture.cloudId,
        })
      ).rejects.toThrow();
    });

    it('fails closed when general workspace_members membership is disabled', async () => {
      const fixture = await seedJiraWorkspaceFixture(ctx.pool, 'dis_mem');
      await ctx.pool.query(
        `UPDATE workspace_members SET status = 'disabled' WHERE workspace_id = $1 AND user_id = $2`,
        [fixture.workspaceId, fixture.userId]
      );

      const leaseManager = new JiraLeaseManager({ pool: ctx.pool, tokenManager: createStubTokenManager() });
      await expect(
        leaseManager.acquireLease({
          userId: fixture.userId,
          workspaceId: fixture.workspaceId,
          cloudId: fixture.cloudId,
        })
      ).rejects.toThrow();
    });

    it('fails closed when jira_accounts status is disconnected', async () => {
      const fixture = await seedJiraWorkspaceFixture(ctx.pool, 'disconn_acct');
      await ctx.pool.query(
        `UPDATE jira_accounts SET status = 'disconnected' WHERE id = $1`,
        [fixture.accountId]
      );

      const leaseManager = new JiraLeaseManager({ pool: ctx.pool, tokenManager: createStubTokenManager() });
      await expect(
        leaseManager.acquireLease({
          userId: fixture.userId,
          workspaceId: fixture.workspaceId,
          cloudId: fixture.cloudId,
        })
      ).rejects.toThrow();
    });

    it('fails closed when jira_oauth_grants is revoked or reconnect_required', async () => {
      const fixture = await seedJiraWorkspaceFixture(ctx.pool, 'rev_grant');
      await ctx.pool.query(
        `UPDATE jira_oauth_grants SET status = 'revoked' WHERE id = $1`,
        [fixture.grantId]
      );

      const leaseManager = new JiraLeaseManager({ pool: ctx.pool, tokenManager: createStubTokenManager() });
      await expect(
        leaseManager.acquireLease({
          userId: fixture.userId,
          workspaceId: fixture.workspaceId,
          cloudId: fixture.cloudId,
        })
      ).rejects.toThrow();
    });

    it('fails closed when ati_workspace_jira_sites active = false (site deactivated)', async () => {
      const fixture = await seedJiraWorkspaceFixture(ctx.pool, 'deact_site');
      await ctx.pool.query(
        `UPDATE ati_workspace_jira_sites SET active = false WHERE id = $1`,
        [fixture.siteId]
      );

      const leaseManager = new JiraLeaseManager({ pool: ctx.pool, tokenManager: createStubTokenManager() });
      await expect(
        leaseManager.acquireLease({
          userId: fixture.userId,
          workspaceId: fixture.workspaceId,
          cloudId: fixture.cloudId,
        })
      ).rejects.toThrow();
    });

    it('fails closed when cloudId is not in user jira_grant_sites', async () => {
      const fixture = await seedJiraWorkspaceFixture(ctx.pool, 'ungranted_cloud');
      const leaseManager = new JiraLeaseManager({ pool: ctx.pool, tokenManager: createStubTokenManager() });

      await expect(
        leaseManager.acquireLease({
          userId: fixture.userId,
          workspaceId: fixture.workspaceId,
          cloudId: 'cloud-foreign-not-granted',
        })
      ).rejects.toThrow();
    });

    it('fails closed when requested projectId is unselected or does not exist', async () => {
      const fixture = await seedJiraWorkspaceFixture(ctx.pool, 'unsel_proj');
      await ctx.pool.query(
        `UPDATE ati_workspace_jira_projects SET selected = false WHERE numeric_project_id = $1`,
        [fixture.projectId]
      );

      const leaseManager = new JiraLeaseManager({ pool: ctx.pool, tokenManager: createStubTokenManager() });

      // Project marked unselected
      await expect(
        leaseManager.acquireLease({
          userId: fixture.userId,
          workspaceId: fixture.workspaceId,
          cloudId: fixture.cloudId,
          projectId: fixture.projectId,
        })
      ).rejects.toThrow();

      // Project non-existent
      await expect(
        leaseManager.acquireLease({
          userId: fixture.userId,
          workspaceId: fixture.workspaceId,
          cloudId: fixture.cloudId,
          projectId: '99999',
        })
      ).rejects.toThrow();
    });
  });

  // ==========================================================================
  // Suite 3: Revocation Marking & Revalidation (Fail-Closed Semantics)
  // ==========================================================================
  describe('Suite 3: Revocation Marking & Revalidation (Fail-Closed Semantics)', () => {
    it('invalidates an existing lease when the site policy changes before explicit markRevoked', async () => {
      const fixture = await seedJiraWorkspaceFixture(ctx.pool, 'reval_site_change');
      const leaseManager = new JiraLeaseManager({ pool: ctx.pool, tokenManager: createStubTokenManager() });
      const lease = await leaseManager.acquireLease({ userId: fixture.userId, workspaceId: fixture.workspaceId, cloudId: fixture.cloudId });
      await ctx.pool.query('UPDATE ati_workspace_jira_sites SET active = false, policy_version = policy_version + 1 WHERE id = $1', [fixture.siteId]);
      const result = await leaseManager.revalidateLease(lease.leaseId);
      expect(result.valid).toBe(false);
    });
    it('marks active leases revoked in the same transaction that archives a Jira workspace', async () => {
      const fixture = await seedJiraWorkspaceFixture(ctx.pool, 'archive_revocation');
      const sysAdmin = await createSyntheticUser(ctx.pool, 'System Admin', 'archive_sys', { role: 'admin' });
      const leaseManager = new JiraLeaseManager({ pool: ctx.pool, tokenManager: createStubTokenManager() });
      const lease = await leaseManager.acquireLease({ userId: fixture.userId, workspaceId: fixture.workspaceId, cloudId: fixture.cloudId });
      await new WorkspaceRepo(ctx.pool).archiveWorkspace(sysAdmin, fixture.workspaceId, 1);
      const row = await ctx.pool.query<{ status: string }>('SELECT status FROM jira_authorization_leases WHERE lease_id = $1', [lease.leaseId]);
      expect(row.rows[0]!.status).toBe('revoked');
    });
    it('marks active leases revoked when their Jira account disconnects', async () => {
      const fixture = await seedJiraWorkspaceFixture(ctx.pool, 'disconnect_revocation');
      const leaseManager = new JiraLeaseManager({ pool: ctx.pool, tokenManager: createStubTokenManager() });
      const lease = await leaseManager.acquireLease({ userId: fixture.userId, workspaceId: fixture.workspaceId, cloudId: fixture.cloudId });
      await new JiraOAuthRepo(ctx.pool, '01234567890123456789012345678901').disconnect(fixture.userId);
      const row = await ctx.pool.query<{ status: string }>('SELECT status FROM jira_authorization_leases WHERE lease_id = $1', [lease.leaseId]);
      expect(row.rows[0]!.status).toBe('revoked');
    });
    it('marks active leases revoked when an admin deactivates their Jira site', async () => {
      const fixture = await seedJiraWorkspaceFixture(ctx.pool, 'site_deactivate_revocation');
      const leaseManager = new JiraLeaseManager({ pool: ctx.pool, tokenManager: createStubTokenManager() });
      const lease = await leaseManager.acquireLease({ userId: fixture.userId, workspaceId: fixture.workspaceId, cloudId: fixture.cloudId });
      await new WorkspaceRepo(ctx.pool).updateSite(fixture.workspaceId, fixture.userId, fixture.siteId, { expectedPolicyVersion: 1, active: false });
      const row = await ctx.pool.query<{ status: string }>('SELECT status FROM jira_authorization_leases WHERE lease_id = $1', [lease.leaseId]);
      expect(row.rows[0]!.status).toBe('revoked');
    });
    it('marks only the removed member leases revoked in the membership decision transaction', async () => {
      const fixture = await seedJiraWorkspaceFixture(ctx.pool, 'member_remove_revocation');
      const member = await addSecondUser(ctx.pool, fixture, 'member_remove_target');
      const leaseManager = new JiraLeaseManager({ pool: ctx.pool, tokenManager: createStubTokenManager() });
      const memberLease = await leaseManager.acquireLease({ userId: member.userId, workspaceId: fixture.workspaceId, cloudId: fixture.cloudId });
      const adminLease = await leaseManager.acquireLease({ userId: fixture.userId, workspaceId: fixture.workspaceId, cloudId: fixture.cloudId });
      await new WorkspaceRepo(ctx.pool).decideMember(fixture.workspaceId, fixture.userId, member.userId, { decision: 'remove', expectedVersion: 1 });
      const rows = await ctx.pool.query<{ lease_id: string; status: string }>('SELECT lease_id, status FROM jira_authorization_leases WHERE lease_id = ANY($1)', [[memberLease.leaseId, adminLease.leaseId]]);
      expect(rows.rows.find((r) => r.lease_id === memberLease.leaseId)?.status).toBe('revoked');
      expect(rows.rows.find((r) => r.lease_id === adminLease.leaseId)?.status).toBe('active');
    });
    it('marks site leases revoked when an admin deselects its projects', async () => {
      const fixture = await seedJiraWorkspaceFixture(ctx.pool, 'project_deselect_revocation');
      const leaseManager = new JiraLeaseManager({ pool: ctx.pool, tokenManager: createStubTokenManager() });
      const lease = await leaseManager.acquireLease({ userId: fixture.userId, workspaceId: fixture.workspaceId, cloudId: fixture.cloudId, projectId: fixture.projectId });
      const repo = new WorkspaceRepo(ctx.pool, { verifier: { verifyAdminister: async () => ({
        status: 'granted', siteName: 'Test Site', siteUrl: 'https://test.atlassian.net',
        verifiedProjectIds: [fixture.projectId], verifiedProjects: [{ projectId: fixture.projectId, key: fixture.projectKey, name: 'Test Project' }],
      }) } });
      await repo.configureProjects(fixture.workspaceId, fixture.userId, fixture.siteId, { expectedPolicyVersion: 1, selectedProjectIds: [] });
      const row = await ctx.pool.query<{ status: string }>('SELECT status FROM jira_authorization_leases WHERE lease_id = $1', [lease.leaseId]);
      expect(row.rows[0]!.status).toBe('revoked');
    });
    it('marks active leases as revoked by workspaceId and records released_at timestamp', async () => {
      const fixtureA = await seedJiraWorkspaceFixture(ctx.pool, 'rev_ws_a');
      const fixtureB = await seedJiraWorkspaceFixture(ctx.pool, 'rev_ws_b');
      const leaseManager = new JiraLeaseManager({ pool: ctx.pool, tokenManager: createStubTokenManager() });

      const leaseA1 = await leaseManager.acquireLease({
        userId: fixtureA.userId,
        workspaceId: fixtureA.workspaceId,
        cloudId: fixtureA.cloudId,
      });
      const leaseA2 = await leaseManager.acquireLease({
        userId: fixtureA.userId,
        workspaceId: fixtureA.workspaceId,
        cloudId: fixtureA.cloudId,
      });
      const leaseB = await leaseManager.acquireLease({
        userId: fixtureB.userId,
        workspaceId: fixtureB.workspaceId,
        cloudId: fixtureB.cloudId,
      });

      const count = await leaseManager.markRevoked({ workspaceId: fixtureA.workspaceId });
      expect(count).toBe(2);

      const checkA1 = await ctx.pool.query<JiraAuthorizationLeaseRow>(
        `SELECT status, released_at FROM jira_authorization_leases WHERE lease_id = $1`,
        [leaseA1.leaseId]
      );
      expect(checkA1.rows[0]!.status).toBe('revoked');
      expect(checkA1.rows[0]!.released_at).toBeInstanceOf(Date);

      const checkA2 = await ctx.pool.query<JiraAuthorizationLeaseRow>(
        `SELECT status, released_at FROM jira_authorization_leases WHERE lease_id = $1`,
        [leaseA2.leaseId]
      );
      expect(checkA2.rows[0]!.status).toBe('revoked');

      // Workspace B lease is untouched
      const checkB = await ctx.pool.query<JiraAuthorizationLeaseRow>(
        `SELECT status, released_at FROM jira_authorization_leases WHERE lease_id = $1`,
        [leaseB.leaseId]
      );
      expect(checkB.rows[0]!.status).toBe('active');
      expect(checkB.rows[0]!.released_at).toBeNull();
    });

    it('marks active leases as revoked targeted by cloudId (site deactivation)', async () => {
      const fixture = await seedJiraWorkspaceFixture(ctx.pool, 'rev_site');
      const secondSite = await addSecondSite(ctx.pool, fixture, 'site_target');
      const leaseManager = new JiraLeaseManager({ pool: ctx.pool, tokenManager: createStubTokenManager() });

      const leaseSite1 = await leaseManager.acquireLease({
        userId: fixture.userId,
        workspaceId: fixture.workspaceId,
        cloudId: fixture.cloudId,
      });
      const leaseSite2 = await leaseManager.acquireLease({
        userId: fixture.userId,
        workspaceId: fixture.workspaceId,
        cloudId: secondSite.cloudId,
      });

      const count = await leaseManager.markRevoked({
        workspaceId: fixture.workspaceId,
        cloudId: fixture.cloudId,
      });
      expect(count).toBe(1);

      const check1 = await ctx.pool.query<JiraAuthorizationLeaseRow>(
        `SELECT status FROM jira_authorization_leases WHERE lease_id = $1`,
        [leaseSite1.leaseId]
      );
      expect(check1.rows[0]!.status).toBe('revoked');

      const check2 = await ctx.pool.query<JiraAuthorizationLeaseRow>(
        `SELECT status FROM jira_authorization_leases WHERE lease_id = $1`,
        [leaseSite2.leaseId]
      );
      expect(check2.rows[0]!.status).toBe('active');
    });

    it('marks active leases as revoked targeted by userId (member removal)', async () => {
      const fixture = await seedJiraWorkspaceFixture(ctx.pool, 'rev_user');
      const secondUser = await addSecondUser(ctx.pool, fixture, 'user_target');
      const leaseManager = new JiraLeaseManager({ pool: ctx.pool, tokenManager: createStubTokenManager() });

      const leaseUser1 = await leaseManager.acquireLease({
        userId: fixture.userId,
        workspaceId: fixture.workspaceId,
        cloudId: fixture.cloudId,
      });
      const leaseUser2 = await leaseManager.acquireLease({
        userId: secondUser.userId,
        workspaceId: fixture.workspaceId,
        cloudId: fixture.cloudId,
      });

      const count = await leaseManager.markRevoked({
        workspaceId: fixture.workspaceId,
        userId: fixture.userId,
      });
      expect(count).toBe(1);

      const check1 = await ctx.pool.query<JiraAuthorizationLeaseRow>(
        `SELECT status FROM jira_authorization_leases WHERE lease_id = $1`,
        [leaseUser1.leaseId]
      );
      expect(check1.rows[0]!.status).toBe('revoked');

      const check2 = await ctx.pool.query<JiraAuthorizationLeaseRow>(
        `SELECT status FROM jira_authorization_leases WHERE lease_id = $1`,
        [leaseUser2.leaseId]
      );
      expect(check2.rows[0]!.status).toBe('active');
    });

    it('revalidateLease returns valid: true for active unexpired lease', async () => {
      const fixture = await seedJiraWorkspaceFixture(ctx.pool, 'reval_valid');
      const leaseManager = new JiraLeaseManager({ pool: ctx.pool, tokenManager: createStubTokenManager() });

      const lease = await leaseManager.acquireLease({
        userId: fixture.userId,
        workspaceId: fixture.workspaceId,
        cloudId: fixture.cloudId,
      });

      const result = await leaseManager.revalidateLease(lease.leaseId);
      expect(result.valid).toBe(true);
      expect(result.status).toBe('active');
    });

    it('revalidateLease returns fail-closed (valid: false, status: revoked) after lease is revoked', async () => {
      const fixture = await seedJiraWorkspaceFixture(ctx.pool, 'reval_rev');
      const leaseManager = new JiraLeaseManager({ pool: ctx.pool, tokenManager: createStubTokenManager() });

      const lease = await leaseManager.acquireLease({
        userId: fixture.userId,
        workspaceId: fixture.workspaceId,
        cloudId: fixture.cloudId,
      });

      await leaseManager.markRevoked({ workspaceId: fixture.workspaceId });

      const result = await leaseManager.revalidateLease(lease.leaseId);
      expect(result.valid).toBe(false);
      expect(result.status).toBe('revoked');
    });

    it('revalidateLease returns fail-closed for non-existent leaseId', async () => {
      const leaseManager = new JiraLeaseManager({ pool: ctx.pool, tokenManager: createStubTokenManager() });

      const result = await leaseManager.revalidateLease('non-existent-lease-uuid');
      expect(result.valid).toBe(false);
    });

    it('revalidateLease returns fail-closed for expired lease without requiring reaper invocation', async () => {
      const fixture = await seedJiraWorkspaceFixture(ctx.pool, 'reval_exp');
      const leaseManager = new JiraLeaseManager({ pool: ctx.pool, tokenManager: createStubTokenManager() });

      const lease = await leaseManager.acquireLease({
        userId: fixture.userId,
        workspaceId: fixture.workspaceId,
        cloudId: fixture.cloudId,
      });

      // Force expires_at into the past in database
      await ctx.pool.query(
        `UPDATE jira_authorization_leases
         SET acquired_at = clock_timestamp() - interval '17 seconds',
             expires_at = clock_timestamp() - interval '2 seconds'
         WHERE lease_id = $1`,
        [lease.leaseId]
      );

      const result = await leaseManager.revalidateLease(lease.leaseId);
      expect(result.valid).toBe(false);
      expect(result.status).toBe('expired');
    });
  });

  // ==========================================================================
  // Suite 4: Reaper for Expired Leases
  // ==========================================================================
  describe('Suite 4: Reaper for Expired Leases', () => {
    it('reapExpiredLeases updates past-expiry active leases to expired and sets released_at', async () => {
      const fixture = await seedJiraWorkspaceFixture(ctx.pool, 'reaper_test');
      const leaseManager = new JiraLeaseManager({ pool: ctx.pool, tokenManager: createStubTokenManager() });

      // Lease 1: Active and valid in future
      const leaseActive = await leaseManager.acquireLease({
        userId: fixture.userId,
        workspaceId: fixture.workspaceId,
        cloudId: fixture.cloudId,
        ttlMs: 30000,
      });

      // Lease 2: Expired active lease
      const leaseExpired = await leaseManager.acquireLease({
        userId: fixture.userId,
        workspaceId: fixture.workspaceId,
        cloudId: fixture.cloudId,
        ttlMs: 15000,
      });
      await ctx.pool.query(
        `UPDATE jira_authorization_leases
         SET acquired_at = clock_timestamp() - interval '20 seconds',
             expires_at = clock_timestamp() - interval '5 seconds'
         WHERE lease_id = $1`,
        [leaseExpired.leaseId]
      );

      // Lease 3: Already revoked
      const leaseRevoked = await leaseManager.acquireLease({
        userId: fixture.userId,
        workspaceId: fixture.workspaceId,
        cloudId: fixture.cloudId,
      });
      await ctx.pool.query(
        `UPDATE jira_authorization_leases
         SET status = 'revoked', released_at = clock_timestamp()
         WHERE lease_id = $1`,
        [leaseRevoked.leaseId]
      );

      // Execute reaper
      const reapedCount = await leaseManager.reapExpiredLeases();
      expect(reapedCount).toBeGreaterThanOrEqual(1);

      // Verify Lease 2 is now expired
      const checkExpired = await ctx.pool.query<JiraAuthorizationLeaseRow>(
        `SELECT status, released_at FROM jira_authorization_leases WHERE lease_id = $1`,
        [leaseExpired.leaseId]
      );
      expect(checkExpired.rows[0]!.status).toBe('expired');
      expect(checkExpired.rows[0]!.released_at).toBeInstanceOf(Date);

      // Verify Lease 1 remains active
      const checkActive = await ctx.pool.query<JiraAuthorizationLeaseRow>(
        `SELECT status, released_at FROM jira_authorization_leases WHERE lease_id = $1`,
        [leaseActive.leaseId]
      );
      expect(checkActive.rows[0]!.status).toBe('active');
      expect(checkActive.rows[0]!.released_at).toBeNull();

      // Verify Lease 3 remains revoked
      const checkRevoked = await ctx.pool.query<JiraAuthorizationLeaseRow>(
        `SELECT status FROM jira_authorization_leases WHERE lease_id = $1`,
        [leaseRevoked.leaseId]
      );
      expect(checkRevoked.rows[0]!.status).toBe('revoked');
    });

    it('reapExpiredLeases is idempotent and returns 0 when no leases are expired', async () => {
      const leaseManager = new JiraLeaseManager({ pool: ctx.pool, tokenManager: createStubTokenManager() });

      // Run once to clear any remaining expired rows
      await leaseManager.reapExpiredLeases();

      // Immediate second call should reap 0 rows
      const secondRun = await leaseManager.reapExpiredLeases();
      expect(secondRun).toBe(0);
    });
  });

  // ==========================================================================
  // Suite 5: Two-Connection Concurrent Revocation Semantics
  // ==========================================================================
  describe('Suite 5: Two-Connection Concurrent Revocation Semantics', () => {
    it('committed lease does NOT block concurrent revocation transaction from completing immediately', async () => {
      const fixture = await seedJiraWorkspaceFixture(ctx.pool, 'conc_rev');
      const leaseManager = new JiraLeaseManager({ pool: ctx.pool, tokenManager: createStubTokenManager() });

      // Worker 1: Acquire lease (short transaction commits immediately)
      const lease = await leaseManager.acquireLease({
        userId: fixture.userId,
        workspaceId: fixture.workspaceId,
        cloudId: fixture.cloudId,
      });
      expect(lease.leaseId).toBeDefined();

      // Worker 2: Concurrent revocation transaction (simulating admin deactivating site)
      const workerPool = ctx.createWorkerPool({ max: 1, applicationName: 'revoker_worker' });
      const client2 = await workerPool.connect();
      try {
        await client2.query('BEGIN');
        // Admin updates site policy version and sets active = false
        const updateRes = await client2.query(
          `UPDATE ati_workspace_jira_sites
           SET active = false, policy_version = policy_version + 1, updated_at = clock_timestamp()
           WHERE id = $1
           RETURNING policy_version`,
          [fixture.siteId]
        );
        expect(updateRes.rowCount).toBe(1);

        // Revoker calls markRevoked
        const revokedCount = await leaseManager.markRevoked({
          workspaceId: fixture.workspaceId,
          cloudId: fixture.cloudId,
        });
        expect(revokedCount).toBe(1);

        await client2.query('COMMIT');
      } finally {
        client2.release();
        await workerPool.end();
      }

      // Subsequent revalidateLease fails closed immediately
      const revalidation = await leaseManager.revalidateLease(lease.leaseId);
      expect(revalidation.valid).toBe(false);
      expect(revalidation.status).toBe('revoked');
    });

    it('ensures strict lock hierarchy order matches JIRA_SQL_LOCK_HIERARCHY specification', () => {
      expect(JIRA_SQL_LOCK_HIERARCHY).toEqual([
        'ati_workspaces',
        'ati_workspace_memberships',
        'jira_accounts',
        'ati_workspace_jira_sites',
        'ati_workspace_jira_projects',
      ]);
    });
  });

  // ==========================================================================
  // Suite 6: Token Manager FOR UPDATE OF g Concurrency & Deadlock Freedom
  // ==========================================================================
  describe('Suite 6: Token Manager FOR UPDATE OF g Concurrency & Deadlock Freedom', () => {
    it('proves FOR UPDATE OF g locks jira_oauth_grants but DOES NOT lock jira_accounts', async () => {
      const fixture = await seedJiraWorkspaceFixture(ctx.pool, 'lock_of_g');
      const workerPool = ctx.createWorkerPool({ max: 2, applicationName: 'token_lock_worker' });

      const client1 = await workerPool.connect();
      const client2 = await workerPool.connect();

      try {
        // Worker 1 starts transaction and simulates token refresh lock with FOR UPDATE OF g
        await client1.query('BEGIN');
        const lockRes = await client1.query(
          `SELECT
             a.id as account_id,
             a.status as account_status,
             a.identity_version,
             g.id as grant_id,
             g.status as grant_status
           FROM jira_oauth_grants g
           JOIN jira_accounts a ON a.id = g.account_id
           WHERE a.user_id = $1 AND g.id = $2
           FOR UPDATE OF g`,
          [fixture.userId, fixture.grantId]
        );
        expect(lockRes.rowCount).toBe(1);

        // Worker 2 concurrently executes the lease acquisition query on jira_accounts
        // (SELECT ... FROM jira_accounts WHERE id = $1 FOR SHARE)
        await client2.query('BEGIN');
        const start = Date.now();
        const acctRes = await client2.query(
          `SELECT id, status, identity_version
           FROM jira_accounts
           WHERE id = $1
           FOR SHARE`,
          [fixture.accountId]
        );
        const elapsed = Date.now() - start;

        // Worker 2 MUST NOT be blocked by Worker 1
        expect(acctRes.rowCount).toBe(1);
        expect(acctRes.rows[0]!.id).toBe(fixture.accountId);
        expect(elapsed).toBeLessThan(500);

        await client2.query('COMMIT');

        // Worker 2 also proves that jira_oauth_grants IS locked exclusively by Worker 1
        await client2.query('BEGIN');
        await client2.query("SET LOCAL lock_timeout = '100ms'");
        await expect(
          client2.query(
            `SELECT id FROM jira_oauth_grants WHERE id = $1 FOR UPDATE`,
            [fixture.grantId]
          )
        ).rejects.toThrow();

        await client2.query('ROLLBACK');
        await client1.query('COMMIT');
      } finally {
        client1.release();
        client2.release();
        await workerPool.end();
      }
    });

    it('proves that old query without OF g WOULD HAVE locked jira_accounts and blocked concurrent read', async () => {
      const fixture = await seedJiraWorkspaceFixture(ctx.pool, 'lock_contrast');
      const workerPool = ctx.createWorkerPool({ max: 2, applicationName: 'contrast_worker' });

      const client1 = await workerPool.connect();
      const client2 = await workerPool.connect();

      try {
        // Worker 1 executes old query without OF g
        await client1.query('BEGIN');
        await client1.query(
          `SELECT
             a.id as account_id,
             g.id as grant_id
           FROM jira_oauth_grants g
           JOIN jira_accounts a ON a.id = g.account_id
           WHERE a.user_id = $1 AND g.id = $2
           FOR UPDATE`,
          [fixture.userId, fixture.grantId]
        );

        // Worker 2 attempts FOR SHARE on jira_accounts with short lock_timeout
        await client2.query('BEGIN');
        await client2.query("SET LOCAL lock_timeout = '100ms'");
        await expect(
          client2.query(
            `SELECT id, status FROM jira_accounts WHERE id = $1 FOR SHARE`,
            [fixture.accountId]
          )
        ).rejects.toThrow();

        await client2.query('ROLLBACK');
        await client1.query('ROLLBACK');
      } finally {
        client1.release();
        client2.release();
        await workerPool.end();
      }
    });
  });
});
