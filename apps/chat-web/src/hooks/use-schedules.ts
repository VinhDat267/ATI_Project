import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiClient } from '../services/api-client';
import { subscribeAuthTokens } from '../services/auth-storage';
import type { User } from '../types';

/** Only the server capability enables schedule requests. Missing health fields mean off. */
export const SchedulesCapabilityContext = createContext(false);
export function SchedulesCapabilityProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let current = true;
    Promise.resolve(apiClient.getRuntime?.()).then(data => { if (current) setEnabled(data?.schedulesEnabled === true); }).catch(() => {});
    return () => { current = false; };
  }, []);
  return createElement(SchedulesCapabilityContext.Provider, { value: enabled }, children);
}
export const useSchedulesEnabled = () => useContext(SchedulesCapabilityContext);
export const schedulesChanged = () => window.dispatchEvent(new Event('schedules:changed'));
export function useSchedulePendingCount(user: User | null) {
  const enabled = useSchedulesEnabled();
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(0);
    if (!enabled || !user) return;
    let current = true, sequence = 0;
    const refresh = () => {
      if (!current) return;
      const request = ++sequence;
      void apiClient.getSchedulePendingCount().then(data => { if (current && request === sequence) setCount(data.count); }).catch(() => {});
    };
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh); window.addEventListener('schedules:changed', refresh);
    const unsubscribe = subscribeAuthTokens(tokens => { if (!tokens.accessToken || tokens.user?.id !== user.id) { current = false; setCount(0); window.clearInterval(timer); } });
    return () => { current = false; window.clearInterval(timer); unsubscribe(); window.removeEventListener('focus', refresh); window.removeEventListener('schedules:changed', refresh); };
  }, [enabled, user?.id]);
  return enabled && user ? count : 0;
}
