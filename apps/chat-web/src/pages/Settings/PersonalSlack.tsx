import {SlackAutomationSettings} from '../../components/slack/SlackAutomationSettings';
import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  slackConnectionApi,
  openSlackAuthorization,
  slackSessionOwner,
  type SlackConnectionPublicInfo,
} from '../../services/slack-connection';
import { CockpitDialog } from '../../components/CockpitDialog';

export function PersonalSlack() {
  const [rows, setRows] = useState<SlackConnectionPublicInfo[]>([]);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [disconnectTarget, setDisconnectTarget] = useState<SlackConnectionPublicInfo | null>(null);

  const loadConnections = useCallback(async () => {
    const owns = slackSessionOwner();
    setLoadError('');
    try {
      const data = await slackConnectionApi.list();
      if (owns() && Array.isArray(data.connections)) {
        setRows(data.connections);
      }
    } catch {
      if (owns()) {
        setLoadError('Không tải được danh sách kết nối Slack. Vui lòng thử lại.');
      }
    }
  }, []);

  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  const start = async (workspaceHint?: string) => {
    const owns = slackSessionOwner();
    setBusy('connect');
    setError('');
    try {
      const data = await slackConnectionApi.start(workspaceHint ? { workspaceHint } : undefined);
      if (owns()) openSlackAuthorization(data.url);
    } catch {
      if (owns()) setError('Không mở được trang kết nối Slack. Hãy thử lại.');
    } finally {
      if (owns()) setBusy('');
    }
  };

  const reconnect = (row: SlackConnectionPublicInfo) => {
    return start(row.workspaceId);
  };

  const executeDisconnect = async (target: SlackConnectionPublicInfo) => {
    const owns = slackSessionOwner();
    setBusy(target.id);
    setError('');
    setNotice('');
    try {
      const result = await slackConnectionApi.disconnect(target.id);
      if (owns()) {
        setRows((prev) => prev.filter((r) => r.id !== target.id));
        setNotice(
          result.revoked
            ? 'Đã ngắt kết nối và thu hồi quyền Slack.'
            : 'Đã ngắt trong ATI. Chưa xác nhận thu hồi ở Slack; hãy gỡ quyền ứng dụng trong Slack.'
        );
        setDisconnectTarget(null);
      }
    } catch {
      if (owns()) setError('Chưa ngắt được kết nối Slack. Hãy thử lại.');
    } finally {
      if (owns()) setBusy('');
    }
  };

  const getHeaderDescription = () => {
    if (rows.length === 0) {
      return 'Kết nối workspace để quản lý quyền xử lý dữ liệu Slack.';
    }
    const readyCount = rows.filter((r) => r.processingReady).length;
    if (readyCount === rows.length) {
      return 'Tất cả workspace đã được cấp quyền xử lý dữ liệu.';
    }
    if (readyCount > 0) {
      return 'Một số workspace đã sẵn sàng xử lý dữ liệu; các workspace còn lại đang chờ cấp quyền.';
    }
    return 'Các workspace đang chờ cấp quyền xử lý dữ liệu.';
  };

  return (
    <section
      id="myslack"
      aria-labelledby="myslack-title"
      className="my-6 p-5 bg-white dark:bg-[#1E1E1E] border border-[#E7E7E2] dark:border-[#333333] rounded-xl v3-space-y-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id="myslack-title" className="font-display text-xl font-semibold text-[#111827] dark:text-white">
          Slack của bạn
        </h2>
        <p className="text-sm text-[#4B5563] dark:text-[#9CA3AF]">
          Kết nối từng workspace bằng tài khoản Slack của bạn. Mỗi workspace được quản lý riêng.
        </p>
        <p className="text-sm text-[#6B7280] dark:text-[#9CA3AF]">
          {getHeaderDescription()}
        </p>
      </div>

      {loadError ? (
        <div className="v3-space-y-3">
          <p role="alert" className="text-sm text-[#DC2626]">
            {loadError}
          </p>
          <button
            type="button"
            onClick={() => void loadConnections()}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#FF5701] text-white hover:bg-[#E04C00] transition-colors"
          >
            Thử lại
          </button>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-[#6B7280] dark:text-[#9CA3AF]">Chưa kết nối workspace nào.</p>
      ) : (
        <ul className="v3-space-y-3">
          {rows.map((row) => (
            <li
              key={row.id}
              className="border border-[#E7E7E2] dark:border-[#333333] rounded-lg p-3.5 break-words bg-[#FAFAFA] dark:bg-[#252525]"
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold text-base text-[#111827] dark:text-white break-all">
                    {row.workspaceName}
                  </h3>
                  <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF] mt-0.5 break-all font-mono">
                    <span>{row.workspaceId}</span> · <span>{row.slackUserLabel}</span>
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-1 sm:mt-0">
                  {row.status === 'reconnect_required' ? (
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300">
                      Cần kết nối lại
                    </span>
                  ) : row.status === 'revoked' ? (
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                      Đã thu hồi
                    </span>
                  ) : row.processingReady ? (
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-950/60 dark:text-green-300">
                      Đã sẵn sàng xử lý
                    </span>
                  ) : (
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                      Chờ cho phép xử lý dữ liệu
                    </span>
                  )}
                </div>
              </div>

              {row.missingScopes && row.missingScopes.length > 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-2 bg-amber-50 dark:bg-amber-950/30 p-2 rounded">
                  Một số quyền chưa được cấp. Kết nối lại để xem và cấp bổ sung.
                </p>
              )}

              <div className="flex items-center gap-3 mt-3 pt-2 border-t border-[#E7E7E2] dark:border-[#333333]">
                {row.status === 'reconnect_required' && (
                  <button
                    type="button"
                    disabled={!!busy}
                    aria-label={`Kết nối lại ${row.workspaceName}`}
                    onClick={() => void reconnect(row)}
                    className="px-3 py-1 rounded-lg text-xs font-semibold bg-[#FF5701] text-white hover:bg-[#E04C00] transition-colors disabled:opacity-50"
                  >
                    Kết nối lại
                  </button>
                )}
                <button
                  type="button"
                  id={`disconnect-btn-${row.id}`}
                  disabled={!!busy}
                  aria-label={`Ngắt kết nối ${row.workspaceName}`}
                  onClick={() => setDisconnectTarget(row)}
                  className="text-xs font-medium text-[#FF5701] underline hover:text-[#E04C00] transition-colors disabled:opacity-50"
                >
                  Ngắt kết nối
                </button>
              </div>
              <SlackAutomationSettings connectionId={row.id} workspaceName={row.workspaceName} active={row.status==='active'}/>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="text-xs text-[#DC2626]">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-xs text-[#059669]">
          {notice}
        </p>
      )}

      <div className="pt-2">
        <button
          type="button"
          disabled={!!busy}
          onClick={() => void start()}
          className="bg-[#FF5701] text-white px-4 py-2.5 rounded-xl text-xs font-semibold shadow-sm hover:bg-[#E04C00] transition-colors disabled:opacity-50"
        >
          {busy === 'connect' ? 'Đang mở Slack…' : 'Kết nối workspace Slack'}
        </button>
      </div>

      {disconnectTarget &&
        createPortal(
          <CockpitDialog
            title={`Ngắt kết nối ${disconnectTarget.workspaceName}`}
            returnFocusId={`disconnect-btn-${disconnectTarget.id}`}
            onClose={() => {
              if (!busy) setDisconnectTarget(null);
            }}
          >
            <div className="p-5 v3-space-y-4">
              <p className="text-sm text-[#111827] dark:text-white">
                Bạn có chắc chắn muốn ngắt kết nối workspace <strong>{disconnectTarget.workspaceName}</strong> ({disconnectTarget.workspaceId}) khỏi tài khoản ATI?
              </p>
              <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                Sau khi ngắt, ATI sẽ không thể tương tác với workspace này cho tới khi bạn kết nối lại.
              </p>
              <div className="flex justify-end gap-3 pt-3 border-t border-[#E7E7E2] dark:border-[#333333]">
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => setDisconnectTarget(null)}
                  className="px-4 py-2 rounded-xl text-xs font-medium bg-white dark:bg-[#1E1E1E] text-[#111827] dark:text-white border border-[#E7E7E2] dark:border-[#333333] hover:bg-neutral-50 dark:hover:bg-[#282828] transition-colors"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => void executeDisconnect(disconnectTarget)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#DC2626] text-white hover:bg-[#B91C1C] transition-colors disabled:opacity-50 shadow-sm"
                >
                  {busy === disconnectTarget.id ? 'Đang ngắt kết nối…' : 'Xác nhận ngắt kết nối'}
                </button>
              </div>
            </div>
          </CockpitDialog>,
          document.body
        )}
    </section>
  );
}
