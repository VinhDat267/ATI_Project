import { authStorage } from './auth-storage';
import { sharesAuthSession } from './api-client';

export function githubSessionOwner() {
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

export function redirectToGitHub(url: string) {
  const target = new URL(url);
  if (
    target.protocol !== 'https:' &&
    !(target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname))
  ) {
    throw new Error('Không thể mở trang kết nối GitHub.');
  }
  window.location.assign(target.href);
}

let notice: { userId?: string; login: string } | undefined;
export const githubConnectionNotice = {
  set(login: string) {
    notice = { userId: authStorage.getStoredTokens().user?.id, login };
  },
  take(userId?: string) {
    const own = notice;
    notice = undefined;
    return own?.userId === userId ? own?.login : undefined;
  },
};

export const githubCallbackError = (code?: string) =>
  ({
    GITHUB_STATE_INVALID:
      'Yêu cầu kết nối GitHub đã hết hạn hoặc không còn hợp lệ. Hãy bấm "Kết nối GitHub" lại.',
    GITHUB_CONNECT_FAILED: 'Không kết nối được GitHub. Vui lòng thử lại.',
    INVALID_SESSION: 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại rồi kết nối GitHub.',
  }[code ?? ''] ?? 'Không thể hoàn tất kết nối GitHub. Hãy trở về trang dịch vụ để kết nối lại.');

export function conversationReturnPath(returnTo?: string | null) {
  if (!returnTo) return null;
  const match = returnTo.match(/^\/c\/([0-9a-f-]{36})\/?$/i);
  return match ? `/c/${match[1]}` : null;
}
