import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ALL_TOOLS, type ToolDefinition } from '@wap/tool-schemas';
import { AIPlanner, MockLLMProvider } from '@wap/planner';
import { ChatService } from '../../src/services/chat-service.js';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import { MessageRepo } from '../../src/db/repositories/message-repo.js';
import { PlanRepo } from '../../src/db/repositories/plan-repo.js';
import { ScheduleRepo } from '../../src/db/repositories/schedule-repo.js';
import { ScheduleService } from '../../src/services/schedules/schedule-service.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

const VN = 'Asia/Ho_Chi_Minh';
const NOW = new Date('2026-10-25T02:00:00.000Z'); // Sunday 25/10/2026, 09:00 in Viet Nam
type Db = Awaited<ReturnType<typeof createMigratedSchema>>;
type Person = Awaited<ReturnType<Db['person']>>;

const createProposal = { kind: 'schedule', action: 'create', name: 'Lịch họp hằng ngày', request: 'Gửi lịch họp hôm nay lên Slack #ati-test',
  recurrence: { type: 'daily', time: '08:00' }, summary: 'Mỗi sáng 8 giờ, gửi lịch họp hôm nay lên Slack #ati-test.' };
const updateProposal = { kind: 'schedule', action: 'update', name: 'Lịch họp ngày làm việc', request: 'Gửi lịch họp hôm nay lên Slack #ati-test và Telegram',
  recurrence: { type: 'weekly', time: '08:30', days: [1, 2, 3, 4, 5] }, summary: 'Đổi sang 8 giờ 30, từ thứ Hai đến thứ Sáu, gửi cả Telegram.' };
const slackPlan = { kind: 'plan', thinking: 'Gửi Slack.', summary: 'Gửi lịch họp lên Slack', warnings: [],
  steps: [{ id: 'send', tool: 'slack.send_message', description: 'Gửi lịch họp', args: { channel: 'C0123456789', text: 'Lịch họp hôm nay' }, dependsOn: [] }] };
const TERMINAL = ['schedule_proposal', 'plan_preview', 'refusal', 'clarification', 'answer', 'error'];

describe('ChatService with schedules on PostgreSQL', () => {
  let db: Db, owner: Person, provider: MockLLMProvider, events: Array<{ event: string; payload: any }>;
  let messages: MessageRepo, conversations: ConversationRepo, plans: PlanRepo, schedules: ScheduleService;

  const chat = (toolCatalog: ToolDefinition[] = ALL_TOOLS, searchMode: 'regex' | 'llm' = 'regex') => new ChatService({
    msgRepo: messages, convRepo: conversations, planRepo: plans, eventEmitter: { emit: (event, payload) => events.push({ event, payload }) },
    planner: new AIPlanner({ provider, toolCatalog, schedules: true, now: () => NOW, timeZone: VN, requireGroundedResources: false, searchMode,
      gatherSearch: async () => [{ id: 'C0123456789', name: 'ati-test' }] }),
    schedules: { repo: new ScheduleRepo(db.pool, VN), timeZone: VN, now: () => NOW },
  });
  const send = async (convId: string, text: string, service = chat()) => {
    const before = events.filter((e) => TERMINAL.includes(e.event)).length;
    await service.handleUserMessage({ conversationId: convId, userId: owner.id, content: text });
    for (let i = 0; i < 200 && events.filter((e) => TERMINAL.includes(e.event)).length === before; i++) await new Promise((r) => setTimeout(r, 10));
    return events.filter((e) => TERMINAL.includes(e.event)).at(-1)!;
  };
  const latest = async (convId: string, type: string) => (await db.pool.query(
    "SELECT id, role, content, metadata FROM messages WHERE conv_id=$1 AND metadata->>'type'=$2 ORDER BY created_at DESC, id DESC LIMIT 1", [convId, type])).rows[0];
  const conversation = async () => (await conversations.createConversation(owner.id)).id;
  const confirm = async (convId: string, messageId: string) => schedules.confirmProposal({ userId: owner.id, convId, messageId, now: NOW });
  /** A confirmed daily schedule made through the chat. */
  const scheduled = async () => {
    const convId = await conversation();
    provider.setPlanResponses([createProposal]);
    await send(convId, 'Mỗi sáng 8 giờ, gửi lịch họp hôm nay lên Slack #ati-test');
    const change = await confirm(convId, (await latest(convId, 'schedule_proposal')).id);
    return { convId, schedule: change.schedule };
  };

  beforeAll(async () => {
    db = await createMigratedSchema('chat_schedules');
    messages = new MessageRepo(db.pool); conversations = new ConversationRepo(db.pool); plans = new PlanRepo(db.pool);
    schedules = new ScheduleService({ pool: db.pool, timeZone: VN });
  });
  beforeEach(async () => { owner = await db.person('Chủ lịch'); provider = new MockLLMProvider(); events = []; });
  afterAll(async () => { await db?.close(); });

  it('saves a new schedule proposal with what the confirmation needs, and announces it', async () => {
    const convId = await conversation();
    // Services the model declares itself are never used: the router decides.
    provider.setPlanResponses([{ ...createProposal, services: ['github'] }]);
    const terminal = await send(convId, 'Mỗi sáng 8 giờ, gửi lịch họp hôm nay lên Slack #ati-test');
    const proposal = await latest(convId, 'schedule_proposal');
    expect(proposal).toMatchObject({ role: 'assistant', content: createProposal.summary });
    expect(proposal.metadata).toMatchObject({ type: 'schedule_proposal', proposal: createProposal, scheduleId: null, baseVersion: null,
      services: ['slack', 'calendar'], previous: null, nextRuns: ['2026-10-26T01:00:00.000Z', '2026-10-27T01:00:00.000Z', '2026-10-28T01:00:00.000Z'] });
    expect(terminal).toEqual({ event: 'schedule_proposal', payload: expect.objectContaining({ conversationId: convId, messageId: proposal.id,
      metadata: expect.objectContaining({ type: 'schedule_proposal', services: ['slack', 'calendar'] }) }) });
    expect(events.at(-1)).toEqual({ event: 'agent_state', payload: expect.objectContaining({ conversationId: convId, state: 'idle' }) });
    const change = await confirm(convId, proposal.id);
    expect(change.schedule).toMatchObject({ status: 'active', services: ['slack', 'calendar'], version: 1 });
  });

  it('proposes an update against the current schedule, with services from the router and the earlier proposal in history', async () => {
    const { convId, schedule } = await scheduled();
    provider.setPlanResponses([updateProposal]);
    await send(convId, 'Đổi sang 8 giờ 30, thứ Hai đến thứ Sáu, gửi cả Telegram');
    const proposal = await latest(convId, 'schedule_proposal');
    expect(proposal.metadata).toMatchObject({ proposal: updateProposal, scheduleId: schedule.id, baseVersion: 1,
      services: ['slack', 'calendar', 'telegram'],
      previous: { name: createProposal.name, request: createProposal.request, recurrence: createProposal.recurrence, status: 'active' },
      nextRuns: ['2026-10-26T01:30:00.000Z', '2026-10-27T01:30:00.000Z', '2026-10-28T01:30:00.000Z'] });
    const history = provider.getLastInput()!.conversationHistory;
    // The proposal goes back as JSON (in the key order JSONB keeps), not as its Vietnamese summary.
    expect(history.filter((m) => m.role === 'assistant' && m.content.startsWith('{')).map((m) => JSON.parse(m.content))).toEqual([createProposal]);
    expect(history.some((m) => m.role === 'assistant' && m.content.includes('đang bật, phiên bản 1'))).toBe(true);
    expect((await confirm(convId, proposal.id)).schedule).toMatchObject({ version: 2, services: ['slack', 'calendar', 'telegram'] });
  });

  it('takes the services of pause and resume from the schedule', async () => {
    const { convId, schedule } = await scheduled();
    provider.setPlanResponses([{ kind: 'schedule', action: 'pause', summary: 'Tạm dừng lịch.' }]);
    await send(convId, 'Tạm dừng lịch này');
    let proposal = await latest(convId, 'schedule_proposal');
    expect(proposal.metadata).toMatchObject({ scheduleId: schedule.id, baseVersion: 1, services: ['slack', 'calendar'], nextRuns: [],
      previous: { status: 'active' } });
    await confirm(convId, proposal.id);
    provider.setPlanResponses([{ kind: 'schedule', action: 'resume', summary: 'Chạy tiếp.' }]);
    await send(convId, 'Chạy tiếp lịch này');
    proposal = await latest(convId, 'schedule_proposal');
    expect(proposal.metadata).toMatchObject({ baseVersion: 2, services: ['slack', 'calendar'], previous: { status: 'paused' },
      nextRuns: ['2026-10-26T01:00:00.000Z', '2026-10-27T01:00:00.000Z', '2026-10-28T01:00:00.000Z'] });
  });

  it('refuses a schedule whose task needs a service that is not configured, and saves no proposal', async () => {
    const convId = await conversation();
    provider.setPlanResponses([createProposal]);
    // The message names no service, so planning reaches the model; the task the model wrote needs Calendar.
    const terminal = await send(convId, 'Mỗi sáng 8 giờ nhé', chat(ALL_TOOLS.filter((t) => t.service !== 'calendar')));
    expect(terminal).toEqual({ event: 'refusal', payload: expect.objectContaining({ conversationId: convId,
      unavailableServices: [{ id: 'calendar', name: 'Google Calendar' }] }) });
    expect(await latest(convId, 'refusal')).toMatchObject({ metadata: { unavailableServices: [{ id: 'calendar', name: 'Google Calendar' }] } });
    expect(await latest(convId, 'schedule_proposal')).toBeUndefined();
  });

  it('cancels through the chat a schedule whose task needs a service that is no longer configured', async () => {
    const { convId, schedule } = await scheduled();
    provider.setPlanResponses([{ kind: 'schedule', action: 'cancel', summary: 'Hủy lịch.' }]);
    // Live plans in llm mode, which routes on every request of the conversation, including the one that named Calendar.
    const terminal = await send(convId, 'Hủy lịch này', chat(ALL_TOOLS.filter((t) => t.service !== 'calendar'), 'llm'));
    expect(terminal.event).toBe('schedule_proposal');
    const proposal = await latest(convId, 'schedule_proposal');
    expect(proposal.metadata).toMatchObject({ proposal: { action: 'cancel' }, scheduleId: schedule.id, services: ['slack', 'calendar'] });
    expect((await confirm(convId, proposal.id)).schedule.status).toBe('cancelled');
  });

  it.each(['regex', 'llm'] as const)('pauses through the chat a schedule after every service was unconfigured (%s)', async (mode) => {
    const { convId, schedule } = await scheduled();
    provider.setPlanResponses([{ kind: 'schedule', action: 'pause', summary: 'Tạm dừng lịch.' }]);
    const terminal = await send(convId, 'Tạm dừng lịch này', chat([], mode));
    expect(terminal.event).toBe('schedule_proposal');
    const proposal = await latest(convId, 'schedule_proposal');
    expect(proposal.metadata).toMatchObject({ proposal: { action: 'pause' }, scheduleId: schedule.id, services: ['slack', 'calendar'] });
    expect((await confirm(convId, proposal.id)).schedule.status).toBe('paused');
  });

  it('writes nothing of a run outside the transaction that persists it', async () => {
    const { schedule } = await scheduled();
    provider.setPlanResponses([slackPlan]);
    const runConv = await conversation();
    const prepared = await chat().planScheduledRun({ runId: '00000000-0000-4000-8000-000000000001', scheduleId: schedule.id, scheduleVersion: 1, userId: owner.id,
      name: schedule.name, request: schedule.request, dueAt: new Date('2026-10-26T01:00:00.000Z'), trigger: 'manual' }, runConv, new AbortController().signal);
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await prepared.persist(client);
      await client.query('ROLLBACK');
    } finally { client.release(); }
    expect((await db.pool.query('SELECT count(*)::int AS n FROM plans WHERE conv_id=$1', [runConv])).rows[0].n).toBe(0);
    expect((await db.pool.query('SELECT count(*)::int AS n FROM messages WHERE conv_id=$1', [runConv])).rows[0].n).toBe(0);
  });

  it('same_result_on_chat_and_run_paths', async () => {
    const text = 'Gửi lịch họp hôm nay lên Slack #ati-test\n\n(Lượt chạy theo lịch "Lịch họp hằng ngày" lúc 26/10 08:00.)';
    provider.setPlanResponses([slackPlan]);
    const chatConv = await conversation();
    await send(chatConv, text);

    const { schedule } = await scheduled();
    provider.setPlanResponses([slackPlan]);
    const dueAt = new Date('2026-10-26T01:00:00.000Z');
    const runConv = await conversation();
    const runId = (await db.pool.query(`INSERT INTO schedule_runs(schedule_id,schedule_version,trigger,due_at,status,conv_id)
      VALUES($1,1,'scheduled',$2,'planning',$3) RETURNING id`, [schedule.id, dueAt, runConv])).rows[0].id;
    await messages.createMessage(runConv, 'user', text, { type: 'schedule_run', scheduleId: schedule.id, runId, name: schedule.name, dueAt: dueAt.toISOString(), trigger: 'scheduled' });
    const prepared = await chat().planScheduledRun({ runId, scheduleId: schedule.id, scheduleVersion: 1, userId: owner.id, name: schedule.name,
      request: schedule.request, dueAt, trigger: 'scheduled' }, runConv, new AbortController().signal);
    // The run planned with the prompt of schedules off and no history.
    expect(provider.getLastInput()!.systemPrompt).not.toContain('### Scheduled workflows');
    expect(provider.getLastInput()!.conversationHistory).toEqual([{ role: 'user', content: text }]);
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      expect(await prepared.persist(client)).toMatchObject({ state: 'planned' });
      await client.query('COMMIT');
    } finally { client.release(); }

    const row = async (convId: string) => (await db.pool.query('SELECT plan_json, resource_labels, plan_hash, status FROM plans WHERE conv_id=$1', [convId])).rows;
    const [onChat] = await row(chatConv);
    expect(await row(runConv)).toEqual([onChat]);
    expect(onChat).toMatchObject({ status: 'pending', plan_json: slackPlan });
  });
});
