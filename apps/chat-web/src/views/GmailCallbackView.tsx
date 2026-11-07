import { useEffect, useRef, useState } from 'react';
import type { GoogleCallbackInput } from '../routes';
import { apiClient } from '../services/api-client';
import { subscribeAuthTokens } from '../services/auth-storage';
import {
  gmailSessionOwner,
  gmailCallbackError,
  gmailConnectionNotice,
  conversationReturnPath,
} from '../services/gmail-connection';
import { usePrototypePage } from '../prototype/usePrototypePage';
import { ConnectionCallbackFrame } from '../planora/layout/ConnectionCallbackFrame';

const meta = {
  id: 'gmail-callback',
  title: 'Kết nối Gmail — Planora',
  htmlClass: '',
  bodyClass: 'min-h-screen bg-[var(--planora-canvas,#F8F8F6)] text-[var(--planora-text,#111827)] antialiased',
  css: '',
};

export function GmailCallbackView({
  navigate,
  input,
}: {
  navigate: (path: string, replace?: boolean) => void;
  input?: GoogleCallbackInput;
}) {
  usePrototypePage(meta);
  const [error, setError] = useState('');
  const callback = useRef(input),
    owns = useRef(gmailSessionOwner()),
    invalidated = useRef(false);
  const completion = useRef<Promise<{ email: string; returnTo?: string }> | null>(null);

  useEffect(() => {
    let mounted = true;
    const unsubscribe = subscribeAuthTokens((tokens) => {
      if (!tokens.accessToken || !owns.current()) invalidated.current = true;
    });
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== localStorage) return;
      if (
        event.key === null ||
        (['wap_access_token', 'wap_refresh_token', 'wap_user'].includes(event.key) &&
          (!owns.current() || event.newValue === null))
      )
        invalidated.current = true;
    };
    window.addEventListener('storage', onStorage);
    const live = () => mounted && !invalidated.current && owns.current();
    const data = callback.current;
    if (data?.error || !data?.code || !data?.state)
      setError(data?.error ? 'Bạn đã huỷ kết nối Gmail.' : gmailCallbackError('GMAIL_STATE_INVALID'));
    else if (live()) {
      completion.current ??= apiClient.completeGmailConnection(data.code, data.state);
      completion.current
        .then((result) => {
          if (!live()) return;
          // Started from a conversation: go back to it; its refusal now offers to send the request again.
          const back = conversationReturnPath(result.returnTo);
          if (back) {
            navigate(back, true);
            return;
          }
          gmailConnectionNotice.set(result.email);
          navigate('/settings#gmail', true);
        })
        .catch((reason) => {
          if (live()) setError(gmailCallbackError(reason?.data?.code));
        });
    }
    return () => {
      mounted = false;
      unsubscribe();
      window.removeEventListener('storage', onStorage);
    };
  }, [navigate]);

  return (
    <main>
      <ConnectionCallbackFrame
        serviceId="gmail"
        serviceName="Gmail"
        title="Kết nối Gmail"
        badge="KẾT NỐI HỘP THƯ DOANH NGHIỆP"
        statusType={error ? 'error' : 'pending'}
        statusLabel={error ? 'Chưa kết nối' : 'Đang xử lý'}
        loading={!error}
        loadingText="Đang hoàn tất kết nối Gmail…"
        error={error ? <p role="alert">{error}</p> : undefined}
        onBackToSettings={() => navigate('/settings', true)}
        backToSettingsLabel="Về Kết nối dịch vụ"
        actions={
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <a
              href="/settings"
              onClick={(event) => {
                event.preventDefault();
                navigate('/settings', true);
              }}
              className="text-xs text-[var(--planora-primary)] underline font-medium hover:opacity-80 transition-opacity"
            >
              Về Kết nối dịch vụ
            </a>
          </div>
        }
      />
    </main>
  );
}
export default GmailCallbackView;
