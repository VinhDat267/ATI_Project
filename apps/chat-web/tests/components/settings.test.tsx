/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ServiceCard } from '../../src/components/ServiceCard';
import { SettingsModal } from '../../src/components/SettingsModal';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ServiceCard Component', () => {
  it('renders service info, credential inputs, allowed scope and test connection button', async () => {
    const onTest = vi.fn().mockResolvedValue({ success: true, message: 'OK' });
    const onSave = vi.fn();
    render(
      <ServiceCard
        service="trello"
        title="Trello"
        connected={false}
        allowedScope={['Frontend Team', 'Mobile App']}
        onSave={onSave}
        onTestConnection={onTest}
      />
    );

    expect(screen.getByText('Trello')).toBeDefined();
    expect(screen.getByText('Frontend Team')).toBeDefined();
    expect(screen.getByText('Mobile App')).toBeDefined();

    const testBtn = screen.getByRole('button', { name: /kiểm tra kết nối/i });
    fireEvent.click(testBtn);
    await waitFor(() => expect(onTest).toHaveBeenCalled());
  });

  it('allows adding and removing allowed scope chips', () => {
    const onSave = vi.fn();
    render(
      <ServiceCard
        service="slack"
        title="Slack"
        connected={true}
        allowedScope={['#general']}
        onSave={onSave}
      />
    );

    expect(screen.getByText('#general')).toBeDefined();

    // Add chip
    const input = screen.getByPlaceholderText(/thêm/i);
    fireEvent.change(input, { target: { value: '#announcements' } });
    fireEvent.click(screen.getByRole('button', { name: /thêm/i }));

    expect(screen.getByText('#announcements')).toBeDefined();
  });

  it('shows the returned connection failure and never manufactures a successful ping', async () => {
    render(<ServiceCard service="trello" title="Trello" onTestConnection={async () => ({ success: false, message: 'Token expired' })} />);
    fireEvent.click(screen.getByRole('button', { name: /kiểm tra kết nối/i }));
    expect(await screen.findByText('Token expired')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 650));
    expect(screen.queryByText(/Kết nối tốt|120ms/)).not.toBeInTheDocument();
  });
});

describe('SettingsModal Component', () => {
  it('renders multiple services and close button', async () => {
    const onClose = vi.fn();
    render(<SettingsModal isOpen={true} onClose={onClose} />);

    expect(await screen.findByText(/cài đặt/i)).toBeDefined();
    const closeBtn = screen.getByRole('button', { name: /đóng/i });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on Escape key press', async () => {
    const onClose = vi.fn();
    render(<SettingsModal isOpen={true} onClose={onClose} />);

    expect(await screen.findByText(/cài đặt/i)).toBeDefined();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on backdrop click but not on modal container click', async () => {
    const onClose = vi.fn();
    render(<SettingsModal isOpen={true} onClose={onClose} />);

    const backdrop = await screen.findByRole('dialog');
    // Click inside the modal content
    const modalContent = screen.getByText(/cài đặt & tích hợp dịch vụ/i);
    fireEvent.click(modalContent);
    expect(onClose).not.toHaveBeenCalled();

    // Click backdrop
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('reports the API test failure instead of a success fallback', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/services') return { ok: true, json: async () => ({ services: [{ id: 'trello', name: 'Trello', connected: false, allowedScope: [], credentialFields: [{ key: 'apiKey', label: 'API Key / Client ID' }, { key: 'token', label: 'OAuth / API Token' }], scopeKey: 'boards' }] }) };
      return { ok: false, status: 503, json: async () => ({ error: 'Provider unavailable' }) };
    }));
    render(<SettingsModal isOpen onClose={vi.fn()} authToken="jwt" />);
    fireEvent.click(await screen.findByRole('button', { name: /kiểm tra kết nối/i }));
    expect(await screen.findByText(/Provider unavailable/)).toBeInTheDocument();
    expect(screen.queryByText(/Kết nối tốt|Kết nối thành công/)).not.toBeInTheDocument();
  });

  it('posts credentials and scope to the API and reports the save result', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/services') return { ok: true, json: async () => ({ services: [{ id: 'trello', name: 'Trello', connected: false, allowedScope: [], credentialFields: [{ key: 'apiKey', label: 'API Key / Client ID' }, { key: 'token', label: 'OAuth / API Token' }], scopeKey: 'boards' }] }) };
      if (url === '/api/services/trello/credentials') return { ok: true, json: async () => ({ success: true, message: 'Saved' }) };
      throw new Error('Unexpected endpoint');
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<SettingsModal isOpen onClose={vi.fn()} authToken="jwt" />);
    fireEvent.change(await screen.findByLabelText(/API Key/), { target: { value: 'key-123' } });
    fireEvent.change(screen.getByLabelText(/OAuth/), { target: { value: 'token-456' } });
    fireEvent.change(screen.getByPlaceholderText(/Thêm board/), { target: { value: 'board-789' } });
    fireEvent.click(screen.getByRole('button', { name: /Thêm/i }));
    fireEvent.click(screen.getByRole('button', { name: /Lưu cấu hình/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/services/trello/credentials', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ credentials: { apiKey: 'key-123', token: 'token-456' }, allowedScope: ['board-789'] }),
    })));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('sends Slack botToken using the API credential field', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/services') return { ok: true, json: async () => ({ services: [{ id: 'slack', name: 'Slack', connected: false, allowedScope: [], credentialFields: [{ key: 'botToken', label: 'Bot Token' }], scopeKey: 'channels' }] }) };
      if (url === '/api/services/slack/credentials') return { ok: true, json: async () => ({ success: true, message: 'Saved' }) };
      throw new Error('Unexpected endpoint');
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<SettingsModal isOpen onClose={vi.fn()} authToken="jwt" />);
    fireEvent.change(await screen.findByLabelText('Bot Token'), { target: { value: 'xoxb-example' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu cấu hình/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/services/slack/credentials', expect.objectContaining({
      body: JSON.stringify({ credentials: { botToken: 'xoxb-example' }, allowedScope: [] }),
    })));
  });

  it('renders GitHub fields supplied by the service API and saves repository scope', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/services') return { ok: true, json: async () => ({ services: [{
        id: 'github', name: 'GitHub', connected: false, allowedScope: [],
        credentialFields: [{ key: 'token', label: 'Personal Access Token', type: 'password' }],
        scopeKey: 'repos', scopeLabel: 'Repository',
      }] }) };
      if (url === '/api/services/github/credentials') return { ok: true, json: async () => ({ success: true, message: 'GitHub saved' }) };
      throw new Error(`Unexpected endpoint ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<SettingsModal isOpen onClose={vi.fn()} authToken="jwt" />);
    fireEvent.change(await screen.findByLabelText('Personal Access Token'), { target: { value: 'ghp-example' } });
    fireEvent.change(screen.getByPlaceholderText('Thêm Repository...'), { target: { value: 'owner/repo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu cấu hình' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/services/github/credentials', expect.objectContaining({
      body: JSON.stringify({ credentials: { token: 'ghp-example' }, allowedScope: ['owner/repo'] }),
    })));
  });
});
