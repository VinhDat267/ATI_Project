import { useEffect, useRef, useState } from 'react';
import { apiClient } from '../services/api-client';
import { authStorage } from '../services/auth-storage';
import { userErrorMessage } from '../services/user-error';
import { AuthActionPage } from '../pages/AuthAction/AuthActionPage';
import type { AuthViewProps } from './AuthFormFrame';
export function ResetPasswordView({ navigate, token }: AuthViewProps) {
  const [busy, setBusy] = useState(false), [success, setSuccess] = useState(false), [error, setError] = useState<string | null>(null);
  const mounted = useRef(false), pending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const submit = async (password: string, confirmation: string) => {
    if (pending.current || !token) return;
    if (password.length < 12 || password.length > 128) { setError('Mật khẩu phải có từ 12 đến 128 ký tự.'); return; }
    if (password !== confirmation) { setError('Hai mật khẩu chưa trùng khớp.'); return; }
    pending.current = true; setBusy(true); setError(null);
    const owner = authStorage.getStoredTokens();
    try {
      await apiClient.resetPassword(token, password);
      if (!mounted.current) return;
      const latest = authStorage.getStoredTokens();
      if (latest.accessToken === owner.accessToken && latest.refreshToken === owner.refreshToken) authStorage.clearStoredTokens();
      setSuccess(true);
    } catch (reason) { if (mounted.current) setError(userErrorMessage(reason)); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  return <AuthActionPage mode={success ? 'reset-success' : 'reset-password'} busy={busy} navigate={navigate} onReset={submit}
    error={!token ? 'Link đặt lại mật khẩu không hợp lệ hoặc đã được mở. Hãy yêu cầu một link mới.' : error} />;
}
