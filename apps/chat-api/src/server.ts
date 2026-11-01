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
  WorkspaceRepo,
  JiraWorkspaceRepo,
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
import { evaluateCalendarDigestCandidate } from './services/schedules/calendar-digest-candidate.js';
import { createCalendarDigestExecutor } from './services/schedules/calendar-digest-runner.js';
import { createGithubDigestRunner, type RunGithubDigest } from './services/schedules/github-digest-runner.js';
import { AdapterFactory, type AdapterContext } from './services/adapter-factory.js';
import { GmailConnectionRepo } from './db/repositories/gmail-connection-repo.js';
import { GmailOAuthClient } from './services/gmail/oauth-client.js';
import { GmailTokenManager } from './services/gmail/token-manager.js';
import { createGmailConnectionLookup, createMyCalendarConnectionLookup, createMySheetsConnectionLookup } from './services/gmail/connection-reference.js';
import { TrelloTokenManager } from './services/trello/token-manager.js';
import { TrelloOAuthClient } from './services/trello/oauth-client.js';
import { TrelloTeamRepo } from './db/repositories/trello-team-repo.js';
import { StepError } from '@wap/tool-adapters';
import { createTrelloConnectionLookup } from './services/trello/connection-reference.js';
import { GitHubTokenManager } from './services/github/token-manager.js';
import { GitHubOAuthClient } from './services/github/oauth-client.js';
import { GitHubTeamRepo } from './db/repositories/github-team-repo.js';
import { createGitHubConnectionLookup } from './services/github/connection-reference.js';
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
  let workspaceRepo: any = null;
  let jiraWorkspaceRepo: JiraWorkspaceRepo | null = null;

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
    credRepo = new CredentialRepo(pool, env.ENCRYPTION_KEY);
    workspaceRepo = new WorkspaceRepo(pool);
    jiraWorkspaceRepo = new JiraWorkspaceRepo(pool);

    if (env.RUNTIME_MODE === 'live') {
      const seededAdmin = await userRepo.findByEmail('admin@wap.local');
      if (seededAdmin && (seededAdmin.id === DEMO_ADMIN_ID || verifyPassword('password123', seededAdmin.password))) {
        throw new Error('Insecure demo admin account exists; rotate or remove it before live startup');
      }
    }
  } catch (err: any) {
    if (!mayUseMemoryStorage(env.RUNTIME_MODE)) throw err;
    const unavailablePool = pool;
    pool = null;
    userRepo = null;
    workspaceRepo = null;
    jiraWorkspaceRepo = null;
    await unavailablePool?.end();
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
  let digestRunnerImpl: RunGithubDigest | undefined;
  const schedules = createScheduleRuntime({
    enabled: env.SCHEDULES_ENABLED,
    pool: pool && userRepo ? pool : null,
    timeZone: env.APP_TIME_ZONE,
    encryptionKey: env.ENCRYPTION_KEY,
    planRun: (run, convId, signal) => chatService.planScheduledRun(run, convId, signal),
    runDigest: pool
      ? createCalendarDigestExecutor({
          pool,
          encryptionKey: env.ENCRYPTION_KEY,
          timeZone: env.APP_TIME_ZONE,
          getAdapter: (serviceName, context) =>
            (gatherAdapterFactory ?? realAdapterFactory).getAdapterForService(serviceName, context),
        })
      : undefined,
    runGithubDigest: (run, convId, signal) => {
      if (!digestRunnerImpl) throw new Error('Digest runner is not ready');
      return digestRunnerImpl(run, convId, signal);
    },
    emit: (convId, event, payload) => sseManager.emitEvent(convId, event, payload),
  });
  if (env.SCHEDULES_ENABLED && !schedules) console.warn('\x1b[33m[chat-api] SCHEDULES_ENABLED=on nhưng không có PostgreSQL: lịch chạy tạm tắt.\x1b[0m');
  if (schedules) await schedules.reconcile();

  // Gmail, MyCalendar and MySheets need the flag, their own OAuth client and PostgreSQL; otherwise none of it exists.
  const gmailAvailable = Boolean(env.GMAIL_ENABLED && env.GMAIL_OAUTH && pool && userRepo);
  const mycalendarAvailable = Boolean(env.MYCALENDAR_ENABLED && env.MYCALENDAR_OAUTH && pool && userRepo);
  const mysheetsAvailable = Boolean(env.MYSHEETS_ENABLED && env.MYSHEETS_OAUTH && pool && userRepo);
  const trelloAvailable = Boolean(env.TRELLO_OAUTH && pool);
  const trelloOAuthClient = trelloAvailable ? new TrelloOAuthClient(env.TRELLO_OAUTH!) : undefined;
  const trelloTeamRepo = pool ? new TrelloTeamRepo(pool) : undefined;
  const trelloTokens = trelloAvailable ? new TrelloTokenManager({
    client: trelloOAuthClient!,
    credentials: credRepo,
    onReconnectRequired: (userId) => realAdapterFactory.clearPersonal(userId),
  }) : undefined;
  const trelloLookup = trelloAvailable && trelloTeamRepo && trelloTokens && trelloOAuthClient
    ? createTrelloConnectionLookup({
        credentialRepo: credRepo,
        teamRepo: trelloTeamRepo,
        encryptionKey: env.ENCRYPTION_KEY,
        tokens: trelloTokens,
        client: trelloOAuthClient,
      })
    : undefined;
  // The canned sandbox plan still creates a Trello card when PostgreSQL or the
  // OAuth client is absent. board_frontend is the board the browser grounding
  // fixture stores list_frontend_todo on. A real lookup replaces this stand-in.
  const sandboxTrelloConnection = env.RUNTIME_MODE === 'sandbox' && !trelloLookup
    ? async () => ({
        status: 'connected' as const,
        teamBoards: [
          { boardId: 'b1', boardName: 'Sprint Board' },
          { boardId: 'b2', boardName: 'Bug Tracker' },
          { boardId: 'board_frontend', boardName: 'Frontend' },
        ],
        connection: {
          credentialId: 'sandbox-trello',
          memberId: 'sandbox-member',
          username: 'sandbox',
          boardIds: ['b1', 'b2', 'board_frontend'],
        },
      })
    : undefined;
  const trelloConnection = trelloLookup ?? sandboxTrelloConnection;

  const githubAvailable = Boolean(env.GITHUB_OAUTH && pool);
  const githubOAuthClient = githubAvailable ? new GitHubOAuthClient(env.GITHUB_OAUTH!) : undefined;
  const githubTeamRepo = pool ? new GitHubTeamRepo(pool) : undefined;
  const githubTokens = githubAvailable ? new GitHubTokenManager({
    client: githubOAuthClient!,
    credentials: credRepo,
    onReconnectRequired: (userId) => realAdapterFactory.clearPersonal(userId),
  }) : undefined;
  const githubLookup = githubAvailable && githubTeamRepo && githubTokens && githubOAuthClient
    ? createGitHubConnectionLookup({
        credentialRepo: credRepo,
        teamRepo: githubTeamRepo,
        encryptionKey: env.ENCRYPTION_KEY,
        tokens: githubTokens,
        client: githubOAuthClient,
      })
    : undefined;
  const sandboxGitHubConnection = env.RUNTIME_MODE === 'sandbox' && !githubLookup
    ? async () => ({
        status: 'connected' as const,
        teamRepos: [
          { repoId: '100', fullName: 'owner/repo', name: 'repo' },
          { repoId: '101', fullName: 'nhom/ati', name: 'ati' },
          { repoId: '102', fullName: 'octo/repo', name: 'repo' },
          { repoId: '103', fullName: 'wap/platform', name: 'platform' },
        ],
        memberRepos: [
          { repoId: '100', fullName: 'owner/repo', name: 'repo' },
          { repoId: '101', fullName: 'nhom/ati', name: 'ati' },
          { repoId: '102', fullName: 'octo/repo', name: 'repo' },
          { repoId: '103', fullName: 'wap/platform', name: 'platform' },
        ],
        connection: {
          credentialId: 'sandbox-github',
          githubUserId: 'sandbox-gh-user',
          login: 'sandbox-octo',
          repos: ['owner/repo', 'nhom/ati', 'octo/repo', 'wap/platform'],
        },
      })
    : undefined;
  const githubConnection = githubLookup ?? sandboxGitHubConnection;

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
  const gatherSearch = async ({
    tool,
    args,
    signal,
    actor,
  }: {
    tool: string;
    args: Record<string, unknown>;
    signal?: AbortSignal;
    actor?: { userId: string; workspaceId?: string | null; workspaceMode?: 'legacy' | 'personal' | 'organization' };
  }) => {
    if (!gatherAdapterFactory) throw new Error('Gather adapter factory is not ready');
    const serviceName = tool.split('.')[0]!;
    // Lookups during planning use the planning member's own connection and active workspace context.
    const defaultMode = workspaceRepo ? ('personal' as const) : undefined;
    const adapter = await gatherAdapterFactory.getAdapterForService(serviceName, {
      userId: actor?.userId,
      phase: 'planning',
      workspaceMode: actor?.workspaceMode ?? defaultMode,
      ...(actor?.workspaceId !== undefined ? { workspaceId: actor.workspaceId } : {}),
    });
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
  const plannerFor = async (actor?: {
    userId: string;
    workspaceId?: string | null;
    workspaceMode?: 'legacy' | 'personal' | 'organization';
  }) => new AIPlanner({
    provider: env.RUNTIME_MODE === 'sandbox' && (process.env.SANDBOX_SCENARIO === 'gmail' || process.env.SANDBOX_SCENARIO === 'mycalendar' || process.env.SANDBOX_SCENARIO === 'mysheets') ? createSandboxProvider(process.env.SANDBOX_SCENARIO) : provider,
    toolCatalog: await runtimeToolCatalog(env.RUNTIME_MODE, credRepo, env.ENCRYPTION_KEY, {
      userId: actor?.userId,
      workspaceMode: actor?.workspaceMode ?? (workspaceRepo ? 'personal' : undefined),
      workspaceId: actor?.workspaceId,
      gmailEnabled: gmailAvailable,
      mycalendarEnabled: mycalendarAvailable,
      mysheetsEnabled: mysheetsAvailable,
      trelloEnabled: trelloAvailable,
      trelloTeamRepo,
      trelloOAuthClient,
      trelloTokens,
      trelloConnection,
      githubEnabled: githubAvailable,
      githubTeamRepo,
      githubOAuthClient,
      githubTokens,
      githubConnection,
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
    routeSchedule: async (
      request: string,
      actor: { userId: string; workspaceId?: string | null; workspaceMode?: 'legacy' | 'personal' | 'organization' }
    ) => (await plannerFor(actor)).routeSchedule(request),
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
    workspaceRepo,
    planner: planner as any,
    eventEmitter: chatEventEmitter,
    gmailConnection: gmailAvailable ? createGmailConnectionLookup(credRepo, env.ENCRYPTION_KEY) : undefined,
    mycalendarConnection: mycalendarAvailable ? createMyCalendarConnectionLookup(credRepo, env.ENCRYPTION_KEY) : undefined,
    mysheetsConnection: mysheetsAvailable
      ? createMySheetsConnectionLookup(credRepo, env.ENCRYPTION_KEY, (userId) =>
          (gatherAdapterFactory ?? realAdapterFactory).getAdapterForService('mysheets', { userId, phase: 'planning' })
        )
      : undefined,
    trelloConnection,
    githubConnection,
    getAdapter: (serviceName, context) => (gatherAdapterFactory ?? realAdapterFactory).getAdapterForService(serviceName, context),
    schedules: schedules
      ? {
          repo: schedules.service.repo,
          timeZone: env.APP_TIME_ZONE,
          evaluateDigestCandidate: pool
            ? async (input) =>
                (
                  await evaluateCalendarDigestCandidate({
                    pool,
                    encryptionKey: env.ENCRYPTION_KEY,
                    userId: input.userId,
                    request: input.request,
                    services: input.services,
                  })
                ).candidate
            : undefined,
        }
      : undefined,
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
    trelloTokens,
    trelloTeamRepo,
    trelloOAuthClient,
    trelloApiBaseUrl: env.TRELLO_OAUTH?.apiBaseUrl,
    createTrelloAdapter: env.RUNTIME_MODE === 'sandbox' ? ({ allowedBoardIds }) => {
      const sandbox = createSandboxAdapter('trello');
      return {
        execute: async (tool, args, ctx) => {
          const targetBoardId = ctx?.boardId ?? args?.boardId;
          if (targetBoardId && !allowedBoardIds.includes(String(targetBoardId))) {
            throw new StepError({ category: 'AUTH_ERROR', message: 'Bảng không nằm trong phạm vi được phép.' });
          }
          return sandbox.execute(tool, args, ctx);
        },
      };
    } : undefined,
    githubTokens,
    githubTeamRepo,
    githubOAuthClient,
    githubApiBaseUrl: env.GITHUB_OAUTH?.apiBaseUrl,
    createGitHubAdapter: env.RUNTIME_MODE === 'sandbox' ? ({ allowedRepos }) => {
      const sandbox = createSandboxAdapter('github');
      const allowedLower = new Set(allowedRepos.map((r) => r.toLowerCase()));
      return {
        execute: async (tool, args, ctx) => {
          const targetRepo = ctx?.repo ?? args?.repo;
          if (targetRepo && !allowedLower.has(String(targetRepo).toLowerCase())) {
            throw new StepError({ category: 'AUTH_ERROR', message: 'Repository không nằm trong phạm vi được phép.' });
          }
          return sandbox.execute(tool, args, ctx);
        },
      };
    } : undefined,
  });

  const adapterFactory = createToolRuntimeFactory(env.RUNTIME_MODE,
    (serviceName, context) => sandboxTrelloConnection && serviceName === 'trello'
      ? Promise.resolve(createSandboxAdapter('trello'))
      : sandboxGitHubConnection && serviceName === 'github'
        ? Promise.resolve(createSandboxAdapter('github'))
        : realAdapterFactory.getAdapterForService(serviceName, context),
    (serviceName) => createSandboxAdapter(serviceName));
  gatherAdapterFactory = adapterFactory;
  if (pool) {
    digestRunnerImpl = createGithubDigestRunner({
      pool,
      githubConnection,
      getAdapter: (serviceName, context) => adapterFactory.getAdapterForService(serviceName, context),
    });
  }

  // 6. ExecutionService
  const executionService = new ExecutionService({
    planRepo,
    stepRepo,
    convRepo,
    workspaceRepo,
    adapterFactory,
    sseManager,
  });

  if (!env.EMAIL_ENABLED) console.warn('\x1b[33m[chat-api] Chưa cấu hình SMTP: đăng ký, xác minh email và quên mật khẩu tạm tắt (503).\x1b[0m');

  // 7. Express App
  const app = createApp({
    jwtSecret: env.JWT_SECRET,
    runtimeMode: env.RUNTIME_MODE,
    userRepo,
    adminUserRepo: pool && userRepo ? new AdminUserRepo(pool) : undefined,
    workspaceRepo,
    jiraWorkspaceRepo: jiraWorkspaceRepo ?? undefined,
    pool: pool ?? undefined,
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
    onCredentialsChanged: (service, workspaceId, userId) => realAdapterFactory.clearCache(service, workspaceId, userId),
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
    trello: {
      oauth: trelloAvailable ? env.TRELLO_OAUTH : undefined,
      onConnectionChanged: (userId: string) => {
        realAdapterFactory.clearPersonal(userId);
        trelloTokens?.clear(userId);
      },
      tokens: trelloTokens,
      teamRepo: trelloTeamRepo,
    },
    trelloTokens,
    trelloTeamRepo,
    github: {
      oauth: githubAvailable ? env.GITHUB_OAUTH : undefined,
      onConnectionChanged: (userId: string) => {
        realAdapterFactory.clearPersonal(userId);
        githubTokens?.clear(userId);
      },
      tokens: githubTokens,
      teamRepo: githubTeamRepo,
    },
    githubTokens,
    githubTeamRepo,
    chatService,
    sseManager,
    executionService,
    schedules: schedules ? { service: schedules.service, emit: (convId, event, payload) => sseManager.emitEvent(convId, event, payload) } : undefined,
  });

  const host = env.RUNTIME_MODE === 'sandbox' ? '127.0.0.1' : '0.0.0.0';
  app.listen(port, host, () => {
    console.log(`\x1b[32m[chat-api] ✓ Server đang lắng nghe tại http://${host}:${port}\x1b[0m`);
    console.log(`\x1b[36m[chat-api] ✓ Health check: http://${host}:${port}/api/health\x1b[0m`);
    schedules?.runner.start();
  });
}

bootstrap().catch((err) => {
  console.error('[chat-api] Lỗi khởi động:', err);
  process.exit(1);
});
