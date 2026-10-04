import { createElement, type ComponentProps } from 'react';
import { LandingView } from './views/LandingView';
import { LoginPage } from './views/LoginPage';
import { SignupView } from './views/SignupView';
import { VerifyEmailView } from './views/VerifyEmailView';
import { ForgotPasswordView } from './views/ForgotPasswordView';
import { ResetPasswordView } from './views/ResetPasswordView';

type PublicViewProps = ComponentProps<typeof LoginPage> & { navigate: (path: string, replace?: boolean) => void; token?: string };

// Path routes preserve direct conversation links and native browser history without a router dependency.
export const routes = [
  { kind: 'home', pattern: /^\/$/, publicView: (props: PublicViewProps) => createElement(LandingView, { onGoToLogin: () => props.navigate('/login') }) },
  { kind: 'login', pattern: /^\/login\/?$/, publicView: (props: PublicViewProps) => createElement(LoginPage, props) },
  { kind: 'signup', pattern: /^\/signup\/?$/, publicView: (props: PublicViewProps) => createElement(SignupView, props) },
  { kind: 'verify-email', pattern: /^\/verify-email\/?$/, publicView: (props: PublicViewProps) => createElement(VerifyEmailView, props) },
  { kind: 'resend-verification', pattern: /^\/resend-verification\/?$/, publicView: (props: PublicViewProps) => createElement(VerifyEmailView, { ...props, resend: true }) },
  { kind: 'forgot-password', pattern: /^\/forgot-password\/?$/, publicView: (props: PublicViewProps) => createElement(ForgotPasswordView, props) },
  { kind: 'reset-password', pattern: /^\/reset-password\/?$/, publicView: (props: PublicViewProps) => createElement(ResetPasswordView, props) },
  { kind: 'conversation', pattern: /^\/c\/([^/]+)\/?$/ },
] as const;
export type AppRoute = { kind: Exclude<typeof routes[number]['kind'], 'conversation'> | 'not-found'; token?: string } | { kind: 'conversation'; conversationId: string };

export function readRoute(): AppRoute {
  const query = new URLSearchParams(window.location.search);
  const view = query.get('view');
  if (window.location.pathname === '/' && (view === 'verify-email' || view === 'reset-password')) {
    return { kind: view, token: query.get('token') ?? undefined };
  }
  for (const route of routes) {
    const match = window.location.pathname.match(route.pattern);
    if (!match) continue;
    if (route.kind === 'conversation') {
      try { return { kind: route.kind, conversationId: decodeURIComponent(match[1]) }; }
      catch { return { kind: 'not-found' }; }
    }
    return { kind: route.kind, ...(route.kind === 'verify-email' || route.kind === 'reset-password' ? { token: query.get('token') ?? undefined } : {}) };
  }
  return { kind: 'not-found' };
}

export const conversationPath = (id: string) => `/c/${encodeURIComponent(id)}`;
