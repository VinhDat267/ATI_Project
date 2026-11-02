import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import type pg from 'pg';
import {
  createIsolatedTestSchema,
  createSyntheticUser,
  connectSyntheticJiraAccount,
  type IsolatedTestContext,
} from '../helpers/jira-test-db.js';
import { PlanRepo } from '../../src/db/repositories/plan-repo.js';
import { StepRepo } from '../../src/db/repositories/step-repo.js';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import { ExecutionService } from '../../src/services/execution-service.js';
import { AdapterFactory } from '../../src/services/adapter-factory.js';
import { JiraLeaseManager } from '../../src/services/jira/jira-lease-manager.js';
import { JiraDispatchGuard } from '../../src/services/jira/jira-dispatch-guard.js';
import type { JiraPlanConnection, PlanStep } from '@wap/tool-schemas';

interface FixtureSetup {
  userId: string;
  workspaceId: string;
  accountId: string;
  atlassianAccountId: string;
  cloudId1: string;
  siteId1: string;
  cloudId2: string;
  siteId2: string;
  grantId: string;
}

describe('Jira Execution & Receipt Integration (JIRA-08 Task 4)', () => {
  let ctx: IsolatedTestContext;
  let pool: pg.Pool;
  let server: http.Server;
  let serverPort: number;
  let serverUrl: string;

  let planRepo: PlanRepo;
  let stepRepo: StepRepo;
  let convRepo: ConversationRepo;

  beforeAll(async () => {
    ctx = await createIsolatedTestSchema();
    await ctx.runAllMigrations();
    pool = ctx.pool;

    planRepo = new PlanRepo(pool);
    stepRepo = new StepRepo(pool);
    convRepo = new ConversationRepo(pool);

    server = http.createServer((req, res) => {
      const url = req.url || '';
      const method = req.method || 'GET';

      // Verify Bearer token presence (never empty)
      const auth = req.headers['authorization'];
      if (!auth || !auth.startsWith('Bearer ')) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      // 1. /myself
      if (url.includes('/myself')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ accountId: 'atlassian-user-123' }));
        return;
      }

      // 2. /createmeta/:projectKey/issuetypes
      if (url.includes('/createmeta/')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            startAt: 0,
            maxResults: 50,
            total: 1,
            issueTypes: [{ id: '10001', name: 'Task', subtask: false }],
          })
        );
        return;
      }

      // 3. /search/jql
      if (url.includes('/search/jql')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            issues: [
              {
                id: '10042',
                key: 'PROJ-42',
                fields: {
                  summary: 'Login bug',
                  status: { name: 'Open' },
                  project: { key: 'PROJ' },
                },
              },
            ],
          })
        );
        return;
      }

      // 4. GET /issue/:issueKey
      if (method === 'GET' && url.includes('/issue/')) {
        if (url.includes('MOVED-99')) {
          // Moved issue to unapproved project
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              id: '10099',
              key: 'MOVED-99',
              fields: { project: { key: 'UNAPPROVED_PROJECT' } },
            })
          );
          return;
        }

        const issueKey = url.split('/issue/')[1]?.split('?')[0] || 'PROJ-50';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            id: '10050',
            key: issueKey,
            fields: { project: { key: 'PROJ' } },
          })
        );
        return;
      }

      // 5. POST /issue (create_issue)
      if (method === 'POST' && url.endsWith('/issue')) {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', async () => {
          if (body.includes('FAIL_WITH_UNKNOWN')) {
            // Simulate 500 server error after request sent => ambiguous UNKNOWN write
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal Server Error' }));
            return;
          }
          if (body.includes('Initial Task')) {
            // Deactivate Site 2 before responding to Step 1 so Step 2 sees it revoked
            await pool.query(
              `UPDATE ati_workspace_jira_sites SET active = false, policy_version = policy_version + 1 WHERE site_name = 'Site 2'`
            );
          }
          const projKey = body.includes('BETA') ? 'BETA' : 'PROJ';
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: '10050', key: `${projKey}-50` }));
        });
        return;
      }

      // 6. POST /comment
      if (method === 'POST' && url.includes('/comment')) {
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: '20001' }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        serverPort = addr.port;
        serverUrl = `http://127.0.0.1:${serverPort}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await ctx.cleanup();
  });

  async function setupFixture(): Promise<FixtureSetup> {
    const userId = await createSyntheticUser(pool, 'Exec User', 'exec_user');
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

    const cloudId1 = randomUUID();
    const cloudId2 = randomUUID();

    for (const [cid, name] of [[cloudId1, 'Site 1'], [cloudId2, 'Site 2']]) {
      await pool.query(
        `INSERT INTO jira_grant_sites (
          grant_id, cloud_id, site_name, site_url, product_type, scopes, last_verified_at
        ) VALUES ($1, $2, $3, $4, 'jira', $5, clock_timestamp())`,
        [grantId, cid, name, serverUrl, ['read:jira-work', 'write:jira-work']]
      );
    }

    const workspaceId = randomUUID();
    const inviteCode = `ATI-${randomUUID().slice(0, 4)}-${randomUUID().slice(0, 4)}`.toUpperCase();
    const slug = `ws-${randomUUID().slice(0, 8)}`;

    await pool.query(
      `INSERT INTO workspaces (id, name, invite_code, require_approval, created_by)
       VALUES ($1, $2, $3, true, $4)`,
      [workspaceId, 'Exec Workspace', inviteCode, userId]
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

    const s1Res = await pool.query<{ id: string }>(
      `INSERT INTO ati_workspace_jira_sites (
        workspace_id, cloud_id, site_name, site_url, active, policy_version, linked_by, verified_admin_by, admin_verified_at
      ) VALUES ($1, $2, 'Site 1', $3, true, 1, $4, $4, clock_timestamp())
      RETURNING id`,
      [workspaceId, cloudId1, serverUrl, userId]
    );
    const siteId1 = s1Res.rows[0]!.id;

    const s2Res = await pool.query<{ id: string }>(
      `INSERT INTO ati_workspace_jira_sites (
        workspace_id, cloud_id, site_name, site_url, active, policy_version, linked_by, verified_admin_by, admin_verified_at
      ) VALUES ($1, $2, 'Site 2', $3, true, 1, $4, $4, clock_timestamp())
      RETURNING id`,
      [workspaceId, cloudId2, serverUrl, userId]
    );
    const siteId2 = s2Res.rows[0]!.id;

    // Projects for both sites
    await pool.query(
      `INSERT INTO ati_workspace_jira_projects (
        workspace_id, site_id, cloud_id, numeric_project_id, project_key, project_name, selected, policy_version
      ) VALUES ($1, $2, $3, '10001', 'PROJ', 'Project 1', true, 1)`,
      [workspaceId, siteId1, cloudId1]
    );

    await pool.query(
      `INSERT INTO ati_workspace_jira_projects (
        workspace_id, site_id, cloud_id, numeric_project_id, project_key, project_name, selected, policy_version
      ) VALUES ($1, $2, $3, '20002', 'BETA', 'Project 2', true, 1)`,
      [workspaceId, siteId2, cloudId2]
    );

    return {
      userId,
      workspaceId,
      accountId,
      atlassianAccountId,
      cloudId1,
      siteId1,
      cloudId2,
      siteId2,
      grantId,
    };
  }

  function createTestExecutionService(f: FixtureSetup) {
    const tokenManager = {
      getAccessToken: async () => 'test-token-jira-exec',
    };
    const leaseManager = new JiraLeaseManager({ pool, tokenManager });
    const dispatchGuard = new JiraDispatchGuard(pool, leaseManager, tokenManager);

    const adapterFactory = new AdapterFactory({
      credentialRepo: {} as any,
      encryptionKey: 'test-encryption-key-with-32bytes',
      jiraTokens: tokenManager,
      jiraDispatchGuard: dispatchGuard,
      jiraApiBaseUrl: serverUrl,
      jiraWorkspaceRepo: {
        getCapabilities: async () => ({
          workspaceId: f.workspaceId,
          sites: [
            {
              siteId: f.siteId1,
              cloudId: f.cloudId1,
              name: 'Site 1',
              url: serverUrl,
              projects: [{ id: '10001', key: 'PROJ', name: 'Project 1' }],
            },
            {
              siteId: f.siteId2,
              cloudId: f.cloudId2,
              name: 'Site 2',
              url: serverUrl,
              projects: [{ id: '20002', key: 'BETA', name: 'Project 2' }],
            },
          ],
        }),
      },
    });

    const executionService = new ExecutionService({
      planRepo,
      stepRepo,
      convRepo,
      workspaceRepo: { findMember: async () => ({ status: 'active', role: 'admin' }) } as any,
      adapterFactory,
      pool,
    });

    return { executionService, adapterFactory, tokenManager };
  }

  async function createApprovedPlan(
    f: FixtureSetup,
    steps: PlanStep[],
    siteSteps: JiraPlanConnection['siteSteps']
  ) {
    const conv = await convRepo.createConversation(
      f.userId,
      'Test Jira Execution',
      { workspaceMode: 'organization', workspaceId: f.workspaceId, jiraContext: true }
    );

    const planJson = {
      summary: 'Execute Jira steps',
      steps,
      connections: {
        myjira: {
          atiUserId: f.userId,
          jiraAccountId: f.accountId,
          atlassianAccountId: f.atlassianAccountId,
          workspaceId: f.workspaceId,
          membershipVersion: 1,
          grantId: f.grantId,
          identityVersion: 1,
          workspaceVersion: 1,
          siteSteps,
        },
      },
    };

    const planText = JSON.stringify(planJson);
    const planHash = createHash('sha256').update(planText).digest('hex');

    const plan = await planRepo.createPlan({
      convId: conv.id,
      planJson,
      planText,
      planHash,
      expiresAt: new Date(Date.now() + 3600000),
      resourceLabels: {
        [f.siteId1]: 'Site 1',
        [f.siteId2]: 'Site 2',
      },
    });

    return { conv, plan };
  }

  it('executes list_sites, project search, and issue search producing receipts with no tokens', async () => {
    const f = await setupFixture();
    const { executionService } = createTestExecutionService(f);

    const steps: PlanStep[] = [
      {
        id: 'step_1',
        tool: 'myjira.list_sites',
        description: 'List accessible Jira sites',
        args: { query: '' },
        dependsOn: [],
      },
      {
        id: 'step_2',
        tool: 'myjira.search_projects',
        description: 'Search projects in Site 1',
        args: { siteId: f.siteId1, query: 'PROJ' },
        dependsOn: ['step_1'],
      },
      {
        id: 'step_3',
        tool: 'myjira.search_issues',
        description: 'Search issues in Site 1',
        args: { siteId: f.siteId1, projectKey: 'PROJ', query: 'Login' },
        dependsOn: ['step_2'],
      },
    ];

    const siteSteps = {
      step_1: { siteId: f.siteId1, cloudId: f.cloudId1, sitePolicyVersion: 1 },
      step_2: { siteId: f.siteId1, cloudId: f.cloudId1, sitePolicyVersion: 1, projectId: '10001', projectPolicyVersion: 1 },
      step_3: { siteId: f.siteId1, cloudId: f.cloudId1, sitePolicyVersion: 1, projectId: '10001', projectPolicyVersion: 1 },
    };

    const { plan } = await createApprovedPlan(f, steps, siteSteps);
    await executionService.approveAndStart(plan.id, f.userId);

    // Wait for execution to settle
    let status = executionService.getExecutionStatus(plan.id);
    for (let i = 0; i < 50 && (!status || status.status === 'executing'); i++) {
      await new Promise((r) => setTimeout(r, 50));
      status = executionService.getExecutionStatus(plan.id);
    }

    expect(status?.status).toBe('completed');

    const executedSteps = await stepRepo.listSteps(plan.id);
    expect(executedSteps).toHaveLength(3);
    for (const step of executedSteps) {
      expect(step.status).toBe('succeeded');
      // Verify no tokens in output or error
      const text = JSON.stringify(step.output_json) + JSON.stringify(step.error_json);
      expect(text).not.toContain('test-token-jira-exec');
      expect(text).not.toContain('Bearer');
    }
  });

  it('executes create_issue and add_comment producing valid receipts with owner, workspace, site, and project', async () => {
    const f = await setupFixture();
    const { executionService } = createTestExecutionService(f);

    const steps: PlanStep[] = [
      {
        id: 'create_1',
        tool: 'myjira.create_issue',
        description: 'Create issue in Site 1',
        args: { siteId: f.siteId1, projectKey: 'PROJ', summary: 'Production Bug' },
        dependsOn: [],
      },
      {
        id: 'comment_1',
        tool: 'myjira.add_comment',
        description: 'Add comment to issue',
        args: { siteId: f.siteId1, issueKey: 'PROJ-50', body: 'Investigating now' },
        dependsOn: ['create_1'],
      },
    ];

    const siteSteps = {
      create_1: { siteId: f.siteId1, cloudId: f.cloudId1, sitePolicyVersion: 1, projectId: '10001', projectPolicyVersion: 1 },
      comment_1: { siteId: f.siteId1, cloudId: f.cloudId1, sitePolicyVersion: 1, projectId: '10001', projectPolicyVersion: 1 },
    };

    const { plan } = await createApprovedPlan(f, steps, siteSteps);
    await executionService.approveAndStart(plan.id, f.userId);

    let status = executionService.getExecutionStatus(plan.id);
    for (let i = 0; i < 50 && (!status || status.status === 'executing'); i++) {
      await new Promise((r) => setTimeout(r, 50));
      status = executionService.getExecutionStatus(plan.id);
    }

    const executedSteps = await stepRepo.listSteps(plan.id);

    expect(status?.status).toBe('completed');
    expect(executedSteps).toHaveLength(2);

    const createRow = executedSteps.find((s) => s.step_id === 'create_1')!;
    expect(createRow.status).toBe('succeeded');
    expect(createRow.output_json).toMatchObject({
      siteId: f.siteId1,
      id: '10050',
      key: 'PROJ-50',
      url: `${serverUrl}/browse/PROJ-50`,
      _receipt: {
        ownerId: f.userId,
        workspaceId: f.workspaceId,
        siteId: f.siteId1,
      },
    });

    const commentRow = executedSteps.find((s) => s.step_id === 'comment_1')!;
    expect(commentRow.status).toBe('succeeded');
    expect(commentRow.output_json).toMatchObject({
      siteId: f.siteId1,
      id: '20001',
      issueKey: 'PROJ-50',
      url: `${serverUrl}/browse/PROJ-50?focusedCommentId=20001`,
      _receipt: {
        ownerId: f.userId,
        workspaceId: f.workspaceId,
      },
    });
  });

  it('moved issue recheck halts execution if issue was moved to unapproved project', async () => {
    const f = await setupFixture();
    const { executionService } = createTestExecutionService(f);

    const steps: PlanStep[] = [
      {
        id: 'comment_moved',
        tool: 'myjira.add_comment',
        description: 'Comment on moved issue',
        args: { siteId: f.siteId1, issueKey: 'MOVED-99', body: 'Should fail' },
        dependsOn: [],
      },
    ];

    const siteSteps = {
      comment_moved: { siteId: f.siteId1, cloudId: f.cloudId1, sitePolicyVersion: 1, projectId: '10001', projectPolicyVersion: 1 },
    };

    const { plan } = await createApprovedPlan(f, steps, siteSteps);
    await executionService.approveAndStart(plan.id, f.userId);

    let status = executionService.getExecutionStatus(plan.id);
    for (let i = 0; i < 50 && (!status || status.status === 'executing'); i++) {
      await new Promise((r) => setTimeout(r, 50));
      status = executionService.getExecutionStatus(plan.id);
    }

    expect(status?.status).toBe('partial');
    const executedSteps = await stepRepo.listSteps(plan.id);
    expect(executedSteps[0]!.status).toBe('failed');
    expect(executedSteps[0]!.error_json.category).toBe('AUTH_ERROR');
  });

  it('executes multi-site plan across two different sites successfully', async () => {
    const f = await setupFixture();
    const { executionService } = createTestExecutionService(f);

    const steps: PlanStep[] = [
      {
        id: 'site1_issue',
        tool: 'myjira.create_issue',
        description: 'Create issue on Site 1',
        args: { siteId: f.siteId1, projectKey: 'PROJ', summary: 'Site 1 Task' },
        dependsOn: [],
      },
      {
        id: 'site2_issue',
        tool: 'myjira.create_issue',
        description: 'Create issue on Site 2',
        args: { siteId: f.siteId2, projectKey: 'BETA', summary: 'Site 2 Task' },
        dependsOn: ['site1_issue'],
      },
    ];

    const siteSteps = {
      site1_issue: { siteId: f.siteId1, cloudId: f.cloudId1, sitePolicyVersion: 1, projectId: '10001', projectPolicyVersion: 1 },
      site2_issue: { siteId: f.siteId2, cloudId: f.cloudId2, sitePolicyVersion: 1, projectId: '20002', projectPolicyVersion: 1 },
    };

    const { plan } = await createApprovedPlan(f, steps, siteSteps);
    await executionService.approveAndStart(plan.id, f.userId);

    let status = executionService.getExecutionStatus(plan.id);
    for (let i = 0; i < 50 && (!status || status.status === 'executing'); i++) {
      await new Promise((r) => setTimeout(r, 50));
      status = executionService.getExecutionStatus(plan.id);
    }

    expect(status?.status).toBe('completed');
    const executedSteps = await stepRepo.listSteps(plan.id);
    expect(executedSteps).toHaveLength(2);
    expect(executedSteps[0]!.status).toBe('succeeded');
    expect(executedSteps[1]!.status).toBe('succeeded');
  });

  it('revoked later step preserves prior step receipt in database', async () => {
    const f = await setupFixture();
    const { executionService } = createTestExecutionService(f);

    const steps: PlanStep[] = [
      {
        id: 'step_ok',
        tool: 'myjira.create_issue',
        description: 'Create issue on Site 1',
        args: { siteId: f.siteId1, projectKey: 'PROJ', summary: 'Initial Task' },
        dependsOn: [],
      },
      {
        id: 'step_revoked',
        tool: 'myjira.create_issue',
        description: 'Create issue on Site 2',
        args: { siteId: f.siteId2, projectKey: 'BETA', summary: 'Should be stopped' },
        dependsOn: ['step_ok'],
      },
    ];

    const siteSteps = {
      step_ok: { siteId: f.siteId1, cloudId: f.cloudId1, sitePolicyVersion: 1, projectId: '10001', projectPolicyVersion: 1 },
      step_revoked: { siteId: f.siteId2, cloudId: f.cloudId2, sitePolicyVersion: 1, projectId: '20002', projectPolicyVersion: 1 },
    };

    const { plan } = await createApprovedPlan(f, steps, siteSteps);

    await executionService.approveAndStart(plan.id, f.userId);

    let status = executionService.getExecutionStatus(plan.id);
    for (let i = 0; i < 50 && (!status || status.status === 'executing'); i++) {
      await new Promise((r) => setTimeout(r, 50));
      status = executionService.getExecutionStatus(plan.id);
    }

    expect(status?.status).toBe('partial');

    // Step 1 receipt must remain completely preserved and succeeded
    const executedSteps = await stepRepo.listSteps(plan.id);
    const step1 = executedSteps.find((s) => s.step_id === 'step_ok')!;
    expect(step1.status).toBe('succeeded');
    expect(step1.output_json).toBeDefined();
    expect(step1.output_json.id).toBe('10050');

    // Step 2 must be failed
    const step2 = executedSteps.find((s) => s.step_id === 'step_revoked')!;
    expect(step2.status).toBe('failed');
  });

  it('UNKNOWN write error is not retried by recovery', async () => {
    const f = await setupFixture();
    const { executionService } = createTestExecutionService(f);

    const steps: PlanStep[] = [
      {
        id: 'write_fail',
        tool: 'myjira.create_issue',
        description: 'Write that fails with unknown server outcome',
        args: { siteId: f.siteId1, projectKey: 'PROJ', summary: 'FAIL_WITH_UNKNOWN' },
        dependsOn: [],
      },
    ];

    const siteSteps = {
      write_fail: { siteId: f.siteId1, cloudId: f.cloudId1, sitePolicyVersion: 1, projectId: '10001', projectPolicyVersion: 1 },
    };

    const { plan } = await createApprovedPlan(f, steps, siteSteps);
    await executionService.approveAndStart(plan.id, f.userId);

    let status = executionService.getExecutionStatus(plan.id);
    for (let i = 0; i < 50 && (!status || status.status === 'executing'); i++) {
      await new Promise((r) => setTimeout(r, 50));
      status = executionService.getExecutionStatus(plan.id);
    }

    expect(status?.status).toBe('partial');

    const snapshot = await executionService.getLatestExecutionSnapshot(plan.conv_id, f.userId);
    expect(snapshot.recoveryActions).toEqual(['skip', 'stop']);
    expect(snapshot.recoveryActions).not.toContain('retry');

    const executedSteps = await stepRepo.listSteps(plan.id);
    expect(executedSteps[0]!.status).toBe('unknown');

    // Attempting retry on an unknown write MUST throw conflict
    await expect(
      executionService.retryStep(plan.id, 'write_fail', f.userId)
    ).rejects.toThrow(/Cannot retry a step unless its failure is known/);

    // Only skip is permitted
    await expect(
      executionService.skipStep(plan.id, 'write_fail', f.userId)
    ).resolves.toBeDefined();
  });

  it('rejects legacy jira adapter fallback in personal/bound context', async () => {
    const f = await setupFixture();
    const { adapterFactory } = createTestExecutionService(f);

    // Requesting legacy 'jira' in personal mode must be rejected
    await expect(
      adapterFactory.getAdapterForService('jira', {
        userId: f.userId,
        workspaceId: f.workspaceId,
        workspaceMode: 'personal',
        phase: 'execution',
      })
    ).rejects.toThrow(/không khả dụng ở không gian cá nhân/);

    // Requesting legacy 'jira' when personal Jira is bound in connections must be rejected
    await expect(
      adapterFactory.getAdapterForService('jira', {
        userId: f.userId,
        workspaceId: f.workspaceId,
        phase: 'execution',
        connections: {
          myjira: {
            atiUserId: f.userId,
            jiraAccountId: randomUUID(),
            atlassianAccountId: 'atlassian-user-123',
            workspaceId: f.workspaceId,
            membershipVersion: 1,
            grantId: f.grantId,
            identityVersion: 1,
            workspaceVersion: 1,
            siteSteps: {},
          },
        },
      })
    ).rejects.toThrow(/không khả dụng ở không gian cá nhân/);
  });
});
