import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from "react";
import type { RequestDraft } from "../../core/draft.js";
import { navigate, routeToHash } from "../../core/navigation.js";
import { formatClock, shortId } from "../../core/presentation.js";
import { serversQuery } from "../../core/queries.js";
import { cn } from "@/lib/cn";
import { useApp } from "../context";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";
import { Icon, type IconName } from "../components/Icon";

const MAX_PROMPT = 4000;
const KEY_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

const SUGGESTIONS = [
  { label: "Chép dòng tiến độ sang bảng báo cáo", text: "Chép tiến độ tuần này từ “Tiến độ nhóm” sang “Báo cáo tuần”, rồi báo vào #nhom-ati" },
  { label: "Tạo thẻ công việc mới trong Backlog", text: "Tạo thẻ “Chuẩn bị slide demo” trong Backlog của board_a, hạn 25/09/2026" },
  { label: "Gửi tiêu đề một thẻ vào kênh nhóm", text: "Đọc thẻ c1 và gửi tiêu đề vào #nhom-ati" },
  { label: "Liệt kê thẻ đã xong tuần này", text: "Liệt kê thẻ đã xong tuần này trên board_a" },
];

type InputType = "string" | "number" | "boolean";
interface InputRow {
  id: number;
  key: string;
  type: InputType;
  value: string;
}

function parseInputs(rows: InputRow[]): {
  values: Record<string, string | number | boolean>;
  errors: Map<number, string>;
} {
  const values: Record<string, string | number | boolean> = {};
  const errors = new Map<number, string>();
  for (const row of rows) {
    if (!KEY_PATTERN.test(row.key)) {
      errors.set(row.id, "Khoá dùng chữ thường, số, gạch dưới và bắt đầu bằng chữ");
      continue;
    }
    if (row.key in values) {
      errors.set(row.id, "Khoá bị trùng");
      continue;
    }
    if (row.type === "number") {
      const n = Number(row.value);
      if (row.value.trim() === "" || !Number.isFinite(n)) {
        errors.set(row.id, "Giá trị phải là số");
        continue;
      }
      values[row.key] = n;
    } else if (row.type === "boolean") {
      values[row.key] = row.value === "true";
    } else {
      values[row.key] = row.value;
    }
  }
  return { values, errors };
}

function OriginBanner({ draft }: { draft: RequestDraft }) {
  const origin = draft.origin;
  if (!origin) return null;
  const id = shortId(origin.runId);
  const back = (
    <a
      href={routeToHash({ page: "run", id: origin.runId })}
      className="mt-1 inline-flex min-h-11 items-center self-start text-button-sm text-current"
    >
      Xem lại lần chạy {id}
    </a>
  );
  switch (origin.reason) {
    case "reconcile_not_seen":
      return (
        <Banner id="origin-banner" tone="unknown" icon="triangle-alert" title={`Tạo lại từ lần chạy ${id} · bạn trả lời “Không thấy”`}>
          <span className="flex flex-col">
            Yêu cầu dưới đây ghi lại đủ các dòng và gửi thông báo. Nếu các dòng xuất hiện trên bảng trước khi bạn duyệt, hãy từ chối kế hoạch để tránh ghi trùng.
            {back}
          </span>
        </Banner>
      );
    case "reconcile_seen":
    case "reconcile_confirmed":
      return (
        <Banner id="origin-banner" tone="soft" icon="history" title={`Tạo lại từ lần chạy ${id} · ${origin.reason === "reconcile_seen" ? "bạn trả lời “Đã thấy”" : "nơi nhận đã xác nhận"}`}>
          <span className="flex flex-col">
            Các dòng đã có trên nơi nhận, nên yêu cầu này chỉ gửi thông báo và không ghi lại dòng nào.
            {back}
          </span>
        </Banner>
      );
    default:
      return (
        <Banner id="origin-banner" tone="soft" icon="history" title={`Dùng lại yêu cầu của lần chạy ${id}`}>
          <span className="flex flex-col">
            {origin.reason === "expired"
              ? "Lần chạy đó hết hạn duyệt và chưa ghi gì. Hệ thống sẽ đọc lại dữ liệu và lập bản xem trước mới, nên kết quả có thể khác lần trước."
              : origin.reason === "failed"
                ? "Lần chạy đó thất bại. Sửa phần gây lỗi trước khi lập kế hoạch lại."
                : "Bổ sung thông tin hệ thống đã hỏi rồi lập kế hoạch lại."}
            {back}
          </span>
        </Banner>
      );
  }
}

function Capabilities() {
  const { transport, generation } = useApp();
  const servers = useQuery(serversQuery(transport, generation));
  const status = (slug: string) => servers.data?.find((s) => s.slug === slug)?.status;
  const hub = status("task_hub") === "connected";
  const files = status("filesystem") === "connected";
  const items: Array<{ icon: IconName; title: string; body: string; on: boolean; badgeColor: string }> = [
    { icon: "table", title: "Bảng tính", body: "Đọc vùng dữ liệu · thêm dòng", on: hub, badgeColor: "bg-success-subtle text-success" },
    { icon: "kanban", title: "Thẻ công việc", body: "Xem thẻ, thành viên · tạo và chuyển thẻ", on: hub, badgeColor: "bg-planner-subtle text-planner" },
    { icon: "message", title: "Tin nhắn", body: "Gửi thông báo vào kênh", on: hub, badgeColor: "bg-progress-subtle text-progress" },
    { icon: "file", title: "Tệp", body: "Đọc và ghi tệp", on: files, badgeColor: "bg-action-subtle text-action" },
  ];
  return (
    <aside aria-labelledby="capabilities-title" className="flex flex-col gap-6">
      <section className="flex flex-col gap-4 rounded-md border border-hairline bg-surface-soft p-6 shadow-card">
        <h2 id="capabilities-title" className="m-0 text-title-md">
          Hệ thống làm được gì
        </h2>
        {servers.isPending ? (
          <p className="m-0 text-body-sm text-muted">Đang kiểm tra kết nối…</p>
        ) : servers.isError ? (
          <p className="m-0 text-body-sm text-danger">Chưa kiểm tra được kết nối. Xem Công cụ &amp; kết nối.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {items.map((item) => (
              <li key={item.title} className="flex gap-3">
                <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", item.badgeColor)}>
                  <Icon name={item.icon} />
                </span>
                <span className="flex flex-col">
                  <span className="text-title-md">{item.title}</span>
                  <span className={cn("text-body-sm", item.on ? "text-muted" : "text-neutral")}>
                    {item.body}
                    {item.on ? "" : " · đang tắt"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {servers.dataUpdatedAt ? (
          <p className="m-0 text-caption text-muted">
            Kiểm tra lúc {formatClock(new Date(servers.dataUpdatedAt).toISOString(), "Asia/Ho_Chi_Minh")}
          </p>
        ) : null}
        <a href={routeToHash({ page: "tools" })} className="inline-flex min-h-11 items-center self-start text-button-sm text-primary font-semibold underline underline-offset-3">
          Xem Công cụ &amp; kết nối
        </a>
      </section>
      <section className="flex flex-col gap-3 rounded-md border border-hairline bg-surface-soft p-6 shadow-card">
        <h2 className="m-0 text-title-md">Trước khi có gì bị ghi</h2>
        <ol className="m-0 flex flex-col gap-2 pl-5 text-body-md text-muted">
          <li>Bạn xem kế hoạch và dữ liệu đã đọc</li>
          <li>Bạn thấy đích và nội dung sẽ ghi</li>
          <li>Bạn duyệt trong thời hạn máy chủ đặt</li>
        </ol>
      </section>
    </aside>
  );
}

/** V03 — compose a request; recovery links arrive here with a prefilled draft. */
export function NewRunView() {
  const { drafts, controllers } = useApp();
  const createRun = controllers.getCreateRun();
  const createSnapshot = useSyncExternalStore(
    createRun.subscribe,
    createRun.getSnapshot,
    createRun.getSnapshot,
  );
  // Read in the initializer, clear in an effect: StrictMode may call the
  // initializer twice, and take() would hand the draft to the discarded one.
  const [draft] = useState<RequestDraft | null>(() => drafts.get());
  useEffect(() => drafts.clear(), [drafts]);
  const [prompt, setPrompt] = useState(draft?.prompt ?? "");
  const [timeZone, setTimeZone] = useState("Asia/Ho_Chi_Minh");
  const [rows, setRows] = useState<InputRow[]>([]);
  const [promptError, setPromptError] = useState<string | null>(null);
  const nextRow = useRef(1);
  const hintId = useId();
  const parsed = parseInputs(rows);
  const isLocked =
    createSnapshot.status === "submitting" ||
    createSnapshot.status === "confirming";

  const submit = async (event?: FormEvent<HTMLFormElement>): Promise<void> => {
    event?.preventDefault();
    if (isLocked) {
      return;
    }
    const text = prompt.trim();
    if (!text) {
      setPromptError("Nhập yêu cầu trước khi lập kế hoạch.");
      return;
    }
    if (text.length > MAX_PROMPT) {
      setPromptError(`Yêu cầu dài quá ${MAX_PROMPT} ký tự.`);
      return;
    }
    if (parsed.errors.size > 0) return;
    setPromptError(null);
    const accepted = await createRun.submit({
      source_prompt: text,
      inputs: parsed.values,
      time_zone: timeZone,
    });
    if (accepted) {
      drafts.clear();
      navigate({ page: "run", id: accepted.run_id });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void submit();
    }
  };

  const describedBy = cn(draft?.origin && "origin-banner", hintId, promptError && "prompt-error");

  return (
    <div className="grid gap-12 desk:grid-run">
      <form onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-6" aria-labelledby="new-title">
        <div className="flex flex-col gap-2.5">
          <h1 id="new-title" className="m-0 text-display-md-mobile desk:text-display-md">
            Bạn muốn hệ thống làm gì?
          </h1>
          <p className="m-0 max-w-measure text-body-lg text-muted">
            Mô tả công việc bằng tiếng Việt hoặc tiếng Anh. Hệ thống đề xuất kế hoạch và cho bạn xem trước đích, nội dung sẽ ghi — chưa có gì bị ghi ở bước này.
          </p>
        </div>

        {createSnapshot.status === "confirming" ? (
          <Banner tone="unknown" icon="triangle-alert" title="Chưa xác nhận được lần chạy đã được tạo hay chưa" live>
            <span className="flex flex-col gap-2">
              <span>
                Máy chủ không phản hồi sau khi bạn bấm “Lập kế hoạch”
                {createSnapshot.lostAt ? ` lúc ${createSnapshot.lostAt}` : ""}.
                Yêu cầu có thể đã được nhận. Hệ thống không tự gửi lại để tránh tạo lần chạy trùng.
              </span>
              <div className="flex flex-wrap items-center gap-3 mt-1">
                <a
                  href={routeToHash({ page: "history" })}
                  className="inline-flex min-h-11 items-center self-start text-button-sm text-current"
                >
                  Mở Lần chạy để kiểm tra
                </a>
              </div>
            </span>
          </Banner>
        ) : createSnapshot.status === "error" && createSnapshot.error ? (
          <Banner tone="danger" icon="triangle-alert" title="Không thể gửi yêu cầu">
            <span>{createSnapshot.error.message}</span>
          </Banner>
        ) : draft ? (
          <OriginBanner draft={draft} />
        ) : null}

        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-4">
            <label htmlFor="request" className="text-title-md">
              Yêu cầu
            </label>
            <span className={cn("tabular text-caption", prompt.length > MAX_PROMPT ? "text-danger" : "text-muted")}>
              {prompt.length} / {MAX_PROMPT}
            </span>
          </div>
          <div
            className={cn(
              "rounded-md border bg-surface-soft shadow-card focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus-ring transition-shadow",
              promptError ? "border-danger" : "border-hairline hover:border-border-control",
            )}
          >
            <textarea
              id="request"
              rows={5}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={onKeyDown}
              disabled={isLocked}
              aria-describedby={describedBy}
              aria-invalid={promptError ? true : undefined}
              className="block min-h-38 w-full resize-y rounded-md border-0 bg-transparent p-4 text-body-lg caret-primary outline-none focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>
          {promptError ? (
            <p id="prompt-error" role="alert" className="m-0 text-body-sm text-danger">
              {promptError}
            </p>
          ) : null}
          <p id={hintId} className="m-0 text-body-sm text-muted">
            Nêu rõ lấy dữ liệu ở đâu, ghi vào đâu và cần thông báo gì.
          </p>
        </div>

        <section aria-labelledby="suggest-title" className="flex flex-col gap-2">
          <h2 id="suggest-title" className="m-0 text-body-sm text-muted">
            Gợi ý để bắt đầu · chọn để chèn vào ô, rồi sửa tuỳ ý
          </h2>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((item) => (
              <button
                key={item.label}
                type="button"
                disabled={isLocked}
                onClick={() => {
                  setPrompt(item.text);
                  document.getElementById("request")?.focus();
                }}
                className="inline-flex min-h-11 items-center rounded-full border border-hairline bg-surface-soft px-4 text-button-sm text-ink shadow-card transition-all hover:border-ink hover:shadow-lg disabled:pointer-events-none disabled:opacity-50"
              >
                {item.label}
              </button>
            ))}
          </div>
        </section>

        <details className="group rounded-md border border-hairline bg-surface-soft shadow-card">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 [&::-webkit-details-marker]:hidden">
            <span className="text-button-sm">Tuỳ chọn nâng cao</span>
            <span className="flex items-center gap-2 text-body-sm text-muted">
              Múi giờ: {timeZone} · {rows.length} giá trị đầu vào
              <Icon name="chevron-down" className="text-ink transition-transform group-open:rotate-180" />
            </span>
          </summary>
          <div className="flex flex-col gap-4 border-t border-hairline p-4">
            <label className="flex flex-col gap-2">
              <span className="text-title-md">Múi giờ</span>
              <select
                value={timeZone}
                disabled={isLocked}
                onChange={(event) => setTimeZone(event.target.value)}
                className="h-12 rounded-sm border border-border-control bg-canvas px-3 text-body-lg disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="Asia/Ho_Chi_Minh">Asia/Ho_Chi_Minh (UTC+7)</option>
                <option value="UTC">UTC</option>
              </select>
            </label>
            <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
              <legend className="mb-2 text-title-md">Giá trị đầu vào</legend>
              {rows.map((row) => {
                const error = parsed.errors.get(row.id);
                const update = (patch: Partial<InputRow>) =>
                  setRows((current) => current.map((r) => (r.id === row.id ? { ...r, ...patch } : r)));
                return (
                  <div key={row.id} className="flex flex-col gap-1">
                    <div className="grid gap-2 desk:grid-cols-4">
                      <input aria-label="Khoá" disabled={isLocked} value={row.key} onChange={(e) => update({ key: e.target.value })} className="h-12 rounded-sm border border-border-control px-3 font-mono text-mono-md disabled:cursor-not-allowed disabled:opacity-60" />
                      <select aria-label="Kiểu" disabled={isLocked} value={row.type} onChange={(e) => update({ type: e.target.value as InputType, value: e.target.value === "boolean" ? "true" : "" })} className="h-12 rounded-sm border border-border-control bg-canvas px-3 text-body-lg disabled:cursor-not-allowed disabled:opacity-60">
                        <option value="string">Chuỗi</option>
                        <option value="number">Số</option>
                        <option value="boolean">Đúng/sai</option>
                      </select>
                      {row.type === "boolean" ? (
                        <select aria-label="Giá trị" disabled={isLocked} value={row.value} onChange={(e) => update({ value: e.target.value })} className="h-12 rounded-sm border border-border-control bg-canvas px-3 text-body-lg disabled:cursor-not-allowed disabled:opacity-60">
                          <option value="true">Đúng</option>
                          <option value="false">Sai</option>
                        </select>
                      ) : (
                        <input aria-label="Giá trị" disabled={isLocked} value={row.value} inputMode={row.type === "number" ? "decimal" : undefined} onChange={(e) => update({ value: e.target.value })} className="h-12 rounded-sm border border-border-control px-3 text-body-lg disabled:cursor-not-allowed disabled:opacity-60" />
                      )}
                      <Button variant="link" size="inline" disabled={isLocked} onClick={() => setRows((current) => current.filter((r) => r.id !== row.id))}>
                        Xoá giá trị
                      </Button>
                    </div>
                    {error ? <p className="m-0 text-body-sm text-danger">{error}</p> : null}
                  </div>
                );
              })}
              <Button
                variant="secondary"
                size="sm"
                disabled={isLocked}
                className="self-start"
                onClick={() => setRows((current) => [...current, { id: nextRow.current++, key: "", type: "string", value: "" }])}
              >
                <Icon name="plus" />
                Thêm giá trị
              </Button>
            </fieldset>
          </div>
        </details>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-4">
            <Button
              type="submit"
              disabled={
                createSnapshot.status === "submitting" ||
                createSnapshot.status === "confirming"
              }
              aria-busy={createSnapshot.status === "submitting"}
            >
              {createSnapshot.status === "submitting"
                ? "Đang gửi…"
                : createSnapshot.status === "confirming"
                  ? "Chờ xác nhận…"
                  : "Lập kế hoạch"}
            </Button>
            <span className="text-body-sm text-muted">hoặc Ctrl + Enter</span>
          </div>
          <p className="m-0 max-w-measure-sm text-body-sm text-muted">
            {createSnapshot.status === "confirming"
              ? "Trạng thái chưa rõ. Kiểm tra Lần chạy hoặc chờ hệ thống xác nhận trước khi tiếp tục."
              : "Chưa có dữ liệu nào bị ghi ở bước này. Kế hoạch có thể hiểu sai, hỏi lại hoặc từ chối yêu cầu — bạn luôn xem trước khi duyệt. Nháp không được lưu khi rời trang."}
          </p>
        </div>
      </form>
      <Capabilities />
    </div>
  );
}
