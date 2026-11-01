import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { randomUUID, createHash } from 'node:crypto';
import type pg from 'pg';
import { createApp, type AppOptions } from '../../src/app.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { UserRepo } from '../../src/db/repositories/user-repo.js';
import { SessionRepo } from '../../src/db/repositories/session-repo.js';
import WorkspaceRepo, { type NativeAdminVerifier } from '../../src/db/repositories/workspace/index.js';
import type {
  CreateWorkspaceRequest,
  CreateWorkspaceResponse,
  CreateInviteRequest,
  CreateInviteResponse,
  RevokeInviteResponse,
  GetWorkspacesResponse,
  WorkspaceSummary,
  WorkspaceJoinRequest,
  WorkspaceJoinResponse,
  ListWorkspaceMembersResponse,
  WorkspaceMemberItem,
  MemberDecisionRequest,
  MemberDecisionResponse,
  ListWorkspaceInvitesResponse,
  WorkspaceInviteItem,
  LinkWorkspaceSiteRequest,
  LinkWorkspaceSiteResponse,
  UpdateWorkspaceSiteRequest,
  UpdateWorkspaceSiteResponse,
  GetWorkspaceProjectsResponse,
  ConfigureWorkspaceProjectsRequest,
  ConfigureWorkspaceProjectsResponse,
  ListWorkspaceSitesResponse,
  WorkspaceSiteItem,
  WorkspaceJiraCapabilitiesResponse,
} from '@wap/tool-schemas';
import {
  createIsolatedTestSchema,
  createSyntheticUser,
  connectSyntheticJiraAccount,
  type IsolatedTestContext,
} from '../helpers/jira-test-db.js';

interface TestActor {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'member';
  sid: string;
  token: string;
}

describe('apps/chat-api — JIRA-03 Workspace HTTP API Routes & DTOs', () => {
  let ctx: IsolatedTestContext;
  let pool: pg.Pool;
  let userRepo: UserRepo;
  let sessionRepo: SessionRepo;
  let defaultRepo: WorkspaceRepo;
  let verifiedRepo: WorkspaceRepo;

  const jwtSecret = 'test_secret_for_jira_workspaces_routes_32_chars';

  // Reliable fake verifier for testing canonical site/project mapping at external provider boundary
  const trustedVerifier: NativeAdminVerifier = {
    verifyAdminister: async (evidence) => {
      if (evidence.cloudId === 'cloud-verified-1') {
        return {
          status: 'granted',
          siteName: 'Official Engineering Jira',
          siteUrl: 'https://official-eng.atlassian.net',
          verifiedProjectIds: ['10001', '10002'],
          verifiedProjects: [
            { projectId: '10001', key: 'ENG', name: 'Engineering Core' },
            { projectId: '10002', key: 'OPS', name: 'Operations' },
          ],
        };
      }
      return { status: 'denied', reason: 'Caller does not possess native ADMINISTER permission' };
    },
  };

  function buildApp(
    repo?: WorkspaceRepo,
    rateLimitOptions?: { limit: number; windowMs: number; clock?: () => number }
  ) {
    return createApp({
      jwtSecret,
      userRepo,
      sessionRepo,
      authClock: () => Date.now(),
      runtimeMode: 'sandbox',
      workspaceRepo: repo,
      workspaceRateLimit: rateLimitOptions,
    });
  }

  // Real database session and JWT token generation
  async function createActor(name: string, prefix: string, role: 'admin' | 'member' = 'member'): Promise<TestActor> {
    const userId = await createSyntheticUser(pool, name, prefix, { role, status: 'active' });
    const userRow = await userRepo.findById(userId);
    const email = userRow?.email ?? `${prefix}_${randomUUID().slice(0, 8)}@example.test`;
    const { sessionId } = await sessionRepo.create(userId, 'test-agent');
    const token = generateAccessToken(
      { id: userId, email, name, role, status: 'active' },
      jwtSecret,
      sessionId
    ).accessToken;

    return { id: userId, email, name, role, sid: sessionId, token };
  }

  async function seedWorkspace(name: string, slug: string, createdBy: string, status = 'active'): Promise<string> {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO ati_workspaces (id, slug, name, status, version, created_by)
       VALUES ($1, $2, $3, $4, 1, $5)
       RETURNING id`,
      [randomUUID(), slug, name, status, createdBy]
    );
    const row = res.rows[0];
    if (!row) {
      throw new Error('Failed to seed workspace: missing returning row');
    }
    return row.id;
  }

  async function seedMembership(
    workspaceId: string,
    userId: string,
    role: 'admin' | 'member',
    status: 'pending' | 'active' | 'rejected' | 'removed',
    version = 1
  ): Promise<void> {
    await pool.query(
      `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version, requested_at, decided_at)
       VALUES ($1, $2, $3, $4, $5, clock_timestamp(), clock_timestamp())
       ON CONFLICT (workspace_id, user_id)
       DO UPDATE SET status = EXCLUDED.status, role = EXCLUDED.role, version = EXCLUDED.version`,
      [workspaceId, userId, role, status, version]
    );
  }

  async function seedGrant(accountId: string, cloudId = 'cloud-verified-1'): Promise<string> {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO jira_oauth_grants (
         id, account_id, app_client_id, grant_kind,
         encrypted_access_token, encrypted_refresh_token, scopes, token_version
       ) VALUES ($1, $2, 'test-client', 'identity_and_sites', 'enc_acc', 'enc_ref', $3::text[], 1)
       RETURNING id`,
      [randomUUID(), accountId, ['read:jira-work']]
    );
    const row = res.rows[0];
    if (!row) {
      throw new Error('Failed to seed grant: missing returning row');
    }
    const grantId = row.id;

    await pool.query(
      `INSERT INTO jira_grant_sites (
         id, grant_id, cloud_id, site_url, site_name, product_type
       ) VALUES ($1, $2, $3, 'https://official-eng.atlassian.net', 'Official Engineering Jira', 'jira')
       ON CONFLICT (grant_id, cloud_id) DO NOTHING`,
      [randomUUID(), grantId, cloudId]
    );

    return grantId;
  }

  beforeAll(async () => {
    ctx = await createIsolatedTestSchema({ maxConnections: 4 });
    pool = ctx.pool;
    await ctx.runAllMigrations();

    userRepo = new UserRepo(pool);
    sessionRepo = new SessionRepo(pool);
    defaultRepo = new WorkspaceRepo(pool);
    verifiedRepo = new WorkspaceRepo(pool, { verifier: trustedVerifier });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  // ============================================================================
  // Suite 1: System Admin Workspace Lifecycle (/api/admin/workspaces)
  // ============================================================================
  describe('1. POST /api/admin/workspaces & Recovery Routes', () => {
    it('creates workspace with bootstrap admin atomically when caller is DB system admin', async () => {
      const app = buildApp(defaultRepo);
      const sysAdmin = await createActor('System Admin', 'sysadmin', 'admin');
      const bootstrapUser = await createActor('Bootstrap Admin', 'bootstrap', 'member');

      const reqBody: CreateWorkspaceRequest = {
        name: 'Alpha Engineering',
        slug: `alpha-eng-${randomUUID().slice(0, 8)}`,
        bootstrapAdminUserId: bootstrapUser.id,
      };

      const res = await request(app)
        .post('/api/admin/workspaces')
        .set('Authorization', `Bearer ${sysAdmin.token}`)
        .send(reqBody);

      expect(res.status).toBe(201);
      const data = res.body as CreateWorkspaceResponse;
      expect(data.workspace).toBeDefined();
      expect(data.workspace.id).toBeDefined();
      expect(data.workspace.name).toBe(reqBody.name);
      expect(data.workspace.slug).toBe(reqBody.slug);
      expect(data.workspace.version).toBe(1);

      // Verify SQL side-effects: workspace, bootstrap membership, and audit row
      const wsRow = (
        await pool.query('SELECT status, created_by FROM ati_workspaces WHERE id = $1', [data.workspace.id])
      ).rows[0];
      expect(wsRow.status).toBe('active');
      expect(wsRow.created_by).toBe(sysAdmin.id);

      const memRow = (
        await pool.query(
          'SELECT role, status, version FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
          [data.workspace.id, bootstrapUser.id]
        )
      ).rows[0];
      expect(memRow.role).toBe('admin');
      expect(memRow.status).toBe('active');
      expect(memRow.version).toBe(1);

      const auditRow = (
        await pool.query(
          "SELECT action, decision FROM jira_authorization_audit WHERE workspace_id = $1 AND action = 'create_workspace'",
          [data.workspace.id]
        )
      ).rows[0];
      expect(auditRow).toBeDefined();
      expect(auditRow.decision).toBe('allow');
    });

    it('rejects unauthenticated requests with 401', async () => {
      const app = buildApp(defaultRepo);
      const res = await request(app)
        .post('/api/admin/workspaces')
        .send({ name: 'Unauth WS', slug: 'unauth-ws', bootstrapAdminUserId: randomUUID() });

      expect(res.status).toBe(401);
    });

    it('rejects ordinary member with 403 even if JWT role is spoofed', async () => {
      const app = buildApp(defaultRepo);
      const ordinaryMember = await createActor('Ordinary Member', 'ordmember', 'member');

      // Craft spoofed token where payload claims role: admin, but DB user is role: member
      const spoofedToken = generateAccessToken(
        { id: ordinaryMember.id, email: ordinaryMember.email, name: ordinaryMember.name, role: 'admin' },
        jwtSecret,
        ordinaryMember.sid
      ).accessToken;

      const res = await request(app)
        .post('/api/admin/workspaces')
        .set('Authorization', `Bearer ${spoofedToken}`)
        .send({
          name: 'Spoofed WS',
          slug: `spoofed-${randomUUID().slice(0, 8)}`,
          bootstrapAdminUserId: ordinaryMember.id,
        });

      expect(res.status).toBe(403);
    });

    it('sanitizes duplicate slug conflict and returns 409 without SQL error leaks', async () => {
      const app = buildApp(defaultRepo);
      const sysAdmin = await createActor('System Admin Slug', 'slugadmin', 'admin');
      const bootstrapUser = await createActor('Bootstrap Slug', 'slugboot', 'member');
      const slug = `dup-slug-${randomUUID().slice(0, 8)}`;

      await defaultRepo.createWorkspaceWithBootstrapAdmin(sysAdmin.id, {
        name: 'First WS',
        slug,
        bootstrapAdminUserId: bootstrapUser.id,
      });

      const res = await request(app)
        .post('/api/admin/workspaces')
        .set('Authorization', `Bearer ${sysAdmin.token}`)
        .send({
          name: 'Second WS',
          slug,
          bootstrapAdminUserId: bootstrapUser.id,
        });

      expect(res.status).toBe(409);
      expect(JSON.stringify(res.body)).not.toMatch(/Key \(slug\)=/i);
      expect(JSON.stringify(res.body)).not.toMatch(/PostgreSQL/i);
    });

    it('validates request payload and rejects malformed or missing fields with 400', async () => {
      const app = buildApp(defaultRepo);
      const sysAdmin = await createActor('System Admin Val', 'valadmin', 'admin');

      const badPayloads = [
        {},
        { name: 'Missing Slug', bootstrapAdminUserId: randomUUID() },
        { slug: 'missing-name', bootstrapAdminUserId: randomUUID() },
        { name: 'Bad UUID', slug: 'bad-uuid', bootstrapAdminUserId: 'not-a-uuid' },
      ];

      for (const payload of badPayloads) {
        const res = await request(app)
          .post('/api/admin/workspaces')
          .set('Authorization', `Bearer ${sysAdmin.token}`)
          .send(payload);

        expect(res.status).toBe(400);
      }
    });

    it('archives workspace with expectedVersion under system admin authority', async () => {
      const app = buildApp(defaultRepo);
      const sysAdmin = await createActor('System Admin Arch', 'archadmin', 'admin');
      const wsId = await seedWorkspace('WS to Archive', `ws-arch-${randomUUID().slice(0, 8)}`, sysAdmin.id);

      const res = await request(app)
        .post(`/api/admin/workspaces/${wsId}/archive`)
        .set('Authorization', `Bearer ${sysAdmin.token}`)
        .send({ expectedVersion: 1 });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ archived: true });

      const check = (await pool.query('SELECT status, version FROM ati_workspaces WHERE id = $1', [wsId])).rows[0];
      expect(check.status).toBe('archived');
      expect(check.version).toBe(2);
    });

    it('rejects archive with 409 on stale version and 400 on invalid expectedVersion', async () => {
      const app = buildApp(defaultRepo);
      const sysAdmin = await createActor('System Admin Arch Stale', 'archstale', 'admin');
      const wsId = await seedWorkspace('WS Stale', `ws-stale-${randomUUID().slice(0, 8)}`, sysAdmin.id);

      // Stale version -> 409
      const staleRes = await request(app)
        .post(`/api/admin/workspaces/${wsId}/archive`)
        .set('Authorization', `Bearer ${sysAdmin.token}`)
        .send({ expectedVersion: 999 });
      expect(staleRes.status).toBe(409);

      // Invalid expectedVersion (non-positive / not integer) -> 400
      const badRes = await request(app)
        .post(`/api/admin/workspaces/${wsId}/archive`)
        .set('Authorization', `Bearer ${sysAdmin.token}`)
        .send({ expectedVersion: 0 });
      expect(badRes.status).toBe(400);
    });

    it('recovers workspace administrator with expectedVersion mapping newAdminUserId', async () => {
      const app = buildApp(defaultRepo);
      const sysAdmin = await createActor('System Admin Rec', 'recadmin', 'admin');
      const newAdmin = await createActor('New Admin Target', 'newadmin', 'member');
      const wsId = await seedWorkspace('WS Recover', `ws-rec-${randomUUID().slice(0, 8)}`, sysAdmin.id);

      const res = await request(app)
        .post(`/api/admin/workspaces/${wsId}/recover-admin`)
        .set('Authorization', `Bearer ${sysAdmin.token}`)
        .send({ expectedVersion: 1, newAdminUserId: newAdmin.id });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ recovered: true });

      const memCheck = (
        await pool.query(
          'SELECT role, status FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
          [wsId, newAdmin.id]
        )
      ).rows[0];
      expect(memCheck.role).toBe('admin');
      expect(memCheck.status).toBe('active');
    });

    it('rejects recover-admin by ordinary workspace admin with 403', async () => {
      const app = buildApp(defaultRepo);
      const ordinaryUser = await createActor('Ordinary WS Admin', 'ordwsadmin', 'member');
      const wsId = await seedWorkspace('WS Rec 403', `ws-rec-403-${randomUUID().slice(0, 8)}`, ordinaryUser.id);
      await seedMembership(wsId, ordinaryUser.id, 'admin', 'active');

      const res = await request(app)
        .post(`/api/admin/workspaces/${wsId}/recover-admin`)
        .set('Authorization', `Bearer ${ordinaryUser.token}`)
        .send({ expectedVersion: 1, newAdminUserId: ordinaryUser.id });

      expect(res.status).toBe(403);
    });
  });

  // ============================================================================
  // Suite 2: Personal Workspaces Listing (GET /api/workspaces)
  // ============================================================================
  describe('2. GET /api/workspaces (Personal Workspaces Listing)', () => {
    it('returns only own related active workspaces across all 4 membership states without leaking unrelated or archived workspaces', async () => {
      const app = buildApp(defaultRepo);
      const caller = await createActor('Listing User', 'listuser', 'member');
      const otherUser = await createActor('Other WS User', 'otheruser', 'member');

      // 1. wsActive: caller is active member
      const wsActiveId = await seedWorkspace('Active WS', `ws-act-${randomUUID().slice(0, 8)}`, otherUser.id);
      await seedMembership(wsActiveId, caller.id, 'member', 'active');

      // 2. wsPending: caller is pending member
      const wsPendingId = await seedWorkspace('Pending WS', `ws-pend-${randomUUID().slice(0, 8)}`, otherUser.id);
      await seedMembership(wsPendingId, caller.id, 'member', 'pending');

      // 3. wsRejected: caller is rejected member
      const wsRejectedId = await seedWorkspace('Rejected WS', `ws-rej-${randomUUID().slice(0, 8)}`, otherUser.id);
      await seedMembership(wsRejectedId, caller.id, 'member', 'rejected');

      // 4. wsRemoved: caller is removed member
      const wsRemovedId = await seedWorkspace('Removed WS', `ws-rem-${randomUUID().slice(0, 8)}`, otherUser.id);
      await seedMembership(wsRemovedId, caller.id, 'member', 'removed');

      // 5. wsUnrelated: caller has no membership
      const wsUnrelatedId = await seedWorkspace('Unrelated WS', `ws-unrel-${randomUUID().slice(0, 8)}`, otherUser.id);
      await seedMembership(wsUnrelatedId, otherUser.id, 'admin', 'active');

      // 6. wsArchived: caller was active, but workspace is archived
      const wsArchivedId = await seedWorkspace('Archived WS', `ws-archived-${randomUUID().slice(0, 8)}`, otherUser.id, 'archived');
      await seedMembership(wsArchivedId, caller.id, 'member', 'active');

      const res = await request(app)
        .get('/api/workspaces')
        .set('Authorization', `Bearer ${caller.token}`);

      expect(res.status).toBe(200);
      const data = res.body as GetWorkspacesResponse;
      expect(Array.isArray(data.workspaces)).toBe(true);

      const returnedIds = data.workspaces.map((w: WorkspaceSummary) => w.id);
      expect(returnedIds).toContain(wsActiveId);
      expect(returnedIds).toContain(wsPendingId);
      expect(returnedIds).toContain(wsRejectedId);
      expect(returnedIds).toContain(wsRemovedId);
      expect(returnedIds).not.toContain(wsUnrelatedId);
      expect(returnedIds).not.toContain(wsArchivedId);

      // Verify canonical fields and absence of sensitive tokens or Jira sites
      for (const w of data.workspaces) {
        expect(w.id).toBeDefined();
        expect(w.name).toBeDefined();
        expect(w.slug).toBeDefined();
        expect(w.role).toBeDefined();
        expect(w.membershipStatus).toBeDefined();
        expect(w.workspaceVersion).toBeDefined();
        expect(w.membershipVersion).toBeDefined();
        expect(w).not.toHaveProperty('inviteToken');
        expect(w).not.toHaveProperty('token_hash');
        expect(w).not.toHaveProperty('sites');
      }
    });

    it('rejects unauthenticated request with 401', async () => {
      const app = buildApp(defaultRepo);
      const res = await request(app).get('/api/workspaces');
      expect(res.status).toBe(401);
    });
  });

  // ============================================================================
  // Suite 3: Join Requests (POST /api/workspace-join-requests)
  // ============================================================================
  describe('3. POST /api/workspace-join-requests (Server Account & Rejoin)', () => {
    it('creates pending join request when caller has connected Atlassian account in server DB', async () => {
      const app = buildApp(defaultRepo);
      const admin = await createActor('WS Admin Join', 'joinadmin', 'member');
      const joiner = await createActor('Joiner User', 'joiner', 'member');
      await connectSyntheticJiraAccount(pool, joiner.id);

      const wsId = await seedWorkspace('Join WS', `ws-join-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');

      const invite = await defaultRepo.createInvite(wsId, admin.id);

      const reqBody: WorkspaceJoinRequest = {
        inviteToken: invite.inviteToken,
      };

      const res = await request(app)
        .post('/api/workspace-join-requests')
        .set('Authorization', `Bearer ${joiner.token}`)
        .send(reqBody);

      expect(res.status).toBe(201);
      const data = res.body as WorkspaceJoinResponse;
      expect(data).toMatchObject({
        workspaceId: wsId,
        status: 'pending',
      });
      expect(typeof data.requestId).toBe('string');

      // Verify DB row created with status pending
      const memRow = (
        await pool.query(
          'SELECT status, role FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
          [wsId, joiner.id]
        )
      ).rows[0];
      expect(memRow.status).toBe('pending');
      expect(memRow.role).toBe('member');
    });

    it('rejects join request with 403 when caller has no connected Atlassian account regardless of request body', async () => {
      const app = buildApp(defaultRepo);
      const admin = await createActor('WS Admin NoAcc', 'noaccadmin', 'member');
      const unlinkedJoiner = await createActor('Unlinked Joiner', 'unlinked', 'member');

      const wsId = await seedWorkspace('NoAcc WS', `ws-noacc-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');
      const invite = await defaultRepo.createInvite(wsId, admin.id);

      // Attempt to spoof accountId in body
      const res = await request(app)
        .post('/api/workspace-join-requests')
        .set('Authorization', `Bearer ${unlinkedJoiner.token}`)
        .send({
          inviteToken: invite.inviteToken,
          accountId: 'spoofed-client-account-id',
        });

      expect(res.status).toBe(403);
      expect(res.body.code ?? res.body.error).toMatch(/ACCOUNT_NOT_CONNECTED/i);
    });

    it('returns 409 ALREADY_WORKSPACE_MEMBER when caller is already active, preserving active state', async () => {
      const app = buildApp(defaultRepo);
      const admin = await createActor('WS Admin Dup', 'dupadmin', 'member');
      const activeMember = await createActor('Active Joiner', 'actjoin', 'member');
      await connectSyntheticJiraAccount(pool, activeMember.id);

      const wsId = await seedWorkspace('Dup WS', `ws-dup-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');
      await seedMembership(wsId, activeMember.id, 'member', 'active', 2);
      const invite = await defaultRepo.createInvite(wsId, admin.id);

      const res = await request(app)
        .post('/api/workspace-join-requests')
        .set('Authorization', `Bearer ${activeMember.token}`)
        .send({ inviteToken: invite.inviteToken });

      expect(res.status).toBe(409);
      expect(res.body.code ?? res.body.error).toMatch(/ALREADY_WORKSPACE_MEMBER/i);

      // DB row must remain active with unchanged version
      const memRow = (
        await pool.query(
          'SELECT status, version FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
          [wsId, activeMember.id]
        )
      ).rows[0];
      expect(memRow.status).toBe('active');
      expect(memRow.version).toBe(2);
    });

    it('returns idempotent pending response when caller is already pending', async () => {
      const app = buildApp(defaultRepo);
      const admin = await createActor('WS Admin Idemp', 'idempadmin', 'member');
      const pendingMember = await createActor('Pending Joiner', 'pendjoin', 'member');
      await connectSyntheticJiraAccount(pool, pendingMember.id);

      const wsId = await seedWorkspace('Idemp WS', `ws-idemp-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');
      await seedMembership(wsId, pendingMember.id, 'member', 'pending', 1);
      const invite = await defaultRepo.createInvite(wsId, admin.id);

      const res = await request(app)
        .post('/api/workspace-join-requests')
        .set('Authorization', `Bearer ${pendingMember.token}`)
        .send({ inviteToken: invite.inviteToken });

      expect(res.status === 200 || res.status === 201).toBe(true);
      expect(res.body).toMatchObject({
        workspaceId: wsId,
        status: 'pending',
      });
    });

    it('rejects invalid, revoked, or expired invite token with 404', async () => {
      const app = buildApp(defaultRepo);
      const joiner = await createActor('Joiner Bad Inv', 'badinvjoin', 'member');
      await connectSyntheticJiraAccount(pool, joiner.id);

      // 1. Non-existent token -> 404
      const resNonExistent = await request(app)
        .post('/api/workspace-join-requests')
        .set('Authorization', `Bearer ${joiner.token}`)
        .send({ inviteToken: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' });
      expect(resNonExistent.status).toBe(404);

      // 2. Revoked token -> 404
      const admin = await createActor('Admin Rev', 'revadmin', 'member');
      const wsId = await seedWorkspace('Rev WS', `ws-rev-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');
      const invite = await defaultRepo.createInvite(wsId, admin.id);
      await defaultRepo.revokeInvite(wsId, admin.id, invite.inviteId);

      const resRevoked = await request(app)
        .post('/api/workspace-join-requests')
        .set('Authorization', `Bearer ${joiner.token}`)
        .send({ inviteToken: invite.inviteToken });
      expect(resRevoked.status).toBe(404);
    });
  });

  // ============================================================================
  // Suite 4: Members Administration & CAS Decisions
  // ============================================================================
  describe('4. /api/workspaces/:id/members & Decisions', () => {
    it('allows workspace admin to list members and returns canonical ListWorkspaceMembersResponse', async () => {
      const app = buildApp(defaultRepo);
      const admin = await createActor('Admin List Mem', 'memadmin', 'member');
      const targetUser = await createActor('Target Mem User', 'memuser', 'member');

      const wsId = await seedWorkspace('Mem WS', `ws-mem-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');
      await seedMembership(wsId, targetUser.id, 'member', 'pending');

      const res = await request(app)
        .get(`/api/workspaces/${wsId}/members`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      const data = res.body as ListWorkspaceMembersResponse;
      expect(Array.isArray(data.members)).toBe(true);
      expect(data.members.length).toBeGreaterThanOrEqual(2);

      const adminItem = data.members.find((m: WorkspaceMemberItem) => m.userId === admin.id);
      expect(adminItem).toMatchObject({
        userId: admin.id,
        role: 'admin',
        status: 'active',
      });

      const targetItem = data.members.find((m: WorkspaceMemberItem) => m.userId === targetUser.id);
      expect(targetItem).toMatchObject({
        userId: targetUser.id,
        role: 'member',
        status: 'pending',
      });
    });

    it('denies active ordinary member with 403 on member listing', async () => {
      const app = buildApp(defaultRepo);
      const admin = await createActor('Admin Mem 403', 'memadmin403', 'member');
      const ordinaryMember = await createActor('Ordinary Mem 403', 'ordmem403', 'member');

      const wsId = await seedWorkspace('Mem 403 WS', `ws-mem403-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');
      await seedMembership(wsId, ordinaryMember.id, 'member', 'active');

      const res = await request(app)
        .get(`/api/workspaces/${wsId}/members`)
        .set('Authorization', `Bearer ${ordinaryMember.token}`);

      expect(res.status).toBe(403);
    });

    it('hides member listing with 404 for outsiders and removed users (Hidden Privacy Pattern)', async () => {
      const app = buildApp(defaultRepo);
      const admin = await createActor('Admin Mem 404', 'memadmin404', 'member');
      const removedUser = await createActor('Removed Mem User', 'remuser', 'member');
      const outsider = await createActor('Outsider User', 'outuser', 'member');

      const wsId = await seedWorkspace('Mem 404 WS', `ws-mem404-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');
      await seedMembership(wsId, removedUser.id, 'member', 'removed');

      // Removed member -> 404
      const resRemoved = await request(app)
        .get(`/api/workspaces/${wsId}/members`)
        .set('Authorization', `Bearer ${removedUser.token}`);
      expect(resRemoved.status).toBe(404);

      // Unrelated outsider -> 404
      const resOutsider = await request(app)
        .get(`/api/workspaces/${wsId}/members`)
        .set('Authorization', `Bearer ${outsider.token}`);
      expect(resOutsider.status).toBe(404);

      // Unknown workspace UUID -> 404
      const resUnknown = await request(app)
        .get(`/api/workspaces/${randomUUID()}/members`)
        .set('Authorization', `Bearer ${outsider.token}`);
      expect(resUnknown.status).toBe(404);
    });

    it('executes atomic CAS decision to approve pending member and logs audit', async () => {
      const app = buildApp(defaultRepo);
      const admin = await createActor('Admin Decision', 'decadmin', 'member');
      const pendingMember = await createActor('Pending Decision', 'decpend', 'member');

      const wsId = await seedWorkspace('Dec WS', `ws-dec-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');
      await seedMembership(wsId, pendingMember.id, 'member', 'pending', 1);

      const decisionReq: MemberDecisionRequest = {
        expectedVersion: 1,
        decision: 'approve',
      };

      const res = await request(app)
        .post(`/api/workspaces/${wsId}/members/${pendingMember.id}/decision`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send(decisionReq);

      expect(res.status).toBe(200);
      const data = res.body as MemberDecisionResponse;
      expect(data).toMatchObject({
        status: 'active',
        version: 2,
      });

      // Verify SQL side-effects
      const memRow = (
        await pool.query(
          'SELECT status, version FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
          [wsId, pendingMember.id]
        )
      ).rows[0];
      expect(memRow.status).toBe('active');
      expect(memRow.version).toBe(2);

      const auditRow = (
        await pool.query(
          "SELECT action, decision FROM jira_authorization_audit WHERE workspace_id = $1 AND action = 'decide_member'",
          [wsId]
        )
      ).rows[0];
      expect(auditRow.decision).toBe('approve');
    });

    it('forbids self-approval with 409 or 403', async () => {
      const app = buildApp(defaultRepo);
      const admin = await createActor('Self Approver', 'selfapp', 'member');
      const wsId = await seedWorkspace('Self App WS', `ws-selfapp-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');

      const res = await request(app)
        .post(`/api/workspaces/${wsId}/members/${admin.id}/decision`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ expectedVersion: 1, decision: 'approve' });

      expect(res.status === 409 || res.status === 403).toBe(true);
      expect(JSON.stringify(res.body)).toMatch(/SELF_APPROVE_FORBIDDEN/i);
    });

    it('rejects invalid state transition and stale version with 409', async () => {
      const app = buildApp(defaultRepo);
      const admin = await createActor('Trans Admin', 'transadmin', 'member');
      const activeMember = await createActor('Active Target', 'acttarget', 'member');

      const wsId = await seedWorkspace('Trans WS', `ws-trans-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');
      await seedMembership(wsId, activeMember.id, 'member', 'active', 2);

      // Stale version -> 409
      const resStale = await request(app)
        .post(`/api/workspaces/${wsId}/members/${activeMember.id}/decision`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ expectedVersion: 1, decision: 'remove' });
      expect(resStale.status).toBe(409);

      // Invalid transition: reject active member -> 409
      const resInvalid = await request(app)
        .post(`/api/workspaces/${wsId}/members/${activeMember.id}/decision`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ expectedVersion: 2, decision: 'reject' });
      expect(resInvalid.status).toBe(409);
    });

    it('protects sole active admin against removal with 409 LAST_ACTIVE_ADMIN', async () => {
      const app = buildApp(defaultRepo);
      const soleAdmin = await createActor('Sole Admin', 'soleadmin', 'member');
      const wsId = await seedWorkspace('Sole WS', `ws-sole-${randomUUID().slice(0, 8)}`, soleAdmin.id);
      await seedMembership(wsId, soleAdmin.id, 'admin', 'active', 1);

      const res = await request(app)
        .post(`/api/workspaces/${wsId}/members/${soleAdmin.id}/decision`)
        .set('Authorization', `Bearer ${soleAdmin.token}`)
        .send({ expectedVersion: 1, decision: 'remove' });

      expect(res.status).toBe(409);
      expect(JSON.stringify(res.body)).toMatch(/LAST_ACTIVE_ADMIN/i);

      // Membership must remain active in DB
      const check = (
        await pool.query(
          'SELECT status, role FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
          [wsId, soleAdmin.id]
        )
      ).rows[0];
      expect(check.status).toBe('active');
      expect(check.role).toBe('admin');
    });

    it('ignores extraneous role elevation in decision payload', async () => {
      const app = buildApp(defaultRepo);
      const admin = await createActor('Tamper Admin', 'tamperadmin', 'member');
      const pendingMember = await createActor('Pending Tamper', 'tamperpend', 'member');

      const wsId = await seedWorkspace('Tamper WS', `ws-tamper-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');
      await seedMembership(wsId, pendingMember.id, 'member', 'pending', 1);

      // Attempt to elevate role to admin via unverified body property
      await request(app)
        .post(`/api/workspaces/${wsId}/members/${pendingMember.id}/decision`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ expectedVersion: 1, decision: 'approve', role: 'admin' });

      const check = (
        await pool.query(
          'SELECT role FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
          [wsId, pendingMember.id]
        )
      ).rows[0];
      expect(check.role).toBe('member'); // Must remain member
    });
  });

  // ============================================================================
  // Suite 5: Invites Administration (/api/workspaces/:id/invites)
  // ============================================================================
  describe('5. /api/workspaces/:id/invites (Secret Protection & Lifecycle)', () => {
    it('creates invite returning plaintext token only once, storing SHA-256 hash in DB', async () => {
      const app = buildApp(defaultRepo);
      const admin = await createActor('Invite Creator', 'invcreate', 'member');
      const wsId = await seedWorkspace('Inv WS', `ws-inv-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');

      const reqBody: CreateInviteRequest = { expiresInDays: 14 };

      const res = await request(app)
        .post(`/api/workspaces/${wsId}/invites`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send(reqBody);

      expect(res.status).toBe(201);
      const data = res.body as CreateInviteResponse;
      expect(data.inviteId).toBeDefined();
      expect(typeof data.inviteToken).toBe('string');
      expect(data.inviteToken.length).toBeGreaterThanOrEqual(32);
      expect(typeof data.expiresAt).toBe('string');

      // Verify DB stores hash ONLY
      const dbRow = (
        await pool.query('SELECT token_hash FROM ati_workspace_invites WHERE id = $1', [data.inviteId])
      ).rows[0];
      const expectedHash = createHash('sha256').update(data.inviteToken).digest('hex');
      expect(dbRow.token_hash).toBe(expectedHash);
    });

    it('defaults to 7 days expiry when CreateInviteRequest body is omitted', async () => {
      const app = buildApp(defaultRepo);
      const admin = await createActor('Def Inv Admin', 'definv', 'member');
      const wsId = await seedWorkspace('Def Inv WS', `ws-definv-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');

      const res = await request(app)
        .post(`/api/workspaces/${wsId}/invites`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(201);
      const data = res.body as CreateInviteResponse;
      expect(data.inviteToken).toBeDefined();

      const dbCheck = (
        await pool.query(
          `SELECT (expires_at > clock_timestamp() + interval '6 days 23 hours' AND expires_at < clock_timestamp() + interval '7 days 1 hour') AS around_7_days
           FROM ati_workspace_invites WHERE id = $1`,
          [data.inviteId]
        )
      ).rows[0];
      expect(dbCheck.around_7_days).toBe(true);
    });

    it('rejects untrusted expiresInDays with 400', async () => {
      const app = buildApp(defaultRepo);
      const admin = await createActor('Bad Exp Admin', 'badexp', 'member');
      const wsId = await seedWorkspace('Bad Exp WS', `ws-badexp-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');

      const badExpiries = [0, -1, 35, 1.5, 'bad'];
      for (const bad of badExpiries) {
        const res = await request(app)
          .post(`/api/workspaces/${wsId}/invites`)
          .set('Authorization', `Bearer ${admin.token}`)
          .send({ expiresInDays: bad });

        expect(res.status).toBe(400);
      }
    });

    it('lists invites without exposing token plaintext or hash', async () => {
      const app = buildApp(defaultRepo);
      const admin = await createActor('List Inv Admin', 'listinv', 'member');
      const wsId = await seedWorkspace('List Inv WS', `ws-listinv-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');

      await defaultRepo.createInvite(wsId, admin.id);

      const res = await request(app)
        .get(`/api/workspaces/${wsId}/invites`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      const data = res.body as ListWorkspaceInvitesResponse;
      expect(Array.isArray(data.invites)).toBe(true);
      expect(data.invites.length).toBeGreaterThan(0);

      for (const inv of data.invites) {
        expect(inv.id).toBeDefined();
        expect(inv.workspaceId).toBe(wsId);
        expect(inv.inviterUserId).toBeDefined();
        expect(typeof inv.expiresAt).toBe('string');
        expect(inv).not.toHaveProperty('inviteToken');
        expect(inv).not.toHaveProperty('token_hash');
      }
    });

    it('revokes an invite returning canonical RevokeInviteResponse', async () => {
      const app = buildApp(defaultRepo);
      const admin = await createActor('Revoke Inv Admin', 'revokadmin', 'member');
      const wsId = await seedWorkspace('Revoke Inv WS', `ws-revok-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');

      const invite = await defaultRepo.createInvite(wsId, admin.id);

      const res = await request(app)
        .delete(`/api/workspaces/${wsId}/invites/${invite.inviteId}`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      const data = res.body as RevokeInviteResponse;
      expect(data).toMatchObject({
        revoked: true,
      });
      expect(typeof data.revokedAt).toBe('string');

      const check = (
        await pool.query('SELECT revoked_at FROM ati_workspace_invites WHERE id = $1', [invite.inviteId])
      ).rows[0];
      expect(check.revoked_at).not.toBeNull();
    });

    it('denies active ordinary member with 403 on invite administration', async () => {
      const app = buildApp(defaultRepo);
      const admin = await createActor('Admin Inv 403', 'invadm403', 'member');
      const member = await createActor('Member Inv 403', 'invmem403', 'member');
      const wsId = await seedWorkspace('Inv 403 WS', `ws-inv403-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');
      await seedMembership(wsId, member.id, 'member', 'active');

      const resPost = await request(app)
        .post(`/api/workspaces/${wsId}/invites`)
        .set('Authorization', `Bearer ${member.token}`)
        .send({ expiresInDays: 7 });
      expect(resPost.status).toBe(403);

      const resGet = await request(app)
        .get(`/api/workspaces/${wsId}/invites`)
        .set('Authorization', `Bearer ${member.token}`);
      expect(resGet.status).toBe(403);
    });
  });

  // ============================================================================
  // Suite 6: Sites, Projects & Capabilities Administration
  // ============================================================================
  describe('6. Sites, Projects & Capabilities Administration (Fail-Closed & Verifier Boundary)', () => {
    it('fails closed with 503 NATIVE_VERIFIER_UNAVAILABLE when repository has no verifier configured', async () => {
      const unverifiedApp = buildApp(defaultRepo); // defaultRepo has verifier = undefined
      const admin = await createActor('No Verif Admin', 'noverif', 'member');
      const accountId = await connectSyntheticJiraAccount(pool, admin.id);
      await seedGrant(accountId);

      const wsId = await seedWorkspace('No Verif WS', `ws-noverif-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');

      // Attempt to link site without verifier -> 503 NATIVE_VERIFIER_UNAVAILABLE
      const resLink = await request(unverifiedApp)
        .post(`/api/workspaces/${wsId}/jira-sites`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ cloudId: 'cloud-verified-1' });

      expect(resLink.status === 503 || resLink.status === 403).toBe(true);
      expect(JSON.stringify(resLink.body)).toMatch(/NATIVE_VERIFIER_UNAVAILABLE|UNVERIFIED/i);

      // Capabilities -> 503 CAPABILITIES_UNAVAILABLE
      const resCaps = await request(unverifiedApp)
        .get(`/api/workspaces/${wsId}/jira-capabilities`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(resCaps.status).toBe(503);
      expect(JSON.stringify(resCaps.body)).toMatch(/CAPABILITIES_UNAVAILABLE/i);
    });

    it('allows deactivation safely under admin authority without native verifier', async () => {
      const unverifiedApp = buildApp(defaultRepo);
      const admin = await createActor('Deact Admin', 'deactadmin', 'member');
      const wsId = await seedWorkspace('Deact WS', `ws-deact-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');

      // Seed an active site directly into PostgreSQL
      const siteId = randomUUID();
      await pool.query(
        `INSERT INTO ati_workspace_jira_sites (
           id, workspace_id, cloud_id, site_name, site_url, active, policy_version, linked_by
         ) VALUES ($1, $2, 'cloud-deact-1', 'Active Site', 'https://deact.atlassian.net', true, 1, $3)`,
        [siteId, wsId, admin.id]
      );

      const updateReq: UpdateWorkspaceSiteRequest = {
        expectedPolicyVersion: 1,
        active: false,
      };

      const res = await request(unverifiedApp)
        .patch(`/api/workspaces/${wsId}/jira-sites/${siteId}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send(updateReq);

      expect(res.status).toBe(200);
      const data = res.body as UpdateWorkspaceSiteResponse;
      expect(data.site).toMatchObject({
        siteId,
        active: false,
        policyVersion: 2,
      });

      const dbCheck = (
        await pool.query('SELECT active, policy_version FROM ati_workspace_jira_sites WHERE id = $1', [siteId])
      ).rows[0];
      expect(dbCheck.active).toBe(false);
      expect(dbCheck.policy_version).toBe(2);
    });

    it('links site, lists sites, and configures projects when trusted verifier grants authority', async () => {
      const verifiedApp = buildApp(verifiedRepo); // verifiedRepo has trustedVerifier
      const admin = await createActor('Verif Admin', 'verifadmin', 'member');
      const accountId = await connectSyntheticJiraAccount(pool, admin.id);
      await seedGrant(accountId);

      const wsId = await seedWorkspace('Verif WS', `ws-verif-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');

      // 1. Link Site: POST /api/workspaces/:id/jira-sites
      const linkReq: LinkWorkspaceSiteRequest = { cloudId: 'cloud-verified-1' };
      const linkRes = await request(verifiedApp)
        .post(`/api/workspaces/${wsId}/jira-sites`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send(linkReq);

      expect(linkRes.status).toBe(201);
      const linkData = linkRes.body as LinkWorkspaceSiteResponse;
      expect(linkData.site).toBeDefined();
      expect(linkData.site.cloudId).toBe('cloud-verified-1');
      expect(linkData.site.name).toBe('Official Engineering Jira');
      const siteId = linkData.site.siteId;

      // 2. List Sites: GET /api/workspaces/:id/jira-sites (Accessible to active members)
      const listRes = await request(verifiedApp)
        .get(`/api/workspaces/${wsId}/jira-sites`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(listRes.status).toBe(200);
      const listData = listRes.body as ListWorkspaceSitesResponse;
      expect(listData.sites.some((s: WorkspaceSiteItem) => s.siteId === siteId)).toBe(true);

      // 3. Get Projects: GET /api/workspaces/:id/jira-sites/:siteId/projects
      const projRes = await request(verifiedApp)
        .get(`/api/workspaces/${wsId}/jira-sites/${siteId}/projects`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(projRes.status).toBe(200);
      const projData = projRes.body as GetWorkspaceProjectsResponse;
      expect(projData.sitePolicyVersion).toBeDefined();
      expect(Array.isArray(projData.projects)).toBe(true);

      // 4. Configure Projects: PUT /api/workspaces/:id/jira-sites/:siteId/projects
      const confReq: ConfigureWorkspaceProjectsRequest = {
        expectedPolicyVersion: projData.sitePolicyVersion,
        selectedProjectIds: ['10001'],
      };

      const confRes = await request(verifiedApp)
        .put(`/api/workspaces/${wsId}/jira-sites/${siteId}/projects`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send(confReq);

      expect(confRes.status).toBe(200);
      const confData = confRes.body as ConfigureWorkspaceProjectsResponse;
      expect(confData.updatedCount).toBeGreaterThanOrEqual(1);

      // Verify DB projects row
      const projDb = (
        await pool.query(
          'SELECT selected FROM ati_workspace_jira_projects WHERE workspace_id = $1 AND numeric_project_id = $2',
          [wsId, '10001']
        )
      ).rows[0];
      expect(projDb.selected).toBe(true);
    });

    it('rejects project configuration with wildcard or invalid project format with 400', async () => {
      const verifiedApp = buildApp(verifiedRepo);
      const admin = await createActor('Bad Proj Admin', 'badprojadmin', 'member');
      const wsId = await seedWorkspace('Bad Proj WS', `ws-badproj-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');

      const siteId = randomUUID();
      await pool.query(
        `INSERT INTO ati_workspace_jira_sites (
           id, workspace_id, cloud_id, site_name, site_url, active, policy_version, linked_by
         ) VALUES ($1, $2, 'cloud-badproj-1', 'Site', 'https://site.atlassian.net', true, 1, $3)`,
        [siteId, wsId, admin.id]
      );

      const invalidPayloads = [
        { expectedPolicyVersion: 1, selectedProjectIds: ['*'] },
        { expectedPolicyVersion: 1, selectedProjectIds: ['PROJ-1'] },
        { expectedPolicyVersion: 1, selectedProjectIds: [-1 as any] },
      ];

      for (const payload of invalidPayloads) {
        const res = await request(verifiedApp)
          .put(`/api/workspaces/${wsId}/jira-sites/${siteId}/projects`)
          .set('Authorization', `Bearer ${admin.token}`)
          .send(payload);

        expect(res.status).toBe(400);
      }
    });

    it('returns 404 when attempting to access a site belonging to a different workspace (Cross-Workspace Isolation)', async () => {
      const verifiedApp = buildApp(verifiedRepo);
      const adminA = await createActor('Admin A WS', 'admina', 'member');
      const wsA = await seedWorkspace('WS A', `ws-a-${randomUUID().slice(0, 8)}`, adminA.id);
      await seedMembership(wsA, adminA.id, 'admin', 'active');

      const adminB = await createActor('Admin B WS', 'adminb', 'member');
      const wsB = await seedWorkspace('WS B', `ws-b-${randomUUID().slice(0, 8)}`, adminB.id);
      await seedMembership(wsB, adminB.id, 'admin', 'active');

      // Site belongs to WS B
      const siteBId = randomUUID();
      await pool.query(
        `INSERT INTO ati_workspace_jira_sites (
           id, workspace_id, cloud_id, site_name, site_url, active, policy_version, linked_by
         ) VALUES ($1, $2, 'cloud-b-1', 'Site B', 'https://b.atlassian.net', true, 1, $3)`,
        [siteBId, wsB, adminB.id]
      );

      // Admin A attempts to access Site B under WS A path
      const res = await request(verifiedApp)
        .get(`/api/workspaces/${wsA}/jira-sites/${siteBId}/projects`)
        .set('Authorization', `Bearer ${adminA.token}`);

      expect(res.status).toBe(404);
    });
  });

  // ============================================================================
  // Suite 7: Fail-Closed Without WorkspaceRepo & Bounded Rate Limiting
  // ============================================================================
  describe('7. Fail-Closed Routing & Actor Rate Limiting', () => {
    it('fails closed when workspaceRepo is omitted from AppOptions, never falling back to in-memory bypass', async () => {
      const emptyApp = buildApp(undefined); // repo is intentionally undefined
      const actor = await createActor('Actor No Repo', 'norepo', 'admin');

      const resAdmin = await request(emptyApp)
        .post('/api/admin/workspaces')
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ name: 'Fail WS', slug: 'fail-ws', bootstrapAdminUserId: actor.id });

      expect(resAdmin.status === 503 || resAdmin.status === 404).toBe(true);

      const resList = await request(emptyApp)
        .get('/api/workspaces')
        .set('Authorization', `Bearer ${actor.token}`);

      expect(resList.status === 503 || resList.status === 404).toBe(true);
    });

    it('enforces actor-based rate limiting on sensitive join, invite, and decision routes with window reset', async () => {
      let simulatedTime = 1_000_000;
      const rateLimitClock = () => simulatedTime;
      const rateLimitedApp = buildApp(defaultRepo, {
        limit: 3,
        windowMs: 60_000,
        clock: rateLimitClock,
      });

      const actorA = await createActor('Rate Limit Spammer', 'spammer', 'member');
      const actorB = await createActor('Rate Limit Innocent', 'innocent', 'member');
      const admin = await createActor('Rate Limit Admin', 'rateadm', 'member');

      await connectSyntheticJiraAccount(pool, actorA.id);
      await connectSyntheticJiraAccount(pool, actorB.id);

      const wsId = await seedWorkspace('Rate Limit WS', `ws-rl-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');
      const invite = await defaultRepo.createInvite(wsId, admin.id);

      // --- 1. Join Request Rate Limiting ---
      // Actor A performs 3 requests (within limit: 3)
      for (let i = 0; i < 3; i++) {
        const res = await request(rateLimitedApp)
          .post('/api/workspace-join-requests')
          .set('Authorization', `Bearer ${actorA.token}`)
          .send({ inviteToken: invite.inviteToken });
        expect(res.status).not.toBe(429);
      }

      // 4th request from Actor A exceeds threshold -> MUST return 429
      const resA4 = await request(rateLimitedApp)
        .post('/api/workspace-join-requests')
        .set('Authorization', `Bearer ${actorA.token}`)
        .send({ inviteToken: invite.inviteToken });
      expect(resA4.status).toBe(429);
      expect(JSON.stringify(resA4.body)).not.toMatch(/token|secret|hash/i);

      // Actor B (separate authenticated actor) 1st request -> MUST NOT be 429 (actor budget isolation)
      const resB1 = await request(rateLimitedApp)
        .post('/api/workspace-join-requests')
        .set('Authorization', `Bearer ${actorB.token}`)
        .send({ inviteToken: invite.inviteToken });
      expect(resB1.status).not.toBe(429);

      // Window reset: advance clock past 60s window
      simulatedTime += 61_000;
      const resAfterReset = await request(rateLimitedApp)
        .post('/api/workspace-join-requests')
        .set('Authorization', `Bearer ${actorA.token}`)
        .send({ inviteToken: invite.inviteToken });
      expect(resAfterReset.status).not.toBe(429);

      // --- 2. Invite Creation Rate Limiting ---
      simulatedTime += 61_000;
      for (let i = 0; i < 3; i++) {
        const invRes = await request(rateLimitedApp)
          .post(`/api/workspaces/${wsId}/invites`)
          .set('Authorization', `Bearer ${admin.token}`)
          .send({ expiresInDays: 7 });
        expect(invRes.status).not.toBe(429);
      }
      const inv4 = await request(rateLimitedApp)
        .post(`/api/workspaces/${wsId}/invites`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ expiresInDays: 7 });
      expect(inv4.status).toBe(429);

      // --- 3. Decision Endpoint Rate Limiting ---
      simulatedTime += 61_000;
      const pendingUser = await createActor('Pending Dec User', 'penddec', 'member');
      await seedMembership(wsId, pendingUser.id, 'member', 'pending', 1);

      for (let i = 0; i < 3; i++) {
        const decRes = await request(rateLimitedApp)
          .post(`/api/workspaces/${wsId}/members/${pendingUser.id}/decision`)
          .set('Authorization', `Bearer ${admin.token}`)
          .send({ expectedVersion: 1, decision: 'approve' });
        expect(decRes.status).not.toBe(429);
      }
      const dec4 = await request(rateLimitedApp)
        .post(`/api/workspaces/${wsId}/members/${pendingUser.id}/decision`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ expectedVersion: 1, decision: 'approve' });
      expect(dec4.status).toBe(429);
    });
  });
});
