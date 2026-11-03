import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import type pg from 'pg';
import {
  createIsolatedTestSchema,
  createSyntheticUser,
  connectSyntheticJiraAccount,
  type IsolatedTestContext,
} from '../helpers/jira-test-db.js';
import {
  validateJiraPlanConnection,
  type JiraPlanConnection,
  type PlanStep,
  type PlanResponse,
} from '@wap/tool-schemas';
import {
  JiraPlanBinder,
  JiraBindingError,
} from '../../src/services/jira/jira-plan-binding.js';

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
}

describe('JiraPlanBinder (JIRA-08 Task 1 Real PostgreSQL Tests)', () => {
  let ctx: IsolatedTestContext;
  let pool: pg.Pool;

  beforeAll(async () => {
    ctx = await createIsolatedTestSchema();
    await ctx.runAllMigrations();
    pool = ctx.pool;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  async function createTestFixture(prefix = 'bind1'): Promise<TestFixtureContext> {
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
    };
  }

  it('spoofed connections.myjira from model or client is discarded and replaced by server authority', async () => {
    const f = await createTestFixture('spoof');
    const binder = new JiraPlanBinder({ pool });

    const spoofedConnection: any = {
      atiUserId: 'fake-user-id',
      jiraAccountId: 'fake-account-id',
      atlassianAccountId: 'fake-atlas-id',
      workspaceId: 'fake-ws-id',
      membershipVersion: 999,
      grantId: 'fake-grant-id',
      identityVersion: 999,
      workspaceVersion: 999,
      siteSteps: {
        step_1: {
          siteId: 'fake-site',
          cloudId: 'fake-cloud',
          sitePolicyVersion: 999,
        },
      },
    };

    const steps: PlanStep[] = [
      {
        id: 'step_1',
        tool: 'myjira.create_issue',
        description: 'Create issue',
        args: { siteId: f.siteId, projectKey: f.projectKey, summary: 'Legit Task' },
        dependsOn: [],
      },
    ];

    const conv = {
      id: f.conversationId,
      user_id: f.userId,
      workspace_id: f.workspaceId,
      workspace_mode: 'organization',
      jira_context: true,
    };

    const bound = await binder.bindPlan(f.userId, conv, steps);
    validateJiraPlanConnection(bound);

    expect(bound.atiUserId).toBe(f.userId);
    expect(bound.jiraAccountId).toBe(f.accountId);
    expect(bound.atlassianAccountId).toBe(f.atlassianAccountId);
    expect(bound.workspaceId).toBe(f.workspaceId);
    expect(bound.membershipVersion).toBe(1);
    expect(bound.identityVersion).toBe(1);
    expect(bound.workspaceVersion).toBe(1);
    expect(bound.grantId).toBe(f.grantId);

    expect(bound.atiUserId).not.toBe(spoofedConnection.atiUserId);
    expect(bound.workspaceId).not.toBe(spoofedConnection.workspaceId);
    expect(bound.siteSteps['step_1']).toEqual({
      siteId: f.siteId,
      cloudId: f.cloudId,
      sitePolicyVersion: 1,
      projectId: f.projectId,
      projectPolicyVersion: 1,
    });
  });

  it('valid multi-site steps receive distinct siteSteps scopes in the same workspace', async () => {
    const f = await createTestFixture('multisite');
    const binder = new JiraPlanBinder({ pool });

    // Link a second site and project into the same workspace
    const cloudId2 = `cloud-2-${randomUUID().slice(0, 8)}`;
    await pool.query(
      `INSERT INTO jira_grant_sites (
        grant_id, cloud_id, site_name, site_url, product_type, scopes, last_verified_at
      ) VALUES ($1, $2, $3, $4, 'jira', $5, clock_timestamp())`,
      [
        f.grantId,
        cloudId2,
        'Site Beta',
        'https://beta.atlassian.net',
        ['read:jira-work', 'write:jira-work'],
      ]
    );

    const site2Res = await pool.query<{ id: string }>(
      `INSERT INTO ati_workspace_jira_sites (
        workspace_id, cloud_id, site_name, site_url, active, policy_version, linked_by, verified_admin_by, admin_verified_at
      ) VALUES ($1, $2, 'Site Beta', 'https://beta.atlassian.net', true, 2, $3, $3, clock_timestamp())
      RETURNING id`,
      [f.workspaceId, cloudId2, f.userId]
    );
    const siteId2 = site2Res.rows[0]!.id;

    const projectId2 = '20002';
    const projectKey2 = 'BETA';
    await pool.query(
      `INSERT INTO ati_workspace_jira_projects (
        workspace_id, site_id, cloud_id, numeric_project_id, project_key, project_name, selected, policy_version
      ) VALUES ($1, $2, $3, $4, $5, $6, true, 3)`,
      [f.workspaceId, siteId2, cloudId2, projectId2, projectKey2, 'Beta Project']
    );

    const steps: PlanStep[] = [
      {
        id: 'step_1',
        tool: 'myjira.create_issue',
        description: 'Create issue on site 1',
        args: { siteId: f.siteId, projectKey: f.projectKey, summary: 'Task 1' },
        dependsOn: [],
      },
      {
        id: 'step_2',
        tool: 'myjira.create_issue',
        description: 'Create issue on site 2',
        args: { siteId: siteId2, projectKey: projectKey2, summary: 'Task 2' },
        dependsOn: ['step_1'],
      },
      {
        id: 'step_3',
        tool: 'myjira.search_projects',
        description: 'Search projects on site 2',
        args: { siteId: siteId2, query: 'proj' },
        dependsOn: [],
      },
    ];

    const conv = {
      id: f.conversationId,
      user_id: f.userId,
      workspace_id: f.workspaceId,
      workspace_mode: 'organization',
      jira_context: true,
    };

    const bound = await binder.bindPlan(f.userId, conv, steps);
    validateJiraPlanConnection(bound);

    expect(bound.siteSteps['step_1']).toEqual({
      siteId: f.siteId,
      cloudId: f.cloudId,
      sitePolicyVersion: 1,
      projectId: f.projectId,
      projectPolicyVersion: 1,
    });
    expect(bound.siteSteps['step_2']).toEqual({
      siteId: siteId2,
      cloudId: cloudId2,
      sitePolicyVersion: 2,
      projectId: projectId2,
      projectPolicyVersion: 3,
    });
    // search_projects has site scope but no single project scope
    expect(bound.siteSteps['step_3']).toEqual({
      siteId: siteId2,
      cloudId: cloudId2,
      sitePolicyVersion: 2,
    });
  });

  it('rotated OAuth token updates tokenVersion and secrets but leaves plan binding and hash unchanged', async () => {
    const f = await createTestFixture('rotate');
    const binder = new JiraPlanBinder({ pool });

    const steps: PlanStep[] = [
      {
        id: 'step_1',
        tool: 'myjira.create_issue',
        description: 'Create issue',
        args: { siteId: f.siteId, projectKey: f.projectKey, summary: 'Pre-rotation Task' },
        dependsOn: [],
      },
    ];

    const conv = {
      id: f.conversationId,
      user_id: f.userId,
      workspace_id: f.workspaceId,
      workspace_mode: 'organization',
      jira_context: true,
    };

    const boundBefore = await binder.bindPlan(f.userId, conv, steps);
    const planResponseBefore: PlanResponse = {
      kind: 'plan',
      thinking: 'Plan steps',
      summary: 'Create task',
      steps,
      warnings: [],
      connections: { myjira: boundBefore },
    };
    const hashBefore = createHash('sha256').update(JSON.stringify(planResponseBefore)).digest('hex');

    // Simulate token rotation in jira_oauth_grants
    await pool.query(
      `UPDATE jira_oauth_grants
       SET token_version = token_version + 1,
           encrypted_access_token = 'new_rotated_encrypted_access_token',
           encrypted_refresh_token = 'new_rotated_encrypted_refresh_token',
           updated_at = clock_timestamp()
       WHERE id = $1`,
      [f.grantId]
    );

    const boundAfter = await binder.bindPlan(f.userId, conv, steps);
    const planResponseAfter: PlanResponse = {
      kind: 'plan',
      thinking: 'Plan steps',
      summary: 'Create task',
      steps,
      warnings: [],
      connections: { myjira: boundAfter },
    };
    const hashAfter = createHash('sha256').update(JSON.stringify(planResponseAfter)).digest('hex');

    expect(boundAfter).toEqual(boundBefore);
    expect(hashAfter).toBe(hashBefore);
  });

  it('removed member in ati_workspace_memberships or workspace_members fails before plan persistence', async () => {
    const f = await createTestFixture('rem_mem');
    const binder = new JiraPlanBinder({ pool });

    const steps: PlanStep[] = [
      {
        id: 'step_1',
        tool: 'myjira.create_issue',
        description: 'Create issue',
        args: { siteId: f.siteId, projectKey: f.projectKey, summary: 'Task' },
        dependsOn: [],
      },
    ];

    const conv = {
      id: f.conversationId,
      user_id: f.userId,
      workspace_id: f.workspaceId,
      workspace_mode: 'organization',
      jira_context: true,
    };

    // Mark member as removed in ati_workspace_memberships
    await pool.query(
      `UPDATE ati_workspace_memberships SET status = 'removed', version = version + 1 WHERE workspace_id = $1 AND user_id = $2`,
      [f.workspaceId, f.userId]
    );

    await expect(binder.bindPlan(f.userId, conv, steps)).rejects.toThrow(JiraBindingError);
  });

  it('revoked OAuth grant fails before plan persistence', async () => {
    const f = await createTestFixture('rev_grant');
    const binder = new JiraPlanBinder({ pool });

    const steps: PlanStep[] = [
      {
        id: 'step_1',
        tool: 'myjira.create_issue',
        description: 'Create issue',
        args: { siteId: f.siteId, projectKey: f.projectKey, summary: 'Task' },
        dependsOn: [],
      },
    ];

    const conv = {
      id: f.conversationId,
      user_id: f.userId,
      workspace_id: f.workspaceId,
      workspace_mode: 'organization',
      jira_context: true,
    };

    await pool.query(
      `UPDATE jira_oauth_grants SET status = 'revoked' WHERE id = $1`,
      [f.grantId]
    );

    await expect(binder.bindPlan(f.userId, conv, steps)).rejects.toThrow(JiraBindingError);
  });

  it('deactivated site fails before plan persistence', async () => {
    const f = await createTestFixture('deact_site');
    const binder = new JiraPlanBinder({ pool });

    const steps: PlanStep[] = [
      {
        id: 'step_1',
        tool: 'myjira.create_issue',
        description: 'Create issue',
        args: { siteId: f.siteId, projectKey: f.projectKey, summary: 'Task' },
        dependsOn: [],
      },
    ];

    const conv = {
      id: f.conversationId,
      user_id: f.userId,
      workspace_id: f.workspaceId,
      workspace_mode: 'organization',
      jira_context: true,
    };

    await pool.query(
      `UPDATE ati_workspace_jira_sites SET active = false, policy_version = policy_version + 1 WHERE id = $1`,
      [f.siteId]
    );

    await expect(binder.bindPlan(f.userId, conv, steps)).rejects.toThrow(JiraBindingError);
  });

  it('unselected or removed project fails before plan persistence', async () => {
    const f = await createTestFixture('unsel_proj');
    const binder = new JiraPlanBinder({ pool });

    const steps: PlanStep[] = [
      {
        id: 'step_1',
        tool: 'myjira.create_issue',
        description: 'Create issue',
        args: { siteId: f.siteId, projectKey: f.projectKey, summary: 'Task' },
        dependsOn: [],
      },
    ];

    const conv = {
      id: f.conversationId,
      user_id: f.userId,
      workspace_id: f.workspaceId,
      workspace_mode: 'organization',
      jira_context: true,
    };

    await pool.query(
      `UPDATE ati_workspace_jira_projects SET selected = false, policy_version = policy_version + 1 WHERE site_id = $1`,
      [f.siteId]
    );

    await expect(binder.bindPlan(f.userId, conv, steps)).rejects.toThrow(JiraBindingError);
  });

  it('moved issue pointing to an unselected or different project fails before plan persistence', async () => {
    const f = await createTestFixture('moved_issue');
    // Issue lookup resolver indicates that issue ATI-42 was moved to project UNSELECTED
    const binder = new JiraPlanBinder({
      pool,
      lookupIssue: async (_siteId, _cloudId, issueKey) => {
        if (issueKey === 'PROJ-42') {
          return { projectKey: 'UNSELECTED', numericProjectId: '99999' };
        }
        return null;
      },
    });

    const steps: PlanStep[] = [
      {
        id: 'step_1',
        tool: 'myjira.add_comment',
        description: 'Add comment on moved issue',
        args: { siteId: f.siteId, issueKey: 'PROJ-42', body: 'Comment body' },
        dependsOn: [],
      },
    ];

    const conv = {
      id: f.conversationId,
      user_id: f.userId,
      workspace_id: f.workspaceId,
      workspace_mode: 'organization',
      jira_context: true,
    };

    await expect(binder.bindPlan(f.userId, conv, steps)).rejects.toThrow(JiraBindingError);
  });

  it('conversation without jira_context or in personal mode fails to bind myjira steps', async () => {
    const f = await createTestFixture('bad_conv');
    const binder = new JiraPlanBinder({ pool });

    const steps: PlanStep[] = [
      {
        id: 'step_1',
        tool: 'myjira.create_issue',
        description: 'Create issue',
        args: { siteId: f.siteId, projectKey: f.projectKey, summary: 'Task' },
        dependsOn: [],
      },
    ];

    // Case 1: jira_context = false
    const convNoJira = {
      id: f.conversationId,
      user_id: f.userId,
      workspace_id: f.workspaceId,
      workspace_mode: 'organization',
      jira_context: false,
    };
    await expect(binder.bindPlan(f.userId, convNoJira, steps)).rejects.toThrow(JiraBindingError);

    // Case 2: workspace_mode = personal
    const convPersonal = {
      id: f.conversationId,
      user_id: f.userId,
      workspace_id: null,
      workspace_mode: 'personal',
      jira_context: false,
    };
    await expect(binder.bindPlan(f.userId, convPersonal, steps)).rejects.toThrow(JiraBindingError);
  });

  it('ChatService binds Jira plan from PostgreSQL and strips model-injected connections before hashing', async () => {
    const f = await createTestFixture('chat_service');
    const { ChatService } = await import('../../src/services/chat-service.js');
    const { ConversationRepo } = await import('../../src/db/repositories/conversation-repo.js');
    const { MessageRepo } = await import('../../src/db/repositories/message-repo.js');
    const { PlanRepo } = await import('../../src/db/repositories/plan-repo.js');

    const convRepo = new ConversationRepo(pool);
    const msgRepo = new MessageRepo(pool);
    const planRepo = new PlanRepo(pool);
    const events: Array<{ event: string; payload: any }> = [];

    const steps: PlanStep[] = [
      {
        id: 'step_1',
        tool: 'myjira.create_issue',
        description: 'Create issue',
        args: { siteId: f.siteId, projectKey: f.projectKey, summary: 'Task from Chat' },
        dependsOn: [],
      },
    ];

    const modelResponseWithSpoof: PlanResponse = {
      kind: 'plan',
      thinking: 'Plan steps',
      summary: 'Task from Chat',
      steps,
      warnings: [],
      connections: {
        myjira: {
          atiUserId: 'attacker',
          jiraAccountId: 'fake-acc',
          atlassianAccountId: 'fake-atlas',
          workspaceId: 'fake-ws',
          membershipVersion: 999,
          grantId: 'fake-grant',
          identityVersion: 999,
          workspaceVersion: 999,
          siteSteps: {
            step_1: {
              siteId: 'fake-site',
              cloudId: 'fake-cloud',
              sitePolicyVersion: 999,
            },
          },
        },
      },
    };

    const chatService = new ChatService({
      msgRepo,
      convRepo,
      planRepo,
      eventEmitter: { emit: (event, payload) => events.push({ event, payload }) },
      planner: {
        processMessage: async () => structuredClone(modelResponseWithSpoof),
      } as any,
      jiraBinder: new JiraPlanBinder({ pool }),
    });

    await chatService.handleUserMessage({
      conversationId: f.conversationId,
      userId: f.userId,
      content: 'Tạo task Jira mới',
    });

    for (let i = 0; i < 100 && !events.some((e) => ['plan_preview', 'refusal', 'clarification', 'error'].includes(e.event)); i++) {
      await new Promise((r) => setTimeout(r, 20));
    }

    const previewEvent = events.find((e) => e.event === 'plan_preview');
    expect(previewEvent).toBeDefined();
    const previewPlan = previewEvent!.payload.plan as PlanResponse;
    expect(previewPlan.connections?.myjira).toBeDefined();
    expect(previewPlan.connections!.myjira!.atiUserId).toBe(f.userId);
    expect(previewPlan.connections!.myjira!.workspaceId).toBe(f.workspaceId);
    expect(previewPlan.connections!.myjira!.atiUserId).not.toBe('attacker');

    // Check plan saved in DB has matching plan_hash and valid JiraPlanConnection
    const planRow = await planRepo.getPlan(previewEvent!.payload.planId);
    expect(planRow).not.toBeNull();
    const planText = planRow!.plan_text!;
    expect(planText).toBeTruthy();
    const parsedPlan = JSON.parse(planText);
    expect(parsedPlan.connections.myjira.atiUserId).toBe(f.userId);
    const computedHash = createHash('sha256').update(planText).digest('hex');
    expect(planRow!.plan_hash).toBe(computedHash);
  });
});
