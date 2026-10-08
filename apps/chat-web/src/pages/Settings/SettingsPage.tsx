// Ported from PROTO-01 SettingsPage: source markup/classes and page.css retained.
import { useLayoutEffect, useRef } from 'react';
import { usePrototypePage } from '../../prototype/usePrototypePage';
import { ThemeToggle } from '../../prototype/ThemeToggle';
import { UserNavMenu } from '../../components/layout/UserNavMenu';
import { ServiceLogo } from '../../components/ServiceLogo';
import type { User } from '../../types';
import { type Service } from './data';
import { useSettings } from './useSettings';
import { meta } from './meta';

const SAVED_PLACEHOLDER = 'Đã lưu · nhập lại nếu muốn thay';
const WARNING_PATH = 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z';
const resultIcon = (color: string, d: string) => <svg className={`w-4 h-4 ${color}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={d} /></svg>;
const RESULT = {
  saved: { box: 'p-3.5 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-xs leading-relaxed', icon: resultIcon('text-amber-600', WARNING_PATH) },
  success: { box: 'p-3.5 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-900 text-xs leading-relaxed', icon: resultIcon('text-[#16A34A]', 'M5 13l4 4L19 7') },
  rejected: { box: 'p-3.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-900 text-xs leading-relaxed', icon: resultIcon('text-[#DC2626]', WARNING_PATH) },
  timeout: { box: 'p-3.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-900 text-xs leading-relaxed', icon: resultIcon('text-rose-600', 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z') },
};
// getStatusBadgeHtml.
function StatusBadge({ service }: { service: Service }) {
  const timeStr = service.lastCheckTime ? ` · kiểm tra lúc ${service.lastCheckTime}` : '';
  if (!service.configured) {
    return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-neutral-100 text-[#6B7280] border border-[#E7E7E2]">
      <span className="w-1.5 h-1.5 rounded-full bg-[#9CA3AF]" />
      <span>{`Chưa kết nối${timeStr}`}</span>
    </span>;
  }
  if (service.statusType === 'untested') {
    return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
      <span>{`Chưa kiểm tra${timeStr}`}</span>
    </span>;
  }
  if (service.statusType === 'ok') {
    return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
      <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A]" />
      <span>{`Kết nối tốt${timeStr}`}</span>
    </span>;
  }
  if (service.statusType === 'failed') {
    return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200">
      <span className="w-1.5 h-1.5 rounded-full bg-[#DC2626]" />
      <span>{`Không kết nối được${timeStr}`}</span>
    </span>;
  }
  return null;
}

// renderServiceRowHtml.
function ServiceRow({ service, onOpen }: { service: Service; onOpen: (id: string) => void }) {
  return <div
    role="button"
    tabIndex={0}
    id={`service-row-${service.id}`}
    onClick={() => onOpen(service.id)}
    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(service.id); } }}
    className="group bg-white hover:bg-[#FDFDFD] border border-[#E7E7E2] hover:border-[#FF5701]/40 rounded-xl p-4 sm:p-5 transition-all shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer focus-visible:ring-2 focus-visible:ring-[#FF5701] focus-visible:v3-outline-none"
    aria-haspopup="dialog"
    aria-label={`${service.name} — bấm để xem chi tiết kết nối`}
  >
    <div className="flex items-start sm:items-center gap-3.5 min-w-0">
      <div className="w-10 h-10 rounded-xl bg-[#F8F8F6] border border-[#E7E7E2] flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform">
        <ServiceLogo service={service.id} className="w-6 h-6" />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="font-display font-semibold text-base text-[#111827] group-hover:text-[#FF5701] transition-colors">
            {service.name}
          </h3>
        </div>
        <p className="text-xs text-[#4B5563] mt-0.5 line-clamp-1 sm:line-clamp-2">
          {service.capabilities}
        </p>
      </div>
    </div>
    <div className="flex items-center justify-between sm:justify-end gap-3 flex-shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-[#E7E7E2]/60">
      <div><StatusBadge service={service} /></div>
      <div className="text-[#6B7280] group-hover:text-[#FF5701] transition-colors">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
      </div>
    </div>
  </div>;
}

export interface SettingsPageProps { user: User | null; navigate: (path: string) => void; onLogout: () => void; authToken?: string | null }
export function SettingsPage({ user, navigate, onLogout }: SettingsPageProps) {
  usePrototypePage(meta);
  const { list, active, draft, selected, loading, loadError, refresh, canEdit, errors, results, busy, keyHelpOpen, actions } = useSettings(user);
  const backgroundRef = useRef<HTMLDivElement>(null), containerRef = useRef<HTMLDivElement>(null), closeButtonRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(actions.closeServiceDrawer); closeRef.current = actions.closeServiceDrawer;
  useLayoutEffect(() => {
    if (!active || !containerRef.current) return;
    const id = active.id, dialog = containerRef.current, background = backgroundRef.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; background?.setAttribute('inert', ''); background?.setAttribute('aria-hidden', 'true');
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')).filter(el => !el.closest('.hidden,[hidden]'));
    const focusFirst = () => (closeButtonRef.current ?? dialog).focus(); focusFirst();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const elements = focusable(), first = elements[0], last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    const focusin = (event: FocusEvent) => { if (!dialog.contains(event.target as Node)) focusFirst(); };
    window.addEventListener('keydown', keydown); document.addEventListener('focusin', focusin);
    return () => {
      window.removeEventListener('keydown', keydown); document.removeEventListener('focusin', focusin);
      document.body.style.overflow = overflow; background?.removeAttribute('inert'); background?.removeAttribute('aria-hidden');
      document.getElementById(`service-row-${id}`)?.focus();
    };
  }, [active?.id]);
  const role = canEdit ? 'admin' : 'member', drawer = active ? { service: active } : null, badge = active;
  const configured = list.filter(s => s.configured), unconfigured = list.filter(s => !s.configured), okCount = configured.filter(s => s.statusType === 'ok').length;
  const hasCatalogue = list.length > 0;
  const isMemberDrawer = !canEdit, scopeLabel = active?.scopeLabel;
  const scope = draft ? { items: draft.scopes, isMember: isMemberDrawer, scopeLabel: scopeLabel ?? 'tài nguyên' } : null;
  const savedPlaceholder = !!active?.configured, hint = { visible: !!active?.hint, text: active?.hint };
  const saveError = { visible: !!errors[selected ?? ''], text: errors[selected ?? ''] };
  const scopeError = { visible: !!draft && draft.scopes.length === 0, text: `Cần ít nhất một ${scopeLabel}.` };
  const newScopeInvalid = !!active?.scopePattern && !!errors[active.id]?.startsWith('Định dạng');
  const testButton = { disabled: !active?.configured || !!busy[selected ?? ''], dim: !active?.configured, spinning: busy[selected ?? ''] === 'test' };
  const result = results[selected ?? ''] ?? { kind: null, visible: false, message: '', time: '' };
  const visibleResult = !!results[selected ?? ''];
  return <>
    <div ref={backgroundRef} className="contents" onClick={event => {
      const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
      if (anchor && anchor.origin === window.location.origin && !anchor.target && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigate(`${anchor.pathname}${anchor.search}${anchor.hash}`); }
    }}>
      {/* THANH TRÊN (COCKPIT HEADER) */}
      <header className="sticky top-0 z-30 w-full bg-[#F8F8F6]/90 backdrop-blur-md border-b border-[#E7E7E2] px-4 sm:px-6 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          {/* Cụm Logo & Điều hướng quay lại */}
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <a href="/" className="flex items-center gap-2.5 group flex-shrink-0" title="Về sân khấu điều phối">
              <div className="w-8 h-8 rounded-lg bg-[#FF5701] flex items-center justify-center text-white font-display font-bold text-lg shadow-sm group-hover:scale-105 transition-transform">
                A
              </div>
              <span className="font-display font-bold text-lg tracking-tight text-[#111827]">
                ATI
              </span>
            </a>
            <div className="h-4 w-px bg-[#E7E7E2] flex-shrink-0" />
            <a href="/" className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-[#4B5563] hover:text-[#111827] transition-colors py-1 px-2 rounded-lg hover:bg-black/5" title="Quay lại không gian làm việc">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              <span className="hidden sm:inline">
                Về không gian làm việc
              </span>
              <span className="sm:hidden">
                Quay lại
              </span>
            </a>
            <div className="hidden md:block h-4 w-px bg-[#E7E7E2] flex-shrink-0" />
            <a href="/history" className="hidden md:inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-[#4B5563] hover:text-[#111827] transition-colors py-1 px-2 rounded-lg hover:bg-black/5" title="Mở trang Nhật ký điều phối">
              <svg className="w-4 h-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {' '}
              <span>
                Nhật ký
              </span>
            </a>
            <div className="hidden md:block h-4 w-px bg-[#E7E7E2] flex-shrink-0" />
            <a href="/guide" className="hidden md:inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-[#4B5563] hover:text-[#111827] transition-colors py-1 px-2 rounded-lg hover:bg-black/5" title={"Cẩm nang kết nối & Mẫu câu lệnh"}>
              <svg className="w-4 h-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              {' '}
              <span>
                Cẩm nang
              </span>
            </a>
          </div>
          {/* Cụm Trạng thái Vai trò & Điều khiển */}
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            {/* Nhãn vai trò hiện tại */}
            <div id="role-pill-badge" className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-white border border-[#E7E7E2] text-[#4B5563] shadow-sm">
              <span className={`w-2 h-2 rounded-full ${role === 'admin' ? 'bg-[#16A34A]' : 'bg-[#6B7280]'}`} id="role-indicator-dot" />
              <span id="role-name-display">
                {role === 'admin' ? 'Quản trị viên' : 'Thành viên'}
              </span>
            </div>
            <ThemeToggle />
            <UserNavMenu variant="prototype" user={user} navigate={navigate} onOpenSettings={() => navigate('/settings')} onOpenAccount={() => navigate('/account')} onManageUsers={() => navigate('/admin/users')} onLogout={onLogout} />
          </div>
        </div>
      </header>
      {/* NỘI DUNG CHÍNH */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 py-8 sm:py-10">
        {/* Tiêu đề trang & Nguyên tắc */}
        <div className="mb-8 sm:mb-10">
          <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 mb-3">
            <h1 className="font-display text-3xl sm:text-4xl font-bold text-[#111827] tracking-tight">
              Kết nối dịch vụ
            </h1>
            {hasCatalogue && <div className="inline-flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#16A34A]" />
              <span id="summary-connected-count" className="text-sm sm:text-base font-semibold text-[#111827]">
                {`${configured.length} / 8 dịch vụ đã thiết lập · ${okCount} kết nối tốt`}
              </span>
            </div>}
          </div>
          {/* Khung nguyên tắc an toàn dữ liệu */}
          <div className="bg-white rounded-xl p-4 sm:p-5 border border-[#E7E7E2] shadow-sm flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-[#FF5701]/10 text-[#FF5701] flex items-center justify-center flex-shrink-0 mt-0.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <div className="text-xs sm:text-sm text-[#4B5563] leading-relaxed">
              <strong className="text-[#111827] font-semibold">
                Nguyên tắc an toàn của nhóm:
              </strong>
              {" ATI chỉ đọc và ghi ở những nơi bạn chọn bên dưới. Khoá được mã hoá khi lưu và không hiển thị lại."}
            </div>
          </div>
        </div>
        {loading && <p role="status" className="text-xs text-[#6B7280]">Đang tải dịch vụ...</p>}
        {loadError && <div role="alert" className="text-xs text-[#DC2626] mb-4">{loadError} <button type="button" onClick={() => void refresh()} className="underline">Thử lại</button></div>}
        {/* DANH SÁCH 2 NHÓM DỊCH VỤ */}
        {hasCatalogue && <div className="v3-space-y-8 sm:v3-space-y-10">
          {/* Nhóm 1: Đã thiết lập */}
          <section aria-labelledby="heading-connected-services">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2 mb-3.5">
              <h2 id="heading-connected-services" className="text-xs font-bold uppercase tracking-wider text-[#6B7280] flex items-center gap-2 whitespace-nowrap">
                <span>
                  Đã thiết lập
                </span>
                <span id="badge-count-connected" className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#16A34A]/10 text-[#16A34A]">
                  {configured.length}
                </span>
              </h2>
              <span className="text-xs text-[#6B7280]">
                Bấm vào hàng để xem hoặc đổi nơi được dùng
              </span>
            </div>
            <div id="list-connected-services" className="v3-space-y-3" role="list">
              {configured.length === 0
                ? <div className="p-6 text-center text-xs text-[#6B7280] bg-white rounded-xl border border-[#E7E7E2]">Chưa có dịch vụ nào được thiết lập.</div>
                : configured.map(s => <ServiceRow key={s.id} service={s} onOpen={actions.openServiceDrawer} />)}
            </div>
          </section>
          {/* Nhóm 2: Chưa thiết lập */}
          <section aria-labelledby="heading-unconnected-services">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2 mb-3.5">
              <h2 id="heading-unconnected-services" className="text-xs font-bold uppercase tracking-wider text-[#6B7280] flex items-center gap-2 whitespace-nowrap">
                <span>
                  Chưa thiết lập
                </span>
                <span id="badge-count-unconnected" className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-neutral-200 text-[#4B5563]">
                  {unconfigured.length}
                </span>
              </h2>
              <span className="text-xs text-[#6B7280]">
                Bấm để thêm khoá truy cập và kích hoạt
              </span>
            </div>
            <div id="list-unconnected-services" className="v3-space-y-3" role="list">
              {unconfigured.length === 0
                ? <div className="p-6 text-center text-xs text-[#6B7280] bg-white rounded-xl border border-[#E7E7E2]">Tất cả 8 dịch vụ đều đã được thiết lập.</div>
                : unconfigured.map(s => <ServiceRow key={s.id} service={s} onOpen={actions.openServiceDrawer} />)}
            </div>
          </section>
        </div>}
        {/* Chú thích chân trang */}
        <div className="mt-12 pt-6 border-t border-[#E7E7E2] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#6B7280]">
          <div>
            <p>
              ATI — Nền tảng điều phối công việc liên dịch vụ · 2026
            </p>
            <p className="text-[11px] text-[#9CA3AF] mt-0.5">
              Khoá dịch vụ là tài nguyên dùng chung của cả nhóm · Chỉ quản trị viên có quyền cập nhật
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <a href="/" className="hover:text-[#111827] transition-colors">
              Không gian làm việc
            </a>
            <a href="/guide" className="hover:text-[#111827] transition-colors">
              Cẩm nang
            </a>
            <a href="/privacy" className="text-[#FF5701] hover:underline font-medium transition-colors">
              Chính sách an toàn &amp; Dữ liệu
            </a>
          </div>
        </div>
      </main>
    </div>
    {drawer && draft && <>
      {/* ============================================================= */}
      {/* NGĂN CHI TIẾT DỊCH VỤ (DRAWER DIALOG / FULLSCREEN MOBILE) */}
      {/* ============================================================= */}
      <div ref={containerRef} tabIndex={-1} id="service-drawer-container" className="fixed inset-0 z-50 overflow-hidden" role="dialog" aria-modal="true" aria-labelledby="drawer-service-title">
        {/* Lớp nền mờ (Backdrop) */}
        <div id="drawer-backdrop" className={`drawer-backdrop fixed inset-0 bg-black/40 opacity-100 transition-opacity`} onClick={() => actions.closeServiceDrawer()} />
        <div className="fixed inset-y-0 right-0 max-w-full flex">
          {/* Panel ngăn chi tiết */}
          <div id="drawer-panel" className={`drawer-panel w-screen sm:max-w-xl bg-white shadow-2xl flex flex-col translate-x-0 border-l border-[#E7E7E2] transition-transform`}>
            {/* Header của ngăn chi tiết */}
            <div className="px-5 sm:px-6 py-4 border-b border-[#E7E7E2] flex items-center justify-between gap-3 bg-[#F8F8F6]">
              <div className="flex items-center gap-3 min-w-0">
                <div id="drawer-icon-container" className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm">
                  <ServiceLogo service={drawer.service.id} className="w-6 h-6" />
                </div>
                <div className="min-w-0">
                  <h2 id="drawer-service-title" className="font-display text-xl font-bold text-[#111827] truncate">
                    {drawer.service.name}
                  </h2>
                  <div id="drawer-header-status-badge" className="mt-0.5">
                    {badge ? <StatusBadge service={badge} /> : null}
                  </div>
                </div>
              </div>
              <button ref={closeButtonRef} type="button" id="btn-close-drawer" onClick={() => actions.closeServiceDrawer()} className="p-2 text-[#6B7280] hover:text-[#111827] rounded-lg hover:bg-neutral-200 transition-colors" aria-label="Đóng ngăn chi tiết">
                {' '}
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
                {' '}
              </button>
            </div>
            {/* Cảnh báo thành viên thường (nếu role == 'member') */}
            <div id="drawer-member-warning" className={`${isMemberDrawer ? '' : 'hidden '}px-5 sm:px-6 py-2.5 bg-amber-50 border-b border-amber-200 text-xs text-amber-800 flex items-center gap-2`}>
              <svg className="w-4 h-4 text-amber-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>
                {"Chỉ quản trị viên thay đổi được khoá dùng chung của nhóm. Bạn vẫn có thể bấm "}
                <strong>
                  Kiểm tra kết nối
                </strong>
                {" ở mục 3."}
              </span>
            </div>
            {/* Thân ngăn chi tiết (Cuộn dọc) */}
            <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-6 v3-space-y-8" id="drawer-body">
              {/* PHẦN 1: KHOÁ TRUY CẬP */}
              <section aria-labelledby="section-keys-title" className="v3-space-y-4">
                <div className="flex items-center justify-between gap-2 border-b border-[#E7E7E2] pb-2">
                  <h3 id="section-keys-title" className="text-sm font-bold uppercase tracking-wider text-[#111827] flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#111827] text-white text-xs flex items-center justify-center font-bold">
                      1
                    </span>
                    <span>
                      Khoá truy cập
                    </span>
                  </h3>
                  {/* Nút toggle Lấy khoá ở đâu? */}
                  <button type="button" id="btn-toggle-key-help" aria-expanded={keyHelpOpen} aria-controls="key-help-box" onClick={() => actions.toggleKeyHelp()} className="text-xs text-[#FF5701] hover:underline font-medium inline-flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>
                      Lấy khoá ở đâu?
                    </span>
                  </button>
                </div>
                {/* Hộp hướng dẫn Lấy khoá ở đâu (Ẩn mặc định) */}
                <div id="key-help-box" className={`${keyHelpOpen ? '' : 'hidden '}bg-[#F8F8F6] p-3.5 rounded-xl border border-[#E7E7E2] text-xs text-[#4B5563] leading-relaxed`}>
                  <p id="key-help-text">
                    {drawer ? drawer.service.keyHelp : 'Hướng dẫn lấy khoá...'}
                  </p>
                  <div className="mt-2.5 pt-2 border-t border-[#E7E7E2]">
                    <a id="key-help-guide-link" href={drawer.service.guideUrl ?? "/guide"} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#FF5701] hover:underline">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                      </svg>
                      <span>
                        Mở hướng dẫn chính thức của dịch vụ →
                      </span>
                    </a>
                  </div>
                </div>
                {/* Gợi ý riêng của dịch vụ (nếu có) */}
                <div id="service-specific-hint" className={`${hint.visible ? '' : 'hidden '}text-xs text-[#6B7280] italic bg-blue-50/70 p-2.5 rounded-lg border border-blue-100 flex items-center gap-2 text-blue-900`}>
                  <svg className="w-4 h-4 text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span id="service-specific-hint-text">
                    {hint.text}
                  </span>
                </div>
                {/* Các ô nhập khoá (Dynamic), renderDrawerKeyInputs */}
                <div id="drawer-key-fields" className="v3-space-y-3.5">
                  {drawer?.service.keyInputs.map(input => {
                    const needsFormatValidation = !!input.pattern;
                    const fieldInvalid = !!input.pattern && !!draft.credentials[input.key] && !new RegExp(input.pattern).test(draft.credentials[input.key]);
                    const placeholder = savedPlaceholder ? SAVED_PLACEHOLDER : input.placeholder;
                    const locked = isMemberDrawer ? ' bg-neutral-100 cursor-not-allowed' : '';
                    return (
                      <div key={input.id}>
                        <label htmlFor={input.id} className="block text-xs font-semibold text-[#111827] mb-1.5">
                          {input.label}
                          {' '}
                          <span className="text-[#FF5701]">*</span>
                        </label>
                        {input.type === 'textarea'
                          ? <textarea id={input.id} aria-label={input.label} rows={3} disabled={isMemberDrawer} value={draft.credentials[input.key] ?? ""} onChange={event => actions.onKeyInputChanged(input.key, event.target.value)} autoComplete="off" spellCheck={false} placeholder={placeholder} className={`key-input-field w-full text-xs font-mono px-3 py-2 bg-[#F8F8F6] border border-[#E7E7E2] rounded-lg text-[#111827] focus:bg-white focus:v3-outline-none focus:border-[#FF5701] transition-all resize-y${locked}`} />
                          : <input type={input.type} id={input.id} aria-label={input.label} disabled={isMemberDrawer} value={draft.credentials[input.key] ?? ""} onChange={event => actions.onKeyInputChanged(input.key, event.target.value)} autoComplete="off" spellCheck={false} placeholder={placeholder} className={`key-input-field w-full text-xs sm:text-sm px-3 py-2 bg-[#F8F8F6] border border-[#E7E7E2] rounded-lg text-[#111827] focus:bg-white focus:v3-outline-none focus:border-[#FF5701] transition-all${locked}${needsFormatValidation && fieldInvalid ? ' border-rose-400' : ''}`} />}
                        {needsFormatValidation ? (
                          <p id={`${input.id}-format-hint`} className={`${fieldInvalid ? '' : 'hidden '}text-[11px] text-[#DC2626] font-medium mt-1`}>
                            {input.formatHint}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
              {/* PHẦN 2: NƠI ATI ĐƯỢC PHÉP DÙNG */}
              <section aria-labelledby="section-scope-title" className="v3-space-y-4">
                <div className="border-b border-[#E7E7E2] pb-2">
                  <h3 id="section-scope-title" className="text-sm font-bold uppercase tracking-wider text-[#111827] flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#111827] text-white text-xs flex items-center justify-center font-bold">
                      2
                    </span>
                    <span>
                      Nơi ATI được phép dùng
                    </span>
                  </h3>
                  <p className="text-xs text-[#6B7280] mt-1" id="scope-description-text">
                    {scopeLabel ? `ATI chỉ đọc và ghi ở những ${scopeLabel} trong danh sách này.` : 'ATI chỉ đọc và ghi ở những nơi trong danh sách này.'}
                  </p>
                </div>
                {/* Danh sách Chip các nơi được phép dùng, renderScopeChips */}
                <div>
                  <div id="scope-chips-container" className="flex flex-wrap gap-2 mb-3 min-h-[32px]">
                    {scope && scope.items.length === 0 ? (
                      <span className="text-xs text-[#6B7280] italic py-1">{`Chưa có ${scope.scopeLabel} nào được cấp quyền.`}</span>
                    ) : scope?.items.map((item, idx) => (
                      <div key={`${idx}-${item}`} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs bg-[#F8F8F6] border border-[#E7E7E2] text-[#111827] shadow-sm">
                        <span className="font-mono text-[11px] truncate max-w-[200px] sm:max-w-[260px]">{item}</span>
                        {!scope.isMember ? (
                          <button type="button" onClick={() => actions.removeScopeItem(idx)} className="text-[#6B7280] hover:text-[#DC2626] transition-colors p-0.5 rounded-full hover:bg-neutral-200" aria-label={`Xoá mục ${item}`}>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  <p id="scope-empty-error" className={`${scopeError.visible ? '' : 'hidden '}text-xs text-[#DC2626] font-medium mb-2`}>
                    {scopeError.text}
                  </p>
                </div>
                {/* Ô thêm mới nơi được phép dùng */}
                <div id="scope-add-form" className={`${isMemberDrawer ? 'hidden ' : ''}v3-space-y-1.5`}>
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <label id="scope-input-label" htmlFor="new-scope-input" className="sr-only">
                        {scopeLabel ? `Thêm ${scopeLabel}` : 'Thêm mục mới'}
                      </label>
                      {' '}
                      <input type="text" id="new-scope-input" value={draft.newScope} onChange={event => actions.onScopeInputChanged(event.target.value)} disabled={isMemberDrawer} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); actions.addNewScopeItem(); } }} placeholder={scopeLabel ? `Nhập ${scopeLabel} mới (ví dụ)...` : 'Nhập ID mới...'} className={`w-full text-xs sm:text-sm px-3 py-2 bg-[#F8F8F6] border border-[#E7E7E2] rounded-lg text-[#111827] focus:bg-white focus:v3-outline-none focus:border-[#FF5701] transition-all${newScopeInvalid ? ' border-rose-400' : ''}`} />
                    </div>
                    <button type="button" id="btn-add-scope" aria-label="Thêm" onClick={() => actions.addNewScopeItem()} className="px-3.5 py-2 text-xs sm:text-sm font-medium text-[#111827] bg-[#F8F8F6] hover:bg-neutral-200 border border-[#E7E7E2] rounded-lg transition-colors flex-shrink-0">
                      {" + Thêm "}
                    </button>
                  </div>
                  <p id="new-scope-format-hint" className={`${newScopeInvalid ? '' : 'hidden '}text-[11px] text-[#DC2626] font-medium`}>
                    {drawer.service.scopeError}
                  </p>
                </div>
              </section>
              {/* KHỐI LƯU THAY ĐỔI (Trước khi kiểm tra) */}
              <div className="bg-[#F8F8F6] p-4 rounded-xl border border-[#E7E7E2] v3-space-y-3">
                <p className="text-xs text-[#4B5563] leading-relaxed">
                  <strong className="text-[#111827]">
                    Lưu ý khi cập nhật:
                  </strong>
                  {" Khi đổi khoá, nhập lại đủ các ô khoá bên trên. Chỉ đổi nơi được dùng thì không cần nhập lại khoá."}
                </p>
                <div id="save-validation-error" role="alert" className={`${saveError.visible ? '' : 'hidden '}text-xs text-[#DC2626] font-medium`}>
                  {saveError.text}
                </div>
                <button type="button" id="btn-save-service-changes" disabled={isMemberDrawer || !!busy[drawer.service.id]} onClick={() => void actions.saveServiceChanges()} className={`w-full py-2.5 px-4 text-xs sm:text-sm font-semibold text-white bg-[#FF5701] hover:bg-[#e04d01] rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2${isMemberDrawer ? ' opacity-50 cursor-not-allowed' : ''}`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                  </svg>
                  <span>
                    Lưu thay đổi
                  </span>
                </button>
              </div>
              {/* PHẦN 3: KIỂM TRA KẾT NỐI */}
              <section aria-labelledby="section-test-title" className="v3-space-y-4 pt-2 border-t border-[#E7E7E2]">
                <div className="border-b border-[#E7E7E2] pb-2">
                  <h3 id="section-test-title" className="text-sm font-bold uppercase tracking-wider text-[#111827] flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#111827] text-white text-xs flex items-center justify-center font-bold">
                      3
                    </span>
                    <span>
                      Kiểm tra kết nối
                    </span>
                  </h3>
                  <p className="text-xs text-[#6B7280] mt-1">
                    Gửi một tín hiệu kiểm tra tới máy chủ dịch vụ để xác nhận khoá và quyền hạn vẫn hợp lệ.
                  </p>
                </div>
                {/* Nút bấm kiểm tra */}
                <div>
                  <button type="button" id="btn-run-test-connection" disabled={testButton.disabled} aria-describedby={!drawer.service.configured ? "test-unconfigured-note" : undefined} onClick={() => void actions.runTestConnection()} className={`w-full py-2.5 px-4 text-xs sm:text-sm font-semibold text-[#111827] bg-white ${testButton.dim ? 'opacity-50 cursor-not-allowed' : 'hover:bg-neutral-50'} border border-[#E7E7E2] rounded-lg shadow-sm transition-all flex items-center justify-center gap-2`}>
                    {/* Icon hoặc Spinner */}
                    <svg id="test-btn-icon" className={`${testButton.spinning ? 'hidden ' : ''}w-4 h-4 text-[#FF5701]`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    <svg id="test-btn-spinner" className={`${testButton.spinning ? '' : 'hidden '}w-4 h-4 animate-spin text-[#FF5701]`} fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span id="test-btn-text">
                      {testButton.spinning ? 'Đang kiểm tra kết nối...' : 'Kiểm tra kết nối'}
                    </span>
                  </button>
                  <p id="test-unconfigured-note" className={`${testButton.dim ? '' : 'hidden '}text-xs text-[#6B7280] mt-1.5 leading-relaxed`}>
                    Lưu khoá và ít nhất một nơi được dùng trước, rồi mới kiểm tra được.
                  </p>
                </div>
                {/* Kết quả kiểm tra (aria-live="polite") */}
                <div id="test-result-box" className={`${result.kind ? RESULT[result.kind].box : 'p-3.5 rounded-xl border text-xs leading-relaxed'}${visibleResult ? '' : ' settings-result-empty'}`} aria-live="polite">
                  <div className="flex items-start gap-2.5">
                    <span id="test-result-icon" className="mt-0.5 flex-shrink-0">
                      {result.kind ? RESULT[result.kind].icon : null}
                    </span>
                    <div className="flex-1">
                      <p id="test-result-message" className="font-medium">
                        {result.message}
                      </p>
                      <p id="test-result-time" className="text-[11px] text-[#6B7280] mt-0.5">
                        {result.time ? `Thời gian ghi nhận: ${result.time}` : null}
                      </p>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </>}
  </>;
}
