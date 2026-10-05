import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import type {
  ChatMessage,
  ClarificationState,
  GatherState,
} from '../types';
import { useChatStore } from '../store/chat-store';
import { MessageItem } from './MessageItem';
import { GatherProgress } from './GatherProgress';
import { ClarificationCard } from './ClarificationCard';
import { PlanPreview } from './PlanPreview';

export interface ChatContainerProps {
  messages: ChatMessage[];
  onSendMessage: (content: string) => void;
  streamingText?: string;
  isStreaming?: boolean;
  isPlanning?: boolean;
  gatherState?: GatherState | null;
  activeClarification?: ClarificationState | null;
  onClearClarification?: () => void;
  children?: React.ReactNode;
  logOnly?: boolean;
}

export const ChatContainer: React.FC<ChatContainerProps> = ({
  messages,
  onSendMessage,
  streamingText,
  isStreaming,
  isPlanning = false,
  gatherState: propGatherState,
  activeClarification: propActiveClarification,
  onClearClarification,
  children,
  logOnly = false,
}) => {
  const [inputVal, setInputVal] = useState('');
  const scrollArea = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const previousContent = useRef({ count: 0, streamingText });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 144)}px`;
  }, [inputVal]);

  useEffect(() => {
    const handlePrefill = (e: Event) => {
      const customEvt = e as CustomEvent<{ text: string }>;
      if (customEvt.detail?.text) {
        setInputVal(customEvt.detail.text);
        if (inputRef.current) {
          inputRef.current.focus();
          const len = customEvt.detail.text.length;
          inputRef.current.setSelectionRange?.(len, len);
        }
      }
    };
    window.addEventListener('chat:prefill', handlePrefill);
    return () => window.removeEventListener('chat:prefill', handlePrefill);
  }, []);

  const storeGatherState = useChatStore((s) => s.gatherState);
  const storeClarification = useChatStore((s) => s.activeClarification);
  const setStoreClarification = useChatStore((s) => s.setClarification);

  const gatherState =
    propGatherState !== undefined ? propGatherState : storeGatherState;
  const activeClarification =
    propActiveClarification !== undefined
      ? propActiveClarification
      : storeClarification;

  const clearClarification = () => {
    if (onClearClarification) {
      onClearClarification();
    } else {
      setStoreClarification(null);
    }
  };

  useLayoutEffect(() => {
    const area = scrollArea.current;
    if (!area) return;
    if (!messages.length) { area.scrollTop = 0; nearBottom.current = true; }
    else if (nearBottom.current) {
      area.scrollTop = area.scrollHeight;
    }
    previousContent.current = { count: messages.length, streamingText };
  }, [messages.length, streamingText, children, gatherState, activeClarification]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputVal.trim() && !isPlanning) {
      onSendMessage(inputVal.trim());
      setInputVal('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="flex flex-col h-full bg-surface relative">
      {/* Messages Scroll Area */}
      <div
        ref={scrollArea}
        role="log" aria-live="polite" aria-label="Hội thoại"
        onScroll={event => { const area = event.currentTarget; nearBottom.current = area.scrollHeight - area.clientHeight - area.scrollTop < 120; }}
        className={`flex-1 overflow-y-auto px-4 md:px-8 py-6 pb-28 mx-auto w-full ${
          messages.length === 0 ? 'max-w-4xl' : 'max-w-3xl'
        }`}
      >
        {messages.map((msg) => msg.metadata?.type === 'plan' && msg.metadata.plan ? <details key={msg.id} className="my-3"><summary className="cursor-pointer text-sm">Kế hoạch đã lưu: {msg.metadata.plan.summary}</summary><PlanPreview plan={{ ...msg.metadata.plan, resourceLabels: msg.metadata.resourceLabels }} /></details> : (
          <MessageItem
            key={msg.id}
            role={msg.role}
            content={msg.content}
            status={msg.status}
            timestamp={msg.timestamp}
          />
        ))}

        {/* Streaming text */}
        {isStreaming && streamingText && (
          <MessageItem
            role="assistant"
            content={`${streamingText} |`}
          />
        )}

        {/* Gather Progress */}
        {!logOnly && gatherState &&
          (gatherState.isGathering || gatherState.steps.length > 0) && (
            <GatherProgress
              summary={gatherState.summary}
              steps={gatherState.steps}
            />
          )}

        {/* Clarification Card */}
        {!logOnly && activeClarification && (
          <ClarificationCard
            question={activeClarification.question}
            options={activeClarification.options}
            onSelectOption={(option) => {
              onSendMessage(option);
              clearClarification();
            }}
            onSubmitText={(text) => {
              onSendMessage(text);
              clearClarification();
            }}
            onSkip={() => {
              clearClarification();
            }}
          />
        )}

        {/* Injected cards (PlanPreview, ExecutionProgress, etc) */}
        {children}

      </div>

      {/* Fixed/Docked Bottom Input Bar */}
      {!logOnly && <div className="border-t border-border bg-surface p-3 md:p-4 sticky bottom-0 z-20">
        <form
          onSubmit={handleSubmit}
          className="max-w-3xl mx-auto flex items-center gap-2 bg-surface-inset border border-border rounded-2xl p-1.5 focus-within:border-border-strong focus-within:bg-surface transition shadow-xs"
        >
          <textarea
            ref={inputRef}
            id="chat-input"
            rows={1}
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Mô tả công việc bạn muốn thực hiện"
            placeholder="Mô tả công việc bạn muốn thực hiện..."
            className="flex-1 bg-transparent px-3 py-2 text-sm leading-6 max-h-36 resize-none overflow-y-auto text-text placeholder-text-muted focus:outline-none"
          />
          <button
            type="submit"
            disabled={!inputVal.trim() || isPlanning}
            className="w-10 h-10 rounded-full bg-primary text-white flex items-center justify-center disabled:opacity-40 hover:bg-primary transition shadow-xs shrink-0"
          >
            <span className="text-xs font-semibold">Gửi</span>
          </button>
        </form>
        {isPlanning && <p role="status" className="max-w-3xl mx-auto text-xs text-text-secondary mt-1">Đang lập kế hoạch…</p>}
      </div>}
    </div>
  );
};
