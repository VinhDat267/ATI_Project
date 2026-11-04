import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { encryptCredentials } from '@wap/tool-adapters';
import { CredentialRepo } from '../../../src/db/repositories/credential-repo.js';
import { ScheduleService } from '../../../src/services/schedules/schedule-service.js';
import { ScheduleRunner } from '../../../src/services/schedules/schedule-runner.js';
import { computeTelegramDigestConfigHash, READ_DIGEST_SOURCE_MAP } from '../../../src/services/schedules/telegram-digest-candidate.js';
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

  it('resolves user allowedCalendars for mycalendar.list_events (instead of hardcoded "primary") and formats meetLink/location in multi-service Telegram digest', async () => {
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
        { service: 'mycalendar', tool: 'mycalendar.list_events', label: 'Google Calendar của bạn hôm nay' },
        { service: 'github', tool: 'github.search_issues', args: { repo: 'acme/ati', query: 'open' }, label: 'GitHub Issues đang mở' },
      ],
      recurrence: { type: 'daily', time: '08:00' },
      timeZone: 'Asia/Ho_Chi_Minh',
    };

    const sched = await seedDigestSchedule(config);
    const sentMessages: Array<{ chatId: string; text: string }> = [];
    let capturedMyCalArgs: any = null;

    const digestRunner = new TelegramDigestRunner({
      pool,
      credentialRepo: credRepo,
      encryptionKey: ENCRYPTION_KEY,
      adapterFactory: {
        getAdapterForService: async (serviceName: string) => {
          if (serviceName === 'mycalendar') {
            return {
              execute: async (_tool: string, args: any) => {
                capturedMyCalArgs = args;
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
            return {
              execute: async (_tool: string, args: any) => {
                sentMessages.push(args);
                return { messageId: 902 };
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
    expect(sentMessages).toHaveLength(1);
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
        },
        {
          service: 'mycalendar',
          tool: 'mycalendar.list_events',
          label: 'Google Calendar của bạn hôm nay',
        },
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
});
