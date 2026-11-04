import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { usePrototypePage, type PageMeta } from '../../prototype/usePrototypePage';
import type { LoginViewProps } from '../../components/LoginView';
import { apiClient } from '../../services/api-client';
import { userErrorMessage } from '../../services/user-error';
import css from './page.css?inline';
import { ThemeToggle } from '../../prototype/ThemeToggle';
import { Brand, ServiceLogo, PlanoraMark } from '../../planora/components/Brand';
import { PlanoraAuthFrame } from '../../planora/layout/PlanoraAuthFrame';
import landingPlaybooks from '../../assets/landing-playbooks.json';

type AuthMode = 'login' | 'signup';
type AuthView = 'form' | 'google' | 'success' | 'forgot';
type Success = { title: string; desc: ReactNode; isLogin: boolean };
const FOCUSABLE =
  'button:not([disabled]), [href]:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

const modalOpeners = new WeakMap<
  Document,
  { element: HTMLElement | null; id: string; returnRequested: boolean }
>();

function rememberModalOpener(element: HTMLElement) {
  const id = element.dataset.odId;
  if (id) modalOpeners.set(element.ownerDocument, { element, id, returnRequested: false });
}

function requestModalFocusReturn() {
  const opener = modalOpeners.get(document);
  modalOpeners.set(
    document,
    opener
      ? { ...opener, returnRequested: true }
      : { element: null, id: 'btn-header-login', returnRequested: true }
  );
}

function restoreRequestedModalFocus() {
  const opener = modalOpeners.get(document);
  modalOpeners.delete(document);
  if (!opener?.returnRequested) return;
  const element = opener.element?.isConnected
    ? opener.element
    : [...document.querySelectorAll<HTMLElement>('[data-od-id]')].find(
        node => node.dataset.odId === opener.id
      );
  element?.focus();
}

const meta: PageMeta = {
  id: 'index',
  title: 'Planora — Hệ thống điều phối quy trình làm việc tự động hóa bằng AI',
  htmlClass: 'scroll-smooth',
  bodyClass: 'selection:bg-[#FF5701]/20 selection:text-[#111827]',
  css,
};

export interface LandingPageProps extends Partial<LoginViewProps> {
  navigate: (path: string, replace?: boolean) => void;
  initialMode?: AuthMode | 'forgot';
}

/** Interactive 3D Hero Rotator Hook */
function useHeroMotion() {
  const rotator = useRef<HTMLDivElement>(null);
  const float = useRef<HTMLDivElement>(null);
  const front = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLDivElement>(null);
  const motion = useRef({
    x: 0,
    y: 0,
    reduced: false,
    backVisible: false,
    frame: 0,
    inertia: 0,
    resume: 0,
    clickTimer: 0,
    suppressClick: false,
    pointer: null as null | {
      id: number;
      startX: number;
      startY: number;
      lastX: number;
      lastY: number;
      time: number;
      velocity: number;
      dragging: boolean;
      scrolling: boolean;
    },
  });

  const paint = () => {
    const m = motion.current;
    if (!rotator.current) return;
    rotator.current.style.transform = `rotateX(${m.x}deg) rotateY(${m.y}deg)`;
    const angle = ((m.y % 360) + 360) % 360;
    const isBack = angle > 90 && angle < 270;
    if (isBack !== m.backVisible) {
      m.backVisible = isBack;
      for (const [face, hidden] of [
        [front.current, isBack],
        [back.current, !isBack],
      ] as const) {
        if (face) {
          face.inert = hidden;
          face.setAttribute('aria-hidden', String(hidden));
        }
      }
    }
  };

  const queuePaint = () => {
    const m = motion.current;
    if (!m.frame)
      m.frame = requestAnimationFrame(() => {
        m.frame = 0;
        paint();
      });
  };

  const cancelInertia = () => {
    const m = motion.current;
    cancelAnimationFrame(m.inertia);
    m.inertia = 0;
  };

  const resumeFloat = () => {
    const m = motion.current;
    clearTimeout(m.resume);
    m.resume = window.setTimeout(() => {
      m.resume = 0;
      if (float.current) float.current.style.animationPlayState = 'running';
    }, 400);
  };

  const coast = (velocity: number) => {
    const m = motion.current;
    if (m.reduced || Math.abs(velocity) < 0.003) return;
    let previous = performance.now();
    const started = previous;
    const tick = (now: number) => {
      if (now - started >= 240) {
        m.inertia = 0;
        return;
      }
      const dt = Math.min(Math.max(now - previous, 0), 32);
      previous = now;
      velocity *= Math.exp(-dt / 85);
      m.y += velocity * dt;
      paint();
      m.inertia = Math.abs(velocity) >= 0.003 ? requestAnimationFrame(tick) : 0;
    };
    m.inertia = requestAnimationFrame(tick);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const m = motion.current;
    if (!e.isPrimary || e.button !== 0 || m.pointer) return;
    cancelInertia();
    clearTimeout(m.resume);
    clearTimeout(m.clickTimer);
    m.suppressClick = false;
    m.pointer = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      time: performance.now(),
      velocity: 0,
      dragging: false,
      scrolling: false,
    };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const m = motion.current,
      p = m.pointer;
    if (!p || p.id !== e.pointerId || p.scrolling) return;
    if (!p.dragging) {
      const dx = e.clientX - p.startX,
        dy = e.clientY - p.startY;
      if (Math.hypot(dx, dy) < 5) return;
      if (e.pointerType === 'touch' && Math.abs(dy) > Math.abs(dx)) {
        p.scrolling = true;
        return;
      }
      p.dragging = true;
      m.suppressClick = true;
      rotator.current?.setAttribute('data-dragging', 'true');
      if (float.current) float.current.style.animationPlayState = 'paused';
      document.getSelection()?.removeAllRanges();
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    e.preventDefault();
    const now = performance.now(),
      dx = e.clientX - p.lastX;
    m.y += dx * 0.35;
    m.x = Math.max(-12, Math.min(12, m.x - (e.clientY - p.lastY) * 0.15));
    p.velocity = Math.max(-0.08, Math.min(0.08, (dx * 0.35) / Math.max(now - p.time, 8)));
    p.lastX = e.clientX;
    p.lastY = e.clientY;
    p.time = now;
    queuePaint();
  };

  const finish = (e: PointerEvent<HTMLDivElement>, cancelled = false) => {
    const m = motion.current,
      p = m.pointer;
    if (!p || p.id !== e.pointerId) return;
    m.pointer = null;
    rotator.current?.removeAttribute('data-dragging');
    if (e.currentTarget.hasPointerCapture?.(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    if (p.dragging) {
      cancelAnimationFrame(m.frame);
      m.frame = 0;
      paint();
      if (!cancelled && performance.now() - p.time < 80) coast(p.velocity);
      m.clickTimer = window.setTimeout(() => {
        m.suppressClick = false;
        m.clickTimer = 0;
      }, 350);
    }
    if (float.current?.style.animationPlayState === 'paused') resumeFloat();
  };

  const onClickCapture = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (motion.current.suppressClick && e.detail !== 0) {
      e.preventDefault();
      e.stopPropagation();
      motion.current.suppressClick = false;
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    cancelInertia();
    motion.current.y += e.key === 'ArrowRight' ? 15 : -15;
    queuePaint();
  };

  useLayoutEffect(() => {
    const compact = window.matchMedia?.('(max-width: 760px)').matches;
    motion.current.x = compact ? 0 : 6;
    motion.current.y = compact ? 0 : -12;
    paint();
  }, []);

  useEffect(() => {
    const m = motion.current;
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    m.reduced = Boolean(media?.matches);
    const change = (e: MediaQueryListEvent) => {
      m.reduced = e.matches;
      if (e.matches) cancelInertia();
    };
    media?.addEventListener('change', change);
    return () => {
      media?.removeEventListener('change', change);
      cancelAnimationFrame(m.frame);
      cancelInertia();
      clearTimeout(m.resume);
      clearTimeout(m.clickTimer);
      m.pointer = null;
      m.frame = 0;
    };
  }, []);

  return {
    rotator,
    float,
    front,
    back,
    events: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (e: PointerEvent<HTMLDivElement>) => finish(e),
      onPointerCancel: (e: PointerEvent<HTMLDivElement>) => finish(e, true),
      onLostPointerCapture: (e: PointerEvent<HTMLDivElement>) => finish(e, true),
      onPointerLeave: (e: PointerEvent<HTMLDivElement>) => {
        if (!motion.current.pointer?.dragging) finish(e, true);
      },
      onClickCapture,
      onKeyDown,
      onDragStart: (e: ReactMouseEvent<HTMLDivElement>) => e.preventDefault(),
    },
  };
}

export function LandingPage({
  navigate,
  initialMode,
  email = '',
  setEmail = () => {},
  password = '',
  setPassword = () => {},
  isLoggingIn = false,
  authError,
  onLogin,
  authConfig,
}: LandingPageProps) {
  usePrototypePage(meta);
  const heroMotion = useHeroMotion();

  const [localAuthMode, setLocalAuthMode] = useState<AuthMode | null>(null);
  useEffect(() => {
    setLocalAuthMode(null);
  }, [initialMode]);

  const effectiveMode = initialMode ?? localAuthMode;
  const authModeView = effectiveMode === 'signup' ? 'signup' : 'login';
  const isLoginView = authModeView === 'login';
  const [authView, setAuthView] = useState<AuthView>(
    initialMode === 'forgot' ? 'forgot' : 'form'
  );
  const [googleModalOpen, setGoogleModalOpen] = useState(false);
  const authOpen = Boolean(effectiveMode) || googleModalOpen;
  const [success, setSuccess] = useState<Success | null>(null);
  const [forgotSent, setForgotSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginPwdShown, setLoginPwdShown] = useState(false);
  const [signupPwdShown, setSignupPwdShown] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [roadmapOpen, setRoadmapOpen] = useState(false);
  const [runtime, setRuntime] = useState<{ gmailEnabled?: boolean; mysheetsEnabled?: boolean } | null>(null);
  const roadmapId = useId();

  useEffect(() => {
    apiClient.getRuntime().then(setRuntime).catch(() => {});
  }, []);

  const authModalRef = useRef<HTMLDivElement>(null);
  const authCardRef = useRef<HTMLDivElement>(null);
  const loginEmailRef = useRef<HTMLInputElement>(null);
  const signupNameRef = useRef<HTMLInputElement>(null);
  const signupEmailRef = useRef<HTMLInputElement>(null);
  const forgotEmailRef = useRef<HTMLInputElement>(null);
  const successCloseRef = useRef<HTMLButtonElement>(null);

  const timers = useRef<number[]>([]);
  const generation = useRef(0);
  const pending = useRef(false);

  const lockScroll = (on: boolean) => {
    document.documentElement.classList.toggle('overflow-hidden', on);
    document.body.classList.toggle('overflow-hidden', on);
  };

  useEffect(() => {
    const owner = ++generation.current;
    return () => {
      if (generation.current === owner) generation.current++;
      timers.current.forEach(window.clearTimeout);
      lockScroll(false);
    };
  }, [initialMode]);

  useLayoutEffect(() => {
    if (!authOpen) restoreRequestedModalFocus();
  }, [authOpen]);

  useLayoutEffect(() => {
    lockScroll(authOpen);
    const active = document.activeElement;
    const editingField =
      authCardRef.current?.contains(active) &&
      (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement);

    if (authOpen && !editingField) {
      if (authView === 'google')
        authCardRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
      else if (authView === 'success') successCloseRef.current?.focus();
      else if (authView === 'forgot') forgotEmailRef.current?.focus();
      else if (effectiveMode === 'signup') signupNameRef.current?.focus();
      else loginEmailRef.current?.focus();
    }
    return () => {
      lockScroll(false);
    };
  }, [authOpen, effectiveMode, authView, authConfig?.signupEnabled]);

  const changeMode = (mode: AuthMode) => {
    setLocalAuthMode(mode);
    setAuthView('form');
    setForgotSent(false);
    setError(null);
    navigate(mode === 'signup' ? '/signup' : '/login');
  };

  const closeAuthModal = () => {
    generation.current++;
    requestModalFocusReturn();
    setLocalAuthMode(null);
    setGoogleModalOpen(false);
    setAuthView('form');
    setForgotSent(false);
    setBusy(false);
    setError(null);
    navigate('/');
  };

  const triggerGoogleAuthFlow = async () => {
    if (pending.current || !authConfig?.googleEnabled) return;
    pending.current = true;
    const owner = generation.current;
    setBusy(true);
    setAuthView('google');
    setError(null);
    if (!initialMode) setGoogleModalOpen(true);
    try {
      const { url } = await apiClient.startGoogleAuth();
      if (generation.current === owner) window.location.assign(url);
    } catch {
      if (generation.current === owner) {
        setAuthView('form');
        setError('Không thể bắt đầu đăng nhập Google. Hãy thử lại.');
      }
    } finally {
      pending.current = false;
      if (generation.current === owner) setBusy(false);
    }
  };

  const actions = {
    showForgotView() {
      navigate('/forgot-password');
    },
    handleLoginSubmit(event: FormEvent<HTMLFormElement>) {
      void onLogin?.(event);
    },
    async handleSignupSubmit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      if (pending.current || !authConfig?.signupEnabled) return;
      const pwd =
        event.currentTarget.querySelector<HTMLInputElement>('#signup-password')?.value ?? '';
      if (pwd.length < 12 || pwd.length > 128) {
        setError('Mật khẩu cần từ 12 đến 128 ký tự.');
        return;
      }
      pending.current = true;
      const owner = generation.current;
      setBusy(true);
      setError(null);
      try {
        const data = await apiClient.signup(
          signupNameRef.current?.value.trim() ?? '',
          signupEmailRef.current?.value.trim() ?? '',
          pwd
        );
        if (generation.current === owner) {
          setSuccess({
            title: 'Đã gửi yêu cầu đăng ký!',
            desc: data.message,
            isLogin: false,
          });
          setAuthView('success');
        }
      } catch (reason) {
        if (generation.current === owner) setError(userErrorMessage(reason));
      } finally {
        pending.current = false;
        if (generation.current === owner) setBusy(false);
      }
    },
    async handleForgotSubmit(event: FormEvent) {
      event.preventDefault();
      if (pending.current) return;
      pending.current = true;
      const owner = generation.current;
      setBusy(true);
      setError(null);
      try {
        await apiClient.forgotPassword(forgotEmailRef.current?.value.trim() ?? '');
        if (generation.current === owner) {
          setForgotSent(true);
        }
      } catch (reason) {
        if (generation.current === owner) setError(userErrorMessage(reason));
      } finally {
        pending.current = false;
        if (generation.current === owner) setBusy(false);
      }
    },
  };

  const authLink = (mode: AuthMode | 'google') => (event: ReactMouseEvent) => {
    event.preventDefault();
    if (!authOpen && event.currentTarget instanceof HTMLElement)
      rememberModalOpener(event.currentTarget);
    if (mode === 'google') void triggerGoogleAuthFlow();
    else changeMode(mode);
  };

  const handleTryPlaybook = () => {
    sessionStorage.setItem('ati_prefill_prompt', 'Tạo issue đăng nhập trên GitHub, thêm thẻ vào Trello rồi thông báo trên Slack.');
    changeMode('signup');
  };

  const handleTryDigest = () => {
    sessionStorage.setItem('ati_prefill_prompt', landingPlaybooks.digestPrompt);
    changeMode('signup');
  };

  const backdrop = (ref: React.RefObject<HTMLDivElement | null>, close: () => void) => (
    event: ReactMouseEvent
  ) => {
    if (event.target === ref.current) close();
  };

  useEffect(() => {
    if (!authOpen) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeAuthModal();
        return;
      }
      if (event.key !== 'Tab') return;
      const visible = [
        ...(authCardRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []),
      ].filter(el => el.offsetParent !== null);
      const first = visible[0],
        last = visible[visible.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        last?.focus();
        event.preventDefault();
      } else if (!event.shiftKey && document.activeElement === last) {
        first?.focus();
        event.preventDefault();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  return (
    <>
      <div className="contents" inert={authOpen} aria-hidden={authOpen}>
        <a className="sr-only focus:not-sr-only focus:p-4 focus:bg-white focus:text-[#2e382d]" href="#main">
          Đến nội dung chính
        </a>

        {/* 1. Public Header */}
        <header className="planora-landing-nav" role="banner" data-od-id="nav-header">
          <div className="planora-landing-nav-inner">
            <Brand size="md" onClick={() => navigate('/')} />

            <nav className="planora-landing-links" aria-label="Điều hướng công khai">
              <a href="#how">Cách hoạt động</a>
              <a href="#services">Dịch vụ</a>
              <a href="/guide" onClick={e => { e.preventDefault(); navigate('/guide'); }}>Cẩm nang</a>
              <a href="/privacy" onClick={e => { e.preventDefault(); navigate('/privacy'); }}>Chính sách an toàn</a>
            </nav>

            <div className="planora-landing-nav-actions">
              <ThemeToggle />
              <a
                href="#login"
                onClick={authLink('login')}
                className="planora-btn planora-btn-secondary planora-btn-sm"
                data-od-id="btn-header-login"
              >
                Đăng nhập
              </a>
              <a
                href="#signup"
                onClick={authLink('signup')}
                className="planora-btn planora-btn-primary planora-btn-sm"
                data-od-id="btn-header-signup"
              >
                Đăng ký
              </a>
            </div>
          </div>
        </header>

        <main id="main">
          {/* 2. Hero Section */}
          <section className="planora-hero-section" data-od-id="hero-section">
            <div className="planora-hero-grid">
              <div>
                <div className="planora-hero-kicker">
                  CÙNG PLANORA SẮP XẾP CÔNG VIỆC
                </div>

                <h1 className="planora-hero-heading" data-od-id="hero-title">
                  Nói một câu. Việc trên nhiều công cụ được làm xong — sau khi bạn duyệt.
                </h1>

                <p className="planora-hero-copy">
                  Planora đọc yêu cầu tiếng Việt, lên kế hoạch trên GitHub, Trello, Slack, Google Calendar, Sheets… và chỉ làm khi bạn đồng ý.
                </p>

                <div className="planora-hero-cta-group">
                  <a
                    href="#signup"
                    onClick={authLink('signup')}
                    className="planora-btn planora-btn-primary planora-btn-lg"
                    data-od-id="btn-hero-signup"
                  >
                    Bắt đầu cùng Planora
                  </a>

                  {authConfig?.googleEnabled && (
                    <a
                      href="#google"
                      onClick={authLink('google')}
                      className="planora-auth-google-btn"
                      style={{ width: 'auto', padding: '10px 20px' }}
                      data-od-id="btn-hero-google"
                    >
                      <svg className="w-5 h-5 flex-shrink-0" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                        <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z" />
                        <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.36 24 12 24z" />
                        <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z" />
                        <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.36 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z" />
                      </svg>
                      <span>Tiếp tục với Google</span>
                    </a>
                  )}

                  <a
                    href="#login"
                    onClick={authLink('login')}
                    className="planora-auth-link-btn"
                    data-od-id="btn-hero-login-link"
                  >
                    Đăng nhập
                  </a>

                  <button
                    type="button"
                    data-testid="landing-try-playbook-btn"
                    onClick={handleTryPlaybook}
                    className="planora-btn planora-btn-secondary planora-btn-sm"
                    style={{ alignSelf: 'center', marginTop: 4 }}
                  >
                    Dùng thử kịch bản này
                  </button>
                </div>

                <div className="planora-hero-note">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                  <span>Mỗi kế hoạch đều chờ bạn duyệt trước khi thực thi.</span>
                </div>

                <div
                  data-testid="landing-hero-trust-pills"
                  className="planora-hero-trust-pills"
                >
                  <span style={{ color: 'var(--planora-primary)', fontWeight: 600 }}>✓ Kết nối OAuth 1-Click</span>
                  <span style={{ color: 'var(--planora-divider)' }}>·</span>
                  <span>✓ Khóa phạm vi an toàn</span>
                  <span style={{ color: 'var(--planora-divider)' }}>·</span>
                  <span style={{ color: 'var(--planora-primary)', fontWeight: 600 }}>✓ Duyệt trước khi ghi</span>
                </div>
              </div>

              {/* 3D Perspective Hero Rotator */}
              <div className="hero-perspective">
                <div className="hero-float" ref={heroMotion.float}>
                  <div
                    className="hero-rotator planora-hero-rotator"
                    ref={heroMotion.rotator}
                    {...heroMotion.events}
                    tabIndex={0}
                    role="group"
                    aria-label="Ví dụ quy trình Planora. Kéo ngang để xoay, hoặc dùng phím mũi tên trái và phải."
                  >
                    {Array.from({ length: 14 }, (_, index) => (
                      <div
                        className="hero-edge-layer"
                        key={index}
                        aria-hidden="true"
                        style={{
                          transform: `rotateZ(var(--hero-roll)) translateZ(calc(var(--hero-depth) * ${-(index + 1) / 15}))`,
                        }}
                      />
                    ))}

                    <div className="hero-visual hero-front" ref={heroMotion.front}>
                      <div className="hero-visual-label">
                        <span>WORKSPACE PLANORA</span>
                        <span>Ví dụ quy trình</span>
                      </div>

                      <div className="mini-request">
                        <span className="mini-request-avatar">L</span>
                        <span>Tạo issue đăng nhập, đưa vào Trello rồi báo cho nhóm trên Slack.</span>
                      </div>

                      <div className="mini-plan">
                        <div className="mini-plan-heading">
                          <h2>Một kế hoạch, ba bước.</h2>
                          <span
                            style={{
                              fontSize: 'var(--planora-text-xs)',
                              padding: '2px 8px',
                              borderRadius: 'var(--planora-radius-pill)',
                              backgroundColor: 'var(--planora-pending-bg)',
                              color: 'var(--planora-pending-text)',
                              fontWeight: 600,
                            }}
                          >
                            Chờ duyệt
                          </span>
                        </div>

                        <div className="mini-step-list">
                          <div className="mini-step-row">
                            <ServiceLogo name="GitHub" size={16} />
                            <span className="service-name">GitHub</span>
                            <span className="resource-name">· Tạo issue (frontend/web-app)</span>
                          </div>
                          <div className="mini-step-row">
                            <ServiceLogo name="Trello" size={16} />
                            <span className="service-name">Trello</span>
                            <span className="resource-name">· Tạo thẻ (Frontend / Cần làm)</span>
                          </div>
                          <div className="mini-step-row">
                            <ServiceLogo name="Slack" size={16} />
                            <span className="service-name">Slack</span>
                            <span className="resource-name">· Thông báo (#frontend)</span>
                          </div>
                        </div>

                        <div className="mini-plan-foot">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <circle cx="12" cy="12" r="10" />
                            <polyline points="12 6 12 12 16 14" />
                          </svg>
                          <span>Chờ bạn duyệt trước khi thực thi</span>
                        </div>
                      </div>
                    </div>

                    <div className="hero-visual hero-back" ref={heroMotion.back}>
                      <PlanoraMark size={56} />
                      <div className="brand-word" style={{ fontFamily: 'var(--planora-font-serif)', fontSize: 32, fontWeight: 600 }}>
                        planora
                      </div>
                      <h2 style={{ fontFamily: 'var(--planora-font-serif)', fontSize: 20, margin: 0 }}>
                        Ý tưởng → Kế hoạch → Hành động
                      </h2>
                      <p style={{ fontSize: 'var(--planora-text-xs)', color: 'var(--planora-muted)', margin: 0 }}>
                        GitHub · Trello · Slack · Google Calendar · Sheets
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* 3. Workflow 3-Step Section */}
          <section className="planora-workflow-section" id="how">
            <div className="planora-section-header">
              <span className="planora-section-kicker">
                VÍ DỤ: MỘT YÊU CẦU, BA BƯỚC THỰC THI
              </span>
              <h2 className="planora-section-title">
                Quy trình rõ ràng, từng bước minh bạch
              </h2>
              <p className="planora-section-desc">
                Từ một lời nhắn tự nhiên bằng tiếng Việt, Planora tự động phân tích ngữ cảnh, đề xuất các thao tác liên kết và trình bày để bạn phê duyệt.
              </p>
            </div>

            <div className="planora-workflow-grid">
              {/* Step 1 */}
              <article className="workflow-step-card moment-trigger" data-moment="1" id="trigger-moment-1">
                <div className="workflow-step-num">01</div>
                <h3>Yêu cầu</h3>
                <p>Nói điều bạn muốn làm bằng tiếng Việt đời thường, không cần nhớ cú pháp câu lệnh phức tạp.</p>
                <div className="workflow-step-illustration">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
                    <span className="mini-request-avatar" style={{ width: 18, height: 18, fontSize: 10 }}>B</span>
                    <span>Bạn</span>
                  </div>
                  <div>Tạo issue đăng nhập, thêm vào Trello và báo cho nhóm frontend.</div>
                </div>
              </article>

              {/* Step 2 */}
              <article className="workflow-step-card moment-trigger" data-moment="2" id="trigger-moment-2">
                <div className="workflow-step-num">02</div>
                <h3>Kế hoạch</h3>
                <p>Hệ thống tự động tra cứu danh sách dự án, bảng tính, kênh chat và đề xuất các bước hành động.</p>
                <div className="workflow-step-illustration">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <ServiceLogo name="GitHub" size={14} />
                    <span>Tạo issue trên GitHub</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <ServiceLogo name="Trello" size={14} />
                    <span>Tạo thẻ trên Trello</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <ServiceLogo name="Slack" size={14} />
                    <span>Gửi tin nhắn Slack tới #frontend</span>
                  </div>
                  <div style={{ color: 'var(--planora-pending-text)', fontWeight: 600, marginTop: 4 }}>
                    ⏳ Chờ bạn duyệt
                  </div>
                </div>
              </article>

              {/* Step 3 */}
              <article className="workflow-step-card moment-trigger" data-moment="3" id="trigger-moment-3">
                <div className="workflow-step-num">03</div>
                <h3>Kết quả</h3>
                <p>Chỉ thực thi khi bạn bấm Đồng ý. Mọi liên kết, thẻ và tin nhắn được cập nhật tức thì.</p>
                <div className="workflow-step-illustration">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--planora-primary)' }}>
                    <span>✓</span>
                    <span>Đã tạo issue #42 trên GitHub</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--planora-primary)' }}>
                    <span>✓</span>
                    <span>Đã thêm thẻ vào bảng Sprint</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--planora-primary)' }}>
                    <span>✓</span>
                    <span>Đã gửi thông báo tới #frontend</span>
                  </div>
                  <div style={{ color: 'var(--planora-primary)', fontWeight: 600, marginTop: 4 }}>
                    ✓ Công việc đã được kết nối
                  </div>
                </div>
              </article>
            </div>
          </section>

          {/* 4. Integrated Services Section */}
          <section className="planora-services-section" id="services" data-od-id="integrations-section">
            <div className="planora-section-header">
              <span className="planora-section-kicker">
                DỊCH VỤ TÍCH HỢP SẴN SÀNG
              </span>
              <h2 className="planora-section-title">
                Kết nối với hệ sinh thái công cụ của nhóm bạn
              </h2>
              <p className="planora-section-desc">
                Tích hợp sâu rộng và an toàn với các dịch vụ quản lý tác vụ, kho mã nguồn, bảng tính và kênh trao đổi.
              </p>
            </div>

            <div className="planora-services-chips">
              {[
                { name: 'GitHub', type: 'Tự động' },
                { name: 'Trello', type: 'Cá nhân & Nhóm' },
                { name: 'Slack', type: 'Kênh & Tin nhắn' },
                { name: 'Google Calendar', type: 'Lịch biểu' },
                { name: 'Telegram', type: 'Bot điều phối' },
                { name: 'Jira', type: 'Dự án doanh nghiệp' },
                { name: 'Notion', type: 'Cơ sở dữ liệu' },
                { name: 'Sentry', type: 'Giám sát lỗi' },
              ].map(svc => (
                <div key={svc.name} className="planora-service-chip">
                  <div className="flex items-center gap-2">
                    <ServiceLogo name={svc.name} size={20} />
                    <span>{svc.name}</span>
                  </div>
                  <span data-testid="integration-oauth-badge" className="planora-badge text-[10px]">
                    OAuth 1-Click · {svc.type}
                  </span>
                </div>
              ))}

              {runtime?.gmailEnabled && (
                <div className="planora-service-chip" data-testid="service-chip-gmail">
                  <div className="flex items-center gap-2">
                    <ServiceLogo name="Gmail" size={20} />
                    <span>Gmail · Của riêng bạn</span>
                  </div>
                  <span data-testid="integration-oauth-badge" className="planora-badge text-[10px]">
                    OAuth 1-Click · Cá nhân
                  </span>
                  <a
                    href="/guide?service=gmail"
                    className="text-xs underline text-[var(--planora-primary)]"
                    onClick={e => {
                      e.preventDefault();
                      navigate('/guide?service=gmail');
                    }}
                  >
                    Cách kết nối và mẫu câu Gmail
                  </a>
                </div>
              )}

              {runtime?.mysheetsEnabled && (
                <div className="planora-service-chip" data-testid="service-chip-mysheets">
                  <div className="flex items-center gap-2">
                    <ServiceLogo name="Google Sheets" size={20} />
                    <span>Google Sheets · Của riêng bạn</span>
                  </div>
                  <span data-testid="integration-oauth-badge" className="planora-badge text-[10px]">
                    OAuth 1-Click · Cá nhân
                  </span>
                  <a
                    href="/guide?service=mysheets"
                    className="text-xs underline text-[var(--planora-primary)]"
                    onClick={e => {
                      e.preventDefault();
                      navigate('/guide?service=mysheets');
                    }}
                  >
                    Cách kết nối và mẫu câu Google Sheets
                  </a>
                </div>
              )}
            </div>

            <div className="planora-roadmap-wrap">
              <button
                type="button"
                className="roadmap-toggle"
                aria-expanded={roadmapOpen}
                aria-controls={roadmapId}
                onClick={() => setRoadmapOpen(!roadmapOpen)}
              >
                <span>Những kết nối tiếp theo</span>
                <span aria-hidden="true">{roadmapOpen ? '−' : '+'}</span>
              </button>

              <div id={roadmapId} className="roadmap-unfold" hidden={!roadmapOpen}>
                <p style={{ margin: '0 0 8px 0', fontWeight: 600 }}>
                  Đang lên kế hoạch mở rộng kết nối:
                </p>
                <p style={{ margin: 0, color: 'var(--planora-muted)' }}>
                  Google Docs, Asana, Linear, GitLab, Microsoft Teams và ClickUp.
                </p>
              </div>
            </div>
          </section>

          {/* Principles Section */}
          <section className="planora-principles-section" data-od-id="principles-section">
            <div className="planora-section-header">
              <span className="planora-section-kicker">
                AN TÂM KHI SỬ DỤNG
              </span>
              <h2 className="planora-section-title">
                Bạn luôn là người quyết định
              </h2>
              <p className="planora-section-desc">
                Sản phẩm được thiết kế với sự cẩn trọng tối đa để bạn hoàn toàn an tâm khi giao việc. Không ghi gì khi chưa được duyệt.
              </p>
            </div>

            <div data-testid="landing-scope-lock-proof" className="planora-proof-grid">
              <div className="planora-proof-card" data-od-id="card-principle-1">
                <div className="planora-proof-num">01</div>
                <h3>Lớp 1: Khóa phạm vi tài nguyên</h3>
                <p>Chỉ truy cập đúng danh sách kho mã nguồn, bảng Trello và kênh Slack được cấp quyền cụ thể.</p>
              </div>
              <div className="planora-proof-card" data-od-id="card-principle-2">
                <div className="planora-proof-num">02</div>
                <h3>Lớp 2: Xem trước nguyên văn &amp; lưới dữ liệu</h3>
                <p>Kiểm tra chính xác nội dung câu lệnh, tiêu đề issue, thẻ việc trước khi ký duyệt thực hiện.</p>
              </div>
              <div className="planora-proof-card" data-od-id="card-principle-3">
                <div className="planora-proof-num">03</div>
                <h3>Lớp 3: Biên nhận đối chiếu &amp; Khôi phục an toàn</h3>
                <p>Mỗi tác vụ sau khi chạy đều có biên nhận rõ ràng, kèm liên kết tới tài nguyên thật và lịch sử phục hồi.</p>
              </div>
            </div>
          </section>

          {/* Onboarding Section */}
          <section className="planora-onboarding-section" data-od-id="onboarding-section">
            <div className="planora-section-header">
              <span className="planora-section-kicker">
                ĐƠN GIẢN &amp; RÕ RÀNG
              </span>
              <h2 className="planora-section-title">
                Bắt đầu thế nào
              </h2>
              <p className="planora-section-desc">
                Chỉ 3 bước để đưa trợ lý điều phối vào quy trình làm việc hằng ngày của nhóm bạn.
              </p>
            </div>

            <div className="planora-onboarding-grid">
              <div className="planora-onboarding-card" data-od-id="step-1">
                <div className="planora-step-num">01</div>
                <h3>Đăng ký bằng email hoặc tài khoản Google</h3>
                <p>Bạn tạo tài khoản nhanh chóng và thuận tiện mà không cần cấu hình phức tạp.</p>
              </div>

              <div className="planora-onboarding-card" data-od-id="step-2">
                <div className="planora-step-num">02</div>
                <h3>Kết nối công cụ và cấp quyền an toàn</h3>
                <p>Chọn kho mã, bảng Trello hoặc kênh chat bạn muốn trợ lý tham gia điều phối.</p>
                <div data-testid="onboarding-step2-oauth-badge" className="planora-onboarding-badge">
                  <span>Kết nối OAuth 1-Click · Chọn bảng &amp; kênh trực tiếp từ danh sách</span>
                </div>
              </div>

              <div className="planora-onboarding-card" data-od-id="step-3">
                <div className="planora-step-num">03</div>
                <h3>Bắt đầu giao việc và phê duyệt kế hoạch</h3>
                <p>Gõ yêu cầu tiếng Việt trong giao diện trò chuyện và duyệt trước từng thao tác.</p>
              </div>
            </div>
          </section>

          {/* Auto-Digest Morning Schedule Section */}
          <section
            data-testid="landing-schedule-digest-section"
            className="planora-principles-section planora-digest-section"
          >
            <div className="planora-section-header">
              <span className="planora-section-kicker">
                TỰ ĐỘNG HÓA THEO LỊCH HẸN
              </span>
              <h2 className="planora-section-title">
                Lịch Chạy Định Kỳ &amp; Auto-Digest Mỗi Sáng
              </h2>
              <p className="planora-section-desc">
                Chọn chế độ phù hợp với mức độ kiểm soát của bạn: chờ duyệt từng lượt hoặc tự gửi bản tin sáng theo phạm vi đã khóa.
              </p>
            </div>

            <div className="planora-proof-grid mb-6">
              <div className="planora-proof-card">
                <div className="planora-proof-num">🛡️</div>
                <h3>Chờ duyệt từng lượt (Human-in-the-Loop)</h3>
                <p>Hệ thống tự soạn bản xem trước đúng giờ hẹn và chờ bạn bấm duyệt trước khi ghi dữ liệu lên bất kỳ công cụ nào.</p>
              </div>

              <div className="planora-proof-card">
                <div className="planora-proof-num">⚡</div>
                <h3>Tự gửi bản tin Auto-Digest mỗi sáng</h3>
                <p>Đúng 08:00 sáng Thứ 2 – Thứ 6, tự động tổng hợp dữ liệu chỉ đọc từ Google Calendar, Google Sheets, GitHub, Trello và gửi bản tin tóm tắt sang kênh Slack hoặc Telegram đã khóa.</p>
              </div>
            </div>

            <div className="planora-proof-card" style={{ maxWidth: 800, margin: '0 auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <span style={{ fontSize: 'var(--planora-text-xs)', fontWeight: 600, color: 'var(--planora-primary)' }}>
                    Phạm vi Auto-Digest Đã Khóa
                  </span>
                  <p style={{ margin: '4px 0 0', fontWeight: 600 }}>
                    Lịch họp nhóm · Bảng Sprint Q4 → Kênh #bao-cao-sang
                  </p>
                </div>
                <button
                  type="button"
                  data-testid="landing-try-digest-btn"
                  onClick={handleTryDigest}
                  className="planora-btn planora-btn-primary planora-btn-sm"
                >
                  Dùng thử lịch Auto-Digest 8:00 sáng →
                </button>
              </div>
              <div
                data-testid="workflow-flow-canvas"
                data-flow-mode="schedule"
                className="planora-digest-flow-preview"
              >
                <div className="planora-digest-flow-steps">
                  <div className="planora-digest-step">
                    <span className="planora-digest-step-badge">08:00 T2–T6</span>
                    <span className="planora-digest-step-name">Lịch hẹn định kỳ</span>
                  </div>
                  <span className="planora-digest-arrow" aria-hidden="true">→</span>
                  <div className="planora-digest-step">
                    <span className="planora-digest-step-badge">Chỉ đọc</span>
                    <span className="planora-digest-step-name">Calendar &amp; Sheets</span>
                  </div>
                  <span className="planora-digest-arrow" aria-hidden="true">→</span>
                  <div className="planora-digest-step">
                    <span className="planora-digest-step-badge">Đã khóa</span>
                    <span className="planora-digest-step-name">Slack &amp; Telegram</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* 5. Bottom Call to Action */}
          <section className="planora-bottom-cta">
            <div className="planora-bottom-cta-box">
              <div className="planora-bottom-cta-text">
                <h2>Dành chỗ cho điều bạn muốn làm.</h2>
                <p>Bắt đầu trong workspace, duyệt trước khi tạo thay đổi.</p>
              </div>

              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={authLink('signup')}
                  className="planora-btn planora-btn-primary planora-btn-lg"
                  data-od-id="btn-footer-cta-signup"
                >
                  Bắt đầu cùng Planora
                </button>
                <button
                  type="button"
                  onClick={authLink('login')}
                  className="planora-btn planora-btn-secondary planora-btn-lg"
                >
                  Đăng nhập
                </button>
              </div>
            </div>
          </section>
        </main>

        {/* 6. Public Footer */}
        <footer className="planora-public-footer" role="contentinfo" data-od-id="footer">
          <div className="planora-public-footer-inner">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Brand size="sm" onClick={() => navigate('/')} />
              <span>Planora · 2026 · AI Workflow Automation Platform</span>
            </div>

            <div className="planora-footer-links">
              <a href="/" onClick={e => { e.preventDefault(); navigate('/'); }}>Không gian làm việc</a>
              <a href="/guide" onClick={e => { e.preventDefault(); navigate('/guide'); }}>Cẩm nang</a>
              <a href="/privacy" onClick={e => { e.preventDefault(); navigate('/privacy'); }}>Chính sách an toàn &amp; Dữ liệu</a>
            </div>
          </div>
        </footer>
      </div>

      {/* Auth Modal Overlay */}
      {authOpen && (
        <div
          id="auth-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="planora-auth-title"
          className="planora-auth-modal-overlay opacity-100"
          ref={authModalRef}
          onClick={backdrop(authModalRef, closeAuthModal)}
        >
          <div className="planora-auth-modal-container">
            <PlanoraAuthFrame
              ref={authCardRef}
              title={
                authView === 'google'
                  ? 'Đang chuyển sang trang đăng nhập của Google…'
                  : authView === 'success'
                  ? success?.title ?? 'Hoàn tất!'
                  : authView === 'forgot'
                  ? 'Quên mật khẩu?'
                  : isLoginView
                  ? 'Chào mừng trở lại.'
                  : 'Dành một chỗ cho ý tưởng.'
              }
              subtitle={
                authView === 'google'
                  ? 'Đang bắt đầu luồng xác thực Google OAuth...'
                  : authView === 'success'
                  ? (
                    <span id="success-desc" role="status">
                      {success?.desc ?? 'Kiểm tra email để xác minh tài khoản.'}
                    </span>
                  )
                  : authView === 'forgot'
                  ? 'Nhập email của bạn để nhận liên kết đặt lại mật khẩu.'
                  : isLoginView
                  ? 'Đăng nhập để tiếp tục không gian làm việc của bạn.'
                  : 'Tạo tài khoản để bắt đầu cùng Planora.'
              }
              onClose={closeAuthModal}
              tabs={
                authView === 'form' ? (
                  <div
                    role="tablist"
                    className="planora-auth-tabs"
                    aria-label="Hình thức xác thực"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={authModeView === 'login'}
                      className={`planora-auth-tab ${authModeView === 'login' ? 'active' : ''}`}
                      onClick={() => changeMode('login')}
                    >
                      Đăng nhập
                    </button>
                    {authConfig?.signupEnabled && (
                      <button
                        type="button"
                        role="tab"
                        aria-selected={authModeView === 'signup'}
                        className={`planora-auth-tab ${authModeView === 'signup' ? 'active' : ''}`}
                        onClick={() => changeMode('signup')}
                      >
                        Đăng ký
                      </button>
                    )}
                  </div>
                ) : undefined
              }
              footer={
                authView === 'form' ? (
                  isLoginView ? (
                    <div className="planora-auth-switch">
                      <span>Chưa có tài khoản?</span>
                      {authConfig?.signupEnabled ? (
                        <button
                          type="button"
                          className="planora-auth-link-btn"
                          onClick={() => changeMode('signup')}
                        >
                          Tạo tài khoản →
                        </button>
                      ) : (
                        <span>Liên hệ quản trị viên</span>
                      )}
                    </div>
                  ) : (
                    <div className="planora-auth-switch">
                      <span>Đã có tài khoản?</span>
                      <button
                        type="button"
                        className="planora-auth-link-btn"
                        onClick={() => changeMode('login')}
                      >
                        Đăng nhập →
                      </button>
                    </div>
                  )
                ) : undefined
              }
            >
              {authView === 'google' && (
                <div style={{ textAlign: 'center', padding: '24px 0' }}>
                  <div style={{ display: 'inline-block', marginBottom: 16 }}>
                    <svg className="w-8 h-8 animate-spin" width="32" height="32" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  </div>
                  <p style={{ color: 'var(--planora-muted)', marginBottom: 20 }}>
                    Đang chuyển hướng tới trang xác thực tài khoản Google...
                  </p>
                  <button
                    type="button"
                    onClick={closeAuthModal}
                    className="planora-btn planora-btn-secondary planora-btn-md"
                  >
                    Hủy
                  </button>
                </div>
              )}

              {authView === 'success' && (
                <div style={{ textAlign: 'center', padding: '16px 0' }}>
                  <button
                    ref={successCloseRef}
                    type="button"
                    onClick={closeAuthModal}
                    className="planora-btn planora-btn-primary planora-btn-md w-full"
                  >
                    Đóng
                  </button>
                </div>
              )}

              {authView === 'forgot' && (
                <form onSubmit={actions.handleForgotSubmit} aria-label="Khôi phục mật khẩu">
                  <div className="planora-auth-field">
                    <label htmlFor="forgot-email">Email</label>
                    <input
                      ref={forgotEmailRef}
                      id="forgot-email"
                      type="email"
                      autoComplete="email"
                      required
                      disabled={busy}
                      placeholder="ban@congty.vn"
                      className="planora-auth-input"
                    />
                  </div>

                  <div
                    id="forgot-feedback-box"
                    role={forgotSent ? 'status' : undefined}
                    className={`${forgotSent ? '' : 'hidden '}planora-auth-success-box`}
                    style={{
                      padding: '12px 14px',
                      margin: '12px 0',
                      borderRadius: 'var(--planora-radius-lg)',
                      backgroundColor: 'var(--planora-sidebar)',
                      border: '1px solid var(--planora-divider)',
                      fontSize: 'var(--planora-text-xs)',
                      color: 'var(--planora-primary)',
                      lineHeight: 1.5,
                    }}
                  >
                    Nếu email này có tài khoản, bạn sẽ nhận được link đặt lại mật khẩu.
                  </div>

                  {error && (
                    <p role="alert" className="planora-auth-error">
                      {error}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={busy}
                    className="planora-auth-submit"
                  >
                    {busy ? 'Đang gửi...' : 'Gửi link đặt lại mật khẩu'}
                  </button>

                  <div className="planora-auth-switch" style={{ justifyContent: 'center' }}>
                    <button
                      type="button"
                      className="planora-auth-link-btn"
                      onClick={() => changeMode('login')}
                    >
                      ← Quay lại đăng nhập
                    </button>
                  </div>
                </form>
              )}

              {authView === 'form' && isLoginView && (
                <form
                  id="login-form"
                  aria-label="Đăng nhập Planora"
                  aria-busy={isLoggingIn}
                  onSubmit={actions.handleLoginSubmit}
                >
                  <div className="planora-auth-field">
                    <label htmlFor="email">Email</label>
                    <input
                      ref={loginEmailRef}
                      id="email"
                      type="email"
                      autoComplete="username"
                      required
                      disabled={isLoggingIn}
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="ban@congty.vn"
                      className="planora-auth-input"
                    />
                  </div>

                  <div className="planora-auth-field">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label htmlFor="password">Mật khẩu</label>
                      <button
                        type="button"
                        onClick={actions.showForgotView}
                        className="planora-auth-link-btn planora-auth-forgot-link"
                      >
                        Quên mật khẩu?
                      </button>
                    </div>

                    <div className="planora-auth-input-wrapper">
                      <input
                        id="password"
                        type={loginPwdShown ? 'text' : 'password'}
                        autoComplete="current-password"
                        placeholder="••••••••"
                        required
                        disabled={isLoggingIn}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        onKeyDown={e => setCapsLock(e.getModifierState('CapsLock'))}
                        onKeyUp={e => setCapsLock(e.getModifierState('CapsLock'))}
                        onBlur={() => setCapsLock(false)}
                        className="planora-auth-input"
                        style={{ paddingRight: 48 }}
                      />
                      <button
                        type="button"
                        disabled={isLoggingIn}
                        aria-label={loginPwdShown ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                        aria-pressed={loginPwdShown}
                        onClick={() => setLoginPwdShown(!loginPwdShown)}
                        className="planora-auth-password-toggle"
                      >
                        {loginPwdShown ? (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                            <line x1="1" y1="1" x2="23" y2="23" />
                          </svg>
                        ) : (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        )}
                      </button>
                    </div>

                    {capsLock && (
                      <span id="login-caps-lock" role="status" className="planora-auth-caps-lock">
                        Caps Lock đang bật.
                      </span>
                    )}
                  </div>

                  {(authError || error) && (
                    <p id="login-auth-error" role="alert" className="planora-auth-error">
                      {authError || error}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={isLoggingIn}
                    className="planora-auth-submit"
                  >
                    {isLoggingIn ? 'Đang đăng nhập…' : 'Đăng nhập'}
                  </button>

                  {authConfig?.googleEnabled && (
                    <>
                      <div className="planora-auth-divider">
                        <span>hoặc</span>
                      </div>
                      <button
                        type="button"
                        onClick={triggerGoogleAuthFlow}
                        disabled={isLoggingIn || busy}
                        className="planora-auth-google-btn"
                        data-od-id="btn-hero-google"
                      >
                        <svg className="w-5 h-5 flex-shrink-0" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                          <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z" />
                          <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.36 24 12 24z" />
                          <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z" />
                          <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.36 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z" />
                        </svg>
                        <span>Tiếp tục với Google</span>
                      </button>
                    </>
                  )}

                  <div style={{ marginTop: 16, textAlign: 'center' }}>
                    <button
                      type="button"
                      className="planora-auth-link-btn"
                      style={{ fontSize: 'var(--planora-text-xs)' }}
                      onClick={() => navigate('/resend-verification')}
                    >
                      Gửi lại email xác minh
                    </button>
                  </div>
                </form>
              )}

              {authView === 'form' && !isLoginView && (
                authConfig?.signupEnabled ? (
                  <form
                    id="signup-form"
                    aria-label="Tạo tài khoản Planora"
                    aria-busy={busy}
                    onSubmit={actions.handleSignupSubmit}
                  >
                    <div className="planora-auth-field">
                      <label htmlFor="signup-name">Họ tên</label>
                      <input
                        ref={signupNameRef}
                        id="signup-name"
                        type="text"
                        autoComplete="name"
                        maxLength={100}
                        required
                        disabled={busy}
                        placeholder="Nguyễn Văn A"
                        className="planora-auth-input"
                      />
                    </div>

                    <div className="planora-auth-field">
                      <label htmlFor="signup-email">Email</label>
                      <input
                        ref={signupEmailRef}
                        id="signup-email"
                        type="email"
                        autoComplete="email"
                        maxLength={254}
                        required
                        disabled={busy}
                        placeholder="ban@congty.vn"
                        className="planora-auth-input"
                      />
                    </div>

                    <div className="planora-auth-field">
                      <label htmlFor="signup-password">Mật khẩu</label>
                      <div className="planora-auth-input-wrapper">
                        <input
                          id="signup-password"
                          type={signupPwdShown ? 'text' : 'password'}
                          autoComplete="new-password"
                          placeholder="••••••••"
                          minLength={12}
                          maxLength={128}
                          required
                          disabled={busy}
                          aria-describedby="signup-password-hint"
                          className="planora-auth-input"
                          style={{ paddingRight: 48 }}
                        />
                        <button
                          type="button"
                          disabled={busy}
                          aria-label={signupPwdShown ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                          aria-pressed={signupPwdShown}
                          onClick={() => setSignupPwdShown(!signupPwdShown)}
                          className="planora-auth-password-toggle"
                        >
                          {signupPwdShown ? (
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                              <line x1="1" y1="1" x2="23" y2="23" />
                            </svg>
                          ) : (
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                          )}
                        </button>
                      </div>
                      <span id="signup-password-hint" className="planora-auth-password-hint">
                        Từ 12 đến 128 ký tự.
                      </span>
                    </div>

                    {error && (
                      <p id="signup-error" role="alert" className="planora-auth-error">
                        {error}
                      </p>
                    )}

                    <button
                      type="submit"
                      disabled={busy}
                      className="planora-auth-submit"
                    >
                      {busy ? 'Đang tạo tài khoản…' : 'Gửi yêu cầu đăng ký'}
                    </button>

                    {authConfig?.googleEnabled && (
                      <>
                        <div className="planora-auth-divider">
                          <span>hoặc</span>
                        </div>
                        <button
                          type="button"
                          onClick={triggerGoogleAuthFlow}
                          disabled={busy}
                          className="planora-auth-google-btn"
                          data-od-id="btn-hero-google"
                        >
                          <svg className="w-5 h-5 flex-shrink-0" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                            <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z" />
                            <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.36 24 12 24z" />
                            <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z" />
                            <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.36 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z" />
                          </svg>
                          <span>Tiếp tục với Google</span>
                        </button>
                      </>
                    )}

                    <p style={{ fontSize: 'var(--planora-text-xs)', color: 'var(--planora-muted)', marginTop: 14, lineHeight: 1.5 }}>
                      Xác minh email và chờ quản trị viên phê duyệt trước khi sử dụng các dịch vụ của nhóm.
                    </p>
                  </form>
                ) : (
                  <div style={{ padding: '24px 0', textAlign: 'center' }}>
                    <p
                      id="auth-signup-disabled-notice"
                      role="status"
                      className="planora-auth-disabled-notice"
                      style={{ color: 'var(--planora-muted)', fontSize: 'var(--planora-text-sm)', lineHeight: 1.6, marginBottom: 16 }}
                    >
                      Đăng ký bằng email hiện đang đóng. Hãy liên hệ quản trị viên hoặc đăng nhập bằng tài khoản hiện có.
                    </p>

                    {error && (
                      <p role="alert" className="planora-auth-error">
                        {error}
                      </p>
                    )}

                    {authConfig?.googleEnabled && (
                      <button
                        type="button"
                        onClick={triggerGoogleAuthFlow}
                        disabled={busy}
                        className="planora-auth-google-btn"
                        data-od-id="btn-hero-google"
                      >
                        <svg className="w-5 h-5 flex-shrink-0" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                          <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z" />
                          <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.36 24 12 24z" />
                          <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z" />
                          <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.36 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z" />
                        </svg>
                        <span>Tiếp tục với Google</span>
                      </button>
                    )}
                  </div>
                )
              )}
            </PlanoraAuthFrame>
          </div>
        </div>
      )}
    </>
  );
}
export default LandingPage;
