import { useEffect, useState } from "react";
import { Archive, Trash2, UserRound, ArrowRight, LogOut, Mail, ChevronRight, ShieldCheck } from "lucide-react";
import { AccountApproval } from './AccountApproval';
import type { User } from "../types";
import { ServiceLogo } from "../components/Brand";
import { SidebarHistory } from "../components/layout/SidebarHistory";
import "../settings.css";

type Section = "account" | "archived" | "deleted" | "approvals";
const sections = [
  { id: "account", label: "Tài khoản", icon: UserRound, detail: "Thông tin & phiên đăng nhập" },
  { id: "archived", label: "Lưu trữ", icon: Archive, detail: "Những hội thoại bạn đã cất" },
  { id: "deleted", label: "Đã xóa", icon: Trash2, detail: "Khôi phục khi cần" },
  { id: "approvals", label: "Duyệt tài khoản", icon: ShieldCheck, detail: "Quyền truy cập của thành viên" },
] as const;
function readSection(): Section {
  const value = new URLSearchParams(window.location.search).get("section");
  return value === "archived" || value === "deleted" || value === "approvals" ? value : "account";
}

export interface AccountSettingsProps {
  user: User | null;
  mode?: string;
  currentConversationId: string | null;
  onOpenConversation: (id: string) => void;
  onConversationRemoved: (id: string) => void;
  onServices: () => void;
  onLogout: () => void;
}

export default function AccountSettingsView({ user, mode, currentConversationId, onOpenConversation, onConversationRemoved, onServices, onLogout }: AccountSettingsProps) {
  const [selectedSection, setSection] = useState<Section>(readSection);
  const section = selectedSection === 'approvals' && !user?.isAdmin ? 'account' : selectedSection;
  useEffect(() => {
    const sync = () => setSection(readSection());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  const select = (next: Section) => {
    if (next === section) return;
    const url = new URL(window.location.href);
    url.searchParams.set("section", next);
    window.history.pushState({}, "", url);
    setSection(next);
  };
  return (
    <div className="settings-body">
      <div className="settings-inner">
        <div className="settings-intro">
          <span className="eyebrow">MỘT KHÔNG GIAN GỌN GÀNG HƠN</span>
          <h2>Quản lý không gian của bạn.</h2>
          <p>Thông tin tài khoản, những cuộc hội thoại và công cụ bạn dùng mỗi ngày.</p>
        </div>
        <div className="settings-layout">
          <nav className="settings-navigation" aria-label="Cài đặt">
            {sections.filter(item=>item.id!=='approvals'||user?.isAdmin).map(({ id, label, icon: Mark, detail }) => (
              <button key={id} type="button" aria-current={section === id ? "page" : undefined} className={section === id ? "active" : ""} onClick={() => select(id)}>
                <Mark className="icon" aria-hidden="true" />
                <span><strong>{label}</strong><small>{detail}</small></span>
                <ChevronRight className="icon settings-nav-arrow" aria-hidden="true" />
              </button>
            ))}
          </nav>
          <section className="settings-content" aria-labelledby="settings-section-title" key={section}>
            {section === 'approvals' ? <AccountApproval/> : section === "account" ? (
              <>
                <h3 id="settings-section-title">Thông tin của bạn.</h3>
                {user ? (
                  <div className="settings-profile">
                    <div className="settings-profile-heading">
                      <span className="settings-avatar" aria-hidden="true">{(user.name || user.email).slice(0, 1).toUpperCase()}</span>
                      <div><span className="eyebrow">TÀI KHOẢN Planora</span><h4>{user.name || user.email}</h4></div>
                    </div>
                    <dl className="settings-fields">
                      <div><dt><UserRound className="icon" aria-hidden="true" />Tên hiển thị</dt><dd>{user.name || "Chưa có tên hiển thị"}</dd></div>
                      <div><dt><Mail className="icon" aria-hidden="true" />Email</dt><dd>{user.email}</dd></div>
                    </dl>
                    <div className="settings-environment"><span>Môi trường ứng dụng</span><span className="tag">{mode === "sandbox" ? "Thử nghiệm" : mode === "live" ? "Trực tiếp" : "Chưa xác định"}</span></div>
                  </div>
                ) : <p role="status">Đang tải thông tin tài khoản…</p>}
                <div className="settings-utility">
                  <div><h3>Dịch vụ của bạn.</h3><p>Quản lý kết nối và phạm vi tài nguyên Planora được phép dùng.</p><div className="settings-service-marks">{["github", "trello", "slack"].map((name) => <span key={name}><ServiceLogo name={name} size={18} />{name === "github" ? "GitHub" : name === "trello" ? "Trello" : "Slack"}</span>)}</div></div>
                  <button type="button" className="btn" onClick={onServices}>Quản lý dịch vụ<ArrowRight className="icon" aria-hidden="true" /></button>
                </div>
                <div className="settings-utility settings-session">
                  <div><h3>Phiên đăng nhập.</h3><p>Đăng xuất khỏi trình duyệt này khi bạn đã làm việc xong.</p></div>
                  <button type="button" className="btn" onClick={onLogout}><LogOut className="icon" aria-hidden="true" />Đăng xuất trên thiết bị này</button>
                </div>
              </>
            ) : (
              <>
                <h3 id="settings-section-title">{section === "archived" ? "Hội thoại lưu trữ." : "Hội thoại đã xóa."}</h3>
                <p className="settings-description">{section === "archived" ? "Mở lại để xem nội dung, hoặc khôi phục để tiếp tục làm việc." : "Khôi phục hội thoại để đưa về danh sách gần đây và tiếp tục làm việc."}</p>
                <div className="settings-history">
                  <SidebarHistory filter={section} currentConversationId={currentConversationId} onSelectConversation={onOpenConversation} onConversationRemoved={onConversationRemoved} />
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
