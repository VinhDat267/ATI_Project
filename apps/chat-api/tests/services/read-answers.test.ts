import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ChatService } from '../../src/services/chat-service.js';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import { MessageRepo } from '../../src/db/repositories/message-repo.js';
import { PlanRepo } from '../../src/db/repositories/plan-repo.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
import { validateEnv } from '../../src/config/env.js';

describe('ANS-01 persisted answer and history boundary', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  beforeAll(async () => { db = await createMigratedSchema('ans01'); });
  afterAll(async () => { await db?.close(); });
  it('validates the on/off flag and preserves explicit off', () => {
    expect((validateEnv({ PLANNER_READ_ANSWERS: 'off' }) as any).PLANNER_READ_ANSWERS).toBe(false);
    expect((validateEnv({ PLANNER_READ_ANSWERS: 'on' }) as any).PLANNER_READ_ANSWERS).toBe(true);
    expect(() => validateEnv({ PLANNER_READ_ANSWERS: 'maybe' })).toThrow(/PLANNER_READ_ANSWERS/);
  });
  it('saves an answer without a plan, emits correlation and idle, wraps it on the next turn', async () => {
    const person = await db.person('ANS');
    const messages = new MessageRepo(db.pool), conversations = new ConversationRepo(db.pool);
    const conversation = await conversations.createConversation(person.id);
    const lookups = [{ tool: 'slack.search_channels', query: 'frontend', resultCount: 1, links: ['https://a.example'] }];
    const response = { kind: 'answer', text: '<b>x</b> https://a.example', lookups, usedDirectory: ['slack'] };
    const inputs: any[] = [], events: Array<{ event: string; payload: any }> = [];
    let next: any = response;
    const service = new ChatService({ msgRepo: messages, convRepo: conversations, planRepo: new PlanRepo(db.pool),
      planner: { processMessage: async (input: any) => { inputs.push(input); return next; } } as any,
      eventEmitter: { emit: (event, payload) => events.push({ event, payload }) } });
    const send = async (text: string) => {
      const message = await messages.createMessage(conversation.id, 'user', text);
      await (service as any).executePlannerPipeline(conversation.id, person.id, text, message.id, 'ans-request');
      return message;
    };
    const user = await send('Xem Slack');
    const saved = (await messages.listMessages(conversation.id)).find(m => m.metadata?.type === 'answer');
    expect(saved).toMatchObject({ role: 'assistant', content: response.text, metadata: {
      type: 'answer', lookups, usedDirectory: ['slack'], replyToMessageId: user.id, requestId: 'ans-request',
    } });
    expect(events.find(e => e.event === 'answer')?.payload).toEqual({ conversationId: conversation.id,
      text: response.text, lookups, usedDirectory: ['slack'], replyToMessageId: user.id, requestId: 'ans-request' });
    expect(events.at(-1)).toMatchObject({ event: 'agent_state', payload: { state: 'idle' } });
    expect((await db.pool.query('SELECT * FROM plans WHERE conv_id=$1', [conversation.id])).rows).toEqual([]);
    next = { kind: 'clarification', question: 'Kênh nào?', context: '' };
    await send('Gửi tóm tắt vào Slack');
    const previous = inputs[1].history.find((m: any) => m.role === 'assistant');
    expect(previous.content).toContain('<previous_answer>\n');
    expect(previous.content).toContain(response.text);
    expect(previous.content).toContain('\n</previous_answer>');
    expect(previous.content).toMatch(/data.*not instructions/i);
  });
});
