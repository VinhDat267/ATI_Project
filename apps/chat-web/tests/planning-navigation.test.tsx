/** @vitest-environment jsdom */
import { createServer, type Server, type ServerResponse } from 'node:http';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { openHistory, closeCockpitDialog, transcriptText } from './cockpit-test-helpers';
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
  await openHistory();
  // Redesign 11/2026: trang chủ cũng liệt kê hội thoại gần đây; chọn trong ngăn kéo lịch sử.
  const drawer = await screen.findByRole('dialog', { name: 'Lịch sử yêu cầu' });
  fireEvent.click(await within(drawer).findByRole('button', { name: id === 'c1' ? 'Conversation one' : 'Conversation two' }));
  await transcriptText(`Saved ${id}`);
  await waitFor(() => expect(streams.has(id)).toBe(true));
}
it('replaces the temporary New draft so one Back returns to the previous conversation', async () => {
  render(<App />); await transcriptText('Saved c1');
  fireEvent.click(newConversationButton());
  expect(window.location.pathname).toBe('/');
  send('First request in the draft');
  await waitFor(() => expect(creations).toHaveLength(1));
  await act(async () => reply(creations[0]!, { conversation: { id: 'c-new' } }, 201));
  await waitFor(() => expect(window.location.pathname).toBe('/c/c-new'));
  act(() => window.history.back());
  await transcriptText('Saved c1');
  expect(window.location.pathname).toBe('/c/c1');
  act(() => window.history.forward());
  await waitFor(() => expect(window.location.pathname).toBe('/c/c-new'));
});
function sendButton() { return within(screen.getByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ }).closest('form') ?? screen.getByRole('region', {name:/Cockpit|Tôi sẽ làm|Đang thực hiện công việc|Đã xong/})).getByRole('button', { name: /^(Gửi|Gửi tin nhắn|Gửi yêu cầu|Xác nhận và tiếp tục)$/ }); }
function send(content: string) {
  const input = screen.getByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ });
  fireEvent.change(input, { target: { value: content } }); fireEvent.keyDown(input, { key: 'Enter' });
}
it('keeps an in-flight send locked after real Workspace history navigation c1 to c2 and back', async () => {
  render(<App />); await transcriptText('Saved c1');
  send('First request'); await waitFor(() => expect(sends.map(row => row.convId)).toEqual(['c1']));
  await select('c2'); send('Independent request');
  await waitFor(() => expect(sends.map(row => row.convId)).toEqual(['c1', 'c2']));
  await select('c1');
  fireEvent.change(screen.getByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ }), { target: { value: 'Duplicate request' } });
  expect(sendButton()).toBeDisabled();
  fireEvent.keyDown(screen.getByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ }), { key: 'Enter' });
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
  await historyReady();
  send('Create and plan'); await waitFor(() => expect(creations).toHaveLength(1));
  send('Duplicate before ID'); expect(creations).toHaveLength(1);
  await act(async () => reply(creations[0]!, { conversation: { id: 'c1' } }, 201));
  await waitFor(() => expect(sends.map(row => row.convId)).toEqual(['c1']));
  await select('c2'); await select('c1');
  fireEvent.change(screen.getByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ }), { target: { value: 'Duplicate after ID' } });
  expect(sendButton()).toBeDisabled();
  expect(sends).toHaveLength(1);
});
it('clears a late terminal event only for its source conversation, keeping the visible request locked', async () => {
  render(<App />); await transcriptText('Saved c1'); send('First request');
  await waitFor(() => expect(sends).toHaveLength(1)); await select('c2'); send('Independent request');
  await waitFor(() => expect(sends).toHaveLength(2));
  act(() => handleSSEEvent('clarification', JSON.stringify({ question: 'Old terminal' }), undefined, 'c1'));
  expect(sendButton()).toBeDisabled();
  expect(screen.queryByText('Old terminal')).toBeNull();
  await select('c1'); send('After late terminal');
  await waitFor(() => expect(sends.filter(row => row.convId === 'c1')).toHaveLength(2));
});
it('keeps the current conversation locked when an earlier real POST fails after navigation', async () => {
  render(<App />); await transcriptText('Saved c1'); send('First request');
  await waitFor(() => expect(sends).toHaveLength(1)); await select('c2'); send('Independent request');
  await waitFor(() => expect(sends).toHaveLength(2));
  await act(async () => reply(sends[0]!.response, { error: 'Không thể gửi.' }, 500));
  await waitFor(() => expect(sends[0]!.response.writableFinished).toBe(true));
  // A harmless real HTTP round trip lets the rejected POST's fetch settle.
  await act(async () => { await nativeFetch(`${base}/api/runtime`); });
  fireEvent.change(screen.getByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ }), { target: { value: 'Duplicate c2' } });
  expect(sendButton()).toBeDisabled();
  expect(screen.queryByText(/Lỗi gửi tin nhắn/)).toBeNull();
});
it.each(['plan', 'clarification', 'refusal', 'planning_error'])('unlocks from a durable %s reply when planning completed while the stream was closed', async type => {
  render(<App />); await transcriptText('Saved c1'); send('First request');
  await waitFor(() => expect(sends).toHaveLength(1));
  await act(async () => reply(sends[0]!.response, { messageId: 'm1' }, 202));
  await waitFor(() => expect(useChatStore.getState().messages.some(row => row.id === 'm1' && row.status === 'sent')).toBe(true));
  await select('c2');
  savedReplies.set('c1', [{ id: 'm1', role: 'user', content: 'First request' }, { id: 'terminal1', role: 'assistant', content: 'Saved terminal', metadata: { type, replyToMessageId: 'm1' } }]);
  await select('c1');
  fireEvent.change(screen.getByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ }), { target: { value: 'After saved terminal' } });
  expect(sendButton()).toBeEnabled();
  send('After saved terminal'); await waitFor(() => expect(sends).toHaveLength(2));
});
it.each([202, 500])('ignores an old POST %s after terminal SSE allowed a newer request in the same conversation', async status => {
  render(<App />); await transcriptText('Saved c1'); send('First request');
  await waitFor(() => expect(sends).toHaveLength(1)); await waitFor(() => expect(streams.has('c1')).toBe(true));
  const first = sends[0]!;
  await act(async () => { streams.get('c1')!.write(`event: clarification\ndata: ${JSON.stringify({ question: 'First terminal', requestId: first.requestId })}\n\n`); });
  await waitFor(() => expect(useChatStore.getState().isPlanning).toBe(false));
  send('New request'); await waitFor(() => expect(sends).toHaveLength(2));
  await act(async () => reply(first.response, status === 202 ? { messageId: 'old-message' } : { error: 'Old failure' }, status));
  await act(async () => { await nativeFetch(`${base}/api/runtime`); });
  fireEvent.change(screen.getByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ }), { target: { value: 'Duplicate new request' } });
  expect(sendButton()).toBeDisabled();
  expect(useChatStore.getState().planningByConversation.c1?.requestId).toBe(sends[1]!.requestId);
  expect(useChatStore.getState().planningByConversation.c1?.messageId).toBeUndefined();
  expect(screen.queryByText(/Lỗi gửi tin nhắn/)).toBeNull();
  act(() => handleSSEEvent('clarification', JSON.stringify({ question: 'Stale terminal', requestId: first.requestId }), undefined, 'c1'));
  expect(sendButton()).toBeDisabled();
  expect(screen.queryByText('Stale terminal')).toBeNull();
});
it('does not unlock a newer accepted request from a durable reply to an earlier message', async () => {
  render(<App />); await transcriptText('Saved c1'); send('New request');
  await waitFor(() => expect(sends).toHaveLength(1));
  await act(async () => reply(sends[0]!.response, { messageId: 'new-message' }, 202));
  await waitFor(() => expect(useChatStore.getState().messages.some(row => row.id === 'new-message')).toBe(true));
  await select('c2');
  savedReplies.set('c1', [{ id: 'old-message', role: 'user', content: 'Old request' }, { id: 'old-terminal', role: 'assistant', content: 'Old terminal', metadata: { type: 'clarification', replyToMessageId: 'old-message' } }, { id: 'new-message', role: 'user', content: 'New request' }]);
  await select('c1');
  fireEvent.change(screen.getByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ }), { target: { value: 'Duplicate' } });
  expect(sendButton()).toBeDisabled();
});
it('keeps the selected conversation when asynchronous creation obtains another ID', async () => {
  window.history.replaceState({}, '', '/'); render(<App />);
  await historyReady(); send('Create and plan');
  await waitFor(() => expect(creations).toHaveLength(1)); await select('c2');
  await act(async () => reply(creations[0]!, { conversation: { id: 'c1' } }, 201));
  await waitFor(() => expect(sends).toHaveLength(1));
  expect(window.location.pathname).toBe('/c/c2'); expect(within(screen.getByRole('log')).getByText('Saved c2')).toBeInTheDocument();
  await select('c1');
  fireEvent.change(screen.getByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ }), { target: { value: 'Duplicate' } });
  expect(sendButton()).toBeDisabled();
});
it('clears every conversation planning record when the authenticated session is lost', async () => {
  render(<App />); await transcriptText('Saved c1'); send('First request');
  await waitFor(() => expect(sends).toHaveLength(1)); await select('c2'); send('Independent request');
  await waitFor(() => expect(sends).toHaveLength(2));
  act(() => authStorage.clearStoredTokens());
  expect(useChatStore.getState().planningByConversation).toEqual({});
  expect(useChatStore.getState().conversationId).toBeNull();
});
async function historyReady() { await openHistory(); await within(await screen.findByRole('dialog', { name: 'Lịch sử yêu cầu' })).findByRole('button', { name: 'Conversation one' }); closeCockpitDialog(); }
const newConversationButton = () => { closeCockpitDialog(); fireEvent.click(screen.getByRole('button', {name:'Mở danh sách hội thoại'})); return screen.getByRole('button', { name: /Cuộc hội thoại mới/ }); };
it('keeps the draft open on creation failure and retains the previous conversation planning record', async () => {
  render(<App />); await transcriptText('Saved c1');
  send('Existing c1 request'); await waitFor(() => expect(sends).toHaveLength(1));
  const requestId = sends[0]!.requestId;
  fireEvent.click(newConversationButton());
  send('Request from the draft');
  await waitFor(() => expect(creations).toHaveLength(1));
  await act(async () => reply(creations[0]!, { error: 'Creation failed' }, 500));
  await screen.findByText(/Không thể tạo phiên hội thoại mới/);
  expect(window.location.pathname).toBe('/');
  act(() => window.history.back());
  await transcriptText('Saved c1');
  expect(window.location.pathname).toBe('/c/c1');
  expect(useChatStore.getState().planningByConversation.c1?.requestId).toBe(requestId);
  fireEvent.change(screen.getByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ }), { target: { value: 'Still locked' } });
  expect(sendButton()).toBeDisabled();
});
it('keeps another selected conversation when draft creation fails', async () => {
  render(<App />); await transcriptText('Saved c1');
  fireEvent.click(newConversationButton()); send('Request that will fail');
  await waitFor(() => expect(creations).toHaveLength(1));
  await select('c2');
  await act(async () => reply(creations[0]!, { error: 'Creation failed' }, 500));
  await waitFor(() => expect(useChatStore.getState().planningByConversation.__draft__).toBeUndefined());
  expect(window.location.pathname).toBe('/c/c2');
  expect(within(screen.getByRole('log')).getByText('Saved c2')).toBeInTheDocument();
  expect(screen.queryByText('Saved c1')).toBeNull();
});
it('releases a known failed POST after leaving Workspace without restoring its error UI', async () => {
  render(<App />); await transcriptText('Saved c1');
  send('Request that will fail'); await waitFor(() => expect(sends).toHaveLength(1));
  act(() => { window.history.pushState({}, '', '/admin/users'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await waitFor(() => expect(screen.queryByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ })).toBeNull());
  await act(async () => { reply(sends[0]!.response, { error: 'Rejected request' }, 500); await nativeFetch(`${base}/api/runtime`); });
  expect(useChatStore.getState().planningByConversation.c1).toBeUndefined();
  act(() => { window.history.pushState({}, '', '/c/c1'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await transcriptText('Saved c1');
  fireEvent.change(screen.getByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ }), { target: { value: 'Retry after returning' } });
  expect(sendButton()).toBeEnabled();
  expect(screen.queryByText(/Lỗi gửi tin nhắn/)).toBeNull();
});
async function leaveWorkspaceAndReturn() {
  act(() => { window.history.pushState({}, '', '/admin/users'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await waitFor(() => expect(screen.queryByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ })).toBeNull());
  act(() => { window.history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); });
  return screen.findByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ });
}
it('releases an unsent draft when leaving Workspace in the same authenticated session', async () => {
  window.history.replaceState({}, '', '/'); render(<App />);
  await historyReady();
  fireEvent.click(newConversationButton());
  send('Queued request before changing view');
  await waitFor(() => expect(creations).toHaveLength(1));
  const input = await leaveWorkspaceAndReturn();
  fireEvent.change(input, { target: { value: 'Sendable after returning' } });
  expect(sendButton()).toBeEnabled();
  expect(useChatStore.getState().planningByConversation).toEqual({});
  await act(async () => { reply(creations[0]!, { conversation: { id: 'c-old' } }, 201); await nativeFetch(`${base}/api/runtime`); });
  expect(sends).toHaveLength(0); expect(input).toHaveValue('Sendable after returning');
});
it('keeps a newer draft owned after an abandoned creation responds late', async () => {
  window.history.replaceState({}, '', '/'); render(<App />);
  await historyReady();
  fireEvent.click(newConversationButton()); send('Abandoned request');
  await waitFor(() => expect(creations).toHaveLength(1)); await leaveWorkspaceAndReturn();
  send('New request after returning'); await waitFor(() => expect(creations).toHaveLength(2));
  const requestId = useChatStore.getState().planningByConversation.__draft__?.requestId;
  await act(async () => { reply(creations[0]!, { conversation: { id: 'c-old' } }, 201); await nativeFetch(`${base}/api/runtime`); });
  expect(useChatStore.getState().planningByConversation.__draft__?.requestId).toBe(requestId);
  expect(sends).toHaveLength(0);
  await act(async () => reply(creations[1]!, { conversation: { id: 'c-fresh' } }, 201));
  await waitFor(() => expect(sends).toHaveLength(1));
  expect(sends[0]).toMatchObject({ convId: 'c-fresh', content: 'New request after returning', requestId });
});
it.each(['logout', 'unmount'])('discards a late draft creation response after %s', async reason => {
  window.history.replaceState({}, '', '/'); render(<App />);
  await historyReady();
  fireEvent.click(newConversationButton());
  send('Request from the previous workspace');
  await waitFor(() => expect(creations).toHaveLength(1));
  if (reason === 'logout') act(() => authStorage.clearStoredTokens());
  else { cleanup(); useChatStore.getState().reset(); }
  await act(async () => {
    reply(creations[0]!, { conversation: { id: 'c-new' } }, 201);
    await nativeFetch(`${base}/api/runtime`);
  });
  expect(useChatStore.getState().conversationId).toBeNull();
  expect(useChatStore.getState().messages).toEqual([]);
  expect(useChatStore.getState().planningByConversation).toEqual({});
  expect(sends).toHaveLength(0);
});
it('sends to the selected conversation while a separate draft is being saved', async () => {
  window.history.replaceState({}, '', '/'); render(<App />);
  await historyReady();
  fireEvent.click(newConversationButton()); send('Message in the draft');
  await waitFor(() => expect(creations).toHaveLength(1));
  await select('c2'); send('Message intended for c2');
  await waitFor(() => expect(sends).toHaveLength(1));
  await act(async () => reply(creations[0]!, { conversation: { id: 'c-new' } }, 201));
  await waitFor(() => expect(sends).toHaveLength(2));
  expect(sends[0]).toMatchObject({ convId: 'c2', content: 'Message intended for c2' });
  expect(sends[1]).toMatchObject({ convId: 'c-new', content: 'Message in the draft' });
  expect(window.location.pathname).toBe('/c/c2');
  expect(useChatStore.getState().planningByConversation.c2?.requestId).toBe(sends[0]!.requestId);
});
it('locks the first send and retains the next typed message before the ID arrives', async () => {
  render(<App />); await transcriptText('Saved c1');
  fireEvent.click(newConversationButton());
  send('First queued request');
  await waitFor(() => expect(creations).toHaveLength(1));
  const input = screen.getByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ });
  fireEvent.change(input, { target: { value: 'Second typed request' } });
  expect(sendButton()).toBeDisabled();
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(input).toHaveValue('Second typed request');
  expect(creations).toHaveLength(1); expect(sends).toHaveLength(0);
  await act(async () => reply(creations[0]!, { conversation: { id: 'c-new' } }, 201));
  await waitFor(() => expect(sends).toHaveLength(1));
  expect(sends[0]).toMatchObject({ convId: 'c-new', content: 'First queued request' });
});
it('creates a conversation on the first send and displays the request being planned', async () => {
  window.history.replaceState({}, '', '/'); render(<App />);
  await historyReady();
  fireEvent.click(newConversationButton());
  send('Plan in the new conversation');
  await waitFor(() => expect(creations).toHaveLength(1));
  await act(async () => reply(creations[0]!, { conversation: { id: 'c-new' } }, 201));
  await waitFor(() => expect(sends.map(row => [row.convId, row.content])).toEqual([['c-new', 'Plan in the new conversation']]));
  expect(creations).toHaveLength(1);
  expect(window.location.pathname).toBe('/c/c-new');
  // FE-12: the request left the top bar; while planning, discovery shows it in its heading.
  expect(document.querySelector('#moment-2-query-display')).toHaveTextContent('Plan in the new conversation');
  expect(screen.getByText('Đang lập kế hoạch…')).toBeInTheDocument();
});
it('sends the draft into a new conversation after leaving a saved one', async () => {
  render(<App />); await transcriptText('Saved c1');
  fireEvent.click(newConversationButton());
  send('Plan after leaving c1');
  await waitFor(() => expect(creations).toHaveLength(1));
  await act(async () => reply(creations[0]!, { conversation: { id: 'c-new' } }, 201));
  await waitFor(() => expect(sends).toHaveLength(1));
  expect(sends[0]).toMatchObject({ convId: 'c-new', content: 'Plan after leaving c1' });
  expect(window.location.pathname).toBe('/c/c-new');
  expect(screen.getByText('Đang lập kế hoạch…')).toBeInTheDocument();
});
it('keeps a fresh draft open when the earlier request gets its conversation ID', async () => {
  window.history.replaceState({}, '', '/'); render(<App />);
  await historyReady();
  fireEvent.click(newConversationButton()); send('First draft request');
  await waitFor(() => expect(creations).toHaveLength(1));
  fireEvent.click(newConversationButton());
  const composer = () => screen.getByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện/ });
  fireEvent.change(composer(), { target: { value: 'Second draft' } });
  await act(async () => reply(creations[0]!, { conversation: { id: 'c-new' } }, 201));
  await waitFor(() => expect(sends).toHaveLength(1));
  expect(sends[0]).toMatchObject({ convId: 'c-new', content: 'First draft request' });
  expect(window.location.pathname).toBe('/');
  expect(composer()).toHaveValue('Second draft');
  expect(sendButton()).toBeEnabled();
  fireEvent.keyDown(composer(), { key: 'Enter' });
  await waitFor(() => expect(creations).toHaveLength(2));
  await act(async () => reply(creations[1]!, { conversation: { id: 'c-next' } }, 201));
  await waitFor(() => expect(sends).toHaveLength(2));
  expect(sends[1]).toMatchObject({ convId: 'c-next', content: 'Second draft' });
});
it('opens another draft without a POST after the first conversation opens', async () => {
  window.history.replaceState({}, '', '/'); render(<App />);
  await historyReady();
  fireEvent.click(newConversationButton()); send('Plan in the first conversation');
  await waitFor(() => expect(creations).toHaveLength(1));
  await act(async () => reply(creations[0]!, { conversation: { id: 'c-new' } }, 201));
  await waitFor(() => expect(window.location.pathname).toBe('/c/c-new'));
  fireEvent.click(newConversationButton());
  expect(window.location.pathname).toBe('/');
  await nativeFetch(`${base}/api/runtime`);
  expect(creations).toHaveLength(1);
});
it('unlocks the draft and reports a failed first send when creation fails', async () => {
  window.history.replaceState({}, '', '/'); render(<App />);
  await historyReady();
  fireEvent.click(newConversationButton());
  send('Plan without a conversation');
  await waitFor(() => expect(creations).toHaveLength(1));
  await act(async () => reply(creations[0]!, { error: 'Máy chủ lỗi' }, 500));
  expect(await screen.findByText(/Không thể tạo phiên hội thoại mới/)).toBeInTheDocument();
  expect(sends).toHaveLength(0); expect(creations).toHaveLength(1);
  fireEvent.change(screen.getByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ }), { target: { value: 'Try again' } });
  expect(sendButton()).toBeEnabled();
});
