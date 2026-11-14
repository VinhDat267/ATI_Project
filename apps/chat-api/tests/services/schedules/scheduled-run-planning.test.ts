import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGmailToolAdapter, encryptCredentials } from '@wap/tool-adapters';
import { ALL_TOOLS, GMAIL_MODIFY_SCOPE, GMAIL_SERVICE, GMAIL_TOOLS, MYSHEETS_SERVICE, MYSHEETS_TOOLS, SERVICE_REGISTRY, type ToolDefinition } from '@wap/tool-schemas';
import { AIPlanner, MockLLMProvider } from '@wap/planner';
import { ChatService } from '../../../src/services/chat-service.js';
import { ConversationRepo } from '../../../src/db/repositories/conversation-repo.js';
import { CredentialRepo } from '../../../src/db/repositories/credential-repo.js';
import { MessageRepo } from '../../../src/db/repositories/message-repo.js';
import { PlanRepo } from '../../../src/db/repositories/plan-repo.js';
import { ScheduleRepo } from '../../../src/db/repositories/schedule-repo.js';
import { StepRepo } from '../../../src/db/repositories/step-repo.js';
import { AdapterFactory } from '../../../src/services/adapter-factory.js';
import { ExecutionService } from '../../../src/services/execution-service.js';
import { createGmailConnectionLookup } from '../../../src/services/gmail/connection-reference.js';
import { GmailOAuthClient } from '../../../src/services/gmail/oauth-client.js';
import { GmailTokenManager } from '../../../src/services/gmail/token-manager.js';
import { ScheduleRunner } from '../../../src/services/schedules/schedule-runner.js';
import { ScheduleService } from '../../../src/services/schedules/schedule-service.js';
import { certifyScheduleFixture } from '../../../src/services/slack/slack-schedule-origin.js';
import { createMigratedSchema } from '../../helpers/gmail-test-db.js';
import { startFakeGoogleGmail, type FakeGoogleGmail } from '../../../../../scripts/fake-google-gmail.mjs';

function assertDedicatedTestDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) {
    throw new Error('DATABASE_URL must be explicitly set to a dedicated PostgreSQL test DB (no default helper fallback).');
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(`DATABASE_URL protocol "${parsed.protocol}" must be postgres: or postgresql:.`);
  }
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname)) {
    throw new Error(`DATABASE_URL host "${parsed.hostname}" must be loopback.`);
  }
  const port = parsed.port || '5432';
  if (port === '55533') {
    throw new Error('DATABASE_URL port 55533 is forbidden for tests (local runtime database port).');
  }
  const isDedicatedCi =
    (process.env.CI === 'true' || process.env.CI === '1' || process.env.GITHUB_ACTIONS === 'true') &&
    (parsed.pathname === '/ati_v3' || parsed.pathname === '/ati_v3/');
  if (port === '5432' && !isDedicatedCi) {
    throw new Error('DATABASE_URL port 5432 is only allowed for the dedicated CI database (loopback:5432/ati_v3 with CI=true).');
  }
  return raw;
}

describe('dedicated test DATABASE_URL environment guard', () => {
  const withTestEnv = <T>(overrides: Record<string, string | undefined>, run: () => T): T => {
    const previous = new Map(Object.keys(overrides).map((k) => [k, process.env[k]]));
    try {
      for (const [k, v] of Object.entries(overrides)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      return run();
    } finally {
      for (const [k, v] of previous) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };

  it('accepts the verified GitHub Actions CI contract without connecting to 5432 and avoids hardcoded historical port bans', () => {
    const ciUrl = 'postgresql://ati_v3:ati_v3_ci_only@127.0.0.1:5432/ati_v3';
    expect(
      withTestEnv({ DATABASE_URL: ciUrl, CI: 'true', GITHUB_ACTIONS: 'true' }, () => assertDedicatedTestDatabaseUrl()),
    ).toBe(ciUrl);
    expect(
      withTestEnv({ DATABASE_URL: ciUrl, CI: 'true', GITHUB_ACTIONS: undefined }, () => assertDedicatedTestDatabaseUrl()),
    ).toBe(ciUrl);

    for (const localDedicatedUrl of [
      'postgresql://ati_test:ephemeral@127.0.0.1:61234/ati_test',
      'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:56534/ati_v3',
      'postgresql://ati_peer:ephemeral@localhost:58909/ati_test',
    ]) {
      expect(
        withTestEnv({ DATABASE_URL: localDedicatedUrl, CI: undefined, GITHUB_ACTIONS: undefined }, () =>
          assertDedicatedTestDatabaseUrl(),
        ),
      ).toBe(localDedicatedUrl);
    }
  });

  it('rejects missing DATABASE_URL, local non-CI 5432, wrong DB on CI 5432, runtime port 55533, and non-loopback hosts', () => {
    const ciUrl = 'postgresql://ati_v3:ati_v3_ci_only@127.0.0.1:5432/ati_v3';
    for (const missing of [undefined, '', '   ']) {
      expect(() =>
        withTestEnv({ DATABASE_URL: missing, CI: 'true', GITHUB_ACTIONS: 'true' }, () => assertDedicatedTestDatabaseUrl()),
      ).toThrow(/DATABASE_URL/);
    }
    expect(() =>
      withTestEnv({ DATABASE_URL: ciUrl, CI: undefined, GITHUB_ACTIONS: undefined }, () => assertDedicatedTestDatabaseUrl()),
    ).toThrow(/5432/);
    expect(() =>
      withTestEnv(
        { DATABASE_URL: 'postgresql://ati_v3:ati_v3_ci_only@127.0.0.1/ati_v3', CI: undefined, GITHUB_ACTIONS: undefined },
        () => assertDedicatedTestDatabaseUrl(),
      ),
    ).toThrow(/5432/);
    expect(() =>
      withTestEnv(
        { DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/postgres', CI: 'true', GITHUB_ACTIONS: 'true' },
        () => assertDedicatedTestDatabaseUrl(),
      ),
    ).toThrow(/5432/);
    expect(() =>
      withTestEnv(
        { DATABASE_URL: 'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3', CI: 'true', GITHUB_ACTIONS: 'true' },
        () => assertDedicatedTestDatabaseUrl(),
      ),
    ).toThrow(/55533/);
    expect(() =>
      withTestEnv(
        { DATABASE_URL: 'postgresql://ati_v3:ati_v3_ci_only@db.example.internal:61234/ati_v3', CI: 'true', GITHUB_ACTIONS: 'true' },
        () => assertDedicatedTestDatabaseUrl(),
      ),
    ).toThrow(/loopback/i);
  });
});

const VN = 'Asia/Ho_Chi_Minh';
type Db = Awaited<ReturnType<typeof createMigratedSchema>>;
type Person = Awaited<ReturnType<Db['person']>>;
const slackPlan = { kind: 'plan', thinking: 'Gửi Slack.', summary: 'Gửi lịch họp lên Slack', warnings: [],
  steps: [{ id: 'send', tool: 'slack.send_message', description: 'Gửi lịch họp', args: { channel: 'C0123456789', text: 'Lịch họp hôm nay' }, dependsOn: [] }] };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('scheduled runs planned through ChatService on PostgreSQL', () => {
  let db: Db, owner: Person, now: Date, events: Array<{ event: string; payload: any; committedPlans: number }>, order: string[];
  const runners: ScheduleRunner[] = [];

  const setup = (generatePlan: MockLLMProvider['generatePlan'], options: { toolCatalog?: ToolDefinition[]; gmail?: boolean; mysheets?: any; planTimeoutMs?: number } = {}) => {
    const provider = new MockLLMProvider();
    provider.generatePlan = generatePlan;
    const service = new ScheduleService({ pool: db.pool, timeZone: VN });
    // The runner's real clients, observed: every COMMIT they send, in order with the SSE events.
    const wrapped = new WeakSet<object>();
    const pool = new Proxy(db.pool, { get(target, prop, receiver) {
      if (prop !== 'connect') return Reflect.get(target, prop, receiver);
      return async () => {
        const client = await target.connect();
        if (!wrapped.has(client)) {
          wrapped.add(client);
          const query = client.query.bind(client) as (...args: unknown[]) => unknown;
          (client as any).query = (...args: unknown[]) => { if (args[0] === 'COMMIT') order.push('COMMIT'); return query(...args); };
        }
        return client;
      };
    } });
    const chat = new ChatService({
      msgRepo: new MessageRepo(db.pool), planRepo: new PlanRepo(db.pool),
      // Listeners record how many plans another connection can already see.
      eventEmitter: { emit: (event, payload) => { order.push(event); events.push({ event, payload, committedPlans: -1 });
        const entry = events.at(-1)!;
        void db.pool.query('SELECT count(*)::int AS n FROM plans WHERE conv_id=$1', [payload.conversationId]).then((r) => { entry.committedPlans = r.rows[0].n; }); } },
      planner: new AIPlanner({ provider, toolCatalog: options.toolCatalog ?? ALL_TOOLS, schedules: true, now: () => now, timeZone: VN,
        requireGroundedResources: false, serviceRegistry: options.gmail ? [...SERVICE_REGISTRY, GMAIL_SERVICE] : options.mysheets ? [...SERVICE_REGISTRY, MYSHEETS_SERVICE] : SERVICE_REGISTRY,
        gatherSearch: async () => [{ id: 'C0123456789', name: 'ati-test' }] }),
      gmailConnection: options.gmail ? async () => null : undefined,
      mysheetsConnection: options.mysheets ? async () => options.mysheets : undefined,
      schedules: { repo: new ScheduleRepo(db.pool, VN), timeZone: VN, now: () => now },
    });
    const runner = new ScheduleRunner({ pool, timeZone: VN, now: () => now, planRun: (run, convId, signal) => chat.planScheduledRun(run, convId, signal),
      recordState: (client, row, at) => service.recordState(client, row, at), planTimeoutMs: options.planTimeoutMs,
      emit: (_convId, event, payload: any) => { order.push(event); events.push({ event, payload, committedPlans: -1 }); } });
    runners.push(runner);
    return { runner, service };
  };
  const schedule = async (request = 'Gửi lịch họp hôm nay lên Slack #ati-test') => {
    const convId = (await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [owner.id])).rows[0].id;
    const row = (await db.pool.query(`INSERT INTO schedules(user_id,conv_id,name,request,recurrence,services,status,next_run_at)
      VALUES($1,$2,'Lịch họp',$3,'{"type":"daily","time":"08:00"}','{calendar,slack}','active','2026-10-25T01:00:00.000Z') RETURNING *`,
      [owner.id, convId, request])).rows[0];
    await certifyScheduleFixture(db.pool, row.id);
    return row;
  };
  const runOf = async (scheduleId: string) => (await db.pool.query('SELECT * FROM schedule_runs WHERE schedule_id=$1', [scheduleId])).rows[0];
  const messagesOf = async (convId: string) => (await db.pool.query('SELECT id, role, content, metadata FROM messages WHERE conv_id=$1 ORDER BY created_at, id', [convId])).rows;
  const plansOf = async (convId: string) => (await db.pool.query('SELECT * FROM plans WHERE conv_id=$1', [convId])).rows;

  beforeAll(async () => { assertDedicatedTestDatabaseUrl(); db = await createMigratedSchema('scheduled_run_planning'); });
  beforeEach(async () => {
    await db.pool.query('DELETE FROM schedule_runs; DELETE FROM schedules;');
    owner = await db.person('Chủ lịch');
    now = new Date('2026-10-25T01:00:30.000Z'); // 08:00:30 in Viet Nam
    events = []; order = [];
  });
  afterEach(async () => { for (const r of runners.splice(0)) await r.stop(); });
  afterAll(async () => { await db?.close(); });

  it('plans a due run into a pending plan of its own conversation and announces it after commit', async () => {
    const s = await schedule();
    const { runner } = setup(async () => JSON.stringify(slackPlan));
    await runner.tick();
    const run = await runOf(s.id);
    expect(run).toMatchObject({ status: 'planned' });
    const [plan] = await plansOf(run.conv_id);
    expect(plan).toMatchObject({ id: run.plan_id, status: 'pending', plan_json: slackPlan });
    // Messages written in one transaction share its created_at, so compare them by type.
    const messages = await messagesOf(run.conv_id);
    const ofType = (type: string) => messages.find((m) => m.metadata?.type === type)!;
    expect(messages.map((m) => m.metadata?.type).sort()).toEqual(['plan', 'schedule_run', 'working_memory']);
    expect(ofType('plan').metadata).toMatchObject({ planId: plan.id, replyToMessageId: ofType('schedule_run').id });
    await new Promise((r) => setTimeout(r, 50));
    const preview = events.find((e) => e.event === 'plan_preview')!;
    expect(preview.payload).toMatchObject({ conversationId: run.conv_id, planId: plan.id, replyToMessageId: ofType('schedule_run').id });
    expect(preview.committedPlans).toBe(1);
    expect(order.slice(-3)).toEqual(['COMMIT', 'plan_preview', 'agent_state']);
    // Lookups during planning report progress live, as on the chat path.
    const states = events.filter((e) => e.event !== 'gather_progress');
    expect(states.map((e) => e.event)).toEqual(['agent_state', 'plan_preview', 'agent_state']);
    expect(states.map((e) => e.payload.state)).toEqual(['planning', undefined, 'waiting_for_approval']);
  });

  it('discards the plan when the schedule changes while the model is still answering', async () => {
    const s = await schedule();
    const asked = deferred(), answer = deferred();
    const { runner, service } = setup(async () => { asked.resolve(); await answer.promise; return JSON.stringify(slackPlan); });
    const ticking = runner.tick();
    await asked.promise;
    await service.setStatus({ userId: owner.id, scheduleId: s.id, action: 'pause', version: 1, now });
    answer.resolve();
    await ticking;
    const run = await runOf(s.id);
    expect(run.status).toBe('discarded');
    expect(await plansOf(run.conv_id)).toEqual([]);
    expect(events.some((e) => e.event === 'plan_preview')).toBe(false);
    const [started, discarded] = await messagesOf(run.conv_id);
    expect([started.metadata.type, discarded.metadata.type]).toEqual(['schedule_run', 'schedule_discarded']);
    // The page that showed "planning" for this run hears that it ended, after the result is saved.
    expect(discarded.metadata.replyToMessageId).toBe(started.id);
    expect(events.at(-1)).toMatchObject({ event: 'error', payload: { conversationId: run.conv_id, replyToMessageId: started.id,
      message: 'Lịch đã thay đổi trong lúc lập kế hoạch. Kết quả này bị bỏ.' } });
    expect(order.slice(-2)).toEqual(['COMMIT', 'error']);
  });

  it('fails a run whose planning outlives its limit, and tells the page the planning ended', async () => {
    const s = await schedule();
    // The model only answers when its signal is aborted: the runner's limit must cancel it.
    const { runner } = setup((input) => new Promise((_resolve, reject) => {
      input.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }), { planTimeoutMs: 50 });
    await runner.tick();
    const run = await runOf(s.id);
    expect(run).toMatchObject({ status: 'planning_failed', error: 'Lập kế hoạch quá thời gian cho phép.', plan_id: null });
    const messages = await messagesOf(run.conv_id);
    const started = messages.find((m) => m.metadata?.type === 'schedule_run')!;
    expect(messages.at(-1)).toMatchObject({ role: 'system', content: 'Lỗi: Lập kế hoạch quá thời gian cho phép.',
      metadata: { type: 'planning_error', replyToMessageId: started.id } });
    expect(await plansOf(run.conv_id)).toEqual([]);
    expect(events.filter((e) => e.event !== 'gather_progress').map((e) => [e.event, e.payload.state ?? e.payload.message])).toEqual([
      ['agent_state', 'planning'], ['error', 'Lập kế hoạch quá thời gian cho phép.']]);
    expect(events.at(-1)!.payload).toMatchObject({ conversationId: run.conv_id, replyToMessageId: started.id });
    expect(order.slice(-2)).toEqual(['COMMIT', 'error']);
  });

  it('refuses a Gmail plan when the owner has not connected Gmail, and asks for attention', async () => {
    const s = await schedule('Gửi thư cho lan@example.test báo lịch họp hôm nay');
    const mail = { kind: 'plan', thinking: 'Gửi thư.', summary: 'Gửi thư báo lịch họp', warnings: [], steps: [{ id: 'mail', tool: 'gmail.send_message',
      description: 'Gửi thư', args: { to: ['lan@example.test'], subject: 'Lịch họp', body: 'Lịch họp hôm nay' }, dependsOn: [] }] };
    const { runner } = setup(async () => JSON.stringify(mail), { toolCatalog: [...ALL_TOOLS, ...GMAIL_TOOLS], gmail: true });
    await runner.tick();
    const run = await runOf(s.id);
    expect(run).toMatchObject({ status: 'needs_attention', plan_id: null });
    expect((await messagesOf(run.conv_id)).find((m) => m.metadata?.type === 'refusal')).toMatchObject({ role: 'assistant',
      metadata: { unavailableServices: [{ id: 'gmail', name: 'Gmail' }] } });
    expect(await plansOf(run.conv_id)).toEqual([]);
  });

  it('attaches connections.mysheets and saves pending plan when schedule task uses mysheets', async () => {
    const s = await schedule('Ghi báo cáo vào bảng tính cá nhân Việc của tôi');
    const sheetsPlan = {
      kind: 'plan',
      thinking: 'Ghi thêm dòng vào bảng tính cá nhân.',
      summary: 'Thêm dòng báo cáo vào bảng tính Việc của tôi',
      warnings: [],
      steps: [
        {
          id: 'append',
          tool: 'mysheets.append_rows',
          description: 'Thêm dòng vào bảng Việc của tôi',
          args: {
            spreadsheetId: 'sheet_123',
            sheet: 'Sheet1',
            rows: [['2026-10-25', 'Báo cáo', 'Hoàn thành']],
          },
          dependsOn: [],
        },
      ],
    };
    const { runner } = setup(async () => JSON.stringify(sheetsPlan), {
      toolCatalog: [...ALL_TOOLS, ...MYSHEETS_TOOLS],
      mysheets: {
        credentialId: 'cred_mysheets_1',
        email: 'alice.sheets@example.test',
        allowedSpreadsheets: ['sheet_123'],
        selectedSpreadsheets: [{ id: 'sheet_123', title: 'Việc của tôi', canEdit: true }],
      },
    });
    await runner.tick();
    const run = await runOf(s.id);
    expect(run).toMatchObject({ status: 'planned' });
    expect(run.plan_id).toBeTruthy();
    const plans = await plansOf(run.conv_id);
    expect(plans).toHaveLength(1);
    expect(plans[0].status).toBe('pending');
    expect(plans[0].plan_json.connections?.mysheets).toEqual({
      credentialId: 'cred_mysheets_1',
      email: 'alice.sheets@example.test',
      allowedSpreadsheets: ['sheet_123'],
    });
  });
});

describe('scheduled Gmail run grounding, identity authority, and execution binding (approved 06)', () => {
  const key = '0123456789abcdef0123456789abcdef';
  const OAUTH_CLIENT_ID = 'gmail-test.apps.googleusercontent.com';

  let db: Db;
  let google: FakeGoogleGmail;
  let credentials: CredentialRepo;
  let conversations: ConversationRepo;
  let messages: MessageRepo;
  let plans: PlanRepo;
  let steps: StepRepo;
  let owner: Person;
  let now: Date;
  let events: Array<{ event: string; payload: any }>;
  const runners: ScheduleRunner[] = [];

  const connectOwnerGmail = async (who: Person, email: string) => {
    const refreshToken = google.mintRefreshToken(email, [GMAIL_MODIFY_SCOPE], OAUTH_CLIENT_ID);
    return credentials.saveCredentials(
      'gmail',
      encryptCredentials(
        {
          refreshToken,
          email,
          oauthClientId: OAUTH_CLIENT_ID,
          scopes: [GMAIL_MODIFY_SCOPE],
          connectedAt: now.toISOString(),
        },
        key,
      ),
      who.id,
    );
  };

  const insertCertifiedGmailSchedule = async (who: Person, request: string, services = '{gmail}') => {
    const convId = (await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [who.id])).rows[0].id as string;
    const row = (
      await db.pool.query(
        `INSERT INTO schedules(user_id,conv_id,name,request,recurrence,services,status,next_run_at)
         VALUES($1,$2,'Báo cáo email cá nhân',$3,'{"type":"daily","time":"08:00"}',$4,'active','2026-10-25T01:00:00.000Z') RETURNING *`,
        [who.id, convId, request, services],
      )
    ).rows[0];
    await certifyScheduleFixture(db.pool, row.id);
    return row;
  };

  const settlePlan = async (planId: string) => {
    for (let i = 0; i < 150; i++) {
      const status = (await plans.getPlan(planId))?.status;
      if (status && !['approved', 'executing'].includes(status)) return status;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`Plan ${planId} did not settle`);
  };

  const createRuntime = (generatePlan: MockLLMProvider['generatePlan'], telegramLookup?: () => Promise<any>) => {
    const provider = new MockLLMProvider();
    const providerInputs: Array<Parameters<MockLLMProvider['generatePlan']>[0]> = [];
    provider.generatePlan = async (input) => {
      providerInputs.push(structuredClone(input));
      return generatePlan(input);
    };

    const oauth = new GmailOAuthClient({
      clientId: OAUTH_CLIENT_ID,
      clientSecret: 'fake-gmail-secret',
      redirectUri: 'http://127.0.0.1:5174/connections/gmail/callback',
      ...google.endpoints,
    });
    const tokens = new GmailTokenManager({ client: oauth, credentials });
    const adapterFactory = new AdapterFactory({
      credentialRepo: credentials,
      encryptionKey: key,
      gmailTokens: tokens,
      createGmailAdapter: ({ tokens: tokenProvider }) => createGmailToolAdapter({ tokens: tokenProvider, baseUrl: google.origin }),
    });
    const scheduleService = new ScheduleService({
      pool: db.pool,
      timeZone: VN,
      encryptionKey: key,
      gmailOAuthClientId: OAUTH_CLIENT_ID,
    });
    const planner = new AIPlanner({
      provider,
      toolCatalog: [...ALL_TOOLS, ...GMAIL_TOOLS],
      serviceRegistry: [...SERVICE_REGISTRY, GMAIL_SERVICE],
      requireGroundedResources: true,
      schedules: true,
      now: () => now,
      timeZone: VN,
    });
    const chat = new ChatService({
      msgRepo: messages,
      convRepo: conversations,
      planRepo: plans,
      planner,
      eventEmitter: { emit: (event, payload) => events.push({ event, payload }) },
      gmailConnection: createGmailConnectionLookup(credentials, key),
      ...(telegramLookup ? { telegramConnection: telegramLookup } : {}),
      schedules: {
        repo: new ScheduleRepo(db.pool, VN),
        pool: db.pool,
        timeZone: VN,
        now: () => now,
        credentialRepo: credentials,
        encryptionKey: key,
        gmailOAuthClientId: OAUTH_CLIENT_ID,
      },
    });
    const runner = new ScheduleRunner({
      pool: db.pool,
      timeZone: VN,
      now: () => now,
      planRun: (run, convId, signal) => chat.planScheduledRun(run, convId, signal),
      recordState: (client, row, at) => scheduleService.recordState(client, row, at),
      emit: (_convId, event, payload: any) => events.push({ event, payload }),
    });
    const execution = new ExecutionService({
      planRepo: plans,
      stepRepo: steps,
      convRepo: conversations,
      adapterFactory,
      pool: db.pool,
      enforceReportGrounding: true,
    });
    runners.push(runner);
    return { chat, runner, execution, adapterFactory, scheduleService, providerInputs };
  };

  beforeAll(async () => {
    assertDedicatedTestDatabaseUrl();
    google = await startFakeGoogleGmail({ settings: { accessTokenPrefix: 'ya29.c2-sched' } });
    db = await createMigratedSchema('scheduled_gmail_grounding');
    credentials = new CredentialRepo(db.pool);
    conversations = new ConversationRepo(db.pool);
    messages = new MessageRepo(db.pool);
    plans = new PlanRepo(db.pool);
    steps = new StepRepo(db.pool);
  });

  beforeEach(async () => {
    await db.pool.query("DELETE FROM schedule_runs; DELETE FROM schedules; DELETE FROM service_credentials WHERE service IN ('gmail','telegram');");
    google.stats.writes = 0;
    google.stats.apiRequests.length = 0;
    google.stats.refreshes = 0;
    owner = await db.person('Chủ lịch Gmail');
    now = new Date('2026-10-25T01:00:30.000Z');
    events = [];
  });

  afterEach(async () => {
    for (const r of runners.splice(0)) await r.stop();
  });

  afterAll(async () => {
    await google?.close();
    await db?.close();
  });

  it('resolves active owner Gmail account from trusted connection, seeds gmail_account before processMessage, persists pending plan with zero writes before approval, and sends only after owner approval', async () => {
    const ownCred = await connectOwnerGmail(owner, 'Owner.Sched@example.test');
    const s = await insertCertifiedGmailSchedule(owner, 'Gửi email tóm tắt công việc hôm nay cho tôi');

    const { runner, execution, providerInputs } = createRuntime(async (input) => {
      const seededEmail = (input.workingMemory as any)?.gmail_account?.email ?? 'Owner.Sched@example.test';
      return JSON.stringify({
        kind: 'plan',
        thinking: 'Gửi email báo cáo cho chủ tài khoản.',
        summary: 'Gửi tóm tắt công việc cho tôi',
        warnings: [],
        connections: { gmail: { credentialId: 'model-forged-cred', email: 'forged@attacker.test' } },
        steps: [
          {
            id: 'send_self',
            tool: 'gmail.send_message',
            description: 'Gửi email tóm tắt cho tôi',
            args: { to: [seededEmail], subject: 'Tóm tắt công việc hôm nay', body: 'Danh sách công việc hôm nay.' },
            dependsOn: [],
          },
        ],
      });
    });

    await runner.tick();

    // Must seed trusted trimmed gmail_account into workingMemory BEFORE planner.processMessage!
    expect(providerInputs).toHaveLength(1);
    expect((providerInputs[0]!.workingMemory as any).gmail_account).toEqual({ email: 'Owner.Sched@example.test' });

    const run = (await db.pool.query('SELECT * FROM schedule_runs WHERE schedule_id=$1', [s.id])).rows[0];
    expect(run).toMatchObject({ status: 'planned' });
    expect(run.plan_id).toBeTruthy();

    const savedPlans = (await db.pool.query('SELECT * FROM plans WHERE conv_id=$1', [run.conv_id])).rows;
    expect(savedPlans).toHaveLength(1);
    expect(savedPlans[0]).toMatchObject({
      id: run.plan_id,
      status: 'pending',
    });
    expect(savedPlans[0].plan_json.connections).toEqual({
      gmail: { credentialId: ownCred.id, email: 'Owner.Sched@example.test' },
    });
    expect(savedPlans[0].plan_text).not.toContain('model-forged-cred');

    // Zero writes or external API calls before explicit user approval!
    expect(google.stats.writes).toBe(0);
    expect(google.stats.apiRequests).toHaveLength(0);

    // Owner approves -> exactly 1 synthetic HTTP Gmail send executes and plan completes.
    const approval = await execution.approveAndStart(savedPlans[0].id, owner.id);
    expect(approval).toMatchObject({ success: true, status: 200 });
    expect(await settlePlan(savedPlans[0].id)).toBe('completed');
    expect(google.stats.writes).toBe(1);
    expect(google.stats.apiRequests.filter((r: any) => r.method === 'POST' && r.path === 'messages/send')).toHaveLength(1);
  });

  it('never trusts run-supplied or model-supplied identity fields and fails safely to needs_attention when Gmail is missing or reconnect_required', async () => {
    // Part A: Missing Gmail connection + spoofed identity fields on RunToPlan -> never seeded into gmail_account, rejected as ungrounded.
    const { chat, providerInputs } = createRuntime(async () =>
      JSON.stringify({
        kind: 'plan',
        thinking: 'Thử gửi tới email giả mạo.',
        summary: 'Gửi tới spoof',
        warnings: [],
        steps: [
          {
            id: 'spoof_send',
            tool: 'gmail.send_message',
            description: 'Gửi email',
            args: { to: ['spoof@attacker.test'], subject: 'Spoof', body: 'Spoof body' },
            dependsOn: [],
          },
        ],
      }),
    );

    const runConv = (await conversations.createConversation(owner.id)).id;
    const prepared = await chat.planScheduledRun(
      {
        runId: '00000000-0000-4000-8000-000000000111',
        scheduleId: '00000000-0000-4000-8000-000000000222',
        scheduleVersion: 1,
        userId: owner.id,
        name: 'Spoofed Run',
        request: 'Gửi email báo cáo cho tôi',
        dueAt: now,
        trigger: 'scheduled',
        email: 'spoof@attacker.test',
        gmailAccount: { email: 'spoof@attacker.test' },
        gmail_account: { email: 'spoof@attacker.test' },
      } as any,
      runConv,
      new AbortController().signal,
    );

    expect(providerInputs).toHaveLength(2);
    expect((providerInputs[0]!.workingMemory as any).gmail_account).toBeUndefined();

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const persisted = await prepared.persist(client);
      await client.query('COMMIT');
      expect(persisted).toEqual({ state: 'needs_attention' });
    } finally {
      client.release();
    }
    expect((await db.pool.query('SELECT count(*)::int AS n FROM plans WHERE conv_id=$1', [runConv])).rows[0].n).toBe(0);
    expect(google.stats.writes).toBe(0);

    // Part B: Reconnect-required Gmail credential on scheduled self-addressed run -> needs_attention, 0 plans, 0 HTTP calls.
    const revokedCred = await connectOwnerGmail(owner, 'revoked.owner@example.test');
    await credentials.markReconnectRequired('gmail', owner.id, revokedCred.id);
    const s = await insertCertifiedGmailSchedule(owner, 'Gửi email tóm tắt công việc hôm nay cho tôi');

    const { runner: revokedRunner, providerInputs: revokedInputs } = createRuntime(async () =>
      JSON.stringify({
        kind: 'plan',
        thinking: 'Thử gửi cho chủ cũ.',
        summary: 'Gửi tóm tắt',
        warnings: [],
        steps: [
          {
            id: 'send_revoked',
            tool: 'gmail.send_message',
            description: 'Gửi email',
            args: { to: ['revoked.owner@example.test'], subject: 'Tóm tắt', body: 'Nội dung' },
            dependsOn: [],
          },
        ],
      }),
    );

    await revokedRunner.tick();
    expect((revokedInputs[0]!.workingMemory as any).gmail_account).toBeUndefined();
    const revokedRun = (await db.pool.query('SELECT * FROM schedule_runs WHERE schedule_id=$1', [s.id])).rows[0];
    expect(revokedRun).toMatchObject({ status: 'needs_attention', plan_id: null });
    expect((await db.pool.query('SELECT count(*)::int AS n FROM plans WHERE conv_id=$1', [revokedRun.conv_id])).rows[0].n).toBe(0);
    expect(google.stats.writes).toBe(0);
  });

  it('denies cross-user approval, rejects credential replacement before execution with zero writes, and preserves A1 prepareProposal sanitization & digest binding', async () => {
    const originalCred = await connectOwnerGmail(owner, 'owner.bound@example.test');
    const intruder = await db.person('Người dùng khác');
    await connectOwnerGmail(intruder, 'intruder@example.test');

    const s = await insertCertifiedGmailSchedule(owner, 'Gửi email tóm tắt công việc hôm nay cho tôi');
    const { chat, runner, execution, adapterFactory } = createRuntime(
      async (input) =>
        JSON.stringify({
          kind: 'plan',
          thinking: 'Gửi cho chủ tài khoản.',
          summary: 'Gửi tóm tắt cho tôi',
          warnings: [],
          steps: [
            {
              id: 'send_bound',
              tool: 'gmail.send_message',
              description: 'Gửi email',
              args: {
                to: [(input.workingMemory as any)?.gmail_account?.email ?? 'owner.bound@example.test'],
                subject: 'Tóm tắt',
                body: 'Nội dung',
              },
              dependsOn: [],
            },
          ],
        }),
      async () => ({
        status: 'connected' as const,
        selectedChats: [{ chatId: '777888999', title: 'Telegram cá nhân', type: 'private' as const }],
        connection: { credentialId: 'tg-cred-1', telegramUserId: '777888999', username: 'owner_tg', chatIds: ['777888999'] },
      }),
    );

    await runner.tick();
    const run = (await db.pool.query('SELECT * FROM schedule_runs WHERE schedule_id=$1', [s.id])).rows[0];
    expect(run.status).toBe('planned');
    const pendingPlan = (await plans.getPlan(run.plan_id))!;
    expect(pendingPlan.status).toBe('pending');
    expect(pendingPlan.plan_json.connections.gmail).toEqual({
      credentialId: originalCred.id,
      email: 'owner.bound@example.test',
    });
    expect(google.stats.writes).toBe(0);

    // 1. Cross-user approval attempt is denied (403) and leaves plan pending with zero writes.
    const crossApproval = await execution.approveAndStart(pendingPlan.id, intruder.id);
    expect(crossApproval).toMatchObject({ success: false, status: 403 });
    expect((await plans.getPlan(pendingPlan.id))!.status).toBe('pending');
    expect(google.stats.writes).toBe(0);

    // 2. Owner replaces Gmail credential before approving -> execution rejects with AUTH_ERROR and zero provider writes!
    await connectOwnerGmail(owner, 'replacement.owner@example.test');
    adapterFactory.clearPersonal(owner.id);

    const ownerApprovalAfterReplace = await execution.approveAndStart(pendingPlan.id, owner.id);
    expect(ownerApprovalAfterReplace).toMatchObject({ success: true, status: 200 });
    expect(await settlePlan(pendingPlan.id)).toBe('partial');
    const stepRows = await steps.listSteps(pendingPlan.id);
    expect(stepRows[0]).toMatchObject({
      status: 'failed',
      error_json: { category: 'AUTH_ERROR', message: expect.stringContaining('Kết nối Gmail đã thay đổi') },
    });
    expect(google.stats.writes).toBe(0);
    expect(google.stats.apiRequests).toHaveLength(0);

    // 3. Verify A1's prepareProposal sanitization & loadGmailDigestBinding lookup remain intact in ChatService.
    // Pass raw untrusted fields directly to ChatService via ChatPlanner so ChatService.prepareProposal's own defense-in-depth is exercised.
    const activeGmailRow = (await credentials.getPersonalCredentials('gmail', owner.id))!;
    const digestConv = (await conversations.createConversation(owner.id)).id;
    const directProposalChat = new ChatService({
      msgRepo: messages,
      convRepo: conversations,
      planRepo: plans,
      planner: {
        processMessage: async () =>
          ({
            kind: 'schedule',
            action: 'create',
            name: 'Bản tin Gmail qua Telegram',
            request: 'Đọc email chưa đọc trong Gmail và gửi tóm tắt qua Telegram cho tôi',
            recurrence: { type: 'daily', time: '07:30' },
            summary: 'Mỗi ngày 07:30 tóm tắt Gmail qua Telegram.',
            deliveryMode: 'auto_digest',
            services: ['slack'],
            digestConfig: { forged: true },
          }) as any,
        routeSchedule: () => ({ services: ['gmail', 'telegram'], unavailable: [] }),
      },
      eventEmitter: { emit: (event, payload) => events.push({ event, payload }) },
      gmailConnection: createGmailConnectionLookup(credentials, key),
      telegramConnection: async () => ({
        status: 'connected' as const,
        selectedChats: [{ chatId: '777888999', title: 'Telegram cá nhân', type: 'private' as const }],
        connection: { credentialId: 'tg-cred-1', telegramUserId: '777888999', username: 'owner_tg', chatIds: ['777888999'] },
      }),
      schedules: {
        repo: new ScheduleRepo(db.pool, VN),
        pool: db.pool,
        timeZone: VN,
        now: () => now,
        credentialRepo: credentials,
        encryptionKey: key,
        gmailOAuthClientId: OAUTH_CLIENT_ID,
      },
    });

    const beforeEvents = events.filter((e) => e.event === 'schedule_proposal').length;
    await directProposalChat.handleUserMessage({
      conversationId: digestConv,
      userId: owner.id,
      content: 'Mỗi sáng 7 giờ 30 đọc email chưa đọc trong Gmail và gửi tóm tắt qua Telegram cho tôi',
    });
    for (let i = 0; i < 150 && events.filter((e) => e.event === 'schedule_proposal').length === beforeEvents; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const proposalMsg = (await messages.listMessages(digestConv, 20, 'planning')).find(
      (m: any) => m.metadata?.type === 'schedule_proposal',
    )!;
    expect(proposalMsg).toBeDefined();
    expect(Object.keys(proposalMsg.metadata.proposal).sort()).toEqual([
      'action',
      'kind',
      'name',
      'recurrence',
      'request',
      'summary',
    ]);
    expect((proposalMsg.metadata.proposal as any).digestConfig).toBeUndefined();
    expect((proposalMsg.metadata.proposal as any).deliveryMode).toBeUndefined();
    const gmailSource = proposalMsg.metadata.digestCandidate?.config?.sources?.find((src: any) => src.service === 'gmail');
    expect(gmailSource?.binding).toEqual({
      kind: 'gmail',
      credentialId: activeGmailRow.id,
      email: 'replacement.owner@example.test',
      oauthClientId: OAUTH_CLIENT_ID,
    });
    void chat;
  });
});
