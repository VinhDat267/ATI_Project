/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../src/App';
import { useChatStore } from '../src/store/chat-store';
import { authStorage } from '../src/services/auth-storage';
import { ALL_TOOLS } from '@wap/tool-schemas';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  authStorage.clearStoredTokens();
  if (typeof localStorage !== 'undefined') localStorage.clear();
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
      if (url.includes('/stream')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/event-stream' }),
          body: {
            getReader: () => ({
              read: () => new Promise(() => {}), // stay open like real SSE
              releaseLock: () => {},
            }),
          },
        };
      }
      return { ok: true, status: 200, json: async () => ({}), body: null };
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App initialView="login" />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.c' } });
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'entered-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    const input = await screen.findByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ });
    fireEvent.change(input, { target: { value: 'Tạo card' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu' }));

    await waitFor(() => {
      const message = useChatStore.getState().messages.find((m) => m.content === 'Tạo card');
      expect(message).toMatchObject({ id: 'msg-1', status: 'sent' });
    });
    expect(screen.queryByText(/Đang gửi/)).toBeNull();
  });

  it('renders business-friendly prompt chips, lacks placebo dark mode, and toggles mobile backdrop', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/services') return {ok:true,status:200,json:async()=>({services:['trello','slack','github'].map(id=>({id,name:id,configured:true,connected:false,tools:ALL_TOOLS.filter(t=>t.service===id).map(t=>t.name)}))})};
      if (url === '/api/auth/login') {
        return { ok: true, status: 200, json: async () => ({ accessToken: 'jwt', user: { id: 'u1', email: 'a@b.c', name: 'A' } }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App initialView="login" />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.c' } });
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'entered-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));

    // Verify empty state text and prompt chips
    expect(
      await screen.findByText(/Mô tả bằng lời thường điều bạn cần/i)
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/Tạo công việc mới trên Trello/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Gửi thông báo tiến độ qua Slack/i)
    ).toBeInTheDocument();

    // Verify placebo dark mode toggle is removed
    expect(screen.queryByLabelText('Chuyển chế độ sáng/tối')).toBeNull();

    // Open mobile sidebar
    const hamburger = screen.getByLabelText('Mở danh sách hội thoại');
    fireEvent.click(hamburger);

    // Backdrop overlay should be present
    const backdrop = document.getElementById('drawer-backdrop');
    expect(backdrop).not.toBeNull();

    // Clicking backdrop closes the sidebar
    fireEvent.click(backdrop!);
    expect(screen.queryByRole('dialog')).toBeNull();

    // Re-open mobile sidebar and test closing via Escape key
    fireEvent.click(hamburger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
