import React, { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { ChatMessage } from '../../types';
import { runOrigin } from '../../services/schedule-text';
import { useSchedulesEnabled } from '../../hooks/use-schedules';
import { Brand } from '../components/Brand';

export interface PlanoraConversationFeedProps {
  messages: ChatMessage[];
  streamingText?: string;
  isStreaming?: boolean;
  children?: ReactNode;
  onResend?: (text: string) => void;
  schedulesEnabled?: boolean;
  isDrawerOpen?: boolean;
}

function planSummary(message: ChatMessage): string {
  const plan = message.metadata?.plan;
  if (message.metadata?.type === 'plan') {
    return plan
      ? `Kế hoạch ${plan.steps.length} việc đã sẵn sàng: ${plan.summary}`
      : 'Kế hoạch đã sẵn sàng trên sân khấu chính.';
  }
  if (['receipt', 'execution', 'execution_result', 'exec_done'].includes(message.metadata?.type ?? '')) {
    return 'Biên nhận công việc đã có trên sân khấu chính.';
  }
  return message.content;
}

export function PlanoraConversationFeed({
  messages,
  streamingText,
  isStreaming = false,
  children,
  schedulesEnabled,
  isDrawerOpen = false,
}: PlanoraConversationFeedProps) {
  const contextSchedulesEnabled = useSchedulesEnabled();
  const isSchedulesActive = schedulesEnabled !== undefined ? schedulesEnabled : (contextSchedulesEnabled || true);
  const areaRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);

  useLayoutEffect(() => {
    if (!areaRef.current) return;
    if (!messages.length) {
      areaRef.current.scrollTop = 0;
      nearBottom.current = true;
    } else if (nearBottom.current) {
      areaRef.current.scrollTop = areaRef.current.scrollHeight;
    }
  }, [messages.length, streamingText]);

  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const box = event.currentTarget;
    nearBottom.current = box.scrollHeight - box.clientHeight - box.scrollTop < 120;
  };

  return (
    <div
      ref={areaRef}
      id="chat-messages-container"
      role={isDrawerOpen ? undefined : 'log'}
      aria-live="polite"
      aria-label="Hội thoại"
      onScroll={handleScroll}
      className="planora-conversation-feed planora-chat-feed flex-1 overflow-y-auto min-h-0 w-full max-w-[var(--planora-chat-max-width)] mx-auto px-4 sm:px-6 py-6 space-y-5"
    >
      {messages.map((message) => {
        const isScheduleRun = isSchedulesActive && message.metadata?.type === 'schedule_run';
        const isUser = message.role === 'user' && !isScheduleRun;
        const isHighlight = ['plan', 'receipt', 'execution', 'execution_result', 'exec_done'].includes(
          message.metadata?.type ?? ''
        );
        const timestamp = message.timestamp ?? message.created_at;
        const validTime = !!timestamp && Number.isFinite(Date.parse(timestamp));

        const senderLabel = isUser
          ? 'Bạn'
          : isScheduleRun
            ? runOrigin(message.metadata?.name ?? '', message.metadata?.dueAt ?? '')
            : 'ATI';

        return (
          <div
            key={message.id}
            className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} space-y-1.5`}
          >
            <div className="flex items-center gap-2 text-[11px] text-[var(--planora-muted)] px-1">
              {!isUser && (
                <div
                  className="w-4 h-4 rounded-full bg-[var(--planora-primary)] text-[var(--planora-on-primary)] grid place-items-center"
                  aria-hidden="true"
                >
                  <Brand size="sm" showWordmark={false} />
                </div>
              )}
              <span className="font-medium">{senderLabel}</span>
              {validTime && (
                <>
                  <span>·</span>
                  <time dateTime={timestamp}>
                    {new Date(timestamp!).toLocaleString('vi-VN', { hour12: false })}
                  </time>
                </>
              )}
            </div>

            <div
              className={
                isUser
                  ? 'max-w-[85%] bg-[var(--planora-primary-soft)] text-[var(--planora-text)] border border-[var(--planora-divider)] p-3.5 sm:p-4 rounded-2xl rounded-tr-none text-sm leading-relaxed [overflow-wrap:anywhere]'
                  : isHighlight
                    ? 'max-w-[88%] bg-[var(--planora-paper)] text-[var(--planora-text)] border border-[var(--planora-pending-border,#f5c07a)] p-3.5 sm:p-4 rounded-2xl rounded-tl-none text-sm leading-relaxed shadow-sm [overflow-wrap:anywhere]'
                    : 'max-w-[88%] bg-[var(--planora-paper)] text-[var(--planora-text)] border border-[var(--planora-divider)] p-3.5 sm:p-4 rounded-2xl rounded-tl-none text-sm leading-relaxed shadow-sm [overflow-wrap:anywhere]'
              }
            >
              <p
                className={
                  isHighlight
                    ? 'font-semibold text-[var(--planora-primary)] [overflow-wrap:anywhere]'
                    : 'whitespace-pre-wrap [overflow-wrap:anywhere]'
                }
              >
                {planSummary(message)}
              </p>
            </div>

            {message.status === 'sending' && (
              <span className="text-[11px] text-[var(--planora-muted)] px-1">Đang gửi…</span>
            )}
            {message.status === 'failed' && (
              <span className="text-[11px] text-[var(--planora-error-text,#9a3f32)] px-1">Gửi thất bại</span>
            )}
          </div>
        );
      })}

      {isStreaming && (
        <div className="flex flex-col items-start space-y-1.5">
          <div className="flex items-center gap-2 text-[11px] text-[var(--planora-muted)] px-1">
            <div
              className="w-4 h-4 rounded-full bg-[var(--planora-primary)] text-[var(--planora-on-primary)] grid place-items-center"
              aria-hidden="true"
            >
              <Brand size="sm" showWordmark={false} />
            </div>
            <span className="font-medium">ATI</span>
          </div>
          <div className="max-w-[88%] bg-[var(--planora-paper)] text-[var(--planora-text)] border border-[var(--planora-divider)] p-3.5 sm:p-4 rounded-2xl rounded-tl-none text-sm leading-relaxed shadow-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
            {streamingText || 'Đang xử lý…'}
          </div>
        </div>
      )}

      {/* Active turn (current card / stage / suggestion) */}
      {children}

      {!messages.length && !isStreaming && !children && (
        <p className="text-xs text-[var(--planora-muted)] py-4 text-center">Chưa có tin nhắn nào</p>
      )}
    </div>
  );
}

export default PlanoraConversationFeed;
