import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { User } from '../../types';
import { apiClient } from '../../services/api-client';
import { telegramSessionOwner, buildTelegramCallbackPath } from '../../services/telegram-connection';
import { CockpitDialog } from '../../components/CockpitDialog';
import { ServiceLogo } from '../../components/ServiceLogo';

const button =
  'px-4 py-2.5 rounded-xl text-xs font-semibold bg-[var(--planora-primary)] text-[var(--planora-on-primary)] hover:bg-[var(--planora-primary-hover)] disabled:opacity-50 transition-all shadow-xs focus-visible:outline-2 focus-visible:outline-[var(--planora-primary)]';
const secondary =
  'px-4 py-2.5 rounded-xl text-xs font-medium bg-[var(--planora-paper)] text-[var(--planora-text)] border border-[var(--planora-border-strong)] hover:bg-[var(--planora-surface-inset)] disabled:opacity-50 transition-colors';

export interface TelegramChatItem {
  chatId: string;
  title: string;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  username?: string;
  member: boolean;
}

export interface TelegramStatusData {
  status:
    | 'unconfigured'
    | 'not_connected'
    | 'reconnect_required'
    | 'needs_scope'
    | 'connected';
  botUsername?: string;
  telegramUserId?: string;
  username?: string;
  displayName?: string;
  chats: TelegramChatItem[];
  selectedChats: TelegramChatItem[];
}

export interface TelegramConnectionProps {
  user: User | null;
  refresh?: () => Promise<void>;
  navigate?: (path: string) => void;
  selected?: string | null;
  standalone?: boolean;
}

export function TelegramConnection({
  refresh,
  navigate,
  selected,
  standalone = true,
}: TelegramConnectionProps) {
  const [data, setData] = useState<TelegramStatusData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [editingScope, setEditingScope] = useState(false);
  const [candidateChats, setCandidateChats] = useState<TelegramChatItem[]>([]);
  const [selectedChatIds, setSelectedChatIds] = useState<string[]>([]);

  const mounted = useRef(false);
  const pending = useRef(false);
  const row = useRef<HTMLDivElement>(null);

  const fetchStatus = async () => {
    try {
      const res = await apiClient.getTelegramConnection();
      if (mounted.current) {
        setData(res);
        setCandidateChats(res.chats ?? []);
        setSelectedChatIds((res.selectedChats ?? []).map((c) => c.chatId));
      }
    } catch {
      if (mounted.current && standalone) {
        setData({ status: 'not_connected', chats: [], selectedChats: [] });
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
      if (window.location.hash === '#telegram') {
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

  const connect = async () => {
    if (pending.current) return;
    const owns = telegramSessionOwner();
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await apiClient.startTelegramConnection();
      if (mounted.current && owns()) {
        const callbackPath = buildTelegramCallbackPath(result);
        if (navigate) navigate(callbackPath);
        else window.location.assign(callbackPath);
      }
    } catch {
      if (mounted.current && owns()) {
        setError('Không thể bắt đầu kết nối Telegram. Hãy kiểm tra mạng và thử lại.');
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const disconnect = async () => {
    if (pending.current) return;
    const owns = telegramSessionOwner();
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await apiClient.disconnectTelegram();
      if (mounted.current && owns()) {
        setConfirm(false);
        setEditingScope(false);
        await fetchStatus();
        await refresh?.();
      }
    } catch {
      if (mounted.current && owns()) {
        setError('Không thể ngắt kết nối Telegram. Hãy kiểm tra mạng và thử lại.');
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const refreshChats = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await apiClient.getTelegramChats();
      if (mounted.current) {
        setCandidateChats(res.chats ?? []);
        if (res.selectedChatIds?.length && selectedChatIds.length === 0) {
          setSelectedChatIds(res.selectedChatIds);
        }
      }
    } catch {
      if (mounted.current) {
        setError('Không thể làm mới danh sách chat Telegram. Hãy thử lại.');
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const toggleChat = (chatId: string) => {
    if (selectedChatIds.includes(chatId)) {
      setSelectedChatIds(selectedChatIds.filter((id) => id !== chatId));
    } else {
      if (selectedChatIds.length >= 10) return;
      setSelectedChatIds([...selectedChatIds, chatId]);
    }
  };

  const saveScope = async () => {
    if (selectedChatIds.length === 0 || selectedChatIds.length > 10) return;
    setBusy(true);
    setError('');
    try {
      await apiClient.saveTelegramScope(selectedChatIds);
      setEditingScope(false);
      await fetchStatus();
      await refresh?.();
    } catch {
      setError('Không thể lưu danh sách chat Telegram. Hãy thử lại.');
    } finally {
      setBusy(false);
    }
  };

  if (!standalone && !data) {
    return null;
  }

  const status = data?.status ?? 'not_connected';
  const showScopeEditor = status === 'needs_scope' || editingScope;

  const rowContent = (
    <div
      ref={row}
      id="service-row-telegram"
      tabIndex={-1}
      className="bg-[var(--planora-paper)] border border-[var(--planora-divider)] rounded-xl p-4 sm:p-5 v3-space-y-3.5 shadow-xs focus-visible:ring-2 focus-visible:ring-[var(--planora-primary)] focus-visible:v3-outline-none"
    >
      <div className="flex items-start sm:items-center justify-between gap-3 flex-wrap">
        <h3 className="font-display font-semibold text-base text-[var(--planora-text)] flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[var(--planora-surface-inset)] border border-[var(--planora-divider)] flex items-center justify-center flex-shrink-0">
            <ServiceLogo service="telegram" className="w-5 h-5" />
          </div>
          <span>Telegram</span>
        </h3>
        {status === 'connected' && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" aria-hidden="true" />
            <span>Đã kết nối</span>
          </span>
        )}
      </div>

      <p className="text-xs text-[var(--planora-muted)] leading-relaxed">
        Kết nối 1 chạm với Telegram cá nhân hoặc nhóm làm việc của bạn. Chọn từ 1 đến 10 cuộc trò chuyện bằng tên hiển thị rõ ràng.
      </p>

      <div className="text-sm font-medium text-[var(--planora-text)] break-words">
        {status === 'connected' ? (
          <span>
            Đã kết nối {data?.username && <span className="text-[var(--planora-muted)] font-normal"> · @{data.username}</span>}
          </span>
        ) : status === 'needs_scope' ? (
          <span>
            Đã kết nối · Chưa chọn cuộc trò chuyện {data?.username && <span className="text-[var(--planora-muted)] font-normal"> · @{data.username}</span>}
          </span>
        ) : status === 'reconnect_required' ? (
          <span>
            Cần kết nối lại {data?.username && <span className="text-[var(--planora-muted)] font-normal"> · @{data.username}</span>}
          </span>
        ) : status === 'unconfigured' ? (
          <span className="text-[var(--planora-muted)] font-normal">Telegram Bot chưa được cấu hình trên máy chủ.</span>
        ) : (
          <span className="text-[var(--planora-muted)] font-normal">Chưa kết nối</span>
        )}
      </div>

      {status === 'connected' && data?.selectedChats && data.selectedChats.length > 0 && (
        <div className="v3-space-y-2 border-t border-[var(--planora-divider)] pt-3">
          <p className="text-xs text-[var(--planora-muted)]">Cuộc trò chuyện được phép dùng:</p>
          <div className="v3-space-y-1.5">
            {data.selectedChats.map((chat) => (
              <div
                key={chat.chatId}
                className="flex items-center justify-between p-2.5 bg-[var(--planora-surface-inset)] border border-[var(--planora-divider)] rounded-lg text-xs"
              >
                <span className="font-medium text-[var(--planora-text)]">{chat.title}</span>
                <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                  {chat.type === 'private' ? 'Chat cá nhân' : 'Nhóm Telegram'}
                </span>
              </div>
            ))}
          </div>
          {!editingScope && (
            <button
              id="telegram-edit-scope"
              type="button"
              className={secondary}
              onClick={() => {
                setCandidateChats(data.chats ?? data.selectedChats ?? []);
                setSelectedChatIds((data.selectedChats ?? []).map((c) => c.chatId));
                setEditingScope(true);
              }}
            >
              Chọn chat / nhóm
            </button>
          )}
        </div>
      )}

      {showScopeEditor && (
        <div
          id="telegram-scope"
          data-testid="telegram-scope"
          className="mt-4 p-4 border border-[var(--planora-divider)] rounded-xl bg-[var(--planora-surface-inset)] v3-space-y-3.5"
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--planora-muted)]">
              Chọn cuộc trò chuyện Telegram (1–10 chat)
            </h4>
            <button
              id="telegram-refresh-chats"
              type="button"
              disabled={busy}
              onClick={() => void refreshChats()}
              className={secondary}
            >
              Làm mới danh sách
            </button>
          </div>

          <div className="v3-space-y-1.5 max-h-48 overflow-y-auto">
            {candidateChats.map((chat) => {
              const checked = selectedChatIds.includes(chat.chatId);
              const disabled = !checked && selectedChatIds.length >= 10;
              return (
                <label
                  key={chat.chatId}
                  className={`flex items-center justify-between gap-2.5 p-2 rounded-lg text-xs cursor-pointer transition-colors ${
                    checked
                      ? 'bg-[var(--planora-paper)] border border-[var(--planora-primary)]'
                      : 'bg-[var(--planora-paper)] border border-[var(--planora-divider)] hover:border-[var(--planora-border-strong)]'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggleChat(chat.chatId)}
                      className="w-4 h-4 rounded border-[var(--planora-border-strong)] text-[var(--planora-primary)] focus:ring-[var(--planora-primary)]"
                    />
                    <span className="font-medium text-[var(--planora-text)] truncate">{chat.title}</span>
                  </div>
                  <span className="text-[11px] text-[var(--planora-muted)] flex-shrink-0">
                    {chat.type === 'private' ? 'Chat cá nhân' : 'Nhóm Telegram'}
                  </span>
                </label>
              );
            })}
            {candidateChats.length === 0 && (
              <p className="text-xs text-[var(--planora-muted)]">
                Chưa tìm thấy cuộc trò chuyện nào. Hãy bấm Start hoặc thêm bot vào nhóm rồi bấm Làm mới danh sách.
              </p>
            )}
          </div>

          {data?.botUsername && (
            <p className="text-xs text-[var(--planora-muted)]">
              Muốn nhận tin trong nhóm mới?{' '}
              <a
                href={`https://t.me/${encodeURIComponent(data.botUsername)}?startgroup=ati_scope`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--planora-primary)] font-semibold hover:underline"
              >
                + Thêm bot vào nhóm Telegram
              </a>
            </p>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              id="telegram-save-scope"
              type="button"
              className={button}
              disabled={selectedChatIds.length === 0 || selectedChatIds.length > 10 || busy}
              onClick={() => void saveScope()}
            >
              Lưu danh sách chat
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

      <div className="flex flex-wrap items-center gap-3 pt-1">
        {status === 'not_connected' || status === 'reconnect_required' || status === 'unconfigured' ? (
          <button
            id="telegram-connect"
            type="button"
            className={button}
            disabled={busy || status === 'unconfigured'}
            onClick={() => void connect()}
          >
            {status === 'reconnect_required' ? 'Kết nối lại Telegram' : 'Kết nối Telegram'}
          </button>
        ) : (
          <button
            id="telegram-disconnect"
            type="button"
            className={secondary}
            disabled={busy}
            onClick={() => setConfirm(true)}
          >
            Ngắt kết nối
          </button>
        )}
      </div>

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
        <section aria-labelledby="heading-telegram-service" className="mb-8">
          {rowContent}
        </section>
      ) : (
        rowContent
      )}
      {confirm &&
        createPortal(
          <CockpitDialog
            title="Ngắt kết nối Telegram?"
            returnFocusId="telegram-disconnect"
            onClose={() => {
              if (!busy) setConfirm(false);
            }}
          >
            <div className="p-5 v3-space-y-4">
              <p className="text-sm text-[var(--planora-text)]">
                Planora sẽ xoá liên kết Telegram cá nhân của bạn. Các lịch tự động gửi bản tin Telegram sẽ tạm dừng cho tới khi bạn kết nối lại.
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

export default TelegramConnection;
