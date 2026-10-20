/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Cockpit } from '../src/components/Cockpit';
import { SlowPlanningMoment } from '../src/pages/Errors/PlanningErrors';
import { useChatStore } from '../src/store/chat-store';
import { apiClient } from '../src/services/api-client';

vi.mock('../src/services/api-client', () => ({
  apiClient: {
    getRuntime: vi.fn(async () => ({ runtimeMode: 'sandbox' })),
    getConversations: async () => ({ conversations: [] }),
  },
}));
const request = 'Tạo issue GitHub rồi báo Slack #ati-test';
const services = [{ id: 'github', name: 'GitHub', configured: true, connected: true, connectionStatus: 'healthy' as const }];
const plan = { id: 'p1', summary: 'Tạo issue', steps: [{ id: 's1', tool: 'github.create_issue', description: 'Tạo issue', args: { repo: 'ati/test', title: 'Test' } }] };
const userMessage = { id: 'u', role: 'user' as const, content: request };
const admin = { id: 'a1', name: 'Quản Trị', email: 'admin@example.test', role: 'admin' as const };
function setup() {
  return render(<Cockpit user={admin} navigate={vi.fn()} onLogout={vi.fn()} services={services} servicesLoading={false} servicesError={null} onSendMessage={vi.fn()} onNewConversation={vi.fn()} onSelectConversation={vi.fn()} onSettings={vi.fn()} onApprove={vi.fn()} onCancel={vi.fn()} recovery={null} />);
}
const echo = () => document.querySelector<HTMLElement>('[data-request-echo]');
function expectEchoAboveHeading() {
  const line = echo();
  expect(line).not.toBeNull();
  expect(line).toHaveTextContent(`Bạn nhờ: “${request}”`);
  expect(line).toHaveAttribute('title', request);
  const heading = screen.getByRole('heading', { level: 1 });
  expect(line!.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(document.querySelectorAll('[data-request-echo]')).toHaveLength(1);
}
afterEach(() => { cleanup(); useChatStore.getState().reset(); vi.mocked(apiClient.getRuntime).mockResolvedValue({ runtimeMode: 'sandbox' }); });

it.each([
  ['3 (clarification)', { activeClarification: { question: 'Chọn kho nào?', options: ['Kho A', 'Kho B'] } }],
  ['4 (plan)', { activePlan: plan, planStatus: 'preview' }],
  ['5 (executing)', { activePlan: plan, planStatus: 'executing', stepStatuses: { s1: 'running' } }],
  ['6 (receipt)', { activePlan: plan, planStatus: 'completed', stepStatuses: { s1: 'succeeded' } }],
  ['unsuccessful', { activePlan: plan, planStatus: 'stopped' }],
  ['7 (known failure)', { activePlan: plan, planStatus: 'executing', stepStatuses: { s1: 'failed' } }],
  ['8 (unknown result)', { activePlan: plan, planStatus: 'executing', stepStatuses: { s1: 'unknown' } }],
  ['9 (reconciliation)', { activePlan: plan, planStatus: 'reconciliation_required' }],
])('FE-12: moment %s shows the request just above its heading', (_label, state) => {
  useChatStore.setState({ messages: [userMessage], ...(state as object) });
  setup();
  expectEchoAboveHeading();
});

it.each([
  ['1 (no request yet)', { messages: [] }],
  ['2 (discovery already shows the request)', { messages: [userMessage], isPlanning: true }],
  ['answer (response card already shows the request)', { messages: [userMessage, { id: 'a', role: 'assistant', content: 'Có 2 issue.', metadata: { type: 'answer', lookups: [{ tool: 'github.search_issues', query: 'is:open', resultCount: 2 }] } }] }],
  ['refusal (response card already shows the request)', { planStatus: 'rejected', messages: [userMessage, { id: 'r', role: 'assistant', content: 'Từ chối yêu cầu: chưa kết nối.', metadata: { type: 'refusal' } }] }],
])('FE-12: moment %s has no extra request line', (_label, state) => {
  useChatStore.setState(state as object);
  setup();
  expect(echo()).toBeNull();
});

it('FE-12: the cockpit bar no longer carries the current request and keeps both drawer buttons', async () => {
  useChatStore.setState({ messages: [userMessage], activePlan: plan, planStatus: 'preview' });
  setup();
  await act(async () => {});
  const banner = screen.getByRole('banner');
  expect(document.querySelector('#top-bar-query-container')).toBeNull();
  expect(within(banner).queryByText(request)).toBeNull();
  expect(within(screen.getByRole('navigation', { name: 'Điều hướng chính' })).getByRole('link', { name: 'Không gian làm việc' })).toHaveAttribute('aria-current', 'page');
  const history = within(banner).getByRole('button', { name: 'Mở danh sách hội thoại' });
  expect(history).toHaveAttribute('id', 'btn-open-history');
  fireEvent.click(history);
  expect(history).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('dialog', { name: 'Lịch sử yêu cầu' })).toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(history).toHaveFocus();
  const chat = within(banner).getByRole('button', { name: 'Xem hội thoại' });
  expect(chat).toHaveAttribute('id', 'btn-open-chat');
  fireEvent.click(chat);
  expect(screen.getByRole('dialog', { name: 'Nhật ký hội thoại' })).toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(chat).toHaveFocus();
});

it('FE-12: the conversation button stays hidden before the first request', () => {
  setup();
  expect(document.querySelector('#btn-open-chat')).toHaveClass('hidden!');
});

it('FE-12: a long request keeps its full text in the DOM while the line is clamped to two lines', () => {
  const long = `${'Tạo issue rất dài '.repeat(30)}kết thúc`;
  useChatStore.setState({ messages: [{ ...userMessage, content: long }], activePlan: plan, planStatus: 'preview' });
  setup();
  expect(echo()).toHaveTextContent(long);
  expect(echo()).toHaveClass('line-clamp-2');
});

it('FE-12: slow planning shows the request above its heading', () => {
  render(<SlowPlanningMoment request={request} seconds={20} gather={null} services={services} onDismiss={vi.fn()} />);
  expectEchoAboveHeading();
});
