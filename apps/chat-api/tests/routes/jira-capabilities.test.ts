import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { createApp, type AppOptions } from '../../src/app.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { UserRepo } from '../../src/db/repositories/user-repo.js';
import { SessionRepo } from '../../src/db/repositories/session-repo.js';
import WorkspaceRepo, {
  type NativeAdminVerifier,
  type NativeAdminVerifierEvidence,
  type NativeAdminVerifierResult,
} from '../../src/db/repositories/workspace/index.js';
import type {
  ExtendedNativeVerifier,
  NativeUserPermissionsEvidence,
  NativeUserPermissionsResult,
} from '../../src/services/jira/jira-native-verifier.js';
import type { WorkspaceJiraCapabilitiesResponse } from '@wap/tool-schemas';
import {
  createIsolatedTestSchema,
  createSyntheticUser,
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

class MockExtendedNativeVerifier implements ExtendedNativeVerifier {
  public administerResult: NativeAdminVerifierResult = {
    status: 'granted',
    siteName: 'Official Engineering Jira',
    siteUrl: 'https://official-eng.atlassian.net',
    verifiedProjectIds: ['10001', '10002'],
    verifiedProjects: [
      { projectId: '10001', key: 'ENG', name: 'Engineering Core' },
      { projectId: '10002', key: 'OPS', name: 'Operations' },
    ],
  };

  public permissionsMap = new Map<string, NativeUserPermissionsResult>();
  public shouldThrow = false;
  public shouldReturnUnavailable = false;

  setUserPermission(
    userId: string,
    cloudId: string,
    projectId: string | undefined,
    permission: NativeUserPermissionsResult
  ): void {
    const key = `${userId}:${cloudId}:${projectId ?? 'global'}`;
    this.permissionsMap.set(key, permission);
  }

  clear(): void {
    this.permissionsMap.clear();
    this.shouldThrow = false;
    this.shouldReturnUnavailable = false;
  }

  async verifyAdminister(
    _evidence: NativeAdminVerifierEvidence
  ): Promise<NativeAdminVerifierResult> {
    if (this.shouldThrow) {
      throw new Error('Atlassian native verifier connection failed');
    }
    if (this.shouldReturnUnavailable) {
      return { status: 'unavailable', reason: 'Atlassian REST API 503' };
    }
    return this.administerResult;
  }

  async verifyUserPermissions(
    evidence: NativeUserPermissionsEvidence,
    _options?: { signal?: AbortSignal }
  ): Promise<NativeUserPermissionsResult> {
    if (this.shouldThrow) {
      throw new Error('Atlassian native verifier connection failed');
    }
    if (this.shouldReturnUnavailable) {
      return {
        canBrowse: false,
        canCreateIssue: false,
        canAddComment: false,
        status: 'unavailable',
        reason: 'Atlassian REST API 503',
      };
    }

    const key = `${evidence.actorId}:${evidence.cloudId}:${evidence.projectId ?? 'global'}`;
    if (this.permissionsMap.has(key)) {
      return this.permissionsMap.get(key)!;
    }

    // Default: allow browse, create issue, and add comment
    return {
      canBrowse: true,
      canCreateIssue: true,
      canAddComment: true,
      status: 'granted',
    };
  }
}

describe('apps/chat-api — JIRA-05 Task 4 Capabilities Route (GET /api/jira-workspaces/:id/jira-capabilities)', () => {
  let ctx: IsolatedTestContext;
  let pool: pg.Pool;
  let userRepo: UserRepo;
  let sessionRepo: SessionRepo;
  let mockVerifier: MockExtendedNativeVerifier;
  let workspaceRepoWithVerifier: WorkspaceRepo;

  const jwtSecret = 'test_secret_for_jira_capabilities_routes_32_chars';

  function buildApp(
    repo?: WorkspaceRepo,
    appOptionsOverride?: Partial<AppOptions>
  ) {
    return createApp({
      jwtSecret,
      userRepo,
      sessionRepo,
      authClock: () => Date.now(),
      runtimeMode: 'sandbox',
      jiraWorkspaceRepo: repo,
      ...appOptionsOverride,
    });
  }

  async function createActor(
    name: string,
    prefix: string,
    role: 'admin' | 'member' = 'member',
    userStatus: 'active' | 'disabled' = 'active'
  ): Promise<TestActor> {
    const userId = await createSyntheticUser(pool, name, prefix, { role, status: userStatus });
    const userRow = await userRepo.findById(userId);
    const email = userRow?.email ?? `${prefix}_${randomUUID().slice(0, 8)}@example.test`;
    const { sessionId } = await sessionRepo.create(userId, 'test-agent');
    const token = generateAccessToken(
      { id: userId, email, name, role, status: userStatus },
      jwtSecret,
      sessionId
    ).accessToken;

    return { id: userId, email, name, role, sid: sessionId, token };
  }

  async function seedWorkspace(
    name: string,
    slug: string,
    createdBy: string,
    status = 'active'
  ): Promise<string> {
    const wsId = randomUUID();
    const inviteCode = `ATI-${randomUUID().slice(0, 4).toUpperCase()}-${randomUUID().slice(0, 4).toUpperCase()}`;
    await pool.query(
      `INSERT INTO workspaces (id, name, invite_code, created_by)
       VALUES ($1, $2, $3, $4)`,
      [wsId, name, inviteCode, createdBy]
    );
    await pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, status)
       VALUES ($1, $2, 'admin', 'active')`,
      [wsId, createdBy]
    );
    const res = await pool.query<{ id: string }>(
      `INSERT INTO ati_workspaces (id, slug, status, version, created_by)
       VALUES ($1, $2, $3, 1, $4)
       RETURNING id`,
      [wsId, slug, status, createdBy]
    );
    const row = res.rows[0]!;
    if (!row) throw new Error('Failed to seed workspace: missing returning row');
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
      `INSERT INTO workspace_members (workspace_id, user_id, role, status)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (workspace_id, user_id)
       DO UPDATE SET status = EXCLUDED.status, role = EXCLUDED.role`,
      [workspaceId, userId, role, status === 'active' ? 'active' : status === 'pending' ? 'pending' : 'disabled']
    );
    await pool.query(
      `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version, requested_at, decided_at)
       VALUES ($1, $2, $3, $4, $5, clock_timestamp(), clock_timestamp())
       ON CONFLICT (workspace_id, user_id)
       DO UPDATE SET status = EXCLUDED.status, role = EXCLUDED.role, version = EXCLUDED.version`,
      [workspaceId, userId, role, status, version]
    );
  }

  async function seedJiraAccount(
    userId: string,
    status: 'connected' | 'disconnected' = 'connected',
    atlassianAccountId = `atlas-${randomUUID().slice(0, 8)}`
  ): Promise<string> {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO jira_accounts (user_id, atlassian_account_id, status, identity_version)
       VALUES ($1, $2, $3, 1)
       RETURNING id`,
      [userId, atlassianAccountId, status]
    );
    const row = res.rows[0]!;
    if (!row) throw new Error('Failed to seed jira_accounts: missing returning row');
    return row.id;
  }

  async function seedGrant(
    accountId: string,
    cloudId?: string,
    options?: { status?: 'active' | 'revoked'; siteName?: string; siteUrl?: string }
  ): Promise<string> {
    const grantStatus = options?.status ?? 'active';
    const res = await pool.query<{ id: string }>(
      `INSERT INTO jira_oauth_grants (
         id, account_id, app_client_id, grant_kind,
         encrypted_access_token, encrypted_refresh_token, scopes, token_version, status
       ) VALUES ($1, $2, 'test-client', 'identity_and_sites', 'enc_acc', 'enc_ref', $3::text[], 1, $4)
       RETURNING id`,
      [randomUUID(), accountId, ['read:jira-work'], grantStatus]
    );
    const row = res.rows[0]!;
    if (!row) throw new Error('Failed to seed grant: missing returning row');
    const grantId = row.id;

    if (cloudId) {
      const siteUrl = options?.siteUrl ?? `https://${cloudId}.atlassian.net`;
      const siteName = options?.siteName ?? `Site ${cloudId}`;
      await pool.query(
        `INSERT INTO jira_grant_sites (
           id, grant_id, cloud_id, site_url, site_name, product_type
         ) VALUES ($1, $2, $3, $4, $5, 'jira')
         ON CONFLICT (grant_id, cloud_id) DO NOTHING`,
        [randomUUID(), grantId, cloudId, siteUrl, siteName]
      );
    }

    return grantId;
  }

  async function addGrantSite(
    grantId: string,
    cloudId: string,
    siteUrl = `https://${cloudId}.atlassian.net`,
    siteName = `Site ${cloudId}`
  ): Promise<void> {
    await pool.query(
      `INSERT INTO jira_grant_sites (
         id, grant_id, cloud_id, site_url, site_name, product_type
       ) VALUES ($1, $2, $3, $4, $5, 'jira')
       ON CONFLICT (grant_id, cloud_id) DO NOTHING`,
      [randomUUID(), grantId, cloudId, siteUrl, siteName]
    );
  }

  async function seedWorkspaceSite(
    workspaceId: string,
    cloudId: string,
    options?: {
      active?: boolean;
      siteName?: string;
      siteUrl?: string;
      linkedBy?: string;
      policyVersion?: number;
    }
  ): Promise<string> {
    const siteId = randomUUID();
    const active = options?.active ?? true;
    const siteName = options?.siteName ?? `Workspace Site ${cloudId}`;
    const siteUrl = options?.siteUrl ?? `https://${cloudId}.atlassian.net`;
    const owner = await pool.query<{ created_by: string }>('SELECT created_by FROM ati_workspaces WHERE id = $1', [workspaceId]);
    const linkedBy = options?.linkedBy ?? owner.rows[0]!.created_by;
    const policyVersion = options?.policyVersion ?? 1;

    const res = await pool.query<{ id: string }>(
      `INSERT INTO ati_workspace_jira_sites (
         id, workspace_id, cloud_id, site_name, site_url, active, policy_version, linked_by, verified_admin_by, admin_verified_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, clock_timestamp())
       RETURNING id`,
      [siteId, workspaceId, cloudId, siteName, siteUrl, active, policyVersion, linkedBy]
    );
    const row = res.rows[0]!;
    if (!row) throw new Error('Failed to seed workspace site: missing returning row');
    return row.id;
  }

  async function seedWorkspaceProject(
    workspaceId: string,
    siteId: string,
    cloudId: string,
    numericProjectId: string,
    projectKey: string,
    projectName: string,
    selected = true,
    policyVersion = 1
  ): Promise<string> {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO ati_workspace_jira_projects (
         id, workspace_id, site_id, cloud_id, numeric_project_id, project_key, project_name, selected, policy_version
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [randomUUID(), workspaceId, siteId, cloudId, numericProjectId, projectKey, projectName, selected, policyVersion]
    );
    const row = res.rows[0]!;
    if (!row) throw new Error('Failed to seed workspace project: missing returning row');
    return row.id;
  }

  beforeAll(async () => {
    ctx = await createIsolatedTestSchema({ maxConnections: 4 });
    pool = ctx.pool;
    await ctx.runAllMigrations();

    userRepo = new UserRepo(pool);
    sessionRepo = new SessionRepo(pool);
    mockVerifier = new MockExtendedNativeVerifier();
    workspaceRepoWithVerifier = new WorkspaceRepo(pool, { verifier: mockVerifier });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  beforeEach(() => {
    mockVerifier.clear();
  });

  // ============================================================================
  // Suite 1: Authentication & 404 Hidden Privacy Pattern
  // ============================================================================
  describe('1. Authentication & 404 Hidden Privacy Pattern', () => {
    it('rejects unauthenticated request with 401 UNAUTHORIZED', async () => {
      const app = buildApp(workspaceRepoWithVerifier);
      const wsId = randomUUID();

      const res = await request(app).get(`/api/jira-workspaces/${wsId}/jira-capabilities`);

      expect(res.status).toBe(401);
      expect(res.body.code ?? res.body.error).toMatch(/UNAUTHORIZED|Authentication required|Phiên đăng nhập/i);
    });

    it('rejects malformed workspace UUID with 404 WORKSPACE_NOT_FOUND', async () => {
      const app = buildApp(workspaceRepoWithVerifier);
      const user = await createActor('Valid User', 'validuser', 'member');

      const res = await request(app)
        .get('/api/jira-workspaces/not-a-valid-uuid/jira-capabilities')
        .set('Authorization', `Bearer ${user.token}`);

      expect(res.status).toBe(404);
      expect(res.body.code ?? res.body.error).toMatch(/WORKSPACE_NOT_FOUND/i);
    });

    it('returns 404 WORKSPACE_NOT_FOUND for non-existent workspace UUID', async () => {
      const app = buildApp(workspaceRepoWithVerifier);
      const user = await createActor('Valid User NonExistent', 'nonexistuser', 'member');
      const nonExistentWsId = randomUUID();

      const res = await request(app)
        .get(`/api/jira-workspaces/${nonExistentWsId}/jira-capabilities`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(res.status).toBe(404);
      expect(res.body.code ?? res.body.error).toMatch(/WORKSPACE_NOT_FOUND/i);
    });

    it('returns 404 WORKSPACE_NOT_FOUND for outsider not belonging to the workspace', async () => {
      const app = buildApp(workspaceRepoWithVerifier);
      const admin = await createActor('Workspace Admin Out', 'wsadminout', 'member');
      const outsider = await createActor('Outsider User', 'outsider', 'member');

      const wsId = await seedWorkspace('Outsider WS', `ws-out-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');

      const res = await request(app)
        .get(`/api/jira-workspaces/${wsId}/jira-capabilities`)
        .set('Authorization', `Bearer ${outsider.token}`);

      expect(res.status).toBe(404);
      expect(res.body.code ?? res.body.error).toMatch(/WORKSPACE_NOT_FOUND/i);
    });

    it('returns 404 WORKSPACE_NOT_FOUND for pending membership status', async () => {
      const app = buildApp(workspaceRepoWithVerifier);
      const admin = await createActor('Admin Pending', 'adminpend', 'member');
      const pendingUser = await createActor('Pending User', 'pendinguser', 'member');

      const wsId = await seedWorkspace('Pending WS', `ws-pend-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');
      await seedMembership(wsId, pendingUser.id, 'member', 'pending');

      const res = await request(app)
        .get(`/api/jira-workspaces/${wsId}/jira-capabilities`)
        .set('Authorization', `Bearer ${pendingUser.token}`);

      expect(res.status).toBe(404);
      expect(res.body.code ?? res.body.error).toMatch(/WORKSPACE_NOT_FOUND/i);
    });

    it('returns 404 WORKSPACE_NOT_FOUND for rejected membership status', async () => {
      const app = buildApp(workspaceRepoWithVerifier);
      const admin = await createActor('Admin Rejected', 'adminrej', 'member');
      const rejectedUser = await createActor('Rejected User', 'rejecteduser', 'member');

      const wsId = await seedWorkspace('Rejected WS', `ws-rej-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');
      await seedMembership(wsId, rejectedUser.id, 'member', 'rejected');

      const res = await request(app)
        .get(`/api/jira-workspaces/${wsId}/jira-capabilities`)
        .set('Authorization', `Bearer ${rejectedUser.token}`);

      expect(res.status).toBe(404);
      expect(res.body.code ?? res.body.error).toMatch(/WORKSPACE_NOT_FOUND/i);
    });

    it('returns 404 WORKSPACE_NOT_FOUND for removed membership status', async () => {
      const app = buildApp(workspaceRepoWithVerifier);
      const admin = await createActor('Admin Removed', 'adminrem', 'member');
      const removedUser = await createActor('Removed User', 'removeduser', 'member');

      const wsId = await seedWorkspace('Removed WS', `ws-rem-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');
      await seedMembership(wsId, removedUser.id, 'member', 'removed');

      const res = await request(app)
        .get(`/api/jira-workspaces/${wsId}/jira-capabilities`)
        .set('Authorization', `Bearer ${removedUser.token}`);

      expect(res.status).toBe(404);
      expect(res.body.code ?? res.body.error).toMatch(/WORKSPACE_NOT_FOUND/i);
    });

    it('returns 404 WORKSPACE_NOT_FOUND when workspace is archived, even for active members', async () => {
      const app = buildApp(workspaceRepoWithVerifier);
      const member = await createActor('Archived Member', 'archmem', 'member');

      const wsId = await seedWorkspace('Archived WS', `ws-arch-${randomUUID().slice(0, 8)}`, member.id, 'archived');
      await seedMembership(wsId, member.id, 'member', 'active');

      const res = await request(app)
        .get(`/api/jira-workspaces/${wsId}/jira-capabilities`)
        .set('Authorization', `Bearer ${member.token}`);

      expect(res.status).toBe(404);
      expect(res.body.code ?? res.body.error).toMatch(/WORKSPACE_NOT_FOUND/i);
    });

    it('rejects a disabled user during authentication', async () => {
      const app = buildApp(workspaceRepoWithVerifier);
      const disabledUser = await createActor('Disabled User', 'disuser', 'member');
      const admin = await createActor('Admin For Dis', 'admindis', 'member');

      const wsId = await seedWorkspace('Disabled User WS', `ws-dis-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');
      await seedMembership(wsId, disabledUser.id, 'member', 'active');
      await pool.query("UPDATE users SET status = 'disabled' WHERE id = $1", [disabledUser.id]);

      const res = await request(app)
        .get(`/api/jira-workspaces/${wsId}/jira-capabilities`)
        .set('Authorization', `Bearer ${disabledUser.token}`);

      expect(res.status).toBe(401);
    });
  });

  // ============================================================================
  // Suite 2: Disconnected User Safe Empty
  // ============================================================================
  describe('2. Disconnected User Safe Empty Handling', () => {
    it('returns 200 with safe empty { workspaceId, sites: [] } when user has never connected Jira account', async () => {
      const app = buildApp(workspaceRepoWithVerifier);
      const user = await createActor('Unconnected User', 'unconn', 'member');
      const admin = await createActor('Admin Unconn', 'adminunconn', 'member');

      const wsId = await seedWorkspace('Unconnected WS', `ws-unconn-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');
      await seedMembership(wsId, user.id, 'member', 'active');

      // Workspace has active linked site and configured project
      const siteId = await seedWorkspaceSite(wsId, 'cloud-unconn-1', { active: true });
      await seedWorkspaceProject(wsId, siteId, 'cloud-unconn-1', '10001', 'ENG', 'Engineering Core', true);

      const res = await request(app)
        .get(`/api/jira-workspaces/${wsId}/jira-capabilities`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(res.status).toBe(200);
      const body = res.body as WorkspaceJiraCapabilitiesResponse;
      expect(body.workspaceId).toBe(wsId);
      expect(body.sites).toEqual([]);
    });

    it('returns 200 with safe empty { workspaceId, sites: [] } when user Jira account status is disconnected', async () => {
      const app = buildApp(workspaceRepoWithVerifier);
      const user = await createActor('Disconnected User', 'disconn', 'member');
      const admin = await createActor('Admin Disconn', 'admindisconn', 'member');

      const wsId = await seedWorkspace('Disconnected WS', `ws-disconn-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');
      await seedMembership(wsId, user.id, 'member', 'active');

      // User has disconnected account
      const accountId = await seedJiraAccount(user.id, 'disconnected');
      await seedGrant(accountId, 'cloud-disconn-1', { status: 'active' });

      // Workspace links that site
      const siteId = await seedWorkspaceSite(wsId, 'cloud-disconn-1', { active: true });
      await seedWorkspaceProject(wsId, siteId, 'cloud-disconn-1', '10001', 'ENG', 'Engineering Core', true);

      const res = await request(app)
        .get(`/api/jira-workspaces/${wsId}/jira-capabilities`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(res.status).toBe(200);
      const body = res.body as WorkspaceJiraCapabilitiesResponse;
      expect(body.workspaceId).toBe(wsId);
      expect(body.sites).toEqual([]);
    });

    it('returns 200 with safe empty { workspaceId, sites: [] } when user Jira account has no active grants (revoked grant)', async () => {
      const app = buildApp(workspaceRepoWithVerifier);
      const user = await createActor('Revoked Grant User', 'revgrant', 'member');
      const admin = await createActor('Admin RevGrant', 'adminrevgrant', 'member');

      const wsId = await seedWorkspace('Revoked Grant WS', `ws-revgrant-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');
      await seedMembership(wsId, user.id, 'member', 'active');

      // User has connected account but grant is revoked
      const accountId = await seedJiraAccount(user.id, 'connected');
      await seedGrant(accountId, 'cloud-revgrant-1', { status: 'revoked' });

      // Workspace links that site
      const siteId = await seedWorkspaceSite(wsId, 'cloud-revgrant-1', { active: true });
      await seedWorkspaceProject(wsId, siteId, 'cloud-revgrant-1', '10001', 'ENG', 'Engineering Core', true);

      const res = await request(app)
        .get(`/api/jira-workspaces/${wsId}/jira-capabilities`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(res.status).toBe(200);
      const body = res.body as WorkspaceJiraCapabilitiesResponse;
      expect(body.workspaceId).toBe(wsId);
      expect(body.sites).toEqual([]);
    });

    it('returns 200 with safe empty { workspaceId, sites: [] } when active grant has zero grant sites', async () => {
      const app = buildApp(workspaceRepoWithVerifier);
      const user = await createActor('Zero Sites User', 'zerosites', 'member');
      const admin = await createActor('Admin ZeroSites', 'adminzerosites', 'member');

      const wsId = await seedWorkspace('Zero Sites WS', `ws-zerosites-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');
      await seedMembership(wsId, user.id, 'member', 'active');

      // User has connected account and grant, but grant has NO sites linked
      const accountId = await seedJiraAccount(user.id, 'connected');
      await seedGrant(accountId, undefined, { status: 'active' });

      // Workspace links a site
      await seedWorkspaceSite(wsId, 'cloud-zerosites-1', { active: true });

      const res = await request(app)
        .get(`/api/jira-workspaces/${wsId}/jira-capabilities`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(res.status).toBe(200);
      const body = res.body as WorkspaceJiraCapabilitiesResponse;
      expect(body.workspaceId).toBe(wsId);
      expect(body.sites).toEqual([]);
    });
  });

  // ============================================================================
  // Suite 3: Site Intersection Calculation (Workspace Sites ∩ User Grant Sites)
  // ============================================================================
  describe('3. Site Intersection Calculation', () => {
    it('returns exactly the intersection between workspace active linked sites and user granted sites', async () => {
      const app = buildApp(workspaceRepoWithVerifier);
      const user = await createActor('Intersect User', 'intersect', 'member');
      const admin = await createActor('Admin Intersect', 'adminintersect', 'member');

      const wsId = await seedWorkspace('Intersect WS', `ws-intersect-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');
      await seedMembership(wsId, user.id, 'member', 'active');

      // Setup 5 sites:
      // S1: Workspace active=true, User granted (INCLUDED)
      // S2: Workspace active=true, User granted (INCLUDED)
      // S3: Workspace active=true, User NOT granted (EXCLUDED - user lacks grant)
      // S4: Workspace active=false, User granted (EXCLUDED - workspace site deactivated)
      // S5: Workspace NOT linked, User granted (EXCLUDED - not in workspace)
      const cloud1 = `cloud-s1-${randomUUID().slice(0, 6)}`;
      const cloud2 = `cloud-s2-${randomUUID().slice(0, 6)}`;
      const cloud3 = `cloud-s3-${randomUUID().slice(0, 6)}`;
      const cloud4 = `cloud-s4-${randomUUID().slice(0, 6)}`;
      const cloud5 = `cloud-s5-${randomUUID().slice(0, 6)}`;

      const site1Id = await seedWorkspaceSite(wsId, cloud1, {
        active: true,
        siteName: 'Shared Engineering Jira',
        siteUrl: `https://${cloud1}.atlassian.net`,
      });
      const site2Id = await seedWorkspaceSite(wsId, cloud2, {
        active: true,
        siteName: 'Shared Product Jira',
        siteUrl: `https://${cloud2}.atlassian.net`,
      });
      await seedWorkspaceSite(wsId, cloud3, {
        active: true,
        siteName: 'Workspace Only Jira',
        siteUrl: `https://${cloud3}.atlassian.net`,
      });
      await seedWorkspaceSite(wsId, cloud4, {
        active: false,
        siteName: 'Deactivated Workspace Jira',
        siteUrl: `https://${cloud4}.atlassian.net`,
      });

      // User has account and grant for S1, S2, S4, S5
      const accountId = await seedJiraAccount(user.id, 'connected');
      const grantId = await seedGrant(accountId, cloud1, {
        siteName: 'Shared Engineering Jira',
        siteUrl: `https://${cloud1}.atlassian.net`,
      });
      await addGrantSite(grantId, cloud2, `https://${cloud2}.atlassian.net`, 'Shared Product Jira');
      await addGrantSite(grantId, cloud4, `https://${cloud4}.atlassian.net`, 'Deactivated Workspace Jira');
      await addGrantSite(grantId, cloud5, `https://${cloud5}.atlassian.net`, 'Personal User Jira');

      // Seed projects for S1 and S2
      await seedWorkspaceProject(wsId, site1Id, cloud1, '10001', 'ENG', 'Engineering Core', true);
      await seedWorkspaceProject(wsId, site2Id, cloud2, '20001', 'PRD', 'Product Roadmap', true);

      const res = await request(app)
        .get(`/api/jira-workspaces/${wsId}/jira-capabilities`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(res.status).toBe(200);
      const body = res.body as WorkspaceJiraCapabilitiesResponse;
      expect(body.workspaceId).toBe(wsId);
      expect(Array.isArray(body.sites)).toBe(true);
      expect(body.sites.length).toBe(2);

      const returnedCloudIds = body.sites.map((s) => s.cloudId);
      expect(returnedCloudIds).toContain(cloud1);
      expect(returnedCloudIds).toContain(cloud2);
      expect(returnedCloudIds).not.toContain(cloud3);
      expect(returnedCloudIds).not.toContain(cloud4);
      expect(returnedCloudIds).not.toContain(cloud5);

      const site1 = body.sites.find((s) => s.cloudId === cloud1);
      expect(site1).toBeDefined();
      expect(site1?.siteId).toBe(site1Id);
      expect(site1?.name).toBe('Shared Engineering Jira');
      expect(site1?.url).toBe(`https://${cloud1}.atlassian.net`);
      expect(site1?.projects).toEqual([
        { id: '10001', key: 'ENG', name: 'Engineering Core' },
      ]);

      const site2 = body.sites.find((s) => s.cloudId === cloud2);
      expect(site2).toBeDefined();
      expect(site2?.siteId).toBe(site2Id);
      expect(site2?.name).toBe('Shared Product Jira');
      expect(site2?.url).toBe(`https://${cloud2}.atlassian.net`);
      expect(site2?.projects).toEqual([
        { id: '20001', key: 'PRD', name: 'Product Roadmap' },
      ]);
    });

    it('returns 200 with empty sites when site intersection is completely disjoint', async () => {
      const app = buildApp(workspaceRepoWithVerifier);
      const user = await createActor('Disjoint User', 'disjoint', 'member');
      const admin = await createActor('Admin Disjoint', 'admindisjoint', 'member');

      const wsId = await seedWorkspace('Disjoint WS', `ws-disjoint-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');
      await seedMembership(wsId, user.id, 'member', 'active');

      const cloudWs = `cloud-ws-only-${randomUUID().slice(0, 6)}`;
      const cloudUser = `cloud-user-only-${randomUUID().slice(0, 6)}`;

      await seedWorkspaceSite(wsId, cloudWs, { active: true });

      const accountId = await seedJiraAccount(user.id, 'connected');
      await seedGrant(accountId, cloudUser, { status: 'active' });

      const res = await request(app)
        .get(`/api/jira-workspaces/${wsId}/jira-capabilities`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(res.status).toBe(200);
      const body = res.body as WorkspaceJiraCapabilitiesResponse;
      expect(body.workspaceId).toBe(wsId);
      expect(body.sites).toEqual([]);
    });

    it('returns 200 with empty sites when workspace has zero linked sites', async () => {
      const app = buildApp(workspaceRepoWithVerifier);
      const user = await createActor('No Sites WS User', 'nosites', 'member');
      const admin = await createActor('Admin No Sites WS', 'adminnosites', 'member');

      const wsId = await seedWorkspace('No Sites WS', `ws-nosites-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');
      await seedMembership(wsId, user.id, 'member', 'active');

      const accountId = await seedJiraAccount(user.id, 'connected');
      await seedGrant(accountId, 'cloud-some-grant-1', { status: 'active' });

      const res = await request(app)
        .get(`/api/jira-workspaces/${wsId}/jira-capabilities`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(res.status).toBe(200);
      const body = res.body as WorkspaceJiraCapabilitiesResponse;
      expect(body.workspaceId).toBe(wsId);
      expect(body.sites).toEqual([]);
    });

    it('excludes workspace sites that are deactivated (active = false) even if granted to user', async () => {
      const app = buildApp(workspaceRepoWithVerifier);
      const user = await createActor('Deactivated Site User', 'deactsite', 'member');
      const admin = await createActor('Admin Deact Site', 'admindeactsite', 'member');

      const wsId = await seedWorkspace('Deact Site WS', `ws-deactsite-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');
      await seedMembership(wsId, user.id, 'member', 'active');

      const cloudId = `cloud-deact-${randomUUID().slice(0, 6)}`;
      await seedWorkspaceSite(wsId, cloudId, { active: false });

      const accountId = await seedJiraAccount(user.id, 'connected');
      await seedGrant(accountId, cloudId, { status: 'active' });

      const res = await request(app)
        .get(`/api/jira-workspaces/${wsId}/jira-capabilities`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(res.status).toBe(200);
      const body = res.body as WorkspaceJiraCapabilitiesResponse;
      expect(body.workspaceId).toBe(wsId);
      expect(body.sites).toEqual([]);
    });
  });

  // ============================================================================
  // Suite 4: Project Selection & Native User Permissions (canBrowse Filter)
  // ============================================================================
  describe('4. Project Selection & Native User Permissions Intersection', () => {
    it('filters configured projects by native user permissions (canBrowse: true included, canBrowse: false excluded)', async () => {
      const app = buildApp(workspaceRepoWithVerifier);
      const user = await createActor('Perm User', 'permuser', 'member');
      const admin = await createActor('Admin Perm', 'adminperm', 'member');

      const wsId = await seedWorkspace('Perm WS', `ws-perm-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');
      await seedMembership(wsId, user.id, 'member', 'active');

      const cloudId = `cloud-perm-${randomUUID().slice(0, 6)}`;
      const siteId = await seedWorkspaceSite(wsId, cloudId, {
        active: true,
        siteName: 'Permission Test Jira',
        siteUrl: `https://${cloudId}.atlassian.net`,
      });

      const accountId = await seedJiraAccount(user.id, 'connected');
      await seedGrant(accountId, cloudId, { status: 'active' });

      // Seed 4 projects in workspace:
      // P1 (10001): selected = true, native canBrowse = true  -> INCLUDED
      // P2 (10002): selected = true, native canBrowse = false -> EXCLUDED (no browse permission)
      // P3 (10003): selected = false, native canBrowse = true -> EXCLUDED (not selected in workspace)
      // P4 (10004): selected = true, native canBrowse = true  -> INCLUDED
      await seedWorkspaceProject(wsId, siteId, cloudId, '10001', 'ENG', 'Engineering Core', true);
      await seedWorkspaceProject(wsId, siteId, cloudId, '10002', 'OPS', 'Operations Secret', true);
      await seedWorkspaceProject(wsId, siteId, cloudId, '10003', 'HR', 'Human Resources', false);
      await seedWorkspaceProject(wsId, siteId, cloudId, '10004', 'QA', 'Quality Assurance', true);

      // Configure mock verifier native permissions for user
      mockVerifier.setUserPermission(user.id, cloudId, '10001', {
        canBrowse: true,
        canCreateIssue: true,
        canAddComment: true,
        status: 'granted',
      });
      mockVerifier.setUserPermission(user.id, cloudId, '10002', {
        canBrowse: false,
        canCreateIssue: false,
        canAddComment: false,
        status: 'denied',
        reason: 'User lacks BROWSE_PROJECTS permission in Atlassian',
      });
      mockVerifier.setUserPermission(user.id, cloudId, '10003', {
        canBrowse: true,
        canCreateIssue: true,
        canAddComment: true,
        status: 'granted',
      });
      mockVerifier.setUserPermission(user.id, cloudId, '10004', {
        canBrowse: true,
        canCreateIssue: false, // canBrowse is true, even if canCreateIssue is false
        canAddComment: true,
        status: 'granted',
      });

      const res = await request(app)
        .get(`/api/jira-workspaces/${wsId}/jira-capabilities`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(res.status).toBe(200);
      const body = res.body as WorkspaceJiraCapabilitiesResponse;
      expect(body.workspaceId).toBe(wsId);
      expect(body.sites.length).toBe(1);

      const site = body.sites[0]!;
      expect(site.cloudId).toBe(cloudId);
      expect(site.siteId).toBe(siteId);

      const projectIds = site.projects.map((p) => p.id);
      expect(projectIds).toContain('10001');
      expect(projectIds).toContain('10004');
      expect(projectIds).not.toContain('10002');
      expect(projectIds).not.toContain('10003');

      expect(site.projects).toEqual([
        { id: '10001', key: 'ENG', name: 'Engineering Core' },
        { id: '10004', key: 'QA', name: 'Quality Assurance' },
      ]);
    });

    it('returns site with empty projects array when all configured projects lack canBrowse permission', async () => {
      const app = buildApp(workspaceRepoWithVerifier);
      const user = await createActor('No Browse User', 'nobrowse', 'member');
      const admin = await createActor('Admin No Browse', 'adminnobrowse', 'member');

      const wsId = await seedWorkspace('No Browse WS', `ws-nobrowse-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');
      await seedMembership(wsId, user.id, 'member', 'active');

      const cloudId = `cloud-nobrowse-${randomUUID().slice(0, 6)}`;
      const siteId = await seedWorkspaceSite(wsId, cloudId, { active: true });

      const accountId = await seedJiraAccount(user.id, 'connected');
      await seedGrant(accountId, cloudId, { status: 'active' });

      await seedWorkspaceProject(wsId, siteId, cloudId, '10001', 'ENG', 'Engineering Core', true);

      // Native permission denied for 10001
      mockVerifier.setUserPermission(user.id, cloudId, '10001', {
        canBrowse: false,
        canCreateIssue: false,
        canAddComment: false,
        status: 'denied',
      });

      const res = await request(app)
        .get(`/api/jira-workspaces/${wsId}/jira-capabilities`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(res.status).toBe(200);
      const body = res.body as WorkspaceJiraCapabilitiesResponse;
      expect(body.workspaceId).toBe(wsId);
      expect(body.sites.length).toBe(1);
      expect(body.sites[0]!.projects).toEqual([]);
    });

    it('returns site with empty projects array when workspace has not configured any projects for that site', async () => {
      const app = buildApp(workspaceRepoWithVerifier);
      const user = await createActor('No Projects WS User', 'noproj', 'member');
      const admin = await createActor('Admin No Proj WS', 'adminnoproj', 'member');

      const wsId = await seedWorkspace('No Proj WS', `ws-noproj-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');
      await seedMembership(wsId, user.id, 'member', 'active');

      const cloudId = `cloud-noproj-${randomUUID().slice(0, 6)}`;
      const siteId = await seedWorkspaceSite(wsId, cloudId, { active: true });

      const accountId = await seedJiraAccount(user.id, 'connected');
      await seedGrant(accountId, cloudId, { status: 'active' });

      // No rows in ati_workspace_jira_projects

      const res = await request(app)
        .get(`/api/jira-workspaces/${wsId}/jira-capabilities`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(res.status).toBe(200);
      const body = res.body as WorkspaceJiraCapabilitiesResponse;
      expect(body.workspaceId).toBe(wsId);
      expect(body.sites.length).toBe(1);
      expect(body.sites[0]!.siteId).toBe(siteId);
      expect(body.sites[0]!.projects).toEqual([]);
    });

    it('correctly maps canonical project metadata (id, key, name) from database and verifier', async () => {
      const app = buildApp(workspaceRepoWithVerifier);
      const user = await createActor('Canon User', 'canonuser', 'member');
      const admin = await createActor('Admin Canon', 'admincanon', 'member');

      const wsId = await seedWorkspace('Canon WS', `ws-canon-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');
      await seedMembership(wsId, user.id, 'member', 'active');

      const cloudId = `cloud-canon-${randomUUID().slice(0, 6)}`;
      const siteId = await seedWorkspaceSite(wsId, cloudId, { active: true });

      const accountId = await seedJiraAccount(user.id, 'connected');
      await seedGrant(accountId, cloudId, { status: 'active' });

      await seedWorkspaceProject(wsId, siteId, cloudId, '99999', 'CANON', 'Canonical Project Name', true);

      const res = await request(app)
        .get(`/api/jira-workspaces/${wsId}/jira-capabilities`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(res.status).toBe(200);
      const body = res.body as WorkspaceJiraCapabilitiesResponse;
      expect(body.sites[0]!.projects).toEqual([
        { id: '99999', key: 'CANON', name: 'Canonical Project Name' },
      ]);
    });
  });

  // ============================================================================
  // Suite 5: Multi-Site, Multi-User Isolation & Error Resilience
  // ============================================================================
  describe('5. Multi-Site, Multi-User Isolation & Error Resilience', () => {
    it('handles multi-site capability directory with distinct project permissions per site', async () => {
      const app = buildApp(workspaceRepoWithVerifier);
      const user = await createActor('MultiSite User', 'multisite', 'member');
      const admin = await createActor('Admin MultiSite', 'adminmultisite', 'member');

      const wsId = await seedWorkspace('MultiSite WS', `ws-ms-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');
      await seedMembership(wsId, user.id, 'member', 'active');

      const cloudA = `cloud-ms-a-${randomUUID().slice(0, 6)}`;
      const cloudB = `cloud-ms-b-${randomUUID().slice(0, 6)}`;

      const siteAId = await seedWorkspaceSite(wsId, cloudA, {
        active: true,
        siteName: 'Site Alpha',
        siteUrl: `https://${cloudA}.atlassian.net`,
      });
      const siteBId = await seedWorkspaceSite(wsId, cloudB, {
        active: true,
        siteName: 'Site Beta',
        siteUrl: `https://${cloudB}.atlassian.net`,
      });

      const accountId = await seedJiraAccount(user.id, 'connected');
      const grantId = await seedGrant(accountId, cloudA, {
        siteName: 'Site Alpha',
        siteUrl: `https://${cloudA}.atlassian.net`,
      });
      await addGrantSite(grantId, cloudB, `https://${cloudB}.atlassian.net`, 'Site Beta');

      // Site A has Project 10001 (canBrowse: true)
      await seedWorkspaceProject(wsId, siteAId, cloudA, '10001', 'ALP', 'Alpha Project', true);

      // Site B has Project 20001 (canBrowse: true) and 20002 (canBrowse: false)
      await seedWorkspaceProject(wsId, siteBId, cloudB, '20001', 'BET', 'Beta Project', true);
      await seedWorkspaceProject(wsId, siteBId, cloudB, '20002', 'SEC', 'Secret Project', true);

      mockVerifier.setUserPermission(user.id, cloudA, '10001', {
        canBrowse: true,
        canCreateIssue: true,
        canAddComment: true,
      });
      mockVerifier.setUserPermission(user.id, cloudB, '20001', {
        canBrowse: true,
        canCreateIssue: true,
        canAddComment: true,
      });
      mockVerifier.setUserPermission(user.id, cloudB, '20002', {
        canBrowse: false,
        canCreateIssue: false,
        canAddComment: false,
      });

      const res = await request(app)
        .get(`/api/jira-workspaces/${wsId}/jira-capabilities`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(res.status).toBe(200);
      const body = res.body as WorkspaceJiraCapabilitiesResponse;
      expect(body.sites.length).toBe(2);

      const siteA = body.sites.find((s) => s.cloudId === cloudA);
      expect(siteA?.projects).toEqual([
        { id: '10001', key: 'ALP', name: 'Alpha Project' },
      ]);

      const siteB = body.sites.find((s) => s.cloudId === cloudB);
      expect(siteB?.projects).toEqual([
        { id: '20001', key: 'BET', name: 'Beta Project' },
      ]);
    });

    it('enforces cross-workspace isolation for the same user across multiple workspaces', async () => {
      const app = buildApp(workspaceRepoWithVerifier);
      const user = await createActor('Dual WS User', 'dualws', 'member');
      const admin1 = await createActor('Admin WS 1', 'adminws1', 'member');
      const admin2 = await createActor('Admin WS 2', 'adminws2', 'member');

      const ws1Id = await seedWorkspace('Workspace 1', `ws1-${randomUUID().slice(0, 8)}`, admin1.id);
      await seedMembership(ws1Id, admin1.id, 'admin', 'active');
      await seedMembership(ws1Id, user.id, 'member', 'active');

      const ws2Id = await seedWorkspace('Workspace 2', `ws2-${randomUUID().slice(0, 8)}`, admin2.id);
      await seedMembership(ws2Id, admin2.id, 'admin', 'active');
      await seedMembership(ws2Id, user.id, 'member', 'active');

      const cloud1 = `cloud-ws1-${randomUUID().slice(0, 6)}`;
      const cloud2 = `cloud-ws2-${randomUUID().slice(0, 6)}`;

      const site1Id = await seedWorkspaceSite(ws1Id, cloud1, { active: true });
      const site2Id = await seedWorkspaceSite(ws2Id, cloud2, { active: true });

      const accountId = await seedJiraAccount(user.id, 'connected');
      const grantId = await seedGrant(accountId, cloud1, { status: 'active' });
      await addGrantSite(grantId, cloud2);

      await seedWorkspaceProject(ws1Id, site1Id, cloud1, '10001', 'WS1', 'WS 1 Proj', true);
      await seedWorkspaceProject(ws2Id, site2Id, cloud2, '20001', 'WS2', 'WS 2 Proj', true);

      // Query Workspace 1
      const res1 = await request(app)
        .get(`/api/jira-workspaces/${ws1Id}/jira-capabilities`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(res1.status).toBe(200);
      const body1 = res1.body as WorkspaceJiraCapabilitiesResponse;
      expect(body1.workspaceId).toBe(ws1Id);
      expect(body1.sites.length).toBe(1);
      expect(body1.sites[0]!.cloudId).toBe(cloud1);

      // Query Workspace 2
      const res2 = await request(app)
        .get(`/api/jira-workspaces/${ws2Id}/jira-capabilities`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(res2.status).toBe(200);
      const body2 = res2.body as WorkspaceJiraCapabilitiesResponse;
      expect(body2.workspaceId).toBe(ws2Id);
      expect(body2.sites.length).toBe(1);
      expect(body2.sites[0]!.cloudId).toBe(cloud2);
    });

    it('enforces cross-user isolation within the same workspace based on individual grants and permissions', async () => {
      const app = buildApp(workspaceRepoWithVerifier);
      const userA = await createActor('User A Distinct', 'usera', 'member');
      const userB = await createActor('User B Distinct', 'userb', 'member');
      const admin = await createActor('Admin Shared', 'adminshared', 'member');

      const wsId = await seedWorkspace('Shared Perm WS', `ws-shared-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');
      await seedMembership(wsId, userA.id, 'member', 'active');
      await seedMembership(wsId, userB.id, 'member', 'active');

      const cloudA = `cloud-only-a-${randomUUID().slice(0, 6)}`;
      const cloudB = `cloud-only-b-${randomUUID().slice(0, 6)}`;

      const siteAId = await seedWorkspaceSite(wsId, cloudA, { active: true });
      const siteBId = await seedWorkspaceSite(wsId, cloudB, { active: true });

      await seedWorkspaceProject(wsId, siteAId, cloudA, '10001', 'PRJA', 'Project A', true);
      await seedWorkspaceProject(wsId, siteBId, cloudB, '20001', 'PRJB', 'Project B', true);

      // User A only granted cloudA
      const accountAId = await seedJiraAccount(userA.id, 'connected');
      await seedGrant(accountAId, cloudA, { status: 'active' });

      // User B only granted cloudB
      const accountBId = await seedJiraAccount(userB.id, 'connected');
      await seedGrant(accountBId, cloudB, { status: 'active' });

      // Query as User A
      const resA = await request(app)
        .get(`/api/jira-workspaces/${wsId}/jira-capabilities`)
        .set('Authorization', `Bearer ${userA.token}`);

      expect(resA.status).toBe(200);
      const bodyA = resA.body as WorkspaceJiraCapabilitiesResponse;
      expect(bodyA.sites.length).toBe(1);
      expect(bodyA.sites[0]!.cloudId).toBe(cloudA);

      // Query as User B
      const resB = await request(app)
        .get(`/api/jira-workspaces/${wsId}/jira-capabilities`)
        .set('Authorization', `Bearer ${userB.token}`);

      expect(resB.status).toBe(200);
      const bodyB = resB.body as WorkspaceJiraCapabilitiesResponse;
      expect(bodyB.sites.length).toBe(1);
      expect(bodyB.sites[0]!.cloudId).toBe(cloudB);
    });

    it('propagates 503 NATIVE_VERIFIER_UNAVAILABLE when native verifier throws or reports unavailable', async () => {
      const app = buildApp(workspaceRepoWithVerifier);
      const user = await createActor('Fail Verifier User', 'failverif', 'member');
      const admin = await createActor('Admin Fail Verif', 'adminfailverif', 'member');

      const wsId = await seedWorkspace('Fail Verif WS', `ws-failv-${randomUUID().slice(0, 8)}`, admin.id);
      await seedMembership(wsId, admin.id, 'admin', 'active');
      await seedMembership(wsId, user.id, 'member', 'active');

      const cloudId = `cloud-failv-${randomUUID().slice(0, 6)}`;
      const siteId = await seedWorkspaceSite(wsId, cloudId, { active: true });
      await seedWorkspaceProject(wsId, siteId, cloudId, '10001', 'ENG', 'Engineering Core', true);

      const accountId = await seedJiraAccount(user.id, 'connected');
      await seedGrant(accountId, cloudId, { status: 'active' });

      // Case 1: Verifier throws exception
      mockVerifier.shouldThrow = true;

      const resThrow = await request(app)
        .get(`/api/jira-workspaces/${wsId}/jira-capabilities`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(resThrow.status).toBe(503);
      expect(resThrow.body.code ?? resThrow.body.error).toMatch(/NATIVE_VERIFIER_UNAVAILABLE/i);

      // Case 2: Verifier reports unavailable status
      mockVerifier.shouldThrow = false;
      mockVerifier.shouldReturnUnavailable = true;

      const resUnavail = await request(app)
        .get(`/api/jira-workspaces/${wsId}/jira-capabilities`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(resUnavail.status).toBe(503);
      expect(resUnavail.body.code ?? resUnavail.body.error).toMatch(/NATIVE_VERIFIER_UNAVAILABLE/i);
    });

    it('fails closed with 503 when jiraWorkspaceRepo is omitted from AppOptions', async () => {
      const appWithoutRepo = buildApp(undefined);
      const user = await createActor('No Repo User', 'norepouser', 'member');
      const wsId = randomUUID();

      const res = await request(appWithoutRepo)
        .get(`/api/jira-workspaces/${wsId}/jira-capabilities`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(res.status).toBe(503);
      expect(res.body).toHaveProperty('error');
    });
  });
});
