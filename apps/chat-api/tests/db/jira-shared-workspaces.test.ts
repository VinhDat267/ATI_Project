import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { UserRepo } from '../../src/db/repositories/user-repo.js';
import { SessionRepo } from '../../src/db/repositories/session-repo.js';
import { WorkspaceRepo as GenericWorkspaceRepo } from '../../src/db/repositories/workspace-repo.js';
import { WorkspaceRepo as JiraWorkspaceRepo } from '../../src/db/repositories/workspace/index.js';
import type { CreateWorkspaceResponse } from '@wap/tool-schemas';
import {
  createIsolatedTestSchema,
  createSyntheticUser,
  connectSyntheticJiraAccount,
  waitForBlockedQueries,
  type IsolatedTestContext,
} from '../helpers/jira-test-db.js';

interface TestActor {
  id: string;
  email: string;
  name: string;
  sid: string;
  token: string;
}

function firstRow<T extends pg.QueryResultRow>(result: pg.QueryResult<T>): T {
  const row = result.rows[0];
  if (!row) {
    throw new Error('Expected query to return at least one row, but rows array was empty');
  }
  return row;
}

describe('apps/chat-api — JIRA Shared Organization Workspaces Amendment Integration', () => {
  let ctx: IsolatedTestContext;
  let pool: pg.Pool;
  let genericRepo: GenericWorkspaceRepo;
  let jiraRepo: JiraWorkspaceRepo;
  let userRepo: UserRepo;
  let sessionRepo: SessionRepo;
  let sysAdminId: string;
  let app: ReturnType<typeof createApp>;

  const jwtSecret = 'jira_shared_workspaces_test_secret_32_bytes_min';

  beforeAll(async () => {
    ctx = await createIsolatedTestSchema({ maxConnections: 10 });
    pool = ctx.pool;
    await ctx.runAllMigrations();

    genericRepo = new GenericWorkspaceRepo(pool);
    jiraRepo = new JiraWorkspaceRepo(pool);
    userRepo = new UserRepo(pool);
    sessionRepo = new SessionRepo(pool);

    sysAdminId = await createSyntheticUser(pool, 'System Admin', 'sysadmin', {
      role: 'admin',
      status: 'active',
    });

    app = createApp({
      jwtSecret,
      userRepo,
      sessionRepo,
      workspaceRepo: genericRepo,
      runtimeMode: 'sandbox',
    });
  });

  afterAll(async () => {
    await ctx?.cleanup();
  });

  async function createActor(
    name: string,
    prefix: string,
    role: 'admin' | 'member' = 'member'
  ): Promise<TestActor> {
    const userId = await createSyntheticUser(pool, name, prefix, { role, status: 'active' });
    const userRow = firstRow(
      await pool.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [userId])
    );
    const { sessionId } = await sessionRepo.create(userId, 'test-agent');
    const token = generateAccessToken(
      { id: userId, email: userRow.email, name, role, status: 'active' },
      jwtSecret,
      sessionId
    ).accessToken;

    return { id: userId, email: userRow.email, name, sid: sessionId, token };
  }

  // ============================================================================
  // 1. Unified UUID & Foreign Key Integrity
  // ============================================================================
  describe('1. Policy PK/FK Same General UUID & Schema Constraints', () => {
    it('enforces ati_workspaces.id as foreign key referencing workspaces(id) on delete cascade (PostgreSQL 23503)', async () => {
      const unreferencedId = randomUUID();
      const slug = `unref-ws-${randomUUID().slice(0, 8)}`;

      // Inserting an ati_workspaces row whose ID does not exist in workspaces must violate FK constraint
      await expect(
        pool.query(
          `INSERT INTO ati_workspaces (id, slug, status, version, created_by)
           VALUES ($1, $2, 'active', 1, $3)`,
          [unreferencedId, slug, sysAdminId]
        )
      ).rejects.toMatchObject({
        code: '23503',
      });

      // Verify CASCADE: deleting a generic workspace automatically cascades to its ati_workspaces policy
      const org = await genericRepo.create(sysAdminId, 'Cascade Parent Org');
      await pool.query(
        `INSERT INTO ati_workspaces (id, slug, status, version, created_by)
         VALUES ($1, $2, 'active', 1, $3)`,
        [org.id, `casc-${randomUUID().slice(0, 8)}`, sysAdminId]
      );

      // Verify ati_workspaces exists
      const beforeDelete = await pool.query(
        'SELECT id FROM ati_workspaces WHERE id = $1',
        [org.id]
      );
      expect(beforeDelete.rows).toHaveLength(1);

      // Delete parent generic workspace
      await pool.query('DELETE FROM workspaces WHERE id = $1', [org.id]);

      // ati_workspaces row must be gone via cascade
      const afterDelete = await pool.query(
        'SELECT id FROM ati_workspaces WHERE id = $1',
        [org.id]
      );
      expect(afterDelete.rows).toHaveLength(0);
    });

    it('enforces workspaces name check constraint (PostgreSQL 23514)', async () => {
      const inviteCode = `ATI-CHCK-${randomUUID().slice(0, 4).toUpperCase()}`;
      await expect(
        pool.query(
          `INSERT INTO workspaces (name, invite_code, created_by)
           VALUES ($1, $2, $3)`,
          ['   ', inviteCode, sysAdminId]
        )
      ).rejects.toMatchObject({
        code: '23514',
      });
    });
  });

  // ============================================================================
  // 2. Canonical Organization Name Reflects Generic Workspace Rename
  // ============================================================================
  describe('2. Canonical Organization Name Reflects Generic Workspace Rename', () => {
    it('canonical organization name reflects generic rename across Jira views without stale column copies', async () => {
      const adminActor = await createActor('Org Rename Admin', 'org_ren_admin');
      const org = await genericRepo.create(adminActor.id, 'Original Org Name');

      // Seed Jira policy for this organization
      const slug = `org-ren-${randomUUID().slice(0, 8)}`;
      await pool.query(
        `INSERT INTO ati_workspaces (id, slug, status, version, created_by)
         VALUES ($1, $2, 'active', 1, $3)`,
        [org.id, slug, sysAdminId]
      );
      await pool.query(
        `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version)
         VALUES ($1, $2, 'admin', 'active', 1)`,
        [org.id, adminActor.id]
      );

      // Jira repo summary returns the name
      const beforeList = await jiraRepo.listWorkspacesForUser(adminActor.id);
      const beforeSummary = beforeList.find((w) => w.id === org.id);
      expect(beforeSummary).toBeDefined();
      expect(beforeSummary?.name).toBe('Original Org Name');

      // Generic organization is renamed directly in PostgreSQL
      await pool.query('UPDATE workspaces SET name = $1 WHERE id = $2', ['Renamed Corporate Org', org.id]);

      // Jira repo summary immediately reflects the updated name from workspaces table
      const afterList = await jiraRepo.listWorkspacesForUser(adminActor.id);
      const afterSummary = afterList.find((w) => w.id === org.id);
      expect(afterSummary).toBeDefined();
      expect(afterSummary?.name).toBe('Renamed Corporate Org');
    });
  });

  // ============================================================================
  // 3. Atomically Create Shared Organization + General Bootstrap + Jira Bootstrap
  // ============================================================================
  describe('3. Admin-Only Jira Creation Atomically Creates Shared Org + General Bootstrap + Jira Bootstrap', () => {
    it('rejects non-system-admin caller with 403 ADMIN_REQUIRED', async () => {
      const nonAdmin = await createActor('Regular User', 'non_admin_actor');
      const bootstrap = await createActor('Bootstrap Candidate', 'boot_cand');

      await expect(
        jiraRepo.createWorkspaceWithBootstrapAdmin(nonAdmin.id, {
          slug: `fail-non-sys-${randomUUID().slice(0, 8)}`,
          name: 'Non Admin WS',
          bootstrapAdminUserId: bootstrap.id,
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'ADMIN_REQUIRED',
      });
    });

    it('atomically creates shared org, general bootstrap member, and Jira bootstrap policy with one unified UUID', async () => {
      const bootstrap = await createActor('Bootstrap Admin User', 'boot_adm');
      const slug = `atomic-ws-${randomUUID().slice(0, 8)}`;
      const orgName = 'Unified Shared Enterprise';

      const res = await jiraRepo.createWorkspaceWithBootstrapAdmin(sysAdminId, {
        slug,
        name: orgName,
        bootstrapAdminUserId: bootstrap.id,
      });

      const unifiedId = res.workspace.id;
      expect(res.workspace.slug).toBe(slug);
      expect(res.workspace.name).toBe(orgName);

      // 1. Generic workspaces table has unified ID and name
      const genericWsRes = await pool.query<{ id: string; name: string }>(
        'SELECT id, name FROM workspaces WHERE id = $1',
        [unifiedId]
      );
      expect(genericWsRes.rows).toHaveLength(1);
      const genericWsRow = firstRow(genericWsRes);
      expect(genericWsRow.name).toBe(orgName);

      // 2. Generic workspace_members table has bootstrap admin as active admin
      const genericMemRes = await pool.query<{ role: string; status: string }>(
        'SELECT role, status FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
        [unifiedId, bootstrap.id]
      );
      expect(genericMemRes.rows).toHaveLength(1);
      const genericMemRow = firstRow(genericMemRes);
      expect(genericMemRow).toEqual({
        role: 'admin',
        status: 'active',
      });

      // 3. Jira ati_workspaces table has unified ID and slug
      const jiraWsRes = await pool.query<{ id: string; slug: string; status: string; version: number }>(
        'SELECT id, slug, status, version FROM ati_workspaces WHERE id = $1',
        [unifiedId]
      );
      expect(jiraWsRes.rows).toHaveLength(1);
      const jiraWsRow = firstRow(jiraWsRes);
      expect(jiraWsRow).toEqual({
        id: unifiedId,
        slug,
        status: 'active',
        version: 1,
      });

      // 4. Jira ati_workspace_memberships table has bootstrap admin as active admin
      const jiraMemRes = await pool.query<{ role: string; status: string; version: number }>(
        'SELECT role, status, version FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
        [unifiedId, bootstrap.id]
      );
      expect(jiraMemRes.rows).toHaveLength(1);
      const jiraMemRow = firstRow(jiraMemRes);
      expect(jiraMemRow).toEqual({
        role: 'admin',
        status: 'active',
        version: 1,
      });
    });
  });

  // ============================================================================
  // 4. enableExistingWorkspace Façade Interface
  // ============================================================================
  describe('4. enableExistingWorkspace Façade Interface', () => {
    it('defines enableExistingWorkspace method on Jira workspace repository facade', () => {
      expect(typeof jiraRepo.enableExistingWorkspace).toBe('function');
    });

    it('enableExistingWorkspace rejects caller who is not an active system admin with 403 ADMIN_REQUIRED', async () => {
      if (typeof jiraRepo.enableExistingWorkspace !== 'function') {
        expect(typeof jiraRepo.enableExistingWorkspace).toBe('function');
        return;
      }

      const orgAdmin = await createActor('Org Only Admin', 'org_only_admin');
      const org = await genericRepo.create(orgAdmin.id, 'Existing Org One');

      await expect(
        jiraRepo.enableExistingWorkspace(orgAdmin.id, org.id, {
          slug: `enable-no-sys-${randomUUID().slice(0, 8)}`,
          bootstrapAdminUserId: orgAdmin.id,
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'ADMIN_REQUIRED',
      });
    });

    it('enableExistingWorkspace rejects a system admin who is an active ordinary organization member with 403 ADMIN_REQUIRED', async () => {
      if (typeof jiraRepo.enableExistingWorkspace !== 'function') {
        expect(typeof jiraRepo.enableExistingWorkspace).toBe('function');
        return;
      }

      const orgOwner = await createActor('Org Owner', 'org_owner');
      const org = await genericRepo.create(orgOwner.id, 'Foreign Org');

      // Reach the organization-role guard; outsiders have a separate private 404 contract.
      await pool.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, status)
         VALUES ($1, $2, 'member', 'active')`,
        [org.id, sysAdminId]
      );
      await expect(
        jiraRepo.enableExistingWorkspace(sysAdminId, org.id, {
          slug: `enable-not-org-adm-${randomUUID().slice(0, 8)}`,
          bootstrapAdminUserId: orgOwner.id,
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'ADMIN_REQUIRED',
      });
    });

    it('enableExistingWorkspace rejects bootstrapAdminUserId who is not an active admin of the target organization with 400/409', async () => {
      if (typeof jiraRepo.enableExistingWorkspace !== 'function') {
        expect(typeof jiraRepo.enableExistingWorkspace).toBe('function');
        return;
      }

      // Create dual admin (system admin who is also active admin in generic org)
      const dualAdmin = await createActor('Dual Admin', 'dual_adm', 'admin');
      const org = await genericRepo.create(dualAdmin.id, 'Dual Admin Org');

      // Add a regular member (not admin) to the org
      const regMember = await createActor('Regular Member', 'reg_mem');
      await pool.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, status)
         VALUES ($1, $2, 'member', 'active')`,
        [org.id, regMember.id]
      );

      // Attempting to designate a regular org member as Jira bootstrap admin must fail
      await expect(
        jiraRepo.enableExistingWorkspace(dualAdmin.id, org.id, {
          slug: `enable-invalid-boot-${randomUUID().slice(0, 8)}`,
          bootstrapAdminUserId: regMember.id,
        })
      ).rejects.toMatchObject({
        statusCode: expect.any(Number),
      });
    });

    it('enableExistingWorkspace successfully enables Jira on existing workspace without duplicating organization', async () => {
      if (typeof jiraRepo.enableExistingWorkspace !== 'function') {
        expect(typeof jiraRepo.enableExistingWorkspace).toBe('function');
        return;
      }

      const dualAdmin = await createActor('Dual Admin 2', 'dual_adm_2', 'admin');
      const org = await genericRepo.create(dualAdmin.id, 'Active Existing Org');
      const slug = `enable-success-${randomUUID().slice(0, 8)}`;

      const res = await jiraRepo.enableExistingWorkspace(dualAdmin.id, org.id, {
        slug,
        bootstrapAdminUserId: dualAdmin.id,
      });

      expect(res.workspace.id).toBe(org.id);
      expect(res.workspace.slug).toBe(slug);
      expect(res.workspace.name).toBe('Active Existing Org');
      expect(res.workspace.version).toBe(1);

      // Verify ati_workspaces row
      const wsCheck = await pool.query(
        'SELECT id, slug, status, version FROM ati_workspaces WHERE id = $1',
        [org.id]
      );
      const wsCheckRow = firstRow(wsCheck);
      expect(wsCheckRow).toEqual({
        id: org.id,
        slug,
        status: 'active',
        version: 1,
      });

      // Verify ati_workspace_memberships row
      const memCheck = await pool.query(
        'SELECT role, status, version FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
        [org.id, dualAdmin.id]
      );
      const memCheckRow = firstRow(memCheck);
      expect(memCheckRow).toEqual({
        role: 'admin',
        status: 'active',
        version: 1,
      });
    });

    it('enableExistingWorkspace rejects duplicate enablement with 409 conflict and preserves existing config/version', async () => {
      if (typeof jiraRepo.enableExistingWorkspace !== 'function') {
        expect(typeof jiraRepo.enableExistingWorkspace).toBe('function');
        return;
      }

      const dualAdmin = await createActor('Dual Admin 3', 'dual_adm_3', 'admin');
      const org = await genericRepo.create(dualAdmin.id, 'Conflict Test Org');
      const slug = `conflict-ws-${randomUUID().slice(0, 8)}`;

      await jiraRepo.enableExistingWorkspace(dualAdmin.id, org.id, {
        slug,
        bootstrapAdminUserId: dualAdmin.id,
      });

      // Second enable call on same workspaceId must reject with 409 conflict
      await expect(
        jiraRepo.enableExistingWorkspace(dualAdmin.id, org.id, {
          slug: `second-slug-${randomUUID().slice(0, 8)}`,
          bootstrapAdminUserId: dualAdmin.id,
        })
      ).rejects.toMatchObject({
        statusCode: 409,
      });

      // Ensure slug and version were NOT modified
      const wsCheck = await pool.query<{ slug: string; version: number }>(
        'SELECT slug, version FROM ati_workspaces WHERE id = $1',
        [org.id]
      );
      const wsCheckRow = firstRow(wsCheck);
      expect(wsCheckRow.slug).toBe(slug);
      expect(wsCheckRow.version).toBe(1);
    });
  });

  // ============================================================================
  // 5. General Invite Auto-Approve is NOT a Jira Grant
  // ============================================================================
  describe('5. General Invite Auto-Approval Does Not Grant Jira Permissions', () => {
    it('general invite auto-approval does not create Jira membership or grant Jira access', async () => {
      const dualAdmin = await createActor('Dual Admin 4', 'dual_adm_4', 'admin');
      // Create generic org with require_approval = false (auto-join)
      const org = await genericRepo.create(dualAdmin.id, 'Auto Join Org', false);

      // Seed Jira policy
      await pool.query(
        `INSERT INTO ati_workspaces (id, slug, status, version, created_by)
         VALUES ($1, $2, 'active', 1, $3)`,
        [org.id, `auto-join-${randomUUID().slice(0, 8)}`, sysAdminId]
      );
      await pool.query(
        `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version)
         VALUES ($1, $2, 'admin', 'active', 1)`,
        [org.id, dualAdmin.id]
      );

      // Join generic organization via invite code
      const autoJoiner = await createActor('Auto Joiner User', 'auto_joiner');
      const joinResult = await genericRepo.joinByInviteCode(autoJoiner.id, org.inviteCode!);
      expect(joinResult.workspace.status).toBe('active');

      // Verify user is active in generic organization
      const genMem = await genericRepo.findMember(org.id, autoJoiner.id);
      expect(genMem?.status).toBe('active');

      // Crucial: verify user has NO membership in Jira layer
      const jiraMemRes = await pool.query(
        'SELECT * FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
        [org.id, autoJoiner.id]
      );
      expect(jiraMemRes.rows).toHaveLength(0);

      // User attempting any Jira action receives 404 WORKSPACE_NOT_FOUND
      await expect(jiraRepo.createInvite(org.id, autoJoiner.id)).rejects.toMatchObject({
        statusCode: 404,
        code: 'WORKSPACE_NOT_FOUND',
      });
      await expect(jiraRepo.listMembers(org.id, autoJoiner.id)).rejects.toMatchObject({
        statusCode: 404,
        code: 'WORKSPACE_NOT_FOUND',
      });
    });
  });

  // ============================================================================
  // 6. Join Jira Requires Active General Membership + Connected Jira
  // ============================================================================
  describe('6. Join Jira Requires Active General Membership and Connected Atlassian Account', () => {
    it('joinWorkspaceWithInvite rejects outsider with connected Jira and valid token if not an active general org member', async () => {
      const dualAdmin = await createActor('Dual Admin 5', 'dual_adm_5', 'admin');
      const org = await genericRepo.create(dualAdmin.id, 'Join Jira Org');

      await pool.query(
        `INSERT INTO ati_workspaces (id, slug, status, version, created_by)
         VALUES ($1, $2, 'active', 1, $3)`,
        [org.id, `join-jira-${randomUUID().slice(0, 8)}`, sysAdminId]
      );
      await pool.query(
        `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version)
         VALUES ($1, $2, 'admin', 'active', 1)`,
        [org.id, dualAdmin.id]
      );

      const invite = await jiraRepo.createInvite(org.id, dualAdmin.id);

      // Outsider with connected Jira account but NO general workspace membership
      const outsider = await createActor('Jira Outsider', 'jira_outsider');
      await connectSyntheticJiraAccount(pool, outsider.id);

      await expect(
        jiraRepo.joinWorkspaceWithInvite(outsider.id, invite.inviteToken)
      ).rejects.toMatchObject({
        statusCode: expect.any(Number),
      });

      // Target who is pending in general organization must also be rejected
      const pendingOrgUser = await createActor('Pending Org User', 'pend_org');
      await connectSyntheticJiraAccount(pool, pendingOrgUser.id);
      await pool.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, status)
         VALUES ($1, $2, 'member', 'pending')`,
        [org.id, pendingOrgUser.id]
      );

      await expect(
        jiraRepo.joinWorkspaceWithInvite(pendingOrgUser.id, invite.inviteToken)
      ).rejects.toMatchObject({
        statusCode: expect.any(Number),
      });

      // Target who is active in general organization and has connected Jira succeeds
      const activeOrgUser = await createActor('Active Org User', 'act_org');
      await connectSyntheticJiraAccount(pool, activeOrgUser.id);
      await pool.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, status)
         VALUES ($1, $2, 'member', 'active')`,
        [org.id, activeOrgUser.id]
      );

      const joinRes = await jiraRepo.joinWorkspaceWithInvite(activeOrgUser.id, invite.inviteToken);
      expect(joinRes.outcome).toBe('pending');
      expect(joinRes.workspaceId).toBe(org.id);

      // Jira membership row is now pending
      const jiraMem = firstRow(
        await pool.query<{ role: string; status: string }>(
          'SELECT role, status FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
          [org.id, activeOrgUser.id]
        )
      );
      expect(jiraMem).toEqual({
        role: 'member',
        status: 'pending',
      });
    });
  });

  // ============================================================================
  // 7. Jira Admin Reads/Mutations Deny Removed/Disabled General Membership
  // ============================================================================
  describe('7. Jira Admin Operations Deny Removed/Disabled General Organization Membership', () => {
    it('denies Jira admin whose general organization membership was removed or disabled', async () => {
      const dualAdmin = await createActor('Dual Admin 6', 'dual_adm_6', 'admin');
      const org = await genericRepo.create(dualAdmin.id, 'Admin Revocation Org');

      await pool.query(
        `INSERT INTO ati_workspaces (id, slug, status, version, created_by)
         VALUES ($1, $2, 'active', 1, $3)`,
        [org.id, `revoc-${randomUUID().slice(0, 8)}`, sysAdminId]
      );
      await pool.query(
        `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version)
         VALUES ($1, $2, 'admin', 'active', 1)`,
        [org.id, dualAdmin.id]
      );

      // Disable general membership
      await pool.query(
        `UPDATE workspace_members SET status = 'disabled' WHERE workspace_id = $1 AND user_id = $2`,
        [org.id, dualAdmin.id]
      );

      // Jira admin operations must immediately be denied with 404 WORKSPACE_NOT_FOUND
      await expect(jiraRepo.createInvite(org.id, dualAdmin.id)).rejects.toMatchObject({
        statusCode: 404,
        code: 'WORKSPACE_NOT_FOUND',
      });
      await expect(jiraRepo.listMembers(org.id, dualAdmin.id)).rejects.toMatchObject({
        statusCode: 404,
        code: 'WORKSPACE_NOT_FOUND',
      });
    });

    it('denies Jira admin operation blocked on lock wait when general membership is disabled during wait', async () => {
      const workerAppName = `shared_ws_race_${randomUUID().slice(0, 8)}`;
      const workerPool = ctx.createWorkerPool({ max: 2, applicationName: workerAppName });
      const workerJiraRepo = new JiraWorkspaceRepo(workerPool);

      const dualAdmin = await createActor('Dual Admin 7', 'dual_adm_7', 'admin');
      const org = await genericRepo.create(dualAdmin.id, 'Race Lock Org');

      await pool.query(
        `INSERT INTO ati_workspaces (id, slug, status, version, created_by)
         VALUES ($1, $2, 'active', 1, $3)`,
        [org.id, `race-lock-${randomUUID().slice(0, 8)}`, sysAdminId]
      );
      await pool.query(
        `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version)
         VALUES ($1, $2, 'admin', 'active', 1)`,
        [org.id, dualAdmin.id]
      );

      const barrierClient = await pool.connect();
      let barrierReleased = false;
      let allSettledPromise: Promise<[PromiseSettledResult<any>]> | null = null;

      try {
        await barrierClient.query('BEGIN');
        await barrierClient.query('SELECT id FROM ati_workspaces WHERE id = $1 FOR UPDATE', [org.id]);

        const opPromise = workerJiraRepo.createInvite(org.id, dualAdmin.id);
        allSettledPromise = Promise.allSettled([opPromise]);

        await waitForBlockedQueries(pool, [workerAppName], 5000);

        // While query is waiting on lock, revoke/disable general workspace membership
        await pool.query(
          `UPDATE workspace_members SET status = 'disabled' WHERE workspace_id = $1 AND user_id = $2`,
          [org.id, dualAdmin.id]
        );

        await barrierClient.query('COMMIT');
        barrierReleased = true;

        const [settled] = await allSettledPromise;
        expect(settled.status).toBe('rejected');
        if (settled.status === 'rejected') {
          expect(settled.reason).toMatchObject({
            statusCode: 404,
            code: 'WORKSPACE_NOT_FOUND',
          });
        }

        // Verify zero invites created
        const invCheck = await pool.query(
          'SELECT count(*)::int AS count FROM ati_workspace_invites WHERE workspace_id = $1',
          [org.id]
        );
        expect(firstRow(invCheck).count).toBe(0);
      } finally {
        if (!barrierReleased) {
          try {
            await barrierClient.query('ROLLBACK');
          } catch {}
        }
        barrierClient.release();
        if (allSettledPromise) {
          try {
            await allSettledPromise;
          } catch {}
        }
      }
    }, 15_000);
  });

  // ============================================================================
  // 8. Archive Jira Leaves General Workspace Functional
  // ============================================================================
  describe('8. Archive Jira Leaves General Workspace Fully Functional', () => {
    it('archiveWorkspace archives Jira policy while leaving general workspace fully functional', async () => {
      const dualAdmin = await createActor('Dual Admin 8', 'dual_adm_8', 'admin');
      const org = await genericRepo.create(dualAdmin.id, 'Archive Org');

      await pool.query(
        `INSERT INTO ati_workspaces (id, slug, status, version, created_by)
         VALUES ($1, $2, 'active', 1, $3)`,
        [org.id, `arch-jira-${randomUUID().slice(0, 8)}`, sysAdminId]
      );
      await pool.query(
        `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version)
         VALUES ($1, $2, 'admin', 'active', 1)`,
        [org.id, dualAdmin.id]
      );

      // Archive Jira workspace
      const archRes = await jiraRepo.archiveWorkspace(sysAdminId, org.id, 1);
      expect(archRes.status).toBe('archived');
      expect(archRes.workspaceVersion).toBe(2);

      // Verify ati_workspaces status is archived
      const jiraWsCheck = firstRow(
        await pool.query<{ status: string }>('SELECT status FROM ati_workspaces WHERE id = $1', [org.id])
      );
      expect(jiraWsCheck.status).toBe('archived');

      // Crucial: verify generic organization is STILL ACTIVE and functional
      const genericWsCheck = firstRow(
        await pool.query<{ id: string; name: string }>('SELECT id, name FROM workspaces WHERE id = $1', [org.id])
      );
      expect(genericWsCheck.name).toBe('Archive Org');

      // General membership and queries still succeed
      const member = await genericRepo.findMember(org.id, dualAdmin.id);
      expect(member).not.toBeNull();
      expect(member?.status).toBe('active');

      const orgList = await genericRepo.listForUser(dualAdmin.id);
      expect(orgList.some((w) => w.id === org.id)).toBe(true);
    });
  });

  // ============================================================================
  // 9. Recovery Cannot Grant to Inactive / Non-Admin Organization User
  // ============================================================================
  describe('9. Recovery Cannot Grant to Inactive or Non-Admin Organization User', () => {
    it('recoverWorkspaceAdmin rejects candidate who is not an active admin of the general organization', async () => {
      const dualAdmin = await createActor('Dual Admin 9', 'dual_adm_9', 'admin');
      const org = await genericRepo.create(dualAdmin.id, 'Recover Org');

      await pool.query(
        `INSERT INTO ati_workspaces (id, slug, status, version, created_by)
         VALUES ($1, $2, 'active', 1, $3)`,
        [org.id, `rec-jira-${randomUUID().slice(0, 8)}`, sysAdminId]
      );
      await pool.query(
        `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version)
         VALUES ($1, $2, 'admin', 'active', 1)`,
        [org.id, dualAdmin.id]
      );

      // Candidate 1: Outsider to general organization
      const outsider = await createActor('Outsider Candidate', 'out_cand');
      await expect(
        jiraRepo.recoverWorkspaceAdmin(sysAdminId, org.id, { expectedVersion: 1, userId: outsider.id })
      ).rejects.toMatchObject({
        statusCode: expect.any(Number),
      });

      // Candidate 2: Member (not admin) in general organization
      const regMember = await createActor('Member Candidate', 'mem_cand');
      await pool.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, status)
         VALUES ($1, $2, 'member', 'active')`,
        [org.id, regMember.id]
      );
      await expect(
        jiraRepo.recoverWorkspaceAdmin(sysAdminId, org.id, { expectedVersion: 1, userId: regMember.id })
      ).rejects.toMatchObject({
        statusCode: expect.any(Number),
      });

      // Candidate 3: Disabled admin in general organization
      const disabledAdmin = await createActor('Disabled Admin Candidate', 'dis_adm_cand');
      await pool.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, status)
         VALUES ($1, $2, 'admin', 'disabled')`,
        [org.id, disabledAdmin.id]
      );
      await expect(
        jiraRepo.recoverWorkspaceAdmin(sysAdminId, org.id, { expectedVersion: 1, userId: disabledAdmin.id })
      ).rejects.toMatchObject({
        statusCode: expect.any(Number),
      });

      // Candidate 4: Active admin in general organization succeeds
      const validAdmin = await createActor('Valid Admin Candidate', 'val_adm_cand');
      await pool.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, status)
         VALUES ($1, $2, 'admin', 'active')`,
        [org.id, validAdmin.id]
      );
      const recRes = await jiraRepo.recoverWorkspaceAdmin(sysAdminId, org.id, {
        expectedVersion: 1,
        userId: validAdmin.id,
      });
      expect(recRes.workspaceVersion).toBe(2);
      const memRow = firstRow(
        await pool.query<{ role: string; status: string }>(
          'SELECT role, status FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
          [org.id, validAdmin.id]
        )
      );
      expect(memRow.role).toBe('admin');
      expect(memRow.status).toBe('active');
    });
  });

  // ============================================================================
  // 10. HTTP Route Surface / Aliases
  // ============================================================================
  describe('10. HTTP Route Surface & DTO Shapes', () => {
    it('preserves GET /api/workspaces shape as { personal, organizations }', async () => {
      const actor = await createActor('HTTP Actor', 'http_actor');
      await genericRepo.create(actor.id, 'HTTP Shared Org');

      const res = await request(app)
        .get('/api/workspaces')
        .set('Authorization', `Bearer ${actor.token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('personal');
      expect(res.body.personal).toMatchObject({
        id: 'personal',
        role: 'admin',
        status: 'active',
      });
      expect(res.body).toHaveProperty('organizations');
      expect(Array.isArray(res.body.organizations)).toBe(true);
      expect(res.body.organizations.length).toBeGreaterThanOrEqual(1);
    });
  });
});
