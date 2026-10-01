import React, { useState, useRef, useEffect } from 'react';
import type {
  ChatMessage,
  ClarificationState,
  GatherState,
} from '../types';
import { useChatStore } from '../store/chat-store';
import { MessageItem } from './MessageItem';
import { GatherProgress } from './GatherProgress';
import { ClarificationCard } from './ClarificationCard';

export interface ChatContainerProps {
  messages: ChatMessage[];
  onSendMessage: (content: string) => void;
  streamingText?: string;
  isStreaming?: boolean;
  gatherState?: GatherState | null;
  activeClarification?: ClarificationState | null;
  onClearClarification?: () => void;
  children?: React.ReactNode;
}

export const ChatContainer: React.FC<ChatContainerProps> = ({
  messages,
  onSendMessage,
  streamingText,
  isStreaming,
  gatherState: propGatherState,
  activeClarification: propActiveClarification,
  onClearClarification,
  children,
}) => {
  const [inputVal, setInputVal] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const scrollToBottom = () => {
    if (typeof messagesEndRef.current?.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingText, gatherState, activeClarification]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputVal.trim()) {
      onSendMessage(inputVal.trim());
      setInputVal('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white relative">
      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 pb-28 max-w-3xl mx-auto w-full">
        {messages.map((msg) => (
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
        {gatherState &&
          (gatherState.isGathering || gatherState.steps.length > 0) && (
            <GatherProgress
              summary={gatherState.summary}
              steps={gatherState.steps}
            />
          )}

        {/* Clarification Card */}
        {activeClarification && (
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

        <div ref={messagesEndRef} />
      </div>

      {/* Fixed/Docked Bottom Input Bar */}
      <div className="border-t border-zinc-200 bg-white p-3 md:p-4 sticky bottom-0 z-20">
        <form
          onSubmit={handleSubmit}
          className="max-w-3xl mx-auto flex items-center gap-2 bg-[#f5f5f7] border border-zinc-200 rounded-2xl p-1.5 focus-within:border-blue-500 focus-within:bg-white transition shadow-xs"
        >
          <input
            ref={inputRef}
            id="chat-input"
            type="text"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Mô tả công việc bạn muốn thực hiện"
            placeholder="Mô tả công việc bạn muốn thực hiện..."
            className="flex-1 bg-transparent px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!inputVal.trim()}
            className="w-10 h-10 rounded-full bg-[#0071e3] text-white flex items-center justify-center disabled:opacity-40 hover:bg-blue-600 transition shadow-xs shrink-0"
          >
            <span className="text-xs font-semibold">Gửi</span>
          </button>
        </form>
      </div>
    </div>
  );
};
