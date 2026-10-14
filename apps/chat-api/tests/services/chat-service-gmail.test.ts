import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { encryptCredentials } from '@wap/tool-adapters';
import type { PlanResponse, PlannerResponse } from '@wap/tool-schemas';
import type { ProcessMessageInput } from '@wap/planner';
import { ChatService } from '../../src/services/chat-service.js';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { MessageRepo } from '../../src/db/repositories/message-repo.js';
import { PlanRepo } from '../../src/db/repositories/plan-repo.js';
import { StepRepo } from '../../src/db/repositories/step-repo.js';
import { ExecutionService } from '../../src/services/execution-service.js';
import { verifiedRecoverySteps } from '../../src/services/execution-recovery.js';
import { createGmailConnectionLookup } from '../../src/services/gmail/connection-reference.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

const key = '0123456789abcdef0123456789abcdef';
type Person = Awaited<ReturnType<Awaited<ReturnType<typeof createMigratedSchema>>['person']>>;
const forged = { gmail: { credentialId: 'model-invented', email: 'attacker@example.test' } };
const card: PlanResponse['steps'][number] = { id: 'card', tool: 'trello.create_card', description: 'Card', args: { listId: 'L1', title: 'T' }, dependsOn: [] };
const mail: PlanResponse['steps'][number] = { id: 'mail', tool: 'gmail.send_message', description: 'Mail', args: { to: ['lan@example.test'], subject: 'S', body: 'B' }, dependsOn: [] };
const plan = (steps: PlanResponse['steps'], extra: Record<string, unknown> = {}) => ({ kind: 'plan', thinking: 't', summary: 'Tóm tắt', warnings: [], steps, ...extra }) as PlanResponse;

describe('ChatService binds a plan to the previewed Gmail connection before hashing it', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>, credentials: CredentialRepo, plans: PlanRepo, messages: MessageRepo, conversations: ConversationRepo;
  let owner: Person, responses: PlannerResponse[], inputs: ProcessMessageInput[], events: Array<{ event: string; payload: any }>;
  const service = () => new ChatService({
    msgRepo: messages, convRepo: conversations, planRepo: plans, eventEmitter: { emit: (event, payload) => events.push({ event, payload }) },
    planner: { processMessage: async (input: ProcessMessageInput) => { inputs.push(input); return structuredClone(responses.shift()!); } } as any,
    gmailConnection: createGmailConnectionLookup(credentials, key),
  });
  const send = async (text: string) => {
    const conv = (await db.pool.query('SELECT id FROM conversations WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1', [owner.id])).rows[0]?.id
      ?? (await conversations.createConversation(owner.id)).id;
    await service().handleUserMessage({ conversationId: conv, userId: owner.id, content: text });
    for (let i = 0; i < 100 && !events.some((e) => ['plan_preview', 'refusal', 'clarification', 'error'].includes(e.event)); i++) await new Promise((r) => setTimeout(r, 20));
    return conv as string;
  };
  const latestPlan = async (conv: string) => (await db.pool.query('SELECT * FROM plans WHERE conv_id=$1 ORDER BY created_at DESC LIMIT 1', [conv])).rows[0];
  const connect = (email: string) => credentials.saveCredentials('gmail',
    encryptCredentials({ refreshToken: '1//fake-r', email, scopes: ['https://www.googleapis.com/auth/gmail.modify'], connectedAt: new Date().toISOString() }, key), owner.id);

  beforeAll(async () => {
    db = await createMigratedSchema('gmail_chat');
    credentials = new CredentialRepo(db.pool); plans = new PlanRepo(db.pool); messages = new MessageRepo(db.pool); conversations = new ConversationRepo(db.pool);
  });
  beforeEach(async () => { owner = await db.person('Owner'); responses = []; inputs = []; events = []; });
  afterAll(async () => { await db?.close(); });

  it('tells the planner who is asking', async () => {
    responses.push(plan([card]));
    await send('Tạo thẻ');
    expect(inputs[0]!.actor).toEqual({ userId: owner.id });
  });

  it('drops connections the model wrote on a plan without Gmail steps', async () => {
    responses.push(plan([card], { connections: forged }));
    const conv = await send('Tạo thẻ');
    const row = await latestPlan(conv);
    expect(row.plan_json.connections).toBeUndefined();
    expect(row.plan_text).not.toContain('model-invented');
    expect(events.find((e) => e.event === 'plan_preview')!.payload.plan.connections).toBeUndefined();
  });

  it('replaces any model-written reference with the active connection, inside plan_json and the approved hash', async () => {
    const own = await connect('owner.mail@example.test');
    responses.push(plan([card, mail], { connections: forged }));
    const conv = await send('Gửi thư cho Lan');
    const row = await latestPlan(conv);
    const expected = { gmail: { credentialId: own.id, email: 'owner.mail@example.test' } };
    expect(row.plan_json.connections).toEqual(expected);
    expect(row.plan_hash).toBe(createHash('sha256').update(row.plan_text).digest('hex'));
    expect(JSON.parse(row.plan_text).connections).toEqual(expected);
    expect(row.plan_text).not.toContain('model-invented');
    expect(verifiedRecoverySteps(row).map((s) => s.id)).toEqual(['card', 'mail']);
    expect(events.find((e) => e.event === 'plan_preview')!.payload.plan.connections).toEqual(expected);

    // Editing the stored reference breaks the integrity check used by approval and recovery.
    await db.pool.query(`UPDATE plans SET plan_json = jsonb_set(plan_json, '{connections,gmail,credentialId}', '"swapped"') WHERE id=$1`, [row.id]);
    const tampered = await latestPlan(conv);
    expect(() => verifiedRecoverySteps(tampered)).toThrow('integrity');
    const execution = new ExecutionService({ planRepo: plans, stepRepo: new StepRepo(db.pool), convRepo: conversations,
      adapterFactory: { getAdapterForService: () => { throw new Error('no adapter may be built'); } } });
    expect(await execution.approveAndStart(row.id, owner.id)).toMatchObject({ success: false, status: 409 });
  });

  it('refuses a Gmail plan, without saving it, when the caller has no active connection', async () => {
    const own = await connect('owner.mail@example.test');
    await credentials.markReconnectRequired('gmail', owner.id, own.id);
    responses.push(plan([mail]));
    const conv = await send('Gửi thư cho Lan');
    expect(await latestPlan(conv)).toBeUndefined();
    const refusal = events.find((e) => e.event === 'refusal')!;
    expect(refusal.payload.unavailableServices).toEqual([{ id: 'gmail', name: 'Gmail' }]);
    const saved = (await db.pool.query("SELECT metadata FROM messages WHERE conv_id=$1 AND metadata->>'type'='refusal'", [conv])).rows[0];
    expect(saved.metadata.unavailableServices).toEqual([{ id: 'gmail', name: 'Gmail' }]);
  });

  it('gives the model earlier plans without their connections', async () => {
    await connect('owner.mail@example.test');
    responses.push(plan([mail]), { kind: 'clarification', question: 'Q?', context: 'c' });
    await send('Gửi thư cho Lan');
    events = [];
    await send('Đổi tiêu đề');
    const previous = inputs[1]!.history!.find((m) => m.role === 'assistant' && m.content.includes('gmail.send_message'))!;
    expect(previous).toBeDefined();
    expect(previous.content).not.toContain('connections');
    expect(previous.content).not.toContain('owner.mail@example.test');
  });
});
