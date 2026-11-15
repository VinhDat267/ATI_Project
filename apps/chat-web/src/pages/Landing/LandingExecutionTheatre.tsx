import type { ComponentProps } from 'react';
import landingPlaybooks from '../../assets/landing-playbooks.json';
import { ServiceLogo } from '../../components/ServiceLogo';
import { WorkflowFlowCanvas } from '../../components/WorkflowFlowCanvas';

type CanvasProps = ComponentProps<typeof WorkflowFlowCanvas>;

const SAMPLE_SENTENCE =
  'Tạo thẻ Trello cho sự cố thanh toán QR đơn #408, mở issue GitHub theo dõi, ghi vào bảng Google Sheets và báo ngay sang Slack #van-hanh.';

interface Stage1ToolItem {
  id: string;
  name: string;
}

const STAGE1_TOOLS = (landingPlaybooks.stage1Tools as unknown) as Stage1ToolItem[];

const STAGE2_TARGETS = [
  { service: 'Trello', scope: 'Bảng Vận hành · Cột Cần làm' },
  { service: 'GitHub', scope: 'Kho acme/web-store' },
  { service: 'Google Sheets', scope: 'Bảng Theo dõi sự cố · Tab Sự cố' },
  { service: 'Slack', scope: 'Kênh #van-hanh' },
];

const MOMENTS = [
  {
    id: 1,
    shortLabel: 'Giao việc',
    num: '01 · Giao việc',
    title: 'Nói tự nhiên bằng tiếng Việt',
    body: 'Hỏi tra cứu thì trả lời thẳng kèm nguồn; việc cần tạo thẻ, ghi bảng hay gửi tin sẽ lập tức dựng thành kế hoạch chờ duyệt.',
  },
  {
    id: 2,
    shortLabel: 'Khoá vùng',
    num: '02 · Khoá phạm vi',
    title: 'Tìm đúng nơi, hỏi lại nếu trùng tên',
    body: 'Chỉ dò tìm trong bảng, kho lưu trữ, trang tính và kênh đã cấp phép. Nếu gặp hai kênh gần giống nhau, Planora dừng hỏi để chọn chính xác.',
  },
  {
    id: 3,
    shortLabel: 'Xem trước',
    num: '03 · Xem trước',
    title: 'Đọc nguyên văn từng dòng trước khi chạy',
    body: 'Xem trước chính xác từng ô sẽ thêm vào bảng tính và nội dung tin nhắn sẽ gửi trước khi bạn bấm duyệt.',
  },
  {
    id: 4,
    shortLabel: 'Thực thi',
    num: '04 · Thực thi',
    title: 'Nối tiếp kết quả, dừng khi nghẽn mạng',
    body: 'Đường dẫn thẻ Trello và mã issue được truyền tự động sang bước sau. Gặp lỗi mạng chưa rõ kết quả sẽ dừng hỏi chứ không gửi lặp.',
  },
  {
    id: 5,
    shortLabel: 'Biên nhận',
    num: '05 · Biên nhận & lịch',
    title: 'Nhận biên nhận thật hoặc biến thành lịch chạy',
    body: 'Mỗi bước xong đều trả về liên kết kiểm chứng thực tế, đồng thời lưu thành mẫu chạy định kỳ nếu đội ngũ cần lặp lại.',
  },
];

export interface LandingExecutionTheatreProps {
  activeMoment: number;
  onSelectMoment: (moment: number) => void;
  onTryPrompt: (prompt: string, trigger: HTMLElement | null) => void;
  onOpenSignup: (trigger: HTMLElement | null) => void;
}

const stageLabels = landingPlaybooks.stageResourceLabels as Record<string, string>;
const stage3Steps = (landingPlaybooks.stage3Steps as unknown) as CanvasProps['steps'];
const stage4Steps = (landingPlaybooks.stage4Steps as unknown) as CanvasProps['steps'];
const stage4Statuses = (landingPlaybooks.stage4Statuses as unknown) as CanvasProps['stepStatuses'];
const stage5Steps = (landingPlaybooks.stage5Steps as unknown) as CanvasProps['steps'];
const stage5Statuses = (landingPlaybooks.stage5Statuses as unknown) as CanvasProps['stepStatuses'];
const schedulePrompt = landingPlaybooks.stage5SchedulePrompt;

export function LandingExecutionTheatre({
  activeMoment,
  onSelectMoment,
  onTryPrompt,
  onOpenSignup,
}: LandingExecutionTheatreProps) {
  return (
    <section
      id="story-stage"
      data-od-id="story-stage"
      className="pl-theatre-band"
    >
      <div className="pl-wrap">
        <div className="max-w-3xl mb-10 sm:mb-12 space-y-3">
          <span className="pl-kicker">
            <span className="pl-kicker-dot" aria-hidden="true" />
            Hành trình một vòng việc trọn vẹn
          </span>
          <h2 className="pl-h2 text-[var(--pl-ink)]">
            Năm chặng rõ ràng từ câu nói đến biên nhận.{' '}
            <span className="pl-h2-muted">Mọi thay đổi đều chờ bạn gật đầu.</span>
          </h2>
          <p className="pl-lead">
            Mỗi thao tác đều nằm trong tầm mắt bạn: biết trước Planora sẽ chạm vào đâu, ghi câu chữ gì và chỉ thực hiện sau khi bạn xác nhận.
          </p>
        </div>

        <div className="pl-theatre-grid">
          {/* Left Vertical Scrubber Rail (tasteskill.dev .ba-rail grammar) */}
          <div className="pl-chapter-rail">
            {MOMENTS.map((m) => {
              const isActive = activeMoment === m.id;
              return (
                <button
                  key={m.id}
                  id={`trigger-moment-${m.id}`}
                  type="button"
                  data-moment={String(m.id)}
                  onClick={() => onSelectMoment(m.id)}
                  className={`moment-trigger text-left ${isActive ? 'is-active' : ''}`}
                >
                  <span className="pl-moment-num">{m.num}</span>
                  <h3 className="pl-moment-title">{m.title}</h3>
                  <p className="pl-moment-body">{m.body}</p>
                </button>
              );
            })}
            <div className="pl-rail-foot">
              <p className="pl-rail-foot-label">Vòng việc khép kín</p>
              <p className="pl-rail-foot-text">
                Từ một câu tiếng Việt đến biên nhận kiểm chứng từng bước — sẵn sàng lặp lại theo lịch bạn hẹn bên dưới.
              </p>
            </div>
          </div>

          {/* Right Column (stretched grid track so sticky docks smoothly through Moment 5) */}
          <div className="pl-theatre-stage-col">
            <div className="stage-interactive-desktop">
              <div className="pl-stage-topbar">
                <div className="pl-stage-stepbar" role="tablist" aria-label="Chọn chặng hành trình">
                  {MOMENTS.map((m) => {
                    const isSelected = activeMoment === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        role="tab"
                        aria-selected={isSelected}
                        onClick={() => onSelectMoment(m.id)}
                        className={`pl-stage-step-btn ${isSelected ? 'is-active' : ''}`}
                      >
                        <span className="pl-mono">0{m.id}</span>
                        <span>{m.shortLabel}</span>
                      </button>
                    );
                  })}
                </div>
                <span className="pl-stage-counter-pill">
                  Chặng {activeMoment}/5
                </span>
              </div>

              <div className="pl-stage-viewport">
                {/* PANEL 1 */}
                <div
                  id="stage-panel-1"
                  className={`stage-panel ${activeMoment === 1 ? 'is-active' : ''}`}
                  aria-hidden={activeMoment !== 1}
                  inert={activeMoment !== 1}
                >
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-[var(--pl-rule)]">
                      <span className="pl-kicker">Chặng 01 · Tiếp nhận yêu cầu</span>
                      <span className="pl-status-tag">
                        <span className="pl-status-dot pl-status-dot--ok" aria-hidden="true" />
                        Hiểu tiếng Việt tự nhiên
                      </span>
                    </div>

                    <div className="pl-prompt-strip">
                      <p className="pl-prompt-label !mb-1">Người dùng nhắn vào Planora</p>
                      <p className="pl-prompt-text">&ldquo;{SAMPLE_SENTENCE}&rdquo;</p>
                    </div>

                    <div>
                      <p className="text-xs font-medium text-[var(--pl-ink-subtle)] mb-2">
                        Các công cụ nhận diện trong yêu cầu
                      </p>
                      <div className="pl-stage-tool-matrix">
                        {STAGE1_TOOLS.map((tool) => (
                          <div key={tool.id} className="pl-stage-tool-cell">
                            <ServiceLogo service={tool.id} className="w-4 h-4 flex-shrink-0" />
                            <span className="text-xs font-semibold text-[var(--pl-ink)] truncate">
                              {tool.name}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <p className="text-xs text-[var(--pl-ink-muted)] leading-relaxed pt-2.5 border-t border-[var(--pl-rule)] m-0">
                      <strong className="text-[var(--pl-ink)]">Phân loại tự động:</strong> Yêu cầu có 4 hành động tạo và gửi dữ liệu mới, Planora dựng ngay bản kế hoạch để bạn rà trước thay vì tự ý chạy.
                    </p>
                  </div>
                </div>

                {/* PANEL 2 */}
                <div
                  id="stage-panel-2"
                  className={`stage-panel ${activeMoment === 2 ? 'is-active' : ''}`}
                  aria-hidden={activeMoment !== 2}
                  inert={activeMoment !== 2}
                >
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-[var(--pl-rule)]">
                      <span className="pl-kicker">Chặng 02 · Khoanh vùng cho phép</span>
                      <span className="pl-status-tag">
                        <span className="pl-status-dot pl-status-dot--ok" aria-hidden="true" />
                        Chỉ đọc nơi đã mở khoá
                      </span>
                    </div>

                    <div className="pl-stage-ledger">
                      {STAGE2_TARGETS.map((row) => (
                        <div key={row.service} className="pl-stage-ledger-row">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="pl-mono text-xs font-semibold text-[var(--pl-ink-subtle)] w-28 flex-shrink-0">
                              {row.service}
                            </span>
                            <span className="text-xs font-semibold text-[var(--pl-ink)] truncate">
                              {row.scope}
                            </span>
                          </div>
                          <span className="pl-status-tag flex-shrink-0">
                            <span className="pl-status-dot pl-status-dot--ok" aria-hidden="true" />
                            Khớp phạm vi
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="border-l-2 border-[#FF5701] pl-3 py-1 text-xs space-y-1">
                      <p className="font-semibold text-[var(--pl-ink)] m-0">
                        Khi gặp bảng hoặc kênh bị khoá hoặc trùng tên:
                      </p>
                      <p className="text-[var(--pl-ink-muted)] m-0 leading-relaxed">
                        Planora dừng bước và hiển thị các lựa chọn hợp lệ để bạn chọn chính xác nơi muốn ghi, tuyệt đối không đoán mò sang không gian khác.
                      </p>
                    </div>
                  </div>
                </div>

                {/* PANEL 3 */}
                <div
                  id="stage-panel-3"
                  className={`stage-panel ${activeMoment === 3 ? 'is-active' : ''}`}
                  aria-hidden={activeMoment !== 3}
                  inert={activeMoment !== 3}
                >
                  <div className="space-y-3.5">
                    <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-[var(--pl-rule)]">
                      <span className="pl-kicker">Chặng 03 · Chờ duyệt nguyên văn</span>
                      <span className="pl-status-tag">
                        <span className="pl-status-dot pl-status-dot--warn" aria-hidden="true" />
                        Chưa ghi dữ liệu
                      </span>
                    </div>

                    <div data-testid="landing-stage3-orbital-canvas">
                      <WorkflowFlowCanvas
                        steps={stage3Steps}
                        resourceLabels={stageLabels}
                        mode="preview"
                        compact
                        hideInlineInspector
                        className="!p-2.5 sm:!p-3"
                      />
                    </div>

                    <div data-testid="landing-stage3-sheets-grid" className="pl-sheets-grid">
                      <div className="pl-sheets-header">
                        <span>Xem trước dòng thêm vào Google Sheets · Tab Sự cố</span>
                        <span className="pl-mono text-xs text-[var(--pl-ink-subtle)]">Chưa ghi</span>
                      </div>
                      <table className="pl-sheets-table">
                        <thead>
                          <tr>
                            <th>Cột A</th>
                            <th>Cột B</th>
                            <th>Cột C</th>
                            <th>Cột D</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td>15/11/2026</td>
                            <td>Lỗi thanh toán QR đơn #408</td>
                            <td>Cao</td>
                            <td>Link issue từ Bước 2</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    <div className="border-l-2 border-[var(--pl-rule-strong)] pl-3 py-0.5 text-xs space-y-0.5">
                      <p className="font-semibold text-[var(--pl-ink)] m-0">4. Tin Slack gửi kênh #van-hanh:</p>
                      <p className="text-[var(--pl-ink-muted)] m-0">
                        &ldquo;Đã mở thẻ Trello ([tự điền]) và issue GitHub ([tự điền]) cho sự cố thanh toán QR đơn #408.&rdquo;
                      </p>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-[var(--pl-rule)]">
                      <span className="text-xs text-[var(--pl-ink-subtle)]">Mọi thay đổi chỉ chạy sau nút bấm này</span>
                      <button
                        type="button"
                        onClick={() => onSelectMoment(4)}
                        className="pl-btn-primary text-xs py-2 px-4 min-h-[38px]"
                      >
                        Duyệt và chạy (4 bước)
                        <span className="pl-arrow" aria-hidden="true">&rarr;</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* PANEL 4 */}
                <div
                  id="stage-panel-4"
                  className={`stage-panel ${activeMoment === 4 ? 'is-active' : ''}`}
                  aria-hidden={activeMoment !== 4}
                  inert={activeMoment !== 4}
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2 pb-2 border-b border-[var(--pl-rule)]">
                      <span className="pl-kicker">Chặng 04 · Thực thi tuần tự</span>
                      <span className="pl-status-tag">
                        <span className="pl-status-dot pl-status-dot--ok" aria-hidden="true" />
                        Truyền dữ liệu giữa các bước
                      </span>
                    </div>

                    <div data-testid="landing-stage4-orbital-canvas">
                      <WorkflowFlowCanvas
                        steps={stage4Steps}
                        stepStatuses={stage4Statuses}
                        resourceLabels={stageLabels}
                        mode="executing"
                        compact
                        hideInlineInspector
                        className="!p-2.5 sm:!p-3"
                      />
                    </div>

                    <div className="pl-stage-ledger">
                      <div className="pl-stage-ledger-row">
                        <span className="text-xs font-medium text-[var(--pl-ink)]">
                          <span className="pl-mono text-xs text-[var(--pl-ink-subtle)] mr-2">01</span>
                          Tạo thẻ Trello &ldquo;Lỗi thanh toán QR đơn #408&rdquo;
                        </span>
                        <span className="text-xs font-semibold text-[var(--pl-ok)] flex-shrink-0">Xong</span>
                      </div>
                      <div className="pl-stage-ledger-row">
                        <span className="text-xs font-medium text-[var(--pl-ink)]">
                          <span className="pl-mono text-xs text-[var(--pl-ink-subtle)] mr-2">02</span>
                          Mở issue #109 trên acme/web-store
                        </span>
                        <span className="text-xs font-semibold text-[var(--pl-ok)] flex-shrink-0">Xong</span>
                      </div>
                      <div className="pl-stage-ledger-row is-active-row">
                        <span className="text-xs font-semibold text-[var(--pl-ink)]">
                          <span className="pl-mono text-xs text-[var(--pl-label)] mr-2">03</span>
                          Ghi dòng mới vào Bảng Theo dõi sự cố
                        </span>
                        <span className="text-xs font-semibold text-[var(--pl-label)] flex-shrink-0">Đang ghi</span>
                      </div>
                      <div className="pl-stage-ledger-row opacity-70">
                        <span className="text-xs text-[var(--pl-ink-muted)]">
                          <span className="pl-mono text-xs text-[var(--pl-ink-subtle)] mr-2">04</span>
                          Gửi báo cáo Slack sang #van-hanh
                        </span>
                        <span className="text-xs text-[var(--pl-ink-subtle)] flex-shrink-0">Chờ bước 3</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* PANEL 5 */}
                <div
                  id="stage-panel-5"
                  className={`stage-panel ${activeMoment === 5 ? 'is-active' : ''}`}
                  aria-hidden={activeMoment !== 5}
                  inert={activeMoment !== 5}
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2 pb-2 border-b border-[var(--pl-rule)]">
                      <span className="pl-kicker">Chặng 05 · Biên nhận &amp; Lặp lại</span>
                      <span className="pl-status-tag">
                        <span className="pl-status-dot pl-status-dot--ok" aria-hidden="true" />
                        Hoàn tất 4 / 4 bước
                      </span>
                    </div>

                    <div data-testid="landing-stage5-orbital-canvas">
                      <WorkflowFlowCanvas
                        steps={stage5Steps}
                        stepStatuses={stage5Statuses}
                        resourceLabels={stageLabels}
                        mode="receipt"
                        compact
                        hideInlineInspector
                        className="!p-2.5 sm:!p-3"
                      />
                    </div>

                    <div className="pl-stage-receipt-matrix">
                      <div className="pl-stage-receipt-cell">
                        <p className="text-xs font-semibold text-[var(--pl-ink)] m-0">Thẻ Trello #408</p>
                        <p className="text-xs text-[var(--pl-ink-muted)] m-0">Bảng Vận hành · Cần làm</p>
                      </div>
                      <div className="pl-stage-receipt-cell">
                        <p className="text-xs font-semibold text-[var(--pl-ink)] m-0">Issue GitHub #109</p>
                        <p className="text-xs text-[var(--pl-ink-muted)] m-0">Đã gắn link thẻ Trello</p>
                      </div>
                      <div className="pl-stage-receipt-cell">
                        <p className="text-xs font-semibold text-[var(--pl-ink)] m-0">Dòng 42 Google Sheets</p>
                        <p className="text-xs text-[var(--pl-ink-muted)] m-0">Tab Sự cố · 15/11/2026</p>
                      </div>
                      <div className="pl-stage-receipt-cell">
                        <p className="text-xs font-semibold text-[var(--pl-ink)] m-0">Tin Slack #van-hanh</p>
                        <p className="text-xs text-[var(--pl-ink-muted)] m-0">Kèm đủ đường dẫn đối chiếu</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[var(--pl-rule)]">
                      <button
                        type="button"
                        data-testid="landing-stage5-schedule-cta"
                        onClick={(e) => onTryPrompt(schedulePrompt, e.currentTarget)}
                        className="pl-btn-primary text-xs py-2 px-4 min-h-[38px]"
                      >
                        Đặt lịch chạy định kỳ quy trình này
                      </button>

                      <button
                        type="button"
                        onClick={(e) => onOpenSignup(e.currentTarget)}
                        className="pl-draw-link border-0 bg-transparent cursor-pointer"
                      >
                        Thử với yêu cầu của bạn <span className="pl-arrow" aria-hidden="true">&rarr;</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Mobile & Reduced Motion Static 5 Cards (MUST keep exact 5 direct <div> children, never sticky) */}
            <div className="stage-fallback-list">
              <div className="pl-fallback-card space-y-2">
                <span className="pl-kicker">Chặng 01 · Giao việc</span>
                <h4 className="font-semibold text-base text-[var(--pl-ink)]">Nói tự nhiên bằng tiếng Việt</h4>
                <p className="text-sm text-[var(--pl-ink-muted)]">&ldquo;{SAMPLE_SENTENCE}&rdquo;</p>
              </div>

              <div className="pl-fallback-card space-y-2">
                <span className="pl-kicker">Chặng 02 · Khoá phạm vi</span>
                <h4 className="font-semibold text-base text-[var(--pl-ink)]">Chỉ đọc đúng nơi đã chọn</h4>
                <div className="space-y-1.5 text-xs text-[var(--pl-ink-muted)]">
                  {STAGE2_TARGETS.map((item) => (
                    <div key={item.service} className="flex items-center justify-between gap-2">
                      <span>{item.service}: {item.scope}</span>
                      <span className="pl-status-tag">Khớp</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pl-fallback-card space-y-2.5">
                <span className="pl-kicker">Chặng 03 · Xem trước nguyên văn</span>
                <h4 className="font-semibold text-base text-[var(--pl-ink)]">Đọc kỹ từng ô bảng tính &amp; tin nhắn</h4>
                <div className="pl-sheets-grid text-xs">
                  <div className="p-2 grid grid-cols-2 gap-1 text-[var(--pl-ink-muted)]">
                    <span><strong>Cột A:</strong> 15/11/2026</span>
                    <span><strong>Cột B:</strong> Lỗi thanh toán QR đơn #408</span>
                    <span><strong>Cột C:</strong> Cao</span>
                    <span><strong>Cột D:</strong> Link issue từ Bước 2</span>
                  </div>
                </div>
              </div>

              <div className="pl-fallback-card space-y-2">
                <span className="pl-kicker">Chặng 04 · Thực thi</span>
                <h4 className="font-semibold text-base text-[var(--pl-ink)]">Chạy tuần tự &amp; dừng an toàn</h4>
                <p className="text-xs text-[var(--pl-ink-muted)]">
                  Thẻ Trello xong &rarr; Issue #109 xong &rarr; Tự điền liên kết sang Google Sheets &amp; Slack.
                </p>
              </div>

              <div className="pl-fallback-card space-y-3">
                <span className="pl-kicker">Chặng 05 · Biên nhận &amp; lịch</span>
                <h4 className="font-semibold text-base text-[var(--pl-ink)]">Biên nhận thật cho từng bước</h4>
                <p className="text-xs text-[var(--pl-ink-muted)]">
                  Kiểm tra đủ thẻ, issue, dòng bảng và tin Slack ngay sau khi chạy xong.
                </p>
                <button
                  type="button"
                  data-testid="landing-mobile-stage5-schedule-cta"
                  onClick={(e) => onTryPrompt(schedulePrompt, e.currentTarget)}
                  className="pl-btn-primary text-xs py-2 px-4 min-h-[38px]"
                >
                  Đặt lịch chạy định kỳ quy trình này
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
