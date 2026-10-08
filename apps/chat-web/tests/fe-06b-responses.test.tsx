/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { Cockpit } from '../src/components/Cockpit';
import { useChatStore } from '../src/store/chat-store';
import { handleSSEEvent, resetSSEState } from '../src/hooks/use-sse';
import { loadConversationHistory } from '../src/hooks/use-conversation-history';
import { apiClient } from '../src/services/api-client';
import type { ExecutionSnapshot, User } from '../src/types';

vi.mock('../src/services/api-client', () => ({ apiClient: {
  getRuntime: async () => ({ runtimeMode: 'sandbox' }),
  getConversations: async () => ({ conversations: [] }),
  getConversation: vi.fn(), getActivePlan: vi.fn().mockResolvedValue(null), getLatestExecutionSnapshot: vi.fn().mockResolvedValue(null),
} }));
const prompt = 'Tạo page Notion và issue Jira rồi báo lên Slack #ati-test';
const services = [
  { id: 'notion', name: 'Notion', configured: false, connected: false, connectionStatus: 'unconfigured' as const },
  { id: 'jira', name: 'Jira', configured: false, connected: false, connectionStatus: 'unconfigured' as const },
  { id: 'slack', name: 'Slack', configured: true, connected: false, connectionStatus: 'unchecked' as const },
];
const user = (role: 'admin' | 'member') => ({ id: role, email: `${role}@example.test`, role } as User);
function view(role: 'admin' | 'member' = 'admin') {
  const navigate = vi.fn(), send = vi.fn();
  const rendered = render(<Cockpit user={user(role)} navigate={navigate} services={services} servicesLoading={false} servicesError={null}
    onSendMessage={send} onNewConversation={() => {}} onSelectConversation={() => {}} onSettings={() => {}}
    onApprove={() => {}} onCancel={() => {}} recovery={null} />);
  return { ...rendered, navigate, send };
}
function refusal(unavailableServices?: Array<{ id: string; name: string }>) {
  const store = useChatStore.getState(); store.setConversationId('A');
  store.addMessage({ id: 'u', role: 'user', content: prompt });
  handleSSEEvent('refusal', JSON.stringify({ reason: 'Chưa được kết nối hoặc chưa có tài nguyên được phép.', suggestion: 'Nhờ quản trị viên kết nối dịch vụ.', unavailableServices }), undefined, 'A');
}
beforeEach(() => {
  useChatStore.getState().reset(); resetSSEState();
  vi.mocked(apiClient.getActivePlan).mockResolvedValue(null);
  vi.mocked(apiClient.getLatestExecutionSnapshot).mockResolvedValue(null);
});
afterEach(() => { cleanup(); useChatStore.getState().reset(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('SSE refusal retains server metadata for service-specific admin navigation', async () => {
  refusal([{ id: 'notion', name: 'Notion' }]); const { navigate } = view();
  const link = await screen.findByRole('link', { name: 'Kết nối Notion' });
  expect(link).toHaveAttribute('href', '/settings#notion'); fireEvent.click(link); expect(navigate).toHaveBeenCalledWith('/settings#notion');
  expect(screen.getByText('Chưa có gì được ghi lên công cụ nào.')).toBeInTheDocument();
  const list = screen.getByLabelText('Trạng thái các dịch vụ trong yêu cầu này');
  expect(within(list).getByText('Slack').parentElement?.parentElement).toHaveTextContent('Chưa kiểm tra');
});
it('multiple unavailable services send the admin to the whole settings page', async () => {
  refusal([{ id: 'notion', name: 'Notion' }, { id: 'jira', name: 'Jira' }]); view();
  expect(await screen.findByRole('link', { name: 'Kết nối dịch vụ' })).toHaveAttribute('href', '/settings');
});
it('a member sees the admin instruction and cannot connect services', async () => {
  refusal([{ id: 'notion', name: 'Notion' }]); view('member');
  expect(await screen.findByText(/Chỉ quản trị viên kết nối được dịch vụ mới/)).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Kết nối/ })).toBeNull();
});
it('legacy refusal keeps its reason, edits the original request and sends nothing until submitted', async () => {
  useChatStore.setState({ messages: [{ id: 'u', role: 'user', content: prompt }, { id: 'r', role: 'assistant', content: 'Từ chối yêu cầu: Không hỗ trợ việc này.\nGợi ý: Hãy lưu trữ.', metadata: { type: 'refusal' } }] });
  const { send } = view();
  expect(await screen.findByText('Không hỗ trợ việc này.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Sửa yêu cầu' }));
  expect(screen.getByRole('textbox')).toHaveValue(prompt); await waitFor(() => expect(screen.getByRole('textbox')).toHaveFocus()); expect(send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /Thử:/ })); expect(screen.getByRole('textbox')).toHaveValue('Hãy lưu trữ.');
});
it('durable clarification restores question and choices after reload', async () => {
  useChatStore.getState().setConversationId('A');
  vi.mocked(apiClient.getConversation).mockResolvedValue({ conversation: { id: 'A' }, messages: [
    { id: 'u', role: 'user', content: 'Báo kênh #marketing là bản build mới đã lên' },
    { id: 'q', role: 'assistant', content: 'Tôi không thấy kênh #marketing', metadata: { type: 'clarification', options: ['Gửi vào #ati-test'], context: 'Trong các kênh Slack nhóm cho phép, tôi chỉ thấy #ati-test.' } },
  ] } as never);
  await loadConversationHistory('A', () => true); view('member');
  expect(await screen.findByRole('heading', { name: 'Tôi không thấy kênh #marketing' })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'Gửi vào #ati-test' })).toBeInTheDocument();
  expect(screen.getByText(/Hãy báo quản trị viên thêm vào/)).toBeInTheDocument();
});
const completedSnapshot: ExecutionSnapshot = {
  plan: { id: 'old-plan', convId: 'A', status: 'completed', summary: 'Công việc trước', steps: [{ id: 's1', tool: 'slack.send_message', description: 'Gửi thông báo cũ', args: {} }] },
  execution: { status: 'completed' }, recoveryActions: [],
  steps: [{ stepId: 's1', tool: 'slack.send_message', status: 'succeeded', output: { messageId: 'old-message' } }],
};
it.each([
  ['clarification', 'Tôi không thấy kênh #marketing', '3'],
  ['refusal', 'Dịch vụ chưa được kết nối.', 'refusal'],
  ['planning_error', 'Lỗi: upstream failed', '1'],
] as const)('reopening a conversation keeps the latest %s above an older completed receipt', async (type, content, moment) => {
  useChatStore.getState().setConversationId('A');
  vi.mocked(apiClient.getConversation).mockResolvedValue({ conversation: { id: 'A' }, messages: [
    { id: 'old-response', role: 'assistant', content: 'Kế hoạch cũ', metadata: { type: 'plan', planId: 'old-plan' } },
    { id: 'new-request', role: 'user', content: prompt },
    { id: 'new-response', role: type === 'planning_error' ? 'system' : 'assistant', content,
      metadata: { type, options: ['Gửi vào #ati-test'], unavailableServices: [{ id: 'notion', name: 'Notion' }] } },
  ] } as never);
  vi.mocked(apiClient.getLatestExecutionSnapshot).mockResolvedValue(completedSnapshot);
  await loadConversationHistory('A', () => true); const { container } = view();
  expect(container.querySelector('[data-moment]')).toHaveAttribute('data-moment', moment);
  if (type === 'clarification') expect(await screen.findByRole('radio', { name: 'Gửi vào #ati-test' })).toBeInTheDocument();
  if (type === 'refusal') expect(await screen.findByRole('link', { name: 'Kết nối Notion' })).toBeInTheDocument();
  if (type === 'planning_error') expect(await screen.findByText('Không thể lập kế hoạch lúc này. Hãy thử lại.')).toBeInTheDocument();
  expect(useChatStore.getState().executionSnapshot).toEqual(completedSnapshot);
  expect(useChatStore.getState().activePlan).toBeNull();
});
it.each([['unknown', '8'], ['failed', '7']] as const)('restored clarification cannot hide saved %s execution evidence', async (status, moment) => {
  useChatStore.getState().setConversationId('A');
  vi.mocked(apiClient.getConversation).mockResolvedValue({ conversation: { id: 'A' }, messages: [
    { id: 'u', role: 'user', content: prompt },
    { id: 'q', role: 'assistant', content: 'Tôi không thấy kênh #marketing', metadata: { type: 'clarification', options: ['Gửi vào #ati-test'] } },
  ] } as never);
  vi.mocked(apiClient.getLatestExecutionSnapshot).mockResolvedValue({ ...completedSnapshot,
    steps: [{ stepId: 's1', tool: 'slack.send_message', status }],
  });
  await loadConversationHistory('A', () => true); const { container } = view();
  expect(container.querySelector('[data-moment]')).toHaveAttribute('data-moment', moment);
  expect(screen.queryByRole('radio', { name: 'Gửi vào #ati-test' })).toBeNull();
});
it.each(['admin', 'member'] as const)('missing destination shows real planner options and scope help for %s', async role => {
  useChatStore.setState({ messages: [{ id: 'u', role: 'user', content: 'Báo kênh #marketing là bản build mới đã lên' }],
    activeClarification: { question: 'Tôi không thấy kênh #marketing', context: 'Trong các kênh Slack nhóm cho phép, tôi chỉ thấy #ati-test.', options: ['Gửi vào #ati-test'] } });
  const { send } = view(role);
  if (role === 'admin') expect(await screen.findByRole('link', { name: /Thêm ở Kết nối dịch vụ/ })).toHaveAttribute('href', '/settings#slack');
  else expect(await screen.findByText(/Hãy báo quản trị viên thêm vào/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', { name: 'Gửi vào #ati-test' })); expect(send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận và tiếp tục' })); expect(send).toHaveBeenCalledWith('Gửi vào #ati-test');
});
it('multiple destinations visibly identify the selected answer after focus moves to confirmation', async () => {
  useChatStore.setState({ messages: [{ id: 'u', role: 'user', content: prompt }], activeClarification: {
    question: 'Tôi không thấy nơi cần ghi', options: ['Gửi vào #ati-test', 'Gửi vào #review'],
  } });
  const { send } = view();
  const first = await screen.findByRole('radio', { name: 'Gửi vào #ati-test' });
  const second = screen.getByRole('radio', { name: 'Gửi vào #review' });
  fireEvent.click(first); expect(within(first).getByText('Đã chọn')).toBeVisible();
  fireEvent.click(second); screen.getByRole('button', { name: 'Xác nhận và tiếp tục' }).focus();
  expect(within(first).queryByText('Đã chọn')).toBeNull();
  expect(within(second).getByText('Đã chọn')).toBeVisible();
  expect(second).toHaveAttribute('aria-checked', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận và tiếp tục' }));
  expect(send).toHaveBeenCalledWith('Gửi vào #review');
});
it('read-only clarification uses planner choices without inventing destinations or write results', async () => {
  useChatStore.setState({ messages: [{ id: 'u', role: 'user', content: 'Liệt kê các issue đang mở trong ati-test' }],
    activeClarification: { question: 'Bạn muốn làm gì với danh sách issue này?', context: 'Bạn muốn ghi hoặc gửi danh sách này ở đâu?', options: ['Gửi danh sách lên Slack'] } });
  view(); expect(await screen.findByText('Chưa có gì được ghi lên công cụ nào.')).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'Gửi danh sách lên Slack' })).toBeInTheDocument();
  expect(screen.queryByText('Tạo một card Trello tổng hợp')).toBeNull();
  expect(screen.getAllByRole('textbox')).toHaveLength(1);
});
it('a Vietnamese read-only request selects the expanded view even with a generic planner question', async () => {
  useChatStore.setState({ messages: [{ id: 'u', role: 'user', content: 'Liệt kê các issue đang mở' }],
    activeClarification: { question: 'Bạn muốn thực hiện hành động nào với kết quả này?', options: ['Gửi lên Slack'] } });
  view(); expect(await screen.findByRole('button', { name: 'Sửa yêu cầu' })).toBeInTheDocument();
});
it('server planning failure uses the system copy and retries only the original planning request', async () => {
  useChatStore.setState({ messages: [{ id: 'u', role: 'user', content: prompt }, { id: 'e', role: 'system', content: 'Lỗi: upstream failed', metadata: { type: 'planning_error' } }] });
  const { send } = view();
  expect(await screen.findByText('Không thể lập kế hoạch lúc này. Hãy thử lại.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' })); expect(send).toHaveBeenCalledWith(prompt);
  expect(screen.queryByText(/upstream failed/)).toBeNull();
});
it('after fifteen seconds uses actual gather progress; stopping the wait retains the request lock and a late plan still needs approval', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-08T10:00:00Z'));
  const store = useChatStore.getState(); store.setConversationId('A'); store.addMessage({ id: 'u', role: 'user', content: prompt }); store.beginPlanning('A', 'r1');
  store.setGatherState({ isGathering: true, summary: '1/2 công cụ đã khảo sát', steps: [{ tool: 'slack.list_channels', status: 'completed', result: '#ati-test' }, { tool: 'jira.search_issues', status: 'running' }] });
  view(); act(() => { vi.advanceTimersByTime(15_000); });
  expect(screen.queryByRole('button', { name: 'Thôi chờ, giữ lại câu yêu cầu' })).toBeNull();
  act(() => { vi.advanceTimersByTime(250); });
  expect(screen.getByRole('button', { name: 'Thôi chờ, giữ lại câu yêu cầu' })).toBeInTheDocument();
  expect(screen.getByText('#ati-test')).toBeInTheDocument(); expect(screen.getByText('Đang chờ phản hồi…')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Thôi chờ, giữ lại câu yêu cầu' }));
  expect(screen.getByRole('textbox')).toHaveValue(prompt); expect(store.beginPlanning('A', 'r2')).toBe(false);
  expect(screen.getByText('Nếu kế hoạch đến sau, nó vẫn nằm trong hội thoại và chưa chạy cho tới khi bạn duyệt.')).toBeInTheDocument();
  act(() => handleSSEEvent('plan_preview', JSON.stringify({ requestId: 'r1', planId: 'p1', plan: { summary: 'Plan muộn', steps: [{ id: 's1', tool: 'slack.send_message', description: 'Gửi thông báo', args: { channel: '#ati-test', text: 'hello' } }] } }), undefined, 'A'));
  expect(screen.getByRole('button', { name: 'Duyệt kế hoạch' })).toBeInTheDocument(); expect(useChatStore.getState().planStatus).toBe('preview');
});
it('old refusal from conversation A cannot add a settings action to conversation B', async () => {
  useChatStore.getState().setConversationId('B'); view('member');
  act(() => handleSSEEvent('refusal', JSON.stringify({ reason: 'Late A', unavailableServices: [{ id: 'notion', name: 'Notion' }] }), undefined, 'A'));
  expect(screen.queryByText('Late A')).toBeNull(); expect(screen.queryByRole('link', { name: 'Kết nối Notion' })).toBeNull();
});
