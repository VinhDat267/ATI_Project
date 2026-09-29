import { EventEmitter } from 'node:events';
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
import { AdapterFactory } from './services/adapter-factory.js';
import { getConfiguredToolCatalog } from './services/registered-services.js';
import {
  AIPlanner,
  GeminiProvider,
  MockLLMProvider,
} from '@wap/planner';
import { ALL_TOOLS } from '@wap/tool-schemas';
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
    const convMap = new Map<string, any>();
    const msgMap = new Map<string, any[]>();
    const planMap = new Map<string, any>();
    const stepMap = new Map<string, any>();

    convRepo = {
      createConversation: async (userId: string) => {
        const id = `conv_${Date.now()}`;
        const row = { id, user_id: userId, title: 'Cuộc hội thoại mới', created_at: new Date(), updated_at: new Date() };
        convMap.set(id, row);
        msgMap.set(id, []);
        return row;
      },
      listConversations: async (userId: string) => Array.from(convMap.values()).filter((c) => c.user_id === userId),
      getConversation: async (id: string) => convMap.get(id) || null,
    };

    msgRepo = {
      createMessage: async (convId: string, role: string, content: string, metadata?: any) => {
        const id = `msg_${Date.now()}`;
        const row = { id, conv_id: convId, role, content, metadata: metadata || null, created_at: new Date() };
        const list = msgMap.get(convId) || [];
        list.push(row);
        msgMap.set(convId, list);
        return row;
      },
      listMessages: async (convId: string) => msgMap.get(convId) || [],
    };

    planRepo = {
      createPlan: async (data: any) => {
        const id = `plan_${Date.now()}`;
        for (const previous of planMap.values()) {
          if (previous.conv_id === data.convId && previous.status === 'pending') previous.status = 'superseded';
        }
        const row = { id, conv_id: data.convId, plan_json: data.planJson, plan_text: JSON.stringify(data.planJson), plan_hash: data.planHash, status: 'pending', expires_at: data.expiresAt, created_at: new Date() };
        planMap.set(id, row);
        return row;
      },
      getPlan: async (id: string) => planMap.get(id) || null,
      getPendingPlan: async (convId: string) => {
        for (const p of planMap.values()) {
          if (p.conv_id === convId && p.status === 'pending') return p;
        }
        return null;
      },
      approvePlan: async (planId: string) => {
        const p = planMap.get(planId);
        if (!p || p.status !== 'pending' || new Date(p.expires_at).getTime() <= Date.now()) return false;
        p.status = 'approved';
        return true;
      },
      rejectPlan: async (planId: string) => {
        const p = planMap.get(planId);
        if (!p || p.status !== 'pending' || new Date(p.expires_at).getTime() <= Date.now()) return false;
        p.status = 'rejected';
        return true;
      },
      updatePlanStatus: async (planId: string, status: string) => {
        const p = planMap.get(planId);
        if (p) p.status = status;
      },
    };

    stepRepo = {
      createStep: async (data: any) => {
        const id = `step_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const row = { id, ...data, status: 'pending' };
        stepMap.set(id, row);
        return row;
      },
      updateStepStatus: async (id: string, status: string, outputJson?: any, errorJson?: any, durationMs?: number) => {
        const s = stepMap.get(id);
        if (s) {
          s.status = status;
          if (outputJson) s.output_json = outputJson;
          if (errorJson) s.error_json = errorJson;
          if (durationMs) s.duration_ms = durationMs;
        }
        return s;
      },
      listSteps: async (planId: string) => Array.from(stepMap.values()).filter((s) => s.planId === planId),
    };

    credRepo = {
      getCredentials: async () => null,
      setCredentials: async () => {},
      listConfiguredServices: async () => [],
    };
  }

  // 2. Initialize LLM Provider
  let provider: any;
  if (env.RUNTIME_MODE === 'live') {
    console.log(`\x1b[32m[chat-api]\x1b[0m Sử dụng Gemini Provider với API Key đã cấu hình.`);
    provider = new GeminiProvider({ apiKey: env.GEMINI_API_KEY });
  } else {
    console.log(
      `\x1b[33m[chat-api]\x1b[0m GEMINI_API_KEY chưa thiết lập. Sử dụng Smart Mock LLM Planner cho môi trường dev.`
    );
    const mockProvider = new MockLLMProvider();
    // Default smart workflow
    const sandboxPlan = {
        kind: 'plan',
        thinking: 'Khảo sát board Frontend trên Trello và kênh Slack #general. Lập kế hoạch tạo task sửa CSS, gán thành viên Minh và thông báo hoàn tất lên Slack.',
        summary: 'Tạo thẻ Trello sửa CSS, gán Minh và thông báo kênh Slack #general',
        steps: [
          {
            id: 'step_1',
            tool: 'trello.create_card',
            description: 'Tạo thẻ "Sửa lỗi responsive CSS" trên list To Do',
            args: { listId: 'list_frontend_todo', title: 'Sửa lỗi responsive CSS' },
            dependsOn: [],
          },
          {
            id: 'step_2',
            tool: 'trello.add_member',
            description: 'Gán thành viên Minh vào thẻ vừa tạo',
            args: { cardId: { $ref: 'step_1.output.id' }, memberId: 'member_minh_dev' },
            dependsOn: ['step_1'],
          },
          {
            id: 'step_3',
            tool: 'slack.send_message',
            description: 'Gửi tin nhắn thông báo lên kênh Slack #general',
            args: { channel: '#general', text: { $template: 'Đã tạo task mới cho Minh: ${step_1.output.url}' } },
            dependsOn: ['step_1'],
          },
        ],
        warnings: [],
      };
    const threeServicePlan = {
      kind: 'plan',
      thinking: 'Tạo issue GitHub, chuyển liên kết vào thẻ Trello, rồi thông báo cả hai liên kết qua Slack.',
      summary: 'Tạo issue GitHub, thẻ Trello liên kết và thông báo Slack',
      steps: [
        {
          id: 'step_1', tool: 'github.create_issue',
          description: 'Tạo issue trong repository được cấp quyền',
          args: { repo: 'owner/repo', title: 'Sửa lỗi responsive CSS' }, dependsOn: [],
        },
        {
          id: 'step_2', tool: 'trello.create_card',
          description: 'Tạo thẻ Trello dẫn tới GitHub issue',
          args: { listId: 'list_frontend_todo', title: 'Sửa lỗi responsive CSS', desc: { $template: 'Theo dõi GitHub issue: ${step_1.output.url}' } },
          dependsOn: ['step_1'],
        },
        {
          id: 'step_3', tool: 'slack.send_message',
          description: 'Thông báo issue GitHub và thẻ Trello',
          args: { channel: '#general', text: { $template: 'Issue: ${step_1.output.url}; Trello: ${step_2.output.url}' } },
          dependsOn: ['step_1', 'step_2'],
        },
      ],
      warnings: [],
    };
    mockProvider.setPlanResponses([process.env.SANDBOX_SCENARIO === 'three_service' ? threeServicePlan : sandboxPlan]);
    provider = mockProvider;
  }

  // 3. AI Planner with Resilient Fallback
  const backupMockProvider = new MockLLMProvider();
  backupMockProvider.setPlanResponses([
    {
      kind: 'plan',
      thinking: 'Hệ thống phân tích yêu cầu tạo task trên Trello và gửi thông báo qua Slack channel.',
      summary: 'Tạo thẻ Trello sửa CSS, gán Minh và thông báo Slack #general',
      steps: [
        {
          id: 'step_1',
          tool: 'trello.create_card',
          description: 'Tạo thẻ trên board Frontend',
          args: { listId: 'list_todo', title: 'Sửa lỗi CSS responsive' },
          dependsOn: [],
        },
        {
          id: 'step_2',
          tool: 'trello.add_member',
          description: 'Gán người phụ trách Minh Dev',
          args: { cardId: { $ref: 'step_1.output.id' }, memberId: 'member_minh' },
          dependsOn: ['step_1'],
        },
        {
          id: 'step_3',
          tool: 'slack.send_message',
          description: 'Gửi thông báo kênh Slack #general',
          args: { channel: '#general', text: { $template: 'Đã tạo thẻ mới: ${step_1.output.url}' } },
          dependsOn: ['step_1'],
        },
      ],
      warnings: [],
    },
  ]);

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
    (serviceName: string) => {
        console.log(`\x1b[35m[Sandbox Mode]\x1b[0m Using In-Memory Sandbox Adapter for '${serviceName}'`);
        return {
          execute: async (tool: string, args: any) => {
            console.log(`\x1b[35m[Sandbox Execution]\x1b[0m Chạy tool ${tool} với args:`, JSON.stringify(args));
            if (tool === 'trello.create_card') {
              return {
                id: `card_${Date.now()}`,
                name: args.title || 'Thẻ mới',
                url: 'https://trello.com/c/sandbox/card',
                listId: args.listId || 'list_1',
                desc: args.desc,
              };
            }
            if (tool === 'github.create_issue') {
              return {
                id: `issue_${Date.now()}`,
                number: 42,
                title: args.title,
                url: 'https://github.com/owner/repo/issues/42',
                repo: args.repo,
              };
            }
            if (tool === 'trello.add_member') {
              return { id: args.cardId, idMembers: [args.memberId] };
            }
            if (tool === 'slack.send_message') {
              if (process.env.SANDBOX_SCENARIO === 'partial_failure') {
                throw Object.assign(new Error('Sandbox: invalid Slack channel before send'), { category: 'VALIDATION' });
              }
              return { ok: true, channel: args.channel, text: args.text, ts: `${Date.now()}.000100` };
            }
            if (process.env.SANDBOX_SCENARIO === 'clarification' && tool === 'trello.search_boards') {
              return [{ id: 'board_frontend', name: 'Frontend' }];
            }
            if (process.env.SANDBOX_SCENARIO === 'clarification' && tool === 'trello.search_members') {
              return [
                { id: 'member_minh_nguyen', name: 'Minh Nguyễn' },
                { id: 'member_minh_tran', name: 'Minh Trần' },
              ];
            }
            if (tool.includes('.search_')) return [];
            return { ok: true, sandbox: true };
          },
        };
    });
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
