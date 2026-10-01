import React from 'react';
import type { MessageRole, MessageStatus } from '../types';

export interface MessageItemProps {
  role: MessageRole;
  content: string;
  status?: MessageStatus;
  timestamp?: string;
  onRetry?: () => void;
}

// Simple lightweight markdown parser for bold, inline code, links
function renderFormattedContent(text: string) {
  const parts = text.split(/(\*\*.*?\*\*|`.*?`|\n)/g);

  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={index} className="font-semibold text-zinc-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={index}
          className="bg-zinc-100 font-mono text-xs px-1.5 py-0.5 rounded text-blue-700"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part === '\n') {
      return <br key={index} />;
    }
    return <span key={index}>{part}</span>;
  });
}

export const MessageItem: React.FC<MessageItemProps> = ({
  role,
  content,
  status = 'sent',
  timestamp,
  onRetry,
}) => {
  const date = timestamp ? new Date(timestamp) : null;
  const now = new Date();
  const validDate = date && !Number.isNaN(date.getTime());
  const pad = (value: number) => String(value).padStart(2, '0');
  const sameDay = validDate && date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  const timeLabel = validDate ? `${sameDay ? '' : `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} `}${pad(date.getHours())}:${pad(date.getMinutes())}` : '';
  const time = timeLabel && <time dateTime={timestamp}>{timeLabel}</time>;
  if (role === 'user') {
    return (
      <div className="flex flex-col items-end my-3 ml-auto max-w-[80%]">
        <div
          className={`rounded-2xl rounded-tr-sm px-4 py-3 text-sm leading-relaxed text-[#1d1d1f] shadow-xs ${
            status === 'failed'
              ? 'bg-red-50 border border-red-300'
              : status === 'sending'
              ? 'bg-[#e9e9eb] opacity-70'
              : 'bg-[#e9e9eb]'
          }`}
        >
          <div className="whitespace-pre-wrap">{content}</div>
        </div>

        <div className="flex items-center gap-2 mt-1 mr-1 text-[11px] text-zinc-400">
          {status === 'sending' && <span>⏳ Đang gửi...</span>}
          {status === 'failed' && (
            <div className="flex items-center gap-1.5 text-red-500 font-medium">
              <span>❌ Gửi thất bại</span>
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="text-[#0066cc] underline hover:text-blue-700 cursor-pointer"
                >
                  Gửi lại
                </button>
              )}
            </div>
          )}
          {time}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 my-4 max-w-[90%]">
      <div className="w-7 h-7 rounded-full bg-[#0071e3] text-white flex items-center justify-center font-bold text-xs shrink-0 mt-0.5 shadow-xs">
        AI
      </div>
      <div className="flex-1 text-sm leading-relaxed text-zinc-800">
        <div className="whitespace-pre-wrap">{renderFormattedContent(content)}</div>
        {time && (
          <div className="mt-1 text-[11px] text-zinc-400">{time}</div>
        )}
      </div>
    </div>
  );
};
