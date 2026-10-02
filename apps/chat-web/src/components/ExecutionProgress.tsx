import type { StepState } from "../types";
import { Icon } from "./Brand";
export interface ExecutionStepInfo {
  id: string;
  tool: string;
  description: string;
  status: StepState;
  duration?: string;
  output?: string;
  error?: string;
}
export interface ExecutionProgressProps {
  steps: ExecutionStepInfo[];
  title?: string;
}
const labels: Record<StepState, string> = {
  pending: "Chưa chạy",
  running: "Đang chạy",
  succeeded: "Thành công",
  failed: "Lỗi",
  paused: "Tạm dừng",
  skipped: "Đã bỏ qua",
  unknown: "Chưa rõ kết quả",
};
function Output({ text }: { text: string }) {
  let data: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      data = parsed;
  } catch {
    /* Plain provider output is preserved in details. */
  }
  const raw = data.url || data.html_url || data.permalink;
  let url: string | undefined;
  try {
    if (typeof raw === "string") {
      const candidate = new URL(raw);
      if (["http:", "https:"].includes(candidate.protocol))
        url = candidate.href;
    }
  } catch {
    /* Unsafe or malformed links remain text only. */
  }
  const title = data.title || data.name || data.text;
  return (
    <div className="output-summary">
      {typeof title === "string" && <p>{title}</p>}
      {url && (
        <a
          className="result-link"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Xem kết quả
          <Icon name="arrow" />
        </a>
      )}
      <details className="output-details">
        <summary>Chi tiết kết quả</summary>
        <pre>{text}</pre>
      </details>
    </div>
  );
}
export function ExecutionProgress({
  steps,
  title = "Tiến trình thực thi",
}: ExecutionProgressProps) {
  const completed =
    steps.length > 0 &&
    steps.every((s) => s.status === "succeeded" || s.status === "skipped");
  return (
    <section className="process-card">
      <div className="progress-header">
        <div>
          <div className="eyebrow">
            {completed ? "KẾT QUẢ THỰC THI" : "TIẾN TRÌNH"}
          </div>
          <h2>{completed ? "Kế hoạch đã đi đến đích." : title}</h2>
        </div>
        <span className="pill ghost">
          {steps.filter((s) => s.status === "succeeded").length}/{steps.length}{" "}
          hoàn thành
        </span>
      </div>
      {steps.map((step, index) => (
        <article className="progress-step" key={step.id}>
          <span
            className={
              "step-state " +
              (step.status === "succeeded"
                ? "done"
                : step.status === "running"
                  ? "active"
                  : step.status === "failed"
                    ? "error"
                    : step.status === "unknown"
                      ? "unknown"
                      : "")
            }
          >
            {step.status === "succeeded" ? (
              <Icon name="check" />
            ) : step.status === "running" ? (
              <span className="spinner" />
            ) : step.status === "unknown" ? (
              "?"
            ) : (
              String(index + 1).padStart(2, "0")
            )}
          </span>
          <div>
            <div className="step-tool">{step.tool}</div>
            <h3>{step.description}</h3>
            {step.duration && <p>{step.duration}</p>}
            {step.output && <Output text={step.output} />}{" "}
            {step.error && <p className="field-error">{step.error}</p>}
          </div>
          <span
            className={
              "pill " +
              (step.status === "unknown"
                ? "unknown"
                : step.status === "failed"
                  ? "error"
                  : "ghost")
            }
          >
            {labels[step.status]}
          </span>
        </article>
      ))}
    </section>
  );
}
