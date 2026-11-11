import { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient } from '../../services/api-client';
import {
  notionSessionOwner,
  redirectToNotion,
  extractNotionDatabaseIdClient,
} from '../../services/notion-connection';
import type { User } from '../../types';
import { ServiceLogo } from '../../components/ServiceLogo';
import {
  CARD_CONTAINER_CLASS,
  PRIMARY_CONNECT_BTN,
  SECONDARY_ACTION_BTN,
  DANGER_GHOST_BTN,
  connectionBadgeClass,
} from './ServiceConnectionCard';

interface NotionDatabaseItem {
  id: string;
  title: string;
  url?: string;
}

interface NotionConnectionItem {
  id: string;
  status: 'connected' | 'needs_scope' | 'reconnect_required';
  authFailureCode?: string | null;
  workspaceId: string;
  workspaceName: string;
  workspaceIcon?: string | null;
  botId: string;
  ownerEmail?: string | null;
  ownerName?: string | null;
  isActive: boolean;
  selectedDatabases: NotionDatabaseItem[];
  lastHealthStatus?: string | null;
  lastHealthCheckedAt?: string | null;
}

interface NotionConnectionStatus {
  available: boolean;
  status: 'unconfigured' | 'not_connected' | 'reconnect_required' | 'needs_scope' | 'connected';
  authFailureCode?: string | null;
  activeConnectionId?: string;
  workspaceId?: string;
  workspaceName?: string;
  workspaceIcon?: string | null;
  botId?: string;
  ownerEmail?: string | null;
  ownerName?: string | null;
  selectedDatabases?: NotionDatabaseItem[];
  connections: NotionConnectionItem[];
}

function reconnectDiagnosticMessage(code?: string | null): string {
  switch (code) {
    case 'refresh_retryable':
      return 'Việc làm mới phiên tạm thời gián đoạn trước khi gửi tới Notion. Bạn có thể bấm Kiểm tra để thử khôi phục hoặc kết nối lại Notion.';
    case 'client_misconfigured':
      return 'Cấu hình ứng dụng OAuth Notion trên máy chủ không khớp với kết nối đã lưu. Vui lòng kiểm tra cấu hình hoặc kết nối lại.';
    case 'identity_mismatch':
      return 'Danh tính workspace hoặc bot Notion không còn khớp với phiên ủy quyền ban đầu. Vui lòng kết nối lại Notion.';
    case 'rotation_unknown':
      return 'Không xác nhận được trạng thái làm mới token từ Notion; hệ thống đã dừng tự động thử lại để an toàn. Vui lòng kết nối lại Notion.';
    case 'grant_rejected':
    case 'access_rejected':
    default:
      return 'Phiên ủy quyền Notion đã hết hiệu lực hoặc bị thu hồi. Vui lòng kết nối lại Notion.';
  }
}

function normalizeNotionStatus(raw: any): NotionConnectionStatus {
  const mapStatus = (s: unknown): NotionConnectionStatus['status'] => {
    if (s === 'disconnected' || s === 'not_connected') return 'not_connected';
    if (s === 'scope_required' || s === 'needs_scope') return 'needs_scope';
    if (s === 'connected' || s === 'reconnect_required' || s === 'unconfigured') return s;
    return 'not_connected';
  };
  const mapConnStatus = (s: unknown): NotionConnectionItem['status'] => {
    if (s === 'scope_required' || s === 'needs_scope') return 'needs_scope';
    if (s === 'reconnect_required') return 'reconnect_required';
    return 'connected';
  };
  const rawConnections = Array.isArray(raw?.connections) ? raw.connections : [];
  const connections: NotionConnectionItem[] = rawConnections.map((c: any) => ({
    ...c,
    id: String(c?.id ?? ''),
    status: mapConnStatus(c?.status),
    authFailureCode: typeof c?.authFailureCode === 'string' ? c.authFailureCode : null,
    workspaceId: String(c?.workspaceId ?? ''),
    workspaceName: String(c?.workspaceName ?? ''),
    botId: String(c?.botId ?? ''),
    isActive: Boolean(c?.isActive ?? c?.isDefault),
    selectedDatabases: Array.isArray(c?.selectedDatabases)
      ? c.selectedDatabases
      : Array.isArray(c?.databases)
        ? c.databases
        : [],
  }));
  const activeConn =
    raw?.activeConnection ??
    connections.find((c) => c.isActive) ??
    connections[0] ??
    null;
  const status = mapStatus(raw?.status);
  return {
    available: raw?.available !== undefined ? Boolean(raw.available) : status !== 'unconfigured',
    status,
    authFailureCode:
      typeof raw?.authFailureCode === 'string'
        ? raw.authFailureCode
        : typeof activeConn?.authFailureCode === 'string'
          ? activeConn.authFailureCode
          : null,
    activeConnectionId: raw?.activeConnectionId ?? activeConn?.id,
    workspaceId: raw?.workspaceId ?? activeConn?.workspaceId,
    workspaceName: raw?.workspaceName ?? activeConn?.workspaceName,
    workspaceIcon: raw?.workspaceIcon ?? activeConn?.workspaceIcon ?? null,
    botId: raw?.botId ?? activeConn?.botId,
    ownerEmail: raw?.ownerEmail ?? activeConn?.ownerEmail ?? null,
    ownerName: raw?.ownerName ?? activeConn?.ownerName ?? null,
    selectedDatabases: Array.isArray(raw?.selectedDatabases)
      ? raw.selectedDatabases
      : Array.isArray(activeConn?.selectedDatabases)
        ? activeConn.selectedDatabases
        : Array.isArray(raw?.databases)
          ? raw.databases
          : [],
    connections,
  };
}

export function NotionConnection({
  selected,
  refresh,
  standalone = true,
}: {
  user?: User | null;
  selected?: boolean;
  refresh?: () => Promise<unknown> | void;
  standalone?: boolean;
}) {
  const [data, setData] = useState<NotionConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revokeUnconfirmed, setRevokeUnconfirmed] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  // Scope picker states
  const [editingScope, setEditingScope] = useState(false);
  const [candidateDatabases, setCandidateDatabases] = useState<NotionDatabaseItem[]>([]);
  const [selectedDatabases, setSelectedDatabases] = useState<Map<string, NotionDatabaseItem>>(new Map());
  const [loadingScope, setLoadingScope] = useState(false);
  const [savingScope, setSavingScope] = useState(false);
  const [dbFilter, setDbFilter] = useState('');
  const [pasteInput, setPasteInput] = useState('');
  const [pasteError, setPasteError] = useState('');

  const ownerRef = useRef(notionSessionOwner());
  ownerRef.current = notionSessionOwner();

  const fetchStatus = useCallback(async () => {
    const startOwner = ownerRef.current;
    try {
      const res = await apiClient.getNotionConnection();
      if (ownerRef.current !== startOwner) return;
      setData(normalizeNotionStatus(res));
    } catch {
      if (ownerRef.current !== startOwner) return;
      if (standalone) {
        setData({ available: false, status: 'not_connected', connections: [] });
      }
    } finally {
      if (ownerRef.current === startOwner) setLoading(false);
    }
  }, [standalone]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const activeConnectionId =
    data?.activeConnectionId ||
    data?.connections?.find((c) => c.isActive)?.id ||
    data?.connections?.[0]?.id;

  const loadCandidates = useCallback(
    async (connId?: string, initialSelected?: NotionDatabaseItem[]) => {
      const targetId = connId || activeConnectionId;
      if (!targetId) return;
      const startOwner = ownerRef.current;
      setLoadingScope(true);
      setError('');
      try {
        const res = await apiClient.getNotionDatabases(targetId);
        if (ownerRef.current !== startOwner) return;
        const dbList = res.databases ?? [];
        const preselected = initialSelected ?? data?.selectedDatabases ?? [];
        const mergedCandidates = [...dbList];
        const map = new Map<string, NotionDatabaseItem>();
        for (const item of preselected) {
          map.set(item.id, item);
          if (!mergedCandidates.some((c) => c.id === item.id)) {
            mergedCandidates.push(item);
          }
        }
        setCandidateDatabases(mergedCandidates);
        setSelectedDatabases(map);
      } catch (err: any) {
        if (ownerRef.current !== startOwner) return;
        setError(err?.message || 'Không tải được danh sách database từ Notion.');
      } finally {
        if (ownerRef.current === startOwner) setLoadingScope(false);
      }
    },
    [activeConnectionId, data?.selectedDatabases]
  );

  useEffect(() => {
    if (data?.status === 'needs_scope' && activeConnectionId) {
      setEditingScope(true);
      void loadCandidates(activeConnectionId, data.selectedDatabases ?? []);
    } else if (data?.status === 'connected') {
      setEditingScope(false);
    }
  }, [data?.status, activeConnectionId, loadCandidates, data?.selectedDatabases]);

  const startConnect = async () => {
    const startOwner = ownerRef.current;
    setBusy(true);
    setError('');
    setNotice('');
    setRevokeUnconfirmed(false);
    try {
      const { url } = await apiClient.startNotionConnection();
      if (ownerRef.current !== startOwner) return;
      redirectToNotion(url);
    } catch (err: any) {
      if (ownerRef.current !== startOwner) return;
      setError(err?.message || 'Không thể bắt đầu kết nối Notion.');
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (!activeConnectionId) return;
    const startOwner = ownerRef.current;
    setBusy(true);
    setError('');
    setNotice('');
    setRevokeUnconfirmed(false);
    try {
      const res = await apiClient.disconnectNotionConnection(activeConnectionId);
      if (ownerRef.current !== startOwner) return;
      setConfirmDisconnect(false);
      setEditingScope(false);
      await fetchStatus();
      await refresh?.();
      if ((res as any)?.providerRevocation === 'confirmed') {
        setRevokeUnconfirmed(false);
        setNotice('Đã ngắt kết nối Notion và thu hồi quyền truy cập từ Notion.');
      } else {
        setRevokeUnconfirmed(true);
        setNotice('Đã ngắt kết nối Notion trên hệ thống.');
      }
    } catch (err: any) {
      if (ownerRef.current !== startOwner) return;
      setError(err?.message || 'Không thể ngắt kết nối Notion.');
    } finally {
      if (ownerRef.current === startOwner) setBusy(false);
    }
  };

  const handleSwitchWorkspace = async (connectionId: string) => {
    if (!connectionId || connectionId === activeConnectionId) return;
    const startOwner = ownerRef.current;
    setBusy(true);
    setError('');
    setNotice('');
    setRevokeUnconfirmed(false);
    try {
      const res = await apiClient.activateNotionConnection(connectionId);
      if (ownerRef.current !== startOwner) return;
      await fetchStatus();
      await refresh?.();
      setNotice(`Đã chuyển sang workspace ${res.workspaceName || 'Notion'}.`);
    } catch (err: any) {
      if (ownerRef.current !== startOwner) return;
      setError(err?.message || 'Không thể chuyển workspace Notion.');
    } finally {
      if (ownerRef.current === startOwner) setBusy(false);
    }
  };

  const handleCheckHealth = async () => {
    if (!activeConnectionId) return;
    const startOwner = ownerRef.current;
    setBusy(true);
    setError('');
    setNotice('');
    setRevokeUnconfirmed(false);
    try {
      const res = await apiClient.checkNotionConnection(activeConnectionId);
      if (ownerRef.current !== startOwner) return;
      if (
        res.status === 'healthy' ||
        (res as any).status === 'connected' ||
        (res as any).healthStatus === 'healthy'
      ) {
        setNotice(`Kết nối Notion hoạt động tốt (${res.latencyMs ?? 0}ms).`);
      } else {
        setError(res.message || 'Kết nối Notion không phản hồi.');
      }
      await fetchStatus();
    } catch (err: any) {
      if (ownerRef.current !== startOwner) return;
      setError(err?.message || 'Không thể kiểm tra kết nối Notion.');
      await fetchStatus();
    } finally {
      if (ownerRef.current === startOwner) setBusy(false);
    }
  };

  const toggleDatabase = (db: NotionDatabaseItem) => {
    setSelectedDatabases((prev) => {
      const next = new Map(prev);
      if (next.has(db.id)) {
        next.delete(db.id);
      } else if (next.size < 10) {
        next.set(db.id, db);
      }
      return next;
    });
  };

  const handleAddPastedDatabase = () => {
    setPasteError('');
    const extractedId = extractNotionDatabaseIdClient(pasteInput);
    if (!extractedId) {
      setPasteError('Link hoặc ID Database Notion không hợp lệ (cần UUID 32 ký tự hex).');
      return;
    }
    if (selectedDatabases.size >= 10 && !selectedDatabases.has(extractedId)) {
      setPasteError('Chỉ được chọn tối đa 10 database.');
      return;
    }
    const existing = candidateDatabases.find((d) => d.id === extractedId);
    const item: NotionDatabaseItem = existing ?? {
      id: extractedId,
      title: `Database ${extractedId.slice(0, 8)}`,
      ...(pasteInput.trim().startsWith('http') ? { url: pasteInput.trim() } : {}),
    };
    if (!existing) {
      setCandidateDatabases((prev) => [...prev, item]);
    }
    setSelectedDatabases((prev) => {
      const next = new Map(prev);
      next.set(extractedId, item);
      return next;
    });
    setPasteInput('');
  };

  const handleSaveScope = async () => {
    if (!activeConnectionId || selectedDatabases.size < 1 || selectedDatabases.size > 10) return;
    const startOwner = ownerRef.current;
    setSavingScope(true);
    setError('');
    setNotice('');
    try {
      await apiClient.saveNotionScope(activeConnectionId, Array.from(selectedDatabases.values()));
      if (ownerRef.current !== startOwner) return;
      setEditingScope(false);
      await fetchStatus();
      await refresh?.();
      setNotice('Đã lưu phạm vi database Notion.');
    } catch (err: any) {
      if (ownerRef.current !== startOwner) return;
      setError(err?.message || 'Không thể lưu phạm vi database Notion.');
    } finally {
      if (ownerRef.current === startOwner) setSavingScope(false);
    }
  };

  if (loading) return null;
  if (!standalone && (!data || data.status === 'unconfigured')) return null;

  const status = data?.status ?? 'not_connected';
  const authFailureCode = data?.authFailureCode ?? null;
  const workspaceName = data?.workspaceName;
  const databases = data?.selectedDatabases ?? [];
  const connections = data?.connections ?? [];

  const statusBadge = () => {
    switch (status) {
      case 'connected':
        return {
          text: `Đã kết nối${workspaceName ? ` · ${workspaceName}` : ''}`,
          cls: connectionBadgeClass('connected'),
        };
      case 'needs_scope':
        return {
          text: `Cần chọn database${workspaceName ? ` · ${workspaceName}` : ''}`,
          cls: connectionBadgeClass('warning'),
        };
      case 'reconnect_required':
        return {
          text: 'Cần kết nối lại',
          cls: connectionBadgeClass('error'),
        };
      case 'unconfigured':
        return {
          text: 'Chưa bật trên máy chủ',
          cls: connectionBadgeClass('neutral'),
        };
      default:
        return {
          text: 'Chưa kết nối',
          cls: connectionBadgeClass('neutral'),
        };
    }
  };

  const badge = statusBadge();
  const normalizedFilter = dbFilter.trim().toLowerCase();
  const visibleCandidates = normalizedFilter
    ? candidateDatabases.filter(
        (d) =>
          d.title.toLowerCase().includes(normalizedFilter) ||
          d.id.toLowerCase().includes(normalizedFilter)
      )
    : candidateDatabases;

  const content = (
    <div
      id="service-row-notion"
      className={`${CARD_CONTAINER_CLASS} ${selected ? 'border-[#FF5701] ring-2 ring-[#FF5701]/20' : ''}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="font-sans font-semibold text-base text-[#111827] dark:text-white flex items-center gap-3">
              <ServiceLogo service="notion" className="w-6 h-6" />
              Notion
            </h3>
            <span className={badge.cls}>
              {badge.text}
            </span>
          </div>
          <p className="mt-2 text-xs text-[#6B7280] dark:text-[#9CA3AF]">
            Liên kết tài khoản Notion để tra cứu dữ liệu, tạo hoặc cập nhật trang và tổng hợp báo cáo tự động trong đúng các bảng dữ liệu bạn cho phép.
          </p>

          {connections.length > 1 && (
            <div className="mt-2.5 flex items-center gap-2">
              <label
                htmlFor="notion-workspace-select"
                className="text-xs font-medium text-[#374151] dark:text-[#D1D5DB]"
              >
                Workspace đang dùng:
              </label>
              <select
                id="notion-workspace-select"
                aria-label="Workspace đang dùng"
                value={activeConnectionId ?? ''}
                disabled={busy}
                onChange={(e) => void handleSwitchWorkspace(e.target.value)}
                className="rounded-lg border border-[#E7E7E2] dark:border-[#374151] bg-white dark:bg-[#1F2937] px-2.5 py-1.5 text-xs text-[#111827] dark:text-white focus:border-[#FF5701] focus:outline-none"
              >
                {connections.map((conn) => (
                  <option key={conn.id} value={conn.id}>
                    {conn.workspaceName} ({conn.selectedDatabases.length} database)
                  </option>
                ))}
              </select>
            </div>
          )}

          {databases.length > 0 && status === 'connected' && !editingScope && (
            <div className="mt-2 space-y-1.5">
              <div
                data-testid="notion-connected-databases"
                className="flex flex-wrap items-center gap-1.5 text-xs text-[#6B7280] dark:text-[#9CA3AF]"
              >
                <span>Database được phép:</span>
                {databases.map((d) =>
                  d.url ? (
                    <a
                      key={d.id}
                      href={d.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-full border border-[#E7E7E2] dark:border-[#374151] bg-[#F8F8F6] dark:bg-[#1F2937] px-2.5 py-0.5 text-xs font-medium text-[#111827] dark:text-white hover:border-[#FF5701]"
                    >
                      <span>{d.title}</span>
                      <span aria-hidden="true" className="text-xs text-neutral-500">
                        ↗
                      </span>
                    </a>
                  ) : (
                    <span
                      key={d.id}
                      className="inline-flex items-center gap-1 rounded-full border border-[#E7E7E2] dark:border-[#374151] bg-[#F8F8F6] dark:bg-[#1F2937] px-2.5 py-0.5 text-xs font-medium text-[#111827] dark:text-white"
                    >
                      {d.title}
                    </span>
                  )
                )}
              </div>
            </div>
          )}

          {status === 'reconnect_required' && (
            <p
              data-testid="notion-auth-diagnostic"
              className="mt-2 text-xs text-amber-700 dark:text-amber-400"
            >
              {reconnectDiagnosticMessage(authFailureCode)}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {status === 'reconnect_required' &&
            authFailureCode === 'refresh_retryable' &&
            activeConnectionId && (
              <button
                id="notion-check"
                type="button"
                disabled={busy}
                onClick={handleCheckHealth}
                className={SECONDARY_ACTION_BTN}
              >
                Kiểm tra
              </button>
            )}
          {(status === 'not_connected' || status === 'reconnect_required') && (
            <button
              id="notion-connect"
              type="button"
              disabled={busy}
              onClick={startConnect}
              className={PRIMARY_CONNECT_BTN}
            >
              {busy
                ? 'Đang mở Notion...'
                : status === 'reconnect_required'
                  ? 'Kết nối lại Notion'
                  : 'Kết nối Notion'}
            </button>
          )}

          {(status === 'connected' || status === 'needs_scope') && (
            <>
              {status === 'connected' && !editingScope && (
                <button
                  id="notion-edit-scope"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setEditingScope(true);
                    void loadCandidates(activeConnectionId, databases);
                  }}
                  className={SECONDARY_ACTION_BTN}
                >
                  Đổi database
                </button>
              )}
              {status === 'connected' && !editingScope && (
                <button
                  id="notion-check"
                  type="button"
                  disabled={busy}
                  onClick={handleCheckHealth}
                  className={SECONDARY_ACTION_BTN}
                >
                  Kiểm tra
                </button>
              )}
              {!confirmDisconnect ? (
                <button
                  id="notion-disconnect"
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmDisconnect(true)}
                  className={DANGER_GHOST_BTN}
                >
                  Ngắt kết nối
                </button>
              ) : (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleDisconnect}
                    className="rounded-xl bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    Xác nhận ngắt
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmDisconnect(false)}
                    className={SECONDARY_ACTION_BTN}
                  >
                    Huỷ
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {editingScope && (
        <div
          id="notion-scope"
          data-testid="notion-scope"
          className="mt-4 rounded-xl border border-[#E7E7E2] dark:border-[#374151] bg-[#F8F8F6] dark:bg-[#1F2937]/50 p-4 space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-[#111827] dark:text-white">
              Chọn phạm vi Database Notion (1–10 database)
            </p>
            <span
              data-testid="notion-scope-counter"
              className="rounded-md border border-[#E7E7E2] dark:border-[#374151] bg-white dark:bg-[#111827] px-2 py-0.5 text-xs font-medium text-[#374151] dark:text-[#D1D5DB]"
            >
              Đã chọn {selectedDatabases.size}/10
            </span>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="notion-paste-db-input"
              type="text"
              value={pasteInput}
              onChange={(e) => setPasteInput(e.target.value)}
              placeholder="Dán link hoặc ID Database Notion (VD: https://notion.so/...)"
              aria-label="Dán link hoặc ID Database Notion"
              className="flex-1 rounded-lg border border-[#E7E7E2] dark:border-[#374151] bg-white dark:bg-[#111827] px-3 py-1.5 text-xs text-[#111827] dark:text-white placeholder:text-neutral-400 focus:border-[#FF5701] focus:outline-none"
            />
            <button
              id="notion-add-db-btn"
              type="button"
              onClick={handleAddPastedDatabase}
              className={SECONDARY_ACTION_BTN}
            >
              Thêm database
            </button>
          </div>
          {pasteError && <p className="text-xs text-red-600">{pasteError}</p>}

          {loadingScope ? (
            <p className="text-xs text-neutral-500">Đang tải danh sách database từ Notion...</p>
          ) : (
            <div className="space-y-2">
              {candidateDatabases.length > 4 && (
                <input
                  type="search"
                  value={dbFilter}
                  onChange={(e) => setDbFilter(e.target.value)}
                  placeholder="Tìm nhanh database..."
                  aria-label="Tìm nhanh database"
                  className="w-full rounded-lg border border-[#E7E7E2] dark:border-[#374151] bg-white dark:bg-[#111827] px-3 py-1.5 text-xs text-[#111827] dark:text-white placeholder:text-neutral-400 focus:border-[#FF5701] focus:outline-none"
                />
              )}

              {visibleCandidates.length === 0 ? (
                <p className="text-xs text-neutral-500">
                  Chưa tìm thấy database nào. Hãy chia sẻ database với kết nối trong Notion hoặc dán trực tiếp link/ID ở trên.
                </p>
              ) : (
                <div className="max-h-48 overflow-y-auto space-y-1.5 rounded-lg border border-[#E7E7E2] dark:border-[#374151] bg-white dark:bg-[#111827] p-2">
                  {visibleCandidates.map((db) => {
                    const checked = selectedDatabases.has(db.id);
                    const disableNew = !checked && selectedDatabases.size >= 10;
                    return (
                      <label
                        key={db.id}
                        className={`flex items-center justify-between gap-2 text-xs ${
                          disableNew
                            ? 'text-neutral-400 cursor-not-allowed'
                            : 'text-[#111827] dark:text-neutral-200 cursor-pointer'
                        }`}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <input
                            type="checkbox"
                            aria-label={db.title}
                            checked={checked}
                            disabled={disableNew || savingScope}
                            onChange={() => toggleDatabase(db)}
                          />
                          <span className="truncate font-medium">{db.title}</span>
                        </span>
                        <span className="shrink-0 font-mono text-xs text-neutral-400">
                          {db.id.slice(0, 8)}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              id="notion-save-scope"
              type="button"
              disabled={savingScope || selectedDatabases.size < 1 || selectedDatabases.size > 10}
              onClick={handleSaveScope}
              className={PRIMARY_CONNECT_BTN}
            >
              {savingScope ? 'Đang lưu...' : 'Lưu phạm vi database'}
            </button>
            {status === 'connected' && (
              <button
                type="button"
                disabled={savingScope}
                onClick={() => setEditingScope(false)}
                className={SECONDARY_ACTION_BTN}
              >
                Đóng
              </button>
            )}
          </div>
        </div>
      )}

      {notice && <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">{notice}</p>}
      {revokeUnconfirmed && (
        <p
          data-testid="notion-revoke-unconfirmed"
          className="mt-2 rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-300"
        >
          Đã xoá thông tin ủy quyền tại hệ thống, nhưng chưa thể xác nhận thu hồi trực tiếp với Notion. Để thu hồi hoàn toàn, hãy mở Notion → Settings &amp; members → Connections và gỡ tích hợp.
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );

  if (!standalone) return content;

  return (
    <section id="notion" aria-labelledby="heading-notion" className="space-y-3">
      {content}
    </section>
  );
}
