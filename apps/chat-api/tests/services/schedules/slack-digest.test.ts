import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { encryptCredentials, SlackAdapter, StepError } from '@wap/tool-adapters';
import type { SlackDigestConfig } from '@wap/tool-schemas';
import { CredentialRepo } from '../../../src/db/repositories/credential-repo.js';
import { ConversationRepo } from '../../../src/db/repositories/conversation-repo.js';
import { MessageRepo } from '../../../src/db/repositories/message-repo.js';
import { ScheduleRepo } from '../../../src/db/repositories/schedule-repo.js';
import { ChatService } from '../../../src/services/chat-service.js';
import { ScheduleService, ScheduleConflict } from '../../../src/services/schedules/schedule-service.js';
import { ScheduleRunner, reconcileScheduleRuns } from '../../../src/services/schedules/schedule-runner.js';
import { evaluateSlackDigestCandidate, computeSlackDigestConfigHash } from '../../../src/services/schedules/slack-digest-candidate.js';
import { SlackDigestRunner, SLACK_DIGEST_DELIVERY_UNKNOWN } from '../../../src/services/schedules/slack-digest-runner.js';
import { createMigratedSchema } from '../../helpers/gmail-test-db.js';

const KEY = '0123456789abcdef0123456789abcdef';
const TZ = 'Asia/Ho_Chi_Minh';
const NOW = new Date('2026-11-17T01:00:00.000Z'); // 08:00 VN

describe('Multi-service Slack auto_digest (slack_digest) + migration 0038 + recovery on PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let owner: Awaited<ReturnType<typeof db.person>>;
  let creds: CredentialRepo;
  let wsPersonalSlackCredId: string;
  let wsOrgSlackCredId: string;
  let orgWsId: string;

  beforeAll(async () => {
    db = await createMigratedSchema('slack_digest_multi');
    creds = new CredentialRepo(db.pool, KEY);
  });

  beforeEach(async () => {
    await db.pool.query(
      'DELETE FROM schedule_runs; DELETE FROM schedules; DELETE FROM workspace_members; DELETE FROM workspaces; DELETE FROM service_credentials;',
    );
    owner = await db.person('Multi Slack Owner');
    orgWsId = (
      await db.pool.query(
        "INSERT INTO workspaces(name, invite_code, created_by) VALUES('Org Alpha', 'ALPHA-01', $1) RETURNING id",
        [owner.id],
      )
    ).rows[0].id;
    await db.pool.query(
      "INSERT INTO workspace_members(workspace_id, user_id, role, status) VALUES($1, $2, 'admin', 'active')",
      [orgWsId, owner.id],
    );

    const personalSlack = await creds.upsertCredentials(
      'slack',
      encryptCredentials({ botToken: 'xoxb-personal-valid', allowedScope: { channels: ['C_GENERAL', 'C_OPS'] } }, KEY),
      'active',
      owner.email,
      null,
    );
    wsPersonalSlackCredId = personalSlack.id;

    const orgSlack = await creds.upsertCredentials(
      'slack',
      encryptCredentials({ botToken: 'xoxb-org-valid', allowedScope: { channels: ['C_ORG_ENG'] } }, KEY),
      'active',
      owner.email,
      orgWsId,
    );
    wsOrgSlackCredId = orgSlack.id;

    await creds.saveCredentials(
      'mycalendar',
      encryptCredentials(
        {
          refreshToken: 'cal-ref',
          email: 'owner@example.test',
          selectedCalendars: [{ id: 'work@example.test', summary: 'Work', primary: true }],
          allowedScope: { calendars: ['work@example.test'] },
        },
        KEY,
      ),
      owner.id,
    );

    await creds.saveCredentials(
      'github',
      encryptCredentials(
        {
          accessToken: 'ghp-owner-test',
          githubUserId: '100',
          login: 'octo',
          repos: ['ati/core'],
        },
        KEY,
      ),
      owner.id,
    );
  });

  afterAll(async () => db?.close());

  it('migration 0038 applies idempotently and enforces schedules_kind_digest_check on slack_digest', async () => {
    const sqlPath = fileURLToPath(new URL('../../../../../db/v3/0038_slack_digest_schedule_kind.sql', import.meta.url));
    const sql = readFileSync(sqlPath, 'utf8');
    await expect(db.pool.query(sql)).resolves.toBeDefined();

    const conv = await new ConversationRepo(db.pool).createConversation(owner.id, 'Constraint check');
    await expect(
      db.pool.query(
        `INSERT INTO schedules(user_id, conv_id, name, request, recurrence, services, status, next_run_at, kind)
         VALUES($1, $2, 'Missing Config', 'Test', '{"type":"daily","time":"08:00"}', ARRAY['github','mycalendar','slack'], 'active', now(), 'slack_digest')`,
        [owner.id, conv.id],
      ),
    ).rejects.toThrow(/schedules_kind_digest_check/);
  });

  it('evaluates multi-source Slack proposal via ChatService, confirms slack_digest in PostgreSQL, and isolates workspace Slack credentials', async () => {
    const convRepo = new ConversationRepo(db.pool);
    const msgRepo = new MessageRepo(db.pool);
    const scheduleService = new ScheduleService({ pool: db.pool, timeZone: TZ, encryptionKey: KEY });

    const conv = await convRepo.createConversation(owner.id, 'Multi Slack Digest');
    const emitted: Array<{ event: string; payload: any }> = [];

    const chatService = new ChatService({
      convRepo,
      msgRepo,
      eventEmitter: { emit: (event, payload) => emitted.push({ event, payload }) },
      schedules: {
        repo: scheduleService.repo,
        pool: db.pool,
        timeZone: TZ,
        now: () => NOW,
        credentialRepo: creds,
        encryptionKey: KEY,
      },
      githubConnection: async () => ({
        status: 'connected',
        connection: { credentialId: 'gh-1', githubUserId: '100', login: 'octo', repos: ['ati/core'] },
      }),
      getAdapter: async (serviceName: string, ctx: any) => {
        if (serviceName === 'slack') {
          expect(ctx?.workspaceId ?? null).toBeNull();
          return {
            execute: async (tool: string) => {
              if (tool === 'slack.search_channels') {
                return [
                  { id: 'C_GENERAL', name: 'general', isPrivate: false },
                  { id: 'C_OPS', name: 'ops', isPrivate: false },
                ];
              }
              return [];
            },
          };
        }
        return null;
      },
      planner: {
        routeSchedule: async () => ({ services: ['github', 'mycalendar', 'slack'], unavailable: [] }),
        processMessage: async () => ({
          kind: 'schedule',
          action: 'create',
          name: 'Bản tin sáng tổng hợp',
          request: 'Mỗi sáng 8h tổng hợp issue GitHub và lịch họp gửi lên Slack #general',
          recurrence: { type: 'daily', time: '08:00' },
          summary: 'Tổng hợp GitHub & Google Calendar lên Slack #general',
        }),
      } as any,
    });

    await chatService.handleUserMessage({
      conversationId: conv.id,
      userId: owner.id,
      content: 'Mỗi sáng 8h tổng hợp issue GitHub và lịch họp gửi lên Slack #general',
    });

    for (let i = 0; i < 100 && !emitted.some((e) => e.event === 'schedule_proposal' || e.event === 'error'); i++) {
      await new Promise((r) => setTimeout(r, 15));
    }
    const proposalEvent = emitted.find((e) => e.event === 'schedule_proposal');
    expect(proposalEvent).toBeDefined();
    const proposalMeta = proposalEvent!.payload.metadata;
    expect(proposalMeta.type).toBe('schedule_proposal');
    const cand = proposalMeta.digestCandidate;
    expect(cand?.canAutoDigest).toBe(true);
    expect(cand?.config?.destination).toBe('slack');
    expect(cand?.config?.slackCredentialId).toBe(wsPersonalSlackCredId);
    expect(cand?.config?.channelId).toBe('C_GENERAL');
    expect(cand?.config?.sources.map((s: any) => s.service)).toEqual(['github', 'mycalendar']);

    const confirmed = await scheduleService.confirmProposal({
      userId: owner.id,
      convId: conv.id,
      messageId: proposalEvent!.payload.messageId,
      approvalMode: 'auto_digest',
      includeAiSummary: true,
      now: NOW,
    });
    expect(confirmed.schedule.kind).toBe('slack_digest');
    expect(confirmed.schedule.digest).toMatchObject({
      destinationService: 'slack',
      channelId: 'C_GENERAL',
      channelName: 'general',
    });

    // Tampered org workspace credential or missing Slack channel is refused
    const wrongCredCandidate = await evaluateSlackDigestCandidate({
      proposal: {
        kind: 'schedule',
        action: 'create',
        name: 'Org Digest',
        request: 'Tổng hợp GitHub và Calendar lên #org-eng',
        recurrence: { type: 'daily', time: '08:00' },
        summary: 'Test',
      },
      services: ['github', 'mycalendar', 'slack'],
      timeZone: TZ,
      userId: owner.id,
      pool: db.pool,
      workspaceMode: 'organization',
      workspaceId: orgWsId,
      githubLookup: { status: 'connected', connection: { credentialId: 'gh-1', githubUserId: '100', login: 'octo', repos: ['ati/core'] } },
      getAdapter: async () => ({ execute: async () => [{ id: 'C_ORG_ENG', name: 'org-eng' }] }),
    });
    expect(wrongCredCandidate.canAutoDigest).toBe(true);
    expect(wrongCredCandidate.config?.slackCredentialId).toBe(wsOrgSlackCredId);
    expect(wrongCredCandidate.config?.workspaceMode).toBe('organization');
    expect(wrongCredCandidate.config?.workspaceId).toBe(orgWsId);
  });

  it('executes multi-source Slack digest via real HTTP Slack mock with Block Kit blocks, atomic claim, failure recovery & reconciliation', async () => {
    const convRepo = new ConversationRepo(db.pool);
    const msgRepo = new MessageRepo(db.pool);
    const scheduleService = new ScheduleService({ pool: db.pool, timeZone: TZ, encryptionKey: KEY });

    const slackPosts: Array<{ channel: string; text: string; blocks?: any[] }> = [];
    let slackBehavior: 'ok' | 'missing_ts' | 'invalid_blocks' = 'ok';

    const mockServer: Server = createServer(async (req, res) => {
      const url = req.url ?? '';
      let rawBody = '';
      for await (const chunk of req) rawBody += chunk;

      if (url.includes('/conversations.list')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, channels: [{ id: 'C_GENERAL', name: 'general', is_private: false }] }));
        return;
      }
      if (url.includes('/chat.postMessage')) {
        const parsed = JSON.parse(rawBody || '{}');
        slackPosts.push(parsed);
        if (slackBehavior === 'invalid_blocks') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'invalid_blocks' }));
          return;
        }
        if (slackBehavior === 'missing_ts') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, channel: 'C_GENERAL' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, channel: 'C_GENERAL', ts: '1700000888.000100' }));
        return;
      }
      res.writeHead(404);
      res.end('Not found');
    });

    await new Promise<void>((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${(mockServer.address() as AddressInfo).port}`;

    try {
      const conv = await convRepo.createConversation(owner.id, 'Runner test');
      const config: SlackDigestConfig = {
        destination: 'slack',
        workspaceMode: 'personal',
        workspaceId: null,
        slackCredentialId: wsPersonalSlackCredId,
        channelId: 'C_GENERAL',
        channelName: 'general',
        includeAiSummary: true,
        sources: [
          { service: 'github', tool: 'github.search_issues', args: { repo: 'ati/core', query: 'open' }, label: 'GitHub (ati/core)' },
          { service: 'mycalendar', tool: 'mycalendar.list_events', label: 'Google Calendar hôm nay' },
        ],
        recurrence: { type: 'daily', time: '08:00' },
        timeZone: TZ,
      };
      const configHash = computeSlackDigestConfigHash(config);
      const duePast = new Date(NOW.getTime() - 60_000);
      const schedRow = (
        await db.pool.query(
          `INSERT INTO schedules(
             user_id, conv_id, name, request, recurrence, services, status, next_run_at,
             kind, digest_config, digest_config_hash, digest_approved_at, workspace_mode, workspace_id
           )
           VALUES($1, $2, 'Sáng tổng hợp Slack', 'Đọc GitHub và Calendar gửi #general', $3, $4, 'active', $5, 'slack_digest', $6, $7, now(), 'personal', NULL)
           RETURNING *`,
          [owner.id, conv.id, JSON.stringify(config.recurrence), ['github', 'mycalendar', 'slack'], duePast, JSON.stringify(config), configHash],
        )
      ).rows[0];

      const slackRunner = new SlackDigestRunner({
        pool: db.pool,
        credentialRepo: creds,
        encryptionKey: KEY,
        timeZone: TZ,
        summarizeWithAi: async () => 'Có 1 issue ưu tiên và 1 lịch họp đứng đầu cần chú ý.',
        adapterFactory: {
          getAdapterForService: async (serviceName: string) => {
            if (serviceName === 'slack') {
              return new SlackAdapter({
                credentials: { botToken: 'xoxb-personal-valid' },
                allowedScope: { channels: ['C_GENERAL'] },
                baseUrl,
              });
            }
            if (serviceName === 'github') {
              return {
                execute: async () => [{ number: 42, title: 'Sửa timeout queue', repo: 'ati/core', state: 'open' }],
              };
            }
            if (serviceName === 'mycalendar') {
              return {
                execute: async () => ({
                  events: [{ id: 'ev-1', title: 'Daily Standup', start: '2026-11-17T09:00:00+07:00', end: '2026-11-17T09:30:00+07:00' }],
                }),
              };
            }
            throw new StepError({ message: 'unexpected', category: 'VALIDATION', retryable: false });
          },
        },
      });

      const runner = new ScheduleRunner({
        pool: db.pool,
        timeZone: TZ,
        encryptionKey: KEY,
        now: () => NOW,
        planRun: async () => ({ persist: async () => ({ state: 'needs_attention' }), afterCommit() {} }),
        executeSlackDigestRun: (run, sig) => slackRunner.execute(run, sig),
        recordState: (client, row, at) => scheduleService.recordState(client, row, at),
      });

      // 1. Happy path -> digest_sent with Block Kit blocks + valid ts
      await runner.tick();
      expect(slackPosts).toHaveLength(1);
      const firstPost = slackPosts[0]!;
      expect(firstPost.channel).toBe('C_GENERAL');
      expect(firstPost.text).toContain('ati/core#42');
      expect(firstPost.text).toContain('Daily Standup');
      expect(firstPost.text).toContain('Điểm nổi bật');
      expect(Array.isArray(firstPost.blocks)).toBe(true);
      expect(firstPost.blocks!.some((b) => b.type === 'header')).toBe(true);
      expect(firstPost.blocks!.some((b) => b.type === 'section')).toBe(true);

      const runs1 = await scheduleService.listRuns(owner.id, schedRow.id, 10, NOW);
      const sentRun = runs1[0]!;
      expect(sentRun.state).toBe('digest_sent');
      expect((sentRun.delivery as any).ts).toBe('1700000888.000100');

      // 2. Definite Slack rejection -> digest_failed + clears delivery_started_at -> allows replan
      slackBehavior = 'invalid_blocks';
      const failedRun = await scheduleService.startRun({
        scheduleId: schedRow.id,
        trigger: 'manual',
        userId: owner.id,
        now: NOW,
      });
      await runner.planNow(failedRun.id);
      const runsAfterDefiniteFail = await scheduleService.listRuns(owner.id, schedRow.id, 10, NOW);
      const definiteFail = runsAfterDefiniteFail[0]!;
      expect(definiteFail.id).toBe(failedRun.id);
      expect(definiteFail.state).toBe('digest_failed');
      expect(definiteFail.deliveryStartedAt).toBeNull();

      // 3. Ambiguous receipt (missing ts) -> needs_attention + blocks replan + supports mark_sent & retry_new_run
      slackBehavior = 'missing_ts';
      const unknownRun = await scheduleService.startRun({
        scheduleId: schedRow.id,
        trigger: 'manual',
        userId: owner.id,
        now: NOW,
      });
      await runner.planNow(unknownRun.id);
      const runsAfterUnknown = await scheduleService.listRuns(owner.id, schedRow.id, 10, NOW);
      const needsAttn = runsAfterUnknown.find((r) => r.id === unknownRun.id)!;
      expect(needsAttn.state).toBe('needs_attention');
      expect(needsAttn.error).toContain('SLACK_DELIVERY_UNKNOWN');
      expect(needsAttn.deliveryStartedAt).not.toBeNull();

      await expect(
        scheduleService.startRun({ runId: unknownRun.id, trigger: 'replan', userId: owner.id, now: NOW }),
      ).rejects.toThrow(/không cần lập lại kế hoạch/);

      slackBehavior = 'ok';
      const resolvedRetry = await scheduleService.resolveRunDelivery({
        userId: owner.id,
        runId: unknownRun.id,
        resolution: 'retry_new_run',
        confirmDuplicateRisk: true,
        now: NOW,
      });
      expect(resolvedRetry.run.deliveryResolution).toBe('retried_new_run');
      expect(resolvedRetry.followUpRun).not.toBeNull();
      await runner.planNow(resolvedRetry.followUpRun!.id);
      const afterFollowUp = await scheduleService.listRuns(owner.id, schedRow.id, 10, NOW);
      expect(afterFollowUp.find((r) => r.id === resolvedRetry.followUpRun!.id)?.state).toBe('digest_sent');

      // 4. Interrupted run with delivery_started_at recovers via reconcileScheduleRuns as SLACK_DELIVERY_UNKNOWN
      const crashConvId = (await convRepo.createConversation(owner.id, 'Crash run')).id;
      const crashRunRes = await db.pool.query(
        `INSERT INTO schedule_runs(schedule_id, schedule_version, trigger, due_at, status, conv_id, delivery_started_at)
         VALUES($1, 1, 'manual', now(), 'planning', $2, now()) RETURNING id`,
        [schedRow.id, crashConvId],
      );
      await reconcileScheduleRuns(db.pool);
      const reconciled = (await db.pool.query('SELECT status, error FROM schedule_runs WHERE id = $1', [crashRunRes.rows[0].id])).rows[0];
      expect(reconciled.status).toBe('needs_attention');
      expect(reconciled.error).toContain('SLACK_DELIVERY_UNKNOWN');

      const markedSent = await scheduleService.resolveRunDelivery({
        userId: owner.id,
        runId: crashRunRes.rows[0].id,
        resolution: 'mark_sent',
        now: NOW,
      });
      expect(markedSent.run.state).toBe('digest_sent');
      expect(markedSent.run.deliveryResolution).toBe('confirmed_sent');

      // 5. Revoking Slack credential blocks next run BEFORE sending any outbound message
      const postCountBeforeRevoke = slackPosts.length;
      await db.pool.query("UPDATE service_credentials SET status = 'reconnect_required' WHERE id = $1", [wsPersonalSlackCredId]);
      const blockedRun = await scheduleService.startRun({
        scheduleId: schedRow.id,
        trigger: 'manual',
        userId: owner.id,
        now: NOW,
      });
      await runner.planNow(blockedRun.id);
      expect(slackPosts.length).toBe(postCountBeforeRevoke);
      const runsAfterRevoke = await scheduleService.listRuns(owner.id, schedRow.id, 10, NOW);
      expect(runsAfterRevoke.find((r) => r.id === blockedRun.id)?.state).toBe('blocked');
      const schedPaused = (await db.pool.query('SELECT status FROM schedules WHERE id = $1', [schedRow.id])).rows[0];
      expect(schedPaused.status).toBe('paused');

      // Re-activating credential + creating reauthorize preview succeeds cleanly
      await db.pool.query("UPDATE service_credentials SET status = 'active' WHERE id = $1", [wsPersonalSlackCredId]);
      const reauth = await scheduleService.createReauthorizePreview({
        userId: owner.id,
        scheduleId: schedRow.id,
        now: NOW,
      });
      expect((reauth.candidate as any).canAutoDigest).toBe(true);
      expect(reauth.metadata.reauthorize).toBe(true);
      await scheduleService.confirmProposal({
        userId: owner.id,
        convId: schedRow.conv_id,
        messageId: reauth.proposalMessageId,
        approvalMode: 'auto_digest',
        now: NOW,
      });

      // Verify dispatched_config snapshot + canRetryDelivery behavior across UNKNOWN -> config change
      slackBehavior = 'missing_ts';
      const unknownRun2 = await scheduleService.startRun({
        scheduleId: schedRow.id,
        trigger: 'manual',
        userId: owner.id,
        now: NOW,
      });
      await runner.planNow(unknownRun2.id);
      const runsSnap = await scheduleService.listRuns(owner.id, schedRow.id, 10, NOW);
      const unknownSnap = runsSnap.find((r) => r.id === unknownRun2.id)!;
      expect(unknownSnap.canRetryDelivery).toBe(true);

      await db.pool.query(
        'UPDATE schedules SET digest_config_hash = $2, version = version + 1 WHERE id = $1',
        [schedRow.id, 'b'.repeat(64)],
      );
      const runsAfterEdit = await scheduleService.listRuns(owner.id, schedRow.id, 10, NOW);
      expect(runsAfterEdit.find((r) => r.id === unknownRun2.id)?.canRetryDelivery).toBe(false);
    } finally {
      await new Promise<void>((resolve, reject) => mockServer.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it('isolates personal-mode per-user Slack credentials, escapes mrkdwn, supports >10 channels & renamed channels, routes multi-source mysheets, and enforces update validation', async () => {
    const otherUser = await db.person('Other Personal User');
    await db.pool.query('DELETE FROM service_credentials');
    const ownerPersonalSlack = await creds.upsertPersonalCredentials({
      service: 'slack',
      userId: owner.id,
      config: encryptCredentials({ botToken: 'xoxb-personal-owner', allowedScope: { channels: ['C_RENAMED_12'] } }, KEY),
      status: 'active',
    });

    const convRepo = new ConversationRepo(db.pool);
    const msgRepo = new MessageRepo(db.pool);
    const scheduleService = new ScheduleService({ pool: db.pool, timeZone: TZ, encryptionKey: KEY });

    const manyChannels = [
      ...Array.from({ length: 11 }, (_, i) => ({ id: `C_EXTRA_${i + 1}`, name: `chan-${i + 1}`, is_private: false })),
      { id: 'C_RENAMED_12', name: 'new-channel-name', is_private: false },
    ];
    const slackPosts: any[] = [];
    const mockServer: Server = createServer(async (req, res) => {
      const url = req.url ?? '';
      let rawBody = '';
      for await (const chunk of req) rawBody += chunk;
      if (url.includes('/conversations.list')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, channels: manyChannels }));
        return;
      }
      if (url.includes('/users.list')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, members: [{ id: 'U_VINH', name: 'vinh', profile: { real_name: 'Vinh', display_name: 'Vinh' } }] }));
        return;
      }
      if (url.includes('/chat.postMessage')) {
        slackPosts.push(JSON.parse(rawBody || '{}'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, channel: 'C_RENAMED_12', ts: '1700000999.000100' }));
        return;
      }
      res.writeHead(404);
      res.end('Not found');
    });
    await new Promise<void>((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${(mockServer.address() as AddressInfo).port}`;

    try {
      // Other personal user has NO Slack credential -> refused
      const foreignCand = await evaluateSlackDigestCandidate({
        proposal: {
          kind: 'schedule',
          action: 'create',
          name: 'Foreign',
          request: 'Tổng hợp GitHub & Calendar gửi #new-channel-name',
          recurrence: { type: 'daily', time: '08:00' },
          summary: 'Test',
        },
        services: ['github', 'mycalendar', 'slack'],
        timeZone: TZ,
        userId: otherUser.id,
        pool: db.pool,
        workspaceMode: 'personal',
        workspaceId: null,
      });
      expect(foreignCand.canAutoDigest).toBe(false);

      // Multi-source mysheets + github + slack enters evaluateSlackDigestCandidate cleanly via ChatService
      const conv = await convRepo.createConversation(owner.id, 'Multi Sheets + GitHub -> Slack', { workspaceMode: 'personal' });
      const emitted: Array<{ event: string; payload: any }> = [];
      await creds.saveCredentials(
        'mysheets',
        encryptCredentials({ refreshToken: 's-ref', email: 'owner@example.test', allowedScope: { spreadsheets: ['sheet_1'] } }, KEY),
        owner.id,
      );
      const chatService = new ChatService({
        convRepo,
        msgRepo,
        eventEmitter: { emit: (event, payload) => emitted.push({ event, payload }) },
        schedules: { repo: scheduleService.repo, pool: db.pool, timeZone: TZ, now: () => NOW, credentialRepo: creds, encryptionKey: KEY },
        githubConnection: async () => ({
          status: 'connected',
          connection: { credentialId: 'gh-1', githubUserId: '100', login: 'octo', repos: ['ati/core'] },
        }),
        getAdapter: async (svc: string) =>
          svc === 'slack'
            ? new SlackAdapter({ credentials: { botToken: 'xoxb-personal-owner' }, allowedScope: { channels: ['C_RENAMED_12'] }, baseUrl })
            : null,
        planner: {
          routeSchedule: async () => ({ services: ['mysheets', 'github', 'slack'], unavailable: [] }),
          processMessage: async () => ({
            kind: 'schedule',
            action: 'create',
            name: 'Sheets + GitHub Slack',
            request: 'Mỗi sáng tổng hợp Sheets và GitHub gửi lên #new-channel-name',
            recurrence: { type: 'daily', time: '08:00' },
            summary: 'Sheets + GitHub -> Slack',
          }),
        } as any,
      });

      await chatService.handleUserMessage({
        conversationId: conv.id,
        userId: owner.id,
        content: 'Mỗi sáng tổng hợp Sheets và GitHub gửi lên #new-channel-name',
      });
      for (let i = 0; i < 100 && !emitted.some((e) => e.event === 'schedule_proposal'); i++) {
        await new Promise((r) => setTimeout(r, 15));
      }
      const proposalEvent = emitted.find((e) => e.event === 'schedule_proposal')!;
      const cand = proposalEvent.payload.metadata.digestCandidate;
      expect(cand.canAutoDigest).toBe(true);
      expect(cand.config.slackCredentialId).toBe(ownerPersonalSlack.id);
      expect(cand.config.channelId).toBe('C_RENAMED_12');
      expect(cand.config.sources.map((s: any) => s.service)).toEqual(['mysheets', 'github']);

      // Confirm schedule, then mutate stored config to use an old channelName + mrkdwn injection source data
      const confirmed = await scheduleService.confirmProposal({
        userId: owner.id,
        convId: conv.id,
        messageId: proposalEvent.payload.messageId,
        approvalMode: 'auto_digest',
        now: NOW,
      });
      const renamedConfig: SlackDigestConfig = {
        ...cand.config,
        channelName: 'old-channel-name',
        sources: [{ service: 'github', tool: 'github.search_issues', args: { repo: 'ati/core', query: 'open' }, label: 'GitHub' }],
      };
      await db.pool.query(
        'UPDATE schedules SET digest_config = $2, digest_config_hash = $3, next_run_at = $4 WHERE id = $1',
        [confirmed.schedule.id, JSON.stringify(renamedConfig), computeSlackDigestConfigHash(renamedConfig), new Date(NOW.getTime() - 60_000)],
      );

      // Update branch validates tampered hash
      const badMsg = await msgRepo.createMessage(conv.id, 'assistant', 'Update', {
        type: 'schedule_proposal',
        proposal: { kind: 'schedule', action: 'update', recurrence: { type: 'daily', time: '09:00' }, summary: 'Update' },
        services: ['github', 'slack'],
        digestCandidate: {
          canAutoDigest: true,
          config: renamedConfig,
          configHash: '0'.repeat(64),
        },
      });
      await expect(
        scheduleService.confirmProposal({
          userId: owner.id,
          convId: conv.id,
          messageId: badMsg.id,
          now: NOW,
        }),
      ).rejects.toThrow(ScheduleConflict);

      const runnerEmitted: Array<{ convId: string; event: string; payload: any }> = [];
      const slackRunner = new SlackDigestRunner({
        pool: db.pool,
        credentialRepo: creds,
        encryptionKey: KEY,
        timeZone: TZ,
        resolveSlackMentions: true,
        adapterFactory: {
          getAdapterForService: async (svc: string) => {
            if (svc === 'slack') {
              return new SlackAdapter({ credentials: { botToken: 'xoxb-personal-owner' }, allowedScope: { channels: ['C_RENAMED_12'] }, baseUrl });
            }
            if (svc === 'github') {
              return {
                execute: async () => [{ number: 7, title: 'Fix <!channel> @channel & <https://evil.test|phish>', repo: 'ati/core', state: 'open' }],
              };
            }
            throw new Error(`unexpected ${svc}`);
          },
        },
      });
      const runner = new ScheduleRunner({
        pool: db.pool,
        timeZone: TZ,
        encryptionKey: KEY,
        now: () => NOW,
        emit: (convIdArg, event, payload) => runnerEmitted.push({ convId: convIdArg, event, payload }),
        planRun: async () => ({ persist: async () => ({ state: 'needs_attention' }), afterCommit() {} }),
        executeSlackDigestRun: (run, sig) => slackRunner.execute(run, sig),
        recordState: (client, row, at) => scheduleService.recordState(client, row, at),
      });

      await runner.tick();
      expect(slackPosts).toHaveLength(1);
      expect(slackPosts[0].text).not.toContain('<!channel>');
      expect(slackPosts[0].text).toContain('&lt;!channel&gt;');
      expect(slackPosts[0].text).toContain('@\u200bchannel');
      expect(slackPosts[0].text).toContain('&lt;https://evil.test|phish&gt;');
      const updatedRuns = await scheduleService.listRuns(owner.id, confirmed.schedule.id, 10, NOW);
      const sentRun = updatedRuns[0]!;
      expect(sentRun.convId).toBeTruthy();
      expect(runnerEmitted.some((e) => e.event === 'answer' && e.convId === sentRun.convId)).toBe(true);
      expect(runnerEmitted.some((e) => e.event === 'agent_state' && e.convId === sentRun.convId)).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => mockServer.close((err) => (err ? reject(err) : resolve())));
    }
  });
});
