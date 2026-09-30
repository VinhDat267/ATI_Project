import React from 'react';

export interface LoginViewProps {
  email: string;
  setEmail: (val: string) => void;
  password: string;
  setPassword: (val: string) => void;
  isLoggingIn: boolean;
  authError: string | null;
  onLogin: (e: React.FormEvent<HTMLFormElement>) => void | Promise<void>;
  onQuickFillAdmin?: () => void;
}

export const LoginView: React.FC<LoginViewProps> = ({
  email,
  setEmail,
  password,
  setPassword,
  isLoggingIn,
  authError,
  onLogin,
  onQuickFillAdmin,
}) => {
  const handleQuickFill = () => {
    if (onQuickFillAdmin) {
      onQuickFillAdmin();
    } else {
      setEmail('admin@localhost.test');
      setPassword('admin12345678');
    }
  };

  return (
    <main className="min-h-screen w-full grid grid-cols-1 lg:grid-cols-12 bg-white text-zinc-900 font-sans">
      {/* Cột trái: Showcase thương hiệu & giá trị hệ thống (Chỉ hiện trên desktop/tablet lớn) */}
      <section className="hidden lg:flex lg:col-span-6 xl:col-span-7 relative flex-col justify-between p-12 xl:p-16 bg-gradient-to-br from-zinc-950 via-zinc-900 to-blue-950 text-white overflow-hidden">
        {/* Glow ambient background effects */}
        <div className="absolute top-0 -left-20 w-96 h-96 bg-blue-600/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-[30rem] h-[30rem] bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />

        {/* Header Branding */}
        <div className="relative z-10">
          <div className="inline-flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-white/10 border border-white/15 backdrop-blur-md text-xs font-medium text-blue-200 mb-6">
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            <span>AI Workflow Automation Platform</span>
            <span className="px-1.5 py-0.5 rounded-md bg-blue-500/20 text-[10px] text-blue-300 font-semibold uppercase tracking-wider">
              v3
            </span>
          </div>

          <h1 className="text-3xl xl:text-4xl font-bold tracking-tight text-white leading-tight">
            Biến ngôn ngữ tự nhiên thành quy trình đa dịch vụ
          </h1>
          <p className="mt-4 text-sm xl:text-base text-zinc-300 max-w-xl leading-relaxed">
            Hệ thống tự động hóa tác vụ liên thông giữa GitHub, Trello và Slack theo cơ chế{' '}
            <strong className="text-white font-semibold">Plan-then-Execute</strong>, minh bạch và an toàn tuyệt đối.
          </p>
        </div>

        {/* Feature Highlights Grid */}
        <div className="relative z-10 my-8 grid grid-cols-1 gap-4 max-w-xl">
          <div className="flex items-start gap-4 p-4 rounded-2xl bg-white/[0.04] border border-white/[0.08] backdrop-blur-xs">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Multi-Service DAG Execution</h2>
              <p className="text-xs text-zinc-400 mt-1 leading-normal">
                Tự động nối kết và truyền dữ liệu chéo giữa các dịch vụ thông qua tham chiếu $ref và $template.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4 p-4 rounded-2xl bg-white/[0.04] border border-white/[0.08] backdrop-blur-xs">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Human-in-the-Loop & Approval Gate</h2>
              <p className="text-xs text-zinc-400 mt-1 leading-normal">
                Xem trước toàn bộ kế hoạch (Preview Card), người dùng kiểm duyệt trước khi bất kỳ lệnh ghi nào được thực hiện.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4 p-4 rounded-2xl bg-white/[0.04] border border-white/[0.08] backdrop-blur-xs">
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Bảo mật & Giới hạn phạm vi (Allowlist)</h2>
              <p className="text-xs text-zinc-400 mt-1 leading-normal">
                Mã hóa AES-256-GCM authenticated credentials và chỉ tương tác trong phạm vi board/channel/repo được cấp phép.
              </p>
            </div>
          </div>
        </div>

        {/* Footer info & Supported Ecosystem */}
        <div className="relative z-10 border-t border-white/10 pt-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400 font-medium">Hệ sinh thái kết nối:</span>
            <div className="flex items-center gap-1.5">
              <span className="px-2 py-0.5 rounded-md bg-white/10 text-[11px] font-medium text-zinc-200">GitHub</span>
              <span className="px-2 py-0.5 rounded-md bg-white/10 text-[11px] font-medium text-zinc-200">Trello</span>
              <span className="px-2 py-0.5 rounded-md bg-white/10 text-[11px] font-medium text-zinc-200">Slack</span>
            </div>
          </div>
          <span className="text-[11px] text-zinc-400">Đề tài 26 — Advanced Technology Integration (ATI)</span>
        </div>
      </section>

      {/* Cột phải: Form Đăng nhập */}
      <section className="col-span-1 lg:col-span-6 xl:col-span-5 flex items-center justify-center p-6 sm:p-10 lg:p-12 bg-[#fbfbfd]">
        <div className="w-full max-w-md bg-white rounded-3xl border border-zinc-200/80 shadow-xl shadow-zinc-200/40 p-8 sm:p-10 flex flex-col gap-6">
          {/* Header Form */}
          <div className="flex flex-col gap-2">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#0071e3] to-blue-400 text-white flex items-center justify-center font-bold text-sm shadow-md shadow-blue-500/25 mb-1">
              AI
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
              Đăng nhập AI Workflow
            </h1>
            <p className="text-xs sm:text-sm text-zinc-500 leading-normal">
              Truy cập không gian làm việc để quản lý và tự động hóa các workflow đa dịch vụ của bạn.
            </p>
          </div>

          {/* Form Controls */}
          <form onSubmit={onLogin} className="flex flex-col gap-4">
            {/* Email Field */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="login-email" className="text-xs font-semibold text-zinc-700 tracking-wide">
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
                  className="w-full pl-10 pr-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl text-zinc-900 placeholder:text-zinc-400 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-[#0071e3] transition-all"
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="login-password" className="text-xs font-semibold text-zinc-700 tracking-wide">
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
                  className="w-full pl-10 pr-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl text-zinc-900 placeholder:text-zinc-400 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-[#0071e3] transition-all"
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
                <span className="leading-tight">{authError}</span>
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

          {/* Quick-Fill Admin Helper for Local Testing */}
          <div className="pt-4 border-t border-zinc-100 flex flex-col gap-2">
            <button
              type="button"
              onClick={handleQuickFill}
              className="w-full py-2 px-3 rounded-xl border border-dashed border-zinc-300 hover:border-blue-400 bg-zinc-50/70 hover:bg-blue-50/40 text-zinc-600 hover:text-blue-700 transition-all text-xs font-medium flex items-center justify-center gap-2 cursor-pointer group"
            >
              <svg className="w-3.5 h-3.5 text-zinc-400 group-hover:text-blue-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
              <span>Điền nhanh tài khoản Admin</span>
            </button>
            <p className="text-[11px] text-zinc-400 text-center">
              Dùng cho môi trường thử nghiệm cục bộ (PostgreSQL v3)
            </p>
          </div>
        </div>
      </section>
    </main>
  );
};
