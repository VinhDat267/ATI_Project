import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ALL_TOOLS } from '../../../packages/tool-schemas/src/index';
import { App } from '../src/App';
import { SAMPLE_PROMPTS } from '../src/pages/Guide/data';
import { apiClient } from '../src/services/api-client';
import { authStorage } from '../src/services/auth-storage';
import { useChatStore } from '../src/store/chat-store';

vi.mock('../src/hooks/use-sse', () => ({ useSSE: vi.fn(() => ({ disconnected: false })) }));

beforeEach(() => {
  window.history.replaceState({}, '', '/');
  authStorage.clearStoredTokens();
  useChatStore.getState().reset();
  useChatStore.getState().setConversations([]);
  vi.spyOn(apiClient, 'getAuthConfig').mockResolvedValue({ signupEnabled: false, googleEnabled: false });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  authStorage.clearStoredTokens();
});

describe('FE-10 public guide and privacy routes', () => {
  it.each([
    ['/guide', 'Cẩm nang kết nối & Mẫu câu lệnh ATI', 'guide'],
    ['/privacy', 'Dữ liệu và quyền quyết định luôn thuộc về bạn và nhóm của bạn.', 'privacy'],
  ])('renders %s without a session in its prototype scope', async (path, heading, scope) => {
    window.history.replaceState({}, '', path);
    render(<App />);

    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
    expect(document.documentElement.dataset.protoPage).toBe(scope);
    expect(screen.queryByText('Nội dung đang được chuẩn bị.')).toBeNull();
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });

  it('keeps guide navigation inside the app and exposes working tabs', async () => {
    window.history.replaceState({}, '', '/guide');
    render(<App />);

    await screen.findByRole('heading', { level: 1, name: 'Cẩm nang kết nối & Mẫu câu lệnh ATI' });
    const promptsTab = document.querySelector<HTMLButtonElement>('#tab-btn-prompts')!;
    expect(promptsTab).toHaveAttribute('role', 'tab');
    fireEvent.click(promptsTab);
    expect(document.querySelector('#section-prompts')).toHaveTextContent('Tạo thẻ lỗi, issue GitHub, ghi Sheets và báo Slack');
    fireEvent.click(within(screen.getByRole('banner')).getByRole('link', { name: /Về không gian làm việc/ }));
    expect(window.location.pathname).toBe('/');
  });

  it('states the actual retained data and seven-day session without unsupported promises', async () => {
    window.history.replaceState({}, '', '/privacy');
    render(<App />);

    const main = await screen.findByRole('main');
    expect(main).toHaveTextContent('các tin nhắn trong hội thoại, kế hoạch bạn đã duyệt và kết quả từng bước');
    expect(main).toHaveTextContent('Khoá dịch vụ được mã hoá khi lưu');
    expect(main).toHaveTextContent('Phiên đăng nhập có hạn 7 ngày');
    expect(main.textContent).not.toMatch(/gỡ khoá|bản nháp|lịch sử của cả nhóm|security@/i);
  });
});

it('FE-10: every sample prompt declares real catalog tools for the same services', () => {
  const catalog = new Map(ALL_TOOLS.map(tool => [tool.name, tool]));
  expect(SAMPLE_PROMPTS.length).toBeGreaterThan(0);
  for (const sample of SAMPLE_PROMPTS) {
    expect(sample.tools, sample.id).not.toHaveLength(0);
    for (const toolName of sample.tools) {
      const tool = catalog.get(toolName);
      expect(tool, `${sample.id}: ${toolName}`).toBeDefined();
      expect(sample.services, `${sample.id}: ${toolName}`).toContain(tool!.service);
    }
  }
});
