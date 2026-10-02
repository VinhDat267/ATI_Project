import React from 'react';

export interface LandingPageViewProps {
  onGoToLogin: () => void;
}

export const LandingPageView: React.FC<LandingPageViewProps> = ({ onGoToLogin }) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);

  React.useEffect(() => {
    if (!isMobileMenuOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsMobileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMobileMenuOpen]);

  return (
    <div className="min-h-screen w-full bg-[#f8fafc] text-zinc-900 font-sans selection:bg-blue-500 selection:text-white scroll-smooth">
      {/* 1. Sticky Navigation Bar */}
      <header className="sticky top-0 z-50 w-full bg-white/80 backdrop-blur-md border-b border-zinc-200/80 transition-all">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Logo & Brand */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[#0071e3] to-blue-500 text-white flex items-center justify-center font-bold text-xs shadow-md shadow-blue-500/20">
              AI
            </div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-base sm:text-lg text-zinc-900 tracking-tight">AI Workflow</span>
              <span className="px-1.5 py-0.5 rounded-md bg-blue-50 text-[10px] text-blue-700 border border-blue-200/60 font-semibold tracking-wider uppercase">
                Platform
              </span>
            </div>
          </div>

          {/* Nav Links */}
          <nav className="hidden md:flex items-center gap-6 text-xs sm:text-sm font-medium text-zinc-600">
            <a href="#comparison" className="hover:text-blue-600 transition-colors">
              So sánh hiệu quả
            </a>
            <a href="#features" className="hover:text-blue-600 transition-colors">
              Tính năng
            </a>
            <a href="#ecosystem" className="hover:text-blue-600 transition-colors">
              Hệ sinh thái
            </a>
            <a href="#security" className="hover:text-blue-600 transition-colors">
              Bảo mật
            </a>
          </nav>

          {/* Action Button & Mobile Hamburger */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onGoToLogin}
              className="py-2 px-3 sm:px-4 bg-[#0071e3] hover:bg-[#0077ed] active:bg-[#0062c4] text-white text-xs sm:text-sm font-medium rounded-xl shadow-sm hover:shadow-md shadow-blue-500/20 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <span>Đăng nhập vào hệ thống</span>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </button>
            <button
              type="button"
              aria-label={isMobileMenuOpen ? "Đóng menu điều hướng" : "Mở menu điều hướng"}
              aria-expanded={isMobileMenuOpen}
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="md:hidden p-2 rounded-xl text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 transition-colors"
            >
              {isMobileMenuOpen ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Mobile Slide-down Menu */}
        {isMobileMenuOpen && (
          <nav
            aria-label="Menu di động"
            className="md:hidden border-t border-zinc-200/80 bg-white/95 backdrop-blur-md px-4 py-3 space-y-1 transition-all"
          >
            <a
              href="#comparison"
              onClick={() => setIsMobileMenuOpen(false)}
              className="block px-3 py-2 rounded-lg text-sm font-medium text-zinc-700 hover:bg-zinc-100 hover:text-blue-600 transition-colors"
            >
              So sánh hiệu quả
            </a>
            <a
              href="#features"
              onClick={() => setIsMobileMenuOpen(false)}
              className="block px-3 py-2 rounded-lg text-sm font-medium text-zinc-700 hover:bg-zinc-100 hover:text-blue-600 transition-colors"
            >
              Tính năng
            </a>
            <a
              href="#ecosystem"
              onClick={() => setIsMobileMenuOpen(false)}
              className="block px-3 py-2 rounded-lg text-sm font-medium text-zinc-700 hover:bg-zinc-100 hover:text-blue-600 transition-colors"
            >
              Hệ sinh thái
            </a>
            <a
              href="#security"
              onClick={() => setIsMobileMenuOpen(false)}
              className="block px-3 py-2 rounded-lg text-sm font-medium text-zinc-700 hover:bg-zinc-100 hover:text-blue-600 transition-colors"
            >
              Bảo mật
            </a>
            <button
              type="button"
              onClick={() => {
                setIsMobileMenuOpen(false);
                onGoToLogin();
              }}
              className="w-full text-left mt-2 px-3 py-2 rounded-lg text-sm font-semibold text-blue-600 bg-blue-50/80 hover:bg-blue-100 transition-colors flex items-center justify-between"
            >
              <span>Đăng nhập vào hệ thống</span>
              <span>→</span>
            </button>
          </nav>
        )}
      </header>

      {/* 2. Hero Section */}
      <section className="relative pt-12 pb-20 sm:pt-20 sm:pb-28 overflow-hidden">
        {/* Ambient background glows */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[54rem] h-[28rem] bg-gradient-to-b from-blue-400/10 via-indigo-300/5 to-transparent rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 text-center">
          {/* Eyebrow Pill */}
          <div className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-white border border-zinc-200/90 shadow-xs text-xs font-medium text-zinc-700 mb-6">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-semibold text-zinc-800">AI Workflow Automation Platform</span>
            <span className="text-zinc-300">•</span>
            <span className="text-blue-600 font-semibold">Tự động hóa Đa Dịch vụ</span>
          </div>

          {/* Headline */}
          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-zinc-900 leading-[1.15]">
            Biến một câu lệnh thành quy trình <br className="hidden sm:inline" />
            <span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
              đa dịch vụ tự động
            </span>
          </h1>

          {/* Subtitle */}
          <p className="mt-6 text-base sm:text-lg text-zinc-600 max-w-2xl mx-auto leading-relaxed">
            Giải phóng đội ngũ của bạn khỏi hàng giờ nhập liệu thủ công. 
            Mô tả công việc bằng ngôn ngữ tự nhiên, xem kế hoạch và phê duyệt các lệnh ghi trên dịch vụ đã kết nối.
          </p>

          {/* Call to Actions */}
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3.5">
            <button
              type="button"
              onClick={onGoToLogin}
              className="w-full sm:w-auto py-3.5 px-7 bg-[#0071e3] hover:bg-[#0077ed] text-white font-semibold text-sm sm:text-base rounded-2xl shadow-lg shadow-blue-500/25 transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>Bắt đầu trải nghiệm ngay</span>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </button>
            <a
              href="#comparison"
              className="w-full sm:w-auto py-3.5 px-6 bg-white hover:bg-zinc-50 border border-zinc-200/90 text-zinc-700 font-semibold text-sm sm:text-base rounded-2xl shadow-xs transition-all flex items-center justify-center gap-2"
            >
              <span>Xem so sánh hiệu quả</span>
              <svg className="w-4 h-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </a>
          </div>

          {/* Key Value Metrics */}
          <div className="mt-12 pt-8 border-t border-zinc-200/60 grid grid-cols-3 gap-4 max-w-xl mx-auto text-center">
            <div>
              <div className="text-xl sm:text-2xl font-extrabold text-blue-600">Theo bước</div>
              <div className="text-[11px] sm:text-xs text-zinc-500 mt-0.5">Theo dõi quá trình thực thi</div>
            </div>
            <div>
              <div className="text-xl sm:text-2xl font-extrabold text-emerald-600">Có phê duyệt</div>
              <div className="text-[11px] sm:text-xs text-zinc-500 mt-0.5">Quyền kiểm duyệt của bạn</div>
            </div>
            <div>
              <div className="text-xl sm:text-2xl font-extrabold text-indigo-600">Đa dịch vụ</div>
              <div className="text-[11px] sm:text-xs text-zinc-500 mt-0.5">Kết nối công việc giữa dịch vụ</div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. CORE SECTION: Before vs After Comparison */}
      <section id="comparison" className="py-16 sm:py-24 bg-white border-y border-zinc-200/80 scroll-mt-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          {/* Section Header */}
          <div className="text-center max-w-2xl mx-auto mb-10 sm:mb-12">
            <span className="px-3.5 py-1 rounded-full bg-blue-50 border border-blue-200/70 text-blue-700 font-semibold text-xs tracking-wide uppercase shadow-2xs">
              So sánh hiệu quả vận hành
            </span>
            <h2 className="text-2xl sm:text-4xl font-extrabold text-zinc-900 tracking-tight mt-3">
              Từ thao tác thủ công đến kế hoạch có phê duyệt
            </h2>
            <p className="mt-3 text-sm sm:text-base text-zinc-600 leading-relaxed">
              Ví dụ về cách tổ chức cùng một công việc thủ công và bằng kế hoạch do AI đề xuất.
            </p>
          </div>

          {/* 3 Stat ROI Highlight Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10 sm:mb-12">
            <div className="bg-slate-50/80 hover:bg-slate-50 border border-zinc-200/80 rounded-2xl p-5 text-center shadow-2xs transition-all">
              <div className="text-3xl sm:text-4xl font-extrabold text-blue-600 tracking-tight">Bớt chuyển tab</div>
              <div className="text-xs font-bold text-zinc-900 mt-1.5">Tiết kiệm thời gian</div>
              <p className="text-[11px] text-zinc-500 mt-1 leading-snug">
                Gom yêu cầu vào một hội thoại và xem kế hoạch trước khi chạy
              </p>
            </div>
            <div className="bg-slate-50/80 hover:bg-slate-50 border border-zinc-200/80 rounded-2xl p-5 text-center shadow-2xs transition-all">
              <div className="text-3xl sm:text-4xl font-extrabold text-indigo-600 tracking-tight">1 Câu lệnh</div>
              <div className="text-xs font-bold text-zinc-900 mt-1.5">Mô tả mục tiêu công việc</div>
              <p className="text-[11px] text-zinc-500 mt-1 leading-snug">
                Tự động bóc tách mục tiêu, tạo thẻ, cập nhật dữ liệu và gửi thông báo
              </p>
            </div>
            <div className="bg-slate-50/80 hover:bg-slate-50 border border-zinc-200/80 rounded-2xl p-5 text-center shadow-2xs transition-all">
              <div className="text-3xl sm:text-4xl font-extrabold text-emerald-600 tracking-tight">Có phê duyệt</div>
              <div className="text-xs font-bold text-zinc-900 mt-1.5">Minh bạch &amp; Kiểm soát</div>
              <p className="text-[11px] text-zinc-500 mt-1 leading-snug">
                Người dùng luôn xem trước kế hoạch chi tiết và duyệt trước khi thực thi
              </p>
            </div>
          </div>

          {/* 1-to-1 Balanced Comparison Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8 items-stretch">
            {/* Cột TRƯỚC (Cách làm thủ công truyền thống) */}
            <div className="bg-zinc-50/50 hover:bg-zinc-50/80 border border-zinc-200/90 rounded-3xl p-6 sm:p-8 flex flex-col justify-between shadow-xs transition-all">
              <div>
                <div className="flex items-center justify-between pb-4 border-b border-zinc-200/80">
                  <div className="flex items-center gap-2.5">
                    <span className="w-8 h-8 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center font-bold text-sm">
                      ✕
                    </span>
                    <div>
                      <span className="text-[10px] uppercase font-bold tracking-wider text-rose-600 block">
                        Quy trình truyền thống
                      </span>
                      <h3 className="font-bold text-base sm:text-lg text-zinc-900 leading-snug">
                        Cách làm truyền thống: thao tác qua nhiều ứng dụng
                      </h3>
                    </div>
                  </div>
                </div>

                <div className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-50 text-rose-700 text-xs font-semibold">
                  <span>⏱️</span>
                  <span>Chuyển tab và nhập liệu nhiều lần</span>
                </div>

                {/* 4 Tiêu chí đối chiếu 1-1 */}
                <div className="mt-6 space-y-4 text-xs sm:text-sm text-zinc-700">
                  <div className="p-3 rounded-xl bg-white/80 border border-zinc-200/70 shadow-2xs">
                    <div className="font-semibold text-zinc-900 flex items-center gap-1.5 text-xs mb-1">
                      <span className="text-rose-500">1.</span>
                      <span>Thao tác ứng dụng rời rạc</span>
                    </div>
                    <p className="text-zinc-600 text-xs leading-relaxed">
                      Lục tìm board &amp; list, tạo card thủ công trên Trello; chuyển tab liên tục để copy dữ liệu.
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-white/80 border border-zinc-200/70 shadow-2xs">
                    <div className="font-semibold text-zinc-900 flex items-center gap-1.5 text-xs mb-1">
                      <span className="text-rose-500">2.</span>
                      <span>Phân công &amp; Gắn kết nối</span>
                    </div>
                    <p className="text-zinc-600 text-xs leading-relaxed">
                      Tìm kiếm tài khoản thành viên để gán người phụ trách từng khâu; sao chép đường link dán qua lại.
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-white/80 border border-zinc-200/70 shadow-2xs">
                    <div className="font-semibold text-zinc-900 flex items-center gap-1.5 text-xs mb-1">
                      <span className="text-rose-500">3.</span>
                      <span>Trao đổi &amp; Cập nhật tiến độ</span>
                    </div>
                    <p className="text-zinc-600 text-xs leading-relaxed">
                      Chuyển sang Slack soạn thông báo rồi sao chép liên kết thẻ Trello.
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-white/80 border border-zinc-200/70 shadow-2xs">
                    <div className="font-semibold text-zinc-900 flex items-center gap-1.5 text-xs mb-1">
                      <span className="text-rose-500">4.</span>
                      <span>Rủi ro sai sót &amp; Mệt mỏi</span>
                    </div>
                    <p className="text-zinc-600 text-xs leading-relaxed">
                      Thao tác lặp đi lặp lại nhiều lần mỗi ngày gây mất tập trung, dễ sót việc và sai lệch số liệu.
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-zinc-200/80 text-xs text-rose-700 font-medium flex items-center gap-1.5">
                <span>⚠️</span>
                <span>Hệ quả: Thao tác lặp lại và khó theo dõi công việc giữa các ứng dụng.</span>
              </div>
            </div>

            {/* Cột SAU (Với AI Workflow Platform) */}
            <div className="bg-gradient-to-b from-blue-50/50 via-white to-indigo-50/30 border-2 border-blue-500/40 rounded-3xl p-6 sm:p-8 flex flex-col justify-between shadow-xl shadow-blue-500/5 relative overflow-hidden">
              <div className="absolute top-0 right-0 px-3.5 py-1 bg-gradient-to-l from-blue-600 to-indigo-600 text-white text-[11px] font-bold rounded-bl-2xl uppercase tracking-wider">
                Đột phá
              </div>

              <div>
                <div className="flex items-center justify-between pb-4 border-b border-blue-200/60">
                  <div className="flex items-center gap-2.5">
                    <span className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold text-sm shadow-md shadow-blue-500/25">
                      ✓
                    </span>
                    <div>
                      <span className="text-[10px] uppercase font-bold tracking-wider text-blue-600 block">
                        Tự động hóa thông minh
                      </span>
                      <h3 className="font-bold text-base sm:text-lg text-zinc-900 leading-snug">
                        Với AI Workflow: 1 câu lệnh tự nhiên duy nhất
                      </h3>
                    </div>
                  </div>
                </div>

                <div className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-semibold">
                  <span>⚡</span>
                  <span>Xem kế hoạch và theo dõi kết quả từng bước</span>
                </div>

                {/* 4 Tiêu chí đối chiếu 1-1 */}
                <div className="mt-6 space-y-4 text-xs sm:text-sm text-zinc-800">
                  <div className="p-3 rounded-xl bg-white border border-blue-200/80 shadow-2xs">
                    <div className="font-semibold text-blue-900 flex items-center gap-1.5 text-xs mb-1">
                      <span className="text-blue-600">1.</span>
                      <span>Giao việc tự nhiên bằng 1 câu chat</span>
                    </div>
                    <p className="text-zinc-600 text-xs leading-relaxed italic bg-blue-50/50 p-1.5 rounded-lg border border-blue-100 text-blue-950 font-medium">
                      &ldquo;Tạo thẻ công việc trên Trello và gửi liên kết vào kênh Slack đã chọn&rdquo;
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-white border border-blue-200/80 shadow-2xs">
                    <div className="font-semibold text-blue-900 flex items-center gap-1.5 text-xs mb-1">
                      <span className="text-blue-600">2.</span>
                      <span>AI tự động phân giải &amp; lập kế hoạch</span>
                    </div>
                    <p className="text-zinc-600 text-xs leading-relaxed">
                      AI tự động phân giải đối tượng và lập kế hoạch đa bước hoàn chỉnh, định danh đúng bảng, danh sách và người phụ trách.
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-white border border-blue-200/80 shadow-2xs">
                    <div className="font-semibold text-blue-900 flex items-center gap-1.5 text-xs mb-1">
                      <span className="text-blue-600">3.</span>
                      <span>Xem trước kế hoạch minh bạch</span>
                    </div>
                    <p className="text-zinc-600 text-xs leading-relaxed">
                      Bạn xem các bước và tham số của lệnh ghi trước khi phê duyệt kế hoạch.
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-white border border-blue-200/80 shadow-2xs">
                    <div className="font-semibold text-blue-900 flex items-center gap-1.5 text-xs mb-1">
                      <span className="text-blue-600">4.</span>
                      <span>Chạy theo thứ tự kế hoạch</span>
                    </div>
                    <p className="text-zinc-600 text-xs leading-relaxed">
                      Sau khi duyệt, hệ thống chạy lần lượt các bước và ghi nhận kết quả; khi có lỗi, người dùng xem trạng thái để xử lý.
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-blue-200/60 text-xs text-blue-700 font-semibold flex items-center gap-1.5">
                <span>🚀</span>
                <span>Giá trị: Theo dõi các bước, kết quả và lỗi trong cùng một hội thoại.</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Core Features Section */}
      <section id="features" className="py-16 sm:py-24 bg-zinc-50/70 border-b border-zinc-200/80 scroll-mt-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <span className="px-3 py-1 rounded-full bg-blue-50 border border-blue-200/60 text-blue-700 font-semibold text-xs tracking-wide uppercase">
              Tính năng cốt lõi
            </span>
            <h2 className="text-2xl sm:text-4xl font-extrabold text-zinc-900 tracking-tight mt-3">
              Mọi thứ bạn cần để tự động hóa vận hành
            </h2>
            <p className="mt-3 text-sm sm:text-base text-zinc-500">
              Giải pháp tối ưu hóa năng suất toàn diện cho đội ngũ và doanh nghiệp của bạn.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-6 rounded-2xl bg-white border border-zinc-200/80 shadow-xs hover:border-blue-400 hover:shadow-md transition-all">
              <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-lg mb-4">
                🧠
              </div>
              <h3 className="font-bold text-base text-zinc-900">Hiểu mệnh lệnh tự nhiên</h3>
              <p className="text-xs sm:text-sm text-zinc-600 mt-2 leading-relaxed">
                Không cần học cú pháp hay câu lệnh phức tạp. Bạn chỉ cần giao việc bằng tiếng Việt như đang trao đổi với một trợ lý điều phối tận tâm.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-white border border-zinc-200/80 shadow-xs hover:border-blue-400 hover:shadow-md transition-all">
              <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-lg mb-4">
                🔗
              </div>
              <h3 className="font-bold text-base text-zinc-900">Tự động liên kết công việc theo chuỗi</h3>
              <p className="text-xs sm:text-sm text-zinc-600 mt-2 leading-relaxed">
                Tự động chuyển tiếp kết quả: việc tạo thẻ việc xong sẽ tự lấy liên kết đính kèm vào bảng tính theo dõi và gửi thông báo cho đội ngũ.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-white border border-zinc-200/80 shadow-xs hover:border-blue-400 hover:shadow-md transition-all">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center font-bold text-lg mb-4">
                👁️
              </div>
              <h3 className="font-bold text-base text-zinc-900">Xem kế hoạch – Duyệt mới chạy</h3>
              <p className="text-xs sm:text-sm text-zinc-600 mt-2 leading-relaxed">
                Bạn xem các bước và tham số trước khi phê duyệt lệnh ghi. Hệ thống có thể đọc tài nguyên trong phạm vi đã cấp để lập kế hoạch; lỗi thực thi cần được kiểm tra và xử lý.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-white border border-zinc-200/80 shadow-xs hover:border-blue-400 hover:shadow-md transition-all">
              <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center font-bold text-lg mb-4">
                🛡️
              </div>
              <h3 className="font-bold text-base text-zinc-900">Tự phục hồi gián đoạn thông minh</h3>
              <p className="text-xs sm:text-sm text-zinc-600 mt-2 leading-relaxed">
                Nếu một ứng dụng bên ngoài bị nghẽn mạng hay quá tải, quy trình không bị đổ vỡ. Bạn có thể chọn Thử lại hoặc Bỏ qua một cách an toàn.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-white border border-zinc-200/80 shadow-xs hover:border-blue-400 hover:shadow-md transition-all">
              <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-600 flex items-center justify-center font-bold text-lg mb-4">
                ⚡
              </div>
              <h3 className="font-bold text-base text-zinc-900">Theo dõi tiến độ trực tiếp từng giây</h3>
              <p className="text-xs sm:text-sm text-zinc-600 mt-2 leading-relaxed">
                Quan sát trực tiếp trạng thái từng việc đang được hoàn thành ngay trước mắt theo thời gian thực mà không cần tải lại trang.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-white border border-zinc-200/80 shadow-xs hover:border-blue-400 hover:shadow-md transition-all">
              <div className="w-10 h-10 rounded-xl bg-cyan-100 text-cyan-600 flex items-center justify-center font-bold text-lg mb-4">
                🧩
              </div>
              <h3 className="font-bold text-base text-zinc-900">Mở rộng linh hoạt theo phần mềm của bạn</h3>
              <p className="text-xs sm:text-sm text-zinc-600 mt-2 leading-relaxed">
                Dễ dàng kết nối thêm bất kỳ công cụ làm việc hay phần mềm nội bộ nào của doanh nghiệp bạn mà không làm gián đoạn hệ thống.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 5. Ecosystem Section */}
      <section id="ecosystem" className="py-16 sm:py-24 max-w-5xl mx-auto px-4 sm:px-6 scroll-mt-16">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <span className="px-3 py-1 rounded-full bg-zinc-100 border border-zinc-200 text-zinc-700 font-semibold text-xs tracking-wide uppercase">
            Khả năng tích hợp mở rộng
          </span>
          <h2 className="text-2xl sm:text-4xl font-extrabold text-zinc-900 tracking-tight mt-3">
            Dịch vụ hiện có và hướng mở rộng
          </h2>
          <p className="mt-3 text-sm sm:text-base text-zinc-500">
            Các dịch vụ đã hỗ trợ cần được cấu hình credentials và phạm vi tài nguyên trước khi sử dụng.
          </p>
        </div>

        <div className="space-y-6">
          <section aria-labelledby="supported-services">
            <h3 id="supported-services" className="font-bold mb-3">Đã hỗ trợ</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {[['GitHub', 'Tìm repository, đọc/tạo issue và thêm bình luận.'], ['Trello', 'Tìm, tạo và cập nhật thẻ; gán thành viên và thêm checklist.'], ['Slack', 'Tìm kênh và gửi tin nhắn trong phạm vi đã cấp.']].map(([name, description]) => <div key={name} className="p-4 rounded-2xl bg-white border border-zinc-200 shadow-xs"><div className="font-bold text-sm text-zinc-900">{name}</div><p className="text-xs text-zinc-500 mt-1">{description}</p></div>)}
            </div>
          </section>
          <section aria-labelledby="planned-services">
            <h3 id="planned-services" className="font-bold mb-3">Đang phát triển</h3>
            <p className="text-xs text-zinc-500 mb-3">Theo lộ trình dự án; chưa có tool thực thi trong phiên bản hiện tại.</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {['Google Sheets', 'Google Calendar', 'Notion', 'Telegram', 'Jira'].map(name => <div key={name} className="p-4 rounded-2xl bg-zinc-50 border border-zinc-200 text-sm text-zinc-500">{name}</div>)}
            </div>
          </section>
        </div>
      </section>

      {/* 6. Enterprise Trust & Security Section */}
      <section id="security" className="py-16 sm:py-20 bg-zinc-900 text-white scroll-mt-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <span className="px-3 py-1 rounded-full bg-white/10 text-blue-300 font-semibold text-xs tracking-wide uppercase">
              Bảo mật &amp; Minh bạch
            </span>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight mt-3">
              Kiểm soát dữ liệu và phạm vi thực thi
            </h2>
            <p className="mt-2 text-xs sm:text-sm text-zinc-400">
              Phê duyệt kế hoạch, mã hóa thông tin kết nối và giới hạn tài nguyên được phép thao tác.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-5 rounded-2xl bg-white/[0.04] border border-white/10">
              <div className="text-emerald-400 text-xl font-bold mb-2">🛡️ Phê duyệt lệnh ghi</div>
              <h3 className="text-sm font-semibold text-white">Phê duyệt trước mọi thay đổi</h3>
              <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                Các lệnh ghi cần bạn duyệt kế hoạch. Bước thu thập có thể đọc tài nguyên trong phạm vi được cấp để lập kế hoạch.
              </p>
            </div>
            <div className="p-5 rounded-2xl bg-white/[0.04] border border-white/10">
              <div className="text-blue-400 text-xl font-bold mb-2">🔒 Mã hóa AES-256-GCM</div>
              <h3 className="text-sm font-semibold text-white">Bảo vệ thông tin kết nối</h3>
              <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                Credentials kết nối dịch vụ được mã hóa AES-256-GCM khi lưu trữ.
              </p>
            </div>
            <div className="p-5 rounded-2xl bg-white/[0.04] border border-white/10">
              <div className="text-purple-400 text-xl font-bold mb-2">🎯 Phân quyền ranh giới chặt chẽ</div>
              <h3 className="text-sm font-semibold text-white">Kiểm soát phạm vi thao tác</h3>
              <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                Allowlist giới hạn bảng Trello, kênh Slack và repository GitHub được phép sử dụng.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 6. Call to Action Banner */}
      <section className="py-16 sm:py-20 bg-gradient-to-br from-blue-600 to-indigo-700 text-white text-center">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl sm:text-4xl font-extrabold tracking-tight">
            Sẵn sàng giải phóng đội ngũ của bạn?
          </h2>
          <p className="mt-4 text-sm sm:text-base text-blue-100 max-w-xl mx-auto">
            Bắt đầu trải nghiệm ngay hôm nay để thấy sức mạnh của việc tự động hóa quy trình đa dịch vụ bằng AI.
          </p>
          <button
            type="button"
            onClick={onGoToLogin}
            className="mt-8 py-3.5 px-8 bg-white hover:bg-zinc-100 text-blue-700 font-bold text-sm sm:text-base rounded-2xl shadow-xl transition-all inline-flex items-center gap-2 cursor-pointer"
          >
            <span>Đăng nhập vào Workspace ngay</span>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </button>
        </div>
      </section>

      {/* 7. Footer */}
      <footer className="py-8 bg-white border-t border-zinc-200/80 text-center text-xs text-zinc-500">
        <div className="max-w-5xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 font-medium text-zinc-700">
            <span>AI Workflow Automation Platform</span>
            <span>•</span>
            <span className="text-zinc-500 font-normal">Enterprise Multi-Service Orchestration</span>
          </div>
          <div className="text-zinc-400">
            © 2026 AI Workflow Platform. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};
