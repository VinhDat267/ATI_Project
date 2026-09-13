import { z } from "zod";

export const POLICY_VERSION = "b-local-1";

export const ToolNameSchema = z.enum([
  "read_sheet_range",
  "append_sheet_rows",
  "send_slack_message",
  "list_cards",
  "get_card",
  "list_members",
  "create_card",
  "move_card",
]);
export type ToolName = z.infer<typeof ToolNameSchema>;

export const ENABLED_TOOL_NAMES = [
  "read_sheet_range",
  "append_sheet_rows",
  "send_slack_message",
] as const;
export const EnabledToolNameSchema = z.enum(ENABLED_TOOL_NAMES);
export type EnabledToolName = z.infer<typeof EnabledToolNameSchema>;

const id = z.string().min(1).max(200);
const cells = z.array(z.array(z.string().max(8192)).max(100)).max(1000);

const cardSummary = z
  .object({
    id,
    board_id: id,
    title: z.string().min(1).max(500),
    list_name: id,
  })
  .strict();

export const inputs = {
  read_sheet_range: z
    .object({ spreadsheet_id: id, range: z.string().min(1).max(200) })
    .strict(),
  append_sheet_rows: z
    .object({ spreadsheet_id: id, sheet_name: id, rows: cells })
    .strict(),
  send_slack_message: z
    .object({
      channel: id,
      text: z.string().min(1).max(16000),
      thread_ts: z.uuid().optional(),
    })
    .strict(),
  list_cards: z
    .object({
      board_id: id,
      list_name: id.optional(),
      assignee_id: id.optional(),
      since: z.iso.date().optional(),
      until: z.iso.date().optional(),
    })
    .strict(),
  get_card: z.object({ card_id: id }).strict(),
  list_members: z.object({ board_id: id }).strict(),
  create_card: z
    .object({
      board_id: id,
      list_name: id,
      title: z.string().min(1).max(500).regex(/\S/),
      description: z.string().max(16000).optional(),
      due_date: z.iso.date().optional(),
      assignee_id: id.optional(),
    })
    .strict(),
  move_card: z.object({ card_id: id, target_list: id }).strict(),
};

export const outputs = {
  read_sheet_range: z
    .object({ values: cells, row_count: z.number().int().nonnegative() })
    .strict(),
  append_sheet_rows: z
    .object({ appended_count: z.number().int().nonnegative() })
    .strict(),
  send_slack_message: z
    .object({ id: z.uuid(), channel: z.string(), text: z.string() })
    .strict(),
  list_cards: z
    .object({
      cards: z.array(cardSummary).max(1000),
      count: z.number().int().nonnegative(),
    })
    .strict(),
  get_card: cardSummary,
  list_members: z
    .object({
      members: z
        .array(
          z
            .object({
              id,
              name: z.string().min(1).max(200),
              task_count: z.number().int().nonnegative(),
            })
            .strict(),
        )
        .max(1000),
    })
    .strict(),
  create_card: z.object({ id }).strict(),
  move_card: z.object({ id, list_name: id }).strict(),
};

export const AuthorizationSchema = z
  .object({
    approval_id: z.uuid(),
    operation_id: z.uuid(),
    snapshot_hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type Authorization = z.infer<typeof AuthorizationSchema>;

const descriptions: Record<ToolName, string> = {
  read_sheet_range:
    "Đọc vùng A1 hữu hạn trong bảng local của tài khoản cấu hình; tối đa 1000 dòng × 100 cột.",
  append_sheet_rows:
    "Thêm nguyên các dòng vào bảng local đã tồn tại. Chỉ controller có approval/operation hợp lệ được gọi.",
  send_slack_message:
    "Ghi thông báo vào kênh local đã tồn tại; không gửi tới Slack thật. thread_ts là UUID thông báo local.",
  list_cards:
    "LOCAL DATA ONLY. Lấy danh sách card (task) trong một board. Lọc được theo cột, người phụ trách, và mốc thời gian cập nhật.",
  get_card:
    "LOCAL DATA ONLY. Lấy thông tin tóm tắt một card: id, board_id, title, list_name.",
  list_members:
    "LOCAL DATA ONLY. Danh sách thành viên của board kèm số task đang phụ trách (chỉ tính card trong cột chưa hoàn thành).",
  create_card:
    "LOCAL DATA ONLY. Tạo card mới trong một cột của board.",
  move_card:
    "LOCAL DATA ONLY. Chuyển card sang cột khác, ví dụ từ Doing sang Done.",
};

const readNames = new Set<ToolName>([
  "read_sheet_range",
  "list_cards",
  "get_card",
  "list_members",
]);

export function toolDefinitions() {
  return ENABLED_TOOL_NAMES.map((name: ToolName) => ({
    name,
    description: descriptions[name],
    inputSchema: z.toJSONSchema(inputs[name], { io: "input" }),
    outputSchema: z.toJSONSchema(outputs[name]),
    annotations: {
      readOnlyHint: readNames.has(name),
      openWorldHint: false,
      destructiveHint: name === "move_card",
    },
  }));
}
