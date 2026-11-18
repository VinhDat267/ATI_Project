/** @vitest-environment jsdom */
// Redesign 11/2026 bước 5b: trang Tự động (/inbox) gom Lịch chạy, Hộp thư đề xuất và Bản tóm tắt; Nhật ký chỉ còn hội thoại.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SlackProposalInbox } from '../src/components/slack/SlackProposalInbox';
import { HistoryPage } from '../src/pages/History/HistoryPage';
import { HomeQueue } from '../src/pages/Cockpit/HomeQueue';
import { SchedulesCapabilityContext } from '../src/hooks/use-schedules';
import { apiClient } from '../src/services/api-client';
import { slackConnectionApi } from '../src/services/slack-connection';
import { resetWorkspaceStorage } from '../src/services/workspace-storage';
import { authStorage } from '../src/services/auth-storage';

const user = { id: 'u1', name: 'Lan Nguyễn', email: 'lan@example.test', role: 'member' as const };
const withSchedules = (node: React.ReactNode) => <SchedulesCapabilityContext.Provider value={true}>{node}</SchedulesCapabilityContext.Provider>;

beforeEach(() => {
  // Hộp thư chỉ nhận kết quả khi phiên đăng nhập vẫn là của người đã gửi yêu cầu.
  authStorage.setStoredTokens({ accessToken: 'access', refreshToken: 'refresh', user });
  vi.spyOn(apiClient, 'getRuntime').mockResolvedValue({ runtimeMode: 'sandbox', schedulesEnabled: true });
  vi.spyOn(apiClient, 'getSchedules').mockResolvedValue({ schedules: [] });
  vi.spyOn(apiClient, 'getSchedulePendingCount').mockResolvedValue({ count: 0 });
  vi.spyOn(apiClient, 'getConversations').mockResolvedValue({ conversations: [], nextCursor: null });
  vi.spyOn(slackConnectionApi, 'list').mockResolvedValue({ connections: [] });
});
afterEach(() => { cleanup(); authStorage.clearStoredTokens(); resetWorkspaceStorage(); vi.restoreAllMocks(); });

it('puts Lịch chạy first, then Hộp thư đề xuất, and asks to connect Slack without an empty digest block', async () => {
  const navigate = vi.fn();
  render(withSchedules(<SlackProposalInbox user={user} navigate={navigate} onLogout={vi.fn()} />));
  const main = screen.getByRole('main');
  expect(within(main).getByRole('heading', { level: 1, name: 'Tự động' })).toBeInTheDocument();
  const schedules = await within(main).findByRole('region', { name: 'Lịch chạy' });
  const inbox = within(main).getByRole('region', { name: 'Hộp thư đề xuất' });
  expect(schedules.compareDocumentPosition(inbox) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const connect = await within(inbox).findByRole('link', { name: 'Mở Kết nối dịch vụ' });
  fireEvent.click(connect);
  expect(navigate).toHaveBeenCalledWith('/settings');
  expect(within(main).queryByRole('region', { name: 'Bản tóm tắt hàng ngày' })).toBeNull();
  expect(screen.getByRole('link', { name: 'Tự động' })).toHaveAttribute('aria-current', 'page');
});

it.each([
  [404, 'Slack cá nhân chưa khả dụng trên máy chủ.'],
  [503, 'Không tải được kết nối Slack.'],
])('keeps schedules available without a Slack connect prompt when the connection list returns %i', async (status, message) => {
  vi.mocked(slackConnectionApi.list).mockRejectedValue(Object.assign(new Error('Slack unavailable'), { status }));
  render(withSchedules(<SlackProposalInbox user={user} navigate={vi.fn()} onLogout={vi.fn()} />));
  const inbox = screen.getByRole('region', { name: 'Hộp thư đề xuất' });
  expect(await within(inbox).findByText(message)).toBeVisible();
  expect(within(inbox).queryByRole('link', { name: 'Mở Kết nối dịch vụ' })).toBeNull();
  expect(screen.getByRole('region', { name: 'Lịch chạy' })).toBeVisible();
});

it('offers each template as a row whose button names the template', async () => {
  render(withSchedules(<SlackProposalInbox user={user} navigate={vi.fn()} onLogout={vi.fn()} />));
  const templates = await screen.findByTestId('schedule-event-templates');
  const buttons = within(templates).getAllByRole('button', { name: /^Dùng mẫu / });
  expect(buttons.length).toBe(within(templates).getAllByRole('listitem').length);
});

it('Nhật ký no longer shows Lịch chạy', async () => {
  render(withSchedules(<HistoryPage user={user} navigate={vi.fn()} onLogout={vi.fn()} />));
  await waitFor(() => expect(apiClient.getConversations).toHaveBeenCalled());
  expect(screen.queryByRole('region', { name: 'Lịch chạy' })).toBeNull();
  expect(apiClient.getSchedules).not.toHaveBeenCalled();
});

it('the home queue sends schedule runs that wait for you to Tự động', async () => {
  vi.spyOn(apiClient, 'getAttention').mockResolvedValue({ pendingPlans: [], needsAttention: [] });
  vi.mocked(apiClient.getSchedulePendingCount).mockResolvedValue({ count: 2 });
  const navigate = vi.fn();
  render(withSchedules(<HomeQueue user={user} navigate={navigate} onOpenConversation={vi.fn()} />));
  fireEvent.click(await screen.findByRole('button', { name: /2 lịch chạy chờ bạn xác nhận/ }));
  expect(navigate).toHaveBeenCalledWith('/inbox');
});
