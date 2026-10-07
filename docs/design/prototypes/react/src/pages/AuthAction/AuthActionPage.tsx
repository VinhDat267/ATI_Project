// Chuyển từ docs/design/prototypes/auth-action.html bằng scripts/html-to-jsx.mjs, sau đó sửa tay.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { usePrototypePage, type PageMeta } from '../../app/usePrototypePage';
import css from './page.css?inline';

const VIEWS = ['verify-success', 'verify-expired', 'verify-used', 'reset-password', 'reset-success', 'google-pending',
  'google-ready', 'google-error', 'blocked-pending', 'blocked-locked', 'blocked-attempts'] as const;
type Mode = typeof VIEWS[number];
type Toast = { id: number; message: string; phase: 'enter' | 'shown' | 'leaving' };
const TAB_BASE = 'scenario-tab px-3 py-1.5 rounded-full border border-transparent whitespace-nowrap transition-colors';
const TOAST_BASE = 'px-4 py-2.5 rounded-xl bg-[#111827] text-white text-xs sm:text-sm font-medium shadow-lg flex items-center gap-2 v3-transform transition-all duration-200';
const TOAST_PHASE = { enter: 'translate-y-2 opacity-0', shown: 'translate-y-0 opacity-100', leaving: '-translate-y-2 opacity-0' };
const BAR_EMPTY = 'h-full flex-1 rounded-full bg-[#E5E7EB] transition-colors';
const BAR = (color: string) => `h-full flex-1 rounded-full transition-colors ${color}`;
const spinner = <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>;
const eyeOpen = <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></>;
const eyeClosed = <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />;

// Độ mạnh mật khẩu như validatePasswordStrength của bản mẫu: màu từng vạch và dòng chữ.
function strength(password: string): { bars: string[]; text: string; className: string } {
  const empty = [BAR_EMPTY, BAR_EMPTY, BAR_EMPTY, BAR_EMPTY];
  if (!password) return { bars: empty, text: 'Tối thiểu 12 ký tự', className: 'text-[11px] text-[#6B7280]' };
  if (password.length < 12) return { bars: [BAR('bg-[#DC2626]'), BAR_EMPTY, BAR_EMPTY, BAR_EMPTY], text: 'Mật khẩu cần ít nhất 12 ký tự', className: 'text-[11px] text-[#DC2626] font-medium' };
  let score = 1;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  const filled = (count: number, color: string) => empty.map((bar, i) => (i < count ? BAR(color) : bar));
  if (score <= 1) return { bars: filled(1, 'bg-[#D97706]'), text: 'Độ mạnh: Khá (đạt 12 ký tự)', className: 'text-[11px] text-[#D97706] font-medium' };
  if (score === 2) return { bars: filled(2, 'bg-[#D97706]'), text: 'Độ mạnh: Tốt', className: 'text-[11px] text-[#D97706] font-medium' };
  if (score === 3) return { bars: filled(3, 'bg-[#16A34A]'), text: 'Độ mạnh: Rất an toàn', className: 'text-[11px] text-[#16A34A] font-medium' };
  return { bars: filled(4, 'bg-[#16A34A]'), text: 'Độ mạnh: Tuyệt vời', className: 'text-[11px] text-[#16A34A] font-medium' };
}
const readMode = (): Mode => {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode') || params.get('state');
  return (VIEWS as readonly string[]).includes(mode ?? '') ? mode as Mode : 'verify-success';
};

export const meta: PageMeta = {
  id: "auth-action",
  title: "Xác thực & Hành động tài khoản — ATI",
  htmlClass: "",
  bodyClass: "min-h-screen flex flex-col bg-[#F8F8F6] text-[#111827]",
  css,
};

export function AuthActionPage() {
  usePrototypePage(meta);
  const [mode, setModeState] = useState<Mode>(readMode);
  const [modeTick, setModeTick] = useState(0);
  const [user, setUser] = useState({ email: 'lan.nguyen@congty.vn', name: 'Lan Nguyễn' });
  const [menuOpen, setMenuOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendSent, setResendSent] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  // Dòng chữ độ mạnh chỉ có class sau lần gõ đầu tiên (HTML gốc không có class).
  const [strengthTouched, setStrengthTouched] = useState(false);
  const [matchMessage, setMatchMessage] = useState({ text: '', className: 'text-[11px] text-[#6B7280] mt-1' });
  const [visible, setVisible] = useState({ 'new-password-input': false, 'confirm-password-input': false });
  // null: chưa chạy đồng hồ lần nào, giữ chữ và độ dài vạch của HTML gốc.
  const [blockedSeconds, setBlockedSeconds] = useState<number | null>(null);
  // Hết giờ: bản mẫu tô chữ xanh và giữ màu này kể cả khi chạy lại đồng hồ.
  const [blockedDone, setBlockedDone] = useState(false);
  const blockedLeft = useRef(899);
  const resendInputRef = useRef<HTMLInputElement>(null);
  const newPasswordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const timers = useRef<number[]>([]);
  const toastId = useRef(0);
  const later = (ms: number, run: () => void) => { timers.current.push(window.setTimeout(run, ms)); };
  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);

  const showToast = (message: string) => {
    const id = ++toastId.current;
    setToasts(list => [...list, { id, message, phase: 'enter' }]);
    requestAnimationFrame(() => setToasts(list => list.map(t => (t.id === id ? { ...t, phase: 'shown' } : t))));
    later(3200, () => {
      setToasts(list => list.map(t => (t.id === id ? { ...t, phase: 'leaving' } : t)));
      later(250, () => setToasts(list => list.filter(t => t.id !== id)));
    });
  };

  // Mỗi lần đổi màn (kể cả lúc mở trang): ghi ?mode= (trừ lần đầu), hẹn toast của google-ready, chạy đồng hồ khoá tạm.
  useEffect(() => {
    if (modeTick > 0) {
      const url = new URL(window.location.href);
      url.searchParams.set('mode', mode);
      window.history.replaceState({}, '', url);
    }
    if (mode === 'google-ready') {
      const timer = window.setTimeout(() => showToast('Đang chuyển hướng tới không gian làm việc…'), 1500);
      return () => window.clearTimeout(timer);
    }
    if (mode === 'blocked-attempts') {
      blockedLeft.current = 899;
      setBlockedSeconds(899);
      const interval = window.setInterval(() => {
        if (blockedLeft.current > 0) {
          blockedLeft.current -= 1;
          setBlockedSeconds(blockedLeft.current);
          return;
        }
        window.clearInterval(interval);
        setBlockedDone(true);
        showToast('Đã hết 15 phút tạm khóa. Bạn có thể thử đăng nhập lại.');
      }, 1000);
      return () => window.clearInterval(interval);
    }
  }, [mode, modeTick]);
  // Menu demo: bấm ra ngoài thì đóng.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuButtonRef.current?.contains(target) && !menuRef.current?.contains(target)) setMenuOpen(false);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  const checkPasswordMatch = () => {
    const password = newPasswordRef.current?.value ?? '';
    const confirm = confirmPasswordRef.current?.value ?? '';
    if (!confirm) { setMatchMessage(message => ({ ...message, text: '' })); return; }
    setMatchMessage(password === confirm
      ? { text: '✓ Mật khẩu khớp nhau', className: 'text-[11px] text-[#16A34A] mt-1 font-medium' }
      : { text: 'Mật khẩu xác nhận chưa trùng khớp', className: 'text-[11px] text-[#DC2626] mt-1' });
  };
  const actions = {
    setMode(next: Mode) {
      if (!VIEWS.includes(next)) return;
      setModeState(next);
      setModeTick(tick => tick + 1);
      setMenuOpen(false);
    },
    switchUserEmail(email: string, name: string) {
      setUser({ email, name });
      if (resendInputRef.current) resendInputRef.current.value = email;
      showToast('Đã đổi tài khoản thử nghiệm: ' + name);
      setMenuOpen(false);
    },
    handleResendVerification(event: FormEvent) {
      event.preventDefault();
      const email = resendInputRef.current ? resendInputRef.current.value.trim() : user.email;
      setResendBusy(true);
      later(700, () => {
        setResendBusy(false);
        setResendSent(email);
        showToast('Đã gửi link xác minh mới tới ' + email);
      });
    },
    validatePasswordStrength(password: string) {
      setNewPassword(password);
      setStrengthTouched(true);
      // Bản mẫu chỉ kiểm khớp mật khẩu khi mật khẩu mới đủ 12 ký tự.
      if (password.length >= 12) checkPasswordMatch();
    },
    checkPasswordMatch,
    togglePasswordVisibility(inputId: keyof typeof visible) {
      setVisible(state => ({ ...state, [inputId]: !state[inputId] }));
    },
    handleResetPasswordSubmit(event: FormEvent) {
      event.preventDefault();
      const password = newPasswordRef.current?.value ?? '';
      const confirm = confirmPasswordRef.current?.value ?? '';
      if (password.length < 12) { showToast('Mật khẩu mới phải có ít nhất 12 ký tự!'); return; }
      if (password !== confirm) { showToast('Mật khẩu xác nhận không trùng khớp!'); return; }
      setResetBusy(true);
      later(700, () => {
        setResetBusy(false);
        actions.setMode('reset-success');
        showToast('Mật khẩu đã được thay đổi thành công!');
      });
    },
  };
  // Tab giữ border-transparent của HTML và được thêm màu viền. Tailwind v3 CDN xếp class theo thứ tự xuất hiện trong trang:
  // border-[#FF5701] (xuất hiện sau) thắng, border-[#E7E7E2] (có từ thanh trên) thua. v4 xếp theo tên nên
  // border-transparent luôn thắng; đánh dấu ! cho màu cam để giữ kết quả của v3.
  const tabClass = (m: Mode) => `${TAB_BASE} ${mode === m ? 'bg-[#FF5701] text-white border-[#FF5701]!' : 'bg-white text-[#4B5563] border-[#E7E7E2]'}`;
  const viewClass = (m: Mode) => `v3-space-y-6${mode === m ? '' : ' hidden'}`;
  const power = strength(newPassword);
  const blockedText = blockedSeconds === null ? '14:59' : `${String(Math.floor(blockedSeconds / 60)).padStart(2, '0')}:${String(blockedSeconds % 60).padStart(2, '0')}`;
  const blockedWidth = blockedSeconds === null ? '100%' : `${Math.max(0, Math.min(100, (blockedSeconds / 900) * 100))}%`;
  return (
    <>
      {/* Toast Thông báo nổi */}
      <div id="toast-container" className="fixed top-5 left-1/2 -translate-x-1/2 z-50 pointer-events-none flex flex-col items-center gap-2" role="status" aria-live="polite">
        {toasts.map(toast => <div key={toast.id} className={`${TOAST_BASE} ${TOAST_PHASE[toast.phase]}`}><span>{toast.message}</span></div>)}
      </div>
      {/* THANH TRÊN (COCKPIT HEADER) */}
      <header className="sticky top-0 z-40 w-full bg-[#F8F8F6]/90 backdrop-blur-md border-b border-[#E7E7E2] px-4 sm:px-6 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
          {/* Cụm Logo & Điều hướng quay lại */}
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <a href="/" className="flex items-center gap-2.5 group flex-shrink-0" title="Về trang chủ ATI">
              <div className="w-8 h-8 rounded-lg bg-[#FF5701] flex items-center justify-center text-white font-display font-bold text-lg shadow-sm group-hover:scale-105 transition-transform">
                A
              </div>
              <span className="font-display font-bold text-lg tracking-tight text-[#111827]">
                ATI
              </span>
            </a>
            <div className="h-4 w-px bg-[#E7E7E2] flex-shrink-0" />
            <a href="/" className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-[#4B5563] hover:text-[#111827] transition-colors py-1 px-2 rounded-lg hover:bg-black/5" title="Quay lại trang chủ">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              <span className="hidden sm:inline">
                Về trang chủ
              </span>
              <span className="sm:hidden">
                Trang chủ
              </span>
            </a>
          </div>
          {/* Cụm Điều khiển Demo & Liên kết không gian làm việc */}
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            <a href="/app-stage" className="hidden sm:inline-flex items-center gap-1.5 text-xs font-medium text-[#4B5563] hover:text-[#FF5701] transition-colors px-2.5 py-1.5 rounded-lg border border-transparent hover:border-[#E7E7E2] bg-transparent hover:bg-white">
              <span>
                Không gian làm việc
              </span>
              {' '}
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
              </svg>
            </a>
            {/* Nút Kịch bản demo */}
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
              {/* Menu chọn Kịch bản Demo */}
              {' '}
              <div ref={menuRef} id="demo-menu-dropdown" className={`${menuOpen ? '' : 'hidden '}absolute right-0 mt-2 w-72 max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-lg border border-[#E7E7E2] p-3 z-50 v3-space-y-3`} role="menu">
                <div>
                  <div className="text-[11px] font-bold text-[#6B7280] uppercase tracking-wider mb-2">
                    Chọn màn hình kiểm thử
                  </div>
                  <div className="v3-space-y-1 text-xs">
                    <button type="button" onClick={() => actions.setMode('verify-success')} className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-neutral-100 flex items-center justify-between text-[#111827]">
                      <span>
                        1. Xác minh: Thành công
                      </span>
                      <span className="text-[10px] text-[#16A34A] font-semibold">
                        ✓
                      </span>
                    </button>
                    <button type="button" onClick={() => actions.setMode('verify-expired')} className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-neutral-100 flex items-center justify-between text-[#111827]">
                      <span>
                        2. Xác minh: Link hết hạn
                      </span>
                      <span className="text-[10px] text-[#D97706] font-semibold">
                        24h
                      </span>
                    </button>
                    <button type="button" onClick={() => actions.setMode('verify-used')} className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-neutral-100 flex items-center justify-between text-[#111827]">
                      <span>
                        3. Xác minh: Link đã dùng
                      </span>
                      <span className="text-[10px] text-[#3B82F6] font-semibold">
                        Đã xác thực
                      </span>
                    </button>
                    <button type="button" onClick={() => actions.setMode('reset-password')} className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-neutral-100 flex items-center justify-between text-[#111827]">
                      <span>
                        4. Đặt mật khẩu mới
                      </span>
                      <span className="text-[10px] text-[#FF5701] font-semibold">
                        Form
                      </span>
                    </button>
                    <button type="button" onClick={() => actions.setMode('reset-success')} className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-neutral-100 flex items-center justify-between text-[#111827]">
                      <span>
                        5. Đặt mật khẩu: Thành công
                      </span>
                      <span className="text-[10px] text-[#16A34A] font-semibold">
                        ✓ Xong
                      </span>
                    </button>
                    <button type="button" onClick={() => actions.setMode('google-pending')} className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-neutral-100 flex items-center justify-between text-[#111827]">
                      <span>
                        6. Google: Tài khoản mới (Chờ duyệt)
                      </span>
                      <span className="text-[10px] text-[#D97706] font-semibold">
                        Chờ
                      </span>
                    </button>
                    <button type="button" onClick={() => actions.setMode('google-ready')} className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-neutral-100 flex items-center justify-between text-[#111827]">
                      <span>
                        7. Google: Đã duyệt (Vào làm việc)
                      </span>
                      <span className="text-[10px] text-[#16A34A] font-semibold">
                        Chuyển
                      </span>
                    </button>
                    <button type="button" onClick={() => actions.setMode('google-error')} className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-neutral-100 flex items-center justify-between text-[#111827]">
                      <span>
                        8. Google: Huỷ hoặc lỗi cấp quyền
                      </span>
                      <span className="text-[10px] text-[#DC2626] font-semibold">
                        Lỗi
                      </span>
                    </button>
                    <button type="button" onClick={() => actions.setMode('blocked-pending')} className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-neutral-100 flex items-center justify-between text-[#111827]">
                      <span>
                        9. Chặn: Chờ duyệt
                      </span>
                      <span className="text-[10px] text-[#D97706] font-semibold">
                        Chờ
                      </span>
                    </button>
                    <button type="button" onClick={() => actions.setMode('blocked-locked')} className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-neutral-100 flex items-center justify-between text-[#111827]">
                      <span>
                        10. Chặn: Bị khóa
                      </span>
                      <span className="text-[10px] text-[#DC2626] font-semibold">
                        Khóa
                      </span>
                    </button>
                    <button type="button" onClick={() => actions.setMode('blocked-attempts')} className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-neutral-100 flex items-center justify-between text-[#111827]">
                      <span>
                        11. Chặn: Sai MK 5 lần
                      </span>
                      <span className="text-[10px] text-[#EA580C] font-semibold">
                        15p
                      </span>
                    </button>
                  </div>
                </div>
                <div className="pt-2 border-t border-[#E7E7E2]">
                  <div className="text-[11px] font-bold text-[#6B7280] uppercase tracking-wider mb-1.5">
                    Tài khoản mẫu
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button type="button" onClick={() => actions.switchUserEmail('lan.nguyen@congty.vn', 'Lan Nguyễn')} className="flex-1 py-1 px-2 text-xs rounded bg-neutral-100 hover:bg-neutral-200 text-[#111827] text-center font-medium">
                      Lan Nguyễn
                    </button>
                    <button type="button" onClick={() => actions.switchUserEmail('tuan.dang@congty.vn', 'Tuấn Đặng')} className="flex-1 py-1 px-2 text-xs rounded bg-neutral-100 hover:bg-neutral-200 text-[#111827] text-center font-medium">
                      Tuấn Đặng
                    </button>
                  </div>
                </div>
              </div>
              {' '}
            </div>
          </div>
        </div>
      </header>
      {/* DẢI CHỌN NHANH KỊCH BẢN (SEGMENTED TABS) */}
      <nav className="w-full bg-white border-b border-[#E7E7E2] px-4 py-2 sticky top-[57px] z-30 shadow-sm" aria-label="Các trạng thái xác thực và hành động">
        <div className="max-w-4xl mx-auto flex items-center gap-2 overflow-x-auto no-scrollbar text-xs font-medium">
          <span className="text-[#6B7280] flex-shrink-0 text-[11px] uppercase tracking-wider pl-1">
            Xem thử:
          </span>
          <button type="button" onClick={() => actions.setMode('verify-success')} id="tab-verify-success" className={tabClass('verify-success')} aria-pressed={mode === 'verify-success' ? 'true' : 'false'}>
            {" Xác minh: Thành công "}
          </button>
          <button type="button" onClick={() => actions.setMode('verify-expired')} id="tab-verify-expired" className={tabClass('verify-expired')} aria-pressed={mode === 'verify-expired' ? 'true' : 'false'}>
            {" Xác minh: Link hết hạn "}
          </button>
          <button type="button" onClick={() => actions.setMode('verify-used')} id="tab-verify-used" className={tabClass('verify-used')} aria-pressed={mode === 'verify-used' ? 'true' : 'false'}>
            {" Xác minh: Link đã dùng "}
          </button>
          <button type="button" onClick={() => actions.setMode('reset-password')} id="tab-reset-password" className={tabClass('reset-password')} aria-pressed={mode === 'reset-password' ? 'true' : 'false'}>
            {" Đặt mật khẩu mới "}
          </button>
          <button type="button" onClick={() => actions.setMode('reset-success')} id="tab-reset-success" className={tabClass('reset-success')} aria-pressed={mode === 'reset-success' ? 'true' : 'false'}>
            {" Đặt MK: Xong "}
          </button>
          <button type="button" onClick={() => actions.setMode('google-pending')} id="tab-google-pending" className={tabClass('google-pending')} aria-pressed={mode === 'google-pending' ? 'true' : 'false'}>
            {" Google: Chờ duyệt "}
          </button>
          <button type="button" onClick={() => actions.setMode('google-ready')} id="tab-google-ready" className={tabClass('google-ready')} aria-pressed={mode === 'google-ready' ? 'true' : 'false'}>
            {" Google: Vào làm việc "}
          </button>
          <button type="button" onClick={() => actions.setMode('google-error')} id="tab-google-error" className={tabClass('google-error')} aria-pressed={mode === 'google-error' ? 'true' : 'false'}>
            {" Google: Huỷ / Lỗi "}
          </button>
          <button type="button" onClick={() => actions.setMode('blocked-pending')} id="tab-blocked-pending" className={tabClass('blocked-pending')} aria-pressed={mode === 'blocked-pending' ? 'true' : 'false'}>
            {" Chặn: Chờ duyệt "}
          </button>
          <button type="button" onClick={() => actions.setMode('blocked-locked')} id="tab-blocked-locked" className={tabClass('blocked-locked')} aria-pressed={mode === 'blocked-locked' ? 'true' : 'false'}>
            {" Chặn: Bị khóa "}
          </button>
          <button type="button" onClick={() => actions.setMode('blocked-attempts')} id="tab-blocked-attempts" className={tabClass('blocked-attempts')} aria-pressed={mode === 'blocked-attempts' ? 'true' : 'false'}>
            {" Chặn: Sai MK 5 lần "}
          </button>
        </div>
      </nav>
      {/* NỘI DUNG CHÍNH (CONTAINER TRUNG TÂM) */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 md:p-8" role="main">
        <div className="w-full max-w-lg mx-auto">
          {/* Card trung tâm */}
          <div id="action-card" className="bg-white border border-[#E7E7E2] rounded-3xl p-6 sm:p-8 shadow-soft relative overflow-hidden transition-all duration-200">
            {/* ========================================== */}
            {/* MÀN 1: XÁC MINH EMAIL — THÀNH CÔNG */}
            {/* ========================================== */}
            <section id="view-verify-success" className={viewClass('verify-success')} aria-labelledby="title-verify-success">
              {/* Icon và Tiêu đề */}
              <div className="text-center v3-space-y-3">
                <div className="w-14 h-14 rounded-2xl bg-[#16A34A]/10 text-[#16A34A] flex items-center justify-center mx-auto shadow-sm">
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider bg-[#16A34A]/10 text-[#16A34A] mb-2">
                    {" Bước 1 / 3 hoàn tất "}
                  </span>
                  {' '}
                  <h1 id="title-verify-success" className="font-display font-semibold text-2xl sm:text-[26px] text-[#111827] tracking-tight">
                    Email của bạn đã được xác minh
                  </h1>
                </div>
                <p className="text-sm text-[#4B5563] leading-relaxed max-w-md mx-auto">
                  {"Địa chỉ "}
                  <strong className="text-[#111827] font-semibold user-email-placeholder">
                    {user.email}
                  </strong>
                  {" đã được xác thực thành công. Yêu cầu của bạn đã sẵn sàng cho bước tiếp theo."}
                </p>
              </div>
              {/* Thẻ quy trình 3 bước (Sự thật sản phẩm) */}
              <div className="bg-[#F8F8F6] border border-[#E7E7E2] rounded-2xl p-4 sm:p-5 v3-space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
                  Tiến trình kích hoạt tài khoản
                </div>
                <div className="v3-space-y-3 text-xs sm:text-sm">
                  {/* Bước 1: Xong */}
                  <div className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full bg-[#16A34A] text-white flex items-center justify-center flex-shrink-0 mt-0.5 text-[11px] font-bold">
                      ✓
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-[#111827]">
                        Bước 1: Xác minh địa chỉ email
                      </div>
                      <div className="text-[#6B7280] text-xs">
                        Đã xác minh qua liên kết trong thư điện tử.
                      </div>
                    </div>
                  </div>
                  {/* Bước 2: Đang chờ */}
                  <div className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full bg-[#FF5701] text-white flex items-center justify-center flex-shrink-0 mt-0.5 text-[11px] font-bold animate-pulse">
                      2
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-[#FF5701]">
                        Bước 2: Quản trị viên duyệt tài khoản (Hiện tại)
                      </div>
                      <div className="text-[#4B5563] text-xs leading-relaxed mt-0.5">
                        Quản trị viên nhóm đã nhận được thông báo. Bạn sẽ nhận được email ngay khi tài khoản được phê duyệt và cấp quyền sử dụng các công cụ.
                      </div>
                    </div>
                  </div>
                  {/* Bước 3: Sắp tới */}
                  <div className="flex items-start gap-3 opacity-60">
                    <div className="w-5 h-5 rounded-full border border-[#D1D5DB] bg-white text-[#9CA3AF] flex items-center justify-center flex-shrink-0 mt-0.5 text-[11px] font-medium">
                      3
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-[#6B7280]">
                        Bước 3: Vào không gian làm việc
                      </div>
                      <div className="text-[#9CA3AF] text-xs">
                        Mở sân khấu điều phối và bắt đầu giao việc bằng tiếng Việt.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              {/* Lời nhắc an toàn */}
              <div className="text-xs text-[#6B7280] text-center leading-relaxed">
                Hệ thống chỉ gửi thông báo xác thực từ địa chỉ chính thức của nhóm. Bạn có thể an tâm đóng trang này hoặc quay về trang chủ.
              </div>
              {/* Nút hành động */}
              <div className="v3-space-y-2.5 pt-1">
                <a href="/" className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-[#FF5701] hover:bg-[#E04C00] text-white font-medium text-sm transition-colors shadow-sm focus-visible:v3-outline-none">
                  <span>
                    Về trang chủ ATI
                  </span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </a>
                <a href="/" className="w-full flex items-center justify-center py-2.5 px-4 rounded-xl border border-[#E7E7E2] hover:bg-neutral-50 text-[#4B5563] hover:text-[#111827] font-medium text-xs sm:text-sm transition-colors focus-visible:v3-outline-none">
                  Thử đăng nhập lại
                </a>
              </div>
            </section>
            {/* ========================================== */}
            {/* MÀN 2: XÁC MINH EMAIL — LINK HẾT HẠN */}
            {/* ========================================== */}
            <section id="view-verify-expired" className={viewClass('verify-expired')} aria-labelledby="title-verify-expired">
              <div className="text-center v3-space-y-3">
                <div className="w-14 h-14 rounded-2xl bg-[#D97706]/10 text-[#D97706] flex items-center justify-center mx-auto shadow-sm">
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider bg-[#D97706]/10 text-[#D97706] mb-2">
                    {" Link đã hết hiệu lực "}
                  </span>
                  {' '}
                  <h1 id="title-verify-expired" className="font-display font-semibold text-2xl sm:text-[26px] text-[#111827] tracking-tight">
                    Link xác minh đã hết hạn
                  </h1>
                </div>
                <p className="text-sm text-[#4B5563] leading-relaxed max-w-md mx-auto">
                  {"Vì lý do an toàn, các đường link xác minh email chỉ có hiệu lực trong vòng "}
                  <strong className="text-[#111827]">
                    24 giờ
                  </strong>
                  {" kể từ lúc gửi. Link bạn vừa mở đã quá thời hạn sử dụng."}
                </p>
              </div>
              {/* Form yêu cầu gửi lại link */}
              <form id="form-resend-verification" onSubmit={(event) => actions.handleResendVerification(event)} className="bg-[#F8F8F6] border border-[#E7E7E2] rounded-2xl p-5 v3-space-y-4">
                <div>
                  <label htmlFor="resend-email-input" className="block text-xs font-semibold text-[#111827] uppercase tracking-wider mb-1.5">
                    Nhập email để nhận link xác minh mới
                  </label>
                  {' '}
                  <input ref={resendInputRef} type="email" id="resend-email-input" required defaultValue="lan.nguyen@congty.vn" className="w-full px-3.5 py-2.5 bg-white border border-[#E7E7E2] rounded-xl text-sm text-[#111827] placeholder-[#9CA3AF] focus:border-[#FF5701] focus:ring-1 focus:ring-[#FF5701] transition-all" />
                </div>
                <button type="submit" id="btn-submit-resend" className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-[#FF5701] hover:bg-[#E04C00] text-white font-medium text-sm transition-colors shadow-sm focus-visible:v3-outline-none" disabled={resendBusy}>
                  {resendBusy ? <>{spinner}<span>Đang gửi lại…</span></> : <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg><span>Gửi lại link xác minh mới</span></>}
                </button>
              </form>
              {/* Hộp kết quả sau khi gửi lại */}
              <div id="resend-success-box" className={`${resendSent === null ? 'hidden ' : ''}p-4 rounded-xl bg-[#16A34A]/10 border border-[#16A34A]/20 text-xs text-[#16A34A] leading-relaxed`}>
                <div className="font-semibold text-sm mb-1 flex items-center gap-1.5">
                  <span>
                    ✓ Đã gửi link xác minh mới
                  </span>
                </div>
                {"Vui lòng kiểm tra hộp thư đến của "}
                <span className="font-semibold" id="resend-target-email">
                  {resendSent ?? 'lan.nguyen@congty.vn'}
                </span>
                {" để bấm xác nhận tài khoản."}
              </div>
              <div className="text-center pt-2">
                <a href="/" className="inline-flex items-center gap-1.5 text-xs font-medium text-[#6B7280] hover:text-[#111827] transition-colors">
                  <span>
                    ← Quay lại trang chủ
                  </span>
                </a>
              </div>
            </section>
            {/* ========================================== */}
            {/* MÀN 3: XÁC MINH EMAIL — LINK ĐÃ DÙNG */}
            {/* ========================================== */}
            <section id="view-verify-used" className={viewClass('verify-used')} aria-labelledby="title-verify-used">
              <div className="text-center v3-space-y-3">
                <div className="w-14 h-14 rounded-2xl bg-[#3B82F6]/10 text-[#3B82F6] flex items-center justify-center mx-auto shadow-sm">
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider bg-[#3B82F6]/10 text-[#3B82F6] mb-2">
                    {" Đã xác thực trước đó "}
                  </span>
                  {' '}
                  <h1 id="title-verify-used" className="font-display font-semibold text-2xl sm:text-[26px] text-[#111827] tracking-tight">
                    Link này đã được sử dụng
                  </h1>
                </div>
                <p className="text-sm text-[#4B5563] leading-relaxed max-w-md mx-auto">
                  {"Địa chỉ "}
                  <strong className="text-[#111827] font-semibold user-email-placeholder">
                    {user.email}
                  </strong>
                  {" đã được xác minh thành công trước đó. Bạn không cần xác minh lại địa chỉ email này."}
                </p>
              </div>
              {/* Thông tin trạng thái tài khoản */}
              <div className="bg-[#F8F8F6] border border-[#E7E7E2] rounded-2xl p-5 v3-space-y-3">
                <div className="flex items-center justify-between text-xs border-b border-[#E7E7E2] pb-3">
                  <span className="text-[#6B7280]">
                    Trạng thái tài khoản:
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-[#D97706]/10 text-[#D97706]">
                    {" Đang chờ duyệt "}
                  </span>
                </div>
                <p className="text-xs text-[#4B5563] leading-relaxed">
                  Yêu cầu của bạn hiện đang chờ Quản trị viên nhóm xem xét và cấp quyền. Ngay sau khi được phê duyệt, hệ thống sẽ gửi email kèm thông tin bắt đầu sử dụng.
                </p>
              </div>
              {/* Nút hành động */}
              <div className="v3-space-y-2.5 pt-1">
                <a href="/" className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-[#FF5701] hover:bg-[#E04C00] text-white font-medium text-sm transition-colors shadow-sm focus-visible:v3-outline-none">
                  <span>
                    Đăng nhập hoặc về trang chủ
                  </span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </a>
                <a href="/" className="w-full flex items-center justify-center py-2.5 px-4 rounded-xl border border-[#E7E7E2] hover:bg-neutral-50 text-[#4B5563] hover:text-[#111827] font-medium text-xs sm:text-sm transition-colors focus-visible:v3-outline-none">
                  Thử đăng nhập lại
                </a>
              </div>
            </section>
            {/* ========================================== */}
            {/* MÀN 4: ĐẶT MẬT KHẨU MỚI */}
            {/* ========================================== */}
            <section id="view-reset-password" className={viewClass('reset-password')} aria-labelledby="title-reset-password">
              <div className="text-center v3-space-y-2">
                <div className="w-14 h-14 rounded-2xl bg-[#FF5701]/10 text-[#FF5701] flex items-center justify-center mx-auto shadow-sm">
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <div>
                  <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider bg-[#FF5701]/10 text-[#FF5701] mb-2">
                    {" Bảo mật tài khoản "}
                  </span>
                  {' '}
                  <h1 id="title-reset-password" className="font-display font-semibold text-2xl sm:text-[26px] text-[#111827] tracking-tight">
                    Tạo mật khẩu mới
                  </h1>
                </div>
                <p className="text-sm text-[#4B5563] leading-relaxed">
                  {"Đặt mật khẩu mới cho tài khoản "}
                  <strong className="text-[#111827] user-email-placeholder">
                    {user.email}
                  </strong>
                  .
                </p>
              </div>
              {/* Form đặt mật khẩu mới */}
              <form id="form-reset-password" onSubmit={(event) => actions.handleResetPasswordSubmit(event)} className="v3-space-y-4">
                {/* Mật khẩu mới */}
                <div>
                  <label htmlFor="new-password-input" className="block text-xs font-semibold text-[#111827] uppercase tracking-wider mb-1.5">
                    Mật khẩu mới
                  </label>
                  <div className="relative">
                    <input ref={newPasswordRef} type={visible['new-password-input'] ? 'text' : 'password'} id="new-password-input" required minLength={12} placeholder="Ít nhất 12 ký tự" onInput={(event) => actions.validatePasswordStrength(event.currentTarget.value)} className="w-full px-3.5 py-2.5 pr-10 bg-white border border-[#E7E7E2] rounded-xl text-sm text-[#111827] placeholder-[#9CA3AF] focus:border-[#FF5701] focus:ring-1 focus:ring-[#FF5701] transition-all" />
                    {' '}
                    <button type="button" onClick={() => actions.togglePasswordVisibility('new-password-input')} className="absolute inset-y-0 right-0 pr-3 flex items-center text-[#9CA3AF] hover:text-[#4B5563] focus-visible:v3-outline-none" aria-label="Ẩn hiện mật khẩu">
                      <svg id="icon-eye-new" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        {visible['new-password-input'] ? eyeClosed : eyeOpen}
                      </svg>
                    </button>
                  </div>
                  {/* Thước đo độ mạnh mật khẩu */}
                  <div className="mt-2 v3-space-y-1">
                    <div className="flex items-center gap-1.5 h-1.5 w-full">
                      <div id="strength-bar-1" className={power.bars[1 - 1]} />
                      <div id="strength-bar-2" className={power.bars[2 - 1]} />
                      <div id="strength-bar-3" className={power.bars[3 - 1]} />
                      <div id="strength-bar-4" className={power.bars[4 - 1]} />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-[#6B7280]">
                      <span id="strength-text" className={strengthTouched ? power.className : undefined}>
                        {power.text}
                      </span>
                      <span>
                        Độ an toàn
                      </span>
                    </div>
                  </div>
                </div>
                {/* Xác nhận mật khẩu mới */}
                <div>
                  <label htmlFor="confirm-password-input" className="block text-xs font-semibold text-[#111827] uppercase tracking-wider mb-1.5">
                    Xác nhận mật khẩu mới
                  </label>
                  <div className="relative">
                    <input ref={confirmPasswordRef} type={visible['confirm-password-input'] ? 'text' : 'password'} id="confirm-password-input" required minLength={12} placeholder="Nhập lại mật khẩu mới" onInput={() => actions.checkPasswordMatch()} className="w-full px-3.5 py-2.5 pr-10 bg-white border border-[#E7E7E2] rounded-xl text-sm text-[#111827] placeholder-[#9CA3AF] focus:border-[#FF5701] focus:ring-1 focus:ring-[#FF5701] transition-all" />
                    {' '}
                    <button type="button" onClick={() => actions.togglePasswordVisibility('confirm-password-input')} className="absolute inset-y-0 right-0 pr-3 flex items-center text-[#9CA3AF] hover:text-[#4B5563] focus-visible:v3-outline-none" aria-label="Ẩn hiện mật khẩu xác nhận">
                      <svg id="icon-eye-confirm" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        {visible['confirm-password-input'] ? eyeClosed : eyeOpen}
                      </svg>
                    </button>
                  </div>
                  <div id="password-match-msg" className={matchMessage.className}>{matchMessage.text}</div>
                </div>
                {/* Nút cập nhật mật khẩu */}
                <button type="submit" id="btn-submit-reset-password" className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-[#FF5701] hover:bg-[#E04C00] text-white font-medium text-sm transition-colors shadow-sm focus-visible:v3-outline-none" disabled={resetBusy}>
                  {resetBusy ? <>{spinner}<span>Đang lưu mật khẩu…</span></> : <><span>Cập nhật mật khẩu</span><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg></>}
                </button>
              </form>
              {/* Lưu ý an toàn */}
              <div className="text-[11px] text-[#6B7280] text-center leading-relaxed v3-space-y-1">
                <p className="font-medium text-[#4B5563]">
                  Link đặt lại mật khẩu có hiệu lực 30 phút và chỉ dùng được một lần.
                </p>
                <p>
                  Sau khi đổi mật khẩu, bạn sẽ dùng mật khẩu mới này để đăng nhập vào ATI trên mọi thiết bị.
                </p>
              </div>
            </section>
            {/* ========================================== */}
            {/* MÀN 5: ĐẶT MẬT KHẨU — THÀNH CÔNG */}
            {/* ========================================== */}
            <section id="view-reset-success" className={viewClass('reset-success')} aria-labelledby="title-reset-success">
              <div className="text-center v3-space-y-3">
                <div className="w-14 h-14 rounded-2xl bg-[#16A34A]/10 text-[#16A34A] flex items-center justify-center mx-auto shadow-sm">
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider bg-[#16A34A]/10 text-[#16A34A] mb-2">
                    {" Cập nhật thành công "}
                  </span>
                  {' '}
                  <h1 id="title-reset-success" className="font-display font-semibold text-2xl sm:text-[26px] text-[#111827] tracking-tight">
                    Mật khẩu đã được thay đổi
                  </h1>
                </div>
                <p className="text-sm text-[#4B5563] leading-relaxed max-w-md mx-auto">
                  {"Mật khẩu mới của tài khoản "}
                  <strong className="text-[#111827] user-email-placeholder">
                    {user.email}
                  </strong>
                  {" đã được lưu thành công. Các phiên làm việc cũ đã được thu hồi an toàn."}
                </p>
              </div>
              <div className="bg-[#F8F8F6] border border-[#E7E7E2] rounded-2xl p-4 text-xs text-[#4B5563] v3-space-y-2">
                <div className="font-semibold text-[#111827] flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-[#16A34A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  <span>
                    Bảo vệ phiên đăng nhập
                  </span>
                </div>
                <p>
                  Để bảo vệ an toàn cho bạn, mọi thiết bị đăng nhập trước đó đã được tự động đăng xuất. Vui lòng đăng nhập lại bằng mật khẩu vừa tạo.
                </p>
              </div>
              <div className="v3-space-y-2.5 pt-1">
                <a href="/" className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-[#FF5701] hover:bg-[#E04C00] text-white font-medium text-sm transition-colors shadow-sm focus-visible:v3-outline-none">
                  <span>
                    Đăng nhập ngay
                  </span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </a>
                <a href="/" className="w-full flex items-center justify-center py-2.5 px-4 rounded-xl border border-[#E7E7E2] hover:bg-neutral-50 text-[#4B5563] hover:text-[#111827] font-medium text-xs sm:text-sm transition-colors">
                  Về trang chủ ATI
                </a>
              </div>
            </section>
            {/* ========================================== */}
            {/* MÀN 6: GOOGLE — TÀI KHOẢN MỚI CHỜ DUYỆT */}
            {/* ========================================== */}
            <section id="view-google-pending" className={viewClass('google-pending')} aria-labelledby="title-google-pending">
              <div className="text-center v3-space-y-3">
                <div className="w-14 h-14 rounded-2xl bg-white border border-[#E7E7E2] flex items-center justify-center mx-auto shadow-sm">
                  <svg className="w-7 h-7" viewBox="0 0 24 24">
                    {' '}
                    <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z" />
                    {' '}
                    <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.34 24 12 24z" />
                    {' '}
                    <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z" />
                    {' '}
                    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z" />
                    {' '}
                  </svg>
                </div>
                <div>
                  <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider bg-[#D97706]/10 text-[#D97706] mb-2">
                    {" Đăng ký với Google · Chờ phê duyệt "}
                  </span>
                  {' '}
                  <h1 id="title-google-pending" className="font-display font-semibold text-2xl sm:text-[26px] text-[#111827] tracking-tight">
                    Đang chờ quản trị viên duyệt
                  </h1>
                </div>
                <p className="text-sm text-[#4B5563] leading-relaxed max-w-md mx-auto">
                  {"Tài khoản Google "}
                  <strong className="text-[#111827] font-semibold user-email-placeholder">
                    {user.email}
                  </strong>
                  {" đã được kết nối an toàn với nền tảng ATI."}
                </p>
              </div>
              {/* Giải thích quy định an toàn */}
              <div className="bg-[#F8F8F6] border border-[#E7E7E2] rounded-2xl p-5 v3-space-y-3.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#111827]">
                  <svg className="w-4 h-4 text-[#D97706]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span>
                    Quy định an toàn của nhóm
                  </span>
                </div>
                <p className="text-xs text-[#4B5563] leading-relaxed">
                  {"Theo quy định bảo mật của nhóm, mọi tài khoản mới (kể cả đăng ký bằng Google) đều cần "}
                  <strong className="text-[#111827]">
                    Quản trị viên phê duyệt
                  </strong>
                  {" trước khi có thể truy cập các công cụ Trello, Slack, GitHub hay Google Sheets dùng chung."}
                </p>
                <div className="pt-2 border-t border-[#E7E7E2] text-xs text-[#6B7280] v3-space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A]" />
                    <span>
                      {"Thông tin Google đã được ghi nhận: "}
                      <span className="font-medium text-[#111827] user-name-placeholder">
                    {user.name}
                  </span>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#FF5701]" />
                    <span>
                      Hệ thống sẽ gửi email cho bạn ngay khi quản trị viên phê duyệt.
                    </span>
                  </div>
                  <div className="pt-1">
                    <a href="/privacy#google-oauth" className="text-[11px] text-[#FF5701] hover:underline font-medium inline-flex items-center gap-1">
                      <span>
                        Xem chính sách dữ liệu tài khoản Google
                      </span>
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                      </svg>
                    </a>
                  </div>
                </div>
              </div>
              {/* Nút hành động */}
              <div className="v3-space-y-2.5 pt-1">
                <a href="/" className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-[#FF5701] hover:bg-[#E04C00] text-white font-medium text-sm transition-colors shadow-sm focus-visible:v3-outline-none">
                  <span>
                    Thử đăng nhập lại
                  </span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </a>
                <a href="/" className="w-full flex items-center justify-center py-2.5 px-4 rounded-xl border border-[#E7E7E2] hover:bg-neutral-50 text-[#4B5563] hover:text-[#111827] font-medium text-xs sm:text-sm transition-colors">
                  Về trang chủ ATI
                </a>
              </div>
            </section>
            {/* ========================================== */}
            {/* MÀN 7: GOOGLE — ĐÃ DUYỆT (CHUYỂN VÀO STAGE) */}
            {/* ========================================== */}
            <section id="view-google-ready" className={viewClass('google-ready')} aria-labelledby="title-google-ready">
              <div className="text-center v3-space-y-3">
                <div className="w-14 h-14 rounded-2xl bg-white border border-[#E7E7E2] flex items-center justify-center mx-auto shadow-sm relative">
                  <svg className="w-7 h-7" viewBox="0 0 24 24">
                    {' '}
                    <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z" />
                    {' '}
                    <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.34 24 12 24z" />
                    {' '}
                    <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z" />
                    {' '}
                    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z" />
                    {' '}
                  </svg>
                  {/* Spinner nhỏ góc */}
                  <span className="absolute -top-1 -right-1 flex h-4 w-4">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#16A34A] opacity-75" />
                    <span className="relative inline-flex rounded-full h-4 w-4 bg-[#16A34A] text-[9px] text-white font-bold items-center justify-center">
                      ✓
                    </span>
                  </span>
                </div>
                <div>
                  <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider bg-[#16A34A]/10 text-[#16A34A] mb-2">
                    {" Đăng nhập thành công "}
                  </span>
                  {' '}
                  <h1 id="title-google-ready" className="font-display font-semibold text-2xl sm:text-[26px] text-[#111827] tracking-tight">
                    Đang vào không gian làm việc…
                  </h1>
                </div>
                <p className="text-sm text-[#4B5563] leading-relaxed max-w-md mx-auto">
                  {"Chào mừng bạn quay lại, "}
                  <strong className="text-[#111827] font-semibold user-name-placeholder">
                    {user.name}
                  </strong>
                  !
                </p>
              </div>
              {/* Trạng thái chuyển trang */}
              <div className="bg-[#F8F8F6] border border-[#E7E7E2] rounded-2xl p-6 flex items-center justify-center gap-3 text-sm font-medium text-[#4B5563]">
                <svg className="w-4 h-4 text-[#FF5701] animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {' '}
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  {' '}
                </svg>
                <span>
                  Đang vào không gian làm việc…
                </span>
              </div>
              {/* Nút chuyển ngay không cần chờ */}
              <div className="v3-space-y-2.5 pt-1">
                <a href="/app-stage" className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-[#FF5701] hover:bg-[#E04C00] text-white font-medium text-sm transition-colors shadow-sm focus-visible:v3-outline-none">
                  <span>
                    Vào ngay
                  </span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </a>
              </div>
            </section>
            {/* ========================================== */}
            {/* MÀN 8: GOOGLE — LỖI HOẶC HUỶ PHIÊN */}
            {/* ========================================== */}
            <section id="view-google-error" className={viewClass('google-error')} aria-labelledby="title-google-error">
              <div className="text-center v3-space-y-3">
                <div className="w-14 h-14 rounded-2xl bg-[#DC2626]/10 text-[#DC2626] flex items-center justify-center mx-auto shadow-sm">
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div>
                  <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider bg-[#DC2626]/10 text-[#DC2626] mb-2">
                    {" Chưa hoàn tất "}
                  </span>
                  {' '}
                  <h1 id="title-google-error" className="font-display font-semibold text-2xl sm:text-[26px] text-[#111827] tracking-tight">
                    Đăng nhập Google chưa hoàn tất
                  </h1>
                </div>
                <p className="text-sm text-[#4B5563] leading-relaxed max-w-md mx-auto">
                  Phiên xác thực với Google đã bị huỷ hoặc quyền truy cập chưa được cấp. Không có dữ liệu nào của bạn bị thay đổi.
                </p>
              </div>
              <div className="bg-[#F8F8F6] border border-[#E7E7E2] rounded-2xl p-4 text-xs text-[#4B5563] v3-space-y-1.5">
                <div className="font-semibold text-[#111827]">
                  Bạn có thể chọn một trong các cách sau:
                </div>
                <ul className="list-disc list-inside v3-space-y-1 text-[#6B7280]">
                  <li>
                    Bấm thử lại để kết nối lại tài khoản Google.
                  </li>
                  <li>
                    Đăng nhập bằng Email và Mật khẩu truyền thống.
                  </li>
                  <li>
                    Quay về trang chủ nếu bạn chưa muốn đăng nhập lúc này.
                  </li>
                </ul>
              </div>
              <div className="v3-space-y-2.5 pt-1">
                <button type="button" onClick={() => actions.setMode('google-ready')} className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-[#FF5701] hover:bg-[#E04C00] text-white font-medium text-sm transition-colors shadow-sm focus-visible:v3-outline-none">
                  <span>
                    Thử lại với Google
                  </span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
                <a href="/" className="w-full flex items-center justify-center py-2.5 px-4 rounded-xl border border-[#E7E7E2] hover:bg-neutral-50 text-[#4B5563] hover:text-[#111827] font-medium text-xs sm:text-sm transition-colors">
                  Đăng nhập bằng Email &amp; Mật khẩu
                </a>
              </div>
            </section>
            {/* ========================================== */}
            {/* MÀN 9: ĐĂNG NHẬP BỊ CHẶN — ĐANG CHỜ DUYỆT */}
            {/* ========================================== */}
            <section id="view-blocked-pending" className={viewClass('blocked-pending')} aria-labelledby="title-blocked-pending">
              <div className="text-center v3-space-y-3">
                <div className="w-14 h-14 rounded-2xl bg-[#FEF3C7] border border-[#FDE68A] text-[#D97706] flex items-center justify-center mx-auto shadow-sm">
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {' '}
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    {' '}
                  </svg>
                </div>
                <div>
                  <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider bg-[#D97706]/10 text-[#D97706] mb-2">
                    {" Đăng nhập tạm thời bị chặn · Đang chờ duyệt "}
                  </span>
                  {' '}
                  <h1 id="title-blocked-pending" className="font-display font-semibold text-2xl sm:text-[26px] text-[#111827] tracking-tight">
                    Tài khoản đang chờ duyệt
                  </h1>
                </div>
                <p className="text-sm text-[#4B5563] leading-relaxed max-w-md mx-auto">
                  {"Tài khoản "}
                  <strong className="text-[#111827] font-semibold user-email-placeholder">
                    {user.email}
                  </strong>
                  {" đã được xác minh nhưng chưa được kích hoạt vào không gian làm việc."}
                </p>
              </div>
              {/* Thẻ giải thích lý do và quy trình */}
              <div className="bg-[#F8F8F6] border border-[#E7E7E2] rounded-2xl p-5 v3-space-y-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#111827]">
                  <svg className="w-4 h-4 text-[#D97706]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  <span>
                    Quy trình bảo vệ không gian làm việc
                  </span>
                </div>
                <p className="text-xs text-[#4B5563] leading-relaxed">
                  {"ATI điều phối trực tiếp các công cụ dùng chung của nhóm (Trello, Slack, GitHub, Google Sheets). Để bảo đảm an toàn dữ liệu, tài khoản cần được "}
                  <strong className="text-[#111827]">
                    Quản trị viên nhóm xem xét và phê duyệt
                  </strong>
                  {" trước khi đăng nhập."}
                </p>
                {/* Tiến trình 3 bước trực quan */}
                <div className="pt-2 border-t border-[#E7E7E2] v3-space-y-2 text-xs">
                  <div className="flex items-center justify-between text-[#16A34A] bg-white p-2.5 rounded-xl border border-[#E7E7E2]">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-[#16A34A]/10 flex items-center justify-center font-bold text-[11px]">
                        ✓
                      </span>
                      <span className="font-medium text-[#111827]">
                        1. Đăng ký &amp; xác thực email
                      </span>
                    </div>
                    <span className="text-[11px] font-semibold text-[#16A34A]">
                      Đã xong
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[#D97706] bg-[#FFFBEB] p-2.5 rounded-xl border border-[#FDE68A]">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-[#D97706]/10 flex items-center justify-center font-bold text-[11px]">
                        ⏳
                      </span>
                      <span className="font-medium text-[#B45309]">
                        2. Quản trị viên duyệt tài khoản
                      </span>
                    </div>
                    <span className="text-[11px] font-semibold text-[#D97706]">
                      Đang chờ duyệt
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[#9CA3AF] bg-white/60 p-2.5 rounded-xl border border-[#E7E7E2]">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-neutral-100 flex items-center justify-center font-bold text-[11px] text-[#9CA3AF]">
                        3
                      </span>
                      <span className="font-medium text-[#6B7280]">
                        3. Nhận email thông báo &amp; vào làm việc
                      </span>
                    </div>
                    <span className="text-[11px] text-[#9CA3AF]">
                      Chờ kích hoạt
                    </span>
                  </div>
                </div>
              </div>
              {/* Nút hành động */}
              <div className="v3-space-y-2.5 pt-1">
                <a href="/" className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-[#FF5701] hover:bg-[#E04C00] text-white font-medium text-sm transition-colors shadow-sm focus-visible:v3-outline-none">
                  <span>
                    Thử đăng nhập lại
                  </span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </a>
                <a href="/" className="w-full flex items-center justify-center py-2.5 px-4 rounded-xl border border-[#E7E7E2] hover:bg-neutral-50 text-[#4B5563] hover:text-[#111827] font-medium text-xs sm:text-sm transition-colors">
                  ← Về trang chủ ATI
                </a>
              </div>
            </section>
            {/* ========================================== */}
            {/* MÀN 10: ĐĂNG NHẬP BỊ CHẶN — TÀI KHOẢN BỊ KHÓA */}
            {/* ========================================== */}
            <section id="view-blocked-locked" className={viewClass('blocked-locked')} aria-labelledby="title-blocked-locked">
              <div className="text-center v3-space-y-3">
                <div className="w-14 h-14 rounded-2xl bg-[#FEE2E2] border border-[#FECACA] text-[#DC2626] flex items-center justify-center mx-auto shadow-sm">
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {' '}
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    {' '}
                  </svg>
                </div>
                <div>
                  <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider bg-[#DC2626]/10 text-[#DC2626] mb-2">
                    {" Đăng nhập bị từ chối · Tài khoản bị khóa "}
                  </span>
                  {' '}
                  <h1 id="title-blocked-locked" className="font-display font-semibold text-2xl sm:text-[26px] text-[#111827] tracking-tight">
                    Tài khoản đã bị tạm khóa
                  </h1>
                </div>
                <p className="text-sm text-[#4B5563] leading-relaxed max-w-md mx-auto">
                  {"Quyền truy cập của "}
                  <strong className="text-[#111827] font-semibold user-email-placeholder">
                    {user.email}
                  </strong>
                  {" vào không gian làm việc ATI đã bị tạm dừng bởi quản trị viên."}
                </p>
              </div>
              {/* Chi tiết về việc khóa */}
              <div className="bg-[#F8F8F6] border border-[#E7E7E2] rounded-2xl p-5 v3-space-y-3.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#DC2626]">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>
                    Thông tin an toàn tài khoản
                  </span>
                </div>
                <div className="v3-space-y-2 pt-2 border-t border-[#E7E7E2] text-xs text-[#4B5563]">
                  <div className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#DC2626] mt-1.5 flex-shrink-0" />
                    <span>
                      Mọi phiên đăng nhập trước đó trên các thiết bị đã được tự động thu hồi.
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#DC2626] mt-1.5 flex-shrink-0" />
                    <span>
                      Các yêu cầu tự động trên Trello, Slack, GitHub dưới tên tài khoản này đều bị từ chối.
                    </span>
                  </div>
                </div>
                <div className="pt-3 border-t border-[#E7E7E2] text-xs text-[#4B5563] flex items-center gap-2">
                  <svg className="w-4 h-4 text-[#FF5701] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {' '}
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    {' '}
                  </svg>
                  <span>
                    Hãy liên hệ quản trị viên của nhóm để được mở khoá.
                  </span>
                </div>
              </div>
              {/* Nút hành động */}
              <div className="v3-space-y-2.5 pt-1">
                <a href="/" className="w-full flex items-center justify-center py-2.5 px-4 rounded-xl border border-[#E7E7E2] hover:bg-neutral-50 text-[#111827] font-medium text-xs sm:text-sm transition-colors">
                  Đăng nhập bằng tài khoản khác
                </a>
                <a href="/" className="w-full flex items-center justify-center py-2 px-4 text-[#6B7280] hover:text-[#111827] font-medium text-xs transition-colors">
                  Quay về trang chủ ATI
                </a>
              </div>
            </section>
            {/* ========================================== */}
            {/* MÀN 11: ĐĂNG NHẬP BỊ CHẶN — SAI MẬT KHẨU NHIỀU LẦN */}
            {/* ========================================== */}
            <section id="view-blocked-attempts" className={viewClass('blocked-attempts')} aria-labelledby="title-blocked-attempts">
              <div className="text-center v3-space-y-3">
                <div className="w-14 h-14 rounded-2xl bg-[#FFEDD5] border border-[#FED7AA] text-[#EA580C] flex items-center justify-center mx-auto shadow-sm">
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {' '}
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    {' '}
                  </svg>
                </div>
                <div>
                  <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider bg-[#EA580C]/10 text-[#EA580C] mb-2">
                    {" Bảo vệ tài khoản · Tạm khóa 15 phút "}
                  </span>
                  {' '}
                  <h1 id="title-blocked-attempts" className="font-display font-semibold text-2xl sm:text-[26px] text-[#111827] tracking-tight">
                    Sai mật khẩu quá nhiều lần
                  </h1>
                </div>
                <p className="text-sm text-[#4B5563] leading-relaxed max-w-md mx-auto">
                  {"Tài khoản "}
                  <strong className="text-[#111827] font-semibold user-email-placeholder">
                    {user.email}
                  </strong>
                  {" đã nhập sai mật khẩu "}
                  <span className="font-semibold text-[#DC2626]">
                    5 lần liên tiếp
                  </span>
                  . Đăng nhập tạm thời bị khóa để ngăn ngừa tấn công dò mật khẩu.
                </p>
              </div>
              {/* Đồng hồ đếm ngược trực quan */}
              <div className="bg-[#F8F8F6] border border-[#E7E7E2] rounded-2xl p-5 v3-space-y-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#4B5563]">
                    Thời gian tự động mở khóa:
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[#EA580C]/10 text-[#EA580C]">
                    Tự mở khóa
                  </span>
                </div>
                <div className="text-center py-3 bg-white rounded-xl border border-[#E7E7E2]">
                  <div id="blocked-timer-display" className={`font-mono font-bold text-3xl sm:text-4xl text-[#111827] tracking-wider${blockedDone ? ' text-[#16A34A]' : ''}`}>
                    {blockedText}
                  </div>
                  <p className="text-[11px] text-[#6B7280] mt-1">
                    phút : giây
                  </p>
                </div>
                <div className="w-full h-2 bg-[#E7E7E2] rounded-full overflow-hidden">
                  <div id="blocked-timer-bar" className="h-full bg-[#EA580C] rounded-full transition-all duration-1000" style={{ width: blockedWidth }} />
                </div>
                <p className="text-[11px] text-[#6B7280] text-center">
                  Sau khi hết thời gian đếm ngược, bạn có thể thử nhập lại mật khẩu bình thường.
                </p>
              </div>
              {/* Hộp giải pháp đặt lại mật khẩu */}
              <div className="bg-[#FFF7ED] border border-[#FED7AA] rounded-2xl p-4 sm:p-5 v3-space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#9A3412]">
                  <svg className="w-4 h-4 text-[#EA580C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                  </svg>
                  <span>
                    Bạn quên mật khẩu?
                  </span>
                </div>
                <p className="text-xs text-[#9A3412] leading-relaxed">
                  Bạn vẫn có thể đặt lại mật khẩu qua email ngay bây giờ, nhưng cần chờ hết thời gian trên rồi mới đăng nhập lại được.
                </p>
                <button type="button" onClick={() => actions.setMode('reset-password')} className="w-full py-2.5 px-4 bg-[#FF5701] hover:bg-[#E04C00] text-white text-xs font-semibold rounded-xl shadow-sm transition-colors flex items-center justify-center gap-2 focus-visible:v3-outline-none">
                  <span>
                    Đặt lại mật khẩu mới qua email
                  </span>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </button>
              </div>
              {/* Nút hành động phụ */}
              <div className="v3-space-y-2 pt-1 text-center">
                <a href="/" className="inline-block text-xs font-medium text-[#4B5563] hover:text-[#111827] hover:underline">
                  {" ← Quay lại trang đăng nhập (thử lại sau) "}
                </a>
              </div>
            </section>
          </div>
          {/* Chân trang nhỏ */}
          <footer className="mt-8 text-center text-xs text-[#9CA3AF] v3-space-y-2">
            <p>
              ATI — AI Workflow Automation Platform · 2026 · Xác thực tài khoản và phân quyền quản trị
            </p>
            <div className="flex items-center justify-center gap-3 text-xs text-[#6B7280]">
              <a href="/" className="hover:text-[#111827] transition-colors">
                Trang chủ
              </a>
              <span className="text-[#D1D5DB]">
                ·
              </span>
              <a href="/privacy" className="text-[#FF5701] hover:underline font-medium transition-colors">
                Chính sách an toàn &amp; Dữ liệu
              </a>
            </div>
          </footer>
        </div>
      </main>
      {/* JAVASCRIPT ĐIỀU KHIỂN */}
    </>
  );
}
