import React from 'react';

export interface LandingPageViewProps {
  onGoToLogin: () => void;
}

export const LandingPageView: React.FC<LandingPageViewProps> = ({ onGoToLogin }) => {
  return (
    <div className="min-h-screen w-full bg-[#f8fafc] text-zinc-900 font-sans selection:bg-blue-500 selection:text-white">
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
                Platform v3
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

          {/* Action Button */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onGoToLogin}
              className="py-2 px-4 bg-[#0071e3] hover:bg-[#0077ed] active:bg-[#0062c4] text-white text-xs sm:text-sm font-medium rounded-xl shadow-sm hover:shadow-md shadow-blue-500/20 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <span>Đăng nhập vào hệ thống</span>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </button>
          </div>
        </div>
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
            Không còn phải chuyển đổi qua lại giữa Trello, GitHub, Slack hay Google Sheets. 
            AI Workflow hiểu yêu cầu ngôn ngữ tự nhiên, tự động lập kế hoạch và đồng bộ hóa công việc của bạn chỉ trong vài giây.
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
              <div className="text-xl sm:text-2xl font-extrabold text-blue-600">&lt; 10s</div>
              <div className="text-[11px] sm:text-xs text-zinc-500 mt-0.5">Xử lý toàn bộ quy trình</div>
            </div>
            <div>
              <div className="text-xl sm:text-2xl font-extrabold text-emerald-600">100%</div>
              <div className="text-[11px] sm:text-xs text-zinc-500 mt-0.5">Quyền kiểm duyệt của bạn</div>
            </div>
            <div>
              <div className="text-xl sm:text-2xl font-extrabold text-indigo-600">∞</div>
              <div className="text-[11px] sm:text-xs text-zinc-500 mt-0.5">Khả năng mở rộng dịch vụ</div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. CORE SECTION: Before vs After Comparison */}
      <section id="comparison" className="py-16 sm:py-24 bg-white border-y border-zinc-200/80">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <span className="px-3 py-1 rounded-full bg-blue-50 border border-blue-200/60 text-blue-700 font-semibold text-xs tracking-wide uppercase">
              So sánh hiệu quả vận hành
            </span>
            <h2 className="text-2xl sm:text-4xl font-extrabold text-zinc-900 tracking-tight mt-3">
              Sự khác biệt mang tính cách mạng
            </h2>
            <p className="mt-3 text-sm sm:text-base text-zinc-500">
              Nhìn lại sự lãng phí thời gian của quy trình thủ công rời rạc so với giải pháp tự động hóa bằng AI.
            </p>
          </div>

          {/* Comparison Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8 items-stretch">
            {/* Cột TRƯỚC (Cách làm thủ công truyền thống) */}
            <div className="bg-red-50/40 border border-red-200/80 rounded-3xl p-6 sm:p-8 flex flex-col justify-between shadow-xs">
              <div>
                <div className="flex items-center justify-between pb-4 border-b border-red-200/60">
                  <div className="flex items-center gap-2.5">
                    <span className="w-8 h-8 rounded-xl bg-red-100 text-red-600 flex items-center justify-center font-bold text-sm">
                      ✕
                    </span>
                    <h3 className="font-bold text-base sm:text-lg text-red-950">
                      Cách làm truyền thống: 8 bước rườm rà qua 4 ứng dụng
                    </h3>
                  </div>
                </div>

                <div className="mt-2 text-xs font-semibold text-red-600 uppercase tracking-wider">
                  ⚠️ Chậm chạp • Rời rạc • Tốn 15–20 phút
                </div>

                <ul className="mt-5 space-y-3 text-xs sm:text-sm text-zinc-700">
                  <li className="flex items-start gap-2.5">
                    <span className="text-red-500 font-bold shrink-0 mt-0.5">1.</span>
                    <span>Lục tìm board &amp; list, tạo card thủ công trên Trello hoặc Jira.</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="text-red-500 font-bold shrink-0 mt-0.5">2.</span>
                    <span>Tìm kiếm tài khoản thành viên để gán người phụ trách.</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="text-red-500 font-bold shrink-0 mt-0.5">3.</span>
                    <span>Mở tab GitHub, tìm số hiệu Issue hoặc tạo Issue mới.</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="text-red-500 font-bold shrink-0 mt-0.5">4.</span>
                    <span>Copy đường dẫn Issue dán ngược lại vào mô tả thẻ công việc.</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="text-red-500 font-bold shrink-0 mt-0.5">5.</span>
                    <span>Chuyển sang ứng dụng Slack hoặc Teams, lục tìm kênh làm việc.</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="text-red-500 font-bold shrink-0 mt-0.5">6.</span>
                    <span>Soạn tin nhắn thông báo kèm đầy đủ đường link liên quan.</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="text-red-500 font-bold shrink-0 mt-0.5">7.</span>
                    <span>Mở Google Sheets cập nhật trạng thái nhật ký tiến độ.</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="text-red-500 font-bold shrink-0 mt-0.5">8.</span>
                    <span>Thao tác lặp đi lặp lại nhiều lần mỗi ngày gây mất tập trung và dễ sai sót.</span>
                  </li>
                </ul>
              </div>

              <div className="mt-6 pt-4 border-t border-red-200/60 text-xs text-red-700 font-medium">
                Kết quả: Tốn thời gian của nhân sự vào những công việc nhập liệu cơ học.
              </div>
            </div>

            {/* Cột SAU (Với AI Workflow Platform) */}
            <div className="bg-gradient-to-b from-blue-50/60 via-white to-indigo-50/40 border-2 border-blue-500/40 rounded-3xl p-6 sm:p-8 flex flex-col justify-between shadow-xl shadow-blue-500/5 relative overflow-hidden">
              <div className="absolute top-0 right-0 px-3.5 py-1 bg-gradient-to-l from-blue-600 to-indigo-600 text-white text-[11px] font-bold rounded-bl-2xl uppercase tracking-wider">
                Đột phá
              </div>

              <div>
                <div className="flex items-center justify-between pb-4 border-b border-blue-200/60">
                  <div className="flex items-center gap-2.5">
                    <span className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold text-sm shadow-md shadow-blue-500/20">
                      ✓
                    </span>
                    <h3 className="font-bold text-base sm:text-lg text-zinc-900">
                      Với AI Workflow: 1 câu lệnh tự nhiên duy nhất
                    </h3>
                  </div>
                </div>

                <div className="mt-2 text-xs font-semibold text-emerald-600 uppercase tracking-wider">
                  ⚡ Tức thì • Chính xác 100% • Tiết kiệm 80% thời gian
                </div>

                <ul className="mt-5 space-y-3.5 text-xs sm:text-sm text-zinc-800">
                  <li className="flex items-start gap-2.5">
                    <span className="text-blue-600 font-bold shrink-0 mt-0.5">1.</span>
                    <span>
                      <strong>Bạn chỉ cần chat một câu:</strong>
                      <span className="block mt-1 p-2 rounded-lg bg-white border border-blue-200 text-xs italic text-blue-900 font-medium">
                        &ldquo;Tạo task cập nhật trang chủ cho team Frontend, gán Minh trên Trello và thông báo vào Slack&rdquo;
                      </span>
                    </span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="text-emerald-600 font-bold shrink-0 mt-0.5">2.</span>
                    <span><strong>AI tự động phân giải đối tượng và lập kế hoạch</strong> đa bước hoàn chỉnh.</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="text-emerald-600 font-bold shrink-0 mt-0.5">3.</span>
                    <span><strong>Xem trước kế hoạch minh bạch:</strong> Bạn kiểm tra các bước trước khi thực thi.</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="text-emerald-600 font-bold shrink-0 mt-0.5">4.</span>
                    <span><strong>Đồng bộ đa dịch vụ tức thì:</strong> Trello card, GitHub issue và Slack alert được tạo đồng loạt chỉ sau một cú nhấp duyệt.</span>
                  </li>
                </ul>
              </div>

              <div className="mt-6 pt-4 border-t border-blue-200/60 text-xs text-blue-700 font-semibold flex items-center gap-1.5">
                <span>⚡</span>
                <span>Kết quả: Tiết kiệm hàng giờ mỗi tuần, công việc được đồng bộ liền mạch.</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Ecosystem Section */}
      <section id="ecosystem" className="py-16 sm:py-24 max-w-5xl mx-auto px-4 sm:px-6">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <span className="px-3 py-1 rounded-full bg-zinc-100 border border-zinc-200 text-zinc-700 font-semibold text-xs tracking-wide uppercase">
            Khả năng tích hợp mở rộng
          </span>
          <h2 className="text-2xl sm:text-4xl font-extrabold text-zinc-900 tracking-tight mt-3">
            Hệ sinh thái ứng dụng không giới hạn
          </h2>
          <p className="mt-3 text-sm sm:text-base text-zinc-500">
            Được xây dựng trên kiến trúc adapter mở, sẵn sàng tích hợp các công cụ làm việc yêu thích của bạn.
          </p>
        </div>

        {/* Integration Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-2xl bg-white border border-zinc-200 shadow-xs hover:border-blue-400 hover:shadow-md transition-all">
            <div className="font-bold text-sm text-zinc-900">GitHub</div>
            <p className="text-xs text-zinc-500 mt-1">Đồng bộ Issue, Repository và trạng thái code.</p>
          </div>
          <div className="p-4 rounded-2xl bg-white border border-zinc-200 shadow-xs hover:border-blue-400 hover:shadow-md transition-all">
            <div className="font-bold text-sm text-zinc-900">Trello</div>
            <p className="text-xs text-zinc-500 mt-1">Quản lý thẻ công việc, danh sách và thành viên.</p>
          </div>
          <div className="p-4 rounded-2xl bg-white border border-zinc-200 shadow-xs hover:border-blue-400 hover:shadow-md transition-all">
            <div className="font-bold text-sm text-zinc-900">Slack</div>
            <p className="text-xs text-zinc-500 mt-1">Gửi thông báo tức thì đến các kênh làm việc.</p>
          </div>
          <div className="p-4 rounded-2xl bg-white border border-zinc-200 shadow-xs hover:border-blue-400 hover:shadow-md transition-all">
            <div className="font-bold text-sm text-zinc-900">Google Sheets</div>
            <p className="text-xs text-zinc-500 mt-1">Ghi chép bảng tính và xuất báo cáo tự động.</p>
          </div>
          <div className="p-4 rounded-2xl bg-white border border-zinc-200 shadow-xs hover:border-blue-400 hover:shadow-md transition-all">
            <div className="font-bold text-sm text-zinc-900">Jira</div>
            <p className="text-xs text-zinc-500 mt-1">Điều phối công việc chuẩn Agile cho doanh nghiệp.</p>
          </div>
          <div className="p-4 rounded-2xl bg-white border border-zinc-200 shadow-xs hover:border-blue-400 hover:shadow-md transition-all">
            <div className="font-bold text-sm text-zinc-900">Notion</div>
            <p className="text-xs text-zinc-500 mt-1">Đồng bộ cơ sở tri thức và tài liệu dự án.</p>
          </div>
          <div className="p-4 rounded-2xl bg-white border border-zinc-200 shadow-xs hover:border-blue-400 hover:shadow-md transition-all">
            <div className="font-bold text-sm text-zinc-900">Gmail / Calendar</div>
            <p className="text-xs text-zinc-500 mt-1">Gửi email xác nhận và đặt lịch họp tự động.</p>
          </div>
          <div className="p-4 rounded-2xl bg-blue-50/60 border border-blue-200/80 shadow-xs flex flex-col justify-center text-center">
            <div className="font-bold text-sm text-blue-700">+ Thêm Dịch Vụ Mới</div>
            <p className="text-[11px] text-blue-600 mt-0.5">Adapter mở theo chuẩn Tool Catalog</p>
          </div>
        </div>
      </section>

      {/* 5. Enterprise Trust & Security Section */}
      <section id="security" className="py-16 sm:py-20 bg-zinc-900 text-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <span className="px-3 py-1 rounded-full bg-white/10 text-blue-300 font-semibold text-xs tracking-wide uppercase">
              Bảo mật &amp; Minh bạch
            </span>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight mt-3">
              An toàn tuyệt đối cho doanh nghiệp
            </h2>
            <p className="mt-2 text-xs sm:text-sm text-zinc-400">
              Thiết kế theo nguyên tắc an toàn dữ liệu và kiểm soát nghiêm ngặt.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-5 rounded-2xl bg-white/[0.04] border border-white/10">
              <div className="text-emerald-400 text-xl font-bold mb-2">🛡️ Human-in-the-Loop</div>
              <h3 className="text-sm font-semibold text-white">Xem trước &amp; Duyệt kế hoạch</h3>
              <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                Hệ thống chỉ thực hiện các thay đổi sau khi bạn đã kiểm tra và bấm phê duyệt kế hoạch.
              </p>
            </div>
            <div className="p-5 rounded-2xl bg-white/[0.04] border border-white/10">
              <div className="text-blue-400 text-xl font-bold mb-2">🔒 AES-256-GCM</div>
              <h3 className="text-sm font-semibold text-white">Mã hóa thông tin đăng nhập</h3>
              <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                Toàn bộ API token và khóa dịch vụ đều được mã hóa chặt chẽ khi lưu trữ trong PostgreSQL.
              </p>
            </div>
            <div className="p-5 rounded-2xl bg-white/[0.04] border border-white/10">
              <div className="text-purple-400 text-xl font-bold mb-2">🎯 Allowlist Control</div>
              <h3 className="text-sm font-semibold text-white">Kiểm soát phạm vi truy cập</h3>
              <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                Chỉ cho phép tương tác trong các repository, board và channel đã được quản trị viên cấp phép.
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
            <span>Đề tài 26 — Advanced Technology Integration (ATI)</span>
          </div>
          <div className="text-zinc-400">
            © 2026 ATI Project. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};
