import { useEffect, useRef, useState } from 'react';
import type { GoogleCallbackInput } from '../routes';
import { slackConnectionApi, type SlackConnection } from '../services/slack-connection';
import { gmailSessionOwner } from '../services/gmail-connection';
import { subscribeAuthTokens } from '../services/auth-storage';
import { usePrototypePage } from '../prototype/usePrototypePage';
export function SlackCallbackView({ input, navigate }: { input?: GoogleCallbackInput; navigate: (path: string, replace?: boolean) => void }) {
  usePrototypePage({ id: 'slack-callback', title: 'Kết nối Slack — ATI', htmlClass: '', bodyClass: 'min-h-screen bg-[#F8F8F6] text-[#111827] antialiased', css: '' });
  const data = useRef(input), owns = useRef(gmailSessionOwner()), invalid = useRef(false);
  const completion = useRef<Promise<SlackConnection> | null>(null);
  const [result, setResult] = useState<SlackConnection | null>(null), [error, setError] = useState('');
  useEffect(() => {
    let mounted = true;
    const stop = subscribeAuthTokens(() => { if (!owns.current()) invalid.current = true; });
    const live = () => mounted && !invalid.current && owns.current();
    const params = data.current;
    if (!params?.state || (!params.code && !params.error)) setError('Link kết nối đã hết hạn hoặc không hợp lệ. Hãy bắt đầu lại.');
    else {
      completion.current ??= slackConnectionApi.complete({ state: params.state, ...(params.error ? { error: 'denied' } : { code: params.code }) });
      completion.current.then(row => { if (live()) setResult(row); }).catch(e => {
        if (mounted && e?.status === 401) { setError('Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại rồi kết nối Slack.'); return; }
        if (live()) setError(e?.data?.code === 'SLACK_DENIED' ? 'Bạn đã hủy kết nối Slack.' : e?.data?.code === 'SLACK_IDENTITY_CONFLICT'
          ? 'Tài khoản Slack này đang liên kết với một tài khoản ATI khác. Hãy ngắt liên kết cũ trước.' : 'Không hoàn tất được kết nối Slack. Hãy trở về Kết nối dịch vụ và thử lại.');
      });
    }
    return () => { mounted = false; stop(); };
  }, []);
  return <main className="max-w-xl mx-auto px-4 py-16 text-[#111827] v3-space-y-5">
    <h1 className="font-display text-3xl">{result ? 'Đã kết nối Slack' : 'Kết nối Slack'}</h1>
    {error ? <p role="alert">{error}</p> : result ? <><p role="status">{result.workspaceName} · {result.workspaceId}</p><p>Kết nối đã được lưu. Việc đọc tin và xử lý bằng AI đang chờ cho phép xử lý dữ liệu.</p></> : <p role="status">Đang hoàn tất kết nối Slack…</p>}
    <button type="button" onClick={() => navigate('/settings#myslack', true)} className="bg-[#FF5701] text-white px-5 py-3 rounded-xl">Về Kết nối dịch vụ</button>
  </main>;
}
