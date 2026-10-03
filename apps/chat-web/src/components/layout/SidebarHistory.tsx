import { openConversation } from "../../services/conversation-loader";
import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  ArchiveRestore,
  MoreHorizontal,
  Search,
  Trash2,
} from "lucide-react";
import { Icon } from "../Brand";
import { Modal } from "../Modal";
import type { Conversation } from "../../types";
import { useChatStore } from "../../store/chat-store";
import { apiClient } from "../../services/api-client";
import { userError } from "../../services/user-error";

export interface SidebarHistoryProps {
  currentConversationId: string | null;
  onSelectConversation?: (id: string) => void;
  onCloseMobileSidebar?: () => void;
  onConversationRemoved?: (id: string) => void;
  filter?: "active" | "archived" | "deleted";
}

function historyDate(conv: Conversation): string | undefined {
  return conv.updatedAt || conv.updated_at || conv.created_at;
}

function searchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .trim();
}

function groupName(dateStr: string | undefined, now: Date): string {
  const date = dateStr ? new Date(dateStr) : null;
  if (!date || Number.isNaN(date.getTime())) return "Khác";
  if (date.toDateString() === now.toDateString()) return "Hôm nay";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  return date.toDateString() === yesterday.toDateString()
    ? "Hôm qua"
    : "Trước đây";
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
    return d.toLocaleTimeString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
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
  onConversationRemoved,
  filter = "active",
}) => {
  const recent = useChatStore((s) => s.conversations);
  const conversationArchived = useChatStore((s) => s.conversationArchived);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const setConversations = useChatStore((s) => s.setConversations);
  const listLabel =
    filter === "active"
      ? "Gần đây"
      : filter === "archived"
        ? "Hội thoại lưu trữ"
        : "Hội thoại đã xóa";
  const [cache, setCache] = useState<{
    archived: Conversation[];
    deleted: Conversation[];
  }>({ archived: [], deleted: [] });
  const conversations = filter === "active" ? recent : cache[filter];
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const prefix = useId();
  const [menuId, setMenuId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const mutationPending = useRef(false);
  const normalizedQuery = searchText(query);
  const matching = conversations
    .filter((conv) =>
      searchText(conv.title || "Hội thoại · " + conv.id.slice(0, 8)).includes(
        normalizedQuery,
      ),
    )
    .sort((a, b) => {
      const timestamp = (conv: Conversation) => {
        const value = Date.parse(historyDate(conv) || "");
        return Number.isNaN(value) ? 0 : value;
      };
      return timestamp(b) - timestamp(a);
    });
  const now = new Date();
  const groups = ["Hôm nay", "Hôm qua", "Trước đây", "Khác"]
    .map((label) => ({
      label,
      rows: matching.filter(
        (conv) => groupName(historyDate(conv), now) === label,
      ),
    }))
    .filter((group) => group.rows.length > 0);
  const clearSearch = () => {
    setQuery("");
    search.current?.focus();
  };

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    setLoadError(null);
    apiClient
      .getConversations(filter)
      .then((data) => {
        if (isMounted && data?.conversations) {
          if (filter === "active") setConversations(data.conversations);
          else
            setCache((previous) => ({
              ...previous,
              [filter]: data.conversations,
            }));
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
  }, [
    currentConversationId,
    conversationArchived,
    setConversations,
    retry,
    filter,
  ]);

  useLayoutEffect(() => {
    const panel = menu.current,
      anchor = menuTrigger.current;
    if (!menuId || !panel || !anchor) return;
    // Native top layer keeps the dropdown out of the scrolling list's clip.
    if (typeof panel.showPopover === "function") panel.showPopover();
    else panel.removeAttribute("popover");
    const rect = anchor.getBoundingClientRect();
    const width = panel.offsetWidth || 212,
      height = panel.offsetHeight || 112;
    const above = rect.bottom + 8 + height > innerHeight - 12;
    panel.style.left = `${Math.max(12, Math.min(rect.right - width, innerWidth - width - 12))}px`;
    panel.style.top = `${Math.max(12, above ? rect.top - height - 8 : rect.bottom + 8)}px`;
    panel.dataset.placement = above ? "above" : "below";
    panel.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    return () => {
      panel.hidePopover?.();
    };
  }, [menuId]);

  useEffect(() => {
    if (!menuId) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !menu.current?.contains(target) &&
        !menuTrigger.current?.contains(target)
      )
        setMenuId(null);
    };
    const dismiss = () => setMenuId(null);
    const closeOnScroll = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) dismiss();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("scroll", closeOnScroll, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("scroll", closeOnScroll, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [menuId]);

  const mutate = async (
    conv: Conversation,
    action: "archive" | "delete" | "restore",
  ) => {
    if (mutationPending.current) return;
    mutationPending.current = true;
    setMutationBusy(true);
    setMutationError(null);
    setFeedback("");
    try {
      const restored =
        action === "restore"
          ? await apiClient.restoreConversation(conv.id)
          : null;
      if (action === "archive") await apiClient.archiveConversation(conv.id);
      if (action === "delete") await apiClient.deleteConversation(conv.id);
      const rows = useChatStore
        .getState()
        .conversations.filter((row) => row.id !== conv.id);
      // Lifecycle responses contain the updated row, while the list title may
      // have been derived from its first message. Keep that known title.
      const restoredRow = restored ? {
        ...conv,
        ...restored.conversation,
        title: restored.conversation.title || conv.title,
      } : null;
      setConversations(restoredRow ? [restoredRow, ...rows] : rows);
      setCache((previous) => ({
        archived: previous.archived.filter((row) => row.id !== conv.id),
        deleted: previous.deleted.filter((row) => row.id !== conv.id),
      }));
      if (action !== "restore") onConversationRemoved?.(conv.id);
      else if (useChatStore.getState().conversationId === conv.id)
        useChatStore.getState().setConversationArchived(false);
      setDeleteTarget(null);
      setMenuId(null);
      setFeedback(
        action === "archive"
          ? "Đã lưu trữ hội thoại."
          : action === "delete"
            ? "Đã xóa hội thoại."
            : "Đã khôi phục hội thoại.",
      );
      setRetry((value) => value + 1);
      search.current?.focus();
    } catch (error) {
      setMutationError(userError(error));
    } finally {
      mutationPending.current = false;
      setMutationBusy(false);
    }
  };

  const handleSelect = async (id: string) => {
    if (id === currentConversationId) {
      onSelectConversation?.(id);
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
      <div className="sidebar-search">
        <Search className="icon" aria-hidden="true" />
        <input
          ref={search}
          type="search"
          aria-label="Tìm hội thoại"
          placeholder="Tìm hội thoại…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.preventDefault();
              event.stopPropagation();
              clearSearch();
            }
          }}
        />
        {query && (
          <button type="button" onClick={clearSearch} aria-label="Xóa tìm kiếm">
            <Icon name="x" />
          </button>
        )}
      </div>
      <div className="history-heading">
        <span>{listLabel}</span>
        <button
          type="button"
          className="history-refresh"
          aria-label="Làm mới lịch sử"
          title="Làm mới lịch sử"
          disabled={isLoading}
          onClick={() => setRetry((value) => value + 1)}
        >
          <Icon name="refresh" />
        </button>
      </div>
      {loadError && (
        <div className="history-error" role="alert">
          <p>{loadError}</p>
          <button
            className="text-button"
            disabled={isLoading}
            onClick={() => setRetry((value) => value + 1)}
          >
            Tải lại lịch sử
          </button>
        </div>
      )}
      {mutationError && !deleteTarget && (
        <p className="history-action-error" role="alert">
          {mutationError}
        </p>
      )}
      {feedback && (
        <p className="history-feedback" role="status">
          {feedback}
        </p>
      )}

      <div
        className="history-list"
        role="region"
        id={`${prefix}-list`}
        aria-label={listLabel}
        aria-busy={isLoading}
      >
        {isLoading && conversations.length === 0 ? (
          <div className="history-empty" role="status">
            Đang tải danh sách...
          </div>
        ) : conversations.length === 0 ? (
          <div className="history-empty">
            <Icon name="chat" />
            {loadError
              ? "Danh sách hội thoại chưa tải được."
              : filter === "archived"
                ? "Chưa có hội thoại lưu trữ"
                : filter === "deleted"
                  ? "Chưa có hội thoại đã xóa"
                  : "Chưa có hội thoại nào"}
          </div>
        ) : matching.length === 0 ? (
          <div className="history-empty" role="status">
            <Search className="icon" aria-hidden="true" />
            <p>Không tìm thấy hội thoại</p>
            <button className="text-button" onClick={clearSearch}>
              Xem tất cả
            </button>
          </div>
        ) : (
          groups.map((group) => (
            <section
              className="history-group"
              role="group"
              aria-label={group.label}
              key={group.label}
            >
              <h2>{group.label}</h2>
              {group.rows.map((conv) => {
                const isSelected = conv.id === currentConversationId;
                const timeStr = formatTime(historyDate(conv));
                const title =
                  conv.title || "Hội thoại · " + conv.id.slice(0, 8);
                const processing =
                  conv.id === currentConversationId && isStreaming;
                return (
                  <div className="conversation-row" key={conv.id}>
                    <button
                      type="button"
                      key={conv.id}
                      aria-label={title}
                      title={title}
                      aria-current={isSelected ? "page" : undefined}
                      onClick={() => handleSelect(conv.id)}
                      disabled={filter === "deleted"}
                      className={
                        "history-link conversation-link " +
                        (isSelected ? "active" : "")
                      }
                    >
                      <Icon name="chat" />
                      <span className="conversation-label">
                        <span>{title}</span>
                        {timeStr && (
                          <time dateTime={historyDate(conv)}>{timeStr}</time>
                        )}
                      </span>
                      {isSelected && (
                        <span
                          className="conversation-current"
                          aria-hidden="true"
                        />
                      )}
                    </button>
                    <button
                      type="button"
                      className="conversation-options"
                      aria-label={`Tùy chọn: ${title}`}
                      aria-expanded={menuId === conv.id}
                      aria-controls={`${prefix}-actions-${conv.id}`}
                      onClick={(event) => {
                        menuTrigger.current = event.currentTarget;
                        setMenuId(menuId === conv.id ? null : conv.id);
                        setMutationError(null);
                      }}
                      onKeyDown={(event) => {
                        if (
                          event.key === "ArrowDown" ||
                          event.key === "ArrowUp"
                        ) {
                          event.preventDefault();
                          menuTrigger.current = event.currentTarget;
                          setMenuId(conv.id);
                        }
                        if (event.key === "Escape") {
                          event.stopPropagation();
                          setMenuId(null);
                        }
                      }}
                    >
                      <MoreHorizontal className="icon" aria-hidden="true" />
                    </button>
                    {menuId === conv.id && (
                      <div
                        ref={menu}
                        popover="manual"
                        className="conversation-actions"
                        role="group"
                        aria-label={`Tác vụ: ${title}`}
                        id={`${prefix}-actions-${conv.id}`}
                        onBlur={(event) => {
                          if (
                            !event.currentTarget.contains(
                              event.relatedTarget as Node,
                            ) && event.relatedTarget !== menuTrigger.current
                          )
                            setMenuId(null);
                        }}
                        onKeyDown={(event) => {
                          const items = Array.from(
                            event.currentTarget.querySelectorAll<HTMLButtonElement>(
                              "button:not(:disabled)",
                            ),
                          );
                          const current = items.indexOf(
                            document.activeElement as HTMLButtonElement,
                          );
                          const next =
                            event.key === "ArrowDown"
                              ? (current + 1) % items.length
                              : event.key === "ArrowUp"
                                ? (current - 1 + items.length) % items.length
                                : event.key === "Home"
                                  ? 0
                                  : event.key === "End"
                                    ? items.length - 1
                                    : -1;
                          if (next >= 0) {
                            event.preventDefault();
                            items[next]?.focus();
                          }
                          if (event.key === "Escape") {
                            event.preventDefault();
                            event.stopPropagation();
                            setMenuId(null);
                            menuTrigger.current?.focus();
                          }
                        }}
                      >
                        {filter === "active" ? (
                          <button
                            type="button"
                            disabled={mutationBusy || processing}
                            onClick={() => void mutate(conv, "archive")}
                          >
                            <Archive className="icon" aria-hidden="true" />
                            <span>Lưu trữ hội thoại</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={mutationBusy}
                            onClick={() => void mutate(conv, "restore")}
                          >
                            <ArchiveRestore
                              className="icon"
                              aria-hidden="true"
                            />
                            <span>Khôi phục hội thoại</span>
                          </button>
                        )}
                        {filter !== "deleted" && (
                          <button
                            type="button"
                            className="conversation-delete"
                            disabled={mutationBusy || processing}
                            onClick={() => {
                              setMutationError(null);
                              setMenuId(null);
                              menuTrigger.current?.focus();
                              setDeleteTarget(conv);
                            }}
                          >
                            <Trash2 className="icon" aria-hidden="true" />
                            <span>Xóa hội thoại</span>
                          </button>
                        )}
                        {processing && <p>Đang xử lý yêu cầu.</p>}
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          ))
        )}
      </div>
      {deleteTarget &&
        createPortal(
          <Modal
            title="Xóa hội thoại?"
            onClose={() => {
              if (!mutationPending.current) setDeleteTarget(null);
            }}
          >
            <p>
              Hội thoại sẽ được ẩn khỏi danh sách gần đây. Nội dung được giữ
              lại.
            </p>
            {mutationError && (
              <p className="field-error" role="alert">
                {mutationError}
              </p>
            )}
            <div className="dialog-actions">
              <button
                className="btn"
                disabled={mutationBusy}
                onClick={() => setDeleteTarget(null)}
              >
                Giữ lại
              </button>
              <button
                className="btn primary"
                disabled={mutationBusy}
                onClick={() => void mutate(deleteTarget, "delete")}
              >
                {mutationBusy ? "Đang xóa…" : "Xác nhận xóa"}
              </button>
            </div>
          </Modal>,
          document.body,
        )}
    </div>
  );
};
