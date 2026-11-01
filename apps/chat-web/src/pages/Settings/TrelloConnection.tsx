import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { User } from '../../types';
import { apiClient } from '../../services/api-client';
import { trelloSessionOwner, redirectToTrello } from '../../services/trello-connection';
import { CockpitDialog } from '../../components/CockpitDialog';
import { ServiceLogo } from '../../components/ServiceLogo';

const button =
  'px-4 py-2 rounded-xl text-xs font-semibold bg-[#FF5701] text-white hover:bg-[#E04C00] disabled:opacity-50 transition-colors shadow-sm';
const secondary =
  'px-4 py-2 rounded-xl text-xs font-medium bg-white text-[#111827] border border-[#E7E7E2] hover:bg-neutral-50 disabled:opacity-50 transition-colors';

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

  const isAdmin = user?.role === 'admin';

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
    if (isAdmin && (data?.status === 'needs_scope' || editingScope)) {
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
  }, [isAdmin, data?.status, editingScope]);

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
      className="bg-white border border-[#E7E7E2] rounded-xl p-4 sm:p-5 v3-space-y-4 focus-visible:ring-2 focus-visible:ring-[#FF5701] focus-visible:v3-outline-none"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display font-semibold text-base text-[#111827] flex items-center gap-3">
          <ServiceLogo service="trello" className="w-6 h-6" />
          Trello
        </h3>
        {status === 'connected' && (
          <span className="text-xs font-semibold px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md">
            Đã kết nối
          </span>
        )}
      </div>

      <p className="text-xs text-[#6B7280]">
        Chỉ bạn dùng được tài khoản Trello này để thao tác trên các bảng đã được chọn.
      </p>

      {/* Status string */}
      <div className="text-sm text-[#111827] break-words">
        {status === 'connected' ? (
          <span>
            Đã kết nối {data?.username && <>· @{data.username}</>}
          </span>
        ) : status === 'needs_scope' ? (
          <span>
            Đã kết nối · Chưa chọn bảng {data?.username && <>· @{data.username}</>}
          </span>
        ) : status === 'needs_membership' ? (
          <span>
            Đã kết nối · Cần được thêm vào bảng {data?.username && <>· @{data.username}</>}
          </span>
        ) : status === 'reconnect_required' ? (
          <span>
            Cần kết nối lại {data?.username && <>· @{data.username}</>}
          </span>
        ) : status === 'unconfigured' ? (
          <span className="text-[#6B7280]">Trello chưa được cấu hình trên máy chủ.</span>
        ) : (
          <span className="text-[#6B7280]">Chưa kết nối</span>
        )}
      </div>

      {/* Member with needs_membership */}
      {status === 'needs_membership' && data?.boards && data.boards.length > 0 && (
        <div className="v3-space-y-2 border-t border-[#F3F4F6] pt-3">
          <p className="text-xs font-semibold text-[#DC2626]">
            Bạn cần được thêm vào bảng:
          </p>
          <div className="v3-space-y-1.5">
            {data.boards.map((b) => (
              <div
                key={b.boardId}
                className="flex items-center justify-between p-2.5 bg-neutral-50 rounded-lg text-xs"
              >
                <span className="font-medium text-[#111827]">{b.boardName}</span>
                <span className="text-[#DC2626] font-medium">Bạn cần được thêm vào bảng</span>
              </div>
            ))}
          </div>
          {isAdmin && !editingScope && (
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
        <div className="v3-space-y-2 border-t border-[#F3F4F6] pt-3">
          {data.workspaceName && (
            <p className="text-xs text-[#6B7280]">
              Workspace: <strong className="text-[#111827]">{data.workspaceName}</strong>
            </p>
          )}
          <div className="v3-space-y-1.5">
            {data.boards.map((b) => (
              <div
                key={b.boardId}
                className="flex items-center justify-between p-2.5 bg-neutral-50 rounded-lg text-xs"
              >
                <span className="font-medium text-[#111827]">{b.boardName}</span>
                <span
                  className={
                    b.member
                      ? 'text-emerald-700 font-medium'
                      : 'text-[#DC2626] font-medium'
                  }
                >
                  {b.member ? 'Dùng được' : 'Bạn cần được thêm vào bảng'}
                </span>
              </div>
            ))}
          </div>
          {isAdmin && !editingScope && (
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
      <div className="flex flex-wrap items-center gap-3 pt-2">
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

      {/* Admin Scope Selection Area: only when role is admin */}
      {isAdmin && (status === 'needs_scope' || editingScope) && (
        <div
          id="trello-scope"
          data-testid="trello-scope"
          className="mt-4 p-4 border border-[#E7E7E2] rounded-xl bg-[#F8F8F6] v3-space-y-3"
        >
          <h4 className="text-xs font-bold uppercase tracking-wider text-[#6B7280]">
            Chọn bảng Trello cho nhóm
          </h4>

          {/* Workspace selection */}
          <div className="v3-space-y-1">
            <label htmlFor="trello-workspace-select" className="text-xs font-semibold text-[#111827]">
              Workspace
            </label>
            <select
              id="trello-workspace-select"
              className="w-full text-xs p-2 border border-[#E7E7E2] rounded-lg bg-white text-[#111827]"
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
            <label className="text-xs font-semibold text-[#111827]">
              Các bảng được phép dùng (tối đa 10 bảng)
            </label>
            <div className="v3-space-y-1.5 max-h-48 overflow-y-auto">
              {candidateBoards.map((b) => {
                const checked = selectedBoardIds.includes(b.id);
                const disabled = !checked && selectedBoardIds.length >= 10;
                return (
                  <label
                    key={b.id}
                    className={`flex items-center gap-2 p-2 rounded-lg text-xs cursor-pointer ${
                      checked ? 'bg-[#F8F8F6] border border-[#111827]/30' : 'bg-white border border-[#E7E7E2]'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggleBoard(b.id)}
                      className="rounded text-[#111827] focus:ring-[#111827]"
                    />
                    <span className="font-medium text-[#111827]">{b.name}</span>
                  </label>
                );
              })}
              {candidateBoards.length === 0 && (
                <p className="text-xs text-[#6B7280]">Không có bảng nào trong workspace này.</p>
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
        <p role="status" className="text-xs text-[#6B7280]">
          Đang xử lý…
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-[#DC2626]">
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
              <p className="text-sm">
                ATI sẽ xoá token kết nối Trello của bạn. Kế hoạch cũ sẽ không thể thực thi
                bằng kết nối đã ngắt.
              </p>
              <div className="flex justify-end gap-2">
                <button className={secondary} disabled={busy} onClick={() => setConfirm(false)}>
                  Giữ kết nối
                </button>
                <button className={button} disabled={busy} onClick={() => void disconnect()}>
                  Xác nhận ngắt kết nối
                </button>
              </div>
              {error && <p role="alert">{error}</p>}
            </div>
          </CockpitDialog>,
          document.body
        )}
    </>
  );
}
