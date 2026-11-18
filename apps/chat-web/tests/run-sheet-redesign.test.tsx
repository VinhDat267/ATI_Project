/** @vitest-environment jsdom */
// Redesign 11/2026 bước 3: trang lượt chạy hiện sẵn hội thoại từ 1280 px, biên nhận một bước một hàng,
// và tiêu đề biên nhận không còn là mã thô của dịch vụ.
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { Cockpit } from '../src/components/Cockpit';
import { useChatStore } from '../src/store/chat-store';
import type { ActivePlan, ChatMessage, ExecutionSnapshot } from '../src/types';

vi.mock('../src/services/api-client', () => ({ apiClient: { getRuntime: async () => ({ runtimeMode: 'sandbox' }), getConversations: async () => ({ conversations: [] }) } }));

const realMatchMedia = window.matchMedia;
function viewport(wide: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: wide && query === '(min-width: 1280px)', media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
afterEach(() => { cleanup(); useChatStore.getState().reset(); window.matchMedia = realMatchMedia; vi.restoreAllMocks(); });

const plan: ActivePlan = { id: 'p1', summary: 'Tạo thẻ, gán người, báo nhóm', resourceLabels: { list_1: 'To Do', '#ati-test': '#ati-test' }, steps: [
  { id: 'step_1', tool: 'trello.create_card', description: 'Tạo thẻ "Lỗi đăng nhập Google"', args: { listId: 'list_1', name: 'Lỗi đăng nhập Google' } },
  { id: 'step_2', tool: 'trello.add_member', description: 'Gán Minh vào thẻ vừa tạo', args: { cardId: { $ref: 'step_1.output.id' }, memberId: 'm1' } },
  { id: 'step_3', tool: 'slack.send_message', description: 'Báo kênh #ati-test', args: { channel: '#ati-test', text: 'Đã tạo thẻ' } },
] };
const messages: ChatMessage[] = [
  { id: 'u1', role: 'user', content: 'Tạo card Trello cho lỗi đăng nhập Google và báo #ati-test', status: 'sent', timestamp: '2026-11-18T10:00:00.000Z' },
  { id: 'a1', role: 'assistant', content: 'Kế hoạch 3 việc đã sẵn sàng.', timestamp: '2026-11-18T10:00:02.000Z' },
];
const done: ExecutionSnapshot = {
  plan: { ...plan, id: 'p1', convId: 'c1', status: 'approved' }, execution: { status: 'completed' }, recoveryActions: [],
  steps: [
    { stepId: 'step_1', tool: 'trello.create_card', status: 'succeeded', durationMs: 90, startedAt: '2026-11-18T10:01:00.000Z', completedAt: '2026-11-18T10:01:00.090Z', output: { id: 'card_1794997447841', name: 'Lỗi đăng nhập Google', url: 'https://trello.com/c/abc' } },
    { stepId: 'step_2', tool: 'trello.add_member', status: 'succeeded', durationMs: 40, startedAt: '2026-11-18T10:01:00.100Z', completedAt: '2026-11-18T10:01:00.140Z', output: { id: 'card_1794997447841' } },
    { stepId: 'step_3', tool: 'slack.send_message', status: 'succeeded', durationMs: 60, startedAt: '2026-11-18T10:01:00.150Z', completedAt: '2026-11-18T10:01:00.210Z', output: { messageId: 'm1', url: 'https://slack.com/app_redirect?channel=ati-test' } },
  ],
};
function view() {
  render(<Cockpit services={[{ id: 'trello', name: 'Trello', configured: true, connected: true, connectionStatus: 'healthy' }, { id: 'slack', name: 'Slack', configured: true, connected: true, connectionStatus: 'healthy' }]} servicesLoading={false} servicesError={null} onSendMessage={vi.fn()} onNewConversation={vi.fn()} onSelectConversation={vi.fn()} onSettings={vi.fn()} onApprove={vi.fn()} onCancel={vi.fn()} recovery={null} />);
}

it('from 1280 px the run page shows the conversation beside the plan, without a second log or id', async () => {
  viewport(true);
  useChatStore.setState({ conversationId: 'c1', messages, activePlan: plan, planStatus: 'preview' });
  view();
  await screen.findByRole('heading', { level: 1, name: 'Tôi sẽ làm 3 việc, theo thứ tự' });
  const thread = screen.getByRole('complementary', { name: 'Hội thoại của lượt chạy' });
  expect(within(thread).getByText('Kế hoạch 3 việc đã sẵn sàng.')).toBeInTheDocument();
  expect(screen.queryAllByRole('log')).toHaveLength(0);
  expect(document.getElementById('chat-messages-container')).toBeNull();
  expect(document.getElementById('stage-container')).toHaveClass('xl:grid');
});

it('below 1280 px the run page keeps a single column and the conversation stays in its drawer', async () => {
  viewport(false);
  useChatStore.setState({ conversationId: 'c1', messages, activePlan: plan, planStatus: 'preview' });
  view();
  await screen.findByRole('heading', { level: 1, name: 'Tôi sẽ làm 3 việc, theo thứ tự' });
  expect(screen.queryByRole('complementary', { name: 'Hội thoại của lượt chạy' })).toBeNull();
  expect(document.getElementById('stage-container')).not.toHaveClass('xl:grid');
});

it('the receipt lists one step per row in plan order, data from the previous step stays inside its card', async () => {
  viewport(false);
  useChatStore.setState({ conversationId: 'c1', messages, activePlan: plan, planStatus: 'completed', executionSnapshot: done });
  view();
  await screen.findByRole('heading', { level: 1, name: 'Đã xong 3 việc trên 2 công cụ' });
  const rows = [...document.querySelectorAll('#receipt-chain > div:not([data-receipt-connector])')];
  expect(rows).toHaveLength(3);
  for (const row of rows) {
    expect(row).toHaveClass('grid-cols-1');
    expect(row.children).toHaveLength(1);
  }
  expect(rows[0]).toHaveTextContent('Lỗi đăng nhập Google');
  expect(rows[1]).toHaveTextContent('Gán Minh vào thẻ vừa tạo');
  expect(rows[2]).toHaveTextContent('Báo kênh #ati-test');
  const connector = document.querySelector('[data-receipt-connector]')!;
  expect(connector).toHaveAttribute('data-from', 'step_1');
  expect(connector).toHaveAttribute('data-to', 'step_2');
  expect(connector).toHaveTextContent('Từ Việc 1');
});

it('a Trello member step is titled by what it did, never by the raw card id', async () => {
  viewport(false);
  useChatStore.setState({ conversationId: 'c1', messages, activePlan: plan, planStatus: 'completed', executionSnapshot: done });
  view();
  await screen.findByRole('heading', { level: 1, name: 'Đã xong 3 việc trên 2 công cụ' });
  expect(screen.getByText('Gán Minh vào thẻ vừa tạo')).toBeInTheDocument();
  // Mã thô chỉ còn trong "Chi tiết kỹ thuật" (JSON gốc), không làm tiêu đề hay dòng nào của thẻ.
  expect(screen.queryByText('card_1794997447841')).toBeNull();
});

it('from 1280 px the sticky thread panel reserves space for --cockpit-bottom-space when the bottom bar is active', async () => {
  viewport(true);
  useChatStore.setState({ conversationId: 'c1', messages, activePlan: plan, planStatus: 'completed', executionSnapshot: done });
  view();
  await screen.findByRole('heading', { level: 1, name: 'Đã xong 3 việc trên 2 công cụ' });
  const thread = screen.getByRole('complementary', { name: 'Hội thoại của lượt chạy' });
  expect(document.documentElement.style.getPropertyValue('--cockpit-bottom-space')).toBe('96px');
  expect(thread.className).toContain('--cockpit-bottom-space');
});

it('on Gmail step cards, Xem trước comes after the inline email preview in mobile stacking order', async () => {
  viewport(false);
  const gmailPlan: ActivePlan = {
    id: 'p-gmail',
    summary: 'Gửi email báo cáo',
    resourceLabels: {},
    connections: { gmail: { credentialId: 'cred-1', email: 'me@example.test' } },
    steps: [
      { id: 'step_gmail', tool: 'gmail.send_message', description: 'Gửi email báo cáo', args: { to: ['lan@example.test'], subject: 'Báo cáo tuần', body: 'Nội dung email' } },
    ],
  };
  useChatStore.setState({ conversationId: 'c1', messages, activePlan: gmailPlan, planStatus: 'preview' });
  view();
  await screen.findByRole('heading', { level: 1, name: 'Tôi sẽ làm 1 việc' });
  const previewCard = screen.getByTestId('gmail-preview-card');
  const previewButton = document.getElementById('preview-step_gmail')!;
  expect(previewCard.compareDocumentPosition(previewButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('the approval gate divider sits flush at the top edge and passive plan status avoids the orange primary signal', async () => {
  viewport(false);
  useChatStore.setState({ conversationId: 'c1', messages, activePlan: plan, planStatus: 'preview' });
  view();
  await screen.findByRole('heading', { level: 1, name: 'Tôi sẽ làm 3 việc, theo thứ tự' });
  const gate = document.getElementById('moment-4-sticky-bar')!;
  expect(gate).not.toHaveClass('pt-4');
  expect(gate.firstElementChild).toHaveClass('h-0.5');

  const statusBadge = document.querySelector('[data-plan-status]')!;
  expect(statusBadge.querySelector('.bg-\\[\\#FF5701\\]')).toBeNull();
});

it('receipt result links include a dark-mode underline class', async () => {
  viewport(false);
  useChatStore.setState({ conversationId: 'c1', messages, activePlan: plan, planStatus: 'completed', executionSnapshot: done });
  view();
  await screen.findByRole('heading', { level: 1, name: 'Đã xong 3 việc trên 2 công cụ' });
  const link = screen.getByRole('link', { name: 'Mở card' });
  expect(link.className).toMatch(/\bdark:decoration-/);
});
