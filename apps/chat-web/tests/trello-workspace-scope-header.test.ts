/** @vitest-environment jsdom */
// Lỗi trước buổi demo 19/11/2026: các lời gọi Trello không gửi X-Workspace-Id khi người dùng chưa từng chọn không gian,
// nên máy chủ đọc/ghi phạm vi bảng 'default' trong khi planner dùng 'personal:<user>' — trang Kết nối báo "Dùng được"
// mà kế hoạch Trello bị từ chối "chưa được kết nối". Mọi lời gọi theo phạm vi phải gửi không gian đang chọn, như GitHub.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiClient } from '../src/services/api-client';
import { authStorage } from '../src/services/auth-storage';
import { resetWorkspaceStorage, setActiveWorkspaceId } from '../src/services/workspace-storage';

const user = { id: 'u1', email: 'lan@example.test', name: 'Lan' };
let calls: Array<{ url: string; workspace: string | null }> = [];

beforeEach(() => {
  calls = [];
  authStorage.setStoredTokens({ accessToken: 'access', refreshToken: 'refresh', user });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    calls.push({ url: String(input), workspace: new Headers(init?.headers).get('X-Workspace-Id') });
    return new Response(JSON.stringify({ status: 'connected', boards: [], workspaces: [], url: 'https://trello.example/authorize' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
});
afterEach(() => { authStorage.clearStoredTokens(); resetWorkspaceStorage(); vi.restoreAllMocks(); });

async function callAllScoped() {
  await apiClient.getTrelloConnection();
  await apiClient.startTrelloConnection();
  await apiClient.getTrelloWorkspaces();
  await apiClient.getTrelloBoards('trello-ws');
  await apiClient.saveTrelloScope('trello-ws', ['board-1']);
  await apiClient.getTelegramConnection();
  await apiClient.startTelegramConnection();
  await apiClient.getTelegramCandidateChats();
  await apiClient.saveTelegramScope(['1045412655']);
}

it('sends the personal workspace even when the user never picked one explicitly', async () => {
  await callAllScoped();
  expect(calls).toHaveLength(9);
  expect(calls.every(call => call.workspace === 'personal')).toBe(true);
});

it('sends the selected organization so the board scope matches what the planner reads', async () => {
  setActiveWorkspaceId('7f0c2a8e-1b2c-4d5e-8f90-123456789abc');
  await callAllScoped();
  expect(calls).toHaveLength(9);
  expect(calls.every(call => call.workspace === '7f0c2a8e-1b2c-4d5e-8f90-123456789abc')).toBe(true);
});
