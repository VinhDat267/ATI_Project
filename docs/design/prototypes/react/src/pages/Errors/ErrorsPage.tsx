// Chuyển từ docs/design/prototypes/errors.html bằng scripts/html-to-jsx.mjs, sau đó sửa tay.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { usePrototypePage, type PageMeta } from '../../app/usePrototypePage';
import { navigate } from '../../app/router';
import css from './page.css?inline';

const SCENARIOS = ['offline', 'session', 'timeout', 'server', '404'] as const;
type Scenario = typeof SCENARIOS[number];
type ToastType = 'info' | 'success' | 'warn';
const TAB_CURRENT = 'scenario-nav-btn px-3.5 py-1.5 rounded-lg text-xs font-medium bg-[#111827] text-white shadow-sm transition-all flex-shrink-0';
const TAB_OTHER = 'scenario-nav-btn px-3.5 py-1.5 rounded-lg text-xs font-medium bg-white text-[#4B5563] hover:text-[#111827] hover:bg-neutral-100 border border-[#E7E7E2] transition-all flex-shrink-0';
const SUB_ON = 'px-3 py-1 rounded text-xs font-semibold text-white bg-[#FF5701] shadow-sm transition-all';
const SUB_OFF = 'px-3 py-1 rounded text-xs font-medium text-[#4B5563] hover:text-[#111827] transition-all';
// Toast có cả text-white và màu chữ theo loại: v3 cho màu theo loại thắng (xếp theo bảng màu), v4 cho text-white thắng
// (xếp theo tên class), nên đánh dấu ! để giữ kết quả của v3.
const TOAST_BORDER: Record<ToastType, string> = { info: 'border-neutral-700', success: 'border-emerald-600 text-emerald-400!', warn: 'border-amber-600 text-amber-400!' };
const TOAST_ICON: Record<ToastType, string> = { info: 'ℹ️', success: '✓', warn: '⚠️' };
const spinner = <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>;
const refreshIcon = <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>;
const readScenario = (): Scenario => {
  const type = new URLSearchParams(window.location.search).get('type');
  return (SCENARIOS as readonly string[]).includes(type ?? '') ? type as Scenario : 'offline';
};

export const meta: PageMeta = {
  id: "errors",
  title: "Xử lý lỗi & Khôi phục sự cố — ATI",
  htmlClass: "",
  bodyClass: "min-h-screen flex flex-col bg-[#F8F8F6] text-[#111827]",
  css,
};

export function ErrorsPage() {
  usePrototypePage(meta);
  const [scenario, setScenarioState] = useState<Scenario>(readScenario);
  const [scenarioTick, setScenarioTick] = useState(0);
  const [seconds, setSeconds] = useState(18);
  const [offlineMode, setOfflineMode] = useState<'write' | 'general'>('write');
  const [simulatedOffline, setSimulatedOffline] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState<{ visible: boolean; message: string; type: ToastType } | null>(null);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [reloginBusy, setReloginBusy] = useState(false);
  const [waitBusy, setWaitBusy] = useState(false);
  const [retryBusy, setRetryBusy] = useState(false);
  const toastTimer = useRef<number | undefined>(undefined);
  const timers = useRef<number[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const promptRef = useRef<HTMLDivElement>(null);
  // Hẹn giờ của trang bị huỷ khi rời trang, như khi tải trang HTML khác.
  const later = (ms: number, run: () => void) => { timers.current.push(window.setTimeout(run, ms)); };
  useEffect(() => () => { timers.current.forEach(window.clearTimeout); window.clearTimeout(toastTimer.current); }, []);

  // Ghi ?type= lên URL như bản mẫu (replaceState, không cuộn trang).
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('type', scenario);
    window.history.replaceState({}, '', url);
  }, [scenario, scenarioTick]);
  // Tình huống 3 đếm giây từ 18, chạy lại mỗi lần chọn tình huống này.
  useEffect(() => {
    if (scenario !== 'timeout') return;
    setSeconds(18);
    const interval = window.setInterval(() => setSeconds(value => value + 1), 1000);
    return () => window.clearInterval(interval);
  }, [scenario, scenarioTick]);
  // Menu demo: bấm ra ngoài hoặc Esc thì đóng.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !menuButtonRef.current?.contains(target)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('click', onClick);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('click', onClick); window.removeEventListener('keydown', onKey); };
  }, []);

  const showToast = (message: string, type: ToastType = 'info') => {
    setToast({ visible: true, message, type });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(current => current && { ...current, visible: false }), 3500);
  };
  const actions = {
    setScenario(type: Scenario) {
      setScenarioState(SCENARIOS.includes(type) ? type : 'offline');
      setScenarioTick(tick => tick + 1);
    },
    closeDemoMenu() { setMenuOpen(false); },
    switchOfflineSubMode(mode: 'write' | 'general') { setOfflineMode(mode); },
    confirmOfflineStep(choice: 'has_issue' | 'stop') {
      if (choice === 'has_issue') {
        showToast('✓ Đã xác nhận có issue. ATI bỏ qua bước này và tiếp tục làm tiếp…', 'success');
        later(1500, () => navigate('/app-stage'));
      } else {
        showToast('Đã dừng kế hoạch. Bước 1 trên Trello vẫn được giữ nguyên an toàn.', 'info');
      }
    },
    checkNetworkConnection(manual: boolean) {
      if (manual) showToast('Đang kiểm tra tín hiệu mạng Internet…', 'info');
      later(700, () => {
        showToast('✓ Đã kết nối Internet thành công.', 'success');
        setSimulatedOffline(false);
      });
    },
    toggleSimulatedOffline() {
      const next = !simulatedOffline;
      setSimulatedOffline(next);
      showToast(next ? 'Đã bật mô phỏng dải cảnh báo mất mạng' : 'Đã tắt mô phỏng mất mạng', next ? 'warn' : 'info');
    },
    handleQuickRelogin(event: FormEvent) {
      event.preventDefault();
      setReloginBusy(true);
      later(1000, () => {
        setReloginBusy(false);
        showToast('✓ Đăng nhập thành công! Đang chuyển về sân khấu làm việc…', 'success');
        later(1200, () => navigate('/app-stage'));
      });
    },
    handleGoogleRelogin() {
      showToast('Đang kết nối lại với tài khoản Google…', 'info');
      later(1000, () => {
        showToast('✓ Đã xác thực Google thành công! Đang khôi phục sân khấu…', 'success');
        later(1200, () => navigate('/app-stage'));
      });
    },
    togglePasswordVisibility() { setPasswordVisible(visible => !visible); },
    continueWaiting() {
      setWaitBusy(true);
      showToast('ATI đang tiếp tục chờ phản hồi từ GitHub và Sheets…', 'info');
      later(1500, () => setWaitBusy(false));
    },
    cancelSlowRequest() {
      showToast('Đã hủy yêu cầu an toàn. Câu lệnh đã được giữ lại cho bạn.', 'info');
      later(1200, () => navigate('/app-stage'));
    },
    retryServerRequest() {
      setRetryBusy(true);
      later(1200, () => {
        setRetryBusy(false);
        showToast('✓ Máy chủ đã sẵn sàng! Đang chuyển bạn về sân khấu làm việc…', 'success');
        later(1200, () => navigate('/app-stage'));
      });
    },
    copyOriginalPrompt() {
      const text = promptRef.current?.innerText.trim() ?? '';
      navigator.clipboard.writeText(text)
        .then(() => showToast('✓ Đã sao chép câu yêu cầu vào bộ nhớ tạm', 'success'))
        .catch(() => showToast('Đã chọn câu yêu cầu để sao chép', 'info'));
    },
  };
  const tab = (s: Scenario) => ({ className: scenario === s ? TAB_CURRENT : TAB_OTHER, 'aria-pressed': scenario === s ? 'true' as const : 'false' as const });
  const view = (s: Scenario) => (scenario === s ? '' : 'hidden ');
  const toastContent: ReactNode = toast
    ? <><span className={toast.type === 'success' ? 'text-emerald-400 font-bold' : ''}>{TOAST_ICON[toast.type]}</span><span>{toast.message}</span></>
    : <>Thông báo</>;
  return (
    <>
      {/* Dải cảnh báo mất mạng trực tiếp (Cấp độ toàn hệ thống) */}
      <aside id="network-offline-banner" className={`${simulatedOffline ? '' : 'hidden '}w-full bg-amber-500 text-white px-4 py-2 text-xs sm:text-sm font-medium transition-all z-50`}>
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 animate-pulse flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 4.243a9 9 0 01-12.728 0m0 0l2.829-2.829m-2.829 2.829L3 21M8.464 15.536a5 5 0 010-7.072m0 0l2.829 2.829" />
            </svg>
            <span>
              Mất kết nối Internet. Đang chờ kết nối lại…
            </span>
          </div>
          <button type="button" onClick={() => actions.checkNetworkConnection(true)} className="underline hover:text-amber-100 flex-shrink-0 text-xs">
            Thử lại ngay
          </button>
        </div>
      </aside>
      {/* 1. Thanh trên giống cockpit */}
      <header className="sticky top-0 z-40 w-full bg-[#F8F8F6]/90 backdrop-blur-md border-b border-[#E7E7E2] px-4 sm:px-6 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
          {/* Cụm Logo & Quay lại */}
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
            <span className="hidden md:inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-neutral-200/70 text-[#4B5563]">
              Xử lý lỗi &amp; Khôi phục
            </span>
          </div>
          {/* Cụm Điều khiển Demo */}
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            <div className="relative inline-block text-left">
              {' '}
              <button ref={menuButtonRef} onClick={() => setMenuOpen(open => !open)} id="btn-toggle-demo-menu" type="button" className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] text-xs font-medium text-[#111827] bg-white hover:bg-neutral-100 rounded-lg border border-[#E7E7E2] shadow-sm transition-colors" aria-haspopup="true" aria-expanded={menuOpen ? 'true' : 'false'}>
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
              {/* Dropdown menu demo */}
              {' '}
              <div ref={menuRef} id="demo-menu-dropdown" className={`${menuOpen ? '' : 'hidden '}absolute right-0 mt-2 w-72 max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-lg border border-[#E7E7E2] p-3 z-50 v3-space-y-3`} role="menu">
                <div>
                  <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider mb-2">
                    Chọn nhanh tình huống lỗi
                  </p>
                  <div className="v3-space-y-1">
                    <button type="button" onClick={() => { actions.setScenario('offline'); actions.closeDemoMenu(); }} className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#111827] hover:bg-[#F8F8F6] flex items-center justify-between">
                      <span>
                        1. Mất mạng khi đang ghi
                      </span>
                      <span className="text-[10px] text-[#6B7280]">
                        Offline
                      </span>
                    </button>
                    <button type="button" onClick={() => { actions.setScenario('session'); actions.closeDemoMenu(); }} className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#111827] hover:bg-[#F8F8F6] flex items-center justify-between">
                      <span>
                        2. Hết phiên đăng nhập
                      </span>
                      <span className="text-[10px] text-[#6B7280]">
                        Auth Expired
                      </span>
                    </button>
                    <button type="button" onClick={() => { actions.setScenario('timeout'); actions.closeDemoMenu(); }} className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#111827] hover:bg-[#F8F8F6] flex items-center justify-between">
                      <span>
                        3. Model trả lời chậm
                      </span>
                      <span className="text-[10px] text-[#6B7280]">
                        AI Thinking
                      </span>
                    </button>
                    <button type="button" onClick={() => { actions.setScenario('server'); actions.closeDemoMenu(); }} className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#111827] hover:bg-[#F8F8F6] flex items-center justify-between">
                      <span>
                        4. Lỗi máy chủ (500)
                      </span>
                      <span className="text-[10px] text-[#6B7280]">
                        500 Error
                      </span>
                    </button>
                    <button type="button" onClick={() => { actions.setScenario('404'); actions.closeDemoMenu(); }} className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#111827] hover:bg-[#F8F8F6] flex items-center justify-between">
                      <span>
                        5. Không tìm thấy trang (404)
                      </span>
                      <span className="text-[10px] text-[#6B7280]">
                        404 Not Found
                      </span>
                    </button>
                  </div>
                </div>
                <div className="pt-2 border-t border-[#E7E7E2]">
                  <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider mb-2">
                    Thao tác mô phỏng
                  </p>
                  <button type="button" onClick={() => actions.toggleSimulatedOffline()} id="btn-demo-toggle-offline" className="w-full px-2.5 py-1.5 rounded-lg text-xs font-medium border border-[#E7E7E2] hover:bg-neutral-50 text-left flex items-center justify-between">
                    <span>
                      Bật/Tắt dải mất mạng
                    </span>
                    <span id="badge-offline-state" className={simulatedOffline ? 'text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold' : 'text-[10px] px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-600'}>
                      {simulatedOffline ? 'Đang bật' : 'Đang tắt'}
                    </span>
                  </button>
                </div>
              </div>
              {' '}
            </div>
          </div>
        </div>
      </header>
      {/* 2. Dải chọn 5 tình huống lỗi (nút có aria-pressed) */}
      <nav className="sticky top-[57px] z-30 w-full bg-[#F8F8F6]/95 backdrop-blur-md border-b border-[#E7E7E2] px-4 sm:px-6 py-2.5" aria-label="Chọn tình huống lỗi chung">
        <div className="max-w-4xl mx-auto flex items-center gap-2 overflow-x-auto whitespace-nowrap no-scrollbar">
          <button type="button" id="tab-offline" {...tab('offline' as Scenario)} onClick={() => actions.setScenario('offline')}>
            {" 1. Mất mạng "}
          </button>
          <button type="button" id="tab-session" {...tab('session' as Scenario)} onClick={() => actions.setScenario('session')}>
            {" 2. Hết phiên đăng nhập "}
          </button>
          <button type="button" id="tab-timeout" {...tab('timeout' as Scenario)} onClick={() => actions.setScenario('timeout')}>
            {" 3. Model trả lời chậm "}
          </button>
          <button type="button" id="tab-server" {...tab('server' as Scenario)} onClick={() => actions.setScenario('server')}>
            {" 4. Lỗi máy chủ (500) "}
          </button>
          <button type="button" id="tab-404" {...tab('404' as Scenario)} onClick={() => actions.setScenario('404')}>
            {" 5. Trang 404 "}
          </button>
        </div>
      </nav>
      {/* 3. Khu vực nội dung kịch bản lỗi */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 v3-space-y-6" aria-live="polite">
        {/* ==================== TÌNH HUỐNG 1: MẤT MẠNG ==================== */}
        <section id="view-offline" className={`${view('offline' as Scenario)}v3-space-y-6`}>
          {/* Hộp điều khiển chuyển biến thể mất mạng */}
          <div className="flex items-center justify-between flex-wrap gap-3 bg-white p-3.5 rounded-xl border border-[#E7E7E2] shadow-sm">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
              <span className="text-xs font-semibold text-[#111827]">
                Tình huống mất kết nối:
              </span>
            </div>
            <div className="flex items-center gap-1.5 bg-[#F8F8F6] p-1 rounded-lg border border-[#E7E7E2]">
              <button type="button" id="btn-sub-offline-write" onClick={() => actions.switchOfflineSubMode('write')} className={offlineMode === 'write' ? SUB_ON : SUB_OFF}>
                {" Mất mạng khi đang ghi (Cốt lõi ATI) "}
              </button>
              <button type="button" id="btn-sub-offline-general" onClick={() => actions.switchOfflineSubMode('general')} className={offlineMode === 'general' ? SUB_ON : SUB_OFF}>
                {" Mất mạng khi đang lướt "}
              </button>
            </div>
          </div>
          {/* Biến thể 1A: Mất mạng đúng lúc đang ghi (Nguyên tắc an toàn then chốt của ATI) */}
          <div id="offline-sub-write" className={`${offlineMode === 'write' ? '' : 'hidden '}v3-space-y-5`}>
            {/* Thẻ chính cảnh báo dừng khẩn cấp */}
            <div className="bg-white rounded-2xl border-2 border-amber-500/40 p-5 sm:p-7 shadow-soft v3-space-y-5">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center flex-shrink-0 border border-amber-200">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div className="v3-space-y-1.5 flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-800 uppercase tracking-wide">
                      Dừng lại hỏi bạn
                    </span>
                    <span className="text-xs text-[#6B7280]">
                      Đã ngắt kết nối lúc 14:28:12
                    </span>
                  </div>
                  <h1 className="font-display font-bold text-xl sm:text-2xl text-[#111827]">
                    Mạng bị gián đoạn đúng lúc đang ghi lên GitHub
                  </h1>
                  <p className="text-sm text-[#4B5563] leading-relaxed">
                    {"Hệ thống đang thực hiện bước số 2 (tạo issue trên GitHub) thì đường truyền mạng bị mất. Vì không thể chắc chắn dữ liệu đã được lưu trên GitHub hay chưa, ATI dừng lại để hỏi bạn — "}
                    <strong>
                      tuyệt đối không tự ý ghi lại
                    </strong>
                    {" nhằm tránh tạo 2 issue trùng lặp hoặc sai lệch dữ liệu."}
                  </p>
                </div>
              </div>
              {/* Bảng trạng thái chi tiết 4 bước trong kế hoạch */}
              <div className="p-4 bg-[#F8F8F6] rounded-xl border border-[#E7E7E2] v3-space-y-3">
                <div className="flex items-center justify-between text-xs font-semibold text-[#111827]">
                  <span>
                    Tiến trình kế hoạch khi mạng ngắt
                  </span>
                  <span className="text-amber-700">
                    1/4 việc đã xong · 1 việc chưa rõ · 2 việc đang chờ
                  </span>
                </div>
                <div className="v3-space-y-2 text-xs">
                  {/* Bước 1: Trello */}
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-white border border-[#E7E7E2]">
                    <div className="flex items-center gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-[10px]">
                        ✓
                      </span>
                      <span className="font-medium text-[#111827]">
                        Bước 1: Trello — Tạo card "Sửa lỗi đăng nhập Google"
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                        Đã xong chắc chắn
                      </span>
                      <a href="#" className="text-[#FF5701] hover:underline inline-flex items-center gap-0.5">
                        Mở card ↗
                      </a>
                    </div>
                  </div>
                  {/* Bước 2: GitHub (Bị gián đoạn) */}
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-amber-50 border border-amber-300">
                    <div className="flex items-center gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-amber-500 text-white flex items-center justify-center font-bold text-[10px]">
                        ?
                      </span>
                      <div>
                        <span className="font-semibold text-amber-900">
                          Bước 2: GitHub — Tạo issue trong kho ati-test
                        </span>
                        {' '}
                        <p className="text-[11px] text-amber-700">
                          Mạng ngắt giữa chừng phản hồi từ GitHub
                        </p>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-200 text-amber-900">
                      Cần bạn xác nhận
                    </span>
                  </div>
                  {/* Bước 3: Google Sheets */}
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-white/70 border border-[#E7E7E2] opacity-75">
                    <div className="flex items-center gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-neutral-200 text-neutral-600 flex items-center justify-center font-bold text-[10px]">
                        3
                      </span>
                      <span className="text-[#6B7280]">
                        Bước 3: Google Sheets — Thêm một dòng vào trang Tasks
                      </span>
                    </div>
                    <span className="text-[#6B7280]">
                      Chưa ghi
                    </span>
                  </div>
                  {/* Bước 4: Slack */}
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-white/70 border border-[#E7E7E2] opacity-75">
                    <div className="flex items-center gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-neutral-200 text-neutral-600 flex items-center justify-center font-bold text-[10px]">
                        4
                      </span>
                      <span className="text-[#6B7280]">
                        Bước 4: Slack — Gửi tin nhắn vào kênh #ati-test
                      </span>
                    </div>
                    <span className="text-[#6B7280]">
                      Chưa gửi
                    </span>
                  </div>
                </div>
              </div>
              {/* Hướng dẫn nếu chưa có issue */}
              <p className="text-xs text-[#4B5563] bg-amber-50/60 p-3 rounded-xl border border-amber-200/60">
                Nếu chưa có issue: dừng kế hoạch, rồi gửi lại yêu cầu để ATI lập kế hoạch mới.
              </p>
              {/* Các nút hành động để người dùng quyết định */}
              <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="px-4 py-2.5 rounded-xl bg-white hover:bg-neutral-50 text-[#111827] text-xs font-semibold border border-[#E7E7E2] shadow-sm flex items-center justify-center gap-1.5 text-center">
                  <svg className="w-4 h-4 text-[#24292E]" fill="currentColor" viewBox="0 0 24 24">
                    <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                  </svg>
                  <span>
                    Kiểm tra trên GitHub ↗
                  </span>
                </a>
                <button type="button" onClick={() => actions.confirmOfflineStep('has_issue')} className="px-4 py-2.5 rounded-xl bg-[#FF5701] hover:bg-[#e04d00] text-white text-xs font-semibold shadow-sm flex items-center justify-center gap-1.5 transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                  </svg>
                  <span>
                    Đã thấy issue trên GitHub → Bỏ qua bước này và làm tiếp
                  </span>
                </button>
                <button type="button" onClick={() => actions.confirmOfflineStep('stop')} className="px-4 py-2.5 rounded-xl bg-white hover:bg-neutral-50 text-neutral-600 hover:text-red-600 text-xs font-medium border border-[#E7E7E2] transition-colors sm:ml-auto">
                  {" Dừng kế hoạch "}
                </button>
              </div>
            </div>
            <p className="text-xs text-[#6B7280] italic text-center">
              Nguyên tắc ATI: Không bao giờ tự động gửi lại yêu cầu ghi khi mất mạng giữa chừng mà không có sự đồng ý của bạn.
            </p>
          </div>
          {/* Biến thể 1B: Mất mạng khi đang lướt bình thường */}
          <div id="offline-sub-general" className={`${offlineMode === 'general' ? '' : 'hidden '}v3-space-y-5`}>
            <div className="bg-white rounded-2xl border border-[#E7E7E2] p-6 sm:p-8 shadow-soft text-center v3-space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto border border-amber-200">
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 4.243a9 9 0 01-12.728 0m0 0l2.829-2.829m-2.829 2.829L3 21M8.464 15.536a5 5 0 010-7.072m0 0l2.829 2.829" />
                </svg>
              </div>
              <div className="v3-space-y-1.5 max-w-md mx-auto">
                <h2 className="font-display font-bold text-xl sm:text-2xl text-[#111827]">
                  Không có kết nối Internet
                </h2>
                <p className="text-sm text-[#4B5563]">
                  Vui lòng kiểm tra lại đường truyền Wi-Fi hoặc mạng dây của bạn. Khi có mạng lại, bấm Thử lại. Những việc chưa duyệt sẽ không tự chạy.
                </p>
              </div>
              <div className="pt-2 flex items-center justify-center gap-3">
                <button type="button" onClick={() => actions.checkNetworkConnection(true)} className="px-4 py-2.5 rounded-xl bg-[#FF5701] hover:bg-[#e04d00] text-white text-xs font-semibold shadow-sm transition-colors flex items-center gap-1.5">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span>
                    Thử lại
                  </span>
                </button>
                <a href="/app-stage" className="px-4 py-2.5 rounded-xl bg-white hover:bg-neutral-50 text-[#4B5563] text-xs font-medium border border-[#E7E7E2]">
                  {" Về sân khấu "}
                </a>
              </div>
            </div>
          </div>
        </section>
        {/* ==================== TÌNH HUỐNG 2: HẾT PHIÊN ĐĂNG NHẬP ==================== */}
        <section id="view-session" className={`${view('session' as Scenario)}v3-space-y-6`}>
          <div className="bg-white rounded-2xl border border-[#E7E7E2] p-5 sm:p-8 shadow-soft max-w-lg mx-auto v3-space-y-5">
            <div className="text-center v3-space-y-2">
              <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto border border-amber-200">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h1 className="font-display font-bold text-xl sm:text-2xl text-[#111827]">
                Phiên đăng nhập đã hết hạn
              </h1>
              <p className="text-xs sm:text-sm text-[#4B5563] leading-relaxed">
                Phiên đăng nhập có hạn 7 ngày và đã hết.
              </p>
            </div>
            {/* Thông báo lưu trữ lịch sử */}
            <div className="p-3.5 bg-emerald-50 rounded-xl border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
              <svg className="w-4 h-4 text-emerald-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
              <span>
                Lịch sử hội thoại và kế hoạch đã lưu vẫn còn sau khi bạn đăng nhập lại.
              </span>
            </div>
            {/* Form đăng nhập nhanh không mất trang */}
            <form id="form-quick-relogin" onSubmit={(event) => actions.handleQuickRelogin(event)} className="v3-space-y-4">
              <div className="v3-space-y-1.5">
                <label className="block text-xs font-semibold text-[#111827]">
                  Tài khoản
                </label>
                <div className="px-3.5 py-2.5 rounded-xl bg-[#F8F8F6] border border-[#E7E7E2] text-xs text-[#4B5563] flex items-center justify-between">
                  <span className="font-medium">
                    lan.nguyen@congty.vn
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-white text-[#6B7280] border border-[#E7E7E2]">
                    Lan Nguyễn
                  </span>
                </div>
              </div>
              <div className="v3-space-y-1.5">
                <label htmlFor="quick-password" className="block text-xs font-semibold text-[#111827]">
                  Nhập lại mật khẩu
                </label>
                <div className="relative">
                  <input type={passwordVisible ? 'text' : 'password'} id="quick-password" required placeholder="Nhập mật khẩu của bạn" className="w-full px-3.5 py-2.5 rounded-xl text-xs bg-white border border-[#E7E7E2] focus:border-[#FF5701] focus:ring-2 focus:ring-[#FF5701]/20 v3-outline-none pr-10 transition-all" />
                  {' '}
                  <button type="button" onClick={() => actions.togglePasswordVisibility()} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6B7280] hover:text-[#111827]" aria-label="Hiện hoặc ẩn mật khẩu">
                    {' '}
                    <svg id="eye-quick" className={passwordVisible ? 'w-4 h-4 text-[#FF5701]' : 'w-4 h-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    {' '}
                  </button>
                </div>
              </div>
              <button type="submit" id="btn-submit-relogin" className="w-full py-2.5 rounded-xl bg-[#FF5701] hover:bg-[#e04d00] text-white text-xs font-semibold shadow-sm transition-colors flex items-center justify-center gap-1.5" disabled={reloginBusy}>
                {reloginBusy ? <>{spinner}<span>Đang khôi phục phiên…</span></> : <span>Mở khoá &amp; Tiếp tục công việc</span>}
              </button>
              <div className="relative flex items-center justify-center">
                <div className="border-t border-[#E7E7E2] w-full" />
                <span className="bg-white px-2 text-[11px] text-[#6B7280] relative">
                  hoặc
                </span>
              </div>
              <button type="button" onClick={() => actions.handleGoogleRelogin()} className="w-full py-2.5 rounded-xl bg-white hover:bg-neutral-50 text-[#111827] text-xs font-medium border border-[#E7E7E2] transition-colors flex items-center justify-center gap-2">
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335" />
                </svg>
                <span>
                  Tiếp tục với Google
                </span>
              </button>
            </form>
            <div className="text-center pt-2">
              <a href="/#login" className="text-xs text-[#6B7280] hover:text-[#111827] underline">
                Đăng nhập bằng tài khoản khác
              </a>
            </div>
          </div>
        </section>
        {/* ==================== TÌNH HUỐNG 3: MODEL TRẢ LỜI CHẬM ==================== */}
        <section id="view-timeout" className={`${view('timeout' as Scenario)}v3-space-y-6`}>
          <div className="bg-white rounded-2xl border border-[#E7E7E2] p-6 sm:p-8 shadow-soft max-w-2xl mx-auto v3-space-y-6">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-orange-50 text-[#FF5701] flex items-center justify-center flex-shrink-0 border border-orange-200">
                <svg className="w-6 h-6 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="v3-space-y-1.5 flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-orange-100 text-orange-800 uppercase tracking-wide">
                    Đang lập kế hoạch
                  </span>
                  <span className="text-xs font-mono text-[#FF5701] font-bold">
                    {"Thời gian chờ: "}
                    <span id="timer-seconds-display">
                      {seconds}
                    </span>
                    s
                  </span>
                </div>
                <h1 className="font-display font-bold text-xl sm:text-2xl text-[#111827]">
                  ATI đang suy nghĩ lâu hơn thường lệ
                </h1>
                <p className="text-sm text-[#4B5563] leading-relaxed">
                  Yêu cầu của bạn cần đối chiếu tài nguyên trên cả 4 dịch vụ (Trello, Slack, GitHub, Sheets). Do một số dịch vụ đối tác phản hồi chậm, quá trình tra cứu đang mất thêm thời gian.
                </p>
              </div>
            </div>
            {/* Trạng thái tra cứu từng dịch vụ */}
            <div className="p-4 bg-[#F8F8F6] rounded-xl border border-[#E7E7E2] v3-space-y-3">
              <p className="text-xs font-semibold text-[#111827]">
                Tiến trình tra cứu hiện tại:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div className="p-2.5 rounded-lg bg-white border border-[#E7E7E2] flex items-center justify-between">
                  <span>
                    Trello (Bảng To Do)
                  </span>
                  <span className="text-emerald-600 font-medium">
                    ✓ Đã thấy
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-white border border-[#E7E7E2] flex items-center justify-between">
                  <span>
                    Slack (Kênh #ati-test)
                  </span>
                  <span className="text-emerald-600 font-medium">
                    ✓ Đã thấy
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-orange-50 border border-orange-200 flex items-center justify-between">
                  <span className="font-medium text-orange-900">
                    GitHub (ati-test)
                  </span>
                  <span className="text-orange-700 flex items-center gap-1 font-medium">
                    <svg className="w-3 h-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    {" Đang chờ phản hồi…"}
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-white/70 border border-[#E7E7E2] flex items-center justify-between opacity-70">
                  <span className="text-[#6B7280]">
                    Google Sheets
                  </span>
                  <span className="text-[#6B7280]">
                    Chờ lượt
                  </span>
                </div>
              </div>
            </div>
            {/* Cam kết an toàn */}
            <div className="p-3 bg-neutral-100 rounded-xl text-xs text-[#6B7280] flex items-center gap-2">
              <svg className="w-4 h-4 text-emerald-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <span>
                <strong>
                  Chưa có gì được ghi lên công cụ nào.
                </strong>
                {" Hệ thống chỉ mới đang ở bước đọc thông tin để lên kế hoạch."}
              </span>
            </div>
            {/* Các lựa chọn hành động */}
            <div className="v3-space-y-2.5 pt-2">
              <div className="flex flex-col sm:flex-row items-center gap-3">
                <button type="button" onClick={() => actions.continueWaiting()} id="btn-continue-wait" className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-[#FF5701] hover:bg-[#e04d00] text-white text-xs font-semibold shadow-sm transition-colors flex items-center justify-center gap-1.5">
                  {waitBusy ? <>{spinner}<span>Đang giữ kết nối…</span></> : <span>Tiếp tục đợi thêm</span>}
                </button>
                <button type="button" onClick={() => actions.cancelSlowRequest()} className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-white hover:bg-neutral-50 text-[#111827] text-xs font-medium border border-[#E7E7E2] transition-colors">
                  {" Thôi chờ, giữ lại câu yêu cầu "}
                </button>
                <a href="/app-stage" className="w-full sm:w-auto px-3 py-2.5 text-center text-xs text-[#6B7280] hover:text-[#111827]">
                  {" Về sân khấu "}
                </a>
              </div>
              <p className="text-[11px] text-[#6B7280]">
                Nếu kế hoạch đến sau, nó vẫn nằm trong hội thoại và chưa chạy cho tới khi bạn duyệt.
              </p>
            </div>
          </div>
        </section>
        {/* ==================== TÌNH HUỐNG 4: LỖI MÁY CHỦ (500) ==================== */}
        <section id="view-server" className={`${view('server' as Scenario)}v3-space-y-6`}>
          <div className="bg-white rounded-2xl border border-red-200 p-6 sm:p-8 shadow-soft max-w-2xl mx-auto v3-space-y-6">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-red-50 text-red-600 flex items-center justify-center flex-shrink-0 border border-red-200">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div className="v3-space-y-1.5 flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-red-100 text-red-800 uppercase tracking-wide">
                    Sự cố máy chủ
                  </span>
                </div>
                <h1 className="font-display font-bold text-xl sm:text-2xl text-[#111827]">
                  Sự cố máy chủ
                </h1>
                <p className="text-sm text-[#4B5563] leading-relaxed">
                  Không thể lập kế hoạch lúc này. Hãy thử lại.
                </p>
              </div>
            </div>
            {/* Cam kết an toàn then chốt */}
            <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-200 v3-space-y-2">
              <div className="flex items-center gap-2 text-emerald-900 font-semibold text-xs">
                <svg className="w-4 h-4 text-emerald-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                <span>
                  Cam kết an toàn tuyệt đối
                </span>
              </div>
              <p className="text-xs text-emerald-800 leading-relaxed">
                <strong>
                  Chưa có gì được ghi lên công cụ nào.
                </strong>
                {" Toàn bộ dữ liệu trên Trello, Slack, GitHub và Google Sheets của bạn vẫn được giữ nguyên trạng, không bị thay đổi."}
              </p>
            </div>
            {/* Hộp câu yêu cầu đã gửi */}
            <div className="v3-space-y-1.5">
              <div className="flex items-center justify-between text-xs text-[#6B7280]">
                <span>
                  Câu yêu cầu của bạn:
                </span>
                <button type="button" onClick={() => actions.copyOriginalPrompt()} className="text-[#FF5701] hover:underline font-medium">
                  Sao chép câu này
                </button>
              </div>
              <div ref={promptRef} id="failed-prompt-text" className="p-3 bg-[#F8F8F6] rounded-xl border border-[#E7E7E2] text-xs font-mono text-[#111827]">
                Tạo card Trello cho lỗi đăng nhập Google, tạo issue GitHub, ghi vào Google Sheets và báo kênh Slack
              </div>
            </div>
            {/* Nút hành động */}
            <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
              <button type="button" onClick={() => actions.retryServerRequest()} id="btn-retry-server" className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-[#FF5701] hover:bg-[#e04d00] text-white text-xs font-semibold shadow-sm transition-colors flex items-center justify-center gap-1.5" disabled={retryBusy}>
                {retryBusy ? <>{spinner}<span>Đang thử lại…</span></> : <>{refreshIcon}<span>Thử lại</span></>}
              </button>
              <a href="/app-stage" className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-white hover:bg-neutral-50 text-[#111827] text-xs font-medium border border-[#E7E7E2] text-center transition-colors">
                {" Về không gian làm việc "}
              </a>
            </div>
          </div>
        </section>
        {/* ==================== TÌNH HUỐNG 5: TRANG 404 KHÔNG TÌM THẤY ==================== */}
        <section id="view-404" className={`${view('404' as Scenario)}v3-space-y-8`}>
          <div className="text-center v3-space-y-4 max-w-xl mx-auto pt-4 sm:pt-8">
            <div className="relative inline-block">
              {' '}
              <span className="font-display font-bold text-7xl sm:text-9xl text-neutral-200 select-none tracking-tight">
                404
              </span>
              {' '}
              <span className="absolute inset-0 flex items-center justify-center font-display font-bold text-2xl sm:text-3xl text-[#111827]">
                Không tìm thấy trang
              </span>
              {' '}
            </div>
            {' '}
            <p className="text-sm text-[#4B5563] leading-relaxed">
              Đường dẫn bạn vừa truy cập không tồn tại, đã được chuyển đến vị trí khác hoặc tài khoản của bạn chưa có quyền vào khu vực này.
            </p>
            <div className="flex items-center justify-center gap-3 pt-2">
              <a href="/app-stage" className="px-5 py-2.5 rounded-xl bg-[#FF5701] hover:bg-[#e04d00] text-white text-xs font-semibold shadow-sm transition-colors inline-flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
                <span>
                  Về không gian làm việc chính
                </span>
              </a>
              <button type="button" onClick={() => window.history.back()} className="px-4 py-2.5 rounded-xl bg-white hover:bg-neutral-50 text-[#4B5563] text-xs font-medium border border-[#E7E7E2]">
                {" ← Quay lại trang trước "}
              </button>
              <a href="/404" className="px-4 py-2.5 rounded-xl bg-white hover:bg-neutral-50 text-[#4B5563] text-xs font-medium border border-[#E7E7E2] transition-colors" title="Mở trang 404 độc lập">
                {" Mở trang 404 độc lập ↗ "}
              </a>
            </div>
          </div>
        </section>
      </main>
      {/* Chân trang đơn giản */}
      <footer className="mt-auto border-t border-[#E7E7E2] py-4 px-4 text-center text-xs text-[#6B7280]">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>
            ATI · 2026 — Hệ thống xử lý lỗi &amp; Khôi phục sự cố an toàn
          </span>
          <div className="flex items-center gap-3">
            <a href="/app-stage" className="hover:text-[#111827] transition-colors">
              Không gian làm việc
            </a>
            <span>
              ·
            </span>
            <a href="/privacy" className="text-[#FF5701] hover:underline font-medium transition-colors">
              Chính sách an toàn
            </a>
          </div>
        </div>
      </footer>
      {/* Toast thông báo */}
      <div id="toast-notification" className={toast?.visible ? 'fixed bottom-6 right-6 z-50 v3-transform transition-all duration-300 translate-y-0 opacity-100' : 'fixed bottom-6 right-6 z-50 v3-transform translate-y-24 opacity-0 transition-all duration-300 pointer-events-none'}>
        <div className={`bg-[#111827] text-white px-4 py-2.5 rounded-xl shadow-lg border ${toast ? TOAST_BORDER[toast.type] : 'border-neutral-700'} text-xs font-medium flex items-center gap-2`} id="toast-content">
          {toastContent}
        </div>
      </div>
    </>
  );
}
