import React from "react";
import type { PlanStep } from "../types";
import { Icon } from "./Brand";

export interface PlanStepItemProps {
  step: PlanStep;
  index: number;
  isLast?: boolean;
}

/** "step_1.output.url" -> "‹kết quả step_1: url›" */
function describeReference(path: string): string {
  const [stepId, , ...field] = path.split(".");
  return `‹kết quả ${stepId}${field.length ? `: ${field.join(".")}` : ""}›`;
}

/** What an argument will carry, so the reviewer approves text they can read. */
export function formatArgValue(value: unknown): {
  text: string;
  isRef: boolean;
} {
  if (typeof value === "string" && value.startsWith("$step_"))
    return { text: value, isRef: true };
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const { $ref, $template } = value as {
      $ref?: unknown;
      $template?: unknown;
    };
    if (typeof $ref === "string")
      return { text: describeReference($ref), isRef: true };
    if (typeof $template === "string") {
      return {
        text: $template.replace(/\$\{([^}]+)\}/g, (_, path: string) =>
          describeReference(path),
        ),
        isRef: false,
      };
    }
    return { text: JSON.stringify(value), isRef: false };
  }
  if (Array.isArray(value)) {
    return {
      text: value.map((item) => formatArgValue(item).text).join(", "),
      isRef: false,
    };
  }
  return { text: String(value), isRef: false };
}

const writes = new Set([
  "trello.create_card",
  "trello.add_member",
  "trello.add_checklist",
  "trello.update_card",
  "slack.send_message",
  "github.create_issue",
  "github.add_label",
]);
const reads = new Set([
  "trello.search_boards",
  "trello.search_lists",
  "trello.search_members",
  "trello.search_cards",
  "trello.get_card",
  "slack.search_channels",
  "github.search_repos",
  "github.search_issues",
  "github.get_issue",
]);
const argLabels: Record<string, string> = {
  listId: "Danh sách (ID)",
  boardId: "Bảng (ID)",
  cardId: "Thẻ (ID)",
  memberId: "Thành viên (ID)",
  channel: "Kênh",
  repo: "Repository",
  owner: "Chủ repository",
  title: "Tiêu đề",
  name: "Tên",
  body: "Nội dung",
  description: "Mô tả",
  desc: "Mô tả",
  text: "Nội dung thông báo",
  due: "Hạn hoàn thành",
  query: "Tìm kiếm",
  limit: "Giới hạn",
  labels: "Nhãn",
};
export const PlanStepItem: React.FC<PlanStepItemProps> = ({ step, index }) => {
  const service = step.tool.split(".")[0];
  const resourceKeys = [
    "repo",
    "owner",
    "boardId",
    "listId",
    "cardId",
    "channel",
    "memberId",
  ];
  const entries = Object.entries(step.args || {});
  return (
    <article className="plan-step">
      <div className="step-heading">
        <span className="step-number">
          {String(index + 1).padStart(2, "0")}
        </span>
        <Icon name={service} />
      </div>
      <div className="step-body">
        <div className="step-service">
          <code>{step.tool}</code>
          <span className="write-tag">
            {writes.has(step.tool)
              ? "Ghi"
              : reads.has(step.tool)
                ? "Đọc"
                : "Chưa phân loại"}
          </span>
        </div>
        <h3>{step.description}</h3>
        {entries
          .filter(([key]) => resourceKeys.includes(key))
          .map(([key, value]) => (
            <div key={key}>
              <div className="resource-label">{argLabels[key] || key}</div>
              <div className="resource-value" data-testid={`arg-${key}`}>
                {formatArgValue(value).text}
              </div>
            </div>
          ))}
        <div className="payload">
          {entries
            .filter(([key]) => !resourceKeys.includes(key))
            .map(([key, value]) => (
              <div key={key}>
                <strong>{argLabels[key] || key}</strong>
                <p data-testid={`arg-${key}`}>{formatArgValue(value).text}</p>
              </div>
            ))}
          {entries.length === 0 && <p>Không có tham số bổ sung.</p>}
        </div>
        <p className="dependency">
          {step.dependsOn?.length
            ? "Dùng kết quả: " + step.dependsOn.join(", ")
            : "Khởi đầu quy trình"}
        </p>
      </div>
    </article>
  );
};
