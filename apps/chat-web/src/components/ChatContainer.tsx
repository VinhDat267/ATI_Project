import React, { useState, useRef, useEffect } from 'react';
import type { ChatMessage } from '../types';
import { MessageItem } from './MessageItem';

export interface ChatContainerProps {
  messages: ChatMessage[];
  onSendMessage: (content: string) => void;
  streamingText?: string;
  isStreaming?: boolean;
  children?: React.ReactNode;
}

export const ChatContainer: React.FC<ChatContainerProps> = ({
  messages,
  onSendMessage,
  streamingText,
  isStreaming,
  children,
}) => {
  const [inputVal, setInputVal] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    if (typeof messagesEndRef.current?.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingText]);

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

        {/* Injected cards (PlanPreview, GatherProgress, etc) */}
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
            type="text"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={handleKeyDown}
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
