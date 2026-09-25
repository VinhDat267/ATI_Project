import type { ReactNode } from "react";
import { Banner } from "./Banner";
import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="flex flex-col items-center gap-4 rounded-md border border-hairline px-6 py-12 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-surface-strong">
        <Icon name={icon} size={20} />
      </span>
      <h2 className="m-0 text-headline-sm">{title}</h2>
      {children ? (
        <p className="m-0 max-w-measure-sm text-body-lg text-muted">{children}</p>
      ) : null}
      {action}
    </section>
  );
}

/** Load failure: says what failed and offers the one safe recovery (a GET). */
export function ErrorState({
  title = "Không tải được dữ liệu",
  error,
  onRetry,
}: {
  title?: string;
  error: unknown;
  onRetry?: () => void;
}) {
  const rawMessage =
    error instanceof Error ? error.message : "Không thể tải dữ liệu vào lúc này.";
  const message = /mã lỗi\s*(502|503|504)|Failed to fetch|ECONNREFUSED|NetworkError/i.test(
    rawMessage,
  )
    ? "Dịch vụ xử lý trung tâm đang khởi động hoặc tạm thời chưa kết nối. Vui lòng đợi vài giây rồi bấm Thử lại."
    : /mã lỗi\s*500/i.test(rawMessage)
      ? "Hệ thống gặp gián đoạn tạm thời khi xử lý yêu cầu. Vui lòng thử lại sau."
      : rawMessage;
  return (
    <div className="flex flex-col gap-3">
      <Banner tone="danger" icon="circle-x" title={title} live>
        {message}
      </Banner>
      {onRetry ? (
        <Button variant="secondary" className="self-start" onClick={onRetry}>
          Thử lại
        </Button>
      ) : null}
    </div>
  );
}

export function LoadingState({ label }: { label: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-body-md text-muted">
      <Icon name="loader-circle" className="animate-spin" />
      {label}
    </p>
  );
}
