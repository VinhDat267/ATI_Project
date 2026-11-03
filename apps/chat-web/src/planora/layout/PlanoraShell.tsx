import React, { createContext, useEffect, useRef, useState } from 'react';
import { PlanoraSidebar } from './PlanoraSidebar';
import { Brand } from '../components/Brand';
import { getActiveWorkspaceId, subscribeWorkspace } from '../../services/workspace-storage';
import { useChatStore } from '../../store/chat-store';
import type { NavTab } from '../../components/layout/MainNav';
import type { User } from '../../types';

export interface PlanoraShellProps {
  user: User | null;
  currentTab?: NavTab;
  navigate: (to: string) => void;
  onLogout: () => void;
  children: React.ReactNode;
}

export const PlanoraShellContext = createContext<{ inPlanoraShell: boolean }>({
  inPlanoraShell: false,
});

export function PlanoraShell({
  user,
  currentTab,
  navigate,
  onLogout,
  children,
}: PlanoraShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const prevOpenRef = useRef(false);

  // Preserve workspace invariants: reset store and isolate state on workspace switch
  const lastWorkspaceId = useRef(getActiveWorkspaceId());
  useEffect(() => {
    lastWorkspaceId.current = getActiveWorkspaceId();
    return subscribeWorkspace(() => {
      const nextId = getActiveWorkspaceId();
      if (nextId !== lastWorkspaceId.current) {
        lastWorkspaceId.current = nextId;
        useChatStore.getState().reset();
        useChatStore.getState().setConversationId(null);
        if (/^\/c\//.test(window.location.pathname)) {
          navigate('/');
        }
      }
    });
  }, [navigate]);

  // Focus restore and Escape key handling for accessible mobile drawer
  useEffect(() => {
    if (prevOpenRef.current && !drawerOpen) {
      triggerRef.current?.focus();
    }
    prevOpenRef.current = drawerOpen;

    if (!drawerOpen) return;

    // Body scroll lock
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept Escape if inside an open dialog modal (e.g. WorkspaceSwitcher modal)
      if ((e.target as Element)?.closest?.('[role="dialog"]')) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        setDrawerOpen(false);
        return;
      }

      if (e.key === 'Tab' && sidebarRef.current) {
        const focusable = sidebarRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length > 0) {
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [drawerOpen]);

  return (
    <PlanoraShellContext.Provider value={{ inPlanoraShell: true }}>
      <div className="planora-shell">
        <a className="skip-link" href="#main">
          Đến nội dung chính
        </a>

        {drawerOpen && (
          <div
            className="planora-drawer-backdrop open"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
        )}

        <div className="planora-screen-layout">
          <PlanoraSidebar
            ref={sidebarRef}
            user={user}
            currentTab={currentTab}
            navigate={navigate}
            onLogout={onLogout}
            isOpen={drawerOpen}
            onClose={() => setDrawerOpen(false)}
          />

          <div className="planora-main-work" id="main">
            {/* Mobile Top Bar (< 1024px) */}
            <div className="planora-mobile-bar">
              <button
                ref={triggerRef}
                type="button"
                className="planora-mobile-menu-btn"
                onClick={() => setDrawerOpen((prev) => !prev)}
                aria-label="Mở menu điều hướng"
                aria-expanded={drawerOpen}
              >
                <span aria-hidden="true">☰</span>
              </button>

              <div className="planora-mobile-brand">
                <Brand size="sm" onClick={() => navigate('/')} />
              </div>

              <div className="planora-mobile-workspace">
                <button
                  type="button"
                  className="planora-mobile-ws-pill"
                  onClick={() => setDrawerOpen(true)}
                  aria-label="Mở menu không gian làm việc"
                >
                  <span>{getActiveWorkspaceId() === 'personal' ? '👤' : '🏢'}</span>
                </button>
              </div>
            </div>

            <div className="planora-content-body">
              {children}
            </div>
          </div>
        </div>
      </div>
    </PlanoraShellContext.Provider>
  );
}
export default PlanoraShell;
