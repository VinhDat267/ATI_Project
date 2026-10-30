import { EventEmitter } from 'node:events';
import { createMemoryConversationRepositories } from './db/repositories/memory-conversations.js';
import { validateEnv } from './config/env.js';
import { getPool } from './db/pool.js';
import {
  ConversationRepo,
  MessageRepo,
  PlanRepo,
  StepRepo,
  CredentialRepo,
  UserRepo,
} from './db/repositories/index.js';
import { DEMO_ADMIN_ID } from './routes/auth-routes.js';
import { verifyPassword } from './db/repositories/user-repo.js';
import { createRuntimePlanner, mayUseMemoryStorage } from './config/runtime-policy.js';
import { createToolRuntimeFactory, gmailServiceRegistry, runtimeToolCatalog, runtimeGmailAdapter, runtimeMyCalendarAdapter, runtimeMySheetsAdapter, runtimeMySheetsEndpoints, serviceRegistryForRuntime, mayFallbackToShared, runtimePlannerSearchMode } from './config/gmail-tools-runtime.js';
import { SSEManager } from './sse/sse-manager.js';
import { ChatService } from './services/chat-service.js';
import { ExecutionService } from './services/execution-service.js';
import { reconcileInterruptedExecutions } from './services/startup-reconciliation.js';
import { createScheduleRuntime } from './config/schedules-runtime.js';
import { AdapterFactory, type AdapterContext } from './services/adapter-factory.js';
import { GmailConnectionRepo } from './db/repositories/gmail-connection-repo.js';
import { SlackConnectionRepo } from './db/repositories/slack-connection-repo.js';
import { SlackSourceRepo } from './db/repositories/slack-source-repo.js';
import { SlackInvalidationService } from './services/slack/slack-invalidation-service.js';
import { SlackPolicyEventConsumer } from './services/slack/slack-policy-event-consumer.js';
import { SlackInvalidationRunner } from './services/slack/slack-invalidation-runner.js';
import { SlackMessagePurgeConsumer } from './services/slack/slack-message-purge-consumer.js';
import { SlackEventReceiptRepo } from './db/repositories/slack-event-receipt-repo.js';
import { SlackIngressService } from './services/slack/slack-ingress-service.js';
import { slackIngressEnv } from './config/slack-ingress-env.js';
import { createSlackLifecycleRuntime } from './services/slack/slack-lifecycle-runtime.js';
import { GmailOAuthClient } from './services/gmail/oauth-client.js';
import { GmailTokenManager } from './services/gmail/token-manager.js';
import { createGmailConnectionLookup, createMyCalendarConnectionLookup, createMySheetsConnectionLookup } from './services/gmail/connection-reference.js';
import {
  AIPlanner,
  createProviderFromEnv,
} from '@wap/planner';
import { ALL_TOOLS } from '@wap/tool-schemas';
import { createSandboxAdapter } from './sandbox/index.js';
import { createSandboxProvider, createBackupSandboxProvider } from './sandbox/scenarios.js';
import { createApp } from './app.js';
import { AdminUserRepo } from './db/repositories/admin-user-repo.js';
import { createEmailSender } from './services/email/index.js';

async function bootstrap() {
  const env = validateEnv();
  const port = env.PORT || 3000;
  console.log(`\x1b[36m[chat-api]\x1b[0m Khởi động AI Workflow Platform v3 API trên cổng ${port}...`);

  const sseManager = new SSEManager();
  const events = new EventEmitter();
  events.on('error', (err: any) => {
    console.warn('\x1b[33m[chat-api] Warning: Background planning error captured:\x1b[0m', err?.message || err);
  });

  // 1. Try to connect to PostgreSQL
  let pool = null;
  let userRepo: any = null;
  let convRepo: any = null;
  let msgRepo: any = null;
  let planRepo: any = null;
  let stepRepo: any = null;
  let credRepo: any = null;

  try {
    const dbUrl = env.DATABASE_URL;
    pool = getPool({ connectionString: dbUrl });
    // Quick test query to verify connectivity
    await pool.query('SELECT 1');
    console.log(`\x1b[32m[chat-api]\x1b[0m Đã kết nối thành công tới PostgreSQL database (ati_v3)!`);

    userRepo = new UserRepo(pool);
    convRepo = new ConversationRepo(pool);
    msgRepo = new MessageRepo(pool);
    planRepo = new PlanRepo(pool);
    stepRepo = new StepRepo(pool);
    credRepo = new CredentialRepo(pool);

    if (env.RUNTIME_MODE === 'live') {
      const seededAdmin = await userRepo.findByEmail('admin@wap.local');
      if (seededAdmin && (seededAdmin.id === DEMO_ADMIN_ID || verifyPassword('password123', seededAdmin.password))) {
        throw new Error('Insecure demo admin account exists; rotate or remove it before live startup');
      }
    }
  } catch (err: any) {
    if (!mayUseMemoryStorage(env.RUNTIME_MODE)) throw err;
    console.warn(
      `\x1b[33m[chat-api]\x1b[0m PostgreSQL không khả dụng (${err?.message || 'offline'}). Tự động chuyển sang chế độ Lưu trữ In-Memory phát triển.`
    );

    // In-memory fallback repositories
    const { convRepo: memoryConvRepo, msgRepo: memoryMsgRepo, convMap } = createMemoryConversationRepositories();
    convRepo = memoryConvRepo;
    msgRepo = memoryMsgRepo;
    const planMap = new Map<string, any>();
    const stepMap = new Map<string, any>();

    const setMemoryPlanStatus = (plan: any, status: string) => {
      plan.status = status;
      plan.revision = String(Number(plan.revision) + 1);
    };
    planRepo = {
      createPlan: async (data: any) => {
        const id = `plan_${Date.now()}`;
        for (const previous of planMap.values()) {
          if (previous.conv_id === data.convId && previous.status === 'pending') setMemoryPlanStatus(previous, 'superseded');
        }
        const row = { id, conv_id: data.convId, plan_json: data.planJson, resource_labels: data.resourceLabels ?? {}, plan_text: data.planText || JSON.stringify(data.planJson), plan_hash: data.planHash, status: 'pending', expires_at: data.expiresAt, decided_at: null, created_at: new Date(), revision: '1' };
        planMap.set(id, row);
        return { ...row };
      },
      getPlan: async (id: string) => {
        const plan = planMap.get(id);
        return plan ? { ...plan } : null;
      },
      getPendingPlan: async (convId: string) => {
        for (const p of planMap.values()) {
          if (p.conv_id === convId && p.status === 'pending' && new Date(p.expires_at).getTime() > Date.now()) return { ...p };
        }
        return null;
      },
      getLatestExecutedPlan: async (convId: string) => {
        const statuses = ['approved', 'executing', 'stopping', 'partial', 'unknown', 'reconciliation_required', 'completed', 'stopped', 'failed'];
        const plans = [...planMap.values()].filter(p => p.conv_id === convId && statuses.includes(p.status));
        plans.sort((a, b) => b.created_at.getTime() - a.created_at.getTime() || b.id.localeCompare(a.id));
        return plans[0] ? { ...plans[0] } : null;
      },
      approvePlan: async (planId: string, expectedHash: string, userId: string) => {
        const p = planMap.get(planId);
        if (!p || p.plan_hash !== expectedHash || convMap.get(p.conv_id)?.user_id !== userId
          || p.status !== 'pending' || new Date(p.expires_at).getTime() <= Date.now()) return false;
        p.decided_at = new Date();
        setMemoryPlanStatus(p, 'approved');
        return true;
      },
      rejectPlan: async (planId: string, userId: string) => {
        const p = planMap.get(planId);
        if (!p || convMap.get(p.conv_id)?.user_id !== userId || p.status !== 'pending'
          || new Date(p.expires_at).getTime() <= Date.now()) return false;
        p.decided_at = new Date();
        setMemoryPlanStatus(p, 'rejected');
        return true;
      },
      updatePlanStatus: async (planId: string, status: string) => {
        const p = planMap.get(planId);
        if (p) setMemoryPlanStatus(p, status);
      },
      claimRecovery: async (snapshot: any, userId: string, nextStatus: 'executing' | 'stopped') => {
        const p = planMap.get(snapshot.id);
        if (!p || !p.decided_at || convMap.get(p.conv_id)?.user_id !== userId
          || p.plan_hash !== snapshot.plan_hash || p.status !== snapshot.status || p.revision !== snapshot.revision
          || !['partial', 'reconciliation_required'].includes(p.status)) return false;
        setMemoryPlanStatus(p, nextStatus);
        return true;
      },
    };

    stepRepo = {
      createStep: async (data: any) => {
        const id = `step_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const row = { id, plan_id: data.planId, step_id: data.stepId, tool: data.tool,
          args_json: data.argsJson ?? {}, requested_by: data.requestedBy || 'system', status: 'pending',
          output_json: null, error_json: null, started_at: null, completed_at: null, duration_ms: null };
        stepMap.set(id, row);
        return row;
      },
      updateStepStatus: async (id: string, status: string, outputJson?: any, errorJson?: any, durationMs?: number) => {
        const s = stepMap.get(id);
        if (s) {
          s.status = status;
          if (outputJson != null) s.output_json = outputJson;
          if (status === 'running' || status === 'succeeded') s.error_json = errorJson ?? null;
          else if (errorJson != null) s.error_json = errorJson;
          if (status === 'running') {
            s.started_at = new Date();
            s.completed_at = null;
            s.duration_ms = null;
          } else {
            if (['succeeded', 'failed', 'skipped', 'unknown'].includes(status)) s.completed_at = new Date();
            if (durationMs != null) s.duration_ms = durationMs;
            else if (['succeeded', 'failed', 'unknown'].includes(status) && s.started_at) {
              s.duration_ms = s.completed_at.getTime() - s.started_at.getTime();
            }
          }
        }
        return s;
      },
      listSteps: async (planId: string) => Array.from(stepMap.values()).filter(s => s.plan_id === planId)
        .sort((a, b) => a.step_id.localeCompare(b.step_id)),
    };

    credRepo = {
      getCredentials: async () => null,
      setCredentials: async () => {},
      listConfiguredServices: async () => [],
    };
  }

  // Reconciliation failures must abort startup, including sandbox mode: never
  // fall back to memory after failing to reconcile an available database.
  if (pool && userRepo) await reconcileInterruptedExecutions(pool);

  // Schedules need the flag and PostgreSQL; with the flag off nothing below exists.
  // A run is planned by chatService, created below; the runner starts only after listen.
  const schedules = createScheduleRuntime({
    enabled: env.SCHEDULES_ENABLED, pool: pool && userRepo ? pool : null, timeZone: env.APP_TIME_ZONE,
    planRun: (run, convId, signal) => chatService.planScheduledRun(run, convId, signal),
    emit: (convId, event, payload) => sseManager.emitEvent(convId, event, payload),
  });
  if (env.SCHEDULES_ENABLED && !schedules) console.warn('\x1b[33m[chat-api] SCHEDULES_ENABLED=on nhưng không có PostgreSQL: lịch chạy tạm tắt.\x1b[0m');
  if (schedules) await schedules.reconcile();

  // Gmail, MyCalendar and MySheets need the flag, their own OAuth client and PostgreSQL; otherwise none of it exists.
  const gmailAvailable = Boolean(env.GMAIL_ENABLED && env.GMAIL_OAUTH && pool && userRepo);
  const mycalendarAvailable = Boolean(env.MYCALENDAR_ENABLED && env.MYCALENDAR_OAUTH && pool && userRepo);
  const mysheetsAvailable = Boolean(env.MYSHEETS_ENABLED && env.MYSHEETS_OAUTH && pool && userRepo);

  // 2. Initialize LLM Provider
  let provider: any;
  if (env.RUNTIME_MODE === 'live') {
    provider = createProviderFromEnv(process.env);
    console.log(`\x1b[32m[chat-api]\x1b[0m Sử dụng LLM provider '${provider.name}' với model ${provider.model}.`);
  } else {
    console.log(
      `\x1b[33m[chat-api]\x1b[0m GEMINI_API_KEY chưa thiết lập. Sử dụng Smart Mock LLM Planner cho môi trường dev.`
    );
    provider = createSandboxProvider(process.env.SANDBOX_SCENARIO);
  }

  // 3. AI Planner with Resilient Fallback
  const backupMockProvider = createBackupSandboxProvider();

  let gatherAdapterFactory: { getAdapterForService: (serviceName: string, context?: AdapterContext) => Promise<any> | any } | null = null;
  const gatherSearch = async ({ tool, args, signal, actor }: { tool: string; args: Record<string, unknown>; signal?: AbortSignal; actor?: { userId: string } }) => {
    if (!gatherAdapterFactory) throw new Error('Gather adapter factory is not ready');
    const serviceName = tool.split('.')[0]!;
    // Lookups during planning use the planning member's own connection for personal services.
    const adapter = await gatherAdapterFactory.getAdapterForService(serviceName, { userId: actor?.userId, phase: 'planning' });
    return adapter.execute(tool, args, { signal });
  };
  // Sandbox providers return canned plans without reading working memory, so
  // resource grounding would reject every plan; live planning always enforces it.
  const backupPlanner = new AIPlanner({
    provider: backupMockProvider,
    toolCatalog: ALL_TOOLS,
    gatherSearch,
    requireGroundedResources: false,
  });

  // One planner per call: the member's own catalog decides which services are configured.
  const plannerFor = async (actor?: { userId: string }) => new AIPlanner({
    provider: env.RUNTIME_MODE === 'sandbox' && (process.env.SANDBOX_SCENARIO === 'gmail' || process.env.SANDBOX_SCENARIO === 'mycalendar' || process.env.SANDBOX_SCENARIO === 'mysheets') ? createSandboxProvider(process.env.SANDBOX_SCENARIO) : provider,
    toolCatalog: await runtimeToolCatalog(env.RUNTIME_MODE, credRepo, env.ENCRYPTION_KEY, {
      userId: actor?.userId,
      gmailEnabled: gmailAvailable,
      mycalendarEnabled: mycalendarAvailable,
      mysheetsEnabled: mysheetsAvailable,
    }),
    serviceRegistry: serviceRegistryForRuntime(gmailAvailable, mycalendarAvailable, mysheetsAvailable),
    gatherSearch,
    requireGroundedResources: env.RUNTIME_MODE === 'live',
    timeZone: env.APP_TIME_ZONE,
    searchMode: runtimePlannerSearchMode(env.RUNTIME_MODE, env.PLANNER_SEARCH_MODE, process.env.SANDBOX_SCENARIO),
    readAnswers: env.PLANNER_READ_ANSWERS,
    schedules: Boolean(schedules),
  });
  const planner = {
    ...createRuntimePlanner(env.RUNTIME_MODE,
      async (input: any) => (await plannerFor(input?.actor)).processMessage(input),
      (input: any) => {
        if (!mayFallbackToShared(input, gmailAvailable, mycalendarAvailable, mysheetsAvailable)) throw new Error('Personal service planning failed');
        return backupPlanner.processMessage(input);
      }),
    routeSchedule: async (request: string, actor: { userId: string }) => (await plannerFor(actor)).routeSchedule(request),
  };

  // 4. ChatService Event Bridge to SSE
  const chatEventEmitter = {
    emit: (event: string, payload: any) => {
      const convId = payload.conversationId;
      if (convId) {
        sseManager.emitEvent(convId, event, payload);
      }
      events.emit(event, payload);
    },
  };

  const chatService = new ChatService({
    msgRepo,
    convRepo,
    planRepo,
    planner: planner as any,
    eventEmitter: chatEventEmitter,
    gmailConnection: gmailAvailable ? createGmailConnectionLookup(credRepo, env.ENCRYPTION_KEY) : undefined,
    mycalendarConnection: mycalendarAvailable ? createMyCalendarConnectionLookup(credRepo, env.ENCRYPTION_KEY) : undefined,
    mysheetsConnection: mysheetsAvailable
      ? createMySheetsConnectionLookup(credRepo, env.ENCRYPTION_KEY, (userId) =>
          (gatherAdapterFactory ?? realAdapterFactory).getAdapterForService('mysheets', { userId, phase: 'planning' })
        )
      : undefined,
    getAdapter: (serviceName, context) => (gatherAdapterFactory ?? realAdapterFactory).getAdapterForService(serviceName, context),
    schedules: schedules ? { repo: schedules.service.repo, timeZone: env.APP_TIME_ZONE } : undefined,
  });

  // 5. Adapter Factory (Supports both real credentials & mock execution)
  if (env.GMAIL_ENABLED && !gmailAvailable) console.warn('\x1b[33m[chat-api] GMAIL_ENABLED=on nhưng thiếu cấu hình Gmail hoặc PostgreSQL: kết nối Gmail tạm tắt (503).\x1b[0m');
  if (env.MYCALENDAR_ENABLED && !mycalendarAvailable) console.warn('\x1b[33m[chat-api] MYCALENDAR_ENABLED=on nhưng thiếu cấu hình MyCalendar hoặc PostgreSQL: kết nối MyCalendar tạm tắt (503).\x1b[0m');
  if (env.MYSHEETS_ENABLED && !mysheetsAvailable) console.warn('\x1b[33m[chat-api] MYSHEETS_ENABLED=on nhưng thiếu cấu hình MySheets hoặc PostgreSQL: kết nối MySheets tạm tắt (503).\x1b[0m');

  let realAdapterFactory: AdapterFactory;
  const gmailTokens = gmailAvailable ? new GmailTokenManager({
    client: new GmailOAuthClient(env.GMAIL_OAUTH!),
    credentials: credRepo,
    service: 'gmail',
    onReconnectRequired: (userId) => realAdapterFactory.clearPersonal(userId),
  }) : undefined;
  const mycalendarTokens = mycalendarAvailable ? new GmailTokenManager({
    client: new GmailOAuthClient(env.MYCALENDAR_OAUTH!),
    credentials: credRepo,
    service: 'mycalendar',
    onReconnectRequired: (userId) => realAdapterFactory.clearPersonal(userId),
  }) : undefined;
  const mysheetsTokens = mysheetsAvailable ? new GmailTokenManager({
    client: new GmailOAuthClient(env.MYSHEETS_OAUTH!),
    credentials: credRepo,
    service: 'mysheets',
    onReconnectRequired: (userId) => realAdapterFactory.clearPersonal(userId),
  }) : undefined;

  realAdapterFactory = new AdapterFactory({
    credentialRepo: credRepo,
    encryptionKey: env.ENCRYPTION_KEY,
    gmailTokens,
    createGmailAdapter: gmailAvailable ? ({ tokens }) => runtimeGmailAdapter(env.RUNTIME_MODE, tokens, env.GMAIL_OAUTH!.apiBaseUrl) : undefined,
    mycalendarTokens,
    createMyCalendarAdapter: mycalendarAvailable ? (input) => runtimeMyCalendarAdapter(env.RUNTIME_MODE, input, env.MYCALENDAR_OAUTH!.apiBaseUrl) : undefined,
    mysheetsTokens,
    createMySheetsAdapter: mysheetsAvailable ? (input) => runtimeMySheetsAdapter(env.RUNTIME_MODE, input, env.MYSHEETS_OAUTH!.apiBaseUrl) : undefined,
  });

  const adapterFactory = createToolRuntimeFactory(env.RUNTIME_MODE,
    (serviceName, context) => realAdapterFactory.getAdapterForService(serviceName, context),
    (serviceName) => createSandboxAdapter(serviceName));
  gatherAdapterFactory = adapterFactory;

  // 6. ExecutionService
  const executionService = new ExecutionService({
    planRepo,
    stepRepo,
    convRepo,
    adapterFactory,
    sseManager,
  });

  if (!env.EMAIL_ENABLED) console.warn('\x1b[33m[chat-api] Chưa cấu hình SMTP: đăng ký, xác minh email và quên mật khẩu tạm tắt (503).\x1b[0m');

  // 7. Slack Invalidation & Source Store Runtime
  const slackInvalidationService = pool ? new SlackInvalidationService(pool) : undefined;
  const slackSourceRepo = pool ? new SlackSourceRepo(pool) : undefined;
  const slackPolicyEventConsumer = (pool && slackInvalidationService && slackSourceRepo)
    ? new SlackPolicyEventConsumer(pool, slackInvalidationService, slackSourceRepo)
    : undefined;
  const slackInvalidationRunner = (slackSourceRepo && slackInvalidationService && slackPolicyEventConsumer)
    ? new SlackInvalidationRunner(slackSourceRepo, slackInvalidationService, slackPolicyEventConsumer, {
        sweepIntervalMs: 5000,
        batchSize: 50,
        messagePurgeConsumer: pool ? new SlackMessagePurgeConsumer(pool) : undefined,
      })
    : undefined;

  // Signed ingress is mounted whenever PostgreSQL is available. A missing Slack configuration
  // leaves it mounted but fail-closed (503 CONFIG_MISSING), never silently acknowledging events.
  const slackIngressConfig = slackIngressEnv(process.env, env.RUNTIME_MODE === 'live');
  const slackEventReceiptRepo = pool && slackInvalidationService
    ? new SlackEventReceiptRepo(pool, slackInvalidationService)
    : undefined;
  const slackIngress = slackEventReceiptRepo
    ? { service: new SlackIngressService({ config: slackIngressConfig, repo: slackEventReceiptRepo }) }
    : undefined;
  const slackLifecycleRuntime = createSlackLifecycleRuntime({
    pool: pool ?? undefined, encryptionKey: env.ENCRYPTION_KEY, env: process.env, live: env.RUNTIME_MODE === 'live',
    onError: (code) => console.warn('[chat-api]', code),
  });
  if (slackIngressConfig && !slackIngress) {
    console.warn('\x1b[33m[chat-api] MYSLACK_ENABLED=on nhưng chưa có PostgreSQL: Slack signed ingress tạm tắt.\x1b[0m');
  }

  // 8. Express App
  const app = createApp({
    myslack: env.MYSLACK_OAUTH && pool && userRepo ? { oauth: env.MYSLACK_OAUTH, repo: new SlackConnectionRepo(pool, slackInvalidationService) } : undefined,
    jwtSecret: env.JWT_SECRET,
    runtimeMode: env.RUNTIME_MODE,
    userRepo,
    adminUserRepo: pool && userRepo ? new AdminUserRepo(pool) : undefined,
    signupEnabled: env.AUTH_SIGNUP_ENABLED,
    googleSignupEnabled: env.GOOGLE_SIGNUP_ENABLED,
    googleOAuth: env.GOOGLE_OAUTH,
    appBaseUrl: env.APP_BASE_URL,
    emailSender: pool && userRepo && env.EMAIL_ENABLED ? createEmailSender(env, pool) : undefined,
    validateCredentials: !userRepo && env.RUNTIME_MODE === 'sandbox' && process.env.SANDBOX_USER_EMAIL && process.env.SANDBOX_USER_PASSWORD
      ? (email, password) => email === process.env.SANDBOX_USER_EMAIL && password === process.env.SANDBOX_USER_PASSWORD
        ? { id: DEMO_ADMIN_ID, email, name: 'Sandbox User' } : null
      : undefined,
    convRepo,
    msgRepo,
    planRepo,
    credentialRepo: credRepo,
    encryptionKey: env.ENCRYPTION_KEY,
    serviceAdminUserIds: (process.env.SERVICE_ADMIN_USER_IDS || '').split(',').map((id) => id.trim()).filter(Boolean),
    onCredentialsChanged: (service) => realAdapterFactory.clearCache(service),
    gmail: env.GMAIL_ENABLED ? {
      enabled: true,
      oauth: gmailAvailable ? env.GMAIL_OAUTH : undefined,
      repo: gmailAvailable && pool ? new GmailConnectionRepo(pool) : undefined,
      onConnectionChanged: (userId: string) => realAdapterFactory.clearPersonal(userId),
    } : undefined,
    mycalendar: env.MYCALENDAR_ENABLED ? {
      enabled: true,
      oauth: mycalendarAvailable ? env.MYCALENDAR_OAUTH : undefined,
      repo: mycalendarAvailable && pool ? new GmailConnectionRepo(pool, 'mycalendar', 'connect_mycalendar') : undefined,
      onConnectionChanged: (userId: string) => realAdapterFactory.clearPersonal(userId),
    } : undefined,
    mycalendarTokens,
    mysheets: env.MYSHEETS_ENABLED ? {
      enabled: true,
      oauth: mysheetsAvailable ? env.MYSHEETS_OAUTH : undefined,
      repo: mysheetsAvailable && pool ? new GmailConnectionRepo(pool, 'mysheets', 'connect_mysheets') : undefined,
      picker: env.MYSHEETS_PICKER,
      ...runtimeMySheetsEndpoints(env.RUNTIME_MODE, env.MYSHEETS_OAUTH?.apiBaseUrl),
      onConnectionChanged: (userId: string) => realAdapterFactory.clearPersonal(userId),
    } : undefined,
    mysheetsTokens,
    chatService,
    sseManager,
    executionService,
    schedules: schedules ? { service: schedules.service, emit: (convId, event, payload) => sseManager.emitEvent(convId, event, payload) } : undefined,
    slackSourceRepo,
    slackInvalidationService,
    slackInvalidationRunner,
    slackIngress,
  });

  // Receipts are body-free routing metadata kept for 7 days so Slack retries stay idempotent.
  // Unfinished lifecycle validation keeps its receipt until resolved; durable barriers
  // are independent of receipt cleanup.
  const slackReceiptCleanupTimer = slackEventReceiptRepo
    ? setInterval(() => {
        void slackEventReceiptRepo.purgeExpiredReceipts(new Date()).catch((err) => {
          console.warn('\x1b[33m[chat-api] Dọn receipt Slack thất bại:\x1b[0m', err?.message || err);
        });
      }, 6 * 60 * 60 * 1000)
    : undefined;
  slackReceiptCleanupTimer?.unref?.();

  const host = env.RUNTIME_MODE === 'sandbox' ? '127.0.0.1' : '0.0.0.0';
  app.listen(port, host, () => {
    console.log(`\x1b[32m[chat-api] ✓ Server đang lắng nghe tại http://${host}:${port}\x1b[0m`);
    console.log(`\x1b[36m[chat-api] ✓ Health check: http://${host}:${port}/api/health\x1b[0m`);
    schedules?.runner.start();
    slackInvalidationRunner?.start();
    slackLifecycleRuntime?.start();
  });

  const shutdown = async () => {
    schedules?.runner.stop();
    if (slackReceiptCleanupTimer) clearInterval(slackReceiptCleanupTimer);
    await Promise.all([slackInvalidationRunner?.stop(), slackLifecycleRuntime?.stop()]);
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  console.error('[chat-api] Lỗi khởi động:', err);
  process.exit(1);
});
