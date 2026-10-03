import React from "react";
import { PlanoraMark } from "./Brand";
import type { MessageRole, MessageStatus } from "../types";

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
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={index} className="message-bold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={index} className="message-code">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part === "\n") {
      return <br key={index} />;
    }
    return <span key={index}>{part}</span>;
  });
}

export const MessageItem: React.FC<MessageItemProps> = ({
  role,
  content,
  status = "sent",
  timestamp,
  onRetry,
}) => {
  const date = timestamp ? new Date(timestamp) : null;
  const now = new Date();
  const validDate = date && !Number.isNaN(date.getTime());
  const pad = (value: number) => String(value).padStart(2, "0");
  const sameDay =
    validDate &&
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const timeLabel = validDate
    ? `${sameDay ? "" : `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} `}${pad(date.getHours())}:${pad(date.getMinutes())}`
    : "";
  const time = timeLabel && <time dateTime={timestamp}>{timeLabel}</time>;
  if (role === "user")
    return (
      <article className={"user-message chat-message " + status}>
        <div className="message-meta">
          <span className="avatar">B</span>
          <strong>Bạn</strong>
          {time}
        </div>
        <p>{content}</p>
        {status === "sending" && (
          <span className="small muted">Đang gửi...</span>
        )}
        {status === "failed" && (
          <p className="field-error">
            Gửi thất bại{" "}
            {onRetry && (
              <button className="text-button" onClick={onRetry}>
                Gửi lại
              </button>
            )}
          </p>
        )}
      </article>
    );
  return (
    <article
      className={
        "assistant-message chat-message " +
        (role === "system" ? "system-message" : "")
      }
    >
      <span className="ati-avatar">
        <PlanoraMark />
      </span>
      <div className="message-content">
        <div className="message-meta">
          <strong>{role === "system" ? "Thông báo" : "Planora"}</strong>
          {time}
        </div>
        <div>{renderFormattedContent(content)}</div>
      </div>
    </article>
  );
};
