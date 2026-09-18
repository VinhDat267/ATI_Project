import { useQuery } from "@tanstack/react-query";
import { routeToHash } from "../../core/navigation.js";
import { formatClock, type Tone } from "../../core/presentation.js";
import { serversQuery } from "../../core/queries.js";
import type { Servers } from "../../core/contracts.js";
import { cn } from "@/lib/cn";
import { useApp } from "../context";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";
import { Icon, type IconName } from "../components/Icon";
import { LoadingState } from "../components/States";
import { TONE_CLASSES } from "../components/tone";

type ServerStatus = Servers[number]["status"];

const STATUS: Record<ServerStatus, { label: string; tone: Tone; icon: IconName }> = {
  connected: { label: "Đã kết nối", tone: "success", icon: "circle-check" },
  disconnected: { label: "Đang tắt theo cấu hình", tone: "neutral", icon: "circle-slash" },
  error: { label: "Lỗi kết nối", tone: "danger", icon: "circle-x" },
  unreviewed: { label: "Chưa được duyệt", tone: "unknown", icon: "triangle-alert" },
};

const SERVERS: Record<string, { name: string; body: string; off: string }> = {
  task_hub: {
    name: "Dữ liệu nhóm",
    body: "Bảng tính, thẻ công việc và tin nhắn local.",
    off: "Khi máy chủ này không kết nối, yêu cầu đọc hoặc ghi bảng tính, thẻ và tin nhắn sẽ không lập được kế hoạch.",
  },
  filesystem: {
    name: "Tệp cục bộ",
    body: "Đọc và ghi tệp trong thư mục đã cho phép.",
    off: "Máy chủ này chỉ bật khi hệ thống được khởi chạy với chính sách filesystem đã duyệt; không bật được từ giao diện. Khi đang tắt, yêu cầu cần đọc hoặc ghi tệp sẽ không lập được kế hoạch.",
  },
};

/** V06 — reviewed tool servers and their connection state (GET /servers). */
export function ToolsView() {
  const { transport, generation } = useApp();
  const servers = useQuery(serversQuery(transport, generation));
  const checkedAt = servers.dataUpdatedAt
    ? formatClock(new Date(servers.dataUpdatedAt).toISOString(), "Asia/Ho_Chi_Minh")
    : null;
  // A failed refresh keeps the last result but must not look healthy.
  const stale = servers.isError && servers.data !== undefined;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex max-w-measure flex-col gap-1">
          <h1 className="m-0 text-display-md-mobile desk:text-display-md">Công cụ &amp; kết nối</h1>
          <p className="m-0 text-body-lg text-muted">
            Hệ thống chỉ dùng các máy chủ công cụ local đã review. Quyền đọc/ghi do chính sách của ứng dụng quyết định.
          </p>
          {checkedAt ? (
            <p className="m-0 tabular text-body-sm text-muted">
              {servers.data?.length ?? 0} máy chủ · Kiểm tra lúc {checkedAt}
              {stale ? " · có thể đã cũ" : ""}
            </p>
          ) : null}
        </div>
        <Button variant="secondary" size="sm" disabled={servers.isFetching} onClick={() => void servers.refetch()}>
          <Icon name="refresh-cw" className={cn(servers.isFetching && "animate-spin")} />
          {servers.isFetching ? "Đang kiểm tra…" : "Kiểm tra lại"}
        </Button>
      </div>

      {servers.isError ? (
        <Banner tone="danger" icon="circle-x" title="Kiểm tra kết nối thất bại" live>
          {stale
            ? "Đang hiển thị kết quả lần kiểm tra trước, có thể đã cũ. Bấm “Kiểm tra lại” để thử một lần nữa."
            : "Chưa có kết quả nào. Bấm “Kiểm tra lại” để thử một lần nữa."}
        </Banner>
      ) : null}

      {servers.isPending ? (
        <LoadingState label="Đang kiểm tra kết nối…" />
      ) : servers.data ? (
        <ul className="m-0 flex list-none flex-col gap-4 p-0">
          {servers.data.map((server) => {
            const meta = SERVERS[server.slug] ?? { name: server.slug, body: "", off: "" };
            const status = STATUS[server.status];
            return (
              <li key={server.slug} className="flex flex-col gap-3 rounded-md border border-hairline p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-col gap-0.5">
                    <h2 className="m-0 text-headline-sm">
                      {meta.name} <span className="font-mono text-mono-md font-normal text-muted">{server.slug}</span>
                    </h2>
                    {meta.body ? <p className="m-0 text-body-md text-muted">{meta.body}</p> : null}
                  </div>
                  <span
                    className={cn(
                      "inline-flex h-6.5 items-center gap-1.5 rounded-full px-2.5 text-badge",
                      stale ? TONE_CLASSES.neutral : TONE_CLASSES[status.tone],
                    )}
                  >
                    <Icon name={stale ? "clock" : status.icon} size={14} />
                    {stale ? `${status.label} (lần kiểm tra trước)` : status.label}
                  </span>
                </div>
                <p className="m-0 text-body-sm text-muted">
                  Chính sách {server.policy_version ?? "chưa có"}
                </p>
                {server.status !== "connected" && meta.off ? (
                  <p className="m-0 max-w-measure text-body-md">{meta.off}</p>
                ) : null}
                {server.status === "connected" ? (
                  <p className="m-0 text-body-sm text-muted">
                    Danh sách công cụ chi tiết cần API catalog, chưa nối ở bản mô phỏng này.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      <a href={routeToHash({ page: "new" })} className="inline-flex min-h-11 items-center self-start text-button-sm">
        Đã sẵn sàng? Tạo yêu cầu
      </a>
    </>
  );
}
