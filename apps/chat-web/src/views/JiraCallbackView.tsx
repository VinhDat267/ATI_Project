import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { JiraCallbackInput } from '../routes';
import { jiraApi } from '../services/jira-api';
import {
  jiraSessionOwner,
  jiraCallbackError,
  jiraConnectionNotice,
  conversationReturnPath,
} from '../services/jira-connection';
import { subscribeAuthTokens } from '../services/auth-storage';

export function JiraCallbackView({
  input,
  navigate,
}: {
  input?: JiraCallbackInput;
  navigate: (path: string, replace?: boolean) => void;
}) {
  useLayoutEffect(() => {
    // Strip sensitive OAuth query parameters from the URL before paint
    window.history.replaceState(window.history.state, '', '/connections/myjira/callback');
  }, []);

  const [error, setError] = useState('');
  const original = useRef(input);
  const owns = useRef(jiraSessionOwner());
  const pending = useRef<ReturnType<typeof jiraApi.callback> | null>(null);

  useEffect(() => {
    let mounted = true;
    let invalidated = false;

    const unsubscribe = subscribeAuthTokens((tokens) => {
      if (!tokens.accessToken || !owns.current()) {
        invalidated = true;
      }
    });

    const live = () => mounted && !invalidated && owns.current();
    const callback = original.current;

    if (callback?.error) {
      setError('Bạn đã huỷ kết nối Jira.');
    } else if (!callback?.code || !callback?.state) {
      setError('Yêu cầu kết nối Jira không hợp lệ. Hãy kết nối lại.');
    } else if (live()) {
      pending.current ??= jiraApi.callback(callback.code, callback.state);
      pending.current
        .then((result) => {
          if (!live()) return;
          if (result.displayName) {
            jiraConnectionNotice.set(result.displayName);
          }
          const target = conversationReturnPath(result.returnTo) ?? '/settings#jira';
          navigate(target, true);
        })
        .catch((reason) => {
          if (live()) {
            const code = reason?.data?.code || reason?.code;
            const message =
              jiraCallbackError(code) ||
              reason?.data?.error ||
              reason?.message ||
              'Không hoàn tất được kết nối Jira. Hãy kết nối lại.';
            setError(message);
          }
        });
    }

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [navigate]);

  return (
    <main className="max-w-xl mx-auto px-4 py-16 text-[#111827] dark:text-white">
      <h1 className="font-display text-3xl font-semibold mb-4">Kết nối Jira</h1>
      {error ? (
        <div role="alert" className="p-4 mb-4 rounded-xl bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 border border-red-200 dark:border-red-900 text-sm">
          {error}
        </div>
      ) : (
        <p role="status" className="text-sm text-[#4B5563] dark:text-[#9CA3AF] mb-4">
          Đang hoàn tất kết nối Jira…
        </p>
      )}
      <div>
        <a
          href="/settings#jira"
          onClick={(event) => {
            event.preventDefault();
            navigate('/settings#jira', true);
          }}
          className="text-xs font-semibold text-[#FF5701] hover:underline"
        >
          ← Về Kết nối dịch vụ
        </a>
      </div>
    </main>
  );
}
