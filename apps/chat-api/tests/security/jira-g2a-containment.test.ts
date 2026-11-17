import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { encryptCredentials } from '@wap/tool-adapters';
import {
  createIsolatedTestSchema,
  createSyntheticUser,
  connectSyntheticJiraAccount,
  type IsolatedTestContext,
} from '../helpers/jira-test-db.js';
import { getConfiguredToolCatalog, getToolCatalogFor } from '../../src/services/registered-services.js';
import { createServicesRoutes } from '../../src/routes/services-routes.js';
import { JiraOAuthClient } from '../../src/services/jira/jira-oauth-client.js';
import { JiraPlanBinder } from '../../src/services/jira/jira-plan-binding.js';
import { validateJiraApprovalBinding } from '../../src/services/jira/jira-approval-guard.js';
import { JiraLeaseManager } from '../../src/services/jira/jira-lease-manager.js';
import { JiraDispatchGuard } from '../../src/services/jira/jira-dispatch-guard.js';
import { AdapterFactory } from '../../src/services/adapter-factory.js';
import { ExecutionService } from '../../src/services/execution-service.js';
import { PlanRepo } from '../../src/db/repositories/plan-repo.js';
import { StepRepo } from '../../src/db/repositories/step-repo.js';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import { scanAndPauseLegacyJiraSchedules } from '../../src/services/jira-legacy-migration.js';
import { TelegramDigestRunner } from '../../src/services/schedules/telegram-digest-runner.js';
import { computeTelegramDigestConfigHash } from '../../src/services/schedules/telegram-digest-candidate.js';

describe('JIRA-G2A Six-Layer Server-Side Write & Legacy Containment', () => {
  let ctx: IsolatedTestContext;
  let pool: pg.Pool;
  let userId: string;
  let workspaceId: string;
  let siteId: string;
  let cloudId: string;
  let grantId: string;
  let accountId: string;
  let atlassianAccountId: string;

  const encryptionKey = '01234567890123456789012345678901';

  it('G2A-L6: missing tool identity is denied before token acquisition or database access', async () => {
    const getAccessToken = vi.fn(async () => { throw new Error('token manager must not be reached'); });
    const dispatch = vi.fn(async () => ({}));
    const guard = new JiraDispatchGuard(pool, {} as any, { getAccessToken });
    await expect(guard.executeGuardedDispatch({ userId, workspaceId, cloudId, siteId }, { isWrite: false } as any, dispatch))
      .rejects.toMatchObject({ code: 'JIRA_CAPABILITY_DISABLED_IN_G2A' });
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each([
    ['jira', 'jira.search_issues', true, {}, 'organization', 'ws-1', 'JIRA_CAPABILITY_DISABLED_IN_G2A'],
    ['github', 'myjira.search_issues', true, { siteId: 'site', projectKey: 'ATI' }, 'organization', 'ws-1', 'JIRA_SOURCE_MISMATCH'],
    ['myjira', 'myjira.search_issues', false, { siteId: 'site', projectKey: 'ATI' }, 'personal', null, 'JIRA_WORKSPACE_REQUIRED'],
    ['myjira', 'myjira.search_issues', true, { siteId: 'site', projectKey: 'ATI' }, 'personal', null, 'JIRA_WORKSPACE_REQUIRED'],
    ['myjira', 'myjira.search_issues', false, { query: '' }, 'organization', 'ws-1', 'JIRA_SCOPE_REQUIRED'],
  ])('P1-01: blocks unsafe/legacy Jira digest source %s / %s (mixed=%s, mode=%s) before reads or delivery', async (service, tool, mixed, args, workspaceMode, wsId, expectedCode) => {
    const getPersonalCredentials = vi.fn(async () => ({ id: 'tg-g2a', status: 'active',
      config: encryptCredentials({ telegramUserId: '777888999', selectedChats: [{ chatId: '-100555666777' }] }, encryptionKey),
    }));
    const execute = vi.fn(async (name: string) => name === 'telegram.send_message'
      ? { messageId: 1, chatId: '-100555666777', date: 1793581230 }
      : [{ key: 'ATI-1', title: 'PRIVATE_JIRA' }]);
    const getAdapterForService = vi.fn(async () => ({ execute }));
    const summarizeWithAi = vi.fn(async () => 'summary');
    const config: any = { credentialId: 'tg-g2a', telegramUserId: '777888999', chatId: '-100555666777', chatTitle: 'Test group',
      recurrence: { type: 'daily', hour: 9, minute: 0 },
      sources: [...(mixed ? [{ service: 'github', tool: 'github.search_issues', args: { repo: 'test/repo' }, label: 'GitHub' }] : []),
        { service, tool, args, label: 'Jira' }],
    };
    const runner = new TelegramDigestRunner({ credentialRepo: { getPersonalCredentials } as any, encryptionKey,
      adapterFactory: { getAdapterForService }, summarizeWithAi, botClient: { getChatMember: async () => true }, timeZone: 'Asia/Bangkok' });
    const result = await runner.execute({ runId: randomUUID(), scheduleId: randomUUID(), scheduleVersion: 1,
      userId: 'synthetic', name: 'Guard digest', request: 'Digest', dueAt: new Date(), trigger: 'scheduled',
      workspaceMode: workspaceMode as any, workspaceId: wsId,
      digestConfig: config, digestConfigHash: computeTelegramDigestConfigHash(config) }, new AbortController().signal);
    expect(result).toMatchObject({ status: 'blocked', error: expect.stringContaining(expectedCode) });
    expect((result as any).pauseSchedule).not.toBe(true);
    expect(getPersonalCredentials).not.toHaveBeenCalled();
    expect(getAdapterForService).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(summarizeWithAi).not.toHaveBeenCalled();
  });

  beforeAll(async () => {
    ctx = await createIsolatedTestSchema({ maxConnections: 8 });
    await ctx.runAllMigrations();
    pool = ctx.pool;

    userId = await createSyntheticUser(pool, 'G2A Containment User', 'g2a_contain');
    atlassianAccountId = `atl-${randomUUID()}`;
    accountId = await connectSyntheticJiraAccount(pool, userId, atlassianAccountId);

    const grantRes = await pool.query<{ id: string }>(
      `INSERT INTO jira_oauth_grants (
        account_id, app_client_id, grant_kind, refresh_state, status, token_version
      ) VALUES ($1, 'atlassian_3lo', '3lo', 'idle', 'active', 1) RETURNING id`,
      [accountId]
    );
    grantId = grantRes.rows[0]!.id;
    cloudId = randomUUID();

    await pool.query(
      `INSERT INTO jira_grant_sites (
        grant_id, cloud_id, site_name, site_url, product_type, scopes, last_verified_at
      ) VALUES ($1, $2, 'G2A Site', 'https://g2a.atlassian.net', 'jira', $3, clock_timestamp())`,
      [grantId, cloudId, ['read:jira-work']]
    );

    workspaceId = randomUUID();
    await pool.query(
      `INSERT INTO workspaces (id, name, invite_code, require_approval, created_by)
       VALUES ($1, 'G2A WS', $2, true, $3)`,
      [workspaceId, `G2A-${randomUUID().slice(0, 6)}`.toUpperCase(), userId]
    );
    await pool.query(
      `INSERT INTO ati_workspaces (id, slug, status, version, created_by)
       VALUES ($1, $2, 'active', 1, $3)`,
      [workspaceId, `ws-${randomUUID().slice(0, 8)}`, userId]
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
      ) VALUES ($1, $2, 'G2A Site', 'https://g2a.atlassian.net', true, 1, $3, $3, clock_timestamp())
      RETURNING id`,
      [workspaceId, cloudId, userId]
    );
    siteId = siteRes.rows[0]!.id;

    await pool.query(
      `INSERT INTO ati_workspace_jira_projects (
        workspace_id, site_id, cloud_id, numeric_project_id, project_key, project_name, selected, policy_version
      ) VALUES ($1, $2, $3, '10000', 'ATI', 'ATI Project', true, 1)`,
      [workspaceId, siteId, cloudId]
    );
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('Layer 1: Runtime catalog exposes ONLY the 4 G2A read tools and completely retires shared legacy jira.* even when myjiraEnabled=false', async () => {
    const encryptedLegacyJira = encryptCredentials(
      {
        baseUrl: 'https://legacy.atlassian.net',
        email: 'legacy@example.test',
        apiToken: 'legacy-token',
      },
      encryptionKey
    );

    const mockCredentialRepo = {
      getCredentials: async (svc: string) =>
        svc === 'jira' ? { service: 'jira', config: encryptedLegacyJira, status: 'active' } : null,
      getPersonalCredentials: async () => null,
    } as any;

    const configured = await getConfiguredToolCatalog(mockCredentialRepo, encryptionKey, {
      workspaceMode: 'organization',
      workspaceId,
      userId,
      myjiraEnabled: false,
    });
    expect(configured.filter((t) => t.name.startsWith('jira.'))).toEqual([]);

    const callerCatalog = await getToolCatalogFor(mockCredentialRepo, encryptionKey, {
      userId,
      workspaceMode: 'organization',
      workspaceId,
      gmailEnabled: false,
      myjiraEnabled: true,
      myjiraConnection: async () => ({
        connected: true,
        connectionState: 'connected',
        sites: [{ cloudId, name: 'G2A Site', url: 'https://g2a.atlassian.net' }],
      }),
      jiraWorkspaceRepo: {
        getCapabilities: async () => ({
          sites: [{ siteId, cloudId, projects: [{ id: '10000', key: 'ATI', name: 'ATI Project' }] }],
        }),
      },
    });

    expect(callerCatalog.filter((t) => t.name.startsWith('jira.'))).toEqual([]);
    expect(callerCatalog.filter((t) => t.name.startsWith('myjira.')).map((t) => t.name)).toEqual([
      'myjira.list_sites',
      'myjira.search_projects',
      'myjira.search_issues',
      'myjira.create_issue',
      'myjira.add_comment',
      'myjira.get_issue',
      'myjira.search_users',
      'myjira.transition_issue',
      'myjira.update_issue',
    ]);
  });

  it('Layer 1b: Services routes return 410 JIRA_LEGACY_SHARED_DISABLED on /api/services/jira/* even when myjiraAvailable=false', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).user = { id: userId, role: 'admin', status: 'active' };
      next();
    });

    app.use(
      '/api/services',
      createServicesRoutes({
        myjiraAvailable: false,
        jiraOAuthRepo: {
          getConnectionStatus: async () => ({
            connected: true,
            connectionState: 'connected',
            sites: [{ cloudId, name: 'G2A Site', url: 'https://g2a.atlassian.net' }],
          }),
        },
        credentialRepo: {
          getCredentials: async () => null,
          getPersonalCredentials: async () => null,
        } as any,
        encryptionKey,
      })
    );

    const putRes = await request(app)
      .put('/api/services/jira/credentials')
      .send({ baseUrl: 'https://evil.atlassian.net', email: 'a@b.c', apiToken: 'tok' });
    expect(putRes.status).toBe(410);
    expect(putRes.body.code).toBe('JIRA_LEGACY_SHARED_DISABLED');

    const listRes = await request(app).get('/api/services');
    expect(listRes.status).toBe(200);
    const bodyServices = Array.isArray(listRes.body) ? listRes.body : listRes.body.services ?? [];
    expect(bodyServices.some((s: any) => s.id === 'jira' || s.service === 'jira')).toBe(false);
  });

  it('LOCK-02 (Write Scope): JiraOAuthClient requests read:me, read:jira-work, write:jira-work, offline_access', () => {
    const oauthClient = new JiraOAuthClient({
      clientId: 'client-g2a',
      clientSecret: 'secret-g2a',
      redirectUri: 'http://127.0.0.1:4187/callback',
      mode: 'fixture',
      fixtureBaseUrl: 'http://127.0.0.1:9999',
    });

    const sitesAuthUrl = new URL(oauthClient.authorizationUrl({ state: 'st-1', mode: 'authorize_sites' }));
    const scopes = (sitesAuthUrl.searchParams.get('scope') ?? '').split(/\s+/).filter(Boolean);
    expect(scopes).toContain('read:me');
    expect(scopes).toContain('read:jira-work');
    expect(scopes).toContain('write:jira-work');
    expect(scopes).toContain('offline_access');
  });

  it('Layer 2: JiraPlanBinder & validateJiraApprovalBinding require write:jira-work for myjira write tools and reject legacy jira.*', async () => {
    const binder = new JiraPlanBinder({
      pool,
      lookupIssue: async () => ({ projectKey: 'ATI', numericProjectId: '10000' }),
    });
    const conv = {
      id: randomUUID(),
      user_id: userId,
      workspace_id: workspaceId,
      workspace_mode: 'organization',
      jira_context: true,
    };

    for (const writeTool of [
      'myjira.create_issue',
      'myjira.add_comment',
      'myjira.update_issue',
      'myjira.transition_issue',
    ]) {
      await expect(
        binder.bindPlan(userId, conv, [
          {
            id: 's1',
            tool: writeTool,
            description: 'Write requires write:jira-work scope',
            args: { siteId, projectKey: 'ATI', issueKey: 'ATI-1', summary: 'x', body: 'x', targetStatus: 'Done', priority: 'High' },
            dependsOn: [],
          } as any,
        ])
      ).rejects.toMatchObject({
        code: 'JIRA_WRITE_SCOPE_REQUIRED',
      });
    }

    const validReadBinding = await binder.bindPlan(userId, conv, [
      {
        id: 's1',
        tool: 'myjira.search_issues',
        description: 'Read issues',
        args: { siteId, projectKey: 'ATI' },
        dependsOn: [],
      } as any,
    ]);

    const approvalCheck = await validateJiraApprovalBinding(pool, validReadBinding, {
      requiredPermissions: { createIssue: true, editIssue: true },
    });

    expect(approvalCheck).toMatchObject({
      valid: false,
      category: 'denied',
    });
    if (!approvalCheck.valid) {
      expect(approvalCheck.reason).toContain('JIRA_WRITE_SCOPE_REQUIRED');
    }
  });

  it('Layer 3 & 4: ExecutionService blocks persisted myjira.* and legacy jira.* write plans across approveAndStart, continueExecution, and retryStep while allowing stop()', async () => {
    const convRepo = new ConversationRepo(pool);
    const planRepo = new PlanRepo(pool);
    const stepRepo = new StepRepo(pool);

    const conv = await convRepo.createConversation(userId, 'Persisted Write Plan Conv', {
      workspaceMode: 'organization',
      workspaceId,
      jiraContext: true,
    });

    const adapterFactory = new AdapterFactory({
      credentialRepo: {
        getCredentials: async () => null,
        getPersonalCredentials: async () => null,
      } as any,
      encryptionKey,
    });

    const execService = new ExecutionService({
      planRepo,
      stepRepo,
      convRepo,
      workspaceRepo: { findMember: async () => ({ status: 'active', role: 'admin' }) } as any,
      adapterFactory,
      pool,
    });

    // 1. Persisted legacy jira.create_issue plan (simulating Slack-to-Jira or legacy plan)
    const legacyPlanJson = {
      summary: 'Legacy Jira write',
      steps: [
        {
          id: 'step_1',
          tool: 'jira.create_issue',
          description: 'Create legacy issue',
          args: { projectKey: 'ATI', summary: 'Bypass attempt' },
          dependsOn: [],
        },
      ],
    };
    const legacyPlanText = JSON.stringify(legacyPlanJson);
    const legacyPlan = await planRepo.createPlan({
      convId: conv.id,
      planJson: legacyPlanJson,
      planText: legacyPlanText,
      planHash: createHash('sha256').update(legacyPlanText).digest('hex'),
      expiresAt: new Date(Date.now() + 3600_000),
    });

    const approveRes = await execService.approveAndStart(legacyPlan.id, userId);
    expect(approveRes).toMatchObject({ success: false, status: 403 });
    expect(approveRes.error).toMatch(/JIRA_LEGACY_SHARED_DISABLED|JIRA_CAPABILITY_DISABLED_IN_G2A/);

    // 2. Persisted myjira.create_issue plan without write:jira-work blocks retryStep & continueExecution while allowing stop()
    const myjiraPlanJson = {
      summary: 'Persisted myjira write',
      steps: [
        {
          id: 'step_w1',
          tool: 'myjira.create_issue',
          description: 'Create issue',
          args: { siteId, projectKey: 'ATI', summary: 'Old persisted write' },
          dependsOn: [],
          requiresConfirmation: true,
        },
      ],
      connections: {
        myjira: {
          atiUserId: userId,
          jiraAccountId: accountId,
          atlassianAccountId,
          workspaceId,
          membershipVersion: 1,
          grantId,
          identityVersion: 1,
          workspaceVersion: 1,
          siteSteps: {
            step_w1: { siteId, cloudId, sitePolicyVersion: 1, projectId: '10000', projectPolicyVersion: 1 },
          },
        },
      },
    };
    const myjiraPlanText = JSON.stringify(myjiraPlanJson);
    const myjiraWritePlan = await planRepo.createPlan({
      convId: conv.id,
      planJson: myjiraPlanJson,
      planText: myjiraPlanText,
      planHash: createHash('sha256').update(myjiraPlanText).digest('hex'),
      expiresAt: new Date(Date.now() + 3600_000),
    });

    const stepRow = await stepRepo.createStep({
      planId: myjiraWritePlan.id,
      stepId: 'step_w1',
      tool: 'myjira.create_issue',
      argsJson: { siteId, projectKey: 'ATI', summary: 'Old persisted write' },
      requestedBy: userId,
    });
    await pool.query(`UPDATE plans SET status = 'partial', decided_at = now() WHERE id = $1`, [myjiraWritePlan.id]);
    await stepRepo.updateStepStatus(stepRow.id, 'failed', null, { message: 'Previous error' });

    await expect(execService.retryStep(myjiraWritePlan.id, 'step_w1', userId)).rejects.toThrow(
      /JIRA_WRITE_SCOPE_REQUIRED/
    );

    // stop() on partial plan MUST still succeed so users can cancel partial plans
    const stopRes = await execService.stop(myjiraWritePlan.id, userId);
    expect(stopRes).toMatchObject({ status: 'stopped' });
  });

  it('Layer 4 & 5: AdapterFactory denies shared jira in all modes, removes !jiraDispatchGuard fail-open, and JiraDispatchGuard rejects writes', async () => {
    const encryptedLegacy = encryptCredentials(
      {
        baseUrl: 'https://legacy.atlassian.net',
        email: 'legacy@example.test',
        apiToken: 'legacy-token',
      },
      encryptionKey
    );

    // 1. AdapterFactory without jiraDispatchGuard MUST fail closed on myjira AND reject 'jira' in all modes
    const unguardedFactory = new AdapterFactory({
      credentialRepo: {
        getCredentials: async () => ({ service: 'jira', config: encryptedLegacy, status: 'active' }),
        getPersonalCredentials: async () => null,
      } as any,
      encryptionKey,
      jiraTokens: { getAccessToken: async () => 'tok' } as any,
      jiraWorkspaceRepo: {
        getCapabilities: async () => ({
          workspaceId,
          sites: [
            {
              siteId,
              cloudId,
              name: 'G2A Site',
              url: 'https://g2a.atlassian.net',
              projects: [{ id: '10000', key: 'ATI', name: 'ATI Project' }],
            },
          ],
        }),
      },
    });

    for (const mode of ['legacy', 'personal', 'organization'] as const) {
      await expect(
        unguardedFactory.getAdapterForService('jira', { userId, workspaceId, workspaceMode: mode, phase: 'execution' })
      ).rejects.toThrow(/JIRA_LEGACY_SHARED_DISABLED/);
    }

    await expect(
      unguardedFactory
        .getAdapterForService('myjira', {
          userId,
          workspaceId,
          workspaceMode: 'organization',
          connections: {
            myjira: {
              atiUserId: userId,
              jiraAccountId: accountId,
              atlassianAccountId,
              workspaceId,
              membershipVersion: 1,
              grantId,
              identityVersion: 1,
              workspaceVersion: 1,
              siteSteps: {
                s1: {
                  siteId,
                  cloudId,
                  sitePolicyVersion: 1,
                },
              },
            },
          },
        } as any)
        .then((a) => a.execute('myjira.list_sites', {}, { stepId: 's1' } as any))
    ).rejects.toThrow(/JIRA_DISPATCH_GUARD_REQUIRED|Missing Jira dispatch guard/i);

    // 2. JiraDispatchGuard rejects write tool even with active DB authority
    const tokenManager = { getAccessToken: async () => 'tok' };
    const leaseManager = new JiraLeaseManager({ pool, tokenManager });
    const dispatchGuard = new JiraDispatchGuard(pool, leaseManager, tokenManager);

    await expect(
      dispatchGuard.executeGuardedDispatch(
        {
          userId,
          workspaceId,
          cloudId,
          siteId,
          projectId: '10000',
        },
        {
          isWrite: true,
          tool: 'myjira.create_issue',
        },
        async () => ({ leaked: true })
      )
    ).rejects.toMatchObject({
      code: 'JIRA_WRITE_SCOPE_REQUIRED',
    });
  });

  it('LOCK-04: scanAndPauseLegacyJiraSchedules({ dryRun: true }) reports only legacy jira schedules and leaves myjira schedules active', async () => {
    const convRepo = new ConversationRepo(pool);
    const schedConv1 = await convRepo.createConversation(userId);
    const schedConv2 = await convRepo.createConversation(userId);
    const legacySchedId = randomUUID();
    const myjiraSchedId = randomUUID();
    await pool.query(
      `INSERT INTO schedules (id, user_id, conv_id, name, request, recurrence, services, status, version, next_run_at)
       VALUES ($1, $2, $3, 'Legacy Jira Digest', 'Tóm tắt jira.search_issues mỗi sáng', '{"kind":"daily","hour":9,"minute":0}'::jsonb, ARRAY['jira','slack'], 'active', 1, now() + interval '1 day'),
              ($4, $2, $5, 'Modern MyJira Digest', 'Tóm tắt myjira.search_issues mỗi sáng', '{"kind":"daily","hour":9,"minute":0}'::jsonb, ARRAY['myjira','slack'], 'active', 1, now() + interval '1 day')`,
      [legacySchedId, userId, schedConv1.id, myjiraSchedId, schedConv2.id]
    );

    const inv = await scanAndPauseLegacyJiraSchedules(pool, { dryRun: true });
    expect(inv.dryRun).toBe(true);
    expect(inv.pausedSchedules.some((s) => s.id === legacySchedId)).toBe(true);
    expect(inv.pausedSchedules.some((s) => s.id === myjiraSchedId)).toBe(false);

    const checkRow = await pool.query<{ status: string }>(
      `SELECT status FROM schedules WHERE id = $1`,
      [legacySchedId]
    );
    expect(checkRow.rows[0]?.status).toBe('active');
  });
});
