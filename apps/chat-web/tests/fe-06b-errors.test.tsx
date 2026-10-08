/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Workspace } from '../src/components/Workspace';
import { AuthGate } from '../src/components/AuthGate';
import { authStorage } from '../src/services/auth-storage';
import { useChatStore } from '../src/store/chat-store';
import type { AppRoute } from '../src/routes';
vi.mock('../src/hooks/use-sse', () => ({ useSSE: () => ({ disconnected: false, reconnect: () => {} }) }));
vi.mock('../src/hooks/use-conversation-history', () => ({ useConversationHistory: () => ({ loading: false, error: null }) }));
vi.mock('../src/services/api-client', () => ({ sharesAuthSession: () => false, apiClient: {
  getServices: async () => ({ services: [], canConfigure: false }), getRuntime: async () => ({ runtimeMode: 'sandbox' }),
  getConversations: async () => ({ conversations: [] }), getAuthConfig: async () => ({ signupEnabled: false, googleEnabled: false }),
  getMe: async () => ({ user: { id: 'u', name: 'User', email: 'user@example.test' } }), logout: async () => {},
} }));
afterEach(() => { cleanup(); useChatStore.getState().reset(); authStorage.clearStoredTokens(); vi.restoreAllMocks(); });
it('browser offline event shows the prototype banner and retry probes health without resending a write', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
  render(<Workspace authToken="test" user={null} onLogout={() => {}} authError={null} onClearAuthError={() => {}} route={{ kind: 'home' }} navigate={() => {}} />);
  act(() => window.dispatchEvent(new Event('offline')));
  expect(await screen.findByText('Mất kết nối. Hãy kiểm tra mạng và thử lại.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  await act(async () => {});
  expect(fetchSpy).toHaveBeenCalledWith('/api/health', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(screen.queryByText('Mất kết nối. Hãy kiểm tra mạng và thử lại.')).toBeNull();
});
it('session loss returns to login with an expiry message and no draft preservation promise', async () => {
  authStorage.setStoredTokens({ accessToken: 'session', refreshToken: 'refresh', user: { id: 'u', name: 'User', email: 'user@example.test' } });
  function Harness() {
    const [route, setRoute] = useState<AppRoute>({ kind: 'home' });
    return <AuthGate route={route} navigate={path => setRoute(path === '/login' ? { kind: 'login' } : { kind: 'home' })}>{() => <p>Workspace authenticated</p>}</AuthGate>;
  }
  render(<Harness />); expect(await screen.findByText('Workspace authenticated')).toBeInTheDocument();
  act(() => authStorage.clearStoredTokens());
  expect(await screen.findByText('Phiên đăng nhập đã hết hạn')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Đăng nhập/ })).toBeInTheDocument();
  expect(screen.queryByText(/bản nháp.*(?:lưu|giữ)|(?:lưu|giữ).*bản nháp/i)).toBeNull();
});
