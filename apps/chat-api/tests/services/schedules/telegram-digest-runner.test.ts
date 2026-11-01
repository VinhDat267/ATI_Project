import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { encryptCredentials } from '@wap/tool-adapters';
import { CredentialRepo } from '../../../src/db/repositories/credential-repo.js';
import { ScheduleService } from '../../../src/services/schedules/schedule-service.js';
import { ScheduleRunner } from '../../../src/services/schedules/schedule-runner.js';
import { computeTelegramDigestConfigHash } from '../../../src/services/schedules/telegram-digest-candidate.js';
import { TelegramDigestRunner } from '../../../src/services/schedules/telegram-digest-runner.js';
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
    return res.rows[0];
  }

  it('executes multi-source read digest (with partial error fallback) and sends 1 Telegram message, recording digest_sent and delivery JSONB', async () => {
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
        { service: 'github', tool: 'github.list_issues', args: { state: 'open' }, label: 'GitHub Issues đang mở' },
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
              return { messageId: 901, chatId: args.chatId, date: 1793581230 };
            },
          };
        }
        throw new Error(`Unexpected service ${serviceName}`);
      }),
    };

    const digestRunner = new TelegramDigestRunner({
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
    expect(sentMessages[0]!.text).toContain('Sửa lỗi OAuth Telegram');
    expect(sentMessages[0]!.text).toContain('Lịch nhóm hôm nay');

    const runRows = (await pool.query('SELECT * FROM schedule_runs WHERE schedule_id = $1', [sched.id])).rows;
    expect(runRows).toHaveLength(1);
    expect(runRows[0].status).toBe('digest_sent');
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

  it('marks run as digest_failed and pauses schedule when digest_config_hash mismatches or user is no longer a group member, with 0 Telegram sends', async () => {
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
        { service: 'github', tool: 'github.list_issues', args: { state: 'open' }, label: 'GitHub Issues đang mở' },
      ],
      recurrence: { type: 'daily', time: '08:00' },
      timeZone: 'Asia/Ho_Chi_Minh',
    };

    const sched = await seedDigestSchedule(config);
    const telegramExecute = vi.fn();

    const digestRunner = new TelegramDigestRunner({
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
    expect(runRows[0].status).toBe('digest_failed');
    expect(runRows[0].delivery).toBeNull();

    const updatedSched = (await pool.query('SELECT * FROM schedules WHERE id = $1', [sched.id])).rows[0];
    expect(updatedSched.status).toBe('paused');
  });
});
