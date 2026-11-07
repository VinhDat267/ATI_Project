import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { User } from '../../types';
import { apiClient } from '../../services/api-client';
import { trelloSessionOwner, redirectToTrello } from '../../services/trello-connection';
import { getActiveWorkspaceSummary, subscribeWorkspace } from '../../services/workspace-storage';
import { CockpitDialog } from '../../components/CockpitDialog';
import { ServiceLogo } from '../../components/ServiceLogo';

const button =
  'px-4 py-2.5 rounded-xl text-xs font-semibold bg-[var(--planora-primary)] text-[var(--planora-on-primary)] hover:bg-[var(--planora-primary-hover)] disabled:opacity-50 transition-all shadow-xs focus-visible:outline-2 focus-visible:outline-[var(--planora-primary)]';
const secondary =
  'px-4 py-2.5 rounded-xl text-xs font-medium bg-[var(--planora-paper)] text-[var(--planora-text)] border border-[var(--planora-border-strong)] hover:bg-[var(--planora-surface-inset)] disabled:opacity-50 transition-colors';

export interface TrelloConnectionProps {
  user: User | null;
  refresh?: () => Promise<void>;
  selected?: string | null;
  standalone?: boolean;
}

interface TrelloStatusData {
  status:
    | 'unconfigured'
    | 'not_connected'
    | 'reconnect_required'
    | 'needs_scope'
    | 'needs_membership'
    | 'connected';
  username?: string;
  workspaceName?: string;
  boards: Array<{ boardId: string; boardName: string; member: boolean }>;
}

export function TrelloConnection({
  user,
  refresh,
  selected,
  standalone = true,
}: TrelloConnectionProps) {
  const [data, setData] = useState<TrelloStatusData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);

  // Admin scope selection state
  const [workspaces, setWorkspaces] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>('');
  const [candidateBoards, setCandidateBoards] = useState<
    Array<{ id: string; name: string; member: boolean }>
  >([]);
  const [selectedBoardIds, setSelectedBoardIds] = useState<string[]>([]);
  const [editingScope, setEditingScope] = useState(false);

  const mounted = useRef(false);
  const pending = useRef(false);
  const row = useRef<HTMLDivElement>(null);

  const [workspace, setWorkspace] = useState(getActiveWorkspaceSummary());
  const canSelectScope = workspace.id === 'personal' || workspace.role === 'admin' || user?.role === 'admin';

  const fetchStatus = async () => {
    try {
      const res = await apiClient.getTrelloConnection();
      if (mounted.current) {
        setData(res);
      }
    } catch {
      if (mounted.current) {
        setData({ status: 'not_connected', boards: [] });
      }
    }
  };

  useEffect(() => {
    mounted.current = true;
    void fetchStatus();
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    return subscribeWorkspace(() => {
      setWorkspace(getActiveWorkspaceSummary());
      setEditingScope(false);
      setError('');
      void fetchStatus();
    });
  }, []);

  useEffect(() => {
    const focus = () => {
      if (window.location.hash === '#trello') {
        row.current?.scrollIntoView?.({ block: 'center' });
        row.current?.focus();
      }
    };
    focus();
    window.addEventListener('hashchange', focus);
    window.addEventListener('popstate', focus);
    return () => {
      window.removeEventListener('hashchange', focus);
      window.removeEventListener('popstate', focus);
    };
  }, [selected]);

  // Load workspaces when admin needs scope or edits scope
  useEffect(() => {
    if (canSelectScope && (data?.status === 'needs_scope' || editingScope)) {
      apiClient
        .getTrelloWorkspaces()
        .then((res) => {
          if (mounted.current && res?.workspaces) {
            setWorkspaces(res.workspaces);
            if (res.workspaces.length > 0 && !selectedWorkspaceId) {
              setSelectedWorkspaceId(res.workspaces[0].id);
            }
          }
        })
        .catch(() => {});
    }
  }, [canSelectScope, data?.status, editingScope]);

  // Load candidate boards when workspace changes
  useEffect(() => {
    if (selectedWorkspaceId && (data?.status === 'needs_scope' || editingScope)) {
      apiClient
        .getTrelloBoards(selectedWorkspaceId)
        .then((res) => {
          if (mounted.current && res?.boards) {
            setCandidateBoards(res.boards);
          }
        })
        .catch(() => {
          if (mounted.current) setCandidateBoards([]);
        });
    }
  }, [selectedWorkspaceId, data?.status, editingScope]);

  const connect = async () => {
    if (pending.current) return;
    const owns = trelloSessionOwner();
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await apiClient.startTrelloConnection();
      if (mounted.current && owns()) redirectToTrello(result.url);
    } catch {
      if (mounted.current && owns())
        setError('Không thể cập nhật kết nối Trello. Hãy kiểm tra mạng và thử lại.');
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const disconnect = async () => {
    if (pending.current) return;
    const owns = trelloSessionOwner();
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await apiClient.disconnectTrello();
      if (mounted.current && owns()) {
        setConfirm(false);
        await fetchStatus();
        await refresh?.();
      }
    } catch {
      if (mounted.current && owns())
        setError('Không thể ngắt kết nối Trello. Hãy kiểm tra mạng và thử lại.');
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const toggleBoard = (boardId: string) => {
    if (selectedBoardIds.includes(boardId)) {
      setSelectedBoardIds(selectedBoardIds.filter((id) => id !== boardId));
    } else {
      if (selectedBoardIds.length >= 10) return;
      setSelectedBoardIds([...selectedBoardIds, boardId]);
    }
  };

  const saveScope = async () => {
    if (!selectedWorkspaceId || selectedBoardIds.length === 0 || selectedBoardIds.length > 10) return;
    setBusy(true);
    setError('');
    try {
      await apiClient.saveTrelloScope(selectedWorkspaceId, selectedBoardIds);
      setEditingScope(false);
      await fetchStatus();
      await refresh?.();
    } catch {
      setError('Không thể lưu phạm vi bảng Trello. Hãy thử lại.');
    } finally {
      setBusy(false);
    }
  };

  const status = data?.status ?? 'not_connected';

  const rowContent = (
    <div
      ref={row}
      id="service-row-trello"
      tabIndex={-1}
      className="bg-[var(--planora-paper)] border border-[var(--planora-divider)] rounded-xl p-4 sm:p-5 v3-space-y-3.5 shadow-xs focus-visible:ring-2 focus-visible:ring-[var(--planora-primary)] focus-visible:v3-outline-none"
    >
      <div className="flex items-start sm:items-center justify-between gap-3 flex-wrap">
        <h3 className="font-display font-semibold text-base text-[var(--planora-text)] flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[var(--planora-surface-inset)] border border-[var(--planora-divider)] flex items-center justify-center flex-shrink-0">
            <ServiceLogo service="trello" className="w-5 h-5" />
          </div>
          <span>Trello</span>
        </h3>
        {status === 'connected' && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" aria-hidden="true" />
            <span>Đã kết nối</span>
          </span>
        )}
      </div>

      <p className="text-xs text-[var(--planora-muted)] leading-relaxed">
        Chỉ bạn dùng được tài khoản Trello này để thao tác trên các bảng đã được chọn.
      </p>

      {/* Status string */}
      <div className="text-sm font-medium text-[var(--planora-text)] break-words">
        {status === 'connected' ? (
          <span>
            Đã kết nối {data?.username && <span className="text-[var(--planora-muted)] font-normal"> · @{data.username}</span>}
          </span>
        ) : status === 'needs_scope' ? (
          <span>
            Đã kết nối · Chưa chọn bảng {data?.username && <span className="text-[var(--planora-muted)] font-normal"> · @{data.username}</span>}
          </span>
        ) : status === 'needs_membership' ? (
          <span>
            Đã kết nối · Cần được thêm vào bảng {data?.username && <span className="text-[var(--planora-muted)] font-normal"> · @{data.username}</span>}
          </span>
        ) : status === 'reconnect_required' ? (
          <span>
            Cần kết nối lại {data?.username && <span className="text-[var(--planora-muted)] font-normal"> · @{data.username}</span>}
          </span>
        ) : status === 'unconfigured' ? (
          <span className="text-[var(--planora-muted)] font-normal">Trello chưa được cấu hình trên máy chủ.</span>
        ) : (
          <span className="text-[var(--planora-muted)] font-normal">Chưa kết nối</span>
        )}
      </div>

      {/* Member with needs_membership */}
      {status === 'needs_membership' && data?.boards && data.boards.length > 0 && (
        <div className="v3-space-y-2 border-t border-[var(--planora-divider)] pt-3">
          <p className="text-xs font-semibold text-[var(--planora-error-text,#DC2626)]">
            Bạn cần được thêm vào bảng:
          </p>
          <div className="v3-space-y-1.5">
            {data.boards.map((b) => (
              <div
                key={b.boardId}
                className="flex items-center justify-between p-2.5 bg-[var(--planora-surface-inset)] border border-[var(--planora-divider)] rounded-lg text-xs"
              >
                <span className="font-medium text-[var(--planora-text)]">{b.boardName}</span>
                <span className="text-[var(--planora-error-text,#DC2626)] font-medium">Bạn cần được thêm vào bảng</span>
              </div>
            ))}
          </div>
          {canSelectScope && !editingScope && (
            <button
              id="trello-edit-scope"
              type="button"
              className={secondary}
              onClick={() => {
                setSelectedBoardIds((data.boards ?? []).filter((b) => b.member).map((b) => b.boardId));
                setEditingScope(true);
              }}
            >
              Đổi bảng
            </button>
          )}
        </div>
      )}

      {/* Connected list of boards */}
      {status === 'connected' && data?.boards && (
        <div className="v3-space-y-2 border-t border-[var(--planora-divider)] pt-3">
          {data.workspaceName && (
            <p className="text-xs text-[var(--planora-muted)]">
              Workspace: <strong className="text-[var(--planora-text)]">{data.workspaceName}</strong>
            </p>
          )}
          <div className="v3-space-y-1.5">
            {data.boards.map((b) => (
              <div
                key={b.boardId}
                className="flex items-center justify-between p-2.5 bg-[var(--planora-surface-inset)] border border-[var(--planora-divider)] rounded-lg text-xs"
              >
                <span className="font-medium text-[var(--planora-text)]">{b.boardName}</span>
                <span
                  className={
                    b.member
                      ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                      : 'text-[var(--planora-error-text,#DC2626)] font-medium'
                  }
                >
                  {b.member ? 'Dùng được' : 'Bạn cần được thêm vào bảng'}
                </span>
              </div>
            ))}
          </div>
          {canSelectScope && !editingScope && (
            <button
              id="trello-edit-scope"
              type="button"
              className={secondary}
              onClick={() => {
                setSelectedBoardIds((data.boards ?? []).filter((b) => b.member).map((b) => b.boardId));
                setEditingScope(true);
              }}
            >
              Đổi bảng
            </button>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3 pt-1">
        {status === 'not_connected' || status === 'reconnect_required' || status === 'unconfigured' ? (
          <button
            id="trello-connect"
            type="button"
            className={button}
            disabled={busy || status === 'unconfigured'}
            onClick={() => void connect()}
          >
            Kết nối Trello
          </button>
        ) : (
          <button
            id="trello-disconnect"
            type="button"
            className={secondary}
            disabled={busy}
            onClick={() => setConfirm(true)}
          >
            Ngắt kết nối
          </button>
        )}
      </div>

      {/* Scope Selection Area: when canSelectScope */}
      {canSelectScope && (status === 'needs_scope' || editingScope) && (
        <div
          id="trello-scope"
          data-testid="trello-scope"
          className="mt-4 p-4 border border-[var(--planora-divider)] rounded-xl bg-[var(--planora-surface-inset)] v3-space-y-3.5"
        >
          <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--planora-muted)]">
            Chọn bảng Trello cho nhóm
          </h4>

          {/* Workspace selection */}
          <div className="v3-space-y-1">
            <label htmlFor="trello-workspace-select" className="text-xs font-semibold text-[var(--planora-text)]">
              Workspace
            </label>
            <select
              id="trello-workspace-select"
              className="w-full text-xs p-2.5 border border-[var(--planora-border-strong)] rounded-lg bg-[var(--planora-paper)] text-[var(--planora-text)] focus:ring-2 focus:ring-[var(--planora-primary)] focus:outline-none"
              value={selectedWorkspaceId}
              onChange={(e) => {
                setSelectedWorkspaceId(e.target.value);
                setSelectedBoardIds([]);
              }}
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>

          {/* Candidate boards list (checkboxes) */}
          <div className="v3-space-y-2">
            <label className="text-xs font-semibold text-[var(--planora-text)]">
              Các bảng được phép dùng (tối đa 10 bảng)
            </label>
            <div className="v3-space-y-1.5 max-h-48 overflow-y-auto">
              {candidateBoards.map((b) => {
                const checked = selectedBoardIds.includes(b.id);
                const disabled = !checked && selectedBoardIds.length >= 10;
                return (
                  <label
                    key={b.id}
                    className={`flex items-center gap-2.5 p-2 rounded-lg text-xs cursor-pointer transition-colors ${
                      checked
                        ? 'bg-[var(--planora-paper)] border border-[var(--planora-primary)]'
                        : 'bg-[var(--planora-paper)] border border-[var(--planora-divider)] hover:border-[var(--planora-border-strong)]'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggleBoard(b.id)}
                      className="w-4 h-4 rounded border-[var(--planora-border-strong)] text-[var(--planora-primary)] focus:ring-[var(--planora-primary)]"
                    />
                    <span className="font-medium text-[var(--planora-text)]">{b.name}</span>
                  </label>
                );
              })}
              {candidateBoards.length === 0 && (
                <p className="text-xs text-[var(--planora-muted)]">Không có bảng nào trong workspace này.</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              id="trello-save-scope"
              type="button"
              className={button}
              disabled={selectedBoardIds.length === 0 || selectedBoardIds.length > 10 || busy}
              onClick={() => void saveScope()}
            >
              Lưu bảng được dùng
            </button>
            {editingScope && (
              <button
                type="button"
                className={secondary}
                onClick={() => setEditingScope(false)}
              >
                Hủy
              </button>
            )}
          </div>
        </div>
      )}

      {busy && (
        <p role="status" className="text-xs text-[var(--planora-muted)] flex items-center gap-2">
          <svg className="w-3.5 h-3.5 animate-spin text-[var(--planora-primary)]" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span>Đang xử lý…</span>
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-[var(--planora-error-text,#DC2626)] font-medium">
          {error}
        </p>
      )}
    </div>
  );

  return (
    <>
      {standalone ? (
        <section aria-labelledby="heading-trello-service" className="mb-8">
          {rowContent}
        </section>
      ) : (
        rowContent
      )}
      {confirm &&
        createPortal(
          <CockpitDialog
            title="Ngắt kết nối Trello?"
            returnFocusId="trello-disconnect"
            onClose={() => {
              if (!busy) setConfirm(false);
            }}
          >
            <div className="p-5 v3-space-y-4">
              <p className="text-sm text-[var(--planora-text)]">
                Planora sẽ xoá token kết nối Trello của bạn. Kế hoạch cũ sẽ không thể thực thi
                bằng kết nối đã ngắt.
              </p>
              <div className="flex items-center justify-end gap-3 pt-2">
                <button className={secondary} disabled={busy} onClick={() => setConfirm(false)}>
                  Giữ kết nối
                </button>
                <button className={button} disabled={busy} onClick={() => void disconnect()}>
                  Xác nhận ngắt kết nối
                </button>
              </div>
              {error && <p role="alert" className="text-xs text-[var(--planora-error-text,#DC2626)]">{error}</p>}
            </div>
          </CockpitDialog>,
          document.body
        )}
    </>
  );
}

export default TrelloConnection;
