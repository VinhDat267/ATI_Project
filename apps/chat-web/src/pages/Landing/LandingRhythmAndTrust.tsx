import type { ComponentProps } from 'react';
import { useState } from 'react';
import landingPlaybooks from '../../assets/landing-playbooks.json';
import { WorkflowFlowCanvas } from '../../components/WorkflowFlowCanvas';

type CanvasProps = ComponentProps<typeof WorkflowFlowCanvas>;

interface DigestPreset {
  id: string;
  tabLabel: string;
  scheduleText: string;
  services: string[];
  sourceLabel: string;
  destinationLabel: string;
  prompt: string;
  previewTitle: string;
  previewBullets: string[];
  resourceLabels?: Record<string, string>;
}

const DIGEST_PRESETS = (landingPlaybooks.digestPresets as unknown) as DigestPreset[];

const PROTECTION_LAYERS = [
  {
    tag: 'Lớp 1: Khóa phạm vi tài nguyên',
    title: 'Chỉ chạm đúng bảng, kênh, trang tính bạn mở khoá',
    detail: 'Mọi tài nguyên ngoài danh sách cho phép đều ẩn hoàn toàn, không đọc lén và không tự động mở rộng.',
  },
  {
    tag: 'Lớp 2: Xem trước nguyên văn & lưới dữ liệu',
    title: 'Luôn dừng hỏi bạn trước khi tạo, sửa hay gửi tin',
    detail: 'Mọi thay đổi đều hiện rõ tên bảng, từng cột chữ và nội dung tin nhắn để bạn rà soát và duyệt từng lượt.',
  },
  {
    tag: 'Lớp 3: Biên nhận đối chiếu & Khôi phục an toàn',
    title: 'Gặp sự cố mạng sẽ dừng hỏi, không tự ý chạy lặp',
    detail: 'Giữ trọn thứ tự các bước, tránh tạo hai thẻ giống nhau hoặc gửi trùng thông báo đến đội ngũ khi kết nối chập chờn.',
  },
];

export interface LandingRhythmAndTrustProps {
  onTryPrompt: (prompt: string, trigger: HTMLElement | null) => void;
}

export function LandingRhythmAndTrust({ onTryPrompt }: LandingRhythmAndTrustProps) {
  const [digestIdx, setDigestIdx] = useState(0);
  const current = DIGEST_PRESETS[digestIdx] ?? DIGEST_PRESETS[0];

  return (
    <>
      {/* Screen 4: Rhythm & Scheduled Automation */}
      <section
        id="schedule-automation"
        data-od-id="schedule-section"
        data-testid="landing-schedule-digest-section"
        className="pl-rhythm-band"
      >
        <div className="pl-wrap">
          <div className="max-w-3xl space-y-3">
            <span className="pl-kicker">
              <span className="pl-kicker-dot" aria-hidden="true" />
              Nhịp vận hành định kỳ
            </span>
            <h2 className="pl-h2 text-[var(--pl-ink)]">
              Chạy theo giờ bạn hẹn.{' '}
              <span className="pl-h2-muted">Vẫn kiểm soát rõ từng đầu ra.</span>
            </h2>
            <p className="pl-lead">
              Đặt lịch một lần bằng tiếng Việt để Planora tổng hợp báo cáo mỗi sáng hoặc kiểm tra đầu việc cuối tuần, thay vì ngày nào cũng thao tác lại từ đầu.
            </p>
          </div>

          <div className="pl-mode-ledger">
            <div className="pl-mode-cell space-y-2">
              <span className="pl-kicker">01 · Chờ duyệt từng lượt</span>
              <h3 className="text-lg font-semibold text-[var(--pl-ink)]">
                Lập kế hoạch trước, chỉ chạy khi bạn bấm duyệt
              </h3>
              <p className="text-sm sm:text-[15px] text-[var(--pl-ink-muted)] leading-relaxed">
                Phù hợp cho tác vụ phát sinh mỗi ngày: mở thẻ công việc, cập nhật bảng theo dõi hoặc gửi thông báo đa kênh. Bạn kiểm tra nội dung cụ thể trước khi phát hành.
              </p>
            </div>
            <div className="pl-mode-cell space-y-2">
              <span className="pl-kicker">02 · Tự gửi bản tin tổng hợp mỗi sáng</span>
              <h3 className="text-lg font-semibold text-[var(--pl-ink)]">
                Tự động gom dữ liệu sạch gửi vào một điểm hẹn
              </h3>
              <p className="text-sm sm:text-[15px] text-[var(--pl-ink-muted)] leading-relaxed">
                Chỉ đọc trong những nguồn đã cấp phép (lịch họp, bảng số liệu, danh sách việc) và trả về bản tóm tắt ngắn gọn đúng khung giờ bạn chọn.
              </p>
            </div>
          </div>

          <div className="pl-digest-board">
            <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[var(--pl-rule-strong)]">
              <div className="flex flex-wrap gap-2" role="tablist" aria-label="Mẫu tổng hợp định kỳ">
                {DIGEST_PRESETS.map((preset, idx) => {
                  const selected = idx === digestIdx;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      data-testid={`landing-digest-tab-${idx}`}
                      onClick={() => setDigestIdx(idx)}
                      className={`pl-tab-pill ${selected ? 'is-selected' : ''}`}
                    >
                      {preset.tabLabel}
                    </button>
                  );
                })}
              </div>

              <span className="pl-mono text-xs text-[var(--pl-ink-muted)]">
                {current.scheduleText}
              </span>
            </div>

            <div className="pl-digest-split">
              <div className="space-y-4">
                <div className="rounded-2xl border border-[var(--pl-rule-strong)] bg-[var(--pl-ground-elevated)] p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--pl-ink-subtle)] mb-2">
                    <span>Nguồn đọc: <strong className="text-[var(--pl-ink)]">{current.sourceLabel}</strong></span>
                    <span>Điểm nhận: <strong className="text-[var(--pl-ink)]">{current.destinationLabel}</strong></span>
                  </div>
                  <WorkflowFlowCanvas
                    services={current.services as CanvasProps['services']}
                    resourceLabels={current.resourceLabels}
                    mode="schedule"
                    isAutoDigest
                    compact
                    hideInlineInspector
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs sm:text-[13px] text-[var(--pl-ink-muted)] max-w-lg m-0">
                    Câu hẹn mẫu: &ldquo;{current.prompt}&rdquo;
                  </p>
                  <button
                    type="button"
                    data-testid="landing-try-digest-btn"
                    onClick={(e) => onTryPrompt(current.prompt, e.currentTarget)}
                    className="pl-btn-primary text-sm py-2 px-4 min-h-[40px]"
                  >
                    Đặt lịch mẫu này
                    <span className="pl-arrow" aria-hidden="true">&rarr;</span>
                  </button>
                </div>
              </div>

              <div className="pl-digest-dispatch space-y-3">
                <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-[var(--pl-rule)]">
                  <span className="pl-kicker">Bản tin nhận được</span>
                  <span className="pl-status-tag">
                    <span className="pl-status-dot pl-status-dot--ok" aria-hidden="true" />
                    Gửi đúng giờ hẹn
                  </span>
                </div>
                <h4 className="font-semibold text-base text-[var(--pl-ink)]">
                  {current.previewTitle}
                </h4>
                <ul className="space-y-2 text-sm text-[var(--pl-ink-muted)] list-none p-0 m-0">
                  {current.previewBullets.map((line) => (
                    <li key={line} className="flex items-start gap-2">
                      <span className="text-[#FF5701] font-bold flex-shrink-0">&bull;</span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Screen 5: Architectural Trust & Scope Lock (solid #0D1326 required for FE-04 contrast verification) */}
      <section
        id="principles"
        data-od-id="principles-section"
        className="pl-trust-band"
      >
        <div className="pl-wrap">
          <div className="max-w-3xl space-y-3">
            <span className="pl-kicker">
              <span className="pl-kicker-dot" aria-hidden="true" />
              Nguyên tắc kiểm soát
            </span>
            <h2 className="pl-h2 text-[#F8FAFC]">
              Bạn luôn là người quyết định
            </h2>
            <p className="pl-trust-lead">
              Sản phẩm được thiết kế với sự cẩn trọng tối đa để bạn hoàn toàn an tâm khi giao việc.
            </p>
          </div>

          <div
            data-testid="landing-scope-lock-proof"
            className="pl-blueprint-frame"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="pl-mono text-xs font-semibold text-[#FF8B4D] m-0">
                  Cấu trúc ba lớp bảo vệ trên từng phiên làm việc
                </p>
                <p className="text-sm text-[#E2E8F0] mt-1 mb-0">
                  Từ lúc bạn mở quyền cho từng bảng làm việc đến khi nhận biên nhận sau cùng, không có thao tác ngầm.
                </p>
              </div>
              <span className="pl-status-tag-dark">
                <span className="pl-status-dot pl-status-dot--ok" aria-hidden="true" />
                Kiểm soát hai chiều
              </span>
            </div>

            <div className="pl-blueprint-grid">
              {PROTECTION_LAYERS.map((layer) => (
                <div key={layer.tag} className="pl-blueprint-layer space-y-2">
                  <span className="pl-mono text-xs font-semibold text-[#FF8B4D] block">
                    {layer.tag}
                  </span>
                  <h3 className="text-base font-semibold text-[#F8FAFC]">
                    {layer.title}
                  </h3>
                  <p className="text-sm text-[#CBD5E1] leading-relaxed m-0">
                    {layer.detail}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="pl-pillars-row">
            <div className="pl-pillar-item space-y-2">
              <span className="pl-mono text-xs text-[#FF8B4D]">01 · Quyền duyệt</span>
              <h3 className="text-lg font-semibold text-[#F8FAFC]">
                Không ghi gì khi chưa được duyệt
              </h3>
              <p className="text-sm text-[#CBD5E1] leading-relaxed m-0">
                Tạo thẻ mới, thêm dòng bảng tính hay gửi thông báo nhóm luôn đứng chờ nút xác nhận của chính bạn.
              </p>
            </div>

            <div className="pl-pillar-item space-y-2">
              <span className="pl-mono text-xs text-[#FF8B4D]">02 · Ranh giới rõ</span>
              <h3 className="text-lg font-semibold text-[#F8FAFC]">
                Thu hồi hoặc thu hẹp quyền bất kỳ lúc nào
              </h3>
              <p className="text-sm text-[#CBD5E1] leading-relaxed m-0">
                Bạn chọn cụ thể từng bảng, từng kênh được phép thao tác trong phần Cài đặt, thay đổi áp dụng ngay lập tức.
              </p>
            </div>

            <div className="pl-pillar-item space-y-2">
              <span className="pl-mono text-xs text-[#FF8B4D]">03 · Đối chiếu thật</span>
              <h3 className="text-lg font-semibold text-[#F8FAFC]">
                Biên nhận gắn trực tiếp từng liên kết đầu ra
              </h3>
              <p className="text-sm text-[#CBD5E1] leading-relaxed m-0">
                Mỗi bước hoàn tất đều trả lại đường dẫn mở thẳng sang công cụ đích để kiểm chứng nhanh bằng một lần bấm.
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
