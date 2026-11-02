import { authStorage } from './auth-storage';
import { sharesAuthSession } from './api-client';

export function jiraSessionOwner() {
  const initial = authStorage.getStoredTokens();
  return () => {
    const latest = authStorage.getStoredTokens();
    return (
      !!initial.accessToken &&
      latest.user?.id === initial.user?.id &&
      ((latest.accessToken === initial.accessToken && latest.refreshToken === initial.refreshToken) ||
        sharesAuthSession(initial.accessToken, latest.accessToken))
    );
  };
}

export function redirectToJira(url: string) {
  const target = new URL(url);
  if (
    target.protocol !== 'https:' &&
    !(target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname))
  ) {
    throw new Error('Không thể mở trang kết nối Jira.');
  }
  window.location.assign(target.href);
}

let notice: { userId?: string; displayName?: string } | undefined;
export const jiraConnectionNotice = {
  set(displayName?: string) {
    notice = { userId: authStorage.getStoredTokens().user?.id, displayName };
  },
  take(userId?: string) {
    const own = notice;
    notice = undefined;
    return own?.userId === userId ? own?.displayName : undefined;
  },
};

export const jiraCallbackError = (code?: string): string => {
  const map: Record<string, string> = {
    JIRA_STATE_INVALID:
      'Yêu cầu kết nối Jira đã hết hạn hoặc không còn hợp lệ. Hãy bấm "Kết nối Jira" lại.',
    JIRA_CONNECT_FAILED: 'Không kết nối được Jira. Vui lòng thử lại.',
    ATLASSIAN_ACCOUNT_IN_USE:
      'Tài khoản Atlassian này đã được liên kết với một tài khoản người dùng khác.',
    ACCOUNT_CHANGED:
      'Không thể đổi tài khoản Atlassian khi chưa ngắt kết nối tài khoản cũ.',
    ACCOUNT_NOT_CONNECTED: 'Chưa có kết nối danh tính Atlassian.',
    INVALID_SESSION: 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại rồi kết nối Jira.',
  };
  return map[code ?? ''] ?? 'Không thể hoàn tất kết nối Jira. Hãy trở về trang dịch vụ để kết nối lại.';
};

export function conversationReturnPath(returnTo?: string | null): string | null {
  if (!returnTo || typeof returnTo !== 'string') return null;
  const match = returnTo.match(/^\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return match ? `/c/${match[1].toLowerCase()}` : null;
}
