import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SettingsPage } from '../../src/pages/Settings/SettingsPage';
const props = { user: { id: 'admin', email: 'admin@localhost.test', name: 'Test Admin', role: 'admin' as const }, navigate: vi.fn(), onLogout: vi.fn() };
const slack = { id: 'slack', name: 'Slack', configured: true, allowedScope: ['C01'], credentialFields: [{ key: 'botToken', label: 'Bot Token' }] };
beforeEach(() => { window.history.replaceState({}, '', '/settings'); vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ services: [slack] })))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const open = async () => { fireEvent.click(await screen.findByRole('button', { name: /Slack —/ })); return screen.findByRole('dialog'); };
describe('Settings page and drawer semantics (former page/modal cases)', () => {
  it.each([true, false])('preserves a newer credential draft during pending save (success=%s)', async success => {
    let finish!: (response: Response) => void;
    const response = new Promise<Response>(resolve => { finish = resolve; });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/services') return new Response(JSON.stringify({ services: [slack] }));
      expect(url).toBe('/api/services/slack/credentials'); expect(init?.method).toBe('POST');
      expect(JSON.parse(init?.body as string)).toEqual({ credentials: { botToken: 'submitted' }, allowedScope: ['C01'] }); return response;
    });
    vi.stubGlobal('fetch', fetchMock); render(<SettingsPage {...props} />); await open();
    const credential = screen.getByLabelText('Bot Token'); fireEvent.change(credential, { target: { value: 'submitted' } }); fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2)); fireEvent.change(credential, { target: { value: 'newer draft' } });
    await act(async () => { finish(new Response(JSON.stringify(success ? { success: true, message: 'Saved' } : { error: 'Save denied' }), { status: success ? 200 : 403 })); });
    expect(await screen.findByText(success ? /Saved/ : 'Save denied')).toBeInTheDocument(); expect(credential).toHaveValue('newer draft');
  });
  it('renders one h1 and leaves page focus and Escape alone while drawer is closed', async () => {
    render(<><button>Outside navigation</button><SettingsPage {...props} /></>); await screen.findByRole('button', { name: /Slack —/ });
    const outside = screen.getByRole('button', { name: 'Outside navigation' }); outside.focus();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1); expect(screen.getByRole('main')).toContainElement(screen.getByRole('heading', { level: 1 }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); fireEvent.keyDown(window, { key: 'Escape' }); expect(outside).toHaveFocus();
  });
  it('uses a named modal drawer with h2 and moves initial focus inside', async () => {
    render(<SettingsPage {...props} />); const dialog = await open(); expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('heading', { level: 2 })).toHaveTextContent('Slack'); expect(within(dialog).getByRole('button', { name: 'Đóng ngăn chi tiết' })).toHaveFocus();
  });
  it('wraps Tab both ways and prevents focus escaping', async () => {
    render(<><button>Outside navigation</button><SettingsPage {...props} /></>); const dialog = await open();
    const first = within(dialog).getByRole('button', { name: 'Đóng ngăn chi tiết' }), last = within(dialog).getByRole('button', { name: 'Kiểm tra kết nối' });
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true }); expect(last).toHaveFocus(); fireEvent.keyDown(last, { key: 'Tab' }); expect(first).toHaveFocus();
    screen.getByRole('button', { name: 'Outside navigation' }).focus(); expect(first).toHaveFocus();
  });
  it('closes on Escape and restores the service opener', async () => {
    render(<SettingsPage {...props} />); await open(); fireEvent.keyDown(window, { key: 'Escape' }); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: /Slack —/ })).toHaveFocus();
  });
  it('returns focus to the current service row after saving replaces its original node across groups', async () => {
    let configured = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/services') return new Response(JSON.stringify({ services: [{ ...slack, configured }] }));
      configured = true; return new Response(JSON.stringify({ success: true, message: 'Saved' }));
    }));
    render(<SettingsPage {...props} />); const old = await screen.findByRole('button', { name: /Slack —/ }); fireEvent.click(old);
    fireEvent.change(screen.getByLabelText('Bot Token'), { target: { value: 'synthetic' } }); fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' })); await screen.findByText(/Saved/);
    expect(old.isConnected).toBe(false); fireEvent.keyDown(window, { key: 'Escape' }); const current = screen.getByRole('button', { name: /Slack —/ }); expect(current).not.toBe(old); expect(current).toHaveFocus();
  });
});
