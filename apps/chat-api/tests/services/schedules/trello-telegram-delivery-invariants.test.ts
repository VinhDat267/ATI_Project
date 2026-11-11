import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { encryptCredentials, StepError, TelegramAdapter } from '@wap/tool-adapters';
import type { TelegramDigestConfig, TrelloDigestConfig } from '@wap/tool-schemas';
import { createMigratedSchema } from '../../helpers/gmail-test-db.js';
import { CredentialRepo } from '../../../src/db/repositories/credential-repo.js';
import { TrelloTeamRepo } from '../../../src/db/repositories/trello-team-repo.js';
import { AdapterFactory } from '../../../src/services/adapter-factory.js';
import { ScheduleService } from '../../../src/services/schedules/schedule-service.js';
import { ScheduleRunner, reconcileScheduleRuns } from '../../../src/services/schedules/schedule-runner.js';
import {
  createTrelloDigestRunner,
} from '../../../src/services/schedules/trello-digest-runner.js';
import {
  computeTrelloDigestConfigHash,
  evaluateTrelloDigestCandidate,
} from '../../../src/services/schedules/trello-digest-candidate.js';
import { TelegramDigestRunner } from '../../../src/services/schedules/telegram-digest-runner.js';
import { computeTelegramDigestConfigHash } from '../../../src/services/schedules/telegram-digest-candidate.js';
import { ExecutionService } from '../../../src/services/execution-service.js';
import { certifyScheduleFixture } from '../../../src/services/slack/slack-schedule-origin.js';

const KEY = '0123456789abcdef0123456789abcdef';
const TZ = 'Asia/Ho_Chi_Minh';
const NOW = new Date('2026-11-02T01:00:30.000Z');
const WORKER_SCRIPT = fileURLToPath(new URL('../../helpers/two-process-digest-worker.ts', import.meta.url));

function runWorkerProcess(envVars: Record<string, string>): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', WORKER_SCRIPT], {
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        NODE_ENV: 'test',
        ...envVars,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('Trello & Telegram Digest Delivery, Scope, Preflight & Recovery Invariants', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;

  beforeAll(async () => {
    db = await createMigratedSchema('trello_tg_invariants');
  });

  afterAll(async () => {
    await db?.close();
  });

  async function seedTelegramSchedule(chatId = '777001') {
    const owner = await db.person('TelegramOwner');
    const credentials = new CredentialRepo(db.pool, KEY);
    const credential = await credentials.saveCredentials(
      'telegram',
      encryptCredentials(
        {
          telegramUserId: chatId,
          username: 'tg_tester',
          selectedChats: [{ chatId, title: 'Telegram của tôi', type: 'private' }],
        },
        KEY,
      ),
      owner.id,
    );
    const config: TelegramDigestConfig = {
      credentialId: credential.id,
      telegramUserId: chatId,
      username: 'tg_tester',
      chatId,
      chatTitle: 'Telegram của tôi',
      sources: [{ service: 'trello', tool: 'trello.search_cards', args: { query: '' }, label: 'Trello' }],
      recurrence: { type: 'daily', time: '08:00' },
      timeZone: TZ,
    };
    const hash = computeTelegramDigestConfigHash(config);
    const conv = (
      await db.pool.query(
        "INSERT INTO conversations(user_id, status, title) VALUES($1, 'chatting', 'TG Digest') RETURNING id",
        [owner.id],
      )
    ).rows[0];
    const schedule = (
      await db.pool.query(
        `INSERT INTO schedules(user_id, conv_id, name, request, recurrence, services, status, next_run_at, kind, digest_config, digest_config_hash, digest_approved_at)
         VALUES($1, $2, 'Bản tin Trello qua Telegram', 'Mỗi sáng 8h gửi Trello qua Telegram', $3, '{trello,telegram}', 'active', '2026-11-02T01:00:00.000Z', 'telegram_digest', $4, $5, now())
         RETURNING *`,
        [owner.id, conv.id, JSON.stringify(config.recurrence), JSON.stringify(config), hash],
      )
    ).rows[0];
    await certifyScheduleFixture(db.pool, schedule.id);
    const run = (
      await db.pool.query(
        `INSERT INTO schedule_runs(schedule_id, schedule_version, trigger, due_at, status)
         VALUES($1, 1, 'scheduled', '2026-11-02T01:00:00.000Z', 'planning')
         RETURNING *`,
        [schedule.id],
      )
    ).rows[0];
    return { owner, credentials, credential, config, hash, convId: conv.id as string, schedule, runId: run.id as string };
  }

  async function seedTrelloSchedule(options?: {
    workspaceMode?: 'personal' | 'organization' | 'legacy';
    workspaceId?: string | null;
    destination?: 'slack' | 'telegram';
  }) {
    const owner = await db.person('TrelloOwner');
    const workspaceMode = options?.workspaceMode ?? 'personal';
    let workspaceId = options?.workspaceId ?? null;
    if (workspaceMode === 'organization' && workspaceId) {
      await db.pool.query(
        `INSERT INTO workspaces (id, name, invite_code, require_approval, created_by)
         VALUES ($1, 'Org Workspace', $2, true, $3)
         ON CONFLICT (id) DO NOTHING`,
        [workspaceId, `ATI-${workspaceId.slice(0, 4).toUpperCase()}-${workspaceId.slice(4, 8).toUpperCase()}`, owner.id],
      );
      await db.pool.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, status)
         VALUES ($1, $2, 'admin', 'active')
         ON CONFLICT (workspace_id, user_id) DO UPDATE SET status = 'active'`,
        [workspaceId, owner.id],
      );
    }

    const credentials = new CredentialRepo(db.pool, KEY);
    const trelloCred = await credentials.saveCredentials(
      'trello',
      encryptCredentials(
        {
          refreshToken: 'rt_fixture',
          memberId: 'mem-1',
          username: 'trello_tester',
        },
        KEY,
      ),
      owner.id,
    );

    const destination = options?.destination ?? 'slack';
    let tgCredId: string | undefined;
    if (destination === 'telegram') {
      const tgCred = await credentials.saveCredentials(
        'telegram',
        encryptCredentials(
          {
            telegramUserId: '777009',
            username: 'tg_trello',
            selectedChats: [{ chatId: '777009', title: 'Telegram Trello', type: 'private' }],
          },
          KEY,
        ),
        owner.id,
      );
      tgCredId = tgCred.id;
    }

    const recurrence = { type: 'daily' as const, time: '08:00' };
    const config: TrelloDigestConfig = {
      credentialId: trelloCred.id,
      trelloMemberId: 'mem-1',
      username: 'trello_tester',
      boards: [{ id: 'b1', name: 'Alpha' }],
      destination,
      channelId: destination === 'telegram' ? '777009' : 'C_OPS',
      channelName: destination === 'telegram' ? 'Telegram Trello' : 'ops',
      ...(destination === 'telegram'
        ? {
            telegramChatId: '777009',
            telegramChatTitle: 'Telegram Trello',
            telegramCredentialId: tgCredId,
          }
        : {}),
      dueSoonHours: 24,
    };
    const hash = computeTrelloDigestConfigHash({ config, recurrence, userId: owner.id });

    const conv = (
      await db.pool.query(
        `INSERT INTO conversations(user_id, status, title, workspace_id, workspace_mode)
         VALUES($1, 'chatting', 'Trello Digest', $2, $3) RETURNING id`,
        [owner.id, workspaceId, workspaceMode],
      )
    ).rows[0];
    const schedule = (
      await db.pool.query(
        `INSERT INTO schedules(user_id, conv_id, name, request, recurrence, services, status, next_run_at, kind, digest_config, digest_config_hash, digest_approved_at, workspace_id, workspace_mode)
         VALUES($1, $2, 'Bản tin Trello', 'Mỗi sáng 8h gửi bản tin Trello', $3, $4, 'active', '2026-11-02T01:00:00.000Z', 'trello_digest', $5, $6, now(), $7, $8)
         RETURNING *`,
        [
          owner.id,
          conv.id,
          JSON.stringify(recurrence),
          destination === 'telegram' ? '{trello,telegram}' : '{trello,slack}',
          JSON.stringify(config),
          hash,
          workspaceId,
          workspaceMode,
        ],
      )
    ).rows[0];
    await certifyScheduleFixture(db.pool, schedule.id);
    const run = (
      await db.pool.query(
        `INSERT INTO schedule_runs(schedule_id, schedule_version, trigger, due_at, status)
         VALUES($1, 1, 'scheduled', '2026-11-02T01:00:00.000Z', 'planning')
         RETURNING *`,
        [schedule.id],
      )
    ).rows[0];

    return {
      owner,
      credentials,
      trelloCred,
      recurrence,
      config,
      hash,
      convId: conv.id as string,
      schedule,
      runId: run.id as string,
    };
  }

  it('TRELLO-AUDIT-14 (OS Processes): two actual OS processes racing on the same PostgreSQL run row and loopback HTTP barrier send at most 1 Telegram message', async () => {
    const s = await seedTelegramSchedule('777001');
    let barrierHits = 0;
    let releaseBarrier!: () => void;
    const barrierPromise = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });
    let sendMessageCalls = 0;

    const server: Server = createServer(async (req, res) => {
      const url = req.url ?? '';
      if (url === '/read-barrier') {
        barrierHits++;
        if (barrierHits >= 2) releaseBarrier();
        await Promise.race([barrierPromise, new Promise((r) => setTimeout(r, 1500))]);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (url.endsWith('/getChat')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, result: { id: 777001, type: 'private', first_name: 'Tester' } }));
        return;
      }
      if (url.endsWith('/sendMessage')) {
        sendMessageCalls++;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            result: { message_id: 500 + sendMessageCalls, date: 1793581200, chat: { id: 777001, type: 'private' } },
          }),
        );
        return;
      }
      res.writeHead(404).end();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const dbConnString = (db.pool as any).options.connectionString as string;
      const envVars = {
        WORKER_DATABASE_URL: dbConnString,
        WORKER_RUN_ID: s.runId,
        WORKER_BARRIER_URL: `${baseUrl}/read-barrier`,
        WORKER_TELEGRAM_BASE_URL: baseUrl,
        WORKER_ENCRYPTION_KEY: KEY,
        WORKER_NOW_ISO: NOW.toISOString(),
      };

      const [p1, p2] = await Promise.all([runWorkerProcess(envVars), runWorkerProcess(envVars)]);
      expect(p1.code).toBe(0);
      expect(p2.code).toBe(0);
      expect(barrierHits).toBe(2);
      expect(sendMessageCalls).toBe(1);

      const row = (
        await db.pool.query('SELECT status, delivery_started_at, delivery FROM schedule_runs WHERE id = $1', [s.runId])
      ).rows[0];
      expect(row.status).toBe('digest_sent');
      expect(row.delivery_started_at).not.toBeNull();
      expect(row.delivery).toMatchObject({ chatId: '777001', messageId: 501 });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 20000);

  it('TRELLO-AUDIT-14 (In-Process Two ScheduleRunners & Admission Uniqueness): two ScheduleRunner instances racing on planNow(runId) and tick() send at most once', async () => {
    const s = await seedTelegramSchedule('777002');
    let reads = 0;
    let releaseRead!: () => void;
    const readBarrier = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    let sends = 0;

    const makeScheduleRunner = () => {
      const service = new ScheduleService({ pool: db.pool, timeZone: TZ });
      const digest = new TelegramDigestRunner({
        pool: db.pool,
        credentialRepo: s.credentials,
        encryptionKey: KEY,
        timeZone: TZ,
        adapterFactory: {
          getAdapterForService: async (name: string) => {
            if (name === 'telegram') {
              return {
                execute: async (tool: string) => {
                  expect(tool).toBe('telegram.send_message');
                  sends++;
                  return { messageId: 800 + sends, chatId: '777002' };
                },
              };
            }
            return {
              execute: async () => {
                reads++;
                if (reads >= 2) releaseRead();
                await Promise.race([readBarrier, new Promise((r) => setTimeout(r, 500))]);
                return [{ id: 'c1', name: 'Card 1', due: '2026-11-01T10:00:00.000Z', dueComplete: false, idMembers: [] }];
              },
            };
          },
        },
      });
      return new ScheduleRunner({
        pool: db.pool,
        timeZone: TZ,
        now: () => NOW,
        planRun: async () => {
          throw new Error('Unexpected planRun');
        },
        executeDigestRun: (run, signal) => digest.execute(run, signal),
        recordState: (client, row, at) => service.recordState(client, row, at),
      });
    };

    const sr1 = makeScheduleRunner();
    const sr2 = makeScheduleRunner();
    await Promise.all([sr1.planNow(s.runId), sr2.planNow(s.runId)]);

    expect(sends).toBe(1);
    const row = (
      await db.pool.query('SELECT status, delivery_started_at, delivery FROM schedule_runs WHERE id = $1', [s.runId])
    ).rows[0];
    expect(row.status).toBe('digest_sent');
    expect(row.delivery_started_at).not.toBeNull();
    expect(row.delivery?.messageId).toBe(801);
  });

  it('TRELLO-AUDIT-15 (Accepted POST + Real AbortSignal Timeout & Re-entry Block): accepted POST followed by AbortSignal timeout marks run needs_attention with delivery_started_at and blocks replan + re-entry', async () => {
    const s = await seedTelegramSchedule('777003');
    let acceptedPosts = 0;
    let inFlightDeliveryStartedAt: Date | null = null;

    const server: Server = createServer(async (req, res) => {
      const url = req.url ?? '';
      if (url.endsWith('/getChat')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, result: { id: 777003, type: 'private', first_name: 'Tester' } }));
        return;
      }
      if (url.endsWith('/sendMessage')) {
        acceptedPosts++;
        // Check that delivery_started_at is already durably committed BEFORE outbound HTTP response!
        const check = (
          await db.pool.query('SELECT delivery_started_at FROM schedule_runs WHERE id = $1', [s.runId])
        ).rows[0];
        inFlightDeliveryStartedAt = check?.delivery_started_at ?? null;
        // Hold connection open until client aborts via AbortSignal
        req.on('close', () => {
          try {
            res.destroy();
          } catch {
            // ignore
          }
        });
        return;
      }
      res.writeHead(404).end();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const service = new ScheduleService({ pool: db.pool, timeZone: TZ });
      const telegram = new TelegramAdapter({
        credentials: { botToken: '123456789:fixture_only_telegram_token' },
        telegramUserId: '777003',
        allowedScope: { chats: ['777003'] },
        baseUrl,
        fetchFn: (url, init) => {
          // Enforce a fast real AbortSignal timeout (150ms) on sendMessage
          const method = String(url).split('/').at(-1);
          if (method === 'sendMessage') {
            const timeoutSig = AbortSignal.timeout(150);
            const sig = init?.signal ? AbortSignal.any([init.signal, timeoutSig]) : timeoutSig;
            return fetch(url, { ...init, signal: sig });
          }
          return fetch(url, init);
        },
      });

      const digest = new TelegramDigestRunner({
        pool: db.pool,
        credentialRepo: s.credentials,
        encryptionKey: KEY,
        timeZone: TZ,
        adapterFactory: {
          getAdapterForService: async (name: string) =>
            name === 'telegram'
              ? telegram
              : {
                  execute: async () => [
                    { id: 'c1', name: 'Card Timeout', due: '2026-11-01T10:00:00.000Z', dueComplete: false, idMembers: [] },
                  ],
                },
        },
      });

      const runner = new ScheduleRunner({
        pool: db.pool,
        timeZone: TZ,
        now: () => NOW,
        planRun: async () => {
          throw new Error('Unexpected planRun');
        },
        executeDigestRun: (run, signal) => digest.execute(run, signal),
        recordState: (client, row, at) => service.recordState(client, row, at),
      });

      await runner.planNow(s.runId);

      expect(acceptedPosts).toBe(1);
      expect(inFlightDeliveryStartedAt).not.toBeNull();

      const row = (
        await db.pool.query('SELECT status, delivery_started_at, error FROM schedule_runs WHERE id = $1', [s.runId])
      ).rows[0];
      expect(row.status).toBe('needs_attention');
      expect(row.delivery_started_at).not.toBeNull();
      expect(row.error).toContain('TELEGRAM_DELIVERY_UNKNOWN');

      // Replan must be rejected with RUN_NOT_REPLANNABLE
      await expect(
        service.startRun({
          userId: s.owner.id,
          runId: s.runId,
          trigger: 'replan',
          now: new Date('2026-11-02T01:02:00.000Z'),
        }),
      ).rejects.toMatchObject({ code: 'RUN_NOT_REPLANNABLE' });

      // Direct re-entry on the same run must perform 0 additional sends
      await runner.planNow(s.runId);
      expect(acceptedPosts).toBe(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('TRELLO-AUDIT-15 (Pause/Cancel During Dispatch & Crash Classification): pausing schedule during in-flight unknown send does not deadlock and preserves needs_attention; reconcileScheduleRuns classifies claimed runs', async () => {
    const s = await seedTelegramSchedule('777004');
    const service = new ScheduleService({ pool: db.pool, timeZone: TZ });
    let sendCalls = 0;

    const digest = new TelegramDigestRunner({
      pool: db.pool,
      credentialRepo: s.credentials,
      encryptionKey: KEY,
      timeZone: TZ,
      adapterFactory: {
        getAdapterForService: async (name: string) => {
          if (name === 'telegram') {
            return {
              execute: async () => {
                sendCalls++;
                // Pause the schedule while outbound send is in-flight!
                // Because no DB lock is held across network I/O, this must not deadlock!
                await service.setStatus({
                  userId: s.owner.id,
                  scheduleId: s.schedule.id,
                  action: 'pause',
                  version: 1,
                  now: new Date('2026-11-02T01:00:31.000Z'),
                });
                const err = new Error('Socket closed after POST accepted');
                (err as any).category = 'UNKNOWN';
                throw err;
              },
            };
          }
          return {
            execute: async () => [
              { id: 'c1', name: 'Card Pause', due: '2026-11-01T10:00:00.000Z', dueComplete: false, idMembers: [] },
            ],
          };
        },
      },
    });

    const runner = new ScheduleRunner({
      pool: db.pool,
      timeZone: TZ,
      now: () => NOW,
      planRun: async () => {
        throw new Error('Unexpected planRun');
      },
      executeDigestRun: (run, signal) => digest.execute(run, signal),
      recordState: (client, row, at) => service.recordState(client, row, at),
    });

    await runner.planNow(s.runId);
    expect(sendCalls).toBe(1);

    const rowAfterPause = (
      await db.pool.query('SELECT status, delivery_started_at, error FROM schedule_runs WHERE id = $1', [s.runId])
    ).rows[0];
    // Pause MUST NOT overwrite an unknown in-flight delivery into 'discarded'!
    expect(rowAfterPause.status).toBe('needs_attention');
    expect(rowAfterPause.delivery_started_at).not.toBeNull();

    // Crash classification on startup (reconcileScheduleRuns):
    const trelloSeed = await seedTrelloSchedule();
    await db.pool.query('UPDATE schedule_runs SET delivery_started_at = now() WHERE id = $1', [trelloSeed.runId]);
    await reconcileScheduleRuns(db.pool);
    const reconciledTrello = (
      await db.pool.query('SELECT status, error FROM schedule_runs WHERE id = $1', [trelloSeed.runId])
    ).rows[0];
    expect(reconciledTrello.status).toBe('needs_attention');
    expect(reconciledTrello.error).toContain('TRELLO_DELIVERY_UNKNOWN');
  });

  it('TRELLO-AUDIT-08 (Malformed/Missing Receipts): rejects missing, empty, or "undefined" Slack ts and missing/non-numeric Telegram messageId as delivery_unknown / needs_attention', async () => {
    for (const badSlackRes of [{}, { ts: '' }, { ts: 'undefined' }, { ts: null }]) {
      const s = await seedTrelloSchedule({ destination: 'slack' });
      const runner = createTrelloDigestRunner({
        pool: db.pool,
        trelloConnection: async () => ({
          status: 'connected',
          connection: { credentialId: s.trelloCred.id, memberId: 'mem-1', username: 'trello_tester', boardIds: ['b1'] },
        }),
        getAdapter: async (serviceName: string) => {
          if (serviceName === 'trello') {
            return { execute: async () => [] };
          }
          if (serviceName === 'slack') {
            return {
              execute: async (tool: string) => {
                if (tool === 'slack.search_channels') return [{ id: 'C_OPS', name: 'ops' }];
                if (tool === 'slack.send_message') return badSlackRes;
              },
            };
          }
          return null;
        },
      });

      const outcome = await runner(
        {
          runId: s.runId,
          scheduleId: s.schedule.id,
          scheduleVersion: 1,
          userId: s.owner.id,
          name: s.schedule.name,
          request: s.schedule.request,
          dueAt: NOW,
          trigger: 'scheduled',
          recurrence: s.recurrence,
          digestConfig: s.config,
          digestConfigHash: s.hash,
        },
        s.convId,
        new AbortController().signal,
      );
      expect(outcome.state).toBe('delivery_unknown');
    }

    // Telegram destination on trello_digest with malformed messageId
    const sTgTrello = await seedTrelloSchedule({ destination: 'telegram' });
    const runnerTgTrello = createTrelloDigestRunner({
      pool: db.pool,
      trelloConnection: async () => ({
        status: 'connected',
        connection: {
          credentialId: sTgTrello.trelloCred.id,
          memberId: 'mem-1',
          username: 'trello_tester',
          boardIds: ['b1'],
        },
      }),
      telegramConnection: async () => ({
        status: 'connected',
        selectedChats: [{ chatId: '777009', title: 'Telegram Trello', type: 'private' }],
        connection: {
          credentialId: sTgTrello.config.telegramCredentialId!,
          telegramUserId: '777009',
          username: 'tg_trello',
          chatIds: ['777009'],
        },
      }),
      getAdapter: async (serviceName: string) => {
        if (serviceName === 'trello') return { execute: async () => [] };
        if (serviceName === 'telegram') {
          return { execute: async () => ({ ok: true }) }; // missing messageId!
        }
        return null;
      },
    });
    const outTgTrello = await runnerTgTrello(
      {
        runId: sTgTrello.runId,
        scheduleId: sTgTrello.schedule.id,
        scheduleVersion: 1,
        userId: sTgTrello.owner.id,
        name: sTgTrello.schedule.name,
        request: sTgTrello.schedule.request,
        dueAt: NOW,
        trigger: 'scheduled',
        recurrence: sTgTrello.recurrence,
        digestConfig: sTgTrello.config,
        digestConfigHash: sTgTrello.hash,
      },
      sTgTrello.convId,
      new AbortController().signal,
    );
    expect(outTgTrello.state).toBe('delivery_unknown');

    // Generic TelegramDigestRunner with missing messageId
    const sGenericTg = await seedTelegramSchedule('777005');
    const genericRunner = new TelegramDigestRunner({
      pool: db.pool,
      credentialRepo: sGenericTg.credentials,
      encryptionKey: KEY,
      timeZone: TZ,
      adapterFactory: {
        getAdapterForService: async (name: string) => {
          if (name === 'telegram') {
            return { execute: async () => ({ chatId: '777005' }) }; // missing messageId!
          }
          return {
            execute: async () => [{ id: 'c1', name: 'Card', due: null, dueComplete: false, idMembers: [] }],
          };
        },
      },
    });
    const outGenericTg = await genericRunner.execute(
      {
        runId: sGenericTg.runId,
        scheduleId: sGenericTg.schedule.id,
        scheduleVersion: 1,
        userId: sGenericTg.owner.id,
        name: sGenericTg.schedule.name,
        request: sGenericTg.schedule.request,
        dueAt: NOW,
        trigger: 'scheduled',
        digestConfig: sGenericTg.config,
        digestConfigHash: sGenericTg.hash,
      },
      new AbortController().signal,
    );
    expect(outGenericTg.status).toBe('delivery_unknown');
  });

  it('TRELLO-AUDIT-10 (Unknown Delivery Reconciliation): supports mark_sent and retry_new_run for trello_digest and telegram_digest with immutable config snapshot, pause/config-change guard, and single-use CAS', async () => {
    const service = new ScheduleService({ pool: db.pool, timeZone: TZ });

    // 1. Trello digest mark_sent + concurrent resolution once
    const sTrello1 = await seedTrelloSchedule({ destination: 'slack' });
    await db.pool.query(
      `UPDATE schedule_runs
       SET status = 'needs_attention',
           delivery_started_at = now(),
           error = 'TRELLO_DELIVERY_UNKNOWN: Mất kết nối sau khi gửi.'
       WHERE id = $1`,
      [sTrello1.runId],
    );

    const [resA, resB] = await Promise.allSettled([
      service.resolveRunDelivery({
        userId: sTrello1.owner.id,
        runId: sTrello1.runId,
        resolution: 'mark_sent',
        now: NOW,
      }),
      service.resolveRunDelivery({
        userId: sTrello1.owner.id,
        runId: sTrello1.runId,
        resolution: 'mark_sent',
        now: NOW,
      }),
    ]);
    const fulfilled = [resA, resB].filter((r) => r.status === 'fulfilled');
    const rejected = [resA, resB].filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({ code: 'DELIVERY_ALREADY_RESOLVED' });

    const resolvedRun1 = (fulfilled[0] as PromiseFulfilledResult<any>).value.run;
    expect(resolvedRun1.state).toBe('digest_sent');
    expect(resolvedRun1.deliveryResolution).toBe('confirmed_sent');

    // 2. Trello digest retry_new_run: requires confirmDuplicateRisk, rejects while paused WITHOUT consuming token, succeeds when active
    const sTrello2 = await seedTrelloSchedule({ destination: 'slack' });
    await db.pool.query(
      `UPDATE schedule_runs
       SET status = 'needs_attention',
           delivery_started_at = now(),
           error = 'TRELLO_DELIVERY_UNKNOWN: Mất kết nối.'
       WHERE id = $1`,
      [sTrello2.runId],
    );

    await expect(
      service.resolveRunDelivery({
        userId: sTrello2.owner.id,
        runId: sTrello2.runId,
        resolution: 'retry_new_run',
        confirmDuplicateRisk: false,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_RISK_CONFIRMATION_REQUIRED' });

    // Pause schedule and attempt retry_new_run -> must reject and NOT consume delivery_resolution token
    await db.pool.query("UPDATE schedules SET status = 'paused', next_run_at = NULL WHERE id = $1", [sTrello2.schedule.id]);
    await expect(
      service.resolveRunDelivery({
        userId: sTrello2.owner.id,
        runId: sTrello2.runId,
        resolution: 'retry_new_run',
        confirmDuplicateRisk: true,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'SCHEDULE_PAUSED' });

    const checkNotConsumed = (
      await db.pool.query('SELECT delivery_resolution FROM schedule_runs WHERE id = $1', [sTrello2.runId])
    ).rows[0];
    expect(checkNotConsumed.delivery_resolution).toBeNull();

    // Unpause schedule, but simulate version/config change -> must reject CONFIG_CHANGED_SINCE_RUN without consuming token
    await db.pool.query("UPDATE schedules SET status = 'active', next_run_at = $2, version = 2 WHERE id = $1", [sTrello2.schedule.id, NOW]);
    await expect(
      service.resolveRunDelivery({
        userId: sTrello2.owner.id,
        runId: sTrello2.runId,
        resolution: 'retry_new_run',
        confirmDuplicateRisk: true,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'CONFIG_CHANGED_SINCE_RUN' });

    // Restore original version = 1 -> retry_new_run succeeds and creates followUpRun
    await db.pool.query('UPDATE schedules SET version = 1 WHERE id = $1', [sTrello2.schedule.id]);
    const retriedTrello = await service.resolveRunDelivery({
      userId: sTrello2.owner.id,
      runId: sTrello2.runId,
      resolution: 'retry_new_run',
      confirmDuplicateRisk: true,
      now: NOW,
    });
    expect(retriedTrello.run.deliveryResolution).toBe('retried_new_run');
    expect(retriedTrello.followUpRun).not.toBeNull();
    expect(retriedTrello.followUpRun?.id).toBe(retriedTrello.run.deliveryFollowupRunId);

    // 3. Generic Telegram digest mark_sent and retry_new_run
    const sTg = await seedTelegramSchedule('777006');
    await db.pool.query(
      `UPDATE schedule_runs
       SET status = 'needs_attention',
           delivery_started_at = now(),
           error = 'TELEGRAM_DELIVERY_UNKNOWN: Timeout.'
       WHERE id = $1`,
      [sTg.runId],
    );
    const retriedTg = await service.resolveRunDelivery({
      userId: sTg.owner.id,
      runId: sTg.runId,
      resolution: 'retry_new_run',
      confirmDuplicateRisk: true,
      now: NOW,
    });
    expect(retriedTg.run.deliveryResolution).toBe('retried_new_run');
    expect(retriedTg.followUpRun).not.toBeNull();
  });

  it('TRELLO-AUDIT-06 (Trusted Workspace Context): propagates organization workspaceMode/workspaceId to trelloConnection, AdapterFactory, and candidate evaluation; never falls back to default/shared', async () => {
    const orgWorkspaceId = randomUUID();
    const sOrg = await seedTrelloSchedule({
      workspaceMode: 'organization',
      workspaceId: orgWorkspaceId,
      destination: 'slack',
    });

    const trelloConnCalls: Array<{ userId: string; scopeId?: string }> = [];
    const adapterCalls: Array<{ serviceName: string; context: any }> = [];

    const runner = createTrelloDigestRunner({
      pool: db.pool,
      trelloConnection: async (uid, scopeId) => {
        trelloConnCalls.push({ userId: uid, scopeId });
        return {
          status: 'connected',
          connection: {
            credentialId: sOrg.trelloCred.id,
            memberId: 'mem-1',
            username: 'trello_tester',
            boardIds: ['b1'],
          },
        };
      },
      getAdapter: async (serviceName, context) => {
        adapterCalls.push({ serviceName, context });
        if (serviceName === 'trello') return { execute: async () => [] };
        if (serviceName === 'slack') {
          return {
            execute: async (tool: string) => {
              if (tool === 'slack.search_channels') return [{ id: 'C_OPS', name: 'ops' }];
              if (tool === 'slack.send_message') return { ts: '1700000100.001' };
            },
          };
        }
        return null;
      },
    });

    const outcome = await runner(
      {
        runId: sOrg.runId,
        scheduleId: sOrg.schedule.id,
        scheduleVersion: 1,
        userId: sOrg.owner.id,
        workspaceMode: 'organization',
        workspaceId: orgWorkspaceId,
        name: sOrg.schedule.name,
        request: sOrg.schedule.request,
        dueAt: NOW,
        trigger: 'scheduled',
        recurrence: sOrg.recurrence,
        digestConfig: sOrg.config,
        digestConfigHash: sOrg.hash,
      },
      sOrg.convId,
      new AbortController().signal,
    );

    expect(outcome.state).toBe('digest_sent');
    expect(trelloConnCalls.length).toBeGreaterThanOrEqual(1);
    for (const call of trelloConnCalls) {
      expect(call.scopeId).toBe(orgWorkspaceId);
    }
    for (const call of adapterCalls) {
      expect(call.context).toMatchObject({
        userId: sOrg.owner.id,
        workspaceMode: 'organization',
        workspaceId: orgWorkspaceId,
      });
    }

    // Candidate evaluation in organization mode must pass orgWorkspaceId to trelloConnection and getAdapter
    const candidateTrelloScopes: Array<string | undefined> = [];
    const candidateSlackContexts: any[] = [];
    const cand = await evaluateTrelloDigestCandidate({
      userId: sOrg.owner.id,
      workspaceMode: 'organization',
      workspaceId: orgWorkspaceId,
      request: 'Mỗi sáng 08:30 gửi bản tin Trello bảng Alpha vào kênh #ops',
      services: ['trello', 'slack'],
      recurrence: sOrg.recurrence,
      trelloConnection: async (_uid, scopeId) => {
        candidateTrelloScopes.push(scopeId);
        return {
          status: 'connected',
          connection: {
            credentialId: sOrg.trelloCred.id,
            memberId: 'mem-1',
            username: 'trello_tester',
            boardIds: ['b1'],
          },
          memberBoards: [{ boardId: 'b1', boardName: 'Alpha' }],
        };
      },
      getAdapter: async (serviceName, context) => {
        if (serviceName === 'slack') {
          candidateSlackContexts.push(context);
          return { execute: async () => [{ id: 'C_OPS', name: 'ops' }] };
        }
        return null;
      },
    });
    expect(cand.canAutoDigest).toBe(true);
    expect(candidateTrelloScopes).toEqual([orgWorkspaceId]);
    expect(candidateSlackContexts[0]).toMatchObject({
      userId: sOrg.owner.id,
      workspaceMode: 'organization',
      workspaceId: orgWorkspaceId,
    });

    // AdapterFactory must never fall back to 'default' Trello scope or shared NULL-workspace Slack credentials when workspaceMode === 'organization' and workspaceId is null
    const teamRepo = new TrelloTeamRepo(db.pool);
    await teamRepo.replace({
      scopeId: 'default',
      chosenBy: sOrg.owner.id,
      workspaceId: 'ws-default',
      workspaceName: 'Default Team',
      boards: [{ boardId: 'b1', boardName: 'Alpha' }],
    });
    const factory = new AdapterFactory({
      credentialRepo: sOrg.credentials,
      encryptionKey: KEY,
      trelloTeamRepo: teamRepo,
      trelloTokens: {
        forConnection: () => ({ getAccessToken: async () => 'at_fixture' }),
      } as any,
    });
    await expect(
      factory.getAdapterForService('trello', {
        userId: sOrg.owner.id,
        phase: 'planning',
        workspaceMode: 'organization',
        workspaceId: null,
      }),
    ).rejects.toThrow();
    await expect(
      factory.getAdapterForService('slack', {
        userId: sOrg.owner.id,
        phase: 'planning',
        workspaceMode: 'organization',
        workspaceId: null,
      }),
    ).rejects.toThrow();
  });

  it('TRELLO-AUDIT-07 (Pre-Send Revocation During Source Read): revoking Trello credential during source read results in 0 outbound sends and blocked state', async () => {
    const s = await seedTrelloSchedule({ destination: 'slack' });
    let slackSends = 0;

    const runner = createTrelloDigestRunner({
      pool: db.pool,
      trelloConnection: async () => ({
        status: 'connected',
        connection: {
          credentialId: s.trelloCred.id,
          memberId: 'mem-1',
          username: 'trello_tester',
          boardIds: ['b1'],
        },
      }),
      getAdapter: async (serviceName) => {
        if (serviceName === 'trello') {
          return {
            execute: async () => {
              // Revoke Trello credential in PostgreSQL while source read is in progress!
              await db.pool.query(
                "UPDATE service_credentials SET status = 'reconnect_required' WHERE id = $1",
                [s.trelloCred.id],
              );
              return [
                {
                  id: 'c1',
                  name: 'Card Read Before Revoke',
                  url: 'https://trello.com/c/c1',
                  listId: 'l1',
                  boardId: 'b1',
                  due: '2026-11-01T00:00:00.000Z',
                  dueComplete: false,
                  idMembers: [],
                },
              ];
            },
          };
        }
        if (serviceName === 'slack') {
          return {
            execute: async (tool: string) => {
              if (tool === 'slack.search_channels') return [{ id: 'C_OPS', name: 'ops' }];
              if (tool === 'slack.send_message') {
                slackSends++;
                return { ts: '1700000200.001' };
              }
            },
          };
        }
        return null;
      },
    });

    const outcome = await runner(
      {
        runId: s.runId,
        scheduleId: s.schedule.id,
        scheduleVersion: 1,
        userId: s.owner.id,
        name: s.schedule.name,
        request: s.schedule.request,
        dueAt: NOW,
        trigger: 'scheduled',
        recurrence: s.recurrence,
        digestConfig: s.config,
        digestConfigHash: s.hash,
      },
      s.convId,
      new AbortController().signal,
    );

    expect(slackSends).toBe(0);
    expect(outcome.state).toBe('blocked');
  });

  it('TRELLO-AUDIT-17 (Destination Preflight Fail-Closed): fails closed with 0 sends when slack.search_channels throws non-auth error or returns non-array', async () => {
    const s = await seedTrelloSchedule({ destination: 'slack' });
    let slackSends = 0;

    for (const mode of ['throw_network', 'return_null'] as const) {
      const runner = createTrelloDigestRunner({
        pool: db.pool,
        trelloConnection: async () => ({
          status: 'connected',
          connection: {
            credentialId: s.trelloCred.id,
            memberId: 'mem-1',
            username: 'trello_tester',
            boardIds: ['b1'],
          },
        }),
        getAdapter: async (serviceName) => {
          if (serviceName === 'trello') return { execute: async () => [] };
          if (serviceName === 'slack') {
            return {
              execute: async (tool: string) => {
                if (tool === 'slack.search_channels') {
                  if (mode === 'throw_network') {
                    throw new StepError({
                      category: 'NETWORK',
                      message: 'Slack channel lookup timed out',
                      retryable: true,
                    });
                  }
                  return null;
                }
                if (tool === 'slack.send_message') {
                  slackSends++;
                  return { ts: '1700000300.001' };
                }
              },
            };
          }
          return null;
        },
      });

      const outcome = await runner(
        {
          runId: s.runId,
          scheduleId: s.schedule.id,
          scheduleVersion: 1,
          userId: s.owner.id,
          name: s.schedule.name,
          request: s.schedule.request,
          dueAt: NOW,
          trigger: 'scheduled',
          recurrence: s.recurrence,
          digestConfig: s.config,
          digestConfigHash: s.hash,
        },
        s.convId,
        new AbortController().signal,
      );

      expect(slackSends).toBe(0);
      expect(outcome.state).not.toBe('digest_sent');
    }
  });

  it('TRELLO-AUDIT-03 (ExecutionService Unknown Outcome): getExecutionStatus reports reconciliation_required for unknown step state', () => {
    const execService = new ExecutionService({
      planRepo: {} as any,
      adapterFactory: { getAdapterForService: async () => null },
    });
    (execService as any).activeControllers.set('plan-unknown-1', {
      isExecuting: () => false,
      getAllStepStates: () => ({
        step_1: { stepId: 'step_1', status: 'unknown', output: null, error: { message: 'Timeout after requestSent' } },
      }),
    });

    const status = execService.getExecutionStatus('plan-unknown-1');
    expect(status).toEqual({
      status: 'reconciliation_required',
      pausedStepId: 'step_1',
    });
  });

  it('XSVC-B (GAS-08 ∩ TRELLO-AUDIT-10): trello_digest and telegram_digest preserve dispatched_config on retry_new_run and never leak post-run mutated schedule.digest_config during mark_sent', async () => {
    const service = new ScheduleService({ pool: db.pool, timeZone: TZ });

    // 1. Trello digest with persisted dispatched_config snapshot: mutate schedule version + channel afterwards -> mark_sent MUST use dispatched_config ('C_OPS'), not mutated 'C_MUTATED_WRONG'
    const sTrelloSnap = await seedTrelloSchedule({ destination: 'slack' });
    await db.pool.query(
      `UPDATE schedule_runs
       SET status = 'needs_attention',
           delivery_started_at = now(),
           error = 'TRELLO_DELIVERY_UNKNOWN: Timeout.',
           dispatched_config = $2::jsonb,
           dispatched_config_hash = $3
       WHERE id = $1`,
      [sTrelloSnap.runId, JSON.stringify(sTrelloSnap.config), sTrelloSnap.hash],
    );
    const mutatedTrelloCfg: TrelloDigestConfig = {
      ...sTrelloSnap.config,
      channelId: 'C_MUTATED_WRONG',
      channelName: 'mutated-wrong',
    };
    await db.pool.query(
      `UPDATE schedules
       SET version = 2,
           digest_config = $2::jsonb
       WHERE id = $1`,
      [sTrelloSnap.schedule.id, JSON.stringify(mutatedTrelloCfg)],
    );

    const resolvedTrelloSnap = await service.resolveRunDelivery({
      userId: sTrelloSnap.owner.id,
      runId: sTrelloSnap.runId,
      resolution: 'mark_sent',
      now: NOW,
    });
    expect(resolvedTrelloSnap.run.state).toBe('digest_sent');
    expect(resolvedTrelloSnap.run.delivery).toMatchObject({
      destination: 'slack',
      targetId: 'C_OPS',
      targetLabel: 'ops',
    });

    // 2. Legacy/un-snapshotted Telegram digest run where schedule version advanced after run: mark_sent MUST NOT read mutated chatId ('999999_WRONG'), falling back safely to 'unknown'
    const sTgLegacy = await seedTelegramSchedule('777088');
    await db.pool.query(
      `UPDATE schedule_runs
       SET status = 'needs_attention',
           delivery_started_at = now(),
           error = 'TELEGRAM_DELIVERY_UNKNOWN: Timeout.',
           dispatched_config = NULL,
           dispatched_config_hash = NULL
       WHERE id = $1`,
      [sTgLegacy.runId],
    );
    await db.pool.query(
      `UPDATE schedules
       SET version = 2,
           digest_config = $2::jsonb
       WHERE id = $1`,
      [
        sTgLegacy.schedule.id,
        JSON.stringify({ ...sTgLegacy.config, chatId: '999999_WRONG', chatTitle: 'Wrong Chat' }),
      ],
    );

    const resolvedTgLegacy = await service.resolveRunDelivery({
      userId: sTgLegacy.owner.id,
      runId: sTgLegacy.runId,
      resolution: 'mark_sent',
      now: NOW,
    });
    expect(resolvedTgLegacy.run.state).toBe('digest_sent');
    expect(resolvedTgLegacy.run.delivery).toMatchObject({
      chatId: 'unknown',
    });
    expect((resolvedTgLegacy.run.delivery as any)?.chatTitle).toBeUndefined();

    // 3. retry_new_run on active trello_digest persists dispatched_config and dispatched_config_hash on the manual replacement run
    const sTrelloRetry = await seedTrelloSchedule({ destination: 'slack' });
    await db.pool.query(
      `UPDATE schedule_runs
       SET status = 'needs_attention',
           delivery_started_at = now(),
           error = 'TRELLO_DELIVERY_UNKNOWN: Timeout.'
       WHERE id = $1`,
      [sTrelloRetry.runId],
    );
    const retried = await service.resolveRunDelivery({
      userId: sTrelloRetry.owner.id,
      runId: sTrelloRetry.runId,
      resolution: 'retry_new_run',
      confirmDuplicateRisk: true,
      now: NOW,
    });
    const followUpRow = (
      await db.pool.query(
        'SELECT dispatched_config, dispatched_config_hash FROM schedule_runs WHERE id = $1',
        [retried.followUpRun!.id],
      )
    ).rows[0];
    expect(followUpRow.dispatched_config).toMatchObject({
      channelId: 'C_OPS',
      destination: 'slack',
    });
    expect(followUpRow.dispatched_config_hash).toBe(sTrelloRetry.hash);
  });
});
