import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { readRoute, type AppRoute } from '../routes';
import { authStorage } from '../services/auth-storage';

const CONNECTION_CALLBACK_KINDS = new Set<AppRoute['kind']>([
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
