import { useEffect, useRef, useState } from 'react';
import { apiClient } from '../../services/api-client';
import { userErrorMessage } from '../../services/user-error';
import { useChatStore } from '../../store/chat-store';
import type { Conversation, User } from '../../types';

export function useHistory(user: User | null) {
  const [rows, setRows] = useState<Conversation[]>([]), [search, setSearch] = useState(''), [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null), [title, setTitle] = useState(''), [saving, setSaving] = useState(false);
  const generation = useRef(0), busy = useRef(false), renameBusy = useRef(false), draftRevision = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const load = async (nextCursor: string | undefined, owner = generation.current) => {
    busy.current = true; setLoading(true); setError(null);
    try {
      const data = await apiClient.getConversations({ search, cursor: nextCursor, limit: 20 });
      if (owner !== generation.current) return;
      setRows(current => [...new Map((nextCursor ? [...current, ...data.conversations] : data.conversations).map(row => [row.id, row])).values()]);
      setCursor(data.nextCursor ?? null);
    } catch (reason) { if (owner === generation.current) setError(userErrorMessage(reason)); }
    finally { if (owner === generation.current) { busy.current = false; setLoading(false); } }
  };
  useEffect(() => {
    const owner = ++generation.current;
    setRows([]); setCursor(null); setEditing(null); draftRevision.current++;
    void load(undefined, owner);
    return () => { generation.current++; };
  }, [search, user?.id]);
  const edit = (id: string) => { draftRevision.current++; setEditing(id); setTitle(rows.find(row => row.id === id)?.title ?? ''); setError(null); setNotice(null); };
  const cancel = () => { draftRevision.current++; setEditing(null); setError(null); document.getElementById(`rename-button-${editing}`)?.focus(); };
  const rename = async (id: string) => {
    if (renameBusy.current) return;
    const trimmed = title.trim();
    if (!trimmed || Array.from(trimmed).length > 60) { setError('Tiêu đề cần từ 1 đến 60 ký tự.'); return; }
    renameBusy.current = true; setSaving(true); setError(null); setNotice(null);
    const owner = generation.current, revision = draftRevision.current;
    try {
      const { conversation } = await apiClient.renameConversation(id, trimmed);
      if (owner !== generation.current) return;
      setRows(current => current.map(row => row.id === id ? conversation : row));
      const store = useChatStore.getState(); store.setConversations(store.conversations.map(row => row.id === id ? conversation : row));
      // An edit, Escape, or a new rename session invalidates ownership of the old input.
      if (draftRevision.current === revision) { setEditing(null); document.getElementById(`rename-button-${id}`)?.focus(); }
      setNotice('Đã đổi tên hội thoại.');
    } catch (reason) { if (owner === generation.current) setError(userErrorMessage(reason)); }
    finally { renameBusy.current = false; if (mounted.current) setSaving(false); }
  };
  return { rows, search, setSearch, cursor, loading, error, notice, editing, title, setTitle(value: string) { draftRevision.current++; setTitle(value); }, saving, edit, cancel, rename, loadMore() { if (cursor && !busy.current) void load(cursor); } };
}
