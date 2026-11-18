/** @vitest-environment jsdom */
// Redesign 11/2026 bước 6c: trang Nhật ký dùng hệ thống .ps-* và rà nút cam/đen còn lại sang .ps-btn/.ps-btn-quiet.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { HistoryPage, meta as historyMeta } from '../src/pages/History/HistoryPage';
import { FakeSheetsPicker } from '../src/components/FakeSheetsPicker';
import { apiClient } from '../src/services/api-client';
import { resetWorkspaceStorage } from '../src/services/workspace-storage';

const user = {
  id: 'u1',
  name: 'Lan Nguyễn',
  email: 'lan@example.test',
  role: 'member' as const,
};

beforeEach(() => {
  window.history.replaceState({}, '', '/history');
  vi.spyOn(apiClient, 'getRuntime').mockResolvedValue({ runtimeMode: 'sandbox' });
  vi.spyOn(apiClient, 'getConversations').mockResolvedValue({
    conversations: [
      { id: 'c1', title: 'Tổng hợp Trello tuần 46', status: 'completed', updatedAt: new Date().toISOString() },
    ],
    nextCursor: 'cursor-1',
  });
});

afterEach(() => {
  cleanup();
  resetWorkspaceStorage();
  vi.restoreAllMocks();
});

it('HistoryPage renders .ps-pagehead "Nhật ký", .ps-field search, .ps-segmented filters, .ps-panel.ps-rows, and zero shadows', async () => {
  render(<HistoryPage user={user} navigate={vi.fn()} onLogout={vi.fn()} />);

  expect(historyMeta.title).toBe('Nhật ký — Planora');
  const main = await screen.findByRole('main');
  expect(within(main).getByRole('heading', { level: 1, name: 'Nhật ký' })).toBeInTheDocument();
  expect(within(main).queryByText(/hội thoại đã tải|Gõ yêu cầu mới/)).toBeNull();
  expect(within(main).getByRole('searchbox')).toHaveClass('ps-field');
  const filterGroup = within(main).getByRole('group', { name: 'Bộ lọc trạng thái hội thoại' });
  expect(filterGroup).toHaveClass('ps-segmented');
  expect(within(filterGroup).getByRole('button', { name: 'Tất cả' })).toHaveAttribute('aria-pressed', 'true');
  expect(main.querySelector('.ps-panel.ps-rows')).not.toBeNull();
  expect(await within(main).findByRole('button', { name: 'Đổi tên Tổng hợp Trello tuần 46' })).toHaveClass('ps-btn-quiet');
  expect(within(main).getByRole('button', { name: 'Tải thêm' })).toHaveClass('ps-btn-quiet');
  expect(main.querySelectorAll('[class*="shadow-"]')).toHaveLength(0);
});

it('FakeSheetsPicker uses .ps-btn and .ps-btn-quiet action buttons', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ files: [] }), { status: 200 })));
  render(<FakeSheetsPicker accessToken="tok" fakePickerBaseUrl="https://picker.test" onSelect={vi.fn()} onCancel={vi.fn()} />);
  expect(await screen.findByRole('button', { name: 'Huỷ' })).toHaveClass('ps-btn-quiet');
  expect(screen.getByRole('button', { name: /Chọn/ })).toHaveClass('ps-btn');
  vi.unstubAllGlobals();
});
