import type { FormEvent, MouseEvent as ReactMouseEvent, ReactNode, RefObject } from 'react';
import { useEffect, useState } from 'react';

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

const FOCUSABLE =
  'button:not([disabled]), [href]:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

function EyeIcon({ visible }: { visible: boolean }) {
  return visible ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  );
}

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

  const isLoginView = mode !== 'signup';

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
      className="pl-modal fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/65 backdrop-blur-sm opacity-100 pointer-events-auto transition-opacity duration-200"
    >
      <div
        ref={cardRef}
        id="auth-modal-card"
        data-od-id="auth-modal-card"
        className="pl-modal-card rounded-3xl shadow-2xl max-w-md w-full p-6 sm:p-8 relative overflow-hidden transition-all duration-200 scale-100 max-h-[88vh] overflow-y-auto"
      >
        <button
          type="button"
          id="auth-modal-close"
          onClick={onClose}
          aria-label="Đóng cửa sổ"
          className="absolute top-5 right-5 w-8 h-8 rounded-full flex items-center justify-center text-[var(--pl-ink-subtle)] hover:text-[var(--pl-ink)] hover:bg-[var(--pl-ground-alt)] transition-colors cursor-pointer"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {(error || authError) && (
          <p role="alert" className="p-3.5 mb-4 bg-red-500/10 border border-red-500/35 rounded-xl text-xs text-red-600 dark:text-red-300">
            {error || authError}
          </p>
        )}

        <div className="flex items-center gap-2.5 mb-4">
          <div className="pl-brand-mark">P</div>
          <span className="font-semibold text-xl tracking-tight text-[var(--pl-ink)]" style={{ fontFamily: 'var(--pl-font-display)' }}>
            Planora
          </span>
        </div>

        {view === 'form' && (
          <div id="auth-form-view">
            <h1
              id="auth-modal-title"
              className="font-medium text-2xl sm:text-[26px] text-[var(--pl-ink)] tracking-tight mb-1.5"
              style={{ fontFamily: 'var(--pl-font-display)' }}
            >
              {isLoginView ? 'Chào mừng bạn quay lại' : 'Bắt đầu với Planora'}
            </h1>
            <p id="auth-modal-subtitle" className="text-xs sm:text-sm text-[var(--pl-ink-muted)] leading-relaxed mb-5">
              {isLoginView
                ? 'Nền tảng điều phối công việc tự động bằng AI — đăng nhập để vào không gian làm việc của nhóm.'
                : 'Điều phối tự động trên nhiều công cụ sau khi bạn duyệt.'}
            </p>

            <div
              className="grid grid-cols-2 p-1 bg-[var(--pl-ground-alt)] border border-[var(--pl-rule)] rounded-2xl mb-5"
              role="tablist"
              aria-label="Chọn hình thức xác thực"
            >
              <button
                type="button"
                id="tab-btn-login"
                role="tab"
                aria-selected={isLoginView ? 'true' : 'false'}
                className={`py-2 text-xs sm:text-sm rounded-xl transition-all cursor-pointer ${
                  isLoginView
                    ? 'font-semibold bg-[var(--pl-ground-elevated)] text-[var(--pl-ink)] shadow-sm'
                    : 'font-medium text-[var(--pl-ink-subtle)] hover:text-[var(--pl-ink)]'
                }`}
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
                  className={`py-2 text-xs sm:text-sm rounded-xl transition-all cursor-pointer ${
                    !isLoginView
                      ? 'font-semibold bg-[var(--pl-ground-elevated)] text-[var(--pl-ink)] shadow-sm'
                      : 'font-medium text-[var(--pl-ink-subtle)] hover:text-[var(--pl-ink)]'
                  }`}
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
                className="pl-btn-secondary w-full justify-center mb-2.5"
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

            <p className="text-[11px] text-[var(--pl-ink-subtle)] text-center mb-3">
              Khi tiếp tục, bạn đồng ý với{' '}
              <a
                href="/privacy"
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate('/privacy');
                }}
                className="text-[#FF5701] hover:underline font-medium"
              >
                Chính sách an toàn &amp; Dữ liệu
              </a>{' '}
              của Planora.
            </p>

            <div className="relative my-4 flex items-center justify-center">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-[var(--pl-rule)]" />
              </div>
              <span className="relative px-3 bg-[var(--pl-ground-elevated)] text-[11px] text-[var(--pl-ink-subtle)] uppercase tracking-wider">
                hoặc bằng email
              </span>
            </div>

            {isLoginView && (
              <form id="form-login" className="space-y-4" onSubmit={onLoginSubmit}>
                <div>
                  <label className="block text-xs font-semibold text-[var(--pl-ink-muted)] mb-1.5" htmlFor="login-email">
                    Email công việc hoặc cá nhân
                  </label>
                  <input
                    ref={loginEmailRef}
                    type="email"
                    id="login-email"
                    aria-label="Email"
                    autoComplete="username"
                    value={loginEmail}
                    onChange={(event) => setLoginEmail(event.target.value)}
                    required
                    placeholder="lan.nguyen@congty.vn"
                    className="pl-modal-input w-full px-3.5 py-2.5 text-sm rounded-xl"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-[var(--pl-ink-muted)]" htmlFor="login-password">
                      Mật khẩu
                    </label>
                    <button
                      type="button"
                      id="btn-forgot-password"
                      onClick={onShowForgot}
                      className="text-xs text-[#FF5701] hover:underline cursor-pointer"
                    >
                      Quên mật khẩu?
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      type={showLoginPw ? 'text' : 'password'}
                      id="login-password"
                      autoComplete="current-password"
                      value={loginPassword}
                      onChange={(event) => setLoginPassword(event.target.value)}
                      required
                      placeholder="••••••••"
                      className="pl-modal-input w-full px-3.5 py-2.5 text-sm rounded-xl pr-10"
                    />
                    <button
                      type="button"
                      id="toggle-login-pwd"
                      onClick={() => setShowLoginPw((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--pl-ink-subtle)] hover:text-[var(--pl-ink)] cursor-pointer"
                      aria-label="Hiện hoặc ẩn mật khẩu"
                    >
                      <EyeIcon visible={showLoginPw} />
                    </button>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={busy || isLoggingIn}
                  className="pl-btn-primary w-full justify-center"
                  aria-label={isLoggingIn ? 'Đang đăng nhập...' : 'Đăng nhập'}
                  data-od-id="btn-submit-login"
                >
                  <span>Đăng nhập vào Planora</span>
                </button>
                {signupEnabled && (
                  <p className="text-center text-xs text-[var(--pl-ink-subtle)] pt-1">
                    Chưa có tài khoản?{' '}
                    <button
                      type="button"
                      id="link-switch-signup"
                      onClick={() => onChangeMode('signup')}
                      className="font-semibold text-[#FF5701] hover:underline cursor-pointer"
                    >
                      Đăng ký
                    </button>
                  </p>
                )}
                <button
                  type="button"
                  className="text-xs text-[#FF5701] hover:underline cursor-pointer"
                  onClick={() => onNavigate('/resend-verification')}
                >
                  Gửi lại email xác minh
                </button>
              </form>
            )}

            {!isLoginView && signupEnabled && (
              <form id="form-signup" className="space-y-3.5" onSubmit={onSignupSubmit}>
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-[var(--pl-ink-muted)] leading-relaxed">
                  <strong className="font-semibold text-[var(--pl-ink)]">Quy trình 3 bước:</strong> (1) Mở email để xác minh địa chỉ, (2) Quản trị viên duyệt tài khoản, (3) Bạn nhận email khi được duyệt.
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--pl-ink-muted)] mb-1.5" htmlFor="signup-name">
                    Họ và tên của bạn
                  </label>
                  <input
                    ref={signupNameRef}
                    type="text"
                    id="signup-name"
                    aria-label="Họ tên"
                    autoComplete="name"
                    maxLength={100}
                    required
                    placeholder="Ví dụ: Nguyễn Lan"
                    className="pl-modal-input w-full px-3.5 py-2.5 text-sm rounded-xl"
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
                    aria-label="Email"
                    autoComplete="email"
                    maxLength={254}
                    required
                    placeholder="lan.nguyen@congty.vn"
                    className="pl-modal-input w-full px-3.5 py-2.5 text-sm rounded-xl"
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
                      autoComplete="new-password"
                      maxLength={128}
                      required
                      minLength={12}
                      placeholder="Ít nhất 12 ký tự"
                      className="pl-modal-input w-full px-3.5 py-2.5 text-sm rounded-xl pr-10"
                    />
                    <button
                      type="button"
                      id="toggle-signup-pwd"
                      onClick={() => setShowSignupPw((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--pl-ink-subtle)] hover:text-[var(--pl-ink)] cursor-pointer"
                      aria-label="Hiện hoặc ẩn mật khẩu"
                    >
                      <EyeIcon visible={showSignupPw} />
                    </button>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={busy || isLoggingIn}
                  className="pl-btn-primary w-full justify-center"
                  data-od-id="btn-submit-signup"
                >
                  <span>Gửi yêu cầu đăng ký</span>
                </button>
                <p className="text-center text-xs text-[var(--pl-ink-subtle)] pt-1">
                  Đã có tài khoản?{' '}
                  <button
                    type="button"
                    id="link-switch-login"
                    onClick={() => onChangeMode('login')}
                    className="font-semibold text-[#FF5701] hover:underline cursor-pointer"
                  >
                    Đăng nhập
                  </button>
                </p>
              </form>
            )}
            {!isLoginView && !signupEnabled && <p role="status">Đăng ký bằng email hiện đang đóng.</p>}
          </div>
        )}

        {view === 'google' && (
          <div id="auth-google-view" className="text-center py-6">
            <div className="w-12 h-12 rounded-full bg-[var(--pl-ground-alt)] border border-[var(--pl-rule)] flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 animate-spin text-[#FF5701]" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            </div>
            <h1 id="auth-google-title" className="font-medium text-xl sm:text-2xl text-[var(--pl-ink)] tracking-tight mb-2" style={{ fontFamily: 'var(--pl-font-display)' }}>
              Đang chuyển sang trang đăng nhập của Google…
            </h1>
            <p className="text-xs sm:text-sm text-[var(--pl-ink-muted)] max-w-sm mx-auto mb-3">
              Hệ thống đang kết nối an toàn với tài khoản Google của bạn. Vui lòng chờ trong giây lát.
            </p>
            <p className="text-[11px] text-[var(--pl-ink-subtle)]">
              Chỉ nhận email, họ tên, ảnh đại diện · Xem{' '}
              <a
                href="/privacy#google-oauth"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#FF5701] hover:underline font-medium"
              >
                Chính sách dữ liệu tài khoản Google
              </a>
            </p>
          </div>
        )}

        {view === 'forgot' && (
          <div id="auth-forgot-view">
            <h1 id="auth-forgot-title" className="font-medium text-2xl text-[var(--pl-ink)] tracking-tight mb-1.5" style={{ fontFamily: 'var(--pl-font-display)' }}>
              Đặt lại mật khẩu
            </h1>
            <p className="text-xs sm:text-sm text-[var(--pl-ink-muted)] leading-relaxed mb-5">
              Nhập email của bạn để nhận hướng dẫn đặt lại mật khẩu.
            </p>
            <form id="form-forgot" className="space-y-4" onSubmit={onForgotSubmit}>
              <div>
                <label className="block text-xs font-semibold text-[var(--pl-ink-muted)] mb-1.5" htmlFor="forgot-email">
                  Email tài khoản của bạn
                </label>
                <input
                  ref={forgotEmailRef}
                  type="email"
                  id="forgot-email"
                  aria-label="Email"
                  autoComplete="email"
                  maxLength={254}
                  required
                  placeholder="lan.nguyen@congty.vn"
                  className="pl-modal-input w-full px-3.5 py-2.5 text-sm rounded-xl"
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
                className="pl-btn-primary w-full justify-center"
              >
                <span>Gửi link đặt lại</span>
              </button>
              <button
                type="button"
                id="btn-back-from-forgot"
                onClick={() => onChangeMode('login')}
                className="pl-btn-secondary w-full justify-center text-xs"
              >
                &larr; Quay lại đăng nhập
              </button>
            </form>
          </div>
        )}

        {view === 'success' && (
          <div id="auth-success-view" className="text-center py-2">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/35 text-emerald-600 dark:text-emerald-300 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 id="success-title" className="font-medium text-2xl text-[var(--pl-ink)] tracking-tight mb-2" style={{ fontFamily: 'var(--pl-font-display)' }}>
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
                  className="pl-btn-primary w-full justify-center"
                >
                  <span>Vào không gian làm việc &rarr;</span>
                </a>
              )}
              <button
                ref={successCloseRef}
                type="button"
                id="btn-success-close"
                onClick={onClose}
                className="pl-btn-secondary w-full justify-center text-xs sm:text-sm"
              >
                Đã hiểu và đóng
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
