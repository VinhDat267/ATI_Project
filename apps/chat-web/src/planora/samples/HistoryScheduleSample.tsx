import { Button } from '../components/Button';
import { StatusBadge } from '../components/StatusBadge';

export function HistoryScheduleSample() {
  const sampleSchedules = [
    {
      id: 'sched-01',
      title: 'GitHub Digest buổi sáng',
      cadence: 'Hàng ngày lúc 08:00 (Asia/Saigon)',
      source: 'GitHub: VinhDat267/ATI_Project',
      destination: 'Slack #team-dev & Telegram ATI Bot',
      status: 'success' as const,
      statusLabel: 'Đang hoạt động',
      lastRun: 'Hôm nay lúc 08:00',
    },
    {
      id: 'sched-02',
      title: 'Đồng bộ sự kiện Google Calendar sang Trello',
      cadence: 'Mỗi thứ Hai lúc 09:00',
      source: 'Google Calendar cá nhân',
      destination: 'Trello: Bảng Sprint 4',
      status: 'error' as const,
      statusLabel: 'needs_attention',
      lastRun: 'Hôm qua lúc 09:00 (Lỗi mạng: Đã giữ marker chống gửi trùng)',
    },
  ];

  const sampleRuns = [
    {
      id: 'run-1042',
      name: 'GitHub Digest sáng 03/11',
      time: '03/11/2026 08:00',
      status: 'success' as const,
      details: 'Đã tổng hợp 4 PRs và gửi thành công tới Slack & Telegram',
    },
    {
      id: 'run-1041',
      name: 'Đồng bộ Google Calendar 02/11',
      time: '02/11/2026 09:00',
      status: 'error' as const,
      details: 'Slack timeout: Trạng thái delivery_started_at được bảo toàn, chặn replan',
    },
    {
      id: 'run-1040',
      name: 'Cập nhật thẻ Trello Sprint 4',
      time: '01/11/2026 17:15',
      status: 'success' as const,
      details: 'Chuyển 2 thẻ sang cột Done theo kế hoạch đã duyệt',
    },
  ];

  return (
    <div className="planora-history-sample" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Demo Notice Banner */}
      <div className="planora-sample-banner">
        <span className="planora-sample-tag">Mẫu tham chiếu 4 / 4</span>
        <span>Mẫu Nhật ký hoạt động &amp; Lịch chạy tự động (History &amp; Schedules) — Demo chưa kết nối API thật</span>
      </div>

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
            LỊCH TRÌNH VÀ BÁO CÁO
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
            Nhật ký hoạt động &amp; Lịch chạy tự động
          </h1>
          <p style={{ fontSize: 'var(--planora-text-sm)', color: 'var(--planora-muted)', margin: 0 }}>
            Theo dõi danh sách lịch định kỳ đã được duyệt, trạng thái từng lượt chạy và nhật ký kiểm toán workflow.
          </p>
        </div>

        {/* Section 1: Scheduled Workflows */}
        <section style={{ marginBottom: 40 }} aria-labelledby="schedules-heading">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h2 id="schedules-heading" style={{ fontSize: 'var(--planora-text-lg)', fontWeight: 600, margin: 0 }}>
              Lịch chạy tự động đang hoạt động (2)
            </h2>
            <Button variant="secondary" size="sm">
              + Tạo lịch mới
            </Button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {sampleSchedules.map(sched => (
              <div
                key={sched.id}
                className="planora-card"
                style={{
                  backgroundColor: 'var(--planora-paper)',
                  border: '1px solid var(--planora-divider)',
                  borderRadius: 'var(--planora-radius-xl)',
                  padding: '20px 24px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ fontWeight: 600, fontSize: 'var(--planora-text-md)' }}>{sched.title}</div>
                  <StatusBadge status={sched.status} label={sched.statusLabel} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
                  <div>
                    <span style={{ fontSize: 10, color: 'var(--planora-muted)', textTransform: 'uppercase' }}>Chu kỳ:</span>
                    <div style={{ fontSize: 'var(--planora-text-xs)', fontWeight: 500 }}>{sched.cadence}</div>
                  </div>
                  <div>
                    <span style={{ fontSize: 10, color: 'var(--planora-muted)', textTransform: 'uppercase' }}>Nguồn dữ liệu:</span>
                    <div style={{ fontSize: 'var(--planora-text-xs)', fontWeight: 500 }}>{sched.source}</div>
                  </div>
                  <div>
                    <span style={{ fontSize: 10, color: 'var(--planora-muted)', textTransform: 'uppercase' }}>Đích gửi:</span>
                    <div style={{ fontSize: 'var(--planora-text-xs)', fontWeight: 500 }}>{sched.destination}</div>
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingTop: 12,
                    borderTop: '1px solid var(--planora-divider)',
                    fontSize: 'var(--planora-text-xs)',
                    color: 'var(--planora-muted)',
                    flexWrap: 'wrap',
                    gap: 8,
                  }}
                >
                  <div>Lần chạy gần nhất: {sched.lastRun}</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button variant="ghost" size="sm">
                      Chạy ngay
                    </Button>
                    <Button variant="ghost" size="sm">
                      Tạm dừng
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Section 2: Execution Logs Table */}
        <section aria-labelledby="logs-heading">
          <h2 id="logs-heading" style={{ fontSize: 'var(--planora-text-lg)', fontWeight: 600, marginBottom: 16 }}>
            Nhật ký thực thi gần đây
          </h2>

          <div
            className="planora-card"
            style={{
              backgroundColor: 'var(--planora-paper)',
              border: '1px solid var(--planora-divider)',
              borderRadius: 'var(--planora-radius-xl)',
              padding: 0,
              overflow: 'hidden',
            }}
          >
            <div
              className="planora-table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Bảng nhật ký thực thi gần đây"
            >
              <table
                style={{
                  width: '100%',
                  minWidth: 540,
                  borderCollapse: 'collapse',
                  textAlign: 'left',
                  fontSize: 'var(--planora-text-xs)',
                }}
              >
                <thead>
                  <tr style={{ backgroundColor: 'var(--planora-canvas)', borderBottom: '1px solid var(--planora-divider)' }}>
                    <th style={{ padding: '12px 16px', fontWeight: 600 }}>Tên phiên chạy</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600 }}>Thời điểm</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600 }}>Trạng thái</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600 }}>Chi tiết kết quả</th>
                  </tr>
                </thead>
                <tbody>
                  {sampleRuns.map(run => (
                    <tr key={run.id} style={{ borderBottom: '1px solid var(--planora-divider)' }}>
                      <td style={{ padding: '14px 16px', fontWeight: 500, whiteSpace: 'nowrap' }}>{run.name}</td>
                      <td style={{ padding: '14px 16px', color: 'var(--planora-muted)', whiteSpace: 'nowrap' }}>{run.time}</td>
                      <td style={{ padding: '14px 16px' }}>
                        <StatusBadge status={run.status} />
                      </td>
                      <td style={{ padding: '14px 16px', color: 'var(--planora-muted)', minWidth: 200 }}>{run.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
