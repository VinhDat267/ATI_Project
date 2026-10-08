import { useCallback, useEffect, useRef, useState } from 'react';

/** Retry is a read-only health probe. It never retries a message, approval or recovery. */
export function useNetworkStatus() {
  const [offline, setOffline] = useState(!navigator.onLine);
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    const lost = () => setOffline(true);
    const restored = () => setOffline(false);
    window.addEventListener('offline', lost); window.addEventListener('online', restored);
    return () => { window.removeEventListener('offline', lost); window.removeEventListener('online', restored); request.current?.abort(); };
  }, []);
  const retry = useCallback(async () => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller; setBusy(true);
    try { const response = await fetch('/api/health', { signal: controller.signal, cache: 'no-store' }); if (!controller.signal.aborted) setOffline(!response.ok); }
    catch { if (!controller.signal.aborted) setOffline(true); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }, []);
  return { offline, busy, retry };
}
