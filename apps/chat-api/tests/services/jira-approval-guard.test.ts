import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import type pg from 'pg';
import {
  createIsolatedTestSchema,
  createSyntheticUser,
  connectSyntheticJiraAccount,
  type IsolatedTestContext,
} from '../helpers/jira-test-db.js';
import {
  type JiraPlanConnection,
  type PlanStep,
  type PlanResponse,
} from '@wap/tool-schemas';
import { JiraPlanBinder } from '../../src/services/jira/jira-plan-binding.js';
import {
  validateJiraApprovalBinding,
  type JiraApprovalValidationResult,
} from '../../src/services/jira/jira-approval-guard.js';
import { ExecutionService } from '../../src/services/execution-service.js';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import { PlanRepo } from '../../src/db/repositories/plan-repo.js';

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
  conversationId: string;
  planId: string;
  planHash: string;
  boundConnection: JiraPlanConnection;
  steps: PlanStep[];
}

describe('Jira Approval and Start Guards (JIRA-08 Task 2 Real PostgreSQL Tests)', () => {
  let ctx: IsolatedTestContext;
  let pool: pg.Pool;

  beforeAll(async () => {
    ctx = await createIsolatedTestSchema();
    await ctx.runAllMigrations();
    pool = ctx.pool;
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 100));
    await ctx.cleanup();
  });

  async function createFixture(prefix = 'appr'): Promise<TestFixtureContext> {
    const userId = await createSyntheticUser(pool, `User ${prefix}`, `user_${prefix}`);
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
    const projectKey = 'PROJ';
    await pool.query(
      `INSERT INTO ati_workspace_jira_projects (
        workspace_id, site_id, cloud_id, numeric_project_id, project_key, project_name, selected, policy_version
      ) VALUES ($1, $2, $3, $4, $5, $6, true, 1)`,
      [workspaceId, siteId, cloudId, projectId, projectKey, 'Test Project']
    );

    const convRes = await pool.query<{ id: string }>(
      `INSERT INTO conversations (user_id, workspace_id, workspace_mode, jira_context, title, status)
       VALUES ($1, $2, 'organization', true, 'Jira Conversation', 'active')
       RETURNING id`,
      [userId, workspaceId]
    );
    const conversationId = convRes.rows[0]!.id;

    const steps: PlanStep[] = [
      {
        id: 'step_1',
        tool: 'myjira.search_issues',
        description: 'Search issues',
        args: { siteId, projectKey, query: 'Task Approval Test' },
        dependsOn: [],
      },
    ];

    const binder = new JiraPlanBinder({ pool });
    const conv = {
      id: conversationId,
      user_id: userId,
      workspace_id: workspaceId,
      workspace_mode: 'organization',
      jira_context: true,
    };
    const boundConnection = await binder.bindPlan(userId, conv, steps);

    const planJson: PlanResponse = {
      kind: 'plan',
      thinking: 'Plan steps',
      summary: 'Task Approval Test',
      steps,
      warnings: [],
      connections: { myjira: boundConnection },
    };

    const planText = JSON.stringify(planJson);
    const planHash = createHash('sha256').update(planText).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    const planRepoForFixture = new PlanRepo(pool);
    const createdPlan = await planRepoForFixture.createPlan({
      convId: conversationId,
      planJson,
      planText,
      planHash,
      expiresAt,
    });
    const planId = createdPlan.id;

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
      conversationId,
      planId,
      planHash,
      boundConnection,
      steps,
    };
  }

  it('rejects approval when membership status becomes removed after preview; plan remains pending, no exec_start emitted', async () => {
    const f = await createFixture('mem_rem');
    const convRepo = new ConversationRepo(pool);
    const planRepo = new PlanRepo(pool);
    const emittedEvents: Array<{ event: string; payload: any }> = [];
    const sseManager = {
      emitEvent: (convId: string, event: string, payload: any) => {
        emittedEvents.push({ event, payload });
      },
    } as any;

    const executionService = new ExecutionService({
      planRepo,
      convRepo,
      sseManager,
      adapterFactory: { getAdapterForService: () => ({}) },
      pool,
    });

    // Remove member in ati_workspace_memberships
    await pool.query(
      `UPDATE ati_workspace_memberships SET status = 'removed' WHERE workspace_id = $1 AND user_id = $2`,
      [f.workspaceId, f.userId]
    );

    const result = await executionService.approveAndStart(f.planId, f.userId);
    expect(result.success).toBe(false);
    expect(result.status).toBe(403);

    // Plan must remain pending
    const planRow = await planRepo.getPlan(f.planId);
    expect(planRow?.status).toBe('pending');
    expect(planRow?.decided_at).toBeNull();

    // No exec_start event emitted
    expect(emittedEvents.some((e) => e.event === 'exec_start')).toBe(false);
  });

  it('rejects approval when membership version changes (stale) after preview; plan remains pending', async () => {
    const f = await createFixture('mem_stale');
    const convRepo = new ConversationRepo(pool);
    const planRepo = new PlanRepo(pool);
    const emittedEvents: Array<{ event: string; payload: any }> = [];
    const sseManager = {
      emitEvent: (convId: string, event: string, payload: any) => {
        emittedEvents.push({ event, payload });
      },
    } as any;

    const executionService = new ExecutionService({
      planRepo,
      convRepo,
      sseManager,
      adapterFactory: { getAdapterForService: () => ({}) },
      pool,
    });

    // Increment membership version
    await pool.query(
      `UPDATE ati_workspace_memberships SET version = version + 1 WHERE workspace_id = $1 AND user_id = $2`,
      [f.workspaceId, f.userId]
    );

    const result = await executionService.approveAndStart(f.planId, f.userId);
    expect(result.success).toBe(false);
    expect(result.status).toBe(409);

    const planRow = await planRepo.getPlan(f.planId);
    expect(planRow?.status).toBe('pending');
    expect(emittedEvents.some((e) => e.event === 'exec_start')).toBe(false);
  });

  it('rejects approval when account identity disconnects or identityVersion changes; plan remains pending', async () => {
    const f = await createFixture('acc_stale');
    const convRepo = new ConversationRepo(pool);
    const planRepo = new PlanRepo(pool);
    const executionService = new ExecutionService({
      planRepo,
      convRepo,
      adapterFactory: { getAdapterForService: () => ({}) },
      pool,
    });

    // Case 1: Account status disconnected
    await pool.query(
      `UPDATE jira_accounts SET status = 'disconnected' WHERE id = $1`,
      [f.accountId]
    );

    const res1 = await executionService.approveAndStart(f.planId, f.userId);
    expect(res1.success).toBe(false);
    expect(res1.status).toBe(403);

    // Reset status but bump identity_version
    await pool.query(
      `UPDATE jira_accounts SET status = 'connected', identity_version = identity_version + 1 WHERE id = $1`,
      [f.accountId]
    );

    const res2 = await executionService.approveAndStart(f.planId, f.userId);
    expect(res2.success).toBe(false);
    expect(res2.status).toBe(409);

    const planRow = await planRepo.getPlan(f.planId);
    expect(planRow?.status).toBe('pending');
  });

  it('rejects approval when OAuth grant is revoked after preview; plan remains pending', async () => {
    const f = await createFixture('grant_rev');
    const convRepo = new ConversationRepo(pool);
    const planRepo = new PlanRepo(pool);
    const executionService = new ExecutionService({
      planRepo,
      convRepo,
      adapterFactory: { getAdapterForService: () => ({}) },
      pool,
    });

    await pool.query(
      `UPDATE jira_oauth_grants SET status = 'revoked' WHERE id = $1`,
      [f.grantId]
    );

    const result = await executionService.approveAndStart(f.planId, f.userId);
    expect(result.success).toBe(false);
    expect(result.status).toBe(403);

    const planRow = await planRepo.getPlan(f.planId);
    expect(planRow?.status).toBe('pending');
  });

  it('rejects approval when workspace version changes after preview; plan remains pending', async () => {
    const f = await createFixture('ws_stale');
    const convRepo = new ConversationRepo(pool);
    const planRepo = new PlanRepo(pool);
    const executionService = new ExecutionService({
      planRepo,
      convRepo,
      adapterFactory: { getAdapterForService: () => ({}) },
      pool,
    });

    await pool.query(
      `UPDATE ati_workspaces SET version = version + 1 WHERE id = $1`,
      [f.workspaceId]
    );

    const result = await executionService.approveAndStart(f.planId, f.userId);
    expect(result.success).toBe(false);
    expect(result.status).toBe(409);

    const planRow = await planRepo.getPlan(f.planId);
    expect(planRow?.status).toBe('pending');
  });

  it('rejects approval when site is deactivated or site policy version changes; plan remains pending', async () => {
    const f = await createFixture('site_chg');
    const convRepo = new ConversationRepo(pool);
    const planRepo = new PlanRepo(pool);
    const executionService = new ExecutionService({
      planRepo,
      convRepo,
      adapterFactory: { getAdapterForService: () => ({}) },
      pool,
    });

    // Bump site policy version
    await pool.query(
      `UPDATE ati_workspace_jira_sites SET policy_version = policy_version + 1 WHERE id = $1`,
      [f.siteId]
    );

    const result = await executionService.approveAndStart(f.planId, f.userId);
    expect(result.success).toBe(false);
    expect(result.status).toBe(409);

    const planRow = await planRepo.getPlan(f.planId);
    expect(planRow?.status).toBe('pending');
  });

  it('rejects approval when project is unselected or project policy version changes; plan remains pending', async () => {
    const f = await createFixture('proj_chg');
    const convRepo = new ConversationRepo(pool);
    const planRepo = new PlanRepo(pool);
    const executionService = new ExecutionService({
      planRepo,
      convRepo,
      adapterFactory: { getAdapterForService: () => ({}) },
      pool,
    });

    // Unselect project
    await pool.query(
      `UPDATE ati_workspace_jira_projects SET selected = false WHERE site_id = $1`,
      [f.siteId]
    );

    const result = await executionService.approveAndStart(f.planId, f.userId);
    expect(result.success).toBe(false);
    expect(result.status).toBe(403);

    const planRow = await planRepo.getPlan(f.planId);
    expect(planRow?.status).toBe('pending');
  });

  it('atomic SQL CAS guard prevents approval if membership or grant changes during CAS race', async () => {
    const f = await createFixture('cas_race');
    const planRepo = new PlanRepo(pool);

    const jiraGuard = {
      workspaceId: f.workspaceId,
      workspaceVersion: f.boundConnection.workspaceVersion,
      membershipVersion: f.boundConnection.membershipVersion,
      identityVersion: f.boundConnection.identityVersion,
      grantId: f.boundConnection.grantId,
    };

    // Simulate concurrent revocation of grant right before CAS
    await pool.query(
      `UPDATE jira_oauth_grants SET status = 'revoked' WHERE id = $1`,
      [f.grantId]
    );

    const approved = await planRepo.approvePlan(f.planId, f.planHash, f.userId, jiraGuard);
    expect(approved).toBe(false);

    const planRow = await planRepo.getPlan(f.planId);
    expect(planRow?.status).toBe('pending');
  });

  it('approval succeeds when authority remains unchanged: transitions to approved and emits exec_start', async () => {
    const f = await createFixture('success');
    const convRepo = new ConversationRepo(pool);
    const planRepo = new PlanRepo(pool);
    const emittedEvents: Array<{ event: string; payload: any }> = [];
    const sseManager = {
      emitEvent: (convId: string, event: string, payload: any) => {
        emittedEvents.push({ event, payload });
      },
    } as any;

    const executionService = new ExecutionService({
      planRepo,
      convRepo,
      sseManager,
      adapterFactory: { getAdapterForService: () => ({}) },
      pool,
    });

    const result = await executionService.approveAndStart(f.planId, f.userId);
    expect(result.success).toBe(true);
    expect(result.status).toBe(200);

    const planRow = await planRepo.getPlan(f.planId);
    expect(planRow?.status).toBe('approved');
    expect(planRow?.decided_at).not.toBeNull();
    expect(emittedEvents.some((e) => e.event === 'exec_start')).toBe(true);
  });

  it('aborts queued execution when authority changes between approval CAS and queued start', async () => {
    const f = await createFixture('queued_abort');
    const convRepo = new ConversationRepo(pool);
    const planRepo = new PlanRepo(pool);
    const emittedEvents: Array<{ event: string; payload: any }> = [];
    const sseManager = {
      emitEvent: (convId: string, event: string, payload: any) => {
        emittedEvents.push({ event, payload });
      },
    } as any;

    const executionService = new ExecutionService({
      planRepo,
      convRepo,
      sseManager,
      adapterFactory: { getAdapterForService: () => ({}) },
      pool,
    });

    // Intercept approvePlan to simulate grant revocation occurring right at the CAS boundary
    const originalApprovePlan = planRepo.approvePlan.bind(planRepo);
    planRepo.approvePlan = async (planId, hash, userId, jiraGuard) => {
      const res = await originalApprovePlan(planId, hash, userId, jiraGuard);
      if (res) {
        // Grant is revoked right after CAS succeeds, before queued setImmediate runs!
        await pool.query(
          `UPDATE jira_oauth_grants SET status = 'revoked' WHERE id = $1`,
          [f.grantId]
        );
      }
      return res;
    };

    const result = await executionService.approveAndStart(f.planId, f.userId);
    expect(result.success).toBe(true);

    // Wait for setImmediate to execute queued start check
    for (let i = 0; i < 50 && !emittedEvents.some((e) => e.event === 'exec_done' && e.payload?.status === 'failed'); i++) {
      await new Promise((r) => setTimeout(r, 20));
    }

    const failedEvent = emittedEvents.find((e) => e.event === 'exec_done' && e.payload?.status === 'failed');
    expect(failedEvent).toBeDefined();
    expect(failedEvent!.payload.error.message).toContain('Queued execution aborted');

    const planRow = await planRepo.getPlan(f.planId);
    expect(planRow?.status).toBe('failed');
  });

  it('rejects approval binding when Jira native permissions lack browse, createIssue, or addComment', async () => {
    const f = await createFixture('native_perm');

    // 1. Browse permission denied
    const browseDeniedVerifier = {
      verifyUserPermissions: async () => ({
        canBrowse: false,
        canCreateIssue: false,
        canAddComment: false,
        status: 'denied' as const,
        reason: 'User lacks BROWSE_PROJECTS',
      }),
    };

    const res1 = await validateJiraApprovalBinding(pool, f.boundConnection, {
      verifier: browseDeniedVerifier,
      requiredPermissions: { browse: true },
    });
    expect(res1.valid).toBe(false);
    if (!res1.valid) {
      expect(res1.status).toBe(403);
      expect(res1.category).toBe('denied');
      expect(res1.reason).toMatch(/BROWSE_PROJECTS/i);
    }

    // 2. Create issue denied
    const createDeniedVerifier = {
      verifyUserPermissions: async () => ({
        canBrowse: true,
        canCreateIssue: false,
        canAddComment: true,
        status: 'granted' as const,
      }),
    };

    const res2 = await validateJiraApprovalBinding(pool, f.boundConnection, {
      verifier: createDeniedVerifier,
      requiredPermissions: { browse: true, createIssue: true },
    });
    expect(res2.valid).toBe(false);
    if (!res2.valid) {
      expect(res2.status).toBe(403);
      expect(res2.category).toBe('denied');
      expect(res2.reason).toMatch(/JIRA_CAPABILITY_DISABLED_IN_G2A|CREATE_ISSUES/i);
    }

    // 3. Add comment denied in G2A
    const commentDeniedVerifier = {
      verifyUserPermissions: async () => ({
        canBrowse: true,
        canCreateIssue: true,
        canAddComment: false,
        status: 'granted' as const,
      }),
    };

    const res3 = await validateJiraApprovalBinding(pool, f.boundConnection, {
      verifier: commentDeniedVerifier,
      requiredPermissions: { browse: true, addComment: true },
    });
    expect(res3.valid).toBe(false);
    if (!res3.valid) {
      expect(res3.status).toBe(403);
      expect(res3.category).toBe('denied');
      expect(res3.reason).toMatch(/JIRA_CAPABILITY_DISABLED_IN_G2A|ADD_COMMENTS/i);
    }

    // 4. Verification unavailable (503)
    const unavailVerifier = {
      verifyUserPermissions: async () => ({
        canBrowse: false,
        canCreateIssue: false,
        canAddComment: false,
        status: 'unavailable' as const,
        reason: 'Atlassian API timeout',
      }),
    };

    const res4 = await validateJiraApprovalBinding(pool, f.boundConnection, {
      verifier: unavailVerifier,
    });
    expect(res4.valid).toBe(false);
    if (!res4.valid) {
      expect(res4.status).toBe(503);
      expect(res4.category).toBe('unavailable');
    }
  });
});
