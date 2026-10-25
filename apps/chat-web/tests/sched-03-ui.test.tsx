/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ScheduleMoment, reloadScheduleConversation } from '../src/pages/Cockpit/ScheduleMoment';
import { ScheduleRunRecovery } from '../src/pages/Cockpit/ScheduleRunRecovery';
import { RequestEcho } from '../src/pages/Cockpit/RequestEcho';
import { loadConversationHistory } from '../src/hooks/use-conversation-history';
import { ScheduleActions } from '../src/pages/Cockpit/ScheduleActions';
import { PlanningErrorMoment } from '../src/pages/Errors/PlanningErrors';
import { AnswerMoment } from '../src/pages/Responses/ResponseMoment';
import { authStorage } from '../src/services/auth-storage';
import { MainNav } from '../src/components/layout/MainNav';
import { ScheduleSection } from '../src/pages/History/ScheduleSection';
import { apiClient } from '../src/services/api-client';
import { useChatStore } from '../src/store/chat-store';
import { SchedulesCapabilityContext } from '../src/hooks/use-schedules';
import type { ScheduleView } from '@wap/tool-schemas';
vi.mock('../src/services/api-client', () => ({ apiClient: { getRuntime: vi.fn(), getSchedulePendingCount: vi.fn(), getSchedules: vi.fn(), confirmSchedule: vi.fn(), changeSchedule: vi.fn(), runScheduleNow: vi.fn(), getConversation: vi.fn(), getScheduleRuns: vi.fn(), getActivePlan: vi.fn(), getLatestExecutionSnapshot: vi.fn() } }));
const user = { id: 'a', name: 'An', email: 'an@example.test' };
const schedule: ScheduleView = { id: 's', convId: 'c', version: 2, name: 'Lịch họp', request: 'Gửi lịch họp lên Slack', recurrence: { type: 'daily', time: '08:00' }, services: ['calendar', 'slack'], status: 'active', pauseReason: null, nextRuns: ['2026-10-26T01:00:00Z'], lastRun: null };
const proposal = { id: 'm', role: 'assistant' as const, content: '', metadata: { type: 'schedule_proposal', proposal: { kind: 'schedule' as const, action: 'update' as const, name: schedule.name, request: schedule.request, recurrence: { type: 'weekly' as const, days: [1,2,3,4,5] as any, time: '08:30' }, summary: 'Đổi giờ' }, previous: { ...schedule }, services: schedule.services, nextRuns: schedule.nextRuns } };
beforeEach(() => { vi.mocked(apiClient.getRuntime).mockResolvedValue({ runtimeMode: 'sandbox' }); vi.mocked(apiClient.getSchedulePendingCount).mockResolvedValue({ count: 1 }); vi.mocked(apiClient.getSchedules).mockResolvedValue({ schedules: [schedule] }); useChatStore.getState().setConversationId('c'); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); localStorage.clear(); useChatStore.getState().reset(); });
const show = (message = proposal, onEdit = vi.fn()) => render(<ScheduleMoment message={message} convId="c" navigate={vi.fn()} onEdit={onEdit} />);
it('shows only changed fields as old and new and always explains approval', () => {
  show();
  expect(document.querySelectorAll('del')).toHaveLength(1);
  expect(document.querySelector('del')).toHaveTextContent('Hằng ngày, 08:00');
  expect(screen.getByText('Thứ Hai đến thứ Sáu, 08:30, giờ Việt Nam')).toBeInTheDocument();
  expect(screen.getByText('Tới giờ, ATI lập kế hoạch mới và chờ bạn duyệt. Chưa có gì được ghi lên công cụ nào.')).toBeInTheDocument();
});
it('ignores a proposal locally without any mutation and editing focuses the composer', () => {
  const edit = vi.fn(); show(proposal, edit);
  fireEvent.click(screen.getByRole('button', { name: 'Sửa' })); expect(edit).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Bỏ qua' }));
  expect(screen.queryByRole('button', { name: 'Xác nhận' })).toBeNull();
  expect(apiClient.confirmSchedule).not.toHaveBeenCalled(); expect(apiClient.changeSchedule).not.toHaveBeenCalled();
});
it('guards confirmation synchronously while awaiting a response', async () => {
  let resolve!: (value: any) => void;
  vi.mocked(apiClient.confirmSchedule).mockImplementation(() => new Promise(done => { resolve = done; }));
  show(); const button = screen.getByRole('button', { name: 'Xác nhận' });
  fireEvent.click(button); fireEvent.click(button); expect(apiClient.confirmSchedule).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ schedule }));
  expect(screen.getByText(/Đang bật/)).toBeInTheDocument();
});
it.each([
  ['STALE_PROPOSAL', 'Đề xuất này đã cũ. Hãy xem đề xuất mới nhất.'], ['LIMIT_REACHED', 'Bạn đã có 10 lịch. Hãy hủy bớt một lịch rồi thử lại.'],
  ['CONVERSATION_HAS_SCHEDULE', 'Hội thoại này đã có lịch. Hãy mở hội thoại mới để tạo lịch khác.'], ['SCHEDULE_IN_PAST', 'Giờ hẹn đã qua. Hãy nhắn giờ mới.'],
  ['SCHEDULE_CLOSED', 'Lịch đã hủy hoặc đã chạy xong.'], ['STALE_VERSION', 'Lịch vừa thay đổi ở nơi khác. Đã tải lại.'],
  ['RUN_IN_PROGRESS', 'Lịch đang lập kế hoạch cho một lượt. Hãy chờ lượt đó xong.'], ['RUN_NOT_REPLANNABLE', 'Lượt này không cần lập lại kế hoạch.'],
])('shows %s and reloads server history', async (code, message) => {
  vi.mocked(apiClient.confirmSchedule).mockRejectedValue(Object.assign(new Error(message), { status: 409, code }));
  vi.mocked(apiClient.getConversation).mockResolvedValue({ conversation: { id: 'c' }, messages: [proposal] } as any);
  show(); fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(apiClient.getConversation).toHaveBeenCalledWith('c');
});
it('keeps all schedule API calls off when health omits the capability', async () => {
  render(<><MainNav user={user} current="history" navigate={vi.fn()} onLogout={vi.fn()} /><ScheduleSection user={user} navigate={vi.fn()} /></>);
  await act(async () => {});
  expect(apiClient.getSchedulePendingCount).not.toHaveBeenCalled(); expect(apiClient.getSchedules).not.toHaveBeenCalled();
  expect(screen.queryByRole('heading', { name: 'Lịch chạy' })).toBeNull();
  expect(screen.getByRole('link', { name: 'Nhật ký' })).toBeInTheDocument();
});
it('announces pending runs on the history tab and the mobile avatar entry', async () => {
  vi.mocked(apiClient.getRuntime).mockResolvedValue({ runtimeMode: 'sandbox', schedulesEnabled: true });
  render(<SchedulesCapabilityContext.Provider value={true}><MainNav user={user} current="workspace" navigate={vi.fn()} onLogout={vi.fn()} /></SchedulesCapabilityContext.Provider>);
  expect(await screen.findByRole('link', { name: 'Nhật ký, 1 lượt chờ duyệt' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Menu người dùng: An' }));
  expect(screen.getByRole('menuitem', { name: /Nhật ký điều phối, 1 lượt chờ duyệt/ })).toBeInTheDocument();
});
const scheduledMessage = { id: 'run-message', role: 'user' as const, content: 'Gửi lịch họp', metadata: { type: 'schedule_run', name: 'Lịch họp', dueAt: '2026-10-26T01:00:00Z', scheduleId: 's', runId: 'run' } };
it('keeps newer SSE messages when a conflict reload returns late', async () => {
  let finish!: (value: any) => void;
  vi.mocked(apiClient.getConversation).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const loading = reloadScheduleConversation('c');
  useChatStore.getState().addMessage({ id: 'new-plan', role: 'assistant', content: 'Mới', metadata: { type: 'plan' } });
  finish({ messages: [proposal] }); await loading;
  expect(useChatStore.getState().messages.at(-1)?.id).toBe('new-plan');
});
it('marks a run planning immediately, then reconciles a result missed by SSE', async () => {
  let finish!: (value: any) => void;
  vi.mocked(apiClient.getScheduleRuns).mockResolvedValue({ runs: [{ id: 'run', state: 'awaiting_approval' }] } as any).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  vi.mocked(apiClient.getConversation).mockResolvedValue({ messages: [scheduledMessage, { id: 'plan-message', role: 'assistant', content: '', metadata: { type: 'plan', replyToMessageId: scheduledMessage.id } }] } as any);
  vi.mocked(apiClient.getActivePlan).mockResolvedValue({ id: 'plan', summary: 'Họp', steps: [] });
  vi.mocked(apiClient.getLatestExecutionSnapshot).mockResolvedValue(null);
  useChatStore.setState({ messages: [scheduledMessage] });
  render(<ScheduleRunRecovery message={scheduledMessage} navigate={vi.fn()} />);
  expect(useChatStore.getState().isPlanning).toBe(true);
  await act(async () => finish({ runs: [{ id: 'run', state: 'awaiting_approval' }] }));
  await waitFor(() => expect(useChatStore.getState().activePlan?.id).toBe('plan'));
  expect(useChatStore.getState().isPlanning).toBe(false);
});
it('settles discarded runs when reloading history', async () => {
  const state = useChatStore.getState(); state.beginPlanning('c', 'r'); state.confirmPlanningRequest('c', 'r', scheduledMessage.id);
  vi.mocked(apiClient.getConversation).mockResolvedValue({ messages: [scheduledMessage, { id: 'discard', role: 'system', content: 'Lịch đã thay đổi', metadata: { type: 'schedule_discarded', replyToMessageId: scheduledMessage.id } }] } as any);
  vi.mocked(apiClient.getActivePlan).mockResolvedValue(null as any); vi.mocked(apiClient.getLatestExecutionSnapshot).mockResolvedValue(null);
  await loadConversationHistory('c', () => true); expect(useChatStore.getState().isPlanning).toBe(false);
});
it('does not append stale background history after a newer followup response', async () => {
  let finish!: (value: any) => void;
  useChatStore.setState({ messages: [scheduledMessage] });
  vi.mocked(apiClient.getConversation).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  vi.mocked(apiClient.getActivePlan).mockResolvedValue(null as any); vi.mocked(apiClient.getLatestExecutionSnapshot).mockResolvedValue(null);
  const before = useChatStore.getState();
  const loading = loadConversationHistory('c', () => true, before);
  before.addMessage({ id: 'followup', role: 'user', content: 'Câu mới' });
  before.addMessage({ id: 'refusal', role: 'assistant', content: 'Không thể làm câu mới', metadata: { type: 'refusal' } });
  finish({ messages: [scheduledMessage, { id: 'old-plan', role: 'assistant', content: 'Cũ', metadata: { type: 'plan' } }] });
  await loading; expect(useChatStore.getState().messages.at(-1)?.id).toBe('refusal');
});
it('shows the scheduled origin only when capability is enabled', () => {
  useChatStore.setState({ messages: [scheduledMessage] });
  const view = render(<RequestEcho request="Gửi lịch họp" />);
  expect(screen.getByText(/Bạn nhờ/)).toBeInTheDocument(); expect(document.querySelector('[data-schedule-origin]')).toBeNull();
  view.rerender(<SchedulesCapabilityContext.Provider value={true}><RequestEcho request="Gửi lịch họp" /></SchedulesCapabilityContext.Provider>);
  expect(screen.getByText('Lịch "Lịch họp" tự gửi lúc 08:00 26/10')).toBeInTheDocument(); expect(screen.queryByText(/Bạn nhờ/)).toBeNull();
});
it('closes cancellation on conflict, exposes the error and reloads the current version', async () => {
  const conflict = vi.fn(async () => {});
  vi.mocked(apiClient.changeSchedule).mockRejectedValue(Object.assign(new Error('Lịch vừa thay đổi ở nơi khác. Đã tải lại.'), { status: 409, code: 'STALE_VERSION' }));
  render(<ScheduleActions schedule={schedule} navigate={vi.fn()} onChanged={vi.fn()} onConflict={conflict} />);
  fireEvent.click(screen.getByRole('button', { name: /^Hủy lịch$/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận hủy lịch' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect(screen.getByRole('alert')).toHaveTextContent('Lịch vừa thay đổi ở nơi khác. Đã tải lại.'); expect(conflict).toHaveBeenCalledOnce();
  expect(apiClient.changeSchedule).toHaveBeenCalledWith('s', 'cancel', 2);
});
it('uses the schedule source for failed planning and response cards too', () => {
  useChatStore.setState({ messages: [scheduledMessage] });
  const view = render(<SchedulesCapabilityContext.Provider value={true}><PlanningErrorMoment request="Gửi lịch họp" onRetry={vi.fn()} onEdit={vi.fn()} /></SchedulesCapabilityContext.Provider>);
  expect(screen.queryByText('Câu yêu cầu của bạn:')).toBeNull(); expect(document.querySelector('[data-schedule-origin]')).not.toBeNull();
  view.rerender(<SchedulesCapabilityContext.Provider value={true}><AnswerMoment request="Gửi lịch họp" message={{ id: 'answer', role: 'assistant', content: 'Không có lịch họp.' }} services={[]} /></SchedulesCapabilityContext.Provider>);
  expect(document.querySelector('#user-request-bubble-text')).toBeNull(); expect(document.querySelector('[data-schedule-origin]')).not.toBeNull();
});
it('refreshes the pending count on its interval and focus and stops on logout', async () => {
  vi.useFakeTimers();
  authStorage.setStoredTokens({ accessToken: 'test-access', user });
  render(<SchedulesCapabilityContext.Provider value={true}><MainNav user={user} current="workspace" navigate={vi.fn()} onLogout={vi.fn()} /></SchedulesCapabilityContext.Provider>);
  await act(async () => {}); expect(apiClient.getSchedulePendingCount).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); }); expect(apiClient.getSchedulePendingCount).toHaveBeenCalledTimes(2);
  await act(async () => window.dispatchEvent(new Event('focus'))); expect(apiClient.getSchedulePendingCount).toHaveBeenCalledTimes(3);
  await act(async () => authStorage.clearStoredTokens());
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); window.dispatchEvent(new Event('focus')); });
  expect(apiClient.getSchedulePendingCount).toHaveBeenCalledTimes(3); expect(screen.queryByRole('link', { name: /lượt chờ duyệt/ })).toBeNull();
});
