import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '../../services/api-client';
import { userErrorMessage } from '../../services/user-error';
import { avatarInitials } from '../../components/layout/UserNavMenu';
import type { AdminUser, User } from '../../types';
import { usePageDialog } from '../usePageDialog';

export type Tab = 'pending' | 'members';
type ModalId = 'modal-approve' | 'modal-toggle-lock' | 'modal-change-role';
export function useUsers(user: User | null) {
  const [tab, setTab] = useState<Tab>('pending'), [search, setSearch] = useState(''), [page, setPage] = useState(1);
  const [rows, setRows] = useState<AdminUser[]>([]), [total, setTotal] = useState(0), [pendingCount, setPendingCount] = useState(0);
  const [counts, setCounts] = useState({ active: 0, locked: 0 }), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalId | null>(null), [selected, setSelected] = useState<AdminUser | null>(null), [newRole, setNewRole] = useState<'member' | 'admin'>('member');
  const generation = useRef(0), active = useRef(false), newRoleRef = useRef<HTMLSelectElement>(null);
  const load = useCallback(async () => {
    const owner = ++generation.current;
    setLoading(true); setError(null);
    try {
      // Counts are server totals; paginated row counts are never presented as group totals.
      const [pending, enabled, disabled, activeTotal, disabledTotal] = await Promise.all([
        apiClient.getAdminUsers({ page: tab === 'pending' ? page : 1, limit: 20, status: 'pending', search: tab === 'pending' ? search.trim() : undefined }),
        apiClient.getAdminUsers({ page: tab === 'members' ? page : 1, limit: 20, status: 'active', search: tab === 'members' ? search.trim() : undefined }),
        apiClient.getAdminUsers({ page: tab === 'members' ? page : 1, limit: 20, status: 'disabled', search: tab === 'members' ? search.trim() : undefined }),
        apiClient.getAdminUsers({ page: 1, limit: 1, status: 'active' }),
        apiClient.getAdminUsers({ page: 1, limit: 1, status: 'disabled' }),
      ]);
      if (owner !== generation.current) return;
      setPendingCount(pending.pendingCount);
      setCounts({ active: activeTotal.total, locked: disabledTotal.total });
      setRows(tab === 'pending' ? pending.users.filter(account => account.status === 'pending') : [...enabled.users.filter(account => account.status === 'active'), ...disabled.users.filter(account => account.status === 'disabled')]);
      setTotal(tab === 'pending' ? pending.total : Math.max(enabled.total, disabled.total));
    } catch (reason) { if (owner === generation.current) setError(userErrorMessage(reason, 'Không tải được danh sách người dùng.')); }
    finally { if (owner === generation.current) setLoading(false); }
  }, [tab, page, search]);
  useEffect(() => { if (user?.role === 'admin') void load(); return () => { generation.current++; }; }, [user?.id, user?.role, load]);
  const closeModal = (_id?: string) => { if (!active.current) { setModal(null); setSelected(null); } };
  usePageDialog(modal, closeModal, busy);
  const open = (id: string, next: ModalId) => {
    const account = rows.find(row => row.id === id);
    if (!account || account.id === user?.id || (next === 'modal-approve' && !account.emailVerified)) return;
    setSelected(account); setNewRole(account.role); setModal(next); setError(null); setNotice(null);
  };
  const apply = async (action: 'approve' | 'disable' | 'enable' | 'role') => {
    if (!selected || active.current) return;
    active.current = true; setBusy(true); setError(null); setNotice(null);
    const owner = generation.current, target = selected;
    try {
      await apiClient.changeAdminUser(target.id, action, action === 'role' ? newRole : undefined);
      if (owner !== generation.current) return;
      setModal(null); setSelected(null);
      setNotice(action === 'approve' ? 'Đã duyệt. Hệ thống gửi email báo cho người dùng.' : 'Đã cập nhật tài khoản.');
      await load();
    } catch (reason) {
      if (owner === generation.current) {
        const response = reason as { status?: number; data?: { error?: string } };
        setError(response.status === 503 && typeof response.data?.error === 'string' ? response.data.error : userErrorMessage(reason, 'Không cập nhật được tài khoản.'));
      }
    }
    finally { active.current = false; setBusy(false); }
  };
  const isAdmin = user?.role === 'admin';
  const pendingView = { isAdmin, users: rows.filter(row => row.status === 'pending').map(row => ({ ...row, requestedAt: new Date(row.createdAt).toLocaleString('vi-VN'), avatarInitials: avatarInitials(row), provider: row.hasGoogle && row.hasPassword ? 'Email và Google' : row.hasGoogle ? 'Google' : 'Email' })) };
  const membersView = { isAdmin, rows: rows.filter(row => row.status !== 'pending').map(row => ({ ...row, status: row.status === 'disabled' ? 'locked' as const : 'active' as const, joinedDate: new Date(row.createdAt).toLocaleDateString('vi-VN'), sessionsCount: row.openSessions, avatarInitials: avatarInitials(row), isSelf: row.id === user?.id })) };
  const stats = { pending: pendingCount, active: counts.active, locked: counts.locked, total: counts.active + counts.locked };
  const actions = {
    switchTab(next: Tab) { setTab(next); setPage(1); },
    onSearch(value: string) { setSearch(value); setPage(1); },
    openApproveModal(id: string) { open(id, 'modal-approve'); },
    openLockModal(id: string) { open(id, 'modal-toggle-lock'); },
    openRoleModal(id: string) { open(id, 'modal-change-role'); },
    confirmApprove() { void apply('approve'); },
    confirmToggleLock() { void apply(selected?.status === 'disabled' ? 'enable' : 'disable'); },
    confirmChangeRole() { void apply('role'); },
  };
  return { tab, search, setSearch: actions.onSearch, page, setPage, total, loading, busy, error, notice, modal, selected, newRole, setNewRole, newRoleRef, pendingView, membersView, stats, actions, closeModal };
}
