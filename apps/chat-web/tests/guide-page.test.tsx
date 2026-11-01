/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { GuidePage } from '../src/pages/Guide/GuidePage';
import { apiClient } from '../src/services/api-client';

beforeEach(() => {
  window.history.replaceState({}, '', '/guide');
  vi.spyOn(apiClient, 'getRuntime').mockResolvedValue({
    runtimeMode: 'sandbox',
    gmailEnabled: true,
    mycalendarEnabled: true,
    mysheetsEnabled: true,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('GuidePage — OAuth-First AI Automation Playbook & Make.com Orbital Showcase', () => {
  it('renders Bắt đầu sử dụng ATI, Cài đặt dịch vụ headings, Mở Cài đặt dịch vụ link, and Quay lại trò chuyện link', async () => {
    const navigate = vi.fn();
    render(<GuidePage navigate={navigate} />);
    await waitFor(() => expect(apiClient.getRuntime).toHaveBeenCalled());

    expect(screen.getByRole('heading', { level: 1, name: 'Cẩm nang kết nối & Mẫu câu lệnh ATI' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Bắt đầu sử dụng ATI/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Cài đặt dịch vụ/i })).toBeInTheDocument();

    const openSettingsLinks = screen.getAllByRole('link', { name: /Mở Cài đặt dịch vụ/i });
    expect(openSettingsLinks.length).toBeGreaterThanOrEqual(1);
    expect(openSettingsLinks[0]).toHaveAttribute('href', '/settings');

    const backToChatLink = screen.getByRole('link', { name: /Quay lại trò chuyện/i });
    expect(backToChatLink).toHaveAttribute('href', '/');
    fireEvent.click(backToChatLink);
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('features a Make.com-style Orbital Pipeline showcase (WorkflowFlowCanvas) and 1-Click OAuth cards', async () => {
    render(<GuidePage navigate={vi.fn()} />);
    await waitFor(() => expect(apiClient.getRuntime).toHaveBeenCalled());

    const canvases = screen.getAllByTestId('workflow-flow-canvas');
    expect(canvases.length).toBeGreaterThanOrEqual(1);
    expect(canvases[0]).toHaveAttribute('data-router-node', 'true');

    expect(screen.getAllByText(/OAuth 2\.0 · 1-Click/i).length).toBeGreaterThanOrEqual(1);
  });

  it('provides clickable AI Prompt Templates with "Dùng thử mẫu lệnh này" that navigate to /', async () => {
    const navigate = vi.fn();
    render(<GuidePage navigate={navigate} />);
    await waitFor(() => expect(apiClient.getRuntime).toHaveBeenCalled());

    fireEvent.click(document.getElementById('tab-btn-prompts')!);

    const tryButtons = await screen.findAllByRole('button', { name: /Dùng thử mẫu lệnh này/i });
    expect(tryButtons.length).toBeGreaterThanOrEqual(1);

    fireEvent.click(tryButtons[0]);
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('collapses legacy shared-workspace API token instructions inside a <details> drawer titled Dành cho Quản trị viên Workspace (Nâng cao)', async () => {
    render(<GuidePage navigate={vi.fn()} />);
    await waitFor(() => expect(apiClient.getRuntime).toHaveBeenCalled());

    const details = document.querySelector('details[data-testid="workspace-admin-advanced-drawer"]');
    expect(details).not.toBeNull();
    expect(within(details as HTMLElement).getByText(/Dành cho Quản trị viên Workspace \(Nâng cao\)/i)).toBeInTheDocument();
  });
});
