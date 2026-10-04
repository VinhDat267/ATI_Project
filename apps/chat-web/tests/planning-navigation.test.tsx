/** @vitest-environment jsdom */
import { createServer, type Server, type ServerResponse } from 'node:http';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../src/App';
import { authStorage } from '../src/services/auth-storage';
import { useChatStore } from '../src/store/chat-store';
import { handleSSEEvent, resetSSEState } from '../src/hooks/use-sse';

const nativeFetch = globalThis.fetch;
const user = { id: 'u1', email: 'test@example.test', name: 'Test' };
let server: Server;
let base: string;
let streams: Map<string, ServerResponse>;
let sends: Array<{ convId: string; response: ServerResponse; content: string; requestId: string }>;
let creations: ServerResponse[];
let savedReplies: Map<string, any[]>;
function reply(response: ServerResponse, body: unknown, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body));
}
beforeEach(async () => {
  sends = []; creations = []; streams = new Map(); savedReplies = new Map(); resetSSEState();
  useChatStore.getState().reset(); useChatStore.getState().setConversations([]);
  window.history.replaceState({}, '', '/c/c1');
  authStorage.setStoredTokens({ accessToken: 'fixture-token', user });
  server = createServer(async (request, response) => {
    const url = request.url!;
    if (url === '/api/auth/me') return reply(response, { user });
    if (url === '/api/runtime') return reply(response, { runtimeMode: 'sandbox' });
    if (url === '/api/services') return reply(response, { services: [] });
    if (url.startsWith('/api/conversations?') || url === '/api/conversations') {
      if (request.method === 'POST') { creations.push(response); return; }
      return reply(response, { conversations: [{ id: 'c1', title: 'Conversation one' }, { id: 'c2', title: 'Conversation two' }] });
    }
    const convId = /\/conversations\/([^/]+)/.exec(url)?.[1];
    if (url.endsWith('/stream') && convId) {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.write(': connected\n\n');
      streams.set(convId, response); response.on('close', () => { if (streams.get(convId) === response) streams.delete(convId); }); return;
    }
    if (url.endsWith('/messages') && request.method === 'POST' && convId) {
      let text = ''; for await (const chunk of request) text += chunk;
      const body = JSON.parse(text); sends.push({ convId, response, content: body.content, requestId: body.tempId }); return;
    }
    if (/\/api\/conversations\/[^/]+$/.test(url)) return reply(response, { conversation: { id: convId }, messages: [{ id: `${convId}-saved`, role: 'user', content: `Saved ${convId}` }, ...(savedReplies.get(convId!) ?? [])] });
    return reply(response, { error: 'Không tìm thấy.' }, 404);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => nativeFetch(new URL(url, base), init));
});
afterEach(async () => {
  cleanup(); vi.unstubAllGlobals(); authStorage.clearStoredTokens(); useChatStore.getState().reset();
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
});
async function select(id: 'c1' | 'c2') {
  fireEvent.click(await screen.findByRole('button', { name: id === 'c1' ? 'Conversation one' : 'Conversation two' }));
  await screen.findByText(`Saved ${id}`);
  await waitFor(() => expect(streams.has(id)).toBe(true));
}
function sendButton() { return within(screen.getByPlaceholderText('Mô tả công việc bạn muốn thực hiện...').closest('form')!).getByRole('button', { name: 'Gửi' }); }
function send(content: string) {
  const input = screen.getByPlaceholderText('Mô tả công việc bạn muốn thực hiện...');
  fireEvent.change(input, { target: { value: content } }); fireEvent.keyDown(input, { key: 'Enter' });
}
it('keeps an in-flight send locked after real Workspace history navigation c1 to c2 and back', async () => {
  render(<App />); await screen.findByText('Saved c1');
  send('First request'); await waitFor(() => expect(sends.map(row => row.convId)).toEqual(['c1']));
  await select('c2'); send('Independent request');
  await waitFor(() => expect(sends.map(row => row.convId)).toEqual(['c1', 'c2']));
  await select('c1');
  fireEvent.change(screen.getByPlaceholderText('Mô tả công việc bạn muốn thực hiện...'), { target: { value: 'Duplicate request' } });
  expect(sendButton()).toBeDisabled();
  fireEvent.keyDown(screen.getByPlaceholderText('Mô tả công việc bạn muốn thực hiện...'), { key: 'Enter' });
  expect(sends.filter(row => row.convId === 'c1')).toHaveLength(1);
  // Complete the original real POST and deliver its terminal event through the
  // current native SSE connection. The request becomes sendable only then.
  await act(async () => {
    reply(sends[0]!.response, { messageId: 'm1' }, 202);
    streams.get('c1')!.write('event: clarification\ndata: {"question":"Đã xử lý"}\n\n');
  });
  await waitFor(() => expect(useChatStore.getState().isPlanning).toBe(false));
  send('After terminal event');
  await waitFor(() => expect(sends.filter(row => row.convId === 'c1')).toHaveLength(2));
});
it('keeps a new conversation creation and its known ID locked while navigating away and back', async () => {
  window.history.replaceState({}, '', '/'); render(<App />);
  await screen.findByRole('button', { name: 'Conversation one' });
  send('Create and plan'); await waitFor(() => expect(creations).toHaveLength(1));
  send('Duplicate before ID'); expect(creations).toHaveLength(1);
  await act(async () => reply(creations[0]!, { conversation: { id: 'c1' } }, 201));
  await waitFor(() => expect(sends.map(row => row.convId)).toEqual(['c1']));
  await select('c2'); await select('c1');
  fireEvent.change(screen.getByPlaceholderText('Mô tả công việc bạn muốn thực hiện...'), { target: { value: 'Duplicate after ID' } });
  expect(sendButton()).toBeDisabled();
  expect(sends).toHaveLength(1);
});
it('clears a late terminal event only for its source conversation, keeping the visible request locked', async () => {
  render(<App />); await screen.findByText('Saved c1'); send('First request');
  await waitFor(() => expect(sends).toHaveLength(1)); await select('c2'); send('Independent request');
  await waitFor(() => expect(sends).toHaveLength(2));
  act(() => handleSSEEvent('clarification', JSON.stringify({ question: 'Old terminal' }), undefined, 'c1'));
  expect(sendButton()).toBeDisabled();
  expect(screen.queryByText('Old terminal')).toBeNull();
  await select('c1'); send('After late terminal');
  await waitFor(() => expect(sends.filter(row => row.convId === 'c1')).toHaveLength(2));
});
it('keeps the current conversation locked when an earlier real POST fails after navigation', async () => {
  render(<App />); await screen.findByText('Saved c1'); send('First request');
  await waitFor(() => expect(sends).toHaveLength(1)); await select('c2'); send('Independent request');
  await waitFor(() => expect(sends).toHaveLength(2));
  await act(async () => reply(sends[0]!.response, { error: 'Không thể gửi.' }, 500));
  await waitFor(() => expect(sends[0]!.response.writableFinished).toBe(true));
  // A harmless real HTTP round trip lets the rejected POST's fetch settle.
  await act(async () => { await nativeFetch(`${base}/api/runtime`); });
  fireEvent.change(screen.getByPlaceholderText('Mô tả công việc bạn muốn thực hiện...'), { target: { value: 'Duplicate c2' } });
  expect(sendButton()).toBeDisabled();
  expect(screen.queryByText(/Lỗi gửi tin nhắn/)).toBeNull();
});
it.each(['plan', 'clarification', 'refusal', 'planning_error'])('unlocks from a durable %s reply when planning completed while the stream was closed', async type => {
  render(<App />); await screen.findByText('Saved c1'); send('First request');
  await waitFor(() => expect(sends).toHaveLength(1));
  await act(async () => reply(sends[0]!.response, { messageId: 'm1' }, 202));
  await waitFor(() => expect(useChatStore.getState().messages.some(row => row.id === 'm1' && row.status === 'sent')).toBe(true));
  await select('c2');
  savedReplies.set('c1', [{ id: 'm1', role: 'user', content: 'First request' }, { id: 'terminal1', role: 'assistant', content: 'Saved terminal', metadata: { type, replyToMessageId: 'm1' } }]);
  await select('c1');
  fireEvent.change(screen.getByPlaceholderText('Mô tả công việc bạn muốn thực hiện...'), { target: { value: 'After saved terminal' } });
  expect(sendButton()).toBeEnabled();
  send('After saved terminal'); await waitFor(() => expect(sends).toHaveLength(2));
});
it.each([202, 500])('ignores an old POST %s after terminal SSE allowed a newer request in the same conversation', async status => {
  render(<App />); await screen.findByText('Saved c1'); send('First request');
  await waitFor(() => expect(sends).toHaveLength(1)); await waitFor(() => expect(streams.has('c1')).toBe(true));
  const first = sends[0]!;
  await act(async () => { streams.get('c1')!.write(`event: clarification\ndata: ${JSON.stringify({ question: 'First terminal', requestId: first.requestId })}\n\n`); });
  await waitFor(() => expect(useChatStore.getState().isPlanning).toBe(false));
  send('New request'); await waitFor(() => expect(sends).toHaveLength(2));
  await act(async () => reply(first.response, status === 202 ? { messageId: 'old-message' } : { error: 'Old failure' }, status));
  await act(async () => { await nativeFetch(`${base}/api/runtime`); });
  fireEvent.change(screen.getByPlaceholderText('Mô tả công việc bạn muốn thực hiện...'), { target: { value: 'Duplicate new request' } });
  expect(sendButton()).toBeDisabled();
  expect(useChatStore.getState().planningByConversation.c1?.requestId).toBe(sends[1]!.requestId);
  expect(useChatStore.getState().planningByConversation.c1?.messageId).toBeUndefined();
  expect(screen.queryByText(/Lỗi gửi tin nhắn/)).toBeNull();
  act(() => handleSSEEvent('clarification', JSON.stringify({ question: 'Stale terminal', requestId: first.requestId }), undefined, 'c1'));
  expect(sendButton()).toBeDisabled();
  expect(screen.queryByText('Stale terminal')).toBeNull();
});
it('does not unlock a newer accepted request from a durable reply to an earlier message', async () => {
  render(<App />); await screen.findByText('Saved c1'); send('New request');
  await waitFor(() => expect(sends).toHaveLength(1));
  await act(async () => reply(sends[0]!.response, { messageId: 'new-message' }, 202));
  await waitFor(() => expect(useChatStore.getState().messages.some(row => row.id === 'new-message')).toBe(true));
  await select('c2');
  savedReplies.set('c1', [{ id: 'old-message', role: 'user', content: 'Old request' }, { id: 'old-terminal', role: 'assistant', content: 'Old terminal', metadata: { type: 'clarification', replyToMessageId: 'old-message' } }, { id: 'new-message', role: 'user', content: 'New request' }]);
  await select('c1');
  fireEvent.change(screen.getByPlaceholderText('Mô tả công việc bạn muốn thực hiện...'), { target: { value: 'Duplicate' } });
  expect(sendButton()).toBeDisabled();
});
it('keeps the selected conversation when asynchronous creation obtains another ID', async () => {
  window.history.replaceState({}, '', '/'); render(<App />);
  await screen.findByRole('button', { name: 'Conversation one' }); send('Create and plan');
  await waitFor(() => expect(creations).toHaveLength(1)); await select('c2');
  await act(async () => reply(creations[0]!, { conversation: { id: 'c1' } }, 201));
  await waitFor(() => expect(sends).toHaveLength(1));
  expect(window.location.pathname).toBe('/c/c2'); expect(screen.getByText('Saved c2')).toBeInTheDocument();
  await select('c1');
  fireEvent.change(screen.getByPlaceholderText('Mô tả công việc bạn muốn thực hiện...'), { target: { value: 'Duplicate' } });
  expect(sendButton()).toBeDisabled();
});
it('clears every conversation planning record when the authenticated session is lost', async () => {
  render(<App />); await screen.findByText('Saved c1'); send('First request');
  await waitFor(() => expect(sends).toHaveLength(1)); await select('c2'); send('Independent request');
  await waitFor(() => expect(sends).toHaveLength(2));
  act(() => authStorage.clearStoredTokens());
  expect(useChatStore.getState().planningByConversation).toEqual({});
  expect(useChatStore.getState().conversationId).toBeNull();
});
