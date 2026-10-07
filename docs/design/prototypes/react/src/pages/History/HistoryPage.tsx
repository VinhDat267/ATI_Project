// Chuyển từ docs/design/prototypes/history.html bằng scripts/html-to-jsx.mjs, sau đó sửa tay.
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { usePrototypePage, type PageMeta } from '../../app/usePrototypePage';
import { navigate } from '../../app/router';
import css from './page.css?inline';
import { INITIAL_REQUESTS, SAMPLE_REQUEST, SERVICE_SVGS, type HistoryRequest } from './data';

type Role = 'admin' | 'member';
type QuickFilter = 'all' | 'today' | 'has_github' | 'needs_attention';
type ToastType = 'success' | 'error' | 'info';
type Toast = { id: number; message: string; type: ToastType; leaving: boolean };
type Filters = { keyword: string; status: string; service: string; quick: QuickFilter };
type Stats = { total: number; completed: number; paused: number; cancelled: number };
// Ảnh chụp danh sách tại lần vẽ gần nhất (renderRequestsList). version đổi mỗi lần vẽ để thẻ dựng lại như innerHTML mới
// (ô đổi tên lấy lại tiêu đề đã lưu, mất focus); remaining là số trên nút Tải thêm, giữ nguyên khi nút ẩn.
type ListView = { version: number; displayed: HistoryRequest[]; editingId: string | null; empty: boolean; loadMore: boolean; remaining: number | null };

const ROLE_ON = 'px-2 py-1.5 rounded-lg text-center font-medium bg-[#FF5701] text-white transition-colors';
const ROLE_OFF = 'px-2 py-1.5 rounded-lg text-center font-medium bg-neutral-100 text-[#4B5563] hover:bg-neutral-200 transition-colors';
const CHIP_ON = 'quick-chip px-2.5 py-1 rounded-lg border font-medium bg-[#111827] text-white border-[#111827] transition-colors';
const CHIP_OFF = 'quick-chip px-2.5 py-1 rounded-lg border font-medium bg-neutral-100 text-[#4B5563] border-transparent hover:bg-neutral-200 transition-colors';
const STATUS_BADGE: Record<string, string> = {
  completed: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  paused: 'bg-amber-50 text-amber-900 border-amber-200',
};
const statusBadge = (status: string) => STATUS_BADGE[status] ?? 'bg-neutral-100 text-neutral-800 border-neutral-200';
const GROUPS = [
  { key: 'today', title: 'Hôm nay' },
  { key: 'yesterday', title: 'Hôm qua' },
  { key: 'earlier', title: 'Tuần này & Trước đó' },
] as const;
const TOAST_BASE = 'px-4 py-2.5 rounded-xl shadow-lg border text-xs sm:text-sm font-medium transition-all v3-transform duration-200 pointer-events-auto flex items-center gap-2 max-w-md';
const TOAST_COLOR: Record<ToastType, string> = {
  success: 'bg-[#111827] text-white border-neutral-700',
  error: 'bg-[#DC2626] text-white border-red-700',
  info: 'bg-[#111827] text-white border-neutral-700',
};
const toastIcon = (color: string, d: string) => (
  <svg className={`w-4 h-4 ${color} flex-shrink-0`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={d} /></svg>
);
const TOAST_ICON = {
  success: toastIcon('text-[#16A34A]', 'M5 13l4 4L19 7'),
  error: toastIcon('text-white', 'M6 18L18 6M6 6l12 12'),
  info: toastIcon('text-[#FF5701]', 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'),
};
// Hộp lưu ý an toàn trong ngăn biên nhận (openDetailDrawer).
const NOTICE = {
  success: { box: 'bg-emerald-50/70 border-emerald-200 text-emerald-900', icon: 'text-emerald-600', d: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
  warn: { box: 'bg-amber-50 border-amber-200 text-amber-900', icon: 'text-amber-600', d: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
  neutral: { box: 'bg-neutral-100 border-neutral-200 text-neutral-800', icon: 'text-neutral-600', d: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
};
const NOTICE_BASE = 'p-3.5 rounded-xl border text-xs leading-relaxed flex items-start gap-2.5';
const cloneRequest = (r: HistoryRequest): HistoryRequest => JSON.parse(JSON.stringify(r));
// Link trong dữ liệu trỏ tới file bản mẫu (responses.html) đổi sang route của bản React.
const routeOf = (url: string) => (url.endsWith('.html') ? '/' + url.slice(0, -'.html'.length) : url);
const readRole = (): Role => {
  try {
    const saved = localStorage.getItem('ati_demo_role');
    return saved === 'member' ? 'member' : 'admin';
  } catch {
    return 'admin';
  }
};
const statsOf = (list: HistoryRequest[]): Stats => ({
  total: list.length,
  completed: list.filter(r => r.status === 'completed').length,
  paused: list.filter(r => r.status === 'paused').length,
  cancelled: list.filter(r => r.status === 'cancelled').length,
});

// getFilteredRequests: trạng thái, dịch vụ, chip nhanh rồi từ khoá (tiêu đề, câu lệnh, kết quả).
function filterRequests(list: HistoryRequest[], f: Filters) {
  return list.filter(req => {
    if (f.status !== 'all' && req.status !== f.status) return false;
    if (f.service !== 'all' && !req.services.includes(f.service)) return false;
    if (f.quick === 'today' && req.dateGroup !== 'today') return false;
    if (f.quick === 'has_github' && !req.services.includes('github')) return false;
    if (f.quick === 'needs_attention' && req.status !== 'paused') return false;
    if (f.keyword) {
      const match = [req.title, req.prompt, req.summaryResult].some(text => (text || '').toLowerCase().includes(f.keyword));
      if (!match) return false;
    }
    return true;
  });
}

// renderRequestsList, viết thành hàm thuần để dùng cả cho lần vẽ đầu.
function buildListView(list: HistoryRequest[], f: Filters, visibleCount: number, editingId: string | null, version: number, previousRemaining: number | null): ListView {
  const filtered = filterRequests(list, f);
  if (filtered.length === 0) return { version, displayed: [], editingId, empty: true, loadMore: false, remaining: previousRemaining };
  const loadMore = visibleCount < filtered.length;
  return {
    version,
    displayed: filtered.slice(0, visibleCount).map(cloneRequest),
    editingId,
    empty: false,
    loadMore,
    remaining: loadMore ? filtered.length - visibleCount : previousRemaining,
  };
}

type CardActions = {
  startInlineRename: (id: string, event: ReactMouseEvent) => void;
  handleRenameKey: (event: ReactKeyboardEvent, id: string) => void;
  saveInlineRename: (id: string) => void;
  cancelInlineRename: () => void;
  quickCopyPrompt: (id: string) => void;
  openDetailDrawer: (id: string) => void;
};

// renderRequestCardHtml.
function RequestCard({ req, isEditing, actions }: { req: HistoryRequest; isEditing: boolean; actions: CardActions }) {
  const rawTitle = req.title || req.prompt || '';
  const displayTitle = rawTitle.length > 60 ? rawTitle.slice(0, 60) + '…' : rawTitle;
  return <article className="p-4 sm:p-5 rounded-2xl bg-white border border-[#E7E7E2] shadow-soft hover:border-[#FF5701]/60 transition-all group">
    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
      {/* Cụm trái: Trạng thái, Thời gian, Tiêu đề hội thoại, Kết quả */}
      <div className="v3-space-y-2 flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${statusBadge(req.status)}`}>{req.statusLabel}</span>
          <span className="text-[#9CA3AF]">·</span>
          <span className="text-[#6B7280] font-medium">{req.timeStr}</span>
        </div>
        {/* Tiêu đề hội thoại (hoặc ô nhập đổi tên inline) */}
        {isEditing ? (
          <div className="v3-space-y-1.5 py-0.5" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center gap-2">
              {/* React ghi value bằng thuộc tính DOM nên con trỏ nằm cuối chữ; bản mẫu đọc value từ HTML nên con trỏ ở đầu.
                  Đặt lại về đầu khi tạo ô để khi focus, chữ dài trên màn hẹp cuộn giống bản mẫu. */}
              <input ref={(input) => { input?.setSelectionRange(0, 0); }} id={`rename-input-${req.id}`} type="text" maxLength={60} defaultValue={rawTitle.slice(0, 60)} onKeyDown={(event) => actions.handleRenameKey(event, req.id)} className="flex-1 min-w-[200px] text-sm sm:text-base font-semibold text-[#111827] px-3 py-1.5 border-2 border-[#FF5701] rounded-xl focus:v3-outline-none focus:ring-2 focus:ring-[#FF5701]/20 bg-white shadow-sm" placeholder="Nhập tiêu đề hội thoại (tối đa 60 ký tự)" />
              <button type="button" onClick={() => actions.saveInlineRename(req.id)} className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-[#FF5701] hover:bg-[#E04D00] text-white transition-colors shadow-sm flex-shrink-0">
                Lưu
              </button>
              <button type="button" onClick={() => actions.cancelInlineRename()} className="px-2.5 py-1.5 text-xs font-medium rounded-xl text-[#6B7280] hover:text-[#111827] hover:bg-neutral-100 transition-colors flex-shrink-0">
                Huỷ
              </button>
            </div>
            <div className="text-[11px] text-[#6B7280] flex items-center gap-2">
              <span>
                {"Nhấn "}
                <kbd className="px-1.5 py-0.5 bg-neutral-100 border border-neutral-200 rounded text-[10px] font-mono">Enter</kbd>
                {" để lưu, "}
                <kbd className="px-1.5 py-0.5 bg-neutral-100 border border-neutral-200 rounded text-[10px] font-mono">Esc</kbd>
                {" để huỷ"}
              </span>
              <span className="text-[#9CA3AF]">·</span>
              <span>Tối đa 60 ký tự</span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm sm:text-base font-semibold text-[#111827] group-hover:text-[#FF5701] transition-colors leading-snug">
              {displayTitle}
            </h3>
            <button type="button" onClick={(event) => actions.startInlineRename(req.id, event)} className="inline-flex items-center gap-1 px-2 py-1 text-xs text-[#6B7280] hover:text-[#FF5701] hover:bg-neutral-100 rounded-lg transition-colors" title="Đổi tên hội thoại">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
              <span className="text-[11px] font-medium">Đổi tên</span>
            </button>
          </div>
        )}
        {/* Tóm tắt kết quả ngắn gọn */}
        <p className="text-xs text-[#4B5563] flex items-start gap-1.5 pt-0.5">
          <svg className="w-3.5 h-3.5 text-[#16A34A] flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
          <span className="line-clamp-1">{req.summaryResult}</span>
        </p>
      </div>
      {/* Cụm phải: Dải dịch vụ + Nút xem chi tiết */}
      <div className="flex sm:flex-col items-center sm:items-end justify-between gap-3 flex-shrink-0 border-t sm:border-t-0 pt-3 sm:pt-0 border-neutral-100">
        <div className="flex items-center gap-1.5">
          {req.services.map((srv, idx) => (
            <div key={`${idx}-${srv}`} className="w-7 h-7 rounded-lg bg-neutral-100 border border-[#E7E7E2] flex items-center justify-center p-1 shadow-sm hover:scale-105 transition-transform" title={srv}>
              {SERVICE_SVGS[srv] ?? ''}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => actions.quickCopyPrompt(req.id)} className="p-2 text-[#6B7280] hover:text-[#111827] hover:bg-neutral-100 rounded-lg transition-colors" title="Sao chép câu lệnh này">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
          </button>
          <button type="button" onClick={() => actions.openDetailDrawer(req.id)} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-xl bg-[#F8F8F6] group-hover:bg-[#FF5701] text-[#111827] group-hover:text-white border border-[#E7E7E2] group-hover:border-transparent transition-all shadow-sm">
            <span>Xem biên nhận</span>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>
      </div>
    </div>
  </article>;
}

export const meta: PageMeta = {
  id: "history",
  title: "Nhật ký điều phối & Lịch sử yêu cầu — ATI",
  htmlClass: "",
  bodyClass: "min-h-screen flex flex-col bg-[#F8F8F6] text-[#111827]",
  css,
};

const DEFAULT_FILTERS: Filters = { keyword: '', status: 'all', service: 'all', quick: 'all' };

export function HistoryPage() {
  usePrototypePage(meta);
  // Dữ liệu như biến toàn cục của bản mẫu; giao diện chỉ đổi khi gọi các hàm vẽ lại bên dưới.
  const model = useRef({
    role: readRole(),
    requests: INITIAL_REQUESTS.map(cloneRequest),
    quick: 'all' as QuickFilter,
    selectedId: null as string | null,
    visibleCount: 4,
    editingId: null as string | null,
    drawerVisible: false,
    listVersion: 0,
  });
  const [role, setRoleView] = useState<Role>(() => model.current.role);
  const [menuOpen, setMenuOpen] = useState(false);
  const [quick, setQuickView] = useState<QuickFilter>('all');
  const [stats, setStats] = useState<Stats>(() => statsOf(INITIAL_REQUESTS));
  const [listView, setListView] = useState<ListView>(() => buildListView(INITIAL_REQUESTS, DEFAULT_FILTERS, 4, null, 0, null));
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Ngăn biên nhận: drawerVisible là class hidden của khung, shown là trạng thái hiệu ứng của nền và panel.
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [shown, setShown] = useState(false);
  const [detail, setDetail] = useState<HistoryRequest | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLSelectElement>(null);
  const serviceRef = useRef<HTMLSelectElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const toastId = useRef(0);
  const timers = useRef<number[]>([]);
  const later = (ms: number, run: () => void) => { timers.current.push(window.setTimeout(run, ms)); };
  useEffect(() => () => {
    timers.current.forEach(window.clearTimeout);
    document.body.style.overflow = '';
  }, []);

  const showToast = (message: string, type: ToastType = 'info') => {
    const id = ++toastId.current;
    setToasts(items => [...items, { id, message, type, leaving: false }]);
    later(3000, () => {
      setToasts(items => items.map(t => (t.id === id ? { ...t, leaving: true } : t)));
      later(200, () => setToasts(items => items.filter(t => t.id !== id)));
    });
  };
  const readFilters = (): Filters => ({
    keyword: (searchRef.current?.value || '').trim().toLowerCase(),
    status: statusRef.current?.value ?? 'all',
    service: serviceRef.current?.value ?? 'all',
    quick: model.current.quick,
  });
  const renderRequestsList = () => {
    const m = model.current;
    m.listVersion += 1;
    const view = buildListView(m.requests, readFilters(), m.visibleCount, m.editingId, m.listVersion, null);
    setListView(prev => ({ ...view, remaining: view.loadMore ? view.remaining : prev.remaining }));
  };
  const updateStatistics = () => setStats(statsOf(model.current.requests));
  const toggleDemoDropdown = (force?: boolean) => setMenuOpen(open => (force !== undefined ? force : !open));
  const findRequest = (id: string | null) => model.current.requests.find(r => r.id === id);
  const actions = {
    toggleDemoDropdown,
    setRole(next: Role) {
      model.current.role = next;
      try { localStorage.setItem('ati_demo_role', next); } catch { /* bỏ qua */ }
      setRoleView(next);
      renderRequestsList();
      updateStatistics();
      toggleDemoDropdown(false);
      showToast(next === 'admin' ? 'Đã chuyển sang vai trò: Quản trị viên' : 'Đã chuyển sang vai trò: Thành viên', 'info');
    },
    handleFilterChange() {
      model.current.visibleCount = 4;
      renderRequestsList();
    },
    setQuickFilter(type: QuickFilter) {
      model.current.quick = type;
      model.current.visibleCount = 4;
      setQuickView(type);
      renderRequestsList();
    },
    resetFilters() {
      if (searchRef.current) searchRef.current.value = '';
      if (statusRef.current) statusRef.current.value = 'all';
      if (serviceRef.current) serviceRef.current.value = 'all';
      actions.setQuickFilter('all');
      model.current.visibleCount = 4;
      showToast('Đã đặt lại toàn bộ điều kiện lọc', 'info');
    },
    loadMoreRequests() {
      model.current.visibleCount += 4;
      renderRequestsList();
    },
    startInlineRename(reqId: string, event?: ReactMouseEvent) {
      if (event) {
        event.stopPropagation();
        event.preventDefault();
      }
      model.current.editingId = reqId;
      renderRequestsList();
      later(50, () => {
        const input = document.getElementById(`rename-input-${reqId}`) as HTMLInputElement | null;
        if (input) {
          input.focus();
          input.select();
        }
      });
    },
    cancelInlineRename() {
      model.current.editingId = null;
      renderRequestsList();
    },
    handleRenameKey(event: ReactKeyboardEvent, reqId: string) {
      if (event.key === 'Enter') {
        event.preventDefault();
        actions.saveInlineRename(reqId);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        actions.cancelInlineRename();
      }
    },
    saveInlineRename(reqId: string) {
      const input = document.getElementById(`rename-input-${reqId}`) as HTMLInputElement | null;
      if (!input) return;
      const newTitle = input.value.trim();
      if (!newTitle) {
        showToast('Tiêu đề hội thoại không được để trống', 'error');
        return;
      }
      const target = findRequest(reqId);
      if (target) {
        target.title = newTitle.slice(0, 60);
        showToast('Đã đổi tên hội thoại thành công', 'success');
      }
      model.current.editingId = null;
      renderRequestsList();
    },
    openDetailDrawer(reqId: string) {
      model.current.selectedId = reqId;
      const req = findRequest(reqId);
      if (!req) return;
      setDetail(cloneRequest(req));
      model.current.drawerVisible = true;
      setDrawerVisible(true);
      document.body.style.overflow = 'hidden';
      requestAnimationFrame(() => setShown(true));
    },
    closeDetailDrawer() {
      setShown(false);
      later(250, () => {
        model.current.drawerVisible = false;
        setDrawerVisible(false);
        document.body.style.overflow = '';
      });
    },
    quickCopyPrompt(reqId: string) {
      const req = findRequest(reqId);
      if (!req) return;
      navigator.clipboard.writeText(req.prompt).then(
        () => showToast(`Đã sao chép câu lệnh: "${req.prompt}"`, 'success'),
        () => showToast('Không thể sao chép vào bộ nhớ tạm', 'error'),
      );
    },
    copyDrawerPrompt() {
      if (!model.current.selectedId) return;
      actions.quickCopyPrompt(model.current.selectedId);
    },
    copyDrawerReport() {
      const req = findRequest(model.current.selectedId);
      if (!req) return;
      const reportText = `[ATI - BÁO CÁO KẾT QUẢ ĐIỀU PHỐI]
Mã yêu cầu: ${req.id}
Thời gian: ${req.timeStr}
Người yêu cầu: ${req.author}
Câu lệnh gốc: "${req.prompt}"
Trạng thái: ${req.statusLabel}
Kết quả tóm tắt: ${req.summaryResult}
Số dịch vụ tác động: ${req.services.join(', ')}
Cam kết an toàn: Chưa ghi bất kỳ dữ liệu nào khi chưa được duyệt.`;
      navigator.clipboard.writeText(reportText).then(
        () => showToast('✓ Đã sao chép toàn bộ biên nhận vào bộ nhớ tạm', 'success'),
        () => showToast('Không thể sao chép báo cáo', 'error'),
      );
    },
    replayInStage() {
      if (!findRequest(model.current.selectedId)) return;
      actions.closeDetailDrawer();
      showToast('Đang chuyển sang không gian làm việc...', 'info');
      later(500, () => navigate('/app-stage'));
    },
    addSampleRequest() {
      const sample: Omit<HistoryRequest, 'id'> = JSON.parse(JSON.stringify(SAMPLE_REQUEST));
      model.current.requests.unshift({ id: `CV-${Math.floor(100 + Math.random() * 900)}`, ...sample });
      model.current.visibleCount = 4;
      renderRequestsList();
      updateStatistics();
      toggleDemoDropdown(false);
      showToast('Đã thêm 1 hội thoại mẫu vào lịch sử!', 'success');
    },
    resetToDefaultData() {
      model.current.requests = INITIAL_REQUESTS.map(cloneRequest);
      actions.resetFilters();
      renderRequestsList();
      updateStatistics();
      toggleDemoDropdown(false);
      showToast('Đã khôi phục dữ liệu nhật ký ban đầu', 'info');
    },
  };

  // Esc đóng ngăn biên nhận và menu demo; bấm ngoài menu demo thì đóng.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (model.current.drawerVisible) actions.closeDetailDrawer();
      toggleDemoDropdown(false);
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuButtonRef.current?.contains(target) && !menuRef.current?.contains(target)) toggleDemoDropdown(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('click', onClick); };
  });

  const doneSteps = detail ? detail.steps.filter(s => s.badge.includes('✓')).length : 0;
  return (
    <>
      {/* Toast Thông báo nổi */}
      <div id="toast-container" className="fixed top-5 left-1/2 -translate-x-1/2 z-50 pointer-events-none flex flex-col items-center gap-2" role="status" aria-live="polite">
        {toasts.map(toast => (
          <div key={toast.id} className={`${TOAST_BASE} ${TOAST_COLOR[toast.type]}`} style={toast.leaving ? { opacity: 0, transform: 'translateY(-10px)' } : undefined}>
            {TOAST_ICON[toast.type]}
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
      {/* THANH TRÊN (COCKPIT HEADER) */}
      <header className="sticky top-0 z-30 w-full bg-[#F8F8F6]/90 backdrop-blur-md border-b border-[#E7E7E2] px-4 sm:px-6 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
          {/* Cụm Logo & Điều hướng quay lại */}
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <a href="/app-stage" className="flex items-center gap-2.5 group flex-shrink-0" title="Về sân khấu điều phối">
              <div className="w-8 h-8 rounded-lg bg-[#FF5701] flex items-center justify-center text-white font-display font-bold text-lg shadow-sm group-hover:scale-105 transition-transform">
                A
              </div>
              <span className="font-display font-bold text-lg tracking-tight text-[#111827]">
                ATI
              </span>
            </a>
            <div className="h-4 w-px bg-[#E7E7E2] flex-shrink-0" />
            <a href="/app-stage" className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-[#4B5563] hover:text-[#111827] transition-colors py-1 px-2 rounded-lg hover:bg-black/5" title="Quay lại không gian làm việc">
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
            {/* Liên kết chéo */}
            <a href="/settings" className="hidden md:inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-[#4B5563] hover:text-[#111827] transition-colors py-1 px-2 rounded-lg hover:bg-black/5" title="Mở trang Kết nối dịch vụ">
              <svg className="w-4 h-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
              {' '}
              <span>
                Kết nối dịch vụ
              </span>
            </a>
            <a href="/guide" className="hidden md:inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-[#4B5563] hover:text-[#111827] transition-colors py-1 px-2 rounded-lg hover:bg-black/5" title={"Cẩm nang kết nối & Mẫu câu lệnh"}>
              <svg className="w-4 h-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              {' '}
              <span>
                Cẩm nang
              </span>
            </a>
            <a href="/users" id="nav-link-users" style={{ display: role === 'admin' ? 'inline-flex' : 'none' }} className="hidden lg:inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-[#4B5563] hover:text-[#111827] transition-colors py-1 px-2 rounded-lg hover:bg-black/5" title="Mở trang Quản lý người dùng">
              <svg className="w-4 h-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
              {' '}
              <span>
                Người dùng
              </span>
            </a>
          </div>
          {/* Cụm Phải: Vai trò + Kịch bản Demo + Avatar */}
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            {/* Nhãn vai trò hiện tại */}
            <span id="role-pill-badge" className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-neutral-200/80 text-[#374151] border border-neutral-300/60" title="Vai trò hiện tại của bạn">
              <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A]" />
              {' '}
              <span id="current-role-label">
                {role === 'admin' ? 'Quản trị viên' : 'Thành viên'}
              </span>
            </span>
            {/* Nút Kịch bản demo */}
            <div className="relative">
              <button type="button" ref={menuButtonRef} id="btn-demo-menu" onClick={() => actions.toggleDemoDropdown()} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[#4B5563] bg-white border border-[#E7E7E2] rounded-lg hover:border-[#FF5701] hover:text-[#FF5701] transition-colors shadow-sm" aria-haspopup="true" aria-expanded={menuOpen ? 'true' : 'false'}>
                <svg className="w-3.5 h-3.5 text-[#FF5701]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                </svg>
                <span className="hidden sm:inline">
                  Kịch bản
                </span>
                <svg className="w-3 h-3 text-[#9CA3AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {' '}
              {/* Dropdown menu kịch bản demo */}
              {' '}
              <div ref={menuRef} id="demo-dropdown" className={`${menuOpen ? '' : 'hidden '}absolute right-0 mt-2 w-64 max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-lg border border-[#E7E7E2] py-2 z-50 text-xs`}>
                <div className="px-3 py-1.5 text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider border-b border-[#E7E7E2]">
                  Kịch bản kiểm thử demo
                </div>
                {/* Đổi vai trò xem */}
                <div className="p-2 border-b border-[#E7E7E2]">
                  <span className="block text-[11px] text-[#6B7280] mb-1.5 font-medium">
                    Xem trang với vai trò:
                  </span>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button type="button" onClick={() => actions.setRole('admin')} id="demo-role-admin-btn" className={role === 'admin' ? ROLE_ON : ROLE_OFF}>
                      {" Quản trị viên "}
                    </button>
                    <button type="button" onClick={() => actions.setRole('member')} id="demo-role-member-btn" className={role === 'member' ? ROLE_ON : ROLE_OFF}>
                      {" Thành viên "}
                    </button>
                  </div>
                </div>
                {/* Thao tác dữ liệu mẫu */}
                <div className="py-1">
                  <button type="button" onClick={() => actions.addSampleRequest()} className="w-full text-left px-3 py-2 text-[#374151] hover:bg-neutral-50 flex items-center gap-2">
                    <svg className="w-3.5 h-3.5 text-[#16A34A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                    </svg>
                    <span>
                      Thêm yêu cầu mẫu mới (vừa xong)
                    </span>
                  </button>
                  <button type="button" onClick={() => actions.resetToDefaultData()} className="w-full text-left px-3 py-2 text-[#DC2626] hover:bg-red-50 flex items-center gap-2">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.038 8.038 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>
                      Khôi phục dữ liệu ban đầu
                    </span>
                  </button>
                </div>
              </div>
            </div>
            {/* Avatar người dùng liên kết về account.html */}
            <a href="/account" className="w-8 h-8 rounded-full bg-[#FF5701] text-white flex items-center justify-center font-semibold text-xs tracking-wider shadow-sm hover:ring-2 hover:ring-[#FF5701]/30 transition-all" title="Tài khoản của Lan Nguyễn">
              LN
            </a>
          </div>
        </div>
      </header>
      {/* NỘI DUNG CHÍNH */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 v3-space-y-6">
        {/* KHỐI TIÊU ĐỀ & NGUYÊN TẮC AN TOÀN */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[#E7E7E2] pb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-neutral-200/80 text-[#374151]">
                <svg className="w-3 h-3 text-[#FF5701]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {" Nhật ký điều phối"}
              </span>
              <span id="requests-count-badge" className="text-xs text-[#6B7280]">
                {`${stats.total} hội thoại`}
              </span>
            </div>
            <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#111827]">
              Nhật ký điều phối &amp; Lịch sử yêu cầu
            </h1>
            <p className="text-sm text-[#4B5563] mt-1.5 max-w-2xl leading-relaxed">
              Theo dõi toàn bộ các phiên điều phối liên dịch vụ do ATI thực hiện. Mỗi yêu cầu đều có đầy đủ bước duyệt, biên nhận và liên kết tới từng kết quả.
            </p>
          </div>
          {/* Nút hành động nhanh */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <a href="/app-stage" className="inline-flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-semibold rounded-xl bg-[#FF5701] text-white hover:bg-[#E04D00] shadow-sm hover:shadow transition-all">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
              </svg>
              <span>
                Gõ yêu cầu mới
              </span>
            </a>
          </div>
        </div>
        {/* NGUYÊN TẮC AN TOÀN */}
        <div className="p-4 rounded-2xl bg-white border border-[#E7E7E2] shadow-soft flex items-start gap-3.5">
          <div className="w-8 h-8 rounded-xl bg-orange-50 border border-orange-100 flex items-center justify-center flex-shrink-0 text-[#FF5701] mt-0.5">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <div className="text-xs sm:text-sm text-[#4B5563] leading-relaxed">
            <strong className="text-[#111827] font-semibold">
              Minh bạch &amp; An toàn dữ liệu:
            </strong>
            {" ATI không bao giờ tự ý ghi gì khi bạn chưa bấm duyệt. Mọi hành động đều được lưu vết thời gian thực, có đường dẫn kiểm tra trực tiếp trên từng công cụ và tuyệt đối dừng lại hỏi người dùng nếu mạng gián đoạn giữa chừng."}
          </div>
        </div>
        {/* 4 THẺ THỐNG KÊ NHANH */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          <div className="p-4 rounded-2xl bg-white border border-[#E7E7E2] shadow-soft">
            <div className="text-xs font-medium text-[#6B7280]">
              Tổng yêu cầu
            </div>
            <div id="stat-total" className="font-display text-2xl font-bold text-[#111827] mt-1">
              {stats.total}
            </div>
            <div className="text-[11px] text-[#6B7280] mt-0.5" id="stat-scope-desc">
              Lịch sử cá nhân
            </div>
          </div>
          <div className="p-4 rounded-2xl bg-white border border-[#E7E7E2] shadow-soft">
            <div className="text-xs font-medium text-[#16A34A] flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A]" />
              <span>
                Hoàn tất trọn vẹn
              </span>
            </div>
            <div id="stat-completed" className="font-display text-2xl font-bold text-[#16A34A] mt-1">
              {stats.completed}
            </div>
            <div className="text-[11px] text-[#6B7280] mt-0.5">
              Đã duyệt &amp; xuất kết quả
            </div>
          </div>
          <div className="p-4 rounded-2xl bg-white border border-[#E7E7E2] shadow-soft">
            <div className="text-xs font-medium text-[#D97706] flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#D97706]" />
              <span>
                Đã dừng / Chờ hỏi
              </span>
            </div>
            <div id="stat-paused" className="font-display text-2xl font-bold text-[#D97706] mt-1">
              {stats.paused}
            </div>
            <div className="text-[11px] text-[#6B7280] mt-0.5">
              Mạng ngắt khi đang ghi
            </div>
          </div>
          <div className="p-4 rounded-2xl bg-white border border-[#E7E7E2] shadow-soft">
            <div className="text-xs font-medium text-[#6B7280] flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#6B7280]" />
              <span>
                Từ chối / Đã hủy
              </span>
            </div>
            <div id="stat-cancelled" className="font-display text-2xl font-bold text-[#4B5563] mt-1">
              {stats.cancelled}
            </div>
            <div className="text-[11px] text-[#6B7280] mt-0.5">
              Chưa hỗ trợ hoặc hủy duyệt
            </div>
          </div>
        </div>
        {/* THANH TÌM KIẾM VÀ BỘ LỌC ĐA NĂNG */}
        <div className="bg-white p-4 rounded-2xl border border-[#E7E7E2] shadow-soft v3-space-y-3.5">
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            {/* Ô tìm kiếm */}
            <div className="relative flex-1">
              <label htmlFor="search-input" className="sr-only">
                Tìm kiếm yêu cầu trong nhật ký
              </label>
              {' '}
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#9CA3AF]">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              {' '}
              <input ref={searchRef} type="text" id="search-input" onInput={() => actions.handleFilterChange()} placeholder="Tìm theo tiêu đề hội thoại…" className="w-full text-xs sm:text-sm pl-10 pr-4 py-2.5 bg-[#F8F8F6] border border-[#E7E7E2] rounded-xl text-[#111827] focus:bg-white focus:v3-outline-none focus:border-[#FF5701] transition-all" />
            </div>
            {/* Bộ lọc kết hợp */}
            <div className="flex flex-wrap items-center gap-2.5 flex-shrink-0">
              {/* Lọc theo Trạng thái */}
              <div className="flex items-center gap-1.5">
                <div className="relative">
                  <select ref={statusRef} id="filter-status" onChange={() => actions.handleFilterChange()} className="text-xs sm:text-sm font-medium py-2.5 pl-3 pr-8 bg-[#F8F8F6] border border-[#E7E7E2] rounded-xl text-[#374151] focus:bg-white focus:v3-outline-none focus:border-[#FF5701] cursor-pointer transition-colors appearance-none">
                    {' '}
                    <option value="all">
                      Tất cả trạng thái
                    </option>
                    {' '}
                    <option value="completed">
                      ✓ Hoàn tất trọn vẹn
                    </option>
                    {' '}
                    <option value="paused">
                      ⚠ Đã dừng (mất mạng)
                    </option>
                    {' '}
                    <option value="cancelled">
                      ✕ Từ chối / Đã hủy
                    </option>
                    {' '}
                  </select>
                  {' '}
                  <div className="absolute inset-y-0 right-0 pr-2.5 flex items-center pointer-events-none text-[#9CA3AF]">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
                <span className="text-[11px] text-[#9CA3AF] font-medium whitespace-nowrap">
                  (bản mẫu)
                </span>
              </div>
              {/* Lọc theo Dịch vụ */}
              <div className="flex items-center gap-1.5">
                <div className="relative">
                  <select ref={serviceRef} id="filter-service" onChange={() => actions.handleFilterChange()} className="text-xs sm:text-sm font-medium py-2.5 pl-3 pr-8 bg-[#F8F8F6] border border-[#E7E7E2] rounded-xl text-[#374151] focus:bg-white focus:v3-outline-none focus:border-[#FF5701] cursor-pointer transition-colors appearance-none">
                    {' '}
                    <option value="all">
                      Tất cả công cụ
                    </option>
                    {' '}
                    <option value="trello">
                      Trello
                    </option>
                    {' '}
                    <option value="slack">
                      Slack
                    </option>
                    {' '}
                    <option value="github">
                      GitHub
                    </option>
                    {' '}
                    <option value="sheets">
                      Google Sheets
                    </option>
                    {' '}
                    <option value="notion">
                      Notion
                    </option>
                    {' '}
                    <option value="calendar">
                      Google Calendar
                    </option>
                    {' '}
                    <option value="jira">
                      Jira
                    </option>
                    {' '}
                  </select>
                  {' '}
                  <div className="absolute inset-y-0 right-0 pr-2.5 flex items-center pointer-events-none text-[#9CA3AF]">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
                <span className="text-[11px] text-[#9CA3AF] font-medium whitespace-nowrap">
                  (bản mẫu)
                </span>
              </div>
              {/* Nút đặt lại bộ lọc */}
              <button type="button" onClick={() => actions.resetFilters()} className="p-2.5 text-[#6B7280] hover:text-[#111827] hover:bg-neutral-100 rounded-xl transition-colors" title="Đặt lại bộ lọc">
                {' '}
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.038 8.038 0 01-15.357-2m15.357 2H15" />
                </svg>
                {' '}
              </button>
            </div>
          </div>
          {/* Quick chips filters */}
          <div className="flex items-center gap-2 overflow-x-auto pt-2 border-t border-[#E7E7E2] text-xs">
            <span className="text-[#6B7280] font-medium whitespace-nowrap">
              Lọc nhanh:
            </span>
            <button type="button" onClick={() => actions.setQuickFilter('all')} className={quick === 'all' ? CHIP_ON : CHIP_OFF} data-chip="all">
              Tất cả
            </button>
            <button type="button" onClick={() => actions.setQuickFilter('today')} className={quick === 'today' ? CHIP_ON : CHIP_OFF} data-chip="today">
              Hôm nay
            </button>
            <button type="button" onClick={() => actions.setQuickFilter('has_github')} className={quick === 'has_github' ? CHIP_ON : CHIP_OFF} data-chip="has_github">
              Có GitHub
            </button>
            <button type="button" onClick={() => actions.setQuickFilter('needs_attention')} className={quick === 'needs_attention' ? CHIP_ON : CHIP_OFF} data-chip="needs_attention">
              Cần xem lại (1)
            </button>
          </div>
        </div>
        {/* DANH SÁCH NHẬT KÝ THEO DÒNG THỜI GIAN */}
        <div id="requests-list-container" className="v3-space-y-6">
          {GROUPS.map(group => {
            const items = listView.displayed.filter(r => r.dateGroup === group.key);
            if (items.length === 0) return null;
            return (
              <section key={`${listView.version}-${group.key}`} className="v3-space-y-3">
                <div className="flex items-center gap-2 px-1">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-[#6B7280]">{group.title}</h2>
                  <span className="w-1.5 h-1.5 rounded-full bg-[#E7E7E2]" />
                  <span className="text-xs text-[#9CA3AF]">{`${items.length} hội thoại`}</span>
                </div>
                <div className="v3-space-y-3">
                  {items.map(req => <RequestCard key={req.id} req={req} isEditing={listView.editingId === req.id} actions={actions} />)}
                </div>
              </section>
            );
          })}
        </div>
        {/* NÚT TẢI THÊM CUỐI DANH SÁCH */}
        <div id="load-more-container" className={`pt-2 flex flex-col items-center justify-center gap-2${listView.loadMore ? '' : ' hidden'}`}>
          <button type="button" id="btn-load-more" onClick={() => actions.loadMoreRequests()} className="inline-flex items-center gap-2 px-5 py-2.5 text-xs sm:text-sm font-semibold rounded-xl bg-white border border-[#E7E7E2] hover:border-[#FF5701] text-[#374151] hover:text-[#FF5701] shadow-soft transition-all">
            <span>
              {listView.remaining === null ? 'Tải thêm' : `Tải thêm (${listView.remaining} hội thoại)`}
            </span>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <div id="load-more-all-loaded" className="hidden text-xs text-[#9CA3AF]">
            Đã hiển thị toàn bộ lịch sử hội thoại
          </div>
        </div>
        {/* TRẠNG THÁI RỖNG (EMPTY STATE KHI TÌM KHÔNG THẤY) */}
        <div id="empty-state" className={`${listView.empty ? '' : 'hidden '}p-12 text-center bg-white rounded-2xl border border-[#E7E7E2] shadow-soft v3-space-y-3`}>
          <div className="w-12 h-12 rounded-full bg-neutral-100 flex items-center justify-center mx-auto text-[#6B7280]">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <h3 className="font-display text-lg font-bold text-[#111827]">
            Không tìm thấy yêu cầu phù hợp
          </h3>
          <p className="text-xs sm:text-sm text-[#6B7280] max-w-sm mx-auto">
            Thử thay đổi từ khóa tìm kiếm hoặc bỏ bớt các điều kiện lọc trạng thái, dịch vụ.
          </p>
          {' '}
          <button type="button" onClick={() => actions.resetFilters()} className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-neutral-100 hover:bg-neutral-200 text-[#111827] transition-colors mt-2">
            <span>
              Xoá toàn bộ bộ lọc
            </span>
          </button>
        </div>
      </main>
      {/* CHÂN TRANG */}
      <footer className="mt-auto border-t border-[#E7E7E2] bg-[#F8F8F6] py-6 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#6B7280]">
          <div className="flex items-center gap-2">
            <span className="font-display font-bold text-[#111827]">
              ATI
            </span>
            <span>
              · 2026
            </span>
            <span>
              · AI Workflow Automation Platform
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <a href="/app-stage" className="hover:text-[#111827] transition-colors">
              Không gian làm việc
            </a>
            <a href="/settings" className="hover:text-[#111827] transition-colors">
              Kết nối dịch vụ
            </a>
            <a href="/guide" className="hover:text-[#111827] transition-colors">
              Cẩm nang &amp; Mẫu lệnh
            </a>
            <a href="/users" className="hover:text-[#111827] transition-colors">
              Quản lý người dùng
            </a>
            <a href="/account" className="hover:text-[#111827] transition-colors">
              Tài khoản
            </a>
            <a href="/responses" className="hover:text-[#111827] transition-colors">
              Màn từ chối &amp; hỏi lại
            </a>
            <a href="/privacy" className="text-[#FF5701] hover:underline font-medium transition-colors">
              Chính sách an toàn
            </a>
          </div>
        </div>
      </footer>
      {/* =========================================================
       NGĂN CHI TIẾT YÊU CẦU & BIÊN NHẬN (DETAIL DRAWER)
       ========================================================= */}
      <div id="request-detail-drawer" className={`fixed inset-0 z-50 overflow-hidden${drawerVisible ? '' : ' hidden'}`} role="dialog" aria-modal="true" aria-labelledby="drawer-request-title">
        {/* Backdrop mờ */}
        <div id="drawer-backdrop" onClick={() => actions.closeDetailDrawer()} className={`absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity ${shown ? 'opacity-100' : 'opacity-0'}`} />
        <div className="fixed inset-y-0 right-0 max-w-full flex pl-0 sm:pl-16">
          <div id="drawer-panel" className={`w-screen max-w-2xl bg-white shadow-drawer border-l border-[#E7E7E2] flex flex-col v3-transform ${shown ? 'translate-x-0' : 'translate-x-full'} transition-transform duration-300 ease-in-out`}>
            {/* Header Drawer */}
            <div className="px-5 sm:px-6 py-4 border-b border-[#E7E7E2] flex items-center justify-between gap-3 bg-[#F8F8F6]">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span id="drawer-req-id" className="font-mono text-xs font-semibold px-2 py-0.5 rounded-md bg-neutral-200 text-[#374151]">
                    {detail ? detail.id : ' ATI-CV-042 '}
                  </span>
                  <span id="drawer-status-badge">
                    {detail ? <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${statusBadge(detail.status)}`}>{detail.statusLabel}</span> : null}
                  </span>
                </div>
                <h2 id="drawer-request-title" className="font-display text-lg sm:text-xl font-bold text-[#111827] mt-1 line-clamp-2">
                  Chi tiết yêu cầu điều phối
                </h2>
              </div>
              <button type="button" onClick={() => actions.closeDetailDrawer()} className="p-2 text-[#6B7280] hover:text-[#111827] rounded-lg hover:bg-neutral-200 transition-colors flex-shrink-0" aria-label="Đóng ngăn chi tiết">
                {' '}
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
                {' '}
              </button>
            </div>
            {/* Thân Drawer cuộn dọc */}
            <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-6 v3-space-y-6" id="drawer-body">
              {/* HỘP CÂU LỆNH GỐC TIẾNG VIỆT */}
              <div className="p-4 rounded-xl bg-neutral-50 border border-[#E7E7E2] v3-space-y-2">
                <div className="flex items-center justify-between text-xs text-[#6B7280]">
                  <span className="font-medium">
                    Câu lệnh tiếng Việt gốc:
                  </span>
                  <button type="button" onClick={() => actions.copyDrawerPrompt()} className="text-[#FF5701] hover:underline inline-flex items-center gap-1 font-medium">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <span>
                      Sao chép câu lệnh
                    </span>
                  </button>
                </div>
                <p id="drawer-prompt-text" className="text-sm sm:text-base font-semibold text-[#111827] leading-relaxed">
                  {detail ? `"${detail.prompt}"` : '"Tạo card Trello cho lỗi đăng nhập Google, tạo issue GitHub, ghi vào Google Sheets và báo kênh Slack"'}
                </p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-2 border-t border-neutral-200 text-xs text-[#6B7280]">
                  <span id="drawer-author-info">
                    {"Người yêu cầu: "}
                    <strong>
                      {detail ? detail.author : 'Lan Nguyễn'}
                    </strong>
                    {detail ? ` (${detail.authorEmail})` : null}
                  </span>
                  <span id="drawer-time-info">
                    {"Thời gian: "}
                    <strong>
                      {detail ? detail.timeStr : '14:02 · Hôm nay'}
                    </strong>
                  </span>
                  <span id="drawer-duration-info">
                    {detail ? 'Thời gian chạy: ' : 'Xong trong: '}
                    <strong>
                      {detail ? detail.durationStr : '3,8 giây'}
                    </strong>
                  </span>
                </div>
              </div>
              {/* THÔNG ĐIỆP AN TOÀN / CẢNH BÁO NẾU CÓ */}
              <div id="drawer-safety-notice" className={detail ? `${NOTICE_BASE} ${NOTICE[detail.safetyNotice.type].box}` : NOTICE_BASE}>
                {detail ? <>
                  <svg className={`w-4 h-4 ${NOTICE[detail.safetyNotice.type].icon} flex-shrink-0 mt-0.5`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={NOTICE[detail.safetyNotice.type].d} /></svg>
                  <div>{detail.safetyNotice.text}</div>
                </> : null}
              </div>
              {/* KẾ HOẠCH HÀNH ĐỘNG VÀ BIÊN NHẬN KẾT QUẢ */}
              <div className="v3-space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#111827] flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#111827] text-white text-[11px] flex items-center justify-center font-bold">
                      1
                    </span>
                    <span>
                      Hành trình thực hiện &amp; Biên nhận
                    </span>
                  </h3>
                  <span id="drawer-steps-count" className="text-xs text-[#6B7280] font-medium">
                    {detail ? `${doneSteps} / ${detail.steps.length} việc hoàn thành` : '4 / 4 việc hoàn thành'}
                  </span>
                </div>
                {/* Danh sách từng bước biên nhận */}
                <div id="drawer-steps-list" className="v3-space-y-3">
                  {detail?.steps.map((st, idx) => {
                    const badgeStyle = st.badge.includes('✓')
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : (st.badge.includes('⚠') ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-neutral-100 text-neutral-700 border-neutral-200');
                    return (
                      <div key={`${detail.id}-${idx}`} className="p-3.5 rounded-xl bg-white border border-[#E7E7E2] shadow-sm v3-space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-2.5 min-w-0">
                            <div className="w-7 h-7 rounded-lg bg-neutral-100 border border-neutral-200 flex items-center justify-center p-1 flex-shrink-0 mt-0.5">
                              {SERVICE_SVGS[st.service] ?? ''}
                            </div>
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-[#111827] flex items-center gap-1.5">
                                <span>{`Bước ${idx + 1}: ${st.serviceName}`}</span>
                                <span className="text-[#9CA3AF]">·</span>
                                <span className="text-[11px] font-normal text-[#6B7280] truncate">{st.targetLoc}</span>
                              </div>
                              <p className="text-xs text-[#374151] mt-0.5 font-medium leading-snug">
                                {st.actionTitle}
                              </p>
                            </div>
                          </div>
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${badgeStyle} flex-shrink-0`}>
                            {st.badge}
                          </span>
                        </div>
                        <div className="flex items-center justify-between pt-2 border-t border-neutral-100 text-xs">
                          <span className="text-[11px] text-[#6B7280]">Đã đối chiếu phạm vi cấp phép</span>
                          <a href={routeOf(st.linkUrl)} onClick={(event) => { event.preventDefault(); showToast(`Mở kết quả trên ${st.serviceName} (mô phỏng liên kết ngoại)`, 'info'); }} className="text-[#FF5701] font-semibold hover:underline inline-flex items-center gap-1">
                            <span>{st.linkText}</span>
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              {/* SƠ ĐỒ TRUYỀN DỮ LIỆU LIÊN CÔNG CỤ */}
              <div id="drawer-data-flow-section" className="v3-space-y-3">
                <div className="flex items-center justify-between border-t border-[#E7E7E2] pt-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#111827] flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#111827] text-white text-[11px] flex items-center justify-center font-bold">
                      2
                    </span>
                    <span>
                      Dòng dữ liệu kết nối
                    </span>
                  </h3>
                  <span className="text-[11px] text-[#6B7280]">
                    Khớp nối tự động giữa các bước
                  </span>
                </div>
                <div id="drawer-data-flow-content" className="p-4 rounded-xl bg-[#F8F8F6] border border-[#E7E7E2] text-xs v3-space-y-2">
                  {detail ? <p className="text-[#374151] leading-relaxed">{detail.dataFlow}</p> : null}
                </div>
              </div>
              {/* NHẬT KÝ SỰ KIỆN CHI TIẾT (AUDIT LOG) */}
              <div className="v3-space-y-3">
                <div className="flex items-center justify-between border-t border-[#E7E7E2] pt-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#111827] flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#111827] text-white text-[11px] flex items-center justify-center font-bold">
                      3
                    </span>
                    <span>
                      Nhật ký sự kiện điều phối
                    </span>
                  </h3>
                  <span className="text-[11px] text-[#6B7280]">
                    Lưu vết từng mốc
                  </span>
                </div>
                <div id="drawer-timeline-logs" className="v3-space-y-2 font-mono text-xs">
                  {detail?.timelineLogs.map((log, idx) => (
                    <div key={`${detail.id}-${idx}`} className="flex items-start gap-2 text-[#4B5563] py-1 border-b border-neutral-100 last:border-b-0">
                      <span className="text-[#FF5701] flex-shrink-0 font-bold">›</span>
                      <span>{log}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {/* Footer Drawer */}
            <div className="px-5 sm:px-6 py-3.5 border-t border-[#E7E7E2] bg-[#F8F8F6] flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-2.5">
              <button type="button" onClick={() => actions.closeDetailDrawer()} className="w-full sm:w-auto px-4 py-2.5 text-xs sm:text-sm font-medium text-[#4B5563] hover:text-[#111827] rounded-xl hover:bg-neutral-200 transition-colors text-center">
                {" Đóng "}
              </button>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
                <button type="button" onClick={() => actions.copyDrawerReport()} className="justify-center px-3.5 py-2.5 text-xs sm:text-sm font-medium text-[#374151] bg-white border border-[#E7E7E2] hover:bg-neutral-50 rounded-xl transition-colors shadow-sm inline-flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                  </svg>
                  <span>
                    Sao chép biên nhận
                  </span>
                </button>
                <button type="button" id="btn-replay-stage" onClick={() => actions.replayInStage()} className="justify-center px-4 py-2.5 text-xs sm:text-sm font-semibold text-white bg-[#FF5701] hover:bg-[#E04D00] rounded-xl transition-all shadow-sm inline-flex items-center gap-1.5">
                  <span>
                    Mở lại trên sân khấu →
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
