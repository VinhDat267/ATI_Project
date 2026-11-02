import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { ScheduleResponse, ScheduleProposalMetadata } from '@wap/tool-schemas';
import {
  createIsolatedTestSchema,
  createSyntheticUser,
  type IsolatedTestContext,
} from '../../helpers/jira-test-db.js';
import { ChatService } from '../../../src/services/chat-service.js';
import { MessageRepo } from '../../../src/db/repositories/message-repo.js';
import { ConversationRepo } from '../../../src/db/repositories/conversation-repo.js';
import { PlanRepo } from '../../../src/db/repositories/plan-repo.js';
import { ScheduleRepo } from '../../../src/db/repositories/schedule-repo.js';
import { ScheduleService, ScheduleConflict } from '../../../src/services/schedules/schedule-service.js';
import { AdapterFactory } from '../../../src/services/adapter-factory.js';
import { StepError } from '@wap/tool-adapters';
import { createApp } from '../../../src/app.js';
import { UserRepo } from '../../../src/db/repositories/user-repo.js';
import { SessionRepo } from '../../../src/db/repositories/session-repo.js';
import { WorkspaceRepo } from '../../../src/db/repositories/workspace-repo.js';
import { generateAccessToken } from '../../../src/auth/jwt.js';

process.env.JWT_SECRET = '01234567890123456789012345678901_jwt_secret';
process.env.ENCRYPTION_KEY = 'a'.repeat(32);

describe('JIRA-08 Task 6: Schedule Refusal and Production Opt-In Gates', () => {
  let ctx: IsolatedTestContext;
  let pool: pg.Pool;
  let userId: string;
  let workspaceId: string;
  let convId: string;

  beforeAll(async () => {
    ctx = await createIsolatedTestSchema();
    await ctx.runAllMigrations();
    pool = ctx.pool;

    userId = await createSyntheticUser(pool, 'Schedule User', 'sched_user');
    workspaceId = randomUUID();
    const inviteCode = `ATI-${randomUUID().slice(0, 4)}-${randomUUID().slice(0, 4)}`.toUpperCase();

    await pool.query(
      `INSERT INTO workspaces (id, name, invite_code, require_approval, created_by)
       VALUES ($1, 'Schedule Workspace', $2, true, $3)`,
      [workspaceId, inviteCode, userId]
    );
    await pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, status)
       VALUES ($1, $2, 'admin', 'active')`,
      [workspaceId, userId]
    );
    await pool.query(
      `INSERT INTO ati_workspaces (id, slug, status, version, created_by)
       VALUES ($1, $2, 'active', 1, $3)`,
      [workspaceId, `ws-${randomUUID().slice(0, 8)}`, userId]
    );
    await pool.query(
      `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version)
       VALUES ($1, $2, 'admin', 'active', 1)`,
      [workspaceId, userId]
    );

    const convRes = await pool.query<{ id: string }>(
      `INSERT INTO conversations (user_id, workspace_id, workspace_mode, jira_context, title, status)
       VALUES ($1, $2, 'organization', true, 'Schedule Conversation', 'chatting')
       RETURNING id`,
      [userId, workspaceId]
    );
    convId = convRes.rows[0]!.id;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  // =========================================================================
  // 1. Refuse Schedule Proposal with myjira
  // =========================================================================
  it('rejects new schedule proposals containing myjira', async () => {
    const msgRepo = new MessageRepo(pool);
    const convRepo = new ConversationRepo(pool);
    const planRepo = new PlanRepo(pool);
    const scheduleRepo = new ScheduleRepo(pool, 'Asia/Ho_Chi_Minh');

    const mockPlanner = {
      routeSchedule: vi.fn(async () => ({
        services: ['myjira'],
        unavailable: [],
      })),
      processMessage: vi.fn(),
    };

    const chatService = new ChatService({
      msgRepo,
      convRepo,
      planRepo,
      planner: mockPlanner as any,
      eventEmitter: { emit: () => {} },
      schedules: {
        repo: scheduleRepo,
        timeZone: 'Asia/Ho_Chi_Minh',
      },
    });

    const proposal: ScheduleResponse = {
      kind: 'schedule',
      action: 'create',
      name: 'Daily Jira Ticket Creation',
      request: 'Mỗi ngày lúc 9h sáng tạo ticket myjira trong project GRD',
      recurrence: { type: 'daily', time: '09:00' },
      summary: 'Tạo ticket myjira hàng ngày',
    };

    // Call prepareResponse directly through handleUserMessage or prepareResponse
    const memory = { toJSON: () => ({}) } as any;
    const actor = { userId, workspaceId, workspaceMode: 'organization' as const };
    const prepared = await (chatService as any).prepareResponse(
      { conversationId: convId, userId, correlation: {} },
      proposal,
      memory,
      ['Mỗi ngày lúc 9h sáng tạo ticket myjira trong project GRD']
    );

    // Write the prepared response
    await prepared.write();

    // The message saved in DB must be a refusal, NOT a schedule_proposal
    const messages = await msgRepo.listMessages(convId);
    const lastMsg = messages[messages.length - 1];
    expect(lastMsg).toBeDefined();
    expect(lastMsg!.role).toBe('assistant');
    expect(lastMsg!.content).toContain('Từ chối yêu cầu: Tính năng lịch tự động chưa hỗ trợ tích hợp Jira cá nhân (myjira).');
    expect(lastMsg!.metadata).toMatchObject({
      type: 'refusal',
    });
  });

  // =========================================================================
  // 2. Refuse Confirming Schedule Proposal with myjira
  // =========================================================================
  it('rejects confirmation of any proposal that contains myjira', async () => {
    const msgRepo = new MessageRepo(pool);
    const scheduleService = new ScheduleService({ pool, timeZone: 'Asia/Ho_Chi_Minh' });

    // Seed a malicious or synthetic schedule proposal containing myjira
    const proposalMeta: ScheduleProposalMetadata = {
      type: 'schedule_proposal',
      proposal: {
        kind: 'schedule',
        action: 'create',
        name: 'Spoofed Jira Schedule',
        request: 'Create myjira task daily',
        recurrence: { type: 'daily', time: '08:00' },
        summary: 'Daily Jira Spoof',
      },
      services: ['myjira'],
      nextRuns: [new Date().toISOString()],
      scheduleId: null,
      baseVersion: null,
      previous: null,
    };

    const msg = await msgRepo.createMessage(convId, 'assistant', 'Daily Jira Spoof', proposalMeta as any);

    await expect(
      scheduleService.confirmProposal({
        userId,
        convId,
        messageId: msg.id,
        now: new Date(),
        scope: { workspaceMode: 'organization', workspaceId },
      })
    ).rejects.toThrow(/Lịch tự động không hỗ trợ Jira cá nhân \(myjira\)/i);
  });

  // =========================================================================
  // 3. Reject Scheduler Execution without Actor or Workspace
  // =========================================================================
  it('rejects scheduler execution without valid actor or workspace, or when containing myjira', async () => {
    const msgRepo = new MessageRepo(pool);
    const convRepo = new ConversationRepo(pool);
    const planRepo = new PlanRepo(pool);
    const scheduleRepo = new ScheduleRepo(pool, 'Asia/Ho_Chi_Minh');

    const chatService = new ChatService({
      msgRepo,
      convRepo,
      planRepo,
      planner: { processMessage: vi.fn() } as any,
      eventEmitter: { emit: () => {} },
      schedules: {
        repo: scheduleRepo,
        timeZone: 'Asia/Ho_Chi_Minh',
      },
    });

    const signal = new AbortController().signal;

    // A: Lacking workspaceId in organization mode
    const runMissingWorkspace = {
      runId: randomUUID(),
      scheduleId: randomUUID(),
      scheduleVersion: 1,
      userId,
      name: 'Test Run',
      request: 'Run step',
      dueAt: new Date(),
      trigger: 'scheduled' as const,
      workspaceId: null,
      workspaceMode: 'organization' as const,
    };

    await expect(
      chatService.planScheduledRun(runMissingWorkspace, convId, signal)
    ).rejects.toThrow(/Scheduler execution requires valid actor and workspace/i);

    // B: Specifying myjira
    const runWithMyJira = {
      ...runMissingWorkspace,
      workspaceId,
      services: ['myjira'],
    };

    await expect(
      chatService.planScheduledRun(runWithMyJira as any, convId, signal)
    ).rejects.toThrow(/Scheduled runs do not support personal Jira \(myjira\)/i);
  });

  // =========================================================================
  // 4. Refuse Legacy jira.* Fallback in Personal Context
  // =========================================================================
  it('refuses legacy jira.* fallback in personal workspace context across planner and adapter', async () => {
    const msgRepo = new MessageRepo(pool);
    const convRepo = new ConversationRepo(pool);
    const planRepo = new PlanRepo(pool);
    const scheduleRepo = new ScheduleRepo(pool, 'Asia/Ho_Chi_Minh');

    const mockPlanner = {
      routeSchedule: vi.fn(async () => ({
        services: ['jira'],
        unavailable: [],
      })),
      processMessage: vi.fn(),
    };

    const chatService = new ChatService({
      msgRepo,
      convRepo,
      planRepo,
      planner: mockPlanner as any,
      eventEmitter: { emit: () => {} },
      schedules: {
        repo: scheduleRepo,
        timeZone: 'Asia/Ho_Chi_Minh',
      },
    });

    // In personal context, proposing legacy jira schedule is refused
    const personalConvRes = await pool.query<{ id: string }>(
      `INSERT INTO conversations (user_id, workspace_mode, title, status)
       VALUES ($1, 'personal', 'Personal Conv', 'chatting')
       RETURNING id`,
      [userId]
    );
    const personalConvId = personalConvRes.rows[0]!.id;

    const proposal: ScheduleResponse = {
      kind: 'schedule',
      action: 'create',
      name: 'Legacy Jira in Personal Context',
      request: 'Mỗi tuần đọc ticket jira chung',
      recurrence: { type: 'weekly', time: '10:00', days: [1] },
      summary: 'Legacy Jira Schedule',
    };

    const prepared = await (chatService as any).prepareResponse(
      { conversationId: personalConvId, userId, correlation: {} },
      proposal,
      { toJSON: () => ({}) },
      ['Mỗi tuần đọc ticket jira chung']
    );

    await prepared.write();
    const msgs = await msgRepo.listMessages(personalConvId);
    const lastMsg = msgs[msgs.length - 1];
    expect(lastMsg).toBeDefined();
    expect(lastMsg!.content).toContain('Dịch vụ Jira chung (jira) không khả dụng ở không gian cá nhân');

    // Also verify AdapterFactory rejects legacy 'jira' in personal context
    const adapterFactory = new AdapterFactory({
      credentialRepo: {} as any,
      encryptionKey: 'a'.repeat(32),
    });

    await expect(
      adapterFactory.getAdapterForService('jira', { phase: 'planning', workspaceMode: 'personal', userId })
    ).rejects.toThrow(StepError);
  });

  // =========================================================================
  // 5. Read-Only Inventory Check for Existing Jira Schedules
  // =========================================================================
  it('executes read-only inventory query for legacy Jira schedules without mutation', async () => {
    const inventoryQuery = `SELECT id, name, user_id, status, services, workspace_id, workspace_mode, created_at FROM schedules WHERE 'jira' = ANY(services) OR 'myjira' = ANY(services);`;
    const res = await pool.query(inventoryQuery);
    expect(res.rows).toBeInstanceOf(Array);
    // Verified 0 rows exist currently in test/clean environment
    expect(res.rows.length).toBe(0);
  });

  // =========================================================================
  // 6. Production Opt-In Gate: jiraContext Behind MYJIRA_ENABLED
  // =========================================================================
  it('enforces production gate: jiraContext: true returns 503 when flag is off, succeeds when on', async () => {
    const jwtSecret = '01234567890123456789012345678901_jwt_secret';
    const sessionRepo = new SessionRepo(pool);
    const { sessionId } = await sessionRepo.create(userId, 'gate-test-agent');
    const { accessToken: token } = generateAccessToken(
      { id: userId, email: 'user@example.test', name: 'User', role: 'admin', status: 'active' },
      jwtSecret,
      sessionId
    );

    const baseOptions = {
      pool,
      userRepo: new UserRepo(pool),
      sessionRepo,
      workspaceRepo: new WorkspaceRepo(pool),
      convRepo: new ConversationRepo(pool),
      msgRepo: new MessageRepo(pool),
      planRepo: new PlanRepo(pool),
      chatService: {} as any,
      jwtSecret,
    };

    // A: Production app with enableWorkspaceConversations: false (MYJIRA_ENABLED off)
    const prodApp = createApp({
      ...baseOptions,
      enableWorkspaceConversations: false,
    });

    const resBlocked = await request(prodApp)
      .post('/api/conversations')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Workspace-Id', workspaceId)
      .send({ title: 'Gated Conv', jiraContext: true });

    expect(resBlocked.status).toBe(503);
    expect(resBlocked.body.code).toBe('WORKSPACE_CONVERSATIONS_UNAVAILABLE');

    // B: Production app with enableWorkspaceConversations: true (MYJIRA_ENABLED on + configured)
    const enabledApp = createApp({
      ...baseOptions,
      enableWorkspaceConversations: true,
    });

    const resAllowed = await request(enabledApp)
      .post('/api/conversations')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Workspace-Id', workspaceId)
      .send({ title: 'Allowed Conv', jiraContext: true });

    expect(resAllowed.status).toBe(201);
    expect(resAllowed.body.conversation.jira_context).toBe(true);
  });
});
