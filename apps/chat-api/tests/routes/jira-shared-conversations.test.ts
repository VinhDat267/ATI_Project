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

async function fetchSseHeaders(
  app: any,
  path: string,
  token?: string,
  workspaceId?: string,
  timeoutMs = 2000
): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;

  return new Promise<{ status: number; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        req.destroy();
        server.close();
        reject(new Error(`fetchSseHeaders timeout after ${timeoutMs}ms for ${path}`));
      }
    }, timeoutMs);

    const headers: http.OutgoingHttpHeaders = { Accept: 'text/event-stream' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (workspaceId) headers['X-Workspace-Id'] = workspaceId;

    const req = http.request(
      { hostname: '127.0.0.1', port, path, method: 'GET', headers },
      (res) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          const result = { status: res.statusCode || 500, headers: res.headers };
          req.destroy();
          res.destroy();
          server.close(() => resolve(result));
        }
      }
    );

    req.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        server.close(() => reject(err));
      }
    });

    req.end();
  });
}

describe('apps/chat-api — JIRA-03 Shared Organization Workspace Conversations Routes & Access Control', () => {
  let ctx: IsolatedTestContext;
  let pool: pg.Pool;

  let rawUserRepo: UserRepo;
  let rawSessionRepo: SessionRepo;
  let rawConvRepo: ConversationRepo;
  let rawWorkspaceRepo: WorkspaceRepo;
  let rawMsgRepo: MessageRepo;
  let rawPlanRepo: PlanRepo;
  let sseManager: SSEManager;

  const jwtSecret = 'jira_shared_routes_secret_at_least_32_chars';

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

  let prodApp: ReturnType<typeof createApp>;
  let fixtureApp: ReturnType<typeof createApp>;
  let unavailApp: ReturnType<typeof createApp>;

  let alice: TestUser;   // Active in Org + Active in Jira
  let bob: TestUser;     // Active in Org ONLY (No Jira membership)
  let outsider: TestUser;// Not in Org

  let orgId: string;
  let otherOrgId: string;

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

  async function seedSharedWorkspace(name: string, slug: string, createdBy: string, jiraStatus = 'active'): Promise<string> {
    const wsId = randomUUID();
    // 1. Shared organization workspace (workspaces)
    await pool.query(
      `INSERT INTO workspaces (id, name, invite_code, require_approval, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, false, $4, clock_timestamp(), clock_timestamp())`,
      [wsId, name, `INV-${wsId.slice(0, 8)}`.toUpperCase(), createdBy]
    );

    // 2. Jira workspace policy extension (ati_workspaces)
    await pool.query(
      `INSERT INTO ati_workspaces (id, slug, status, version, created_by)
       VALUES ($1, $2, $3, 1, $4)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, updated_at = clock_timestamp()`,
      [wsId, slug, jiraStatus, createdBy]
    );

    return wsId;
  }

  async function seedOrgMembership(
    workspaceId: string,
    userId: string,
    role: 'admin' | 'member' = 'member',
    status: 'pending' | 'active' | 'disabled' = 'active'
  ): Promise<void> {
    await pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, clock_timestamp(), clock_timestamp())
       ON CONFLICT (workspace_id, user_id)
       DO UPDATE SET status = EXCLUDED.status, role = EXCLUDED.role, updated_at = clock_timestamp()`,
      [workspaceId, userId, role, status]
    );
  }

  async function seedJiraMembership(
    workspaceId: string,
    userId: string,
    role: 'admin' | 'member' = 'member',
    status: 'pending' | 'active' | 'rejected' | 'removed' = 'active'
  ): Promise<void> {
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
    title = 'Test Conversation',
    jiraContext = false
  ): Promise<string> {
    const mode = workspaceId ? 'organization' : 'legacy';
    const res = await pool.query<{ id: string }>(
      `INSERT INTO conversations (id, user_id, status, title, workspace_id, workspace_mode, jira_context)
       VALUES ($1, $2, 'chatting', $3, $4, $5, $6)
       RETURNING id`,
      [randomUUID(), userId, title, workspaceId, mode, jiraContext]
    );
    return firstRow(res).id;
  }

  async function seedMessage(convId: string, role = 'user', content = 'Hello world'): Promise<string> {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO messages (id, conv_id, role, content, metadata)
       VALUES ($1, $2, $3, $4, '{}')
       RETURNING id`,
      [randomUUID(), convId, role, content]
    );
    return firstRow(res).id;
  }

  async function seedPlan(convId: string): Promise<string> {
    const planJson = { steps: [{ id: 's1', tool: 'jira.search' }] };
    const res = await pool.query<{ id: string }>(
      `INSERT INTO plans (id, conv_id, plan_json, plan_hash, expires_at, status)
       VALUES ($1, $2, $3, 'plan-hash', clock_timestamp() + interval '1 hour', 'pending')
       RETURNING id`,
      [randomUUID(), convId, JSON.stringify(planJson)]
    );
    return firstRow(res).id;
  }

  async function seedScheduleProposal(convId: string): Promise<string> {
    const messageId = randomUUID();
    const proposal = {
      kind: 'schedule',
      action: 'create',
      name: 'Daily sync',
      request: 'Send daily summary',
      recurrence: { type: 'daily', time: '09:00' },
      summary: 'Daily sync at 9 AM',
    };
    await pool.query(
      `INSERT INTO messages (id, conv_id, role, content, metadata)
       VALUES ($1, $2, 'assistant', $3, $4)`,
      [messageId, convId, proposal.summary, JSON.stringify({ type: 'schedule_proposal', proposal })]
    );
    return messageId;
  }

  beforeAll(async () => {
    ctx = await createIsolatedTestSchema({ maxConnections: 12 });
    await ctx.runAllMigrations();
    pool = ctx.pool;

    rawUserRepo = new UserRepo(pool);
    rawSessionRepo = new SessionRepo(pool);
    rawConvRepo = new ConversationRepo(pool);
    rawWorkspaceRepo = new WorkspaceRepo(pool);
    rawMsgRepo = new MessageRepo(pool);
    rawPlanRepo = new PlanRepo(pool);
    sseManager = new SSEManager();

    alice = await createTestMember('Alice Dual Member', 'alice');
    bob = await createTestMember('Bob Org Member Only', 'bob');
    outsider = await createTestMember('Dave Outsider', 'dave');

    orgId = await seedSharedWorkspace('Shared Acme Corp', `acme-${randomUUID().slice(0, 8)}`, alice.id, 'active');
    otherOrgId = await seedSharedWorkspace('Shared Beta Corp', `beta-${randomUUID().slice(0, 8)}`, alice.id, 'active');

    // Alice: active org member + active Jira member
    await seedOrgMembership(orgId, alice.id, 'member', 'active');
    await seedJiraMembership(orgId, alice.id, 'member', 'active');
    await seedOrgMembership(otherOrgId, alice.id, 'member', 'active');

    // Bob: active org member ONLY (no Jira membership)
    await seedOrgMembership(orgId, bob.id, 'member', 'active');
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
      getPlanRepo: vi.fn().mockReturnValue(rawPlanRepo),
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
      userRepo: rawUserRepo,
      sessionRepo: rawSessionRepo,
      convRepo: rawConvRepo,
      workspaceRepo: rawWorkspaceRepo,
      msgRepo: rawMsgRepo,
      planRepo: rawPlanRepo,
      sseManager,
      chatService: chatServiceSpy as unknown as ChatService,
      executionService: executionServiceSpy as unknown as ExecutionService,
      schedules: {
        service: scheduleServiceSpy as unknown as ScheduleService,
        clock: () => new Date(),
      },
      pool,
    };

    // 1. Production App: default (enableWorkspaceConversations is false/omitted)
    prodApp = createApp({ ...baseOptions });

    // 2. Fixture App: internal test fixture (enableWorkspaceConversations: true)
    fixtureApp = createApp({ ...baseOptions, enableWorkspaceConversations: true });

    // 3. Unavailable Authority App: pool hidden
    unavailApp = createApp({
      ...baseOptions,
      pool: undefined,
      convRepo: hidePool(rawConvRepo),
      planRepo: hidePool(rawPlanRepo),
      enableWorkspaceConversations: true,
    });
  });

  // ==========================================================================
  // 1. Conversation Creation via Header & Body Opt-In
  // ==========================================================================
  describe('Conversation Creation (Header X-Workspace-Id & jiraContext Opt-In)', () => {
    it('creates an ordinary organization conversation requiring only generic workspace membership', async () => {
      // Bob is active in Org, but NOT in Jira
      const res = await request(prodApp)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${bob.token}`)
        .set('X-Workspace-Id', orgId)
        .send({});

      expect(res.status).toBe(201);
      expect(res.body.conversation).toBeDefined();
      expect(res.body.conversation.workspace_id).toBe(orgId);
      expect(res.body.conversation.workspace_mode).toBe('organization');
      expect(res.body.conversation.jira_context).toBeFalsy();
    });

    it('returns 503 by default when opt-in jiraContext: true is requested in production', async () => {
      // Alice is active in both, but prodApp lacks enableWorkspaceConversations
      const res = await request(prodApp)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${alice.token}`)
        .set('X-Workspace-Id', orgId)
        .send({ jiraContext: true });

      expect(res.status).toBe(503);
      expect(res.body.code).toBe('WORKSPACE_CONVERSATIONS_UNAVAILABLE');
    });

    it('rejects an object title that attempts to inject a Jira scope through the repository overload', async () => {
      const before = await pool.query<{ count: string }>('SELECT count(*) FROM conversations WHERE user_id=$1', [alice.id]);
      const response = await request(prodApp).post('/api/conversations')
        .set('Authorization', `Bearer ${alice.token}`).set('X-Workspace-Id', orgId)
        .send({ title: { workspaceMode: 'organization', workspaceId: orgId, jiraContext: true } });
      expect(response.status).toBe(400);
      const after = await pool.query<{ count: string }>('SELECT count(*) FROM conversations WHERE user_id=$1', [alice.id]);
      expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
    });

    it('rejects non-string titles without creating a conversation in another scope', async () => {
      const before = await pool.query<{ count: string }>('SELECT count(*) FROM conversations WHERE user_id=$1', [alice.id]);
      for (const title of [[], ['injected'], true, 42, { workspaceMode: 'personal' }]) {
        const response = await request(prodApp).post('/api/conversations')
          .set('Authorization', `Bearer ${alice.token}`).set('X-Workspace-Id', orgId).send({ title });
        expect(response.status).toBe(400);
      }
      const after = await pool.query<{ count: string }>('SELECT count(*) FROM conversations WHERE user_id=$1', [alice.id]);
      expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
    });

    it('creates an ordinary organization conversation with valid string title', async () => {
      const res = await request(prodApp)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${bob.token}`)
        .set('X-Workspace-Id', orgId)
        .send({ title: 'Sprint Retrospective' });

      expect(res.status).toBe(201);
      expect(res.body.conversation.title).toBe('Sprint Retrospective');
      expect(res.body.conversation.workspace_id).toBe(orgId);
      expect(res.body.conversation.workspace_mode).toBe('organization');
      expect(res.body.conversation.jira_context).toBeFalsy();
    });

    it('creates an untitled ordinary organization conversation when title is explicitly null', async () => {
      const res = await request(prodApp)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${bob.token}`)
        .set('X-Workspace-Id', orgId)
        .send({ title: null });

      expect(res.status).toBe(201);
      expect(res.body.conversation.title).toBeNull();
      expect(res.body.conversation.workspace_id).toBe(orgId);
      expect(res.body.conversation.workspace_mode).toBe('organization');
      expect(res.body.conversation.jira_context).toBeFalsy();
    });

    it('treats a string title containing JSON as a literal title string without interpreting it as scope', async () => {
      const jsonLikeTitle = '{"workspaceMode":"organization","jiraContext":true}';
      const res = await request(prodApp)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${bob.token}`)
        .set('X-Workspace-Id', orgId)
        .send({ title: jsonLikeTitle });

      expect(res.status).toBe(201);
      expect(res.body.conversation.title).toBe(jsonLikeTitle);
      expect(res.body.conversation.workspace_id).toBe(orgId);
      expect(res.body.conversation.workspace_mode).toBe('organization');
      expect(res.body.conversation.jira_context).toBeFalsy();
    });

    it('creates a Jira organization conversation when jiraContext: true and user has both active memberships under fixtureApp', async () => {
      // Alice is active in Org AND active in Jira, fixtureApp enables test flag
      const res = await request(fixtureApp)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${alice.token}`)
        .set('X-Workspace-Id', orgId)
        .send({ jiraContext: true });

      expect(res.status).toBe(201);
      expect(res.body.conversation).toBeDefined();
      expect(res.body.conversation.workspace_id).toBe(orgId);
      expect(res.body.conversation.workspace_mode).toBe('organization');
      expect(res.body.conversation.jira_context).toBe(true);
    });

    it('returns 404 (Hidden pattern) when jiraContext: true is requested by user without Jira membership', async () => {
      // Bob is active in Org, but NOT in Jira
      const res = await request(fixtureApp)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${bob.token}`)
        .set('X-Workspace-Id', orgId)
        .send({ jiraContext: true });

      expect(res.status).toBe(404);
    });

    it('rejects creation when body workspaceId mismatches header X-Workspace-Id', async () => {
      // Body workspaceId cannot override or mismatch header
      const res = await request(fixtureApp)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${alice.token}`)
        .set('X-Workspace-Id', orgId)
        .send({ workspaceId: otherOrgId, jiraContext: true });

      expect([400, 404]).toContain(res.status);
    });

    it('rejects jiraContext: true on personal or legacy workspace header', async () => {
      const resPersonal = await request(fixtureApp)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${alice.token}`)
        .set('X-Workspace-Id', 'personal')
        .send({ jiraContext: true });
      expect([400, 404]).toContain(resPersonal.status);

      const resLegacy = await request(fixtureApp)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${alice.token}`)
        .send({ jiraContext: true });
      expect([400, 404]).toContain(resLegacy.status);
    });
  });

  // ==========================================================================
  // 2. Access Control & Lifecycle Revocation Across All Endpoints
  // ==========================================================================
  describe('Entry Guards & Jira Revocation Lifecycle', () => {
    let scopedJiraConvId: string;
    let regularOrgConvId: string;
    let scopedPlanId: string;
    let scopedSchedMsgId: string;

    beforeEach(async () => {
      // Seed Alice's Jira conversation and regular org conversation
      scopedJiraConvId = await seedConversation(alice.id, orgId, 'Alice Jira Planning', true);
      regularOrgConvId = await seedConversation(alice.id, orgId, 'Alice Regular Org Sync', false);

      await seedMessage(scopedJiraConvId, 'user', 'Jira sprint discussion');
      scopedPlanId = await seedPlan(scopedJiraConvId);
      scopedSchedMsgId = await seedScheduleProposal(scopedJiraConvId);
    });

    it('allows active dual-member Alice access across conversation, stream, execution, and schedule routes', async () => {
      // Detail
      const getRes = await request(fixtureApp)
        .get(`/api/conversations/${scopedJiraConvId}`)
        .set('Authorization', `Bearer ${alice.token}`)
        .set('X-Workspace-Id', orgId);
      expect(getRes.status).toBe(200);

      // Latest messages
      const msgRes = await request(fixtureApp)
        .get(`/api/conversations/${scopedJiraConvId}/messages/latest`)
        .set('Authorization', `Bearer ${alice.token}`)
        .set('X-Workspace-Id', orgId);
      expect(msgRes.status).toBe(200);

      // Active plan
      const planRes = await request(fixtureApp)
        .get(`/api/conversations/${scopedJiraConvId}/plans/active`)
        .set('Authorization', `Bearer ${alice.token}`)
        .set('X-Workspace-Id', orgId);
      expect(planRes.status).toBe(200);

      // Chat post
      const chatRes = await request(fixtureApp)
        .post(`/api/conversations/${scopedJiraConvId}/messages`)
        .set('Authorization', `Bearer ${alice.token}`)
        .set('X-Workspace-Id', orgId)
        .send({ content: 'Planning update' });
      expect(chatRes.status).toBe(202);

      // SSE Stream
      const sseRes = await fetchSseHeaders(fixtureApp, `/api/conversations/${scopedJiraConvId}/stream`, alice.token, orgId);
      expect(sseRes.status).toBe(200);
      expect(sseRes.headers['content-type']).toMatch(/text\/event-stream/);

      // Plan approve
      const appRes = await request(fixtureApp)
        .post(`/api/plans/${scopedPlanId}/approve`)
        .set('Authorization', `Bearer ${alice.token}`)
        .set('X-Workspace-Id', orgId)
        .send({});
      expect(appRes.status).toBe(200);

      // Schedule confirm
      const schedRes = await request(fixtureApp)
        .post(`/api/conversations/${scopedJiraConvId}/schedule-proposals/${scopedSchedMsgId}/confirm`)
        .set('Authorization', `Bearer ${alice.token}`)
        .set('X-Workspace-Id', orgId)
        .send({});
      expect(schedRes.status).toBe(200);
    });

    it('revoking Jira membership denies Jira conversation across all endpoints (404) but preserves ordinary org conversation', async () => {
      // Revoke Alice's Jira membership ONLY (status = 'removed' in ati_workspace_memberships)
      await pool.query(
        `UPDATE ati_workspace_memberships SET status = 'removed', updated_at = clock_timestamp()
         WHERE workspace_id = $1 AND user_id = $2`,
        [orgId, alice.id]
      );
      // Alice REMAINS active in workspace_members (generic org)

      // 1. Jira conversation MUST fail closed with 404 (Hidden pattern)
      const getJira = await request(fixtureApp)
        .get(`/api/conversations/${scopedJiraConvId}`)
        .set('Authorization', `Bearer ${alice.token}`)
        .set('X-Workspace-Id', orgId);
      expect(getJira.status).toBe(404);

      const msgJira = await request(fixtureApp)
        .get(`/api/conversations/${scopedJiraConvId}/messages/latest`)
        .set('Authorization', `Bearer ${alice.token}`)
        .set('X-Workspace-Id', orgId);
      expect(msgJira.status).toBe(404);

      const planJira = await request(fixtureApp)
        .get(`/api/conversations/${scopedJiraConvId}/plans/active`)
        .set('Authorization', `Bearer ${alice.token}`)
        .set('X-Workspace-Id', orgId);
      expect(planJira.status).toBe(404);

      const chatJira = await request(fixtureApp)
        .post(`/api/conversations/${scopedJiraConvId}/messages`)
        .set('Authorization', `Bearer ${alice.token}`)
        .set('X-Workspace-Id', orgId)
        .send({ content: 'Attempt after Jira revoke' });
      expect(chatJira.status).toBe(404);
      expect(chatServiceSpy.handleUserMessage).not.toHaveBeenCalled();

      const sseJira = await fetchSseHeaders(fixtureApp, `/api/conversations/${scopedJiraConvId}/stream`, alice.token, orgId);
      expect(sseJira.status).toBe(404);
      expect(sseJira.headers['content-type']).not.toMatch(/text\/event-stream/);

      const approveJira = await request(fixtureApp)
        .post(`/api/plans/${scopedPlanId}/approve`)
        .set('Authorization', `Bearer ${alice.token}`)
        .set('X-Workspace-Id', orgId)
        .send({});
      expect(approveJira.status).toBe(404);
      expect(executionServiceSpy.approveAndStart).not.toHaveBeenCalled();

      const schedJira = await request(fixtureApp)
        .post(`/api/conversations/${scopedJiraConvId}/schedule-proposals/${scopedSchedMsgId}/confirm`)
        .set('Authorization', `Bearer ${alice.token}`)
        .set('X-Workspace-Id', orgId)
        .send({});
      expect(schedJira.status).toBe(404);
      expect(scheduleServiceSpy.confirmProposal).not.toHaveBeenCalled();

      // 2. Regular Org conversation MUST REMAIN accessible (200 / 202)
      const getReg = await request(fixtureApp)
        .get(`/api/conversations/${regularOrgConvId}`)
        .set('Authorization', `Bearer ${alice.token}`)
        .set('X-Workspace-Id', orgId);
      expect(getReg.status).toBe(200);

      const chatReg = await request(fixtureApp)
        .post(`/api/conversations/${regularOrgConvId}/messages`)
        .set('Authorization', `Bearer ${alice.token}`)
        .set('X-Workspace-Id', orgId)
        .send({ content: 'Regular org message still works' });
      expect(chatReg.status).toBe(202);

      const sseReg = await fetchSseHeaders(fixtureApp, `/api/conversations/${regularOrgConvId}/stream`, alice.token, orgId);
      expect(sseReg.status).toBe(200);
      expect(sseReg.headers['content-type']).toMatch(/text\/event-stream/);
    });

    it('rejects access when header X-Workspace-Id mismatches conversation workspace', async () => {
      // Requesting Jira conversation belonging to orgId with header of otherOrgId
      const res = await request(fixtureApp)
        .get(`/api/conversations/${scopedJiraConvId}`)
        .set('Authorization', `Bearer ${alice.token}`)
        .set('X-Workspace-Id', otherOrgId);

      expect(res.status).toBe(404);
    });
  });

  // ==========================================================================
  // 3. Unavailable Authority Checker Boundary (No PG Pool)
  // ==========================================================================
  describe('Authority Checker Unavailable Fail-Closed Boundary', () => {
    let unavailJiraConvId: string;
    let unavailRegConvId: string;
    let legacyConvId: string;

    beforeEach(async () => {
      unavailJiraConvId = await seedConversation(alice.id, orgId, 'Unavail Jira Conv', true);
      unavailRegConvId = await seedConversation(alice.id, orgId, 'Unavail Reg Conv', false);
      legacyConvId = await seedConversation(alice.id, null, 'Unavail Legacy Conv', false);
    });

    it('fails closed (404) on Jira and ordinary scoped conversations when authority pool is unavailable', async () => {
      const jiraRes = await request(unavailApp)
        .get(`/api/conversations/${unavailJiraConvId}`)
        .set('Authorization', `Bearer ${alice.token}`)
        .set('X-Workspace-Id', orgId);
      expect(jiraRes.status).toBe(404);

      const regRes = await request(unavailApp)
        .get(`/api/conversations/${unavailRegConvId}`)
        .set('Authorization', `Bearer ${alice.token}`)
        .set('X-Workspace-Id', orgId);
      expect(regRes.status).toBe(404);
    });

    it('preserves legacy NULL conversation access and denial semantics with unavailable authority pool', async () => {
      // Owner Alice accesses legacy conversation: 200
      const ownerRes = await request(unavailApp)
        .get(`/api/conversations/${legacyConvId}`)
        .set('Authorization', `Bearer ${alice.token}`);
      expect(ownerRes.status).toBe(200);

      // Non-owner Bob receives established legacy denial (403 or 404)
      const nonOwnerRes = await request(unavailApp)
        .get(`/api/conversations/${legacyConvId}`)
        .set('Authorization', `Bearer ${bob.token}`);
      expect([403, 404]).toContain(nonOwnerRes.status);
    });
  });
});
