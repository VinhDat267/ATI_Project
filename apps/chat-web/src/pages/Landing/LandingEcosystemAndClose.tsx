import landingPlaybooks from '../../assets/landing-playbooks.json';
import { PlanoraMark } from '../../components/PlanoraMark';
import { ServiceLogo } from '../../components/ServiceLogo';

interface CoreIntegrationItem {
  id: string;
  name: string;
  role: string;
  scopeUnit: string;
}

const CORE_INTEGRATIONS = (landingPlaybooks.coreIntegrations as unknown) as CoreIntegrationItem[];

export interface LandingEcosystemAndCloseProps {
  gmailEnabled: boolean;
  mysheetsEnabled: boolean;
  signupEnabled: boolean;
  googleEnabled: boolean;
  onOpenSignup: (trigger: HTMLElement | null) => void;
  onOpenLogin: (trigger: HTMLElement | null) => void;
  onOpenGoogle: (trigger: HTMLElement | null) => void;
  onNavigate: (path: string) => void;
}

export function LandingEcosystemAndClose({
  gmailEnabled,
  mysheetsEnabled,
  signupEnabled,
  googleEnabled,
  onOpenSignup,
  onOpenLogin,
  onOpenGoogle,
  onNavigate,
}: LandingEcosystemAndCloseProps) {
  return (
    <>
      {/* Screen 6: Architectural Hairline Matrix of Connected Tools */}
      <section
        id="integrations"
        data-od-id="integrations-section"
        className="pl-matrix-band"
      >
        <div className="pl-wrap">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
            <div className="max-w-2xl space-y-3">
              <span className="pl-kicker">
                <span className="pl-kicker-dot" aria-hidden="true" />
                Kết nối chính thức một chạm · Khoanh vùng quyền riêng theo từng công cụ
              </span>
              <h2 className="pl-h2 text-[var(--pl-ink)]">
                Tám công cụ quen thuộc.{' '}
                <span className="pl-h2-muted">Phối hợp nhịp nhàng trong một câu nói.</span>
              </h2>
              <p className="pl-lead">
                Cấp quyền chính thức theo từng bảng, kênh hoặc bảng tính bạn chọn. Không lưu mật khẩu riêng của công cụ thứ ba và có thể ngắt kết nối bất kỳ lúc nào.
              </p>
            </div>
          </div>

          <div className="pl-matrix-grid">
            {CORE_INTEGRATIONS.map((tool) => (
              <div key={tool.id} className="pl-matrix-cell">
                <div className="flex items-center justify-between gap-2">
                  <ServiceLogo service={tool.id} className="w-7 h-7" />
                  <span data-testid="integration-oauth-badge" className="pl-matrix-scope">
                    {tool.scopeUnit}
                  </span>
                </div>
                <div className="pt-1">
                  <h3 className="text-base font-semibold text-[var(--pl-ink)] m-0">{tool.name}</h3>
                  <p className="text-xs sm:text-[13px] text-[var(--pl-ink-muted)] mt-0.5 mb-0">{tool.role}</p>
                </div>
              </div>
            ))}
          </div>

          {(gmailEnabled || mysheetsEnabled) && (
            <div className="pl-capability-split">
              {gmailEnabled && (
                <div className="pl-capability-card space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <ServiceLogo service="gmail" className="w-6 h-6" />
                      <h3 className="text-base font-semibold text-[var(--pl-ink)] m-0">
                        Gmail · Của riêng bạn
                      </h3>
                    </div>
                    <span className="pl-status-tag">
                      <span className="pl-status-dot pl-status-dot--ok" aria-hidden="true" />
                      Đã bật trong phiên bản này
                    </span>
                  </div>
                  <p className="text-sm text-[var(--pl-ink-muted)] leading-relaxed m-0">
                    Đọc tóm tắt hộp thư hoặc soạn thư trả lời chờ bạn duyệt nguyên văn trước khi gửi đi, tách riêng hoàn toàn khỏi dữ liệu dùng chung.
                  </p>
                </div>
              )}

              {mysheetsEnabled && (
                <div className="pl-capability-card space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <ServiceLogo service="mysheets" className="w-6 h-6" />
                      <h3 className="text-base font-semibold text-[var(--pl-ink)] m-0">
                        Google Sheets · Của riêng bạn
                      </h3>
                    </div>
                    <span className="pl-status-tag">
                      <span className="pl-status-dot pl-status-dot--ok" aria-hidden="true" />
                      Đã bật trong phiên bản này
                    </span>
                  </div>
                  <p className="text-sm text-[var(--pl-ink-muted)] leading-relaxed m-0">
                    Thêm dòng, cập nhật trạng thái hoặc rút trích báo cáo theo đúng cột của bảng tính bạn đã chọn mà không chạm tới file khác.
                  </p>
                  <a
                    href="/guide?service=mysheets"
                    onClick={(e) => {
                      e.preventDefault();
                      onNavigate('/guide?service=mysheets');
                    }}
                    className="pl-draw-link"
                  >
                    Cách kết nối và mẫu câu Google Sheets <span className="pl-arrow" aria-hidden="true">&rarr;</span>
                  </a>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Screen 7: 3-Step Onboarding Specification */}
      <section
        id="onboarding"
        data-od-id="onboarding-section"
        className="pl-onboarding-band"
      >
        <div className="pl-wrap">
          <div className="max-w-2xl space-y-3">
            <span className="pl-kicker">
              <span className="pl-kicker-dot" aria-hidden="true" />
              Bắt đầu trong 3 phút
            </span>
            <h2 className="pl-h2 text-[var(--pl-ink)]">
              Ba bước thiết lập gọn nhẹ.{' '}
              <span className="pl-h2-muted">Không cần viết mã hay dựng sơ đồ rối mắt.</span>
            </h2>
          </div>

          <div className="pl-steps-row">
            <div data-od-id="step-1" className="pl-step-col space-y-3">
              <span className="pl-mono text-xs font-semibold text-[var(--pl-label)]">Bước 01</span>
              <h3 className="text-lg font-semibold text-[var(--pl-ink)]">
                Đăng ký tài khoản &amp; xác minh địa chỉ email
              </h3>
              <p className="text-sm sm:text-[15px] text-[var(--pl-ink-muted)] leading-relaxed m-0">
                Tạo tài khoản bằng email công việc hoặc Google để mở không gian điều phối riêng cho cá nhân hoặc nhóm của bạn.
              </p>
            </div>

            <div data-od-id="step-2" className="pl-step-col space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="pl-mono text-xs font-semibold text-[var(--pl-label)]">Bước 02</span>
                <span data-testid="onboarding-step2-approval-badge" className="pl-status-tag">
                  <span className="pl-status-dot pl-status-dot--ok" aria-hidden="true" />
                  Kiểm soát thành viên bởi quản trị viên nhóm
                </span>
              </div>
              <h3 className="text-lg font-semibold text-[var(--pl-ink)]">
                Quản trị viên nhóm phê duyệt thành viên
              </h3>
              <p className="text-sm sm:text-[15px] text-[var(--pl-ink-muted)] leading-relaxed m-0">
                Tài khoản mới được xác thực theo đúng danh sách nhóm, đảm bảo chỉ thành viên nội bộ mới truy cập được không gian dùng chung.
              </p>
            </div>

            <div data-od-id="step-3" className="pl-step-col space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="pl-mono text-xs font-semibold text-[var(--pl-label)]">Bước 03</span>
                <span data-testid="onboarding-step3-scope-badge" className="pl-status-tag">
                  <span className="pl-status-dot pl-status-dot--ok" aria-hidden="true" />
                  Kết nối một chạm · Chọn bảng &amp; kênh trực tiếp từ danh sách
                </span>
              </div>
              <h3 className="text-lg font-semibold text-[var(--pl-ink)]">
                Kết nối công cụ &amp; khóa phạm vi bảng/kênh
              </h3>
              <p className="text-sm sm:text-[15px] text-[var(--pl-ink-muted)] leading-relaxed m-0">
                Gắn kết Trello, Slack, GitHub, Google Sheets hoặc công cụ quen thuộc chỉ bằng vài lần bấm, chọn đúng bảng và kênh được phép hoạt động.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* TasteSkill Warm Sunset-Glow Deep Espresso Footer */}
      <footer data-od-id="footer" className="pl-closing">
        <div className="pl-wrap">
          <div className="pl-closing-cta">
            <div className="lg:col-span-7 space-y-3">
              <span className="pl-kicker !text-[#FF8B4D]">
                <span className="pl-kicker-dot" aria-hidden="true" />
                Sẵn sàng cho đội ngũ của bạn
              </span>
              <h2 className="pl-h2 text-[#FFF6EF]">
                Giao việc bằng một câu nói.{' '}
                <span className="text-[#C8BCB2] font-medium">Duyệt rõ từng bước trước khi chạy.</span>
              </h2>
              <p className="text-sm sm:text-base text-[#E2D9D0] max-w-xl leading-relaxed m-0">
                Mở không gian làm việc riêng trong vài phút, không cần biết cấu hình kỹ thuật.
              </p>
            </div>

            <div className="lg:col-span-5 flex flex-wrap lg:justify-end gap-3">
              <a
                href={signupEnabled ? '/signup' : '/login'}
                data-od-id="btn-footer-cta-signup"
                onClick={(e) => {
                  e.preventDefault();
                  onOpenSignup(e.currentTarget);
                }}
                className="pl-btn-light pl-btn-lg pl-btn-glow"
              >
                {signupEnabled ? 'Tạo không gian miễn phí' : 'Đăng nhập không gian làm việc'}
                <span className="pl-arrow" aria-hidden="true">&rarr;</span>
              </a>

              {googleEnabled && (
                <a
                  href="/auth/google/start"
                  data-od-id="btn-footer-cta-google"
                  onClick={(e) => {
                    e.preventDefault();
                    onOpenGoogle(e.currentTarget);
                  }}
                  className="pl-btn-ghost-dark pl-btn-lg"
                >
                  Tiếp tục bằng Google
                </a>
              )}
            </div>
          </div>

          <div className="pl-footer-grid">
            <div className="lg:col-span-5 space-y-4">
              <a href="#workflow-showcase" className="inline-flex items-center gap-2.5 no-underline">
                <span className="pl-brand-mark pl-brand-mark--lg" aria-hidden="true">
                  <PlanoraMark tone="inverse" className="w-full h-full" />
                </span>
                <span className="pl-footer-wordmark">PLANORA</span>
              </a>
              <p className="text-sm text-[#B8ABA0] max-w-sm leading-relaxed m-0">
                Nền tảng điều phối công việc đa công cụ bằng tiếng Việt, chỉ chạm vào tài nguyên bạn mở khoá và luôn hỏi duyệt nguyên văn trước khi ghi dữ liệu.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <span className="pl-footer-chip">Khoanh vùng riêng</span>
                <span className="pl-footer-chip">Duyệt nguyên văn</span>
                <span className="pl-footer-chip">Biên nhận thật</span>
              </div>
            </div>

            <div className="lg:col-span-2 pl-footer-col">
              <p className="pl-footer-col-title">Sản phẩm</p>
              <a href="#workflow-showcase" className="pl-footer-link">Kịch bản mẫu</a>
              <a href="#product-film" className="pl-footer-link">Video thực tế</a>
              <a href="#story-stage" className="pl-footer-link">Hành trình 5 chặng</a>
              <a href="#schedule-automation" className="pl-footer-link">Lịch định kỳ</a>
            </div>

            <div className="lg:col-span-2 pl-footer-col">
              <p className="pl-footer-col-title">Kiểm soát</p>
              <a href="#principles" className="pl-footer-link">Nguyên tắc an toàn</a>
              <a href="#integrations" className="pl-footer-link">Công cụ kết nối</a>
              <a href="#onboarding" className="pl-footer-link">3 bước bắt đầu</a>
            </div>

            <div className="lg:col-span-3 pl-footer-col">
              <p className="pl-footer-col-title">Tài nguyên</p>
              <a
                href="/guide"
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate('/guide');
                }}
                className="pl-footer-link"
              >
                Hướng dẫn sử dụng
              </a>
              <a
                href="/privacy"
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate('/privacy');
                }}
                className="pl-footer-link"
              >
                Chính sách bảo mật
              </a>
              <a
                href="/login"
                onClick={(e) => {
                  e.preventDefault();
                  onOpenLogin(e.currentTarget);
                }}
                className="pl-footer-link"
              >
                Đăng nhập không gian
              </a>
            </div>
          </div>

          <div className="pl-footer-meta">
            <span>&copy; 2026 Planora &middot; Điều phối công việc đa công cụ bằng tiếng Việt</span>
            <span>Không lưu mật khẩu dịch vụ thứ ba &middot; Ngắt kết nối bất kỳ lúc nào</span>
          </div>
        </div>
      </footer>
    </>
  );
}
