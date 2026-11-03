import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  evaluateJiraDigestCandidate,
  computeJiraDigestConfigHash,
  type JiraDigestConfig,
} from '../../../src/services/schedules/jira-digest-candidate.js';
import {
  analyzeJiraDigestIssues,
  formatJiraDigestReport,
  runJiraDigest,
} from '../../../src/services/schedules/jira-digest-runner.js';
import { ChatService } from '../../../src/services/chat-service.js';
import { MessageRepo } from '../../../src/db/repositories/message-repo.js';
import { ConversationRepo } from '../../../src/db/repositories/conversation-repo.js';
import { PlanRepo } from '../../../src/db/repositories/plan-repo.js';
import { ScheduleRepo } from '../../../src/db/repositories/schedule-repo.js';
import { ScheduleService } from '../../../src/services/schedules/schedule-service.js';
import { createIsolatedTestSchema, createSyntheticUser } from '../../helpers/jira-test-db.js';

describe('Jira Read-Only Standup Digest (Phase 3)', () => {
  const recurrence = { type: 'daily' as const, time: '08:30' };

  it('approves read-only myjira -> slack digest candidate when connected and channel matched', async () => {
    const candidate = await evaluateJiraDigestCandidate({
      userId: 'user-1',
      workspaceId: 'ws-1',
      request: 'Mỗi sáng 8h30 tổng hợp tiến độ và blocker Jira dự án ATI gửi vào kênh #standup',
      services: ['myjira', 'slack'],
      recurrence,
      jiraConnection: async () => ({
        status: 'connected',
        workspaceId: 'ws-1',
        grantId: 'grant-1',
        atlassianAccountId: 'acc-1',
        projects: [{ siteId: 'site-1', siteName: 'Acme Jira', projectKey: 'ATI', projectName: 'ATI Platform' }],
      }),
      getAdapter: async () => ({
        execute: vi.fn(async () => [{ id: 'C12345', name: 'standup' }]),
      }),
    });

    expect(candidate.canAutoDigest).toBe(true);
    expect(candidate.config?.workspaceId).toBe('ws-1');
    expect(candidate.config?.projects).toEqual([
      { siteId: 'site-1', siteName: 'Acme Jira', projectKey: 'ATI', projectName: 'ATI Platform' },
    ]);
    expect(candidate.config?.channelId).toBe('C12345');
    expect(candidate.configHash).toBeTruthy();
  });

  it('rejects write-intent requests from becoming auto-digest schedules', async () => {
    const candidate = await evaluateJiraDigestCandidate({
      userId: 'user-1',
      workspaceId: 'ws-1',
      request: 'Mỗi sáng 8h30 tạo issue mới trên Jira dự án ATI và báo kênh #standup',
      services: ['myjira', 'slack'],
      recurrence,
      jiraConnection: async () => ({
        status: 'connected',
        workspaceId: 'ws-1',
        grantId: 'grant-1',
        atlassianAccountId: 'acc-1',
        projects: [{ siteId: 'site-1', siteName: 'Acme Jira', projectKey: 'ATI' }],
      }),
    });

    expect(candidate.canAutoDigest).toBe(false);
    expect(candidate.disabledReason).toContain('chỉ đọc');
  });

  it('categorizes Blocker/High Priority, In Progress, and Done issues and executes read-only digest delivery', async () => {
    const config: JiraDigestConfig = {
      workspaceId: 'ws-1',
      grantId: 'grant-1',
      atlassianAccountId: 'acc-1',
      projects: [{ siteId: 'site-1', siteName: 'Acme Jira', projectKey: 'ATI', projectName: 'ATI Platform' }],
      channelId: 'C12345',
      channelName: 'standup',
    };
    const configHash = computeJiraDigestConfigHash({
      config,
      recurrence,
      userId: 'user-1',
    });

    const slackExecute = vi.fn(async () => ({ ok: true }));
    const jiraExecute = vi.fn(async () => [
      {
        key: 'ATI-10',
        summary: 'Done setup task',
        status: 'Done',
        priority: 'Low',
        url: 'https://acme.atlassian.net/browse/ATI-10',
      },
      {
        key: 'ATI-11',
        summary: 'Payment gateway timeout P1',
        status: 'Blocked',
        priority: 'Highest',
        assignee: 'Minh Nguyen',
        url: 'https://acme.atlassian.net/browse/ATI-11',
      },
      {
        key: 'ATI-12',
        summary: 'Implement transition tool',
        status: 'In Progress',
        priority: 'Medium',
        assignee: 'Lan Tran',
        url: 'https://acme.atlassian.net/browse/ATI-12',
      },
    ]);

    const outcome = await runJiraDigest({
      userId: 'user-1',
      recurrence,
      digestConfig: config,
      digestConfigHash: configHash,
      revalidatePolicy: async () => ({ allowed: true }),
      getAdapter: async (service) => ({
        execute: service === 'myjira' ? jiraExecute : slackExecute,
      }),
    });

    expect(outcome.state).toBe('digest_sent');
    if (outcome.state === 'digest_sent') {
      expect(outcome.text).toContain('🚨 1 ưu tiên cao/chặn');
      expect(outcome.text).toContain('🔄 1 đang làm');
      expect(outcome.text).toContain('✅ 1 hoàn thành');
      // Blocker ATI-11 should be sorted before Done ATI-10
      expect(outcome.text.indexOf('ATI-11')).toBeLessThan(outcome.text.indexOf('ATI-10'));
    }
    expect(jiraExecute).toHaveBeenCalledWith(
      'myjira.search_issues',
      { siteId: 'site-1', projectKey: 'ATI', maxResults: 20 },
      { signal: undefined },
    );
    expect(slackExecute).toHaveBeenCalledWith(
      'slack.send_message',
      expect.objectContaining({ channel: 'C12345' }),
      { signal: undefined },
    );
  });

  it('blocks digest execution when live Jira policy revalidation fails', async () => {
    const config: JiraDigestConfig = {
      workspaceId: 'ws-1',
      grantId: 'grant-1',
      atlassianAccountId: 'acc-1',
      projects: [{ siteId: 'site-1', siteName: 'Acme Jira', projectKey: 'ATI' }],
      channelId: 'C12345',
      channelName: 'standup',
    };
    const configHash = computeJiraDigestConfigHash({
      config,
      recurrence,
      userId: 'user-1',
    });

    const outcome = await runJiraDigest({
      userId: 'user-1',
      recurrence,
      digestConfig: config,
      digestConfigHash: configHash,
      revalidatePolicy: async () => ({ allowed: false, reason: 'Grant revoked by user' }),
      getAdapter: vi.fn(),
    });

    expect(outcome).toEqual({
      state: 'blocked',
      error: 'Grant revoked by user',
    });
  });

  it('persists and confirms myjira_digest schedule end-to-end via ChatService and ScheduleService in PostgreSQL', async () => {
    const ctx = await createIsolatedTestSchema();
    try {
      await ctx.runAllMigrations();
      const pool = ctx.pool;
      const userId = await createSyntheticUser(pool, 'Digest Lead', 'digest_lead');
      const workspaceId = randomUUID();
      const inviteCode = `ATI-${randomUUID().slice(0, 4)}-${randomUUID().slice(0, 4)}`.toUpperCase();

      await pool.query(
        `INSERT INTO workspaces (id, name, invite_code, require_approval, created_by)
         VALUES ($1, 'Digest Workspace', $2, true, $3)`,
        [workspaceId, inviteCode, userId],
      );
      await pool.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, status)
         VALUES ($1, $2, 'admin', 'active')`,
        [workspaceId, userId],
      );
      await pool.query(
        `INSERT INTO ati_workspaces (id, slug, status, version, created_by)
         VALUES ($1, $2, 'active', 1, $3)`,
        [workspaceId, `ws-${randomUUID().slice(0, 8)}`, userId],
      );
      await pool.query(
        `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version)
         VALUES ($1, $2, 'admin', 'active', 1)`,
        [workspaceId, userId],
      );

      const convRes = await pool.query<{ id: string }>(
        `INSERT INTO conversations (user_id, workspace_id, workspace_mode, jira_context, title, status)
         VALUES ($1, $2, 'organization', true, 'Standup Digest Conv', 'chatting')
         RETURNING id`,
        [userId, workspaceId],
      );
      const convId = convRes.rows[0]!.id;

      const msgRepo = new MessageRepo(pool);
      const convRepo = new ConversationRepo(pool);
      const planRepo = new PlanRepo(pool);
      const scheduleRepo = new ScheduleRepo(pool, 'Asia/Ho_Chi_Minh');
      const scheduleService = new ScheduleService({ pool, timeZone: 'Asia/Ho_Chi_Minh' });

      const chatService = new ChatService({
        msgRepo,
        convRepo,
        planRepo,
        planner: {
          routeSchedule: vi.fn(async () => ({ services: ['myjira', 'slack'], unavailable: [] })),
          processMessage: vi.fn(),
        } as any,
        eventEmitter: { emit: () => {} },
        myjiraDigestConnection: async () => ({
          status: 'connected',
          workspaceId,
          grantId: 'grant-db-1',
          atlassianAccountId: 'atl-acc-1',
          projects: [
            { siteId: 'site-1', siteName: 'Acme Jira', projectKey: 'ATI', projectName: 'ATI Platform' },
          ],
        }),
        getAdapter: async () => ({
          execute: vi.fn(async () => [{ id: 'C12345', name: 'standup-eng' }]),
        }),
        schedules: {
          repo: scheduleRepo,
          timeZone: 'Asia/Ho_Chi_Minh',
        },
      });

      const prepared = await (chatService as any).prepareResponse(
        { conversationId: convId, userId, correlation: {} },
        {
          kind: 'schedule',
          action: 'create',
          name: 'Standup Jira Hàng Ngày',
          request: 'Mỗi sáng 8h30 tổng hợp tiến độ và blocker Jira dự án ATI gửi vào kênh #standup-eng',
          recurrence: { type: 'daily', time: '08:30' },
          summary: 'Bản tin Standup Jira',
        },
        { toJSON: () => ({}) },
        ['Mỗi sáng 8h30 tổng hợp tiến độ và blocker Jira dự án ATI gửi vào kênh #standup-eng'],
      );
      await prepared.write();

      const msgs = await msgRepo.listMessages(convId);
      const proposalMsg = msgs[msgs.length - 1]!;
      expect(proposalMsg.metadata?.type).toBe('schedule_proposal');
      expect((proposalMsg.metadata as any).digestCandidate?.canAutoDigest).toBe(true);

      const change = await scheduleService.confirmProposal({
        userId,
        convId,
        messageId: proposalMsg.id,
        now: new Date(),
        scope: { workspaceMode: 'organization', workspaceId },
        approvalMode: 'auto_digest',
      });

      expect(change.schedule.kind).toBe('myjira_digest');
      expect(change.schedule.approvalMode).toBe('auto_digest');
      expect((change.schedule.digest as any)?.config?.projects?.[0]?.projectKey).toBe('ATI');
    } finally {
      await ctx.cleanup();
    }
  }, 20000);
});
