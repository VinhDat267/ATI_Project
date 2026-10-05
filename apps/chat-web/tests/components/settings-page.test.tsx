import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SettingsModal } from '../../src/components/SettingsModal';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ services: [] }), { status: 200 })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Settings page and dialog semantics', () => {
  it.each([true, false])('preserves a newer credential draft during a pending page save (success=%s)', async success => {
    let finishSave!: (response: Response) => void;
    const saveResponse = new Promise<Response>(resolve => { finishSave = resolve; });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/services') return new Response(JSON.stringify({ services: [{
        id: 'slack', name: 'Slack', configured: true, allowedScope: ['C01'],
        credentialFields: [{ key: 'botToken', label: 'Bot Token' }],
      }] }), { status: 200 });
      expect(url).toBe('/api/services/slack/credentials');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(init?.body as string)).toEqual({ credentials: { botToken: 'submitted' }, allowedScope: ['C01'] });
      return saveResponse;
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<SettingsModal isOpen page onClose={vi.fn()} />);
    const credential = await screen.findByLabelText('Bot Token');
    fireEvent.change(credential, { target: { value: 'submitted' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu cấu hình' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    fireEvent.change(credential, { target: { value: 'newer draft' } });
    await act(async () => {
      finishSave(new Response(JSON.stringify(success ? { success: true, message: 'Saved' } : { error: 'Save denied' }), {
        status: success ? 200 : 403,
      }));
    });
    expect(await screen.findByText(success ? 'Saved' : 'Lỗi kết nối: Save denied')).toBeInTheDocument();
    expect(credential).toHaveValue('newer draft');
  });

  it('renders page content with one h1 and leaves page focus and Escape navigation alone', async () => {
    const onClose = vi.fn();
    render(<><button>Outside navigation</button><SettingsModal isOpen page onClose={onClose} /></>);
    await act(async () => {});
    const outside = screen.getByRole('button', { name: 'Outside navigation' });
    outside.focus();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('main')).toContainElement(screen.getByRole('heading', { level: 1 }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(outside, { key: 'Tab', shiftKey: true });
    fireEvent.click(screen.getByRole('heading', { level: 1 }).closest('[aria-labelledby]')!);
    expect(onClose).not.toHaveBeenCalled();
    expect(outside).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: /Đóng/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('defaults to an accessible dialog with an h2 and moves initial focus inside', async () => {
    render(<SettingsModal isOpen onClose={vi.fn()} />);
    await act(async () => {});
    const dialog = screen.getByRole('dialog', { name: 'Cài đặt & Tích hợp Dịch vụ' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Cài đặt & Tích hợp Dịch vụ');
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Đóng/ })).toHaveFocus();
  });

  it('wraps Tab in both directions and prevents focus escaping the dialog', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ services: [{
      id: 'slack', name: 'Slack', configured: true, allowedScope: [],
      credentialFields: [{ key: 'botToken', label: 'Bot Token' }],
    }] }), { status: 200 })));
    render(<><button>Outside navigation</button><SettingsModal isOpen onClose={vi.fn()} /></>);
    const first = screen.getByRole('button', { name: /Đóng/ });
    const last = await screen.findByRole('button', { name: 'Lưu cấu hình' });
    first.focus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(first).toHaveFocus();
    screen.getByRole('button', { name: 'Outside navigation' }).focus();
    expect(first).toHaveFocus();
  });

  it('closes on Escape and returns focus to its opener when closed', async () => {
    const onClose = vi.fn();
    const { rerender } = render(<><button id="settings-opener">Open settings</button><SettingsModal isOpen={false} onClose={onClose} /></>);
    const opener = screen.getByRole('button', { name: 'Open settings' });
    opener.focus();
    rerender(<><button id="settings-opener">Open settings</button><SettingsModal isOpen onClose={onClose} /></>);
    await act(async () => {});
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<><button id="settings-opener">Open settings</button><SettingsModal isOpen={false} onClose={onClose} /></>);
    expect(opener).toHaveFocus();
  });

  it('returns focus to the current opener element when its original DOM node was replaced', async () => {
    const { rerender } = render(<><button key="old" id="settings-opener">Open settings</button><SettingsModal isOpen={false} onClose={vi.fn()} /></>);
    screen.getByRole('button', { name: 'Open settings' }).focus();
    rerender(<><button key="old" id="settings-opener">Open settings</button><SettingsModal isOpen onClose={vi.fn()} /></>);
    await act(async () => {});
    rerender(<><button key="new" id="settings-opener">Open settings</button><SettingsModal isOpen onClose={vi.fn()} /></>);
    rerender(<><button key="new" id="settings-opener">Open settings</button><SettingsModal isOpen={false} onClose={vi.fn()} /></>);
    expect(screen.getByRole('button', { name: 'Open settings' })).toHaveFocus();
  });
});
