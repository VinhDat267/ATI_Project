import React, { useState, useRef, useEffect, useCallback } from "react";
import type { ChatMessage, ClarificationState, GatherState } from "../types";
import { useChatStore } from "../store/chat-store";
import { MessageItem } from "./MessageItem";
import { GatherProgress } from "./GatherProgress";
import { ClarificationCard } from "./ClarificationCard";
import { Icon } from "./Brand";
export interface ChatContainerProps {
  messages: ChatMessage[];
  onSendMessage: (content: string) => void;
  streamingText?: string;
  isStreaming?: boolean;
  gatherState?: GatherState | null;
  activeClarification?: ClarificationState | null;
  onClearClarification?: () => void;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  busy?: boolean;
  readOnly?: boolean;
  draft?: string;
  onDraftChange?: (value: string) => void;
}
export function ChatContainer({
  messages,
  onSendMessage,
  streamingText,
  isStreaming,
  gatherState: propGather,
  activeClarification: propClarify,
  onClearClarification,
  children,
  actions,
  busy,
  readOnly = false,
  draft,
  onDraftChange,
}: ChatContainerProps) {
  const [localDraft, setLocalDraft] = useState("");
  const inputVal = draft ?? localDraft;
  const setInputVal = useCallback((value: string) => {
    if (onDraftChange) onDraftChange(value);
    else setLocalDraft(value);
  }, [onDraftChange]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const storeGather = useChatStore((s) => s.gatherState),
    storeClarification = useChatStore((s) => s.activeClarification),
    clearStore = useChatStore((s) => s.setClarification);
  const gatherState = propGather !== undefined ? propGather : storeGather;
  const clarification =
    propClarify !== undefined ? propClarify : storeClarification;
  const processing = Boolean(busy || isStreaming || gatherState?.isGathering);
  const blocked = readOnly || processing;
  useEffect(() => {
    const fn = (e: Event) => {
      const text = (e as CustomEvent<{ text: string }>).detail?.text;
      if (text && !readOnly) {
        setInputVal(text);
        inputRef.current?.focus();
      }
    };
    window.addEventListener("chat:prefill", fn);
    return () => window.removeEventListener("chat:prefill", fn);
  }, [readOnly, setInputVal]);
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height =
        Math.min(Math.max(inputRef.current.scrollHeight, 40), 144) + "px";
      inputRef.current.style.overflowY =
        inputRef.current.scrollHeight > 144 ? "auto" : "hidden";
    }
  }, [inputVal]);
  useEffect(() => {
    const feed = feedRef.current;
    if (!feed) return;
    if (messages.length === 0) {
      feed.scrollTop = 0;
      nearBottom.current = true;
    } else if (nearBottom.current) feed.scrollTop = feed.scrollHeight;
  }, [messages, streamingText, gatherState, clarification]);
  const send = () => {
    if (blocked || !inputVal.trim()) return;
    onSendMessage(inputVal.trim());
    setInputVal("");
    nearBottom.current = true;
  };
  const answer = (text: string) => {
    if (blocked) return;
    onSendMessage(text);
    onClearClarification ? onClearClarification() : clearStore(null);
  };
  return (
    <div className="chat-container">
      <div
        className="workspace-feed"
        ref={feedRef}
        role="log"
        aria-label="Hội thoại"
        aria-live="polite"
        onScroll={() => {
          const f = feedRef.current;
          if (f)
            nearBottom.current =
              f.scrollHeight - f.scrollTop - f.clientHeight < 100;
        }}
      >
        <div className="feed-inner">
          {messages.map((msg) => (
            <MessageItem key={msg.id} {...msg} />
          ))}
          {isStreaming && streamingText && (
            <MessageItem role="assistant" content={streamingText} />
          )}{" "}
          {gatherState &&
            (gatherState.isGathering || gatherState.steps.length > 0) && (
              <GatherProgress
                summary={gatherState.summary}
                steps={gatherState.steps}
              />
            )}{" "}
          {processing && !gatherState?.isGathering && !streamingText && (
            <div className="planning-indicator" role="status">
              <span className="spinner" />
              Planora đang xử lý yêu cầu…
            </div>
          )}
          {clarification && !readOnly && (
            <ClarificationCard
              question={clarification.question}
              options={clarification.options}
              onSelectOption={answer}
              onSubmitText={answer}
              onSkip={() =>
                onClearClarification ? onClearClarification() : clearStore(null)
              }
            />
          )}{" "}
          {children}
        </div>
      </div>
      {actions && (
        <section className="review-dock" aria-label="Thao tác kế hoạch">
          {actions}
        </section>
      )}
      <div className="composer-dock">
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <label htmlFor="chat-input" className="sr-only">
            Mô tả công việc bạn muốn thực hiện
          </label>
          <textarea
            ref={inputRef}
            id="chat-input"
            rows={1}
            readOnly={readOnly}
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing &&
                e.keyCode !== 229
              ) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Mô tả công việc bạn muốn thực hiện..."
          />
          <div className="composer-bottom">
            <span>
              {readOnly ? "Khôi phục hội thoại để gửi yêu cầu" : blocked
                ? "Đang xử lý · chưa gửi thêm yêu cầu"
                : "Enter để gửi · Shift + Enter xuống dòng"}
            </span>
            <button
              type="submit"
              className="btn primary square"
              aria-label="Gửi"
              disabled={blocked || !inputVal.trim()}
            >
              <Icon name="send" />
            </button>
          </div>
        </form>
        <p className="composer-disclaimer">
          Kiểm tra nội dung và nơi nhận trước khi duyệt kế hoạch.
        </p>
      </div>
    </div>
  );
}
