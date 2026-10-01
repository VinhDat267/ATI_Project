import { describe, it, expect, beforeEach } from 'vitest';
import { handleSSEEvent, resetSSEState } from '../src/hooks/use-sse';
import { useChatStore } from '../src/store/chat-store';

describe('SSE Client Event Handler', () => {
  beforeEach(() => {
    useChatStore.getState().reset();
    resetSSEState();
  });

  it('updates store on text_start, text_delta, and plan events with sequence check', () => {
    handleSSEEvent('text_start', '{}', 1);
    expect(useChatStore.getState().isStreaming).toBe(true);

    handleSSEEvent('text_delta', JSON.stringify({ delta: 'Hello ' }), 2);
    handleSSEEvent('text_delta', JSON.stringify({ delta: 'world' }), 3);
    expect(useChatStore.getState().streamingText).toBe('Hello world');

    handleSSEEvent('plan', JSON.stringify({ kind: 'plan', summary: 'Test', steps: [] }), 4);
    expect(useChatStore.getState().activePlan?.summary).toBe('Test');
    expect(useChatStore.getState().planStatus).toBe('preview');
    expect(useChatStore.getState().isStreaming).toBe(false);
  });

  it('updates store on step status events', () => {
    handleSSEEvent('step_status', JSON.stringify({ stepId: 'step_1', status: 'running' }), 5);
    expect(useChatStore.getState().stepStatuses['step_1']).toBe('running');

    handleSSEEvent('step_status', JSON.stringify({ stepId: 'step_1', status: 'succeeded' }), 6);
    expect(useChatStore.getState().stepStatuses['step_1']).toBe('succeeded');
  });

  it('handles message_confirmed event', () => {
    useChatStore.getState().addOptimisticMessage({ id: 'temp-123', content: 'test' });
    handleSSEEvent('message_confirmed', JSON.stringify({ tempId: 'temp-123', confirmedId: 'msg-real-456' }), 7);
    expect(useChatStore.getState().messages[0].id).toBe('msg-real-456');
    expect(useChatStore.getState().messages[0].status).toBe('sent');
  });

  it('accepts reused sequence numbers after switching conversations and ignores late events from the old one', () => {
    useChatStore.getState().setConversationId('conversation-a');
    handleSSEEvent('plan', JSON.stringify({ id: 'plan-a', summary: 'Plan A', steps: [] }), 1, 'conversation-a');
    expect(useChatStore.getState().activePlan?.id).toBe('plan-a');

    useChatStore.getState().reset();
    useChatStore.getState().setConversationId('conversation-b');
    handleSSEEvent('plan', JSON.stringify({ id: 'plan-b', summary: 'Plan B', steps: [] }), 1, 'conversation-b');
    expect(useChatStore.getState().activePlan?.id).toBe('plan-b');

    handleSSEEvent('plan', JSON.stringify({ id: 'late-a', summary: 'Late A', steps: [] }), 2, 'conversation-a');
    expect(useChatStore.getState().activePlan?.id).toBe('plan-b');
  });

  it('does not apply an older replayed event after a newer event in the same conversation', () => {
    useChatStore.getState().setConversationId('conversation-a');
    handleSSEEvent('text_start', '{}', 10, 'conversation-a');
    handleSSEEvent('text_delta', JSON.stringify({ delta: 'new' }), 11, 'conversation-a');
    handleSSEEvent('text_delta', JSON.stringify({ delta: 'old' }), 9, 'conversation-a');
    expect(useChatStore.getState().streamingText).toBe('new');
  });

  it('handles exec_start and exec_done transitions', () => {
    handleSSEEvent('exec_start', '{}', 1);
    expect(useChatStore.getState().planStatus).toBe('executing');

    handleSSEEvent('exec_done', '{}', 2);
    expect(useChatStore.getState().planStatus).toBe('completed');
  });

  it('accumulates gather_progress steps and sets gatherState', () => {
    handleSSEEvent(
      'gather_progress',
      JSON.stringify({ tool: 'trello.search_boards', status: 'started' }),
      1
    );
    expect(useChatStore.getState().gatherState?.isGathering).toBe(true);
    expect(useChatStore.getState().gatherState?.steps[0].tool).toBe('trello.search_boards');
    expect(useChatStore.getState().gatherState?.steps[0].status).toBe('running');

    handleSSEEvent(
      'gather_progress',
      JSON.stringify({ tool: 'trello.search_boards', status: 'completed', result: '3 boards' }),
      2
    );
    expect(useChatStore.getState().gatherState?.steps[0].status).toBe('completed');
    expect(useChatStore.getState().gatherState?.steps[0].result).toBe('3 boards');

    handleSSEEvent(
      'gather_progress',
      JSON.stringify({ tool: 'slack.list_channels', status: 'started' }),
      3
    );
    expect(useChatStore.getState().gatherState?.steps).toHaveLength(2);
  });

  it('handles clarification events and clears them on plan_preview or refusal', () => {
    handleSSEEvent(
      'clarification',
      JSON.stringify({
        question: 'Which board?',
        options: ['Board A', 'Board B'],
      }),
      1
    );
    expect(useChatStore.getState().activeClarification?.question).toBe('Which board?');
    expect(useChatStore.getState().activeClarification?.options).toEqual(['Board A', 'Board B']);

    // Receiving plan_preview clears clarification and sets gatherState.isGathering = false
    handleSSEEvent(
      'plan_preview',
      JSON.stringify({
        plan: { id: 'p1', summary: 'Preview', steps: [] },
      }),
      2
    );
    expect(useChatStore.getState().activeClarification).toBeNull();
    expect(useChatStore.getState().planStatus).toBe('preview');

    // Reset clarification and test refusal
    handleSSEEvent(
      'clarification',
      JSON.stringify({ question: 'Another question?', options: [] }),
      3
    );
    expect(useChatStore.getState().activeClarification).not.toBeNull();

    handleSSEEvent(
      'refusal',
      JSON.stringify({ reason: 'Out of policy' }),
      4
    );
    expect(useChatStore.getState().activeClarification).toBeNull();
    expect(useChatStore.getState().planStatus).toBe('rejected');
  });

  it('safely defaults steps to empty array when plan event omits steps', () => {
    handleSSEEvent(
      'plan_preview',
      JSON.stringify({
        plan: { id: 'p_no_steps', summary: 'No steps provided' },
      }),
      10
    );

    const plan = useChatStore.getState().activePlan;
    expect(plan).toBeDefined();
    expect(plan?.steps).toBeInstanceOf(Array);
    expect(plan?.steps).toHaveLength(0);
  });
});
