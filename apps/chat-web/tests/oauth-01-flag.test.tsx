/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Cockpit } from '../src/components/Cockpit';
import { useChatStore } from '../src/store/chat-store';
import { handleSSEEvent, resetSSEState } from '../src/hooks/use-sse';
import { apiClient } from '../src/services/api-client';
import type { ServiceInfo, User } from '../src/types';

vi.mock('../src/services/api-client', () => ({ apiClient: { getRuntime: vi.fn(), startGmailConnection: vi.fn() } }));
const CONV = '11111111-2222-4333-8444-555555555555';
const admin = { id: 'admin', email: 'admin@example.test', name: 'Admin', role: 'admin' } as User;
const slack: ServiceInfo = { id: 'slack', name: 'Slack', configured: true, connected: true, connectionStatus: 'healthy' };
const gmail: ServiceInfo = { id: 'gmail', name: 'Gmail', connection: 'personal', personalStatus: 'connected', connected: true, configured: true, email: 'own@gmail.test' };

async function refusalOn(gmailEnabled: boolean, missing: { id: string; name: string }, services: ServiceInfo[]) {
  vi.mocked(apiClient.getRuntime).mockResolvedValue({ runtimeMode: 'sandbox', ...(gmailEnabled ? { gmailEnabled: true } : {}) });
  const store = useChatStore.getState(); store.setConversationId(CONV);
  store.addMessage({ id: 'u', role: 'user', content: `Gửi tin qua ${missing.name}` });
  handleSSEEvent('refusal', JSON.stringify({ reason: `${missing.name} chưa được kết nối.`, unavailableServices: [missing] }), undefined, CONV);
  const send = vi.fn(), navigate = vi.fn(), refresh = vi.fn();
  // The refusal is older than the services: the service it names can be used by now.
  render(<Cockpit user={admin} canConfigureServices navigate={navigate} services={services} servicesLoading={false} servicesError={null} onRefreshServices={refresh}
    onSendMessage={send} onNewConversation={() => {}} onSelectConversation={() => {}} onSettings={() => {}} onApprove={() => {}} onCancel={() => {}} recovery={null} />);
  await waitFor(() => expect(apiClient.getRuntime).toHaveBeenCalled());
  await new Promise(done => setTimeout(done, 20));
  return { send, navigate, refresh };
}

beforeEach(() => { useChatStore.getState().reset(); resetSSEState(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('keeps the refusal screen as before while GMAIL_ENABLED is off', async () => {
  const { send, refresh, navigate } = await refusalOn(false, { id: 'slack', name: 'Slack' }, [slack]);
  expect(screen.queryByRole('button', { name: 'Gửi lại yêu cầu' })).toBeNull();
  expect(screen.getByRole('link', { name: /Kết nối Slack/ })).toHaveAttribute('href', '/settings#slack');
  expect(screen.getByLabelText('Trạng thái các dịch vụ trong yêu cầu này').textContent).toContain('SlackChưa kết nối');
  expect(refresh).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();
});

it('keeps the Gmail link of the refusal going to the settings page while GMAIL_ENABLED is off', async () => {
  const { navigate, refresh } = await refusalOn(false, { id: 'gmail', name: 'Gmail' }, [gmail]);
  expect(screen.queryByRole('button', { name: 'Gửi lại yêu cầu' })).toBeNull();
  fireEvent.click(screen.getByRole('link', { name: /Kết nối Gmail/ }));
  expect(navigate).toHaveBeenCalledWith('/settings#gmail');
  expect(apiClient.startGmailConnection).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
});

it('offers to send again on the same refusal once GMAIL_ENABLED is on', async () => {
  const { send, refresh } = await refusalOn(true, { id: 'slack', name: 'Slack' }, [slack]);
  expect(await screen.findByRole('button', { name: 'Gửi lại yêu cầu' })).toBeTruthy();
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(send).not.toHaveBeenCalled();
});
