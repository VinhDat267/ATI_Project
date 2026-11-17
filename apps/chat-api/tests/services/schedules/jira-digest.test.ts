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
import { reconcileScheduleRuns, ScheduleRunner } from '../../../src/services/schedules/schedule-runner.js';
import {
  createJiraDigestExecutor,
  isValidJiraDigestConfig,
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

  it('discovers the Slack channel in the Jira organization when building the candidate', async () => {
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
      getAdapter: async (_service, context) => ({
        execute: async () => [{
          id: context?.workspaceId === 'ws-1' && context?.workspaceMode === 'organization' && context?.phase === 'planning'
            ? 'C12345'
            : 'CLEGACY',
          name: 'standup',
        }],
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

      const routeScheduleSpy = vi.fn(async () => ({ services: ['myjira', 'slack'], unavailable: [] }));
      const chatService = new ChatService({
        msgRepo,
        convRepo,
        planRepo,
        jiraLlmEgressEnabled: true,
        planner: {
          routeSchedule: routeScheduleSpy,
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

      expect(routeScheduleSpy).toHaveBeenCalledWith(
        'Mỗi sáng 8h30 tổng hợp tiến độ và blocker Jira dự án ATI gửi vào kênh #standup-eng',
        expect.objectContaining({
          userId,
          workspaceId,
          workspaceMode: 'organization',
          jiraContext: true,
        }),
      );

      const msgs = await msgRepo.listMessages(convId);
      const proposalMsg = msgs[msgs.length - 1]!;
      expect(proposalMsg.metadata?.type).toBe('schedule_proposal');
      expect((proposalMsg.metadata as any).digestCandidate?.canAutoDigest).toBe(true);

      const confirmedAt = new Date('2026-11-16T01:00:00Z');
      for (const approvalMode of [undefined, 'manual'] as const) {
        await expect(scheduleService.confirmProposal({
          userId, convId, messageId: proposalMsg.id, now: confirmedAt,
          scope: { workspaceMode: 'organization', workspaceId }, approvalMode,
        })).rejects.toMatchObject({ code: 'DIGEST_NOT_ELIGIBLE', message: expect.stringContaining('tự gửi bản tin') });
      }
      expect((await pool.query('SELECT id FROM schedules WHERE conv_id = $1', [convId])).rows).toEqual([]);
      const change = await scheduleService.confirmProposal({
        userId,
        convId,
        messageId: proposalMsg.id,
        now: confirmedAt,
        scope: { workspaceMode: 'organization', workspaceId },
        approvalMode: 'auto_digest',
        includeAiSummary: false,
      });

      expect(change.schedule.kind).toBe('myjira_digest');
      expect(change.schedule.approvalMode).toBe('auto_digest');
      expect((change.schedule.digest as any)?.config?.projects?.[0]?.projectKey).toBe('ATI');

      const scope = { workspaceMode: 'organization' as const, workspaceId };
      const scheduleId = change.schedule.id;
      const original = await scheduleRepo.ownedSchedule(scheduleId, userId, pool, false, scope);
      if (!original || !isValidJiraDigestConfig(original.digest_config)) {
        throw new Error('The confirmed Jira digest configuration was not saved');
      }
      expect(original.digest_config.includeAiSummary).toBe(false);
      const update = {
        ...proposalMsg.metadata!.proposal!,
        action: 'update',
        name: 'Bản tin Jira cập nhật',
      };
      const updatePreview = await (chatService as any).prepareProposal(
        update, { userId, ...scope, jiraContext: true }, change.schedule, [],
      );
      expect(updatePreview.digestCandidate?.config?.includeAiSummary).toBe(false);

      // An older client can confirm without an explicit AI preference.
      const previousPreviewMessage = await msgRepo.createMessage(convId, 'assistant', 'Cập nhật bản tin Jira', {
        ...updatePreview,
        digestCandidate: {
          ...updatePreview.digestCandidate,
          config: { ...updatePreview.digestCandidate.config, includeAiSummary: undefined },
        },
      });
      const updated = await scheduleService.confirmProposal({
        userId, convId, messageId: previousPreviewMessage.id, now: confirmedAt, scope, approvalMode: 'auto_digest',
      });
      expect(updated.schedule.digestConfig).toMatchObject({ includeAiSummary: false });

      const optInPreview = await (chatService as any).prepareProposal(
        { ...update, name: 'Bản tin Jira kèm AI' }, { userId, ...scope, jiraContext: true }, updated.schedule, [],
      );
      const optInMessage = await msgRepo.createMessage(convId, 'assistant', 'Bật tóm tắt AI cho bản tin Jira', optInPreview);
      await scheduleService.confirmProposal({
        userId, convId, messageId: optInMessage.id, now: confirmedAt, scope, approvalMode: 'auto_digest', includeAiSummary: true,
      });
      const approved = await scheduleRepo.ownedSchedule(scheduleId, userId, pool, false, scope);
      if (!approved || !isValidJiraDigestConfig(approved.digest_config)) {
        throw new Error('The updated Jira digest configuration was not saved');
      }
      const approvedConfig = approved.digest_config;
      expect(approvedConfig.includeAiSummary).toBe(true);
      const updateMessage = await msgRepo.createMessage(convId, 'assistant', 'Cập nhật bản tin Jira', {
        ...proposalMsg.metadata!,
        proposal: {
          ...proposalMsg.metadata!.proposal!,
          action: 'update',
          recurrence: { type: 'daily', time: '09:00' },
        },
        scheduleId,
        baseVersion: approved.version,
      });
      await expect(scheduleService.confirmProposal({
        userId, convId, messageId: updateMessage.id, now: confirmedAt, scope, approvalMode: 'manual',
      })).rejects.toMatchObject({ code: 'DIGEST_NOT_ELIGIBLE', message: expect.stringContaining('tự gửi bản tin') });
      expect(await scheduleRepo.ownedSchedule(scheduleId, userId, pool, false, scope)).toMatchObject({
        kind: 'myjira_digest', version: approved.version, digest_config_hash: approved.digest_config_hash,
      });

      // Run 1: Execute via createJiraDigestExecutor + ScheduleRunner (hallucinated AI number falls back cleanly!)
      let clockNow = new Date('2026-11-16T01:35:00Z');
      let slackMode: 'ok' | 'unknown' | 'reject' = 'ok';
      let jiraAdapterContext: unknown;
      const slackSentTexts: string[] = [];
      const startedDispatches: Array<{
        delivery_started_at: Date | null;
        dispatched_config: JiraDigestConfig | null;
        dispatched_config_hash: string | null;
      }> = [];
      const executor = createJiraDigestExecutor({
        pool,
        timeZone: 'Asia/Ho_Chi_Minh',
        now: () => clockNow,
        jiraConnection: liveJiraConnection,
        summarizeDigest: async () => 'Có 9999 issue đang lỗi nặng 100% toàn bộ dự án.',
        getAdapter: async (svc, context) => {
          if (svc === 'myjira') {
            jiraAdapterContext = context;
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
              const dispatch = await pool.query(
                `SELECT delivery_started_at, dispatched_config, dispatched_config_hash
                   FROM schedule_runs WHERE schedule_id = $1 AND status = 'planning'`,
                [scheduleId],
              );
              startedDispatches.push(dispatch.rows[0]);
              if (slackMode === 'unknown') {
                throw new Error('ECONNRESET after TCP write');
              }
              if (slackMode === 'reject') {
                throw Object.assign(new Error('Slack credential rejected before send'), { details: { requestSent: false } });
              }
              return { ts: '1763343300.000100' };
            },
          };
        },
      });

      const makeRunner = (runJiraDigest = executor) => new ScheduleRunner({
        pool,
        timeZone: 'Asia/Ho_Chi_Minh',
        now: () => clockNow,
        planRun: async () => {
          throw new Error('planRun must not be called for auto_digest');
        },
        runJiraDigest,
        recordState: (client, row, now) => scheduleService.recordState(client, row, now),
      });

      const runner = makeRunner();
      await runner.tick();
      const runs1 = await scheduleService.listRuns(userId, change.schedule.id, 10, clockNow, {
        workspaceMode: 'organization',
        workspaceId,
      });
      expect(runs1[0]?.state).toBe('digest_sent');
      expect((runs1[0]?.delivery as any)?.ts).toBe('1763343300.000100');
      expect(slackSentTexts[0]).toContain('ATI-1');
      expect(slackSentTexts[0]).not.toContain('9999');
      expect.soft(jiraAdapterContext).toMatchObject({
        userId,
        phase: 'execution',
        workspaceId,
        workspaceMode: 'organization',
        jiraDigestBinding: { grantId, atlassianAccountId },
      });

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
      expect.soft(startedDispatches[1]).toMatchObject({
        delivery_started_at: expect.any(Date),
        dispatched_config: approvedConfig,
        dispatched_config_hash: approved.digest_config_hash,
      });
      await expect(scheduleService.startRun({
        userId, runId: unknownRun.id, trigger: 'replan', now: clockNow, scope,
      })).rejects.toMatchObject({ code: 'RUN_NOT_REPLANNABLE' });

      const legacyRun = (
        await pool.query<{ id: string }>(
          `INSERT INTO schedule_runs (schedule_id, schedule_version, trigger, due_at, status, error, delivery_started_at)
           VALUES ($1, $2, 'manual', $3, 'needs_attention', $4, now()) RETURNING id`,
          [scheduleId, approved.version, clockNow, MYJIRA_DELIVERY_UNKNOWN],
        )
      ).rows[0]!;
      const editedConfig = { ...approvedConfig, channelId: 'CNEW', channelName: 'new-channel' };
      const editedHash = computeJiraDigestConfigHash({ config: editedConfig, recurrence, userId });
      await pool.query(
        'UPDATE schedules SET digest_config = $2, digest_config_hash = $3 WHERE id = $1',
        [scheduleId, editedConfig, editedHash],
      );
      await expect(scheduleService.resolveRunDelivery({
        userId, runId: unknownRun.id, resolution: 'retry_new_run', confirmDuplicateRisk: true, now: clockNow, scope,
      })).rejects.toMatchObject({ code: 'CONFIG_CHANGED_SINCE_RUN' });
      await pool.query(
        'UPDATE schedules SET digest_config = $2, digest_config_hash = $3 WHERE id = $1',
        [scheduleId, approvedConfig, approved.digest_config_hash],
      );

      const staleRun = await scheduleService.startRun({
        userId, scheduleId, trigger: 'manual', now: clockNow, scope,
      });
      await makeRunner(async (started) => {
        expect(started.scheduleVersion).toBe(approved.version);
        await pool.query(
          'UPDATE schedules SET version = version + 1, digest_config = $2, digest_config_hash = $3 WHERE id = $1',
          [scheduleId, editedConfig, editedHash],
        );
        return {
          state: 'blocked', error: 'Old Jira connection was revoked', pauseReason: 'Old Jira connection was revoked',
        };
      }).planNow(staleRun.id);
      expect(await scheduleRepo.ownedSchedule(scheduleId, userId, pool, false, scope)).toMatchObject({
        status: 'active', version: approved.version + 1, digest_config_hash: editedHash,
      });
      expect(await scheduleRepo.run(staleRun.id)).toMatchObject({
        status: 'blocked', error: 'Old Jira connection was revoked',
      });

      const resolved = await scheduleService.resolveRunDelivery({
        userId,
        runId: unknownRun.id,
        resolution: 'mark_sent',
        now: clockNow,
        scope: { workspaceMode: 'organization', workspaceId },
      });
      expect(resolved.run.state).toBe('digest_sent');
      expect(resolved.run.deliveryResolution).toBe('confirmed_sent');
      expect.soft(resolved.run.delivery).toMatchObject({
        destinationService: 'slack', channelId: 'C12345', channelName: 'standup-eng',
      });
      const legacyResolved = await scheduleService.resolveRunDelivery({
        userId, runId: legacyRun.id, resolution: 'mark_sent', now: clockNow, scope,
      });
      expect(legacyResolved.run.delivery).toMatchObject({ channelId: 'unknown', channelName: 'unknown' });

      slackMode = 'reject';
      clockNow = new Date('2026-11-18T01:35:00Z');
      await runner.tick();
      const rejected = (
        await pool.query(
          `SELECT status, delivery_started_at, dispatched_config, dispatched_config_hash FROM schedule_runs
           WHERE schedule_id = $1 AND trigger = 'scheduled' ORDER BY due_at DESC LIMIT 1`,
          [scheduleId],
        )
      ).rows[0];
      expect.soft(startedDispatches[2]).toMatchObject({
        delivery_started_at: expect.any(Date),
        dispatched_config: editedConfig,
        dispatched_config_hash: editedHash,
      });
      expect(rejected).toEqual({
        status: 'digest_failed', delivery_started_at: null, dispatched_config: null, dispatched_config_hash: null,
      });

      // Dispatch without saving the outcome to model a worker closing before it commits.
      slackMode = 'unknown';
      const crashRun = await scheduleService.startRun({
        userId, scheduleId, trigger: 'manual', now: clockNow, scope,
      });
      const crashInput: Parameters<typeof executor>[0] = {
        runId: crashRun.id,
        scheduleId,
        scheduleVersion: approved.version + 1,
        userId,
        name: change.schedule.name,
        request: change.schedule.request,
        dueAt: clockNow,
        trigger: 'manual',
        workspaceId,
        workspaceMode: 'organization',
        recurrence,
        digestConfig: editedConfig,
        digestConfigHash: editedHash,
      };
      const crashOutcomes = await Promise.all([
        executor(crashInput, convId, new AbortController().signal),
        executor(crashInput, convId, new AbortController().signal),
      ]);
      expect(crashOutcomes.map(({ state }) => state).sort()).toEqual(['delivery_unknown', 'discarded']);

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

      await pool.query(
        `UPDATE schedules SET kind = 'plan', version = version + 1, digest_config = NULL,
           digest_config_hash = NULL, digest_approved_at = NULL WHERE id = $1`,
        [scheduleId],
      );
      await reconcileScheduleRuns(pool);
      const crashRecovered = (await scheduleService.listRuns(userId, scheduleId, 10, clockNow, scope))
        .find((run) => run.id === crashRun.id);
      expect.soft(crashRecovered).toMatchObject({
        state: 'needs_attention', error: MYJIRA_DELIVERY_UNKNOWN, canRetryDelivery: false,
      });
      await expect.soft(scheduleService.resolveRunDelivery({
        userId, runId: crashRun.id, resolution: 'retry_new_run', confirmDuplicateRisk: true, now: clockNow, scope,
      })).rejects.toMatchObject({ code: 'CONFIG_CHANGED_SINCE_RUN' });
      const confirmedAfterRestart = await scheduleService.resolveRunDelivery({
        userId, runId: crashRun.id, resolution: 'mark_sent', now: clockNow, scope,
      });
      expect(confirmedAfterRestart.run).toMatchObject({
        state: 'digest_sent',
        delivery: { destinationService: 'slack', channelId: 'CNEW', channelName: 'new-channel' },
      });
      expect(slackSentTexts).toHaveLength(4);
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
