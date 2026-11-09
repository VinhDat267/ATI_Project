import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import pg from 'pg';
import { encryptCredentials, GlobalRateLimiter, SlackAdapter, StepError, TelegramAdapter } from '@wap/tool-adapters';
import type { GithubDigestConfig, ScheduleRecurrence } from '@wap/tool-schemas';
import { AdapterFactory } from '../../../src/services/adapter-factory.js';
import { CredentialRepo } from '../../../src/db/repositories/credential-repo.js';
import { GitHubTeamRepo } from '../../../src/db/repositories/github-team-repo.js';
import { createGitHubConnectionLookup } from '../../../src/services/github/connection-reference.js';
import { GitHubTokenManager } from '../../../src/services/github/token-manager.js';
import { ScheduleRunner } from '../../../src/services/schedules/schedule-runner.js';
import { ScheduleService } from '../../../src/services/schedules/schedule-service.js';
import { computeDigestConfigHash, evaluateGithubDigestCandidate } from '../../../src/services/schedules/github-digest-candidate.js';
import { createGithubDigestRunner, escapeSlackMrkdwn } from '../../../src/services/schedules/github-digest-runner.js';
import { createMigratedSchema } from '../../helpers/gmail-test-db.js';

const VN = 'Asia/Ho_Chi_Minh';
// Real personal credential rows (service_credentials) pinned by the digest config; the live digest
// scope guard (PR-R1-C1) rejects missing, malformed, stale or foreign credential pins.
const GH_CRED_ID = '0b5c1f0e-7a6d-4c1e-9d2a-1a2b3c4d5e01';
const TG_CRED_ID = '0b5c1f0e-7a6d-4c1e-9d2a-1a2b3c4d5e02';
type Db = Awaited<ReturnType<typeof createMigratedSchema>>;
type Person = Awaited<ReturnType<Db['person']>>;

describe('Task 8: GitHub auto_digest execution in ScheduleRunner on PostgreSQL', () => {
  let db: Db;
  let owner: Person;
  let now: Date;
  let service: ScheduleService;

  const baseConfig: GithubDigestConfig = {
    credentialId: GH_CRED_ID,
    githubUserId: '1001',
    login: 'octocat',
    repos: ['nhom/ati'],
    channelId: 'C0123456789',
    channelName: 'team',
    staleDays: 2,
  };

  const dailyRecurrence: ScheduleRecurrence = { type: 'daily', time: '08:00' };

  const insertDigestSchedule = async (overrides: Partial<{
    config: GithubDigestConfig;
    configHash: string;
    recurrence: ScheduleRecurrence;
    nextRunAt: Date;
  }> = {}) => {
    const convId = (await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [owner.id])).rows[0].id as string;
    const config = overrides.config ?? baseConfig;
    const recurrence = overrides.recurrence ?? dailyRecurrence;
    const configHash = overrides.configHash ?? computeDigestConfigHash({ config, recurrence, userId: owner.id });
    const nextRunAt = overrides.nextRunAt ?? new Date('2026-10-26T01:00:00.000Z'); // 08:00 VN
    const res = await db.pool.query(
      `INSERT INTO schedules(
         user_id, conv_id, name, request, recurrence, services, status, next_run_at,
         kind, digest_config, digest_config_hash, digest_approved_at
       )
       VALUES($1, $2, 'Bản tin GitHub', 'Gửi bản tin GitHub repo nhom/ati lên Slack #team', $3, $4, 'active', $5, 'github_digest', $6, $7, $8)
       RETURNING *`,
      [
        owner.id,
        convId,
        JSON.stringify(recurrence),
        ['github', 'slack'],
        nextRunAt,
        JSON.stringify(config),
        configHash,
        now,
      ],
    );
    return res.rows[0];
  };

  beforeAll(async () => {
    db = await createMigratedSchema('github_digest_runner');
  });

  beforeEach(async () => {
    await db.pool.query('DELETE FROM schedule_runs; DELETE FROM schedules;');
    owner = await db.person('Chủ lịch');
    await db.pool.query(
      `INSERT INTO service_credentials (id, service, user_id, config, status)
       VALUES ($1, 'github', $3, 'fixture', 'active'), ($2, 'telegram', $3, 'fixture', 'active')
       ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, workspace_id = NULL, status = 'active'`,
      [GH_CRED_ID, TG_CRED_ID, owner.id],
    );
    now = new Date('2026-10-26T01:00:10.000Z'); // 08:00:10 VN
    service = new ScheduleService({ pool: db.pool, timeZone: VN });
  });

  afterAll(async () => {
    await db?.close();
  });

  it('escapes dangerous Slack tokens (&, <, >, <!channel>, @channel, @here)', () => {
    const raw = 'Fix <!channel> & <https://evil.example|click> @here @channel';
    const escaped = escapeSlackMrkdwn(raw);
    expect(escaped).not.toContain('<!channel>');
    expect(escaped).not.toContain('<https://evil.example');
    expect(escaped).toContain('&amp;');
    expect(escaped).toContain('&lt;!channel&gt;');
  });

  it('1. executes first scheduled run with SINCE = dueAt - 24h, escapes title, sends 1 Slack message, records digest_sent + delivery + answer message, and keeps pendingCount = 0', async () => {
    const schedule = await insertDigestSchedule();
    const githubQueries: string[] = [];
    const slackMessages: Array<{ channel: string; text: string }> = [];

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
      getAdapter: async (serviceName) => {
        if (serviceName === 'github') {
          return {
            execute: async (tool: string, args: any) => {
              if (tool === 'github.search_issues') {
                githubQueries.push(args.query);
                if (args.query.includes('created:>=')) {
                  return [{ id: '1', number: 12, title: 'Bug <!channel> & <https://evil.example>', state: 'open' }];
                }
                if (args.query.includes('is:pr')) {
                  return [{ id: '2', number: 15, title: 'PR refactor auth', state: 'open' }];
                }
                if (args.query.includes('no:assignee')) {
                  return [{ id: '3', number: 18, title: 'Unassigned docs issue', state: 'open' }];
                }
              }
              return [];
            },
          };
        }
        if (serviceName === 'slack') {
          return {
            execute: async (tool: string, args: any) => {
              if (tool === 'slack.search_channels') {
                return [{ id: 'C0123456789', name: 'team' }];
              }
              if (tool === 'slack.send_message') {
                slackMessages.push({ channel: args.channel, text: args.text });
                return { ok: true, channel: args.channel, ts: '1730000000.000100' };
              }
              return [];
            },
          };
        }
        return null;
      },
    });

    const runner = new ScheduleRunner({
      pool: db.pool,
      timeZone: VN,
      now: () => now,
      planRun: async () => ({ persist: async () => ({ state: 'needs_attention' }), afterCommit() {} }),
      runDigest,
      recordState: (client, row, at) => service.recordState(client, row, at),
    });

    await runner.tick();
    await runner.stop();

    // Verify SINCE = dueAt (2026-10-26T01:00:00Z) - 24h = 2026-10-25T01:00:00Z
    expect(githubQueries.some((q) => q.includes('created:>=2026-10-25T01:00:00Z'))).toBe(true);
    expect(slackMessages).toHaveLength(1);
    expect(slackMessages[0]!.channel).toBe('C0123456789');
    expect(slackMessages[0]!.text).toContain('@octocat');
    expect(slackMessages[0]!.text).toContain('&lt;!channel&gt; &amp; &lt;https://evil.example&gt;');
    expect(slackMessages[0]!.text).not.toContain('<!channel>');

    const runs = await service.listRuns(owner.id, schedule.id, 10, now);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      state: 'digest_sent',
      delivery: {
        channelId: 'C0123456789',
        channelName: 'team',
        ts: '1730000000.000100',
        counts: { newIssues: 1, stalePrs: 1, unassignedIssues: 1 },
      },
    });

    const convMessages = (await db.pool.query("SELECT role, content, metadata FROM messages WHERE conv_id=$1 ORDER BY created_at, id", [runs[0]!.convId])).rows;
    expect(convMessages.some((m) => m.role === 'assistant' && m.metadata?.type === 'answer')).toBe(true);
    expect(await service.pendingCount(owner.id, now)).toBe(0);
  });

  it('2. manual run at 08:05 does not advance SINCE for the scheduled run at 08:07', async () => {
    const dueAtScheduled = new Date('2026-10-26T01:07:00.000Z'); // 08:07 VN
    const schedule = await insertDigestSchedule({ nextRunAt: dueAtScheduled });
    const capturedNewIssueQueries: string[] = [];

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
      getAdapter: async (serviceName) => ({
        execute: async (tool: string, args: any) => {
          if (serviceName === 'github' && tool === 'github.search_issues') {
            if (args.query.includes('created:>=')) capturedNewIssueQueries.push(args.query);
            return [];
          }
          if (serviceName === 'slack' && tool === 'slack.search_channels') {
            return [{ id: 'C0123456789', name: 'team' }];
          }
          if (serviceName === 'slack' && tool === 'slack.send_message') {
            return { ok: true, channel: args.channel, ts: '1730000001.000100' };
          }
          return [];
        },
      }),
    });

    const runner = new ScheduleRunner({
      pool: db.pool,
      timeZone: VN,
      now: () => now,
      planRun: async () => ({ persist: async () => ({ state: 'needs_attention' }), afterCommit() {} }),
      runDigest,
      recordState: (client, row, at) => service.recordState(client, row, at),
    });
    const serviceWithRunner = new ScheduleService({
      pool: db.pool,
      timeZone: VN,
      runner: { planNow: (id) => runner.planNow(id) },
    });

    // Manual run at 08:05 VN (2026-10-26T01:05:00Z)
    now = new Date('2026-10-26T01:05:00.000Z');
    await serviceWithRunner.startRun({ userId: owner.id, scheduleId: schedule.id, trigger: 'manual', now });
    await runner.stop();

    // Now run scheduled tick at 08:07 VN (2026-10-26T01:07:10Z)
    const runner2 = new ScheduleRunner({
      pool: db.pool,
      timeZone: VN,
      now: () => new Date('2026-10-26T01:07:10.000Z'),
      planRun: async () => ({ persist: async () => ({ state: 'needs_attention' }), afterCommit() {} }),
      runDigest,
      recordState: (client, row, at) => service.recordState(client, row, at),
    });
    await runner2.tick();
    await runner2.stop();

    expect(capturedNewIssueQueries).toHaveLength(2);
    // Scheduled run at 08:07 must use 08:07 - 24h (2026-10-25T01:07:00Z), NOT 08:05 (2026-10-26T01:05:00Z)
    expect(capturedNewIssueQueries[1]).toContain('created:>=2026-10-25T01:07:00Z');
  });

  it('3. blocks run and pauses schedule without calling Slack when digest_config_hash is tampered in DB', async () => {
    const schedule = await insertDigestSchedule();
    await db.pool.query(
      `UPDATE schedules SET digest_config = jsonb_set(digest_config, '{channelId}', '"C9999999999"') WHERE id = $1`,
      [schedule.id],
    );

    const slackSend = vi.fn();
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
      getAdapter: async () => ({ execute: slackSend }),
    });

    const runner = new ScheduleRunner({
      pool: db.pool,
      timeZone: VN,
      now: () => now,
      planRun: async () => ({ persist: async () => ({ state: 'needs_attention' }), afterCommit() {} }),
      runDigest,
      recordState: (client, row, at) => service.recordState(client, row, at),
    });

    await runner.tick();
    await runner.stop();

    expect(slackSend).not.toHaveBeenCalled();
    const updatedSchedule = (await db.pool.query('SELECT status, pause_reason FROM schedules WHERE id=$1', [schedule.id])).rows[0];
    expect(updatedSchedule.status).toBe('paused');
    expect(updatedSchedule.pause_reason).toBe('Cấu hình bản tin đã thay đổi, cần xác nhận lại.');

    const runs = await service.listRuns(owner.id, schedule.id, 10, now);
    expect(runs[0]?.state).toBe('blocked');
  });

  it('4. discards run and makes 0 Slack send calls if user pauses/updates schedule while reading GitHub', async () => {
    const schedule = await insertDigestSchedule();
    const slackSend = vi.fn();
    let pausedDuringRead = false;

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
      getAdapter: async (serviceName) => ({
        execute: async (tool: string) => {
          if (serviceName === 'github' && tool === 'github.search_issues') {
            if (!pausedDuringRead) {
              pausedDuringRead = true;
              await service.setStatus({ userId: owner.id, scheduleId: schedule.id, action: 'pause', version: schedule.version, now });
            }
            return [];
          }
          if (serviceName === 'slack' && tool === 'slack.search_channels') {
            return [{ id: 'C0123456789', name: 'team' }];
          }
          if (serviceName === 'slack' && tool === 'slack.send_message') {
            slackSend();
            return { ok: true, ts: '1' };
          }
          return [];
        },
      }),
    });

    const runner = new ScheduleRunner({
      pool: db.pool,
      timeZone: VN,
      now: () => now,
      planRun: async () => ({ persist: async () => ({ state: 'needs_attention' }), afterCommit() {} }),
      runDigest,
      recordState: (client, row, at) => service.recordState(client, row, at),
    });

    await runner.tick();
    await runner.stop();

    expect(slackSend).not.toHaveBeenCalled();
    const runs = await service.listRuns(owner.id, schedule.id, 10, now);
    expect(runs[0]?.state).toBe('discarded');
  });

  it('5. aborts hanging AI summary via AbortSignal and still delivers the Slack digest with all 3 sections', async () => {
    const schedule = await insertDigestSchedule();
    const slackMessages: string[] = [];
    let aiAborted = false;

    const runDigest = createGithubDigestRunner({
      pool: db.pool,
      aiTimeoutMs: 50,
      summarizeDigest: async (_input, signal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              aiAborted = true;
              reject(new Error('AI summary timed out'));
            },
            { once: true },
          );
        }),
      githubConnection: async () => ({
        status: 'connected',
        connection: {
          credentialId: GH_CRED_ID,
          githubUserId: '1001',
          login: 'octocat',
          repos: ['nhom/ati'],
        },
      }),
      getAdapter: async (serviceName) => ({
        execute: async (tool: string, args: any) => {
          if (serviceName === 'github' && tool === 'github.search_issues') return [];
          if (serviceName === 'slack' && tool === 'slack.search_channels') {
            return [{ id: 'C0123456789', name: 'team' }];
          }
          if (serviceName === 'slack' && tool === 'slack.send_message') {
            slackMessages.push(args.text);
            return { ok: true, channel: args.channel, ts: '1730000002.000100' };
          }
          return [];
        },
      }),
    });

    const runner = new ScheduleRunner({
      pool: db.pool,
      timeZone: VN,
      now: () => now,
      planRun: async () => ({ persist: async () => ({ state: 'needs_attention' }), afterCommit() {} }),
      runDigest,
      recordState: (client, row, at) => service.recordState(client, row, at),
    });

    await runner.tick();
    await runner.stop();

    expect(aiAborted).toBe(true);
    expect(slackMessages).toHaveLength(1);
    expect(slackMessages[0]).toContain('Issue mới');
    expect(slackMessages[0]).toContain('PR chờ review');
    expect(slackMessages[0]).toContain('Issue mở chưa ai nhận');
  });

  it('6. pauses schedule with pause_reason = "3 lượt liền gửi thất bại" after 3 consecutive digest_failed runs, and allows replan on digest_failed', async () => {
    const schedule = await insertDigestSchedule();

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
      getAdapter: async (serviceName) => ({
        execute: async (tool: string) => {
          if (serviceName === 'github' && tool === 'github.search_issues') return [];
          if (serviceName === 'slack' && tool === 'slack.search_channels') {
            return [{ id: 'C0123456789', name: 'team' }];
          }
          if (serviceName === 'slack' && tool === 'slack.send_message') {
            throw new StepError({
              message: 'Slack rate limit exceeded (429)',
              category: 'RATE_LIMIT',
              statusCode: 429,
              retryable: true,
            });
          }
          return [];
        },
      }),
    });

    for (let day = 0; day < 3; day++) {
      const tickTime = new Date( new Date('2026-10-26T01:00:10.000Z').getTime() + day * 24 * 3600_000 );
      const runner = new ScheduleRunner({
        pool: db.pool,
        timeZone: VN,
        now: () => tickTime,
        planRun: async () => ({ persist: async () => ({ state: 'needs_attention' }), afterCommit() {} }),
        runDigest,
        recordState: (client, row, at) => service.recordState(client, row, at),
      });
      await runner.tick();
      await runner.stop();
    }

    const updated = (await db.pool.query('SELECT status, pause_reason FROM schedules WHERE id=$1', [schedule.id])).rows[0];
    expect(updated.status).toBe('paused');
    expect(updated.pause_reason).toBe('3 lượt liền gửi thất bại');

    const runs = await service.listRuns(owner.id, schedule.id, 10, now);
    expect(runs.map((r) => r.state)).toEqual(['digest_failed', 'digest_failed', 'digest_failed']);

    // Verify digest_failed is replannable
    const replanned = await service.startRun({ userId: owner.id, runId: runs[0]!.id, trigger: 'replan', now });
    expect(replanned.trigger).toBe('replan');
    expect(replanned.state).toBe('planning');
  });

  it('7. supports Telegram destination for github_digest (evaluateGithubDigestCandidate + createGithubDigestRunner)', async () => {
    const candidate = await evaluateGithubDigestCandidate({
      userId: owner.id,
      proposal: {
        kind: 'schedule',
        action: 'create',
        name: 'Bản tin GitHub Telegram',
        request: 'Gửi bản tin GitHub repo nhom/ati vào nhóm Telegram Dev Alerts',
        recurrence: dailyRecurrence,
        summary: 'Gửi bản tin GitHub sang Telegram',
      },
      services: ['github', 'telegram'],
      githubConnection: async () => ({
        status: 'connected',
        connection: {
          credentialId: GH_CRED_ID,
          githubUserId: '1001',
          login: 'octocat',
          repos: ['nhom/ati'],
        },
        teamRepos: [{ repoId: '101', fullName: 'nhom/ati', name: 'ati' }],
      }),
      telegramConnection: async () => ({
        status: 'connected',
        connection: {
          credentialId: TG_CRED_ID,
          telegramUserId: '777',
          username: 'octo_tg',
          chatIds: ['-100999888'],
        },
        selectedChats: [{ chatId: '-100999888', title: 'Dev Alerts', type: 'supergroup' }],
      }),
    });

    expect(candidate.canAutoDigest).toBe(true);
    expect(candidate.config?.telegramChatId).toBe('-100999888');
    expect(candidate.config?.telegramChatTitle).toBe('Dev Alerts');

    const schedule = await insertDigestSchedule({
      config: candidate.config!,
      configHash: candidate.configHash!,
    });

    const telegramMessages: Array<{ chatId: string; text: string }> = [];
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
        selectedChats: [{ chatId: '-100999888', title: 'Dev Alerts', type: 'supergroup' }],
      }),
      getAdapter: async (serviceName) => ({
        execute: async (tool: string, args: any) => {
          if (serviceName === 'github' && tool === 'github.search_issues') {
            return [{ id: '1', number: 10, title: 'Fix OAuth bug', url: 'https://github.com/nhom/ati/issues/10', repo: 'nhom/ati' }];
          }
          if (serviceName === 'telegram' && tool === 'telegram.send_message') {
            telegramMessages.push({ chatId: args.chatId, text: args.text });
            return { messageId: 555, chatId: args.chatId };
          }
          return [];
        },
      }),
    });

    const runner = new ScheduleRunner({
      pool: db.pool,
      timeZone: VN,
      now: () => now,
      planRun: async () => ({ persist: async () => ({ state: 'needs_attention' }), afterCommit() {} }),
      runDigest,
      recordState: (client, row, at) => service.recordState(client, row, at),
    });

    await runner.tick();
    await runner.stop();

    expect(telegramMessages).toHaveLength(1);
    expect(telegramMessages[0]?.chatId).toBe('-100999888');
    expect(telegramMessages[0]?.text).toContain('Issue mới');
    expect(telegramMessages[0]?.text).toContain('PR chờ review');
    expect(telegramMessages[0]?.text).toContain('Issue mở chưa ai nhận');

    const runs = await service.listRuns(owner.id, schedule.id, 10, now);
    expect(runs[0]?.state).toBe('digest_sent');
    expect((runs[0]?.delivery as any)?.telegramChatId).toBe('-100999888');
  });

  it('8. (F3) passes connections.telegram snapshot to real AdapterFactory at execution phase', async () => {
    const encryptionKey = 'a'.repeat(64);
    const tg = {
      status: 'connected',
      connection: {
        credentialId: TG_CRED_ID,
        telegramUserId: '777',
        username: 'octo_tg',
        chatIds: ['-100999888'],
      },
      selectedChats: [{ chatId: '-100999888', title: 'Dev Alerts', type: 'supergroup' }],
    };
    const gh = {
      status: 'connected',
      connection: {
        credentialId: GH_CRED_ID,
        githubUserId: '1001',
        login: 'octocat',
        repos: ['nhom/ati'],
      },
      teamRepos: [{ repoId: '101', fullName: 'nhom/ati', name: 'ati' }],
    };

    const candidate = await evaluateGithubDigestCandidate({
      userId: owner.id,
      proposal: {
        kind: 'schedule',
        action: 'create',
        name: 'Bản tin GitHub Telegram',
        request: 'Gửi bản tin GitHub repo nhom/ati vào nhóm Telegram Dev Alerts',
        recurrence: dailyRecurrence,
        summary: 'Gửi bản tin GitHub sang Telegram',
      },
      services: ['github', 'telegram'],
      githubConnection: async () => gh,
      telegramConnection: async () => tg,
    });

    expect(candidate.canAutoDigest).toBe(true);
    expect(candidate.config?.telegramCredentialId).toBe(TG_CRED_ID);

    const tgRecord = {
      id: TG_CRED_ID,
      status: 'active',
      config: encryptCredentials(
        { telegramUserId: '777', selectedChats: tg.selectedChats },
        encryptionKey,
      ),
    };
    const sentMessages: Array<{ chatId: string; text: string }> = [];
    const factory = new AdapterFactory({
      credentialRepo: { getPersonalCredentials: async () => tgRecord } as any,
      encryptionKey,
      telegramBot: { botToken: '12345:review_fixture_token_12345', botUsername: 'review_bot' },
      telegramBotClient: { getChatMember: async () => true },
      createTelegramAdapter: () =>
        ({
          execute: async (tool: string, args: any) => {
            if (tool === 'telegram.send_message') {
              sentMessages.push({ chatId: args.chatId, text: args.text });
            }
            return { messageId: 42 };
          },
        }) as any,
    });

    const schedule = await insertDigestSchedule({
      config: candidate.config!,
      configHash: candidate.configHash!,
    });

    const runDigest = createGithubDigestRunner({
      pool: db.pool,
      githubConnection: async () => gh,
      telegramConnection: async () => tg,
      getAdapter: (serviceName, context) =>
        serviceName === 'github'
          ? { execute: async () => [] }
          : factory.getAdapterForService(serviceName, context),
    });

    const runner = new ScheduleRunner({
      pool: db.pool,
      timeZone: VN,
      now: () => now,
      planRun: async () => ({ persist: async () => ({ state: 'needs_attention' }), afterCommit() {} }),
      runGithubDigest: runDigest,
      recordState: (client, row, at) => service.recordState(client, row, at),
    });

    await runner.tick();
    await runner.stop();

    const runs = await service.listRuns(owner.id, schedule.id, 10, now);
    expect(runs[0]?.state).toBe('digest_sent');
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]?.chatId).toBe('-100999888');
  });

  it('9. (F2) records delivery_started_at and transitions to needs_attention (blocking replan) when Telegram write fails with UNKNOWN', async () => {
    const tg = {
      status: 'connected',
      connection: {
        credentialId: TG_CRED_ID,
        telegramUserId: '777',
        username: 'octo_tg',
        chatIds: ['-100999888'],
      },
      selectedChats: [{ chatId: '-100999888', title: 'Dev Alerts', type: 'supergroup' }],
    };
    const gh = {
      status: 'connected',
      connection: {
        credentialId: GH_CRED_ID,
        githubUserId: '1001',
        login: 'octocat',
        repos: ['nhom/ati'],
      },
      teamRepos: [{ repoId: '101', fullName: 'nhom/ati', name: 'ati' }],
    };

    const candidate = await evaluateGithubDigestCandidate({
      userId: owner.id,
      proposal: {
        kind: 'schedule',
        action: 'create',
        name: 'Bản tin GitHub Telegram',
        request: 'Gửi bản tin GitHub repo nhom/ati vào nhóm Telegram Dev Alerts',
        recurrence: dailyRecurrence,
        summary: 'Gửi bản tin GitHub sang Telegram',
      },
      services: ['github', 'telegram'],
      githubConnection: async () => gh,
      telegramConnection: async () => tg,
    });

    let sendCalls = 0;
    const server = createServer(async (req, res) => {
      for await (const _ of req) {
        // consume request
      }
      if (req.url?.endsWith('/getChat')) {
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            ok: true,
            result: { id: -100999888, type: 'supergroup', title: 'Dev Alerts' },
          }),
        );
      } else if (req.url?.endsWith('/sendMessage')) {
        sendCalls++;
        req.socket.destroy();
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as any).port;

    try {
      const transport = new TelegramAdapter({
        credentials: { botToken: '12345:review_fixture_token_12345' },
        baseUrl: `http://127.0.0.1:${port}`,
        allowedScope: { chats: ['-100999888'] },
      });
      const realRunner = createGithubDigestRunner({
        pool: db.pool,
        githubConnection: async () => gh,
        telegramConnection: async () => tg,
        getAdapter: (serviceName) =>
          serviceName === 'github' ? { execute: async () => [] } : transport,
      });

      const schedule = await insertDigestSchedule({
        config: candidate.config!,
        configHash: candidate.configHash!,
      });

      const scheduler = new ScheduleRunner({
        pool: db.pool,
        timeZone: VN,
        now: () => now,
        planRun: async () => ({ persist: async () => ({ state: 'needs_attention' }), afterCommit() {} }),
        runGithubDigest: realRunner,
        recordState: (client, row, at) => service.recordState(client, row, at),
      });

      await scheduler.tick();
      await scheduler.stop();

      const saved = (
        await db.pool.query(
          'SELECT id, status, delivery_started_at FROM schedule_runs WHERE schedule_id = $1',
          [schedule.id],
        )
      ).rows[0];

      expect(sendCalls).toBe(1);
      expect(saved.delivery_started_at).not.toBeNull();
      expect(saved.status).toBe('needs_attention');

      await expect(
        service.startRun({ userId: owner.id, runId: saved.id, trigger: 'replan', now }),
      ).rejects.toMatchObject({ code: 'RUN_NOT_REPLANNABLE' });
      expect(sendCalls).toBe(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('10. (R2 + C1) preserves delivery_started_at and transitions to needs_attention (blocking replan) for Slack NETWORK, internal_error, fatal_error, HTTP 500, and malformed JSON while allowing replan on definite rejections', async () => {
    const gh = {
      status: 'connected',
      connection: {
        credentialId: GH_CRED_ID,
        githubUserId: '1001',
        login: 'octocat',
        repos: ['nhom/ati'],
      },
    };

    const modes = [
      { mode: 'lost_ack', ambiguous: true },
      { mode: 'internal_error', ambiguous: true },
      { mode: 'fatal_error', ambiguous: true },
      { mode: 'http_500', ambiguous: true },
      { mode: 'malformed_json', ambiguous: true },
      { mode: 'invalid_auth', ambiguous: false },
      { mode: 'channel_not_found', ambiguous: false },
      { mode: 'ratelimited', ambiguous: false },
    ] as const;

    for (const { mode, ambiguous } of modes) {
      let slackWrites = 0;
      const slackServer = createServer(async (req, res) => {
        for await (const _ of req) {
          // consume request
        }
        res.setHeader('Content-Type', 'application/json');
        if (req.url?.startsWith('/conversations.list')) {
          res.end(
            JSON.stringify({
              ok: true,
              channels: [{ id: 'C0123456789', name: 'team', is_private: false }],
            }),
          );
        } else if (req.url === '/chat.postMessage') {
          slackWrites++;
          if (mode === 'lost_ack') {
            req.socket.destroy();
          } else if (mode === 'http_500') {
            res.writeHead(500).end(JSON.stringify({ ok: false, error: 'server_error' }));
          } else if (mode === 'malformed_json') {
            res.end('{');
          } else {
            res.end(JSON.stringify({ ok: false, error: mode }));
          }
        } else {
          res.writeHead(404).end();
        }
      });
      await new Promise<void>((resolve) => slackServer.listen(0, '127.0.0.1', resolve));
      const port = (slackServer.address() as any).port;

      try {
        const slack = new SlackAdapter({
          credentials: { botToken: 'fixture' },
          allowedScope: { channels: ['C0123456789'] },
          baseUrl: `http://127.0.0.1:${port}`,
          rateLimiter: new GlobalRateLimiter({ maxRequests: 100, windowMs: 1000 }),
        });
        const schedule = await insertDigestSchedule();
        const runner = createGithubDigestRunner({
          pool: db.pool,
          githubConnection: async () => gh,
          getAdapter: (serviceName) =>
            serviceName === 'github' ? { execute: async () => [] } : slack,
        });
        const scheduler = new ScheduleRunner({
          pool: db.pool,
          timeZone: VN,
          now: () => now,
          planRun: async () => ({ persist: async () => ({ state: 'needs_attention' }), afterCommit() {} }),
          runGithubDigest: runner,
          recordState: (client, row, at) => service.recordState(client, row, at),
        });

        await scheduler.tick();
        await scheduler.stop();

        const saved = (
          await db.pool.query(
            'SELECT id, status, delivery_started_at FROM schedule_runs WHERE schedule_id = $1',
            [schedule.id],
          )
        ).rows[0];

        expect(slackWrites).toBe(1);
        if (ambiguous) {
          expect(saved.delivery_started_at).not.toBeNull();
          expect(saved.status).toBe('needs_attention');
          await expect(
            service.startRun({ userId: owner.id, runId: saved.id, trigger: 'replan', now }),
          ).rejects.toMatchObject({ code: 'RUN_NOT_REPLANNABLE' });
          expect(slackWrites).toBe(1);
        } else {
          expect(saved.delivery_started_at).toBeNull();
          expect(saved.status).toBe('digest_failed');
          const replanned = await service.startRun({
            userId: owner.id,
            runId: saved.id,
            trigger: 'replan',
            now,
          });
          expect(replanned.state).toBe('planning');
        }
      } finally {
        await new Promise<void>((resolve) => slackServer.close(() => resolve()));
      }
    }
  });

  it('11. (R1) discards run without HTTP writes when cancel or pause commits while marker claim waits on row lock', async () => {
    const gh = {
      status: 'connected',
      connection: {
        credentialId: GH_CRED_ID,
        githubUserId: '1001',
        login: 'octocat',
        repos: ['nhom/ati'],
      },
    };
    const tg = {
      status: 'connected',
      connection: {
        credentialId: TG_CRED_ID,
        telegramUserId: '777',
        username: 'octo_tg',
        chatIds: ['-100999888'],
      },
    };
    const telegramWrites: Array<{ action: string; scheduleStateAtWrite: string }> = [];
    let observedScheduleId = '';
    let currentAction = '';

    const telegramServer = createServer(async (req, res) => {
      for await (const _ of req) {
        // consume request
      }
      res.setHeader('Content-Type', 'application/json');
      if (req.url?.endsWith('/getChat')) {
        res.end(
          JSON.stringify({
            ok: true,
            result: { id: -100999888, type: 'supergroup', title: 'Dev Alerts' },
          }),
        );
      } else if (req.url?.endsWith('/sendMessage')) {
        const status = (
          await db.pool.query('SELECT status FROM schedules WHERE id = $1', [observedScheduleId])
        ).rows[0].status;
        telegramWrites.push({ action: currentAction, scheduleStateAtWrite: status });
        res.end(
          JSON.stringify({
            ok: true,
            result: { message_id: telegramWrites.length, date: 1793667610, chat: { id: -100999888 } },
          }),
        );
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) => telegramServer.listen(0, '127.0.0.1', resolve));
    const port = (telegramServer.address() as any).port;

    try {
      for (const action of ['cancel', 'pause'] as const) {
        currentAction = action;
        const config: GithubDigestConfig = {
          ...baseConfig,
          channelId: '',
          channelName: '',
          telegramChatId: '-100999888',
          telegramChatTitle: 'Dev Alerts',
          telegramCredentialId: TG_CRED_ID,
          telegramUserId: '777',
          telegramUsername: 'octo_tg',
        };
        const schedule = await insertDigestSchedule({ config });
        observedScheduleId = schedule.id;
        const planned = await service.startRun({
          userId: owner.id,
          scheduleId: schedule.id,
          trigger: 'manual',
          now,
        });

        const holder = await db.pool.connect();
        const markerPool = new pg.Pool({
          ...(db.pool as any).options,
          max: 1,
          application_name: `test_r1_${action}`,
        });
        let runnerPromise: Promise<any> | undefined;
        try {
          const pid = (await markerPool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
          await holder.query('BEGIN');
          await holder.query('SELECT id FROM schedule_runs WHERE id = $1 FOR UPDATE', [planned.id]);

          const telegram = new TelegramAdapter({
            credentials: { botToken: '12345:review_fixture_token_12345' },
            allowedScope: { chats: ['-100999888'] },
            baseUrl: `http://127.0.0.1:${port}`,
          });
          const runner = createGithubDigestRunner({
            pool: markerPool,
            githubConnection: async () => gh,
            telegramConnection: async () => tg,
            getAdapter: (s) => (s === 'github' ? { execute: async () => [] } : telegram),
          });
          runnerPromise = runner(
            {
              runId: planned.id,
              scheduleId: schedule.id,
              scheduleVersion: schedule.version,
              userId: owner.id,
              name: schedule.name,
              request: schedule.request,
              dueAt: now,
              trigger: 'manual',
              recurrence: dailyRecurrence,
              digestConfig: config,
              digestConfigHash: schedule.digest_config_hash,
            },
            schedule.conv_id,
            new AbortController().signal,
          );

          const deadline = Date.now() + 5000;
          let waiting = false;
          while (Date.now() < deadline) {
            const observed = (
              await db.pool.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1', [pid])
            ).rows[0];
            if (observed?.wait_event_type === 'Lock') {
              waiting = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          expect(waiting).toBe(true);

          const changed = await service.setStatus({
            userId: owner.id,
            scheduleId: schedule.id,
            action,
            version: schedule.version,
            now,
          });
          expect(changed.schedule.status).toBe(action === 'cancel' ? 'cancelled' : 'paused');

          await holder.query('COMMIT');
          const outcome = await runnerPromise;

          expect(outcome.state).toBe('discarded');
          expect(telegramWrites.filter((w) => w.action === action)).toHaveLength(0);
          const runRow = (
            await db.pool.query('SELECT delivery_started_at FROM schedule_runs WHERE id = $1', [planned.id])
          ).rows[0];
          expect(runRow.delivery_started_at).toBeNull();
        } finally {
          await holder.query('ROLLBACK').catch(() => undefined);
          holder.release();
          if (runnerPromise) await runnerPromise.catch(() => undefined);
          await markerPool.end();
        }
      }
    } finally {
      await new Promise<void>((resolve) => telegramServer.close(() => resolve()));
    }
  });

  it('12. (C1-04) enforces strict credential pin immutability and never substitutes a newer active credential when the pinned credential is sandbox-github, stale, revoked, or non-existent', async () => {
    const NEWER_ACTIVE_CRED_ID = '0b5c1f0e-7a6d-4c1e-9d2a-1a2b3c4d5e99';
    const NON_EXISTENT_CRED_ID = '0b5c1f0e-7a6d-4c1e-9d2a-1a2b3c4d5e77';

    // 12a. Even when GH_CRED_ID is active in service_credentials, a 'sandbox-github' lookup result must NEVER be substituted with the latest active DB credential
    const sandboxLookupSchedule = await insertDigestSchedule();
    const sandboxLookupPlanned = await service.startRun({
      userId: owner.id,
      scheduleId: sandboxLookupSchedule.id,
      trigger: 'manual',
      now,
    });
    let adapterCalls = 0;
    const runnerWithSandboxLookup = createGithubDigestRunner({
      pool: db.pool,
      githubConnection: async () => ({
        status: 'connected' as const,
        connection: {
          credentialId: 'sandbox-github',
          githubUserId: '1001',
          login: 'octocat',
          repos: ['nhom/ati'],
        },
        teamRepos: [{ repoId: '101', fullName: 'nhom/ati', name: 'ati' }],
        memberRepos: [{ repoId: '101', fullName: 'nhom/ati', name: 'ati' }],
      }),
      getAdapter: () => ({
        execute: async () => {
          adapterCalls++;
          return [];
        },
      }),
    });
    const sandboxOutcome = await runnerWithSandboxLookup(
      {
        runId: sandboxLookupPlanned.id,
        scheduleId: sandboxLookupSchedule.id,
        scheduleVersion: sandboxLookupSchedule.version,
        userId: owner.id,
        name: sandboxLookupSchedule.name,
        request: sandboxLookupSchedule.request,
        dueAt: now,
        trigger: 'manual',
        recurrence: dailyRecurrence,
        digestConfig: baseConfig,
        digestConfigHash: sandboxLookupSchedule.digest_config_hash,
      },
      sandboxLookupSchedule.conv_id,
      new AbortController().signal,
    );
    expect(sandboxOutcome.state).toBe('blocked');
    expect(adapterCalls).toBe(0);

    // 12b. Revoked pinned credential (status = 'reconnect_required') is rejected by both guard and runner
    await db.pool.query(
      `UPDATE service_credentials SET status = 'reconnect_required' WHERE id = $1`,
      [GH_CRED_ID],
    );
    const revokedSchedule = await insertDigestSchedule({ config: baseConfig });
    const revokedScheduler = new ScheduleRunner({
      pool: db.pool,
      timeZone: VN,
      now: () => now,
      planRun: async () => ({ persist: async () => ({ state: 'needs_attention' }), afterCommit() {} }),
      runGithubDigest: async () => {
        adapterCalls++;
        return { state: 'discarded' as const };
      },
      recordState: (client, row, at) => service.recordState(client, row, at),
    });
    await revokedScheduler.tick();
    await revokedScheduler.stop();
    expect(adapterCalls).toBe(0);
    expect((await db.pool.query('SELECT status FROM schedules WHERE id = $1', [revokedSchedule.id])).rows[0].status).toBe('paused');
    expect((await db.pool.query('SELECT status FROM schedule_runs WHERE schedule_id = $1', [revokedSchedule.id])).rows[0].status).toBe('blocked');

    // 12c. Stale / replaced / non-existent / sandbox-github pinned credential while a newer active credential exists for the same user:
    // Both ScheduleRunner (assertDigestScheduleLiveScopeAndAuth) and createGithubDigestRunner must reject and NEVER substitute NEWER_ACTIVE_CRED_ID.
    await db.pool.query(`DELETE FROM service_credentials WHERE id = $1`, [GH_CRED_ID]);
    await db.pool.query(
      `INSERT INTO service_credentials (id, service, user_id, workspace_id, config, status)
       VALUES ($1, 'github', $2, NULL, 'fixture_newer', 'active')`,
      [NEWER_ACTIVE_CRED_ID, owner.id],
    );

    for (const pinnedId of [GH_CRED_ID, NON_EXISTENT_CRED_ID, 'sandbox-github']) {
      const config: GithubDigestConfig = { ...baseConfig, credentialId: pinnedId };
      const schedule = await insertDigestSchedule({ config });
      let runnerInvoked = false;
      const runner = createGithubDigestRunner({
        pool: db.pool,
        githubConnection: async () => ({
          status: 'connected' as const,
          connection: {
            credentialId: NEWER_ACTIVE_CRED_ID,
            githubUserId: '1001',
            login: 'octocat',
            repos: ['nhom/ati'],
          },
          teamRepos: [{ repoId: '101', fullName: 'nhom/ati', name: 'ati' }],
          memberRepos: [{ repoId: '101', fullName: 'nhom/ati', name: 'ati' }],
        }),
        getAdapter: () => ({
          execute: async () => {
            adapterCalls++;
            return [];
          },
        }),
      });
      const scheduler = new ScheduleRunner({
        pool: db.pool,
        timeZone: VN,
        now: () => now,
        planRun: async () => ({ persist: async () => ({ state: 'needs_attention' }), afterCommit() {} }),
        runGithubDigest: async (run, convId, signal) => {
          runnerInvoked = true;
          return runner(run, convId, signal);
        },
        recordState: (client, row, at) => service.recordState(client, row, at),
      });

      await scheduler.tick();
      await scheduler.stop();

      // Guard blocks before runner is even invoked
      expect(runnerInvoked).toBe(false);
      expect(adapterCalls).toBe(0);
      const schedState = (await db.pool.query('SELECT status FROM schedules WHERE id = $1', [schedule.id])).rows[0];
      expect(schedState.status).toBe('paused');
      const runState = (await db.pool.query('SELECT status FROM schedule_runs WHERE schedule_id = $1', [schedule.id])).rows[0];
      expect(runState.status).toBe('blocked');

      // Direct runner invocation also rejects when gh.connection.credentialId (NEWER_ACTIVE_CRED_ID) !== config.credentialId (pinnedId)
      const directOutcome = await runner(
        {
          runId: '0b5c1f0e-7a6d-4c1e-9d2a-1a2b3c4d5e88',
          scheduleId: schedule.id,
          scheduleVersion: schedule.version,
          userId: owner.id,
          name: schedule.name,
          request: schedule.request,
          dueAt: now,
          trigger: 'manual',
          recurrence: dailyRecurrence,
          digestConfig: config,
          digestConfigHash: schedule.digest_config_hash,
        },
        schedule.conv_id,
        new AbortController().signal,
      );
      expect(directOutcome.state).toBe('blocked');
      expect(adapterCalls).toBe(0);
    }
  });

  it('13. (C1-03) completes production proposal evaluation -> confirmProposal -> ScheduleRunner execution end-to-end without mutating schedule rows after confirmation', async () => {
    const encryptionKey = '01234567890123456789012345678901';
    const credRepo = new CredentialRepo(db.pool);
    const teamRepo = new GitHubTeamRepo(db.pool);

    // Clean any default github_credentials so saveCredentials creates a fresh real UUID row for owner.id
    await db.pool.query("DELETE FROM service_credentials WHERE service = 'github' AND user_id = $1", [owner.id]);
    const encryptedGithub = encryptCredentials(
      {
        accessToken: 'gho_production_flow_token',
        login: 'octocat',
        githubUserId: '1001',
        connectedAt: now.toISOString(),
      },
      encryptionKey,
    );
    await credRepo.saveCredentials('github', encryptedGithub, owner.id);
    const savedCred = await credRepo.getPersonalConnectionStatus('github', owner.id);
    expect(savedCred).not.toBeNull();
    expect(savedCred!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

    const personalScopeId = `personal:${owner.id}`;
    await teamRepo.replace({
      scopeId: personalScopeId,
      chosenBy: owner.id,
      repos: [{ repoId: '101', fullName: 'nhom/ati', name: 'ati' }],
    });

    const fakeOAuthClient = {
      repos: async () => [{ id: '101', name: 'ati', fullName: 'nhom/ati', private: false }],
    } as any;
    const tokens = new GitHubTokenManager({
      client: fakeOAuthClient,
      credentials: credRepo,
    });
    const githubLookup = createGitHubConnectionLookup({
      credentialRepo: credRepo,
      teamRepo,
      encryptionKey,
      tokens,
      client: fakeOAuthClient,
    });

    const slackMessages: Array<{ channel: string; text: string }> = [];
    const getAdapter = async (serviceName: string) => {
      if (serviceName === 'github') {
        return {
          execute: async (tool: string) => {
            if (tool === 'github.search_issues') {
              return [
                {
                  number: 42,
                  title: 'Verify C1-03 pinned credential flow',
                  state: 'open',
                  createdAt: new Date(now.getTime() - 3600_000).toISOString(),
                  updatedAt: new Date(now.getTime() - 1800_000).toISOString(),
                  assignees: ['octocat'],
                  url: 'https://github.com/nhom/ati/issues/42',
                },
              ];
            }
            return [];
          },
        };
      }
      if (serviceName === 'slack') {
        return {
          execute: async (tool: string, args: any) => {
            if (tool === 'slack.search_channels') {
              return [{ id: 'C0123456789', name: 'general' }];
            }
            if (tool === 'slack.send_message') {
              slackMessages.push({ channel: args.channel, text: args.text });
              return { ok: true, ts: '1700000000.000100' };
            }
            return {};
          },
        };
      }
      throw new Error(`Unexpected service ${serviceName}`);
    };

    const requestText = 'Mỗi sáng 8 giờ, gửi bản tin GitHub repo nhom/ati lên Slack #general';
    const digestCandidate = await evaluateGithubDigestCandidate({
      userId: owner.id,
      scopeId: personalScopeId,
      request: requestText,
      services: ['github', 'slack'],
      recurrence: dailyRecurrence,
      githubConnection: githubLookup,
      getAdapter,
    });

    expect(digestCandidate.canAutoDigest).toBe(true);
    expect(digestCandidate.config?.credentialId).toBe(savedCred!.id);

    const convId = (
      await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [owner.id])
    ).rows[0].id as string;
    const proposalMetadata = {
      type: 'schedule_proposal',
      proposal: {
        kind: 'schedule',
        action: 'create',
        name: 'Bản tin GitHub sáng',
        request: requestText,
        recurrence: dailyRecurrence,
        summary: 'Mỗi sáng 8 giờ, gửi bản tin GitHub repo nhom/ati lên Slack #general.',
      },
      services: ['github', 'slack'],
      nextRuns: ['2026-10-26T01:00:00.000Z'],
      scheduleId: null,
      baseVersion: null,
      previous: null,
      digestCandidate,
    };
    const msgId = (
      await db.pool.query(
        `INSERT INTO messages(conv_id, role, content, metadata)
         VALUES($1, 'assistant', $2, $3::jsonb) RETURNING id`,
        [convId, proposalMetadata.proposal.summary, JSON.stringify(proposalMetadata)],
      )
    ).rows[0].id as string;

    // Confirm proposal via production ScheduleService.confirmProposal — NO SQL mutation on schedules afterwards!
    const confirmed = await service.confirmProposal({
      userId: owner.id,
      convId,
      messageId: msgId,
      approvalMode: 'auto_digest',
      now: new Date('2026-10-25T10:00:00.000Z'),
    });

    const persistedSchedule = (
      await db.pool.query(
        'SELECT id, recurrence, digest_config, digest_config_hash FROM schedules WHERE id = $1',
        [confirmed.schedule.id],
      )
    ).rows[0];
    expect(persistedSchedule.digest_config.credentialId).toBe(savedCred!.id);
    expect(persistedSchedule.digest_config_hash).toBe(
      computeDigestConfigHash({
        config: persistedSchedule.digest_config,
        recurrence: persistedSchedule.recurrence,
        userId: owner.id,
      }),
    );

    // Execute via ScheduleRunner (assertDigestScheduleLiveScopeAndAuth + createGithubDigestRunner) without touching the schedule row
    const runner = createGithubDigestRunner({
      pool: db.pool,
      githubConnection: githubLookup,
      getAdapter,
    });
    const scheduler = new ScheduleRunner({
      pool: db.pool,
      timeZone: VN,
      now: () => now,
      planRun: async () => ({ persist: async () => ({ state: 'needs_attention' }), afterCommit() {} }),
      runGithubDigest: runner,
      recordState: (client, row, at) => service.recordState(client, row, at),
    });

    await scheduler.tick();
    await scheduler.stop();

    const runRow = (
      await db.pool.query(
        'SELECT status, error FROM schedule_runs WHERE schedule_id = $1 ORDER BY created_at DESC LIMIT 1',
        [confirmed.schedule.id],
      )
    ).rows[0];
    expect(runRow.status).toBe('digest_sent');
    expect(slackMessages).toHaveLength(1);
    expect(slackMessages[0]!.channel).toBe('C0123456789');
    expect(slackMessages[0]!.text).toContain('Verify C1-03 pinned credential flow');
  });

  it('14. (R1-A1 + R1-C1) organization workspace digest runner uses workspaceId scopeId and fails closed if repo only exists in personal scope', async () => {
    const encryptionKey = '01234567890123456789012345678901';
    const credRepo = new CredentialRepo(db.pool);
    const teamRepo = new GitHubTeamRepo(db.pool);

    const orgWorkspaceId = (
      await db.pool.query(
        "INSERT INTO workspaces(name, invite_code, created_by) VALUES('Org R1-A1-C1', 'INV-R1A1C1', $1) RETURNING id",
        [owner.id],
      )
    ).rows[0].id as string;
    await db.pool.query(
      "INSERT INTO workspace_members(workspace_id, user_id, role, status) VALUES($1, $2, 'admin', 'active')",
      [orgWorkspaceId, owner.id],
    );

    await db.pool.query("DELETE FROM service_credentials WHERE service = 'github' AND user_id = $1", [owner.id]);
    const encryptedGithub = encryptCredentials(
      {
        accessToken: 'gho_org_flow_token',
        login: 'octocat',
        githubUserId: '1001',
        connectedAt: now.toISOString(),
      },
      encryptionKey,
    );
    await credRepo.saveCredentials('github', encryptedGithub, owner.id);
    const savedCred = await credRepo.getPersonalConnectionStatus('github', owner.id);

    // Select nhom/ati in orgWorkspaceId, NOT in personal scope
    await db.pool.query('DELETE FROM github_team_scope WHERE id = $1', [`personal:${owner.id}`]);
    await teamRepo.replace({
      scopeId: orgWorkspaceId,
      chosenBy: owner.id,
      repos: [{ repoId: '101', fullName: 'nhom/ati', name: 'ati' }],
    });

    const fakeOAuthClient = {
      repos: async () => [{ id: '101', name: 'ati', fullName: 'nhom/ati', private: false }],
    } as any;
    const tokens = new GitHubTokenManager({
      client: fakeOAuthClient,
      credentials: credRepo,
    });
    const githubLookup = createGitHubConnectionLookup({
      credentialRepo: credRepo,
      teamRepo,
      encryptionKey,
      tokens,
      client: fakeOAuthClient,
    });

    const adapterContexts: Array<{ serviceName: string; workspaceId?: string | null; workspaceMode?: string }> = [];
    const getAdapter = async (serviceName: string, ctx?: any) => {
      adapterContexts.push({
        serviceName,
        workspaceId: ctx?.workspaceId,
        workspaceMode: ctx?.workspaceMode,
      });
      if (serviceName === 'github') {
        return {
          execute: async (tool: string) => {
            if (tool === 'github.search_issues') {
              return [
                {
                  number: 99,
                  title: 'Org workspace scoped digest issue',
                  state: 'open',
                  createdAt: new Date(now.getTime() - 3600_000).toISOString(),
                  updatedAt: new Date(now.getTime() - 1800_000).toISOString(),
                  assignees: ['octocat'],
                  url: 'https://github.com/nhom/ati/issues/99',
                },
              ];
            }
            return [];
          },
        };
      }
      if (serviceName === 'slack') {
        return {
          execute: async (tool: string) => {
            if (tool === 'slack.search_channels') {
              return [{ id: 'C0123456789', name: 'general' }];
            }
            if (tool === 'slack.send_message') {
              return { ok: true, ts: '1700000000.000200' };
            }
            return {};
          },
        };
      }
      throw new Error(`Unexpected service ${serviceName}`);
    };

    const requestText = 'Mỗi sáng 8 giờ, gửi bản tin GitHub repo nhom/ati lên Slack #general';
    const digestCandidate = await evaluateGithubDigestCandidate({
      userId: owner.id,
      scopeId: orgWorkspaceId,
      request: requestText,
      services: ['github', 'slack'],
      recurrence: dailyRecurrence,
      githubConnection: githubLookup,
      getAdapter,
    });
    expect(digestCandidate.canAutoDigest).toBe(true);
    expect(digestCandidate.config?.credentialId).toBe(savedCred!.id);

    const convId = (
      await db.pool.query(
        "INSERT INTO conversations(user_id, workspace_id, workspace_mode) VALUES($1, $2, 'organization') RETURNING id",
        [owner.id, orgWorkspaceId],
      )
    ).rows[0].id as string;
    const proposalMetadata = {
      type: 'schedule_proposal',
      proposal: {
        kind: 'schedule',
        action: 'create',
        name: 'Bản tin GitHub Tổ chức',
        request: requestText,
        recurrence: dailyRecurrence,
        summary: 'Mỗi sáng 8 giờ, gửi bản tin GitHub repo nhom/ati lên Slack #general.',
      },
      services: ['github', 'slack'],
      nextRuns: ['2026-10-26T01:00:00.000Z'],
      scheduleId: null,
      baseVersion: null,
      previous: null,
      digestCandidate,
    };
    const msgId = (
      await db.pool.query(
        `INSERT INTO messages(conv_id, role, content, metadata)
         VALUES($1, 'assistant', $2, $3::jsonb) RETURNING id`,
        [convId, proposalMetadata.proposal.summary, JSON.stringify(proposalMetadata)],
      )
    ).rows[0].id as string;

    const confirmed = await service.confirmProposal({
      userId: owner.id,
      convId,
      messageId: msgId,
      approvalMode: 'auto_digest',
      now: new Date('2026-10-25T10:00:00.000Z'),
    });

    adapterContexts.length = 0;
    const runner = createGithubDigestRunner({
      pool: db.pool,
      githubConnection: githubLookup,
      getAdapter,
    });
    const scheduler = new ScheduleRunner({
      pool: db.pool,
      timeZone: VN,
      now: () => now,
      planRun: async () => ({ persist: async () => ({ state: 'needs_attention' }), afterCommit() {} }),
      runGithubDigest: runner,
      recordState: (client, row, at) => service.recordState(client, row, at),
    });

    await scheduler.tick();
    await scheduler.stop();

    const runRow = (
      await db.pool.query(
        'SELECT status, error FROM schedule_runs WHERE schedule_id = $1 ORDER BY created_at DESC LIMIT 1',
        [confirmed.schedule.id],
      )
    ).rows[0];
    expect(runRow.status).toBe('digest_sent');
    expect(adapterContexts).toEqual([
      { serviceName: 'github', workspaceId: orgWorkspaceId, workspaceMode: 'organization' },
      { serviceName: 'slack', workspaceId: orgWorkspaceId, workspaceMode: 'organization' },
    ]);
  });
});
