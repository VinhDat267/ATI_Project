import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { authStorage, subscribeAuthTokens } from '../services/auth-storage';
import { apiClient } from '../services/api-client';
import { userErrorMessage } from '../services/user-error';
import { useChatStore } from '../store/chat-store';
import { NotFoundView } from '../views/NotFoundView';
import { routes, type AppRoute } from '../routes';
import type { User } from '../types';

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
  useEffect(() => {
    let current = true;
    apiClient.getAuthConfig().then(data => { if (current) setAuthConfig(data); }).catch(() => {});
    return () => { current = false; };
  }, []);
  useEffect(() => subscribeAuthTokens(tokens => {
    setAuthToken(tokens.accessToken);
    if (tokens.user) setUser(tokens.user);
    else if (!tokens.accessToken) setUser(null);
  }), []);
  useEffect(() => {
    let current = true;
    const { accessToken, user: storedUser } = authStorage.getStoredTokens();
    if (accessToken) {
      setAuthToken(accessToken); if (storedUser) setUser(storedUser);
      apiClient.getMe().then(data => {
        if (current && data?.user) { setUser(data.user); authStorage.setStoredTokens({ user: data.user }); }
      }).catch(reason => {
        if (!current) return;
        if (reason?.status === 401) { authStorage.clearStoredTokens(); setAuthToken(null); setUser(null); }
        else setAuthError(userErrorMessage(reason));
      });
    }
    return () => { current = false; };
  }, []);
  useEffect(() => { if (authToken && route.kind === 'login') navigate('/', true); }, [authToken, route.kind, navigate]);
  const onLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setAuthError(null); setIsLoggingIn(true);
    try {
      const data = await apiClient.login(email, password);
      setAuthToken(data.accessToken); setUser(data.user); setPassword('');
      if (route.kind !== 'conversation') navigate('/', true);
    } catch (reason) { setAuthError(userErrorMessage(reason, 'Không thể xác thực với API backend')); }
    finally { setIsLoggingIn(false); }
  };
  const onLogout = async () => {
    try { await apiClient.logout(); } catch { /* Local logout still succeeds if the server cannot be reached. */ }
    finally {
      authStorage.clearStoredTokens(); setAuthToken(null); setUser(null);
      useChatStore.getState().reset(); useChatStore.getState().setConversations([]);
      navigate('/');
    }
  };
  const isAccountFlow = ['signup', 'verify-email', 'resend-verification', 'forgot-password', 'reset-password'].includes(route.kind);
  if (authToken && !isAccountFlow) return children({ authToken, user, authError, onClearAuthError: () => setAuthError(null), onLogout });
  if (route.kind === 'not-found') return <NotFoundView onGoHome={() => navigate('/')} />;
  const definition = routes.find(entry => entry.kind === route.kind);
  const PublicView = definition && 'publicView' in definition ? definition.publicView : routes[1].publicView;
  return <PublicView navigate={navigate} email={email} setEmail={setEmail} password={password} setPassword={setPassword}
    isLoggingIn={isLoggingIn} authError={authError} onLogin={onLogin} authConfig={authConfig} onBackToLanding={() => navigate('/')}
    onSignup={() => navigate('/signup')} onForgotPassword={() => navigate('/forgot-password')} onResendVerification={() => navigate('/resend-verification')}
    token={'token' in route ? route.token : undefined} />;
}
