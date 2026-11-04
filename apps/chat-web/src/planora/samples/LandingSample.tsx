import { Brand, ServiceLogo } from '../components/Brand';
import { Button } from '../components/Button';
import { StatusBadge } from '../components/StatusBadge';

export function LandingSample() {
  return (
    <div className="planora-landing-sample">
      {/* Demo Notice Banner */}
      <div className="planora-sample-banner">
        <span className="planora-sample-tag">Mẫu tham chiếu 1 / 4</span>
        <span>Mẫu giao diện Giới thiệu (Landing) Planora — Demo chưa kết nối API thật</span>
      </div>

      {/* Public Header */}
      <header
        style={{
          borderBottom: '1px solid var(--planora-divider)',
          backgroundColor: 'var(--planora-paper)',
          padding: '16px 24px',
        }}
      >
        <div
          style={{
            maxWidth: 'var(--planora-public-max-width)',
            margin: '0 auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <Brand size="md" />

          <nav
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 24,
              fontSize: 'var(--planora-text-sm)',
            }}
          >
            <span style={{ color: 'var(--planora-muted)', cursor: 'pointer' }}>Tính năng</span>
            <span style={{ color: 'var(--planora-muted)', cursor: 'pointer' }}>Dịch vụ</span>
            <span style={{ color: 'var(--planora-muted)', cursor: 'pointer' }}>Cẩm nang</span>
          </nav>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Button variant="ghost" size="sm">
              Đăng nhập
            </Button>
            <Button variant="primary" size="sm">
              Mở workspace
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main style={{ padding: '64px 24px', maxWidth: 'var(--planora-public-max-width)', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', maxWidth: 840, margin: '0 auto' }}>
          <div style={{ display: 'inline-flex', marginBottom: 20 }}>
            <StatusBadge status="success" label="Planora · Nền tảng điều phối đa dịch vụ" />
          </div>

          <h1
            className="planora-font-serif"
            style={{
              fontSize: 'clamp(32px, 5vw, 48px)',
              lineHeight: 1.15,
              fontWeight: 600,
              color: 'var(--planora-text)',
              letterSpacing: '-0.03em',
              margin: '0 0 20px 0',
            }}
          >
            Từ ý tưởng đến kế hoạch và hành động
          </h1>

          <p
            style={{
              fontSize: 'var(--planora-text-md)',
              lineHeight: 1.6,
              color: 'var(--planora-muted)',
              marginBottom: 36,
            }}
          >
            Kết nối quy trình làm việc trên GitHub, Trello, Slack, Google Calendar, Sheets, Jira và Telegram.
            Kế hoạch rõ ràng, từng bước minh bạch và bạn luôn là người duyệt trước khi thực thi.
          </p>

          <div style={{ display: 'flex', justifyContent: 'center', gap: 16, flexWrap: 'wrap' }}>
            <Button variant="primary" size="lg">
              Bắt đầu quy trình làm việc
            </Button>
            <Button variant="secondary" size="lg">
              Xem quy trình mẫu
            </Button>
          </div>
        </div>

        {/* Workflow 3-Step Illustration Card */}
        <div
          className="planora-card"
          style={{
            marginTop: 56,
            padding: '36px 32px',
            backgroundColor: 'var(--planora-paper)',
          }}
        >
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <span
              style={{
                fontSize: 'var(--planora-text-xs)',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                fontWeight: 600,
                color: 'var(--planora-muted)',
              }}
            >
              VÍ DỤ: MỘT YÊU CẦU, BA BƯỚC THỰC THI
            </span>
            <h2
              className="planora-font-serif"
              style={{
                fontSize: 26,
                fontWeight: 500,
                marginTop: 6,
                color: 'var(--planora-text)',
              }}
            >
              Quy trình phát hành tự động sang Slack & Trello
            </h2>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: 20,
            }}
          >
            {/* Step 1 */}
            <div
              style={{
                padding: 20,
                backgroundColor: 'var(--planora-canvas)',
                borderRadius: 'var(--planora-radius-lg)',
                border: '1px solid var(--planora-divider)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <ServiceLogo name="GitHub" size={24} />
                <span style={{ fontWeight: 600, fontSize: 'var(--planora-text-sm)' }}>
                  1. Thu thập dữ liệu
                </span>
              </div>
              <p style={{ fontSize: 'var(--planora-text-xs)', color: 'var(--planora-muted)', margin: 0 }}>
                Tra cứu danh sách Pull Request đã merge gần nhất từ kho lưu trữ GitHub đã kết nối.
              </p>
              <div style={{ marginTop: 14 }}>
                <StatusBadge status="success" label="Đã đọc 4 PRs" />
              </div>
            </div>

            {/* Step 2 */}
            <div
              style={{
                padding: 20,
                backgroundColor: 'var(--planora-canvas)',
                borderRadius: 'var(--planora-radius-lg)',
                border: '1px solid var(--planora-divider)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <ServiceLogo name="Trello" size={24} />
                <span style={{ fontWeight: 600, fontSize: 'var(--planora-text-sm)' }}>
                  2. Cập nhật thẻ nhiệm vụ
                </span>
              </div>
              <p style={{ fontSize: 'var(--planora-text-xs)', color: 'var(--planora-muted)', margin: 0 }}>
                Chuyển thẻ tương ứng trên bảng Sprint sang cột &quot;Đã hoàn thành&quot; kèm liên kết tham chiếu.
              </p>
              <div style={{ marginTop: 14 }}>
                <StatusBadge status="pending" label="Chờ duyệt ghi" />
              </div>
            </div>

            {/* Step 3 */}
            <div
              style={{
                padding: 20,
                backgroundColor: 'var(--planora-canvas)',
                borderRadius: 'var(--planora-radius-lg)',
                border: '1px solid var(--planora-divider)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <ServiceLogo name="Slack" size={24} />
                <span style={{ fontWeight: 600, fontSize: 'var(--planora-text-sm)' }}>
                  3. Thông báo Digest
                </span>
              </div>
              <p style={{ fontSize: 'var(--planora-text-xs)', color: 'var(--planora-muted)', margin: 0 }}>
                Đăng bản tóm tắt phát hành tới kênh #team-dev và nhóm Telegram chỉ định.
              </p>
              <div style={{ marginTop: 14 }}>
                <StatusBadge status="pending" label="Phụ thuộc bước 2" />
              </div>
            </div>
          </div>
        </div>

        {/* Integrated Services Row */}
        <div style={{ marginTop: 64, textAlign: 'center' }}>
          <p
            style={{
              fontSize: 'var(--planora-text-xs)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              fontWeight: 600,
              color: 'var(--planora-muted)',
              marginBottom: 20,
            }}
          >
            DỊCH VỤ TÍCH HỢP SẴN SÀNG
          </p>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 28,
              flexWrap: 'wrap',
            }}
          >
            {['GitHub', 'Trello', 'Slack', 'Google Calendar', 'Google Sheets', 'Jira', 'Telegram', 'Notion'].map(
              svc => (
                <div
                  key={svc}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 14px',
                    borderRadius: 'var(--planora-radius-pill)',
                    backgroundColor: 'var(--planora-paper)',
                    border: '1px solid var(--planora-divider)',
                  }}
                >
                  <ServiceLogo name={svc} size={20} />
                  <span style={{ fontSize: 'var(--planora-text-xs)', fontWeight: 500 }}>{svc}</span>
                </div>
              )
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer
        style={{
          borderTop: '1px solid var(--planora-divider)',
          backgroundColor: 'var(--planora-paper)',
          padding: '24px',
          marginTop: 64,
          textAlign: 'center',
          fontSize: 'var(--planora-text-xs)',
          color: 'var(--planora-muted)',
        }}
      >
        <span>Planora © 2026 · Hệ thống điều phối quy trình làm việc</span>
      </footer>
    </div>
  );
}
