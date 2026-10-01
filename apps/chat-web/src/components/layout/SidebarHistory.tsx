import React, { useEffect, useState } from 'react';
import { useChatStore } from '../../store/chat-store';
import { apiClient } from '../../services/api-client';
import type { ChatMessage, MessageRole, PlanStatus } from '../../types';

export interface SidebarHistoryProps {
  currentConversationId: string | null;
  onSelectConversation?: (id: string) => void;
  onCloseMobileSidebar?: () => void;
}

function formatTime(dateStr?: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (isToday) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (
    d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear()
  ) {
    return 'Hôm qua';
  }
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

export const SidebarHistory: React.FC<SidebarHistoryProps> = ({
  currentConversationId,
  onSelectConversation,
  onCloseMobileSidebar,
}) => {
  const conversations = useChatStore((s) => s.conversations);
  const setConversations = useChatStore((s) => s.setConversations);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    apiClient
      .getConversations()
      .then((data) => {
        if (isMounted && data?.conversations) {
          setConversations(data.conversations);
        }
      })
      .catch((err) => {
        console.warn('Could not load conversations:', err);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [currentConversationId, setConversations]);

  const handleSelect = async (id: string) => {
    if (id === currentConversationId) {
      onCloseMobileSidebar?.();
      return;
    }

    try {
      const data = await apiClient.getConversation(id);
      const store = useChatStore.getState();
      const loadedMessages: ChatMessage[] = (data.messages || [])
        .filter((m: any) => !(m.metadata?.type === 'working_memory' && !m.content))
        .map((m: any) => ({
          id: m.id,
          role: (m.role as MessageRole) || 'user',
          content: m.content || '',
          timestamp: m.created_at
            ? new Date(m.created_at).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })
            : undefined,
        }));

      store.reset();
      store.setConversationId(id);
      for (const msg of loadedMessages) {
        store.addMessage(msg);
      }

      try {
        const activePlan = await apiClient.getActivePlan(id);
        if (activePlan) {
          store.setActivePlan(activePlan);
          const rawStatus = (activePlan as any).status || 'preview';
          const statusMap: Record<string, PlanStatus> = {
            pending: 'preview',
            preview: 'preview',
            approving: 'approving',
            approved: 'executing',
            executing: 'executing',
            completed: 'completed',
            rejected: 'rejected',
          };
          store.setPlanStatus(statusMap[rawStatus] || 'preview');
        }
      } catch (planErr) {
        console.warn('Could not check active plan:', planErr);
      }
    } catch (err) {
      console.error('Failed to load conversation details:', err);
    }

    onSelectConversation?.(id);
    onCloseMobileSidebar?.();
  };

  return (
    <div className="mt-6 flex-1 flex flex-col min-h-0">
      <span className="text-[11px] font-semibold text-zinc-400 tracking-wider uppercase px-1 shrink-0">
        Lịch sử hội thoại
      </span>

      <div className="mt-2 flex-1 overflow-y-auto flex flex-col gap-1 pr-1">
        {isLoading && conversations.length === 0 ? (
          <div className="px-2 py-3 text-xs text-zinc-400 italic">
            Đang tải danh sách...
          </div>
        ) : conversations.length === 0 ? (
          <div className="px-2 py-3 text-xs text-zinc-400 italic">
            Chưa có hội thoại nào
          </div>
        ) : (
          conversations.map((conv) => {
            const isSelected = conv.id === currentConversationId;
            const timeStr = formatTime(
              conv.updatedAt || conv.updated_at || conv.created_at
            );
            return (
              <div
                key={conv.id}
                role="button"
                tabIndex={0}
                onClick={() => handleSelect(conv.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleSelect(conv.id);
                  }
                }}
                className={`rounded-xl p-2.5 text-xs font-medium flex justify-between items-center cursor-pointer transition select-none ${
                  isSelected
                    ? 'bg-white border border-zinc-200/80 shadow-2xs border-l-2 border-l-[#0071e3] text-zinc-900'
                    : 'hover:bg-zinc-200/50 text-zinc-600'
                }`}
              >
                <span className="truncate flex-1">
                  {conv.title || 'Hội thoại mới'}
                </span>
                {timeStr && (
                  <span className="text-[10px] text-zinc-400 ml-2 shrink-0">
                    {timeStr}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
