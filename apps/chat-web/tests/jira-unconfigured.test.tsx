/** @vitest-environment jsdom */
// Redesign 11/2026 bước 5b: máy chủ chưa bật Jira thì thẻ Jira nói vậy, trung tính như Trello/GitHub, không báo lỗi kết nối.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { JiraConnection } from '../src/pages/Settings/JiraConnection';
import { jiraApi } from '../src/services/jira-api';
import { authStorage } from '../src/services/auth-storage';
import type { User } from '../src/types';

const user: User = { id: 'u1', email: 'lan@example.test', name: 'Lan', role: 'admin', status: 'active' };
const unavailable = (data: Record<string, unknown>) => Object.assign(new Error(String(data.error)), { status: 503, data, code: data.code });

beforeEach(() => {
  authStorage.setStoredTokens({ accessToken: 'a', refreshToken: 'r', user });
  vi.spyOn(jiraApi, 'workspaces').mockRejectedValue(unavailable({ error: 'Kết nối Jira chưa sẵn sàng.', code: 'JIRA_UNCONFIGURED' }));
});
afterEach(() => { cleanup(); authStorage.clearStoredTokens(); vi.restoreAllMocks(); });

it('shows "not configured on the server" without an error, a retry or a dead connect button', async () => {
  vi.spyOn(jiraApi, 'connection').mockRejectedValue(unavailable({ error: 'Kết nối Jira chưa sẵn sàng.', code: 'JIRA_UNCONFIGURED' }));
  const { container } = render(<JiraConnection user={user} standalone={false} />);
  expect(await screen.findByTestId('jira-unconfigured')).toHaveTextContent('Jira chưa được cấu hình trên máy chủ.');
  expect(screen.getByText('Chưa kết nối')).toHaveClass('ps-status-neutral');
  expect(screen.queryByText('Lỗi kết nối')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Kết nối Jira' })).toBeNull();
  expect(container.querySelector('details')).toHaveAttribute('hidden');
});

it.each([false, true])('keeps Jira workspace management available when the workspace API succeeds (existing workspace: %s)', async (hasWorkspace) => {
  vi.spyOn(jiraApi, 'connection').mockRejectedValue(unavailable({ error: 'Kết nối Jira chưa sẵn sàng.', code: 'JIRA_UNCONFIGURED' }));
  vi.mocked(jiraApi.workspaces).mockResolvedValue({
    workspaces: hasWorkspace ? [{
      id: 'workspace-1', name: 'Jira Team North', slug: 'jira-team-north', role: 'member',
      membershipStatus: 'active', workspaceVersion: 1, membershipVersion: 1,
    }] : [],
  });
  vi.spyOn(jiraApi, 'capabilities').mockRejectedValue(new Error('Capabilities unavailable'));
  render(<JiraConnection user={user} standalone={false} />);
  await screen.findByTestId('jira-unconfigured');
  const summary = screen.getByText('Quản lý Không gian làm việc Jira & Dự án nhóm');
  expect(summary).toBeVisible();
  fireEvent.click(summary);
  expect(screen.getByRole('button', { name: 'Tham gia Jira workspace' })).toBeVisible();
  if (hasWorkspace) expect(screen.getByRole('combobox', { name: 'Chọn Jira Workspace' })).toHaveValue('workspace-1');
});

it('still reports a real outage of a configured Jira as an error with a retry', async () => {
  vi.spyOn(jiraApi, 'connection').mockRejectedValue(unavailable({ error: 'Dịch vụ Jira tạm thời không khả dụng.', code: 'upstream_unavailable' }));
  render(<JiraConnection user={user} standalone={false} />);
  await waitFor(() => expect(screen.getByText('Lỗi kết nối')).toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
  expect(screen.queryByTestId('jira-unconfigured')).toBeNull();
});
