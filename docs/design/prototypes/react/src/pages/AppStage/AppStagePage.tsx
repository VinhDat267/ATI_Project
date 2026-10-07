// Chuyển từ docs/design/prototypes/app-stage.html bằng scripts/html-to-jsx.mjs, sau đó sửa tay.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { usePrototypePage, type PageMeta } from '../../app/usePrototypePage';
import { currentTheme, subscribeTheme, toggleTheme as toggleSharedTheme } from '../../app/theme';
import css from './page.css?inline';

type DiscState = 'searching' | 'waiting' | 'found';
type PreviewType = 'trello' | 'github' | 'sheets' | 'slack';
type ToastType = 'info' | 'warning' | 'success';
type Toast = { id: number; message: string; type: ToastType; phase: 'enter' | 'shown' | 'leaving' };
type ExecMode = 'normal' | 'retry3' | 'skip3' | 'resumeFrom3' | 'confirmedSlack';
// Một ô do JS bản mẫu ghi riêng class và nội dung (className / textContent / innerHTML).
type Field = { cls: string; content: ReactNode };
// Dòng việc ở khoảnh khắc 5: bản mẫu không đặt lại khi vào lại khoảnh khắc 5, chỉ ghi đè từng trường,
// nên giữ từng trường như DOM của bản mẫu.
type ExecItem = { item: string; badge: Field; desc: Field; time: Field };
type ChatMessage = { id: number; sender: string; text: string };

const SAMPLE_QUERY = 'Tạo card Trello cho lỗi đăng nhập Google, tạo issue GitHub, ghi vào Google Sheets và báo kênh Slack';
const MOMENTS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// Thêm/bớt class như classList.add/remove, giữ thứ tự để class của khoảnh khắc giống bản mẫu khi đổi nhanh.
const classOps = (list: string[], remove: string[], add: string[]) => {
  const kept = list.filter(c => !remove.includes(c));
  return [...kept, ...add.filter(c => !kept.includes(c))];
};
const INITIAL_SECTIONS: Record<number, string[]> = Object.fromEntries(MOMENTS.map(n => [n, [n === 1 ? 'is-active' : 'is-hidden']]));

const ITEM_DONE = 'p-4 bg-white rounded-2xl border border-brand-border shadow-sm flex items-center justify-between gap-3';
const ITEM_RUNNING = 'p-4 bg-white rounded-2xl border-2 border-brand-primary shadow-orange-glow animate-pulse-soft flex items-center justify-between gap-3 opacity-100';
const ITEM_SKIPPED = 'p-4 bg-neutral-100 rounded-2xl border border-neutral-300 flex items-center justify-between gap-3 opacity-80';
const BADGE_DONE = 'text-xs text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded font-medium';
const BADGE_RUNNING = 'text-xs text-brand-primary bg-orange-50 px-1.5 py-0.5 rounded font-medium';
const BADGE_SKIPPED = 'text-xs text-neutral-600 bg-neutral-200 px-1.5 py-0.5 rounded font-medium';
const TIME_DONE = 'text-xs text-neutral-500 font-body';
const TIME_RUNNING = 'text-xs font-semibold text-brand-primary font-body';
const TIME_SKIPPED = 'text-xs text-neutral-400 font-body';
const DESC2_DONE = <>{'Đã tạo issue #42 · '}<a href="https://github.com/org/ati-test/issues/42" target="_blank" className="text-blue-600 hover:underline">Mở trên GitHub</a></>;
const DESC3_DONE = <>{'Đã thêm dòng 104 · '}<a href="https://docs.google.com/spreadsheets/d/sample" target="_blank" className="text-[#0F9D58] hover:underline">Xem dòng</a></>;
const INITIAL_EXEC: Record<2 | 3 | 4, ExecItem> = {
  2: {
    item: 'p-4 bg-white rounded-2xl border-2 border-brand-primary shadow-orange-glow animate-pulse-soft flex items-center justify-between gap-3',
    badge: { cls: 'text-xs text-brand-primary bg-orange-50 px-1.5 py-0.5 rounded font-medium flex-shrink-0', content: 'Đang làm' },
    desc: { cls: 'text-xs text-brand-primary font-normal mt-0.5 truncate', content: 'Đang gửi yêu cầu tạo issue và chèn link Trello...' },
    time: { cls: 'text-xs font-semibold text-brand-primary font-body flex-shrink-0', content: 'Đang chạy' },
  },
  3: {
    item: 'p-4 bg-neutral-50 rounded-2xl border border-dashed border-neutral-200 flex items-center justify-between gap-3 opacity-60',
    badge: { cls: 'text-xs text-neutral-500 bg-neutral-200 px-1.5 py-0.5 rounded font-medium flex-shrink-0', content: 'Chờ' },
    desc: { cls: 'text-xs text-neutral-500 mt-0.5 truncate', content: 'Đang chờ việc 2 hoàn thành' },
    time: { cls: 'text-xs text-neutral-400 font-body flex-shrink-0', content: 'Chờ' },
  },
  4: {
    item: 'p-4 bg-neutral-50 rounded-2xl border border-dashed border-neutral-200 flex items-center justify-between gap-3 opacity-60',
    badge: { cls: 'text-xs text-neutral-500 bg-neutral-200 px-1.5 py-0.5 rounded font-medium', content: 'Chờ' },
    desc: { cls: 'text-xs text-neutral-500 mt-0.5', content: 'Đang chờ việc 3 hoàn thành' },
    time: { cls: 'text-xs text-neutral-400 font-body', content: 'Chờ' },
  },
};
const RECEIPT_STATUS = 'text-[11px] font-semibold px-2.5 py-0.5 rounded-full flex-shrink-0 whitespace-nowrap';
const TOAST_BASE = 'pointer-events-auto px-4 py-2.5 rounded-xl text-xs sm:text-sm font-medium shadow-lg transition-all duration-300 v3-transform flex items-center gap-2 border';
const TOAST_COLOR: Record<ToastType, string> = {
  warning: 'bg-amber-50 text-amber-900 border-amber-200',
  success: 'bg-emerald-50 text-emerald-900 border-emerald-200',
  info: 'bg-neutral-900 text-white border-neutral-800',
};
// Lúc ẩn đi bản mẫu chỉ thêm opacity-0 -translate-y-2, không gỡ translate-y-0 opacity-100.
const TOAST_PHASE = { enter: '-translate-y-2 opacity-0', shown: 'translate-y-0 opacity-100', leaving: 'translate-y-0 opacity-100 opacity-0 -translate-y-2' };
const DISC_ROW: Record<DiscState, string> = {
  searching: 'flex items-center justify-between text-neutral-800 transition-all duration-300',
  waiting: 'flex items-center justify-between text-neutral-400 transition-all duration-300',
  found: 'flex items-center justify-between text-neutral-800 transition-all duration-300',
};
const DISC_DOT: Record<DiscState, string> = {
  searching: 'w-2 h-2 rounded-full bg-brand-primary animate-pulse',
  waiting: 'w-1.5 h-1.5 rounded-full bg-neutral-300',
  found: 'w-1.5 h-1.5 rounded-full bg-emerald-500',
};
const INITIAL_DISC: DiscState[] = ['searching', 'waiting', 'waiting', 'waiting', 'waiting'];
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

// Nhãn trạng thái của một dòng ở khoảnh khắc 2 (updateStepBadge).
function DiscBadge({ state }: { state: DiscState }) {
  if (state === 'found') {
    return <span className="disc-badge inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-50 text-emerald-600 flex-shrink-0" title="Đã thấy" aria-label="Đã thấy">
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
    </span>;
  }
  if (state === 'searching') {
    return <span className="disc-badge inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-50 text-amber-600 flex-shrink-0" title="Đang tìm…" aria-label="Đang tìm…">
      <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
      </svg>
    </span>;
  }
  return <span className="disc-badge inline-flex items-center justify-center w-6 h-6 rounded-full bg-neutral-100 text-neutral-400 flex-shrink-0" title="Chờ…" aria-label="Chờ…">
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  </span>;
}

// Nhãn, tiêu đề và nội dung hộp xem trước (openPreviewModal).
const PREVIEW: Record<PreviewType, { tag: string; tagText: string; title: string; content: ReactNode }> = {
  trello: {
    tag: 'px-2 py-0.5 rounded text-xs font-semibold bg-blue-100 text-blue-800', tagText: 'Trello Card', title: 'Nội dung card sẽ tạo',
    content: <div className="p-4 bg-neutral-50 rounded-xl border border-neutral-200 v3-space-y-3">
      <div>
        <span className="text-[11px] text-neutral-400 uppercase font-semibold">Tiêu đề card:</span>
        <div className="text-sm font-bold text-neutral-900 mt-0.5">Sửa lỗi đăng nhập Google</div>
      </div>
      <div>
        <span className="text-[11px] text-neutral-400 uppercase font-semibold">Vị trí:</span>
        <div className="text-xs text-neutral-700 mt-0.5">{"Bảng: "}<strong>To Do</strong>{" · Danh sách: "}<strong>Doing</strong></div>
      </div>
      <div>
        <span className="text-[11px] text-neutral-400 uppercase font-semibold">Mô tả ngắn:</span>
        <p className="text-xs text-neutral-700 bg-white p-2.5 rounded-lg border border-neutral-200 mt-1 leading-relaxed">
          Tạo card theo dõi và xử lý sự cố đăng nhập Google theo yêu cầu của người dùng.
        </p>
      </div>
    </div>,
  },
  github: {
    tag: 'px-2 py-0.5 rounded text-xs font-semibold bg-neutral-900 text-white', tagText: 'GitHub Issue', title: 'Nội dung issue sẽ tạo',
    content: <div className="p-4 bg-neutral-50 rounded-xl border border-neutral-200 v3-space-y-3">
      <div>
        <span className="text-[11px] text-neutral-400 uppercase font-semibold">Kho mã:</span>
        <div className="text-xs font-medium text-neutral-800 mt-0.5">ati-test</div>
      </div>
      <div>
        <span className="text-[11px] text-neutral-400 uppercase font-semibold">Tiêu đề:</span>
        <div className="text-sm font-bold text-neutral-900 mt-0.5">Sửa lỗi đăng nhập Google</div>
      </div>
      <div>
        <span className="text-[11px] text-neutral-400 uppercase font-semibold">Nội dung issue:</span>
        <div className="text-xs text-neutral-800 bg-white p-2.5 rounded-lg border border-neutral-200 mt-1 leading-relaxed v3-space-y-1.5">
          <div>Ghi nhận sự cố người dùng không thể đăng nhập bằng tài khoản Google.</div>
          <div>{"Liên kết card Trello: "}<span className="text-blue-600 underline">https://trello.com/c/sample-auth-fix</span></div>
        </div>
      </div>
    </div>,
  },
  sheets: {
    tag: 'px-2 py-0.5 rounded text-xs font-semibold bg-green-100 text-green-800', tagText: 'Google Sheets Row', title: 'Giá trị các cột sẽ thêm vào dòng mới',
    content: <div className="v3-space-y-3">
      <div className="text-xs text-neutral-600">{"Bảng tính: "}<strong>ATI Test Tracker</strong>{" > Trang: "}<strong>Tasks</strong></div>
      <div className="border border-neutral-200 rounded-xl overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-neutral-100 text-neutral-600 font-semibold border-b border-neutral-200">
            <tr><th className="p-2.5">Cột</th><th className="p-2.5">Giá trị sẽ ghi</th></tr>
          </thead>
          <tbody className="v3-divide-y divide-neutral-200 bg-white">
            <tr><td className="p-2.5 font-medium text-neutral-500">A · Ngày tạo</td><td className="p-2.5">05/10/2026</td></tr>
            <tr><td className="p-2.5 font-medium text-neutral-500">B · Tiêu đề</td><td className="p-2.5 font-semibold text-neutral-900">Sửa lỗi đăng nhập Google</td></tr>
            <tr><td className="p-2.5 font-medium text-neutral-500">C · Link Issue</td><td className="p-2.5 text-blue-600 truncate max-w-[200px]">https://github.com/org/ati-test/issues/42</td></tr>
            <tr><td className="p-2.5 font-medium text-neutral-500">D · Link Card</td><td className="p-2.5 text-blue-600 truncate max-w-[200px]">https://trello.com/c/sample-auth-fix</td></tr>
          </tbody>
        </table>
      </div>
    </div>,
  },
  slack: {
    tag: 'px-2 py-0.5 rounded text-xs font-semibold bg-purple-100 text-purple-800', tagText: 'Slack Message', title: 'Nguyên văn tin nhắn gửi vào kênh #ati-test',
    content: <div className="p-4 bg-neutral-50 rounded-xl border border-neutral-200 v3-space-y-2.5">
      <div className="flex items-center justify-between text-xs text-neutral-500">
        <span>{"Gửi tới: "}<strong>#ati-test</strong></span>
        <span>{"Người gửi: "}<strong>ATI Assistant (Bot)</strong></span>
      </div>
      <div className="bg-white p-3 rounded-lg border border-neutral-200 text-xs text-neutral-900 leading-relaxed font-sans v3-space-y-1.5">
        <div className="font-bold">Thông báo nhóm: Đã tạo việc sửa lỗi đăng nhập Google</div>
        <div>Tôi vừa hoàn tất tạo các liên kết hỗ trợ:</div>
        <div>{"• Card Trello: "}<span className="text-blue-600 underline">https://trello.com/c/sample-auth-fix</span></div>
        <div>{"• Issue GitHub: "}<span className="text-blue-600 underline">https://github.com/org/ati-test/issues/42</span></div>
      </div>
    </div>,
  },
};

export const meta: PageMeta = {
  id: "app-stage",
  title: "ATI - Sân khấu điều phối công việc",
  htmlClass: "",
  bodyClass: "min-h-screen flex flex-col justify-between selection:bg-[#FFE5D6] selection:text-[#FF5701] relative pb-24",
  css,
};

export function AppStagePage() {
  usePrototypePage(meta);
  // Biến của bản mẫu; giao diện đổi theo state bên dưới.
  const model = useRef({
    currentMoment: 1,
    chatCount: 4,
    executionMode: 'normal' as ExecMode,
    lastActive: null as Element | null,
    discoveryTimer: null as number | null,
    query: SAMPLE_QUERY,
    demoMenuOpen: false,
    userMenuOpen: false,
    trapCleanup: null as (() => void) | null,
  });
  const theme = useSyncExternalStore(subscribeTheme, currentTheme);
  const [sections, setSections] = useState(INITIAL_SECTIONS);
  // Khoảnh khắc vừa được kích hoạt (onMomentActivated): quyết định thanh trên, nút hội thoại, ô nhập đáy, bề rộng sân khấu.
  const [activated, setActivated] = useState(1);
  const [topBarQuery, setTopBarQuery] = useState(SAMPLE_QUERY);
  const [m2Query, setM2Query] = useState(SAMPLE_QUERY);
  const [disc, setDisc] = useState<DiscState[]>(INITIAL_DISC);
  const [customSheetOpen, setCustomSheetOpen] = useState(false);
  const [m4ChatOpen, setM4ChatOpen] = useState(false);
  const [techOpen, setTechOpen] = useState(false);
  const [stepCounter, setStepCounter] = useState('Việc 2/4');
  const [progress, setProgress] = useState('50%');
  const [exec, setExec] = useState(INITIAL_EXEC);
  const [receipt, setReceipt] = useState({ skip: false, confirmed: false });
  const [preview, setPreview] = useState<PreviewType | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [backdrop, setBackdrop] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatCount, setChatCount] = useState(4);
  const [demoMenuOpen, setDemoMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [role, setRoleView] = useState<'admin' | 'member'>('admin');
  const [serverMode, setServerModeView] = useState<'mock' | 'real'>('mock');
  const [testExplainOpen, setTestExplainOpen] = useState(false);
  const [pillTop, setPillTop] = useState<string | undefined>();
  const [announce, setAnnounce] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const customSheetRef = useRef<HTMLInputElement>(null);
  const m4ChatRef = useRef<HTMLInputElement>(null);
  const bottomInputRef = useRef<HTMLInputElement>(null);
  const drawerInputRef = useRef<HTMLInputElement>(null);
  const chatDrawerRef = useRef<HTMLElement>(null);
  const historyDrawerRef = useRef<HTMLElement>(null);
  const previewModalRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const userButtonRef = useRef<HTMLButtonElement>(null);
  const demoMenuRef = useRef<HTMLDivElement>(null);
  const demoButtonRef = useRef<HTMLButtonElement>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  const toastId = useRef(0);
  const messageId = useRef(0);
  const timers = useRef<number[]>([]);
  const later = (ms: number, run: () => void) => {
    const id = window.setTimeout(run, ms);
    timers.current.push(id);
    return id;
  };
  useEffect(() => () => { timers.current.forEach(window.clearTimeout); model.current.trapCleanup?.(); }, []);

  const showToast = (message: string, type: ToastType = 'info') => {
    const id = ++toastId.current;
    setToasts(items => [...items, { id, message, type, phase: 'enter' }]);
    requestAnimationFrame(() => setToasts(items => items.map(t => (t.id === id ? { ...t, phase: 'shown' } : t))));
    later(2600, () => {
      setToasts(items => items.map(t => (t.id === id ? { ...t, phase: 'leaving' } : t)));
      later(300, () => setToasts(items => items.filter(t => t.id !== id)));
    });
  };
  const patchExec = (n: 2 | 3 | 4, patch: Partial<ExecItem>) => setExec(all => ({ ...all, [n]: { ...all[n], ...patch } }));
  const doneItem2 = (withDesc: boolean) => patchExec(2, {
    item: ITEM_DONE,
    badge: { cls: BADGE_DONE, content: '✓ Đã tạo' },
    time: { cls: TIME_DONE, content: '1,4 giây' },
    ...(withDesc ? { desc: { cls: 'text-xs text-neutral-600 font-normal mt-0.5', content: DESC2_DONE } } : {}),
  });
  const runningItem = (n: 3 | 4, text: string) => setExec(all => ({ ...all, [n]: {
    item: ITEM_RUNNING,
    badge: { cls: BADGE_RUNNING, content: 'Đang làm' },
    desc: { ...all[n].desc, content: text },
    time: { cls: TIME_RUNNING, content: 'Đang chạy' },
  } }));
  const doneItem3 = () => setExec(all => ({ ...all, 3: {
    item: ITEM_DONE,
    badge: { cls: BADGE_DONE, content: '✓ Đã thêm' },
    desc: { ...all[3].desc, content: DESC3_DONE },
    time: { cls: TIME_DONE, content: '0,9 giây' },
  } }));

  // Bẫy focus trong ngăn kéo / hộp xem trước (setupFocusTrap).
  const setupFocusTrap = (container: HTMLElement | null) => {
    const m = model.current;
    m.trapCleanup?.();
    if (!container) return;
    const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    first.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      } else if (event.key === 'Escape') {
        actions.closeAllDrawers();
        actions.closePreviewModal();
      }
    };
    container.addEventListener('keydown', onKey);
    m.trapCleanup = () => container.removeEventListener('keydown', onKey);
  };
  const releaseTrapAndFocus = () => {
    const m = model.current;
    if (m.trapCleanup) { m.trapCleanup(); m.trapCleanup = null; }
    if (m.lastActive) { (m.lastActive as HTMLElement).focus?.(); m.lastActive = null; }
  };
  const appendChatMessage = (sender: string, text: string) => {
    const m = model.current;
    m.chatCount++;
    flushSync(() => {
      setMessages(list => [...list, { id: ++messageId.current, sender, text }]);
      setChatCount(m.chatCount);
    });
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  };
  const toggleDemoMenu = (force?: boolean) => {
    const m = model.current;
    const willOpen = typeof force === 'boolean' ? force : !m.demoMenuOpen;
    if (willOpen) toggleUserMenu(false);
    m.demoMenuOpen = willOpen;
    setDemoMenuOpen(willOpen);
  };
  const visibleUserMenuItems = () => [...(userMenuRef.current?.querySelectorAll<HTMLElement>('.user-menu-item') ?? [])]
    .filter(el => !el.classList.contains('hidden') && el.offsetParent !== null);
  const toggleUserMenu = (force?: boolean) => {
    const m = model.current;
    const open = typeof force === 'boolean' ? force : !m.userMenuOpen;
    if (open) {
      toggleDemoMenu(false);
      m.userMenuOpen = true;
      flushSync(() => setUserMenuOpen(true));
      visibleUserMenuItems()[0]?.focus();
    } else {
      m.userMenuOpen = false;
      setUserMenuOpen(false);
    }
  };

  const onMomentActivated = (num: number) => {
    flushSync(() => {
      setActivated(num);
      if (num === 4) setM4ChatOpen(false);
    });
    // Tiêu đề nhận focus bằng code (tabindex="-1").
    const heading = document.getElementById(`heading-moment-${num}`);
    heading?.focus();
    if (heading) setAnnounce(`Đã chuyển sang khoảnh khắc ${num}: ${heading.innerText}`);
    toggleDemoMenu(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (num === 2) startMoment2Discovery();
    else if (num === 5) startExecutionFlow();
    else if (num === 6) setReceipt({ skip: model.current.executionMode === 'skip3', confirmed: model.current.executionMode === 'confirmedSlack' });
  };
  const setMoment = (num: number) => {
    const m = model.current;
    if (num < 1 || num > 9) return;
    if (m.discoveryTimer !== null) {
      window.clearTimeout(m.discoveryTimer);
      m.discoveryTimer = null;
    }
    const oldMoment = m.currentMoment;
    m.currentMoment = num;
    // Giữ câu yêu cầu hiện tại trên thanh trên và ở khoảnh khắc 2.
    m.query = m.query.trim() || SAMPLE_QUERY;
    setTopBarQuery(m.query);
    setM2Query(m.query);
    if (oldMoment !== num && !reducedMotion()) {
      setSections(s => ({ ...s, [oldMoment]: classOps(s[oldMoment], ['is-active'], ['is-exiting']) }));
      later(190, () => {
        flushSync(() => setSections(s => ({
          ...s,
          [oldMoment]: classOps(s[oldMoment], ['is-exiting'], ['is-hidden']),
          [num]: classOps(s[num], ['is-hidden'], ['is-entering']),
        })));
        void document.getElementById(`moment-${num}`)?.offsetWidth;
        flushSync(() => setSections(s => ({ ...s, [num]: classOps(s[num], ['is-entering'], ['is-active']) })));
        onMomentActivated(num);
      });
      return;
    }
    flushSync(() => setSections(s => Object.fromEntries(MOMENTS.map(i => [i, i === num
      ? classOps(s[i], ['is-hidden', 'is-exiting', 'is-entering'], ['is-active'])
      : classOps(s[i], ['is-active', 'is-exiting', 'is-entering'], ['is-hidden'])]))));
    onMomentActivated(num);
  };
  // Khoảnh khắc 2: 5 dòng lần lượt "đang tìm" → "đã thấy" rồi tự sang khoảnh khắc 4.
  const startMoment2Discovery = () => {
    const m = model.current;
    setDisc(INITIAL_DISC);
    if (reducedMotion()) {
      setDisc(['found', 'found', 'found', 'found', 'found']);
      m.discoveryTimer = later(600, () => { if (m.currentMoment === 2) setMoment(4); });
      return;
    }
    const step = (index: number) => {
      m.discoveryTimer = later(600, () => {
        if (m.currentMoment !== 2) return;
        setDisc(list => list.map((s, i) => (i === index ? 'found' : i === index + 1 ? 'searching' : s)));
        if (index < 4) step(index + 1);
        else m.discoveryTimer = later(500, () => { if (m.currentMoment === 2) setMoment(4); });
      });
    };
    step(0);
  };
  // Khoảnh khắc 5: chạy các việc theo chế độ (bình thường, thử lại việc 3, bỏ qua việc 3, làm tiếp từ việc 3).
  const startExecutionFlow = () => {
    const m = model.current;
    const finish = () => later(350, () => setMoment(6));
    if (m.executionMode === 'retry3' || m.executionMode === 'resumeFrom3') {
      setStepCounter('Việc 3/4');
      setProgress('65%');
      doneItem2(true);
      runningItem(3, 'Đang ghi nhận dòng 104 vào bảng tính ATI Test Tracker...');
      later(1300, () => {
        if (m.currentMoment !== 5) return;
        setStepCounter('Việc 4/4');
        setProgress('90%');
        doneItem3();
        runningItem(4, 'Đang gửi tin nhắn thông báo vào kênh #ati-test...');
        later(1100, () => {
          if (m.currentMoment !== 5) return;
          setProgress('100%');
          finish();
        });
      });
    } else if (m.executionMode === 'skip3') {
      setStepCounter('Việc 4/4');
      setProgress('75%');
      doneItem2(false);
      setExec(all => ({ ...all, 3: {
        item: ITEM_SKIPPED,
        badge: { cls: BADGE_SKIPPED, content: 'Đã bỏ qua' },
        desc: { ...all[3].desc, content: 'Đã bỏ qua bước ghi bảng tính theo yêu cầu của bạn.' },
        time: { cls: TIME_SKIPPED, content: 'Bỏ qua' },
      } }));
      runningItem(4, 'Đang gửi tin nhắn thông báo vào kênh #ati-test...');
      later(1300, () => {
        if (m.currentMoment !== 5) return;
        setProgress('100%');
        finish();
      });
    } else {
      setStepCounter('Việc 2/4');
      setProgress('35%');
      later(1300, () => {
        if (m.currentMoment !== 5) return;
        setStepCounter('Việc 3/4');
        setProgress('70%');
        doneItem2(true);
        runningItem(3, 'Đang chèn ngày, link card và issue vào trang Tasks...');
      });
      later(2500, () => {
        if (m.currentMoment !== 5) return;
        setStepCounter('Việc 4/4');
        setProgress('90%');
        doneItem3();
        runningItem(4, 'Đang gửi tin nhắn thông báo vào kênh #ati-test...');
      });
      later(3600, () => {
        if (m.currentMoment !== 5) return;
        setProgress('100%');
        finish();
      });
    }
  };
  const setExecutionModeAndMoment = (mode: ExecMode, toast: [string, ToastType] | null, moment: number) => {
    model.current.executionMode = mode;
    if (toast) showToast(...toast);
    setMoment(moment);
  };
  const toggleChatDrawer = (open: boolean) => {
    if (open) {
      model.current.lastActive = document.activeElement;
      setChatOpen(true);
      setBackdrop(true);
      setupFocusTrap(chatDrawerRef.current);
      later(250, () => drawerInputRef.current?.focus());
    } else {
      setChatOpen(false);
      setBackdrop(false);
      releaseTrapAndFocus();
    }
  };
  const toggleHistoryDrawer = (open: boolean) => {
    if (open) {
      model.current.lastActive = document.activeElement;
      setHistoryOpen(true);
      setBackdrop(true);
      setupFocusTrap(historyDrawerRef.current);
    } else {
      setHistoryOpen(false);
      setBackdrop(false);
      releaseTrapAndFocus();
    }
  };
  const actions = {
    setMoment,
    toggleHistoryDrawer,
    toggleChatDrawer,
    toggleUserMenu,
    toggleDemoMenu,
    toggleTheme() {
      const next = toggleSharedTheme();
      setAnnounce(`Đã chuyển sang giao diện ${next === 'dark' ? 'tối' : 'sáng'}`);
    },
    toggleTestModeExplanation() { setTestExplainOpen(open => !open); },
    submitPrompt() {
      const input = promptRef.current;
      const text = input ? input.value.trim() : '';
      if (!text) {
        showToast('Hãy mô tả việc bạn cần nhờ', 'warning');
        input?.focus();
        return;
      }
      model.current.query = text;
      setMoment(2);
    },
    useSuggestion(text: string) {
      model.current.query = text;
      if (promptRef.current) promptRef.current.value = text;
      setMoment(2);
    },
    toggleCustomSheetInput(open: boolean) {
      flushSync(() => setCustomSheetOpen(open));
      if (open) customSheetRef.current?.focus();
    },
    submitCustomSheet() {
      const input = customSheetRef.current;
      const val = input ? input.value.trim() : '';
      if (!val) {
        showToast('Vui lòng nhập tên hoặc đường dẫn bảng tính', 'warning');
        input?.focus();
        return;
      }
      actions.chooseSheetOption(val);
    },
    chooseSheetOption(name: string) {
      showToast('Đã chọn bảng tính: ' + name, 'success');
      setMoment(4);
    },
    toggleMoment4ChatEdit(open: boolean) {
      flushSync(() => setM4ChatOpen(open));
      if (open && m4ChatRef.current) {
        m4ChatRef.current.focus();
        m4ChatRef.current.value = '';
      }
    },
    submitMoment4InlineChat() {
      const input = m4ChatRef.current;
      const text = input ? input.value.trim() : '';
      if (!input || !text) return;
      input.value = '';
      actions.toggleMoment4ChatEdit(false);
      appendChatMessage('Bạn', text);
      showToast('Đã gửi yêu cầu chỉnh sửa: "' + text + '"', 'success');
    },
    toggleTechnicalDetails() { setTechOpen(open => !open); },
    approvePlanAndStartExecution() { setExecutionModeAndMoment('normal', null, 5); },
    handleMoment6Followup(text: string) {
      const input = promptRef.current;
      if (input) input.value = text;
      setMoment(1);
      later(250, () => {
        if (input) {
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        }
      });
    },
    resetToMoment1() {
      if (promptRef.current) promptRef.current.value = '';
      setMoment(1);
    },
    retryTask3() { setExecutionModeAndMoment('retry3', ['Đang thử lại việc 3 với Google Sheets...', 'info'], 5); },
    skipTask3() { setExecutionModeAndMoment('skip3', ['Đã bỏ qua việc 3, tiếp tục việc 4 (Slack)...', 'info'], 5); },
    confirmSlackMessageExists() { setExecutionModeAndMoment('confirmedSlack', ['Đã ghi nhận tin đã có', 'success'], 6); },
    resumeRemainingTasks() { setExecutionModeAndMoment('resumeFrom3', ['Tiếp tục việc 3 (Google Sheets) và việc 4 (Slack)...', 'info'], 5); },
    handleBottomInputKey(event: ReactKeyboardEvent) { if (event.key === 'Enter') actions.submitBottomInput(); },
    submitBottomInput() {
      const input = bottomInputRef.current;
      if (!input || !input.value.trim()) return;
      const text = input.value.trim();
      input.value = '';
      appendChatMessage('Bạn', text);
      showToast('Đã gửi tin nhắn: "' + text + '"', 'success');
    },
    sendDrawerMessage() {
      const input = drawerInputRef.current;
      if (!input || !input.value.trim()) return;
      const text = input.value.trim();
      input.value = '';
      appendChatMessage('Bạn', text);
      showToast('Đã thêm tin vào hội thoại', 'info');
    },
    loadHistoricalRequest(query: string) {
      if (promptRef.current) promptRef.current.value = query;
      model.current.query = query;
      toggleHistoryDrawer(false);
      showToast('Đã tải lại yêu cầu: ' + query, 'info');
      setMoment(2);
    },
    openPreviewModal(type: PreviewType) {
      model.current.lastActive = document.activeElement;
      flushSync(() => {
        setPreview(type);
        setPreviewOpen(true);
      });
      setupFocusTrap(previewModalRef.current);
    },
    closePreviewModal() {
      setPreviewOpen(false);
      releaseTrapAndFocus();
    },
    handlePreviewBackdropClick(event: ReactMouseEvent) {
      if ((event.target as HTMLElement).id === 'preview-modal') actions.closePreviewModal();
    },
    closeAllDrawers() {
      toggleChatDrawer(false);
      toggleHistoryDrawer(false);
    },
    setRole(next: 'admin' | 'member') { setRoleView(next); },
    setServerMode(next: 'mock' | 'real') { setServerModeView(next); },
    handleUserMenuKeydown(event: ReactKeyboardEvent) {
      if (!model.current.userMenuOpen) return;
      const items = visibleUserMenuItems();
      if (!items.length) return;
      const idx = items.indexOf(document.activeElement as HTMLElement);
      if (event.key === 'ArrowDown') { event.preventDefault(); items[(idx + 1) % items.length].focus(); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); items[(idx - 1 + items.length) % items.length].focus(); }
      else if (event.key === 'Home') { event.preventDefault(); items[0].focus(); }
      else if (event.key === 'End') { event.preventDefault(); items[items.length - 1].focus(); }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); toggleUserMenu(false); userButtonRef.current?.focus(); }
      else if (event.key === 'Tab') toggleUserMenu(false);
    },
  };

  // Viên "Kịch bản demo" nằm ngay dưới thanh trên và dải thử nghiệm (updateDemoPillPosition).
  const updateDemoPillPosition = () => {
    const banner = bannerRef.current;
    setPillTop(`${banner && !banner.classList.contains('hidden') ? 56 + (banner.offsetHeight || 32) : 56}px`);
  };
  useLayoutEffect(updateDemoPillPosition, [serverMode, testExplainOpen]);
  // Phím tắt 1–9 và Esc; bấm ngoài thì đóng menu người dùng và menu demo; đổi cỡ cửa sổ thì đặt lại viên demo.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (['INPUT', 'TEXTAREA'].includes(target.tagName)) {
        if (event.key === 'Escape') target.blur();
        return;
      }
      if (event.key >= '1' && event.key <= '9') {
        setMoment(Number(event.key));
      } else if (event.key === 'Escape') {
        const wasOpen = model.current.userMenuOpen;
        actions.closeAllDrawers();
        actions.closePreviewModal();
        toggleDemoMenu(false);
        toggleUserMenu(false);
        if (wasOpen) userButtonRef.current?.focus();
      }
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target as Node;
      const m = model.current;
      if (m.userMenuOpen && !userMenuRef.current?.contains(target) && !userButtonRef.current?.contains(target)) toggleUserMenu(false);
      if (m.demoMenuOpen && !demoMenuRef.current?.contains(target) && !demoButtonRef.current?.contains(target)) toggleDemoMenu(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    window.addEventListener('resize', updateDemoPillPosition);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
      window.removeEventListener('resize', updateDemoPillPosition);
    };
  });
  // Mở trang: onMomentActivated(1) của bản mẫu. State ban đầu đã đúng với khoảnh khắc 1, nên chỉ còn focus tiêu đề,
  // thông báo cho trình đọc màn hình và cuộn lên đầu (không gọi flushSync trong effect).
  useLayoutEffect(() => {
    const heading = document.getElementById('heading-moment-1');
    heading?.focus();
    if (heading) setAnnounce(`Đã chuyển sang khoảnh khắc 1: ${heading.innerText}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const dark = theme === 'dark';
  const isAdmin = role === 'admin';
  const isMock = serverMode === 'mock';
  const sectionClass = (n: number, base: string) => `stage-section ${sections[n].join(' ')} ${base}`;
  const execItem = (n: 2 | 3 | 4) => exec[n];
  return (
    <>
      {/* A11y Live Announcer Region */}
      <div id="a11y-announcer" className="sr-only" aria-live="polite" aria-atomic="true">{announce}</div>
      {/* Toast Notification Container (NHÓM 3: Thay alert/confirm/prompt) */}
      <div id="toast-container" className="fixed top-5 left-1/2 -translate-x-1/2 z-50 pointer-events-none flex flex-col items-center gap-2" role="status" aria-live="polite">
        {toasts.map(toast => <div key={toast.id} className={`${TOAST_BASE} ${TOAST_PHASE[toast.phase]} ${TOAST_COLOR[toast.type]}`}>{toast.message}</div>)}
      </div>
      {/* TOP SLIM PERSISTENT BAR (NHÓM 6: Khoảnh khắc 1 chỉ có logo & Lịch sử) */}
      <header className="sticky top-0 z-30 w-full bg-[#F8F8F6]/90 backdrop-blur-md border-b border-brand-border transition-all">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3 px-4 sm:px-6 py-2.5">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <a href="#" onClick={(event) => { event.preventDefault(); actions.setMoment(1); }} className="flex items-center gap-2 group flex-shrink-0" title="Về đầu">
              <div className="w-8 h-8 rounded-lg bg-brand-primary flex items-center justify-center text-white font-display font-bold text-lg shadow-sm group-hover:scale-105 transition-transform">
                A
              </div>
              <span className="font-display font-bold text-lg tracking-tight text-brand-text hidden sm:inline">
                ATI
              </span>
            </a>
            {/* Yêu cầu hiện tại (Ẩn ở khoảnh khắc 1) */}
            <div id="top-bar-query-container" className={`${activated === 1 ? 'hidden ' : ''}items-center gap-3 min-w-0 flex-1`}>
              <div className="h-4 w-px bg-brand-border flex-shrink-0" />
              <div className="flex items-center gap-2 text-xs sm:text-sm text-brand-muted truncate max-w-xl">
                <span className="px-1.5 py-0.5 rounded bg-[#EBECE7] text-brand-text font-medium text-[11px] flex-shrink-0">
                  Yêu cầu hiện tại
                </span>
                <span id="top-bar-query" className="text-brand-text truncate font-normal">
                  {topBarQuery}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button id="btn-open-history" onClick={() => actions.toggleHistoryDrawer(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-brand-text bg-white hover:bg-neutral-100 rounded-lg border border-brand-border shadow-sm transition-colors" aria-expanded={historyOpen ? 'true' : 'false'} aria-controls="history-drawer">
              <svg className="w-3.5 h-3.5 text-brand-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="hidden sm:inline">
                Lịch sử
              </span>
            </button>
            {/* Nút Xem hội thoại (Ẩn ở khoảnh khắc 1, NHÓM 5 thay py-0.2 -> py-[2px]) */}
            <button id="btn-open-chat" onClick={() => actions.toggleChatDrawer(true)} className={`${activated === 1 ? 'hidden! ' : ''}inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-brand-text hover:bg-black rounded-lg shadow-sm transition-all`} aria-expanded={chatOpen ? 'true' : 'false'} aria-controls="chat-drawer">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <span className="hidden sm:inline">
                Xem hội thoại
              </span>
              <span id="chat-count-badge" className="px-1.5 py-[2px] bg-white/20 rounded-full text-[10px] font-bold">
                {chatCount}
              </span>
            </button>
            {/* Nút Theme Toggle Sáng / Tối */}
            <button id="btn-theme-toggle" type="button" onClick={() => actions.toggleTheme()} className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-brand-text bg-white hover:bg-neutral-100 border border-brand-border shadow-sm transition-colors focus:v3-outline-none" aria-label={dark ? 'Chuyển sang giao diện Sáng' : 'Chuyển sang giao diện Tối'} title={dark ? 'Chuyển sang giao diện Sáng' : 'Chuyển sang giao diện Tối'}>
              {/* Icon Mặt trăng (hiển thị khi đang ở theme Sáng) */}
              <svg id="theme-icon-moon" className="w-4 h-4 text-brand-muted block dark:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
              {/* Icon Mặt trời (hiển thị khi đang ở theme Tối) */}
              <svg id="theme-icon-sun" className="w-4 h-4 text-amber-400 hidden dark:block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            </button>
            <div className="relative inline-block text-left">
              {' '}
              <button ref={userButtonRef} id="btn-user-menu" type="button" onClick={() => actions.toggleUserMenu()} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); actions.toggleUserMenu(true); } }} className="user-avatar-btn shadow-sm" aria-haspopup="menu" aria-expanded={userMenuOpen ? 'true' : 'false'} aria-label="Tài khoản của Lan Nguyễn">
                LN
              </button>
              {' '}
              <div ref={userMenuRef} onKeyDown={actions.handleUserMenuKeydown} id="user-menu" className={`${userMenuOpen ? '' : 'hidden '}absolute right-0 top-full mt-2 w-60 sm:w-64 max-w-[calc(100vw-24px)] bg-white rounded-2xl border border-brand-border shadow-2xl py-1.5 z-50 focus:v3-outline-none`} role="menu" aria-orientation="vertical" aria-labelledby="btn-user-menu" tabIndex={-1}>
                <div className="px-4 py-3 border-b border-brand-border-subtle select-none">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm text-brand-text truncate">
                      Lan Nguyễn
                    </span>
                    <span id="user-menu-role-badge" className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-neutral-100 text-brand-text border border-brand-border flex-shrink-0">
                      {isAdmin ? 'Quản trị viên' : 'Thành viên'}
                    </span>
                  </div>
                  <div className="text-xs text-brand-muted truncate mt-0.5">
                    lan.nguyen@congty.vn
                  </div>
                </div>
                <div className="py-1">
                  <a href="/history" role="menuitem" className="user-menu-item">
                    {' '}
                    <svg className="w-4 h-4 text-brand-muted flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {' '}
                    <span>
                      Nhật ký điều phối
                    </span>
                    {' '}
                  </a>
                  {' '}
                  <a href="/settings" role="menuitem" className="user-menu-item">
                    {' '}
                    <svg className="w-4 h-4 text-brand-muted flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                    </svg>
                    {' '}
                    <span>
                      Kết nối dịch vụ
                    </span>
                    {' '}
                  </a>
                  {' '}
                  <a href="/guide" role="menuitem" className="user-menu-item">
                    {' '}
                    <svg className="w-4 h-4 text-brand-muted flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                    {' '}
                    <span>
                      Cẩm nang &amp; Mẫu câu lệnh
                    </span>
                    {' '}
                  </a>
                  {' '}
                  <a href="/account" role="menuitem" className="user-menu-item">
                    {' '}
                    <svg className="w-4 h-4 text-brand-muted flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    {' '}
                    <span>
                      Tài khoản
                    </span>
                    {' '}
                  </a>
                  {' '}
                  <a href="/users" id="user-menu-item-manage-users" role="menuitem" className={`user-menu-item${isAdmin ? '' : ' hidden'}`}>
                    {' '}
                    <svg className="w-4 h-4 text-brand-muted flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                    {' '}
                    <span>
                      Quản lý người dùng
                    </span>
                    {' '}
                  </a>
                  {' '}
                  <a href="/privacy" role="menuitem" className="user-menu-item">
                    {' '}
                    <svg className="w-4 h-4 text-brand-muted flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    {' '}
                    <span>
                      Chính sách an toàn &amp; Dữ liệu
                    </span>
                    {' '}
                  </a>
                  {' '}
                  <button type="button" onClick={() => actions.toggleTheme()} role="menuitem" className="user-menu-item">
                    {' '}
                    <svg id="menu-theme-icon-moon" className="w-4 h-4 text-brand-muted flex-shrink-0 block dark:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                    </svg>
                    <svg id="menu-theme-icon-sun" className="w-4 h-4 text-amber-400 flex-shrink-0 hidden dark:block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                    {' '}
                    <span id="user-menu-theme-label">
                      {dark ? 'Giao diện sáng' : 'Giao diện tối'}
                    </span>
                    {' '}
                  </button>
                </div>
                <div className="border-t border-brand-border-subtle my-1" />
                <div className="py-1">
                  <a href="/" role="menuitem" className="user-menu-item !text-red-600 hover:!bg-red-50 hover:!text-red-700">
                    {' '}
                    <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    {' '}
                    <span>
                      Đăng xuất
                    </span>
                    {' '}
                  </a>
                </div>
              </div>
              {' '}
            </div>
          </div>
        </div>
        {/* DẢI CHẾ ĐỘ THỬ NGHIỆM */}
        <div ref={bannerRef} id="test-mode-banner" role="status" className={`${isMock ? '' : 'hidden '}w-full bg-[#FEF9C3] border-t border-amber-200/80 text-amber-900 transition-all`}>
          <div className="max-w-5xl mx-auto px-4 sm:px-6 flex items-center justify-between gap-2 h-8 text-[11px] sm:text-xs">
            <div className="flex items-center gap-1.5 min-w-0">
              <svg className="w-3.5 h-3.5 text-amber-700 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="font-medium sm:hidden">
                Thử nghiệm · không gọi dịch vụ thật
              </span>
              <span className="font-medium hidden sm:inline">
                Chế độ thử nghiệm: kế hoạch mẫu, không gọi dịch vụ thật
              </span>
            </div>
            <button id="btn-toggle-test-mode-explain" type="button" onClick={() => actions.toggleTestModeExplanation()} className="flex-shrink-0 text-amber-800 hover:text-amber-950 underline underline-offset-2 font-medium focus:v3-outline-none focus:ring-1 focus:ring-amber-500 rounded px-1 py-0.5" aria-expanded={testExplainOpen ? 'true' : 'false'} aria-controls="test-mode-explanation">
              {" Là gì? "}
            </button>
          </div>
          <div id="test-mode-explanation" className={`${testExplainOpen ? '' : 'hidden '}px-4 sm:px-6 pb-2 text-[11px] sm:text-xs text-amber-800 leading-relaxed border-t border-amber-200/60 pt-1.5 max-w-5xl mx-auto`}>
            Máy chủ đang chạy thử: ATI dùng kế hoạch soạn sẵn và không ghi gì lên Trello, Slack hay các công cụ khác. Chế độ do máy chủ quyết định khi khởi động.
          </div>
        </div>
      </header>
      {/* MAIN STAGE (SÂN KHẤU TRÌNH DIỄN CHÍNH) */}
      <main id="stage-container" className={`flex-1 w-full ${activated === 6 ? 'max-w-[1120px]' : 'max-w-4xl'} mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col justify-center`}>
        {/* ==================== KHOẢNH KHẮC 1: NHỜ VIỆC ==================== */}
        <section id="moment-1" className={sectionClass(1, 'v3-space-y-8')} aria-labelledby="heading-moment-1">
          <div className="v3-space-y-3 text-center sm:text-left">
            <h1 id="heading-moment-1" className="font-display text-4xl sm:text-5xl lg:text-[52px] text-brand-text font-normal tracking-tight leading-[1.12]" tabIndex={-1}>
              Hôm nay bạn muốn nhờ việc gì?
            </h1>
            <p className="text-base sm:text-lg text-brand-muted max-w-2xl leading-relaxed">
              Mô tả bằng lời thường điều bạn cần. Tôi sẽ tự chia việc, lên kế hoạch và thao tác trên các công cụ của nhóm.
            </p>
          </div>
          {/* Large Input Area */}
          <div className="relative bg-white rounded-2xl border border-brand-border shadow-soft-card p-3 sm:p-4 focus-within:border-brand-primary focus-within:shadow-orange-glow transition-all">
            <label htmlFor="prompt-input" className="sr-only">
              Nội dung bạn muốn nhờ
            </label>
            {' '}
            <textarea ref={promptRef} id="prompt-input" rows={3} className="w-full text-base sm:text-lg text-brand-text placeholder-neutral-400 bg-transparent resize-none border-0 focus:ring-0 focus:v3-outline-none p-1" placeholder="Ví dụ: Tạo card Trello cho lỗi đăng nhập Google, tạo issue GitHub, ghi vào Google Sheets và báo kênh Slack..." />
            {' '}
            <div className="flex items-center justify-between pt-2 border-t border-brand-border-subtle mt-1">
              <span className="text-xs text-brand-muted inline-flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 bg-neutral-100 border border-neutral-300 rounded text-[10px] font-mono">
                  Enter
                </kbd>
                {" để gửi"}
              </span>
              <button onClick={() => actions.submitPrompt()} className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-primary hover:bg-brand-primary-hover text-white text-sm font-semibold rounded-xl shadow-sm transition-all hover:scale-[1.01] active:scale-[0.99]">
                <span>
                  Gửi yêu cầu
                </span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </button>
            </div>
          </div>
          {/* NHÓM 8: Thẻ gợi ý dùng biểu tượng SVG, shape trang trí mờ ở góc, hover nâng nhẹ & chỉ dùng dịch vụ đã kết nối */}
          <div className="v3-space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-brand-muted">
              Gợi ý việc phổ biến theo công cụ của bạn
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Gợi ý 1: Trello + Slack */}
              <button onClick={() => actions.useSuggestion('Tạo card Trello cho lỗi đăng nhập rồi báo nhóm trên Slack')} className="relative overflow-hidden text-left p-4 bg-white hover:bg-neutral-50 rounded-2xl border border-brand-border shadow-soft-card transition-all duration-200 group hover:-translate-y-0.5 hover:shadow-md flex items-start gap-3.5">
                <div className="absolute -right-6 -bottom-6 w-20 h-20 rounded-full bg-blue-500/5 group-hover:bg-blue-500/10 transition-colors pointer-events-none" />
                <div className="flex items-center -v3-space-x-1.5 flex-shrink-0 mt-0.5">
                  <div className="w-8 h-8 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center p-1.5 shadow-sm group-hover:scale-105 transition-transform" title="Trello">
                    <svg className="w-4 h-4 text-[#0079BF]" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M19.5 2h-15A2.5 2.5 0 002 4.5v15A2.5 2.5 0 004.5 22h15a2.5 2.5 0 002.5-2.5v-15A2.5 2.5 0 0019.5 2zm-8.25 14a1.25 1.25 0 01-1.25 1.25H6.25A1.25 1.25 0 015 16V6.25A1.25 1.25 0 016.25 5h3.75A1.25 1.25 0 0111.25 6.25V16zm7.75-5a1.25 1.25 0 01-1.25 1.25h-3.75A1.25 1.25 0 0112.75 11V6.25a1.25 1.25 0 011.25-1.25h3.75a1.25 1.25 0 011.25 1.25V11z" />
                    </svg>
                  </div>
                  <div className="w-8 h-8 rounded-xl bg-purple-50 border border-purple-100 flex items-center justify-center p-1.5 shadow-sm group-hover:scale-105 transition-transform" title="Slack">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#E01E5A" />
                      <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#36C5F0" />
                      <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="#2EB67D" />
                      <path d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.527 2.527 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="#ECB22E" />
                    </svg>
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-brand-text group-hover:text-brand-primary transition-colors leading-snug">
                    Tạo card Trello cho lỗi đăng nhập rồi báo nhóm trên Slack
                  </div>
                  <div className="text-xs text-brand-muted mt-1 flex items-center gap-1.5 font-sans">
                    <span className="text-blue-600 font-medium">
                      Trello
                    </span>
                    <span>
                      →
                    </span>
                    <span className="text-purple-600 font-medium">
                      Slack
                    </span>
                  </div>
                </div>
              </button>
              {/* Gợi ý 2: Google Sheets */}
              <button onClick={() => actions.useSuggestion('Ghi tiến độ tuần này vào Google Sheets')} className="relative overflow-hidden text-left p-4 bg-white hover:bg-neutral-50 rounded-2xl border border-brand-border shadow-soft-card transition-all duration-200 group hover:-translate-y-0.5 hover:shadow-md flex items-start gap-3.5">
                <div className="absolute -right-6 -bottom-6 w-20 h-20 rounded-full bg-emerald-500/5 group-hover:bg-emerald-500/10 transition-colors pointer-events-none" />
                <div className="flex items-center flex-shrink-0 mt-0.5">
                  <div className="w-8 h-8 rounded-xl bg-green-50 border border-green-100 flex items-center justify-center p-1.5 shadow-sm group-hover:scale-105 transition-transform" title="Google Sheets">
                    <svg className="w-4 h-4 text-[#0F9D58]" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-6 14H6v-3h7v3zm0-4.5H6V9.5h7v3zm0-4.5H6V5h7v3.5zm5 9h-4v-3h4v3zm0-4.5h-4V9.5h4v3zm0-4.5h-4V5h4v3.5z" />
                    </svg>
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-brand-text group-hover:text-brand-primary transition-colors leading-snug">
                    Ghi tiến độ tuần này vào Google Sheets
                  </div>
                  <div className="text-xs text-brand-muted mt-1 flex items-center gap-1.5 font-sans">
                    <span className="text-emerald-600 font-medium">
                      Google Sheets
                    </span>
                  </div>
                </div>
              </button>
              {/* Gợi ý 3 (Đã đổi theo NHÓM 8): Notion + Slack */}
              <button onClick={() => actions.useSuggestion('Tạo trang Notion ghi biên bản họp và báo nhóm trên Slack')} className="relative overflow-hidden text-left p-4 bg-white hover:bg-neutral-50 rounded-2xl border border-brand-border shadow-soft-card transition-all duration-200 group hover:-translate-y-0.5 hover:shadow-md flex items-start gap-3.5">
                <div className="absolute -right-6 -bottom-6 w-20 h-20 rounded-full bg-neutral-900/5 group-hover:bg-neutral-900/10 transition-colors pointer-events-none" />
                <div className="flex items-center -v3-space-x-1.5 flex-shrink-0 mt-0.5">
                  <div className="w-8 h-8 rounded-xl bg-neutral-100 border border-neutral-200 flex items-center justify-center p-1.5 shadow-sm group-hover:scale-105 transition-transform" title="Notion">
                    <svg className="w-4 h-4 text-neutral-900" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l11.834-.699c.373 0 .466-.186.373-.466L18.17 2.25c-.28-.373-.746-.56-1.306-.56L3.9 2.53c-.56 0-.84.28-.653.653l1.212 1.025zm.84 3.73v12.493c0 .84.466 1.212 1.306 1.12l13.14-.746c.84-.093 1.026-.653 1.026-1.4V6.912c0-.56-.28-.84-.746-.746L5.865 6.912c-.466.093-.566.466-.566 1.026zm11.275 1.585l.093 8.39c.093.56-.186.84-.653.84-.373 0-.653-.28-1.026-.653l-4.568-7.178v7.272c0 .653-.373.84-.84.84-.56 0-.84-.28-.84-.84V9.616c0-.56.28-.84.746-.84.466 0 .84.28 1.212.746l4.475 7.086v-6.992c0-.653.373-.933.84-.933.466 0 .566.28.566.9zm-9.322 0c0-.56.28-.84.746-.84h.093c.466 0 .746.28.746.84v9.697c0 .56-.28.84-.746.84h-.093c-.466 0-.746-.28-.746-.84V9.523z" />
                    </svg>
                  </div>
                  <div className="w-8 h-8 rounded-xl bg-purple-50 border border-purple-100 flex items-center justify-center p-1.5 shadow-sm group-hover:scale-105 transition-transform" title="Slack">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#E01E5A" />
                      <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#36C5F0" />
                      <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="#2EB67D" />
                      <path d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.527 2.527 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="#ECB22E" />
                    </svg>
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-brand-text group-hover:text-brand-primary transition-colors leading-snug">
                    Tạo trang Notion ghi biên bản họp và báo nhóm trên Slack
                  </div>
                  <div className="text-xs text-brand-muted mt-1 flex items-center gap-1.5 font-sans">
                    <span className="text-neutral-800 font-medium">
                      Notion
                    </span>
                    <span>
                      →
                    </span>
                    <span className="text-purple-600 font-medium">
                      Slack
                    </span>
                  </div>
                </div>
              </button>
              {/* Gợi ý 4: Notion + GitHub */}
              <button onClick={() => actions.useSuggestion('Đồng bộ danh sách tính năng từ Notion sang kho mã GitHub')} className="relative overflow-hidden text-left p-4 bg-white hover:bg-neutral-50 rounded-2xl border border-brand-border shadow-soft-card transition-all duration-200 group hover:-translate-y-0.5 hover:shadow-md flex items-start gap-3.5">
                <div className="absolute -right-6 -bottom-6 w-20 h-20 rounded-full bg-neutral-900/5 group-hover:bg-neutral-900/10 transition-colors pointer-events-none" />
                <div className="flex items-center -v3-space-x-1.5 flex-shrink-0 mt-0.5">
                  <div className="w-8 h-8 rounded-xl bg-neutral-100 border border-neutral-200 flex items-center justify-center p-1.5 shadow-sm group-hover:scale-105 transition-transform" title="Notion">
                    <svg className="w-4 h-4 text-neutral-900" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l11.834-.699c.373 0 .466-.186.373-.466L18.17 2.25c-.28-.373-.746-.56-1.306-.56L3.9 2.53c-.56 0-.84.28-.653.653l1.212 1.025zm.84 3.73v12.493c0 .84.466 1.212 1.306 1.12l13.14-.746c.84-.093 1.026-.653 1.026-1.4V6.912c0-.56-.28-.84-.746-.746L5.865 6.912c-.466.093-.566.466-.566 1.026zm11.275 1.585l.093 8.39c.093.56-.186.84-.653.84-.373 0-.653-.28-1.026-.653l-4.568-7.178v7.272c0 .653-.373.84-.84.84-.56 0-.84-.28-.84-.84V9.616c0-.56.28-.84.746-.84.466 0 .84.28 1.212.746l4.475 7.086v-6.992c0-.653.373-.933.84-.933.466 0 .566.28.566.9zm-9.322 0c0-.56.28-.84.746-.84h.093c.466 0 .746.28.746.84v9.697c0 .56-.28.84-.746.84h-.093c-.466 0-.746-.28-.746-.84V9.523z" />
                    </svg>
                  </div>
                  <div className="w-8 h-8 rounded-xl bg-neutral-900 border border-neutral-800 flex items-center justify-center p-1.5 shadow-sm group-hover:scale-105 transition-transform" title="GitHub">
                    <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
                      <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                    </svg>
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-brand-text group-hover:text-brand-primary transition-colors leading-snug">
                    Đồng bộ danh sách tính năng từ Notion sang kho mã GitHub
                  </div>
                  <div className="text-xs text-brand-muted mt-1 flex items-center gap-1.5 font-sans">
                    <span className="text-neutral-800 font-medium">
                      Notion
                    </span>
                    <span>
                      →
                    </span>
                    <span className="text-neutral-900 font-medium">
                      GitHub
                    </span>
                  </div>
                </div>
              </button>
            </div>
          </div>
          {/* NHÓM 8: Dải dịch vụ chia thành 2 hàng trọn chiều rộng, không bị cắt chữ hay rớt dòng lẻ loi */}
          <div className="pt-4 border-t border-brand-border flex flex-col gap-2.5 text-xs text-brand-muted">
            {/* Hàng 1: Đã kết nối + 5 chip */}
            <div className="flex items-center gap-1.5 flex-wrap w-full">
              <span className="font-medium text-brand-text mr-1">
                Đã kết nối:
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white rounded-lg border border-brand-border text-neutral-800 font-medium shadow-sm">
                <svg className="w-3.5 h-3.5 text-[#0079BF]" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19.5 2h-15A2.5 2.5 0 002 4.5v15A2.5 2.5 0 004.5 22h15a2.5 2.5 0 002.5-2.5v-15A2.5 2.5 0 0019.5 2zm-8.25 14a1.25 1.25 0 01-1.25 1.25H6.25A1.25 1.25 0 015 16V6.25A1.25 1.25 0 016.25 5h3.75A1.25 1.25 0 0111.25 6.25V16zm7.75-5a1.25 1.25 0 01-1.25 1.25h-3.75A1.25 1.25 0 0112.75 11V6.25a1.25 1.25 0 011.25-1.25h3.75a1.25 1.25 0 011.25 1.25V11z" />
                </svg>
                <span>
                  Trello
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white rounded-lg border border-brand-border text-neutral-800 font-medium shadow-sm">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                  <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#E01E5A" />
                  <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#36C5F0" />
                  <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="#2EB67D" />
                  <path d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.527 2.527 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="#ECB22E" />
                </svg>
                <span>
                  Slack
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white rounded-lg border border-brand-border text-neutral-800 font-medium shadow-sm">
                <svg className="w-3.5 h-3.5 text-neutral-900" viewBox="0 0 24 24" fill="currentColor">
                  <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                </svg>
                <span>
                  GitHub
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white rounded-lg border border-brand-border text-neutral-800 font-medium shadow-sm">
                <svg className="w-3.5 h-3.5 text-[#0F9D58]" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-6 14H6v-3h7v3zm0-4.5H6V9.5h7v3zm0-4.5H6V5h7v3.5zm5 9h-4v-3h4v3zm0-4.5h-4V9.5h4v3zm0-4.5h-4V5h4v3.5z" />
                </svg>
                <span>
                  Google Sheets
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white rounded-lg border border-brand-border text-neutral-800 font-medium shadow-sm">
                <svg className="w-3.5 h-3.5 text-neutral-900" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l11.834-.699c.373 0 .466-.186.373-.466L18.17 2.25c-.28-.373-.746-.56-1.306-.56L3.9 2.53c-.56 0-.84.28-.653.653l1.212 1.025zm.84 3.73v12.493c0 .84.466 1.212 1.306 1.12l13.14-.746c.84-.093 1.026-.653 1.026-1.4V6.912c0-.56-.28-.84-.746-.746L5.865 6.912c-.466.093-.566.466-.566 1.026zm11.275 1.585l.093 8.39c.093.56-.186.84-.653.84-.373 0-.653-.28-1.026-.653l-4.568-7.178v7.272c0 .653-.373.84-.84.84-.56 0-.84-.28-.84-.84V9.616c0-.56.28-.84.746-.84.466 0 .84.28 1.212.746l4.475 7.086v-6.992c0-.653.373-.933.84-.933.466 0 .566.28.566.9zm-9.322 0c0-.56.28-.84.746-.84h.093c.466 0 .746.28.746.84v9.697c0 .56-.28.84-.746.84h-.093c-.466 0-.746-.28-.746-.84V9.523z" />
                </svg>
                <span>
                  Notion
                </span>
              </span>
            </div>
            {/* Hàng 2: Chưa kết nối + 3 mục biểu tượng xám + liên kết Kết nối thêm */}
            <div className="flex items-center gap-2 text-neutral-500 flex-wrap w-full">
              <span>
                Chưa kết nối:
              </span>
              <span className="inline-flex items-center gap-1 text-neutral-400">
                <svg className="w-3.5 h-3.5 text-neutral-400 opacity-60" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20a2 2 0 002 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zm0-12H5V6h14v2zm-7 5h5v5h-5v-5z" />
                </svg>
                <span>
                  Calendar
                </span>
              </span>
              <span>
                ·
              </span>
              <span className="inline-flex items-center gap-1 text-neutral-400">
                <svg className="w-3.5 h-3.5 text-neutral-400 opacity-60" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .37z" />
                </svg>
                <span>
                  Telegram
                </span>
              </span>
              <span>
                ·
              </span>
              <span className="inline-flex items-center gap-1 text-neutral-400">
                <svg className="w-3.5 h-3.5 text-neutral-400 opacity-60" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11.53 2c0 2.4 1.97 4.35 4.4 4.35h1.72V8.1c0 2.4 1.97 4.35 4.4 4.35V2H11.53zm-5.76 5.8c0 2.4 1.97 4.35 4.4 4.35h1.73v1.75c0 2.4 1.97 4.35 4.4 4.35V7.8H5.77zM0 13.6c0 2.4 1.97 4.35 4.4 4.35h1.73v1.75c0 2.4 1.97 4.35 4.4 4.35V13.6H0z" />
                </svg>
                <span>
                  Jira
                </span>
              </span>
              <span>
                ·
              </span>
              <a href="/settings" className="text-brand-primary hover:underline font-medium">
                Kết nối thêm
              </a>
              <span>
                ·
              </span>
              <a href="/guide" className="text-brand-primary hover:underline font-medium">
                Cẩm nang &amp; Mẫu câu lệnh
              </a>
            </div>
          </div>
        </section>
        {/* ==================== KHOẢNH KHẮC 2: ĐANG HIỂU ==================== */}
        <section id="moment-2" className={sectionClass(2, 'v3-space-y-8')} aria-labelledby="heading-moment-2">
          <div className="p-6 bg-white rounded-2xl border border-brand-border shadow-soft-card v3-space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-brand-primary">
              Đang phân tích yêu cầu
            </div>
            <h1 id="heading-moment-2" className="font-display text-2xl sm:text-3xl text-brand-text font-normal leading-snug" tabIndex={-1}>
              <span id="moment-2-query-display">
                {`“${m2Query}”`}
              </span>
            </h1>
          </div>
          <div className="bg-white rounded-2xl border border-brand-border p-6 shadow-soft-card v3-space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-brand-border-subtle">
              <div className="flex items-center gap-2">
                <div id="moment-2-pulse" className="w-2.5 h-2.5 rounded-full bg-brand-primary animate-ping" />
                <span id="moment-2-status-text" className="text-sm font-semibold text-brand-text">
                  Tôi đang kiểm tra các tài nguyên liên quan
                </span>
              </div>
              <span className="text-xs text-brand-muted">
                Thường mất khoảng 3–5 giây
              </span>
            </div>
            {/* NHÓM 2: 5 dòng hiện lần lượt, trạng thái "đang tìm…" với icon spinner -> "đã thấy" với icon check -> tự chuyển sang khoảnh khắc 4 */}
            <ul className="v3-space-y-3 text-sm" id="discovery-steps-list">
              {/* Step 1: Trello Board */}
              <li id="disc-step-1" className={DISC_ROW[disc[0]]}>
                <span className="flex items-center gap-2.5">
                  <span className="disc-icon w-4 h-4 flex items-center justify-center flex-shrink-0">
                    <span className={DISC_DOT[disc[0]]} />
                  </span>
                  <span>
                    {"Đang tìm bảng "}
                    <strong>
                      To Do
                    </strong>
                    {" trên Trello…"}
                  </span>
                </span>
                <DiscBadge state={disc[0]} />
              </li>
              {/* Step 2: Trello List */}
              <li id="disc-step-2" className={DISC_ROW[disc[1]]}>
                <span className="flex items-center gap-2.5">
                  <span className="disc-icon w-4 h-4 flex items-center justify-center flex-shrink-0">
                    <span className={DISC_DOT[disc[1]]} />
                  </span>
                  <span>
                    {"Đang tìm danh sách "}
                    <strong>
                      Doing
                    </strong>
                    …
                  </span>
                </span>
                <DiscBadge state={disc[1]} />
              </li>
              {/* Step 3: GitHub Repo */}
              <li id="disc-step-3" className={DISC_ROW[disc[2]]}>
                <span className="flex items-center gap-2.5">
                  <span className="disc-icon w-4 h-4 flex items-center justify-center flex-shrink-0">
                    <span className={DISC_DOT[disc[2]]} />
                  </span>
                  <span>
                    {"Đang tìm kho mã "}
                    <strong>
                      ati-test
                    </strong>
                    {" trên GitHub…"}
                  </span>
                </span>
                <DiscBadge state={disc[2]} />
              </li>
              {/* Step 4: Google Sheets */}
              <li id="disc-step-4" className={DISC_ROW[disc[3]]}>
                <span className="flex items-center gap-2.5">
                  <span className="disc-icon w-4 h-4 flex items-center justify-center flex-shrink-0">
                    <span className={DISC_DOT[disc[3]]} />
                  </span>
                  <span>
                    {"Đang tìm bảng tính "}
                    <strong>
                      ATI Test Tracker
                    </strong>
                    …
                  </span>
                </span>
                <DiscBadge state={disc[3]} />
              </li>
              {/* Step 5: Slack Channel */}
              <li id="disc-step-5" className={DISC_ROW[disc[4]]}>
                <span className="flex items-center gap-2.5">
                  <span className="disc-icon w-4 h-4 flex items-center justify-center flex-shrink-0">
                    <span className={DISC_DOT[disc[4]]} />
                  </span>
                  <span>
                    {"Đang tìm kênh "}
                    <strong>
                      #ati-test
                    </strong>
                    {" trên Slack…"}
                  </span>
                </span>
                <DiscBadge state={disc[4]} />
              </li>
            </ul>
          </div>
          <div className="flex items-center justify-between text-xs text-brand-muted pt-2">
            <button onClick={() => actions.setMoment(1)} className="hover:text-brand-text transition-colors">
              Hủy yêu cầu này
            </button>
            <button onClick={() => actions.setMoment(4)} className="inline-flex items-center gap-1 text-brand-primary font-medium hover:underline">
              <span>
                Xem kế hoạch đã lập
              </span>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </section>
        {/* ==================== KHOẢNH KHẮC 3: HỎI LẠI ==================== */}
        <section id="moment-3" className={sectionClass(3, 'v3-space-y-8')} aria-labelledby="heading-moment-3">
          <div className="v3-space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-50 text-amber-800 rounded-lg text-xs font-medium border border-amber-200">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>
                Tôi cần bạn xác nhận thêm một thông tin
              </span>
            </div>
            {' '}
            <h1 id="heading-moment-3" className="font-display text-3xl sm:text-4xl lg:text-[44px] text-brand-text font-normal leading-tight" tabIndex={-1}>
              Bạn muốn ghi vào bảng tính nào?
            </h1>
            <p className="text-base text-brand-muted max-w-xl">
              Trong tài khoản Google Sheets của nhóm, tôi tìm thấy 2 bảng tính quản lý công việc đang hoạt động.
            </p>
          </div>
          <div className="v3-space-y-3 max-w-xl">
            <button onClick={() => actions.chooseSheetOption('ATI Test Tracker')} className="w-full text-left p-4 bg-white hover:bg-neutral-50 rounded-2xl border-2 border-brand-primary shadow-sm transition-all flex items-center justify-between gap-3 group">
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-green-50 text-[#0F9D58] flex items-center justify-center font-bold text-sm shadow-sm flex-shrink-0">
                  <svg className="w-5 h-5 text-[#0F9D58]" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-6 14H6v-3h7v3zm0-4.5H6V9.5h7v3zm0-4.5H6V5h7v3.5zm5 9h-4v-3h4v3zm0-4.5h-4V9.5h4v3zm0-4.5h-4V5h4v3.5z" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <div className="text-base font-semibold text-brand-text group-hover:text-brand-primary transition-colors flex items-center gap-2 flex-wrap">
                    <span className="truncate">
                      ATI Test Tracker
                    </span>
                    <span className="text-[11px] font-medium px-2 py-0.5 bg-orange-100 text-orange-800 rounded-full flex-shrink-0">
                      Khuyên dùng
                    </span>
                  </div>
                  <div className="text-xs text-brand-muted mt-0.5 truncate">
                    Trang tính "Tasks" · Cập nhật 2 giờ trước
                  </div>
                </div>
              </div>
              <svg className="w-5 h-5 text-brand-primary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            </button>
            <button onClick={() => actions.chooseSheetOption('Sprint Report Q4')} className="w-full text-left p-4 bg-white hover:bg-neutral-50 rounded-2xl border border-brand-border shadow-sm transition-all flex items-center justify-between gap-3 group">
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-neutral-100 text-neutral-600 flex items-center justify-center font-bold text-sm shadow-sm flex-shrink-0">
                  <svg className="w-5 h-5 text-neutral-500" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-6 14H6v-3h7v3zm0-4.5H6V9.5h7v3zm0-4.5H6V5h7v3.5zm5 9h-4v-3h4v3zm0-4.5h-4V9.5h4v3zm0-4.5h-4V5h4v3.5z" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <div className="text-base font-medium text-brand-text group-hover:text-neutral-900 transition-colors truncate">
                    Sprint Report Q4
                  </div>
                  <div className="text-xs text-brand-muted mt-0.5 truncate">
                    Trang tính "Backlog" · Cập nhật 3 ngày trước
                  </div>
                </div>
              </div>
              <div className="w-5 h-5 rounded-full border border-neutral-300 flex-shrink-0" />
            </button>
            {/* NHÓM 3: Mở ô nhập tại chỗ, không dùng prompt() */}
            <div id="custom-sheet-container" className="bg-white rounded-2xl border border-dashed border-neutral-300 shadow-sm transition-all overflow-hidden">
              <button id="btn-toggle-custom-sheet" onClick={() => actions.toggleCustomSheetInput(true)} className="w-full text-left p-4 hover:bg-neutral-50 flex items-center justify-between group">
                <div className="flex items-center gap-3.5">
                  <div className="w-10 h-10 rounded-xl bg-neutral-50 text-neutral-400 flex items-center justify-center font-bold text-sm">
                    +
                  </div>
                  <div>
                    <div className="text-sm font-medium text-brand-text group-hover:text-brand-primary transition-colors">
                      Để tôi gõ tên hoặc link bảng tính khác
                    </div>
                    <div className="text-xs text-brand-muted mt-0.5">
                      Nhập link hoặc tên Google Sheets bất kỳ của bạn
                    </div>
                  </div>
                </div>
                <svg className="w-4 h-4 text-neutral-400 group-hover:text-neutral-600 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              <div id="custom-sheet-form" className={`${customSheetOpen ? '' : 'hidden '}p-4 pt-1 bg-neutral-50 border-t border-dashed border-neutral-200 v3-space-y-2`}>
                <label htmlFor="custom-sheet-input" className="text-xs font-medium text-brand-text">
                  Nhập tên hoặc link Google Sheets:
                </label>
                {' '}
                <div className="flex items-center gap-2">
                  <input ref={customSheetRef} type="text" id="custom-sheet-input" placeholder="Ví dụ: ATI Tracking Q4 hoặc https://docs.google.com/spreadsheets/..." className="flex-1 px-3 py-2 bg-white rounded-xl border border-brand-border text-xs sm:text-sm text-brand-text focus:v3-outline-none focus:border-brand-primary" onKeyDown={(event) => { if (event.key === 'Enter') actions.submitCustomSheet(); }} />
                  <button onClick={() => actions.submitCustomSheet()} className="px-4 py-2 bg-brand-primary hover:bg-brand-primary-hover text-white text-xs font-semibold rounded-xl shadow-sm transition-colors whitespace-nowrap">
                    {" Chọn bảng này "}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 pt-2">
            <button onClick={() => actions.setMoment(4)} className="px-6 py-2.5 bg-brand-primary hover:bg-brand-primary-hover text-white text-sm font-semibold rounded-xl shadow-sm transition-all">
              {" Xác nhận và tiếp tục "}
            </button>
            <button onClick={() => actions.setMoment(1)} className="px-4 py-2.5 text-sm font-medium text-brand-muted hover:text-brand-text transition-colors">
              {" Quay lại "}
            </button>
          </div>
        </section>
        {/* ==================== KHOẢNH KHẮC 4: CHỜ DUYỆT (QUAN TRỌNG NHẤT) ==================== */}
        <section id="moment-4" className={sectionClass(4, 'v3-space-y-6 relative')} aria-labelledby="heading-moment-4">
          <div className="v3-space-y-2">
            <h1 id="heading-moment-4" className="font-display text-4xl sm:text-5xl text-brand-text font-normal tracking-tight leading-tight" tabIndex={-1}>
              Tôi sẽ làm 4 việc, theo thứ tự
            </h1>
            <p className="text-sm sm:text-base text-brand-muted">
              Xin hãy xem trước nội dung sẽ được ghi vào các công cụ dưới đây trước khi duyệt.
            </p>
          </div>
          {/* 4 Task Action Cards (NHÓM 2: Hiện so le dưới 300ms, NHÓM 8: Biểu tượng SVG) */}
          <div className="v3-space-y-3" id="plan-cards-container">
            {/* Task 1: Trello */}
            <article className="plan-card-stagger-1 bg-white rounded-2xl border border-brand-border p-4 sm:p-5 shadow-soft-card transition-all hover:border-neutral-300" data-od-id="plan-item-1">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3.5 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-blue-50 text-[#0079BF] flex items-center justify-center flex-shrink-0 mt-0.5 border border-blue-100 shadow-sm">
                    <svg className="w-4 h-4 text-[#0079BF]" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M19.5 2h-15A2.5 2.5 0 002 4.5v15A2.5 2.5 0 004.5 22h15a2.5 2.5 0 002.5-2.5v-15A2.5 2.5 0 0019.5 2zm-8.25 14a1.25 1.25 0 01-1.25 1.25H6.25A1.25 1.25 0 015 16V6.25A1.25 1.25 0 016.25 5h3.75A1.25 1.25 0 0111.25 6.25V16zm7.75-5a1.25 1.25 0 01-1.25 1.25h-3.75A1.25 1.25 0 0112.75 11V6.25a1.25 1.25 0 011.25-1.25h3.75a1.25 1.25 0 011.25 1.25V11z" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold px-2 py-0.5 bg-blue-50 text-blue-700 rounded-md">
                        Trello
                      </span>
                      <span className="text-xs font-medium px-2 py-0.5 bg-neutral-100 text-neutral-700 rounded-md">
                        Tạo mới
                      </span>
                      <span className="text-xs text-brand-muted">
                        Việc 1
                      </span>
                    </div>
                    <h2 className="text-base font-semibold text-brand-text mt-1.5 leading-snug">
                      Tạo card "Sửa lỗi đăng nhập Google" trong danh sách Doing của bảng To Do
                    </h2>
                    <p className="text-xs text-brand-muted mt-1">
                      Đích đến: Bảng To Do &gt; Cột Doing
                    </p>
                  </div>
                </div>
                <button onClick={() => actions.openPreviewModal('trello')} className="flex-shrink-0 px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-brand-text text-xs font-medium rounded-lg transition-colors inline-flex items-center gap-1.5" aria-label="Xem trước nội dung card Trello">
                  <svg className="w-3.5 h-3.5 text-neutral-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  <span>
                    Xem trước
                  </span>
                </button>
              </div>
            </article>
            {/* Task 2: GitHub */}
            <article className="plan-card-stagger-2 bg-white rounded-2xl border border-brand-border p-4 sm:p-5 shadow-soft-card transition-all hover:border-neutral-300" data-od-id="plan-item-2">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3.5 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-neutral-900 text-white flex items-center justify-center flex-shrink-0 mt-0.5 border border-neutral-800 shadow-sm">
                    <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
                      <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold px-2 py-0.5 bg-neutral-100 text-neutral-800 rounded-md">
                        GitHub
                      </span>
                      <span className="text-xs font-medium px-2 py-0.5 bg-neutral-100 text-neutral-700 rounded-md">
                        Tạo mới
                      </span>
                      <span className="text-xs text-brand-muted">
                        Việc 2
                      </span>
                    </div>
                    <h2 className="text-base font-semibold text-brand-text mt-1.5 leading-snug">
                      Tạo issue trong kho ati-test; nội dung có gắn link của card vừa tạo ở việc 1
                    </h2>
                    <p className="text-xs text-brand-muted mt-1">
                      Đích đến: kho ati-test &gt; tab Issues
                    </p>
                  </div>
                </div>
                <button onClick={() => actions.openPreviewModal('github')} className="flex-shrink-0 px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-brand-text text-xs font-medium rounded-lg transition-colors inline-flex items-center gap-1.5" aria-label="Xem trước nội dung issue GitHub">
                  <svg className="w-3.5 h-3.5 text-neutral-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  <span>
                    Xem trước
                  </span>
                </button>
              </div>
            </article>
            {/* Task 3: Google Sheets */}
            <article className="plan-card-stagger-3 bg-white rounded-2xl border border-brand-border p-4 sm:p-5 shadow-soft-card transition-all hover:border-neutral-300" data-od-id="plan-item-3">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3.5 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-green-50 text-[#0F9D58] flex items-center justify-center flex-shrink-0 mt-0.5 border border-green-100 shadow-sm">
                    <svg className="w-4 h-4 text-[#0F9D58]" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-6 14H6v-3h7v3zm0-4.5H6V9.5h7v3zm0-4.5H6V5h7v3.5zm5 9h-4v-3h4v3zm0-4.5h-4V9.5h4v3zm0-4.5h-4V5h4v3.5z" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold px-2 py-0.5 bg-green-50 text-green-800 rounded-md">
                        Google Sheets
                      </span>
                      <span className="text-xs font-medium px-2 py-0.5 bg-neutral-100 text-neutral-700 rounded-md">
                        Thêm dòng
                      </span>
                      <span className="text-xs text-brand-muted">
                        Việc 3
                      </span>
                    </div>
                    <h2 className="text-base font-semibold text-brand-text mt-1.5 leading-snug">
                      Thêm một dòng vào trang Tasks của bảng tính ATI Test Tracker gồm ngày, tiêu đề, link issue, link card
                    </h2>
                    <p className="text-xs text-brand-muted mt-1">
                      Đích đến: Bảng ATI Test Tracker &gt; Trang Tasks
                    </p>
                  </div>
                </div>
                <button onClick={() => actions.openPreviewModal('sheets')} className="flex-shrink-0 px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-brand-text text-xs font-medium rounded-lg transition-colors inline-flex items-center gap-1.5" aria-label="Xem trước dòng Google Sheets">
                  <svg className="w-3.5 h-3.5 text-neutral-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  <span>
                    Xem trước
                  </span>
                </button>
              </div>
            </article>
            {/* Task 4: Slack */}
            <article className="plan-card-stagger-4 bg-white rounded-2xl border border-brand-border p-4 sm:p-5 shadow-soft-card transition-all hover:border-neutral-300" data-od-id="plan-item-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3.5 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center flex-shrink-0 mt-0.5 border border-purple-100 shadow-sm">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#E01E5A" />
                      <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#36C5F0" />
                      <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="#2EB67D" />
                      <path d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.527 2.527 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="#ECB22E" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold px-2 py-0.5 bg-purple-50 text-purple-800 rounded-md">
                        Slack
                      </span>
                      <span className="text-xs font-medium px-2 py-0.5 bg-neutral-100 text-neutral-700 rounded-md">
                        Gửi tin
                      </span>
                      <span className="text-xs text-brand-muted">
                        Việc 4
                      </span>
                    </div>
                    <h2 className="text-base font-semibold text-brand-text mt-1.5 leading-snug">
                      Gửi tin vào kênh #ati-test báo nhóm, kèm link card và issue
                    </h2>
                    <p className="text-xs text-brand-muted mt-1">
                      Đích đến: Kênh #ati-test
                    </p>
                  </div>
                </div>
                <button onClick={() => actions.openPreviewModal('slack')} className="flex-shrink-0 px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-brand-text text-xs font-medium rounded-lg transition-colors inline-flex items-center gap-1.5" aria-label="Xem trước tin nhắn Slack">
                  <svg className="w-3.5 h-3.5 text-neutral-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  <span>
                    Xem trước
                  </span>
                </button>
              </div>
            </article>
          </div>
          {/* Warning Banner */}
          <div className="p-4 rounded-xl bg-[#FFF6EE] border border-[#FFDFC6] flex items-start gap-3">
            <svg className="w-5 h-5 text-brand-primary flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div className="text-xs sm:text-sm text-neutral-800 v3-space-y-0.5">
              <div className="font-semibold text-neutral-900">
                Các thao tác này ghi thật vào công cụ của nhóm và không tự hoàn tác.
              </div>
              <div className="text-neutral-600">
                Kế hoạch được giữ trong 30 phút. Bạn có thể sửa đổi bằng chat hoặc bấm duyệt để bắt đầu ngay.
              </div>
            </div>
          </div>
          {/* Technical Details Section (Am hiểu kỹ thuật - chỉ xuất hiện khi bật) */}
          <div id="tech-details-panel" className={`${techOpen ? '' : 'hidden '}p-4 rounded-xl bg-neutral-900 text-neutral-200 font-mono text-xs v3-space-y-3 border border-neutral-800`}>
            <div className="text-[11px] text-neutral-400 font-sans font-semibold uppercase tracking-wider">
              Thao tác hệ thống &amp; luồng dữ liệu liên việc
            </div>
            <div className="v3-space-y-2">
              <div className="p-2.5 rounded bg-black/40 border border-neutral-800">
                <span className="text-orange-400 font-semibold">
                  1. trello.create_card
                </span>
                {' '}
                <div className="text-neutral-400 pl-4 mt-0.5">
                  tham số: &#123; board: "To Do", list: "Doing", name: "Sửa lỗi đăng nhập Google" &#125;
                  <br />
                  {" returns: "}
                  <span className="text-emerald-400">
                    card_id="c_942"
                  </span>
                  {", "}
                  <span className="text-emerald-400">
                    card_url="https://trello.com/c/sample-auth-fix"
                  </span>
                </div>
              </div>
              <div className="p-2.5 rounded bg-black/40 border border-neutral-800">
                <span className="text-orange-400 font-semibold">
                  2. github.create_issue
                </span>
                {' '}
                <div className="text-neutral-400 pl-4 mt-0.5">
                  {"tham số: { repo: \"ati-test\", title: \"Sửa lỗi đăng nhập Google\", body: \"...kèm link "}
                  <span className="text-emerald-400">
                    $&#123;card_url&#125;
                  </span>
                  ..." &#125;
                  <br />
                  {" returns: "}
                  <span className="text-emerald-400">
                    issue_num=42
                  </span>
                  {", "}
                  <span className="text-emerald-400">
                    issue_url="https://github.com/org/ati-test/issues/42"
                  </span>
                </div>
              </div>
              <div className="p-2.5 rounded bg-black/40 border border-neutral-800">
                <span className="text-orange-400 font-semibold">
                  3. sheets.append_rows
                </span>
                {' '}
                <div className="text-neutral-400 pl-4 mt-0.5">
                  {"tham số: { spreadsheet: \"ATI Test Tracker\", sheet: \"Tasks\", row: [\"05/10/2026\", \"Sửa lỗi đăng nhập Google\", "}
                  <span className="text-emerald-400">
                    $&#123;issue_url&#125;
                  </span>
                  {", "}
                  <span className="text-emerald-400">
                    $&#123;card_url&#125;
                  </span>
                  ] &#125;
                </div>
              </div>
              <div className="p-2.5 rounded bg-black/40 border border-neutral-800">
                <span className="text-orange-400 font-semibold">
                  4. slack.send_message
                </span>
                {' '}
                <div className="text-neutral-400 pl-4 mt-0.5">
                  {"tham số: { channel: \"#ati-test\", text: \"Thông báo nhóm: Đã tạo việc sửa lỗi... card: "}
                  <span className="text-emerald-400">
                    $&#123;card_url&#125;
                  </span>
                  {", issue: "}
                  <span className="text-emerald-400">
                    $&#123;issue_url&#125;
                  </span>
                  " &#125;
                </div>
              </div>
            </div>
          </div>
          {/* NHÓM 1: Thanh hành động sticky ở đáy màn hình, luôn nhìn thấy và bấm được; KHÔNG bị che; có ô sửa qua chat ngay phía trên */}
          <div id="moment-4-sticky-bar" className="sticky bottom-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-[#F8F8F6]/95 backdrop-blur-md border-t border-brand-border mt-6 shadow-[0_-4px_16px_rgba(0,0,0,0.04)]">
            {/* Ô nhập sửa qua Chat ngay phía trên thanh hành động (Ẩn mặc định) */}
            <div id="moment-4-inline-chat" className={`${m4ChatOpen ? '' : 'hidden '}mb-3 p-2 bg-white rounded-xl border border-brand-border shadow-soft-card flex items-center gap-2 transition-all`}>
              <input ref={m4ChatRef} type="text" id="moment-4-chat-input" className="flex-1 text-xs sm:text-sm text-brand-text placeholder-neutral-400 bg-transparent border-0 focus:ring-0 focus:v3-outline-none px-2 py-1" placeholder="Bạn muốn sửa điều gì?" onKeyDown={(event) => { if (event.key === 'Enter') actions.submitMoment4InlineChat(); }} />
              <button onClick={() => actions.submitMoment4InlineChat()} className="px-3.5 py-1.5 bg-brand-text hover:bg-black text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1">
                <span>
                  Gửi
                </span>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </button>
              <button onClick={() => actions.toggleMoment4ChatEdit(false)} className="p-1.5 text-neutral-400 hover:text-neutral-700 rounded-lg hover:bg-neutral-100 transition-colors" aria-label="Đóng ô sửa">
                {' '}
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
                {' '}
              </button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 sm:gap-3 flex-wrap w-full sm:w-auto">
                <button id="btn-approve-plan" onClick={() => actions.approvePlanAndStartExecution()} className="w-full sm:w-auto px-5 sm:px-7 py-3 bg-brand-primary hover:bg-brand-primary-hover text-white text-sm sm:text-base font-bold rounded-xl shadow-md transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-2 flex-shrink-0">
                  <span>
                    Duyệt kế hoạch
                  </span>
                  <span className="text-base sm:text-lg">
                    ✓
                  </span>
                </button>
                <button onClick={() => actions.toggleMoment4ChatEdit(true)} className="px-3.5 sm:px-4 py-2.5 sm:py-3 bg-white hover:bg-neutral-100 border border-brand-border text-brand-text text-xs sm:text-sm font-medium rounded-xl shadow-sm transition-colors flex items-center justify-center gap-1.5 flex-shrink-0">
                  <svg className="w-4 h-4 text-brand-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  <span>
                    Sửa qua Chat
                  </span>
                </button>
                <button onClick={() => actions.setMoment(1)} className="px-3 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm font-medium text-brand-muted hover:text-brand-danger transition-colors flex-shrink-0">
                  {" Hủy "}
                </button>
              </div>
              <div>
                <button onClick={() => actions.toggleTechnicalDetails()} className="text-xs text-brand-muted hover:text-brand-text font-mono inline-flex items-center gap-1.5 py-1 px-2 rounded hover:bg-neutral-100 transition-colors" aria-expanded={techOpen ? 'true' : 'false'} id="btn-tech-toggle">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                  </svg>
                  <span>
                    Chi tiết kỹ thuật
                  </span>
                  <span id="tech-toggle-arrow">
                    {techOpen ? '▲' : '▼'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </section>
        {/* ==================== KHOẢNH KHẮC 5: ĐANG LÀM ==================== */}
        <section id="moment-5" className={sectionClass(5, 'v3-space-y-6')} aria-labelledby="heading-moment-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 id="heading-moment-5" className="font-display text-3xl sm:text-4xl text-brand-text font-normal leading-tight" tabIndex={-1}>
                Đang thực hiện công việc
              </h1>
              <p className="text-sm text-brand-muted mt-1">
                Xin vui lòng chờ một lát, tôi đang thao tác theo thứ tự.
              </p>
            </div>
            <div className="text-right">
              <div id="exec-progress-label" className="inline-flex items-center gap-1.5 px-3 py-1 bg-orange-50 text-brand-primary font-semibold text-xs rounded-full border border-orange-200">
                <span className="w-2 h-2 rounded-full bg-brand-primary animate-pulse" />
                <span id="exec-step-counter">
                  {stepCounter}
                </span>
              </div>
            </div>
          </div>
          <div className="w-full bg-neutral-200 h-1.5 rounded-full overflow-hidden">
            <div id="exec-progress-bar" className="bg-brand-primary h-full transition-all duration-500 rounded-full" style={{ width: progress }} />
          </div>
          {/* NHÓM 4 & 8: Thời lượng viết kiểu Việt Nam "1,2 giây", font thân, icon SVG dịch vụ */}
          <div className="v3-space-y-3" id="exec-timeline">
            {/* Task 1: Trello */}
            <div id="exec-item-1" className="p-4 bg-white rounded-2xl border border-brand-border shadow-sm flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div id="exec-icon-1" className="w-8 h-8 rounded-xl bg-blue-50 text-[#0079BF] flex items-center justify-center flex-shrink-0 border border-blue-100 shadow-sm">
                  <svg className="w-4 h-4 text-[#0079BF]" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19.5 2h-15A2.5 2.5 0 002 4.5v15A2.5 2.5 0 004.5 22h15a2.5 2.5 0 002.5-2.5v-15A2.5 2.5 0 0019.5 2zm-8.25 14a1.25 1.25 0 01-1.25 1.25H6.25A1.25 1.25 0 015 16V6.25A1.25 1.25 0 016.25 5h3.75A1.25 1.25 0 0111.25 6.25V16zm7.75-5a1.25 1.25 0 01-1.25 1.25h-3.75A1.25 1.25 0 0112.75 11V6.25a1.25 1.25 0 011.25-1.25h3.75a1.25 1.25 0 011.25 1.25V11z" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-brand-text flex items-center gap-2 flex-wrap">
                    <span className="truncate">
                      Tạo card trên Trello
                    </span>
                    <span id="exec-check-1" className="text-xs text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded font-medium flex-shrink-0">
                      ✓ Đã tạo
                    </span>
                  </div>
                  <div className="text-xs text-neutral-600 font-normal mt-0.5 truncate">
                    {"Bảng To Do > Doing · "}
                    <a href="https://trello.com/c/sample-auth-fix" target="_blank" className="text-blue-600 hover:underline">
                      Mở card
                    </a>
                  </div>
                </div>
              </div>
              <span id="exec-time-1" className="text-xs text-neutral-500 font-body flex-shrink-0">
                1,2 giây
              </span>
            </div>
            {/* Task 2: GitHub */}
            <div id="exec-item-2" className={execItem(2).item}>
              <div className="flex items-center gap-3 min-w-0">
                <div id="exec-icon-2" className="w-8 h-8 rounded-xl bg-orange-100 text-brand-primary flex items-center justify-center flex-shrink-0 shadow-sm font-bold text-xs">
                  <svg className="w-4 h-4 text-brand-primary" viewBox="0 0 24 24" fill="currentColor">
                    <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-brand-text flex items-center gap-2 flex-wrap">
                    <span className="truncate">
                      Tạo issue trong kho ati-test
                    </span>
                    <span id="exec-badge-2" className={execItem(2).badge.cls}>{execItem(2).badge.content}</span>
                  </div>
                  <div id="exec-desc-2" className={execItem(2).desc.cls}>{execItem(2).desc.content}</div>
                </div>
              </div>
              <span id="exec-time-2" className={execItem(2).time.cls}>{execItem(2).time.content}</span>
            </div>
            {/* Task 3: Google Sheets */}
            <div id="exec-item-3" className={execItem(3).item}>
              <div className="flex items-center gap-3 min-w-0">
                <div id="exec-icon-3" className="w-8 h-8 rounded-xl bg-neutral-200 text-neutral-600 flex items-center justify-center flex-shrink-0 shadow-sm font-bold text-xs">
                  <svg className="w-4 h-4 text-neutral-500" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-6 14H6v-3h7v3zm0-4.5H6V9.5h7v3zm0-4.5H6V5h7v3.5zm5 9h-4v-3h4v3zm0-4.5h-4V9.5h4v3zm0-4.5h-4V5h4v3.5z" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-neutral-700 flex items-center gap-2 flex-wrap">
                    <span className="truncate">
                      Thêm dòng vào bảng tính
                    </span>
                    <span id="exec-badge-3" className={execItem(3).badge.cls}>{execItem(3).badge.content}</span>
                  </div>
                  <div id="exec-desc-3" className={execItem(3).desc.cls}>{execItem(3).desc.content}</div>
                </div>
              </div>
              <span id="exec-time-3" className={execItem(3).time.cls}>{execItem(3).time.content}</span>
            </div>
            {/* Task 4: Slack */}
            <div id="exec-item-4" className={execItem(4).item}>
              <div className="flex items-center gap-3 min-w-0">
                <div id="exec-icon-4" className="w-8 h-8 rounded-xl bg-neutral-200 text-neutral-600 flex items-center justify-center flex-shrink-0 shadow-sm font-bold text-xs">
                  <svg className="w-4 h-4 text-neutral-500" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" />
                    <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-neutral-700 flex items-center gap-2 flex-wrap">
                    <span className="truncate">
                      Gửi tin nhắn vào kênh #ati-test
                    </span>
                    <span id="exec-badge-4" className={execItem(4).badge.cls}>{execItem(4).badge.content}</span>
                  </div>
                  <div id="exec-desc-4" className={execItem(4).desc.cls}>{execItem(4).desc.content}</div>
                </div>
              </div>
              <span id="exec-time-4" className={execItem(4).time.cls}>{execItem(4).time.content}</span>
            </div>
          </div>
          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-brand-muted">
              Đang chạy tự động an toàn
            </span>
            <button onClick={() => actions.setMoment(6)} className="text-xs text-brand-muted hover:text-brand-text underline">
              Bỏ qua animation tới kết quả
            </button>
          </div>
        </section>
        {/* ==================== KHOẢNH KHẮC 6: XONG (NHÓM 7: GIÀU NỘI DUNG, VẪN GỌN) ==================== */}
        <section id="moment-6" className={sectionClass(6, 'v3-space-y-7 w-full max-w-[1120px] mx-auto')} aria-labelledby="heading-moment-6">
          <div className="v3-space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center shadow-sm">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path className="animate-draw-check" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <h1 id="heading-moment-6" className="font-display text-3xl sm:text-4xl lg:text-[42px] text-brand-text font-normal tracking-tight" tabIndex={-1}>
                {receipt.skip ? 'Đã xong 3 việc trên 4 công cụ' : 'Đã xong 4 việc trên 4 công cụ'}
              </h1>
              <div className="mt-1.5 flex items-center gap-2">
                <span id="moment-6-duration-tag" className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold font-body">
                  Trong 3,8 giây
                </span>
              </div>
            </div>
          </div>
          {/* NHÓM 7: Chuỗi 4 biên nhận dạng lưới 2x2 trên desktop (1->2 ở hàng trên, chuyển Z xuống 3, 3->4 ở hàng dưới), 1 cột trên mobile */}
          <div className="v3-space-y-3">
            <div id="receipt-chain" className="flex flex-col gap-3">
              {/* HÀNG TRÊN (Desktop: Trello -> GitHub) */}
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-stretch md:items-center gap-3">
                {/* Mục 1: Trello */}
                <div className="receipt-stagger-1 flex-1 bg-white rounded-2xl border border-brand-border p-4 sm:p-5 shadow-soft-card flex flex-col justify-between hover:border-blue-300 transition-all group">
                  <div className="v3-space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-xl bg-blue-50 text-[#0079BF] flex items-center justify-center p-1.5 border border-blue-100 shadow-sm flex-shrink-0">
                          <svg className="w-4 h-4 text-[#0079BF]" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M19.5 2h-15A2.5 2.5 0 002 4.5v15A2.5 2.5 0 004.5 22h15a2.5 2.5 0 002.5-2.5v-15A2.5 2.5 0 0019.5 2zm-8.25 14a1.25 1.25 0 01-1.25 1.25H6.25A1.25 1.25 0 015 16V6.25A1.25 1.25 0 016.25 5h3.75A1.25 1.25 0 0111.25 6.25V16zm7.75-5a1.25 1.25 0 01-1.25 1.25h-3.75A1.25 1.25 0 0112.75 11V6.25a1.25 1.25 0 011.25-1.25h3.75a1.25 1.25 0 011.25 1.25V11z" />
                          </svg>
                        </div>
                        <span className="text-xs font-semibold text-brand-muted uppercase tracking-wider truncate">
                          Trello Card
                        </span>
                      </div>
                      <span className="text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded-full flex-shrink-0 whitespace-nowrap">
                        ✓ Đã tạo thẻ
                      </span>
                    </div>
                    <div>
                      <h3 className="text-sm sm:text-base font-bold text-brand-text line-clamp-2 leading-snug">
                        Sửa lỗi đăng nhập Google
                      </h3>
                      <p className="text-xs text-brand-muted mt-1">
                        {"Bảng To Do > "}
                        <strong className="text-neutral-700">
                          Doing
                        </strong>
                      </p>
                    </div>
                  </div>
                  <div className="pt-3 border-t border-brand-border-subtle mt-4 flex items-center justify-between">
                    <a href="https://trello.com/c/sample-auth-fix" target="_blank" className="text-xs font-semibold text-[#0079BF] hover:underline inline-flex items-center gap-1">
                      <span>
                        Mở card
                      </span>
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  </div>
                </div>
                {/* Connector 1 */}
                <div className="connector-stagger-1 flex md:flex-col items-center justify-center py-1 md:py-0 md:px-1 flex-shrink-0">
                  <div className="hidden md:block w-4 lg:w-8 h-0.5 bg-neutral-300 my-auto" />
                  <span className="px-2 py-0.5 bg-neutral-100 text-neutral-600 border border-neutral-200 rounded-md text-[10px] font-medium whitespace-nowrap shadow-sm" title="Dữ liệu được truyền sang bước tiếp theo">
                    {' '}
                    <span className="md:hidden">
                      link card ↓
                    </span>
                    {' '}
                    <span className="hidden md:inline">
                      link card →
                    </span>
                    {' '}
                  </span>
                  <div className="hidden md:block w-4 lg:w-8 h-0.5 bg-neutral-300 my-auto" />
                </div>
                {/* Mục 2: GitHub */}
                <div className="receipt-stagger-2 flex-1 bg-white rounded-2xl border border-brand-border p-4 sm:p-5 shadow-soft-card flex flex-col justify-between hover:border-neutral-400 transition-all group">
                  <div className="v3-space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-xl bg-neutral-900 text-white flex items-center justify-center p-1.5 border border-neutral-800 shadow-sm flex-shrink-0">
                          <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
                            <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                          </svg>
                        </div>
                        <span className="text-xs font-semibold text-brand-muted uppercase tracking-wider truncate">
                          GitHub Issue
                        </span>
                      </div>
                      <span className="text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded-full flex-shrink-0 whitespace-nowrap">
                        ✓ Đã tạo issue
                      </span>
                    </div>
                    <div>
                      <h3 className="text-sm sm:text-base font-bold text-brand-text line-clamp-2 leading-snug">
                        Issue #42
                      </h3>
                      <p className="text-xs text-neutral-700 mt-1 leading-snug">
                        Kho ati-test · Sửa lỗi đăng nhập Google
                      </p>
                    </div>
                  </div>
                  <div className="pt-3 border-t border-brand-border-subtle mt-4 flex items-center justify-between">
                    <a href="https://github.com/org/ati-test/issues/42" target="_blank" className="text-xs font-semibold text-neutral-900 hover:underline inline-flex items-center gap-1">
                      <span>
                        Mở issue
                      </span>
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  </div>
                </div>
              </div>
              {/* Connector 2: Chuyển tiếp dạng chữ Z từ Hàng 1 (GitHub) sang Hàng 2 (Google Sheets) */}
              <div className="connector-stagger-2 flex items-center justify-center my-0.5 md:my-1 w-full">
                <div className="hidden md:flex items-center justify-between w-full px-4 gap-3 text-neutral-400">
                  <div className="flex-1 h-px bg-neutral-200" />
                  {' '}
                  <div className="inline-flex items-center gap-2 px-3 py-1 bg-neutral-100 border border-neutral-200 rounded-full text-[11px] font-medium text-neutral-600 shadow-sm" title="Dữ liệu được truyền từ GitHub sang Google Sheets">
                    <span>
                      GitHub #42
                    </span>
                    <svg className="w-3.5 h-3.5 text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                    </svg>
                    <span className="text-neutral-700 font-semibold">
                      link issue + link card
                    </span>
                    <svg className="w-3.5 h-3.5 text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                    </svg>
                    <span>
                      Google Sheets
                    </span>
                  </div>
                  {' '}
                  <div className="flex-1 h-px bg-neutral-200" />
                </div>
                {/* Mobile: xếp dọc nối tiếp 2 xuống 3 */}
                <div className="flex md:hidden items-center justify-center py-1">
                  <span className="px-2 py-0.5 bg-neutral-100 text-neutral-600 border border-neutral-200 rounded-md text-[10px] font-medium whitespace-nowrap shadow-sm" title="Dữ liệu được truyền sang bước tiếp theo">
                    {" link issue + link card ↓ "}
                  </span>
                </div>
              </div>
              {/* HÀNG DƯỚI (Desktop: Google Sheets -> Slack) */}
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-stretch md:items-center gap-3">
                {/* Mục 3: Google Sheets */}
                <div id="receipt-sheets-card" className="receipt-stagger-3 flex-1 bg-white rounded-2xl border border-brand-border p-4 sm:p-5 shadow-soft-card flex flex-col justify-between hover:border-green-300 transition-all group">
                  <div className="v3-space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-xl bg-green-50 text-[#0F9D58] flex items-center justify-center p-1.5 border border-green-100 shadow-sm flex-shrink-0">
                          <svg className="w-4 h-4 text-[#0F9D58]" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-6 14H6v-3h7v3zm0-4.5H6V9.5h7v3zm0-4.5H6V5h7v3.5zm5 9h-4v-3h4v3zm0-4.5h-4V9.5h4v3zm0-4.5h-4V5h4v3.5z" />
                          </svg>
                        </div>
                        <span className="text-xs font-semibold text-brand-muted uppercase tracking-wider truncate">
                          Google Sheets
                        </span>
                      </div>
                      <span id="receipt-sheets-status" className={`${RECEIPT_STATUS} ${receipt.skip ? 'text-neutral-600 bg-neutral-100' : 'text-emerald-600 bg-emerald-50'}`}>
                        {receipt.skip ? 'Đã bỏ qua' : '✓ Đã ghi dòng'}
                      </span>
                    </div>
                    <div>
                      <h3 id="receipt-sheets-title" className="text-sm sm:text-base font-bold text-brand-text line-clamp-2 leading-snug">
                        Dòng 104
                      </h3>
                      <p id="receipt-sheets-desc" className="text-xs text-brand-muted mt-1 leading-snug">
                        {receipt.skip ? 'Đã bỏ qua việc ghi Sheets vì chưa có quyền chỉnh sửa bảng tính.' : '05/10/2026 · Sửa lỗi đăng nhập Google · link issue · link card'}
                      </p>
                    </div>
                  </div>
                  <div className="pt-3 border-t border-brand-border-subtle mt-4 flex items-center justify-between">
                    <a id="receipt-sheets-link" href="https://docs.google.com/spreadsheets/d/sample" target="_blank" className="text-xs font-semibold text-[#0F9D58] hover:underline inline-flex items-center gap-1">
                      <span>
                        Xem dòng
                      </span>
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  </div>
                </div>
                {/* Connector 3 */}
                <div className="connector-stagger-3 flex md:flex-col items-center justify-center py-1 md:py-0 md:px-1 flex-shrink-0">
                  <div className="hidden md:block w-4 lg:w-8 h-0.5 bg-neutral-300 my-auto" />
                  <span className="px-2 py-0.5 bg-neutral-100 text-neutral-600 border border-neutral-200 rounded-md text-[10px] font-medium whitespace-nowrap shadow-sm" title="Dữ liệu được truyền sang bước tiếp theo">
                    {' '}
                    <span className="md:hidden">
                      link card + link issue ↓
                    </span>
                    {' '}
                    <span className="hidden md:inline">
                      link card + link issue →
                    </span>
                    {' '}
                  </span>
                  <div className="hidden md:block w-4 lg:w-8 h-0.5 bg-neutral-300 my-auto" />
                </div>
                {/* Mục 4: Slack */}
                <div id="receipt-slack-card" className="receipt-stagger-4 flex-1 bg-white rounded-2xl border border-brand-border p-4 sm:p-5 shadow-soft-card flex flex-col justify-between hover:border-purple-300 transition-all group">
                  <div className="v3-space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center p-1.5 border border-purple-100 shadow-sm flex-shrink-0">
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                            <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#E01E5A" />
                            <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#36C5F0" />
                            <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="#2EB67D" />
                            <path d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.527 2.527 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="#ECB22E" />
                          </svg>
                        </div>
                        <span className="text-xs font-semibold text-brand-muted uppercase tracking-wider truncate">
                          Slack #ati-test
                        </span>
                      </div>
                      <span id="receipt-slack-status" className={`${RECEIPT_STATUS} text-emerald-600 bg-emerald-50`}>
                        {receipt.confirmed ? '✓ Đã xác nhận' : '✓ Đã gửi tin'}
                      </span>
                    </div>
                    <div>
                      <p id="receipt-slack-desc" className="text-xs sm:text-sm text-neutral-700 mt-1 italic line-clamp-2 leading-snug">
                        {receipt.confirmed ? 'Bạn đã xác nhận tin đã có trong kênh #ati-test.' : '“Đã tạo card Trello và issue #42 cho lỗi đăng nhập Google.”'}
                      </p>
                    </div>
                  </div>
                  <div className="pt-3 border-t border-brand-border-subtle mt-4 flex items-center justify-between">
                    <a href="https://slack.com/app_redirect?channel=ati-test" target="_blank" className="text-xs font-semibold text-purple-700 hover:underline inline-flex items-center gap-1">
                      <span>
                        Xem tin
                      </span>
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  </div>
                </div>
              </div>
            </div>
            {/* Dòng lưu ý theo NHÓM 7: Cần sửa? Mở từng mục để chỉnh trực tiếp trên công cụ đó. */}
            <div className="text-xs text-brand-muted text-center sm:text-left pt-1">
              Cần sửa? Mở từng mục để chỉnh trực tiếp trên công cụ đó.
            </div>
          </div>
          {/* NHÓM 7: "Tiếp theo" với 2 gợi ý theo kết quả vừa có + nút Nhờ việc khác */}
          <div className="pt-4 border-t border-brand-border v3-space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-brand-muted">
              Tiếp theo:
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <button onClick={() => actions.handleMoment6Followup('Gán người phụ trách cho card này')} className="px-4 py-2.5 bg-white hover:bg-neutral-50 border border-brand-border hover:border-brand-primary text-brand-text text-xs sm:text-sm font-medium rounded-xl shadow-sm transition-all flex items-center gap-2 group">
                <span className="text-brand-primary font-bold">
                  +
                </span>
                <span>
                  Gán người phụ trách cho card này
                </span>
              </button>
              <button onClick={() => actions.handleMoment6Followup('Đặt lịch review cho issue #42')} className="px-4 py-2.5 bg-white hover:bg-neutral-50 border border-brand-border hover:border-brand-primary text-brand-text text-xs sm:text-sm font-medium rounded-xl shadow-sm transition-all flex items-center gap-2 group">
                <span className="text-brand-primary font-bold">
                  +
                </span>
                <span>
                  Đặt lịch review cho issue #42
                </span>
              </button>
              <button onClick={() => actions.resetToMoment1()} className="px-5 py-2.5 bg-brand-primary hover:bg-brand-primary-hover text-white text-xs sm:text-sm font-semibold rounded-xl shadow-sm transition-all">
                {" Nhờ việc khác "}
              </button>
            </div>
          </div>
        </section>
        {/* ==================== KHOẢNH KHẮC 7: CẦN BẠN XỬ LÝ - LỖI ĐÃ BIẾT (NHÓM 4 & 3) ==================== */}
        <section id="moment-7" className={sectionClass(7, 'v3-space-y-6')} aria-labelledby="heading-moment-7">
          <div className="v3-space-y-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-red-50 text-red-700 text-xs font-semibold rounded-lg border border-red-200">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>
                Cần bạn xử lý · Lỗi phân quyền
              </span>
            </div>
            {' '}
            <h1 id="heading-moment-7" className="font-display text-3xl sm:text-4xl text-brand-text font-normal leading-tight" tabIndex={-1}>
              Google Sheets chưa cho phép ghi
            </h1>
            <p className="text-sm text-brand-muted">
              Việc số 3 không thể hoàn thành do giới hạn quyền truy cập từ Google.
            </p>
          </div>
          <div className="bg-white rounded-2xl border border-brand-border p-5 sm:p-6 shadow-soft-card v3-space-y-4">
            <div className="v3-space-y-1">
              <div className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                Chuyện gì đã xảy ra
              </div>
              {/* NHÓM 4: Không khẳng định "chỉ có quyền Người xem (Viewer)" */}
              <p className="text-sm text-brand-text leading-relaxed">
                Google Sheets từ chối ghi vì ATI chưa có quyền chỉnh sửa bảng tính ATI Test Tracker.
              </p>
            </div>
            <div className="v3-space-y-1 pt-3 border-t border-brand-border-subtle">
              <div className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                Ảnh hưởng hiện tại
              </div>
              <div className="v3-space-y-1 text-sm text-brand-text">
                <div className="flex items-center gap-2 text-emerald-700">
                  <span className="font-bold">
                    ✓
                  </span>
                  <span>
                    Việc 1 (Trello) và Việc 2 (GitHub) đã tạo xong thành công và được giữ nguyên.
                  </span>
                </div>
                <div className="flex items-center gap-2 text-amber-700">
                  <span className="font-bold">
                    !
                  </span>
                  <span>
                    Việc 4 (gửi tin Slack) tạm thời chưa làm, để tránh gửi thông báo thiếu dòng ghi chú.
                  </span>
                </div>
              </div>
            </div>
            <div className="p-3.5 rounded-xl bg-neutral-50 border border-neutral-200 text-xs sm:text-sm text-brand-text v3-space-y-1">
              <span className="font-semibold text-brand-primary">
                Cần làm gì:
              </span>
              {' '}
              <p>
                {"Nhờ quản trị viên cấp quyền chỉnh sửa cho tài khoản ATI trên bảng tính này, rồi bấm "}
                <strong>
                  Thử lại việc 3
                </strong>
                .
              </p>
            </div>
          </div>
          {/* NHÓM 3: Xử lý nút bấm đúng luồng nghiệp vụ, không dùng alert */}
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => actions.retryTask3()} className="px-6 py-3 bg-brand-primary hover:bg-brand-primary-hover text-white text-sm font-semibold rounded-xl shadow-sm transition-all hover:scale-[1.01] active:scale-[0.99]">
              {" Thử lại việc 3 "}
            </button>
            <button onClick={() => actions.skipTask3()} className="px-5 py-3 bg-white hover:bg-neutral-100 border border-brand-border text-brand-text text-sm font-medium rounded-xl shadow-sm transition-colors">
              {" Bỏ qua việc này "}
            </button>
            <button onClick={() => actions.setMoment(1)} className="px-4 py-3 text-sm font-medium text-brand-muted hover:text-brand-danger transition-colors">
              {" Dừng "}
            </button>
          </div>
        </section>
        {/* ==================== KHOẢNH KHẮC 8: CẦN BẠN XỬ LÝ - CHƯA CHẮC KẾT QUẢ ==================== */}
        <section id="moment-8" className={sectionClass(8, 'v3-space-y-6')} aria-labelledby="heading-moment-8">
          <div className="v3-space-y-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 text-amber-800 text-xs font-semibold rounded-lg border border-amber-200">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>
                Cần bạn xử lý · Chưa chắc kết quả
              </span>
            </div>
            {' '}
            <h1 id="heading-moment-8" className="font-display text-3xl sm:text-4xl text-brand-text font-normal leading-tight" tabIndex={-1}>
              Chưa rõ tin nhắn đã tới kênh #ati-test chưa
            </h1>
          </div>
          <div className="bg-white rounded-2xl border border-brand-border p-5 sm:p-6 shadow-soft-card v3-space-y-4">
            <p className="text-base text-brand-text leading-relaxed">
              {"Tôi không chắc tin nhắn đã tới "}
              <strong>
                #ati-test
              </strong>
              {" chưa, vì mạng bị gián đoạn đúng lúc đang gửi. Hãy mở #ati-test để xem."}
            </p>
            <div className="v3-space-y-2 p-4 rounded-xl bg-neutral-50 border border-neutral-200 text-xs sm:text-sm">
              <div className="font-semibold text-neutral-800">
                Hướng dẫn xử lý:
              </div>
              <ul className="v3-space-y-1.5 text-neutral-700">
                <li className="flex items-start gap-2">
                  <span className="text-emerald-600 font-bold">
                    •
                  </span>
                  <span>
                    {"Nếu tin đã có trong kênh → chọn "}
                    <strong>
                      "Tin đã có, bỏ qua"
                    </strong>
                    .
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-600 font-bold">
                    •
                  </span>
                  <span>
                    {"Nếu chưa có → chọn "}
                    <strong>
                      "Dừng"
                    </strong>
                    {" rồi nhờ gửi lại bằng một yêu cầu mới."}
                  </span>
                </li>
              </ul>
            </div>
            <div className="text-xs text-neutral-500 italic">
              * Lưu ý an toàn: Để tránh gửi lặp tin nhắn vào kênh nhóm, hệ thống không tự động thử lại ở bước này.
            </div>
          </div>
          {/* NHÓM 3: "Tin đã có, bỏ qua" -> Xong, việc 4 ghi "Bạn đã xác nhận tin đã có" */}
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => actions.confirmSlackMessageExists()} className="px-6 py-3 bg-brand-primary hover:bg-brand-primary-hover text-white text-sm font-semibold rounded-xl shadow-sm transition-all">
              {" Tin đã có, bỏ qua "}
            </button>
            <button onClick={() => actions.setMoment(1)} className="px-5 py-3 bg-white hover:bg-neutral-100 border border-brand-border text-brand-text text-sm font-medium rounded-xl shadow-sm transition-colors">
              {" Dừng "}
            </button>
            <a href="https://slack.com/app_redirect?channel=ati-test" target="_blank" className="px-4 py-3 text-sm font-medium text-brand-muted hover:text-brand-text inline-flex items-center gap-1.5 transition-colors">
              <span>
                Mở #ati-test
              </span>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
        </section>
        {/* ==================== KHOẢNH KHẮC 9: CẦN BẠN XỬ LÝ - HỆ THỐNG VỪA KHỞI ĐỘNG LẠI ==================== */}
        <section id="moment-9" className={sectionClass(9, 'v3-space-y-6')} aria-labelledby="heading-moment-9">
          <div className="v3-space-y-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-neutral-100 text-neutral-800 text-xs font-semibold rounded-lg border border-neutral-300">
              <svg className="w-4 h-4 text-neutral-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>
                Khôi phục phiên làm việc
              </span>
            </div>
            {' '}
            <h1 id="heading-moment-9" className="font-display text-3xl sm:text-4xl text-brand-text font-normal leading-tight" tabIndex={-1}>
              Hệ thống vừa khởi động lại
            </h1>
          </div>
          <div className="bg-white rounded-2xl border border-brand-border p-5 sm:p-6 shadow-soft-card v3-space-y-4">
            <p className="text-base text-brand-text leading-relaxed">
              Hệ thống vừa khởi động lại trong lúc đang làm việc của bạn. Việc 1 và 2 đã xong trước đó (kèm link). Việc 3 và 4 chưa làm.
            </p>
            <div className="v3-space-y-2.5 pt-2">
              <div className="p-3 rounded-xl bg-neutral-50 border border-neutral-200 flex items-center justify-between text-xs sm:text-sm">
                <div className="flex items-center gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs">
                    ✓
                  </span>
                  <span className="font-medium text-neutral-800">
                    Việc 1: Tạo card Trello
                  </span>
                </div>
                <a href="https://trello.com/c/sample-auth-fix" target="_blank" className="text-brand-primary hover:underline font-medium inline-flex items-center gap-1">
                  <span>
                    Đã xong (Mở card)
                  </span>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </div>
              <div className="p-3 rounded-xl bg-neutral-50 border border-neutral-200 flex items-center justify-between text-xs sm:text-sm">
                <div className="flex items-center gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs">
                    ✓
                  </span>
                  <span className="font-medium text-neutral-800">
                    Việc 2: Tạo issue kho ati-test
                  </span>
                </div>
                <a href="https://github.com/org/ati-test/issues/42" target="_blank" className="text-brand-primary hover:underline font-medium inline-flex items-center gap-1">
                  <span>
                    Đã xong (Mở issue)
                  </span>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </div>
              <div className="p-3 rounded-xl bg-white border border-dashed border-neutral-300 flex items-center justify-between text-xs sm:text-sm text-neutral-500">
                <div className="flex items-center gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-neutral-200 text-neutral-600 flex items-center justify-center font-bold text-xs">
                    3
                  </span>
                  <span>
                    Việc 3: Thêm dòng vào Google Sheets
                  </span>
                </div>
                <span className="text-neutral-500 italic">
                  Chưa làm
                </span>
              </div>
              <div className="p-3 rounded-xl bg-white border border-dashed border-neutral-300 flex items-center justify-between text-xs sm:text-sm text-neutral-500">
                <div className="flex items-center gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-neutral-200 text-neutral-600 flex items-center justify-center font-bold text-xs">
                    4
                  </span>
                  <span>
                    Việc 4: Gửi tin nhắn vào kênh Slack
                  </span>
                </div>
                <span className="text-neutral-500 italic">
                  Chưa làm
                </span>
              </div>
            </div>
          </div>
          {/* NHÓM 3: "Làm tiếp các việc còn lại" -> khoảnh khắc 5 chạy tiếp từ việc 3 */}
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => actions.resumeRemainingTasks()} className="px-6 py-3 bg-brand-primary hover:bg-brand-primary-hover text-white text-sm font-semibold rounded-xl shadow-sm transition-all hover:scale-[1.01] active:scale-[0.99]">
              {" Làm tiếp các việc còn lại "}
            </button>
            <button onClick={() => actions.setMoment(1)} className="px-5 py-3 bg-white hover:bg-neutral-100 border border-brand-border text-brand-text text-sm font-medium rounded-xl shadow-sm transition-colors">
              {" Dừng "}
            </button>
          </div>
        </section>
      </main>
      {/* PERSISTENT BOTTOM INPUT BAR (NHÓM 6: Ẩn ở khoảnh khắc 1; NHÓM 1: Ẩn ở khoảnh khắc 4) */}
      <footer id="global-bottom-bar" className={`${activated === 1 || activated === 4 ? 'hidden ' : ''}fixed bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-[#F8F8F6] via-[#F8F8F6]/95 to-transparent pt-6 pb-4 px-4 sm:px-6 pointer-events-none`}>
        <div className="max-w-3xl mx-auto pointer-events-auto">
          <div className="bg-white rounded-2xl border border-brand-border shadow-elevated p-2 sm:p-2.5 flex items-center gap-2 focus-within:border-brand-primary focus-within:shadow-orange-glow transition-all">
            <div className="p-2 text-brand-muted hidden sm:block">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <label htmlFor="bottom-chat-input" className="sr-only">
              Nhắn thêm với tôi
            </label>
            <input ref={bottomInputRef} id="bottom-chat-input" type="text" className="flex-1 text-sm sm:text-base text-brand-text placeholder-neutral-400 bg-transparent border-0 focus:ring-0 focus:v3-outline-none px-2 py-1" placeholder="Nhắn thêm với tôi để sửa kế hoạch hoặc thêm chi tiết..." onKeyDown={(event) => actions.handleBottomInputKey(event)} />
            <button onClick={() => actions.submitBottomInput()} className="px-4 py-2 bg-neutral-900 hover:bg-black text-white text-xs sm:text-sm font-medium rounded-xl transition-colors flex-shrink-0 flex items-center gap-1.5" aria-label="Gửi tin nhắn">
              <span>
                Gửi
              </span>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </button>
          </div>
        </div>
      </footer>
      {/* NHÓM 5: Viên "Kịch bản demo" ở góc trên bên phải ngay dưới thanh đầu (cả mobile và desktop) không che thanh hành động ở đáy */}
      <div id="demo-pill-container" className="fixed top-[88px] right-3 z-40 w-max inline-block pointer-events-none transition-[top] duration-200" style={pillTop ? { top: pillTop } : undefined}>
        {' '}
        <div className="relative w-max">
          <button ref={demoButtonRef} id="demo-pill-btn" onClick={() => actions.toggleDemoMenu()} className="pointer-events-auto inline-flex items-center gap-1.5 sm:gap-2 px-2.5 py-1.5 sm:px-3.5 sm:py-2 bg-neutral-900/90 hover:bg-black text-white text-[11px] sm:text-xs font-medium rounded-full shadow-lg backdrop-blur-md transition-all hover:scale-105 active:scale-95" aria-haspopup="true" aria-expanded={demoMenuOpen ? 'true' : 'false'} title="Nhấn phím 1-9 để chuyển nhanh">
            <span className="w-2 h-2 rounded-full bg-brand-primary animate-ping" />
            <span className="hidden sm:inline">
              Kịch bản demo
            </span>
            <span className="sm:hidden">
              Demo
            </span>
            <kbd className="px-1.5 py-0.5 bg-white/20 rounded text-[10px] font-mono">
              1–9
            </kbd>
          </button>
          {' '}
          {/* Menu demo: bung xuống ở góc trên phải */}
          {' '}
          <div ref={demoMenuRef} id="demo-menu" className={`${demoMenuOpen ? '' : 'hidden '}absolute top-10 sm:top-11 right-0 w-72 sm:w-80 bg-white rounded-2xl border border-brand-border shadow-2xl p-2.5 v3-space-y-2 text-xs z-50 pointer-events-auto`}>
            <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-brand-muted border-b border-brand-border-subtle flex justify-between items-center">
              <span>
                Chọn 1 trong 9 khoảnh khắc
              </span>
              <span className="text-neutral-400 font-mono text-[10px]">
                Phím tắt 1-9
              </span>
            </div>
            <div className="max-h-60 sm:max-h-72 overflow-y-auto v3-space-y-1 py-1">
              <button onClick={() => actions.setMoment(1)} className={`w-full text-left px-3 py-2 rounded-lg hover:bg-neutral-100 flex items-center justify-between group moment-btn${activated === 1 ? ' bg-orange-50 text-brand-primary' : ''}`} data-moment="1">
                <span className="text-brand-text font-medium group-hover:text-brand-primary">
                  1. Nhờ việc (Bắt đầu)
                </span>
                <kbd className="text-[10px] font-mono text-neutral-400 bg-neutral-100 px-1.5 py-0.5 rounded">
                  1
                </kbd>
              </button>
              <button onClick={() => actions.setMoment(2)} className={`w-full text-left px-3 py-2 rounded-lg hover:bg-neutral-100 flex items-center justify-between group moment-btn${activated === 2 ? ' bg-orange-50 text-brand-primary' : ''}`} data-moment="2">
                <span className="text-brand-text font-medium group-hover:text-brand-primary">
                  2. Đang hiểu (Truy tìm tài nguyên)
                </span>
                <kbd className="text-[10px] font-mono text-neutral-400 bg-neutral-100 px-1.5 py-0.5 rounded">
                  2
                </kbd>
              </button>
              <button onClick={() => actions.setMoment(3)} className={`w-full text-left px-3 py-2 rounded-lg hover:bg-neutral-100 flex items-center justify-between group moment-btn${activated === 3 ? ' bg-orange-50 text-brand-primary' : ''}`} data-moment="3">
                <span className="text-brand-text font-medium group-hover:text-brand-primary">
                  3. Hỏi lại (Xác nhận bảng tính)
                </span>
                <kbd className="text-[10px] font-mono text-neutral-400 bg-neutral-100 px-1.5 py-0.5 rounded">
                  3
                </kbd>
              </button>
              <button onClick={() => actions.setMoment(4)} className={`w-full text-left px-3 py-2 rounded-lg hover:bg-neutral-100 flex items-center justify-between group moment-btn${activated === 4 ? ' bg-orange-50 text-brand-primary' : ''}`} data-moment="4">
                <span className="text-brand-text font-semibold text-brand-primary">
                  4. Chờ duyệt (Quan trọng nhất)
                </span>
                <kbd className="text-[10px] font-mono text-brand-primary bg-orange-100 px-1.5 py-0.5 rounded font-bold">
                  4
                </kbd>
              </button>
              <button onClick={() => actions.setMoment(5)} className={`w-full text-left px-3 py-2 rounded-lg hover:bg-neutral-100 flex items-center justify-between group moment-btn${activated === 5 ? ' bg-orange-50 text-brand-primary' : ''}`} data-moment="5">
                <span className="text-brand-text font-medium group-hover:text-brand-primary">
                  5. Đang làm (Hành trình dọc)
                </span>
                <kbd className="text-[10px] font-mono text-neutral-400 bg-neutral-100 px-1.5 py-0.5 rounded">
                  5
                </kbd>
              </button>
              <button onClick={() => actions.setMoment(6)} className={`w-full text-left px-3 py-2 rounded-lg hover:bg-neutral-100 flex items-center justify-between group moment-btn${activated === 6 ? ' bg-orange-50 text-brand-primary' : ''}`} data-moment="6">
                <span className="text-brand-text font-medium group-hover:text-brand-primary">
                  6. Xong (Kết quả &amp; liên kết)
                </span>
                <kbd className="text-[10px] font-mono text-neutral-400 bg-neutral-100 px-1.5 py-0.5 rounded">
                  6
                </kbd>
              </button>
              <button onClick={() => actions.setMoment(7)} className={`w-full text-left px-3 py-2 rounded-lg hover:bg-neutral-100 flex items-center justify-between group moment-btn${activated === 7 ? ' bg-orange-50 text-brand-primary' : ''}`} data-moment="7">
                <span className="text-brand-text font-medium text-red-600">
                  7. Lỗi đã biết (Quyền Sheets)
                </span>
                <kbd className="text-[10px] font-mono text-neutral-400 bg-neutral-100 px-1.5 py-0.5 rounded">
                  7
                </kbd>
              </button>
              <button onClick={() => actions.setMoment(8)} className={`w-full text-left px-3 py-2 rounded-lg hover:bg-neutral-100 flex items-center justify-between group moment-btn${activated === 8 ? ' bg-orange-50 text-brand-primary' : ''}`} data-moment="8">
                <span className="text-brand-text font-medium text-amber-600">
                  8. Chưa chắc kết quả (Mạng Slack)
                </span>
                <kbd className="text-[10px] font-mono text-neutral-400 bg-neutral-100 px-1.5 py-0.5 rounded">
                  8
                </kbd>
              </button>
              <button onClick={() => actions.setMoment(9)} className={`w-full text-left px-3 py-2 rounded-lg hover:bg-neutral-100 flex items-center justify-between group moment-btn${activated === 9 ? ' bg-orange-50 text-brand-primary' : ''}`} data-moment="9">
                <span className="text-brand-text font-medium text-neutral-700">
                  9. Hệ thống khởi động lại
                </span>
                <kbd className="text-[10px] font-mono text-neutral-400 bg-neutral-100 px-1.5 py-0.5 rounded">
                  9
                </kbd>
              </button>
            </div>
            <div className="pt-2 border-t border-brand-border-subtle v3-space-y-2.5">
              <div>
                <div className="px-1 text-[11px] font-medium text-brand-muted mb-1">
                  Xem như:
                </div>
                <div className="grid grid-cols-2 gap-1.5 p-0.5 bg-neutral-100 rounded-lg">
                  <button id="role-btn-admin" type="button" onClick={() => actions.setRole('admin')} className={`demo-toggle-btn${isAdmin ? ' is-active' : ''}`} aria-pressed={isAdmin ? 'true' : 'false'}>
                    Quản trị viên
                  </button>
                  <button id="role-btn-member" type="button" onClick={() => actions.setRole('member')} className={`demo-toggle-btn${isAdmin ? '' : ' is-active'}`} aria-pressed={isAdmin ? 'false' : 'true'}>
                    Thành viên
                  </button>
                </div>
              </div>
              <div>
                <div className="px-1 text-[11px] font-medium text-brand-muted mb-1">
                  Máy chủ:
                </div>
                <div className="grid grid-cols-2 gap-1.5 p-0.5 bg-neutral-100 rounded-lg">
                  <button id="server-btn-mock" type="button" onClick={() => actions.setServerMode('mock')} className={`demo-toggle-btn${isMock ? ' is-active' : ''}`} aria-pressed={isMock ? 'true' : 'false'}>
                    Thử nghiệm
                  </button>
                  <button id="server-btn-real" type="button" onClick={() => actions.setServerMode('real')} className={`demo-toggle-btn${isMock ? '' : ' is-active'}`} aria-pressed={isMock ? 'false' : 'true'}>
                    Thật
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
        {' '}
      </div>
      {/* RIGHT CHAT DRAWER (NHÓM 4: Bỏ Phiên #104, khớp đối thoại khoảnh khắc 3, NHÓM 5: Focus trap & Esc) */}
      <aside ref={chatDrawerRef} id="chat-drawer" className={`fixed inset-y-0 right-0 z-50 w-full sm:w-[420px] bg-white border-l border-brand-border shadow-2xl v3-transform${chatOpen ? '' : ' translate-x-full'} transition-transform duration-300 ease-in-out flex flex-col`} role="dialog" aria-modal="true" aria-labelledby="chat-drawer-title">
        <div className="px-5 py-4 border-b border-brand-border flex items-center justify-between bg-neutral-50/50">
          <div className="flex items-center gap-2">
            <h2 id="chat-drawer-title" className="font-display font-semibold text-lg text-brand-text">
              Nhật ký hội thoại
            </h2>
          </div>
          <button onClick={() => actions.toggleChatDrawer(false)} className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors" aria-label="Đóng ngăn kéo">
            {' '}
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
            {' '}
          </button>
        </div>
        <div ref={messagesRef} id="chat-messages-container" className="flex-1 overflow-y-auto p-5 v3-space-y-4 text-xs sm:text-sm">
          <div className="flex flex-col items-end v3-space-y-1">
            <span className="text-[11px] text-brand-muted">
              Bạn · 10:14
            </span>
            <div className="p-3 bg-neutral-900 text-white rounded-2xl rounded-tr-none max-w-[85%] leading-relaxed">
              Tạo card Trello cho lỗi đăng nhập Google, tạo issue GitHub, ghi vào Google Sheets và báo kênh Slack
            </div>
          </div>
          <div className="flex flex-col items-start v3-space-y-1">
            <span className="text-[11px] text-brand-muted">
              ATI · 10:14
            </span>
            <div className="p-3 bg-neutral-100 text-brand-text rounded-2xl rounded-tl-none max-w-[88%] v3-space-y-2 leading-relaxed">
              <p>
                Tôi đã tìm thấy các dịch vụ liên quan (Trello, GitHub, Google Sheets, Slack).
              </p>
              <p>
                Bạn muốn ghi vào bảng tính nào?
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end v3-space-y-1">
            <span className="text-[11px] text-brand-muted">
              Bạn · 10:15
            </span>
            <div className="p-3 bg-neutral-900 text-white rounded-2xl rounded-tr-none max-w-[85%] leading-relaxed">
              ATI Test Tracker
            </div>
          </div>
          <div className="flex flex-col items-start v3-space-y-1">
            <span className="text-[11px] text-brand-muted">
              ATI · 10:15
            </span>
            <div className="p-3 bg-[#FFF5ED] border border-[#FFDEC9] text-brand-text rounded-2xl rounded-tl-none max-w-[88%] v3-space-y-2 leading-relaxed">
              <div className="font-semibold text-brand-primary">
                Kế hoạch 4 việc đã sẵn sàng trên sân khấu chính.
              </div>
              <p>
                Bạn có thể bấm "Duyệt kế hoạch ✓" trên màn hình hoặc nhắn trực tiếp vào đây nếu cần sửa đổi.
              </p>
            </div>
          </div>
          {messages.map(message => (
            <div key={message.id} className="flex flex-col items-end v3-space-y-1">
              <span className="text-[11px] text-brand-muted">{`${message.sender} · Vừa xong`}</span>
              <div className="p-3 bg-neutral-900 text-white rounded-2xl rounded-tr-none max-w-[85%] leading-relaxed">{message.text}</div>
            </div>
          ))}
        </div>
        <div className="p-4 border-t border-brand-border bg-neutral-50/50">
          <div className="flex items-center gap-2">
            <input ref={drawerInputRef} type="text" id="drawer-chat-input" className="flex-1 px-3 py-2 bg-white rounded-xl border border-brand-border text-xs sm:text-sm focus:v3-outline-none focus:border-brand-primary" placeholder="Nhắn tiếp trong phiên này..." onKeyDown={(event) => { if (event.key === 'Enter') actions.sendDrawerMessage(); }} />
            <button onClick={() => actions.sendDrawerMessage()} className="p-2 bg-brand-primary text-white rounded-xl hover:bg-brand-primary-hover transition-colors" aria-label="Gửi tin nhắn">
              {' '}
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
              {' '}
            </button>
          </div>
        </div>
      </aside>
      {/* HISTORY DRAWER (NHÓM 5: Focus trap & Esc) */}
      <aside ref={historyDrawerRef} id="history-drawer" className={`fixed inset-y-0 left-0 z-50 w-full sm:w-[380px] bg-white border-r border-brand-border shadow-2xl v3-transform${historyOpen ? '' : ' -translate-x-full'} transition-transform duration-300 ease-in-out flex flex-col`} role="dialog" aria-modal="true" aria-labelledby="history-drawer-title">
        <div className="px-5 py-4 border-b border-brand-border flex items-center justify-between bg-neutral-50/50">
          <h2 id="history-drawer-title" className="font-display font-semibold text-lg text-brand-text">
            Lịch sử yêu cầu
          </h2>
          <button onClick={() => actions.toggleHistoryDrawer(false)} className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors" aria-label="Đóng lịch sử">
            {' '}
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
            {' '}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 v3-space-y-2 text-xs sm:text-sm">
          <div className="p-3 rounded-xl bg-orange-50 border border-orange-200">
            <div className="flex justify-between items-center text-[11px] text-brand-primary font-semibold">
              <span>
                ĐANG CHẠY
              </span>
              <span>
                10:14 Hôm nay
              </span>
            </div>
            <div className="font-medium text-brand-text mt-1">
              Sửa lỗi đăng nhập Google, tạo card Trello, issue GitHub, cập nhật Sheet và Slack
            </div>
          </div>
          <div className="p-3 rounded-xl bg-neutral-50 hover:bg-neutral-100 border border-brand-border transition-colors cursor-pointer" onClick={() => actions.loadHistoricalRequest('Ghi báo cáo tiến độ tuần 42 vào Google Sheets và thông báo nhóm Slack')}>
            <div className="flex justify-between items-center text-[11px] text-neutral-500">
              <span>
                HOÀN THÀNH
              </span>
              <span>
                Hôm qua, 16:30
              </span>
            </div>
            <div className="font-medium text-neutral-800 mt-1">
              Ghi báo cáo tiến độ tuần 42 vào Google Sheets và thông báo nhóm Slack
            </div>
          </div>
          <div className="p-3 rounded-xl bg-neutral-50 hover:bg-neutral-100 border border-brand-border transition-colors cursor-pointer" onClick={() => actions.loadHistoricalRequest('Đặt lịch họp review bản demo và gửi thiệp mời qua Notion')}>
            <div className="flex justify-between items-center text-[11px] text-neutral-500">
              <span>
                HOÀN THÀNH
              </span>
              <span>
                Thứ Sáu tuần trước
              </span>
            </div>
            <div className="font-medium text-neutral-800 mt-1">
              Đặt lịch họp review bản demo và gửi thiệp mời qua Notion
            </div>
          </div>
        </div>
      </aside>
      {/* MODAL: XEM TRƯỚC NỘI DUNG TỪNG VIỆC (NHÓM 4: Đúng sự thật, không bịa chi tiết; NHÓM 5: Focus trap, Esc, backdrop) */}
      <div ref={previewModalRef} id="preview-modal" className={`fixed inset-0 z-50 bg-black/40 backdrop-blur-sm${previewOpen ? '' : ' hidden'} flex items-center justify-center p-4`} role="dialog" aria-modal="true" aria-labelledby="preview-modal-title" onClick={(event) => actions.handlePreviewBackdropClick(event)}>
        <div id="preview-modal-box" className="bg-white rounded-2xl max-w-xl w-full border border-brand-border shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
          <div className="px-5 py-4 border-b border-brand-border flex items-center justify-between bg-neutral-50">
            <div className="flex items-center gap-2">
              <span id="preview-service-tag" className={preview ? PREVIEW[preview].tag : 'px-2 py-0.5 rounded text-xs font-semibold bg-neutral-200 text-neutral-800'}>
                {preview ? PREVIEW[preview].tagText : 'Dịch vụ'}
              </span>
              <h3 id="preview-modal-title" className="font-display font-semibold text-base text-brand-text">
                {preview ? PREVIEW[preview].title : 'Xem trước nội dung'}
              </h3>
            </div>
            <button onClick={() => actions.closePreviewModal()} className="p-1 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-200 transition-colors" aria-label="Đóng xem trước">
              {' '}
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
              {' '}
            </button>
          </div>
          <div className="p-5 overflow-y-auto v3-space-y-4 text-xs sm:text-sm text-brand-text" id="preview-modal-content">
            {preview ? PREVIEW[preview].content : null}
          </div>
          <div className="px-5 py-3 border-t border-brand-border bg-neutral-50 flex justify-end">
            <button onClick={() => actions.closePreviewModal()} className="px-4 py-2 bg-neutral-900 hover:bg-black text-white text-xs font-medium rounded-xl transition-colors">
              {" Đóng xem trước "}
            </button>
          </div>
        </div>
      </div>
      {/* OVERLAY BACKDROP FOR DRAWERS (NHÓM 5: backdrop-blur-sm thay cho backdrop-blur-xs) */}
      <div id="drawer-backdrop" className={`fixed inset-0 z-40 bg-black/25 backdrop-blur-sm${backdrop ? '' : ' hidden'} transition-opacity`} onClick={() => actions.closeAllDrawers()} />
    </>
  );
}
