import { useEffect, useRef, useState } from 'react';
import { apiClient } from '../services/api-client';
import { AuthFeedback } from '../views/AuthFormFrame';

export function GoogleAuthButton({ disabled = false }: { disabled?: boolean }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const mounted = useRef(false), pending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const start = async () => {
    if (pending.current || disabled) return;
    pending.current = true; setBusy(true); setError(null);
    try {
      const { url } = await apiClient.startGoogleAuth();
      if (mounted.current) window.location.assign(url);
    } catch {
      if (mounted.current) setError('Không thể bắt đầu đăng nhập Google. Hãy thử lại.');
    } finally {
      pending.current = false; if (mounted.current) setBusy(false);
    }
  };
  return <>
    <AuthFeedback error={error} />
    <button type="button" onClick={start} disabled={disabled || busy}
      className="w-full py-3 rounded-xl border border-border bg-surface text-text font-semibold text-sm hover:bg-surface-inset disabled:opacity-60 disabled:cursor-wait">
      {busy ? 'Đang chuyển tới Google...' : 'Tiếp tục với Google'}
    </button>
  </>;
}
