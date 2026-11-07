import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '../../store/chat-store';
import { apiClient } from '../../services/api-client';
import { userErrorMessage } from '../../services/user-error';
import { formatConversationTime } from '../../services/conversation-time';
import { getActiveWorkspaceId, subscribeWorkspace } from '../../services/workspace-storage';
import { loadConversationHistory } from '../../hooks/use-conversation-history';

export interface SidebarHistoryProps {
  prototype?: boolean;
  planora?: boolean;
  currentConversationId: string | null;
  onSelectConversation?: (id: string) => void;
  onCloseMobileSidebar?: () => void;
}

export function SidebarHistory({
  currentConversationId,
  onSelectConversation,
  onCloseMobileSidebar,
  prototype = false,
  planora = false,
}: SidebarHistoryProps) {
  const conversations = useChatStore(state => state.conversations);
  const firstConfirmedUserMessage = useChatStore(
    state => state.messages.find(message => message.role === 'user' && message.status === 'sent')?.id
  );
  const [workspaceId, setWorkspaceId] = useState(getActiveWorkspaceId());
  const [search, setSearch] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);

  const request = useRef(0);
  const busy = useRef(false);
  const selection = useRef(0);
  const prevWorkspaceId = useRef(workspaceId);

  // Subscribe to workspace changes
  useEffect(() => subscribeWorkspace(() => setWorkspaceId(getActiveWorkspaceId())), []);

  // Workspace change guard: clear stale conversations immediately
  useEffect(() => {
    if (prevWorkspaceId.current !== workspaceId) {
      prevWorkspaceId.current = workspaceId;
      useChatStore.getState().setConversations([]);
    }
  }, [workspaceId]);

  const load = async (cursor?: string, generation = request.current) => {
    busy.current = true;
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiClient.getConversations({ search, cursor });
      if (generation !== request.current) return;
      const store = useChatStore.getState();
      const rows = cursor ? [...store.conversations, ...data.conversations] : data.conversations;
      store.setConversations([...new Map(rows.map(row => [row.id, row])).values()]);
      setNextCursor(data.nextCursor || null);
    } catch (reason) {
      if (generation === request.current) setError(userErrorMessage(reason));
    } finally {
      if (generation === request.current) {
        busy.current = false;
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    const generation = ++request.current;
    setNextCursor(null);
    void load(undefined, generation);
    return () => {
      request.current++;
      selection.current++;
    };
  }, [currentConversationId, search, firstConfirmedUserMessage, workspaceId]);

  const select = async (id: string) => {
    onCloseMobileSidebar?.();
    if (id === currentConversationId) return;
    if (onSelectConversation) {
      onSelectConversation(id);
      return;
    }
    const selected = ++selection.current;
    const store = useChatStore.getState();
    store.reset({ preservePlanning: true });
    store.setConversationId(id);
    try {
      await loadConversationHistory(
        id,
        () => selection.current === selected && useChatStore.getState().conversationId === id
      );
    } catch (reason) {
      if (selection.current === selected) {
        store.reset({ preservePlanning: true });
        setError(userErrorMessage(reason));
      }
    }
  };

  const rename = async (id: string) => {
    if (saving) return;
    const trimmed = title.trim();
    if (!trimmed || Array.from(trimmed).length > 60) {
      setError('Tiêu đề cần từ 1 đến 60 ký tự.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const data = await apiClient.renameConversation(id, trimmed);
      const store = useChatStore.getState();
      store.setConversations(store.conversations.map(row => (row.id === id ? data.conversation : row)));
      setEditing(null);
    } catch (reason) {
      setError(userErrorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-6 flex-1 flex flex-col min-h-0">
      <span className="font-serif text-xs font-semibold text-[var(--planora-muted)] tracking-wider uppercase px-1 shrink-0">
        Lịch sử hội thoại
      </span>
      <input
        type="search"
        aria-label={planora ? 'Tìm hội thoại' : 'Tìm hội thoại theo tiêu đề'}
        value={search}
        onChange={event => setSearch(event.target.value)}
        className="mt-2 w-full border border-[var(--planora-border-strong)] rounded-lg p-2 text-xs bg-[var(--planora-paper)] text-[var(--planora-text)] placeholder-[var(--planora-muted)] focus:outline-none focus:border-[var(--planora-primary)]"
        placeholder="Tìm hội thoại..."
      />
      {error && <p role="alert" className="text-xs text-[var(--planora-error-text)] py-2">{error}</p>}
      <div
        role="region"
        aria-label="Danh sách hội thoại"
        className="mt-2 flex-1 overflow-y-auto flex flex-col gap-1 pr-1"
        onScroll={event => {
          const area = event.currentTarget;
          if (area.scrollHeight - area.scrollTop - area.clientHeight < 100 && nextCursor && !busy.current) {
            void load(nextCursor);
          }
        }}
      >
        {conversations.map(conv => {
          const label = conv.title || 'Hội thoại mới';
          const time = formatConversationTime(conv.updatedAt || conv.updated_at || conv.created_at);
          const isSelected = conv.id === currentConversationId;

          return (
            <div
              key={conv.id}
              className={
                prototype
                  ? `p-3 rounded-xl border transition-colors flex items-start gap-1 ${
                      isSelected
                        ? 'bg-[var(--planora-surface-inset)] border-[var(--planora-border-strong)] border-l-4 border-l-[var(--planora-primary)]'
                        : 'bg-[var(--planora-paper)] hover:bg-[var(--planora-surface-inset)] border-[var(--planora-divider)]'
                    }`
                  : `rounded-xl p-2.5 text-xs font-medium flex gap-1 items-center transition ${
                      isSelected
                        ? 'bg-[var(--planora-surface-inset)] border border-[var(--planora-border-strong)] shadow-2xs border-l-4 border-l-[var(--planora-primary)] text-[var(--planora-text)] font-semibold'
                        : 'hover:bg-[var(--planora-surface-inset)] border border-transparent hover:border-[var(--planora-divider)] text-[var(--planora-text)]'
                    }`
              }
            >
              {editing === conv.id ? (
                <form
                  className="flex-1 min-w-0"
                  onSubmit={event => {
                    event.preventDefault();
                    void rename(conv.id);
                  }}
                >
                  <input
                    autoFocus
                    aria-label="Tiêu đề hội thoại"
                    value={title}
                    onChange={event => setTitle(event.target.value)}
                    className="w-full border border-[var(--planora-primary)] rounded p-1 text-xs bg-[var(--planora-paper)] text-[var(--planora-text)] focus:outline-none"
                  />
                  <div className="flex gap-2 mt-1">
                    <button
                      type="submit"
                      disabled={saving}
                      aria-label="Lưu tên hội thoại"
                      className="text-xs font-semibold text-[var(--planora-primary)] hover:text-[var(--planora-primary-hover)] cursor-pointer"
                    >
                      Lưu
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => setEditing(null)}
                      className="text-xs font-medium text-[var(--planora-muted)] hover:text-[var(--planora-text)] cursor-pointer"
                    >
                      Hủy đổi tên
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    aria-label={planora ? `Hội thoại: ${label}` : prototype ? label : undefined}
                    onClick={() => void select(conv.id)}
                    className={
                      prototype
                        ? 'min-w-0 flex-1 text-left cursor-pointer'
                        : 'min-w-0 flex-1 text-left cursor-pointer flex items-center'
                    }
                  >
                    {prototype ? (
                      <>
                        <div
                          className={`flex justify-between items-center text-[11px] ${
                            isSelected
                              ? 'text-[var(--planora-primary)] font-semibold'
                              : 'text-[var(--planora-muted)]'
                          }`}
                        >
                          {conv.status && (
                            <span className="uppercase">
                              {({
                                chatting: 'Đang trao đổi',
                                planning: 'Đang lập kế hoạch',
                                completed: 'Hoàn thành',
                                executing: 'Đang chạy',
                                partial: 'Cần xử lý',
                                failed: 'Cần xử lý',
                                reconciliation_required: 'Cần đối soát',
                                stopped: 'Đã dừng',
                              } as Record<string, string>)[conv.status] ?? 'Hội thoại'}
                            </span>
                          )}
                          {time && <span>{time}</span>}
                        </div>
                        <div
                          className={`font-medium mt-1 ${
                            isSelected ? 'text-[var(--planora-text)]' : 'text-[var(--planora-text)]'
                          }`}
                        >
                          {label}
                        </div>
                      </>
                    ) : (
                      <>
                        {planora && (
                          <svg
                            aria-hidden="true"
                            className="w-3.5 h-3.5 mr-1.5 shrink-0 text-[var(--planora-muted)]"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2"
                              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                            />
                          </svg>
                        )}
                        <span className="truncate flex-1">
                          {planora ? `› ${label}` : label}
                        </span>
                        {time && (
                          <span className="text-sm text-[var(--planora-muted)] ml-2 shrink-0">{time}</span>
                        )}
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label={planora ? `Đổi tên hội thoại ${label}` : `Đổi tên ${label}`}
                    onClick={() => {
                      setEditing(conv.id);
                      setTitle(conv.title || '');
                    }}
                    className="shrink-0 text-[var(--planora-muted)] hover:text-[var(--planora-primary)] p-1 rounded transition-colors cursor-pointer"
                  >
                    <svg
                      aria-hidden="true"
                      className="w-3.5 h-3.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                      />
                    </svg>
                  </button>
                </>
              )}
            </div>
          );
        })}
        {isLoading && (
          <p role="status" className="px-2 py-3 text-xs text-[var(--planora-muted)] italic">
            Đang tải danh sách...
          </p>
        )}
        {!isLoading && !conversations.length && (
          <p className="px-2 py-3 text-xs text-[var(--planora-muted)] italic">
            {search ? 'Không có hội thoại phù hợp' : 'Chưa có hội thoại nào'}
          </p>
        )}
        {nextCursor && (
          <button
            type="button"
            disabled={isLoading}
            onClick={() => void load(nextCursor)}
            className="text-xs font-semibold text-[var(--planora-primary)] hover:text-[var(--planora-primary-hover)] p-2 transition-colors cursor-pointer text-left"
          >
            Tải thêm hội thoại
          </button>
        )}
      </div>
    </div>
  );
}
