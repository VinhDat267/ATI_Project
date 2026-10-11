import { useEffect, useRef, useState } from 'react';
import { apiClient, sharesAuthSession } from '../services/api-client';
import { authStorage, subscribeAuthTokens } from '../services/auth-storage';
import type { GoogleCallbackInput } from '../routes';
import { type AuthViewProps } from './AuthFormFrame';
import { AuthActionPage, type AuthActionMode } from '../pages/AuthAction/AuthActionPage';
import { consumeAuthReturnTarget } from '../services/auth-return-target';

export function GoogleCallbackView({ navigate, googleCallback }: AuthViewProps & { googleCallback?: GoogleCallbackInput }) {
  const [busy, setBusy] = useState(true), [message, setMessage] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const [linked, setLinked] = useState(false);
  const [mode, setMode] = useState<AuthActionMode>('loading');
  const completion = useRef<ReturnType<typeof apiClient.completeGoogleAuth> | null>(null);
  const input = useRef(googleCallback), invalidated = useRef(false);
  const initialSession = useRef(authStorage.getStoredTokens());
  useEffect(() => {
    let mounted = true;
    const ownsLiveSession = () => {
      const initial = initialSession.current, latest = authStorage.getStoredTokens();
      if (initial.user && latest.user?.id !== initial.user.id) return false;
      return (latest.accessToken === initial.accessToken && latest.refreshToken === initial.refreshToken) ||
        sharesAuthSession(initial.accessToken, latest.accessToken);
    };
    // Clearing even an empty session means logout/cancel; a late response must
    // never install credentials over a newer principal or resurrect a session.
    const unsubscribeTokens = subscribeAuthTokens(tokens => {
      if (!tokens.accessToken || !ownsLiveSession()) invalidated.current = true;
    });
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== window.localStorage) return;
      if (event.key !== null && !['wap_access_token', 'wap_refresh_token', 'wap_user'].includes(event.key)) return;
      if (event.key === null || (event.newValue === null && event.key !== 'wap_user') || !ownsLiveSession()) invalidated.current = true;
    };
    window.addEventListener('storage', onStorage);
    const unsubscribe = () => { unsubscribeTokens(); window.removeEventListener('storage', onStorage); };
    const canComplete = () => mounted && !invalidated.current && ownsLiveSession();
    const callback = input.current;
    if (callback?.error || !callback?.code || !callback?.state) {
      setBusy(false); setMode('google-error'); setError(callback?.error ? 'Đăng nhập Google đã bị hủy. Bạn có thể thử lại.' : 'Link đăng nhập Google không hợp lệ hoặc đã được mở. Hãy đăng nhập lại.');
      return unsubscribe;
    }
    completion.current ??= apiClient.completeGoogleAuth(callback.code, callback.state);
    completion.current.then(data => {
      if (!canComplete()) return;
      if ('success' in data && data.success === true) {
        setMode('google-ready'); setMessage('Đã liên kết tài khoản Google.'); setLinked(true); return;
      }
      if (!('accessToken' in data) || !data.accessToken || !data.refreshToken || !data.user?.id) {
        setError('Không thể hoàn tất đăng nhập Google. Hãy đăng nhập lại.'); return;
      }
      // Stop our listener before our own intentional principal transition.
      unsubscribe();
      authStorage.setStoredTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user });
      setMessage('Đăng nhập Google thành công.'); navigate(consumeAuthReturnTarget(data.user.id) ?? '/', true);
    }).catch(reason => {
      if (!canComplete()) return;
      const code = reason?.data?.code;
      if (code === 'ACCOUNT_PENDING') { setMode('google-pending'); setMessage('Tài khoản đang chờ quản trị viên duyệt. Bạn có thể đăng nhập sau khi được duyệt.'); }
      else if (code === 'ACCOUNT_DISABLED') { setMode('blocked-locked'); setError('Tài khoản đã bị vô hiệu hóa. Hãy liên hệ quản trị viên.'); }
      else { setMode('google-error'); setError('Không thể hoàn tất đăng nhập Google. Link có thể đã hết hạn hoặc đã được mở. Hãy đăng nhập lại.'); }
    }).finally(() => { if (mounted) setBusy(false); });
    return () => { mounted = false; unsubscribe(); };
  }, [navigate]);
  return <AuthActionPage mode={mode} navigate={navigate} busy={busy} error={error} message={message} onAccount={linked ? () => navigate('/account') : undefined} />;
}
