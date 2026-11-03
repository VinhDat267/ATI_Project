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
  onNewConversation?: () => void;
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
  onNewConversation,
  children,
}: PlanoraShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const prevOpenRef = useRef(false);

  // Monitor breakpoint crossing (F6): sync drawer state and prevent scroll lock leak
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const syncBreakpoint = () => {
      let isDesktop = false;
      if (typeof window.matchMedia === 'function') {
        isDesktop = window.matchMedia('(min-width: 1024px)').matches;
      } else if (typeof window.innerWidth === 'number') {
        isDesktop = window.innerWidth >= 1024;
      }
      if (isDesktop) {
        setDrawerOpen(false);
      }
    };

    let mql: MediaQueryList | null = null;
    if (typeof window.matchMedia === 'function') {
      mql = window.matchMedia('(min-width: 1024px)');
      mql.addEventListener?.('change', syncBreakpoint);
    }
    window.addEventListener('resize', syncBreakpoint);

    return () => {
      mql?.removeEventListener?.('change', syncBreakpoint);
      window.removeEventListener('resize', syncBreakpoint);
    };
  }, []);

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

  // Focus restore and initial focus for mobile drawer (F2)
  useEffect(() => {
    if (prevOpenRef.current && !drawerOpen) {
      triggerRef.current?.focus();
    }
    prevOpenRef.current = drawerOpen;

    if (!drawerOpen) return;

    // Body scroll lock with original overflow preservation (F6)
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Move initial focus into drawer on mobile (F2)
    queueMicrotask(() => {
      if (closeBtnRef.current) {
        closeBtnRef.current.focus();
      } else if (sidebarRef.current) {
        const first = sidebarRef.current.querySelector<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled)'
        );
        first?.focus();
      }
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      // If a non-sidebar modal dialog is currently open, let that dialog handle Escape (F4)
      const nonSidebarModal = document.querySelector('[role="dialog"]:not(.planora-sidebar)');
      if (nonSidebarModal) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        setDrawerOpen(false);
        return;
      }

      if (e.key === 'Tab' && sidebarRef.current) {
        const focusable = Array.from(
          sidebarRef.current.querySelectorAll<HTMLElement>(
            'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
          )
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
      document.body.style.overflow = originalOverflow;
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
            closeButtonRef={closeBtnRef}
            user={user}
            currentTab={currentTab}
            navigate={navigate}
            onLogout={onLogout}
            onNewConversation={onNewConversation}
            isOpen={drawerOpen}
            onClose={() => setDrawerOpen(false)}
          />

          <div
            className="planora-main-work"
            id="main"
            inert={drawerOpen ? true : undefined}
          >
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
