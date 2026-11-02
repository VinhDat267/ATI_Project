import { useEffect, useState } from 'react';
import { slackConnectionApi, slackSessionOwner, type SlackConnection } from '../../services/slack-connection';
import {
  slackAssistantApi,
  type SlackDirectoryChannelDto,
  type SlackDirectoryUserDto,
} from '../../services/slack-assistant';

export interface SlackReadControlsProps {
  purpose?: 'read' | 'write';
  userId?: string;
  busy: boolean;
  value: string | null;
  onChange: (value: string | null) => void;
  onSelectChannel?: (channelId: string, channelName: string) => void;
  onSelectUser?: (userId: string, userName: string) => void;
}

export function SlackReadControls({
  userId,
  busy,
  value,
  onChange,
  purpose = 'read',
  onSelectChannel,
  onSelectUser,
}: SlackReadControlsProps) {
  const active = value !== null;
  const [connections, setConnections] = useState<SlackConnection[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [channels, setChannels] = useState<SlackDirectoryChannelDto[]>([]);
  const [users, setUsers] = useState<SlackDirectoryUserDto[]>([]);
  const [loadingDirectory, setLoadingDirectory] = useState(false);

  useEffect(() => {
    setChannels([]);
    setUsers([]);
  }, [value, active, userId]);

  useEffect(() => {
    if (!active) return;
    let current = true;
    const owns = slackSessionOwner();
    setLoading(true);
    setConnections([]);
    setError('');
    onChange('');
    slackConnectionApi
      .list()
      .then((data) => {
        if (!current || !owns()) return;
        const rows = data.connections.filter((row) => row.status === 'active');
        setConnections(rows);
        if (rows.length === 1) onChange(rows[0].id);
      })
      .catch(() => {
        if (current && owns()) setError('Không tải được workspace. Hãy thử bật lại tra cứu.');
      })
      .finally(() => {
        if (current && owns()) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [active, userId]);

  const loadDirectory = async () => {
    if (!value || loadingDirectory) return;
    const owns = slackSessionOwner();
    setLoadingDirectory(true);
    setError('');
    try {
      const dir = await slackAssistantApi.getDirectory(value, AbortSignal.timeout(15000));
      if (owns()) {
        setChannels(Array.isArray(dir.channels) ? dir.channels : []);
        setUsers(Array.isArray(dir.users) ? dir.users : []);
      }
    } catch {
      if (owns()) {
        setError('Chưa tải được danh bạ kênh Slack. Bạn vẫn có thể nhập mã kênh trực tiếp.');
      }
    } finally {
      if (owns()) setLoadingDirectory(false);
    }
  };

  return (
    <section
      aria-label={purpose === 'write' ? 'Gửi tin Slack' : 'Chế độ tra cứu'}
      className="mb-6 rounded-2xl border border-brand-border bg-white p-4 text-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          aria-pressed={active}
          disabled={busy}
          onClick={() => onChange(active ? null : '')}
          className="rounded-lg border border-brand-border px-3 py-2 font-medium text-brand-text"
        >
          {purpose === 'write' ? 'Gửi tin Slack' : 'Tra cứu Slack của bạn'}
        </button>
        <a href="/inbox" className="text-xs underline text-brand-muted">
          Mở hộp thư đề xuất Slack
        </a>
      </div>
      {active && (
        <div className="mt-3 space-y-2">
          {loading ? (
            <p role="status">Đang tải workspace…</p>
          ) : connections.length ? (
            <label className="block">
              Workspace Slack
              <select
                className="mt-1 block w-full min-w-0 rounded-lg border border-brand-border bg-white p-2 text-brand-text"
                value={value ?? ''}
                disabled={busy}
                onChange={(event) => onChange(event.target.value)}
              >
                <option value="">Chọn workspace</option>
                {connections.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.workspaceName} · {row.workspaceId} · {row.slackUserLabel}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p>
              Chưa có workspace sẵn sàng.{' '}
              <a href="/settings#myslack" className="underline">
                Kết nối Slack
              </a>
            </p>
          )}
          {value && (
            <div className="space-y-2 pt-1">
              <button
                type="button"
                disabled={busy || loadingDirectory}
                onClick={() => void loadDirectory()}
                className="rounded-lg border border-brand-border px-2.5 py-1 text-xs font-medium text-brand-text disabled:opacity-50"
              >
                {loadingDirectory
                  ? 'Đang tải danh bạ Slack…'
                  : channels.length > 0
                    ? 'Làm mới danh bạ kênh Slack'
                    : 'Chọn kênh từ danh bạ Slack'}
              </button>
              {channels.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className="block text-xs">
                    Chọn kênh (#channel)
                    <select
                      aria-label="Danh sách kênh Slack"
                      className="mt-1 block w-full min-w-0 rounded-lg border border-brand-border bg-white p-1.5 text-xs text-brand-text"
                      defaultValue=""
                      disabled={busy}
                      onChange={(e) => {
                        const ch = channels.find((item) => item.id === e.target.value);
                        if (ch) onSelectChannel?.(ch.id, ch.name);
                      }}
                    >
                      <option value="">Chọn kênh Slack…</option>
                      {channels.map((ch) => (
                        <option key={ch.id} value={ch.id}>
                          {ch.isPrivate ? '🔒 ' : '#'}
                          {ch.name} ({ch.id})
                        </option>
                      ))}
                    </select>
                  </label>
                  {purpose === 'read' && users.length > 0 && (
                    <label className="block text-xs">
                      Chọn thành viên (@user)
                      <select
                        aria-label="Danh sách thành viên Slack"
                        className="mt-1 block w-full min-w-0 rounded-lg border border-brand-border bg-white p-1.5 text-xs text-brand-text"
                        defaultValue=""
                        disabled={busy}
                        onChange={(e) => {
                          const u = users.find((item) => item.id === e.target.value);
                          if (u) onSelectUser?.(u.id, u.displayName);
                        }}
                      >
                        <option value="">Chọn thành viên Slack…</option>
                        {users.map((u) => (
                          <option key={u.id} value={u.id}>
                            @{u.displayName} ({u.id})
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              )}
            </div>
          )}
          {error && <p role="alert">{error}</p>}
          <p className="text-xs text-brand-muted">
            {purpose === 'write'
              ? 'Chọn workspace và mã kênh. Nội dung bạn nhập sẽ được gửi nguyên văn sau khi duyệt.'
              : 'ATI chỉ đọc sau khi bạn duyệt. Kết quả được lưu tối đa 1 ngày, trong phạm vi workspace cho phép.'}
          </p>
          {!loading && connections.length > 1 && !value && (
            <p role="status" className="text-xs">
              Chọn workspace trước khi gửi yêu cầu.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
