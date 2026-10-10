import { useEffect, useRef, useState } from 'react';
import { apiClient } from '../services/api-client';
import { userErrorMessage } from '../services/user-error';
import { AuthActionPage, type AuthActionMode } from '../pages/AuthAction/AuthActionPage';
import type { AuthViewProps } from './AuthFormFrame';
export function VerifyEmailView({ navigate, token, resend = false }: AuthViewProps & { resend?: boolean }) {
  const [busy, setBusy] = useState(!resend), [error, setError] = useState<string | null>(null), [message, setMessage] = useState<string | null>(null);
  const [mode, setMode] = useState<AuthActionMode>(resend ? 'verify-expired' : 'loading');
  const verification = useRef<{ token: string; request: ReturnType<typeof apiClient.verifyEmail> } | null>(null);
  const mounted = useRef(false), pending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (resend) return;
    if (!token) { setBusy(false); setMode('verify-expired'); setError('Link xác minh không hợp lệ hoặc đã được mở. Hãy yêu cầu gửi lại email.'); return; }
    if (verification.current?.token !== token) verification.current = { token, request: apiClient.verifyEmail(token) };
    let current = true; setBusy(true);
    verification.current.request.then(data => { if (current) { setMode('verify-success'); setMessage(data.message); } })
      .catch(reason => { if (current) { setMode('verify-expired'); setError(userErrorMessage(reason)); } })
      .finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [token, resend]);
  const submit = async (email: string) => {
    if (pending.current) return; pending.current = true; setBusy(true); setError(null);
    try { const data = await apiClient.resendVerification(email); if (mounted.current) setMessage(data.message); }
    catch (reason) { if (mounted.current) setError(userErrorMessage(reason)); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  return <AuthActionPage mode={mode} navigate={navigate} busy={busy} error={error} message={message} onResend={submit} />;
}
