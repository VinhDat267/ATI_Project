import pg from 'pg';
import {
  ConversationRepo,
  CredentialRepo,
  MessageRepo,
  PlanRepo,
  StepRepo,
  WorkspaceRepo,
} from '../../src/db/repositories/index.js';
import { TrelloTeamRepo } from '../../src/db/repositories/trello-team-repo.js';
import {
  runtimeGmailAdapter,
  runtimeMyCalendarAdapter,
  runtimeMySheetsAdapter,
} from '../../src/config/gmail-tools-runtime.js';
import { createScheduleRuntime } from '../../src/config/schedules-runtime.js';
import {
  AdapterFactory,
  PostgresSheetsAppendLeaseStore,
} from '../../src/services/adapter-factory.js';
import { ExecutionService } from '../../src/services/execution-service.js';
import { GmailOAuthClient } from '../../src/services/gmail/oauth-client.js';
import { GmailTokenManager } from '../../src/services/gmail/token-manager.js';
import { createCalendarDigestExecutor } from '../../src/services/schedules/calendar-digest-runner.js';
import { createTrelloDigestRunner } from '../../src/services/schedules/trello-digest-runner.js';
import { TelegramDigestRunner } from '../../src/services/schedules/telegram-digest-runner.js';
import { TelegramBotClient } from '../../src/services/telegram/bot-client.js';
import { createTelegramConnectionLookup } from '../../src/services/telegram/connection-reference.js';
import { createTrelloConnectionLookup } from '../../src/services/trello/connection-reference.js';
import { TrelloOAuthClient } from '../../src/services/trello/oauth-client.js';
import { TrelloTokenManager } from '../../src/services/trello/token-manager.js';
import { createPersonalSheetsAdapter } from '@wap/tool-adapters';

export interface LoopbackFetchTelemetry {
  rewrittenUrls: Array<{ originalUrl: string; loopbackUrl: string; method: string }>;
}

/**
 * Routes hardcoded provider domains (Slack Web API, Google OAuth2 / Sheets / Drive)
 * to the local 127.0.0.1 loopback HTTP fixture server over real TCP sockets while
 * preserving RequestInit (headers, body, AbortSignal) and blocking all external egress.
 */
export function installLoopbackFetchRouter(
  loopbackBaseUrl: string,
  telemetry?: LoopbackFetchTelemetry,
): () => void {
  const originalFetch = globalThis.fetch;
  const base = loopbackBaseUrl.replace(/\/$/, '');

  const routedFetch: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const parsed = new URL(rawUrl);
    const method =
      init?.method ??
      (typeof input === 'object' && !(input instanceof URL) && 'method' in input
        ? input.method
        : 'GET');

    if (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') {
      return originalFetch(input, init);
    }

    let mappedUrl: string | null = null;
    if (parsed.hostname === 'slack.com') {
      mappedUrl = `${base}/slack${parsed.pathname}${parsed.search}`;
    } else if (parsed.hostname === 'oauth2.googleapis.com') {
      mappedUrl = `${base}/google-oauth${parsed.pathname}${parsed.search}`;
    } else if (parsed.hostname === 'sheets.googleapis.com') {
      mappedUrl = `${base}/sheets${parsed.pathname}${parsed.search}`;
    } else if (parsed.hostname === 'www.googleapis.com') {
      mappedUrl = `${base}/google-apis${parsed.pathname}${parsed.search}`;
    } else if (parsed.hostname === 'gmail.googleapis.com') {
      mappedUrl = `${base}/gmail${parsed.pathname}${parsed.search}`;
    } else if (parsed.hostname === 'api.trello.com') {
      mappedUrl = `${base}/trello${parsed.pathname}${parsed.search}`;
    } else if (parsed.hostname === 'api.telegram.org') {
      mappedUrl = `${base}/telegram${parsed.pathname}${parsed.search}`;
    }

    if (!mappedUrl) {
      throw new Error(`FORBIDDEN_EXTERNAL_EGRESS: ${rawUrl}`);
    }

    telemetry?.rewrittenUrls.push({
      originalUrl: rawUrl,
      loopbackUrl: mappedUrl,
      method: method.toUpperCase(),
    });
    return originalFetch(mappedUrl, init);
  };

  globalThis.fetch = routedFetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

export interface CombinedRuntimeOptions {
  pool: pg.Pool;
  encryptionKey: string;
  loopbackBaseUrl: string;
  timeZone?: string;
  now?: () => Date;
  leaseStoreOptions?: {
    pollIntervalMs?: number;
    defaultTtlMs?: number;
    heartbeatIntervalMs?: number;
  };
  calendarReadTimeoutMs?: number;
  calendarSummaryTimeoutMs?: number;
  summarizeCalendar?: (events: any[], signal: AbortSignal) => Promise<string>;
  summarizeSheets?: (prompt: string, signal: AbortSignal) => Promise<string>;
  summarizeTrello?: (input: any, signal: AbortSignal) => Promise<string | null>;
}

export function buildCombinedRuntimeStack(options: CombinedRuntimeOptions) {
  const {
    pool,
    encryptionKey,
    loopbackBaseUrl,
    timeZone = 'Asia/Ho_Chi_Minh',
    now = () => new Date(),
  } = options;
  const base = loopbackBaseUrl.replace(/\/$/, '');

  const credentialRepo = new CredentialRepo(pool, encryptionKey);
  const workspaceRepo = new WorkspaceRepo(pool);
  const convRepo = new ConversationRepo(pool);
  const msgRepo = new MessageRepo(pool);
  const planRepo = new PlanRepo(pool);
  const stepRepo = new StepRepo(pool);
  const trelloTeamRepo = new TrelloTeamRepo(pool);
  const sheetsAppendLeaseStore = new PostgresSheetsAppendLeaseStore(
    pool,
    options.leaseStoreOptions ?? { pollIntervalMs: 15, defaultTtlMs: 10_000 },
  );

  const googleOAuthConfig = {
    clientId: 'disposable-google-client-id',
    clientSecret: 'disposable-google-client-secret',
    redirectUri: `${base}/oauth/callback`,
    authorizationUrl: `${base}/google-oauth/auth`,
    tokenUrl: `${base}/google-oauth/token`,
    userinfoUrl: `${base}/google-oauth/userinfo`,
    revokeUrl: `${base}/google-oauth/revoke`,
  };

  let adapterFactory!: AdapterFactory;

  const gmailTokens = new GmailTokenManager({
    client: new GmailOAuthClient({
      ...googleOAuthConfig,
      apiBaseUrl: `${base}/gmail`,
    }),
    credentials: credentialRepo,
    service: 'gmail',
    onReconnectRequired: (userId) => adapterFactory?.clearPersonal(userId, 'gmail'),
  });

  const mycalendarTokens = new GmailTokenManager({
    client: new GmailOAuthClient({
      ...googleOAuthConfig,
      apiBaseUrl: `${base}/calendar/v3`,
    }),
    credentials: credentialRepo,
    service: 'mycalendar',
    onReconnectRequired: (userId) => adapterFactory?.clearPersonal(userId, 'mycalendar'),
  });

  const mysheetsTokens = new GmailTokenManager({
    client: new GmailOAuthClient({
      ...googleOAuthConfig,
      apiBaseUrl: `${base}/sheets/v4/spreadsheets`,
    }),
    credentials: credentialRepo,
    service: 'mysheets',
    onReconnectRequired: (userId) => adapterFactory?.clearPersonal(userId, 'mysheets'),
  });

  const trelloOAuthClient = new TrelloOAuthClient({
    clientId: 'disposable-trello-client-id',
    clientSecret: 'disposable-trello-client-secret',
    redirectUri: `${base}/trello/callback`,
    authorizationUrl: `${base}/trello/oauth/authorize`,
    tokenUrl: `${base}/trello/oauth/token`,
    apiBaseUrl: `${base}/trello/1`,
  });

  const trelloTokens = new TrelloTokenManager({
    client: trelloOAuthClient,
    credentials: credentialRepo,
    onReconnectRequired: (userId) => adapterFactory?.clearPersonal(userId, 'trello'),
  });

  const trelloConnection = createTrelloConnectionLookup({
    credentialRepo,
    teamRepo: trelloTeamRepo,
    encryptionKey,
    tokens: trelloTokens,
    client: trelloOAuthClient,
  });

  const telegramBotConfig = {
    botToken: '123456789:disposable_loopback_telegram_bot',
    botUsername: 'ati_loopback_bot',
    apiBaseUrl: `${base}/telegram`,
    callbackUrl: `${base}/telegram/callback`,
    deepLinkBaseUrl: `${base}/telegram/link`,
  };
  const telegramBotClient = new TelegramBotClient(telegramBotConfig);
  const telegramConnection = createTelegramConnectionLookup({
    credentialRepo,
    encryptionKey,
    botClient: telegramBotClient,
  });

  adapterFactory = new AdapterFactory({
    credentialRepo,
    encryptionKey,
    gmailTokens,
    createGmailAdapter: ({ tokens }) => runtimeGmailAdapter('live', tokens, `${base}/gmail`),
    mycalendarTokens,
    createMyCalendarAdapter: (input) =>
      runtimeMyCalendarAdapter('live', input, `${base}/calendar/v3/calendars`),
    mysheetsTokens,
    createMySheetsAdapter: (input) =>
      runtimeMySheetsAdapter('live', input, `${base}/sheets/v4/spreadsheets`),
    sheetsAppendLeaseStore,
    trelloTokens,
    trelloTeamRepo,
    trelloOAuthClient,
    trelloApiBaseUrl: `${base}/trello/1`,
    telegramBot: telegramBotConfig,
    telegramBotClient,
  });

  const telegramDigestRunner = new TelegramDigestRunner({
    pool,
    credentialRepo,
    encryptionKey,
    timeZone,
    adapterFactory,
  });

  const trelloDigestRunner = createTrelloDigestRunner({
    pool,
    timeZone,
    trelloConnection,
    telegramConnection,
    getAdapter: (serviceName, context) => adapterFactory.getAdapterForService(serviceName, context),
    summarizeDigest:
      options.summarizeTrello ??
      (async () => 'Tóm tắt điểm nghẽn Trello từ fixture nội bộ.'),
  });

  const calendarDigestExecutor = createCalendarDigestExecutor({
    pool,
    encryptionKey,
    timeZone,
    readTimeoutMs: options.calendarReadTimeoutMs,
    summaryTimeoutMs: options.calendarSummaryTimeoutMs,
    getAdapter: (serviceName, context) => adapterFactory.getAdapterForService(serviceName, context),
    summarizeDigest:
      options.summarizeCalendar ??
      (async (events) =>
        events.length > 0 ? 'Tóm tắt lịch trình trong ngày từ fixture nội bộ.' : ''),
  });

  const sseEvents: Array<{ convId: string; event: string; payload: unknown }> = [];

  const schedules = createScheduleRuntime({
    enabled: true,
    pool,
    timeZone,
    encryptionKey,
    credentialRepo,
    mysheetsEnabled: true,
    emitV2: true,
    now,
    emit: (convId, event, payload) => {
      sseEvents.push({ convId, event, payload });
    },
    createSheetsDigestAdapter: (serviceId, userId, config, scheduleContext) => {
      const workspaceMode = scheduleContext
        ? scheduleContext.workspaceMode
        : 'workspaceMode' in config
          ? config.workspaceMode
          : 'legacy';
      const workspaceId = scheduleContext
        ? scheduleContext.workspaceId
        : 'workspaceId' in config
          ? config.workspaceId
          : null;
      if ('workspaceMode' in config) {
        if (
          config.workspaceMode !== workspaceMode ||
          (config.workspaceId ?? null) !== (workspaceId ?? null)
        ) {
          throw new Error('Schedule workspace context mismatch in createSheetsDigestAdapter');
        }
      }
      return adapterFactory.getAdapterForService(serviceId, {
        userId,
        phase: 'execution',
        workspaceMode,
        ...(workspaceId ? { workspaceId } : {}),
        connections: {
          ...(config.source.service === 'mysheets' && config.source.credentialId
            ? {
                mysheets: {
                  credentialId: config.source.credentialId,
                  email: config.source.email ?? '',
                  allowedSpreadsheets: [config.source.spreadsheetId],
                },
              }
            : {}),
          ...(config.destination.service === 'gmail' && config.destination.credentialId
            ? {
                gmail: {
                  credentialId: config.destination.credentialId,
                  email:
                    'senderEmail' in config.destination && config.destination.senderEmail
                      ? config.destination.senderEmail
                      : '',
                },
              }
            : {}),
          ...(config.destination.service === 'telegram' &&
          'credentialId' in config.destination &&
          config.destination.credentialId
            ? {
                telegram: {
                  credentialId: config.destination.credentialId,
                  telegramUserId: '',
                  username: '',
                  chatIds: [config.destination.chatId],
                },
              }
            : {}),
        },
      });
    },
    summarizeSheetsDigestWithAi:
      options.summarizeSheets ?? (async () => '• KPI doanh thu đạt tiến độ tốt.'),
    runDigest: calendarDigestExecutor,
    runTrelloDigest: trelloDigestRunner,
    executeDigestRun: (run, signal) => telegramDigestRunner.execute(run, signal),
  })!;

  const executionService = new ExecutionService({
    planRepo,
    stepRepo,
    convRepo,
    workspaceRepo,
    credentialRepo,
    pool,
    adapterFactory,
    enforceReportGrounding: false,
    sseManager: {
      emitEvent: (convId, event, payload) => {
        sseEvents.push({ convId, event, payload });
      },
    },
  });

  return {
    credentialRepo,
    workspaceRepo,
    convRepo,
    msgRepo,
    planRepo,
    stepRepo,
    trelloTeamRepo,
    sheetsAppendLeaseStore,
    gmailTokens,
    mycalendarTokens,
    mysheetsTokens,
    trelloTokens,
    trelloOAuthClient,
    trelloConnection,
    telegramBotClient,
    telegramConnection,
    adapterFactory,
    executionService,
    schedules,
    sseEvents,
  };
}

async function runWorkerMain(): Promise<void> {
  const mode = process.env.WORKER_MODE ?? 'tick';
  const databaseUrl = process.env.WORKER_DATABASE_URL!;
  const loopbackBaseUrl = process.env.WORKER_LOOPBACK_URL!;
  const encryptionKey = process.env.WORKER_ENCRYPTION_KEY!;
  const nowIso = process.env.WORKER_NOW_ISO ?? new Date().toISOString();
  const workerName = process.env.WORKER_NAME ?? `worker-${process.pid}`;

  const restoreFetch = installLoopbackFetchRouter(loopbackBaseUrl);
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 6,
    application_name: workerName,
  });

  try {
    if (mode === 'tick') {
      const stack = buildCombinedRuntimeStack({
        pool,
        encryptionKey,
        loopbackBaseUrl,
        now: () => new Date(nowIso),
      });
      await fetch(`${loopbackBaseUrl.replace(/\/$/, '')}/__worker/ready`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pid: process.pid, workerName }),
      });
      await stack.schedules.runner.tick();
      process.stdout.write(
        `${JSON.stringify({ event: 'tick_done', pid: process.pid, workerName })}\n`,
      );
      return;
    }

    if (mode === 'hold_digest_delivery') {
      const stack = buildCombinedRuntimeStack({
        pool,
        encryptionKey,
        loopbackBaseUrl,
        now: () => new Date(nowIso),
      });
      process.stdout.write(
        `${JSON.stringify({ event: 'worker_started', mode, pid: process.pid, workerName })}\n`,
      );
      await stack.schedules.runner.tick();
      process.stdout.write(
        `${JSON.stringify({ event: 'tick_finished_unexpectedly', pid: process.pid })}\n`,
      );
      return;
    }

    if (mode === 'hold_sheets_append') {
      const spreadsheetId = process.env.WORKER_SPREADSHEET_ID!;
      const sheetName = process.env.WORKER_SHEET_NAME ?? 'Tasks';
      const issueKey = process.env.WORKER_ISSUE_KEY ?? 'XSVC#401';
      const ttlMs = Number(process.env.WORKER_LEASE_TTL_MS ?? '400');

      const leaseStore = new PostgresSheetsAppendLeaseStore(pool, {
        defaultTtlMs: ttlMs,
        pollIntervalMs: 15,
        heartbeatIntervalMs: 80,
      });
      const adapter = createPersonalSheetsAdapter({
        userId: process.env.WORKER_USER_ID ?? 'worker-user-s4',
        tokens: { getAccessToken: async () => 'tok-s4-worker' },
        allowedScope: { spreadsheets: [spreadsheetId] },
        apiBaseUrl: `${loopbackBaseUrl.replace(/\/$/, '')}/sheets/v4/spreadsheets`,
        appendLeaseStore: leaseStore,
      });

      process.stdout.write(
        `${JSON.stringify({ event: 'worker_started', mode, pid: process.pid, workerName, ttlMs })}\n`,
      );
      await adapter.execute('mysheets.append_rows', {
        spreadsheetId,
        sheet: sheetName,
        deduplicate: true,
        keyColumn: 'IssueKey',
        rows: [[issueKey, 'Row held mid-append before SIGKILL']],
      });
      return;
    }

    throw new Error(`Unsupported WORKER_MODE: ${mode}`);
  } finally {
    restoreFetch();
    await pool.end().catch(() => {});
  }
}

if (process.argv.includes('--run-worker')) {
  runWorkerMain().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
}
