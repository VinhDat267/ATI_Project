import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ALL_TOOLS, GMAIL_SERVICE, GMAIL_TOOLS, MYSHEETS_SERVICE, MYSHEETS_TOOLS, SERVICE_REGISTRY, type ToolDefinition } from '@wap/tool-schemas';
import { AIPlanner, MockLLMProvider } from '@wap/planner';
import { ChatService } from '../../../src/services/chat-service.js';
import { MessageRepo } from '../../../src/db/repositories/message-repo.js';
import { PlanRepo } from '../../../src/db/repositories/plan-repo.js';
import { ScheduleRepo } from '../../../src/db/repositories/schedule-repo.js';
import { ScheduleRunner } from '../../../src/services/schedules/schedule-runner.js';
import { ScheduleService } from '../../../src/services/schedules/schedule-service.js';
import { createMigratedSchema } from '../../helpers/gmail-test-db.js';

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
    return (await db.pool.query(`INSERT INTO schedules(user_id,conv_id,name,request,recurrence,services,status,next_run_at)
      VALUES($1,$2,'Lịch họp',$3,'{"type":"daily","time":"08:00"}','{calendar,slack}','active','2026-10-25T01:00:00.000Z') RETURNING *`,
      [owner.id, convId, request])).rows[0];
  };
  const runOf = async (scheduleId: string) => (await db.pool.query('SELECT * FROM schedule_runs WHERE schedule_id=$1', [scheduleId])).rows[0];
  const messagesOf = async (convId: string) => (await db.pool.query('SELECT id, role, content, metadata FROM messages WHERE conv_id=$1 ORDER BY created_at, id', [convId])).rows;
  const plansOf = async (convId: string) => (await db.pool.query('SELECT * FROM plans WHERE conv_id=$1', [convId])).rows;

  beforeAll(async () => { db = await createMigratedSchema('scheduled_run_planning'); });
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
