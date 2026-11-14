import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { encryptCredentials } from '@wap/tool-adapters';
import { GMAIL_MODIFY_SCOPE, type ScheduleResponse } from '@wap/tool-schemas';
import { createMigratedSchema } from '../../helpers/gmail-test-db.js';
import { CredentialRepo } from '../../../src/db/repositories/credential-repo.js';
import { GmailConnectionRepo } from '../../../src/db/repositories/gmail-connection-repo.js';
import { ConversationRepo } from '../../../src/db/repositories/conversation-repo.js';
import { MessageRepo } from '../../../src/db/repositories/message-repo.js';
import { ChatService } from '../../../src/services/chat-service.js';
import { ScheduleConflict, ScheduleService } from '../../../src/services/schedules/schedule-service.js';
import { TELEGRAM_DELIVERY_UNKNOWN } from '../../../src/services/schedules/telegram-digest-runner.js';

const ENC_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const GMAIL_CLIENT_ID = 'gmail-g2-m315-crash-client.apps.googleusercontent.com';
const TZ = 'Asia/Ho_Chi_Minh';
const PROPOSAL_NOW = new Date('2026-11-02T00:00:00.000Z'); // 07:00 VN -> first due_at 08:00 VN (01:00Z)
const TICK_NOW = new Date('2026-11-02T01:00:30.000Z'); // 08:00:30 VN
const WORKER_SCRIPT = fileURLToPath(new URL('../../helpers/gmail-main315-crash-worker.ts', import.meta.url));

function createBarrier<T = void>() {
  let resolveFn!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolveFn = resolve;
  });
  return { promise, resolve: resolveFn };
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? (JSON.parse(raw) as Record<string, any>) : {};
}

interface SyntheticProviderHarness {
  baseUrl: string;
  oauthRefreshes: Array<{ pid: number; refreshToken: string }>;
  gmailReads: Array<{ pid: number; userId: string; authHeader: string; tool: string; args: Record<string, unknown> }>;
  llmCalls: Array<{ pid: number; prompt: string }>;
  telegramSends: Array<{ chatId: string; text: string; messageId: number }>;
  checkpoints: Array<{ pid: number; stage: string; [key: string]: unknown }>;
  holdOnGmailRead: boolean;
  gmailReadEntered: ReturnType<typeof createBarrier<{ pid: number; release: () => void }>>;
  holdOnTelegramSend: boolean;
  telegramSendEntered: ReturnType<typeof createBarrier<{ chatId: string; text: string; release: () => void }>>;
  heldCheckpoints: Set<string>;
  waitForCheckpoint(stage: string): Promise<{ pid: number; release: () => void; payload: Record<string, unknown> }>;
  close(): Promise<void>;
}

async function startSyntheticProviderServer(): Promise<SyntheticProviderHarness> {
  const oauthRefreshes: SyntheticProviderHarness['oauthRefreshes'] = [];
  const gmailReads: SyntheticProviderHarness['gmailReads'] = [];
  const llmCalls: SyntheticProviderHarness['llmCalls'] = [];
  const telegramSends: SyntheticProviderHarness['telegramSends'] = [];
  const checkpoints: SyntheticProviderHarness['checkpoints'] = [];
  const pendingCheckpointWaiters = new Map<
    string,
    Array<(v: { pid: number; release: () => void; payload: Record<string, unknown> }) => void>
  >();
  const openHoldReleases: Array<() => void> = [];

  const harness: SyntheticProviderHarness = {
    baseUrl: '',
    oauthRefreshes,
    gmailReads,
    llmCalls,
    telegramSends,
    checkpoints,
    holdOnGmailRead: false,
    gmailReadEntered: createBarrier(),
    holdOnTelegramSend: false,
    telegramSendEntered: createBarrier(),
    heldCheckpoints: new Set<string>(),
    waitForCheckpoint(stage: string) {
      return new Promise((resolve) => {
        const list = pendingCheckpointWaiters.get(stage) ?? [];
        list.push(resolve);
        pendingCheckpointWaiters.set(stage, list);
      });
    },
    async close() {
      for (const rel of openHoldReleases.splice(0)) {
        rel();
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };

  const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = req.url ?? '/';
      const body = req.method === 'POST' ? await readJsonBody(req) : {};

      if (url === '/checkpoint') {
        const stage = String(body.stage ?? '');
        const pid = Number(body.pid ?? 0);
        checkpoints.push({ ...body, pid, stage });
        const shouldHold = harness.heldCheckpoints.has(stage);
        let released = false;
        let finishHold = () => {};
        const holdPromise = shouldHold
          ? new Promise<void>((resolve) => {
              finishHold = () => {
                if (!released) {
                  released = true;
                  resolve();
                }
              };
              openHoldReleases.push(finishHold);
              req.on('close', finishHold);
            })
          : Promise.resolve();

        const waiters = pendingCheckpointWaiters.get(stage);
        if (waiters && waiters.length > 0) {
          const w = waiters.shift()!;
          w({ pid, release: finishHold, payload: body });
        }

        await holdPromise;
        if (!res.writableEnded) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        }
        return;
      }

      if (url === '/oauth/refresh') {
        const refreshToken = String(body.refreshToken ?? '');
        const pid = Number(body.pid ?? 0);
        oauthRefreshes.push({ pid, refreshToken });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            accessToken: `ya29.crash-tok-${refreshToken}`,
            expiresInSeconds: 3600,
            scopes: [GMAIL_MODIFY_SCOPE],
          }),
        );
        return;
      }

      if (url === '/gmail/execute') {
        const pid = Number(body.pid ?? 0);
        const userId = String(body.userId ?? '');
        const authHeader = String(req.headers.authorization ?? '');
        const tool = String(body.tool ?? '');
        const args = (body.args ?? {}) as Record<string, unknown>;
        gmailReads.push({ pid, userId, authHeader, tool, args });

        if (harness.holdOnGmailRead) {
          let released = false;
          await new Promise<void>((resolve) => {
            const release = () => {
              if (!released) {
                released = true;
                resolve();
              }
            };
            openHoldReleases.push(release);
            req.on('close', release);
            harness.gmailReadEntered.resolve({ pid, release });
          });
        }

        if (!res.writableEnded) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify([
              {
                id: `th-gmail-${gmailReads.length}`,
                subject: 'Báo cáo ngân sách Q4 khẩn',
                from: 'CFO <cfo@example.test>',
                snippet: 'Cần xác nhận ngân sách trước 10h sáng.',
                hasAttachment: false,
                attachmentNames: [],
              },
            ]),
          );
        }
        return;
      }

      if (url === '/llm/summarize') {
        llmCalls.push({ pid: Number(body.pid ?? 0), prompt: String(body.prompt ?? '') });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ summary: 'Có 1 thư ngân sách Q4 cần duyệt trước 10h.' }));
        return;
      }

      if (url.startsWith('/telegram/bot')) {
        const method = url.split('/').at(-1) ?? '';
        if (method === 'getChat') {
          const numericChatId = Number(body.chat_id ?? 777111222);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              ok: true,
              result: {
                id: numericChatId,
                type: String(numericChatId).startsWith('-') ? 'supergroup' : 'private',
                first_name: 'CrashOwner',
              },
            }),
          );
          return;
        }
        if (method === 'sendMessage') {
          const chatId = String(body.chat_id ?? '');
          const text = String(body.text ?? '');
          const messageId = 950 + telegramSends.length + 1;
          telegramSends.push({ chatId, text, messageId });

          if (harness.holdOnTelegramSend) {
            let released = false;
            await new Promise<void>((resolve) => {
              const release = () => {
                if (!released) {
                  released = true;
                  resolve();
                }
              };
              openHoldReleases.push(release);
              req.on('close', release);
              harness.telegramSendEntered.resolve({ chatId, text, release });
            });
          }

          if (!res.writableEnded) {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(
              JSON.stringify({
                ok: true,
                result: {
                  message_id: messageId,
                  date: 1793581230,
                  chat: { id: Number(chatId) || 777111222, type: 'private' },
                },
              }),
            );
          }
          return;
        }
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: `Unhandled synthetic route: ${url}` }));
    } catch (err) {
      if (!res.writableEnded) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  harness.baseUrl = `http://127.0.0.1:${port}`;
  server.keepAliveTimeout = 1;
  return harness;
}

interface SpawnedWorkerHandle {
  child: ChildProcess;
  pid: number;
  shutdownMarkerPath: string;
  waitForExit(): Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>;
  hardKill(): Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>;
}

function spawnCrashWorker(opts: {
  databaseUrl: string;
  providerBaseUrl: string;
  nowIso: string;
  mode: 'tick' | 'reconcile_and_tick' | 'reconcile_only';
  holdStage?: '' | 'after_digest_execute_before_runner_persist' | 'after_runner_commit';
  allowCleanExit?: boolean;
  markerDir: string;
}): SpawnedWorkerHandle {
  const shutdownMarkerPath = join(opts.markerDir, `shutdown-${randomUUID()}.log`);
  const child = spawn(process.execPath, ['--import', 'tsx', WORKER_SCRIPT], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      NODE_ENV: 'test',
      WORKER_DATABASE_URL: opts.databaseUrl,
      WORKER_PROVIDER_BASE_URL: opts.providerBaseUrl,
      WORKER_ENCRYPTION_KEY: ENC_KEY,
      WORKER_GMAIL_CLIENT_ID: GMAIL_CLIENT_ID,
      WORKER_NOW_ISO: opts.nowIso,
      WORKER_MODE: opts.mode,
      WORKER_HOLD_STAGE: opts.holdStage ?? '',
      WORKER_SHUTDOWN_MARKER_PATH: shutdownMarkerPath,
      WORKER_ALLOW_CLEAN_EXIT: opts.allowCleanExit ? '1' : '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk) => {
    stdout += String(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    stderr += String(chunk);
  });

  const exitPromise = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
  }>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });

  if (!child.pid) {
    throw new Error('Failed to spawn distinct OS worker process');
  }

  return {
    child,
    pid: child.pid,
    shutdownMarkerPath,
    waitForExit: () => exitPromise,
    async hardKill() {
      try {
        process.kill(child.pid!, 'SIGKILL');
      } catch {
        // Already exited.
      }
      return exitPromise;
    },
  };
}

describe(
  'GMAIL-G2 × MAIN #315 — Physical OS Process Crash & Durable Ambiguous Delivery Recovery',
  { timeout: 20_000 },
  () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let schemaDatabaseUrl: string;
  let markerDir: string;
  const activeWorkers: SpawnedWorkerHandle[] = [];
  const activeServers: SyntheticProviderHarness[] = [];

  beforeAll(async () => {
    db = await createMigratedSchema('gmail_m315_crash');
    schemaDatabaseUrl = String((db.pool as any).options.connectionString);
    markerDir = mkdtempSync(join(tmpdir(), 'gmail-m315-markers-'));
  });

  beforeEach(async () => {
    await db.pool.query('DELETE FROM schedule_runs; DELETE FROM schedules; DELETE FROM service_credentials;');
  });

  afterEach(async () => {
    for (const w of activeWorkers.splice(0)) {
      await w.hardKill().catch(() => undefined);
    }
    for (const s of activeServers.splice(0)) {
      await s.close().catch(() => undefined);
    }
  });

  afterAll(async () => {
    await db?.close();
    if (markerDir && existsSync(markerDir)) {
      rmSync(markerDir, { recursive: true, force: true });
    }
  });

  async function seedBoundGmailTelegramSchedule(opts: {
    userName?: string;
    email?: string;
    chatId?: string;
  } = {}) {
    const owner = await db.person(opts.userName ?? 'GmailCrashOwner');
    const credRepo = new CredentialRepo(db.pool, ENC_KEY);
    const gmailRepo = new GmailConnectionRepo(db.pool);
    const chatId = opts.chatId ?? '777111222';
    const email = opts.email ?? `owner-${randomUUID().slice(0, 8)}@gmail.test`;

    const tgRow = await credRepo.saveCredentials(
      'telegram',
      encryptCredentials(
        {
          telegramUserId: chatId,
          username: 'crash_owner_tg',
          displayName: 'Crash Owner',
          selectedChats: [{ chatId, title: 'Telegram cá nhân', type: 'private' }],
        },
        ENC_KEY,
      ),
      owner.id,
    );

    const refreshToken = `1//rt-gmail-${randomUUID()}`;
    const gmailRow = await credRepo.saveCredentials(
      'gmail',
      encryptCredentials(
        {
          oauthClientId: GMAIL_CLIENT_ID,
          refreshToken,
          email,
          scopes: [GMAIL_MODIFY_SCOPE],
          connectedAt: new Date().toISOString(),
        },
        ENC_KEY,
      ),
      owner.id,
    );

    const convRepo = new ConversationRepo(db.pool);
    const msgRepo = new MessageRepo(db.pool);
    const scheduleService = new ScheduleService({
      pool: db.pool,
      timeZone: TZ,
      encryptionKey: ENC_KEY,
      gmailOAuthClientId: GMAIL_CLIENT_ID,
    } as any);

    const emitted: Array<{ event: string; payload: any }> = [];
    const chatService = new ChatService({
      msgRepo,
      convRepo,
      planner: {
        processMessage: async () =>
          ({
            kind: 'schedule',
            action: 'create',
            name: 'Bản tin Gmail sáng',
            request: 'Tóm tắt email chưa đọc trong hộp thư đến gửi vào Telegram của tôi',
            recurrence: { type: 'daily', time: '08:00' },
            summary: 'Mỗi sáng 8h gửi bản tin Gmail vào Telegram',
          }) satisfies ScheduleResponse,
        routeSchedule: async () => ({ services: ['gmail', 'telegram'], unavailable: [] }),
      },
      eventEmitter: { emit: (event, payload) => emitted.push({ event, payload }) },
      telegramConnection: async () => ({
        status: 'connected' as const,
        selectedChats: [{ chatId, title: 'Telegram cá nhân', type: 'private' as const }],
        connection: {
          credentialId: tgRow.id,
          telegramUserId: chatId,
          username: 'crash_owner_tg',
          chatIds: [chatId],
        },
      }),
      schedules: {
        repo: scheduleService.repo,
        pool: db.pool,
        encryptionKey: ENC_KEY,
        gmailOAuthClientId: GMAIL_CLIENT_ID,
        timeZone: TZ,
        now: () => PROPOSAL_NOW,
      } as any,
    });

    const conv = await convRepo.createConversation(owner.id, 'Hội thoại lịch Gmail Crash');
    await chatService.handleUserMessage({
      conversationId: conv.id,
      userId: owner.id,
      content: 'Tóm tắt email chưa đọc trong hộp thư đến gửi vào Telegram của tôi',
    });
    for (let i = 0; i < 100 && !emitted.some((e) => e.event === 'schedule_proposal'); i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    const proposalEvent = emitted.find((e) => e.event === 'schedule_proposal')!;
    expect(proposalEvent).toBeDefined();

    const confirmed = await scheduleService.confirmProposal({
      userId: owner.id,
      convId: conv.id,
      messageId: proposalEvent.payload.messageId,
      approvalMode: 'auto_digest',
      now: PROPOSAL_NOW,
    });

    return {
      owner,
      credRepo,
      gmailRepo,
      scheduleService,
      conv,
      scheduleId: confirmed.schedule.id,
      tgCredentialId: tgRow.id,
      gmailCredentialId: gmailRow.id,
      refreshToken,
      email,
      chatId,
    };
  }

  it('RST-01: physical OS crash during Gmail read BEFORE outbound send leaves delivery_started_at NULL and transitions to interrupted on restart with 0 Telegram sends', async () => {
    const f = await seedBoundGmailTelegramSchedule();
    const provider = await startSyntheticProviderServer();
    activeServers.push(provider);
    provider.holdOnGmailRead = true;

    const worker1 = spawnCrashWorker({
      databaseUrl: schemaDatabaseUrl,
      providerBaseUrl: provider.baseUrl,
      nowIso: TICK_NOW.toISOString(),
      mode: 'tick',
      markerDir,
    });
    activeWorkers.push(worker1);

    const readHit = await provider.gmailReadEntered.promise;
    expect(worker1.pid).not.toBe(process.pid);
    expect(readHit.pid).toBe(worker1.pid);

    const inFlightRow = (
      await db.pool.query(
        'SELECT id, status, delivery_started_at FROM schedule_runs WHERE schedule_id = $1',
        [f.scheduleId],
      )
    ).rows[0];
    expect(inFlightRow.status).toBe('planning');
    expect(inFlightRow.delivery_started_at).toBeNull();

    const exit1 = await worker1.hardKill();
    readHit.release();
    expect(exit1.code).not.toBe(0);
    expect(existsSync(worker1.shutdownMarkerPath)).toBe(false);
    expect(provider.telegramSends).toHaveLength(0);

    provider.holdOnGmailRead = false;
    const worker2 = spawnCrashWorker({
      databaseUrl: schemaDatabaseUrl,
      providerBaseUrl: provider.baseUrl,
      nowIso: TICK_NOW.toISOString(),
      mode: 'reconcile_and_tick',
      allowCleanExit: true,
      markerDir,
    });
    activeWorkers.push(worker2);
    expect(worker2.pid).not.toBe(worker1.pid);
    expect(worker2.pid).not.toBe(process.pid);

    const exit2 = await worker2.waitForExit();
    expect(exit2.code).toBe(0);

    const recoveredRow = (
      await db.pool.query(
        'SELECT id, status, delivery_started_at, error, delivery FROM schedule_runs WHERE id = $1',
        [inFlightRow.id],
      )
    ).rows[0];
    expect(recoveredRow.status).toBe('interrupted');
    expect(recoveredRow.delivery_started_at).toBeNull();
    expect(recoveredRow.delivery).toBeNull();
    expect(provider.telegramSends).toHaveLength(0);
  });

  it('RST-02: physical OS crash while Telegram sendMessage HTTP is in flight commits durable delivery_started_at BEFORE HTTP, transitions to needs_attention (TELEGRAM_DELIVERY_UNKNOWN) on restart, performs 0 auto-replays, and denies unsafe manual replan', async () => {
    const f = await seedBoundGmailTelegramSchedule();
    const provider = await startSyntheticProviderServer();
    activeServers.push(provider);
    provider.holdOnTelegramSend = true;

    const worker1 = spawnCrashWorker({
      databaseUrl: schemaDatabaseUrl,
      providerBaseUrl: provider.baseUrl,
      nowIso: TICK_NOW.toISOString(),
      mode: 'tick',
      markerDir,
    });
    activeWorkers.push(worker1);

    const sendHit = await provider.telegramSendEntered.promise;
    expect(worker1.pid).not.toBe(process.pid);
    expect(provider.gmailReads).toHaveLength(1);
    expect(provider.llmCalls).toHaveLength(1);
    expect(provider.telegramSends).toHaveLength(1);

    // Verify durable delivery_started_at is ALREADY committed AND zero PG locks are held across HTTP!
    const verifyClient = await db.pool.connect();
    let crashedRunId = '';
    try {
      await verifyClient.query('BEGIN');
      const schedLock = await verifyClient.query(
        'SELECT id FROM schedules WHERE id = $1 FOR UPDATE NOWAIT',
        [f.scheduleId],
      );
      expect(schedLock.rowCount).toBe(1);
      const credLock = await verifyClient.query(
        'SELECT id FROM service_credentials WHERE id = $1 FOR UPDATE NOWAIT',
        [f.gmailCredentialId],
      );
      expect(credLock.rowCount).toBe(1);
      const runRow = (
        await verifyClient.query(
          'SELECT id, status, delivery_started_at, delivery FROM schedule_runs WHERE schedule_id = $1 FOR UPDATE NOWAIT',
          [f.scheduleId],
        )
      ).rows[0];
      expect(runRow.status).toBe('planning');
      expect(runRow.delivery_started_at).not.toBeNull();
      expect(runRow.delivery).toBeNull();
      crashedRunId = runRow.id;
    } finally {
      await verifyClient.query('ROLLBACK');
      verifyClient.release();
    }

    // Hard OS crash (TerminateProcess / SIGKILL) while Telegram HTTP request is in flight!
    const exit1 = await worker1.hardKill();
    sendHit.release();
    expect(exit1.code).not.toBe(0);
    expect(existsSync(worker1.shutdownMarkerPath)).toBe(false);

    // Spawn distinct OS process #2: runs startup reconcileScheduleRuns + tick()
    provider.holdOnTelegramSend = false;
    const worker2 = spawnCrashWorker({
      databaseUrl: schemaDatabaseUrl,
      providerBaseUrl: provider.baseUrl,
      nowIso: TICK_NOW.toISOString(),
      mode: 'reconcile_and_tick',
      allowCleanExit: true,
      markerDir,
    });
    activeWorkers.push(worker2);
    expect(worker2.pid).not.toBe(worker1.pid);
    expect(worker2.pid).not.toBe(process.pid);

    const exit2 = await worker2.waitForExit();
    expect(exit2.code).toBe(0);

    // Zero automatic replay sends or extra Gmail/LLM calls on restart!
    expect(provider.telegramSends).toHaveLength(1);
    expect(provider.gmailReads).toHaveLength(1);
    expect(provider.llmCalls).toHaveLength(1);

    const allRuns = (
      await db.pool.query(
        'SELECT id, status, delivery_started_at, error, delivery FROM schedule_runs WHERE schedule_id = $1 ORDER BY created_at ASC',
        [f.scheduleId],
      )
    ).rows;
    expect(allRuns).toHaveLength(1);
    expect(allRuns[0].id).toBe(crashedRunId);
    expect(allRuns[0].status).toBe('needs_attention');
    expect(allRuns[0].delivery_started_at).not.toBeNull();
    expect(allRuns[0].error).toBe(TELEGRAM_DELIVERY_UNKNOWN);

    // ScheduleService listRuns view maps the run to state = 'needs_attention'
    const runViews = await f.scheduleService.listRuns(f.owner.id, f.scheduleId, 10, TICK_NOW);
    expect(runViews[0]?.id).toBe(crashedRunId);
    expect(runViews[0]?.state).toBe('needs_attention');
    expect(runViews[0]?.deliveryStartedAt).not.toBeNull();

    // Unsafe manual replan MUST be denied with RUN_NOT_REPLANNABLE
    await expect(
      f.scheduleService.startRun({
        userId: f.owner.id,
        runId: crashedRunId,
        trigger: 'replan',
        now: TICK_NOW,
      }),
    ).rejects.toMatchObject({ code: 'RUN_NOT_REPLANNABLE' });

    // Unsafe resolveRunDelivery('retry_new_run') without confirmDuplicateRisk MUST be denied
    await expect(
      f.scheduleService.resolveRunDelivery({
        userId: f.owner.id,
        runId: crashedRunId,
        resolution: 'retry_new_run',
        confirmDuplicateRisk: false,
        now: TICK_NOW,
      }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_RISK_CONFIRMATION_REQUIRED' });
  });

  it('RST-03A: physical OS crash AFTER Telegram HTTP 200 OK but BEFORE ScheduleRunner persists completion preserves needs_attention (TELEGRAM_DELIVERY_UNKNOWN), never misclassifies as interrupted, performs 0 duplicate sends, and denies manual replan', async () => {
    const f = await seedBoundGmailTelegramSchedule();
    const provider = await startSyntheticProviderServer();
    activeServers.push(provider);
    provider.heldCheckpoints.add('after_digest_execute_before_runner_persist');
    const checkpointWait = provider.waitForCheckpoint('after_digest_execute_before_runner_persist');

    const worker1 = spawnCrashWorker({
      databaseUrl: schemaDatabaseUrl,
      providerBaseUrl: provider.baseUrl,
      nowIso: TICK_NOW.toISOString(),
      mode: 'tick',
      holdStage: 'after_digest_execute_before_runner_persist',
      markerDir,
    });
    activeWorkers.push(worker1);

    const hit = await checkpointWait;
    expect(hit.pid).toBe(worker1.pid);
    expect(hit.payload.outcomeStatus).toBe('digest_sent');
    expect(provider.telegramSends).toHaveLength(1);
    expect(provider.telegramSends[0]?.messageId).toBe(951);

    // Telegram HTTP 200 OK was ALREADY received by worker1, but ScheduleRunner has NOT committed completion yet!
    const preCrashRow = (
      await db.pool.query(
        'SELECT id, status, delivery_started_at, delivery FROM schedule_runs WHERE schedule_id = $1',
        [f.scheduleId],
      )
    ).rows[0];
    expect(preCrashRow.status).toBe('planning');
    expect(preCrashRow.delivery_started_at).not.toBeNull();
    expect(preCrashRow.delivery).toBeNull();

    // Abrupt OS termination BEFORE ScheduleRunner persists completion!
    const exit1 = await worker1.hardKill();
    hit.release();
    expect(exit1.code).not.toBe(0);
    expect(existsSync(worker1.shutdownMarkerPath)).toBe(false);

    // Restart distinct OS process #2: reconcileScheduleRuns + tick()
    provider.heldCheckpoints.clear();
    const worker2 = spawnCrashWorker({
      databaseUrl: schemaDatabaseUrl,
      providerBaseUrl: provider.baseUrl,
      nowIso: TICK_NOW.toISOString(),
      mode: 'reconcile_and_tick',
      allowCleanExit: true,
      markerDir,
    });
    activeWorkers.push(worker2);
    expect(worker2.pid).not.toBe(worker1.pid);

    const exit2 = await worker2.waitForExit();
    expect(exit2.code).toBe(0);

    // Zero duplicate Telegram sends on restart!
    expect(provider.telegramSends).toHaveLength(1);

    const postRestartRuns = (
      await db.pool.query(
        'SELECT id, status, delivery_started_at, error, delivery FROM schedule_runs WHERE schedule_id = $1',
        [f.scheduleId],
      )
    ).rows;
    expect(postRestartRuns).toHaveLength(1);
    expect(postRestartRuns[0].status).toBe('needs_attention');
    expect(postRestartRuns[0].status).not.toBe('interrupted');
    expect(postRestartRuns[0].delivery_started_at).not.toBeNull();
    expect(postRestartRuns[0].error).toBe(TELEGRAM_DELIVERY_UNKNOWN);

    // Unsafe manual replan is denied!
    await expect(
      f.scheduleService.startRun({
        userId: f.owner.id,
        runId: preCrashRow.id,
        trigger: 'replan',
        now: TICK_NOW,
      }),
    ).rejects.toMatchObject({ code: 'RUN_NOT_REPLANNABLE' });

    // Operator can safely resolve as 'mark_sent' without re-sending!
    const resolved = await f.scheduleService.resolveRunDelivery({
      userId: f.owner.id,
      runId: preCrashRow.id,
      resolution: 'mark_sent',
      now: TICK_NOW,
    });
    expect(resolved.run.state).toBe('digest_sent');
    expect(resolved.run.deliveryResolution).toBe('confirmed_sent');
    expect(provider.telegramSends).toHaveLength(1);
  });

  it('RST-03B: physical OS crash AFTER ScheduleRunner commits digest_sent preserves completed delivery receipt across restart with 0 duplicate sends', async () => {
    const f = await seedBoundGmailTelegramSchedule();
    const provider = await startSyntheticProviderServer();
    activeServers.push(provider);
    provider.heldCheckpoints.add('after_runner_commit');
    const commitHitWait = provider.waitForCheckpoint('after_runner_commit');

    const worker1 = spawnCrashWorker({
      databaseUrl: schemaDatabaseUrl,
      providerBaseUrl: provider.baseUrl,
      nowIso: TICK_NOW.toISOString(),
      mode: 'tick',
      holdStage: 'after_runner_commit',
      markerDir,
    });
    activeWorkers.push(worker1);

    const hit = await commitHitWait;
    expect(hit.pid).toBe(worker1.pid);
    expect(provider.telegramSends).toHaveLength(1);

    const exit1 = await worker1.hardKill();
    hit.release();
    expect(exit1.code).not.toBe(0);
    expect(existsSync(worker1.shutdownMarkerPath)).toBe(false);

    provider.heldCheckpoints.clear();
    const worker2 = spawnCrashWorker({
      databaseUrl: schemaDatabaseUrl,
      providerBaseUrl: provider.baseUrl,
      nowIso: TICK_NOW.toISOString(),
      mode: 'reconcile_and_tick',
      allowCleanExit: true,
      markerDir,
    });
    activeWorkers.push(worker2);

    const exit2 = await worker2.waitForExit();
    expect(exit2.code).toBe(0);
    expect(provider.telegramSends).toHaveLength(1);

    const runs = (
      await db.pool.query(
        'SELECT status, delivery_started_at, delivery FROM schedule_runs WHERE schedule_id = $1',
        [f.scheduleId],
      )
    ).rows;
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('digest_sent');
    expect(runs[0].delivery_started_at).not.toBeNull();
    expect(runs[0].delivery).toMatchObject({
      chatId: f.chatId,
      messageId: 951,
    });
  });

  it('RST-04: replaced Gmail credential after ambiguous crash blocks both retry_new_run resolution (REAUTHORIZATION_REQUIRED) and next-day scheduled tick across OS restart with 0 replacement-mailbox reads or Telegram sends', async () => {
    const f = await seedBoundGmailTelegramSchedule({ email: 'original-mailbox@gmail.test' });
    const provider = await startSyntheticProviderServer();
    activeServers.push(provider);
    provider.holdOnTelegramSend = true;

    const worker1 = spawnCrashWorker({
      databaseUrl: schemaDatabaseUrl,
      providerBaseUrl: provider.baseUrl,
      nowIso: TICK_NOW.toISOString(),
      mode: 'tick',
      markerDir,
    });
    activeWorkers.push(worker1);

    const sendHit = await provider.telegramSendEntered.promise;
    const exit1 = await worker1.hardKill();
    sendHit.release();
    expect(exit1.code).not.toBe(0);
    expect(existsSync(worker1.shutdownMarkerPath)).toBe(false);

    // Replace owner's Gmail connection with a brand-new mailbox/UUID while server is down!
    await f.gmailRepo.disconnect(f.owner.id);
    const replacementRefreshToken = `1//rt-replacement-${randomUUID()}`;
    const replacementCred = await f.credRepo.saveCredentials(
      'gmail',
      encryptCredentials(
        {
          oauthClientId: GMAIL_CLIENT_ID,
          refreshToken: replacementRefreshToken,
          email: 'replacement-mailbox@gmail.test',
          scopes: [GMAIL_MODIFY_SCOPE],
          connectedAt: new Date().toISOString(),
        },
        ENC_KEY,
      ),
      f.owner.id,
    );
    expect(replacementCred.id).not.toBe(f.gmailCredentialId);

    // Restart OS process #2 for startup reconciliation
    provider.holdOnTelegramSend = false;
    const worker2 = spawnCrashWorker({
      databaseUrl: schemaDatabaseUrl,
      providerBaseUrl: provider.baseUrl,
      nowIso: TICK_NOW.toISOString(),
      mode: 'reconcile_only',
      allowCleanExit: true,
      markerDir,
    });
    activeWorkers.push(worker2);
    expect((await worker2.waitForExit()).code).toBe(0);

    const ambiguousRun = (
      await db.pool.query('SELECT id, status FROM schedule_runs WHERE schedule_id = $1', [f.scheduleId])
    ).rows[0];
    expect(ambiguousRun.status).toBe('needs_attention');

    // Attempting manual retry_new_run with confirmDuplicateRisk: true MUST fail closed with REAUTHORIZATION_REQUIRED!
    await expect(
      f.scheduleService.resolveRunDelivery({
        userId: f.owner.id,
        runId: ambiguousRun.id,
        resolution: 'retry_new_run',
        confirmDuplicateRisk: true,
        now: TICK_NOW,
      }),
    ).rejects.toMatchObject({ code: 'REAUTHORIZATION_REQUIRED' });

    // Next-day scheduled tick in OS process #3 MUST also fail closed before reading replacement mailbox or sending!
    const readsBeforeDay2 = provider.gmailReads.length;
    const sendsBeforeDay2 = provider.telegramSends.length;
    const nextDayIso = new Date('2026-11-03T01:00:30.000Z').toISOString();
    const worker3 = spawnCrashWorker({
      databaseUrl: schemaDatabaseUrl,
      providerBaseUrl: provider.baseUrl,
      nowIso: nextDayIso,
      mode: 'tick',
      allowCleanExit: true,
      markerDir,
    });
    activeWorkers.push(worker3);
    expect((await worker3.waitForExit()).code).toBe(0);

    expect(provider.gmailReads.length).toBe(readsBeforeDay2);
    expect(provider.telegramSends.length).toBe(sendsBeforeDay2);
    expect(
      provider.oauthRefreshes.some((r) => r.refreshToken === replacementRefreshToken),
    ).toBe(false);

    const schedAfter = (
      await db.pool.query('SELECT status, pause_reason FROM schedules WHERE id = $1', [f.scheduleId])
    ).rows[0];
    expect(schedAfter.status).toBe('paused');
  });

  it('RST-06: cross-tenant crash & restart isolation keeps tenant A ambiguous needs_attention recovery completely isolated from tenant B active Gmail schedule and denies cross-tenant resolution', async () => {
    const tenantA = await seedBoundGmailTelegramSchedule({
      userName: 'TenantA',
      email: 'tenant-a@gmail.test',
      chatId: '777000111',
    });
    const tenantB = await seedBoundGmailTelegramSchedule({
      userName: 'TenantB',
      email: 'tenant-b@gmail.test',
      chatId: '777000222',
    });

    // Advance Tenant B's next_run_at by +1 hour so worker1 only dispatches Tenant A during the crash!
    await db.pool.query(
      "UPDATE schedules SET next_run_at = '2026-11-02T02:00:00.000Z' WHERE id = $1",
      [tenantB.scheduleId],
    );

    const provider = await startSyntheticProviderServer();
    activeServers.push(provider);
    provider.holdOnTelegramSend = true;

    const worker1 = spawnCrashWorker({
      databaseUrl: schemaDatabaseUrl,
      providerBaseUrl: provider.baseUrl,
      nowIso: TICK_NOW.toISOString(),
      mode: 'tick',
      markerDir,
    });
    activeWorkers.push(worker1);

    const sendHitA = await provider.telegramSendEntered.promise;
    expect(sendHitA.chatId).toBe(tenantA.chatId);
    const exit1 = await worker1.hardKill();
    sendHitA.release();
    expect(exit1.code).not.toBe(0);
    expect(existsSync(worker1.shutdownMarkerPath)).toBe(false);

    // Restart OS process #2 at 02:00:30Z: Tenant A reconciles to needs_attention (0 replay), while Tenant B runs cleanly!
    provider.holdOnTelegramSend = false;
    const worker2 = spawnCrashWorker({
      databaseUrl: schemaDatabaseUrl,
      providerBaseUrl: provider.baseUrl,
      nowIso: '2026-11-02T02:00:30.000Z',
      mode: 'reconcile_and_tick',
      allowCleanExit: true,
      markerDir,
    });
    activeWorkers.push(worker2);
    expect((await worker2.waitForExit()).code).toBe(0);

    const runA = (
      await db.pool.query('SELECT id, status, error FROM schedule_runs WHERE schedule_id = $1', [
        tenantA.scheduleId,
      ])
    ).rows[0];
    const runB = (
      await db.pool.query('SELECT id, status, delivery FROM schedule_runs WHERE schedule_id = $1', [
        tenantB.scheduleId,
      ])
    ).rows[0];
    expect(runA.status).toBe('needs_attention');
    expect(runA.error).toBe(TELEGRAM_DELIVERY_UNKNOWN);
    expect(runB.status).toBe('digest_sent');
    expect(runB.delivery).toMatchObject({ chatId: tenantB.chatId });

    // Tenant A got 1 pre-crash send (no replay); Tenant B got 1 clean send; zero cross-mailbox token or content mixing!
    expect(provider.telegramSends.filter((s) => s.chatId === tenantA.chatId)).toHaveLength(1);
    expect(provider.telegramSends.filter((s) => s.chatId === tenantB.chatId)).toHaveLength(1);
    expect(
      provider.gmailReads.every(
        (r) =>
          (r.userId === tenantA.owner.id && r.authHeader.includes(tenantA.refreshToken)) ||
          (r.userId === tenantB.owner.id && r.authHeader.includes(tenantB.refreshToken)),
      ),
    ).toBe(true);

    // Cross-tenant manual resolution by Tenant B against Tenant A's ambiguous run MUST fail closed!
    await expect(
      tenantB.scheduleService.resolveRunDelivery({
        userId: tenantB.owner.id,
        runId: runA.id,
        resolution: 'mark_sent',
        now: new Date('2026-11-02T02:01:00.000Z'),
      }),
    ).rejects.toThrow();
  });
});
