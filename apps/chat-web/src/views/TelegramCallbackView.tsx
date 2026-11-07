import { useCallback, useEffect, useRef, useState } from 'react';
import type { TelegramCallbackInput } from '../routes';
import { apiClient } from '../services/api-client';
import { subscribeAuthTokens } from '../services/auth-storage';
import {
  telegramSessionOwner,
  telegramCallbackError,
  telegramConnectionNotice,
  conversationReturnPath,
} from '../services/telegram-connection';
import { usePrototypePage } from '../prototype/usePrototypePage';
import { ConnectionCallbackFrame } from '../planora/layout/ConnectionCallbackFrame';

const meta = {
  id: 'telegram-callback',
  title: 'Kết nối Telegram — Planora',
  htmlClass: '',
  bodyClass: 'min-h-screen bg-[var(--planora-canvas,#F8F8F6)] text-[var(--planora-text,#111827)] antialiased',
  css: '',
};

const primaryBtn =
  'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold bg-[var(--planora-primary)] text-[var(--planora-on-primary)] hover:bg-[var(--planora-primary-hover)] disabled:opacity-50 transition-colors shadow-xs';
const secondaryBtn =
  'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-medium bg-[var(--planora-paper)] text-[var(--planora-text)] border border-[var(--planora-border-strong)] hover:bg-[var(--planora-surface-inset)] disabled:opacity-50 transition-colors';

export function TelegramCallbackView({
  navigate,
  input,
}: {
  navigate: (path: string, replace?: boolean) => void;
  input?: TelegramCallbackInput;
}) {
  usePrototypePage(meta);
  const [error, setError] = useState('');
  const [pendingPairing, setPendingPairing] = useState(false);
  const [busy, setBusy] = useState(false);
  const callback = useRef(input);
  const owns = useRef(telegramSessionOwner());
  const invalidated = useRef(false);
  const mounted = useRef(true);

  const live = () => mounted.current && !invalidated.current && owns.current();

  const verifyPairing = useCallback(async () => {
    const data = callback.current;
    if (!data?.state) {
      setError(telegramCallbackError('TELEGRAM_STATE_INVALID'));
      return;
    }
    if (!live()) return;
    setBusy(true);
    setError('');
    try {
      const result = await apiClient.completeTelegramConnection(data.state);
      if (!live()) return;
      const back = conversationReturnPath(result.returnTo);
      if (back) {
        navigate(back, true);
        return;
      }
      if (result.username) {
        telegramConnectionNotice.set(result.username);
      }
      navigate('/settings#telegram', true);
    } catch (reason: any) {
      if (!live()) return;
      const code = reason?.code ?? reason?.data?.error?.code ?? reason?.data?.code;
      if (code === 'TELEGRAM_PAIRING_PENDING') {
        setPendingPairing(true);
        setError('');
      } else {
        setPendingPairing(false);
        setError(telegramCallbackError(code));
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [navigate]);

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = subscribeAuthTokens((tokens) => {
      if (!tokens.accessToken || !owns.current()) invalidated.current = true;
    });
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== localStorage) return;
      if (
        event.key === null ||
        (['wap_access_token', 'wap_refresh_token', 'wap_user'].includes(event.key) &&
          (!owns.current() || event.newValue === null))
      ) {
        invalidated.current = true;
      }
    };
    window.addEventListener('storage', onStorage);

    const data = callback.current;
    if (data?.error || !data?.state) {
      setError(
        data?.error ? 'Bạn đã huỷ kết nối Telegram.' : telegramCallbackError('TELEGRAM_STATE_INVALID')
      );
    } else {
      void verifyPairing();
    }

    return () => {
      mounted.current = false;
      unsubscribe();
      window.removeEventListener('storage', onStorage);
    };
  }, [verifyPairing]);

  const data = callback.current;
  const deepLinkUrl =
    data?.deepLinkUrl ||
    (data?.botUsername && data?.state
      ? `https://t.me/${encodeURIComponent(data.botUsername)}?start=ati_${encodeURIComponent(data.state)}`
      : undefined);
  const groupDeepLinkUrl =
    data?.groupDeepLinkUrl ||
    (data?.botUsername && data?.state
      ? `https://t.me/${encodeURIComponent(data.botUsername)}?startgroup=ati_${encodeURIComponent(data.state)}`
      : undefined);

  return (
    <main>
      <ConnectionCallbackFrame
        serviceId="telegram"
        serviceName="Telegram"
        title="Kết nối Telegram"
        badge="KẾT NỐI TIN NHẮN TỨC THỜI"
        statusType={error ? 'error' : pendingPairing ? 'pending' : 'pending'}
        statusLabel={error ? 'Chưa kết nối' : pendingPairing ? 'Chờ xác nhận' : 'Đang xử lý'}
        loading={!error && !pendingPairing}
        loadingText="Đang hoàn tất kết nối Telegram…"
        error={error ? <p role="alert">{error}</p> : undefined}
        onBackToSettings={() => navigate('/settings', true)}
        backToSettingsLabel="Về Kết nối dịch vụ"
      >
        <div className="v3-space-y-4">
          <p className="text-sm text-[var(--planora-muted)] leading-relaxed">
            Mở ứng dụng Telegram, bấm <strong>Start</strong> với bot của Planora để liên kết tài khoản cá nhân của bạn trong 1 chạm (không cần tạo BotFather token hay nhập mã số Chat ID).
          </p>

          {deepLinkUrl && (
            <div className="flex flex-wrap items-center gap-3">
              <a
                id="telegram-open-bot"
                href={deepLinkUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={primaryBtn}
              >
                Mở Telegram và bấm Start
              </a>
              {groupDeepLinkUrl && (
                <a
                  id="telegram-open-group"
                  href={groupDeepLinkUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={secondaryBtn}
                >
                  + Thêm bot vào nhóm Telegram
                </a>
              )}
            </div>
          )}

          {pendingPairing && (
            <div className="pt-3 border-t border-[var(--planora-divider)] v3-space-y-3">
              <p role="status" className="text-xs sm:text-sm text-[var(--planora-muted)]">
                Sau khi bạn đã nhấn <strong>Start</strong> trong Telegram, hãy bấm nút dưới đây để hoàn tất.
              </p>
              <button
                id="telegram-verify-pairing"
                type="button"
                disabled={busy}
                onClick={() => void verifyPairing()}
                className={secondaryBtn}
              >
                {busy ? 'Đang kiểm tra…' : 'Tôi đã bấm Start trên Telegram'}
              </button>
            </div>
          )}
        </div>
      </ConnectionCallbackFrame>
    </main>
  );
}

export default TelegramCallbackView;
