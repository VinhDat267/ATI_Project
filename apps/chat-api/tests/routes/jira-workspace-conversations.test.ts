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
import { WorkspaceRepo } from '../../src/db/repositories/workspace-repo.js';
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

interface TestUser {
  id: string;
  email: string;
  name: string;
  sid: string;
  token: string;
}

/**
 * Executes an SSE GET request against an ephemeral server instance,
 * reads initial status and headers without hanging on the infinite event stream,
 * aborts client streams immediately, and closes the server in finally.
 * Strict deadline ensures neither positive nor negative SSE tests hang.
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
    let settled = false;

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'GET',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
      (res) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          const result = {
            status: res.statusCode ?? 500,
            headers: res.headers,
          };
          req.destroy();
          res.destroy();
          resolve(result);
        }
      }
    );

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        req.destroy();
        reject(new Error(`SSE request timed out after ${timeoutMs}ms for ${path}`));
      }
    }, timeoutMs);

    req.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });

    req.end();
  }).finally(() => {
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
}

describe('apps/chat-api — JIRA-03 Conversation Scoped Access & Route Guards', () => {
  let ctx: IsolatedTestContext;
  let pool: pg.Pool;
  let userRepo: UserRepo;
  let sessionRepo: SessionRepo;
  let convRepo: ConversationRepo;
  let msgRepo: MessageRepo;
  let planRepo: PlanRepo;
  let sseManager: SSEManager;

  const jwtSecret = 'jira_ws_conv_test_jwt_secret_at_least_32_chars';

  // Spies for external services to assert they are NOT called on denied requests
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

  // Test applications: prod (default, no workspace conv creation) vs fixture (enableWorkspaceConversations: true)
  let prodApp: ReturnType<typeof createApp>;
  let fixtureApp: ReturnType<typeof createApp>;

  // Test users
  let alice: TestUser; // Member of W1
  let bob: TestUser;   // Outsider / member of W2
  let charlie: TestUser; // Unaffiliated outsider

  // Helper to create synthetic user with real database session and access token
  async function createTestMember(name: string, prefix: string): Promise<TestUser> {
    const userId = await createSyntheticUser(pool, name, prefix, { role: 'member', status: 'active' });
    const userRow = await userRepo.findById(userId);
    const email = userRow?.email ?? `${prefix}_${randomUUID().slice(0, 8)}@example.test`;
    const { sessionId } = await sessionRepo.create(userId, 'test-agent');
    const token = generateAccessToken(
      { id: userId, email, name, role: 'member', status: 'active' },
      jwtSecret,
      sessionId
    ).accessToken;

    return { id: userId, email, name, sid: sessionId, token };
  }

  // Database seed helpers
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
    await pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'active', clock_timestamp(), clock_timestamp())
       ON CONFLICT (workspace_id, user_id)
       DO UPDATE SET status = 'active', role = EXCLUDED.role, updated_at = clock_timestamp()`,
      [workspaceId, userId, role]
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
    ctx = await createIsolatedTestSchema({ maxConnections: 10 });
    pool = ctx.pool;

    // Run migrations 0001–0015
    await ctx.runAllMigrations();

    userRepo = new UserRepo(pool);
    sessionRepo = new SessionRepo(pool);
    convRepo = new ConversationRepo(pool);
    msgRepo = new MessageRepo(pool);
    planRepo = new PlanRepo(pool);
    sseManager = new SSEManager();

    alice = await createTestMember('Alice Member', 'alice');
    bob = await createTestMember('Bob Member', 'bob');
    charlie = await createTestMember('Charlie Outsider', 'charlie');
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
        return { id: planId, conv_id: randomUUID(), user_id: userId };
      }),
      getPlanRepo: vi.fn().mockReturnValue({
        rejectPlan: vi.fn().mockResolvedValue(true),
      }),
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

    const baseOptions: AppOptions = {
      jwtSecret,
      userRepo,
      sessionRepo,
      convRepo,
      workspaceRepo: new WorkspaceRepo(pool),
      pool,
      msgRepo,
      planRepo,
      sseManager,
      chatService: chatServiceSpy as unknown as ChatService,
      executionService: executionServiceSpy as unknown as ExecutionService,
      schedules: {
        service: scheduleServiceSpy as unknown as ScheduleService,
        clock: () => new Date(),
      },
    };

    prodApp = createApp({
      ...baseOptions,
      enableWorkspaceConversations: false,
    });

    fixtureApp = createApp({
      ...baseOptions,
      enableWorkspaceConversations: true,
    });
  });

  // ==========================================================================
  // 1. Availability Boundary (POST /api/conversations)
  // ==========================================================================
  describe('HTTP Conversation Creation Boundary (POST /api/conversations)', () => {
    it('returns HTTP 503 WORKSPACE_CONVERSATIONS_UNAVAILABLE in default production mode when workspaceId is provided', async () => {
      const wsId = await seedWorkspace('WS Prod Test', `ws-prod-${randomUUID().slice(0, 8)}`, alice.id);
      await seedMembership(wsId, alice.id, 'member', 'active');

      const res = await request(prodApp)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${alice.token}`)
        .set('X-Workspace-Id', wsId)
        .send({ jiraContext: true });

      expect(res.status).toBe(503);
      expect(res.body.code).toBe('WORKSPACE_CONVERSATIONS_UNAVAILABLE');
    });

    it('allows legacy NULL conversation creation (201 Created) in production mode without workspaceId', async () => {
      const res = await request(prodApp)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${alice.token}`)
        .send({});

      expect(res.status).toBe(201);
      expect(res.body.conversation).toBeDefined();
      expect(res.body.conversation.user_id).toBe(alice.id);

      const dbConv = await pool.query<{ workspace_id: string | null }>(
        'SELECT workspace_id FROM conversations WHERE id = $1',
        [res.body.conversation.id]
      );
      expect(firstRow(dbConv).workspace_id).toBeNull();
    });

    it('creates scoped conversation (201 Created) when internal enableWorkspaceConversations option is true and user is active member', async () => {
      const wsId = await seedWorkspace('WS Fixture Active', `ws-fix-act-${randomUUID().slice(0, 8)}`, alice.id);
      await seedMembership(wsId, alice.id, 'member', 'active');

      const res = await request(fixtureApp)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${alice.token}`)
        .set('X-Workspace-Id', wsId)
        .send({ jiraContext: true });

      expect(res.status).toBe(201);
      expect(res.body.conversation).toBeDefined();
      expect(res.body.conversation.workspace_id).toBe(wsId);

      const dbConv = await pool.query<{ workspace_id: string }>(
        'SELECT workspace_id FROM conversations WHERE id = $1',
        [res.body.conversation.id]
      );
      expect(firstRow(dbConv).workspace_id).toBe(wsId);
    });

    it('returns HTTP 404 when outsider attempts to create conversation in workspace where they are not a member', async () => {
      const wsId = await seedWorkspace('WS Private Alpha', `ws-priv-${randomUUID().slice(0, 8)}`, alice.id);
      await seedMembership(wsId, alice.id, 'member', 'active');
      await pool.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`,
        [wsId, bob.id]
      );

      const res = await request(fixtureApp)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${bob.token}`)
        .set('X-Workspace-Id', wsId)
        .send({ jiraContext: true });

      expect(res.status).toBe(404);
    });

    it('returns HTTP 404 when user with pending membership attempts to create conversation', async () => {
      const wsId = await seedWorkspace('WS Pending Test', `ws-pend-${randomUUID().slice(0, 8)}`, alice.id);
      await seedMembership(wsId, bob.id, 'member', 'pending');

      const res = await request(fixtureApp)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${bob.token}`)
        .set('X-Workspace-Id', wsId)
        .send({ jiraContext: true });

      expect(res.status).toBe(404);
    });

    it('returns HTTP 404 when user with rejected membership attempts to create conversation', async () => {
      const wsId = await seedWorkspace('WS Rejected Test', `ws-rej-${randomUUID().slice(0, 8)}`, alice.id);
      await seedMembership(wsId, bob.id, 'member', 'rejected');

      const res = await request(fixtureApp)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${bob.token}`)
        .set('X-Workspace-Id', wsId)
        .send({ jiraContext: true });

      expect(res.status).toBe(404);
    });

    it('returns HTTP 404 when user with removed membership attempts to create conversation', async () => {
      const wsId = await seedWorkspace('WS Removed Test', `ws-rem-${randomUUID().slice(0, 8)}`, alice.id);
      await seedMembership(wsId, bob.id, 'member', 'removed');

      const res = await request(fixtureApp)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${bob.token}`)
        .set('X-Workspace-Id', wsId)
        .send({ jiraContext: true });

      expect(res.status).toBe(404);
    });

    it('returns HTTP 404 when member attempts to create conversation in an archived workspace', async () => {
      const wsId = await seedWorkspace('WS Archived Test', `ws-arch-${randomUUID().slice(0, 8)}`, alice.id, 'archived');
      await seedMembership(wsId, alice.id, 'member', 'active');

      const res = await request(fixtureApp)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${alice.token}`)
        .set('X-Workspace-Id', wsId)
        .send({ jiraContext: true });

      expect(res.status).toBe(404);
    });
  });

  // ==========================================================================
  // 2. Positive Controls across All Scoped Routes (Before Revocation)
  // ==========================================================================
  describe('Positive Controls — Authorized Scoped Access for Active Workspace Members', () => {
    let wsId: string;
    let convId: string;
    let messageId: string;
    let planId: string;
    let schedMessageId: string;

    beforeEach(async () => {
      wsId = await seedWorkspace('Positive WS', `ws-pos-${randomUUID().slice(0, 8)}`, alice.id);
      await seedMembership(wsId, alice.id, 'member', 'active');
      convId = await seedConversation(alice.id, wsId, 'Active Scoped Conversation');
      messageId = await seedMessage(convId, 'user', 'What is the sprint status?');
      planId = await seedPlan(convId, 'pending', { steps: [{ id: 's1', tool: 'jira.search' }] });
      schedMessageId = await seedScheduleProposal(convId);
    });

    it('GET /api/conversations returns listing containing the scoped conversation', async () => {
      const res = await request(fixtureApp)
        .get('/api/conversations')
        .set('Authorization', `Bearer ${alice.token}`)
        .set('X-Workspace-Id', wsId);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.conversations)).toBe(true);
      const found = res.body.conversations.find((c: any) => c.id === convId);
      expect(found).toBeDefined();
      expect(found.workspace_id).toBe(wsId);
    });

    it('GET /api/conversations/:id returns conversation details and messages', async () => {
      const res = await request(fixtureApp)
        .get(`/api/conversations/${convId}`)
        .set('Authorization', `Bearer ${alice.token}`);

      expect(res.status).toBe(200);
      expect(res.body.conversation.id).toBe(convId);
      expect(res.body.conversation.workspace_id).toBe(wsId);
      expect(Array.isArray(res.body.messages)).toBe(true);
    });

    it('PATCH /api/conversations/:id allows renaming scoped conversation', async () => {
      const res = await request(fixtureApp)
        .patch(`/api/conversations/${convId}`)
        .set('Authorization', `Bearer ${alice.token}`)
        .send({ title: 'Updated Title by Active Member' });

      expect(res.status).toBe(200);
      expect(res.body.conversation.title).toBe('Updated Title by Active Member');
    });

    it('GET /api/conversations/:id/messages/latest returns latest message in scoped conversation', async () => {
      const res = await request(fixtureApp)
        .get(`/api/conversations/${convId}/messages/latest`)
        .set('Authorization', `Bearer ${alice.token}`);

      expect(res.status).toBe(200);
      expect(res.body.conv_id).toBe(convId);
    });

    it('GET /api/conversations/:id/plans/active returns pending active plan', async () => {
      const res = await request(fixtureApp)
        .get(`/api/conversations/${convId}/plans/active`)
        .set('Authorization', `Bearer ${alice.token}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(planId);
      expect(res.body.convId).toBe(convId);
    });

    it('POST /api/conversations/:id/messages accepts message and invokes chatService', async () => {
      const res = await request(fixtureApp)
        .post(`/api/conversations/${convId}/messages`)
        .set('Authorization', `Bearer ${alice.token}`)
        .send({ content: 'Sync sprint burndown' });

      expect(res.status).toBe(202);
      expect(chatServiceSpy.handleUserMessage).toHaveBeenCalledTimes(1);
      expect(chatServiceSpy.handleUserMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: convId,
          userId: alice.id,
          content: 'Sync sprint burndown',
        })
      );
    });

    it('GET /api/conversations/:id/stream sets SSE headers for active member without hanging', async () => {
      const sseRes = await fetchSseHeaders(fixtureApp, `/api/conversations/${convId}/stream`, alice.token);
      expect(sseRes.status).toBe(200);
      expect(sseRes.headers['content-type']).toMatch(/text\/event-stream/);
    });

    it('GET /api/conversations/:convId/executions/latest returns execution snapshot', async () => {
      const res = await request(fixtureApp)
        .get(`/api/conversations/${convId}/executions/latest`)
        .set('Authorization', `Bearer ${alice.token}`);

      expect(res.status).toBe(200);
      expect(executionServiceSpy.getLatestExecutionSnapshot).toHaveBeenCalledWith(convId, alice.id);
    });

    it('POST /api/plans/:id/approve invokes executionService.approveAndStart', async () => {
      const res = await request(fixtureApp)
        .post(`/api/plans/${planId}/approve`)
        .set('Authorization', `Bearer ${alice.token}`)
        .send({});

      expect(res.status).toBe(200);
      expect(executionServiceSpy.approveAndStart).toHaveBeenCalledWith(planId, alice.id);
    });

    it('POST /api/plans/:id/reject invokes executionService.rejectPlan', async () => {
      const res = await request(fixtureApp)
        .post(`/api/plans/${planId}/reject`)
        .set('Authorization', `Bearer ${alice.token}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('rejected');
    });

    it('POST /api/executions/:planId/continue invokes executionService.continueExecution', async () => {
      const res = await request(fixtureApp)
        .post(`/api/executions/${planId}/continue`)
        .set('Authorization', `Bearer ${alice.token}`)
        .send({});

      expect(res.status).toBe(200);
      expect(executionServiceSpy.continueExecution).toHaveBeenCalledWith(planId, alice.id);
    });

    it('POST /api/executions/:planId/steps/:stepId/retry invokes executionService.retryStep', async () => {
      const res = await request(fixtureApp)
        .post(`/api/executions/${planId}/steps/s1/retry`)
        .set('Authorization', `Bearer ${alice.token}`)
        .send({});

      expect(res.status).toBe(200);
      expect(executionServiceSpy.retryStep).toHaveBeenCalledWith(planId, 's1', alice.id);
    });

    it('POST /api/executions/:planId/steps/:stepId/skip invokes executionService.skipStep', async () => {
      const res = await request(fixtureApp)
        .post(`/api/executions/${planId}/steps/s1/skip`)
        .set('Authorization', `Bearer ${alice.token}`)
        .send({});

      expect(res.status).toBe(200);
      expect(executionServiceSpy.skipStep).toHaveBeenCalledWith(planId, 's1', alice.id);
    });

    it('POST /api/executions/:planId/stop invokes executionService.stop', async () => {
      const res = await request(fixtureApp)
        .post(`/api/executions/${planId}/stop`)
        .set('Authorization', `Bearer ${alice.token}`)
        .send({});

      expect(res.status).toBe(200);
      expect(executionServiceSpy.stop).toHaveBeenCalledWith(planId, alice.id);
    });

    it('GET /api/executions/:planId/status returns execution status for active member', async () => {
      const res = await request(fixtureApp)
        .get(`/api/executions/${planId}/status`)
        .set('Authorization', `Bearer ${alice.token}`);

      expect(res.status).toBe(200);
      expect(executionServiceSpy.getExecutionStatusDurable).toHaveBeenCalledWith(planId);
    });

    it('POST /api/conversations/:convId/schedule-proposals/:messageId/confirm invokes scheduleService', async () => {
      const res = await request(fixtureApp)
        .post(`/api/conversations/${convId}/schedule-proposals/${schedMessageId}/confirm`)
        .set('Authorization', `Bearer ${alice.token}`)
        .send({});

      expect(res.status).toBe(200);
      expect(scheduleServiceSpy.confirmProposal).toHaveBeenCalledWith(
        expect.objectContaining({
          convId,
          messageId: schedMessageId,
          userId: alice.id,
        })
      );
    });
  });

  // ==========================================================================
  // 3. Outsider Denial (User B in Different Workspace or Unaffiliated)
  // ==========================================================================
  describe('Cross-Tenant / Outsider Access Control (404 Hidden Pattern)', () => {
    let wsAId: string;
    let wsBId: string;
    let convAId: string;
    let planAId: string;
    let schedMessageAId: string;

    beforeEach(async () => {
      wsAId = await seedWorkspace('Workspace Alpha', `ws-a-${randomUUID().slice(0, 8)}`, alice.id);
      await seedMembership(wsAId, alice.id, 'member', 'active');

      wsBId = await seedWorkspace('Workspace Beta', `ws-b-${randomUUID().slice(0, 8)}`, bob.id);
      await seedMembership(wsBId, bob.id, 'member', 'active');

      convAId = await seedConversation(alice.id, wsAId, 'Alpha Secret Discussion');
      await seedMessage(convAId, 'user', 'Confidential project details');
      planAId = await seedPlan(convAId, 'pending', { steps: [{ id: 's1', tool: 'jira.search' }] });
      schedMessageAId = await seedScheduleProposal(convAId);
    });

    it('GET /api/conversations by Bob never lists Alice conversation from Workspace Alpha', async () => {
      const res = await request(fixtureApp)
        .get('/api/conversations')
        .set('Authorization', `Bearer ${bob.token}`);

      expect(res.status).toBe(200);
      const found = res.body.conversations?.find((c: any) => c.id === convAId);
      expect(found).toBeUndefined();
    });

    it('GET /api/conversations/:id by Bob returns 404 for Alice scoped conversation', async () => {
      const res = await request(fixtureApp)
        .get(`/api/conversations/${convAId}`)
        .set('Authorization', `Bearer ${bob.token}`);

      expect(res.status).toBe(404);
    });

    it('PATCH /api/conversations/:id by Bob returns 404', async () => {
      const res = await request(fixtureApp)
        .patch(`/api/conversations/${convAId}`)
        .set('Authorization', `Bearer ${bob.token}`)
        .send({ title: 'Tampered by Bob' });

      expect(res.status).toBe(404);
    });

    it('GET /api/conversations/:id/messages/latest by Bob returns 404', async () => {
      const res = await request(fixtureApp)
        .get(`/api/conversations/${convAId}/messages/latest`)
        .set('Authorization', `Bearer ${bob.token}`);

      expect(res.status).toBe(404);
    });

    it('GET /api/conversations/:id/plans/active by Bob returns 404', async () => {
      const res = await request(fixtureApp)
        .get(`/api/conversations/${convAId}/plans/active`)
        .set('Authorization', `Bearer ${bob.token}`);

      expect(res.status).toBe(404);
    });

    it('POST /api/conversations/:id/messages by Bob returns 404 and does NOT invoke chatService', async () => {
      const res = await request(fixtureApp)
        .post(`/api/conversations/${convAId}/messages`)
        .set('Authorization', `Bearer ${bob.token}`)
        .send({ content: 'Unauthorized injection' });

      expect(res.status).toBe(404);
      expect(chatServiceSpy.handleUserMessage).not.toHaveBeenCalled();
    });

    it('GET /api/conversations/:id/stream by Bob returns 404 before sending SSE headers', async () => {
      const sseRes = await fetchSseHeaders(fixtureApp, `/api/conversations/${convAId}/stream`, bob.token);
      expect(sseRes.status).toBe(404);
      expect(sseRes.headers['content-type']).not.toMatch(/text\/event-stream/);
    });

    it('GET /api/conversations/:convId/executions/latest by Bob returns 404 and does NOT invoke executionService', async () => {
      const res = await request(fixtureApp)
        .get(`/api/conversations/${convAId}/executions/latest`)
        .set('Authorization', `Bearer ${bob.token}`);

      expect(res.status).toBe(404);
      expect(executionServiceSpy.getLatestExecutionSnapshot).not.toHaveBeenCalled();
    });

    it('POST /api/plans/:id/approve by Bob returns 404 and does NOT invoke executionService.approveAndStart', async () => {
      const res = await request(fixtureApp)
        .post(`/api/plans/${planAId}/approve`)
        .set('Authorization', `Bearer ${bob.token}`)
        .send({});

      expect(res.status).toBe(404);
      expect(executionServiceSpy.approveAndStart).not.toHaveBeenCalled();
    });

    it('POST /api/plans/:id/reject by Bob returns 404 and does NOT reject plan', async () => {
      const res = await request(fixtureApp)
        .post(`/api/plans/${planAId}/reject`)
        .set('Authorization', `Bearer ${bob.token}`)
        .send({});

      expect(res.status).toBe(404);
    });

    it('POST /api/executions/:planId/continue by Bob returns 404 and does NOT invoke executionService', async () => {
      const res = await request(fixtureApp)
        .post(`/api/executions/${planAId}/continue`)
        .set('Authorization', `Bearer ${bob.token}`)
        .send({});

      expect(res.status).toBe(404);
      expect(executionServiceSpy.continueExecution).not.toHaveBeenCalled();
    });

    it('POST /api/executions/:planId/steps/:stepId/retry by Bob returns 404 and does NOT invoke executionService', async () => {
      const res = await request(fixtureApp)
        .post(`/api/executions/${planAId}/steps/s1/retry`)
        .set('Authorization', `Bearer ${bob.token}`)
        .send({});

      expect(res.status).toBe(404);
      expect(executionServiceSpy.retryStep).not.toHaveBeenCalled();
    });

    it('POST /api/executions/:planId/steps/:stepId/skip by Bob returns 404 and does NOT invoke executionService', async () => {
      const res = await request(fixtureApp)
        .post(`/api/executions/${planAId}/steps/s1/skip`)
        .set('Authorization', `Bearer ${bob.token}`)
        .send({});

      expect(res.status).toBe(404);
      expect(executionServiceSpy.skipStep).not.toHaveBeenCalled();
    });

    it('POST /api/executions/:planId/stop by Bob returns 404 and does NOT invoke executionService', async () => {
      const res = await request(fixtureApp)
        .post(`/api/executions/${planAId}/stop`)
        .set('Authorization', `Bearer ${bob.token}`)
        .send({});

      expect(res.status).toBe(404);
      expect(executionServiceSpy.stop).not.toHaveBeenCalled();
    });

    it('GET /api/executions/:planId/status by Bob returns 404 and does NOT invoke executionService', async () => {
      const res = await request(fixtureApp)
        .get(`/api/executions/${planAId}/status`)
        .set('Authorization', `Bearer ${bob.token}`);

      expect(res.status).toBe(404);
      expect(executionServiceSpy.getExecutionStatusDurable).not.toHaveBeenCalled();
    });

    it('POST /api/conversations/:convId/schedule-proposals/:messageId/confirm by Bob returns 404 and does NOT invoke scheduleService', async () => {
      const res = await request(fixtureApp)
        .post(`/api/conversations/${convAId}/schedule-proposals/${schedMessageAId}/confirm`)
        .set('Authorization', `Bearer ${bob.token}`)
        .send({});

      expect(res.status).toBe(404);
      expect(scheduleServiceSpy.confirmProposal).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // 4. Revocation of Scoped Owner Access (Removed / Pending / Rejected / Archived)
  // ==========================================================================
  describe('Revocation of Scoped Owner Access across All Entry Points', () => {
    let wsId: string;
    let convId: string;
    let planId: string;
    let schedMsgId: string;

    beforeEach(async () => {
      wsId = await seedWorkspace('Revocation WS', `ws-rev-${randomUUID().slice(0, 8)}`, alice.id);
      await seedMembership(wsId, alice.id, 'member', 'active');
      convId = await seedConversation(alice.id, wsId, 'Alice Scoped Conv');
      await seedMessage(convId, 'user', 'Initial prompt');
      planId = await seedPlan(convId, 'pending', { steps: [{ id: 's1', tool: 'jira.search' }] });
      schedMsgId = await seedScheduleProposal(convId);
    });

    describe('When member status is changed to "removed"', () => {
      beforeEach(async () => {
        await seedMembership(wsId, alice.id, 'member', 'removed');
      });

      it('hides scoped conversation from GET /api/conversations', async () => {
        const res = await request(fixtureApp)
          .get('/api/conversations')
          .set('Authorization', `Bearer ${alice.token}`);

        expect(res.status).toBe(200);
        const found = res.body.conversations?.find((c: any) => c.id === convId);
        expect(found).toBeUndefined();
      });

      it('GET /api/conversations/:id returns 404', async () => {
        const res = await request(fixtureApp)
          .get(`/api/conversations/${convId}`)
          .set('Authorization', `Bearer ${alice.token}`);

        expect(res.status).toBe(404);
      });

      it('PATCH /api/conversations/:id returns 404', async () => {
        const res = await request(fixtureApp)
          .patch(`/api/conversations/${convId}`)
          .set('Authorization', `Bearer ${alice.token}`)
          .send({ title: 'New Title' });

        expect(res.status).toBe(404);
      });

      it('GET /api/conversations/:id/messages/latest returns 404', async () => {
        const res = await request(fixtureApp)
          .get(`/api/conversations/${convId}/messages/latest`)
          .set('Authorization', `Bearer ${alice.token}`);

        expect(res.status).toBe(404);
      });

      it('GET /api/conversations/:id/plans/active returns 404', async () => {
        const res = await request(fixtureApp)
          .get(`/api/conversations/${convId}/plans/active`)
          .set('Authorization', `Bearer ${alice.token}`);

        expect(res.status).toBe(404);
      });

      it('POST /api/conversations/:id/messages returns 404 and chatService spy is NOT invoked', async () => {
        const res = await request(fixtureApp)
          .post(`/api/conversations/${convId}/messages`)
          .set('Authorization', `Bearer ${alice.token}`)
          .send({ content: 'Post after removal' });

        expect(res.status).toBe(404);
        expect(chatServiceSpy.handleUserMessage).not.toHaveBeenCalled();
      });

      it('GET /api/conversations/:id/stream returns 404 before sending SSE headers', async () => {
        const sseRes = await fetchSseHeaders(fixtureApp, `/api/conversations/${convId}/stream`, alice.token);
        expect(sseRes.status).toBe(404);
        expect(sseRes.headers['content-type']).not.toMatch(/text\/event-stream/);
      });

      it('GET /api/conversations/:convId/executions/latest returns 404 and executionService is NOT called', async () => {
        const res = await request(fixtureApp)
          .get(`/api/conversations/${convId}/executions/latest`)
          .set('Authorization', `Bearer ${alice.token}`);

        expect(res.status).toBe(404);
        expect(executionServiceSpy.getLatestExecutionSnapshot).not.toHaveBeenCalled();
      });

      it('POST /api/plans/:id/approve returns 404 and executionService.approveAndStart is NOT called', async () => {
        const res = await request(fixtureApp)
          .post(`/api/plans/${planId}/approve`)
          .set('Authorization', `Bearer ${alice.token}`)
          .send({});

        expect(res.status).toBe(404);
        expect(executionServiceSpy.approveAndStart).not.toHaveBeenCalled();
      });

      it('POST /api/plans/:id/reject returns 404', async () => {
        const res = await request(fixtureApp)
          .post(`/api/plans/${planId}/reject`)
          .set('Authorization', `Bearer ${alice.token}`)
          .send({});

        expect(res.status).toBe(404);
      });

      it('POST /api/executions/:planId/continue returns 404 and executionService is NOT called', async () => {
        const res = await request(fixtureApp)
          .post(`/api/executions/${planId}/continue`)
          .set('Authorization', `Bearer ${alice.token}`)
          .send({});

        expect(res.status).toBe(404);
        expect(executionServiceSpy.continueExecution).not.toHaveBeenCalled();
      });

      it('POST /api/executions/:planId/steps/:stepId/retry returns 404 and executionService is NOT called', async () => {
        const res = await request(fixtureApp)
          .post(`/api/executions/${planId}/steps/s1/retry`)
          .set('Authorization', `Bearer ${alice.token}`)
          .send({});

        expect(res.status).toBe(404);
        expect(executionServiceSpy.retryStep).not.toHaveBeenCalled();
      });

      it('POST /api/executions/:planId/steps/:stepId/skip returns 404 and executionService is NOT called', async () => {
        const res = await request(fixtureApp)
          .post(`/api/executions/${planId}/steps/s1/skip`)
          .set('Authorization', `Bearer ${alice.token}`)
          .send({});

        expect(res.status).toBe(404);
        expect(executionServiceSpy.skipStep).not.toHaveBeenCalled();
      });

      it('POST /api/executions/:planId/stop returns 404 and executionService is NOT called', async () => {
        const res = await request(fixtureApp)
          .post(`/api/executions/${planId}/stop`)
          .set('Authorization', `Bearer ${alice.token}`)
          .send({});

        expect(res.status).toBe(404);
        expect(executionServiceSpy.stop).not.toHaveBeenCalled();
      });

      it('GET /api/executions/:planId/status returns 404 and executionService is NOT called', async () => {
        const res = await request(fixtureApp)
          .get(`/api/executions/${planId}/status`)
          .set('Authorization', `Bearer ${alice.token}`);

        expect(res.status).toBe(404);
        expect(executionServiceSpy.getExecutionStatusDurable).not.toHaveBeenCalled();
      });

      it('POST /api/conversations/:convId/schedule-proposals/:messageId/confirm returns 404 and scheduleService is NOT called', async () => {
        const res = await request(fixtureApp)
          .post(`/api/conversations/${convId}/schedule-proposals/${schedMsgId}/confirm`)
          .set('Authorization', `Bearer ${alice.token}`)
          .send({});

        expect(res.status).toBe(404);
        expect(scheduleServiceSpy.confirmProposal).not.toHaveBeenCalled();
      });
    });

    describe('When member status is changed to "pending" or "rejected"', () => {
      it('denies access across all endpoints when membership is pending', async () => {
        await seedMembership(wsId, alice.id, 'member', 'pending');

        const listRes = await request(fixtureApp).get('/api/conversations').set('Authorization', `Bearer ${alice.token}`);
        expect(listRes.body.conversations?.find((c: any) => c.id === convId)).toBeUndefined();

        const getRes = await request(fixtureApp).get(`/api/conversations/${convId}`).set('Authorization', `Bearer ${alice.token}`);
        expect(getRes.status).toBe(404);

        const msgRes = await request(fixtureApp).post(`/api/conversations/${convId}/messages`).set('Authorization', `Bearer ${alice.token}`).send({ content: 'msg' });
        expect(msgRes.status).toBe(404);
        expect(chatServiceSpy.handleUserMessage).not.toHaveBeenCalled();

        const streamRes = await fetchSseHeaders(fixtureApp, `/api/conversations/${convId}/stream`, alice.token);
        expect(streamRes.status).toBe(404);
        expect(streamRes.headers['content-type']).not.toMatch(/text\/event-stream/);

        const retryRes = await request(fixtureApp).post(`/api/executions/${planId}/steps/s1/retry`).set('Authorization', `Bearer ${alice.token}`).send({});
        expect(retryRes.status).toBe(404);
        expect(executionServiceSpy.retryStep).not.toHaveBeenCalled();
      });

      it('denies access across all endpoints when membership is rejected', async () => {
        await seedMembership(wsId, alice.id, 'member', 'rejected');

        const listRes = await request(fixtureApp).get('/api/conversations').set('Authorization', `Bearer ${alice.token}`);
        expect(listRes.body.conversations?.find((c: any) => c.id === convId)).toBeUndefined();

        const getRes = await request(fixtureApp).get(`/api/conversations/${convId}`).set('Authorization', `Bearer ${alice.token}`);
        expect(getRes.status).toBe(404);

        const planApproveRes = await request(fixtureApp).post(`/api/plans/${planId}/approve`).set('Authorization', `Bearer ${alice.token}`).send({});
        expect(planApproveRes.status).toBe(404);
        expect(executionServiceSpy.approveAndStart).not.toHaveBeenCalled();

        const stopRes = await request(fixtureApp).post(`/api/executions/${planId}/stop`).set('Authorization', `Bearer ${alice.token}`).send({});
        expect(stopRes.status).toBe(404);
        expect(executionServiceSpy.stop).not.toHaveBeenCalled();
      });
    });

    describe('When workspace is archived', () => {
      beforeEach(async () => {
        await pool.query("UPDATE ati_workspaces SET status = 'archived' WHERE id = $1", [wsId]);
      });

      it('denies access to active member when workspace is archived', async () => {
        const listRes = await request(fixtureApp).get('/api/conversations').set('Authorization', `Bearer ${alice.token}`);
        expect(listRes.body.conversations?.find((c: any) => c.id === convId)).toBeUndefined();

        const getRes = await request(fixtureApp).get(`/api/conversations/${convId}`).set('Authorization', `Bearer ${alice.token}`);
        expect(getRes.status).toBe(404);

        const patchRes = await request(fixtureApp).patch(`/api/conversations/${convId}`).set('Authorization', `Bearer ${alice.token}`).send({ title: 'New' });
        expect(patchRes.status).toBe(404);

        const streamRes = await fetchSseHeaders(fixtureApp, `/api/conversations/${convId}/stream`, alice.token);
        expect(streamRes.status).toBe(404);
        expect(streamRes.headers['content-type']).not.toMatch(/text\/event-stream/);

        const chatRes = await request(fixtureApp).post(`/api/conversations/${convId}/messages`).set('Authorization', `Bearer ${alice.token}`).send({ content: 'test' });
        expect(chatRes.status).toBe(404);
        expect(chatServiceSpy.handleUserMessage).not.toHaveBeenCalled();

        const execRes = await request(fixtureApp).get(`/api/conversations/${convId}/executions/latest`).set('Authorization', `Bearer ${alice.token}`);
        expect(execRes.status).toBe(404);
        expect(executionServiceSpy.getLatestExecutionSnapshot).not.toHaveBeenCalled();

        const approveRes = await request(fixtureApp).post(`/api/plans/${planId}/approve`).set('Authorization', `Bearer ${alice.token}`).send({});
        expect(approveRes.status).toBe(404);
        expect(executionServiceSpy.approveAndStart).not.toHaveBeenCalled();

        const skipRes = await request(fixtureApp).post(`/api/executions/${planId}/steps/s1/skip`).set('Authorization', `Bearer ${alice.token}`).send({});
        expect(skipRes.status).toBe(404);
        expect(executionServiceSpy.skipStep).not.toHaveBeenCalled();

        const schedRes = await request(fixtureApp).post(`/api/conversations/${convId}/schedule-proposals/${schedMsgId}/confirm`).set('Authorization', `Bearer ${alice.token}`).send({});
        expect(schedRes.status).toBe(404);
        expect(scheduleServiceSpy.confirmProposal).not.toHaveBeenCalled();
      });
    });
  });

  // ==========================================================================
  // 5. Legacy NULL Conversations (workspace_id IS NULL)
  // ==========================================================================
  describe('Legacy NULL Conversations Independence and Invariants', () => {
    let legacyConvId: string;
    let legacyPlanId: string;
    let legacySchedMsgId: string;

    beforeEach(async () => {
      legacyConvId = await seedConversation(alice.id, null, 'Alice Legacy Conv');
      await seedMessage(legacyConvId, 'user', 'Legacy question');
      legacyPlanId = await seedPlan(legacyConvId, 'pending', { steps: [{ id: 's1', tool: 'jira.search' }] });
      legacySchedMsgId = await seedScheduleProposal(legacyConvId);
    });

    it('retains full functionality for owner on legacy conversations across all routes without hanging', async () => {
      // 1. Listing
      const listRes = await request(fixtureApp)
        .get('/api/conversations')
        .set('Authorization', `Bearer ${alice.token}`);
      expect(listRes.status).toBe(200);
      const found = listRes.body.conversations?.find((c: any) => c.id === legacyConvId);
      expect(found).toBeDefined();
      expect(found.workspace_id).toBeNull();

      // 2. Detail
      const getRes = await request(fixtureApp)
        .get(`/api/conversations/${legacyConvId}`)
        .set('Authorization', `Bearer ${alice.token}`);
      expect(getRes.status).toBe(200);

      // 3. Rename
      const patchRes = await request(fixtureApp)
        .patch(`/api/conversations/${legacyConvId}`)
        .set('Authorization', `Bearer ${alice.token}`)
        .send({ title: 'Renamed Legacy Conv' });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.conversation.title).toBe('Renamed Legacy Conv');

      // 4. Latest messages
      const msgLatestRes = await request(fixtureApp)
        .get(`/api/conversations/${legacyConvId}/messages/latest`)
        .set('Authorization', `Bearer ${alice.token}`);
      expect(msgLatestRes.status).toBe(200);

      // 5. Active plan
      const planRes = await request(fixtureApp)
        .get(`/api/conversations/${legacyConvId}/plans/active`)
        .set('Authorization', `Bearer ${alice.token}`);
      expect(planRes.status).toBe(200);

      // 6. Chat messages
      const chatRes = await request(fixtureApp)
        .post(`/api/conversations/${legacyConvId}/messages`)
        .set('Authorization', `Bearer ${alice.token}`)
        .send({ content: 'Legacy chat prompt' });
      expect(chatRes.status).toBe(202);
      expect(chatServiceSpy.handleUserMessage).toHaveBeenCalledTimes(1);

      // 7. Stream with explicit timeout/abort (does not hang!)
      const streamRes = await fetchSseHeaders(fixtureApp, `/api/conversations/${legacyConvId}/stream`, alice.token);
      expect(streamRes.status).toBe(200);
      expect(streamRes.headers['content-type']).toMatch(/text\/event-stream/);

      // 8. Execution snapshot
      const execRes = await request(fixtureApp)
        .get(`/api/conversations/${legacyConvId}/executions/latest`)
        .set('Authorization', `Bearer ${alice.token}`);
      expect(execRes.status).toBe(200);

      // 9. Approve plan
      const approveRes = await request(fixtureApp)
        .post(`/api/plans/${legacyPlanId}/approve`)
        .set('Authorization', `Bearer ${alice.token}`)
        .send({});
      expect(approveRes.status).toBe(200);

      // 10. Execution continue, retry, skip, stop, status
      const contRes = await request(fixtureApp)
        .post(`/api/executions/${legacyPlanId}/continue`)
        .set('Authorization', `Bearer ${alice.token}`)
        .send({});
      expect(contRes.status).toBe(200);

      const retryRes = await request(fixtureApp)
        .post(`/api/executions/${legacyPlanId}/steps/s1/retry`)
        .set('Authorization', `Bearer ${alice.token}`)
        .send({});
      expect(retryRes.status).toBe(200);

      const skipRes = await request(fixtureApp)
        .post(`/api/executions/${legacyPlanId}/steps/s1/skip`)
        .set('Authorization', `Bearer ${alice.token}`)
        .send({});
      expect(skipRes.status).toBe(200);

      const stopRes = await request(fixtureApp)
        .post(`/api/executions/${legacyPlanId}/stop`)
        .set('Authorization', `Bearer ${alice.token}`)
        .send({});
      expect(stopRes.status).toBe(200);

      const statusRes = await request(fixtureApp)
        .get(`/api/executions/${legacyPlanId}/status`)
        .set('Authorization', `Bearer ${alice.token}`);
      expect(statusRes.status).toBe(200);

      // 11. Schedule confirm
      const schedRes = await request(fixtureApp)
        .post(`/api/conversations/${legacyConvId}/schedule-proposals/${legacySchedMsgId}/confirm`)
        .set('Authorization', `Bearer ${alice.token}`)
        .send({});
      expect(schedRes.status).toBe(200);
    });

    it('preserves existing legacy owner-denial semantics when Bob accesses Alice legacy conversation', async () => {
      const getRes = await request(fixtureApp)
        .get(`/api/conversations/${legacyConvId}`)
        .set('Authorization', `Bearer ${bob.token}`);
      expect(getRes.status).toBe(404);

      const patchRes = await request(fixtureApp)
        .patch(`/api/conversations/${legacyConvId}`)
        .set('Authorization', `Bearer ${bob.token}`)
        .send({ title: 'Hacked' });
      expect(patchRes.status).toBe(404);

      const streamRes = await fetchSseHeaders(fixtureApp, `/api/conversations/${legacyConvId}/stream`, bob.token);
      expect([403, 404]).toContain(streamRes.status);
      expect(streamRes.headers['content-type']).not.toMatch(/text\/event-stream/);
    });
  });

  // ==========================================================================
  // 6. Unauthenticated Requests (401 Unauthorized)
  // ==========================================================================
  describe('Unauthenticated Requests across Scoped Endpoints', () => {
    it('returns HTTP 401 Unauthorized when Authorization header is missing without hanging on SSE', async () => {
      const convId = randomUUID();

      const getRes = await request(fixtureApp).get(`/api/conversations/${convId}`);
      expect(getRes.status).toBe(401);

      const listRes = await request(fixtureApp).get('/api/conversations');
      expect(listRes.status).toBe(401);

      const createRes = await request(fixtureApp).post('/api/conversations').send({});
      expect(createRes.status).toBe(401);

      const streamRes = await fetchSseHeaders(fixtureApp, `/api/conversations/${convId}/stream`);
      expect(streamRes.status).toBe(401);

      const chatRes = await request(fixtureApp).post(`/api/conversations/${convId}/messages`).send({ content: 'hi' });
      expect(chatRes.status).toBe(401);
    });
  });
});
