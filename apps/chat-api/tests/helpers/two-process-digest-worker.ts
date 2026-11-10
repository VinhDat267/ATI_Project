import pg from 'pg';
import { TelegramAdapter } from '@wap/tool-adapters';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { ScheduleService } from '../../src/services/schedules/schedule-service.js';
import { ScheduleRunner } from '../../src/services/schedules/schedule-runner.js';
import { TelegramDigestRunner } from '../../src/services/schedules/telegram-digest-runner.js';

async function main() {
  const databaseUrl = process.env.WORKER_DATABASE_URL!;
  const runId = process.env.WORKER_RUN_ID!;
  const barrierUrl = process.env.WORKER_BARRIER_URL!;
  const telegramBaseUrl = process.env.WORKER_TELEGRAM_BASE_URL!;
  const encryptionKey = process.env.WORKER_ENCRYPTION_KEY!;
  const nowIso = process.env.WORKER_NOW_ISO!;

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
  try {
    const credentials = new CredentialRepo(pool, encryptionKey);
    const service = new ScheduleService({ pool, timeZone: 'Asia/Ho_Chi_Minh' });

    const telegram = new TelegramAdapter({
      credentials: { botToken: '123456789:fixture_only_telegram_token' },
      telegramUserId: '777001',
      allowedScope: { chats: ['777001'] },
      baseUrl: telegramBaseUrl,
      fetchFn: (url, init) => fetch(url, init),
    });

    const digestRunner = new TelegramDigestRunner({
      pool,
      credentialRepo: credentials,
      encryptionKey,
      timeZone: 'Asia/Ho_Chi_Minh',
      adapterFactory: {
        getAdapterForService: async (name: string) => {
          if (name === 'telegram') return telegram;
          return {
            execute: async (tool: string) => {
              if (tool === 'trello.search_cards') {
                await fetch(barrierUrl, { method: 'POST' });
                return [
                  {
                    id: 'card-os-1',
                    name: 'Card from OS worker',
                    due: '2026-11-01T10:00:00.000Z',
                    dueComplete: false,
                    idMembers: ['m1'],
                  },
                ];
              }
              return [];
            },
          };
        },
      },
    });

    const scheduleRunner = new ScheduleRunner({
      pool,
      timeZone: 'Asia/Ho_Chi_Minh',
      now: () => new Date(nowIso),
      planRun: async () => {
        throw new Error('Unexpected manual planRun');
      },
      executeDigestRun: (run, signal) => digestRunner.execute(run, signal),
      recordState: (client, row, at) => service.recordState(client, row, at),
    });

    await scheduleRunner.planNow(runId);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
