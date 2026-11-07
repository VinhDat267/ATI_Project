import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { readRoute, type AppRoute } from '../routes';
import { authStorage } from '../services/auth-storage';

const CONNECTION_CALLBACK_KINDS = new Set<AppRoute['kind']>([
  'slack-callback',
  'gmail-callback',
  'mycalendar-callback',
  'mysheets-callback',
  'trello-callback',
  'github-callback',
  'notion-callback',
  'jira-callback',
  'telegram-callback',
]);
const LOOPBACK_HOP_KEY = 'wap_loopback_callback_hop';

export function tryLoopbackCallbackHop(pathname: string, search: string, hash = ''): boolean {
  const { protocol, hostname, port } = window.location;
  if (!search || (hostname !== '127.0.0.1' && hostname !== 'localhost')) return false;
  if (typeof navigator !== 'undefined' && navigator.userAgent?.includes('jsdom') && !('mock' in window.location.replace)) {
    return false;
  }
  const hopTarget = `${pathname}${search}`;
  try {
    if (sessionStorage.getItem(LOOPBACK_HOP_KEY) === hopTarget) return false;
    sessionStorage.setItem(LOOPBACK_HOP_KEY, hopTarget);
    const altHost = hostname === '127.0.0.1' ? 'localhost' : '127.0.0.1';
    const portPart = port ? `:${port}` : '';
    window.location.replace(`${protocol}//${altHost}${portPart}${pathname}${search}${hash}`);
    return true;
  } catch {
    return false;
  }
}

/** The route retains one-use OAuth input after the address bar is scrubbed.
 * A stale session on the return host must not discard that input before the
 * existing bounded loopback recovery can reach the host that started OAuth.
 */
export function tryRecoverLoopbackConnectionCallback(route: AppRoute): boolean {
  const input = route.kind === 'gmail-callback' ? route.googleCallback
    : route.kind === 'jira-callback' ? route.jiraCallback
    : route.kind === 'trello-callback' ? route.trelloCallback
    : route.kind === 'notion-callback' ? route.notionCallback : undefined;
  if (!input?.code || !input.state || input.error) return false;
  const pathname = route.kind === 'gmail-callback'
    ? '/connections/gmail/callback'
    : route.kind === 'trello-callback'
      ? '/connections/trello/callback'
      : route.kind === 'notion-callback'
        ? '/connections/notion/callback'
        : '/connections/myjira/callback';
  return tryLoopbackCallbackHop(pathname, `?${new URLSearchParams({ code: input.code, state: input.state })}`);
}

export function useRoute(initialView?: 'landing' | 'login') {
  const [route, setRoute] = useState<AppRoute>(() => initialView
    ? { kind: initialView === 'login' ? 'login' : 'home' } : readRoute());
  useLayoutEffect(() => {
    if (CONNECTION_CALLBACK_KINDS.has(route.kind)) {
      const { pathname, search, hash } = window.location;
      if (!authStorage.getStoredTokens().accessToken && tryLoopbackCallbackHop(pathname, search, hash)) {
        return;
      }
      window.history.replaceState(window.history.state, '', pathname);
      return;
    }
    if (route.kind === 'google-callback') {
      const url = new URL(window.location.href);
      for (const key of ['code', 'state', 'error', 'error_description', 'error_uri']) url.searchParams.delete(key);
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
      return;
    }
    if (route.kind !== 'verify-email' && route.kind !== 'reset-password') return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has('token')) return;
    url.searchParams.delete('token');
    // Keep the token only in this route's memory. Never place it in storage or
    // history state, and remove it before the browser paints the page.
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, [route]);
  useEffect(() => {
    const onPopState = () => setRoute(readRoute());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  const navigate = useCallback((path: string, replace = false) => {
    window.history[replace ? 'replaceState' : 'pushState']({}, '', path);
    setRoute(readRoute());
  }, []);
  return { route, navigate };
}
