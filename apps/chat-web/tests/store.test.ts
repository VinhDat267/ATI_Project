import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from '../src/store/chat-store';

describe('Chat Store State Management', () => {
  beforeEach(() => {
    useChatStore.getState().reset();
  });

  it('adds optimistic user message and replaces it upon sync', () => {
    const store = useChatStore.getState();
    store.addOptimisticMessage({ id: 'temp-1', content: 'Create a card' });

    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(useChatStore.getState().messages[0].status).toBe('sending');

    store.confirmMessage('temp-1', 'confirmed-msg-id');
    expect(useChatStore.getState().messages[0].id).toBe('confirmed-msg-id');
    expect(useChatStore.getState().messages[0].status).toBe('sent');
  });

  it('updates streaming text correctly', () => {
    const store = useChatStore.getState();
    store.appendStreamingText('Hello ');
    store.appendStreamingText('world');
    expect(useChatStore.getState().streamingText).toBe('Hello world');
  });

  it('stores active plan and step statuses', () => {
    const store = useChatStore.getState();
    store.setActivePlan({
      id: 'p1',
      summary: 'Test plan',
      steps: [{ id: 's1', tool: 'trello.create_card', description: 'desc', args: {}, dependsOn: [] }],
    });
    expect(useChatStore.getState().activePlan?.summary).toBe('Test plan');

    store.updateStepStatus('s1', 'running');
    expect(useChatStore.getState().stepStatuses['s1']).toBe('running');
  });

  it('manages planStatus lifecycle transitions', () => {
    const store = useChatStore.getState();
    expect(store.planStatus).toBe('idle');

    store.setPlanStatus('preview');
    expect(useChatStore.getState().planStatus).toBe('preview');

    store.setPlanStatus('approving');
    expect(useChatStore.getState().planStatus).toBe('approving');

    store.setPlanStatus('executing');
    expect(useChatStore.getState().planStatus).toBe('executing');

    store.setPlanStatus('completed');
    expect(useChatStore.getState().planStatus).toBe('completed');

    store.reset();
    expect(useChatStore.getState().planStatus).toBe('idle');
  });

  it('manages activeClarification and gatherState', () => {
    const store = useChatStore.getState();
    expect(store.activeClarification).toBeNull();
    expect(store.gatherState).toBeNull();

    store.setClarification({
      question: 'Which board?',
      options: ['Board A', 'Board B'],
    });
    expect(useChatStore.getState().activeClarification?.question).toBe('Which board?');

    store.setGatherState({
      isGathering: true,
      steps: [{ tool: 'trello.search_boards', status: 'running' }],
      summary: '1 tool running',
    });
    expect(useChatStore.getState().gatherState?.isGathering).toBe(true);

    // Test functional update
    store.setGatherState((prev) =>
      prev
        ? {
            ...prev,
            steps: [{ tool: 'trello.search_boards', status: 'completed', result: 'Found 2' }],
            summary: 'Done',
          }
        : null
    );
    expect(useChatStore.getState().gatherState?.steps[0].status).toBe('completed');
    expect(useChatStore.getState().gatherState?.steps[0].result).toBe('Found 2');

    store.reset();
    expect(useChatStore.getState().activeClarification).toBeNull();
    expect(useChatStore.getState().gatherState).toBeNull();
  });

  it('preserves conversations list when reset is invoked', () => {
    const store = useChatStore.getState();
    store.setConversations([
      { id: 'c1', title: 'Conversation 1', updatedAt: '2026-10-01' },
      { id: 'c2', title: 'Conversation 2', updatedAt: '2026-10-01' },
    ]);
    store.setConversationId('c1');
    store.addOptimisticMessage({ id: 'temp-1', content: 'test' });
    store.setPlanStatus('executing');

    expect(useChatStore.getState().conversations).toHaveLength(2);

    store.reset();

    expect(useChatStore.getState().conversationId).toBeNull();
    expect(useChatStore.getState().messages).toHaveLength(0);
    expect(useChatStore.getState().planStatus).toBe('idle');
    expect(useChatStore.getState().conversations).toHaveLength(2);
    expect(useChatStore.getState().conversations[0].id).toBe('c1');
  });
});
