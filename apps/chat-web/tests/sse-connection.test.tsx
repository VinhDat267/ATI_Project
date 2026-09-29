/** @vitest-environment jsdom */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { handleSSEEvent, resetSSEState, useSSE } from '../src/hooks/use-sse';
import { useChatStore } from '../src/store/chat-store';

const fetchEventSourceMock = vi.hoisted(() => vi.fn(async (_url: string, _options: { headers: Record<string, string> }) => undefined));
vi.mock('@microsoft/fetch-event-source', () => ({ fetchEventSource: fetchEventSourceMock }));

function SSEClient({ conversationId }: { conversationId: string }) {
  useSSE(conversationId, 'jwt');
  return null;
}

beforeEach(() => {
  resetSSEState();
  useChatStore.getState().reset();
  fetchEventSourceMock.mockClear();
});

afterEach(cleanup);

describe('SSE connection cursor', () => {
  it('resumes each conversation from its own sequence after switching away and back', () => {
    useChatStore.getState().setConversationId('conversation-a');
    const view = render(React.createElement(SSEClient, { conversationId: 'conversation-a' }));
    expect(fetchEventSourceMock.mock.calls[0][1].headers['Last-Event-ID']).toBe('0');

    handleSSEEvent('text_start', '{}', 3, 'conversation-a');
    useChatStore.getState().setConversationId('conversation-b');
    view.rerender(React.createElement(SSEClient, { conversationId: 'conversation-b' }));
    expect(fetchEventSourceMock.mock.calls[1][1].headers['Last-Event-ID']).toBe('0');

    handleSSEEvent('text_start', '{}', 1, 'conversation-b');
    useChatStore.getState().setConversationId('conversation-a');
    view.rerender(React.createElement(SSEClient, { conversationId: 'conversation-a' }));
    expect(fetchEventSourceMock.mock.calls[2][1].headers['Last-Event-ID']).toBe('3');
  });

  it('accepts a lower sequence after a server epoch changes', () => {
    useChatStore.getState().setConversationId('conversation-a');
    handleSSEEvent('text_start', '{}', 'server-one:10', 'conversation-a');
    handleSSEEvent('text_delta', '{"delta":"old"}', 'server-one:11', 'conversation-a');
    handleSSEEvent('text_start', '{}', 'server-two:1', 'conversation-a');
    handleSSEEvent('text_delta', '{"delta":"new"}', 'server-two:2', 'conversation-a');
    handleSSEEvent('text_delta', '{"delta":"new"}', 'server-two:2', 'conversation-a');
    expect(useChatStore.getState().streamingText).toBe('new');
  });
});
