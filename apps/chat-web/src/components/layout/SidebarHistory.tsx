import { openConversation } from "../../services/conversation-loader";
import React, { useEffect, useState } from "react";
import { useChatStore } from "../../store/chat-store";
import { apiClient } from "../../services/api-client";
import { userError } from "../../services/user-error";

export interface SidebarHistoryProps {
  currentConversationId: string | null;
  onSelectConversation?: (id: string) => void;
  onCloseMobileSidebar?: () => void;
}

function formatTime(dateStr?: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (isToday) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (
    d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear()
  ) {
    return "Hôm qua";
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    setLoadError(null);
    apiClient
      .getConversations()
      .then((data) => {
        if (isMounted && data?.conversations) {
          setConversations(data.conversations);
        }
      })
      .catch((err) => {
        if (isMounted) setLoadError(userError(err));
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [currentConversationId, setConversations, retry]);

  const handleSelect = async (id: string) => {
    if (id === currentConversationId) {
      onCloseMobileSidebar?.();
      return;
    }

    // Update the URL at selection time so a pending route effect cannot
    // restore the previously selected conversation while this one loads.
    onSelectConversation?.(id);
    const loaded = await openConversation(id);
    if (loaded && useChatStore.getState().conversationId === id) {
      onCloseMobileSidebar?.();
    }
  };

  return (
    <div className="history-section">
      <span className="text-[11px] font-semibold text-zinc-400 tracking-wider uppercase px-1 shrink-0">
        Lịch sử hội thoại
      </span>
      {loadError && (
        <div className="history-error" role="alert">
          <p>{loadError}</p>
          <button
            className="text-button"
            onClick={() => setRetry((value) => value + 1)}
          >
            Tải lại lịch sử
          </button>
        </div>
      )}

      <div className="mt-2 flex-1 overflow-y-auto flex flex-col gap-1 pr-1">
        {isLoading && conversations.length === 0 ? (
          <div className="px-2 py-3 text-xs text-zinc-400 italic">
            Đang tải danh sách...
          </div>
        ) : conversations.length === 0 ? (
          <div className="px-2 py-3 text-xs text-zinc-400 italic">
            {loadError
              ? "Danh sách hội thoại chưa tải được."
              : "Chưa có hội thoại nào"}
          </div>
        ) : (
          conversations.map((conv) => {
            const isSelected = conv.id === currentConversationId;
            const timeStr = formatTime(
              conv.updatedAt || conv.updated_at || conv.created_at,
            );
            return (
              <div
                key={conv.id}
                role="button"
                tabIndex={0}
                aria-current={isSelected ? "page" : undefined}
                onClick={() => handleSelect(conv.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleSelect(conv.id);
                  }
                }}
                className={"history-link " + (isSelected ? "active" : "")}
              >
                <span className="truncate flex-1">
                  {conv.title || "Hội thoại · " + conv.id.slice(0, 8)}
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
