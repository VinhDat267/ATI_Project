import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import net from 'node:net';
import express from 'express';
import request from 'supertest';
import pg from 'pg';
import {
  encryptCredentials,
  GlobalRateLimiter,
  StepError,
  TelegramAdapter,
} from '@wap/tool-adapters';
import {
  GMAIL_MODIFY_SCOPE,
  type ScheduleResponse,
  type TelegramDigestConfig,
} from '@wap/tool-schemas';
import { createMigratedSchema } from '../../helpers/gmail-test-db.js';
import { CredentialRepo } from '../../../src/db/repositories/credential-repo.js';
import { GmailConnectionRepo } from '../../../src/db/repositories/gmail-connection-repo.js';
import { ConversationRepo } from '../../../src/db/repositories/conversation-repo.js';
import { MessageRepo } from '../../../src/db/repositories/message-repo.js';
import { WorkspaceRepo } from '../../../src/db/repositories/workspace-repo.js';
import { AdapterFactory, type AdapterContext } from '../../../src/services/adapter-factory.js';
import { GmailTokenManager } from '../../../src/services/gmail/token-manager.js';
import { GmailOAuthError } from '../../../src/services/gmail/oauth-client.js';
import { ChatService } from '../../../src/services/chat-service.js';
import {
  ScheduleConflict,
  ScheduleService,
} from '../../../src/services/schedules/schedule-service.js';
import {
  reconcileScheduleRuns,
  ScheduleRunner,
} from '../../../src/services/schedules/schedule-runner.js';
import { TelegramDigestRunner } from '../../../src/services/schedules/telegram-digest-runner.js';
import { computeTelegramDigestConfigHash } from '../../../src/services/schedules/telegram-digest-candidate.js';
import { createScheduleRoutes } from '../../../src/routes/schedule-routes.js';
import { certifyScheduleFixture } from '../../../src/services/slack/slack-schedule-origin.js';

const ENC_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const GMAIL_CLIENT_ID = 'gmail-g2-a1-client.apps.googleusercontent.com';
const TZ = 'Asia/Ho_Chi_Minh';
const PROPOSAL_NOW = new Date('2026-11-02T00:00:00.000Z'); // 07:00 VN -> due at 08:00 VN (01:00Z)
const TICK_NOW = new Date('2026-11-02T01:00:30.000Z'); // 08:00:30 VN

function createBarrier() {
  let release!: () => void;
  const reachedPromise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise: reachedPromise, release };
}

describe('GMAIL-G2 A1 — Bounded Gmail Source Binding & PostgreSQL Egress Authority Guards', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  const extraPools: pg.Pool[] = [];
  const activeRunners: ScheduleRunner[] = [];

  beforeAll(async () => {
    db = await createMigratedSchema('gmail_g2_a1');
  });

  beforeEach(async () => {
    await db.pool.query(
      'DELETE FROM schedule_runs; DELETE FROM schedules; DELETE FROM service_credentials;',
    );
  });

  afterEach(async () => {
    for (const r of activeRunners.splice(0)) {
      await r.stop();
    }
    for (const p of extraPools.splice(0)) {
      await p.end().catch(() => {});
    }
  });

  afterAll(async () => {
    await db?.close();
  });

  async function createSchemaPool(opts: { max?: number; applicationName?: string } = {}): Promise<pg.Pool> {
    const schema = (await db.pool.query<{ s: string }>('SELECT current_schema() AS s')).rows[0]!.s;
    const rawUrl = process.env.DATABASE_URL!;
    const url = new URL(rawUrl);
    url.searchParams.set('options', `-c search_path=${schema}`);
    const p = new pg.Pool({
      connectionString: url.href,
      max: opts.max ?? 4,
      application_name: opts.applicationName,
      connectionTimeoutMillis: 3_000,
    });
    extraPools.push(p);
    return p;
  }

  async function waitForPgLockWaiter(applicationName: string, timeoutMs = 4_000): Promise<void> {
    await vi.waitFor(
      async () => {
        const res = await db.pool.query<{ n: number }>(
          `SELECT count(DISTINCT a.pid)::int AS n
           FROM pg_locks l
           JOIN pg_stat_activity a ON a.pid = l.pid
           WHERE l.granted = false
             AND a.datname = current_database()
             AND a.application_name = $1`,
          [applicationName],
        );
        expect(res.rows[0]?.n).toBeGreaterThanOrEqual(1);
      },
      { timeout: timeoutMs, interval: 15 },
    );
  }

  async function seedTelegramPersonal(
    credRepo: CredentialRepo,
    userId: string,
    opts: { telegramUserId?: string; chatId?: string; chatTitle?: string; username?: string } = {},
  ) {
    const telegramUserId = opts.telegramUserId ?? '777111222';
    const chatId = opts.chatId ?? telegramUserId;
    const chatTitle = opts.chatTitle ?? 'Telegram của tôi';
    const username = opts.username ?? 'a1_owner';
    const row = await credRepo.saveCredentials(
      'telegram',
      encryptCredentials(
        {
          telegramUserId,
          username,
          displayName: 'A1 Owner',
          selectedChats: [
            {
              chatId,
              title: chatTitle,
              type: chatId.startsWith('-') ? 'supergroup' : 'private',
            },
          ],
        },
        ENC_KEY,
      ),
      userId,
    );
    return { row, telegramUserId, chatId, chatTitle, username };
  }

  async function seedGmailPersonal(
    credRepo: CredentialRepo,
    userId: string,
    opts: {
      email: string;
      oauthClientId?: string;
      scopes?: string[];
      refreshToken?: string;
    },
  ) {
    const refreshToken = opts.refreshToken ?? `1//rt-${randomUUID()}`;
    const row = await credRepo.saveCredentials(
      'gmail',
      encryptCredentials(
        {
          oauthClientId: opts.oauthClientId ?? GMAIL_CLIENT_ID,
          refreshToken,
          email: opts.email,
          scopes: opts.scopes ?? [GMAIL_MODIFY_SCOPE],
          connectedAt: new Date().toISOString(),
        },
        ENC_KEY,
      ),
      userId,
    );
    return { row, refreshToken };
  }

  async function proposeAndConfirmGmailDigest(input: {
    pool?: pg.Pool;
    userId: string;
    tg: Awaited<ReturnType<typeof seedTelegramPersonal>>;
    services?: string[];
    requestText?: string;
    workspaceMode?: 'personal' | 'organization';
    workspaceId?: string | null;
  }) {
    const targetPool = input.pool ?? db.pool;
    const convRepo = new ConversationRepo(targetPool);
    const msgRepo = new MessageRepo(targetPool);
    const scheduleService = new ScheduleService({
      pool: targetPool,
      timeZone: TZ,
      encryptionKey: ENC_KEY,
      gmailOAuthClientId: GMAIL_CLIENT_ID,
    } as any);
    const services = input.services ?? ['gmail', 'telegram'];
    const requestText =
      input.requestText ?? 'Tóm tắt email chưa đọc trong hộp thư đến gửi vào Telegram của tôi';

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
            request: requestText,
            recurrence: { type: 'daily', time: '08:00' },
            summary: 'Mỗi sáng 8h gửi bản tin Gmail vào Telegram',
          }) satisfies ScheduleResponse,
        routeSchedule: async () => ({ services, unavailable: [] }),
      },
      eventEmitter: { emit: (event, payload) => emitted.push({ event, payload }) },
      telegramConnection: async () => ({
        status: 'connected' as const,
        selectedChats: [
          {
            chatId: input.tg.chatId,
            title: input.tg.chatTitle,
            type: input.tg.chatId.startsWith('-') ? ('supergroup' as const) : ('private' as const),
          },
        ],
        connection: {
          credentialId: input.tg.row.id,
          telegramUserId: input.tg.telegramUserId,
          username: input.tg.username,
          chatIds: [input.tg.chatId],
        },
      }),
      githubConnection: services.includes('github')
        ? async () => ({
            status: 'connected' as const,
            connection: {
              credentialId: '00000000-0000-4000-8000-000000000077',
              githubUserId: '1001',
              login: 'a1gh',
              repos: ['acme/ati'],
            },
            teamRepos: [],
            memberRepos: [],
          })
        : undefined,
      schedules: {
        repo: scheduleService.repo,
        pool: targetPool,
        encryptionKey: ENC_KEY,
        gmailOAuthClientId: GMAIL_CLIENT_ID,
        timeZone: TZ,
        now: () => PROPOSAL_NOW,
      } as any,
    });

    const conv = await convRepo.createConversation(input.userId, 'Hội thoại lịch Gmail', {
      workspaceMode: input.workspaceMode ?? 'personal',
      workspaceId: input.workspaceId ?? null,
    });

    await chatService.handleUserMessage({
      conversationId: conv.id,
      userId: input.userId,
      content: requestText,
    });

    for (let i = 0; i < 100 && !emitted.some((e) => e.event === 'schedule_proposal' || e.event === 'error'); i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    const proposalEvent = emitted.find((e) => e.event === 'schedule_proposal');
    expect(proposalEvent).toBeDefined();

    const confirmed = await scheduleService.confirmProposal({
      userId: input.userId,
      convId: conv.id,
      messageId: proposalEvent!.payload.messageId,
      approvalMode: 'auto_digest',
      now: PROPOSAL_NOW,
      scope:
        input.workspaceMode === 'organization'
          ? { workspaceMode: 'organization', workspaceId: input.workspaceId ?? null }
          : undefined,
    });

    return { conv, proposalEvent: proposalEvent!, confirmed, scheduleService, chatService, emitted };
  }

  function createHarness(opts: {
    pool?: pg.Pool;
    credRepo?: CredentialRepo;
    onGmailRead?: (call: {
      accessToken: string;
      tool: string;
      args: Record<string, unknown>;
      signal?: AbortSignal;
    }) => Promise<unknown>;
    onGithubRead?: () => Promise<unknown>;
    onAiSummary?: (prompt: string, signal: AbortSignal) => Promise<string>;
    onTelegramSend?: (body: { chat_id: unknown; text: string }, signal?: AbortSignal | null) => Promise<void>;
    onOAuthRefresh?: (refreshToken: string, signal: AbortSignal) => Promise<{
      accessToken: string;
      expiresInSeconds: number;
      scopes: string[];
    }>;
    aiTimeoutMs?: number;
    sendTimeoutMs?: number;
    botClient?: {
      getChatMember: (chatId: string, userId: string, signal?: AbortSignal) => Promise<boolean>;
    };
  } = {}) {
    const targetPool = opts.pool ?? db.pool;
    const credRepo = opts.credRepo ?? new CredentialRepo(targetPool, ENC_KEY);
    const gmailCalls: Array<{
      userId: string;
      accessToken: string;
      tool: string;
      args: Record<string, unknown>;
      context?: AdapterContext;
    }> = [];
    const adapterContexts: Array<{ service: string; context?: AdapterContext }> = [];
    const aiCalls: string[] = [];
    const telegramWrites: Array<{ chat_id: unknown; text: string }> = [];
    let refreshCount = 0;

    const tokenManager = new GmailTokenManager({
      client: {
        refresh: async (refreshToken, signal) => {
          refreshCount += 1;
          if (opts.onOAuthRefresh) {
            return opts.onOAuthRefresh(refreshToken, signal);
          }
          return {
            accessToken: `ya29.tok-for-${refreshToken}`,
            expiresInSeconds: 3600,
            scopes: [GMAIL_MODIFY_SCOPE],
          };
        },
      },
      credentials: credRepo,
      clientId: GMAIL_CLIENT_ID,
      encryptionKey: ENC_KEY,
    });

    const fastLimiter = new GlobalRateLimiter({ maxRequests: 500, windowMs: 1000 });

    const baseFactory = new AdapterFactory({
      credentialRepo: credRepo,
      encryptionKey: ENC_KEY,
      gmailTokens: tokenManager,
      createGmailAdapter: ({ userId, tokens }) => ({
        execute: async (tool: string, args: Record<string, unknown>, execCtx?: { signal?: AbortSignal }) => {
          const accessToken = await tokens.getAccessToken({ signal: execCtx?.signal });
          const lastGmailCtx = [...adapterContexts].reverse().find((c) => c.service === 'gmail')?.context;
          gmailCalls.push({ userId, accessToken, tool, args, context: lastGmailCtx });
          if (opts.onGmailRead) {
            return opts.onGmailRead({ accessToken, tool, args, signal: execCtx?.signal });
          }
          return [
            {
              id: 'th-a-1',
              subject: 'Báo cáo tài chính Q4',
              from: 'CFO <cfo@example.test>',
              snippet: 'Số liệu nội bộ tài khoản gốc.',
              hasAttachment: false,
              attachmentNames: [],
            },
          ];
        },
      }),
      createTelegramAdapter: ({ telegramUserId, allowedChats, knownChats }) =>
        new TelegramAdapter({
          credentials: { botToken: '123456789:synthetic_a1_test_bot_token' },
          telegramUserId,
          allowedScope: { chats: allowedChats },
          knownChats,
          rateLimiter: fastLimiter,
          chatRateLimiter: fastLimiter,
          groupRateLimiter: fastLimiter,
          fetchFn: async (url, init) => {
            const method = String(url).split('/').at(-1);
            const parsed = init?.body ? JSON.parse(String(init.body)) : {};
            const numericChatId = Number(parsed.chat_id ?? allowedChats[0] ?? 777111222);
            const chatType = String(numericChatId).startsWith('-') ? 'supergroup' : 'private';
            if (method === 'getChat') {
              return Response.json({
                ok: true,
                result: {
                  id: numericChatId,
                  type: chatType,
                  ...(chatType === 'private' ? { first_name: 'Owner' } : { title: 'Nhóm Điều Hành' }),
                },
              });
            }
            if (method !== 'sendMessage') {
              throw new Error(`Unexpected Telegram Bot method: ${method}`);
            }
            init?.signal?.throwIfAborted();
            if (opts.onTelegramSend) {
              await opts.onTelegramSend(parsed, init?.signal);
            }
            init?.signal?.throwIfAborted();
            telegramWrites.push(parsed);
            return Response.json({
              ok: true,
              result: {
                message_id: 900 + telegramWrites.length,
                date: 1793581230,
                chat: { id: numericChatId, type: chatType },
              },
            });
          },
        }),
    });

    const adapterFactory = {
      getAdapterForService: async (serviceName: string, context?: AdapterContext) => {
        adapterContexts.push({ service: serviceName, context });
        if (serviceName === 'github') {
          return {
            execute: async () => {
              if (opts.onGithubRead) return opts.onGithubRead();
              return [{ number: 88, title: 'Healthy GitHub Issue', state: 'open' }];
            },
          };
        }
        return baseFactory.getAdapterForService(serviceName, context);
      },
      clearPersonal: (userId: string) => {
        tokenManager.clear(userId);
        baseFactory.clearPersonal(userId);
      },
    };

    const digestRunner = new TelegramDigestRunner({
      pool: targetPool,
      credentialRepo: credRepo,
      encryptionKey: ENC_KEY,
      gmailOAuthClientId: GMAIL_CLIENT_ID,
      adapterFactory: adapterFactory as any,
      botClient: opts.botClient ?? { getChatMember: async () => true },
      timeZone: TZ,
      aiTimeoutMs: opts.aiTimeoutMs ?? 5_000,
      ...(opts.sendTimeoutMs !== undefined ? { sendTimeoutMs: opts.sendTimeoutMs } : {}),
      summarizeWithAi: async (prompt: string, signal: AbortSignal) => {
        signal.throwIfAborted();
        aiCalls.push(prompt);
        if (opts.onAiSummary) {
          return opts.onAiSummary(prompt, signal);
        }
        return 'Tóm tắt AI: 1 email quan trọng từ CFO.';
      },
    } as any);

    const scheduleService = new ScheduleService({
      pool: targetPool,
      timeZone: TZ,
      encryptionKey: ENC_KEY,
      gmailOAuthClientId: GMAIL_CLIENT_ID,
    } as any);

    const scheduleRunner = new ScheduleRunner({
      pool: targetPool,
      timeZone: TZ,
      encryptionKey: ENC_KEY,
      gmailOAuthClientId: GMAIL_CLIENT_ID,
      now: () => TICK_NOW,
      planRun: async () => {
        throw new Error('Should not invoke manual planRun for telegram_digest');
      },
      executeDigestRun: (run: any, signal: AbortSignal) => digestRunner.execute(run, signal),
      recordState: (client: any, row: any, at: Date) => scheduleService.recordState(client, row, at),
    } as any);
    activeRunners.push(scheduleRunner);

    return {
      credRepo,
      tokenManager,
      adapterFactory,
      digestRunner,
      scheduleService,
      scheduleRunner,
      gmailCalls,
      adapterContexts,
      aiCalls,
      telegramWrites,
      getRefreshCount: () => refreshCount,
    };
  }

  describe('Helper contract: loadGmailDigestBinding & assertGmailDigestBinding', () => {
    it('A00-H1: loadGmailDigestBinding and assertGmailDigestBinding validate active owner personal tuple inside caller transaction client', async () => {
      const helperPath = '../../../src/services/schedules/' + 'gmail-digest-binding.js';
      const mod: any = await import(helperPath).catch(() => null);
      expect(mod, 'gmail-digest-binding.ts helper module must be implemented').not.toBeNull();
      expect(typeof mod.loadGmailDigestBinding).toBe('function');
      expect(typeof mod.assertGmailDigestBinding).toBe('function');

      const owner = await db.person('Helper Owner');
      const other = await db.person('Other User');
      const credRepo = new CredentialRepo(db.pool, ENC_KEY);
      const { row: credA } = await seedGmailPersonal(credRepo, owner.id, {
        email: '  Helper.User@Example.Test ',
      });

      const prevEnc = process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = ENC_KEY;
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        // Exact 3-arg contract using caller transaction client
        const loaded = await mod.loadGmailDigestBinding(client, owner.id, GMAIL_CLIENT_ID);
        expect(loaded).toEqual({
          kind: 'gmail',
          credentialId: credA.id,
          email: 'helper.user@example.test',
          oauthClientId: GMAIL_CLIENT_ID,
        });
        expect(Object.keys(loaded).sort()).toEqual(['credentialId', 'email', 'kind', 'oauthClientId']);

        const okAssert = await mod.assertGmailDigestBinding(client, owner.id, loaded, GMAIL_CLIENT_ID);
        expect(okAssert).toMatchObject({ allowed: true });

        // Wrong owner -> denied
        const wrongOwner = await mod.assertGmailDigestBinding(client, other.id, loaded, GMAIL_CLIENT_ID);
        expect(wrongOwner.allowed).toBe(false);

        // Wrong expected clientId -> denied
        const wrongClient = await mod.assertGmailDigestBinding(
          client,
          owner.id,
          loaded,
          'other-client.apps.googleusercontent.com',
        );
        expect(wrongClient.allowed).toBe(false);

        // Uncommitted DELETE inside caller transaction is immediately observed by both helpers
        await client.query('DELETE FROM service_credentials WHERE id = $1', [credA.id]);
        expect(await mod.loadGmailDigestBinding(client, owner.id, GMAIL_CLIENT_ID)).toBeNull();
        expect((await mod.assertGmailDigestBinding(client, owner.id, loaded, GMAIL_CLIENT_ID)).allowed).toBe(
          false,
        );
        await client.query('ROLLBACK');
      } finally {
        client.release();
        if (prevEnc === undefined) delete process.env.ENCRYPTION_KEY;
        else process.env.ENCRYPTION_KEY = prevEnc;
      }
    });
  });

  describe('A02: Source authority enforcement on runner tick (unchanged A, A->B swap, same-email new ID, refresh, scope/org/origin)', () => {
    it('A02-1: executes pinned Gmail Account A with phase="execution" and connections.gmail when Account A is unchanged, and allows normal access-token refresh on same credentialId', async () => {
      const owner = await db.person('Owner A02-1');
      const credRepo = new CredentialRepo(db.pool, ENC_KEY);
      const tg = await seedTelegramPersonal(credRepo, owner.id);
      const gmailA = await seedGmailPersonal(credRepo, owner.id, {
        email: 'alice@example.test',
        refreshToken: '1//rt-alice-same-id',
      });

      const { confirmed } = await proposeAndConfirmGmailDigest({ userId: owner.id, tg });
      const h = createHarness({ credRepo });

      await h.scheduleRunner.tick();

      expect(h.getRefreshCount()).toBe(1);
      expect(h.gmailCalls).toHaveLength(1);
      expect(h.gmailCalls[0]).toMatchObject({
        userId: owner.id,
        accessToken: 'ya29.tok-for-1//rt-alice-same-id',
        tool: 'gmail.search_threads',
        args: { query: 'in:inbox is:unread' },
        context: {
          userId: owner.id,
          phase: 'execution',
          connections: {
            gmail: {
              credentialId: gmailA.row.id,
              email: 'alice@example.test',
            },
          },
        },
      });
      expect(h.aiCalls).toHaveLength(1);
      expect(h.telegramWrites).toHaveLength(1);
      expect(h.telegramWrites[0]!.text).toContain('Báo cáo tài chính Q4');

      const runRow = (
        await db.pool.query('SELECT status, error FROM schedule_runs WHERE schedule_id = $1', [
          confirmed.schedule.id,
        ])
      ).rows[0];
      expect(runRow).toEqual({ status: 'digest_sent', error: null });
    });

    it('A02-2: blocks run, pauses schedule, and performs 0 Gmail reads, 0 AI calls, and 0 Telegram sends when Account A is replaced by Account B', async () => {
      const owner = await db.person('Owner A02-2');
      const credRepo = new CredentialRepo(db.pool, ENC_KEY);
      const tg = await seedTelegramPersonal(credRepo, owner.id);
      await seedGmailPersonal(credRepo, owner.id, {
        email: 'alice@example.test',
        refreshToken: '1//rt-alice-a',
      });

      const { confirmed } = await proposeAndConfirmGmailDigest({ userId: owner.id, tg });

      // Replace owner's personal Gmail connection with Account B
      await seedGmailPersonal(credRepo, owner.id, {
        email: 'bob@example.test',
        refreshToken: '1//rt-bob-b',
      });

      const h = createHarness({ credRepo });
      await h.scheduleRunner.tick();

      expect(h.gmailCalls).toHaveLength(0);
      expect(h.aiCalls).toHaveLength(0);
      expect(h.telegramWrites).toHaveLength(0);

      const runRow = (
        await db.pool.query('SELECT status, delivery FROM schedule_runs WHERE schedule_id = $1', [
          confirmed.schedule.id,
        ])
      ).rows[0];
      expect(runRow).toMatchObject({ status: 'blocked', delivery: null });

      const schedRow = (
        await db.pool.query('SELECT status FROM schedules WHERE id = $1', [confirmed.schedule.id])
      ).rows[0];
      expect(schedRow.status).toBe('paused');
    });

    it('A02-3: denies same email reconnected with a new credentialId until reconfirmed (0 reads, 0 AI, 0 Telegram)', async () => {
      const owner = await db.person('Owner A02-3');
      const credRepo = new CredentialRepo(db.pool, ENC_KEY);
      const tg = await seedTelegramPersonal(credRepo, owner.id);
      const firstA = await seedGmailPersonal(credRepo, owner.id, {
        email: 'alice@example.test',
        refreshToken: '1//rt-first',
      });

      const { confirmed } = await proposeAndConfirmGmailDigest({ userId: owner.id, tg });

      // Reconnect exact same email address -> new credential UUID
      const secondA = await seedGmailPersonal(credRepo, owner.id, {
        email: 'alice@example.test',
        refreshToken: '1//rt-second',
      });
      expect(secondA.row.id).not.toBe(firstA.row.id);

      const h = createHarness({ credRepo });
      await h.scheduleRunner.tick();

      expect(h.gmailCalls).toHaveLength(0);
      expect(h.aiCalls).toHaveLength(0);
      expect(h.telegramWrites).toHaveLength(0);
      expect(
        (await db.pool.query('SELECT status FROM schedule_runs WHERE schedule_id = $1', [confirmed.schedule.id]))
          .rows[0].status,
      ).toBe('blocked');
      expect(
        (await db.pool.query('SELECT status FROM schedules WHERE id = $1', [confirmed.schedule.id])).rows[0]
          .status,
      ).toBe('paused');
    });

    it('A02-4: denies revoked gmail.modify scope, wrong oauthClientId origin, revoked org workspace membership, and tampered slack_schedule_origins lineage', async () => {
      const credRepo = new CredentialRepo(db.pool, ENC_KEY);
      const wsRepo = new WorkspaceRepo(db.pool);

      // Subcase 1: Stored credential loses gmail.modify scope after approval
      const owner1 = await db.person('Scope Revoked Owner');
      const tg1 = await seedTelegramPersonal(credRepo, owner1.id);
      const gm1 = await seedGmailPersonal(credRepo, owner1.id, { email: 'scope1@example.test' });
      const s1 = await proposeAndConfirmGmailDigest({ userId: owner1.id, tg: tg1 });
      await db.pool.query('UPDATE service_credentials SET config = $2 WHERE id = $1', [
        gm1.row.id,
        encryptCredentials(
          {
            oauthClientId: GMAIL_CLIENT_ID,
            refreshToken: '1//rt-scope1',
            email: 'scope1@example.test',
            scopes: ['openid', 'email'],
          },
          ENC_KEY,
        ),
      ]);
      const h1 = createHarness({ credRepo });
      await h1.scheduleRunner.tick();
      expect(h1.gmailCalls).toHaveLength(0);
      expect(h1.aiCalls).toHaveLength(0);
      expect(h1.telegramWrites).toHaveLength(0);
      expect(
        (await db.pool.query('SELECT status FROM schedules WHERE id = $1', [s1.confirmed.schedule.id])).rows[0]
          .status,
      ).toBe('paused');

      // Subcase 2: Organization workspace member revoked after approval
      const orgAdmin = await db.person('Org Admin');
      const orgMember = await db.person('Org Member');
      const ws = await wsRepo.create(orgAdmin.id, 'A1 Org Workspace', false);
      await wsRepo.joinByInviteCode(orgMember.id, ws.inviteCode!);
      const tg2 = await seedTelegramPersonal(credRepo, orgMember.id, { telegramUserId: '777333444' });
      await seedGmailPersonal(credRepo, orgMember.id, { email: 'member@org.test' });
      const s2 = await proposeAndConfirmGmailDigest({
        userId: orgMember.id,
        tg: tg2,
        workspaceMode: 'organization',
        workspaceId: ws.id,
      });
      await db.pool.query(
        "UPDATE workspace_members SET status = 'disabled' WHERE workspace_id = $1 AND user_id = $2",
        [ws.id, orgMember.id],
      );
      const h2 = createHarness({ credRepo });
      await h2.scheduleRunner.tick();
      expect(h2.gmailCalls).toHaveLength(0);
      expect(h2.telegramWrites).toHaveLength(0);
      expect(
        (await db.pool.query('SELECT status FROM schedules WHERE id = $1', [s2.confirmed.schedule.id])).rows[0]
          .status,
      ).toBe('paused');

      // Subcase 3: Direct SQL tamper of schedules.request breaks slack_schedule_origins certificate (real baseline lineage API)
      const owner3 = await db.person('Lineage Owner');
      const tg3 = await seedTelegramPersonal(credRepo, owner3.id, { telegramUserId: '777555666' });
      await seedGmailPersonal(credRepo, owner3.id, { email: 'lineage@example.test' });
      const s3 = await proposeAndConfirmGmailDigest({ userId: owner3.id, tg: tg3 });
      await db.pool.query("UPDATE schedules SET request = 'Tampered SQL request' WHERE id = $1", [
        s3.confirmed.schedule.id,
      ]);
      const h3 = createHarness({ credRepo });
      await h3.scheduleRunner.tick();
      expect(h3.gmailCalls).toHaveLength(0);
      expect(h3.telegramWrites).toHaveLength(0);
      expect(
        (
          await db.pool.query('SELECT count(*)::int AS n FROM schedule_runs WHERE schedule_id = $1', [
            s3.confirmed.schedule.id,
          ])
        ).rows[0].n,
      ).toBe(0);
    });
  });

  describe('A03: Transactional confirmation re-resolution (409 DIGEST_PREVIEW_CHANGED) & legacy Gmail fail-closed', () => {
    it('A03-1: returns 409 DIGEST_PREVIEW_CHANGED and leaves persisted schedule unchanged when Gmail account changes between preview and confirm (create, update, and HTTP route)', async () => {
      const owner = await db.person('Owner A03-1');
      const credRepo = new CredentialRepo(db.pool, ENC_KEY);
      const convRepo = new ConversationRepo(db.pool);
      const msgRepo = new MessageRepo(db.pool);
      const tg = await seedTelegramPersonal(credRepo, owner.id);
      await seedGmailPersonal(credRepo, owner.id, { email: 'alice@example.test' });

      const scheduleService = new ScheduleService({
        pool: db.pool,
        timeZone: TZ,
        encryptionKey: ENC_KEY,
        gmailOAuthClientId: GMAIL_CLIENT_ID,
      } as any);

      let nextProposal: ScheduleResponse = {
        kind: 'schedule',
        action: 'create',
        name: 'Bản tin Gmail',
        request: 'Tóm tắt email chưa đọc gửi vào Telegram của tôi',
        recurrence: { type: 'daily', time: '08:00' },
        summary: 'Mỗi sáng 8h gửi bản tin Gmail',
      };
      const emitted: Array<{ event: string; payload: any }> = [];
      const chatService = new ChatService({
        msgRepo,
        convRepo,
        planner: {
          processMessage: async () => structuredClone(nextProposal),
          routeSchedule: async () => ({ services: ['gmail', 'telegram'], unavailable: [] }),
        },
        eventEmitter: { emit: (event, payload) => emitted.push({ event, payload }) },
        telegramConnection: async () => ({
          status: 'connected' as const,
          selectedChats: [{ chatId: tg.chatId, title: tg.chatTitle, type: 'private' as const }],
          connection: {
            credentialId: tg.row.id,
            telegramUserId: tg.telegramUserId,
            username: tg.username,
            chatIds: [tg.chatId],
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

      const waitProposal = async () => {
        for (let i = 0; i < 100 && !emitted.some((e) => e.event === 'schedule_proposal' || e.event === 'error'); i++) {
          await new Promise((r) => setTimeout(r, 10));
        }
        return emitted.find((e) => e.event === 'schedule_proposal')!;
      };

      // 1. Preview create with Account A, then swap to Account B before HTTP confirm -> 409 DIGEST_PREVIEW_CHANGED
      const conv1 = await convRepo.createConversation(owner.id);
      await chatService.handleUserMessage({
        conversationId: conv1.id,
        userId: owner.id,
        content: 'Mỗi sáng 8h gửi bản tin Gmail vào Telegram của tôi',
      });
      const createProp = await waitProposal();
      await seedGmailPersonal(credRepo, owner.id, { email: 'bob@example.test' });

      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        (req as any).user = { id: owner.id };
        next();
      });
      app.use(
        '/api',
        createScheduleRoutes({
          service: scheduleService,
          pool: db.pool,
          convRepo,
          clock: () => PROPOSAL_NOW,
        }),
      );

      const httpRes = await request(app)
        .post(`/api/conversations/${conv1.id}/schedule-proposals/${createProp.payload.messageId}/confirm`)
        .send({ approvalMode: 'auto_digest' });
      expect(httpRes.status).toBe(409);
      expect(httpRes.body.code).toBe('DIGEST_PREVIEW_CHANGED');
      expect(
        (await db.pool.query('SELECT count(*)::int AS n FROM schedules WHERE conv_id = $1', [conv1.id])).rows[0]
          .n,
      ).toBe(0);

      // 2. Confirm a valid schedule on Account B, then preview an update on Account B, reconnect same email (new ID) before confirm -> 409 and persisted row stays at version 1
      emitted.length = 0;
      const conv2 = await convRepo.createConversation(owner.id);
      await chatService.handleUserMessage({
        conversationId: conv2.id,
        userId: owner.id,
        content: 'Mỗi sáng 8h gửi bản tin Gmail vào Telegram của tôi',
      });
      const validProp = await waitProposal();
      const created = await scheduleService.confirmProposal({
        userId: owner.id,
        convId: conv2.id,
        messageId: validProp.payload.messageId,
        approvalMode: 'auto_digest',
        now: PROPOSAL_NOW,
      });
      const beforeRow = (
        await db.pool.query(
          'SELECT version, recurrence, digest_config, digest_config_hash FROM schedules WHERE id = $1',
          [created.schedule.id],
        )
      ).rows[0];

      emitted.length = 0;
      nextProposal = {
        kind: 'schedule',
        action: 'update',
        name: 'Bản tin Gmail 9h',
        request: 'Tóm tắt email chưa đọc gửi vào Telegram của tôi',
        recurrence: { type: 'daily', time: '09:00' },
        summary: 'Đổi sang 9h sáng',
      };
      await chatService.handleUserMessage({
        conversationId: conv2.id,
        userId: owner.id,
        content: 'Đổi sang 9h sáng',
      });
      const updateProp = await waitProposal();

      // Reconnect same email bob@example.test -> new credentialId before confirming update
      await seedGmailPersonal(credRepo, owner.id, { email: 'bob@example.test' });

      await expect(
        scheduleService.confirmProposal({
          userId: owner.id,
          convId: conv2.id,
          messageId: updateProp.payload.messageId,
          approvalMode: 'auto_digest',
          now: PROPOSAL_NOW,
        }),
      ).rejects.toMatchObject({ code: 'DIGEST_PREVIEW_CHANGED' });

      const afterRow = (
        await db.pool.query(
          'SELECT version, recurrence, digest_config, digest_config_hash FROM schedules WHERE id = $1',
          [created.schedule.id],
        )
      ).rows[0];
      expect(afterRow).toEqual(beforeRow);
    });

    it('A03-2: fails closed on legacy unbound Gmail schedule during tick and resume without auto-rebind/backfill, and blocks resume when pinned v1 Gmail account changed', async () => {
      const owner = await db.person('Owner A03-2');
      const credRepo = new CredentialRepo(db.pool, ENC_KEY);
      const msgRepo = new MessageRepo(db.pool);
      const tg = await seedTelegramPersonal(credRepo, owner.id);
      await seedGmailPersonal(credRepo, owner.id, { email: 'alice@example.test' });

      // Seed legacy Gmail telegram_digest (no sourceBindingVersion, no binding)
      const legacyConfig: TelegramDigestConfig = {
        credentialId: tg.row.id,
        telegramUserId: tg.telegramUserId,
        username: tg.username,
        chatId: tg.chatId,
        chatTitle: tg.chatTitle,
        sources: [
          {
            service: 'gmail',
            tool: 'gmail.search_threads',
            args: { query: 'in:inbox is:unread' },
            label: 'Email chưa đọc',
          },
        ],
        recurrence: { type: 'daily', time: '08:00' },
        timeZone: TZ,
      };
      const legacyHash = computeTelegramDigestConfigHash(legacyConfig);
      const convId = (
        await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [owner.id])
      ).rows[0].id as string;
      const legacySched = (
        await db.pool.query(
          `INSERT INTO schedules(user_id, conv_id, name, request, recurrence, services, status, next_run_at, kind, digest_config, digest_config_hash, digest_approved_at)
           VALUES ($1, $2, 'Legacy Gmail Digest', 'Tóm tắt Gmail cũ', $3, '{gmail,telegram}', 'active', '2026-11-02T01:00:00.000Z', 'telegram_digest', $4, $5, now())
           RETURNING *`,
          [owner.id, convId, JSON.stringify(legacyConfig.recurrence), JSON.stringify(legacyConfig), legacyHash],
        )
      ).rows[0];
      await certifyScheduleFixture(db.pool, legacySched.id);

      const h = createHarness({ credRepo });
      await h.scheduleRunner.tick();

      // Zero provider calls, run blocked, schedule paused, no auto-backfill of digest_config
      expect(h.gmailCalls).toHaveLength(0);
      expect(h.aiCalls).toHaveLength(0);
      expect(h.telegramWrites).toHaveLength(0);
      const legacyRun = (
        await db.pool.query('SELECT status FROM schedule_runs WHERE schedule_id = $1', [legacySched.id])
      ).rows[0];
      expect(legacyRun.status).toBe('blocked');
      const pausedLegacy = (
        await db.pool.query(
          'SELECT status, version, digest_config, digest_config_hash FROM schedules WHERE id = $1',
          [legacySched.id],
        )
      ).rows[0];
      expect(pausedLegacy.status).toBe('paused');
      expect(pausedLegacy.digest_config.sourceBindingVersion).toBeUndefined();
      expect(pausedLegacy.digest_config_hash).toBe(legacyHash);

      // List still displays paused legacy schedule cleanly
      const listed = await h.scheduleService.list(owner.id, TICK_NOW);
      expect(listed.some((s) => s.id === legacySched.id && s.status === 'paused')).toBe(true);

      // Resume via setStatus MUST reject with 409 REAUTHORIZATION_REQUIRED
      await expect(
        h.scheduleService.setStatus({
          userId: owner.id,
          scheduleId: legacySched.id,
          action: 'resume',
          version: pausedLegacy.version,
          now: TICK_NOW,
        }),
      ).rejects.toMatchObject({ code: 'REAUTHORIZATION_REQUIRED' });

      // Resume via confirmProposal(action: 'resume') MUST also reject with 409 REAUTHORIZATION_REQUIRED
      const resumeMsg = await msgRepo.createMessage(convId, 'assistant', 'Bật lại lịch', {
        type: 'schedule_proposal',
        proposal: { kind: 'schedule', action: 'resume', summary: 'Bật lại lịch' },
        scheduleId: legacySched.id,
        baseVersion: pausedLegacy.version,
        services: ['gmail', 'telegram'],
        nextRuns: ['2026-11-03T01:00:00.000Z'],
      } as any);
      await expect(
        h.scheduleService.confirmProposal({
          userId: owner.id,
          convId,
          messageId: resumeMsg.id,
          now: TICK_NOW,
        }),
      ).rejects.toMatchObject({ code: 'REAUTHORIZATION_REQUIRED' });

      // Also verify a paused v1 schedule cannot resume after A->B replacement
      await db.pool.query('DELETE FROM schedule_runs WHERE schedule_id = $1', [legacySched.id]);
      await db.pool.query('DELETE FROM schedules WHERE id = $1', [legacySched.id]);
      const v1 = await proposeAndConfirmGmailDigest({ userId: owner.id, tg });
      const pausedV1 = await h.scheduleService.setStatus({
        userId: owner.id,
        scheduleId: v1.confirmed.schedule.id,
        action: 'pause',
        version: v1.confirmed.schedule.version,
        now: PROPOSAL_NOW,
      });
      await seedGmailPersonal(credRepo, owner.id, { email: 'swapped@example.test' });
      await expect(
        h.scheduleService.setStatus({
          userId: owner.id,
          scheduleId: v1.confirmed.schedule.id,
          action: 'resume',
          version: pausedV1.schedule.version,
          now: TICK_NOW,
        }),
      ).rejects.toMatchObject({ code: 'REAUTHORIZATION_REQUIRED' });
    });
  });

  describe('A04: Real Two-Session PostgreSQL Concurrency, Barriers, NOWAIT Contention, pool.max=1 & AbortSignal', () => {
    it('A04-1: blocks before AI summary (0 AI calls, 0 Telegram sends) when Gmail is disconnected after source read', async () => {
      const owner = await db.person('Owner A04-1');
      const credRepo = new CredentialRepo(db.pool, ENC_KEY);
      const disconnectPool = await createSchemaPool({ applicationName: 'a04-1-disconnect' });
      const gmailRepo = new GmailConnectionRepo(disconnectPool);
      const tg = await seedTelegramPersonal(credRepo, owner.id);
      await seedGmailPersonal(credRepo, owner.id, { email: 'alice@example.test' });

      const { confirmed } = await proposeAndConfirmGmailDigest({ userId: owner.id, tg });

      const readReached = createBarrier();
      const releaseAfterDisconnect = createBarrier();

      const h = createHarness({
        credRepo,
        onGmailRead: async () => {
          const items = [
            {
              id: 'th-stale-a',
              subject: 'Mật: Hợp đồng M&A của A',
              from: 'Legal <legal@example.test>',
              snippet: 'Không được tóm tắt hay gửi đi sau khi ngắt kết nối.',
            },
          ];
          readReached.release();
          await releaseAfterDisconnect.promise;
          return items;
        },
      });

      const tickPromise = h.scheduleRunner.tick();
      try {
        await readReached.promise;

        const removed = await gmailRepo.disconnect(owner.id);
        expect(removed).not.toBeNull();
        releaseAfterDisconnect.release();

        await tickPromise;
      } finally {
        releaseAfterDisconnect.release();
        await tickPromise.catch(() => {});
      }

      expect(h.gmailCalls).toHaveLength(1);
      expect(h.aiCalls).toHaveLength(0);
      expect(h.telegramWrites).toHaveLength(0);
      const runRow = (
        await db.pool.query('SELECT status, delivery FROM schedule_runs WHERE schedule_id = $1', [
          confirmed.schedule.id,
        ])
      ).rows[0];
      expect(runRow).toMatchObject({ status: 'blocked', delivery: null });
      expect(
        (await db.pool.query('SELECT status FROM schedules WHERE id = $1', [confirmed.schedule.id])).rows[0]
          .status,
      ).toBe('paused');
    });

    it('A04-2: blocks before Telegram egress (0 Telegram sends) when Gmail is replaced/disconnected during or right after AI summary', async () => {
      const owner = await db.person('Owner A04-2');
      const credRepo = new CredentialRepo(db.pool, ENC_KEY);
      const disconnectPool = await createSchemaPool({ applicationName: 'a04-2-disconnect' });
      const gmailRepo = new GmailConnectionRepo(disconnectPool);
      const tg = await seedTelegramPersonal(credRepo, owner.id);
      await seedGmailPersonal(credRepo, owner.id, { email: 'alice@example.test' });

      const { confirmed } = await proposeAndConfirmGmailDigest({ userId: owner.id, tg });

      const aiFinished = createBarrier();
      const releaseToTelegramCheck = createBarrier();

      // Disconnect starts AFTER AI summary finishes and BEFORE Telegram egress begins:
      // we coordinate deterministically via getChatMember / post-AI hook by completing AI,
      // committing disconnect on Session 2 right after AI returns!
      // Wait: inside AI egress tx, FOR SHARE lock is held UNTIL summarizeWithAi returns and COMMITs.
      // So we signal right as summarizeWithAi returns, wait on pg_locks or execute disconnect right after AI tx commits?
      // Even cleaner: use two sources OR trigger disconnect right after AI returns via a deterministic post-AI barrier?
      // Look! If disconnect starts while summarizeWithAi is returning: disconnect blocks on FOR SHARE until AI tx COMMITs,
      // and if we await disconnect completion BEFORE Telegram egress starts? Wait: between AI tx COMMIT and Telegram tx BEGIN,
      // how do we deterministically pause without a sleep?
      // Easy! Configure a group Telegram chat (`-100999888777`) where `botClient.getChatMember` or `adapterFactory.getAdapterForService('telegram')`
      // is invoked right before the Telegram egress transaction!
      const groupTg = await seedTelegramPersonal(credRepo, owner.id, {
        telegramUserId: '777111222',
        chatId: '-100999888777',
        chatTitle: 'Nhóm Điều Hành',
      });
      await db.pool.query('DELETE FROM schedules WHERE id = $1', [confirmed.schedule.id]);
      const groupSched = await proposeAndConfirmGmailDigest({ userId: owner.id, tg: groupTg });

      const baseHarness = createHarness({ credRepo });
      const origGetAdapter = baseHarness.adapterFactory.getAdapterForService;
      baseHarness.adapterFactory.getAdapterForService = async (serviceName: string, ctx?: AdapterContext) => {
        if (serviceName === 'telegram') {
          const adapter = await origGetAdapter(serviceName, ctx);
          aiFinished.release();
          await releaseToTelegramCheck.promise;
          return adapter;
        }
        return origGetAdapter(serviceName, ctx);
      };

      const tickPromise = baseHarness.scheduleRunner.tick();
      try {
        await aiFinished.promise;

        expect(baseHarness.gmailCalls).toHaveLength(1);
        expect(baseHarness.aiCalls).toHaveLength(1);

        // Session 2 disconnects Gmail (and replaces with Account B) AFTER AI completed and BEFORE Telegram egress tx
        await gmailRepo.disconnect(owner.id);
        await seedGmailPersonal(credRepo, owner.id, { email: 'bob@example.test' });
        releaseToTelegramCheck.release();

        await tickPromise;
      } finally {
        releaseToTelegramCheck.release();
        await tickPromise.catch(() => {});
      }

      expect(baseHarness.telegramWrites).toHaveLength(0);
      const runRow = (
        await db.pool.query('SELECT status, delivery FROM schedule_runs WHERE schedule_id = $1', [
          groupSched.confirmed.schedule.id,
        ])
      ).rows[0];
      expect(runRow).toMatchObject({ status: 'blocked', delivery: null });
      expect(
        (
          await db.pool.query('SELECT status FROM schedules WHERE id = $1', [
            groupSched.confirmed.schedule.id,
          ])
        ).rows[0].status,
      ).toBe('paused');
    });

    it('A04-3: reverse barrier — PostgreSQL FOR SHARE blocks concurrent disconnect during SQL authority claim, then releases all PG locks BEFORE external Telegram HTTP while preserving committed delivery_started_at', async () => {
      // Subcase 1: While inside the bounded SQL authority/claim transaction (before COMMIT),
      // concurrent GmailConnectionRepo.disconnect blocks on PostgreSQL FOR SHARE until SQL claim commits.
      const owner1 = await db.person('Owner A04-3-SQL');
      const credRepo1 = new CredentialRepo(db.pool, ENC_KEY);
      const disconnectPool1 = await createSchemaPool({ applicationName: 'a04-3-gmail-disconnect-sql' });
      const gmailRepo1 = new GmailConnectionRepo(disconnectPool1);
      const tgGroup = await seedTelegramPersonal(credRepo1, owner1.id, { chatId: '-100777111222' });
      const gmail1 = await seedGmailPersonal(credRepo1, owner1.id, { email: 'alice-sql@example.test' });
      const sched1 = await proposeAndConfirmGmailDigest({ userId: owner1.id, tg: tgGroup });

      const claimEntered = createBarrier();
      const finishClaim = createBarrier();
      let sqlDisconnectSettled = false;
      let getChatMemberLockfreeVerified = false;

      const sqlBarrierPool = Object.create(db.pool) as pg.Pool;
      const origBarrierConnect = db.pool.connect.bind(db.pool);
      sqlBarrierPool.connect = ((...args: any[]) => {
        if (args.length > 0) {
          return (origBarrierConnect as any)(...args);
        }
        return (async () => {
          const rawClient: pg.PoolClient = await origBarrierConnect();
          const origQueryMethod = rawClient.query;
          const origQuery = origQueryMethod.bind(rawClient);
          const origRelease = rawClient.release.bind(rawClient);
          let sawDeliveryClaimUpdate = false;
          (rawClient as any).query = (...qArgs: any[]) => {
            if (
              typeof qArgs[0] !== 'string' ||
              typeof qArgs[qArgs.length - 1] === 'function'
            ) {
              return (origQuery as any)(...qArgs);
            }
            return (async () => {
              const sqlText = qArgs[0] as string;
              if (sqlText.includes('SET delivery_started_at = now()')) {
                sawDeliveryClaimUpdate = true;
              } else if (sawDeliveryClaimUpdate && sqlText.trim().toUpperCase() === 'COMMIT') {
                sawDeliveryClaimUpdate = false;
                claimEntered.release();
                await finishClaim.promise;
              }
              return (origQuery as any)(...qArgs);
            })();
          };
          (rawClient as any).release = (...rArgs: any[]) => {
            (rawClient as any).query = origQueryMethod;
            (rawClient as any).release = origRelease;
            return (origRelease as any)(...rArgs);
          };
          return rawClient;
        })();
      }) as any;

      const hSql = createHarness({
        pool: sqlBarrierPool,
        credRepo: credRepo1,
        botClient: {
          getChatMember: async () => {
            // Verify ZERO PostgreSQL row locks are held across external getChatMember network I/O!
            const checkClient = await db.pool.connect();
            try {
              await checkClient.query('BEGIN');
              await checkClient.query('SELECT id FROM schedules WHERE id = $1 FOR UPDATE NOWAIT', [
                sched1.confirmed.schedule.id,
              ]);
              await checkClient.query('ROLLBACK');
              getChatMemberLockfreeVerified = true;
            } finally {
              checkClient.release();
            }
            return true;
          },
        },
      });

      const tickSqlPromise = hSql.scheduleRunner.tick();
      let disconnectSqlPromise: Promise<any> | undefined;
      let removedSqlRow: any;
      try {
        await claimEntered.promise;
        disconnectSqlPromise = gmailRepo1.disconnect(owner1.id).then((removed) => {
          sqlDisconnectSettled = true;
          return removed;
        });

        await waitForPgLockWaiter('a04-3-gmail-disconnect-sql', 1_200);
        expect(sqlDisconnectSettled).toBe(false);
        expect(
          (await db.pool.query('SELECT id FROM service_credentials WHERE id = $1', [gmail1.row.id])).rowCount,
        ).toBe(1);

        finishClaim.release();
        [removedSqlRow] = await Promise.all([disconnectSqlPromise, tickSqlPromise]);
      } finally {
        finishClaim.release();
        await Promise.allSettled([disconnectSqlPromise ?? Promise.resolve(), tickSqlPromise]);
      }
      expect(getChatMemberLockfreeVerified).toBe(true);
      expect(removedSqlRow?.id).toBe(gmail1.row.id);
      expect(hSql.telegramWrites).toHaveLength(1);

      // Subcase 2: Once SQL claim COMMITs delivery_started_at and external Telegram HTTP is in flight,
      // ZERO PostgreSQL locks are held across network I/O (disconnect + FOR UPDATE NOWAIT succeed immediately).
      const owner2 = await db.person('Owner A04-3-HTTP');
      const credRepo2 = new CredentialRepo(db.pool, ENC_KEY);
      const disconnectPool2 = await createSchemaPool({ applicationName: 'a04-3-gmail-disconnect-http' });
      const gmailRepo2 = new GmailConnectionRepo(disconnectPool2);
      const tg2 = await seedTelegramPersonal(credRepo2, owner2.id);
      const gmail2 = await seedGmailPersonal(credRepo2, owner2.id, { email: 'alice-http@example.test' });
      const { confirmed } = await proposeAndConfirmGmailDigest({ userId: owner2.id, tg: tg2 });

      const sendEntered = createBarrier();
      const finishSend = createBarrier();
      const h = createHarness({
        credRepo: credRepo2,
        onTelegramSend: async () => {
          sendEntered.release();
          await finishSend.promise;
        },
      });

      const tickPromise = h.scheduleRunner.tick();
      try {
        await sendEntered.promise;

        // Verify durable delivery_started_at is committed AND schedule row lock is NOT held across HTTP!
        const probe = await db.pool.connect();
        try {
          await probe.query('BEGIN');
          const schedLock = await probe.query(
            'SELECT id FROM schedules WHERE id = $1 FOR UPDATE NOWAIT',
            [confirmed.schedule.id],
          );
          expect(schedLock.rowCount).toBe(1);
          const inFlightRun = (
            await probe.query(
              'SELECT status, delivery_started_at FROM schedule_runs WHERE schedule_id = $1',
              [confirmed.schedule.id],
            )
          ).rows[0];
          expect(inFlightRun.status).toBe('planning');
          expect(inFlightRun.delivery_started_at).not.toBeNull();
        } finally {
          await probe.query('ROLLBACK');
          probe.release();
        }

        // Concurrent disconnect succeeds immediately while external Telegram HTTP is still in flight!
        const removedRow = await gmailRepo2.disconnect(owner2.id);
        expect(removedRow?.id).toBe(gmail2.row.id);

        finishSend.release();
        await tickPromise;
      } finally {
        finishSend.release();
        await tickPromise.catch(() => undefined);
      }

      expect(h.telegramWrites).toHaveLength(1);
      expect(
        (await db.pool.query('SELECT status FROM schedule_runs WHERE schedule_id = $1', [confirmed.schedule.id]))
          .rows[0].status,
      ).toBe('digest_sent');
      expect(
        (await db.pool.query('SELECT id FROM service_credentials WHERE id = $1', [gmail2.row.id])).rowCount,
      ).toBe(0);

      // Subsequent run after disconnect blocks with 0 new reads & 0 new sends
      await db.pool.query(
        "UPDATE schedules SET next_run_at = '2026-11-02T01:00:15.000Z' WHERE id = $1",
        [confirmed.schedule.id],
      );
      await h.scheduleRunner.tick();
      expect(h.gmailCalls).toHaveLength(1);
      expect(h.telegramWrites).toHaveLength(1);
    });

    it('A04-4: NOWAIT lock contention against in-flight user/credential FOR UPDATE produces known-undispatched outcome with 0 external AI/Telegram calls', async () => {
      const owner = await db.person('Owner A04-4');
      const credRepo = new CredentialRepo(db.pool, ENC_KEY);
      const contenderPool = await createSchemaPool({ applicationName: 'a04-4-contender' });
      const tg = await seedTelegramPersonal(credRepo, owner.id);
      const gmailA = await seedGmailPersonal(credRepo, owner.id, { email: 'alice@example.test' });

      const { confirmed } = await proposeAndConfirmGmailDigest({ userId: owner.id, tg });

      // Subcase A: in-flight FOR UPDATE on pinned Gmail service_credentials row during full ScheduleRunner.tick()
      const readEntered = createBarrier();
      const releaseRead = createBarrier();
      const h = createHarness({
        credRepo,
        onGmailRead: async () => {
          readEntered.release();
          await releaseRead.promise;
          return [{ id: 'th-1', subject: 'Contention test', from: 'a@example.test', snippet: 'Body' }];
        },
      });

      const tickPromise = h.scheduleRunner.tick();
      try {
        await readEntered.promise;

        const contender = await contenderPool.connect();
        try {
          await contender.query('BEGIN');
          await contender.query('SELECT id FROM service_credentials WHERE id = $1 FOR UPDATE', [gmailA.row.id]);
          releaseRead.release();

          await tickPromise;
        } finally {
          releaseRead.release();
          await contender.query('ROLLBACK').catch(() => {});
          contender.release();
        }
      } finally {
        releaseRead.release();
        await tickPromise.catch(() => {});
      }

      expect(h.aiCalls).toHaveLength(0);
      expect(h.telegramWrites).toHaveLength(0);
      const runRow = (
        await db.pool.query(
          'SELECT status, delivery, delivery_started_at FROM schedule_runs WHERE schedule_id = $1',
          [confirmed.schedule.id],
        )
      ).rows[0];
      expect(runRow.delivery).toBeNull();
      expect(runRow.delivery_started_at).toBeNull();
      expect(['digest_failed', 'discarded']).toContain(runRow.status);

      // Subcase B: in-flight FOR UPDATE on owner users row (exact lock acquired first by GmailConnectionRepo) during digestRunner.execute()
      const runConv = (
        await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [owner.id])
      ).rows[0].id as string;
      const directRun = (
        await db.pool.query(
          `INSERT INTO schedule_runs(schedule_id, schedule_version, conv_id, trigger, due_at, status)
           VALUES ($1, $2, $3, 'manual', '2026-11-02T01:05:00.000Z', 'planning')
           RETURNING *`,
          [confirmed.schedule.id, confirmed.schedule.version, runConv],
        )
      ).rows[0];
      const schedDb = (
        await db.pool.query('SELECT digest_config, digest_config_hash FROM schedules WHERE id = $1', [
          confirmed.schedule.id,
        ])
      ).rows[0];

      const h2 = createHarness({ credRepo });
      const userContender = await contenderPool.connect();
      try {
        await userContender.query('BEGIN');
        await userContender.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [owner.id]);

        const directOutcome = await h2.digestRunner.execute(
          {
            runId: directRun.id,
            scheduleId: confirmed.schedule.id,
            scheduleVersion: confirmed.schedule.version,
            userId: owner.id,
            name: 'Bản tin Gmail sáng',
            request: 'Tóm tắt email chưa đọc gửi vào Telegram của tôi',
            trigger: 'manual',
            dueAt: new Date('2026-11-02T01:05:00.000Z'),
            digestConfig: schedDb.digest_config,
            digestConfigHash: schedDb.digest_config_hash,
          },
          new AbortController().signal,
        );
        expect(directOutcome.status).toBe('digest_failed');
        expect(h2.aiCalls).toHaveLength(0);
        expect(h2.telegramWrites).toHaveLength(0);
      } finally {
        await userContender.query('ROLLBACK').catch(() => {});
        userContender.release();
      }
    });

    it('A04-5: executes cleanly on a single-connection pool (max=1) with zero recursive pool queries inside transactions, proving canonical FOR SHARE/FOR UPDATE NOWAIT order and transaction-client guards', async () => {
      const owner = await db.person('Owner A04-5');
      const credRepoSetup = new CredentialRepo(db.pool, ENC_KEY);
      const tg = await seedTelegramPersonal(credRepoSetup, owner.id);
      await seedGmailPersonal(credRepoSetup, owner.id, { email: 'alice@example.test' });
      const { confirmed } = await proposeAndConfirmGmailDigest({ userId: owner.id, tg });

      // Insert a planning run row directly so we run TelegramDigestRunner.execute on a strict max:1 pool
      const runConv = (
        await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [owner.id])
      ).rows[0].id as string;
      const runRow = (
        await db.pool.query(
          `INSERT INTO schedule_runs(schedule_id, schedule_version, conv_id, trigger, due_at, status)
           VALUES ($1, $2, $3, 'scheduled', '2026-11-02T01:00:00.000Z', 'planning')
           RETURNING *`,
          [confirmed.schedule.id, confirmed.schedule.version, runConv],
        )
      ).rows[0];
      const schedDb = (
        await db.pool.query('SELECT digest_config, digest_config_hash FROM schedules WHERE id = $1', [
          confirmed.schedule.id,
        ])
      ).rows[0];

      const max1Pool = await createSchemaPool({ max: 1, applicationName: 'a04-5-max1' });
      const events: Array<{ channel: string; sql: string; inTx: boolean }> = [];
      let checkedOutClients = 0;
      let txCounter = 0;

      const observedPool = {
        query: (...args: unknown[]) => {
          const sql = typeof args[0] === 'string' ? args[0] : (args[0] as any)?.text ?? '';
          events.push({
            channel: 'pool.query',
            sql: String(sql).replace(/\s+/g, ' ').trim(),
            inTx: checkedOutClients > 0,
          });
          return (max1Pool.query as any).apply(max1Pool, args);
        },
        connect: async () => {
          const client = await max1Pool.connect();
          checkedOutClients += 1;
          const txId = ++txCounter;
          const origQuery = client.query.bind(client) as (...a: unknown[]) => Promise<any>;
          const origRelease = client.release.bind(client);
          let released = false;
          let localTx = false;
          return new Proxy(client, {
            get(t, prop) {
              if (prop === 'query') {
                return async (...args: unknown[]) => {
                  const sql = String(typeof args[0] === 'string' ? args[0] : (args[0] as any)?.text ?? '')
                    .replace(/\s+/g, ' ')
                    .trim();
                  if (/^BEGIN\b/i.test(sql)) {
                    localTx = true;
                  }
                  events.push({ channel: `client#${txId}.query`, sql, inTx: localTx });
                  try {
                    return await origQuery(...args);
                  } finally {
                    if (/^(COMMIT|ROLLBACK)\b/i.test(sql)) {
                      localTx = false;
                    }
                  }
                };
              }
              if (prop === 'release') {
                return (err?: boolean | Error) => {
                  if (!released) {
                    released = true;
                    localTx = false;
                    checkedOutClients = Math.max(0, checkedOutClients - 1);
                  }
                  return origRelease(err);
                };
              }
              const val = (t as any)[prop];
              return typeof val === 'function' ? val.bind(t) : val;
            },
          });
        },
      } as unknown as pg.Pool;

      const max1CredRepo = new CredentialRepo(observedPool, ENC_KEY);
      const h = createHarness({ pool: observedPool, credRepo: max1CredRepo });

      const outcome = await h.digestRunner.execute(
        {
          runId: runRow.id,
          scheduleId: confirmed.schedule.id,
          scheduleVersion: confirmed.schedule.version,
          userId: owner.id,
          name: 'Bản tin Gmail sáng',
          request: 'Tóm tắt email chưa đọc gửi vào Telegram của tôi',
          trigger: 'scheduled',
          dueAt: new Date('2026-11-02T01:00:00.000Z'),
          digestConfig: schedDb.digest_config,
          digestConfigHash: schedDb.digest_config_hash,
        },
        new AbortController().signal,
      );

      expect(outcome.status).toBe('digest_sent');
      expect(h.gmailCalls).toHaveLength(1);
      expect(h.aiCalls).toHaveLength(1);
      expect(h.telegramWrites).toHaveLength(1);

      // Zero pool.query calls occurred while any transaction was open on max:1 pool
      const recursivePoolCalls = events.filter((e) => e.channel === 'pool.query' && e.inTx);
      expect(recursivePoolCalls).toEqual([]);

      // Both pre-AI (client#1 or earlier tx) and pre-Telegram egress transactions acquired locks in canonical NOWAIT order
      const txIds = [...new Set(events.filter((e) => e.channel.startsWith('client#')).map((e) => e.channel))];
      expect(txIds.length).toBeGreaterThanOrEqual(2);
      for (const txChannel of txIds.slice(-2)) {
        const sqls = events.filter((e) => e.channel === txChannel).map((e) => e.sql);
        const userLockIdx = sqls.findIndex((s) => /FROM users\b.*FOR SHARE NOWAIT/i.test(s));
        const gmailCredLockIdx = sqls.findIndex((s) => /FROM service_credentials\b.*FOR SHARE NOWAIT/i.test(s));
        const convLockIdx = sqls.findIndex((s) => /FROM conversations\b.*FOR UPDATE.*NOWAIT/i.test(s));
        const schedLockIdx = sqls.findIndex((s) => /FROM schedules\b.*FOR UPDATE.*NOWAIT/i.test(s));
        const runLockIdx = sqls.findIndex((s) => /FROM schedule_runs\b.*FOR UPDATE.*NOWAIT/i.test(s));

        expect(userLockIdx, `${txChannel} must lock users FOR SHARE NOWAIT`).toBeGreaterThanOrEqual(0);
        expect(gmailCredLockIdx, `${txChannel} must lock gmail service_credentials FOR SHARE NOWAIT`).toBeGreaterThan(
          userLockIdx,
        );
        expect(convLockIdx, `${txChannel} must lock conversations FOR UPDATE NOWAIT`).toBeGreaterThan(
          gmailCredLockIdx,
        );
        expect(schedLockIdx, `${txChannel} must lock schedules FOR UPDATE NOWAIT`).toBeGreaterThanOrEqual(
          convLockIdx,
        );
        expect(runLockIdx, `${txChannel} must lock schedule_runs FOR UPDATE NOWAIT`).toBeGreaterThan(
          schedLockIdx,
        );
      }
    });

    it('A04-6: propagates real AbortSignal cancellation promptly during bounded call and releases all PostgreSQL locks cleanly', async () => {
      const owner = await db.person('Owner A04-6');
      const credRepo = new CredentialRepo(db.pool, ENC_KEY);
      const tg = await seedTelegramPersonal(credRepo, owner.id);
      const gmailA = await seedGmailPersonal(credRepo, owner.id, { email: 'alice@example.test' });
      const { confirmed } = await proposeAndConfirmGmailDigest({ userId: owner.id, tg });

      const runConv = (
        await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [owner.id])
      ).rows[0].id as string;
      const runRow = (
        await db.pool.query(
          `INSERT INTO schedule_runs(schedule_id, schedule_version, conv_id, trigger, due_at, status)
           VALUES ($1, $2, $3, 'scheduled', '2026-11-02T01:00:00.000Z', 'planning')
           RETURNING *`,
          [confirmed.schedule.id, confirmed.schedule.version, runConv],
        )
      ).rows[0];
      const schedDb = (
        await db.pool.query('SELECT digest_config, digest_config_hash FROM schedules WHERE id = $1', [
          confirmed.schedule.id,
        ])
      ).rows[0];

      const aiEntered = createBarrier();
      let observedSignalAborted = false;
      const controller = new AbortController();

      const h = createHarness({
        credRepo,
        onAiSummary: async (_prompt, sig) => {
          aiEntered.release();
          await new Promise<void>((_resolve, reject) => {
            sig.addEventListener(
              'abort',
              () => {
                observedSignalAborted = sig.aborted;
                reject(sig.reason ?? new Error('Aborted'));
              },
              { once: true },
            );
          });
          return 'unreachable';
        },
      });

      const execPromise = h.digestRunner.execute(
        {
          runId: runRow.id,
          scheduleId: confirmed.schedule.id,
          scheduleVersion: confirmed.schedule.version,
          userId: owner.id,
          name: 'Bản tin Gmail sáng',
          request: 'Tóm tắt email chưa đọc gửi vào Telegram của tôi',
          trigger: 'scheduled',
          dueAt: new Date('2026-11-02T01:00:00.000Z'),
          digestConfig: schedDb.digest_config,
          digestConfigHash: schedDb.digest_config_hash,
        },
        controller.signal,
      );

      try {
        await aiEntered.promise;

        // Pre-AI authority transaction has already verified binding and released all PG locks BEFORE external LLM HTTP!
        const probeClient = await db.pool.connect();
        try {
          await probeClient.query('BEGIN');
          const credLock = await probeClient.query(
            'SELECT id FROM service_credentials WHERE id = $1 FOR UPDATE NOWAIT',
            [gmailA.row.id],
          );
          expect(credLock.rowCount).toBe(1);
          const schedLock = await probeClient.query(
            'SELECT id FROM schedules WHERE id = $1 FOR UPDATE NOWAIT',
            [confirmed.schedule.id],
          );
          expect(schedLock.rowCount).toBe(1);
        } finally {
          await probeClient.query('ROLLBACK').catch(() => {});
          probeClient.release();
        }

        controller.abort(new Error('Caller cancelled run'));
        await expect(execPromise).rejects.toThrow();
      } finally {
        controller.abort(new Error('Cleanup abort'));
        await execPromise.catch(() => {});
      }
      expect(observedSignalAborted).toBe(true);
      expect(h.telegramWrites).toHaveLength(0);

      // Verify PostgreSQL locks on users & service_credentials were immediately released upon abort
      const checkClient = await db.pool.connect();
      try {
        await checkClient.query('BEGIN');
        await checkClient.query('SELECT id FROM users WHERE id = $1 FOR UPDATE NOWAIT', [owner.id]);
        await checkClient.query('SELECT id FROM service_credentials WHERE id = $1 FOR UPDATE NOWAIT', [
          gmailA.row.id,
        ]);
        await checkClient.query('ROLLBACK');
      } finally {
        checkClient.release();
      }
    });
  });

  describe('A05: Multi-source peer + Gmail AUTH_ERROR vs transient error semantics', () => {
    it('A05-1: blocks entire digest and pauses schedule with 0 AI calls and 0 Telegram sends when Gmail returns AUTH_ERROR (or invalid_grant) alongside a healthy GitHub peer', async () => {
      const owner = await db.person('Owner A05-1');
      const credRepo = new CredentialRepo(db.pool, ENC_KEY);
      const tg = await seedTelegramPersonal(credRepo, owner.id);
      await seedGmailPersonal(credRepo, owner.id, { email: 'alice@example.test' });

      const { confirmed } = await proposeAndConfirmGmailDigest({
        userId: owner.id,
        tg,
        services: ['github', 'gmail', 'telegram'],
        requestText: 'Tổng hợp issue GitHub đang mở và email chưa đọc gửi vào Telegram của tôi',
      });

      const h = createHarness({
        credRepo,
        onOAuthRefresh: async () => {
          throw new GmailOAuthError('invalid_grant', 400);
        },
      });

      await h.scheduleRunner.tick();

      expect(h.aiCalls).toHaveLength(0);
      expect(h.telegramWrites).toHaveLength(0);

      const runRow = (
        await db.pool.query('SELECT status, delivery FROM schedule_runs WHERE schedule_id = $1', [
          confirmed.schedule.id,
        ])
      ).rows[0];
      expect(runRow).toMatchObject({ status: 'blocked', delivery: null });
      expect(
        (await db.pool.query('SELECT status FROM schedules WHERE id = $1', [confirmed.schedule.id])).rows[0]
          .status,
      ).toBe('paused');
    });

    it('A05-2: preserves partial_error disclosure for transient Gmail NETWORK failure alongside healthy peer without rebinding, and marks single-source transient failure as digest_failed', async () => {
      const owner = await db.person('Owner A05-2');
      const credRepo = new CredentialRepo(db.pool, ENC_KEY);
      const tg = await seedTelegramPersonal(credRepo, owner.id);
      const gmailA = await seedGmailPersonal(credRepo, owner.id, { email: 'alice@example.test' });

      const multi = await proposeAndConfirmGmailDigest({
        userId: owner.id,
        tg,
        services: ['github', 'gmail', 'telegram'],
        requestText: 'Tổng hợp issue GitHub đang mở và email chưa đọc gửi vào Telegram của tôi',
      });

      const h = createHarness({
        credRepo,
        onGmailRead: async () => {
          throw new StepError({
            category: 'NETWORK',
            retryable: true,
            message: 'Temporary Gmail upstream timeout',
          });
        },
      });

      await h.scheduleRunner.tick();

      expect(h.telegramWrites).toHaveLength(1);
      expect(h.telegramWrites[0]!.text).toContain('Healthy GitHub Issue');
      expect(h.telegramWrites[0]!.text).toContain('Email chưa đọc');
      const multiRun = (
        await db.pool.query('SELECT status, delivery FROM schedule_runs WHERE schedule_id = $1', [
          multi.confirmed.schedule.id,
        ])
      ).rows[0];
      expect(multiRun.status).toBe('digest_sent');
      expect(multiRun.delivery.sources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ service: 'github', status: 'ok' }),
          expect.objectContaining({ service: 'gmail', status: 'partial_error' }),
        ]),
      );
      const multiSchedAfter = (
        await db.pool.query('SELECT status, digest_config FROM schedules WHERE id = $1', [
          multi.confirmed.schedule.id,
        ])
      ).rows[0];
      expect(multiSchedAfter.status).toBe('active');
      expect(
        multiSchedAfter.digest_config.sources.find((s: any) => s.service === 'gmail')?.binding?.credentialId,
      ).toBe(gmailA.row.id);

      // Single-source Gmail transient failure -> digest_failed, schedule stays active on first failure
      await db.pool.query('DELETE FROM schedule_runs WHERE schedule_id = $1', [multi.confirmed.schedule.id]);
      await db.pool.query('DELETE FROM schedules WHERE id = $1', [multi.confirmed.schedule.id]);
      const single = await proposeAndConfirmGmailDigest({ userId: owner.id, tg });
      h.telegramWrites.length = 0;
      await h.scheduleRunner.tick();
      expect(h.telegramWrites).toHaveLength(0);
      expect(
        (await db.pool.query('SELECT status FROM schedule_runs WHERE schedule_id = $1', [single.confirmed.schedule.id]))
          .rows[0].status,
      ).toBe('digest_failed');
      expect(
        (await db.pool.query('SELECT status FROM schedules WHERE id = $1', [single.confirmed.schedule.id])).rows[0]
          .status,
      ).toBe('active');
    });
  });

  describe('A06: Scheduler duplicate-tick claim, config edit race, restart stale content discard & residual delivery ambiguity', () => {
    it('A06-1: claims at most one scheduled occurrence and sends once when two ScheduleRunner instances tick concurrently', async () => {
      const owner = await db.person('Owner A06-1');
      const credRepo = new CredentialRepo(db.pool, ENC_KEY);
      const tg = await seedTelegramPersonal(credRepo, owner.id);
      await seedGmailPersonal(credRepo, owner.id, { email: 'alice@example.test' });
      const { confirmed } = await proposeAndConfirmGmailDigest({ userId: owner.id, tg });

      const pool2 = await createSchemaPool({ applicationName: 'a06-1-runner2' });
      const h1 = createHarness({ credRepo });
      const h2 = createHarness({ pool: pool2, credRepo: new CredentialRepo(pool2, ENC_KEY) });

      await Promise.all([h1.scheduleRunner.tick(), h2.scheduleRunner.tick()]);

      const runs = (
        await db.pool.query('SELECT * FROM schedule_runs WHERE schedule_id = $1', [confirmed.schedule.id])
      ).rows;
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe('digest_sent');
      expect(h1.gmailCalls.length + h2.gmailCalls.length).toBe(1);
      expect(h1.telegramWrites.length + h2.telegramWrites.length).toBe(1);
    });

    it('A06-2: discards run before AI summary and sends 0 Telegram messages when schedule version changes during Gmail read', async () => {
      const owner = await db.person('Owner A06-2');
      const credRepo = new CredentialRepo(db.pool, ENC_KEY);
      const tg = await seedTelegramPersonal(credRepo, owner.id);
      await seedGmailPersonal(credRepo, owner.id, { email: 'alice@example.test' });
      const { confirmed } = await proposeAndConfirmGmailDigest({ userId: owner.id, tg });

      const readEntered = createBarrier();
      const releaseRead = createBarrier();
      const h = createHarness({
        credRepo,
        onGmailRead: async () => {
          readEntered.release();
          await releaseRead.promise;
          return [{ id: 'th-v1', subject: 'Old version mail', from: 'a@example.test', snippet: 'Old' }];
        },
      });

      const tickPromise = h.scheduleRunner.tick();
      try {
        await readEntered.promise;
        await db.pool.query('UPDATE schedules SET version = version + 1 WHERE id = $1', [confirmed.schedule.id]);
        releaseRead.release();
        await tickPromise;
      } finally {
        releaseRead.release();
        await tickPromise.catch(() => {});
      }

      expect(h.gmailCalls).toHaveLength(1);
      expect(h.aiCalls).toHaveLength(0);
      expect(h.telegramWrites).toHaveLength(0);
      expect(
        (await db.pool.query('SELECT status FROM schedule_runs WHERE schedule_id = $1', [confirmed.schedule.id]))
          .rows[0].status,
      ).toBe('discarded');
    });

    it('A06-3: discards in-flight planning run on restart without persisting gathered Gmail content, revalidates source on replan after A->B swap, and never clears residual needs_attention delivery_started_at claims', async () => {
      const owner = await db.person('Owner A06-3');
      const credRepo = new CredentialRepo(db.pool, ENC_KEY);
      const tg = await seedTelegramPersonal(credRepo, owner.id);
      await seedGmailPersonal(credRepo, owner.id, { email: 'alice@example.test' });
      const { confirmed } = await proposeAndConfirmGmailDigest({ userId: owner.id, tg });

      // Simulate crash while planning run was mid-flight after reading Account A
      const crashConv = (
        await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [owner.id])
      ).rows[0].id as string;
      const inFlightRun = (
        await db.pool.query(
          `INSERT INTO schedule_runs(schedule_id, schedule_version, conv_id, trigger, due_at, status)
           VALUES ($1, $2, $3, 'scheduled', '2026-11-02T01:00:00.000Z', 'planning')
           RETURNING *`,
          [confirmed.schedule.id, confirmed.schedule.version, crashConv],
        )
      ).rows[0];

      // Startup reconciliation marks planning run without delivery_started_at as interrupted
      await reconcileScheduleRuns(db.pool);
      const reconciled = (
        await db.pool.query('SELECT status, delivery FROM schedule_runs WHERE id = $1', [inFlightRun.id])
      ).rows[0];
      expect(reconciled).toEqual({ status: 'interrupted', delivery: null });

      // Replace Account A with Account B while server was restarting, then trigger replan -> must block with 0 reads of B
      await seedGmailPersonal(credRepo, owner.id, { email: 'bob@example.test' });
      const h = createHarness({ credRepo });
      const replanned = await h.scheduleService.startRun({
        userId: owner.id,
        runId: inFlightRun.id,
        trigger: 'replan',
        now: TICK_NOW,
      });
      await h.scheduleRunner.planNow(replanned.id);

      expect(h.gmailCalls).toHaveLength(0);
      expect(h.aiCalls).toHaveLength(0);
      expect(h.telegramWrites).toHaveLength(0);
      expect(
        (await db.pool.query('SELECT status FROM schedule_runs WHERE id = $1', [replanned.id])).rows[0].status,
      ).toBe('blocked');
      expect(
        (await db.pool.query('SELECT status FROM schedules WHERE id = $1', [confirmed.schedule.id])).rows[0]
          .status,
      ).toBe('paused');

      // Residual ambiguous delivery safety: a run with delivery_started_at IS NOT NULL becomes needs_attention
      // on restart and reconnect/edit NEVER clears delivery_started_at or permits automatic replay.
      const ambiguousRun = (
        await db.pool.query(
          `INSERT INTO schedule_runs(schedule_id, schedule_version, conv_id, trigger, due_at, status, delivery_started_at)
           VALUES ($1, $2, $3, 'manual', '2026-11-02T02:00:00.000Z', 'planning', now())
           RETURNING id, delivery_started_at`,
          [confirmed.schedule.id, confirmed.schedule.version, crashConv],
        )
      ).rows[0];

      await reconcileScheduleRuns(db.pool);
      await seedGmailPersonal(credRepo, owner.id, { email: 'alice@example.test' });

      const afterReconnect = (
        await db.pool.query('SELECT status, delivery_started_at FROM schedule_runs WHERE id = $1', [
          ambiguousRun.id,
        ])
      ).rows[0];
      expect(afterReconnect.status).toBe('needs_attention');
      expect(afterReconnect.delivery_started_at).not.toBeNull();

      await expect(
        h.scheduleService.startRun({
          userId: owner.id,
          runId: ambiguousRun.id,
          trigger: 'replan',
          now: TICK_NOW,
        }),
      ).rejects.toMatchObject({ code: 'RUN_NOT_REPLANNABLE' });
    });
  });

  describe('A04-R: Codex A1 Review — Bounded Pool Checkout, Cleanup, Late Client Release & Bounded SQL Cancellation', () => {
    async function createRawMax1SchemaPool(applicationName: string): Promise<pg.Pool> {
      const schema = (await db.pool.query<{ s: string }>('SELECT current_schema() AS s')).rows[0]!.s;
      const rawUrl = process.env.DATABASE_URL!;
      const url = new URL(rawUrl);
      url.searchParams.set('options', `-c search_path=${schema}`);
      // Intentionally omit connectionTimeoutMillis to match real pg.Pool defaults and Codex's probe.
      const p = new pg.Pool({
        connectionString: url.href,
        max: 1,
        application_name: applicationName,
      });
      extraPools.push(p);
      return p;
    }

    async function assertNoLeakedPgState(applicationName: string) {
      const txRes = await db.pool.query<{ n: number }>(
        `SELECT count(*)::int AS n
           FROM pg_stat_activity
          WHERE datname = current_database()
            AND application_name = $1
            AND pid <> pg_backend_pid()
            AND state LIKE 'idle in transaction%'`,
        [applicationName],
      );
      expect(txRes.rows[0]?.n ?? 0).toBe(0);

      const lockRes = await db.pool.query<{ n: number }>(
        `SELECT count(*)::int AS n
           FROM pg_locks l
           JOIN pg_stat_activity a ON a.pid = l.pid
          WHERE a.datname = current_database()
            AND a.application_name = $1
            AND a.pid <> pg_backend_pid()
            AND l.locktype <> 'virtualxid'`,
        [applicationName],
      );
      expect(lockRes.rows[0]?.n ?? 0).toBe(0);
    }

    it('A04-R1: settles promptly on explicit parent abort and on local deadline when real PostgreSQL max=1 pool is starved, performs 0 AI/Telegram/action calls, and safely releases late-acquired clients', async () => {
      const owner = await db.person('Owner A04-R1');
      const credRepoSetup = new CredentialRepo(db.pool, ENC_KEY);
      const tg = await seedTelegramPersonal(credRepoSetup, owner.id);
      await seedGmailPersonal(credRepoSetup, owner.id, { email: 'alice@example.test' });
      const { confirmed } = await proposeAndConfirmGmailDigest({ userId: owner.id, tg });

      // Subcase A: Explicit parent abort on starved max=1 pool (direct withBoundedEgressAuthority probe)
      const starvedAbortPool = await createRawMax1SchemaPool('a04-r1-abort-max1');
      const hAbort = createHarness({
        pool: starvedAbortPool,
        credRepo: new CredentialRepo(starvedAbortPool, ENC_KEY),
      });
      const heldA = await starvedAbortPool.connect();
      const abortCtrl = new AbortController();
      let settledA = false;
      let errorA = null as Error | null;
      let actionCallsA = 0;

      const opA = (hAbort.digestRunner as any)
        .withBoundedEgressAuthority(
          {
            runId: randomUUID(),
            scheduleId: confirmed.schedule.id,
            scheduleVersion: confirmed.schedule.version,
            userId: owner.id,
            name: 'Bản tin Gmail sáng',
            request: 'Tóm tắt email chưa đọc gửi vào Telegram của tôi',
            trigger: 'scheduled',
            dueAt: TICK_NOW,
            digestConfig: confirmed.schedule.digest,
            digestConfigHash: 'unused-on-starved-checkout',
          },
          null,
          tg.chatId,
          { credentialId: tg.row.id, telegramUserId: tg.telegramUserId },
          abortCtrl.signal,
          20,
          async () => {
            actionCallsA += 1;
            return 'unexpected';
          },
        )
        .catch((err: Error) => {
          errorA = err;
        })
        .finally(() => {
          settledA = true;
        });

      let settledBeforeReleaseA = false;
      let errorMsgBeforeReleaseA: string | undefined;
      try {
        abortCtrl.abort(new Error('PARENT_STARVED_ABORT'));
        await new Promise((r) => setTimeout(r, 180));
        settledBeforeReleaseA = settledA;
        errorMsgBeforeReleaseA = errorA?.message;
      } finally {
        heldA.release();
        await opA;
      }

      await vi.waitFor(
        () => {
          expect(starvedAbortPool.waitingCount).toBe(0);
          expect(starvedAbortPool.idleCount).toBe(1);
        },
        { timeout: 500, interval: 10 },
      );

      expect(settledBeforeReleaseA).toBe(true);
      expect(errorMsgBeforeReleaseA).toBe('PARENT_STARVED_ABORT');
      expect(actionCallsA).toBe(0);
      expect(hAbort.aiCalls).toHaveLength(0);
      expect(hAbort.telegramWrites).toHaveLength(0);
      expect(starvedAbortPool.totalCount).toBe(1);
      await assertNoLeakedPgState('a04-r1-abort-max1');
      expect((await starvedAbortPool.query<{ ok: number }>('SELECT 1 AS ok')).rows[0]?.ok).toBe(1);

      // Subcase B: Local deadline expires without parent abort during real digestRunner.execute when max=1 pool is starved before AI egress
      const runConv = (
        await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [owner.id])
      ).rows[0].id as string;
      const runRow = (
        await db.pool.query(
          `INSERT INTO schedule_runs(schedule_id, schedule_version, conv_id, trigger, due_at, status)
           VALUES ($1, $2, $3, 'scheduled', '2026-11-02T01:00:00.000Z', 'planning')
           RETURNING *`,
          [confirmed.schedule.id, confirmed.schedule.version, runConv],
        )
      ).rows[0];
      const schedDb = (
        await db.pool.query('SELECT digest_config, digest_config_hash FROM schedules WHERE id = $1', [
          confirmed.schedule.id,
        ])
      ).rows[0];

      const starvedExecPool = await createRawMax1SchemaPool('a04-r1-deadline-max1');
      const poolHeldAfterRead = createBarrier();
      let heldDuringExec = null as pg.PoolClient | null;

      const hDeadline = createHarness({
        pool: starvedExecPool,
        credRepo: new CredentialRepo(starvedExecPool, ENC_KEY),
        aiTimeoutMs: 35,
        onGmailRead: async () => {
          // Hold the sole connection on max=1 pool right before execute() enters pre-AI withBoundedEgressAuthority
          heldDuringExec = await starvedExecPool.connect();
          poolHeldAfterRead.release();
          return [{ id: 'th-starve', subject: 'Starvation test', from: 'a@example.test', snippet: 'Body' }];
        },
      });

      let execSettled = false;
      let execOutcome: any = null;
      const execPromise = hDeadline.digestRunner
        .execute(
          {
            runId: runRow.id,
            scheduleId: confirmed.schedule.id,
            scheduleVersion: confirmed.schedule.version,
            userId: owner.id,
            name: 'Bản tin Gmail sáng',
            request: 'Tóm tắt email chưa đọc gửi vào Telegram của tôi',
            trigger: 'scheduled',
            dueAt: new Date('2026-11-02T01:00:00.000Z'),
            digestConfig: schedDb.digest_config,
            digestConfigHash: schedDb.digest_config_hash,
          },
          new AbortController().signal,
        )
        .then((out) => {
          execOutcome = out;
        })
        .finally(() => {
          execSettled = true;
        });

      let execSettledBeforeRelease = false;
      try {
        await poolHeldAfterRead.promise;
        await new Promise((r) => setTimeout(r, 200));
        execSettledBeforeRelease = execSettled;
      } finally {
        heldDuringExec?.release();
        await execPromise.catch(() => {});
      }

      await vi.waitFor(
        () => {
          expect(starvedExecPool.waitingCount).toBe(0);
          expect(starvedExecPool.idleCount).toBe(1);
        },
        { timeout: 500, interval: 10 },
      );

      expect(execSettledBeforeRelease).toBe(true);
      expect(execOutcome?.status).toBe('digest_failed');
      expect(hDeadline.aiCalls).toHaveLength(0);
      expect(hDeadline.telegramWrites).toHaveLength(0);
      expect(starvedExecPool.totalCount).toBe(1);
      await assertNoLeakedPgState('a04-r1-deadline-max1');
      expect((await starvedExecPool.query<{ ok: number }>('SELECT 1 AS ok')).rows[0]?.ok).toBe(1);
    });

    it('A04-R2: cleans up timers and abort listeners on injected checkout rejection and prevents post-deadline action while releasing late-acquired client exactly once', async () => {
      // Part 1: Injected async rejection and sync throw from pool.connect() clean up all listeners and timers
      for (const mode of ['async_reject', 'sync_throw'] as const) {
        const ctrl = new AbortController();
        const activeAbortListeners = new Set<unknown>();
        const origAdd = ctrl.signal.addEventListener.bind(ctrl.signal);
        const origRemove = ctrl.signal.removeEventListener.bind(ctrl.signal);
        vi.spyOn(ctrl.signal, 'addEventListener').mockImplementation(((
          type: string,
          listener: any,
          options?: any,
        ) => {
          if (type === 'abort' && listener) activeAbortListeners.add(listener);
          return origAdd(type, listener, options);
        }) as any);
        vi.spyOn(ctrl.signal, 'removeEventListener').mockImplementation(((
          type: string,
          listener: any,
          options?: any,
        ) => {
          if (type === 'abort' && listener) activeAbortListeners.delete(listener);
          return origRemove(type, listener, options);
        }) as any);

        const activeTimers = new Set<unknown>();
        const origSetTimeout = globalThis.setTimeout;
        const origClearTimeout = globalThis.clearTimeout;
        const setSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
          fn: TimerHandler,
          ms?: number,
          ...rest: any[]
        ) => {
          const handle = origSetTimeout(fn, ms, ...rest);
          activeTimers.add(handle);
          return handle;
        }) as any);
        const clearSpy = vi.spyOn(globalThis, 'clearTimeout').mockImplementation(((handle?: any) => {
          activeTimers.delete(handle);
          return origClearTimeout(handle);
        }) as any);

        const rejectingPool = {
          connect: () => {
            if (mode === 'sync_throw') {
              throw new Error('INJECTED_CHECKOUT_SYNC_THROW');
            }
            return Promise.reject(new Error('INJECTED_CHECKOUT_ASYNC_REJECT'));
          },
        } as unknown as pg.Pool;

        const runner = new TelegramDigestRunner({ pool: rejectingPool } as any);
        let actionCalls = 0;
        let leakedListeners = 0;
        let leakedTimers = 0;
        let caught: Error | null = null;

        try {
          await (runner as any).withBoundedEgressAuthority(
            { userId: '00000000-0000-4000-8000-000000000001' },
            null,
            '777111222',
            { credentialId: 'x', telegramUserId: '777111222' },
            ctrl.signal,
            60_000,
            async () => {
              actionCalls += 1;
              return true;
            },
          );
        } catch (err: any) {
          caught = err;
        } finally {
          leakedListeners = activeAbortListeners.size;
          leakedTimers = activeTimers.size;
          setSpy.mockRestore();
          clearSpy.mockRestore();
          for (const t of activeTimers) {
            origClearTimeout(t as any);
          }
        }

        expect(caught?.message).toBe(
          mode === 'sync_throw' ? 'INJECTED_CHECKOUT_SYNC_THROW' : 'INJECTED_CHECKOUT_ASYNC_REJECT',
        );
        expect(actionCalls).toBe(0);
        expect(leakedListeners, `Leaked abort listeners in ${mode}`).toBe(0);
        expect(leakedTimers, `Leaked timers in ${mode}`).toBe(0);
      }

      // Part 2: Late checkout resolving AFTER local 20ms deadline never runs SQL or action and releases client once
      const realBacking = await db.pool.connect();
      let backingReleased = false;
      let releaseCount = 0;
      const sqlLog: string[] = [];

      const delayedClient = new Proxy(realBacking, {
        get(t, prop) {
          if (prop === 'query') {
            return (...args: unknown[]) => {
              const sql = String(typeof args[0] === 'string' ? args[0] : (args[0] as any)?.text ?? '');
              sqlLog.push(sql);
              return (t.query as any).apply(t, args);
            };
          }
          if (prop === 'release') {
            return (err?: boolean | Error) => {
              releaseCount += 1;
              if (!backingReleased) {
                backingReleased = true;
                return t.release(err);
              }
            };
          }
          const val = (t as any)[prop];
          return typeof val === 'function' ? val.bind(t) : val;
        },
      });

      const delayedPool = {
        connect: () =>
          new Promise<pg.PoolClient>((resolve) => {
            setTimeout(() => resolve(delayedClient), 75);
          }),
      } as unknown as pg.Pool;

      const lateCtrl = new AbortController();
      const lateRunner = new TelegramDigestRunner({ pool: delayedPool } as any);
      let lateActionCalls = 0;
      const tStart = Date.now();
      let lateCaught: Error | null = null;

      try {
        await (lateRunner as any).withBoundedEgressAuthority(
          { userId: '00000000-0000-4000-8000-000000000001' },
          null,
          '777111222',
          { credentialId: 'x', telegramUserId: '777111222' },
          lateCtrl.signal,
          20,
          async () => {
            lateActionCalls += 1;
            return 'late-action';
          },
        );
      } catch (err: any) {
        lateCaught = err;
      } finally {
        const elapsedBeforeLateConnect = Date.now() - tStart;
        expect(elapsedBeforeLateConnect).toBeLessThan(70);
        // Let the 75ms connect() resolve so we verify late-client release
        await new Promise((r) => setTimeout(r, 80));
        if (!backingReleased) {
          backingReleased = true;
          realBacking.release();
        }
      }

      expect(lateCaught?.message).toMatch(/EGRESS_TIMEOUT/i);
      expect(releaseCount).toBe(1);
      expect(sqlLog).toEqual([]);
      expect(lateActionCalls).toBe(0);
    });

    it(
      'A04-R3: bounds in-transaction SQL waiting via local deadline and PostgreSQL cancellation without ever releasing a client before SQL settles or returning an in-transaction client to the pool',
      async () => {
        const orgAdmin = await db.person('Org Admin R3');
        const orgMember = await db.person('Org Member R3');
        const wsRepo = new WorkspaceRepo(db.pool);
        const credRepo = new CredentialRepo(db.pool, ENC_KEY);
        const ws = await wsRepo.create(orgAdmin.id, 'A04-R3 Org', false);
        await wsRepo.joinByInviteCode(orgMember.id, ws.inviteCode!);

        const tg = await seedTelegramPersonal(credRepo, orgMember.id, { telegramUserId: '777999111' });
        await seedGmailPersonal(credRepo, orgMember.id, { email: 'r3member@org.test' });
        const { confirmed } = await proposeAndConfirmGmailDigest({
          userId: orgMember.id,
          tg,
          workspaceMode: 'organization',
          workspaceId: ws.id,
        });

        const runConv = (
          await db.pool.query(
            "INSERT INTO conversations(user_id, workspace_mode, workspace_id) VALUES($1, 'organization', $2) RETURNING id",
            [orgMember.id, ws.id],
          )
        ).rows[0].id as string;
        const runRow = (
          await db.pool.query(
            `INSERT INTO schedule_runs(schedule_id, schedule_version, conv_id, trigger, due_at, status)
             VALUES ($1, $2, $3, 'scheduled', '2026-11-02T01:00:00.000Z', 'planning')
             RETURNING *`,
            [confirmed.schedule.id, confirmed.schedule.version, runConv],
          )
        ).rows[0];
        const schedDb = (
          await db.pool.query('SELECT digest_config, digest_config_hash FROM schedules WHERE id = $1', [
            confirmed.schedule.id,
          ])
        ).rows[0];
        const gmailBinding = schedDb.digest_config.sources.find((s: any) => s.service === 'gmail')?.binding ?? null;

        const rawRunnerPool = await createRawMax1SchemaPool('a04-r3-runner-max1');
        const violations: string[] = [];

        const safetyObservedPool = {
          query: (...args: unknown[]) => (rawRunnerPool.query as any).apply(rawRunnerPool, args),
          connect: async () => {
            const rawClient = await rawRunnerPool.connect();
            let inFlightQueries = 0;
            let txOpen = false;
            return new Proxy(rawClient, {
              get(t, prop) {
                if (prop === 'query') {
                  return async (...args: unknown[]) => {
                    const sql = String(typeof args[0] === 'string' ? args[0] : (args[0] as any)?.text ?? '')
                      .replace(/\s+/g, ' ')
                      .trim();
                    if (/^BEGIN\b/i.test(sql)) {
                      txOpen = true;
                    }
                    inFlightQueries += 1;
                    try {
                      const res = await (t.query as any).apply(t, args);
                      if (/^(COMMIT|ROLLBACK)\b/i.test(sql)) {
                        txOpen = false;
                      }
                      return res;
                    } finally {
                      inFlightQueries -= 1;
                    }
                  };
                }
                if (prop === 'release') {
                  return (err?: boolean | Error) => {
                    if (inFlightQueries > 0) {
                      violations.push(`Released client with ${inFlightQueries} unsettled SQL query`);
                    }
                    const txStatus = (t as any)._txStatus;
                    if (!err && (txOpen || (txStatus && txStatus !== 'I'))) {
                      violations.push(`Returned client to pool in dirty tx state (txOpen=${txOpen}, _txStatus=${txStatus})`);
                    }
                    return t.release(err);
                  };
                }
                const val = (t as any)[prop];
                return typeof val === 'function' ? val.bind(t) : val;
              },
            });
          },
        } as unknown as pg.Pool;

        const hR3 = createHarness({
          pool: safetyObservedPool,
          credRepo: new CredentialRepo(safetyObservedPool, ENC_KEY),
        });
        const blockerPool = await createSchemaPool({ max: 2, applicationName: 'a04-r3-blocker' });

        // Subcase A: Local deadline (80ms) bounds non-NOWAIT SQL lock wait inside withBoundedEgressAuthority
        let actionCallsSubA = 0;
        let elapsedSubA = 0;
        let errSubA: Error | null = null;
        const blockerA = await blockerPool.connect();
        try {
          await blockerA.query('BEGIN');
          await blockerA.query('LOCK TABLE workspace_members IN ACCESS EXCLUSIVE MODE');

          const t0 = Date.now();
          await (hR3.digestRunner as any)
            .withBoundedEgressAuthority(
              {
                runId: runRow.id,
                scheduleId: confirmed.schedule.id,
                scheduleVersion: confirmed.schedule.version,
                userId: orgMember.id,
                name: 'Bản tin Org',
                request: 'Tóm tắt email chưa đọc gửi vào Telegram của tôi',
                trigger: 'scheduled',
                dueAt: TICK_NOW,
                digestConfig: schedDb.digest_config,
                digestConfigHash: schedDb.digest_config_hash,
              },
              gmailBinding,
              tg.chatId,
              { credentialId: tg.row.id, telegramUserId: tg.telegramUserId },
              new AbortController().signal,
              80,
              async () => {
                actionCallsSubA += 1;
                return 'unexpected';
              },
            )
            .catch((e: Error) => {
              errSubA = e;
            });
          elapsedSubA = Date.now() - t0;
        } finally {
          await blockerA.query('ROLLBACK').catch(() => {});
          blockerA.release();
        }

        expect(errSubA).not.toBeNull();
        expect(elapsedSubA).toBeLessThan(800);
        expect(actionCallsSubA).toBe(0);
        expect(violations).toEqual([]);
        expect(rawRunnerPool.waitingCount).toBe(0);
        await assertNoLeakedPgState('a04-r3-runner-max1');
        expect((await rawRunnerPool.query<{ ok: number }>('SELECT 1 AS ok')).rows[0]?.ok).toBe(1);
        expect(rawRunnerPool.idleCount).toBe(1);

        // Subcase B: Explicit parent AbortSignal terminates actively waiting SQL session on max=1 pool, awaits SQL settle, and destroys/non-reuses client
        let actionCallsSubB = 0;
        let elapsedSubB = 0;
        let errSubB = null as Error | null;
        const abortSubB = new AbortController();
        const blockerB = await blockerPool.connect();
        try {
          await blockerB.query('BEGIN');
          await blockerB.query('LOCK TABLE workspace_members IN ACCESS EXCLUSIVE MODE');

          const pendingSqlPromise = (hR3.digestRunner as any)
            .withBoundedEgressAuthority(
              {
                runId: runRow.id,
                scheduleId: confirmed.schedule.id,
                scheduleVersion: confirmed.schedule.version,
                userId: orgMember.id,
                name: 'Bản tin Org',
                request: 'Tóm tắt email chưa đọc gửi vào Telegram của tôi',
                trigger: 'scheduled',
                dueAt: TICK_NOW,
                digestConfig: schedDb.digest_config,
                digestConfigHash: schedDb.digest_config_hash,
              },
              gmailBinding,
              tg.chatId,
              { credentialId: tg.row.id, telegramUserId: tg.telegramUserId },
              abortSubB.signal,
              10_000,
              async () => {
                actionCallsSubB += 1;
                return 'unexpected';
              },
            )
            .catch((e: Error) => {
              errSubB = e;
            });

          await waitForPgLockWaiter('a04-r3-runner-max1', 2_000);
          const tAbort = Date.now();
          abortSubB.abort(new Error('ABORT_DURING_SQL_LOCK_WAIT'));
          await pendingSqlPromise;
          elapsedSubB = Date.now() - tAbort;
        } finally {
          abortSubB.abort(new Error('Cleanup'));
          await blockerB.query('ROLLBACK').catch(() => {});
          blockerB.release();
        }

        expect(errSubB?.message).toBe('ABORT_DURING_SQL_LOCK_WAIT');
        expect(elapsedSubB).toBeLessThan(800);
        expect(actionCallsSubB).toBe(0);
        expect(violations).toEqual([]);
        expect(rawRunnerPool.waitingCount).toBe(0);
        expect(rawRunnerPool.idleCount).toBe(0);
        expect(rawRunnerPool.totalCount).toBe(0);
        await assertNoLeakedPgState('a04-r3-runner-max1');
        expect((await rawRunnerPool.query<{ ok: number }>('SELECT 1 AS ok')).rows[0]?.ok).toBe(1);
        expect(rawRunnerPool.idleCount).toBe(1);

        // Subcase C: If ROLLBACK itself fails, client.release(err) destroys the still-in-transaction client rather than returning it to idle pool
        const dirtyGuardRawPool = await createRawMax1SchemaPool('a04-r3-dirty-guard');
        let capturedReleaseErr: unknown = undefined;
        let injectedRollbackFault = false;

        const rollbackFaultPool = {
          query: (...args: unknown[]) => (dirtyGuardRawPool.query as any).apply(dirtyGuardRawPool, args),
          connect: async () => {
            const c = await dirtyGuardRawPool.connect();
            return new Proxy(c, {
              get(t, prop) {
                if (prop === 'query') {
                  return async (...args: unknown[]) => {
                    const sql = String(typeof args[0] === 'string' ? args[0] : (args[0] as any)?.text ?? '').trim();
                    if (/^ROLLBACK\b/i.test(sql) && !injectedRollbackFault) {
                      injectedRollbackFault = true;
                      // Leave real PostgreSQL backend open in transaction ('T') while failing ROLLBACK
                      throw new Error('INJECTED_ROLLBACK_FAILURE');
                    }
                    return (t.query as any).apply(t, args);
                  };
                }
                if (prop === 'release') {
                  return (err?: boolean | Error) => {
                    capturedReleaseErr = err;
                    return t.release(err);
                  };
                }
                const val = (t as any)[prop];
                return typeof val === 'function' ? val.bind(t) : val;
              },
            });
          },
        } as unknown as pg.Pool;

        const hDirty = createHarness({
          pool: rollbackFaultPool,
          credRepo: new CredentialRepo(rollbackFaultPool, ENC_KEY),
        });
        await expect(
          (hDirty.digestRunner as any).withBoundedEgressAuthority(
            {
              runId: runRow.id,
              scheduleId: confirmed.schedule.id,
              scheduleVersion: confirmed.schedule.version,
              userId: orgMember.id,
              name: 'Bản tin Org',
              request: 'Tóm tắt email chưa đọc gửi vào Telegram của tôi',
              trigger: 'scheduled',
              dueAt: TICK_NOW,
              digestConfig: schedDb.digest_config,
              digestConfigHash: schedDb.digest_config_hash,
            },
            gmailBinding,
            tg.chatId,
            { credentialId: tg.row.id, telegramUserId: tg.telegramUserId },
            new AbortController().signal,
            5_000,
            async () => {
              // Allocate a real XID inside the open transaction before failing so txid_current_if_assigned() would be non-null if pooled!
              throw new Error('ACTION_FAILURE_TRIGGERING_BROKEN_ROLLBACK');
            },
          ),
        ).rejects.toThrow('ACTION_FAILURE_TRIGGERING_BROKEN_ROLLBACK');

        expect(capturedReleaseErr).toBeTruthy();
        await vi.waitFor(
          async () => {
            const nextClient = await dirtyGuardRawPool.connect();
            try {
              expect((nextClient as any)._txStatus).toBe('I');
              const check = await nextClient.query<{ txid: string | null }>(
                'SELECT txid_current_if_assigned()::text AS txid',
              );
              expect(check.rows[0]?.txid).toBeNull();
            } finally {
              nextClient.release();
            }
          },
          { timeout: 1_000, interval: 20 },
        );
        await assertNoLeakedPgState('a04-r3-dirty-guard');
      },
      20_000,
    );

    it('A04-R4: isolates next pooled borrower from delayed CancelRequest races on SQL abort, destroys only the aborted session while preserving ordinary/NOWAIT reuse, and performs 0 outbound calls', async () => {
      const owner = await db.person('Owner A04-R4');
      const credRepoSetup = new CredentialRepo(db.pool, ENC_KEY);
      const tg = await seedTelegramPersonal(credRepoSetup, owner.id);
      const gmailA = await seedGmailPersonal(credRepoSetup, owner.id, { email: 'alice.r4@example.test' });
      const { confirmed } = await proposeAndConfirmGmailDigest({ userId: owner.id, tg });

      const runConv = (
        await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [owner.id])
      ).rows[0].id as string;
      const runRow = (
        await db.pool.query(
          `INSERT INTO schedule_runs(schedule_id, schedule_version, conv_id, trigger, due_at, status)
           VALUES ($1, $2, $3, 'scheduled', '2026-11-02T01:00:00.000Z', 'planning')
           RETURNING *`,
          [confirmed.schedule.id, confirmed.schedule.version, runConv],
        )
      ).rows[0];
      const schedDb = (
        await db.pool.query('SELECT digest_config, digest_config_hash FROM schedules WHERE id = $1', [
          confirmed.schedule.id,
        ])
      ).rows[0];
      const gmailBinding = schedDb.digest_config.sources.find((s: any) => s.service === 'gmail')?.binding ?? null;

      const rawMax1Pool = await createRawMax1SchemaPool('a04-r4-late-cancel-max1');
      const warm = await rawMax1Pool.connect();
      const initialBackendPid = (warm as any).processID as number;
      warm.release();
      expect(typeof initialBackendPid).toBe('number');

      const violations: string[] = [];
      let injectSleepOnConversations = false;
      let substitutedSleep = false;
      const abortCtrl = new AbortController();

      const observedPool = {
        query: (...args: unknown[]) => (rawMax1Pool.query as any).apply(rawMax1Pool, args),
        connect: async () => {
          const client = await rawMax1Pool.connect();
          let inFlightQueries = 0;
          let txOpen = false;
          return new Proxy(client, {
            get(t, prop) {
              if (prop === 'query') {
                return async (text: string, values?: unknown[]) => {
                  const normalized = String(text ?? '')
                    .replace(/\s+/g, ' ')
                    .trim();
                  if (/^BEGIN\b/i.test(normalized)) {
                    txOpen = true;
                  }
                  inFlightQueries += 1;
                  try {
                    if (
                      injectSleepOnConversations &&
                      !substitutedSleep &&
                      /SELECT id, user_id, workspace_id, workspace_mode FROM conversations/i.test(normalized)
                    ) {
                      substitutedSleep = true;
                      setTimeout(() => abortCtrl.abort(new Error('SYNTHETIC_REVIEW_ABORT')), 30);
                      return await t.query('SELECT pg_sleep(10)');
                    }
                    const res = values === undefined ? await t.query(text) : await t.query(text, values);
                    if (/^(COMMIT|ROLLBACK)\b/i.test(normalized)) {
                      txOpen = false;
                    }
                    return res;
                  } finally {
                    inFlightQueries -= 1;
                  }
                };
              }
              if (prop === 'release') {
                return (err?: boolean | Error) => {
                  if (inFlightQueries > 0) {
                    violations.push(`Released client with ${inFlightQueries} unsettled SQL query`);
                  }
                  const txStatus = (t as any)._txStatus;
                  if (!err && (txOpen || (txStatus && txStatus !== 'I'))) {
                    violations.push(
                      `Returned client to pool in dirty tx state (txOpen=${txOpen}, _txStatus=${txStatus})`,
                    );
                  }
                  return t.release(err);
                };
              }
              const val = (t as any)[prop];
              return typeof val === 'function' ? val.bind(t) : val;
            },
          });
        },
      } as unknown as pg.Pool;

      const h = createHarness({
        pool: observedPool,
        credRepo: new CredentialRepo(observedPool, ENC_KEY),
      });

      const runInput = {
        runId: runRow.id,
        scheduleId: confirmed.schedule.id,
        scheduleVersion: confirmed.schedule.version,
        userId: owner.id,
        name: 'Bản tin Gmail sáng',
        request: 'Tóm tắt email chưa đọc gửi vào Telegram của tôi',
        trigger: 'scheduled' as const,
        dueAt: TICK_NOW,
        digestConfig: schedDb.digest_config,
        digestConfigHash: schedDb.digest_config_hash,
      };

      // 1. Ordinary success & 55P03 NOWAIT contention MUST preserve pooled backend reuse
      let baselineActionCalls = 0;
      const okRes = await (h.digestRunner as any).withBoundedEgressAuthority(
        runInput,
        gmailBinding,
        tg.chatId,
        { credentialId: tg.row.id, telegramUserId: tg.telegramUserId },
        new AbortController().signal,
        2_000,
        async () => {
          baselineActionCalls += 1;
          return 'ok-reuse';
        },
      );
      expect(okRes).toEqual({ kind: 'ok', value: 'ok-reuse' });
      expect(baselineActionCalls).toBe(1);

      const contender = await db.pool.connect();
      try {
        await contender.query('BEGIN');
        await contender.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [owner.id]);
        const contentionRes = await (h.digestRunner as any).withBoundedEgressAuthority(
          runInput,
          gmailBinding,
          tg.chatId,
          { credentialId: tg.row.id, telegramUserId: tg.telegramUserId },
          new AbortController().signal,
          2_000,
          async () => {
            baselineActionCalls += 1;
            return 'unexpected';
          },
        );
        expect(contentionRes).toMatchObject({
          kind: 'outcome',
          outcome: { status: 'digest_failed', pauseSchedule: false },
        });
      } finally {
        await contender.query('ROLLBACK').catch(() => {});
        contender.release();
      }
      expect(baselineActionCalls).toBe(1);

      const checkReusedAfterNormal = await rawMax1Pool.connect();
      const pidBeforeAbortRace = (checkReusedAfterNormal as any).processID as number;
      checkReusedAfterNormal.release();
      expect(pidBeforeAbortRace).toBe(initialBackendPid);

      // 2. Active SQL abort with synthetic delayed CancelRequest transport (reproducing codex-a1-late-cancel.mts)
      // Note: users FOR SHARE NOWAIT and service_credentials FOR SHARE NOWAIT have BOTH succeeded in this tx
      // before conversations hits SELECT pg_sleep(10) and aborts at 30ms.
      injectSleepOnConversations = true;
      const realCreateConnection = net.createConnection;
      const delayedCancelSockets: EventEmitter[] = [];
      (net as any).createConnection = (options: any) => {
        const socket: any = new EventEmitter();
        socket.unref = () => socket;
        socket.end = (packet: Buffer) => {
          const actual = realCreateConnection(options);
          actual.once('connect', () => actual.end(packet));
          actual.on('error', () => {});
        };
        delayedCancelSockets.push(socket);
        return socket;
      };

      let abortActionCalls = 0;
      let originalError = '';
      const tAbortStart = Date.now();
      try {
        await (h.digestRunner as any).withBoundedEgressAuthority(
          runInput,
          gmailBinding,
          tg.chatId,
          { credentialId: tg.row.id, telegramUserId: tg.telegramUserId },
          abortCtrl.signal,
          1_000,
          async () => {
            abortActionCalls += 1;
            return true;
          },
        );
      } catch (err: any) {
        originalError = String(err?.message ?? '');
      } finally {
        net.createConnection = realCreateConnection;
      }
      const abortSettleElapsedMs = Date.now() - tAbortStart;

      const nextBorrower = await rawMax1Pool.connect();
      const nextBorrowerPid = (nextBorrower as any).processID as number;
      let nextUnrelatedQueryError: string | null = null;
      let nextQueryResult: number | null = null;
      try {
        const nextQuery = nextBorrower.query<{ answer: number }>('SELECT pg_sleep(0.35), 42 AS answer');
        setTimeout(() => {
          delayedCancelSockets.forEach((socket) => socket.emit('connect'));
        }, 25);
        const res = await nextQuery;
        nextQueryResult = res.rows[0]?.answer ?? null;
      } catch (err: any) {
        nextUnrelatedQueryError = `${err?.code ?? 'ERR'}:${err?.message ?? ''}`;
      } finally {
        nextBorrower.release();
      }

      expect({
        originalError,
        actionCalls: abortActionCalls,
        aiCalls: h.aiCalls.length,
        telegramWrites: h.telegramWrites.length,
        queuedCancelSockets: delayedCancelSockets.length,
        reusedSameBackend: nextBorrowerPid === pidBeforeAbortRace,
        nextUnrelatedQueryError,
        nextQueryResult,
      }).toEqual({
        originalError: 'SYNTHETIC_REVIEW_ABORT',
        actionCalls: 0,
        aiCalls: 0,
        telegramWrites: 0,
        queuedCancelSockets: 0,
        reusedSameBackend: false,
        nextUnrelatedQueryError: null,
        nextQueryResult: 42,
      });

      expect(abortSettleElapsedMs).toBeLessThan(450);
      expect(violations).toEqual([]);
      await assertNoLeakedPgState('a04-r4-late-cancel-max1');

      const oldBackendCheck = await db.pool.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid = $1',
        [pidBeforeAbortRace],
      );
      expect(oldBackendCheck.rows[0]?.n ?? 0).toBe(0);

      // Verify FOR SHARE locks on users and service_credentials from aborted session are completely released
      const lockProbe = await db.pool.connect();
      try {
        await lockProbe.query('BEGIN');
        await lockProbe.query('SELECT id FROM users WHERE id = $1 FOR UPDATE NOWAIT', [owner.id]);
        await lockProbe.query('SELECT id FROM service_credentials WHERE id = $1 FOR UPDATE NOWAIT', [gmailA.row.id]);
        await lockProbe.query('ROLLBACK');
      } finally {
        lockProbe.release();
      }
    });

    it('A04-R5: terminates active SQL session promptly on abort even when connectionParameters.ssl is enabled without crashing pool or process', async () => {
      const orgAdmin = await db.person('Org Admin R5');
      const orgMember = await db.person('Org Member R5');
      const wsRepo = new WorkspaceRepo(db.pool);
      const credRepo = new CredentialRepo(db.pool, ENC_KEY);
      const ws = await wsRepo.create(orgAdmin.id, 'A04-R5 SSL Org', false);
      await wsRepo.joinByInviteCode(orgMember.id, ws.inviteCode!);

      const tg = await seedTelegramPersonal(credRepo, orgMember.id, { telegramUserId: '777888222' });
      await seedGmailPersonal(credRepo, orgMember.id, { email: 'r5ssl@org.test' });
      const { confirmed } = await proposeAndConfirmGmailDigest({
        userId: orgMember.id,
        tg,
        workspaceMode: 'organization',
        workspaceId: ws.id,
      });

      const runConv = (
        await db.pool.query(
          "INSERT INTO conversations(user_id, workspace_mode, workspace_id) VALUES($1, 'organization', $2) RETURNING id",
          [orgMember.id, ws.id],
        )
      ).rows[0].id as string;
      const runRow = (
        await db.pool.query(
          `INSERT INTO schedule_runs(schedule_id, schedule_version, conv_id, trigger, due_at, status)
           VALUES ($1, $2, $3, 'scheduled', '2026-11-02T01:00:00.000Z', 'planning')
           RETURNING *`,
          [confirmed.schedule.id, confirmed.schedule.version, runConv],
        )
      ).rows[0];
      const schedDb = (
        await db.pool.query('SELECT digest_config, digest_config_hash FROM schedules WHERE id = $1', [
          confirmed.schedule.id,
        ])
      ).rows[0];
      const gmailBinding = schedDb.digest_config.sources.find((s: any) => s.service === 'gmail')?.binding ?? null;

      // Deliberately attach NO 'error' listener on rawSslMarkedPool so any unhandled pool error would fail the test
      const rawSslMarkedPool = await createRawMax1SchemaPool('a04-r5-ssl-max1');
      const sslMarkedPool = {
        query: (...args: unknown[]) => (rawSslMarkedPool.query as any).apply(rawSslMarkedPool, args),
        connect: async () => {
          const client = await rawSslMarkedPool.connect();
          // Simulate an SSL-negotiated pg.Client session (where wire CancelRequest bailed out on params.ssl)
          (client as any).ssl = { rejectUnauthorized: true };
          if ((client as any).connectionParameters) {
            (client as any).connectionParameters.ssl = { rejectUnauthorized: true };
          }
          return client;
        },
      } as unknown as pg.Pool;

      const hR5 = createHarness({
        pool: sslMarkedPool,
        credRepo: new CredentialRepo(sslMarkedPool, ENC_KEY),
      });
      const blockerPool = await createSchemaPool({ max: 2, applicationName: 'a04-r5-blocker' });
      const blocker = await blockerPool.connect();
      const abortCtrl = new AbortController();
      let actionCalls = 0;
      let caughtMessage = '';
      let elapsedAbortMs = 0;

      try {
        await blocker.query('BEGIN');
        await blocker.query('LOCK TABLE workspace_members IN ACCESS EXCLUSIVE MODE');

        const opPromise = (hR5.digestRunner as any)
          .withBoundedEgressAuthority(
            {
              runId: runRow.id,
              scheduleId: confirmed.schedule.id,
              scheduleVersion: confirmed.schedule.version,
              userId: orgMember.id,
              name: 'Bản tin SSL Org',
              request: 'Tóm tắt email chưa đọc gửi vào Telegram của tôi',
              trigger: 'scheduled',
              dueAt: TICK_NOW,
              digestConfig: schedDb.digest_config,
              digestConfigHash: schedDb.digest_config_hash,
            },
            gmailBinding,
            tg.chatId,
            { credentialId: tg.row.id, telegramUserId: tg.telegramUserId },
            abortCtrl.signal,
            1_500,
            async () => {
              actionCalls += 1;
              return 'unexpected';
            },
          )
          .catch((err: Error) => {
            caughtMessage = err.message;
          });

        await waitForPgLockWaiter('a04-r5-ssl-max1', 2_000);
        const t0 = Date.now();
        abortCtrl.abort(new Error('SSL_SESSION_SQL_ABORT'));
        await opPromise;
        elapsedAbortMs = Date.now() - t0;
      } finally {
        abortCtrl.abort(new Error('Cleanup'));
        await blocker.query('ROLLBACK').catch(() => {});
        blocker.release();
      }

      expect(caughtMessage).toBe('SSL_SESSION_SQL_ABORT');
      expect(elapsedAbortMs).toBeLessThan(400);
      expect(actionCalls).toBe(0);
      expect(hR5.aiCalls).toHaveLength(0);
      expect(hR5.telegramWrites).toHaveLength(0);
      expect(rawSslMarkedPool.idleCount).toBe(0);
      expect(rawSslMarkedPool.totalCount).toBe(0);
      await assertNoLeakedPgState('a04-r5-ssl-max1');
      expect((await rawSslMarkedPool.query<{ ok: number }>('SELECT 1 AS ok')).rows[0]?.ok).toBe(1);
    });

    async function createPgWireProxy() {
      const upstreamUrl = new URL(process.env.DATABASE_URL!);
      const upstreamHost = upstreamUrl.hostname || '127.0.0.1';
      const upstreamPort = Number(upstreamUrl.port || 5432);
      const clientSockets = new Set<net.Socket>();
      const upstreamSockets = new Set<net.Socket>();

      type WireRule = {
        sql: 'COMMIT' | 'ROLLBACK';
        mode: 'drop_before_server' | 'drop_server_ack';
        remainingHits: number;
        onIntercepted?: () => void;
      };
      let activeRule: WireRule | null = null;
      let interceptedCount = 0;

      const server = net.createServer((clientSocket) => {
        clientSockets.add(clientSocket);
        const upstreamSocket = net.createConnection({ host: upstreamHost, port: upstreamPort });
        upstreamSockets.add(upstreamSocket);

        let seenStartup = false;
        let clientBuf = Buffer.alloc(0);
        let blackholingServerReplies = false;
        let ackInterceptNotified = false;
        let currentRule: WireRule | null = null;

        clientSocket.on('data', (chunk: Buffer) => {
          clientBuf = Buffer.concat([clientBuf, chunk]);
          while (clientBuf.length > 0) {
            if (!seenStartup) {
              if (clientBuf.length < 8) break;
              const len = clientBuf.readInt32BE(0);
              if (clientBuf.length < len) break;
              const frame = clientBuf.subarray(0, len);
              clientBuf = clientBuf.subarray(len);
              const code = frame.readInt32BE(4);
              if (!(len === 8 && code === 80877103)) {
                seenStartup = true;
              }
              upstreamSocket.write(frame);
              continue;
            }
            if (clientBuf.length < 5) break;
            const msgType = clientBuf[0]!;
            const len = clientBuf.readInt32BE(1);
            const totalLen = 1 + len;
            if (clientBuf.length < totalLen) break;
            const frame = clientBuf.subarray(0, totalLen);
            clientBuf = clientBuf.subarray(totalLen);

            if (msgType === 0x51 && activeRule && activeRule.remainingHits > 0) {
              const sqlText = frame
                .subarray(5, totalLen - 1)
                .toString('utf8')
                .trim()
                .toUpperCase();
              if (sqlText === activeRule.sql) {
                activeRule.remainingHits -= 1;
                interceptedCount += 1;
                currentRule = activeRule;
                if (activeRule.mode === 'drop_before_server') {
                  activeRule.onIntercepted?.();
                  continue;
                }
                blackholingServerReplies = true;
                upstreamSocket.write(frame);
                continue;
              }
            }
            upstreamSocket.write(frame);
          }
        });

        upstreamSocket.on('data', (chunk: Buffer) => {
          if (blackholingServerReplies) {
            if (!ackInterceptNotified) {
              ackInterceptNotified = true;
              currentRule?.onIntercepted?.();
            }
            return;
          }
          clientSocket.write(chunk);
        });

        const cleanupPair = () => {
          clientSockets.delete(clientSocket);
          upstreamSockets.delete(upstreamSocket);
          if (!clientSocket.destroyed) clientSocket.destroy();
          if (!upstreamSocket.destroyed) upstreamSocket.destroy();
        };
        clientSocket.on('close', cleanupPair);
        clientSocket.on('error', cleanupPair);
        upstreamSocket.on('close', cleanupPair);
        upstreamSocket.on('error', cleanupPair);
      });

      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const port = (server.address() as net.AddressInfo).port;

      return {
        port,
        get interceptedCount() {
          return interceptedCount;
        },
        armRule(rule: {
          sql: 'COMMIT' | 'ROLLBACK';
          mode: 'drop_before_server' | 'drop_server_ack';
          hits?: number;
          onIntercepted?: () => void;
        }) {
          activeRule = {
            sql: rule.sql,
            mode: rule.mode,
            remainingHits: rule.hits ?? 1,
            onIntercepted: rule.onIntercepted,
          };
        },
        disarm() {
          activeRule = null;
        },
        destroyActiveSockets() {
          for (const s of [...clientSockets]) s.destroy();
          for (const s of [...upstreamSockets]) s.destroy();
        },
        async close() {
          activeRule = null;
          for (const s of [...clientSockets]) s.destroy();
          for (const s of [...upstreamSockets]) s.destroy();
          await new Promise<void>((resolve) => server.close(() => resolve()));
        },
      };
    }

    async function createObservedProxiedMax1Pool(applicationName: string, proxyPort: number) {
      const schema = (await db.pool.query<{ s: string }>('SELECT current_schema() AS s')).rows[0]!.s;
      const url = new URL(process.env.DATABASE_URL!);
      url.hostname = '127.0.0.1';
      url.port = String(proxyPort);
      url.searchParams.set('options', `-c search_path=${schema}`);
      const rawPool = new pg.Pool({
        connectionString: url.href,
        max: 1,
        application_name: applicationName,
        connectionTimeoutMillis: 3_000,
      });
      rawPool.on('error', () => {});
      extraPools.push(rawPool);

      let checkedOutClients = 0;
      let currentRawClient: pg.PoolClient | null = null;
      const releaseSnapshots: Array<{
        backendPid: number;
        inFlightAtRelease: number;
        activeQueryPresentAtRelease: boolean;
        releaseErrTruthy: boolean;
      }> = [];

      const observedPool = {
        query: (...args: unknown[]) => (rawPool.query as any).apply(rawPool, args),
        connect: async () => {
          const realClient = await rawPool.connect();
          checkedOutClients += 1;
          currentRawClient = realClient;
          let inFlight = 0;
          let released = false;
          const backendPid = ((realClient as any).processID as number) ?? -1;

          return new Proxy(realClient, {
            get(t, prop) {
              if (prop === 'query') {
                return (...args: unknown[]) => {
                  inFlight += 1;
                  const p = (t.query as any).apply(t, args);
                  return Promise.resolve(p).finally(() => {
                    inFlight -= 1;
                  });
                };
              }
              if (prop === 'release') {
                return (err?: boolean | Error) => {
                  if (!released) {
                    released = true;
                    checkedOutClients -= 1;
                    if (currentRawClient === realClient) currentRawClient = null;
                    releaseSnapshots.push({
                      backendPid,
                      inFlightAtRelease: inFlight,
                      activeQueryPresentAtRelease: Boolean((t as any)._getActiveQuery?.()),
                      releaseErrTruthy: Boolean(err),
                    });
                  }
                  return t.release(err);
                };
              }
              const val = (t as any)[prop];
              return typeof val === 'function' ? val.bind(t) : val;
            },
          });
        },
      } as unknown as pg.Pool;

      return {
        rawPool,
        observedPool,
        get checkedOutClients() {
          return checkedOutClients;
        },
        get currentActiveQuery() {
          return (currentRawClient as any)?._getActiveQuery?.() ?? null;
        },
        releaseSnapshots,
      };
    }

    it('A04-R6: terminates pending wire COMMIT via client.end() on parent abort and local deadline across all early denied/discarded branches with 0 outbound calls, non-reuse, healthy next borrower, and lock release', async () => {
      const owner = await db.person('Owner A04-R6');
      const credRepoSetup = new CredentialRepo(db.pool, ENC_KEY);
      const tgGroup = await seedTelegramPersonal(credRepoSetup, owner.id, {
        telegramUserId: '777888601',
        chatId: '-100601601601',
        chatTitle: 'Nhóm Kiểm Thử R6',
      });
      const gmail = await seedGmailPersonal(credRepoSetup, owner.id, { email: 'r6@example.test' });
      const { confirmed } = await proposeAndConfirmGmailDigest({ userId: owner.id, tg: tgGroup });

      const runConv = (
        await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [owner.id])
      ).rows[0].id as string;
      const runRow = (
        await db.pool.query(
          `INSERT INTO schedule_runs(schedule_id, schedule_version, conv_id, trigger, due_at, status)
           VALUES ($1, $2, $3, 'scheduled', '2026-11-02T01:00:00.000Z', 'planning')
           RETURNING *`,
          [confirmed.schedule.id, confirmed.schedule.version, runConv],
        )
      ).rows[0];
      const schedDb = (
        await db.pool.query('SELECT digest_config, digest_config_hash FROM schedules WHERE id = $1', [
          confirmed.schedule.id,
        ])
      ).rows[0];
      const gmailBinding = schedDb.digest_config.sources.find((s: any) => s.service === 'gmail')?.binding;

      const proxy = await createPgWireProxy();
      try {
        const obs = await createObservedProxiedMax1Pool('a04-r6-early-commit', proxy.port);

        // Subcase A: Explicit parent AbortSignal during stalled wire COMMIT on discarded branch (version mismatch)
        // with mode='drop_before_server' so real PostgreSQL locks on users/service_credentials/conversations/schedules/schedule_runs are held.
        const commitInterceptedA = createBarrier();
        proxy.armRule({
          sql: 'COMMIT',
          mode: 'drop_before_server',
          onIntercepted: () => commitInterceptedA.release(),
        });

        const hA = createHarness({
          pool: obs.observedPool,
          credRepo: new CredentialRepo(obs.observedPool, ENC_KEY),
        });
        const abortCtrlA = new AbortController();
        let actionCallsA = 0;
        let caughtA = '';

        const opA = (hA.digestRunner as any)
          .withBoundedEgressAuthority(
            {
              runId: runRow.id,
              scheduleId: confirmed.schedule.id,
              scheduleVersion: confirmed.schedule.version + 99,
              userId: owner.id,
              name: 'Bản tin R6',
              request: 'Tóm tắt email chưa đọc gửi vào nhóm',
              trigger: 'scheduled',
              dueAt: TICK_NOW,
              digestConfig: schedDb.digest_config,
              digestConfigHash: schedDb.digest_config_hash,
            },
            gmailBinding,
            tgGroup.chatId,
            { credentialId: tgGroup.row.id, telegramUserId: tgGroup.telegramUserId },
            abortCtrlA.signal,
            2_000,
            async () => {
              actionCallsA += 1;
              return 'unexpected';
            },
          )
          .catch((err: Error) => {
            caughtA = err.message;
          });

        let activeQueryWhileStalled = false;
        let settledBeforeSafetyDestroyA = false;
        let checkedOutWhileStalledA = -1;
        try {
          await commitInterceptedA.promise;
          activeQueryWhileStalled = Boolean(obs.currentActiveQuery);
          abortCtrlA.abort(new Error('EARLY_COMMIT_PARENT_ABORT'));
          settledBeforeSafetyDestroyA = await Promise.race([
            opA.then(() => true),
            new Promise<false>((r) => setTimeout(() => r(false), 350)),
          ]);
          checkedOutWhileStalledA = obs.checkedOutClients;
        } finally {
          proxy.disarm();
          if (!settledBeforeSafetyDestroyA) {
            proxy.destroyActiveSockets();
          }
          await opA;
        }

        const snapA = obs.releaseSnapshots.at(-1)!;
        const nextBorrowerA = await obs.rawPool.connect();
        const nextPidA = (nextBorrowerA as any).processID as number;
        const nextAnsA = (await nextBorrowerA.query<{ answer: number }>('SELECT 42 AS answer')).rows[0]?.answer;
        nextBorrowerA.release();

        expect({
          activeQueryWhileStalled,
          settledBeforeSafetyDestroyA,
          checkedOutWhileStalledA,
          caughtA,
          actionCallsA,
          aiCalls: hA.aiCalls.length,
          telegramWrites: hA.telegramWrites.length,
          inFlightAtRelease: snapA.inFlightAtRelease,
          activeQueryPresentAtRelease: snapA.activeQueryPresentAtRelease,
          releaseErrTruthy: snapA.releaseErrTruthy,
          reusedSameBackend: nextPidA === snapA.backendPid,
          nextAnsA,
        }).toEqual({
          activeQueryWhileStalled: true,
          settledBeforeSafetyDestroyA: true,
          checkedOutWhileStalledA: 0,
          caughtA: 'EARLY_COMMIT_PARENT_ABORT',
          actionCallsA: 0,
          aiCalls: 0,
          telegramWrites: 0,
          inFlightAtRelease: 0,
          activeQueryPresentAtRelease: false,
          releaseErrTruthy: true,
          reusedSameBackend: false,
          nextAnsA: 42,
        });

        await vi.waitFor(
          async () => {
            const lockProbe = await db.pool.connect();
            try {
              await lockProbe.query('BEGIN');
              await lockProbe.query('SELECT id FROM users WHERE id = $1 FOR UPDATE NOWAIT', [owner.id]);
              await lockProbe.query('SELECT id FROM service_credentials WHERE id = $1 FOR UPDATE NOWAIT', [
                gmail.row.id,
              ]);
              await lockProbe.query('SELECT id FROM schedules WHERE id = $1 FOR UPDATE NOWAIT', [
                confirmed.schedule.id,
              ]);
              await lockProbe.query('SELECT id FROM schedule_runs WHERE id = $1 FOR UPDATE NOWAIT', [runRow.id]);
              await lockProbe.query('ROLLBACK');
            } finally {
              lockProbe.release();
            }
          },
          { timeout: 1_500, interval: 15 },
        );

        // Subcase B: Local deadline expiry (90ms, parent not aborted) on lost server COMMIT ack ('drop_server_ack')
        // across all 4 remaining pure-SQL early-exit COMMIT branches (inactive_user, revoked_gmail, telegram_pin_mismatch, already_claimed_delivery),
        // plus verifying group_non_member blocks BEFORE PostgreSQL checkout (0 PG locks held across external getChatMember HTTP).
        const earlyBranches = [
          'inactive_user',
          'revoked_gmail',
          'telegram_pin_mismatch',
          'already_claimed_delivery',
        ] as const;

        for (const branch of earlyBranches) {
          if (branch === 'inactive_user') {
            await db.pool.query("UPDATE users SET status = 'disabled' WHERE id = $1", [owner.id]);
          } else if (branch === 'already_claimed_delivery') {
            await db.pool.query('UPDATE schedule_runs SET delivery_started_at = now() WHERE id = $1', [
              runRow.id,
            ]);
          }
          const ackDropped = createBarrier();
          proxy.armRule({
            sql: 'COMMIT',
            mode: 'drop_server_ack',
            onIntercepted: () => ackDropped.release(),
          });

          const hB = createHarness({
            pool: obs.observedPool,
            credRepo: new CredentialRepo(obs.observedPool, ENC_KEY),
            botClient: { getChatMember: async () => true },
          });
          let actionCallsB = 0;
          let caughtB = '';

          const opB = (hB.digestRunner as any)
            .withBoundedEgressAuthority(
              {
                runId: runRow.id,
                scheduleId: confirmed.schedule.id,
                scheduleVersion: confirmed.schedule.version,
                userId: owner.id,
                name: 'Bản tin R6',
                request: 'Tóm tắt email chưa đọc gửi vào nhóm',
                trigger: 'scheduled',
                dueAt: TICK_NOW,
                digestConfig: schedDb.digest_config,
                digestConfigHash: schedDb.digest_config_hash,
              },
              branch === 'revoked_gmail' ? { ...gmailBinding, credentialId: randomUUID() } : gmailBinding,
              branch === 'telegram_pin_mismatch' ? '-100999999999' : tgGroup.chatId,
              { credentialId: tgGroup.row.id, telegramUserId: tgGroup.telegramUserId },
              new AbortController().signal,
              90,
              async () => {
                actionCallsB += 1;
                return 'unexpected';
              },
              branch === 'already_claimed_delivery' ? { claimDelivery: true } : undefined,
            )
            .catch((err: Error) => {
              caughtB = err.message;
            });

          let settledB = false;
          try {
            await ackDropped.promise;
            settledB = await Promise.race([
              opB.then(() => true),
              new Promise<false>((r) => setTimeout(() => r(false), 380)),
            ]);
          } finally {
            proxy.disarm();
            if (branch === 'inactive_user') {
              await db.pool.query("UPDATE users SET status = 'active' WHERE id = $1", [owner.id]);
            } else if (branch === 'already_claimed_delivery') {
              await db.pool.query('UPDATE schedule_runs SET delivery_started_at = NULL WHERE id = $1', [
                runRow.id,
              ]);
            }
            if (!settledB) {
              proxy.destroyActiveSockets();
            }
            await opB;
          }

          const snapB = obs.releaseSnapshots.at(-1)!;
          const nextClientB = await obs.rawPool.connect();
          const nextPidB = (nextClientB as any).processID as number;
          const okValB = (await nextClientB.query<{ ok: number }>('SELECT 1 AS ok')).rows[0]?.ok;
          nextClientB.release();

          expect(
            {
              branch,
              settledB,
              caughtTimeout: /EGRESS_TIMEOUT/i.test(caughtB),
              actionCallsB,
              telegramWrites: hB.telegramWrites.length,
              inFlightAtRelease: snapB.inFlightAtRelease,
              activeQueryPresentAtRelease: snapB.activeQueryPresentAtRelease,
              releaseErrTruthy: snapB.releaseErrTruthy,
              reusedSameBackend: nextPidB === snapB.backendPid,
              okValB,
            },
            `Failed early COMMIT deadline branch: ${branch}`,
          ).toEqual({
            branch,
            settledB: true,
            caughtTimeout: true,
            actionCallsB: 0,
            telegramWrites: 0,
            inFlightAtRelease: 0,
            activeQueryPresentAtRelease: false,
            releaseErrTruthy: true,
            reusedSameBackend: false,
            okValB: 1,
          });
        }

        await assertNoLeakedPgState('a04-r6-early-commit');
      } finally {
        await proxy.close();
      }
    });

    async function awaitBarrierWithConcurrentSettlement(opts: {
      label: string;
      barrier: Promise<void>;
      concurrentOp: Promise<unknown>;
      maxWaitMs: number;
      describeState?: () => Promise<Record<string, unknown>> | Record<string, unknown>;
    }): Promise<void> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const outcome = await Promise.race([
        opts.barrier.then(() => ({ kind: 'barrier' as const })),
        opts.concurrentOp.then(
          (value) => ({ kind: 'settled_early' as const, value }),
          (err) => ({ kind: 'rejected_early' as const, error: String((err as Error)?.message ?? err) }),
        ),
        new Promise<{ kind: 'timeout' }>((resolve) => {
          timer = setTimeout(() => resolve({ kind: 'timeout' }), opts.maxWaitMs);
        }),
      ]).finally(() => {
        if (timer !== undefined) clearTimeout(timer);
      });

      if (outcome.kind === 'barrier') {
        return;
      }
      const diagnostics = opts.describeState ? await opts.describeState() : {};
      throw new Error(
        `[${opts.label}] Expected fault barrier was not reached (${outcome.kind}): ${JSON.stringify({
          ...outcome,
          ...diagnostics,
        })}`,
      );
    }

    it('A04-R7-A: handles pre-dispatch authority revocation and pre-AI deadline abort without awaiting an unreachable send event (0 unauthorized AI/send, no credential substitution, no invalid recovery) while preserving post-admission AI-timeout fallback', async () => {
      // 1. Pre-AI credential replacement after read aborts fail-closed before AI & outbound dispatch
      const ownerRevoked = await db.person('Owner A04-R7-A Revoked');
      const credRepoSetup = new CredentialRepo(db.pool, ENC_KEY);
      const tgRevoked = await seedTelegramPersonal(credRepoSetup, ownerRevoked.id, {
        telegramUserId: '777888711',
      });
      const gmailPinned = await seedGmailPersonal(credRepoSetup, ownerRevoked.id, {
        email: 'r7a-pinned@example.test',
      });
      const { confirmed: confirmedRevoked, scheduleService: svcRevoked } =
        await proposeAndConfirmGmailDigest({
          userId: ownerRevoked.id,
          tg: tgRevoked,
        });

      let replacementCredId = '';
      const hRevoked = createHarness({
        onGmailRead: async () => {
          const replaced = await seedGmailPersonal(credRepoSetup, ownerRevoked.id, {
            email: 'r7a-replacement@example.test',
          });
          replacementCredId = replaced.row.id;
          return [
            {
              id: 'th-r7a-1',
              subject: 'Báo cáo nội bộ',
              from: 'CFO <cfo@example.test>',
              snippet: 'Dữ liệu hộp thư gốc.',
              hasAttachment: false,
              attachmentNames: [],
            },
          ];
        },
      });

      await hRevoked.scheduleRunner.tick();

      const runRevoked = (
        await db.pool.query(
          'SELECT * FROM schedule_runs WHERE schedule_id = $1 ORDER BY created_at DESC LIMIT 1',
          [confirmedRevoked.schedule.id],
        )
      ).rows[0];
      const schedRevoked = (
        await db.pool.query('SELECT status, version, pause_reason FROM schedules WHERE id = $1', [
          confirmedRevoked.schedule.id,
        ])
      ).rows[0];

      expect(replacementCredId).not.toBe('');
      expect(replacementCredId).not.toBe(gmailPinned.row.id);
      expect(hRevoked.gmailCalls).toHaveLength(1);
      expect(hRevoked.gmailCalls[0]?.context?.connections?.gmail?.credentialId).toBe(gmailPinned.row.id);
      expect(hRevoked.aiCalls).toHaveLength(0);
      expect(hRevoked.telegramWrites).toHaveLength(0);
      expect(runRevoked.status).toBe('blocked');
      expect(runRevoked.delivery).toBeNull();
      expect(schedRevoked.status).toBe('paused');

      await expect(
        svcRevoked.setStatus({
          userId: ownerRevoked.id,
          scheduleId: confirmedRevoked.schedule.id,
          action: 'resume',
          version: schedRevoked.version,
          now: TICK_NOW,
        }),
      ).rejects.toMatchObject({ code: 'REAUTHORIZATION_REQUIRED' });

      await expect(
        svcRevoked.startRun({
          runId: runRevoked.id,
          trigger: 'replan',
          userId: ownerRevoked.id,
          now: TICK_NOW,
        }),
      ).rejects.toMatchObject({ code: 'RUN_NOT_REPLANNABLE' });

      await expect(
        svcRevoked.resolveRunDelivery({
          userId: ownerRevoked.id,
          runId: runRevoked.id,
          resolution: 'mark_sent',
          now: TICK_NOW,
        }),
      ).rejects.toMatchObject({ code: 'RUN_NOT_AWAITING_DELIVERY_RESOLUTION' });

      // 2. Pre-AI authority timeout before AI action settles as digest_failed (ai=0, sends=0) without hanging,
      // and a required send-barrier observer fails fast with diagnostic run state if invoked against an early settlement.
      const ownerFallback = await db.person('Owner A04-R7-A Fallback');
      const tgFallback = await seedTelegramPersonal(credRepoSetup, ownerFallback.id, {
        telegramUserId: '777888712',
      });
      await seedGmailPersonal(credRepoSetup, ownerFallback.id, {
        email: 'r7a-fallback@example.test',
      });
      const { confirmed: confirmedFallback, scheduleService: svcFallback } =
        await proposeAndConfirmGmailDigest({
          userId: ownerFallback.id,
          tg: tgFallback,
        });

      const starvedPreAiPool = await createRawMax1SchemaPool('a04-r7a-pre-ai-deadline');
      let heldPreAiClient: pg.PoolClient | null = null;
      const hPreAiAbort = createHarness({
        pool: starvedPreAiPool,
        credRepo: new CredentialRepo(starvedPreAiPool, ENC_KEY),
        aiTimeoutMs: 30,
        onGmailRead: async () => {
          heldPreAiClient = await starvedPreAiPool.connect();
          return [
            {
              id: 'th-r7a-2',
              subject: 'Báo cáo Q4',
              from: 'CFO <cfo@example.test>',
              snippet: 'Số liệu tài khoản hợp lệ.',
              hasAttachment: false,
              attachmentNames: [],
            },
          ];
        },
      });
      const runnerPreAiAbort = new ScheduleRunner({
        pool: db.pool,
        timeZone: TZ,
        encryptionKey: ENC_KEY,
        gmailOAuthClientId: GMAIL_CLIENT_ID,
        now: () => TICK_NOW,
        planRun: async () => {
          throw new Error('Should not invoke manual planRun for telegram_digest');
        },
        executeDigestRun: async (run: any, signal: AbortSignal) => {
          try {
            return await hPreAiAbort.digestRunner.execute(run, signal);
          } finally {
            heldPreAiClient?.release();
            heldPreAiClient = null;
          }
        },
        recordState: (client: any, row: any, at: Date) => svcFallback.recordState(client, row, at),
      } as any);
      activeRunners.push(runnerPreAiAbort);

      const unreachedSendBarrier = createBarrier();
      const preAiTickPromise = runnerPreAiAbort.tick();
      await expect(
        awaitBarrierWithConcurrentSettlement({
          label: 'A04-R7-A/missing-send-guard',
          barrier: unreachedSendBarrier.promise,
          concurrentOp: preAiTickPromise,
          maxWaitMs: 1_500,
          describeState: async () => {
            const latest = (
              await db.pool.query(
                'SELECT status, error, delivery FROM schedule_runs WHERE schedule_id = $1 ORDER BY created_at DESC LIMIT 1',
                [confirmedFallback.schedule.id],
              )
            ).rows[0];
            return {
              runStatus: latest?.status ?? null,
              runError: latest?.error ?? null,
              aiCalls: hPreAiAbort.aiCalls.length,
              telegramWrites: hPreAiAbort.telegramWrites.length,
            };
          },
        }),
      ).rejects.toThrow(/settled_early.*"runStatus":"digest_failed".*"aiCalls":0.*"telegramWrites":0/);
      await preAiTickPromise;

      const preAiRuns = (
        await db.pool.query('SELECT * FROM schedule_runs WHERE schedule_id = $1 ORDER BY created_at ASC', [
          confirmedFallback.schedule.id,
        ])
      ).rows;
      expect(preAiRuns).toHaveLength(1);
      expect(preAiRuns[0].status).toBe('digest_failed');
      expect(preAiRuns[0].delivery).toBeNull();
      expect(hPreAiAbort.aiCalls).toHaveLength(0);
      expect(hPreAiAbort.telegramWrites).toHaveLength(0);
      await assertNoLeakedPgState('a04-r7a-pre-ai-deadline');

      // 3. Post-admission optional AI summary timeout under valid authority falls back cleanly and sends once
      await db.pool.query('UPDATE schedules SET next_run_at = $2 WHERE id = $1', [
        confirmedFallback.schedule.id,
        new Date('2026-11-02T01:00:15.000Z'),
      ]);
      const hAiFallback = createHarness({
        aiTimeoutMs: 90,
        onAiSummary: async (_prompt, aiSig) => {
          await new Promise<void>((resolve) => {
            if (aiSig.aborted) {
              resolve();
              return;
            }
            aiSig.addEventListener('abort', () => resolve(), { once: true });
          });
          aiSig.throwIfAborted();
          return 'unreachable';
        },
      });
      await hAiFallback.scheduleRunner.tick();

      const fallbackRun = (
        await db.pool.query(
          'SELECT * FROM schedule_runs WHERE schedule_id = $1 ORDER BY created_at DESC LIMIT 1',
          [confirmedFallback.schedule.id],
        )
      ).rows[0];
      expect(hAiFallback.aiCalls).toHaveLength(1);
      expect(hAiFallback.telegramWrites).toHaveLength(1);
      expect(hAiFallback.telegramWrites[0]?.text).not.toContain('Điểm nổi bật');
      expect(fallbackRun.status).toBe('digest_sent');
      expect(fallbackRun.delivery).toMatchObject({
        chatId: tgFallback.chatId,
        messageId: 901,
      });
    });

    it('A04-R7-B: terminates pending post-action final COMMIT on parent abort and local deadline with action called once, zero resend, non-reuse, and safe receipt/recovery classification', async () => {
      const owner = await db.person('Owner A04-R7');
      const credRepoSetup = new CredentialRepo(db.pool, ENC_KEY);
      const tg = await seedTelegramPersonal(credRepoSetup, owner.id, { telegramUserId: '777888701' });
      const gmail = await seedGmailPersonal(credRepoSetup, owner.id, { email: 'r7@example.test' });
      const { confirmed, scheduleService } = await proposeAndConfirmGmailDigest({ userId: owner.id, tg });

      const schedDb = (
        await db.pool.query('SELECT digest_config, digest_config_hash FROM schedules WHERE id = $1', [
          confirmed.schedule.id,
        ])
      ).rows[0];
      const gmailBinding = schedDb.digest_config.sources.find((s: any) => s.service === 'gmail')?.binding;

      const proxy = await createPgWireProxy();
      try {
        const obs = await createObservedProxiedMax1Pool('a04-r7-final-commit', proxy.port);

        // Subcase A: Direct withBoundedEgressAuthority parent abort during stalled final COMMIT after action resolves once
        const runConvA = (
          await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [owner.id])
        ).rows[0].id as string;
        const runRowA = (
          await db.pool.query(
            `INSERT INTO schedule_runs(schedule_id, schedule_version, conv_id, trigger, due_at, status)
             VALUES ($1, $2, $3, 'manual', '2026-11-02T00:30:00.000Z', 'interrupted')
             RETURNING *`,
            [confirmed.schedule.id, confirmed.schedule.version, runConvA],
          )
        ).rows[0];
        await db.pool.query("UPDATE schedule_runs SET status = 'planning' WHERE id = $1", [runRowA.id]);

        const finalCommitStalled = createBarrier();
        proxy.armRule({
          sql: 'COMMIT',
          mode: 'drop_before_server',
          onIntercepted: () => finalCommitStalled.release(),
        });

        const hA = createHarness({
          pool: obs.observedPool,
          credRepo: new CredentialRepo(obs.observedPool, ENC_KEY),
        });
        const abortCtrlA = new AbortController();
        let actionCallsA = 0;
        let caughtA = '';

        const opA = (hA.digestRunner as any)
          .withBoundedEgressAuthority(
            {
              runId: runRowA.id,
              scheduleId: confirmed.schedule.id,
              scheduleVersion: confirmed.schedule.version,
              userId: owner.id,
              name: 'Bản tin R7',
              request: 'Tóm tắt email chưa đọc gửi vào Telegram của tôi',
              trigger: 'scheduled',
              dueAt: TICK_NOW,
              digestConfig: schedDb.digest_config,
              digestConfigHash: schedDb.digest_config_hash,
            },
            gmailBinding,
            tg.chatId,
            { credentialId: tg.row.id, telegramUserId: tg.telegramUserId },
            abortCtrlA.signal,
            2_000,
            async () => {
              actionCallsA += 1;
              return { messageId: 901 };
            },
          )
          .catch((err: Error) => {
            caughtA = err.message;
          });

        let activeQueryWhileStalledA = false;
        let settledA = false;
        try {
          await awaitBarrierWithConcurrentSettlement({
            label: 'A04-R7-B/finalCommitStalled',
            barrier: finalCommitStalled.promise,
            concurrentOp: opA,
            maxWaitMs: 2_000,
            describeState: () => ({
              actionCallsA,
              caughtA,
              interceptedCount: proxy.interceptedCount,
            }),
          });
          activeQueryWhileStalledA = Boolean(obs.currentActiveQuery);
          abortCtrlA.abort(new Error('FINAL_COMMIT_PARENT_ABORT'));
          settledA = await Promise.race([
            opA.then(() => true),
            new Promise<false>((r) => setTimeout(() => r(false), 350)),
          ]);
        } finally {
          proxy.disarm();
          if (!settledA) proxy.destroyActiveSockets();
          await opA;
          await db.pool.query('DELETE FROM schedule_runs WHERE id = $1', [runRowA.id]);
        }

        const snapA = obs.releaseSnapshots.at(-1)!;
        const nextBorrowerA = await obs.rawPool.connect();
        const nextPidA = (nextBorrowerA as any).processID as number;
        const nextAnsA = (await nextBorrowerA.query<{ answer: number }>('SELECT 42 AS answer')).rows[0]?.answer;
        nextBorrowerA.release();

        expect({
          activeQueryWhileStalledA,
          settledA,
          caughtA,
          actionCallsA,
          inFlightAtRelease: snapA.inFlightAtRelease,
          activeQueryPresentAtRelease: snapA.activeQueryPresentAtRelease,
          releaseErrTruthy: snapA.releaseErrTruthy,
          reusedSameBackend: nextPidA === snapA.backendPid,
          nextAnsA,
        }).toEqual({
          activeQueryWhileStalledA: true,
          settledA: true,
          caughtA: 'FINAL_COMMIT_PARENT_ABORT',
          actionCallsA: 1,
          inFlightAtRelease: 0,
          activeQueryPresentAtRelease: false,
          releaseErrTruthy: true,
          reusedSameBackend: false,
          nextAnsA: 42,
        });

        await vi.waitFor(
          async () => {
            const lockProbe = await db.pool.connect();
            try {
              await lockProbe.query('BEGIN');
              await lockProbe.query('SELECT id FROM users WHERE id = $1 FOR UPDATE NOWAIT', [owner.id]);
              await lockProbe.query('SELECT id FROM service_credentials WHERE id = $1 FOR UPDATE NOWAIT', [
                gmail.row.id,
              ]);
              await lockProbe.query('SELECT id FROM schedules WHERE id = $1 FOR UPDATE NOWAIT', [
                confirmed.schedule.id,
              ]);
              await lockProbe.query('ROLLBACK');
            } finally {
              lockProbe.release();
            }
          },
          { timeout: 1_500, interval: 15 },
        );

        // Subcase B: Deterministic end-to-end ScheduleRunner.tick() where read + AI authority succeed on the warm
        // proxied max=1 pool, then pre-send delivery_started_at claim COMMIT loses wire ack ('drop_server_ack')
        // and hits local sendTimeoutMs=110ms BEFORE any Telegram HTTP send occurs: socket terminates cleanly,
        // 0 Telegram sends occur, orphaned delivery_started_at is cleared, and pool recovers cleanly for next run.
        const interceptedBeforeB = proxy.interceptedCount;
        const sendClaimAckDropped = createBarrier();
        let armPreSendCommitDrop = true;
        const hB = createHarness({
          pool: obs.observedPool,
          credRepo: new CredentialRepo(obs.observedPool, ENC_KEY),
          sendTimeoutMs: 110,
          onAiSummary: async () => {
            if (armPreSendCommitDrop) {
              armPreSendCommitDrop = false;
              proxy.armRule({
                sql: 'COMMIT',
                mode: 'drop_server_ack',
                onIntercepted: () => sendClaimAckDropped.release(),
              });
            }
            return 'Tóm tắt AI R7-B.';
          },
        });

        const tickPromise = hB.scheduleRunner.tick();
        let tickSettledWithinBound = false;
        try {
          await awaitBarrierWithConcurrentSettlement({
            label: 'A04-R7-B/sendClaimAckDropped',
            barrier: sendClaimAckDropped.promise,
            concurrentOp: tickPromise,
            maxWaitMs: 2_500,
            describeState: async () => {
              const latest = (
                await db.pool.query(
                  'SELECT status, error, delivery_started_at, delivery FROM schedule_runs WHERE schedule_id = $1 ORDER BY created_at DESC LIMIT 1',
                  [confirmed.schedule.id],
                )
              ).rows[0];
              return {
                runStatus: latest?.status ?? null,
                runError: latest?.error ?? null,
                deliveryStartedAt: latest?.delivery_started_at ?? null,
                runDelivery: latest?.delivery ?? null,
                gmailCalls: hB.gmailCalls.length,
                aiCalls: hB.aiCalls.length,
                telegramWrites: hB.telegramWrites.length,
                interceptedCount: proxy.interceptedCount - interceptedBeforeB,
              };
            },
          });
          tickSettledWithinBound = await Promise.race([
            tickPromise.then(() => true),
            new Promise<false>((r) => setTimeout(() => r(false), 800)),
          ]);
        } finally {
          proxy.disarm();
          if (!tickSettledWithinBound) proxy.destroyActiveSockets();
          await tickPromise;
        }

        const persistedRunB = (
          await db.pool.query('SELECT * FROM schedule_runs WHERE schedule_id = $1 ORDER BY created_at DESC LIMIT 1', [
            confirmed.schedule.id,
          ])
        ).rows[0];
        const sendSnapB = obs.releaseSnapshots.slice(1).find((s) => s.releaseErrTruthy && s.inFlightAtRelease === 0);

        expect(proxy.interceptedCount - interceptedBeforeB).toBe(1);
        expect(tickSettledWithinBound).toBe(true);
        expect(hB.gmailCalls).toHaveLength(1);
        expect(hB.gmailCalls[0]?.context?.connections?.gmail?.credentialId).toBe(gmail.row.id);
        expect(hB.aiCalls).toHaveLength(1);
        expect(hB.telegramWrites).toHaveLength(0);
        expect(sendSnapB).toBeDefined();
        expect(persistedRunB.status).toBe('digest_failed');
        expect(persistedRunB.delivery_started_at).toBeNull();
        expect(persistedRunB.delivery).toBeNull();

        // Verify the max=1 observedPool recovered cleanly: next run on the same pool dispatches once -> digest_sent!
        await db.pool.query(
          "UPDATE schedules SET next_run_at = '2026-11-02T01:00:20.000Z' WHERE id = $1",
          [confirmed.schedule.id],
        );
        await hB.scheduleRunner.tick();
        const recoveredRunB = (
          await db.pool.query('SELECT * FROM schedule_runs WHERE schedule_id = $1 ORDER BY created_at DESC LIMIT 1', [
            confirmed.schedule.id,
          ])
        ).rows[0];
        expect(hB.telegramWrites).toHaveLength(1);
        expect(recoveredRunB.status).toBe('digest_sent');
        expect(recoveredRunB.delivery_started_at).not.toBeNull();
        expect(recoveredRunB.delivery).toMatchObject({
          chatId: tg.chatId,
          messageId: 901,
        });

        await expect(
          scheduleService.startRun({
            runId: recoveredRunB.id,
            trigger: 'replan',
            userId: owner.id,
            now: TICK_NOW,
          }),
        ).rejects.toMatchObject({ code: 'RUN_NOT_REPLANNABLE' });

        // Subcase C: Post-dispatch ambiguous failure (network drop during sendMessage after durable delivery_started_at
        // commit) classifies as delivery_unknown (TELEGRAM_DELIVERY_UNKNOWN), never falsely classifies as unsent, and never retries.
        const runRowC = (
          await db.pool.query(
            `INSERT INTO schedule_runs(schedule_id, schedule_version, conv_id, trigger, due_at, status)
             VALUES ($1, $2, $3, 'manual', '2026-11-02T02:00:00.000Z', 'planning')
             RETURNING *`,
            [confirmed.schedule.id, confirmed.schedule.version, runConvA],
          )
        ).rows[0];
        let sendHttpAttemptsC = 0;
        const hC = createHarness({
          pool: obs.observedPool,
          credRepo: new CredentialRepo(obs.observedPool, ENC_KEY),
          onTelegramSend: async () => {
            sendHttpAttemptsC += 1;
            throw new Error('Simulated post-dispatch TCP drop before Telegram HTTP response');
          },
        });
        const outC = await hC.digestRunner.execute(
          {
            runId: runRowC.id,
            scheduleId: confirmed.schedule.id,
            scheduleVersion: confirmed.schedule.version,
            userId: owner.id,
            name: 'Bản tin R7-C',
            request: 'Tóm tắt email chưa đọc gửi vào Telegram của tôi',
            trigger: 'manual',
            dueAt: TICK_NOW,
            digestConfig: schedDb.digest_config,
            digestConfigHash: schedDb.digest_config_hash,
          },
          new AbortController().signal,
        );
        expect(sendHttpAttemptsC).toBe(1);
        expect(hC.telegramWrites).toHaveLength(0);
        expect(outC.status).toBe('delivery_unknown');
        if (outC.status === 'delivery_unknown') {
          expect(outC.error).toContain('TELEGRAM_DELIVERY_UNKNOWN');
          expect(outC.error).not.toBe('Không gửi được tin nhắn báo cáo tới Telegram.');
          expect(outC.error).not.toContain('chưa gửi bản tin');
        }
        const persistedRunC = (
          await db.pool.query('SELECT delivery_started_at FROM schedule_runs WHERE id = $1', [runRowC.id])
        ).rows[0];
        expect(persistedRunC.delivery_started_at).not.toBeNull();

        await assertNoLeakedPgState('a04-r7-final-commit');
      } finally {
        await proxy.close();
      }
    });

    it('A04-R8: bounds ROLLBACK wire loss on abort/guard timer, enforces client non-reuse on action abort even when ROLLBACK completes, and preserves 55P03 NOWAIT reuse and known-undispatched classification', async () => {
      const owner = await db.person('Owner A04-R8');
      const credRepoSetup = new CredentialRepo(db.pool, ENC_KEY);
      const tg = await seedTelegramPersonal(credRepoSetup, owner.id, { telegramUserId: '777888801' });
      const gmail = await seedGmailPersonal(credRepoSetup, owner.id, { email: 'r8@example.test' });
      const { confirmed } = await proposeAndConfirmGmailDigest({ userId: owner.id, tg });

      const runConv = (
        await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [owner.id])
      ).rows[0].id as string;
      const runRow = (
        await db.pool.query(
          `INSERT INTO schedule_runs(schedule_id, schedule_version, conv_id, trigger, due_at, status)
           VALUES ($1, $2, $3, 'scheduled', '2026-11-02T01:00:00.000Z', 'planning')
           RETURNING *`,
          [confirmed.schedule.id, confirmed.schedule.version, runConv],
        )
      ).rows[0];
      const schedDb = (
        await db.pool.query('SELECT digest_config, digest_config_hash FROM schedules WHERE id = $1', [
          confirmed.schedule.id,
        ])
      ).rows[0];
      const gmailBinding = schedDb.digest_config.sources.find((s: any) => s.service === 'gmail')?.binding;

      const runInput = {
        runId: runRow.id,
        scheduleId: confirmed.schedule.id,
        scheduleVersion: confirmed.schedule.version,
        userId: owner.id,
        name: 'Bản tin R8',
        request: 'Tóm tắt email chưa đọc gửi vào Telegram của tôi',
        trigger: 'scheduled' as const,
        dueAt: TICK_NOW,
        digestConfig: schedDb.digest_config,
        digestConfigHash: schedDb.digest_config_hash,
      };

      const proxy = await createPgWireProxy();
      try {
        const obs = await createObservedProxiedMax1Pool('a04-r8-rollback-and-reuse', proxy.port);
        const h = createHarness({
          pool: obs.observedPool,
          credRepo: new CredentialRepo(obs.observedPool, ENC_KEY),
        });

        // 1. Known-undispatched 55P03 NOWAIT contention preserves backend reuse and "(chưa gửi bản tin)" classification
        const warmClient = await obs.rawPool.connect();
        const warmPid = (warmClient as any).processID as number;
        warmClient.release();

        const contender = await db.pool.connect();
        try {
          await contender.query('BEGIN');
          await contender.query('SELECT id FROM schedules WHERE id = $1 FOR UPDATE', [confirmed.schedule.id]);
          const contentionOut = await h.digestRunner.execute(runInput, new AbortController().signal);
          expect(contentionOut).toEqual({
            status: 'digest_failed',
            error: 'Tài nguyên kết nối hoặc lịch đang bận cập nhật (chưa gửi bản tin).',
            pauseSchedule: false,
          });
          expect(h.telegramWrites).toHaveLength(0);
        } finally {
          await contender.query('ROLLBACK').catch(() => {});
          contender.release();
        }

        const afterNowaitClient = await obs.rawPool.connect();
        const afterNowaitPid = (afterNowaitClient as any).processID as number;
        afterNowaitClient.release();
        expect(afterNowaitPid).toBe(warmPid);

        // 2. Abort during action on a healthy socket (where ROLLBACK completes) MUST still enforce client non-reuse
        const actionAbortCtrl = new AbortController();
        let caughtActionAbort = '';
        await (h.digestRunner as any)
          .withBoundedEgressAuthority(
            runInput,
            gmailBinding,
            tg.chatId,
            { credentialId: tg.row.id, telegramUserId: tg.telegramUserId },
            actionAbortCtrl.signal,
            2_000,
            async () => {
              actionAbortCtrl.abort(new Error('ACTION_ABORT_CLEAN_ROLLBACK'));
              throw new Error('ACTION_ABORT_CLEAN_ROLLBACK');
            },
          )
          .catch((err: Error) => {
            caughtActionAbort = err.message;
          });

        const snapCleanAbort = obs.releaseSnapshots.at(-1)!;
        const afterActionAbortClient = await obs.rawPool.connect();
        const afterActionAbortPid = (afterActionAbortClient as any).processID as number;
        afterActionAbortClient.release();

        expect(caughtActionAbort).toBe('ACTION_ABORT_CLEAN_ROLLBACK');
        expect(snapCleanAbort.inFlightAtRelease).toBe(0);
        expect(snapCleanAbort.releaseErrTruthy).toBe(true);
        expect(afterActionAbortPid).not.toBe(afterNowaitPid);

        // 3. Stalled wire ROLLBACK ('drop_before_server') terminates immediately on parent abort without waiting full 250ms guard
        const rollbackStalled = createBarrier();
        proxy.armRule({
          sql: 'ROLLBACK',
          mode: 'drop_before_server',
          onIntercepted: () => rollbackStalled.release(),
        });

        const rbAbortCtrl = new AbortController();
        let caughtRbAbort = '';
        const rbOp = (h.digestRunner as any)
          .withBoundedEgressAuthority(
            runInput,
            gmailBinding,
            tg.chatId,
            { credentialId: tg.row.id, telegramUserId: tg.telegramUserId },
            rbAbortCtrl.signal,
            2_000,
            async () => {
              throw new Error('NON_ABORT_ACTION_ERROR');
            },
          )
          .catch((err: Error) => {
            caughtRbAbort = err.message;
          });

        let rbElapsedAfterAbortMs = 9999;
        let rbSettled = false;
        try {
          await rollbackStalled.promise;
          const tRb = Date.now();
          rbAbortCtrl.abort(new Error('ABORT_DURING_STALLED_ROLLBACK'));
          rbSettled = await Promise.race([
            rbOp.then(() => true),
            new Promise<false>((r) => setTimeout(() => r(false), 140)),
          ]);
          rbElapsedAfterAbortMs = Date.now() - tRb;
        } finally {
          proxy.disarm();
          if (!rbSettled) proxy.destroyActiveSockets();
          await rbOp;
        }

        const snapRb = obs.releaseSnapshots.at(-1)!;
        const nextAfterRb = await obs.rawPool.connect();
        const nextAfterRbPid = (nextAfterRb as any).processID as number;
        const nextAfterRbAns = (await nextAfterRb.query<{ answer: number }>('SELECT 42 AS answer')).rows[0]?.answer;
        nextAfterRb.release();

        expect(rbSettled).toBe(true);
        expect(rbElapsedAfterAbortMs).toBeLessThan(140);
        expect(caughtRbAbort).toBe('ABORT_DURING_STALLED_ROLLBACK');
        expect(snapRb.inFlightAtRelease).toBe(0);
        expect(snapRb.activeQueryPresentAtRelease).toBe(false);
        expect(snapRb.releaseErrTruthy).toBe(true);
        expect(nextAfterRbPid).not.toBe(snapRb.backendPid);
        expect(nextAfterRbAns).toBe(42);

        await vi.waitFor(
          async () => {
            const lockProbe = await db.pool.connect();
            try {
              await lockProbe.query('BEGIN');
              await lockProbe.query('SELECT id FROM users WHERE id = $1 FOR UPDATE NOWAIT', [owner.id]);
              await lockProbe.query('SELECT id FROM service_credentials WHERE id = $1 FOR UPDATE NOWAIT', [
                gmail.row.id,
              ]);
              await lockProbe.query('SELECT id FROM schedules WHERE id = $1 FOR UPDATE NOWAIT', [
                confirmed.schedule.id,
              ]);
              await lockProbe.query('ROLLBACK');
            } finally {
              lockProbe.release();
            }
          },
          { timeout: 1_500, interval: 15 },
        );

        await assertNoLeakedPgState('a04-r8-rollback-and-reuse');
      } finally {
        await proxy.close();
      }
    });
  });
});
