import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RefusalMoment } from '../src/pages/Responses/ResponseMoment';
import { apiClient } from '../src/services/api-client';
import { authStorage } from '../src/services/auth-storage';
import * as connection from '../src/services/gmail-connection';
import type { ChatMessage, ServiceInfo, User } from '../src/types';

const member: User = { id: 'member', email: 'ati@example.test', name: 'Thành viên', role: 'member' };
const CONV = '11111111-2222-4333-8444-555555555555';
const gmail = (personalStatus: 'not_connected' | 'connected' | 'reconnect_required'): ServiceInfo => ({ id: 'gmail', name: 'Gmail', connection: 'personal',
  personalStatus, connected: personalStatus === 'connected', configured: personalStatus === 'connected', ...(personalStatus === 'connected' ? { email: 'own@gmail.test' } : {}) });
const slack = (configured: boolean): ServiceInfo => ({ id: 'slack', name: 'Slack', connected: configured, configured, connectionStatus: configured ? 'healthy' : 'unconfigured' });
const refusal = (ids: Array<{ id: string; name: string }>): ChatMessage => ({ id: 'r', role: 'assistant', content: 'Từ chối yêu cầu: Gmail chưa được kết nối.',
  metadata: { type: 'refusal', reason: 'Gmail chưa được kết nối.', unavailableServices: ids } });
const GMAIL_ONLY = [{ id: 'gmail', name: 'Gmail' }];
function show(services: ServiceInfo[], options: { ids?: Array<{ id: string; name: string }>; conversationId?: string; canConfigure?: boolean } = {}) {
  const onResend = vi.fn(), navigate = vi.fn(), onEdit = vi.fn();
  render(<RefusalMoment message={refusal(options.ids ?? GMAIL_ONLY)} request="Trả lời email mới nhất của Lan" services={services} connectFromChat
    canConfigure={options.canConfigure ?? false} navigate={navigate} onEdit={onEdit}
    {...('conversationId' in options ? { conversationId: options.conversationId } : { conversationId: CONV })} onResend={onResend} />);
  return { onResend, navigate, onEdit };
}

beforeEach(() => { authStorage.setStoredTokens({ accessToken: 'a', refreshToken: 'r', user: member }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); authStorage.clearStoredTokens(); });

it('connects Gmail straight from the refusal and asks to come back to this conversation', async () => {
  const start = vi.spyOn(apiClient, 'startGmailConnection').mockResolvedValue({ url: 'https://accounts.google.test/auth?state=s' });
  const redirect = vi.spyOn(connection, 'redirectToGmail').mockImplementation(() => {});
  const { navigate } = show([gmail('not_connected')]);
  const link = screen.getByRole('link', { name: /Kết nối Gmail/ });
  expect(link).toHaveAttribute('href', '/settings#gmail');
  fireEvent.click(link); fireEvent.click(link);
  await waitFor(() => expect(redirect).toHaveBeenCalledWith('https://accounts.google.test/auth?state=s'));
  expect(start).toHaveBeenCalledTimes(1);
  expect(start).toHaveBeenCalledWith({ returnTo: `/c/${CONV}` });
  expect(navigate).not.toHaveBeenCalled();
});

it('offers to connect again when the connection needs it', () => {
  show([gmail('reconnect_required')]);
  expect(screen.getByRole('link', { name: /Kết nối lại Gmail/ })).toBeTruthy();
  expect(screen.getByLabelText('Trạng thái các dịch vụ trong yêu cầu này').textContent).toContain('GmailCần kết nối lại');
});

it('says so on the page when starting the connection fails', async () => {
  vi.spyOn(apiClient, 'startGmailConnection').mockRejectedValue(new Error('offline'));
  const redirect = vi.spyOn(connection, 'redirectToGmail').mockImplementation(() => {});
  show([gmail('not_connected')]);
  fireEvent.click(screen.getByRole('link', { name: /Kết nối Gmail/ }));
  expect((await screen.findByRole('alert')).textContent).toBe('Không thể bắt đầu kết nối Gmail. Hãy kiểm tra mạng và thử lại.');
  expect(redirect).not.toHaveBeenCalled();
});

it('stays on the page when another person signed in while the connection was starting', async () => {
  let resolve!: (value: { url: string }) => void;
  const start = vi.spyOn(apiClient, 'startGmailConnection').mockReturnValue(new Promise(done => { resolve = done; }));
  const redirect = vi.spyOn(connection, 'redirectToGmail').mockImplementation(() => {});
  show([gmail('not_connected')]);
  fireEvent.click(screen.getByRole('link', { name: /Kết nối Gmail/ }));
  await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  authStorage.setStoredTokens({ accessToken: 'b', refreshToken: 'rb', user: { ...member, id: 'someone-else' } });
  resolve({ url: 'https://accounts.google.test/auth' });
  await new Promise(done => setTimeout(done, 20));
  expect(redirect).not.toHaveBeenCalled();
});

it('leaves a click with a modifier key to the browser, and keeps the settings page without a conversation', async () => {
  const start = vi.spyOn(apiClient, 'startGmailConnection').mockResolvedValue({ url: 'https://accounts.google.test/auth' });
  show([gmail('not_connected')]);
  const link = screen.getByRole('link', { name: /Kết nối Gmail/ });
  // jsdom cannot open the link the way the browser would; stop it before it tries.
  link.addEventListener('click', event => event.preventDefault());
  fireEvent.click(link, { ctrlKey: true });
  expect(start).not.toHaveBeenCalled();
  cleanup();
  const { navigate } = show([gmail('not_connected')], { conversationId: undefined });
  fireEvent.click(screen.getByRole('link', { name: /Kết nối Gmail/ }));
  expect(navigate).toHaveBeenCalledWith('/settings#gmail');
  expect(start).not.toHaveBeenCalled();
});

it('offers to send the request again once Gmail is connected, and sends exactly that request', () => {
  const { onResend } = show([gmail('connected')]);
  expect(screen.queryByRole('link', { name: /Kết nối/ })).toBeNull();
  expect(document.body.textContent).toContain('Đã kết nối · own@gmail.test');
  expect(document.body.textContent).toContain('Gmail đã được kết nối. Bạn có thể gửi lại yêu cầu.');
  fireEvent.click(screen.getByRole('button', { name: 'Gửi lại yêu cầu' }));
  expect(onResend).toHaveBeenCalledWith('Trả lời email mới nhất của Lan');
  expect(onResend).toHaveBeenCalledTimes(1);
});

it('waits until every missing service can be used before offering to send again', () => {
  show([gmail('connected'), slack(false)], { ids: [...GMAIL_ONLY, { id: 'slack', name: 'Slack' }], canConfigure: true });
  expect(screen.queryByRole('button', { name: 'Gửi lại yêu cầu' })).toBeNull();
  expect(screen.getByRole('link', { name: /Kết nối Slack/ })).toHaveAttribute('href', '/settings#slack');
  cleanup();
  const { onResend } = show([slack(true)], { ids: [{ id: 'slack', name: 'Slack' }], canConfigure: true });
  expect(document.body.textContent).toContain('Slack đã được kết nối. Bạn có thể gửi lại yêu cầu.');
  fireEvent.click(screen.getByRole('button', { name: 'Gửi lại yêu cầu' }));
  expect(onResend).toHaveBeenCalledWith('Trả lời email mới nhất của Lan');
});

it('reads the services again when a refusal appears, and offers to send again only on the fresh state', () => {
  const onRefreshServices = vi.fn(), onResend = vi.fn();
  const view = (message: ChatMessage, services: ServiceInfo[], servicesLoading: boolean) => <RefusalMoment message={message} request="Trả lời email mới nhất của Lan"
    services={services} connectFromChat servicesLoading={servicesLoading} onRefreshServices={onRefreshServices} canConfigure={false} navigate={vi.fn()} onEdit={vi.fn()} conversationId={CONV} onResend={onResend} />;
  // The page loaded while Gmail was still connected; it was disconnected elsewhere before this refusal.
  const { rerender } = render(view(refusal(GMAIL_ONLY), [gmail('connected')], false));
  expect(onRefreshServices).toHaveBeenCalledTimes(1);
  rerender(view(refusal(GMAIL_ONLY), [gmail('connected')], true));
  expect(screen.queryByRole('button', { name: 'Gửi lại yêu cầu' })).toBeNull();
  rerender(view(refusal(GMAIL_ONLY), [gmail('not_connected')], false));
  expect(screen.getByRole('link', { name: /Kết nối Gmail/ })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Gửi lại yêu cầu' })).toBeNull();
  expect(onRefreshServices).toHaveBeenCalledTimes(1);
  rerender(view({ ...refusal(GMAIL_ONLY), id: 'r2' }, [gmail('not_connected')], false));
  expect(onRefreshServices).toHaveBeenCalledTimes(2);
  expect(onResend).not.toHaveBeenCalled();
});

it('never sends the request again on its own', () => {
  const { onResend } = show([gmail('connected')]);
  expect(onResend).not.toHaveBeenCalled();
});

it('sends the return path in the body of the start request', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ url: 'https://accounts.google.test/auth' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }));
  await apiClient.startGmailConnection({ returnTo: `/c/${CONV}` });
  const init = fetchSpy.mock.calls.at(-1)![1] as RequestInit;
  expect(init.method).toBe('POST');
  expect(JSON.parse(String(init.body))).toEqual({ returnTo: `/c/${CONV}` });
  await apiClient.startGmailConnection();
  expect((fetchSpy.mock.calls.at(-1)![1] as RequestInit).body).toBeUndefined();
});
