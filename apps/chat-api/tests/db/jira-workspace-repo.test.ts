import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import WorkspaceRepo from '../../src/db/repositories/workspace/index.js';
import {
  createIsolatedTestSchema,
  createSyntheticUser,
  connectSyntheticJiraAccount,
  waitForBlockedQueries,
  type IsolatedTestContext,
} from '../helpers/jira-test-db.js';

describe('apps/chat-api — JIRA-03 Workspace Repository Core, Invites & CAS Membership', () => {
  let ctx: IsolatedTestContext;
  let pool: pg.Pool;
  let racePool1: pg.Pool;
  let racePool2: pg.Pool;
  let repoMain: WorkspaceRepo;
  let repo1: WorkspaceRepo;
  let repo2: WorkspaceRepo;
  let appTag1: string;
  let appTag2: string;

  let sysAdminId: string;
  let sysMemberId: string;
  let userAlphaId: string;
  let userBetaId: string;
  let userGammaId: string;

  beforeAll(async () => {
    ctx = await createIsolatedTestSchema({ maxConnections: 4 });
    pool = ctx.pool;
    await ctx.runAllMigrations();

    const schemaSuffix = ctx.schema.slice(-8);
    appTag1 = `race_act1_${schemaSuffix}`;
    appTag2 = `race_act2_${schemaSuffix}`;

    // Two independent pools with dedicated application_name tags for deterministic lock polling
    racePool1 = ctx.createWorkerPool({ max: 2, applicationName: appTag1 });
    racePool2 = ctx.createWorkerPool({ max: 2, applicationName: appTag2 });

    repoMain = new WorkspaceRepo(pool);
    repo1 = new WorkspaceRepo(racePool1);
    repo2 = new WorkspaceRepo(racePool2);

    // Seed system users (active by default)
    sysAdminId = await createSyntheticUser(pool, 'System Admin', 'sysadmin', {
      role: 'admin',
      status: 'active',
    });
    sysMemberId = await createSyntheticUser(pool, 'System Member', 'sysmember', {
      role: 'member',
      status: 'active',
    });

    // Seed standard test users
    userAlphaId = await createSyntheticUser(pool, 'User Alpha', 'alpha', { status: 'active' });
    userBetaId = await createSyntheticUser(pool, 'User Beta', 'beta', { status: 'active' });
    userGammaId = await createSyntheticUser(pool, 'User Gamma', 'gamma', { status: 'active' });
  });

  afterAll(async () => {
    await ctx?.cleanup();
  });

  describe('1. createWorkspaceWithBootstrapAdmin', () => {
    it('creates workspace, bootstrap admin membership, and audit log atomically for active system admin', async () => {
      const slug = `ws-core-${randomUUID().slice(0, 8)}`;
      const res = await repoMain.createWorkspaceWithBootstrapAdmin(sysAdminId, {
        slug,
        name: 'Core Workspace',
        bootstrapAdminUserId: userAlphaId,
      });

      expect(res.workspace).toBeDefined();
      expect(res.workspace.id).toBeDefined();
      expect(res.workspace.slug).toBe(slug);
      expect(res.workspace.name).toBe('Core Workspace');
      expect(res.workspace.version).toBe(1);

      // SUT public DTO projection: curated keys ONLY, no raw DB internal columns
      expect(Object.keys(res.workspace).sort()).toEqual(['id', 'name', 'slug', 'version']);
      expect(res.workspace).not.toHaveProperty('status');
      expect(res.workspace).not.toHaveProperty('created_by');
      expect(res.workspace).not.toHaveProperty('created_at');
      expect(res.workspace).not.toHaveProperty('updated_at');
      expect(res.workspace).not.toHaveProperty('archived_at');

      // Verify membership row in PostgreSQL
      const memRes = await pool.query(
        `SELECT role, status, version FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2`,
        [res.workspace.id, userAlphaId]
      );
      expect(memRes.rows[0]).toEqual({
        role: 'admin',
        status: 'active',
        version: 1,
      });

      // Verify audit log entry in PostgreSQL
      const auditRes = await pool.query(
        `SELECT action, decision, version FROM jira_authorization_audit WHERE workspace_id = $1`,
        [res.workspace.id]
      );
      expect(auditRes.rows[0].action).toBe('create_workspace');
      expect(auditRes.rows[0].decision).toBe('allow');
      expect(auditRes.rows[0].version).toBe(1);
    });

    it('rejects non-system-admin caller with 403', async () => {
      const slug = `ws-denied-${randomUUID().slice(0, 8)}`;
      await expect(
        repoMain.createWorkspaceWithBootstrapAdmin(sysMemberId, {
          slug,
          name: 'Denied Workspace',
          bootstrapAdminUserId: userAlphaId,
        })
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('rolls back completely if bootstrap admin user does not exist or is invalid', async () => {
      const badUserId = randomUUID();
      const slug = `ws-rollback-${randomUUID().slice(0, 8)}`;

      await expect(
        repoMain.createWorkspaceWithBootstrapAdmin(sysAdminId, {
          slug,
          name: 'Rollback Workspace',
          bootstrapAdminUserId: badUserId,
        })
      ).rejects.toThrow();

      // Ensure no dangling workspace, membership, or audit row exists
      const wsCheck = await pool.query(`SELECT count(*) FROM ati_workspaces WHERE slug = $1`, [slug]);
      expect(wsCheck.rows[0].count).toBe('0');

      const memCheck = await pool.query(
        `SELECT count(*) FROM ati_workspace_memberships WHERE user_id = $1`,
        [badUserId]
      );
      expect(memCheck.rows[0].count).toBe('0');

      const auditCheck = await pool.query(
        `SELECT count(*) FROM jira_authorization_audit WHERE details->>'slug' = $1`,
        [slug]
      );
      expect(auditCheck.rows[0].count).toBe('0');
    });

    it('rejects duplicate slug with conflict error', async () => {
      const slug = `ws-dup-${randomUUID().slice(0, 8)}`;
      await repoMain.createWorkspaceWithBootstrapAdmin(sysAdminId, {
        slug,
        name: 'First WS',
        bootstrapAdminUserId: userAlphaId,
      });

      await expect(
        repoMain.createWorkspaceWithBootstrapAdmin(sysAdminId, {
          slug,
          name: 'Second WS with same slug',
          bootstrapAdminUserId: userBetaId,
        })
      ).rejects.toThrow();
    });
  });

  describe('2. listWorkspacesForUser', () => {
    it('lists workspaces for a user conforming to shared WorkspaceSummary DTO', async () => {
      const slug1 = `ws-list-1-${randomUUID().slice(0, 8)}`;
      const slug2 = `ws-list-2-${randomUUID().slice(0, 8)}`;
      const slug3 = `ws-list-3-${randomUUID().slice(0, 8)}`;

      const ws1 = await repoMain.createWorkspaceWithBootstrapAdmin(sysAdminId, {
        slug: slug1,
        name: 'Workspace 1',
        bootstrapAdminUserId: userAlphaId,
      });
      const ws2 = await repoMain.createWorkspaceWithBootstrapAdmin(sysAdminId, {
        slug: slug2,
        name: 'Workspace 2',
        bootstrapAdminUserId: userBetaId,
      });
      // Workspace 3 does not include userAlpha
      await repoMain.createWorkspaceWithBootstrapAdmin(sysAdminId, {
        slug: slug3,
        name: 'Workspace 3',
        bootstrapAdminUserId: userBetaId,
      });

      // Add userAlpha as member to Workspace 2
      await pool.query(
        `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version)
         VALUES ($1, $2, 'member', 'active', 3)`,
        [ws2.workspace.id, userAlphaId]
      );

      const list = await repoMain.listWorkspacesForUser(userAlphaId);
      const ws1Item = list.find((w: any) => w.id === ws1.workspace.id);
      const ws2Item = list.find((w: any) => w.id === ws2.workspace.id);
      const ws3Item = list.find((w: any) => w.id === 'unknown');

      expect(ws1Item).toBeDefined();
      expect(ws1Item?.id).toBe(ws1.workspace.id);
      expect(ws1Item?.role).toBe('admin');
      expect(ws1Item?.membershipStatus).toBe('active');
      expect(ws1Item?.workspaceVersion).toBe(1);
      expect(ws1Item?.membershipVersion).toBe(1);
      // Verify no drifted property names
      expect(ws1Item).not.toHaveProperty('workspaceId');
      expect(ws1Item).not.toHaveProperty('status');

      expect(ws2Item).toBeDefined();
      expect(ws2Item?.id).toBe(ws2.workspace.id);
      expect(ws2Item?.role).toBe('member');
      expect(ws2Item?.membershipStatus).toBe('active');
      expect(ws2Item?.membershipVersion).toBe(3);

      expect(ws3Item).toBeUndefined();
    });

    it('lists all own related active workspaces with membership in any state (pending, active, rejected, removed), excluding unrelated and archived workspaces', async () => {
      const targetUser = await createSyntheticUser(pool, 'Own Status User', 'ownstatus', { status: 'active' });

      // 1. wsActive: targetUser is active bootstrap admin
      const wsActive = await repoMain.createWorkspaceWithBootstrapAdmin(sysAdminId, {
        slug: `ws-rel-act-${randomUUID().slice(0, 8)}`,
        name: 'Rel Active WS',
        bootstrapAdminUserId: targetUser,
      });

      // 2. wsPending: targetUser is pending member
      const wsPending = await repoMain.createWorkspaceWithBootstrapAdmin(sysAdminId, {
        slug: `ws-rel-pend-${randomUUID().slice(0, 8)}`,
        name: 'Rel Pending WS',
        bootstrapAdminUserId: userAlphaId,
      });
      await pool.query(
        `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version)
         VALUES ($1, $2, 'member', 'pending', 1)`,
        [wsPending.workspace.id, targetUser]
      );

      // 3. wsRejected: targetUser is rejected member
      const wsRejected = await repoMain.createWorkspaceWithBootstrapAdmin(sysAdminId, {
        slug: `ws-rel-rej-${randomUUID().slice(0, 8)}`,
        name: 'Rel Rejected WS',
        bootstrapAdminUserId: userAlphaId,
      });
      await pool.query(
        `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version, decided_at)
         VALUES ($1, $2, 'member', 'rejected', 2, clock_timestamp())`,
        [wsRejected.workspace.id, targetUser]
      );

      // 4. wsRemoved: targetUser is removed member
      const wsRemoved = await repoMain.createWorkspaceWithBootstrapAdmin(sysAdminId, {
        slug: `ws-rel-rem-${randomUUID().slice(0, 8)}`,
        name: 'Rel Removed WS',
        bootstrapAdminUserId: userAlphaId,
      });
      await pool.query(
        `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version, decided_at)
         VALUES ($1, $2, 'member', 'removed', 3, clock_timestamp())`,
        [wsRemoved.workspace.id, targetUser]
      );

      // 5. wsUnrelated: active workspace where targetUser has NO membership
      await repoMain.createWorkspaceWithBootstrapAdmin(sysAdminId, {
        slug: `ws-unrelated-${randomUUID().slice(0, 8)}`,
        name: 'Unrelated WS',
        bootstrapAdminUserId: userAlphaId,
      });

      // 6. wsArchived: archived workspace where targetUser had active membership
      const wsArchived = await repoMain.createWorkspaceWithBootstrapAdmin(sysAdminId, {
        slug: `ws-archived-${randomUUID().slice(0, 8)}`,
        name: 'Archived WS',
        bootstrapAdminUserId: targetUser,
      });
      await pool.query(`UPDATE ati_workspaces SET status = 'archived' WHERE id = $1`, [wsArchived.workspace.id]);

      const list = await repoMain.listWorkspacesForUser(targetUser);

      // All 4 own related active workspaces must appear
      expect(list).toHaveLength(4);

      const activeItem = list.find((w) => w.id === wsActive.workspace.id);
      expect(activeItem).toMatchObject({
        id: wsActive.workspace.id,
        role: 'admin',
        membershipStatus: 'active',
        workspaceVersion: 1,
        membershipVersion: 1,
      });

      const pendingItem = list.find((w) => w.id === wsPending.workspace.id);
      expect(pendingItem).toMatchObject({
        id: wsPending.workspace.id,
        role: 'member',
        membershipStatus: 'pending',
        workspaceVersion: 1,
        membershipVersion: 1,
      });

      const rejectedItem = list.find((w) => w.id === wsRejected.workspace.id);
      expect(rejectedItem).toMatchObject({
        id: wsRejected.workspace.id,
        role: 'member',
        membershipStatus: 'rejected',
        workspaceVersion: 1,
        membershipVersion: 2,
      });

      const removedItem = list.find((w) => w.id === wsRemoved.workspace.id);
      expect(removedItem).toMatchObject({
        id: wsRemoved.workspace.id,
        role: 'member',
        membershipStatus: 'removed',
        workspaceVersion: 1,
        membershipVersion: 3,
      });

      // Unrelated and archived workspaces must NOT be in the list
      const archivedItem = list.find((w) => w.id === wsArchived.workspace.id);
      expect(archivedItem).toBeUndefined();

      // Verify no content leaks: exactly canonical keys only, no tokens/projects/sites
      for (const item of list) {
        expect(Object.keys(item).sort()).toEqual([
          'id',
          'membershipStatus',
          'membershipVersion',
          'name',
          'role',
          'slug',
          'workspaceVersion',
        ]);
      }
    });
  });

  describe('3. Invite Lifecycle: createInvite, listInvites, revokeInvite', () => {
    let wsId: string;

    beforeEach(async () => {
      const created = await repoMain.createWorkspaceWithBootstrapAdmin(sysAdminId, {
        slug: `ws-inv-${randomUUID().slice(0, 8)}`,
        name: 'Invite Test WS',
        bootstrapAdminUserId: userAlphaId,
      });
      wsId = created.workspace.id;

      // Seed userBeta as an active member in wsId so non-admin tests test active members legitimately
      await pool.query(
        `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version)
         VALUES ($1, $2, 'member', 'active', 1)`,
        [wsId, userBetaId]
      );
    });

    it('creates invite storing SHA-256 hash only, returns shared CreateInviteResponse format', async () => {
      const inviteRes = await repoMain.createInvite(wsId, userAlphaId, { expiresInDays: 7 });

      expect(inviteRes.inviteToken).toBeDefined();
      expect(inviteRes.inviteToken).toHaveLength(64); // 32 bytes hex
      expect(inviteRes.inviteId).toBeDefined();
      expect(typeof inviteRes.expiresAt).toBe('string');
      // Shared DTO has top-level inviteId, inviteToken, expiresAt; no nested .invite wrapper
      expect(inviteRes).not.toHaveProperty('invite');

      // Verify token_hash in PostgreSQL: must be 64-char hex SHA-256, NOT plaintext
      const dbRow = (
        await pool.query(`SELECT token_hash FROM ati_workspace_invites WHERE id = $1`, [inviteRes.inviteId])
      ).rows[0];
      expect(dbRow.token_hash).toBeDefined();
      expect(dbRow.token_hash).not.toBe(inviteRes.inviteToken);
      expect(dbRow.token_hash).toHaveLength(64);
    });

    it('validates expiresInDays: rejects non-positive or out-of-bounds integer with 400', async () => {
      const badExpiries = [0, -1, 1.5, NaN, Infinity, 31, '7' as any];
      for (const bad of badExpiries) {
        await expect(
          repoMain.createInvite(wsId, userAlphaId, { expiresInDays: bad })
        ).rejects.toMatchObject({ statusCode: 400 });
      }
    });

    it('creates invite with default 7 days expiry using PostgreSQL DB clock when request is omitted', async () => {
      const inviteRes = await repoMain.createInvite(wsId, userAlphaId);
      expect(inviteRes.inviteId).toBeDefined();
      expect(typeof inviteRes.expiresAt).toBe('string');

      const dbRow = (
        await pool.query(
          `SELECT (expires_at > clock_timestamp() + interval '6 days 23 hours' AND expires_at < clock_timestamp() + interval '7 days 1 hour') AS is_around_7_days
           FROM ati_workspace_invites WHERE id = $1`,
          [inviteRes.inviteId]
        )
      ).rows[0];
      expect(dbRow.is_around_7_days).toBe(true);
    });

    it('rejects invite creation by non-admin active member with 403', async () => {
      await expect(repoMain.createInvite(wsId, userBetaId)).rejects.toMatchObject({ statusCode: 403 });
    });

    it('lists invites without exposing token plaintext or hash, returning ISO string expiresAt', async () => {
      await repoMain.createInvite(wsId, userAlphaId);
      const invites = await repoMain.listInvites(wsId, userAlphaId);
      expect(invites.length).toBeGreaterThan(0);
      for (const inv of invites) {
        expect(inv).not.toHaveProperty('inviteToken');
        expect(inv).not.toHaveProperty('token_hash');
        expect(inv.workspaceId).toBe(wsId);
        expect(typeof inv.expiresAt).toBe('string');
      }
    });

    it('revokes an invite and returns shared RevokeInviteResponse format ({ revoked, revokedAt })', async () => {
      const invite = await repoMain.createInvite(wsId, userAlphaId);
      const res = await repoMain.revokeInvite(wsId, userAlphaId, invite.inviteId);
      expect(res.revoked).toBe(true);
      expect(res.revokedAt).toBeDefined();
      expect(typeof res.revokedAt).toBe('string');

      const dbCheck = (
        await pool.query(`SELECT revoked_at FROM ati_workspace_invites WHERE id = $1`, [invite.inviteId])
      ).rows[0];
      expect(dbCheck.revoked_at).not.toBeNull();
    });
  });

  describe('4. joinWorkspaceWithInvite (Independent Test Fixtures, Rejoin & Concurrency)', () => {
    it('rejects join when user has no connected Atlassian account with 403', async () => {
      const ws = await repoMain.createWorkspaceWithBootstrapAdmin(sysAdminId, {
        slug: `ws-join-noacc-${randomUUID().slice(0, 8)}`,
        name: 'No Account WS',
        bootstrapAdminUserId: userAlphaId,
      });
      const inv = await repoMain.createInvite(ws.workspace.id, userAlphaId);
      const joiner = await createSyntheticUser(pool, 'Joiner No Acc', 'noacc', { status: 'active' });

      await expect(repoMain.joinWorkspaceWithInvite(joiner, inv.inviteToken)).rejects.toMatchObject({
        statusCode: 403,
        code: 'ACCOUNT_NOT_CONNECTED',
      });
    });

    it('allows join when user has connected Atlassian account, creates pending membership', async () => {
      const ws = await repoMain.createWorkspaceWithBootstrapAdmin(sysAdminId, {
        slug: `ws-join-fresh-${randomUUID().slice(0, 8)}`,
        name: 'Fresh Join WS',
        bootstrapAdminUserId: userAlphaId,
      });
      const inv = await repoMain.createInvite(ws.workspace.id, userAlphaId);
      const joiner = await createSyntheticUser(pool, 'Fresh Joiner', 'fresh', { status: 'active' });
      await connectSyntheticJiraAccount(pool, joiner);

      const res = await repoMain.joinWorkspaceWithInvite(joiner, inv.inviteToken);
      expect(res.outcome).toBe('pending');
      if (res.outcome !== 'pending') {
        throw new Error(`Expected outcome to be pending, got ${res.outcome}`);
      }
      expect(res.workspaceId).toBe(ws.workspace.id);
      expect(res.requestId).toBeDefined();

      const mem = (
        await pool.query(
          `SELECT role, status, version FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2`,
          [ws.workspace.id, joiner]
        )
      ).rows[0];
      expect(mem.status).toBe('pending');
      expect(mem.role).toBe('member');
      expect(mem.version).toBe(1);
    });

    it('is idempotent on duplicate pending join (returns pending without changes)', async () => {
      const ws = await repoMain.createWorkspaceWithBootstrapAdmin(sysAdminId, {
        slug: `ws-join-dup-pend-${randomUUID().slice(0, 8)}`,
        name: 'Dup Pending WS',
        bootstrapAdminUserId: userAlphaId,
      });
      const inv = await repoMain.createInvite(ws.workspace.id, userAlphaId);
      const joiner = await createSyntheticUser(pool, 'Dup Pend Joiner', 'duppend', { status: 'active' });
      await connectSyntheticJiraAccount(pool, joiner);

      // Pre-existing pending membership
      await pool.query(
        `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version)
         VALUES ($1, $2, 'member', 'pending', 1)`,
        [ws.workspace.id, joiner]
      );

      const res = await repoMain.joinWorkspaceWithInvite(joiner, inv.inviteToken);
      expect(res.outcome).toBe('pending');
      expect(res.workspaceId).toBe(ws.workspace.id);

      const mem = (
        await pool.query(
          `SELECT status, version FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2`,
          [ws.workspace.id, joiner]
        )
      ).rows[0];
      expect(mem.status).toBe('pending');
      expect(mem.version).toBe(1);
    });

    it('leaves active member untouched on duplicate join and returns already_active outcome', async () => {
      const ws = await repoMain.createWorkspaceWithBootstrapAdmin(sysAdminId, {
        slug: `ws-join-dup-act-${randomUUID().slice(0, 8)}`,
        name: 'Dup Active WS',
        bootstrapAdminUserId: userAlphaId,
      });
      const inv = await repoMain.createInvite(ws.workspace.id, userAlphaId);
      const joiner = await createSyntheticUser(pool, 'Dup Active Joiner', 'dupact', { status: 'active' });
      await connectSyntheticJiraAccount(pool, joiner);

      // Pre-existing active membership
      await pool.query(
        `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version)
         VALUES ($1, $2, 'member', 'active', 2)`,
        [ws.workspace.id, joiner]
      );

      const res = await repoMain.joinWorkspaceWithInvite(joiner, inv.inviteToken);
      expect(res.outcome).toBe('already_active');
      expect(res.workspaceId).toBe(ws.workspace.id);

      // Database row must remain active with version 2
      const mem = (
        await pool.query(
          `SELECT status, version FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2`,
          [ws.workspace.id, joiner]
        )
      ).rows[0];
      expect(mem.status).toBe('active');
      expect(mem.version).toBe(2);
    });

    it('enforces monotonic rejoin: old invite issued before rejection fails with 404, new invite succeeds', async () => {
      const ws = await repoMain.createWorkspaceWithBootstrapAdmin(sysAdminId, {
        slug: `ws-join-mono-${randomUUID().slice(0, 8)}`,
        name: 'Monotonic WS',
        bootstrapAdminUserId: userAlphaId,
      });
      const oldInv = await repoMain.createInvite(ws.workspace.id, userAlphaId);
      const joiner = await createSyntheticUser(pool, 'Monotonic Joiner', 'monojoin', { status: 'active' });
      await connectSyntheticJiraAccount(pool, joiner);

      // User rejected AFTER old invite was created
      await pool.query(
        `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version, decided_at)
         VALUES ($1, $2, 'member', 'rejected', 2, clock_timestamp() + interval '1 millisecond')`,
        [ws.workspace.id, joiner]
      );

      // Attempting to rejoin with old invite (created before decided_at) must fail
      await expect(repoMain.joinWorkspaceWithInvite(joiner, oldInv.inviteToken)).rejects.toMatchObject({
        statusCode: 404,
      });

      // Admin generates a NEW invite issued AFTER the rejection timestamp
      const newInv = await repoMain.createInvite(ws.workspace.id, userAlphaId);

      // Rejoin with new invite succeeds with pending outcome and incremented version
      const res = await repoMain.joinWorkspaceWithInvite(joiner, newInv.inviteToken);
      expect(res.outcome).toBe('pending');

      const mem = (
        await pool.query(
          `SELECT status, version, role FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2`,
          [ws.workspace.id, joiner]
        )
      ).rows[0];
      expect(mem.status).toBe('pending');
      expect(mem.version).toBe(3);
      expect(mem.role).toBe('member'); // No role elevation
    });

    it('rejects expired or revoked invite with 404', async () => {
      const ws = await repoMain.createWorkspaceWithBootstrapAdmin(sysAdminId, {
        slug: `ws-join-rev-${randomUUID().slice(0, 8)}`,
        name: 'Revoked Invite WS',
        bootstrapAdminUserId: userAlphaId,
      });
      const inv = await repoMain.createInvite(ws.workspace.id, userAlphaId);
      await repoMain.revokeInvite(ws.workspace.id, userAlphaId, inv.inviteId);

      const joiner = await createSyntheticUser(pool, 'Joiner Revoked', 'revjoin', { status: 'active' });
      await connectSyntheticJiraAccount(pool, joiner);

      await expect(repoMain.joinWorkspaceWithInvite(joiner, inv.inviteToken)).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it('rejects join with 403 if Atlassian account is disconnected while waiting on workspace lock', async () => {
      const ws = await repoMain.createWorkspaceWithBootstrapAdmin(sysAdminId, {
        slug: `ws-join-disc-${randomUUID().slice(0, 8)}`,
        name: 'Disconnect WS',
        bootstrapAdminUserId: userAlphaId,
      });
      const inv = await repoMain.createInvite(ws.workspace.id, userAlphaId);
      const joiner = await createSyntheticUser(pool, 'Joiner Disc', 'joindisc', { status: 'active' });
      await connectSyntheticJiraAccount(pool, joiner);

      const barrierClient = await pool.connect();
      let allSettledPromise: Promise<[PromiseSettledResult<any>]> | null = null;
      try {
        await barrierClient.query('BEGIN');
        await barrierClient.query('SELECT id FROM ati_workspaces WHERE id = $1 FOR UPDATE', [ws.workspace.id]);

        // Launch join on repo1 (tagged with appTag1)
        const p1 = repo1.joinWorkspaceWithInvite(joiner, inv.inviteToken);
        allSettledPromise = Promise.allSettled([p1]);

        // Wait until repo1 session is blocked on the workspace lock
        await waitForBlockedQueries(pool, [appTag1], 5000);

        // Disconnect the account via independent client while joiner is blocked waiting on workspace lock
        await pool.query(
          `UPDATE jira_accounts SET status = 'disconnected', updated_at = clock_timestamp() WHERE user_id = $1`,
          [joiner]
        );

        // Release barrier
        await barrierClient.query('COMMIT');
      } finally {
        try {
          await barrierClient.query('ROLLBACK');
        } catch {}
        barrierClient.release();
        if (allSettledPromise) {
          await allSettledPromise;
        }
      }

      const [joinResult] = await allSettledPromise!;
      expect(joinResult.status).toBe('rejected');
      expect((joinResult as PromiseRejectedResult).reason).toMatchObject({
        statusCode: 403,
        code: 'ACCOUNT_NOT_CONNECTED',
      });

      // Database check: membership must NOT have been created
      const mem = await pool.query(
        `SELECT count(*) FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2`,
        [ws.workspace.id, joiner]
      );
      expect(mem.rows[0].count).toBe('0');
    });

    it('enforces PostgreSQL authoritative clock: rejects expired invite even if Node clock is skewed into the past', async () => {
      const ws = await repoMain.createWorkspaceWithBootstrapAdmin(sysAdminId, {
        slug: `ws-clock-exp-${randomUUID().slice(0, 8)}`,
        name: 'Clock Exp WS',
        bootstrapAdminUserId: userAlphaId,
      });
      const inv = await repoMain.createInvite(ws.workspace.id, userAlphaId);
      const joiner = await createSyntheticUser(pool, 'Clock Joiner', 'clkjoin', { status: 'active' });
      await connectSyntheticJiraAccount(pool, joiner);

      // Set invite expires_at to 1 second in the past according to PostgreSQL clock
      const updateRes = await pool.query(
        `UPDATE ati_workspace_invites SET expires_at = clock_timestamp() - interval '1 second' WHERE id = $1`,
        [inv.inviteId]
      );
      expect(updateRes.rowCount).toBe(1);

      // Spy Date.now() to return a time 1 hour in the past (where Node thinks the invite is not expired)
      const nodeClockPast = Date.now() - 3600_000;
      const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(nodeClockPast);
      try {
        await expect(repoMain.joinWorkspaceWithInvite(joiner, inv.inviteToken)).rejects.toMatchObject({
          statusCode: 404,
        });
      } finally {
        dateSpy.mockRestore();
      }
    });

    it('preserves sub-millisecond precision: allows rejoin when new invite is strictly after rejection in the same millisecond', async () => {
      const ws = await repoMain.createWorkspaceWithBootstrapAdmin(sysAdminId, {
        slug: `ws-subms-${randomUUID().slice(0, 8)}`,
        name: 'Sub-MS WS',
        bootstrapAdminUserId: userAlphaId,
      });
      const newInv = await repoMain.createInvite(ws.workspace.id, userAlphaId);
      const joiner = await createSyntheticUser(pool, 'Sub-MS Joiner', 'subms', { status: 'active' });
      await connectSyntheticJiraAccount(pool, joiner);

      // Member rejected at .123100Z
      await pool.query(
        `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version, decided_at)
         VALUES ($1, $2, 'member', 'rejected', 2, '2026-11-01T12:00:00.123100Z')`,
        [ws.workspace.id, joiner]
      );

      // New invite created at .123900Z (same millisecond 123, but 800 microseconds later)
      const submsUpdate = await pool.query(
        `UPDATE ati_workspace_invites 
         SET created_at = '2026-11-01T12:00:00.123900Z', expires_at = clock_timestamp() + interval '1 day'
         WHERE id = $1`,
        [newInv.inviteId]
      );
      expect(submsUpdate.rowCount).toBe(1);

      // Should succeed because .123900 > .123100 in PostgreSQL
      const res = await repoMain.joinWorkspaceWithInvite(joiner, newInv.inviteToken);
      expect(res.outcome).toBe('pending');

      const mem = (
        await pool.query(
          `SELECT status, version FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2`,
          [ws.workspace.id, joiner]
        )
      ).rows[0];
      expect(mem.status).toBe('pending');
      expect(mem.version).toBe(3);
    });

    it('rejects join with 404 if invite expires while waiting for account row lock', async () => {
      const ws = await repoMain.createWorkspaceWithBootstrapAdmin(sysAdminId, {
        slug: `ws-join-acclock-${randomUUID().slice(0, 8)}`,
        name: 'Account Lock Expiry WS',
        bootstrapAdminUserId: userAlphaId,
      });
      const inv = await repoMain.createInvite(ws.workspace.id, userAlphaId);
      const joiner = await createSyntheticUser(pool, 'Expiry Waiter', 'expwait', { status: 'active' });
      await connectSyntheticJiraAccount(pool, joiner);

      // Set expiry to 2 seconds in the future according to PostgreSQL DB clock
      const updateRes = await pool.query(
        `UPDATE ati_workspace_invites SET expires_at = clock_timestamp() + interval '2 seconds' WHERE id = $1`,
        [inv.inviteId]
      );
      expect(updateRes.rowCount).toBe(1);

      // Independent transaction locks the account row FOR UPDATE without disconnecting
      const accountLockClient = await pool.connect();
      let allSettledPromise: Promise<[PromiseSettledResult<any>]> | null = null;
      try {
        await accountLockClient.query('BEGIN');
        await accountLockClient.query(
          `SELECT id FROM jira_accounts WHERE user_id = $1 FOR UPDATE`,
          [joiner]
        );

        // Launch join on repo1 (tagged with appTag1)
        const p1 = repo1.joinWorkspaceWithInvite(joiner, inv.inviteToken);
        allSettledPromise = Promise.allSettled([p1]);

        // Wait until repo1 session is blocked on the account row lock
        await waitForBlockedQueries(pool, [appTag1], 5000);

        // Ensure invite expiry is still in the future immediately after barrier observation
        const checkExpiry = await pool.query(
          `SELECT (expires_at > clock_timestamp()) AS is_future FROM ati_workspace_invites WHERE id = $1`,
          [inv.inviteId]
        );
        expect(checkExpiry.rows[0].is_future).toBe(true);

        // Poll PostgreSQL DB clock until the invite has actually expired
        const deadline = Date.now() + 4000;
        while (Date.now() < deadline) {
          const res = await pool.query(
            `SELECT (clock_timestamp() >= expires_at) AS is_expired FROM ati_workspace_invites WHERE id = $1`,
            [inv.inviteId]
          );
          if (res.rows[0].is_expired) break;
          await new Promise((r) => setTimeout(r, 100));
        }

        // Release account row lock
        await accountLockClient.query('COMMIT');
      } finally {
        try {
          await accountLockClient.query('ROLLBACK');
        } catch {}
        accountLockClient.release();
        if (allSettledPromise) {
          await allSettledPromise;
        }
      }

      const [joinResult] = await allSettledPromise!;
      expect(joinResult.status).toBe('rejected');
      expect((joinResult as PromiseRejectedResult).reason).toMatchObject({
        statusCode: 404,
      });

      // Assert zero membership created in DB
      const memCheck = await pool.query(
        `SELECT count(*) FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2`,
        [ws.workspace.id, joiner]
      );
      expect(memCheck.rows[0].count).toBe('0');

      // Assert no join_workspace audit record was logged
      const auditCheck = await pool.query(
        `SELECT count(*) FROM jira_authorization_audit WHERE workspace_id = $1 AND action = 'join_workspace'`,
        [ws.workspace.id]
      );
      expect(auditCheck.rows[0].count).toBe('0');
    }, 15000);
  });

  describe('5. decideMember: Concurrency Barrier CAS, Mutual Remove Race & Admin Guards', () => {
    let wsId: string;
    let admin1Id: string;
    let admin2Id: string;
    let pendingUserId: string;

    beforeEach(async () => {
      admin1Id = await createSyntheticUser(pool, 'Admin One', 'adm1', { status: 'active' });
      admin2Id = await createSyntheticUser(pool, 'Admin Two', 'adm2', { status: 'active' });
      pendingUserId = await createSyntheticUser(pool, 'Pending User', 'pend', { status: 'active' });

      const created = await repoMain.createWorkspaceWithBootstrapAdmin(sysAdminId, {
        slug: `ws-cas-${randomUUID().slice(0, 8)}`,
        name: 'CAS Workspace',
        bootstrapAdminUserId: admin1Id,
      });
      wsId = created.workspace.id;

      // Add admin2 as active admin
      await pool.query(
        `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version)
         VALUES ($1, $2, 'admin', 'active', 1)`,
        [wsId, admin2Id]
      );

      // Add pending user
      await pool.query(
        `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version)
         VALUES ($1, $2, 'member', 'pending', 1)`,
        [wsId, pendingUserId]
      );
    });

    it('resolves CAS decision race with real PG barrier: exactly 1 winner, 1 STALE_VERSION (409)', async () => {
      const barrierClient = await pool.connect();
      let allSettledPromise: Promise<[PromiseSettledResult<any>, PromiseSettledResult<any>]> | null = null;
      try {
        await barrierClient.query('BEGIN');
        // Hold exclusive lock on the workspace row
        await barrierClient.query('SELECT id FROM ati_workspaces WHERE id = $1 FOR UPDATE', [wsId]);

        // Launch concurrent conflicting decisions on independent pools (repo1 and repo2)
        const p1 = repo1.decideMember(wsId, admin1Id, pendingUserId, {
          decision: 'approve',
          expectedVersion: 1,
        });
        const p2 = repo2.decideMember(wsId, admin2Id, pendingUserId, {
          decision: 'reject',
          expectedVersion: 1,
        });

        // Attach Promise.allSettled immediately before polling to avoid unhandled rejection
        allSettledPromise = Promise.allSettled([p1, p2]);

        // Deterministically wait until BOTH competitor sessions are blocked on the workspace lock
        await waitForBlockedQueries(pool, [appTag1, appTag2], 5000);

        // Release the barrier
        await barrierClient.query('COMMIT');
      } finally {
        try {
          await barrierClient.query('ROLLBACK');
        } catch {}
        barrierClient.release();
        if (allSettledPromise) {
          await allSettledPromise;
        }
      }

      // Drain participant promises
      const results = await allSettledPromise!;
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const winnerResult = (fulfilled[0] as PromiseFulfilledResult<any>).value;
      const loserError = (rejected[0] as PromiseRejectedResult).reason;

      expect(loserError).toMatchObject({
        statusCode: 409,
        code: 'STALE_VERSION',
      });

      // Verify target membership in DB: version updated to 2
      const mem = (
        await pool.query(
          `SELECT version, status FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2`,
          [wsId, pendingUserId]
        )
      ).rows[0];
      expect(mem.version).toBe(2);
      expect(winnerResult.status).toBeDefined();
      expect(winnerResult.version).toBe(2);
      expect(winnerResult).not.toHaveProperty('membership');
      expect(mem.status).toBe(winnerResult.status);

      // Exactly one decision audit record logged in DB
      const audit = await pool.query(
        `SELECT count(*) FROM jira_authorization_audit WHERE workspace_id = $1 AND action = 'decide_member'`,
        [wsId]
      );
      expect(audit.rows[0].count).toBe('1');
    });

    it('resolves mutual admin remove race: loser is removed under lock, receives 403/404, leaving exactly 1 active admin', async () => {
      const barrierClient = await pool.connect();
      let allSettledPromise: Promise<[PromiseSettledResult<any>, PromiseSettledResult<any>]> | null = null;
      try {
        await barrierClient.query('BEGIN');
        await barrierClient.query('SELECT id FROM ati_workspaces WHERE id = $1 FOR UPDATE', [wsId]);

        // Admin 1 tries to remove Admin 2; Admin 2 tries to remove Admin 1
        const p1 = repo1.decideMember(wsId, admin1Id, admin2Id, {
          decision: 'remove',
          expectedVersion: 1,
        });
        const p2 = repo2.decideMember(wsId, admin2Id, admin1Id, {
          decision: 'remove',
          expectedVersion: 1,
        });

        allSettledPromise = Promise.allSettled([p1, p2]);

        await waitForBlockedQueries(pool, [appTag1, appTag2], 5000);
        await barrierClient.query('COMMIT');
      } finally {
        try {
          await barrierClient.query('ROLLBACK');
        } catch {}
        barrierClient.release();
        if (allSettledPromise) {
          await allSettledPromise;
        }
      }

      const results = await allSettledPromise!;
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const error = (rejected[0] as PromiseRejectedResult).reason;
      // Loser was removed while waiting; recheck detects non-admin status -> 403 or 404
      expect([403, 404]).toContain(error.statusCode);

      // Query database: exactly 1 active admin must remain in the workspace (never orphaned)
      const activeAdmins = (
        await pool.query(
          `SELECT user_id FROM ati_workspace_memberships WHERE workspace_id = $1 AND role = 'admin' AND status = 'active'`,
          [wsId]
        )
      ).rows;
      expect(activeAdmins).toHaveLength(1);
    });

    it('enforces sole last active admin guard: rejects removing the last remaining admin with 409', async () => {
      // Remove admin2 first so admin1 is the sole remaining active admin
      await pool.query(
        `DELETE FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2`,
        [wsId, admin2Id]
      );

      // Admin1 attempts to remove themselves
      await expect(
        repoMain.decideMember(wsId, admin1Id, admin1Id, {
          decision: 'remove',
          expectedVersion: 1,
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'LAST_ACTIVE_ADMIN',
      });
    });

    it('enforces self-approve guard: rejects self-approval with 409', async () => {
      await expect(
        repoMain.decideMember(wsId, pendingUserId, pendingUserId, {
          decision: 'approve',
          expectedVersion: 1,
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'SELF_APPROVE_FORBIDDEN',
      });
    });

    it('serializes concurrent revokeInvite and joinWorkspaceWithInvite on same workspace barrier', async () => {
      const inv = await repoMain.createInvite(wsId, admin1Id);
      const joinerUserId = await createSyntheticUser(pool, 'Joiner Race', 'joinrace', { status: 'active' });
      await connectSyntheticJiraAccount(pool, joinerUserId);

      const barrierClient = await pool.connect();
      let allSettledPromise: Promise<[PromiseSettledResult<any>, PromiseSettledResult<any>]> | null = null;
      try {
        await barrierClient.query('BEGIN');
        await barrierClient.query('SELECT id FROM ati_workspaces WHERE id = $1 FOR UPDATE', [wsId]);

        // Client 1 revokes invite, Client 2 joins with invite
        const p1 = repo1.revokeInvite(wsId, admin1Id, inv.inviteId);
        const p2 = repo2.joinWorkspaceWithInvite(joinerUserId, inv.inviteToken);

        allSettledPromise = Promise.allSettled([p1, p2]);

        await waitForBlockedQueries(pool, [appTag1, appTag2], 5000);
        await barrierClient.query('COMMIT');
      } finally {
        try {
          await barrierClient.query('ROLLBACK');
        } catch {}
        barrierClient.release();
        if (allSettledPromise) {
          await allSettledPromise;
        }
      }

      const [revokeResult, joinResult] = await allSettledPromise!;

      // Revocation must always succeed
      expect(revokeResult.status).toBe('fulfilled');

      // Linearized join outcome: either joined before revoke or rejected with 404
      if (joinResult.status === 'fulfilled') {
        expect(joinResult.value.outcome).toBe('pending');
      } else {
        expect(joinResult.reason.statusCode).toBe(404);
      }

      // After revocation commits, any subsequent join with that token MUST fail with 404
      const secondJoiner = await createSyntheticUser(pool, 'Second Joiner Race', 'secjoinrace', { status: 'active' });
      await connectSyntheticJiraAccount(pool, secondJoiner);

      await expect(
        repoMain.joinWorkspaceWithInvite(secondJoiner, inv.inviteToken)
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    describe('Transition CAS & State Machine Guards', () => {
      it('rejects decision when target is in an incompatible status with 409 (approve/reject only pending, remove only active)', async () => {
        // 1. Attempting to reject active admin1 with current version must deny 409 and retain active admin
        await expect(
          repoMain.decideMember(wsId, admin2Id, admin1Id, {
            decision: 'reject',
            expectedVersion: 1,
          })
        ).rejects.toMatchObject({ statusCode: 409 });

        // Database check: admin1 must still be active admin with version 1
        const admin1Mem = (
          await pool.query(
            `SELECT role, status, version FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2`,
            [wsId, admin1Id]
          )
        ).rows[0];
        expect(admin1Mem).toEqual({
          role: 'admin',
          status: 'active',
          version: 1,
        });

        // 2. Reject already active ordinary member must deny 409
        const activeMemberId = await createSyntheticUser(pool, 'Active Ordinary Member', 'actord', { status: 'active' });
        await pool.query(
          `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version)
           VALUES ($1, $2, 'member', 'active', 2)`,
          [wsId, activeMemberId]
        );
        await expect(
          repoMain.decideMember(wsId, admin1Id, activeMemberId, {
            decision: 'reject',
            expectedVersion: 2,
          })
        ).rejects.toMatchObject({ statusCode: 409 });

        // 3. Remove pending member must deny 409 (must use reject for pending)
        await expect(
          repoMain.decideMember(wsId, admin1Id, pendingUserId, {
            decision: 'remove',
            expectedVersion: 1,
          })
        ).rejects.toMatchObject({ statusCode: 409 });

        // 4. Approve previously rejected member must deny 409 until new invite + pending rejoin
        const rejectedUserId = await createSyntheticUser(pool, 'Rejected User', 'rejuser', { status: 'active' });
        await pool.query(
          `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version, decided_at)
           VALUES ($1, $2, 'member', 'rejected', 2, clock_timestamp())`,
          [wsId, rejectedUserId]
        );
        await expect(
          repoMain.decideMember(wsId, admin1Id, rejectedUserId, {
            decision: 'approve',
            expectedVersion: 2,
          })
        ).rejects.toMatchObject({ statusCode: 409 });
      });

      it('rejects rejecting the SOLE active admin with 409, leaving membership and audit unchanged', async () => {
        // Create an isolated workspace with exactly 1 admin (admin1Id)
        const soleWs = await repoMain.createWorkspaceWithBootstrapAdmin(sysAdminId, {
          slug: `ws-sole-${randomUUID().slice(0, 8)}`,
          name: 'Sole Admin WS',
          bootstrapAdminUserId: admin1Id,
        });
        const soleWsId = soleWs.workspace.id;

        // Admin1 attempts to reject themselves
        await expect(
          repoMain.decideMember(soleWsId, admin1Id, admin1Id, {
            decision: 'reject',
            expectedVersion: 1,
          })
        ).rejects.toMatchObject({ statusCode: 409 });

        // Assert admin1 remains active admin with version 1
        const mem = (
          await pool.query(
            `SELECT role, status, version FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2`,
            [soleWsId, admin1Id]
          )
        ).rows[0];
        expect(mem).toEqual({
          role: 'admin',
          status: 'active',
          version: 1,
        });

        // Assert NO decide_member audit record exists
        const audit = await pool.query(
          `SELECT count(*) FROM jira_authorization_audit WHERE workspace_id = $1 AND action = 'decide_member'`,
          [soleWsId]
        );
        expect(audit.rows[0].count).toBe('0');
      });

      it('rejects approving previously removed membership with 409, leaving membership and audit unchanged', async () => {
        const removedUserId = await createSyntheticUser(pool, 'Removed State User', 'remstate', { status: 'active' });
        await pool.query(
          `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version, decided_at)
           VALUES ($1, $2, 'member', 'removed', 2, clock_timestamp())`,
          [wsId, removedUserId]
        );

        // Record audit count before attempt
        const auditBefore = (
          await pool.query(
            `SELECT count(*) FROM jira_authorization_audit WHERE workspace_id = $1 AND action = 'decide_member'`,
            [wsId]
          )
        ).rows[0].count;

        await expect(
          repoMain.decideMember(wsId, admin1Id, removedUserId, {
            decision: 'approve',
            expectedVersion: 2,
          })
        ).rejects.toMatchObject({ statusCode: 409 });

        // Assert status and version remain unchanged
        const mem = (
          await pool.query(
            `SELECT status, version FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2`,
            [wsId, removedUserId]
          )
        ).rows[0];
        expect(mem.status).toBe('removed');
        expect(mem.version).toBe(2);

        // Assert no new decide_member audit record created
        const auditAfter = (
          await pool.query(
            `SELECT count(*) FROM jira_authorization_audit WHERE workspace_id = $1 AND action = 'decide_member'`,
            [wsId]
          )
        ).rows[0].count;
        expect(auditAfter).toBe(auditBefore);
      });
    });

    describe('Private Workspace Denial (No 403/404 Information Leak)', () => {
      it('returns 404 to authenticated outsiders and removed users for both existing workspaces and unknown UUIDs', async () => {
        const outsiderId = await createSyntheticUser(pool, 'Outsider User', 'outsider', { status: 'active' });
        const removedId = await createSyntheticUser(pool, 'Removed User', 'removeduser', { status: 'active' });
        await pool.query(
          `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version, decided_at)
           VALUES ($1, $2, 'member', 'removed', 2, clock_timestamp())`,
          [wsId, removedId]
        );

        const unknownWsId = randomUUID();

        // Existing workspace: outsider and removed user must get 404 (not leak 403)
        await expect(repoMain.createInvite(wsId, outsiderId)).rejects.toMatchObject({ statusCode: 404 });
        await expect(repoMain.createInvite(wsId, removedId)).rejects.toMatchObject({ statusCode: 404 });
        await expect(repoMain.listInvites(wsId, outsiderId)).rejects.toMatchObject({ statusCode: 404 });
        await expect(repoMain.listInvites(wsId, removedId)).rejects.toMatchObject({ statusCode: 404 });
        await expect(repoMain.revokeInvite(wsId, outsiderId, randomUUID())).rejects.toMatchObject({ statusCode: 404 });
        await expect(repoMain.revokeInvite(wsId, removedId, randomUUID())).rejects.toMatchObject({ statusCode: 404 });
        await expect(
          repoMain.decideMember(wsId, outsiderId, pendingUserId, { decision: 'approve', expectedVersion: 1 })
        ).rejects.toMatchObject({ statusCode: 404 });
        await expect(
          repoMain.decideMember(wsId, removedId, pendingUserId, { decision: 'approve', expectedVersion: 1 })
        ).rejects.toMatchObject({ statusCode: 404 });

        // Unknown workspace: outsider gets 404 identically
        await expect(repoMain.createInvite(unknownWsId, outsiderId)).rejects.toMatchObject({ statusCode: 404 });
        await expect(repoMain.listInvites(unknownWsId, outsiderId)).rejects.toMatchObject({ statusCode: 404 });
        await expect(repoMain.revokeInvite(unknownWsId, outsiderId, randomUUID())).rejects.toMatchObject({ statusCode: 404 });
        await expect(
          repoMain.decideMember(unknownWsId, outsiderId, pendingUserId, { decision: 'approve', expectedVersion: 1 })
        ).rejects.toMatchObject({ statusCode: 404 });
      });
    });
  });

  describe('6. archiveWorkspace and recoverWorkspaceAdmin', () => {
    let wsId: string;

    beforeEach(async () => {
      const created = await repoMain.createWorkspaceWithBootstrapAdmin(sysAdminId, {
        slug: `ws-arch-${randomUUID().slice(0, 8)}`,
        name: 'Archive Test WS',
        bootstrapAdminUserId: userAlphaId,
      });
      wsId = created.workspace.id;
    });

    it('allows system admin to archive workspace with version increment', async () => {
      const res = await repoMain.archiveWorkspace(sysAdminId, wsId, 1);
      expect(res.workspaceVersion).toBe(2);

      const dbCheck = (
        await pool.query(`SELECT status, version, archived_at FROM ati_workspaces WHERE id = $1`, [wsId])
      ).rows[0];
      expect(dbCheck.status).toBe('archived');
      expect(dbCheck.version).toBe(2);
      expect(dbCheck.archived_at).not.toBeNull();
    });

    it('rejects archiveWorkspace by non-system-admin with 403', async () => {
      await expect(repoMain.archiveWorkspace(sysMemberId, wsId, 1)).rejects.toMatchObject({
        statusCode: 403,
      });
    });

    it('rejects archiveWorkspace with stale expectedVersion with 409', async () => {
      await expect(repoMain.archiveWorkspace(sysAdminId, wsId, 99)).rejects.toMatchObject({
        statusCode: 409,
        code: 'STALE_VERSION',
      });
    });

    it('rejects archiveWorkspace for unknown workspace UUID with 404', async () => {
      await expect(repoMain.archiveWorkspace(sysAdminId, randomUUID(), 1)).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it('allows system admin to recover workspace admin with version increment', async () => {
      const res = await repoMain.recoverWorkspaceAdmin(sysAdminId, wsId, {
        expectedVersion: 1,
        userId: userGammaId,
      });
      expect(res.workspaceVersion).toBe(2);

      // Verify userGamma is now active admin in workspace
      const mem = (
        await pool.query(
          `SELECT role, status FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2`,
          [wsId, userGammaId]
        )
      ).rows[0];
      expect(mem).toEqual({
        role: 'admin',
        status: 'active',
      });
    });

    it('rejects recoverWorkspaceAdmin by non-system-admin with 403', async () => {
      await expect(
        repoMain.recoverWorkspaceAdmin(sysMemberId, wsId, {
          expectedVersion: 1,
          userId: userGammaId,
        })
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('rejects recoverWorkspaceAdmin with stale expectedVersion with 409', async () => {
      await expect(
        repoMain.recoverWorkspaceAdmin(sysAdminId, wsId, {
          expectedVersion: 99,
          userId: userGammaId,
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'STALE_VERSION',
      });
    });

    it('denies archiveWorkspace with 403 if system admin is demoted while blocked on workspace lock', async () => {
      const racingSysAdmin = await createSyntheticUser(pool, 'Racing SysAdmin Arch', 'racearch', {
        role: 'admin',
        status: 'active',
      });
      const ws = await repoMain.createWorkspaceWithBootstrapAdmin(sysAdminId, {
        slug: `ws-arch-race-${randomUUID().slice(0, 8)}`,
        name: 'Arch Race WS',
        bootstrapAdminUserId: userAlphaId,
      });

      const barrierClient = await pool.connect();
      let allSettledPromise: Promise<[PromiseSettledResult<any>]> | null = null;
      try {
        await barrierClient.query('BEGIN');
        await barrierClient.query('SELECT id FROM ati_workspaces WHERE id = $1 FOR UPDATE', [ws.workspace.id]);

        const p1 = repo1.archiveWorkspace(racingSysAdmin, ws.workspace.id, 1);
        allSettledPromise = Promise.allSettled([p1]);

        await waitForBlockedQueries(pool, [appTag1], 5000);

        // Demote racingSysAdmin from system admin to member while blocked on the lock
        await pool.query(`UPDATE users SET role = 'member' WHERE id = $1`, [racingSysAdmin]);

        await barrierClient.query('COMMIT');
      } finally {
        try {
          await barrierClient.query('ROLLBACK');
        } catch {}
        barrierClient.release();
        if (allSettledPromise) {
          await allSettledPromise;
        }
      }

      const [res] = await allSettledPromise!;
      expect(res.status).toBe('rejected');
      expect((res as PromiseRejectedResult).reason).toMatchObject({ statusCode: 403 });

      // DB check: workspace remains untouched
      const check = (await pool.query('SELECT status, version FROM ati_workspaces WHERE id = $1', [ws.workspace.id])).rows[0];
      expect(check.status).toBe('active');
      expect(check.version).toBe(1);
    });

    it('denies recoverWorkspaceAdmin with 403 if system admin is demoted while blocked on workspace lock', async () => {
      const racingSysAdmin = await createSyntheticUser(pool, 'Racing SysAdmin Recov', 'racerecov', {
        role: 'admin',
        status: 'active',
      });
      const ws = await repoMain.createWorkspaceWithBootstrapAdmin(sysAdminId, {
        slug: `ws-recov-race-${randomUUID().slice(0, 8)}`,
        name: 'Recov Race WS',
        bootstrapAdminUserId: userAlphaId,
      });

      const barrierClient = await pool.connect();
      let allSettledPromise: Promise<[PromiseSettledResult<any>]> | null = null;
      try {
        await barrierClient.query('BEGIN');
        await barrierClient.query('SELECT id FROM ati_workspaces WHERE id = $1 FOR UPDATE', [ws.workspace.id]);

        const p1 = repo1.recoverWorkspaceAdmin(racingSysAdmin, ws.workspace.id, {
          expectedVersion: 1,
          userId: userGammaId,
        });
        allSettledPromise = Promise.allSettled([p1]);

        await waitForBlockedQueries(pool, [appTag1], 5000);

        await pool.query(`UPDATE users SET role = 'member' WHERE id = $1`, [racingSysAdmin]);

        await barrierClient.query('COMMIT');
      } finally {
        try {
          await barrierClient.query('ROLLBACK');
        } catch {}
        barrierClient.release();
        if (allSettledPromise) {
          await allSettledPromise;
        }
      }

      const [res] = await allSettledPromise!;
      expect(res.status).toBe('rejected');
      expect((res as PromiseRejectedResult).reason).toMatchObject({ statusCode: 403 });

      // DB check: userGamma was not promoted to admin in this workspace
      const check = await pool.query(
        'SELECT count(*) FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
        [ws.workspace.id, userGammaId]
      );
      expect(check.rows[0].count).toBe('0');
    });

    it('validates expectedVersion: rejects non-positive or non-integer values with 400', async () => {
      const ws = await repoMain.createWorkspaceWithBootstrapAdmin(sysAdminId, {
        slug: `ws-ver-val-${randomUUID().slice(0, 8)}`,
        name: 'Ver Val WS',
        bootstrapAdminUserId: userAlphaId,
      });

      const invalidVersions = [0, -1, 1.5, NaN, Infinity, '1' as any, null as any, undefined as any];

      for (const badVer of invalidVersions) {
        await expect(repoMain.archiveWorkspace(sysAdminId, ws.workspace.id, badVer)).rejects.toMatchObject({
          statusCode: 400,
        });
        await expect(
          repoMain.recoverWorkspaceAdmin(sysAdminId, ws.workspace.id, {
            expectedVersion: badVer,
            userId: userGammaId,
          })
        ).rejects.toMatchObject({
          statusCode: 400,
        });
        await expect(
          repoMain.decideMember(ws.workspace.id, userAlphaId, userBetaId, {
            decision: 'approve',
            expectedVersion: badVer,
          })
        ).rejects.toMatchObject({
          statusCode: 400,
        });
      }

      // Verify DB audit log unchanged (only the initial create_workspace audit row)
      const audit = await pool.query('SELECT count(*) FROM jira_authorization_audit WHERE workspace_id = $1', [
        ws.workspace.id,
      ]);
      expect(audit.rows[0].count).toBe('1');
    });
  });
});
