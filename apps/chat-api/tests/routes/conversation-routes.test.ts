import { describe, it, expect, vi } from 'vitest';
import { ChatService } from '../../src/services/chat-service.js';

describe('apps/chat-api (Task 16: Chat Service Message Ingestion & Pipeline)', () => {
  it('persists working memory and assistant clarification across user turns', async () => {
    const rows: any[] = [];
    const msgRepo = {
      createMessage: vi.fn().mockImplementation(async (_convId: string, role: string, content: string, metadata?: any) => {
        const row = { id: `m-${rows.length + 1}`, role, content, metadata };
        rows.push(row);
        return row;
      }),
      listMessages: async () => [...rows],
    };
    const observations: any[] = [];
    const planner = {
      processMessage: async (input: any) => {
        observations.push({ memory: input.memory.toJSON(), history: input.history });
        if (observations.length === 1) {
          input.memory.setEntity('__gatherPending', { key: 'member', query: 'Minh', candidates: [{ id: 'U1', name: 'Minh Nguyen' }] });
          return { kind: 'clarification', question: 'Which Minh?', options: ['Minh Nguyen'] };
        }
        return { kind: 'plan', thinking: 'x', summary: 'x', steps: [], warnings: [] };
      },
    };
    const events: Array<{ name: string; payload: any }> = [];
    const emitter = { emit: (name: string, payload: any) => { events.push({ name, payload }); } };
    const service = new ChatService({ msgRepo: msgRepo as any, planner: planner as any, eventEmitter: emitter });
    await service.handleUserMessage({ conversationId: 'c', userId: 'u', content: 'Gán task cho Minh' });
    await vi.waitFor(() => expect(events.some((e) => e.name === 'clarification')).toBe(true));
    await service.handleUserMessage({ conversationId: 'c', userId: 'u', content: 'Minh Nguyen' });
    await vi.waitFor(() => expect(observations).toHaveLength(2));
    expect(observations[1].memory.__gatherPending.candidates[0].id).toBe('U1');
    expect(observations[1].history).toContainEqual({ role: 'assistant', content: 'Which Minh?' });
    expect(rows.find((m) => m.metadata?.type === 'working_memory')).toBeDefined();
  });

  it('saves message to db and returns 202 accepted payload immediately', async () => {
    const mockMsgRepo = {
      createMessage: vi.fn().mockResolvedValue({ id: 'msg-123' }),
      listMessages: vi.fn().mockResolvedValue([]),
    };
    const mockPlanRepo = {
      createPlan: vi.fn().mockResolvedValue({ id: 'plan-123' }),
    };
    const mockPlanner = {
      processMessage: vi.fn().mockResolvedValue({
        kind: 'plan',
        thinking: 'Valid reasoning',
        summary: 'Generated plan',
        steps: [],
        warnings: [],
      }),
    };
    const mockEmitter = {
      emit: vi.fn(),
    };

    const service = new ChatService({
      msgRepo: mockMsgRepo as any,
      planRepo: mockPlanRepo as any,
      planner: mockPlanner as any,
      eventEmitter: mockEmitter as any,
    });

    const result = await service.handleUserMessage({
      conversationId: 'conv-1',
      userId: 'u-1',
      content: 'Hello planner',
    });

    // Immediate 202 Accepted
    expect(result.status).toBe(202);
    expect(result.messageId).toBe('msg-123');

    expect(mockMsgRepo.createMessage).toHaveBeenCalledWith(
      'conv-1',
      'user',
      'Hello planner'
    );

    // Wait a tick for async background pipeline
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(mockEmitter.emit).toHaveBeenCalledWith(
      'agent_state',
      expect.objectContaining({ conversationId: 'conv-1', state: 'planning' })
    );
    expect(mockPlanner.processMessage).toHaveBeenCalled();
    expect(mockPlanRepo.createPlan).toHaveBeenCalled();
    expect(mockEmitter.emit).toHaveBeenCalledWith(
      'plan_preview',
      expect.objectContaining({ conversationId: 'conv-1', planId: 'plan-123' })
    );
  });

  it('handles clarification response from planner and emits clarification event', async () => {
    const mockMsgRepo = {
      createMessage: vi.fn().mockResolvedValue({ id: 'msg-124' }),
      listMessages: vi.fn().mockResolvedValue([]),
    };
    const mockPlanner = {
      processMessage: vi.fn().mockResolvedValue({
        kind: 'clarification',
        question: 'Which board?',
        options: ['Board A', 'Board B'],
        context: 'Need board',
      }),
    };
    const mockEmitter = {
      emit: vi.fn(),
    };

    const service = new ChatService({
      msgRepo: mockMsgRepo as any,
      planner: mockPlanner as any,
      eventEmitter: mockEmitter as any,
    });

    const result = await service.handleUserMessage({
      conversationId: 'conv-2',
      userId: 'u-2',
      content: 'Create card',
    });

    expect(result.status).toBe(202);

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(mockEmitter.emit).toHaveBeenCalledWith(
      'clarification',
      expect.objectContaining({
        conversationId: 'conv-2',
        question: 'Which board?',
      })
    );
  });

  it('handles error in planner and emits error event', async () => {
    const mockMsgRepo = {
      createMessage: vi.fn().mockResolvedValue({ id: 'msg-125' }),
      listMessages: vi.fn().mockResolvedValue([]),
    };
    const mockPlanner = {
      processMessage: vi.fn().mockRejectedValue(new Error('LLM rate limit')),
    };
    const mockEmitter = {
      emit: vi.fn(),
    };

    const service = new ChatService({
      msgRepo: mockMsgRepo as any,
      planner: mockPlanner as any,
      eventEmitter: mockEmitter as any,
    });

    const result = await service.handleUserMessage({
      conversationId: 'conv-3',
      userId: 'u-3',
      content: 'Trigger error',
    });

    expect(result.status).toBe(202);

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(mockEmitter.emit).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({
        conversationId: 'conv-3',
        message: 'LLM rate limit',
      })
    );
  });
});
