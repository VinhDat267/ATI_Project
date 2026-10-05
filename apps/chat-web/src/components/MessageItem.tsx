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
        <strong key={index} className="font-semibold text-text">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={index}
          className="bg-surface-raised font-mono text-xs px-1.5 py-0.5 rounded text-primary-text"
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
          className={`rounded-2xl rounded-tr-sm px-4 py-3 text-sm leading-relaxed text-text shadow-xs ${
            status === 'failed'
              ? 'bg-danger-tint border border-border-strong'
              : status === 'sending'
              ? 'bg-surface-raised opacity-70'
              : 'bg-surface-raised'
          }`}
        >
          <div className="whitespace-pre-wrap">{content}</div>
        </div>

        <div className="flex items-center gap-2 mt-1 mr-1 text-sm text-text-muted">
          {status === 'sending' && <span>⏳ Đang gửi...</span>}
          {status === 'failed' && (
            <div className="flex items-center gap-1.5 text-danger-text font-medium">
              <span>❌ Gửi thất bại</span>
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="text-primary-text underline hover:text-primary-text cursor-pointer"
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
      <div className="w-7 h-7 rounded-full bg-primary-tint text-primary-text flex items-center justify-center font-bold text-xs shrink-0 mt-0.5 shadow-xs">
        AI
      </div>
      <div className="flex-1 text-sm leading-relaxed text-text">
        <div className="whitespace-pre-wrap">{renderFormattedContent(content)}</div>
        {time && (
          <div className="mt-1 text-sm text-text-muted">{time}</div>
        )}
      </div>
    </div>
  );
};
