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
      {/* Cột trái: Góc nhìn Giá trị Doanh nghiệp & Mô phỏng Quy trình Thực tế */}
      <section className="hidden lg:flex lg:col-span-6 xl:col-span-7 relative flex-col justify-between p-12 xl:p-16 bg-gradient-to-br from-zinc-950 via-zinc-900 to-blue-950 text-white overflow-hidden">
        {/* Hiệu ứng ánh sáng nền ambient tinh tế */}
        <div className="absolute top-0 -left-20 w-96 h-96 bg-blue-600/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-[30rem] h-[30rem] bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />

        {/* Tiêu đề & Thông điệp Doanh nghiệp */}
        <div className="relative z-10">
          <div className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-white/10 border border-white/15 backdrop-blur-md text-xs font-medium text-blue-200 mb-6 shadow-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>AI Workflow Automation Platform</span>
            <span className="px-1.5 py-0.5 rounded-md bg-blue-500/20 text-[10px] text-blue-300 font-semibold tracking-wider uppercase">
              Doanh nghiệp
            </span>
          </div>

          <h1 className="text-3xl xl:text-4xl font-bold tracking-tight text-white leading-tight">
            Tự động hóa mọi quy trình chỉ với một câu lệnh
          </h1>
          <p className="mt-4 text-sm xl:text-base text-zinc-300 max-w-xl leading-relaxed">
            Biến yêu cầu tự nhiên thành chuỗi hành động cụ thể trên các công cụ làm việc quen thuộc. 
            Giảm thiểu tối đa thao tác thủ công, giúp đội ngũ của bạn tập trung tạo ra giá trị kinh doanh đột phá.
          </p>
        </div>

        {/* Thẻ mô phỏng Quy trình thực tế (Workflow Preview Widget) */}
        <div className="relative z-10 my-6 max-w-xl">
          <div className="rounded-2xl bg-white/[0.05] border border-white/10 p-5 backdrop-blur-md shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-white/10 text-xs">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-400" />
                <span className="font-semibold text-white tracking-wide">Mô phỏng quy trình thực tế</span>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-medium text-[11px]">
                ⚡ Tiết kiệm 80% thời gian
              </span>
            </div>

            {/* Bước 1: Yêu cầu của người dùng */}
            <div className="mt-3.5">
              <div className="text-[11px] font-medium text-zinc-400 mb-1 flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <span>Yêu cầu từ người quản lý:</span>
              </div>
              <div className="p-2.5 rounded-xl bg-white/10 text-xs text-white font-medium border border-white/10 italic">
                &ldquo;Tạo task cập nhật trang chủ cho team Frontend, gán cho Minh trên Trello và thông báo vào Slack&rdquo;
              </div>
            </div>

            {/* Mũi tên kết nối luồng */}
            <div className="flex justify-center my-2">
              <svg className="w-4 h-4 text-zinc-400 animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </div>

            {/* Bước 2: AI tự động điều phối & thực hiện */}
            <div className="space-y-2">
              <div className="flex items-center gap-3 p-2 rounded-xl bg-white/[0.04] border border-white/[0.06] text-xs">
                <div className="w-6 h-6 rounded-lg bg-blue-500/20 text-blue-300 flex items-center justify-center shrink-0 font-bold text-[10px]">
                  TR
                </div>
                <div className="flex-1">
                  <span className="font-semibold text-white">Trello:</span>
                  <span className="text-zinc-300 ml-1.5">Tạo thẻ công việc mới &amp; phân công nhân sự</span>
                </div>
                <span className="text-emerald-400 text-xs">✓ Đã lập kế hoạch</span>
              </div>

              <div className="flex items-center gap-3 p-2 rounded-xl bg-white/[0.04] border border-white/[0.06] text-xs">
                <div className="w-6 h-6 rounded-lg bg-zinc-800 text-zinc-200 flex items-center justify-center shrink-0 font-bold text-[10px]">
                  GH
                </div>
                <div className="flex-1">
                  <span className="font-semibold text-white">GitHub:</span>
                  <span className="text-zinc-300 ml-1.5">Liên kết issue và repository liên quan</span>
                </div>
                <span className="text-emerald-400 text-xs">✓ Đã đồng bộ</span>
              </div>

              <div className="flex items-center gap-3 p-2 rounded-xl bg-white/[0.04] border border-white/[0.06] text-xs">
                <div className="w-6 h-6 rounded-lg bg-purple-500/20 text-purple-300 flex items-center justify-center shrink-0 font-bold text-[10px]">
                  SL
                </div>
                <div className="flex-1">
                  <span className="font-semibold text-white">Slack:</span>
                  <span className="text-zinc-300 ml-1.5">Gửi thông báo cập nhật trực tiếp đến kênh làm việc</span>
                </div>
                <span className="text-emerald-400 text-xs">✓ Sẵn sàng gửi</span>
              </div>
            </div>

            {/* Chân thẻ widget */}
            <div className="mt-3 pt-2.5 border-t border-white/10 flex items-center justify-between text-[11px] text-zinc-400">
              <span className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                Bạn luôn xem trước và phê duyệt trước khi hệ thống thực thi
              </span>
              <span className="text-zinc-500 font-mono">Thời gian: ~8.5s</span>
            </div>
          </div>
        </div>

        {/* 3 Trụ cột Lợi ích Doanh nghiệp */}
        <div className="relative z-10 grid grid-cols-3 gap-3 max-w-xl text-left">
          <div className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.08]">
            <h3 className="text-xs font-semibold text-white flex items-center gap-1.5">
              <span>⚡</span> Năng suất vượt trội
            </h3>
            <p className="text-[11px] text-zinc-400 mt-1 leading-normal">
              1 câu chat thay thế 4–5 thao tác thủ công trên nhiều ứng dụng.
            </p>
          </div>
          <div className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.08]">
            <h3 className="text-xs font-semibold text-white flex items-center gap-1.5">
              <span>🛡️</span> Kiểm soát 100%
            </h3>
            <p className="text-[11px] text-zinc-400 mt-1 leading-normal">
              Xem trước và duyệt kế hoạch, không tự ý thay đổi dữ liệu.
            </p>
          </div>
          <div className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.08]">
            <h3 className="text-xs font-semibold text-white flex items-center gap-1.5">
              <span>🤝</span> Đồng bộ phòng ban
            </h3>
            <p className="text-[11px] text-zinc-400 mt-1 leading-normal">
              Kết nối liền mạch đội ngũ kỹ thuật, quản lý và truyền thông.
            </p>
          </div>
        </div>

        {/* Chân trang cột trái */}
        <div className="relative z-10 border-t border-white/10 pt-5 mt-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400 font-medium">Hệ sinh thái kết nối:</span>
            <div className="flex items-center gap-1.5">
              <span className="px-2 py-0.5 rounded-md bg-white/10 text-[11px] font-medium text-zinc-200">GitHub</span>
              <span className="px-2 py-0.5 rounded-md bg-white/10 text-[11px] font-medium text-zinc-200">Trello</span>
              <span className="px-2 py-0.5 rounded-md bg-white/10 text-[11px] font-medium text-zinc-200">Slack</span>
            </div>
          </div>
          <span className="text-[11px] text-zinc-400">Nền tảng Tự động hóa Vận hành Doanh nghiệp</span>
        </div>
      </section>

      {/* Cột phải: Form Đăng nhập Thân thiện & Sang trọng */}
      <section className="col-span-1 lg:col-span-6 xl:col-span-5 flex items-center justify-center p-6 sm:p-10 lg:p-12 bg-[#fbfbfd]">
        <div className="w-full max-w-md bg-white rounded-3xl border border-zinc-200/80 shadow-xl shadow-zinc-200/40 p-8 sm:p-10 flex flex-col gap-6">
          {/* Header Form */}
          <div className="flex flex-col gap-2">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#0071e3] to-blue-400 text-white flex items-center justify-center font-bold text-sm shadow-md shadow-blue-500/25 mb-1">
              AI
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-zinc-900">
              Chào mừng trở lại
            </h2>
            <p className="text-xs sm:text-sm text-zinc-500 leading-normal">
              Đăng nhập để bắt đầu điều phối và tối ưu hóa các quy trình công việc của bạn.
            </p>
          </div>

          {/* Form nhập liệu */}
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
