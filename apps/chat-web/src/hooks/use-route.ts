import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { readRoute, type AppRoute } from '../routes';

export function useRoute(initialView?: 'landing' | 'login') {
  const [route, setRoute] = useState<AppRoute>(() => initialView
    ? { kind: initialView === 'login' ? 'login' : 'home' } : readRoute());
  useLayoutEffect(() => {
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
