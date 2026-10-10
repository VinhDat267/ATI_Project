// Markup/classes copied from the approved React Landing prototype; auth handlers use the live API.
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { usePrototypePage, type PageMeta } from '../../prototype/usePrototypePage';
import type { LoginViewProps } from '../../components/LoginView';
import { apiClient } from '../../services/api-client';
import { userErrorMessage } from '../../services/user-error';
import css from './page.css?inline';
import { ThemeToggle } from '../../prototype/ThemeToggle';
type AuthMode = 'login' | 'signup';
type AuthView = 'form' | 'google' | 'success' | 'forgot';
type Success = { title: string; desc: ReactNode; isLogin: boolean };
type Overlay = { visible: boolean; interactive: boolean; scaled: boolean };
const SAMPLE_SENTENCE = 'Tạo card Trello cho lỗi đăng nhập Google, tạo issue GitHub, ghi vào Google Sheets và báo kênh Slack';
const K2_DATA = [
  { searching: 'Đang tìm bảng To Do trên Trello…', found: '✓ Đã thấy bảng To Do' },
  { searching: 'Đang tìm kho mã ati-test trên GitHub…', found: '✓ Đã thấy kho mã ati-test' },
  { searching: 'Đang tìm bảng tính ATI Test Tracker…', found: '✓ Đã thấy bảng tính ATI Test Tracker' },
  { searching: 'Đang tìm kênh #ati-test trên Slack…', found: '✓ Đã thấy kênh #ati-test' },
];
const DOT_ON = 'stage-dot w-7 h-7 rounded-lg text-xs font-semibold flex items-center justify-center transition-all bg-[#FF5701] text-white shadow-sm';
const DOT_OFF = 'stage-dot w-7 h-7 rounded-lg text-xs font-medium flex items-center justify-center transition-all bg-transparent text-[#6B7280] hover:bg-[#F0F0EB]';
const TAB_ON = 'py-2 text-xs sm:text-sm font-semibold rounded-xl transition-all bg-white text-[#111827] shadow-sm';
const TAB_OFF = 'py-2 text-xs sm:text-sm font-medium rounded-xl transition-all text-[#6B7280] hover:text-[#111827]';
const CLOSED: Overlay = { visible: false, interactive: false, scaled: false };
const OPEN: Overlay = { visible: true, interactive: true, scaled: true };
const overlayClass = (o: Overlay) => `${o.visible ? 'opacity-100' : 'opacity-0'} ${o.interactive ? 'pointer-events-auto' : 'pointer-events-none'}`;
const cardScale = (o: Overlay) => (o.scaled ? 'scale-100' : 'scale-95');
const reducedMotion = () => !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// Biểu tượng mắt của ô mật khẩu (setupPwdToggle).
const EYE_SHOW = <>
  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
</>;
const EYE_HIDE = <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />;
const FOCUSABLE = 'button:not([disabled]), [href]:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
// Route changes recreate the landing DOM. Keep the real opener's source identity
// until an explicit modal close asks its replacement node to receive focus.
const modalOpeners = new WeakMap<Document, { element: HTMLElement | null; id: string; returnRequested: boolean }>();
function rememberModalOpener(element: HTMLElement) {
  const id = element.dataset.odId;
  if (id) modalOpeners.set(element.ownerDocument, { element, id, returnRequested: false });
}
function requestModalFocusReturn() {
  const opener = modalOpeners.get(document);
  modalOpeners.set(document, opener ? { ...opener, returnRequested: true }
    : { element: null, id: 'btn-header-login', returnRequested: true });
}
function restoreRequestedModalFocus() {
  const opener = modalOpeners.get(document);
  modalOpeners.delete(document);
  if (!opener?.returnRequested) return;
  const element = opener.element?.isConnected ? opener.element
    : [...document.querySelectorAll<HTMLElement>('[data-od-id]')].find(node => node.dataset.odId === opener.id);
  element?.focus();
}

// Nhãn trạng thái của một dịch vụ ở khoảnh khắc 2 (setSearching / markFound).
function K2Badge({ found }: { found: boolean }) {
  return found ? (
    <span className="k2-badge inline-flex items-center gap-1 text-xs font-semibold text-[#16A34A] bg-[#F0FDF4] px-2.5 py-1 rounded-md border border-[#16A34A]/20 transition-colors duration-200">
      <span>✓</span><span>Đã thấy</span>
    </span>
  ) : (
    <span className="k2-badge inline-flex items-center gap-1.5 text-xs font-medium text-[#FF5701] bg-[#FFF3ED] px-2.5 py-1 rounded-md border border-[#FF5701]/20">
      <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
      </svg>
      <span>Đang tìm...</span>
    </span>
  );
}

const meta: PageMeta = {
  id: "index",
  title: "ATI — AI Workflow Automation Platform",
  htmlClass: "scroll-smooth",
  bodyClass: "selection:bg-[#FF5701]/20 selection:text-[#111827]",
  css,
};


export interface LandingPageProps extends Partial<LoginViewProps> {
  navigate: (path: string, replace?: boolean) => void;
  initialMode?: AuthMode | 'forgot';
}
export function LandingPage({ navigate, initialMode, email = '', setEmail = () => {}, password = '', setPassword = () => {},
  isLoggingIn = false, authError, onLogin, authConfig }: LandingPageProps) {
  usePrototypePage(meta);
  const model = useRef({ moment: 1, isTyping: false });
  const [moment, setMoment] = useState(1), [switched, setSwitched] = useState(false);
  const [k2Found, setK2Found] = useState([false, false, false, false]);
  const [typed, setTyped] = useState(SAMPLE_SENTENCE);
  const authModeView = initialMode === 'signup' ? 'signup' : 'login';
  const [authView, setAuthView] = useState<AuthView>(initialMode === 'forgot' ? 'forgot' : 'form');
  const [googleModalOpen, setGoogleModalOpen] = useState(false);
  const authOpen = Boolean(initialMode) || googleModalOpen;
  const authOverlay = authOpen ? OPEN : CLOSED;
  const [forgotSent, setForgotSent] = useState(false), [success, setSuccess] = useState<Success | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [loginPwdShown, setLoginPwdShown] = useState(false), [signupPwdShown, setSignupPwdShown] = useState(false);
  const authModalRef = useRef<HTMLDivElement>(null), authCardRef = useRef<HTMLDivElement>(null);
  const loginEmailRef = useRef<HTMLInputElement>(null), signupNameRef = useRef<HTMLInputElement>(null);
  const signupEmailRef = useRef<HTMLInputElement>(null), forgotEmailRef = useRef<HTMLInputElement>(null);
  const enterWorkspaceRef = useRef<HTMLAnchorElement>(null), successCloseRef = useRef<HTMLButtonElement>(null);
  const timers = useRef<number[]>([]), k2Timers = useRef<number[]>([]), generation = useRef(0), pending = useRef(false);
  const later = (ms: number, run: () => void) => { const id = window.setTimeout(run, ms); timers.current.push(id); return id; };
  const lockScroll = (on: boolean) => {
    document.documentElement.classList.toggle('overflow-hidden', on); document.body.classList.toggle('overflow-hidden', on);
  };
  useEffect(() => {
    const owner = ++generation.current;
    return () => { if (generation.current === owner) generation.current++; timers.current.forEach(window.clearTimeout); k2Timers.current.forEach(window.clearTimeout); lockScroll(false); };
  }, [initialMode]);
  useLayoutEffect(() => { if (!authOpen) restoreRequestedModalFocus(); }, [authOpen]);
  useLayoutEffect(() => {
    lockScroll(authOpen);
    const active = document.activeElement;
    const editingField = authCardRef.current?.contains(active) && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement);
    if (authOpen && !editingField) {
      if (authView === 'google') authCardRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
      else if (authView === 'success') successCloseRef.current?.focus();
      else (authView === 'forgot' ? forgotEmailRef.current : initialMode === 'signup' ? signupNameRef.current : loginEmailRef.current)?.focus();
    }
    return () => { lockScroll(false); };
  }, [authOpen, initialMode, authView, authConfig?.signupEnabled]);
  const clearK2Timers = () => {
    k2Timers.current.forEach(window.clearTimeout);
    k2Timers.current = [];
  };
  const runK2Animation = () => {
    clearK2Timers();
    if (reducedMotion()) {
      setK2Found([true, true, true, true]);
      return;
    }
    setK2Found([false, false, false, false]);
    K2_DATA.forEach((_, idx) => {
      k2Timers.current.push(window.setTimeout(() => setK2Found(list => list.map((v, i) => (i === idx ? true : v))), (idx + 1) * 400));
    });
  };
  const startTypewriter = () => {
    const m = model.current;
    if (m.isTyping) return;
    if (reducedMotion()) {
      setTyped(SAMPLE_SENTENCE);
      return;
    }
    m.isTyping = true;
    setTyped('');
    let index = 0;
    const typeNextChar = () => {
      if (index < SAMPLE_SENTENCE.length) {
        index++;
        setTyped(SAMPLE_SENTENCE.slice(0, index));
        later(32, typeNextChar);
      } else {
        m.isTyping = false;
      }
    };
    later(300, typeNextChar);
  };
  const switchMoment = (momentId: number) => {
    if (model.current.moment === momentId) return;
    model.current.moment = momentId;
    setMoment(momentId);
    setSwitched(true);
    if (momentId === 1) startTypewriter();
    else if (momentId === 2) runK2Animation();
    else clearK2Timers();
  };

  // Gõ chữ lần đầu khi mở trang; khoảnh khắc đổi theo đoạn chữ đang ở giữa màn hình khi cuộn.
  useEffect(() => {
    startTypewriter();
    const triggers = document.querySelectorAll<HTMLElement>('.moment-trigger');
    if (!window.IntersectionObserver) return;
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const target = Number(entry.target.getAttribute('data-moment'));
        // Bản mẫu đổi DOM ngay trong callback; flushSync để giao diện đổi cùng lúc.
        if (target) flushSync(() => switchMoment(target));
      });
    }, { root: null, rootMargin: '-30% 0px -30% 0px', threshold: 0.2 });
    triggers.forEach(trigger => observer.observe(trigger));
    return () => {
      observer.disconnect();
      model.current.isTyping = false;
    };
  }, []);


  const changeMode = (mode: AuthMode) => { navigate(mode === 'signup' ? '/signup' : '/login'); };
  const closeAuthModal = () => {
    generation.current++; requestModalFocusReturn();
    setGoogleModalOpen(false); setAuthView('form'); setBusy(false); navigate('/');
  };
  const triggerGoogleAuthFlow = async () => {
    if (pending.current || !authConfig?.googleEnabled) return;
    pending.current = true; const owner = generation.current; setBusy(true); setAuthView('google'); setError(null);
    if (!initialMode) setGoogleModalOpen(true);
    try { const { url } = await apiClient.startGoogleAuth(); if (generation.current === owner) window.location.assign(url); }
    catch { if (generation.current === owner) { setAuthView('form'); setError('Không thể bắt đầu đăng nhập Google. Hãy thử lại.'); } }
    finally { pending.current = false; if (generation.current === owner) setBusy(false); }
  };
  const actions = {
    clickDot(target: number) { switchMoment(target); const trigger = document.getElementById(`trigger-moment-${target}`); if (trigger) window.scrollTo({ top: trigger.getBoundingClientRect().top + window.scrollY - 100, behavior: reducedMotion() ? 'auto' : 'smooth' }); },
    showForgotView() { navigate('/forgot-password'); },
    handleLoginSubmit(event: FormEvent<HTMLFormElement>) { void onLogin?.(event); },
    async handleSignupSubmit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault(); if (pending.current || !authConfig?.signupEnabled) return;
      const password = (event.currentTarget.querySelector<HTMLInputElement>('#signup-password')?.value ?? '');
      if (password.length < 12 || password.length > 128) { setError('Mật khẩu cần từ 12 đến 128 ký tự.'); return; }
      pending.current = true; const owner = generation.current; setBusy(true); setError(null);
      try { const data = await apiClient.signup(signupNameRef.current?.value.trim() ?? '', signupEmailRef.current?.value.trim() ?? '', password);
        if (generation.current === owner) { setSuccess({ title: 'Đã gửi yêu cầu đăng ký!', desc: data.message, isLogin: false }); setAuthView('success'); }
      } catch (reason) { if (generation.current === owner) setError(userErrorMessage(reason)); }
      finally { pending.current = false; if (generation.current === owner) setBusy(false); }
    },
    async handleForgotSubmit(event: FormEvent) {
      event.preventDefault(); if (pending.current) return; pending.current = true;
      const owner = generation.current; setBusy(true); setError(null);
      try { await apiClient.forgotPassword(forgotEmailRef.current?.value.trim() ?? ''); if (generation.current === owner) setForgotSent(true); }
      catch (reason) { if (generation.current === owner) setError(userErrorMessage(reason)); }
      finally { pending.current = false; if (generation.current === owner) setBusy(false); }
    },
  };
  const authLink = (mode: AuthMode | 'google') => (event: ReactMouseEvent) => {
    event.preventDefault();
    if (!authOpen && event.currentTarget instanceof HTMLElement) rememberModalOpener(event.currentTarget);
    if (mode === 'google') void triggerGoogleAuthFlow(); else changeMode(mode);
  };
  const backdrop = (ref: React.RefObject<HTMLDivElement | null>, close: () => void) => (event: ReactMouseEvent) => { if (event.target === ref.current) close(); };
  useEffect(() => {
    if (!authOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { closeAuthModal(); return; }
      if (event.key !== 'Tab') return;
      const visible = [...(authCardRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(el => el.offsetParent !== null);
      const first = visible[0], last = visible[visible.length - 1];
      if (event.shiftKey && document.activeElement === first) { last?.focus(); event.preventDefault(); }
      else if (!event.shiftKey && document.activeElement === last) { first?.focus(); event.preventDefault(); }
    };
    document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey);
  });
  const isLoginView = authModeView === 'login';
  const triggerOpacity = (n: number) => (!switched ? (n === 1 ? '' : ' opacity-40') : n === moment ? ' opacity-100' : ' opacity-40');
  return (
    <>
      <div className="contents" inert={authOpen} aria-hidden={authOpen}>
      {' '}
      {/* ========================================== */}
      {' '}
      {/* 1. THANH ĐẦU DÍNH (STICKY HEADER) */}
      {' '}
      {/* ========================================== */}
      {' '}
      <header className="sticky top-0 z-50 bg-[#F8F8F6]/90 backdrop-blur-md border-b border-[#E7E7E2] transition-colors" data-od-id="nav-header">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 sm:h-[72px] flex items-center justify-between">
          {/* Logo: ô cam bo góc + chữ Playfair Display */}
          <a href="#" className="group flex items-center gap-3 focus-visible:rounded-lg" aria-label="ATI — Trang chủ">
            <div className="w-9 h-9 rounded-xl bg-[#FF5701] text-white flex items-center justify-center font-display font-bold text-lg shadow-sm transition-transform group-hover:scale-105">
              A
            </div>
            <div className="flex flex-col">
              <span className="font-display font-bold text-xl sm:text-2xl tracking-tight text-[#111827] leading-none">
                ATI
              </span>
            </div>
          </a>
          {/* Bên phải: nút Đăng nhập (viền) và nút Đăng ký (cam) */}
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <a href="#login" onClick={authLink('login')} className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-[#111827] bg-white border border-[#E7E7E2] rounded-xl hover:border-[#111827] hover:bg-[#F8F8F6] transition-all focus-visible:v3-outline-none" data-od-id="btn-header-login">
              Đăng nhập
            </a>
            <a href="#signup" onClick={authLink('signup')} className="inline-flex items-center justify-center px-4 sm:px-5 py-2 text-sm font-medium text-white bg-[#FF5701] rounded-xl hover:bg-[#E04C00] shadow-sm hover:shadow transition-all focus-visible:v3-outline-none" data-od-id="btn-header-signup">
              Đăng ký
            </a>
          </div>
        </div>
      </header>
      <main>
        {/* ========================================== */}
        {/* 2. PHẦN MỞ ĐẦU (HERO - MÀN ĐẦU TIÊN) */}
        {/* ========================================== */}
        <section className="relative pt-12 sm:pt-20 lg:pt-28 pb-16 sm:pb-24 border-b border-[#E7E7E2]" data-od-id="hero-section">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 text-center">
            {/* Nhãn nhỏ nhẹ nhàng phía trên tiêu đề */}
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white border border-[#E7E7E2] text-xs font-medium text-[#6B7280] mb-6 sm:mb-8 shadow-sm">
              <span className="w-2 h-2 rounded-full bg-[#FF5701]" />
              <span>
                Nền tảng điều phối tự động hóa công việc bằng AI
              </span>
            </div>
            {' '}
            {/* Tiêu đề Playfair Display cỡ rất lớn (56–80px desktop) */}
            {' '}
            <h1 className="font-display font-medium text-[38px] leading-[1.12] sm:text-6xl lg:text-[76px] lg:leading-[1.08] text-[#111827] tracking-tight mb-6 max-w-4xl mx-auto" data-od-id="hero-title">
              Nói một câu. Việc trên nhiều công cụ được làm xong — sau khi bạn duyệt.
            </h1>
            {/* Dòng phụ đời thường, rõ nghĩa */}
            <p className="text-base sm:text-xl text-[#4B5563] max-w-2xl mx-auto leading-relaxed mb-10 font-normal">
              ATI đọc yêu cầu tiếng Việt, lên kế hoạch trên Trello, Slack, GitHub, Google Sheets… và chỉ làm khi bạn đồng ý.
            </p>
            {/* Ba nút: Đăng ký (cam), Tiếp tục với Google (trắng), Đăng nhập (liên kết) */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3.5 sm:gap-4 mb-4">
              <a href="#signup" onClick={authLink('signup')} className="w-full sm:w-auto inline-flex items-center justify-center px-7 py-3.5 text-base font-medium text-white bg-[#FF5701] rounded-2xl hover:bg-[#E04C00] shadow-md shadow-[#FF5701]/20 transition-all v3-transform hover:-translate-y-0.5 focus-visible:v3-outline-none" data-od-id="btn-hero-signup">
                Đăng ký
              </a>
              <a href="#google" onClick={authLink('google')} className="w-full sm:w-auto inline-flex items-center justify-center gap-3 px-6 py-3.5 text-base font-medium text-[#111827] bg-white border border-[#E7E7E2] rounded-2xl hover:border-gray-400 hover:bg-[#FAFAFA] shadow-sm transition-all focus-visible:v3-outline-none" data-od-id="btn-hero-google">
                {/* Google SVG Icon chuẩn */}
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
                <span>
                  Tiếp tục với Google
                </span>
              </a>
              <a href="#login" onClick={authLink('login')} className="text-sm font-medium text-[#6B7280] hover:text-[#111827] underline underline-offset-4 px-3 py-2 transition-colors focus-visible:rounded" data-od-id="btn-hero-login-link">
                {" Đăng nhập "}
              </a>
            </div>
            {/* Ghi chú nhỏ dưới nút */}
            <p className="text-xs text-[#9CA3AF] font-normal mb-12 flex items-center justify-center gap-1.5 flex-wrap">
              <span>
                Tài khoản mới cần quản trị viên duyệt.
              </span>
              <span className="text-[#D1D5DB]">
                ·
              </span>

            </p>
            {' '}
            {/* Gợi ý cuộn xuống tinh tế */}
            {' '}
            <a href="#story-stage" className="inline-flex flex-col items-center gap-2 text-xs font-medium text-[#9CA3AF] hover:text-[#4B5563] transition-colors focus-visible:rounded-lg p-1" aria-label="Cuộn xuống để xem cách hoạt động">
              <span>
                Xem cách hoạt động qua 5 khoảnh khắc
              </span>
              <svg className="w-4 h-4 animate-bounce text-[#FF5701]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                {' '}
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                {' '}
              </svg>
            </a>
          </div>
        </section>
        {/* ========================================== */}
        {/* 3. SÂN KHẤU CUỘN KỂ CHUYỆN (TRỌNG TÂM) */}
        {/* ========================================== */}
        <section id="story-stage" className="relative py-16 sm:py-24 border-b border-[#E7E7E2]" data-od-id="storytelling-stage">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            {/* Tiêu đề phần kể chuyện */}
            <div className="text-center max-w-2xl mx-auto mb-12 sm:mb-16">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#FF5701] mb-2">
                Hành trình tương tác
              </p>
              <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl text-[#111827] font-semibold tracking-tight">
                Một vòng làm việc hoàn chỉnh
              </h2>
              <p className="text-sm sm:text-base text-[#6B7280] mt-3">
                Từ lúc bạn gõ yêu cầu đến khi việc được ghi lên các công cụ — minh bạch trong từng bước.
              </p>
            </div>
            {/* KHUNG DESKTOP 2 CỘT (CỘT TRÁI 5 ĐOẠN CHỮ, CỘT PHẢI SÂN KHẤU DÍNH) */}
            <div className="stage-interactive-desktop hidden lg:grid lg:grid-cols-12 lg:gap-12 items-start relative">
              {/* CỘT TRÁI: 5 ĐOẠN CHỮ LƯỚT CUỘN */}
              <div className="lg:col-span-5 v3-space-y-36 py-12">
                {/* Khoảnh khắc 1 Trigger */}
                <div id="trigger-moment-1" className={`moment-trigger min-h-[50vh] flex flex-col justify-center transition-all duration-300${triggerOpacity(1)}`} data-moment="1">
                  <div className="inline-flex items-center gap-2 text-xs font-mono font-medium text-[#FF5701] mb-3">
                    <span className="w-6 h-6 rounded-full bg-[#FFF3ED] border border-[#FF5701]/30 flex items-center justify-center font-bold text-xs">
                      1
                    </span>
                    <span>
                      KHOẢNH KHẮC 1
                    </span>
                  </div>
                  <h3 className="font-display text-3xl sm:text-4xl text-[#111827] font-semibold tracking-tight mb-4">
                    Bạn nói bằng lời thường
                  </h3>
                  <p className="text-base text-[#4B5563] leading-relaxed">
                    Không cần học câu lệnh hay cú pháp đặc biệt. Bạn cứ gõ việc cần làm bằng tiếng Việt tự nhiên như đang nhắn cho một đồng nghiệp trong nhóm.
                  </p>
                </div>
                {/* Khoảnh khắc 2 Trigger */}
                <div id="trigger-moment-2" className={`moment-trigger min-h-[50vh] flex flex-col justify-center transition-all duration-300${triggerOpacity(2)}`} data-moment="2">
                  <div className="inline-flex items-center gap-2 text-xs font-mono font-medium text-[#FF5701] mb-3">
                    <span className="w-6 h-6 rounded-full bg-[#FFF3ED] border border-[#FF5701]/30 flex items-center justify-center font-bold text-xs">
                      2
                    </span>
                    <span>
                      KHOẢNH KHẮC 2
                    </span>
                  </div>
                  <h3 className="font-display text-3xl sm:text-4xl text-[#111827] font-semibold tracking-tight mb-4">
                    Tôi tự tìm đúng chỗ
                  </h3>
                  <p className="text-base text-[#4B5563] leading-relaxed">
                    ATI đối chiếu yêu cầu với các công cụ nhóm đã liên kết để tìm chính xác bảng việc, kho mã, bảng tính hay kênh trao đổi — bạn không cần nhớ link hay ID.
                  </p>
                </div>
                {/* Khoảnh khắc 3 Trigger */}
                <div id="trigger-moment-3" className={`moment-trigger min-h-[50vh] flex flex-col justify-center transition-all duration-300${triggerOpacity(3)}`} data-moment="3">
                  <div className="inline-flex items-center gap-2 text-xs font-mono font-medium text-[#FF5701] mb-3">
                    <span className="w-6 h-6 rounded-full bg-[#FFF3ED] border border-[#FF5701]/30 flex items-center justify-center font-bold text-xs">
                      3
                    </span>
                    <span>
                      KHOẢNH KHẮC 3
                    </span>
                  </div>
                  <h3 className="font-display text-3xl sm:text-4xl text-[#111827] font-semibold tracking-tight mb-4">
                    Bạn xem trước, rồi mới duyệt
                  </h3>
                  <p className="text-base text-[#4B5563] leading-relaxed">
                    Trước khi bất kỳ dữ liệu nào được ghi, ATI lập một kế hoạch rõ ràng để bạn kiểm tra. Bạn đọc đúng từng chữ sẽ gửi đi và chỉ bắt đầu khi bạn bấm duyệt.
                  </p>
                </div>
                {/* Khoảnh khắc 4 Trigger */}
                <div id="trigger-moment-4" className={`moment-trigger min-h-[50vh] flex flex-col justify-center transition-all duration-300${triggerOpacity(4)}`} data-moment="4">
                  <div className="inline-flex items-center gap-2 text-xs font-mono font-medium text-[#FF5701] mb-3">
                    <span className="w-6 h-6 rounded-full bg-[#FFF3ED] border border-[#FF5701]/30 flex items-center justify-center font-bold text-xs">
                      4
                    </span>
                    <span>
                      KHOẢNH KHẮC 4
                    </span>
                  </div>
                  <h3 className="font-display text-3xl sm:text-4xl text-[#111827] font-semibold tracking-tight mb-4">
                    Tôi làm lần lượt, bạn thấy từng bước
                  </h3>
                  <p className="text-base text-[#4B5563] leading-relaxed">
                    Khi đã có sự đồng ý của bạn, hệ thống thực thi từng việc theo thứ tự. Bạn theo dõi được bước nào đã xong, bước nào đang chạy mà không phải đoán mò.
                  </p>
                </div>
                {/* Khoảnh khắc 5 Trigger */}
                <div id="trigger-moment-5" className={`moment-trigger min-h-[50vh] flex flex-col justify-center transition-all duration-300${triggerOpacity(5)}`} data-moment="5">
                  <div className="inline-flex items-center gap-2 text-xs font-mono font-medium text-[#FF5701] mb-3">
                    <span className="w-6 h-6 rounded-full bg-[#FFF3ED] border border-[#FF5701]/30 flex items-center justify-center font-bold text-xs">
                      5
                    </span>
                    <span>
                      KHOẢNH KHẮC 5
                    </span>
                  </div>
                  <h3 className="font-display text-3xl sm:text-4xl text-[#111827] font-semibold tracking-tight mb-4">
                    Xong, kèm đường dẫn tới từng kết quả
                  </h3>
                  <p className="text-base text-[#4B5563] leading-relaxed">
                    Mọi việc hoàn tất đều để lại biên nhận minh bạch. Bạn có đường dẫn trực tiếp mở ngay card, issue, dòng bảng tính hay tin nhắn vừa tạo để kiểm tra bất cứ lúc nào.
                  </p>
                </div>
              </div>
              {/* CỘT PHẢI: SÂN KHẤU DÍNH (STICKY STAGE MOCKUP) */}
              <div className="lg:col-span-7 sticky top-24 self-start py-8">
                <div className="bg-white rounded-2xl border border-[#E7E7E2] shadow-[0_1px_3px_rgba(0,0,0,0.02),0_16px_40px_-6px_rgba(0,0,0,0.07)] overflow-hidden transition-all" aria-live="polite" aria-label="Mô phỏng sân khấu làm việc của ATI">
                  {/* Thanh điều khiển đỉnh sân khấu + 5 chấm tiến độ */}
                  <div className="px-5 py-3.5 bg-[#FAFAF8] border-b border-[#E7E7E2] flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full bg-[#E7E7E2]" />
                      <span className="w-3 h-3 rounded-full bg-[#E7E7E2]" />
                      <span className="w-3 h-3 rounded-full bg-[#E7E7E2]" />
                      <span className="ml-2 text-xs font-medium text-[#6B7280]">
                        ATI
                      </span>
                    </div>
                    {/* 5 chấm tiến độ có thể bấm chuyển nhanh */}
                    <nav className="flex items-center gap-1.5" aria-label="Các khoảnh khắc trên sân khấu">
                      <button type="button" className={moment === 1 ? DOT_ON : DOT_OFF} data-target="1" aria-label="Khoảnh khắc 1: Bạn nói bằng lời thường" aria-current={moment === 1 ? 'step' : undefined} onClick={() => actions.clickDot(1)}>
                        1
                      </button>
                      <button type="button" className={moment === 2 ? DOT_ON : DOT_OFF} data-target="2" aria-label="Khoảnh khắc 2: Tôi tự tìm đúng chỗ" aria-current={moment === 2 ? 'step' : undefined} onClick={() => actions.clickDot(2)}>
                        2
                      </button>
                      <button type="button" className={moment === 3 ? DOT_ON : DOT_OFF} data-target="3" aria-label="Khoảnh khắc 3: Bạn xem trước, rồi mới duyệt" aria-current={moment === 3 ? 'step' : undefined} onClick={() => actions.clickDot(3)}>
                        3
                      </button>
                      <button type="button" className={moment === 4 ? DOT_ON : DOT_OFF} data-target="4" aria-label="Khoảnh khắc 4: Tôi làm lần lượt, bạn thấy từng bước" aria-current={moment === 4 ? 'step' : undefined} onClick={() => actions.clickDot(4)}>
                        4
                      </button>
                      <button type="button" className={moment === 5 ? DOT_ON : DOT_OFF} data-target="5" aria-label="Khoảnh khắc 5: Xong, kèm đường dẫn tới từng kết quả" aria-current={moment === 5 ? 'step' : undefined} onClick={() => actions.clickDot(5)}>
                        5
                      </button>
                    </nav>
                  </div>
                  {/* NỘI DUNG SÂN KHẤU (5 PANELS) */}
                  <div className="stage-panels-container p-6 sm:p-7 min-h-[460px] bg-white relative">
                    {/* ================= KHOẢNH KHẮC 1 (DESKTOP) ================= */}
                    <div id="stage-panel-1" className={`stage-card-panel ${moment === 1 ? 'is-active' : 'is-hidden'} flex flex-col justify-between h-full`} aria-hidden={moment === 1 ? 'false' : 'true'} inert={moment !== 1}>
                      <div>
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-2">
                            <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#16A34A]" />
                            <span className="text-xs font-medium text-[#4B5563]">
                              Sẵn sàng tiếp nhận yêu cầu
                            </span>
                          </div>
                          <span className="text-xs text-[#9CA3AF]">
                            Khoảnh khắc 1 / 5
                          </span>
                        </div>
                        {/* Ô nhập yêu cầu với hiệu ứng gõ chữ */}
                        <div className="p-4 rounded-xl border-2 border-[#FF5701]/30 bg-[#FAFAFA] shadow-sm mb-5">
                          <p className="block text-xs font-medium text-[#6B7280] mb-2">
                            Gõ một câu tiếng Việt:
                          </p>
                          <div className="font-sans text-sm sm:text-base text-[#111827] leading-relaxed font-normal min-h-[52px]">
                            <span id="typewriter-text" className="text-[#111827]">
                              {typed}
                            </span>
                            <span className="typing-cursor" />
                          </div>
                        </div>
                        {/* Dải dịch vụ đã kết nối */}
                        <div className="v3-space-y-2">
                          <p className="text-xs text-[#6B7280] font-medium">
                            Đã kết nối với không gian của nhóm:
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#F8F8F6] border border-[#E7E7E2] text-xs font-medium text-[#111827]">
                              <span className="w-2 h-2 rounded-full bg-[#0079BF]" />
                              {" Trello"}
                            </span>
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#F8F8F6] border border-[#E7E7E2] text-xs font-medium text-[#111827]">
                              <span className="w-2 h-2 rounded-full bg-[#4A154B]" />
                              {" Slack"}
                            </span>
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#F8F8F6] border border-[#E7E7E2] text-xs font-medium text-[#111827]">
                              <span className="w-2 h-2 rounded-full bg-[#24292E]" />
                              {" GitHub"}
                            </span>
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#F8F8F6] border border-[#E7E7E2] text-xs font-medium text-[#111827]">
                              <span className="w-2 h-2 rounded-full bg-[#0F9D58]" />
                              {" Google Sheets"}
                            </span>
                          </div>
                        </div>
                      </div>
                      {/* Chân panel 1 */}
                      <div className="pt-6 border-t border-[#F0F0EB] flex items-center justify-between text-xs text-[#6B7280]">
                        <span>
                          Nhấn Enter hoặc gửi để ATI phân tích
                        </span>
                        <span className="text-[#FF5701] font-medium">
                          Đang lắng nghe...
                        </span>
                      </div>
                    </div>
                    {/* ================= KHOẢNH KHẮC 2 (DESKTOP) ================= */}
                    <div id="stage-panel-2" className={`stage-card-panel ${moment === 2 ? 'is-active' : 'is-hidden'} flex flex-col justify-between h-full`} aria-hidden={moment === 2 ? 'false' : 'true'} inert={moment !== 2}>
                      <div>
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-2">
                            <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#FF5701] pulse-ring-active" />
                            <span className="text-xs font-medium text-[#111827]">
                              Đang tìm đúng nơi lưu trữ trên các dịch vụ...
                            </span>
                          </div>
                          <span className="text-xs text-[#9CA3AF]">
                            Khoảnh khắc 2 / 5
                          </span>
                        </div>
                        {/* 4 dòng tìm kiếm kết quả hiện rõ với SVG thật */}
                        <div className="v3-space-y-3" id="k2-services-list">
                          {/* 1. Trello */}
                          <div className="p-3.5 rounded-xl border border-[#E7E7E2] bg-[#FAFAF8] flex items-center justify-between k2-service-item" data-index="0">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-[#0079BF]/10 flex items-center justify-center p-1.5 flex-shrink-0">
                                <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="none">
                                  {' '}
                                  <rect width="24" height="24" rx="4" fill="#0079BF" />
                                  {' '}
                                  <rect x="4" y="4" width="6.5" height="13" rx="1.5" fill="white" />
                                  {' '}
                                  <rect x="13.5" y="4" width="6.5" height="8.5" rx="1.5" fill="white" />
                                  {' '}
                                </svg>
                              </div>
                              <div>
                                <p className="text-xs text-[#6B7280]">
                                  Trello
                                </p>
                                <p className="k2-title text-sm font-medium text-[#111827]">{K2_DATA[0][k2Found[0] ? 'found' : 'searching']}</p>
                              </div>
                            </div>
                            <K2Badge found={k2Found[0]} />
                          </div>
                          {/* 2. GitHub */}
                          <div className="p-3.5 rounded-xl border border-[#E7E7E2] bg-[#FAFAF8] flex items-center justify-between k2-service-item" data-index="1">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-[#24292E]/10 flex items-center justify-center p-1.5 flex-shrink-0">
                                <svg className="w-5 h-5 text-[#24292E] flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                                  {' '}
                                  <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                                  {' '}
                                </svg>
                              </div>
                              <div>
                                <p className="text-xs text-[#6B7280]">
                                  GitHub
                                </p>
                                <p className="k2-title text-sm font-medium text-[#111827]">{K2_DATA[1][k2Found[1] ? 'found' : 'searching']}</p>
                              </div>
                            </div>
                            <K2Badge found={k2Found[1]} />
                          </div>
                          {/* 3. Google Sheets */}
                          <div className="p-3.5 rounded-xl border border-[#E7E7E2] bg-[#FAFAF8] flex items-center justify-between k2-service-item" data-index="2">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-[#0F9D58]/10 flex items-center justify-center p-1.5 flex-shrink-0">
                                <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="none">
                                  {' '}
                                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" fill="#0F9D58" />
                                  {' '}
                                  <path d="M14 2v6h6l-6-6z" fill="#87CEAB" />
                                  {' '}
                                  <rect x="7" y="11" width="10" height="7" rx="0.5" fill="white" fillOpacity="0.3" />
                                  {' '}
                                  <line x1="7" y1="14" x2="17" y2="14" stroke="white" strokeWidth="1" />
                                  {' '}
                                  <line x1="11" y1="11" x2="11" y2="18" stroke="white" strokeWidth="1" />
                                  {' '}
                                </svg>
                              </div>
                              <div>
                                <p className="text-xs text-[#6B7280]">
                                  Google Sheets
                                </p>
                                <p className="k2-title text-sm font-medium text-[#111827]">{K2_DATA[2][k2Found[2] ? 'found' : 'searching']}</p>
                              </div>
                            </div>
                            <K2Badge found={k2Found[2]} />
                          </div>
                          {/* 4. Slack */}
                          <div className="p-3.5 rounded-xl border border-[#E7E7E2] bg-[#FAFAF8] flex items-center justify-between k2-service-item" data-index="3">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-[#4A154B]/10 flex items-center justify-center p-1.5 flex-shrink-0">
                                <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="none">
                                  {' '}
                                  <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.528 2.528 0 0 1 2.521-2.52 2.528 2.528 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#E01E5A" />
                                  {' '}
                                  <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#36C5F0" />
                                  {' '}
                                  <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="#2EB67D" />
                                  {' '}
                                  <path d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.527 2.527 0 0 1 2.52-2.52h6.313A2.528 2.528 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="#ECB22E" />
                                  {' '}
                                </svg>
                              </div>
                              <div>
                                <p className="text-xs text-[#6B7280]">
                                  Slack
                                </p>
                                <p className="k2-title text-sm font-medium text-[#111827]">{K2_DATA[3][k2Found[3] ? 'found' : 'searching']}</p>
                              </div>
                            </div>
                            <K2Badge found={k2Found[3]} />
                          </div>
                        </div>
                      </div>
                      {/* Chân panel 2 */}
                      <div className="pt-4 border-t border-[#F0F0EB] text-xs text-[#6B7280]">
                        <span>
                          Không yêu cầu bạn phải điền ID bảng hay cấu hình API phức tạp.
                        </span>
                      </div>
                    </div>
                    {/* ================= KHOẢNH KHẮC 3 (DESKTOP) ================= */}
                    <div id="stage-panel-3" className={`stage-card-panel ${moment === 3 ? 'is-active' : 'is-hidden'} flex-1 flex flex-col justify-between`} aria-hidden={moment === 3 ? 'false' : 'true'} inert={moment !== 3}>
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <span className="text-xs font-medium text-[#FF5701] uppercase tracking-wider">
                              Cần duyệt trước khi làm
                            </span>
                            {' '}
                            <p className="text-sm font-semibold text-[#111827]">
                              Kế hoạch 4 bước đề xuất
                            </p>
                          </div>
                          <span className="text-xs text-[#9CA3AF]">
                            Khoảnh khắc 3 / 5
                          </span>
                        </div>
                        {/* 4 thẻ việc xem trước */}
                        <div className="v3-space-y-2.5 mb-4">
                          {/* Thẻ 1: Trello */}
                          <div className="p-2.5 rounded-xl border border-[#E7E7E2] bg-[#FAFAF8] text-xs flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 rounded bg-[#0079BF]/10 text-[#0079BF] font-semibold">
                                Trello
                              </span>
                              <span className="text-[#111827]">
                                {"Tạo card "}
                                <strong className="font-medium">
                                  "Sửa lỗi đăng nhập Google"
                                </strong>
                                {" trong danh sách "}
                                <span className="text-[#6B7280]">
                                  Doing
                                </span>
                              </span>
                            </div>
                            <span className="text-[11px] text-[#6B7280]">
                              Xem trước
                            </span>
                          </div>
                          {/* Thẻ 2: GitHub */}
                          <div className="p-2.5 rounded-xl border border-[#E7E7E2] bg-[#FAFAF8] text-xs flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 rounded bg-[#24292E]/10 text-[#24292E] font-semibold">
                                GitHub
                              </span>
                              <span className="text-[#111827]">
                                {"Tạo issue trong kho "}
                                <strong className="font-medium">
                                  ati-test
                                </strong>
                                {" có link card"}
                              </span>
                            </div>
                            <span className="text-[11px] text-[#6B7280]">
                              Xem trước
                            </span>
                          </div>
                          {/* Thẻ 3: Google Sheets */}
                          <div className="p-2.5 rounded-xl border border-[#E7E7E2] bg-[#FAFAF8] text-xs flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 rounded bg-[#0F9D58]/10 text-[#0F9D58] font-semibold">
                                Sheets
                              </span>
                              <span className="text-[#111827]">
                                {"Thêm một dòng vào trang "}
                                <strong className="font-medium">
                                  Tasks
                                </strong>
                              </span>
                            </div>
                            <span className="text-[11px] text-[#6B7280]">
                              Xem trước
                            </span>
                          </div>
                          {/* Thẻ 4: Slack (mở phần xem trước nguyên văn tin) */}
                          <div className="p-3 rounded-xl border border-[#FF5701]/30 bg-[#FFF9F6] text-xs">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <span className="px-2 py-0.5 rounded bg-[#4A154B]/10 text-[#4A154B] font-semibold">
                                  Slack
                                </span>
                                <span className="font-medium text-[#111827]">
                                  Gửi tin vào kênh #ati-test
                                </span>
                              </div>
                              <span className="text-[11px] font-medium text-[#FF5701]">
                                Đang mở xem trước
                              </span>
                            </div>
                            {/* Nguyên văn tin Slack sẽ gửi đi */}
                            <div className="p-2.5 rounded-lg bg-white border border-[#E7E7E2] text-xs text-[#374151] leading-relaxed">
                              <p className="text-[#111827]">
                                Đã tạo card Trello và issue GitHub cho lỗi đăng nhập Google.
                              </p>
                              <p className="text-[11px] text-[#6B7280] mt-1.5">
                                Link card và issue được điền sau khi tạo xong.
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                      {/* Nút cam Duyệt kế hoạch sáng lên */}
                      <div className="pt-3 border-t border-[#F0F0EB] flex items-center justify-between">
                        <span className="text-xs text-[#6B7280]">
                          Chưa ghi bất kỳ dữ liệu nào
                        </span>
                        <button type="button" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#FF5701] text-white text-xs font-semibold shadow-md shadow-[#FF5701]/25 hover:bg-[#E04C00] transition-transform active:scale-95 focus-visible:v3-outline-none">
                          <span>
                            Duyệt kế hoạch
                          </span>
                          <span>
                            ✓
                          </span>
                        </button>
                      </div>
                    </div>
                    {/* ================= KHOẢNH KHẮC 4 (DESKTOP) ================= */}
                    <div id="stage-panel-4" className={`stage-card-panel ${moment === 4 ? 'is-active' : 'is-hidden'} flex-1 flex flex-col justify-between`} aria-hidden={moment === 4 ? 'false' : 'true'} inert={moment !== 4}>
                      <div>
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <span className="text-xs font-medium text-[#16A34A] uppercase tracking-wider">
                              Đang tiến hành
                            </span>
                            {' '}
                            <p className="text-sm font-semibold text-[#111827]">
                              Thực hiện lần lượt 4 việc
                            </p>
                          </div>
                          <span className="text-xs text-[#9CA3AF]">
                            Khoảnh khắc 4 / 5
                          </span>
                        </div>
                        {/* Hành trình 4 việc: việc xong có check và link, việc đang làm sáng cam */}
                        <div className="v3-space-y-3">
                          {/* Bước 1: Xong */}
                          <div className="p-3 rounded-xl border border-[#16A34A]/25 bg-[#F0FDF4] flex items-center justify-between text-xs">
                            <div className="flex items-center gap-3">
                              <span className="w-6 h-6 rounded-full bg-[#16A34A] text-white flex items-center justify-center font-bold text-[11px]">
                                ✓
                              </span>
                              <div>
                                <p className="font-medium text-[#111827]">
                                  1. Tạo card Trello "Sửa lỗi đăng nhập Google"
                                </p>
                                <p className="text-[11px] text-[#16A34A]">
                                  Đã tạo trong danh sách Doing
                                </p>
                              </div>
                            </div>
                            <span className="text-[11px] text-[#0079BF] font-mono underline">
                              Mở card ↗
                            </span>
                          </div>
                          {/* Bước 2: Xong */}
                          <div className="p-3 rounded-xl border border-[#16A34A]/25 bg-[#F0FDF4] flex items-center justify-between text-xs">
                            <div className="flex items-center gap-3">
                              <span className="w-6 h-6 rounded-full bg-[#16A34A] text-white flex items-center justify-center font-bold text-[11px]">
                                ✓
                              </span>
                              <div>
                                <p className="font-medium text-[#111827]">
                                  2. Tạo issue GitHub trong kho ati-test
                                </p>
                                <p className="text-[11px] text-[#16A34A]">
                                  Đã liên kết kèm link card Trello
                                </p>
                              </div>
                            </div>
                            <span className="text-[11px] text-[#24292E] font-mono underline">
                              issue #42 ↗
                            </span>
                          </div>
                          {/* Bước 3: Đang làm sáng cam */}
                          <div className="p-3 rounded-xl border-2 border-[#FF5701] bg-[#FFF3ED] flex items-center justify-between text-xs shadow-sm">
                            <div className="flex items-center gap-3">
                              <span className="w-6 h-6 rounded-full bg-[#FF5701] text-white flex items-center justify-center pulse-ring-active text-[11px]">
                                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                                  {' '}
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  {' '}
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                                  {' '}
                                </svg>
                              </span>
                              <div>
                                <p className="font-semibold text-[#111827]">
                                  3. Ghi vào Google Sheets
                                </p>
                                <p className="text-[11px] text-[#FF5701] font-medium">
                                  Đang thêm dòng vào trang Tasks...
                                </p>
                              </div>
                            </div>
                            <span className="px-2 py-0.5 rounded-full bg-[#FF5701] text-white text-[10px] font-medium">
                              Đang làm
                            </span>
                          </div>
                          {/* Bước 4: Chờ */}
                          <div className="p-3 rounded-xl border border-[#E7E7E2] bg-[#FAFAF8] opacity-60 flex items-center justify-between text-xs">
                            <div className="flex items-center gap-3">
                              <span className="w-6 h-6 rounded-full bg-[#E7E7E2] text-[#6B7280] flex items-center justify-center text-[11px]">
                                4
                              </span>
                              <div>
                                <p className="font-medium text-[#6B7280]">
                                  4. Gửi tin vào kênh #ati-test trên Slack
                                </p>
                                <p className="text-[11px] text-[#9CA3AF]">
                                  Chờ bước 3 hoàn thành
                                </p>
                              </div>
                            </div>
                            <span className="text-[11px] text-[#9CA3AF]">
                              Đang chờ
                            </span>
                          </div>
                        </div>
                      </div>
                      {/* Chân panel 4 */}
                      <div className="pt-4 border-t border-[#F0F0EB] text-xs text-[#6B7280]">
                        <span>
                          Nếu mạng gặp sự cố, hệ thống sẽ dừng lại hỏi bạn, không tự ý chạy lại.
                        </span>
                      </div>
                    </div>
                    {/* ================= KHOẢNH KHẮC 5 (DESKTOP) ================= */}
                    <div id="stage-panel-5" className={`stage-card-panel ${moment === 5 ? 'is-active' : 'is-hidden'} flex-1 flex flex-col justify-between`} aria-hidden={moment === 5 ? 'false' : 'true'} inert={moment !== 5}>
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <span className="text-xs font-medium text-[#16A34A] uppercase tracking-wider">
                              Hoàn tất 4/4 việc
                            </span>
                            {' '}
                            <p className="text-sm font-semibold text-[#111827]">
                              Biên nhận có đường dẫn kiểm tra
                            </p>
                          </div>
                          <span className="text-xs text-[#9CA3AF]">
                            Khoảnh khắc 5 / 5
                          </span>
                        </div>
                        {/* 4 biên nhận nối với nhau */}
                        <div className="grid grid-cols-2 gap-3 relative pt-2 pb-2">
                          {/* Biên nhận 1: Trello */}
                          <div className="p-3 rounded-xl border border-[#E7E7E2] bg-[#FAFAF8] shadow-sm relative">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[10px] font-semibold text-[#0079BF] uppercase">
                                Trello
                              </span>
                              <span className="text-[10px] text-[#16A34A] font-medium">
                                ✓ Đã tạo
                              </span>
                            </div>
                            <p className="text-xs font-medium text-[#111827] line-clamp-1">
                              Card "Sửa lỗi đăng nhập Google"
                            </p>
                            {' '}
                            <a href="#trello-receipt" className="mt-2 inline-flex items-center gap-1 text-[11px] text-[#0079BF] font-medium hover:underline">
                              <span>
                                Mở card
                              </span>
                              <span>
                                ↗
                              </span>
                            </a>
                          </div>
                          {/* Biên nhận 2: GitHub */}
                          <div className="p-3 rounded-xl border border-[#E7E7E2] bg-[#FAFAF8] shadow-sm relative">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[10px] font-semibold text-[#24292E] uppercase">
                                GitHub
                              </span>
                              <span className="text-[10px] text-[#16A34A] font-medium">
                                ✓ Đã tạo
                              </span>
                            </div>
                            <p className="text-xs font-medium text-[#111827] line-clamp-1">
                              Issue #42 trong ati-test
                            </p>
                            {' '}
                            <a href="#github-receipt" className="mt-2 inline-flex items-center gap-1 text-[11px] text-[#24292E] font-medium hover:underline">
                              <span>
                                Mở issue
                              </span>
                              <span>
                                ↗
                              </span>
                            </a>
                          </div>
                          {/* Nhãn nối giữa 1 và 2 */}
                          <div className="col-span-2 flex items-center justify-center -my-1">
                            <span className="px-2 py-0.5 rounded-full bg-white border border-[#E7E7E2] text-[10px] font-mono text-[#6B7280] shadow-sm">
                              {" truyền link card → "}
                            </span>
                          </div>
                          {/* Biên nhận 3: Google Sheets */}
                          <div className="p-3 rounded-xl border border-[#E7E7E2] bg-[#FAFAF8] shadow-sm relative">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[10px] font-semibold text-[#0F9D58] uppercase">
                                Google Sheets
                              </span>
                              <span className="text-[10px] text-[#16A34A] font-medium">
                                ✓ Đã ghi
                              </span>
                            </div>
                            <p className="text-xs font-medium text-[#111827] line-clamp-1">
                              Dòng 104 trang Tasks
                            </p>
                            {' '}
                            <a href="#sheets-receipt" className="mt-2 inline-flex items-center gap-1 text-[11px] text-[#0F9D58] font-medium hover:underline">
                              <span>
                                Mở bảng tính
                              </span>
                              <span>
                                ↗
                              </span>
                            </a>
                          </div>
                          {/* Biên nhận 4: Slack */}
                          <div className="p-3 rounded-xl border border-[#E7E7E2] bg-[#FAFAF8] shadow-sm relative">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[10px] font-semibold text-[#4A154B] uppercase">
                                Slack
                              </span>
                              <span className="text-[10px] text-[#16A34A] font-medium">
                                ✓ Đã gửi
                              </span>
                            </div>
                            <p className="text-xs font-medium text-[#111827] line-clamp-1">
                              Tin nhắn vào #ati-test
                            </p>
                            {' '}
                            <a href="#slack-receipt" className="mt-2 inline-flex items-center gap-1 text-[11px] text-[#4A154B] font-medium hover:underline">
                              <span>
                                Mở tin nhắn
                              </span>
                              <span>
                                ↗
                              </span>
                            </a>
                          </div>
                          {/* Nhãn nối giữa 3 và 4 */}
                          <div className="col-span-2 flex items-center justify-center -my-1">
                            <span className="px-2 py-0.5 rounded-full bg-white border border-[#E7E7E2] text-[10px] font-mono text-[#6B7280] shadow-sm">
                              {" truyền link issue + link card → "}
                            </span>
                          </div>
                        </div>
                      </div>
                      {/* Chân panel 5 */}
                      <div className="pt-3 border-t border-[#F0F0EB] flex items-center justify-between text-xs">
                        <span className="text-[#6B7280]">
                          Mở từng đường dẫn để kiểm tra trên công cụ đó.
                        </span>
                        <a href="#signup" onClick={authLink('signup')} className="text-xs font-semibold text-[#FF5701] hover:underline">
                          Thử với yêu cầu của bạn →
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            {/* ==================================================== */}
            {/* KHUNG MOBILE / TABLET (< 1024px): XẾP CHỒNG DỌC TĨNH */}
            {/* ==================================================== */}
            <div className="stage-fallback-list lg:hidden v3-space-y-12">
              {/* Mobile Khoảnh khắc 1 */}
              <div className="bg-white rounded-2xl border border-[#E7E7E2] p-5 shadow-soft-card">
                <div className="inline-flex items-center gap-2 text-xs font-mono font-medium text-[#FF5701] mb-2">
                  <span className="w-5 h-5 rounded-full bg-[#FFF3ED] border border-[#FF5701]/30 flex items-center justify-center font-bold text-xs">
                    1
                  </span>
                  <span>
                    KHOẢNH KHẮC 1
                  </span>
                </div>
                {' '}
                <h3 className="font-display text-2xl text-[#111827] font-semibold mb-2">
                  Bạn nói bằng lời thường
                </h3>
                <p className="text-sm text-[#4B5563] mb-4">
                  Không cần học câu lệnh. Bạn cứ gõ việc cần làm bằng tiếng Việt tự nhiên như đang nhắn cho đồng nghiệp.
                </p>
                <div className="p-3.5 rounded-xl border border-[#FF5701]/30 bg-[#FAFAFA] text-xs text-[#111827] leading-relaxed">
                  <span className="text-[#6B7280] block text-[11px] mb-1">
                    Ví dụ yêu cầu:
                  </span>
                  "Tạo card Trello cho lỗi đăng nhập Google, tạo issue GitHub, ghi vào Google Sheets và báo kênh Slack"
                </div>
              </div>
              {/* Mobile Khoảnh khắc 2 */}
              <div className="bg-white rounded-2xl border border-[#E7E7E2] p-5 shadow-soft-card">
                <div className="inline-flex items-center gap-2 text-xs font-mono font-medium text-[#FF5701] mb-2">
                  <span className="w-5 h-5 rounded-full bg-[#FFF3ED] border border-[#FF5701]/30 flex items-center justify-center font-bold text-xs">
                    2
                  </span>
                  <span>
                    KHOẢNH KHẮC 2
                  </span>
                </div>
                {' '}
                <h3 className="font-display text-2xl text-[#111827] font-semibold mb-2">
                  Tôi tự tìm đúng chỗ
                </h3>
                <p className="text-sm text-[#4B5563] mb-4">
                  ATI tự tìm đúng bảng việc, kho mã, bảng tính hay kênh trao đổi mà bạn không cần điền link hay mã ID.
                </p>
                <div className="v3-space-y-2 text-xs">
                  <div className="p-2.5 rounded-lg border border-[#E7E7E2] bg-[#FAFAF8] flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-6 h-6 rounded-md bg-[#0079BF]/10 flex items-center justify-center p-1 flex-shrink-0">
                        <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none">
                          {' '}
                          <rect width="24" height="24" rx="4" fill="#0079BF" />
                          {' '}
                          <rect x="4" y="4" width="6.5" height="13" rx="1.5" fill="white" />
                          {' '}
                          <rect x="13.5" y="4" width="6.5" height="8.5" rx="1.5" fill="white" />
                          {' '}
                        </svg>
                      </div>
                      <span className="font-medium text-[#111827]">
                        Trello: Bảng To Do
                      </span>
                    </div>
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#16A34A] bg-[#F0FDF4] px-2 py-0.5 rounded border border-[#16A34A]/20">
                      ✓ Đã thấy
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg border border-[#E7E7E2] bg-[#FAFAF8] flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-6 h-6 rounded-md bg-[#24292E]/10 flex items-center justify-center p-1 flex-shrink-0">
                        <svg className="w-4 h-4 text-[#24292E] flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                          {' '}
                          <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                          {' '}
                        </svg>
                      </div>
                      <span className="font-medium text-[#111827]">
                        GitHub: Kho mã ati-test
                      </span>
                    </div>
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#16A34A] bg-[#F0FDF4] px-2 py-0.5 rounded border border-[#16A34A]/20">
                      ✓ Đã thấy
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg border border-[#E7E7E2] bg-[#FAFAF8] flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-6 h-6 rounded-md bg-[#0F9D58]/10 flex items-center justify-center p-1 flex-shrink-0">
                        <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none">
                          {' '}
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" fill="#0F9D58" />
                          {' '}
                          <path d="M14 2v6h6l-6-6z" fill="#87CEAB" />
                          {' '}
                          <rect x="7" y="11" width="10" height="7" rx="0.5" fill="white" fillOpacity="0.3" />
                          {' '}
                          <line x1="7" y1="14" x2="17" y2="14" stroke="white" strokeWidth="1" />
                          {' '}
                          <line x1="11" y1="11" x2="11" y2="18" stroke="white" strokeWidth="1" />
                          {' '}
                        </svg>
                      </div>
                      <span className="font-medium text-[#111827]">
                        Sheets: Bảng tính ATI Test Tracker
                      </span>
                    </div>
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#16A34A] bg-[#F0FDF4] px-2 py-0.5 rounded border border-[#16A34A]/20">
                      ✓ Đã thấy
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg border border-[#E7E7E2] bg-[#FAFAF8] flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-6 h-6 rounded-md bg-[#4A154B]/10 flex items-center justify-center p-1 flex-shrink-0">
                        <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none">
                          {' '}
                          <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.528 2.528 0 0 1 2.521-2.52 2.528 2.528 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#E01E5A" />
                          {' '}
                          <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#36C5F0" />
                          {' '}
                          <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="#2EB67D" />
                          {' '}
                          <path d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.527 2.527 0 0 1 2.52-2.52h6.313A2.528 2.528 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="#ECB22E" />
                          {' '}
                        </svg>
                      </div>
                      <span className="font-medium text-[#111827]">
                        Slack: Kênh #ati-test
                      </span>
                    </div>
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#16A34A] bg-[#F0FDF4] px-2 py-0.5 rounded border border-[#16A34A]/20">
                      ✓ Đã thấy
                    </span>
                  </div>
                </div>
              </div>
              {/* Mobile Khoảnh khắc 3 */}
              <div className="bg-white rounded-2xl border border-[#E7E7E2] p-5 shadow-soft-card">
                <div className="inline-flex items-center gap-2 text-xs font-mono font-medium text-[#FF5701] mb-2">
                  <span className="w-5 h-5 rounded-full bg-[#FFF3ED] border border-[#FF5701]/30 flex items-center justify-center font-bold text-xs">
                    3
                  </span>
                  <span>
                    KHOẢNH KHẮC 3
                  </span>
                </div>
                {' '}
                <h3 className="font-display text-2xl text-[#111827] font-semibold mb-2">
                  Bạn xem trước, rồi mới duyệt
                </h3>
                <p className="text-sm text-[#4B5563] mb-4">
                  Xem rõ từng thẻ việc và nguyên văn nội dung sẽ gửi đi. Chỉ thực thi khi bạn bấm duyệt.
                </p>
                <div className="p-3 rounded-xl border border-[#FF5701]/30 bg-[#FFF9F6] text-xs mb-3">
                  <p className="font-medium text-[#111827] mb-1.5">
                    Xem trước tin Slack:
                  </p>
                  <div className="p-2.5 rounded-lg bg-white border border-[#E7E7E2] text-xs text-[#374151] leading-relaxed">
                    <p className="text-[#111827]">
                      Đã tạo card Trello và issue GitHub cho lỗi đăng nhập Google.
                    </p>
                    <p className="text-[11px] text-[#6B7280] mt-1.5">
                      Link card và issue được điền sau khi tạo xong.
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="inline-block px-4 py-2 rounded-xl bg-[#FF5701] text-white text-xs font-semibold">
                    {" Duyệt kế hoạch ✓ "}
                  </span>
                </div>
              </div>
              {/* Mobile Khoảnh khắc 4 */}
              <div className="bg-white rounded-2xl border border-[#E7E7E2] p-5 shadow-soft-card">
                <div className="inline-flex items-center gap-2 text-xs font-mono font-medium text-[#FF5701] mb-2">
                  <span className="w-5 h-5 rounded-full bg-[#FFF3ED] border border-[#FF5701]/30 flex items-center justify-center font-bold text-xs">
                    4
                  </span>
                  <span>
                    KHOẢNH KHẮC 4
                  </span>
                </div>
                {' '}
                <h3 className="font-display text-2xl text-[#111827] font-semibold mb-2">
                  Tôi làm lần lượt, bạn thấy từng bước
                </h3>
                <p className="text-sm text-[#4B5563] mb-4">
                  Hành trình chạy thực tế theo thứ tự. Bạn luôn biết bước nào đã xong, bước nào đang chạy.
                </p>
                <div className="v3-space-y-2 text-xs">
                  <div className="p-2.5 rounded-lg bg-[#F0FDF4] border border-[#16A34A]/20 flex justify-between">
                    <span>
                      1. Trello card
                    </span>
                    <span className="text-[#16A34A] font-medium">
                      ✓ Đã xong (Mở card ↗)
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[#F0FDF4] border border-[#16A34A]/20 flex justify-between">
                    <span>
                      2. GitHub issue
                    </span>
                    <span className="text-[#16A34A] font-medium">
                      ✓ Đã xong (issue #42)
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[#FFF3ED] border border-[#FF5701] flex justify-between font-medium text-[#FF5701]">
                    <span>
                      3. Ghi vào Google Sheets
                    </span>
                    <span>
                      Đang làm...
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[#FAFAF8] border border-[#E7E7E2] flex justify-between text-[#6B7280]">
                    <span>
                      4. Gửi tin Slack
                    </span>
                    <span>
                      Chờ bước 3
                    </span>
                  </div>
                </div>
              </div>
              {/* Mobile Khoảnh khắc 5 */}
              <div className="bg-white rounded-2xl border border-[#E7E7E2] p-5 shadow-soft-card">
                <div className="inline-flex items-center gap-2 text-xs font-mono font-medium text-[#FF5701] mb-2">
                  <span className="w-5 h-5 rounded-full bg-[#FFF3ED] border border-[#FF5701]/30 flex items-center justify-center font-bold text-xs">
                    5
                  </span>
                  <span>
                    KHOẢNH KHẮC 5
                  </span>
                </div>
                {' '}
                <h3 className="font-display text-2xl text-[#111827] font-semibold mb-2">
                  Xong, kèm đường dẫn tới từng kết quả
                </h3>
                <p className="text-sm text-[#4B5563] mb-4">
                  Mỗi bước hoàn thành đều có đường dẫn trực tiếp để bạn bấm mở kiểm tra kết quả ngay lập tức.
                </p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 rounded-lg border border-[#E7E7E2] bg-[#FAFAF8]">
                    <p className="font-medium text-[#111827]">
                      Trello
                    </p>
                    <a href="#trello-receipt" className="text-[11px] text-[#0079BF] underline mt-1 block">
                      Mở card ↗
                    </a>
                  </div>
                  <div className="p-2.5 rounded-lg border border-[#E7E7E2] bg-[#FAFAF8]">
                    <p className="font-medium text-[#111827]">
                      GitHub
                    </p>
                    <a href="#github-receipt" className="text-[11px] text-[#24292E] underline mt-1 block">
                      Mở issue #42 ↗
                    </a>
                  </div>
                  <div className="p-2.5 rounded-lg border border-[#E7E7E2] bg-[#FAFAF8]">
                    <p className="font-medium text-[#111827]">
                      Sheets (Dòng 104)
                    </p>
                    <a href="#sheets-receipt" className="text-[11px] text-[#0F9D58] underline mt-1 block">
                      Mở bảng tính ↗
                    </a>
                  </div>
                  <div className="p-2.5 rounded-lg border border-[#E7E7E2] bg-[#FAFAF8]">
                    <p className="font-medium text-[#111827]">
                      Slack
                    </p>
                    <a href="#slack-receipt" className="text-[11px] text-[#4A154B] underline mt-1 block">
                      Mở tin nhắn ↗
                    </a>
                  </div>
                </div>
                <p className="text-xs text-[#6B7280] mt-3">
                  Mở từng đường dẫn để kiểm tra trên công cụ đó.
                </p>
              </div>
            </div>
          </div>
        </section>
        {/* ========================================== */}
        {/* 4. "BẠN LUÔN LÀ NGƯỜI QUYẾT ĐỊNH" */}
        {/* ========================================== */}
        <section className="py-16 sm:py-24 border-b border-[#E7E7E2] bg-[#F8F8F6]" data-od-id="principles-section">
          <div className="max-w-5xl mx-auto px-4 sm:px-6">
            <div className="text-center max-w-2xl mx-auto mb-12 sm:mb-16">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#FF5701] mb-2">
                Nguyên tắc cốt lõi
              </p>
              <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl text-[#111827] font-semibold tracking-tight">
                Bạn luôn là người quyết định
              </h2>
              <p className="text-sm sm:text-base text-[#6B7280] mt-3">
                Sản phẩm được thiết kế với sự cẩn trọng tối đa để bạn hoàn toàn an tâm khi giao việc.
              </p>
            </div>
            {/* 3 khối ngắn có biểu tượng SVG thanh mảnh */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8 mb-12">
              {/* Khối 1 */}
              <div className="bg-white rounded-2xl p-7 border border-[#E7E7E2] shadow-soft-card flex flex-col justify-between" data-od-id="card-principle-1">
                <div>
                  <div className="w-12 h-12 rounded-xl bg-[#FFF3ED] text-[#FF5701] flex items-center justify-center mb-6">
                    {/* SVG Check-shield / Lock */}
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      {' '}
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      {' '}
                    </svg>
                  </div>
                  <h3 className="font-display text-xl font-semibold text-[#111827] mb-3 leading-snug">
                    Không ghi gì khi chưa được duyệt
                  </h3>
                  <p className="text-sm text-[#4B5563] leading-relaxed">
                    Hệ thống chỉ đọc và lên kế hoạch. Không có bất kỳ thẻ, dòng tính hay tin nhắn nào được gửi ra ngoài khi bạn chưa nhấn duyệt.
                  </p>
                </div>
              </div>
              {/* Khối 2 */}
              <div className="bg-white rounded-2xl p-7 border border-[#E7E7E2] shadow-soft-card flex flex-col justify-between" data-od-id="card-principle-2">
                <div>
                  <div className="w-12 h-12 rounded-xl bg-[#FFF3ED] text-[#FF5701] flex items-center justify-center mb-6">
                    {/* SVG Eye / Preview */}
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      {' '}
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      {' '}
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      {' '}
                    </svg>
                  </div>
                  <h3 className="font-display text-xl font-semibold text-[#111827] mb-3 leading-snug">
                    Xem trước đúng nội dung sẽ gửi đi
                  </h3>
                  <p className="text-sm text-[#4B5563] leading-relaxed">
                    Mọi chi tiết từ tiêu đề card, kho mã đích, dòng bảng tính cho đến nguyên văn tin nhắn đều được hiển thị rõ ràng trước mắt bạn.
                  </p>
                </div>
              </div>
              {/* Khối 3 */}
              <div className="bg-white rounded-2xl p-7 border border-[#E7E7E2] shadow-soft-card flex flex-col justify-between" data-od-id="card-principle-3">
                <div>
                  <div className="w-12 h-12 rounded-xl bg-[#FFF3ED] text-[#FF5701] flex items-center justify-center mb-6">
                    {/* SVG Alert-circle / Question */}
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      {' '}
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      {' '}
                    </svg>
                  </div>
                  <h3 className="font-display text-xl font-semibold text-[#111827] mb-3 leading-snug">
                    Không chắc thì dừng lại hỏi bạn, không tự làm lại
                  </h3>
                  <p className="text-sm text-[#4B5563] leading-relaxed">
                    Nếu mạng gián đoạn đúng lúc đang ghi, hệ thống không chắc việc đã xong hay chưa nên sẽ dừng lại hỏi bạn, tuyệt đối không tự làm lại để tránh nhân đôi dữ liệu.
                  </p>
                </div>
              </div>
            </div>
            {/* Dòng làm nổi bật đặc biệt theo yêu cầu */}
            <div className="p-5 sm:p-6 rounded-2xl bg-white border border-[#E7E7E2] shadow-sm flex items-center gap-4 text-center sm:text-left justify-center">
              <div className="hidden sm:flex w-10 h-10 rounded-xl bg-[#F8F8F6] border border-[#E7E7E2] items-center justify-center text-[#4B5563] flex-shrink-0">
                <svg className="w-5 h-5 text-[#FF5701]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  {' '}
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  {' '}
                </svg>
              </div>
              <p className="text-sm sm:text-base font-medium text-[#111827]">
                Chỉ làm trên những bảng, kênh, kho mã mà quản trị viên đã cho phép.
              </p>
            </div>
          </div>
        </section>
        {/* ========================================== */}
        {/* 5. "DÙNG VỚI CÔNG CỤ NHÓM BẠN ĐANG CÓ" */}
        {/* ========================================== */}
        <section className="py-16 sm:py-24 border-b border-[#E7E7E2] bg-white" data-od-id="integrations-section">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="text-center max-w-2xl mx-auto mb-12 sm:mb-16">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#FF5701] mb-2">
                Hệ sinh thái kết nối
              </p>
              <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl text-[#111827] font-semibold tracking-tight">
                Dùng với công cụ nhóm bạn đang có
              </h2>
              <p className="text-sm sm:text-base text-[#6B7280] mt-3">
                Không cần chuyển đổi phần mềm làm việc. ATI liên kết trực tiếp với các dịch vụ quen thuộc của bạn.
              </p>
            </div>
            {/* Lưới 8 dịch vụ, mỗi dịch vụ 1 card trang nhã */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 sm:gap-6">
              {/* 1. Trello */}
              <div className="bg-[#F8F8F6] hover:bg-white rounded-2xl p-6 border border-[#E7E7E2] transition-all hover:shadow-soft-card flex flex-col justify-between group">
                <div>
                  <div className="w-11 h-11 rounded-xl bg-[#0079BF]/10 flex items-center justify-center mb-5 group-hover:scale-105 transition-transform">
                    {/* Trello SVG */}
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
                      {' '}
                      <rect width="24" height="24" rx="4" fill="#0079BF" />
                      {' '}
                      <rect x="4" y="4" width="6.5" height="13" rx="1.5" fill="white" />
                      {' '}
                      <rect x="13.5" y="4" width="6.5" height="8.5" rx="1.5" fill="white" />
                      {' '}
                    </svg>
                  </div>
                  <h3 className="font-display text-lg font-semibold text-[#111827] mb-2">
                    Trello
                  </h3>
                  <p className="text-xs sm:text-sm text-[#4B5563] leading-relaxed">
                    Tạo, cập nhật card, gán người, thêm checklist.
                  </p>
                </div>
              </div>
              {/* 2. Slack */}
              <div className="bg-[#F8F8F6] hover:bg-white rounded-2xl p-6 border border-[#E7E7E2] transition-all hover:shadow-soft-card flex flex-col justify-between group">
                <div>
                  <div className="w-11 h-11 rounded-xl bg-[#4A154B]/10 flex items-center justify-center mb-5 group-hover:scale-105 transition-transform">
                    {/* Slack SVG */}
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
                      {' '}
                      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.528 2.528 0 0 1 2.521-2.52 2.528 2.528 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#E01E5A" />
                      {' '}
                      <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#36C5F0" />
                      {' '}
                      <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="#2EB67D" />
                      {' '}
                      <path d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.528 2.528 0 0 1-2.52-2.523 2.528 2.528 0 0 1 2.52-2.52h6.313A2.528 2.528 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="#ECB22E" />
                      {' '}
                    </svg>
                  </div>
                  <h3 className="font-display text-lg font-semibold text-[#111827] mb-2">
                    Slack
                  </h3>
                  <p className="text-xs sm:text-sm text-[#4B5563] leading-relaxed">
                    Gửi tin vào kênh.
                  </p>
                </div>
              </div>
              {/* 3. GitHub */}
              <div className="bg-[#F8F8F6] hover:bg-white rounded-2xl p-6 border border-[#E7E7E2] transition-all hover:shadow-soft-card flex flex-col justify-between group">
                <div>
                  <div className="w-11 h-11 rounded-xl bg-[#24292E]/10 flex items-center justify-center mb-5 group-hover:scale-105 transition-transform">
                    {/* GitHub SVG */}
                    <svg className="w-6 h-6 text-[#24292E]" fill="currentColor" viewBox="0 0 24 24">
                      {' '}
                      <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                      {' '}
                    </svg>
                  </div>
                  <h3 className="font-display text-lg font-semibold text-[#111827] mb-2">
                    GitHub
                  </h3>
                  <p className="text-xs sm:text-sm text-[#4B5563] leading-relaxed">
                    Tạo issue, gắn nhãn.
                  </p>
                </div>
              </div>
              {/* 4. Google Sheets */}
              <div className="bg-[#F8F8F6] hover:bg-white rounded-2xl p-6 border border-[#E7E7E2] transition-all hover:shadow-soft-card flex flex-col justify-between group">
                <div>
                  <div className="w-11 h-11 rounded-xl bg-[#0F9D58]/10 flex items-center justify-center mb-5 group-hover:scale-105 transition-transform">
                    {/* Sheets SVG */}
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
                      {' '}
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" fill="#0F9D58" />
                      {' '}
                      <path d="M14 2v6h6l-6-6z" fill="#87CEAB" />
                      {' '}
                      <rect x="7" y="11" width="10" height="7" rx="0.5" fill="white" fillOpacity="0.3" />
                      {' '}
                      <line x1="7" y1="14" x2="17" y2="14" stroke="white" strokeWidth="1" />
                      {' '}
                      <line x1="11" y1="11" x2="11" y2="18" stroke="white" strokeWidth="1" />
                      {' '}
                    </svg>
                  </div>
                  <h3 className="font-display text-lg font-semibold text-[#111827] mb-2">
                    Google Sheets
                  </h3>
                  <p className="text-xs sm:text-sm text-[#4B5563] leading-relaxed">
                    Đọc và thêm dòng.
                  </p>
                </div>
              </div>
              {/* 5. Google Calendar */}
              <div className="bg-[#F8F8F6] hover:bg-white rounded-2xl p-6 border border-[#E7E7E2] transition-all hover:shadow-soft-card flex flex-col justify-between group">
                <div>
                  <div className="w-11 h-11 rounded-xl bg-[#4285F4]/10 flex items-center justify-center mb-5 group-hover:scale-105 transition-transform">
                    {/* Calendar SVG */}
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
                      {' '}
                      <rect x="3" y="4" width="18" height="17" rx="3" fill="#4285F4" />
                      {' '}
                      <rect x="3" y="4" width="18" height="5" fill="#1967D2" />
                      {' '}
                      <circle cx="7" cy="2.5" r="1.5" fill="#1967D2" />
                      {' '}
                      <circle cx="17" cy="2.5" r="1.5" fill="#1967D2" />
                      {' '}
                      <text x="12" y="17" fill="white" fontSize="8" fontFamily="sans-serif" fontWeight="bold" textAnchor="middle">
                        31
                      </text>
                      {' '}
                    </svg>
                  </div>
                  <h3 className="font-display text-lg font-semibold text-[#111827] mb-2">
                    Google Calendar
                  </h3>
                  <p className="text-xs sm:text-sm text-[#4B5563] leading-relaxed">
                    Xem lịch, tạo sự kiện.
                  </p>
                </div>
              </div>
              {/* 6. Notion */}
              <div className="bg-[#F8F8F6] hover:bg-white rounded-2xl p-6 border border-[#E7E7E2] transition-all hover:shadow-soft-card flex flex-col justify-between group">
                <div>
                  <div className="w-11 h-11 rounded-xl bg-black/5 flex items-center justify-center mb-5 group-hover:scale-105 transition-transform">
                    {/* Notion SVG */}
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
                      {' '}
                      <path fillRule="evenodd" clipRule="evenodd" d="M4.222 3.125l13.774-1.12c1.38-.112 1.954.267 2.502.933l2.808 3.444c.433.533.693 1.155.693 1.777v12.22c0 1.2-.544 1.866-1.843 1.977l-14.88 1.111c-1.378.111-2.04-.333-2.589-1l-2.016-2.555c-.443-.555-.67-1.222-.67-1.778V4.88c0-1.111.66-1.666 2.22-1.755zm14.153 1.867L7.332 5.88c-.328.026-.453.18-.453.373v11.758c0 .24.125.4.375.373l11.043-.88c.328-.027.422-.24.422-.453V5.419c0-.24-.125-.4-.344-.427zM9.47 7.915l3.593-.24 3.03 5.467V7.435l2.25-.16v8.425l-3.375.24-3.25-5.653v5.626l-2.25.16V7.915z" fill="#111827" />
                      {' '}
                    </svg>
                  </div>
                  <h3 className="font-display text-lg font-semibold text-[#111827] mb-2">
                    Notion
                  </h3>
                  <p className="text-xs sm:text-sm text-[#4B5563] leading-relaxed">
                    Tạo trang, thêm nội dung.
                  </p>
                </div>
              </div>
              {/* 7. Telegram */}
              <div className="bg-[#F8F8F6] hover:bg-white rounded-2xl p-6 border border-[#E7E7E2] transition-all hover:shadow-soft-card flex flex-col justify-between group">
                <div>
                  <div className="w-11 h-11 rounded-xl bg-[#229ED9]/10 flex items-center justify-center mb-5 group-hover:scale-105 transition-transform">
                    {/* Telegram SVG */}
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
                      {' '}
                      <circle cx="12" cy="12" r="11" fill="#229ED9" />
                      {' '}
                      <path d="M17.5 7.5L5.5 12.1L9.5 13.6L14.7 10.3C14.9 10.2 15.1 10.4 15 10.6L10.8 14.4V17.5L12.9 15.5L16.2 17.9C16.8 18.2 17.2 17.9 17.4 17.2L19.4 8.2C19.6 7.3 18.9 6.8 17.5 7.5Z" fill="white" />
                      {' '}
                    </svg>
                  </div>
                  <h3 className="font-display text-lg font-semibold text-[#111827] mb-2">
                    Telegram
                  </h3>
                  <p className="text-xs sm:text-sm text-[#4B5563] leading-relaxed">
                    Gửi tin vào nhóm.
                  </p>
                </div>
              </div>
              {/* 8. Jira */}
              <div className="bg-[#F8F8F6] hover:bg-white rounded-2xl p-6 border border-[#E7E7E2] transition-all hover:shadow-soft-card flex flex-col justify-between group">
                <div>
                  <div className="w-11 h-11 rounded-xl bg-[#0052CC]/10 flex items-center justify-center mb-5 group-hover:scale-105 transition-transform">
                    {/* Jira SVG */}
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
                      {' '}
                      <path d="M11.53 2C11.53 7.26 7.26 11.53 2 11.53C7.26 11.53 11.53 15.8 11.53 21.06C11.53 15.8 15.8 11.53 21.06 11.53C15.8 11.53 11.53 7.26 11.53 2Z" fill="#0052CC" />
                      {' '}
                      <path d="M11.53 2C11.53 4.63 9.4 6.76 6.77 6.76C9.4 6.76 11.53 8.89 11.53 11.52C11.53 8.89 13.66 6.76 16.29 6.76C13.66 6.76 11.53 4.63 11.53 2Z" fill="#2684FF" />
                      {' '}
                    </svg>
                  </div>
                  <h3 className="font-display text-lg font-semibold text-[#111827] mb-2">
                    Jira
                  </h3>
                  <p className="text-xs sm:text-sm text-[#4B5563] leading-relaxed">
                    Tạo issue, bình luận.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
        {/* ========================================== */}
        {/* 6. "BẮT ĐẦU THẾ NÀO" */}
        {/* ========================================== */}
        <section className="py-16 sm:py-24 border-b border-[#E7E7E2] bg-[#F8F8F6]" data-od-id="onboarding-section">
          <div className="max-w-5xl mx-auto px-4 sm:px-6">
            <div className="text-center max-w-2xl mx-auto mb-14 sm:mb-16">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#FF5701] mb-2">
                Đơn giản &amp; rõ ràng
              </p>
              <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl text-[#111827] font-semibold tracking-tight">
                Bắt đầu thế nào
              </h2>
              <p className="text-sm sm:text-base text-[#6B7280] mt-3">
                Chỉ 3 bước để đưa trợ lý điều phối vào quy trình làm việc hằng ngày của nhóm bạn.
              </p>
            </div>
            {/* 3 bước đánh số */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative mb-14">
              {/* Bước 1 */}
              <div className="bg-white rounded-2xl p-7 border border-[#E7E7E2] shadow-soft-card relative" data-od-id="step-1">
                <span className="font-display text-4xl font-bold text-[#FF5701]/25 block mb-4">
                  01
                </span>
                <h3 className="font-display text-lg sm:text-xl font-semibold text-[#111827] mb-2.5">
                  Đăng ký bằng email hoặc tài khoản Google
                </h3>
                <p className="text-sm text-[#4B5563] leading-relaxed">
                  Bạn tạo tài khoản nhanh chóng và thuận tiện mà không cần cấu hình phức tạp.
                </p>
              </div>
              {/* Bước 2 */}
              <div className="bg-white rounded-2xl p-7 border border-[#E7E7E2] shadow-soft-card relative flex flex-col justify-between" data-od-id="step-2">
                <div>
                  <span className="font-display text-4xl font-bold text-[#FF5701]/25 block mb-4">
                    02
                  </span>
                  <h3 className="font-display text-lg sm:text-xl font-semibold text-[#111827] mb-2.5">
                    Quản trị viên duyệt tài khoản, bạn nhận email báo
                  </h3>
                  <p className="text-sm text-[#4B5563] leading-relaxed">
                    Đảm bảo tính bảo mật nội bộ. Sau khi được người quản lý duyệt, bạn sẽ nhận được thông báo để vào việc ngay.
                  </p>
                </div>
                <div className="mt-5 pt-4 border-t border-[#F0F0EB] flex items-center justify-between">
                  <span className="text-xs text-[#6B7280]">
                    Hộp thư đến
                  </span>

                </div>
              </div>
              {/* Bước 3 */}
              <div className="bg-white rounded-2xl p-7 border border-[#E7E7E2] shadow-soft-card relative" data-od-id="step-3">
                <span className="font-display text-4xl font-bold text-[#FF5701]/25 block mb-4">
                  03
                </span>
                <h3 className="font-display text-lg sm:text-xl font-semibold text-[#111827] mb-2.5">
                  Gõ yêu cầu đầu tiên
                </h3>
                <p className="text-sm text-[#4B5563] leading-relaxed">
                  Mở sân khấu, gõ việc cần làm bằng tiếng Việt, xem trước kế hoạch và bấm duyệt để hoàn thành.
                </p>
              </div>
            </div>
            {/* Khối CTA dưới chân 3 bước */}
            <div className="text-center pt-2">
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3.5 sm:gap-4">
                <a href="#signup" onClick={authLink('signup')} className="w-full sm:w-auto inline-flex items-center justify-center px-7 py-3.5 text-base font-medium text-white bg-[#FF5701] rounded-2xl hover:bg-[#E04C00] shadow-md shadow-[#FF5701]/20 transition-all v3-transform hover:-translate-y-0.5 focus-visible:v3-outline-none" data-od-id="btn-footer-cta-signup">
                  Đăng ký
                </a>
                <a href="#google" onClick={authLink('google')} className="w-full sm:w-auto inline-flex items-center justify-center gap-3 px-6 py-3.5 text-base font-medium text-[#111827] bg-white border border-[#E7E7E2] rounded-2xl hover:border-gray-400 hover:bg-[#FAFAFA] shadow-sm transition-all focus-visible:v3-outline-none" data-od-id="btn-footer-cta-google">
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
                  <span>
                    Tiếp tục với Google
                  </span>
                </a>
              </div>
              <p className="text-xs text-[#9CA3AF] mt-3">
                Tài khoản mới cần quản trị viên duyệt.
              </p>
            </div>
          </div>
        </section>
      </main>
      {/* ========================================== */}
      {/* 7. CHÂN TRANG NHỎ (FOOTER) */}
      {/* ========================================== */}
      <footer className="py-8 bg-white border-t border-[#E7E7E2]" data-od-id="footer">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#6B7280]">
          <div className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-md bg-[#FF5701] text-white flex items-center justify-center font-display font-bold text-[10px]">
              A
            </span>
            <span className="font-medium text-[#111827]">
              ATI · 2026
            </span>
            <span className="text-[#D1D5DB]">
              ·
            </span>
            <span className="text-[#9CA3AF]">
              AI Workflow Automation Platform
            </span>
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
      </footer>
      {/* ========================================== */}
      {/* MODAL ĐĂNG KÝ / ĐĂNG NHẬP (AUTH MODAL) */}
      {/* ========================================== */}
      </div>
      {authOverlay.visible && <div ref={authModalRef} onClick={backdrop(authModalRef, closeAuthModal)} id="auth-modal" className={`fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-[#0B1020]/60 backdrop-blur-sm ${overlayClass(authOverlay)} transition-opacity duration-200`} role="dialog" aria-modal="true" aria-labelledby={authView === 'forgot' ? 'auth-forgot-title' : authView === 'success' ? 'success-title' : authView === 'google' ? 'auth-google-title' : 'auth-modal-title'} data-od-id="auth-modal">
        <div ref={authCardRef} id="auth-modal-card" className={`bg-white border border-[#E7E7E2] rounded-3xl shadow-2xl max-w-md w-full p-6 sm:p-8 relative overflow-hidden transition-all duration-200 v3-transform ${cardScale(authOverlay)} max-h-[92vh] overflow-y-auto`} data-od-id="auth-modal-card">
          {/* Nút đóng (X) */}
          <button type="button" id="auth-modal-close" onClick={closeAuthModal} className="absolute top-5 right-5 w-8 h-8 rounded-full flex items-center justify-center text-[#6B7280] hover:text-[#111827] hover:bg-[#F3F4F6] transition-colors focus-visible:v3-outline-none" aria-label="Đóng cửa sổ">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              {' '}
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              {' '}
            </svg>
          </button>
          {(error || authError) && <p role="alert" className="p-3.5 mb-4 bg-[#FEF2F2] border border-[#FECACA] rounded-xl text-xs text-[#DC2626]">{error || authError}</p>}
          {/* Logo thương hiệu ATI */}
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-xl bg-[#FF5701] text-white flex items-center justify-center font-display font-bold text-base shadow-sm">
              A
            </div>
            <span className="font-display font-bold text-xl text-[#111827] tracking-tight">
              ATI
            </span>
          </div>
          {/* VIEW 1: FORM CHÍNH (Đăng nhập / Đăng ký) */}
          {authView === 'form' && <div id="auth-form-view" className={authView === 'form' ? undefined : 'hidden'}>
            <h1 id="auth-modal-title" className="font-display font-medium text-2xl sm:text-[26px] text-[#111827] tracking-tight mb-1.5">
              {isLoginView ? 'Chào mừng bạn quay lại' : 'Bắt đầu với ATI'}
            </h1>
            <p id="auth-modal-subtitle" className="text-xs sm:text-sm text-[#4B5563] leading-relaxed mb-5">
              {isLoginView ? 'Đăng nhập để vào không gian điều phối công việc của nhóm.' : 'Điều phối tự động trên nhiều công cụ sau khi bạn duyệt.'}
            </p>
            {/* Segmented Tab điều hướng */}
            <div className="grid grid-cols-2 p-1 bg-[#F8F8F6] border border-[#E7E7E2] rounded-2xl mb-5" role="tablist" aria-label="Chọn hình thức xác thực">
              <button type="button" id="tab-btn-login" role="tab" aria-selected={isLoginView ? 'true' : 'false'} className={isLoginView ? TAB_ON : TAB_OFF} onClick={() => changeMode('login')}>
                {" Đăng nhập "}
              </button>
              {authConfig?.signupEnabled && <button type="button" id="tab-btn-signup" role="tab" aria-selected={isLoginView ? 'false' : 'true'} className={isLoginView ? TAB_OFF : TAB_ON} onClick={() => changeMode('signup')}>
                {" Đăng ký "}
              </button>}
            </div>
            {/* Nút Tiếp tục với Google */}
            {authConfig?.googleEnabled && <button type="button" id="auth-google-action" disabled={busy || isLoggingIn} onClick={triggerGoogleAuthFlow} className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white border border-[#E7E7E2] hover:border-gray-400 hover:bg-[#FAFAFA] text-sm font-medium text-[#111827] rounded-xl transition-all shadow-sm focus-visible:v3-outline-none mb-2.5 group" data-od-id="btn-modal-google">
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
              <span className="group-hover:text-black">
                Tiếp tục với Google
              </span>
            </button>}
            {/* Cam kết an toàn & Chính sách dữ liệu */}
            <p className="text-[11px] text-[#6B7280] text-center mb-3">
              {"Khi tiếp tục, bạn đồng ý với "}
              <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-[#FF5701] hover:underline font-medium">
                Chính sách an toàn &amp; Dữ liệu
              </a>
              {" của ATI."}
            </p>
            {/* Divider phân tách */}
            <div className="relative my-4 flex items-center justify-center">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-[#E7E7E2]" />
              </div>
              <span className="relative px-3 bg-white text-[11px] text-[#9CA3AF] uppercase tracking-wider">
                hoặc bằng email
              </span>
            </div>
            {/* FORM 1: ĐĂNG NHẬP */}
            {isLoginView && <form id="form-login" className={`v3-space-y-4${isLoginView ? '' : ' hidden'}`} onSubmit={actions.handleLoginSubmit}>
              <div>
                <label className="block text-xs font-semibold text-[#374151] mb-1.5" htmlFor="login-email">
                  Email công việc hoặc cá nhân
                </label>
                {' '}
                <input ref={loginEmailRef} type="email" id="login-email" aria-label="Email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required placeholder="lan.nguyen@congty.vn" className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#E7E7E2] rounded-xl text-[#111827] placeholder-[#9CA3AF] focus:border-[#FF5701] focus:ring-2 focus:ring-[#FF5701]/20 transition-all focus:v3-outline-none" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-[#374151]" htmlFor="login-password">
                    Mật khẩu
                  </label>
                  <button type="button" id="btn-forgot-password" onClick={actions.showForgotView} className="text-xs text-[#FF5701] hover:underline focus-visible:v3-outline-none">
                    Quên mật khẩu?
                  </button>
                </div>
                <div className="relative">
                  <input type={loginPwdShown ? 'text' : 'password'} id="login-password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required placeholder="••••••••" className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#E7E7E2] rounded-xl text-[#111827] placeholder-[#9CA3AF] focus:border-[#FF5701] focus:ring-2 focus:ring-[#FF5701]/20 transition-all focus:v3-outline-none pr-10" />
                  {' '}
                  <button type="button" id="toggle-login-pwd" onClick={() => setLoginPwdShown(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-[#4B5563] focus-visible:v3-outline-none" aria-label="Hiện hoặc ẩn mật khẩu">
                    {' '}
                    <svg id="eye-login-icon" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      {loginPwdShown ? EYE_HIDE : EYE_SHOW}
                    </svg>
                    {' '}
                  </button>
                </div>
              </div>
              <button type="submit" disabled={busy || isLoggingIn} className="w-full py-3 px-4 bg-[#FF5701] hover:bg-[#E04C00] text-white text-sm font-semibold rounded-xl shadow-md shadow-[#FF5701]/20 transition-all v3-transform active:scale-[0.99] flex items-center justify-center gap-2" aria-label={isLoggingIn ? "Đang đăng nhập..." : "Đăng nhập"} data-od-id="btn-submit-login">
                <span>
                  Đăng nhập vào ATI
                </span>
              </button>
              {authConfig?.signupEnabled && <p className="text-center text-xs text-[#6B7280] pt-1">
                {"Chưa có tài khoản? "}
                <button type="button" id="link-switch-signup" onClick={() => changeMode('signup')} className="font-semibold text-[#FF5701] hover:underline focus-visible:v3-outline-none">
                  Đăng ký
                </button>
              </p>}
              <button type="button" className="text-xs text-[#FF5701] hover:underline" onClick={() => navigate("/resend-verification")}>Gửi lại email xác minh</button>
            </form>}
            {/* FORM 2: ĐĂNG KÝ */}
            {!isLoginView && authConfig?.signupEnabled && <form id="form-signup" className={`v3-space-y-3.5${isLoginView ? ' hidden' : ''}`} onSubmit={actions.handleSignupSubmit}>
              {/* Hộp lưu ý 3 bước đăng ký */}
              <div className="p-3 bg-[#FFF7ED] border border-[#FED7AA] rounded-xl flex items-start gap-2.5 text-xs text-[#9A3412] leading-relaxed">
                <svg className="w-4 h-4 text-[#EA580C] flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  {' '}
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  {' '}
                </svg>
                <div>
                  <strong className="font-semibold">
                    Quy trình 3 bước:
                  </strong>
                  {" (1) Mở email để xác minh địa chỉ, (2) Quản trị viên duyệt tài khoản, (3) Bạn nhận email khi được duyệt."}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#374151] mb-1.5" htmlFor="signup-name">
                  Họ và tên của bạn
                </label>
                {' '}
                <input ref={signupNameRef} type="text" id="signup-name" aria-label="Họ tên" autoComplete="name" maxLength={100} required placeholder="Ví dụ: Nguyễn Lan" className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#E7E7E2] rounded-xl text-[#111827] placeholder-[#9CA3AF] focus:border-[#FF5701] focus:ring-2 focus:ring-[#FF5701]/20 transition-all focus:v3-outline-none" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#374151] mb-1.5" htmlFor="signup-email">
                  Email công việc hoặc cá nhân
                </label>
                {' '}
                <input ref={signupEmailRef} type="email" id="signup-email" aria-label="Email" autoComplete="email" maxLength={254} required placeholder="lan.nguyen@congty.vn" className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#E7E7E2] rounded-xl text-[#111827] placeholder-[#9CA3AF] focus:border-[#FF5701] focus:ring-2 focus:ring-[#FF5701]/20 transition-all focus:v3-outline-none" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#374151] mb-1.5" htmlFor="signup-password">
                  Mật khẩu
                </label>
                <div className="relative">
                  <input type={signupPwdShown ? 'text' : 'password'} id="signup-password" autoComplete="new-password" maxLength={128} required minLength={12} placeholder="Ít nhất 12 ký tự" className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#E7E7E2] rounded-xl text-[#111827] placeholder-[#9CA3AF] focus:border-[#FF5701] focus:ring-2 focus:ring-[#FF5701]/20 transition-all focus:v3-outline-none pr-10" />
                  {' '}
                  <button type="button" id="toggle-signup-pwd" onClick={() => setSignupPwdShown(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-[#4B5563] focus-visible:v3-outline-none" aria-label="Hiện hoặc ẩn mật khẩu">
                    {' '}
                    <svg id="eye-signup-icon" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      {signupPwdShown ? EYE_HIDE : EYE_SHOW}
                    </svg>
                    {' '}
                  </button>
                </div>
              </div>
              <button type="submit" disabled={busy || isLoggingIn} className="w-full py-3 px-4 bg-[#FF5701] hover:bg-[#E04C00] text-white text-sm font-semibold rounded-xl shadow-md shadow-[#FF5701]/20 transition-all v3-transform active:scale-[0.99] flex items-center justify-center gap-2" data-od-id="btn-submit-signup">
                <span>
                  Gửi yêu cầu đăng ký
                </span>
              </button>
              <p className="text-center text-xs text-[#6B7280] pt-1">
                {"Đã có tài khoản? "}
                <button type="button" id="link-switch-login" onClick={() => changeMode('login')} className="font-semibold text-[#FF5701] hover:underline focus-visible:v3-outline-none">
                  Đăng nhập
                </button>
              </p>
            </form>}
            {!isLoginView && !authConfig?.signupEnabled && <p role="status">Đăng ký bằng email hiện đang đóng.</p>}
          </div>}
          {/* VIEW 2: MÔ PHỎNG TIẾP TỤC VỚI GOOGLE */}
          {authView === 'google' && <div id="auth-google-view" className={`${authView === 'google' ? '' : 'hidden '}text-center py-6`}>
            <div className="w-12 h-12 rounded-full bg-[#FAFAF8] border border-[#E7E7E2] flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 animate-spin text-[#FF5701]" fill="none" viewBox="0 0 24 24">
                {' '}
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                {' '}
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                {' '}
              </svg>
            </div>
            <h1 id="auth-google-title" className="font-display font-medium text-xl sm:text-2xl text-[#111827] tracking-tight mb-2">
              Đang chuyển sang trang đăng nhập của Google…
            </h1>
            <p className="text-xs sm:text-sm text-[#6B7280] max-w-sm mx-auto mb-3">
              Hệ thống đang kết nối an toàn với Google Identity. Vui lòng chờ trong giây lát.
            </p>
            <p className="text-[11px] text-[#9CA3AF]">
              {"Chỉ nhận email, họ tên, ảnh đại diện · Xem "}
              <a href="/privacy#google-oauth" target="_blank" rel="noopener noreferrer" className="text-[#FF5701] hover:underline font-medium">
                Chính sách dữ liệu tài khoản Google
              </a>
            </p>
          </div>}
          {/* VIEW 4: QUÊN MẬT KHẨU */}
          {authView === 'forgot' && <div id="auth-forgot-view" className={authView === 'forgot' ? undefined : 'hidden'}>
            <h1 id="auth-forgot-title" className="font-display font-medium text-2xl text-[#111827] tracking-tight mb-1.5">
              Đặt lại mật khẩu
            </h1>
            <p className="text-xs sm:text-sm text-[#4B5563] leading-relaxed mb-5">
              Nhập email của bạn để nhận hướng dẫn đặt lại mật khẩu.
            </p>
            <form id="form-forgot" className="v3-space-y-4" onSubmit={actions.handleForgotSubmit}>
              <div>
                <label className="block text-xs font-semibold text-[#374151] mb-1.5" htmlFor="forgot-email">
                  Email tài khoản của bạn
                </label>
                {' '}
                <input ref={forgotEmailRef} type="email" id="forgot-email" aria-label="Email" autoComplete="email" maxLength={254} required placeholder="lan.nguyen@congty.vn" className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#E7E7E2] rounded-xl text-[#111827] placeholder-[#9CA3AF] focus:border-[#FF5701] focus:ring-2 focus:ring-[#FF5701]/20 transition-all focus:v3-outline-none" />
              </div>
              <div id="forgot-feedback-box" role={forgotSent ? "status" : undefined} className={`${forgotSent ? '' : 'hidden '}p-3.5 bg-[#F0FDF4] border border-[#BBF7D0] rounded-xl text-xs text-[#16A34A] leading-relaxed`}>
                Nếu email này có tài khoản, bạn sẽ nhận được link đặt lại mật khẩu.
              </div>
              <button type="submit" id="btn-submit-forgot" aria-label="Gửi link đặt lại mật khẩu" disabled={busy} className="w-full py-3 px-4 bg-[#FF5701] hover:bg-[#E04C00] text-white text-sm font-semibold rounded-xl shadow-md shadow-[#FF5701]/20 transition-all v3-transform active:scale-[0.99] flex items-center justify-center gap-2">
                <span>
                  Gửi link đặt lại
                </span>
              </button>
              {' '}
              <button type="button" id="btn-back-from-forgot" onClick={() => changeMode('login')} className="w-full py-2.5 px-4 bg-white border border-[#E7E7E2] hover:bg-[#F8F8F6] text-xs font-medium text-[#4B5563] rounded-xl transition-all focus-visible:v3-outline-none">
                {" ← Quay lại đăng nhập "}
              </button>
            </form>
          </div>}
          {/* VIEW 3: THÀNH CÔNG (SUCCESS) */}
          {authView === 'success' && <div id="auth-success-view" className={`${authView === 'success' ? '' : 'hidden '}text-center py-2`}>
            <div className="w-14 h-14 rounded-2xl bg-[#F0FDF4] border border-[#BBF7D0] text-[#16A34A] flex items-center justify-center mx-auto mb-4 shadow-sm">
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {' '}
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                {' '}
              </svg>
            </div>
            <h1 id="success-title" className="font-display font-medium text-2xl text-[#111827] tracking-tight mb-2">
              {success ? success.title : 'Đã gửi yêu cầu đăng ký!'}
            </h1>
            <p id="success-desc" role="status" className="text-xs sm:text-sm text-[#4B5563] leading-relaxed max-w-sm mx-auto mb-6">
              {success ? success.desc : 'Hệ thống đã ghi nhận email của bạn. Quản trị viên nhóm sẽ phê duyệt quyền truy cập và bạn sẽ nhận được email thông báo ngay khi tài khoản sẵn sàng.'}
            </p>
            <div id="success-action-area" className="v3-space-y-2.5">
              {/* Hai nút dưới có inline-flex và bị bật/tắt hidden: v3 cho hidden thắng (bảng giá trị display), v4 cho
                  inline-flex thắng (xếp theo tên class), nên đánh dấu ! để giữ kết quả của v3. */}
              <a ref={enterWorkspaceRef} id="btn-enter-workspace" href="/" className={`${success?.isLogin ? '' : 'hidden! '}w-full py-3 px-4 bg-[#FF5701] hover:bg-[#E04C00] text-white text-sm font-semibold rounded-xl shadow-md shadow-[#FF5701]/20 transition-all inline-flex items-center justify-center gap-2`}>
                <span>
                  Vào không gian làm việc (Sân khấu) →
                </span>
              </a>
              {' '}

              {' '}
              <button ref={successCloseRef} type="button" id="btn-success-close" onClick={closeAuthModal} className={`${success?.isLogin ? 'hidden ' : ''}w-full py-2.5 px-4 bg-[#F8F8F6] hover:bg-[#EFEFEA] text-[#111827] text-xs sm:text-sm font-medium rounded-xl border border-[#E7E7E2] transition-all`}>
                {" Đã hiểu và đóng "}
              </button>
            </div>
          </div>}
        </div>
      </div>}
      {/* ========================================== */}
      {/* MÀN HÌNH MÔ PHỎNG EMAIL DUYỆT TÀI KHOẢN */}
      {/* ========================================== */}
    </>
  );
}
