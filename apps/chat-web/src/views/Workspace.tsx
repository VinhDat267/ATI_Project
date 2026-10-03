import { useState, useEffect, useRef, type ReactNode } from "react";
import type { User } from "../types";
import { Brand, Icon } from "../components/Brand";
import { SidebarHistory } from "../components/layout/SidebarHistory";
import { useChatStore } from "../store/chat-store";
import { Settings2 } from "lucide-react";
export interface WorkspaceProps {
  user: User | null;
  services: boolean;
  settings?: boolean;
  onSettings?: () => void;
  onServices: () => void;
  onWorkspace: () => void;
  onNew: () => void;
  onConversationRemoved?: (id: string) => void;
  onLogout: () => void;
  onSelect: (id: string) => void;
  children: ReactNode;
}
export function Workspace({
  user,
  services,
  settings = false,
  onSettings,
  onServices,
  onWorkspace,
  onNew,
  onConversationRemoved,
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
      if ((e.target as Element)?.closest?.('[role="dialog"]')) return;
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key === "Tab") {
        const items = [
          ...side.current!.querySelectorAll<HTMLElement>(
            "button:not(:disabled),a[href],input:not(:disabled)",
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
          <Brand label="Planora — workspace" onClick={() => action(onWorkspace)} />
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
          <nav className="sidebar-navigation" aria-label="Không gian làm việc">
            <button className={"history-link " + (!services && !settings ? "active" : "")}
              aria-current={!services && !settings ? "page" : undefined} onClick={() => action(onWorkspace)}>
              <Icon name="chat" />Hội thoại
            </button>
            <button className={"history-link " + (services ? "active" : "")}
              aria-current={services ? "page" : undefined} onClick={() => action(onServices)}>
              <Icon name="grid" />Dịch vụ<Icon name="arrow" />
            </button>
          </nav>
          <SidebarHistory
            currentConversationId={conversationId}
            onSelectConversation={(id) => {
              onSelect(id);
              setOpen(false);
            }}
            onCloseMobileSidebar={() => setOpen(false)}
            onConversationRemoved={onConversationRemoved}
          />
          <div className="sidebar-footer">
            <button className={"account-summary account-settings-button " + (settings ? "active" : "")}
              type="button" aria-label="Cài đặt tài khoản" aria-current={settings ? "page" : undefined}
              onClick={() => onSettings && action(onSettings)} disabled={!onSettings}>
              <span className="avatar">
                {(user?.name || user?.email || "U").slice(0, 1).toUpperCase()}
              </span>
              <span className="account-identity">
                <strong>{user?.name || "Người dùng"}</strong>
                <span className="account-email">{user?.email}</span>
              </span>
              <Settings2 className="icon account-settings-icon" aria-hidden="true" />
            </button>
            <div className="sidebar-bottom">
              <button onClick={onLogout} aria-label="Đăng xuất">
                <Icon name="logout" /> Đăng xuất
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
                  {settings ? "KHÔNG GIAN CỦA BẠN" : services ? "DỊCH VỤ CỦA NHÓM" : "WORKSPACE Planora"}
                </div>
                <h1>{settings ? "Cài đặt tài khoản" : services ? "Dịch vụ của nhóm" : title}</h1>
              </div>
            </div>
            <div className="header-actions">
              <button
                className="btn"
                onClick={services || settings ? onWorkspace : onServices}
                aria-label={services || settings ? "Về hội thoại" : "Mở cài đặt dịch vụ"}
              >
                <Icon name={services || settings ? "back" : "grid"} />
                <span>{services || settings ? "Về hội thoại" : "Dịch vụ"}</span>
              </button>
            </div>
          </header>
          {children}
        </main>
      </div>
    </div>
  );
}
