import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SettingsPage } from '../src/pages/Settings/SettingsPage';
import { PreviewContents } from '../src/pages/Cockpit/PreviewContents';
import { RefusalMoment } from '../src/pages/Responses/ResponseMoment';
import { PrivacyPage } from '../src/pages/Privacy/PrivacyPage';
import { apiClient } from '../src/services/api-client';
import type { ServiceInfo, User } from '../src/types';
import { authStorage } from '../src/services/auth-storage';
import * as connection from '../src/services/gmail-connection';

const member: User = { id: 'member', email: 'ati@example.test', name: 'Thành viên', role: 'member' };
const gmail = (personalStatus = 'not_connected') => ({ id: 'gmail', name: 'Gmail', connection: 'personal', personalStatus, connected: personalStatus === 'connected', configured: personalStatus === 'connected', email: personalStatus === 'not_connected' ? undefined : 'own@gmail.test', connectedAt: '2026-10-14T02:00:00Z', tools: ['gmail.reply'] }) as ServiceInfo;
beforeEach(() => { window.history.replaceState({}, '', '/settings'); localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); authStorage.clearStoredTokens(); });
function catalogue(services: ServiceInfo[]) { vi.spyOn(apiClient, 'getServices').mockResolvedValue({ services, canConfigure: false }); }
function settings() { return render(<SettingsPage user={member} navigate={() => {}} onLogout={() => {}} />); }

it.each(['not_connected', 'connected', 'reconnect_required'])('shows the personal %s row to an ordinary member without shared credential controls', async status => {
  catalogue([gmail(status)]); settings();
  const personal = await screen.findByRole('region', { name: 'Của riêng bạn' });
  expect(within(personal).getByText('Gmail')).toBeTruthy();
  expect(screen.queryByLabelText(/Khoá|Token/)).toBeNull();
  expect(within(personal).getByRole('button', { name: status === 'connected' ? 'Ngắt kết nối' : status === 'reconnect_required' ? 'Kết nối lại' : 'Kết nối Gmail' })).toBeTruthy();
  if (status === 'not_connected') expect(personal.textContent).toContain('không xoá vĩnh viễn');
  if (status === 'reconnect_required') expect(personal.textContent).toContain('7 ngày');
  if (status === 'connected') expect(personal.textContent).toContain('own@gmail.test');
});
it('keeps the personal group absent when Gmail is absent from the server catalogue', async () => {
  catalogue([{ id: 'slack', name: 'Slack', connected: true }]); settings();
  await screen.findByRole('button', { name: /Slack —/ });
  expect(screen.queryByText('Gmail')).toBeNull(); expect(screen.queryByRole('region', { name: 'Của riêng bạn' })).toBeNull();
});
it('disables duplicate starts, shows redirect pending and handles a connection error without changing shared services', async () => {
  authStorage.setStoredTokens({ accessToken: 'a', refreshToken: 'ar', user: member });
  catalogue([gmail()]);
  let reject!: (error: Error) => void;
  vi.spyOn(apiClient, 'startGmailConnection').mockImplementation(() => new Promise((_, no) => { reject = no; }));
  settings(); const button = await screen.findByRole('button', { name: 'Kết nối Gmail' });
  fireEvent.click(button); fireEvent.click(button);
  expect(button).toBeDisabled(); expect(apiClient.startGmailConnection).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status')).toHaveTextContent('Đang chuyển hướng');
  await act(async () => reject(new Error('private upstream error')));
  expect(await screen.findByRole('alert')).toHaveTextContent('Không thể cập nhật');
  expect(button).not.toBeDisabled(); expect(document.body.textContent).not.toContain('private upstream error');
});
it('ignores a late start after the owning session changes', async () => {
  authStorage.setStoredTokens({ accessToken: 'a', refreshToken: 'ar', user: member }); catalogue([gmail()]);
  let resolve!: (data: { url: string }) => void;
  vi.spyOn(apiClient, 'startGmailConnection').mockImplementation(() => new Promise(yes => { resolve = yes; }));
  const redirect = vi.spyOn(connection, 'redirectToGmail').mockImplementation(() => {});
  settings(); fireEvent.click(await screen.findByRole('button', { name: 'Kết nối Gmail' }));
  authStorage.setStoredTokens({ accessToken: 'b', refreshToken: 'br', user: { ...member, id: 'b' } });
  await act(async () => resolve({ url: 'https://accounts.google.com/authorize' })); expect(redirect).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Kết nối Gmail' })).not.toBeDisabled();
});
it('disconnects exactly once after confirmation and refreshes the personal catalogue', async () => {
  authStorage.setStoredTokens({ accessToken: 'a', refreshToken: 'ar', user: member }); catalogue([gmail('connected')]);
  vi.spyOn(apiClient, 'disconnectGmail').mockResolvedValue({ success: true }); settings();
  fireEvent.click(await screen.findByRole('button', { name: 'Ngắt kết nối' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Xác nhận ngắt kết nối' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(apiClient.disconnectGmail).toHaveBeenCalledTimes(1); expect(apiClient.getServices).toHaveBeenCalledTimes(2);
});
it('opens and focuses the Gmail deep link; disconnect confirmation cancels with Escape and returns focus', async () => {
  catalogue([gmail('connected')]); window.history.replaceState({}, '', '/settings#gmail'); settings();
  const button = await screen.findByRole('button', { name: 'Ngắt kết nối' });
  await waitFor(() => expect(document.activeElement?.id).toBe('service-row-gmail'));
  fireEvent.click(button);
  await screen.findByRole('dialog', { name: 'Ngắt kết nối Gmail?' });
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(document.activeElement).toBe(button);
});
it('focuses Gmail after navigating away from an already open shared drawer', async () => {
  catalogue([gmail(), { id: 'slack', name: 'Slack', connected: true, configured: true }]); settings();
  fireEvent.click(await screen.findByRole('button', { name: /Slack —/ }));
  await screen.findByRole('dialog', { name: 'Slack' });
  act(() => { window.history.pushState({}, '', '/settings#gmail'); window.dispatchEvent(new HashChangeEvent('hashchange')); });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(document.activeElement?.id).toBe('service-row-gmail'));
});
it.each(['gmail.send_message', 'gmail.reply', 'gmail.forward', 'gmail.create_draft'])('renders all recipient groups, provenance and plain body for %s', tool => {
  render(<PreviewContents step={{ id: 'g', tool, description: 'Thư', args: { to: ['user@example.test'], cc: ['thread@example.test'], bcc: ['hidden@example.test'], subject: 'Tiêu đề', body: '<b>chỉ văn bản</b>\nxin chào' } }} destination="Họp nhóm" labels={{ 'recipient:user@example.test': 'user', 'recipient:thread@example.test': 'thread:Họp nhóm', 'recipient:hidden@example.test': 'user' }} />);
  expect(screen.getByText('hidden@example.test')).toBeTruthy(); expect(screen.getByText('Bcc')).toBeTruthy();
  expect(screen.getAllByText('bạn đã gõ')).toHaveLength(2); expect(screen.getByText(/lấy từ luồng thư/)).toBeTruthy();
  expect(screen.getByText(/<b>chỉ văn bản<\/b>/).querySelector('b')).toBeNull();
  expect(screen.queryByRole('alert') !== null).toBe(['gmail.send_message', 'gmail.forward'].includes(tool));
});
it('lets an ordinary member connect their own unavailable Gmail', () => {
  render(<RefusalMoment message={{ id: 'r', role: 'assistant', content: 'Chưa kết nối', metadata: { unavailableServices: [{ id: 'gmail', name: 'Gmail' }] } }} request="Trả lời email" services={[]} canConfigure={false} navigate={() => {}} onEdit={() => {}} />);
  expect(screen.getByRole('link', { name: /Kết nối Gmail/ }).getAttribute('href')).toBe('/settings#gmail');
});
it.each([false, true])('keeps the personal action available when a shared service is also missing, admin=%s', canConfigure => {
  render(<RefusalMoment message={{ id: 'r', role: 'assistant', content: 'Chưa kết nối', metadata: { unavailableServices: [{ id: 'gmail', name: 'Gmail' }, { id: 'slack', name: 'Slack' }] } }} request="Gmail và Slack" services={[]} canConfigure={canConfigure} navigate={() => {}} onEdit={() => {}} />);
  expect(screen.getByRole('link', { name: /Kết nối Gmail/ })).toHaveAttribute('href', '/settings#gmail');
  if (canConfigure) expect(screen.getByRole('link', { name: /Kết nối Slack/ })).toHaveAttribute('href', '/settings#slack');
  else expect(screen.getByText(/Chỉ quản trị viên/)).toBeTruthy();
});
it.each([false, true])('keeps privacy truthful with Gmail enabled=%s', async enabled => {
  vi.spyOn(apiClient, 'getRuntime').mockResolvedValue({ runtimeMode: 'sandbox', gmailEnabled: enabled });
  render(<PrivacyPage navigate={() => {}} />);
  await waitFor(() => expect(apiClient.getRuntime).toHaveBeenCalled());
  expect(screen.queryByText(/ATI không đọc Gmail/)).toBeNull();
  expect(screen.getByText(/hộp thư bạn tự kết nối/)).toBeTruthy();
  if (enabled) await screen.findByText(/9router/);
});
