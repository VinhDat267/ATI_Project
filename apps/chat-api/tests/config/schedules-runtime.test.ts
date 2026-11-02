import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encryptCredentials } from '@wap/tool-adapters';
import { createScheduleRuntime } from '../../src/config/schedules-runtime.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { computeSheetsDigestHash } from '../../src/services/schedules/sheets-digest-candidate.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

const TEST_ENC_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('createScheduleRuntime', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  beforeAll(async () => { db = await createMigratedSchema('schedule_runtime'); });
  afterAll(async () => { await db?.close(); });

  it('creates nothing when the flag is off or there is no PostgreSQL', () => {
    expect(createScheduleRuntime({ enabled: false, pool: db.pool, timeZone: 'Asia/Ho_Chi_Minh' })).toBeUndefined();
    expect(createScheduleRuntime({ enabled: true, pool: null, timeZone: 'Asia/Ho_Chi_Minh' })).toBeUndefined();
  });

  it('fails runs until the planner is connected, without calling a model', async () => {
    const runtime = createScheduleRuntime({ enabled: true, pool: db.pool, timeZone: 'Asia/Ho_Chi_Minh', now: () => new Date('2026-10-25T01:00:30.000Z') })!;
    const owner = await db.person();
    const convId = (await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [owner.id])).rows[0].id;
    const id = (await db.pool.query(`INSERT INTO schedules(user_id,conv_id,name,request,recurrence,services,status,next_run_at)
      VALUES($1,$2,'Lịch','Gửi lịch họp','{"type":"daily","time":"08:00"}','{calendar,slack}','active','2026-10-25T01:00:00Z') RETURNING id`, [owner.id, convId])).rows[0].id;
    await runtime.runner.tick();
    expect((await db.pool.query('SELECT status FROM schedule_runs WHERE schedule_id=$1', [id])).rows).toEqual([{ status: 'planning_failed' }]);
    await runtime.runner.stop();
  });

  it('auto-wires SheetsDigestRunner when credentialRepo, encryptionKey, and createSheetsDigestAdapter are provided', async () => {
    const owner = await db.person();
    const credentialRepo = new CredentialRepo(db.pool, TEST_ENC_KEY);
    const mysheetsCred = await credentialRepo.upsertPersonalCredentials({
      service: 'mysheets',
      userId: owner.id,
      config: encryptCredentials(
        {
          email: 'owner@example.com',
          refreshToken: 'rt_1',
          selectedSpreadsheets: [{ id: 'sheet_rt_1', name: 'KPI Sprint', canEdit: true }],
          allowedScope: { spreadsheets: ['sheet_rt_1'] },
        },
        TEST_ENC_KEY
      ),
    });
    await credentialRepo.upsertCredentials(
      'slack',
      encryptCredentials(
        { botToken: 'xoxb-test', allowedScope: { channels: ['C0123456'] } },
        TEST_ENC_KEY
      )
    );

    const runtime = createScheduleRuntime({
      enabled: true,
      pool: db.pool,
      timeZone: 'Asia/Ho_Chi_Minh',
      encryptionKey: TEST_ENC_KEY,
      credentialRepo,
      mysheetsEnabled: true,
      now: () => new Date('2026-10-25T01:00:30.000Z'),
      createSheetsDigestAdapter: async (serviceId) => ({
        execute: async (toolName) => {
          if (serviceId === 'mysheets' && toolName === 'mysheets.read_range') {
            return {
              headers: ['Hạng mục', 'Trạng thái'],
              records: [{ 'Hạng mục': 'Task 1', 'Trạng thái': 'Done' }],
              values: [['Hạng mục', 'Trạng thái'], ['Task 1', 'Done']],
            };
          }
          return { ok: true };
        },
      }),
    })!;

    const convId = (await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [owner.id])).rows[0].id;
    const recurrence = { type: 'daily' as const, time: '08:00' };
    const digestConfig = {
      version: 1 as const,
      source: {
        service: 'mysheets' as const,
        spreadsheetId: 'sheet_rt_1',
        spreadsheetTitle: 'KPI Sprint',
        tailRows: 20,
        credentialId: mysheetsCred.id,
        email: 'owner@example.com',
      },
      destination: {
        service: 'slack' as const,
        channelId: 'C0123456',
      },
      includeAiSummary: false,
    };
    const digestHash = computeSheetsDigestHash({ userId: owner.id, recurrence, config: digestConfig });
    const id = (
      await db.pool.query(
        `INSERT INTO schedules(user_id,conv_id,name,request,recurrence,services,status,next_run_at,kind,digest_config,digest_config_hash,digest_approved_at)
         VALUES($1,$2,'Báo cáo KPI','Gửi báo cáo KPI','{"type":"daily","time":"08:00"}','{mysheets,slack}','active','2026-10-25T01:00:00Z','sheets_digest',$3::jsonb,$4,now()) RETURNING id`,
        [owner.id, convId, JSON.stringify(digestConfig), digestHash]
      )
    ).rows[0].id;

    await runtime.runner.tick();
    expect((await db.pool.query('SELECT status FROM schedule_runs WHERE schedule_id=$1', [id])).rows).toEqual([
      { status: 'digest_sent' },
    ]);
    await runtime.runner.stop();
  });
});
