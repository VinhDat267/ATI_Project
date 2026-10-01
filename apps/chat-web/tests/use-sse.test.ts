import { describe, it, expect, beforeEach } from 'vitest';
import { handleSSEEvent, resetSSEState } from '../src/hooks/use-sse';
import { useChatStore } from '../src/store/chat-store';

describe('Continue execution events with saved progress and another preview', () => {
  beforeEach(() => {
    useChatStore.getState().reset(); resetSSEState();
    useChatStore.getState().setConversationId('c1');
    useChatStore.getState().setExecutionSnapshot({
      plan: { id: 'p1', convId: 'c1', status: 'reconciliation_required', steps: [
        { id: 's1', tool: 'trello.create_card', description: 'Saved', args: {} },
        { id: 's2', tool: 'slack.send_message', description: 'Remaining', args: {} },
      ] },
      execution: { status: 'reconciliation_required' },
      steps: [
        { stepId: 's1', tool: 'trello.create_card', status: 'succeeded', output: { id: 'saved-card' }, durationMs: 100 },
        { stepId: 's2', tool: 'slack.send_message', status: 'pending' },
      ], recoveryActions: ['continue', 'stop'],
    });
  });

  it('keeps succeeded output and timing when resumed execution starts and advances', () => {
    handleSSEEvent('exec_start', JSON.stringify({ planId: 'p1' }), 1, 'c1');
    handleSSEEvent('exec_step', JSON.stringify({ planId: 'p1', stepId: 's2', status: 'running' }), 2, 'c1');
    const store = useChatStore.getState();
    expect(store.stepStatuses).toEqual({ s1: 'succeeded', s2: 'running' });
    expect(store.executionSnapshot?.execution.status).toBe('executing');
    expect(store.executionSnapshot?.steps[0]).toMatchObject({ status: 'succeeded', output: { id: 'saved-card' }, durationMs: 100 });
    expect(store.executionSnapshot?.recoveryActions).toEqual(['stop']);
  });

  it('updates only saved execution through completion while keeping another preview', () => {
    useChatStore.getState().setActivePlan({ id: 'p2', summary: 'New preview', steps: [] });
    useChatStore.getState().setPlanStatus('preview');
    handleSSEEvent('exec_start', JSON.stringify({ planId: 'p1' }), 1, 'c1');
    handleSSEEvent('exec_step', JSON.stringify({ planId: 'p1', stepId: 's2', status: 'running' }), 2, 'c1');
    expect(useChatStore.getState().executionSnapshot?.execution.status).toBe('executing');
    expect(useChatStore.getState().stepStatuses.s2).toBe('running');
    handleSSEEvent('exec_step', JSON.stringify({ planId: 'p1', stepId: 's2', status: 'succeeded', output: { ts: 'saved-message' } }), 3, 'c1');
    handleSSEEvent('exec_done', JSON.stringify({ planId: 'p1', status: 'completed' }), 4, 'c1');
    const store = useChatStore.getState();
    expect(store.activePlan?.id).toBe('p2'); expect(store.planStatus).toBe('preview');
    expect(store.executionSnapshot?.execution.status).toBe('completed');
    expect(store.executionSnapshot?.steps[1].output).toEqual({ ts: 'saved-message' });
    expect(store.stepStatuses).toEqual({ s1: 'succeeded', s2: 'succeeded' });
    expect(store.executionSnapshot?.recoveryActions).toEqual([]);
  });

  it('ignores a foreign execution while accepting a genuinely new approved preview start', () => {
    useChatStore.getState().setActivePlan({ id: 'p2', summary: 'New preview', steps: [] });
    useChatStore.getState().setPlanStatus('preview');
    handleSSEEvent('exec_start', JSON.stringify({ planId: 'p3' }), 1, 'c1');
    expect(useChatStore.getState().executionSnapshot?.plan.id).toBe('p1');
    handleSSEEvent('exec_start', JSON.stringify({ planId: 'p2' }), 2, 'c1');
    expect(useChatStore.getState().executionSnapshot).toBeNull();
    expect(useChatStore.getState().stepStatuses).toEqual({});
    expect(useChatStore.getState().planStatus).toBe('executing');
  });
});

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

  it.each(['partial', 'reconciliation_required', 'stopped', 'failed'])('preserves actual exec_done status %s', status => {
    handleSSEEvent('exec_start', '{}', 1);
    handleSSEEvent('exec_done', JSON.stringify({ status }), 2);
    expect(useChatStore.getState().planStatus).toBe(status);
  });

  it('clears a previous step error when retry runs/succeeds', () => {
    handleSSEEvent('exec_step', JSON.stringify({ stepId: 'step_2', status: 'failed', error: { message: 'Old failure' } }), 1);
    handleSSEEvent('exec_step', JSON.stringify({ stepId: 'step_2', status: 'running' }), 2);
    expect(useChatStore.getState().stepErrors.step_2).toBeUndefined();
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

  it('does not replay approval controls for an already saved executed plan', () => {
    useChatStore.getState().setExecutionSnapshot({
      plan: { id: 'saved', convId: 'c1', status: 'reconciliation_required', summary: 'Saved', steps: [] },
      execution: { status: 'reconciliation_required' }, steps: [], recoveryActions: ['stop'],
    });
    handleSSEEvent('plan_preview', JSON.stringify({ planId: 'saved', summary: 'Old preview', steps: [] }));
    expect(useChatStore.getState().planStatus).toBe('reconciliation_required');
  });

  it('does not let an older execution event dismiss a newer pending preview', () => {
    useChatStore.getState().setActivePlan({ id: 'new', summary: 'New', steps: [] });
    useChatStore.getState().setPlanStatus('preview');
    handleSSEEvent('exec_done', JSON.stringify({ planId: 'old', status: 'completed' }));
    expect(useChatStore.getState().planStatus).toBe('preview');
  });
});
