import { useEffect, useRef, useState } from 'react';
import type { User } from '../../types';
import type {
  JiraConnectionStatusResponse,
  WorkspaceSummary,
  WorkspaceMemberItem,
  WorkspaceInviteItem,
  WorkspaceSiteItem,
  WorkspaceProjectItem,
  WorkspaceJiraCapabilitiesResponse,
} from '@wap/tool-schemas';
import { jiraApi } from '../../services/jira-api';
import {
  jiraSessionOwner,
  redirectToJira,
  jiraConnectionNotice,
} from '../../services/jira-connection';
import {
  getCachedOrganizations,
  setCachedOrganizations,
  setActiveWorkspaceId as setGlobalActiveWorkspaceId,
} from '../../services/workspace-storage';
import { ServiceLogo } from '../../components/ServiceLogo';

const JIRA_KEY = 'ji' + 'ra';

const buttonPrimary =
  'px-4 py-2 rounded-xl text-xs font-semibold bg-[#FF5701] text-white hover:bg-[#E04C00] disabled:opacity-50 transition-colors shadow-sm cursor-pointer';
const buttonSecondary =
  'px-4 py-2 rounded-xl text-xs font-medium bg-white text-[#111827] dark:bg-[#1F2937] dark:text-white border border-[#E7E7E2] dark:border-[#374151] hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-50 transition-colors cursor-pointer';
const buttonDanger =
  'px-4 py-2 rounded-xl text-xs font-medium bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 border border-red-200 dark:border-red-900 hover:bg-red-100 disabled:opacity-50 transition-colors cursor-pointer';

export interface JiraConnectionProps {
  user: User | null;
  refresh?: () => Promise<void>;
  selected?: string | null;
  standalone?: boolean;
  navigate?: (path: string, replace?: boolean) => void;
}

export function JiraConnection({
  user,
  refresh,
  selected,
  navigate,
}: JiraConnectionProps) {
  const [data, setData] = useState<JiraConnectionStatusResponse | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [infoNotice, setInfoNotice] = useState('');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  // Join & Create workspace state
  const [inviteTokenInput, setInviteTokenInput] = useState('');
  const [newWorkspaceName, setNewWorkspaceName] = useState('');

  // Admin workspace states
  const [members, setMembers] = useState<WorkspaceMemberItem[]>([]);
  const [invites, setInvites] = useState<WorkspaceInviteItem[]>([]);
  const [sites, setSites] = useState<WorkspaceSiteItem[]>([]);
  const [capabilities, setCapabilities] = useState<WorkspaceJiraCapabilitiesResponse | null>(null);

  // New invite state
  const [createdInviteToken, setCreatedInviteToken] = useState<string | null>(null);
  const [copiedInviteToken, setCopiedInviteToken] = useState(false);

  // Project configuration modal state
  const [configuringSite, setConfiguringSite] = useState<WorkspaceSiteItem | null>(null);
  const [candidateProjects, setCandidateProjects] = useState<WorkspaceProjectItem[]>([]);
  const [sitePolicyVersion, setSitePolicyVersion] = useState<number>(1);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);

  const mounted = useRef(false);
  const pending = useRef(false);
  const row = useRef<HTMLDivElement>(null);
  const activeWorkspaceIdRef = useRef<string>('');
  const prevWorkspaceIdRef = useRef<string>('');
  const workspaceFetchSeqRef = useRef<number>(0);

  const selectedWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);
  const isWorkspaceAdmin = selectedWorkspace?.role === 'admin';
  const isWorkspaceActive = selectedWorkspace?.membershipStatus === 'active';

  const syncWorkspaceToGlobalContext = (ws?: {
    id: string;
    name: string;
    slug?: string;
    role?: 'admin' | 'member';
    membershipStatus?: string;
  }) => {
    const target = ws ?? selectedWorkspace;
    if (!target?.id) return;
    const currentOrgs = getCachedOrganizations();
    const mappedStatus: 'pending' | 'active' | 'disabled' =
      target.membershipStatus === 'pending'
        ? 'pending'
        : target.membershipStatus === 'rejected' || target.membershipStatus === 'removed'
        ? 'disabled'
        : 'active';
    const mapped = {
      id: target.id,
      name: target.name,
      slug: target.slug,
      role: target.role ?? 'admin',
      status: mappedStatus,
    };
    const nextOrgs = currentOrgs.some((o) => o.id === target.id)
      ? currentOrgs.map((o) => (o.id === target.id ? { ...o, ...mapped } : o))
      : [...currentOrgs, mapped];
    setCachedOrganizations(nextOrgs);
    setGlobalActiveWorkspaceId(target.id);
  };

  const mapErrorMessage = (err: any): string => {
    const status = err?.status ?? err?.statusCode;
    const code = err?.data?.code || err?.code;
    const serverError = typeof err?.data?.error === 'string' ? err.data.error : null;

    if (code === 'NATIVE_ADMINISTER_REQUIRED' || code === 'native_permission_denied') {
      return 'Tài khoản của bạn thiếu quyền quản trị (ADMINISTER) trên Jira Cloud site này.';
    }
    if (code === 'ALREADY_WORKSPACE_MEMBER') {
      return 'Bạn đã là thành viên của Jira workspace này.';
    }
    if (code === 'INVITE_NOT_FOUND') {
      return 'Mã mời không tồn tại, đã hết hạn hoặc không hợp lệ.';
    }
    if (code === 'stale_version' || code === 'CONFLICT' || status === 409) {
      return 'Dữ liệu vừa được cập nhật bởi một người dùng khác. Đã tải lại thông tin mới nhất.';
    }
    if (code === 'upstream_auth' || code === 'reconnect_required') {
      return 'Cần xác thực lại với Atlassian. Hãy bấm "Kết nối lại Jira".';
    }
    if (code === 'INVALID_SESSION' || status === 401) {
      return 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.';
    }
    if (code === 'membership_required') {
      return 'Bạn chưa phải là thành viên hoạt động của Jira workspace này.';
    }
    if (code === 'FORBIDDEN' || status === 403) {
      return (
        serverError ||
        'Bạn không có quyền thực hiện thao tác hoặc truy cập kết nối Jira này.'
      );
    }
    if (code === 'upstream_rate_limited' || status === 429) {
      return (
        serverError ||
        'Atlassian đang giới hạn tần suất yêu cầu. Vui lòng thử lại sau.'
      );
    }
    if (code === 'upstream_unavailable' || status === 503) {
      return (
        serverError ||
        'Dịch vụ Jira tạm thời không khả dụng. Vui lòng thử lại sau.'
      );
    }
    if (status >= 500) {
      return (
        serverError ||
        'Có lỗi xảy ra từ máy chủ Jira. Vui lòng thử lại sau.'
      );
    }
    if (
      err?.name === 'TypeError' ||
      err?.message?.includes('fetch') ||
      err?.message?.includes('NetworkError') ||
      err?.message?.includes('network')
    ) {
      return 'Không thể kết nối đến máy chủ Jira. Vui lòng kiểm tra mạng và thử lại.';
    }
    return serverError || err?.message || 'Có lỗi xảy ra khi thực hiện thao tác với Jira.';
  };

  const fetchConnection = async () => {
    try {
      setConnectionError('');
      const res = await jiraApi.connection();
      if (mounted.current) {
        setData(res);
        setConnectionError('');
      }
    } catch (err: any) {
      if (mounted.current) {
        const status = err?.status ?? err?.statusCode;
        if (status === 404) {
          setData({
            connected: false,
            connectionState: 'disconnected',
            jiraAccountId: null,
            atlassianAccountId: null,
            sites: [],
          });
          setConnectionError('');
        } else {
          setData(null);
          setConnectionError(mapErrorMessage(err));
        }
      }
    }
  };

  const fetchWorkspaceDetails = async (wsId: string, currentWorkspaces?: WorkspaceSummary[]) => {
    if (!wsId) return;
    const fetchSeq = ++workspaceFetchSeqRef.current;
    try {
      const capRes = await jiraApi.capabilities(wsId).catch(() => null);
      if (
        !mounted.current ||
        activeWorkspaceIdRef.current !== wsId ||
        workspaceFetchSeqRef.current !== fetchSeq
      ) {
        return;
      }
      setCapabilities(capRes);

      const targetList = currentWorkspaces ?? workspaces;
      const ws = targetList.find((w) => w.id === wsId);
      if (ws?.role === 'admin') {
        const [memRes, invRes, sitesRes] = await Promise.all([
          jiraApi.members(wsId).catch(() => ({ members: [] })),
          jiraApi.invites(wsId).catch(() => ({ invites: [] })),
          jiraApi.sites(wsId).catch(() => ({ sites: [] })),
        ]);
        if (
          !mounted.current ||
          activeWorkspaceIdRef.current !== wsId ||
          workspaceFetchSeqRef.current !== fetchSeq
        ) {
          return;
        }
        setMembers(memRes.members ?? []);
        setInvites(invRes.invites ?? []);
        setSites(sitesRes.sites ?? []);
      } else {
        setMembers([]);
        setInvites([]);
        setSites([]);
      }
    } catch {
      // ignore
    }
  };

  const fetchWorkspaces = async () => {
    try {
      const res = await jiraApi.workspaces();
      if (mounted.current) {
        const list = res?.workspaces ?? [];
        setWorkspaces(list);
        const nextId =
          list.length > 0 && (!activeWorkspaceId || !list.some((w) => w.id === activeWorkspaceId))
            ? list[0].id
            : activeWorkspaceId;
        if (nextId) {
          activeWorkspaceIdRef.current = nextId;
          setActiveWorkspaceId(nextId);
          void fetchWorkspaceDetails(nextId, list);
        }
      }
    } catch {
      if (mounted.current) setWorkspaces([]);
    }
  };

  const handleSelectWorkspace = (nextId: string) => {
    activeWorkspaceIdRef.current = nextId;
    prevWorkspaceIdRef.current = nextId;
    setCreatedInviteToken(null);
    setMembers([]);
    setInvites([]);
    setSites([]);
    setCapabilities(null);
    setConfiguringSite(null);
    setCandidateProjects([]);
    setSelectedProjectIds([]);
    setError('');
    setActiveWorkspaceId(nextId);
    if (nextId) {
      void fetchWorkspaceDetails(nextId);
    }
  };

  useEffect(() => {
    mounted.current = true;
    const notice = jiraConnectionNotice.take(user?.id);
    if (notice) {
      setInfoNotice(`Đã kết nối thành công tài khoản Atlassian ${notice}.`);
    }
    void fetchConnection();
    void fetchWorkspaces();
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const isDifferentWorkspace = prevWorkspaceIdRef.current !== activeWorkspaceId;
    prevWorkspaceIdRef.current = activeWorkspaceId;
    activeWorkspaceIdRef.current = activeWorkspaceId;

    if (isDifferentWorkspace) {
      setCreatedInviteToken(null);
      setMembers([]);
      setInvites([]);
      setSites([]);
      setCapabilities(null);
      setConfiguringSite(null);
      setCandidateProjects([]);
      setSelectedProjectIds([]);
      setError('');
    }

    if (activeWorkspaceId) {
      void fetchWorkspaceDetails(activeWorkspaceId, workspaces);
    }
  }, [activeWorkspaceId, workspaces]);

  useEffect(() => {
    const focus = () => {
      if (window.location.hash === '#' + JIRA_KEY) {
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

  // Connect Identity
  const handleConnectIdentity = async () => {
    if (pending.current) return;
    const owns = jiraSessionOwner();
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await jiraApi.start('identity');
      if (mounted.current && owns()) redirectToJira(result.authUrl);
    } catch (err) {
      if (mounted.current && owns()) setError(mapErrorMessage(err));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  // Authorize Sites
  const handleAuthorizeSites = async () => {
    if (pending.current) return;
    const owns = jiraSessionOwner();
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await jiraApi.start('authorize_sites');
      if (mounted.current && owns()) redirectToJira(result.authUrl);
    } catch (err) {
      if (mounted.current && owns()) setError(mapErrorMessage(err));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  // Sync Sites
  const handleSyncSites = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setInfoNotice('');
    try {
      const res = await jiraApi.syncSites();
      if (mounted.current) {
        setInfoNotice(`Đã đồng bộ ${res.syncedCount} site từ Atlassian.`);
        await fetchConnection();
        if (activeWorkspaceId) await fetchWorkspaceDetails(activeWorkspaceId);
      }
    } catch (err) {
      if (mounted.current) setError(mapErrorMessage(err));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  // Disconnect
  const handleDisconnect = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await jiraApi.disconnect();
      if (mounted.current) {
        setConfirmDisconnect(false);
        setInfoNotice('Đã ngắt kết nối tài khoản Atlassian Jira.');
        await fetchConnection();
        await fetchWorkspaces();
        await refresh?.();
      }
    } catch (err) {
      if (mounted.current) setError(mapErrorMessage(err));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  // Join workspace with invite token
  const handleJoinWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteTokenInput.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await jiraApi.join(inviteTokenInput.trim());
      if (mounted.current) {
        setInviteTokenInput('');
        setInfoNotice('Yêu cầu tham gia workspace Jira đã được gửi và đang chờ duyệt.');
        await fetchWorkspaces();
      }
    } catch (err) {
      if (mounted.current) setError(mapErrorMessage(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  // Create self-service Jira workspace
  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkspaceName.trim() || busy) return;
    setBusy(true);
    setError('');
    setInfoNotice('');
    try {
      const res = await jiraApi.createSelfServiceWorkspace(newWorkspaceName.trim());
      if (mounted.current) {
        setNewWorkspaceName('');
        setInfoNotice(`Đã tạo Jira Workspace "${res.workspace.name}" thành công.`);
        await fetchWorkspaces();
        if (res.workspace.id) {
          syncWorkspaceToGlobalContext(res.workspace);
          handleSelectWorkspace(res.workspace.id);
        }
      }
    } catch (err) {
      if (mounted.current) setError(mapErrorMessage(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  // Member decision (approve, reject, remove)
  const handleMemberDecision = async (
    targetUserId: string,
    expectedVersion: number,
    decision: 'approve' | 'reject' | 'remove'
  ) => {
    if (!activeWorkspaceId || busy) return;
    const targetWsId = activeWorkspaceId;
    setBusy(true);
    setError('');
    try {
      await jiraApi.decision(targetWsId, targetUserId, expectedVersion, decision);
      if (mounted.current && activeWorkspaceIdRef.current === targetWsId) {
        await fetchWorkspaceDetails(targetWsId);
      }
    } catch (err) {
      if (mounted.current && activeWorkspaceIdRef.current === targetWsId) {
        setError(mapErrorMessage(err));
        await fetchWorkspaceDetails(targetWsId);
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  // Create invite
  const handleCreateInvite = async () => {
    if (!activeWorkspaceId || busy) return;
    const targetWsId = activeWorkspaceId;
    setBusy(true);
    setError('');
    try {
      const res = await jiraApi.createInvite(targetWsId, 7);
      if (mounted.current && activeWorkspaceIdRef.current === targetWsId) {
        setCreatedInviteToken(res.inviteToken);
        await fetchWorkspaceDetails(targetWsId);
      }
    } catch (err) {
      if (mounted.current && activeWorkspaceIdRef.current === targetWsId) {
        setError(mapErrorMessage(err));
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  // Revoke invite
  const handleRevokeInvite = async (inviteId: string) => {
    if (!activeWorkspaceId || busy) return;
    const targetWsId = activeWorkspaceId;
    setBusy(true);
    setError('');
    try {
      await jiraApi.revokeInvite(targetWsId, inviteId);
      if (mounted.current && activeWorkspaceIdRef.current === targetWsId) {
        await fetchWorkspaceDetails(targetWsId);
      }
    } catch (err) {
      if (mounted.current && activeWorkspaceIdRef.current === targetWsId) {
        setError(mapErrorMessage(err));
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  // Link site
  const handleLinkSite = async (cloudId: string) => {
    if (!activeWorkspaceId || !cloudId || busy) return;
    const targetWsId = activeWorkspaceId;
    setBusy(true);
    setError('');
    try {
      await jiraApi.linkSite(targetWsId, cloudId);
      if (mounted.current && activeWorkspaceIdRef.current === targetWsId) {
        await fetchWorkspaceDetails(targetWsId);
      }
    } catch (err) {
      if (mounted.current && activeWorkspaceIdRef.current === targetWsId) {
        setError(mapErrorMessage(err));
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  // Toggle site active
  const handleToggleSiteActive = async (site: WorkspaceSiteItem) => {
    if (!activeWorkspaceId || busy) return;
    const targetWsId = activeWorkspaceId;
    setBusy(true);
    setError('');
    try {
      await jiraApi.updateSite(
        targetWsId,
        site.siteId,
        site.policyVersion,
        !site.active
      );
      if (mounted.current && activeWorkspaceIdRef.current === targetWsId) {
        await fetchWorkspaceDetails(targetWsId);
      }
    } catch (err) {
      if (mounted.current && activeWorkspaceIdRef.current === targetWsId) {
        setError(mapErrorMessage(err));
        await fetchWorkspaceDetails(targetWsId);
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  // Open project configuration
  const handleOpenProjectConfig = async (site: WorkspaceSiteItem) => {
    if (!activeWorkspaceId) return;
    const targetWsId = activeWorkspaceId;
    setConfiguringSite(site);
    setError('');
    try {
      const res = await jiraApi.projects(targetWsId, site.siteId);
      if (mounted.current && activeWorkspaceIdRef.current === targetWsId) {
        setCandidateProjects(res.projects ?? []);
        setSitePolicyVersion(res.sitePolicyVersion ?? 1);
        setSelectedProjectIds(
          res.projects?.filter((p) => p.selected).map((p) => p.projectId) ?? []
        );
      }
    } catch (err) {
      if (mounted.current && activeWorkspaceIdRef.current === targetWsId) {
        setError(mapErrorMessage(err));
      }
    }
  };

  // Save configured projects
  const handleSaveProjects = async () => {
    if (!activeWorkspaceId || !configuringSite || busy) return;
    const targetWsId = activeWorkspaceId;
    setBusy(true);
    setError('');
    try {
      await jiraApi.configureProjects(
        targetWsId,
        configuringSite.siteId,
        sitePolicyVersion,
        selectedProjectIds
      );
      if (mounted.current && activeWorkspaceIdRef.current === targetWsId) {
        setConfiguringSite(null);
        await fetchWorkspaceDetails(targetWsId);
      }
    } catch (err) {
      if (mounted.current && activeWorkspaceIdRef.current === targetWsId) {
        setError(mapErrorMessage(err));
        await fetchWorkspaceDetails(targetWsId);
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const isConnected = !connectionError && data?.connectionState === 'connected';
  const isIdentityConnected = !connectionError && data?.connectionState === 'identity_connected';
  const isScopeRequired = !connectionError && data?.connectionState === 'scope_required';
  const isReconnectRequired = !connectionError && data?.connectionState === 'reconnect_required';
  const isDisconnected =
    !connectionError &&
    data !== null &&
    !isConnected &&
    !isIdentityConnected &&
    !isScopeRequired &&
    !isReconnectRequired;

  // Available candidate sites that can be linked
  const authorizedSites = data?.sites ?? [];
  const linkedSiteCloudIds = sites.map((s) => s.cloudId);
  const unlinkedSites = authorizedSites.filter((s) => !linkedSiteCloudIds.includes(s.cloudId));

  return (
    <div
      ref={row}
      id={JIRA_KEY}
      tabIndex={-1}
      className={`rounded-2xl border bg-white dark:bg-[#111827] transition-all p-5 sm:p-6 ${
        selected === JIRA_KEY
          ? 'border-[#FF5701] ring-2 ring-[#FF5701]/20 shadow-md'
          : 'border-[#E7E7E2] dark:border-[#374151]'
      }`}
    >
      {/* HEADER SECTION */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-5 border-b border-[#E7E7E2] dark:border-[#374151]">
        <div className="flex items-center gap-3">
          <ServiceLogo service={JIRA_KEY} className="w-8 h-8 rounded-lg" />
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm sm:text-base text-[#111827] dark:text-white">
                Atlassian Jira Cloud
              </h3>
              {connectionError ? (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900">
                  Lỗi kết nối
                </span>
              ) : isConnected ? (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#16A34A]/10 text-[#16A34A] border border-[#16A34A]/20">
                  Đã kết nối
                </span>
              ) : isIdentityConnected ? (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                  Đã kết nối danh tính
                </span>
              ) : isScopeRequired ? (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                  Cần cấp quyền site
                </span>
              ) : isReconnectRequired ? (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-50 text-red-700 border border-red-200">
                  Cần kết nối lại
                </span>
              ) : isDisconnected ? (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                  Chưa kết nối
                </span>
              ) : null}
            </div>
            <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF] mt-0.5">
              Kết nối danh tính Atlassian, cấp quyền site Jira và quản lý quyền truy cập theo workspace.
            </p>
          </div>
        </div>

        {/* PRIMARY ACTIONS */}
        <div className="flex flex-wrap items-center gap-2">
          {connectionError ? (
            <button
              type="button"
              id="jira-retry-connection"
              onClick={() => {
                void fetchConnection();
                void fetchWorkspaces();
              }}
              disabled={busy}
              className={buttonSecondary}
            >
              Thử lại
            </button>
          ) : (
            <>
              {isDisconnected && (
                <button
                  type="button"
                  id="jira-connect"
                  onClick={handleConnectIdentity}
                  disabled={busy}
                  className={buttonPrimary}
                >
                  {busy ? 'Đang chuyển hướng…' : 'Kết nối Jira'}
                </button>
              )}

              {(isIdentityConnected || isScopeRequired) && (
                <button
                  type="button"
                  id="jira-authorize-sites"
                  onClick={handleAuthorizeSites}
                  disabled={busy}
                  className={buttonPrimary}
                >
                  {busy ? 'Đang chuyển hướng…' : 'Cấp quyền Jira site'}
                </button>
              )}

              {isReconnectRequired && (
                <button
                  type="button"
                  id="jira-reconnect"
                  onClick={handleConnectIdentity}
                  disabled={busy}
                  className={buttonPrimary}
                >
                  {busy ? 'Đang chuyển hướng…' : 'Kết nối lại Jira'}
                </button>
              )}

              {isConnected && (
                <>
                  <button
                    type="button"
                    id="jira-sync-sites"
                    onClick={handleSyncSites}
                    disabled={busy}
                    className={buttonSecondary}
                  >
                    {busy ? 'Đang đồng bộ…' : 'Đồng bộ sites'}
                  </button>
                  <button
                    type="button"
                    id="jira-disconnect"
                    onClick={() => setConfirmDisconnect(true)}
                    disabled={busy}
                    className={buttonDanger}
                  >
                    Ngắt kết nối
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* 3-STEP ONBOARDING PROGRESS BAR */}
      <div
        data-testid="jira-setup-steps"
        className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2.5 p-3 rounded-xl bg-[#F8F8F6] dark:bg-[#1F2937]/40 border border-[#E7E7E2] dark:border-[#374151] text-xs"
      >
        <div className="flex items-center gap-2">
          <span
            className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
              isConnected
                ? 'bg-[#16A34A] text-white'
                : isIdentityConnected
                ? 'bg-blue-600 text-white'
                : 'bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300'
            }`}
          >
            {isConnected ? '✓' : '1'}
          </span>
          <div className="min-w-0">
            <div className="font-semibold text-[#111827] dark:text-white truncate">
              Bước 1: Tài khoản Atlassian
            </div>
            <div className="text-[11px] text-[#6B7280] dark:text-[#9CA3AF] truncate">
              {isConnected
                ? 'Đã xác thực OAuth 3LO'
                : isIdentityConnected
                ? 'Cần cấp quyền site'
                : 'Kết nối OAuth 3LO'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
              isWorkspaceActive
                ? 'bg-[#16A34A] text-white'
                : 'bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300'
            }`}
          >
            {isWorkspaceActive ? '✓' : '2'}
          </span>
          <div className="min-w-0">
            <div className="font-semibold text-[#111827] dark:text-white truncate">
              Bước 2: Jira Workspace
            </div>
            <div className="text-[11px] text-[#6B7280] dark:text-[#9CA3AF] truncate">
              {isWorkspaceActive && selectedWorkspace
                ? `Đang chọn: ${selectedWorkspace.name}`
                : 'Tạo mới hoặc nhập mã mời'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
              isConnected && isWorkspaceActive && (capabilities?.sites?.length ?? 0) > 0
                ? 'bg-[#16A34A] text-white'
                : 'bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300'
            }`}
          >
            {isConnected && isWorkspaceActive && (capabilities?.sites?.length ?? 0) > 0 ? '✓' : '3'}
          </span>
          <div className="min-w-0">
            <div className="font-semibold text-[#111827] dark:text-white truncate">
              Bước 3: Site &amp; Projects
            </div>
            <div className="text-[11px] text-[#6B7280] dark:text-[#9CA3AF] truncate">
              {(capabilities?.sites?.length ?? 0) > 0
                ? `Đã kích hoạt ${capabilities!.sites.length} site`
                : 'Liên kết site & chọn project'}
            </div>
          </div>
        </div>
      </div>

      {/* CONNECTION ERROR ALERT */}
      {connectionError && (
        <div
          id="jira-connection-error-alert"
          aria-live="polite"
          className="mt-4 p-3.5 rounded-xl bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200 dark:border-rose-900 text-xs flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 flex-shrink-0 text-rose-600 dark:text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>{connectionError}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              void fetchConnection();
              void fetchWorkspaces();
            }}
            className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-rose-100 hover:bg-rose-200 text-rose-800 dark:bg-rose-900 dark:hover:bg-rose-800 dark:text-rose-200 whitespace-nowrap"
          >
            Thử lại
          </button>
        </div>
      )}

      {/* DISCONNECT CONFIRMATION MODAL / PANEL */}
      {confirmDisconnect && (
        <div className="my-4 p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-xs">
          <p className="font-semibold text-amber-900 dark:text-amber-200 mb-1">
            Xác nhận ngắt kết nối Atlassian Jira?
          </p>
          <p className="text-amber-800 dark:text-amber-300 mb-3">
            Toàn bộ quyền truy cập site và danh tính Atlassian của bạn trên hệ thống sẽ bị thu hồi.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={busy}
              className={buttonDanger}
            >
              Xác nhận ngắt kết nối
            </button>
            <button
              type="button"
              onClick={() => setConfirmDisconnect(false)}
              className={buttonSecondary}
            >
              Huỷ
            </button>
          </div>
        </div>
      )}

      {/* ERROR & INFO ALERTS */}
      {error && (
        <div role="alert" className="my-4 p-3.5 rounded-xl bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 border border-red-200 dark:border-red-900 text-xs">
          {error}
        </div>
      )}
      {infoNotice && (
        <div role="status" className="my-4 p-3.5 rounded-xl bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300 border border-green-200 dark:border-green-900 text-xs">
          {infoNotice}
        </div>
      )}

      {/* DETAILS: ATLANSSIAN IDENTITY & SITES */}
      {(isConnected || isIdentityConnected || isScopeRequired) && (
        <div className="py-4 border-b border-[#E7E7E2] dark:border-[#374151] text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-neutral-600 dark:text-neutral-400">
            <div>
              <span className="font-medium text-[#111827] dark:text-white">Tài khoản Atlassian: </span>
              {data?.displayName ?? data?.atlassianAccountId ?? 'Đã xác thực'}
            </div>
            {data?.atlassianAccountId && (
              <div>
                <span className="font-medium text-[#111827] dark:text-white">ID tài khoản Atlassian: </span>
                <code className="text-[11px] bg-neutral-100 dark:bg-neutral-800 px-1 py-0.5 rounded">
                  {data.atlassianAccountId}
                </code>
              </div>
            )}
            {data?.jiraAccountId && (
              <div>
                <span className="font-medium text-[#111827] dark:text-white">Jira Account ID: </span>
                <code className="text-[11px] bg-neutral-100 dark:bg-neutral-800 px-1 py-0.5 rounded">
                  {data.jiraAccountId}
                </code>
              </div>
            )}
          </div>

          {/* SITES LIST */}
          {authorizedSites.length > 0 && (
            <div className="mt-3">
              <span className="font-medium text-[#111827] dark:text-white block mb-1">
                Jira Cloud sites đã được cấp quyền ({authorizedSites.length}):
              </span>
              <ul className="space-y-1">
                {authorizedSites.map((s) => (
                  <li key={s.cloudId} className="flex items-center gap-2 text-neutral-600 dark:text-neutral-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                    <span className="font-medium text-[#111827] dark:text-white">{s.name}</span>
                    <span className="text-[11px] text-neutral-400">({s.url})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* JIRA WORKSPACE MANAGEMENT SECTION */}
      <div className="pt-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
          <div>
            <h4 className="font-semibold text-xs uppercase tracking-wider text-[#6B7280] dark:text-[#9CA3AF]">
              Không gian làm việc Jira (Jira Workspaces)
            </h4>
            <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
              Quyền Jira được kiểm soát theo từng workspace độc lập với quyền tổ chức ATI.
            </p>
          </div>

          {/* WORKSPACE SELECTOR */}
          {workspaces.length > 0 && (
            <div className="flex items-center gap-2">
              <label htmlFor="jira-workspace-select" className="text-xs text-[#6B7280] dark:text-[#9CA3AF] whitespace-nowrap">
                Chọn workspace:
              </label>
              <select
                id="jira-workspace-select"
                aria-label="Chọn Jira Workspace"
                value={activeWorkspaceId}
                onChange={(e) => handleSelectWorkspace(e.target.value)}
                className="px-2.5 py-1.5 text-xs rounded-lg border border-[#E7E7E2] dark:border-[#374151] bg-white dark:bg-[#1F2937] text-[#111827] dark:text-white"
              >
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.role === 'admin' ? 'Quản trị' : 'Thành viên'} — {w.membershipStatus})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* CREATE OR JOIN WORKSPACE FORMS */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-5">
          <form onSubmit={handleCreateWorkspace} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <input
              type="text"
              placeholder="Tên Jira Workspace mới (ví dụ: Team Kỹ thuật)..."
              value={newWorkspaceName}
              onChange={(e) => setNewWorkspaceName(e.target.value)}
              disabled={busy}
              className="flex-1 px-3 py-2 text-xs rounded-xl border border-[#E7E7E2] dark:border-[#374151] bg-white dark:bg-[#1F2937] text-[#111827] dark:text-white placeholder-neutral-400 focus:outline-none focus:ring-1 focus:ring-[#FF5701]"
            />
            <button
              type="submit"
              disabled={busy || !newWorkspaceName.trim()}
              className={buttonPrimary}
            >
              Tạo Jira Workspace mới
            </button>
          </form>

          <form onSubmit={handleJoinWorkspace} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <input
              type="text"
              placeholder="Nhập mã mời Jira (invite token)..."
              value={inviteTokenInput}
              onChange={(e) => setInviteTokenInput(e.target.value)}
              disabled={busy}
              className="flex-1 px-3 py-2 text-xs rounded-xl border border-[#E7E7E2] dark:border-[#374151] bg-white dark:bg-[#1F2937] text-[#111827] dark:text-white placeholder-neutral-400 focus:outline-none focus:ring-1 focus:ring-[#FF5701]"
            />
            <button
              type="submit"
              disabled={busy || !inviteTokenInput.trim()}
              className={buttonSecondary}
            >
              Tham gia Jira workspace
            </button>
          </form>
        </div>

        {/* CURRENT WORKSPACE DETAILS */}
        {selectedWorkspace ? (
          <div className="p-4 rounded-xl border border-[#E7E7E2] dark:border-[#374151] bg-[#F8F8F6] dark:bg-[#1F2937]/50 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-[#111827] dark:text-white">
                  {selectedWorkspace.name}
                </span>
                <span className="text-[11px] text-neutral-500">({selectedWorkspace.slug})</span>
              </div>
              <div>
                {selectedWorkspace.membershipStatus === 'active' && (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-green-50 text-green-700 border border-green-200">
                    Thành viên hoạt động
                  </span>
                )}
                {selectedWorkspace.membershipStatus === 'pending' && (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                    Đang chờ duyệt
                  </span>
                )}
                {selectedWorkspace.membershipStatus === 'rejected' && (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-50 text-red-700 border border-red-200">
                    Bị từ chối
                  </span>
                )}
                {selectedWorkspace.membershipStatus === 'removed' && (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-neutral-200 text-neutral-700">
                    Đã bị gỡ khỏi workspace
                  </span>
                )}
              </div>
            </div>

            {/* CAPABILITIES DIRECTORY */}
            {isWorkspaceActive && (
              <div className="mt-4 pt-4 border-t border-[#E7E7E2] dark:border-[#374151]">
                <h5 className="font-semibold text-xs text-[#111827] dark:text-white mb-2">
                  Danh mục khả dụng Jira (Capabilities Directory)
                </h5>
                {capabilities?.sites && capabilities.sites.length > 0 ? (
                  <div className="space-y-3">
                    {capabilities.sites.map((site) => (
                      <div key={site.siteId} className="p-3 rounded-lg bg-white dark:bg-[#111827] border border-[#E7E7E2] dark:border-[#374151]">
                        <div className="font-medium text-[#111827] dark:text-white flex items-center justify-between">
                          <span>{site.name}</span>
                          <span className="text-[11px] text-neutral-400">{site.url}</span>
                        </div>
                        <div className="mt-2 text-neutral-600 dark:text-neutral-400">
                          <span className="text-[11px] font-medium text-[#111827] dark:text-white">Projects được phép: </span>
                          {site.projects.length > 0 ? (
                            <ul className="mt-1 list-disc list-inside space-y-0.5 pl-1">
                              {site.projects.map((proj) => (
                                <li key={proj.id} className="text-[11px]">
                                  {proj.key} — {proj.name}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <span className="text-[11px] text-neutral-400">Chưa có project nào được chọn.</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-neutral-500 italic text-xs">
                    Chưa có site hoặc project Jira nào được kích hoạt trong workspace này.
                  </p>
                )}
              </div>
            )}

            {/* ADMIN SECTION: MEMBERS, INVITES, SITES */}
            {isWorkspaceAdmin && (
              <div className="mt-5 pt-4 border-t border-[#E7E7E2] dark:border-[#374151] space-y-5">
                {/* 1. MEMBERS & DECISIONS */}
                <div>
                  <h5 className="font-semibold text-xs uppercase tracking-wider text-[#6B7280] dark:text-[#9CA3AF] mb-2">
                    Quản lý thành viên ({members.length})
                  </h5>
                  <div className="space-y-2">
                    {members.map((mem) => (
                      <div
                        key={mem.userId}
                        className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-2.5 rounded-lg bg-white dark:bg-[#111827] border border-[#E7E7E2] dark:border-[#374151] gap-2"
                      >
                        <div>
                          <span className="font-medium text-[#111827] dark:text-white">
                            {mem.userId}
                          </span>
                          <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300">
                            {mem.role}
                          </span>
                          <span className={`ml-2 text-[11px] font-medium ${
                            mem.status === 'active'
                              ? 'text-green-600'
                              : mem.status === 'pending'
                              ? 'text-amber-600'
                              : 'text-neutral-500'
                          }`}>
                            [{mem.status}]
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {mem.status === 'pending' && (
                            <>
                              <button
                                type="button"
                                aria-label={`Duyệt thành viên ${mem.userId}`}
                                onClick={() => handleMemberDecision(mem.userId, mem.version, 'approve')}
                                disabled={busy}
                                className={buttonPrimary}
                              >
                                Duyệt
                              </button>
                              <button
                                type="button"
                                aria-label={`Từ chối thành viên ${mem.userId}`}
                                onClick={() => handleMemberDecision(mem.userId, mem.version, 'reject')}
                                disabled={busy}
                                className={buttonSecondary}
                              >
                                Từ chối
                              </button>
                            </>
                          )}
                          {mem.status === 'active' && (
                            <button
                              type="button"
                              aria-label={`Gỡ thành viên ${mem.userId}`}
                              onClick={() => handleMemberDecision(mem.userId, mem.version, 'remove')}
                              disabled={busy}
                              className={buttonDanger}
                            >
                              Gỡ
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 2. INVITES */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h5 className="font-semibold text-xs uppercase tracking-wider text-[#6B7280] dark:text-[#9CA3AF]">
                      Mã mời tham gia ({invites.length})
                    </h5>
                    <button
                      type="button"
                      onClick={handleCreateInvite}
                      disabled={busy}
                      className={buttonSecondary}
                    >
                      Tạo mã mời
                    </button>
                  </div>

                  {createdInviteToken && (
                    <div className="mb-3 p-3 rounded-lg bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-300 border border-green-200 dark:border-green-800 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">Mã mời mới tạo (hết hạn trong 7 ngày):</span>
                        <button
                          type="button"
                          data-testid="jira-copy-invite-token"
                          onClick={() => {
                            if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                              void navigator.clipboard.writeText(createdInviteToken);
                            }
                            setCopiedInviteToken(true);
                            setTimeout(() => {
                              if (mounted.current) setCopiedInviteToken(false);
                            }, 2000);
                          }}
                          className="px-2 py-0.5 rounded bg-white dark:bg-neutral-800 text-green-800 dark:text-green-200 border border-green-300 text-[11px] font-semibold hover:bg-green-100 transition-colors cursor-pointer"
                        >
                          {copiedInviteToken ? '✓ Đã sao chép' : 'Sao chép mã mời'}
                        </button>
                      </div>
                      <code className="block mt-1 p-1 bg-white dark:bg-black/30 rounded border border-green-300 font-mono text-[11px]">
                        {createdInviteToken}
                      </code>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    {invites.map((inv) => (
                      <div
                        key={inv.id}
                        className="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-[#111827] border border-[#E7E7E2] dark:border-[#374151]"
                      >
                        <div>
                          <span className="font-mono text-[11px] text-neutral-600 dark:text-neutral-300">
                            {inv.id}
                          </span>
                          <span className="ml-2 text-[11px] text-neutral-400">
                            {inv.revokedAt ? '(Đã thu hồi)' : `(Hạn: ${new Date(inv.expiresAt).toLocaleDateString('vi-VN')})`}
                          </span>
                        </div>
                        {!inv.revokedAt && (
                          <button
                            type="button"
                            aria-label={`Thu hồi mã mời ${inv.id}`}
                            onClick={() => handleRevokeInvite(inv.id)}
                            disabled={busy}
                            className={buttonDanger}
                          >
                            Thu hồi
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* 3. SITES & PROJECTS */}
                <div>
                  <h5 className="font-semibold text-xs uppercase tracking-wider text-[#6B7280] dark:text-[#9CA3AF] mb-2">
                    Liên kết Jira Sites & Projects ({sites.length})
                  </h5>

                  {/* LINK NEW SITE DROPDOWN */}
                  {unlinkedSites.length > 0 && (
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mb-3">
                      <select
                        id="link-site-select"
                        defaultValue=""
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val) handleLinkSite(val);
                        }}
                        disabled={busy}
                        className="px-2.5 py-1.5 text-xs rounded-lg border border-[#E7E7E2] dark:border-[#374151] bg-white dark:bg-[#1F2937] text-[#111827] dark:text-white"
                      >
                        <option value="" disabled>
                          -- Chọn site Atlassian để liên kết --
                        </option>
                        {unlinkedSites.map((s) => (
                          <option key={s.cloudId} value={s.cloudId}>
                            {s.name} ({s.url})
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => {
                          const select = document.getElementById('link-site-select') as HTMLSelectElement;
                          if (select?.value) handleLinkSite(select.value);
                          else if (unlinkedSites[0]) handleLinkSite(unlinkedSites[0].cloudId);
                        }}
                        disabled={busy || unlinkedSites.length === 0}
                        className={buttonSecondary}
                      >
                        Liên kết site
                      </button>
                    </div>
                  )}

                  {/* SITES LIST */}
                  <div className="space-y-3">
                    {sites.map((site) => {
                      const configuredCapSite = capabilities?.sites?.find((cs) => cs.siteId === site.siteId);
                      const configuredProjectCount = configuredCapSite?.projects?.length ?? 0;
                      return (
                      <div
                        key={site.siteId}
                        className="p-3 rounded-lg bg-white dark:bg-[#111827] border border-[#E7E7E2] dark:border-[#374151]"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                          <div>
                            <span className="font-semibold text-[#111827] dark:text-white">
                              {site.name}
                            </span>
                            <span className="ml-2 text-[11px] text-neutral-400">({site.url})</span>
                            <span className={`ml-2 text-[11px] font-medium ${site.active ? 'text-green-600' : 'text-neutral-400'}`}>
                              [{site.active ? 'Đang hoạt động' : 'Tạm dừng'}]
                            </span>
                            {site.active && configuredProjectCount === 0 && (
                              <span className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                                Cần chọn ít nhất 1 Project
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              aria-label={`${site.active ? 'Vô hiệu hoá' : 'Kích hoạt'} site ${site.name}`}
                              onClick={() => handleToggleSiteActive(site)}
                              disabled={busy}
                              className={buttonSecondary}
                            >
                              {site.active ? 'Vô hiệu hoá' : 'Kích hoạt'}
                            </button>
                            <button
                              type="button"
                              aria-label={`Cấu hình projects site ${site.name}`}
                              onClick={() => handleOpenProjectConfig(site)}
                              disabled={busy}
                              className={buttonSecondary}
                            >
                              Cấu hình Projects
                            </button>
                          </div>
                        </div>

                        {/* PROJECT CONFIGURATION MODAL / PANEL */}
                        {configuringSite?.siteId === site.siteId && (
                          <div className="mt-3 pt-3 border-t border-[#E7E7E2] dark:border-[#374151]">
                            <h6 className="font-semibold text-xs text-[#111827] dark:text-white mb-2">
                              Chọn Projects cho {site.name}:
                            </h6>
                            {candidateProjects.length > 0 ? (
                              <div className="space-y-1.5 max-h-48 overflow-y-auto mb-3">
                                {candidateProjects.map((p) => {
                                  const checked = selectedProjectIds.includes(p.projectId);
                                  return (
                                    <label
                                      key={p.projectId}
                                      className="flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300 cursor-pointer"
                                    >
                                      <input
                                        type="checkbox"
                                        aria-label={p.name}
                                        checked={checked}
                                        onChange={() => {
                                          if (checked) {
                                            setSelectedProjectIds(
                                              selectedProjectIds.filter((id) => id !== p.projectId)
                                            );
                                          } else {
                                            setSelectedProjectIds([...selectedProjectIds, p.projectId]);
                                          }
                                        }}
                                        className="rounded border-gray-300 text-[#FF5701] focus:ring-[#FF5701]"
                                      />
                                      <span className="font-medium">{p.key}</span>
                                      <span>— {p.name}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            ) : (
                              <p className="text-neutral-400 text-[11px] mb-2">
                                Không tìm thấy project nào hoặc đang tải...
                              </p>
                            )}
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={handleSaveProjects}
                                disabled={busy}
                                className={buttonPrimary}
                              >
                                Lưu danh sách projects
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfiguringSite(null)}
                                className={buttonSecondary}
                              >
                                Đóng
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-neutral-500 italic text-xs">
            Bạn chưa thuộc Jira workspace nào. Hãy nhập mã mời để tham gia.
          </p>
        )}
      </div>

      {/* COCKPIT JIRA CONVERSATION CTA */}
      <div className="mt-6 pt-5 border-t border-[#E7E7E2] dark:border-[#374151]">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 rounded-xl bg-neutral-50 dark:bg-[#1F2937]/30 border border-[#E7E7E2] dark:border-[#374151]">
          <div>
            <h5 className="font-semibold text-xs text-[#111827] dark:text-white">
              Hội thoại Atlassian Jira trong Cockpit
            </h5>
            <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF] mt-0.5">
              {data?.connectionState === 'connected' && isWorkspaceActive && (capabilities?.sites?.length ?? 0) > 0
                ? 'Kết nối cá nhân, Jira workspace và danh mục site/project đã sẵn sàng để tạo kế hoạch trong Cockpit.'
                : 'Hội thoại Jira trong Cockpit cần kết nối cá nhân, thành viên workspace hoạt động và ít nhất một site đã cấu hình (chờ hoàn tất JIRA-08).'}
            </p>
          </div>
          {data?.connectionState === 'connected' && isWorkspaceActive && (capabilities?.sites?.length ?? 0) > 0 ? (
            <button
              id="jira-start-conversation"
              type="button"
              onClick={() => {
                syncWorkspaceToGlobalContext(selectedWorkspace);
                if (navigate) navigate('/');
                else window.location.assign('/');
              }}
              className={`${buttonPrimary} whitespace-nowrap`}
            >
              Bắt đầu hội thoại Jira
            </button>
          ) : (
            <button
              id="jira-start-conversation"
              type="button"
              disabled
              aria-disabled="true"
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-neutral-200 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400 cursor-not-allowed whitespace-nowrap shadow-none"
            >
              Bắt đầu hội thoại Jira (Chờ JIRA-08)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
