import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { apiClient } from '../../services/api-client';
import { userErrorMessage } from '../../services/user-error';
import { getActiveWorkspaceId, subscribeWorkspace } from '../../services/workspace-storage';
import { useChatStore } from '../../store/chat-store';
import type { Conversation, User } from '../../types';

export function useHistory(user: User | null) {
  const [rows, setRows] = useState<Conversation[]>([]);
  const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState(getActiveWorkspaceId());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);

  const generation = useRef(0);
  const busy = useRef(false);
  const renameBusy = useRef(false);
  const draftRevision = useRef(0);
  const mounted = useRef(true);
  const returnFocus = useRef<string | null>(null);
  const prevWorkspaceId = useRef(workspaceId);

  useLayoutEffect(() => {
    if (editing !== null || !returnFocus.current) return;
    document.getElementById(`rename-button-${returnFocus.current}`)?.focus();
    returnFocus.current = null;
  }, [editing]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Listen to workspace changes
  useEffect(() => subscribeWorkspace(() => setWorkspaceId(getActiveWorkspaceId())), []);

  // Subscribe to useChatStore to keep HistoryPage rows synchronized when conversations change
  useEffect(() => {
    return useChatStore.subscribe((state, prevState) => {
      if (state.conversations !== prevState.conversations) {
        setRows(current => {
          let hasChange = false;
          const updated = current.map(row => {
            const match = state.conversations.find(c => c.id === row.id);
            if (match && (match.title !== row.title || match.status !== row.status)) {
              hasChange = true;
              return { ...row, ...match };
            }
            return row;
          });
          return hasChange ? updated : current;
        });
      }
    });
  }, []);

  const load = async (nextCursor: string | undefined, owner = generation.current) => {
    busy.current = true;
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.getConversations({ search, cursor: nextCursor, limit: 20 });
      if (owner !== generation.current) return;
      setRows(current => [
        ...new Map(
          (nextCursor ? [...current, ...data.conversations] : data.conversations).map(row => [row.id, row])
        ).values(),
      ]);
      setCursor(data.nextCursor ?? null);
    } catch (reason) {
      if (owner === generation.current) setError(userErrorMessage(reason));
    } finally {
      if (owner === generation.current) {
        busy.current = false;
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (prevWorkspaceId.current !== workspaceId) {
      prevWorkspaceId.current = workspaceId;
      setNotice(null);
    }
    const owner = ++generation.current;
    setRows([]);
    setCursor(null);
    setEditing(null);
    draftRevision.current++;
    void load(undefined, owner);
    return () => {
      generation.current++;
    };
  }, [search, user?.id, workspaceId]);

  const edit = (id: string) => {
    draftRevision.current++;
    setEditing(id);
    setTitle(rows.find(row => row.id === id)?.title ?? '');
    setError(null);
    setNotice(null);
  };

  const cancel = () => {
    draftRevision.current++;
    returnFocus.current = editing;
    setEditing(null);
    setError(null);
  };

  const rename = async (id: string) => {
    if (renameBusy.current) return;
    const trimmed = title.trim();
    if (!trimmed || Array.from(trimmed).length > 60) {
      setError('Tiêu đề cần từ 1 đến 60 ký tự.');
      return;
    }
    renameBusy.current = true;
    setSaving(true);
    setError(null);
    setNotice(null);
    const owner = generation.current;
    const revision = draftRevision.current;
    try {
      const { conversation } = await apiClient.renameConversation(id, trimmed);
      if (owner !== generation.current) return;
      setRows(current => current.map(row => (row.id === id ? conversation : row)));
      const store = useChatStore.getState();
      store.setConversations(store.conversations.map(row => (row.id === id ? conversation : row)));
      if (draftRevision.current === revision) {
        returnFocus.current = id;
        setEditing(null);
      }
      setNotice('Đã đổi tên hội thoại.');
    } catch (reason) {
      if (owner === generation.current) setError(userErrorMessage(reason));
    } finally {
      renameBusy.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  return {
    rows,
    search,
    setSearch,
    cursor,
    loading,
    error,
    notice,
    editing,
    title,
    setTitle(value: string) {
      draftRevision.current++;
      setTitle(value);
    },
    saving,
    edit,
    cancel,
    rename,
    loadMore() {
      if (cursor && !busy.current) void load(cursor);
    },
  };
}
