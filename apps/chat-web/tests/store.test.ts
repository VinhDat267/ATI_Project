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
});
