import { useEffect, useRef, useState, type FormEvent } from 'react';
import { apiClient } from '../services/api-client';
import { userErrorMessage } from '../services/user-error';
import { AuthFeedback, AuthFormFrame, authButtonClass, authInputClass, type AuthViewProps } from './AuthFormFrame';

export function VerifyEmailView({ navigate, token, resend = false }: AuthViewProps & { resend?: boolean }) {
  const [email, setEmail] = useState(''), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null), [message, setMessage] = useState<string | null>(null);
  const verification = useRef<Promise<{ message: string }> | null>(null);
  useEffect(() => {
    if (resend) return;
    if (!token) { setError('Link xác minh không hợp lệ hoặc đã được mở. Hãy yêu cầu gửi lại email.'); return; }
    // StrictMode replays effects. Reuse the original request rather than
    // consuming the one-use token twice and overwriting success with an error.
    verification.current ??= apiClient.verifyEmail(token);
    let current = true; setBusy(true);
    verification.current.then(data => { if (current) setMessage(data.message); })
      .catch(reason => { if (current) setError(userErrorMessage(reason)); })
      .finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [token, resend]);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return; setBusy(true); setError(null);
    try { setMessage((await apiClient.resendVerification(email)).message); }
    catch (reason) { setError(userErrorMessage(reason)); }
    finally { setBusy(false); }
  };
  return <AuthFormFrame title={resend ? 'Gửi lại email xác minh' : 'Xác minh email'} description={resend ? 'Nhập email đã đăng ký để nhận link xác minh mới.' : 'Tài khoản cần xác minh email và được quản trị viên duyệt.'} navigate={navigate}>
    <AuthFeedback error={error} message={message} />
    {!resend && busy && <p role="status" className="text-sm text-text-secondary">Đang xác minh email...</p>}
    {resend && !message && <form onSubmit={submit} className="flex flex-col gap-4">
      <label className="text-sm text-text-secondary">Email<input type="email" className={authInputClass} value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" required maxLength={254} /></label>
      <button className={authButtonClass} disabled={busy}>{busy ? 'Đang gửi...' : 'Gửi lại email xác minh'}</button>
    </form>}
    {!resend && error && <button type="button" className="text-sm text-primary-text hover:underline" onClick={() => navigate('/resend-verification')}>Gửi lại email xác minh</button>}
  </AuthFormFrame>;
}
