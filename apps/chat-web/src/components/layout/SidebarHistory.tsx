import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '../../store/chat-store';
import { apiClient } from '../../services/api-client';
import { userErrorMessage } from '../../services/user-error';
import { formatConversationTime } from '../../services/conversation-time';
import { loadConversationHistory } from '../../hooks/use-conversation-history';

export interface SidebarHistoryProps {
  currentConversationId: string | null;
  onSelectConversation?: (id: string) => void;
  onCloseMobileSidebar?: () => void;
}
export function SidebarHistory({ currentConversationId, onSelectConversation, onCloseMobileSidebar }: SidebarHistoryProps) {
  const conversations = useChatStore(state => state.conversations);
  const firstConfirmedUserMessage = useChatStore(state => state.messages.find(message => message.role === 'user' && message.status === 'sent')?.id);
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
  const load = async (cursor?: string, generation = request.current) => {
    busy.current = true; setIsLoading(true); setError(null);
    try {
      const data = await apiClient.getConversations({ search, cursor });
      if (generation !== request.current) return;
      const store = useChatStore.getState();
      const rows = cursor ? [...store.conversations, ...data.conversations] : data.conversations;
      store.setConversations([...new Map(rows.map(row => [row.id, row])).values()]);
      setNextCursor(data.nextCursor || null);
    } catch (reason) { if (generation === request.current) setError(userErrorMessage(reason)); }
    finally { if (generation === request.current) { busy.current = false; setIsLoading(false); } }
  };
  useEffect(() => {
    const generation = ++request.current;
    setNextCursor(null);
    void load(undefined, generation);
    return () => { request.current++; selection.current++; };
  }, [currentConversationId, search, firstConfirmedUserMessage]);
  const select = async (id: string) => {
    onCloseMobileSidebar?.();
    if (id === currentConversationId) return;
    if (onSelectConversation) { onSelectConversation(id); return; }
    const selected = ++selection.current;
    const store = useChatStore.getState(); store.reset({ preservePlanning: true }); store.setConversationId(id);
    try { await loadConversationHistory(id, () => selection.current === selected && useChatStore.getState().conversationId === id); }
    catch (reason) { if (selection.current === selected) { store.reset({ preservePlanning: true }); setError(userErrorMessage(reason)); } }
  };
  const rename = async (id: string) => {
    if (saving) return;
    const trimmed = title.trim();
    if (!trimmed || Array.from(trimmed).length > 60) { setError('Tiêu đề cần từ 1 đến 60 ký tự.'); return; }
    setSaving(true); setError(null);
    try {
      const data = await apiClient.renameConversation(id, trimmed);
      const store = useChatStore.getState();
      store.setConversations(store.conversations.map(row => row.id === id ? data.conversation : row));
      setEditing(null);
    } catch (reason) { setError(userErrorMessage(reason)); }
    finally { setSaving(false); }
  };
  return <div className="mt-6 flex-1 flex flex-col min-h-0">
    <span className="text-sm font-semibold text-text-muted tracking-wider uppercase px-1 shrink-0">Lịch sử hội thoại</span>
    <input type="search" aria-label="Tìm hội thoại theo tiêu đề" value={search} onChange={event => setSearch(event.target.value)}
      className="mt-2 w-full border border-border rounded-lg p-2 text-xs bg-surface" placeholder="Tìm hội thoại..." />
    {error && <p role="alert" className="text-xs text-danger-text py-2">{error}</p>}
    <div role="region" aria-label="Danh sách hội thoại" className="mt-2 flex-1 overflow-y-auto flex flex-col gap-1 pr-1"
      onScroll={event => { const area = event.currentTarget; if (area.scrollHeight - area.scrollTop - area.clientHeight < 100 && nextCursor && !busy.current) void load(nextCursor); }}>
      {conversations.map(conv => {
        const label = conv.title || 'Hội thoại mới';
        const time = formatConversationTime(conv.updatedAt || conv.updated_at || conv.created_at);
        return <div key={conv.id} className={`rounded-xl p-2.5 text-xs font-medium flex gap-1 items-center transition ${conv.id === currentConversationId
          ? 'bg-surface border border-border shadow-2xs border-l-2 border-l-primary text-text' : 'hover:bg-surface-raised text-text-secondary'}`}>
          {editing === conv.id ? <form className="flex-1 min-w-0" onSubmit={event => { event.preventDefault(); void rename(conv.id); }}>
            <input autoFocus aria-label="Tiêu đề hội thoại" value={title} onChange={event => setTitle(event.target.value)} className="w-full border border-border rounded p-1" />
            <div className="flex gap-2 mt-1"><button type="submit" disabled={saving} aria-label="Lưu tên hội thoại" className="text-primary-text">Lưu</button>
              <button type="button" disabled={saving} onClick={() => setEditing(null)}>Hủy đổi tên</button></div>
          </form> : <><button type="button" onClick={() => void select(conv.id)} className="min-w-0 flex-1 text-left cursor-pointer flex items-center">
            <span className="truncate flex-1">{label}</span>{time && <span className="text-sm text-text-muted ml-2 shrink-0">{time}</span>}
          </button><button type="button" aria-label={`Đổi tên ${label}`} onClick={() => { setEditing(conv.id); setTitle(conv.title || ''); }} className="shrink-0 text-text-muted p-1">✎</button></>}
        </div>;
      })}
      {isLoading && <p role="status" className="px-2 py-3 text-xs text-text-muted italic">Đang tải danh sách...</p>}
      {!isLoading && !conversations.length && <p className="px-2 py-3 text-xs text-text-muted italic">{search ? 'Không có hội thoại phù hợp' : 'Chưa có hội thoại nào'}</p>}
      {nextCursor && <button type="button" disabled={isLoading} onClick={() => void load(nextCursor)} className="text-xs text-primary-text p-2">Tải thêm hội thoại</button>}
    </div>
  </div>;
}
