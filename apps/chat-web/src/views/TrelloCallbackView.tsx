import { useEffect, useRef, useState } from 'react';
import type { TrelloCallbackInput } from '../routes';
import { apiClient } from '../services/api-client';
import { subscribeAuthTokens } from '../services/auth-storage';
import { trelloSessionOwner, trelloCallbackError, trelloConnectionNotice, conversationReturnPath } from '../services/trello-connection';
import { usePrototypePage } from '../prototype/usePrototypePage';

const meta = { id: 'trello-callback', title: 'Kết nối Trello — ATI', htmlClass: '', bodyClass: 'min-h-screen bg-[#F8F8F6] text-[#111827] antialiased', css: '' };

export function TrelloCallbackView({ navigate, input }: { navigate: (path: string, replace?: boolean) => void; input?: TrelloCallbackInput }) {
  usePrototypePage(meta);
  const [error, setError] = useState('');
  const callback = useRef(input), owns = useRef(trelloSessionOwner()), invalidated = useRef(false);
  const completion = useRef<Promise<{ username: string; returnTo?: string }> | null>(null);

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
    if (data?.error || !data?.code || !data?.state) setError(data?.error ? 'Bạn đã huỷ kết nối Trello.' : trelloCallbackError('TRELLO_STATE_INVALID'));
    else if (live()) {
      completion.current ??= apiClient.completeTrelloConnection(data.code, data.state);
      completion.current.then(result => {
        if (!live()) return;
        const back = conversationReturnPath(result.returnTo);
        if (back) { navigate(back, true); return; }
        trelloConnectionNotice.set(result.username);
        navigate('/settings#trello', true);
      }).catch(reason => { if (live()) setError(trelloCallbackError(reason?.data?.code)); });
    }
    return () => { mounted = false; unsubscribe(); window.removeEventListener('storage', onStorage); };
  }, [navigate]);

  return (
    <main className="max-w-xl mx-auto px-4 py-16 text-[#111827] v3-space-y-5">
      <h1 className="font-display text-3xl">Kết nối Trello</h1>
      {error ? <p role="alert">{error}</p> : <p role="status">Đang hoàn tất kết nối Trello…</p>}
      <a href="/settings" onClick={event => { event.preventDefault(); navigate('/settings', true); }} className="text-[#FF5701] underline">Về Kết nối dịch vụ</a>
    </main>
  );
}
