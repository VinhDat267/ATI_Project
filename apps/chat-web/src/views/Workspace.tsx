import { useState, useEffect, useRef, type ReactNode } from "react";
import type { User } from "../types";
import { Brand, Icon } from "../components/Brand";
import { SidebarHistory } from "../components/layout/SidebarHistory";
import { useChatStore } from "../store/chat-store";
export interface WorkspaceProps {
  user: User | null;
  services: boolean;
  onServices: () => void;
  onWorkspace: () => void;
  onNew: () => void;
  onLanding: () => void;
  onLogout: () => void;
  onSelect: (id: string) => void;
  children: ReactNode;
}
export function Workspace({
  user,
  services,
  onServices,
  onWorkspace,
  onNew,
  onLanding,
  onLogout,
  onSelect,
  children,
}: WorkspaceProps) {
  const conversationId = useChatStore((s) => s.conversationId),
    conversations = useChatStore((s) => s.conversations),
    messages = useChatStore((s) => s.messages);
  const title =
    conversations.find((c) => c.id === conversationId)?.title ||
    messages.find((m) => m.role === "user")?.content.slice(0, 70) ||
    (conversationId
      ? "Hội thoại · " + conversationId.slice(0, 8)
      : "Hội thoại mới");
  const [open, setOpen] = useState(false);
  const side = useRef<HTMLElement>(null),
    main = useRef<HTMLElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const previous = useRef(false);
  useEffect(() => {
    const sync = () => {
      const mobile = innerWidth < 1024;
      if (side.current) side.current.inert = mobile && !open;
      if (main.current) main.current.inert = mobile && open;
      if (!mobile && open) setOpen(false);
    };
    sync();
    window.addEventListener("resize", sync);
    if (open)
      side.current
        ?.querySelector<HTMLButtonElement>("[data-close-menu]")
        ?.focus();
    else if (previous.current) trigger.current?.focus();
    previous.current = open;
    const key = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key === "Tab") {
        const items = [
          ...side.current!.querySelectorAll<HTMLElement>(
            "button:not(:disabled),a[href]",
          ),
        ];
        if (e.shiftKey && document.activeElement === items[0]) {
          e.preventDefault();
          items.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === items.at(-1)) {
          e.preventDefault();
          items[0]?.focus();
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("keydown", key);
    };
  }, [open]);
  const action = (fn: () => void) => {
    setOpen(false);
    fn();
  };
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Đến nội dung chính
      </a>
      {open && (
        <div
          className="drawer-backdrop open"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}
      <div className="screen-layout">
        <aside
          className={"sidebar " + (open ? "open" : "")}
          ref={side}
          aria-label="Điều hướng workspace"
        >
          <Brand onClick={() => action(onLanding)} />
          <button
            className="btn square sidebar-close"
            data-close-menu
            onClick={() => setOpen(false)}
            aria-label="Đóng điều hướng"
          >
            <Icon name="x" />
          </button>
          <button
            className="btn primary new-chat"
            onClick={() => action(onNew)}
          >
            <Icon name="plus" />
            Hội thoại mới
          </button>
          <SidebarHistory
            currentConversationId={conversationId}
            onSelectConversation={(id) => {
              onSelect(id);
              setOpen(false);
            }}
            onCloseMobileSidebar={() => setOpen(false)}
          />
          <section className="sidebar-section sidebar-services">
            <button
              className={"history-link " + (services ? "active" : "")}
              onClick={() => action(onServices)}
            >
              <Icon name="grid" />
              Dịch vụ<span className="nav-arrow">↗</span>
            </button>
            <p className="small muted">Cấu hình và phạm vi tài nguyên</p>
          </section>
          <div className="sidebar-footer">
            <div className="account-summary">
              <span className="avatar">
                {(user?.name || user?.email || "U").slice(0, 1).toUpperCase()}
              </span>
              <span>
                <strong>{user?.name || "Người dùng"}</strong>
                <span className="account-email">{user?.email}</span>
              </span>
            </div>
            <p className="account-roadmap">Quản lý tài khoản · Roadmap</p>
            <div className="sidebar-bottom">
              <button onClick={() => action(onLanding)}>Về giới thiệu</button>
              <button onClick={onLogout} aria-label="Đăng xuất">
                <Icon name="logout" />
              </button>
            </div>
          </div>
        </aside>
        <main className="main-work" id="main" ref={main}>
          <header className="app-header">
            <div className="header-title">
              <button
                className="btn square menu-button"
                onClick={() => setOpen(true)}
                ref={trigger}
                aria-label="Mở danh sách hội thoại"
                aria-expanded={open}
              >
                <Icon name="menu" />
              </button>
              <div>
                <div className="eyebrow">
                  {services ? "DỊCH VỤ CỦA NHÓM" : "WORKSPACE ATI"}
                </div>
                <h1>{services ? "Dịch vụ của nhóm" : title}</h1>
              </div>
            </div>
            <div className="header-actions">
              <button
                className="btn"
                onClick={services ? onWorkspace : onServices}
                aria-label={services ? "Về hội thoại" : "Mở cài đặt dịch vụ"}
              >
                <Icon name={services ? "back" : "grid"} />
                <span>{services ? "Về hội thoại" : "Dịch vụ"}</span>
              </button>
            </div>
          </header>
          {children}
        </main>
      </div>
    </div>
  );
}
