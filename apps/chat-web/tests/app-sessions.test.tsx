/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../src/App';
import { authStorage } from '../src/services/auth-storage';
import { useChatStore } from '../src/store/chat-store';
vi.mock('../src/hooks/use-sse', () => ({ useSSE: vi.fn(() => ({ disconnected: false })) }));
beforeEach(() => { localStorage.clear(); useChatStore.getState().reset(); vi.restoreAllMocks(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('AUTH-01 App logout', () => {
  it.each([false, true])('calls server before clearing tokens and clears even on network failure (%s)', async networkFailure => {
    authStorage.setStoredTokens({ accessToken: 'current', refreshToken: 'opaque', user: { id: 'owner', email: 'owner@example.test', name: 'Owner' } });
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const fetchMock = vi.fn(async (url, init) => {
      if (url === '/api/auth/logout') {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer current');
        expect(authStorage.getStoredTokens().refreshToken).toBe('opaque');
        await pending;
        if (networkFailure) throw new TypeError('Failed to fetch');
        return new Response(JSON.stringify({ success: true }));
      }
      return new Response(JSON.stringify({ user: { id: 'owner', email: 'owner@example.test', name: 'Owner' }, conversations: [], services: [], signupEnabled: false, googleEnabled: false }));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App initialView="login" />);
    fireEvent.click(await screen.findByRole('button', { name: /Menu người dùng/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Đăng xuất/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST' })));
    expect(authStorage.getStoredTokens().accessToken).toBe('current');
    finish();
    await waitFor(() => expect(authStorage.getStoredTokens().accessToken).toBeNull());
    expect(authStorage.getStoredTokens().refreshToken).toBeNull();
    expect(screen.queryByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ })).toBeNull();
  });
  it('loads public flags and keeps unsupported sign-up/Google actions hidden', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ signupEnabled: false, googleEnabled: false })));
    vi.stubGlobal('fetch', fetchMock); render(<App initialView="login" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/config'));
    expect(screen.queryByRole('button', { name: /Đăng ký|Google/ })).toBeNull();
  });
});
