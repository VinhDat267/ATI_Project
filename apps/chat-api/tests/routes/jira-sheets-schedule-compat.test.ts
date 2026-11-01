import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { createApp, type AppOptions } from '../../src/app.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { UserRepo } from '../../src/db/repositories/user-repo.js';
import { SessionRepo } from '../../src/db/repositories/session-repo.js';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import { WorkspaceRepo } from '../../src/db/repositories/workspace-repo.js';
import { MessageRepo } from '../../src/db/repositories/message-repo.js';
import type { ScheduleService } from '../../src/services/schedules/schedule-service.js';
import { createIsolatedTestSchema, createSyntheticUser, type IsolatedTestContext } from '../helpers/jira-test-db.js';

function firstRow<T extends pg.QueryResultRow>(res: pg.QueryResult<T>): T {
  const row = res.rows[0];
  if (!row) throw new Error('Expected query result to contain at least one row');
  return row;
}

interface TestUser {
  id: string;
  email: string;
  token: string;
}

describe('apps/chat-api — JIRA-03 & Sheets Schedule Route Composition & Stored ACL Compatibility', () => {
  let ctx: IsolatedTestContext;
  let pool: pg.Pool;

  let rawUserRepo: UserRepo;
  let rawSessionRepo: SessionRepo;
  let rawConvRepo: ConversationRepo;
  let rawWorkspaceRepo: WorkspaceRepo;
  let rawMsgRepo: MessageRepo;

  const jwtSecret = 'jira_sheets_schedule_compat_test_secret_32_chars';
  let confirmProposalSpy: ReturnType<typeof vi.fn>;
  let app: ReturnType<typeof createApp>;

  let alice: TestUser; // Active in Org + initially Active in Jira
  let bob: TestUser;   // Active in Org ONLY (No Jira membership)

  let orgId: string;
  let ordinaryOrgConvId: string;
  let jiraConvId: string;
  let bobMessageId: string;
  let aliceMessageId: string;

  async function createTestMember(name: string, prefix: string): Promise<TestUser> {
    const userId = await createSyntheticUser(pool, name, prefix, { role: 'member', status: 'active' });
    const userRow = await rawUserRepo.findById(userId);
    const email = userRow?.email ?? `${prefix}_${randomUUID().slice(0, 8)}@example.test`;
    const { sessionId } = await rawSessionRepo.create(userId, 'test-agent');
    const token = generateAccessToken({ id: userId, email, name, role: 'member', status: 'active' }, jwtSecret, sessionId).accessToken;
    return { id: userId, email, token };
  }

  async function seedSharedWorkspace(name: string, slug: string, createdBy: string): Promise<string> {
    const wsId = randomUUID();
    await pool.query(
      `INSERT INTO workspaces (id, name, invite_code, require_approval, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, false, $4, clock_timestamp(), clock_timestamp())`,
      [wsId, name, `INV-${wsId.slice(0, 8)}`.toUpperCase(), createdBy]
    );
    await pool.query(
      `INSERT INTO ati_workspaces (id, slug, status, version, created_by) VALUES ($1, $2, 'active', 1, $3)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, updated_at = clock_timestamp()`,
      [wsId, slug, createdBy]
    );
    return wsId;
  }

  async function seedConversation(userId: string, workspaceId: string, jiraContext = false): Promise<string> {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO conversations (id, user_id, status, title, workspace_id, workspace_mode, jira_context)
       VALUES ($1, $2, 'chatting', $3, $4, 'organization', $5) RETURNING id`,
      [randomUUID(), userId, jiraContext ? 'Jira Convo' : 'Org Convo', workspaceId, jiraContext]
    );
    return firstRow(res).id;
  }

  async function seedProposal(convId: string): Promise<string> {
    const msgId = randomUUID();
    const proposal = { kind: 'schedule', action: 'create', name: 'Weekly Digest', request: 'Send weekly digest', recurrence: { type: 'daily', time: '09:00' } };
    await pool.query(
      `INSERT INTO messages (id, conv_id, role, content, metadata) VALUES ($1, $2, 'assistant', 'Proposal', $3)`,
      [msgId, convId, JSON.stringify({ type: 'schedule_proposal', proposal })]
    );
    return msgId;
  }

  beforeAll(async () => {
    ctx = await createIsolatedTestSchema({ maxConnections: 8 });
    await ctx.runAllMigrations();
    pool = ctx.pool;

    rawUserRepo = new UserRepo(pool);
    rawSessionRepo = new SessionRepo(pool);
    rawConvRepo = new ConversationRepo(pool);
    rawWorkspaceRepo = new WorkspaceRepo(pool);
    rawMsgRepo = new MessageRepo(pool);

    alice = await createTestMember('Alice Dual Member', 'alice');
    bob = await createTestMember('Bob Org Member Only', 'bob');
    orgId = await seedSharedWorkspace('Shared Engineering', `eng-${randomUUID().slice(0, 8)}`, alice.id);

    // Generic org memberships: both Alice and Bob active
    await pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, status, created_at, updated_at)
       VALUES ($1, $2, 'member', 'active', clock_timestamp(), clock_timestamp()),
              ($1, $3, 'member', 'active', clock_timestamp(), clock_timestamp())`,
      [orgId, alice.id, bob.id]
    );

    // Jira layer: Alice active; Bob has no Jira membership
    await pool.query(
      `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version) VALUES ($1, $2, 'member', 'active', 1)`,
      [orgId, alice.id]
    );

    ordinaryOrgConvId = await seedConversation(bob.id, orgId, false);
    jiraConvId = await seedConversation(alice.id, orgId, true);
    bobMessageId = await seedProposal(ordinaryOrgConvId);
    aliceMessageId = await seedProposal(jiraConvId);
  });

  afterAll(async () => {
    await ctx?.cleanup();
  });

  beforeEach(() => {
    confirmProposalSpy = vi.fn().mockImplementation(async (input: any) => ({
      schedule: { id: randomUUID(), convId: input.convId, name: 'Weekly Digest', status: 'active', approvalMode: input.approvalMode ?? 'manual', version: 1 },
      convId: input.convId,
      state: null,
    }));

    const scheduleService = {
      confirmProposal: confirmProposalSpy,
      list: vi.fn().mockResolvedValue([]),
      pendingCount: vi.fn().mockResolvedValue(0),
      listRuns: vi.fn().mockResolvedValue([]),
    } as unknown as ScheduleService;

    const baseOptions: AppOptions = {
      jwtSecret,
      userRepo: rawUserRepo,
      sessionRepo: rawSessionRepo,
      convRepo: rawConvRepo,
      workspaceRepo: rawWorkspaceRepo,
      msgRepo: rawMsgRepo,
      pool,
      schedules: { service: scheduleService, clock: () => new Date() },
    };

    app = createApp(baseOptions);
  });

  it('confirms schedule on ordinary org convo (no Jira membership) with approvalMode auto_digest', async () => {
    const res = await request(app)
      .post(`/api/conversations/${ordinaryOrgConvId}/schedule-proposals/${bobMessageId}/confirm`)
      .set('Authorization', `Bearer ${bob.token}`)
      .set('X-Workspace-Id', orgId)
      .send({ approvalMode: 'auto_digest' });

    expect(res.status).toBe(200);
    expect(res.body.schedule).toBeDefined();
    expect(confirmProposalSpy).toHaveBeenCalledTimes(1);
    expect(confirmProposalSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: bob.id,
        convId: ordinaryOrgConvId,
        messageId: bobMessageId,
        scope: { workspaceMode: 'organization', workspaceId: orgId },
        approvalMode: 'auto_digest',
      })
    );
  });

  it('fails closed with 404 and does not call service when Jira membership is revoked, even with auto_digest', async () => {
    await pool.query(
      `UPDATE ati_workspace_memberships SET status = 'removed', updated_at = clock_timestamp() WHERE workspace_id = $1 AND user_id = $2`,
      [orgId, alice.id]
    );

    const res = await request(app)
      .post(`/api/conversations/${jiraConvId}/schedule-proposals/${aliceMessageId}/confirm`)
      .set('Authorization', `Bearer ${alice.token}`)
      .set('X-Workspace-Id', orgId)
      .send({ approvalMode: 'auto_digest' });

    expect(res.status).toBe(404);
    expect(confirmProposalSpy).not.toHaveBeenCalled();
  });

  it('returns 400 without invoking service when authorized active caller sends invalid approvalMode', async () => {
    const res = await request(app)
      .post(`/api/conversations/${ordinaryOrgConvId}/schedule-proposals/${bobMessageId}/confirm`)
      .set('Authorization', `Bearer ${bob.token}`)
      .set('X-Workspace-Id', orgId)
      .send({ approvalMode: 'invalid_mode' });

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('BAD_REQUEST');
    expect(confirmProposalSpy).not.toHaveBeenCalled();
  });

  it('fails closed with 404 BEFORE body error when caller with revoked Jira membership sends invalid approvalMode', async () => {
    // Alice's Jira membership was revoked in the earlier test
    const res = await request(app)
      .post(`/api/conversations/${jiraConvId}/schedule-proposals/${aliceMessageId}/confirm`)
      .set('Authorization', `Bearer ${alice.token}`)
      .set('X-Workspace-Id', orgId)
      .send({ approvalMode: 'completely_bogus_mode' });

    // Must be 404 due to private precedence: access check runs before body validation
    expect(res.status).toBe(404);
    expect(confirmProposalSpy).not.toHaveBeenCalled();
  });

  it('returns 403 without side effects when generic org membership is disabled', async () => {
    await pool.query(
      `UPDATE workspace_members SET status = 'disabled', updated_at = clock_timestamp() WHERE workspace_id = $1 AND user_id = $2`,
      [orgId, bob.id]
    );

    const res = await request(app)
      .post(`/api/conversations/${ordinaryOrgConvId}/schedule-proposals/${bobMessageId}/confirm`)
      .set('Authorization', `Bearer ${bob.token}`)
      .set('X-Workspace-Id', orgId)
      .send({ approvalMode: 'auto_digest' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('WORKSPACE_MEMBER_DISABLED');
    expect(confirmProposalSpy).not.toHaveBeenCalled();
  });
});
