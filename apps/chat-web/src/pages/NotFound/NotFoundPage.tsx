// Chép từ docs/design/prototypes/react/src/pages/NotFound/NotFoundPage.tsx (bản React của 404.html), FE-04b.
// Giữ nguyên markup và class. Khác bản React (đặc tả giao diện mục 1.1):
// - link /app-stage của bản React là "/" của app; chưa đăng nhập thì "/" là trang chủ nên nhãn nói "Về trang chủ";
// - nút Sáng/Tối đặt thẳng vào cụm bên phải thanh trên (bản React gắn bằng DOM vào đúng chỗ đó);
// - link đi bằng navigate của app (giữ href để mở tab mới vẫn đúng).
import type { MouseEvent } from 'react';
import { usePrototypePage, type PageMeta } from '../../prototype/usePrototypePage';
import { ThemeToggle } from '../../prototype/ThemeToggle';
import css from './page.css?inline';

// Đường dẫn đang mở, như script DOMContentLoaded của 404.html.
function badPath() {
  const { pathname, search } = window.location;
  if (pathname && pathname !== '/' && pathname !== '/404' && !pathname.endsWith('404.html')) return pathname + search;
  return search ? search : '/duong-dan-khong-ton-tai';
}

export const meta: PageMeta = {
  id: '404',
  title: '404 — Không tìm thấy trang · ATI',
  htmlClass: '',
  bodyClass: 'min-h-screen flex flex-col bg-[#F8F8F6] text-[#111827]',
  css,
};

export function NotFoundPage({ signedIn, navigate }: { signedIn: boolean; navigate: (path: string) => void }) {
  usePrototypePage(meta);
  const go = (path: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(path);
  };
  const actions = {
    historyBackFallback() {
      if (window.history.length > 1) window.history.back();
      else navigate('/');
    },
  };
  const home = signedIn ? { header: 'Về không gian làm việc', title: 'Quay lại không gian làm việc', logo: 'Về sân khấu điều phối', main: 'Về không gian làm việc chính', footer: 'Không gian làm việc' }
    : { header: 'Về trang chủ', title: 'Về trang chủ', logo: 'Về trang chủ', main: 'Về trang chủ', footer: 'Trang chủ' };
  return (
    <>
      {/* 1. Thanh điều hướng chuẩn cockpit */}
      <header className="sticky top-0 z-40 w-full bg-[#F8F8F6]/90 backdrop-blur-md border-b border-[#E7E7E2] px-4 sm:px-6 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
          {/* Cụm Logo & Quay lại */}
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <a href="/" onClick={go('/')} className="flex items-center gap-2.5 group flex-shrink-0" title={home.logo}>
              <div className="w-8 h-8 rounded-lg bg-[#FF5701] flex items-center justify-center text-white font-display font-bold text-lg shadow-sm group-hover:scale-105 transition-transform">
                A
              </div>
              <span className="font-display font-bold text-lg tracking-tight text-[#111827]">
                ATI
              </span>
            </a>
            <div className="h-4 w-px bg-[#E7E7E2] flex-shrink-0" />
            <a href="/" onClick={go('/')} className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-[#4B5563] hover:text-[#111827] transition-colors py-1 px-2 rounded-lg hover:bg-black/5" title={home.title}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              <span className="hidden sm:inline">
                {home.header}
              </span>
              <span className="sm:hidden">
                Quay lại
              </span>
            </a>
            <span className="hidden md:inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-neutral-200/70 text-[#4B5563]">
              Mã sự cố: 404
            </span>
          </div>
          {/* Mã sự cố */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <ThemeToggle />
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-neutral-200/70 text-[#4B5563]">
              Mã lỗi: 404
            </span>
          </div>
        </div>
      </header>
      {/* 2. Nội dung chính 404 */}
      <main className="flex-1 flex flex-col items-center justify-center max-w-xl w-full mx-auto px-4 sm:px-6 py-12 sm:py-16">
        {/* Hero 404 Section */}
        <section className="text-center v3-space-y-5 max-w-xl mx-auto">
          <div className="relative inline-block select-none">
            {' '}
            <span className="font-display font-bold text-8xl sm:text-9xl text-neutral-200 tracking-tight block">
              404
            </span>
            <div className="absolute inset-0 flex items-center justify-center">
              <h1 className="font-display font-bold text-2xl sm:text-3xl text-[#111827] px-4 py-1 bg-[#F8F8F6]/80 backdrop-blur-sm rounded-lg">
                Không tìm thấy trang
              </h1>
            </div>
            {' '}
          </div>
          {' '}
          {/* Hiển thị đường dẫn không tồn tại */}
          {' '}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-neutral-200/60 border border-[#E7E7E2] text-xs font-mono text-[#4B5563] max-w-full overflow-hidden text-ellipsis whitespace-nowrap">
            <span className="text-neutral-500 font-sans">
              Đường dẫn:
            </span>
            <span id="current-bad-path" className="text-[#DC2626] font-semibold">
              {badPath()}
            </span>
          </div>
          {' '}
          <p className="text-sm text-[#4B5563] leading-relaxed">
            Đường dẫn bạn vừa truy cập không tồn tại trên hệ thống ATI, đã được đổi tên hoặc chuyển sang vị trí khác. Lỗi điều hướng này không thay đổi dữ liệu công việc của bạn.
          </p>
          {/* Hành động điều hướng chính */}
          <div className="flex flex-wrap items-center justify-center gap-3 pt-3">
            <a href="/" onClick={go('/')} className="px-5 py-2.5 min-h-[44px] rounded-xl bg-[#FF5701] hover:bg-[#e04d00] text-white text-xs font-semibold shadow-sm transition-colors inline-flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              <span>
                {home.main}
              </span>
            </a>
            <button type="button" onClick={() => actions.historyBackFallback()} className="px-4 py-2.5 min-h-[44px] rounded-xl bg-white hover:bg-neutral-50 text-[#4B5563] hover:text-[#111827] text-xs font-medium border border-[#E7E7E2] transition-colors inline-flex items-center justify-center">
              ← Quay lại trang trước
            </button>
          </div>
        </section>
      </main>
      {/* 4. Chân trang đơn giản */}
      <footer className="mt-auto border-t border-[#E7E7E2] py-4 px-4 text-center text-xs text-[#6B7280]">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>
            ATI · 2026 — Hệ thống điều phối tác vụ an toàn &amp; minh bạch
          </span>
          <div className="flex items-center gap-3">
            <a href="/" onClick={go('/')} className="hover:text-[#111827] transition-colors">
              {home.footer}
            </a>
            <span>
              ·
            </span>
            <a href="/privacy" onClick={go('/privacy')} className="text-[#FF5701] hover:underline font-medium transition-colors">
              Chính sách an toàn
            </a>
          </div>
        </div>
      </footer>
    </>
  );
}
