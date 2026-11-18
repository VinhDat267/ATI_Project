import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { encryptCredentials, GlobalRateLimiter, StepError, TelegramAdapter } from '@wap/tool-adapters';
import { buildTelegramDigestSourceArgs } from '../../../src/services/schedules/multi-source-digest-candidate.js';
import { executeMultiDigestReadSources } from '../../../src/services/schedules/multi-source-digest-reader.js';
import { evaluateSlackDigestCandidate } from '../../../src/services/schedules/slack-digest-candidate.js';
import { NotionConnectionRepo } from '../../../src/db/repositories/notion-connection-repo.js';
import { NotionDigestSourceAuthority } from '../../../src/services/notion/digest-source-authority.js';
import { NotionOAuthClient } from '../../../src/services/notion/oauth-client.js';
import { NotionTokenManager } from '../../../src/services/notion/token-manager.js';
import { fingerprintSecret, startNotionLoopbackServer, waitForOwnerLockWaiter } from '../../helpers/notion-oauth-test-env.js';
import { CredentialRepo } from '../../../src/db/repositories/credential-repo.js';
import { ScheduleService } from '../../../src/services/schedules/schedule-service.js';
import type { AdapterContext } from '../../../src/services/adapter-factory.js';
import { reconcileScheduleRuns, ScheduleRunner } from '../../../src/services/schedules/schedule-runner.js';
import { computeTelegramDigestConfigHash, evaluateTelegramDigestCandidate, READ_DIGEST_SOURCE_MAP } from '../../../src/services/schedules/telegram-digest-candidate.js';
import { TelegramDigestRunner, summarizeSourceItems } from '../../../src/services/schedules/telegram-digest-runner.js';
import { certifyScheduleFixture } from '../../../src/services/slack/slack-schedule-origin.js';
import type { TelegramDigestConfig } from '@wap/tool-schemas';

const directory = fileURLToPath(new URL('../../../../../db/v3/', import.meta.url));
const ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const USER_ID = '00000000-0000-4000-8000-000000000001';

async function connectAdmin(): Promise<{ admin: pg.Pool; databaseUrl: string }> {
  const candidates = [
    process.env.DATABASE_URL,
    'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3',
    'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:56533/ati_v3',
  ].filter(Boolean) as string[];

  for (const url of candidates) {
    try {
      const p = new pg.Pool({ connectionString: url });
      await p.query('SELECT 1');
      return { admin: p, databaseUrl: url };
    } catch {
      // try next candidate
    }
  }
  throw new Error('Cannot connect to PostgreSQL');
}

describe('TelegramDigestRunner & ScheduleRunner integration on PostgreSQL (Task 8)', () => {
  const schema = `tg_digest_run_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Pool;
  let pool: pg.Pool;
  let credRepo: CredentialRepo;
  let service: ScheduleService;
  const now = new Date('2026-11-02T01:00:30.000Z');
  async function mycalendarSource() {
    const row = await credRepo.getPersonalCredentials('mycalendar', USER_ID);
    return {
      service: 'mycalendar', tool: 'mycalendar.list_events', label: 'Google Calendar của bạn hôm nay',
      mycalendarBinding: {
        credentialId: row!.id, email: 'runner.cal@example.com',
        calendarIds: ['runner.cal@example.com'], truncated: false,
      },
    };
  }

  beforeAll(async () => {
    const conn = await connectAdmin();
    admin = conn.admin;
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new pg.Pool({
      connectionString: conn.databaseUrl,
      options: `-c search_path=${schema},public`,
    });

    const files = (await readdir(directory)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      await pool.query(await readFile(new URL(file, `file://${directory}`), 'utf8'));
    }

    await pool.query(`
      INSERT INTO users (id, email, password, name, status)
      VALUES ($1, 'runner@example.com', 'hash', 'Runner User', 'active')
    `, [USER_ID]);

    credRepo = new CredentialRepo(pool, ENCRYPTION_KEY);
    service = new ScheduleService({ pool, timeZone: 'Asia/Ho_Chi_Minh' });
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM schedule_runs; DELETE FROM schedules; DELETE FROM service_credentials;');
  });

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  });

  async function seedDigestSchedule(config: TelegramDigestConfig, hashOverride?: string) {
    const convId = (await pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [USER_ID])).rows[0].id;
    const hash = hashOverride ?? computeTelegramDigestConfigHash(config);
    const res = await pool.query(
      `INSERT INTO schedules(user_id, conv_id, name, request, recurrence, services, status, next_run_at, kind, digest_config, digest_config_hash, digest_approved_at)
       VALUES ($1, $2, 'Báo cáo sáng', 'Tổng hợp GitHub và Lịch gửi Telegram', $3, '{github,calendar,telegram}', 'active', '2026-11-02T01:00:00.000Z', 'telegram_digest', $4, $5, now())
       RETURNING *`,
      [USER_ID, convId, JSON.stringify(config.recurrence), JSON.stringify(config), hash],
    );
    await certifyScheduleFixture(pool, res.rows[0].id);
    return res.rows[0];
  }

  it('blocks an old Notion schedule before resolving its current default connection', async () => {
    await credRepo.saveCredentials('telegram', encryptCredentials({
      telegramUserId: '777888999',
      username: 'runneruser',
      selectedChats: [{ chatId: '777888999', title: 'Private chat', type: 'private' }],
    }, ENCRYPTION_KEY), USER_ID);
    const credential = (await credRepo.getPersonalCredentials('telegram', USER_ID))!;
    const config: TelegramDigestConfig = {
      credentialId: credential.id,
      telegramUserId: '777888999',
      username: 'runneruser',
      chatId: '777888999',
      chatTitle: 'Private chat',
      sources: [{ service: 'notion', tool: 'notion.search_pages', label: 'Notion' }],
      recurrence: { type: 'daily', time: '08:00' },
      timeZone: 'Asia/Ho_Chi_Minh',
    };
    const schedule = await seedDigestSchedule(config);
    const getAdapterForService = vi.fn(async () => ({
      execute: async () => ({ pages: [{ title: 'Page from the current default connection' }] }),
    }));
    const summarizeWithAi = vi.fn(async () => null);
    const runner = new TelegramDigestRunner({
      credentialRepo: credRepo, encryptionKey: ENCRYPTION_KEY, timeZone: config.timeZone,
      adapterFactory: { getAdapterForService }, summarizeWithAi,
    });

    const result = await runner.execute({
      runId: randomUUID(), scheduleId: schedule.id, scheduleVersion: schedule.version,
      userId: USER_ID, name: schedule.name, request: schedule.request, dueAt: now, trigger: 'scheduled',
      digestConfig: schedule.digest_config, digestConfigHash: schedule.digest_config_hash,
    }, AbortSignal.timeout(3000));

    expect(result).toMatchObject({ status: 'blocked', pauseSchedule: true });
    expect(getAdapterForService).not.toHaveBeenCalled();
    expect(summarizeWithAi).not.toHaveBeenCalled();
  });

  it.each([20, 0])('sends the Notion source truncation warning with %i returned pages', async (pageCount) => {
    const chatId = '777888999';
    const username = 'runneruser';
    const credential = await credRepo.saveCredentials('telegram', encryptCredentials({
      telegramUserId: chatId, username,
      selectedChats: [{ chatId, title: 'Private chat', type: 'private' }],
    }, ENCRYPTION_KEY), USER_ID);
    const databaseId = randomUUID();
    const notionBinding = {
      version: 1 as const, ownerId: USER_ID, credentialId: randomUUID(), appId: 'notion-app',
      workspaceId: 'workspace-fixture', workspaceName: 'Notion workspace',
      actorId: 'actor-fixture', botId: 'bot-fixture', identityVersion: 1,
      databases: [{ databaseId, dataSourceId: randomUUID(), title: 'Sprint' }],
    };
    const config: TelegramDigestConfig = {
      credentialId: credential.id, telegramUserId: chatId, username, chatId, chatTitle: 'Private chat',
      sources: [{ service: 'notion', tool: 'notion.query_database', label: 'Notion', notionBinding }],
      recurrence: { type: 'daily', time: '08:00' }, timeZone: 'Asia/Ho_Chi_Minh',
    };
    const schedule = await seedDigestSchedule(config);
    const runId = (await pool.query(
      `INSERT INTO schedule_runs(schedule_id,schedule_version,trigger,due_at,status)
       VALUES($1,$2,'scheduled',$3,'planning') RETURNING id`, [schedule.id, schedule.version, now],
    )).rows[0].id;
    const pages = Array.from({ length: pageCount }, (_, i) => ({
      id: randomUUID(), title: `Sprint task ${i + 1}`, url: 'https://www.notion.so/fixture',
      properties: { Description: 'a'.repeat(500), Notes: 'b'.repeat(500), Details: '📝'.repeat(500) },
    }));
    const send = vi.fn(async (_tool: string, _args: { text: string }) => ({ messageId: 42 }));
    const runner = new TelegramDigestRunner({
      pool, credentialRepo: credRepo, encryptionKey: ENCRYPTION_KEY, timeZone: config.timeZone,
      adapterFactory: { getAdapterForService: async () => ({ execute: send }) },
      notionSources: {
        read: async () => ({
          pages, pagesByDatabase: new Map([[databaseId, pages]]), truncated: true,
          truncatedByDatabase: new Map([[databaseId, true]]), databases: [{ databaseId, truncated: true }],
        }),
        withSource: async (_ownerId, _binding, _signal, dispatch) => {
          const client = await pool.connect();
          try { return await dispatch(client); }
          finally { client.release(); }
        },
      },
    });

    const result = await runner.execute({
      runId, scheduleId: schedule.id, scheduleVersion: schedule.version,
      userId: USER_ID, name: schedule.name, request: schedule.request, dueAt: now, trigger: 'scheduled',
      digestConfig: schedule.digest_config, digestConfigHash: schedule.digest_config_hash,
    }, AbortSignal.timeout(3000));

    expect(result).toMatchObject({
      status: 'digest_sent',
      delivery: { sources: [{
        service: 'notion', label: 'Notion', itemCount: pageCount,
        status: pageCount > 0 ? 'ok' : 'empty', truncated: true,
      }] },
    });
    expect(send).toHaveBeenCalledTimes(1);
    const [tool, { text: sentText }] = send.mock.calls[0]!;
    expect(tool).toBe('telegram.send_message');
    expect(sentText).toContain('giới hạn 20 trang/database');
    expect(Array.from(sentText).length).toBeLessThanOrEqual(4000);
  });

  it.each([
    'unchanged', 'source-replaced', 'unshared', 'revoked-before-send', 'revoke-waits-for-send',
    'one-pool-client', 'source-replaced-before-confirm', 'archived-before-send',
  ] as const)(
    'reads only approved workspace A after default switches to B (%s)',
    async (change) => {
      const dbId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
      const sourceId = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
      const otherSourceId = 'cccccccc-3333-4333-8333-cccccccccccc';
      const pageId = 'dddddddd-4444-4444-8444-dddddddddddd';
      const singleClientPool = change === 'one-pool-client'
        ? new pg.Pool({ ...pool.options, max: 1, connectionTimeoutMillis: 1000 })
        : undefined;
      const runPool = singleClientPool ?? pool;
      const notionRepo = new NotionConnectionRepo(runPool);
      const loopback = await startNotionLoopbackServer();
      try {
        const oauthConfig = loopback.oauthConfig('notion-app');
        const oauth = new NotionOAuthClient(oauthConfig);
        const tokens = new NotionTokenManager(notionRepo, oauth, ENCRYPTION_KEY);
        const authority = new NotionDigestSourceAuthority(notionRepo, tokens, oauth, ENCRYPTION_KEY);
        async function seedConnection(label: string, isDefault: boolean) {
          const credentials = encryptCredentials({ accessToken: `fixture-access-${label}`, refreshToken: '' }, ENCRYPTION_KEY);
          return (await pool.query(
            `INSERT INTO notion_connections(user_id,app_id,workspace_id,workspace_name,actor_id,bot_id,
              config,allowed_databases,selected_databases,is_default)
             VALUES($1,'notion-app',$2,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
            [USER_ID, label, `actor-${label}`, `bot-${label}`, credentials, [dbId],
              JSON.stringify([{ id: dbId, title: 'Sprint' }]), isDefault],
          )).rows[0].id as string;
        }
        const a = await seedConnection('A', true);
        const b = await seedConnection('B', false);
        const metadata = (id: string) => ({
          object: 'database', id: dbId, title: [{ plain_text: 'Sprint' }], data_sources: [{ id }],
        });
        loopback.enqueue('GET', `/databases/${dbId}`, { kind: 'json', body: metadata(sourceId) });
        const binding = await authority.prepare(USER_ID, 'Tổng hợp Notion Sprint', AbortSignal.timeout(3000));
        expect(binding.credentialId).toBe(a);
        expect(binding.databases).toEqual([{ databaseId: dbId, dataSourceId: sourceId, title: 'Sprint' }]);
        await notionRepo.setActiveWorkspace(USER_ID, b);
        expect((await notionRepo.getActive(USER_ID))?.id).toBe(b);

        const selectedChats = [{ chatId: '777888999', title: 'Private chat', type: 'private' as const }];
        const credential = await credRepo.saveCredentials('telegram', encryptCredentials({
          telegramUserId: '777888999', username: 'runneruser', selectedChats,
        }, ENCRYPTION_KEY), USER_ID);
        const proposal = { kind: 'schedule' as const, action: 'create' as const, summary: 'Tổng hợp Notion', request: 'Tổng hợp Notion Sprint gửi Telegram',
          recurrence: { type: 'daily' as const, time: '08:00' } };
        const candidate = evaluateTelegramDigestCandidate({
          proposal, services: ['notion', 'telegram'], timeZone: 'Asia/Ho_Chi_Minh', notionBinding: binding,
          telegramLookup: {
            status: 'connected', selectedChats,
            connection: { credentialId: credential.id, telegramUserId: '777888999', username: 'runneruser', chatIds: ['777888999'] },
          },
        });
        expect(candidate.canAutoDigest).toBe(true);
        const convId = (await pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [USER_ID])).rows[0].id;
        const messageId = (await pool.query(
          "INSERT INTO messages(conv_id,role,content,metadata) VALUES($1,'assistant','Notion preview',$2) RETURNING id",
          [convId, JSON.stringify({ type: 'schedule_proposal', proposal: { ...proposal, name: 'Sprint' },
            services: ['notion', 'telegram'], nextRuns: [], scheduleId: null, baseVersion: null, digestCandidate: candidate })],
        )).rows[0].id;
        loopback.enqueue('GET', `/databases/${dbId}`, {
          kind: 'json', body: metadata(change === 'source-replaced-before-confirm' ? otherSourceId : sourceId),
        });
        const confirming = new ScheduleService({
          pool, timeZone: candidate.config!.timeZone, verifyNotionSource: authority.withSource.bind(authority),
        }).confirmProposal({ userId: USER_ID, convId, messageId, now, approvalMode: 'auto_digest' });
        if (change === 'source-replaced-before-confirm') {
          await expect(confirming).rejects.toMatchObject({ code: 'REAUTHORIZATION_REQUIRED' });
          expect((await pool.query('SELECT id FROM schedules WHERE conv_id=$1', [convId])).rowCount).toBe(0);
          return;
        }
        const confirmed = await confirming;
        const schedule = (await pool.query('SELECT * FROM schedules WHERE id=$1', [confirmed.schedule.id])).rows[0];
        expect(schedule.kind).toBe('telegram_digest');
        expect(schedule.digest_config.sources[0].notionBinding).toEqual(binding);
        const runId = (await pool.query(
          `INSERT INTO schedule_runs(schedule_id,schedule_version,trigger,due_at,status)
           VALUES($1,$2,'scheduled',$3,'planning') RETURNING id`, [schedule.id, schedule.version, now],
        )).rows[0].id;
        loopback.enqueue('GET', `/databases/${dbId}`, {
          kind: 'json', status: change === 'unshared' ? 404 : 200,
          body: metadata(change === 'source-replaced' ? otherSourceId : sourceId),
        });
        loopback.enqueue('GET', `/data_sources/${sourceId}`, { kind: 'json', body: {
          object: 'data_source', id: sourceId, parent: { type: 'database_id', database_id: dbId },
          properties: { Name: { type: 'title' } },
        } });
        loopback.enqueue('POST', `/data_sources/${sourceId}/query`, { kind: 'json', body: {
          object: 'list',
          results: [{ object: 'page', id: pageId, url: 'https://www.notion.so/fixture',
            parent: { type: 'data_source_id', data_source_id: sourceId },
            properties: { Name: { type: 'title', title: [{ plain_text: 'Approved A page' }] } } }],
          has_more: false,
        } });
        const shouldSend = change === 'unchanged' || change === 'revoke-waits-for-send' || change === 'one-pool-client';
        if (shouldSend || change === 'archived-before-send') {
          loopback.enqueue('GET', `/databases/${dbId}`, {
            kind: 'json', body: { ...metadata(sourceId), in_trash: change === 'archived-before-send' },
          });
        }

        let disconnect: ReturnType<NotionConnectionRepo['disconnect']> | undefined;
        const send = vi.fn(async (_tool: string, args: { text: string }) => {
          expect(args.text).toContain('Approved A page');
          if (change === 'revoke-waits-for-send') {
            disconnect = notionRepo.disconnect(USER_ID, a);
            const locks = await waitForOwnerLockWaiter(pool, USER_ID);
            expect(locks.waitingCount).toBeGreaterThan(0);
            expect((await notionRepo.getActive(USER_ID, a))?.status).toBe('active');
          }
          return { messageId: 42 };
        });
        const ai = vi.fn(async () => 'unexpected model call');
        const runner = new TelegramDigestRunner({
          pool: runPool, credentialRepo: credRepo, encryptionKey: ENCRYPTION_KEY, timeZone: candidate.config!.timeZone,
          adapterFactory: { getAdapterForService: async (name) => {
            expect(name).toBe('telegram');
            if (change === 'revoked-before-send') await notionRepo.disconnect(USER_ID, a);
            return { execute: send };
          } },
          notionSources: authority, summarizeWithAi: ai,
        });
        const result = await runner.execute({
          runId, scheduleId: schedule.id, scheduleVersion: schedule.version,
          userId: USER_ID, name: schedule.name, request: schedule.request, dueAt: now, trigger: 'scheduled',
          digestConfig: schedule.digest_config, digestConfigHash: schedule.digest_config_hash,
        }, AbortSignal.timeout(6000));

        if (disconnect) {
          await disconnect;
          expect(await notionRepo.getActive(USER_ID, a)).toBeNull();
        }
        expect(result.status, JSON.stringify(result)).toBe(shouldSend ? 'digest_sent' : 'blocked');
        expect(send).toHaveBeenCalledTimes(shouldSend ? 1 : 0);
        expect(ai).not.toHaveBeenCalled();
        expect(loopback.ledger.every((call) => call.bearerFingerprint === fingerprintSecret('fixture-access-A'))).toBe(true);
        expect(loopback.countPath(`/data_sources/${otherSourceId}/query`)).toBe(0);
        expect(loopback.countPath(`/data_sources/${sourceId}/query`)).toBe(change === 'source-replaced' || change === 'unshared' ? 0 : 1);
        const dispatch = (await pool.query(
          'SELECT delivery_started_at, dispatched_config, dispatched_config_hash FROM schedule_runs WHERE id=$1', [runId],
        )).rows[0];
        if (shouldSend) {
          expect(dispatch.delivery_started_at).toBeInstanceOf(Date);
          expect(dispatch.dispatched_config.sources[0].notionBinding).toEqual(binding);
          expect(dispatch.dispatched_config_hash).toBe(candidate.configHash);
        } else {
          expect(dispatch.delivery_started_at).toBeNull();
          expect(dispatch.dispatched_config).toBeNull();
        }
      } finally {
        await loopback.close();
        await singleClientPool?.end();
        await pool.query('DELETE FROM notion_connections WHERE user_id=$1', [USER_ID]);
      }
    },
    15_000,
  );

  it.each([false, true])('executes multi-source read digest and records only a possible dispatch (definite rejection: %s)', async (rejected) => {
    await credRepo.saveCredentials(
      'telegram',
      encryptCredentials(
        {
          telegramUserId: '777888999',
          username: 'runneruser',
          displayName: 'Runner User',
          selectedChats: [
            { chatId: '-100555666777', title: 'Đội Sản Phẩm', type: 'supergroup' },
          ],
        },
        ENCRYPTION_KEY,
      ),
      USER_ID,
    );
    const savedCred = await credRepo.getPersonalCredentials('telegram', USER_ID);

    const config: TelegramDigestConfig = {
      credentialId: savedCred!.id,
      telegramUserId: '777888999',
      username: 'runneruser',
      chatId: '-100555666777',
      chatTitle: 'Đội Sản Phẩm',
      sources: [
        { service: 'github', tool: 'github.search_issues', args: { repo: 'acme/ati', query: 'open' }, label: 'GitHub Issues đang mở' },
        { service: 'calendar', tool: 'calendar.list_events', label: 'Lịch nhóm hôm nay' },
      ],
      recurrence: { type: 'daily', time: '08:00' },
      timeZone: 'Asia/Ho_Chi_Minh',
    };

    const sched = await seedDigestSchedule(config);
    const sentMessages: Array<{ chatId: string; text: string }> = [];

    const adapterFactory: any = {
      getAdapterForService: vi.fn(async (serviceName: string) => {
        if (serviceName === 'github') {
          return {
            execute: async () => [
              { number: 42, title: 'Sửa lỗi OAuth Telegram', state: 'open' },
            ],
          };
        }
        if (serviceName === 'calendar') {
          return {
            execute: async () => {
              throw new Error('Calendar API timeout');
            },
          };
        }
        if (serviceName === 'telegram') {
          return {
            execute: async (tool: string, args: any) => {
              expect(tool).toBe('telegram.send_message');
              sentMessages.push(args);
              if (rejected) throw new StepError({
                message: 'Telegram rejected the message',
                category: 'VALIDATION',
                details: { requestSent: false },
              });
              return { messageId: 901, chatId: args.chatId, date: 1793581230 };
            },
          };
        }
        throw new Error(`Unexpected service ${serviceName}`);
      }),
    };

    const digestRunner = new TelegramDigestRunner({
      pool,
      credentialRepo: credRepo,
      encryptionKey: ENCRYPTION_KEY,
      adapterFactory,
      botClient: { getChatMember: async () => true },
      timeZone: 'Asia/Ho_Chi_Minh',
    });

    const runner = new ScheduleRunner({
      pool,
      timeZone: 'Asia/Ho_Chi_Minh',
      now: () => now,
      planRun: async () => {
        throw new Error('Should not call planRun for telegram_digest');
      },
      executeDigestRun: (run, signal) => digestRunner.execute(run, signal),
      recordState: (client, row, at) => service.recordState(client, row, at),
    });

    await runner.tick();

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]!.chatId).toBe('-100555666777');
    expect(sentMessages[0]!.text).toContain('Bản tin tự động của Planora · thiết lập bởi @runneruser');
    expect(sentMessages[0]!.text).toContain('Sửa lỗi OAuth Telegram');
    expect(sentMessages[0]!.text).toContain('Lịch nhóm hôm nay');

    const runRows = (await pool.query('SELECT * FROM schedule_runs WHERE schedule_id = $1', [sched.id])).rows;
    expect(runRows).toHaveLength(1);
    if (rejected) {
      expect(runRows[0]).toMatchObject({
        status: 'digest_failed', delivery_started_at: null, dispatched_config: null, dispatched_config_hash: null,
      });
      return;
    }
    expect(runRows[0].status).toBe('digest_sent');
    expect(runRows[0].dispatched_config).toEqual(config);
    expect(runRows[0].dispatched_config_hash).toBe(computeTelegramDigestConfigHash(config));
    expect(runRows[0].delivery).toMatchObject({
      chatId: '-100555666777',
      chatTitle: 'Đội Sản Phẩm',
      messageId: 901,
      sources: [
        { service: 'github', label: 'GitHub Issues đang mở', status: 'ok', itemCount: 1 },
        { service: 'calendar', label: 'Lịch nhóm hôm nay', status: 'partial_error' },
      ],
    });
  });

  it('reconciles an interrupted Telegram dispatch after the schedule switches to manual approval', async () => {
    const config: TelegramDigestConfig = {
      credentialId: randomUUID(), telegramUserId: '777', username: 'fixture',
      chatId: '-100555666777', chatTitle: 'Original Telegram destination',
      sources: [{ service: 'github', tool: 'github.search_issues', label: 'GitHub' }],
      recurrence: { type: 'daily', time: '08:00' }, timeZone: 'Asia/Ho_Chi_Minh',
    };
    const schedule = await seedDigestSchedule(config);
    const { rows: [{ id }] } = await pool.query(
      `INSERT INTO schedule_runs(schedule_id, schedule_version, trigger, due_at, status,
                                 delivery_started_at, dispatched_config, dispatched_config_hash)
       VALUES ($1, $2, 'manual', $3, 'planning', $3, $4, $5) RETURNING id`,
      [schedule.id, schedule.version, now, JSON.stringify(config), computeTelegramDigestConfigHash(config)],
    );
    await pool.query(
      `UPDATE schedules SET kind='plan', version=version+1, digest_config=NULL,
                            digest_config_hash=NULL, digest_approved_at=NULL WHERE id=$1`,
      [schedule.id],
    );

    await reconcileScheduleRuns(pool);
    const runs = await service.listRuns(USER_ID, schedule.id, 10, now);
    expect(runs[0]).toMatchObject({
      id, state: 'needs_attention', error: expect.stringContaining('TELEGRAM_DELIVERY_UNKNOWN'), canRetryDelivery: false,
    });
    await expect(service.resolveRunDelivery({ userId: USER_ID, runId: id, resolution: 'retry_new_run', confirmDuplicateRisk: true, now }))
      .rejects.toMatchObject({ code: 'CONFIG_CHANGED_SINCE_RUN' });
    const result = await service.resolveRunDelivery({ userId: USER_ID, runId: id, resolution: 'mark_sent', now });
    expect(result.run.delivery).toMatchObject({ chatId: config.chatId, chatTitle: config.chatTitle });
    expect(result.followUpRun).toBeNull();
  });

  it('marks run as blocked and pauses schedule when digest_config_hash mismatches or user is no longer a group member, with 0 Telegram sends', async () => {
    await credRepo.saveCredentials(
      'telegram',
      encryptCredentials(
        {
          telegramUserId: '777888999',
          username: 'runneruser',
          displayName: 'Runner User',
          selectedChats: [
            { chatId: '-100555666777', title: 'Đội Sản Phẩm', type: 'supergroup' },
          ],
        },
        ENCRYPTION_KEY,
      ),
      USER_ID,
    );
    const savedCred = await credRepo.getPersonalCredentials('telegram', USER_ID);

    const config: TelegramDigestConfig = {
      credentialId: savedCred!.id,
      telegramUserId: '777888999',
      username: 'runneruser',
      chatId: '-100555666777',
      chatTitle: 'Đội Sản Phẩm',
      sources: [
        { service: 'github', tool: 'github.search_issues', args: { repo: 'acme/ati', query: 'open' }, label: 'GitHub Issues đang mở' },
      ],
      recurrence: { type: 'daily', time: '08:00' },
      timeZone: 'Asia/Ho_Chi_Minh',
    };

    const sched = await seedDigestSchedule(config);
    const telegramExecute = vi.fn();

    const digestRunner = new TelegramDigestRunner({
      pool,
      credentialRepo: credRepo,
      encryptionKey: ENCRYPTION_KEY,
      adapterFactory: {
        getAdapterForService: async (serviceName: string) => ({
          execute: serviceName === 'telegram' ? telegramExecute : async () => [],
        }),
      } as any,
      botClient: { getChatMember: async () => false }, // User left the group!
      timeZone: 'Asia/Ho_Chi_Minh',
    });

    const runner = new ScheduleRunner({
      pool,
      timeZone: 'Asia/Ho_Chi_Minh',
      now: () => now,
      planRun: async () => {
        throw new Error('Should not call planRun');
      },
      executeDigestRun: (run, signal) => digestRunner.execute(run, signal),
      recordState: (client, row, at) => service.recordState(client, row, at),
    });

    await runner.tick();

    expect(telegramExecute).not.toHaveBeenCalled();
    const runRows = (await pool.query('SELECT * FROM schedule_runs WHERE schedule_id = $1', [sched.id])).rows;
    expect(runRows).toHaveLength(1);
    expect(runRows[0].status).toBe('blocked');
    expect(runRows[0].delivery).toBeNull();

    const updatedSched = (await pool.query('SELECT * FROM schedules WHERE id = $1', [sched.id])).rows[0];
    expect(updatedSched.status).toBe('paused');
  });

  it('aborts sending and marks run as discarded when schedule version changes during source read, before telegram.send_message is called', async () => {
    await credRepo.saveCredentials(
      'telegram',
      encryptCredentials(
        {
          telegramUserId: '777888999',
          username: 'runneruser',
          displayName: 'Runner User',
          selectedChats: [
            { chatId: '777888999', title: 'Telegram của tôi (Runner User)', type: 'private' },
          ],
        },
        ENCRYPTION_KEY,
      ),
      USER_ID,
    );
    const savedCred = await credRepo.getPersonalCredentials('telegram', USER_ID);

    const config: TelegramDigestConfig = {
      credentialId: savedCred!.id,
      telegramUserId: '777888999',
      username: 'runneruser',
      chatId: '777888999',
      chatTitle: 'Telegram của tôi (Runner User)',
      sources: [
        { service: 'calendar', tool: 'calendar.list_events', label: 'Lịch nhóm hôm nay' },
      ],
      recurrence: { type: 'daily', time: '08:00' },
      timeZone: 'Asia/Ho_Chi_Minh',
    };

    const sched = await seedDigestSchedule(config);
    const telegramExecute = vi.fn();
    let calendarCalledArgs: any = null;

    const digestRunner = new TelegramDigestRunner({
      pool,
      credentialRepo: credRepo,
      encryptionKey: ENCRYPTION_KEY,
      adapterFactory: {
        getAdapterForService: async (serviceName: string) => {
          if (serviceName === 'calendar') {
            return {
              execute: async (_tool: string, args: any) => {
                calendarCalledArgs = args;
                // Simulate concurrent schedule edit incrementing version while source is being read
                await pool.query('UPDATE schedules SET version = version + 1 WHERE id = $1', [sched.id]);
                return [{ summary: 'Họp Sprint', start: '2026-11-02T09:00:00+07:00' }];
              },
            };
          }
          return { execute: telegramExecute };
        },
      } as any,
      botClient: { getChatMember: async () => true },
      timeZone: 'Asia/Ho_Chi_Minh',
    });

    const runner = new ScheduleRunner({
      pool,
      timeZone: 'Asia/Ho_Chi_Minh',
      now: () => now,
      planRun: async () => {
        throw new Error('Should not call planRun');
      },
      executeDigestRun: (run, signal) => digestRunner.execute(run, signal),
      recordState: (client, row, at) => service.recordState(client, row, at),
    });

    await runner.tick();

    // Calendar adapter received default timeMin and timeMax window
    expect(calendarCalledArgs).toBeDefined();
    expect(typeof calendarCalledArgs.timeMin).toBe('string');
    expect(typeof calendarCalledArgs.timeMax).toBe('string');

    // Because schedule version changed before send, 0 messages must be sent to Telegram and run is discarded
    expect(telegramExecute).not.toHaveBeenCalled();
    const runRows = (await pool.query('SELECT * FROM schedule_runs WHERE schedule_id = $1', [sched.id])).rows;
    expect(runRows).toHaveLength(1);
    expect(runRows[0].status).toBe('discarded');
  });

  it('formats Gmail digest items with sender, subject, attachment indicator, and snippet using in:inbox is:unread', () => {
    expect(READ_DIGEST_SOURCE_MAP.gmail).toEqual({
      service: 'gmail',
      tool: 'gmail.search_threads',
      args: { query: 'in:inbox is:unread' },
      label: 'Email chưa đọc',
    });

    const summary = summarizeSourceItems('gmail', [
      {
        id: 'gmail-thread-1',
        subject: 'Họp nhóm ATI',
        from: 'Lan <lan@example.com>',
        snippet: 'Chào nhóm, họp lúc 9 giờ.',
        hasAttachment: false,
        attachmentNames: [],
      },
      {
        id: 'gmail-thread-2',
        subject: 'Báo cáo tuần',
        from: 'Minh <minh@example.com>',
        snippet: 'Nhờ bạn xem báo cáo tuần này.',
        hasAttachment: true,
        attachmentNames: ['báo cáo.pdf'],
      },
    ]);

    expect(summary.count).toBe(2);
    expect(summary.lines[0]).toBe('  - [Lan <lan@example.com>] Họp nhóm ATI — Chào nhóm, họp lúc 9 giờ.');
    expect(summary.lines[1]).toBe('  - [Minh <minh@example.com>] Báo cáo tuần 📎 (báo cáo.pdf) — Nhờ bạn xem báo cáo tuần này.');
  });

  it.each(['live grant', 'grant replaced during read', 'grant replaced while pacing', 'grant replaced after rejection', 'retry after rejection'] as const)('uses the approved MyCalendar source only with live authority: %s', async (scenario) => {
    await credRepo.saveCredentials(
      'telegram',
      encryptCredentials(
        {
          telegramUserId: '777888999',
          username: 'runneruser',
          displayName: 'Runner User',
          selectedChats: [{ chatId: '-100555666777', title: 'Đội Sản Phẩm', type: 'supergroup' }],
        },
        ENCRYPTION_KEY,
      ),
      USER_ID,
    );
    await credRepo.saveCredentials(
      'mycalendar',
      encryptCredentials(
        {
          refreshToken: '1//fake-cal-refresh',
          email: 'runner.cal@example.com',
          selectedCalendars: [{ id: 'runner.cal@example.com', summary: 'Lịch chính', primary: true }],
          allowedScope: { calendars: ['runner.cal@example.com'] },
        },
        ENCRYPTION_KEY,
      ),
      USER_ID,
    );
    const savedTgCred = await credRepo.getPersonalCredentials('telegram', USER_ID);

    const config: TelegramDigestConfig = {
      credentialId: savedTgCred!.id,
      telegramUserId: '777888999',
      username: 'runneruser',
      chatId: '-100555666777',
      chatTitle: 'Đội Sản Phẩm',
      sources: [
        await mycalendarSource(),
        { service: 'github', tool: 'github.search_issues', args: { repo: 'acme/ati', query: 'open' }, label: 'GitHub Issues đang mở' },
      ],
      recurrence: { type: 'daily', time: '08:00' },
      timeZone: 'Asia/Ho_Chi_Minh',
    };

    const sched = await seedDigestSchedule(config);
    const sentMessages: Array<{ chatId: string; text: string }> = [];
    let capturedMyCalArgs: any = null;
    const replaceCalendar = () => credRepo.saveCredentials('mycalendar', encryptCredentials({
      email: 'replacement@example.test', refreshToken: 'replacement',
      allowedScope: { calendars: ['runner.cal@example.com'] },
    }, ENCRYPTION_KEY), USER_ID);
    const limiter = new GlobalRateLimiter({ maxRequests: 10, windowMs: 1000 });
    if (scenario === 'grant replaced while pacing') {
      vi.spyOn(limiter, 'waitForSlot').mockImplementationOnce(async () => {
        await replaceCalendar();
        return true;
      });
    }
    const native = new TelegramAdapter({
      credentials: { botToken: '42:fixturetoken' }, allowedScope: { chats: [config.chatId] },
      groupRateLimiter: limiter,
      async fetchFn(input, init) {
        const chat = { id: Number(config.chatId), title: config.chatTitle, type: 'supergroup' };
        if (String(input).endsWith('/getChat')) return Response.json({ ok: true, result: chat });
        sentMessages.push(JSON.parse(String(init?.body)));
        if (sentMessages.length === 1 && (scenario === 'grant replaced after rejection' || scenario === 'retry after rejection')) {
          if (scenario === 'grant replaced after rejection') await replaceCalendar();
          return Response.json({ ok: false, error_code: 429, parameters: { retry_after: 0 } }, { status: 429 });
        }
        return Response.json({ ok: true, result: { chat, message_id: 902, date: 1 } });
      },
    });

    const digestRunner = new TelegramDigestRunner({
      pool,
      credentialRepo: credRepo,
      encryptionKey: ENCRYPTION_KEY,
      adapterFactory: {
        getAdapterForService: async (serviceName: string, context?: AdapterContext) => {
          if (serviceName === 'mycalendar') {
            expect(context).toMatchObject({
              phase: 'execution',
              connections: { mycalendar: { allowedCalendars: ['runner.cal@example.com'] } },
            });
            return {
              execute: async (_tool: string, args: any) => {
                capturedMyCalArgs = args;
                if (scenario === 'grant replaced during read') {
                  await replaceCalendar();
                }
                if (args.calendarId === 'primary') {
                  throw new Error('VALIDATION: calendarId "primary" is not in allowedCalendars');
                }
                return {
                  events: [
                    {
                      id: 'ev_1',
                      title: 'Họp Sprint',
                      start: '2026-11-02T09:00:00+07:00',
                      end: '2026-11-02T10:00:00+07:00',
                      url: 'https://calendar.google.com/event?eid=1',
                      meetLink: 'https://meet.google.com/spr-int-123',
                      location: 'Phòng 302',
                    },
                  ],
                };
              },
            };
          }
          if (serviceName === 'github') {
            return {
              execute: async () => [{ id: 10, number: 12, title: 'Fix Calendar Sync' }],
            };
          }
          if (serviceName === 'telegram') {
            return native;
          }
          throw new Error(`Unexpected service ${serviceName}`);
        },
      } as any,
      botClient: { getChatMember: async () => true },
      timeZone: 'Asia/Ho_Chi_Minh',
    });

    const runner = new ScheduleRunner({
      pool,
      timeZone: 'Asia/Ho_Chi_Minh',
      encryptionKey: ENCRYPTION_KEY,
      now: () => now,
      planRun: async () => {
        throw new Error('Should not call planRun');
      },
      executeDigestRun: (run, signal) => digestRunner.execute(run, signal),
      recordState: (client, row, at) => service.recordState(client, row, at),
    });

    await runner.tick();

    expect(capturedMyCalArgs).toBeDefined();
    expect(capturedMyCalArgs.calendarId).toBe('runner.cal@example.com');
    if (scenario.startsWith('grant replaced')) {
      expect(sentMessages).toHaveLength(scenario === 'grant replaced after rejection' ? 1 : 0);
      const run = (await pool.query('SELECT status, delivery_started_at FROM schedule_runs WHERE schedule_id = $1', [sched.id])).rows[0];
      expect(run).toMatchObject({ status: 'blocked', delivery_started_at: null });
      return;
    }
    expect(sentMessages).toHaveLength(scenario === 'retry after rejection' ? 2 : 1);
    expect(sentMessages[0]!.text).toContain('Họp Sprint');
    expect(sentMessages[0]!.text).toContain('https://meet.google.com/spr-int-123');
    expect(sentMessages[0]!.text).toContain('Phòng 302');
    expect(sentMessages[0]!.text).toContain('Fix Calendar Sync');
  });

  it('enriches mysheets with KPI row metrics (Done / In Progress / Pending) and detects overlapping calendar conflicts in TelegramDigestRunner', async () => {
    await credRepo.saveCredentials(
      'telegram',
      encryptCredentials(
        {
          telegramUserId: '777888999',
          username: 'nguyenvana',
          displayName: 'Nguyen Van A',
          selectedChats: [
            { chatId: '777888999', title: 'Telegram của tôi (Nguyen Van A)', type: 'private' },
          ],
        },
        ENCRYPTION_KEY,
      ),
      USER_ID,
    );
    await credRepo.saveCredentials(
      'mycalendar',
      encryptCredentials(
        {
          email: 'runner.cal@example.com',
          refreshToken: 'refresh-cal-1',
          allowedScope: { calendars: ['runner.cal@example.com'] },
        },
        ENCRYPTION_KEY,
      ),
      USER_ID,
    );
    const savedSheetsCred = await credRepo.saveCredentials(
      'mysheets',
      encryptCredentials(
        {
          email: 'runner.sheets@example.com',
          refreshToken: 'refresh-sheets-1',
          selectedSpreadsheets: [{ id: 'sheet_kpi_1', title: 'KPI Sprint 5', canEdit: true }],
          allowedScope: { spreadsheets: ['sheet_kpi_1'] },
        },
        ENCRYPTION_KEY,
      ),
      USER_ID,
    );
    const savedTgCred = await credRepo.getPersonalCredentials('telegram', USER_ID);

    const config: TelegramDigestConfig = {
      credentialId: savedTgCred!.id,
      telegramUserId: '777888999',
      username: 'nguyenvana',
      chatId: '777888999',
      chatTitle: 'Telegram của tôi (Nguyen Van A)',
      sources: [
        {
          service: 'mysheets',
          tool: 'mysheets.list_spreadsheets',
          label: 'Google Sheets của bạn',
          mysheetsBinding: {
            credentialId: savedSheetsCred.id,
            email: 'runner.sheets@example.com',
            spreadsheetIds: ['sheet_kpi_1'],
            truncated: false,
          },
        },
        await mycalendarSource(),
      ],
      recurrence: { type: 'daily', time: '08:00' },
      timeZone: 'Asia/Ho_Chi_Minh',
    };

    await seedDigestSchedule(config);
    const sentMessages: Array<{ chatId: string; text: string }> = [];

    const digestRunner = new TelegramDigestRunner({
      pool,
      credentialRepo: credRepo,
      encryptionKey: ENCRYPTION_KEY,
      adapterFactory: {
        getAdapterForService: async (serviceName: string) => {
          if (serviceName === 'mysheets') {
            return {
              execute: async (toolName: string, args: any) => {
                if (toolName === 'mysheets.list_spreadsheets') {
                  return [{ id: 'sheet_kpi_1', name: 'KPI Sprint 5' }];
                }
                if (toolName === 'mysheets.read_range' && args.spreadsheetId === 'sheet_kpi_1') {
                  return {
                    headers: ['Công việc', 'Trạng thái'],
                    records: [
                      { 'Công việc': 'Tối ưu cổng thanh toán', 'Trạng thái': 'Done' },
                      { 'Công việc': 'Tích hợp Telegram 2 chiều', 'Trạng thái': 'Đang làm' },
                      { 'Công việc': 'Kiểm thử tải hệ thống', 'Trạng thái': 'Quá hạn' },
                    ],
                    values: [
                      ['Công việc', 'Trạng thái'],
                      ['Tối ưu cổng thanh toán', 'Done'],
                      ['Tích hợp Telegram 2 chiều', 'Đang làm'],
                      ['Kiểm thử tải hệ thống', 'Quá hạn'],
                    ],
                  };
                }
                return [];
              },
            };
          }
          if (serviceName === 'mycalendar') {
            return {
              execute: async () => ({
                events: [
                  {
                    id: 'ev_a',
                    title: 'Họp Sprint Planning',
                    start: '2026-11-02T09:00:00+07:00',
                    end: '2026-11-02T10:00:00+07:00',
                    url: 'https://calendar.google.com/event?eid=a',
                  },
                  {
                    id: 'ev_b',
                    title: 'Demo Khách Hàng VIP',
                    start: '2026-11-02T09:30:00+07:00',
                    end: '2026-11-02T10:30:00+07:00',
                    url: 'https://calendar.google.com/event?eid=b',
                  },
                ],
              }),
            };
          }
          if (serviceName === 'telegram') {
            return {
              execute: async (_tool: string, args: any) => {
                sentMessages.push(args);
                return { messageId: 903 };
              },
            };
          }
          throw new Error(`Unexpected service ${serviceName}`);
        },
      } as any,
      botClient: { getChatMember: async () => true },
      timeZone: 'Asia/Ho_Chi_Minh',
    });

    const runner = new ScheduleRunner({
      pool,
      timeZone: 'Asia/Ho_Chi_Minh',
      encryptionKey: ENCRYPTION_KEY,
      now: () => now,
      planRun: async () => {
        throw new Error('Should not call planRun');
      },
      executeDigestRun: (run, signal) => digestRunner.execute(run, signal),
      recordState: (client, row, at) => service.recordState(client, row, at),
    });

    await runner.tick();

    expect(sentMessages).toHaveLength(1);
    const text = sentMessages[0]!.text;
    expect(text).toContain('KPI Sprint 5');
    expect(text).toContain('✅ Xong: 1');
    expect(text).toContain('🔄 Đang làm: 1');
    expect(text).toContain('⚠️ Chờ/Quá hạn: 1');
    expect(text).toContain('Tối ưu cổng thanh toán [Done]');
    expect(text).toContain('⚠️ [Trùng lịch: Demo Khách Hàng VIP]');
  });

  it('hardens multi-source mycalendar & calendar args, empty-scope fail-closed, auth pause, truncation, timezone conflict detection, and candidate lookup', async () => {
    const win = { sinceIso: '2026-11-02T00:00:00.000Z', untilIso: '2026-11-03T00:00:00.000Z' };
    const orgCalArgs = buildTelegramDigestSourceArgs(
      { service: 'calendar', tool: 'calendar.list_events', label: 'Lịch nhóm' },
      win,
    );
    expect(orgCalArgs.callArgs).toEqual({
      timeMin: win.sinceIso,
      timeMax: win.untilIso,
      limit: 20,
    });
    expect(orgCalArgs.callArgs).not.toHaveProperty('maxResults');

    const personalCalArgs = buildTelegramDigestSourceArgs(
      { service: 'mycalendar', tool: 'mycalendar.list_events', label: 'Lịch cá nhân' },
      win,
    );
    expect(personalCalArgs.callArgs).not.toHaveProperty('calendarId');

    // Candidate lookup fails closed when mycalendarLookup is explicitly empty/missing
    const noCalTg = evaluateTelegramDigestCandidate({
      proposal: {
        kind: 'schedule',
        action: 'create',
        name: 'Digest',
        request: 'Tổng hợp Calendar gửi Telegram',
        recurrence: { type: 'daily', time: '08:00' },
        summary: 'Test',
      },
      services: ['mycalendar', 'telegram'],
      timeZone: 'Asia/Ho_Chi_Minh',
      telegramLookup: {
        status: 'connected',
        selectedChats: [{ chatId: '777', title: 'Me', type: 'private' }],
        connection: {
          credentialId: 'tg-1',
          telegramUserId: '777',
          username: 'user',
          chatIds: ['777'],
        },
      },
      mycalendarLookup: null,
    });
    expect(noCalTg.canAutoDigest).toBe(false);

    const emptyScopeSlack = await evaluateSlackDigestCandidate({
      proposal: {
        kind: 'schedule',
        action: 'create',
        name: 'Digest',
        request: 'Tổng hợp Calendar gửi #general',
        recurrence: { type: 'daily', time: '08:00' },
        summary: 'Test',
      },
      services: ['mycalendar', 'slack'],
      timeZone: 'Asia/Ho_Chi_Minh',
      userId: USER_ID,
      slackCredentialId: 'slack-fixture',
      mycalendarLookup: {
        credentialId: randomUUID(),
        email: 'runner.cal@example.com',
        allowedCalendars: [],
      },
      getAdapter: async () => ({ execute: async () => [{ id: 'C_GENERAL', name: 'general' }] }),
    });
    expect(emptyScopeSlack.canAutoDigest).toBe(false);

    // 1. Disconnected / empty-scope mycalendar in executeMultiDigestReadSources fails closed without calling adapter with 'primary'
    let adapterCalled = false;
    const blockedNoScope = await executeMultiDigestReadSources({
      sources: [{ service: 'mycalendar', tool: 'mycalendar.list_events', label: 'Google Calendar cá nhân' }],
      userId: USER_ID,
      dueAt: new Date('2026-11-02T08:00:00.000Z'),
      sinceIso: win.sinceIso,
      untilIso: win.untilIso,
      credentialRepo: credRepo,
      encryptionKey: ENCRYPTION_KEY,
      adapterFactory: {
        getAdapterForService: async () => ({
          execute: async () => {
            adapterCalled = true;
            return { events: [] };
          },
        }),
      },
      signal: new AbortController().signal,
    });
    expect(adapterCalled).toBe(false);
    expect(blockedNoScope.kind).toBe('blocked');
    if (blockedNoScope.kind === 'blocked') {
      expect(blockedNoScope.pauseSchedule).toBe(true);
    }

    // Seed active mycalendar with 1 calendar & verify AUTH_ERROR -> blocked + truncated + America/New_York overlap + calendar.list_calendars fallback
    await credRepo.saveCredentials(
      'mycalendar',
      encryptCredentials(
        {
          email: 'runner.cal@example.com',
          refreshToken: 'refresh-cal-1',
          allowedScope: { calendars: ['runner.cal@example.com'] },
        },
        ENCRYPTION_KEY,
      ),
      USER_ID,
    );

    const authErrOutcome = await executeMultiDigestReadSources({
      sources: [await mycalendarSource()],
      userId: USER_ID,
      dueAt: new Date('2026-11-02T08:00:00.000Z'),
      sinceIso: win.sinceIso,
      untilIso: win.untilIso,
      credentialRepo: credRepo,
      encryptionKey: ENCRYPTION_KEY,
      adapterFactory: {
        getAdapterForService: async () => ({
          execute: async () => {
            throw new StepError({ message: 'Google token revoked', category: 'AUTH_ERROR', statusCode: 401 });
          },
        }),
      },
      signal: new AbortController().signal,
    });
    expect(authErrOutcome.kind).toBe('blocked');

    const nyOutcome = await executeMultiDigestReadSources({
      sources: [
        await mycalendarSource(),
        { service: 'calendar', tool: 'calendar.list_events', label: 'Lịch nhóm' },
      ],
      userId: USER_ID,
      dueAt: new Date('2026-11-02T14:00:00.000Z'),
      sinceIso: win.sinceIso,
      untilIso: win.untilIso,
      timeZone: 'America/New_York',
      credentialRepo: credRepo,
      encryptionKey: ENCRYPTION_KEY,
      adapterFactory: {
        getAdapterForService: async (svc: string) => {
          if (svc === 'mycalendar') {
            return {
              execute: async () => ({
                events: [
                  { id: 'allday-1', title: 'All-Day NY', start: '2026-11-02', end: '2026-11-03' },
                  { id: 'late-ny', title: 'Late Call NY', start: '2026-11-02T22:00:00-05:00', end: '2026-11-02T23:00:00-05:00' },
                ],
                coverage: { complete: false, returned: 2, totalAvailable: 50 },
              }),
            };
          }
          return {
            execute: async (tool: string, args: any) => {
              if (tool === 'calendar.list_events' && !args.calendarId) {
                throw new StepError({ message: 'calendarId is required', category: 'VALIDATION', retryable: false });
              }
              if (tool === 'calendar.list_calendars') {
                return [{ id: 'team@group.calendar.google.com', summary: 'Team' }];
              }
              if (tool === 'calendar.list_events' && args.calendarId === 'team@group.calendar.google.com') {
                return [{ id: 'org-1', summary: 'Team Sync', start: '2026-11-02T10:00:00-05:00', end: '2026-11-02T11:00:00-05:00' }];
              }
              throw new Error(`Unexpected ${tool}`);
            },
          };
        },
      },
      signal: new AbortController().signal,
    });
    expect(nyOutcome.kind).toBe('ok');
    if (nyOutcome.kind === 'ok') {
      expect(nyOutcome.sourceStatuses[0]?.truncated).toBe(true);
      expect(nyOutcome.sections[0]).toContain('⚠️ [Trùng lịch:');
      expect(nyOutcome.sourceStatuses[1]?.status).toBe('ok');
      expect(nyOutcome.sections[1]).toContain('Team Sync');
    }
  });
});
