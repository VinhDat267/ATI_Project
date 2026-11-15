import type { FormEvent, MouseEvent as ReactMouseEvent, ReactNode, RefObject } from 'react';
import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, Loader2, LockKeyhole, ShieldCheck, X } from 'lucide-react';
import landingPlaybooks from '../../assets/landing-playbooks.json';
import { ServiceLogo } from '../../components/ServiceLogo';
import { evaluatePasswordGuidance } from '../../utils/password-guidance';

export type AuthModalMode = 'login' | 'signup';
export type AuthModalView = 'form' | 'google' | 'forgot' | 'success';

export interface AuthModalSuccessState {
  title: string;
  desc: ReactNode;
  isLogin: boolean;
}

export interface LandingAuthModalProps {
  open: boolean;
  mode: AuthModalMode;
  view: AuthModalView;
  modalRef: RefObject<HTMLDivElement | null>;
  cardRef: RefObject<HTMLDivElement | null>;
  loginEmailRef: RefObject<HTMLInputElement | null>;
  signupNameRef: RefObject<HTMLInputElement | null>;
  signupEmailRef: RefObject<HTMLInputElement | null>;
  forgotEmailRef: RefObject<HTMLInputElement | null>;
  successCloseRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onChangeMode: (mode: AuthModalMode) => void;
  onShowForgot: () => void;
  onTriggerGoogle: () => void;
  onNavigate: (path: string) => void;
  signupEnabled: boolean;
  googleEnabled: boolean;
  busy: boolean;
  isLoggingIn: boolean;
  error: string | null;
  authError?: string | null;
  loginEmail: string;
  setLoginEmail: (val: string) => void;
  loginPassword: string;
  setLoginPassword: (val: string) => void;
  onLoginSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onSignupSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onForgotSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  forgotSent: boolean;
  success: AuthModalSuccessState | null;
}

interface ShowcaseServiceItem {
  id: string;
  name: string;
}

const SHOWCASE_SERVICES = (landingPlaybooks.coreIntegrations as unknown) as ShowcaseServiceItem[];

const FOCUSABLE =
  'button:not([disabled]), [href]:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

const LOGIN_PILLARS = [
  {
    title: 'Khóa phạm vi tài nguyên',
    desc: 'Chỉ chạm đúng bảng, kho mã và kênh bạn đã chọn.',
  },
  {
    title: 'Xem trước nguyên văn kế hoạch',
    desc: 'Kiểm tra từng bước ghi trước khi bạn bấm xác nhận.',
  },
  {
    title: 'Biên nhận đối chiếu tức thì',
    desc: 'Lưu vết kết quả thực thi theo từng công cụ.',
  },
] as const;

const SIGNUP_STEPS = [
  {
    step: '01',
    title: 'Xác minh email',
    desc: 'Mở liên kết xác nhận trong hộp thư để bảo vệ địa chỉ đăng ký.',
  },
  {
    step: '02',
    title: 'Quản trị viên duyệt',
    desc: 'Yêu cầu được xem xét để cấp đúng quyền vào không gian làm việc.',
  },
  {
    step: '03',
    title: 'Kết nối công cụ',
    desc: 'Đăng nhập và cấp quyền kết nối an toàn cho các dịch vụ nhóm đang dùng.',
  },
] as const;

const FORGOT_GUARANTEES = [
  {
    title: 'Liên kết hiệu lực trong 30 phút',
    desc: 'Mỗi yêu cầu phát hành một mã dùng một lần và tự hủy sau khi đổi.',
  },
  {
    title: 'Thu hồi phiên cũ tự động',
    desc: 'Khi mật khẩu mới được lưu, các phiên làm việc cũ trên mọi thiết bị đều dừng lại.',
  },
  {
    title: 'Giữ nguyên cấu hình kết nối',
    desc: 'Các ủy quyền ứng dụng và lịch sử điều phối của bạn không bị thay đổi.',
  },
] as const;

function PlanoraBrandMark() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="pl-brand-mark">P</div>
      <span className="auth-display font-semibold text-xl tracking-tight text-[var(--pl-ink)]">
        Planora
      </span>
    </div>
  );
}

/** Asymmetric two-column authentication dialog harmonized with TasteSkill landing tokens. */
export function LandingAuthModal({
  open,
  mode,
  view,
  modalRef,
  cardRef,
  loginEmailRef,
  signupNameRef,
  signupEmailRef,
  forgotEmailRef,
  successCloseRef,
  onClose,
  onChangeMode,
  onShowForgot,
  onTriggerGoogle,
  onNavigate,
  signupEnabled,
  googleEnabled,
  busy,
  isLoggingIn,
  error,
  authError,
  loginEmail,
  setLoginEmail,
  loginPassword,
  setLoginPassword,
  onLoginSubmit,
  onSignupSubmit,
  onForgotSubmit,
  forgotSent,
  success,
}: LandingAuthModalProps) {
  const [showLoginPw, setShowLoginPw] = useState(false);
  const [showSignupPw, setShowSignupPw] = useState(false);
  const [signupPassword, setSignupPassword] = useState('');
  const [signupPwdBlurred, setSignupPwdBlurred] = useState(false);

  const isLoginView = mode !== 'signup';
  const inSignupForm = open && view === 'form' && !isLoginView;

  useEffect(() => {
    if (!inSignupForm) {
      setSignupPassword('');
      setSignupPwdBlurred(false);
      setShowSignupPw(false);
    }
  }, [inSignupForm]);

  useEffect(() => {
    if (!open) {
      setShowLoginPw(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const visible = [...(cardRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(
        (el) => el.offsetParent !== null,
      );
      const first = visible[0];
      const last = visible[visible.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        last?.focus();
        event.preventDefault();
      } else if (!event.shiftKey && document.activeElement === last) {
        first?.focus();
        event.preventDefault();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, cardRef]);

  if (!open) return null;

  const isSplitView = view === 'form' || view === 'forgot';
  const showEmailFormBelowGoogle = isLoginView || signupEnabled;
  const showGoogleDivider = googleEnabled && showEmailFormBelowGoogle;
  const passwordGuidance = evaluatePasswordGuidance(signupPassword, signupPwdBlurred);
  const passwordTooShort = passwordGuidance.tone === 'danger';
  const activeError = error || authError;

  const handleBackdropClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target === modalRef.current) onClose();
  };

  const labelledBy =
    view === 'forgot'
      ? 'auth-forgot-title'
      : view === 'success'
        ? 'success-title'
        : view === 'google'
          ? 'auth-google-title'
          : 'auth-modal-title';

  return (
    <div
      ref={modalRef}
      id="auth-modal"
      data-od-id="auth-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onClick={handleBackdropClick}
      className="pl-modal auth-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 opacity-100 pointer-events-auto transition-opacity duration-200"
    >
      <div
        ref={cardRef}
        id="auth-modal-card"
        data-od-id="auth-modal-card"
        className={`auth-modal-shell w-full ${isSplitView ? 'max-w-[460px] lg:max-w-[900px] lg:grid lg:grid-cols-12' : 'max-w-[460px]'} rounded-3xl relative overflow-hidden transition-all duration-200 scale-100 max-h-[92vh] overflow-y-auto`}
      >
        {/* Nút đóng đặt đầu tiên để querySelector('button') luôn giữ đúng contract */}
        <button
          type="button"
          id="auth-modal-close"
          onClick={onClose}
          aria-label="Đóng cửa sổ"
          className="auth-close-btn absolute top-4 right-4 z-20 w-10 h-10 rounded-full flex items-center justify-center transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>

        {/* Cột trái: Ngữ cảnh trực quan thích ứng theo chế độ (desktop) */}
        {isSplitView && (
          <aside
            id="auth-showcase-panel"
            className="auth-showcase-panel hidden lg:flex lg:col-span-5 flex-col justify-between p-8 xl:p-9"
          >
            <div>
              <div className="flex items-center justify-between gap-3 mb-8">
                <PlanoraBrandMark />
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium auth-showcase-card text-[var(--pl-ink-muted)]">
                  Điều phối có duyệt
                </span>
              </div>

              {view === 'forgot' ? (
                <div>
                  <p className="auth-eyebrow text-[11px] font-semibold uppercase tracking-wider mb-2">
                    Khôi phục quyền truy cập
                  </p>
                  <h2 className="auth-display font-semibold text-2xl leading-[1.24] text-[var(--pl-ink)] mb-3">
                    Đặt lại mật khẩu an toàn, giữ nguyên phạm vi làm việc
                  </h2>
                  <p className="text-sm text-[var(--pl-ink-muted)] leading-relaxed mb-6">
                    Liên kết khôi phục được gửi trực tiếp tới email đã xác minh trong hệ thống.
                  </p>
                  <div className="space-y-3">
                    {FORGOT_GUARANTEES.map((item) => (
                      <div key={item.title} className="auth-showcase-card rounded-2xl p-3.5 flex items-start gap-3">
                        <span className="auth-step-badge w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
                          <LockKeyhole className="w-3.5 h-3.5" aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-[var(--pl-ink)]">{item.title}</p>
                          <p className="text-xs text-[var(--pl-ink-muted)] leading-relaxed mt-0.5">{item.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : !isLoginView ? (
                <div>
                  <p className="auth-eyebrow text-[11px] font-semibold uppercase tracking-wider mb-2">
                    Quy trình kích hoạt tài khoản
                  </p>
                  <h2 className="auth-display font-semibold text-2xl leading-[1.24] text-[var(--pl-ink)] mb-3">
                    Tài khoản mới được xác minh qua 3 bước rõ ràng
                  </h2>
                  <p className="text-sm text-[var(--pl-ink-muted)] leading-relaxed mb-6">
                    Mỗi không gian làm việc kiểm soát quyền truy cập chặt chẽ trước khi thực thi tác vụ.
                  </p>
                  <ol className="space-y-3">
                    {SIGNUP_STEPS.map((item) => (
                      <li key={item.step} className="auth-showcase-card rounded-2xl p-3.5 flex items-start gap-3">
                        <span className="auth-step-badge w-7 h-7 rounded-lg text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                          {item.step}
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-[var(--pl-ink)]">{item.title}</p>
                          <p className="text-xs text-[var(--pl-ink-muted)] leading-relaxed mt-0.5">{item.desc}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : (
                <div>
                  <p className="auth-eyebrow text-[11px] font-semibold uppercase tracking-wider mb-2">
                    Điều phối đa công cụ
                  </p>
                  <h2 className="auth-display font-semibold text-2xl leading-[1.24] text-[var(--pl-ink)] mb-3">
                    Từ một câu lệnh tiếng Việt đến toàn bộ quy trình được duyệt
                  </h2>
                  <p className="text-sm text-[var(--pl-ink-muted)] leading-relaxed mb-5">
                    Mọi thao tác ghi ra dịch vụ ngoài luôn dừng ở bản xem trước để bạn kiểm tra trước khi chạy.
                  </p>

                  <div className="space-y-2.5 mb-6">
                    {LOGIN_PILLARS.map((item) => (
                      <div key={item.title} className="auth-showcase-card rounded-2xl px-3.5 py-2.5 flex items-start gap-3">
                        <span className="auth-step-badge w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
                          <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-[var(--pl-ink)]">{item.title}</p>
                          <p className="text-[11px] text-[var(--pl-ink-muted)] leading-relaxed mt-0.5">{item.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--pl-ink-subtle)] mb-2.5">
                      Công cụ đồng bộ sẵn
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {SHOWCASE_SERVICES.map((service) => (
                        <span
                          key={service.id}
                          className="auth-service-chip inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium"
                        >
                          <ServiceLogo service={service.id} className="w-3.5 h-3.5 shrink-0" />
                          <span>{service.name}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <p className="text-[11px] text-[var(--pl-ink-subtle)] leading-relaxed pt-6 border-t auth-divider-line">
              Thông tin đăng nhập được truyền qua kết nối mã hóa và tách biệt quyền theo từng không gian làm việc.
            </p>
          </aside>
        )}

        {/* Cột phải: Không gian tương tác form */}
        <div className={isSplitView ? 'lg:col-span-7 p-5 sm:p-8 lg:p-9 flex flex-col justify-center' : 'p-5 sm:p-8'}>
          <div className={`mb-3.5 sm:mb-5 ${isSplitView ? 'lg:hidden' : ''}`}>
            <PlanoraBrandMark />
          </div>

          {activeError && (
            <p
              role="alert"
              className="p-3.5 mb-4 pr-10 bg-red-500/10 border border-red-500/35 rounded-xl text-xs text-red-600 dark:text-red-300 leading-relaxed"
            >
              {activeError}
            </p>
          )}

          {view === 'form' && (
            <div id="auth-form-view">
              <div className="pr-10 mb-3.5 sm:mb-5">
                <h1 id="auth-modal-title" className="auth-display font-semibold text-2xl sm:text-[26px] text-[var(--pl-ink)] mb-1">
                  {isLoginView ? 'Chào mừng bạn quay lại' : 'Bắt đầu với Planora'}
                </h1>
                <p id="auth-modal-subtitle" className="text-xs sm:text-sm text-[var(--pl-ink-muted)] leading-relaxed">
                  {isLoginView
                    ? 'Nền tảng điều phối công việc tự động bằng AI — đăng nhập để vào không gian làm việc của nhóm.'
                    : 'Điều phối tự động trên nhiều công cụ sau khi bạn duyệt.'}
                </p>
              </div>

              {/* Segmented Tab điều hướng */}
              <div
                className={`auth-tablist grid ${signupEnabled ? 'grid-cols-2' : 'grid-cols-1'} p-1 rounded-2xl mb-3.5 sm:mb-5`}
                role="tablist"
                aria-label="Chọn hình thức xác thực"
              >
                <button
                  type="button"
                  id="tab-btn-login"
                  role="tab"
                  aria-selected={isLoginView ? 'true' : 'false'}
                  className={`py-2.5 px-3 text-xs sm:text-sm rounded-xl transition-all cursor-pointer ${isLoginView ? 'auth-tab-on font-semibold' : 'auth-tab-off font-medium'}`}
                  onClick={() => onChangeMode('login')}
                >
                  Đăng nhập
                </button>
                {signupEnabled && (
                  <button
                    type="button"
                    id="tab-btn-signup"
                    role="tab"
                    aria-selected={isLoginView ? 'false' : 'true'}
                    className={`py-2.5 px-3 text-xs sm:text-sm rounded-xl transition-all cursor-pointer ${isLoginView ? 'auth-tab-off font-medium' : 'auth-tab-on font-semibold'}`}
                    onClick={() => onChangeMode('signup')}
                  >
                    Đăng ký
                  </button>
                )}
              </div>

              {googleEnabled && (
                <button
                  type="button"
                  id="auth-google-action"
                  disabled={busy || isLoggingIn}
                  onClick={onTriggerGoogle}
                  data-od-id="btn-modal-google"
                  className="auth-google-btn w-full flex items-center justify-center gap-3 px-4 py-3 text-sm font-medium rounded-xl transition-all shadow-sm mb-1 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z" />
                    <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.36 24 12 24z" />
                    <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z" />
                    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.36 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z" />
                  </svg>
                  <span>Tiếp tục với Google</span>
                </button>
              )}

              {showGoogleDivider && (
                <div className="relative my-3 sm:my-4 flex items-center justify-center">
                  <div className="absolute inset-0 flex items-center" aria-hidden="true">
                    <div className="auth-divider-line w-full border-t" />
                  </div>
                  <span className="auth-divider-label relative px-3 text-[11px] uppercase tracking-wider">
                    hoặc tiếp tục bằng email
                  </span>
                </div>
              )}

              {/* FORM 1: ĐĂNG NHẬP */}
              {isLoginView && (
                <form id="form-login" className="flex flex-col gap-3.5 sm:gap-4 mt-3 sm:mt-4" onSubmit={onLoginSubmit}>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--pl-ink-muted)] mb-1.5" htmlFor="login-email">
                      Email công việc hoặc cá nhân
                    </label>
                    <input
                      ref={loginEmailRef}
                      type="email"
                      id="login-email"
                      name="email"
                      aria-label="Email"
                      autoComplete="username"
                      spellCheck={false}
                      enterKeyHint="next"
                      value={loginEmail}
                      onChange={(event) => setLoginEmail(event.target.value)}
                      required
                      placeholder="lan.nguyen@congty.vn"
                      className="auth-input w-full px-3.5 py-2.5 text-sm rounded-xl transition-all"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <label className="text-xs font-semibold text-[var(--pl-ink-muted)]" htmlFor="login-password">
                        Mật khẩu
                      </label>
                      <button
                        type="button"
                        id="btn-forgot-password"
                        onClick={onShowForgot}
                        className="auth-link text-xs font-medium cursor-pointer"
                      >
                        Quên mật khẩu?
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        type={showLoginPw ? 'text' : 'password'}
                        id="login-password"
                        name="password"
                        autoComplete="current-password"
                        enterKeyHint="done"
                        value={loginPassword}
                        onChange={(event) => setLoginPassword(event.target.value)}
                        required
                        placeholder="Nhập mật khẩu của bạn"
                        className="auth-input w-full pl-3.5 pr-11 py-2.5 text-sm rounded-xl transition-all"
                      />
                      <button
                        type="button"
                        id="toggle-login-pwd"
                        onClick={() => setShowLoginPw((v) => !v)}
                        className="auth-pwd-toggle absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer"
                        aria-label="Hiện hoặc ẩn mật khẩu"
                        aria-pressed={showLoginPw}
                      >
                        {showLoginPw
                          ? <EyeOff className="w-4 h-4" aria-hidden="true" />
                          : <Eye className="w-4 h-4" aria-hidden="true" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={busy || isLoggingIn}
                    className="pl-btn-primary w-full justify-center min-h-[44px]"
                    aria-label={isLoggingIn ? 'Đang đăng nhập...' : 'Đăng nhập'}
                    data-od-id="btn-submit-login"
                  >
                    {isLoggingIn && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                    <span>{isLoggingIn ? 'Đang đăng nhập...' : 'Đăng nhập vào Planora'}</span>
                  </button>

                  <div className="pt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs">
                    {signupEnabled ? (
                      <span className="text-[var(--pl-ink-muted)]">
                        Chưa có tài khoản?{' '}
                        <button
                          type="button"
                          id="link-switch-signup"
                          onClick={() => onChangeMode('signup')}
                          className="auth-link font-semibold cursor-pointer"
                        >
                          Đăng ký
                        </button>
                      </span>
                    ) : (
                      <span />
                    )}
                    <button
                      type="button"
                      id="btn-resend-verification"
                      className="auth-link font-medium cursor-pointer"
                      onClick={() => onNavigate('/resend-verification')}
                    >
                      Gửi lại email xác minh
                    </button>
                  </div>
                </form>
              )}

              {/* FORM 2: ĐĂNG KÝ */}
              {!isLoginView && signupEnabled && (
                <form id="form-signup" className="flex flex-col gap-3 sm:gap-3.5 mt-3 sm:mt-4" onSubmit={onSignupSubmit}>
                  <div className="auth-mobile-notice lg:hidden px-3 py-2 rounded-xl text-[11px] leading-relaxed">
                    <strong className="font-semibold text-[var(--pl-ink)]">Quy trình 3 bước:</strong>{' '}
                    (1) Xác minh email, (2) Quản trị viên duyệt tài khoản, (3) Nhận email kích hoạt để đăng nhập.
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[var(--pl-ink-muted)] mb-1.5" htmlFor="signup-name">
                      Họ và tên của bạn
                    </label>
                    <input
                      ref={signupNameRef}
                      type="text"
                      id="signup-name"
                      name="name"
                      aria-label="Họ tên"
                      autoComplete="name"
                      enterKeyHint="next"
                      maxLength={100}
                      required
                      placeholder="Ví dụ: Nguyễn Lan"
                      className="auth-input w-full px-3.5 py-2.5 text-sm rounded-xl transition-all"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[var(--pl-ink-muted)] mb-1.5" htmlFor="signup-email">
                      Email công việc hoặc cá nhân
                    </label>
                    <input
                      ref={signupEmailRef}
                      type="email"
                      id="signup-email"
                      name="email"
                      aria-label="Email"
                      autoComplete="email"
                      spellCheck={false}
                      enterKeyHint="next"
                      maxLength={254}
                      required
                      placeholder="lan.nguyen@congty.vn"
                      className="auth-input w-full px-3.5 py-2.5 text-sm rounded-xl transition-all"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[var(--pl-ink-muted)] mb-1.5" htmlFor="signup-password">
                      Mật khẩu
                    </label>
                    <div className="relative">
                      <input
                        type={showSignupPw ? 'text' : 'password'}
                        id="signup-password"
                        name="new-password"
                        autoComplete="new-password"
                        enterKeyHint="done"
                        maxLength={128}
                        required
                        minLength={12}
                        value={signupPassword}
                        onChange={(event) => setSignupPassword(event.target.value)}
                        onFocus={() => setSignupPwdBlurred(false)}
                        onBlur={() => setSignupPwdBlurred(true)}
                        aria-describedby="signup-password-strength"
                        aria-invalid={passwordTooShort || undefined}
                        placeholder="Ít nhất 12 ký tự"
                        className="auth-input w-full pl-3.5 pr-11 py-2.5 text-sm rounded-xl transition-all"
                      />
                      <button
                        type="button"
                        id="toggle-signup-pwd"
                        onClick={() => setShowSignupPw((v) => !v)}
                        className="auth-pwd-toggle absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer"
                        aria-label="Hiện hoặc ẩn mật khẩu"
                        aria-pressed={showSignupPw}
                      >
                        {showSignupPw
                          ? <EyeOff className="w-4 h-4" aria-hidden="true" />
                          : <Eye className="w-4 h-4" aria-hidden="true" />}
                      </button>
                    </div>

                    <div id="signup-password-strength" className="mt-2 space-y-1.5">
                      <div className="flex items-center gap-1.5" aria-hidden="true">
                        {([0, 1, 2, 3] as const).map((idx) => {
                          const barTone = idx < passwordGuidance.filledBars ? passwordGuidance.barTone : 'empty';
                          return (
                            <span
                              key={idx}
                              data-strength-bar={barTone}
                              className={`h-2 flex-1 rounded-full transition-colors duration-200 auth-strength-${barTone}`}
                            />
                          );
                        })}
                      </div>
                      <p className={`text-[11px] leading-snug font-medium auth-tone-${passwordGuidance.tone}`}>
                        {passwordGuidance.label}
                      </p>
                    </div>
                    <div role="status" aria-atomic="true" className="sr-only">
                      {passwordTooShort ? 'Mật khẩu cần ít nhất 12 ký tự.' : ''}
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={busy || isLoggingIn}
                    className="pl-btn-primary w-full justify-center min-h-[44px]"
                    aria-label="Gửi yêu cầu đăng ký"
                    data-od-id="btn-submit-signup"
                  >
                    {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                    <span>{busy ? 'Đang gửi yêu cầu...' : 'Gửi yêu cầu đăng ký'}</span>
                  </button>

                  <div className="pt-1 flex items-center justify-between gap-3 text-xs">
                    <span className="text-[var(--pl-ink-muted)]">
                      Đã có tài khoản?{' '}
                      <button
                        type="button"
                        id="link-switch-login"
                        onClick={() => onChangeMode('login')}
                        className="auth-link font-semibold cursor-pointer"
                      >
                        Đăng nhập
                      </button>
                    </span>
                  </div>
                </form>
              )}

              {!isLoginView && !signupEnabled && (
                <div className="auth-mobile-notice mt-4 p-4 rounded-2xl text-xs sm:text-sm leading-relaxed">
                  <p role="status">Đăng ký bằng email hiện đang đóng.</p>
                </div>
              )}

              {(showEmailFormBelowGoogle || googleEnabled) && (
                <p className="mt-4 text-[11px] text-[var(--pl-ink-subtle)] leading-relaxed">
                  Khi tiếp tục, bạn đồng ý với{' '}
                  <a
                    href="/privacy"
                    onClick={(event) => {
                      event.preventDefault();
                      onNavigate('/privacy');
                    }}
                    className="auth-link font-medium"
                  >
                    Chính sách an toàn &amp; Dữ liệu
                  </a>{' '}
                  của Planora.
                </p>
              )}
            </div>
          )}

          {view === 'google' && (
            <div id="auth-google-view" className="text-center py-6">
              <div className="w-12 h-12 rounded-2xl bg-[var(--pl-ground-alt)] border border-[var(--pl-rule-strong)] flex items-center justify-center mx-auto mb-4">
                <Loader2 className="w-6 h-6 animate-spin text-[#FF5701]" aria-hidden="true" />
              </div>
              <h1 id="auth-google-title" className="auth-display font-semibold text-xl sm:text-2xl text-[var(--pl-ink)] mb-2">
                Đang chuyển sang trang đăng nhập của Google…
              </h1>
              <p className="text-xs sm:text-sm text-[var(--pl-ink-muted)] max-w-sm mx-auto mb-3 leading-relaxed">
                Hệ thống đang kết nối an toàn với tài khoản Google của bạn. Vui lòng chờ trong giây lát.
              </p>
              <p className="text-[11px] text-[var(--pl-ink-subtle)]">
                Chỉ nhận email, họ tên, ảnh đại diện · Xem{' '}
                <a
                  href="/privacy#google-oauth"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="auth-link font-medium"
                >
                  Chính sách dữ liệu tài khoản Google
                </a>
              </p>
            </div>
          )}

          {view === 'forgot' && (
            <div id="auth-forgot-view">
              <div className="pr-10 mb-5">
                <h1 id="auth-forgot-title" className="auth-display font-semibold text-2xl sm:text-[26px] text-[var(--pl-ink)] mb-1.5">
                  Đặt lại mật khẩu
                </h1>
                <p className="text-xs sm:text-sm text-[var(--pl-ink-muted)] leading-relaxed">
                  Nhập email của bạn để nhận hướng dẫn đặt lại mật khẩu.
                </p>
              </div>
              <form id="form-forgot" className="space-y-4" onSubmit={onForgotSubmit}>
                <div>
                  <label className="block text-xs font-semibold text-[var(--pl-ink-muted)] mb-1.5" htmlFor="forgot-email">
                    Email tài khoản của bạn
                  </label>
                  <input
                    ref={forgotEmailRef}
                    type="email"
                    id="forgot-email"
                    name="email"
                    aria-label="Email"
                    autoComplete="email"
                    spellCheck={false}
                    enterKeyHint="done"
                    maxLength={254}
                    required
                    placeholder="lan.nguyen@congty.vn"
                    className="auth-input w-full px-3.5 py-2.5 text-sm rounded-xl transition-all"
                  />
                </div>
                <div
                  id="forgot-feedback-box"
                  role={forgotSent ? 'status' : undefined}
                  className={`${forgotSent ? '' : 'hidden '}p-3.5 bg-emerald-500/10 border border-emerald-500/35 rounded-xl text-xs text-emerald-700 dark:text-emerald-300 leading-relaxed`}
                >
                  Nếu email này có tài khoản, bạn sẽ nhận được link đặt lại mật khẩu.
                </div>
                <button
                  type="submit"
                  id="btn-submit-forgot"
                  aria-label="Gửi link đặt lại mật khẩu"
                  disabled={busy}
                  className="pl-btn-primary w-full justify-center min-h-[44px]"
                >
                  {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                  <span>{busy ? 'Đang gửi...' : 'Gửi link đặt lại'}</span>
                </button>
                <button
                  type="button"
                  id="btn-back-from-forgot"
                  onClick={() => onChangeMode('login')}
                  className="auth-secondary-btn w-full py-2.5 px-4 text-xs font-medium rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Quay lại đăng nhập</span>
                </button>
              </form>
            </div>
          )}

          {view === 'success' && (
            <div id="auth-success-view" className="text-center py-2">
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/35 text-emerald-600 dark:text-emerald-300 flex items-center justify-center mx-auto mb-4">
                <Check className="w-7 h-7" strokeWidth={2.5} aria-hidden="true" />
              </div>
              <h1 id="success-title" className="auth-display font-semibold text-2xl text-[var(--pl-ink)] mb-2">
                {success ? success.title : 'Đã gửi yêu cầu đăng ký!'}
              </h1>
              <p id="success-desc" role="status" className="text-xs sm:text-sm text-[var(--pl-ink-muted)] leading-relaxed max-w-sm mx-auto mb-6">
                {success
                  ? success.desc
                  : 'Hệ thống đã ghi nhận email của bạn. Quản trị viên nhóm sẽ phê duyệt quyền truy cập và bạn sẽ nhận được email thông báo ngay khi tài khoản sẵn sàng.'}
              </p>
              <div id="success-action-area" className="space-y-2.5">
                {success?.isLogin && (
                  <a
                    id="btn-enter-workspace"
                    href="/"
                    className="pl-btn-primary w-full justify-center min-h-[44px]"
                  >
                    <span>Vào không gian làm việc</span>
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </a>
                )}
                <button
                  ref={successCloseRef}
                  type="button"
                  id="btn-success-close"
                  onClick={onClose}
                  className="auth-secondary-btn w-full py-2.5 px-4 text-xs sm:text-sm font-medium rounded-xl transition-all cursor-pointer"
                >
                  Đã hiểu và đóng
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
