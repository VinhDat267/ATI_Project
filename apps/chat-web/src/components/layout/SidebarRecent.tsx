// Thanh bên (redesign 11/2026 bước 5a): hội thoại gần đây, một lối vào cho mọi trang thay cho ngăn kéo "Gần đây"
// ở màn rộng và khối "Gần đây" ở trang chủ. Tìm, đổi tên và xem toàn bộ nằm ở trang Nhật ký.
// Dựng lại theo không gian làm việc và người dùng; kết quả về muộn của không gian cũ bị bỏ qua.
import { useEffect, useState, useSyncExternalStore, type MouseEvent } from 'react';
import { apiClient } from '../../services/api-client';
import { getActiveWorkspaceSelection, subscribeWorkspace } from '../../services/workspace-storage';
import { useChatStore } from '../../store/chat-store';
import type { Conversation } from '../../types';

const LIMIT = 6;

interface SidebarRecentProps {
  userId?: string;
  /** Trả về handler điều hướng trong app (giữ phím bổ trợ cho trình duyệt, đóng tấm menu trên điện thoại). */
  follow: (path: string) => (event: MouseEvent<HTMLAnchorElement>) => void;
}

export function SidebarRecent(props: SidebarRecentProps) {
  const workspace = useSyncExternalStore(subscribeWorkspace, getActiveWorkspaceSelection);
  return <WorkspaceRecent key={JSON.stringify([workspace.id, props.userId])} workspace={workspace} {...props} />;
}

function WorkspaceRecent({ follow, workspace }: SidebarRecentProps & { workspace: ReturnType<typeof getActiveWorkspaceSelection> }) {
  const conversationId = useChatStore(state => state.conversationId);
  const renameRevision = useChatStore(state => state.conversationRenameRevision);
  // Tiêu đề hội thoại mới có sau tin nhắn đầu tiên; tải lại khi tin đó được xác nhận.
  const firstSent = useChatStore(state => state.messages.find(message => message.role === 'user' && message.status === 'sent')?.id);
  const [rows, setRows] = useState<Conversation[] | null>(null);
  useEffect(() => {
    let mounted = true;
    if (typeof apiClient.getConversations !== 'function') return;
    const isCurrent = () => mounted && workspace === getActiveWorkspaceSelection()
      && renameRevision === useChatStore.getState().conversationRenameRevision;
    void Promise.resolve()
      .then(() => apiClient.getConversations({ limit: LIMIT }))
      .then(page => { if (isCurrent()) setRows((page?.conversations ?? []).slice(0, LIMIT)); })
      .catch(() => { if (isCurrent()) setRows(current => current ?? []); });
    return () => { mounted = false; };
  }, [workspace, conversationId, firstSent, renameRevision]);

  if (!rows?.length) return null;
  const current = typeof window === 'undefined' ? null : window.location.pathname.match(/^\/c\/([^/]+)\/?$/)?.[1] ?? null;
  return (
    <section data-sidebar-recent aria-labelledby="sidebar-recent-heading" className="ps-navgroup flex flex-col">
      <h2 id="sidebar-recent-heading" className="ps-grouplabel">Gần đây</h2>
      <ul className="flex flex-col gap-0.5">
        {rows.map(conversation => (
          <li key={conversation.id}>
            <a
              href={`/c/${conversation.id}`}
              onClick={follow(`/c/${conversation.id}`)}
              aria-current={current === conversation.id ? 'page' : undefined}
              title={conversation.title || undefined}
              className="ps-recentlink"
            >
              <span className="truncate">{conversation.title || 'Hội thoại mới'}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
