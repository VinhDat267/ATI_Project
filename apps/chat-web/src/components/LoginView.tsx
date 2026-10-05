import React from 'react';
import { GoogleAuthButton } from './GoogleAuthButton';

export interface LoginViewProps {
  email: string;
  setEmail: (val: string) => void;
  password: string;
  setPassword: (val: string) => void;
  isLoggingIn: boolean;
  authError: string | null;
  onLogin: (e: React.FormEvent<HTMLFormElement>) => void | Promise<void>;
  onQuickFillDemo?: () => void;
  onBackToLanding?: () => void;
  authConfig?: { signupEnabled: boolean; googleEnabled: boolean };
  onSignup?: () => void;
  onForgotPassword?: () => void;
  onResendVerification?: () => void;
}

export const LoginView: React.FC<LoginViewProps> = ({
  email,
  setEmail,
  password,
  setPassword,
  isLoggingIn,
  authError,
  onLogin,
  onQuickFillDemo,
  onBackToLanding,
  authConfig,
  onSignup,
  onForgotPassword,
  onResendVerification,
}) => {
  const demoEmail = import.meta.env.VITE_DEMO_EMAIL;
  const demoPassword = import.meta.env.VITE_DEMO_PASSWORD;
  const showDemo = import.meta.env.DEV && import.meta.env.VITE_SHOW_DEMO_LOGIN === 'true' &&
    Boolean(demoEmail && demoPassword);

  const handleQuickFill = () => {
    if (onQuickFillDemo) {
      onQuickFillDemo();
    } else {
      setEmail(demoEmail);
      setPassword(demoPassword);
    }
  };

  return (
    <main className="min-h-screen lg:h-screen w-full flex flex-col justify-between items-center bg-surface-inset text-text font-sans p-6 sm:p-8 relative overflow-hidden">
      {/* Hiệu ứng ánh sáng nền ambient nhẹ nhàng đồng nhất toàn trang */}
      <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[46rem] h-[24rem] bg-gradient-to-b from-primary via-primary to-transparent rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-24 left-1/2 -translate-x-1/2 w-[40rem] h-[20rem] bg-gradient-to-t from-primary via-cyan-400/5 to-transparent rounded-full blur-3xl pointer-events-none" />

      {/* 1. Phần Đầu trang: Nhận diện Thương hiệu & Định vị Nền tảng */}
      <header className="relative z-10 flex flex-col items-center text-center max-w-2xl mx-auto pt-2 sm:pt-4">
        {onBackToLanding && (
          <button
            type="button"
            onClick={onBackToLanding}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium text-text-muted hover:text-primary-text bg-surface hover:bg-surface border border-border shadow-2xs transition-all mb-3 cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            <span>Quay lại trang giới thiệu</span>
          </button>
        )}
        <div className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-surface border border-border shadow-xs backdrop-blur-md text-xs font-medium text-text-secondary mb-3">
          <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
          <span className="font-semibold text-text">AI Workflow Automation Platform</span>
          <span className="px-1.5 py-0.5 rounded-md bg-primary-tint text-sm text-primary-text border border-border font-semibold tracking-wider uppercase">
            Đa Dịch Vụ
          </span>
        </div>

        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-text leading-tight">
          Nền tảng Tự động hóa Quy trình Đa Dịch vụ
        </h1>
        <p className="mt-2 text-xs sm:text-sm text-text-muted max-w-lg leading-relaxed">
          Điều phối thông minh xuyên suốt toàn bộ hệ sinh thái công cụ làm việc của doanh nghiệp chỉ với một câu lệnh.
        </p>
      </header>

      {/* 2. Phần Thẻ Đăng nhập Trung tâm: Sang trọng, Sạch sẽ, Cân đối */}
      <div className="relative z-10 w-full max-w-md my-auto py-2">
        <div className="w-full bg-surface rounded-3xl border border-border shadow-2xl shadow-blue-900/5 backdrop-blur-xl p-7 sm:p-9 flex flex-col gap-5">
          {/* Header Form */}
          <div className="flex flex-col items-center text-center gap-1.5">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-primary-tint to-primary-tint text-primary-text flex items-center justify-center font-bold text-sm shadow-md shadow-blue-500/25 mb-1">
              AI
            </div>
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-text">
              Chào mừng trở lại
            </h2>
            <p className="text-xs text-text-muted">
              Đăng nhập để bắt đầu điều phối quy trình tự động hóa của bạn
            </p>
          </div>

          {/* Form nhập liệu */}
          <form onSubmit={onLogin} className="flex flex-col gap-4">
            {/* Email Field */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="login-email" className="text-xs font-semibold text-text-secondary tracking-wide text-left">
                Email
              </label>
              <div className="relative flex items-center">
                <div className="absolute left-3.5 text-text-muted pointer-events-none">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.206" />
                  </svg>
                </div>
                <input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  autoComplete="username"
                  placeholder="name@company.com"
                  className="w-full pl-10 pr-4 py-2.5 bg-surface-inset border border-border rounded-xl text-text placeholder:text-text-muted text-sm focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-border-strong transition-all"
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="login-password" className="text-xs font-semibold text-text-secondary tracking-wide text-left">
                Mật khẩu
              </label>
              <div className="relative flex items-center">
                <div className="absolute left-3.5 text-text-muted pointer-events-none">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <input
                  id="login-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••••••"
                  className="w-full pl-10 pr-4 py-2.5 bg-surface-inset border border-border rounded-xl text-text placeholder:text-text-muted text-sm focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-border-strong transition-all"
                />
              </div>
            </div>

            {/* Error Message Alert */}
            {authError && (
              <div
                role="alert"
                className="p-3 rounded-xl bg-danger-tint border border-border text-danger-text text-xs flex items-start gap-2 animate-fadeIn"
              >
                <svg className="w-4 h-4 shrink-0 mt-0.5 text-danger-text" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="leading-tight text-left">
                  {authError.toLowerCase().includes('invalid email or password')
                    ? 'Email hoặc mật khẩu không chính xác.'
                    : authError}
                </span>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoggingIn}
              className="mt-1 w-full py-2.5 px-4 bg-primary hover:bg-primary active:bg-primary text-white font-medium text-sm rounded-xl shadow-md shadow-blue-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
            >
              {isLoggingIn ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>Đang đăng nhập...</span>
                </>
              ) : (
                <>
                  <span>Đăng nhập</span>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </>
              )}
            </button>
          </form>

          <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs text-primary-text">
            {onForgotPassword && <button type="button" className="hover:underline" onClick={onForgotPassword}>Quên mật khẩu?</button>}
            {onResendVerification && <button type="button" className="hover:underline" onClick={onResendVerification}>Gửi lại email xác minh</button>}
          </div>
          {authConfig?.signupEnabled && onSignup && <button type="button" className="text-sm text-primary-text hover:underline" onClick={onSignup}>Tạo tài khoản</button>}
          {authConfig?.googleEnabled && <GoogleAuthButton disabled={isLoggingIn} />}

          {/* Quick-Fill Admin Helper for Local Testing (Only in sandbox/dev mode) */}
          {showDemo && (
            <div className="pt-3.5 border-t border-border flex flex-col gap-2">
              <button
                type="button"
                onClick={handleQuickFill}
                className="w-full py-2.5 px-3 rounded-xl border border-dashed border-border-strong hover:border-border-strong bg-primary-tint hover:bg-primary-tint text-primary-text transition-all text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer group shadow-2xs"
              >
                <svg className="w-4 h-4 text-primary-text group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
                <span>Điền nhanh tài khoản demo</span>
              </button>
              <div className="p-3 rounded-2xl bg-surface-inset border border-border text-sm flex flex-col gap-2 text-left">
                <div className="flex items-center gap-1.5 font-medium text-text-secondary">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
                  <span>Tài khoản Quản trị viên thử nghiệm:</span>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between px-2.5 py-1.5 bg-surface rounded-xl border border-border shadow-2xs">
                    <span className="text-text-muted font-medium text-sm">Email</span>
                    <code className="font-mono text-text font-semibold select-all text-sm">
                      {demoEmail}
                    </code>
                  </div>
                  <div className="flex items-center justify-between px-2.5 py-1.5 bg-surface rounded-xl border border-border shadow-2xs">
                    <span className="text-text-muted font-medium text-sm">Mật khẩu</span>
                    <code className="font-mono text-text font-semibold select-all text-sm">
                      {demoPassword}
                    </code>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 3. Phần Chân trang: Hệ sinh thái Đa Dịch vụ & Cam kết Giá trị */}
      <footer className="relative z-10 w-full max-w-4xl mx-auto flex flex-col items-center text-center gap-2.5 pb-2 sm:pb-3">
        {/* Badges Hệ sinh thái */}
        <div className="flex flex-wrap items-center justify-center gap-1.5 text-xs text-text-muted">
          <span className="text-sm font-medium text-text-muted mr-1">Tích hợp &amp; mở rộng:</span>
          <span className="px-2.5 py-1 rounded-lg bg-surface border border-border text-sm font-medium text-text-secondary shadow-2xs">GitHub</span>
          <span className="px-2.5 py-1 rounded-lg bg-surface border border-border text-sm font-medium text-text-secondary shadow-2xs">Trello</span>
          <span className="px-2.5 py-1 rounded-lg bg-surface border border-border text-sm font-medium text-text-secondary shadow-2xs">Slack</span>
          <span className="px-2.5 py-1 rounded-lg bg-surface border border-border text-sm font-medium text-text-secondary shadow-2xs">Google Sheets</span>
          <span className="px-2.5 py-1 rounded-lg bg-surface border border-border text-sm font-medium text-text-secondary shadow-2xs">Jira</span>
          <span className="px-2.5 py-1 rounded-lg bg-surface border border-border text-sm font-medium text-text-secondary shadow-2xs">Notion</span>
          <span className="px-2.5 py-1 rounded-lg bg-primary-tint text-sm font-semibold text-primary-text border border-border">
            + Mở rộng không giới hạn
          </span>
        </div>

        {/* 3 cam kết nhỏ gọn */}
        <div className="flex flex-wrap items-center justify-center gap-4 text-sm text-text-muted">
          <span className="flex items-center gap-1">
            <span className="text-primary-text">⚡</span> Năng suất vượt trội
          </span>
          <span className="w-1 h-1 rounded-full bg-surface-raised" />
          <span className="flex items-center gap-1">
            <span className="text-success-text">🛡️</span> Phê duyệt lệnh ghi trước khi chạy
          </span>
          <span className="w-1 h-1 rounded-full bg-surface-raised" />
          <span className="flex items-center gap-1">
            <span className="text-primary-text">🧩</span> Kiến trúc mở cho doanh nghiệp
          </span>
        </div>
      </footer>
    </main>
  );
};
