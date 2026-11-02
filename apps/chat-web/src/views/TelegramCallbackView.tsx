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

const meta = {
  id: 'telegram-callback',
  title: 'Kết nối Telegram — ATI',
  htmlClass: '',
  bodyClass: 'min-h-screen bg-[#F8F8F6] text-[#111827] antialiased',
  css: '',
};

const primaryBtn =
  'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold bg-[#FF5701] text-white hover:bg-[#E04C00] disabled:opacity-50 transition-colors shadow-sm';
const secondaryBtn =
  'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-medium bg-white text-[#111827] border border-[#E7E7E2] hover:bg-neutral-50 disabled:opacity-50 transition-colors';

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
    <main className="max-w-xl mx-auto px-4 py-16 text-[#111827] v3-space-y-5">
      <h1 className="font-display text-3xl font-bold">Kết nối Telegram</h1>
      <div className="bg-white border border-[#E7E7E2] rounded-2xl p-6 v3-space-y-4 shadow-sm">
        <p className="text-sm text-[#4B5563] leading-relaxed">
          Mở ứng dụng Telegram, bấm <strong>Start</strong> với bot của ATI để liên kết tài khoản cá nhân của bạn trong 1 chạm (không cần tạo BotFather token hay nhập mã số Chat ID).
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
          <div className="pt-3 border-t border-[#F3F4F6] v3-space-y-3">
            <p role="status" className="text-xs sm:text-sm text-[#4B5563]">
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

        {!pendingPairing && !error && (
          <p role="status" className="text-sm text-[#6B7280]">
            Đang hoàn tất kết nối Telegram…
          </p>
        )}

        {error && (
          <p role="alert" className="text-sm text-[#DC2626]">
            {error}
          </p>
        )}
      </div>

      <a
        href="/settings"
        onClick={(event) => {
          event.preventDefault();
          navigate('/settings', true);
        }}
        className="text-[#FF5701] underline text-sm inline-block"
      >
        Về Kết nối dịch vụ
      </a>
    </main>
  );
}
