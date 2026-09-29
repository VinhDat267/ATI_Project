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
    name: "Dữ liệu nhóm (Task Hub)",
    body: "Quản lý dữ liệu bảng tính, thẻ công việc và kênh trao đổi nội bộ.",
    off: "Khi máy chủ này không kết nối, yêu cầu đọc hoặc ghi bảng tính, thẻ và tin nhắn sẽ không lập được kế hoạch.",
  },
  filesystem: {
    name: "Hệ thống tệp (Filesystem)",
    body: "Đọc và ghi tệp trong thư mục làm việc an toàn được phân quyền.",
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
            Hệ thống chỉ kích hoạt các công cụ và kết nối đã được kiểm duyệt an toàn. Mọi quyền truy cập tuân thủ nguyên tắc fail-closed.
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
              <li key={server.slug} className="flex flex-col gap-3 rounded-md border border-hairline bg-surface-soft p-6 shadow-card transition-shadow duration-150 hover:shadow-lg">
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
                    Máy chủ công cụ đang hoạt động bình thường theo chính sách kiểm soát an toàn.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {/* SaaS Pilot v2 Connectors Section */}
      <section className="mt-8 flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="m-0 text-headline-sm">Đầu nối dịch vụ SaaS Pilot v2</h2>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-success/20 bg-success-subtle px-2.5 py-0.5 text-badge text-success">
              <span className="size-1.5 rounded-full bg-success" />
              Đã kiểm định
            </span>
          </div>
          <p className="m-0 text-body-md text-muted">
            Các cổng kết nối trực tiếp đến dịch vụ đám mây thực tế, bảo vệ bởi chính sách Single Remote Write và kiểm tra danh sách miền cho phép (Egress Allowlist).
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Google Sheets Connector */}
          <div className="flex flex-col gap-3 rounded-md border border-hairline bg-surface-soft p-4 sm:p-5 shadow-card">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-success-subtle text-success">
                  <Icon name="table" size={18} />
                </span>
                <div className="min-w-0">
                  <h3 className="m-0 text-title-md font-semibold text-ink">Google Sheets</h3>
                  <p className="m-0 font-mono text-caption text-muted truncate">sheets.googleapis.com</p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-surface-strong px-2 py-0.5 text-caption font-medium text-ink shrink-0">
                <Icon name="circle-check" size={12} className="text-success" />
                Chỉ đọc (Read-only)
              </span>
            </div>
            <p className="m-0 text-body-sm text-muted">
              Đọc dữ liệu hàng theo phạm vi bảng tính và tab ID được phê duyệt trước. Không thực hiện bất kỳ thao tác ghi nào lên trang tính gốc.
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2 border-t border-hairline pt-3 text-caption text-muted">
              <span className="font-mono bg-canvas px-2 py-0.5 rounded border border-hairline text-caption break-all">google_sheets.read_rows</span>
              <span>· Giới hạn: 5 MB</span>
            </div>
          </div>

          {/* Trello Workspace Connector */}
          <div className="flex flex-col gap-3 rounded-md border border-hairline bg-surface-soft p-4 sm:p-5 shadow-card">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-action-subtle text-action">
                  <Icon name="kanban" size={18} />
                </span>
                <div className="min-w-0">
                  <h3 className="m-0 text-title-md font-semibold text-ink">Trello Workspace</h3>
                  <p className="m-0 font-mono text-caption text-muted truncate">api.trello.com</p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-action-subtle px-2 py-0.5 text-caption font-medium text-action shrink-0">
                <Icon name="shield-check" size={12} className="text-action" />
                Single Remote Write
              </span>
            </div>
            <p className="m-0 text-body-sm text-muted">
              Tra cứu thẻ và tạo thẻ công việc mới khi có phê duyệt rõ ràng từ người vận hành (Human-in-the-Loop). Nghiêm cấm ghi mù khi timeout.
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2 border-t border-hairline pt-3 text-caption text-muted">
              <span className="font-mono bg-canvas px-2 py-0.5 rounded border border-hairline text-caption break-all">trello.create_card</span>
              <span className="font-mono bg-canvas px-2 py-0.5 rounded border border-hairline text-caption break-all">trello.get_card</span>
              <span>· TTL: 10 phút</span>
            </div>
          </div>
        </div>
      </section>

      <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <a href={routeToHash({ page: "pilot-new" })} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sm bg-ink px-4 text-button-sm font-semibold text-on-primary no-underline shadow-sm transition-colors hover:bg-ink/90 text-center">
          <span>Khởi tạo quy trình Pilot v2</span>
          <Icon name="arrow-right" size={15} />
        </a>
        <a href={routeToHash({ page: "new" })} className="inline-flex min-h-11 items-center justify-center text-button-sm text-muted hover:text-ink text-center">
          Tạo yêu cầu AI tự do
        </a>
      </div>
    </>
  );
}
