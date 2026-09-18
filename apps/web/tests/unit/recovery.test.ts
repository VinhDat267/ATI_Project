import { describe, expect, it } from "vitest";
import { RunDetailSchema } from "@wap/dsl/browser";
import { createDraftStore } from "../../src/core/draft.js";
import {
  messageOnlyPromptFor,
  recoveryFor,
} from "../../src/core/recovery.js";
import { createFixtureScenario } from "../../src/core/fixtures.js";
import type { RunDetail } from "../../src/core/contracts.js";
import { summarizeAction } from "../../src/core/writes.js";

/** Reconcile fixture whose plan also notifies #nhom-ati. */
function withNotification(status: RunDetail["status"]): RunDetail {
  const run = createFixtureScenario(status);
  const plan = run.plan!;
  const first = plan.steps[1]!;
  return RunDetailSchema.parse({
    ...run,
    source_prompt: "Chép tiến độ tuần 37 rồi báo vào #nhom-ati",
    plan: {
      ...plan,
      steps: [
        ...plan.steps,
        {
          ...first,
          id: "notify",
          description: "Báo nhóm",
          depends_on: ["write_report"],
          idempotency_key: "fixture-notify",
          tool: {
            server: "task_hub",
            name: "send_slack_message",
            args: {
              channel: "#nhom-ati",
              text: "Tiến độ tuần 37 đã được chép sang bảng Báo cáo tuần.",
            },
          },
        },
      ],
    },
  });
}

const sheetWrite = summarizeAction({
  step_id: "write_report",
  server: "task_hub",
  tool: "append_sheet_rows",
  resolved_args: {
    spreadsheet_id: "bao-cao",
    sheet_name: "Báo cáo tuần",
    rows: [["1"], ["2"], ["3"], ["4"]],
  },
});

describe("draft store", () => {
  it("hands a draft over exactly once", () => {
    const store = createDraftStore();
    store.set({
      prompt: "Chép tiến độ",
      origin: { runId: "r", reason: "reconcile_not_seen" },
    });
    expect(store.take()?.origin?.reason).toBe("reconcile_not_seen");
    expect(store.take()).toBeNull();
  });
});

describe("recoveryFor", () => {
  it("derives the message-only request from the plan", () => {
    expect(messageOnlyPromptFor(withNotification("reconciliation_required"))).toBe(
      "Báo vào #nhom-ati rằng tiến độ tuần 37 đã được chép sang bảng Báo cáo tuần",
    );
    expect(messageOnlyPromptFor(createFixtureScenario("reconciliation_required"))).toBeNull();
  });

  it("asks seen/not-seen for not_observed receipts", () => {
    const run = withNotification("reconciliation_required");
    const plan = recoveryFor(run, {
      receipts: ["not_observed"],
      pendingWrites: [sheetWrite],
    });
    expect(plan.kind).toBe("question");
    if (plan.kind !== "question") return;
    expect(plan.prompt).toBe("Trên bảng “Báo cáo tuần” đã có 4 dòng đã gửi chưa?");
    expect(plan.options.map((o) => o.label)).toEqual(["Đã thấy đủ 4 dòng", "Không thấy"]);
    expect(plan.options[0]?.draft?.prompt).toMatch(/^Báo vào #nhom-ati rằng/);
    expect(plan.options[0]?.draft?.origin?.reason).toBe("reconcile_seen");
    expect(plan.options[1]?.draft?.prompt).toBe(run.source_prompt);
    expect(plan.options[1]?.draft?.origin?.reason).toBe("reconcile_not_seen");
  });

  it("adds a third answer for conflicts", () => {
    const plan = recoveryFor(withNotification("reconciliation_required"), {
      receipts: ["conflict"],
      pendingWrites: [sheetWrite],
    });
    expect(plan.kind === "question" && plan.options.map((o) => o.id)).toEqual([
      "seen",
      "not_seen",
      "differs",
    ]);
  });

  it("offers a message-only request when every write is confirmed", () => {
    const plan = recoveryFor(withNotification("reconciliation_required"), {
      receipts: ["confirmed"],
      pendingWrites: [],
    });
    expect(plan).toMatchObject({
      kind: "primary",
      label: "Tạo yêu cầu chỉ gửi thông báo",
    });
  });

  it("reuses prompts after expiry and failure, offers nothing after refusal", () => {
    const expired = recoveryFor(createFixtureScenario("expired"), {
      receipts: null,
      pendingWrites: [],
    });
    expect(expired).toMatchObject({ kind: "primary", label: "Dùng lại yêu cầu này" });
    expect(
      recoveryFor(createFixtureScenario("failed"), { receipts: null, pendingWrites: [] }),
    ).toMatchObject({ kind: "primary", label: "Dùng lại yêu cầu này" });
    expect(
      recoveryFor(createFixtureScenario("refused"), { receipts: null, pendingWrites: [] }).kind,
    ).toBe("none");
  });

  it("prefers the planner suggestion for needs_input", () => {
    const plan = recoveryFor(createFixtureScenario("needs_input"), {
      receipts: null,
      pendingWrites: [],
      suggestedPrompt: "Tạo thẻ trên board_a, hạn 20/09/2026",
    });
    expect(plan).toMatchObject({
      kind: "primary",
      label: "Dùng câu gợi ý này",
      secondary: { label: "Dùng lại câu gốc" },
    });
  });
});
