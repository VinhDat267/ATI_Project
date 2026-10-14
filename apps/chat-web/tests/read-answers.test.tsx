/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react';
import { Cockpit } from '../src/components/Cockpit';
import { useChatStore } from '../src/store/chat-store';
import { handleSSEEvent, resetSSEState } from '../src/hooks/use-sse';
import { loadConversationHistory } from '../src/hooks/use-conversation-history';
import { apiClient } from '../src/services/api-client';

vi.mock('../src/services/api-client', () => ({ apiClient: {
  getRuntime: async () => ({ runtimeMode: 'sandbox' }), getConversations: async () => ({ conversations: [] }),
  getConversation: vi.fn(), getActivePlan: vi.fn().mockResolvedValue(null), getLatestExecutionSnapshot: vi.fn().mockResolvedValue(null),
} }));
const text = '<b>x</b> https://a.example';
const lookup = { tool: 'slack.search_channels', query: 'frontend', resultCount: 2,
  links: ['https://a.example', 'http://unsafe.example', 'javascript:alert(1)'] };
function view() { return render(<Cockpit services={[{ id: 'slack', name: 'Slack', connected: true }]}
  servicesLoading={false} servicesError={null} onSendMessage={() => {}} onNewConversation={() => {}}
  onSelectConversation={() => {}} onSettings={() => {}} onApprove={() => {}} onCancel={() => {}} recovery={null} />); }
function receive(lookups = [lookup], usedDirectory: string[] = []) {
  const store = useChatStore.getState(); store.setConversationId('A');
  store.addMessage({ id: 'u', role: 'user', content: 'Xem Slack' });
  store.beginPlanning('A', 'r');
  handleSSEEvent('answer', JSON.stringify({ text, lookups, usedDirectory, replyToMessageId: 'u', requestId: 'r' }), 1, 'A');
}
beforeEach(() => { useChatStore.getState().reset(); resetSSEState(); vi.mocked(apiClient.getActivePlan).mockResolvedValue(null); });
afterEach(() => { cleanup(); useChatStore.getState().reset(); vi.clearAllMocks(); });
it('ANS-01 renders plain text from SSE, safe provenance links and one composer', async () => {
  receive(); const { container } = view();
  expect(await screen.findByText(text)).toBeInTheDocument();
  expect(container.querySelector('[data-answer-text] b')).toBeNull();
  expect(container.querySelector('[data-answer-text] a')).toBeNull();
  expect(useChatStore.getState().isPlanning).toBe(false);
  expect(screen.getByText('Chưa có gì được ghi lên công cụ nào.')).toBeInTheDocument();
  const button = screen.getByRole('button', { name: 'Đã tra cứu' });
  expect(button).toHaveAttribute('aria-expanded', 'false'); fireEvent.click(button);
  expect(button).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText('frontend')).toBeInTheDocument();
  const link = screen.getByRole('link', { name: 'https://a.example' });
  expect(link).toHaveAttribute('target', '_blank'); expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(screen.queryByRole('link', { name: 'http://unsafe.example' })).toBeNull();
  expect(screen.getAllByRole('textbox')).toHaveLength(1);
});
it.each([
  { lookups: [lookup], usedDirectory: [], expected: '1 lần tra cứu' },
  { lookups: [], usedDirectory: ['slack'], expected: 'Danh mục Slack' },
  { lookups: [lookup], usedDirectory: ['slack'], expected: '1 lần tra cứu' },
])('ANS-01 shows truthful sources $expected', async ({ lookups, usedDirectory, expected }) => {
  receive(lookups, usedDirectory); view();
  expect(await screen.findByText(new RegExp(expected))).toBeInTheDocument();
  expect(screen.queryByText(/0 lần tra cứu/)).toBeNull();
  expect(screen.getByText(/hãy kiểm lại ở Slack/)).toBeInTheDocument();
});
it('ANS-01 restores an answer from history without a prior safe receipt taking over', async () => {
  useChatStore.getState().setConversationId('A');
  vi.mocked(apiClient.getConversation).mockResolvedValue({ conversation: { id: 'A' }, messages: [
    { id: 'u', role: 'user', content: 'Xem Slack' },
    { id: 'a', role: 'assistant', content: text, metadata: { type: 'answer', lookups: [lookup], usedDirectory: ['slack'] } },
  ] } as never);
  vi.mocked(apiClient.getActivePlan).mockResolvedValue({ id: 'older-preview', summary: 'Older', steps: [], status: 'pending' });
  await loadConversationHistory('A', () => true);
  act(() => useChatStore.getState().setExecutionSnapshot({ plan: { id: 'old', convId: 'A', status: 'completed' },
    execution: { status: 'completed' }, steps: [], recoveryActions: [] }));
  view(); expect(await screen.findByText(text)).toBeInTheDocument();
});
it('ANS-01 ignores a late answer from another conversation or request', () => {
  receive(); const before = useChatStore.getState().messages;
  handleSSEEvent('answer', JSON.stringify({ text: 'late' }), 2, 'B');
  expect(useChatStore.getState().messages).toEqual(before);
  useChatStore.getState().beginPlanning('A', 'new');
  handleSSEEvent('answer', JSON.stringify({ text: 'late', requestId: 'r' }), 3, 'A');
  expect(useChatStore.getState().isPlanning).toBe(true);
  expect(useChatStore.getState().messages).toEqual(before);
});
