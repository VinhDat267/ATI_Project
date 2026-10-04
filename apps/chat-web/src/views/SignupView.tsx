import { useState, type FormEvent } from 'react';
import { apiClient } from '../services/api-client';
import { userErrorMessage } from '../services/user-error';
import { AuthFeedback, AuthFormFrame, authButtonClass, authInputClass, type AuthViewProps } from './AuthFormFrame';

export function SignupView({ navigate, authConfig }: AuthViewProps) {
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [message, setMessage] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!authConfig?.signupEnabled || busy) return;
    setBusy(true); setError(null);
    try { setMessage((await apiClient.signup(name, email, password)).message); setPassword(''); }
    catch (reason) { setError(userErrorMessage(reason)); }
    finally { setBusy(false); }
  };
  return <AuthFormFrame title="Tạo tài khoản" description="Xác minh email và chờ quản trị viên duyệt để sử dụng hệ thống." navigate={navigate}>
    <AuthFeedback error={error} message={message} />
    {!authConfig?.signupEnabled ? <p role="status" className="text-sm text-zinc-600">Đăng ký tài khoản hiện đang đóng.</p>
      : !message && <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="text-sm text-zinc-700">Họ tên<input className={authInputClass} value={name} onChange={event => setName(event.target.value)} autoComplete="name" required maxLength={100} /></label>
        <label className="text-sm text-zinc-700">Email<input type="email" className={authInputClass} value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" required maxLength={254} /></label>
        <label className="text-sm text-zinc-700">Mật khẩu<input type="password" className={authInputClass} value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" required minLength={12} maxLength={128} /></label>
        <p className="text-xs text-zinc-500">Mật khẩu từ 12 đến 128 ký tự.</p>
        <button className={authButtonClass} disabled={busy}>{busy ? 'Đang gửi...' : 'Tạo tài khoản'}</button>
      </form>}
  </AuthFormFrame>;
}
