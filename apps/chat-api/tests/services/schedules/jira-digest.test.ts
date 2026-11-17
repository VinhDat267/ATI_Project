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
import { ScheduleRunner } from '../../../src/services/schedules/schedule-runner.js';
import {
  createJiraDigestExecutor,
  JIRA_READ_UNAVAILABLE,
  MYJIRA_DELIVERY_UNKNOWN,
} from '../../../src/services/schedules/jira-digest-runner.js';
import {
  evaluateTelegramDigestCandidate,
  computeTelegramDigestConfigHash,
} from '../../../src/services/schedules/telegram-digest-candidate.js';
import { TelegramDigestRunner } from '../../../src/services/schedules/telegram-digest-runner.js';
import { CredentialRepo } from '../../../src/db/repositories/credential-repo.js';
import { encryptCredentials } from '@wap/tool-adapters';
import {
  createIsolatedTestSchema,
  createSyntheticUser,
  connectSyntheticJiraAccount,
} from '../../helpers/jira-test-db.js';

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
      { siteId: 'site-1', projectKey: 'ATI', limit: 20 },
      { signal: undefined },
    );
    expect(slackExecute).toHaveBeenCalledWith(
      'slack.send_message',
      expect.objectContaining({ channel: 'C12345' }),
      { signal: undefined },
    );
  });

  it('AUD-W2-01: supports { issues: [...] } response shape and title field from myjira.search_issues', async () => {
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

    const jiraExecute = vi.fn(async () => ({
      issues: [
        {
          key: 'ATI-99',
          title: 'Schema-compliant issue title',
          status: 'In Progress',
          priority: 'High',
          url: 'https://acme.atlassian.net/browse/ATI-99',
        },
      ],
    }));
    const slackExecute = vi.fn(async () => ({ ok: true }));

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
      expect(outcome.text).toContain('ATI-99');
      expect(outcome.text).toContain('Schema-compliant issue title');
    }
    expect(jiraExecute).toHaveBeenCalledWith(
      'myjira.search_issues',
      { siteId: 'site-1', projectKey: 'ATI', limit: 20 },
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

  it('persists, executes, handles AI fallback, transient outages, unknown delivery, and resume in PostgreSQL', async () => {
    const ctx = await createIsolatedTestSchema();
    try {
      await ctx.runAllMigrations();
      const pool = ctx.pool;
      const userId = await createSyntheticUser(pool, 'Digest Lead', 'digest_lead');
      const atlassianAccountId = `atl-acc-${randomUUID().slice(0, 8)}`;
      const accountId = await connectSyntheticJiraAccount(pool, userId, atlassianAccountId);
      const workspaceId = randomUUID();
      const cloudId = `cloud-${randomUUID().slice(0, 8)}`;
      const inviteCode = `ATI-${randomUUID().slice(0, 4)}-${randomUUID().slice(0, 4)}`.toUpperCase();

      const grantRes = await pool.query<{ id: string }>(
        `INSERT INTO jira_oauth_grants (
           account_id, app_client_id, grant_kind, refresh_state, status, scopes, token_version
         ) VALUES ($1, 'atlassian_3lo', '3lo', 'idle', 'active', $2, 1) RETURNING id`,
        [accountId, ['read:me', 'read:jira-work', 'write:jira-work', 'offline_access']],
      );
      const grantId = grantRes.rows[0]!.id;
      await pool.query(
        `INSERT INTO jira_grant_sites (grant_id, cloud_id, site_name, site_url, product_type, scopes, last_verified_at)
         VALUES ($1, $2, 'Acme Jira', 'https://acme.atlassian.net', 'jira', $3, clock_timestamp())`,
        [grantId, cloudId, ['read:jira-work', 'write:jira-work']],
      );

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
      const siteRes = await pool.query<{ id: string }>(
        `INSERT INTO ati_workspace_jira_sites (
           workspace_id, cloud_id, site_name, site_url, active, policy_version, linked_by, verified_admin_by, admin_verified_at
         ) VALUES ($1, $2, 'Acme Jira', 'https://acme.atlassian.net', true, 1, $3, $3, clock_timestamp()) RETURNING id`,
        [workspaceId, cloudId, userId],
      );
      const siteId = siteRes.rows[0]!.id;
      await pool.query(
        `INSERT INTO ati_workspace_jira_projects (workspace_id, site_id, cloud_id, numeric_project_id, project_key, project_name, selected, policy_version)
         VALUES ($1, $2, $3, '10001', 'ATI', 'ATI Platform', true, 1)`,
        [workspaceId, siteId, cloudId],
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

      const liveJiraConnection = async () => ({
        status: 'connected' as const,
        workspaceId,
        grantId,
        atlassianAccountId,
        projects: [{ siteId, siteName: 'Acme Jira', projectKey: 'ATI', projectName: 'ATI Platform' }],
      });

      const chatService = new ChatService({
        msgRepo,
        convRepo,
        planRepo,
        jiraLlmEgressEnabled: true,
        planner: {
          routeSchedule: vi.fn(async () => ({ services: ['myjira', 'slack'], unavailable: [] })),
          processMessage: vi.fn(),
        } as any,
        eventEmitter: { emit: () => {} },
        myjiraDigestConnection: liveJiraConnection,
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

      const confirmedAt = new Date('2026-11-16T01:00:00Z');
      const change = await scheduleService.confirmProposal({
        userId,
        convId,
        messageId: proposalMsg.id,
        now: confirmedAt,
        scope: { workspaceMode: 'organization', workspaceId },
        approvalMode: 'auto_digest',
        includeAiSummary: true,
      });

      expect(change.schedule.kind).toBe('myjira_digest');
      expect(change.schedule.approvalMode).toBe('auto_digest');
      expect((change.schedule.digest as any)?.config?.projects?.[0]?.projectKey).toBe('ATI');

      // Run 1: Execute via createJiraDigestExecutor + ScheduleRunner (hallucinated AI number falls back cleanly!)
      let clockNow = new Date('2026-11-16T01:35:00Z');
      let slackMode: 'ok' | 'unknown' = 'ok';
      const slackSentTexts: string[] = [];
      const executor = createJiraDigestExecutor({
        pool,
        timeZone: 'Asia/Ho_Chi_Minh',
        now: () => clockNow,
        jiraConnection: liveJiraConnection,
        summarizeDigest: async () => 'Có 9999 issue đang lỗi nặng 100% toàn bộ dự án.',
        getAdapter: async (svc) => {
          if (svc === 'myjira') {
            return {
              execute: async () => ({
                issues: [
                  {
                    key: 'ATI-1',
                    title: 'Fix auth timeout <script>',
                    status: 'In Progress',
                    priority: 'Highest',
                    dueDate: '2026-11-15',
                    url: 'https://acme.atlassian.net/browse/ATI-1',
                  },
                  {
                    key: 'ATI-2',
                    title: 'Deploy docs',
                    status: 'Done',
                    updatedAt: '2026-11-16T20:00:00Z',
                    url: 'https://acme.atlassian.net/browse/ATI-2',
                  },
                ],
                coverage: { completeness: 'COMPLETE', pagesFetched: 1, itemsReturned: 2, budgetMs: 8000, elapsedMs: 12 },
              }),
            };
          }
          return {
            execute: async (_tool: string, args: any) => {
              slackSentTexts.push(args.text);
              if (slackMode === 'unknown') {
                throw new Error('ECONNRESET after TCP write');
              }
              return { ts: '1763343300.000100' };
            },
          };
        },
      });

      const runner = new ScheduleRunner({
        pool,
        timeZone: 'Asia/Ho_Chi_Minh',
        now: () => clockNow,
        planRun: async () => {
          throw new Error('planRun must not be called for auto_digest');
        },
        runJiraDigest: executor,
        recordState: (client, row, now) => scheduleService.recordState(client, row, now),
      });

      await runner.tick();
      const runs1 = await scheduleService.listRuns(userId, change.schedule.id, 10, clockNow, {
        workspaceMode: 'organization',
        workspaceId,
      });
      expect(runs1[0]?.state).toBe('digest_sent');
      expect((runs1[0]?.delivery as any)?.ts).toBe('1763343300.000100');
      expect(slackSentTexts[0]).toContain('ATI-1');
      expect(slackSentTexts[0]).not.toContain('9999');

      // Run 2: Simulate ambiguous delivery error -> needs_attention + manual resolveRunDelivery('mark_sent')
      slackMode = 'unknown';
      clockNow = new Date('2026-11-17T01:35:00Z');
      await runner.tick();
      const runs2 = await scheduleService.listRuns(userId, change.schedule.id, 10, clockNow, {
        workspaceMode: 'organization',
        workspaceId,
      });
      const unknownRun = runs2[0]!;
      expect(unknownRun.state).toBe('needs_attention');
      expect(unknownRun.error).toBe(MYJIRA_DELIVERY_UNKNOWN);
      expect(unknownRun.canRetryDelivery).toBe(true);

      const resolved = await scheduleService.resolveRunDelivery({
        userId,
        runId: unknownRun.id,
        resolution: 'mark_sent',
        now: clockNow,
        scope: { workspaceMode: 'organization', workspaceId },
      });
      expect(resolved.run.state).toBe('digest_sent');
      expect(resolved.run.deliveryResolution).toBe('confirmed_sent');

      // Pause then revoke project and confirm resume fails closed with REAUTHORIZATION_REQUIRED
      const schedBeforePause = await scheduleService.list(userId, clockNow, {
        workspaceMode: 'organization',
        workspaceId,
      });
      const paused = await scheduleService.setStatus({
        userId,
        scheduleId: change.schedule.id,
        action: 'pause',
        version: schedBeforePause[0]!.version,
        now: clockNow,
        scope: { workspaceMode: 'organization', workspaceId },
      });
      await pool.query(
        `UPDATE ati_workspace_jira_projects SET selected = false WHERE site_id = $1 AND project_key = 'ATI'`,
        [siteId],
      );
      await expect(
        scheduleService.setStatus({
          userId,
          scheduleId: change.schedule.id,
          action: 'resume',
          version: paused.schedule.version,
          now: clockNow,
          scope: { workspaceMode: 'organization', workspaceId },
        }),
      ).rejects.toMatchObject({ code: 'REAUTHORIZATION_REQUIRED' });
    } finally {
      await ctx.cleanup();
    }
  }, 30000);

  it('supports myjira inside organization telegram_digest combined with github while rejecting transient outage without pause', async () => {
    const ctx = await createIsolatedTestSchema();
    try {
      await ctx.runAllMigrations();
      const pool = ctx.pool;
      const userId = await createSyntheticUser(pool, 'Combined Lead', 'combined_lead');
      const atlassianAccountId = `atl-acc-${randomUUID().slice(0, 8)}`;
      const accountId = await connectSyntheticJiraAccount(pool, userId, atlassianAccountId);
      const workspaceId = randomUUID();
      const cloudId = `cloud-${randomUUID().slice(0, 8)}`;
      const inviteCode = `CMB-${randomUUID().slice(0, 4)}-${randomUUID().slice(0, 4)}`.toUpperCase();

      const grantRes = await pool.query<{ id: string }>(
        `INSERT INTO jira_oauth_grants (
           account_id, app_client_id, grant_kind, refresh_state, status, scopes, token_version
         ) VALUES ($1, 'atlassian_3lo', '3lo', 'idle', 'active', $2, 1) RETURNING id`,
        [accountId, ['read:me', 'read:jira-work', 'write:jira-work', 'offline_access']],
      );
      const grantId = grantRes.rows[0]!.id;
      await pool.query(
        `INSERT INTO jira_grant_sites (grant_id, cloud_id, site_name, site_url, product_type, scopes, last_verified_at)
         VALUES ($1, $2, 'Acme Jira', 'https://acme.atlassian.net', 'jira', $3, clock_timestamp())`,
        [grantId, cloudId, ['read:jira-work', 'write:jira-work']],
      );
      await pool.query(
        `INSERT INTO workspaces (id, name, invite_code, require_approval, created_by)
         VALUES ($1, 'Combined Org', $2, true, $3)`,
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
        [workspaceId, `cmb-${randomUUID().slice(0, 8)}`, userId],
      );
      await pool.query(
        `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version)
         VALUES ($1, $2, 'admin', 'active', 1)`,
        [workspaceId, userId],
      );
      const siteRes = await pool.query<{ id: string }>(
        `INSERT INTO ati_workspace_jira_sites (
           workspace_id, cloud_id, site_name, site_url, active, policy_version, linked_by, verified_admin_by, admin_verified_at
         ) VALUES ($1, $2, 'Acme Jira', 'https://acme.atlassian.net', true, 1, $3, $3, clock_timestamp()) RETURNING id`,
        [workspaceId, cloudId, userId],
      );
      const siteId = siteRes.rows[0]!.id;
      await pool.query(
        `INSERT INTO ati_workspace_jira_projects (workspace_id, site_id, cloud_id, numeric_project_id, project_key, project_name, selected, policy_version)
         VALUES ($1, $2, $3, '10001', 'ATI', 'ATI Platform', true, 1)`,
        [workspaceId, siteId, cloudId],
      );
      const convRes = await pool.query<{ id: string }>(
        `INSERT INTO conversations (user_id, workspace_id, workspace_mode, jira_context, title, status)
         VALUES ($1, $2, 'organization', true, 'Combined Digest Conv', 'chatting')
         RETURNING id`,
        [userId, workspaceId],
      );
      const convId = convRes.rows[0]!.id;

      const encryptionKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const credRepo = new CredentialRepo(pool, encryptionKey);
      const savedTgCred = await credRepo.saveCredentials(
        'telegram',
        encryptCredentials(
          {
            telegramUserId: '777888999',
            username: 'tg_standup',
            selectedChats: [{ chatId: '-100555666777', title: 'Standup', type: 'supergroup' }],
          },
          encryptionKey,
        ),
        userId,
      );
      const savedGhCred = await credRepo.saveCredentials(
        'github',
        encryptCredentials(
          {
            githubUserId: 'gh-1',
            login: 'octo',
            accessToken: 'ghp_test',
            repos: ['acme/api'],
          },
          encryptionKey,
        ),
        userId,
      );
      const candidate = evaluateTelegramDigestCandidate({
        proposal: {
          kind: 'schedule',
          action: 'create',
          name: 'Combined Org Digest',
          request: 'Mỗi sáng tổng hợp ATI trên Jira và GitHub gửi nhóm Standup',
          recurrence: { type: 'daily', time: '09:00' },
          summary: 'Combined digest',
        },
        services: ['myjira', 'github', 'telegram'],
        timeZone: 'Asia/Ho_Chi_Minh',
        workspaceMode: 'organization',
        workspaceId,
        telegramLookup: {
          status: 'connected',
          selectedChats: [{ chatId: '-100555666777', title: 'Standup', type: 'supergroup' }],
          connection: { credentialId: savedTgCred.id, telegramUserId: '777888999', username: 'tg_standup', chatIds: ['-100555666777'] },
        },
        githubLookup: {
          status: 'connected',
          connection: { credentialId: savedGhCred.id, githubUserId: 'gh-1', login: 'octo', repos: ['acme/api'] },
        },
        jiraLookup: {
          status: 'connected',
          workspaceId,
          grantId,
          atlassianAccountId,
          projects: [{ siteId, siteName: 'Acme Jira', projectKey: 'ATI', projectName: 'ATI Platform' }],
        },
      });
      expect(candidate.canAutoDigest).toBe(true);
      expect(candidate.config?.sources.some((s) => s.service === 'myjira' && s.args?.projectKey === 'ATI')).toBe(true);

      const digestHash = computeTelegramDigestConfigHash(candidate.config!);
      const schedRes = await pool.query<{ id: string; version: number }>(
        `INSERT INTO schedules (user_id, conv_id, name, request, recurrence, services, status, next_run_at, kind, digest_config, digest_config_hash, digest_approved_at, workspace_id, workspace_mode)
         VALUES ($1, $2, 'Combined Org Digest', 'Mỗi sáng tổng hợp ATI trên Jira và GitHub gửi nhóm Standup', $3, '{myjira,github,telegram}', 'active', '2026-11-17T02:00:00Z', 'telegram_digest', $4, $5, clock_timestamp(), $6, 'organization')
         RETURNING id, version`,
        [userId, convId, JSON.stringify(candidate.config!.recurrence), JSON.stringify(candidate.config!), digestHash, workspaceId],
      );
      const scheduleId = schedRes.rows[0]!.id;
      const runRes = await pool.query<{ id: string }>(
        `INSERT INTO schedule_runs (schedule_id, schedule_version, trigger, due_at, status)
         VALUES ($1, $2, 'scheduled', '2026-11-17T02:00:00Z', 'planning')
         RETURNING id`,
        [scheduleId, schedRes.rows[0]!.version],
      );
      const runId = runRes.rows[0]!.id;

      const runner = new TelegramDigestRunner({
        pool,
        credentialRepo: credRepo,
        encryptionKey,
        adapterFactory: {
          getAdapterForService: async (svc: string) => ({
            execute: async (_tool: string, args: any) => {
              if (svc === 'myjira') {
                return { issues: [{ key: 'ATI-5', title: 'Payment webhook fix', status: 'In Progress', priority: 'High' }] };
              }
              if (svc === 'github') {
                return [{ number: 12, title: 'Fix API retry', repo: 'acme/api', state: 'open' }];
              }
              return { messageId: 888, chatId: args.chatId };
            },
          }),
        },
        botClient: { getChatMember: async () => true },
        timeZone: 'Asia/Ho_Chi_Minh',
      });

      const res = await runner.execute(
        {
          runId,
          scheduleId,
          scheduleVersion: schedRes.rows[0]!.version,
          userId,
          name: 'Combined Org Digest',
          request: 'Combined',
          dueAt: new Date('2026-11-17T02:00:00Z'),
          trigger: 'scheduled',
          workspaceMode: 'organization',
          workspaceId,
          digestConfig: candidate.config!,
          digestConfigHash: digestHash,
        },
        new AbortController().signal,
      );
      expect(res.status).toBe('digest_sent');
      if (res.status === 'digest_sent') {
        expect(res.digestText).toContain('[ATI-5] Payment webhook fix');
        expect(res.digestText).toContain('acme/api#12');
      }
    } finally {
      await ctx.cleanup();
    }

    // Transient Jira outage in createJiraDigestExecutor -> JIRA_READ_UNAVAILABLE
    const outageExecutor = createJiraDigestExecutor({
      pool: {} as any,
      timeZone: 'Asia/Ho_Chi_Minh',
      jiraConnection: async () => {
        throw { category: 'NETWORK', message: 'ETIMEDOUT' };
      },
      getAdapter: vi.fn(),
    });
    const fakeCfg: JiraDigestConfig = {
      workspaceId: randomUUID(),
      grantId: randomUUID(),
      atlassianAccountId: 'atl-1',
      projects: [{ siteId: randomUUID(), siteName: 'Acme Jira', projectKey: 'ATI' }],
      channelId: 'C123',
      channelName: 'standup',
    };
    const outageOutcome = await outageExecutor(
      {
        runId: 'non-uuid-skip-db',
        scheduleId: 'non-uuid-skip-db',
        scheduleVersion: 1,
        userId: 'u-1',
        name: 'Outage test',
        request: 'Digest',
        dueAt: new Date(),
        trigger: 'scheduled',
        workspaceId: fakeCfg.workspaceId,
        workspaceMode: 'organization',
        recurrence,
        digestConfig: fakeCfg,
        digestConfigHash: computeJiraDigestConfigHash({ config: fakeCfg, recurrence, userId: 'u-1' }),
      },
      'conv-1',
      new AbortController().signal,
    );
    expect(outageOutcome).toMatchObject({ state: 'digest_failed', failureCode: JIRA_READ_UNAVAILABLE });
  }, 20000);
});
