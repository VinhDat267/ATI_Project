// Chuyển từ docs/design/prototypes/settings.html bằng scripts/html-to-jsx.mjs, sau đó sửa tay.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { usePrototypePage, type PageMeta } from '../../app/usePrototypePage';
import css from './page.css?inline';
import { INITIAL_SERVICES_DATA, SERVICE_SVGS, type Service } from './data';

type Role = 'admin' | 'member';
type ResultKind = 'saved' | 'success' | 'rejected' | 'timeout';
type Toast = { id: number; message: string; bg: string; phase: 'enter' | 'shown' | 'leaving' };
// Ảnh chụp tại lần vẽ gần nhất: bản mẫu chỉ ghi DOM ở một số thao tác, giữa các lần đó DOM giữ nội dung cũ (kể cả khi ngăn đã ẩn).
// openServiceDrawer ghi tiêu đề, hướng dẫn và ô nhập khoá; version đổi thì ô nhập dựng lại rỗng như innerHTML mới.
type DrawerView = { service: Service; version: number };
type ScopeView = { items: string[]; isMember: boolean; scopeLabel: string };
type TestButton = { disabled: boolean; dim: boolean; spinning: boolean };
type ResultView = { kind: ResultKind | null; time: string; visible: boolean };
type KeyField = HTMLInputElement | HTMLTextAreaElement;

const JIRA_SITE_URL = /^https:\/\/[a-zA-Z0-9-]+\.atlassian\.net\/?$/;
const GITHUB_REPO = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
const SAVED_PLACEHOLDER = 'Đã lưu · nhập lại nếu muốn thay';
const ROLE_ON: Record<Role, string> = {
  admin: 'px-2.5 py-1.5 rounded-md text-xs font-medium text-white bg-[#FF5701] shadow-sm transition-all',
  member: 'px-2.5 py-1.5 rounded-md text-xs font-medium text-white bg-[#111827] shadow-sm transition-all',
};
const ROLE_OFF = 'px-2.5 py-1.5 rounded-md text-xs font-medium text-[#4B5563] hover:text-[#111827] transition-all';
const TOAST_BASE = 'px-4 py-2.5 rounded-xl shadow-lg text-xs sm:text-sm font-medium transition-all v3-transform duration-200 pointer-events-auto flex items-center gap-2';
const TOAST_PHASE = { enter: 'translate-y-2 opacity-0', shown: '', leaving: 'opacity-0 -translate-y-2' };
const TOAST_BG: Record<string, string> = { info: 'bg-[#111827] text-white', success: 'bg-[#16A34A] text-white', error: 'bg-[#DC2626] text-white' };
const WARNING_PATH = 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z';
const resultIcon = (color: string, d: string) => (
  <svg className={`w-4 h-4 ${color}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={d} /></svg>
);
// Hộp kết quả ở mục 3 (saveServiceChanges, runTestConnection).
const RESULT: Record<ResultKind, { box: string; icon: ReactNode; message: string; time: (t: string) => string }> = {
  saved: {
    box: 'p-3.5 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-xs leading-relaxed',
    icon: resultIcon('text-amber-600', WARNING_PATH),
    message: 'Đã lưu khoá mới. Trạng thái hiện tại: Chưa kiểm tra. Hãy bấm nút Kiểm tra kết nối bên trên.',
    time: () => '',
  },
  success: {
    box: 'p-3.5 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-900 text-xs leading-relaxed',
    icon: resultIcon('text-[#16A34A]', 'M5 13l4 4L19 7'),
    message: 'Kết nối tốt (320 ms)',
    time: t => `Đã kiểm tra thành công lúc ${t}`,
  },
  rejected: {
    box: 'p-3.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-900 text-xs leading-relaxed',
    icon: resultIcon('text-[#DC2626]', WARNING_PATH),
    message: 'Khoá truy cập bị từ chối (HTTP 401). Vui lòng kiểm tra lại quyền.',
    time: t => `Thời gian ghi nhận: ${t}`,
  },
  timeout: {
    box: 'p-3.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-900 text-xs leading-relaxed',
    icon: resultIcon('text-rose-600', 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'),
    message: 'Không nhận được phản hồi sau 10 giây. Thử lại sau.',
    time: t => `Thời gian ghi nhận: ${t}`,
  },
};
const cloneService = (s: Service): Service => ({ ...s, scopeItems: [...s.scopeItems], keyInputs: s.keyInputs.map(input => ({ ...input })) });
const cloneServices = (list: Service[]) => list.map(cloneService);
const currentTime = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// getStatusBadgeHtml.
function StatusBadge({ service }: { service: Service }) {
  const timeStr = service.lastCheckTime ? ` · kiểm tra lúc ${service.lastCheckTime}` : '';
  if (!service.configured) {
    return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-neutral-100 text-[#6B7280] border border-[#E7E7E2]">
      <span className="w-1.5 h-1.5 rounded-full bg-[#9CA3AF]" />
      <span>Chưa kết nối</span>
    </span>;
  }
  if (service.statusType === 'untested') {
    return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
      <span>Chưa kiểm tra</span>
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
        {SERVICE_SVGS[service.id] ?? ''}
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

export const meta: PageMeta = {
  id: "settings",
  title: "Kết nối dịch vụ — ATI",
  htmlClass: "",
  bodyClass: "min-h-screen flex flex-col bg-[#F8F8F6] text-[#111827]",
  css,
};

export function SettingsPage() {
  usePrototypePage(meta);
  // Dữ liệu như biến toàn cục của bản mẫu; giao diện chỉ đổi khi gọi các hàm vẽ lại bên dưới.
  const model = useRef({
    services: cloneServices(INITIAL_SERVICES_DATA),
    role: 'admin' as Role,
    activeId: null as string | null,
    lastFocused: null as HTMLElement | null,
    testTimer: null as number | null,
    containerVisible: false,
    drawerVersion: 0,
  });
  const [role, setRoleView] = useState<Role>('admin');
  const [menuOpen, setMenuOpen] = useState(false);
  const [list, setList] = useState<Service[]>(() => cloneServices(INITIAL_SERVICES_DATA));
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Ngăn chi tiết: containerVisible là class hidden của khung, shown là trạng thái hiệu ứng của nền và panel.
  const [containerVisible, setContainerVisible] = useState(false);
  const [shown, setShown] = useState(false);
  const [drawer, setDrawer] = useState<DrawerView | null>(null);
  const [badge, setBadge] = useState<Service | null>(null);
  const [drawerRole, setDrawerRole] = useState<Role>('admin');
  const [keyHelpOpen, setKeyHelpOpen] = useState(false);
  const [hint, setHint] = useState({ text: 'Gợi ý...', visible: false });
  const [jiraInvalid, setJiraInvalid] = useState(false);
  const [savedPlaceholder, setSavedPlaceholder] = useState(false);
  const [scope, setScope] = useState<ScopeView | null>(null);
  const [scopeError, setScopeError] = useState({ text: 'Cần ít nhất một mục được phép dùng.', visible: false });
  const [newScopeInvalid, setNewScopeInvalid] = useState(false);
  const [saveError, setSaveError] = useState({ text: '', visible: false });
  const [testButton, setTestButton] = useState<TestButton>({ disabled: false, dim: false, spinning: false });
  const [result, setResult] = useState<ResultView>({ kind: null, time: '', visible: false });
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const testResultRef = useRef<HTMLSelectElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const newScopeRef = useRef<HTMLInputElement>(null);
  const keyRefs = useRef<Record<string, KeyField | null>>({});
  const toastId = useRef(0);
  const timers = useRef<number[]>([]);
  const later = (ms: number, run: () => void) => {
    const id = window.setTimeout(run, ms);
    timers.current.push(id);
    return id;
  };
  useEffect(() => () => {
    timers.current.forEach(window.clearTimeout);
    document.body.style.overflow = '';
  }, []);

  const showToast = (message: string, type = 'info') => {
    const id = ++toastId.current;
    setToasts(items => [...items, { id, message, bg: TOAST_BG[type] ?? TOAST_BG.info, phase: 'enter' }]);
    requestAnimationFrame(() => setToasts(items => items.map(t => (t.id === id ? { ...t, phase: 'shown' } : t))));
    later(3500, () => {
      setToasts(items => items.map(t => (t.id === id ? { ...t, phase: 'leaving' } : t)));
      later(250, () => setToasts(items => items.filter(t => t.id !== id)));
    });
  };
  const activeService = () => model.current.services.find(s => s.id === model.current.activeId);
  const keyFields = () => Object.values(keyRefs.current).filter((field): field is KeyField => field !== null);
  const renderServiceLists = () => setList(cloneServices(model.current.services));
  const renderScopeChips = (service: Service) => {
    if (!service.scopeItems || service.scopeItems.length === 0) {
      setScope({ items: [], isMember: false, scopeLabel: service.scopeLabel });
      setScopeError({ text: `Cần ít nhất một ${service.scopeLabel}.`, visible: true });
      return;
    }
    setScopeError(error => ({ ...error, visible: false }));
    setScope({ items: [...service.scopeItems], isMember: model.current.role === 'member', scopeLabel: service.scopeLabel });
  };
  const updateTestConnectionButtonState = (service: Service | undefined) => {
    const ready = !!service?.configured;
    setTestButton(button => ({ ...button, disabled: !ready, dim: !ready }));
  };
  const applyRoleToDrawer = () => {
    setDrawerRole(model.current.role);
    const service = model.current.activeId ? activeService() : undefined;
    if (service) {
      renderScopeChips(service);
      updateTestConnectionButtonState(service);
    }
  };
  const resetTestButton = () => {
    setTestButton(button => ({ ...button, spinning: false }));
    const service = activeService();
    if (service) updateTestConnectionButtonState(service);
    else setTestButton(button => ({ ...button, disabled: false }));
  };
  const actions = {
    setRole(next: Role) {
      model.current.role = next;
      setRoleView(next);
      setMenuOpen(false);
      if (model.current.activeId) applyRoleToDrawer();
      showToast(`Đã chuyển vai trò sang: ${next === 'admin' ? 'Quản trị viên' : 'Thành viên'}`);
    },
    resetDemoData() {
      model.current.services = cloneServices(INITIAL_SERVICES_DATA);
      renderServiceLists();
      if (model.current.activeId) actions.openServiceDrawer(model.current.activeId);
      setMenuOpen(false);
      showToast('Đã khôi phục dữ liệu mẫu ban đầu.');
    },
    openServiceDrawer(serviceId: string) {
      const m = model.current;
      const service = m.services.find(s => s.id === serviceId);
      if (!service) return;
      m.activeId = serviceId;
      m.lastFocused = document.getElementById(`service-row-${serviceId}`);
      m.drawerVersion += 1;
      setDrawer({ service: cloneService(service), version: m.drawerVersion });
      setBadge(cloneService(service));
      setKeyHelpOpen(false);
      if (service.hint) setHint({ text: service.hint, visible: true });
      else setHint(h => ({ ...h, visible: false }));
      setJiraInvalid(false);
      setSavedPlaceholder(false);
      renderScopeChips(service);
      setResult(r => ({ ...r, visible: false }));
      setSaveError(error => ({ ...error, visible: false }));
      applyRoleToDrawer();
      updateTestConnectionButtonState(service);
      m.containerVisible = true;
      setContainerVisible(true);
      document.body.style.overflow = 'hidden';
      requestAnimationFrame(() => {
        setShown(true);
        closeButtonRef.current?.focus();
      });
    },
    closeServiceDrawer() {
      const m = model.current;
      if (m.testTimer !== null) {
        window.clearTimeout(m.testTimer);
        m.testTimer = null;
      }
      resetTestButton();
      const closingServiceId = m.activeId;
      setShown(false);
      later(260, () => {
        m.containerVisible = false;
        setContainerVisible(false);
        document.body.style.overflow = '';
        m.activeId = null;
        // Trả lại focus: sau khi lưu hoặc đổi nhóm, hàng có thể đã được vẽ lại.
        const targetRow = closingServiceId ? document.getElementById(`service-row-${closingServiceId}`) : null;
        if (targetRow) targetRow.focus();
        else m.lastFocused?.focus();
      });
    },
    toggleKeyHelp() { setKeyHelpOpen(open => !open); },
    onKeyInputChanged(inputId: string) {
      const service = activeService();
      const input = keyRefs.current[inputId];
      if (!service || !input) return;
      if (service.id === 'jira' && inputId === 'key_1') {
        const val = input.value.trim();
        setJiraInvalid(!!val && !JIRA_SITE_URL.test(val));
      }
    },
    onScopeInputChanged() {
      const service = activeService();
      const input = newScopeRef.current;
      if (!service || !input) return;
      const val = input.value.trim();
      setNewScopeInvalid(service.id === 'github' && !!val && !GITHUB_REPO.test(val));
    },
    addNewScopeItem() {
      if (model.current.role === 'member') return;
      const service = activeService();
      const input = newScopeRef.current;
      if (!service || !input) return;
      const val = input.value.trim();
      if (!val) {
        input.focus();
        return;
      }
      // GitHub phải dạng chủ/tên-kho.
      if (service.id === 'github' && !GITHUB_REPO.test(val)) {
        showToast('Repository GitHub phải có định dạng: chủ-kho/tên-kho (ví dụ: VinhDat267/ati-test)', 'error');
        input.focus();
        return;
      }
      if (!service.scopeItems.includes(val)) service.scopeItems.push(val);
      input.value = '';
      setNewScopeInvalid(false);
      renderScopeChips(service);
    },
    removeScopeItem(index: number) {
      if (model.current.role === 'member') return;
      const service = activeService();
      if (!service) return;
      service.scopeItems.splice(index, 1);
      renderScopeChips(service);
    },
    saveServiceChanges() {
      if (model.current.role === 'member') return;
      const service = activeService();
      if (!service) return;
      setSaveError(error => ({ ...error, visible: false }));
      if (service.scopeItems.length === 0) {
        setSaveError({ text: `Cần ít nhất một ${service.scopeLabel}. Hãy thêm vào danh sách trước khi lưu.`, visible: true });
        return;
      }
      const fields = keyFields();
      if (fields.some(field => !field.value.trim())) {
        setSaveError({ text: 'Vui lòng nhập lại đủ các ô khoá để lưu thay đổi.', visible: true });
        return;
      }
      const siteUrl = keyRefs.current.key_1;
      if (service.id === 'jira' && siteUrl && !JIRA_SITE_URL.test(siteUrl.value.trim())) {
        setSaveError({ text: 'Jira Site URL phải có định dạng https://ten-site.atlassian.net', visible: true });
        siteUrl.focus();
        return;
      }
      // Hợp lệ: hàng chuyển sang nhóm "Đã thiết lập", trạng thái Chưa kiểm tra.
      service.configured = true;
      service.statusType = 'untested';
      service.lastCheckTime = null;
      // Khoá lưu xong không bao giờ hiển thị lại.
      fields.forEach(field => { field.value = ''; });
      setSavedPlaceholder(true);
      updateTestConnectionButtonState(service);
      renderServiceLists();
      setBadge(cloneService(service));
      showToast('Đã lưu. Bấm Kiểm tra kết nối để chắc chắn khoá dùng được.');
      setResult({ kind: 'saved', time: '', visible: true });
    },
    runTestConnection() {
      const service = activeService();
      if (!service || !service.configured) return;
      setTestButton(button => ({ ...button, disabled: true, spinning: true }));
      setResult(r => ({ ...r, visible: false }));
      // Kết quả mô phỏng chọn ở menu Kịch bản demo: quá giờ chờ 10 giây, còn lại 600 ms.
      const simulated = testResultRef.current?.value ?? 'success';
      const kind: ResultKind = simulated === 'timeout' ? 'timeout' : simulated === 'success' ? 'success' : 'rejected';
      model.current.testTimer = later(kind === 'timeout' ? 10000 : 600, () => {
        resetTestButton();
        service.lastCheckTime = currentTime();
        service.statusType = kind === 'success' ? 'ok' : 'failed';
        setResult({ kind, time: service.lastCheckTime, visible: true });
        if (kind === 'success') showToast(`${service.name}: Kết nối tốt (320 ms)`, 'success');
        if (kind === 'rejected') showToast(`${service.name}: Lỗi xác thực (HTTP 401)`, 'error');
        renderServiceLists();
        setBadge(cloneService(service));
      });
    },
  };

  // Bấm ngoài menu demo thì đóng; Esc đóng ngăn chi tiết, Tab giữ focus trong ngăn.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !menuButtonRef.current?.contains(target)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (!model.current.containerVisible) return;
      if (event.key === 'Escape') {
        actions.closeServiceDrawer();
        return;
      }
      if (event.key !== 'Tab' || !containerRef.current) return;
      const focusable = containerRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey); };
  });
  // settings#notion mở thẳng ngăn của dịch vụ đó (link từ màn từ chối / hỏi lại).
  useLayoutEffect(() => {
    const linkedId = decodeURIComponent(location.hash.slice(1));
    if (model.current.services.some(s => s.id === linkedId)) actions.openServiceDrawer(linkedId);
  }, []);

  const configured = list.filter(s => s.configured);
  const unconfigured = list.filter(s => !s.configured);
  const okCount = list.filter(s => s.statusType === 'ok').length;
  const isMemberDrawer = drawerRole === 'member';
  const scopeLabel = drawer?.service.scopeLabel;
  return (
    <>
      {/* Toast Thông báo nổi */}
      <div id="toast-container" className="fixed top-5 left-1/2 -translate-x-1/2 z-50 pointer-events-none flex flex-col items-center gap-2" role="status" aria-live="polite">
        {toasts.map(toast => (
          <div key={toast.id} className={`${TOAST_BASE} ${toast.bg} ${TOAST_PHASE[toast.phase]}`.trim()}>
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
      {/* THANH TRÊN (COCKPIT HEADER) */}
      <header className="sticky top-0 z-30 w-full bg-[#F8F8F6]/90 backdrop-blur-md border-b border-[#E7E7E2] px-4 sm:px-6 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
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
          {/* Cụm Trạng thái Vai trò & Điều khiển Demo */}
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            {/* Nhãn vai trò hiện tại */}
            <div id="role-pill-badge" className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-white border border-[#E7E7E2] text-[#4B5563] shadow-sm">
              <span className={`w-2 h-2 rounded-full ${role === 'admin' ? 'bg-[#16A34A]' : 'bg-[#6B7280]'}`} id="role-indicator-dot" />
              <span id="role-name-display">
                {role === 'admin' ? 'Quản trị viên' : 'Thành viên'}
              </span>
            </div>
            {/* Nút Kịch bản demo */}
            <div className="relative inline-block text-left">
              {' '}
              <button ref={menuButtonRef} onClick={(event) => { event.stopPropagation(); setMenuOpen(open => !open); }} id="btn-toggle-demo-menu" type="button" className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#111827] bg-white hover:bg-neutral-100 rounded-lg border border-[#E7E7E2] shadow-sm transition-colors" aria-haspopup="true" aria-expanded={menuOpen ? 'true' : 'false'}>
                <svg className="w-3.5 h-3.5 text-[#FF5701]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span>
                  Kịch bản demo
                </span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#FF5701]/10 text-[#FF5701]">
                  DEMO
                </span>
              </button>
              {' '}
              {/* Menu chọn Kịch bản Demo */}
              {' '}
              <div ref={menuRef} id="demo-menu-dropdown" className={`${menuOpen ? '' : 'hidden '}absolute right-0 mt-2 w-72 bg-white rounded-xl shadow-lg border border-[#E7E7E2] p-3 z-40 v3-space-y-3`} role="menu">
                <div>
                  <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider mb-1.5">
                    Xem giao diện như
                  </p>
                  <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#F8F8F6] rounded-lg border border-[#E7E7E2]">
                    <button type="button" id="demo-role-admin" className={role === 'admin' ? ROLE_ON.admin : ROLE_OFF} onClick={() => actions.setRole('admin')}>
                      Quản trị viên
                    </button>
                    <button type="button" id="demo-role-member" className={role === 'member' ? ROLE_ON.member : ROLE_OFF} onClick={() => actions.setRole('member')}>
                      Thành viên
                    </button>
                  </div>
                  <p className="text-[11px] text-[#6B7280] mt-1">
                    Thành viên chỉ được kiểm tra kết nối, không sửa khoá.
                  </p>
                </div>
                <div className="border-t border-[#E7E7E2] pt-2.5">
                  <label htmlFor="demo-test-result" className="block text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider mb-1.5">
                    Kết quả kiểm tra tiếp theo
                  </label>
                  {' '}
                  <select ref={testResultRef} id="demo-test-result" className="w-full text-xs bg-[#F8F8F6] border border-[#E7E7E2] rounded-lg px-2.5 py-1.5 text-[#111827] focus:v3-outline-none focus:border-[#FF5701]">
                    {' '}
                    <option value="success">
                      Thành công (320 ms)
                    </option>
                    {' '}
                    <option value="rejected">
                      Bị từ chối (Sai khoá / Thiếu quyền)
                    </option>
                    {' '}
                    <option value="timeout">
                      Quá thời gian (10 giây không phản hồi)
                    </option>
                    {' '}
                  </select>
                </div>
                <div className="border-t border-[#E7E7E2] pt-2 flex items-center justify-between">
                  <span className="text-[11px] text-[#6B7280]">
                    Khôi phục mặc định:
                  </span>
                  <button type="button" onClick={() => actions.resetDemoData()} className="text-[11px] text-[#FF5701] hover:underline font-medium">
                    Đặt lại dữ liệu
                  </button>
                </div>
              </div>
              {' '}
            </div>
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
            <div className="inline-flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#16A34A]" />
              <span id="summary-connected-count" className="text-sm sm:text-base font-semibold text-[#111827]">
                {`${configured.length} / ${list.length} dịch vụ đã thiết lập · ${okCount} kết nối tốt`}
              </span>
            </div>
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
        {/* DANH SÁCH 2 NHÓM DỊCH VỤ */}
        <div className="v3-space-y-8 sm:v3-space-y-10">
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
        </div>
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
            <a href="/app-stage" className="hover:text-[#111827] transition-colors">
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
      {/* ============================================================= */}
      {/* NGĂN CHI TIẾT DỊCH VỤ (DRAWER DIALOG / FULLSCREEN MOBILE) */}
      {/* ============================================================= */}
      <div ref={containerRef} id="service-drawer-container" className={`${containerVisible ? '' : 'hidden '}fixed inset-0 z-50 overflow-hidden`} role="dialog" aria-modal="true" aria-labelledby="drawer-service-title">
        {/* Lớp nền mờ (Backdrop) */}
        <div id="drawer-backdrop" className={`drawer-backdrop fixed inset-0 bg-black/40 ${shown ? 'opacity-100' : 'opacity-0'} transition-opacity`} onClick={() => actions.closeServiceDrawer()} />
        <div className="fixed inset-y-0 right-0 max-w-full flex">
          {/* Panel ngăn chi tiết */}
          <div id="drawer-panel" className={`drawer-panel w-screen sm:max-w-xl bg-white shadow-2xl flex flex-col ${shown ? 'translate-x-0' : 'translate-x-full'} border-l border-[#E7E7E2] transition-transform`}>
            {/* Header của ngăn chi tiết */}
            <div className="px-5 sm:px-6 py-4 border-b border-[#E7E7E2] flex items-center justify-between gap-3 bg-[#F8F8F6]">
              <div className="flex items-center gap-3 min-w-0">
                <div id="drawer-icon-container" className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm">
                  {drawer ? SERVICE_SVGS[drawer.service.id] ?? '' : null}
                </div>
                <div className="min-w-0">
                  <h2 id="drawer-service-title" className="font-display text-xl font-bold text-[#111827] truncate">
                    {drawer ? drawer.service.name : 'Trello'}
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
                  <button type="button" id="btn-toggle-key-help" onClick={() => actions.toggleKeyHelp()} className="text-xs text-[#FF5701] hover:underline font-medium inline-flex items-center gap-1">
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
                    <a id="key-help-guide-link" href={drawer ? `/guide?service=${drawer.service.id}` : '/guide'} target="_blank" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#FF5701] hover:underline">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                      </svg>
                      <span>
                        Xem cẩm nang hướng dẫn từng bước kèm hình ảnh →
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
                    const isJiraUrl = drawer.service.id === 'jira' && input.id === 'key_1';
                    const placeholder = savedPlaceholder ? SAVED_PLACEHOLDER : input.placeholder;
                    const locked = isMemberDrawer ? ' bg-neutral-100 cursor-not-allowed' : '';
                    const keyRef = (field: KeyField | null) => { keyRefs.current[input.id] = field; };
                    return (
                      <div key={`${drawer.version}-${input.id}`}>
                        <label htmlFor={input.id} className="block text-xs font-semibold text-[#111827] mb-1.5">
                          {input.label}
                          {' '}
                          <span className="text-[#FF5701]">*</span>
                        </label>
                        {input.type === 'textarea'
                          ? <textarea ref={keyRef} id={input.id} rows={3} disabled={isMemberDrawer} onInput={() => actions.onKeyInputChanged(input.id)} placeholder={placeholder} className={`key-input-field w-full text-xs font-mono px-3 py-2 bg-[#F8F8F6] border border-[#E7E7E2] rounded-lg text-[#111827] focus:bg-white focus:v3-outline-none focus:border-[#FF5701] transition-all resize-y${locked}`} />
                          : <input ref={keyRef} type={input.type} id={input.id} disabled={isMemberDrawer} onInput={() => actions.onKeyInputChanged(input.id)} placeholder={placeholder} className={`key-input-field w-full text-xs sm:text-sm px-3 py-2 bg-[#F8F8F6] border border-[#E7E7E2] rounded-lg text-[#111827] focus:bg-white focus:v3-outline-none focus:border-[#FF5701] transition-all${locked}${isJiraUrl && jiraInvalid ? ' border-rose-400' : ''}`} />}
                        {isJiraUrl ? (
                          <p id={`${input.id}-format-hint`} className={`${jiraInvalid ? '' : 'hidden '}text-[11px] text-[#DC2626] font-medium mt-1`}>
                            Định dạng hợp lệ: https://ten-site.atlassian.net
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
                      <input ref={newScopeRef} type="text" id="new-scope-input" onInput={() => actions.onScopeInputChanged()} placeholder={scopeLabel ? `Nhập ${scopeLabel} mới (ví dụ)...` : 'Nhập ID mới...'} className={`w-full text-xs sm:text-sm px-3 py-2 bg-[#F8F8F6] border border-[#E7E7E2] rounded-lg text-[#111827] focus:bg-white focus:v3-outline-none focus:border-[#FF5701] transition-all${newScopeInvalid ? ' border-rose-400' : ''}`} />
                    </div>
                    <button type="button" id="btn-add-scope" onClick={() => actions.addNewScopeItem()} className="px-3.5 py-2 text-xs sm:text-sm font-medium text-[#111827] bg-[#F8F8F6] hover:bg-neutral-200 border border-[#E7E7E2] rounded-lg transition-colors flex-shrink-0">
                      {" + Thêm "}
                    </button>
                  </div>
                  <p id="new-scope-format-hint" className={`${newScopeInvalid ? '' : 'hidden '}text-[11px] text-[#DC2626] font-medium`}>
                    Định dạng hợp lệ: chủ-kho/tên-kho (ví dụ: VinhDat267/ati-test)
                  </p>
                </div>
              </section>
              {/* KHỐI LƯU THAY ĐỔI (Trước khi kiểm tra) */}
              <div className="bg-[#F8F8F6] p-4 rounded-xl border border-[#E7E7E2] v3-space-y-3">
                <p className="text-xs text-[#4B5563] leading-relaxed">
                  <strong className="text-[#111827]">
                    Lưu ý khi cập nhật:
                  </strong>
                  {" Muốn lưu bất kỳ thay đổi nào (kể cả chỉ thêm/bớt nơi được dùng), bạn cần nhập lại đủ các ô khoá bên trên."}
                </p>
                <div id="save-validation-error" className={`${saveError.visible ? '' : 'hidden '}text-xs text-[#DC2626] font-medium`}>
                  {saveError.text}
                </div>
                <button type="button" id="btn-save-service-changes" disabled={isMemberDrawer} onClick={() => actions.saveServiceChanges()} className={`w-full py-2.5 px-4 text-xs sm:text-sm font-semibold text-white bg-[#FF5701] hover:bg-[#e04d01] rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2${isMemberDrawer ? ' opacity-50 cursor-not-allowed' : ''}`}>
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
                  <button type="button" id="btn-run-test-connection" disabled={testButton.disabled} onClick={() => actions.runTestConnection()} className={`w-full py-2.5 px-4 text-xs sm:text-sm font-semibold text-[#111827] bg-white ${testButton.dim ? 'opacity-50 cursor-not-allowed' : 'hover:bg-neutral-50'} border border-[#E7E7E2] rounded-lg shadow-sm transition-all flex items-center justify-center gap-2`}>
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
                <div id="test-result-box" className={`${result.kind ? RESULT[result.kind].box : 'p-3.5 rounded-xl border text-xs leading-relaxed'}${result.visible ? '' : ' hidden'}`} aria-live="polite">
                  <div className="flex items-start gap-2.5">
                    <span id="test-result-icon" className="mt-0.5 flex-shrink-0">
                      {result.kind ? RESULT[result.kind].icon : null}
                    </span>
                    <div className="flex-1">
                      <p id="test-result-message" className="font-medium">
                        {result.kind ? RESULT[result.kind].message : null}
                      </p>
                      <p id="test-result-time" className="text-[11px] text-[#6B7280] mt-0.5">
                        {result.kind ? RESULT[result.kind].time(result.time) : null}
                      </p>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
