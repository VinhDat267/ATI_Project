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
import { usePrototypePage } from '../prototype/usePrototypePage';
import { ConnectionCallbackFrame } from '../planora/layout/ConnectionCallbackFrame';

const meta = {
  id: 'jira-callback',
  title: 'Kết nối Jira — Planora',
  htmlClass: '',
  bodyClass: 'min-h-screen bg-[var(--planora-canvas,#F8F8F6)] text-[var(--planora-text,#111827)] antialiased',
  css: '',
};

export function JiraCallbackView({
  input,
  navigate,
}: {
  input?: JiraCallbackInput;
  navigate: (path: string, replace?: boolean) => void;
}) {
  usePrototypePage(meta);

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
    <main>
      <ConnectionCallbackFrame
        serviceId="jira"
        serviceName="Atlassian Jira"
        title="Kết nối Jira"
        badge="KẾT NỐI QUẢN LÝ DỰ ÁN"
        statusType={error ? 'error' : 'pending'}
        statusLabel={error ? 'Chưa kết nối' : 'Đang xử lý'}
        loading={!error}
        loadingText="Đang hoàn tất kết nối Jira…"
        error={error ? <p role="alert">{error}</p> : undefined}
        onBackToSettings={() => navigate('/settings#jira', true)}
        backToSettingsLabel="Về Kết nối dịch vụ"
      />
    </main>
  );
}

export default JiraCallbackView;
