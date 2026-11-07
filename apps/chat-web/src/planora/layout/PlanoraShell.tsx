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
  inboxBadgeCount?: number;
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
  inboxBadgeCount,
  children,
}: PlanoraShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wsPillRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
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
        window.dispatchEvent(new Event('inbox:refresh'));
        window.dispatchEvent(new Event('conversations:refresh'));
        if (/^\/c\//.test(window.location.pathname)) {
          navigate('/');
        }
      }
    });
  }, [navigate]);

  // Focus restore and initial focus for mobile drawer (F2, R1)
  useEffect(() => {
    if (prevOpenRef.current && !drawerOpen) {
      if (openerRef.current && typeof openerRef.current.focus === 'function') {
        openerRef.current.focus();
      } else {
        triggerRef.current?.focus();
      }
    }
    prevOpenRef.current = drawerOpen;

    if (!drawerOpen) return;

    // Body scroll lock with original overflow preservation (F6)
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Move initial focus into drawer on mobile (F2, R1)
    let frameId1: number;
    let frameId2: number;
    let timeoutId: ReturnType<typeof setTimeout>;

    const performFocus = () => {
      const nonSidebarModal = document.querySelector('[role="dialog"]:not(.planora-sidebar)');
      if (nonSidebarModal) return;

      const target = closeBtnRef.current || sidebarRef.current?.querySelector<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled)'
      );
      target?.focus();
    };

    performFocus();
    if (typeof requestAnimationFrame === 'function') {
      frameId1 = requestAnimationFrame(() => {
        frameId2 = requestAnimationFrame(() => {
          performFocus();
        });
      });
    } else {
      timeoutId = setTimeout(performFocus, 0);
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // If a non-sidebar modal dialog is currently open, let that dialog handle Escape and Tab (F4, R2)
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
        ).filter((el) => {
          return (
            el.offsetWidth > 0 ||
            el.offsetHeight > 0 ||
            el === closeBtnRef.current ||
            el.getClientRects().length > 0 ||
            (typeof window !== 'undefined' && window.getComputedStyle(el).display !== 'none')
          );
        });

        if (focusable.length > 0) {
          const first = focusable[0];
          const last = focusable[focusable.length - 1];

          // If focus is currently outside the sidebar (e.g. initial focus was interrupted), bring it inside (R1)
          if (!sidebarRef.current.contains(document.activeElement)) {
            e.preventDefault();
            if (e.shiftKey) {
              last.focus();
            } else {
              first.focus();
            }
            return;
          }

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
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(frameId1);
        cancelAnimationFrame(frameId2);
      }
      clearTimeout(timeoutId);
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
            inboxBadgeCount={inboxBadgeCount}
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
                onClick={(e) => {
                  openerRef.current = e.currentTarget;
                  setDrawerOpen((prev) => !prev);
                }}
                aria-label="Mở menu điều hướng"
                aria-expanded={drawerOpen}
              >
                <svg
                  aria-hidden="true"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>

              <div className="planora-mobile-brand">
                <Brand size="sm" onClick={() => navigate('/')} />
              </div>

              <div className="planora-mobile-workspace">
                <button
                  ref={wsPillRef}
                  type="button"
                  className="planora-mobile-ws-pill"
                  onClick={(e) => {
                    openerRef.current = e.currentTarget;
                    setDrawerOpen(true);
                  }}
                  aria-label="Mở menu không gian làm việc"
                >
                  {getActiveWorkspaceId() === 'personal' ? (
                    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  ) : (
                    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                  )}
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
