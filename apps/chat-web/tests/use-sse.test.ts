import { describe, it, expect, beforeEach } from 'vitest';
import { handleSSEEvent } from '../src/hooks/use-sse';
import { useChatStore } from '../src/store/chat-store';

describe('SSE Client Event Handler', () => {
  beforeEach(() => {
    useChatStore.getState().reset();
  });

  it('updates store on text_start, text_delta, and plan events with sequence check', () => {
    handleSSEEvent('text_start', '{}', 1);
    expect(useChatStore.getState().isStreaming).toBe(true);

    handleSSEEvent('text_delta', JSON.stringify({ delta: 'Hello ' }), 2);
    handleSSEEvent('text_delta', JSON.stringify({ delta: 'world' }), 3);
    expect(useChatStore.getState().streamingText).toBe('Hello world');

    handleSSEEvent('plan', JSON.stringify({ kind: 'plan', summary: 'Test', steps: [] }), 4);
    expect(useChatStore.getState().activePlan?.summary).toBe('Test');
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
});
