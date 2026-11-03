import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { JiraPlanConnection, JiraSourceRef } from '@wap/tool-schemas';

process.env.JWT_SECRET = '01234567890123456789012345678901_jwt_secret';
process.env.ENCRYPTION_KEY = 'a'.repeat(32);

import {
  createIsolatedTestSchema,
  createSyntheticUser,
  connectSyntheticJiraAccount,
  type IsolatedTestContext,
} from '../helpers/jira-test-db.js';
import { JiraPolicyService } from '../../src/services/jira/jira-policy-service.js';
import { JiraHistorySanitizer } from '../../src/services/jira/jira-history-sanitizer.js';
import { ChatService } from '../../src/services/chat-service.js';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import { MessageRepo } from '../../src/db/repositories/message-repo.js';
import { PlanRepo } from '../../src/db/repositories/plan-repo.js';
import { UserRepo } from '../../src/db/repositories/user-repo.js';
import { SessionRepo } from '../../src/db/repositories/session-repo.js';
import { WorkspaceRepo } from '../../src/db/repositories/workspace-repo.js';
import { JiraStreamBuffer, JiraStreamBufferRevokedError } from '../../src/sse/jira-stream-guard.js';
import { AdapterFactory } from '../../src/services/adapter-factory.js';
import { JiraLeaseManager } from '../../src/services/jira/jira-lease-manager.js';
import { JiraDispatchGuard } from '../../src/services/jira/jira-dispatch-guard.js';
import { createApp } from '../../src/app.js';
import { generateAccessToken } from '../../src/auth/jwt.js';

interface Fixture {
  userId: string;
  workspaceId: string;
  accountId: string;
  atlassianAccountId: string;
  grantId: string;
  cloudId: string;
  siteId: string;
  projectId: string;
  conversationId: string;
  sourceRef: JiraSourceRef;
  boundConnection: JiraPlanConnection;
}

describe('JIRA-08 Task 5 Source Guard, Persistence, and Publication Guards', () => {
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

  async function setupFixture(): Promise<Fixture> {
    const userId = await createSyntheticUser(pool, 'Guard User', 'guard_user');
    const atlassianAccountId = `atlas-${randomUUID()}`;
    const accountId = await connectSyntheticJiraAccount(pool, userId, atlassianAccountId);

    const grantRes = await pool.query<{ id: string }>(
      `INSERT INTO jira_oauth_grants (
        account_id, app_client_id, grant_kind, refresh_state, status, token_version
      ) VALUES ($1, 'atlassian_3lo', '3lo', 'idle', 'active', 1)
      RETURNING id`,
      [accountId]
    );
    const grantId = grantRes.rows[0]!.id;

    const cloudId = randomUUID();
    await pool.query(
      `INSERT INTO jira_grant_sites (
        grant_id, cloud_id, site_name, site_url, product_type, scopes, last_verified_at
      ) VALUES ($1, $2, 'Guard Site', 'https://guard.atlassian.net', 'jira', $3, clock_timestamp())`,
      [grantId, cloudId, ['read:jira-work', 'write:jira-work']]
    );

    const workspaceId = randomUUID();
    const inviteCode = `ATI-${randomUUID().slice(0, 4)}-${randomUUID().slice(0, 4)}`.toUpperCase();
    const slug = `ws-${randomUUID().slice(0, 8)}`;

    await pool.query(
      `INSERT INTO workspaces (id, name, invite_code, require_approval, created_by)
       VALUES ($1, $2, $3, true, $4)`,
      [workspaceId, 'Guard Workspace', inviteCode, userId]
    );
    await pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, status)
       VALUES ($1, $2, 'admin', 'active')`,
      [workspaceId, userId]
    );
    await pool.query(
      `INSERT INTO ati_workspaces (id, slug, status, version, created_by)
       VALUES ($1, $2, 'active', 1, $3)`,
      [workspaceId, slug, userId]
    );
    await pool.query(
      `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version)
       VALUES ($1, $2, 'admin', 'active', 1)`,
      [workspaceId, userId]
    );

    const siteRes = await pool.query<{ id: string }>(
      `INSERT INTO ati_workspace_jira_sites (
        workspace_id, cloud_id, site_name, site_url, active, policy_version, linked_by
      ) VALUES ($1, $2, 'Guard Site', 'https://guard.atlassian.net', true, 1, $3)
      RETURNING id`,
      [workspaceId, cloudId, userId]
    );
    const siteId = siteRes.rows[0]!.id;

    await pool.query(
      `INSERT INTO ati_workspace_jira_projects (
        workspace_id, site_id, cloud_id, numeric_project_id, project_key, project_name, selected, policy_version
      ) VALUES ($1, $2, $3, '10001', 'GRD', 'Guard Project', true, 1)`,
      [workspaceId, siteId, cloudId]
    );

    const convRes = await pool.query<{ id: string }>(
      `INSERT INTO conversations (title, user_id, workspace_id, workspace_mode, jira_context)
       VALUES ('Guard Conversation', $1, $2, 'organization', true)
       RETURNING id`,
      [userId, workspaceId]
    );
    const conversationId = convRes.rows[0]!.id;

    const sourceRef: JiraSourceRef = {
      binding: {
        atiUserId: userId,
        jiraAccountId: accountId,
        atlassianAccountId,
        workspaceId,
        membershipVersion: 1,
        grantId,
        identityVersion: 1,
      },
      workspaceId,
      workspaceVersion: 1,
      siteId,
      cloudId,
      sitePolicyVersion: 1,
      projectId: '10001',
      projectPolicyVersion: 1,
      resourceType: 'issue',
      providerResourceId: '10001',
      revision: '1',
    };

    const boundConnection: JiraPlanConnection = {
      ...sourceRef.binding,
      workspaceVersion: 1,
      siteSteps: {
        step_1: {
          siteId,
          cloudId,
          sitePolicyVersion: 1,
          projectId: '10001',
          projectPolicyVersion: 1,
        },
      },
    };

    return {
      userId,
      workspaceId,
      accountId,
      atlassianAccountId,
      grantId,
      cloudId,
      siteId,
      projectId: '10001',
      conversationId,
      sourceRef,
      boundConnection,
    };
  }

  function createChatEventEmitter() {
    const emittedEvents: Array<{ event: string; payload: any }> = [];
    let resolveTurn: (() => void) | null = null;
    return {
      emittedEvents,
      emitter: {
        emit: (event: string, payload: any) => {
          emittedEvents.push({ event, payload });
          if (
            (event === 'agent_state' &&
              (payload.state === 'idle' || payload.state === 'waiting_for_approval')) ||
            event === 'error'
          ) {
            resolveTurn?.();
          }
        },
      },
      waitForTurn: () =>
        new Promise<void>((resolve) => {
          resolveTurn = resolve;
          setTimeout(resolve, 3000);
        }),
    };
  }

  // =========================================================================
  // 1. Revoked Gather Source in History
  // =========================================================================
  it('masks revoked gather source in history before sending to planner model prompt', async () => {
    const f = await setupFixture();
    const verifier = {
      verifyUserPermissions: async () => ({
        canBrowse: true, canCreateIssue: true, canAddComment: true, status: 'granted' as const,
      }),
    };
    const policyService = new JiraPolicyService({ pool, verifier });
    const sanitizer = new JiraHistorySanitizer(policyService);

    const convRepo = new ConversationRepo(pool);
    const msgRepo = new MessageRepo(pool);
    const planRepo = new PlanRepo(pool);

    // Seed a message representing previous gather with sourceRefs
    const secretContent = 'SECRET_JIRA_GATHER_DATA: issue summary is Top Secret Vulnerability';
    await msgRepo.createMessage(f.conversationId, 'assistant', secretContent, {
      sourceRefs: [f.sourceRef],
      gather: true,
    });

    // Revoke the Jira project permission in database
    await pool.query(
      `UPDATE ati_workspace_jira_projects SET selected = false WHERE site_id = $1`,
      [f.siteId]
    );

    let receivedHistory: any[] = [];
    const mockPlanner = {
      processMessage: vi.fn(async (input: any) => {
        receivedHistory = input.history;
        return { kind: 'answer' as const, text: 'Model answer based on history', lookups: [], usedDirectory: [] };
      }),
    };

    const chatEvents = createChatEventEmitter();
    const chatService = new ChatService({
      msgRepo,
      convRepo,
      planRepo,
      planner: mockPlanner as any,
      eventEmitter: chatEvents.emitter,
      jiraHistorySanitizer: sanitizer,
      jiraPolicyService: policyService,
    });

    // Post a new user message to trigger pipeline
    await chatService.handleUserMessage({
      conversationId: f.conversationId,
      userId: f.userId,
      content: 'Can you summarize previous gather?',
    });
    await chatEvents.waitForTurn();

    expect(mockPlanner.processMessage).toHaveBeenCalled();
    expect(receivedHistory.length).toBeGreaterThan(0);

    const serializedHistory = JSON.stringify(receivedHistory);
    // MUST NOT leak the raw secret content to the planner model prompt
    expect(serializedHistory).not.toContain(secretContent);
    // MUST contain the fail-closed mask message
    expect(serializedHistory).toContain('Nội dung Jira đã bị ẩn do quyền truy cập bị thay đổi hoặc thu hồi: project_denied');
  });

  // =========================================================================
  // 2. Late Model Response Revocation
  // =========================================================================
  it('masks late model response before persistence and announcement when access is revoked during processing', async () => {
    const f = await setupFixture();
    const verifier = {
      verifyUserPermissions: async () => ({
        canBrowse: true, canCreateIssue: true, canAddComment: true, status: 'granted' as const,
      }),
    };
    const policyService = new JiraPolicyService({ pool, verifier });
    const sanitizer = new JiraHistorySanitizer(policyService);

    const convRepo = new ConversationRepo(pool);
    const msgRepo = new MessageRepo(pool);
    const planRepo = new PlanRepo(pool);

    const lateSecret = 'LATE_ARRIVING_JIRA_DATA: passwords stored in plain text';
    const emittedEvents: Array<{ event: string; payload: any }> = [];

    // Planner simulates delay and returns answer with Jira sourceRef
    const mockPlanner = {
      processMessage: vi.fn(async () => {
        // While planner is executing, Jira membership is revoked!
        await pool.query(
          `UPDATE ati_workspace_memberships SET status = 'removed' WHERE workspace_id = $1 AND user_id = $2`,
          [f.workspaceId, f.userId]
        );
        return {
          kind: 'answer' as const,
          text: lateSecret,
          sourceRefs: [f.sourceRef],
          lookups: [],
          usedDirectory: [],
        };
      }),
    };

    const chatEvents = createChatEventEmitter();

    const chatService = new ChatService({
      msgRepo,
      convRepo,
      planRepo,
      planner: mockPlanner as any,
      eventEmitter: chatEvents.emitter,
      jiraHistorySanitizer: sanitizer,
      jiraPolicyService: policyService,
    });

    await chatService.handleUserMessage({
      conversationId: f.conversationId,
      userId: f.userId,
      content: 'Fetch secret issue',
    });
    await chatEvents.waitForTurn();

    // Check database persistence: assistant message must be masked, not raw secret
    const messages = await msgRepo.listMessages(f.conversationId);
    const assistantMsg = messages.find((m) => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.content).not.toContain(lateSecret);
    expect(assistantMsg!.content).toContain('Nội dung Jira đã bị ẩn do quyền truy cập bị thay đổi hoặc thu hồi: membership_inactive');
    expect(assistantMsg!.metadata).toMatchObject({
      masked: true,
      maskReason: 'membership_inactive',
    });

    // Check event publication: no unmasked secret emitted
    const emittedString = JSON.stringify(chatEvents.emittedEvents);
    expect(emittedString).not.toContain(lateSecret);
  });

  // =========================================================================
  // 3. Mixed-Source Message Masking
  // =========================================================================
  it('masks mixed-source message completely when Jira source loses access', async () => {
    const f = await setupFixture();
    const verifier = {
      verifyUserPermissions: async () => ({
        canBrowse: true, canCreateIssue: true, canAddComment: true, status: 'granted' as const,
      }),
    };
    const policyService = new JiraPolicyService({ pool, verifier });
    const sanitizer = new JiraHistorySanitizer(policyService);

    // Deactivate Jira site in DB
    await pool.query(
      `UPDATE ati_workspace_jira_sites SET active = false WHERE id = $1`,
      [f.siteId]
    );

    const mixedMessage = {
      id: randomUUID(),
      conv_id: f.conversationId,
      role: 'assistant' as const,
      content: 'GitHub PR #42 merged with Jira Issue GRD-101: sensitive database migration key',
      metadata: {
        sourceRefs: [f.sourceRef],
        github: { repo: 'org/repo', sha: 'c0ffee' },
        customSecret: 'TOP_SECRET_MIXED_PAYLOAD',
      },
      created_at: new Date(),
    };

    const sanitized = await sanitizer.sanitizeMessage(f.userId, mixedMessage);

    // Whole message must be masked closed
    expect(sanitized.content).not.toContain('sensitive database migration key');
    expect(sanitized.content).not.toContain('TOP_SECRET_MIXED_PAYLOAD');
    expect(sanitized.content).not.toContain('c0ffee');
    expect(sanitized.content).toContain('Nội dung Jira đã bị ẩn do quyền truy cập bị thay đổi hoặc thu hồi: site_disabled');
    expect(sanitized.metadata).toEqual({
      masked: true,
      maskReason: 'site_disabled',
    });
  });

  // =========================================================================
  // 4. Raw Plan Route Guard (404 Hidden Pattern)
  // =========================================================================
  it('returns 404 hidden pattern on GET /plans/active when Jira binding is revoked', async () => {
    const f = await setupFixture();
    const planRepo = new PlanRepo(pool);
    const convRepo = new ConversationRepo(pool);
    const msgRepo = new MessageRepo(pool);

    const planJson = {
      kind: 'plan',
      summary: 'Execute Jira task',
      steps: [
        { id: 'step_1', service: 'myjira', tool: 'myjira.create_issue', params: { projectKey: 'GRD', summary: 'New ticket' } },
      ],
      connections: {
        myjira: f.boundConnection,
      },
    };

    const createdPlan = await planRepo.createPlan({
      convId: f.conversationId,
      planJson,
      planText: JSON.stringify(planJson),
      planHash: 'hash-active-plan-test',
      expiresAt: new Date(Date.now() + 600000),
      resourceLabels: {},
    });

    const jwtSecret = '01234567890123456789012345678901_jwt_secret';
    const sessionRepo = new SessionRepo(pool);
    const { sessionId } = await sessionRepo.create(f.userId, 'test-agent');
    const { accessToken: token } = generateAccessToken(
      { id: f.userId, email: 'user@example.test', name: 'User', role: 'admin', status: 'active' },
      jwtSecret,
      sessionId
    );
    const app = createApp({
      pool,
      userRepo: new UserRepo(pool),
      sessionRepo,
      workspaceRepo: new WorkspaceRepo(pool),
      convRepo,
      msgRepo,
      planRepo,
      chatService: {} as any,
      jwtSecret,
    });

    // 1. While site is active: returns 200 with the active plan
    const resActive = await request(app)
      .get(`/api/conversations/${f.conversationId}/plans/active`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Workspace-Id', f.workspaceId);
    expect(resActive.status).toBe(200);
    expect(resActive.body.id).toBe(createdPlan.id);

    // 2. Revoke Jira site in database
    await pool.query(
      `UPDATE ati_workspace_jira_sites SET active = false WHERE id = $1`,
      [f.siteId]
    );

    // 3. After revocation: returns 404 Hidden pattern, raw plan is inaccessible
    const resRevoked = await request(app)
      .get(`/api/conversations/${f.conversationId}/plans/active`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Workspace-Id', f.workspaceId);
    expect(resRevoked.status).toBe(404);
    expect(resRevoked.body.error).toMatch(/Không tìm thấy kế hoạch|No active pending plan/i);
    expect(JSON.stringify(resRevoked.body)).not.toContain('Execute Jira task');
  });

  // =========================================================================
  // 5. Delayed SSE Delta and JiraStreamBuffer
  // =========================================================================
  it('buffers Jira deltas, emits progress without Jira data, and drops deltas on lease revocation', async () => {
    let leaseActive = true;
    const revalidateLease = vi.fn(async () => {
      return { valid: leaseActive, status: leaseActive ? 'active' : 'revoked' };
    });

    const buffer = new JiraStreamBuffer({ revalidateLease });
    const emittedProgress: any[] = [];
    const emittedDeltas: any[] = [];

    const emitProgressCallback = (p: any) => emittedProgress.push(p);
    const emitDeltaCallback = (d: any) => emittedDeltas.push(d);

    // 1. Emit progress: passes through directly and contains no Jira content
    buffer.emitProgress({ step: 1, status: 'running' }, emitProgressCallback);
    expect(emittedProgress).toEqual([{ step: 1, status: 'running' }]);
    expect(buffer.bufferedCount).toBe(0);

    // 2. Buffer Jira deltas
    buffer.bufferDelta({ delta: 'ticket_summary: Critical Leak' });
    buffer.bufferDelta({ delta: 'ticket_description: Leaked DB credentials' });
    expect(buffer.bufferedCount).toBe(2);

    // 3. Lease is revoked before flush!
    leaseActive = false;

    // 4. Flush must fail and discard all deltas
    await expect(
      buffer.flushOnStepComplete('lease_123', emitDeltaCallback)
    ).rejects.toThrow(JiraStreamBufferRevokedError);

    expect(buffer.bufferedCount).toBe(0);
    expect(buffer.isEmpty()).toBe(true);
    // Deltas were NEVER emitted
    expect(emittedDeltas).toEqual([]);

    // 5. If lease was active, deltas flush cleanly
    leaseActive = true;
    buffer.bufferDelta({ delta: 'valid_delta_1' });
    buffer.bufferDelta({ delta: 'valid_delta_2' });

    const flushSummary = await buffer.flushOnStepComplete('lease_valid', emitDeltaCallback);
    expect(flushSummary.flushedCount).toBe(2);
    expect(emittedDeltas).toEqual([
      { delta: 'valid_delta_1' },
      { delta: 'valid_delta_2' },
    ]);
  });

  // =========================================================================
  // 6. Provider Outage (Fail-Closed)
  // =========================================================================
  it('fails closed when provider is unavailable (503/timeout), masking output', async () => {
    const f = await setupFixture();
    // Verifier simulates provider 503 outage or timeout
    const verifier = {
      verifyUserPermissions: async () => {
        throw new Error('Atlassian REST API 503 Service Unavailable');
      },
    };
    const policyService = new JiraPolicyService({ pool, verifier });
    const sanitizer = new JiraHistorySanitizer(policyService);

    const revalidation = await policyService.revalidateSource(f.userId, f.sourceRef);
    expect(revalidation).toEqual({ allowed: false, reason: 'provider_unavailable' });

    const message = {
      id: randomUUID(),
      conv_id: f.conversationId,
      role: 'assistant' as const,
      content: 'Jira issue GRD-101: production incident credentials',
      metadata: { sourceRefs: [f.sourceRef] },
      created_at: new Date(),
    };

    const sanitized = await sanitizer.sanitizeMessage(f.userId, message);
    expect(sanitized.content).toContain('Nội dung Jira đã bị ẩn do quyền truy cập bị thay đổi hoặc thu hồi: provider_unavailable');
    expect(sanitized.content).not.toContain('production incident credentials');
    expect(sanitized.metadata).toEqual({
      masked: true,
      maskReason: 'provider_unavailable',
    });
  });

  // =========================================================================
  // 7. Gather Progress Safety (No Jira Content in Progress)
  // =========================================================================
  it('omits raw Jira content from gather_progress events', async () => {
    const f = await setupFixture();
    const convRepo = new ConversationRepo(pool);
    const msgRepo = new MessageRepo(pool);
    const planRepo = new PlanRepo(pool);

    const chatEvents = createChatEventEmitter();

    const mockPlanner = {
      processMessage: vi.fn(async (input: any) => {
        // Planner emits gather event with sensitive Jira output
        input.onGatherEvent?.({
          tool: 'myjira.get_issue',
          status: 'completed',
          output: { issueKey: 'GRD-101', description: 'SECRET_PAYLOAD' },
        });
        return { kind: 'answer' as const, text: 'Done', lookups: [], usedDirectory: [] };
      }),
    };

    const chatService = new ChatService({
      msgRepo,
      convRepo,
      planRepo,
      planner: mockPlanner as any,
      eventEmitter: chatEvents.emitter,
    });

    await chatService.handleUserMessage({
      conversationId: f.conversationId,
      userId: f.userId,
      content: 'Gather issue',
    });
    await chatEvents.waitForTurn();

    const gatherProgress = chatEvents.emittedEvents.find((e) => e.event === 'gather_progress');
    expect(gatherProgress).toBeDefined();
    // The progress event must contain tool and status, but NOT the sensitive output
    expect(JSON.stringify(gatherProgress)).not.toContain('SECRET_PAYLOAD');
    expect(gatherProgress!.payload.tool).toBe('myjira.get_issue');
    expect(gatherProgress!.payload.status).toBe('completed');
  });

  // =========================================================================
  // 8. Mutation Verification: Omitting guards fails security checks
  // =========================================================================
  describe('Mutation tests: omitting each guard leaks data', () => {
    it('mutation 1: omitting history sanitizer leaks revoked gather data to planner', async () => {
      const f = await setupFixture();
      const convRepo = new ConversationRepo(pool);
      const msgRepo = new MessageRepo(pool);
      const planRepo = new PlanRepo(pool);

      const secretContent = 'MUTATION_GATHER_LEAK: sensitive vulnerability';
      await msgRepo.createMessage(f.conversationId, 'assistant', secretContent, {
        sourceRefs: [f.sourceRef],
        gather: true,
      });

      await pool.query(
        `UPDATE ati_workspace_jira_projects SET selected = false WHERE site_id = $1`,
        [f.siteId]
      );

      let historyReceived: any[] = [];
      const mockPlanner = {
        processMessage: vi.fn(async (input: any) => {
          historyReceived = input.history;
          return { kind: 'answer' as const, text: 'Done', lookups: [], usedDirectory: [] };
        }),
      };

      // MUTATION: omit jiraHistorySanitizer
      const mutatedChatService = new ChatService({
        msgRepo,
        convRepo,
        planRepo,
        planner: mockPlanner as any,
        eventEmitter: { emit: () => {} },
        // jiraHistorySanitizer omitted!
      });

      const chatEvents = createChatEventEmitter();
      (mutatedChatService as any).eventEmitter = chatEvents.emitter;

      await mutatedChatService.handleUserMessage({
        conversationId: f.conversationId,
        userId: f.userId,
        content: 'Tell me about the gather',
      });
      await chatEvents.waitForTurn();

      // Proves mutation: omitting the sanitizer leaks the revoked secret!
      const serialized = JSON.stringify(historyReceived);
      expect(serialized).toContain(secretContent);
    });

    it('mutation 2: omitting late response guard persists revoked data', async () => {
      const f = await setupFixture();
      const convRepo = new ConversationRepo(pool);
      const msgRepo = new MessageRepo(pool);
      const planRepo = new PlanRepo(pool);

      const lateSecret = 'MUTATION_LATE_LEAK: root credentials';
      const mockPlanner = {
        processMessage: vi.fn(async () => {
          await pool.query(
            `UPDATE ati_workspace_memberships SET status = 'removed' WHERE workspace_id = $1 AND user_id = $2`,
            [f.workspaceId, f.userId]
          );
          return {
            kind: 'answer' as const,
            text: lateSecret,
            sourceRefs: [f.sourceRef],
            lookups: [],
            usedDirectory: [],
          };
        }),
      };

      // MUTATION: omit jiraPolicyService
      const mutatedChatService = new ChatService({
        msgRepo,
        convRepo,
        planRepo,
        planner: mockPlanner as any,
        eventEmitter: { emit: () => {} },
        // jiraPolicyService omitted!
      });

      const chatEvents = createChatEventEmitter();
      (mutatedChatService as any).eventEmitter = chatEvents.emitter;

      await mutatedChatService.handleUserMessage({
        conversationId: f.conversationId,
        userId: f.userId,
        content: 'Run late query',
      });
      await chatEvents.waitForTurn();

      const messages = await msgRepo.listMessages(f.conversationId);
      const assistantMsg = messages.find((m) => m.role === 'assistant');
      // Proves mutation: without the guard, the late secret is persisted unmasked!
      expect(assistantMsg!.content).toContain(lateSecret);
    });
  });

  describe('Non-Jira Message Preservation & Answer sourceRefs Persistence', () => {
    it('leaves non-Jira assistant messages completely unmasked in history sanitizer', async () => {
      const f = await setupFixture();
      const verifier = {
        verifyUserPermissions: async () => ({
          canBrowse: true, canCreateIssue: true, canAddComment: true, status: 'granted' as const,
        }),
      };
      const policyService = new JiraPolicyService({ pool, verifier });
      const sanitizer = new JiraHistorySanitizer(policyService);

      const nonJiraMessage: any = {
        id: 'msg-non-jira',
        conversation_id: f.conversationId,
        role: 'assistant',
        content: 'Xin chào, tôi là trợ lý AI. Tôi có thể giúp gì cho bạn?',
        metadata: { type: 'answer', lookups: [], usedDirectory: [] },
        created_at: new Date(),
      };

      const sanitized = await sanitizer.sanitizeMessage(f.userId, nonJiraMessage);
      expect(sanitized.content).toBe('Xin chào, tôi là trợ lý AI. Tôi có thể giúp gì cho bạn?');
      expect((sanitized.metadata as any)?.masked).toBeUndefined();
    });

    it('persists sourceRefs in message metadata for answers with Jira sources', async () => {
      const f = await setupFixture();
      const verifier = {
        verifyUserPermissions: async () => ({
          canBrowse: true, canCreateIssue: true, canAddComment: true, status: 'granted' as const,
        }),
      };
      const policyService = new JiraPolicyService({ pool, verifier });
      const sanitizer = new JiraHistorySanitizer(policyService);

      const convRepo = new ConversationRepo(pool);
      const msgRepo = new MessageRepo(pool);
      const planRepo = new PlanRepo(pool);

      const normalAnswer = 'Đây là kết quả tìm kiếm Jira hợp lệ';
      const mockPlanner = {
        processMessage: vi.fn(async () => {
          return {
            kind: 'answer' as const,
            text: normalAnswer,
            sourceRefs: [f.sourceRef],
            lookups: [{ tool: 'myjira.search_issues', args: { query: 'test' } }],
            usedDirectory: ['myjira'],
          };
        }),
      };

      const chatEvents = createChatEventEmitter();
      const chatService = new ChatService({
        msgRepo,
        convRepo,
        planRepo,
        planner: mockPlanner as any,
        eventEmitter: chatEvents.emitter,
        jiraHistorySanitizer: sanitizer,
        jiraPolicyService: policyService,
      });

      await chatService.handleUserMessage({
        conversationId: f.conversationId,
        userId: f.userId,
        content: 'Tìm issue',
      });
      await chatEvents.waitForTurn();

      const messages = await msgRepo.listMessages(f.conversationId);
      const assistantMsg = messages.find((m) => m.role === 'assistant');
      expect(assistantMsg).toBeDefined();
      expect(assistantMsg!.content).toBe(normalAnswer);
      const metadata = typeof assistantMsg!.metadata === 'string' ? JSON.parse(assistantMsg!.metadata) : assistantMsg!.metadata;
      expect(metadata.sourceRefs).toBeDefined();
      expect(Array.isArray(metadata.sourceRefs)).toBe(true);
      expect(metadata.sourceRefs[0].providerResourceId).toBe('10001');
    });

    it('masks Jira answer when Jira gather occurred but permissions were revoked before answer preparation', async () => {
      const f = await setupFixture();
      const verifier = {
        verifyUserPermissions: async () => ({
          canBrowse: true, canCreateIssue: true, canAddComment: true, status: 'granted' as const,
        }),
      };
      const policyService = new JiraPolicyService({ pool, verifier });
      const sanitizer = new JiraHistorySanitizer(policyService);

      const convRepo = new ConversationRepo(pool);
      const msgRepo = new MessageRepo(pool);
      const planRepo = new PlanRepo(pool);

      const sensitiveText = 'Nội dung Jira bí mật: Token 123456';
      const mockPlanner = {
        processMessage: vi.fn(async (input: any) => {
          // Emit a gather event with Jira output containing sourceRef
          input.onGatherEvent?.({
            tool: 'myjira.search_issues',
            status: 'completed',
            output: [{ id: '10001', key: 'PROJ-1', _sourceRefs: [f.sourceRef] }],
          });

          // Simulate grant revocation in PostgreSQL right after gather finishes
          await pool.query(
            `UPDATE jira_oauth_grants SET status = 'revoked' WHERE id = $1`,
            [f.grantId]
          );

          return {
            kind: 'answer' as const,
            text: sensitiveText,
            lookups: [{ tool: 'myjira.search_issues', args: { query: 'test' } }],
            usedDirectory: ['myjira'],
          };
        }),
      };

      const chatEvents = createChatEventEmitter();
      const chatService = new ChatService({
        msgRepo,
        convRepo,
        planRepo,
        planner: mockPlanner as any,
        eventEmitter: chatEvents.emitter,
        jiraHistorySanitizer: sanitizer,
        jiraPolicyService: policyService,
      });

      await chatService.handleUserMessage({
        conversationId: f.conversationId,
        userId: f.userId,
        content: 'Tìm issue',
      });
      await chatEvents.waitForTurn();

      const messages = await msgRepo.listMessages(f.conversationId);
      const assistantMsg = messages.find((m) => m.role === 'assistant');
      expect(assistantMsg).toBeDefined();
      // Sensitive content must NEVER be saved
      expect(assistantMsg!.content).not.toContain('Token 123456');
      expect(assistantMsg!.content).toContain('Nội dung Jira đã bị ẩn do quyền truy cập bị thay đổi hoặc thu hồi');
      const metadata = typeof assistantMsg!.metadata === 'string' ? JSON.parse(assistantMsg!.metadata) : assistantMsg!.metadata;
      expect(metadata.masked).toBe(true);
    });
  });

  // =========================================================================
  // 7. Gather Path Guarding & Provenance Construction (phase: 'planning')
  // =========================================================================
  describe('7. Gather Path Guarding & Provenance Construction (phase: planning)', () => {
    function createGatherFactory(
      f: Fixture,
      options: {
        verifier?: any;
        baseAdapterExecute?: (tool: string, args: any) => Promise<any>;
      } = {}
    ) {
      const tokenManager = { getAccessToken: async () => 'test-token-jira-gather' };
      const leaseManager = new JiraLeaseManager({ pool, tokenManager });
      const dispatchGuard = new JiraDispatchGuard(pool, leaseManager, tokenManager);

      return new AdapterFactory({
        credentialRepo: {} as any,
        encryptionKey: 'test-encryption-key-with-32bytes',
        jiraTokens: tokenManager,
        jiraDispatchGuard: dispatchGuard,
        jiraNativeVerifier: options.verifier ?? {
          verifyUserPermissions: async () => ({
            status: 'allowed',
            canBrowse: true,
            canCreateIssue: true,
            canAddComment: true,
          }),
        },
        jiraWorkspaceRepo: {
          getCapabilities: async () => ({
            workspaceId: f.workspaceId,
            sites: [
              {
                siteId: f.siteId,
                cloudId: f.cloudId,
                name: 'Guard Site',
                url: 'https://guard.atlassian.net',
                projects: [{ id: '10001', key: 'GRD', name: 'Guard Project' }],
              },
            ],
          }),
        },
        createPersonalJiraAdapter: () => ({
          execute: options.baseAdapterExecute ?? (async (tool, args) => {
            if (tool === 'myjira.search_projects') {
              return [{ id: '10001', key: 'GRD', name: 'Guard Project', siteId: args.siteId }];
            }
            return [];
          }),
        } as any),
      });
    }

    it('gathers Jira data under phase: planning, acquiring lease, locking DB rows, and returning results with complete sourceRefs', async () => {
      const f = await setupFixture();
      const factory = createGatherFactory(f);

      const adapter = await factory.getAdapterForService('myjira', {
        userId: f.userId,
        workspaceId: f.workspaceId,
        phase: 'planning',
      });

      const result = await adapter.execute('myjira.search_projects', { siteId: f.siteId, query: '' });
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);

      // Verify array has _sourceRefs attached
      const refs = (result as any)._sourceRefs;
      expect(refs).toBeDefined();
      expect(refs).toHaveLength(1);
      expect(refs[0].binding.atiUserId).toBe(f.userId);
      expect(refs[0].binding.jiraAccountId).toBe(f.accountId);
      expect(refs[0].binding.grantId).toBe(f.grantId);
      expect(refs[0].binding.atlassianAccountId).toBe(f.atlassianAccountId);
      expect(refs[0].siteId).toBe(f.siteId);
      expect(refs[0].cloudId).toBe(f.cloudId);

      // Verify item also has enumerable _sourceRef
      expect(result[0]._sourceRef).toBeDefined();
      expect(result[0]._sourceRef.binding.atiUserId).toBe(f.userId);
      expect(result[0]._sourceRef.binding.grantId).toBe(f.grantId);

      // Verify lease was automatically released in DB since phase is planning (deferRelease: false)
      const leaseId = (result as any)._leaseId;
      expect(leaseId).toBeDefined();
      const leaseRes = await pool.query<{ status: string }>(
        `SELECT status FROM jira_authorization_leases WHERE lease_id = $1`,
        [leaseId]
      );
      expect(leaseRes.rows[0]!.status).toBe('released');
    });

    it('rejects gather under phase: planning when user membership is inactive in DB, preventing unauthorized data from reaching planner', async () => {
      const f = await setupFixture();
      let baseAdapterCalled = false;
      const factory = createGatherFactory(f, {
        baseAdapterExecute: async () => {
          baseAdapterCalled = true;
          return [{ id: '10001', key: 'LEAK', name: 'Leaked Data' }];
        },
      });

      // Revoke Jira membership in PostgreSQL
      await pool.query(
        `UPDATE ati_workspace_memberships SET status = 'removed' WHERE workspace_id = $1 AND user_id = $2`,
        [f.workspaceId, f.userId]
      );

      const adapter = await factory.getAdapterForService('myjira', {
        userId: f.userId,
        workspaceId: f.workspaceId,
        phase: 'planning',
      });

      await expect(
        adapter.execute('myjira.search_projects', { siteId: f.siteId, query: '' })
      ).rejects.toThrow(/membership inactive/i);

      // Jira adapter was NEVER called, zero data leaked
      expect(baseAdapterCalled).toBe(false);
    });

    it('rejects gather under phase: planning when OAuth grant is revoked in DB, preventing unauthorized data from reaching planner', async () => {
      const f = await setupFixture();
      let baseAdapterCalled = false;
      const factory = createGatherFactory(f, {
        baseAdapterExecute: async () => {
          baseAdapterCalled = true;
          return [{ id: '10001', key: 'LEAK', name: 'Leaked Data' }];
        },
      });

      // Revoke OAuth grant in PostgreSQL
      await pool.query(
        `UPDATE jira_oauth_grants SET status = 'revoked' WHERE id = $1`,
        [f.grantId]
      );

      const adapter = await factory.getAdapterForService('myjira', {
        userId: f.userId,
        workspaceId: f.workspaceId,
        phase: 'planning',
      });

      await expect(
        adapter.execute('myjira.search_projects', { siteId: f.siteId, query: '' })
      ).rejects.toThrow(/site grant unavailable/i);

      expect(baseAdapterCalled).toBe(false);
    });

    it('rejects gather under phase: planning when native verifier denies browse permission', async () => {
      const f = await setupFixture();
      let baseAdapterCalled = false;
      const factory = createGatherFactory(f, {
        verifier: {
          verifyUserPermissions: async () => ({
            status: 'denied',
            canBrowse: false,
            reason: 'User lacks BROWSE_PROJECTS permission on target Jira cloud site',
          }),
        },
        baseAdapterExecute: async () => {
          baseAdapterCalled = true;
          return [{ id: '10001', key: 'LEAK', name: 'Leaked Data' }];
        },
      });

      const adapter = await factory.getAdapterForService('myjira', {
        userId: f.userId,
        workspaceId: f.workspaceId,
        phase: 'planning',
      });

      await expect(
        adapter.execute('myjira.search_projects', { siteId: f.siteId, query: '' })
      ).rejects.toThrow(/Native Jira permission denied/i);

      expect(baseAdapterCalled).toBe(false);
    });

    it('gathers myjira.list_sites under phase: planning, acquiring lease, locking DB rows, and returning results with complete sourceRefs', async () => {
      const f = await setupFixture();
      const factory = createGatherFactory(f, {
        baseAdapterExecute: async (tool) => {
          if (tool === 'myjira.list_sites') {
            return [{ siteId: f.siteId, cloudId: f.cloudId, displayName: 'Guard Site', url: 'https://guard.atlassian.net' }];
          }
          return [];
        },
      });

      const adapter = await factory.getAdapterForService('myjira', {
        userId: f.userId,
        workspaceId: f.workspaceId,
        phase: 'planning',
      });

      const result = await adapter.execute('myjira.list_sites', {});
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);

      // Verify array has _sourceRefs attached
      const arrayRefs = (result as any)._sourceRefs;
      expect(arrayRefs).toBeDefined();
      expect(arrayRefs).toHaveLength(1);
      expect(arrayRefs[0].siteId).toBe(f.siteId);
      expect(arrayRefs[0].cloudId).toBe(f.cloudId);

      // Verify item has _sourceRef attached with complete binding
      const siteItem = result[0];
      const itemRef = siteItem._sourceRef;
      expect(itemRef).toBeDefined();
      expect(itemRef.binding.atiUserId).toBe(f.userId);
      expect(itemRef.binding.jiraAccountId).toBe(f.accountId);
      expect(itemRef.binding.atlassianAccountId).toBe(f.atlassianAccountId);
      expect(itemRef.binding.grantId).toBe(f.grantId);
      expect(itemRef.binding.membershipVersion).toBe(1);
      expect(itemRef.binding.identityVersion).toBe(1);
    });

    it('rejects myjira.list_sites under phase: planning when user membership is removed in DB', async () => {
      const f = await setupFixture();
      let baseAdapterCalled = false;
      const factory = createGatherFactory(f, {
        baseAdapterExecute: async () => {
          baseAdapterCalled = true;
          return [{ siteId: f.siteId, cloudId: f.cloudId, displayName: 'Leaked Site', url: 'https://leak.atlassian.net' }];
        },
      });

      // Revoke membership in PostgreSQL
      await pool.query(
        `UPDATE ati_workspace_memberships SET status = 'removed' WHERE workspace_id = $1 AND user_id = $2`,
        [f.workspaceId, f.userId]
      );

      const adapter = await factory.getAdapterForService('myjira', {
        userId: f.userId,
        workspaceId: f.workspaceId,
        phase: 'planning',
      });

      await expect(
        adapter.execute('myjira.list_sites', {})
      ).rejects.toThrow();

      expect(baseAdapterCalled).toBe(false);
    });

    it('rejects gather when workspaceId is missing, preventing arbitrary workspace selection', async () => {
      const f = await setupFixture();
      const factory = createGatherFactory(f);

      await expect(
        factory.getAdapterForService('myjira', {
          userId: f.userId,
          phase: 'planning',
        })
      ).rejects.toThrow(/không gian làm việc|Missing user or workspace/i);
    });
  });
});
