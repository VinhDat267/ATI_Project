import { expect, it } from "vitest";
import { summarizeAction } from "../../src/core/writes.js";

it("writes plain sentences for known tools", () => {
  const sheet = summarizeAction({
    step_id: "a",
    server: "task_hub",
    tool: "append_sheet_rows",
    resolved_args: {
      spreadsheet_id: "bao-cao",
      sheet_name: "Báo cáo tuần",
      rows: [
        ["Tuần 38", "An"],
        ["Tuần 38", "Hà"],
      ],
    },
  });
  expect(sheet).toMatchObject({
    kind: "sheet",
    sentence: "Thêm 2 dòng vào “Báo cáo tuần”",
    count: 2,
    rows: [
      ["Tuần 38", "An"],
      ["Tuần 38", "Hà"],
    ],
  });
  expect(
    summarizeAction({
      step_id: "b",
      server: "task_hub",
      tool: "send_slack_message",
      resolved_args: { channel: "#nhom-ati", text: "Xong" },
    }),
  ).toMatchObject({ kind: "message", sentence: "Gửi 1 tin nhắn vào #nhom-ati", text: "Xong" });
  expect(
    summarizeAction({
      step_id: "c",
      server: "task_hub",
      tool: "create_card",
      resolved_args: { board_id: "b", list_name: "Backlog", title: "Nộp slide" },
    }).sentence,
  ).toBe("Tạo thẻ “Nộp slide” trong Backlog");
  expect(
    summarizeAction({ step_id: "d", server: "x", tool: "y", resolved_args: {} })
      .sentence,
  ).toBe("x.y");
});

it("falls back safely when arguments have an unexpected shape", () => {
  expect(
    summarizeAction({
      step_id: "e",
      server: "task_hub",
      tool: "append_sheet_rows",
      resolved_args: { sheet_name: 3, rows: "nope" },
    }).sentence,
  ).toBe("task_hub.append_sheet_rows");
});
