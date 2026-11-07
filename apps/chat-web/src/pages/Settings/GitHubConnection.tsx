import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { User } from '../../types';
import { apiClient } from '../../services/api-client';
import { githubSessionOwner, redirectToGitHub } from '../../services/github-connection';
import { CockpitDialog } from '../../components/CockpitDialog';
import { ServiceLogo } from '../../components/ServiceLogo';

const button =
  'px-4 py-2.5 rounded-xl text-xs font-semibold bg-[var(--planora-primary)] text-[var(--planora-on-primary)] hover:bg-[var(--planora-primary-hover)] disabled:opacity-50 transition-all shadow-xs focus-visible:outline-2 focus-visible:outline-[var(--planora-primary)]';
const secondary =
  'px-4 py-2.5 rounded-xl text-xs font-medium bg-[var(--planora-paper)] text-[var(--planora-text)] border border-[var(--planora-border-strong)] hover:bg-[var(--planora-surface-inset)] disabled:opacity-50 transition-colors';

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

export function GitHubConnection({
  user,
  refresh,
  selected,
  standalone = true,
}: GitHubConnectionProps) {
  const [data, setData] = useState<GitHubStatusData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);

  const [candidateRepos, setCandidateRepos] = useState<
    Array<{ repoId: string; fullName: string; name: string; private?: boolean }>
  >([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [repoFilter, setRepoFilter] = useState('');
  const [selectedRepos, setSelectedRepos] = useState<string[]>([]);
  const [editingScope, setEditingScope] = useState(false);

  const mounted = useRef(false);
  const pending = useRef(false);
  const row = useRef<HTMLDivElement>(null);

  const isAdmin = user?.role === 'admin';

  const fetchStatus = async () => {
    try {
      const res = await apiClient.getGitHubConnection();
      if (mounted.current) {
        if (isAdmin && res.status === 'needs_scope') {
          setLoadingCandidates(true);
        }
        setData(res);
      }
    } catch {
      if (mounted.current) {
        setData({ status: 'not_connected', repos: [] });
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

  useEffect(() => {
    if (isAdmin && (data?.status === 'needs_scope' || editingScope)) {
      setLoadingCandidates(true);
      apiClient
        .getGitHubCandidateRepos()
        .then((res) => {
          if (mounted.current && res?.repos) {
            setCandidateRepos(res.repos);
          }
        })
        .catch(() => {
          if (mounted.current) setCandidateRepos([]);
        })
        .finally(() => {
          if (mounted.current) setLoadingCandidates(false);
        });
    }
  }, [isAdmin, data?.status, editingScope]);

  const connect = async () => {
    if (pending.current) return;
    const owns = githubSessionOwner();
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await apiClient.startGitHubConnection();
      if (mounted.current && owns()) redirectToGitHub(result.url);
    } catch {
      if (mounted.current && owns())
        setError('Không thể cập nhật kết nối GitHub. Hãy kiểm tra mạng và thử lại.');
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const disconnect = async () => {
    if (pending.current) return;
    const owns = githubSessionOwner();
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await apiClient.disconnectGitHub();
      if (mounted.current && owns()) {
        setConfirm(false);
        await fetchStatus();
        await refresh?.();
      }
    } catch {
      if (mounted.current && owns())
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

  const saveScope = async () => {
    if (selectedRepos.length === 0 || selectedRepos.length > 10) return;
    setBusy(true);
    setError('');
    try {
      await apiClient.saveGitHubScope(selectedRepos);
      setEditingScope(false);
      await fetchStatus();
      await refresh?.();
    } catch {
      setError('Không thể lưu phạm vi repository GitHub. Hãy thử lại.');
    } finally {
      setBusy(false);
    }
  };

  const status = data?.status ?? 'not_connected';

  const rowContent = (
    <div
      ref={row}
      id="service-row-github"
      tabIndex={-1}
      className="bg-[var(--planora-paper)] border border-[var(--planora-divider)] rounded-xl p-4 sm:p-5 v3-space-y-3.5 shadow-xs focus-visible:ring-2 focus-visible:ring-[var(--planora-primary)] focus-visible:v3-outline-none"
    >
      <div className="flex items-start sm:items-center justify-between gap-3 flex-wrap">
        <h3 className="font-display font-semibold text-base text-[var(--planora-text)] flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[var(--planora-surface-inset)] border border-[var(--planora-divider)] flex items-center justify-center flex-shrink-0">
            <ServiceLogo service="github" className="w-5 h-5" />
          </div>
          <span>GitHub</span>
        </h3>
        {status === 'connected' && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" aria-hidden="true" />
            <span>Đã kết nối</span>
          </span>
        )}
      </div>

      <p className="text-xs text-[var(--planora-muted)] leading-relaxed">
        Chỉ bạn dùng được tài khoản GitHub này để thao tác trên các repository đã được chọn.
      </p>

      <div className="text-sm font-medium text-[var(--planora-text)] break-words">
        {status === 'connected' ? (
          <span>
            Đã kết nối {data?.login && <span className="text-[var(--planora-muted)] font-normal"> · @{data.login}</span>}
          </span>
        ) : status === 'needs_scope' ? (
          <span>
            Đã kết nối · Chưa chọn repository {data?.login && <span className="text-[var(--planora-muted)] font-normal"> · @{data.login}</span>}
          </span>
        ) : status === 'needs_membership' ? (
          <span>
            Đã kết nối · Cần được cấp quyền repository {data?.login && <span className="text-[var(--planora-muted)] font-normal"> · @{data.login}</span>}
          </span>
        ) : status === 'reconnect_required' ? (
          <span>
            Cần kết nối lại {data?.login && <span className="text-[var(--planora-muted)] font-normal"> · @{data.login}</span>}
          </span>
        ) : status === 'unconfigured' ? (
          <span className="text-[var(--planora-muted)] font-normal">GitHub chưa được cấu hình trên máy chủ.</span>
        ) : (
          <span className="text-[var(--planora-muted)] font-normal">Chưa kết nối</span>
        )}
      </div>

      {status === 'needs_membership' && data?.repos && data.repos.length > 0 && (
        <div className="v3-space-y-2 border-t border-[var(--planora-divider)] pt-3">
          <p className="text-xs font-semibold text-[var(--planora-error-text,#DC2626)]">
            Bạn cần được cấp quyền truy cập repository:
          </p>
          <div className="v3-space-y-1.5">
            {data.repos.map((r) => (
              <div
                key={r.fullName}
                className="flex items-center justify-between p-2.5 bg-[var(--planora-surface-inset)] border border-[var(--planora-divider)] rounded-lg text-xs"
              >
                <span className="font-medium text-[var(--planora-text)]">{r.fullName}</span>
                <span className="text-[var(--planora-error-text,#DC2626)] font-medium">
                  Bạn cần được cấp quyền truy cập repository
                </span>
              </div>
            ))}
          </div>
          {isAdmin && !editingScope && (
            <button
              id="github-edit-scope"
              type="button"
              className={secondary}
              onClick={() => {
                setSelectedRepos((data.repos ?? []).filter((r) => r.accessible).map((r) => r.fullName));
                setEditingScope(true);
              }}
            >
              Đổi repository
            </button>
          )}
        </div>
      )}

      {status === 'connected' && data?.repos && (
        <div className="v3-space-y-2 border-t border-[var(--planora-divider)] pt-3">
          <div className="v3-space-y-1.5">
            {data.repos.map((r) => (
              <div
                key={r.fullName}
                className="flex items-center justify-between p-2.5 bg-[var(--planora-surface-inset)] border border-[var(--planora-divider)] rounded-lg text-xs"
              >
                <span className="font-medium text-[var(--planora-text)]">{r.fullName}</span>
                <span
                  className={
                    r.accessible
                      ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                      : 'text-[var(--planora-error-text,#DC2626)] font-medium'
                  }
                >
                  {r.accessible ? 'Dùng được' : 'Bạn cần được cấp quyền truy cập repository'}
                </span>
              </div>
            ))}
          </div>
          {isAdmin && !editingScope && (
            <button
              id="github-edit-scope"
              type="button"
              className={secondary}
              onClick={() => {
                setSelectedRepos((data.repos ?? []).filter((r) => r.accessible).map((r) => r.fullName));
                setEditingScope(true);
              }}
            >
              Đổi repository
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 pt-1">
        {status === 'not_connected' || status === 'reconnect_required' || status === 'unconfigured' ? (
          <button
            id="github-connect"
            type="button"
            className={button}
            disabled={busy || status === 'unconfigured'}
            onClick={() => void connect()}
          >
            Kết nối GitHub
          </button>
        ) : (
          <button
            id="github-disconnect"
            type="button"
            className={secondary}
            disabled={busy}
            onClick={() => setConfirm(true)}
          >
            Ngắt kết nối
          </button>
        )}
      </div>

      {isAdmin && (status === 'needs_scope' || editingScope) && (
        <div
          id="github-scope"
          data-testid="github-scope"
          className="mt-4 p-4 border border-[var(--planora-divider)] rounded-xl bg-[var(--planora-surface-inset)] v3-space-y-3.5"
        >
          <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--planora-muted)]">
            Chọn repository GitHub cho nhóm
          </h4>

          <div className="v3-space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-semibold text-[var(--planora-text)]">
                Các repository được phép dùng (tối đa 10 repository)
              </label>
              <span
                data-testid="github-scope-counter"
                className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-[var(--planora-paper)] border border-[var(--planora-border-strong)] text-[var(--planora-text)]"
              >
                Đã chọn {selectedRepos.length}/10
              </span>
            </div>
            {candidateRepos.length >= 5 && (
              <input
                type="search"
                value={repoFilter}
                onChange={(e) => setRepoFilter(e.target.value)}
                placeholder="Tìm nhanh theo tên repository..."
                aria-label="Tìm nhanh repository"
                className="w-full px-3 py-2 text-xs bg-[var(--planora-paper)] border border-[var(--planora-border-strong)] rounded-lg text-[var(--planora-text)] focus:ring-2 focus:ring-[var(--planora-primary)] focus:outline-none"
              />
            )}
            <div className="v3-space-y-1.5 max-h-48 overflow-y-auto">
              {candidateRepos
                .filter((r) =>
                  !repoFilter.trim() ||
                  r.fullName.toLowerCase().includes(repoFilter.trim().toLowerCase())
                )
                .map((r) => {
                  const checked = selectedRepos.includes(r.fullName);
                  const disabled = !checked && selectedRepos.length >= 10;
                  return (
                    <div
                      key={r.fullName}
                      className={`flex items-center justify-between gap-2.5 p-2 rounded-lg text-xs transition-colors ${
                        checked
                          ? 'bg-[var(--planora-paper)] border border-[var(--planora-primary)]'
                          : 'bg-[var(--planora-paper)] border border-[var(--planora-divider)] hover:border-[var(--planora-border-strong)]'
                      }`}
                    >
                      <label className="flex items-center gap-2.5 cursor-pointer flex-1 min-w-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggleRepo(r.fullName)}
                          className="w-4 h-4 rounded border-[var(--planora-border-strong)] text-[var(--planora-primary)] focus:ring-[var(--planora-primary)]"
                        />
                        <span className="font-medium text-[var(--planora-text)] truncate">{r.fullName}</span>
                      </label>
                      {typeof r.private === 'boolean' && (
                        <span
                          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border shrink-0 ${
                            r.private
                              ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                              : 'bg-[var(--planora-surface-inset)] text-[var(--planora-muted)] border-[var(--planora-divider)]'
                          }`}
                        >
                          {r.private ? 'Private' : 'Public'}
                        </span>
                      )}
                    </div>
                  );
                })}
              {loadingCandidates && candidateRepos.length === 0 && (
                <p className="text-xs text-[var(--planora-muted)]">Đang tải danh sách repository từ GitHub…</p>
              )}
              {!loadingCandidates && candidateRepos.length === 0 && (
                <p className="text-xs text-[var(--planora-muted)]">Không có repository nào trong tài khoản này.</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              id="github-save-scope"
              type="button"
              className={button}
              disabled={selectedRepos.length === 0 || selectedRepos.length > 10 || busy}
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
              <p className="text-sm text-[var(--planora-text)]">
                Planora sẽ xoá token kết nối GitHub của bạn. Kế hoạch cũ sẽ không thể thực thi
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

export default GitHubConnection;
