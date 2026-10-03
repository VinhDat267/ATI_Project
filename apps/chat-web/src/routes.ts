import { createElement, type ComponentProps } from 'react';
import { LandingView } from './views/LandingView';
import { LoginPage } from './views/LoginPage';

type PublicViewProps = ComponentProps<typeof LoginPage> & { navigate: (path: string, replace?: boolean) => void };

// Path routes preserve direct conversation links and native browser history without a router dependency.
export const routes = [
  { kind: 'home', pattern: /^\/$/, publicView: (props: PublicViewProps) => createElement(LandingView, { onGoToLogin: () => props.navigate('/login') }) },
  { kind: 'login', pattern: /^\/login\/?$/, publicView: (props: PublicViewProps) => createElement(LoginPage, props) },
  { kind: 'conversation', pattern: /^\/c\/([^/]+)\/?$/ },
] as const;
export type AppRoute = { kind: Exclude<typeof routes[number]['kind'], 'conversation'> | 'not-found' } | { kind: 'conversation'; conversationId: string };

export function readRoute(): AppRoute {
  for (const route of routes) {
    const match = window.location.pathname.match(route.pattern);
    if (!match) continue;
    if (route.kind === 'conversation') {
      try { return { kind: route.kind, conversationId: decodeURIComponent(match[1]) }; }
      catch { return { kind: 'not-found' }; }
    }
    return { kind: route.kind };
  }
  return { kind: 'not-found' };
}

export const conversationPath = (id: string) => `/c/${encodeURIComponent(id)}`;
