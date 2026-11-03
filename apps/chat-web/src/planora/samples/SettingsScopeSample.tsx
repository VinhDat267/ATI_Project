import { useState } from 'react';
import { ServiceLogo } from '../components/Brand';
import { Button } from '../components/Button';
import { StatusBadge } from '../components/StatusBadge';
import { Field } from '../components/Field';

export function SettingsScopeSample() {
  const [searchTerm, setSearchTerm] = useState('');

  const sampleRepos = [
    { name: 'VinhDat267/ATI_Project', isPrivate: true, selected: true },
    { name: 'longnguyen005/planora', isPrivate: false, selected: true },
    { name: 'ati-org/workflow-engine', isPrivate: true, selected: true },
    { name: 'ati-org/tool-schemas', isPrivate: true, selected: true },
    { name: 'ati-org/frontend-components', isPrivate: false, selected: true },
  ];

  const filteredRepos = sampleRepos.filter(r =>
    r.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="planora-settings-sample" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Demo Notice Banner */}
      <div className="planora-sample-banner">
        <span className="planora-sample-tag">Mẫu tham chiếu 3 / 4</span>
        <span>Mẫu Cài đặt kết nối &amp; Phạm vi tài nguyên (gồm cập nhật từ GitHub PR #260) — Demo chưa kết nối API thật</span>
      </div>

      {/* Main Settings Content */}
      <main style={{ flex: 1, padding: '36px 24px', maxWidth: 960, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ marginBottom: 32 }}>
          <span
            style={{
              fontSize: 'var(--planora-text-xs)',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'var(--planora-muted)',
            }}
          >
            QUẢN LÝ DỊCH VỤ NGOÀI
          </span>
          <h1
            className="planora-font-serif"
            style={{
              fontSize: 32,
              fontWeight: 600,
              color: 'var(--planora-text)',
              margin: '6px 0 8px 0',
            }}
          >
            Kết nối dịch vụ &amp; Phạm vi tài nguyên
          </h1>
          <p style={{ fontSize: 'var(--planora-text-sm)', color: 'var(--planora-muted)', margin: 0 }}>
            Quản lý ủy quyền OAuth cá nhân và danh sách kho lưu trữ, bảng hoặc tài liệu được phép truy cập trong không gian làm việc.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* 1. GitHub Connection Card (PR #260 feature set) */}
          <section
            className="planora-card"
            style={{
              backgroundColor: 'var(--planora-paper)',
              border: '1px solid var(--planora-divider)',
              borderRadius: 'var(--planora-radius-xl)',
              padding: '24px',
            }}
            aria-labelledby="github-settings-heading"
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <ServiceLogo name="GitHub" size={32} />
                <div>
                  <h2 id="github-settings-heading" style={{ fontSize: 'var(--planora-text-md)', fontWeight: 600, margin: 0 }}>
                    GitHub (OAuth cá nhân)
                  </h2>
                  <div style={{ fontSize: 'var(--planora-text-xs)', color: 'var(--planora-muted)' }}>
                    Tài khoản liên kết: <strong>@longnguyen005</strong> · 9 công cụ workflow hoạt động
                  </div>
                </div>
              </div>
              <StatusBadge status="success" label="Đã kết nối" />
            </div>

            {/* Scope / Repo Picker Container */}
            <div
              style={{
                backgroundColor: 'var(--planora-canvas)',
                border: '1px solid var(--planora-divider)',
                borderRadius: 'var(--planora-radius-lg)',
                padding: '18px',
                marginTop: 16,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div style={{ fontWeight: 600, fontSize: 'var(--planora-text-sm)' }}>
                  Kho lưu trữ trong phạm vi được cấp quyền
                </div>
                <div style={{ fontSize: 'var(--planora-text-xs)', color: 'var(--planora-muted)' }}>
                  <strong>5 / 10</strong> kho đã chọn (tối đa 10 kho)
                </div>
              </div>

              {/* Fast Search Input */}
              <div style={{ marginBottom: 14 }}>
                <Field
                  label=""
                  placeholder="Tìm kiếm nhanh kho lưu trữ..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="planora-search-input"
                />
              </div>

              {/* Repo list with Private / Public Badges */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 200, overflowY: 'auto' }}>
                {filteredRepos.map(repo => (
                  <div
                    key={repo.name}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      backgroundColor: 'var(--planora-paper)',
                      border: '1px solid var(--planora-divider)',
                      borderRadius: 'var(--planora-radius-md)',
                      fontSize: 'var(--planora-text-xs)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: 'var(--planora-primary)', fontWeight: 600 }}>✓</span>
                      <span style={{ fontWeight: 500 }}>{repo.name}</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        style={{
                          fontSize: 10,
                          padding: '2px 6px',
                          borderRadius: 4,
                          backgroundColor: repo.isPrivate ? 'var(--planora-surface-inset)' : 'var(--planora-primary-soft)',
                          color: repo.isPrivate ? 'var(--planora-muted)' : 'var(--planora-primary)',
                          fontWeight: 600,
                        }}
                      >
                        {repo.isPrivate ? 'Private' : 'Public'}
                      </span>
                      <Button variant="ghost" size="sm" style={{ minHeight: 28, padding: '2px 8px' }}>
                        Bỏ chọn
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Digest Delivery Destination Options (PR #260) */}
              <div
                style={{
                  marginTop: 16,
                  paddingTop: 14,
                  borderTop: '1px solid var(--planora-divider)',
                  fontSize: 'var(--planora-text-xs)',
                  color: 'var(--planora-muted)',
                }}
              >
                <div>
                  <strong>Đích gửi GitHub Digest tự động:</strong> Slack #team-dev và Telegram ATI Alerts (nhóm)
                </div>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 12, marginTop: 18, justifyContent: 'flex-end' }}>
              <Button variant="secondary" size="sm">
                Lưu thay đổi phạm vi
              </Button>
              <Button variant="danger" size="sm">
                Ngắt kết nối GitHub
              </Button>
            </div>
          </section>

          {/* 2. Trello Connection Card */}
          <section
            className="planora-card"
            style={{
              backgroundColor: 'var(--planora-paper)',
              border: '1px solid var(--planora-divider)',
              borderRadius: 'var(--planora-radius-xl)',
              padding: '24px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <ServiceLogo name="Trello" size={32} />
                <div>
                  <h2 style={{ fontSize: 'var(--planora-text-md)', fontWeight: 600, margin: 0 }}>
                    Trello (OAuth cá nhân)
                  </h2>
                  <div style={{ fontSize: 'var(--planora-text-xs)', color: 'var(--planora-muted)' }}>
                    Workspace: <strong>ATI Team Workspace</strong> · 4 bảng đã chọn
                  </div>
                </div>
              </div>
              <StatusBadge status="success" label="Đã kết nối" />
            </div>

            <div style={{ fontSize: 'var(--planora-text-xs)', color: 'var(--planora-muted)' }}>
              Bảng trong phạm vi: Sprint 4, Dev Pipeline, Báo cáo tuần, Roadmap Q4.
            </div>
          </section>

          {/* 3. Google Sheets Connection Card */}
          <section
            className="planora-card"
            style={{
              backgroundColor: 'var(--planora-paper)',
              border: '1px solid var(--planora-divider)',
              borderRadius: 'var(--planora-radius-xl)',
              padding: '24px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <ServiceLogo name="Google Sheets" size={32} />
                <div>
                  <h2 style={{ fontSize: 'var(--planora-text-md)', fontWeight: 600, margin: 0 }}>
                    Google Sheets (Của riêng bạn)
                  </h2>
                  <div style={{ fontSize: 'var(--planora-text-xs)', color: 'var(--planora-muted)' }}>
                    Chọn tối đa 10 bảng tính qua Google Picker an toàn
                  </div>
                </div>
              </div>
              <StatusBadge status="unknown" label="Chưa cấu hình" />
            </div>

            <Button variant="primary" size="sm">
              Ủy quyền bảng tính qua Google Picker
            </Button>
          </section>
        </div>
      </main>
    </div>
  );
}
