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
    <main className="min-h-screen lg:h-screen w-full grid grid-cols-1 lg:grid-cols-12 bg-white text-zinc-900 font-sans lg:overflow-hidden">
      {/* Cột trái: Nền tảng Đa Dịch vụ Mở rộng (Vừa vặn 100vh không cần scroll) */}
      <section className="hidden lg:flex lg:col-span-6 xl:col-span-7 relative flex-col justify-between p-6 xl:p-8 2xl:p-10 bg-gradient-to-br from-zinc-950 via-zinc-900 to-blue-950 text-white overflow-hidden h-full">
        {/* Ambient Glow */}
        <div className="absolute top-0 -left-20 w-80 h-80 bg-blue-600/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />

        {/* 1. Header & Vision Statement */}
        <div className="relative z-10 shrink-0">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/15 backdrop-blur-md text-[11px] font-medium text-blue-200 mb-2.5 shadow-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>AI Workflow Automation Platform</span>
            <span className="px-1.5 py-0.2 rounded-md bg-blue-500/20 text-[9px] text-blue-300 font-semibold tracking-wider uppercase">
              Đa Dịch Vụ
            </span>
          </div>

          <h1 className="text-2xl xl:text-3xl font-bold tracking-tight text-white leading-snug">
            Nền tảng Tự động hóa Quy trình Đa Dịch vụ
          </h1>
          <p className="mt-1.5 text-xs xl:text-sm text-zinc-300 max-w-xl leading-relaxed">
            Kết nối và điều phối linh hoạt toàn bộ hệ sinh thái ứng dụng của doanh nghiệp — từ Quản lý dự án, 
            Mã nguồn, Kênh giao tiếp đến Bảng tính và Dữ liệu đám mây.
          </p>
        </div>

        {/* 2. Compact Simulation Card */}
        <div className="relative z-10 my-auto py-1 shrink-0 max-w-xl">
          <div className="rounded-xl bg-white/[0.05] border border-white/10 p-3.5 xl:p-4 backdrop-blur-md shadow-xl">
            <div className="flex items-center justify-between pb-2 border-b border-white/10 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-blue-400" />
                <span className="font-semibold text-white tracking-wide text-xs">Ví dụ quy trình liên thông mẫu</span>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-medium text-[10px]">
                ⚡ Tiết kiệm 80% thời gian
              </span>
            </div>

            {/* Prompt */}
            <div className="mt-2.5">
              <div className="text-[10px] font-medium text-zinc-400 mb-1 flex items-center gap-1">
                <svg className="w-3 h-3 text-blue-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <span>Yêu cầu tự nhiên của người dùng:</span>
              </div>
              <div className="px-2.5 py-1.5 rounded-lg bg-white/10 text-[11px] text-white font-medium border border-white/10 italic">
                &ldquo;Tạo task cập nhật trang chủ, gán Minh trên bảng dự án và thông báo tức thì cho team qua kênh chat&rdquo;
              </div>
            </div>

            {/* Connector */}
            <div className="flex justify-center my-1.5">
              <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </div>

            {/* Step Rows */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-white/[0.04] border border-white/[0.06] text-xs">
                <div className="w-5 h-5 rounded-md bg-blue-500/20 text-blue-300 flex items-center justify-center shrink-0 font-bold text-[9px]">
                  PM
                </div>
                <div className="flex-1 text-[11px] truncate">
                  <span className="font-semibold text-white">Quản lý dự án:</span>
                  <span className="text-zinc-300 ml-1">Tạo card nhiệm vụ trên Trello / Jira...</span>
                </div>
                <span className="text-emerald-400 text-[10px] shrink-0 font-medium">✓ Đã lập kế hoạch</span>
              </div>

              <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-white/[0.04] border border-white/[0.06] text-xs">
                <div className="w-5 h-5 rounded-md bg-zinc-800 text-zinc-200 flex items-center justify-center shrink-0 font-bold text-[9px]">
                  GIT
                </div>
                <div className="flex-1 text-[11px] truncate">
                  <span className="font-semibold text-white">Kho mã nguồn:</span>
                  <span className="text-zinc-300 ml-1">Liên kết issue trên GitHub / GitLab...</span>
                </div>
                <span className="text-emerald-400 text-[10px] shrink-0 font-medium">✓ Đã đồng bộ</span>
              </div>

              <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-white/[0.04] border border-white/[0.06] text-xs">
                <div className="w-5 h-5 rounded-md bg-purple-500/20 text-purple-300 flex items-center justify-center shrink-0 font-bold text-[9px]">
                  MSG
                </div>
                <div className="flex-1 text-[11px] truncate">
                  <span className="font-semibold text-white">Truyền thông:</span>
                  <span className="text-zinc-300 ml-1">Gửi thông báo qua Slack / Teams...</span>
                </div>
                <span className="text-emerald-400 text-[10px] shrink-0 font-medium">✓ Sẵn sàng gửi</span>
              </div>

              <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-white/[0.04] border border-white/[0.06] text-xs">
                <div className="w-5 h-5 rounded-md bg-emerald-500/20 text-emerald-300 flex items-center justify-center shrink-0 font-bold text-[9px]">
                  DOC
                </div>
                <div className="flex-1 text-[11px] truncate">
                  <span className="font-semibold text-white">Bảng tính &amp; Dữ liệu:</span>
                  <span className="text-zinc-300 ml-1">Ghi chép vào Google Sheets / Notion...</span>
                </div>
                <span className="text-blue-300 text-[10px] shrink-0 font-medium">+ Sẵn sàng tích hợp</span>
              </div>
            </div>

            {/* Widget Footer */}
            <div className="mt-2 pt-1.5 border-t border-white/10 flex items-center justify-between text-[10px] text-zinc-400">
              <span className="flex items-center gap-1">
                <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                Bạn luôn xem trước và phê duyệt trước khi chạy
              </span>
              <span className="text-zinc-500 font-mono">Tốc độ: ~8.5s</span>
            </div>
          </div>
        </div>

        {/* 3. Three Pillars (Sleek horizontal grid) */}
        <div className="relative z-10 grid grid-cols-3 gap-2.5 max-w-xl text-left shrink-0 my-1">
          <div className="p-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08]">
            <h3 className="text-[11px] font-semibold text-white flex items-center gap-1">
              <span>⚡</span> Năng suất vượt trội
            </h3>
            <p className="text-[10px] text-zinc-400 mt-0.5 leading-tight">
              1 câu chat thay thế 4–5 thao tác thủ công.
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08]">
            <h3 className="text-[11px] font-semibold text-white flex items-center gap-1">
              <span>🛡️</span> Kiểm soát 100%
            </h3>
            <p className="text-[10px] text-zinc-400 mt-0.5 leading-tight">
              Xem trước và phê duyệt mọi kế hoạch.
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08]">
            <h3 className="text-[11px] font-semibold text-white flex items-center gap-1">
              <span>🧩</span> Mở rộng linh hoạt
            </h3>
            <p className="text-[10px] text-zinc-400 mt-0.5 leading-tight">
              Kiến trúc mở kết nối mọi phần mềm.
            </p>
          </div>
        </div>

        {/* 4. Ecosystem Footer */}
        <div className="relative z-10 border-t border-white/10 pt-3 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-400">
            <span className="text-[11px] font-medium text-zinc-400 mr-1">Tích hợp &amp; mở rộng:</span>
            <span className="px-2 py-0.5 rounded-md bg-white/10 text-[10px] font-medium text-zinc-200">GitHub</span>
            <span className="px-2 py-0.5 rounded-md bg-white/10 text-[10px] font-medium text-zinc-200">Trello</span>
            <span className="px-2 py-0.5 rounded-md bg-white/10 text-[10px] font-medium text-zinc-200">Slack</span>
            <span className="px-2 py-0.5 rounded-md bg-white/10 text-[10px] font-medium text-zinc-300">Google Sheets</span>
            <span className="px-2 py-0.5 rounded-md bg-white/10 text-[10px] font-medium text-zinc-300">Jira</span>
            <span className="px-2 py-0.5 rounded-md bg-white/10 text-[10px] font-medium text-zinc-300">Notion</span>
            <span className="px-2 py-0.5 rounded-md bg-blue-500/20 text-[10px] font-semibold text-blue-300 border border-blue-400/20">
              + Mở rộng không giới hạn
            </span>
          </div>
        </div>
      </section>

      {/* Cột phải: Form Đăng nhập (Vừa vặn không tràn màn hình) */}
      <section className="col-span-1 lg:col-span-6 xl:col-span-5 flex items-center justify-center p-6 sm:p-8 lg:p-6 xl:p-8 bg-[#fbfbfd] h-full overflow-y-auto lg:overflow-hidden">
        <div className="w-full max-w-sm sm:max-w-md bg-white rounded-2xl border border-zinc-200/80 shadow-lg shadow-zinc-200/40 p-6 sm:p-7 flex flex-col gap-4">
          {/* Header Form */}
          <div className="flex flex-col gap-1">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[#0071e3] to-blue-400 text-white flex items-center justify-center font-bold text-xs shadow-md shadow-blue-500/25 mb-1">
              AI
            </div>
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-900">
              Chào mừng trở lại
            </h2>
            <p className="text-xs text-zinc-500 leading-normal">
              Đăng nhập để bắt đầu điều phối quy trình tự động hóa của bạn.
            </p>
          </div>

          {/* Form nhập liệu */}
          <form onSubmit={onLogin} className="flex flex-col gap-3.5">
            {/* Email Field */}
            <div className="flex flex-col gap-1">
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
                  className="w-full pl-10 pr-3.5 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-zinc-900 placeholder:text-zinc-400 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-[#0071e3] transition-all"
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="flex flex-col gap-1">
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
                  className="w-full pl-10 pr-3.5 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-zinc-900 placeholder:text-zinc-400 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-[#0071e3] transition-all"
                />
              </div>
            </div>

            {/* Error Message Alert */}
            {authError && (
              <div
                role="alert"
                className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2 animate-fadeIn"
              >
                <svg className="w-3.5 h-3.5 shrink-0 mt-0.5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
          <div className="pt-3 border-t border-zinc-100 flex flex-col gap-1.5">
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
