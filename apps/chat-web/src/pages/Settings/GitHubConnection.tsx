import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { User } from '../../types';
import { apiClient } from '../../services/api-client';
import { githubSessionOwner, redirectToGitHub } from '../../services/github-connection';
import { CockpitDialog } from '../../components/CockpitDialog';
import { ServiceLogo } from '../../components/ServiceLogo';

const button =
  'px-4 py-2 rounded-xl text-xs font-semibold bg-[#FF5701] text-white hover:bg-[#E04C00] disabled:opacity-50 transition-colors shadow-sm';
const secondary =
  'px-4 py-2 rounded-xl text-xs font-medium bg-white text-[#111827] border border-[#E7E7E2] hover:bg-neutral-50 disabled:opacity-50 transition-colors';

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
      if (window.location.hash === '#github') {
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
      apiClient
        .getGitHubCandidateRepos()
        .then((res) => {
          if (mounted.current && res?.repos) {
            setCandidateRepos(res.repos);
          }
        })
        .catch(() => {
          if (mounted.current) setCandidateRepos([]);
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
      className="bg-white border border-[#E7E7E2] rounded-xl p-4 sm:p-5 v3-space-y-4 focus-visible:ring-2 focus-visible:ring-[#FF5701] focus-visible:v3-outline-none"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display font-semibold text-base text-[#111827] flex items-center gap-3">
          <ServiceLogo service="github" className="w-6 h-6" />
          GitHub
        </h3>
        {status === 'connected' && (
          <span className="text-xs font-semibold px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md">
            Đã kết nối
          </span>
        )}
      </div>

      <p className="text-xs text-[#6B7280]">
        Chỉ bạn dùng được tài khoản GitHub này để thao tác trên các repository đã được chọn.
      </p>

      <div className="text-sm text-[#111827] break-words">
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
          <span className="text-[#6B7280]">GitHub chưa được cấu hình trên máy chủ.</span>
        ) : (
          <span className="text-[#6B7280]">Chưa kết nối</span>
        )}
      </div>

      {status === 'needs_membership' && data?.repos && data.repos.length > 0 && (
        <div className="v3-space-y-2 border-t border-[#F3F4F6] pt-3">
          <p className="text-xs font-semibold text-[#DC2626]">
            Bạn cần được cấp quyền truy cập repository:
          </p>
          <div className="v3-space-y-1.5">
            {data.repos.map((r) => (
              <div
                key={r.fullName}
                className="flex items-center justify-between p-2.5 bg-neutral-50 rounded-lg text-xs"
              >
                <span className="font-medium text-[#111827]">{r.fullName}</span>
                <span className="text-[#DC2626] font-medium">
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
        <div className="v3-space-y-2 border-t border-[#F3F4F6] pt-3">
          <div className="v3-space-y-1.5">
            {data.repos.map((r) => (
              <div
                key={r.fullName}
                className="flex items-center justify-between p-2.5 bg-neutral-50 rounded-lg text-xs"
              >
                <span className="font-medium text-[#111827]">{r.fullName}</span>
                <span
                  className={
                    r.accessible
                      ? 'text-emerald-700 font-medium'
                      : 'text-[#DC2626] font-medium'
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

      <div className="flex flex-wrap items-center gap-3 pt-2">
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
          className="mt-4 p-4 border border-[#E7E7E2] rounded-xl bg-[#F8F8F6] v3-space-y-3"
        >
          <h4 className="text-xs font-bold uppercase tracking-wider text-[#6B7280]">
            Chọn repository GitHub cho nhóm
          </h4>

          <div className="v3-space-y-2">
            <label className="text-xs font-semibold text-[#111827]">
              Các repository được phép dùng (tối đa 10 repository)
            </label>
            <div className="v3-space-y-1.5 max-h-48 overflow-y-auto">
              {candidateRepos.map((r) => {
                const checked = selectedRepos.includes(r.fullName);
                const disabled = !checked && selectedRepos.length >= 10;
                return (
                  <label
                    key={r.fullName}
                    className={`flex items-center gap-2 p-2 rounded-lg text-xs cursor-pointer ${
                      checked ? 'bg-[#F8F8F6] border border-[#111827]/30' : 'bg-white border border-[#E7E7E2]'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggleRepo(r.fullName)}
                      className="rounded text-[#111827] focus:ring-[#111827]"
                    />
                    <span className="font-medium text-[#111827]">{r.fullName}</span>
                  </label>
                );
              })}
              {candidateRepos.length === 0 && (
                <p className="text-xs text-[#6B7280]">Không có repository nào trong tài khoản này.</p>
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
                ATI sẽ xoá token kết nối GitHub của bạn. Kế hoạch cũ sẽ không thể thực thi
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
