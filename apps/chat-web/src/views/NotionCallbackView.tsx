import { useEffect, useRef, useState } from 'react';
import type { GoogleCallbackInput } from '../routes';
import { notionConnectionApi, type NotionConnection } from '../services/notion-connection';
import { gmailSessionOwner } from '../services/gmail-connection';
import { subscribeAuthTokens } from '../services/auth-storage';
import { usePrototypePage } from '../prototype/usePrototypePage';
export function NotionCallbackView({ input, navigate }: { input?: GoogleCallbackInput; navigate: (path: string, replace?: boolean) => void }) {
  usePrototypePage({ id: 'notion-callback', title: 'Kết nối Notion — ATI', htmlClass: '', bodyClass: 'min-h-screen bg-[#F8F8F6] text-[#111827] antialiased', css: '' });
  const data = useRef(input), owns = useRef(gmailSessionOwner()), invalid = useRef(false);
  const completion = useRef<Promise<NotionConnection> | null>(null);
  const [result, setResult] = useState<NotionConnection | null>(null), [error, setError] = useState('');
  useEffect(() => {
    let mounted = true;
    const stop = subscribeAuthTokens(() => { if (!owns.current()) invalid.current = true; });
    const live = () => mounted && !invalid.current && owns.current();
    const params = data.current;
    if (!params?.state || (!params.code && !params.error)) setError('Link kết nối đã hết hạn hoặc không hợp lệ. Hãy bắt đầu lại.');
    else {
      completion.current ??= notionConnectionApi.complete({ state: params.state, ...(params.error ? { error: 'denied' } : { code: params.code }) });
      completion.current.then(row => { if (live()) setResult(row); }).catch(e => {
        if (mounted && e?.status === 401) { setError('Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại rồi kết nối Notion.'); return; }
        if (live()) setError(e?.data?.code === 'NOTION_DENIED' ? 'Bạn đã hủy kết nối Notion.' : e?.data?.code === 'NOTION_IDENTITY_CONFLICT'
          ? 'Tài khoản Notion này đang liên kết với một tài khoản ATI khác. Hãy ngắt liên kết cũ trước.' : 'Không hoàn tất được kết nối Notion. Hãy trở về Kết nối dịch vụ và thử lại.');
      });
    }
    return () => { mounted = false; stop(); };
  }, []);
  return <main className="max-w-xl mx-auto px-4 py-16 text-[#111827] v3-space-y-5">
    <h1 className="font-display text-3xl">{result ? 'Đã kết nối Notion' : 'Kết nối Notion'}</h1>
    {error ? <p role="alert">{error}</p> : result ? <><p role="status">{result.workspaceName} · {result.workspaceId}</p><p>Đã cấp quyền cho integration Notion. Tiếp theo, về Kết nối dịch vụ để chọn database được dùng.</p></> : <p role="status">Đang hoàn tất kết nối Notion…</p>}
    <button type="button" onClick={() => navigate('/settings#mynotion', true)} className="bg-[#FF5701] text-white px-5 py-3 rounded-xl">Về Kết nối dịch vụ</button>
  </main>;
}
