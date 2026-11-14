import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { GlobalRateLimiter, TelegramAdapter } from '@wap/tool-adapters';
import { GMAIL_MODIFY_SCOPE } from '@wap/tool-schemas';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { AdapterFactory } from '../../src/services/adapter-factory.js';
import { GmailTokenManager } from '../../src/services/gmail/token-manager.js';
import { ScheduleService } from '../../src/services/schedules/schedule-service.js';
import { reconcileScheduleRuns, ScheduleRunner } from '../../src/services/schedules/schedule-runner.js';
import { TelegramDigestRunner } from '../../src/services/schedules/telegram-digest-runner.js';

const shutdownMarkerPath = process.env.WORKER_SHUTDOWN_MARKER_PATH;
const allowCleanExit = process.env.WORKER_ALLOW_CLEAN_EXIT === '1';

function recordGracefulHandler(tag: string) {
  if (!shutdownMarkerPath || allowCleanExit) return;
  try {
    writeFileSync(shutdownMarkerPath, `${tag}:${process.pid}:${new Date().toISOString()}\n`, {
      flag: 'a',
    });
  } catch {
    // Ignore marker write error in test worker.
  }
}

process.on('SIGTERM', () => {
  recordGracefulHandler('SIGTERM');
  process.exit(143);
});
process.on('SIGINT', () => {
  recordGracefulHandler('SIGINT');
  process.exit(130);
});
process.on('beforeExit', () => {
  recordGracefulHandler('beforeExit');
});
process.on('exit', (code) => {
  recordGracefulHandler(`exit:${code}`);
});

async function notifyCheckpoint(providerBaseUrl: string, stage: string, extra: Record<string, unknown> = {}) {
  await fetch(`${providerBaseUrl}/checkpoint`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pid: process.pid, stage, ...extra }),
  });
}

async function main() {
  const databaseUrl = process.env.WORKER_DATABASE_URL!;
  const providerBaseUrl = process.env.WORKER_PROVIDER_BASE_URL!;
  const encryptionKey = process.env.WORKER_ENCRYPTION_KEY!;
  const gmailClientId = process.env.WORKER_GMAIL_CLIENT_ID!;
  const nowIso = process.env.WORKER_NOW_ISO!;
  const mode = process.env.WORKER_MODE ?? 'tick'; // 'tick' | 'reconcile_and_tick' | 'reconcile_only'
  const holdStage = process.env.WORKER_HOLD_STAGE ?? ''; // '' | 'after_digest_execute_before_runner_persist' | 'after_runner_commit'

  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 6,
    application_name: `gmail_m315_worker_${process.pid}`,
  });

  try {
    await notifyCheckpoint(providerBaseUrl, 'worker_started', { mode });

    if (mode === 'reconcile_and_tick' || mode === 'reconcile_only') {
      await reconcileScheduleRuns(pool);
      await notifyCheckpoint(providerBaseUrl, 'reconcile_completed');
      if (mode === 'reconcile_only') {
        return;
      }
    }

    const credRepo = new CredentialRepo(pool, encryptionKey);
    const tokenManager = new GmailTokenManager({
      client: {
        refresh: async (refreshToken, signal) => {
          const res = await fetch(`${providerBaseUrl}/oauth/refresh`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ refreshToken, pid: process.pid }),
            signal,
          });
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
            throw new Error(String(body.error ?? `OAuth refresh HTTP ${res.status}`));
          }
          const data = (await res.json()) as {
            accessToken: string;
            expiresInSeconds?: number;
            scopes?: string[];
          };
          return {
            accessToken: data.accessToken,
            expiresInSeconds: data.expiresInSeconds ?? 3600,
            scopes: data.scopes ?? [GMAIL_MODIFY_SCOPE],
          };
        },
      },
      credentials: credRepo,
      clientId: gmailClientId,
      encryptionKey,
    });

    const fastLimiter = new GlobalRateLimiter({ maxRequests: 500, windowMs: 1000 });
    const adapterFactory = new AdapterFactory({
      credentialRepo: credRepo,
      encryptionKey,
      gmailTokens: tokenManager,
      createGmailAdapter: ({ userId, tokens }) => ({
        execute: async (tool: string, args: Record<string, unknown>, execCtx?: { signal?: AbortSignal }) => {
          const accessToken = await tokens.getAccessToken({ signal: execCtx?.signal });
          const res = await fetch(`${providerBaseUrl}/gmail/execute`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ pid: process.pid, userId, tool, args }),
            signal: execCtx?.signal,
          });
          if (!res.ok) {
            throw new Error(`Gmail HTTP ${res.status}`);
          }
          return res.json();
        },
      }),
      createTelegramAdapter: ({ telegramUserId, allowedChats, knownChats }) =>
        new TelegramAdapter({
          credentials: { botToken: '123456789:fixture_only_telegram_token' },
          telegramUserId,
          allowedScope: { chats: allowedChats },
          knownChats,
          baseUrl: `${providerBaseUrl}/telegram`,
          rateLimiter: fastLimiter,
          chatRateLimiter: fastLimiter,
          groupRateLimiter: fastLimiter,
          fetchFn: (url, init) => fetch(url, init),
        }),
    });

    const scheduleService = new ScheduleService({
      pool,
      timeZone: 'Asia/Ho_Chi_Minh',
      encryptionKey,
      gmailOAuthClientId: gmailClientId,
    } as any);

    const digestRunner = new TelegramDigestRunner({
      pool,
      credentialRepo: credRepo,
      encryptionKey,
      gmailOAuthClientId: gmailClientId,
      adapterFactory,
      timeZone: 'Asia/Ho_Chi_Minh',
      summarizeWithAi: async (prompt, signal) => {
        const res = await fetch(`${providerBaseUrl}/llm/summarize`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pid: process.pid, prompt }),
          signal,
        });
        if (!res.ok) return null;
        const body = (await res.json()) as { summary?: string | null };
        return body.summary ?? null;
      },
    });

    const scheduleRunner = new ScheduleRunner({
      pool,
      timeZone: 'Asia/Ho_Chi_Minh',
      encryptionKey,
      gmailOAuthClientId: gmailClientId,
      now: () => new Date(nowIso),
      planRun: async () => {
        throw new Error('Unexpected manual planRun in Gmail digest crash worker');
      },
      executeDigestRun: async (run, signal) => {
        const outcome = await digestRunner.execute(run, signal);
        if (holdStage === 'after_digest_execute_before_runner_persist') {
          await notifyCheckpoint(providerBaseUrl, 'after_digest_execute_before_runner_persist', {
            runId: run.runId,
            outcomeStatus: outcome.status,
          });
        }
        return outcome;
      },
      recordState: (client, row, at) => scheduleService.recordState(client, row, at),
    });

    await scheduleRunner.tick();

    if (holdStage === 'after_runner_commit') {
      await notifyCheckpoint(providerBaseUrl, 'after_runner_commit');
    } else {
      await notifyCheckpoint(providerBaseUrl, 'tick_completed');
    }
  } finally {
    await pool.end().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
