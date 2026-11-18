import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { User } from '../../types';
import { apiClient } from '../../services/api-client';
import { githubSessionOwner, redirectToGitHub } from '../../services/github-connection';
import {
  getActiveWorkspaceId,
  getActiveWorkspaceSummary,
  subscribeWorkspace,
} from '../../services/workspace-storage';
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

export interface GitHubConnectionProps {
  user: User | null;
  refresh?: () => Promise<void>;
  selected?: string | null;
  standalone?: boolean;
}

interface GitHubStatusData {
  status:
    | 'unconfigured'
    | 'not_connected'
    | 'reconnect_required'
    | 'needs_scope'
    | 'needs_membership'
    | 'connected';
  login?: string;
  repos: Array<{ repoId: string; fullName: string; name: string; accessible: boolean }>;
}

export function GitHubConnection(props: GitHubConnectionProps) {
  const workspaceScopeId = useSyncExternalStore(subscribeWorkspace, getActiveWorkspaceId);
  return <GitHubWorkspaceConnection key={workspaceScopeId} {...props} workspaceScopeId={workspaceScopeId} />;
}

function GitHubWorkspaceConnection({
  user,
  refresh,
  selected,
  standalone = true,
  workspaceScopeId,
}: GitHubConnectionProps & { workspaceScopeId: string }) {
  const [data, setData] = useState<GitHubStatusData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);

  const [candidateRepos, setCandidateRepos] = useState<
    Array<{ repoId: string; fullName: string; name: string; private?: boolean }> | null
  >(null);
  const [candidateError, setCandidateError] = useState('');
  const [repoFilter, setRepoFilter] = useState('');
  const [selectedRepos, setSelectedRepos] = useState<string[]>([]);
  const [editingScope, setEditingScope] = useState(false);

  const [workspace, setWorkspace] = useState(getActiveWorkspaceSummary);

  const mounted = useRef(false);
  const pending = useRef(false);
  const statusRequest = useRef(0);
  const row = useRef<HTMLDivElement>(null);

  const isOrgWorkspace = workspaceScopeId !== 'personal';
  const canManageScope = isOrgWorkspace
    ? workspace.id !== 'personal'
      ? workspace.role === 'admin'
      : user?.role === 'admin'
    : true;
  const ownsWorkspace = () => mounted.current && getActiveWorkspaceId() === workspaceScopeId;

  const fetchStatus = async () => {
    const request = ++statusRequest.current;
    const isCurrent = () => ownsWorkspace() && request === statusRequest.current;
    try {
      const res = await apiClient.getGitHubConnection(workspaceScopeId);
      if (isCurrent()) {
        setError('');
        setData(res);
      }
    } catch (err) {
      if (isCurrent()) {
        setError(
          err instanceof Error && err.message
            ? err.message
            : 'Không kiểm tra được trạng thái kết nối GitHub lúc này. Vui lòng thử lại.',
        );
        setData((prev) => prev ?? { status: 'not_connected', repos: [] });
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
    const updateRole = () => {
      if (ownsWorkspace()) setWorkspace(getActiveWorkspaceSummary());
    };
    updateRole();
    return subscribeWorkspace(updateRole);
  }, [workspaceScopeId]);

  useEffect(() => {
    const focus = () => {
      if (window.location.hash === '#github' || window.location.hash === '#github-scope') {
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

  const scopeOpen = canManageScope && (data?.status === 'needs_scope' || editingScope);
  useEffect(() => {
    if (!scopeOpen) {
      setCandidateRepos(null);
      setCandidateError('');
      return;
    }
    let cancelled = false;
    apiClient.getGitHubCandidateRepos(workspaceScopeId).then(
      ({ repos }) => {
        if (!cancelled && ownsWorkspace()) setCandidateRepos(repos);
      },
      (err) => {
        if (!cancelled && ownsWorkspace()) {
          setCandidateError(
            err instanceof Error && err.message
              ? err.message
              : 'Không tải được danh sách repository từ GitHub.',
          );
        }
      },
    );
    return () => { cancelled = true; };
  }, [scopeOpen, workspaceScopeId]);

  const connect = async () => {
    if (!data || !ownsWorkspace() || pending.current) return;
    const owns = githubSessionOwner();
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await apiClient.startGitHubConnection();
      if (ownsWorkspace() && owns()) redirectToGitHub(result.url);
    } catch {
      if (ownsWorkspace() && owns())
        setError('Không thể cập nhật kết nối GitHub. Hãy kiểm tra mạng và thử lại.');
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!ownsWorkspace() || pending.current) return;
    const owns = githubSessionOwner();
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await apiClient.disconnectGitHub();
      if (ownsWorkspace() && owns()) {
        setConfirm(false);
        await fetchStatus();
        if (ownsWorkspace()) await refresh?.();
      }
    } catch {
      if (ownsWorkspace() && owns())
        setError('Không thể ngắt kết nối GitHub. Hãy kiểm tra mạng và thử lại.');
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const toggleRepo = (fullName: string) => {
    if (selectedRepos.includes(fullName)) {
      setSelectedRepos(selectedRepos.filter((name) => name !== fullName));
    } else {
      if (selectedRepos.length >= 10) return;
      setSelectedRepos([...selectedRepos, fullName]);
    }
  };

  const canSaveScope = scopeOpen && Boolean(candidateRepos?.length) &&
    selectedRepos.length > 0 && selectedRepos.length <= 10 && !busy;

  const saveScope = async () => {
    if (!canSaveScope || !ownsWorkspace() || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await apiClient.saveGitHubScope(selectedRepos, workspaceScopeId);
      if (!ownsWorkspace()) return;
      setEditingScope(false);
      await fetchStatus();
      if (ownsWorkspace()) await refresh?.();
    } catch {
      if (ownsWorkspace()) setError('Không thể lưu phạm vi repository GitHub. Hãy thử lại.');
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const status = data?.status ?? 'not_connected';

  const rowContent = (
    <div
      ref={row}
      id="service-row-github"
      tabIndex={-1}
      className={`${CARD_CONTAINER_CLASS} focus-visible:ring-2 focus-visible:ring-[#FF5701] focus-visible:v3-outline-none`}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-sans font-semibold text-base text-[#1a0e08] dark:text-white flex items-center gap-3">
          <ServiceLogo service="github" className="w-6 h-6" />
          GitHub
        </h3>
        {status === 'connected' ? (
          <span className={connectionBadgeClass('connected')}>
            Đã kết nối
          </span>
        ) : status === 'needs_scope' || status === 'needs_membership' ? (
          <span className={connectionBadgeClass('warning')}>
            Cần chọn repository
          </span>
        ) : status === 'reconnect_required' ? (
          <span className={connectionBadgeClass('error')}>
            Cần kết nối lại
          </span>
        ) : (
          <span className={connectionBadgeClass('neutral')}>
            {data ? 'Chưa kết nối' : 'Đang kiểm tra kết nối…'}
          </span>
        )}
      </div>

      <p className="text-[13px] leading-relaxed text-[#51463E] dark:text-[#D7CEC4]">
        Chỉ bạn dùng được tài khoản GitHub này để thao tác trên các repository đã được chọn.
      </p>

      <div className="text-sm text-[#1a0e08] dark:text-[#EAE3DB] break-words">
        {status === 'connected' ? (
          <span>
            Đã kết nối {data?.login && <>· @{data.login}</>}
          </span>
        ) : status === 'needs_scope' ? (
          <span>
            Đã kết nối · Chưa chọn repository {data?.login && <>· @{data.login}</>}
          </span>
        ) : status === 'needs_membership' ? (
          <span>
            Đã kết nối · Cần được cấp quyền repository {data?.login && <>· @{data.login}</>}
          </span>
        ) : status === 'reconnect_required' ? (
          <span>
            Cần kết nối lại {data?.login && <>· @{data.login}</>}
          </span>
        ) : status === 'unconfigured' ? (
          <span className="text-[#6A5F56] dark:text-[#9CA3AF]">GitHub chưa được cấu hình trên máy chủ.</span>
        ) : null}
      </div>

      {status === 'needs_membership' && data?.repos && data.repos.length > 0 && (
        <div className="v3-space-y-2 border-t border-[#F3F4F6] dark:border-[#3a312a] pt-3">
          <p className="text-xs font-semibold text-[#DC2626] dark:text-red-300">
            Bạn cần được cấp quyền truy cập repository:
          </p>
          <div className="v3-space-y-1.5">
            {data.repos.map((r) => (
              <div
                key={r.fullName}
                className="flex items-center justify-between p-2.5 bg-neutral-50 dark:bg-[#131010] rounded-lg text-xs"
              >
                <span className="font-medium text-[#1a0e08] dark:text-[#F3EEE8]">{r.fullName}</span>
                <span className="text-[#DC2626] dark:text-red-300 font-medium">
                  Bạn cần được cấp quyền truy cập repository
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {status === 'connected' && data?.repos && (
        <div className="v3-space-y-2 border-t border-[#F3F4F6] dark:border-[#3a312a] pt-3">
          <div className="v3-space-y-1.5">
            {data.repos.map((r) => (
              <div
                key={r.fullName}
                className="flex items-center justify-between p-2.5 bg-neutral-50 dark:bg-[#131010] rounded-lg text-xs"
              >
                <span className="font-medium text-[#1a0e08] dark:text-[#F3EEE8]">{r.fullName}</span>
                <span
                  className={
                    r.accessible
                      ? 'text-emerald-700 dark:text-emerald-300 font-medium'
                      : 'text-[#DC2626] dark:text-red-300 font-medium'
                  }
                >
                  {r.accessible ? 'Dùng được' : 'Bạn cần được cấp quyền truy cập repository'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-[#F3F4F6] dark:border-[#3a312a]">
        {status === 'not_connected' || status === 'reconnect_required' || status === 'unconfigured' ? (
          <button
            id="github-connect"
            type="button"
            className={button}
            disabled={!data || busy || status === 'unconfigured'}
            onClick={() => void connect()}
          >
            Kết nối GitHub
          </button>
        ) : (
          <>
            <div>
              {canManageScope && !editingScope && (status === 'connected' || status === 'needs_membership') && (
                <button
                  id="github-edit-scope"
                  type="button"
                  className={secondary}
                  onClick={() => {
                    setSelectedRepos((data?.repos ?? []).filter((r) => r.accessible).map((r) => r.fullName));
                    setEditingScope(true);
                  }}
                >
                  Đổi repository
                </button>
              )}
            </div>
            <button
              id="github-disconnect"
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

      {!canManageScope && status === 'needs_scope' && (
        <p className="mt-3 text-xs text-[#92400E] dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
          Quản trị viên không gian làm việc chưa chọn repository GitHub cho nhóm.
        </p>
      )}

      {scopeOpen && (
        <div
          id="github-scope"
          data-testid="github-scope"
          className="mt-4 p-4 border border-[#E8E0D6] dark:border-[#4a4038] rounded-xl bg-[#F8F4EE] dark:bg-[#2A2420]/50 v3-space-y-3"
        >
          <h4 className="text-xs font-semibold text-[#4a4038] dark:text-[#D1D5DB]">
            {isOrgWorkspace ? 'Chọn repository GitHub cho nhóm' : 'Chọn repository GitHub của bạn'}
          </h4>

          <div className="v3-space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-semibold text-[#1a0e08] dark:text-[#F3EEE8]">
                Các repository được phép dùng (tối đa 10 repository)
              </label>
              <span
                data-testid="github-scope-counter"
                className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-white dark:bg-[#131010] border border-[#E8E0D6] dark:border-[#3a312a] text-[#51463E] dark:text-[#D7CEC4]"
              >
                Đã chọn {selectedRepos.length}/10
              </span>
            </div>
            {candidateRepos && candidateRepos.length >= 5 && (
              <input
                type="search"
                value={repoFilter}
                onChange={(e) => setRepoFilter(e.target.value)}
                placeholder="Tìm nhanh theo tên repository..."
                aria-label="Tìm nhanh repository"
                className="w-full px-3 py-1.5 text-xs bg-white dark:bg-[#131010] border border-[#E8E0D6] dark:border-[#3a312a] rounded-lg text-[#1a0e08] dark:text-[#F3EEE8] placeholder:text-[#9CA3AF] focus:ring-2 focus:ring-[#FF5701] focus:v3-outline-none"
              />
            )}
            <div className="v3-space-y-1.5 max-h-48 overflow-y-auto">
              {candidateRepos
                ?.filter((r) =>
                  !repoFilter.trim() ||
                  r.fullName.toLowerCase().includes(repoFilter.trim().toLowerCase())
                )
                .map((r) => {
                  const checked = selectedRepos.includes(r.fullName);
                  const disabled = !checked && selectedRepos.length >= 10;
                  return (
                    <div
                      key={r.fullName}
                      className={`flex items-center justify-between gap-2 p-2 rounded-lg text-xs ${
                        checked
                          ? 'bg-[#F8F4EE] dark:bg-[#27211C] border border-[#1a0e08]/30 dark:border-[#FF5701]/60'
                          : 'bg-white dark:bg-[#131010] border border-[#E8E0D6] dark:border-[#3a312a]'
                      }`}
                    >
                      <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggleRepo(r.fullName)}
                          className="rounded text-[#1a0e08] dark:text-[#FF5701] focus:ring-[#1a0e08] dark:focus:ring-[#FF5701]"
                        />
                        <span className="font-medium text-[#1a0e08] dark:text-[#F3EEE8] truncate">{r.fullName}</span>
                      </label>
                      {typeof r.private === 'boolean' && (
                        <span
                          className={`text-xs font-semibold px-1.5 py-0.5 rounded border shrink-0 ${
                            r.private
                              ? 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
                              : 'bg-neutral-100 text-neutral-600 border-neutral-200 dark:bg-[#221C18] dark:text-[#D7CEC4] dark:border-[#3a312a]'
                          }`}
                        >
                          {r.private ? 'Private' : 'Public'}
                        </span>
                      )}
                    </div>
                  );
                })}
              {!candidateRepos && !candidateError && (
                <p className="text-xs text-[#6A5F56] dark:text-[#9CA3AF]">Đang tải danh sách repository từ GitHub…</p>
              )}
              {candidateError && (
                <p role="alert" className="text-xs text-[#DC2626] dark:text-red-400">{candidateError}</p>
              )}
              {candidateRepos?.length === 0 && (
                <p className="text-xs text-[#6A5F56] dark:text-[#9CA3AF]">Không có repository nào trong tài khoản này.</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              id="github-save-scope"
              type="button"
              className={button}
              disabled={!canSaveScope}
              onClick={() => void saveScope()}
            >
              Lưu repository được dùng
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
        <p role="status" className="text-xs text-[#6A5F56]">
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
        <section aria-labelledby="heading-github-service" className="mb-8">
          {rowContent}
        </section>
      ) : (
        rowContent
      )}
      {confirm &&
        createPortal(
          <CockpitDialog
            title="Ngắt kết nối GitHub?"
            returnFocusId="github-disconnect"
            onClose={() => {
              if (!busy) setConfirm(false);
            }}
          >
            <div className="p-5 v3-space-y-4">
              <p className="text-sm">
                Planora sẽ xoá token kết nối GitHub của bạn. Kế hoạch cũ sẽ không thể thực thi
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
