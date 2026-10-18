import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { GMAIL_TOOLS } from '@wap/tool-schemas';
import { resourceDestination } from '../src/components/Cockpit';
import { PlanMoment } from '../src/pages/Cockpit/PlanMoment';
import { PreviewContents } from '../src/pages/Cockpit/PreviewContents';
import { RecoveryMoment } from '../src/pages/Cockpit/RecoveryMoment';
import { operation } from '../src/pages/Cockpit/presentation';
import { LandingPage } from '../src/pages/Landing/LandingPage';
import { PrivacyPage } from '../src/pages/Privacy/PrivacyPage';
import { SettingsPage } from '../src/pages/Settings/SettingsPage';
import { apiClient } from '../src/services/api-client';
import { authStorage } from '../src/services/auth-storage';
import type { ExecutionSnapshot, PlanStep, User } from '../src/types';

afterEach(() => { cleanup(); vi.restoreAllMocks(); authStorage.clearStoredTokens(); window.history.replaceState({}, '', '/'); });
const thread = 'gmail-thread-1';
const labels = { [thread]: 'Họp nhóm ATI', Label_1: 'Quan trọng', INBOX: 'Hộp thư đến' };
const step = (tool: string, args: PlanStep['args']): PlanStep => ({ id: tool.split('.')[1]!, tool, description: 'Việc Gmail', args });
const reply = step('gmail.reply', { threadId: thread, to: ['lan@example.com'], body: 'Mình đồng ý' });
const trash = step('gmail.trash_thread', { threadId: thread });
const relabel = step('gmail.modify_thread_labels', { threadId: thread, addLabelIds: ['Label_1'], removeLabelIds: ['INBOX'] });

it.each([
  ['gmail.send_message', 'Gửi thư', 'Đã gửi thư'], ['gmail.reply', 'Trả lời thư', 'Đã gửi trả lời'], ['gmail.forward', 'Chuyển tiếp thư', 'Đã chuyển tiếp'],
  ['gmail.create_draft', 'Tạo thư nháp', 'Đã tạo thư nháp'], ['gmail.modify_thread_labels', 'Đổi nhãn', 'Đã đổi nhãn'],
  ['gmail.trash_thread', 'Chuyển vào thùng rác', 'Đã chuyển vào thùng rác'], ['gmail.create_label', 'Tạo nhãn', 'Đã tạo nhãn'],
])('names what %s does on the plan card and while it runs', (tool, action, done) => {
  expect(operation(tool)).toMatchObject({ action, done });
});
it('declares an action for every Gmail write tool instead of guessing "Cập nhật"', () => {
  for (const tool of GMAIL_TOOLS.filter(t => t.sideEffect === 'write')) expect(operation(tool.name).action, tool.name).not.toBe('Cập nhật');
});

it('shows the thread a Gmail step acts on as its destination', () => {
  expect(resourceDestination(reply, labels)).toBe('Họp nhóm ATI');
  expect(resourceDestination(trash, labels)).toBe('Họp nhóm ATI');
  // Labels are what the step applies, not where it writes.
  expect(resourceDestination(relabel, labels)).toBe('Họp nhóm ATI');
  expect(resourceDestination(trash, {})).toBe('Luồng thư · chưa có tên trong dữ liệu');
});

it('labels reply and trash cards with their real action and thread on the approval screen', () => {
  const plan = { id: 'plan', convId: 'conv', summary: 'Thư', status: 'pending' as const, resourceLabels: labels, steps: [reply, trash],
    connections: { gmail: { credentialId: 'c', email: 'own@gmail.test' } } };
  render(<PlanMoment runtimeMode="sandbox" plan={plan} services={[]} destination={resourceDestination} onPreview={() => {}} onApprove={() => {}} onCancel={() => {}} onEdit={() => {}} inlineComposer={null} />);
  const [replyCard, trashCard] = [...document.querySelectorAll('#plan-cards-container article')] as HTMLElement[];
  expect(within(replyCard!).getByText('Trả lời thư')).toBeTruthy();
  expect(within(replyCard!).getByText('Đích đến: Họp nhóm ATI')).toBeTruthy();
  expect(within(trashCard!).getByText('Chuyển vào thùng rác')).toBeTruthy();
  expect(within(trashCard!).getByText('Đích đến: Họp nhóm ATI')).toBeTruthy();
  expect(screen.queryByText('Cập nhật')).toBeNull();
});

it('previews a trash step by thread title, never by a raw thread ID', () => {
  render(<PreviewContents step={trash} destination="" labels={labels} />);
  expect(screen.getByText('Luồng thư')).toBeTruthy();
  expect(screen.getByText('Họp nhóm ATI')).toBeTruthy();
  expect(screen.getByText(/chuyển vào Thùng rác của Gmail/)).toBeTruthy();
  expect(screen.queryByText('threadId')).toBeNull();
  expect(document.body.textContent).not.toContain(thread);
});
it('previews label changes by label name', () => {
  render(<PreviewContents step={relabel} destination="" labels={labels} />);
  expect(screen.getByText('Thêm nhãn')).toBeTruthy(); expect(screen.getByText('Quan trọng')).toBeTruthy();
  expect(screen.getByText('Bỏ nhãn')).toBeTruthy(); expect(screen.getByText('Hộp thư đến')).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/Label_1|addLabelIds|removeLabelIds/);
});
it('says when a thread has no title in the data instead of passing the ID off as one', () => {
  render(<PreviewContents step={trash} destination="" labels={{}} />);
  expect(screen.getByText(/gmail-thread-1 · chưa có tiêu đề trong dữ liệu/)).toBeTruthy();
});

it('offers the sent folder only while a send is unknown, not after a known failure', () => {
  const plan = { id: 'plan', convId: 'conv', summary: 'Thư', status: 'failed' as const, steps: [reply], connections: { gmail: { credentialId: 'c', email: 'own@gmail.test' } } };
  const snapshot: ExecutionSnapshot = { plan, execution: { status: 'failed', pausedStepId: reply.id }, steps: [{ stepId: reply.id, tool: reply.tool, status: 'failed' }], recoveryActions: ['retry', 'skip', 'stop'] };
  render(<RecoveryMoment moment={7} snapshot={snapshot} steps={[{ id: reply.id, tool: reply.tool, description: 'Thư', status: 'failed' }]} services={[]} controls={null} />);
  expect(screen.queryByRole('link', { name: 'Mở thư mục Đã gửi' })).toBeNull();
});

it.each([false, true])('shows the Gmail data section of /privacy only when Gmail is enabled: %s', async enabled => {
  vi.spyOn(apiClient, 'getRuntime').mockResolvedValue({ runtimeMode: 'sandbox', gmailEnabled: enabled });
  render(<PrivacyPage navigate={() => {}} />);
  await waitFor(() => expect(apiClient.getRuntime).toHaveBeenCalled());
  await act(async () => {});
  if (enabled) expect(within(await screen.findByRole('region', { name: 'Dữ liệu Gmail' })).getByText('Hộp thư Gmail bạn kết nối')).toBeTruthy();
  else expect(screen.queryByText('Hộp thư Gmail bạn kết nối')).toBeNull();
});

it('keeps the connection with a secondary "Giữ kết nối" button in the disconnect dialog', async () => {
  const member: User = { id: 'member', email: 'ati@example.test', name: 'Thành viên', role: 'member' };
  authStorage.setStoredTokens({ accessToken: 'a', refreshToken: 'ar', user: member });
  vi.spyOn(apiClient, 'getServices').mockResolvedValue({ canConfigure: false, services: [{ id: 'gmail', name: 'Gmail', connection: 'personal', personalStatus: 'connected', connected: true, configured: true, email: 'own@gmail.test' }] } as never);
  const disconnect = vi.spyOn(apiClient, 'disconnectGmail').mockResolvedValue({ success: true });
  render(<SettingsPage user={member} navigate={() => {}} onLogout={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Ngắt kết nối' }));
  const dialog = await screen.findByRole('dialog', { name: 'Ngắt kết nối Gmail?' });
  const keep = within(dialog).getByRole('button', { name: 'Giữ kết nối' });
  expect(keep.className).not.toContain('#FF5701');
  expect(within(dialog).getByRole('button', { name: 'Xác nhận ngắt kết nối' }).className).toContain('#FF5701');
  expect(within(dialog).queryByRole('button', { name: 'Tiếp tục kết nối' })).toBeNull();
  fireEvent.click(keep);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(disconnect).not.toHaveBeenCalled();
});

it('lists Gmail with the services on the landing page, outside the hidden demo step', async () => {
  vi.spyOn(apiClient, 'getRuntime').mockResolvedValue({ runtimeMode: 'sandbox', gmailEnabled: true });
  render(<LandingPage navigate={() => {}} />);
  const card = (await screen.findByText('Gmail · Của riêng bạn')).closest('div')!;
  expect(card.closest('[data-od-id="integrations-section"]')).not.toBeNull();
  expect(card.closest('#stage-panel-2')).toBeNull();
});
