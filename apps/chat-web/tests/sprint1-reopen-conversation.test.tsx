// PBI-03 (Sprint 1): mở lại một hội thoại cũ từ /history phải hiện lại nội dung đã lưu,
// kể cả khi kế hoạch trong hội thoại không còn chờ duyệt (GET /plans/active → 404) và chưa
// từng chạy (GET /executions/latest → 404). Dữ liệu mô phỏng đúng hình dạng quan sát được
// trên trình duyệt thật; các lời gọi hội thoại/kế hoạch/thực thi/dịch vụ đi qua ApiClient thật
// tới fetch giả, để nhánh 404 → null và 500 → lỗi là mã thật của ứng dụng.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../src/App';
import { apiClient } from '../src/services/api-client';
import { authStorage } from '../src/services/auth-storage';
import { useChatStore } from '../src/store/chat-store';

vi.mock('../src/hooks/use-sse', () => ({ useSSE: vi.fn(() => ({ disconnected: false })) }));

const CONV_ID = '8a2a71c5-0000-4000-8000-000000000001';
const REQUEST = 'Tạo card Trello cho lỗi đăng nhập rồi báo kênh Slack #ati-test';
const PLAN_SUMMARY = 'Tạo card Trello và báo Slack';
const user = { id: 'u1', email: 'owner@example.test', name: 'Owner' };
const savedMessages = [
  { id: 'm-user', role: 'user', content: REQUEST, created_at: '2026-11-01T08:00:00.000Z', metadata: { requestId: 'temp-1' } },
  {
    id: 'm-plan', role: 'assistant', content: `Kế hoạch: ${PLAN_SUMMARY}`, created_at: '2026-11-01T08:00:05.000Z',
    metadata: {
      type: 'plan', planId: 'plan-expired', replyToMessageId: 'm-user', resourceLabels: {},
      plan: { kind: 'plan', summary: PLAN_SUMMARY, steps: [
        { id: 'step_1', tool: 'trello.create_card', description: 'Tạo card lỗi đăng nhập', args: {}, dependsOn: [] },
        { id: 'step_2', tool: 'slack.send_message', description: 'Báo kênh #ati-test', args: {}, dependsOn: ['step_1'] },
      ] },
    },
  },
];

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function mockNetwork(servicesStatus: 200 | 500) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    if (path === `/api/conversations/${CONV_ID}`) return json(200, { conversation: { id: CONV_ID, title: REQUEST }, messages: savedMessages });
    if (path === `/api/conversations/${CONV_ID}/plans/active`) return json(404, { error: 'No active pending plan found' });
    if (path === `/api/conversations/${CONV_ID}/executions/latest`) return json(404, { error: 'No execution found' });
    if (path === '/api/services') return servicesStatus === 200
      ? json(200, { services: [{ id: 'slack', name: 'Slack', configured: true, connected: true, connectionStatus: 'healthy' }], canConfigure: false })
      : json(500, { error: 'Không tải được danh mục dịch vụ.' });
    return json(404, { error: 'not mocked' });
  });
}

beforeEach(() => {
  window.history.replaceState({}, '', `/c/${CONV_ID}`);
  authStorage.clearStoredTokens(); authStorage.setStoredTokens({ accessToken: 'access', user });
  useChatStore.getState().reset(); useChatStore.getState().setConversations([]);
  vi.spyOn(apiClient, 'getRuntime').mockResolvedValue({ runtimeMode: 'sandbox' });
  vi.spyOn(apiClient, 'getMe').mockResolvedValue({ user });
  vi.spyOn(apiClient, 'getConversations').mockResolvedValue({ conversations: [{ id: CONV_ID, title: REQUEST }] });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); authStorage.clearStoredTokens(); useChatStore.getState().reset(); });

describe.each([200, 500] as const)('PBI-03: mở lại hội thoại có kế hoạch không còn chờ duyệt (GET /api/services → %i)', servicesStatus => {
  it('hiện lại yêu cầu và kế hoạch đã lưu thay vì màn hình bắt đầu trống', async () => {
    mockNetwork(servicesStatus);
    render(<App />);
    await waitFor(() => expect(useChatStore.getState().messages.map(m => m.id)).toEqual(['m-user', 'm-plan']));
    const main = await screen.findByRole('main');
    // Hội thoại đã lưu nằm ngay trên sân khấu chính, không cần biết tới ngăn kéo.
    const saved = await within(main).findByRole('region', { name: 'Hội thoại đã lưu' });
    expect(within(saved).getByText(REQUEST)).toBeInTheDocument();
    expect(within(saved).getByText(new RegExp(PLAN_SUMMARY))).toBeInTheDocument();
    expect(within(saved).getByText(/không còn chờ duyệt/)).toBeInTheDocument();
    expect(within(main).queryByRole('heading', { level: 1, name: 'Hôm nay bạn muốn nhờ việc gì?' })).toBeNull();
    expect(within(main).getByRole('heading', { level: 1, name: 'Tiếp tục hội thoại này' })).toBeInTheDocument();
    // Nút Xem hội thoại không còn bị ẩn khi đã có tin nhắn lưu.
    const openChat = screen.getByRole('button', { name: 'Xem hội thoại' });
    expect(openChat.className).not.toMatch(/hidden!/);
    fireEvent.click(within(saved).getByRole('button', { name: /Xem toàn bộ hội thoại/ }));
    const log = await screen.findByRole('log');
    expect(within(log).getByText(REQUEST)).toBeInTheDocument();
    expect(within(log).getByText(new RegExp(`Kế hoạch 2 việc đã sẵn sàng: ${PLAN_SUMMARY}`))).toBeInTheDocument();
  });

  it('"Dùng lại yêu cầu" chỉ điền lại ô nhập, không tự gửi', async () => {
    const fetchSpy = mockNetwork(servicesStatus);
    render(<App />);
    const saved = await screen.findByRole('region', { name: 'Hội thoại đã lưu' });
    fireEvent.click(within(saved).getByRole('button', { name: 'Dùng lại yêu cầu này' }));
    expect(screen.getByRole('textbox', { name: 'Mô tả công việc bạn muốn thực hiện' })).toHaveValue(REQUEST);
    expect(fetchSpy.mock.calls.some(([input, init]) => String(input).includes('/messages') && init?.method === 'POST')).toBe(false);
  });
});

it('PBI-03: lỗi tải dịch vụ (500) vẫn được báo, nhưng không che hội thoại đã lưu', async () => {
  mockNetwork(500);
  render(<App />);
  const saved = await screen.findByRole('region', { name: 'Hội thoại đã lưu' });
  expect(within(saved).getByText(REQUEST)).toBeInTheDocument();
  // userErrorMessage() đổi 500 thành câu chung cho người dùng.
  expect(await screen.findByText('Máy chủ gặp lỗi. Hãy thử lại.')).toBeInTheDocument();
});

it('PBI-03: hội thoại mới (chưa có tin nhắn) vẫn là màn hình bắt đầu quen thuộc', async () => {
  window.history.replaceState({}, '', '/');
  mockNetwork(200);
  render(<App />);
  expect(await screen.findByRole('heading', { level: 1, name: 'Hôm nay bạn muốn nhờ việc gì?' })).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Hội thoại đã lưu' })).toBeNull();
});
