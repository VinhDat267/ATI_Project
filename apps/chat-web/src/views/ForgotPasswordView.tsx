import { useState, type FormEvent } from 'react';
import { apiClient } from '../services/api-client';
import { userErrorMessage } from '../services/user-error';
import { AuthFeedback, AuthFormFrame, authButtonClass, authInputClass, type AuthViewProps } from './AuthFormFrame';

export function ForgotPasswordView({ navigate }: AuthViewProps) {
  const [email, setEmail] = useState(''), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null), [message, setMessage] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return; setBusy(true); setError(null);
    try { setMessage((await apiClient.forgotPassword(email)).message); }
    catch (reason) { setError(userErrorMessage(reason)); }
    finally { setBusy(false); }
  };
  return <AuthFormFrame title="Quên mật khẩu" description="Nhập email để nhận link đặt lại mật khẩu." navigate={navigate}>
    <AuthFeedback error={error} message={message} />
    {!message && <form onSubmit={submit} className="flex flex-col gap-4">
      <label className="text-sm text-text-secondary">Email<input type="email" className={authInputClass} value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" required maxLength={254} /></label>
      <button className={authButtonClass} disabled={busy}>{busy ? 'Đang gửi...' : 'Gửi link đặt lại mật khẩu'}</button>
    </form>}
  </AuthFormFrame>;
}
