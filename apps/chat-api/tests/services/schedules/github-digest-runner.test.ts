import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GithubDigestConfig, ScheduleRecurrence } from '@wap/tool-schemas';
import { ScheduleRunner } from '../../../src/services/schedules/schedule-runner.js';
import { ScheduleService } from '../../../src/services/schedules/schedule-service.js';
import { computeDigestConfigHash } from '../../../src/services/schedules/github-digest-candidate.js';
import { createGithubDigestRunner, escapeSlackMrkdwn } from '../../../src/services/schedules/github-digest-runner.js';
import { createMigratedSchema } from '../../helpers/gmail-test-db.js';

const VN = 'Asia/Ho_Chi_Minh';
type Db = Awaited<ReturnType<typeof createMigratedSchema>>;
type Person = Awaited<ReturnType<Db['person']>>;

describe('Task 8: GitHub auto_digest execution in ScheduleRunner on PostgreSQL', () => {
  let db: Db;
  let owner: Person;
  let now: Date;
  let service: ScheduleService;

  const baseConfig: GithubDigestConfig = {
    credentialId: 'cred-gh-1',
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
          credentialId: 'cred-gh-1',
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
          credentialId: 'cred-gh-1',
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
          credentialId: 'cred-gh-1',
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
          credentialId: 'cred-gh-1',
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
          credentialId: 'cred-gh-1',
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
          credentialId: 'cred-gh-1',
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
            throw new Error('Slack 503 Service Unavailable');
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
});
