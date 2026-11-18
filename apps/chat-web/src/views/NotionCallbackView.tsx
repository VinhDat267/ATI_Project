import { useEffect, useRef, useState } from 'react';
import { apiClient } from '../services/api-client';
import type { NotionCallbackInput } from '../routes';
import {
  conversationReturnPath,
  notionCallbackError,
  notionConnectionNotice,
  notionSessionOwner,
  redirectToNotion,
} from '../services/notion-connection';
import { usePrototypePage } from '../prototype/usePrototypePage';

const meta = { id: 'notion-callback', title: 'Kết nối Notion — Planora', htmlClass: '', bodyClass: 'min-h-screen bg-[#F8F4EE] text-[#1a0e08] antialiased', css: '' };

export function NotionCallbackView({
  input,
  navigate,
}: {
  input?: NotionCallbackInput;
  navigate: (path: string, replace?: boolean) => void;
}) {
  usePrototypePage(meta);
  const completion = useRef<ReturnType<typeof apiClient.completeNotionConnection> | null>(null);
  const [error, setError] = useState(() =>
    input?.error
      ? 'Bạn đã hủy kết nối Notion.'
      : !input?.code || !input?.state
        ? 'Liên kết xác thực Notion không hợp lệ.'
        : ''
  );
  const [retrying, setRetrying] = useState(false);

  const navReplace = (path: string) => {
    navigate(path, true);
  };

  useEffect(() => {
    if (error || !input?.code || !input?.state) return;
    let active = true;
    const owner = notionSessionOwner();

    completion.current ??= apiClient.completeNotionConnection(input.code, input.state);
    void completion.current
      .then((result) => {
        if (!active || notionSessionOwner() !== owner) return;
        const back = conversationReturnPath(result.returnTo);
        if (back && result.status === 'connected') {
          navReplace(back);
          return;
        }
        if (result.workspaceName) {
          notionConnectionNotice.set(result.workspaceName);
        }
        navReplace('/settings#notion');
      })
      .catch((err) => {
        if (!active || notionSessionOwner() !== owner) return;
        const code = err?.data?.code || err?.code || err?.data?.error;
        setError(notionCallbackError(typeof code === 'string' ? code : undefined));
      });

    return () => {
      active = false;
    };
  }, [error, input?.code, input?.state]);

  const retry = async () => {
    const owner = notionSessionOwner();
    setRetrying(true);
    try {
      const { url } = await apiClient.startNotionConnection();
      if (notionSessionOwner() !== owner) return;
      redirectToNotion(url);
    } catch {
      if (notionSessionOwner() !== owner) return;
      setRetrying(false);
      setError('Không thể bắt đầu kết nối Notion. Vui lòng thử lại.');
    }
  };

  return (
    <main className="min-h-screen bg-[#F8F4EE] text-[#1a0e08] flex flex-col justify-between px-4 py-8">
      <div className="mx-auto w-full max-w-sm flex items-center justify-between text-xs text-[#6A5F56]">
        <span className="font-semibold text-[#1a0e08]">AI Workflow Platform</span>
        <button
          type="button"
          onClick={() => navReplace('/settings#notion')}
          className="hover:text-[#1a0e08]"
        >
          Cài đặt dịch vụ
        </button>
      </div>
      <section className="mx-auto w-full max-w-sm my-auto py-8 space-y-4">
        <h1 className="text-xl font-semibold tracking-tight text-[#1a0e08]">
          Kết nối Notion
        </h1>
        {error ? (
          <div className="space-y-4">
            <p
              role="alert"
              className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
            >
              {error}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={retrying}
                onClick={retry}
                className="rounded bg-[#1a0e08] px-3 py-2 text-xs font-medium text-white hover:bg-[#2a2420] disabled:opacity-50"
              >
                {retrying ? 'Đang mở Notion...' : 'Thử kết nối lại'}
              </button>
              <button
                type="button"
                onClick={() => navReplace('/settings#notion')}
                className="rounded border border-[#E8E0D6] bg-white px-3 py-2 text-xs font-medium text-[#51463E] hover:bg-[#F3EEE7]"
              >
                Về trang Dịch vụ
              </button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-[#6A5F56]">
            Đang hoàn tất kết nối tài khoản Notion của bạn...
          </p>
        )}
      </section>
      <div />
    </main>
  );
}
