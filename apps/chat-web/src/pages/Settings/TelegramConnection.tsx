import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { User } from '../../types';
import { apiClient } from '../../services/api-client';
import { telegramSessionOwner, buildTelegramCallbackPath } from '../../services/telegram-connection';
import { CockpitDialog } from '../../components/CockpitDialog';
import { ServiceLogo } from '../../components/ServiceLogo';

const button =
  'px-4 py-2 rounded-xl text-xs font-semibold bg-[#FF5701] text-white hover:bg-[#E04C00] disabled:opacity-50 transition-colors shadow-sm';
const secondary =
  'px-4 py-2 rounded-xl text-xs font-medium bg-white text-[#111827] border border-[#E7E7E2] hover:bg-neutral-50 disabled:opacity-50 transition-colors';

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
      className="bg-white border border-[#E7E7E2] rounded-xl p-4 sm:p-5 v3-space-y-4 focus-visible:ring-2 focus-visible:ring-[#FF5701] focus-visible:v3-outline-none"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display font-semibold text-base text-[#111827] flex items-center gap-3">
          <ServiceLogo service="telegram" className="w-6 h-6" />
          Telegram
        </h3>
        {status === 'connected' && (
          <span className="text-xs font-semibold px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md">
            Đã kết nối
          </span>
        )}
      </div>

      <p className="text-xs text-[#6B7280]">
        Kết nối 1 chạm với Telegram cá nhân hoặc nhóm làm việc của bạn. Chọn từ 1 đến 10 cuộc trò chuyện bằng tên hiển thị rõ ràng.
      </p>

      <div className="text-sm text-[#111827] break-words">
        {status === 'connected' ? (
          <span>
            Đã kết nối {data?.username && <>· @{data.username}</>}
          </span>
        ) : status === 'needs_scope' ? (
          <span>
            Đã kết nối · Chưa chọn cuộc trò chuyện {data?.username && <>· @{data.username}</>}
          </span>
        ) : status === 'reconnect_required' ? (
          <span>
            Cần kết nối lại {data?.username && <>· @{data.username}</>}
          </span>
        ) : status === 'unconfigured' ? (
          <span className="text-[#6B7280]">Telegram Bot chưa được cấu hình trên máy chủ.</span>
        ) : (
          <span className="text-[#6B7280]">Chưa kết nối</span>
        )}
      </div>

      {status === 'connected' && data?.selectedChats && data.selectedChats.length > 0 && (
        <div className="v3-space-y-2 border-t border-[#F3F4F6] pt-3">
          <p className="text-xs text-[#6B7280]">Cuộc trò chuyện được phép dùng:</p>
          <div className="v3-space-y-1.5">
            {data.selectedChats.map((chat) => (
              <div
                key={chat.chatId}
                className="flex items-center justify-between p-2.5 bg-neutral-50 rounded-lg text-xs"
              >
                <span className="font-medium text-[#111827]">{chat.title}</span>
                <span className="text-emerald-700 font-medium">
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
          className="mt-4 p-4 border border-[#E7E7E2] rounded-xl bg-[#F8F8F6] v3-space-y-3"
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[#6B7280]">
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
                  className={`flex items-center justify-between gap-2 p-2 rounded-lg text-xs cursor-pointer ${
                    checked
                      ? 'bg-[#F8F8F6] border border-[#111827]/30'
                      : 'bg-white border border-[#E7E7E2]'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggleChat(chat.chatId)}
                      className="rounded text-[#111827] focus:ring-[#111827]"
                    />
                    <span className="font-medium text-[#111827] truncate">{chat.title}</span>
                  </div>
                  <span className="text-[11px] text-[#6B7280] flex-shrink-0">
                    {chat.type === 'private' ? 'Chat cá nhân' : 'Nhóm Telegram'}
                  </span>
                </label>
              );
            })}
            {candidateChats.length === 0 && (
              <p className="text-xs text-[#6B7280]">
                Chưa tìm thấy cuộc trò chuyện nào. Hãy bấm Start hoặc thêm bot vào nhóm rồi bấm Làm mới danh sách.
              </p>
            )}
          </div>

          {data?.botUsername && (
            <p className="text-xs text-[#6B7280]">
              Muốn nhận tin trong nhóm mới?{' '}
              <a
                href={`https://t.me/${encodeURIComponent(data.botUsername)}?startgroup=ati_scope`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#FF5701] font-medium hover:underline"
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

      <div className="flex flex-wrap items-center gap-3 pt-2">
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
              <p className="text-sm">
                ATI sẽ xoá liên kết Telegram cá nhân của bạn. Các lịch tự động gửi bản tin Telegram sẽ tạm dừng cho tới khi bạn kết nối lại.
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
