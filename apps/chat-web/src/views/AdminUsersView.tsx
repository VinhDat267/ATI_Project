import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '../services/api-client';
import { userErrorMessage } from '../services/user-error';
import type { AdminUser, AdminUserPage, User } from '../types';

type Action = 'approve' | 'disable' | 'enable' | 'role';
type Confirmation = { user: AdminUser; action: Action; role?: 'member' | 'admin' };
const labels = { pending: 'Chờ duyệt', active: 'Đang hoạt động', disabled: 'Đã khóa', member: 'Thành viên', admin: 'Quản trị viên' };
const verbs = { approve: 'duyệt', disable: 'khóa', enable: 'mở khóa', role: 'đổi vai trò' };
const buttonStyle = 'rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-raised disabled:opacity-50 disabled:cursor-not-allowed';
interface Props { user: User | null; navigate: (path: string) => void; onLogout: () => void }

export function AdminUsersView({ user, navigate, onLogout }: Props) {
  const [result, setResult] = useState<AdminUserPage | null>(null);
  const [status, setStatus] = useState<'pending' | undefined>();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const generation = useRef(0);
  const dialog = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    try {
      const data = await apiClient.getAdminUsers({ page, limit: 20, status, search: query });
      if (current === generation.current) setResult(data);
    } catch (reason) { if (current === generation.current) setError(userErrorMessage(reason, 'Không tải được danh sách người dùng.')); }
    finally { if (current === generation.current) setLoading(false); }
  }, [page, status, query]);
  useEffect(() => {
    if (user?.role === 'admin') { setError(null); void load(); }
    return () => { generation.current++; };
  }, [user?.role, load]);
  useEffect(() => {
    if (!confirmation) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) { event.preventDefault(); setConfirmation(null); }
      if (event.key === 'Tab') {
        const buttons = [...(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
        if (!buttons.length) { event.preventDefault(); return; }
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('keydown', keyboard); previous?.focus(); };
  }, [confirmation, busy]);
  const apply = async () => {
    if (!confirmation || busy) return;
    setBusy(true); setError(null);
    try {
      await apiClient.changeAdminUser(confirmation.user.id, confirmation.action, confirmation.role);
      setConfirmation(null);
      await load();
    } catch (reason) { setError(userErrorMessage(reason, 'Không cập nhật được tài khoản.')); }
    finally { setBusy(false); }
  };
  if (!user) return <p role="status" className="p-6">Đang kiểm tra quyền truy cập...</p>;
  if (user.role !== 'admin') return <main className="p-6"><p role="alert">Bạn không có quyền quản trị người dùng.</p><button onClick={() => navigate('/')} className={`${buttonStyle} mt-4`}>Về trang chính</button></main>;
  return <main className="min-h-screen bg-surface-inset text-text">
    <header className="border-b border-border bg-surface px-4 py-4 sm:px-8 flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="font-semibold text-xl">Quản lý người dùng</h1><p className="text-sm text-text-muted mt-1">Quản lý quyền truy cập vào các dịch vụ của nhóm.</p></div>
      <div className="flex gap-2"><button onClick={() => navigate('/')} className={buttonStyle}>Về workspace</button><button onClick={onLogout} className={buttonStyle}>Đăng xuất</button></div>
    </header>
    <section className="mx-auto max-w-6xl px-4 py-6 sm:px-8">
      <div role="tablist" aria-label="Lọc người dùng" className="flex gap-2 mb-4">
        <button role="tab" aria-selected={!status} onClick={() => { setStatus(undefined); setPage(1); }} className={`${buttonStyle} ${!status ? 'bg-surface border-border-strong text-primary-text' : ''}`}>Tất cả người dùng</button>
        <button role="tab" aria-selected={status === 'pending'} onClick={() => { setStatus('pending'); setPage(1); }} className={`${buttonStyle} ${status ? 'bg-surface border-border-strong text-primary-text' : ''}`}>Chờ duyệt ({result?.pendingCount ?? 0})</button>
      </div>
      <form role="search" onSubmit={event => { event.preventDefault(); setQuery(search.trim()); setPage(1); }} className="flex gap-2 mb-5">
        <input type="search" aria-label="Tìm theo email hoặc tên" placeholder="Tìm theo email hoặc tên" maxLength={200} value={search} onChange={event => setSearch(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
        <button type="submit" className={buttonStyle}>Tìm kiếm</button>
      </form>
      {error && <p role="alert" className="mb-4 text-sm text-danger-text">{error}</p>}
      {loading && <p role="status" className="mb-3 text-sm text-text-secondary">Đang tải người dùng...</p>}
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full text-sm text-left"><caption className="sr-only">Danh sách người dùng và quyền truy cập</caption>
          <thead className="bg-surface-inset text-text-muted"><tr><th className="p-4">Người dùng</th><th className="p-4">Trạng thái</th><th className="p-4">Vai trò</th><th className="p-4">Đăng nhập</th><th className="p-4">Thao tác</th></tr></thead>
          <tbody>{result?.users.map(account => <tr key={account.id} className="border-t border-border align-top">
            <td className="p-4"><p className="font-medium">{account.name}</p><p className="mt-1 text-text-muted">{account.email}</p><p className="mt-1 text-xs text-text-muted">Tạo: {new Date(account.createdAt).toLocaleDateString('vi-VN')}</p></td>
            <td className="p-4 whitespace-nowrap"><p>{labels[account.status]}</p><p className="mt-1 text-xs text-text-muted">{account.emailVerified ? 'Email đã xác minh' : 'Email chưa xác minh'}</p></td>
            <td className="p-4 whitespace-nowrap">{labels[account.role]}</td>
            <td className="p-4 whitespace-nowrap"><p>{[account.hasPassword && 'Mật khẩu', account.hasGoogle && 'Google'].filter(Boolean).join(', ') || 'Chưa thiết lập'}</p><p className="mt-1 text-xs text-text-muted">{account.openSessions} phiên đang mở</p></td>
            <td className="p-4"><div className="flex flex-wrap gap-2">
              {account.status === 'pending' && <button className={buttonStyle} disabled={busy || !account.emailVerified} title={!account.emailVerified ? 'Cần xác minh email trước khi duyệt' : undefined} onClick={() => setConfirmation({ user: account, action: 'approve' })}>Duyệt</button>}
              {account.status === 'active' && <button className={buttonStyle} disabled={busy || account.id === user.id} onClick={() => setConfirmation({ user: account, action: 'disable' })}>Khóa</button>}
              {account.status === 'disabled' && <button className={buttonStyle} disabled={busy || !account.emailVerified} onClick={() => setConfirmation({ user: account, action: 'enable' })}>Mở khóa</button>}
              <button className={buttonStyle} disabled={busy || (account.id === user.id && account.role === 'admin')} onClick={() => setConfirmation({ user: account, action: 'role', role: account.role === 'admin' ? 'member' : 'admin' })}>Đổi vai trò</button>
            </div></td>
          </tr>)}</tbody>
        </table>
        {!loading && result?.users.length === 0 && <p className="p-6 text-sm text-text-muted">Không có người dùng phù hợp.</p>}
      </div>
      <nav aria-label="Phân trang người dùng" className="mt-4 flex items-center justify-between gap-3 text-sm"><span>Trang {page} · {result?.total ?? 0} người dùng</span><div className="flex gap-2"><button disabled={loading || page === 1} onClick={() => setPage(page - 1)} className={buttonStyle}>Trang trước</button><button disabled={loading || !result || page * result.limit >= result.total} onClick={() => setPage(page + 1)} className={buttonStyle}>Trang sau</button></div></nav>
    </section>
    {confirmation && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setConfirmation(null); }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="admin-confirm-title" className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-xl">
        <h2 id="admin-confirm-title" className="text-lg font-semibold">Xác nhận {verbs[confirmation.action]}</h2>
        <p className="mt-3 text-sm text-text-secondary">Tài khoản: {confirmation.user.email}</p>
        {confirmation.action === 'approve' && <p className="mt-3 text-sm">Người này sẽ dùng được các service đã kết nối của nhóm (Trello, Slack, GitHub…).</p>}
        {confirmation.action === 'disable' && <p className="mt-3 text-sm">Mọi phiên đăng nhập của người này sẽ bị thu hồi.</p>}
        {confirmation.action === 'enable' && <p className="mt-3 text-sm">Người này sẽ có thể đăng nhập lại và dùng các dịch vụ của nhóm.</p>}
        {confirmation.action === 'role' && <p className="mt-3 text-sm">Vai trò mới: {labels[confirmation.role!]}. {confirmation.role === 'admin' && 'Người này có thể duyệt tài khoản và quản lý cấu hình dịch vụ chung.'}</p>}
        <div className="mt-6 flex justify-end gap-2"><button disabled={busy} className={buttonStyle} onClick={() => setConfirmation(null)}>Hủy</button><button disabled={busy} onClick={() => void apply()} className="rounded-lg bg-primary px-4 py-2 text-sm text-white hover:bg-primary disabled:opacity-50">{busy ? 'Đang xử lý...' : `Xác nhận ${verbs[confirmation.action]}`}</button></div>
      </div>
    </div>}
  </main>;
}
