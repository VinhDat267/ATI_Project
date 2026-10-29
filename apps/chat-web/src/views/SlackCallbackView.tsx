import { useEffect, useRef, useState } from 'react';
import type { GoogleCallbackInput } from '../routes';
import {
  slackConnectionApi,
  slackSessionOwner,
  conversationReturnPath,
  type SlackCallbackResult,
} from '../services/slack-connection';
import { subscribeAuthTokens } from '../services/auth-storage';
import { usePrototypePage } from '../prototype/usePrototypePage';

export function SlackCallbackView({
  input,
  navigate,
}: {
  input?: GoogleCallbackInput;
  navigate: (path: string, replace?: boolean) => void;
}) {
  usePrototypePage({
    id: 'slack-callback',
    title: 'Kết nối Slack — ATI',
    htmlClass: '',
    bodyClass: 'min-h-screen bg-[#F8F8F6] text-[#111827] antialiased',
    css: '',
  });

  const data = useRef(input);
  const owns = useRef(slackSessionOwner());
  const invalid = useRef(false);
  const completion = useRef<Promise<SlackCallbackResult> | null>(null);

  const [result, setResult] = useState<SlackCallbackResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    const stop = subscribeAuthTokens(() => {
      if (!owns.current()) {
        invalid.current = true;
        if (mounted) {
          setResult(null);
          setError('Phiên kết nối đã hết hạn hoặc không hợp lệ. Vui lòng thử lại.');
        }
      }
    });
    const live = () => mounted && !invalid.current && owns.current();
    const params = data.current;

    if (!params?.state || (!params.code && !params.error)) {
      setError('Link kết nối đã hết hạn hoặc không hợp lệ. Hãy bắt đầu lại.');
      return () => {
        mounted = false;
        stop();
      };
    }

    // Scrub callback secrets from the browser URL before making network calls
    if (typeof window !== 'undefined' && window.location.search) {
      try {
        const cleanUrl = new URL(window.location.href);
        cleanUrl.search = '';
        window.history.replaceState({}, '', cleanUrl.pathname + cleanUrl.hash);
      } catch {
        /* ignore history replacement failures in constrained environments */
      }
    }

    completion.current ??= slackConnectionApi.complete({
      state: params.state,
      ...(params.error ? { error: 'denied' } : { code: params.code }),
    });

    completion.current
      .then((res) => {
        if (!live()) return;
        const target = conversationReturnPath(res.returnTo);
        if (target) {
          navigate(target, true);
          return;
        }
        setResult(res);
      })
      .catch((e: any) => {
        // 401 clears auth tokens which triggers token subscriber invalidation; handle it while mounted
        if (mounted && e?.status === 401) {
          setError('Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại rồi kết nối Slack.');
          return;
        }
        if (!live()) return;
        const code = e?.data?.code;
        if (code === 'SLACK_DENIED') {
          setError('Bạn đã hủy kết nối Slack.');
        } else if (code === 'SLACK_IDENTITY_CONFLICT') {
          setError(
            'Tài khoản Slack này đang liên kết với một tài khoản ATI khác. Hãy ngắt liên kết cũ trước.'
          );
        } else if (code === 'SLACK_STATE_INVALID') {
          setError('Phiên kết nối đã hết hạn hoặc không hợp lệ. Vui lòng thử lại.');
        } else {
          setError('Không hoàn tất được kết nối Slack. Hãy trở về Kết nối dịch vụ và thử lại.');
        }
      });

    return () => {
      mounted = false;
      stop();
    };
  }, [navigate]);

  return (
    <main className="max-w-xl mx-auto px-4 py-16 text-[#111827] v3-space-y-5">
      <h1 className="font-display text-3xl font-semibold">
        {result ? 'Đã kết nối Slack' : 'Kết nối Slack'}
      </h1>
      {error ? (
        <p role="alert" className="text-sm text-[#DC2626]">
          {error}
        </p>
      ) : result ? (
        <>
          <p role="status" className="text-base font-medium">
            <span>{result.workspaceName}</span> · <span>{result.workspaceId}</span>
          </p>
          <p className="text-sm text-[#4B5563]">
            Kết nối workspace đã được lưu thành công. Bạn có thể kiểm tra trạng thái quyền xử lý dữ liệu tại Kết nối dịch vụ.
          </p>
        </>
      ) : (
        <p role="status" className="text-sm text-[#4B5563]">
          Đang hoàn tất kết nối Slack…
        </p>
      )}
      <button
        type="button"
        onClick={() => navigate('/settings#myslack', true)}
        className="bg-[#FF5701] text-white px-5 py-3 rounded-xl font-medium hover:bg-[#E04C00] transition-colors"
      >
        Về Kết nối dịch vụ
      </button>
    </main>
  );
}
