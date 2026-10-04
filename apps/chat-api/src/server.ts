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
import { createRuntimeAdapterFactory, createRuntimePlanner, mayUseMemoryStorage } from './config/runtime-policy.js';
import { SSEManager } from './sse/sse-manager.js';
import { ChatService } from './services/chat-service.js';
import { ExecutionService } from './services/execution-service.js';
import { reconcileInterruptedExecutions } from './services/startup-reconciliation.js';
import { AdapterFactory } from './services/adapter-factory.js';
import { getConfiguredToolCatalog } from './services/registered-services.js';
import {
  AIPlanner,
  createProviderFromEnv,
} from '@wap/planner';
import { ALL_TOOLS } from '@wap/tool-schemas';
import { createSandboxAdapter } from './sandbox/index.js';
import { createSandboxProvider, createBackupSandboxProvider } from './sandbox/scenarios.js';
import { createApp } from './app.js';

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

  let gatherAdapterFactory: { getAdapterForService: (serviceName: string) => Promise<any> | any } | null = null;
  const gatherSearch = async ({ tool, args, signal }: { tool: string; args: Record<string, unknown>; signal?: AbortSignal }) => {
    if (!gatherAdapterFactory) throw new Error('Gather adapter factory is not ready');
    const serviceName = tool.split('.')[0]!;
    const adapter = await gatherAdapterFactory.getAdapterForService(serviceName);
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

  const planner = createRuntimePlanner(env.RUNTIME_MODE,
    async (input: any) => new AIPlanner({
      provider,
      toolCatalog: env.RUNTIME_MODE === 'live'
        ? await getConfiguredToolCatalog(credRepo, env.ENCRYPTION_KEY)
        : ALL_TOOLS,
      gatherSearch,
      requireGroundedResources: env.RUNTIME_MODE === 'live',
      timeZone: env.APP_TIME_ZONE,
      searchMode: env.PLANNER_SEARCH_MODE,
    }).processMessage(input),
    (input: any) => backupPlanner.processMessage(input));

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
  });

  // 5. Adapter Factory (Supports both real credentials & mock execution)
  const realAdapterFactory = new AdapterFactory({
    credentialRepo: credRepo,
    encryptionKey: env.ENCRYPTION_KEY,
  });

  const adapterFactory = createRuntimeAdapterFactory(env.RUNTIME_MODE,
    (serviceName: string) => realAdapterFactory.getAdapterForService(serviceName),
    (serviceName: string) => createSandboxAdapter(serviceName));
  gatherAdapterFactory = adapterFactory;

  // 6. ExecutionService
  const executionService = new ExecutionService({
    planRepo,
    stepRepo,
    convRepo,
    adapterFactory,
    sseManager,
  });

  // 7. Express App
  const app = createApp({
    jwtSecret: env.JWT_SECRET,
    runtimeMode: env.RUNTIME_MODE,
    userRepo,
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
    chatService,
    sseManager,
    executionService,
  });

  const host = env.RUNTIME_MODE === 'sandbox' ? '127.0.0.1' : '0.0.0.0';
  app.listen(port, host, () => {
    console.log(`\x1b[32m[chat-api] ✓ Server đang lắng nghe tại http://${host}:${port}\x1b[0m`);
    console.log(`\x1b[36m[chat-api] ✓ Health check: http://${host}:${port}/api/health\x1b[0m`);
  });
}

bootstrap().catch((err) => {
  console.error('[chat-api] Lỗi khởi động:', err);
  process.exit(1);
});
