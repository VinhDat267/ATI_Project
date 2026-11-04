import { useState } from 'react';
import { Brand, ServiceLogo } from '../components/Brand';
import { Button } from '../components/Button';
import { StatusBadge } from '../components/StatusBadge';

export function ChatPlanSample() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="planora-chat-plan-sample">
      {/* Demo Notice Banner */}
      <div className="planora-sample-banner" style={{ flexShrink: 0 }}>
        <span className="planora-sample-tag">Mẫu tham chiếu 2 / 4</span>
        <span>Mẫu giao diện Hội thoại làm trung tâm &amp; Card kế hoạch (Chat with Plan) — Demo chưa kết nối API thật</span>
      </div>

      <div className="planora-chat-layout">
        {/* Mobile Navigation Toggle Bar */}
        <div
          className="planora-mobile-nav-toggle"
          onClick={() => setSidebarOpen(prev => !prev)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setSidebarOpen(prev => !prev);
            }
          }}
          aria-expanded={sidebarOpen}
          aria-label="Chuyển đổi điều hướng không gian làm việc"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14 }}>☰</span>
            <span>ATI Project Workspace</span>
          </div>
          <span style={{ fontSize: 11, color: 'var(--planora-muted)' }}>
            {sidebarOpen ? '▲ Đóng menu' : '▼ Danh sách hội thoại'}
          </span>
        </div>

        {/* Left Sidebar (Desktop 248px, Collapsible on Mobile) */}
        <aside
          className={`planora-chat-sidebar ${sidebarOpen ? 'planora-sidebar-open' : ''}`}
          aria-label="Thanh điều hướng bên"
        >
          <div style={{ marginBottom: 20 }}>
            <Brand size="sm" />
          </div>

          {/* Workspace Switcher Component */}
          <div
            style={{
              padding: '10px 12px',
              backgroundColor: 'var(--planora-paper)',
              border: '1px solid var(--planora-divider)',
              borderRadius: 'var(--planora-radius-md)',
              marginBottom: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
            }}
          >
            <div>
              <div style={{ fontSize: 'var(--planora-text-xs)', fontWeight: 600 }}>ATI Project Workspace</div>
              <div style={{ fontSize: 10, color: 'var(--planora-muted)' }}>Tổ chức · Quyền Quản trị</div>
            </div>
            <span style={{ fontSize: 12, color: 'var(--planora-muted)' }}>▾</span>
          </div>

          {/* Nav Links */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 20 }}>
            <div
              style={{
                padding: '8px 12px',
                borderRadius: 'var(--planora-radius-pill)',
                backgroundColor: 'var(--planora-primary-soft)',
                color: 'var(--planora-primary)',
                fontWeight: 600,
                fontSize: 'var(--planora-text-xs)',
              }}
            >
              💬 Hội thoại hiện hành
            </div>
            <div
              style={{
                padding: '8px 12px',
                borderRadius: 'var(--planora-radius-pill)',
                color: 'var(--planora-muted)',
                fontSize: 'var(--planora-text-xs)',
                cursor: 'pointer',
              }}
            >
              ⚡ Kết nối dịch vụ
            </div>
            <div
              style={{
                padding: '8px 12px',
                borderRadius: 'var(--planora-radius-pill)',
                color: 'var(--planora-muted)',
                fontSize: 'var(--planora-text-xs)',
                cursor: 'pointer',
              }}
            >
              📋 Nhật ký &amp; Lịch
            </div>
          </div>

          {/* Conversation History List */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--planora-muted)',
                marginBottom: 8,
              }}
            >
              HỘI THOẠI GẦN ĐÂY
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div
                style={{
                  padding: '8px 10px',
                  borderRadius: 'var(--planora-radius-sm)',
                  backgroundColor: 'var(--planora-paper)',
                  border: '1px solid var(--planora-divider)',
                  fontSize: 'var(--planora-text-xs)',
                  fontWeight: 500,
                }}
              >
                Tổng hợp PR đã merge trên GitHub
              </div>
              <div
                style={{
                  padding: '8px 10px',
                  borderRadius: 'var(--planora-radius-sm)',
                  color: 'var(--planora-muted)',
                  fontSize: 'var(--planora-text-xs)',
                  cursor: 'pointer',
                }}
              >
                Lịch gửi digest 08:00 sáng
              </div>
              <div
                style={{
                  padding: '8px 10px',
                  borderRadius: 'var(--planora-radius-sm)',
                  color: 'var(--planora-muted)',
                  fontSize: 'var(--planora-text-xs)',
                  cursor: 'pointer',
                }}
              >
                Khảo sát sự kiện Google Calendar
              </div>
            </div>
          </div>

          {/* User Profile Footer */}
          <div
            style={{
              borderTop: '1px solid var(--planora-divider)',
              paddingTop: 12,
              marginTop: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  backgroundColor: 'var(--planora-primary)',
                  color: 'var(--planora-on-primary)',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                NL
              </div>
              <div style={{ fontSize: 'var(--planora-text-xs)' }}>
                <div style={{ fontWeight: 600 }}>Nguyễn Long</div>
                <div style={{ fontSize: 10, color: 'var(--planora-muted)' }}>Admin</div>
              </div>
            </div>
          </div>
        </aside>

        {/* Center Main Work Area */}
        <div className="planora-chat-main">
          {/* Top Chat Header */}
          <header className="planora-chat-header">
            <div>
              <h1
                className="planora-font-serif"
                style={{
                  fontSize: 'var(--planora-text-lg)',
                  fontWeight: 600,
                  margin: 0,
                  color: 'var(--planora-text)',
                }}
              >
                Tổng hợp PR đã merge trên GitHub và cập nhật thẻ Trello
              </h1>
              <div style={{ fontSize: 'var(--planora-text-xs)', color: 'var(--planora-muted)' }}>
                Phiên làm việc · Khởi tạo lúc 10:45 · 2 bước thực thi
              </div>
            </div>
            <StatusBadge status="pending" label="Chờ duyệt kế hoạch" />
          </header>

          {/* Feed Container */}
          <div className="planora-chat-feed">
            {/* User Message Turn */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                marginBottom: 24,
              }}
            >
              <div
                style={{
                  maxWidth: '85%',
                  backgroundColor: 'var(--planora-primary-soft)',
                  border: '1px solid var(--planora-divider)',
                  padding: '14px 18px',
                  borderRadius: '16px 16px 4px 16px',
                  color: 'var(--planora-text)',
                  fontSize: 'var(--planora-text-sm)',
                  lineHeight: 1.5,
                  wordBreak: 'break-word',
                }}
              >
                Lấy danh sách các PR đã merge trong tuần này trên repo VinhDat267/ATI_Project và cập nhật thẻ tương ứng trên bảng Trello Sprint 4 sang cột Hoàn thành.
              </div>
            </div>

            {/* AI Assistant Turn with Plan Card */}
            <div style={{ display: 'flex', gap: 14, marginBottom: 24 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  backgroundColor: 'var(--planora-primary)',
                  color: 'var(--planora-on-primary)',
                  display: 'grid',
                  placeItems: 'center',
                  flexShrink: 0,
                  marginTop: 4,
                }}
              >
                <Brand size="sm" showWordmark={false} />
              </div>

              <div style={{ flex: 1, minWidth: 0, maxWidth: 800 }}>
                {/* Plan Card */}
                <div
                  className="planora-card"
                  style={{
                    backgroundColor: 'var(--planora-paper)',
                    border: '1px solid var(--planora-divider)',
                    borderRadius: 'var(--planora-radius-xl)',
                    padding: '20px',
                    boxSizing: 'border-box',
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: 16,
                      borderBottom: '1px solid var(--planora-divider)',
                      paddingBottom: 14,
                      flexWrap: 'wrap',
                      gap: 8,
                    }}
                  >
                    <div>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.08em',
                          color: 'var(--planora-muted)',
                        }}
                      >
                        ĐỀ XUẤT KẾ HOẠCH WORKFLOW
                      </span>
                      <h2
                        className="planora-font-serif"
                        style={{
                          fontSize: 22,
                          fontWeight: 600,
                          color: 'var(--planora-text)',
                          margin: '4px 0 0 0',
                        }}
                      >
                        Kế hoạch thực thi 2 bước
                      </h2>
                    </div>
                    <StatusBadge status="pending" label="Chờ bạn phê duyệt" />
                  </div>

                  <p style={{ fontSize: 'var(--planora-text-sm)', color: 'var(--planora-muted)', marginBottom: 20 }}>
                    Hệ thống đã phân tích yêu cầu và chuẩn bị các tham số cho từng công cụ. Vui lòng kiểm tra kỹ trước khi phê duyệt thực thi:
                  </p>

                  {/* Step Sequence */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 24 }}>
                    {/* Step 1 */}
                    <div
                      style={{
                        padding: 16,
                        backgroundColor: 'var(--planora-canvas)',
                        border: '1px solid var(--planora-divider)',
                        borderRadius: 'var(--planora-radius-md)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <ServiceLogo name="GitHub" size={18} />
                          <span style={{ fontWeight: 600, fontSize: 'var(--planora-text-sm)' }}>
                            Bước 1: github.list_issues (Chỉ đọc)
                          </span>
                        </div>
                        <StatusBadge status="success" label="Đã nạp dữ liệu" />
                      </div>
                      <div style={{ fontSize: 'var(--planora-text-xs)', color: 'var(--planora-muted)', lineHeight: 1.5, wordBreak: 'break-word' }}>
                        <div><strong>Kho mục tiêu:</strong> VinhDat267/ATI_Project · #260 (Đã cấp quyền cá nhân)</div>
                        <div><strong>Bộ lọc:</strong> state=closed, merged=true, limit=10</div>
                      </div>
                    </div>

                    {/* Step 2 */}
                    <div
                      style={{
                        padding: 16,
                        backgroundColor: 'var(--planora-canvas)',
                        border: '1px solid var(--planora-pending-border)',
                        borderRadius: 'var(--planora-radius-md)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <ServiceLogo name="Trello" size={18} />
                          <span style={{ fontWeight: 600, fontSize: 'var(--planora-text-sm)' }}>
                            Bước 2: trello.update_card (Lệnh ghi có tác dụng phụ)
                          </span>
                        </div>
                        <StatusBadge status="pending" label="Chờ phê duyệt" />
                      </div>
                      <div style={{ fontSize: 'var(--planora-text-xs)', color: 'var(--planora-muted)', lineHeight: 1.5, wordBreak: 'break-word' }}>
                        <div><strong>Bảng Trello:</strong> Sprint 4 (Workspace ATI Team)</div>
                        <div><strong>Cột đích:</strong> Hoàn thành (Done)</div>
                        <div><strong>Phụ thuộc:</strong> Kết quả PR từ Bước 1</div>
                      </div>
                    </div>
                  </div>

                  {/* Cryptographic Plan Hash Binding */}
                  <div
                    style={{
                      fontSize: 11,
                      fontFamily: 'var(--planora-font-mono)',
                      color: 'var(--planora-muted)',
                      backgroundColor: 'var(--planora-surface-inset)',
                      padding: '8px 12px',
                      borderRadius: 'var(--planora-radius-sm)',
                      marginBottom: 20,
                      wordBreak: 'break-all',
                      overflowWrap: 'anywhere',
                    }}
                  >
                    Mã băm ràng buộc kế hoạch (plan_hash): <code>a7f9c2d184eb402...93f4</code>
                  </div>

                  {/* Actions Dock */}
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Button variant="primary" size="md">
                      Phê duyệt và Thực thi
                    </Button>
                    <Button variant="secondary" size="md">
                      Chỉnh sửa tham số
                    </Button>
                    <Button variant="ghost" size="md">
                      Từ chối kế hoạch
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Single Composer */}
          <div className="planora-chat-composer-dock">
            <div style={{ maxWidth: 'var(--planora-chat-max-width)', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  backgroundColor: 'var(--planora-canvas)',
                  border: '1px solid var(--planora-divider)',
                  borderRadius: 'var(--planora-radius-xl)',
                  padding: '8px 14px',
                  boxSizing: 'border-box',
                  width: '100%',
                }}
              >
                <textarea
                  placeholder="Nhập yêu cầu tiếp theo hoặc đặt câu hỏi làm rõ..."
                  rows={1}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    border: 'none',
                    background: 'transparent',
                    resize: 'none',
                    outline: 'none',
                    fontFamily: 'var(--planora-font-sans)',
                    fontSize: 'var(--planora-text-sm)',
                    color: 'var(--planora-text)',
                    minHeight: 28,
                    maxHeight: 120,
                  }}
                />
                <Button variant="primary" size="sm" square aria-label="Gửi yêu cầu">
                  ➤
                </Button>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: 6,
                  padding: '0 4px',
                  fontSize: 10,
                  color: 'var(--planora-muted)',
                  flexWrap: 'wrap',
                  gap: 4,
                }}
              >
                <span>Enter để gửi · Shift+Enter để xuống dòng</span>
                <span>Một ô soạn thảo duy nhất tại chân màn hình</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
