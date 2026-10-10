import { createElement, type ComponentProps } from 'react';
import { LandingView } from './views/LandingView';
import { LoginPage } from './views/LoginPage';
import { SignupView } from './views/SignupView';
import { VerifyEmailView } from './views/VerifyEmailView';
import { ForgotPasswordView } from './views/ForgotPasswordView';
import { ResetPasswordView } from './views/ResetPasswordView';
import { GoogleCallbackView } from './views/GoogleCallbackView';
import { ShellPageView } from './views/ShellPageView';

export interface GoogleCallbackInput { code?: string; state?: string; error?: string }
type PublicViewProps = ComponentProps<typeof LoginPage> & { navigate: (path: string, replace?: boolean) => void; token?: string; googleCallback?: GoogleCallbackInput };

// Path routes preserve direct conversation links and native browser history without a router dependency.
export const routes = [
  { kind: 'home', pattern: /^\/$/, publicView: (props: PublicViewProps) => createElement(LandingView, props) },
  { kind: 'login', pattern: /^\/login\/?$/, publicView: (props: PublicViewProps) => createElement(LoginPage, props) },
  { kind: 'signup', pattern: /^\/signup\/?$/, publicView: (props: PublicViewProps) => createElement(SignupView, props) },
  { kind: 'verify-email', pattern: /^\/verify-email\/?$/, publicView: (props: PublicViewProps) => createElement(VerifyEmailView, props) },
  { kind: 'resend-verification', pattern: /^\/resend-verification\/?$/, publicView: (props: PublicViewProps) => createElement(VerifyEmailView, { ...props, resend: true }) },
  { kind: 'forgot-password', pattern: /^\/forgot-password\/?$/, publicView: (props: PublicViewProps) => createElement(ForgotPasswordView, props) },
  { kind: 'reset-password', pattern: /^\/reset-password\/?$/, publicView: (props: PublicViewProps) => createElement(ResetPasswordView, props) },
  { kind: 'google-callback', pattern: /^\/auth\/google\/callback\/?$/, publicView: (props: PublicViewProps) => createElement(GoogleCallbackView, props) },
  { kind: 'conversation', pattern: /^\/c\/([^/]+)\/?$/ },
  { kind: 'admin-users', pattern: /^\/admin\/users\/?$/ },
  { kind: 'account', pattern: /^\/account\/?$/ },
  { kind: 'settings', pattern: /^\/settings\/?$/ },
  { kind: 'history', pattern: /^\/history\/?$/ },
  { kind: 'guide', pattern: /^\/guide\/?$/, publicView: (props: PublicViewProps) => createElement(ShellPageView, { title: 'Cẩm nang', publicPage: true, navigate: props.navigate }) },
  { kind: 'privacy', pattern: /^\/privacy\/?$/, publicView: (props: PublicViewProps) => createElement(ShellPageView, { title: 'Chính sách an toàn', publicPage: true, navigate: props.navigate }) },
] as const;
export type AppRoute = { kind: Exclude<typeof routes[number]['kind'], 'conversation'> | 'not-found'; token?: string; googleCallback?: GoogleCallbackInput } | { kind: 'conversation'; conversationId: string };

export function readRoute(): AppRoute {
  const query = new URLSearchParams(window.location.search);
  const view = query.get('view');
  if (window.location.pathname === '/' && (view === 'verify-email' || view === 'reset-password')) {
    return { kind: view, token: query.get('token') ?? undefined };
  }
  for (const route of routes) {
    const match = window.location.pathname.match(route.pattern);
    if (!match) continue;
    if (route.kind === 'google-callback') {
      const single = (key: string) => query.getAll(key).length === 1 ? query.get(key) || undefined : undefined;
      return { kind: route.kind, googleCallback: { code: single('code'), state: single('state'), error: query.has('error') ? 'denied' : undefined } };
    }
    if (route.kind === 'conversation') {
      try { return { kind: route.kind, conversationId: decodeURIComponent(match[1]) }; }
      catch { return { kind: 'not-found' }; }
    }
    return { kind: route.kind, ...(route.kind === 'verify-email' || route.kind === 'reset-password' ? { token: query.get('token') ?? undefined } : {}) };
  }
  return { kind: 'not-found' };
}

export const conversationPath = (id: string) => `/c/${encodeURIComponent(id)}`;
