import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encryptCredentials, TelegramAdapter } from '@wap/tool-adapters';
import { createMigratedSchema } from '../../helpers/gmail-test-db.js';
import { CredentialRepo } from '../../../src/db/repositories/credential-repo.js';
import { ScheduleService } from '../../../src/services/schedules/schedule-service.js';
import { ScheduleRunner } from '../../../src/services/schedules/schedule-runner.js';
import { TelegramDigestRunner } from '../../../src/services/schedules/telegram-digest-runner.js';
import { computeTelegramDigestConfigHash } from '../../../src/services/schedules/telegram-digest-candidate.js';
import type { TelegramDigestConfig } from '@wap/tool-schemas';

const KEY = '0123456789abcdef0123456789abcdef';
const NOW = new Date('2026-11-02T01:00:30Z');
const TZ = 'Asia/Ho_Chi_Minh';

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

describe('Telegram digest dispatch cancellation on PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  beforeAll(async () => { db = await createMigratedSchema('telegram_cancel'); });
  afterAll(async () => { await db?.close(); });

  async function fixture(onSend?: () => Promise<void>) {
    const owner = await db.person();
    const service = new ScheduleService({ pool: db.pool, timeZone: TZ });
    const credentials = new CredentialRepo(db.pool, KEY);
    const credential = await credentials.saveCredentials('telegram', encryptCredentials({
      telegramUserId: '777', username: 'tester',
      selectedChats: [{ chatId: '777', title: 'Telegram của tôi', type: 'private' }],
    }, KEY), owner.id);
    const config: TelegramDigestConfig = {
      credentialId: credential.id, telegramUserId: '777', username: 'tester',
      chatId: '777', chatTitle: 'Telegram của tôi',
      sources: [{ service: 'notion', tool: 'notion.search_pages', args: { query: '' }, label: 'Notion' }],
      recurrence: { type: 'daily', time: '08:00' }, timeZone: TZ,
    };
    const conv = (await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [owner.id])).rows[0];
    const schedule = (await db.pool.query(
      `INSERT INTO schedules(user_id,conv_id,name,request,recurrence,services,status,next_run_at,kind,digest_config,digest_config_hash,digest_approved_at)
       VALUES($1,$2,'Digest','Notion Telegram',$3,'{notion,telegram}','active','2026-11-02T01:00:00Z','telegram_digest',$4,$5,now()) RETURNING *`,
      [owner.id, conv.id, JSON.stringify(config.recurrence), JSON.stringify(config), computeTelegramDigestConfigHash(config)],
    )).rows[0];
    const writes: unknown[] = [];
    const telegram = new TelegramAdapter({
      credentials: { botToken: '123456789:fixture_only_telegram_token' },
      telegramUserId: '777', allowedScope: { chats: ['777'] },
      fetchFn: async (url, init) => {
        const method = String(url).split('/').at(-1);
        if (method === 'getChat') return Response.json({ ok: true, result: { id: 777, type: 'private', first_name: 'Tester' } });
        if (method !== 'sendMessage') throw new Error('Unexpected Telegram method');
        writes.push(JSON.parse(String(init?.body)));
        await onSend?.();
        return Response.json({ ok: true, result: { message_id: 901, date: 1793581200, chat: { id: 777, type: 'private' } } });
      },
    });
    return { owner, service, credentials, schedule, writes, telegram };
  }

  it.each(['cancel', 'pause', 'version'] as const)('does not dispatch when %s wins while the source is being read', async (change) => {
    const f = await fixture();
    const entered = barrier(), releaseRead = barrier();
    const digest = new TelegramDigestRunner({
      pool: db.pool,
      credentialRepo: f.credentials, encryptionKey: KEY, timeZone: TZ,
      adapterFactory: { getAdapterForService: async (name) => name === 'telegram' ? f.telegram : {
        execute: async () => { entered.release(); await releaseRead.promise; return [{ title: 'Source' }]; },
      } },
    });
    const runner = new ScheduleRunner({
      pool: db.pool, timeZone: TZ, now: () => NOW,
      planRun: async () => { throw new Error('Unexpected manual plan'); },
      executeDigestRun: (run, signal) => digest.execute(run, signal),
      recordState: (client, row, now) => f.service.recordState(client, row, now),
    });
    const tick = runner.tick();
    await entered.promise;
    try {
      if (change === 'version') await db.pool.query('UPDATE schedules SET version=version+1 WHERE id=$1', [f.schedule.id]);
      else await f.service.setStatus({ userId: f.owner.id, scheduleId: f.schedule.id, action: change, version: 1, now: NOW });
    } finally { releaseRead.release(); }
    await tick;
    expect(f.writes).toEqual([]);
    const run = (await db.pool.query('SELECT status,delivery FROM schedule_runs WHERE schedule_id=$1', [f.schedule.id])).rows[0];
    expect(run).toEqual({ status: 'discarded', delivery: null });
  });

  it('preserves confirmed delivery when cancellation commits after dispatch but before result persistence', async () => {
    const f = await fixture();
    const digest = new TelegramDigestRunner({
      pool: db.pool,
      credentialRepo: f.credentials, encryptionKey: KEY, timeZone: TZ,
      adapterFactory: { getAdapterForService: async (name) => name === 'telegram' ? f.telegram : {
        execute: async () => [{ title: 'Source' }],
      } },
    });
    const runner = new ScheduleRunner({
      pool: db.pool, timeZone: TZ, now: () => NOW,
      planRun: async () => { throw new Error('Unexpected manual plan'); },
      executeDigestRun: async (run, signal) => {
        const outcome = await digest.execute(run, signal);
        await f.service.setStatus({ userId: f.owner.id, scheduleId: f.schedule.id, action: 'cancel', version: 1, now: NOW });
        return outcome;
      },
      recordState: (client, row, now) => f.service.recordState(client, row, now),
    });
    await runner.tick();
    expect(f.writes).toHaveLength(1);
    const run = (await db.pool.query('SELECT status,delivery FROM schedule_runs WHERE schedule_id=$1', [f.schedule.id])).rows[0];
    expect(run.status).toBe('digest_sent');
    expect(run.delivery).toMatchObject({ chatId: '777', messageId: 901 });
  });

  it('holds a real schedule row lock while a Telegram send is in flight', async () => {
    const entered = barrier(), finishSend = barrier();
    const f = await fixture(async () => { entered.release(); await finishSend.promise; });
    const digest = new TelegramDigestRunner({
      pool: db.pool, credentialRepo: f.credentials, encryptionKey: KEY, timeZone: TZ,
      adapterFactory: { getAdapterForService: async name => name === 'telegram' ? f.telegram : { execute: async () => [{ title: 'Source' }] } },
    });
    const runner = new ScheduleRunner({
      pool: db.pool, timeZone: TZ, now: () => NOW,
      planRun: async () => { throw new Error('Unexpected manual plan'); },
      executeDigestRun: (run, signal) => digest.execute(run, signal),
      recordState: (client, row, now) => f.service.recordState(client, row, now),
    });
    const tick = runner.tick();
    await entered.promise;
    const concurrent = await db.pool.connect();
    try {
      await concurrent.query('BEGIN');
      await expect(concurrent.query('SELECT id FROM schedules WHERE id=$1 FOR UPDATE NOWAIT', [f.schedule.id]))
        .rejects.toMatchObject({ code: '55P03' });
    } finally {
      await concurrent.query('ROLLBACK');
      concurrent.release();
      finishSend.release();
      await tick;
    }
    expect(f.writes).toHaveLength(1);
  });
});
