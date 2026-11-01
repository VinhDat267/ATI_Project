import { authStorage } from './auth-storage';
import { sharesAuthSession } from './api-client';

export function trelloSessionOwner() {
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

export function redirectToTrello(url: string) {
  const target = new URL(url);
  if (
    target.protocol !== 'https:' &&
    !(target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname))
  ) {
    throw new Error('Không thể mở trang kết nối Trello.');
  }
  window.location.assign(target.href);
}

let notice: { userId?: string; username: string } | undefined;
export const trelloConnectionNotice = {
  set(username: string) {
    notice = { userId: authStorage.getStoredTokens().user?.id, username };
  },
  take(userId?: string) {
    const own = notice;
    notice = undefined;
    return own?.userId === userId ? own?.username : undefined;
  },
};

export const trelloCallbackError = (code?: string) =>
  ({
    TRELLO_STATE_INVALID:
      'Yêu cầu kết nối Trello đã hết hạn hoặc không còn hợp lệ. Hãy bấm "Kết nối Trello" lại.',
    TRELLO_REFRESH_TOKEN_MISSING: 'Trello không trả quyền truy cập lâu dài. Hãy kết nối lại.',
    TRELLO_CONNECT_FAILED: 'Không kết nối được Trello. Vui lòng thử lại.',
    INVALID_SESSION: 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại rồi kết nối Trello.',
  }[code ?? ''] ?? 'Không thể hoàn tất kết nối Trello. Hãy trở về trang dịch vụ để kết nối lại.');

export function conversationReturnPath(returnTo?: string | null) {
  if (!returnTo) return null;
  const match = returnTo.match(/^\/c\/([0-9a-f-]{36})\/?$/i);
  return match ? `/c/${match[1]}` : null;
}
