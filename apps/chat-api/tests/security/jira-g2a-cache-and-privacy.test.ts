import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import {
  createIsolatedTestSchema,
  createSyntheticUser,
  connectSyntheticJiraAccount,
  type IsolatedTestContext,
} from '../helpers/jira-test-db.js';
import { JiraNativeVerifier } from '../../src/services/jira/jira-native-verifier.js';
import { JiraHistorySanitizer } from '../../src/services/jira/jira-history-sanitizer.js';
import { JiraGuardedProvider } from '../../src/services/jira/jira-provider-guard.js';
import { ChatService } from '../../src/services/chat-service.js';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import { MessageRepo } from '../../src/db/repositories/message-repo.js';
import { PlanRepo } from '../../src/db/repositories/plan-repo.js';
import { WorkspaceRepo } from '../../src/db/repositories/workspace-repo.js';
import { JiraPlanBinder } from '../../src/services/jira/jira-plan-binding.js';
import { sandboxKeepsSharedJira } from '../../src/config/gmail-tools-runtime.js';
import { MYJIRA_G2A_TOOLS } from '@wap/tool-schemas';

describe('JIRA-G2A 10-Field Cache Isolation & D09-LLM-OFF Privacy Controls (P1/P2/P3)', () => {
  let ctx: IsolatedTestContext;
  let pool: pg.Pool;
  let userId: string;
  let workspaceId: string;
  let siteId: string;
  let cloudId: string;
  let grantId: string;
  let accountId: string;
  let atlassianAccountId: string;

  beforeAll(async () => {
    ctx = await createIsolatedTestSchema({ maxConnections: 8 });
    await ctx.runAllMigrations();
    pool = ctx.pool;

    userId = await createSyntheticUser(pool, 'G2A Privacy User', 'g2a_priv');
    atlassianAccountId = `atl-priv-${randomUUID().slice(0, 8)}`;
    accountId = await connectSyntheticJiraAccount(pool, userId, atlassianAccountId);

    const grantRes = await pool.query<{ id: string }>(
      `INSERT INTO jira_oauth_grants (
        account_id, app_client_id, grant_kind, refresh_state, status, token_version
      ) VALUES ($1, 'client-alpha', '3lo', 'idle', 'active', 1) RETURNING id`,
      [accountId]
    );
    grantId = grantRes.rows[0]!.id;
    cloudId = randomUUID();

    await pool.query(
      `INSERT INTO jira_grant_sites (
        grant_id, cloud_id, site_name, site_url, product_type, scopes, last_verified_at
      ) VALUES ($1, $2, 'Privacy Site', 'https://privacy.atlassian.net', 'jira', $3, clock_timestamp())`,
      [grantId, cloudId, ['read:jira-work']]
    );

    workspaceId = randomUUID();
    await pool.query(
      `INSERT INTO workspaces (id, name, invite_code, require_approval, created_by)
       VALUES ($1, 'Privacy WS', $2, true, $3)`,
      [workspaceId, `PV-${randomUUID().slice(0, 6)}`.toUpperCase(), userId]
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
      ) VALUES ($1, $2, 'Privacy Site', 'https://privacy.atlassian.net', true, 1, $3, $3, clock_timestamp())
      RETURNING id`,
      [workspaceId, cloudId, userId]
    );
    siteId = siteRes.rows[0]!.id;

    await pool.query(
      `INSERT INTO ati_workspace_jira_projects (
        workspace_id, site_id, cloud_id, numeric_project_id, project_key, project_name, selected, policy_version
      ) VALUES ($1, $2, $3, '20000', 'PRIV', 'Privacy Project', true, 1)`,
      [workspaceId, siteId, cloudId]
    );
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it.each(['four_service', 'five_service', 'nine_service'])('P0-01: live mode cannot enable sandbox Jira exception with %s', (scenario) => {
    vi.stubEnv('RUNTIME_MODE', 'live');
    vi.stubEnv('SANDBOX_SCENARIO', scenario);
    try { expect(sandboxKeepsSharedJira()).toBe(false); }
    finally { vi.unstubAllEnvs(); }
  });

  it.each(['Kiểm tra danh sách ticket đang mở trong ATI', 'Kiểm tra ticket PRIV-1', 'jira PRIV-1'])('P0-01: LLM-off blocks ordinary org prompt before planner or Jira reads: %s', async (content) => {
    const convRepo = new ConversationRepo(pool);
    const conv = await convRepo.createConversation(userId, 'Ordinary org turn', {
      workspaceMode: 'organization', workspaceId, jiraContext: false,
    });
    const processMessage = vi.fn(async () => ({ kind: 'answer' as const, text: 'unexpected model call', lookups: [], usedDirectory: [] }));
    const events: Array<{ event: string; payload: any }> = [];
    const service = new ChatService({ convRepo, msgRepo: new MessageRepo(pool), planRepo: new PlanRepo(pool),
      workspaceRepo: new WorkspaceRepo(pool), jiraBinder: new JiraPlanBinder({ pool }), jiraLlmEgressEnabled: false,
      planner: { processMessage, routeSchedule: () => ({ services: [] } as any) },
      eventEmitter: { emit: (event, payload) => events.push({ event, payload }) },
    });
    vi.stubEnv('RUNTIME_MODE', 'live');
    vi.stubEnv('SANDBOX_SCENARIO', 'four_service');
    try {
      await service.handleUserMessage({ conversationId: conv.id, userId, content });
      await expect.poll(() => events.some(e => e.event === 'agent_state' && e.payload?.state === 'idle')).toBe(true);
      expect(processMessage).not.toHaveBeenCalled();
      expect(events.find(e => e.event === 'refusal')?.payload.reason).toContain('JIRA_LLM_EGRESS_DISABLED_IN_G2A');
    } finally { vi.unstubAllEnvs(); }
  });

  it('P0-01: provider strips Jira even with valid workspace authority when LLM egress is explicitly off', async () => {
    const generatePlan = vi.fn(async (_input: any) => '{}');
    const guarded = new JiraGuardedProvider({ name: 'capture', generatePlan } as any, {
      pool, actor: { userId, workspaceId, workspaceMode: 'organization' },
      jiraPolicyService: { revalidateSource: async () => ({ allowed: true }) },
      jiraLlmEgressEnabled: false,
    } as any);
    await guarded.generatePlan({ userMessage: 'Hello', toolCatalog: MYJIRA_G2A_TOOLS,
      workingMemory: { jira_private: 'CONFIDENTIAL_G2A', unrelated: 'keep' },
      conversationHistory: [{ role: 'user', content: 'Hello' }],
    } as any);
    const sent: any = generatePlan.mock.calls[0]![0];
    expect(sent.toolCatalog).toEqual([]);
    expect(JSON.stringify(sent)).not.toContain('CONFIDENTIAL_G2A');
    expect(sent.workingMemory.unrelated).toBe('keep');
  });

  it('LOCK-06: JiraNativeVerifier enforces 10-field cache identity and evicts immediately on re-consent / disconnect', async () => {
    let fetchCount = 0;
    const mockFetch = async () => {
      fetchCount++;
      return new Response(
        JSON.stringify({
          permissions: {
            BROWSE_PROJECTS: { havePermission: true },
            CREATE_ISSUES: { havePermission: false },
            ADD_COMMENTS: { havePermission: false },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    };

    const verifierA = new JiraNativeVerifier({
      tokenManager: { getAccessToken: async () => 'tok-1' } as any,
      mode: 'fixture',
      fixtureBaseUrl: 'http://127.0.0.1:4999',
      fetchFn: mockFetch as any,
      oauthClientId: 'client-alpha',
      pool,
    } as any);

    const baseEvidence = {
      actorId: userId,
      workspaceId,
      localAccountId: accountId,
      atlassianAccountId,
      grantId,
      identityVersion: 1,
      cloudId,
      projectId: '20000',
    };

    await verifierA.verifyUserPermissions(baseEvidence);
    expect(fetchCount).toBe(1);

    // Exact same 10-field identity hits cache
    await verifierA.verifyUserPermissions(baseEvidence);
    expect(fetchCount).toBe(1);

    // Changing ANY identity dimension (grantId, identityVersion, atlassianAccountId, localAccountId, workspaceId, projectId) MUST miss cache!
    await verifierA.verifyUserPermissions({ ...baseEvidence, grantId: randomUUID() });
    expect(fetchCount).toBe(2);

    await verifierA.verifyUserPermissions({ ...baseEvidence, identityVersion: 2 });
    expect(fetchCount).toBe(3);

    await verifierA.verifyUserPermissions({ ...baseEvidence, atlassianAccountId: 'atl-other' });
    expect(fetchCount).toBe(4);

    await verifierA.verifyUserPermissions({ ...baseEvidence, localAccountId: randomUUID() });
    expect(fetchCount).toBe(5);

    await verifierA.verifyUserPermissions({ ...baseEvidence, workspaceId: randomUUID() });
    expect(fetchCount).toBe(6);

    await verifierA.verifyUserPermissions({ ...baseEvidence, projectId: '99999' });
    expect(fetchCount).toBe(7);

    // Changing oauthClientId produces a distinct oauthClientHash
    const verifierB = new JiraNativeVerifier({
      tokenManager: { getAccessToken: async () => 'tok-1' } as any,
      mode: 'fixture',
      fixtureBaseUrl: 'http://127.0.0.1:4999',
      fetchFn: mockFetch as any,
      oauthClientId: 'client-beta',
      pool,
    } as any);
    await verifierB.verifyUserPermissions(baseEvidence);
    expect(fetchCount).toBe(8);

    // Explicit user eviction invalidates cached entry immediately
    (verifierA as any).evictForUser(userId);
    await verifierA.verifyUserPermissions(baseEvidence);
    expect(fetchCount).toBe(9);
  });

  it('LOCK-03 (Gap P1): JiraHistorySanitizer purges Jira entities from system working_memory messages when source authority is revoked', async () => {
    const sanitizer = new JiraHistorySanitizer({
      revalidateSource: async () => ({ allowed: false, reason: 'identity_changed' as const }),
    });

    const sysMemoryMsg: any = {
      id: randomUUID(),
      conversation_id: randomUUID(),
      role: 'system',
      content: '',
      created_at: new Date(),
      metadata: {
        type: 'working_memory',
        state: {
          gmail_account: { value: { email: 'keep@example.test' }, updatedAt: 1 },
          jira_issue: { value: { key: 'PRIV-99', summary: 'TOP SECRET JIRA ISSUE' }, updatedAt: 2 },
          __observed: {
            value: {
              jira_issue: [{ key: 'PRIV-99', title: 'TOP SECRET JIRA ISSUE' }],
              jira_project: [{ key: 'PRIV', name: 'Secret Project' }],
              trello_card: [{ id: 'c1', name: 'Keep Trello' }],
            },
            updatedAt: 3,
          },
        },
      },
    };

    const sanitized = await sanitizer.sanitizeMessage(userId, sysMemoryMsg, workspaceId);
    const serialized = JSON.stringify(sanitized);
    expect(serialized).not.toContain('TOP SECRET JIRA ISSUE');
    expect(serialized).not.toContain('PRIV-99');
    expect(serialized).toContain('keep@example.test');
    expect(serialized).toContain('Keep Trello');
  });

  it('LOCK-03 (Gap P2): JiraGuardedProvider fails closed and strips all Jira workingMemory & history when jiraPolicyService is absent', async () => {
    let capturedPromptInput: any = null;
    const baseProvider = {
      name: 'spy-llm',
      lastCallMetrics: undefined,
      generatePlan: async (input: any) => {
        capturedPromptInput = input;
        return JSON.stringify({ kind: 'answer', text: 'ok' });
      },
    };

    // Intentionally omit BOTH jiraPolicyService and pool (or actor) — previously returned input UNTOUCHED!
    const guarded = new JiraGuardedProvider(baseProvider as any, {
      actor: { userId, workspaceId, workspaceMode: 'organization' },
    });

    await guarded.generatePlan({
      userMessage: 'Hello',
      toolCatalog: [],
      workingMemory: {
        jira_issue: { key: 'PRIV-1', title: 'CONFIDENTIAL_JIRA_SUMMARY' },
        __observed: {
          jira_issue: [{ key: 'PRIV-1', title: 'CONFIDENTIAL_JIRA_SUMMARY' }],
        },
      },
      conversationHistory: [
        {
          role: 'assistant',
          content: 'Issue PRIV-1 CONFIDENTIAL_JIRA_SUMMARY details',
          sourceRefs: [
            {
              provider: 'jira',
              workspaceId,
              siteId,
              cloudId,
              projectKey: 'PRIV',
              projectId: '20000',
              resourceType: 'issue',
              resourceId: '10001',
              issueKey: 'PRIV-1',
              binding: {
                userId,
                jiraAccountId: accountId,
                atlassianAccountId,
                grantId,
                identityVersion: 1,
                workspaceId,
                workspaceVersion: 1,
                membershipRole: 'admin',
                membershipVersion: 1,
                siteId,
                cloudId,
                sitePolicyVersion: 1,
                projectKey: 'PRIV',
                projectId: '20000',
                projectPolicyVersion: 1,
              },
            },
          ],
        } as any,
      ],
    } as any);

    expect(JSON.stringify(capturedPromptInput)).not.toContain('CONFIDENTIAL_JIRA_SUMMARY');
  });

  it('LOCK-03 (D09-LLM-OFF & Gap P3): ChatService blocks external LLM calls on Jira turns when JIRA_LLM_EGRESS_ENABLED is off and blocks cross-service Jira write plans', async () => {
    const convRepo = new ConversationRepo(pool);
    const msgRepo = new MessageRepo(pool);
    const planRepo = new PlanRepo(pool);
    const workspaceRepo = new WorkspaceRepo(pool);

    const jiraConv = await convRepo.createConversation(userId, 'Jira D09-LLM-OFF Turn', {
      workspaceMode: 'organization',
      workspaceId,
      jiraContext: true,
    });

    let plannerInvocations = 0;
    const events: Array<{ event: string; payload: any }> = [];

    const chatServiceOff = new ChatService({
      convRepo,
      msgRepo,
      planRepo,
      workspaceRepo,
      jiraBinder: new JiraPlanBinder({ pool }),
      planner: {
        processMessage: async () => {
          plannerInvocations++;
          return {
            kind: 'answer' as const,
            text: 'Should never call LLM when D09-LLM-OFF is active',
            lookups: [],
            usedDirectory: [],
          };
        },
        routeSchedule: () => ({ services: [] } as any),
      },
      eventEmitter: {
        emit: (event, payload) => events.push({ event, payload }),
      },
    });

    await chatServiceOff.handleUserMessage({
      conversationId: jiraConv.id,
      userId,
      content: 'Tóm tắt các issue trong project PRIV',
    });

    // Wait briefly for async pipeline to settle
    for (let i = 0; i < 40 && !events.some((e) => e.event === 'agent_state' && e.payload?.state === 'idle'); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }

    expect(plannerInvocations).toBe(0);
    expect(events.some((e) => e.event === 'refusal')).toBe(true);

    // Gap P3: Even when LLM egress is explicitly enabled in test config, cross-service Jira -> external write plan MUST be refused!
    const eventsCross: Array<{ event: string; payload: any }> = [];
    const chatServiceCross = new ChatService({
      convRepo,
      msgRepo,
      planRepo,
      workspaceRepo,
      jiraBinder: new JiraPlanBinder({ pool }),
      jiraLlmEgressEnabled: true,
      slackWrites: {} as any,
      planner: {
        processMessage: async () => ({
          kind: 'plan',
          thinking: 'Exfiltrate Jira issues to Slack',
          summary: 'Read Jira then post to Slack',
          warnings: [],
          steps: [
            {
              id: 's1',
              tool: 'myjira.search_issues',
              description: 'Read Jira issues',
              args: { siteId, projectKey: 'PRIV' },
              dependsOn: [],
            },
            {
              id: 's2',
              tool: 'trello.create_card',
              description: 'Create Trello card from Jira issues',
              args: { listId: 'list_1', name: 'Leaked Jira issues' },
              dependsOn: ['s1'],
            },
          ],
        }),
        routeSchedule: () => ({ services: [] } as any),
      },
      eventEmitter: {
        emit: (event: string, payload: any) => eventsCross.push({ event, payload }),
      },
    } as any);

    await chatServiceCross.handleUserMessage({
      conversationId: jiraConv.id,
      userId,
      content: 'Gửi danh sách issue PRIV sang Slack',
    });

    for (
      let i = 0;
      i < 40 && !eventsCross.some((e) => e.event === 'agent_state' && (e.payload?.state === 'idle' || e.payload?.state === 'waiting_for_approval'));
      i++
    ) {
      await new Promise((r) => setTimeout(r, 25));
    }

    expect(eventsCross.some((e) => e.event === 'plan')).toBe(false);
    expect(eventsCross.some((e) => e.event === 'refusal')).toBe(true);
  });
});
