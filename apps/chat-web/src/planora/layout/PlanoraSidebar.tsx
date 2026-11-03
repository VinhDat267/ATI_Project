import { forwardRef, useEffect, useState, type MouseEvent } from 'react';
import { Brand } from '../components/Brand';
import { WorkspaceSwitcher } from '../../components/layout/WorkspaceSwitcher';
import { SidebarHistory } from '../../components/layout/SidebarHistory';
import { useSchedulePendingCount } from '../../hooks/use-schedules';
import { getActiveWorkspaceSummary, subscribeWorkspace } from '../../services/workspace-storage';
import { useChatStore } from '../../store/chat-store';
import { ThemeToggle } from '../../prototype/ThemeToggle';
import { avatarInitials } from '../../components/layout/UserNavMenu';
import type { NavTab } from '../../components/layout/MainNav';
import type { User } from '../../types';

export interface PlanoraSidebarProps {
  user: User | null;
  currentTab?: NavTab | null;
  navigate: (path: string) => void;
  onLogout: () => void;
  isOpen?: boolean;
  onClose?: () => void;
  onNewConversation?: () => void;
  closeButtonRef?: React.Ref<HTMLButtonElement>;
}

interface TabDef {
  id: NavTab;
  path: string;
  name: string;
  short: string;
  adminOnly?: boolean;
  icon: string;
}

const TABS: TabDef[] = [
  { id: 'workspace', path: '/', name: 'Không gian làm việc', short: 'Hội thoại', icon: '💬' },
  { id: 'history', path: '/history', name: 'Nhật ký', short: 'Nhật ký', icon: '📋' },
  { id: 'settings', path: '/settings', name: 'Kết nối dịch vụ', short: 'Kết nối', icon: '⚡' },
  { id: 'guide', path: '/guide', name: 'Cẩm nang', short: 'Cẩm nang', icon: '📖' },
  { id: 'users', path: '/admin/users', name: 'Người dùng', short: 'Người dùng', adminOnly: true, icon: '👥' },
];

export const PlanoraSidebar = forwardRef<HTMLElement, PlanoraSidebarProps>(function PlanoraSidebar(
  { user, currentTab, navigate, onLogout, isOpen = false, onClose, onNewConversation, closeButtonRef },
  ref
) {
  const pendingCount = useSchedulePendingCount(user);
  const [activeWorkspace, setActiveWorkspace] = useState(getActiveWorkspaceSummary());
  const conversationId = useChatStore((s) => s.conversationId);

  useEffect(() => {
    return subscribeWorkspace(() => {
      setActiveWorkspace(getActiveWorkspaceSummary());
    });
  }, []);

  const follow = (path: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onClose?.();
    navigate(path);
  };

  const handleNewChat = () => {
    onClose?.();
    if (onNewConversation) {
      onNewConversation();
    } else {
      useChatStore.getState().reset({ preservePlanning: true });
      useChatStore.getState().setConversationId(null);
      navigate('/');
    }
  };

  const canManageUsers =
    (activeWorkspace.id !== 'personal' && activeWorkspace.role === 'admin') ||
    (activeWorkspace.id === 'personal' && user?.role === 'admin');

  const usersPendingCount =
    activeWorkspace.id !== 'personal' && typeof activeWorkspace.pendingCount === 'number'
      ? activeWorkspace.pendingCount
      : 0;

  const tabs = TABS.filter((tab) => !tab.adminOnly || canManageUsers);

  const roleText =
    activeWorkspace.id === 'personal'
      ? user?.role === 'admin'
        ? 'Quản trị viên'
        : 'Thành viên'
      : activeWorkspace.role === 'admin'
      ? 'Quản trị viên'
      : 'Thành viên';

  return (
    <aside
      ref={ref}
      className={`planora-sidebar ${isOpen ? 'planora-sidebar-open' : ''}`}
      role={isOpen ? 'dialog' : undefined}
      aria-modal={isOpen ? 'true' : undefined}
      aria-label={isOpen ? 'Menu điều hướng' : 'Thanh điều hướng bên'}
    >
      {/* 1. Header: Monogram Planora + Tên thương hiệu + Close button (mobile) + WorkspaceSwitcher */}
      <div className="planora-sidebar-header">
        <div className="planora-sidebar-brand-row">
          <Brand size="sm" onClick={() => { onClose?.(); navigate('/'); }} />
          <button
            ref={closeButtonRef}
            type="button"
            className="planora-sidebar-close"
            onClick={onClose}
            aria-label="Đóng điều hướng"
          >
            ✕
          </button>
        </div>

        <WorkspaceSwitcher navigate={navigate} variant="sidebar" />
      </div>

      {/* 2. Nút hành động chính: "Hội thoại mới" */}
      <button
        type="button"
        className="planora-new-chat-btn"
        onClick={handleNewChat}
        aria-label="Hội thoại mới"
      >
        <span aria-hidden="true" style={{ fontSize: 16 }}>+</span>
        <span>Hội thoại mới</span>
      </button>

      {/* 3. Danh mục Navigation chính: Hội thoại, Nhật ký, Kết nối dịch vụ, Cẩm nang, Quản lý người dùng */}
      <nav aria-label="Điều hướng chính" className="planora-sidebar-nav">
        {tabs.map((tab) => {
          const isActive = currentTab === tab.id;
          return (
            <a
              key={tab.id}
              href={tab.path}
              onClick={follow(tab.path)}
              aria-label={
                tab.id === 'history' && pendingCount > 0
                  ? `Nhật ký, ${pendingCount} lượt chờ duyệt`
                  : tab.id === 'users' && usersPendingCount > 0
                  ? `Người dùng, ${usersPendingCount} yêu cầu chờ duyệt`
                  : tab.name
              }
              aria-current={isActive ? 'page' : undefined}
              className={`planora-nav-item ${isActive ? 'planora-nav-item-active' : ''}`}
            >
              <div className="planora-nav-item-content">
                <span className="planora-nav-icon" aria-hidden="true">{tab.icon}</span>
                <span>{tab.name}</span>
              </div>
              {tab.id === 'history' && pendingCount > 0 && (
                <span
                  data-schedule-count
                  className="planora-badge-count"
                  aria-hidden="true"
                >
                  {pendingCount}
                </span>
              )}
              {tab.id === 'users' && usersPendingCount > 0 && (
                <span
                  data-users-pending-count
                  className="planora-badge-count"
                  aria-hidden="true"
                >
                  {usersPendingCount}
                </span>
              )}
            </a>
          );
        })}
      </nav>

      {/* 4. Lịch sử hội thoại: Tái sử dụng SidebarHistory */}
      {currentTab === 'workspace' && (
        <div className="planora-sidebar-history-wrap">
          <SidebarHistory
            planora
            currentConversationId={conversationId}
            onSelectConversation={(id) => {
              onClose?.();
              navigate(`/c/${id}`);
            }}
            onCloseMobileSidebar={onClose}
          />
        </div>
      )}

      {/* 5. Footer: Thông tin tài khoản người dùng, chuyển đổi Sáng/Tối, Chính sách an toàn, Đăng xuất */}
      <div className="planora-sidebar-footer">
        <button
          type="button"
          className="planora-user-card"
          onClick={() => {
            onClose?.();
            navigate('/account');
          }}
          aria-label={`Tài khoản: ${user?.name || user?.email || 'Người dùng'}`}
        >
          <div className="planora-user-avatar">
            {avatarInitials(user)}
          </div>
          <div className="planora-user-info">
            <span className="planora-user-name">
              {user?.name || user?.email || 'Người dùng'}
            </span>
            <span className="planora-user-role">
              {roleText} · {activeWorkspace.id === 'personal' ? 'Cá nhân' : activeWorkspace.name}
            </span>
          </div>
        </button>

        <div className="planora-sidebar-actions-row">
          <ThemeToggle />
          <a
            href="/privacy"
            onClick={follow('/privacy')}
            aria-label="Chính sách an toàn"
          >
            Chính sách
          </a>
          <button
            type="button"
            onClick={onLogout}
            aria-label="Đăng xuất"
          >
            Đăng xuất
          </button>
        </div>
      </div>
    </aside>
  );
});
export default PlanoraSidebar;
