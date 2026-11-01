import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type pg from 'pg';
import { createApp, type AppOptions } from '../../src/app.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { UserRepo } from '../../src/db/repositories/user-repo.js';
import { SessionRepo } from '../../src/db/repositories/session-repo.js';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import { WorkspaceRepo as OrganizationRepo } from '../../src/db/repositories/workspace-repo.js';
import { MessageRepo } from '../../src/db/repositories/message-repo.js';
import { PlanRepo } from '../../src/db/repositories/plan-repo.js';
import { SSEManager } from '../../src/sse/sse-manager.js';
import type { ChatService } from '../../src/services/chat-service.js';
import type { ExecutionService } from '../../src/services/execution-service.js';
import type { ScheduleService } from '../../src/services/schedules/schedule-service.js';
import {
  createIsolatedTestSchema,
  createSyntheticUser,
  type IsolatedTestContext,
} from '../helpers/jira-test-db.js';

function firstRow<T extends pg.QueryResultRow>(res: pg.QueryResult<T>): T {
  const row = res.rows[0];
  if (!row) throw new Error('Expected query result to contain at least one row');
  return row;
}

/**
 * Creates a transparent proxy around a repository instance that hides
 * direct `pool` and `getPool` properties so that `createApp`'s default pool
 * inference evaluates to undefined, simulating an unavailable global authority checker.
 * All actual database methods are forwarded and bound to the real target.
 */
function hidePool<T extends object>(target: T): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (prop === 'pool' || prop === 'getPool') {
        return undefined;
      }
      const val = Reflect.get(obj, prop, receiver);
      if (typeof val === 'function') {
        return val.bind(obj);
      }
      return val;
    },
    has(obj, prop) {
      if (prop === 'pool' || prop === 'getPool') {
        return false;
      }
      return Reflect.has(obj, prop);
    },
  });
}

interface TestUser {
  id: string;
  email: string;
  name: string;
  sid: string;
  token: string;
}

/**
 * Reads initial headers/status from an SSE stream and immediately aborts the connection,
 * preventing hangs while ensuring proper server cleanup.
 */
async function fetchSseHeaders(
  app: any,
  path: string,
  token?: string,
  timeoutMs = 2000
): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;

  return new Promise<{ status: number; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        req.destroy();
        server.close();
        reject(new Error(`fetchSseHeaders timeout after ${timeoutMs}ms for ${path}`));
      }
    }, timeoutMs);

    const headers: http.OutgoingHttpHeaders = { Accept: 'text/event-stream' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const req = http.request(
      { hostname: '127.0.0.1', port, path, method: 'GET', headers },
      (res) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          const result = { status: res.statusCode || 500, headers: res.headers };
          req.destroy();
          res.destroy();
          server.close(() => resolve(result));
        }
      }
    );

    req.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        server.close(() => reject(err));
      }
    });

    req.end();
  });
}

describe('apps/chat-api — JIRA-03 Workspace Authority Unavailable Fail-Closed Boundary', () => {
  let ctx: IsolatedTestContext;
  let pool: pg.Pool;

  // Raw repositories backed by real PostgreSQL
  let rawUserRepo: UserRepo;
  let rawSessionRepo: SessionRepo;
  let rawConvRepo: ConversationRepo;
  let rawMsgRepo: MessageRepo;
  let rawPlanRepo: PlanRepo;
  let sseManager: SSEManager;

  // Pool-hidden facade repositories for SUT
  let hiddenUserRepo: UserRepo;
  let hiddenSessionRepo: SessionRepo;
  let hiddenConvRepo: ConversationRepo;
  let hiddenPlanRepo: PlanRepo;

  const jwtSecret = 'jira_ws_auth_unavail_test_secret_at_least_32_chars';

  // Spies to assert denied calls never trigger downstream effects
  let chatServiceSpy: { handleUserMessage: ReturnType<typeof vi.fn> };
  let executionServiceSpy: {
    approveAndStart: ReturnType<typeof vi.fn>;
    getLatestExecutionSnapshot: ReturnType<typeof vi.fn>;
    getOwnedPlan: ReturnType<typeof vi.fn>;
    getPlanRepo: ReturnType<typeof vi.fn>;
    continueExecution: ReturnType<typeof vi.fn>;
    retryStep: ReturnType<typeof vi.fn>;
    skipStep: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    getExecutionStatusDurable: ReturnType<typeof vi.fn>;
  };
  let scheduleServiceSpy: {
    confirmProposal: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
    pendingCount: ReturnType<typeof vi.fn>;
    listRuns: ReturnType<typeof vi.fn>;
  };

  let unavailApp: ReturnType<typeof createApp>;

  let alice: TestUser; // Conversation owner (scoped & legacy)
  let bob: TestUser;   // Non-owner outsider

  async function createTestMember(name: string, prefix: string): Promise<TestUser> {
    const userId = await createSyntheticUser(pool, name, prefix, { role: 'member', status: 'active' });
    const userRow = await rawUserRepo.findById(userId);
    const email = userRow?.email ?? `${prefix}_${randomUUID().slice(0, 8)}@example.test`;
    const { sessionId } = await rawSessionRepo.create(userId, 'test-agent');
    const token = generateAccessToken(
      { id: userId, email, name, role: 'member', status: 'active' },
      jwtSecret,
      sessionId
    ).accessToken;
    return { id: userId, email, name, sid: sessionId, token };
  }

  async function seedWorkspace(name: string, slug: string, createdBy: string, status = 'active'): Promise<string> {
    const wsId = randomUUID();
    await pool.query(
      `INSERT INTO workspaces (id, name, invite_code, require_approval, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, false, $4, clock_timestamp(), clock_timestamp())`,
      [wsId, name, `INV-${wsId.slice(0, 8)}`.toUpperCase(), createdBy]
    );
    const res = await pool.query<{ id: string }>(
      `INSERT INTO ati_workspaces (id, slug, status, version, created_by)
       VALUES ($1, $2, $3, 1, $4)
       RETURNING id`,
      [wsId, slug, status, createdBy]
    );
    return firstRow(res).id;
  }

  async function seedMembership(
    workspaceId: string,
    userId: string,
    role: 'admin' | 'member' = 'member',
    status: 'pending' | 'active' | 'rejected' | 'removed' = 'active'
  ): Promise<void> {
    const genericStatus = status === 'active' ? 'active' : 'disabled';
    await pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, clock_timestamp(), clock_timestamp())
       ON CONFLICT (workspace_id, user_id)
       DO UPDATE SET status = EXCLUDED.status, role = EXCLUDED.role, updated_at = clock_timestamp()`,
      [workspaceId, userId, role, genericStatus]
    );
    await pool.query(
      `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version)
       VALUES ($1, $2, $3, $4, 1)
       ON CONFLICT (workspace_id, user_id)
       DO UPDATE SET status = EXCLUDED.status, role = EXCLUDED.role, updated_at = clock_timestamp()`,
      [workspaceId, userId, role, status]
    );
  }

  async function seedConversation(
    userId: string,
    workspaceId: string | null = null,
    title = 'Test Conversation'
  ): Promise<string> {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO conversations (id, user_id, status, title, workspace_id, workspace_mode, jira_context)
       VALUES ($1, $2, 'chatting', $3, $4, $5, $6)
       RETURNING id`,
      [
        randomUUID(),
        userId,
        title,
        workspaceId,
        workspaceId ? 'organization' : 'legacy',
        workspaceId ? true : false,
      ]
    );
    return firstRow(res).id;
  }

  async function seedMessage(
    convId: string,
    role: 'user' | 'assistant' = 'user',
    content = 'Hello world',
    metadata: Record<string, unknown> = {}
  ): Promise<string> {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO messages (id, conv_id, role, content, metadata)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [randomUUID(), convId, role, content, JSON.stringify(metadata)]
    );
    return firstRow(res).id;
  }

  async function seedPlan(
    convId: string,
    status = 'pending',
    planJson: Record<string, unknown> = { steps: [{ id: 's1', tool: 'jira.search' }] }
  ): Promise<string> {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO plans (id, conv_id, plan_json, plan_hash, expires_at, status)
       VALUES ($1, $2, $3, 'test-plan-hash', clock_timestamp() + interval '1 hour', $4)
       RETURNING id`,
      [randomUUID(), convId, JSON.stringify(planJson), status]
    );
    return firstRow(res).id;
  }

  async function seedScheduleProposal(convId: string): Promise<string> {
    const messageId = randomUUID();
    const proposal = {
      kind: 'schedule',
      action: 'create',
      name: 'Daily sync',
      request: 'Send summary to Jira',
      recurrence: { type: 'daily', time: '09:00' },
      summary: 'Daily sync at 9 AM',
    };
    await pool.query(
      `INSERT INTO messages (id, conv_id, role, content, metadata)
       VALUES ($1, $2, 'assistant', $3, $4)`,
      [
        messageId,
        convId,
        proposal.summary,
        JSON.stringify({
          type: 'schedule_proposal',
          proposal,
          services: ['jira'],
          nextRuns: [],
        }),
      ]
    );
    return messageId;
  }

  beforeAll(async () => {
    ctx = await createIsolatedTestSchema();
    await ctx.runAllMigrations();
    pool = ctx.pool;

    rawUserRepo = new UserRepo(pool);
    rawSessionRepo = new SessionRepo(pool);
    rawConvRepo = new ConversationRepo(pool);
    rawMsgRepo = new MessageRepo(pool);
    rawPlanRepo = new PlanRepo(pool);
    sseManager = new SSEManager();

    hiddenUserRepo = hidePool(rawUserRepo);
    hiddenSessionRepo = hidePool(rawSessionRepo);
    hiddenConvRepo = hidePool(rawConvRepo);
    hiddenPlanRepo = hidePool(rawPlanRepo);

    alice = await createTestMember('Alice Owner', 'alice');
    bob = await createTestMember('Bob Outsider', 'bob');
  });

  afterAll(async () => {
    await ctx?.cleanup();
  });

  beforeEach(() => {
    chatServiceSpy = {
      handleUserMessage: vi.fn().mockResolvedValue({ messageId: randomUUID(), status: 'accepted' }),
    };

    executionServiceSpy = {
      approveAndStart: vi.fn().mockResolvedValue({ success: true, status: 200, planId: randomUUID() }),
      getLatestExecutionSnapshot: vi.fn().mockResolvedValue({ status: 'completed', steps: [] }),
      getOwnedPlan: vi.fn().mockImplementation(async (planId: string, userId: string) => {
        const plan = await rawPlanRepo.getPlan(planId);
        if (!plan) throw new Error('Plan not found');
        const conv = await rawConvRepo.getConversation(plan.conv_id);
        if (!conv || conv.user_id !== userId) throw new Error('Forbidden');
        return { id: planId, conv_id: plan.conv_id, user_id: userId };
      }),
      getPlanRepo: vi.fn().mockReturnValue(hiddenPlanRepo),
      continueExecution: vi.fn().mockResolvedValue({ success: true }),
      retryStep: vi.fn().mockResolvedValue({ success: true, stepId: 's1' }),
      skipStep: vi.fn().mockResolvedValue({ success: true, stepId: 's1' }),
      stop: vi.fn().mockResolvedValue({ success: true, planId: randomUUID() }),
      getExecutionStatusDurable: vi.fn().mockResolvedValue({ status: 'running', planId: randomUUID() }),
    };

    scheduleServiceSpy = {
      confirmProposal: vi.fn().mockResolvedValue({
        schedule: { id: randomUUID(), convId: randomUUID(), version: 1, status: 'active' },
        convId: randomUUID(),
        state: null,
      }),
      list: vi.fn().mockResolvedValue([]),
      pendingCount: vi.fn().mockResolvedValue(0),
      listRuns: vi.fn().mockResolvedValue([]),
    };

    // Deliberately withhold options.pool and supply pool-hidden repository facades
    const appOptions: AppOptions = {
      jwtSecret,
      workspaceRepo: hidePool(new OrganizationRepo(pool)),
      userRepo: hiddenUserRepo,
      sessionRepo: hiddenSessionRepo,
      convRepo: hiddenConvRepo,
      msgRepo: rawMsgRepo,
      planRepo: hiddenPlanRepo,
      sseManager,
      chatService: chatServiceSpy as unknown as ChatService,
      executionService: executionServiceSpy as unknown as ExecutionService,
      schedules: {
        service: scheduleServiceSpy as unknown as ScheduleService,
        clock: () => new Date(),
      },
    };

    unavailApp = createApp(appOptions);
  });

  // ==========================================================================
  // 0. Positive Authentication & Legacy Baseline Control
  // ==========================================================================
  describe('Positive Authentication & Legacy Baseline Control', () => {
    it('authenticates valid Bearer token and accesses legacy conversation positive control', async () => {
      const testLegacyId = await seedConversation(alice.id, null, 'Alice Baseline Legacy Conv');
      const res = await request(unavailApp)
        .get(`/api/conversations/${testLegacyId}`)
        .set('Authorization', `Bearer ${alice.token}`);

      expect(res.status).toBe(200);
      expect(res.body.conversation).toBeDefined();
      expect(res.body.conversation.id).toBe(testLegacyId);
      expect(res.body.conversation.user_id).toBe(alice.id);
    });
  });

  // ==========================================================================
  // 1. Scoped Conversation with Revoked Membership: Fail Closed (404)
  // ==========================================================================
  describe('Scoped Conversation When Authority Checker Is Unavailable', () => {
    let wsId: string;
    let scopedConvId: string;
    let scopedPlanId: string;
    let scopedSchedMsgId: string;

    beforeEach(async () => {
      wsId = await seedWorkspace('Revoked WS Auth Test', `ws-unavail-${randomUUID().slice(0, 8)}`, alice.id);
      await seedMembership(wsId, alice.id, 'member', 'active');

      scopedConvId = await seedConversation(alice.id, wsId, 'Scoped Conf Private Discussion');
      await seedMessage(scopedConvId, 'user', 'Confidential project details');
      scopedPlanId = await seedPlan(scopedConvId, 'pending', { steps: [{ id: 's1', tool: 'jira.search' }] });
      scopedSchedMsgId = await seedScheduleProposal(scopedConvId);

      // Membership is revoked via PostgreSQL
      await pool.query(
        `UPDATE ati_workspace_memberships SET status = 'removed', updated_at = clock_timestamp() WHERE workspace_id = $1 AND user_id = $2`,
        [wsId, alice.id]
      );
    });

    it('GET /api/conversations/:id fails closed with 404 and leaks no scoped content', async () => {
      const res = await request(unavailApp)
        .get(`/api/conversations/${scopedConvId}`)
        .set('Authorization', `Bearer ${alice.token}`);

      expect(res.status).toBe(404);
      expect(res.body.conversation).toBeUndefined();
    });

    it('GET /api/conversations/:id/messages/latest fails closed with 404', async () => {
      const res = await request(unavailApp)
        .get(`/api/conversations/${scopedConvId}/messages/latest`)
        .set('Authorization', `Bearer ${alice.token}`);

      expect(res.status).toBe(404);
    });

    it('GET /api/conversations/:id/plans/active fails closed with 404', async () => {
      const res = await request(unavailApp)
        .get(`/api/conversations/${scopedConvId}/plans/active`)
        .set('Authorization', `Bearer ${alice.token}`);

      expect(res.status).toBe(404);
    });

    it('POST /api/conversations/:id/messages fails closed with 404 and does NOT invoke chatService', async () => {
      const res = await request(unavailApp)
        .post(`/api/conversations/${scopedConvId}/messages`)
        .set('Authorization', `Bearer ${alice.token}`)
        .send({ content: 'Post attempt without authority checker' });

      expect(res.status).toBe(404);
      expect(chatServiceSpy.handleUserMessage).not.toHaveBeenCalled();
    });

    it('GET /api/conversations/:id/stream fails closed with 404 before sending SSE headers', async () => {
      const sseRes = await fetchSseHeaders(unavailApp, `/api/conversations/${scopedConvId}/stream`, alice.token);
      expect(sseRes.status).toBe(404);
      expect(sseRes.headers['content-type']).not.toMatch(/text\/event-stream/);
    });

    it('GET /api/conversations/:convId/executions/latest fails closed with 404 and does NOT invoke executionService', async () => {
      const res = await request(unavailApp)
        .get(`/api/conversations/${scopedConvId}/executions/latest`)
        .set('Authorization', `Bearer ${alice.token}`);

      expect(res.status).toBe(404);
      expect(executionServiceSpy.getLatestExecutionSnapshot).not.toHaveBeenCalled();
    });

    it('POST /api/plans/:id/approve fails closed with 404 and does NOT invoke executionService', async () => {
      const res = await request(unavailApp)
        .post(`/api/plans/${scopedPlanId}/approve`)
        .set('Authorization', `Bearer ${alice.token}`)
        .send({});

      expect(res.status).toBe(404);
      expect(executionServiceSpy.approveAndStart).not.toHaveBeenCalled();
    });

    it('POST /api/plans/:id/reject fails closed with 404', async () => {
      const res = await request(unavailApp)
        .post(`/api/plans/${scopedPlanId}/reject`)
        .set('Authorization', `Bearer ${alice.token}`)
        .send({});

      expect(res.status).toBe(404);
    });

    it('POST /api/executions/:planId/continue fails closed with 404 and does NOT invoke executionService', async () => {
      const res = await request(unavailApp)
        .post(`/api/executions/${scopedPlanId}/continue`)
        .set('Authorization', `Bearer ${alice.token}`)
        .send({});

      expect(res.status).toBe(404);
      expect(executionServiceSpy.continueExecution).not.toHaveBeenCalled();
    });

    it('POST /api/executions/:planId/steps/:stepId/retry fails closed with 404 and does NOT invoke executionService', async () => {
      const res = await request(unavailApp)
        .post(`/api/executions/${scopedPlanId}/steps/s1/retry`)
        .set('Authorization', `Bearer ${alice.token}`)
        .send({});

      expect(res.status).toBe(404);
      expect(executionServiceSpy.retryStep).not.toHaveBeenCalled();
    });

    it('POST /api/executions/:planId/steps/:stepId/skip fails closed with 404 and does NOT invoke executionService', async () => {
      const res = await request(unavailApp)
        .post(`/api/executions/${scopedPlanId}/steps/s1/skip`)
        .set('Authorization', `Bearer ${alice.token}`)
        .send({});

      expect(res.status).toBe(404);
      expect(executionServiceSpy.skipStep).not.toHaveBeenCalled();
    });

    it('POST /api/executions/:planId/stop fails closed with 404 and does NOT invoke executionService', async () => {
      const res = await request(unavailApp)
        .post(`/api/executions/${scopedPlanId}/stop`)
        .set('Authorization', `Bearer ${alice.token}`)
        .send({});

      expect(res.status).toBe(404);
      expect(executionServiceSpy.stop).not.toHaveBeenCalled();
    });

    it('GET /api/executions/:planId/status fails closed with 404 and does NOT invoke executionService', async () => {
      const res = await request(unavailApp)
        .get(`/api/executions/${scopedPlanId}/status`)
        .set('Authorization', `Bearer ${alice.token}`);

      expect(res.status).toBe(404);
      expect(executionServiceSpy.getExecutionStatusDurable).not.toHaveBeenCalled();
    });

    it('POST /api/conversations/:convId/schedule-proposals/:messageId/confirm fails closed with 404 and does NOT invoke scheduleService', async () => {
      const res = await request(unavailApp)
        .post(`/api/conversations/${scopedConvId}/schedule-proposals/${scopedSchedMsgId}/confirm`)
        .set('Authorization', `Bearer ${alice.token}`)
        .send({});

      expect(res.status).toBe(404);
      expect(scheduleServiceSpy.confirmProposal).not.toHaveBeenCalled();
    });

    it('POST /api/conversations with a valid organization header and Jira opt-in returns 503 by default without authority', async () => {
      await pool.query("UPDATE workspace_members SET status='active' WHERE workspace_id=$1 AND user_id=$2", [wsId, alice.id]);
      const res = await request(unavailApp)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${alice.token}`)
        .set('X-Workspace-Id', wsId)
        .send({ jiraContext: true });

      expect(res.status).toBe(503);
      expect(res.body.code).toBe('WORKSPACE_CONVERSATIONS_UNAVAILABLE');
    });

    it('POST /api/conversations with Jira opt-in returns 503 with the internal flag when authority is unavailable', async () => {
      await pool.query("UPDATE workspace_members SET status='active' WHERE workspace_id=$1 AND user_id=$2", [wsId, alice.id]);
      const fixtureWithFlagApp = createApp({
        jwtSecret,
        workspaceRepo: hidePool(new OrganizationRepo(pool)),
        userRepo: hiddenUserRepo,
        sessionRepo: hiddenSessionRepo,
        convRepo: hiddenConvRepo,
        msgRepo: rawMsgRepo,
        planRepo: hiddenPlanRepo,
        sseManager,
        chatService: chatServiceSpy as unknown as ChatService,
        enableWorkspaceConversations: true,
      });

      const res = await request(fixtureWithFlagApp)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${alice.token}`)
        .set('X-Workspace-Id', wsId)
        .send({ jiraContext: true });

      expect(res.status).toBe(503);
      expect(res.body.code).toBe('WORKSPACE_CONVERSATIONS_UNAVAILABLE');
    });
  });

  // ==========================================================================
  // 2. Scoped Conversation with Archived Workspace: Fail Closed (404)
  // ==========================================================================
  describe('Scoped Conversation in Archived Workspace When Authority Checker Is Unavailable', () => {
    let wsArchId: string;
    let archConvId: string;
    let archPlanId: string;
    let archSchedMsgId: string;

    beforeEach(async () => {
      wsArchId = await seedWorkspace('Archived WS Unavail Test', `ws-arch-unavail-${randomUUID().slice(0, 8)}`, alice.id, 'archived');
      await seedMembership(wsArchId, alice.id, 'member', 'active');

      archConvId = await seedConversation(alice.id, wsArchId, 'Archived Scoped Conversation');
      await seedMessage(archConvId, 'user', 'Archived conversation details');
      archPlanId = await seedPlan(archConvId, 'pending', { steps: [{ id: 's1', tool: 'jira.search' }] });
      archSchedMsgId = await seedScheduleProposal(archConvId);
    });

    it('denies access across conversation, stream, execution, and schedule endpoints when workspace is archived', async () => {
      // Detail
      const getRes = await request(unavailApp).get(`/api/conversations/${archConvId}`).set('Authorization', `Bearer ${alice.token}`);
      expect(getRes.status).toBe(404);

      // Messages latest
      const msgRes = await request(unavailApp).get(`/api/conversations/${archConvId}/messages/latest`).set('Authorization', `Bearer ${alice.token}`);
      expect(msgRes.status).toBe(404);

      // Chat post
      const chatRes = await request(unavailApp).post(`/api/conversations/${archConvId}/messages`).set('Authorization', `Bearer ${alice.token}`).send({ content: 'test' });
      expect(chatRes.status).toBe(404);
      expect(chatServiceSpy.handleUserMessage).not.toHaveBeenCalled();

      // SSE Stream
      const sseRes = await fetchSseHeaders(unavailApp, `/api/conversations/${archConvId}/stream`, alice.token);
      expect(sseRes.status).toBe(404);
      expect(sseRes.headers['content-type']).not.toMatch(/text\/event-stream/);

      // Plan approve
      const planRes = await request(unavailApp).post(`/api/plans/${archPlanId}/approve`).set('Authorization', `Bearer ${alice.token}`).send({});
      expect(planRes.status).toBe(404);
      expect(executionServiceSpy.approveAndStart).not.toHaveBeenCalled();

      // Schedule confirm
      const schedRes = await request(unavailApp).post(`/api/conversations/${archConvId}/schedule-proposals/${archSchedMsgId}/confirm`).set('Authorization', `Bearer ${alice.token}`).send({});
      expect(schedRes.status).toBe(404);
      expect(scheduleServiceSpy.confirmProposal).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // 3. Positive Controls: Legacy NULL Conversation Retains Legacy Behavior
  // ==========================================================================
  describe('Legacy NULL Conversations Positive & Negative Controls With Unavailable Checker', () => {
    let legacyConvId: string;
    let legacyPlanId: string;

    beforeEach(async () => {
      legacyConvId = await seedConversation(alice.id, null, 'Alice Legacy Conv With Unavailable Checker');
      await seedMessage(legacyConvId, 'user', 'Legacy question');
      legacyPlanId = await seedPlan(legacyConvId, 'pending', { steps: [{ id: 's1', tool: 'jira.search' }] });
    });

    it('allows owner Alice to access legacy conversation details and post messages', async () => {
      const getRes = await request(unavailApp)
        .get(`/api/conversations/${legacyConvId}`)
        .set('Authorization', `Bearer ${alice.token}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.conversation).toBeDefined();
      expect(getRes.body.conversation.workspace_id).toBeNull();

      const chatRes = await request(unavailApp)
        .post(`/api/conversations/${legacyConvId}/messages`)
        .set('Authorization', `Bearer ${alice.token}`)
        .send({ content: 'Legacy chat message' });

      expect(chatRes.status).toBe(202);
      expect(chatServiceSpy.handleUserMessage).toHaveBeenCalledTimes(1);
    });

    it('allows owner Alice to stream SSE on legacy conversation', async () => {
      const sseRes = await fetchSseHeaders(unavailApp, `/api/conversations/${legacyConvId}/stream`, alice.token);
      expect(sseRes.status).toBe(200);
      expect(sseRes.headers['content-type']).toMatch(/text\/event-stream/);
    });

    it('denies outsider Bob on Alice legacy conversation under established legacy semantics', async () => {
      const getRes = await request(unavailApp)
        .get(`/api/conversations/${legacyConvId}`)
        .set('Authorization', `Bearer ${bob.token}`);
      expect([403, 404]).toContain(getRes.status);

      const chatRes = await request(unavailApp)
        .post(`/api/conversations/${legacyConvId}/messages`)
        .set('Authorization', `Bearer ${bob.token}`)
        .send({ content: 'Intrusion attempt' });
      expect(chatRes.status).toBe(403);

      const sseRes = await fetchSseHeaders(unavailApp, `/api/conversations/${legacyConvId}/stream`, bob.token);
      expect(sseRes.status).toBe(403);
      expect(sseRes.headers['content-type']).not.toMatch(/text\/event-stream/);
    });
  });
});
