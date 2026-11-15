// LandingPage architectural entry — modular design-taste-frontend layout with live API auth & accessibility contracts.
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import type { LoginViewProps } from '../../components/LoginView';
import { useGmailEnabled, useMySheetsEnabled } from '../../hooks/use-gmail-enabled';
import { ThemeToggle } from '../../prototype/ThemeToggle';
import { usePrototypePage, type PageMeta } from '../../prototype/usePrototypePage';
import { apiClient } from '../../services/api-client';
import { userErrorMessage } from '../../services/user-error';
import {
  LandingAuthModal,
  type AuthModalMode,
  type AuthModalSuccessState,
  type AuthModalView,
} from './LandingAuthModal';
import { LandingCinemaStage } from './LandingCinemaStage';
import { LandingEcosystemAndClose } from './LandingEcosystemAndClose';
import { LandingExecutionTheatre } from './LandingExecutionTheatre';
import { LandingHeroWorkbench } from './LandingHeroWorkbench';
import { LandingRhythmAndTrust } from './LandingRhythmAndTrust';
import css from './page.css?inline';

const meta: PageMeta = {
  id: 'index',
  title: 'Planora — Nền tảng điều phối công việc tự động bằng AI',
  htmlClass: 'scroll-smooth',
  bodyClass: 'selection:bg-[#FF5701]/20 selection:text-[#111827]',
  css,
};

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const modalOpeners = new WeakMap<
  Document,
  { element: HTMLElement | null; id: string; returnRequested: boolean }
>();

function rememberModalOpener(element: HTMLElement | null) {
  if (!element) return;
  const id = element.dataset.odId;
  if (id) {
    modalOpeners.set(element.ownerDocument, { element, id, returnRequested: false });
  }
}

function requestModalFocusReturn() {
  const opener = modalOpeners.get(document);
  modalOpeners.set(
    document,
    opener
      ? { ...opener, returnRequested: true }
      : { element: null, id: 'btn-header-login', returnRequested: true },
  );
}

function restoreRequestedModalFocus() {
  const opener = modalOpeners.get(document);
  modalOpeners.delete(document);
  if (!opener?.returnRequested) return;
  const element = opener.element?.isConnected
    ? opener.element
    : [...document.querySelectorAll<HTMLElement>('[data-od-id]')].find(
        (node) => node.dataset.odId === opener.id,
      );
  element?.focus();
}

export interface LandingPageProps extends Partial<LoginViewProps> {
  navigate: (path: string, replace?: boolean) => void;
  initialMode?: AuthModalMode | 'forgot';
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
  const gmailEnabled = useGmailEnabled();
  const mysheetsEnabled = useMySheetsEnabled();
  usePrototypePage(meta);

  const [activeMoment, setActiveMoment] = useState(1);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [localAuthMode, setLocalAuthMode] = useState<AuthModalMode | null>(null);
  const [authView, setAuthView] = useState<AuthModalView>(
    initialMode === 'forgot' ? 'forgot' : 'form',
  );
  const [googleModalOpen, setGoogleModalOpen] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [success, setSuccess] = useState<AuthModalSuccessState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLocalAuthMode(null);
    setAuthView(initialMode === 'forgot' ? 'forgot' : 'form');
  }, [initialMode]);

  const effectiveMode = initialMode ?? localAuthMode;
  const authModeView: AuthModalMode = effectiveMode === 'signup' ? 'signup' : 'login';
  const authOpen = Boolean(effectiveMode) || googleModalOpen;

  const authModalRef = useRef<HTMLDivElement>(null);
  const authCardRef = useRef<HTMLDivElement>(null);
  const loginEmailRef = useRef<HTMLInputElement>(null);
  const signupNameRef = useRef<HTMLInputElement>(null);
  const signupEmailRef = useRef<HTMLInputElement>(null);
  const forgotEmailRef = useRef<HTMLInputElement>(null);
  const successCloseRef = useRef<HTMLButtonElement>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const manualMomentLockUntil = useRef(0);
  const generation = useRef(0);
  const pending = useRef(false);

  const signupEnabled = Boolean(authConfig?.signupEnabled);
  const googleEnabled = Boolean(authConfig?.googleEnabled);

  const lockScroll = (on: boolean) => {
    document.documentElement.classList.toggle('overflow-hidden', on);
    document.body.classList.toggle('overflow-hidden', on);
  };

  useEffect(() => {
    const owner = ++generation.current;
    return () => {
      if (generation.current === owner) generation.current++;
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
      if (authView === 'google') {
        authCardRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
      } else if (authView === 'success') {
        successCloseRef.current?.focus();
      } else if (authView === 'forgot') {
        forgotEmailRef.current?.focus();
      } else if (effectiveMode === 'signup') {
        signupNameRef.current?.focus();
      } else {
        loginEmailRef.current?.focus();
      }
    }
    return () => {
      lockScroll(false);
    };
  }, [authOpen, effectiveMode, authView, signupEnabled]);

  useEffect(() => {
    const triggers = document.querySelectorAll<HTMLElement>('.moment-trigger');
    if (typeof window === 'undefined' || !window.IntersectionObserver || triggers.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (Date.now() < manualMomentLockUntil.current) return;
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const target = Number(entry.target.getAttribute('data-moment'));
          if (target) flushSync(() => setActiveMoment(target));
        });
      },
      { root: null, rootMargin: '-25% 0px -35% 0px', threshold: 0.2 },
    );
    triggers.forEach((trigger) => observer.observe(trigger));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileMenuOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [mobileMenuOpen]);

  const selectMoment = (target: number) => {
    manualMomentLockUntil.current = Date.now() + 750;
    setActiveMoment(target);
    const trigger = document.getElementById(`trigger-moment-${target}`);
    if (trigger && typeof window.scrollTo === 'function') {
      const top = trigger.getBoundingClientRect().top + window.scrollY - 108;
      if (top > 0) {
        window.scrollTo({
          top,
          behavior: reducedMotion() ? 'auto' : 'smooth',
        });
      }
    }
  };

  const changeMode = (mode: AuthModalMode) => {
    setError(null);
    setLocalAuthMode(mode);
    setAuthView('form');
    navigate(mode === 'signup' ? '/signup' : '/login');
  };

  const closeAuthModal = () => {
    generation.current++;
    requestModalFocusReturn();
    setLocalAuthMode(null);
    setGoogleModalOpen(false);
    setAuthView('form');
    setBusy(false);
    setError(null);
    navigate('/');
  };

  const triggerGoogleAuthFlow = async () => {
    if (pending.current || !googleEnabled) return;
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

  const handleOpenLogin = (trigger: HTMLElement | null) => {
    setMobileMenuOpen(false);
    if (!authOpen) rememberModalOpener(trigger);
    changeMode('login');
  };

  const handleOpenSignup = (trigger: HTMLElement | null) => {
    setMobileMenuOpen(false);
    if (!authOpen) rememberModalOpener(trigger);
    changeMode('signup');
  };

  const handleOpenGoogle = (trigger: HTMLElement | null) => {
    setMobileMenuOpen(false);
    if (!authOpen) rememberModalOpener(trigger);
    void triggerGoogleAuthFlow();
  };

  const handleTryPrompt = (promptText: string, trigger: HTMLElement | null) => {
    try {
      sessionStorage.setItem('ati_prefill_prompt', promptText);
    } catch {
      // Bỏ qua lỗi bộ nhớ phiên nếu trình duyệt chặn
    }
    if (!authOpen) rememberModalOpener(trigger);
    changeMode('signup');
  };

  const handleShowForgot = () => {
    setError(null);
    setForgotSent(false);
    setAuthView('forgot');
    navigate('/forgot-password');
  };

  const handleLoginSubmit = (event: FormEvent<HTMLFormElement>) => {
    void onLogin?.(event);
  };

  const handleSignupSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending.current || !signupEnabled) return;
    const pwd = event.currentTarget.querySelector<HTMLInputElement>('#signup-password')?.value ?? '';
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
        pwd,
      );
      if (generation.current === owner) {
        setSuccess({ title: 'Đã gửi yêu cầu đăng ký!', desc: data.message, isLogin: false });
        setAuthView('success');
      }
    } catch (reason) {
      if (generation.current === owner) setError(userErrorMessage(reason));
    } finally {
      pending.current = false;
      if (generation.current === owner) setBusy(false);
    }
  };

  const handleForgotSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    const owner = generation.current;
    setBusy(true);
    setError(null);
    try {
      await apiClient.forgotPassword(forgotEmailRef.current?.value.trim() ?? '');
      if (generation.current === owner) setForgotSent(true);
    } catch (reason) {
      if (generation.current === owner) setError(userErrorMessage(reason));
    } finally {
      pending.current = false;
      if (generation.current === owner) setBusy(false);
    }
  };

  return (
    <>
      <div className="pl-root" inert={authOpen} aria-hidden={authOpen}>
        <header data-od-id="nav-header" className="pl-header">
          <div className="pl-header-inner">
            <a href="#workflow-showcase" className="pl-brand">
              <span className="pl-brand-mark">P</span>
              <span>Planora</span>
            </a>

            <nav className="pl-nav-links" aria-label="Điều hướng chính">
              <a href="#product-film" className="pl-nav-link">
                Phim 20 giây
              </a>
              <a href="#story-stage" className="pl-nav-link">
                Hành trình 5 chặng
              </a>
              <a href="#schedule-automation" className="pl-nav-link">
                Lịch định kỳ
              </a>
              <a href="#integrations" className="pl-nav-link">
                Kết nối
              </a>
              <a
                href="/guide"
                onClick={(e) => {
                  e.preventDefault();
                  navigate('/guide');
                }}
                className="pl-nav-link"
              >
                Hướng dẫn
              </a>
            </nav>

            <div className="pl-nav-actions">
              <ThemeToggle />

              <a
                href="/login"
                data-od-id="btn-header-login"
                onClick={(e) => {
                  e.preventDefault();
                  handleOpenLogin(e.currentTarget);
                }}
                className="pl-nav-pill-login"
              >
                Đăng nhập
              </a>

              {signupEnabled && (
                <a
                  href="/signup"
                  data-od-id="btn-header-signup"
                  onClick={(e) => {
                    e.preventDefault();
                    handleOpenSignup(e.currentTarget);
                  }}
                  className="pl-nav-pill-cta"
                >
                  Bắt đầu
                </a>
              )}

              <button
                ref={mobileMenuButtonRef}
                type="button"
                data-od-id="btn-mobile-menu"
                data-testid="landing-mobile-menu-btn"
                aria-expanded={mobileMenuOpen}
                aria-controls="landing-mobile-drawer"
                aria-label={mobileMenuOpen ? 'Đóng menu điều hướng' : 'Mở menu điều hướng'}
                onClick={() => setMobileMenuOpen((prev) => !prev)}
                className="pl-mobile-menu-btn"
              >
                {mobileMenuOpen ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </header>

        {mobileMenuOpen && (
          <div
            id="landing-mobile-drawer"
            data-testid="landing-mobile-drawer"
            className="pl-mobile-drawer"
            role="navigation"
            aria-label="Menu di động"
          >
            <div className="flex flex-col gap-3">
              <a href="#product-film" onClick={() => setMobileMenuOpen(false)} className="pl-nav-link py-1.5 w-fit">
                Phim thực tế 20 giây
              </a>
              <a href="#story-stage" onClick={() => setMobileMenuOpen(false)} className="pl-nav-link py-1.5 w-fit">
                Hành trình 5 chặng
              </a>
              <a href="#schedule-automation" onClick={() => setMobileMenuOpen(false)} className="pl-nav-link py-1.5 w-fit">
                Lịch định kỳ mỗi sáng
              </a>
              <a href="#integrations" onClick={() => setMobileMenuOpen(false)} className="pl-nav-link py-1.5 w-fit">
                Công cụ kết nối
              </a>
              <a
                href="/guide"
                onClick={(e) => {
                  e.preventDefault();
                  setMobileMenuOpen(false);
                  navigate('/guide');
                }}
                className="pl-nav-link py-1.5 w-fit"
              >
                Hướng dẫn &amp; mẫu câu
              </a>
              <div className="pt-2.5 border-t border-white/15 flex flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={() => handleOpenLogin(mobileMenuButtonRef.current)}
                  className="pl-btn-ghost-dark flex-1 justify-center"
                >
                  Đăng nhập
                </button>
                {signupEnabled && (
                  <button
                    type="button"
                    onClick={() => handleOpenSignup(mobileMenuButtonRef.current)}
                    className="pl-btn-light flex-1 justify-center"
                  >
                    Tạo tài khoản
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        <main>
          <LandingHeroWorkbench
            onOpenSignup={handleOpenSignup}
            onOpenGoogle={handleOpenGoogle}
            onTryPrompt={handleTryPrompt}
            signupEnabled={signupEnabled}
            googleEnabled={googleEnabled}
          />

          <LandingCinemaStage gmailEnabled={gmailEnabled} playbackSuspended={authOpen} />

          <LandingExecutionTheatre
            activeMoment={activeMoment}
            onSelectMoment={selectMoment}
            onTryPrompt={handleTryPrompt}
            onOpenSignup={handleOpenSignup}
          />

          <LandingRhythmAndTrust onTryPrompt={handleTryPrompt} />

          <LandingEcosystemAndClose
            gmailEnabled={gmailEnabled}
            mysheetsEnabled={mysheetsEnabled}
            signupEnabled={signupEnabled}
            googleEnabled={googleEnabled}
            onOpenSignup={handleOpenSignup}
            onOpenLogin={handleOpenLogin}
            onOpenGoogle={handleOpenGoogle}
            onNavigate={(path) => navigate(path)}
          />
        </main>
      </div>

      <LandingAuthModal
        open={authOpen}
        mode={authModeView}
        view={authView}
        modalRef={authModalRef}
        cardRef={authCardRef}
        loginEmailRef={loginEmailRef}
        signupNameRef={signupNameRef}
        signupEmailRef={signupEmailRef}
        forgotEmailRef={forgotEmailRef}
        successCloseRef={successCloseRef}
        onClose={closeAuthModal}
        onChangeMode={changeMode}
        onShowForgot={handleShowForgot}
        onTriggerGoogle={() => void triggerGoogleAuthFlow()}
        onNavigate={(path) => navigate(path)}
        signupEnabled={signupEnabled}
        googleEnabled={googleEnabled}
        busy={busy}
        isLoggingIn={isLoggingIn}
        error={error}
        authError={authError}
        loginEmail={email}
        setLoginEmail={setEmail}
        loginPassword={password}
        setLoginPassword={setPassword}
        onLoginSubmit={handleLoginSubmit}
        onSignupSubmit={handleSignupSubmit}
        onForgotSubmit={handleForgotSubmit}
        forgotSent={forgotSent}
        success={success}
      />
    </>
  );
}

export default LandingPage;
