export type WriteKind = "sheet" | "message" | "card" | "move" | "file" | "other";

export interface WriteSummary {
  operationId: string | null;
  stepId: string;
  kind: WriteKind;
  /** Human sentence shown in "Bạn sắp ghi" and write cards. */
  sentence: string;
  /** Short destination label, e.g. “Báo cáo tuần” or #nhom-ati. */
  target: string;
  count: number | null;
  rows: string[][] | null;
  text: string | null;
  server: string;
  tool: string;
}

export interface ActionLike {
  step_id: string;
  operation_id?: string;
  server: string;
  tool: string;
  resolved_args: Record<string, unknown>;
}

const str = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

function stringRows(value: unknown): string[][] | null {
  if (!Array.isArray(value)) return null;
  const rows: string[][] = [];
  for (const row of value) {
    if (!Array.isArray(row) || !row.every((cell) => typeof cell === "string")) {
      return null;
    }
    rows.push(row as string[]);
  }
  return rows;
}

/**
 * Turns one previewed write into a plain sentence. Unknown tools or argument
 * shapes fall back to "server.tool" rather than guessing a destination.
 */
export function summarizeAction(action: ActionLike): WriteSummary {
  const args = action.resolved_args;
  const base = {
    operationId: action.operation_id ?? null,
    stepId: action.step_id,
    server: action.server,
    tool: action.tool,
    count: null,
    rows: null,
    text: null,
  };
  const fallback: WriteSummary = {
    ...base,
    kind: "other",
    sentence: `${action.server}.${action.tool}`,
    target: action.server,
  };

  if (action.server === "task_hub") {
    switch (action.tool) {
      case "append_sheet_rows": {
        const sheet = str(args.sheet_name);
        const rows = stringRows(args.rows);
        if (!sheet || !rows) return fallback;
        return {
          ...base,
          kind: "sheet",
          sentence: `Thêm ${rows.length} dòng vào “${sheet}”`,
          target: `“${sheet}”`,
          count: rows.length,
          rows,
        };
      }
      case "send_slack_message": {
        const channel = str(args.channel);
        const text = str(args.text);
        if (!channel || !text) return fallback;
        return {
          ...base,
          kind: "message",
          sentence: `Gửi 1 tin nhắn vào ${channel}`,
          target: channel,
          count: 1,
          text,
        };
      }
      case "create_card": {
        const title = str(args.title);
        const list = str(args.list_name);
        if (!title || !list) return fallback;
        return {
          ...base,
          kind: "card",
          sentence: `Tạo thẻ “${title}” trong ${list}`,
          target: list,
          count: 1,
        };
      }
      case "move_card": {
        const card = str(args.card_id);
        const list = str(args.target_list);
        if (!card || !list) return fallback;
        return {
          ...base,
          kind: "move",
          sentence: `Chuyển thẻ ${card} sang ${list}`,
          target: list,
          count: 1,
        };
      }
      default:
        return fallback;
    }
  }

  if (action.server === "filesystem") {
    const path = str(args.path);
    if (!path) return fallback;
    return {
      ...base,
      kind: "file",
      sentence: `Ghi tệp ${path}`,
      target: path,
      count: 1,
    };
  }

  return fallback;
}
