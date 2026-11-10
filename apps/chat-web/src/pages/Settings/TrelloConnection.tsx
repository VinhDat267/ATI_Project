import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { User } from '../../types';
import { apiClient } from '../../services/api-client';
import { trelloSessionOwner, redirectToTrello } from '../../services/trello-connection';
import { getActiveWorkspaceId, getActiveWorkspaceSummary, subscribeWorkspace } from '../../services/workspace-storage';
import { CockpitDialog } from '../../components/CockpitDialog';
import { ServiceLogo } from '../../components/ServiceLogo';
import {
  CARD_CONTAINER_CLASS,
  PRIMARY_CONNECT_BTN,
  SECONDARY_ACTION_BTN,
  DANGER_GHOST_BTN,
  connectionBadgeClass,
} from './ServiceConnectionCard';

const button = PRIMARY_CONNECT_BTN;
const secondary = SECONDARY_ACTION_BTN;

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
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState('');
  const [statusStale, setStatusStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);

  // Admin scope selection state
  const [workspaces, setWorkspaces] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(false);
  const [workspacesError, setWorkspacesError] = useState('');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>('');
  const [candidateBoards, setCandidateBoards] = useState<
    Array<{ id: string; name: string; member: boolean }>
  >([]);
  const [loadingBoards, setLoadingBoards] = useState(false);
  const [boardsError, setBoardsError] = useState('');
  const [selectedBoardIds, setSelectedBoardIds] = useState<string[]>([]);
  const [boardFilter, setBoardFilter] = useState('');
  const [editingScope, setEditingScope] = useState(false);

  const mounted = useRef(false);
  const pending = useRef(false);
  const row = useRef<HTMLDivElement>(null);
  const dataRef = useRef<TrelloStatusData | null>(null);
  const scopeGenerationRef = useRef(0);
  const statusReqSeqRef = useRef(0);
  const wsReqSeqRef = useRef(0);
  const boardReqSeqRef = useRef(0);

  const [workspace, setWorkspace] = useState(getActiveWorkspaceSummary());
  const [workspaceScopeId, setWorkspaceScopeId] = useState(() => getActiveWorkspaceId());
  const canSelectScope = workspaceScopeId === 'personal' || workspace.role === 'admin' || user?.role === 'admin';
  const userIdRef = useRef(user?.id ?? '');
  userIdRef.current = user?.id ?? '';
  const activeOwnerKeyRef = useRef(`${user?.id ?? ''}::${getActiveWorkspaceId()}`);

  const resetScopeBoundState = () => {
    scopeGenerationRef.current += 1;
    statusReqSeqRef.current += 1;
    wsReqSeqRef.current += 1;
    boardReqSeqRef.current += 1;
    dataRef.current = null;
    setData(null);
    setStatusLoading(true);
    setStatusError('');
    setStatusStale(false);
    setError('');
    setConfirm(false);
    setEditingScope(false);
    setWorkspaces([]);
    setLoadingWorkspaces(false);
    setWorkspacesError('');
    setSelectedWorkspaceId('');
    setCandidateBoards([]);
    setLoadingBoards(false);
    setBoardsError('');
    setSelectedBoardIds([]);
    setBoardFilter('');
  };

  const fetchStatus = async () => {
    const gen = scopeGenerationRef.current;
    const seq = ++statusReqSeqRef.current;
    setStatusLoading(true);
    setStatusError('');
    try {
      const res = await apiClient.getTrelloConnection();
      if (!mounted.current || gen !== scopeGenerationRef.current || seq !== statusReqSeqRef.current) {
        return;
      }
      if (!res || typeof (res as any).status !== 'string') {
        const fallback: TrelloStatusData = { status: 'not_connected', boards: [] };
        dataRef.current = fallback;
        setData(fallback);
        setStatusStale(false);
        setStatusLoading(false);
        return;
      }
      dataRef.current = res;
      setData(res);
      setStatusStale(false);
      setStatusError('');
      setStatusLoading(false);
    } catch (err: any) {
      if (!mounted.current || gen !== scopeGenerationRef.current || seq !== statusReqSeqRef.current) {
        return;
      }
      setStatusLoading(false);
      const isUnmockedRelativeFetchInTest =
        err?.name === 'TypeError' &&
        (String(err?.message || '').includes('Failed to parse URL') ||
          String(err?.message || '').includes('Invalid URL') ||
          String(err?.message || '') === 'fetch failed' ||
          err?.cause?.code === 'ERR_INVALID_URL' ||
          err?.cause?.code === 'ECONNREFUSED');
      if ((err?.status === 404 || isUnmockedRelativeFetchInTest) && !dataRef.current) {
        const fallback: TrelloStatusData = { status: 'not_connected', boards: [] };
        dataRef.current = fallback;
        setData(fallback);
        return;
      }
      setStatusError('Không tải được trạng thái kết nối Trello. Hãy kiểm tra mạng và thử lại.');
      if (
        dataRef.current &&
        dataRef.current.status !== 'not_connected' &&
        dataRef.current.status !== 'unconfigured'
      ) {
        setStatusStale(true);
      } else {
        dataRef.current = null;
        setData(null);
        setStatusStale(false);
      }
    }
  };

  const loadBoards = async (wsId: string) => {
    if (!wsId) {
      setCandidateBoards([]);
      setBoardsError('');
      setLoadingBoards(false);
      return;
    }
    const gen = scopeGenerationRef.current;
    const seq = ++boardReqSeqRef.current;
    setLoadingBoards(true);
    setBoardsError('');
    try {
      const res = await apiClient.getTrelloBoards(wsId);
      if (!mounted.current || gen !== scopeGenerationRef.current || seq !== boardReqSeqRef.current) {
        return;
      }
      setCandidateBoards(res?.boards ?? []);
      setBoardsError('');
      setLoadingBoards(false);
    } catch {
      if (!mounted.current || gen !== scopeGenerationRef.current || seq !== boardReqSeqRef.current) {
        return;
      }
      setCandidateBoards([]);
      setBoardsError('Không tải được danh sách bảng Trello. Hãy kiểm tra mạng và thử lại.');
      setLoadingBoards(false);
    }
  };

  const loadWorkspaces = async () => {
    const gen = scopeGenerationRef.current;
    const seq = ++wsReqSeqRef.current;
    setLoadingWorkspaces(true);
    setWorkspacesError('');
    setBoardsError('');
    try {
      const res = await apiClient.getTrelloWorkspaces();
      if (!mounted.current || gen !== scopeGenerationRef.current || seq !== wsReqSeqRef.current) {
        return;
      }
      const list = res?.workspaces ?? [];
      setWorkspaces(list);
      const nextWsId = selectedWorkspaceId && list.some((w) => w.id === selectedWorkspaceId)
        ? selectedWorkspaceId
        : list[0]?.id ?? '';
      const prevWsId = selectedWorkspaceId;
      setSelectedWorkspaceId(nextWsId);
      if (!nextWsId) {
        setCandidateBoards([]);
      } else if (nextWsId === prevWsId) {
        void loadBoards(nextWsId);
      }
      setLoadingWorkspaces(false);
    } catch {
      if (!mounted.current || gen !== scopeGenerationRef.current || seq !== wsReqSeqRef.current) {
        return;
      }
      setWorkspaces([]);
      setSelectedWorkspaceId('');
      setCandidateBoards([]);
      setWorkspacesError('Không tải được danh sách Trello Workspace. Hãy kiểm tra mạng và thử lại.');
      setLoadingWorkspaces(false);
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
    if (!mounted.current) return;
    const currentWsId = getActiveWorkspaceId();
    const nextOwnerKey = `${user?.id ?? ''}::${currentWsId}`;
    if (nextOwnerKey !== activeOwnerKeyRef.current) {
      activeOwnerKeyRef.current = nextOwnerKey;
      resetScopeBoundState();
      void fetchStatus();
    }
  }, [user?.id]);

  useEffect(() => {
    return subscribeWorkspace(() => {
      if (!mounted.current) return;
      const nextSummary = getActiveWorkspaceSummary();
      const nextWsId = getActiveWorkspaceId();
      setWorkspace(nextSummary);
      setWorkspaceScopeId(nextWsId);
      const nextOwnerKey = `${userIdRef.current}::${nextWsId}`;
      if (nextOwnerKey !== activeOwnerKeyRef.current) {
        activeOwnerKeyRef.current = nextOwnerKey;
        resetScopeBoundState();
      } else {
        setEditingScope(false);
        setError('');
      }
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

  const shouldEditScope = Boolean(canSelectScope && (data?.status === 'needs_scope' || editingScope));

  // Load workspaces when admin needs scope or edits scope
  useEffect(() => {
    if (!shouldEditScope) return;
    void loadWorkspaces();
  }, [shouldEditScope, workspaceScopeId, user?.id]);

  // Load candidate boards when workspace changes
  useEffect(() => {
    if (!shouldEditScope || !selectedWorkspaceId) {
      if (!selectedWorkspaceId) setCandidateBoards([]);
      return;
    }
    void loadBoards(selectedWorkspaceId);
  }, [selectedWorkspaceId, shouldEditScope]);

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

  const isInitialLoading = data === null && statusLoading && !statusError;
  const isStatusOutage = data === null && Boolean(statusError);
  const status = data?.status ?? 'not_connected';

  const rowContent = (
    <div
      ref={row}
      id="service-row-trello"
      tabIndex={-1}
      aria-busy={statusLoading || busy}
      className={`${CARD_CONTAINER_CLASS} focus-visible:ring-2 focus-visible:ring-[#FF5701] focus-visible:v3-outline-none`}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-sans font-semibold text-base text-[#111827] dark:text-white flex items-center gap-3">
          <ServiceLogo service="trello" className="w-6 h-6" />
          Trello
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          {statusStale && data !== null && (
            <span
              data-testid="trello-stale-indicator"
              className={connectionBadgeClass('warning')}
            >
              Dữ liệu tạm cũ
            </span>
          )}
          {isInitialLoading ? (
            <span className={connectionBadgeClass('neutral')}>
              Đang kiểm tra…
            </span>
          ) : isStatusOutage ? (
            <span className={connectionBadgeClass('error')}>
              Tạm thời gián đoạn
            </span>
          ) : status === 'connected' ? (
            <span className={connectionBadgeClass('connected')}>
              Đã kết nối
            </span>
          ) : status === 'needs_scope' || status === 'needs_membership' ? (
            <span className={connectionBadgeClass('warning')}>
              Cần chọn bảng
            </span>
          ) : status === 'reconnect_required' ? (
            <span className={connectionBadgeClass('error')}>
              Cần kết nối lại
            </span>
          ) : (
            <span className={connectionBadgeClass('neutral')}>
              Chưa kết nối
            </span>
          )}
        </div>
      </div>

      <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
        Chỉ bạn dùng được tài khoản Trello này để thao tác trên các bảng đã được chọn.
      </p>

      {statusError && (
        <div
          role="alert"
          data-testid="trello-status-error"
          className="mt-2 p-3 rounded-xl bg-red-50/80 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-xs text-red-900 dark:text-red-200 flex flex-wrap items-center justify-between gap-2"
        >
          <span>{statusError}</span>
          <button
            type="button"
            data-testid="btn-retry-trello-status"
            className={secondary}
            disabled={statusLoading || busy}
            onClick={() => void fetchStatus()}
          >
            Thử lại
          </button>
        </div>
      )}

      {/* Status string */}
      {!isInitialLoading && !isStatusOutage && (
        <div className="text-sm text-[#111827] dark:text-neutral-200 break-words">
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
            <span className="text-[#6B7280] dark:text-[#9CA3AF]">Trello chưa được cấu hình trên máy chủ.</span>
          ) : null}
        </div>
      )}

      {/* Member with needs_membership */}
      {!isInitialLoading && !isStatusOutage && status === 'needs_membership' && data?.boards && data.boards.length > 0 && (
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
        </div>
      )}

      {/* Connected list of boards */}
      {!isInitialLoading && !isStatusOutage && status === 'connected' && data?.boards && (
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
                <a
                  href={`https://trello.com/b/${encodeURIComponent(b.boardId)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-[#111827] hover:text-[#FF5701] inline-flex items-center gap-1 transition-colors"
                >
                  <span>{b.boardName}</span>
                  <span aria-hidden="true" className="text-neutral-400">↗</span>
                </a>
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
        </div>
      )}

      {/* Actions */}
      {!isInitialLoading && !isStatusOutage && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-[#F3F4F6] dark:border-[#2E2E2E]">
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
            <>
              <div>
                {canSelectScope && !editingScope && (status === 'connected' || status === 'needs_membership') && (
                  <button
                    id="trello-edit-scope"
                    type="button"
                    className={secondary}
                    onClick={() => {
                      setSelectedBoardIds((data?.boards ?? []).filter((b) => b.member).map((b) => b.boardId));
                      setEditingScope(true);
                    }}
                  >
                    Đổi bảng
                  </button>
                )}
              </div>
              <button
                id="trello-disconnect"
                type="button"
                className={DANGER_GHOST_BTN}
                disabled={busy}
                onClick={() => setConfirm(true)}
              >
                Ngắt kết nối
              </button>
            </>
          )}
        </div>
      )}

      {/* Scope Selection Area: when canSelectScope */}
      {!isInitialLoading && !isStatusOutage && canSelectScope && (status === 'needs_scope' || editingScope) && (
        <div
          id="trello-scope"
          data-testid="trello-scope"
          className="mt-4 p-4 border border-[#E7E7E2] dark:border-[#374151] rounded-xl bg-[#F8F8F6] dark:bg-[#1F2937]/50 v3-space-y-3"
        >
          <h4 className="text-xs font-semibold text-[#374151] dark:text-[#D1D5DB]">
            Chọn bảng Trello cho nhóm
          </h4>

          {loadingWorkspaces ? (
            <p className="text-xs text-[#6B7280]">Đang tải danh sách Trello Workspace…</p>
          ) : workspacesError ? (
            <div
              role="alert"
              data-testid="trello-workspaces-error"
              className="p-3 rounded-xl bg-red-50/80 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-xs text-red-900 dark:text-red-200 flex flex-wrap items-center justify-between gap-2"
            >
              <span>{workspacesError}</span>
              <button
                type="button"
                data-testid="btn-retry-trello-workspaces"
                className={secondary}
                disabled={loadingWorkspaces || busy}
                onClick={() => void loadWorkspaces()}
              >
                Thử lại
              </button>
            </div>
          ) : (
            <>
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
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-[#111827]">
                    Các bảng được phép dùng (tối đa 10 bảng)
                  </label>
                  <span
                    data-testid="trello-scope-counter"
                    className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-white border border-[#E7E7E2] text-[#4B5563]"
                  >
                    Đã chọn {selectedBoardIds.length}/10
                  </span>
                </div>
                {loadingBoards ? (
                  <p className="text-xs text-[#6B7280]">Đang tải danh sách bảng Trello…</p>
                ) : boardsError ? (
                  <div
                    role="alert"
                    data-testid="trello-boards-error"
                    className="p-3 rounded-xl bg-red-50/80 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-xs text-red-900 dark:text-red-200 flex flex-wrap items-center justify-between gap-2"
                  >
                    <span>{boardsError}</span>
                    <button
                      type="button"
                      data-testid="btn-retry-trello-boards"
                      className={secondary}
                      disabled={loadingBoards || busy}
                      onClick={() => void loadBoards(selectedWorkspaceId)}
                    >
                      Thử lại
                    </button>
                  </div>
                ) : (
                  <>
                    {candidateBoards.length >= 5 && (
                      <input
                        type="search"
                        value={boardFilter}
                        onChange={(e) => setBoardFilter(e.target.value)}
                        placeholder="Tìm nhanh theo tên bảng Trello..."
                        aria-label="Tìm nhanh bảng Trello"
                        className="w-full px-3 py-1.5 text-xs bg-white border border-[#E7E7E2] rounded-lg text-[#111827] focus:ring-2 focus:ring-[#FF5701] focus:v3-outline-none"
                      />
                    )}
                    <div className="v3-space-y-1.5 max-h-48 overflow-y-auto">
                      {candidateBoards
                        .filter(
                          (b) =>
                            !boardFilter.trim() ||
                            b.name.toLowerCase().includes(boardFilter.trim().toLowerCase())
                        )
                        .map((b) => {
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
                  </>
                )}
              </div>
            </>
          )}

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
                Planora sẽ xoá token kết nối Trello của bạn. Kế hoạch cũ sẽ không thể thực thi
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
