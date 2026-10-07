// Chuyển từ docs/design/prototypes/account.html bằng scripts/html-to-jsx.mjs, sau đó sửa tay.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { usePrototypePage, type PageMeta } from '../../app/usePrototypePage';
import css from './page.css?inline';

type Role = 'admin' | 'member';
type ToastType = 'info' | 'error' | 'warn';
type Toast = { id: number; message: string; type: ToastType; phase: 'enter' | 'shown' | 'leaving' };
type ModalId = 'modal-revoke-all' | 'modal-unlink-google';
type SessionId = 'mobile' | 'macos';
// Thẻ phiên khác: recreated là thẻ resetAccountDemoData dựng lại (nút không có title); leaving là lúc mờ dần trước khi gỡ.
type SessionCardState = { id: SessionId; recreated: boolean; leaving: boolean };
type AccountState = { fullName: string; email: string; role: Role; googleLinked: boolean; hasPassword: boolean; googleEmail: string; otherSessionsCount: number };
// Thanh độ mạnh mật khẩu: width là style.width (undefined khi chưa ghi), các class đổi theo checkPasswordStrength.
type Strength = { width?: string; barClass: string; label: string; labelClass: string };

const INITIAL_ACCOUNT: AccountState = {
  fullName: 'Lan Nguyễn',
  email: 'lan.nguyen@congty.vn',
  role: 'admin',
  googleLinked: true,
  hasPassword: true,
  googleEmail: 'lan.nguyen@congty.vn',
  otherSessionsCount: 2,
};
const ROLE_ON = 'px-2.5 py-1.5 rounded-md text-xs font-medium text-white bg-[#FF5701] shadow-sm transition-all';
const ROLE_OFF = 'px-2.5 py-1.5 rounded-md text-xs font-medium text-[#4B5563] hover:text-[#111827] transition-all';
const AUTH_ON = 'w-full text-left px-2.5 py-1.5 rounded-md text-xs font-semibold text-white bg-[#FF5701] shadow-sm transition-all';
const AUTH_OFF = 'w-full text-left px-2.5 py-1.5 rounded-md text-xs font-medium text-[#4B5563] hover:text-[#111827] hover:bg-[#F0F0EB] transition-all';
const UNLINK_ON = 'px-4 py-2 min-h-[40px] text-xs sm:text-sm font-semibold text-red-600 hover:text-red-700 bg-white hover:bg-red-50 border border-red-200 rounded-xl transition-colors flex-shrink-0 self-start sm:self-center';
const UNLINK_LOCKED = 'px-4 py-2 min-h-[40px] text-xs sm:text-sm font-semibold text-neutral-400 bg-neutral-100 border border-[#E7E7E2] rounded-xl cursor-not-allowed flex-shrink-0 self-start sm:self-center';
const TOAST_BASE = 'px-4 py-2.5 rounded-xl bg-[#111827] text-white text-xs sm:text-sm font-medium shadow-xl border border-neutral-700 flex items-center gap-2 pointer-events-auto transition-all duration-200 v3-transform';
const TOAST_PHASE = { enter: 'translate-y-2 opacity-0', shown: '', leaving: 'opacity-0 -translate-y-1' };
const TOAST_DOT: Record<ToastType, string> = { info: 'bg-[#16A34A]', error: 'bg-red-500', warn: 'bg-amber-500' };
const STRENGTH_EMPTY: Strength = { barClass: 'h-full bg-neutral-400 w-0 transition-all duration-300', label: 'Ít nhất 12 ký tự', labelClass: 'text-xs font-medium text-[#6B7280]' };
const SESSION_INFO: Record<SessionId, { name: string; lastActive: string; icon: string }> = {
  mobile: { name: 'Safari trên iPhone 15 Pro', lastActive: 'Hoạt động lần cuối: 2 giờ trước', icon: 'M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z' },
  macos: { name: 'Firefox trên macOS Sonoma', lastActive: 'Hoạt động lần cuối: 3 ngày trước', icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
};
const INITIAL_CARDS: SessionCardState[] = [{ id: 'mobile', recreated: false, leaving: false }, { id: 'macos', recreated: false, leaving: false }];

function getInitials(name: string) {
  if (!name) return 'ATI';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Hai biểu tượng mắt trong nút ẩn/hiện mật khẩu (togglePasswordVisibility).
function EyeIcons({ visible }: { visible: boolean }) {
  return <>
    <svg className={`w-4 h-4 eye-icon-show${visible ? ' hidden' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
    <svg className={`w-4 h-4 eye-icon-hide${visible ? '' : ' hidden'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
    </svg>
  </>;
}

// Thẻ phiên trên thiết bị khác (Safari trên iPhone, Firefox trên macOS).
function SessionCard({ card, onRevoke }: { card: SessionCardState; onRevoke: (id: SessionId, name: string) => void }) {
  const info = SESSION_INFO[card.id];
  return <div id={`session-card-${card.id}`} className="p-4 rounded-xl border border-[#E7E7E2] bg-white hover:border-[#D1D5DB] flex items-start justify-between gap-3 transition-all shadow-sm" style={card.leaving ? { opacity: 0, transform: 'scale(0.95)' } : undefined}>
    <div className="flex items-start gap-3.5 min-w-0">
      <div className="w-9 h-9 rounded-lg bg-[#F8F8F6] border border-[#E7E7E2] text-[#111827] flex items-center justify-center flex-shrink-0">
        <svg className="w-5 h-5 text-[#4B5563]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={info.icon} /></svg>
      </div>
      <div>
        <h3 className="text-sm font-bold text-[#111827]">{info.name}</h3>
        <p className="text-xs text-[#4B5563] mt-1"><span className="text-[#6B7280]">{info.lastActive}</span></p>
      </div>
    </div>
    <button type="button" onClick={() => onRevoke(card.id, info.name)} className="px-3 py-1.5 text-xs font-medium text-[#4B5563] hover:text-red-600 bg-[#F8F8F6] hover:bg-red-50 rounded-lg border border-[#E7E7E2] hover:border-red-200 transition-colors flex-shrink-0" title={card.recreated ? undefined : 'Đăng xuất thiết bị này'}>
      Thu hồi
    </button>
  </div>;
}

export const meta: PageMeta = {
  id: "account",
  title: "Tài khoản của bạn — ATI",
  htmlClass: "",
  bodyClass: "min-h-screen flex flex-col bg-[#F8F8F6] text-[#111827]",
  css,
};

export function AccountPage() {
  usePrototypePage(meta);
  // accountState của bản mẫu; giao diện chỉ đổi khi gọi renderAccountState / updateSessionsSummary.
  const model = useRef<AccountState>({ ...INITIAL_ACCOUNT });
  const [view, setView] = useState<AccountState>(INITIAL_ACCOUNT);
  // Nút gỡ Google chỉ được cập nhật khi đang liên kết (khối chưa liên kết giữ nguyên trạng thái cũ của nút).
  const [unlinkLocked, setUnlinkLocked] = useState(false);
  const [sessionCount, setSessionCount] = useState(INITIAL_ACCOUNT.otherSessionsCount);
  const [cards, setCards] = useState<SessionCardState[]>(INITIAL_CARDS);
  const [strength, setStrength] = useState<Strength>(STRENGTH_EMPTY);
  const [shownPasswords, setShownPasswords] = useState<string[]>([]);
  const [linking, setLinking] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [openModals, setOpenModals] = useState<ModalId[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const fullNameRef = useRef<HTMLInputElement>(null);
  const currentPassRef = useRef<HTMLInputElement>(null);
  const newPassRef = useRef<HTMLInputElement>(null);
  const confirmPassRef = useRef<HTMLInputElement>(null);
  const unlinkPassRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const cardsRef = useRef<SessionCardState[]>(INITIAL_CARDS);
  const toastId = useRef(0);
  const timers = useRef<number[]>([]);
  const later = (ms: number, run: () => void) => { timers.current.push(window.setTimeout(run, ms)); };
  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);

  const showToast = (message: string, type: ToastType = 'info') => {
    const id = ++toastId.current;
    setToasts(items => [...items, { id, message, type, phase: 'enter' }]);
    requestAnimationFrame(() => setToasts(items => items.map(t => (t.id === id ? { ...t, phase: 'shown' } : t))));
    later(3500, () => {
      setToasts(items => items.map(t => (t.id === id ? { ...t, phase: 'leaving' } : t)));
      later(200, () => setToasts(items => items.filter(t => t.id !== id)));
    });
  };
  const updateCards = (next: SessionCardState[]) => {
    cardsRef.current = next;
    setCards(next);
  };
  const updateSessionsSummary = () => setSessionCount(model.current.otherSessionsCount);
  const renderAccountState = () => {
    const s = model.current;
    if (fullNameRef.current) fullNameRef.current.value = s.fullName;
    setView({ ...s });
    if (s.googleLinked) setUnlinkLocked(!s.hasPassword);
    updateSessionsSummary();
  };
  const closeModal = (id: ModalId) => setOpenModals(list => list.filter(m => m !== id));
  const removeOtherSessions = () => updateCards([]);
  const actions = {
    toggleDemoDropdown() { setMenuOpen(open => !open); },
    setRole(role: Role) {
      model.current.role = role;
      renderAccountState();
      showToast(`Đã chuyển vai trò xem sang: ${role === 'admin' ? 'Quản trị viên' : 'Thành viên'}`);
    },
    setAuthScenario(scenario: string) {
      const s = model.current;
      if (scenario === 'google_only') {
        s.googleLinked = true;
        s.hasPassword = false;
        showToast('Demo: Tài khoản chỉ đăng nhập bằng Google (chưa có mật khẩu)');
      } else if (scenario === 'unlinked') {
        s.googleLinked = false;
        s.hasPassword = true;
        showToast('Demo: Đã chuyển sang Chưa liên kết Google');
      } else {
        s.googleLinked = true;
        s.hasPassword = true;
        showToast('Demo: Tài khoản đã liên kết Google và có mật khẩu');
      }
      renderAccountState();
    },
    resetAccountDemoData() {
      Object.assign(model.current, { fullName: 'Lan Nguyễn', role: 'admin', googleLinked: true, hasPassword: true, otherSessionsCount: 2 });
      // Dựng lại thẻ phiên đã bị gỡ, chèn trước khung "chỉ còn phiên hiện tại" (thẻ còn lại giữ nguyên chỗ).
      const next = [...cardsRef.current];
      for (const id of ['mobile', 'macos'] as const) {
        if (!next.some(c => c.id === id)) next.push({ id, recreated: true, leaving: false });
      }
      updateCards(next);
      renderAccountState();
      showToast('Đã đặt lại dữ liệu tài khoản về mặc định.');
    },
    handleUpdateProfile(event: FormEvent) {
      event.preventDefault();
      const newName = (fullNameRef.current?.value ?? '').trim();
      if (!newName) {
        showToast('Vui lòng nhập họ và tên hợp lệ.', 'error');
        return;
      }
      model.current.fullName = newName;
      renderAccountState();
      showToast('Đã lưu thay đổi họ và tên thành công!');
    },
    handleChangePassword(event: FormEvent) {
      event.preventDefault();
      const currentPass = currentPassRef.current?.value ?? '';
      const newPass = newPassRef.current?.value ?? '';
      const confirmPass = confirmPassRef.current?.value ?? '';
      if (!currentPass) {
        showToast('Vui lòng nhập mật khẩu hiện tại.', 'error');
        return;
      }
      if (newPass.length < 12) {
        showToast('Mật khẩu mới phải có ít nhất 12 ký tự.', 'error');
        return;
      }
      if (newPass !== confirmPass) {
        showToast('Mật khẩu xác nhận không khớp. Vui lòng kiểm tra lại.', 'error');
        return;
      }
      if (newPass === currentPass) {
        showToast('Mật khẩu mới không được trùng với mật khẩu hiện tại.', 'warn');
        return;
      }
      // Mô phỏng thành công: các phiên khác bị đăng xuất, thiết bị này giữ đăng nhập.
      removeOtherSessions();
      model.current.otherSessionsCount = 0;
      updateSessionsSummary();
      for (const ref of [currentPassRef, newPassRef, confirmPassRef]) if (ref.current) ref.current.value = '';
      // Bản mẫu chỉ đặt lại độ rộng thanh và chữ, giữ nguyên màu của lần kiểm tra trước.
      setStrength(s => ({ ...s, width: '0%', label: 'Ít nhất 12 ký tự' }));
      showToast('Đổi mật khẩu thành công! Sau khi đổi mật khẩu, các thiết bị khác sẽ bị đăng xuất và các link đặt lại mật khẩu cũ hết hiệu lực. Thiết bị này vẫn giữ đăng nhập.');
    },
    checkPasswordStrength(val: string) {
      if (!val) {
        setStrength({ ...STRENGTH_EMPTY, width: '0%' });
        return;
      }
      let score = 0;
      if (val.length >= 12) score += 2;
      if (/[A-Z]/.test(val)) score += 1;
      if (/[0-9]/.test(val)) score += 1;
      if (/[^A-Za-z0-9]/.test(val)) score += 1;
      if (val.length < 12) {
        setStrength({ width: '30%', barClass: 'h-full bg-red-500 transition-all duration-300', label: `Chưa đủ 12 ký tự (${val.length}/12)`, labelClass: 'text-xs font-medium text-red-600' });
      } else if (score <= 3) {
        setStrength({ width: '65%', barClass: 'h-full bg-amber-500 transition-all duration-300', label: 'Độ mạnh: Khá tốt (12+ ký tự)', labelClass: 'text-xs font-medium text-amber-600' });
      } else {
        setStrength({ width: '100%', barClass: 'h-full bg-emerald-600 transition-all duration-300', label: 'Độ mạnh: Rất an toàn', labelClass: 'text-xs font-medium text-emerald-600' });
      }
    },
    togglePasswordVisibility(inputId: string) {
      setShownPasswords(list => (list.includes(inputId) ? list.filter(id => id !== inputId) : [...list, inputId]));
    },
    revokeSingleSession(cardId: SessionId, deviceName: string) {
      if (!cardsRef.current.some(c => c.id === cardId)) return;
      updateCards(cardsRef.current.map(c => (c.id === cardId ? { ...c, leaving: true } : c)));
      later(200, () => {
        updateCards(cardsRef.current.filter(c => c.id !== cardId));
        model.current.otherSessionsCount = Math.max(0, model.current.otherSessionsCount - 1);
        updateSessionsSummary();
        showToast(`Đã thu hồi phiên trên ${deviceName}`);
      });
    },
    promptRevokeAllOtherSessions() { setOpenModals(list => (list.includes('modal-revoke-all') ? list : [...list, 'modal-revoke-all'])); },
    confirmRevokeAllOtherSessions() {
      closeModal('modal-revoke-all');
      removeOtherSessions();
      model.current.otherSessionsCount = 0;
      updateSessionsSummary();
      showToast('Đã đăng xuất khỏi tất cả các phiên thiết bị khác!');
    },
    promptUnlinkGoogleModal() {
      if (!model.current.hasPassword) {
        showToast('Tài khoản này chưa có mật khẩu. Để gỡ Google, hãy đặt mật khẩu trước bằng Quên mật khẩu.', 'warn');
        return;
      }
      if (unlinkPassRef.current) unlinkPassRef.current.value = '';
      setOpenModals(list => (list.includes('modal-unlink-google') ? list : [...list, 'modal-unlink-google']));
      later(100, () => unlinkPassRef.current?.focus());
    },
    confirmUnlinkGoogle() {
      const passInput = unlinkPassRef.current;
      if (!passInput || !passInput.value.trim()) {
        showToast('Vui lòng nhập mật khẩu hiện tại để xác nhận gỡ liên kết.', 'error');
        passInput?.focus();
        return;
      }
      passInput.value = '';
      closeModal('modal-unlink-google');
      model.current.googleLinked = false;
      model.current.hasPassword = true;
      renderAccountState();
      showToast('Đã gỡ liên kết với tài khoản Google.');
    },
    triggerLinkGoogleFlow() {
      setLinking(true);
      later(700, () => {
        setLinking(false);
        model.current.googleLinked = true;
        model.current.hasPassword = true;
        renderAccountState();
        showToast('Đã liên kết thành công tài khoản Google (lan.nguyen@congty.vn)!');
      });
    },
    closeModal,
  };

  // Esc đóng hai hộp thoại và menu demo; bấm ngoài menu demo thì đóng.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpenModals([]);
      setMenuOpen(false);
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !menuButtonRef.current?.contains(target)) setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('click', onClick); };
  }, []);

  const initials = getInitials(view.fullName);
  const isAdmin = view.role === 'admin';
  const roleName = isAdmin ? 'Quản trị viên' : 'Thành viên';
  const googleOnly = view.googleLinked && !view.hasPassword;
  const authActive = !view.googleLinked ? 'unlinked' : !view.hasPassword ? 'google_only' : 'standard';
  const passType = (id: string) => (shownPasswords.includes(id) ? 'text' : 'password');
  const modalClass = (id: ModalId) => `${openModals.includes(id) ? '' : 'hidden '}fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm`;
  return (
    <>
      {/* Toast Thông báo nổi */}
      <div id="toast-container" className="fixed top-5 left-1/2 -translate-x-1/2 z-50 pointer-events-none flex flex-col items-center gap-2" role="status" aria-live="polite">
        {toasts.map(toast => (
          <div key={toast.id} className={`${TOAST_BASE} ${TOAST_PHASE[toast.phase]}`.trim()}>
            <span className={`w-2 h-2 rounded-full ${TOAST_DOT[toast.type]} flex-shrink-0`} />
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
            <a href="/app-stage" className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-[#4B5563] hover:text-[#111827] transition-colors py-1 px-2 rounded-lg hover:bg-black/5 flex-shrink-0" title="Quay lại không gian làm việc" aria-label="Quay lại không gian làm việc">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              <span className="hidden sm:inline">
                Về không gian làm việc
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
            <a href="/settings" className="hidden md:inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-[#4B5563] hover:text-[#111827] transition-colors py-1 px-2 rounded-lg hover:bg-black/5" title="Mở trang Kết nối dịch vụ">
              <svg className="w-4 h-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
              {' '}
              <span>
                Kết nối dịch vụ
              </span>
            </a>
          </div>
          {/* Cụm Trạng thái Vai trò & Điều khiển Demo */}
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            {/* Nhãn vai trò hiện tại */}
            <div id="role-pill-badge" className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-white border border-[#E7E7E2] text-[#4B5563] shadow-sm">
              <span className="w-2 h-2 rounded-full bg-[#16A34A]" id="role-indicator-dot" />
              {' '}
              <span id="header-role-display">
                {roleName}
              </span>
            </div>
            {/* Avatar người dùng nhanh */}
            <div className="w-8 h-8 rounded-full bg-[#FF5701] text-white text-xs font-bold flex items-center justify-center shadow-sm flex-shrink-0" id="header-avatar-badge" title="Tài khoản Lan Nguyễn">
              {initials}
            </div>
            {/* Nút Kịch bản demo */}
            <div className="relative inline-block text-left">
              {' '}
              <button ref={menuButtonRef} id="btn-toggle-demo-menu" type="button" className="inline-flex items-center gap-1.5 px-2 sm:px-3 py-1.5 text-xs font-medium text-[#111827] bg-white hover:bg-neutral-100 rounded-lg border border-[#E7E7E2] shadow-sm transition-colors flex-shrink-0" aria-haspopup="true" aria-expanded={menuOpen ? 'true' : 'false'} onClick={() => actions.toggleDemoDropdown()}>
                <svg className="w-3.5 h-3.5 text-[#FF5701]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="hidden sm:inline">
                  Kịch bản demo
                </span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#FF5701]/10 text-[#FF5701]">
                  DEMO
                </span>
              </button>
              {' '}
              {/* Menu chọn Kịch bản Demo */}
              {' '}
              <div ref={menuRef} id="demo-menu-dropdown" className={`${menuOpen ? '' : 'hidden '}absolute right-0 mt-2 w-72 max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-lg border border-[#E7E7E2] p-3 z-40 v3-space-y-3`} role="menu">
                <div>
                  <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider mb-1.5">
                    Xem giao diện như
                  </p>
                  <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#F8F8F6] rounded-lg border border-[#E7E7E2]">
                    <button type="button" id="demo-role-admin" className={isAdmin ? ROLE_ON : ROLE_OFF} onClick={() => actions.setRole('admin')}>
                      Quản trị viên
                    </button>
                    <button type="button" id="demo-role-member" className={isAdmin ? ROLE_OFF : ROLE_ON} onClick={() => actions.setRole('member')}>
                      Thành viên
                    </button>
                  </div>
                </div>
                <div className="border-t border-[#E7E7E2] pt-2.5">
                  <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider mb-1.5">
                    Tài khoản Google &amp; Mật khẩu
                  </p>
                  <div className="flex flex-col gap-1 p-1 bg-[#F8F8F6] rounded-lg border border-[#E7E7E2]">
                    <button type="button" id="demo-auth-standard" className={authActive === 'standard' ? AUTH_ON : AUTH_OFF} onClick={() => actions.setAuthScenario('standard')}>
                      {" Đã liên kết (Có mật khẩu) "}
                    </button>
                    <button type="button" id="demo-auth-google-only" className={authActive === 'google_only' ? AUTH_ON : AUTH_OFF} onClick={() => actions.setAuthScenario('google_only')}>
                      {" Chỉ Google (Chưa có mật khẩu) "}
                    </button>
                    <button type="button" id="demo-auth-unlinked" className={authActive === 'unlinked' ? AUTH_ON : AUTH_OFF} onClick={() => actions.setAuthScenario('unlinked')}>
                      {" Chưa liên kết Google "}
                    </button>
                  </div>
                </div>
                <div className="border-t border-[#E7E7E2] pt-2 flex items-center justify-between">
                  <span className="text-[11px] text-[#6B7280]">
                    Khôi phục mặc định:
                  </span>
                  <button type="button" onClick={() => actions.resetAccountDemoData()} className="text-[11px] text-[#FF5701] hover:underline font-medium">
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
        {/* Tiêu đề trang */}
        <div className="mb-8">
          <div className="flex items-center gap-2 text-xs text-[#6B7280] mb-2 font-medium">
            <a href="/app-stage" className="hover:text-[#111827] transition-colors">
              Không gian làm việc
            </a>
            <span>
              /
            </span>
            <span className="text-[#111827]">
              Tài khoản của bạn
            </span>
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-bold text-[#111827] tracking-tight">
            Cài đặt tài khoản
          </h1>
          <p className="text-sm sm:text-base text-[#4B5563] mt-2">
            Quản lý thông tin hồ sơ, bảo mật mật khẩu, các phiên thiết bị đang truy cập và liên kết tài khoản Google.
          </p>
        </div>
        {/* KHỐI TỔNG QUAN TÀI KHOẢN (PROFILE CARD) */}
        <div className="bg-white rounded-2xl p-5 sm:p-6 border border-[#E7E7E2] shadow-sm mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
          <div className="flex items-center gap-4">
            {/* Avatar tròn lớn */}
            <div id="profile-card-avatar" className="w-16 h-16 rounded-2xl bg-[#FF5701] text-white flex items-center justify-center font-display font-bold text-2xl shadow-sm flex-shrink-0">
              {initials}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 id="profile-card-name" className="font-display text-xl sm:text-2xl font-bold text-[#111827]">
                  {view.fullName}
                </h2>
                <span id="profile-card-role-badge" className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#FF5701]/10 text-[#FF5701] border border-[#FF5701]/20">
                  {roleName}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-1 text-xs sm:text-sm text-[#4B5563]">
                <span className="font-mono text-[#111827]">
                  lan.nguyen@congty.vn
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#16A34A] bg-[#16A34A]/10 px-2 py-0.5 rounded-full">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  {" Đã xác minh"}
                </span>
              </div>
            </div>
          </div>
          {/* Tóm tắt số thiết bị hoạt động */}
          <div className="w-full sm:w-auto bg-[#F8F8F6] rounded-xl px-4 py-3 border border-[#E7E7E2] flex items-center gap-2 text-xs text-[#4B5563] self-start sm:self-center">
            <span className="w-2 h-2 rounded-full bg-[#16A34A]" />
            <span id="summary-sessions-text">
              {`${sessionCount + 1} thiết bị đang hoạt động`}
            </span>
          </div>
        </div>
        {/* LƯỚI 4 PHẦN TÍNH NĂNG */}
        <div className="v3-space-y-8">
          {/* PHẦN 1: THÔNG TIN CÁ NHÂN & ĐỔI TÊN */}
          <section id="section-profile" className="bg-white rounded-2xl p-5 sm:p-7 border border-[#E7E7E2] shadow-sm" aria-labelledby="heading-profile">
            <div className="border-b border-[#E7E7E2] pb-4 mb-6">
              <h2 id="heading-profile" className="font-display text-xl sm:text-2xl font-bold text-[#111827]">
                1. Thông tin cá nhân
              </h2>
              <p className="text-xs sm:text-sm text-[#6B7280] mt-1">
                Cập nhật họ và tên hiển thị trên không gian làm việc và trong các kế hoạch phối hợp của nhóm.
              </p>
            </div>
            <form id="form-update-profile" onSubmit={(event) => actions.handleUpdateProfile(event)} className="v3-space-y-5 max-w-xl">
              {/* Trường Họ và tên */}
              <div>
                <label htmlFor="input-full-name" className="block text-xs sm:text-sm font-semibold text-[#111827] mb-1.5">
                  {"Họ và tên "}
                  <span className="text-[#FF5701]">
                    *
                  </span>
                </label>
                {' '}
                <input ref={fullNameRef} type="text" id="input-full-name" name="fullName" defaultValue="Lan Nguyễn" required className="w-full text-sm sm:text-base px-3.5 py-2.5 bg-white border border-[#E7E7E2] rounded-xl text-[#111827] placeholder-[#9CA3AF] focus:border-[#FF5701] focus:ring-1 focus:ring-[#FF5701] transition-all" placeholder="Nhập họ và tên đầy đủ" />
                {' '}
                <p className="text-xs text-[#6B7280] mt-1.5">
                  Tên này sẽ hiển thị ở góc thanh điều khiển và đại diện cho bạn khi duyệt các kế hoạch của ATI.
                </p>
              </div>
              {/* Trường Email (Khóa, chỉ hiển thị) */}
              <div>
                <label htmlFor="input-email-readonly" className="block text-xs sm:text-sm font-semibold text-[#111827] mb-1.5">
                  Địa chỉ email đăng nhập
                </label>
                <div className="relative">
                  <input type="email" id="input-email-readonly" defaultValue="lan.nguyen@congty.vn" readOnly className="w-full text-sm sm:text-base px-3.5 py-2.5 bg-[#F8F8F6] border border-[#E7E7E2] rounded-xl text-[#6B7280] font-mono cursor-not-allowed pr-28" />
                  {' '}
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-xs font-medium text-[#16A34A] bg-[#16A34A]/10 px-2 py-0.5 rounded-md">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    {" Xác minh"}
                  </div>
                </div>
                <p className="text-xs text-[#6B7280] mt-1.5">
                  Email dùng để đăng nhập và nhận thông báo phê duyệt từ quản trị viên. Để đổi email, vui lòng liên hệ quản trị viên nhóm.
                </p>
              </div>
              {/* Trường Vai trò tài khoản */}
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-[#111827] mb-1.5">
                  Vai trò trong nhóm
                </label>
                <div className="p-3.5 bg-[#F8F8F6] border border-[#E7E7E2] rounded-xl flex items-start gap-3">
                  <div className="w-7 h-7 rounded-lg bg-[#FF5701]/10 text-[#FF5701] flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  </div>
                  <div className="text-xs sm:text-sm">
                    <div className="font-semibold text-[#111827]" id="profile-role-title">
                      {isAdmin ? 'Quản trị viên (Admin)' : 'Thành viên (Member)'}
                    </div>
                    <div className="text-[#4B5563] mt-0.5 leading-relaxed" id="profile-role-description">
                      {isAdmin
                        ? 'Bạn có toàn quyền kết nối các dịch vụ mới của nhóm, chỉnh sửa nơi được phép dùng và phê duyệt thành viên mới.'
                        : 'Bạn có quyền sử dụng các công cụ đã được kết nối và kiểm tra tình trạng kết nối. Chỉ quản trị viên mới có quyền đổi khoá chung.'}
                    </div>
                  </div>
                </div>
              </div>
              {/* Nút Lưu họ tên */}
              <div className="pt-2">
                <button type="submit" id="btn-save-profile" className="inline-flex items-center justify-center gap-2 px-5 py-2.5 min-h-[44px] bg-[#FF5701] hover:bg-[#e04d00] text-white text-sm font-semibold rounded-xl shadow-sm transition-all focus:v3-outline-none">
                  <span>
                    Lưu thay đổi họ tên
                  </span>
                </button>
              </div>
            </form>
          </section>
          {/* PHẦN 2: ĐỔI MẬT KHẨU */}
          <section id="section-password" className="bg-white rounded-2xl p-5 sm:p-7 border border-[#E7E7E2] shadow-sm" aria-labelledby="heading-password">
            <div className="border-b border-[#E7E7E2] pb-4 mb-6">
              <h2 id="heading-password" className="font-display text-xl sm:text-2xl font-bold text-[#111827]">
                2. Đổi mật khẩu
              </h2>
              <p className="text-xs sm:text-sm text-[#6B7280] mt-1">
                Đặt mật khẩu an toàn ít nhất 12 ký tự để bảo vệ tài khoản điều phối của bạn.
              </p>
            </div>
            <form id="form-change-password" onSubmit={(event) => actions.handleChangePassword(event)} className={`v3-space-y-5 max-w-xl${googleOnly ? ' hidden' : ''}`}>
              {/* Mật khẩu hiện tại */}
              <div>
                <label htmlFor="input-current-pass" className="block text-xs sm:text-sm font-semibold text-[#111827] mb-1.5">
                  {"Mật khẩu hiện tại "}
                  <span className="text-[#FF5701]">
                    *
                  </span>
                </label>
                <div className="relative">
                  <input ref={currentPassRef} type={passType('input-current-pass')} id="input-current-pass" required className="w-full text-sm sm:text-base px-3.5 py-2.5 bg-white border border-[#E7E7E2] rounded-xl text-[#111827] placeholder-[#9CA3AF] focus:border-[#FF5701] focus:ring-1 focus:ring-[#FF5701] transition-all pr-10" placeholder="Nhập mật khẩu đang dùng" />
                  {' '}
                  <button type="button" onClick={() => actions.togglePasswordVisibility('input-current-pass')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#6B7280] hover:text-[#111827] p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg" aria-label="Ẩn hoặc hiện mật khẩu hiện tại">
                    <EyeIcons visible={shownPasswords.includes('input-current-pass')} />
                  </button>
                </div>
              </div>
              {/* Mật khẩu mới */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="input-new-pass" className="block text-xs sm:text-sm font-semibold text-[#111827]">
                    {"Mật khẩu mới "}
                    <span className="text-[#FF5701]">
                      *
                    </span>
                  </label>
                  <span id="pass-strength-indicator" className={strength.labelClass}>
                    {strength.label}
                  </span>
                </div>
                <div className="relative">
                  <input ref={newPassRef} type={passType('input-new-pass')} id="input-new-pass" minLength={12} required onInput={(event) => actions.checkPasswordStrength(event.currentTarget.value)} className="w-full text-sm sm:text-base px-3.5 py-2.5 bg-white border border-[#E7E7E2] rounded-xl text-[#111827] placeholder-[#9CA3AF] focus:border-[#FF5701] focus:ring-1 focus:ring-[#FF5701] transition-all pr-10" placeholder="Ít nhất 12 ký tự" />
                  {' '}
                  <button type="button" onClick={() => actions.togglePasswordVisibility('input-new-pass')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#6B7280] hover:text-[#111827] p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg" aria-label="Ẩn hoặc hiện mật khẩu mới">
                    <EyeIcons visible={shownPasswords.includes('input-new-pass')} />
                  </button>
                </div>
                {/* Thanh độ mạnh mật khẩu */}
                <div className="w-full bg-[#E7E7E2] h-1.5 rounded-full overflow-hidden mt-2">
                  <div id="pass-strength-bar" className={strength.barClass} style={strength.width === undefined ? undefined : { width: strength.width }} />
                </div>
              </div>
              {/* Xác nhận mật khẩu mới */}
              <div>
                <label htmlFor="input-confirm-pass" className="block text-xs sm:text-sm font-semibold text-[#111827] mb-1.5">
                  {"Xác nhận mật khẩu mới "}
                  <span className="text-[#FF5701]">
                    *
                  </span>
                </label>
                <div className="relative">
                  <input ref={confirmPassRef} type={passType('input-confirm-pass')} id="input-confirm-pass" minLength={12} required className="w-full text-sm sm:text-base px-3.5 py-2.5 bg-white border border-[#E7E7E2] rounded-xl text-[#111827] placeholder-[#9CA3AF] focus:border-[#FF5701] focus:ring-1 focus:ring-[#FF5701] transition-all pr-10" placeholder="Nhập lại đúng mật khẩu mới" />
                  {' '}
                  <button type="button" onClick={() => actions.togglePasswordVisibility('input-confirm-pass')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#6B7280] hover:text-[#111827] p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg" aria-label="Ẩn hoặc hiện mật khẩu xác nhận">
                    <EyeIcons visible={shownPasswords.includes('input-confirm-pass')} />
                  </button>
                </div>
              </div>
              {/* Thông báo lưu ý khi đổi mật khẩu */}
              <div className="p-3 bg-[#F8F8F6] border border-[#E7E7E2] rounded-xl text-xs text-[#4B5563] leading-relaxed">
                <strong className="text-[#111827] font-semibold">
                  Lưu ý an toàn:
                </strong>
                {" Sau khi đổi mật khẩu, các thiết bị khác sẽ bị đăng xuất và các link đặt lại mật khẩu cũ hết hiệu lực. Thiết bị này vẫn giữ đăng nhập."}
              </div>
              {/* Nút Đổi mật khẩu */}
              <div className="pt-2">
                <button type="submit" id="btn-submit-change-pass" className="inline-flex items-center justify-center gap-2 px-5 py-2.5 min-h-[44px] bg-[#111827] hover:bg-black text-white text-sm font-semibold rounded-xl shadow-sm transition-all focus:v3-outline-none">
                  <span>
                    Cập nhật mật khẩu mới
                  </span>
                </button>
              </div>
            </form>
            {/* Hướng dẫn khi tài khoản chỉ đăng nhập bằng Google (chưa có mật khẩu) */}
            <div id="password-google-only-guide" className={`${googleOnly ? '' : 'hidden '}max-w-xl p-5 bg-[#F8F8F6] border border-[#E7E7E2] rounded-2xl v3-space-y-4`}>
              <div className="flex items-start gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 border border-amber-200/60 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div className="v3-space-y-1">
                  <h3 className="font-bold text-sm text-[#111827]">
                    Tài khoản này chưa có mật khẩu
                  </h3>
                  <p className="text-xs sm:text-sm text-[#4B5563] leading-relaxed">
                    Tài khoản này chưa có mật khẩu. Để gỡ Google, hãy đặt mật khẩu trước bằng 'Quên mật khẩu': hệ thống gửi link đặt mật khẩu tới email của bạn.
                  </p>
                </div>
              </div>
              <div className="pt-2 border-t border-[#E7E7E2] flex flex-wrap items-center gap-3">
                <a href="/" className="inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-semibold text-[#111827] bg-white border border-[#E7E7E2] hover:bg-neutral-50 rounded-xl shadow-sm transition-colors">
                  <svg className="w-4 h-4 text-[#FF5701]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                  </svg>
                  <span>
                    Đến trang đăng nhập để dùng "Quên mật khẩu"
                  </span>
                </a>
              </div>
            </div>
          </section>
          {/* PHẦN 3: DANH SÁCH PHIÊN & THU HỒI */}
          <section id="section-sessions" className="bg-white rounded-2xl p-5 sm:p-7 border border-[#E7E7E2] shadow-sm" aria-labelledby="heading-sessions">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E7E7E2] pb-4 mb-6">
              <div>
                <h2 id="heading-sessions" className="font-display text-xl sm:text-2xl font-bold text-[#111827]">
                  3. Các phiên đang đăng nhập
                </h2>
                <p className="text-xs sm:text-sm text-[#6B7280] mt-1">
                  Danh sách các thiết bị và trình duyệt đang truy cập tài khoản ATI của bạn.
                </p>
              </div>
              {/* Nút Thu hồi tất cả các phiên khác. Bản mẫu thêm hidden vào nút đang có inline-flex: v3 cho hidden thắng
                  (xếp theo bảng giá trị display), v4 cho inline-flex thắng (xếp theo tên class), nên đánh dấu ! để giữ kết quả của v3. */}
              <button type="button" id="btn-revoke-all-others" onClick={() => actions.promptRevokeAllOtherSessions()} className={`${sessionCount <= 0 ? 'hidden! ' : ''}inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[40px] bg-red-50 hover:bg-red-100 text-red-600 hover:text-red-700 text-xs sm:text-sm font-semibold rounded-xl border border-red-200 transition-colors flex-shrink-0`}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                <span>
                  Đăng xuất khỏi tất cả phiên khác
                </span>
              </button>
            </div>
            {/* Danh sách thẻ phiên */}
            <div id="sessions-list-container" className="v3-space-y-3">
              {/* Phiên 1: Phiên hiện tại */}
              <div id="session-card-current" className="p-4 rounded-xl border border-[#16A34A]/30 bg-[#16A34A]/5 flex items-start justify-between gap-3 transition-all">
                <div className="flex items-start gap-3.5 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-white border border-[#E7E7E2] text-[#111827] flex items-center justify-center flex-shrink-0 shadow-sm">
                    {/* Icon Laptop */}
                    <svg className="w-5 h-5 text-[#4B5563]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-bold text-[#111827]">
                        Chrome trên Windows 11
                      </h3>
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#16A34A] bg-[#16A34A]/10 px-2 py-0.5 rounded-full">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A]" />
                        {" Phiên hiện tại"}
                      </span>
                    </div>
                    <p className="text-xs text-[#4B5563] mt-1">
                      {"Trình duyệt này · "}
                      <span className="font-medium text-[#16A34A]">
                        Đang hoạt động
                      </span>
                    </p>
                  </div>
                </div>
                <div className="text-xs text-[#6B7280] italic flex-shrink-0 pt-1">
                  Đang dùng
                </div>
              </div>
              {/* Phiên 2, 3: Safari trên iPhone, Firefox trên macOS */}
              {cards.map(card => <SessionCard key={`${card.id}-${card.recreated}`} card={card} onRevoke={actions.revokeSingleSession} />)}
              {/* Khung khi đã thu hồi hết các phiên khác */}
              <div id="sessions-empty-state" className={`${sessionCount <= 0 ? '' : 'hidden '}p-6 rounded-xl border border-dashed border-[#E7E7E2] bg-[#F8F8F6] text-center`}>
                <svg className="w-8 h-8 text-[#16A34A] mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                {' '}
                <p className="text-xs sm:text-sm font-semibold text-[#111827]">
                  Chỉ còn phiên hiện tại đang hoạt động
                </p>
                <p className="text-xs text-[#6B7280] mt-0.5">
                  Không còn phiên đăng nhập nào khác trên các thiết bị khác.
                </p>
              </div>
            </div>
          </section>
          {/* PHẦN 4: LIÊN KẾT / GỠ GOOGLE */}
          <section id="section-google" className="bg-white rounded-2xl p-5 sm:p-7 border border-[#E7E7E2] shadow-sm" aria-labelledby="heading-google">
            <div className="border-b border-[#E7E7E2] pb-4 mb-6">
              <h2 id="heading-google" className="font-display text-xl sm:text-2xl font-bold text-[#111827]">
                4. Liên kết tài khoản Google
              </h2>
              <p className="text-xs sm:text-sm text-[#6B7280] mt-1">
                Dùng tài khoản Google để đăng nhập một chạm vào ATI nhanh chóng và an toàn mà không cần nhớ mật khẩu.
              </p>
            </div>
            {/* Trạng thái 1: ĐÃ LIÊN KẾT (Mặc định) */}
            <div id="google-linked-state" className={`${view.googleLinked ? '' : 'hidden '}p-4 sm:p-5 rounded-xl border border-[#E7E7E2] bg-[#F8F8F6] flex flex-col sm:flex-row sm:items-center justify-between gap-4`}>
              <div className="flex items-start gap-4">
                {/* Google Logo chuẩn SVG */}
                <div className="w-10 h-10 rounded-xl bg-white border border-[#E7E7E2] flex items-center justify-center flex-shrink-0 shadow-sm">
                  <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                    {' '}
                    <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z" />
                    {' '}
                    <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.36 24 12 24z" />
                    {' '}
                    <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z" />
                    {' '}
                    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.36 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z" />
                    {' '}
                  </svg>
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-[#111827]">
                      Tài khoản Google
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#16A34A] bg-[#16A34A]/10 px-2 py-0.5 rounded-full">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      {" Đã liên kết"}
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm text-[#4B5563] font-mono mt-0.5" id="google-linked-email-display">
                    {view.googleEmail}
                  </p>
                  <p className="text-xs text-[#6B7280] mt-1">
                    Bạn có thể bấm nút "Tiếp tục với Google" trên trang đăng nhập để vào thẳng ATI.
                  </p>
                </div>
              </div>
              {/* Nút Gỡ liên kết Google */}
              <button type="button" id="btn-unlink-google" onClick={() => actions.promptUnlinkGoogleModal()} disabled={unlinkLocked} title={unlinkLocked ? 'Tài khoản chưa có mật khẩu' : undefined} className={unlinkLocked ? UNLINK_LOCKED : UNLINK_ON}>
                {" Gỡ liên kết Google "}
              </button>
            </div>
            {/* Thông báo giải thích khi tài khoản chưa có mật khẩu */}
            <div id="google-no-password-notice" className={`${googleOnly ? '' : 'hidden '}mt-3 p-3.5 bg-amber-50 border border-amber-200/80 rounded-xl text-xs text-amber-800 leading-relaxed flex items-start gap-2.5`}>
              <svg className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p>
                Tài khoản này chưa có mật khẩu. Để gỡ Google, hãy đặt mật khẩu trước bằng 'Quên mật khẩu': hệ thống gửi link đặt mật khẩu tới email của bạn.
              </p>
            </div>
            {/* Trạng thái 2: CHƯA LIÊN KẾT (Ẩn mặc định) */}
            <div id="google-unlinked-state" className={`${view.googleLinked ? 'hidden ' : ''}p-4 sm:p-5 rounded-xl border border-[#E7E7E2] bg-[#F8F8F6] flex flex-col sm:flex-row sm:items-center justify-between gap-4`}>
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-white border border-[#E7E7E2] flex items-center justify-center flex-shrink-0 shadow-sm text-[#9CA3AF]">
                  <svg className="w-5 h-5 flex-shrink-0 opacity-40" viewBox="0 0 24 24" aria-hidden="true">
                    {' '}
                    <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z" />
                    {' '}
                    <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.36 24 12 24z" />
                    {' '}
                    <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z" />
                    {' '}
                    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.36 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z" />
                    {' '}
                  </svg>
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-[#111827]">
                      Tài khoản Google
                    </span>
                    <span className="inline-flex items-center text-[11px] font-medium text-[#6B7280] bg-neutral-200 px-2 py-0.5 rounded-full">
                      Chưa liên kết
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm text-[#6B7280] mt-1">
                    Hiện bạn chưa liên kết tài khoản Google với tài khoản ATI này.
                  </p>
                </div>
              </div>
              {/* Nút Liên kết Google */}
              <button type="button" id="btn-link-google" disabled={linking} onClick={() => actions.triggerLinkGoogleFlow()} className="inline-flex items-center justify-center gap-2 px-4 py-2 min-h-[40px] text-xs sm:text-sm font-semibold text-[#111827] bg-white hover:bg-neutral-50 border border-[#E7E7E2] rounded-xl shadow-sm transition-colors flex-shrink-0 self-start sm:self-center">
                <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                  {' '}
                  <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z" />
                  {' '}
                  <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.36 24 12 24z" />
                  {' '}
                  <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z" />
                  {' '}
                  <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.36 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z" />
                  {' '}
                </svg>
                <span id="btn-link-google-text">
                  {linking ? 'Đang kết nối Google…' : 'Liên kết với Google'}
                </span>
              </button>
            </div>
          </section>
        </div>
      </main>
      {/* CHÂN TRANG NHẸ */}
      <footer className="mt-auto border-t border-[#E7E7E2] bg-white py-6 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#6B7280]">
          <div className="text-center sm:text-left">
            <span className="font-display font-bold text-[#111827]">
              ATI
            </span>
            {" — AI Workflow Automation Platform · 2026"}
          </div>
          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2.5 sm:gap-4">
            <a href="/app-stage" className="hover:text-[#111827] transition-colors">
              Không gian làm việc
            </a>
            <span>
              ·
            </span>
            <a href="/history" className="hover:text-[#111827] transition-colors">
              Nhật ký điều phối
            </a>
            <span>
              ·
            </span>
            <a href="/settings" className="hover:text-[#111827] transition-colors">
              Kết nối dịch vụ
            </a>
            <span>
              ·
            </span>
            <a href="/responses" className="hover:text-[#111827] transition-colors">
              Tình huống xử lý
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
      {/* MODAL XÁC NHẬN THU HỒI TẤT CẢ PHIÊN KHÁC */}
      <div id="modal-revoke-all" className={modalClass('modal-revoke-all')} role="dialog" aria-modal="true" aria-labelledby="modal-revoke-all-title">
        <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-[#E7E7E2] animate-in fade-in zoom-in-95 duration-200">
          <div className="w-10 h-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center mb-4">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h3 id="modal-revoke-all-title" className="font-display text-lg font-bold text-[#111827]">
            Đăng xuất khỏi tất cả phiên khác?
          </h3>
          <p className="text-xs sm:text-sm text-[#4B5563] mt-2 leading-relaxed">
            Hành động này sẽ thu hồi quyền truy cập của toàn bộ các thiết bị và trình duyệt khác (iPhone, máy tính khác). Riêng phiên hiện tại trên trình duyệt này vẫn được duy trì.
          </p>
          <div className="flex items-center justify-end gap-3 mt-6">
            <button type="button" onClick={() => actions.closeModal('modal-revoke-all')} className="px-4 py-2 text-xs sm:text-sm font-medium text-[#4B5563] hover:text-[#111827] bg-[#F8F8F6] hover:bg-neutral-200 rounded-xl transition-colors">
              {" Hủy bỏ "}
            </button>
            <button type="button" onClick={() => actions.confirmRevokeAllOtherSessions()} className="px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-sm transition-colors">
              {" Xác nhận thu hồi "}
            </button>
          </div>
        </div>
      </div>
      {/* MODAL XÁC NHẬN GỠ LIÊN KẾT GOOGLE */}
      <div id="modal-unlink-google" className={modalClass('modal-unlink-google')} role="dialog" aria-modal="true" aria-labelledby="modal-unlink-google-title">
        <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-[#E7E7E2] animate-in fade-in zoom-in-95 duration-200">
          <div className="w-10 h-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center mb-4">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
            </svg>
          </div>
          <h3 id="modal-unlink-google-title" className="font-display text-lg font-bold text-[#111827]">
            Gỡ liên kết tài khoản Google?
          </h3>
          <p className="text-xs sm:text-sm text-[#4B5563] mt-2 leading-relaxed">
            Sau khi gỡ liên kết, bạn sẽ không thể dùng nút "Tiếp tục với Google" để đăng nhập nữa. Bạn sẽ cần nhập địa chỉ email và mật khẩu của ATI để truy cập vào hệ thống.
          </p>
          {/* Trường Mật khẩu hiện tại (Bắt buộc) */}
          <div className="mt-4 text-left">
            <label htmlFor="input-unlink-current-pass" className="block text-xs sm:text-sm font-semibold text-[#111827] mb-1.5">
              {"Mật khẩu hiện tại "}
              <span className="text-[#FF5701]">
                *
              </span>
            </label>
            <div className="relative">
              <input ref={unlinkPassRef} type={passType('input-unlink-current-pass')} id="input-unlink-current-pass" placeholder="Nhập mật khẩu hiện tại để xác nhận" onKeyDown={(event) => { if (event.key === 'Enter') actions.confirmUnlinkGoogle(); }} className="w-full text-xs sm:text-sm px-3.5 py-2.5 bg-white border border-[#E7E7E2] rounded-xl text-[#111827] placeholder-[#9CA3AF] focus:border-[#FF5701] focus:ring-1 focus:ring-[#FF5701] transition-all pr-10" required autoComplete="current-password" />
              {' '}
              <button type="button" onClick={() => actions.togglePasswordVisibility('input-unlink-current-pass')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#6B7280] hover:text-[#111827] p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg" aria-label="Ẩn hoặc hiện mật khẩu">
                <EyeIcons visible={shownPasswords.includes('input-unlink-current-pass')} />
              </button>
            </div>
            <p className="text-[11px] text-[#6B7280] mt-1.5">
              Hệ thống yêu cầu mật khẩu hiện tại để xác thực trước khi huỷ phương thức đăng nhập bằng Google.
            </p>
          </div>
          <div className="flex items-center justify-end gap-3 mt-6">
            <button type="button" onClick={() => actions.closeModal('modal-unlink-google')} className="px-4 py-2 text-xs sm:text-sm font-medium text-[#4B5563] hover:text-[#111827] bg-[#F8F8F6] hover:bg-neutral-200 rounded-xl transition-colors">
              {" Giữ liên kết "}
            </button>
            <button type="button" onClick={() => actions.confirmUnlinkGoogle()} className="px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-sm transition-colors">
              {" Xác nhận gỡ "}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
