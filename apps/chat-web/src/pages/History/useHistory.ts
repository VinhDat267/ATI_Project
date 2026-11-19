import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { apiClient } from '../../services/api-client';
import { userErrorMessage } from '../../services/user-error';
import { getActiveWorkspaceId, getActiveWorkspaceSelection, subscribeWorkspace } from '../../services/workspace-storage';
import { useChatStore } from '../../store/chat-store';
import type { Conversation, User } from '../../types';

export function useHistory(user: User | null) {
  const [rows, setRows] = useState<Conversation[]>([]), [search, setSearch] = useState(''), [cursor, setCursor] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState(getActiveWorkspaceId());
  const [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null), [title, setTitle] = useState(''), [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ row: Conversation; workspace: ReturnType<typeof getActiveWorkspaceSelection> } | null>(null);
  const [deleting, setDeleting] = useState(false), [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteBusy = useRef(false);
  const generation = useRef(0), busy = useRef(false), renameBusy = useRef(false), draftRevision = useRef(0);
  const mounted = useRef(true);
  const removedIds = useRef(new Set<string>());
  const returnFocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (editing !== null || !returnFocus.current) return;
    document.getElementById(`rename-button-${returnFocus.current}`)?.focus();
    returnFocus.current = null;
  }, [editing]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => subscribeWorkspace(() => setWorkspaceId(getActiveWorkspaceId())), []);
  useEffect(() => useChatStore.subscribe((state, previous) => {
    const id = state.lastDeletedConversationId;
    if (!id || id === previous.lastDeletedConversationId) return;
    removedIds.current.add(id);
    setRows(current => current.filter(row => row.id !== id));
  }), []);
  useEffect(() => { setDeleteTarget(null); setDeleteError(null); }, [user?.id, workspaceId]);
  const load = async (nextCursor: string | undefined, owner = generation.current) => {
    busy.current = true; setLoading(true); setError(null);
    try {
      const data = await apiClient.getConversations({ search, cursor: nextCursor, limit: 20 });
      if (owner !== generation.current) return;
      const conversations = data.conversations.filter(row => !removedIds.current.has(row.id));
      setRows(current => [...new Map((nextCursor ? [...current, ...conversations] : conversations).map(row => [row.id, row])).values()]);
      setCursor(data.nextCursor ?? null);
    } catch (reason) { if (owner === generation.current) setError(userErrorMessage(reason)); }
    finally { if (owner === generation.current) { busy.current = false; setLoading(false); } }
  };
  useEffect(() => {
    const owner = ++generation.current;
    setRows([]); setCursor(null); setEditing(null); draftRevision.current++;
    void load(undefined, owner);
    return () => { generation.current++; };
  }, [search, user?.id, workspaceId]);
  const edit = (id: string) => { draftRevision.current++; setEditing(id); setTitle(rows.find(row => row.id === id)?.title ?? ''); setError(null); setNotice(null); };
  const cancel = () => { draftRevision.current++; returnFocus.current = editing; setEditing(null); setError(null); };
  const rename = async (id: string) => {
    if (renameBusy.current) return;
    const trimmed = title.trim();
    if (!trimmed || Array.from(trimmed).length > 60) { setError('Tiêu đề cần từ 1 đến 60 ký tự.'); return; }
    renameBusy.current = true; setSaving(true); setError(null); setNotice(null);
    const owner = generation.current, revision = draftRevision.current;
    const workspace = getActiveWorkspaceSelection();
    try {
      const { conversation } = await apiClient.renameConversation(id, trimmed);
      if (workspace !== getActiveWorkspaceSelection()) return;
      useChatStore.getState().applyConversationRename(conversation);
      if (owner !== generation.current) return;
      setRows(current => current.map(row => row.id === id ? conversation : row));
      // An edit, Escape, or a new rename session invalidates ownership of the old input.
      if (draftRevision.current === revision) { returnFocus.current = id; setEditing(null); }
      setNotice('Đã đổi tên hội thoại.');
    } catch (reason) { if (owner === generation.current) setError(userErrorMessage(reason)); }
    finally { renameBusy.current = false; if (mounted.current) setSaving(false); }
  };
  const remove = async () => {
    if (deleteBusy.current || !deleteTarget || deleteTarget.workspace !== getActiveWorkspaceSelection()) return false;
    const { row: { id }, workspace } = deleteTarget;
    deleteBusy.current = true;
    setDeleting(true);
    setDeleteError(null);
    setNotice(null);
    const isCurrent = () => mounted.current && workspace === getActiveWorkspaceSelection();
    try {
      await apiClient.deleteConversation(id, workspace.id);
      useChatStore.getState().applyConversationDeletion(id);
      if (!isCurrent()) return false;
      setDeleteTarget(null);
      setNotice('Đã xoá hội thoại.');
      return true;
    } catch (reason) {
      if (isCurrent()) setDeleteError(userErrorMessage(reason, 'Không thể xoá hội thoại.'));
      return false;
    } finally {
      deleteBusy.current = false;
      if (mounted.current) setDeleting(false);
    }
  };
  const askDelete = (row: Conversation) => {
    if (deleteBusy.current) return;
    setDeleteTarget({ row, workspace: getActiveWorkspaceSelection() });
    setDeleteError(null);
  };
  const cancelDelete = () => { if (!deleteBusy.current) setDeleteTarget(null); };
  return { rows, search, setSearch, cursor, loading, error, notice, editing, title, setTitle(value: string) { draftRevision.current++; setTitle(value); }, saving, edit, cancel, rename, deleteTarget: deleteTarget?.row, deleting, deleteError, askDelete, cancelDelete, remove, loadMore() { if (cursor && !busy.current) void load(cursor); } };
}
