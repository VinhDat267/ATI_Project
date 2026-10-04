import { useState, type FormEvent } from 'react';
import { apiClient } from '../services/api-client';
import { authStorage } from '../services/auth-storage';
import { userErrorMessage } from '../services/user-error';
import { AuthFeedback, AuthFormFrame, authButtonClass, authInputClass, type AuthViewProps } from './AuthFormFrame';

export function ResetPasswordView({ navigate, token }: AuthViewProps) {
  const [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState(''), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy || !token) return;
    if (password !== confirmation) { setError('Hai mật khẩu chưa trùng khớp.'); return; }
    setBusy(true); setError(null);
    try { await apiClient.resetPassword(token, password); authStorage.clearStoredTokens(); navigate('/login', true); }
    catch (reason) { setError(userErrorMessage(reason)); }
    finally { setBusy(false); }
  };
  return <AuthFormFrame title="Đặt lại mật khẩu" description="Mọi phiên đăng nhập cũ sẽ kết thúc sau khi đổi mật khẩu." navigate={navigate}>
    <AuthFeedback error={!token ? 'Link đặt lại mật khẩu không hợp lệ hoặc đã được mở. Hãy yêu cầu một link mới.' : error} />
    {token ? <form onSubmit={submit} className="flex flex-col gap-4">
      <label className="text-sm text-zinc-700">Mật khẩu mới<input type="password" className={authInputClass} value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" required minLength={12} maxLength={128} /></label>
      <label className="text-sm text-zinc-700">Nhập lại mật khẩu<input type="password" className={authInputClass} value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="new-password" required minLength={12} maxLength={128} /></label>
      <p className="text-xs text-zinc-500">Mật khẩu từ 12 đến 128 ký tự.</p>
      <button className={authButtonClass} disabled={busy}>{busy ? 'Đang cập nhật...' : 'Đặt lại mật khẩu'}</button>
    </form> : <button type="button" className="text-sm text-[#0071e3] hover:underline" onClick={() => navigate('/forgot-password')}>Yêu cầu link mới</button>}
  </AuthFormFrame>;
}
