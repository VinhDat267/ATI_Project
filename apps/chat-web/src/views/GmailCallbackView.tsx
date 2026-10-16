import { useEffect, useRef, useState } from 'react';
import type { GoogleCallbackInput } from '../routes';
import { apiClient } from '../services/api-client';
import { subscribeAuthTokens } from '../services/auth-storage';
import { gmailSessionOwner, gmailCallbackError, gmailConnectionNotice } from '../services/gmail-connection';
import { usePrototypePage } from '../prototype/usePrototypePage';
const meta = { id: 'gmail-callback', title: 'Kết nối Gmail — ATI', htmlClass: '', bodyClass: 'min-h-screen bg-[#F8F8F6] text-[#111827] antialiased', css: '' };

export function GmailCallbackView({ navigate, input }: { navigate: (path: string, replace?: boolean) => void; input?: GoogleCallbackInput }) {
  usePrototypePage(meta);
  const [error, setError] = useState('');
  const callback = useRef(input), owns = useRef(gmailSessionOwner()), invalidated = useRef(false);
  const completion = useRef<Promise<{ email: string }> | null>(null);
  useEffect(() => {
    let mounted = true;
    const unsubscribe = subscribeAuthTokens(tokens => { if (!tokens.accessToken || !owns.current()) invalidated.current = true; });
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== localStorage) return;
      if (event.key === null || (['wap_access_token', 'wap_refresh_token', 'wap_user'].includes(event.key) && (!owns.current() || event.newValue === null))) invalidated.current = true;
    };
    window.addEventListener('storage', onStorage);
    const live = () => mounted && !invalidated.current && owns.current();
    const data = callback.current;
    if (data?.error || !data?.code || !data?.state) setError(data?.error ? 'Bạn đã huỷ kết nối Gmail.' : gmailCallbackError('GMAIL_STATE_INVALID'));
    else if (live()) {
      completion.current ??= apiClient.completeGmailConnection(data.code, data.state);
      completion.current.then(result => {
        if (!live()) return;
        gmailConnectionNotice.set(result.email);
        navigate('/settings#gmail', true);
      }).catch(reason => { if (live()) setError(gmailCallbackError(reason?.data?.code)); });
    }
    return () => { mounted = false; unsubscribe(); window.removeEventListener('storage', onStorage); };
  }, [navigate]);
  return <main className="max-w-xl mx-auto px-4 py-16 text-[#111827] v3-space-y-5">
    <h1 className="font-display text-3xl">Kết nối Gmail</h1>
    {error ? <p role="alert">{error}</p> : <p role="status">Đang hoàn tất kết nối Gmail…</p>}
    <a href="/settings" onClick={event => { event.preventDefault(); navigate('/settings', true); }} className="text-[#FF5701] underline">Về Kết nối dịch vụ</a>
  </main>;
}
