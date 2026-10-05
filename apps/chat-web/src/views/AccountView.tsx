import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { apiClient, sharesAuthSession } from '../services/api-client';
import { authStorage } from '../services/auth-storage';
import { userErrorMessage } from '../services/user-error';
import type { AccountProfile, AccountSession, User } from '../types';

const buttonStyle = 'rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-raised disabled:opacity-50 disabled:cursor-not-allowed';
const fieldStyle = 'mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm';
const sectionStyle = 'rounded-2xl border border-border bg-surface p-5';
const roles = { member: 'Thành viên', admin: 'Quản trị viên' };
const when = (value: string) => new Date(value).toLocaleString('vi-VN', { dateStyle: 'medium', timeStyle: 'short' });
interface Props { user: User | null; navigate: (path: string) => void; onLogout: () => void }

export function AccountView({ user, navigate, onLogout }: Props) {
  const [account, setAccount] = useState<AccountProfile | null>(null);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [name, setName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mounted = useRef(true);
  const load = useCallback(async () => {
    const [profile, list] = await Promise.all([apiClient.getAccount(), apiClient.getAccountSessions()]);
    if (!mounted.current) return;
    setAccount(profile.account); setSessions(list.sessions);
    return profile.account;
  }, []);
  useEffect(() => {
    mounted.current = true;
    load().then(profile => { if (profile) setName(profile.name); })
      .catch(reason => { if (mounted.current) setError(userErrorMessage(reason, 'Không tải được thông tin tài khoản.')); });
    apiClient.getAuthConfig().then(config => { if (mounted.current) setGoogleEnabled(config.googleEnabled); }).catch(() => {});
    return () => { mounted.current = false; };
  }, [load]);
  // One action at a time; the outcome is announced through the status or alert line.
  const run = async (key: string, action: () => Promise<string | void>) => {
    if (busy) return;
    setBusy(key); setError(null); setNotice(null);
    try { const message = await action(); if (message && mounted.current) setNotice(message); }
    catch (reason) { if (mounted.current) setError(userErrorMessage(reason, 'Không thực hiện được thao tác. Hãy thử lại.')); }
    finally { if (mounted.current) setBusy(null); }
  };
  const saveName = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || Array.from(trimmed).length > 100) { setNotice(null); setError('Tên phải có từ 1 đến 100 ký tự.'); return; }
    void run('name', async () => {
      const { user: updated } = await apiClient.updateAccountName(trimmed);
      // The navigation menu reads the signed-in user from token storage.
      authStorage.setStoredTokens({ user: { ...user, ...updated } });
      setName(current => current === name ? updated.name : current); await load();
      return 'Đã lưu tên mới.';
    });
  };
  const changePassword = (event: FormEvent) => {
    event.preventDefault(); setNotice(null);
    if (newPassword.length < 12 || newPassword.length > 128) { setError('Mật khẩu mới phải có từ 12 đến 128 ký tự.'); return; }
    if (newPassword !== repeatPassword) { setError('Hai lần nhập mật khẩu mới không khớp.'); return; }
    void run('password', async () => {
      await apiClient.changePassword(currentPassword, newPassword);
      setCurrentPassword(''); setNewPassword(''); setRepeatPassword(''); await load();
      return 'Đã đổi mật khẩu. Các thiết bị khác đã được đăng xuất.';
    });
  };
  const linkGoogle = () => void run('link', async () => {
    const initial = authStorage.getStoredTokens();
    const { url } = await apiClient.startGoogleAuth('link');
    const latest = authStorage.getStoredTokens();
    const sameSession = (latest.accessToken === initial.accessToken && latest.refreshToken === initial.refreshToken)
      || sharesAuthSession(initial.accessToken, latest.accessToken);
    if (!mounted.current || !latest.accessToken || !latest.refreshToken || latest.user?.id !== initial.user?.id || !sameSession) return;
    window.location.assign(url);
  });
  const others = sessions.filter(session => !session.current);
  if (!user) return <p role="status" className="p-6">Đang tải tài khoản...</p>;
  return <main className="min-h-screen bg-surface-inset text-text">
    <header className="border-b border-border bg-surface px-4 py-4 sm:px-8 flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="font-semibold text-xl">Tài khoản</h1><p className="text-sm text-text-muted mt-1">Hồ sơ, mật khẩu và các thiết bị đang đăng nhập.</p></div>
      <div className="flex gap-2"><button type="button" onClick={() => navigate('/')} className={buttonStyle}>Về workspace</button><button type="button" onClick={onLogout} className={buttonStyle}>Đăng xuất</button></div>
    </header>
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8 flex flex-col gap-5">
      {error && <p role="alert" className="text-sm text-danger-text">{error}</p>}
      {notice && <p role="status" className="text-sm text-success-text">{notice}</p>}
      {!account && !error && <p role="status" className="text-sm text-text-secondary">Đang tải thông tin tài khoản...</p>}
      {account && <>
        <section aria-labelledby="account-profile" className={sectionStyle}>
          <h2 id="account-profile" className="font-semibold">Hồ sơ</h2>
          <dl className="mt-3 grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
            <dt className="text-text-muted">Email</dt><dd>{account.email}</dd>
            <dt className="text-text-muted">Vai trò</dt><dd>{roles[account.role]}</dd>
            <dt className="text-text-muted">Ngày tạo</dt><dd>{new Date(account.createdAt).toLocaleDateString('vi-VN')}</dd>
          </dl>
          <form onSubmit={saveName} className="mt-4 flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1 text-sm">Tên hiển thị
              <input value={name} onChange={event => setName(event.target.value)} maxLength={200} autoComplete="name" className={fieldStyle} />
            </label>
            <button type="submit" disabled={busy !== null} className={buttonStyle}>Lưu tên</button>
          </form>
        </section>

        <section aria-labelledby="account-password" className={sectionStyle}>
          <h2 id="account-password" className="font-semibold">Mật khẩu</h2>
          {account.hasPassword ? <form onSubmit={changePassword} className="mt-3 flex flex-col gap-3">
            <label className="text-sm">Mật khẩu hiện tại
              <input type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} required maxLength={128} autoComplete="current-password" className={fieldStyle} />
            </label>
            <label className="text-sm">Mật khẩu mới
              <input type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} required maxLength={128} autoComplete="new-password" aria-describedby="account-password-rule" className={fieldStyle} />
            </label>
            <label className="text-sm">Nhập lại mật khẩu mới
              <input type="password" value={repeatPassword} onChange={event => setRepeatPassword(event.target.value)} required maxLength={128} autoComplete="new-password" className={fieldStyle} />
            </label>
            <p id="account-password-rule" className="text-xs text-text-muted">Từ 12 đến 128 ký tự. Sau khi đổi, các thiết bị khác sẽ bị đăng xuất.</p>
            <div><button type="submit" disabled={busy !== null} className={buttonStyle}>Đổi mật khẩu</button></div>
          </form> : <div className="mt-3 text-sm">
            <p>Tài khoản này đăng nhập bằng Google và chưa có mật khẩu. Để đặt mật khẩu, hãy dùng "Quên mật khẩu": hệ thống gửi link đặt mật khẩu tới {account.email}.</p>
            <button type="button" onClick={() => navigate('/forgot-password')} className={`${buttonStyle} mt-3`}>Đặt mật khẩu qua email</button>
          </div>}
        </section>

        {googleEnabled && <section aria-labelledby="account-methods" className={sectionStyle}>
          <h2 id="account-methods" className="font-semibold">Phương thức đăng nhập</h2>
          <ul className="mt-3 flex flex-col gap-3 text-sm">
            <li><span className="text-text-muted">Mật khẩu:</span> {account.hasPassword ? 'Đã đặt' : 'Chưa đặt'}</li>
            <li className="flex flex-wrap items-center justify-between gap-2">
              <span><span className="text-text-muted">Google:</span> {account.hasGoogle ? `Đã liên kết${account.googleEmail ? ` (${account.googleEmail})` : ''}` : 'Chưa liên kết'}</span>
              {account.hasGoogle
                ? <button type="button" disabled={busy !== null || !account.hasPassword} aria-describedby={account.hasPassword ? undefined : 'account-unlink-rule'} className={buttonStyle}
                    onClick={() => void run('unlink', async () => { await apiClient.unlinkGoogle(); await load(); return 'Đã gỡ liên kết Google.'; })}>Gỡ liên kết</button>
                : <button type="button" disabled={busy !== null} className={buttonStyle}
                    onClick={linkGoogle}>Liên kết Google</button>}
            </li>
            {account.hasGoogle && !account.hasPassword && <li id="account-unlink-rule" className="text-xs text-text-muted">Cần đặt mật khẩu trước khi gỡ liên kết Google, nếu không bạn sẽ không còn cách đăng nhập.</li>}
          </ul>
        </section>}

        <section aria-labelledby="account-sessions" className={sectionStyle}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="account-sessions" className="font-semibold">Phiên đăng nhập</h2>
            <button type="button" disabled={busy !== null || others.length === 0} className={buttonStyle}
              onClick={() => void run('others', async () => {
                const { revoked } = await apiClient.revokeOtherAccountSessions(); await load();
                return revoked ? `Đã đăng xuất ${revoked} phiên khác.` : 'Không có phiên nào khác đang mở.';
              })}>Đăng xuất khỏi mọi thiết bị khác</button>
          </div>
          <ul className="mt-3 divide-y divide-zinc-100 text-sm">
            {[...sessions].sort((a, b) => Number(b.current) - Number(a.current)).map(session => <li key={session.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div>
                <p className="font-medium">{session.device}{session.current && <span className="ml-2 rounded-full bg-primary-tint px-2 py-0.5 text-xs font-normal text-primary-text">Phiên này</span>}</p>
                <p className="mt-1 text-xs text-text-muted">Đăng nhập: {when(session.createdAt)} · Dùng lần cuối: {when(session.lastUsedAt)}</p>
              </div>
              {!session.current && <button type="button" disabled={busy !== null} className={buttonStyle}
                onClick={() => void run(`session-${session.id}`, async () => { await apiClient.revokeAccountSession(session.id); await load(); return `Đã đăng xuất ${session.device}.`; })}>Đăng xuất phiên này</button>}
            </li>)}
          </ul>
        </section>

        <p className="text-xs text-text-muted">Trang này không có chức năng xóa tài khoản hay đổi email. Nếu muốn ngừng sử dụng, hãy nhờ quản trị viên khóa tài khoản.</p>
      </>}
    </div>
  </main>;
}
