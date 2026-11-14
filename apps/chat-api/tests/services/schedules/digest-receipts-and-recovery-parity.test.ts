import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { encryptCredentials } from '@wap/tool-adapters';
import type {
  CalendarDigestConfig,
  GithubDigestConfig,
  NotionDigestConfig,
  NotionDigestSourceBinding,
  ScheduleRecurrence,
} from '@wap/tool-schemas';
import { CredentialRepo } from '../../../src/db/repositories/credential-repo.js';
import {
  computeCalendarDigestHash,
  evaluateCalendarDigestCandidate,
} from '../../../src/services/schedules/calendar-digest-candidate.js';
import {
  CALENDAR_DELIVERY_UNKNOWN,
  createCalendarDigestExecutor,
} from '../../../src/services/schedules/calendar-digest-runner.js';
import {
  computeDigestConfigHash,
  evaluateGithubDigestCandidate,
} from '../../../src/services/schedules/github-digest-candidate.js';
import {
  createGithubDigestRunner,
  GITHUB_DELIVERY_UNKNOWN,
} from '../../../src/services/schedules/github-digest-runner.js';
import {
  computeNotionDigestConfigHash,
  evaluateNotionDigestCandidate,
} from '../../../src/services/schedules/notion-digest-candidate.js';
import { NOTION_DELIVERY_UNKNOWN } from '../../../src/services/schedules/notion-digest-runner.js';
import {
  reconcileScheduleRuns,
  ScheduleRunner,
} from '../../../src/services/schedules/schedule-runner.js';
import { ScheduleService } from '../../../src/services/schedules/schedule-service.js';
import { createMigratedSchema } from '../../helpers/gmail-test-db.js';

const VN = 'Asia/Ho_Chi_Minh';
const KEY = '0123456789abcdef0123456789abcdef';
const GH_CRED_ID = '0b5c1f0e-7a6d-4c1e-9d2a-1a2b3c4d5e11';
const TG_CRED_ID = '0b5c1f0e-7a6d-4c1e-9d2a-1a2b3c4d5e12';
const NOTION_CRED_ID = '0b5c1f0e-7a6d-4c1e-9d2a-1a2b3c4d5e13';
const dailyRecurrence: ScheduleRecurrence = { type: 'daily', time: '08:00' };

type Db = Awaited<ReturnType<typeof createMigratedSchema>>;
type Person = Awaited<ReturnType<Db['person']>>;

describe('PR3: Digest receipts, workspace-scoped Slack lookup, notion_digest error parity, and operator recovery parity', () => {
  let db: Db;
  let owner: Person;
  let credentials: CredentialRepo;
  let service: ScheduleService;
  let now: Date;

  beforeAll(async () => {
    db = await createMigratedSchema('digest_receipts_recovery_pr3');
    credentials = new CredentialRepo(db.pool, KEY);
  });

  beforeEach(async () => {
    await db.pool.query(
      'DELETE FROM schedule_runs; DELETE FROM schedules; DELETE FROM notion_connections; DELETE FROM service_credentials;',
    );
    owner = await db.person('Chủ lịch PR3');
    now = new Date('2026-10-26T01:00:10.000Z');
    service = new ScheduleService({ pool: db.pool, timeZone: VN, encryptionKey: KEY });
  });

  afterAll(async () => {
    await db?.close();
  });

  it('1. GitHub digest persists dispatched_config + dispatched_config_hash on claim and transitions to delivery_unknown on missing/invalid Slack ts or Telegram messageId', async () => {
    await db.pool.query(
      `INSERT INTO service_credentials (id, service, user_id, config, status)
       VALUES ($1, 'github', $3, 'fixture', 'active'), ($2, 'telegram', $3, 'fixture', 'active')`,
      [GH_CRED_ID, TG_CRED_ID, owner.id],
    );

    const slackConfig: GithubDigestConfig = {
      credentialId: GH_CRED_ID,
      githubUserId: '1001',
      login: 'octocat',
      repos: ['nhom/ati'],
      channelId: 'C0123456789',
      channelName: 'team',
      staleDays: 2,
    };
    const slackHash = computeDigestConfigHash({
      config: slackConfig,
      recurrence: dailyRecurrence,
      userId: owner.id,
    });

    for (const badTs of [undefined, '', '   ', 'undefined', 'null']) {
      const convId = (
        await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [owner.id])
      ).rows[0].id as string;
      const sched = (
        await db.pool.query(
          `INSERT INTO schedules(user_id, conv_id, name, request, recurrence, services, status, next_run_at, kind, digest_config, digest_config_hash, digest_approved_at)
           VALUES($1, $2, 'GH Slack', 'Bản tin GH', $3::jsonb, $4, 'active', $5, 'github_digest', $6::jsonb, $7, $8)
           RETURNING *`,
          [
            owner.id,
            convId,
            JSON.stringify(dailyRecurrence),
            ['github', 'slack'],
            new Date('2026-10-26T01:00:00.000Z'),
            JSON.stringify(slackConfig),
            slackHash,
            now,
          ],
        )
      ).rows[0];
      const runRow = (
        await db.pool.query(
          `INSERT INTO schedule_runs(schedule_id, schedule_version, trigger, due_at, status)
           VALUES($1, $2, 'scheduled', $3, 'planning') RETURNING *`,
          [sched.id, sched.version, new Date('2026-10-26T01:00:00.000Z')],
        )
      ).rows[0];

      const runDigest = createGithubDigestRunner({
        pool: db.pool,
        githubConnection: async () => ({
          status: 'connected',
          connection: {
            credentialId: GH_CRED_ID,
            githubUserId: '1001',
            login: 'octocat',
            repos: ['nhom/ati'],
          },
        }),
        getAdapter: async (svc) => ({
          execute: async (tool: string) => {
            if (svc === 'github') return [];
            if (tool === 'slack.search_channels') return [{ id: 'C0123456789', name: 'team' }];
            if (tool === 'slack.send_message') return { ok: true, ts: badTs };
            return [];
          },
        }),
      });

      const outcome = await runDigest(
        {
          runId: runRow.id,
          scheduleId: sched.id,
          scheduleVersion: sched.version,
          userId: owner.id,
          name: sched.name,
          request: sched.request,
          dueAt: new Date('2026-10-26T01:00:00.000Z'),
          trigger: 'scheduled',
          recurrence: dailyRecurrence,
          digestConfig: slackConfig,
          digestConfigHash: slackHash,
        },
        convId,
        new AbortController().signal,
      );

      expect(outcome.state).toBe('delivery_unknown');
      if (outcome.state === 'delivery_unknown') {
        expect(outcome.error).toBe(GITHUB_DELIVERY_UNKNOWN);
        expect(outcome.text).toContain('Bản tin GitHub tự động');
      }

      const persistedRun = (
        await db.pool.query(
          'SELECT delivery_started_at, dispatched_config, dispatched_config_hash FROM schedule_runs WHERE id = $1',
          [runRow.id],
        )
      ).rows[0];
      expect(persistedRun.delivery_started_at).not.toBeNull();
      expect(persistedRun.dispatched_config).toEqual(slackConfig);
      expect(persistedRun.dispatched_config_hash).toBe(slackHash);
    }

    const tgConfig: GithubDigestConfig = {
      ...slackConfig,
      channelId: '',
      channelName: '',
      telegramChatId: '-100999888',
      telegramChatTitle: 'Dev Alerts',
      telegramCredentialId: TG_CRED_ID,
      telegramUserId: '777',
      telegramUsername: 'octo_tg',
    };
    const tgHash = computeDigestConfigHash({
      config: tgConfig,
      recurrence: dailyRecurrence,
      userId: owner.id,
    });

    for (const badMsgId of [undefined, null, 0, -5, 1.5, '123' as any]) {
      const convId = (
        await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [owner.id])
      ).rows[0].id as string;
      const sched = (
        await db.pool.query(
          `INSERT INTO schedules(user_id, conv_id, name, request, recurrence, services, status, next_run_at, kind, digest_config, digest_config_hash, digest_approved_at)
           VALUES($1, $2, 'GH Telegram', 'Bản tin GH TG', $3::jsonb, $4, 'active', $5, 'github_digest', $6::jsonb, $7, $8)
           RETURNING *`,
          [
            owner.id,
            convId,
            JSON.stringify(dailyRecurrence),
            ['github', 'telegram'],
            new Date('2026-10-26T01:00:00.000Z'),
            JSON.stringify(tgConfig),
            tgHash,
            now,
          ],
        )
      ).rows[0];
      const runRow = (
        await db.pool.query(
          `INSERT INTO schedule_runs(schedule_id, schedule_version, trigger, due_at, status)
           VALUES($1, $2, 'scheduled', $3, 'planning') RETURNING *`,
          [sched.id, sched.version, new Date('2026-10-26T01:00:00.000Z')],
        )
      ).rows[0];

      const runDigest = createGithubDigestRunner({
        pool: db.pool,
        githubConnection: async () => ({
          status: 'connected',
          connection: {
            credentialId: GH_CRED_ID,
            githubUserId: '1001',
            login: 'octocat',
            repos: ['nhom/ati'],
          },
        }),
        telegramConnection: async () => ({
          status: 'connected',
          connection: {
            credentialId: TG_CRED_ID,
            telegramUserId: '777',
            username: 'octo_tg',
            chatIds: ['-100999888'],
          },
        }),
        getAdapter: async (svc) => ({
          execute: async () => {
            if (svc === 'github') return [];
            return { messageId: badMsgId };
          },
        }),
      });

      const outcome = await runDigest(
        {
          runId: runRow.id,
          scheduleId: sched.id,
          scheduleVersion: sched.version,
          userId: owner.id,
          name: sched.name,
          request: sched.request,
          dueAt: new Date('2026-10-26T01:00:00.000Z'),
          trigger: 'scheduled',
          recurrence: dailyRecurrence,
          digestConfig: tgConfig,
          digestConfigHash: tgHash,
        },
        convId,
        new AbortController().signal,
      );

      expect(outcome.state).toBe('delivery_unknown');
      if (outcome.state === 'delivery_unknown') {
        expect(outcome.error).toBe(GITHUB_DELIVERY_UNKNOWN);
        expect(outcome.text).toContain('Bản tin GitHub tự động');
      }
    }
  });

  it('2. Calendar digest persists Slack ts and Telegram messageId receipts, transitions to delivery_unknown when missing, and scopes Slack credential lookup by workspace_id', async () => {
    const mycal = await credentials.saveCredentials(
      'mycalendar',
      encryptCredentials(
        {
          refreshToken: '1//cal-refresh',
          email: 'owner@example.test',
          scopes: ['openid', 'email', 'https://www.googleapis.com/auth/calendar'],
          selectedCalendars: [{ id: 'primary', summary: 'Lịch chính', primary: true }],
          allowedScope: { calendars: ['primary'] },
          connectedAt: now.toISOString(),
        },
        KEY,
      ),
      owner.id,
    );

    const orgA = (
      await db.pool.query(
        "INSERT INTO workspaces(name, invite_code, created_by) VALUES('Org A', 'INV-ORGA', $1) RETURNING id",
        [owner.id],
      )
    ).rows[0].id as string;
    const orgB = (
      await db.pool.query(
        "INSERT INTO workspaces(name, invite_code, created_by) VALUES('Org B', 'INV-ORGB', $1) RETURNING id",
        [owner.id],
      )
    ).rows[0].id as string;

    // Seed Slack credentials for Org B (channel C0999999999), Personal user (C0111111111), and Legacy null/null (C0222222222)
    await db.pool.query(
      `INSERT INTO service_credentials (service, user_id, workspace_id, config, status)
       VALUES
         ('slack', NULL, $1, $2, 'active'),
         ('slack', $3, NULL, $4, 'active'),
         ('slack', NULL, NULL, $5, 'active')`,
      [
        orgB,
        encryptCredentials({ botToken: 'xoxb-orgb', allowedScope: { channels: ['C0999999999'] } }, KEY),
        owner.id,
        encryptCredentials({ botToken: 'xoxb-personal', allowedScope: { channels: ['C0111111111'] } }, KEY),
        encryptCredentials({ botToken: 'xoxb-legacy', allowedScope: { channels: ['C0222222222'] } }, KEY),
      ],
    );

    // Org A has no Slack credential -> must NOT pick up Org B, Personal, or Legacy Slack credential
    const evalOrgA = await evaluateCalendarDigestCandidate({
      pool: db.pool,
      encryptionKey: KEY,
      userId: owner.id,
      services: ['mycalendar', 'slack'],
      request: 'Gửi bản tin lịch mỗi sáng lên Slack',
      workspaceMode: 'organization',
      workspaceId: orgA,
    });
    expect(evalOrgA.candidate.canAutoDigest).toBe(false);

    // Organization mode missing workspaceId -> fail-closed
    const evalOrgMissing = await evaluateCalendarDigestCandidate({
      pool: db.pool,
      encryptionKey: KEY,
      userId: owner.id,
      services: ['mycalendar', 'slack'],
      request: 'Gửi bản tin lịch mỗi sáng lên Slack',
      workspaceMode: 'organization',
      workspaceId: null,
    });
    expect(evalOrgMissing.candidate.canAutoDigest).toBe(false);

    // Org B picks up Org B's Slack channel C0999999999
    const evalOrgB = await evaluateCalendarDigestCandidate({
      pool: db.pool,
      encryptionKey: KEY,
      userId: owner.id,
      services: ['mycalendar', 'slack'],
      request: 'Gửi bản tin lịch mỗi sáng lên Slack',
      workspaceMode: 'organization',
      workspaceId: orgB,
    });
    expect(evalOrgB.candidate.canAutoDigest).toBe(true);
    expect(evalOrgB.config?.destination).toEqual({
      service: 'slack',
      channelId: 'C0999999999',
    });

    // Updating calendar_digest in Organization mode preserves kind='calendar_digest' using Org B Slack scope
    await db.pool.query(
      "INSERT INTO workspace_members(workspace_id, user_id, role, status) VALUES($1, $2, 'member', 'active')",
      [orgB, owner.id],
    );
    const orgConvId = (
      await db.pool.query(
        "INSERT INTO conversations(user_id, workspace_id, workspace_mode) VALUES($1, $2, 'organization') RETURNING id",
        [owner.id, orgB],
      )
    ).rows[0].id as string;
    const calService = new ScheduleService({ pool: db.pool, timeZone: VN, encryptionKey: KEY });
    const createCalMeta = {
      type: 'schedule_proposal',
      proposal: {
        kind: 'schedule',
        action: 'create',
        name: 'Cal Org B',
        request: 'Gửi bản tin lịch mỗi sáng lên Slack',
        recurrence: dailyRecurrence,
        summary: 'Lịch Org B',
      },
      scheduleId: null,
      baseVersion: null,
      services: ['mycalendar', 'slack'],
      nextRuns: [new Date(now.getTime() + 60_000).toISOString()],
      previous: null,
      digestCandidate: evalOrgB.candidate,
    };
    const createMsgId = (
      await db.pool.query(
        "INSERT INTO messages(conv_id, role, content, metadata) VALUES($1, 'assistant', 'Lịch Org B', $2::jsonb) RETURNING id",
        [orgConvId, JSON.stringify(createCalMeta)],
      )
    ).rows[0].id as string;
    const createdOrgCal = await calService.confirmProposal({
      userId: owner.id,
      convId: orgConvId,
      messageId: createMsgId,
      now,
      scope: { workspaceMode: 'organization', workspaceId: orgB },
      approvalMode: 'auto_digest',
    });
    expect(createdOrgCal.schedule.kind).toBe('calendar_digest');

    const updateCalMeta = {
      ...createCalMeta,
      proposal: { ...createCalMeta.proposal, action: 'update', summary: 'Cập nhật giờ Org B' },
      scheduleId: createdOrgCal.schedule.id,
      baseVersion: createdOrgCal.schedule.version,
    };
    const updateMsgId = (
      await db.pool.query(
        "INSERT INTO messages(conv_id, role, content, metadata) VALUES($1, 'assistant', 'Cập nhật Org B', $2::jsonb) RETURNING id",
        [orgConvId, JSON.stringify(updateCalMeta)],
      )
    ).rows[0].id as string;
    const updatedOrgCal = await calService.confirmProposal({
      userId: owner.id,
      convId: orgConvId,
      messageId: updateMsgId,
      now: new Date(now.getTime() + 1000),
      scope: { workspaceMode: 'organization', workspaceId: orgB },
      approvalMode: 'auto_digest',
    });
    expect(updatedOrgCal.schedule.kind).toBe('calendar_digest');

    // Personal mode picks up user_id = owner.id, workspace_id IS NULL Slack channel C0111111111 (never legacy C0222222222)
    const evalPersonal = await evaluateCalendarDigestCandidate({
      pool: db.pool,
      encryptionKey: KEY,
      userId: owner.id,
      services: ['mycalendar', 'slack'],
      request: 'Gửi bản tin lịch mỗi sáng lên Slack',
      workspaceMode: 'personal',
      workspaceId: null,
    });
    expect(evalPersonal.candidate.canAutoDigest).toBe(true);
    expect(evalPersonal.config?.destination).toEqual({
      service: 'slack',
      channelId: 'C0111111111',
    });

    // Legacy mode picks up user_id IS NULL, workspace_id IS NULL Slack channel C0222222222
    const evalLegacy = await evaluateCalendarDigestCandidate({
      pool: db.pool,
      encryptionKey: KEY,
      userId: owner.id,
      services: ['mycalendar', 'slack'],
      request: 'Gửi bản tin lịch mỗi sáng lên Slack',
      workspaceMode: 'legacy',
      workspaceId: null,
    });
    expect(evalLegacy.candidate.canAutoDigest).toBe(true);
    expect(evalLegacy.config?.destination).toEqual({
      service: 'slack',
      channelId: 'C0222222222',
    });

    // Verify Calendar runner receipt validation & persistence for Slack
    const convId = (
      await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [owner.id])
    ).rows[0].id as string;
    const calSlackConfig = evalPersonal.config!;
    const calSlackHash = computeCalendarDigestHash(calSlackConfig);
    const calSched = (
      await db.pool.query(
        `INSERT INTO schedules(user_id, conv_id, name, request, recurrence, services, status, next_run_at, kind, digest_config, digest_config_hash, digest_approved_at)
         VALUES($1, $2, 'Cal Slack', 'Lịch sáng', $3::jsonb, $4, 'active', $5, 'calendar_digest', $6::jsonb, $7, $8)
         RETURNING *`,
        [
          owner.id,
          convId,
          JSON.stringify(dailyRecurrence),
          ['mycalendar', 'slack'],
          now,
          JSON.stringify(calSlackConfig),
          calSlackHash,
          now,
        ],
      )
    ).rows[0];

    const runValid = (
      await db.pool.query(
        `INSERT INTO schedule_runs(schedule_id, schedule_version, trigger, due_at, status)
         VALUES($1, $2, 'scheduled', $3, 'planning') RETURNING *`,
        [calSched.id, calSched.version, now],
      )
    ).rows[0];

    let mockSlackTs: any = '1730000111.000200';
    const calExecutor = createCalendarDigestExecutor({
      pool: db.pool,
      encryptionKey: KEY,
      timeZone: VN,
      getAdapter: async (svc) => {
        if (svc === 'mycalendar') {
          return {
            execute: async () => ({
              events: [],
              coverage: { complete: true, returned: 0, totalAvailable: 0 },
            }),
          };
        }
        return {
          execute: async () => ({ ts: mockSlackTs }),
        };
      },
    });

    const sentOutcome = await calExecutor(
      {
        runId: runValid.id,
        scheduleId: calSched.id,
        scheduleVersion: calSched.version,
        userId: owner.id,
        name: calSched.name,
        request: calSched.request,
        dueAt: now,
        trigger: 'scheduled',
        workspaceMode: 'personal',
        workspaceId: null,
        digestConfig: calSlackConfig,
        digestConfigHash: calSlackHash,
      },
      new AbortController().signal,
    );
    expect(sentOutcome.state).toBe('digest_sent');
    if (sentOutcome.state === 'digest_sent') {
      expect(sentOutcome.delivery.ts).toBe('1730000111.000200');
      await db.pool.query(
        "UPDATE schedule_runs SET status = 'digest_sent', delivery = $2::jsonb WHERE id = $1",
        [runValid.id, JSON.stringify(sentOutcome.delivery)],
      );
    }

    // Missing Slack ts transitions to delivery_unknown with CALENDAR_DELIVERY_UNKNOWN
    mockSlackTs = 'undefined';
    const runMissingTs = (
      await db.pool.query(
        `INSERT INTO schedule_runs(schedule_id, schedule_version, trigger, due_at, status)
         VALUES($1, $2, 'scheduled', $3, 'planning') RETURNING *`,
        [calSched.id, calSched.version, new Date(now.getTime() + 60_000)],
      )
    ).rows[0];
    const unknownOutcome = await calExecutor(
      {
        runId: runMissingTs.id,
        scheduleId: calSched.id,
        scheduleVersion: calSched.version,
        userId: owner.id,
        name: calSched.name,
        request: calSched.request,
        dueAt: now,
        trigger: 'scheduled',
        workspaceMode: 'personal',
        workspaceId: null,
        digestConfig: calSlackConfig,
        digestConfigHash: calSlackHash,
      },
      new AbortController().signal,
    );
    expect(unknownOutcome).toEqual({
      state: 'delivery_unknown',
      error: CALENDAR_DELIVERY_UNKNOWN,
    });
    await db.pool.query("UPDATE schedule_runs SET status = 'needs_attention' WHERE id = $1", [
      runMissingTs.id,
    ]);

    // Runner also blocks if run is in Org A (which has no Slack credential) even though Org B has one
    const runOrgA = (
      await db.pool.query(
        `INSERT INTO schedule_runs(schedule_id, schedule_version, trigger, due_at, status)
         VALUES($1, $2, 'scheduled', $3, 'planning') RETURNING *`,
        [calSched.id, calSched.version, new Date(now.getTime() + 120_000)],
      )
    ).rows[0];
    const blockedOrgA = await calExecutor(
      {
        runId: runOrgA.id,
        scheduleId: calSched.id,
        scheduleVersion: calSched.version,
        userId: owner.id,
        name: calSched.name,
        request: calSched.request,
        dueAt: now,
        trigger: 'scheduled',
        workspaceMode: 'organization',
        workspaceId: orgA,
        digestConfig: calSlackConfig,
        digestConfigHash: calSlackHash,
      },
      new AbortController().signal,
    );
    expect(blockedOrgA.state).toBe('blocked');
    expect(mycal.id).toBeTruthy();
  });

  it('3. propagates workspaceMode and workspaceId to Slack getAdapter in evaluateGithubDigestCandidate and evaluateNotionDigestCandidate', async () => {
    const seenContexts: Array<{ candidate: string; context: any }> = [];

    await evaluateGithubDigestCandidate({
      userId: owner.id,
      scopeId: 'org-workspace-123',
      request: 'Gửi bản tin GitHub repo nhom/ati lên Slack #team',
      services: ['github', 'slack'],
      recurrence: dailyRecurrence,
      githubConnection: async () => ({
        status: 'connected',
        connection: {
          credentialId: GH_CRED_ID,
          githubUserId: '1001',
          login: 'octocat',
          repos: ['nhom/ati'],
        },
      }),
      getAdapter: async (serviceName, context) => {
        if (serviceName === 'slack') {
          seenContexts.push({ candidate: 'github_org', context });
          return { execute: async () => [{ id: 'C0123456789', name: 'team' }] };
        }
        return null;
      },
    });

    await evaluateGithubDigestCandidate({
      userId: owner.id,
      scopeId: `personal:${owner.id}`,
      request: 'Gửi bản tin GitHub repo nhom/ati lên Slack #team',
      services: ['github', 'slack'],
      recurrence: dailyRecurrence,
      githubConnection: async () => ({
        status: 'connected',
        connection: {
          credentialId: GH_CRED_ID,
          githubUserId: '1001',
          login: 'octocat',
          repos: ['nhom/ati'],
        },
      }),
      getAdapter: async (serviceName, context) => {
        if (serviceName === 'slack') {
          seenContexts.push({ candidate: 'github_personal', context });
          return { execute: async () => [{ id: 'C0123456789', name: 'team' }] };
        }
        return null;
      },
    });

    const mockBinding: NotionDigestSourceBinding = {
      version: 1,
      ownerId: owner.id,
      credentialId: NOTION_CRED_ID,
      appId: 'app-1',
      workspaceId: 'ws-notion-1',
      actorId: 'actor-1',
      botId: 'bot-1',
      identityVersion: 1,
      workspaceName: 'Notion WS',
      databases: [{ databaseId: 'db-1', dataSourceId: 'ds-1', title: 'Sprint Tasks' }],
    };

    await evaluateNotionDigestCandidate({
      userId: owner.id,
      request: 'Gửi bản tin Notion Sprint Tasks lên Slack #team',
      services: ['notion', 'slack'],
      recurrence: dailyRecurrence,
      workspaceMode: 'legacy',
      notionSources: {
        prepare: async () => mockBinding,
      },
      getAdapter: async (serviceName, context) => {
        if (serviceName === 'slack') {
          seenContexts.push({ candidate: 'notion_legacy', context });
          return { execute: async () => [{ id: 'C0123456789', name: 'team' }] };
        }
        return null;
      },
    });

    await evaluateGithubDigestCandidate({
      userId: owner.id,
      scopeId: `personal:${owner.id}`,
      workspaceMode: 'legacy',
      workspaceId: null,
      request: 'Gửi bản tin GitHub repo nhom/ati lên Slack #team',
      services: ['github', 'slack'],
      recurrence: dailyRecurrence,
      githubConnection: async () => ({
        status: 'connected',
        connection: {
          credentialId: GH_CRED_ID,
          githubUserId: '1001',
          login: 'octocat',
          repos: ['nhom/ati'],
        },
      }),
      getAdapter: async (serviceName, context) => {
        if (serviceName === 'slack') {
          seenContexts.push({ candidate: 'github_legacy', context });
          return { execute: async () => [{ id: 'C0123456789', name: 'team' }] };
        }
        return null;
      },
    });

    await evaluateNotionDigestCandidate({
      userId: owner.id,
      request: 'Gửi bản tin Notion Sprint Tasks lên Slack #team',
      services: ['notion', 'slack'],
      recurrence: dailyRecurrence,
      workspaceMode: 'personal',
      notionSources: {
        prepare: async () => mockBinding,
      },
      getAdapter: async (serviceName, context) => {
        if (serviceName === 'slack') {
          seenContexts.push({ candidate: 'notion_personal', context });
          return { execute: async () => [{ id: 'C0123456789', name: 'team' }] };
        }
        return null;
      },
    });

    expect(seenContexts).toEqual([
      {
        candidate: 'github_org',
        context: {
          userId: owner.id,
          workspaceMode: 'organization',
          workspaceId: 'org-workspace-123',
          phase: 'planning',
        },
      },
      {
        candidate: 'github_personal',
        context: {
          userId: owner.id,
          workspaceMode: 'personal',
          workspaceId: null,
          phase: 'planning',
        },
      },
      {
        candidate: 'notion_legacy',
        context: {
          userId: owner.id,
          workspaceMode: 'legacy',
          workspaceId: null,
          phase: 'planning',
        },
      },
      {
        candidate: 'github_legacy',
        context: {
          userId: owner.id,
          workspaceMode: 'legacy',
          workspaceId: null,
          phase: 'planning',
        },
      },
      {
        candidate: 'notion_personal',
        context: {
          userId: owner.id,
          workspaceMode: 'personal',
          workspaceId: null,
          phase: 'planning',
        },
      },
    ]);
  });

  it('4. ScheduleRunner uses NOTION_DELIVERY_UNKNOWN for notion_digest in reconcileScheduleRuns and executeGithubDigestOne', async () => {
    const convId = (
      await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [owner.id])
    ).rows[0].id as string;
    const notionBinding: NotionDigestSourceBinding = {
      version: 1,
      ownerId: owner.id,
      credentialId: NOTION_CRED_ID,
      appId: 'app-1',
      workspaceId: 'ws-notion-1',
      actorId: 'actor-1',
      botId: 'bot-1',
      identityVersion: 1,
      workspaceName: 'Notion WS',
      databases: [{ databaseId: 'db-1', dataSourceId: 'ds-1', title: 'Sprint Tasks' }],
    };
    const notionConfig: NotionDigestConfig = {
      notionBinding,
      credentialId: NOTION_CRED_ID,
      workspaceId: 'ws-notion-1',
      workspaceName: 'Notion WS',
      botId: 'bot-1',
      identityVersion: 1,
      databases: [{ id: 'db-1', title: 'Sprint Tasks' }],
      channelId: 'C0123456789',
      channelName: 'team',
    };
    const notionHash = computeNotionDigestConfigHash({
      config: notionConfig,
      recurrence: dailyRecurrence,
      userId: owner.id,
    });

    const sched = (
      await db.pool.query(
        `INSERT INTO schedules(user_id, conv_id, name, request, recurrence, services, status, next_run_at, kind, digest_config, digest_config_hash, digest_approved_at)
         VALUES($1, $2, 'Notion Digest', 'Gửi bản tin Notion', $3::jsonb, $4, 'active', $5, 'notion_digest', $6::jsonb, $7, $8)
         RETURNING *`,
        [
          owner.id,
          convId,
          JSON.stringify(dailyRecurrence),
          ['notion', 'slack'],
          now,
          JSON.stringify(notionConfig),
          notionHash,
          now,
        ],
      )
    ).rows[0];

    const runReconcile = (
      await db.pool.query(
        `INSERT INTO schedule_runs(schedule_id, schedule_version, trigger, due_at, status, delivery_started_at, conv_id)
         VALUES($1, $2, 'scheduled', $3, 'planning', now(), $4) RETURNING *`,
        [sched.id, sched.version, now, convId],
      )
    ).rows[0];

    await reconcileScheduleRuns(db.pool);

    const reconciledRow = (
      await db.pool.query('SELECT status, error FROM schedule_runs WHERE id = $1', [runReconcile.id])
    ).rows[0];
    expect(reconciledRow.status).toBe('needs_attention');
    expect(reconciledRow.error).toBe(NOTION_DELIVERY_UNKNOWN);
    expect(reconciledRow.error).toContain('NOTION_DELIVERY_UNKNOWN');

    // Also test executeGithubDigestOne fallback when delivery_started_at is set and outcome is not digest_sent
    const runFallback = (
      await db.pool.query(
        `INSERT INTO schedule_runs(schedule_id, schedule_version, trigger, due_at, status)
         VALUES($1, $2, 'manual', $3, 'planning') RETURNING *`,
        [sched.id, sched.version, new Date(now.getTime() + 60_000)],
      )
    ).rows[0];

    const runner = new ScheduleRunner({
      pool: db.pool,
      timeZone: VN,
      now: () => now,
      planRun: async () => ({ persist: async () => ({ state: 'needs_attention' }), afterCommit() {} }),
      runNotionDigest: async (run) => {
        await db.pool.query(
          'UPDATE schedule_runs SET delivery_started_at = now() WHERE id = $1',
          [run.runId],
        );
        throw new Error('Unexpected crash after Notion Slack dispatch started');
      },
      recordState: (client, row, at) => service.recordState(client, row, at),
    });

    await runner.planNow(runFallback.id);
    await runner.stop();

    const fallbackRow = (
      await db.pool.query('SELECT status, error FROM schedule_runs WHERE id = $1', [runFallback.id])
    ).rows[0];
    expect(fallbackRow.status).toBe('needs_attention');
    expect(fallbackRow.error).toBe(NOTION_DELIVERY_UNKNOWN);
  });

  it('5. ScheduleService.resolveRunDelivery supports mark_sent and retry_new_run (requiring confirmDuplicateRisk: true) for github_digest, notion_digest, and calendar_digest', async () => {
    const mycal = await credentials.saveCredentials(
      'mycalendar',
      encryptCredentials(
        {
          refreshToken: '1//cal-refresh',
          email: 'owner@example.test',
          scopes: ['openid', 'email', 'https://www.googleapis.com/auth/calendar'],
          selectedCalendars: [{ id: 'primary', summary: 'Lịch chính', primary: true }],
          allowedScope: { calendars: ['primary'] },
          connectedAt: now.toISOString(),
        },
        KEY,
      ),
      owner.id,
    );
    await db.pool.query(
      `INSERT INTO service_credentials (id, service, user_id, config, status)
       VALUES ($1, 'github', $2, 'fixture', 'active')`,
      [GH_CRED_ID, owner.id],
    );
    const NOTION_DB_ID = '11111111-1111-4111-8111-111111111111';
    const NOTION_DS_ID = '22222222-2222-4222-8222-222222222222';
    await db.pool.query(
      `INSERT INTO notion_connections (
         id, user_id, app_id, workspace_id, workspace_name, bot_id, actor_id,
         status, identity_version, config, scopes, allowed_databases, selected_databases
       ) VALUES ($1, $2, 'app-1', 'ws-notion-1', 'Notion WS', 'bot-1', 'actor-1', 'active', 1, 'enc', '{}', $3, $4::jsonb)`,
      [
        NOTION_CRED_ID,
        owner.id,
        [NOTION_DB_ID],
        JSON.stringify([{ id: NOTION_DB_ID, title: 'Sprint Tasks' }]),
      ],
    );

    const ghConfig: GithubDigestConfig = {
      credentialId: GH_CRED_ID,
      githubUserId: '1001',
      login: 'octocat',
      repos: ['nhom/ati'],
      channelId: 'C0123456789',
      channelName: 'team',
      staleDays: 2,
    };
    const ghHash = computeDigestConfigHash({
      config: ghConfig,
      recurrence: dailyRecurrence,
      userId: owner.id,
    });

    const notionBinding: NotionDigestSourceBinding = {
      version: 1,
      ownerId: owner.id,
      credentialId: NOTION_CRED_ID,
      appId: 'app-1',
      workspaceId: 'ws-notion-1',
      actorId: 'actor-1',
      botId: 'bot-1',
      identityVersion: 1,
      workspaceName: 'Notion WS',
      databases: [{ databaseId: NOTION_DB_ID, dataSourceId: NOTION_DS_ID, title: 'Sprint Tasks' }],
    };
    const notionConfig: NotionDigestConfig = {
      notionBinding,
      credentialId: NOTION_CRED_ID,
      workspaceId: 'ws-notion-1',
      workspaceName: 'Notion WS',
      botId: 'bot-1',
      identityVersion: 1,
      databases: [{ id: NOTION_DB_ID, title: 'Sprint Tasks' }],
      channelId: 'C0123456789',
      channelName: 'team',
    };
    const notionHash = computeNotionDigestConfigHash({
      config: notionConfig,
      recurrence: dailyRecurrence,
      userId: owner.id,
    });

    const calConfig: CalendarDigestConfig = {
      version: 1,
      source: 'mycalendar',
      credentialId: mycal.id,
      email: 'owner@example.test',
      calendars: [{ id: 'primary', summary: 'Lịch chính', primary: true }],
      destination: { service: 'slack', channelId: 'C0123456789', channelName: 'team' },
      windowHours: 24,
      includeSummary: true,
    };
    const calHash = computeCalendarDigestHash(calConfig);

    const cases = [
      {
        kind: 'github_digest' as const,
        services: ['github', 'slack'],
        config: ghConfig,
        hash: ghHash,
        error: GITHUB_DELIVERY_UNKNOWN,
      },
      {
        kind: 'notion_digest' as const,
        services: ['notion', 'slack'],
        config: notionConfig,
        hash: notionHash,
        error: NOTION_DELIVERY_UNKNOWN,
      },
      {
        kind: 'calendar_digest' as const,
        services: ['mycalendar', 'slack'],
        config: calConfig,
        hash: calHash,
        error: CALENDAR_DELIVERY_UNKNOWN,
      },
    ];

    for (const c of cases) {
      const convId = (
        await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [owner.id])
      ).rows[0].id as string;
      const sched = (
        await db.pool.query(
          `INSERT INTO schedules(user_id, conv_id, name, request, recurrence, services, status, next_run_at, kind, digest_config, digest_config_hash, digest_approved_at)
           VALUES($1, $2, $3, 'Digest request', $4::jsonb, $5, 'active', $6, $7, $8::jsonb, $9, $6)
           RETURNING *`,
          [
            owner.id,
            convId,
            `Schedule ${c.kind}`,
            JSON.stringify(dailyRecurrence),
            c.services,
            now,
            c.kind,
            JSON.stringify(c.config),
            c.hash,
          ],
        )
      ).rows[0];

      // 5a. mark_sent
      const runToMark = (
        await db.pool.query(
          `INSERT INTO schedule_runs(schedule_id, schedule_version, trigger, due_at, status, delivery_started_at, error, dispatched_config, dispatched_config_hash, conv_id)
           VALUES($1, $2, 'scheduled', $3, 'needs_attention', now(), $4, $5::jsonb, $6, $7) RETURNING *`,
          [sched.id, sched.version, now, c.error, JSON.stringify(c.config), c.hash, convId],
        )
      ).rows[0];

      const markedRes = await service.resolveRunDelivery({
        userId: owner.id,
        runId: runToMark.id,
        resolution: 'mark_sent',
        now,
      });
      expect(markedRes.run.state).toBe('digest_sent');
      expect(markedRes.run.deliveryResolution).toBe('confirmed_sent');
      expect(markedRes.followUpRun).toBeNull();
      expect((markedRes.run.delivery as any)?.manualResolution?.status).toBe('confirmed_sent');

      // 5b. retry_new_run requires confirmDuplicateRisk: true
      const runToRetry = (
        await db.pool.query(
          `INSERT INTO schedule_runs(schedule_id, schedule_version, trigger, due_at, status, delivery_started_at, error, dispatched_config, dispatched_config_hash, conv_id)
           VALUES($1, $2, 'scheduled', $3, 'needs_attention', now(), $4, $5::jsonb, $6, $7) RETURNING *`,
          [
            sched.id,
            sched.version,
            new Date(now.getTime() + 60_000),
            c.error,
            JSON.stringify(c.config),
            c.hash,
            convId,
          ],
        )
      ).rows[0];

      await expect(
        service.resolveRunDelivery({
          userId: owner.id,
          runId: runToRetry.id,
          resolution: 'retry_new_run',
          confirmDuplicateRisk: false,
          now,
        }),
      ).rejects.toMatchObject({ code: 'DUPLICATE_RISK_CONFIRMATION_REQUIRED' });

      const retriedRes = await service.resolveRunDelivery({
        userId: owner.id,
        runId: runToRetry.id,
        resolution: 'retry_new_run',
        confirmDuplicateRisk: true,
        now,
      });
      expect(retriedRes.run.deliveryResolution).toBe('retried_new_run');
      expect(retriedRes.followUpRun).not.toBeNull();
      expect(retriedRes.followUpRun?.state).toBe('planning');
      expect(retriedRes.run.deliveryFollowupRunId).toBe(retriedRes.followUpRun?.id);
    }
  });
});
