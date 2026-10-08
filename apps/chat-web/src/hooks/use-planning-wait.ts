import { useEffect, useState } from 'react';

/** The elapsed time survives navigation because its origin belongs to the request in the store. */
export function usePlanningWait(startedAt: string | undefined, planning: boolean) {
  const elapsed = () => {
    const start = Date.parse(startedAt ?? '');
    return planning && Number.isFinite(start) ? Math.max(0, Date.now() - start) : 0;
  };
  const [milliseconds, setMilliseconds] = useState(elapsed);
  useEffect(() => {
    setMilliseconds(elapsed());
    if (!planning || !startedAt) return;
    const timer = window.setInterval(() => setMilliseconds(elapsed()), 250);
    return () => window.clearInterval(timer);
  }, [startedAt, planning]);
  return milliseconds;
}
