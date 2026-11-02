import { authStorage } from './auth-storage';
import { sharesAuthSession } from './api-client';

export function telegramSessionOwner() {
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

let notice: { userId?: string; username: string } | undefined;
export const telegramConnectionNotice = {
  set(username: string) {
    notice = { userId: authStorage.getStoredTokens().user?.id, username };
  },
  take(userId?: string) {
    const own = notice;
    notice = undefined;
    return own?.userId === userId ? own?.username : undefined;
  },
};

export const telegramCallbackError = (code?: string) =>
  ({
    TELEGRAM_STATE_INVALID:
      'Yêu cầu kết nối Telegram đã hết hạn hoặc không còn hợp lệ. Hãy bấm "Kết nối Telegram" lại.',
    TELEGRAM_PAIRING_PENDING:
      'Chưa nhận được tín hiệu nhấn Start từ Telegram. Hãy mở Telegram, bấm Start với bot của ATI rồi bấm xác nhận lại.',
    TELEGRAM_CONNECT_FAILED: 'Không kết nối được Telegram. Vui lòng thử lại.',
    INVALID_SESSION: 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại rồi kết nối Telegram.',
  }[code ?? ''] ?? 'Không thể hoàn tất kết nối Telegram. Hãy trở về trang dịch vụ để kết nối lại.');

export function conversationReturnPath(returnTo?: string | null) {
  if (!returnTo) return null;
  const match = returnTo.match(/^\/c\/([0-9a-f-]{36})\/?$/i);
  return match ? `/c/${match[1]}` : null;
}

export function buildTelegramCallbackPath(payload: {
  state: string;
  botUsername?: string;
  deepLinkUrl?: string;
  groupDeepLinkUrl?: string;
}): string {
  const params = new URLSearchParams();
  params.set('state', payload.state);
  if (payload.botUsername) params.set('botUsername', payload.botUsername);
  if (payload.deepLinkUrl) params.set('deepLinkUrl', payload.deepLinkUrl);
  if (payload.groupDeepLinkUrl) params.set('groupDeepLinkUrl', payload.groupDeepLinkUrl);
  return `/connections/telegram/callback?${params.toString()}`;
}
