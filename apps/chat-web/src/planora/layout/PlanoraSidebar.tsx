import { forwardRef, useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { Brand } from '../components/Brand';
import { WorkspaceSwitcher } from '../../components/layout/WorkspaceSwitcher';
import { SidebarHistory } from '../../components/layout/SidebarHistory';
import { useSchedulePendingCount } from '../../hooks/use-schedules';
import { getActiveWorkspaceSummary, subscribeWorkspace } from '../../services/workspace-storage';
import { useChatStore } from '../../store/chat-store';
import { ThemeToggle } from '../../prototype/ThemeToggle';
import { avatarInitials } from '../../components/layout/UserNavMenu';
import { ServiceLogo } from '../../components/ServiceLogo';
import { apiClient } from '../../services/api-client';
import type { NavTab } from '../../components/layout/MainNav';
import type { User, ServiceInfo } from '../../types';

export interface PlanoraSidebarProps {
  user: User | null;
  currentTab?: NavTab | null;
  navigate: (path: string) => void;
  onLogout: () => void;
  isOpen?: boolean;
  onClose?: () => void;
  onNewConversation?: () => void;
  closeButtonRef?: React.Ref<HTMLButtonElement>;
  inboxBadgeCount?: number;
}

function ChatBubbleIcon({ className = 'planora-nav-icon' }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  );
}

function InboxIcon({ className = 'planora-nav-icon' }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-4a2 2 0 01-2-2v0a2 2 0 00-2-2h-4a2 2 0 00-2 2v0a2 2 0 01-2 2H4" />
    </svg>
  );
}

function HistoryIcon({ className = 'planora-nav-icon' }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
    </svg>
  );
}

function BoltIcon({ className = 'planora-nav-icon' }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  );
}

function GuideIcon({ className = 'planora-nav-icon' }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  );
}

function UsersIcon({ className = 'planora-nav-icon' }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  );
}

function PlusIcon({ className = 'planora-btn-icon' }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  );
}

function CloseIcon({ className = 'planora-close-icon' }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

const INTEGRATED_SERVICES = ['jira', 'slack', 'sheets', 'calendar', 'trello', 'github', 'notion', 'telegram'] as const;

interface TabDef {
  id: NavTab;
  path: string;
  name: string;
  short: string;
  adminOnly?: boolean;
  icon: (props: { className?: string }) => ReactNode;
}

const TABS: TabDef[] = [
  { id: 'workspace', path: '/', name: 'Không gian làm việc', short: 'Hội thoại', icon: ChatBubbleIcon },
  { id: 'inbox', path: '/inbox', name: 'Hộp thư đề xuất', short: 'Hộp thư', icon: InboxIcon },
  { id: 'history', path: '/history', name: 'Nhật ký & Lịch chạy', short: 'Nhật ký', icon: HistoryIcon },
  { id: 'settings', path: '/settings', name: 'Kết nối dịch vụ', short: 'Kết nối', icon: BoltIcon },
  { id: 'guide', path: '/guide', name: 'Cẩm nang', short: 'Cẩm nang', icon: GuideIcon },
  { id: 'users', path: '/admin/users', name: 'Người dùng', short: 'Người dùng', adminOnly: true, icon: UsersIcon },
];

export const PlanoraSidebar = forwardRef<HTMLElement, PlanoraSidebarProps>(function PlanoraSidebar(
  {
    user,
    currentTab,
    navigate,
    onLogout,
    isOpen = false,
    onClose,
    onNewConversation,
    closeButtonRef,
    inboxBadgeCount,
  },
  ref
) {
  const pendingCount = useSchedulePendingCount(user);
  const [activeWorkspace, setActiveWorkspace] = useState(getActiveWorkspaceSummary());
  const [internalInboxCount, setInternalInboxCount] = useState(0);
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const conversationId = useChatStore((s) => s.conversationId);

  // Load service connections status
  const loadServices = () => {
    if (typeof apiClient?.getServices === 'function') {
      apiClient
        .getServices()
        .then((res) => {
          if (res?.services) {
            setServices(res.services);
          }
        })
        .catch(() => {});
    }
  };

  // Load proposals count for inbox
  const loadInboxCount = () => {
    // If apiClient has getInboxPendingCount or proposals endpoint
    if (typeof (apiClient as unknown as { getInboxPendingCount?: () => Promise<{ count: number }> }).getInboxPendingCount === 'function') {
      (apiClient as unknown as { getInboxPendingCount: () => Promise<{ count: number }> })
        .getInboxPendingCount()
        .then((res) => {
          if (typeof res?.count === 'number') {
            setInternalInboxCount(res.count);
          }
        })
        .catch(() => {});
    }
  };

  useEffect(() => {
    if (currentTab === 'settings') {
      loadServices();
    }
    loadInboxCount();

    const handleFocus = () => {
      if (currentTab === 'settings') {
        loadServices();
      }
      loadInboxCount();
    };
    const handleInboxRefresh = () => loadInboxCount();
    const handleInboxChanged = (e: Event) => {
      const custom = e as CustomEvent<{ count?: number }>;
      if (typeof custom.detail?.count === 'number') {
        setInternalInboxCount(custom.detail.count);
      } else {
        loadInboxCount();
      }
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('inbox:refresh', handleInboxRefresh);
    window.addEventListener('inbox:changed', handleInboxChanged);

    const unsubs = subscribeWorkspace(() => {
      setActiveWorkspace(getActiveWorkspaceSummary());
      // Safe reset on workspace change: clear stale local data immediately
      setInternalInboxCount(0);
      if (currentTab === 'settings') {
        loadServices();
      }
      loadInboxCount();
    });

    return () => {
      unsubs();
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('inbox:refresh', handleInboxRefresh);
      window.removeEventListener('inbox:changed', handleInboxChanged);
    };
  }, [currentTab]);

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

  const effectiveInboxCount =
    typeof inboxBadgeCount === 'number' ? inboxBadgeCount : internalInboxCount;

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
            <CloseIcon />
          </button>
        </div>

        <WorkspaceSwitcher navigate={navigate} variant="sidebar" />
      </div>

      {/* 2. Nút hành động chính: "Cuộc trò chuyện mới" */}
      <button
        type="button"
        className="planora-new-chat-btn"
        onClick={handleNewChat}
        aria-label="Cuộc trò chuyện mới"
      >
        <PlusIcon />
        <span>Cuộc trò chuyện mới</span>
      </button>

      {/* 3. Danh mục Navigation chính: Hội thoại, Hộp thư đề xuất, Nhật ký, Kết nối dịch vụ, Cẩm nang, Quản lý người dùng */}
      <nav aria-label="Điều hướng chính" className="planora-sidebar-nav">
        {tabs.map((tab) => {
          const isActive = currentTab === tab.id;
          const IconComponent = tab.icon;
          return (
            <div key={tab.id} className="planora-nav-item-wrapper">
              <a
                href={tab.path}
                onClick={follow(tab.path)}
                aria-label={
                  tab.id === 'inbox' && effectiveInboxCount > 0
                    ? `Hộp thư đề xuất, ${effectiveInboxCount} đề xuất cần xử lý`
                    : tab.id === 'history' && pendingCount > 0
                    ? `Nhật ký, ${pendingCount} lượt chờ duyệt`
                    : tab.id === 'users' && usersPendingCount > 0
                    ? `Người dùng, ${usersPendingCount} yêu cầu chờ duyệt`
                    : tab.name
                }
                aria-current={isActive ? 'page' : undefined}
                className={`planora-nav-item ${isActive ? 'planora-nav-item-active' : ''}`}
              >
                <div className="planora-nav-item-content">
                  <IconComponent className="planora-nav-icon" />
                  <span>{tab.name}</span>
                </div>
                {tab.id === 'inbox' && effectiveInboxCount > 0 && (
                  <span
                    data-inbox-badge-count
                    className="planora-badge-count"
                    aria-hidden="true"
                  >
                    {effectiveInboxCount}
                  </span>
                )}
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

              {/* Dải chỉ báo kết nối dịch vụ trực tiếp dưới tab Kết nối dịch vụ */}
              {tab.id === 'settings' && (
                <div className="planora-sidebar-services" aria-label="Trạng thái kết nối dịch vụ">
                  {INTEGRATED_SERVICES.map((key) => {
                    const svc = services.find(
                      (s) =>
                        s.id === key ||
                        (key === 'sheets' && s.id === 'mysheets') ||
                        (key === 'calendar' && s.id === 'mycalendar') ||
                        (key === 'jira' && s.id === 'myjira')
                    );
                    const isWarning =
                      svc?.personalStatus === 'reconnect_required' ||
                      svc?.connectionStatus === 'unhealthy';
                    const isConnected = !!svc?.connected && !isWarning;
                    const statusLabel = isConnected
                      ? 'Đã kết nối'
                      : isWarning
                      ? 'Cần kết nối lại'
                      : 'Chưa kết nối';
                    const serviceName =
                      key === 'sheets'
                        ? 'Google Sheets'
                        : key === 'calendar'
                        ? 'Google Calendar'
                        : key.charAt(0).toUpperCase() + key.slice(1);

                    return (
                      <div
                        key={key}
                        className={`planora-service-item planora-service-${
                          isConnected ? 'connected' : isWarning ? 'warning' : 'disconnected'
                        }`}
                        title={`${serviceName}: ${statusLabel}`}
                        aria-label={`${serviceName}: ${statusLabel}`}
                      >
                        <ServiceLogo service={key} className="planora-service-logo" />
                        <span
                          className={`planora-service-indicator planora-service-indicator-${
                            isConnected ? 'connected' : isWarning ? 'warning' : 'disconnected'
                          }`}
                          aria-hidden="true"
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
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
