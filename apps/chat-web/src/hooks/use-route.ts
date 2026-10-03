import { useCallback, useEffect, useState } from 'react';
import { readRoute, type AppRoute } from '../routes';

export function useRoute(initialView?: 'landing' | 'login') {
  const [route, setRoute] = useState<AppRoute>(() => initialView
    ? { kind: initialView === 'login' ? 'login' : 'home' } : readRoute());
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
