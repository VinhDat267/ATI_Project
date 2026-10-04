import React from 'react';

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
  onGoogleLogin?: () => void;
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
  onGoogleLogin,
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
    <main className="min-h-screen lg:h-screen w-full flex flex-col justify-between items-center bg-[#f8fafc] text-zinc-900 font-sans p-6 sm:p-8 relative overflow-hidden">
      {/* Hiệu ứng ánh sáng nền ambient nhẹ nhàng đồng nhất toàn trang */}
      <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[46rem] h-[24rem] bg-gradient-to-b from-blue-500/10 via-indigo-400/5 to-transparent rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-24 left-1/2 -translate-x-1/2 w-[40rem] h-[20rem] bg-gradient-to-t from-blue-500/8 via-cyan-400/5 to-transparent rounded-full blur-3xl pointer-events-none" />

      {/* 1. Phần Đầu trang: Nhận diện Thương hiệu & Định vị Nền tảng */}
      <header className="relative z-10 flex flex-col items-center text-center max-w-2xl mx-auto pt-2 sm:pt-4">
        {onBackToLanding && (
          <button
            type="button"
            onClick={onBackToLanding}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium text-zinc-500 hover:text-blue-600 bg-white/70 hover:bg-white border border-zinc-200/80 shadow-2xs transition-all mb-3 cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            <span>Quay lại trang giới thiệu</span>
          </button>
        )}
        <div className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-white/80 border border-zinc-200/80 shadow-xs backdrop-blur-md text-xs font-medium text-zinc-700 mb-3">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="font-semibold text-zinc-800">AI Workflow Automation Platform</span>
          <span className="px-1.5 py-0.5 rounded-md bg-blue-50 text-[10px] text-blue-700 border border-blue-200/60 font-semibold tracking-wider uppercase">
            Đa Dịch Vụ
          </span>
        </div>

        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-zinc-900 leading-tight">
          Nền tảng Tự động hóa Quy trình Đa Dịch vụ
        </h1>
        <p className="mt-2 text-xs sm:text-sm text-zinc-500 max-w-lg leading-relaxed">
          Điều phối thông minh xuyên suốt toàn bộ hệ sinh thái công cụ làm việc của doanh nghiệp chỉ với một câu lệnh.
        </p>
      </header>

      {/* 2. Phần Thẻ Đăng nhập Trung tâm: Sang trọng, Sạch sẽ, Cân đối */}
      <div className="relative z-10 w-full max-w-md my-auto py-2">
        <div className="w-full bg-white/95 rounded-3xl border border-zinc-200/90 shadow-2xl shadow-blue-900/5 backdrop-blur-xl p-7 sm:p-9 flex flex-col gap-5">
          {/* Header Form */}
          <div className="flex flex-col items-center text-center gap-1.5">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#0071e3] to-blue-500 text-white flex items-center justify-center font-bold text-sm shadow-md shadow-blue-500/25 mb-1">
              AI
            </div>
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-900">
              Chào mừng trở lại
            </h2>
            <p className="text-xs text-zinc-500">
              Đăng nhập để bắt đầu điều phối quy trình tự động hóa của bạn
            </p>
          </div>

          {/* Form nhập liệu */}
          <form onSubmit={onLogin} className="flex flex-col gap-4">
            {/* Email Field */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="login-email" className="text-xs font-semibold text-zinc-700 tracking-wide text-left">
                Email
              </label>
              <div className="relative flex items-center">
                <div className="absolute left-3.5 text-zinc-400 pointer-events-none">
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
                  className="w-full pl-10 pr-4 py-2.5 bg-zinc-50/80 border border-zinc-200 rounded-xl text-zinc-900 placeholder:text-zinc-400 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-[#0071e3] transition-all"
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="login-password" className="text-xs font-semibold text-zinc-700 tracking-wide text-left">
                Mật khẩu
              </label>
              <div className="relative flex items-center">
                <div className="absolute left-3.5 text-zinc-400 pointer-events-none">
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
                  className="w-full pl-10 pr-4 py-2.5 bg-zinc-50/80 border border-zinc-200 rounded-xl text-zinc-900 placeholder:text-zinc-400 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-[#0071e3] transition-all"
                />
              </div>
            </div>

            {/* Error Message Alert */}
            {authError && (
              <div
                role="alert"
                className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2 animate-fadeIn"
              >
                <svg className="w-4 h-4 shrink-0 mt-0.5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
              className="mt-1 w-full py-2.5 px-4 bg-[#0071e3] hover:bg-[#0077ed] active:bg-[#0062c4] text-white font-medium text-sm rounded-xl shadow-md shadow-blue-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
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

          <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs text-[#0071e3]">
            {onForgotPassword && <button type="button" className="hover:underline" onClick={onForgotPassword}>Quên mật khẩu?</button>}
            {onResendVerification && <button type="button" className="hover:underline" onClick={onResendVerification}>Gửi lại email xác minh</button>}
          </div>
          {authConfig?.signupEnabled && onSignup && <button type="button" className="text-sm text-[#0071e3] hover:underline" onClick={onSignup}>Tạo tài khoản</button>}
          {authConfig?.googleEnabled && onGoogleLogin && <button type="button" onClick={onGoogleLogin}>Đăng nhập bằng Google</button>}

          {/* Quick-Fill Admin Helper for Local Testing (Only in sandbox/dev mode) */}
          {showDemo && (
            <div className="pt-3.5 border-t border-zinc-100 flex flex-col gap-2">
              <button
                type="button"
                onClick={handleQuickFill}
                className="w-full py-2.5 px-3 rounded-xl border border-dashed border-blue-300 hover:border-blue-500 bg-blue-50/40 hover:bg-blue-50/80 text-blue-700 transition-all text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer group shadow-2xs"
              >
                <svg className="w-4 h-4 text-blue-500 group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
                <span>Điền nhanh tài khoản demo</span>
              </button>
              <div className="p-3 rounded-2xl bg-zinc-50/90 border border-zinc-200/80 text-[11px] flex flex-col gap-2 text-left">
                <div className="flex items-center gap-1.5 font-medium text-zinc-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                  <span>Tài khoản Quản trị viên thử nghiệm:</span>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between px-2.5 py-1.5 bg-white rounded-xl border border-zinc-200/70 shadow-2xs">
                    <span className="text-zinc-500 font-medium text-[11px]">Email</span>
                    <code className="font-mono text-zinc-800 font-semibold select-all text-[11px]">
                      {demoEmail}
                    </code>
                  </div>
                  <div className="flex items-center justify-between px-2.5 py-1.5 bg-white rounded-xl border border-zinc-200/70 shadow-2xs">
                    <span className="text-zinc-500 font-medium text-[11px]">Mật khẩu</span>
                    <code className="font-mono text-zinc-800 font-semibold select-all text-[11px]">
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
        <div className="flex flex-wrap items-center justify-center gap-1.5 text-xs text-zinc-500">
          <span className="text-[11px] font-medium text-zinc-500 mr-1">Tích hợp &amp; mở rộng:</span>
          <span className="px-2.5 py-1 rounded-lg bg-white border border-zinc-200/80 text-[11px] font-medium text-zinc-700 shadow-2xs">GitHub</span>
          <span className="px-2.5 py-1 rounded-lg bg-white border border-zinc-200/80 text-[11px] font-medium text-zinc-700 shadow-2xs">Trello</span>
          <span className="px-2.5 py-1 rounded-lg bg-white border border-zinc-200/80 text-[11px] font-medium text-zinc-700 shadow-2xs">Slack</span>
          <span className="px-2.5 py-1 rounded-lg bg-white border border-zinc-200/80 text-[11px] font-medium text-zinc-700 shadow-2xs">Google Sheets</span>
          <span className="px-2.5 py-1 rounded-lg bg-white border border-zinc-200/80 text-[11px] font-medium text-zinc-700 shadow-2xs">Jira</span>
          <span className="px-2.5 py-1 rounded-lg bg-white border border-zinc-200/80 text-[11px] font-medium text-zinc-700 shadow-2xs">Notion</span>
          <span className="px-2.5 py-1 rounded-lg bg-blue-50 text-[11px] font-semibold text-blue-700 border border-blue-200/70">
            + Mở rộng không giới hạn
          </span>
        </div>

        {/* 3 cam kết nhỏ gọn */}
        <div className="flex flex-wrap items-center justify-center gap-4 text-[11px] text-zinc-400">
          <span className="flex items-center gap-1">
            <span className="text-blue-500">⚡</span> Năng suất vượt trội
          </span>
          <span className="w-1 h-1 rounded-full bg-zinc-300" />
          <span className="flex items-center gap-1">
            <span className="text-emerald-500">🛡️</span> Phê duyệt lệnh ghi trước khi chạy
          </span>
          <span className="w-1 h-1 rounded-full bg-zinc-300" />
          <span className="flex items-center gap-1">
            <span className="text-purple-500">🧩</span> Kiến trúc mở cho doanh nghiệp
          </span>
        </div>
      </footer>
    </main>
  );
};
