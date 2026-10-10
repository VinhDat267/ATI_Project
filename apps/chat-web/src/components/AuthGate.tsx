import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { authStorage, subscribeAuthTokens } from '../services/auth-storage';
import { apiClient, sharesAuthSession } from '../services/api-client';
import { userErrorMessage } from '../services/user-error';
import { useChatStore } from '../store/chat-store';
import { NotFoundPage } from '../pages/NotFound/NotFoundPage';
import { routes, type AppRoute } from '../routes';
import type { User } from '../types';
import { AuthActionPage, type AuthActionMode } from '../pages/AuthAction/AuthActionPage';
import { clearAuthReturnTarget, consumeAuthReturnTarget, currentAuthReturnTarget, saveAuthReturnTarget } from '../services/auth-return-target';

interface Session {
  authToken: string; user: User | null; authError: string | null;
  onClearAuthError: () => void; onLogout: () => void;
}
interface AuthGateProps {
  route: AppRoute; navigate: (path: string, replace?: boolean) => void;
  children: (session: Session) => ReactNode;
}
export function AuthGate({ route, navigate, children }: AuthGateProps) {
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [authConfig, setAuthConfig] = useState({ signupEnabled: false, googleEnabled: false });
  const [blocked, setBlocked] = useState<{ mode: AuthActionMode; deadline?: number | null; message: string } | null>(null);
  const loginPending = useRef(false);
  const initialTokens = useRef(authStorage.getStoredTokens());
  const hadSession = useRef(Boolean(initialTokens.current.accessToken));
  const previousUserId = useRef(initialTokens.current.user?.id);
  const loggingOut = useRef(false);
  useEffect(() => {
    let current = true;
    apiClient.getAuthConfig().then(data => { if (current) setAuthConfig(data); }).catch(() => {});
    return () => { current = false; };
  }, []);
  useEffect(() => subscribeAuthTokens((tokens, source) => {
    const lostSession = hadSession.current && !tokens.accessToken;
    hadSession.current = Boolean(tokens.accessToken);
    const lostUserId = previousUserId.current;
    if (tokens.user?.id) previousUserId.current = tokens.user.id;
    setAuthToken(tokens.accessToken);
    if (tokens.user) setUser(tokens.user);
    else if (!tokens.accessToken) setUser(null);
    if (lostSession) {
      useChatStore.getState().reset(); useChatStore.getState().setConversations([]);
      if (!loggingOut.current && route.kind !== 'reset-password') {
        if (source !== 'storage') saveAuthReturnTarget(currentAuthReturnTarget(), lostUserId);
        setAuthError(source === 'storage' ? 'Bạn đã đăng xuất ở một tab khác.' : 'Phiên đăng nhập đã hết hạn');
        navigate('/login', true);
      }
    }
  }), [navigate, route.kind]);
  useEffect(() => {
    const definition = routes.find(entry => entry.kind === route.kind);
    const protectedRoute = route.kind !== 'not-found' && (!definition || !('publicView' in definition));
    if (protectedRoute && !authStorage.getStoredTokens().accessToken) saveAuthReturnTarget(currentAuthReturnTarget());
  }, [route]);
  useEffect(() => {
    let current = true;
    const { accessToken, refreshToken, user: storedUser } = authStorage.getStoredTokens();
    const ownsHydration = () => {
      const latest = authStorage.getStoredTokens();
      return current && Boolean(latest.accessToken) &&
        (latest.accessToken === accessToken || sharesAuthSession(accessToken, latest.accessToken));
    };
    if (accessToken) {
      setAuthToken(accessToken); if (storedUser) setUser(storedUser);
      apiClient.getMe().then(data => {
        if (ownsHydration() && data?.user) { setUser(data.user); authStorage.setStoredTokens({ user: data.user }); }
      }).catch(reason => {
        if (!ownsHydration()) return;
        if (reason?.status === 401) {
          // An obsolete response can still belong to the same rotating session.
          // Only invalidate the exact pair that this hydration began with.
          const latest = authStorage.getStoredTokens();
          if (latest.accessToken === accessToken && latest.refreshToken === refreshToken) {
            authStorage.clearStoredTokens(); setAuthToken(null); setUser(null);
          }
        }
        else setAuthError(userErrorMessage(reason));
      });
    }
    return () => { current = false; };
  }, []);
  useEffect(() => {
    if (authToken && user?.id && route.kind === 'login' && !loginPending.current) {
      navigate(consumeAuthReturnTarget(user.id) ?? '/', true);
    }
  }, [authToken, user?.id, route.kind, navigate]);
  const onLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (loginPending.current) return;
    loginPending.current = true; setBlocked(null); setAuthError(null); setIsLoggingIn(true);
    try {
      const data = await apiClient.login(email, password);
      setAuthToken(data.accessToken); setUser(data.user); setPassword('');
      navigate(consumeAuthReturnTarget(data.user.id) ?? (route.kind === 'conversation' ? currentAuthReturnTarget() : '/'), true);
    } catch (reason) {
      const failure = reason as { status?: number; data?: { code?: string }; response?: Response };
      if (failure.status === 429) {
        const header = failure.response?.headers.get('Retry-After');
        const seconds = header && /^\d+(?:\.\d+)?$/.test(header.trim()) ? Number(header) : null;
        const timestamp = header && seconds === null ? Date.parse(header) : NaN;
        const deadline = seconds !== null ? Date.now() + Math.max(0, seconds) * 1000 : Number.isFinite(timestamp) ? Math.max(Date.now(), timestamp) : null;
        setBlocked({ mode: 'blocked-attempts', deadline, message: 'Sai mật khẩu quá nhiều lần. Hãy chờ hết thời gian trước khi thử lại.' });
      } else if (failure.data?.code === 'ACCOUNT_PENDING') setBlocked({ mode: 'blocked-pending', message: 'Tài khoản đang chờ quản trị viên duyệt.' });
      else if (failure.data?.code === 'ACCOUNT_DISABLED') setBlocked({ mode: 'blocked-locked', message: 'Tài khoản đã bị vô hiệu hóa. Hãy liên hệ quản trị viên.' });
      else setAuthError(userErrorMessage(reason, 'Không thể xác thực với API backend'));
    }
    finally { loginPending.current = false; setIsLoggingIn(false); }
  };
  const onLogout = async () => {
    loggingOut.current = true;
    clearAuthReturnTarget();
    try { await apiClient.logout(); } catch { /* Local logout still succeeds if the server cannot be reached. */ }
    finally {
      authStorage.clearStoredTokens(); setAuthToken(null); setUser(null);
      useChatStore.getState().reset(); useChatStore.getState().setConversations([]);
      navigate('/');
      loggingOut.current = false;
    }
  };
  const isAccountFlow = ['signup', 'verify-email', 'resend-verification', 'forgot-password', 'reset-password', 'google-callback'].includes(route.kind);
  if (authToken && !isAccountFlow) return children({ authToken, user, authError, onClearAuthError: () => setAuthError(null), onLogout });
  if (route.kind === 'not-found') return <NotFoundPage signedIn={false} navigate={navigate} />;
  const definition = routes.find(entry => entry.kind === route.kind);
  const showsLogin = route.kind === 'login' || !definition || !('publicView' in definition);
  if (showsLogin && blocked) return <AuthActionPage mode={blocked.mode} email={email} deadline={blocked.deadline} error={blocked.message}
    navigate={(path, replace) => { setBlocked(null); setAuthError(null); navigate(path, replace); }} />;
  const PublicView = definition && 'publicView' in definition ? definition.publicView : routes[1].publicView;
  return <PublicView navigate={navigate} email={email} setEmail={setEmail} password={password} setPassword={setPassword}
    isLoggingIn={isLoggingIn} authError={authError} onLogin={onLogin} authConfig={authConfig} onBackToLanding={() => navigate('/')}
    onSignup={() => navigate('/signup')} onForgotPassword={() => navigate('/forgot-password')} onResendVerification={() => navigate('/resend-verification')}
    token={'token' in route ? route.token : undefined} googleCallback={'googleCallback' in route ? route.googleCallback : undefined} />;
}
