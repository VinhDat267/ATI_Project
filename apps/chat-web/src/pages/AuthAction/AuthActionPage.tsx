import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { usePrototypePage, type PageMeta } from '../../prototype/usePrototypePage';
import { PlanoraAuthFrame } from '../../planora/layout/PlanoraAuthFrame';
import css from './page.css?inline';

export type AuthActionMode =
  | 'loading'
  | 'verify-success'
  | 'verify-expired'
  | 'verify-used'
  | 'reset-password'
  | 'reset-success'
  | 'google-pending'
  | 'google-ready'
  | 'google-error'
  | 'blocked-pending'
  | 'blocked-locked'
  | 'blocked-attempts'
  | 'email-not-verified';

const spinner = (
  <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
    />
  </svg>
);

const eyeOpen = (
  <>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
    />
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
    />
  </>
);

const eyeClosed = (
  <path
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2"
    d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18"
  />
);

function strength(password: string): { bars: string[]; text: string; className: string } {
  const empty = [
    'planora-strength-bar',
    'planora-strength-bar',
    'planora-strength-bar',
    'planora-strength-bar',
  ];
  if (!password) {
    return {
      bars: empty,
      text: 'Tối thiểu 12 ký tự',
      className: 'text-[11px] text-[var(--planora-muted)]',
    };
  }
  if (password.length < 12) {
    return {
      bars: ['planora-strength-bar bar-danger', ...empty.slice(1)],
      text: 'Mật khẩu cần ít nhất 12 ký tự',
      className: 'text-[11px] text-[var(--planora-error-text)] font-medium',
    };
  }
  let score = 1;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  const filled = (count: number, cls: string) =>
    empty.map((bar, i) => (i < count ? `planora-strength-bar ${cls}` : bar));
  if (score <= 1) {
    return {
      bars: filled(1, 'bar-warn'),
      text: 'Độ mạnh: Khá (đạt 12 ký tự)',
      className: 'text-[11px] text-[var(--planora-pending-text)] font-medium',
    };
  }
  if (score === 2) {
    return {
      bars: filled(2, 'bar-warn'),
      text: 'Độ mạnh: Tốt',
      className: 'text-[11px] text-[var(--planora-pending-text)] font-medium',
    };
  }
  if (score === 3) {
    return {
      bars: filled(3, 'bar-success'),
      text: 'Độ mạnh: Rất an toàn',
      className: 'text-[11px] text-[var(--planora-primary)] font-medium',
    };
  }
  return {
    bars: filled(4, 'bar-success'),
    text: 'Độ mạnh: Tuyệt vời',
    className: 'text-[11px] text-[var(--planora-primary)] font-medium',
  };
}

const meta: PageMeta = {
  id: 'auth-action',
  title: 'Xác thực & Hành động tài khoản — Planora',
  htmlClass: '',
  bodyClass: 'min-h-screen flex flex-col planora-auth-action-body',
  css,
};

export interface AuthActionPageProps {
  mode: AuthActionMode;
  email?: string;
  name?: string;
  busy?: boolean;
  error?: string | null;
  message?: string | null;
  deadline?: number | null;
  navigate: (path: string, replace?: boolean) => void;
  onResend?: (email: string) => Promise<void>;
  onReset?: (password: string, confirmation: string) => Promise<void>;
  onAccount?: () => void;
}

export function AuthActionPage({
  mode,
  email = '',
  name = '',
  busy = false,
  error,
  message,
  deadline,
  navigate,
  onResend,
  onReset,
  onAccount,
}: AuthActionPageProps) {
  usePrototypePage(meta);

  const followLink = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    navigate(event.currentTarget.getAttribute('href') ?? '/');
  };

  const [newPassword, setNewPassword] = useState('');
  const [strengthTouched, setStrengthTouched] = useState(false);
  const [matchMessage, setMatchMessage] = useState({
    text: '',
    className: 'text-[11px] text-[var(--planora-muted)] mt-1',
  });
  const [visible, setVisible] = useState({
    'new-password-input': false,
    'confirm-password-input': false,
  });

  const resendInputRef = useRef<HTMLInputElement>(null);
  const newPasswordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);

  const remaining = () =>
    deadline == null ? null : Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  const [blockedSeconds, setBlockedSeconds] = useState<number | null>(remaining);

  useEffect(() => {
    setBlockedSeconds(remaining());
    if (deadline == null) return;
    const timer = window.setInterval(() => setBlockedSeconds(remaining()), 1000);
    return () => window.clearInterval(timer);
  }, [deadline]);

  const checkPasswordMatch = () => {
    const password = newPasswordRef.current?.value ?? '';
    const confirm = confirmPasswordRef.current?.value ?? '';
    setMatchMessage(
      !confirm
        ? { text: '', className: 'text-[11px] text-[var(--planora-muted)] mt-1' }
        : password === confirm
        ? {
            text: '✓ Mật khẩu khớp nhau',
            className: 'text-[11px] text-[var(--planora-primary)] mt-1 font-medium',
          }
        : {
            text: 'Mật khẩu xác nhận chưa trùng khớp',
            className: 'text-[11px] text-[var(--planora-error-text)] mt-1',
          }
    );
  };

  const actions = {
    handleResendVerification(event: FormEvent) {
      event.preventDefault();
      if (!busy) void onResend?.(resendInputRef.current?.value.trim() ?? email);
    },
    validatePasswordStrength(password: string) {
      setNewPassword(password);
      setStrengthTouched(true);
      checkPasswordMatch();
    },
    checkPasswordMatch,
    togglePasswordVisibility(inputId: keyof typeof visible) {
      setVisible(state => ({ ...state, [inputId]: !state[inputId] }));
    },
    handleResetPasswordSubmit(event: FormEvent) {
      event.preventDefault();
      if (!busy)
        void onReset?.(
          newPasswordRef.current?.value ?? '',
          confirmPasswordRef.current?.value ?? ''
        );
    },
  };

  const power = strength(newPassword);
  const resendBusy = busy;
  const resetBusy = busy;
  const resendSent =
    message && (mode === 'verify-expired' || mode === 'email-not-verified') ? message : null;

  const blockedDone = blockedSeconds === 0;
  const blockedText =
    blockedSeconds === null
      ? 'Chưa có thời gian từ máy chủ'
      : `${String(Math.floor(blockedSeconds / 60)).padStart(2, '0')}:${String(
          blockedSeconds % 60
        ).padStart(2, '0')}`;
  const blockedWidth =
    blockedSeconds === null
      ? '0%'
      : `${Math.max(0, Math.min(100, (blockedSeconds / 900) * 100))}%`;

  // Cấu hình hiển thị theo mode
  const getModeConfig = (): {
    badge: string;
    title: string;
    subtitle?: ReactNode;
    body: ReactNode;
  } => {
    switch (mode) {
      case 'loading':
        return {
          badge: 'XÁC MINH EMAIL',
          title: 'Đang xác minh tài khoản…',
          subtitle: 'Vui lòng chờ trong giây lát trong khi chúng tôi xử lý yêu cầu.',
          body: (
            <div id="view-loading" className="text-center py-6">
              <div className="w-10 h-10 mx-auto mb-4 border-2 border-[var(--planora-divider)] border-t-[var(--planora-primary)] rounded-full animate-spin" />
            </div>
          ),
        };

      case 'verify-success':
        return {
          badge: 'Bước 1 / 3 hoàn tất',
          title: 'Email của bạn đã được xác minh',
          subtitle: (
            <>
              {'Địa chỉ '}
              <strong className="text-[var(--planora-text)] font-semibold user-email-placeholder break-all">
                {email || 'email của bạn'}
              </strong>
              {' đã được xác thực thành công. Yêu cầu của bạn đã sẵn sàng cho bước tiếp theo.'}
            </>
          ),
          body: (
            <section
              id="view-verify-success"
              className="v3-space-y-6"
              aria-labelledby="planora-auth-title"
            >
              <div className="flex items-center justify-center my-2">
                <div className="w-14 h-14 rounded-2xl bg-[var(--planora-success-bg)] text-[var(--planora-success-text)] border border-[var(--planora-success-border)] flex items-center justify-center shadow-sm">
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2.5"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
              </div>

              <div className="planora-auth-info-card">
                <div className="text-xs font-semibold uppercase tracking-wider text-[var(--planora-muted)]">
                  Tiến trình kích hoạt tài khoản
                </div>
                <div className="planora-auth-timeline">
                  <div className="planora-timeline-step">
                    <div className="planora-timeline-badge done">✓</div>
                    <div className="planora-timeline-content">
                      <div className="planora-timeline-title">Bước 1: Xác minh địa chỉ email</div>
                      <div className="planora-timeline-desc">
                        Đã xác minh qua liên kết trong thư điện tử.
                      </div>
                    </div>
                  </div>
                  <div className="planora-timeline-step">
                    <div className="planora-timeline-badge done">✓</div>
                    <div className="planora-timeline-content">
                      <div className="planora-timeline-title text-[var(--planora-primary)]">
                        Bước 2: Sẵn sàng sử dụng Không gian Cá nhân
                      </div>
                      <div className="planora-timeline-desc">
                        Tài khoản của bạn đã được kích hoạt. Bạn có thể kết nối công cụ và bắt đầu
                        giao việc ngay lập tức.
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <p className="text-xs text-[var(--planora-muted)] text-center leading-relaxed m-0">
                Hệ thống chỉ gửi thông báo xác thực từ địa chỉ chính thức của nhóm. Bạn có thể an
                tâm đóng trang này hoặc quay về trang chủ.
              </p>

              <div className="v3-space-y-2.5 pt-1">
                <a onClick={followLink} href="/" className="planora-auth-submit">
                  <span>Về trang chủ Planora</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M14 5l7 7m0 0l-7 7m7-7H3"
                    />
                  </svg>
                </a>
                <a
                  onClick={followLink}
                  href="/login"
                  className="planora-auth-link-btn"
                  style={{ justifyContent: 'center', width: '100%' }}
                >
                  Thử đăng nhập lại
                </a>
              </div>
            </section>
          ),
        };

      case 'verify-expired':
        return {
          badge: 'Xác minh email',
          title: 'Link xác minh không còn hiệu lực',
          subtitle: (
            <>
              {'Vì lý do an toàn, các đường link xác minh email chỉ có hiệu lực trong vòng '}
              <strong className="text-[var(--planora-text)]">24 giờ</strong>
              {
                ' kể từ lúc gửi. Link có thể không hợp lệ, đã được sử dụng hoặc đã hết hạn. Bạn có thể yêu cầu một link mới.'
              }
            </>
          ),
          body: (
            <section
              id="view-verify-expired"
              className="v3-space-y-6"
              aria-labelledby="planora-auth-title"
            >
              <div className="flex items-center justify-center my-2">
                <div className="w-14 h-14 rounded-2xl bg-[var(--planora-pending-bg)] text-[var(--planora-pending-text)] border border-[var(--planora-pending-border)] flex items-center justify-center shadow-sm">
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
              </div>

              <form
                id="form-resend-verification"
                onSubmit={actions.handleResendVerification}
                className="planora-auth-info-card v3-space-y-4"
              >
                <div>
                  <label
                    htmlFor="resend-email-input"
                    className="block text-xs font-semibold text-[var(--planora-text)] uppercase tracking-wider mb-1.5"
                  >
                    Nhập email để nhận link xác minh mới
                  </label>
                  <input
                    ref={resendInputRef}
                    type="email"
                    id="resend-email-input"
                    required
                    defaultValue={email}
                    aria-label="Email"
                    autoComplete="email"
                    maxLength={254}
                    className="planora-auth-input"
                    placeholder="name@example.com"
                  />
                </div>
                <button
                  type="submit"
                  id="btn-submit-resend"
                  className="planora-auth-submit"
                  disabled={resendBusy}
                >
                  {resendBusy ? (
                    <>
                      {spinner}
                      <span>Đang gửi lại…</span>
                    </>
                  ) : (
                    <>
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                        />
                      </svg>
                      <span>Gửi lại link xác minh mới</span>
                    </>
                  )}
                </button>
              </form>

              {resendSent && (
                <div id="resend-success-box" className="planora-auth-success" role="status">
                  {resendSent}
                </div>
              )}

              <div className="text-center pt-2">
                <a
                  onClick={followLink}
                  href="/"
                  className="planora-auth-link-btn"
                  style={{ justifyContent: 'center' }}
                >
                  ← Quay lại trang chủ
                </a>
              </div>
            </section>
          ),
        };

      case 'email-not-verified':
        return {
          badge: 'Cần xác minh email',
          title: 'Tài khoản đang chờ duyệt',
          subtitle: (
            <>
              <span className="block text-sm font-semibold text-[var(--planora-pending-text)] mb-1">
                Bạn cần xác minh địa chỉ email
              </span>
              <span className="text-xs text-[var(--planora-muted)]">
                {error || (
                  <>
                    {'Địa chỉ email '}
                    <strong className="text-[var(--planora-text)] font-semibold user-email-placeholder break-all">
                      {email || 'của bạn'}
                    </strong>
                    {' chưa được xác minh. Hãy kiểm tra hộp thư hoặc bấm gửi lại link xác minh mới bên dưới.'}
                  </>
                )}
              </span>
            </>
          ),
          body: (
            <section
              id="view-email-not-verified"
              className="v3-space-y-6"
              aria-labelledby="planora-auth-title"
            >
              <div className="flex items-center justify-between text-xs text-[var(--planora-primary)] bg-[var(--planora-surface-inset)] p-3 rounded-xl border border-[var(--planora-divider)]">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-[var(--planora-primary-soft)] flex items-center justify-center font-bold text-[11px] text-[var(--planora-primary)]">
                    1
                  </span>
                  <span className="font-medium text-[var(--planora-text)]">
                    1. Đăng ký &amp; xác thực email
                  </span>
                </div>
                <span className="text-[11px] font-semibold text-[var(--planora-primary)]">
                  Nếu chưa hoàn tất
                </span>
              </div>

              <form
                id="form-resend-verification"
                onSubmit={actions.handleResendVerification}
                className="planora-auth-info-card v3-space-y-4"
              >
                <div>
                  <label
                    htmlFor="resend-email-input"
                    className="block text-xs font-semibold text-[var(--planora-text)] uppercase tracking-wider mb-1.5"
                  >
                    Nhập email để nhận link xác minh mới
                  </label>
                  <input
                    ref={resendInputRef}
                    type="email"
                    id="resend-email-input"
                    required
                    defaultValue={email}
                    aria-label="Email"
                    autoComplete="email"
                    maxLength={254}
                    className="planora-auth-input"
                    placeholder="name@example.com"
                  />
                </div>
                <button
                  type="submit"
                  id="btn-submit-resend"
                  className="planora-auth-submit"
                  disabled={resendBusy}
                >
                  {resendBusy ? (
                    <>
                      {spinner}
                      <span>Đang gửi lại…</span>
                    </>
                  ) : (
                    <>
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                        />
                      </svg>
                      <span>Gửi lại link xác minh mới</span>
                    </>
                  )}
                </button>
              </form>

              {resendSent && (
                <div id="resend-success-box" className="planora-auth-success" role="status">
                  {resendSent}
                </div>
              )}

              <div className="v3-space-y-2.5 pt-1">
                <a
                  onClick={followLink}
                  href="/login"
                  className="planora-auth-link-btn"
                  style={{ justifyContent: 'center', width: '100%' }}
                >
                  Thử đăng nhập lại
                </a>
              </div>
            </section>
          ),
        };

      case 'verify-used':
        return {
          badge: 'Đã xác thực trước đó',
          title: 'Link này đã được sử dụng',
          subtitle: (
            <>
              {'Địa chỉ '}
              <strong className="text-[var(--planora-text)] font-semibold user-email-placeholder break-all">
                {email || 'địa chỉ email của bạn'}
              </strong>
              {' đã được xác minh thành công trước đó. Bạn không cần xác minh lại địa chỉ email này.'}
            </>
          ),
          body: (
            <section
              id="view-verify-used"
              className="v3-space-y-6"
              aria-labelledby="planora-auth-title"
            >
              <div className="flex items-center justify-center my-2">
                <div className="w-14 h-14 rounded-2xl bg-[var(--planora-surface-inset)] text-[var(--planora-primary)] border border-[var(--planora-divider)] flex items-center justify-center shadow-sm">
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
              </div>

              <div className="planora-auth-info-card">
                <div className="flex items-center justify-between text-xs border-b border-[var(--planora-divider)] pb-3">
                  <span className="text-[var(--planora-muted)]">Trạng thái tài khoản:</span>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[var(--planora-pending-bg)] text-[var(--planora-pending-text)] border border-[var(--planora-pending-border)]">
                    Đang chờ duyệt
                  </span>
                </div>
                <p className="text-xs text-[var(--planora-muted)] leading-relaxed m-0">
                  Yêu cầu của bạn hiện đang chờ Quản trị viên nhóm xem xét và cấp quyền. Ngay sau khi
                  được phê duyệt, hệ thống sẽ gửi email kèm thông tin bắt đầu sử dụng.
                </p>
              </div>

              <div className="v3-space-y-2.5 pt-1">
                <a onClick={followLink} href="/" className="planora-auth-submit">
                  <span>Đăng nhập hoặc về trang chủ</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M14 5l7 7m0 0l-7 7m7-7H3"
                    />
                  </svg>
                </a>
                <a
                  onClick={followLink}
                  href="/login"
                  className="planora-auth-link-btn"
                  style={{ justifyContent: 'center', width: '100%' }}
                >
                  Thử đăng nhập lại
                </a>
              </div>
            </section>
          ),
        };

      case 'reset-password':
        return {
          badge: 'Bảo mật tài khoản',
          title: 'Tạo mật khẩu mới',
          subtitle: (
            <>
              {'Đặt mật khẩu mới cho tài khoản '}
              <strong className="text-[var(--planora-text)] user-email-placeholder break-all">
                {email || 'địa chỉ email của bạn'}
              </strong>
              {'.'}
            </>
          ),
          body: (
            <section
              id="view-reset-password"
              className="v3-space-y-6"
              aria-labelledby="planora-auth-title"
            >
              <div className="flex items-center justify-center my-2">
                <div className="w-14 h-14 rounded-2xl bg-[var(--planora-primary-soft)] text-[var(--planora-primary)] border border-[var(--planora-divider)] flex items-center justify-center shadow-sm">
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                    />
                  </svg>
                </div>
              </div>

              <form
                id="form-reset-password"
                onSubmit={actions.handleResetPasswordSubmit}
                className="v3-space-y-4"
              >
                <div className="planora-auth-field">
                  <label
                    htmlFor="new-password-input"
                    className="block text-xs font-semibold text-[var(--planora-text)] uppercase tracking-wider mb-1.5"
                  >
                    Mật khẩu mới
                  </label>
                  <div className="planora-auth-input-wrapper">
                    <input
                      ref={newPasswordRef}
                      type={visible['new-password-input'] ? 'text' : 'password'}
                      id="new-password-input"
                      aria-label="Mật khẩu mới"
                      autoComplete="new-password"
                      maxLength={128}
                      required
                      minLength={12}
                      placeholder="Ít nhất 12 ký tự"
                      onInput={event => actions.validatePasswordStrength(event.currentTarget.value)}
                      className="planora-auth-input"
                    />
                    <button
                      type="button"
                      onClick={() => actions.togglePasswordVisibility('new-password-input')}
                      className="planora-auth-password-toggle"
                      aria-label="Ẩn hiện mật khẩu"
                    >
                      <svg
                        id="icon-eye-new"
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        {visible['new-password-input'] ? eyeClosed : eyeOpen}
                      </svg>
                    </button>
                  </div>

                  <div className="mt-2 v3-space-y-1">
                    <div className="planora-strength-bars">
                      <div id="strength-bar-1" className={power.bars[0]} />
                      <div id="strength-bar-2" className={power.bars[1]} />
                      <div id="strength-bar-3" className={power.bars[2]} />
                      <div id="strength-bar-4" className={power.bars[3]} />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-[var(--planora-muted)]">
                      <span
                        id="strength-text"
                        className={strengthTouched ? power.className : undefined}
                      >
                        {power.text}
                      </span>
                      <span>Độ an toàn</span>
                    </div>
                  </div>
                </div>

                <div className="planora-auth-field">
                  <label
                    htmlFor="confirm-password-input"
                    className="block text-xs font-semibold text-[var(--planora-text)] uppercase tracking-wider mb-1.5"
                  >
                    Xác nhận mật khẩu mới
                  </label>
                  <div className="planora-auth-input-wrapper">
                    <input
                      ref={confirmPasswordRef}
                      type={visible['confirm-password-input'] ? 'text' : 'password'}
                      id="confirm-password-input"
                      aria-label="Nhập lại mật khẩu"
                      autoComplete="new-password"
                      maxLength={128}
                      required
                      minLength={12}
                      placeholder="Nhập lại mật khẩu mới"
                      onInput={actions.checkPasswordMatch}
                      className="planora-auth-input"
                    />
                    <button
                      type="button"
                      onClick={() => actions.togglePasswordVisibility('confirm-password-input')}
                      className="planora-auth-password-toggle"
                      aria-label="Ẩn hiện mật khẩu xác nhận"
                    >
                      <svg
                        id="icon-eye-confirm"
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        {visible['confirm-password-input'] ? eyeClosed : eyeOpen}
                      </svg>
                    </button>
                  </div>
                  <div id="password-match-msg" className={matchMessage.className}>
                    {matchMessage.text}
                  </div>
                </div>

                <button
                  type="submit"
                  id="btn-submit-reset-password"
                  aria-label="Đặt lại mật khẩu"
                  className="planora-auth-submit"
                  disabled={resetBusy}
                >
                  {resetBusy ? (
                    <>
                      {spinner}
                      <span>Đang lưu mật khẩu…</span>
                    </>
                  ) : (
                    <>
                      <span>Cập nhật mật khẩu</span>
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    </>
                  )}
                </button>
              </form>

              <div className="text-[11px] text-[var(--planora-muted)] text-center leading-relaxed v3-space-y-1">
                <p className="font-medium text-[var(--planora-text)] m-0">
                  Link đặt lại mật khẩu có hiệu lực 30 phút và chỉ dùng được một lần.
                </p>
                <p className="m-0">
                  Sau khi đổi mật khẩu, bạn sẽ dùng mật khẩu mới này để đăng nhập vào Planora trên
                  mọi thiết bị.
                </p>
              </div>
            </section>
          ),
        };

      case 'reset-success':
        return {
          badge: 'Cập nhật thành công',
          title: 'Mật khẩu đã được thay đổi',
          subtitle: (
            <>
              {'Mật khẩu mới của tài khoản '}
              <strong className="text-[var(--planora-text)] user-email-placeholder break-all">
                {email || 'địa chỉ email của bạn'}
              </strong>
              {' đã được lưu thành công. Các phiên làm việc cũ đã được thu hồi an toàn.'}
            </>
          ),
          body: (
            <section
              id="view-reset-success"
              className="v3-space-y-6"
              aria-labelledby="planora-auth-title"
            >
              <div className="flex items-center justify-center my-2">
                <div className="w-14 h-14 rounded-2xl bg-[var(--planora-success-bg)] text-[var(--planora-success-text)] border border-[var(--planora-success-border)] flex items-center justify-center shadow-sm">
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2.5"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
              </div>

              <div className="planora-auth-info-card text-xs text-[var(--planora-text)]">
                <div className="font-semibold text-[var(--planora-text)] flex items-center gap-1.5">
                  <svg
                    className="w-4 h-4 text-[var(--planora-primary)]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                    />
                  </svg>
                  <span>Bảo vệ phiên đăng nhập</span>
                </div>
                <p className="text-[var(--planora-muted)] leading-relaxed m-0">
                  Để bảo vệ an toàn cho bạn, mọi thiết bị đăng nhập trước đó đã được tự động đăng
                  xuất. Các thiết bị khác đã được đăng xuất an toàn. Vui lòng đăng nhập lại bằng mật
                  khẩu vừa tạo.
                </p>
              </div>

              <div className="v3-space-y-2.5 pt-1">
                <a onClick={followLink} href="/login" className="planora-auth-submit">
                  <span>Đăng nhập ngay</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M14 5l7 7m0 0l-7 7m7-7H3"
                    />
                  </svg>
                </a>
                <a
                  onClick={followLink}
                  href="/"
                  className="planora-auth-link-btn"
                  style={{ justifyContent: 'center', width: '100%' }}
                >
                  Về trang chủ Planora
                </a>
              </div>
            </section>
          ),
        };

      case 'google-pending':
        return {
          badge: 'Đăng ký với Google · Chờ phê duyệt',
          title: 'Đang chờ quản trị viên duyệt',
          subtitle: (
            <>
              {'Tài khoản Google '}
              <strong className="text-[var(--planora-text)] font-semibold user-email-placeholder break-all">
                {email || 'địa chỉ email của bạn'}
              </strong>
              {' đã được kết nối an toàn với nền tảng Planora.'}
            </>
          ),
          body: (
            <section
              id="view-google-pending"
              className="v3-space-y-6"
              aria-labelledby="planora-auth-title"
            >
              <div className="flex items-center justify-center my-2">
                <div className="w-14 h-14 rounded-2xl bg-[var(--planora-paper)] border border-[var(--planora-divider)] flex items-center justify-center shadow-sm">
                  <svg className="w-7 h-7" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.34 24 12 24z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                    />
                  </svg>
                </div>
              </div>

              <div className="planora-auth-info-card">
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--planora-text)]">
                  <svg
                    className="w-4 h-4 text-[var(--planora-pending-text)]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                  <span>Quy định an toàn của nhóm</span>
                </div>
                <p className="text-xs text-[var(--planora-muted)] leading-relaxed m-0">
                  {'Theo quy định bảo mật của nhóm, mọi tài khoản mới (kể cả đăng ký bằng Google) đều cần '}
                  <strong className="text-[var(--planora-text)]">Quản trị viên phê duyệt</strong>
                  {' trước khi có thể truy cập các công cụ kết nối dùng chung.'}
                </p>
                <div className="pt-2 border-t border-[var(--planora-divider)] text-xs text-[var(--planora-muted)] v3-space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--planora-primary)]" />
                    <span>
                      {'Thông tin Google đã được ghi nhận: '}
                      <span className="font-medium text-[var(--planora-text)] user-name-placeholder">
                        {name || 'Bạn'}
                      </span>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--planora-pending-text)]" />
                    <span>Hệ thống sẽ gửi email cho bạn ngay khi quản trị viên phê duyệt.</span>
                  </div>
                  <div className="pt-1">
                    <a
                      onClick={followLink}
                      href="/privacy#google-oauth"
                      className="planora-auth-link-btn text-[11px]"
                    >
                      <span>Xem chính sách dữ liệu tài khoản Google</span>
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                      </svg>
                    </a>
                  </div>
                </div>
              </div>

              <div className="v3-space-y-2.5 pt-1">
                <a onClick={followLink} href="/login" className="planora-auth-submit">
                  <span>Thử đăng nhập lại</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M14 5l7 7m0 0l-7 7m7-7H3"
                    />
                  </svg>
                </a>
                <a
                  onClick={followLink}
                  href="/"
                  className="planora-auth-link-btn"
                  style={{ justifyContent: 'center', width: '100%' }}
                >
                  Về trang chủ Planora
                </a>
              </div>
            </section>
          ),
        };

      case 'google-ready':
        return {
          badge: 'Đăng nhập thành công',
          title: 'Đang vào không gian làm việc…',
          subtitle: (
            <>
              {'Chào mừng bạn quay lại, '}
              <strong className="text-[var(--planora-text)] font-semibold user-name-placeholder">
                {name || 'Bạn'}
              </strong>
              {'!'}
            </>
          ),
          body: (
            <section
              id="view-google-ready"
              className="v3-space-y-6"
              aria-labelledby="planora-auth-title"
            >
              <div className="flex items-center justify-center my-2">
                <div className="w-14 h-14 rounded-2xl bg-[var(--planora-paper)] border border-[var(--planora-divider)] flex items-center justify-center shadow-sm relative">
                  <svg className="w-7 h-7" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.34 24 12 24z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                    />
                  </svg>
                  <span className="absolute -top-1 -right-1 flex h-4 w-4">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--planora-primary)] opacity-75" />
                    <span className="relative inline-flex rounded-full h-4 w-4 bg-[var(--planora-primary)] text-[9px] text-[var(--planora-on-primary)] font-bold items-center justify-center">
                      ✓
                    </span>
                  </span>
                </div>
              </div>

              <div className="planora-auth-info-card flex items-center justify-center gap-3 text-sm font-medium text-[var(--planora-muted)] py-6">
                <div className="w-5 h-5 border-2 border-[var(--planora-divider)] border-t-[var(--planora-primary)] rounded-full animate-spin" />
                <span>Đang vào không gian làm việc…</span>
              </div>

              <div className="v3-space-y-2.5 pt-1">
                <a onClick={followLink} href="/" className="planora-auth-submit">
                  <span>Vào ngay</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M14 5l7 7m0 0l-7 7m7-7H3"
                    />
                  </svg>
                </a>
              </div>
            </section>
          ),
        };

      case 'google-error':
        return {
          badge: 'Chưa hoàn tất',
          title: 'Đăng nhập Google chưa hoàn tất',
          subtitle:
            'Phiên xác thực với Google đã bị huỷ hoặc quyền truy cập chưa được cấp. Không có dữ liệu nào của bạn bị thay đổi.',
          body: (
            <section
              id="view-google-error"
              className="v3-space-y-6"
              aria-labelledby="planora-auth-title"
            >
              <div className="flex items-center justify-center my-2">
                <div className="w-14 h-14 rounded-2xl bg-[var(--planora-error-bg)] text-[var(--planora-error-text)] border border-[var(--planora-error-border)] flex items-center justify-center shadow-sm">
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                </div>
              </div>

              <div className="planora-auth-info-card text-xs text-[var(--planora-text)]">
                <div className="font-semibold text-[var(--planora-text)]">
                  Bạn có thể chọn một trong các cách sau:
                </div>
                <ul className="list-disc list-inside v3-space-y-1 text-[var(--planora-muted)] pl-1 m-0">
                  <li>Bấm thử lại để kết nối lại tài khoản Google.</li>
                  <li>Đăng nhập bằng Email và Mật khẩu truyền thống.</li>
                  <li>Quay về trang chủ nếu bạn chưa muốn đăng nhập lúc này.</li>
                </ul>
              </div>

              <div className="v3-space-y-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => navigate('/login')}
                  className="planora-auth-submit"
                >
                  <span>Thử lại với Google</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                </button>
                <a
                  onClick={followLink}
                  href="/login"
                  className="planora-auth-link-btn"
                  style={{ justifyContent: 'center', width: '100%' }}
                >
                  Đăng nhập bằng Email &amp; Mật khẩu
                </a>
              </div>
            </section>
          ),
        };

      case 'blocked-pending':
        return {
          badge: 'Đăng nhập tạm thời bị chặn · Đang chờ duyệt',
          title: 'Tài khoản đang chờ duyệt',
          subtitle: (
            <>
              {'Tài khoản '}
              <strong className="text-[var(--planora-text)] font-semibold user-email-placeholder break-all">
                {email || 'địa chỉ email của bạn'}
              </strong>
              {' chưa được kích hoạt vào không gian làm việc. Hãy xác minh email và chờ quản trị viên duyệt.'}
            </>
          ),
          body: (
            <section
              id="view-blocked-pending"
              className="v3-space-y-6"
              aria-labelledby="planora-auth-title"
            >
              <div className="flex items-center justify-center my-2">
                <div className="w-14 h-14 rounded-2xl bg-[var(--planora-pending-bg)] text-[var(--planora-pending-text)] border border-[var(--planora-pending-border)] flex items-center justify-center shadow-sm">
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
              </div>

              <div className="planora-auth-info-card">
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--planora-text)]">
                  <svg
                    className="w-4 h-4 text-[var(--planora-pending-text)]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                    />
                  </svg>
                  <span>Quy trình bảo vệ không gian làm việc</span>
                </div>
                <p className="text-xs text-[var(--planora-muted)] leading-relaxed m-0">
                  {'Planora điều phối trực tiếp các công cụ dùng chung của nhóm (Trello, Slack, GitHub, Google Sheets). Để bảo đảm an toàn dữ liệu, tài khoản cần được '}
                  <strong className="text-[var(--planora-text)]">Quản trị viên nhóm xem xét và phê duyệt</strong>
                  {' trước khi đăng nhập.'}
                </p>

                <div className="pt-2 border-t border-[var(--planora-divider)] v3-space-y-2 text-xs">
                  <div className="flex items-center justify-between text-[var(--planora-primary)] bg-[var(--planora-surface-hover)] p-2.5 rounded-xl border border-[var(--planora-divider)]">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-[var(--planora-primary-soft)] flex items-center justify-center font-bold text-[11px] text-[var(--planora-primary)]">
                        1
                      </span>
                      <span className="font-medium text-[var(--planora-text)]">
                        1. Đăng ký &amp; xác thực email
                      </span>
                    </div>
                    <span className="text-[11px] font-semibold text-[var(--planora-primary)]">
                      Nếu chưa hoàn tất
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[var(--planora-pending-text)] bg-[var(--planora-pending-bg)] p-2.5 rounded-xl border border-[var(--planora-pending-border)]">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-[var(--planora-paper)] flex items-center justify-center font-bold text-[11px] text-[var(--planora-pending-text)]">
                        ⏳
                      </span>
                      <span className="font-medium text-[var(--planora-pending-text)]">
                        2. Quản trị viên duyệt tài khoản
                      </span>
                    </div>
                    <span className="text-[11px] font-semibold text-[var(--planora-pending-text)]">
                      Đang chờ duyệt
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[var(--planora-muted)] bg-[var(--planora-paper)] p-2.5 rounded-xl border border-[var(--planora-divider)]">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-[var(--planora-surface-hover)] flex items-center justify-center font-bold text-[11px] text-[var(--planora-muted)]">
                        3
                      </span>
                      <span className="font-medium text-[var(--planora-muted)]">
                        3. Nhận email thông báo &amp; vào làm việc
                      </span>
                    </div>
                    <span className="text-[11px] font-semibold text-[var(--planora-muted)]">
                      Chờ kích hoạt
                    </span>
                  </div>
                </div>
              </div>

              <div className="v3-space-y-2.5 pt-1">
                <a onClick={followLink} href="/login" className="planora-auth-submit">
                  <span>Thử đăng nhập lại</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M14 5l7 7m0 0l-7 7m7-7H3"
                    />
                  </svg>
                </a>
                <a
                  onClick={followLink}
                  href="/"
                  className="planora-auth-link-btn"
                  style={{ justifyContent: 'center', width: '100%' }}
                >
                  ← Về trang chủ
                </a>
              </div>
            </section>
          ),
        };

      case 'blocked-locked':
        return {
          badge: 'Đăng nhập bị từ chối · Tài khoản bị khóa',
          title: 'Tài khoản đã bị tạm khóa',
          subtitle: (
            <>
              {'Quyền truy cập của '}
              <strong className="text-[var(--planora-text)] font-semibold user-email-placeholder break-all">
                {email || 'địa chỉ email của bạn'}
              </strong>
              {' vào không gian làm việc đã bị tạm dừng bởi quản trị viên.'}
            </>
          ),
          body: (
            <section
              id="view-blocked-locked"
              className="v3-space-y-6"
              aria-labelledby="planora-auth-title"
            >
              <div className="flex items-center justify-center my-2">
                <div className="w-14 h-14 rounded-2xl bg-[var(--planora-error-bg)] text-[var(--planora-error-text)] border border-[var(--planora-error-border)] flex items-center justify-center shadow-sm">
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                    />
                  </svg>
                </div>
              </div>

              <div className="planora-auth-info-card">
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--planora-error-text)]">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <span>Thông tin an toàn tài khoản</span>
                </div>
                <div className="v3-space-y-2 pt-2 border-t border-[var(--planora-divider)] text-xs text-[var(--planora-muted)]">
                  <div className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--planora-error-text)] mt-1.5 flex-shrink-0" />
                    <span>Mọi phiên đăng nhập trước đó trên các thiết bị đã được tự động thu hồi.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--planora-error-text)] mt-1.5 flex-shrink-0" />
                    <span>Các yêu cầu tự động trên Trello, Slack, GitHub dưới tên tài khoản này đều bị từ chối.</span>
                  </div>
                </div>
                <div className="pt-3 border-t border-[var(--planora-divider)] text-xs text-[var(--planora-text)] flex items-center gap-2">
                  <svg className="w-4 h-4 text-[var(--planora-primary)] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <span>Hãy liên hệ quản trị viên của nhóm để được mở khoá.</span>
                </div>
              </div>

              <div className="v3-space-y-2.5 pt-1">
                <a onClick={followLink} href="/login" className="planora-auth-submit">
                  <span>Đăng nhập bằng tài khoản khác</span>
                </a>
                <a
                  onClick={followLink}
                  href="/"
                  className="planora-auth-link-btn"
                  style={{ justifyContent: 'center', width: '100%' }}
                >
                  Quay về trang chủ
                </a>
              </div>
            </section>
          ),
        };

      case 'blocked-attempts':
        return {
          badge: 'Bảo vệ tài khoản · Tạm khóa 15 phút',
          title: 'Sai mật khẩu quá nhiều lần',
          subtitle: (
            <>
              {'Tài khoản '}
              <strong className="text-[var(--planora-text)] font-semibold user-email-placeholder break-all">
                {email || 'địa chỉ email của bạn'}
              </strong>
              {' đã nhập sai mật khẩu '}
              <span className="font-semibold text-[var(--planora-error-text)]">
                5 lần liên tiếp
              </span>
              {'. Đăng nhập tạm thời bị khóa để ngăn ngừa tấn công dò mật khẩu.'}
            </>
          ),
          body: (
            <section
              id="view-blocked-attempts"
              className="v3-space-y-6"
              aria-labelledby="planora-auth-title"
            >
              <div className="flex items-center justify-center my-2">
                <div className="w-14 h-14 rounded-2xl bg-[var(--planora-pending-bg)] text-[var(--planora-pending-text)] border border-[var(--planora-pending-border)] flex items-center justify-center shadow-sm">
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                </div>
              </div>

              <div className="planora-auth-info-card">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[var(--planora-text)]">
                    Thời gian tự động mở khóa:
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[var(--planora-pending-bg)] text-[var(--planora-pending-text)] border border-[var(--planora-pending-border)]">
                    Tự mở khóa
                  </span>
                </div>

                <div className="planora-blocked-timer-container">
                  <div
                    id="blocked-timer-display"
                    className={`planora-blocked-timer-display${blockedDone ? ' timer-done' : ''}`}
                  >
                    {blockedText}
                  </div>
                  <p className="text-[11px] text-[var(--planora-muted)] mt-1 m-0">
                    phút : giây
                  </p>
                </div>

                <div className="planora-blocked-timer-bar-wrapper">
                  <div
                    id="blocked-timer-bar"
                    className="planora-blocked-timer-bar"
                    style={{ width: blockedWidth }}
                  />
                </div>

                <p className="text-[11px] text-[var(--planora-muted)] text-center m-0">
                  Sau khi hết thời gian đếm ngược, bạn có thể thử nhập lại mật khẩu bình thường.
                </p>
              </div>

              <div className="planora-auth-info-card border-[var(--planora-pending-border)] bg-[var(--planora-pending-bg)] text-[var(--planora-pending-text)]">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <svg className="w-4 h-4 text-[var(--planora-pending-text)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
                    />
                  </svg>
                  <span>Bạn quên mật khẩu?</span>
                </div>
                <p className="text-xs leading-relaxed m-0">
                  Bạn vẫn có thể đặt lại mật khẩu qua email ngay bây giờ, nhưng cần chờ hết thời gian trên rồi mới đăng nhập lại được.
                </p>
                <button
                  type="button"
                  onClick={() => navigate('/forgot-password')}
                  className="planora-auth-submit"
                >
                  <span>Đặt lại mật khẩu mới qua email</span>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </button>
              </div>

              <div className="v3-space-y-2 pt-1 text-center">
                <a
                  onClick={followLink}
                  href="/login"
                  className="planora-auth-link-btn"
                  style={{ justifyContent: 'center' }}
                >
                  ← Quay lại trang đăng nhập (thử lại sau)
                </a>
              </div>
            </section>
          ),
        };
    }
  };

  const currentConfig = getModeConfig();

  const footer = (
    <footer className="planora-auth-footer mt-8 text-center text-xs text-[var(--planora-muted)] v3-space-y-2">
      <p className="m-0">
        Planora — Nền tảng điều phối luồng làm việc AI · 2026 · Xác thực tài khoản và phân quyền quản trị
      </p>
      <div className="planora-auth-footer-links flex flex-wrap items-center justify-center gap-x-2 text-xs text-[var(--planora-muted)]">
        <a
          onClick={followLink}
          href="/"
          className="planora-auth-footer-link inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-2 py-2 hover:text-[var(--planora-text)] transition-colors"
        >
          Trang chủ
        </a>
        <span className="text-[var(--planora-divider)] select-none" aria-hidden="true">·</span>
        <a
          onClick={followLink}
          href="/privacy"
          className="planora-auth-footer-link inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-2 py-2 text-[var(--planora-primary)] hover:underline font-medium transition-colors"
        >
          Chính sách an toàn &amp; Dữ liệu
        </a>
      </div>
    </footer>
  );

  return (
    <PlanoraAuthFrame
      title={currentConfig.title}
      subtitle={currentConfig.subtitle}
      badge={currentConfig.badge}
      onClose={() => navigate('/')}
      footer={footer}
      cardId="action-card"
    >
      {busy && mode === 'loading' && (
        <p role="status" className="planora-auth-loading-text">
          {spinner}
          <span>Đang xác minh tài khoản…</span>
        </p>
      )}
      {error && (
        <p role="alert" className="planora-auth-error">
          {error}
        </p>
      )}
      {message && mode !== 'verify-expired' && mode !== 'email-not-verified' && (
        <p role="status" className="planora-auth-success">
          {message}
        </p>
      )}
      {onAccount && (
        <button
          type="button"
          onClick={onAccount}
          className="planora-auth-submit w-full mb-4"
        >
          Về trang tài khoản
        </button>
      )}
      {currentConfig.body}
    </PlanoraAuthFrame>
  );
}
