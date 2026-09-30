/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../src/App';
import { useChatStore } from '../src/store/chat-store';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useChatStore.getState().reset();
});

describe('App message sending', () => {
  it('marks the message as sent once the server accepts it', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/auth/login') {
        return { ok: true, status: 200, json: async () => ({ accessToken: 'jwt', user: { id: 'u1', email: 'a@b.c', name: 'A' } }) };
      }
      if (url === '/api/conversations' && init?.method === 'POST') {
        return { ok: true, status: 201, json: async () => ({ conversation: { id: 'conv-1', title: 'Mới' } }) };
      }
      if (url === '/api/conversations/conv-1/messages') {
        return { ok: true, status: 202, json: async () => ({ status: 202, messageId: 'msg-1' }) };
      }
      return { ok: true, status: 200, json: async () => ({}), body: null };
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.c' } });
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'entered-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    const input = await screen.findByPlaceholderText('Mô tả công việc bạn muốn thực hiện...');
    fireEvent.change(input, { target: { value: 'Tạo card' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi' }));

    await waitFor(() => {
      const message = useChatStore.getState().messages.find((m) => m.content === 'Tạo card');
      expect(message).toMatchObject({ id: 'msg-1', status: 'sent' });
    });
    expect(screen.queryByText(/Đang gửi/)).toBeNull();
  });
});
